// 몬스터 유닛·AI 세계 인터페이스 (AI 함수는 이 인터페이스로만 게임에 요청한다).
import type { MonsterStats, MonsterType, MonSeqFrame } from '../monster';
import type { Pt } from '../geom';
import type { Rng } from '../rng';
import type { ItemInstance } from '../treasure';
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
  /** 대상이 고정 지점 (움직이는 플레이어를 따라가지 않는다: Hydra·운석·Nest 자리) */
  fixed?: boolean;
  /** 돌진 스킬의 일격을 이미 했다 */
  dashHit?: boolean;
  /** 되풀이 남은 횟수 (Mosquito 빨기) */
  repeat?: number;
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
  // ---- Phase 5 (Act 2~4 몬스터) ----
  /**
   * 대상이 될 수 없다 (원작 UNITFLAG_TARGETABLE|CANBEATTACKED|ISVALIDTARGET 꺼짐 + 충돌 없음):
   * 굴에 들어간 Sand Maggot, 물에 잠긴 Frog Demon·Tentacle, 하늘로 날아오른 Vulture, 알. 그리지도 않는다
   */
  hidden?: boolean;
  /** HP 재생 보너스 (원작 dwAiParam[2] = hpregen × aip / 8 — Baboon·Bat Demon 이 쉴 때). 재생 × (1 + regenX8 / 8) */
  regenX8?: number;
  /** AI 명령 대상 유닛 (원작 AI 명령 nCmdParam[1]: Fetish Shaman 14 = 부활할 시체로, 1 = 공격 대상) */
  cmdTarget?: number;
  /** AI 명령 만료 프레임 (Cry Help: nCmdParam[3]) */
  cmdUntil?: number;
  /** 정해진 프레임에 사라지는 소환 유닛 (Hydra·Bone Prison) — 원작 dwAiParam[0] 만료 프레임 */
  expires?: number;
  /** 소환한 스킬 레벨 (몬스터 Hydra 의 미사일 레벨 = 소환 스킬 레벨) */
  summonLvl?: number;
  /** 돌진 스킬 (Leap·Charge·SerpentCharge·DiabRun) 진행: 목표 지점, 맞힐 대상, 판정 여부 */
  dash?: { x: number; y: number; targetId?: number; hit: boolean; speed: number };
  /** 연속 분사 스킬 (Inferno·DiabLight): 끝 프레임, 다음 미사일 프레임, 간격 */
  stream?: { until: number; next: number; every: number };
  /** 오라 스킬 (Duriel Holy Freeze) 다음 효과 프레임 */
  auraNext?: number;
  /** 이번 행동 모드가 끝난 뒤 다음 판단까지의 프레임 (원작 AITACTICS_Idle(ENDANIM 프레임 + n − 현재) — Thorn Hulk 연속 공격). 한 번 쓰고 지운다 */
  nextAfterMode?: number;
  /** 카오스 생추어리 봉인 보스 (봉인이 불렀다 — 처치하면 A4Q2 보스 수 증가) */
  sealBoss?: boolean;
  /** 걷기·달리기가 아닌 모드로 경로 이동 중 (Vulture S1 비행 — 원작 ChangeModeAndTargetCoordinatesOneStep(…, MONMODE_SKILL1)) */
  pathMode?: boolean;
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
  /** Blade Sentinel 칼날: 던진 자리(A)와 목표(B) 사이 왕복, 지금 B 로 가는 중 */
  creeper?: { ax: number; ay: number; bx: number; by: number; toB: boolean };
  /** 센트리: 남은 쏠 횟수 (−1 = 아직 안 셈, AI 첫 생각에서 Skill1 calc4), Death Sentry 가 마지막으로 터뜨린 시체 */
  shots?: number;
  lastCorpse?: number;
  /** Raven: 다음 공격 가능 프레임 (aip3 × 10 간격). 출처: AITHINK_Fn107_Raven dwAiParam[1] */
  nextAttack?: number;
  /** 덩굴 (Plague Poppy·Cycle of Life·Vines): 소환수 스킬 (sumskill1·sumsk1calc) */
  vine?: { skill: number; lvl: number };
  /** 그림자 (Shadow Warrior/Master): 주인 직업, 장비 (monequip), Master 여부, 주인의 그림자 스킬 레벨, 이번에 쓸 스킬 */
  shadow?: { cls: string; equipment: Record<string, ItemInstance>; master: boolean; ownerSkillLvl: number; use?: { id: number; lvl: number } };
}

