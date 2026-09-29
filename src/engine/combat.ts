// 원작 전투 공식.
// 출처: Maxroll — Hit Chance Mechanics (https://maxroll.gg/d2/resources/hit-chance-mechanics)
//   "Chance to Hit = min(max(200% * (AR / (AR + Dr)) * (ALVL / (ALVL + TLVL)), 5%), 95%)"
//   플레이어 AR = (Dex - 7) * 5 + 클래스 상수(charstats ToHitFactor), 방어 = Dex / 4 + 장비
// 출처: Maxroll — Block Mechanics (https://maxroll.gg/d2/resources/block-mechanics)
//   "CTB = min(floor((Shield + Bonus) * (Dexterity - 15) / (clvl * 2)), 75) %", 달리는 중 1/3 (최대 25)
// 출처: Maxroll — Damage Calculation (https://maxroll.gg/d2/resources/damage-calculation)
//   무기 기본 피해 × (1 + (무기 외 +% 피해 + 스탯 보너스) / 100), 스탯 보너스 = Str × StrBonus/100 (+ Dex × DexBonus/100)
import type { Rng } from './rng';

/**
 * 명중률 % (정수). 출처: D2MOO SUNITDMG_IsHitSuccessful — factor = 100 × AR / (AR + DEF) (정수), 확률 = 2 × ALVL × factor / (ALVL + DLVL),
 * 5~95 로 제한. 방어가 음수면 AR 에 더하고, AR 이 음수면 방어에 더한다.
 */
export function hitChance(ar: number, def: number, alvl: number, dlvl: number): number {
  let a = Math.trunc(ar), d = Math.trunc(def);
  if (d < 0) {
    a -= d;
    d = 0;
  }
  if (a < 0) {
    d -= a;
    a = 0;
  }
  const factor = a + d ? Math.trunc((100 * a) / (a + d)) : 100;
  return Math.min(95, Math.max(5, Math.trunc((2 * alvl * factor) / (dlvl + alvl))));
}

export const playerAttackRating = (dex: number, toHitFactor: number, bonus = 0): number => (dex - 7) * 5 + toHitFactor + bonus;
export const playerDefense = (dex: number, equipment = 0): number => Math.floor(dex / 4) + equipment;

export function blockChance(shieldBlock: number, classBonus: number, dex: number, clvl: number, running = false): number {
  if (shieldBlock <= 0) return 0;
  const v = Math.min(75, Math.max(0, Math.floor(((shieldBlock + classBonus) * (dex - 15)) / (clvl * 2))));
  return running ? Math.floor(v / 3) : v;
}

export interface WeaponDamage { min: number; max: number; strBonus: number; dexBonus: number }

export function physicalDamageRange(w: WeaponDamage, str: number, dex: number, offWeaponPercent = 0): { min: number; max: number } {
  const pct = offWeaponPercent + (str * w.strBonus) / 100 + (dex * w.dexBonus) / 100;
  const mul = 1 + pct / 100;
  return { min: Math.floor(w.min * mul), max: Math.floor(w.max * mul) };
}

export function rollDamage(range: { min: number; max: number }, rng: Rng): number {
  return range.min + rng.pick(range.max - range.min + 1);
}

/** 퍼센트 확률 판정 (0~99 롤 < chance) */
export const rollPercent = (chance: number, rng: Rng): boolean => rng.pick(100) < chance;
