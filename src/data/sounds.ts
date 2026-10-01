// 원작 사운드 표 (sounds.txt · SoundEnviron.txt · MonSounds.txt) 와 게임 사건 → 소리 이름 대응.
// 순수 데이터 모듈 (DOM·오디오 없음) — 재생은 src/audio/sound.ts.
// 출처: data\global\excel\sounds.txt (Sound, Index, FileName, Volume, Group Size, Loop, Fade In, Fade Out,
//       Defer Inst, Stop Inst, Compound, Falloff, Priority, Stream …) — Phrozen Keep "Sounds.txt" 파일 가이드
// 출처: SoundEnviron.txt (Song, Day/Night Ambience, Day/Night Event, Event Delay, Material 1/2), Levels.txt SoundEnv
// 출처: MonSounds.txt (Attack1/2, Att1Del, HitSound, DeathSound, Neutral, NeuTime, Footstep) ← MonStats.txt MonSound
// 출처: weapons/armor/misc.txt dropsound·dropsfxframe·usesound, skills.txt stsound·stsoundclass·dosound, Missiles.txt TravelSound·HitSound
import { num } from './tables';
import type { TxtRow } from '../formats/txt';

export interface SoundEntry {
  name: string;
  index: number;
  /** sounds.txt FileName (기본 디렉터리 기준 상대 경로) */
  file: string;
  /** 0~255 */
  volume: number;
  /** 첫 항목에만 값: 이어지는 N 개 중 무작위 하나 */
  groupSize: number;
  loop: boolean;
  /** 틱(1/25초) 단위 — 근사(원작 미확인): 단위를 게임 프레임으로 해석 */
  fadeIn: number;
  fadeOut: number;
  deferInst: boolean;
  stopInst: boolean;
  /** 같은 소리를 다시 낼 수 있는 최소 틱 간격 — 근사(원작 미확인) */
  compound: number;
  /** 0 = 위치 없음(UI), 1~4 = 거리 감쇠 등급 */
  falloff: number;
  priority: number;
  stream: boolean;
}

/** 원작 기본 디렉터리 후보 — FileName 은 이 중 하나 아래에 있다.
 *  근사(원작 미확인): 원작은 항목 종류로 디렉터리를 고르지만, 여기서는 MPQ 에 실제로 있는 첫 경로를 쓴다
 *  (sfx = d2sfx.mpq, 대사 = d2speech.mpq data\local\sfx, 음악 = d2music.mpq). */
export const SOUND_DIRS = ['data\\global\\sfx\\', 'data\\local\\sfx\\', 'data\\global\\music\\'] as const;

export class SoundTable {
  readonly byName = new Map<string, SoundEntry>();
  readonly byIndex: SoundEntry[] = [];

  constructor(rows: TxtRow[]) {
    for (const r of rows) {
      const name = r.Sound ?? '';
      const e: SoundEntry = {
        name,
        index: num(r.Index),
        file: r.FileName ?? '',
        volume: num(r.Volume, 255),
        groupSize: num(r['Group Size']),
        loop: r.Loop === '1',
        fadeIn: num(r['Fade In']),
        fadeOut: num(r['Fade Out']),
        deferInst: r['Defer Inst'] === '1',
        stopInst: r['Stop Inst'] === '1',
        compound: num(r.Compound),
        falloff: num(r.Falloff),
        priority: num(r.Priority),
        stream: r.Stream === '1',
      };
      this.byIndex[e.index] = e;
      if (name && !this.byName.has(name)) this.byName.set(name, e);
    }
  }

  get(nameOrIndex: string | number): SoundEntry | undefined {
    return typeof nameOrIndex === 'number' ? this.byIndex[nameOrIndex] : this.byName.get(nameOrIndex);
  }

