// 브라우저 진입점: 원작 MPQ 로드 → 메인메뉴 → (새 캐릭터 | 불러오기) → 게임(마을·Blood Moor) → Save and Exit → 메뉴.
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
import { makeSave, type CharacterSave } from './engine/save';
import { WorldRenderer } from './render/world';
import { type Camera } from './render/iso';
import { ItemGfx, MissileGfx, UnitGfx } from './render/units';
import { buildScene } from './render/scene';
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
      };
    };
    __menuReady?: boolean;
    /** e2e: 프런트엔드 그림을 다 읽었는가 */
    __menuArtReady?: () => boolean;
  }
}

interface Shared { assets: AssetLoader; data: GameData; tables: GameTables; pal: Palette; anim: AnimData; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; host: HTMLElement; stage: HTMLElement; art: UiArt }

async function boot(): Promise<void> {
  const host = document.getElementById('app') as HTMLElement;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.id = 'game';
  // 캔버스와 그 위의 투명 UI 단추 층을 같은 800×600 무대에 둔다
  const stage = document.createElement('div');
  stage.id = 'stage';
  Object.assign(stage.style, { position: 'relative', width: `${WIDTH}px`, height: `${HEIGHT}px` });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.append(canvas);
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
  const [skyPal, fecharPal] = await Promise.all(['Sky', 'fechar'].map(async (d) => {
    const b = await assets.load(`data\\global\\palette\\${d}\\pal.dat`);
    return b ? parsePalette(b) : gamePal;
  })) as [Palette, Palette];
  await d2text.load(assets, gamePal);
  const shared: Shared = { assets, data, tables, pal: gamePal, anim: AnimData.parse(assets.read(ANIMDATA) as Uint8Array), canvas, ctx, host, stage, art: new UiArt(assets, gamePal) };

  const menu = new Menu(stage, ctx, new UiArt(assets, skyPal), new UiArt(assets, fecharPal));
  window.__menuArtReady = () => menu.ready;
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
    const choice = await menu.run(() => HeroStore.list());
    inMenu = false;
    window.__menuReady = false;
    menu.hide();
    const save = choice.kind === 'load' ? await HeroStore.load(choice.name) : null;
    const cls: ClassName = save?.character.cls ?? (choice.kind === 'new' ? choice.cls : 'Barbarian');
    await play(shared, choice.name, cls, save);
  }
}

