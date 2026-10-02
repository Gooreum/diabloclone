// 문자열 테이블 (.tbl): 키 → 표시 문자열.
// 출처: Phrozen Keep — "TBL file format" (헤더 21바이트, 인덱스 u16[], 해시 노드 17바이트)
//       (https://d2mods.info/forum/kb/viewarticle?a=418)

// 한국어 tbl (data\\local\\lng\\kor) 은 UTF-8 — 원작 파일 확인. 0xFF (색 코드 ÿc) 는 UTF-8 에 없는 바이트라 따로 'ÿ' 로 둔다
const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function decodeUtf8(s: Uint8Array): string {
  let out = '', start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== 0xff) continue;
    out += utf8.decode(s.subarray(start, i)) + '\u00ff';
    start = i + 1;
  }
  return out + utf8.decode(s.subarray(start));
}

export function parseTbl(buf: Uint8Array, encoding: 'latin1' | 'utf-8' = 'latin1'): Map<string, string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 21) throw new Error('tbl: too short');
  const numElements = dv.getUint16(2, true);
  const hashSize = dv.getUint32(4, true);
  const nodesStart = 21 + numElements * 2;
  if (nodesStart + hashSize * 17 > buf.length) throw new Error('tbl: hash table out of range');
  const readStr = (off: number): string => {
    let end = off;
    while (end < buf.length && buf[end] !== 0) end++;
    const s = buf.subarray(off, end);
    return encoding === 'latin1' ? latin1.decode(s) : decodeUtf8(s);
  };
  const out = new Map<string, string>();
  for (let i = 0; i < hashSize; i++) {
    const n = nodesStart + i * 17;
    if (!dv.getUint8(n)) continue;
    const keyOff = dv.getUint32(n + 7, true);
    const valOff = dv.getUint32(n + 11, true);
    const key = readStr(keyOff);
    if (!out.has(key)) out.set(key, readStr(valOff));
  }
  return out;
}
