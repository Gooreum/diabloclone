// 원작 효과음·음악·대사 재생 (Web Audio API).
// - 파일: 원작 d2sfx / d2speech / d2music(+patch_d2) MPQ 를 HTTP Range 로 읽고 워커에서 huffman+ADPCM 해제 → WAV → AudioBuffer
// - 표: sounds.txt (볼륨·묶음·반복·페이드·중복 규칙·거리 감쇠), SoundEnviron.txt (레벨 음악·배경음·발소리 재질)
// - 게임 사건(GameEvent)과 스냅숏 변화(모드 전환·미사일 생성/소멸)를 소리로 바꾼다. 엔진은 건드리지 않는다.
// 브라우저 정책상 첫 사용자 입력(클릭·키) 전에는 AudioContext 가 멈춰 있다 → 첫 입력에서 resume.
import type { AssetLoader } from '../assets/loader';
import { MpqRemote, httpRange, type RangeFetcher } from '../assets/remote';
import type { GameTables } from '../data/tables';
import type { Game, GameData, GameEvent, WorldSnapshot } from '../engine/game';
import {
  ItemSoundTable, MissileSoundTable, MonsterSounds, SkillSoundTable, SoundEnvTable, SoundTable, footstepSound, npcGossipSound, npcGreetingSound,
  objectOpenSound, questPlayerSound, questSpeechCandidates, resolveSoundPath, weaponSwingSound, type SoundEntry, type SoundEnv,
} from '../data/sounds';
import { decodeRequest, type DecodeRequest, type DecodeResponse } from './decode-worker';

export const SOUND_MPQS = ['patch_d2.mpq', 'd2sfx.mpq', 'd2speech.mpq', 'd2music.mpq'] as const;
export const SOUND_TABLES = ['sounds', 'SoundEnviron', 'MonSounds'] as const;

export type Channel = 'sfx' | 'music' | 'speech' | 'ambient';

export interface AudioLogEntry { t: number; channel: Channel; name: string; path: string; state: 'requested' | 'playing' | 'missing' | 'stopped' }

export interface AudioSettings { sfx: number; music: number; muted: boolean }

const SETTINGS_KEY = 'd2clone.audio';
const ENGINE_FPS = 25;
const MAX_VOICES = 24;

/** 근사(원작 미확인): Falloff 등급 → 들리는 최대 거리(서브타일) */
const FALLOFF_RANGE = [0, 24, 36, 54, 80];

function loadSettings(): AudioSettings {
  const def: AudioSettings = { sfx: 0.8, music: 0.6, muted: false };
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (!raw) return def;
    const v = JSON.parse(raw) as Partial<AudioSettings>;
    const clamp = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : d);
    return { sfx: clamp(v.sfx, def.sfx), music: clamp(v.music, def.music), muted: v.muted === true };
  } catch {
    return def;
  }
}

function saveSettings(s: AudioSettings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // 저장 불가(사생활 모드 등) — 이번 세션만 유지
  }
}

/** MPQ 파일 → 해제된 PCM (워커 우선, 실패 시 메인 스레드) */
class SoundFiles {
  private archives: MpqRemote[] = [];
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, (r: DecodeResponse) => void>();

