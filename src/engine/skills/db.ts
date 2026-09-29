// 스킬 데이터베이스 (skills.txt + skilldesc.txt 원본).
// 출처: Phrozen Keep — Skills.txt / SkillDesc.txt File Guide (https://d2mods.info/forum/kb/viewarticle?a=344 , a=342)
// 클래식: 캐릭터 스킬은 charclass 가 ama/sor/nec/pal/bar 인 행(클래스당 30개) + 일반 스킬(Attack, Throw …, Id 0~5)
import type { TxtRow } from '../../formats/txt';
import type { ClassName } from '../player';
import { parseCalc, type CalcNode } from './calc';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;
const flag = (v: string | undefined): boolean => n(v) === 1;
const calc = (v: string | undefined): CalcNode | null => parseCalc(v);

// 출처: 원작 skills.txt charclass 코드
export const CLASS_CODE: Record<ClassName, string> = { Amazon: 'ama', Sorceress: 'sor', Necromancer: 'nec', Paladin: 'pal', Barbarian: 'bar' };

export interface SkillRecord {
  id: number;
  name: string;
  charclass: string;
  /** 표시 이름 (skilldesc str name → string.tbl) */
  displayName: string;
  /** 스킬 트리 탭(1~3)·행(1~6)·열(1~3), 아이콘 프레임 */
  page: number; row: number; column: number; iconCel: number;
  srvStFunc: number; srvDoFunc: number;
  srvMissile: string; srvMissileA: string; srvMissileB: string; srvMissileC: string;
  auraState: string; auraTargetState: string; auraFilter: number;
  auraLenCalc: CalcNode | null; auraRangeCalc: CalcNode | null;
  auraStats: { stat: string; calc: CalcNode | null }[];
  passiveState: string; passiveItype: string;
  passiveStats: { stat: string; calc: CalcNode | null }[];
  /** none | h2h | rng | both */
  range: string;
  itypeA: string[]; etypeA: string[]; itypeB: string[];
  weapSel: number;
  anim: string; seqTrans: string; seqNum: number;
  reqLevel: number; maxLvl: number; reqSkills: string[];
  leftSkill: boolean; inTown: boolean; passive: boolean; aura: boolean;
  targetableOnly: boolean; searchEnemyXY: boolean; searchEnemyNear: boolean; targetCorpse: boolean;
  attackNoMana: boolean; useAttackRate: boolean; durability: boolean; decQuant: boolean; lob: boolean;
  delay: CalcNode | null;
  minMana: number; manaShift: number; mana: number; lvlMana: number;
  calcs: (CalcNode | null)[];
  params: number[];
  toHit: number; levToHit: number; toHitCalc: CalcNode | null;
  resultFlags: number; hitFlags: number; hitClass: number; kick: boolean;
  hitShift: number; srcDam: number;
  minDam: number; minLevDam: number[]; maxDam: number; maxLevDam: number[]; dmgSymPerCalc: CalcNode | null;
  eType: string; eMin: number; eMinLev: number[]; eMax: number; eMaxLev: number[]; eDmgSymPerCalc: CalcNode | null;
  eLen: number; eLevLen: number[]; eLenSymPerCalc: CalcNode | null;
}

