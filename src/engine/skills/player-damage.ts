// 플레이어 무기 피해 굴림 (1/256 단위).
// 출처: D2MOO D2Game/src/UNIT/SUnitDmg.cpp SUNITDMG_ApplyDamageBonuses (bGetStats = 1):
//   무기 있음: 무기 최소/최대 피해 << 8, 피해% = 스킬 강화% + damagepercent 스탯 + 무기 StrBonus×힘/100 + DexBonus×민첩/100 + 무기 마스터리
//   무기 없음: 최소 max(1), 최대 max(2), 피해% += 힘
//   피해% 하한 -90, min += min×%/100, max += max×%/100, 피해 = min + rand(max − min), SrcDam ≠ 128 이면 × SrcDam / 128
// 출처: SUNITDMG_FillDamageValues — 무기 마스터리 치명타 → 실패 시 passive_critical_strike → 성공 시 물리 ×2
import type { ItemBase } from '../items';
import type { Rng } from '../rng';

export interface WeaponDamageInput {
  /** 오른손 무기 (없으면 맨손) */
  weapon?: ItemBase;
  /** 던지기 (minmisdam/maxmisdam 사용) */
  thrown?: boolean;
  str: number;
  dex: number;
  /** 스킬 강화 피해% (dwEnDmgPct) */
  enDmgPct: number;
  /** damagepercent 스탯 (버프·저주) */
  damagePercent: number;
  /** 무기 마스터리 피해% */
  masteryDmg: number;
  /** 무기 피해 반영 비율 (128 = 100%) */
  srcDam: number;
  /** 아이템 반영 무기 피해 (정수, 없으면 weapons.txt 기본값) — 무기 자체 ED·추가 피해 포함, 다른 장비 추가 피해 더함 */
  weaponRange?: { min: number; max: number };
  /** 다른 장비의 ED% (힘 보너스와 같은 합산) */
  itemDamagePct?: number;
  /** 기본 피해에 더할 최소/최대 (1/256) — Smite 에 Holy Shield 스킬 피해. 출처: SKILLS_SrvDo150_Smite (SKILLS_GetMin/MaxPhysDamage) */
  extraBase?: { min: number; max: number };
}

/**
 * 무기 기본 피해 (1/256): 한손 피해(mindam)가 있으면 그것, 양손 전용이면 2handmindam, 던지기는 minmisdam. 출처: weapons.txt 컬럼
 * 근사(원작 미확인): 바바리안이 양손검을 한손으로 쥘 때의 구분은 Phase 7 장착 규칙에서 다룬다.
 */
export function weaponBaseRange(w: ItemBase | undefined, thrown = false): { min: number; max: number } {
  if (!w) return { min: 256, max: 512 };
  if (thrown) return { min: w.throwMinDam * 256, max: w.throwMaxDam * 256 };
  if (w.maxDam > 0) return { min: w.minDam * 256, max: w.maxDam * 256 };
  return { min: w.twoHandMinDam * 256, max: w.twoHandMaxDam * 256 };
}

export function weaponDamagePercent(i: WeaponDamageInput): number {
  let pct = i.enDmgPct + i.damagePercent + (i.itemDamagePct ?? 0);
  if (i.weapon) {
    if (i.weapon.strBonus) pct += Math.trunc((i.weapon.strBonus * i.str) / 100);
    if (i.weapon.dexBonus) pct += Math.trunc((i.weapon.dexBonus * i.dex) / 100);
    pct += i.masteryDmg;
  } else {
    pct += i.str;
  }
  return Math.max(pct, -90);
}

/** 굴리지 않은 최소/최대 (1/256) — UI 표시·테스트용 */
const baseOf = (i: WeaponDamageInput) => {
  const b = i.weaponRange && !i.thrown ? { min: i.weaponRange.min * 256, max: i.weaponRange.max * 256 } : weaponBaseRange(i.weapon, i.thrown);
  return i.extraBase ? { min: b.min + i.extraBase.min, max: b.max + i.extraBase.max } : b;
};

export function weaponDamageRange(i: WeaponDamageInput): { min: number; max: number } {
  const base = baseOf(i);
  let min = base.min < 256 ? 256 : base.min;
  let max = base.max <= min ? min + 256 : base.max;
  const pct = weaponDamagePercent(i);
  min += Math.trunc((min * pct) / 100);
  max += Math.trunc((max * pct) / 100);
  if (i.srcDam !== 128) {
    min = Math.trunc((min * i.srcDam) / 128);
    max = Math.trunc((max * i.srcDam) / 128);
  }
  return { min, max };
}

export function rollWeaponDamage(i: WeaponDamageInput, rng: Rng): number {
  const base = baseOf(i);
  let min = base.min < 256 ? 256 : base.min;
  let max = base.max <= min ? min + 256 : base.max;
  const pct = weaponDamagePercent(i);
  min += Math.trunc((min * pct) / 100);
  max += Math.trunc((max * pct) / 100);
  let dmg = min;
  if (max > min) dmg += rng.pick(max - min);
  dmg = Math.max(dmg, 0);
  return i.srcDam === 128 ? dmg : Math.trunc((dmg * i.srcDam) / 128);
}

/** 치명타 판정 (무기 마스터리 치명타 → 패시브 치명타). 출처: SUNITDMG_FillDamageValues */
export function rollCritical(masteryCrit: number, criticalStrike: number, rng: Rng): boolean {
  if (masteryCrit > 0 && rng.pick(100) < masteryCrit) return true;
  return criticalStrike > 0 && rng.pick(100) < criticalStrike;
}
