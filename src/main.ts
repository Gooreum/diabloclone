// 브라우저 진입점: 원작 MPQ 로드 → 메인메뉴 → (새 캐릭터 | 불러오기) → 게임(마을·Blood Moor) → Save and Exit → 메뉴.
import { gfxEvents, healGraphics, spriteCache } from './render/sprites';
import { AssetLoader } from './assets/loader';
import { editionOf, mpqOrder, soundMpqs, type Edition } from './assets/edition';
import { blobRange, MpqStore } from './assets/local-mpq';
import { httpRange, type RangeFetcher } from './assets/remote';
import { loadGameData } from './assets/gamedata-loader';
import { buildGameData, withDifficulty } from './data/gamedata';
import { parsePalette, type Palette } from './formats/palette';
import { AnimData } from './formats/animdata';
import { actLevels, actPalettePath, actWorldPaths, buildActWorld, levelKey, WORLD_TABLES, type ActWorld, type WorldLevel } from './data/world';
import { actAvailable, actCount } from './engine/drlg/acts';
import type { GameTables } from './data/tables';
import { CLASS_TOKEN, Game, type GameData } from './engine/game';
import { ENGINE_FPS } from './engine/index';
import { classStats, createCharacter, expTable, isExpansionClass, type ClassName } from './engine/player';
import { QUALITY, type ItemInstance } from './engine/treasure';
import { Rng } from './engine/rng';
import { FEMALE, makeSave, mergeDifficulty, parseSave, startActFor, summarize, type CharacterSave } from './engine/save';
import { heroTitle, type Difficulty } from './engine/difficulty';
import { questNameKey } from './engine/quests/messages-acts';
import { characterOwner } from './engine/skills/rules';
import { WorldRenderer } from './render/world';
import { Canvas2dSink, type SpriteSink } from './render/sink';
import { GlSink, glStats } from './render/gl/glsink';
import { buildLightMap, type LightMap } from './render/lightmap';
import { Rain, weatherKind } from './render/weather';
import { FULL_LIGHT, LightTables, PLAYER_LIGHT, ambientOf, lightSources } from './engine/lighting';
import { parsePl2Light } from './formats/pl2';
import { type Camera } from './render/iso';
import { gfxBusy, ItemGfx, MissileGfx, UnitGfx, unitGfxStats } from './render/units';
import { buildScene, warmLevel } from './render/scene';
import { InputController } from './input/dom';
import { Menu } from './ui/menu';
import { HeroStore } from './ui/storage';
import { ensureLocalMpqs } from './ui/mpq-setup';
import { ControlPanel, type HudAction, type HudState } from './ui/hud';
import { Panels } from './ui/panels';
import { SkillTree } from './ui/skillpanel';
import { CharPanel } from './ui/charpanel';
import { StashPanel } from './ui/stashpanel';
import { CubePanel } from './ui/cubepanel';
import { UiArt } from './ui/art';
import { d2text, drawText } from './ui/text';
import { ItemText } from './ui/itemtext';
import { drawTooltip, InventoryPanel, ItemIcons, parseInvLayout } from './ui/invpanel';
import { itemClassCode, playerWclass, requirements } from './engine/inventory';
import { CLASS_CODE } from './engine/skills/db';
import { playerLayers } from './render/appearance';
import type { Placed } from './engine/inventory';
import { AutomapTable } from './engine/automap';
import { SUBCLASS } from './engine/objects';
import { waypointLevels } from './engine/waypoints';
import { AutomapRenderer, type AutomapMode } from './render/automap';
import { WaypointPanel } from './ui/waypanel';
import { drawMonsterBar, drawNameBar, MonsterNamer } from './ui/monbar';
import { StorePanel } from './ui/storepanel';
import { HirePanel, NpcMenu, pickGossip, stripSpeed, TalkBox } from './ui/npcpanel';
import { QuestPanel } from './ui/questpanel';
import { MERC_BAR, MercBar } from './ui/mercbar';
import { ConfirmBox, MercPanel } from './ui/mercpanel';
import { attachSound } from './audio/sound';
import { sound } from './audio/sound';
import { GameCursor, CURSOR_ART } from './ui/cursor';
import { LoadingScreen } from './ui/loading';
import { GoldPopup } from './ui/goldpopup';
import { MessageLog } from './ui/messages';
import { drawGroundLabels, type GroundLabel } from './ui/groundlabels';
import { keyBindings, SKILL_SLOTS, type SkillSlot } from './ui/keys';
import { SkillTip } from './ui/skilltip';
import { QUALITY_COLOR } from './ui/itemtext';
import type { Hover } from './input/mapper';

const WIDTH = 800, HEIGHT = 600;
// 막 팔레트 (원작 data\global\palette\ACT1~4\pal.dat) — 시작 화면·UI 는 Act 1 팔레트
const PALETTE = actPalettePath(0);
const ANIMDATA = 'data\\global\\AnimData.d2';
// 캐릭터 외형 (방어구 없음 = lit). 무기/방패 레이어는 장착 아이템 코드로 결정
// 출처: Phrozen Keep COF 문서 — 레이어 HD 머리, TR 몸통, LG 다리, RA/LA 팔, RH 오른손 무기, LH 왼손(활), SH 방패, S1/S2 어깨
const BODY = { HD: 'lit', TR: 'lit', LG: 'lit', RA: 'lit', LA: 'lit', S1: 'lit', S2: 'lit' };

declare global {
  interface Window {
    __game?: {
      game: Game; ready: boolean; input?: InputController; save?: () => Promise<void>;
      /** e2e: 웨이포인트 패널·자동 지도 상태 */
      ui?: {
        waypoint: WaypointPanel; automap: () => AutomapMode; automapReady: () => boolean; automapDrawn: () => number; hoverMonster: () => { id: number; name: string; box: { x: number; y: number; w: number; h: number } } | null; camera: () => Camera;
        /** e2e: NPC 메뉴·상점·고용 목록·대사·용병 막대 */
        store: StorePanel; npcMenu: NpcMenu; hire: HirePanel; talk: TalkBox; mercBar: MercBar; inventory: InventoryPanel;
        /** e2e: 아이템 툴팁 줄 */
        itemText: ItemText;
        /** e2e: 퀘스트 로그 패널 (Q) */
        quest: QuestPanel;
        /** e2e: 비 (levels.txt Rain) */
        rain: Rain;
        /** e2e: 원작 DC6 컨트롤 패널·캐릭터(C)·스킬 트리(T)·보관함·게임 메뉴 */
        hud: ControlPanel; charPanel: CharPanel; skillTree: SkillTree; stash: StashPanel; gameMenu: Panels; art: UiArt;
        /** e2e (Phase 6): 호라드릭 큐브 창 */
        cube: CubePanel;
        /** e2e (확장팩): 용병 창 (O) · 고용 교체 확인 */
        merc: MercPanel; hireConfirm: ConfirmBox;
        /** e2e (Phase 12 Step 2): 금화 창·메시지·커서·로딩·바닥 이름표·가리킨 유닛 */
        gold: GoldPopup; messages: MessageLog; cursor: GameCursor; loading: LoadingScreen; labels: () => GroundLabel[]; hover: () => Hover; altHeld: () => boolean;
      };
      /** e2e·진단: 다음 프레임의 화면 (WebGL 월드 + UI 합성) */
      capture?: () => Promise<ImageData>;
    };
    __menuReady?: boolean;
    /** e2e: 프런트엔드 그림을 다 읽었는가 */
    __menuArtReady?: () => boolean;
    /** e2e: 원작 커서·메뉴 (캐릭터 선택 스크롤) */
    __cursor?: GameCursor;
    __menu?: Menu;
    /** e2e: 캐릭터 저장소 (난이도 해금 등 저장 필드 조작) */
    __heroStore?: typeof HeroStore;
    __edition?: Edition;
  }
}

interface Shared {
  /** 설치 판본 (확장팩 캐릭터를 만들 수 있나, 800 조작판 그림이 있나) */
  edition: Edition;
  /** 캐릭터 판본별 데이터 (확장팩 캐릭터 = 확장팩 아이템 규칙). 확장팩용은 처음 쓸 때 만든다 */
  dataFor(expansion: boolean): GameData;
  assets: AssetLoader; data: GameData; tables: GameTables; pal: Palette; anim: AnimData; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; host: HTMLElement; stage: HTMLElement; art: UiArt; loading: LoadingScreen; cursor: GameCursor;
  /** 월드(타일·유닛·미사일) 캔버스와 그리기 출구 — UI 캔버스(#game) 아래 */
  worldCanvas: HTMLCanvasElement; worldSink: SpriteSink;
  /** DS1/DT1·팔레트를 미리 읽은 막 (막 월드는 이 막만 동기로 만들 수 있다) */
  prefetched: Set<number>;
}

/** 막 월드가 읽는 원작 파일 (DS1/DT1·막 팔레트) 미리 읽기. 출처: 원작도 막에 들어갈 때 그 막 DRLG 를 할당 (DRLG_AllocDrlg) */
const prefetching = new Map<number, Promise<void>>();
function prefetchAct(sh: Pick<Shared, 'assets' | 'tables' | 'prefetched'>, act: number, background = false): Promise<void> {
  if (sh.prefetched.has(act) || !actAvailable(act)) return Promise.resolve();
  let p = prefetching.get(act);
  if (!p) {
    const paths = [...actWorldPaths(sh.assets, sh.tables, act), actPalettePath(act)];
    p = (background ? preloadGently(sh.assets, paths) : sh.assets.preload(paths)).then(() => {
      sh.prefetched.add(act);
    });
    prefetching.set(act, p);
  }
  return p;
}

/** 배경 미리 읽기: 한 번에 몇 개씩만 읽는다 (막 파일 수백 개가 브라우저 연결을 다 차지해 몬스터 그림 같은 지금 필요한 파일이 밀리지 않게) */
async function preloadGently(assets: AssetLoader, paths: string[], lanes = 2): Promise<void> {
  let i = 0;
  const lane = async () => {
    while (i < paths.length) await assets.load(paths[i++] as string);
  };
  await Promise.all(Array.from({ length: lanes }, lane));
}

