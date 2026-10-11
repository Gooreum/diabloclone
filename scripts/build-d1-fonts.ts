// 디아블로 1 한글 글꼴: DevilutionX 의 fonts.mpq(devilutionx-assets, SIL OFL)에서 한국어에 필요한 부분만 골라 작은 MPQ 로 만든다.
// 원본은 58MB(중국어·일본어 포함) — 한국어 번역(Translations/ko.po)에 쓰는 글자는 기본 글꼴(0x00) + 한글 음절(0xAC~0xD7)뿐이라 그 블록만 담는다.
// 쓰임: npx tsx scripts/build-d1-fonts.ts [fonts.mpq 경로]  → public/d1x/fonts-ko.mpq
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptBlock, hashString, HASH_NAME_A, HASH_NAME_B, HASH_TABLE_OFFSET, MPQ_FILE_EXISTS, MpqArchive } from '../src/formats/mpq';

export const FONTS_URL = 'https://github.com/diasurgical/devilutionx-assets/releases/download/v5/fonts.mpq';
export const FONTS_SHA256 = '551ecee2d95b4e7807737a7794a6bacf0b4a03a91634816277b91db35ce1e259';
/** 글꼴 크기(12·24·30·42·46) × 한글 음절 블록 */
export const KO_FONT = /^fonts\\\d+-(a[c-f]|b[0-9a-f]|c[0-9a-f]|d[0-7])\.clx$/;
export const FONT_SIZES = [12, 24, 30, 42, 46];

/** 담을 파일 이름: 버전 표시 + 한글 블록 (원본에 있는 것만) */
export function koreanFontFiles(src: MpqArchive): string[] {
  const names = ['fonts\\VERSION'];
  for (const size of FONT_SIZES) {
    for (let b = 0xac; b <= 0xd7; b++) names.push(`fonts\\${size}-${b.toString(16)}.clx`);
  }
  return names.filter((n) => src.has(n));
}

/** 원본 MPQ 에서 고른 파일의 블록(압축된 그대로)을 옮겨 담은 새 MPQ. 원본 블록은 암호화되지 않아 위치가 바뀌어도 된다 */
export function buildSubset(raw: Uint8Array, names: string[]): Uint8Array {
  const src = MpqArchive.open(raw);
  const listfile = new TextEncoder().encode(names.join('\r\n') + '\r\n');
  const files: { name: string; data: Uint8Array; fileSize: number; flags: number }[] = names.map((name) => {
    const b = src.findBlock(name)!;
    if (b.flags & 0x00010000) throw new Error(`암호화된 블록은 옮길 수 없습니다: ${name}`);
    const start = src.header.base + b.offset;
    return { name, data: raw.subarray(start, start + b.compressedSize), fileSize: b.fileSize, flags: b.flags };
  });
  files.push({ name: '(listfile)', data: listfile, fileSize: listfile.length, flags: MPQ_FILE_EXISTS });

  let hashSize = 16;
  while (hashSize < files.length * 2) hashSize *= 2;
  const dataSize = files.reduce((s, f) => s + f.data.length, 0);
  const hashOffset = 32 + dataSize;
  const blockOffset = hashOffset + hashSize * 16;
  const total = blockOffset + files.length * 16;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set([0x4d, 0x50, 0x51, 0x1a]);
  v.setUint32(4, 32, true);
  v.setUint32(8, total, true);
  v.setUint16(12, 0, true);
  v.setUint16(14, Math.log2(src.header.sectorSize / 512), true);
  v.setUint32(16, hashOffset, true);
  v.setUint32(20, blockOffset, true);
  v.setUint32(24, hashSize, true);
  v.setUint32(28, files.length, true);

  const hash = new Uint32Array(hashSize * 4).fill(0xffffffff);
  const block = new Uint32Array(files.length * 4);
  let at = 32;
  files.forEach((f, i) => {
    out.set(f.data, at);
    block.set([at, f.data.length, f.fileSize, f.flags >>> 0], i * 4);
    at += f.data.length;
    let slot = hashString(f.name, HASH_TABLE_OFFSET) & (hashSize - 1);
    while (hash[slot * 4 + 3] !== 0xffffffff) slot = (slot + 1) & (hashSize - 1);
    // 이름 A·B, 언어 0 + 플랫폼 0, 블록 번호
    hash.set([hashString(f.name, HASH_NAME_A), hashString(f.name, HASH_NAME_B), 0, i], slot * 4);
  });
  encryptBlock(hash, hashString('(hash table)', 3));
  encryptBlock(block, hashString('(block table)', 3));
  for (let i = 0; i < hash.length; i++) v.setUint32(hashOffset + i * 4, hash[i]!, true);
  for (let i = 0; i < block.length; i++) v.setUint32(blockOffset + i * 4, block[i]!, true);
  return out;
}

async function main(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const path = process.argv[2];
  let raw: Uint8Array;
  if (path && existsSync(path)) raw = new Uint8Array(readFileSync(path));
  else {
    const r = await fetch(FONTS_URL);
    if (!r.ok) throw new Error(`fonts.mpq 를 받지 못했습니다 (HTTP ${r.status})`);
    raw = new Uint8Array(await r.arrayBuffer());
  }
  const sha = createHash('sha256').update(raw).digest('hex');
  if (sha !== FONTS_SHA256) throw new Error(`fonts.mpq 해시가 다릅니다: ${sha}`);
  const names = koreanFontFiles(MpqArchive.open(raw));
  const out = buildSubset(raw, names);
  const dest = join(root, 'public/d1x/fonts-ko.mpq');
  writeFileSync(dest, out);
  console.log(`${dest}: 파일 ${names.length}개, ${(out.length / 1048576).toFixed(1)}MB`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main();