/** 한 판 진행. Save and Exit 하면 resolve */
function play(sh: Shared, name: string, cls: ClassName, save: CharacterSave | null): Promise<void> {
  const { data, tables, assets, pal, anim, canvas, ctx, stage, art } = sh;
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  // 원작 DRLG 이식: 게임 시드로 Act 1 오버월드 생성 (출처: D2MOO DRLG_AllocDrlg)
  const world = buildAct1World(assets, tables, data, seed);
  const renderers: Record<string, WorldRenderer> = {};
  // HUD 레벨 이름: levels.txt LevelName → 원작 문자열
  const levelNames: Record<string, string> = {};
  for (const l of world.levels) {
    renderers[l.key] = new WorldRenderer(l.preset, pal);
    levelNames[l.key] = l.name;
  }
  const townMap = world.byKey.get('town')!.def.map;
  const units = new UnitGfx(assets, pal);
  const itemGfx = new ItemGfx(assets, pal);
  const missileGfx = new MissileGfx(assets, pal);
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
  let message: { text: string; until: number } | null = null;
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
  input.intercept = (x, y, button, shift) => {
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
    const panels = new Panels(stage, art, () => void saveAndExit(), { get: (k) => sound.settings[k], set: (k, v) => sound.setVolume(k, v) });
    // 캐릭터 패널(C, 왼쪽)·스킬 트리(T, 오른쪽) — 원작 DC6, 투명 단추 층 #charpanel / #skilltree
    const charPanel = new CharPanel(stage, art, {
      character: () => ch, heroName: name, derived: () => game.derived(), classStats: cs, exp: table,
      weapon: () => (game.equipment.rarm ? data.items.base(game.equipment.rarm.code) : undefined),
      skillName, str, spendStat: (stat) => game.enqueue({ type: 'spendStat', stat }), onClose: () => (charPanel.open = false),
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // 원작: Tab = 자동 지도 켜기/끄기, V = 미니 지도 모드 전환
        e.preventDefault();
        automapMode = automapMode === 'off' ? automapStyle : 'off';
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        automapStyle = automapStyle === 'full' ? 'mini' : 'full';
        if (automapMode !== 'off') automapMode = automapStyle;
        return;
      }
      // 게임 메뉴가 열려 있으면 위·아래·Enter·Esc 만
      if (panels.menuOpen) {
        if (e.key === 'Escape') panels.back();
        else panels.key(e.key);
        return;
      }
      if (e.key === 'Escape' && hud.skillMenu) {
        hud.skillMenu = null;
        return;
      }
      // 원작: Esc 는 열린 패널부터 모두 닫는다
      if (e.key === 'Escape' && (wpPanel.open || questPanel.open || charPanel.open || stashPanel.open || invPanel.open || skillPanels?.open)) {
        wpPanel.open = false;
        questPanel.open = false;
        openLeft(null);
        openRight(null);
        return;
      }
      // 원작 단축키: Q 퀘스트 로그
      if (e.key === 'q' || e.key === 'Q') {
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
      } else if (e.key === 'i' || e.key === 'I') toggleInv();
      // 원작 벨트 단축키 1~4 (아래 줄)
      else if (e.key >= '1' && e.key <= '4') game.enqueue({ type: 'useBelt', slot: Number(e.key) - 1 });
      // 원작 단축키: T 스킬 트리, C 캐릭터
      else if (e.key === 't' || e.key === 'T') toggleTree();
      else if (e.key === 'c' || e.key === 'C') toggleChar();
      // 원작: R = 달리기/걷기 (InputController 가 바꾼다), S = 스킬 고르기 (오른쪽)
      else if (e.key === 's' || e.key === 'S') hud.skillMenu = hud.skillMenu ? null : 'right';
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
      window.removeEventListener('keydown', onKey);
      if (import.meta.env.DEV) delete window.__game;
      resolve();
    }
    window.addEventListener('keydown', onKey);
    if (import.meta.env.DEV) {
      window.__game = {
        game, ready: true, input, save: saveAndExit,
        ui: {
          waypoint: wpPanel, automap: () => automapMode, automapReady: () => automap.ready, automapDrawn: () => automapDrawn, hoverMonster: () => hoverMonster, camera: () => cam,
          store: storePanel, npcMenu, hire: hirePanel, talk: talkBox, mercBar, inventory: invPanel, quest: questPanel,
          hud, charPanel, skillTree: skillPanels as SkillTree, stash: stashPanel, gameMenu: panels, art,
        },
      };
    }

    const step = 1000 / ENGINE_FPS;
    let last = performance.now(), acc = 0;
    const frame = (now: number) => {
      if (!running) return;
      acc += Math.min(now - last, 250);
      last = now;
      input.enabled = !panels.menuOpen;
      // 원작 싱글플레이: 게임 메뉴가 열리면 게임이 멈춘다
      while (acc >= step) {
        if (!panels.menuOpen) {
          for (const ev of game.tick()) {
            if (ev.type === 'waypointMenu') {
              openLeft(null);
              openWaypointPanel();
            } else if (ev.type === 'objectUnsupported' && Number(ev.operateFn) === 32) {
              // 원작 보관함 (objects.txt bank, OperateFn 32): 보관함 + 인벤토리
              openLeft('stash');
              openRight('inv');
            }
            else if (ev.type === 'levelChanged') wpPanel.open = false;
            else if (ev.type === 'shrine') message = { text: tables.string(String(ev.message)), until: performance.now() + 4000 };
            else if (ev.type === 'locked') message = { text: 'Locked', until: performance.now() + 1500 };
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
              message = { text: ev.key === 'qstsa1q14' ? `${str('qstsa1q14')}${Number(ev.count)}` : str(String(ev.key)), until: performance.now() + 3000 };
            } else if (ev.type === 'questCompleted') {
              // 근사(원작 미확인): 원작은 완료 소리와 퀘스트 단추 깜빡임 — 여기서는 화면 메시지
              message = { text: `${str(`qstsa1q${Number(ev.quest)}`)} — ${str('qstsComplete')}`, until: performance.now() + 4000 };
            } else if (ev.type === 'imbueOpened') {
              openLeft(null);
              openRight('inv');
              talkBox.hide();
            } else if (ev.type === 'actChange') {
              // TODO(Act 2 범위 밖): 클래식 Act 2 (Lut Gholein) 가 없다
              message = { text: 'Lut Gholein (Act II) - not available', until: performance.now() + 4000 };
            }
          }
        }
        acc -= step;
      }
      input.update(now);
      const s = game.snapshot();
      cam.x = s.player.x;
      cam.y = s.player.y;
      const rarm = game.equipment.rarm, larm = game.equipment.larm;
      const wclass = ((rarm ? data.items.base(rarm.code)?.wclass : undefined) ?? 'hth').toUpperCase();
      void larm;
      const equip: Record<string, string> = { ...BODY, ...playerLayers(data.items, game.equipment) };
      const cpItems = game.corpse?.items;
      const corpseLook = cpItems
        ? { equip: { ...BODY, ...playerLayers(data.items, cpItems) }, wclass: ((cpItems.rarm ? data.items.base(cpItems.rarm.code)?.wclass : undefined) ?? 'hth').toUpperCase() }
        : undefined;
      (renderers[game.levelId] as WorldRenderer).render(
        ctx,
        cam,
        buildScene(s, cam, { units, items: itemGfx, missiles: missileGfx, anim, monsters: data.monsters, itemDb: data.items, playerToken: token, playerWclass: wclass, playerEquip: equip, corpseLook, inTown: game.inTown, objectDb: data.objects }, input.pickBoxes),
      );
      if (automapMode !== 'off') {
        const wl = worldByKey.get(game.levelId);
        const reveal = game.automapOf(game.levelId);
        if (wl && reveal) {
          const objs = game.objects;
          automapDrawn = automap.draw(ctx, automapMode, wl.preset, wl.automapName, reveal, {
            player: { x: s.player.x, y: s.player.y },
            waypoints: objs.filter((o) => o.type.subClass & SUBCLASS.WAYPOINT).map((o) => ({ x: o.x, y: o.y })),
            portals: objs.filter((o) => o.portal).map((o) => ({ x: o.x, y: o.y })),
            // 출구 표시: 드러난 곳의 출구에 도착 레벨의 LevelWarp 문자열
            exits: game.exits.filter((e) => reveal.isSeen(Math.floor((e.x + e.w / 2) / 5), Math.floor((e.y + e.h / 2) / 5)))
              .map((e) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2, label: worldByKey.get(e.to)?.warpLabel || e.to })),
          }, WIDTH, HEIGHT);
        }
        // 원작: 자동 지도를 켜면 오른쪽 위에 지역 이름 (근사: 위치·색)
        drawText(ctx, levelNames[game.levelId] ?? '', WIDTH - 12, 12, { align: 'right', color: 'gold' });
      }
      hoverMonster = null;
      if (input.mouse) {
        const mx = input.mouse.x, my = input.mouse.y;
        const pick = [...input.pickBoxes].reverse().find((b) => (b.kind === 'monster' || b.kind === 'npc') && mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h);
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
      if (message && now < message.until) drawText(ctx, message.text, WIDTH / 2, 80, { align: 'center', color: 'gold' });
      // 감정 커서 (근사: 원작 커서 그림 대신 글자)
      if (identifyWith !== null && input.mouse) drawText(ctx, 'Identify', input.mouse.x + 12, input.mouse.y - 4, { color: 'gold' });
      invPanel.drawCursor(ctx, game.store, input.mouse);
      panels.draw(ctx, now);
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
