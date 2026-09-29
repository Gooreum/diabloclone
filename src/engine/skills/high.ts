// 24·30 레벨 스킬의 순수 계산 (좌표 표·개수·흡수 공식). 게임 상태 없이 원작 함수의 수치 부분만 옮긴다.
// 출처: D2MOO source/D2Game/src/MISSILES/MissMode.cpp, source/D2Game/src/SKILLS/Skill{Ama,Sor,Nec,Pal,Bar}.cpp

/**
 * 64방향 좌표 표 (반지름 30). Frozen Orb 가 매 프레임 볼트를 뿌리는 방향 · 끝에서 터지는 노바 방향.
 * 출처: D2MOO MISSMODE_SrvDo15_FrozenOrb xPositions/yPositions, MISSMODE_SrvHit29_FrozenOrb xOffsets/yOffsets
 */
export const ORB_X = [
  30, 29, 29, 28, 27, 26, 24, 23, 21, 19, 16, 14, 11, 8, 5, 2, 0, -2, -5, -8, -11, -14, -16, -19, -21, -23, -24, -26, -27, -28, -29, -29,
  -30, -29, -29, -28, -27, -26, -24, -23, -21, -19, -16, -14, -11, -8, -5, -2, 0, 2, 5, 8, 11, 14, 16, 19, 21, 23, 24, 26, 27, 28, 29, 29,
] as const;
export const ORB_Y = [
  0, 2, 5, 8, 11, 14, 16, 19, 21, 23, 24, 26, 27, 28, 29, 29, 30, 29, 29, 28, 27, 26, 24, 23, 21, 19, 16, 14, 11, 8, 5, 2,
  0, -2, -5, -8, -11, -14, -16, -19, -21, -23, -24, -26, -27, -28, -29, -29, -30, -29, -29, -28, -27, -26, -24, -23, -21, -19, -16, -14, -11, -8, -5, -2,
] as const;

/** Frozen Orb 볼트 방향 순서: 시작 0, 발사마다 + Param2 (mod 64). 출처: MISSMODE_SrvDo15_FrozenOrb (MISSILE_SetTargetX((nIndex + Param2) % 64)) */
export const orbNextIndex = (index: number, step: number): number => (index + step) % 64;

/** Frozen Orb 노바: 64방향 중 sHitPar1 간격 (4 → 16발). 출처: MISSMODE_SrvHit29_FrozenOrb */
export function orbNovaIndices(step: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 64; i += Math.max(step, 1)) out.push(i);
  return out;
}

/** Meteor 불길 18개 위치 (sHitPar2 간격). 출처: MISSMODE_CreateMeteor_MoltenBoulderSubmissiles xOffsets/yOffsets */
export const METEOR_FIRE_X = [2, -2, 0, 0, -3, 0, 3, -1, 1, -1, 2, -4, -3, -1, 0, 1, 3, 4] as const;
export const METEOR_FIRE_Y = [-2, -2, 2, 5, 3, 3, 3, 2, 1, -1, -1, -2, -2, -3, -4, -3, -3, -2] as const;

/** Bone Prison 뼈벽 12개 위치 (대상 기준). 출처: SKILLS_SrvDo062_BonePrison xOffsets/yOffsets */
export const BONE_PRISON_X = [-1, 1, 3, 4, 4, 3, -1, 1, -3, -4, -4, -3] as const;
export const BONE_PRISON_Y = [-4, -4, -3, -1, 1, 3, 4, 4, 3, -1, 1, -3] as const;

/** Hydra 3마리 위치 (hydra1~3). 출처: SKILLS_SrvDo144_Hydra nXOffsets/nYOffsets */
export const HYDRA_X = [-1, 0, 1] as const;
export const HYDRA_Y = [-1, 0, -1] as const;

/**
 * Immolation Arrow 불길 원판: 반지름 r 안의 정수 격자 (x² + y² ≤ r²).
 * 출처: MISSMODE_CreateImmolationArrowHitSubmissiles
 */
export function discOffsets(r: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) if (x * x + y * y <= r * r) out.push({ x, y });
  return out;
}

/**
 * Strafe 발사 수: 최소 calc3, 최대 calc1, 그 사이면 반경 안 대상 수.
 * 출처: SKILLS_SrvSt08_Strafe — v12 = min(calc3, calc1); v12 = max(v12, 대상 수); v11 = min(v12, calc1)
 */
export function strafeShots(calc1: number, calc3: number, targets: number): number {
  let lo = Math.min(calc3, calc1);
  if (targets > lo) lo = targets;
  return Math.min(lo, calc1);
}

/**
 * Energy Shield 흡수 (피해·마나 모두 1/256 단위). 피해 칸마다 pct % 를 흡수, 마나 소모 = 흡수 × ratio / 16.
 * 출처: SKILLS_EventFunc24_EnergyShield — nAbsorb = 피해 × calc1 / 100 (최대 마나 × 16 / calc2), 마나 −= nAbsorb × calc2 / 16
 */
export function energyShieldAbsorb(damages: number[], mana: number, pct: number, ratio: number): { left: number[]; mana: number; absorbed: number } {
  const div = ratio > 0 ? ratio : 1;
  let m = mana, absorbed = 0;
  const left = damages.map((v) => {
    if (v <= 0 || pct <= 0) return v;
    let a = Math.trunc((v * pct) / 100);
    const max = Math.trunc((m * 16) / div);
    if (a >= max) a = max;
    m -= Math.trunc((a * div) / 16);
    if (m <= 0) m = 0;
    absorbed += a;
    return v - a;
  });
  return { left, mana: m, absorbed };
}

/**
 * Thunder Storm 번개 주기 (perdelay = (100 − dm56) × par4 / 100 + par3). 최소 5프레임.
 * 출처: skills.txt Thunder Storm perdelay, D2MOO SKILL_ComputePeriodicRate (최소 5)
 */
export const periodicRate = (perdelay: number): number => Math.max(5, perdelay);

/** Frenzy 누적 단계: 명중할 때마다 +1, 스킬 레벨까지. 출처: SKILLS_ApplyFrenzyStats (STAT_SKILL_FRENZY) */
export const frenzyStack = (cur: number, skillLevel: number): number => Math.min(cur + 1, skillLevel);
