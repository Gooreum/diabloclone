#!/usr/bin/env node
// 파일명 없이 블록 테이블만으로 저장 방식 분포를 조사한다 (listfile 자체가 압축돼 있을 때 사용).
// 암호화 블록은 파일명을 모르면 섹터를 복호화할 수 없어 'enc(?)' 로 집계한다.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MpqArchive, MPQ_FILE_COMPRESS, MPQ_FILE_IMPLODE, MPQ_FILE_ENCRYPTED, MPQ_FILE_SINGLE_UNIT, MPQ_FILE_EXISTS } from '../src/formats/mpq.ts';

const dir = resolve(process.argv[2] ?? 'game-data');
for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mpq')).sort()) {
  const buf = readFileSync(resolve(dir, file));
  const mpq = MpqArchive.open(buf);
  const base = buf.indexOf(Buffer.from('MPQ\x1a', 'latin1'));
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const stats = new Map();
  for (const b of mpq.blockTable) {
    if (!(b.flags & MPQ_FILE_EXISTS)) continue;
    let k;
    if (b.flags & MPQ_FILE_IMPLODE) k = 'implode';
    else if (b.flags & MPQ_FILE_COMPRESS) {
      if (b.flags & MPQ_FILE_ENCRYPTED) k = 'compress:enc(?)';
      else if (b.flags & MPQ_FILE_SINGLE_UNIT) k = b.compressedSize < b.fileSize ? `compress:0x${dv.getUint8(base + b.offset).toString(16)}` : 'compress:raw';
      else {
        const start = base + b.offset, a = dv.getUint32(start, true), e = dv.getUint32(start + 4, true);
        k = e - a >= Math.min(mpq.sectorSize, b.fileSize) ? 'compress:raw' : `compress:0x${dv.getUint8(start + a).toString(16).padStart(2, '0')}`;
      }
    } else k = 'none';
    if (b.flags & MPQ_FILE_ENCRYPTED) k += '+enc';
    stats.set(k, (stats.get(k) ?? 0) + 1);
  }
  console.log(`\n== ${file}  블록 ${mpq.blockTable.length}, 섹터 ${mpq.sectorSize}B`);
  for (const [k, n] of [...stats.entries()].sort()) console.log(`  ${k.padEnd(24)} ${n}`);
}