  async open(baseUrl: string, fetchRange: RangeFetcher = httpRange): Promise<void> {
    const opened = await Promise.all(SOUND_MPQS.map((f) => MpqRemote.open(baseUrl + f, fetchRange).catch(() => null)));
    this.archives = opened.filter((a): a is MpqRemote => a !== null);
    try {
      this.worker = new Worker(new URL('./decode-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<DecodeResponse>) => {
        const cb = this.waiting.get(ev.data.id);
        this.waiting.delete(ev.data.id);
        cb?.(ev.data);
      };
      this.worker.onerror = () => {
        // 워커를 못 쓰면 메인 스레드로
        this.worker = null;
        for (const [, cb] of this.waiting) cb({ id: 0, ok: false, error: 'worker failed' });
        this.waiting.clear();
      };
    } catch {
      this.worker = null;
    }
  }

  has(path: string): boolean {
    return this.archives.some((a) => a.has(path));
  }

  async decode(path: string): Promise<DecodeResponse> {
    const a = this.archives.find((x) => x.has(path));
    const block = a?.findBlock(path);
    if (!a || !block) return { id: 0, ok: false, error: `missing ${path}` };
    const raw = await a.readRaw(path);
    if (!raw) return { id: 0, ok: false, error: `missing ${path}` };
    const req: DecodeRequest = { id: this.nextId++, raw, block, sectorSize: a.sectorSize, path };
    const w = this.worker;
    if (!w) return decodeRequest(req);
    return new Promise((resolve) => {
      // 워커 실패(id 0) 면 원본이 이미 넘어갔으므로 다시 읽어 메인 스레드에서 해제
      this.waiting.set(req.id, (r) => resolve(r.ok || r.id !== 0 ? r : this.decode(path)));
      w.postMessage(req, [raw.buffer as ArrayBuffer]);
    });
  }
}

interface Voice { name: string; priority: number; src: AudioBufferSourceNode; gain: GainNode; channel: Channel; stop: (fade: number) => void }

interface Tables {
  sounds: SoundTable; env: SoundEnvTable; mon: MonsterSounds; items: ItemSoundTable; skills: SkillSoundTable; missiles: MissileSoundTable;
}

export interface AttachOptions { assets: AssetLoader; tables: GameTables; data: GameData; cls: string; baseUrl?: string }

/** 효과음·음악·대사 */
export class SoundSystem {
  readonly log: AudioLogEntry[] = [];
  settings: AudioSettings = loadSettings();
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private readonly files = new SoundFiles();
  private opened: Promise<void> | null = null;
  private tables: Tables | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly voices: Voice[] = [];
  private readonly lastPlayed = new Map<string, number>();
  private music: { name: string; voice: Voice | null } | null = null;
  private ambience: { name: string; voice: Voice | null } | null = null;
  private speech: Voice | null = null;
  private speechToken = 0;
  private roll = 1;
  private now = 0; // 게임 틱
  private listener = { x: 0, y: 0 };
  private unlockBound = false;

  /** 첫 사용자 입력에서 AudioContext 시작 (브라우저 자동 재생 정책) */
  bindUnlock(target: Window = window): void {
    if (this.unlockBound) return;
    this.unlockBound = true;
    const unlock = () => {
      const c = this.context();
      if (c && c.state !== 'running') void c.resume().catch(() => undefined);
    };
    target.addEventListener('pointerdown', unlock, true);
    target.addEventListener('keydown', unlock, true);
    // 원작 UI 단추 소리: DOM 단추 클릭 (cursor_button_click)
    target.addEventListener('click', (e) => {
      const el = e.target as HTMLElement | null;
      if (el && typeof el.closest === 'function' && el.closest('button')) this.play('cursor_button_click');
    }, true);
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.sfxBus.connect(this.ctx.destination);
    this.musicBus.connect(this.ctx.destination);
    this.applyVolumes();
    return this.ctx;
  }

  setVolume(kind: 'sfx' | 'music', v: number): void {
    this.settings = { ...this.settings, [kind]: Math.min(1, Math.max(0, v)) };
    saveSettings(this.settings);
    this.applyVolumes();
  }

  setMuted(m: boolean): void {
    this.settings = { ...this.settings, muted: m };
    saveSettings(this.settings);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const m = this.settings.muted ? 0 : 1;
    if (this.sfxBus) this.sfxBus.gain.value = this.settings.sfx * m;
    if (this.musicBus) this.musicBus.gain.value = this.settings.music * m;
  }

