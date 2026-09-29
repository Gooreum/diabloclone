// 스킬 포인트 투자 규칙 + 패시브 스킬 스탯.
// 출처: The Arreat Summit — Skills: 스킬을 배우려면 요구 레벨(reqlevel)과 선행 스킬(reqskill1~3) 1포인트 이상, 하드 포인트 최대 20
//       (https://classic.battle.net/diablo2exp/skills/) , skills.txt maxlvl = 20
// 출처: D2MOO D2Common/src/D2Skills.cpp SKILLS_RefreshSkill (패시브 스탯 = passivecalc, passiveitype 이 있으면 그 아이템 타입 레이어로 저장),
//       SKILLS_GetWeaponMasteryBonus (무기 마스터리 = 들고 있는 무기 타입과 맞는 레이어 값 중 최대)
import type { ItemBase, ItemDb } from '../items';
import type { Character } from '../player';
import { CLASS_CODE, type SkillDb, type SkillRecord } from './db';
import type { SkillCalc, SkillOwner } from './formulas';

export type LearnError = 'class' | 'points' | 'level' | 'prereq' | 'max';

export function learnError(ch: Character, s: SkillRecord, db: SkillDb): LearnError | null {
  if (s.charclass !== CLASS_CODE[ch.cls]) return 'class';
  if (ch.skillPoints <= 0) return 'points';
  if (ch.level < s.reqLevel) return 'level';
  if ((ch.skills[s.id] ?? 0) >= (s.maxLvl || 20)) return 'max';
  for (const req of s.reqSkills) {
    const r = db.byNameOf(req);
    if (!r || (ch.skills[r.id] ?? 0) < 1) return 'prereq';
  }
  return null;
}

/** 스킬 포인트 1 투자 (성공 시 true) */
export function learnSkill(ch: Character, s: SkillRecord, db: SkillDb): boolean {
  if (learnError(ch, s, db)) return false;
  ch.skillPoints--;
  ch.skills[s.id] = (ch.skills[s.id] ?? 0) + 1;
  return true;
}

/** 캐릭터를 공식 계산용 SkillOwner 로 (클래식 1차 범위에는 +스킬 아이템이 없어 유효 레벨 = 하드 포인트) */
export function characterOwner(ch: Character): SkillOwner {
  return {
    baseLevel: (id) => ch.skills[id] ?? 0,
    skillLevel: (id) => ch.skills[id] ?? 0,
    unitLevel: ch.level,
  };
}

export interface PassiveStat { stat: string; itype: string; value: number }

/** 배운 패시브 스킬의 스탯 목록 */
export function passiveStats(ch: Character, db: SkillDb, calc: SkillCalc): PassiveStat[] {
  const out: PassiveStat[] = [];
  const o = characterOwner(ch);
  for (const [idStr, lvl] of Object.entries(ch.skills)) {
    if (lvl <= 0) continue;
    const s = db.byId.get(Number(idStr));
    if (!s || !s.passiveState || !s.passiveStats.length) continue;
    for (const ps of s.passiveStats) out.push({ stat: ps.stat, itype: s.passiveItype, value: calc.eval(s, ps.calc, lvl, o) });
  }
  return out;
}

/** 아이템 타입 레이어가 없는 패시브 스탯 합 */
export function passiveStat(list: PassiveStat[], stat: string): number {
  let v = 0;
  for (const p of list) if (p.stat === stat && !p.itype) v += p.value;
  return v;
}

/**
 * 무기 마스터리 보너스 (kind: th 명중%, dmg 피해%, crit 치명타%). 던지기 무기를 던질 때는 throw 계열 스탯.
 * 출처: SKILLS_GetWeaponMasteryBonus — 무기 타입에 맞는 레이어 값 중 최대
 */
export function masteryBonus(list: PassiveStat[], items: ItemDb, weapon: ItemBase | undefined, kind: 'th' | 'dmg' | 'crit', thrown = false): number {
  if (!weapon) return 0;
  const stat = `passive_mastery_${thrown ? 'throw' : 'melee'}_${kind}`;
  let best = 0;
  for (const p of list) if (p.stat === stat && p.itype && items.isType(weapon, p.itype)) best = Math.max(best, p.value);
  return best;
}
