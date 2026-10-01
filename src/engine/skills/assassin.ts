// 어쌔신 스킬 공식 (원작 1.14d LoD). 유닛 조작은 game.ts skillEvent, 여기는 공식만.
// 출처: D2MOO source/D2Game/src/SKILLS/SkillAss.cpp, D2Common/src/D2Skills.cpp SKILLS_CalculateKickDamage
import type { ItemBase } from '../items';
import type { CalcNode } from './calc';
import type { SkillRecord } from './db';

/** 무술 차지 상태 (states.txt progressive_*, pgsv) — 풀 때 이 차례 */
export const PROGRESSIVE_STATES = ['progressive_damage', 'progressive_steal', 'progressive_fire', 'progressive_lightning', 'progressive_cold', 'progressive_other'] as const;

/** 차지 최대 3 (출처: SkillAss.cpp:247 SrvDo034 — nNewValue = min(old + 1, 3)) */
export const MAX_CHARGES = 3;

/** 풀기 미사일: 2차지 srvmissileb, 3차지 srvmissilec, 그 밖 srvmissilea. 출처: SKILLS_GetProgressiveSkillMissileId (SkillAss.cpp:516) */
export function progressiveMissile(s: SkillRecord, charges: number): string {
  if (s.progressive && charges >= 3 && s.srvMissileC) return s.srvMissileC;
  if (s.progressive && charges === 2 && s.srvMissileB) return s.srvMissileB;
  return s.srvMissileA;
}

/** 풀기 개수·범위 공식: 2차지 prgcalc2, 3차지 prgcalc3, 그 밖 prgcalc1. 출처: SKILLS_EvaluateProgressiveSkillCalc (SkillAss.cpp:550) */
export function progressiveCalc(s: SkillRecord, charges: number): CalcNode | null {
  return s.prgCalc[charges >= 3 ? 2 : charges === 2 ? 1 : 0] ?? null;
}

/**
 * Cobra Strike 흡수 % (prgdam 2): leech = par1 + (lvl − 1)·par2. 1차지 생명, 2차지 생명·마나, 3차지 생명·마나 2배.
 * 출처: SkillAss.cpp sub_6FCF5870
 */
export function cobraLeech(par1: number, par2: number, lvl: number, charges: number): { life: number; mana: number } {
  const v = par1 + (Math.max(1, lvl) - 1) * par2;
  if (charges <= 0) return { life: 0, mana: 0 };
  if (charges === 1) return { life: v, mana: 0 };
  if (charges === 2) return { life: v, mana: v };
  return { life: 2 * v, mana: 2 * v };
}

/**
 * 발차기 피해 (점수, 1/256 아님): 장화 mindam~maxdam + item_kickdamage, × (100 + 장화 StrBonus·Str/100 + DexBonus·Dex/100 + damagepercent(최소 −90))%.
 * 출처: D2Skills.cpp SKILLS_CalculateKickDamage (D2Common:3540)
 */
export function kickDamage(boots: ItemBase | undefined, kickStat: number, str: number, dex: number, dmgPct: number): { min: number; max: number; pct: number } {
  const min = (boots?.minDam ?? 0) + kickStat, max = (boots?.maxDam ?? 0) + kickStat;
  const pct = Math.trunc(((boots?.strBonus ?? 0) * str) / 100) + Math.trunc(((boots?.dexBonus ?? 0) * dex) / 100) + Math.max(-90, dmgPct);
  return { min, max, pct };
}

/** 스킬 피해 % = par1 + (lvl − 1)·par2 (Dragon Talon·Dragon Flight). 출처: SkillAss.cpp sub_6FCF7BC0 / SrvDo052 */
export function linearPct(par1: number, par2: number, lvl: number): number {
  return par1 + (Math.max(1, lvl) - 1) * par2;
}
