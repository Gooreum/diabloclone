import { describe, expect, it } from 'vitest';
import { LIGHT_LEVELS, parsePl2Light } from '../../src/formats/pl2';
import { hasGameData, mustRead } from '../support/gamedata';

describe('PL2 밝기 단계 표', () => {
  it('짧은 파일은 오류', () => {
    expect(() => parsePl2Light(new Uint8Array(100))).toThrow();
  });
  it.skipIf(!hasGameData)('원작 ACT1 Pal.PL2: 31번 줄 = 항등, 0번 줄은 16번 줄보다 어둡다', () => {
    const buf = mustRead('data\\global\\palette\\ACT1\\Pal.pl2');
    const t = parsePl2Light(buf);
    expect(t.length).toBe(LIGHT_LEVELS * 256);
    const pal = buf.subarray(0, 1024);
    const lum = (row: number) => {
      let s = 0;
      for (let i = 0; i < 256; i++) { const j = t[row * 256 + i]!; s += pal[j * 4]! + pal[j * 4 + 1]! + pal[j * 4 + 2]!; }
      return s / 256;
    };
    for (let i = 0; i < 256; i++) expect(t[31 * 256 + i]).toBe(i);
    expect(lum(0)).toBeLessThan(lum(16));
    expect(lum(16)).toBeLessThan(lum(31));
  });
});