// dev 전용: 오류를 개발 서버 로그로 보낸다 (vite.config.ts clientErrorLog)
function reportClientError(kind: string, e: unknown): void {
  if (!import.meta.env.DEV) return;
  const text = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  void fetch('/__clientlog', { method: 'POST', body: `[${kind}] ${location.href} ${text}` }).catch(() => undefined);
}
window.addEventListener('error', (e) => reportClientError('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportClientError('rejection', e.reason));

/**
 * 원작 MPQ 를 어디서 읽나: dev 서버는 로컬 game-data/ 를 /d2/ (클래식)·/d2x/ (확장팩: game-data/lod 우선) 로 서빙,
 * 배포판(또는 ?local)은 유저가 고른 파일(브라우저 보관). 판본은 파일로 정한다 — d2exp.mpq 가 있으면 확장팩 (dev 는 ?edition=classic 로 클래식)
 */
async function mpqSource(host: HTMLElement): Promise<{ base: string; fetch: RangeFetcher; local: boolean; edition: Edition }> {
  const q = new URLSearchParams(location.search);
  if (import.meta.env.DEV && !q.has('local')) {
    const lod = q.get('edition') !== 'classic' && (await fetch('/d2x/d2exp.mpq', { method: 'HEAD' }).then((r) => r.ok, () => false));
    return lod ? { base: '/d2x/', fetch: httpRange, local: false, edition: 'lod' } : { base: '/d2/', fetch: httpRange, local: false, edition: 'classic' };
  }
  const files = await ensureLocalMpqs(host);
  return { base: 'local/', fetch: blobRange(files), local: true, edition: editionOf(files.keys()) };
}

/** 800×600 무대를 창 크기에 맞춰 키운다 (비율 유지, 가운데). 게임 안 좌표는 그대로 800×600 — 입력은 화면 크기에서 환산 */
function fitStage(stage: HTMLElement): void {
  const s = Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);
  Object.assign(stage.style, {
    position: 'absolute', transformOrigin: '0 0', transform: `scale(${s})`,
    left: `${Math.round((innerWidth - WIDTH * s) / 2)}px`, top: `${Math.round((innerHeight - HEIGHT * s) / 2)}px`,
  });
}

async function boot(): Promise<void> {
  const host = document.getElementById('app') as HTMLElement;
  const src = await mpqSource(host);
  const canvas = document.createElement('canvas');
  // 브라우저가 그래픽 메모리를 회수해 컨텍스트를 잃었다 되찾으면 만들어 둔 그림이 모두 비므로 캐시를 버린다
  canvas.addEventListener('contextrestored', () => {
    spriteCache.clear();
    healGraphics();
  });
  // 탭으로 돌아오면 숨겨진 동안 버려진 그림(조작판·커서 등)이 있는지 보고 다시 그린다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') healGraphics();
  });
  healGraphics();
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.id = 'game';
  // 월드는 아래 캔버스에 WebGL2 로 (팔레트 번호 텍스처), UI 는 위 캔버스(#game)에 2D 로 겹쳐 그린다. 입력은 위 캔버스가 받는다
  const worldCanvas = document.createElement('canvas');
  worldCanvas.width = WIDTH;
  worldCanvas.height = HEIGHT;
  worldCanvas.id = 'world';
  Object.assign(worldCanvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', visibility: 'hidden' });
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0' });
  // 캔버스와 그 위의 투명 UI 단추 층을 같은 800×600 무대에 둔다
  const stage = document.createElement('div');
  stage.id = 'stage';
  Object.assign(stage.style, { position: 'relative', width: `${WIDTH}px`, height: `${HEIGHT}px` });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.append(worldCanvas, canvas);
  host.replaceChildren(stage);
  fitStage(stage);
  addEventListener('resize', () => fitStage(stage));
  document.addEventListener('fullscreenchange', () => fitStage(stage));
  // 원작처럼 Alt+Enter 로 전체 화면 켜고 끄기
  addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.altKey) return;
    e.preventDefault();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, true);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#c7b377';
  ctx.font = '16px serif';
  ctx.fillText('Loading...', 20, 30);

  let assets: AssetLoader;
  try {
    assets = await AssetLoader.open(src.base, src.fetch, undefined, mpqOrder(src.edition));
  } catch (e) {
    // 보관한 파일이 깨졌거나 브라우저가 지웠으면 비우고 다시 고르게 한다
    if (src.local) {
      await MpqStore.clear();
      location.reload();
    }
    throw e;
  }
  await assets.preload([PALETTE, ANIMDATA, ...WORLD_TABLES.map((t) => `data\\global\\excel\\${t}.txt`), 'data\\local\\lng\\eng\\string.tbl', 'data\\local\\lng\\eng\\expansionstring.tbl', 'data\\local\\lng\\eng\\patchstring.tbl']);
  const { data, tables } = await loadGameData(assets);
  // Act 1 월드 DRLG 가 읽는 원작 DS1/DT1 (LvlPrest·LvlSub·LvlTypes). 다른 막은 그 막에 갈 때·게임 시작 때 배경으로
  await assets.preload(actWorldPaths(assets, tables, 0));
  const gamePal = parsePalette(assets.read(PALETTE) as Uint8Array);
  // 원작 글꼴 (DC6 + .tbl) 과 글자 색 표 (Pal.PL2), 프런트엔드 팔레트 (타이틀·캐릭터 선택 = Sky, 캐릭터 만들기 = fechar)
  const [skyPal, fecharPal, loadingPal] = await Promise.all(['Sky', 'fechar', 'loading'].map(async (d) => {
    const b = await assets.load(`data\\global\\palette\\${d}\\pal.dat`);
    return b ? parsePalette(b) : gamePal;
  })) as [Palette, Palette, Palette];
  await d2text.load(assets, gamePal);
  // 원작 커서 (OS 커서 숨김) · 로딩 화면 (팔레트 loading)
  const cursor = new GameCursor();
  const loading = new LoadingScreen(new UiArt(assets, loadingPal));
  const anim = AnimData.parse(assets.read(ANIMDATA) as Uint8Array);
  // WebGL2 를 못 쓰면 예전처럼 2D 캔버스로 그린다
  const worldSink: SpriteSink = GlSink.create(worldCanvas) ?? new Canvas2dSink(worldCanvas.getContext('2d') as CanvasRenderingContext2D, gamePal);
  let lodData: GameData | null = null;
  const dataFor = (expansion: boolean): GameData => (expansion ? (lodData ??= buildGameData(assets, tables, { expansion: true })) : data);
  const shared: Shared = { edition: src.edition, dataFor, assets, data, tables, pal: gamePal, anim, canvas, ctx, host, stage, art: new UiArt(assets, gamePal), loading, cursor, prefetched: new Set([0]), worldCanvas, worldSink };
  void shared.art.preload(CURSOR_ART);

  const menu = new Menu(stage, ctx, new UiArt(assets, skyPal), new UiArt(assets, fecharPal));
  menu.edition = src.edition;
  window.__menuArtReady = () => menu.ready && shared.art.ready(CURSOR_ART);
  menu.overlay = (c, m, now) => cursor.draw(c, shared.art, m, cursor.pick({ holding: false }), now);
  if (import.meta.env.DEV) {
    window.__cursor = cursor;
    window.__menu = menu;
    window.__heroStore = HeroStore;
    window.__edition = src.edition;
  }
  // 캐릭터 선택 칸 영웅 그림: 저장된 장비로 게임 속 COF 합성 (서 있기 NU, 앞(아래)을 봄 = 64방향 0)
  const figGfx = new UnitGfx(assets);
  const figSink = new Canvas2dSink(ctx, gamePal);
  const looks = new Map<string, { token: string; wclass: string; equip: Record<string, string> }>();
  menu.heroFigure = (c, name, x, y, now) => {
    const lk = looks.get(name);
    if (!lk) return false;
    const comp = figGfx.get({ root: 'CHARS', token: lk.token, mode: 'NU', wclass: lk.wclass, equip: lk.equip });
    if (!comp) return false;
    const r = anim.get(`${lk.token}NU${lk.wclass}`);
    const frame = r ? Math.floor(((now / 40) * r.speed) / 256) : 0;
    figGfx.draw(figSink.target(c), comp, 0, frame, x, y);
    return true;
  };
  const listHeroes = async () => {
    const saves = await HeroStore.saves();
    looks.clear();
    for (const sv of saves) {
      const eq = sv.equipment;
      // 확장팩 캐릭터는 확장팩 아이템 표 (손톱·가죽 투구 등)
      const d = dataFor(sv.expansion === true && src.edition === 'lod');
      const wclass = playerWclass(d.items, eq);
      looks.set(sv.name, { token: CLASS_TOKEN[sv.character.cls], wclass, equip: { ...BODY, ...playerLayers(d.items, eq) } });
    }
    return saves.map(summarize).sort((a, b) => b.savedAt - a.savedAt);
  };
  // 프런트엔드 소리: 메뉴 음악 (sounds.txt music_options = music\common\options.wav), 클래스 고르기 소리 (cursor_<클래스>_select)
  let inMenu = true, soundReady = false;
  menu.onSound = (n) => void sound.play(n);
  sound.bindUnlock();
  void sound.init({ assets, tables, data, cls: '', baseUrl: src.base, fetchRange: src.fetch, soundMpqs: soundMpqs(src.edition) }).then(() => {
    soundReady = true;
    if (inMenu) sound.setMusic('music_options');
  }).catch(() => undefined);
  if (import.meta.env.DEV) window.__audio = sound;
  // 99레벨 프리셋 캐릭터 (src/presets, scripts/gen-presets.ts): 처음 열면 캐릭터 목록에 5개.
  // ?preset=<직업> 은 그 프리셋으로 덮어써 메뉴를 건너뛰고 Hell 로 바로, ?preset=all 은 5개를 덮어쓴다
  await addMissingPresets();
  let presetStart = await installPresets(new URLSearchParams(location.search).get('preset'));
  for (;;) {
    window.__menuReady = true;
    inMenu = true;
    // 표를 읽기 전에 부르면 이름만 남고 재생되지 않으므로 준비된 뒤에만
    if (soundReady) sound.setMusic('music_options');
    const choice = presetStart ? ({ kind: 'load', name: presetStart, difficulty: 2 } as const) : await menu.run(listHeroes);
    presetStart = null;
    inMenu = false;
    window.__menuReady = false;
    menu.hide();
    const save = choice.kind === 'load' ? await HeroStore.load(choice.name) : null;
    const cls: ClassName = save?.character.cls ?? (choice.kind === 'new' ? choice.cls : 'Barbarian');
    // Phase 8: 고른 난이도 (난이도 창 — 새 캐릭터·해금 전은 Normal). 해금보다 높은 값은 받지 않는다
    const difficulty = (choice.kind === 'load' ? Math.min(choice.difficulty ?? 0, save?.difficultyUnlocked ?? 0) : 0) as Difficulty;
    // 그 난이도의 마지막 막 마을에서 시작 (그 막 월드가 아직 없으면 Act 1). 그 막 파일은 로딩 전에 미리 읽는다
    const startAct = startActFor(save, difficulty);
    // 확장팩 캐릭터: 저장에 적힌 값, 새 캐릭터는 만들기 화면의 체크 (확장팩 판본에서만)
    // 확장팩 직업(드루이드·어쌔신)은 늘 확장팩 캐릭터 (원작 LoD)
    const expansion = save ? save.expansion === true || isExpansionClass(save.character.cls) : choice.kind === 'new' && (choice.expansion === true || isExpansionClass(choice.cls)) && shared.edition === 'lod';
    if (save && actAvailable(startAct)) await prefetchAct(shared, startAct);
    // 원작: 게임을 시작하면 로딩 화면 (월드 만들기 동안)
    const game = await loading.around(ctx, () => play(shared, choice.name, cls, save, difficulty, expansion));
    await game;
  }
}

