// gifenc (MIT) 타입 선언 — README GIF 녹화 스펙에서만 사용
declare module 'gifenc' {
  const gifenc: { quantize: typeof quantize; applyPalette: typeof applyPalette; GIFEncoder: typeof GIFEncoder };
  export default gifenc;
  export type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: { palette?: Palette; delay?: number; repeat?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
