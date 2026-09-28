// 실제 원작 MPQ 접근 (game-data/ 가 없으면 hasGameData=false → 관련 테스트 skip)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';

export const GAME_DATA = resolve(__dirname, '../../game-data');
const find = (n: string) => (existsSync(GAME_DATA) ? readdirSync(GAME_DATA).find((f) => f.toLowerCase() === n) : undefined);
export const hasGameData = ['d2data.mpq', 'd2char.mpq', 'patch_d2.mpq'].every((n) => !!find(n));

let chain: MpqChain | null = null;
/** 원작 우선순위: patch_d2 > d2char > d2data */
export function gameChain(): MpqChain {
  if (!chain) {
    chain = new MpqChain(['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq'].map((n) => MpqArchive.open(readFileSync(resolve(GAME_DATA, find(n) as string)))));
  }
  return chain;
}
export function mustRead(path: string): Uint8Array {
  const b = gameChain().read(path);
  if (!b) throw new Error(`missing in MPQ: ${path}`);
  return b;
}