  /** 원작 표·MPQ 준비 (한 번만) */
  async init(opts: AttachOptions): Promise<void> {
    this.opened ??= (async () => {
      const paths = SOUND_TABLES.map((t) => `data\\global\\excel\\${t}.txt`);
      await Promise.all([opts.assets.preload(paths), this.files.open(opts.baseUrl ?? '/d2/')]);
      const t = opts.tables;
      this.tables = {
        sounds: new SoundTable(t.table('sounds')),
        env: new SoundEnvTable(t.table('SoundEnviron'), t.table('Levels')),
        mon: new MonsterSounds(t.table('MonSounds'), t.table('MonStats')),
        items: new ItemSoundTable(t.table('weapons'), t.table('armor'), t.table('misc')),
        skills: new SkillSoundTable(t.table('skills')),
        missiles: new MissileSoundTable(t.table('Missiles')),
      };
    })();
    return this.opened;
  }

  private nextRoll(): number {
    // xorshift — 묶음 변형 고르기 (게임 난수와 분리)
    let x = this.roll;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.roll = x >>> 0 || 1;
    return this.roll;
  }

  private buffer(path: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(path);
    if (!p) {
      p = this.files.decode(path).then((r) => {
        const c = this.context();
        if (!r.ok || !c) return null;
        const buf = c.createBuffer(r.channels.length, Math.max(1, r.frames), r.sampleRate);
        r.channels.forEach((d, i) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, i));
        return buf;
      }).catch(() => null);
      // 배경음악은 한 곡이 수십 MB(풀린 PCM) 라 기억하지 않는다 — 재생 중인 목소리가 버퍼를 붙잡고 있고, 바뀌면 버려진다
      if (!/\\music\\/i.test(path)) this.buffers.set(path, p);
    }
    return p;
  }

  private entry(name: string): { e: SoundEntry; path: string } | null {
    const t = this.tables;
    if (!t) return null;
    const e = t.sounds.pick(name, this.nextRoll());
    if (!e) return null;
    const path = resolveSoundPath(e, (p) => this.files.has(p));
    return path ? { e, path } : null;
  }

  private record(channel: Channel, name: string, path: string, state: AudioLogEntry['state']): void {
    this.log.push({ t: Math.round(performance.now()), channel, name, path, state });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  /**
   * 소리 하나 재생. at = 월드 위치(서브타일) → 거리 감쇠·좌우 위치. delay = 초.
   * 반환: 재생 시작 여부 (비동기 — 버퍼 준비 후)
   */
  play(name: string, opt: { at?: { x: number; y: number }; delay?: number; channel?: Channel; volume?: number } = {}): Promise<Voice | null> {
    const channel = opt.channel ?? 'sfx';
    const hit = this.entry(name);
    if (!hit) {
      if (this.tables) this.record(channel, name, '', 'missing');
      return Promise.resolve(null);
    }
    const { e, path } = hit;
    // Compound: 같은 소리를 너무 자주 내지 않는다 / Defer Inst: 이미 재생 중이면 새 소리를 버린다
    const last = this.lastPlayed.get(e.name);
    if (e.compound > 0 && last !== undefined && this.now - last < e.compound) return Promise.resolve(null);
    if (e.deferInst && this.voices.some((v) => v.name === e.name)) return Promise.resolve(null);
    this.lastPlayed.set(e.name, this.now);
    let gain = (e.volume / 255) * (opt.volume ?? 1);
    let pan = 0;
    if (opt.at && e.falloff > 0) {
      const dx = opt.at.x - this.listener.x, dy = opt.at.y - this.listener.y;
      const d = Math.hypot(dx, dy);
      const range = FALLOFF_RANGE[e.falloff] ?? 40;
      if (d >= range) return Promise.resolve(null);
      gain *= 1 - d / range;
      // 아이소메트릭 화면 가로 = x - y
      pan = Math.max(-1, Math.min(1, (dx - dy) / range));
    }
    this.record(channel, e.name, path, 'requested');
    return this.buffer(path).then((buf) => {
      const c = this.context();
      if (!buf || !c) return null;
      return this.start(c, buf, e, path, channel, gain, pan, opt.delay ?? 0);
    });
  }

