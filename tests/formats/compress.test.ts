import { describe, expect, it } from 'vitest';
import { explode } from '../../src/formats/compress/pkware';
import { inflateZlib } from '../../src/formats/compress/zlib';
import { deflate } from 'pako';

describe('PKWARE explode', () => {
  // 출처: zlib contrib/blast/test.pk + test.txt — "00 04 82 24 25 8f 80 7f" → "AIAIAIAIAIAIA"
  //       (https://github.com/madler/zlib/tree/master/contrib/blast)
  it('blast.c 공식 테스트 벡터', () => {
    const out = explode(Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]), 13);
    expect(new TextDecoder().decode(out)).toBe('AIAIAIAIAIAIA');
  });
  it('잘못된 딕셔너리 크기는 에러', () => {
    expect(() => explode(Uint8Array.from([0x00, 0x09, 0x00]), 10)).toThrow(/dictionary/);
  });
  it('입력이 도중에 끝나면 에러', () => {
    expect(() => explode(Uint8Array.from([0x00, 0x04, 0x82]), 13)).toThrow(/end of input/);
  });
});

describe('zlib', () => {
  it('deflate 스트림 왕복', () => {
    const src = new TextEncoder().encode('Rogue Encampment '.repeat(50));
    expect(inflateZlib(deflate(src), src.length)).toEqual(src);
  });
});
