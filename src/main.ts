// 브라우저 진입점: 원작 MPQ 로드 → 메인메뉴 → (새 캐릭터 | 불러오기) → 게임(마을·Blood Moor) → Save and Exit → 메뉴.
import { gfxEvents, healGraphics, spriteCache } from './render/sprites';
import { AssetLoader } from './assets/loader';
import { loadGameData } from './assets/gamedata-loader';
import { parsePalette, type Palette } from './formats/palette';
import { AnimData } from './formats/animdata';
import { ACT1_WORLD_TABLES, act1WorldPaths, buildAct1World } from './data/act1-world';
import type { GameTables } from './data/tables';
import { CLASS_TOKEN, Game, type GameData } from './engine/game';
import { ENGINE_FPS } from './engine/index';
import { nearestWalkable } from './engine/path';
import { classStats, createCharacter, expTable, type ClassName } from './engine/player';
import { QUALITY, type ItemInstance } from './engine/treasure';
import { Rng } from './engine/rng';
import { makeSave, summarize, type CharacterSave } from './engine/save';
import { characterOwner } from './engine/skills/rules';
import { WorldRenderer } from './render/world';
import { Canvas2dSink, type SpriteSink } from './render/sink';
import { GlSink, glStats } from './render/gl/glsink';
import { type Camera } from './render/iso';
import { gfxBusy, ItemGfx, MissileGfx, UnitGfx, unitGfxStats } from './render/units';
import { buildScene, warmLevel } from './render/scene';
import { InputController } from './input/dom';
import { Menu } from './ui/menu';
import { HeroStore } from './ui/storage';
import { ControlPanel, type HudAction, type HudState } from './ui/hud';
import { Panels } from './ui/panels';
import { SkillTree } from './ui/skillpanel';
import { CharPanel } from './ui/charpanel';
import { StashPanel } from './ui/stashpanel';
import { UiArt } from './ui/art';
import { d2text, drawText } from './ui/text';
import { ItemText } from './ui/itemtext';
import { InventoryPanel, ItemIcons, parseInvLayout } from './ui/invpanel';
import { requirements } from './engine/inventory';
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
import { MercBar } from './ui/mercbar';
import { attachSound } from './audio/sound';
import { sound } from './audio/sound';
import { GameCursor, CURSOR_ART } from './ui/cursor';
import { LoadingScreen } from './ui/loading';
import { GoldPopup } from './ui/goldpopup';
import { MessageLog } from './ui/messages';
import { drawGroundLabels, type GroundLabel } from './ui/groundlabels';
import { keyBindings } from './ui/keys';
import { SkillTip } from './ui/skilltip';
import { QUALITY_COLOR } from './ui/itemtext';
import type { Hover } from './input/mapper';

const WIDTH = 800, HEIGHT = 600;
const PALETTE = 'data\\global\\palette\\ACT1\\pal.dat';
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
        /** e2e: 퀘스트 로그 패널 (Q) */
        quest: QuestPanel;
        /** e2e: 원작 DC6 컨트롤 패널·캐릭터(C)·스킬 트리(T)·보관함·게임 메뉴 */
        hud: ControlPanel; charPanel: CharPanel; skillTree: SkillTree; stash: StashPanel; gameMenu: Panels; art: UiArt;
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
  }
}

interface Shared {
  assets: AssetLoader; data: GameData; tables: GameTables; pal: Palette; anim: AnimData; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; host: HTMLElement; stage: HTMLElement; art: UiArt; loading: LoadingScreen; cursor: GameCursor;
  /** 월드(타일·유닛·미사일) 캔버스와 그리기 출구 — UI 캔버스(#game) 아래 */
  worldCanvas: HTMLCanvasElement; worldSink: SpriteSink;
}

