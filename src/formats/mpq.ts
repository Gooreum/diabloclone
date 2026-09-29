// MPQ 아카이브 리더 (Diablo II 는 포맷 v1 사용).
// 출처: Zezula — MPQ file format (http://www.zezula.net/en/mpq/mpqformat.html)
// 출처: StormLib — SBaseCommon.cpp / SFileReadFile.cpp (https://github.com/ladislav-zezula/StormLib)
import { explode } from './compress/pkware.ts';
import { inflateZlib } from './compress/zlib.ts';
import { decompressHuffman } from './compress/huffman.ts';
import { decompressAdpcmMono, decompressAdpcmStereo } from './compress/adpcm.ts';

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
// 사운드 MPQ(Phase 11, 전 섹터를 읽어 압축 비트 집계): d2sfx WAV 2290개 0x41(huffman+ADPCM 모노)·29개 0x81,
// d2music 33개 전부 0x81(huffman+ADPCM 스테레오), d2speech 1565개 전부 0x41. bzip2(0x10)·sparse 는 미사용 → 미구현.
const decompressors = new Map<number, Decompressor>([
  [0x08, explode],
  [0x02, inflateZlib],
  [0x01, decompressHuffman],
  [0x40, decompressAdpcmMono],
  [0x80, decompressAdpcmStereo],
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

export interface MpqHeader { base: number; sectorSize: number; hashOffset: number; blockOffset: number; hashCount: number; blockCount: number }

/** 헤더 탐색: 512바이트 경계, 'MPQ\x1B' 사용자 데이터 헤더는 실제 헤더 오프셋을 가리킨다. bytes 는 파일 앞부분 */
export function parseHeader(bytes: Uint8Array): MpqHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let base = -1;
  for (let off = 0; off + 32 <= bytes.length; off += 0x200) {
    const magic = view.getUint32(off, true);
    if (magic === 0x1a51504d) { base = off; break; }
    if (magic === 0x1b51504d) { base = off + view.getUint32(off + 8, true); break; }
  }
  if (base < 0 || base + 32 > bytes.length || view.getUint32(base, true) !== 0x1a51504d) throw new MpqError('MPQ header not found');
  return {
    base,
    sectorSize: 512 << view.getUint16(base + 14, true),
    hashOffset: view.getUint32(base + 16, true),
    blockOffset: view.getUint32(base + 20, true),
    hashCount: view.getUint32(base + 24, true),
    blockCount: view.getUint32(base + 28, true),
  };
}

function decryptTable(bytes: Uint8Array, count: number, key: number): Uint32Array {
  if (bytes.length < count * 16) throw new MpqError('MPQ table out of range');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = new Uint32Array(count * 4);
  for (let i = 0; i < words.length; i++) words[i] = view.getUint32(i * 4, true);
  decryptBlock(words, key);
  return words;
}

export function parseHashTable(bytes: Uint8Array, count: number): MpqHashEntry[] {
  const hw = decryptTable(bytes, count, hashString('(hash table)', HASH_FILE_KEY));
  const out: MpqHashEntry[] = [];
  for (let i = 0; i < count; i++) {
    const w2 = hw[i * 4 + 2] ?? 0;
    out.push({ nameA: hw[i * 4] ?? 0, nameB: hw[i * 4 + 1] ?? 0, locale: w2 & 0xffff, platform: w2 >>> 16, blockIndex: hw[i * 4 + 3] ?? 0 });
  }
  return out;
}

export function parseBlockTable(bytes: Uint8Array, count: number): MpqBlockEntry[] {
  const bw = decryptTable(bytes, count, hashString('(block table)', HASH_FILE_KEY));
  const out: MpqBlockEntry[] = [];
  for (let i = 0; i < count; i++) out.push({ offset: bw[i * 4] ?? 0, compressedSize: bw[i * 4 + 1] ?? 0, fileSize: bw[i * 4 + 2] ?? 0, flags: bw[i * 4 + 3] ?? 0 });
  return out;
}

/** 헤더 + 해시/블록 테이블 (데이터 접근 방식과 무관) */
export class MpqIndex {
  readonly header: MpqHeader;
  readonly hashTable: MpqHashEntry[];
  readonly blockTable: MpqBlockEntry[];

  constructor(header: MpqHeader, hashTable: MpqHashEntry[], blockTable: MpqBlockEntry[]) {
    this.header = header;
    this.hashTable = hashTable;
    this.blockTable = blockTable;
  }

  get sectorSize(): number {
    return this.header.sectorSize;
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
}

function fileKey(path: string, block: MpqBlockEntry): number {
  const name = path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1);
  let key = hashString(name, HASH_FILE_KEY);
  // 출처: Zezula — MPQ_FILE_FIX_KEY: key = (key + BlockOffset) ^ FileSize
  if (block.flags & MPQ_FILE_FIX_KEY) key = ((key + block.offset) >>> 0 ^ block.fileSize) >>> 0;
  return key;
}

/** 블록 원본 바이트(raw, 길이 compressedSize) → 파일 내용 (복호화 + 섹터별 압축 해제) */
export function decodeBlock(rawInput: Uint8Array, block: MpqBlockEntry, sectorSize: number, path: string): Uint8Array {
  const raw = rawInput.slice();
  const encrypted = (block.flags & MPQ_FILE_ENCRYPTED) !== 0;
  const key = encrypted ? fileKey(path, block) : 0;
  const packed = (block.flags & (MPQ_FILE_COMPRESS | MPQ_FILE_IMPLODE)) !== 0;

  if (block.flags & MPQ_FILE_SINGLE_UNIT) {
    if (encrypted) decryptBytes(raw, key);
    return packed && raw.length < block.fileSize ? decompressSector(raw, block.fileSize, block.flags, path) : raw;
  }

  const sectorCount = Math.ceil(block.fileSize / sectorSize);
  const out = new Uint8Array(block.fileSize);

  if (!packed) {
    // 압축 없는 파일: 섹터 오프셋 테이블 없이 연속 저장, 섹터별로 key+i 복호화
    for (let i = 0; i < sectorCount; i++) {
      const s = i * sectorSize;
      const chunk = raw.subarray(s, Math.min(s + sectorSize, block.fileSize));
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
    const expected = Math.min(sectorSize, block.fileSize - i * sectorSize);
    const plain = sector.length < expected ? decompressSector(sector, expected, block.flags, path) : sector;
    out.set(plain.subarray(0, expected), i * sectorSize);
  }
  return out;
}

/** 메모리 전체 버퍼 기반 MPQ (Node 테스트/스크립트) */
export class MpqArchive extends MpqIndex {
  private readonly data: Uint8Array;

  private constructor(data: Uint8Array, header: MpqHeader, hashTable: MpqHashEntry[], blockTable: MpqBlockEntry[]) {
    super(header, hashTable, blockTable);
    this.data = data;
  }

  static open(input: ArrayBuffer | Uint8Array): MpqArchive {
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    const h = parseHeader(data);
    const at = (off: number, len: number) => {
      const s = h.base + off;
      if (s + len > data.length) throw new MpqError('MPQ table out of range');
      return data.subarray(s, s + len);
    };
    return new MpqArchive(data, h, parseHashTable(at(h.hashOffset, h.hashCount * 16), h.hashCount), parseBlockTable(at(h.blockOffset, h.blockCount * 16), h.blockCount));
  }

  read(path: string): Uint8Array | null {
    const block = this.findBlock(path);
    if (!block) return null;
    const start = this.header.base + block.offset;
    if (start + block.compressedSize > this.data.length) throw new MpqError(`MPQ block out of range: ${path}`);
    return decodeBlock(this.data.subarray(start, start + block.compressedSize), block, this.sectorSize, path);
  }

  /** (listfile) 이 있으면 파일 목록 반환 */
  list(): string[] {
    const raw = this.read('(listfile)');
    if (!raw) return [];
    return new TextDecoder('latin1').decode(raw).split(/[\r\n;]+/).filter((s) => s.length > 0);
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
