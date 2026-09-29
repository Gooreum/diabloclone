// 미사일 정의 (missiles.txt 원본).
// 출처: Phrozen Keep — Missiles.txt File Guide (https://d2mods.info/forum/kb/viewarticle?a=440)
//       Vel = 프레임당 이동량(픽셀), Range = 수명(프레임), Size = 충돌 크기(서브타일), CollideKill = 충돌 시 소멸,
//       Explosion = 폭발 미사일(대상 없이 범위), SrcDamage = 무기 피해 반영 비율(128 = 100%, -1 = 없음)
// 출처: D2MOO D2Game/src/MISSILES/MissMode.cpp — pSrvHitFunc / pSrvDmgFunc 번호별 함수 (SrvHit04 ExplodingArrow, SrvDmg01 원소 변환 …)
import type { TxtRow } from '../formats/txt';
import { parseCalc, type CalcNode } from './skills/calc';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export interface MissileDef {
  id: number;
  name: string;
  vel: number; velLev: number; maxVel: number; accel: number;
  range: number; levRange: number;
  size: number;
  celFile: string; numDirections: number; animLen: number;
  collideType: number; collideKill: boolean; explosion: boolean; alwaysExplode: boolean;
  toHit: boolean; pierce: boolean; knockBack: boolean;
  nextHit: boolean; nextDelay: number;
  /** 지속 피해 속도 (0 이 아니면 닿아 있는 동안 매 프레임 피해 — Inferno 82, Fire Wall 41) */
  damageRate: number;
  /** 무기 피해 반영 비율 (128 = 100%, -1 = 무기 피해 없음) */
  srcDamage: number;
  skill: string; missileSkill: boolean;
  srvDoFunc: number; srvHitFunc: number; srvDmgFunc: number;
  params: number[]; hitParams: number[]; dmgCalc: CalcNode | null; dmgParams: number[];
  hitShift: number; hitClass: number;
  minDamage: number; maxDamage: number;
  /** 레벨 구간별 물리 증가 (MinLevDam1~5, MaxLevDam1~5) */
  minDamLev: number[]; maxDamLev: number[];
  eType: string; eMin: number; eMax: number; eLen: number;
  /** 미사일 레벨 구간별 원소 증가 (MinELev1~5, MaxELev1~5), 지속 증가 (ELevLen1~3) */
  eMinLev: number[]; eMaxLev: number[]; eLevLen: number[];
  explosionMissile: string; subMissile1: string; hitSubMissile1: string;
  /** 기존 몬스터 미사일 코드 호환 (= vel, srcDamage) */
  srcDamagePct: number;
}

export function parseMissiles(rows: TxtRow[]): Map<string, MissileDef> {
  const out = new Map<string, MissileDef>();
  for (const r of rows) {
    if (!r.Missile) continue;
    const src = r.SrcDamage === '-1' ? -1 : n(r.SrcDamage);
    out.set(r.Missile, {
      id: n(r.Id), name: r.Missile,
      vel: n(r.Vel), velLev: n(r.VelLev), maxVel: n(r.MaxVel), accel: n(r.Accel),
      range: n(r.Range), levRange: n(r.LevRange), size: n(r.Size) || 1,
      celFile: r.CelFile ?? '', numDirections: n(r.NumDirections) || 1, animLen: n(r.AnimLen) || 1,
      collideType: n(r.CollideType), collideKill: n(r.CollideKill) === 1, explosion: n(r.Explosion) === 1, alwaysExplode: n(r.AlwaysExplode) === 1,
      toHit: n(r.ToHit) === 1, pierce: n(r.Pierce) === 1, knockBack: n(r.KnockBack) === 1,
      nextHit: n(r.NextHit) === 1, nextDelay: n(r.NextDelay), damageRate: n(r.DamageRate),
      srcDamage: src, skill: r.Skill ?? '', missileSkill: n(r.MissileSkill) === 1,
      srvDoFunc: n(r.pSrvDoFunc), srvHitFunc: n(r.pSrvHitFunc), srvDmgFunc: n(r.pSrvDmgFunc),
      params: [1, 2, 3, 4, 5].map((i) => n(r[`Param${i}`])),
      hitParams: [1, 2, 3].map((i) => n(r[`sHitPar${i}`])),
      dmgCalc: parseCalc(r.DmgCalc1), dmgParams: [n(r.dParam1), n(r.dParam2)],
      hitShift: n(r.HitShift), hitClass: n(r.HitClass),
      minDamage: n(r.MinDamage), maxDamage: n(r.MaxDamage),
      minDamLev: [1, 2, 3, 4, 5].map((i) => n(r[`MinLevDam${i}`])), maxDamLev: [1, 2, 3, 4, 5].map((i) => n(r[`MaxLevDam${i}`])),
      eType: r.EType ?? '', eMin: n(r.EMin), eMax: n(r.Emax), eLen: n(r.ELen),
      eMinLev: [1, 2, 3, 4, 5].map((i) => n(r[`MinELev${i}`])), eMaxLev: [1, 2, 3, 4, 5].map((i) => n(r[`MaxELev${i}`])), eLevLen: [1, 2, 3].map((i) => n(r[`ELevLen${i}`])),
      explosionMissile: r.ExplosionMissile ?? '', subMissile1: r.SubMissile1 ?? '', hitSubMissile1: r.HitSubMissile1 ?? '',
      srcDamagePct: src < 0 ? 0 : src,
    });
  }
  return out;
}

/** 미사일 공식 (DmgCalc1 등, misscalc.txt 이름). 출처: 원작 misscalc.txt — dl12 = dpa1 + (lvl-1) × dpa2, sl12, lvl … */
export function missileParam(m: MissileDef, name: string, lvl: number): number {
  const p = m.params, d = m.dmgParams;
  switch (name) {
    case 'lvl': return lvl;
    case 'par1': case 'par2': case 'par3': case 'par4': case 'par5': return p[Number(name.slice(3)) - 1] ?? 0;
    case 'dpa1': return d[0] ?? 0;
    case 'dpa2': return d[1] ?? 0;
    case 'dl12': return (d[0] ?? 0) + (lvl - 1) * (d[1] ?? 0);
    case 'sl12': return (p[0] ?? 0) + (lvl - 1) * (p[1] ?? 0);
    case 'sl34': return (p[2] ?? 0) + (lvl - 1) * (p[3] ?? 0);
    case 'hpa1': return m.hitParams[0] ?? 0;
    case 'hpa2': return m.hitParams[1] ?? 0;
    case 'hpa3': return m.hitParams[2] ?? 0;
    default: return 0;
  }
}