// dev 전용: 오류를 개발 서버 로그로 보낸다 (vite.config.ts clientErrorLog)
function reportClientError(kind: string, e: unknown): void {
  if (!import.meta.env.DEV) return;
  const text = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  void fetch('/__clientlog', { method: 'POST', body: `[${kind}] ${location.href} ${text}` }).catch(() => undefined);
}
window.addEventListener('error', (e) => reportClientError('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportClientError('rejection', e.reason));

async function boot(): Promise<void> {
  const host = document.getElementById('app') as HTMLElement;
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
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#c7b377';
  ctx.font = '16px serif';
  ctx.fillText('Loading...', 20, 30);

  const assets = await AssetLoader.open('/d2/');
  await assets.preload([PALETTE, ANIMDATA, ...ACT1_WORLD_TABLES.map((t) => `data\\global\\excel\\${t}.txt`), 'data\\local\\lng\\eng\\string.tbl', 'data\\local\\lng\\eng\\expansionstring.tbl', 'data\\local\\lng\\eng\\patchstring.tbl']);
  const { data, tables } = await loadGameData(assets);
  // Act 1 오버월드 DRLG 가 읽는 원작 DS1/DT1 (LvlPrest·LvlSub·LvlTypes)
  await assets.preload(act1WorldPaths(assets, tables));
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
  const shared: Shared = { assets, data, tables, pal: gamePal, anim, canvas, ctx, host, stage, art: new UiArt(assets, gamePal), loading, cursor, worldCanvas, worldSink };
  void shared.art.preload(CURSOR_ART);

  const menu = new Menu(stage, ctx, new UiArt(assets, skyPal), new UiArt(assets, fecharPal));
  window.__menuArtReady = () => menu.ready && shared.art.ready(CURSOR_ART);
  menu.overlay = (c, m, now) => cursor.draw(c, shared.art, m, cursor.pick({ holding: false }), now);
  if (import.meta.env.DEV) {
    window.__cursor = cursor;
    window.__menu = menu;
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
      const wclass = ((eq.rarm ? data.items.base(eq.rarm.code)?.wclass : undefined) ?? 'hth').toUpperCase();
      looks.set(sv.name, { token: CLASS_TOKEN[sv.character.cls], wclass, equip: { ...BODY, ...playerLayers(data.items, eq) } });
    }
    return saves.map(summarize).sort((a, b) => b.savedAt - a.savedAt);
  };
  // 프런트엔드 소리: 메뉴 음악 (sounds.txt music_options = music\common\options.wav), 클래스 고르기 소리 (cursor_<클래스>_select)
  let inMenu = true, soundReady = false;
  menu.onSound = (n) => void sound.play(n);
  sound.bindUnlock();
  void sound.init({ assets, tables, data, cls: '' }).then(() => {
    soundReady = true;
    if (inMenu) sound.setMusic('music_options');
  }).catch(() => undefined);
  if (import.meta.env.DEV) window.__audio = sound;
  for (;;) {
    window.__menuReady = true;
    inMenu = true;
    // 표를 읽기 전에 부르면 이름만 남고 재생되지 않으므로 준비된 뒤에만
    if (soundReady) sound.setMusic('music_options');
    const choice = await menu.run(listHeroes);
    inMenu = false;
    window.__menuReady = false;
    menu.hide();
    const save = choice.kind === 'load' ? await HeroStore.load(choice.name) : null;
    const cls: ClassName = save?.character.cls ?? (choice.kind === 'new' ? choice.cls : 'Barbarian');
    // 원작: 게임을 시작하면 로딩 화면 (월드 만들기 동안)
    const game = await loading.around(ctx, () => play(shared, choice.name, cls, save));
    await game;
  }
}

/** 한 판 진행. Save and Exit 하면 resolve */
function play(sh: Shared, name: string, cls: ClassName, save: CharacterSave | null): Promise<void> {
  const { data, tables, assets, pal, anim, canvas, ctx, stage, art, loading, cursor, worldCanvas, worldSink } = sh;
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  // 원작 DRLG 이식: 게임 시드로 Act 1 오버월드 생성 (출처: D2MOO DRLG_AllocDrlg)
  const world = buildAct1World(assets, tables, data, seed);
  const renderers: Record<string, WorldRenderer> = {};
  // HUD 레벨 이름: levels.txt LevelName → 원작 문자열
  const levelNames: Record<string, string> = {};
  for (const l of world.levels) {
    renderers[l.key] = new WorldRenderer(l.preset);
    levelNames[l.key] = l.name;
  }
  const townMap = world.byKey.get('town')!.def.map;
  const units = new UnitGfx(assets);
  const itemGfx = new ItemGfx(assets);
  const missileGfx = new MissileGfx(assets);
  // 월드 그리기 출구 (팔레트 번호 그림 → 화면)
  worldSink.setPalette(pal);
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
    const all = [...inventoryGrid.map((p) => p.item), ...stash.map((p) => p.item), ...belt.filter((x): x is ItemInstance => !!x), ...Object.values(equipment)];
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
  const game = new Game({
    map: townMap, levels: world.levels.map((l) => l.def), player: { x: world.start.x, y: world.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed, data, character: save?.character ?? createCharacter(cs), classStats: cs, expTable: table, equipment, inventory, inventoryGrid, stash, belt, gold: save?.gold ?? 0,
    stashGold: save?.stashGold ?? 0, corpse: save?.corpse, waypoints: save?.waypoints, merc: save?.merc ?? null, quests: save?.quests, ...(save?.questFlags ? { questFlags: save.questFlags } : {}),
  });
  // ---- 사운드 (Phase 11): 원작 효과음·음악·대사 — 게임 사건을 엿들어 재생, 나갈 때 떼어낸다 (src/audio/sound.ts)
  const detachSound = attachSound(game, { assets, tables, data, cls });
  // 웨이포인트 패널·자동 지도·신전 메시지
  const wpPanel = new WaypointPanel(assets, pal);
  const automap = new AutomapRenderer(assets, pal, new AutomapTable(tables.table('AutoMap')));
  let automapMode: AutomapMode = 'off';
  let automapStyle: 'full' | 'mini' = 'full';
  let automapDrawn = 0;
  const worldByKey = world.byKey;
  // 왼쪽 위 게임 메시지 (신전·퀘스트 등 — 원작 글꼴, 흐려짐)
  const messageLog = new MessageLog();
  const act1Waypoints = data.objects ? waypointLevels([...data.objects.levels.values()]).filter((w) => w.act === 0) : [];
  const openWaypointPanel = () => {
    wpPanel.rows = act1Waypoints.map((w) => {
      const key = game.levelKeyOf(w.levelNo) ?? '';
      return { no: w.no, levelKey: key, name: worldByKey.get(key)?.name ?? key, active: game.waypoints.has(w.no), current: key === game.levelId };
    });
    wpPanel.open = true;
  };
  // 아이템 UI: 이름·설명(원작 문자열), 인벤토리 그림(DC6), 패널 좌표(inventory.txt)
  const itemText = new ItemText(data.items, data.treasure.gen, (k) => tables.string(k), tables.table('ItemStatCost'), tables.table('charstats'), tables.table('skills'), tables.table('skilldesc'));
  const icons = new ItemIcons(assets, pal, data.items);
  const invPanel = new InventoryPanel(parseInvLayout(tables.table('Inventory'), cls), icons, itemText, art);
  // 요구치를 못 채운 아이템은 빨간 바탕 (원작)
  invPanel.usable = (it) => {
    const r = requirements(data.items, it), c = game.character;
    return !c || (c.level >= r.level && game.effStat('str') >= r.str && game.effStat('dex') >= r.dex);
  };
  // 원작 DC6 컨트롤 패널 (HUD)·보관함
  const hud = new ControlPanel(art, icons, data.skills);
  const stashPanel = new StashPanel(art, icons);
  // NPC: 메뉴·대사·상점(원작 buysell.dc6)·고용 목록, 왼쪽 위 용병 초상 (원작 rogueicon.dc6)
  const storePanel = new StorePanel(assets, pal, icons);
  const npcMenu = new NpcMenu();
  const talkBox = new TalkBox();
  const hirePanel = new HirePanel();
  const mercBar = new MercBar(assets, pal);
  // 퀘스트 로그 (원작 questbackground.dc6 · a1q1~6.dc6 아이콘)
  const questPanel = new QuestPanel(assets, pal);
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
    // 컨트롤 패널 (원작: 패널 위 클릭은 월드로 가지 않는다)
    const cur0 = game.store.cursor;
    const ha = hud.click(x, y, hudState(), button);
    if (ha) {
      onHud(ha, button, cur0);
      return true;
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
      if (typeof r === 'number') game.enqueue({ type: 'hire', index: r });
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
      game.enqueue({ type: 'waypoint', level: wp });
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
    const skillTip = data.skillCalc ? new SkillTip({ calc: data.skillCalc, owner: () => characterOwner(ch), str }) : null;
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
    const openLeft = (which: 'char' | 'quest' | 'stash' | null) => {
      charPanel.open = which === 'char';
      if (which !== 'quest') questPanel.open = false;
      stashPanel.open = which === 'stash';
      if (which) wpPanel.open = false;
    };
    const openRight = (which: 'inv' | 'tree' | null) => {
      invPanel.open = which === 'inv';
      if (skillPanels) skillPanels.open = which === 'tree';
    };
    const toggleChar = () => openLeft(charPanel.open ? null : 'char');
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
        if (e.key === 'Tab' || e.key === 'Alt') e.preventDefault();
        if (e.key === 'Escape') panels.back();
        else panels.key(e.key);
        return;
      }
      const act = keyBindings.actionOf(e);
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
      if (e.key === 'Escape' && (wpPanel.open || questPanel.open || charPanel.open || stashPanel.open || invPanel.open || skillPanels?.open || hud.beltOpen)) {
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
        questPanel.toggle(game.snapshot().quests);
        return;
      }
      if (e.key === 'Escape' && game.snapshot().interaction) {
        game.enqueue({ type: 'closeNpc' });
        return;
      }
      if (e.key === 'Escape') {
        if (game.isDead) {
          const p = nearestWalkable(townMap, world.start, 10) ?? world.start;
          game.respawn('town', p.x + 0.5, p.y + 0.5);
        } else panels.toggleMenu();
      } else if (act === 'inv') toggleInv();
      // 원작 벨트 단축키 1~4 (아래 줄)
      else if (act === 'belt1' || act === 'belt2' || act === 'belt3' || act === 'belt4') game.enqueue({ type: 'useBelt', slot: Number(act.slice(4)) - 1 });
      // 원작 단축키: T 스킬 트리, C 캐릭터, ~ 벨트 펼치기, N 메시지 지우기
      else if (act === 'tree') toggleTree();
      else if (act === 'char') toggleChar();
      else if (act === 'beltshow') hud.beltOpen = !hud.beltOpen;
      else if (act === 'clearmsg') messageLog.clear();
      // 원작: R = 달리기/걷기 (InputController 가 바꾼다), S = 스킬 고르기 (오른쪽)
      else if (act === 'skillpick') hud.skillMenu = hud.skillMenu ? null : 'right';
    };
    // 컨트롤 패널 동작 (클릭)
    hudState = () => ({ snap: game.snapshot(), ch, exp: table, dead: game.isDead, run: input.run, store: game.store, str, canSelect: (s, hand) => game.canSelectSkill(s, hand), mouse: input.mouse });
    onHud = (a: HudAction, button: number, cur: ItemInstance | null) => {
      if (a.kind === 'run') input.run = !input.run;
      else if (a.kind === 'minipanel') hud.miniOpen = !hud.miniOpen;
      else if (a.kind === 'newStats') {
        openLeft('char');
      } else if (a.kind === 'newSkill') openRight('tree');
      else if (a.kind === 'skillMenu') hud.skillMenu = hud.skillMenu === a.hand ? null : a.hand;
      else if (a.kind === 'setSkill') game.enqueue({ type: 'setSkill', hand: a.hand, skill: a.id });
      else if (a.kind === 'mini') {
        if (a.button === 'char') toggleChar();
        else if (a.button === 'inv') toggleInv();
        else if (a.button === 'tree') toggleTree();
        else if (a.button === 'automap') automapMode = automapMode === 'off' ? automapStyle : 'off';
        else if (a.button === 'quest') {
          if (!questPanel.open) openLeft('quest');
          questPanel.toggle(game.snapshot().quests);
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
      await HeroStore.save(makeSave(name, game.character!, game.gold, { inventory: st.inv.items, stash: st.stash.items, belt: st.belt, equipment: game.equipment,
        stashGold: game.stashGold, waypoints: game.waypoints.list(), merc: game.mercSave(), questFlags: game.questRecord.toJSON(), corpse: game.corpse ? (Object.fromEntries(Object.entries(game.corpse.items).filter(([, v]) => v)) as Record<string, ItemInstance>) : {},
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
          store: storePanel, npcMenu, hire: hirePanel, talk: talkBox, mercBar, inventory: invPanel, quest: questPanel,
          hud, charPanel, skillTree: skillPanels as SkillTree, stash: stashPanel, gameMenu: panels, art,
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
            } else if (ev.type === 'objectUnsupported' && Number(ev.operateFn) === 32) {
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
              // 근사(원작 미확인): 원작은 완료 소리와 퀘스트 단추 깜빡임 — 여기서는 화면 메시지
              messageLog.push(`${str(`qstsa1q${Number(ev.quest)}`)} — ${str('qstsComplete')}`, performance.now(), 'gold');
            } else if (ev.type === 'imbueOpened') {
              openLeft(null);
              openRight('inv');
              talkBox.hide();
            } else if (ev.type === 'actChange') {
              // TODO(Act 2 범위 밖): 클래식 Act 2 (Lut Gholein) 가 없다
              messageLog.push('Lut Gholein (Act II) - not available', performance.now());
            }
          }
        }
        acc -= step;
      }
      input.update(now);
      const s = game.snapshot();
      // 로딩 화면 동안 가까운 몬스터 그림을 미리 불러 해석한다 (로딩 화면은 그동안 기다린다)
      cam.x = s.player.x;
      cam.y = s.player.y;
      const rarm = game.equipment.rarm, larm = game.equipment.larm;
      const wclass = ((rarm ? data.items.base(rarm.code)?.wclass : undefined) ?? 'hth').toUpperCase();
      void larm;
      const equip: Record<string, string> = { ...BODY, ...playerLayers(data.items, game.equipment) };
      if (loading.active(now)) {
        warmLevel(s, { units, monsters: data.monsters });
        // 플레이어가 곧 쓸 동작 (걷기·달리기·공격·맞기)
        for (const mode of ['NU', 'WL', 'RN', 'A1', 'A2', 'GH']) units.warm({ root: 'CHARS', token, mode, wclass, equip }, s.player.dir);
      }
      const cpItems = game.corpse?.items;
      const corpseLook = cpItems
        ? { equip: { ...BODY, ...playerLayers(data.items, cpItems) }, wclass: ((cpItems.rarm ? data.items.base(cpItems.rarm.code)?.wclass : undefined) ?? 'hth').toUpperCase() }
        : undefined;
      // 가리킨 유닛 (지난 프레임 클릭 상자 — 패널·메뉴 위면 없음). 원작: 가리킨 유닛·오브젝트를 밝게
      const mm = input.mouse;
      const overUi = !mm || panels.menuOpen || goldPopup.open || !!invPanel.hit(mm.x, mm.y) || !!stashPanel.hit(mm.x, mm.y) || mm.y >= 553 || (!!skillPanels?.open && mm.x >= 400 && mm.y >= 60 && mm.y < 492) || (charPanel.open && mm.x < 400 && mm.y >= 60 && mm.y < 492);
      hoverNow = overUi || !mm ? null : input.hoverAt(mm.x, mm.y);
      // UI 캔버스는 투명으로 시작 (아래 월드 캔버스가 비친다)
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      (renderers[game.levelId] as WorldRenderer).render(
        worldSink,
        cam,
        buildScene(s, cam, { units, items: itemGfx, missiles: missileGfx, anim, monsters: data.monsters, itemDb: data.items, playerToken: token, playerWclass: wclass, playerEquip: equip, corpseLook, inTown: game.inTown, objectDb: data.objects, hover: hoverNow }, input.pickBoxes),
      );
      // 화면 캡처 요청: WebGL 화면은 그린 직후에만 읽을 수 있다
      const worldPx = captureWaiters.length ? readWorld() : null;
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
      // 메뉴가 떠 있으면 대사 상자는 그 아래 (근사: 원작은 대사 동안 메뉴를 숨긴다)
      talkBox.draw(ctx, now, inter?.mode === 'menu' ? npcMenu.bottom + 8 : 90);
      mercBar.draw(ctx, s.merc, s.merc ? str(s.merc.name) : '');
      // 왼쪽 위 메시지 (용병 초상이 있으면 그 오른쪽) — 패널·툴팁 아래
      messageLog.draw(ctx, now, s.merc ? 64 : 10, 10);
      // 왼쪽 패널 자리: 캐릭터·보관함·웨이포인트·퀘스트 / 오른쪽: 스킬 트리·인벤토리
      charPanel.draw(ctx, input.mouse);
      stashPanel.draw(ctx, game.store, game.stashGold, ch.level, str, input.mouse, (it) => itemText.lines(it, reqCtx));
      // 웨이포인트에서 멀어지면 패널을 닫는다 (원작 SUNIT_ResetInteractInfo)
      if (wpPanel.open && !game.waypointOpen) wpPanel.open = false;
      wpPanel.draw(ctx);
      questPanel.draw(ctx, s.quests, str, now);
      skillPanels?.draw(ctx, input.mouse);
      invPanel.draw(ctx, game.store, s.player.gold, ch.level * 10000, input.mouse, reqCtx, str);
      // 원작 DC6 컨트롤 패널
      hud.draw(ctx, hudState());
      goldPopup.draw(ctx);
      invPanel.drawCursor(ctx, game.store, input.mouse);
      panels.draw(ctx, now);
      // 레벨 이동 로딩 화면 (원작: 계단·입구·웨이포인트·포털)
      loading.draw(ctx, now);
      // 원작 커서: 아이템을 들면 그 그림, 감정 = 돋보기, 수리 모드 = 망치, 가리키면 손 애니메이션
      const overInv = !!input.mouse && !!(invPanel.itemAt(game.store, input.mouse.x, input.mouse.y) ?? stashPanel.itemAt(game.store, input.mouse.x, input.mouse.y));
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
