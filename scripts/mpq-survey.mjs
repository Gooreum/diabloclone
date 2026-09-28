#!/usr/bin/env node
// 실제 원작 MPQ 의 파일별 저장 방식(플래그·압축 마스크) 분포를 조사한다.
// 목적: 슬라이스에 필요한 압축 방식만 구현하기 위함 (plan.md Phase 2 Step 1).
// 사용: node scripts/mpq-survey.mjs [game-data]
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MpqArchive, MPQ_FILE_COMPRESS, MPQ_FILE_IMPLODE, MPQ_FILE_ENCRYPTED, MPQ_FILE_SINGLE_UNIT, hashString, decryptBlock as decrypt } from '../src/formats/mpq.ts';

const dir = resolve(process.argv[2] ?? 'game-data');
// 슬라이스에 필요한 파일 종류 (확장자 기준)
const SLICE_EXT = ['.txt', '.tbl', '.dat', '.dc6', '.dcc', '.cof', '.dt1', '.ds1', '.pl2', '.bin'];

for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mpq')).sort()) {
  const buf = readFileSync(resolve(dir, file));
  const mpq = MpqArchive.open(buf);
  const names = mpq.list();
  const stats = new Map(); // key: ext|storage → count
  let unknown = 0;
  for (const name of names) {
    const block = mpq.findBlock(name);
    if (!block) { unknown++; continue; }
    const ext = (name.match(/\.[^.\\]+$/)?.[0] ?? '').toLowerCase();
    let storage;
    if (block.flags & MPQ_FILE_IMPLODE) storage = 'implode';
    else if (block.flags & MPQ_FILE_COMPRESS) {
      // 첫 섹터의 압축 마스크를 읽는다 (실제 읽기 경로와 같은 방식으로 복호화)
      storage = 'compress:' + firstMask(buf, mpq, block, name);
    } else storage = 'none';
    if (block.flags & MPQ_FILE_ENCRYPTED) storage += '+enc';
    if (block.flags & MPQ_FILE_SINGLE_UNIT) storage += '+single';
    const key = `${ext}|${storage}`;
    stats.set(key, (stats.get(key) ?? 0) + 1);
  }
  console.log(`\n== ${file}  (listfile ${names.length}개, 블록 ${mpq.blockTable.length}개, 섹터 ${mpq.sectorSize}B)`);
  for (const [k, n] of [...stats.entries()].sort()) {
    const [ext, storage] = k.split('|');
    console.log(`${SLICE_EXT.includes(ext) ? '*' : ' '} ${ext.padEnd(6)} ${storage.padEnd(24)} ${n}`);
  }
  if (unknown) console.log(`  (listfile 에 있으나 해시 테이블에 없음: ${unknown})`);
}

function firstMask(buf, mpq, block, name) {
  // 섹터 테이블 첫 두 항목을 복호화해 첫 섹터가 압축되었는지 확인 후 마스크 바이트 반환
  const base = buf.indexOf(Buffer.from('MPQ\x1a', 'latin1'));
  const start = base + block.offset;
  const view = new DataView(buf.buffer, buf.byteOffset);
  if (block.flags & MPQ_FILE_SINGLE_UNIT) {
    if (block.compressedSize >= block.fileSize) return 'raw';
    return hex(decryptFirstByte(view, start, block, name, 0, block.compressedSize));
  }
  let a = view.getUint32(start, true), b = view.getUint32(start + 4, true);
  if (block.flags & MPQ_FILE_ENCRYPTED) {
    const w = new Uint32Array([a, b]);
    decrypt(w, (fileKey(block, name) - 1) >>> 0);
    [a, b] = w;
  }
  const expected = Math.min(mpq.sectorSize, block.fileSize);
  if (b - a >= expected) return 'raw';
  return hex(decryptFirstByte(view, start + a, block, name, 0, b - a));
}
function decryptFirstByte(view, pos, block, name, sector, len) {
  // 4바이트 미만 꼬리는 암호화되지 않는다 (StormLib 동작)
  if (!(block.flags & MPQ_FILE_ENCRYPTED) || len < 4) return view.getUint8(pos);
  const w = new Uint32Array([view.getUint32(pos, true)]);
  decrypt(w, (fileKey(block, name) + sector) >>> 0);
  return w[0] & 0xff;
}
function fileKey(block, name) {
  let key = hashString(name.slice(name.lastIndexOf('\\') + 1), 3);
  if (block.flags & 0x20000) key = (((key + block.offset) >>> 0) ^ block.fileSize) >>> 0;
  return key;
}
function hex(n) { return '0x' + n.toString(16).padStart(2, '0'); }
