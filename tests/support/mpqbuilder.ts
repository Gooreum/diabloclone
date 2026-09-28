// 테스트 전용: 원작 MPQ v1 구조를 그대로 따르는 작은 아카이브를 만든다.
// 출처: Zezula — MPQ file format (http://www.zezula.net/en/mpq/mpqformat.html)
import {
  encryptBlock, hashString, HASH_FILE_KEY, HASH_NAME_A, HASH_NAME_B, HASH_TABLE_OFFSET,
  MPQ_FILE_COMPRESS, MPQ_FILE_ENCRYPTED, MPQ_FILE_EXISTS, MPQ_FILE_FIX_KEY, MPQ_FILE_IMPLODE, MPQ_FILE_SINGLE_UNIT,
} from '../../src/formats/mpq';

export interface BuildFile {
  name: string;
  data: Uint8Array;
  encrypted?: boolean;
  fixKey?: boolean;
  singleUnit?: boolean;
  /** 섹터 오프셋 테이블을 쓰는 압축 파일로 저장. sectors 로 섹터별 저장 바이트를 직접 지정할 수 있다. */
  compressed?: { flag: 'compress' | 'implode'; sectors?: Uint8Array[] };
}

function encBytes(bytes: Uint8Array, key: number): Uint8Array {
  const out = bytes.slice();
  const n = out.length >>> 2;
  const dv = new DataView(out.buffer);
  const w = new Uint32Array(n);
  for (let i = 0; i < n; i++) w[i] = dv.getUint32(i * 4, true);
  encryptBlock(w, key);
  for (let i = 0; i < n; i++) dv.setUint32(i * 4, w[i] ?? 0, true);
  return out;
}

export function buildMpq(files: BuildFile[], opts: { sectorShift?: number; hashSize?: number; userData?: boolean } = {}): Uint8Array {
  const sectorShift = opts.sectorShift ?? 0;
  const sectorSize = 512 << sectorShift;
  const hashSize = opts.hashSize ?? 16;
  const chunks: Uint8Array[] = [];
  let offset = 32;
  const blocks: { offset: number; csize: number; size: number; flags: number }[] = [];

  for (const f of files) {
    let flags = MPQ_FILE_EXISTS;
    if (f.encrypted) flags |= MPQ_FILE_ENCRYPTED;
    if (f.fixKey) flags |= MPQ_FILE_FIX_KEY;
    if (f.singleUnit) flags |= MPQ_FILE_SINGLE_UNIT;
    if (f.compressed) flags |= f.compressed.flag === 'compress' ? MPQ_FILE_COMPRESS : MPQ_FILE_IMPLODE;
    let key = hashString(f.name.slice(f.name.lastIndexOf('\\') + 1), HASH_FILE_KEY);
    if (f.fixKey) key = (((key + offset) >>> 0) ^ f.data.length) >>> 0;

    let body: Uint8Array;
    if (f.singleUnit) {
      body = f.encrypted ? encBytes(f.data, key) : f.data.slice();
    } else if (f.compressed) {
      const count = Math.ceil(f.data.length / sectorSize);
      const sectors = f.compressed.sectors ?? Array.from({ length: count }, (_, i) => f.data.slice(i * sectorSize, (i + 1) * sectorSize));
      const table = new Uint32Array(count + 1);
      let pos = (count + 1) * 4;
      sectors.forEach((s, i) => { table[i] = pos; pos += s.length; });
      table[count] = pos;
      const tableBytes = new Uint8Array(table.buffer.slice(0));
      const parts = [f.encrypted ? encBytes(tableBytes, (key - 1) >>> 0) : tableBytes,
        ...sectors.map((s, i) => (f.encrypted ? encBytes(s, (key + i) >>> 0) : s))];
      body = new Uint8Array(pos);
      let p = 0;
      for (const part of parts) { body.set(part, p); p += part.length; }
    } else {
      body = new Uint8Array(f.data.length);
      for (let i = 0; i * sectorSize < f.data.length; i++) {
        const s = f.data.slice(i * sectorSize, (i + 1) * sectorSize);
        body.set(f.encrypted ? encBytes(s, (key + i) >>> 0) : s, i * sectorSize);
      }
    }
    blocks.push({ offset, csize: body.length, size: f.data.length, flags });
    chunks.push(body);
    offset += body.length;
  }

  const hash = new Uint32Array(hashSize * 4).fill(0xffffffff);
  files.forEach((f, bi) => {
    let i = hashString(f.name, HASH_TABLE_OFFSET) & (hashSize - 1);
    while (hash[i * 4 + 3] !== 0xffffffff) i = (i + 1) & (hashSize - 1);
    hash[i * 4] = hashString(f.name, HASH_NAME_A);
    hash[i * 4 + 1] = hashString(f.name, HASH_NAME_B);
    hash[i * 4 + 2] = 0;
    hash[i * 4 + 3] = bi;
  });
  const block = new Uint32Array(blocks.length * 4);
  blocks.forEach((b, i) => block.set([b.offset, b.csize, b.size, b.flags], i * 4));
  encryptBlock(hash, hashString('(hash table)', HASH_FILE_KEY));
  encryptBlock(block, hashString('(block table)', HASH_FILE_KEY));

  const hashOffset = offset;
  const blockOffset = hashOffset + hash.byteLength;
  const total = blockOffset + block.byteLength;
  const prefix = opts.userData ? 0x200 : 0;
  const out = new Uint8Array(prefix + total);
  const dv = new DataView(out.buffer);
  if (opts.userData) {
    dv.setUint32(0, 0x1b51504d, true); // 'MPQ\x1B'
    dv.setUint32(8, prefix, true); // 실제 헤더 오프셋
  }
  dv.setUint32(prefix + 0, 0x1a51504d, true);
  dv.setUint32(prefix + 4, 32, true);
  dv.setUint32(prefix + 8, total, true);
  dv.setUint16(prefix + 12, 0, true);
  dv.setUint16(prefix + 14, sectorShift, true);
  dv.setUint32(prefix + 16, hashOffset, true);
  dv.setUint32(prefix + 20, blockOffset, true);
  dv.setUint32(prefix + 24, hashSize, true);
  dv.setUint32(prefix + 28, blocks.length, true);
  let p = prefix + 32;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  out.set(new Uint8Array(hash.buffer), prefix + hashOffset);
  out.set(new Uint8Array(block.buffer), prefix + blockOffset);
  return out;
}
