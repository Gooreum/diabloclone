// 문자열 테이블 (.tbl): 키 → 표시 문자열.
// 출처: Phrozen Keep — "TBL file format" (헤더 21바이트, 인덱스 u16[], 해시 노드 17바이트)
//       (https://d2mods.info/forum/kb/viewarticle?a=418)

export function parseTbl(buf: Uint8Array): Map<string, string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 21) throw new Error('tbl: too short');
  const numElements = dv.getUint16(2, true);
  const hashSize = dv.getUint32(4, true);
  const nodesStart = 21 + numElements * 2;
  if (nodesStart + hashSize * 17 > buf.length) throw new Error('tbl: hash table out of range');
  const readStr = (off: number): string => {
    let end = off;
    while (end < buf.length && buf[end] !== 0) end++;
    return new TextDecoder('latin1').decode(buf.subarray(off, end));
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
