// 몬스터 유닛·AI 세계 인터페이스 (AI 함수는 이 인터페이스로만 게임에 요청한다).
import type { MonsterStats, MonsterType, MonSeqFrame } from '../monster';
import type { Pt } from '../geom';
import type { Rng } from '../rng';
import type { StateList } from '../states';
import type { NpcState } from './npc';

/** 원작 몬스터 모드 토큰 (MonMode.txt 순서: DT NU WL GH A1 A2 BL SC S1 S2 S3 S4 DD KB SQ RN) */
export type MonMode = 'DT' | 'NU' | 'WL' | 'GH' | 'A1' | 'A2' | 'BL' | 'SC' | 'S1' | 'S2' | 'S3' | 'S4' | 'DD' | 'KB' | 'SQ' | 'RN';

/** 출처: D2MOO MONMODE_* 번호 (AI 상태 dwAiState 는 마지막으로 벗어난 모드 번호, 피격 = 3 또는 19) */
export const MONMODE_INDEX: Record<MonMode, number> = { DT: 0, NU: 1, WL: 2, GH: 3, A1: 4, A2: 5, BL: 6, SC: 7, S1: 8, S2: 9, S3: 10, S4: 11, DD: 12, KB: 13, SQ: 14, RN: 15 };

/** 진행 중인 몬스터 스킬 (AITACTICS_UseSkill / UseSequenceSkill) */
export interface MonCast {
  /** monstats Skill 칸 (0~7), -1 = 수식어가 준 스킬 (MonTeleport) */
  slot: number;
  skill: string;
  lvl: number;
  targetId?: number;
  tx: number; ty: number;
  /** monseq.txt 시퀀스 (SQ 모드) */
  seq?: MonSeqFrame[];
  /** 판정 이벤트를 처리한 프레임 수 */
  fired: number;
  /** 판정 틱 (시작 기준, 모드 애니메이션 또는 시퀀스 이벤트) */
  events: number[];
}

export interface MonsterUnit {
  id: number;
  type: MonsterType;
  stats: MonsterStats;
  /** Conversion 으로 낮춘 레벨·최대 생명의 원래 값 (원작 STATE_CONVERSION_SAVE: STAT_CONVERSION_LEVEL / STAT_CONVERSION_MAXHP) */
  conversionSave?: { level: number; maxHp: number };
  x: number;
  y: number;
  hp: number;
  mode: MonMode;
  dir: number;
  path: Pt[];
  moveSpeed: number;
  /** 다음 AI 판단 프레임 */
  nextThink: number;
  modeStart: number;
  modeEnd: number;
  hitTick: number;
  hitDone: boolean;
  rng: Rng;
  /** 공격을 받았음 (예전 필드 — aiState 로 대체, 소환수 코드 호환) */
  aggro: boolean;
  /**
   * 원작 dwAiState: 마지막으로 벗어난 (중립이 아닌) 모드 번호. 피격 경직 없이 맞으면 19.
   * 출처: MonsterMode.cpp D2GAME_ModeChange (nNewAiState), SUnitDmg.cpp MONSTER_SetAiState(19), AiUtil.cpp sub_6FCF2E70 (3 또는 19 = 방금 맞음)
   */
  aiState: number;
  /** Fallen: 동료 사망으로 도주 중 (dwAiParam[0]) */
  aiParam0: number;
  /** 원작 dwAiParam[0..2] (AI 함수별 상태) */
  ai: [number, number, number];
  /** Fallen·Fallen Shaman 리더 명령 (AI command param 1) */
  command: number;
  /** 주인 (보스·파티 리더, AIGENERAL_SetOwnerData). 자기 자신이면 리더 */
  leaderId: number;
  deathFrame: number;
  /** 상태 (냉기·독·기절·빙결·공포·도발·함성 저주 …) */
  states: StateList;
  /** 시체에 Find Potion / Find Item 을 이미 사용함 (원작 STATE_CORPSE_NOSELECT) */
  corpseUsed: boolean;
  /** 플레이어 소환수면 소환 정보 (스켈레톤·골렘·뼈벽) */
  pet?: PetInfo;
  /** 이번 판단의 공격 대상 유닛 Id (undefined = 플레이어) */
  targetId?: number;
  /** MONTYPEFLAG (1 OTHER, 2 SUPERUNIQUE, 4 CHAMPION, 8 UNIQUE, 16 MINION) */
  flags: number;
  /** MonUMod 수식어 목록 (최대 9) */
  umods: number[];
  /** 유니크 이름 시드 (wNameSeed) */
  nameSeed: number;
  /** SuperUniques.txt 행 (슈퍼유니크) */
  superUnique?: number;
  /** 수식어·스킬이 준 스탯 (damagepercent, item_tohit_percent, velocitypercent, firemindam …) */
  bonus: Record<string, number>;
  /** 저항 (monstats + 수식어) */
  resist: { dm: number; ma: number; fi: number; li: number; co: number; po: number };
  /** HP 재생 (유니크는 없음 — UMod2 STAT_HPREGEN 0) */
  hpRegen: boolean;
  /** 수식어가 준 스킬 (MonTeleport, aura) */
  skillsAdded: string[];
  /** 경험치·드롭 없음 (부활·둥지 스폰: UNITFLAG_NOXP | NOTC) */
  noXp: boolean;
  noTc: boolean;
  /** 원위치 (AI 명령 10: Blood Raven·Countess) */
  home?: Pt;
  /** 레이어 외형 선택 (monstats2 변형 목록 순번, 레이어 이름 → 순번) */
  components?: Record<string, number>;
  /** 진행 중인 스킬 */
  cast?: MonCast;
  /** AI 가 다음 이동에 준 속도 % (AITACTICS_SetVelocity nVel → STAT_VELOCITYPERCENT) */
  velPct: number;
  /** 이 이동의 속도 % (이동 중 유지) */
  moveVelPct: number;
  /** 스폰 레벨 (몬스터 레벨 풀 계산) */
  levelKey?: string;
  /** 시체가 부활될 수 있음 (MonStats2 revive) — 부활 중 */
  resurrected?: boolean;
  /** 지도 경로 (DS1 프리셋 path: Countess 불벽 지점) */
  mapPath?: Pt[];
  /** 특수 AI 상태로 바뀐 AI (원작 AITHINK_ExecuteAiFn(…, AISPECIALSTATE_COUNTESS)) */
  aiOverride?: string;
  /** 시퀀스 진행 속도 (256 = 1 프레임/틱) */
  seqRate?: number;
  /** 유니크·보스가 대상을 알아챘다 (원작 AI 플래그 0x10) */
  noticed?: boolean;
  /** Lightning Enchanted 마지막 발동 프레임 (원작 dwDurielFlag) */
  lastBolt?: number;
  /** 마을 NPC·장식 유닛 (공격 불가, NPC AI) */
  npc?: NpcState;
}