// 프리셋 세이브는 배포판에도 들어간다: 아이템 코드·수치뿐 (원작 그림·소리·MPQ 없음)
const PRESET_FILES: Record<string, () => Promise<unknown>> = import.meta.glob('./presets/*.json', { import: 'default' });
// 프리셋 내용이 바뀌면 키 버전을 올린다 (v2: 스킬 모두 20·스탯 1000) — 새 버전을 처음 열면 같은 이름 캐릭터를 한 번 덮어쓴다
const PRESETS_KEY = 'd2clone.presets.v2';

/** 이 버전에서 아직 넣은 적 없는 프리셋을 캐릭터 목록 맨 아래에 (그 뒤로 지우거나 플레이한 프리셋은 다시 덮지 않는다) */
async function addMissingPresets(): Promise<void> {
  let done: string[] | null;
  try {
    done = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]') as string[];
  } catch {
    done = null;
  }
  const have = new Set((await HeroStore.list()).map((h) => h.name));
  for (const load of Object.values(PRESET_FILES)) {
    const s = parseSave(JSON.stringify(await load()));
    if (done ? done.includes(s.name) : have.has(s.name)) continue;
    await HeroStore.save({ ...s, savedAt: 1 });
    done?.push(s.name);
  }
  try {
    if (done) localStorage.setItem(PRESETS_KEY, JSON.stringify(done));
  } catch {
    // 기록을 못 남기면 다음에도 이름으로만 비교한다
  }
}

/** 프리셋 세이브를 캐릭터 저장소에 넣는다 (같은 이름은 덮어씀). 바로 시작할 캐릭터 이름 (all·없는 직업이면 null) */
async function installPresets(id: string | null): Promise<string | null> {
  if (!id) return null;
  const files = PRESET_FILES;
  const keys = id === 'all' ? Object.keys(files) : [`./presets/${id}.json`];
  let name: string | null = null;
  for (const k of keys) {
    const load = files[k];
    if (!load) {
      console.warn(`[preset] 없는 프리셋: ${id} (amazon, sorceress, necromancer, paladin, barbarian, all)`);
      continue;
    }
    const s = parseSave(JSON.stringify(await load()));
    await HeroStore.save({ ...s, savedAt: Date.now() });
    name = s.name;
  }
  return id === 'all' ? null : name;
}

