// 난이도 규칙 (Normal / Nightmare / Hell): DifficultyLevels.txt 한 행을 엔진 값으로.
// 출처: DifficultyLevels.txt (행 0 Normal, 1 Nightmare, 2 Hell), D2MOO D2Common DATATBLS_GetDifficultyLevelsTxtRecord (D2DifficultyLevelsTxt)
// 이 파일은 Phase 1 에서 뼈대만 만들고, 몬스터 (N)/(H) 수치·TC 업그레이드 등은 Phase 8 에서 넓힌다.
import type { TxtRow } from '../formats/txt';

export type Difficulty = 0 | 1 | 2;

export const DIFFICULTY_NAMES = ['Normal', 'Nightmare', 'Hell'] as const;

export interface DifficultyRules {
  difficulty: Difficulty;
  /** 플레이어 저항 페널티 (Normal 0 / Nightmare −40 / Hell −100). 출처: STATLIST 저항 계산 (Phase 8 에서 적용) */
  resistPenalty: number;
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

/** 저장 값 → 난이도 (범위 밖은 Normal) */
export function toDifficulty(v: unknown): Difficulty {
  return v === 1 || v === 2 ? v : 0;
}
