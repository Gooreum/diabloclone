// 레벨 타일 렌더러: 바닥 → 그림자 → (벽 + 유닛, 대각선 깊이 순) → 지붕.
// 벽(방향 1~14)은 타일 기준점에서 +80 아래에 기준, 지붕(15)은 roofHeight 만큼 위.
// 출처: Paul Siramy — DT1/DS1 문서 (방향 0 바닥, 13 그림자, 15 지붕, 3/4 코너 쌍)
// 지붕: 플레이어가 선 셀의 지붕 묶음(이어진 지붕 = 한 건물)은 건너뛴다 (원작: 건물 안에 들어가면 지붕이 사라진다)
import type { PresetLevel } from '../engine/drlg/preset';
import { renderTile, type TileImage } from '../formats/dt1';
import { toCanvas, type Camera } from './iso';
import type { IndexedImage, SpriteSink } from './sink';
import { newSpriteId } from './sprites';

export interface DepthSprite { depth: number; draw: (sink: SpriteSink, cam: Camera) => void }

/**
 * 셀마다 지붕 묶음 번호 (0 = 지붕 없음, 1부터 = 건물). 상하좌우로 이어진 지붕 셀(방향 15)은 같은 번호.
 * 근사(원작 미확인): 원작 클라이언트가 "건물 안" 을 어떻게 판정하는지는 D2MOO 에 없다 —
 *   플레이어가 선 타일 셀에 지붕 타일이 놓여 있으면 안으로 보고, 이어진 지붕을 한 건물로 묶어 통째로 숨긴다
 */
export function roofGroups(level: Pick<PresetLevel, 'widthTiles' | 'heightTiles' | 'walls'>): Int32Array {
  const W = level.widthTiles, H = level.heightTiles;
  const g = new Int32Array(W * H);
  for (const w of level.walls) if (w.orientation === 15 && w.x >= 0 && w.x < W && w.y >= 0 && w.y < H) g[w.y * W + w.x] = -1;
  let next = 0;
  for (let start = 0; start < g.length; start++) {
    if (g[start] !== -1) continue;
    const id = ++next;
    const stack = [start];
    g[start] = id;
    while (stack.length) {
      const k = stack.pop() as number;
      const x = k % W, y = Math.floor(k / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const nk = ny * W + nx;
        if (g[nk] === -1) {
          g[nk] = id;
          stack.push(nk);
        }
      }
    }
  }
  return g;
}

export class WorldRenderer {
  private readonly images: ({ img: TileImage; image: IndexedImage } | null)[];
  private readonly id = newSpriteId();
  private readonly level: PresetLevel;

  constructor(level: PresetLevel) {
    this.level = level;
    this.images = level.tiles.map(() => null);
  }

  private tile(i: number): { img: TileImage; image: IndexedImage } {
    // 타일 픽셀(팔레트 번호)은 레벨마다 기억하고, 그림은 SpriteSink 가 (캐시해) 그린다
    let t = this.images[i];
    if (!t) {
      const img = renderTile(this.level.tiles[i]!);
      t = { img, image: { id: `t${this.id}:${i}`, w: img.width, h: img.height, pixels: img.pixels } };
      this.images[i] = t;
    }
    return t;
  }

  /** 타일 (tx,ty) 이미지 좌상단 캔버스 좌표 (바닥 마름모의 위 꼭짓점 기준 −80) */
  private tileOrigin(cam: Camera, tx: number, ty: number): { x: number; y: number } {
    const p = toCanvas(cam, tx * 5, ty * 5);
    return { x: p.x - 80, y: p.y };
  }

  private visible(cam: Camera, o: { x: number; y: number }, h: number, top: number): boolean {
    return o.x + 160 >= 0 && o.x <= cam.width && o.y + top + h >= -80 && o.y + top <= cam.height + 200;
  }

  render(sink: SpriteSink, cam: Camera, sprites: DepthSprite[] = []): void {
    sink.begin(cam.width, cam.height);
    // 바닥·그림자 타일은 픽셀마다 빛을 재고, 벽·지붕은 타일 가운데 바닥 한 점에서 (벽 위쪽이 먼 바닥 빛을 받지 않게)
    const draw = (i: number, tx: number, ty: number, dy: number, wall = false) => {
      const t = this.tile(i);
      const o = this.tileOrigin(cam, tx, ty);
      if (!this.visible(cam, o, t.img.height, t.img.top + dy)) return;
      sink.draw(t.image, o.x, o.y + t.img.top + dy, wall ? { lightAt: toCanvas(cam, tx * 5 + 2.5, ty * 5 + 2.5) } : undefined);
    };
    for (const f of this.level.floors) draw(f.tileIndex, f.x, f.y, 0);
    for (const s of this.level.shadows) draw(s.tileIndex, s.x, s.y, 0);
    // 벽과 유닛을 깊이(타일 x+y 대각선, 서브타일 기준)로 섞어 그린다
    const items: DepthSprite[] = [...sprites];
    for (const w of this.level.walls) {
      if (w.orientation === 15) continue;
      const lower = w.orientation >= 16;
      items.push({
        depth: (w.x + w.y) * 5 + (lower ? 0 : 4.9),
        draw: () => {
          draw(w.tileIndex, w.x, w.y, w.orientation >= 1 && w.orientation <= 14 ? 80 : 0, true);
        },
      });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw(sink, cam);
    for (const w of this.level.walls) {
      if (w.orientation !== 15) continue;
      const t = this.level.tiles[w.tileIndex];
      draw(w.tileIndex, w.x, w.y, -(t?.roofHeight ?? 0), true);
    }
    sink.end();
  }
}