/** 한 판 진행. Save and Exit 하면 resolve */
function play(sh: Shared, name: string, cls: ClassName, save: CharacterSave | null, difficulty: Difficulty = 0, expansion = false): Promise<void> {
  // 난이도 판 표 (monstats (N)/(H), SuperUniques TC(N), levels MonLvl2/3·상자 TC) — 월드 만들기와 Game 이 같이 쓴다. 확장팩 캐릭터는 확장팩 판
  const data = withDifficulty(sh.dataFor(expansion), difficulty);
  const { tables, assets, pal, anim, canvas, ctx, stage, art, loading, cursor, worldCanvas, worldSink } = sh;
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const renderers: Record<string, WorldRenderer> = {};
  // HUD 레벨 이름: levels.txt LevelName → 원작 문자열
  const levelNames: Record<string, string> = {};
  const worldByKey = new Map<string, WorldLevel>();
  // 막별 월드·그림 (막 팔레트로 타일·유닛·아이템·미사일). 막에 처음 들어갈 때 만든다 (출처: D2MOO DRLG_AllocDrlg — 막 단위)
  /** light = 막 Pal.PL2 밝기 단계 표 (읽기 전에는 null — 조명 없이 그린다) */
  interface ActView { world: ActWorld; pal: Palette; units: UnitGfx; itemGfx: ItemGfx; missileGfx: MissileGfx; light: Uint8Array | null }
  const views = new Map<number, ActView>();
  const actView = (act: number): ActView => {
    const have = views.get(act);
    if (have) return have;
    // 원작 DRLG 이식: 게임 시드로 막 월드 생성
    const w = buildActWorld(assets, tables, data, seed, act);
    let apal = pal;
    if (act !== 0) {
      const b = assets.read(actPalettePath(act));
      if (b) apal = parsePalette(b);
    }
    for (const l of w.levels) {
      renderers[l.key] = new WorldRenderer(l.preset);
      levelNames[l.key] = l.name;
      worldByKey.set(l.key, l);
    }
    const v: ActView = { world: w, pal: apal, units: new UnitGfx(assets), itemGfx: new ItemGfx(assets), missileGfx: new MissileGfx(assets), light: null };
    void assets.load(`data\\global\\palette\\ACT${act + 1}\\Pal.pl2`).then((b) => {
      if (b) v.light = parsePl2Light(b);
    }).catch(() => undefined);
    views.set(act, v);
    return v;
  };
  // 조명: 원작 표 (levels IsInside · monstats2 Light/Shadow · missiles Light · objects Lit)
  const lightTables = new LightTables({ levels: tables.table('Levels'), monStats: tables.table('MonStats'), monStats2: tables.table('MonStats2'), missiles: tables.table('Missiles'), objects: tables.table('Objects') });
  const shadowOf = (typeId: string) => lightTables.monsterShadow(typeId);
  // 그림자 전사: 주인 직업 그림 + 그림자 장비 (원작 클라이언트가 투명 몸통 k9 에 입혀 그린다)
  const shadowLook = (sh: { cls: string; equipment: Record<string, ItemInstance> }) => ({
    token: CLASS_TOKEN[sh.cls as ClassName] ?? 'AI', wclass: playerWclass(data.items, sh.equipment), equip: { ...BODY, ...playerLayers(data.items, sh.equipment) },
  });
  // 비: levels.txt Rain = 1 인 레벨에서 가끔 (weather.ts)
  const rainLevels = new Set(tables.table('Levels').filter((r) => r.Rain === '1').map((r) => Number(r.Id)));
  const rain = new Rain(seed ^ 0x5eed);
  let lightMap: LightMap | undefined;
  // 출처: PlrSave2.cpp — 시작 막 = 고른 난이도의 nTown (actByDiff)
  const diffAct = startActFor(save, difficulty);
  const startAct = save && actAvailable(diffAct) && sh.prefetched.has(diffAct) ? diffAct : 0;
  const world = actView(startAct).world;
  const cs = classStats(tables.table('charstats'), cls);
  const table = expTable(tables.table('experience'), cls);
  const token = CLASS_TOKEN[cls];
  const itemRng = new Rng(seed ^ 7);

  let equipment: Record<string, ItemInstance>, inventory: ItemInstance[] = [];
  let inventoryGrid: Placed[] = [], stash: Placed[] = [], belt: (ItemInstance | null)[] = [];
  if (save) {
    equipment = save.equipment;
    inventoryGrid = save.inventory;
    stash = save.stash;
    belt = save.belt;
    const all = [...inventoryGrid.map((p) => p.item), ...stash.map((p) => p.item), ...(save.cube ?? []).map((p) => p.item), ...belt.filter((x): x is ItemInstance => !!x), ...Object.values(equipment), ...Object.values(save.merc?.items ?? {})];
    data.treasure.reserveIds(Math.max(0, ...all.map((i) => i.id)));
  } else {
    // 출처: charstats.txt 클래스별 시작 장비 (예: 바바리안 hax 오른손·buc 왼손, 아마존 jav·buc, 소서리스 sst …, hp1 ×4, 두루마리)
    equipment = {};
    inventory = [];
    for (const si of cs.startItems) {
      const base = data.items.base(si.code);
      if (!base) continue;
      for (let i = 0; i < Math.max(si.count, 1); i++) {
        const it = data.treasure.createItem(base, 1, itemRng, QUALITY.NORMAL);
        if (si.loc === 'rarm' || si.loc === 'larm') equipment[si.loc] = it;
        else inventory.push(it);
      }
    }
  }
  // 난이도별 기록: 고른 난이도의 웨이포인트·퀘스트 기록 (원작 .d2s 난이도별 블록)
  const questFlags = save?.questFlagsByDiff[difficulty] ?? null;
  const game = new Game({
    map: world.byKey.get(world.townId)!.def.map, levels: world.levels.map((l) => l.def), act: startAct, difficulty,
    player: { x: world.start.x, y: world.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed, data, character: save?.character ?? createCharacter(cs), classStats: cs, expTable: table, equipment, inventory, inventoryGrid, stash, cube: save?.cube ?? [], belt, gold: save?.gold ?? 0,
    stashGold: save?.stashGold ?? 0, corpse: save?.corpse, waypoints: save?.waypointsByDiff[difficulty], merc: save?.merc ?? null, quests: difficulty === 0 ? save?.quests : [], ...(questFlags ? { questFlags } : {}),
    ...(save?.altWeapons ? { altWeapons: save.altWeapons } : {}), ...(save?.weaponSet ? { weaponSet: save.weaponSet } : {}), ...(save?.altSkills ? { altSkills: save.altSkills } : {}),
  });
  // ---- 사운드 (Phase 11): 원작 효과음·음악·대사 — 게임 사건을 엿들어 재생, 나갈 때 떼어낸다 (src/audio/sound.ts)
  const detachSound = attachSound(game, { assets, tables, data, cls });
  // 웨이포인트 패널·자동 지도·신전 메시지
  // 막 수: 클래식 4, 확장팩 5 (탭 그림도 판본별)
  const ACTS = actCount(data.expansion ?? false);
  const wpPanel = new WaypointPanel(assets, pal, ACTS === 5 ? 5 : 4);
  const automap = new AutomapRenderer(assets, pal, new AutomapTable(tables.table('AutoMap')));
  let automapMode: AutomapMode = 'off';
  let automapStyle: 'full' | 'mini' = 'full';
  let automapDrawn = 0;
  // 왼쪽 위 게임 메시지 (신전·퀘스트 등 — 원작 글꼴, 흐려짐)
  const messageLog = new MessageLog();
  // 막 월드 요청 (엔진 → 브라우저): 미리 읽은 막이면 바로 만들고, 아니면 읽기 시작하고 이번에는 거절
  game.onActChange = (act) => {
    if (!actAvailable(act)) return null;
    if (!sh.prefetched.has(act)) {
      void prefetchAct(sh, act);
      return null;
    }
    return actLevels(actView(act).world);
  };
  // 만들 수 있는 다른 막 파일은 배경으로 미리 읽는다
  // 한 막씩 차례로, 적은 동시 요청으로 (지금 막의 그림 읽기를 막지 않게)
  void (async () => {
    for (let a = 0; a < ACTS; a++) await prefetchAct(sh, a, true).catch(() => undefined);
  })();
  // 웨이포인트 (levels.txt Waypoint 번호는 막을 가로질러 하나): 클래식 막 I~IV, 확장팩 I~V 탭
  const allWaypoints = data.objects ? waypointLevels([...data.objects.levels.values()]).filter((w) => w.act < ACTS) : [];
  const levelNameOf = new Map(tables.table('Levels').map((r) => [Number(r.Id), r.LevelName ?? '']));
  const openWaypointPanel = () => {
    for (let a = 0; a < ACTS; a++) {
      wpPanel.tabEnabled[a] = actAvailable(a);
      wpPanel.rowsByAct[a] = !actAvailable(a) ? [] : allWaypoints.filter((w) => w.act === a).map((w) => {
        const key = game.levelKeyOf(w.levelNo) ?? (a === game.act ? '' : levelKey(w.levelNo));
        const raw = levelNameOf.get(w.levelNo) ?? '';
        return { no: w.no, levelKey: key, levelNo: w.levelNo, name: worldByKey.get(key)?.name ?? (raw ? tables.string(raw) || raw : key), active: game.waypoints.has(w.no), current: key === game.levelId };
      });
    }
    // 원작: 패널은 지금 막 탭으로 열린다
    wpPanel.tab = game.act;
    wpPanel.open = true;
  };
  const questTabs = () => {
    const have = new Set(game.questControl.availableActs);
    for (let a = 0; a < ACTS; a++) questPanel.tabEnabled[a] = have.has(a);
    if (!questPanel.open) questPanel.tab = have.has(game.act) ? game.act : 0;
  };
  // 아이템 UI: 이름·설명(원작 문자열), 인벤토리 그림(DC6), 패널 좌표(inventory.txt)
  const itemText = new ItemText(data.items, data.treasure.gen, (k) => tables.string(k), tables.table('ItemStatCost'), tables.table('charstats'), tables.table('skills'), tables.table('skilldesc'));
  if (data.expansion) itemText.runewords = data.runewords;
  itemText.monsterName = (i) => { const t = data.monsters.list[i]; return t ? tables.string(t.nameStr) : ''; };
  const icons = new ItemIcons(assets, pal, data.items);
  const invPanel = new InventoryPanel(parseInvLayout(tables.table('Inventory'), cls), icons, itemText, art, data.expansion ?? false);
  // 요구치를 못 채운 아이템은 빨간 바탕 (원작)
  invPanel.usable = (it) => {
    const r = requirements(data.items, it), c = game.character;
    const b = data.items.base(it.code), cc = b ? itemClassCode(data.items, b) : '';
    // 다른 직업 전용 아이템도 빨간 바탕 (itemtypes Class)
    return !c || ((!cc || cc === CLASS_CODE[c.cls]) && c.level >= r.level && game.effStat('str') >= r.str && game.effStat('dex') >= r.dex);
  };
  // 원작 DC6 컨트롤 패널 (HUD)·보관함
  const hud = new ControlPanel(art, icons, data.skills, sh.edition);
  const stashPanel = new StashPanel(art, icons);
  // 확장팩 용병 창 (O · 초상화 오른쪽 클릭), 고용 교체 확인
  const mercPanel = new MercPanel(art, icons);
  const hireConfirm = new ConfirmBox();
  let toggleMercPanel: () => void = () => undefined;
  // 호라드릭 큐브 창 (원작 supertransmogrifier.dc6)
  const cubePanel = new CubePanel(art, icons);
  // NPC: 메뉴·대사·상점(원작 buysell.dc6)·고용 목록, 왼쪽 위 용병 초상 (원작 rogueicon.dc6)
  const storePanel = new StorePanel(assets, pal, icons);
  const npcMenu = new NpcMenu();
  const talkBox = new TalkBox();
  const hirePanel = new HirePanel();
  const mercBar = new MercBar(assets, pal);
  // 퀘스트 로그 (원작 questbackground.dc6 · a1q1~6.dc6 아이콘)
  const questPanel = new QuestPanel(assets, pal, ACTS === 5 ? 5 : 4);
  const str = (k: string) => tables.string(k);
  const npcName = (typeId: string) => tables.string(data.monsters.types.get(typeId)?.nameStr ?? typeId);
  let lastInter: ReturnType<Game['snapshot']>['interaction'] = null;
  invPanel.priceLine = (it) => {
    const inter = lastInter;
    if (inter?.mode !== 'trade') return null;
    if (storePanel.mode === 'repair') return inter.repair ? { text: `${str('Repair')}${game.priceOf(it, 'repair')}`, color: '#ffffff' } : null;
    return { text: `${str('Sell')}${game.priceOf(it, 'sell')}`, color: '#ffffff' };
  };

  const cam: Camera = { x: world.start.x, y: world.start.y, width: WIDTH, height: HEIGHT };
  const ch = game.character!;
  const input = new InputController(canvas, () => cam, (c) => game.enqueue(c), () => ({ left: ch.leftSkill, right: ch.rightSkill }));
  // 인벤토리 패널·커서 아이템 클릭 처리 (원작: 왼쪽 = 집기/놓기, 오른쪽 = 사용, 패널 밖에 들고 클릭 = 떨어뜨리기)
  let identifyWith: number | null = null;
  // 컨트롤 패널 상태·동작 (아래 게임 루프 준비에서 채운다)
  let hudState: () => HudState = () => ({ snap: game.snapshot(), ch, exp: table, dead: game.isDead, run: input.run, store: game.store, str: (k) => k, canSelect: () => false, mouse: input.mouse });
  let onHud: (a: HudAction, button: number, cur: ItemInstance | null) => void = () => undefined;
  // 원작 금화 창: 확인 → 엔진 goldTransfer (떨어뜨리기·보관함 넣기·빼기)
  const goldPopup = new GoldPopup(stage, art, (k) => tables.string(k), (kind, amount) =>
    game.enqueue({ type: 'goldTransfer', to: kind === 'drop' ? 'ground' : kind === 'deposit' ? 'stash' : 'inventory', amount }));
  input.intercept = (x, y, button, shift) => {
    if (goldPopup.open) return true;
    // 고용 교체 확인 (원작 VerifyTransaction9): Hire 면 고용, 그 밖은 취소
    const cf = hireConfirm.click(x, y);
    if (cf) {
      if (cf === 'yes' && hireConfirm.pending !== null) game.enqueue({ type: 'hire', index: hireConfirm.pending });
      hireConfirm.pending = null;
      return true;
    }
    // 확장팩 용병 초상: 오른쪽 클릭 = 용병 창 (hireiconinfo2), 물약을 든 채 클릭 = 용병이 마신다 (hireiconinfo1)
    const mSnap = data.expansion ? game.snapshot().merc : null;
    if (mSnap && !mSnap.dead && x >= MERC_BAR.x && y >= MERC_BAR.y && x < MERC_BAR.x + MERC_BAR.w && y < MERC_BAR.y + MERC_BAR.h) {
      const c0 = game.store.cursor;
      if (button === 2) toggleMercPanel();
      else if (c0) game.enqueue({ type: 'mercPotion', itemId: c0.id });
      return true;
    }
    // 컨트롤 패널 (원작: 패널 위 클릭은 월드로 가지 않는다)
    const cur0 = game.store.cursor;
    const ha = hud.click(x, y, hudState(), button);
    if (ha) {
      onHud(ha, button, cur0);
      return true;
    }
    // 호라드릭 큐브 창 (원작: 칸 왼쪽 클릭 = 집기/놓기, 트랜스뮤트 단추, 닫기)
    const ch3 = cubePanel.hit(x, y);
    if (ch3) {
      if (ch3.kind === 'close') {
        cubePanel.open = false;
        game.enqueue({ type: 'closeCube' });
      } else if (ch3.kind === 'transmute' && button === 0) {
        cubePanel.press(performance.now());
        game.enqueue({ type: 'transmute' });
      } else if (ch3.kind === 'cell' && button === 0) {
        if (cur0) game.enqueue({ type: 'moveItem', itemId: cur0.id, to: { kind: 'cube', ...cubePanel.placeAt(cur0, x, y) } });
        else {
          const it = game.store.cube.at(ch3.x, ch3.y)?.item;
          if (it) game.enqueue({ type: 'moveItem', itemId: it.id, to: { kind: 'cursor' } });
        }
      }
      return true;
    }
    if (cubePanel.open && !invPanel.hit(x, y)) {
      // 근사(원작 미확인): 큐브 창이 열린 채 바깥 클릭 = 닫고 이동
      cubePanel.open = false;
      game.enqueue({ type: 'closeCube' });
    }
    // 보관함 (원작: 왼쪽 클릭 = 집기/놓기)
    const sh = stashPanel.hit(x, y);
    if (sh) {
      if (sh.kind === 'close') stashPanel.open = false;
      // 보관함 금화 단추 = 빼기 (소지 한도까지)
      else if (sh.kind === 'gold' && button === 0 && !cur0) goldPopup.show('withdraw', Math.min(game.stashGold, game.goldMax() - game.gold), 80);
      else if (sh.kind === 'cell' && button === 0) {
        if (cur0) game.enqueue({ type: 'moveItem', itemId: cur0.id, to: { kind: 'stash', ...stashPanel.placeAt(cur0, x, y) } });
        else {
          const it = game.store.stash.at(sh.x, sh.y)?.item;
          if (it) game.enqueue({ type: 'moveItem', itemId: it.id, to: { kind: 'cursor' } });
        }
      }
      return true;
    }
    if (stashPanel.open && !invPanel.hit(x, y)) {
      // 근사(원작 미확인): 보관함이 열린 채 바깥 클릭 = 닫고 이동
      stashPanel.open = false;
    }
    // 용병 창 (확장팩): 칸 왼쪽 클릭 = 든 아이템 주기 (칸은 아이템 종류로) / 빈 손이면 그 칸 장비 들기 (원작 Rcv0x61)
    const mh = mercPanel.hit(x, y);
    if (mh) {
      if (mh.kind === 'close') mercPanel.open = false;
      else if (mh.kind === 'slot' && button === 0) {
        if (game.store.cursor) game.enqueue({ type: 'mercItem' });
        else if (game.merc?.items?.[mh.slot]) game.enqueue({ type: 'mercItem', slot: mh.slot });
      }
      return true;
    }
    // 퀘스트 로그 패널 (원작: 열린 동안 아이콘 클릭 = 고르기, 닫기 단추)
    const qp = questPanel.click(x, y);
    if (qp === 'close') {
      questPanel.open = false;
      return true;
    }
    if (qp === 'panel') return true;
    // NPC 대화: 메뉴 → 고용 목록 → 상점 (원작: 대화 중 바깥 클릭 = 닫고 이동)
    const inter = game.snapshot().interaction;
    if (inter?.mode === 'imbue') {
      // Charsi 담금질: 인벤토리 아이템을 누르면 그 아이템을 맡긴다 (근사: 원작은 커서로 들어 Charsi 창에 놓는다)
      const it = invPanel.itemAt(game.store, x, y) ?? (game.store.cursor && !invPanel.hit(x, y) ? game.store.cursor : null);
      if (it && button === 0) {
        game.enqueue({ type: 'imbue', itemId: it.id });
        return true;
      }
      if (!invPanel.hit(x, y)) game.enqueue({ type: 'closeNpc' });
      return true;
    }
    if (inter?.mode === 'menu') {
      const o = npcMenu.click(x, y);
      if (o && o !== 'panel') game.enqueue({ type: 'npcMenu', option: o });
      if (o) return true;
    }
    if (inter?.mode === 'hire') {
      const r = hirePanel.click(x, y);
      // 확장팩: 이미 용병이 있으면 원작처럼 교체를 묻는다 (VerifyTransaction9 — 예전 용병과 장비는 사라진다)
      if (typeof r === 'number') {
        if (data.expansion && game.merc) hireConfirm.pending = r;
        else game.enqueue({ type: 'hire', index: r });
      }
      if (r !== null) return true;
      game.enqueue({ type: 'closeNpc' });
      return true;
    }
    if (inter && (inter.mode === 'trade' || inter.mode === 'gamble')) {
      const cur = game.store.cursor;
      const c = storePanel.click(x, y, !!cur);
      if (c) {
        if (c.kind === 'buy' && (storePanel.mode === 'buy' || button === 2)) {
          // 원작: 왼쪽 = 사기(자동 벨트 물약은 벨트), 오른쪽 = 인벤토리로, Shift+오른쪽 = 멀티바이 (벨트·책 채우기)
          game.enqueue({ type: 'buy', itemId: c.itemId, ...(button === 2 ? (shift ? { multi: true } : { toInventory: true }) : {}) });
        } else if (c.kind === 'tab') storePanel.page = c.page;
        else if (c.kind === 'mode') storePanel.mode = c.mode;
        else if (c.kind === 'repairAll') game.enqueue({ type: 'repair' });
        else if (c.kind === 'drop' && cur) game.enqueue({ type: 'sell', itemId: cur.id });
        return true;
      }
      // 판매·수리 모드: 인벤토리 아이템 클릭
      const it = invPanel.itemAt(game.store, x, y);
      if (it && !cur && storePanel.mode === 'sell' && button === 0) {
        game.enqueue({ type: 'sell', itemId: it.id });
        return true;
      }
      if (it && !cur && storePanel.mode === 'repair' && button === 0) {
        game.enqueue({ type: 'repair', itemId: it.id });
        return true;
      }
      if (!invPanel.hit(x, y)) {
        game.enqueue({ type: 'closeNpc' });
        return true;
      }
    }
    // 웨이포인트 패널 (원작: 열린 동안 줄 클릭 = 이동, 패널 밖 클릭 = 닫고 이동)
    const wp = wpPanel.click(x, y);
    if (wp === 'close') {
      wpPanel.open = false;
      return true;
    }
    if (wp === 'panel') return true;
    if (wp) {
      // 아직 만들지 않은 막의 레벨은 levels.txt 번호로 (엔진이 그 막 월드를 요청한다)
      const row = wpPanel.rows.find((r) => r.levelKey === wp);
      game.enqueue({ type: 'waypoint', level: game.levelDef(wp) || row?.levelNo === undefined ? wp : row.levelNo });
      wpPanel.open = false;
      return true;
    }
    if (wpPanel.open) wpPanel.open = false;
    const store = game.store;
    const hit = invPanel.hit(x, y);
    if (hit?.kind === 'close') {
      invPanel.open = false;
      return true;
    }
    // 인벤토리 금화 단추: 보관함이 열려 있으면 넣기(보관함 한도까지), 아니면 떨어뜨리기
    // 무기 바꾸기 탭 (확장팩 캐릭터): 지금 세트가 아닌 탭을 누르면 바꾼다
    if (hit?.kind === 'weaponTab') {
      if (button === 0 && hit.set !== store.weaponSet) game.swapWeapons();
      return true;
    }
    if (hit?.kind === 'gold') {
      if (button === 0 && !store.cursor && game.gold > 0) {
        if (stashPanel.open) goldPopup.show('deposit', Math.min(game.gold, game.stashGoldMax() - game.stashGold), 400);
        else goldPopup.show('drop', game.gold, 400);
      }
      return true;
    }
    if (hit) {
      const it = invPanel.itemAt(store, x, y);
      if (button === 2) {
        // 감정 두루마리·책은 우클릭 후 감정할 아이템을 좌클릭 (원작 감정 커서)
        if (it && (it.code === 'isc' || it.code === 'ibk')) identifyWith = it.id;
        else if (it) game.enqueue({ type: 'useItem', itemId: it.id });
        return true;
      }
      if (identifyWith !== null) {
        if (it && !it.identified) game.enqueue({ type: 'useItem', itemId: identifyWith, targetId: it.id });
        identifyWith = null;
        return true;
      }
      const cur = store.cursor;
      // 원작: 보석을 든 채 빈 소켓이 있는 아이템을 클릭하면 박힌다
      const under = invPanel.itemAt(store, x, y);
      const curBase = cur ? data.items.base(cur.code) : undefined;
      if (cur && under && curBase && data.items.isType(curBase, 'sock') && under.socketed.length < under.sockets) {
        game.enqueue({ type: 'moveItem', itemId: cur.id, to: { kind: 'socket', itemId: under.id } });
        return true;
      }
      if (hit.kind === 'inventory') {
        if (cur) game.enqueue({ type: 'moveItem', itemId: cur.id, to: { kind: 'inventory', ...invPanel.placeAt(cur, x, y) } });
        else {
          const it = store.inv.at(hit.x, hit.y)?.item;
          if (it) game.enqueue({ type: 'moveItem', itemId: it.id, to: { kind: 'cursor' } });
        }
      } else if (hit.kind === 'equip') {
        if (cur) game.enqueue({ type: 'moveItem', itemId: cur.id, to: { kind: 'equip', slot: hit.slot } });
        else {
          const it = store.equipment[hit.slot];
          if (it) game.enqueue({ type: 'moveItem', itemId: it.id, to: { kind: 'cursor' } });
        }
      }
      return true;
    }
    if (store.cursor && button === 0) {
      game.enqueue({ type: 'moveItem', itemId: store.cursor.id, to: { kind: 'ground' } });
      return true;
    }
    return false;
  };
  // 화면 위 몬스터 이름·생명 막대 (마우스를 올린 몬스터)
  const namer = new MonsterNamer(data.monsters, data.uniques, (k) => tables.string(k));
  let hoverMonster: { id: number; name: string; box: { x: number; y: number; w: number; h: number } } | null = null;
  const skillName = (id: number) => data.skills?.byId.get(id)?.displayName ?? 'Attack';


  return new Promise((resolve) => {
    let running = true;
    const panels = new Panels(stage, art, () => void saveAndExit(), { get: (k) => sound.settings[k], set: (k, v) => sound.setVolume(k, v) }, str);
    // 옵션 AUTOMAP SIZE → 자동 지도 크기
    automapStyle = panels.options.automapSize;
    panels.onOptions = (o) => {
      automapStyle = o.automapSize;
      if (automapMode !== 'off') automapMode = automapStyle;
    };
    // 스킬 툴팁 레벨별 줄 (skilldesc desc/dsc2/dsc3 + 엔진 SkillCalc)
    const skillTip = data.skillCalc ? new SkillTip({ calc: data.skillCalc, owner: () => game.skillOwner(), str }) : null;
    // 캐릭터 패널(C, 왼쪽)·스킬 트리(T, 오른쪽) — 원작 DC6, 투명 단추 층 #charpanel / #skilltree
    const charPanel = new CharPanel(stage, art, {
      character: () => ch, heroName: name, derived: () => game.derived(), classStats: cs, exp: table,
      weapon: () => (game.equipment.rarm ? data.items.base(game.equipment.rarm.code) : undefined),
      skillName, str, spendStat: (stat) => game.enqueue({ type: 'spendStat', stat }), onClose: () => (charPanel.open = false),
      stamina: () => {
        const p = game.snapshot().player;
        return { cur: p.stamina, max: p.maxStamina };
      },
    });
    const skilldesc = new Map(tables.table('skilldesc').map((r) => [r.skilldesc ?? '', r]));
    const skillsRows = new Map(tables.table('skills').map((r) => [Number(r.Id), r]));
    const skillPanels = data.skills
      ? new SkillTree(stage, art, {
          db: data.skills,
          character: () => ch,
          learn: (id) => game.enqueue({ type: 'spendSkill', skill: id }),
          skillLevel: (id) => game.effectiveSkillLevel(id),
          str,
          describe: (s) => {
            const key = skilldesc.get(skillsRows.get(s.id)?.skilldesc ?? '')?.['str long'];
            return key ? str(key) : '';
          },
          ...(skillTip ? { tip: (s: Parameters<SkillTip['lines']>[0], lvl: number) => skillTip.lines(s, skilldesc.get(skillsRows.get(s.id)?.skilldesc ?? ''), lvl) } : {}),
          onClose: () => (skillPanels ? (skillPanels.open = false) : undefined),
        })
      : null;
    // 원작: 왼쪽 패널 자리(캐릭터·퀘스트·웨이포인트·보관함·상점) 와 오른쪽(인벤토리·스킬 트리)은 하나씩만
    const openLeft = (which: 'char' | 'quest' | 'stash' | 'cube' | 'merc' | null) => {
      charPanel.open = which === 'char';
      mercPanel.open = which === 'merc';
      if (which !== 'quest') questPanel.open = false;
      stashPanel.open = which === 'stash';
      if (cubePanel.open && which !== 'cube') game.enqueue({ type: 'closeCube' });
      cubePanel.open = which === 'cube';
      if (which) wpPanel.open = false;
    };
    const openRight = (which: 'inv' | 'tree' | null) => {
      invPanel.open = which === 'inv';
      if (skillPanels) skillPanels.open = which === 'tree';
    };
    const toggleChar = () => openLeft(charPanel.open ? null : 'char');
    // 용병 창: 확장팩에서 살아 있는 용병이 있을 때만
    toggleMercPanel = () => {
      const m = game.snapshot().merc;
      if (!data.expansion || ((!m || m.dead) && !mercPanel.open)) return;
      openLeft(mercPanel.open ? null : 'merc');
    };
    const toggleTree = () => openRight(skillPanels?.open ? null : 'tree');
    const toggleInv = () => openRight(invPanel.open ? null : 'inv');
    // Alt (Show Items) 누르고 있는 동안 바닥 아이템 이름 모두
    let altHeld = false;
    const onKeyUp = (e: KeyboardEvent) => {
      if (keyBindings.is(e, 'showitems')) altHeld = false;
    };
    const onBlur = () => (altHeld = false);
    const onKey = (e: KeyboardEvent) => {
      // 금화 창이 떠 있으면 숫자·Enter·Esc 만
      if (goldPopup.key(e)) return;
      // 게임 메뉴가 열려 있으면 위·아래·Enter·Esc 만 (단축키 바꾸는 중이면 그 키)
      if (panels.menuOpen) {
        // F1 도움말·F5 새로고침 같은 브라우저 동작 대신 단축키로 (키 바꾸기 중에도)
        if (e.key === 'Tab' || e.key === 'Alt' || /^F\d+$/.test(e.key)) e.preventDefault();
        if (e.key === 'Escape') panels.back();
        else panels.key(e.key);
        return;
      }
      const act = keyBindings.actionOf(e);
      // 원작 스킬 단축키 (Skill 1~8, 기본 F1~F8): 스킬 고르기 목록에서 아이콘을 가리키고 누르면 그 손에 등록, 아니면 등록한 스킬로 바꾼다
      const slot = SKILL_SLOTS.indexOf(act as SkillSlot);
      if (slot >= 0) {
        e.preventDefault();
        const m = input.mouse;
        const hover = hud.skillMenu && m ? hud.hoveredMenuEntry(m.x, m.y) : null;
        if (hover && hud.skillMenu) game.enqueue({ type: 'setHotkey', slot, skill: hover.id, hand: hud.skillMenu, ...(hover.charge ? { charge: true } : {}) });
        else {
          const hk = ch.hotkeys?.[slot];
          if (hk) game.enqueue({ type: 'setSkill', hand: hk.hand, skill: hk.skill, ...(hk.charge ? { charge: true } : {}) });
        }
        return;
      }
      if (act === 'showitems') {
        e.preventDefault();
        altHeld = true;
        return;
      }
      if (act === 'automap') {
        // 원작: Tab = 자동 지도 켜기/끄기
        e.preventDefault();
        automapMode = automapMode === 'off' ? automapStyle : 'off';
        return;
      }
      if (act === 'minimap') {
        automapStyle = automapStyle === 'full' ? 'mini' : 'full';
        if (automapMode !== 'off') automapMode = automapStyle;
        return;
      }
      if (e.key === 'Escape' && hud.skillMenu) {
        hud.skillMenu = null;
        return;
      }
      // 원작: Esc 는 열린 패널부터 모두 닫는다
      if (e.key === 'Escape' && (wpPanel.open || questPanel.open || charPanel.open || mercPanel.open || stashPanel.open || cubePanel.open || invPanel.open || skillPanels?.open || hud.beltOpen)) {
        wpPanel.open = false;
        questPanel.open = false;
        hud.beltOpen = false;
        openLeft(null);
        openRight(null);
        return;
      }
      // 원작 단축키: Q 퀘스트 로그
      if (act === 'quest') {
        if (!questPanel.open) openLeft('quest');
        questTabs();
        questPanel.toggle(game.questLog(questPanel.tab));
        return;
      }
      if (e.key === 'Escape' && game.snapshot().interaction) {
        game.enqueue({ type: 'closeNpc' });
        return;
      }
      if (e.key === 'Escape') {
        // 원작: 지금 막 마을에서 부활
        if (game.isDead) game.respawnInTown();
        else panels.toggleMenu();
      } else if (act === 'inv') toggleInv();
      // 원작 벨트 단축키 1~4 (아래 줄)
      else if (act === 'belt1' || act === 'belt2' || act === 'belt3' || act === 'belt4') {
        // 확장팩: Shift + 벨트 키 = 그 물약을 용병에게
        const slot = Number(act.slice(4)) - 1, bit = game.store.belt[slot];
        if (e.shiftKey && data.expansion && bit && game.mercUnit()) game.enqueue({ type: 'mercPotion', itemId: bit.id });
        else game.enqueue({ type: 'useBelt', slot });
      }
      // 원작 단축키: T 스킬 트리, C 캐릭터, ~ 벨트 펼치기, N 메시지 지우기
      else if (act === 'tree') toggleTree();
      else if (act === 'char') toggleChar();
      else if (act === 'beltshow') hud.beltOpen = !hud.beltOpen;
      else if (act === 'clearmsg') messageLog.clear();
      else if (act === 'swap') game.swapWeapons();
      else if (act === 'hireling') toggleMercPanel();
      // 원작: R = 달리기/걷기 (InputController 가 바꾼다), S = 스킬 고르기 (오른쪽)
      else if (act === 'skillpick') hud.skillMenu = hud.skillMenu ? null : 'right';
    };
    // 컨트롤 패널 동작 (클릭)
    hudState = () => ({ snap: game.snapshot(), ch, exp: table, dead: game.isDead, run: input.run, store: game.store, str, canSelect: (s, hand, charge) => game.canSelectSkill(s, hand, charge), itemSkills: () => game.itemSkillEntries(), mouse: input.mouse, hotkeyLabel: (i) => keyBindings.label(keyBindings.map[SKILL_SLOTS[i]!], str) });
    onHud = (a: HudAction, button: number, cur: ItemInstance | null) => {
      if (a.kind === 'run') input.run = !input.run;
      else if (a.kind === 'minipanel') hud.miniOpen = !hud.miniOpen;
      else if (a.kind === 'newStats') {
        openLeft('char');
      } else if (a.kind === 'newSkill') openRight('tree');
      else if (a.kind === 'skillMenu') hud.skillMenu = hud.skillMenu === a.hand ? null : a.hand;
      else if (a.kind === 'setSkill') game.enqueue({ type: 'setSkill', hand: a.hand, skill: a.id, ...(a.charge ? { charge: true } : {}) });
      else if (a.kind === 'mini') {
        if (a.button === 'char') toggleChar();
        else if (a.button === 'inv') toggleInv();
        else if (a.button === 'tree') toggleTree();
        else if (a.button === 'automap') automapMode = automapMode === 'off' ? automapStyle : 'off';
        else if (a.button === 'quest') {
          if (!questPanel.open) openLeft('quest');
          questTabs();
          questPanel.toggle(game.questLog(questPanel.tab));
        } else if (a.button === 'menu') panels.toggleMenu(true);
      } else if (a.kind === 'belt') {
        // 원작: 벨트 칸 오른쪽 클릭 = 마시기, 왼쪽 = 집기/놓기
        const it = game.store.belt[a.slot];
        if (button === 2) game.enqueue({ type: 'useBelt', slot: a.slot });
        else if (cur) game.enqueue({ type: 'moveItem', itemId: cur.id, to: { kind: 'belt', slot: a.slot } });
        else if (it) game.enqueue({ type: 'moveItem', itemId: it.id, to: { kind: 'cursor' } });
        // 원작: 빈 벨트 칸을 누르면 벨트가 펼쳐진다/접힌다 (근사(원작 미확인): 빈 칸 클릭으로 전환)
        else hud.beltOpen = !hud.beltOpen;
      }
    };
    async function saveAndExit(): Promise<void> {
      const st = game.store;
      // 난이도별 기록: 이번 게임 난이도 칸만 바꾼다 (다른 난이도는 불러온 저장 그대로)
      const byDiff = mergeDifficulty(save, game.difficulty, game.waypoints.list(), game.questRecord.toJSON());
      await HeroStore.save(makeSave(name, game.character!, game.gold, { inventory: st.inv.items, stash: st.stash.items, cube: st.cube.items, belt: st.belt, equipment: game.equipment,
        stashGold: game.stashGold, merc: game.mercSave(), corpse: game.corpse ? (Object.fromEntries(Object.entries(game.corpse.items).filter(([, v]) => v)) as Record<string, ItemInstance>) : {},
        // Phase 7: 디아블로를 죽이면 다음 난이도 (game.difficultyUnlocked), 진행 값 (칭호)
        act: game.act, difficulty: game.difficulty, difficultyUnlocked: Math.max(save?.difficultyUnlocked ?? 0, game.difficultyUnlocked) as Difficulty, ...byDiff,
        // 난이도별 마지막 막 (이번 난이도 칸은 makeSave 가 act 로), 칭호 진행 값
        actByDiff: save?.actByDiff, expansion: game.expansion,
        altWeapons: st.altWeapons as Record<string, ItemInstance>, weaponSet: st.weaponSet, altSkills: game.altSkills, ...(save?.progression !== undefined || game.progression ? { progression: Math.max(save?.progression ?? 0, game.progression) } : {}),
      }));
      running = false;
      detachSound();
      input.dispose();
      panels.dispose();
      skillPanels?.dispose();
      charPanel.dispose();
      goldPopup.dispose();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (import.meta.env.DEV) delete window.__game;
      // 메뉴로 돌아가면 월드 캔버스를 숨긴다 (메뉴는 UI 캔버스에 그린다)
      worldCanvas.style.visibility = 'hidden';
      resolve();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    // 이번 프레임 가리킨 유닛·바닥 이름표 (e2e)
    let hoverNow: Hover = null;
    let labels: GroundLabel[] = [];
    let prevLevel = game.levelId;
    const outdoor = (k: string) => /Wilderness|Town/i.test(worldByKey.get(k)?.automapName ?? '');
    if (import.meta.env.DEV) {
      window.__game = {
        game, ready: true, input, save: saveAndExit,
        ui: {
          waypoint: wpPanel, automap: () => automapMode, automapReady: () => automap.ready, automapDrawn: () => automapDrawn, hoverMonster: () => hoverMonster, camera: () => cam,
          store: storePanel, npcMenu, hire: hirePanel, talk: talkBox, mercBar, inventory: invPanel, itemText, quest: questPanel, rain,
          hud, charPanel, skillTree: skillPanels as SkillTree, stash: stashPanel, gameMenu: panels, art, cube: cubePanel, merc: mercPanel, hireConfirm,
          gold: goldPopup, messages: messageLog, cursor, loading, labels: () => labels, hover: () => hoverNow, altHeld: () => altHeld,
        },
      };
    }

    // 화면 캡처 (e2e·진단): 월드 픽셀 위에 UI 캔버스를 겹친 결과
    const captureWaiters: ((img: ImageData) => void)[] = [];
    const readWorld = (): Uint8ClampedArray<ArrayBuffer> =>
      worldSink instanceof GlSink ? new Uint8ClampedArray(worldSink.readPixels().buffer as ArrayBuffer) : (worldCanvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, WIDTH, HEIGHT).data as Uint8ClampedArray<ArrayBuffer>;
    const finishCapture = (px: Uint8ClampedArray<ArrayBuffer>) => {
      const tmp = document.createElement('canvas');
      tmp.width = WIDTH;
      tmp.height = HEIGHT;
      const tc = tmp.getContext('2d') as CanvasRenderingContext2D;
      tc.putImageData(new ImageData(px, WIDTH, HEIGHT), 0, 0);
      tc.drawImage(canvas, 0, 0);
      const img = tc.getImageData(0, 0, WIDTH, HEIGHT);
      for (const w of captureWaiters.splice(0)) w(img);
    };
    const capture = () => new Promise<ImageData>((res) => captureWaiters.push(res));
    if (window.__game) window.__game.capture = capture;
    worldCanvas.style.visibility = 'visible';

    const step = 1000 / ENGINE_FPS;
    let last = performance.now(), acc = 0;
    const frameBody = (now: number) => {
      acc += Math.min(now - last, 250);
      last = now;
      input.enabled = !panels.menuOpen;
      // 원작 싱글플레이: 게임 메뉴가 열리면 게임이 멈춘다
      while (acc >= step) {
        if (!panels.menuOpen) {
          // 신전 메시지는 한 틱에 한 번 (shrine 사건이 이미 ShrMsg 를 냈으면 shrineMissiles·shrineWarp 는 건너뜀)
          let shrineMsg = false;
          for (const ev of game.tick()) {
            if (ev.type === 'waypointMenu') {
              openLeft(null);
              openWaypointPanel();
            } else if (ev.type === 'cubeOpened') {
              // 호라드릭 큐브: 큐브 창 + 인벤토리
              openLeft('cube');
              openRight('inv');
            } else if (ev.type === 'cubeClosed') cubePanel.open = false;
            else if (ev.type === 'objectUnsupported' && Number(ev.operateFn) === 32) {
              // 원작 보관함 (objects.txt bank, OperateFn 32): 보관함 + 인벤토리
              openLeft('stash');
              openRight('inv');
            }
            else if (ev.type === 'levelChanged') {
              wpPanel.open = false;
              // 원작: 계단·입구로 다른 레벨에 들어가면 잠깐 로딩 화면 (야외끼리 이어진 경계는 없음 — 근사: 자동 지도 이름으로 야외 판단)
              const to = String(ev.level);
              // 그 레벨 가까운 몬스터 그림이 준비될 때까지 로딩 화면 유지 (최대 4초)
              if (!(outdoor(prevLevel) && outdoor(to))) loading.flash(performance.now(), 350, gfxBusy);
              prevLevel = to;
            } else if (ev.type === 'waypointTravel' || ev.type === 'portalTaken') loading.flash(performance.now(), 350, gfxBusy);
            else if (ev.type === 'actChanged') {
              // 원작: 막을 옮기면 로딩 화면이 조금 더 길다 (근사(원작 미확인): 0.7초)
              loading.flash(performance.now(), 700, gfxBusy);
              wpPanel.open = false;
              questPanel.open = false;
            }
            else if (ev.type === 'shrine') {
              messageLog.push(tables.string(String(ev.message)), performance.now());
              shrineMsg = true;
            } else if ((ev.type === 'shrineMissiles' || ev.type === 'shrineWarp') && !shrineMsg) {
              // 출처: shrines.txt Code 19 fire(파이어볼) · 20 portal(워프) · 21 explosive · 22 poison — 메시지 ShrMsg<code>
              const code = ev.type === 'shrineWarp' ? 20 : ev.missile === 'fireball' ? 19 : ev.missile === 'explosivepotion' ? 21 : 22;
              messageLog.push(tables.string(`ShrMsg${code}`), performance.now());
              shrineMsg = true;
            }
            else if (ev.type === 'locked') messageLog.push('Locked', performance.now());
            else if (ev.type === 'npcTalk') {
              talkBox.show(npcName(String(ev.typeId)), pickGossip(str, String(ev.gossip), cls, !!ev.intro, Number(ev.pick)), performance.now());
            } else if (ev.type === 'storeOpened') {
              openLeft(null);
              openRight('inv');
              talkBox.hide();
            } else if (ev.type === 'npcClosed') {
              storePanel.hide();
              talkBox.hide();
            } else if (ev.type === 'questSpeech') {
              // 퀘스트 대사 (원작 스크롤 두루마리 — 근사: 대사 상자)
              talkBox.show(npcName(String(ev.typeId)), str(String(ev.key)), performance.now());
            } else if (ev.type === 'questScroll') {
              talkBox.show('', stripSpeed(str(String(ev.key))), performance.now());
            } else if (ev.type === 'questMessage') {
              // 출처: string.tbl qstsa1q14 "Monsters remaining: " + 수, qstsa1q140 "One monster left."
              messageLog.push(ev.key === 'qstsa1q14' ? `${str('qstsa1q14')}${Number(ev.count)}` : str(String(ev.key)), performance.now(), 'gold');
            } else if (ev.type === 'questCompleted') {
              // 근사(원작 미확인): 원작은 완료 소리와 퀘스트 단추 깜빡임 — 여기서는 화면 메시지 (퀘스트 번호 = 기록 워드)
              messageLog.push(`${str(questNameKey(Number(ev.quest)))} — ${str('qstsComplete')}`, performance.now(), 'gold');
            } else if (ev.type === 'gameCompleted') {
              // Phase 7: 클래식 엔딩 (원작 엔딩 영상 대신 문구 — string.tbl Killdiablo1~3 + 칭호). 근사(원작 미확인): 표시 방식
              const title = heroTitle(FEMALE.includes(cls), Math.max(save?.progression ?? 0, game.progression), false, game.expansion);
              messageLog.push(str('Killdiablo1'), performance.now(), 'gold');
              messageLog.push(str('KillDiablo2'), performance.now(), 'gold');
              if (title) messageLog.push(`${str('KillDiablo3')} ${title} ${name}`, performance.now(), 'gold');
            } else if (ev.type === 'exitBlocked') {
              // Phase 7: 퀘스트가 닫은 출구 (원작 QUESTS_LevelWarpCheck — 막힌 소리). 근사: 메시지 없이 소리만 (Phase 9)
            } else if (ev.type === 'imbueOpened') {
              openLeft(null);
              openRight('inv');
              talkBox.hide();
            } else if (ev.type === 'actChange' && !ev.available) {
              // 막 월드 파일을 아직 읽지 못함: 읽은 뒤 막 이동을 다시 보낸다 (조건은 엔진이 다시 본다)
              const act = Number(ev.act);
              if (actAvailable(act)) {
                loading.flash(performance.now(), 700);
                void prefetchAct(sh, act).then(() => game.enqueue({ type: 'travelAct', act }));
              }
            }
          }
        }
        acc -= step;
      }
      input.update(now);
      const s = game.snapshot();
      cam.x = s.player.x;
      cam.y = s.player.y;
      const wclass = playerWclass(data.items, game.equipment);
      const equip: Record<string, string> = { ...BODY, ...playerLayers(data.items, game.equipment) };
      // 로딩 화면 동안 가까운 몬스터·플레이어 그림을 미리 불러 해석한다 (로딩 화면은 그동안 기다린다)
      if (loading.active(now)) {
        const units = (views.get(game.act) ?? actView(startAct)).units;
        warmLevel(s, { units, monsters: data.monsters });
        // 플레이어가 곧 쓸 동작 (걷기·달리기·공격·맞기)
        for (const mode of ['NU', 'WL', 'RN', 'A1', 'A2', 'GH', 'BL']) units.warm({ root: 'CHARS', token, mode, wclass, equip }, s.player.dir);
      }
      const cpItems = game.corpse?.items;
      // 출처: 원작 d2char.mpq — 캐릭터 시체(DD)·죽기(DT) COF 는 맨손(HTH)만 있다 (xxDDHTH.cof). 무기 종류로 찾으면 그림이 없다
      const corpseLook = cpItems ? { equip: { ...BODY, ...playerLayers(data.items, cpItems) }, wclass: 'HTH' } : undefined;
      // 가리킨 유닛 (지난 프레임 클릭 상자 — 패널·메뉴 위면 없음). 원작: 가리킨 유닛·오브젝트를 밝게
      const mm = input.mouse;
      const overUi = !mm || panels.menuOpen || goldPopup.open || !!invPanel.hit(mm.x, mm.y) || !!stashPanel.hit(mm.x, mm.y) || !!mercPanel.hit(mm.x, mm.y) || !!cubePanel.hit(mm.x, mm.y) || mm.y >= 553 || (!!skillPanels?.open && mm.x >= 400 && mm.y >= 60 && mm.y < 492) || (charPanel.open && mm.x < 400 && mm.y >= 60 && mm.y < 492);
      hoverNow = overUi || !mm ? null : input.hoverAt(mm.x, mm.y);
      const view = views.get(game.act) ?? actView(startAct);
      // 막 팔레트 (타일·유닛 색은 그리는 쪽이 팔레트로 입힌다)
      worldSink.setPalette(view.pal);
      // 조명: 실내는 빛 반경 밖이 어둡다 (야외·마을은 낮 밝기 — 광원 계산 생략)
      if (worldSink instanceof GlSink) {
        const ambient = ambientOf(lightTables.isInside(game.levelDef(game.levelId)?.levelNo ?? 0), game.environment().intensity);
        const src = ambient >= FULL_LIGHT ? [] : lightSources(s, lightTables, PLAYER_LIGHT + game.lightRadiusBonus());
        lightMap = buildLightMap(cam.x, cam.y, ambient, src, lightMap);
        worldSink.setLight(lightMap, cam, view.light);
      }
      // UI 캔버스는 투명으로 시작 (아래 월드 캔버스가 비친다)
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      (renderers[game.levelId] as WorldRenderer).render(
        worldSink,
        cam,
        buildScene(s, cam, { units: view.units, items: view.itemGfx, missiles: view.missileGfx, anim, monsters: data.monsters, itemDb: data.items, playerToken: token, playerWclass: wclass, playerEquip: equip, corpseLook, inTown: game.inTown, objectDb: data.objects, hover: hoverNow, shadowOf, shadowLook }, input.pickBoxes),
      );
      // 화면 캡처 요청: WebGL 화면은 그린 직후에만 읽을 수 있다
      const worldPx = captureWaiters.length ? readWorld() : null;
      // 비 (월드 위, UI 아래) + 빗소리
      const raining = rain.active(rainLevels.has(game.levelDef(game.levelId)?.levelNo ?? 0), now);
      const weather = weatherKind(game.act);
      if (raining) rain.draw(ctx, now, WIDTH, 553, weather);
      sound.setWeather(raining && weather === 'rain' ? 'scene_rain' : null);
      // 바닥 아이템 이름표: Alt(Show Items) = 모두, 아니면 가리킨 아이템만 (원작)
      labels = [];
      for (const b of input.pickBoxes) {
        if (b.kind !== 'item' || (!altHeld && !(hoverNow?.kind === 'item' && hoverNow.id === b.id))) continue;
        const it = game.groundItemById(b.id);
        if (!it || labels.some((l) => l.id === b.id)) continue;
        labels.push({ id: b.id, text: itemText.name(it as ItemInstance), color: it.code === 'gld' ? '#ffffff' : (QUALITY_COLOR[it.quality] ?? '#ffffff'), x: b.x + b.w / 2, y: b.y + 4 });
      }
      if (labels.length) {
        const lh = drawGroundLabels(ctx, labels, overUi ? null : mm, input.pickBoxes);
        if (lh !== null && !overUi) hoverNow = { kind: 'item', id: lh };
      }
      if (automapMode !== 'off') {
        const wl = worldByKey.get(game.levelId);
        const reveal = game.automapOf(game.levelId);
        if (wl && reveal) {
          const objs = game.objects;
          automapDrawn = automap.draw(ctx, automapMode, wl.preset, wl.automapName, reveal, {
            player: { x: s.player.x, y: s.player.y },
            waypoints: objs.filter((o) => o.type.subClass & SUBCLASS.WAYPOINT).map((o) => ({ x: o.x, y: o.y })),
            portals: objs.filter((o) => o.portal).map((o) => ({ x: o.x, y: o.y })),
            // 플레이어 시체 (같은 레벨일 때만 스냅샷에 온다)
            corpse: s.corpse ? { x: s.corpse.x, y: s.corpse.y } : null,
            // 출구 표시: 드러난 곳의 출구에 도착 레벨의 LevelWarp 문자열
            exits: game.exits.filter((e) => reveal.isSeen(Math.floor((e.x + e.w / 2) / 5), Math.floor((e.y + e.h / 2) / 5)))
              .map((e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2, label: worldByKey.get(e.to)?.warpLabel || e.to })),
          }, WIDTH, HEIGHT, panels.options.automapFade ? 0.5 : 1);
        }
        // 원작: 자동 지도를 켜면 오른쪽 위에 지역 이름 (근사: 위치·색)
        drawText(ctx, levelNames[game.levelId] ?? '', WIDTH - 12, 12, { align: 'right', color: 'gold' });
      }
      hoverMonster = null;
      if (input.mouse) {
        const mx = input.mouse.x, my = input.mouse.y;
        // 바닥 이름표를 가리키면 몬스터 이름 막대는 없다 (가리킨 것 하나만)
        const pick = hoverNow?.kind === 'item' ? undefined : [...input.pickBoxes].reverse().find((b) => (b.kind === 'monster' || b.kind === 'npc') && mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h);
        const hm = pick ? s.monsters.find((x) => x.id === pick.id && x.mode !== 'DT' && x.mode !== 'DD') : undefined;
        if (hm?.npc) {
          // 원작: NPC 위에 마우스를 올리면 이름만 (생명 막대 없음)
          drawNameBar(ctx, npcName(hm.typeId));
        } else if (hm) {
          const label = namer.label(hm);
          hoverMonster = { id: hm.id, name: label.name, box: drawMonsterBar(ctx, hm, label) };
        }
      }
      const reqCtx = { level: ch.level, str: game.effStat('str'), dex: game.effStat('dex'), cls: ch.cls };
      // NPC 대화 상태 → 패널
      const inter = s.interaction;
      lastInter = inter;
      if (inter && (inter.mode === 'trade' || inter.mode === 'gamble')) storePanel.show(inter.store, inter.mode === 'gamble', inter.repair);
      else storePanel.hide();
      storePanel.draw(ctx, s.player.gold, str, input.mouse, (it) => itemText.lines(it, reqCtx), (it) => game.priceOf(it, 'buy'));
      if (inter?.mode === 'menu') npcMenu.draw(ctx, inter, npcName(inter.typeId), str, input.mouse);
      if (inter?.mode === 'hire') hirePanel.draw(ctx, inter.hire, s.player.gold, str, input.mouse);
      if (!inter || inter.mode !== 'hire') hireConfirm.pending = null;
      // 메뉴가 떠 있으면 대사 상자는 그 아래 (근사: 원작은 대사 동안 메뉴를 숨긴다)
      talkBox.draw(ctx, now, inter?.mode === 'menu' ? npcMenu.bottom + 8 : 90);
      mercBar.draw(ctx, s.merc, s.merc ? str(s.merc.name) : '');
      // 왼쪽 위 메시지 (용병 초상이 있으면 그 오른쪽) — 패널·툴팁 아래
      messageLog.draw(ctx, now, s.merc ? 64 : 10, 10);
      // 왼쪽 패널 자리: 캐릭터·보관함·웨이포인트·퀘스트 / 오른쪽: 스킬 트리·인벤토리
      charPanel.draw(ctx, input.mouse);
      stashPanel.draw(ctx, game.store, game.stashGold, ch.level, str, input.mouse, (it) => itemText.lines(it, reqCtx));
      // 용병 창: 요구치는 용병 능력치로 (원작 ITEMS_CheckRequirements(용병)), 용병이 죽거나 없으면 닫는다
      if (mercPanel.open && (!s.merc || s.merc.dead)) mercPanel.open = false;
      const mercReq = { level: s.merc?.level ?? 0, str: s.merc?.stats?.str ?? 0, dex: s.merc?.stats?.dex ?? 0, cls: '' };
      mercPanel.draw(ctx, s.merc, str, input.mouse, !!game.store.cursor, (it) => itemText.lines(it, mercReq));
      if (cubePanel.open && !game.cubeOpen) cubePanel.open = false;
      cubePanel.draw(ctx, game.store, str, input.mouse, (it) => itemText.lines(it, reqCtx), now);
      // 웨이포인트에서 멀어지면 패널을 닫는다 (원작 SUNIT_ResetInteractInfo)
      if (wpPanel.open && !game.waypointOpen) wpPanel.open = false;
      wpPanel.draw(ctx);
      questPanel.draw(ctx, questPanel.tab === 0 ? s.quests : game.questLog(questPanel.tab), str, now);
      skillPanels?.draw(ctx, input.mouse);
      invPanel.draw(ctx, game.store, s.player.gold, ch.level * 10000, input.mouse, reqCtx, str);
      // 원작 DC6 컨트롤 패널
      hud.draw(ctx, hudState());
      goldPopup.draw(ctx);
      hireConfirm.draw(ctx, str);
      // 용병 초상 안내 (확장팩 hireiconinfo1·2)
      const mm0 = input.mouse;
      if (data.expansion && mm0 && s.merc && !s.merc.dead && !game.store.cursor && mm0.x >= MERC_BAR.x && mm0.y >= MERC_BAR.y && mm0.x < MERC_BAR.x + MERC_BAR.w && mm0.y < MERC_BAR.y + MERC_BAR.h)
        drawTooltip(ctx, [{ text: str('hireiconinfo1'), color: '#ffffff' }, { text: str('hireiconinfo2').replace('%s', keyBindings.label(keyBindings.map.hireling, str)), color: '#ffffff' }], mm0.x, mm0.y + 60);
      invPanel.drawCursor(ctx, game.store, input.mouse);
      panels.draw(ctx, now);
      // 레벨 이동 로딩 화면 (원작: 계단·입구·웨이포인트·포털)
      loading.draw(ctx, now);
      // 원작 커서: 아이템을 들면 그 그림, 감정 = 돋보기, 수리 모드 = 망치, 가리키면 손 애니메이션
      const overInv = !!input.mouse && !!(invPanel.itemAt(game.store, input.mouse.x, input.mouse.y) ?? stashPanel.itemAt(game.store, input.mouse.x, input.mouse.y) ?? mercPanel.itemAt(s.merc, input.mouse.x, input.mouse.y) ?? cubePanel.itemAt(game.store, input.mouse.x, input.mouse.y));
      cursor.draw(ctx, art, input.mouse, cursor.pick({
        holding: !!game.store.cursor, identify: identifyWith !== null,
        repair: storePanel.mode === 'repair' && !!inter && inter.mode === 'trade' && !panels.menuOpen,
        hover: !panels.menuOpen && (overInv || (hoverNow !== null && hoverNow.kind !== 'body')),
      }), now);
      if (worldPx) finishCapture(worldPx);
    };
    // 한 프레임에서 예외가 나도 루프가 멈추지 않게 한다 (예외 후 다음 프레임 예약이 빠져 화면이 검게 멈추던 문제).
    // 같은 오류는 한 번만 콘솔에 남긴다.
    const reported = new Set<string>();
    // dev 전용 진단: 2초마다 게임 상태를 개발 서버 로그로 보낸다 (검은 화면 원인 추적용 — 프레임 수·최장 프레임·레벨·로딩 화면·오디오 목소리 수)
    const ticksOf = () => (game as unknown as { tickCount: number }).tickCount;
    let diagFrames = 0, diagMaxMs = 0, diagTick = ticksOf(), diagErrors = 0;
    const diagTimer = import.meta.env.DEV
      ? window.setInterval(() => {
          if (!running) {
            window.clearInterval(diagTimer);
            return;
          }
          const s = game.snapshot();
          const audio = (window as unknown as { __audio?: { voices?: unknown[]; unlocked?: boolean } }).__audio;
          const state = {
            frames: diagFrames, maxFrameMs: Math.round(diagMaxMs), ticks: ticksOf() - diagTick, errors: diagErrors,
            level: game.levelId, loading: loading.active(performance.now()), vis: document.visibilityState, menu: panels.menuOpen,
            player: { x: Math.round(s.player.x), y: Math.round(s.player.y), mode: s.player.mode, life: Math.round(s.player.life), dead: game.isDead },
            monsters: s.monsters.length, missiles: s.missiles.length, voices: audio?.voices?.length ?? -1, unlocked: audio?.unlocked,
            cam: [Math.round(cam.x), Math.round(cam.y)],
            gfxLost: gfxEvents.lost, gfxRestored: gfxEvents.restored, gl: { ...glStats }, unitLoads: unitGfxStats.loads, units: unitGfxStats.cached, sprites: spriteCache.size, spriteMpx: Math.round(spriteCache.pixels / 1e5) / 10, heapMb: Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6),
          };
          diagFrames = 0;
          diagMaxMs = 0;
          diagTick = ticksOf();
          // 화면 가운데 픽셀 (월드+UI 합성) — 다음 프레임에 읽어 함께 보낸다
          void capture().then((img) => {
            const i = (250 * WIDTH + 400) * 4;
            const body = { ...state, centerPixel: [img.data[i], img.data[i + 1], img.data[i + 2]] };
            return fetch('/__clientlog', { method: 'POST', body: `[diag] ${JSON.stringify(body)}` });
          }).catch(() => undefined);
        }, 2000)
      : 0;
    const frame = (now: number) => {
      if (!running) return;
      const t0 = performance.now();
      try {
        frameBody(now);
      } catch (e) {
        diagErrors++;
        const key = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
        if (!reported.has(key)) {
          reported.add(key);
          console.error('[frame]', e);
          reportClientError('frame', e);
        }
      }
      diagFrames++;
      // 약 1초마다 그림이 사라졌는지 확인 (브라우저가 그래픽 메모리를 회수한 경우 다시 그린다)
      if (diagFrames % 60 === 0 && healGraphics()) reportClientError('healed', 'graphics repainted');
      diagMaxMs = Math.max(diagMaxMs, performance.now() - t0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

boot().catch((e: unknown) => {
  const app = document.getElementById('app');
  if (app) app.textContent = `오류: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
