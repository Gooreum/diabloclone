// 브라우저 진입점: 원작 MPQ 로드 → 메인메뉴 → (새 캐릭터 | 불러오기) → 게임(마을·Blood Moor) → Save and Exit → 메뉴.
import { AssetLoader } from './assets/loader';
import { loadGameData } from './assets/gamedata-loader';
import { parsePalette, type Palette } from './formats/palette';
import { AnimData } from './formats/animdata';
import { act1SlicePaths, buildSliceWorld, townDt1Paths } from './data/act1';
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

const WIDTH = 800, HEIGHT = 600;
const PALETTE = 'data\\global\\palette\\ACT1\\pal.dat';
const ANIMDATA = 'data\\global\\AnimData.d2';
// 캐릭터 외형 (방어구 없음 = lit). 무기/방패 레이어는 장착 아이템 코드로 결정
// 출처: Phrozen Keep COF 문서 — 레이어 HD 머리, TR 몸통, LG 다리, RA/LA 팔, RH 오른손 무기, LH 왼손(활), SH 방패, S1/S2 어깨
const BODY = { HD: 'lit', TR: 'lit', LG: 'lit', RA: 'lit', LA: 'lit', S1: 'lit', S2: 'lit' };
const LEVEL_NAMES: Record<string, string> = { town: 'Rogue Encampment', bloodmoor: 'Blood Moor' };

declare global {
  interface Window {
    __game?: { game: Game; ready: boolean; input?: InputController; save?: () => Promise<void> };
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
  await assets.preload([PALETTE, ANIMDATA, 'data\\global\\excel\\LvlPrest.txt', 'data\\global\\excel\\LvlTypes.txt', 'data\\local\\lng\\eng\\string.tbl', 'data\\local\\lng\\eng\\expansionstring.tbl', 'data\\local\\lng\\eng\\patchstring.tbl']);
  const { data, tables } = await loadGameData(assets);
  await assets.preload(act1SlicePaths(tables));
  await assets.preload(townDt1Paths(assets));
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
  const world = buildSliceWorld(assets, tables, data, seed);
  const renderers: Record<string, WorldRenderer> = { town: new WorldRenderer(world.town, pal), bloodmoor: new WorldRenderer(world.bloodMoor, pal) };
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
    map: world.town.collision, levels: world.levels, player: { x: world.start.x, y: world.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed, data, character: save?.character ?? createCharacter(cs), classStats: cs, expTable: table, equipment, inventory, inventoryGrid, stash, belt, gold: save?.gold ?? 0,
    stashGold: save?.stashGold ?? 0, corpse: save?.corpse,
  });
  // 아이템 UI: 이름·설명(원작 문자열), 인벤토리 그림(DC6), 패널 좌표(inventory.txt)
  const itemText = new ItemText(data.items, data.treasure.gen, (k) => tables.string(k), tables.table('ItemStatCost'), tables.table('charstats'), tables.table('skills'), tables.table('skilldesc'));
  const icons = new ItemIcons(assets, pal, data.items);
  const invPanel = new InventoryPanel(parseInvLayout(tables.table('Inventory'), cls), icons, itemText);

  const cam: Camera = { x: world.start.x, y: world.start.y, width: WIDTH, height: HEIGHT };
  const ch = game.character!;
  const input = new InputController(canvas, () => cam, (c) => game.enqueue(c), () => ({ left: ch.leftSkill, right: ch.rightSkill }));
  // 인벤토리 패널·커서 아이템 클릭 처리 (원작: 왼쪽 = 집기/놓기, 오른쪽 = 사용, 패널 밖에 들고 클릭 = 떨어뜨리기)
  let identifyWith: number | null = null;
  input.intercept = (x, y, button) => {
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
      if (e.key === 'Escape') {
        if (game.isDead) {
          const p = nearestWalkable(world.town.collision, world.start, 10) ?? world.start;
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
        stashGold: game.stashGold, corpse: game.corpse ? (Object.fromEntries(Object.entries(game.corpse.items).filter(([, v]) => v)) as Record<string, ItemInstance>) : {},
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
    if (import.meta.env.DEV) window.__game = { game, ready: true, input, save: saveAndExit };

    const step = 1000 / ENGINE_FPS;
    let last = performance.now(), acc = 0;
    const frame = (now: number) => {
      if (!running) return;
      acc += Math.min(now - last, 250);
      last = now;
      input.enabled = !panels.menuOpen;
      // 원작 싱글플레이: 게임 메뉴가 열리면 게임이 멈춘다
      while (acc >= step) {
        if (!panels.menuOpen) game.tick();
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
        buildScene(s, cam, { units, items: itemGfx, missiles: missileGfx, anim, monsters: data.monsters, itemDb: data.items, playerToken: token, playerWclass: wclass, playerEquip: equip, corpseLook, inTown: game.inTown }, input.pickBoxes),
      );
      drawHud(ctx, s, table, LEVEL_NAMES[game.levelId] ?? '', game.isDead, {
        leftSkill: skillName(ch.leftSkill), rightSkill: skillName(ch.rightSkill), statPoints: ch.statPoints, skillPoints: ch.skillPoints,
      });
      drawBelt(ctx, game.store, icons);
      const reqCtx = { level: ch.level, str: game.effStat('str'), dex: game.effStat('dex'), cls: ch.cls };
      invPanel.draw(ctx, game.store, s.player.gold, ch.level * 10000, input.mouse, reqCtx);
      invPanel.drawCursor(ctx, game.store, input.mouse);
      // 감정 커서 (근사: 원작 커서 그림 대신 글자)
      if (identifyWith !== null && input.mouse) {
        ctx.fillStyle = '#c7b377';
        ctx.font = '13px serif';
        ctx.fillText('Identify', input.mouse.x + 12, input.mouse.y + 4);
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