export interface PetInfo {
  skillId: number;
  petType: string;
  /** 소멸 프레임 (뼈벽 등, Infinity = 죽을 때까지) */
  expires: number;
  /** 원거리 소환수(스켈레톤 메이지)의 미사일과 미사일 레벨 */
  missile?: string;
  missileLvl: number;
  /** 소환 스킬이 준 보너스 (출처: D2GAME_SetSummonPassiveStats) */
  damagePct: number;
  normalDamage: number;
  slowPct: number;
  /** 용병 (pettype hireable) */
  hireling?: boolean;
  /** 용병이 이번 공격(A1)에 쓸 스킬 (hireling.txt Skill / monstats Skill1) */
  mercSkill?: { name: string; lvl: number };
}

export interface AiTarget { x: number; y: number; size: number; dead: boolean; inTown: boolean; id?: number }

/** 스킬 대상: 유닛(id) 또는 지점 */
export interface SkillTarget { unitId?: number; x: number; y: number }

/** AI 가 게임 월드에 요청하는 동작 (Game 이 구현) */
export interface AiWorld {
  frame: number;
  target: AiTarget;
  levelId: string;
  difficulty: number;
  /** 주변 몬스터 (Fallen 동료 사망 감지, 리더 명령, 부활 대상) */
  monsters: readonly MonsterUnit[];
  startMode(m: MonsterUnit, mode: MonMode): void;
  /** 이동 (steps = 원작 PATH_SetStepNum: 곧은 구간 수, 없으면 전체 경로) */
  moveTo(m: MonsterUnit, x: number, y: number, run: boolean, steps?: number): boolean;
  /** 원작 AITACTICS_UseSkill / UseSequenceSkill: monstats 스킬 칸 사용. 반환 false = 시작 실패 */
  useSkill(m: MonsterUnit, slot: number, target: SkillTarget | null): boolean;
  /** 원작 sub_6FCF2CC0: 미사일 벽에 가리지 않은 가장 가까운 대상과 거리 */
  missileTarget(m: MonsterUnit): { x: number; y: number; dist: number; unitId?: number } | null;
  /** 원작 UNITS_GetCurrentLifePercentage */
  lifePct(m: MonsterUnit): number;
  /** 대상 유닛의 생명 % (Fetish) */
  targetLifePct(): number;
  /** 스킬 사용 가능 확인 (sub_6FC68630: 부활 대상 자리 등) */
  canUseSkill(m: MonsterUnit, slot: number, target: SkillTarget | null): boolean;
  /** 몬스터를 죽음 모드로 (드롭·경험치 없음) — Foul Crow Nest 소진 */
  dieQuietly(m: MonsterUnit): void;
}
