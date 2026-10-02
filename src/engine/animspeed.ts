// 플레이어 애니메이션 속도 (공격·시전·그 밖). 원작 공식 그대로.
// 출처: D2MOO D2Common/src/Units/Units.cpp — UNITS_UpdateAnimRateAndVelocity (모드별 분기), UNITS_UpdateAttackAnimRateAndVelocity,
//       UNITS_UpdateCastAnimRateAndVelocity, UNITS_UpdateOtherAnimRateAndVelocity, gaPlayerModesAnimModulators, UNITS_GetFrameBonus;
//       D2Skills.cpp D2Common_11043 (변신 기본 속도), Items.cpp ITEMS_GetWeaponAttackSpeed; PlayerStats.cpp (STAT_ATTACKRATE·STAT_OTHER_ANIMRATE 기본 100)
// 애니 속도는 1/256 프레임 단위: 게임 프레임마다 그만큼 진행하고, (프레임 수 × 256) 에 닿으면 끝난다.

/** 실효 보너스: 120·v / (120 + v) (내림). IAS·FCR·FHR·FBR 공통 */
export const effectiveBonus = (v: number): number => (v ? Math.trunc((120 * v) / (v + 120)) : 0);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface AttackRateInput {
  /** 장비 전체의 item_fasterattackrate 합 (실효 변환 전) */
  gearIas: number;
  /** 스킬·오라·상태의 attackrate 합 (늑대인간·광신·프렌지·버스트 오브 스피드 +, 냉기·디크레피파이 −) */
  stateAttackRate: number;
  /** 오른손 무기 WSM (weapons.txt speed, 음수 = 빠름). 맨손 0 */
  wsm: number;
  /** 두 손에 무기를 들었을 때(바바리안·어쌔신) 왼손 WSM — 두 무기 평균을 쓴다 */
  wsmLeft?: number;
  /** 시퀀스(SQ) 동작이면 −30 */
  sequence?: boolean;
  /** 그 밖에 더하는 값 (Dragon Tail par4) */
  extra?: number;
}

/**
 * 공격 rate (%): EIAS + STAT_ATTACKRATE(기본 100 + 상태 − WSM), 양손이면 (R + L)/2 − R 보정, 시퀀스 −30, 15..175.
 * 출처: UNITS_UpdateAttackAnimRateAndVelocity (무기 STAT_ATTACKRATE = −ItemsTxt.speed — Items.cpp:5388)
 */
export function attackRate(o: AttackRateInput): number {
  const r = -o.wsm;
  let rate = effectiveBonus(o.gearIas) + 100 + o.stateAttackRate + r + (o.extra ?? 0);
  if (o.wsmLeft !== undefined) rate += Math.trunc((r - o.wsmLeft) / 2) - r;
  if (o.sequence) rate -= 30;
  return clamp(rate, 15, 175);
}

/** 시전 rate (%): min(100 + EFCR, 175). 출처: UNITS_UpdateCastAnimRateAndVelocity */
export const castRate = (fcr: number): number => Math.min(100 + effectiveBonus(fcr), 175);

/** 그 밖의 동작 rate (%): STAT_OTHER_ANIMRATE(기본 100 + 상태) 를 15..175 로. 출처: UNITS_UpdateOtherAnimRateAndVelocity */
export const otherRate = (stateOtherAnimRate: number): number => clamp(100 + stateOtherAnimRate, 15, 175);

/**
 * 변신(늑대·곰) 중 공격의 기본 애니 속도 = (변신 몬스터의 서 있는 동작 프레임 수 × 256) / 무기 공격 속도.
 * 무기 공격 속도 = (사람 모습 A1 프레임 수 × 256) / [사람 A1 애니 속도 × (100 − WSM + 무기에 붙은 IAS) / 100] — 무기가 없으면 19.
 * 출처: D2Common_11043 ((dwFrameCountPrecise & ~0xFF) / ITEMS_GetWeaponAttackSpeed), ITEMS_GetWeaponAttackSpeed.
 * 근사(원작 미확인): dwFrameCountPrecise 는 속도를 다시 계산하는 순간의 프레임 수 — 널리 검증된 변신 계산기와 같이 서 있는 동작(늑대 9 · 곰 10)의 것으로 본다
 */
export function wereformBaseSpeed(neutralFrames: number, human: { frames: number; speed: number } | undefined, weapon: { wsm: number; ias: number } | null): number {
  let attackSpeed = 19;
  if (weapon) {
    if (!human) attackSpeed = 45;
    else {
      const den = Math.trunc((human.speed * (100 - weapon.wsm + weapon.ias)) / 100);
      attackSpeed = den > 0 ? Math.trunc((human.frames * 256) / den) : 0;
    }
    if (attackSpeed <= 0) return 0;
  }
  return Math.trunc((neutralFrames * 256) / attackSpeed);
}

/** 애니 속도 = rate × 기본 속도 / 100 (내림, 0..32767) */
export const animSpeedOf = (rate: number, baseSpeed: number): number => clamp(Math.trunc((rate * baseSpeed) / 100), 0, 0x7fff);

/**
 * 공격 시작 프레임 (아마존·소서리스만): 맨손 1, 한손·양손 휘두르기·찌르기·지팡이 2 — 그만큼 동작이 짧다. A1·A2 에만.
 * 출처: UNITS_GetFrameBonus gaClassesWeaponFrameBonus (무기 클래스 × 직업)
 */
export function attackStartFrame(cls: string, mode: string, wclass: string): number {
  if ((cls !== 'Amazon' && cls !== 'Sorceress') || (mode !== 'A1' && mode !== 'A2')) return 0;
  const w = wclass.toUpperCase();
  if (w === 'HTH') return 1;
  return ['1HS', '1HT', 'STF', '2HS', '2HT'].includes(w) ? 2 : 0;
}

/** 동작 길이(게임 프레임)와 판정 프레임까지의 시간: 올림(남은 프레임 × 256 / 애니 속도), 길이는 − 1 */
export function animTiming(frames: number, actionFrame: number, animSpeed: number, startFrame = 0): { duration: number; hitTick: number } {
  if (animSpeed <= 0) return { duration: Math.max(1, frames - startFrame), hitTick: Math.max(0, actionFrame - startFrame) };
  const left = Math.max(1, frames - startFrame);
  return {
    duration: Math.max(1, Math.ceil((left * 256) / animSpeed) - 1),
    hitTick: actionFrame < 0 ? -1 : Math.ceil((Math.max(0, actionFrame - startFrame) * 256) / animSpeed),
  };
}
