// MPQ 아카이브 리더 (Diablo II 는 포맷 v1 사용).
// 출처: Zezula — MPQ file format (http://www.zezula.net/en/mpq/mpqformat.html)
// 출처: StormLib — SBaseCommon.cpp / SFileReadFile.cpp (https://github.com/ladislav-zezula/StormLib)
import { explode } from './compress/pkware.ts';
import { inflateZlib } from './compress/zlib.ts';

export const MPQ_FILE_IMPLODE = 0x00000100;
export const MPQ_FILE_COMPRESS = 0x00000200;
export const MPQ_FILE_ENCRYPTED = 0x00010000;
export const MPQ_FILE_FIX_KEY = 0x00020000;
export const MPQ_FILE_SINGLE_UNIT = 0x01000000;
export const MPQ_FILE_DELETE_MARKER = 0x02000000;
export const MPQ_FILE_SECTOR_CRC = 0x04000000;
export const MPQ_FILE_EXISTS = 0x80000000;

// 출처: StormLib SCompDecompress — 압축 마스크 비트 (MPQ_COMPRESSION_*)
export const COMPRESSION = {
  HUFFMAN: 0x01,
  ZLIB: 0x02,
  PKWARE: 0x08,
  BZIP2: 0x10,
  ADPCM_MONO: 0x40,
  ADPCM_STEREO: 0x80,
} as const;

/** 압축 해제 함수: (압축 데이터, 기대 출력 크기) → 출력 */
export type Decompressor = (input: Uint8Array, outSize: number) => Uint8Array;

// 실제 D2 MPQ 조사 결과(scripts/mpq-block-survey.mjs): 그래픽·데이터는 PKWARE(0x08)/IMPLODE, 일부 zlib(0x02).
// huffman·ADPCM 은 사운드 MPQ 전용 → Phase 11 에서 추가.
const decompressors = new Map<number, Decompressor>([
  [0x08, explode],
  [0x02, inflateZlib],
]);

/** 실제 MPQ 조사 결과 필요한 압축 방식만 등록한다 (plan.md Phase 2 Step 1). */
export function registerDecompressor(bit: number, fn: Decompressor): () => void {
  const prev = decompressors.get(bit);
  decompressors.set(bit, fn);
  return () => {
    if (prev) decompressors.set(bit, prev);
    else decompressors.delete(bit);
  };
}

// ---------------------------------------------------------------- crypt

// 출처: Zezula MPQ format — "Encryption" 섹션의 PrepareCryptTable
export const CRYPT_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let i = 0; i < 0x100; i++) {
    for (let j = 0, idx = i; j < 5; j++, idx += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t1 = (seed & 0xffff) << 16;
      seed = (seed * 125 + 3) % 0x2aaaab;
      const t2 = seed & 0xffff;
      table[idx] = (t1 | t2) >>> 0;
    }
  }
  return table;
})();

export const HASH_TABLE_OFFSET = 0;
export const HASH_NAME_A = 1;
export const HASH_NAME_B = 2;
export const HASH_FILE_KEY = 3;

// 출처: Zezula MPQ format — HashString. 경로는 대문자 + '/' → '\' 로 정규화.
export function hashString(s: string, type: 0 | 1 | 2 | 3): number {
  let seed1 = 0x7fed7fed;
  let seed2 = 0xeeeeeeee;
  for (let i = 0; i < s.length; i++) {
    let ch = s.charCodeAt(i);
    if (ch === 0x2f) ch = 0x5c;
    if (ch >= 0x61 && ch <= 0x7a) ch -= 0x20;
    seed1 = ((CRYPT_TABLE[(type << 8) + ch] ?? 0) ^ ((seed1 + seed2) >>> 0)) >>> 0;
    seed2 = (ch + seed1 + seed2 + ((seed2 << 5) >>> 0) + 3) >>> 0;
  }
  return seed1;
}

