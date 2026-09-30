// 레벨 타일 렌더러: 바닥 → 그림자 → (벽 + 유닛, 대각선 깊이 순) → 지붕.
// 벽(방향 1~14)은 타일 기준점에서 +80 아래에 기준, 지붕(15)은 roofHeight 만큼 위.
// 출처: Paul Siramy — DT1/DS1 문서 (방향 0 바닥, 13 그림자, 15 지붕, 3/4 코너 쌍)
import type { PresetLevel } from '../engine/drlg/preset';
import { renderTile, type TileImage } from '../formats/dt1';
import type { Palette } from '../formats/palette';
import { toCanvas, type Camera } from './iso';
import { indexedToCanvas, newSpriteId, spriteCache, type Drawable } from './sprites';

type Ctx = CanvasRenderingContext2D;

export interface DepthSprite { depth: number; draw: (ctx: Ctx, cam: Camera) => void }

export class WorldRenderer {
  private readonly images: (TileImage | null)[];
  private readonly id = newSpriteId();
  private readonly level: PresetLevel;
  private readonly pal: Palette;

  constructor(level: PresetLevel, pal: Palette) {
    this.level = level;
    this.pal = pal;
    this.images = level.tiles.map(() => null);
  }

  private tile(i: number): { img: TileImage; canvas: Drawable } {
    // 타일 픽셀(인덱스)은 레벨마다 기억하고, 캔버스는 전역 예산(spriteCache)에서 빌린다
    let img = this.images[i];
    if (!img) {
      img = renderTile(this.level.tiles[i]!);
      this.images[i] = img;
    }
    const src = img;
    return { img: src, canvas: spriteCache.get(`t${this.id}:${i}`, () => indexedToCanvas(src.pixels, src.width, src.height, this.pal)) };
  }

  /** 타일 (tx,ty) 이미지 좌상단 캔버스 좌표 (바닥 마름모의 위 꼭짓점 기준 −80) */
  private tileOrigin(cam: Camera, tx: number, ty: number): { x: number; y: number } {
    const p = toCanvas(cam, tx * 5, ty * 5);
    return { x: p.x - 80, y: p.y };
  }

  private visible(cam: Camera, o: { x: number; y: number }, h: number, top: number): boolean {
    return o.x + 160 >= 0 && o.x <= cam.width && o.y + top + h >= -80 && o.y + top <= cam.height + 200;
  }

  render(ctx: Ctx, cam: Camera, sprites: DepthSprite[] = []): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cam.width, cam.height);
    const draw = (i: number, tx: number, ty: number, dy: number) => {
      const t = this.tile(i);
      const o = this.tileOrigin(cam, tx, ty);
      if (!this.visible(cam, o, t.img.height, t.img.top + dy)) return;
      ctx.drawImage(t.canvas as CanvasImageSource, o.x, o.y + t.img.top + dy);
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
        draw: (c) => {
          void c;
          draw(w.tileIndex, w.x, w.y, w.orientation >= 1 && w.orientation <= 14 ? 80 : 0);
        },
      });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw(ctx, cam);
    for (const w of this.level.walls) {
      if (w.orientation !== 15) continue;
      const t = this.level.tiles[w.tileIndex];
      draw(w.tileIndex, w.x, w.y, -(t?.roofHeight ?? 0));
    }
  }
}
