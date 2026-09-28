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
import { toCanvas, type Camera } from './render/iso';

const WIDTH = 800, HEIGHT = 600;
const TOWN_DS1 = 'data\\global\\tiles\\ACT1\\TOWN\\townE1.ds1';
const PALETTE = 'data\\global\\palette\\ACT1\\pal.dat';

declare global {
  interface Window { __game?: { game: Game; ready: boolean } }
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
  await assets.preload([TOWN_DS1, PALETTE]);
  const ds1 = parseDs1(assets.read(TOWN_DS1) as Uint8Array);
  const dt1Paths = ds1.files.map(normalizeDs1File);
  await assets.preload(dt1Paths);
  const dt1s = dt1Paths.map((p) => assets.read(p)).filter((b): b is Uint8Array => !!b).map(parseDt1);
  const level = buildPresetLevel(ds1, dt1s, 1);
  const pal = parsePalette(assets.read(PALETTE) as Uint8Array);
  const renderer = new WorldRenderer(level, pal);

  const center = nearestWalkable(level.collision, { x: level.collision.width / 2, y: level.collision.height / 2 }, 60) ?? { x: 10, y: 10 };
  const game = new Game({ map: level.collision, player: { x: center.x + 0.5, y: center.y + 0.5, walkVelocity: 6, runVelocity: 9 }, seed: 1, inTown: true });
  if (import.meta.env.DEV) window.__game = { game, ready: true };

  const cam: Camera = { x: center.x, y: center.y, width: WIDTH, height: HEIGHT };
  const step = 1000 / ENGINE_FPS;
  let last = performance.now(), acc = 0;
  const frame = (now: number) => {
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= step) {
      game.tick();
      acc -= step;
    }
    const s = game.snapshot();
    cam.x = s.player.x;
    cam.y = s.player.y;
    renderer.render(ctx, cam, [
      {
        depth: s.player.x + s.player.y,
        draw: (c, cm) => {
          const p = toCanvas(cm, s.player.x, s.player.y);
          c.fillStyle = '#ffd200';
          c.beginPath();
          c.ellipse(p.x, p.y, 10, 5, 0, 0, Math.PI * 2);
          c.fill();
        },
      },
    ]);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((e: unknown) => {
  const app = document.getElementById('app');
  if (app) app.textContent = `오류: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