// 출처: Zezula MPQ format — DecryptData
export function decryptBlock(data: Uint32Array, key: number): void {
  let seed = 0xeeeeeeee;
  let k = key >>> 0;
  for (let i = 0; i < data.length; i++) {
    seed = (seed + (CRYPT_TABLE[0x400 + (k & 0xff)] ?? 0)) >>> 0;
    const ch = ((data[i] ?? 0) ^ ((k + seed) >>> 0)) >>> 0;
    data[i] = ch;
    k = ((((~k << 0x15) >>> 0) + 0x11111111) | (k >>> 0x0b)) >>> 0;
    seed = (ch + seed + ((seed << 5) >>> 0) + 3) >>> 0;
  }
}

// 출처: Zezula MPQ format — EncryptData (테스트용 아카이브 생성에 사용)
export function encryptBlock(data: Uint32Array, key: number): void {
  let seed = 0xeeeeeeee;
  let k = key >>> 0;
  for (let i = 0; i < data.length; i++) {
    seed = (seed + (CRYPT_TABLE[0x400 + (k & 0xff)] ?? 0)) >>> 0;
    const ch = data[i] ?? 0;
    data[i] = (ch ^ ((k + seed) >>> 0)) >>> 0;
    k = ((((~k << 0x15) >>> 0) + 0x11111111) | (k >>> 0x0b)) >>> 0;
    seed = (ch + seed + ((seed << 5) >>> 0) + 3) >>> 0;
  }
}

/** 바이트 배열의 앞쪽 4바이트 정렬 부분만 복호화 (나머지 꼬리 바이트는 평문 — StormLib 동작) */
function decryptBytes(bytes: Uint8Array, key: number): void {
  const n = bytes.length >>> 2;
  if (n === 0) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 4);
  const words = new Uint32Array(n);
  for (let i = 0; i < n; i++) words[i] = view.getUint32(i * 4, true);
  decryptBlock(words, key);
  for (let i = 0; i < n; i++) view.setUint32(i * 4, words[i] ?? 0, true);
}

// ---------------------------------------------------------------- archive

export interface MpqHashEntry { nameA: number; nameB: number; locale: number; platform: number; blockIndex: number }
export interface MpqBlockEntry { offset: number; compressedSize: number; fileSize: number; flags: number }

const HASH_ENTRY_EMPTY = 0xffffffff;
const HASH_ENTRY_DELETED = 0xfffffffe;

export class MpqError extends Error {}

export class MpqArchive {
  readonly sectorSize: number;
  readonly hashTable: MpqHashEntry[];
  readonly blockTable: MpqBlockEntry[];
  private readonly data: Uint8Array;
  private readonly base: number;

  private constructor(data: Uint8Array, base: number, sectorSize: number, hashTable: MpqHashEntry[], blockTable: MpqBlockEntry[]) {
    this.data = data;
    this.base = base;
    this.sectorSize = sectorSize;
    this.hashTable = hashTable;
    this.blockTable = blockTable;
  }

