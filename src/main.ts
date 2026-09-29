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
import { drawHud } from './ui/hud';
import { Panels } from './ui/panels';
import { SkillPanels } from './ui/skillpanel';
import { ItemText } from './ui/itemtext';
import { InventoryPanel, ItemIcons, parseInvLayout } from './ui/invpanel';
import { drawBelt } from './ui/hud';
import { playerLayers } from './render/appearance';
import type { Placed } from './engine/inventory';
import { AutomapTable } from './engine/automap';
import { SUBCLASS } from './engine/objects';
import { waypointLevels } from './engine/waypoints';
import { AutomapRenderer, type AutomapMode } from './render/automap';
import { WaypointPanel } from './ui/waypanel';
import { drawMonsterBar, MonsterNamer } from './ui/monbar';
import { StorePanel } from './ui/storepanel';
import { HirePanel, NpcMenu, pickGossip, TalkBox } from './ui/npcpanel';
import { MercBar } from './ui/mercbar';

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
      };
    };
    __menuReady?: boolean;
  }
}

interface Shared { assets: AssetLoader; data: GameData; tables: GameTables; pal: Palette; anim: AnimData; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; host: HTMLElement }

async function boot(): Promise<void> {
  const host = document.getElementById('app') as HTMLElement;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.id = 'game';
  host.replaceChildren(canvas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#c7b377';
  ctx.font = '16px serif';
  ctx.fillText('Loading...', 20, 30);

  const assets = await AssetLoader.open('/d2/');
  await assets.preload([PALETTE, ANIMDATA, ...ACT1_WORLD_TABLES.map((t) => `data\\global\\excel\\${t}.txt`), 'data\\local\\lng\\eng\\string.tbl', 'data\\local\\lng\\eng\\expansionstring.tbl', 'data\\local\\lng\\eng\\patchstring.tbl']);
  const { data, tables } = await loadGameData(assets);
  // Act 1 오버월드 DRLG 가 읽는 원작 DS1/DT1 (LvlPrest·LvlSub·LvlTypes)
  await assets.preload(act1WorldPaths(assets, tables));
  const shared: Shared = { assets, data, tables, pal: parsePalette(assets.read(PALETTE) as Uint8Array), anim: AnimData.parse(assets.read(ANIMDATA) as Uint8Array), canvas, ctx, host };

  const menu = new Menu(host);
  for (;;) {
    window.__menuReady = true;
    const choice = await menu.run(() => HeroStore.list());
    window.__menuReady = false;
    menu.hide();
    const save = choice.kind === 'load' ? await HeroStore.load(choice.name) : null;
    const cls: ClassName = save?.character.cls ?? (choice.kind === 'new' ? choice.cls : 'Barbarian');
    await play(shared, choice.name, cls, save);
  }
}

/** 한 판 진행. Save and Exit 하면 resolve */
function play(sh: Shared, name: string, cls: ClassName, save: CharacterSave | null): Promise<void> {
  const { data, tables, assets, pal, anim, canvas, ctx, host } = sh;
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
    stashGold: save?.stashGold ?? 0, corpse: save?.corpse, waypoints: save?.waypoints, merc: save?.merc ?? null, quests: save?.quests,
  });
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
  const invPanel = new InventoryPanel(parseInvLayout(tables.table('Inventory'), cls), icons, itemText);
  // NPC: 메뉴·대사·상점(원작 buysell.dc6)·고용 목록, 왼쪽 위 용병 초상 (원작 rogueicon.dc6)
  const storePanel = new StorePanel(assets, pal, icons);
  const npcMenu = new NpcMenu();
  const talkBox = new TalkBox();
  const hirePanel = new HirePanel();
  const mercBar = new MercBar(assets, pal);
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
  input.intercept = (x, y, button, shift) => {
    // NPC 대화: 메뉴 → 고용 목록 → 상점 (원작: 대화 중 바깥 클릭 = 닫고 이동)
    const inter = game.snapshot().interaction;
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
  const nameOf = (code: string) => tables.string(data.items.base(code)?.namestr ?? code);
  // 화면 위 몬스터 이름·생명 막대 (마우스를 올린 몬스터)
  const namer = new MonsterNamer(data.monsters, data.uniques, (k) => tables.string(k));
  let hoverMonster: { id: number; name: string; box: { x: number; y: number; w: number; h: number } } | null = null;
  const skillName = (id: number) => data.skills?.byId.get(id)?.displayName ?? 'Attack';


  return new Promise((resolve) => {
    let running = true;
    const panels = new Panels(host, nameOf, () => void saveAndExit());
    const skillPanels = data.skills
      ? new SkillPanels(host, {
          db: data.skills,
          character: () => ch,
          learn: (id) => game.enqueue({ type: 'spendSkill', skill: id }),
          setSkill: (hand, id) => game.enqueue({ type: 'setSkill', hand, skill: id }),
          canSelect: (s, hand) => game.canSelectSkill(s, hand),
          spendStat: (stat) => game.enqueue({ type: 'spendStat', stat }),
        })
      : null;
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
      if (e.key === 'Escape' && wpPanel.open) {
        wpPanel.open = false;
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
        } else if (skillPanels?.open) {
          if (skillPanels.skills.style.display === 'block') skillPanels.toggleSkills();
          else skillPanels.toggleChar();
        } else panels.toggleMenu();
      } else if (e.key === 'i' || e.key === 'I') invPanel.open = !invPanel.open;
      // 원작 벨트 단축키 1~4 (아래 줄)
      else if (e.key >= '1' && e.key <= '4') game.enqueue({ type: 'useBelt', slot: Number(e.key) - 1 });
      // 원작 단축키: T 스킬 트리, C 캐릭터
      else if (e.key === 't' || e.key === 'T') skillPanels?.toggleSkills();
      else if (e.key === 'c' || e.key === 'C') skillPanels?.toggleChar();
    };
    async function saveAndExit(): Promise<void> {
      const st = game.store;
      await HeroStore.save(makeSave(name, game.character!, game.gold, { inventory: st.inv.items, stash: st.stash.items, belt: st.belt, equipment: game.equipment,
        stashGold: game.stashGold, waypoints: game.waypoints.list(), merc: game.mercSave(), quests: [...game.quests], corpse: game.corpse ? (Object.fromEntries(Object.entries(game.corpse.items).filter(([, v]) => v)) as Record<string, ItemInstance>) : {},
      }));
      running = false;
      input.dispose();
      panels.dispose();
      skillPanels?.dispose();
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
          store: storePanel, npcMenu, hire: hirePanel, talk: talkBox, mercBar, inventory: invPanel,
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
            if (ev.type === 'waypointMenu') openWaypointPanel();
            else if (ev.type === 'levelChanged') wpPanel.open = false;
            else if (ev.type === 'shrine') message = { text: tables.string(String(ev.message)), until: performance.now() + 4000 };
            else if (ev.type === 'locked') message = { text: 'Locked', until: performance.now() + 1500 };
            else if (ev.type === 'npcTalk') {
              talkBox.show(npcName(String(ev.typeId)), pickGossip(str, String(ev.gossip), cls, !!ev.intro, Number(ev.pick)), performance.now());
            } else if (ev.type === 'storeOpened') {
              invPanel.open = true;
              talkBox.hide();
            } else if (ev.type === 'npcClosed') {
              storePanel.hide();
              talkBox.hide();
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
      }
      drawHud(ctx, s, table, levelNames[game.levelId] ?? '', game.isDead, {
        leftSkill: skillName(ch.leftSkill), rightSkill: skillName(ch.rightSkill), statPoints: ch.statPoints, skillPoints: ch.skillPoints,
      });
      drawBelt(ctx, game.store, icons);
      hoverMonster = null;
      if (input.mouse) {
        const mx = input.mouse.x, my = input.mouse.y;
        const pick = [...input.pickBoxes].reverse().find((b) => (b.kind === 'monster' || b.kind === 'npc') && mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h);
        const hm = pick ? s.monsters.find((x) => x.id === pick.id && x.mode !== 'DT' && x.mode !== 'DD') : undefined;
        if (hm?.npc) {
          // 원작: NPC 위에 마우스를 올리면 이름만 (생명 막대 없음)
          ctx.save();
          ctx.font = '15px serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          const nm = npcName(hm.typeId), tw = ctx.measureText(nm).width + 24;
          ctx.fillRect(WIDTH / 2 - tw / 2, 8, tw, 22);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(nm, WIDTH / 2, 23);
          ctx.restore();
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
      talkBox.draw(ctx, now);
      mercBar.draw(ctx, s.merc, s.merc ? str(s.merc.name) : '');
      invPanel.draw(ctx, game.store, s.player.gold, ch.level * 10000, input.mouse, reqCtx);
      invPanel.drawCursor(ctx, game.store, input.mouse);
      // 감정 커서 (근사: 원작 커서 그림 대신 글자)
      if (identifyWith !== null && input.mouse) {
        ctx.fillStyle = '#c7b377';
        ctx.font = '13px serif';
        ctx.fillText('Identify', input.mouse.x + 12, input.mouse.y + 4);
      }
      // 웨이포인트에서 멀어지면 패널을 닫는다 (원작 SUNIT_ResetInteractInfo)
      if (wpPanel.open && !game.waypointOpen) wpPanel.open = false;
      wpPanel.draw(ctx);
      if (message && now < message.until) {
        ctx.font = '16px serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#c7b377';
        ctx.fillText(message.text, WIDTH / 2, 90);
        ctx.textAlign = 'left';
      }
      skillPanels?.render();
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
