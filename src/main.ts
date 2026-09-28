// 브라우저 진입점: 원작 MPQ 로드 → Rogue Encampment + Blood Moor 구성 → 게임 루프(25fps) + 렌더 루프.
import { AssetLoader } from './assets/loader';
import { loadGameData } from './assets/gamedata-loader';
import { parsePalette } from './formats/palette';
import { AnimData } from './formats/animdata';
import { act1SlicePaths, buildSliceWorld, townDt1Paths } from './data/act1';
import { Game } from './engine/game';
import { ENGINE_FPS } from './engine/index';
import { nearestWalkable } from './engine/path';
import { classStats, createCharacter, expTable } from './engine/player';
import { QUALITY } from './engine/treasure';
import { Rng } from './engine/rng';
import { WorldRenderer } from './render/world';
import { type Camera } from './render/iso';
import { ItemGfx, UnitGfx } from './render/units';
import { buildScene } from './render/scene';
import { InputController } from './input/dom';

const WIDTH = 800, HEIGHT = 600;
const PALETTE = 'data\\global\\palette\\ACT1\\pal.dat';
const ANIMDATA = 'data\\global\\AnimData.d2';
// 바바리안 시작 외형 (charstats 시작 장비: 오른손 hax, 왼손 buc / 방어구 없음 = lit)
const BARB_EQUIP = { HD: 'lit', TR: 'lit', LG: 'lit', RA: 'lit', LA: 'lit', RH: 'hax', SH: 'buc', S1: 'lit', S2: 'lit' };

declare global {
  interface Window { __game?: { game: Game; ready: boolean; input?: InputController } }
}

async function boot(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.id = 'game';
  app.replaceChildren(canvas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#c7b377';
  ctx.font = '16px serif';
  ctx.fillText('Loading...', 20, 30);

  const assets = await AssetLoader.open('/d2/');
  await assets.preload([PALETTE, ANIMDATA, 'data\\global\\excel\\LvlPrest.txt', 'data\\global\\excel\\LvlTypes.txt']);
  const { data, tables } = await loadGameData(assets);
  await assets.preload(act1SlicePaths(tables));
  await assets.preload(townDt1Paths(assets));
  const seed = Date.now() >>> 0;
  const world = buildSliceWorld(assets, tables, data, seed);
  const pal = parsePalette(assets.read(PALETTE) as Uint8Array);
  const renderers: Record<string, WorldRenderer> = { town: new WorldRenderer(world.town, pal), bloodmoor: new WorldRenderer(world.bloodMoor, pal) };
  const units = new UnitGfx(assets, pal);
  const itemGfx = new ItemGfx(assets, pal);
  const anim = AnimData.parse(assets.read(ANIMDATA) as Uint8Array);

  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const character = createCharacter(cs);
  const itemRng = new Rng(seed ^ 7);
  const equipment = Object.fromEntries(
    cs.startItems.filter((i) => i.loc === 'rarm' || i.loc === 'larm').map((i) => [i.loc, data.treasure.createItem(data.items.base(i.code)!, 1, itemRng, QUALITY.NORMAL)]),
  );
  const params = new URLSearchParams(location.search);
  const game = new Game({
    map: world.town.collision, levels: world.levels, player: { x: world.start.x, y: world.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed, data, character, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), equipment,
  });
  if (import.meta.env.DEV && params.get('test') === 'monsters') {
    game.changeLevel('bloodmoor', 30.5, world.levels[1]!.exits[0]!.y + 50);
    const base = game.snapshot().player;
    for (const [id, dx, dy] of [['zombie1', 8, 0], ['fallen1', 0, 8], ['quillrat1', -8, 3]] as const) {
      const p = nearestWalkable(game.map, { x: base.x + dx, y: base.y + dy }, 10) ?? base;
      game.spawnMonster(id, p.x + 0.5, p.y + 0.5);
    }
    game.dropItem(data.treasure.createItem(data.items.base('hax')!, 1, itemRng, QUALITY.NORMAL), base.x + 3, base.y - 3);
  }

  const cam: Camera = { x: world.start.x, y: world.start.y, width: WIDTH, height: HEIGHT };
  const input = new InputController(canvas, () => cam, (c) => game.enqueue(c));
  if (import.meta.env.DEV) window.__game = { game, ready: true, input };

  const step = 1000 / ENGINE_FPS;
  let last = performance.now(), acc = 0;
  const frame = (now: number) => {
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= step) {
      game.tick();
      acc -= step;
    }
    input.update(now);
    const s = game.snapshot();
    cam.x = s.player.x;
    cam.y = s.player.y;
    const renderer = renderers[game.levelId] as WorldRenderer;
    // 마을에서는 대기/걷기가 TN/TW 모드 (원작 COF: BATN1HS, BATW1HS)
    renderer.render(
      ctx,
      cam,
      buildScene(s, cam, { units, items: itemGfx, anim, monsters: data.monsters, itemDb: data.items, playerToken: 'BA', playerWclass: '1HS', playerEquip: BARB_EQUIP, inTown: game.inTown }, input.pickBoxes),
    );
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((e: unknown) => {
  const app = document.getElementById('app');
  if (app) app.textContent = `오류: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