  private start(c: AudioContext, buf: AudioBuffer, e: SoundEntry, path: string, channel: Channel, gain: number, pan: number, delay: number): Voice | null {
    if (e.stopInst) for (const v of this.voices.filter((x) => x.name === e.name)) v.stop(0);
    // 동시 재생 수 제한: 우선순위가 가장 낮은 소리를 끊는다 (sounds.txt Priority)
    const oneShots = this.voices.filter((v) => v.channel === 'sfx');
    if (channel === 'sfx' && oneShots.length >= MAX_VOICES) {
      const low = oneShots.reduce((a, b) => (b.priority < a.priority ? b : a));
      if (low.priority > e.priority) return null;
      low.stop(0);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = e.loop;
    const g = c.createGain();
    const t0 = c.currentTime + delay;
    const fadeIn = e.fadeIn / ENGINE_FPS;
    if (fadeIn > 0) {
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + Math.min(fadeIn, 5));
    } else g.gain.value = gain;
    let node: AudioNode = src;
    if (pan !== 0 && typeof c.createStereoPanner === 'function') {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      src.connect(p);
      node = p;
    }
    node.connect(g);
    g.connect(channel === 'music' ? (this.musicBus as GainNode) : (this.sfxBus as GainNode));
    const voice: Voice = {
      name: e.name, priority: e.priority, src, gain: g, channel,
      stop: (fade: number) => {
        const now = c.currentTime;
        try {
          if (fade > 0) {
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(g.gain.value, now);
            g.gain.linearRampToValueAtTime(0, now + fade);
            src.stop(now + fade);
          } else src.stop();
        } catch {
          // 이미 멈춘 소스
        }
      },
    };
    src.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
    };
    this.voices.push(voice);
    src.start(t0);
    this.record(channel, e.name, path, 'playing');
    return voice;
  }

  /** 첫 후보 중 표에 있는 소리 이름 */
  private firstKnown(names: string[]): string | null {
    const t = this.tables;
    if (!t) return null;
    return names.find((n) => t.sounds.get(n)) ?? null;
  }

  // ---------------------------------------------------------------- 음악·배경음

  /** 레벨 음악: SoundEnviron.Song (반복, 바뀌면 교차 페이드) */
  setMusic(name: string | null): void {
    if ((this.music?.name ?? null) === name) return;
    const fadeOut = this.music?.voice ? Math.min(5, (this.tables?.sounds.get(this.music.name)?.fadeOut ?? 50) / ENGINE_FPS) : 0;
    const prev = this.music;
    if (prev?.voice) {
      prev.voice.stop(fadeOut);
      this.record('music', prev.name, '', 'stopped');
    }
    this.music = name ? { name, voice: null } : null;
    if (!name) return;
    const slot = this.music;
    void this.play(name, { channel: 'music' }).then((v) => {
      if (!v) return;
      // 그 사이 음악이 바뀌었으면 버린다
      if (this.music !== slot) v.stop(0);
      else if (slot) slot.voice = v;
    });
  }

  /** 배경음 (SoundEnviron Day Ambience) — 반복 */
  setAmbience(name: string | null): void {
    if ((this.ambience?.name ?? null) === name) return;
    this.ambience?.voice?.stop(1);
    this.ambience = name ? { name, voice: null } : null;
    if (!name) return;
    const slot = this.ambience;
    void this.play(name, { channel: 'ambient' }).then((v) => {
      if (!v) return;
      if (this.ambience !== slot) v.stop(0);
      else if (slot) slot.voice = v;
    });
  }

  /** 대사: 한 번에 하나 (새 대사가 이전 대사를 끊는다) */
  speak(names: string[]): void {
    const name = this.firstKnown(names);
    this.stopSpeech();
    if (!name) return;
    const token = ++this.speechToken;
    void this.play(name, { channel: 'speech' }).then((v) => {
      if (!v) return;
      if (token !== this.speechToken) v.stop(0);
      else this.speech = v;
    });
  }