  static open(input: ArrayBuffer | Uint8Array): MpqArchive {
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // 헤더는 512바이트 경계에서 탐색 ('MPQ\x1B' 사용자 데이터 헤더는 실제 헤더 오프셋을 가리킨다)
    let base = -1;
    for (let off = 0; off + 32 <= data.length; off += 0x200) {
      const magic = view.getUint32(off, true);
      if (magic === 0x1a51504d) { base = off; break; }
      if (magic === 0x1b51504d) { base = off + view.getUint32(off + 8, true); break; }
    }
    if (base < 0 || base + 32 > data.length || view.getUint32(base, true) !== 0x1a51504d) {
      throw new MpqError('MPQ header not found');
    }
    const sectorShift = view.getUint16(base + 14, true);
    const hashOffset = view.getUint32(base + 16, true);
    const blockOffset = view.getUint32(base + 20, true);
    const hashCount = view.getUint32(base + 24, true);
    const blockCount = view.getUint32(base + 28, true);

    const readTable = (offset: number, count: number, key: number): Uint32Array => {
      const start = base + offset;
      if (start + count * 16 > data.length) throw new MpqError('MPQ table out of range');
      const words = new Uint32Array(count * 4);
      for (let i = 0; i < words.length; i++) words[i] = view.getUint32(start + i * 4, true);
      decryptBlock(words, key);
      return words;
    };

    const hw = readTable(hashOffset, hashCount, hashString('(hash table)', HASH_FILE_KEY));
    const hashTable: MpqHashEntry[] = [];
    for (let i = 0; i < hashCount; i++) {
      const w2 = hw[i * 4 + 2] ?? 0;
      hashTable.push({
        nameA: hw[i * 4] ?? 0,
        nameB: hw[i * 4 + 1] ?? 0,
        locale: w2 & 0xffff,
        platform: w2 >>> 16,
        blockIndex: hw[i * 4 + 3] ?? 0,
      });
    }
    const bw = readTable(blockOffset, blockCount, hashString('(block table)', HASH_FILE_KEY));
    const blockTable: MpqBlockEntry[] = [];
    for (let i = 0; i < blockCount; i++) {
      blockTable.push({
        offset: bw[i * 4] ?? 0,
        compressedSize: bw[i * 4 + 1] ?? 0,
        fileSize: bw[i * 4 + 2] ?? 0,
        flags: bw[i * 4 + 3] ?? 0,
      });
    }
    return new MpqArchive(data, base, 512 << sectorShift, hashTable, blockTable);
  }

  /** 출처: Zezula MPQ format — "Hash table" 탐색: 빈 엔트리에서 중단, 삭제 엔트리는 건너뜀 */
  findBlock(path: string): MpqBlockEntry | null {
    const size = this.hashTable.length;
    if (size === 0) return null;
    const start = hashString(path, HASH_TABLE_OFFSET) & (size - 1);
    const a = hashString(path, HASH_NAME_A);
    const b = hashString(path, HASH_NAME_B);
    for (let i = 0; i < size; i++) {
      const e = this.hashTable[(start + i) & (size - 1)];
      if (!e || e.blockIndex === HASH_ENTRY_EMPTY) return null;
      if (e.blockIndex !== HASH_ENTRY_DELETED && e.nameA === a && e.nameB === b) {
        const block = this.blockTable[e.blockIndex];
        if (block && block.flags & MPQ_FILE_EXISTS && !(block.flags & MPQ_FILE_DELETE_MARKER)) return block;
        return null;
      }
    }
    return null;
  }

  has(path: string): boolean {
    return this.findBlock(path) !== null;
  }

  read(path: string): Uint8Array | null {
    const block = this.findBlock(path);
    if (!block) return null;
    return this.readBlock(block, path);
  }

  /** (listfile) 이 있으면 파일 목록 반환 */
  list(): string[] {
    const raw = this.read('(listfile)');
    if (!raw) return [];
    return new TextDecoder('latin1').decode(raw).split(/[\r\n;]+/).filter((s) => s.length > 0);
  }

