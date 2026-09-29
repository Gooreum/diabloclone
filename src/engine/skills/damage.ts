// 피해 묶음 (원작 D2DamageStrc) — 모든 피해는 1/256 단위, 지속시간은 프레임.
// 출처: D2MOO source/D2Game/src/SKILLS/Skills.cpp sub_6FD11E40 (원소 종류 → 피해 칸·타격 등급),
//       source/D2Game/src/UNIT/SUnitDmg.cpp SUNITDMG_CalculateTotalDamage / SUNITDMG_ApplyResistancesAndAbsorb
//       (저항 적용: 방어자가 몬스터면 상한 없음, 100 초과는 100, -100 미만은 -100, 값 × (100 − 저항) / 100)

export interface DamagePacket {
  phys: number; fire: number; ltng: number; cold: number; pois: number; mag: number;
  coldLen: number; freezeLen: number; poisLen: number; stunLen: number;
  /** HitClass.txt 행 번호 (피격 경직 판정) */
  hitClass: number;
  crit: boolean;
}

export const emptyDamage = (): DamagePacket => ({
  phys: 0, fire: 0, ltng: 0, cold: 0, pois: 0, mag: 0, coldLen: 0, freezeLen: 0, poisLen: 0, stunLen: 0, hitClass: 0, crit: false,
});

/** skills.txt/missiles.txt EType 코드 → 피해 칸. 출처: sub_6FD11E40 */
export function addElemental(d: DamagePacket, eType: string, amount256: number, length: number): void {
  switch (eType) {
    case 'fire': d.hitClass = 0x20; d.fire += amount256; break;
    case 'ltng': d.hitClass = 0x40; d.ltng += amount256; break;
    case 'mag': d.mag += amount256; break;
    case 'cold': d.coldLen = length; d.cold += amount256; d.hitClass = 0x30; break;
    case 'pois': d.poisLen = length; d.pois += amount256; d.hitClass = 0x50; break;
    case 'stun': d.hitClass = 0x60; d.stunLen += length + amount256; break;
    case 'frze': d.freezeLen = length; d.cold += amount256; d.hitClass = 0x30; break;
    case '': break;
    default: d.phys += amount256;
  }
}

export interface Resists { dm: number; fi: number; li: number; co: number; ma: number; po: number }

const applyRes = (v: number, res: number): number => {
  if (v <= 0) return 0;
  const r = Math.max(-100, Math.min(res, 100));
  return r ? Math.trunc((v * (100 - r)) / 100) : v;
};

/** 몬스터 방어자 저항 적용 (몬스터는 저항 상한 75 가 없다) */
export function applyMonsterResists(d: DamagePacket, r: Resists): DamagePacket {
  return {
    ...d,
    phys: applyRes(d.phys, r.dm),
    fire: applyRes(d.fire, r.fi),
    ltng: applyRes(d.ltng, r.li),
    cold: applyRes(d.cold, r.co),
    mag: applyRes(d.mag, r.ma),
    coldLen: applyRes(d.coldLen, r.co),
    freezeLen: applyRes(d.freezeLen, r.co),
    pois: applyRes(d.pois, r.po),
  };
}

/** 즉시 피해 합 (1/256). 출처: CalculateTotalDamage dwDmgTotal = 물리+화염+번개+마법+냉기+독 */
export const totalDamage = (d: DamagePacket): number => d.phys + d.fire + d.ltng + d.mag + d.cold + d.pois;