  stopSpeech(): void {
    this.speechToken++;
    this.speech?.stop(0.2);
    this.speech = null;
  }

  stopAll(): void {
    this.setMusic(null);
    this.setAmbience(null);
    this.stopSpeech();
  }

  // ---------------------------------------------------------------- 게임 연결

  /**
   * 게임에 붙인다: tick()·snapshot() 을 감싸 사건과 스냅숏을 엿본다 (엔진·UI 코드 변경 없음).
   * 반환: 떼어내기 (음악·배경음 정지)
   */
  attach(game: Game, opts: AttachOptions): () => void {
    this.bindUnlock();
    const listener = new GameListener(this, game, opts);
    void this.init(opts).then(() => listener.ready());
    const tick = game.tick.bind(game);
    const snapshot = game.snapshot.bind(game);
    game.tick = () => {
      const evs = tick();
      this.now++;
      listener.onTick(evs);
      return evs;
    };
    game.snapshot = () => {
      const s = snapshot();
      listener.onSnapshot(s);
      return s;
    };
    return () => {
      game.tick = tick;
      game.snapshot = snapshot;
      this.stopAll();
    };
  }

  /** @internal GameListener 용 */
  get table(): Tables | null {
    return this.tables;
  }

  /** @internal */
  setListener(x: number, y: number): void {
    this.listener = { x, y };
  }

  /** @internal */
  rollNext(): number {
    return this.nextRoll();
  }

  /** @internal */
  firstName(names: string[]): string | null {
    return this.firstKnown(names);
  }
}

/** 게임 사건 → 소리 */
class GameListener {
  private snap: Readonly<WorldSnapshot> | null = null;
  private prevPlayerMode = '';
  private readonly monModes = new Map<number, string>();
  private missiles = new Map<number, { name: string; x: number; y: number }>();
  private levelId = '';
  private env: SoundEnv | undefined;
  private stepTick = 0;
  private steps = 0;
  private nextEvent = 0;
  private readonly neutralAt = new Map<number, number>();
  private isReady = false;

  constructor(private readonly s: SoundSystem, private readonly game: Game, private readonly opts: AttachOptions) {}

  ready(): void {
    this.isReady = true;
    this.enterLevel();
  }

  onSnapshot(s: Readonly<WorldSnapshot>): void {
    this.snap = s;
  }

  private get cls(): string {
    return this.opts.cls.toLowerCase();
  }

  /** 레벨 음악·배경음 (levels.txt SoundEnv → SoundEnviron) */
  private enterLevel(): void {
    const t = this.s.table;
    if (!t) return;
    this.levelId = this.game.levelId;
    const def = this.game.levelDef(this.levelId);
    this.env = t.env.forLevel(def?.levelNo);
    const song = this.env && this.env.song ? t.sounds.get(this.env.song)?.name ?? null : null;
    this.s.setMusic(song);
    // 근사(원작 미확인): 낮/밤 주기가 없어 항상 Day Ambience
    const amb = this.env && this.env.dayAmbience ? t.sounds.get(this.env.dayAmbience)?.name ?? null : null;
    this.s.setAmbience(amb);
    this.nextEvent = this.env ? this.env.eventDelay : 0;
  }

  onTick(evs: GameEvent[]): void {
    if (!this.isReady) return;
    const t = this.s.table;
    if (!t) return;
    if (this.game.levelId !== this.levelId) this.enterLevel();
    const snap = this.snap;
    if (snap) this.s.setListener(snap.player.x, snap.player.y);
    for (const ev of evs) this.onEvent(ev, t);
    if (snap) this.onState(snap, t);
    this.ambientEvent(t);
  }