  private fileKey(path: string, block: MpqBlockEntry): number {
    const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1);
    let key = hashString(name, HASH_FILE_KEY);
    // 출처: Zezula — MPQ_FILE_FIX_KEY: key = (key + BlockOffset) ^ FileSize
    if (block.flags & MPQ_FILE_FIX_KEY) key = ((key + block.offset) >>> 0 ^ block.fileSize) >>> 0;
    return key;
  }

  private readBlock(block: MpqBlockEntry, path: string): Uint8Array {
    const start = this.base + block.offset;
    if (start + block.compressedSize > this.data.length) throw new MpqError(`MPQ block out of range: ${path}`);
    const raw = this.data.slice(start, start + block.compressedSize);
    const encrypted = (block.flags & MPQ_FILE_ENCRYPTED) !== 0;
    const key = encrypted ? this.fileKey(path, block) : 0;
    const packed = (block.flags & (MPQ_FILE_COMPRESS | MPQ_FILE_IMPLODE)) !== 0;

    if (block.flags & MPQ_FILE_SINGLE_UNIT) {
      if (encrypted) decryptBytes(raw, key);
      return packed && raw.length < block.fileSize ? decompressSector(raw, block.fileSize, block.flags, path) : raw;
    }

    const sectorCount = Math.ceil(block.fileSize / this.sectorSize);
    const out = new Uint8Array(block.fileSize);

    if (!packed) {
      // 압축 없는 파일: 섹터 오프셋 테이블 없이 연속 저장, 섹터별로 key+i 복호화
      for (let i = 0; i < sectorCount; i++) {
        const s = i * this.sectorSize;
        const chunk = raw.subarray(s, Math.min(s + this.sectorSize, block.fileSize));
        if (encrypted) decryptBytes(chunk, (key + i) >>> 0);
        out.set(chunk, s);
      }
      return out;
    }

    // 섹터 오프셋 테이블 (sectorCount + 1 개, SECTOR_CRC 면 +1). 암호화 키는 key - 1.
    const entries = sectorCount + 1 + (block.flags & MPQ_FILE_SECTOR_CRC ? 1 : 0);
    const tableBytes = raw.slice(0, entries * 4);
    if (encrypted) decryptBytes(tableBytes, (key - 1) >>> 0);
    const tv = new DataView(tableBytes.buffer, tableBytes.byteOffset, tableBytes.byteLength);
    for (let i = 0; i < sectorCount; i++) {
      const from = tv.getUint32(i * 4, true);
      const to = tv.getUint32((i + 1) * 4, true);
      if (to < from || to > raw.length) throw new MpqError(`MPQ sector table corrupt: ${path}`);
      const sector = raw.slice(from, to);
      if (encrypted) decryptBytes(sector, (key + i) >>> 0);
      const expected = Math.min(this.sectorSize, block.fileSize - i * this.sectorSize);
      const plain = sector.length < expected ? decompressSector(sector, expected, block.flags, path) : sector;
      out.set(plain.subarray(0, expected), i * this.sectorSize);
    }
    return out;
  }
}

/** 출처: StormLib SCompDecompress — 압축 해제 순서: (bzip2|zlib|pkware) → huffman → adpcm */
function decompressSector(input: Uint8Array, outSize: number, flags: number, path: string): Uint8Array {
  if (flags & MPQ_FILE_IMPLODE) return runDecompressor(COMPRESSION.PKWARE, input, outSize, path);
  const mask = input[0] ?? 0;
  let data = input.subarray(1);
  const order = [COMPRESSION.BZIP2, COMPRESSION.ZLIB, COMPRESSION.PKWARE, COMPRESSION.HUFFMAN, COMPRESSION.ADPCM_STEREO, COMPRESSION.ADPCM_MONO];
  const known = order.reduce((m, b) => m | b, 0);
  if (mask & ~known) throw new MpqError(`unsupported compression 0x${mask.toString(16)}: ${path}`);
  for (const bit of order) {
    if (mask & bit) data = runDecompressor(bit, data, outSize, path);
  }
  return data;
}

function runDecompressor(bit: number, input: Uint8Array, outSize: number, path: string): Uint8Array {
  const fn = decompressors.get(bit);
  if (!fn) throw new MpqError(`unsupported compression 0x${bit.toString(16)}: ${path}`);
  return fn(input, outSize);
}

/** 여러 아카이브를 우선순위대로 조회 (예: patch_d2 > d2data > d2char …) */
export class MpqChain {
  private readonly archives: MpqArchive[];
  constructor(archives: MpqArchive[]) {
    this.archives = archives;
  }
  read(path: string): Uint8Array | null {
    for (const a of this.archives) {
      if (a.has(path)) return a.read(path);
    }
    return null;
  }
  has(path: string): boolean {
    return this.archives.some((a) => a.has(path));
  }
}