function parseSkill(r: TxtRow, desc: TxtRow | undefined, str: (k: string) => string): SkillRecord {
  const lev = (p: string) => [1, 2, 3, 4, 5].map((i) => n(r[`${p}${i}`]));
  return {
    id: n(r.Id), name: r.skill ?? '', charclass: r.charclass ?? '',
    displayName: desc?.['str name'] ? str(desc['str name']) : (r.skill ?? ''),
    page: n(desc?.SkillPage), row: n(desc?.SkillRow), column: n(desc?.SkillColumn), iconCel: n(desc?.IconCel),
    srvStFunc: n(r.srvstfunc), srvDoFunc: n(r.srvdofunc),
    srvMissile: r.srvmissile ?? '', srvMissileA: r.srvmissilea ?? '', srvMissileB: r.srvmissileb ?? '', srvMissileC: r.srvmissilec ?? '',
    auraState: r.aurastate ?? '', auraTargetState: r.auratargetstate ?? '', auraFilter: n(r.aurafilter),
    auraLenCalc: calc(r.auralencalc), auraRangeCalc: calc(r.aurarangecalc),
    auraStats: [1, 2, 3, 4, 5, 6].map((i) => ({ stat: r[`aurastat${i}`] ?? '', calc: calc(r[`aurastatcalc${i}`]) })).filter((s) => s.stat),
    passiveState: r.passivestate ?? '', passiveItype: r.passiveitype ?? '',
    passiveStats: [1, 2, 3, 4, 5].map((i) => ({ stat: r[`passivestat${i}`] ?? '', calc: calc(r[`passivecalc${i}`]) })).filter((s) => s.stat),
    range: r.range ?? 'none',
    itypeA: [r.itypea1, r.itypea2, r.itypea3].filter((x): x is string => !!x),
    etypeA: [r.etypea1, r.etypea2].filter((x): x is string => !!x),
    itypeB: [r.itypeb1, r.itypeb2, r.itypeb3].filter((x): x is string => !!x),
    weapSel: n(r.weapsel),
    anim: r.anim ?? '', seqTrans: r.seqtrans ?? '', seqNum: n(r.seqnum),
    reqLevel: n(r.reqlevel), maxLvl: n(r.maxlvl),
    reqSkills: [r.reqskill1, r.reqskill2, r.reqskill3].filter((x): x is string => !!x),
    leftSkill: flag(r.leftskill), inTown: flag(r.InTown), passive: flag(r.passive), aura: flag(r.aura),
    targetableOnly: flag(r.TargetableOnly), searchEnemyXY: flag(r.SearchEnemyXY), searchEnemyNear: flag(r.SearchEnemyNear), targetCorpse: flag(r.TargetCorpse),
    attackNoMana: flag(r.AttackNoMana), useAttackRate: flag(r.UseAttackRate), durability: flag(r.durability), decQuant: flag(r.decquant), lob: flag(r.lob),
    delay: calc(r.delay),
    minMana: n(r.minmana), manaShift: n(r.manashift), mana: n(r.mana), lvlMana: n(r.lvlmana),
    calcs: [calc(r.calc1), calc(r.calc2), calc(r.calc3), calc(r.calc4)],
    params: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => n(r[`Param${i}`])),
    toHit: n(r.ToHit), levToHit: n(r.LevToHit), toHitCalc: calc(r.ToHitCalc),
    resultFlags: n(r.ResultFlags), hitFlags: n(r.HitFlags), hitClass: n(r.HitClass), kick: flag(r.Kick),
    hitShift: n(r.HitShift), srcDam: n(r.SrcDam),
    minDam: n(r.MinDam), minLevDam: lev('MinLevDam'), maxDam: n(r.MaxDam), maxLevDam: lev('MaxLevDam'), dmgSymPerCalc: calc(r.DmgSymPerCalc),
    eType: r.EType ?? '', eMin: n(r.EMin), eMinLev: lev('EMinLev'), eMax: n(r.EMax), eMaxLev: lev('EMaxLev'), eDmgSymPerCalc: calc(r.EDmgSymPerCalc),
    eLen: n(r.ELen), eLevLen: [1, 2, 3].map((i) => n(r[`ELevLen${i}`])), eLenSymPerCalc: calc(r.ELenSymPerCalc),
  };
}

export class SkillDb {
  readonly byId = new Map<number, SkillRecord>();
  private readonly byName = new Map<string, SkillRecord>();

  constructor(skills: TxtRow[], skilldesc: TxtRow[], str: (key: string) => string = (k) => k) {
    const descs = new Map(skilldesc.map((d) => [d.skilldesc ?? '', d]));
    for (const r of skills) {
      if (!r.skill || r.Id === undefined || r.Id === '') continue;
      const rec = parseSkill(r, descs.get(r.skilldesc ?? ''), str);
      this.byId.set(rec.id, rec);
      if (!this.byName.has(rec.name.toLowerCase())) this.byName.set(rec.name.toLowerCase(), rec);
    }
  }

  get(id: number): SkillRecord {
    const s = this.byId.get(id);
    if (!s) throw new Error(`unknown skill ${id}`);
    return s;
  }

  /** skills.txt 'skill' 컬럼 이름 (대소문자 무시) */
  byNameOf(name: string): SkillRecord | undefined {
    return this.byName.get(name.toLowerCase());
  }

  /** 클래스 스킬 30개 (트리 탭·행·열 순) */
  classSkills(cls: ClassName): SkillRecord[] {
    const code = CLASS_CODE[cls];
    return [...this.byId.values()].filter((s) => s.charclass === code).sort((a, b) => a.page - b.page || a.row - b.row || a.column - b.column);
  }
}