  private at(id: unknown): { x: number; y: number } | undefined {
    const m = this.snap?.monsters.find((x) => x.id === id);
    if (m) return { x: m.x, y: m.y };
    const o = this.game.objects.find((x) => x.id === id);
    return o ? { x: o.x, y: o.y } : undefined;
  }

  private monsterType(id: unknown): string | undefined {
    return this.snap?.monsters.find((x) => x.id === id)?.typeId ?? this.game.monsters.find((m) => m.id === id)?.type.id;
  }

  private onEvent(ev: GameEvent, t: Tables): void {
    const s = this.s;
    const cls = this.cls;
    switch (ev.type) {
      case 'levelUp':
        void s.play('cursor_level_up');
        break;
      case 'mercLevelUp':
        void s.play('cursor_level_up_hireling');
        break;
      case 'playerDied':
        void s.play(`${cls}_death_1`);
        break;
      case 'goldPickup':
        void s.play('item_gold');
        break;
      case 'itemPickup': {
        const it = t.items.of(String(ev.code));
        void s.play(it?.drop || 'item_pickup');
        break;
      }
      case 'itemMoved': {
        if (ev.to === 'cursor' || ev.to === 'ground') break;
        const it = this.itemCode(ev.itemId);
        const snd = it ? t.items.of(it)?.drop : undefined;
        void s.play(snd || 'item_pickup');
        break;
      }
      case 'itemUsed': {
        const snd = t.items.of(String(ev.code))?.use;
        if (snd) void s.play(snd);
        break;
      }
      case 'itemDropped': {
        // 원작: 떨어지는 아이템이 공중에서 돌고(flippy) 땅에 닿는 프레임(dropsfxframe)에 dropsound
        const g = this.game.snapshot().items.find((x) => x.id === ev.itemId);
        const at = g ? { x: g.x, y: g.y } : undefined;
        const it = t.items.of(String(ev.code));
        void s.play('item_flippy', { ...(at ? { at } : {}) });
        if (it?.drop) void s.play(it.drop, { ...(at ? { at } : {}), delay: Math.max(0, it.dropFrame) / ENGINE_FPS });
        break;
      }
      case 'itemBroken':
        void s.play('cursor_durability_break');
        break;
      case 'itemIdentified':
        void s.play('cursor_identify_item');
        break;
      case 'noRoom':
        void s.play(`${cls}_cantcarry_1`);
        break;
      case 'noMana':
        void s.play(`${cls}_needmana_1`);
        break;
      case 'locked':
        void s.play(`${cls}_needkey_1`);
        break;
      case 'itemMoveFailed':
        void s.play(`${cls}_cantuseyet`);
        break;
      case 'skillStart': {
        const sk = t.skills.of(Number(ev.skill));
        if (!sk) break;
        const delay = sk.startDelay / ENGINE_FPS;
        if (sk.start) void s.play(sk.start, { delay });
        if (sk.startClass) void s.play(sk.startClass, { delay });
        // 근사(원작 미확인): dosound 는 원작 공격 프레임에서 — 여기서는 시작 후 0.2초
        if (sk.doSound) void s.play(sk.doSound, { delay: delay + 0.2 });
        if (Number(ev.skill) === 0) this.swing();
        break;
      }
      case 'monsterHit': {
        const typeId = this.monsterType(ev.targetId);
        const ms = typeId ? t.mon.of(typeId) : undefined;
        const at = this.at(ev.targetId);
        if (ms?.hit) void s.play(ms.hit, { ...(at ? { at } : {}), delay: ms.hitDelay / ENGINE_FPS });
        break;
      }
      case 'monsterKilled': {
        const ms = t.mon.of(String(ev.typeId));
        const at = this.at(ev.targetId);
        if (ms?.death) void s.play(ms.death, { ...(at ? { at } : {}), delay: ms.deathDelay / ENGINE_FPS });
        break;
      }
      case 'objectOpened': {
        const o = this.game.objects.find((x) => x.id === ev.objectId);
        const snd = o ? objectOpenSound(o.type.operateFn, o.type.name) : null;
        if (o && snd) void s.play(snd, { at: { x: o.x, y: o.y } });
        break;
      }
      case 'doorOpened':
      case 'doorClosed': {
        const o = this.game.objects.find((x) => x.id === ev.objectId);
        // 근사(원작 미확인): 문 재질 구분 없이 나무 문 (이름에 gate 가 있으면 철문)
        const gate = !!o && /gate|portcullis/i.test(o.type.name);
        const snd = ev.type === 'doorOpened' ? (gate ? 'object_door_gate_open' : 'object_door_wood_open') : gate ? 'object_door_gate_close' : 'object_door_wood_close';
        void s.play(snd, o ? { at: { x: o.x, y: o.y } } : {});
        break;
      }
      case 'barrelExploded':
        void s.play('object_barrel_explode', { at: { x: Number(ev.x), y: Number(ev.y) } });
        break;
      case 'shrine':
        void s.play('object_shrine_holy');
        break;
      case 'wellUsed':
        void s.play('object_well');
        break;
      case 'waypointActivated':
        void s.play('object_waypoint_open');
        break;
      case 'portalOpened':
        void s.play('player_townportal_cast');
        break;
      case 'portalTaken':
      case 'waypointTravel':
        void s.play('player_townportal_enter');
        break;
      case 'questCompleted':
        void s.play('cursor_questdone');
        break;
      case 'questSound': {
        const n = questPlayerSound(this.opts.cls, Number(ev.sound));
        if (n) void s.play(n);
        break;
      }
      case 'npcInteract':
        s.speak([npcGreetingSound(String(ev.typeId))]);
        break;
      case 'npcTalk': {
        const str = (k: string) => this.opts.tables.string(k) !== k;
        s.speak(npcGossipSound(String(ev.typeId), String(ev.gossip), this.opts.cls, !!ev.intro, Number(ev.pick), str));
        break;
      }
      case 'questSpeech':
        s.speak(questSpeechCandidates(String(ev.key), String(ev.typeId)));
        break;
      case 'questScroll':
        // 곰팡이 핀 책 (Narrator) — 출처: sounds.txt narrator_act1_q5_tome
        if (ev.key === 'A1Q5InitQuestTome') s.speak(['narrator_act1_q5_tome']);
        break;
      case 'npcClosed':
        s.stopSpeech();
        break;
      default:
        break;
    }
  }