export interface AiTarget { x: number; y: number; size: number; dead: boolean; inTown: boolean; id?: number }

/** 스킬 대상: 유닛(id) 또는 지점 */
export interface SkillTarget { unitId?: number; x: number; y: number; /** 고정 지점 (플레이어 위치를 따라가지 않음) */ fixed?: boolean }

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
  // ---- Phase 5 (Act 2~4 몬스터 AI 가 쓰는 요청) — 없으면 AI 가 가능한 범위에서 생략한다 ----
  /** 대상 없음 (원작 pAiTickParam->pTarget == nullptr: AI 표의 대상 방식 0·2·5 는 대상 없이도 AI 함수를 부른다) */
  noTarget?: boolean;
  /** 레벨 번호 (levels.txt Id) */
  levelNo?: number;
  /**
   * 지정 모드로 한 걸음 이동 (원작 AITACTICS_ChangeModeAndTargetCoordinatesOneStep / MoveInRadiusToTarget(nMode) —
   * Vulture 이륙 S1 · 착륙 S2 비행)
   */
  moveMode?(m: MonsterUnit, x: number, y: number, mode: MonMode): boolean;
  /** 모드 바꾸기 (원작 AITACTICS_ChangeModeAndTargetUnit(…, nMode, nullptr) — 대상 없이) */
  modeOnly?(m: MonsterUnit, mode: MonMode): void;
  /** 대상 정보 (Summoner 냉기/화염 저항 비교, Diablo 기술 가중치): 저항·냉기 상태·생명%·특수 기술(Blizzard·Meteor·Fire Wall>3·Immolation>7) */
  targetInfo?(): {
    fireRes: number; coldRes: number; lightRes: number; cold: boolean; lifePct: number; special: boolean; states: readonly string[];
    /** 플레이어의 마을 포털 (이 레벨에 있으면) — Diablo 포털 감옥 */
    portal?: { x: number; y: number };
    /** 원작 AITHINK_GetTargetScore */
    score?: number;
  };
  /** 미사일 벽이 사이를 막는가 (원작 UNITS_TestCollisionWithUnit(…, COLLIDE_MISSILE_BARRIER)) */
  missileBlocked?(m: MonsterUnit): boolean;
  /** 몬스터 생성 (원작 D2GAME_SpawnMonster_6FC69F10 — Maggot Queen 의 새끼). 경험치 없음 */
  spawn?(owner: MonsterUnit, typeId: string, x: number, y: number, mode: MonMode): MonsterUnit | null;
  /** 원작 sub_6FC68350: 그 자리에 몬스터를 놓을 수 있다 */
  canSpawnAt?(typeId: string, x: number, y: number): boolean;
  /** 원작 QUESTRECORD_GetQuestState (플레이어 퀘스트 기록) */
  questState?(quest: number, flag: number): boolean;
  /** 원작 SUNIT_GetServerUnit: id 로 몬스터 찾기 */
  unit?(id: number): MonsterUnit | undefined;
  /** 미사일 사거리 (missiles.txt Range) */
  missileRange?(name: string): number;
  /** 몬스터 스킬 칸의 실제 레벨 (원작 SKILLS_GetSkillLevel: Sk*lvl + 난이도 MonsterSkillBonus) */
  skillLevel?(m: MonsterUnit, slot: number): number;
  /** 레벨별 AI 공용 값 (원작 D2MonsterRegionStrc — 예: unk0x2D4 함정 종류) */
  levelVars?: Record<string, number>;
  /** 게임 사건 알림 (퀘스트 훅: 원작 ACT2Q1_OnRadamentActivated · ACT2Q5_OnSummonerActivated · ACT4Q1_OnIzualActivated) */
  event?(e: { type: string; [k: string]: unknown }): void;
  // ---- 확장팩 Act 5 ----
  /** monstats 칸에 없는 스킬 쓰기 (원작 AITACTICS_UseSkill(…, nMode, nSkillId, …) — Catapult Spotter·Baal Taunt·Impregnate) */
  useNamedSkill?(m: MonsterUnit, skill: string, mode: string, target: SkillTarget | null): boolean;
  /** 다른 monstats 행의 aip (원작 MONSTERMODE_GetMonStatsTxtRecord(MONSTER_IMP1~4)->wAiParam[i][난이도]) */
  monsterParam?(typeId: string, i: number): number;
  /** skills.txt ParamN (i = 0 부터) */
  skillParam?(skill: string, i: number): number;
}
