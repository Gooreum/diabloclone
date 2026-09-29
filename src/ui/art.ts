// 원작 UI DC6 그림 묶음 (data\global\ui\**): 비동기로 읽어 캔버스로 바꿔 두고 동기로 그린다.
// 원작 큰 그림은 256×256 조각으로 나뉘어 있다: 패널 320×432 = 4조각(256+64 × 256+176), 800×600 화면 = 12조각(256·256·256·32 × 256·256·88).
// 출처: Phrozen Keep — DC6 file format (프레임 오프셋 X, Y — Y 는 그림 아래쪽 기준)
import { parseDc6 } from '../formats/dc6';
import type { Palette } from '../formats/palette';
import { indexedToCanvas, type Drawable } from '../render/sprites';
import type { AsyncAssets } from '../render/units';

export interface ArtFrame { img: Drawable; w: number; h: number; ox: number; oy: number }

export const UI = 'data\\global\\ui\\';

export class UiArt {
  private readonly cache = new Map<string, ArtFrame[] | null | 'loading'>();
  private readonly waits = new Map<string, Promise<void>>();
  readonly assets: AsyncAssets;
  readonly pal: Palette;

  constructor(assets: AsyncAssets, pal: Palette) {
    this.assets = assets;
    this.pal = pal;
  }

  /** 읽기 시작 (이미 읽는 중이면 같은 약속) */
  load(path: string): Promise<void> {
    const w = this.waits.get(path);
    if (w) return w;
    this.cache.set(path, 'loading');
    const p = this.assets
      .load(path)
      .then((b) => {
        if (!b) return this.cache.set(path, null);
        const d = parseDc6(b);
        this.cache.set(path, d.frames.map((f) => ({ img: indexedToCanvas(f.pixels, f.width, f.height, this.pal), w: f.width, h: f.height, ox: f.offsetX, oy: f.offsetY })));
      })
      .catch(() => this.cache.set(path, null))
      .then(() => undefined);
    this.waits.set(path, p);
    return p;
  }

  preload(paths: string[]): Promise<void> {
    return Promise.all(paths.map((p) => this.load(p))).then(() => undefined);
  }

  /** 프레임 목록 (아직 없으면 null, 읽기 시작) */
  frames(path: string): ArtFrame[] | null {
    const c = this.cache.get(path);
    if (c === undefined) {
      void this.load(path);
      return null;
    }
    return c === 'loading' ? null : c;
  }

  frame(path: string, i: number): ArtFrame | null {
    return this.frames(path)?.[i] ?? null;
  }

  ready(paths: string[]): boolean {
    return paths.every((p) => !!this.frames(p));
  }

  /** 프레임 하나를 왼쪽 위 (x, y) 에 */
  draw(ctx: CanvasRenderingContext2D, path: string, i: number, x: number, y: number): ArtFrame | null {
    const f = this.frame(path, i);
    if (f) ctx.drawImage(f.img as CanvasImageSource, Math.round(x), Math.round(y));
    return f;
  }

  /** 원작 DC6 오프셋 기준으로 (x, y) = 기준점 (왼쪽 = x + ox, 위 = y + oy − h) — 프런트엔드 애니메이션·로고 */
  drawAnchored(ctx: CanvasRenderingContext2D, path: string, i: number, x: number, y: number): void {
    const f = this.frame(path, i);
    if (f) ctx.drawImage(f.img as CanvasImageSource, Math.round(x + f.ox), Math.round(y + f.oy - f.h));
  }

  /** 조각 그림: 한 줄에 perRow 조각, 줄 높이 = 줄 첫 조각 높이 (first 부터 count 조각) */
  drawTiles(ctx: CanvasRenderingContext2D, path: string, perRow: number, x: number, y: number, first = 0, count?: number): boolean {
    const fr = this.frames(path);
    if (!fr) return false;
    const n = count ?? fr.length - first;
    let cy = y;
    for (let r = 0; r * perRow < n; r++) {
      let cx = x, h = 0;
      for (let c = 0; c < perRow && r * perRow + c < n; c++) {
        const f = fr[first + r * perRow + c];
        if (!f) continue;
        ctx.drawImage(f.img as CanvasImageSource, cx, cy);
        cx += f.w;
        h = Math.max(h, f.h);
      }
      cy += h;
    }
    return true;
  }

  /** 320×432 패널 (4조각) */
  drawPanel(ctx: CanvasRenderingContext2D, path: string, x: number, y: number, first = 0): boolean {
    return this.drawTiles(ctx, path, 2, x, y, first, 4);
  }

  /** 800×600 화면 (12조각) */
  drawScreen(ctx: CanvasRenderingContext2D, path: string): boolean {
    return this.drawTiles(ctx, path, 4, 0, 0, 0, 12);
  }
}