  private itemCode(id: unknown): string | undefined {
    const st = this.game.store;
    const cur = st.cursor;
    if (cur && cur.id === id) return cur.code;
    for (const p of st.inv.items) if (p.item.id === id) return p.item.code;
    for (const b of st.belt) if (b && b.id === id) return b.code;
    for (const it of Object.values(this.game.equipment)) if (it?.id === id) return it.code;
    return undefined;
  }

  /** 플레이어 기본 공격: 무기 종류별 휘두르는 소리 */
  private swing(): void {
    const t = this.s.table;
    const rarm = this.game.equipment.rarm;
    const base = rarm ? this.opts.data.items.base(rarm.code) : undefined;
    const wclass = base?.wclass ?? 'hth';
    // 근사(원작 미확인): 큰 무기 = 인벤토리 높이 3 이상
    const large = (base?.invHeight ?? 0) >= 3;
    if (t) void this.s.play(weaponSwingSound(wclass, large), { delay: 0.15 });
  }

  /** 스냅숏 변화: 플레이어 발소리·피격, 몬스터 공격·중립 소리, 미사일 발사/명중 */
  private onState(snap: Readonly<WorldSnapshot>, t: Tables): void {
    const s = this.s;
    const p = snap.player;
    // 발소리: 근사(원작 미확인) — 원작은 걷기 애니메이션 발 딛는 프레임. 걷기 9틱·달리기 6틱마다
    if (p.mode === 'WL' || p.mode === 'RN' || p.mode === 'TW') {
      const every = p.mode === 'RN' ? 6 : 9;
      if (++this.stepTick >= every) {
        this.stepTick = 0;
        void s.play(footstepSound(this.env, this.steps++));
      }
    } else this.stepTick = 99;
    if (p.mode === 'GH' && this.prevPlayerMode !== 'GH') void s.play(`${this.cls}_hit_1`);
    this.prevPlayerMode = p.mode;

    const seen = new Set<number>();
    for (const m of snap.monsters) {
      seen.add(m.id);
      const prev = this.monModes.get(m.id);
      this.monModes.set(m.id, m.mode);
      if (m.npc || m.ally) continue;
      const ms = t.mon.of(m.typeId);
      if (!ms) continue;
      const at = { x: m.x, y: m.y };
      if (prev !== m.mode && (m.mode === 'A1' || m.mode === 'A2')) {
        const a2 = m.mode === 'A2';
        const snd = a2 ? ms.attack2 || ms.attack1 : ms.attack1;
        const del = (a2 ? ms.att2Del : ms.att1Del) / ENGINE_FPS;
        if (snd) void s.play(snd, { at, delay: del });
        const w = a2 ? ms.weapon2 : ms.weapon1;
        if (w) void s.play(w, { at, delay: del });
      }
      // 중립 소리: NeuTime 틱마다 한 번씩 (근사(원작 미확인): 원작은 무작위 간격)
      if (ms.neutral && (m.mode === 'NU' || m.mode === 'WL') && ms.neuTime > 0) {
        const due = this.neutralAt.get(m.id);
        if (due === undefined) this.neutralAt.set(m.id, snap.tick + (s.rollNext() % ms.neuTime));
        else if (snap.tick >= due) {
          this.neutralAt.set(m.id, snap.tick + ms.neuTime + (s.rollNext() % ms.neuTime));
          void s.play(ms.neutral, { at });
        }
      }
    }
    for (const id of [...this.monModes.keys()]) if (!seen.has(id)) {
      this.monModes.delete(id);
      this.neutralAt.delete(id);
    }

    // 미사일: 새로 생기면 TravelSound, 사라지면 HitSound (근사: 사라짐 = 명중/소멸)
    const now = new Map<number, { name: string; x: number; y: number }>();
    for (const m of snap.missiles) {
      now.set(m.id, { name: m.name, x: m.x, y: m.y });
      if (!this.missiles.has(m.id)) {
        const ms = t.missiles.of(m.name);
        if (ms?.travel) void s.play(ms.travel, { at: { x: m.x, y: m.y } });
      }
    }
    for (const [id, m] of this.missiles) if (!now.has(id)) {
      const ms = t.missiles.of(m.name);
      if (ms?.hit) void s.play(ms.hit, { at: { x: m.x, y: m.y } });
    }
    this.missiles = now;
  }

  /** SoundEnviron Day Event: Event Delay 틱마다 확률적으로 (근사(원작 미확인): 1/2 확률) */
  private ambientEvent(t: Tables): void {
    const env = this.env;
    if (!env || !env.dayEvent) return;
    if (--this.nextEvent > 0) return;
    this.nextEvent = env.eventDelay + (this.s.rollNext() % Math.max(1, env.eventDelay));
    if (this.s.rollNext() & 1) {
      const n = t.sounds.get(env.dayEvent)?.name;
      if (n) void this.s.play(n, { channel: 'sfx' });
    }
  }
}

/** 전역 하나 (게임이 바뀌어도 AudioContext·버퍼 캐시 유지) */
export const sound = new SoundSystem();

declare global {
  interface Window {
    /** e2e·디버그: 재생 기록·설정 */
    __audio?: SoundSystem;
  }
}

/** main.ts 연결 지점: 게임에 소리를 붙이고 떼어내기 함수를 돌려준다 */
export function attachSound(game: Game, opts: AttachOptions): () => void {
  if (import.meta.env.DEV) window.__audio = sound;
  return sound.attach(game, opts);
}
