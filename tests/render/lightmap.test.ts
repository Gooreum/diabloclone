import { describe, expect, it } from 'vitest';
import { LIGHTMAP_SIZE, buildLightMap } from '../../src/render/lightmap';

describe('빛 지도', () => {
  const at = (m: ReturnType<typeof buildLightMap>, x: number, y: number) => m.data[(y - m.originY) * m.size + (x - m.originX)];
  it('야외(주변광 31): 전부 255', () => {
    const m = buildLightMap(100, 100, 31, []);
    expect(m.data.every((v) => v === 255)).toBe(true);
    expect([m.originX, m.originY]).toEqual([100 - LIGHTMAP_SIZE / 2, 100 - LIGHTMAP_SIZE / 2]);
  });
  it('실내: 광원 칸은 밝고, 반경 밖은 0, 두 광원은 더 밝은 쪽', () => {
    const m = buildLightMap(50, 50, 0, [{ x: 50, y: 50, r: 13 }, { x: 60, y: 50, r: 4 }]);
    expect(at(m, 50, 50)).toBeGreaterThan(230);
    expect(at(m, 50, 70)).toBe(0);
    expect(at(m, 56, 50)).toBeGreaterThan(at(m, 50, 60)!);
    expect(at(m, 60, 50)).toBeGreaterThan(at(m, 59, 45)!);
  });
  it('격자 밖 광원·반경 0 광원은 무시, 배열 재사용', () => {
    const m1 = buildLightMap(0, 0, 0, [{ x: 500, y: 500, r: 10 }, { x: 0, y: 0, r: 0 }]);
    expect(m1.data.every((v) => v === 0)).toBe(true);
    const m2 = buildLightMap(10, 10, 0, [{ x: 10, y: 10, r: 5 }], m1);
    expect(m2).toBe(m1);
    expect(at(m2, 10, 10)).toBeGreaterThan(0);
  });
});
