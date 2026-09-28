// 브라우저 진입점: 원작 MPQ 로드 → Rogue Encampment 구성 → 게임 루프(25fps) + 렌더 루프.
import { AssetLoader } from './assets/loader';
import { parseDs1, normalizeDs1File } from './formats/ds1';
import { parseDt1 } from './formats/dt1';
import { parsePalette } from './formats/palette';
import { buildPresetLevel } from './engine/drlg/preset';
import { nearestWalkable } from './engine/path';
import { Game } from './engine/game';
import { ENGINE_FPS } from './engine/index';
import { WorldRenderer } from './render/world';
import { type Camera } from './render/iso';
import { ItemGfx, UnitGfx } from './render/units';
import { buildScene } from './render/scene';
import { AnimData } from './formats/animdata';
import { InputController } from './input/dom';
import { loadGameData } from './assets/gamedata-loader';
import { classStats, createCharacter, expTable } from './engine/player';
import { QUALITY } from './engine/treasure';
import { Rng } from './engine/rng';

const WIDTH = 800, HEIGHT = 600;
const TOWN_DS1 = 'data\\global\\tiles\\ACT1\\TOWN\\townE1.ds1';
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
  await assets.preload([TOWN_DS1, PALETTE, ANIMDATA]);
  const ds1 = parseDs1(assets.read(TOWN_DS1) as Uint8Array);
  const dt1Paths = ds1.files.map(normalizeDs1File);
  await assets.preload(dt1Paths);
  const dt1s = dt1Paths.map((p) => assets.read(p)).filter((b): b is Uint8Array => !!b).map(parseDt1);
  const level = buildPresetLevel(ds1, dt1s, 1);
  const pal = parsePalette(assets.read(PALETTE) as Uint8Array);
  const renderer = new WorldRenderer(level, pal);
  const units = new UnitGfx(assets, pal);
  const itemGfx = new ItemGfx(assets, pal);
  const anim = AnimData.parse(assets.read(ANIMDATA) as Uint8Array);

  const center = openSpot(level.collision, level.collision.width / 2, level.collision.height / 2);
  const { data, tables } = await loadGameData(assets);
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const character = createCharacter(cs);
  const itemRng = new Rng(7);
  const equipment = Object.fromEntries(
    cs.startItems.filter((i) => i.loc === 'rarm' || i.loc === 'larm').map((i) => [i.loc, data.treasure.createItem(data.items.base(i.code)!, 1, itemRng, QUALITY.NORMAL)]),
  );
  const params = new URLSearchParams(location.search);
  const testMonsters = import.meta.env.DEV && params.get('test') === 'monsters';
  const game = new Game({
    map: level.collision, player: { x: center.x + 0.5, y: center.y + 0.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 1, data, character, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), equipment, inTown: !testMonsters,
  });
  if (testMonsters) {
    const spot = (dx: number, dy: number) => nearestWalkable(level.collision, { x: center.x + dx, y: center.y + dy }, 10) ?? center;
    for (const [id, dx, dy] of [['zombie1', 8, 0], ['fallen1', 0, 8], ['quillrat1', -8, 3]] as const) {
      const p = spot(dx, dy);
      game.spawnMonster(id, p.x + 0.5, p.y + 0.5);
    }
    game.dropItem(data.treasure.createItem(data.items.base('hax')!, 1, itemRng, QUALITY.NORMAL), center.x + 3, center.y - 3);
  }
  if (import.meta.env.DEV) window.__game = { game, ready: true };

  const cam: Camera = { x: center.x, y: center.y, width: WIDTH, height: HEIGHT };
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

/** 주변 7×7 서브타일이 모두 이동 가능한 가장 가까운 지점 (임시 시작 위치 — Phase 5 에서 원작 마을 시작점으로 교체) */
function openSpot(map: import('./engine/collision').CollisionMap, cx: number, cy: number): { x: number; y: number } {
  const clear = (x: number, y: number) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!map.walkable(x + dx, y + dy)) return false;
    return true;
  };
  for (let r = 0; r < 80; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy;
        if (clear(x, y)) return { x, y };
      }
  return nearestWalkable(map, { x: cx, y: cy }, 60) ?? { x: 10, y: 10 };
}

boot().catch((e: unknown) => {
  const app = document.getElementById('app');
  if (app) app.textContent = `오류: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