  /** Group Size: 첫 항목부터 N 개 중 하나 (roll = 0 이상 정수). none.wav 는 무음 */
  pick(nameOrIndex: string | number, roll: number): SoundEntry | undefined {
    const e = this.get(nameOrIndex);
    if (!e) return undefined;
    const n = e.groupSize > 1 ? e.groupSize : 1;
    const v = this.byIndex[e.index + ((roll >>> 0) % n)] ?? e;
    return isSilent(v) ? undefined : v;
  }
}

export const isSilent = (e: SoundEntry): boolean => e.file === '' || e.file === '0' || e.file.toLowerCase() === 'none.wav';

/** FileName → 실제 MPQ 경로 (exists 로 후보 디렉터리 확인). 없으면 null */
export function resolveSoundPath(e: SoundEntry, exists: (path: string) => boolean): string | null {
  if (isSilent(e)) return null;
  for (const d of SOUND_DIRS) {
    const p = d + e.file;
    if (exists(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------- 레벨 환경 (음악·배경음·발소리 재질)

export interface SoundEnv {
  index: number;
  handle: string;
  /** sounds.txt Index (0 = 없음) */
  song: number;
  dayAmbience: number;
  nightAmbience: number;
  dayEvent: number;
  nightEvent: number;
  /** 틱 */
  eventDelay: number;
  indoors: boolean;
  materials: [number, number];
}

export class SoundEnvTable {
  readonly envs: SoundEnv[] = [];
  /** levels.txt Id → SoundEnv 번호 */
  readonly levelEnv = new Map<number, number>();

  constructor(soundEnviron: TxtRow[], levels: TxtRow[]) {
    for (const r of soundEnviron) {
      const e: SoundEnv = {
        index: num(r.Index),
        handle: r.Handle ?? '',
        song: num(r.Song),
        dayAmbience: num(r['Day Ambience']),
        nightAmbience: num(r['Night Ambience']),
        dayEvent: num(r['Day Event']),
        nightEvent: num(r['Night Event']),
        eventDelay: num(r['Event Delay'], 250),
        indoors: r.Indoors === '1',
        materials: [num(r['Material 1']), num(r['Material 2'])],
      };
      this.envs[e.index] = e;
    }
    for (const r of levels) {
      if (r.Id === undefined || r.Id === '') continue;
      this.levelEnv.set(num(r.Id), num(r.SoundEnv));
    }
  }

  forLevel(levelNo: number | undefined): SoundEnv | undefined {
    if (levelNo === undefined) return undefined;
    return this.envs[this.levelEnv.get(levelNo) ?? 0];
  }
}

/** 발소리 재질 번호 → sounds.txt 이름 조각.
 *  근사(원작 미확인): 재질 번호 뜻은 SoundEnviron 값 분포(마을 1·5, 동굴 1, 묘지 2, 수도원 1·3, 사막 4·3)로 추정 —
 *  1 흙, 2 실내 돌, 3 실외 돌, 4 모래, 5 나무, 6 눈. */
export const FOOT_MATERIAL: Record<number, string> = { 1: 'dirt', 2: 'istone', 3: 'ostone', 4: 'sand', 5: 'wood', 6: 'snow' };

/** 플레이어 발소리 이름 (light_walk_<재질>_1 묶음). 근사(원작 미확인): 갑옷 무게 대신 항상 light */
export function footstepSound(env: SoundEnv | undefined, step: number): string {
  const mats = (env?.materials ?? [1, 0]).filter((m) => m > 0);
  const m = mats.length ? (mats[(step >>> 0) % mats.length] ?? 1) : 1;
  return `light_walk_${FOOT_MATERIAL[m] ?? 'dirt'}_1`;
}

// ---------------------------------------------------------------- 몬스터

export interface MonSoundSet {
  attack1: string; attack2: string; weapon1: string; weapon2: string;
  /** 공격 소리 지연 (틱) */
  att1Del: number; att2Del: number;
  hit: string; death: string; hitDelay: number; deathDelay: number;
  neutral: string; neuTime: number; footstep: string;
}

export class MonsterSounds {
  private readonly sets = new Map<string, MonSoundSet>();
  private readonly monToSet = new Map<string, string>();

  constructor(monSounds: TxtRow[], monStats: TxtRow[]) {
    for (const r of monSounds) {
      const id = r.Id ?? '';
      if (!id) continue;
      this.sets.set(id, {
        attack1: r.Attack1 ?? '', attack2: r.Attack2 ?? '', weapon1: r.Weapon1 ?? '', weapon2: r.Weapon2 ?? '',
        att1Del: num(r.Att1Del), att2Del: num(r.Att2Del),
        hit: r.HitSound ?? '', death: r.DeathSound ?? '', hitDelay: num(r.HitDelay), deathDelay: num(r.DeaDelay),
        neutral: r.Neutral ?? '', neuTime: num(r.NeuTime), footstep: r.Footstep ?? '',
      });
    }
    for (const r of monStats) if (r.Id && r.MonSound) this.monToSet.set(r.Id, r.MonSound);
  }

  of(monstatsId: string): MonSoundSet | undefined {
    const s = this.monToSet.get(monstatsId);
    return s ? this.sets.get(s) : undefined;
  }
}

// ---------------------------------------------------------------- 아이템

export interface ItemSounds { drop: string; use: string; dropFrame: number }

export class ItemSoundTable {
  private readonly byCode = new Map<string, ItemSounds>();

  constructor(...tables: TxtRow[][]) {
    for (const t of tables) {
      for (const r of t) {
        const code = r.code ?? '';
        if (!code || this.byCode.has(code)) continue;
        this.byCode.set(code, { drop: r.dropsound ?? '', use: r.usesound ?? '', dropFrame: num(r.dropsfxframe) });
      }
    }
  }

  of(code: string): ItemSounds | undefined {
    return this.byCode.get(code);
  }
}

// ---------------------------------------------------------------- 스킬·미사일

export interface SkillSounds { start: string; startClass: string; startDelay: number; doSound: string }

export class SkillSoundTable {
  private readonly byId = new Map<number, SkillSounds>();
  constructor(skills: TxtRow[]) {
    for (const r of skills) {
      if (r.Id === undefined || r.Id === '') continue;
      this.byId.set(num(r.Id), { start: r.stsound ?? '', startClass: r.stsoundclass ?? '', startDelay: num(r.stsounddelay), doSound: r.dosound ?? '' });
    }
  }
  of(id: number): SkillSounds | undefined {
    return this.byId.get(id);
  }
}

export class MissileSoundTable {
  private readonly byName = new Map<string, { travel: string; hit: string }>();
  constructor(missiles: TxtRow[]) {
    for (const r of missiles) if (r.Missile) this.byName.set(r.Missile, { travel: r.TravelSound ?? '', hit: r.HitSound ?? '' });
  }
  of(name: string): { travel: string; hit: string } | undefined {
    return this.byName.get(name);
  }
}

/** 무기 휘두르는 소리 (wclass → sounds.txt 묶음).
 *  근사(원작 미확인): 원작은 애니메이션 공격 프레임 이벤트에서 무기 종류별 소리를 낸다 — 표는 sounds.txt weapon_* 이름으로 맞춤. */
export function weaponSwingSound(wclass: string, large: boolean): string {
  switch (wclass.toLowerCase()) {
    case '1hs': return large ? 'weapon_1hs_large_1' : 'weapon_1hs_small_1';
    case '2hs': return large ? 'weapon_2hs_large_1' : 'weapon_2hs_small_1';
    case '1ht': return 'weapon_1ht_1';
    case '2ht': return 'weapon_2ht_1';
    case 'stf': return 'weapon_staff_1';
    case 'bow': return 'weapon_bow_1';
    case 'xbw': return 'weapon_xbow_1';
    case 'ht1': case 'ht2': return 'weapon_throw_1';
    default: return 'weapon_punch_1';
  }
}

// ---------------------------------------------------------------- 오브젝트

/** objects.txt OperateFn → 여는 소리.
 *  근사(원작 미확인): objects.txt 에 소리 칸이 없다(원작은 D2Client 오브젝트 함수에 내장). sounds.txt object_* 이름을 기능별로 골랐다. */
export function objectOpenSound(operateFn: number, name: string): string | null {
  const n = name.toLowerCase();
  switch (operateFn) {
    case 1: return 'object_casket';
    case 2: return 'object_shrine_holy';
    case 3: return n.includes('basket') ? 'object_basket_1' : 'object_urn_break_1';
    case 4: case 39: case 40: case 41: case 57: case 58: case 59:
      return n.includes('large') || n.endsWith('l') || n.endsWith('r') ? 'object_chest_large' : 'object_chest_small';
    case 5: return 'object_urn_break_1';
    case 6: case 26: return 'object_bookshelf';
    case 8: case 18: case 29: return n.includes('gate') ? 'object_door_gate_open' : 'object_door_wood_open';
    case 14: return n.includes('corpse') || n.includes('body') || n.includes('dead') ? 'object_corpse_loot' : 'object_urn_break_1';
    case 19: case 20: return 'object_armorstand';
    case 21: return 'object_malus';
    case 22: return 'object_well';
    default: return null;
  }
}

// ---------------------------------------------------------------- 캐릭터

/** 클래스 이름 → sounds.txt 접두사 (barbarian_hit_1 …) */
export const classPrefix = (cls: string): string => cls.toLowerCase();

/** 퀘스트 사건 questSound 번호 → 플레이어 목소리.
 *  근사(원작 미확인): D2MOO QUESTS 의 nSound 는 클라이언트 표 번호. 19 는 "할 수 없다" 로 쓰이는 자리(레벨 8 미만 Malus 등)라 impossible 로 둔다. */
export function questPlayerSound(cls: string, sound: number): string | null {
  if (sound === 19) return `${classPrefix(cls)}_impossible_1`;
  return null;
}

// ---------------------------------------------------------------- NPC 대사

/** monstats Id → sounds.txt NPC 접두사 */
export function npcSoundName(typeId: string): string {
  const t = typeId.toLowerCase();
  if (t.startsWith('cain')) return 'cain';
  if (t.startsWith('warriv')) return 'warriv';
  if (t === 'izualghost') return 'izual';
  // 근사(원작 미확인): sounds.txt 에 jamella_young / jamella_old 둘 다 있다. 클래식 Act 4 Jamella 는 young 으로 둔다
  if (t === 'jamella') return 'jamella_young';
  return t.replace(/\d+$/, '');
}

/** string.tbl 퀘스트 대사 키 끝의 NPC 이름 (긴 것 먼저) */
const QUEST_NPC = /(CharsiMain|WarrivAct2|MeshifAct3|CainAct3|Akara|Kashya|Charsi|Gheed|Warriv|Cain|Atma|Greiz|Griez|Elzix|Drognan|Lysander|Meshif|Geglash|Jerhyn|Fara|Alkor|Ormus|Asheara|Hratli|Natalya|Tyrael|Izual)$/;

const QUEST_STATE: [RegExp, string][] = [
  // Act 2~4 특수 상태 (A2Q2 Cain 조각별, A3Q2 Cain 유물별, A3Q4 Init1~3, A4Q3 영혼석)
  [/^EarlyReturn(Scroll|Cap|Stave|Cube)$/, 'early_$1'],
  [/^EarlyReturn(Brain|Eye|Flail|Heart)$/, 'early$1'],
  [/^SuccessfulStaff$/, 'success'],
  [/^Reward$/, 'success_reward'],
  [/^InitHasStone$/, 'init_has_stone'],
  [/^InitNoStone$/, 'init_no_stone'],
  [/^Init[123]$/, 'init'],
  [/^AfterInitScroll$/, 'after_scroll'],
  [/^AfterInit$/, 'after'],
  [/^EarlyReturnS$/, 'early_scroll'],
  [/^EarlyReturn2?$/, 'early'],
  [/^SuccessfulScroll$/, 'success_scroll'],
  [/^(Quest)?Successful$/, 'success'],
  [/^Init$/, 'init'],
  [/^Instructions$/, 'instructions'],
  [/^TragedyOfTristram$/, 'tragedy'],
  [/^RescuedByHero$/, 'rescued_hero'],
  [/^RescuedByRogues$/, 'rescued_rogues'],
];

/** 퀘스트 대사 string.tbl 키 → sounds.txt 대사 이름 후보 (앞쪽 우선).
 *  예: A1Q1InitAkara → akara_act1_q1_init, A1Q4SuccessfulScrollKashya → kashya_act1_q4_success_scroll,
 *      A3Q5AfterInitMeshifAct3VA → meshif_act3_q5_after_va, A2Q2EarlyReturnCapCain → cain_act2_q2_early_cap
 *  근사(원작 미확인): 원작은 D2Client 대사 표(문자열 번호 ↔ 소리 번호). 여기서는 키 이름 규칙으로 맞춘다. */
export function questSpeechCandidates(key: string, typeId: string): string[] {
  const m = /^A(\d)Q(\d)(.*)$/.exec(key);
  if (!m) return [];
  const [, act, q] = m as unknown as [string, string, string];
  // Lam Esen·Khalim 을 끝내지 않은 상태의 대사 (…VA) → _va
  let rest = m[3]!;
  const va = rest.endsWith('VA');
  if (va) rest = rest.slice(0, -2);
  const who = QUEST_NPC.exec(rest);
  if (!who) return [];
  const state = rest.slice(0, who.index);
  const npc = npcSoundName(typeId);
  for (const [re, s] of QUEST_STATE) {
    if (!re.test(state)) continue;
    const name = state.replace(re, s).toLowerCase();
    const base = `${npc}_act${act}_q${q}_${name}${va ? '_va' : ''}`;
    const out = [base];
    // VA 소리가 없으면 기본 상태로
    if (va) out.push(`${npc}_act${act}_q${q}_${name}`);
    // 두루마리 변형이 없으면 기본 상태로 (예: gheed_act1_q4_after)
    const plain = name.replace(/_scroll$/, '');
    if (plain !== name && s.endsWith('_scroll')) out.push(`${npc}_act${act}_q${q}_${plain}`);
    // A3Q2 Cain 완료는 sounds.txt 에 successful 로 적혀 있다
    if (name === 'success') out.splice(1, 0, `${npc}_act${act}_q${q}_successful`);
    return out;
  }
  return [];
}

/** NPC 인사 (말 걸기 시작). sounds.txt <npc>_greeting_1 묶음 (Izual 은 izual_greeting 하나) */
export const npcGreetingSound = (typeId: string): string[] => [`${npcSoundName(typeId)}_greeting_1`, `${npcSoundName(typeId)}_greeting`];

/** 잡담/소개 대사. 순서 규칙은 ui/npcpanel.ts pickGossip 과 같다 (string.tbl <Npc>Gossip1..12 중 pick 번째 → 같은 번호의 소리).
 *  intro 면 클래스별 소개 (akara_act1_intro_sor 등) 가 있으면 그것, 없으면 act1_intro. */
export function npcGossipSound(typeId: string, gossipPrefix: string, cls: string, intro: boolean, pick: number, hasString: (k: string) => boolean, act = 1): string[] {
  const npc = npcSoundName(typeId);
  const ab = ({ Amazon: 'ama', Sorceress: 'sor', Necromancer: 'nec', Paladin: 'pal', Barbarian: 'bar', Druid: 'dru', Assassin: 'ass' } as Record<string, string>)[cls] ?? '';
  if (intro) return [`${npc}_act${act}_intro_${ab}`, `${npc}_act${act}_intro`];
  const nums: number[] = [];
  for (let i = 1; i <= 12; i++) if (hasString(`${gossipPrefix}Gossip${i}`)) nums.push(i);
  if (!nums.length) return [];
  return [`${npc}_act${act}_gossip_${nums[(pick >>> 0) % nums.length]}`];
}
