// 월드 그리기 출구: 월드·유닛·미사일·바닥 아이템은 "팔레트 번호 그림을 (x,y)에 그려라"만 말하고,
// 실제로 어떻게 그릴지는 SpriteSink 구현이 정한다 (WebGL 팔레트 텍스처 = GlSink, 2D 캔버스 = Canvas2dSink).
import type { Palette } from '../formats/palette';
import { indexedToCanvas, spriteCache, type CanvasLru, type Drawable } from './sprites';

/** 팔레트 색 바꿈 표 (256 바이트: 원래 색 번호 → 바뀐 색 번호) */
export interface ColorShift { key: string; map: Uint8Array }

/** 팔레트 번호 그림. id = 전역 고유 키 (같은 id 면 같은 픽셀) */
export interface IndexedImage { id: string; w: number; h: number; pixels: Uint8Array }

export interface DrawOpts {
  /** 색 바꿈 표 (몬스터 변종 palshift · 유니크 RandTransforms) */
  shift?: ColorShift | null;
  /** −1/없음 = 불투명, 0~2 = 75/50/25% 불투명, 3·5·6 = 더하기, 4 = 곱하기 (COF drawEffect · missiles Trans) */
  blend?: number;
  /** 가리킨 유닛 밝게 */
  bright?: boolean;
}

export interface SpriteSink {
  /** 프레임 시작 (검게 지움) */
  begin(width: number, height: number): void;
  draw(img: IndexedImage, x: number, y: number, o?: DrawOpts): void;
  /** 모아 둔 그리기 실행 */
  end(): void;
  setPalette(pal: Palette): void;
}

/** 근사(원작 미확인): 원작 혼합 표(0~2 = 75/50/25% 불투명)를 알파로 근사 */
export const BLEND_ALPHA = [0.75, 0.5, 0.25] as const;

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type MakeCanvas = (pixels: Uint8Array, w: number, h: number, pal: Palette) => Drawable;

/** 2D 캔버스 구현: 그림마다 캔버스 하나 (전역 예산 LRU). WebGL2 를 못 쓸 때와 메뉴 영웅 그림에 쓴다 */
export class Canvas2dSink implements SpriteSink {
  private ctx: Ctx2d;
  private pal: Palette;
  private readonly cache: Pick<CanvasLru, 'get' | 'clear'>;
  private readonly make: MakeCanvas;

  constructor(ctx: Ctx2d, pal: Palette, cache: Pick<CanvasLru, 'get' | 'clear'> = spriteCache, make: MakeCanvas = indexedToCanvas) {
    this.ctx = ctx;
    this.pal = pal;
    this.cache = cache;
    this.make = make;
  }

  /** 그릴 대상 바꾸기 (메뉴 영웅 그림처럼 다른 캔버스에 그릴 때) */
  target(ctx: Ctx2d): this {
    this.ctx = ctx;
    return this;
  }

  begin(width: number, height: number): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, width, height);
  }

  draw(img: IndexedImage, x: number, y: number, o?: DrawOpts): void {
    const sh = o?.shift;
    const c = this.cache.get(sh ? `${img.id}:${sh.key}` : img.id, () =>
      this.make(sh ? img.pixels.map((p) => (p ? sh.map[p] ?? p : 0)) : img.pixels, img.w, img.h, this.pal),
    );
    const blend = o?.blend ?? -1;
    const bright = !!o?.bright;
    const ctx = this.ctx;
    if (blend >= 0 || bright) {
      ctx.save();
      // 근사(원작 미확인): 가리킨 유닛 밝게 = brightness(1.6) 필터
      if (bright) ctx.filter = 'brightness(1.6)';
      if (blend >= 0 && blend <= 2) ctx.globalAlpha = BLEND_ALPHA[blend] as number;
      else if (blend >= 0) ctx.globalCompositeOperation = blend === 4 ? 'multiply' : 'lighter';
    }
    ctx.drawImage(c as CanvasImageSource, x, y);
    if (blend >= 0 || bright) ctx.restore();
  }

  end(): void {}

  setPalette(pal: Palette): void {
    if (pal === this.pal) return;
    this.pal = pal;
    this.cache.clear();
  }
}
