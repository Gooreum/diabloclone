// 난이도 규칙 (Normal / Nightmare / Hell): DifficultyLevels.txt 한 행을 엔진 값으로.
// 출처: DifficultyLevels.txt (행 0 Normal, 1 Nightmare, 2 Hell), D2MOO D2Common DATATBLS_GetDifficultyLevelsTxtRecord (D2DifficultyLevelsTxt)
// Phase 8: 표 칸 이름 (N)/(H), 클래식 플레이어 저항 페널티, 난이도 칭호, 난이도 해금 규칙.
import type { TxtRow } from '../formats/txt';

export type Difficulty = 0 | 1 | 2;

export const DIFFICULTY_NAMES = ['Normal', 'Nightmare', 'Hell'] as const;

export interface DifficultyRules {
  difficulty: Difficulty;
  /** DifficultyLevels.txt ResistPenalty (Normal 0 / Nightmare −40 / Hell −100) — 원작은 확장팩 게임에서만 이 칸을 쓴다 */
  resistPenalty: number;
  /**
   * 클래식 게임의 플레이어 원소 저항 페널티 (Normal 0 / Nightmare −20 / Hell −50) — 실제로 적용하는 값.
   * 출처: D2MOO SUnitDmg.cpp (저항 계산): bExpansion 이면 DifficultyLevels ResistPenalty, 아니면 Nightmare −20 · Hell −50 고정
   */
  playerResistPenalty: number;
  /** 사망 경험치 페널티 % (Normal 0 / Nightmare 5 / Hell 10). 출처: PLAYER_ApplyDeathPenalty */
  deathExpPenalty: number;
  /** 몬스터 스킬 레벨 보너스 (Normal 0 / Nightmare 3 / Hell 7) */
  monsterSkillBonus: number;
  /** 몬스터 빙결·냉기 지속 나눗수 */
  monsterFreezeDivisor: number;
  monsterColdDivisor: number;
  /** 몬스터가 거는 저주 지속 나눗수 */
  aiCurseDivisor: number;
  /** 생명·마나 흡수 나눗수 */
  lifeStealDivisor: number;
  manaStealDivisor: number;
  /** 유니크·챔피언 피해 보너스 % */
  uniqueDamageBonus: number;
  championDamageBonus: number;
  /** 용병이 보스에게 주는 피해 % */
  hireableBossDamagePercent: number;
  /** 몬스터 시체 폭발 피해 % */
  monsterCEDamagePercent: number;
  /** Static Field 최소 남는 생명 % */
  staticFieldMin: number;
  /** 도박 확률 (1/100000 단위) */
  gambleRare: number;
  gambleSet: number;
  gambleUnique: number;
  gambleUber: number;
  gambleUltra: number;
  /** 원본 행 (Phase 8 이 새 칸을 읽을 때) */
  row: TxtRow | undefined;
}

// 행이 없을 때 쓰는 기본값 = DifficultyLevels.txt Normal 행 (출처: 원작 1.14d 표)
const NORMAL_DEFAULT = {
  ResistPenalty: 0, DeathExpPenalty: 0, MonsterSkillBonus: 0, MonsterFreezeDivisor: 1, MonsterColdDivisor: 1, AiCurseDivisor: 1,
  LifeStealDivisor: 1, ManaStealDivisor: 1, UniqueDamageBonus: 90, ChampionDamageBonus: 90, HireableBossDamagePercent: 50,
  MonsterCEDamagePercent: 50, StaticFieldMin: 0, GambleRare: 10000, GambleSet: 100, GambleUnique: 50, GambleUber: 90, GambleUltra: 33,
} as const;

/** 행 값 (빈 칸·없는 칸은 Normal 기본값). nonZero 면 0 도 기본값으로 (나눗수·% — 기존 `Number(x ?? d) || d` 동작) */
function num(row: TxtRow | undefined, key: keyof typeof NORMAL_DEFAULT, nonZero = false): number {
  const def = NORMAL_DEFAULT[key];
  const v = row?.[key];
  const n = v === undefined || v === '' ? def : Number(v);
  if (!Number.isFinite(n)) return def;
  return nonZero ? n || def : n;
}

