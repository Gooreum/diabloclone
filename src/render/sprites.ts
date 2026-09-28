// 팔레트 인덱스 이미지 → 캔버스 (캐시). 인덱스 0 = 투명.
import type { Palette } from '../formats/palette';

export type Drawable = HTMLCanvasElement | OffscreenCanvas;

export function makeCanvas(w: number, h: number): Drawable {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export function indexedToCanvas(pixels: Uint8Array, w: number, h: number, pal: Palette): Drawable {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const img = ctx.createImageData(Math.max(1, w), Math.max(1, h));
  for (let i = 0; i < w * h; i++) {
    const p = pixels[i] ?? 0;
    if (!p) continue;
    img.data[i * 4] = pal[p * 4] ?? 0;
    img.data[i * 4 + 1] = pal[p * 4 + 1] ?? 0;
    img.data[i * 4 + 2] = pal[p * 4 + 2] ?? 0;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
