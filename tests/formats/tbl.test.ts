// 문자열 표 (.tbl) 읽기: 영어 latin1, 한국어 UTF-8 (원작 kor 표 확인) — 0xFF 색 코드는 'ÿ'
import { describe, expect, it } from 'vitest';
import { parseTbl } from '../../src/formats/tbl';

/** 합성 tbl: 머리 21바이트 + 인덱스 u16[] + 해시 노드 17바이트 (사용 1, 키 오프셋 @7, 값 오프셋 @11) + 문자열 */
function fakeTbl(entries: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const n = entries.length, nodes = 21 + n * 2, strs = nodes + n * 17;
  const parts: Uint8Array[] = [];
  const offs: [number, number][] = [];
  let off = strs;
  for (const [k, v] of entries) {
    const kb = enc.encode(k);
    offs.push([off, off + kb.length + 1]);
    parts.push(kb, new Uint8Array([0]), v, new Uint8Array([0]));
    off += kb.length + 1 + v.length + 1;
  }
  const b = new Uint8Array(off);
  const dv = new DataView(b.buffer);
  dv.setUint16(2, n, true);
  dv.setUint32(4, n, true);
  offs.forEach(([ko, vo], i) => {
    const o = nodes + i * 17;
    b[o] = 1;
    dv.setUint32(o + 7, ko, true);
    dv.setUint32(o + 11, vo, true);
  });
  let p = strs;
  for (const x of parts) {
    b.set(x, p);
    p += x.length;
  }
  return b;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('tbl 인코딩', () => {
  it('UTF-8 한글 값을 그대로 읽는다', () => {
    expect(parseTbl(fakeTbl([['ssd', utf8('숏소드')]]), 'utf-8').get('ssd')).toBe('숏소드');
  });
  it('UTF-8 값 속 0xFF (색 코드) 는 ÿ 로, 앞뒤 한글은 그대로', () => {
    const v = new Uint8Array([...utf8('가'), 0xff, 0x63, 0x31, ...utf8('나')]);
    expect(parseTbl(fakeTbl([['k', v]]), 'utf-8').get('k')).toBe('가ÿc1나');
  });
  it('기본 latin1: 0xE9 → é (지금과 같다)', () => {
    expect(parseTbl(fakeTbl([['k', new Uint8Array([0x63, 0x61, 0x66, 0xe9])]])).get('k')).toBe('café');
  });
});
