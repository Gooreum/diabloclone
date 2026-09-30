// 빛 지도: 카메라 둘레 서브타일 격자마다 밝기(0~31)를 계산해 셰이더에 넘긴다 (R8 한 칸 = 서브타일 하나).
import { lightAt, type LightSource } from '../engine/lighting';

/** 격자 한 변 (서브타일). 800×600 화면의 대각선 범위(약 44 서브타일)보다 넉넉하게 */
export const LIGHTMAP_SIZE = 96;

export interface LightMap {
  /** 격자 (0,0) 칸의 월드 서브타일 좌표 */
  originX: number; originY: number;
  size: number;
  /** size × size, 값 = 밝기 × 255 / 31 (셰이더에서 0~1 로 읽는다) */
  data: Uint8Array;
}

/** 카메라 (cx, cy) 중심 빛 지도. out 을 주면 그 배열을 다시 쓴다 */
export function buildLightMap(cx: number, cy: number, ambient: number, src: readonly LightSource[], out?: LightMap): LightMap {
  const size = LIGHTMAP_SIZE;
  const m = out ?? { originX: 0, originY: 0, size, data: new Uint8Array(size * size) };
  m.originX = Math.floor(cx) - size / 2;
  m.originY = Math.floor(cy) - size / 2;
  const d = m.data;
  // 광원이 없고 주변광이 가득이면 한 번에 채운다 (마을·야외 대부분)
  if (ambient >= 31) {
    d.fill(255);
    return m;
  }
  const base = Math.round((ambient * 255) / 31);
  d.fill(base);
  for (const s of src) {
    if (s.r <= 0) continue;
    // 광원 둘레 사각형만 (칸 가운데 = +0.5)
    const x0 = Math.max(0, Math.floor(s.x - s.r) - m.originX), x1 = Math.min(size - 1, Math.ceil(s.x + s.r) - m.originX);
    const y0 = Math.max(0, Math.floor(s.y - s.r) - m.originY), y1 = Math.min(size - 1, Math.ceil(s.y + s.r) - m.originY);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const v = Math.round((lightAt(ambient, [s], m.originX + x + 0.5, m.originY + y + 0.5) * 255) / 31);
        const i = y * size + x;
        if (v > (d[i] ?? 0)) d[i] = v;
      }
  }
  return m;
}
