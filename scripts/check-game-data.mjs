#!/usr/bin/env node
// game-data/ 에 원작 D2 클래식 MPQ가 모두 있는지, 헤더가 올바른지 검사한다.
// 출처: Zezula MPQ format — MPQ 헤더 시그니처 'MPQ\x1A', 사용자 데이터 헤더 'MPQ\x1B' (http://www.zezula.net/en/mpq/mpqformat.html)
import { openSync, readSync, closeSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED = ['d2data.mpq', 'd2char.mpq', 'd2sfx.mpq', 'd2music.mpq', 'd2speech.mpq', 'patch_d2.mpq'];

function readHeader(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(4);
    const n = readSync(fd, buf, 0, 4, 0);
    return n === 4 ? buf : null;
  } finally {
    closeSync(fd);
  }
}

/** @returns {{ ok: string[], missing: string[], invalid: string[] }} */
export function checkGameData(dir) {
  const result = { ok: [], missing: [], invalid: [] };
  const files = existsSync(dir) ? readdirSync(dir) : [];
  for (const name of REQUIRED) {
    const actual = files.find((f) => f.toLowerCase() === name);
    if (!actual) {
      result.missing.push(name);
      continue;
    }
    const h = readHeader(join(dir, actual));
    const valid = h && h[0] === 0x4d && h[1] === 0x50 && h[2] === 0x51 && (h[3] === 0x1a || h[3] === 0x1b);
    (valid ? result.ok : result.invalid).push(actual);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? 'game-data');
  const { ok, missing, invalid } = checkGameData(dir);
  for (const f of ok) console.log(`OK       ${f}`);
  for (const f of missing) console.log(`MISSING  ${f}`);
  for (const f of invalid) console.log(`INVALID  ${f} (invalid header)`);
  if (missing.length || invalid.length) {
    console.log(`\n${dir} 에 원작 Diablo II 설치 폴더의 MPQ 파일을 복사해 주세요.`);
    process.exit(1);
  }
  console.log('\n모든 MPQ 확인 완료');
}
