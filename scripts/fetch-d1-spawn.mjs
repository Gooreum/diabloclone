#!/usr/bin/env node
// 디아블로 1 쉐어웨어 spawn.mpq 를 game-data/diablo1/ 로 받는다 (개발·e2e 용 — 저장소에는 넣지 않는다, .gitignore *.mpq).
// 출처: diabloweb 가 공개 호스팅하는 Blizzard 쉐어웨어 배포본 (https://d07riv.github.io/diabloweb/). 정식판 DIABDAT.MPQ 는 GOG 에서 산 것을 직접 넣는다.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPAWN_URL = 'https://d07riv.github.io/diabloweb/spawn.mpq';
/** 알려진 쉐어웨어 spawn.mpq 크기 (1.09 판본 둘) */
export const SPAWN_SIZES = [25830791, 50274091];

/** 받은 바이트가 쉐어웨어 spawn.mpq 로 보이는지 (크기 + MPQ 헤더). 아니면 이유를 던진다 */
export function checkSpawn(bytes) {
  if (!SPAWN_SIZES.includes(bytes.byteLength)) throw new Error(`spawn.mpq 크기가 다릅니다: ${bytes.byteLength} (기대: ${SPAWN_SIZES.join(' | ')})`);
  if (bytes[0] !== 0x4d || bytes[1] !== 0x50 || bytes[2] !== 0x51 || bytes[3] !== 0x1a) throw new Error('MPQ 헤더가 아닙니다');
  return true;
}

export async function fetchSpawn(dest, url = SPAWN_URL) {
  if (existsSync(dest)) {
    console.log(`이미 있음: ${dest}`);
    return dest;
  }
  console.log(`받는 중… ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`받기 실패: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  checkSpawn(bytes);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  console.log(`저장: ${dest} (${bytes.byteLength} bytes)`);
  return dest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchSpawn(resolve(process.argv[2] ?? 'game-data/diablo1/spawn.mpq')).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
