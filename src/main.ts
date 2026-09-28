// 브라우저 진입점: 원작 MPQ 로드 → 메인메뉴 → (새 캐릭터 | 불러오기) → 게임(마을·Blood Moor) → Save and Exit → 메뉴.
import { AssetLoader } from './assets/loader';
import { loadGameData } from './assets/gamedata-loader';
import { parsePalette, type Palette } from './formats/palette';
import { AnimData } from './formats/animdata';
import { act1SlicePaths, buildSliceWorld, townDt1Paths } from './data/act1';
import type { GameTables } from './data/tables';
import { Game, type GameData } from './engine/game';
import { ENGINE_FPS } from './engine/index';
import { nearestWalkable } from './engine/path';
import { classStats, createCharacter, expTable } from './engine/player';
import { QUALITY, type ItemInstance } from './engine/treasure';
import { Rng } from './engine/rng';
import { makeSave, type CharacterSave } from './engine/save';
import { WorldRenderer } from './render/world';
import { type Camera } from './render/iso';
import { ItemGfx, UnitGfx } from './render/units';
import { buildScene } from './render/scene';
import { InputController } from './input/dom';
import { Menu } from './ui/menu';
import { HeroStore } from './ui/storage';
import { drawHud } from './ui/hud';
import { Panels } from './ui/panels';

const WIDTH = 800, HEIGHT = 600;
const PALETTE = 'data\\global\\palette\\ACT1\\pal.dat';
const ANIMDATA = 'data\\global\\AnimData.d2';
// 바바리안 외형 (방어구 없음 = lit). 무기/방패 레이어는 장착 아이템 코드로 결정
const BARB_BODY = { HD: 'lit', TR: 'lit', LG: 'lit', RA: 'lit', LA: 'lit', S1: 'lit', S2: 'lit' };
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
    await play(shared, choice.name, save);
  }
}

/** 한 판 진행. Save and Exit 하면 resolve */
function play(sh: Shared, name: string, save: CharacterSave | null): Promise<void> {
  const { data, tables, assets, pal, anim, canvas, ctx, host } = sh;
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const world = buildSliceWorld(assets, tables, data, seed);
  const renderers: Record<string, WorldRenderer> = { town: new WorldRenderer(world.town, pal), bloodmoor: new WorldRenderer(world.bloodMoor, pal) };
  const units = new UnitGfx(assets, pal);
  const itemGfx = new ItemGfx(assets, pal);
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const table = expTable(tables.table('experience'), 'Barbarian');
  const itemRng = new Rng(seed ^ 7);

  let equipment: Record<string, ItemInstance>, inventory: ItemInstance[];
  if (save) {
    equipment = save.equipment;
    inventory = save.inventory;
    data.treasure.reserveIds(Math.max(0, ...[...inventory, ...Object.values(equipment)].map((i) => i.id)));
  } else {
    // 출처: charstats.txt 바바리안 시작 장비 (hax 오른손, buc 왼손, hp1 ×4, 두루마리)
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
    seed, data, character: save?.character ?? createCharacter(cs), classStats: cs, expTable: table, equipment, inventory, gold: save?.gold ?? 0,
  });

  const cam: Camera = { x: world.start.x, y: world.start.y, width: WIDTH, height: HEIGHT };
  const input = new InputController(canvas, () => cam, (c) => game.enqueue(c));
  const nameOf = (code: string) => tables.string(data.items.base(code)?.namestr ?? code);

  return new Promise((resolve) => {
    let running = true;
    const panels = new Panels(host, nameOf, () => void saveAndExit());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (game.isDead) {
          const p = nearestWalkable(world.town.collision, world.start, 10) ?? world.start;
          game.respawn('town', p.x + 0.5, p.y + 0.5);
        } else panels.toggleMenu();
      } else if (e.key === 'i' || e.key === 'I') panels.toggleInventory();
    };
    async function saveAndExit(): Promise<void> {
      await HeroStore.save(makeSave(name, game.character!, game.gold, game.inventory, game.equipment));
      running = false;
      input.dispose();
      panels.dispose();
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
      const equip: Record<string, string> = { ...BARB_BODY, ...(rarm ? { RH: rarm.code } : {}), ...(larm ? { SH: larm.code } : {}) };
      (renderers[game.levelId] as WorldRenderer).render(
        ctx,
        cam,
        buildScene(s, cam, { units, items: itemGfx, anim, monsters: data.monsters, itemDb: data.items, playerToken: 'BA', playerWclass: wclass, playerEquip: equip, inTown: game.inTown }, input.pickBoxes),
      );
      drawHud(ctx, s, table, LEVEL_NAMES[game.levelId] ?? '', game.isDead);
      panels.renderInventory(s.inventory, game.equipment, s.player.gold);
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
