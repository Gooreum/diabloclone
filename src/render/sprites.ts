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

/**
 * 전역 그림 예산 (LRU). 유닛·미사일 프레임과 지형 타일을 캔버스로 만들어 두되, 픽셀 합이 예산을 넘으면
 * 가장 오래 안 쓴 것부터 버리고 필요할 때 다시 만든다.
 * 상한이 없으면 몬스터가 많은 동굴·스킬 효과에서 캔버스가 수천 개로 불어나 브라우저가 그래픽 메모리를 잃고
 * (그림이 모두 사라져) 화면이 검게 되며 GC 로 버벅거렸다.
 */
export class CanvasLru {
  private readonly map = new Map<string, { c: Drawable; px: number }>();
  private total = 0;
  private readonly budget: number;

  constructor(budgetPixels: number) {
    this.budget = budgetPixels;
  }

  get(key: string, make: () => Drawable): Drawable {
    const hit = this.map.get(key);
    if (hit) {
      // 최근 사용으로 옮긴다 (Map 은 넣은 순서를 기억)
      this.map.delete(key);
      this.map.set(key, hit);
      return hit.c;
    }
    const c = make();
    const px = c.width * c.height;
    this.map.set(key, { c, px });
    this.total += px;
    for (const [k, v] of this.map) {
      if (this.total <= this.budget || k === key) break;
      this.map.delete(k);
      this.total -= v.px;
      // 버린 캔버스의 메모리를 바로 돌려준다
      v.c.width = 1;
      v.c.height = 1;
    }
    return c;
  }

  /** 그래픽 컨텍스트를 잃었다 되찾으면 만든 그림이 모두 비므로 전부 버린다 */
  clear(): void {
    this.map.clear();
    this.total = 0;
  }

  get pixels(): number {
    return this.total;
  }

  get size(): number {
    return this.map.size;
  }
}

/** 약 2천4백만 픽셀 (RGBA 약 96MB) — 동굴에서 몬스터 수십 종 + 스킬 효과가 약 1천만 픽셀이라 넉넉하다 */
export const spriteCache = new CanvasLru(24_000_000);
let nextSpriteId = 1;
/** 캐시 키에 쓸 고유 번호 (그림 묶음마다 하나) */
export const newSpriteId = (): number => nextSpriteId++;
