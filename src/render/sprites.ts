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

function paint(c: Drawable, pixels: Uint8Array, w: number, h: number, pal: Palette): void {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return;
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
}

/**
 * 만든 그림과 그 원본(팔레트 인덱스) 기록. 브라우저가 탭을 숨기거나 그래픽 메모리가 모자라면 캔버스 내용을 버리는데,
 * 한 번 만들고 계속 쓰는 UI 그림(조작판·커서·글꼴)은 다시 만들지 않아 사라진 채 남았다 → 감지하면 제자리에 다시 그린다.
 * 캔버스는 약한 참조로만 잡아 캐시에서 버려지면 기록도 정리된다.
 */
/** 진단용: 브라우저가 버린(contextlost)·되찾은(contextrestored) 그림 수 */
export const gfxEvents = { lost: 0, restored: 0 };

interface PaintRec { ref: WeakRef<Drawable>; pixels: Uint8Array; w: number; h: number; pal: Palette }
const painted = new Set<PaintRec>();

function sweep(): void {
  for (const r of painted) {
    const c = r.ref.deref();
    if (!c || c.width !== Math.max(1, r.w)) painted.delete(r);
  }
}

export function indexedToCanvas(pixels: Uint8Array, w: number, h: number, pal: Palette): Drawable {
  const c = makeCanvas(w, h);
  paint(c, pixels, w, h, pal);
  painted.add({ ref: new WeakRef(c), pixels, w, h, pal });
  // Chrome 은 그래픽 메모리가 모자라면 캔버스를 하나씩 골라 버린다(contextlost) — 되찾으면(contextrestored) 비어 있으므로 그 그림만 다시 그린다
  c.addEventListener('contextlost', () => gfxEvents.lost++);
  c.addEventListener('contextrestored', () => {
    gfxEvents.restored++;
    paint(c, pixels, w, h, pal);
  });
  if (painted.size % 4096 === 0) sweep();
  return c;
}

/** 테스트용: 브라우저가 그림을 버린 상황을 흉내 낸다 (기록된 모든 그림을 지움) */
export function wipeAllForTest(): void {
  for (const r of painted) {
    const c = r.ref.deref();
    const ctx = c?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    ctx?.clearRect(0, 0, c!.width, c!.height);
  }
}

/** 기록된 그림을 모두 원본에서 다시 그린다. 다시 그린 수 반환 */
export function repaintAll(): number {
  let n = 0;
  for (const r of painted) {
    const c = r.ref.deref();
    if (!c || c.width !== Math.max(1, r.w)) {
      painted.delete(r);
      continue;
    }
    paint(c, r.pixels, r.w, r.h, r.pal);
    n++;
  }
  return n;
}

// 시험 그림: 작은 것(8×8)과 큰 것(256×256) 하나씩 흰색으로 채운다. 이 점이 사라지면 브라우저가 그림 내용을 버린 것이다
// (큰 캔버스만 그래픽 가속되어 따로 버려질 수 있어 둘 다 본다).
let probes: Drawable[] | null = null;
const PROBE_PAL = new Uint8Array(256 * 4).fill(255) as unknown as Palette;

/** 그림 내용이 사라졌으면 모두 다시 그린다 (주기적으로·탭 복귀·컨텍스트 복구 때 호출). 다시 그렸으면 true */
export function healGraphics(): boolean {
  if (!probes) {
    probes = [8, 256].map((n) => indexedToCanvas(new Uint8Array(n * n).fill(1), n, n, PROBE_PAL));
    return false;
  }
  for (const p of probes) {
    const ctx = p.getContext('2d') as ((CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) & { isContextLost?: () => boolean }) | null;
    if (!ctx || ctx.isContextLost?.()) continue;
    if ((ctx.getImageData(p.width >> 1, p.height >> 1, 1, 1).data[3] ?? 0) !== 255) {
      repaintAll();
      return true;
    }
  }
  return false;
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

/** 약 4천8백만 픽셀 (RGBA 약 190MB) — 블러드 무어(나무 타일 다수 + 몬스터 100마리)가 2천4백만을 넘어 버렸다 다시 만들기를 반복했다 */
export const spriteCache = new CanvasLru(48_000_000);
let nextSpriteId = 1;
/** 캐시 키에 쓸 고유 번호 (그림 묶음마다 하나) */
export const newSpriteId = (): number => nextSpriteId++;
