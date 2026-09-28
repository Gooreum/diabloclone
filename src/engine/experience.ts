// 몬스터 처치 경험치의 레벨 차이 보정 (싱글플레이, 파티 보너스 없음).
// 출처: Maxroll — Experience Mechanics (https://maxroll.gg/d2/resources/experience) — D2R 2.4(1.14d 기반) 문서
//   Tier 1 (cLVL < 25): mLVL-cLVL 차이별 x/256 표
//   Tier 2 (cLVL 25~69): 낮은 몬스터는 같은 표, 높은 몬스터는 경험치 × cLVL / mLVL
//   cLVL 70+ 는 experience.txt ExpRatio/1024 추가 배율

// 출처: Maxroll Tier 1 표 — 몬스터가 높을 때 +6..+9, 초과 시 5
const HIGHER = [225, 174, 92, 38]; // +6, +7, +8, +9
// 출처: Maxroll Tier 1/2 표 — 몬스터가 낮을 때 -6..-9, 미만 시 13
const LOWER = [207, 159, 110, 61]; // -6, -7, -8, -9

export function levelDiffFactor256(clvl: number, mlvl: number): number {
  const diff = mlvl - clvl;
  if (diff >= -5 && diff <= 5) return 256;
  if (diff < -9) return 13;
  if (diff < -5) return LOWER[-diff - 6] ?? 13;
  // 몬스터가 더 높음
  if (clvl >= 25) return -1; // Tier 2+: cLVL/mLVL 배율 사용
  if (diff > 9) return 5;
  return HIGHER[diff - 6] ?? 5;
}

/** 최종 획득 경험치 (정수 내림). expRatio = experience.txt 해당 레벨 ExpRatio (기본 1024) */
export function adjustedExperience(baseExp: number, clvl: number, mlvl: number, expRatio = 1024): number {
  const f = levelDiffFactor256(clvl, mlvl);
  let exp = f < 0 ? (baseExp * clvl) / mlvl : (baseExp * f) / 256;
  exp = (exp * expRatio) / 1024;
  return Math.floor(exp);
}
