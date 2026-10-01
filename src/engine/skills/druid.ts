// 드루이드 스킬의 순수 계산 (변신 모드 변환·스킬 제한·차지·넉백 확률). 게임 상태 없이 원작 함수의 수치 부분만 옮긴다.
// 출처: D2MOO source/D2Common/src/D2Skills.cpp (ConvertMode·ConvertShapeShiftedMode·CheckShapeRestriction),
//       source/D2Game/src/SKILLS/SkillDruid.cpp, source/D2Game/src/MISSILES/MissMode.cpp

import type { SkillRecord } from './db';

/** 플레이어 모드 순서 (원작 PLRMODE 0~19) */
const PLAYER_MODES = ['DT', 'NU', 'WL', 'RN', 'GH', 'TN', 'TW', 'A1', 'A2', 'BL', 'SC', 'TH', 'KK', 'S1', 'S2', 'S3', 'S4', 'DD', 'SQ', 'KB'] as const;
/** 몬스터 모드 순서 (원작 MONMODE 0~15) */
const MONSTER_MODES = ['DT', 'NU', 'WL', 'GH', 'A1', 'A2', 'BL', 'SC', 'S1', 'S2', 'S3', 'S4', 'DD', 'KB', 'SQ', 'RN'] as const;
/** 출처: D2Common dword_6FDD2BD8 — 플레이어 모드 번호 → 몬스터 모드 번호 */
const PLR_TO_MON = [0, 1, 2, 15, 3, 1, 2, 4, 5, 6, 7, 4, 11, 8, 9, 10, 11, 12, 14, 13] as const;

/**
 * 변신한 플레이어의 몬스터 모드: 표로 바꾼 뒤 몬스터 COF 에 없으면 A2/SC→A1, BL→GH, S2~S4→S1, RN→WL, 그 외→NU.
 * 출처: D2Common_11014_ConvertShapeShiftedMode (monstats2 mXX 플래그)
 */
export function shapeMode(playerMode: string, has: (mode: string) => boolean): string {
  const i = PLAYER_MODES.indexOf(playerMode as (typeof PLAYER_MODES)[number]);
  let mode: string = MONSTER_MODES[PLR_TO_MON[i < 0 ? 1 : i] ?? 1] ?? 'NU';
  for (let guard = 0; guard < 8; guard++) {
    if (has(mode) || mode === 'NU') return mode;
    mode = mode === 'A2' || mode === 'SC' ? 'A1' : mode === 'BL' ? 'GH' : mode === 'S2' || mode === 'S3' || mode === 'S4' ? 'S1' : mode === 'RN' ? 'WL' : 'NU';
  }
  return 'NU';
}

/**
 * 변신 제한: restrict 0 = 변신(states.txt restrict) 중에는 못 씀, 1 = 언제나, 2 = State1~3 중 하나가 걸려 있어야 (변신 중).
 * 출처: D2Common_SKILLS_CheckShapeRestriction_6FDB1380
 */
export function shapeAllowed(s: Pick<SkillRecord, 'restrict' | 'states'>, has: (state: string) => boolean, restricted: boolean): boolean {
  if (s.restrict === 0) return !restricted;
  if (s.restrict !== 2) return true;
  if (!restricted) return false;
  for (const st of s.states) {
    if (!st) return false;
    if (has(st)) return true;
  }
  return false;
}

/** Feral Rage·Maul 차지: 명중마다 +1, 상한 calc2. 출처: SKILLS_SrvDo120_FeralRage_Maul (min(calc2, STAT_SKILL_FRENZY + 1)) */
export const nextFrenzy = (cur: number, cap: number): number => Math.max(0, Math.min(cap, cur + 1));

/**
 * Molten Boulder 넉백 확률 (dParam1 = 단계, dParam2 = 기본 %): 0 = 작은 몬스터만 기본 %,
 * 1 = 작은 몬스터 2배·보통 1배·큰 몬스터 없음, 2 이상 = 작은 3배·보통 2배·큰 1배. 출처: MISSMODE_SrvDmg14_MoltenBoulder
 */
export function boulderKnockChance(dParam1: number, dParam2: number, size: { small?: boolean; large?: boolean }): number {
  if (dParam1 < 1) return size.small ? dParam2 : 0;
  if (dParam1 === 1) return size.small ? 2 * dParam2 : size.large ? 0 : dParam2;
  return size.small ? 3 * dParam2 : size.large ? dParam2 : 2 * dParam2;
}
