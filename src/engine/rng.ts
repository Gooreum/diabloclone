// Diablo II 시드 RNG: 64비트 LCG 를 32비트 low/high 두 워드로 보관.
//   state64 = low * 0x6AC690C5 + high;  low = state & 0xFFFFFFFF;  high = state >> 32
// 출처: jaenster/libd2 — packages/core/src/rng.zig (1.14d 재구성 소스: D2_SEED_NEXT, RANDOM_RandomNumberSelector,
//       SEED_RollRange) (https://github.com/jaenster/libd2)
// 출처: eezstreet/OpenD2 — Shared/D2Shared.cpp D2SEED_MAGIC 0x6AC690C5 (https://github.com/eezstreet/OpenD2)

const MUL = 0x6ac690c5n;
const MASK = 0xffffffffn;

export class Rng {
  low: number;
  high: number;

  /** 출처: libd2 Seed.fromValue — 단일 값 초기화는 high = 666 */
  constructor(low: number, high = 666) {
    this.low = low >>> 0;
    this.high = high >>> 0;
  }

  /** D2_SEED_NEXT: 한 단계 진행, 64비트 상태 반환 */
  next(): bigint {
    const state = BigInt(this.low) * MUL + BigInt(this.high);
    this.low = Number(state & MASK);
    this.high = Number((state >> 32n) & MASK);
    return state & 0xffffffffffffffffn;
  }

  /**
   * SEED_RollRandomNumber 의 하위 32비트 (원작 코드의 `SEED_RollRandomNumber(&seed) & 3`, `(unsigned)... % 100` 등)
   * 출처: D2MOO D2Seed.h SEED_RollRandomNumber (lSeed = high + 0x6AC690C5 × low, 반환 = lSeed)
   */
  roll(): number {
    this.next();
    return this.low;
  }

  /** RANDOM_RandomNumberSelector: [0, modulo). 2의 거듭제곱이면 마스크, 아니면 새 low % modulo. modulo<1 이면 0 */
  pick(modulo: number): number {
    if ((modulo | 0) < 1) return 0;
    this.next();
    return (modulo & (modulo - 1)) !== 0 ? this.low % modulo : this.low & (modulo - 1);
  }

  /** RollBetweenMinAndMax: min + pick(max) (아이템 롤에 사용) */
  rollBetween(min: number, max: number): number {
    return min + this.pick(max);
  }

  /** SEED_RollRange: [min, max). 2의 거듭제곱이 아니면 64비트 전체 상태 % width (DRLG 에 사용) */
  rollRange(min: number, max: number): number {
    if (max <= min) return min;
    const width = max - min;
    const state = this.next();
    if ((width & (width - 1)) !== 0) return Number(state % BigInt(width)) + min;
    return (this.low & (width - 1)) + min;
  }

  state(): { low: number; high: number } {
    return { low: this.low, high: this.high };
  }
}

/** 항상 최댓값을 고르는 RNG (pick(n) = n − 1). 프리셋 아이템처럼 가변 옵션을 최대값으로 만들 때만 쓴다 — 게임 굴림에는 쓰지 않는다 */
export class MaxRng extends Rng {
  constructor() {
    super(1);
  }

  override pick(modulo: number): number {
    return (modulo | 0) < 1 ? 0 : (modulo | 0) - 1;
  }
}
