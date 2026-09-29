// 스킬 수치 계산: 공식 파라미터, 마나 소모, 레벨별 물리/원소 피해, 원소 지속시간, 명중 보너스.
// 출처: D2MOO source/D2Common/src/D2Skills.cpp
//   SKILLS_GetSpecialParamValue (파라미터 번호 = skillcalc.txt 행 순서), D2Common_11033 (dm 공식),
//   SKILLS_GetManaCosts, SKILLS_CalculateDamageBonusByLevel, SKILLS_GetMin/MaxPhysDamage, SKILLS_GetMin/MaxElemDamage,
//   SKILLS_GetElementalLength, SKILLS_GetToHitFactor
// 피해 값은 원작처럼 1/256 단위 정수로 다룬다 (… << HitShift).
import { evalCalc, type CalcNode } from './calc';
import type { SkillDb, SkillRecord } from './db';

/** 공식이 참조하는 스킬 사용 유닛 */
export interface SkillOwner {
  /** 하드 포인트 레벨 (공식의 blvl) */
  baseLevel(skillId: number): number;
  /** 유효 레벨 (+스킬 포함, 공식의 lvl) */
  skillLevel(skillId: number): number;
  /** 유닛(캐릭터) 레벨 (ulvl) */
  unitLevel: number;
  /** 원소 마스터리 % (passive_fire_mastery 등, 없으면 0) */
  mastery?(eType: string): number;
}

/** dm 공식: 레벨이 오를수록 증가량이 줄어드는 값 (min 에서 시작해 max 에 수렴). 출처: D2MOO D2Common_11033 */
export function diminishing(lvl: number, min: number, max: number): number {
  const v = min + Math.trunc(Math.trunc(Math.trunc((max - min) * 110 * lvl) / (lvl + 6)) / 100);
  return Math.min(v, max);
}

/** 레벨 구간별 추가 피해 합 (레벨 2~8: [0], 9~16: [1], 17~22: [2], 23~28: [3], 29+: [4]). 출처: D2MOO SKILLS_CalculateDamageBonusByLevel */
export function levelDamageBonus(lvl: number, per: number[]): number {
  const [a = 0, b = 0, c = 0, d = 0, e = 0] = per;
  if (lvl <= 1) return 0;
  if (lvl > 28) return 7 * a + e * (lvl - 28) + 6 * (c + d) + 8 * b;
  if (lvl > 22) return 7 * a + d * (lvl - 22) + 6 * c + 8 * b;
  if (lvl > 16) return 7 * a + c * (lvl - 16) + 8 * b;
  if (lvl > 8) return 7 * a + b * (lvl - 8);
  return a * (lvl - 1);
}

export class SkillCalc {
  readonly db: SkillDb;

  constructor(db: SkillDb) {
    this.db = db;
  }

  /** skillcalc.txt 파라미터 값. 출처: D2MOO SKILLS_GetSpecialParamValue (case 번호 = skillcalc.txt 행) */
  param(s: SkillRecord, name: string, lvl: number, o: SkillOwner): number {
    const p = s.params;
    const ln = (a: number, b: number) => (lvl > 0 ? (p[a] ?? 0) + (lvl - 1) * (p[b] ?? 0) : 0);
    const dm = (a: number, b: number) => (lvl > 0 ? diminishing(lvl, p[a] ?? 0, p[b] ?? 0) : 0);
    switch (name) {
      case 'ln12': return ln(0, 1);
      case 'dm12': return dm(0, 1);
      case 'ln34': return ln(2, 3);
      case 'dm34': return dm(2, 3);
      case 'ln56': return ln(4, 5);
      case 'dm56': return dm(4, 5);
      case 'ln78': return ln(6, 7);
      // 원작: case 7 (dm78) 만 레벨 0 검사가 없다
      case 'dm78': return diminishing(lvl, p[6] ?? 0, p[7] ?? 0);
      case 'par1': case 'par2': case 'par3': case 'par4': case 'par5': case 'par6': case 'par7': case 'par8':
        return p[Number(name.slice(3)) - 1] ?? 0;
      case 'lvl': return lvl;
      case 'edmn': return this.minElem256(s, lvl, o, false) >> 8;
      case 'edmx': return this.maxElem256(s, lvl, o, false) >> 8;
      case 'edln': return this.elemLength(s, lvl, o);
      case 'toht': return this.toHit(s, lvl, o);
      case 'mana': return lvl > 0 ? this.manaCost256(s, lvl) >> 8 : 0;
      case 'edns': return this.minElem256(s, lvl, o, false);
      case 'edxs': return this.maxElem256(s, lvl, o, false);
      case 'ulvl': return o.unitLevel;
      case 'blvl': return o.baseLevel(s.id);
      case 'usmc': return lvl > 0 ? this.manaCost256(s, lvl) : 0;
      case 'enma': return this.minElem256(s, lvl, o, true) >> 8;
      case 'exma': return this.maxElem256(s, lvl, o, true) >> 8;
      case 'edma': return this.elemLength(s, lvl, o);
      case 'enms': return this.minElem256(s, lvl, o, true);
      case 'exms': return this.maxElem256(s, lvl, o, true);
      case 'clc1': case 'clc2': case 'clc3': case 'clc4':
        return this.eval(s, s.calcs[Number(name.slice(3)) - 1] ?? null, lvl, o);
      case 'len': return this.eval(s, s.auraLenCalc, lvl, o);
      case 'rng': return this.eval(s, s.auraRangeCalc, lvl, o);
      default:
        // 원작 데이터 오타(예: Bone Wall calc2 'par34') 등 알 수 없는 이름은 0
        return 0;
    }
  }