/**
 * 난이도 규칙. rows = DifficultyLevels.txt 전체 (GameData.difficultyRows), 이름(Name) 대신 행 순서로 고른다
 * (원작 DATATBLS_GetDifficultyLevelsTxtRecord(nDifficulty) 도 행 번호).
 */
export function difficultyRules(rows: readonly TxtRow[] | undefined, difficulty: Difficulty = 0): DifficultyRules {
  const row = rows?.[difficulty];
  return {
    difficulty,
    resistPenalty: num(row, 'ResistPenalty'),
    playerResistPenalty: CLASSIC_RESIST_PENALTY[difficulty],
    deathExpPenalty: num(row, 'DeathExpPenalty'),
    monsterSkillBonus: num(row, 'MonsterSkillBonus'),
    monsterFreezeDivisor: num(row, 'MonsterFreezeDivisor', true),
    monsterColdDivisor: num(row, 'MonsterColdDivisor', true),
    aiCurseDivisor: num(row, 'AiCurseDivisor', true),
    lifeStealDivisor: num(row, 'LifeStealDivisor', true),
    manaStealDivisor: num(row, 'ManaStealDivisor', true),
    uniqueDamageBonus: num(row, 'UniqueDamageBonus', true),
    championDamageBonus: num(row, 'ChampionDamageBonus', true),
    hireableBossDamagePercent: num(row, 'HireableBossDamagePercent', true),
    monsterCEDamagePercent: num(row, 'MonsterCEDamagePercent', true),
    staticFieldMin: num(row, 'StaticFieldMin'),
    gambleRare: num(row, 'GambleRare'),
    gambleSet: num(row, 'GambleSet'),
    gambleUnique: num(row, 'GambleUnique'),
    gambleUber: num(row, 'GambleUber'),
    gambleUltra: num(row, 'GambleUltra'),
    row,
  };
}

/** 출처: SUnitDmg.cpp — 클래식 저항 페널티 (표가 아닌 코드 상수) */
export const CLASSIC_RESIST_PENALTY = [0, -20, -50] as const;

/** 표 칸 이름의 난이도 판: Nightmare "(N)", Hell "(H)" (monstats Level(N), levels MonDen(H), MonLvl HP(N), SuperUniques TC(N) …) */
export function diffColumn(col: string, difficulty: Difficulty): string {
  return difficulty === 0 ? col : `${col}(${difficulty === 1 ? 'N' : 'H'})`;
}

/**
 * 플레이어 원소 저항 (피해 계산에 쓰는 값): 장비·상태 합 + 클래식 난이도 페널티, 양수면 상한(75 + max저항, 최대 95), 아래로 −100.
 * 출처: SUnitDmg.cpp 저항 계산 — 페널티를 더한 뒤 nResValue > 0 이면 clamp(−100, 최대), 아니면 max(−100)
 */
export function applyResistPenalty(raw: number, cap: number, penalty: number): number {
  const v = raw + penalty;
  return v > 0 ? Math.min(v, cap) : Math.max(v, -100);
}

/**
 * 클래식 칭호 (캐릭터 선택·게임 안 이름 앞). progression = 원작 .d2s 진행 값 (클래식: 막 하나를 끝낼 때마다 +1, 4·8·12 에서 칭호).
 * 출처: The Arreat Summit — Character Titles (클래식 소프트코어: Sir/Dame → Lord/Lady → Baron/Baroness,
 *       하드코어: Count/Countess → Duke/Duchess → King/Queen)
 * 근사(원작 미확인): 진행 값 대신 난이도 해금 단계만 있으면 (해금 난이도 × 4) 로 본다
 */
export function heroTitle(female: boolean, progression: number, hardcore = false): string {
  const tier = Math.min(3, Math.trunc(progression / 4));
  if (tier <= 0) return '';
  const male = hardcore ? ['Count', 'Duke', 'King'] : ['Sir', 'Lord', 'Baron'];
  const fem = hardcore ? ['Countess', 'Duchess', 'Queen'] : ['Dame', 'Lady', 'Baroness'];
  return (female ? fem : male)[tier - 1] as string;
}

/** 저장 값 → 난이도 (범위 밖은 Normal) */
export function toDifficulty(v: unknown): Difficulty {
  return v === 1 || v === 2 ? v : 0;
}