  eval(s: SkillRecord, node: CalcNode | null, lvl: number, o: SkillOwner): number {
    return evalCalc(node, {
      param: (name) => this.param(s, name, lvl, o),
      ref: (fn, target, name) => {
        if (fn !== 'skill') return 0; // stat()/miss() 참조는 Act 1 범위 스킬에서 쓰이지 않는다 (Hydra 등)
        const other = this.db.byNameOf(target);
        return other ? this.param(other, name, o.skillLevel(other.id), o) : 0;
      },
    });
  }

  /** 마나 소모 (1/256 단위) = (mana + (lvl-1) × lvlmana) << manashift, 최소 minmana. 출처: D2MOO SKILLS_GetManaCosts / D2GAME_SKILLMANA_Consume */
  manaCost256(s: SkillRecord, lvl: number): number {
    const cost = (s.mana + (lvl - 1) * s.lvlMana) * 2 ** s.manaShift;
    return Math.max(cost, s.minMana * 256);
  }

  /** 스킬 자체 물리 피해 (무기 제외, 1/256 단위). 출처: D2MOO SKILLS_GetMinPhysDamage (a4 = 0) */
  minPhys256(s: SkillRecord, lvl: number, o: SkillOwner): number {
    return this.phys(s, lvl, o, s.minDam, s.minLevDam);
  }
  maxPhys256(s: SkillRecord, lvl: number, o: SkillOwner): number {
    return this.phys(s, lvl, o, s.maxDam, s.maxLevDam);
  }
  private phys(s: SkillRecord, lvl: number, o: SkillOwner, base: number, per: number[]): number {
    let d = base + levelDamageBonus(lvl, per);
    if (s.dmgSymPerCalc) {
      const bonus = this.eval(s, s.dmgSymPerCalc, lvl, o);
      if (bonus) d += Math.trunc((d * bonus) / 100);
    }
    return d * 2 ** s.hitShift;
  }

  /** 원소 피해 (1/256 단위). 출처: D2MOO SKILLS_GetMinElemDamage / GetMaxElemDamage */
  minElem256(s: SkillRecord, lvl: number, o: SkillOwner, withMastery: boolean): number {
    if (lvl <= 0) return 0;
    let d = (s.eMin + levelDamageBonus(lvl, s.eMinLev)) * 2 ** s.hitShift;
    // 원작: 최소값의 시너지는 피해가 1 초과이거나 레벨당 증가가 있을 때만 적용
    if (s.eDmgSymPerCalc && (d > 256 || s.eMinLev[0])) {
      const bonus = this.eval(s, s.eDmgSymPerCalc, lvl, o);
      if (bonus) d += Math.trunc((d * bonus) / 100);
    }
    if (withMastery && o.mastery) d += Math.trunc((d * o.mastery(s.eType)) / 100);
    return d;
  }
  maxElem256(s: SkillRecord, lvl: number, o: SkillOwner, withMastery: boolean): number {
    if (lvl <= 0) return 0;
    let d = (s.eMax + levelDamageBonus(lvl, s.eMaxLev)) * 2 ** s.hitShift;
    if (s.eDmgSymPerCalc) {
      const bonus = this.eval(s, s.eDmgSymPerCalc, lvl, o);
      if (bonus) d += Math.trunc((d * bonus) / 100);
    }
    if (withMastery && o.mastery) d += Math.trunc((d * o.mastery(s.eType)) / 100);
    return d;
  }

  /** 원소 지속시간 (프레임). 출처: D2MOO SKILLS_GetElementalLength */
  elemLength(s: SkillRecord, lvl: number, o: SkillOwner): number {
    if (lvl <= 0) return 0;
    const [a = 0, b = 0, c = 0] = s.eLevLen;
    let len: number;
    if (lvl <= 8) len = a * (lvl - 1);
    else if (lvl <= 16) len = 7 * a + (lvl - 8) * b;
    else len = 7 * a + (lvl - 16) * c + 8 * b;
    len += s.eLen;
    if (s.eLenSymPerCalc) {
      const bonus = this.eval(s, s.eLenSymPerCalc, lvl, o);
      if (bonus) len += Math.trunc((len * bonus) / 100);
    }
    return len;
  }

  /** 명중 보너스 % (ToHitCalc 가 있으면 공식, 없으면 ToHit + (lvl-1) × LevToHit). 출처: D2MOO SKILLS_GetToHitFactor */
  toHit(s: SkillRecord, lvl: number, o: SkillOwner): number {
    if (lvl <= 0) return 0;
    return s.toHitCalc ? this.eval(s, s.toHitCalc, lvl, o) : s.toHit + (lvl - 1) * s.levToHit;
  }

  /** calc1~4 */
  calc(s: SkillRecord, index: 1 | 2 | 3 | 4, lvl: number, o: SkillOwner): number {
    return this.eval(s, s.calcs[index - 1] ?? null, lvl, o);
  }
}
