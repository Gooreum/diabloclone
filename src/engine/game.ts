// 게임 시뮬레이션: 명령 큐 → 고정 25fps 틱 → 이벤트 + 읽기 전용 스냅샷. (DOM/렌더 비의존)
import { Environment, PERIOD } from './environment';
import type { Command } from './command';
import { footprintsOverlap, type CollisionMap } from './collision';
import { dir64, SUBTILES_PER_YARD, type Pt } from './geom';
import { ENGINE_FPS } from './index';
import { findPath, nearestWalkable, reachableNear, type WalkMap } from './path';
import { Rng } from './rng';
import type { AnimData } from '../formats/animdata';
import { actionFrame } from '../formats/animdata';
import type { ItemBase, ItemDb } from './items';
import { QUALITY, type ItemInstance, type Quality, type TreasureDb } from './treasure';
import type { MonsterDb, MonsterStats, MonsterType, MonSeqFrame } from './monster';
import { aiDistance, isInMeleeRange, modeTiming, rollGetHit, rollMonsterStats } from './monster';
import { aiName, escape, hasAi, idle, MONMODE_INDEX, think, thinkNpc, walkToTarget, type AiWorld, type MonCast, type MonMode, type MonsterUnit, type NpcPathNode, type PetInfo, type SkillTarget } from './ai';
import { applyUModInit, calcPercentage, MONFLAG, rollMinionCount, UMOD, xferMods, type UniqueDb, type UModContext } from './uniques';
import { ChaosState, SEAL_IDS, type ChaosAction } from './chaos';
import { addExperience, spendStat, HOTKEY_SLOTS, type Character, type ClassName, type ClassStats, type ExpTable, type SkillHotkey } from './player';
import { blockChance, hitChance, playerAttackRating, playerDefense, rollDamage, rollPercent } from './combat';
import { adjustedExperience } from './experience';
import { StateList, type StateInfo, type StateOverlayDef } from './states';
import { ItemStore, WEAPON_SLOTS, type WeaponSlot } from './itemstore';
import { computeDerived, itemSkillBonus, skillBonusOf, usableCharms, type Derived, type ItemSkillBonus } from './charstats';
import { gemStats, statOf } from './itemgen';
import type { TxtRow } from '../formats/txt';
import { isBroken, type NpcPrice } from './price';
import { playerWclass, type Placed } from './inventory';
import type { MissileDef } from './missiles';
import { missileParam } from './missiles';
import { CLASS_CODE, type SkillDb, type SkillRecord } from './skills/db';
import { diminishing, levelDamageBonus, type SkillCalc, type SkillOwner } from './skills/formulas';
import { cobraLeech, kickDamage, linearPct, MAX_CHARGES, PROGRESSIVE_STATES, progressiveCalc, progressiveMissile } from './skills/assassin';
import { boulderKnockChance, nextFrenzy, shapeAllowed, shapeMode } from './skills/druid';
import { characterOwner, learnSkill, masteryBonus, passiveStat, passiveStats, type PassiveStat } from './skills/rules';
import { addDamage, addElemental, applyMonsterResists, emptyDamage, totalDamage, type DamagePacket } from './skills/damage';
import { rollCritical, rollWeaponDamage, weaponBaseRange } from './skills/player-damage';
import { PLAYER_SEQUENCES, type SeqFrame } from './skills/sequences';
import { evalCalc } from './skills/calc';
import { BONE_PRISON_X, BONE_PRISON_Y, HYDRA_X, HYDRA_Y, METEOR_FIRE_X, METEOR_FIRE_Y, ORB_X, ORB_Y, discOffsets, energyShieldAbsorb, frenzyStack, orbNextIndex, orbNovaIndices, periodicRate, strafeShots } from './skills/high';
import {
  OBJ, OBJMODE, SUBCLASS, animFrames, objectCollisionBit, chestDropRolls, chestTcName, distanceToObject, initObject, newRegion, populateRoomObjects, presetObject,
  setObjectMode, updateObjectCollision, wellAfterUse, wellRegen, type ObjectDb, type ObjectRegion, type ObjectSpawn, type ObjectUnit, type PopulateRoom,
} from './objects';
import { WaypointFlags } from './waypoints';
import { AutomapReveal } from './automap';
import { transmute, type CubeDb } from './cube';
import type { RunewordDb } from './runewords';
import { MERC_MODES, mercExpGain, mercLevelFor, mercStats, resurrectCost, type HirelingDb, type MercSave, type MercStats } from './hireling';
import { ACT_TOWN_KEYS, NPC_DEFS, NpcServices, QUESTFLAG_A2Q0, QUESTFLAG_A2Q4, QUESTFLAG_A2Q6, QUESTFLAG_A3Q0, QUESTFLAG_A3Q6, TRAVEL, type HireCandidate, type NpcOption, type TradeHost } from './npc';
import type { StoreItem } from './shop';
import type { GambleTable } from './shop';
import { Act1Quests, type QuestHost, type QuestLogEntry, type QuestSpeech } from './quests/act1';
import { ACT_QUESTS, ACT_QUESTS_LOD, QUEST_INIT_FNS, QuestControl, type ActsQuestHost } from './quests/index';
import { applyResistPenalty, difficultyRules, type DifficultyRules } from './difficulty';
import { QFLAG, QUEST, QuestRecord } from './quests/record';
import { QW, questOfWord } from './quests/messages-acts';
import { LEVEL } from './drlg/types';
import { actCount } from './drlg/acts';
import { isPersonalizable, isSocketable, larzukSockets } from './sockets';
import type { Act5Quests } from './quests/act5';
import { mercCanEquip, mercDerived, mercSkillBonus, mercSlotFor, type MercDerived, type MercSlot } from './mercequip';

/**
 * 원작 플레이어 애니메이션 모드 토큰: NU 대기, WL 걷기, RN 달리기, TN/TW 마을, A1/A2 공격, SC 시전, TH 던지기,
 * S1~S4 특수, KK 발차기, SQ 시퀀스(스킬 전용 프레임 조합), GH 피격, DT 사망, DD 시체
 */
export type PlayerMode = string;

// 출처: 원작 MPQ 경로 data\global\CHARS\<토큰>\ (AM, SO, NE, PA, BA)
export const CLASS_TOKEN: Record<ClassName, string> = { Amazon: 'AM', Sorceress: 'SO', Necromancer: 'NE', Paladin: 'PA', Barbarian: 'BA', Druid: 'DZ', Assassin: 'AI' };
const PLAYER_SIZE = 2;
const PICKUP_RANGE = 2;
/** 근사(원작 미확인): 봉인 보스가 봉인을 연 플레이어에게서 생기는 거리 한도 (서브타일) — 800×600 화면 안 */
const SEAL_BOSS_RADIUS = 10;
/** 스킬 Id: 일반 스킬 (skills.txt 0~5) */
export const SKILL_ATTACK = 0;
export const SKILL_THROW = 2;

export interface GameData {
  /** 확장팩 캐릭터용 데이터 (원작 wVersion 100 — 아이템 생성·상점·도박·큐브·용병 규칙). 표는 클래식과 같다 */
  expansion?: boolean;
  monsters: MonsterDb;
  treasure: TreasureDb;
  items: ItemDb;
  anim: AnimData;
  /** HitClass.txt 코드 → 행 번호 */
  hitClassIndex: Map<string, number>;
  /** missiles.txt 이름 → 정의 */
  missiles: Map<string, MissileDef>;
  skills?: SkillDb;
  skillCalc?: SkillCalc;
  /** DifficultyLevels.txt Normal MonsterColdDivisor / MonsterFreezeDivisor */
  coldDivisor?: number;
  freezeDivisor?: number;
  /** DifficultyLevels.txt 행 (Normal, Nightmare, Hell) */
  difficultyRows?: TxtRow[];
  /** npc.txt 가격 배수, books.txt 책 충전 가격 */
  npcPrices?: Map<string, NpcPrice>;
  bookCharge?: Map<string, number>;
  /** objects.txt / ObjGroup.txt / shrines.txt / levels.txt (오브젝트) */
  objects?: ObjectDb;
  /** MonUMod.txt / SuperUniques.txt / MonPreset.txt / 유니크 이름 표 */
  uniques?: UniqueDb;
  /** hireling.txt / hiredesc.txt (용병) */
  hirelings?: HirelingDb;
  /** 호라드릭 큐브 조합 (cubemain.txt) */
  cube?: CubeDb;
  /** 룬워드 (runes.txt, 확장팩 캐릭터만 완성) */
  runewords?: RunewordDb;
  /** gamble.txt 선택표 (도박) */
  gamble?: GambleTable;
  /** states.txt 상태 → overlay.txt 그림 (상태 오버레이). 출처: states.txt overlay1~4, overlay.txt Filename/Frames */
  stateOverlays?: Map<string, StateOverlayDef[]>;
  /** states.txt group (같은 group 상태는 서로 지운다 — Fade·Burst of Speed, 아머 3종) */
  stateGroups?: Map<string, number>;
  /** states.txt 주기 함수·변신 정보 */
  stateInfo?: Map<string, StateInfo>;
  /** overlay.txt 이름(소문자) → 그림 (무술 차지 prgoverlay) */
  overlays?: Map<string, StateOverlayDef>;
  /** monequip.txt (그림자 전사·마스터 장비) */
  monEquip?: TxtRow[];
}

export interface PlayerInit { x: number; y: number; walkVelocity: number; runVelocity: number }

export interface GameInit {
  map: CollisionMap;
  player: PlayerInit;
  seed: number;
  data?: GameData;
  character?: Character;
  classStats?: ClassStats;
  expTable?: ExpTable;
  /** 장착 아이템 (itemtypes BodyLoc 코드 → 아이템: head neck tors rarm larm rrin lrin belt feet glov) */
  equipment?: Record<string, ItemInstance>;
  /** 무기 바꾸기 (확장팩): 쉬는 세트·지금 세트·쉬는 세트에서 고른 스킬 */
  altWeapons?: Partial<Record<WeaponSlot, ItemInstance>>;
  weaponSet?: 0 | 1;
  altSkills?: { left: number; right: number };
  inTown?: boolean;
  /** 인벤토리 — 자리 없이 주면 벨트/빈 자리에 자동 배치, 자리 있으면 그대로 */
  inventory?: ItemInstance[];
  inventoryGrid?: Placed[];
  stash?: Placed[];
  /** 호라드릭 큐브 칸 (저장) */
  cube?: Placed[];
  belt?: (ItemInstance | null)[];
  gold?: number;
  /** 창고 골드 */
  stashGold?: number;
  /** 난이도 0 Normal / 1 Nightmare / 2 Hell (DifficultyLevels.txt 행) */
  difficulty?: 0 | 1 | 2;
  /** 시작 막 (0 = Act 1 … 3 = Act 4). levels 는 이 막의 레벨 */
  act?: number;
  /** 저장된 시체 (게임을 나갔다 들어오면 시작 위치 옆에 놓인다) */
  corpse?: Record<string, ItemInstance>;
  /** 여러 레벨 (지정 시 map/inTown 대신 사용). 첫 레벨이 시작 레벨 */
  levels?: LevelDef[];
  /** 활성 웨이포인트 번호 (levels.txt Waypoint). 0(마을)은 항상 활성 */
  waypoints?: number[];
  /** 저장된 용병 */
  merc?: MercSave | null;
  /** 예전 저장의 퀘스트 이름 ('a1q2' Blood Raven 보상, 'cain' Cain 구출) — questFlags 가 없을 때만 쓴다 */
  quests?: string[];
  /** 퀘스트 기록 워드 (원작 D2QuestRecord, 퀘스트마다 16비트) */
  questFlags?: number[];
  /** A5Q3 저항 두루마리를 읽은 다른 난이도 수 (저장 questFlagsByDiff 의 A5Q3 CUSTOM3 — questResistDiffs) */
  questResistOther?: number;
  /** 캐릭터 이름 (원작 pPlayerData->szName — 이름 새기기) */
  playerName?: string;
  /** Phase 7: 저장의 열린 가장 높은 난이도 (디아블로를 죽이면 다음 난이도) */
  difficultyUnlocked?: 0 | 1 | 2;
  /** Phase 7: 저장의 진행 값 (원작 .d2s nProgression — 칭호) */
  progression?: number;
}

/** 레벨 출구: 플레이어가 영역(서브타일)에 들어가면 다른 레벨의 지정 위치로 이동 */
export interface LevelExit {
  x: number; y: number; w: number; h: number; to: string; toX: number; toY: number;
  /** 지정 시 도착 y = 현재 y + dy (야외 경계처럼 나란히 이어지는 출구) */
  dy?: number;
  /** 지정 시 도착 x = 현재 x + dx (남북으로 맞닿은 야외 경계) */
  dx?: number;
  /**
   * 레벨 이동 타일 (동굴 입구·계단): 이동 지점(서브타일)과 LvlWarp 클릭 상자(이동 지점 화면 좌표 기준 픽셀).
   * 상자 안을 클릭하면 출구로 걸어간다. 출처: LvlWarp.txt SelectX/SelectY/SelectDX/SelectDY
   */
  warp?: { x: number; y: number; selectX: number; selectY: number; selectDX: number; selectDY: number };
}

/** 출처: DRLGPRESET_ParseDS1File ACT_V — 몬스터 프리셋 → 오브젝트 (objects.txt 번호) */
const ACT5_PRESET_OBJECTS: Readonly<Record<string, number>> = { nihlathak: 461, ancientstatue1: 476, ancientstatue2: 475, ancientstatue3: 474 };

export interface LevelDef {
  id: string;
  map: CollisionMap;
  inTown: boolean;
  exits: LevelExit[];
  /** 처음 들어갈 때 배치할 몬스터 (boss = 챔피언/유니크 굴림, party = 동반 몬스터) */
  spawns?: { typeId: string; x: number; y: number; leaderIndex: number; boss?: boolean; party?: boolean }[];
  /** levels.txt 번호 (오브젝트·웨이포인트·상자 TC) */
  levelNo?: number;
  /** DS1 프리셋 오브젝트 (objects.txt 번호, 574 이상은 원작 특수 표) — 레벨 서브타일 */
  objects?: { classId: number; x: number; y: number }[];
  /** 오브젝트 그룹 배치용 방 (서브타일) */
  rooms?: PopulateRoom[];
  /** levels.txt 몬스터 풀 (함정 몬스터 선택) */
  monsterPool?: string[];
  /** 마을 포털이 열리는 자리 (원작 타일 정보 11 — DUNGEON_FindActSpawnLocationEx(…, 11, …)) */
  portalSpot?: { x: number; y: number };
  /** DS1 프리셋 몬스터 (MonPreset 번호, 서브타일, DS1 경로 — 점마다 원작 경로 동작) · code = 하드코딩 프리셋 (Flavie 'navi') */
  presetMonsters?: { id: number; x: number; y: number; path?: (Pt & { action?: number })[]; code?: string; mon?: string }[];
  /** 레벨 몬스터 정보: levels.txt 풀·고른 목록·보스 후보·MonLvlEx·막·WarpDist */
  monsterInfo?: { pool: string[]; region: string[]; umon: string[]; monLvlEx: number; act: number; warpDist: number; warpPoints: Pt[] };
}

interface LevelState {
  def: LevelDef; monsters: MonsterUnit[]; ground: GroundItem[]; missiles: Missile[]; populated: boolean;
  /** 마을 NPC·장식 유닛 (공격 대상이 아니다) */
  npcs: MonsterUnit[];
  objects: ObjectUnit[]; region: ObjectRegion | null; automap: AutomapReveal;
  /** 몬스터 종류별 레이어 외형 세트 (원작 D2MonRegDataStrc nComponentVariants) */
  variants: Map<string, Record<string, number>[]>;
}

export interface GameEvent { type: string; [k: string]: unknown }

/** 한 막의 레벨 (Game.addAct / onActChange 가 돌려줌). start = 막 도착 위치 (마을) */
export interface ActLevels { levels: LevelDef[]; start: Pt }

/** 막별 상태 캐시 (레벨·NPC·몬스터·오브젝트는 LevelState 안에). 원작도 막마다 DRLG·방·유닛을 따로 둔다 */
interface ActState { act: number; levels: Map<string, LevelState>; start: Pt }

export interface PlayerSnapshot {
  id: number; x: number; y: number; mode: PlayerMode; dir: number; modeTick: number;
  /** 시퀀스(SQ) 스킬 중이면 지금 그릴 모드·프레임 */
  anim?: { mode: string; frame: number };
  /** 변신 (늑대·곰): 그릴 몬스터 (monstats Id) — states.txt gfxtype 1 · gfxclass */
  shape?: { typeId: string };
  life: number; maxLife: number; mana: number; maxMana: number; level: number; experience: number; gold: number;
  /** 스태미나 (장비·Increased Stamina·신전 포함 최대치). 달리기 중(running) — 스태미나가 다하면 false 로 바뀐다 */
  stamina: number; maxStamina: number; running: boolean;
  states: string[];
  leftSkill: number; rightSkill: number;
}
export interface MonsterSnapshot {
  id: number; typeId: string; code: string; x: number; y: number; mode: MonMode; dir: number; modeTick: number; hp: number; maxHp: number; states: string[];
  /** 플레이어 소환수 */
  ally?: boolean;
  /** MONTYPEFLAG (2 슈퍼유니크, 4 챔피언, 8 유니크, 16 미니언) · 수식어 · 이름 시드 · 슈퍼유니크 행 */
  flags: number; umods: number[]; nameSeed: number; superUnique?: number;
  /** 레이어 외형 선택 (레이어 → 변형 순번) */
  components?: Record<string, number>;
  /** 유니크 색 (RandTransforms 번호 + 2, 원작 Utrans 값) — 없으면 undefined */
  uniqueTrans?: number;
  /** 시퀀스(SQ) 모드면 지금 그릴 모드·프레임 */
  anim?: { mode: string; frame: number };
  /** 마을 NPC·장식 (공격 불가), 말을 걸 수 있음, 플레이어의 용병, 퀘스트 이야기가 있음 (원작 QUESTS_ActiveCycler 느낌표) */
  npc?: boolean; interact?: boolean; merc?: boolean; quest?: boolean;
  /** 대상이 될 수 없음 (하늘을 나는 Vulture 등 — 원작 UNITFLAG_TARGETABLE 꺼짐) */
  untargetable?: boolean;
  /** 그림자 (Shadow Warrior/Master): 주인 직업 그림 + 그림자 장비로 그린다 */
  shadow?: { cls: string; equipment: Record<string, ItemInstance> };
}
/** NPC 와 대화 중 (메뉴·상점·도박·고용 목록) */
export interface InteractionSnapshot {
  npcId: number; typeId: string;
  /** imbue = Charsi 담금질, socket = Larzuk 소켓 (A5Q1), personalize = Anya 이름 새기기 (A5Q4) — 아이템 하나를 맡기는 창 */
  mode: 'menu' | 'trade' | 'gamble' | 'hire' | 'imbue' | 'socket' | 'personalize';
  options: NpcOption[];
  /** 메뉴의 퀘스트 항목 (option 'quest:<퀘스트>:<문자열 번호>' → 퀘스트 번호) */
  topics: { option: NpcOption; quest: number; key: string }[];
  /** 상점·도박 목록 (mode trade/gamble) */
  store: readonly StoreItem[];
  /** 이 NPC 가 수리함 (Charsi) */
  repair: boolean;
  /** 고용 후보 (mode hire) */
  hire: readonly HireCandidate[];
}
/** 용병 (왼쪽 위 생명 막대) */
export interface MercSnapshot {
  id: number | null; name: string; level: number; hp: number; maxHp: number; dead: boolean; experience: number; nextExp: number; /** monstats 행 (roguehire·act2hire·act3hire) */ typeId?: string;
  /** 확장팩 용병 장비 · 능력치 (용병 창) */
  items?: Partial<Record<MercSlot, ItemInstance>>;
  stats?: { str: number; dex: number; min: number; max: number; defense: number; resist: { fi: number; co: number; li: number; po: number }; hireDesc: number };
}
export interface GroundItemSnapshot { id: number; code: string; quality: number; quantity: number; x: number; y: number }
export interface MissileSnapshot { id: number; name: string; x: number; y: number; dir: number; celFile: string; frame: number; /** 그리기 혼합 (missiles.txt / overlay.txt Trans, 0 이 아니면 빛 더하기) */ blend?: number }
/** 플레이어 시체 (죽을 때 장착 아이템이 남는다) */
export interface CorpseSnapshot { x: number; y: number; dir: number; items: ItemInstance[] }
/** 오브젝트 (상자·문·신전·웨이포인트·포털 …) */
export interface ObjectSnapshot {
  id: number; classId: number; token: string; name: string; x: number; y: number; mode: number; modeTick: number;
  selectable: boolean; subClass: number;
  /** 포털이면 도착 레벨 */
  portalTo?: string;
}
export interface WorldSnapshot {
  tick: number;
  corpse: CorpseSnapshot | null;
  player: PlayerSnapshot;
  monsters: MonsterSnapshot[];
  items: GroundItemSnapshot[];
  missiles: MissileSnapshot[];
  objects: ObjectSnapshot[];
  inventory: ItemInstance[];
  interaction: InteractionSnapshot | null;
  merc: MercSnapshot | null;
  /** 퀘스트 로그 (Act 1 여섯 개, 원작 퀘스트 패널 순서) */
  quests: QuestLogEntry[];
}

type PlayerAction =
  | { kind: 'skill'; skillId: number; targetId?: number; targetItem?: number; x: number; y: number; standStill: boolean; repeat: boolean }
  | { kind: 'pickup'; itemId: number }
  | { kind: 'corpse' }
  | { kind: 'object'; id: number }
  | { kind: 'npc'; id: number };

/** 진행 중인 스킬 사용 (애니메이션 + 판정 시점) */
interface Cast {
  skill: SkillRecord;
  lvl: number;
  targetId?: number;
  tx: number; ty: number;
  start: number; end: number;
  /** 판정 이벤트 발생 틱 (시작 기준) */
  hitTicks: number[];
  fired: number;
  seq?: { frames: readonly SeqFrame[]; rate: number };
  leap?: { fx: number; fy: number; tx: number; ty: number; landTick: number };
  targetItem?: number;
  /** 반복 스킬(Inferno): 다음 발사 틱 */
  repeatAt?: number;
  /** Charge 돌진 중: 프레임당 이동량, 최대 시각 */
  charge?: { speed: number; until: number };
  /** Whirlwind: 목표 지점까지 회전 이동, 마지막으로 친 대상, 지난 시퀀스 프레임 */
  whirl?: { tx: number; ty: number; speed: number; last: number; frame: number };
  /** Strafe / Fend: 이번 사용의 남은 대상 (이미 친 대상은 뒤로) */
  hitIds?: number[];
  /** Blade Fury: 다음 발사 가능 프레임 (원작 skill param1) */
  nextFire?: number;
  /** Dragon Talon 남은 발 (원작 skill param1), 직전 발차기 명중·물리 (Dragon Tail) */
  kicksLeft?: number;
  lastHit?: boolean;
  lastPhys?: number;
}

interface PlayerState {
  id: number; x: number; y: number; mode: PlayerMode; dir: number;
  path: Pt[]; running: boolean; walkVelocity: number; runVelocity: number;
  modeEnd: number; modeStart: number;
  action: PlayerAction | null;
  cast: Cast | null;
  repathAt: number;
  states: StateList;
  /** 반복 스킬 버튼을 누르고 있는 한계 틱 (입력이 약 5틱마다 다시 보낸다) */
  holdUntil: number;
  /** Blaze: 마지막으로 불을 놓은 위치 */
  lastBlaze?: Pt;
}

interface GroundItem { item: ItemInstance; x: number; y: number }

interface Missile {
  id: number;
  /** 거미줄(spidergoolay)·점액(spidergoo): 닿으면 둔화 */
  goo?: boolean;
  def: MissileDef;
  x: number; y: number; dx: number; dy: number;
  left: number; age: number;
  owner: 'player' | 'monster';
  ownerId: number;
  ownerLevel: number;
  /** 몬스터 미사일: 굴릴 피해 범위·명중 */
  damage?: { min: number; max: number };
  toHit?: number;
  hitClass: number;
  /** 플레이어 미사일: 명중 판정용 AR (undefined = 항상 명중) */
  ar?: number;
  roll?: () => DamagePacket;
  hit: Set<number>;
  homingTarget?: number;
  /** 제자리 구름: 반경 안 몬스터에게 주기적으로 피해 */
  cloud?: { radius: number; every: number };
  /** 이동 중 떨어뜨리는 구름 미사일 */
  trail?: { def: MissileDef; every: number; roll: () => DamagePacket };
  /** 충돌/소멸 시 폭발 */
  explode?: { radius: number; roll: () => DamagePacket };
  /** 충돌/소멸 시 주변에 구름 생성 (Plague Javelin) */
  cloudBurst?: { def: MissileDef; count: number; roll: () => DamagePacket };
  wander?: boolean;
  /** 같은 시전의 여러 미사일이 한 유닛을 한 번만 맞히도록 공유하는 집합 (Nova) */
  group?: Set<number>;
  /** 연쇄 번개: 남은 도약 수·탐색 반경 */
  chain?: { left: number; range: number };
  /** 스킬 (Fire Ball 폭발 반경·Glacial Spike 빙결 등 스킬 공식 참조) */
  skill?: SkillRecord;
  lvl: number;
  /** 이동 중 매 프레임 지면 불을 남긴다 (Fire Wall 생성기) */
  groundTrail?: { def: MissileDef; roll: () => DamagePacket };
  /** 나선 경로 (Blessed Hammer): 중심, 각, 반지름 */
  spiral?: { cx: number; cy: number; a: number; r: number };
  /** 몬스터 미사일: 원소 등 추가 피해 (1/256) */
  mpkt?: DamagePacket & { manaDrain?: number };
  /** 몬스터 지면 불 (제자리, 닿아 있는 동안 매 프레임) */
  groundFire?: boolean;
  /** 명중 판정 없음 (missiles.txt ToHit 0) */
  alwaysHit?: boolean;
  /** 그림만 (충돌 없음) */
  visual?: boolean;
  /** 적과 부딪히지 않음 (Frozen Orb 본체, Meteor 표적, 지연 미사일) */
  noCollide?: boolean;
  /** 매 프레임 처리 (Frozen Orb 볼트 방출, Blizzard 조각, Grim Ward 공포) */
  onTick?: (ms: Missile) => void;
  /** 수명이 다하거나 벽에 막혀 사라질 때 (Frozen Orb 노바, Meteor 낙하, Fist of the Heavens) */
  onEnd?: (ms: Missile) => void;
  /** Bone Spirit: 대상 없이 쏘면 목표 지점에 닿은 뒤 반경 안 적을 찾아 따라간다 */
  seek?: { tx: number; ty: number; radius: number };
  /** 원작 Pierce 패시브 관통 확률 (skill_pierce %) */
  pierceChance?: number;
  /** 플레이어 무기 피해 미사일 — 아이템 공격 사건 (강타·상처 악화 …) */
  procs?: boolean;
  /** 이미 터짐 (Immolation Arrow 가 적중과 소멸에서 두 번 터지지 않게) */
  exploded?: boolean;
  /** Rabies 옮김 미사일: 독이 끝나는 프레임 (MISSMODE_SrvDmg11 — 남은 길이) */
  until?: number;
  /** CollideKill 미사일이 이 유닛은 지나간다 (Molten Boulder: 큰 몬스터가 아니면 — MISSMODE_SrvHit47 반환 2) */
  pass?: (m: MonsterUnit) => boolean;
  /** NextHit 미사일 (Shock Web 가시·Blade Sentinel): 맞힌 유닛을 NextDelay 프레임 뒤 다시 맞힌다 — id → 다시 맞힐 수 있는 age */
  rehit?: Map<number, number>;
  /** 확장 몬스터 미사일 (Phase 5: 관통·지속 피해·유도·폭발·적중 효과) — updateMonMissileEx */
  mon?: { pierce: boolean; homing: boolean; every: number; nextHit: number; explode?: { radius: number; visual?: string }; onHit?: () => void };
}

/** 저주 상태 (한 몬스터에 하나만). 출처: states.txt curse = 1 (클래식 네크로맨서 저주) */
const CURSE_STATES = ['amplifydamage', 'dimvision', 'weaken', 'ironmaiden', 'terror', 'confuse', 'lifetap', 'attract', 'decrepify', 'lowerresist'];

/** 원작 미사일 Vel(프레임당 픽셀) → 프레임당 서브타일. 출처: Phrozen Keep KB a=463 — Yards = Vel × Range / 32 */
const missileStep = (vel: number): number => (vel / 32) * SUBTILES_PER_YARD;

export class Game {
  readonly rng: Rng;
  readonly data: GameData | undefined;
  /** 쉬는 무기 세트에서 고른 왼쪽·오른쪽 스킬 (원작 LoD: 세트마다 스킬을 따로 기억) */
  altSkills: { left: number; right: number };
  /** 확장팩 캐릭터 (확장팩 데이터 판본으로 시작) */
  get expansion(): boolean {
    return this.data?.expansion ?? false;
  }
  readonly character: Character | undefined;
  readonly classStats: ClassStats | undefined;
  private readonly expTable: ExpTable | undefined;
  /** 인벤토리 격자·창고·벨트·장착·커서 */
  readonly store: ItemStore;
  /** 장착이 바뀌어 파생 스탯을 다시 계산해야 함 */
  private statsDirty = true;
  /** 아이템 오라 (스킬 번호 → 레벨·다음 주기) */
  private readonly itemAuras = new Map<number, { skill: SkillRecord; lvl: number; next: number }>();
  /** 아이템 스킬 발동 중 (발동한 스킬이 다시 발동을 부르지 않게) */
  private inItemSkill = false;
  /** 마지막으로 플레이어를 친 몬스터 (ItemTarget 4) */
  private lastAttackerId: number | undefined;
  /** 자동 수리·수량 다음 프레임 (아이템 id → 프레임) */
  private readonly replenishAt = new Map<number, number>();
  private derivedCache: Derived | null = null;
  private derivedKey = '';
  gold = 0;
  stashGold = 0;
  readonly difficulty: 0 | 1 | 2;
  /** 난이도 규칙 (DifficultyLevels.txt 현재 난이도 행) */
  readonly rules: DifficultyRules;
  /** 현재 막 (0 = Act 1 … 3 = Act 4). 출처: D2MOO DRLG_GetActNoFromLevelId — 플레이어가 있는 레벨의 막 */
  act = 0;
  /** 막별 낮·밤 (들어간 적 있는 막만) */
  private readonly envs: (Environment | undefined)[] = [];
  /**
   * 막 월드 요청: 아직 만들지 않은 막으로 갈 때 부른다 (원작 DRLG_AllocDrlg 처럼 막 단위로 지연 생성).
   * 브라우저(main.ts)는 여기서 그 막 월드·렌더러를 만들어 돌려준다. null 이면 그 막으로 갈 수 없다
   */
  onActChange: ((act: number) => ActLevels | null | undefined) | null = null;
  /**
   * 플레이어 시체: 장착·커서 아이템과 되찾을 경험치(잃은 경험치의 75%).
   * 출처: D2MOO PlrModes.cpp D2GAME_CORPSE_Handler_6FC7FBD0
   */
  corpse: { levelId: string; x: number; y: number; dir: number; items: Partial<Record<string, ItemInstance>>; exp: number } | null = null;
  /** 이번 죽음에서 잃은 경험치 (시체를 만들 때 75% 가 시체에 저장) */
  private expLoss = 0;
  private tickCount = 0;
  private readonly queue: Command[] = [];
  private readonly player: PlayerState;
  /** 현재 막의 레벨 (acts 의 현재 막 levels 와 같은 객체) */
  private levels = new Map<string, LevelState>();
  /** 막별 캐시 — 막을 떠나도 레벨·NPC·상점 상태를 그대로 둔다 */
  private readonly acts = new Map<number, ActState>();
  private level: LevelState;
  /** 출구로 막 넘어옴: 도착 칸을 덮는 출구는 벗어날 때까지 무시 */
  private exitHold = false;
  private nextUnitId = 100;
  private events: GameEvent[] = [];
  private passiveCache: { key: string; list: PassiveStat[] } | null = null;
  /** 장비 +스킬 합계 (derived() 와 같이 다시 계산) · 다시 계산할 때마다 늘어나는 번호 (패시브 캐시 키) */
  private itemSkillCache: ItemSkillBonus | null = null;
  private itemSkillVersion = 0;
  /** 플레이어 소환수 (레벨을 옮겨 다녀도 따라온다) */
  readonly pets: MonsterUnit[] = [];
  /** 켜져 있는 오라 (오른쪽 버튼의 오라 스킬) */
  private aura: { skill: SkillRecord; lvl: number; next: number } | null = null;
  /** Thunder Storm: 다음 번개 틱, 직전 대상 */
  private stormNext = 0;
  /** Armageddon·Hurricane 상태별 다음 주기 프레임 (상태 이름 → 프레임) */
  private readonly druidStorm = new Map<string, number>();
  private stormLast = -1;
  /** Attract: 몬스터 id → 노릴 대상(저주받은 몬스터) id, 만료 틱 */
  private readonly attracted = new Map<number, { target: number; until: number }>();
  /** 소환수 미사일 피해 굴림 (Hydra: 캐릭터의 Hydra 스킬 피해·마스터리) */
  private readonly petRoll = new Map<number, () => DamagePacket>();
  /** 소환수 오라 (Fire Golem 의 Holy Fire) */
  private readonly petAura = new Map<number, { skill: SkillRecord; lvl: number; next: number }>();
  /** 활성 웨이포인트 (캐릭터 저장) */
  readonly waypoints: WaypointFlags;
  /** 원작 pGame->pObjectControl->pSeed (오브젝트 배치·초기화·조작 굴림) */
  private readonly objControl: Rng;
  private readonly seed: number;
  /** 플레이어의 마을 포털 한 쌍 (원작 PLAYER_SetUniqueIdInPlayerData — 한 사람당 하나) */
  townPortal: { fieldLevel: string; fieldId: number; townLevel: string; townId: number } | null = null;
  /** 웨이포인트 목록 패널을 연 웨이포인트 (원작 SUNIT_SetInteractInfo) */
  waypointOpen: { levelId: string; objectId: number } | null = null;
  /** 마을 NPC 기능 (상인 재고·도박·고용 목록, NPC 시드) */
  readonly npc: NpcServices;
  /** NPC 유닛 굴림 (배치·AI). 근사(원작 미확인): 원작은 유닛마다 게임 시드에서 굴린 시드 — 게임 굴림 순서를 바꾸지 않게 따로 둔다 */
  private readonly npcRng: Rng;
  /** 대화 중인 NPC (원작 SUNIT_SetInteractInfo / MONSTERAI 상호작용 목록) */
  private talk: { levelId: string; npcId: number; mode: InteractionSnapshot['mode']; speeches: QuestSpeech[] } | null = null;
  /** 플레이어 퀘스트 기록 (원작 pPlayerData->pQuestData[난이도], 저장된다) */
  readonly questRecord: QuestRecord;
  /** A5Q3 저항 두루마리를 읽은 다른 난이도 수 */
  private readonly questResistOther: number;
  /** 캐릭터 이름 (원작 pPlayerData->szName) */
  readonly playerName: string;
  /** 게임 전역 퀘스트 기록 (원작 pQuestControl->pQuestFlags, 게임마다 새로) */
  readonly questGlobal = new QuestRecord();
  /** Act 1 퀘스트 상태 기계 (questControl 의 Act 1 모듈) */
  readonly quests: Act1Quests;
  /** 모든 막 퀘스트 (게임 사건은 여기로 알린다) */
  readonly questControl: QuestControl;
  /** Phase 7: 열린 가장 높은 난이도 (저장 difficultyUnlocked — 디아블로를 죽이면 min(난이도 + 1, 2)) */
  difficultyUnlocked: 0 | 1 | 2 = 0;
  /** Phase 7: 진행 값 (원작 .d2s nProgression = max(nAct + 난이도 × 4) — 칭호) */
  progression = 0;
  /** 용병 기록 (죽어도 남는다 — 부활 대상). unitId = 살아 있는 유닛 */
  merc: (MercSave & { unitId: number | null }) | null = null;
  /** 호라드릭 큐브 창이 열려 있음 (원작 SUNIT_SetInteractInfo(UNIT_ITEM, 큐브)) */
  cubeOpen = false;
  private mercInfo: MercStats | null = null;
  /** 장비를 더한 용병 능력치 (확장팩, refreshMerc) */
  private mercDv: MercDerived | null = null;
  /** 용병이 켠 오라 (D2GAME_AssignSkill — 유닛이 새로 생기면 꺼진다) */
  private mercAura: { skill: SkillRecord; lvl: number; next: number } | null = null;
  /** 용병 장비의 아이템 오라 (item_aura — param 스킬, 값 레벨). 출처: SKILLITEM_ActivateAura (용병도 STAT_ITEM_AURA 콜백) */
  private mercItemAuras = new Map<number, { skill: SkillRecord; lvl: number; next: number }>();

  constructor(init: GameInit) {
    const defs = init.levels ?? [{ id: 'main', map: init.map, inTown: init.inTown ?? false, exits: [] }];
    this.act = init.act ?? 0;
    this.levels = this.addAct(this.act, { levels: defs, start: { x: init.player.x, y: init.player.y } }).levels;
    this.seed = init.seed >>> 0;
    // 근사(원작 미확인): 원작 오브젝트 시드는 게임 시드에서 굴린 값 (OBJRGN_AllocObjectControl) — 여기서는 게임 시드에서 고정 변환
    this.objControl = new Rng((init.seed ^ 0x0b1ec7) >>> 0 || 1);
    this.waypoints = new WaypointFlags(init.waypoints ?? []);
    this.level = this.levels.get((defs[0] as LevelDef).id) as LevelState;
    this.rng = new Rng(init.seed);
    this.data = init.data;
    this.character = init.character;
    this.classStats = init.classStats;
    this.expTable = init.expTable;
    // 유니크 한 번만 드롭 규칙은 게임(판)마다 새로 시작 (출처: pGame->dwUniqueFlags)
    init.data?.treasure.droppedUniques.clear();
    if (init.data) init.data.treasure.difficulty = init.difficulty ?? 0;
    // 위치가 있는 인벤토리는 그대로, 없는 것(x < 0, 예전 저장)은 빈 자리에 자동 배치
    const placed = (init.inventoryGrid ?? []).filter((p) => p.x >= 0);
    const loose = [...(init.inventoryGrid ?? []).filter((p) => p.x < 0).map((p) => p.item), ...(init.inventory ?? [])];
    this.store = new ItemStore(init.data?.items, { inventory: placed, stash: init.stash, cube: init.cube, belt: init.belt, equipment: init.equipment, altWeapons: init.altWeapons, weaponSet: init.weaponSet });
    this.altSkills = init.altSkills ? { ...init.altSkills } : { left: init.character?.leftSkill ?? SKILL_ATTACK, right: init.character?.rightSkill ?? SKILL_ATTACK };
    for (const it of loose) {
      const b = init.data?.items.base(it.code);
      if (b) {
        it.invW = b.invWidth;
        it.invH = b.invHeight;
      }
      this.store.store(it);
    }
    this.gold = init.gold ?? 0;
    this.stashGold = init.stashGold ?? 0;
    this.difficulty = init.difficulty ?? 0;
    this.difficultyUnlocked = Math.max(init.difficultyUnlocked ?? 0, this.difficulty) as 0 | 1 | 2;
    this.progression = init.progression ?? 0;
    this.rules = difficultyRules(init.data?.difficultyRows, this.difficulty);
    const p = init.player;
    this.player = {
      id: 1, x: p.x, y: p.y, mode: 'NU', dir: 0, path: [], running: false,
      walkVelocity: p.walkVelocity, runVelocity: p.runVelocity,
      modeEnd: 0, modeStart: 0, action: null, cast: null, repathAt: 0, states: new StateList(), holdUntil: 0,
    };
    // 근사(원작 세부 미확인): 저장된 시체는 시작 위치 바로 옆에 놓는다
    if (init.corpse && Object.keys(init.corpse).length) {
      this.corpse = { levelId: this.level.def.id, x: p.x + 1, y: p.y + 1, dir: 0, items: { ...init.corpse }, exp: 0 };
    }
    this.npc = new NpcServices((init.seed ^ 0x4e5043) >>> 0);
    this.npcRng = new Rng((init.seed ^ 0x6e7063) >>> 0 || 1);
    // 출처: QUESTRECORD_CopyBufferToRecord(bResetStates) — 게임에 들어올 때
    this.questRecord = QuestRecord.load(init.questFlags, true);
    this.questResistOther = init.questResistOther ?? 0;
    this.playerName = init.playerName ?? '';
    // 예전 저장(Phase 10 Step 1: 퀘스트 이름 목록) 호환. 근사: 'cain' = A1Q4 보상 받음으로 본다
    if (!init.questFlags) for (const f of init.quests ?? []) this.legacyQuest(f);
    // 원작 퀘스트 전역 시드 (QUESTS_QuestInit: SEED_InitLowSeed(ITEMS_RollRandomNumber(pGameSeed))). 근사: 게임 시드에서 고정 변환
    this.questRng = new Rng((init.seed ^ 0x51e57) >>> 0 || 1);
    // 확장팩 게임은 Act 5 퀘스트까지 (원작 gpQuestInitTable nVersion)
    this.questControl = new QuestControl(this.questHost(), this.expansion ? ACT_QUESTS_LOD : ACT_QUESTS);
    this.quests = this.questControl.get(0) as Act1Quests;
    // 저장된 용병: 게임을 시작하면 플레이어 곁에 (죽은 용병은 기록만 — 부활 대상). 출처: D2GAME_MERCS_Create_6FCC8630
    if (init.merc) {
      this.merc = { ...init.merc, unitId: null };
      if (!init.merc.dead) this.spawnMerc(p.x + 1, p.y + 1);
    }
    // 출처: QUESTS_SequenceCycler — 플레이어가 게임에 들어옴
    this.questControl.startGame();
  }

  get frame(): number {
    return this.tickCount;
  }
  /** 장착 아이템 (store 와 같은 객체) */
  get equipment(): Record<string, ItemInstance> {
    return this.store.equipment as Record<string, ItemInstance>;
  }
  /** 인벤토리 격자 안 아이템 목록 */
  get inventory(): ItemInstance[] {
    return this.store.inventoryItems;
  }
  get map(): CollisionMap {
    return this.level.def.map;
  }
  /** 현재 레벨의 출구 (읽기 전용) */
  get exits(): readonly LevelExit[] {
    return this.level.def.exits;
  }
  get inTown(): boolean {
    return this.level.def.inTown;
  }
  get levelId(): string {
    return this.level.def.id;
  }
  get monsters(): MonsterUnit[] {
    return this.level.monsters;
  }
  private get ground(): GroundItem[] {
    return this.level.ground;
  }
  private get missiles(): Missile[] {
    return this.level.missiles;
  }

  /**
   * 막 레벨 등록 (막 캐시 만들기). 이미 있으면 그대로 돌려준다.
   * 출처: D2MOO DRLG_AllocDrlg — 막마다 DRLG·방 목록을 따로
   */
  addAct(act: number, w: ActLevels): ActState {
    const have = this.acts.get(act);
    if (have) return have;
    const levels = new Map<string, LevelState>();
    for (const d of w.levels) {
      levels.set(d.id, {
        def: d, monsters: [], ground: [], missiles: [], populated: false, npcs: [], objects: [], region: null, variants: new Map(),
        automap: new AutomapReveal(Math.ceil(d.map.width / 5), Math.ceil(d.map.height / 5)),
      });
    }
    const st: ActState = { act, levels, start: { x: w.start.x, y: w.start.y } };
    this.acts.set(act, st);
    return st;
  }

  /** 막이 준비됐는가 (레벨이 등록됨) */
  hasAct(act: number): boolean {
    return this.acts.has(act);
  }

  /** 막 준비: 없으면 onActChange 로 요청 (원작: 막에 처음 들어갈 때 DRLG 할당) */
  private ensureAct(act: number): ActState | null {
    const have = this.acts.get(act);
    if (have) return have;
    const w = this.onActChange?.(act);
    return w ? this.addAct(act, w) : null;
  }

  /** 레벨 id 로 (모든 막에서) 레벨과 막 찾기 */
  private findLevel(id: string): { act: number; level: LevelState } | null {
    const here = this.levels.get(id);
    if (here) return { act: this.act, level: here };
    for (const a of this.acts.values()) {
      const l = a.levels.get(id);
      if (l) return { act: a.act, level: l };
    }
    return null;
  }

  /** 막의 마을 레벨 id */
  townOf(act: number): string | undefined {
    const a = this.acts.get(act);
    if (!a) return undefined;
    for (const l of a.levels.values()) if (l.def.inTown) return l.def.id;
    return undefined;
  }

  /**
   * 막 전환. arrive = 'town' 이면 그 막 마을 시작 위치, 아니면 지정 레벨·위치.
   * 막 월드가 없으면 onActChange 로 요청한다. 성공하면 true.
   * 출처: D2MOO D2GAME_PlayerChangeAct (Warriv·Meshif·Jerhyn·Tyrael 이동, 막 경계 웨이포인트) → 새 막 마을 DUNGEON_FindActSpawnLocation
   */
  changeAct(act: number, arrive: 'town' | { levelId: string; x: number; y: number } = 'town'): boolean {
    const st = this.ensureAct(act);
    if (!st) return false;
    if (arrive === 'town') {
      const town = this.townOf(act);
      if (!town) return false;
      const tl = st.levels.get(town) as LevelState;
      const p = nearestWalkable(tl.def.map, st.start, 10) ?? { x: Math.floor(st.start.x), y: Math.floor(st.start.y) };
      this.changeLevel(town, p.x + 0.5, p.y + 0.5);
    } else {
      if (!st.levels.has(arrive.levelId)) return false;
      this.changeLevel(arrive.levelId, arrive.x, arrive.y);
    }
    return true;
  }

  /** 현재 막을 바꾼다 (레벨 목록만 — 플레이어 이동은 changeLevel) */
  private switchAct(act: number): void {
    if (act === this.act) return;
    const st = this.acts.get(act);
    if (!st) throw new Error(`act ${act} not loaded`);
    const from = this.act;
    // 원작: 막을 옮기면 웨이포인트 패널·대화가 닫히고, 떠난 막 마을 상인 재고는 비운다 (SUNITPROXY_UpdateVendorInventory)
    this.waypointOpen = null;
    this.closeTalk();
    if (this.level.def.inTown) this.npc.leaveTown();
    this.act = act;
    this.levels = st.levels;
    this.events.push({ type: 'actChanged', act, from });
  }

  /** 레벨 전환: 진행 중 행동 취소, 첫 방문이면 몬스터 배치. 다른 막 레벨이면 막도 바꾼다 */
  changeLevel(id: string, x: number, y: number): void {
    if (!this.levels.has(id)) {
      const f = this.findLevel(id);
      if (f) this.switchAct(f.act);
    }
    const next = this.levels.get(id);
    if (!next) throw new Error(`unknown level ${id}`);
    this.exitHold = false;
    this.closeTalk();
    this.cubeOpen = false;
    // 마을에 플레이어가 없으면 상인 재고를 비운다 (출처: SUNITPROXY_UpdateVendorInventory)
    if (this.level.def.inTown && !next.def.inTown) this.npc.leaveTown();
    const oldNo = this.level.def.levelNo ?? 0;
    this.level = next;
    const p = this.player;
    p.x = x;
    p.y = y;
    p.path = [];
    p.action = null;
    p.cast = null;
    if (p.mode !== 'DT' && p.mode !== 'DD' && p.mode !== 'NU') p.mode = 'NU';
    // 소환수는 새 레벨의 플레이어 곁으로 (pettype.txt warp = 1). 뼈벽은 사라진다
    for (let i = this.pets.length - 1; i >= 0; i--) {
      const pet = this.pets[i] as MonsterUnit;
      if (pet.pet?.petType === 'none') {
        this.pets.splice(i, 1);
        continue;
      }
      this.warpPet(pet);
    }
    this.populate(next);
    this.events.push({ type: 'levelChanged', level: id });
    // 출처: QUESTS_ChangeLevel
    if (oldNo !== (next.def.levelNo ?? 0)) this.questControl.changeLevel(oldNo, next.def.levelNo ?? 0);
  }

  /**
   * 사망 후 부활: 죽은 자리에 시체(장착 아이템)를 남기고, 마을에서 생명·마나 가득 찬 상태로 다시 시작.
   * 출처: D2MOO PlrModes.cpp — 부활 시 PLRMODE_DEATH 면 D2GAME_CORPSE_Handler 로 시체 생성
   */
  respawn(levelId: string, x: number, y: number): void {
    const p = this.player;
    if (p.mode === 'DT' || p.mode === 'DD') this.makeCorpse();
    p.mode = 'NU';
    p.modeStart = this.tickCount;
    p.states.clear();
    if (this.character) {
      this.character.life = this.maxLife();
      this.character.mana = this.maxMana();
    }
    this.changeLevel(levelId, x, y);
  }

  /**
   * 현재 막 마을에서 부활 (원작: 죽으면 그 막 마을 시작 위치). 출처: D2GAME_PlayerRespawn → DUNGEON_FindActSpawnLocation(현재 막)
   */
  respawnInTown(): void {
    const st = this.acts.get(this.act);
    const town = this.townOf(this.act);
    if (!st || !town) return;
    const map = (st.levels.get(town) as LevelState).def.map;
    const p = nearestWalkable(map, st.start, 10) ?? { x: Math.floor(st.start.x), y: Math.floor(st.start.y) };
    this.respawn(town, p.x + 0.5, p.y + 0.5);
  }

  /**
   * 시체 만들기: 커서·장착 아이템(bodyloc −1 ~ 12)을 시체로 옮기고, 잃은 경험치의 75% 를 시체에 저장.
   * 이미 시체가 있으면 원작은 여러 개를 두지만(최대 15) 여기서는 이전 시체 아이템을 합친다 (근사).
   * 출처: D2GAME_CORPSE_Handler_6FC7FBD0 — STAT_EXPERIENCE = 75 × expLoss / 100
   */
  /**
   * 무기 바꾸기 (원작 확장팩 W · 인벤토리 I/II 탭): 쓰는 무기 세트를 바꾸고 세트마다 기억한 스킬로.
   * 클래식 캐릭터·죽은 상태·커서에 아이템을 든 상태에서는 하지 않는다.
   * 근사(원작 미확인): 하던 동작은 그대로 두고 다음 동작부터 새 무기, 바꾸는 소리 없음
   */
  swapWeapons(): boolean {
    const c = this.character;
    if (!this.expansion || !c || this.isDead || this.store.cursor) return false;
    this.store.swapWeapons();
    const cur = { left: c.leftSkill, right: c.rightSkill };
    c.leftSkill = this.altSkills.left;
    c.rightSkill = this.altSkills.right;
    this.altSkills = cur;
    this.statsDirty = true;
    this.events.push({ type: 'weaponSwap', set: this.store.weaponSet });
    return true;
  }

  private makeCorpse(): void {
    const p = this.player;
    const items: Partial<Record<string, ItemInstance>> = { ...(this.corpse?.items ?? {}) };
    const st = this.store;
    let extra = 0;
    for (const slot of Object.keys(st.equipment) as (keyof typeof st.equipment)[]) {
      const it = st.equipment[slot];
      if (!it) continue;
      items[items[slot] ? `${slot}#${extra++}` : slot] = it;
      delete st.equipment[slot];
    }
    // 쉬는 무기 세트도 시체에 (alt:rarm / alt:larm)
    for (const s of WEAPON_SLOTS) {
      const it = st.altWeapons[s];
      if (!it) continue;
      items[items[`alt:${s}`] ? `alt:${s}#${extra++}` : `alt:${s}`] = it;
      delete st.altWeapons[s];
    }
    if (st.cursor) {
      items[`cursor#${extra++}`] = st.cursor;
      st.cursor = null;
    }
    this.corpse = { levelId: this.level.def.id, x: p.x, y: p.y, dir: p.dir, items, exp: (this.corpse?.exp ?? 0) + Math.trunc((75 * this.expLoss) / 100) };
    this.expLoss = 0;
    this.statsDirty = true;
  }

  /**
   * 시체 줍기: 시체 아이템을 원래 장착 칸으로 (칸이 차 있으면 인벤토리, 자리가 없으면 땅), 시체 경험치를 되찾는다.
   * 출처: PlrModes.cpp — 시체의 STAT_EXPERIENCE 를 SUNITDMG_AddExperience 로 돌려주고 INVENTORY_FreeCorpse
   */
  takeCorpse(): boolean {
    const cp = this.corpse, p = this.player;
    if (!cp || cp.levelId !== this.level.def.id || this.isDead) return false;
    if (Math.hypot(cp.x - p.x, cp.y - p.y) > 3) return false;
    const st = this.store;
    for (const [key, it] of Object.entries(cp.items)) {
      if (!it) continue;
      const slot = key.split('#')[0] as keyof typeof st.equipment;
      const alt = slot.startsWith('alt:') ? (slot.slice(4) as WeaponSlot) : null;
      if (alt && WEAPON_SLOTS.includes(alt) && !st.altWeapons[alt]) st.altWeapons[alt] = it;
      else if (slot in { head: 1, neck: 1, tors: 1, rarm: 1, larm: 1, rrin: 1, lrin: 1, belt: 1, feet: 1, glov: 1 } && !st.equipment[slot]) st.equipment[slot] = it;
      else if (!st.inv.autoAdd(it)) this.dropItem(it, p.x, p.y);
    }
    if (cp.exp > 0) this.gainExperience(cp.exp);
    this.corpse = null;
    this.statsDirty = true;
    this.events.push({ type: 'corpseTaken' });
    return true;
  }

  get isDead(): boolean {
    return this.player.mode === 'DT' || this.player.mode === 'DD';
  }

  private populate(level: LevelState): void {
    if (level.populated) return;
    level.populated = true;
    const prev = this.level;
    this.level = level;
    // 출처: SUNIT_SpawnPresetUnitsInRoom (프리셋 오브젝트 → 프리셋 몬스터) 뒤 D2GAME_PopulateRoom (무리·보스)
    this.createLevelObjects(level);
    for (const p of level.def.presetMonsters ?? []) this.spawnPreset(p);
    if (level.def.inTown && this.quests.cainInTown()) this.spawnCain();
    if (level.def.inTown) this.refreshTownQuestNpcs(level);
    const leaders: number[] = [];
    level.def.spawns?.forEach((sp, i) => {
      if (sp.boss) {
        const b = this.spawnBoss(sp.typeId, sp.x, sp.y, true);
        leaders[i] = b?.id ?? -1;
        return;
      }
      const leader = sp.leaderIndex === i ? undefined : leaders[sp.leaderIndex];
      const m = this.spawnMonster(sp.typeId, sp.x, sp.y, leader !== undefined && leader >= 0 ? leader : undefined);
      leaders[i] = m.id;
      if (sp.party) this.spawnParty(m);
    });
    this.level = prev;
  }

  private checkExits(): void {
    const p = this.player;
    const inside = (e: LevelExit) => p.x >= e.x && p.x < e.x + e.w && p.y >= e.y && p.y < e.y + e.h;
    // 출구로 넘어온 직후 도착 칸이 상대 출구 안이면, 그 출구를 벗어날 때까지 다시 넘어가지 않는다 (왕복 방지)
    if (this.exitHold) {
      if (this.level.def.exits.some(inside)) return;
      this.exitHold = false;
    }
    for (const e of this.level.def.exits) {
      if (inside(e)) {
        const target = this.levels.get(e.to);
        // 출처: QUESTS_LevelWarpCheck — 퀘스트가 닫은 출구 (Phase 7: 두리엘 방·증오의 억류지·하렘·하수도 계단)
        if (this.questControl.exitBlocked(this.level.def.levelNo ?? 0, target?.def.levelNo ?? -1)) {
          if (!this.exitHold) this.events.push({ type: 'exitBlocked', to: e.to });
          this.exitHold = true;
          return;
        }
        const ty = e.dy !== undefined ? p.y + e.dy : e.toY;
        const tx = e.dx !== undefined ? p.x + e.dx : e.toX;
        const spot = target ? nearestWalkable(target.def.map, { x: tx, y: ty }, 12) : null;
        this.changeLevel(e.to, spot ? spot.x + 0.5 : tx, spot ? spot.y + 0.5 : ty);
        this.exitHold = true;
        return;
      }
    }
  }

  /**
   * 레벨 이동 타일 클릭: LvlWarp 클릭 상자(이동 지점 화면 좌표 기준 픽셀) 안이면 출구 안의 걷기 가능한 칸을 돌려준다.
   * 화면 좌표 = ((x − y)·16, (x + y)·8) (render/iso.ts 와 같은 등각 변환)
   */
  private warpClickTarget(x: number, y: number): { x: number; y: number } | null {
    for (const e of this.level.def.exits) {
      const w = e.warp;
      if (!w) continue;
      const dx = x - w.x, dy = y - w.y;
      const px = (dx - dy) * 16, py = (dx + dy) * 8;
      if (px < w.selectX || px > w.selectX + w.selectDX || py < w.selectY || py > w.selectY + w.selectDY) continue;
      let best: { x: number; y: number } | null = null, bd = Infinity;
      for (let j = e.y; j < e.y + e.h; j++)
        for (let i = e.x; i < e.x + e.w; i++) {
          if (!this.map.walkable(i, j)) continue;
          const d = Math.hypot(i + 0.5 - w.x, j + 0.5 - w.y);
          if (d < bd) { bd = d; best = { x: i + 0.5, y: j + 0.5 }; }
        }
      if (best) return best;
    }
    return null;
  }

  enqueue(cmd: Command): void {
    this.queue.push(cmd);
  }

  tick(): GameEvent[] {
    this.events = [];
    this.populate(this.level);
    for (const cmd of this.queue.splice(0)) this.apply(cmd);
    this.expireStates();
    this.updateAura();
    this.updateItemAuras();
    this.updatePlayer();
    this.checkExits();
    this.updateObjects();
    this.touchWaypoint();
    this.level.automap.revealAround(this.player.x, this.player.y);
    this.updateMonsters();
    this.updateNpcs();
    this.updatePets();
    this.updatePetAuras();
    this.updateThunderStorm();
    this.updateDruidStorms();
    this.updateBladeShield();
    this.updateMissiles();
    this.regen();
    // 출처: QUESTS_QuestUpdater (퀘스트 타이머)
    this.questControl.update();
    // Phase 7: 이번 틱의 게임 사건 (보스 깨어남·큐브 퀘스트 아이템·봉인) 을 퀘스트에 알린다
    this.questControl.gameEvents(this.events);
    this.updateEnvironment();
    this.tickCount++;
    return this.events;
  }

  snapshot(): Readonly<WorldSnapshot> {
    const p = this.player, c = this.character;
    const cp = this.corpse;
    return {
      tick: this.tickCount,
      corpse: cp && cp.levelId === this.level.def.id ? { x: cp.x, y: cp.y, dir: cp.dir, items: Object.values(cp.items).filter((x): x is ItemInstance => !!x) } : null,
      player: {
        id: p.id, x: p.x, y: p.y, mode: p.mode, dir: p.dir, modeTick: this.tickCount - p.modeStart, anim: this.seqAnim(),
        ...(this.shapeType() ? { shape: { typeId: (this.shapeType() as MonsterType).id } } : {}),
        life: c?.life ?? 0, maxLife: this.maxLife(), mana: c?.mana ?? 0, maxMana: this.maxMana(),
        stamina: Math.min(c?.stamina ?? 0, this.maxStamina()), maxStamina: this.maxStamina(), running: p.running,
        level: c?.level ?? 1, experience: c?.experience ?? 0, gold: this.gold,
        states: p.states.names(), leftSkill: c?.leftSkill ?? 0, rightSkill: c?.rightSkill ?? 0,
      },
      // Phase 5: 굴 속·물속에 가만히 있는 몬스터 (hidden + NU) 는 그리지 않는다
      monsters: [...this.monsters.filter((m) => !(m.hidden && m.mode === 'NU')), ...this.pets, ...this.level.npcs].map((m) => {
        const anim = this.monsterSeqAnim(m);
        const ut = this.uniqueTrans(m);
        return {
          id: m.id, typeId: m.type.id, code: m.type.code, x: m.x, y: m.y, mode: m.mode, dir: m.dir, modeTick: this.tickCount - m.modeStart,
          hp: m.hp, maxHp: m.stats.maxHp, states: m.states.names(), ...(m.pet ? { ally: true } : {}),
          ...(m.npc ? { npc: true, interact: m.npc.interact, ...(m.npc.interact && this.questControl.npcHasQuest(m.type.id) ? { quest: true } : {}) } : {}), ...(m.pet?.hireling ? { merc: true } : {}),
          flags: m.flags, umods: [...m.umods], nameSeed: m.nameSeed, ...(m.superUnique !== undefined ? { superUnique: m.superUnique } : {}),
          ...(m.components ? { components: m.components } : {}), ...(ut !== undefined ? { uniqueTrans: ut } : {}), ...(anim ? { anim } : {}),
          ...(m.hidden ? { untargetable: true } : {}),
          ...(m.pet?.shadow ? { shadow: { cls: m.pet.shadow.cls, equipment: m.pet.shadow.equipment } } : {}),
        };
      }),
      items: this.ground.map((g) => ({ id: g.item.id, code: g.item.code, quality: g.item.quality, quantity: g.item.quantity, x: g.x, y: g.y })),
      missiles: [...this.missiles.map((m) => ({ id: m.id, name: m.def.name, x: m.x, y: m.y, dir: dir64(m.dx, m.dy), celFile: m.def.celFile, frame: m.age % m.def.animLen, ...(m.def.trans ? { blend: m.def.trans } : {}) })), ...this.overlaySnapshots()],
      objects: this.level.objects.map((o) => ({
        id: o.id, classId: o.type.id, token: o.type.token, name: o.type.name, x: o.x, y: o.y, mode: o.mode, modeTick: this.tickCount - o.modeStart,
        selectable: !!o.type.selectable[o.mode], subClass: o.type.subClass, ...(o.portal ? { portalTo: o.portal.toLevel } : {}),
      })),
      inventory: [...this.inventory],
      interaction: this.interactionSnapshot(),
      merc: this.mercSnapshot(),
      quests: this.quests.log(),
    };
  }

  /**
   * 상태 오버레이 (states.txt overlay1~4 → data\global\overlays\<Filename>.dcc) 를 미사일 그림 목록에 섞어 보낸다 (celFile 'overlays\…').
   * 근사(원작 미확인): overlay.txt 높이·오프셋·PreDraw(유닛 뒤) 순서·반투명은 반영하지 않고 유닛 발밑 좌표에 프레임 반복
   */
  private overlaySnapshots(): MissileSnapshot[] {
    const table = this.data?.stateOverlays;
    if (!table) return [];
    const out: MissileSnapshot[] = [];
    const add = (uid: number, x: number, y: number, names: string[]) => {
      names.forEach((st, si) => {
        table.get(st)?.forEach((o, k) => {
          out.push({ id: -(uid * 64 + si * 4 + k + 1), name: `overlay:${st}`, x, y, dir: 0, celFile: `overlays\\${o.file}`, frame: this.tickCount % o.frames, ...(o.trans ? { blend: o.trans } : {}) });
        });
      });
    };
    const p = this.player;
    if (p.mode !== 'DD') add(p.id, p.x, p.y, p.states.names());
    // 무술 차지: skills.txt prgoverlay 의 끝 숫자 = 차지 수 (tigerstrike1~3). 근사(원작 미확인): 속성 차지의 클라이언트 그림(cltprgfunc)은 그리지 않는다
    if (p.mode !== 'DD') this.chargeStates().forEach((c, i) => {
      const o = c.s.prgOverlay && c.n > 0 ? this.data?.overlays?.get(c.s.prgOverlay.toLowerCase().replace(/\d+$/, String(Math.min(c.n, MAX_CHARGES)))) : undefined;
      if (o) out.push({ id: -(p.id * 64 + 40 + i + 1), name: `overlay:${c.s.prgOverlay}`, x: p.x, y: p.y, dir: 0, celFile: `overlays\\${o.file}`, frame: this.tickCount % o.frames, ...(o.trans ? { blend: o.trans } : {}) });
    });
    for (const m of [...this.monsters, ...this.pets]) if (m.mode !== 'DD' && m.mode !== 'DT') add(m.id, m.x, m.y, m.states.names());
    return out;
  }

  // ---------------------------------------------------------------- spawning

  /**
   * 몬스터 한 마리 (파티·수식어 없음 — 원작 nFlags 64 스폰). leaderId = 주인(무리 리더).
   * 레이어 외형은 레벨 몬스터 영역의 변형 세트에서 고른다 (출처: MonsterChoose.cpp sub_6FC62020)
   */
  spawnMonster(typeId: string, x: number, y: number, leaderId?: number, opts: { mode?: MonMode } = {}): MonsterUnit {
    if (!this.data) throw new Error('spawnMonster requires game data');
    const type = this.data.monsters.get(typeId);
    const rng = new Rng(Number(this.rng.next() & 0xffffffffn) || 1);
    const stats = rollMonsterStats(this.data.monsters, type, rng);
    const id = this.nextUnitId++;
    const m = this.newMonsterUnit(id, type, stats, rng, x, y);
    m.leaderId = leaderId ?? id;
    m.nextThink = this.tickCount + rng.pick(Math.max(type.aiDelay, 1));
    m.components = this.rollComponents(type);
    m.levelKey = this.level.def.id;
    if (opts.mode && opts.mode !== 'NU') this.startMonsterMode(m, opts.mode);
    this.monsters.push(m);
    return m;
  }

  private newMonsterUnit(id: number, type: MonsterType, stats: MonsterStats, rng: Rng, x: number, y: number): MonsterUnit {
    return {
      id, type, stats, x, y, hp: stats.maxHp, mode: 'NU', dir: 0, path: [], moveSpeed: 0,
      nextThink: this.tickCount + 1, modeStart: this.tickCount, modeEnd: 0, hitTick: -1, hitDone: true,
      rng, aggro: false, aiState: 1, aiParam0: 0, ai: [0, 0, 0], command: 0, leaderId: id, deathFrame: -1, states: new StateList(), corpseUsed: false,
      flags: 0, umods: [], nameSeed: 0, bonus: {}, resist: { ...type.resist }, hpRegen: true, skillsAdded: [], noXp: false, noTc: false, velPct: 0, moveVelPct: 0,
    };
  }

  /**
   * 레이어 외형 변형 (레벨 몬스터 영역마다 최대 3 세트, 첫 세트는 레이어마다 무작위, 나머지는 두 레이어만 바꾼 세트).
   * 출처: MonsterChoose.cpp sub_6FC62020 (nComponentVariants). 근사(원작 미확인): 몬스터가 세트를 고르는 규칙 — 무작위
   */
  private rollComponents(t: MonsterType): Record<string, number> | undefined {
    const layers = Object.entries(t.layers);
    if (!layers.length) return undefined;
    const lv = this.level;
    let sets = lv.variants.get(t.id);
    if (!sets) {
      sets = [];
      const rng = this.rng;
      const first: Record<string, number> = {};
      for (const [k, v] of layers) first[k] = v.length > 1 ? rng.pick(v.length) : 0;
      sets.push(first);
      const multi = layers.filter(([, v]) => v.length > 1).map(([k]) => k);
      if (multi.length) {
        let i1 = multi[0] as string, i2 = i1;
        if (multi.length !== 1) {
          const r = rng.pick(multi.length);
          i1 = multi[r] as string;
          multi[r] = multi[multi.length - 1] as string;
          i2 = multi[rng.pick(multi.length - 1)] as string;
        }
        for (let n2 = 0; n2 < 2; n2++) {
          const d = { ...first };
          let tries = 3, dup = true;
          while (dup && tries) {
            d[i1] = rng.pick(t.layers[i1]?.length ?? 1);
            if (i1 !== i2) d[i2] = rng.pick(t.layers[i2]?.length ?? 1);
            dup = sets.some((s) => layers.every(([k]) => s[k] === d[k]));
            if (dup) tries--;
          }
          sets.push(d);
        }
      }
      lv.variants.set(t.id, sets);
    }
    return { ...(sets[this.rng.pick(sets.length)] as Record<string, number>) };
  }

  /** 주변 빈칸 (원작 D2GAME_SpawnNormalMonster 의 field_20 반경 탐색 근사) */
  private spawnSpot(x: number, y: number, radius: number, t: MonsterType): Pt | null {
    const map = this.map;
    const ok = (px: number, py: number) => map.walkable(px, py) && !this.blockedByUnit({}, px + 0.5, py + 0.5, t.sizeX);
    if (ok(Math.floor(x), Math.floor(y))) return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
    for (let r = 1; r <= radius + 2; r++) {
      for (let k = 0; k < 12; k++) {
        const px = Math.floor(x) + this.rng.pick(2 * r + 1) - r, py = Math.floor(y) + this.rng.pick(2 * r + 1) - r;
        if (ok(px, py)) return { x: px + 0.5, y: py + 0.5 };
      }
    }
    return null;
  }

  /**
   * 파티 (동반 몬스터). 출처: MonsterSpawn.cpp sub_6FC69C00 — PartyMin + rand(PartyMax − PartyMin + 1) 마리,
   * minion1/minion2 번갈아, SetBoss 면 이 몬스터가 주인
   */
  private spawnParty(m: MonsterUnit): MonsterUnit[] {
    const t = m.type, out: MonsterUnit[] = [];
    if (!t.minions.length || !this.data) return out;
    let count = t.partyMin;
    if (count < t.partyMax) count += m.rng.pick(t.partyMax - count + 1);
    const threshold = t.minions.length > 1 ? 1 : 0;
    let idx = 0;
    for (let i = 0; i < count; i++) {
      const id = t.minions[idx] as string;
      idx = idx + 1 > threshold ? 0 : idx + 1;
      if (!this.data.monsters.types.has(id)) continue;
      const spot = this.spawnSpot(m.x, m.y, 4, this.data.monsters.get(id));
      if (!spot) continue;
      out.push(this.spawnMonster(id, spot.x, spot.y, t.setBoss ? m.id : undefined));
    }
    return out;
  }

  private umodCtx(): UModContext | null {
    const d = this.data;
    if (!d?.uniques) return null;
    return { db: d.uniques, monsters: d.monsters, difficulty: this.difficulty, championDmgBonus: this.rules.championDamageBonus };
  }

  private applyUMod(m: MonsterUnit, umod: number, bUnique: boolean): void {
    const ctx = this.umodCtx();
    if (ctx) applyUModInit(ctx, m, umod, bUnique);
  }

  /** 이 보스의 미니언 (살아 있는 것만) */
  minionsOf(boss: MonsterUnit): MonsterUnit[] {
    return this.monsters.filter((o) => o !== boss && o.leaderId === boss.id && (o.flags & MONFLAG.MINION) !== 0);
  }

  /**
   * 미니언 생성 + 수식어 1~4 와 보스 수식어 적용 (보스 = bUnique, 미니언 = !bUnique).
   * 출처: D2GAME_SpawnMinions_6FC6F440 — 챔피언은 미니언 없음, 미니언 종류 = monstats minion1 (없으면 같은 몬스터),
   *       수 = nMin + rand(nMax − nMin + 1), xfer 수식어를 미니언에게 복사
   */
  private spawnMinions(boss: MonsterUnit, spawn: boolean, min: number, max: number): void {
    const data = this.data;
    if (!data) return;
    if (spawn && !(boss.flags & MONFLAG.CHAMPION)) {
      const minionId = boss.type.minions[0] && data.monsters.types.has(boss.type.minions[0]) ? boss.type.minions[0] : boss.type.id;
      const count = rollMinionCount(boss.rng, min, max);
      for (let i = 0; i < count; i++) {
        const spot = this.spawnSpot(boss.x, boss.y, 3, data.monsters.get(minionId));
        if (!spot) continue;
        const mn = this.spawnMonster(minionId, spot.x, spot.y, boss.id);
        if (data.uniques) mn.umods.push(...xferMods(data.uniques, boss.umods).slice(0, 9 - mn.umods.length));
        mn.flags |= MONFLAG.MINION;
      }
    }
    const minions = this.minionsOf(boss);
    for (const u of [UMOD.RNDNAME, UMOD.HPMULTIPLY, UMOD.LIGHT, UMOD.LEVELADD]) {
      this.applyUMod(boss, u, true);
      for (const mn of minions) this.applyUMod(mn, u, false);
    }
    for (const u of boss.umods) {
      this.applyUMod(boss, u, true);
      for (const mn of minions) this.applyUMod(mn, u, false);
    }
  }

  /**
   * 보스 (챔피언 또는 유니크) 생성. 출처: sub_6FC6E8D0 → D2GAME_SpawnMonster_6FC6F220 (UNIQUE|OTHER),
   * sub_6FC6E940 (수식어), D2GAME_SpawnMinions (3~6 미니언), D2GAME_PopulateRoom (챔피언이면 같은 몬스터 1~3 마리 더 챔피언)
   */
  spawnBoss(typeId: string, x: number, y: number, allowChampion = true): MonsterUnit | null {
    const data = this.data;
    if (!data?.uniques || !data.monsters.types.has(typeId)) return null;
    const m = this.spawnMonster(typeId, x, y);
    m.flags |= MONFLAG.UNIQUE | MONFLAG.OTHER;
    const r = data.uniques.rollBossMods(m.type, m.rng, allowChampion, m.umods, this.difficulty);
    m.umods = r.umods;
    if (r.champion) m.flags |= MONFLAG.CHAMPION;
    this.spawnMinions(m, true, 3, 6);
    if (m.flags & MONFLAG.CHAMPION) {
      const extra = m.rng.pick(3) + 1;
      for (let j = 0; j < extra; j++) {
        const spot = this.spawnSpot(m.x, m.y, 4, m.type);
        if (!spot) continue;
        const c = this.spawnMonster(typeId, spot.x, spot.y, m.id);
        this.makeChampion(c);
      }
    }
    return m;
  }

  /**
   * 챔피언 무리 (monplace place_champion). 출처: D2GAME_SpawnPresetMonster_6FC66560 case 3 —
   * 몬스터 (파티 포함) → 챔피언 수식어, rand % 3 + 1 마리 더 (각각 파티 + 챔피언)
   */
  spawnChampionPack(id: string, x: number, y: number): MonsterUnit[] {
    if (!this.data?.monsters.types.has(id)) return [];
    const m = this.spawnMonster(id, x, y);
    this.spawnParty(m);
    this.makeChampion(m);
    const out = [m];
    const extra = (m.rng.roll() >>> 0) % 3 + 1;
    for (let i = 0; i < extra; i++) {
      const spot = this.spawnSpot(m.x, m.y, 4, m.type);
      if (!spot) continue;
      const c = this.spawnMonster(id, spot.x, spot.y, m.id);
      this.spawnParty(c);
      this.makeChampion(c);
      out.push(c);
    }
    return out;
  }

  /** 출처: D2GAME_MONSTERS_Unk_6FC6FFD0 (MONUMOD_CHAMPMODS) — 챔피언으로 만들고 수식어 16 추가 + 1~4 적용 */
  private makeChampion(m: MonsterUnit): void {
    if (m.flags & MONFLAG.CHAMPION) return;
    m.flags |= MONFLAG.UNIQUE | MONFLAG.CHAMPION | MONFLAG.OTHER;
    if (m.umods.length < 9) m.umods.push(UMOD.CHAMPION);
    this.spawnMinions(m, true, 0, 0);
  }

  /** 방 안 무작위 지점 (출처: sub_6FC66260 — 가장자리 1 제외, 20 번, 이동 지점 WarpDist 밖) */
  private roomSpot(room: { x: number; y: number; w: number; h: number }, t: MonsterType): Pt | null {
    const info = this.level.def.monsterInfo;
    for (let i = 0; i < 20; i++) {
      const x = room.x + 1 + this.rng.pick(room.w - 1), y = room.y + 1 + this.rng.pick(room.h - 1);
      if (info?.warpPoints.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < info.warpDist)) continue;
      if (!this.map.walkable(x, y) || this.blockedByUnit({}, x + 0.5, y + 0.5, t.sizeX)) continue;
      return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
  }

  private roomAt(x: number, y: number): { x: number; y: number; w: number; h: number } | undefined {
    return this.level.def.rooms?.find((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
  }

  /** 이번 게임에 이미 나온 슈퍼유니크 (원작 pGame->nBossFlagList) */
  private readonly bossFlags = new Set<number>();
  /** 퀘스트 전역 시드 (원작 QUESTS_GetGlobalSeed) */
  private readonly questRng: Rng;

  /**
   * 슈퍼유니크. 출처: D2GAME_SpawnSuperUnique_6FC6F690 — AutoPos 면 방 안 무작위 지점, 한 게임에 한 번 (Stacks 0),
   * UNIQUE|SUPERUNIQUE, 수식어 = SuperUniques Mod1~3 (Thief 제외), 미니언 MinGrp~MaxGrp, Countess 는 특수 AI, 퀘스트 수식어 22
   */
  /** exact = 자리를 준 쪽이 정했다 (봉인 보스 — 원작 A4Q2 는 보스 자리 오브젝트 131 에 만든다): AutoPos 방 무작위 배치를 쓰지 않는다 */
  spawnSuperUnique(idx: number, x: number, y: number, path?: Pt[], exact = false): MonsterUnit | null {
    const data = this.data;
    const su = data?.uniques?.superUnique(idx);
    if (!data || !su || !data.monsters.types.has(su.cls)) return null;
    if (!su.stacks && this.bossFlags.has(su.idx)) return null;
    const t = data.monsters.get(su.cls);
    let pos: Pt | null = { x: x + 0.5, y: y + 0.5 };
    if (su.autoPos && !exact) {
      const room = this.roomAt(x, y);
      pos = (room && this.roomSpot(room, t)) || this.spawnSpot(x, y, 5, t);
    } else if (!this.map.walkable(x, y)) pos = this.spawnSpot(x, y, 5, t);
    if (!pos) return null;
    const m = this.spawnMonster(su.cls, pos.x, pos.y);
    m.flags |= MONFLAG.UNIQUE | MONFLAG.OTHER | MONFLAG.SUPERUNIQUE;
    m.superUnique = su.idx;
    this.bossFlags.add(su.idx);
    for (const u of su.mods) {
      if (!u) break;
      if (u !== UMOD.THIEF) m.umods.push(u);
    }
    const used = new Set(m.umods);
    for (let i = 0; i < this.difficulty; i++) {
      const u = data.uniques!.pickUniqueMod(t, used, m.rng, this.difficulty);
      if (!u) break;
      m.umods.push(u);
      used.add(u);
    }
    let min = su.minGrp, max = su.maxGrp;
    if (min && max) {
      min += this.difficulty;
      max += this.difficulty;
    }
    this.spawnMinions(m, true, min, max);
    if (su.key === 'The Countess') {
      // 출처: STATES_ToggleState(STATE_CORPSE_NOSELECT), AITHINK_ExecuteAiFn(…, AISPECIALSTATE_COUNTESS)
      m.aiOverride = 'Countess';
      m.corpseUsed = true;
      if (path?.length) m.mapPath = path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    }
    if (su.key === 'Radament') {
      // 출처: D2GAME_SpawnSuperUnique_6FC6F690 (SUPERUNIQUE_RADAMENT) — skeleton5 × (rand % 5 + 2) + 원소 스켈레톤 메이지 4 (sub_6FC68D70, 주인 = Radament)
      const n = (m.rng.roll() >>> 0) % 5 + 2;
      const ids = [...Array<string>(n).fill('skeleton5'), 'skmage_pois3', 'skmage_cold4', 'skmage_fire3', 'skmage_ltng3'];
      for (const id of ids) {
        if (!data.monsters.types.has(id)) continue;
        const spot = this.spawnSpot(m.x, m.y, 4, data.monsters.get(id));
        if (spot) this.spawnMonster(id, spot.x, spot.y, m.id);
      }
    }
    // ---- 확장팩 Act 5 (출처: D2GAME_SpawnSuperUnique_6FC6F690 — sub_6FC6A230(주인, 몬스터, 모드, …, 수) = 주인 곁에 하수인 무리) ----
    const pack = (id: string, n: number) => {
      if (!data.monsters.types.has(id)) return;
      for (let i = 0; i < n; i++) {
        const spot = this.spawnSpot(m.x, m.y, 6, data.monsters.get(id));
        if (spot) this.spawnMonster(id, spot.x, spot.y, m.id);
      }
    };
    if (su.key === 'Siege Boss') {
      // Shenk the Overseer: minion1 × 20, 시체 선택 불가 (STATE_CORPSE_NOSELECT)
      pack('minion1', 20);
      m.corpseUsed = true;
    } else if (su.key === 'Nihlathak Boss') {
      // 하수인 = 레벨 계열 minion (D2Common_11063) × 20
      const info = this.level.def.monsterInfo;
      pack(data.monsters.forLevel('minion1', info?.pool ?? [], info?.monLvlEx ?? 0), 20);
    } else if (su.key === 'Baal Subject 2') pack('skmage_cold3', 10);
    // 출처: D2GAME_BOSSES_AssignUMod_6FC6FF10(…, MONUMOD_QUESTMOD, 1)
    if (m.umods.length < 9) m.umods.push(UMOD.QUESTCOMPLETE);
    return m;
  }

  /**
   * DS1 프리셋 몬스터. 출처: D2GAME_SpawnPresetMonster_6FC66560 — 슈퍼유니크, monstats 몬스터 (파티 포함), monplace:
   * 2 유니크 무리(umon, 챔피언 없음), 3 챔피언(umon + 1~3 챔피언), 5 Blood Raven, 17 Fallen, 18 Fallen Shaman (D2Common_11063 레벨 계열 + 레벨 보정)
   */
  private spawnPreset(p: { id: number; x: number; y: number; path?: (Pt & { action?: number })[]; code?: string; mon?: string }): void {
    const data = this.data, info = this.level.def.monsterInfo;
    if (!data?.uniques) return;
    const npcPath = (): NpcPathNode[] => (p.path ?? []).map((q) => ({ x: q.x + 0.5, y: q.y + 0.5, action: q.action ?? 1 }));
    // 하드코딩 프리셋 (Blood Moor Flavie 'navi' — DRLGPRESET_SpawnHardcodedPresetUnits)
    if (p.code) {
      this.spawnNpc(p.code, p.x, p.y, npcPath());
      return;
    }
    // 마을에는 monsterInfo 가 없다 → 현재 막의 MonPreset (출처: DRLGPRESET_ParseDS1File — MonPreset[레벨의 막][id])
    // 벽 타일이 만든 몬스터 (Act 5 감옥 문·바리케이드 — monstats Id 그대로)
    const k = p.mon ? ({ kind: 'monster', id: p.mon } as const) : data.uniques.preset(info?.act ?? this.act + 1, p.id);
    // 출처: DRLGPRESET_ParseDS1File (ACT_V) — 마을 Nihlathak·고대인 석상 프리셋은 몬스터 대신 오브젝트 (OBJECT_NIHLATHAK_START_IN_TOWN 461,
    //   ANCIENTSTATUE1 → 오브젝트 476, ANCIENTSTATUE2 → 475, ANCIENTSTATUE3 → 474 — 원작 표 그대로 1·2 가 엇갈린다)
    const act5Obj = k.kind === 'monster' && (info?.act ?? this.act + 1) === 5 ? ACT5_PRESET_OBJECTS[k.id] : undefined;
    if (act5Obj !== undefined) {
      this.createObject(this.level, { classId: act5Obj, x: p.x, y: p.y });
      return;
    }
    if (k.kind === 'super') {
      this.spawnSuperUnique(k.idx, p.x, p.y, p.path);
      return;
    }
    const spawnAt = (id: string, withParty = true): MonsterUnit | null => {
      if (!data.monsters.types.has(id)) return null;
      const t = data.monsters.get(id);
      // 마을 프리셋(NPC·Rogue 경비·닭·소)과 말을 걸 수 있는 NPC 는 NPC 유닛으로 (공격 불가)
      if (this.level.def.inTown || (t.npc && t.interact)) return this.spawnNpc(id, p.x, p.y, npcPath());
      // 근사(원작 미확인): 마을 밖 중립 장식 몬스터(Align 2, killable 0)·동물(critter)은 배치하지 않는다
      if (t.critter || t.npc || (t.inTown && !t.killable)) return null;
      const spot = this.map.walkable(p.x, p.y) ? { x: p.x + 0.5, y: p.y + 0.5 } : this.spawnSpot(p.x, p.y, 4, t);
      if (!spot) return null;
      const m = this.spawnMonster(id, spot.x, spot.y);
      if (withParty) this.spawnParty(m);
      return m;
    };
    if (k.kind === 'monster') {
      // ---- 확장팩 Act 5 (출처: D2GAME_SpawnPresetMonster_6FC66560) ----
      let id = k.id;
      const lv = this.level.def.levelNo ?? 0;
      // Bloody Foothills: A5Q1 진행 중이면 catapult2 → catapult3, catapultspotter2 → catapultspotter3
      if (lv === 110 && this.questNotIntro(QW.A5Q1)) {
        if (id === 'catapult2') id = 'catapult3';
        else if (id === 'catapultspotter2') id = 'catapultspotter3';
      }
      // 악몽·지옥 Bloody Foothills 의 minion1·deathmauler1 프리셋은 없다
      if (this.difficulty !== 0 && lv === 110 && (id === 'minion1' || id === 'deathmauler1')) return;
      // 감옥 문 (A5Q2): 왼쪽으로 한 칸, 이미 끝낸 퀘스트면 죽은 채로
      if (id === 'prisondoor') {
        const door = spawnAt(id, false);
        if (door) {
          door.x -= 1;
          if (!this.questNotIntro(QW.A5Q2)) {
            door.hp = 0;
            this.startMonsterMode(door, 'DD');
          }
        }
        return;
      }
      const mon = spawnAt(id);
      // Barricade 문 몬스터는 충돌 오브젝트 (objects.txt 571 / 572) 를 같이 둔다 (monstats2 objCol)
      if (mon && (id === 'barricadedoor1' || id === 'barricadedoor2')) this.createObject(this.level, { classId: id === 'barricadedoor1' ? 571 : 572, x: Math.floor(mon.x), y: Math.floor(mon.y), mode: 0 });
      return;
    }
    if (k.kind !== 'place') return;
    const umon = info?.umon ?? [];
    const levelId = this.level.def.levelNo ?? 0;
    switch (k.place) {
      case 2: {
        if (!umon.length) return;
        const id = umon[this.rng.pick(umon.length)] as string;
        const room = this.roomAt(p.x, p.y);
        const spot = room && data.monsters.types.has(id) ? this.roomSpot(room, data.monsters.get(id)) : null;
        if (spot) this.spawnBoss(id, spot.x, spot.y, false);
        return;
      }
      case 3: {
        if (!umon.length) return;
        const id = umon[this.rng.pick(umon.length)] as string;
        const t = data.monsters.types.get(id);
        if (!t) return;
        const spot = this.map.walkable(p.x, p.y) ? { x: p.x + 0.5, y: p.y + 0.5 } : this.spawnSpot(p.x, p.y, 4, t);
        if (spot) this.spawnChampionPack(id, spot.x, spot.y);
        return;
      }
      case 5:
        spawnAt('bloodraven');
        return;
      // ---- Phase 5 ---- 출처: D2GAME_SpawnPresetMonster_6FC66560
      case 8:
        // place_tightspotboss: Maggot Queen (nFlags 8)
        spawnAt('maggotqueen1', false);
        return;
      case 10:
      case 11: {
        // place_tentacle_ns/ew: Water Watcher Head 계열 (monstats 261 기준) — Spider Forest·Great Marsh·Flayer Jungle +1, Kurast 하수도 +2
        const inc = levelId >= 76 && levelId <= 78 ? 1 : levelId === 92 || levelId === 93 ? 2 : 0;
        let id = 'tentaclehead1';
        for (let i = 0; i < inc; i++) id = data.monsters.types.get(id)?.nextInClass || id;
        spawnAt(id);
        return;
      }
      case 22:
      case 23: {
        // place_fetish / place_fetishshaman: D2Common_11063 레벨 계열
        spawnAt(data.monsters.forLevel(k.place === 22 ? 'fetish1' : 'fetishshaman1', info?.pool ?? [], info?.monLvlEx ?? 0));
        return;
      }
      // ---- 확장팩 Act 5: 죽은 채로 놓인 시체 (29 minion, 30 Bloody Foothills death mauler / 그 밖 imp, 31 바바리안, 32 Prowling Dead). 25·27·28 은 없음
      case 29:
      case 30:
      case 31:
      case 32: {
        const raw = k.place === 29 ? 'minion1' : k.place === 30 ? (levelId === 110 ? 'deathmauler1' : 'imp1') : k.place === 31 ? 'act5barb1' : 'reanimatedhorde3';
        const id = data.monsters.forLevel(raw, info?.pool ?? [], info?.monLvlEx ?? 0);
        const corpse = spawnAt(id, false);
        if (!corpse) return;
        corpse.hp = 0;
        this.startMonsterMode(corpse, 'DD');
        corpse.deathFrame = this.tickCount;
        // 출처: EVENT_SetEvent(EVENTTYPE_MONUMOD, +250~299) — Prowling Dead 시체는 잠시 뒤 일어난다 (Self-resurrect)
        // 근사(원작 미확인): MONUMOD 이벤트 처리 = Self-resurrect (원작 이벤트 함수 미확인)
        if (raw === 'reanimatedhorde3') corpse.riseAt = this.tickCount + 250 + ((corpse.rng.roll() >>> 0) % 50);
        return;
      }
      case 17:
      case 18: {
        let id = data.monsters.forLevel(k.place === 17 ? 'fallen1' : 'fallenshaman1', info?.pool ?? [], info?.monLvlEx ?? 0);
        const base = data.monsters.types.get(id)?.baseId;
        // 출처: 같은 함수 — Black Marsh / Tamoe / Pit 레벨 보정 (LevelsIds: 6 Black Marsh, 7 Tamoe, 12/16 Pit)
        if (base === 'fallen1') {
          if (levelId === 6) id = 'fallen2';
          else if (levelId === 7 || levelId === 12 || levelId === 16) id = 'fallen3';
        } else if (base === 'fallenshaman1') {
          if (levelId === 6 || levelId === 7) id = 'fallenshaman2';
          else if (levelId === 12 || levelId === 16) id = 'fallenshaman3';
        }
        spawnAt(id);
        return;
      }
      default:
        return;
    }
  }

  /**
   * 출처: QUESTS_CheckNotIntroQuest — 그 퀘스트가 이번 게임에서 진행 중 (원작 bNotIntro, 퀘스트 데이터가 없으면 1).
   * 퀘스트 기록 워드로 막 모듈을 찾는다
   */
  private questNotIntro(word: number): boolean {
    const mod = this.questControl.get(questOfWord(word).act) as unknown as { stateOf?(w: number): { notIntro: boolean } } | undefined;
    return mod?.stateOf?.(word)?.notIntro ?? true;
  }

  /** 경험치 얻기 (레벨업 이벤트 포함) */
  private gainExperience(exp: number): void {
    const c = this.character, cs = this.classStats, table = this.expTable;
    if (!c || !cs || !table) return;
    const gained = addExperience(c, cs, table, exp);
    this.events.push({ type: 'experience', amount: exp });
    if (gained > 0) {
      this.passiveCache = null;
      // 출처: D2MOO PlayerStats.cpp PLAYERSTATS_LevelUp — 생명(살아 있으면)·마나·스태미나를 최대치로
      if (c.life > 0) c.life = this.maxLife();
      c.mana = this.maxMana();
      c.stamina = this.maxStamina();
      const t = this.talking();
      const refreshed = this.npc.levelUp(t && (this.talk?.mode === 'trade' || this.talk?.mode === 'gamble') ? t.type.id : undefined);
      this.events.push({ type: 'levelUp', level: c.level });
      this.procItemSkills('item_skillonlevelup', undefined, this.player);
      if (refreshed.length) this.events.push({ type: 'storeRefresh', npcs: refreshed });
    }
  }

  // ---- [UI Phase 12 Step 2] 골드 옮기기 (원작 금화 창)
  /** 보관함 금화 한도. 근사(원작 미확인): 클래식 규칙으로 알려진 (레벨 ÷ 10 + 1) × 50000 */
  stashGoldMax(): number {
    return (Math.floor((this.character?.level ?? 1) / 10) + 1) * 50000;
  }

  /** 소지 금화 한도 = 레벨 × 10000 (출처: The Arreat Summit — Gold) */
  goldMax(): number {
    return (this.character?.level ?? 1) * 10000;
  }

  /** 바닥 아이템 (UI 이름표·Alt 이름 표시용, 읽기 전용) */
  groundItemById(id: number): Readonly<ItemInstance> | undefined {
    return this.ground.find((g) => g.item.id === id)?.item;
  }

  private goldTransfer(to: 'stash' | 'inventory' | 'ground', amount: number): void {
    const n = Math.max(0, Math.floor(amount));
    if (!n) return;
    if (to === 'stash') {
      const take = Math.min(n, this.gold, Math.max(0, this.stashGoldMax() - this.stashGold));
      this.gold -= take;
      this.stashGold += take;
    } else if (to === 'inventory') {
      const take = Math.min(n, this.stashGold, Math.max(0, this.goldMax() - this.gold));
      this.stashGold -= take;
      this.gold += take;
    } else {
      const take = Math.min(n, this.gold);
      if (!take) return;
      this.gold -= take;
      this.dropGold(take, this.player.x, this.player.y);
    }
  }
  // ---- [UI Phase 12 Step 2] 끝

  /** 골드 더미 떨어뜨리기 */
  private dropGold(amount: number, x: number, y: number): void {
    const b = this.data?.items.base('gld');
    if (!b || !this.data) return;
    const it = this.data.treasure.createItem(b, 1, this.rng, QUALITY.NORMAL);
    it.quantity = amount;
    this.dropItem(it, x, y);
  }

  dropItem(item: ItemInstance, x: number, y: number): void {
    const spot = nearestWalkable(this.map, { x, y }, 6) ?? { x: Math.floor(x), y: Math.floor(y) };
    this.ground.push({ item, x: spot.x + 0.5, y: spot.y + 0.5 });
  }

  // ---------------------------------------------------------------- commands

  private apply(cmd: Command): void {
    const p = this.player, c = this.character;
    if (p.mode === 'DT' || p.mode === 'DD') return;
    switch (cmd.type) {
      case 'move': {
        if (this.isBusy()) return;
        p.action = null;
        this.closeTalk();
        const warp = this.warpClickTarget(cmd.x, cmd.y);
        this.pathPlayerTo(warp ? warp.x : cmd.x, warp ? warp.y : cmd.y, cmd.run);
        return;
      }
      case 'attack': {
        const m = this.monsters.find((x) => x.id === cmd.targetId && x.mode !== 'DT' && x.mode !== 'DD');
        if (!m) return;
        this.closeTalk();
        // 원작: 몬스터 왼쪽 클릭 = 왼쪽 스킬 (기본 Attack). 누르고 있는 동안 반복
        p.action = { kind: 'skill', skillId: c?.leftSkill ?? SKILL_ATTACK, targetId: m.id, x: m.x, y: m.y, standStill: cmd.standStill, repeat: true };
        return;
      }
      case 'useSkill': {
        // 반복 스킬(Inferno)을 쓰는 중에 같은 스킬 명령이 다시 오면 = 버튼을 누르고 있음 → 방향만 갱신
        if (p.cast?.skill.repeat && p.cast.skill.id === cmd.skill) {
          p.holdUntil = this.tickCount + 8;
          p.cast.tx = cmd.x;
          p.cast.ty = cmd.y;
          p.cast.targetId = cmd.targetId;
          return;
        }
        p.holdUntil = this.tickCount + 8;
        p.action = { kind: 'skill', skillId: cmd.skill, targetId: cmd.targetId, targetItem: cmd.targetItem, x: cmd.x, y: cmd.y, standStill: true, repeat: false };
        return;
      }
      case 'pickup': {
        if (!this.ground.some((g) => g.item.id === cmd.itemId)) return;
        p.action = { kind: 'pickup', itemId: cmd.itemId };
        return;
      }
      case 'takeCorpse': {
        if (this.corpse?.levelId === this.level.def.id) p.action = { kind: 'corpse' };
        return;
      }
      case 'spendStat': {
        if (c && this.classStats && spendStat(c, this.classStats, cmd.stat)) this.events.push({ type: 'statSpent', stat: cmd.stat });
        return;
      }
      case 'spendSkill': {
        const s = this.data?.skills?.byId.get(cmd.skill);
        if (c && s && this.data?.skills && learnSkill(c, s, this.data.skills)) {
          this.passiveCache = null;
          this.events.push({ type: 'skillLearned', skill: s.id, level: c.skills[s.id] });
        }
        return;
      }
      case 'moveItem': {
        if (!c) return;
        const found = this.store.find(cmd.itemId);
        if (!found) return;
        // 큐브 칸은 큐브 창이 열렸을 때만 (원작 클라이언트 큐브 UI)
        if (cmd.to.kind === 'cube' && !this.cubeOpen) return;
        const r = this.store.move(cmd.itemId, cmd.to, { cls: c.cls, level: c.level, str: this.effStat('str'), dex: this.effStat('dex') });
        if (!r.ok) {
          this.events.push({ type: 'itemMoveFailed', itemId: cmd.itemId, reason: r.reason });
          return;
        }
        if (cmd.to.kind === 'ground') {
          this.dropItem(found.item, p.x, p.y);
          // 출처: QUESTS_ItemDropped (Phase 7 퀘스트 아이템)
          this.questControl.itemDropped(found.item.code);
        }
        if (cmd.to.kind === 'socket') {
          // 박힌 보석·룬은 대상 종류에 맞는 속성(gems.txt), 주얼은 자기 매직·레어 속성 그대로 (출처: D2MOO ItemMode.cpp 소켓 처리)
          const target = this.store.find(cmd.to.itemId);
          const tb = target ? this.data?.items.base(target.item.code) : undefined;
          const gb = this.data?.items.base(found.item.code);
          const gen = this.data?.treasure.gen;
          if (tb && gb && gen && !this.data!.items.isType(gb, 'jewl')) found.item.stats = gemStats(gen, found.item, tb);
          // 마지막 소켓을 채우면 룬워드 완성 (확장팩 캐릭터만) — T1 속성을 한 번 굴려 아이템 자체 속성으로 (출처: ITEMMODS_UpdateRuneword)
          const rw = target && tb && gen && this.data?.expansion ? this.data.runewords?.match(this.data.items, target.item) : null;
          if (rw && target && tb && gen) {
            target.item.runeword = rw.idx;
            target.item.runewordBase = { stats: structuredClone(target.item.stats), defense: target.item.defense };
            gen.assignMods(target.item, tb, rw.mods, this.rng);
            this.events.push({ type: 'runeword', itemId: target.item.id, runeword: rw.idx });
          }
          this.statsDirty = true;
        }
        if (found.where.kind === 'equip' || cmd.to.kind === 'equip') this.statsDirty = true;
        this.events.push({ type: 'itemMoved', itemId: cmd.itemId, to: cmd.to.kind });
        return;
      }
      case 'useBelt': {
        const it = this.store.belt[cmd.slot];
        if (it) this.useItem(it.id);
        return;
      }
      case 'useItem': {
        this.useItem(cmd.itemId, cmd.targetId);
        return;
      }
      case 'interact': {
        if (this.isBusy()) return;
        const n = this.level.npcs.find((x) => x.id === cmd.unitId && x.npc?.interact);
        if (n) {
          this.closeTalk();
          p.action = { kind: 'npc', id: n.id };
          p.repathAt = 0;
          return;
        }
        const o = this.level.objects.find((x) => x.id === cmd.unitId);
        if (!o) return;
        p.action = { kind: 'object', id: o.id };
        p.repathAt = 0;
        return;
      }
      case 'npcMenu': {
        this.npcMenu(cmd.option);
        return;
      }
      case 'buy': {
        const t = this.talking();
        if (t && (this.talk?.mode === 'trade' || this.talk?.mode === 'gamble')) this.npc.buy(this.tradeHost(), t.type.id, cmd.itemId, { multi: cmd.multi, toInventory: cmd.toInventory });
        return;
      }
      case 'sell': {
        const t = this.talking();
        if (t && this.talk?.mode === 'trade') this.npc.sell(this.tradeHost(), t.type.id, cmd.itemId);
        return;
      }
      case 'repair': {
        const t = this.talking();
        if (t && this.talk?.mode === 'trade') this.npc.repair(this.tradeHost(), t.type.id, cmd.itemId);
        return;
      }
      case 'hire': {
        const t = this.talking();
        if (!t || this.talk?.mode !== 'hire') return;
        const r = this.npc.hire(this.tradeHost(), t.type.id, cmd.index);
        if (r) this.hireMerc(r.entry.name, r.entry.seed, r.init.id, r.init.level, r.init.experience, t.x, t.y);
        return;
      }
      case 'mercItem': {
        this.mercItem(cmd.slot);
        return;
      }
      case 'mercPotion': {
        this.mercPotion(cmd.itemId);
        return;
      }
      case 'closeNpc': {
        this.closeTalk();
        return;
      }
      case 'openCube': {
        const box = this.store.allItems().find((it) => it.code === 'box');
        if (box) this.openCube(box.id);
        return;
      }
      case 'transmute': {
        this.transmuteCube();
        return;
      }
      case 'closeCube': {
        if (this.cubeOpen) this.events.push({ type: 'cubeClosed' });
        this.cubeOpen = false;
        return;
      }
      case 'travelAct': {
        // 막 월드를 읽은 뒤 다시 보내는 막 이동 (조건은 travelAct 가 다시 본다)
        this.travelAct(cmd.act);
        return;
      }
      case 'imbue': {
        // 아이템 하나를 맡기는 NPC 창 (담금질·소켓·이름 새기기)
        if (this.talk?.mode === 'socket') this.socketItem(cmd.itemId);
        else if (this.talk?.mode === 'personalize') this.personalizeItem(cmd.itemId);
        else this.imbue(cmd.itemId);
        return;
      }
      case 'waypoint': {
        this.travelWaypoint(cmd.level);
        return;
      }
      // ---- [UI Phase 12 Step 2] 골드 옮기기 — 한도: 소지 = 레벨 × 10000, 보관함 = stashGoldMax()
      case 'goldTransfer': {
        this.goldTransfer(cmd.to, cmd.amount);
        return;
      }
      // ---- [UI Phase 12 Step 2] 끝
      case 'setSkill': {
        const s = this.data?.skills?.byId.get(cmd.skill);
        if (!c || !s || !this.canSelectSkill(s, cmd.hand, cmd.charge)) return;
        if (cmd.hand === 'left') c.leftSkill = s.id;
        else c.rightSkill = s.id;
        // 충전 스킬로 고르면 그 아이템 충전을 쓰고, 일반 스킬로 고르면 충전 연결을 푼다
        if (cmd.charge) {
          const e = this.equippedCharges().find((x) => x.skill === s.id && x.cur > 0);
          if (e) (c.chargeSkills ??= {})[s.id] = e.item.id;
        } else if (c.chargeSkills) delete c.chargeSkills[s.id];
        return;
      }
      // 원작: 스킬 고르기 목록에서 아이콘을 가리키고 단축키 → 그 손의 단축키. 한 스킬(같은 손)에는 키 하나
      case 'setHotkey': {
        const s = this.data?.skills?.byId.get(cmd.skill);
        if (!c || !s || !this.canSelectSkill(s, cmd.hand, cmd.charge) || !Number.isInteger(cmd.slot) || cmd.slot < 0 || cmd.slot >= HOTKEY_SLOTS) return;
        const hk = (c.hotkeys ??= Array<SkillHotkey | null>(HOTKEY_SLOTS).fill(null));
        for (let i = 0; i < HOTKEY_SLOTS; i++) if (hk[i]?.skill === s.id && hk[i]?.hand === cmd.hand && !!hk[i]?.charge === !!cmd.charge) hk[i] = null;
        hk[cmd.slot] = { skill: s.id, hand: cmd.hand, ...(cmd.charge ? { charge: true } : {}) };
        return;
      }
      default:
        this.events.push({ type: 'unhandledCommand', command: cmd.type });
    }
  }

  /** 버튼에 올릴 수 있는 스킬: 배운 액티브 스킬 또는 일반 스킬(Attack, Throw). 왼쪽은 leftskill 플래그 필요. charge = 충전이 남은 아이템 충전 스킬 */
  canSelectSkill(s: SkillRecord, hand: 'left' | 'right', charge = false): boolean {
    if (s.passive) return false;
    if (hand === 'left' && !s.leftSkill) return false;
    if (charge) return this.equippedCharges().some((e) => e.skill === s.id && e.cur > 0);
    if (s.id === SKILL_ATTACK || s.id === SKILL_THROW) return true;
    return this.effectiveSkillLevel(s.id) > 0;
  }

  /**
   * 장착한 아이템(지금 무기 세트)의 충전 스킬: layer = 스킬 << 6 | 레벨, 값 = 최대 << 8 | 현재.
   * 출처: D2MOO D2Common_10954 (충전 스킬을 아이템 GUID 와 함께 추가), sub_6FDB1070 (아이템이 몸에 있고 충전 > 0)
   */
  equippedCharges(): { item: ItemInstance; stat: ItemInstance['stats'][number]; skill: number; lvl: number; cur: number; max: number }[] {
    const items = this.data?.items;
    const out: { item: ItemInstance; stat: ItemInstance['stats'][number]; skill: number; lvl: number; cur: number; max: number }[] = [];
    for (const it of Object.values(this.equipment)) {
      if (!it.identified || (items && isBroken(it))) continue;
      for (const st of it.stats) if (st.stat === 'item_charged_skill') out.push({ item: it, stat: st, skill: st.param >> 6, lvl: st.param & 63, cur: st.value & 0xff, max: (st.value >> 8) & 0xff });
    }
    return out;
  }

  /** 이 스킬을 충전으로 쓰는 중이면 그 충전 (연결된 아이템을 벗었으면 연결을 푼다) */
  private activeCharge(skillId: number): { stat: ItemInstance['stats'][number]; lvl: number; cur: number } | null {
    const c = this.character;
    const bound = c?.chargeSkills?.[skillId];
    if (!c || bound === undefined) return null;
    const list = this.equippedCharges().filter((e) => e.skill === skillId);
    if (!list.length) {
      delete c.chargeSkills![skillId];
      return null;
    }
    return list.find((e) => e.item.id === bound && e.cur > 0) ?? list.find((e) => e.cur > 0) ?? list[0]!;
  }

  /** 스킬 고르기 목록의 아이템 줄: 다른 직업 스킬(oskill) · 충전 스킬 (원작 스킬 목록 맨 위 줄) */
  itemSkillEntries(): { skill: number; charge: boolean; cur?: number; max?: number }[] {
    const c = this.character, db = this.data?.skills;
    if (!c || !db) return [];
    const out: { skill: number; charge: boolean; cur?: number; max?: number }[] = [];
    for (const [id] of this.itemSkills().nonclass) {
      const s = db.byId.get(id);
      if (s && s.charclass !== CLASS_CODE[c.cls] && this.effectiveSkillLevel(id) > 0) out.push({ skill: id, charge: false });
    }
    for (const e of this.equippedCharges()) out.push({ skill: e.skill, charge: true, cur: e.cur, max: e.max });
    return out;
  }

  private isBusy(): boolean {
    const p = this.player;
    return p.cast !== null || ((p.mode === 'GH' || p.mode === 'BL') && this.tickCount < p.modeEnd);
  }

  private pathPlayerTo(x: number, y: number, run: boolean): boolean {
    const p = this.player;
    const target = nearestWalkable(this.map, { x, y });
    const goal = target ? { x: target.x + 0.5, y: target.y + 0.5 } : null;
    // 살아있는 몬스터가 차지한 칸을 피해 돌아간다 (길이 없으면 지형만 보고 탐색)
    const path = goal ? (findPath(this.unitAwareMap(), p, goal, 6000) ?? findPath(this.map, p, goal)) : null;
    if (!path) {
      this.events.push({ type: 'moveBlocked' });
      return false;
    }
    p.path = path;
    // 출처: PlrModes.cpp sub_6FC7F600 — 스태미나가 0 이면 달리기 대신 걷기
    p.running = run && !(this.character && this.character.stamina <= 0);
    return true;
  }

  /**
   * 유닛 점유를 덧씌운 이동 맵: 살아있는 몬스터 중심에서 (몬스터 크기 + 플레이어 크기)/2 − 0.25 안의 칸은 막힘 (blockedByUnit 과 같은 기준).
   * 근사(원작 미확인): 원작은 유닛 충돌 패턴을 충돌 맵에 직접 기록한다 (COLLISION_SetMaskWithPattern).
   */
  private unitAwareMap(): WalkMap {
    const map = this.map, p = this.player;
    const occ = new Set<number>();
    for (const m of this.monsters) {
      if (m.mode === 'DT' || m.mode === 'DD') continue;
      const r = (m.type.sizeX + PLAYER_SIZE) / 2 - 0.25;
      for (let y = Math.floor(m.y - r); y <= Math.floor(m.y + r); y++)
        for (let x = Math.floor(m.x - r); x <= Math.floor(m.x + r); x++) if (Math.hypot(x + 0.5 - m.x, y + 0.5 - m.y) < r) occ.add(y * map.width + x);
    }
    occ.delete(Math.floor(p.y) * map.width + Math.floor(p.x));
    return { width: map.width, height: map.height, walkable: (x, y) => map.walkable(x, y) && !occ.has(y * map.width + x) };
  }

  // ---------------------------------------------------------------- player stats

  private weaponItem(): ItemInstance | undefined {
    return this.equipment.rarm;
  }
  private weaponBase(): ItemBase | undefined {
    const w = this.weaponItem();
    return w ? this.data?.items.base(w.code) : undefined;
  }

  private weaponWclass(): string {
    return this.data ? playerWclass(this.data.items, this.equipment) : (this.weaponBase()?.wclass || 'hth').toUpperCase();
  }

  private playerToken(): string {
    return this.character ? CLASS_TOKEN[this.character.cls] : 'BA';
  }

  /** 변신 상태 (states.txt transform — wolf·bear) */
  shapeState(): string | undefined {
    const info = this.data?.stateInfo;
    if (!info) return undefined;
    for (const st of this.player.states.names()) if (info.get(st)?.transform) return st;
    return undefined;
  }

  /** 변신해 그릴 몬스터: states.txt gfxtype 1 → gfxclass = monstats hcIdx. 출처: D2COMMON_11013_ConvertMode */
  private shapeType(): MonsterType | undefined {
    const st = this.shapeState(), info = st ? this.data?.stateInfo?.get(st) : undefined;
    if (!info || info.gfxType !== 1 || !this.data) return undefined;
    for (const t of this.data.monsters.types.values()) if (t.hcIdx === info.gfxClass) return t;
    return undefined;
  }

  /** 변신 제한 상태 (states.txt restrict — 늑대·곰) 가 걸려 있나 */
  private shapeRestricted(): boolean {
    const info = this.data?.stateInfo;
    return !!info && this.player.states.names().some((st) => info.get(st)?.restrict);
  }

  /**
   * 애니메이션 토큰·모드·무기 클래스: 변신 중이면 몬스터 COF (모드는 원작 표로 바꾸고 없으면 대체, 무기 클래스 = monstats2 BaseW).
   * 출처: D2COMMON_11013_ConvertMode / D2Common_11014_ConvertShapeShiftedMode
   * 근사(원작 미확인): 변신 공격 속도는 원작 wereform 공식 대신 몬스터 AnimData 속도 × 공격 속도 %
   */
  private animLook(mode: string, wclass: string = this.weaponWclass()): { token: string; mode: string; wclass: string } {
    const t = this.shapeType();
    if (!t) return { token: this.playerToken(), mode, wclass };
    return { token: t.code, mode: shapeMode(mode, (m) => t.modes.has(m as MonMode)), wclass: t.baseW };
  }

  /**
   * 스킬 공식의 사용자: 유효 레벨 = effectiveSkillLevel (하드 + 아이템 +스킬 + Battle Command item_allskills + 스킬 신전),
   * 원소 마스터리 = passive_<원소>_mastery (Fire/Lightning Mastery). 출처: SUNITDMG_FillDamageValues (STAT_PASSIVE_FIRE_MASTERY …)
   */
  private owner(): SkillOwner {
    const c = this.character;
    if (!c) return { baseLevel: () => 0, skillLevel: () => 0, unitLevel: 1 };
    const base = characterOwner(c);
    const MASTERY: Record<string, string> = { fire: 'passive_fire_mastery', ltng: 'passive_ltng_mastery', cold: 'passive_cold_mastery', pois: 'passive_pois_mastery', mag: 'passive_mag_mastery' };
    return {
      ...base,
      skillLevel: (id) => this.effectiveSkillLevel(id),
      mastery: (eType) => (MASTERY[eType] ? passiveStat(this.passives(), MASTERY[eType] as string) : 0),
    };
  }

  /** 스킬 툴팁용 SkillOwner (유효 레벨·마스터리 — 게임 공식과 같은 값) */
  skillOwner(): SkillOwner {
    return this.owner();
  }

  /**
   * 유효 스킬 레벨 = 하드 포인트 + 아이템(+모든/직업/탭/개별 스킬) + 스킬 신전·Battle Command.
   * 하드 포인트가 0 이면 개별 스킬 아이템 보너스가 있을 때만 (원작: 개별 스킬 아이템은 배우지 않은 스킬도 쓰게 해 준다).
   * 출처: D2MOO SKILLS_GetSkillLevel. 스킬 트리 숫자·배우기 조건·시너지(blvl) 는 하드 포인트 그대로
   */
  effectiveSkillLevel(id: number): number {
    const c = this.character, s = this.skillRecord(id);
    if (!c || !s) return 0;
    if (s.id <= 5) return 1;
    const hard = c.skills[id] ?? 0;
    const { total, single, oskill } = skillBonusOf(this.itemSkills(), s, CLASS_CODE[c.cls]);
    // 다른 직업 스킬(oskill)이 있으면 배우지 않아도 쓸 수 있다 (출처: ItemMode.cpp:167 — SKILLS_AddSkill 기본 레벨 0)
    return hard > 0 || single > 0 || oskill > 0 ? hard + total + this.allSkillsBonus() : 0;
  }

  private itemSkills(): ItemSkillBonus {
    this.derived();
    return this.itemSkillCache ?? { all: 0, cls: new Map(), tab: new Map(), single: new Map(), elem: new Map(), nonclass: new Map() };
  }

  /** 전체 스킬 +: 스킬 신전(allskills) + Battle Command(item_allskills). 출처: itemstatcost.txt item_allskills */
  private allSkillsBonus(): number {
    return this.player.states.stat('allskills') + this.player.states.stat('item_allskills');
  }

  private passives(): PassiveStat[] {
    const c = this.character, db = this.data?.skills, calc = this.data?.skillCalc;
    if (!c || !db || !calc) return [];
    const aura = this.aura?.skill.id ?? -1;
    this.derived();
    const key = JSON.stringify(c.skills) + c.level + ':' + aura + ':' + this.itemSkillVersion + ':' + this.allSkillsBonus();
    if (this.passiveCache?.key !== key) this.passiveCache = { key, list: passiveStats(c, db, calc, aura, this.owner()) };
    return this.passiveCache.list;
  }

  /** 플레이어 스탯 = 패시브 스킬 + 상태(버프) */
  private playerStat(stat: string): number {
    return passiveStat(this.passives(), stat) + this.player.states.stat(stat);
  }

  /**
   * 파생 스탯 (기본 + 장착). 장착·레벨·스탯 포인트가 바뀌면 다시 계산.
   */
  /**
   * 막별 낮·밤 (출처: GAME_UpdateEnvironment — 게임 프레임마다 만들어진 막의 시간, 플레이어가 있는 막은 밝기까지).
   * 오염된 태양(A2Q3)은 Act 2 환경의 일식 (출처: ENVIRONMENT_TaintedSunBegin/End)
   */
  private updateEnvironment(): void {
    const env = (this.envs[this.act] ??= new Environment());
    const sun = !!this.questControl.taintedSun;
    const a2 = this.envs[1];
    if (a2 && a2.eclipse !== sun) {
      if (sun) a2.taintedSunBegin();
      else a2.taintedSunEnd();
    }
    this.envs.forEach((e, i) => {
      if (e && e !== env) e.tick(i);
    });
    env.update(this.level.def.levelNo ?? 0, this.act);
  }

  /** 지금 막의 낮·밤: 밝기 0~255, 시기 (PERIOD) */
  environment(): { intensity: number; period: number } {
    const e = this.envs[this.act];
    return e ? { intensity: e.intensity, period: e.period } : { intensity: 128, period: PERIOD.DAY };
  }

  /** 디버그·테스트: 지금 막 환경 */
  envOf(act = this.act): Environment {
    return (this.envs[act] ??= new Environment());
  }

  /** 아이템 빛 반경 보너스 (ItemStatCost item_lightradius — 장착 아이템 합) */
  lightRadiusBonus(): number {
    return this.derived()?.stat('item_lightradius') ?? 0;
  }

  /**
   * A5Q3 저항 두루마리: 난이도마다 CUSTOM3 이면 +10 (불·번개·냉기·독). 출처: ACT5Q3_ApplyResistanceReward (게임 입장 — Clients.cpp,
   *   두루마리 읽기 — ItemMode.cpp), ACT5Q3_UpdateResistances. 다른 난이도 기록은 GameInit.questResistOther (지금 난이도는 지금 기록)
   */
  questResist(): number {
    return 10 * (this.questResistOther + (this.questRecord.get(QW.A5Q3, QFLAG.CUSTOM3) ? 1 : 0));
  }

  derived(): Derived | null {
    const c = this.character, cs = this.classStats, data = this.data;
    if (!c || !cs || !data) return null;
    // 확장팩: 인벤토리 참도 능력치에 (참이 들어오고 나가면 key 가 바뀐다)
    const charms = data.expansion ? usableCharms(this.store.inventoryItems, data.items, c.level) : [];
    // 시간대 속성(op 6)은 15도 단위로 바뀐다 (출처: ITEMMODS_GetByTimeAdjustment 반올림)
    const env = this.envs[this.act];
    const baseTime = env && env.rate ? Math.trunc(env.ticks / env.rate) : 0;
    const qres = this.questResist();
    const key = `${c.level}:${c.str}:${c.dex}:${c.vit}:${c.ene}:${c.maxLife}:${c.maxMana}:${charms.map((x) => x.id).join(',')}:${Math.trunc(baseTime / 15)}:${qres}`;
    if (this.statsDirty || !this.derivedCache || key !== this.derivedKey) {
      const extra: Record<string, number> = qres ? { fireresist: qres, lightresist: qres, coldresist: qres, poisonresist: qres } : {};
      this.derivedCache = computeDerived(c, cs, this.equipment, data.items, data.treasure.gen, this.rules.playerResistPenalty, charms, baseTime, extra);
      this.itemSkillCache = itemSkillBonus(this.equipment, data.items, data.treasure.gen, charms);
      this.itemSkillVersion++;
      this.derivedKey = key;
      this.statsDirty = false;
    }
    return this.derivedCache;
  }

  /** 아이템 포함 능력치 */
  effStat(stat: 'str' | 'dex' | 'vit' | 'ene'): number {
    const d = this.derived();
    return d ? d[stat] : (this.character?.[stat] ?? 0);
  }
  /** 최대 생명 (Battle Orders item_maxhp_percent 상태 포함 — 장비 % 와 같은 합산). 출처: skills.txt Battle Orders aurastat2 */
  maxLife(): number {
    return this.withStatePct(this.derived()?.maxLife ?? this.character?.maxLife ?? 0, 'item_maxhp_percent');
  }
  maxMana(): number {
    return this.withStatePct(this.derived()?.maxMana ?? this.character?.maxMana ?? 0, 'item_maxmana_percent');
  }
  /**
   * 최대 스태미나 = (기본 + 활력 + 장비 maxstamina + 레벨당 item_stamina_perlevel) × (100 + skill_staminapercent + skill_passive_staminapercent) / 100.
   * 출처: itemstatcost.txt — skill_staminapercent(162, 스태미나 신전)·skill_passive_staminapercent(163, Increased Stamina) op 1 → maxstamina %,
   *       item_stamina_perlevel op 2 (op param 3: 레벨 × 값 >> 3). D2MOO STATLIST_GetMaxStaminaFromUnit (D2Common_11248 op 적용)
   * 근사(원작 미확인): op 2 의 내부 단위(<<8) 반올림 대신 표시 단위로 내림
   */
  maxStamina(): number {
    const c = this.character;
    if (!c) return 0;
    const dv = this.derived();
    let base = dv?.maxStamina ?? c.maxStamina;
    if (dv) base += Math.trunc((c.level * dv.stat('item_stamina_perlevel')) / 8);
    const pct = this.playerStat('skill_staminapercent') + this.playerStat('skill_passive_staminapercent') + (dv?.stat('skill_staminapercent') ?? 0);
    return pct ? (base * (100 + pct)) / 100 : base;
  }

  /** 스태미나 회복 보너스 % (staminarecoverybonus + item_regenstamina_perlevel). 스태미나 물약 5000, 스태미나 신전 1000 */
  private staminaRecoveryBonus(): number {
    const c = this.character, dv = this.derived();
    return this.playerStat('staminarecoverybonus') + (dv?.stat('staminarecoverybonus') ?? 0) + (dv && c ? Math.trunc((c.level * dv.stat('item_regenstamina_perlevel')) / 8) : 0);
  }

  /**
   * 달리기 스태미나 소모 (마을 밖, 달리는 프레임마다).
   * 출처: D2MOO PlrModes.cpp sub_6FC7F780 — 소모 = 2 × charstats RunDrain (1/256), 몸 방어구가 있으면 × (armor.txt speed / 10 + 1),
   *       item_staminadrainpct 가 있으면 += 소모 × pct / −100, 최소 1. 0 이하가 되면 0 으로 두고 걷기로 (sub_6FC7F600(PLRMODE_WALK))
   */
  private drainStamina(): void {
    const c = this.character, cs = this.classStats, p = this.player;
    if (!c || !cs || p.mode !== 'RN' || this.inTown) return;
    let lost = 2 * cs.runDrain;
    const torso = this.equipment.tors ? this.data?.items.base(this.equipment.tors.code) : undefined;
    if (torso) lost *= Math.trunc(torso.speed / 10) + 1;
    const pct = (this.derived()?.stat('item_staminadrainpct') ?? 0) + this.playerStat('item_staminadrainpct');
    if (pct) lost += Math.trunc((lost * pct) / -100);
    if (lost < 1) lost = 1;
    const st = Math.trunc(c.stamina * 256) - lost;
    if (st <= 0) {
      c.stamina = 0;
      p.running = false;
      p.mode = 'WL';
      p.modeStart = this.tickCount;
      this.events.push({ type: 'staminaOut' });
      return;
    }
    c.stamina = st / 256;
  }

  /**
   * 스태미나 회복 (매 프레임). 출처: D2MOO PlrModes.cpp EVENTS_StaminaRegen —
   *   서 있음: 최대(1/256) >> 8, 걷기: >> 9 (필드에서 걷는데 스태미나 1 미만이면 회복 없음, 마을 걷기는 그대로),
   *   그 밖의 모드(달리기·공격 …): staminarecoverybonus ≥ 1000 일 때만 >> 8. 보너스가 있으면 += 값 × 보너스 / 100, 최대치까지
   */
  private regenStamina(): void {
    const c = this.character, p = this.player;
    if (!c || p.mode === 'DT' || p.mode === 'DD') return;
    const st = Math.trunc(c.stamina * 256);
    const bonus = this.staminaRecoveryBonus();
    let shift = 8;
    if (p.mode === 'WL') {
      shift = 9;
      if (!this.inTown && st < 256) return;
    } else if (p.mode !== 'NU' && bonus < 1000) return;
    const max = Math.trunc(this.maxStamina() * 256);
    if (st >= max) return;
    let add = max >> shift;
    if (bonus) add += Math.trunc((bonus * add) / 100);
    c.stamina = Math.min(max, st + add) / 256;
  }

  private withStatePct(v: number, stat: string): number {
    const add = this.player?.states.stat(stat) ?? 0;
    if (!add) return v;
    const item = this.derived()?.stat(stat) ?? 0;
    return Math.floor((v * (100 + item + add)) / (100 + item));
  }

  private playerDefenseValue(): number {
    const c = this.character;
    if (!c) return 0;
    const d = this.derived();
    const armor = Object.values(this.equipment).reduce((s, it) => s + it.defense, 0);
    const base = d ? d.defense : playerDefense(c.dex, armor);
    // 출처: itemstatcost.txt skill_armor_percent — 방어력 % 증가 (Iron Skin, Shout, Concentrate)
    // Berserk: armor_override_percent −100 → 방어 0 (출처: skills.txt Berserk aurastat2)
    const v = Math.trunc((base * (100 + this.playerStat('skill_armor_percent') + this.holyShieldArmorPct())) / 100);
    const ov = this.playerStat('armor_override_percent');
    return ov ? Math.max(0, Math.trunc((v * (100 + ov)) / 100)) : v;
  }

  /**
   * Holy Shield 방어 %: 방패를 들고 holyshield 상태면 calc1 (ln34 + Defiance 시너지) 을 방어 % 에 더한다.
   * 출처: D2MOO Units.cpp UNITS_GetDefense — STATE_HOLYSHIELD 상태 목록의 스킬·레벨로 SKILLS_EvaluateSkillFormula(dwCalc[0]),
   *       INVENTORY_GetEquippedShield 가 있을 때만 (skills.txt aurastatcalc2 는 스탯 이름이 없어 쓰이지 않는다)
   */
  private holyShieldArmorPct(): number {
    const st = this.player.states.get('holyshield');
    const larm = this.equipment.larm, data = this.data;
    if (!st?.skill || !larm || !data?.skillCalc) return 0;
    const b = data.items.base(larm.code);
    if (!b || !data.items.isType(b, 'shld')) return 0;
    const s = this.skillRecord(st.skill.id);
    return s && st.skill.lvl > 0 ? data.skillCalc.calc(s, 1, st.skill.lvl, this.owner()) : 0;
  }

  /** Holy Shield 가 Smite 에 더하는 물리 피해 (1/256). 출처: SKILLS_SrvDo150_Smite — SKILLS_GetMin/MaxPhysDamage(Holy Shield 스킬·레벨) */
  private holyShieldSmite(): { min: number; max: number } | undefined {
    const st = this.player.states.get('holyshield'), calc = this.data?.skillCalc;
    const s = st?.skill ? this.skillRecord(st.skill.id) : undefined;
    if (!st?.skill || !s || !calc) return undefined;
    const o = this.owner();
    return { min: calc.minPhys256(s, st.skill.lvl, o), max: calc.maxPhys256(s, st.skill.lvl, o) };
  }

  /** 플레이어 AR (명중% 보너스 적용 전). 출처: combat.ts playerAttackRating */
  /** AR = (민첩 − 7) × 5 + 클래스 상수 + 장비 추가 명중 (명중% 는 판정 때 곱). 출처: combat.ts playerAttackRating */
  private playerAR(): number {
    const c = this.character, cs = this.classStats;
    // 전투 신전: 상태 스탯 tohit (출처: ObjMode.cpp D2GAME_SHRINES_CombatBoost → STAT_TOHIT)
    return c && cs ? playerAttackRating(this.effStat('dex'), cs.toHitFactor, (this.derived()?.toHit ?? 0) + this.player.states.stat('tohit')) : 0;
  }

  /** 무기 공격 속도 %: 100 − WSM + EIAS (EIAS = ⌊120 × IAS / (120 + IAS)⌋). 출처: Maxroll Attack Speed */
  private attackSpeedPct(): number {
    const ias = this.derived()?.stat('item_fasterattackrate') ?? 0;
    return 100 - (this.weaponBase()?.speed ?? 0) + Math.trunc((120 * ias) / (120 + ias));
  }

  // ---------------------------------------------------------------- player update

  private setPlayerMode(mode: PlayerMode, speedPercent = 100): void {
    const p = this.player;
    p.mode = mode;
    p.modeStart = this.tickCount;
    if (mode === 'GH' || mode === 'BL' || mode === 'DT') {
      if (!this.data) p.modeEnd = this.tickCount + 10;
      // 피격·막기는 프레임 수 − 1 (원작 breakpoint: 바바리안 GH 5 프레임 × 50% = 9 프레임)
      else {
        const look = this.animLook(mode);
        p.modeEnd = this.tickCount + modeTiming(this.data.anim, look.token, look.mode, look.wclass, speedPercent, mode !== 'DT').duration;
      }
    }
  }

  private updatePlayer(): void {
    const p = this.player;
    if (p.mode === 'DD') return;
    if (p.mode === 'DT') {
      if (this.tickCount >= p.modeEnd) p.mode = 'DD';
      return;
    }
    // Phase 5: 몬스터가 건 빙결 (Diablo Cold Touch) · 기절 (Smite) — 움직이지도 행동하지도 못한다
    if (p.states.has('freeze') || p.states.has('stunned')) {
      p.path = [];
      p.modeEnd++;
      return;
    }
    if (p.cast) {
      this.updateCast(p.cast);
      if (p.cast) return;
    }
    if (p.mode === 'GH' || p.mode === 'BL') {
      if (this.tickCount < p.modeEnd) return;
      p.mode = 'NU';
      p.modeStart = this.tickCount;
    }
    const act = p.action;
    if (act?.kind === 'skill') {
      this.driveSkillAction(act);
      if (p.cast) return;
    } else if (act?.kind === 'corpse') {
      const cp = this.corpse;
      if (!cp) p.action = null;
      else if (Math.hypot(cp.x - p.x, cp.y - p.y) <= 3) {
        p.path = [];
        this.takeCorpse();
        p.action = null;
      } else if (this.tickCount >= p.repathAt) {
        this.pathPlayerTo(cp.x, cp.y, p.running);
        p.repathAt = this.tickCount + 10;
      }
    } else if (act?.kind === 'object') {
      this.driveObjectAction(act.id);
    } else if (act?.kind === 'npc') {
      this.driveNpcAction(act.id);
    } else if (act?.kind === 'pickup') {
      const g = this.ground.find((x) => x.item.id === act.itemId);
      if (!g) {
        p.action = null;
      } else if (Math.hypot(g.x - p.x, g.y - p.y) <= PICKUP_RANGE) {
        p.path = [];
        this.pickUp(g);
        p.action = null;
      } else if (this.tickCount >= p.repathAt) {
        this.pathPlayerTo(g.x, g.y, p.running);
        p.repathAt = this.tickCount + 10;
      }
    }
    this.movePlayer();
  }

  /**
   * 1프레임 이동량 (서브타일) = 걷기 속도(야드/초) × 1.5 / 25 × 속도% / 100.
   * 속도% = 100 + 달리기(100 × RunVelocity / WalkVelocity − 100) + velocitypercent + EFRW, 최소 25.
   * 출처: D2MOO Units.cpp UNITS_CharacterStartRunningOrKnockback (달리기 = velocitypercent 상태), UNITS_UpdateRunWalkAnimRateAndVelocity (하한 25)
   *       EFRW = ⌊150 × FRW / (150 + FRW)⌋ (Maxroll Movement Speed)
   */
  private stepLength(): number {
    const p = this.player;
    const frw = this.derived()?.stat('item_fastermovevelocity') ?? 0;
    const run = p.running && p.walkVelocity > 0 ? Math.trunc((100 * p.runVelocity) / p.walkVelocity) - 100 : 0;
    const pct = Math.max(25, 100 + run + this.playerStat('velocitypercent') + Math.trunc((150 * frw) / (150 + frw)));
    const base = p.walkVelocity > 0 ? p.walkVelocity : p.running ? p.runVelocity : 0;
    return ((base * SUBTILES_PER_YARD) / ENGINE_FPS) * pct / 100;
  }

  private movePlayer(): void {
    const p = this.player;
    if (p.path.length === 0) {
      if (p.mode === 'WL' || p.mode === 'RN') {
        p.mode = 'NU';
        p.modeStart = this.tickCount;
        this.events.push({ type: 'arrived', x: p.x, y: p.y });
      }
      return;
    }
    const moving: PlayerMode = p.running ? 'RN' : 'WL';
    if (p.mode !== moving) {
      p.mode = moving;
      p.modeStart = this.tickCount;
    }
    this.advance(p, this.stepLength(), (d) => (p.dir = d));
    this.dropBlaze();
    this.drainStamina();
  }

  /** Blaze 상태로 움직이면 발밑에 불. 출처: SKILLS_CreateBlazeMissile (이동 중에만) */
  private dropBlaze(): void {
    const p = this.player;
    const st = p.states.get('blaze');
    if (!st?.skill || this.inTown) return;
    if (p.lastBlaze && Math.hypot(p.x - p.lastBlaze.x, p.y - p.lastBlaze.y) < 1) return;
    const s = this.skillRecord(st.skill.id), def = s ? this.data?.missiles.get(s.srvMissileA) : undefined;
    if (!s || !def) return;
    p.lastBlaze = { x: p.x, y: p.y };
    this.spawnGroundFire(def, p.x, p.y, this.missileDamageRoller(def, s, st.skill.lvl, { srcDam: 0, useSkillDamage: true }), {
      ownerId: p.id, ownerLevel: this.character?.level ?? 1, lvl: st.skill.lvl, skill: s,
    });
  }

  /**
   * 유닛 점유: 살아있는 유닛은 크기(서브타일)만큼 공간을 차지해 서로 겹칠 수 없다.
   * 근사(원작 미확인): 원작은 서브타일 충돌 패턴(PATH_GetUnitCollisionPattern)을 쓰지만, 여기선 반지름 size/2 원으로 근사.
   */
  private blockedByUnit(self: object, x: number, y: number, size: number): boolean {
    const r = size / 2;
    const p = this.player;
    if (self !== p && p.mode !== 'DT' && p.mode !== 'DD' && Math.hypot(p.x - x, p.y - y) < r + PLAYER_SIZE / 2 - 0.25) return true;
    for (const m of this.monsters) {
      if (m === self || m.mode === 'DT' || m.mode === 'DD' || m.hidden) continue;
      if (Math.hypot(m.x - x, m.y - y) < r + m.type.sizeX / 2 - 0.25) return true;
    }
    for (const m of this.level.npcs) {
      if (m === self) continue;
      if (Math.hypot(m.x - x, m.y - y) < r + m.type.sizeX / 2 - 0.25) return true;
    }
    // 소환수끼리·플레이어와는 겹쳐 지나갈 수 있게 (근사: 원작은 소환수도 충돌하지만 따라다니다 끼이지 않게)
    if (self === p || this.pets.includes(self as MonsterUnit)) return false;
    for (const m of this.pets) {
      if (m.mode === 'DT' || m.mode === 'DD') continue;
      if (Math.hypot(m.x - x, m.y - y) < r + m.type.sizeX / 2 - 0.25) return true;
    }
    return false;
  }

  private advance(u: { x: number; y: number; path: Pt[] }, budget: number, setDir: (d: number) => void, size = PLAYER_SIZE): void {
    while (budget > 0 && u.path.length > 0) {
      const next = u.path[0] as Pt;
      const dx = next.x - u.x, dy = next.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) setDir(dir64(dx, dy));
      const step = Math.min(d, budget);
      if (d > 1e-9 && this.blockedByUnit(u, u.x + (dx / d) * step, u.y + (dy / d) * step, size)) {
        u.path = [];
        return;
      }
      if (d <= budget) {
        u.x = next.x;
        u.y = next.y;
        budget -= d;
        u.path.shift();
      } else {
        u.x += (dx / d) * budget;
        u.y += (dy / d) * budget;
        budget = 0;
      }
    }
  }

  /**
   * 줍기: 골드는 소지 한도(캐릭터 레벨 × 10000)까지, 물약·두루마리는 벨트 먼저, 나머지는 인벤토리 빈 자리. 자리가 없으면 그대로.
   * 출처: The Arreat Summit — Gold: 소지 한도 = 레벨 × 10,000
   */
  private pickUp(g: GroundItem): void {
    if (g.item.code === 'gld') {
      const cap = (this.character?.level ?? 1) * 10000;
      const take = Math.min(g.item.quantity, Math.max(0, cap - this.gold));
      if (take <= 0) {
        this.events.push({ type: 'goldFull' });
        return;
      }
      this.gold += take;
      if (take >= g.item.quantity) this.ground.splice(this.ground.indexOf(g), 1);
      else g.item.quantity -= take;
      this.events.push({ type: 'goldPickup', amount: take });
      return;
    }
    if (!this.store.store(g.item)) {
      this.events.push({ type: 'noRoom', itemId: g.item.id });
      return;
    }
    this.ground.splice(this.ground.indexOf(g), 1);
    this.statsDirty = true;
    this.events.push({ type: 'itemPickup', itemId: g.item.id, code: g.item.code });
    // 출처: QUESTS_ItemPickedUp (퀘스트 아이템의 연결 목록)
    this.questControl.itemPickedUp(g.item.code);
  }

  // ---------------------------------------------------------------- 아이템 사용

  /**
   * 물약·두루마리 사용 (원작 우클릭 / 벨트 단축키).
   * 출처: D2MOO SKILLITEM_pSpell03_Potion — 회복 총량 = calc << 8 × 클래스 보너스(생명: 바바리안 ×2, 아마존·팔라딘 ×1.5 /
   *       마나: 소서리스·네크로맨서 ×2, 아마존·팔라딘 ×1.5), rand(100) < rand(활력 또는 에너지)/2 이면 ×2,
   *       len 프레임에 걸쳐 나눠 회복 (이미 마시던 물약의 남은 양과 합쳐 다시 나눔)
   *       SKILLITEM_pSpell05_RejuvPotion — 최대치의 calc % 즉시 회복 (ITEMS_GetBonusLife/ManaBasedOnClass)
   * 근사(원작 미확인): 두루마리(Town Portal·Identify)의 효과는 Phase 8(포털)·Phase 7 Step 3(감정)에서 연결 — 지금은 사용만 거부
   */
  private useItem(id: number, targetId?: number): void {
    const c = this.character, data = this.data;
    const found = this.store.find(id);
    if (!c || !data || !found || this.isDead) return;
    const b = data.items.base(found.item.code);
    // 호라드릭 큐브: 오른쪽 클릭 = 큐브 창 (출처: D2Client 큐브 UI — 서버는 SUNIT_SetInteractInfo(UNIT_ITEM) 뒤 트랜스뮤트 단추 TRADEBTN_TRANSMUTE)
    if (b?.code === 'box') {
      this.openCube(found.item.id);
      return;
    }
    if (!b?.useable) return;
    // 감정 두루마리(isc) / 감정의 책(ibk): 대상 미감정 아이템을 감정. 책은 충전 1 소모, 두루마리는 사라짐 (근사: 원작 커서 모드 처리 미확인)
    if (b.code === 'isc' || b.code === 'ibk') {
      const target = targetId !== undefined ? this.store.find(targetId)?.item : undefined;
      if (!target || target.identified || (b.code === 'ibk' && found.item.quantity <= 0)) return;
      target.identified = true;
      this.statsDirty = true;
      if (b.code === 'ibk') found.item.quantity--;
      else this.store.consume(id);
      this.events.push({ type: 'itemIdentified', itemId: target.id });
      return;
    }
    const cls = c.cls;
    // 출처: D2MOO ITEMS_GetBonusLifeBasedOnClass / ITEMS_GetBonusManaBasedOnClass (어쌔신 ×1.5 · 드루이드 마나 ×2)
    const lifeBonus = (v: number) => (cls === 'Barbarian' ? 2 * v : cls === 'Amazon' || cls === 'Paladin' || cls === 'Assassin' ? v + (v >> 1) : v);
    const manaBonus = (v: number) => (cls === 'Sorceress' || cls === 'Necromancer' || cls === 'Druid' ? 2 * v : cls === 'Amazon' || cls === 'Paladin' || cls === 'Assassin' ? v + (v >> 1) : v);
    const doubled = (stat: number) => stat > 0 && this.rng.pick(100) < Math.trunc(this.rng.pick(stat) / 2);
    if (b.pSpell === 3) {
      for (const us of b.useStats) {
        let total = us.calc << 8;
        let state = '';
        if (us.stat === 'hpregen' || us.stat === 'hitpoints') {
          total = lifeBonus(total);
          if (doubled(this.effStat('vit'))) total *= 2;
          state = 'healthpot';
        } else if (us.stat === 'manarecovery' || us.stat === 'mana') {
          total = manaBonus(total);
          if (doubled(this.effStat('ene'))) total *= 2;
          state = 'manapot';
        } else continue;
        const len = b.useLen;
        const cur = this.player.states.get(state);
        const remaining = cur && Number.isFinite(cur.until) ? Math.max(0, cur.until - this.tickCount) : 0;
        const perFrame = (total + remaining * (cur?.stats.potion ?? 0)) / (remaining + len);
        this.player.states.set(state, this.tickCount + remaining + len, { potion: perFrame });
        const st = this.player.states.get(state);
        if (st) {
          st.until = this.tickCount + remaining + len;
          st.stats = { potion: perFrame };
        }
      }
    } else if (b.pSpell === 2) {
      // 마을 포털 두루마리(tsc) / 책(tbk, 충전 1 소모). 출처: SKILLITEM_pSpell02_CastPortal (마을 안에서는 실패)
      if (b.code === 'tbk' && found.item.quantity <= 0) return;
      if (!this.castTownPortal()) {
        this.events.push({ type: 'portalFailed' });
        return;
      }
      if (b.code === 'tbk') {
        found.item.quantity--;
        this.events.push({ type: 'itemUsed', itemId: id, code: found.item.code });
        return;
      }
    } else if (b.pSpell === 5) {
      for (const us of b.useStats) {
        if (us.stat === 'hitpoints') c.life = Math.min(this.maxLife(), c.life + (this.maxLife() * us.calc) / 100);
        else if (us.stat === 'mana') c.mana = Math.min(this.maxMana(), c.mana + (this.maxMana() * us.calc) / 100);
      }
    } else if (b.pSpell === 9 || b.pSpell === 6) {
      if (!this.useStatePotion(b)) return;
    } else if (!this.questControl.useItem(b.code)) {
      // Phase 7: 퀘스트 아이템 (Book of Skill·Potion of Life) 은 퀘스트 모듈이 처리
      this.events.push({ type: 'itemUseUnsupported', itemId: id, code: found.item.code });
      return;
    }
    this.store.consume(id);
    this.events.push({ type: 'itemUsed', itemId: id, code: found.item.code });
  }

  /**
   * 상태 물약: 스태미나(vps, pSpell 9)·해독(yps)·해동(wms, pSpell 6).
   * 출처: D2MOO SkillItem.cpp SKILLITEM_pSpell09_AntidoteThawingPotion — misc.txt cstate1·cstate2 상태를 풀고 (poison / freeze·cold),
   *       SKILLITEM_pSpell09_StaminaPotion — misc.txt state 를 len 프레임 (이미 있으면 남은 끝 프레임 + len), stat1~3 = calc1~3
   *       (staminapot: staminarecoverybonus 5000, antidote: poisonresist 50·maxpoisonresist 10, thawing: coldresist 50·maxcoldresist 10),
   *       staminarecoverybonus > 0 이고 스태미나 < 최대면 스태미나 = 최대 + 1
   */
  private useStatePotion(b: ItemBase): boolean {
    const c = this.character, st = this.player.states;
    if (!c) return false;
    let ok = false;
    for (const cs of b.cureStates) {
      if (st.has(cs)) st.remove(cs);
      ok = true;
    }
    if (!b.useState || b.useLen <= 0) return ok;
    const cur = st.get(b.useState);
    const end = (cur && Number.isFinite(cur.until) ? cur.until : this.tickCount) + b.useLen;
    const stats: Record<string, number> = {};
    for (const us of b.useStats) if (us.calc) stats[us.stat] = us.calc;
    st.remove(b.useState);
    st.set(b.useState, end, stats);
    if ((stats.staminarecoverybonus ?? 0) > 0 && c.stamina < this.maxStamina()) c.stamina = this.maxStamina() + 1 / 256;
    this.events.push({ type: 'potionState', state: b.useState, until: end });
    return true;
  }

  // ---------------------------------------------------------------- 오라

  /**
   * 오라: 오른쪽 버튼에 오라 스킬(aura=1)을 올려 두면 켜진다. perdelay 프레임마다 다시 적용 (선택 즉시 immediate).
   * 출처: D2MOO SKILLS_SrvDo065_BasicAura / SrvDo066_HolyFire / SrvDo081_HolyFreeze, SKILL_ComputePeriodicRate (최소 5)
   *   BasicAura: 자신(파티)에게 aurastate + aurastat, hitpoints 는 즉시 회복(최대치까지), 회복했을 때만 마나 소모
   *   HolyFire/HolyFreeze: 자신에게 passivestat(공격에 원소 피해), 범위 안 적에게 굴린 원소 피해(+ HolyFreeze 는 감속 상태)
   * 근사(원작 미확인): 파티원·용병 없이 자신에게만 적용 (싱글플레이 1차 범위)
   */
  private updateAura(): void {
    const c = this.character, data = this.data, calc = data?.skillCalc;
    if (!c || !calc || this.isDead) return;
    const s = this.skillRecord(c.rightSkill);
    const lvl = s ? this.effectiveSkillLevel(s.id) : 0;
    if (!s || !s.aura || lvl <= 0) {
      if (this.aura) this.endAura();
      return;
    }
    if (this.aura && (this.aura.skill.id !== s.id || this.aura.lvl !== lvl)) this.endAura();
    if (!this.aura) {
      this.aura = { skill: s, lvl, next: s.immediate ? this.tickCount : this.tickCount + 1 };
      this.passiveCache = null;
    }
    // 같은 오라를 아이템이 더 높은 레벨로 주면 그쪽만 상태를 쓴다 (출처: sub_6FD10EC0 — 낮은 레벨은 무시)
    if ((this.itemAuras.get(s.id)?.lvl ?? 0) > lvl) return;
    this.runAura(this.aura);
  }

  /**
   * 아이템 오라 (item_aura, param = 오라 스킬, 값 = 레벨 — +스킬 미적용): 직업 오라와 따로 함께 돈다.
   * 출처: D2MOO SKILLITEM_ActivateAura / D2GAME_MONSTERS_AiFunction10_6FD13610 (EVENTTYPE_PERIODICSTATS, 레벨 = item_aura 합)
   */
  private updateItemAuras(): void {
    const dv = this.derived();
    const want = new Map<number, number>();
    if (dv && !this.isDead) for (const l of dv.layered) if (l.stat === 'item_aura' && l.value > 0) want.set(l.param, (want.get(l.param) ?? 0) + l.value);
    for (const [id, run] of this.itemAuras) {
      if (want.get(id) === run.lvl) continue;
      if (this.aura?.skill.auraState !== run.skill.auraState) this.player.states.remove(run.skill.auraState);
      this.itemAuras.delete(id);
    }
    for (const [id, lvl] of want) {
      const s = this.skillRecord(id);
      if (!s || !s.aura || !s.auraState) continue;
      let run = this.itemAuras.get(id);
      if (!run) {
        run = { skill: s, lvl, next: s.immediate ? this.tickCount : this.tickCount + 1 };
        this.itemAuras.set(id, run);
      }
      if (this.aura?.skill.id === id && this.aura.lvl >= lvl) continue;
      this.runAura(run);
    }
  }

  /** 오라 한 주기 (직업·아이템 공통): 주기마다 자신 상태·주변 몬스터 효과, 마나 소모. 출처: SKILLS_SrvDo065_BasicAura 등 */
  private runAura(run: { skill: SkillRecord; lvl: number; next: number }): void {
    const c = this.character, calc = this.data?.skillCalc;
    if (!c || !calc) return;
    const s = run.skill, lvl = run.lvl;
    if (this.tickCount < run.next) return;
    const o = this.owner();
    const period = Math.max(5, calc.eval(s, s.perDelay, lvl, o));
    run.next = this.tickCount + period;
    const until = this.tickCount + period + 1;
    const mana256 = calc.manaCost256(s, lvl);
    const hasMana = c.mana * 256 >= mana256;
    const stats: Record<string, number> = {};
    let used = false;
    if (s.srvDoFunc === 65) {
      for (const a of s.auraStats) {
        const v = hasMana ? calc.eval(s, a.calc, lvl, o) : 0;
        if (!v) continue;
        if (a.stat === 'hitpoints') {
          // 직접 회복 스탯 (Prayer, Cleansing): 1/256 단위, 최대 생명까지
          if (c.life < this.maxLife()) {
            c.life = Math.min(this.maxLife(), c.life + v / 256);
            used = true;
          }
        } else if (a.stat === 'item_poisonlengthresist') {
          // Cleansing: 독·저주 남은 시간 × v%
          for (const st of ['poison']) {
            const cur = this.player.states.get(st);
            if (cur && Number.isFinite(cur.until)) {
              cur.until = this.tickCount + Math.trunc(((cur.until - this.tickCount) * v) / 100);
              used = true;
            }
          }
        } else stats[a.stat] = v;
      }
      // 출처: SKILLS_SrvDo065_BasicAura — passivestate 가 없으면 자신에게는 passivestat 값을 덮어쓴다 (Fanaticism 피해 ln56, 파티원은 ln56/2)
      if (hasMana && !s.passiveState) {
        for (const ps of s.passiveStats) {
          const v = calc.eval(s, ps.calc, lvl, o);
          if (v) stats[ps.stat] = v;
        }
      }
      // attackrate 는 other_animrate 에도 (출처: SKILLS_AuraCallback_BasicAura)
      if (stats.attackrate && !stats.other_animrate) stats.other_animrate = stats.attackrate;
    } else if (s.srvDoFunc === 82) {
      // Redemption: 시체 거두기 (거둔 시체가 있을 때만 마나 소모)
      if (!this.inTown && hasMana) used = this.redeemCorpses(s, lvl);
    } else {
      // Holy Fire / Holy Freeze: 자신에게는 패시브 원소 피해 스탯
      for (const ps of s.passiveStats) {
        const v = hasMana ? calc.eval(s, ps.calc, lvl, o) : 0;
        if (v) stats[ps.stat] = v;
      }
    }
    this.player.states.set(s.auraState, until, stats, { id: s.id, lvl });
    if ((s.srvDoFunc === 66 || s.srvDoFunc === 81) && !this.inTown) {
      const range = calc.eval(s, s.auraRangeCalc, lvl, o);
      const el = this.skillElemental(s, lvl);
      const targetStats: Record<string, number> = {};
      if (hasMana) for (const a of s.auraStats) targetStats[a.stat] = calc.eval(s, a.calc, lvl, o);
      // 오라 필터 (aurafilter): 0x04 = 언데드만 (Sanctuary), 0x4000 = 보스 제외. 출처: D2MOO D2Skills.h AURAFILTER_FINDUNDEAD / IGNBOSS
      const undeadOnly = (s.auraFilter & 0x04) !== 0, ignBoss = (s.auraFilter & 0x4000) !== 0;
      for (const m of this.monstersNear(this.player.x, this.player.y, range)) {
        if (m.pet || (undeadOnly && !m.type.undead) || (ignBoss && m.type.boss)) continue;
        if (s.auraTargetState && Object.keys(targetStats).length) {
          if (s.srvDoFunc === 81) {
            // 감속은 몬스터 냉기 효과(coldeffect)보다 강해질 수 없다 (출처: SKILLS_AuraCallback_BasicAura / SKILLS_AuraCallback_HolyFreeze)
            const capped: Record<string, number> = {};
            for (const [k, v] of Object.entries(targetStats)) capped[k] = k === 'velocitypercent' || k === 'attackrate' || k === 'other_animrate' ? Math.max(v, m.type.coldEffect) : v;
            if (m.type.coldEffect < 0) m.states.set(s.auraTargetState, until, capped);
          } else {
            // Conviction: 방어 −dm56 %, 화염·냉기·번개 저항 −min(ln34, 150). 출처: SKILLS_SrvDo066 → SKILLS_AuraCallback_BasicAura (auratargetstate)
            m.states.set(s.auraTargetState, until, targetStats, { id: s.id, lvl });
            used = true;
          }
        }
        if (el) {
          const d = emptyDamage();
          addElemental(d, el.eType, el.amount, 0);
          d.hitClass = s.hitClass || 0x0d;
          this.damageMonster(m, d);
          // Sanctuary: ResultFlags 8 = 밀쳐내기 (출처: skills.txt Sanctuary ResultFlags 11)
          if (s.resultFlags & 8 && m.mode !== 'DT' && m.mode !== 'DD') this.knockBack(m);
          used = true;
        }
      }
    }
    if (mana256 > 0 && used) c.mana = Math.max(0, c.mana - mana256 / 256);
  }

  private endAura(): void {
    if (!this.aura) return;
    this.player.states.remove(this.aura.skill.auraState);
    this.aura = null;
    this.passiveCache = null;
  }

  // ---------------------------------------------------------------- skills: 선택·검사

  private skillRecord(id: number): SkillRecord | undefined {
    return this.data?.skills?.byId.get(id);
  }

  private skillLevel(s: SkillRecord): number {
    // 충전 스킬: 아이템에 적힌 레벨 그대로 (+스킬 미적용), 충전이 없으면 쓸 수 없다 (출처: SKILLS_GetSkillLevel — nOwnerGUID 가 있으면 보너스 없음)
    const ch = this.activeCharge(s.id);
    if (ch) return ch.cur > 0 ? ch.lvl : 0;
    // 스킬 신전: 배운 스킬 +Arg0 (shrines.txt Skill Boost Arg0 = 2, 상태 shrine_skill). 근사(원작 미확인): 원작은 상태 해제 콜백에서 스킬을 다시 계산
    // Battle Command: item_allskills +1 (출처: skills.txt Battle Command aurastat1)
    return this.effectiveSkillLevel(s.id);
  }

  private isRangedWeapon(): boolean {
    const w = this.weaponBase();
    return !!w && !!this.data && this.data.items.isType(w, 'miss');
  }

  /** 스킬 무기 요구 (itypea1~3 중 하나, etypea 제외). 출처: skills.txt itypea/etypea — 없는 경우 제한 없음 */
  private weaponAllows(s: SkillRecord): boolean {
    if (!s.itypeA.length) return true;
    // Smite (itypea1 = shld): 왼손 방패를 검사 (skills.txt weapsel 4)
    if (s.itypeA.includes('shld')) {
      const l = this.equipment.larm, items = this.data?.items;
      const b = l ? items?.base(l.code) : undefined;
      return !!b && !!items && items.isType(b, 'shld');
    }
    const w = this.weaponBase(), items = this.data?.items;
    if (!w || !items) return false;
    if (s.etypeA.some((t) => items.isType(w, t))) return false;
    return s.itypeA.some((t) => items.isType(w, t));
  }

  /** 스킬이 근접 대상 필요 (range h2h, 또는 Attack/both 를 근접 무기로) */
  private needsMelee(s: SkillRecord): boolean {
    if (s.range === 'h2h') return true;
    if (s.range === 'both') return !this.isRangedWeapon();
    return false;
  }

  private driveSkillAction(act: Extract<PlayerAction, { kind: 'skill' }>): void {
    const p = this.player, c = this.character;
    let s = this.skillRecord(act.skillId);
    if (!s || !this.data) {
      // 스킬 데이터 없이 만든 게임(테스트): 기본 근접 공격만
      if (act.targetId !== undefined) this.driveBasicAttack(act);
      else p.action = null;
      return;
    }
    if (this.inTown && !s.inTown) {
      p.action = null;
      return;
    }
    if (s.passive || this.skillLevel(s) <= 0) {
      p.action = null;
      return;
    }
    // 원작: AttackNoMana 스킬은 마나가 모자라면 일반 공격으로 대신한다 (충전 스킬은 마나를 쓰지 않는다)
    const needMana = this.activeCharge(s.id) ? 0 : s.repeat ? s.startMana * 256 : (this.data.skillCalc?.manaCost256(s, this.skillLevel(s)) ?? 0);
    if (c && s.id > 5 && this.data.skillCalc && needMana > c.mana * 256) {
      if (s.attackNoMana) s = this.skillRecord(SKILL_ATTACK) ?? s;
      else {
        this.events.push({ type: 'noMana', skill: s.id });
        p.action = null;
        return;
      }
    }
    if (!this.weaponAllows(s)) {
      this.events.push({ type: 'skillUnusable', skill: s.id, reason: 'weapon' });
      p.action = null;
      return;
    }
    if (act.targetItem !== undefined) {
      const g = this.ground.find((x) => x.item.id === act.targetItem);
      p.path = [];
      if (g) this.startCast(s, undefined, g.x, g.y, g.item.id);
      p.action = null;
      return;
    }
    const target = act.targetId !== undefined ? this.monsters.find((m) => m.id === act.targetId) : undefined;
    const corpseSkill = s.targetCorpse;
    if (corpseSkill) {
      const corpse = target ?? this.findCorpse(act.x, act.y);
      if (!corpse || corpse.mode !== 'DD' || corpse.corpseUsed) {
        p.action = null;
        return;
      }
      // range none 인 시체 스킬(Raise Skeleton, Corpse Explosion)은 떨어져서도 쓴다, h2h(Find Potion)는 다가가서
      if (s.range !== 'h2h' || isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, corpse.x, corpse.y, corpse.type.sizeX, 1)) {
        p.path = [];
        this.startCast(s, corpse.id, corpse.x, corpse.y);
        p.action = null;
      } else if (this.tickCount >= p.repathAt) {
        this.pathPlayerTo(corpse.x, corpse.y, p.running);
        p.repathAt = this.tickCount + 5;
      }
      return;
    }
    const alive = target && target.mode !== 'DT' && target.mode !== 'DD' ? target : undefined;
    if (act.targetId !== undefined && !alive) {
      p.action = null;
      return;
    }
    if (this.needsMelee(s)) {
      if (!alive) {
        if (s.targetableOnly) {
          p.action = null;
          return;
        }
        this.startCast(s, undefined, act.x, act.y);
        p.action = null;
        return;
      }
      if (isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, alive.x, alive.y, alive.type.sizeX)) {
        p.path = [];
        this.startCast(s, alive.id, alive.x, alive.y);
        if (!act.repeat) p.action = null;
      } else if (act.standStill) {
        this.startCast(s, alive.id, alive.x, alive.y);
        p.action = null;
      } else if (this.tickCount >= p.repathAt) {
        this.pathPlayerTo(alive.x, alive.y, p.running);
        p.repathAt = this.tickCount + 5;
      }
      return;
    }
    // 원거리·시전·함성: 제자리에서 대상/지점 방향으로
    p.path = [];
    this.startCast(s, alive?.id, alive ? alive.x : act.x, alive ? alive.y : act.y);
    if (!act.repeat) p.action = null;
  }

  /** 스킬 데이터 없는 게임용 기본 근접 공격 (엔진 단위 테스트) */
  private driveBasicAttack(act: Extract<PlayerAction, { kind: 'skill' }>): void {
    const p = this.player;
    const target = this.monsters.find((m) => m.id === act.targetId);
    if (!target || target.mode === 'DT' || target.mode === 'DD') {
      p.action = null;
      return;
    }
    if (this.tickCount >= p.repathAt) {
      this.pathPlayerTo(target.x, target.y, p.running);
      p.repathAt = this.tickCount + 5;
    }
  }

  private findCorpse(x: number, y: number): MonsterUnit | undefined {
    let best: MonsterUnit | undefined, bd = 3;
    for (const m of this.monsters) {
      if (m.mode !== 'DD' || m.corpseUsed) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- skills: 시작·진행

  /** 스킬 사용 시작: 마나 소모, 방향, 애니메이션(시퀀스 포함) 길이와 판정 시점 결정 */
  /** Blade Shield 다음 피해 프레임 */
  private bladeShieldNext = 0;

  private startCast(s: SkillRecord, targetId: number | undefined, tx: number, ty: number, targetItem?: number): boolean {
    const p = this.player, c = this.character, data = this.data;
    if (!data) return false;
    const lvl = this.skillLevel(s);
    if (!this.startCheck(s, targetId, targetItem)) return false;
    // 스킬 지연 (skills.txt delay): 지연 스킬을 쓰면 그 프레임 동안 지연 있는 스킬을 쓸 수 없다 (상태 skilldelay).
    // 출처: D2MOO SKILLS_CanUseSkill (STATE_SKILLDELAY) / D2GAME_SKILLS_SetDelay
    const delay = s.delay && data.skillCalc ? data.skillCalc.eval(s, s.delay, lvl, this.owner()) : 0;
    if (delay > 0) {
      if (p.states.has('skilldelay')) {
        this.events.push({ type: 'skillUnusable', skill: s.id, reason: 'delay' });
        return false;
      }
      p.states.set('skilldelay', this.tickCount + delay);
    }
    // 충전 스킬: 마나 대신 그 아이템 충전 1 (출처: D2GAME_SKILLMANA_Consume_6FD10A50)
    const charge = this.activeCharge(s.id);
    if (charge) {
      charge.stat.value = (charge.stat.value & 0xff00) | Math.max(0, charge.cur - 1);
      this.events.push({ type: 'chargeUsed', skill: s.id, left: Math.max(0, charge.cur - 1) });
    }
    // 반복 스킬은 발사할 때마다 마나를 쓴다 (skills.txt startmana 로 시작 조건만 검사)
    else if (c && s.id > 5 && data.skillCalc && !s.repeat) c.mana = Math.max(0, c.mana - data.skillCalc.manaCost256(s, lvl) / 256);
    if (Math.hypot(tx - p.x, ty - p.y) > 1e-6) p.dir = dir64(tx - p.x, ty - p.y);
    // 발차기(KK)는 무기와 상관없이 맨손 COF·AnimData (원작 CHARS\AI\COF\AIKKHTH 만 있다)
    const wclass = s.anim === 'KK' ? 'HTH' : this.weaponWclass();
    const token = this.playerToken();
    // 무기 공격 속도: weapons.txt speed (WSM, 음수 = 빠름). 출처: Maxroll Attack Speed — AnimRate − WSM
    // 공격 속도: WSM + IAS / 시전 속도: FCR (EFCR = ⌊120 × FCR / (120 + FCR)⌋). 출처: Maxroll Attack Speed / Cast Rate
    const fcr = this.derived()?.stat('item_fastercastrate') ?? 0;
    // Dragon Tail(St27): 공격 속도 + par4 (출처: SKILLS_SrvSt27_DragonTail — sub_6FD15470)
    const speedPct = (s.useAttackRate ? this.attackSpeedPct() : s.anim === 'SC' ? 100 + Math.trunc((120 * fcr) / (120 + fcr)) : 100) + (s.srvStFunc === 27 ? (s.params[3] ?? 0) : 0);
    const cast: Cast = { skill: s, lvl, targetId, tx, ty, start: this.tickCount, end: this.tickCount + 1, hitTicks: [], fired: 0, targetItem };
    // 변신 중에는 플레이어 시퀀스 대신 몬스터 COF 한 동작
    const seq = s.seqNum > 0 && !this.shapeType() ? PLAYER_SEQUENCES[s.seqNum]?.[wclass] : undefined;
    if (seq && seq.length) {
      // 시퀀스는 seqtrans 모드의 AnimData 속도로 진행한다
      // 근사(원작 미확인): 원작 시퀀스 진행 속도 세부(UNITS_GetFrameBonus) — seqtrans 애니메이션 속도 × 공격 속도% 로 근사
      const r = data.anim.get(`${token}${s.seqTrans || 'A1'}${wclass}`);
      const rate = Math.max(1, Math.floor(((r?.speed ?? 256) * speedPct) / 100));
      cast.seq = { frames: seq, rate };
      seq.forEach((f, i) => {
        if (f[2] === 1) cast.hitTicks.push(Math.ceil((i * 256) / rate));
      });
      cast.end = this.tickCount + Math.ceil((seq.length * 256) / rate);
      p.mode = 'SQ';
    } else {
      const mode = s.anim || 'A1';
      const look = this.animLook(mode, wclass);
      const r = data.anim.get(`${look.token}${look.mode}${look.wclass}`);
      const t = modeTiming(data.anim, look.token, look.mode, look.wclass, speedPct, true);
      const af = r ? actionFrame(r) : -1;
      cast.hitTicks.push(af >= 0 ? t.hitTick : Math.max(0, t.duration - 1));
      cast.end = this.tickCount + Math.max(1, t.duration);
      p.mode = mode;
    }
    p.modeStart = this.tickCount;
    if (s.srvStFunc === 40 || s.srvStFunc === 41) this.prepareLeap(cast);
    if (s.srvStFunc === 37 && data.skillCalc) {
      // Zeal: calc1 번 타격. 근사(원작 미확인): 타격 후 애니메이션을 되감는 간격(sub_6FD15080, par2)을 첫 타격까지의 시간으로 근사
      const n = Math.max(1, data.skillCalc.calc(s, 1, lvl, this.owner()));
      const first = cast.hitTicks[0] ?? 1, step = Math.max(2, first);
      cast.hitTicks = Array.from({ length: n }, (_, i) => first + i * step);
      cast.end = this.tickCount + first + (n - 1) * step + Math.max(1, cast.end - this.tickCount - first);
    }
    if ((s.srvStFunc === 8 || s.srvStFunc === 9) && data.skillCalc) this.prepareMultiShot(cast);
    if (s.srvStFunc === 38) this.prepareWhirlwind(cast);
    if (s.srvStFunc === 31) this.prepareCharge(cast);
    if (s.srvStFunc === 24) this.prepareDragonTalon(cast);
    if (s.srvStFunc === 27) {
      // Dragon Tail: 발차기는 시작할 때 (명중 % 없음, 차지 Tiger % 만)
      const t = targetId !== undefined ? this.monsters.find((m) => m.id === targetId && m.mode !== 'DT' && m.mode !== 'DD') : undefined;
      if (t) {
        cast.lastHit = this.kick(s, lvl, t, 0, false);
        cast.lastPhys = this.lastMeleePhys;
      }
    }
    if (s.srvStFunc === 28 && data.skillCalc) {
      // Blade Shield: 자신에게 aurastate (지속 auralencalc). 출처: SKILLS_SrvSt28_BladeShield
      p.states.set(s.auraState, this.tickCount + data.skillCalc.eval(s, s.auraLenCalc, lvl, this.owner()), {}, { id: s.id, lvl });
    }
    // Concentrate 등: 스킬 사용 중 자신에게 붙는 상태 (aurastate, 공격이 끝나면 해제)
    if (s.auraState && (s.srvDoFunc === 2 || s.srvStFunc === 32) && data.skillCalc) {
      const stats: Record<string, number> = {};
      for (const a of s.auraStats) stats[a.stat] = data.skillCalc.eval(s, a.calc, lvl, this.owner());
      p.states.set(s.auraState, cast.end, stats);
    }
    p.cast = cast;
    this.events.push({ type: 'skillStart', skill: s.id, level: lvl });
    return true;
  }

  /** 시작 함수 조건 (srvstfunc): 대상 필요, 던질 무기·화살 수량 등 */
  private startCheck(s: SkillRecord, targetId: number | undefined, targetItem?: number): boolean {
    // 변신 제한 (skills.txt restrict / State1~3). 출처: SKILLS_GetUseState → D2Common_SKILLS_CheckShapeRestriction
    if (this.data?.stateInfo && !shapeAllowed(s, (st) => this.player.states.has(st), this.shapeRestricted())) {
      this.events.push({ type: 'skillUnusable', skill: s.id, reason: 'shape' });
      return false;
    }
    // Strafe(St08): 화살 필요 (출처: SKILLS_SrvSt08_Strafe — sub_6FD119C0)
    if (s.srvStFunc === 8 && this.isBowWeapon() && !this.ammo()) {
      this.events.push({ type: 'skillUnusable', skill: s.id, reason: 'ammo' });
      return false;
    }
    // Iron Golem(St20): 바닥의 금속 아이템을 골라야 한다 (출처: SKILLS_SrvSt20_IronGolem)
    if (s.srvStFunc === 20) {
      const g = targetItem !== undefined ? this.ground.find((x) => x.item.id === targetItem) : undefined;
      if (!g || !this.isMetalItem(g.item)) return false;
    }
    // Hydra(St14)·Bone Prison(St19): 마을 밖에서만 (출처: SKILLS_SrvSt14_Hydra / SrvSt19_BonePrison)
    if ((s.srvStFunc === 14 || s.srvStFunc === 19) && this.inTown) return false;
    // Holy Shield(St36): 방패 필요 (출처: SKILLS_SrvSt36_HolyShield)
    if (s.srvStFunc === 36 && !(this.equipment.larm && this.data?.items.isType(this.data.items.base(this.equipment.larm.code) as ItemBase, 'shld'))) return false;
    // Attack·화살 스킬: 활/석궁이면 화살 필요 (출처: SKILLS_SrvSt01 / SrvSt04 — sub_6FD119C0 탄약 확인)
    if ((s.srvStFunc === 1 || s.srvStFunc === 4) && this.isBowWeapon() && !this.ammo() && !(s.id === 0 && this.specialArrow()?.noAmmo)) {
      this.events.push({ type: 'skillUnusable', skill: s.id, reason: 'ammo' });
      return false;
    }
    // Throw: 던질 무기 수량 (SKILLS_SrvSt65)
    if (s.srvStFunc === 65) {
      const w = this.weaponItem();
      if (!w || w.quantity <= 0) return false;
    }
    if ((s.srvStFunc === 5 || s.srvStFunc === 6 || s.srvStFunc === 7 || s.srvStFunc === 32) && targetId === undefined) return false;
    // 무술 (St23 차지·St24 Dragon Talon·St25 Dragon Claw·St27 Dragon Tail): 대상 필요 (출처: SkillAss.cpp SrvSt23~27)
    if ((s.srvStFunc === 23 || s.srvStFunc === 24 || s.srvStFunc === 25 || s.srvStFunc === 27) && targetId === undefined) return false;
    // Psychic Hammer(St22): 대상이 있고 마을이 아니어야 (출처: SKILLS_SrvSt22_PsychicHammer)
    if (s.srvStFunc === 22 && (targetId === undefined || this.inTown)) return false;
    // Blade Shield(St28): 지속 공식 > 0 (출처: SKILLS_SrvSt28_BladeShield)
    if (s.srvStFunc === 28 && !(this.data?.skillCalc && this.data.skillCalc.eval(s, s.auraLenCalc, this.skillLevel(s), this.owner()) > 0)) return false;
    return true;
  }

  /**
   * Strafe(St08)·Fend(St09): 한 번 사용에 여러 발/타격. 수 = Strafe 는 반경 안 대상 수를 calc3~calc1 로 제한, Fend 는 근접 거리 대상 수(최대 calc1).
   * 발사 사이는 애니메이션을 되감는다 (Strafe par6 · Fend par2 = % 되감기). 출처: SKILLS_SrvSt08_Strafe / SrvSt09_Fend, sub_6FD15080
   * 근사(원작 미확인): 되감기 = 첫 판정 프레임 × par% 간격으로 다음 판정. Strafe 화살은 시작할 때 1개 소모 (sub_6FD118C0)
   */
  private prepareMultiShot(cast: Cast): void {
    const s = cast.skill, calc = this.data?.skillCalc, p = this.player;
    if (!calc) return;
    const o = this.owner();
    let n: number;
    if (s.srvStFunc === 8) {
      const r = calc.eval(s, s.auraRangeCalc, cast.lvl, o);
      n = strafeShots(calc.calc(s, 1, cast.lvl, o), calc.calc(s, 3, cast.lvl, o), this.monstersNear(p.x, p.y, r).length);
      if (this.isBowWeapon()) this.decQuantity('larm');
    } else {
      const inReach = this.monstersNear(p.x, p.y, 6).filter((m) => isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, m.x, m.y, m.type.sizeX, 1)).length;
      n = Math.max(1, Math.min(inReach, calc.calc(s, 1, cast.lvl, o)));
    }
    const rollback = s.srvStFunc === 8 ? (s.params[5] ?? 50) : (s.params[1] ?? 60);
    const first = cast.hitTicks[0] ?? 1, step = Math.max(2, Math.trunc((first * rollback) / 100));
    const tail = Math.max(1, cast.end - cast.start - first);
    cast.hitTicks = Array.from({ length: Math.max(1, n) }, (_, i) => first + i * step);
    cast.end = cast.start + first + (Math.max(1, n) - 1) * step + tail;
  }

  /**
   * Whirlwind(St38): 목표 지점까지 곧게 (벽에서 멈춤) 회전하며 이동. 걷기 속도의 두 배로 근사.
   * 출처: SKILLS_SrvSt38_Whirlwind (PATHTYPE_STRAIGHT, 상태 whirlwind), SKILLS_SrvDo076_Whirlwind
   * 근사(원작 미확인): 이동 속도 sub_6FD15500 의 값 대신 달리기 속도
   */
  private prepareWhirlwind(cast: Cast): void {
    const p = this.player;
    const d = Math.hypot(cast.tx - p.x, cast.ty - p.y);
    let tx = p.x, ty = p.y;
    for (let k = 0.5; k <= d; k += 0.5) {
      const x = p.x + ((cast.tx - p.x) * k) / d, y = p.y + ((cast.ty - p.y) * k) / d;
      if (!this.map.walkable(Math.floor(x), Math.floor(y))) break;
      tx = x;
      ty = y;
    }
    cast.whirl = { tx, ty, speed: (p.runVelocity * SUBTILES_PER_YARD) / ENGINE_FPS, last: -1, frame: -1 };
    cast.hitTicks = [];
    cast.end = Number.POSITIVE_INFINITY;
    const s = cast.skill;
    if (s.auraState) this.player.states.set(s.auraState, Infinity, {}, { id: s.id, lvl: cast.lvl });
  }

  /** Whirlwind 한 프레임: 이동 + 시퀀스 타격 이벤트마다 반경 5 안 적 하나(직전 대상 제외). 출처: SKILLS_SrvDo076_Whirlwind (클래식: 이벤트당 1회) */
  private updateWhirl(cast: Cast): void {
    const p = this.player, w = cast.whirl, calc = this.data?.skillCalc;
    if (!w || !calc) return;
    const s = cast.skill, o = this.owner();
    const dx = w.tx - p.x, dy = w.ty - p.y, d = Math.hypot(dx, dy);
    if (d > 1e-3) {
      const step = Math.min(w.speed, d);
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      p.dir = dir64(dx, dy);
    }
    const seq = cast.seq;
    if (seq) {
      const i = Math.floor(((this.tickCount - cast.start) * seq.rate) / 256);
      if (i !== w.frame) {
        w.frame = i;
        const f = seq.frames[i % seq.frames.length];
        if (f?.[2] === 1) {
          const t = this.monstersNear(p.x, p.y, 5).find((m) => m.id !== w.last) ?? this.monstersNear(p.x, p.y, 5)[0];
          if (t) {
            w.last = t.id;
            this.meleeHit(t, { toHitPct: calc.toHit(s, cast.lvl, o), enDmgPct: calc.calc(s, 1, cast.lvl, o), flat256: 0, elem: this.skillElemental(s, cast.lvl), hitClass: s.hitClass, srcDam: s.srcDam || 128, reach: 5 });
          } else w.last = -1;
        }
      }
    }
    if (d <= w.speed + 1e-3) {
      p.cast = null;
      p.mode = 'NU';
      p.modeStart = this.tickCount;
      if (s.auraState) p.states.remove(s.auraState);
      this.events.push({ type: 'whirlwindEnd', x: p.x, y: p.y });
    }
  }

  private isBowWeapon(): boolean {
    const w = this.weaponBase(), items = this.data?.items;
    return !!w && !!items && (items.isType(w, 'bow') || items.isType(w, 'xbow'));
  }

  /** 활에 맞는 화살통 (왼손, 무기 타입 Shoots = 화살통 타입) */
  private ammo(): ItemInstance | undefined {
    const w = this.weaponBase(), q = this.equipment.larm, items = this.data?.items;
    if (!w || !q || !items) return undefined;
    const qb = items.base(q.code);
    if (!qb || q.quantity <= 0) return undefined;
    const shoots = items.types.get(w.type)?.shoots || (items.isType(w, 'xbow') ? 'xboq' : 'bowq');
    return items.isType(qb, shoots) ? q : undefined;
  }

  /** 수량 1 감소 (화살·투척 무기). 0 이 되면 장비에서 사라진다. 출처: D2MOO sub_6FD118C0 */
  private decQuantity(slot: 'rarm' | 'larm'): void {
    const it = this.equipment[slot];
    if (!it) return;
    it.quantity--;
    if (it.quantity <= 0) {
      delete this.equipment[slot];
      this.events.push({ type: 'itemDepleted', slot, code: it.code });
    }
  }

  private updateCast(cast: Cast): void {
    const p = this.player;
    if (cast.whirl) {
      this.updateWhirl(cast);
      return;
    }
    if (cast.charge) {
      const target = cast.targetId !== undefined ? this.monsters.find((m) => m.id === cast.targetId && m.mode !== 'DT' && m.mode !== 'DD') : undefined;
      if (!target || this.tickCount >= cast.charge.until) {
        p.cast = null;
        p.mode = 'NU';
        p.modeStart = this.tickCount;
        return;
      }
      if (isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, target.x, target.y, target.type.sizeX)) {
        this.chargeStrike(cast);
      } else {
        const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1;
        const step = Math.min(cast.charge.speed, Math.max(0, d - (PLAYER_SIZE + target.type.sizeX) / 2));
        const nx = p.x + (dx / d) * step, ny = p.y + (dy / d) * step;
        if (!this.map.walkable(Math.floor(nx), Math.floor(ny))) {
          p.cast = null;
          p.mode = 'NU';
          return;
        }
        p.x = nx;
        p.y = ny;
        p.dir = dir64(dx, dy);
        return;
      }
    }
    const t = this.tickCount - cast.start;
    if (cast.leap) {
      const L = cast.leap;
      const k = Math.min(1, t / Math.max(1, L.landTick));
      p.x = L.fx + (L.tx - L.fx) * k;
      p.y = L.fy + (L.ty - L.fy) * k;
    }
    while (cast.fired < cast.hitTicks.length && t >= (cast.hitTicks[cast.fired] as number)) {
      if (cast.skill.repeat && cast.skill.srvDoFunc !== 48) this.payRepeatMana(cast);
      this.skillEvent(cast, cast.fired);
      cast.fired++;
      if (cast.skill.repeat) cast.repeatAt = this.tickCount + 2;
      if (!p.cast) return;
    }
    // 반복 스킬: 버튼을 누르고 있고 마나가 있으면 2틱마다 계속 발사 (시퀀스 입력 프레임 seqinput 에서 반복)
    // 근사(원작 미확인): 원작 시퀀스 반복 주기 대신 2틱 간격
    if (cast.skill.repeat && cast.repeatAt !== undefined && this.tickCount >= cast.repeatAt) {
      const c = this.character, calc = this.data?.skillCalc;
      if (p.holdUntil >= this.tickCount && c && calc && calc.manaCost256(cast.skill, cast.lvl) <= c.mana * 256) {
        if (cast.skill.srvDoFunc !== 48) this.payRepeatMana(cast);
        this.skillEvent(cast, cast.fired);
        cast.repeatAt = this.tickCount + 2;
        cast.end = Math.max(cast.end, this.tickCount + 3);
      } else cast.repeatAt = undefined;
    }
    if (this.tickCount >= cast.end) {
      p.cast = null;
      p.mode = 'NU';
      p.modeStart = this.tickCount;
      if (cast.skill.auraState && (cast.skill.srvDoFunc === 2 || cast.skill.srvStFunc === 32)) p.states.remove(cast.skill.auraState);
    }
  }

  private payRepeatMana(cast: Cast): void {
    const c = this.character, calc = this.data?.skillCalc;
    if (c && calc) c.mana = Math.max(0, c.mana - calc.manaCost256(cast.skill, cast.lvl) / 256);
  }

  /** 시퀀스 스킬 중이면 지금 그릴 [모드, 프레임] */
  private seqAnim(): { mode: string; frame: number } | undefined {
    const c = this.player.cast;
    if (!c?.seq) return undefined;
    const len = c.seq.frames.length;
    let i = Math.floor(((this.tickCount - c.start) * c.seq.rate) / 256);
    if (c.charge) i = i % Math.max(1, c.skill.seqInput || len);
    if (c.whirl) i = i % len;
    // 반복 스킬은 seqinput 프레임부터 다시 돈다
    if (i >= len) i = c.skill.repeat && c.skill.seqInput > 0 && c.skill.seqInput < len ? c.skill.seqInput + ((i - len) % (len - c.skill.seqInput)) : len - 1;
    const f = c.seq.frames[i];
    return f ? { mode: f[0], frame: f[1] } : undefined;
  }

  // ---------------------------------------------------------------- skills: 효과 (srvdofunc)

  /** 판정 시점 효과. 번호는 원작 skills.txt srvstfunc / srvdofunc (D2MOO Skills.cpp gpSkillSrvStartFnTable / DoFnTable) */
  private skillEvent(cast: Cast, index: number): void {
    const s = cast.skill, lvl = cast.lvl, data = this.data;
    const calc = data?.skillCalc;
    if (!data || !calc) return;
    const o = this.owner();
    const target = cast.targetId !== undefined ? this.monsters.find((m) => m.id === cast.targetId) : undefined;
    const live = target && target.mode !== 'DT' && target.mode !== 'DD' ? target : undefined;
    const elem = () => this.skillElemental(s, lvl);

    // 미사일 스킬 (srvmissile): Magic/Fire/Cold/Exploding/Ice Arrow, Poison Javelin, Lightning Bolt, Plague Javelin
    if (s.srvMissile && s.srvDoFunc === 0) {
      // Fire Blast: 던진 폭탄(pSrvHitFunc 36)은 목표 지점에 떨어진다
      const inAir = data.missiles.get(s.srvMissile);
      if (inAir?.srvHitFunc === 36) {
        this.throwLob(inAir, s, lvl, cast.tx, cast.ty);
        return;
      }
      this.launchSkillMissile(s, lvl, s.srvMissile, cast.tx, cast.ty, live?.id);
      if (s.decQuant) this.decQuantity(this.isBowWeapon() ? 'larm' : 'rarm');
      return;
    }
    switch (s.srvDoFunc || s.srvStFunc) {
      case 1: {
        // Attack: 활이면 화살, 아니면 근접. 출처: SKILLS_SrvDo001_Attack
        // 변신 중에는 근접만 (states.txt meleeonly)
        if (this.isBowWeapon() && !this.shapeState()) {
          this.launchWeaponMissile(s, lvl, cast.tx, cast.ty, live?.id);
          if (!this.specialArrow()?.noAmmo) this.decQuantity('larm');
        } else if (live && this.meleeHit(live, this.withCharges({ toHitPct: 0, enDmgPct: 0, flat256: 0, elem: null, hitClass: 0, srcDam: 128 }))) {
          // 무술 차지가 있으면 일반 공격이 명중할 때 풀린다 (출처: Skills.cpp SKILLS_SrvDo001_Attack — sub_6FCF5680/5870 후 sub_6FCF77E0)
          this.releaseCharges(live);
        }
        return;
      }
      case 2: {
        // Bash/Stun/Concentrate(St32), Power Strike(St6), Impale(St7), Vengeance(St35) — 근접 한 번
        if (!live) return;
        const spec = this.meleeSpecFor(s, lvl);
        if (s.srvStFunc === 35) {
          spec.enDmgPct = 0;
          spec.elem = null;
          spec.vengeance = { fire: calc.calc(s, 1, lvl, o), cold: calc.calc(s, 2, lvl, o), ltng: calc.calc(s, 3, lvl, o), coldLen: calc.elemLength(s, lvl, o) };
        }
        if (s.srvStFunc === 39) {
          // Berserk: 물리 피해를 calc4 % 마법으로, 사용 후 calc2 프레임(최소 10) 동안 berserk 상태 (방어 −100%). 출처: SKILLS_SrvSt39_Berserk
          spec.convPct = calc.calc(s, 4, lvl, o);
          spec.convType = s.eType;
          const stats: Record<string, number> = {};
          for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
          this.player.states.set(s.auraState, this.tickCount + Math.max(10, calc.calc(s, 2, lvl, o)), stats, { id: s.id, lvl });
        }
        this.meleeHit(live, spec);
        return;
      }
      case 64: {
        // Sacrifice: 피해 +calc1%, 명중 보너스, 준 피해의 calc2% 자해. 출처: SKILLS_SrvSt29 / SrvDo064_Sacrifice
        if (!live) return;
        this.meleeHit(live, { toHitPct: calc.toHit(s, lvl, o), enDmgPct: calc.calc(s, 1, lvl, o), flat256: 0, elem: elem(), hitClass: 0, srcDam: s.srcDam || 128, selfDamagePct: calc.calc(s, 2, lvl, o) });
        return;
      }
      case 150: {
        // Smite: 방패 피해 +calc1%, 항상 명중, calc2 프레임 기절. 출처: SKILLS_SrvDo150_Smite (HitClass 0x65)
        if (!live) return;
        this.meleeHit(live, { toHitPct: 0, enDmgPct: calc.calc(s, 1, lvl, o), flat256: 0, elem: elem(), hitClass: 0x65, srcDam: 128, shield: true, stunLen: calc.calc(s, 2, lvl, o) });
        return;
      }
      case 13: {
        // Zeal: 타격마다 근처(근접 거리) 적 하나, 피해 +calc2%, 명중 보너스. 출처: SKILLS_SrvDo013_Fend_Zeal_Fury
        const p = this.player;
        const inReach = (m: MonsterUnit) => isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, m.x, m.y, m.type.sizeX, 1);
        // Fend(St09): 타격마다 근접 거리 안의 다른 대상 (출처: SKILLS_SrvDo013 — 직전 대상 제외 sub_6FD107F0)
        const t = s.srvStFunc === 9 ? this.nextSpreadTarget(cast, p.x, p.y, 6, inReach)
          : live && inReach(live) ? live : this.monstersNear(p.x, p.y, 4).find(inReach);
        if (!t) return;
        cast.targetId = t.id;
        p.dir = dir64(t.x - p.x, t.y - p.y);
        this.meleeHit(t, { toHitPct: calc.toHit(s, lvl, o), enDmgPct: calc.calc(s, 2, lvl, o), flat256: 0, elem: s.eType ? elem() : null, hitClass: s.hitClass, srcDam: s.srcDam || 128 });
        return;
      }
      case 67: {
        // Charge: 돌진 끝의 일격 — 피해 +calc1%, 명중 보너스. 출처: SKILLS_SrvDo067_Charge
        if (live) this.meleeHit(live, { toHitPct: calc.toHit(s, lvl, o), enDmgPct: calc.calc(s, 1, lvl, o), flat256: 0, elem: elem(), hitClass: 0, srcDam: s.srcDam || 128 });
        return;
      }
      case 73: {
        // Blessed Hammer: 캐릭터 둘레로 나선을 그리며 퍼지는 망치. 출처: SKILLS_SrvDo073_BlessedHammer (PATHTYPE_BLESSEDHAMMER)
        const def = data.missiles.get(s.srvMissileA);
        if (def) this.spawnPlayerMissile(def, s, lvl, cast.tx, cast.ty, undefined, { srcDam: 0, useSkillDamage: true, spiral: true });
        return;
      }
      case 3: {
        // Throw: 들고 있는 투척 무기를 던진다. 출처: SKILLS_SrvDo003_Throw
        this.launchWeaponMissile(s, lvl, cast.tx, cast.ty, live?.id, true);
        this.decQuantity('rarm');
        return;
      }
      case 6: {
        // Inner Sight / Slow Missiles: 범위 안 적에게 상태. 출처: SKILLS_SrvDo006
        const range = calc.eval(s, s.auraRangeCalc, lvl, o);
        const len = calc.eval(s, s.auraLenCalc, lvl, o);
        const stat = s.auraStats[0];
        for (const m of this.monstersNear(this.player.x, this.player.y, range)) {
          m.states.set(s.auraTargetState, this.tickCount + len, stat ? { [stat.stat]: calc.eval(s, stat.calc, lvl, o) } : {});
        }
        return;
      }
      case 7: {
        // Jab: 시퀀스의 매 타격마다 근접. 출처: SKILLS_SrvDo007_Jab
        if (live) this.meleeHit(live, { toHitPct: calc.toHit(s, lvl, o), enDmgPct: calc.calc(s, 1, lvl, o), flat256: 0, elem: elem(), hitClass: s.hitClass, srcDam: s.srcDam || 128 });
        return;
      }
      case 8: {
        // Multiple Shot: calc1 발, 조준선에 수직으로 펼침. 출처: SKILLS_SrvDo008_MultipleShot
        const count = Math.max(1, calc.calc(s, 1, lvl, o));
        const missName = this.weaponWclass() === 'XBW' && s.srvMissileB ? s.srvMissileB : s.srvMissileA;
        const def = data.missiles.get(missName);
        if (!def) return;
        // Teeth(스킬 연결 미사일)는 스킬 피해, Multiple Shot 은 무기 피해 × SrcDamage (출처: MISSILE_CalculateDamageData)
        const skillMissile = !!def.skill;
        const p = this.player;
        let ux = cast.tx - p.x, uy = cast.ty - p.y;
        const d = Math.hypot(ux, uy) || 1;
        ux /= d;
        uy /= d;
        for (let i = 0; i < count; i++) {
          const off = i - (count - 1) / 2;
          this.spawnPlayerMissile(def, s, lvl, cast.tx - uy * off, cast.ty + ux * off, undefined, skillMissile ? { srcDam: 0, useSkillDamage: true } : { srcDam: def.srcDamage, useSkillDamage: false });
        }
        if (this.isBowWeapon()) this.decQuantity('larm');
        return;
      }
      case 10: {
        // Guided Arrow / Bone Spirit: 대상을 따라가는 미사일, 피해 +calc1%. 대상 없이 쏘면 목표 지점까지 간 뒤 Param2 반경 안 적을 찾는다.
        // 출처: SKILLS_SrvDo010_GuidedArrow_BoneSpirit, MISSMODE_SrvDo07 / SrvHit10 (Bone Spirit 은 무기 피해 없음 — 미사일 SrcDamage 0)
        const def = data.missiles.get(s.srvMissileA);
        if (!def) return;
        const bonus = calc.calc(s, 1, lvl, o);
        const bow = this.isBowWeapon();
        const seek = live ? undefined : { tx: cast.tx, ty: cast.ty, radius: def.params[1] || 15 };
        this.spawnPlayerMissile(def, s, lvl, cast.tx, cast.ty, live?.id, { srcDam: bow ? 128 : 0, useSkillDamage: true, damagePct: bonus, homing: true, seek });
        if (bow) this.decQuantity('larm');
        return;
      }
      case 11: {
        // Charged Strike: 근접 + 대상에서 번개 볼트 calc1 개. 출처: SKILLS_SrvSt06 + SrvDo011
        if (!live) return;
        this.meleeHit(live, this.meleeSpecFor(s, lvl));
        const def = data.missiles.get(s.srvMissileA);
        const n = calc.calc(s, 1, lvl, o);
        if (def) {
          for (let i = 0; i < n; i++) {
            const a = this.rng.pick(64) * (Math.PI / 32);
            this.spawnPlayerMissile(def, s, lvl, live.x + Math.cos(a) * 10, live.y + Math.sin(a) * 10, undefined, { from: { x: live.x, y: live.y }, srcDam: 0, useSkillDamage: true, wander: true });
          }
        }
        return;
      }
      case 22: {
        const def = data.missiles.get(s.srvMissileA);
        if (def && def.srvHitFunc !== 17) {
          // Nova / Frost Nova: 64방향으로 퍼지는 미사일, 한 적은 한 번만. 출처: SKILLS_SrvDo022_NovaAttack + sub_6FD14170 (64방향 표)
          const group = new Set<number>();
          const vel = def.vel + calc.calc(s, 1, lvl, o);
          const p = this.player;
          for (let i = 0; i < 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            this.spawnPlayerMissile(def, s, lvl, p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30, undefined, { srcDam: 0, useSkillDamage: true, group, velocity: vel });
          }
          return;
        }
        // Howl: 퍼져 나가는 함성에 닿은 적이 공포(도주). 출처: SKILLS_SrvDo022 + MISSMODE_SrvHit17_Howl
        const radius = def ? missileStep(def.vel) * def.range : 6;
        const pl = this.character?.level ?? 1;
        const dur = s.params[4]! + (lvl - 1) * s.params[5]!;
        for (const m of this.monstersNear(this.player.x, this.player.y, radius)) {
          if (m.states.has('terror')) continue;
          // 원작: 스킬레벨 + par2 + 캐릭터레벨 > 몬스터레벨 이어야 공포
          if (lvl + (s.params[1] ?? 0) + pl <= m.stats.level) continue;
          m.states.set('terror', this.tickCount + dur);
          m.path = [];
          m.nextThink = this.tickCount;
        }
        return;
      }
      case 17: {
        // Charged Bolt: calc1 개의 볼트가 대상 방향으로 흩어져 나감. 출처: SKILLS_SrvDo017_ChargedBolt (PATHTYPE_CHARGEDBOLT)
        const def = data.missiles.get(s.srvMissileA);
        if (!def) return;
        const n = Math.max(1, calc.calc(s, 1, lvl, o));
        const p = this.player;
        const base = Math.atan2(cast.ty - p.y, cast.tx - p.x);
        for (let i = 0; i < n; i++) {
          const a = base + ((this.rng.pick(9) - 4) * Math.PI) / 12;
          this.spawnPlayerMissile(def, s, lvl, p.x + Math.cos(a) * 10, p.y + Math.sin(a) * 10, undefined, { srcDam: 0, useSkillDamage: true, wander: true });
        }
        return;
      }
      case 18: {
        // 자신에게 버프 (Frozen/Shiver/Chilling·Bone Armor, Fade·Burst of Speed·Venom): 같은 states.txt group 의 상태를 먼저 지운다.
        // 상태 스탯 = aurastat1~6 + passivestat1~5. 출처: SKILLS_SrvDo018_DefensiveBuff (SkillSor.cpp:338)
        const group = data.stateGroups?.get(s.auraState);
        for (const st of this.player.states.names()) if (st === s.auraState || (group && data.stateGroups?.get(st) === group)) this.player.states.remove(st);
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) stats[a.stat] = (stats[a.stat] ?? 0) + calc.eval(s, a.calc, lvl, o);
        for (const ps of s.passiveStats) stats[ps.stat] = (stats[ps.stat] ?? 0) + calc.eval(s, ps.calc, lvl, o);
        // 지속 공식이 없으면(Bone Armor) 흡수량이 다할 때까지 (원작 curse.nDuration 0 = 만료 없음)
        const len = calc.eval(s, s.auraLenCalc, lvl, o);
        this.player.states.set(s.auraState, len > 0 ? this.tickCount + len : Infinity, stats, { id: s.id, lvl });
        return;
      }
      case 19: {
        // Inferno: 불꽃 미사일 한 개, 수명 = calc1 프레임. 출처: SKILLS_DoInferno
        const def = data.missiles.get(s.srvMissileA);
        if (def) this.spawnPlayerMissile(def, s, lvl, cast.tx, cast.ty, undefined, { srcDam: 0, useSkillDamage: true, range: Math.max(1, calc.calc(s, 1, lvl, o)) });
        return;
      }
      case 20: {
        // Static Field: 반경(aurarange) 안 적의 현재 생명 calc1% 번개 피해 (1 은 남김, 최소 calc2). 출처: SKILLS_AuraCallback_StaticField
        const range = calc.eval(s, s.auraRangeCalc, lvl, o);
        const pct = calc.calc(s, 1, lvl, o), minDmg = calc.calc(s, 2, lvl, o);
        for (const m of this.monstersNear(this.player.x, this.player.y, range)) {
          const hp = Math.floor(m.hp);
          if (hp < 1) continue;
          let dmg = Math.min(Math.trunc((hp * pct) / 100), hp - 1) * 256;
          if (dmg < minDmg) dmg = minDmg;
          // 음수 저항이면 저항 적용 후 같은 비율이 되도록 미리 나눈다
          const res = m.type.resist.li;
          if (res < 0) dmg = Math.trunc((100 * dmg) / (100 - res));
          const d = emptyDamage();
          addElemental(d, s.eType, dmg, 0);
          d.hitClass = 0x0d;
          this.damageMonster(m, d);
        }
        return;
      }
      case 21: {
        // Telekinesis: 바닥 물약·골드·두루마리는 줍고, 적이면 번개 피해 + par2% 밀쳐내기. 출처: SKILLS_SrvDo021_Telekinesis
        if (cast.targetItem !== undefined) {
          const g = this.ground.find((x) => x.item.id === cast.targetItem);
          const b = g ? data.items.base(g.item.code) : undefined;
          if (g && b && ['gold', 'scro', 'pots', 'misl', 'key', 'poti'].some((t) => b.code === 'gld' || data.items.isType(b, t))) this.pickUp(g);
          return;
        }
        if (!live || this.inTown) return;
        const d = emptyDamage();
        const pmin = calc.minPhys256(s, lvl, o), pmax = calc.maxPhys256(s, lvl, o);
        if (pmax > 0) d.phys = pmin + this.rng.pick(Math.max(0, pmax - pmin));
        const el = elem();
        if (el) addElemental(d, el.eType, el.amount, el.len);
        if (s.hitClass) d.hitClass = s.hitClass;
        this.damageMonster(live, d);
        if (live.mode !== 'DT' && this.rng.pick(100) < (s.params[1] ?? 0)) this.knockBack(live);
        return;
      }
      case 23: {
        // Blaze: 자신에게 상태 — 움직이면 발밑에 불을 남긴다. 출처: SKILLS_SrvDo023_Blaze + SKILLS_CreateBlazeMissile
        this.player.states.set(s.auraState, this.tickCount + calc.eval(s, s.auraLenCalc, lvl, o), {}, { id: s.id, lvl });
        this.player.lastBlaze = undefined;
        return;
      }
      case 24: {
        // Fire Wall: 목표 지점에서 캐릭터 방향에 수직인 양쪽으로 불을 뻗는 생성기 2개. 출처: SKILLS_SrvDo024_FireWall
        const def = data.missiles.get(s.srvMissileA);
        if (!def || this.inTown) return;
        const p = this.player;
        const dx = p.x - cast.tx, dy = p.y - cast.ty;
        for (const sign of [1, -1]) {
          this.spawnPlayerMissile(def, s, lvl, cast.tx - sign * dy, cast.ty + sign * dx, undefined, { from: { x: cast.tx, y: cast.ty }, srcDam: 0, useSkillDamage: true });
        }
        return;
      }
      case 25: {
        // Enchant: 대상 아군(없으면 자신)에게 화염 피해·명중 버프. 출처: SKILLS_SrvDo025_Enchant
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) {
          const v = calc.eval(s, a.calc, lvl, o);
          if (v) stats[a.stat] = v;
        }
        this.player.states.set(s.auraState, this.tickCount + calc.eval(s, s.auraLenCalc, lvl, o), stats, { id: s.id, lvl });
        return;
      }
      case 26: {
        // Chain Lightning: 대상에게 번개, 맞으면 aurarange 안 다른 적에게 calc1 번까지 이어짐. 출처: SKILLS_SrvDo026 + SrvHit12
        const def = data.missiles.get(s.srvMissileA);
        if (!def) return;
        const jumps = calc.calc(s, 1, lvl, o);
        const range = Math.max(1, calc.eval(s, s.auraRangeCalc, lvl, o));
        this.spawnPlayerMissile(def, s, lvl, cast.tx, cast.ty, live?.id, { srcDam: 0, useSkillDamage: true, chain: { left: jumps, range } });
        return;
      }
      case 27: {
        // Teleport: 목표 지점으로 즉시 이동 (마을에서는 불가). 출처: SKILLS_SrvDo027_Teleport
        if (this.inTown) return;
        const spot = nearestWalkable(this.map, { x: cast.tx, y: cast.ty }, 4);
        if (spot) {
          this.player.x = spot.x + 0.5;
          this.player.y = spot.y + 0.5;
          this.player.path = [];
          this.events.push({ type: 'teleported', x: this.player.x, y: this.player.y });
        }
        return;
      }
      case 30:
      case 61: {
        // 저주: 목표 지점 aurarange 안 적에게 auratargetstate + aurastat, 지속 auralen. 한 몬스터에는 저주 하나 (새 저주가 덮어씀)
        // 출처: D2MOO SKILLS_SrvDo030_Curse / SrvDo061_Confuse (Dim Vision·Terror 지속은 AiCurseDivisor 로 나눔 — Normal 1)
        const range = calc.eval(s, s.auraRangeCalc, lvl, o);
        const len = calc.eval(s, s.auraLenCalc, lvl, o);
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
        for (const m of this.monstersNear(cast.tx, cast.ty, range)) {
          for (const c of CURSE_STATES) if (c !== s.auraTargetState) m.states.remove(c);
          m.states.set(s.auraTargetState, this.tickCount + len, stats, { id: s.id, lvl });
          if (s.auraTargetState === 'terror' || s.auraTargetState === 'confuse') m.nextThink = this.tickCount;
        }
        return;
      }
      case 31: {
        // Raise Skeleton / Skeletal Mage: 시체 자리에 소환, 시체는 사라진다. 출처: SKILLS_SrvDo031_RaiseSkeleton_Mage
        if (!target || target.mode !== 'DD' || target.corpseUsed || !s.summon) return;
        const extra: Partial<PetInfo> = {};
        if (s.sumSkill1) {
          // 스켈레톤 메이지: 원소 미사일 (necromage1~4 중 하나), 레벨 = sumsk1calc
          // 근사(원작 미확인): 원작은 소환 때 외형 성분(D2GAME_SetUnitComponent)으로 원소를 정한다 — 여기선 무작위
          extra.missile = `necromage${1 + this.rng.pick(4)}`;
          extra.missileLvl = Math.max(1, calc.eval(s, s.sumSk1Calc, lvl, o));
        }
        const pet = this.summonPet(s, lvl, s.summon, target.x, target.y, s.petType, extra);
        if (pet) this.monsters.splice(this.monsters.indexOf(target), 1);
        return;
      }
      case 56: {
        // Clay Golem / Blood Golem: 목표 지점에 골렘 (하나만). 출처: SKILLS_SrvDo056_Golem
        if (s.summon) this.summonPet(s, lvl, s.summon, cast.tx, cast.ty, s.petType);
        return;
      }
      case 60: {
        // Bone Wall: 목표 지점을 지나 캐릭터 방향에 수직인 뼈벽 줄. 출처: SKILLS_SrvDo060_BoneWall (bonewallmaker 미사일이 양쪽으로 뻗으며 설치)
        // 근사(원작 미확인): 미사일 대신 Range + LevRange×레벨 만큼 2 서브타일 간격으로 바로 설치, 수명 par2(600) 프레임
        const maker = data.missiles.get(s.srvMissileA);
        const steps = maker ? Math.max(1, Math.trunc(((maker.range + lvl * maker.levRange) * missileStep(maker.vel)) / 2)) : 4;
        const p = this.player;
        let px = -(cast.ty - p.y), py = cast.tx - p.x;
        const pl = Math.hypot(px, py) || 1;
        px /= pl;
        py /= pl;
        for (let k = -steps; k <= steps; k++) {
          const w = this.summonPet(s, lvl, s.summon || 'bonewall', cast.tx + px * k * 2, cast.ty + py * k * 2, 'none');
          if (w?.pet) w.pet.expires = this.tickCount + (s.params[1] || 600);
        }
        return;
      }
      case 32: {
        // Poison Dagger: 단검 근접 + 독 (명중 보너스). 출처: SKILLS_SrvSt16 / SrvDo032_PoisonDagger
        if (live) this.meleeHit(live, { toHitPct: calc.toHit(s, lvl, o), enDmgPct: 0, flat256: 0, elem: elem(), hitClass: 0, srcDam: s.srcDam || 128 });
        return;
      }
      case 55: {
        // Corpse Explosion: 시체 최대 생명(평균) × calc1~calc2 %, 반경 aurarange/2, calc3 % 는 화염 나머지 물리. 출처: SKILLS_SrvDo055_CorpseExplosion
        if (!target || target.mode !== 'DD' || target.corpseUsed) return;
        this.explodeCorpse(s, lvl, target, this.character?.level ?? 1);
        return;
      }
      case 63: {
        // Poison Explosion: 시체 → 반경 aurarange 에 독 + 독 구름. 출처: SKILLS_SrvDo063_PoisonExplosion
        if (!target || target.mode !== 'DD' || target.corpseUsed) return;
        target.corpseUsed = true;
        const radius = calc.eval(s, s.auraRangeCalc, lvl, o);
        for (const m of this.monstersNear(target.x, target.y, radius)) {
          const el = elem();
          if (!el) break;
          const d = emptyDamage();
          addElemental(d, el.eType, el.amount, el.len);
          this.damageMonster(m, d);
        }
        const def = data.missiles.get(s.srvMissileA);
        if (def) {
          const owner = { ownerId: this.player.id, ownerLevel: this.character?.level ?? 1, lvl, skill: s } as Missile;
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            this.spawnCloud(def, target.x + Math.cos(a) * 1.5, target.y + Math.sin(a) * 1.5, this.missileDamageRoller(def, s, lvl, { srcDam: 0, useSkillDamage: true }), owner);
          }
        }
        return;
      }
      case 68: {
        // Shout / Battle Cry: 함성. Shout 는 자신(아군)에게, Battle Cry 는 주변 적에게 저주. 출처: SKILLS_SrvDo068_BasicShout, SrvHit18/21
        const def = data.missiles.get(s.srvMissileA);
        const radius = def ? missileStep(def.vel) * def.range : 6;
        if (def && def.srvDmgFunc === 7) {
          // War Cry: 64방향 충격파 — 스킬 물리 피해 + 기절 (par1 + (lvl−1) × par2). 출처: SKILLS_SrvDo068 (sub_6FD14170 노바) + MISSMODE_SrvDmg07_Warcry
          if (this.inTown) return;
          const group = new Set<number>();
          const p = this.player;
          for (let i = 0; i < 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            this.spawnPlayerMissile(def, s, lvl, p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30, undefined, { srcDam: 0, useSkillDamage: true, group });
          }
          return;
        }
        // 함성 충격파 그림 (battleorders·battlecommand = BAYellShockWave01): 8방향으로 근사
        if (def && (s.auraState || s.auraTargetState)) {
          const p = this.player, life = def.range;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            this.spawnVisual(def.name, p.x, p.y, { life, to: { x: p.x + Math.cos(a) * radius, y: p.y + Math.sin(a) * radius } });
          }
        }
        const len = calc.eval(s, s.auraLenCalc, lvl, o);
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
        if (s.auraState) this.player.states.set(s.auraState, this.tickCount + len, stats, { id: s.id, lvl });
        else if (s.auraTargetState) for (const m of this.monstersNear(this.player.x, this.player.y, radius)) m.states.set(s.auraTargetState, this.tickCount + len, stats);
        return;
      }
      case 69:
      case 72: {
        if (target && target.mode === 'DD' && !target.corpseUsed) this.searchCorpse(s, lvl, target);
        return;
      }
      case 70: {
        // Double Swing: 두 번 휘두름 (두 번째는 왼손 무기). 한 손 무기면 같은 무기로. 출처: SKILLS_SrvDo070_DoubleSwing
        if (live) this.meleeHit(live, this.meleeSpecFor(s, lvl));
        return;
      }
      case 71: {
        // Taunt: 대상(없으면 20 이내 가장 가까운 적)에 도발 — 명중·피해 감소, 도발한 캐릭터를 향해 근접 공격
        const t = live ?? this.monstersNear(this.player.x, this.player.y, 20)[0];
        if (!t) return;
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
        const len = calc.eval(s, s.auraLenCalc, lvl, o);
        // 근사: auralencalc 가 비어 있으면(Taunt) 원작 저주 지속 0 = 해제 전까지로 본다
        t.states.set('taunt', len > 0 ? this.tickCount + len : Infinity, stats);
        t.states.remove('terror');
        t.nextThink = this.tickCount + 1;
        return;
      }
      case 74: {
        // Double Throw: 투척 무기를 번갈아 던짐, 명중·피해 보너스. 출처: SKILLS_SrvDo074_DoubleThrow
        this.launchWeaponMissile(s, lvl, cast.tx, cast.ty, live?.id, true, calc.toHit(s, lvl, o), calc.calc(s, 1, lvl, o));
        this.decQuantity('rarm');
        return;
      }
      case 77: {
        // Leap: 착지 — 주변 적 밀쳐냄. 출처: SKILLS_SrvDo077_Leap (calc1 = 반경)
        this.landLeap(cast);
        const r = calc.calc(s, 1, lvl, o);
        for (const m of this.monstersNear(this.player.x, this.player.y, r)) this.knockBack(m);
        return;
      }
      case 78: {
        // Leap Attack: 착지 후 대상 근접 공격 (calc1 = 피해%). 출처: SKILLS_SrvDo078_LeapAttack
        this.landLeap(cast);
        if (live) this.meleeHit(live, { toHitPct: calc.toHit(s, lvl, o), enDmgPct: calc.calc(s, 1, lvl, o), flat256: 0, elem: elem(), hitClass: 0, srcDam: s.srcDam || 128 });
        return;
      }
      // ------------------------------------------------ 24·30 레벨 스킬
      case 12: {
        // Strafe: 반경(aurarange) 안 적들에게 한 발씩 돌아가며 (무기 피해 × SrcDamage 96/128, 피해 +calc2%). 출처: SKILLS_SrvDo012_Strafe
        const def = data.missiles.get(this.weaponWclass() === 'XBW' && s.srvMissileB ? s.srvMissileB : s.srvMissileA);
        if (!def) return;
        const t = this.nextSpreadTarget(cast, this.player.x, this.player.y, calc.eval(s, s.auraRangeCalc, lvl, o));
        if (!t) return;
        this.player.dir = dir64(t.x - this.player.x, t.y - this.player.y);
        this.spawnPlayerMissile(def, s, lvl, t.x, t.y, undefined, { srcDam: def.srcDamage < 0 ? 0 : def.srcDamage, useSkillDamage: false, damagePct: calc.calc(s, 2, lvl, o) });
        return;
      }
      case 14: {
        // Lightning Strike: 번개 근접 (피해 +calc1%) 후 대상에서 calc1 반경 안 다른 적에게 연쇄 번개 (calc2 번). 출처: SKILLS_SrvSt10 + SrvDo014 + MISSMODE_SrvHit12
        if (!live) return;
        this.meleeHit(live, { toHitPct: 0, enDmgPct: calc.calc(s, 1, lvl, o), flat256: 0, elem: elem(), hitClass: s.hitClass, srcDam: s.srcDam || 128 });
        const def = data.missiles.get(s.srvMissileA);
        const next = this.monstersNear(live.x, live.y, calc.calc(s, 1, lvl, o)).find((m) => m.id !== live.id);
        if (!def || !next) return;
        const range = Math.max(1, calc.eval(s, s.auraRangeCalc, lvl, o));
        this.spawnPlayerMissile(def, s, lvl, next.x, next.y, next.id, { from: { x: live.x, y: live.y }, srcDam: 0, useSkillDamage: true, chain: { left: calc.calc(s, 2, lvl, o), range }, skipIds: [live.id] });
        return;
      }
      case 15: {
        // Dopplezon(Decoy): 목표 지점에 미끼 — 생명 = 캐릭터 최대 생명 × calc3%, 지속 calc2 프레임, 몬스터가 대신 노린다. 출처: SKILLS_SrvDo015_Dopplezon
        if (!s.summon || this.inTown) return;
        const hp = Math.trunc((this.maxLife() * calc.calc(s, 3, lvl, o)) / 100);
        this.summonPet(s, lvl, s.summon, cast.tx, cast.ty, s.petType, { expires: this.tickCount + calc.calc(s, 2, lvl, o) }, { hpBase: hp, level: this.character?.level ?? 1 });
        return;
      }
      case 16: {
        // Valkyrie: 발키리 소환 (생명 +calc1%, 힘·민첩·저항·방어%·명중). 출처: SKILLS_SrvDo016_Valkyrie
        // 근사(원작 미확인): calc2(아이템 레벨)로 굴리는 발키리 장비는 생략
        if (s.summon) this.summonPet(s, lvl, s.summon, cast.tx, cast.ty, s.petType);
        return;
      }
      case 9: {
        // Frenzy: 두 번 휘두름 — 맞히면 frenzy 상태 누적(스킬 레벨까지), 달리기·공격 속도 증가. 출처: SKILLS_SrvDo009_Frenzy / SKILLS_ApplyFrenzyStats
        const t = live && isInMeleeRange(this.player.x, this.player.y, PLAYER_SIZE, 0, live.x, live.y, live.type.sizeX, 1)
          ? live : this.monstersNear(this.player.x, this.player.y, 4).find((m) => isInMeleeRange(this.player.x, this.player.y, PLAYER_SIZE, 0, m.x, m.y, m.type.sizeX, 1));
        if (!t) return;
        const hit = this.meleeHit(t, { toHitPct: calc.toHit(s, lvl, o), enDmgPct: calc.calc(s, 1, lvl, o), flat256: 0, elem: null, hitClass: s.hitClass, srcDam: s.srcDam || 128, convPct: calc.calc(s, 4, lvl, o), convType: s.eType });
        if (hit) this.applyStackState(s, lvl, calc.eval(s, s.auraLenCalc, lvl, o));
        return;
      }
      case 28: {
        // Meteor / Blizzard: 목표 지점에 중심 미사일. 출처: SKILLS_SrvDo028_Meteor_Blizzard_Eruption_BaalTaunt_Catapult
        if (this.inTown) return;
        if (s.srvMissileA.startsWith('meteor')) this.castMeteor(s, lvl, cast.tx, cast.ty);
        else if (data.missiles.get(s.srvMissileA)?.srvDoFunc === 25) {
          // Fissure(Eruption): 중심 미사일이 calc2 프레임마다 반경 calc1 안에 갈라짐 (MISSMODE_SrvDo25_EruptionCenter)
          const def = data.missiles.get(s.srvMissileA);
          if (def) this.spawnPlayerMissile(def, s, lvl, cast.tx, cast.ty, undefined, { srcDam: 0, useSkillDamage: true, from: { x: cast.tx, y: cast.ty } });
        } else this.castBlizzard(s, lvl, cast.tx, cast.ty);
        return;
      }
      case 29: {
        // Thunder Storm: 자신에게 상태 (auralen 프레임) — 주기마다 반경 par7 안 적 하나에 번개. 출처: SKILLS_SrvDo029_ThunderStorm
        this.player.states.set(s.auraState, this.tickCount + calc.eval(s, s.auraLenCalc, lvl, o), {}, { id: s.id, lvl });
        this.stormNext = this.tickCount + periodicRate(calc.eval(s, s.perDelay, lvl, o));
        return;
      }
      case 144: {
        // Hydra: 목표 지점 둘레에 머리 3개 (hydra1~3), 지속 par1 + (lvl−1) × par2 프레임, Hydra 스킬 피해의 화염 볼트. 출처: SKILLS_SrvDo144_Hydra
        if (this.inTown || !s.summon) return;
        const life = (s.params[0] ?? 0) + (lvl - 1) * (s.params[1] ?? 0);
        const base = s.summon.replace(/\d+$/, '');
        for (let i = 0; i < 3; i++) {
          const pet = this.summonPet(s, lvl, `${base}${i + 1}`, cast.tx + (HYDRA_X[i] ?? 0) * 2, cast.ty + (HYDRA_Y[i] ?? 0) * 2, s.petType, { expires: this.tickCount + life, missile: 'hydra', missileLvl: lvl }, { hpBase: 1000 });
          if (pet) {
            const def = data.missiles.get('hydra');
            if (def) this.petRoll.set(pet.id, this.missileDamageRoller(def, s, lvl, { srcDam: 0, useSkillDamage: true }));
          }
        }
        return;
      }
      case 59: {
        // Attract: 대상 몬스터를 aurarange 안 다른 몬스터들의 표적으로 (auralen 프레임). 출처: SKILLS_SrvDo059_Attract + sub_6FD0BDA0
        if (!live || this.inTown) return;
        const len = Math.trunc(calc.eval(s, s.auraLenCalc, lvl, o) / (this.aiCurseDiv() || 1));
        for (const c of CURSE_STATES) if (c !== s.auraTargetState) live.states.remove(c);
        live.states.set(s.auraTargetState, this.tickCount + len, {}, { id: s.id, lvl });
        for (const m of this.monstersNear(live.x, live.y, calc.eval(s, s.auraRangeCalc, lvl, o))) {
          if (m === live || m.type.boss) continue;
          this.attracted.set(m.id, { target: live.id, until: this.tickCount + len });
          m.nextThink = this.tickCount;
        }
        return;
      }
      case 62: {
        // Bone Prison: 대상 둘레 12칸에 뼈벽 (생명 +calc1%). 출처: SKILLS_SrvDo062_BonePrison
        if (!live || this.inTown) return;
        for (let i = 0; i < 12; i++) {
          const w = this.summonPet(s, lvl, s.summon || 'bonewall', live.x + (BONE_PRISON_X[i] ?? 0), live.y + (BONE_PRISON_Y[i] ?? 0), 'none', {}, { exact: true });
          // 근사(원작 미확인): 뼈벽 몬스터 수명 = Bone Wall 과 같은 par2 최대 지속 (600 프레임)
          if (w?.pet) w.pet.expires = this.tickCount + (s.params[1] || 600);
        }
        return;
      }
      case 57: {
        // Iron Golem: 바닥의 금속 아이템을 골렘으로 — 아이템은 사라지고 골렘은 가시(thorns_percent) 상태. 출처: SKILLS_SrvSt20 / SrvDo057_IronGolem
        const g = cast.targetItem !== undefined ? this.ground.find((x) => x.item.id === cast.targetItem) : undefined;
        if (!g || !s.summon || !this.isMetalItem(g.item)) return;
        const pet = this.summonPet(s, lvl, s.summon, g.x, g.y, s.petType, {});
        if (!pet) return;
        this.ground.splice(this.ground.indexOf(g), 1);
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
        pet.states.set(s.auraState, Infinity, stats, { id: s.id, lvl });
        // 근사(원작 미확인): 원작은 아이템을 골렘에 장착해 아이템 속성을 준다 — 무기면 무기 기본 피해를 근접 피해에 더한다
        const b = data.items.base(g.item.code);
        if (b && b.maxDam > 0 && pet.pet) pet.pet.normalDamage += Math.trunc((b.minDam + b.maxDam) / 2);
        this.events.push({ type: 'ironGolem', itemId: g.item.id, petId: pet.id });
        return;
      }
      case 58: {
        // Revive: 시체를 되살려 소환수로 (생명 +calc1%, 지속 calc2 프레임, 이동 속도 +par5%). 출처: SKILLS_SrvDo058_Revive / sub_6FD0DF40
        if (!target || target.mode !== 'DD' || target.corpseUsed || target.type.boss || target.type.primeEvil) return;
        const lvlCap = Math.min(target.stats.level, this.character?.level ?? 1);
        const pet = this.summonPet(s, lvl, target.type.id, target.x, target.y, s.petType, { expires: this.tickCount + calc.calc(s, 2, lvl, o) }, { level: lvlCap });
        if (!pet) return;
        this.monsters.splice(this.monsters.indexOf(target), 1);
        pet.states.set('revive', Infinity, {});
        return;
      }
      case 79: {
        // Conversion: 근접 — 맞히면 calc1% 확률로 대상이 auralen 프레임 동안 편이 된다. 출처: SKILLS_SrvDo079_Conversion
        if (!live) return;
        const hit = this.meleeHit(live, this.meleeSpecFor(s, lvl));
        if (!hit || live.mode === 'DT' || live.mode === 'DD' || live.type.boss || live.pet) return;
        if (this.rng.pick(100) < calc.calc(s, 1, lvl, o)) {
          live.states.set(s.auraTargetState, this.tickCount + Math.max(1, calc.eval(s, s.auraLenCalc, lvl, o)), {}, { id: s.id, lvl });
          live.nextThink = this.tickCount;
          this.convertLevel(live);
          this.events.push({ type: 'converted', targetId: live.id });
        }
        return;
      }
      case 80: {
        // Fist of the Heavens: 대상 위에 지연 미사일 → 번개가 대상에 떨어지고 calc4 개의 성스러운 볼트가 aurarange 안 적에게. 출처: SKILLS_SrvDo080 + MISSMODE_SrvHit22
        const t = live ?? this.monstersNear(cast.tx, cast.ty, 6)[0];
        if (!t) return;
        this.castFistOfHeavens(s, lvl, t);
        return;
      }
      case 82: return; // Redemption 은 오라 (updateAura)
      case 75: {
        // Grim Ward: 시체를 토템으로 — 크기에 맞는 시작 미사일 뒤 calc1 프레임 동안 주변 몬스터를 겁준다. 출처: SKILLS_SrvDo075_GrimWard + MISSMODE_SrvHit26/28
        if (!target || target.mode !== 'DD' || target.corpseUsed) return;
        target.corpseUsed = true;
        this.castGrimWard(s, lvl, target);
        return;
      }
      case 76: return; // Whirlwind 판정은 updateCast (회전 이동 중 시퀀스 이벤트마다)
      // ------------------------------------------------ 어쌔신 (확장팩). 출처: D2MOO SkillAss.cpp
      case 116: return this.shapeShift(s, lvl);
      case 120: {
        // Feral Rage·Maul: 명중(St56: 스킬 명중, 피해 +calc1)하면 aurastate 차지 +1 (상한 calc2), 지속은 다시 auralencalc,
        // aurastat 는 차지 수를 레벨로 계산. 출처: SKILLS_SrvSt56_FeralRage_Maul / SKILLS_SrvDo120_FeralRage_Maul
        if (!live || !this.meleeHit(live, this.meleeSpecFor(s, lvl))) return;
        const p = this.player, st = p.states.get(s.auraState);
        const n = nextFrenzy(st?.stats.skill_frenzy ?? 0, calc.calc(s, 2, lvl, o));
        const stats: Record<string, number> = { skill_frenzy: n };
        for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, n, o);
        p.states.set(s.auraState, this.tickCount + calc.eval(s, s.auraLenCalc, lvl, o), stats, { id: s.id, lvl });
        this.statsDirty = true;
        return;
      }
      case 121: return this.rabies(s, lvl, live);
      case 122: {
        // Hunger: 물리 +calc1 % (−75), 원소, 생명 흡수 calc2 %, 마나 흡수 calc3 %. 출처: SKILLS_SrvDo122_Hunger
        if (live) this.meleeHit(live, { ...this.meleeSpecFor(s, lvl), enDmgPct: 0, physPct: calc.calc(s, 1, lvl, o), leech: { life: calc.calc(s, 2, lvl, o), mana: calc.calc(s, 3, lvl, o) } });
        return;
      }
      case 117:
      case 118: return this.druidMissiles(s, lvl, cast.tx, cast.ty, live?.id);
      case 114: return this.druidSummon(s, lvl, this.player.x, this.player.y);
      case 115: return this.druidSummon(s, lvl, cast.tx, cast.ty);
      case 119: return this.druidSummon(s, lvl, cast.tx, cast.ty);
      case 123: return this.volcano(s, lvl, cast.tx, cast.ty);
      case 124: return this.startDruidStorm(s, lvl);
      case 33: return this.psychicHammer(s, lvl, live);
      case 43: return this.shockWeb(s, lvl, cast.tx, cast.ty);
      case 44: return this.bladeSentinel(s, lvl, cast.tx, cast.ty);
      case 45: return this.placeSentry(s, lvl, cast.tx, cast.ty);
      case 49: return this.summonShadow(s, lvl);
      case 34:
      case 35: return this.chargeUp(cast, live, index);
      case 42: return this.dragonTalon(cast, live);
      case 46: return this.dragonClaw(cast, live);
      case 50: return this.dragonTail(cast, live);
      case 52: return this.dragonFlight(cast, live, index);
      case 47: return this.cloakOfShadows(s, lvl);
      case 48: return this.bladeFury(cast);
      case 51: return this.mindBlast(s, lvl, cast.tx, cast.ty);
      case 54: {
        // Blade Shield: 시작(St28)에 상태, 판정 프레임에 한 번 + 상태가 있는 동안 주기마다 (updateBladeShield)
        this.bladeShieldNext = this.tickCount;
        this.updateBladeShield();
        return;
      }
      // ------------------------------------------------ 24·30 레벨 스킬 끝
      default:
        void index;
    }
  }

  /**
   * Conversion 적중: 걸린 저주를 모두 풀고, 대상 레벨이 플레이어보다 높으면 레벨 = 플레이어 레벨, 생명·최대 생명 × 플레이어 레벨 / 대상 레벨
   * (최소 1, 생명 ≤ 최대). 원래 레벨·최대 생명은 저장 (한 번만).
   * 출처: D2MOO SkillPal.cpp SKILLS_SrvDo079_Conversion (STATLIST 플래그 8 = 저주 목록 해제, STATE_CONVERSION_SAVE, MONSTERUNIQUE_CalculatePercentage)
   */
  private convertLevel(m: MonsterUnit): void {
    for (const cs of CURSE_STATES) m.states.remove(cs);
    const tl = m.stats.level, pl = this.character?.level ?? 1;
    if (!tl || pl >= tl || m.conversionSave) return;
    m.conversionSave = { level: tl, maxHp: m.stats.maxHp };
    const hp = Math.trunc(m.hp), max = Math.trunc(m.stats.maxHp);
    const newMax = Math.max(1, Math.trunc((max * pl) / tl));
    const newHp = Math.min(newMax, Math.max(1, Math.trunc((hp * pl) / tl)));
    m.stats = { ...m.stats, level: pl, maxHp: newMax };
    m.hp = newHp;
  }

  /**
   * Conversion 이 풀림: 레벨·최대 생명을 되돌리고 생명 = 원래 최대 × 지금 생명 / 지금 최대, 저주 해제.
   * 출처: SkillPal.cpp SKILLS_StatRemoveCallback_Conversion
   */
  private unconvert(m: MonsterUnit): void {
    for (const cs of CURSE_STATES) m.states.remove(cs);
    const save = m.conversionSave;
    if (!save || m.mode === 'DT' || m.mode === 'DD') return;
    m.conversionSave = undefined;
    const max = Math.trunc(m.stats.maxHp);
    const hp = max ? Math.trunc((save.maxHp * Math.trunc(m.hp)) / max) : 1;
    m.stats = { ...m.stats, level: save.level, maxHp: save.maxHp };
    m.hp = Math.max(1, hp);
  }

  /** St32(Bash/Stun/Concentrate)·St6(Power Strike)·St7(Impale) 근접 사양 */
  private meleeSpecFor(s: SkillRecord, lvl: number): MeleeSpec {
    const calc = this.data?.skillCalc as SkillCalc;
    const o = this.owner();
    // 출처: SKILLS_SrvSt06 — Power Strike / Charged Strike 는 명중 보너스를 넘기지 않는다 (GetResultFlags(…, 0, 0))
    const toHitPct = s.srvStFunc === 6 ? 0 : calc.toHit(s, lvl, o);
    return {
      toHitPct,
      enDmgPct: calc.calc(s, 1, lvl, o),
      // 출처: SKILLS_SrvSt32 — 피해 계산 후 calc2 << 8 을 더한다 (Bash +1/레벨)
      flat256: s.srvStFunc === 32 ? calc.calc(s, 2, lvl, o) * 256 : 0,
      elem: this.skillElemental(s, lvl),
      hitClass: s.hitClass,
      srcDam: s.srcDam || 128,
    };
  }

  /** 스킬 원소 피해 굴림 (EType, 최소~최대, 지속). 출처: D2GAME_RollElementalDamage */
  private skillElemental(s: SkillRecord, lvl: number): { eType: string; amount: number; len: number } | null {
    const calc = this.data?.skillCalc;
    if (!calc || !s.eType) return null;
    const o = this.owner();
    const min = calc.minElem256(s, lvl, o, true), max = calc.maxElem256(s, lvl, o, true);
    const len = calc.elemLength(s, lvl, o);
    if (max <= 0 && len <= 0) return null;
    return { eType: s.eType, amount: min + this.rng.pick(Math.max(0, max - min)), len };
  }

  /** 마지막 근접 판정의 물리 피해 (저항 전, 1/256) — Dragon Tail 화염 폭발 */
  private lastMeleePhys = 0;

  /**
   * 발차기 물리 (1/256): 스킬 물리 × (100 + ED)% + 발차기 × 256 × (100 + ED + 장화 Str/Dex 보너스 + damagepercent)%.
   * 출처: SkillAss.cpp sub_6FCF7CE0, D2Skills.cpp SKILLS_CalculateKickDamage
   */
  private rollKick(spec: MeleeSpec): number {
    const data = this.data, calc = data?.skillCalc, c = this.character;
    if (!data || !calc || !c || !spec.kick) return 0;
    const { s, lvl } = spec.kick, o = this.owner();
    const smin = calc.minPhys256(s, lvl, o), smax = calc.maxPhys256(s, lvl, o);
    const boots = this.equipment.feet ? data.items.base(this.equipment.feet.code) : undefined;
    const k = kickDamage(boots, this.derived()?.stat('item_kickdamage') ?? 0, this.effStat('str'), this.effStat('dex'), spec.enDmgPct + this.playerStat('damagepercent') + (this.derived()?.offWeaponEdPct ?? 0));
    const pct = (v: number, p: number) => Math.trunc((v * p) / 100);
    const min = smin + pct(smin, spec.enDmgPct) + pct(k.min * 256, k.pct) + k.min * 256;
    const max = smax + pct(smax, spec.enDmgPct) + pct(k.max * 256, k.pct) + k.max * 256;
    return min + this.rng.pick(Math.max(0, max - min));
  }

  /** 발차기 한 번: 명중 = progressive_tohit + 스킬 명중, 스킬 원소 피해 (sub_6FCF7BC0) */
  private kick(s: SkillRecord, lvl: number, t: MonsterUnit, enDmgPct: number, knockback: boolean): boolean {
    const calc = this.data?.skillCalc;
    if (!calc) return false;
    return this.meleeHit(t, this.withCharges({ toHitPct: calc.toHit(s, lvl, this.owner()), enDmgPct, flat256: 0, elem: this.skillElemental(s, lvl), hitClass: 1, srcDam: s.srcDam || 128, kick: { s, lvl }, knockback }));
  }

  /** 넉백 확률: 플레이어·용병 calc4, 보스 calc3, 유니크 calc2, 그 밖 100 (SrvDo042 / SrvDo033 와 같은 표) */
  private finisherKnockChance(s: SkillRecord, lvl: number, t: MonsterUnit): number {
    const calc = this.data?.skillCalc;
    if (!calc) return 0;
    if (t.type.boss) return calc.calc(s, 3, lvl, this.owner());
    if (t.flags & 8) return calc.calc(s, 2, lvl, this.owner());
    return 100;
  }

  /**
   * Dragon Talon: 시작할 때 첫 발 (St24), 남은 calc1 − 1 발은 판정마다 — 그때 차지를 풀고 다음 발, 마지막 발만 넉백 (확률표).
   * 발이 남았는데 시퀀스 판정이 끝나면 시퀀스를 처음부터 되감는다 (sub_6FD15080(100)).
   * 출처: SkillAss.cpp SKILLS_SrvSt24_DragonTalon / SrvDo042_DragonTalon
   */
  private dragonTalon(cast: Cast, t: MonsterUnit | undefined): void {
    const s = cast.skill, lvl = cast.lvl;
    if (!t || t.mode === 'DT' || t.mode === 'DD') return;
    if (cast.lastHit) this.releaseCharges(t);
    const left = (cast.kicksLeft ?? 0) - 1;
    if (left < 0) return;
    cast.kicksLeft = left;
    const knock = left <= 0 && this.rng.pick(100) < this.finisherKnockChance(s, lvl, t);
    cast.lastHit = this.kick(s, lvl, t, linearPct(s.params[0] ?? 0, s.params[1] ?? 0, lvl), knock);
    if (left > 0 && cast.fired >= cast.hitTicks.length - 1) {
      // 되감기: 첫 판정까지의 시간만큼 뒤에 다음 판정
      const t0 = this.tickCount - cast.start, gap = Math.max(2, cast.hitTicks[0] ?? 4);
      cast.hitTicks.push(t0 + gap);
      cast.end = Math.max(cast.end, cast.start + t0 + gap + 4);
    }
  }

  /** Dragon Talon 첫 발 (시작 함수). 대상이 근접 거리에 있어야 */
  private prepareDragonTalon(cast: Cast): void {
    const s = cast.skill, lvl = cast.lvl, calc = this.data?.skillCalc, p = this.player;
    const t = cast.targetId !== undefined ? this.monsters.find((m) => m.id === cast.targetId && m.mode !== 'DT' && m.mode !== 'DD') : undefined;
    if (!calc || !t || !isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, t.x, t.y, t.type.sizeX, 1)) {
      cast.kicksLeft = 0;
      return;
    }
    const n = calc.calc(s, 1, lvl, this.owner()) - 1;
    cast.kicksLeft = n;
    cast.lastHit = this.kick(s, lvl, t, linearPct(s.params[0] ?? 0, s.params[1] ?? 0, lvl), n === 0);
  }

  /**
   * Dragon Claw: 판정마다(손톱 두 개면 두 번) 근접 — 명중 progressive_tohit + 스킬, 피해 + calc1 %, 원소면 calc4 % 변환, 명중하면 차지 풀기.
   * 출처: SkillAss.cpp SKILLS_SrvDo046_DragonClaw / sub_6FCF8C70
   * 근사(원작 미확인): 두 번째 판정도 오른손 손톱 피해 (원작은 시퀀스 프레임 홀짝으로 손을 바꾼다)
   */
  private dragonClaw(cast: Cast, t: MonsterUnit | undefined): void {
    const s = cast.skill, lvl = cast.lvl, calc = this.data?.skillCalc;
    if (!t || !calc) return;
    const o = this.owner();
    const spec: MeleeSpec = { toHitPct: calc.toHit(s, lvl, o), enDmgPct: calc.calc(s, 1, lvl, o), flat256: 0, elem: s.eType ? this.skillElemental(s, lvl) : null, hitClass: 0, srcDam: s.srcDam || 128 };
    if (s.eType) {
      spec.convPct = calc.calc(s, 4, lvl, o);
      spec.convType = s.eType;
    }
    if (this.meleeHit(t, this.withCharges(spec))) this.releaseCharges(t);
  }

  /**
   * Dragon Tail: 시작할 때 발차기 (St27, 공속 par4), 판정 프레임에 차지 풀기 + 대상 반경 aurarange 에 화염 = 발차기 물리 × (passive_fire_mastery + calc1) %.
   * 출처: SkillAss.cpp SKILLS_SrvSt27_DragonTail / SrvDo050_DragonTail
   */
  private dragonTail(cast: Cast, t: MonsterUnit | undefined): void {
    const s = cast.skill, lvl = cast.lvl, calc = this.data?.skillCalc;
    if (!t || !calc || !cast.lastHit) return;
    const phys = cast.lastPhys ?? 0;
    this.releaseCharges(t);
    if (this.isDead) return;
    const pct = this.playerStat('passive_fire_mastery') + calc.calc(s, 1, lvl, this.owner());
    const d = emptyDamage();
    addElemental(d, 'fire', Math.trunc((phys * pct) / 100), 0);
    for (const m of this.monstersNear(t.x, t.y, calc.eval(s, s.auraRangeCalc, lvl, this.owner()))) this.damageMonster(m, { ...d });
    this.events.push({ type: 'dragonTail', x: t.x, y: t.y });
  }

  /**
   * Dragon Flight: 첫 판정에 대상 곁으로 순간이동 (마을 불가), 다음 판정에 발차기 (피해 par1 + (lvl−1)·par2 %) 후 차지 풀기.
   * 출처: SkillAss.cpp SKILLS_SrvDo052_DragonFlight (시퀀스 프레임 홀짝)
   */
  private dragonFlight(cast: Cast, t: MonsterUnit | undefined, index: number): void {
    const s = cast.skill, lvl = cast.lvl, p = this.player;
    if (!t || t.mode === 'DT' || t.mode === 'DD') return;
    if (index % 2 === 0) {
      if (this.inTown) return;
      const spot = nearestWalkable(this.map, { x: t.x - Math.sign(t.x - p.x), y: t.y - Math.sign(t.y - p.y) }, 3);
      if (!spot) return;
      p.x = spot.x + 0.5;
      p.y = spot.y + 0.5;
      p.path = [];
      p.dir = dir64(t.x - p.x, t.y - p.y);
      this.events.push({ type: 'teleported', x: p.x, y: p.y });
      return;
    }
    if (this.kick(s, lvl, t, linearPct(s.params[0] ?? 0, s.params[1] ?? 0, lvl), false)) this.releaseCharges(t);
  }

  /** 무술 차지 상태 목록 (states.txt progressive_*): 상태, 스킬, 레벨 (= 건 레벨과 지금 레벨 중 큰 쪽), 차지 수 */
  private chargeStates(): { state: string; s: SkillRecord; lvl: number; n: number }[] {
    const out: { state: string; s: SkillRecord; lvl: number; n: number }[] = [];
    for (const state of PROGRESSIVE_STATES) {
      const st = this.player.states.get(state);
      const s = st?.skill ? this.skillRecord(st.skill.id) : undefined;
      const stat = s?.auraStats[0]?.stat;
      if (!st?.skill || !s || !stat) continue;
      out.push({ state, s, lvl: Math.max(st.skill.lvl, this.skillLevel(s)), n: st.stats[stat] ?? 0 });
    }
    return out;
  }

  /** 지금 차지 수 (상태 이름 → 수) — 테스트·HUD */
  chargeCount(state: string): number {
    return this.chargeStates().find((c) => c.state === state)?.n ?? 0;
  }

  /**
   * 차지 쌓기 (Tiger·Cobra·Phoenix = Do034, 속성 3종 = Do035): 근접이 명중하면 aurastate 의 aurastat1 차지 +1 (최대 3),
   * 차지가 늘면 aurastat2 += aurastatcalc2 (Tiger 명중 %), 지속은 마지막 명중부터 auralencalc. 이 타격에는 쌓인 차지가 붙지 않는다.
   * 출처: SkillAss.cpp SKILLS_SrvDo034 / SrvDo035 (손톱 두 개면 시퀀스 프레임 홀짝으로 손을 번갈아)
   * 근사(원작 미확인): 손톱 두 개의 Do035 — 짝수 번째 판정은 차지 없이 일반 근접 (왼손 손톱 피해 대신 오른손)
   */
  private chargeUp(cast: Cast, live: MonsterUnit | undefined, index: number): void {
    const s = cast.skill, lvl = cast.lvl, calc = this.data?.skillCalc, p = this.player;
    if (!live || !calc) return;
    const o = this.owner();
    const spec: MeleeSpec = { toHitPct: calc.toHit(s, lvl, o), enDmgPct: 0, flat256: 0, elem: null, hitClass: 0, srcDam: s.srcDam || 128 };
    const dual = s.srvDoFunc === 35 && this.weaponWclass() === 'HT2';
    if (dual && index % 2 === 1) {
      this.meleeHit(live, spec);
      return;
    }
    if (!this.meleeHit(live, spec)) return;
    const [a1, a2] = s.auraStats;
    if (!a1) return;
    const cur = p.states.get(s.auraState);
    const old = cur?.stats[a1.stat] ?? 0, n = Math.min(old + 1, MAX_CHARGES);
    const stats: Record<string, number> = { ...(cur?.stats ?? {}), [a1.stat]: n };
    if (n !== old && a2) stats[a2.stat] = (stats[a2.stat] ?? 0) + calc.eval(s, a2.calc, lvl, o);
    p.states.remove(s.auraState);
    p.states.set(s.auraState, this.tickCount + calc.eval(s, s.auraLenCalc, lvl, o), stats, { id: s.id, lvl: Math.max(cur?.skill?.lvl ?? 0, lvl) });
    if (n !== old) this.events.push({ type: 'chargeUp', skill: s.id, charges: n, sound: s.prgSound });
  }

  /**
   * 차지 보너스를 근접 판정에 싣는다. 모든 차지: 명중 + progressive_tohit %.
   * prgdam 1 (Tiger): 피해 + 차지 × calc1 %, prgdam 2 (Cobra): 생명·마나 흡수, prgdam 4 (속성 3종): 스킬 원소 피해, 냉기 3차지 빙결 += 냉기 길이 / par5,
   * 물리의 min(calc1, 100) % 를 원소로. 출처: SkillAss.cpp sub_6FCF5680 / sub_6FCF5870 / sub_6FCF5BC0
   */
  private withCharges(spec: MeleeSpec): MeleeSpec {
    const calc = this.data?.skillCalc;
    if (!calc) return spec;
    const o = this.owner();
    spec.toHitPct += this.player.states.stat('progressive_tohit');
    for (const { s, lvl, n } of this.chargeStates()) {
      if (n <= 0) continue;
      if (s.prgDam === 1) spec.enDmgPct += n * calc.calc(s, 1, lvl, o);
      else if (s.prgDam === 2) {
        const l = cobraLeech(s.params[0] ?? 0, s.params[1] ?? 0, lvl, n);
        spec.leech = { life: (spec.leech?.life ?? 0) + l.life, mana: (spec.leech?.mana ?? 0) + l.mana };
      } else if (s.prgDam === 3 || s.prgDam === 4) {
        const el = this.skillElemental(s, lvl);
        if (el) {
          const x = emptyDamage();
          addElemental(x, el.eType, el.amount, el.len);
          if (spec.extra) addDamage(spec.extra, x);
          else spec.extra = x;
        }
        const div = s.prgDam === 3 ? (n >= 2 ? s.params[1] : 0) : n === 3 ? s.params[4] : 0;
        if (s.eType === 'cold' && div) spec.freezeDiv = div;
        if (s.prgDam === 4) {
          const pct = calc.calc(s, 1, lvl, o);
          if (pct > 0 && s.eType) (spec.prgConv ??= []).push({ pct: Math.min(pct, 100), eType: s.eType });
        }
      }
    }
    return spec;
  }

  /**
   * 차지 풀기: 명중한 대상이 근접 거리 안이면 차지마다 srvprgfunc[n−1] (prgstack 스킬은 1..n−1 함수도 먼저, 그때 차지 수 = i+1), 차지는 모두 사라진다.
   * 출처: SkillAss.cpp sub_6FCF77E0
   */
  private releaseCharges(target: MonsterUnit): void {
    const p = this.player;
    if (!isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, target.x, target.y, target.type.sizeX, 1)) return;
    for (const c of this.chargeStates()) {
      const n = Math.max(1, Math.min(MAX_CHARGES, c.n));
      if (c.s.prgStack) for (let i = 0; i < n - 1; i++) this.progressiveFn(c.s.srvPrgFunc[i] ?? 0, c.s, c.lvl, i + 1, target);
      this.progressiveFn(c.s.srvPrgFunc[n - 1] ?? 0, c.s, c.lvl, n, target);
      p.states.remove(c.state);
      this.events.push({ type: 'chargeRelease', skill: c.s.id, charges: n });
    }
  }

  /** 차지 풀기 함수 (srvprgfunc 번호 = srvdofunc). 출처: SkillAss.cpp SrvDo036~041 · 143 */
  private progressiveFn(fn: number, s: SkillRecord, lvl: number, n: number, t: MonsterUnit): void {
    const data = this.data, calc = data?.skillCalc;
    if (!data || !calc || fn <= 0) return;
    const o = this.owner(), p = this.player;
    const def = data.missiles.get(progressiveMissile(s, n));
    const amount = calc.eval(s, progressiveCalc(s, n), lvl, o) || calc.eval(s, s.auraRangeCalc, lvl, o);
    const ownOpts = { srcDam: 0, useSkillDamage: false, ownDamage: true };
    switch (fn) {
      case 36: {
        // Claws of Thunder 2차지: 대상에게 미사일 (속도 = calc1 + 미사일 속도)
        if (def) this.spawnPlayerMissile(def, s, lvl, t.x, t.y, t.id, { ...ownOpts, velocity: calc.calc(s, 1, lvl, o) + def.vel });
        return;
      }
      case 37:
      case 143: {
        // 대상 둘레 64방향 표에서 amount 간격으로 휘는 볼트 (37: Claws of Thunder 3차지, 143: Fists of Fire 1차지·Phoenix 2차지 연쇄 번개)
        // 근사(원작 미확인): 원작 경로(PATHTYPE_CHARGEDBOLT · sub_6FCF7390 물결) 대신 기존 Charged Bolt 의 흔들리는 경로
        if (!def || amount <= 0) return;
        const chain = def.name === 'royalstrikechainlightning' ? { left: (s.params[1] ?? 0) + 1, range: 8 } : undefined;
        for (let i = 0; i < 64; i += amount) {
          const a = (i / 64) * Math.PI * 2;
          this.spawnPlayerMissile(def, s, lvl, t.x + Math.cos(a) * 30, t.y + Math.sin(a) * 30, undefined, { ...ownOpts, from: { x: t.x, y: t.y }, wander: true, ...(chain ? { chain } : {}), skipIds: [t.id] });
        }
        return;
      }
      case 38: {
        // Fists of Fire·Blades of Ice 2차지: 대상 반경 amount 안 적에게 스킬 물리 + 원소
        const d = this.skillDamage(s, lvl);
        for (const m of this.monstersNear(t.x, t.y, amount)) this.damageMonster(m, { ...d });
        return;
      }
      case 39: {
        // 3차지: 반경 amount 원 안 무작위 지점 (amount² 번 시도) 에 미사일 (불길·얼음 조각)
        if (!def || amount <= 0) return;
        for (let i = 0; i < amount * amount; i++) {
          const x = amount - this.rng.pick(2 * amount), y = amount - this.rng.pick(2 * amount);
          if (x * x + y * y > amount * amount) continue;
          const px = t.x + x, py = t.y + y;
          if (!this.map.walkable(Math.floor(px), Math.floor(py))) continue;
          this.spawnPlayerMissile(def, s, lvl, px, py, undefined, { ...ownOpts, from: { x: px, y: py }, velocity: 0 });
        }
        return;
      }
      case 40: {
        // Phoenix 1차지: 대상에 운석 (royalstrikemeteorcenter → 떨어지면 royalstrikemeteor 폭발)
        if (def) this.phoenixMeteor(def, s, lvl, t.x, t.y);
        return;
      }
      case 41: {
        // Phoenix 3차지: amount 개의 얼음 조각이 대상에서 ±20 무작위 방향으로
        if (!def) return;
        for (let i = 0; i < amount; i++) {
          let dx = (this.rng.pick(40) - 20), dy = (this.rng.pick(40) - 20);
          if (!dx && !dy) dx = 20;
          this.spawnPlayerMissile(def, s, lvl, t.x + dx, t.y + dy, undefined, { ...ownOpts, from: { x: t.x, y: t.y }, skipIds: [t.id] });
        }
        return;
      }
      default:
        void p;
    }
  }

  /** Phoenix Strike 운석: 표적 Range 프레임 뒤 HitSubMissile 반경 sHitPar1 화염. 출처: royalstrikemeteorcenter (pSrvHitFunc 4) → royalstrikemeteor (pSrvHitFunc 14) */
  private phoenixMeteor(def: MissileDef, s: SkillRecord, lvl: number, tx: number, ty: number): void {
    const data = this.data;
    const boom = def.hitSubMissile1 ? data?.missiles.get(def.hitSubMissile1) : undefined;
    if (!data || !boom) return;
    const roll = this.missileOwnRoller(boom, s, lvl);
    this.spawnVisual('meteor', tx - 14, ty - 14, { life: def.range, to: { x: tx, y: ty } });
    this.missiles.push({
      id: this.nextUnitId++, def, x: tx, y: ty, dx: 0, dy: 0, left: def.range, age: 0, owner: 'player', ownerId: this.player.id, ownerLevel: this.character?.level ?? 1,
      hitClass: 0x20, roll, hit: new Set(), lvl, skill: s, noCollide: true,
      onEnd: (ms) => {
        for (const m of this.monstersNear(ms.x, ms.y, Math.max(1, boom.hitParams[0] ?? 3))) this.damageMonster(m, roll());
        this.spawnVisual('meteorexplode', ms.x, ms.y);
        this.events.push({ type: 'meteorImpact', x: ms.x, y: ms.y });
      },
    });
  }

  /**
   * 던지는 함정 (missiles.txt pSrvHitFunc 36 MissileInAir): 적과 부딪히지 않고 목표 지점까지 날아가 떨어지면 HitSubMissile1.
   * bomb on ground (pSrvHitFunc 3) 는 그 자리에서 반경 sHitPar1 (없으면 스킬 aurarange) 폭발, shock field on ground 는 남아서 닿는 적을 NextDelay 마다.
   * 출처: MissMode.cpp MISSMODE_SrvHit36_MissileInAir · SrvHit03_BombOnGround → SrvHit44 (반경)
   * 근사(원작 미확인): 포물선(lob) 높이는 그리지 않는다 — 땅 위 직선 비행
   */
  private throwLob(def: MissileDef, s: SkillRecord, lvl: number, tx: number, ty: number, from?: Pt): void {
    const data = this.data, calc = data?.skillCalc, p = this.player;
    const ground = def.hitSubMissile1 ? data?.missiles.get(def.hitSubMissile1) : undefined;
    if (!data || !calc || !ground) return;
    const o = from ?? { x: p.x, y: p.y };
    const speed = missileStep(def.vel), d = Math.hypot(tx - o.x, ty - o.y);
    const life = Math.max(1, Math.min(def.range, Math.ceil(d / Math.max(speed, 1e-3))));
    const sk = this.skillFor(ground) ?? s;
    const roll = this.missileDamageRoller(ground, sk, lvl, { srcDam: 0, useSkillDamage: true });
    this.missiles.push({
      id: this.nextUnitId++, def, x: o.x, y: o.y, dx: (tx - o.x) / life, dy: (ty - o.y) / life, left: life, age: 0, owner: 'player', ownerId: p.id, ownerLevel: this.character?.level ?? 1,
      hitClass: 0, hit: new Set(), lvl, skill: s, noCollide: true,
      onEnd: (ms) => {
        if (ground.srvHitFunc === 3) {
          const radius = ground.hitParams[0] || Math.max(calc.eval(sk, sk.auraRangeCalc, lvl, this.owner()), 1);
          for (const m of this.monstersNear(ms.x, ms.y, radius)) this.damageMonster(m, roll());
          this.spawnVisual(ground.name, ms.x, ms.y);
          this.events.push({ type: 'trapExploded', x: ms.x, y: ms.y });
          return;
        }
        this.missiles.push({
          id: this.nextUnitId++, def: ground, x: ms.x, y: ms.y, dx: 0, dy: 0, left: ground.range + lvl * ground.levRange, age: 0, owner: 'player', ownerId: p.id,
          ownerLevel: this.character?.level ?? 1, hitClass: ground.hitClass || s.hitClass || 0x40, roll, hit: new Set(), lvl, skill: sk, rehit: new Map(),
        });
      },
    });
  }

  /**
   * Shock Web: prgcalc1 개의 가시를 목표 지점 둘레 ±aurarange 무작위 지점으로 던진다 (던지는 사람과 거리 2 이상). 1 개거나 반경 < 2 면 목표 지점에 하나.
   * 출처: SkillAss.cpp SKILLS_SrvDo043_ShockField / sub_6FCF8330
   */
  private shockWeb(s: SkillRecord, lvl: number, tx: number, ty: number): void {
    const data = this.data, calc = data?.skillCalc, p = this.player;
    const def = data?.missiles.get(progressiveMissile(s, 0));
    if (!data || !calc || !def) return;
    const o = this.owner();
    const n = calc.eval(s, progressiveCalc(s, 0), lvl, o), r = calc.eval(s, s.auraRangeCalc, lvl, o);
    if (n <= 0) return;
    if (n <= 1 || r < 2) {
      this.throwLob(def, s, lvl, tx, ty);
      return;
    }
    for (let i = 0; i < n; i++) {
      const x = tx + this.rng.pick(2 * r) - r, y = ty + this.rng.pick(2 * r) - r;
      if ((x - p.x) ** 2 + (y - p.y) ** 2 >= 4) this.throwLob(def, s, lvl, x, y);
    }
  }

  /**
   * Blade Sentinel: 칼날 몬스터(bladecreeper, 함정 펫)가 던진 자리와 목표 지점 사이를 속도 15 로 오가며 닿는 적을 NextDelay(25) 마다 벤다.
   * 수명 calc4 프레임, 피해 = 스킬 물리 + 무기 × SrcDam, 명중 = 주인 AR. 출처: SkillAss.cpp SKILLS_SrvDo044_BladeSentinel,
   * AiThink.cpp AITHINK_Fn102_BladeCreeper, MissMode.cpp SrvDo20 / SrvHit37 (blade creeper 미사일)
   */
  private bladeSentinel(s: SkillRecord, lvl: number, tx: number, ty: number): void {
    const data = this.data, calc = data?.skillCalc, p = this.player;
    if (!data || !calc || !s.summon || this.inTown) return;
    const o = this.owner();
    const life = calc.calc(s, 4, lvl, o);
    const pet = this.summonPet(s, lvl, s.summon, p.x, p.y, s.petType, { expires: this.tickCount + Math.max(1, life), creeper: { ax: p.x, ay: p.y, bx: tx, by: ty, toB: true } }, { hpBase: 1000, level: this.character?.level ?? 1 });
    const def = data.missiles.get(s.srvMissileA);
    if (!pet || !def) return;
    // 칼날 미사일이 펫을 따라다닌다 (SrvDo20: 매 프레임 주인 위치로)
    this.missiles.push({
      id: this.nextUnitId++, def, x: pet.x, y: pet.y, dx: 0, dy: 0, left: Math.max(1, life), age: 0, owner: 'player', ownerId: p.id, ownerLevel: this.character?.level ?? 1,
      hitClass: s.hitClass || 0x0d, ar: this.playerAR(), roll: this.missileDamageRoller(def, s, lvl, { srcDam: s.srcDam, useSkillDamage: true }), hit: new Set(), lvl, skill: s, rehit: new Map(),
      onTick: (ms) => {
        if (!this.pets.includes(pet) || pet.mode === 'DT' || pet.mode === 'DD') ms.left = 0;
        ms.x = pet.x;
        ms.y = pet.y;
      },
    });
  }

  /**
   * 센트리 (Charged Bolt·Lightning·Wake of Fire·Wake of Inferno·Death Sentry): 목표 지점에 함정 몬스터, 레벨 = 주인 레벨, 스킬 레벨 = sumsk1calc.
   * 출처: SkillAss.cpp SKILLS_SrvDo045_Sentry (pettype assassintrap, petmax)
   */
  private placeSentry(s: SkillRecord, lvl: number, tx: number, ty: number): void {
    const calc = this.data?.skillCalc;
    if (!calc || !s.summon || this.inTown) return;
    const sumLvl = Math.max(1, calc.eval(s, s.sumSk1Calc, lvl, this.owner()) || lvl);
    this.summonPet(s, lvl, s.summon, tx, ty, s.petType, { missileLvl: sumLvl, shots: -1 }, { hpBase: 1000, level: this.character?.level ?? 1 });
  }

  /**
   * 센트리 AI: 주인이 마을에 있거나 쏠 횟수를 다 쓰면 죽는다. 쏠 횟수 = monstats Skill1 의 calc4 (첫 생각에서).
   * aip4 거리 안 적이 있으면 aip1 % 로 Skill1, 아니면 aip2 (적 없음 aip3) 프레임 쉰다.
   * Death Sentry (AI 104): 적 근처(거리 < (par3 + (lvl−1)·par4)/2) 새 시체가 있으면 Skill1 (시체 폭발), 아니면 aip3 % 로 Skill2 (번개).
   * 출처: AiThink.cpp AITHINK_Fn101_AssassinSentry / AssasinSentryHasLostTarget / Fn104_DeathSentry
   * 근사(원작 미확인): 스킬 효과는 모드 판정 프레임 대신 모드 시작에 바로
   */
  private thinkSentry(pet: MonsterUnit): void {
    const info = pet.pet as PetInfo, data = this.data, calc = data?.skillCalc;
    const ap = pet.type.aiParams;
    const sk1 = pet.type.skills[0]?.name ? data?.skills?.byNameOf(pet.type.skills[0].name) : undefined;
    if (!data || !calc || !sk1) return;
    const lvl = info.missileLvl;
    const die = () => {
      pet.hp = 0;
      this.startMonsterMode(pet, 'DT');
      this.events.push({ type: 'petDied', petId: pet.id });
    };
    if (this.inTown) return die();
    if ((info.shots ?? -1) < 0) info.shots = calc.calc(sk1, 4, lvl, this.owner());
    if ((info.shots ?? 0) <= 0) return die();
    const death = pet.type.ai === 'DeathSentry';
    const active = ap[3] ?? 15;
    const enemy = this.monstersNear(pet.x, pet.y, 40).find((m) => !m.pet);
    const idle = (n: number): void => {
      pet.nextThink = this.tickCount + Math.max(1, n);
    };
    if (!enemy) return idle(death ? ap[1] ?? 0 : ap[2] ?? 15);
    const dist = Math.hypot(enemy.x - pet.x, enemy.y - pet.y);
    if (death) {
      const reach = Math.trunc(((sk1.params[2] ?? 0) + (lvl - 1) * (sk1.params[3] ?? 0)) / 2);
      const corpse = this.monsters.find((m) => m.mode === 'DD' && !m.corpseUsed && m.id !== info.lastCorpse && Math.hypot(m.x - enemy.x, m.y - enemy.y) < Math.min(10, reach));
      if (corpse) {
        info.lastCorpse = corpse.id;
        info.shots = (info.shots ?? 1) - 1;
        this.sentryFire(pet, sk1, lvl, corpse);
        return idle(this.sentryModeLen(pet));
      }
      const sk2 = pet.type.skills[1]?.name ? data.skills?.byNameOf(pet.type.skills[1].name) : undefined;
      if (sk2 && dist < active && pet.rng.pick(100) < (ap[2] ?? 0)) {
        info.shots = (info.shots ?? 1) - 1;
        this.sentryFire(pet, sk2, lvl, enemy);
        return idle(this.sentryModeLen(pet));
      }
      return idle(ap[1] ?? 0);
    }
    if (dist >= active) return idle(ap[2] ?? 15);
    if (pet.rng.pick(100) < (ap[0] ?? 100)) {
      info.shots = (info.shots ?? 1) - 1;
      this.sentryFire(pet, sk1, lvl, enemy);
      return idle(this.sentryModeLen(pet) + (ap[1] ?? 10));
    }
    idle(ap[1] ?? 10);
  }

  private sentryModeLen(pet: MonsterUnit): number {
    return Math.max(1, pet.modeEnd - this.tickCount);
  }

  /** 센트리 스킬 한 번 (BoltSentry Do017 · sentry lightning · Wake Do125 · mon inferno sentry Do095 · mon death sentry Do055 · death sentry ltng) */
  private sentryFire(pet: MonsterUnit, sk: SkillRecord, lvl: number, t: MonsterUnit): void {
    const data = this.data, calc = data?.skillCalc;
    if (!data || !calc) return;
    const mode: MonMode = pet.type.modes.has('S1') ? 'S1' : pet.type.modes.has('A1') ? 'A1' : 'NU';
    this.startMonsterMode(pet, mode);
    pet.dir = dir64(t.x - pet.x, t.y - pet.y);
    const from = { x: pet.x, y: pet.y };
    const mname = sk.srvMissile || sk.srvMissileA;
    const def = mname ? data.missiles.get(mname) : undefined;
    const msk = def ? this.skillFor(def) ?? sk : sk;
    const opts = { srcDam: 0, useSkillDamage: true, from };
    this.events.push({ type: 'sentryFire', petId: pet.id, skill: sk.name });
    switch (sk.srvDoFunc) {
      case 17: {
        // BoltSentry: calc1 개 흔들리는 볼트 (SrvDo017 Charged Bolt)
        if (!def) return;
        const n = Math.max(1, calc.calc(sk, 1, lvl, this.owner()));
        const base = Math.atan2(t.y - from.y, t.x - from.x);
        for (let i = 0; i < n; i++) {
          const a = base + ((this.rng.pick(9) - 4) * Math.PI) / 12;
          this.spawnPlayerMissile(def, msk, lvl, from.x + Math.cos(a) * 10, from.y + Math.sin(a) * 10, undefined, { ...opts, wander: true });
        }
        return;
      }
      case 125: {
        // Wake of Fire: 불길 생성기가 대상 쪽으로 가며 양옆으로 불길 (SrvDo125 → MISSMODE_SrvDo31)
        if (!def) return;
        const sub = def.subMissile1 ? data.missiles.get(def.subMissile1) : undefined;
        const roll = this.missileDamageRoller(def, msk, lvl, { srcDam: 0, useSkillDamage: true });
        const d = Math.hypot(t.x - from.x, t.y - from.y) || 1, sp = missileStep(def.vel);
        const ux = (t.x - from.x) / d, uy = (t.y - from.y) / d;
        this.missiles.push({
          id: this.nextUnitId++, def, x: from.x, y: from.y, dx: ux * sp, dy: uy * sp, left: def.range + lvl * def.levRange, age: 0, owner: 'player', ownerId: this.player.id,
          ownerLevel: this.character?.level ?? 1, hitClass: def.hitClass || 0x20, roll, hit: new Set(), lvl, skill: msk, rehit: new Map(),
          onTick: (ms) => {
            if (!sub || ms.age % 2) return;
            for (const k of [1, -1]) this.spawnPlayerMissile(sub, msk, lvl, ms.x - uy * k * 10, ms.y + ux * k * 10, undefined, { srcDam: 0, useSkillDamage: true, from: { x: ms.x, y: ms.y } });
          },
        });
        return;
      }
      case 95: {
        // Wake of Inferno: 대상 쪽으로 불길 분사 (SrvSt53 / SrvDo095 MonInferno). 근사(원작 미확인): 분사 길이 대신 불꽃 한 줄기 (수명 calc1)
        if (def) this.spawnPlayerMissile(def, msk, lvl, t.x, t.y, undefined, { ...opts, range: Math.max(1, calc.calc(sk, 1, lvl, this.owner())) });
        return;
      }
      case 55: {
        // Death Sentry 시체 폭발 (SrvDo055)
        if (t.mode === 'DD' && !t.corpseUsed) this.explodeCorpse(sk, lvl, t, pet.stats.level);
        return;
      }
      default:
        // sentry lightning · death sentry ltng: 대상으로 번개 (srvmissile)
        if (def) this.spawnPlayerMissile(def, msk, lvl, t.x, t.y, t.id, opts);
    }
  }

  /**
   * Shadow Warrior / Shadow Master: 펫 레벨 = 주인 레벨. 스킬 레벨 > 1 이면 최대 생명 × (1 + par1·(lvl−1)/100),
   * aurastat1~6 은 모두 aurastatcalc2 값, passivestat1~5 는 모두 passivecalc2 값 (원작 그대로 — 인덱스 [1] 고정).
   * 장비 = monequip.txt (스킬 레벨 이하 행부터, 칸마다 하나 무작위, '    ' 는 주인 아이템 복사), 아이템 레벨 = par5 + (lvl−1)·par6.
   * 출처: SkillAss.cpp SKILLS_SrvDo049_ShadowWarrior_Master / sub_6FCF9580
   */
  private summonShadow(s: SkillRecord, lvl: number): void {
    const data = this.data, calc = data?.skillCalc, c = this.character, p = this.player;
    if (!data || !calc || !c || !s.summon) return;
    const ownerLvl = this.skillLevel(s);
    const pet = this.summonPet(s, lvl, s.summon, p.x + 1, p.y + 1, s.petType, {
      shadow: { cls: c.cls, equipment: {}, master: s.srvDoFunc === 49 && s.summon.toLowerCase() === 'shadowmaster', ownerSkillLvl: ownerLvl },
    }, { level: c.level, noBonus: true });
    if (!pet) return;
    const o = this.owner();
    if (lvl > 1) {
      pet.stats.maxHp += Math.trunc((pet.stats.maxHp * (s.params[0] ?? 0) * (lvl - 1)) / 100);
      pet.hp = pet.stats.maxHp;
      const av = s.auraStats[1] ? calc.eval(s, s.auraStats[1].calc, lvl, o) : 0;
      const pv = s.passiveStats[1] ? calc.eval(s, s.passiveStats[1].calc, lvl, o) : 0;
      const st: Record<string, number> = {};
      for (const a of s.auraStats) st[a.stat] = av;
      for (const ps of s.passiveStats) st[ps.stat] = pv;
      for (const [k, v] of Object.entries(st)) {
        if (RESIST_STAT[k]) pet.resist[RESIST_STAT[k] as keyof MonsterUnit['resist']] += v;
        else if (k === 'tohit') {
          pet.stats.a1.toHit += v;
          pet.stats.a2.toHit += v;
        } else if (k === 'skill_armor_percent') pet.stats.defense += Math.trunc((pet.stats.defense * v) / 100);
      }
    }
    // 장비 (monequip.txt)
    const ilvl = Math.max(1, Math.min(99, (s.params[4] ?? 0) + (lvl - 1) * (s.params[5] ?? 0)));
    const rows = (data.monEquip ?? []).filter((r) => r.monster === pet.type.id);
    let i = 0;
    while (i < rows.length && Number(rows[i]?.level ?? 0) > lvl) i++;
    const eq = (pet.pet as PetInfo).shadow!.equipment;
    const QUAL: Record<number, Quality> = { 1: QUALITY.INFERIOR, 2: QUALITY.NORMAL, 3: QUALITY.SUPERIOR, 4: QUALITY.MAGIC, 5: QUALITY.SET, 6: QUALITY.RARE, 7: QUALITY.UNIQUE };
    for (; i < rows.length; i++) {
      const r = rows[i] as TxtRow;
      const slots = [1, 2, 3].map((k) => ({ code: r[`item${k}`] ?? '', loc: r[`loc${k}`] ?? '', mod: Number(r[`mod${k}`] ?? 0) })).filter((x) => x.loc);
      if (!slots.length) continue;
      const pick = slots[pet.rng.pick(slots.length)] as { code: string; loc: string; mod: number };
      if (eq[pick.loc]) continue;
      const code = pick.code.trim() || this.equipment[pick.loc as keyof typeof this.equipment]?.code;
      const base = code ? data.items.base(code) : undefined;
      if (!base) continue;
      eq[pick.loc] = data.treasure.createItem(base, ilvl, new Rng(Number(this.rng.next() & 0xffffffffn) || 1), QUAL[pick.mod] ?? QUALITY.NORMAL, true);
    }
    if (s.auraState) pet.states.set(s.auraState, Infinity, {}, { id: s.id, lvl });
    pet.nextThink = this.tickCount + 20;
  }

  /** 그림자가 쓸 스킬: Warrior = 주인 왼쪽·오른쪽 스킬 (주인 레벨/2 + 그림자 스킬 레벨/3), Master = 주인 어쌔신 스킬 전부 (clamp(소환 레벨/2 + 주인 레벨/2, 1, 24)) */
  private shadowSkills(pet: MonsterUnit): { s: SkillRecord; lvl: number }[] {
    const sh = pet.pet?.shadow, c = this.character, db = this.data?.skills;
    if (!sh || !c || !db) return [];
    const out: { s: SkillRecord; lvl: number }[] = [];
    if (sh.master) {
      for (const s of db.classSkills('Assassin')) {
        const own = this.skillLevel(s);
        if (own > 0 && !s.passive) out.push({ s, lvl: Math.max(1, Math.min(24, Math.trunc(sh.ownerSkillLvl / 2) + Math.trunc(own / 2))) });
      }
      return out;
    }
    for (const id of [c.leftSkill, c.rightSkill]) {
      const s = this.skillRecord(id);
      if (s) out.push({ s, lvl: Math.max(1, Math.trunc(this.skillLevel(s) / 2) + Math.trunc(sh.ownerSkillLvl / 3)) });
    }
    return out;
  }

  /**
   * 그림자 AI: 주인에게서 멀면 따라가고, 적이 있으면 스킬을 골라 쓴다. 근접 거리면 clamp(aip3 − 2·스킬 레벨, 5, 100) % 로 일반 공격.
   * 어쌔신 스킬이 아니면 일반 공격. 출처: AiThink.cpp AITHINK_Fn105_ShadowWarrior / ShadowWarriorCheckUseSkill / Fn106 (Master)
   * 근사(원작 미확인): Master 의 점수제(저항·요구 레벨·aibonus) 대신 배운 스킬 중 무작위, 함정·그림자 소환은 쓰지 않는다
   */
  private thinkShadow(pet: MonsterUnit): void {
    const sh = pet.pet?.shadow, p = this.player, ap = pet.type.aiParams;
    if (!sh) return;
    pet.nextThink = this.tickCount + 5;
    const toOwner = Math.hypot(pet.x - p.x, pet.y - p.y);
    if (toOwner > 25) return this.warpPet(pet);
    const enemy = this.inTown || toOwner > (ap[1] ?? 30) ? undefined : this.monstersNear(pet.x, pet.y, ap[0] ?? 40).find((m) => !m.pet && Math.hypot(m.x - p.x, m.y - p.y) < 20);
    if (!enemy) {
      pet.targetId = undefined;
      if (toOwner > 5) this.petMoveTo(pet, p.x + (pet.rng.pick(5) - 2), p.y + (pet.rng.pick(5) - 2), toOwner > 8);
      return;
    }
    pet.targetId = enemy.id;
    const melee = isInMeleeRange(pet.x, pet.y, pet.type.sizeX, pet.type.meleeRange, enemy.x, enemy.y, enemy.type.sizeX);
    const list = this.shadowSkills(pet).filter((x) => x.s.charclass === 'ass' && ![44, 45, 49].includes(x.s.srvDoFunc));
    let pick = list.length ? list[pet.rng.pick(list.length)] : undefined;
    if (melee && pet.rng.pick(100) < Math.max(5, Math.min(100, (ap[2] ?? 60) - 2 * Math.max(sh.ownerSkillLvl, 1)))) pick = undefined;
    const needMelee = !pick || pick.s.range === 'h2h';
    if (needMelee && !melee) return this.petMoveTo(pet, enemy.x, enemy.y, true);
    sh.use = pick ? { id: pick.s.id, lvl: pick.lvl } : undefined;
    const mode: MonMode = pick && (pick.s.anim === 'SC' || pick.s.anim === 'S2') ? 'SC' : pet.rng.pick(2) ? 'A2' : 'A1';
    this.startMonsterMode(pet, pet.type.modes.has(mode) ? mode : 'A1');
    pet.dir = dir64(enemy.x - pet.x, enemy.y - pet.y);
  }

  /** 그림자 스킬 효과 (판정 프레임). 근사(원작 미확인): 무술은 차지를 쌓지 않는 근접 (피니셔 피해 % 만), 원거리·버프는 그림자 자리에서 */
  private shadowEffect(pet: MonsterUnit, t: MonsterUnit): void {
    const sh = pet.pet?.shadow, data = this.data, calc = data?.skillCalc;
    if (!sh || !data || !calc) return;
    const use = sh.use, s = use ? this.skillRecord(use.id) : undefined, lvl = use?.lvl ?? 1;
    const o = this.owner();
    const from = { x: pet.x, y: pet.y };
    if (s && s.range !== 'h2h') {
      if (s.srvDoFunc === 18 || s.srvDoFunc === 47 || s.srvStFunc === 28) {
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
        pet.states.set(s.auraState, this.tickCount + Math.max(25, calc.eval(s, s.auraLenCalc, lvl, o)), stats, { id: s.id, lvl });
        return;
      }
      const inAir = s.srvMissile ? data.missiles.get(s.srvMissile) : undefined;
      if (inAir?.srvHitFunc === 36) return this.throwLob(inAir, s, lvl, t.x, t.y, from);
      if (s.srvDoFunc === 43) {
        const def = data.missiles.get(progressiveMissile(s, 0));
        if (def) this.throwLob(def, s, lvl, t.x, t.y, from);
        return;
      }
      if (s.srvDoFunc === 48) {
        const def = data.missiles.get(progressiveMissile(s, 0));
        if (def) this.spawnPlayerMissile(def, s, lvl, t.x, t.y, t.id, { srcDam: 0, useSkillDamage: true, from });
        return;
      }
      if (s.srvDoFunc === 33) return this.psychicHammer(s, lvl, t);
      if (s.srvDoFunc === 51) return this.mindBlast(s, lvl, t.x, t.y);
    }
    // 근접: 그림자 오른손 무기 피해 (없으면 monstats A1), 피니셔는 피해 % (Dragon Talon·Flight par1 + (lvl−1)·par2, Dragon Claw calc1)
    if (!isInMeleeRange(pet.x, pet.y, pet.type.sizeX, pet.type.meleeRange, t.x, t.y, t.type.sizeX, 1)) return;
    const atk = pet.stats.a1;
    if (!rollPercent(hitChance(atk.toHit, this.monsterDefense(t, false), pet.stats.level, t.stats.level), pet.rng)) {
      this.events.push({ type: 'miss', targetId: t.id });
      return;
    }
    const w = sh.equipment.rarm ? data.items.base(sh.equipment.rarm.code) : undefined;
    const ed = sh.equipment.rarm?.stats.reduce((a, x) => a + (x.stat === 'item_maxdamage_percent' ? x.value : 0), 0) ?? 0;
    const pct = !s ? 0 : s.srvDoFunc === 42 || s.srvDoFunc === 52 ? linearPct(s.params[0] ?? 0, s.params[1] ?? 0, lvl) : s.srvDoFunc === 46 ? calc.calc(s, 1, lvl, o) : 0;
    const d = emptyDamage();
    const base = rollDamage(w ? { min: w.minDam, max: w.maxDam } : { min: atk.min, max: atk.max }, pet.rng);
    d.phys = Math.trunc((base * 256 * (100 + ed + pct)) / 100);
    d.hitClass = pet.type.hitClass;
    const pmax = pet.states.stat('poisonmaxdam');
    if (pmax > 0) {
      d.pois += pet.states.stat('poisonmindam') + pet.rng.pick(Math.max(1, pmax - pet.states.stat('poisonmindam')));
      d.poisLen = pet.states.stat('skill_poison_override_length');
    }
    this.damageMonster(t, d, 'pet', pet.id);
  }

  /** Blade Creeper 이동: A ↔ B 왕복 (AITHINK_Fn102 — 속도 15). 근사(원작 미확인): 벽은 무시하고 직선 */
  private updateCreeper(pet: MonsterUnit): void {
    const c = pet.pet?.creeper;
    if (!c) return;
    const tx = c.toB ? c.bx : c.ax, ty = c.toB ? c.by : c.ay;
    const dx = tx - pet.x, dy = ty - pet.y, d = Math.hypot(dx, dy);
    const step = (15 * SUBTILES_PER_YARD) / ENGINE_FPS;
    if (d <= step) {
      pet.x = tx;
      pet.y = ty;
      c.toB = !c.toB;
      return;
    }
    pet.x += (dx / d) * step;
    pet.y += (dy / d) * step;
    pet.dir = dir64(dx, dy);
    if (pet.mode !== 'WL') {
      pet.mode = 'WL';
      pet.modeStart = this.tickCount;
    }
  }

  /** Corpse Explosion (Necromancer · Death Sentry 'mon death sentry'). casterLevel = 쓰는 유닛 레벨 (높은 레벨 시체 피해 비율) */
  private explodeCorpse(s: SkillRecord, lvl: number, target: MonsterUnit, casterLevel: number): void {
    const data = this.data, calc = data?.skillCalc;
    if (!data || !calc) return;
    const o = this.owner();
    target.corpseUsed = true;
    const hp256 = Math.trunc(((data.monsters.levelBase(target.stats.level, 'HP') * (target.type.minHpPct + target.type.maxHpPct)) / 100 / 2)) * 256;
    const lo = Math.trunc((calc.calc(s, 1, lvl, o) * hp256) / 100), hi = Math.trunc((calc.calc(s, 2, lvl, o) * hp256) / 100);
    let dmg = lo + (hi > lo ? this.rng.pick(hi - lo) : 0);
    if (target.stats.level && casterLevel < target.stats.level) dmg = Math.trunc((dmg * casterLevel) / target.stats.level);
    const pct = Math.max(0, Math.min(100, calc.calc(s, 3, lvl, o)));
    const radius = Math.trunc((calc.eval(s, s.auraRangeCalc, lvl, o) + 1) / 2);
    for (const m of this.monstersNear(target.x, target.y, radius)) {
      const d = emptyDamage();
      if (pct > 0 && s.eType) addElemental(d, s.eType, Math.trunc((dmg * pct) / 100), calc.elemLength(s, lvl, o));
      d.phys += Math.trunc((dmg * (100 - pct)) / 100);
      this.damageMonster(m, d);
    }
    this.events.push({ type: 'corpseExploded', targetId: target.id });
  }

  /** 스킬 물리 + 원소 피해 굴림 (D2GAME_RollPhysicalDamage + RollElementalDamage) */
  private skillDamage(s: SkillRecord, lvl: number): DamagePacket {
    const calc = this.data?.skillCalc, d = emptyDamage();
    if (!calc) return d;
    const o = this.owner();
    const pmin = calc.minPhys256(s, lvl, o), pmax = calc.maxPhys256(s, lvl, o);
    if (pmax > 0) d.phys = pmin + this.rng.pick(Math.max(0, pmax - pmin));
    const el = this.skillElemental(s, lvl);
    if (el) addElemental(d, el.eType, el.amount, el.len);
    if (s.hitClass) d.hitClass = s.hitClass;
    return d;
  }

  /**
   * Psychic Hammer: 대상에게 스킬 피해(물리 + 마법), 명중 굴림 없음. 넉백 확률 calc1 (보통) · calc2 (유니크) · calc3 (보스).
   * 출처: SkillAss.cpp SKILLS_SrvSt22 / SrvDo033_PsychicHammer
   */
  private psychicHammer(s: SkillRecord, lvl: number, t: MonsterUnit | undefined): void {
    const calc = this.data?.skillCalc;
    if (!t || !calc || this.inTown) return;
    const d = this.skillDamage(s, lvl);
    const chance = calc.calc(s, t.type.boss ? 3 : t.flags & 8 ? 2 : 1, lvl, this.owner());
    this.damageMonster(t, d);
    if (t.mode !== 'DT' && t.mode !== 'DD' && chance > 0 && this.rng.pick(100) < chance) this.knockBack(t);
  }

  /**
   * Cloak of Shadows: 이미 걸려 있으면 실패. 자신에게 aurastate (passivestat), 반경 aurarange 안 적에게 auratargetstate (aurastat — 방어 −%), 지속 auralen.
   * 출처: SkillAss.cpp SKILLS_SrvDo047_CloakOfShadows / AuraCallback_CloakOfShadows
   */
  private cloakOfShadows(s: SkillRecord, lvl: number): void {
    const calc = this.data?.skillCalc, p = this.player;
    if (!calc || p.states.has(s.auraState)) return;
    const o = this.owner();
    const len = calc.eval(s, s.auraLenCalc, lvl, o);
    const self: Record<string, number> = {};
    for (const ps of s.passiveStats) self[ps.stat] = calc.eval(s, ps.calc, lvl, o);
    p.states.set(s.auraState, this.tickCount + len, self, { id: s.id, lvl });
    const stats: Record<string, number> = {};
    for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
    for (const m of this.monstersNear(p.x, p.y, calc.eval(s, s.auraRangeCalc, lvl, o))) {
      m.states.set(s.auraTargetState, this.tickCount + len, stats, { id: s.id, lvl });
      m.nextThink = this.tickCount;
    }
    this.statsDirty = true;
  }

  /**
   * Blade Fury: 누르고 있는 동안 prgcalc1 프레임마다 칼날 1개 (무기 피해 × SrcDam + 스킬 피해), 발사할 때만 마나.
   * 출처: SkillAss.cpp SKILLS_SrvSt26 / SrvDo048_BladeFury (param1 = 다음 발사 프레임, 지연 = prgcalc − 1)
   */
  private bladeFury(cast: Cast): void {
    const s = cast.skill, data = this.data, calc = data?.skillCalc;
    if (!data || !calc) return;
    const period = calc.eval(s, progressiveCalc(s, 0), cast.lvl, this.owner());
    if (period - 1 <= 0 || this.tickCount <= (cast.nextFire ?? -1)) return;
    const def = data.missiles.get(progressiveMissile(s, 0));
    if (!def) return;
    const c = this.character;
    if (c) {
      const cost = calc.manaCost256(s, cast.lvl) / 256;
      if (c.mana < cost) return;
      c.mana -= cost;
    }
    this.spawnPlayerMissile(def, s, cast.lvl, cast.tx, cast.ty, cast.targetId, { srcDam: s.srcDam, useSkillDamage: true });
    cast.nextFire = this.tickCount + period - 1;
  }

  /**
   * Mind Blast: 대상 지점 반경 aurarange 안 — 전향 가능한 몬스터는 확률 dm56 (D2COMMON_11036) 로 par3 + rand(par4) 프레임 동안 편,
   * 나머지는 스킬 피해 (물리 + 기절). 출처: SkillAss.cpp SKILLS_SrvDo051_MindBlast / AuraCallback_MindBlast
   */
  private mindBlast(s: SkillRecord, lvl: number, x: number, y: number): void {
    const calc = this.data?.skillCalc;
    if (!calc) return;
    const o = this.owner();
    const radius = calc.eval(s, progressiveCalc(s, 0), lvl, o) || calc.eval(s, s.auraRangeCalc, lvl, o);
    const chance = diminishing(lvl, s.params[4] ?? 0, s.params[5] ?? 0);
    const d = this.skillDamage(s, lvl);
    for (const m of this.monstersNear(x, y, radius)) {
      // 출처: AIUTIL_CanUnitSwitchAi — monstats switchai, 유니크·슈퍼유니크 제외, 용병·소환수·NPC 제외
      const convertible = m.type.switchAi && !m.pet && !m.npc && !(m.flags & (2 | 8)) && !m.states.has('uninterruptable');
      if (convertible && this.rng.pick(100) <= chance) {
        m.states.set('conversion', this.tickCount + (s.params[2] ?? 0) + this.rng.pick(Math.max(1, s.params[3] ?? 1)), {}, { id: s.id, lvl });
        m.nextThink = this.tickCount;
        m.targetId = undefined;
        this.convertLevel(m);
        this.events.push({ type: 'converted', targetId: m.id });
        continue;
      }
      this.damageMonster(m, { ...d });
    }
  }

  /**
   * Blade Shield: 상태(bladeshield)가 있는 동안 par3 프레임마다 반경 par4 안 적에게 명중 굴림 후 무기 피해 × SrcDam + 스킬 피해 (마을 제외).
   * 출처: SkillAss.cpp SKILLS_SrvSt28 / SrvDo054 → SrvDo142 (AuraCallback_SrvDo142 — sub_6FD15650 명중, FillDamageValues(srcdam))
   * 근사(원작 미확인): 발동 주기 = par3 (25 프레임) — 원작 상태 이벤트 주기 미확인
   */
  private updateBladeShield(): void {
    const st = this.player.states.get('bladeshield');
    const s = st?.skill ? this.skillRecord(st.skill.id) : undefined;
    const calc = this.data?.skillCalc;
    if (!st?.skill || !s || !calc || this.inTown || this.isDead) return;
    if (this.tickCount < this.bladeShieldNext) return;
    this.bladeShieldNext = this.tickCount + Math.max(1, s.params[2] ?? 25);
    const lvl = st.skill.lvl, o = this.owner(), p = this.player;
    const radius = calc.eval(s, progressiveCalc(s, 0), lvl, o) || calc.eval(s, s.auraRangeCalc, lvl, o);
    for (const m of this.monstersNear(p.x, p.y, radius)) {
      this.meleeHit(m, { toHitPct: calc.toHit(s, lvl, o), enDmgPct: 0, flat256: 0, elem: null, hitClass: s.hitClass, srcDam: s.srcDam, reach: radius, extra: this.skillDamage(s, lvl) });
    }
  }

  /** 반경 안 살아있는 적 (Conversion 으로 편이 된 몬스터는 제외), 가까운 순 */
  private monstersNear(x: number, y: number, radius: number): MonsterUnit[] {
    return this.monsters
      .filter((m) => m.mode !== 'DT' && m.mode !== 'DD' && !m.hidden && Math.hypot(m.x - x, m.y - y) <= radius && !m.states.has('conversion'))
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  }

  /**
   * Find Potion / Find Item: 시체를 뒤져 확률(calc1)로 물약 또는 아이템.
   * 출처: SKILLS_SrvDo069_FindPotion — Act 1 Normal 표 {hp2, mp2, rvs}, rand < par3 → 마나, < par3+par4 → 회복, 나머지 → 생명
   *       SKILLS_SrvDo072_FindItem — calc1 확률 성공 시 몬스터 드롭 한 번 더
   * 근사(원작 미확인): Find Item 의 드롭 모드(nParam 1~4) 세부 대신 몬스터 TreasureClass1 을 다시 굴린다.
   */
  private searchCorpse(s: SkillRecord, lvl: number, corpse: MonsterUnit): void {
    const data = this.data, calc = data?.skillCalc;
    if (!data || !calc) return;
    corpse.corpseUsed = true;
    const chance = calc.calc(s, 1, lvl, this.owner());
    if (this.rng.pick(100) >= chance) return;
    if (s.srvDoFunc === 69) {
      const r = this.rng.pick(100);
      const [p3 = 0, p4 = 0] = [s.params[2], s.params[3]];
      const code = r < p3 ? 'mp2' : r < p3 + p4 ? 'rvs' : 'hp2';
      const base = data.items.base(code);
      if (base) {
        const it = data.treasure.createItem(base, corpse.stats.level, this.rng, 2);
        this.dropItem(it, corpse.x, corpse.y);
        this.events.push({ type: 'itemDropped', itemId: it.id, code: it.code, quality: it.quality });
      }
      return;
    }
    const tc = corpse.type.treasure[0];
    if (tc) {
      for (const item of data.treasure.drop(tc, corpse.stats.level, this.rng)) {
        this.dropItem(item, corpse.x, corpse.y);
        this.events.push({ type: 'itemDropped', itemId: item.id, code: item.code, quality: item.quality });
      }
    }
  }

  // ---------------------------------------------------------------- 24·30 레벨 스킬 도움 함수

  /**
   * 한 번 사용에 여러 대상을 번갈아 치는 스킬(Strafe·Fend)의 다음 대상: 처음엔 지정 대상, 그다음은 아직 안 친 가장 가까운 적,
   * 모두 쳤으면 방금 친 대상이 아닌 적. 출처: SKILLS_SrvDo012_Strafe / SrvDo013 (sub_6FD107F0 — 직전 대상 GUID 제외)
   * 근사(원작 미확인): 원작 sub_6FD107F0 의 탐색 순서 대신 가까운 순
   */
  private nextSpreadTarget(cast: Cast, x: number, y: number, radius: number, filter: (m: MonsterUnit) => boolean = () => true): MonsterUnit | undefined {
    const ids = (cast.hitIds ??= []);
    const cands = this.monstersNear(x, y, radius).filter(filter);
    const first = ids.length === 0 && cast.targetId !== undefined ? cands.find((m) => m.id === cast.targetId) : undefined;
    const t = first ?? cands.find((m) => !ids.includes(m.id)) ?? cands.find((m) => m.id !== ids[ids.length - 1]) ?? cands[0];
    if (t) ids.push(t.id);
    return t;
  }

  /** 스킬 상태 누적 (Frenzy): 단계 = 명중마다 +1 (스킬 레벨까지), 스탯은 그 단계 레벨의 aurastat. 출처: SKILLS_ApplyFrenzyStats */
  private applyStackState(s: SkillRecord, lvl: number, len: number): void {
    const calc = this.data?.skillCalc;
    if (!calc || !s.auraState) return;
    const cur = this.player.states.get(s.auraState);
    const stack = frenzyStack(cur?.stats.skill_frenzy ?? 0, lvl);
    const stats: Record<string, number> = { skill_frenzy: stack };
    for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, stack, this.owner());
    // 출처: SKILLS_AuraCallback_BasicAura — attackrate 는 other_animrate 에도
    if (stats.attackrate) stats.other_animrate = stats.attackrate;
    this.player.states.remove(s.auraState);
    this.player.states.set(s.auraState, this.tickCount + Math.max(1, len), stats, { id: s.id, lvl });
  }

  /** 금속 아이템 (Iron Golem 재료): items bitfield1 & 2, 감정됨, 바닥. 출처: D2MOO ITEMS_IsMetalItem, SKILLS_SrvSt20_IronGolem */
  private isMetalItem(it: ItemInstance): boolean {
    const b = this.data?.items.base(it.code);
    return !!b && (b.bitfield1 & 2) !== 0 && it.identified;
  }

  /** DifficultyLevels.txt AiCurseDivisor (Normal 1) */
  private aiCurseDiv(): number {
    return this.rules.aiCurseDivisor;
  }

  /** 그림만 보이는 미사일 (클라이언트 미사일·오버레이). celFile 이 'overlays\\…' 면 오버레이 폴더 그림 */
  private spawnVisual(name: string, x: number, y: number, o: { celFile?: string; frames?: number; life?: number; to?: Pt } = {}): void {
    const base = this.data?.missiles.get(name) ?? this.data?.missiles.values().next().value;
    if (!base) return;
    const def: MissileDef = o.celFile ? { ...base, name, celFile: o.celFile, animLen: o.frames ?? base.animLen, numDirections: 1 } : base;
    const life = o.life ?? def.range;
    const dx = o.to ? (o.to.x - x) / Math.max(1, life) : 0, dy = o.to ? (o.to.y - y) / Math.max(1, life) : 0;
    this.missiles.push({
      id: this.nextUnitId++, def, x, y, dx, dy, left: life, age: 0, owner: 'player', ownerId: this.player.id, ownerLevel: this.character?.level ?? 1,
      hitClass: 0, hit: new Set(), lvl: 1, visual: true,
    });
  }

  /**
   * 미사일 자체 원소 피해 (불길·볼트): missiles.txt EMin/EMax + 레벨 구간, × (100 + EDmgSymPerCalc + ApplyMastery 마스터리)%.
   * 출처: D2MOO MISSILE_CalculateDamageData (미사일에 스킬이 없을 때 미사일 수치, 시너지 EDmgSymPerCalc)
   */
  private missileOwnRoller(def: MissileDef, s: SkillRecord, lvl: number): () => DamagePacket {
    const calc = this.data?.skillCalc, o = this.owner();
    const sym = def.eDmgSymPerCalc && calc ? calc.eval(s, def.eDmgSymPerCalc, lvl, o) : 0;
    const mastery = def.applyMastery && o.mastery ? o.mastery(def.eType) : 0;
    return () => {
      const d = this.missileOwnDamage(def, lvl);
      const k = 100 + sym + mastery;
      if (k !== 100) for (const key of ['fire', 'ltng', 'cold', 'mag', 'pois'] as const) d[key] = Math.trunc((d[key] * k) / 100);
      return d;
    };
  }

  /**
   * Meteor: 목표 지점 표적(meteorcenter, Range 60프레임) → 떨어지면 반경 aurarange 안 화염 피해 + 18곳(sHitPar2 간격)에 불길
   * (지속 par3 + (lvl−1) × par4). 출처: MISSMODE_SrvHit14_MeteorCenter + MISSMODE_CreateMeteor_MoltenBoulderSubmissiles
   */
  private castMeteor(s: SkillRecord, lvl: number, tx: number, ty: number): void {
    const data = this.data, calc = data?.skillCalc;
    const def = data?.missiles.get(s.srvMissileA);
    if (!data || !calc || !def) return;
    const o = this.owner();
    const roll = this.missileDamageRoller(def, s, lvl, { srcDam: 0, useSkillDamage: true });
    // 클라이언트 그림: 떨어지는 운석 (meteor) — 화면 위쪽(월드 −x,−y)에서 표적으로
    this.spawnVisual('meteor', tx - 14, ty - 14, { life: def.range, to: { x: tx, y: ty } });
    this.missiles.push({
      id: this.nextUnitId++, def, x: tx, y: ty, dx: 0, dy: 0, left: def.range, age: 0, owner: 'player', ownerId: this.player.id, ownerLevel: this.character?.level ?? 1,
      hitClass: def.hitClass || 0x20, roll, hit: new Set(), lvl, skill: s, noCollide: true,
      onEnd: (ms) => {
        const radius = def.hitParams[0] || Math.max(calc.eval(s, s.auraRangeCalc, lvl, o), 1);
        for (const m of this.monstersNear(ms.x, ms.y, radius)) this.damageMonster(m, roll());
        this.spawnVisual('meteorexplode', ms.x, ms.y);
        const fire = def.hitSubMissile1 ? data.missiles.get(def.hitSubMissile1) : undefined;
        if (!fire) return;
        const range = lvl > 0 ? (s.params[2] ?? 0) + (lvl - 1) * (s.params[3] ?? 0) : 0;
        const fr = this.missileOwnRoller(fire, s, lvl);
        const step = Math.max(def.hitParams[1] ?? 1, 1);
        for (let i = 0; i < 18; i += step) this.spawnGroundFire(fire, ms.x + (METEOR_FIRE_X[i] ?? 0), ms.y + (METEOR_FIRE_Y[i] ?? 0), fr, ms, range > 0 ? range : undefined);
        this.events.push({ type: 'meteorImpact', x: ms.x, y: ms.y });
      },
    });
  }

  /**
   * Blizzard: 목표 지점 중심(blizzardcenter, Range 100) — calc2 프레임마다 반경 calc1 안 무작위 지점에 얼음 조각(blizzard1, Size 2, 9프레임).
   * 출처: MISSMODE_SrvDo10_BlizzardCenter + MISSMODE_CreateMissileWithCollisionCheck, blizzard1 pSrvDoFunc 3 (제자리 충돌)
   * 근사(원작 미확인): 무작위 지점 = 반경 안 균등 분포, 조각은 한 적을 한 번만 맞힌다
   */
  private castBlizzard(s: SkillRecord, lvl: number, tx: number, ty: number): void {
    const data = this.data, calc = data?.skillCalc;
    const def = data?.missiles.get(s.srvMissileA);
    const shard = def?.subMissile1 ? data?.missiles.get(def.subMissile1) : undefined;
    if (!data || !calc || !def || !shard) return;
    const o = this.owner();
    const radius = Math.max(1, calc.calc(s, 1, lvl, o)), every = Math.max(1, calc.calc(s, 2, lvl, o));
    const roll = this.missileDamageRoller(shard, s, lvl, { srcDam: 0, useSkillDamage: true });
    this.missiles.push({
      id: this.nextUnitId++, def, x: tx, y: ty, dx: 0, dy: 0, left: def.range, age: 0, owner: 'player', ownerId: this.player.id, ownerLevel: this.character?.level ?? 1,
      hitClass: 0, hit: new Set(), lvl, skill: s, noCollide: true,
      onTick: (ms) => {
        if (ms.age % every !== 0) return;
        const a = (this.rng.pick(64) * Math.PI) / 32, r = this.rng.pick(radius * 16) / 16;
        const x = ms.x + Math.cos(a) * r, y = ms.y + Math.sin(a) * r;
        if (!this.map.walkable(Math.floor(x), Math.floor(y))) return;
        this.missiles.push({
          id: this.nextUnitId++, def: shard, x, y, dx: 0, dy: 0, left: shard.range, age: 0, owner: 'player', ownerId: ms.ownerId, ownerLevel: ms.ownerLevel,
          hitClass: shard.hitClass || 0x30, roll, hit: new Set(), lvl, skill: s,
        });
      },
    });
  }

  /**
   * Fist of the Heavens: 대상 자리에 지연 미사일(Range 10) → 대상에 번개(스킬 피해), calc4 개까지 aurarange 안 적에게 성스러운 볼트(언데드만).
   * 출처: SKILLS_SrvDo080_FistOfTheHeavens (srvoverlay handofgod) + MISSMODE_SrvHit22_FistOfTheHeavensDelay / FistOfTheHeavensDelay_AuraCallback
   */
  private castFistOfHeavens(s: SkillRecord, lvl: number, t: MonsterUnit): void {
    const data = this.data, calc = data?.skillCalc;
    const def = data?.missiles.get(s.srvMissileA);
    if (!data || !calc || !def) return;
    const o = this.owner();
    const roll = this.missileDamageRoller(def, s, lvl, { srcDam: 0, useSkillDamage: true });
    // 오버레이 handofgod (overlay.txt Filename HolyShockHit, 21프레임)
    this.spawnVisual('handofgod', t.x, t.y, { celFile: 'overlays\\HolyShockHit', frames: 21, life: 21 });
    this.missiles.push({
      id: this.nextUnitId++, def, x: t.x, y: t.y, dx: 0, dy: 0, left: def.range, age: 0, owner: 'player', ownerId: this.player.id, ownerLevel: this.character?.level ?? 1,
      hitClass: 0x40, roll, hit: new Set(), lvl, skill: s, noCollide: true,
      onEnd: (ms) => {
        const cur = this.monsters.find((m) => m.id === t.id && m.mode !== 'DT' && m.mode !== 'DD');
        if (cur) this.damageMonster(cur, roll());
        const bolt = def.hitSubMissile1 ? data.missiles.get(def.hitSubMissile1) : undefined;
        if (!bolt) return;
        const radius = def.hitParams[0] || Math.max(calc.eval(s, s.auraRangeCalc, lvl, o), 1);
        const max = def.hitParams[1] || Math.max(calc.calc(s, 4, lvl, o), 1);
        const br = this.missileOwnRoller(bolt, s, lvl);
        let n = 0;
        // 근사(원작 미확인): 원작 콜백은 번개 맞은 대상에게도 볼트를 만들지만 같은 자리에서 나가므로 대상은 빼고 주변 적에게만
        for (const m of this.monstersNear(ms.x, ms.y, radius)) {
          if (m.id === t.id) continue;
          if (n++ >= max) break;
          const d = Math.hypot(m.x - ms.x, m.y - ms.y) || 1, sp = missileStep(bolt.vel);
          this.missiles.push({
            id: this.nextUnitId++, def: bolt, x: ms.x, y: ms.y, dx: ((m.x - ms.x) / d) * sp, dy: ((m.y - ms.y) / d) * sp, left: bolt.range, age: 0,
            owner: 'player', ownerId: ms.ownerId, ownerLevel: ms.ownerLevel, hitClass: 0x0d, roll: br, hit: new Set([t.id]), lvl, skill: s,
          });
        }
        this.events.push({ type: 'fistOfHeavens', targetId: t.id, bolts: n });
      },
    });
  }

  /**
   * Grim Ward: 시체 자리에 시작 미사일(크기별 small/medium/large start) → 토템(Range = calc1)이 Param1(6) 프레임마다
   * par1 + (lvl−1) × par2 반경 안 몬스터에게 공포 (par6 프레임). 출처: SKILLS_SrvDo075_GrimWard, MISSMODE_SrvHit26_GrimWardStart / SrvDo14 / SrvHit28
   * 근사(원작 미확인): monstats2 small/large 플래그 대신 몬스터 크기(sizeX)로 고른다
   */
  private castGrimWard(s: SkillRecord, lvl: number, corpse: MonsterUnit): void {
    const data = this.data, calc = data?.skillCalc;
    if (!data || !calc) return;
    const startName = corpse.type.sizeX >= 3 ? s.srvMissileC : corpse.type.sizeX <= 1 ? s.srvMissileB : s.srvMissileA;
    const start = data.missiles.get(startName);
    const ward = start?.hitSubMissile1 ? data.missiles.get(start.hitSubMissile1) : undefined;
    if (!start || !ward) return;
    const o = this.owner();
    this.monsters.splice(this.monsters.indexOf(corpse), 1);
    const life = (start.hitParams[0] ?? 0) > 0 ? (start.hitParams[0] ?? 0) : Math.max(calc.calc(s, 1, lvl, o), 5);
    const radius = lvl > 0 ? (s.params[0] ?? 0) + (lvl - 1) * (s.params[1] ?? 0) : 0;
    const every = Math.max(ward.params[0] ?? 1, 1);
    const x = corpse.x, y = corpse.y;
    this.spawnVisual(startName, x, y);
    this.missiles.push({
      id: this.nextUnitId++, def: ward, x, y, dx: 0, dy: 0, left: start.range + life, age: 0, owner: 'player', ownerId: this.player.id, ownerLevel: this.character?.level ?? 1,
      hitClass: 0, hit: new Set(), lvl, skill: s, noCollide: true,
      onTick: (ms) => {
        if (ms.age < start.range || (ms.left % every) !== 0) return;
        for (const m of this.monstersNear(ms.x, ms.y, radius)) {
          if (m.type.boss) continue;
          m.states.set('terror', this.tickCount + (s.params[5] ?? 60), {}, { id: s.id, lvl });
          m.path = [];
          m.nextThink = this.tickCount;
        }
      },
    });
  }

  /**
   * Thunder Storm 상태 동안 주기(perdelay)마다 반경 par7 안 적 하나(직전 대상 제외)에 번개 — 바로 판정.
   * 출처: SKILLS_SrvDo029_ThunderStorm (MISSMODE_SrvDmgHitHandler 즉시 적용, SKILLS_SetParam1 = 직전 대상)
   */
  private updateThunderStorm(): void {
    const st = this.player.states.get('thunderstorm'), data = this.data, calc = data?.skillCalc;
    if (!st?.skill || !data || !calc || this.inTown || this.tickCount < this.stormNext) return;
    const s = this.skillRecord(st.skill.id);
    if (!s) return;
    const lvl = st.skill.lvl, o = this.owner();
    this.stormNext = this.tickCount + periodicRate(calc.eval(s, s.perDelay, lvl, o));
    const cands = this.monstersNear(this.player.x, this.player.y, s.params[6] ?? 17);
    const t = cands.find((m) => m.id !== this.stormLast) ?? cands[0];
    if (!t) return;
    this.stormLast = t.id;
    const def = data.missiles.get(s.srvMissileA);
    if (def) this.spawnVisual(def.name, t.x, t.y);
    const el = this.skillElemental(s, lvl);
    if (!el) return;
    const d = emptyDamage();
    addElemental(d, el.eType, el.amount, el.len);
    this.damageMonster(t, d);
  }

  /**
   * 소환수의 오라 (Fire Golem 의 Holy Fire, 레벨 = sumsk1calc): 주기(perdelay)마다 aurarange 안 적에게 화염.
   * 출처: skills.txt FireGolem sumskill1 'holy fire' / sumsk1calc, SKILLS_SrvDo066 (오라 피해)
   */
  private updatePetAuras(): void {
    this.updateMercAura();
    const calc = this.data?.skillCalc;
    if (!calc || this.inTown) return;
    const none: SkillOwner = { baseLevel: () => 0, skillLevel: () => 0, unitLevel: 1 };
    for (const [id, a] of this.petAura) {
      const pet = this.pets.find((p) => p.id === id && p.mode !== 'DT' && p.mode !== 'DD');
      if (!pet) {
        this.petAura.delete(id);
        continue;
      }
      if (this.tickCount < a.next) continue;
      a.next = this.tickCount + Math.max(5, calc.eval(a.skill, a.skill.perDelay, a.lvl, none));
      if (!a.skill.eType && a.skill.auraTargetState) {
        // 토템 오라 (Oak Sage·Heart of Wolverine·Spirit of Barbs, Do065): 반경 aurarange 안 주인·소환수에게 auratargetstate + aurastat.
        // 출처: SKILLS_SrvDo065_BasicAura (aurafilter: 아군) — 다음 주기까지 유지
        const s = a.skill, own: SkillOwner = { baseLevel: (k) => (k === s.id ? a.lvl : 0), skillLevel: (k) => (k === s.id ? a.lvl : 0), unitLevel: pet.stats.level };
        const until = a.next + 1, range = calc.eval(s, s.auraRangeCalc, a.lvl, own);
        const stats: Record<string, number> = {};
        for (const x of s.auraStats) stats[x.stat] = calc.eval(s, x.calc, a.lvl, own);
        if (!this.isDead && Math.hypot(this.player.x - pet.x, this.player.y - pet.y) <= range) {
          this.player.states.set(s.auraTargetState, until, stats, { id: s.id, lvl: a.lvl });
          this.statsDirty = true;
        }
        for (const o of this.pets) if (o !== pet && o.mode !== 'DT' && o.mode !== 'DD' && Math.hypot(o.x - pet.x, o.y - pet.y) <= range) o.states.set(s.auraTargetState, until, stats);
        continue;
      }
      const min = calc.minElem256(a.skill, a.lvl, none, false), max = calc.maxElem256(a.skill, a.lvl, none, false);
      for (const m of this.monstersNear(pet.x, pet.y, calc.eval(a.skill, a.skill.auraRangeCalc, a.lvl, none))) {
        const d = emptyDamage();
        addElemental(d, a.skill.eType, min + this.rng.pick(Math.max(0, max - min)), 0);
        d.hitClass = 0x0d;
        this.damageMonster(m, d, 'pet');
      }
    }
  }

  /**
   * Redemption 오라: 주기마다 aurarange 안 시체 하나를 calc1% 확률로 거두어 생명 calc2, 마나 calc3 회복 (시체는 사라진다).
   * 출처: SKILLS_SrvDo082_Redemption / SKILLS_ApplyRedemptionEffect (거둔 시체가 있을 때만 마나 소모)
   */
  private redeemCorpses(s: SkillRecord, lvl: number): boolean {
    const calc = this.data?.skillCalc, c = this.character;
    if (!calc || !c) return false;
    const o = this.owner(), range = calc.eval(s, s.auraRangeCalc, lvl, o);
    let n = 0;
    for (const m of [...this.monsters]) {
      if (m.mode !== 'DD' || m.corpseUsed || Math.hypot(m.x - this.player.x, m.y - this.player.y) > range) continue;
      if (this.rng.pick(100) >= calc.calc(s, 1, lvl, o)) continue;
      c.life = Math.min(this.maxLife(), c.life + calc.calc(s, 2, lvl, o));
      c.mana = Math.min(this.maxMana(), c.mana + calc.calc(s, 3, lvl, o));
      m.corpseUsed = true;
      this.spawnVisual('redemption', m.x, m.y);
      this.monsters.splice(this.monsters.indexOf(m), 1);
      this.events.push({ type: 'redeemed', targetId: m.id });
      n++;
    }
    return n > 0;
  }

  // ---------------------------------------------------------------- Leap

  /**
   * Leap / Leap Attack 준비: 목표 지점까지 최대 aurarange(dm12) 서브타일. 출처: SKILLS_FindLeapTargetPosition
   * 근사(원작 미확인): 비행 중 이동은 첫 타격 이벤트(착지)까지 직선 보간. Leap Attack 최대 거리는 Leap 와 같은 par1/par2 dm 공식.
   */
  private prepareLeap(cast: Cast): void {
    const p = this.player, s = cast.skill, calc = this.data?.skillCalc;
    if (!calc) return;
    const o = this.owner();
    const maxRange = s.auraRangeCalc ? calc.eval(s, s.auraRangeCalc, cast.lvl, o) : calc.param(s, 'dm12', cast.lvl, o);
    let tx = cast.tx, ty = cast.ty;
    const target = cast.targetId !== undefined ? this.monsters.find((m) => m.id === cast.targetId) : undefined;
    if (target) {
      const d = Math.hypot(target.x - p.x, target.y - p.y) || 1;
      const stop = (PLAYER_SIZE + target.type.sizeX) / 2;
      tx = target.x - ((target.x - p.x) / d) * stop;
      ty = target.y - ((target.y - p.y) / d) * stop;
    }
    const d = Math.hypot(tx - p.x, ty - p.y);
    if (d > maxRange) {
      tx = p.x + ((tx - p.x) * maxRange) / d;
      ty = p.y + ((ty - p.y) * maxRange) / d;
    }
    const spot = nearestWalkable(this.map, { x: tx, y: ty }, 3);
    if (spot) {
      tx = spot.x + 0.5;
      ty = spot.y + 0.5;
    } else {
      tx = p.x;
      ty = p.y;
    }
    const land = cast.hitTicks[0] ?? Math.max(1, cast.end - cast.start - 1);
    cast.leap = { fx: p.x, fy: p.y, tx, ty, landTick: land };
  }

  /**
   * Charge: 대상까지 달리기 속도 × (par1 + 100)% 로 돌진, 도착하면 시퀀스의 공격 부분(seqinput 이후)을 재생해 한 번 친다.
   * 출처: SKILLS_SrvSt31_Charge (속도 = RunVelocity × (par1 + velocitypercent)/100, 이미 근접이면 일반 공격)
   * 근사(원작 미확인): 최대 돌진 시간 50 프레임
   */
  private prepareCharge(cast: Cast): void {
    const target = cast.targetId !== undefined ? this.monsters.find((m) => m.id === cast.targetId) : undefined;
    const p = this.player;
    if (!target || isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, target.x, target.y, target.type.sizeX)) {
      if (cast.seq) this.chargeStrike(cast);
      return;
    }
    const pct = cast.skill.params[0] ?? 150;
    cast.charge = { speed: ((p.runVelocity * SUBTILES_PER_YARD) / ENGINE_FPS) * (pct + 100 + this.playerStat('velocitypercent')) / 100, until: this.tickCount + 50 };
    cast.hitTicks = [];
    cast.end = Number.POSITIVE_INFINITY;
  }

  /** 돌진 도착: 시퀀스를 seqinput 프레임부터 이어서 재생하고 그 안의 타격 이벤트를 쓴다 */
  private chargeStrike(cast: Cast): void {
    const seq = cast.seq;
    cast.charge = undefined;
    if (!seq) return;
    const from = cast.skill.seqInput > 0 && cast.skill.seqInput < seq.frames.length ? cast.skill.seqInput : 0;
    const t0 = Math.ceil((from * 256) / seq.rate);
    cast.start = this.tickCount - t0;
    cast.fired = 0;
    cast.hitTicks = [];
    seq.frames.forEach((f, i) => {
      if (i >= from && f[2] === 1 && f[0] !== 'RN') cast.hitTicks.push(Math.ceil((i * 256) / seq.rate));
    });
    cast.end = cast.start + Math.ceil((seq.frames.length * 256) / seq.rate);
  }

  private landLeap(cast: Cast): void {
    if (!cast.leap) return;
    this.player.x = cast.leap.tx;
    this.player.y = cast.leap.ty;
  }

  /** 밀쳐내기: 착지 지점 반대 방향으로 밀고 경직. 근사(원작 미확인): 거리 2 서브타일 */
  private knockBack(m: MonsterUnit): void {
    const p = this.player;
    const d = Math.hypot(m.x - p.x, m.y - p.y) || 1;
    const nx = m.x + ((m.x - p.x) / d) * 2, ny = m.y + ((m.y - p.y) / d) * 2;
    if (this.map.walkable(Math.floor(nx), Math.floor(ny))) {
      m.x = nx;
      m.y = ny;
    }
    m.aggro = true;
    m.aiState = 19;
    if (m.type.modes.has('GH')) this.startMonsterMode(m, 'GH');
  }

  // ---------------------------------------------------------------- 근접 판정

  /**
   * 플레이어 근접 공격.
   * 출처: D2MOO SUNITDMG_GetResultFlags / SUNITDMG_IsHitSuccessful (AR × (100 + 명중%)/100, 방어·레벨 비교),
   *       SUNITDMG_FillDamageValues + ApplyDamageBonuses (무기 피해·강화%·치명타), SKILLS_SrvSt32 (calc2 추가 피해)
   */
  private meleeHit(m: MonsterUnit, spec: MeleeSpec): boolean {
    const c = this.character, data = this.data;
    if (!c || !data) return false;
    const p = this.player;
    if (spec.reach !== undefined ? Math.hypot(m.x - p.x, m.y - p.y) > spec.reach + m.type.sizeX / 2 : !isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, m.x, m.y, m.type.sizeX, 1)) return false;
    const shieldBase = spec.shield && this.equipment.larm ? data.items.base(this.equipment.larm.code) : undefined;
    const w = spec.shield ? shieldBase : this.weaponBase();
    const passives = this.passives();
    const pct = spec.toHitPct + masteryBonus(passives, data.items, w, 'th') + this.playerStat('item_tohit_percent') + (this.derived()?.toHitPct ?? 0);
    const ar = this.playerAR();
    // Smite: 명중 판정 결과와 무관하게 성공 (출처: SKILLS_SrvDo150_Smite — GetResultFlags | SUCCESSFULHIT)
    // 악마·언데드 명중은 AR 에 그대로 더한 뒤 명중 % (출처: SUNITDMG_IsHitSuccessful:2495)
    const arAll = ar + this.vsTypeStat(m, 'item_demon_tohit', 'item_undead_tohit');
    if (!spec.shield && !rollPercent(hitChance(arAll + Math.trunc((arAll * pct) / 100), this.targetDefense(m, false), c.level, m.stats.level), this.rng)) {
      this.events.push({ type: 'miss', targetId: m.id });
      // 공격 시도 사건 (domeleeattack): 빗나가도 (출처: SUnitDmg.cpp:2377)
      this.procItemSkills('item_skillonattack', m, m);
      return false;
    }
    this.onPlayerHitMonster(m);
    const d = emptyDamage();
    const dv = this.derived();
    if (spec.kick) d.phys = this.rollKick(spec);
    else d.phys = rollWeaponDamage({
      weapon: w, str: this.effStat('str'), dex: this.effStat('dex'), enDmgPct: spec.enDmgPct + (spec.shield ? 0 : this.vsTypeDamagePct(m, w)), damagePercent: this.playerStat('damagepercent'),
      masteryDmg: spec.shield ? 0 : masteryBonus(passives, data.items, w, 'dmg'), srcDam: spec.srcDam,
      weaponRange: !spec.shield && dv && w ? { min: dv.weaponMin + dv.addMin, max: dv.weaponMax + dv.addMax } : undefined,
      itemDamagePct: dv?.offWeaponEdPct ?? 0,
      ...(spec.shield ? { extraBase: this.holyShieldSmite() } : {}),
    }, this.rng);
    if (spec.vengeance) {
      // Vengeance: 무기 기본 피해(보너스 전) 굴림의 calc1/2/3 % 를 화염·냉기·번개로 (출처: SKILLS_SrvSt35_Vengeance)
      const base = weaponBaseRange(w);
      const lo = Math.max(base.min, 256), hi = base.max <= lo ? lo + 256 : base.max;
      const roll = lo + this.rng.pick(hi - lo);
      d.fire += Math.trunc((roll * spec.vengeance.fire) / 100);
      d.cold += Math.trunc((roll * spec.vengeance.cold) / 100);
      d.ltng += Math.trunc((roll * spec.vengeance.ltng) / 100);
      d.coldLen += spec.vengeance.coldLen;
    }
    if (spec.stunLen) d.stunLen += spec.stunLen;
    if (!spec.kick && rollCritical(masteryBonus(passives, data.items, w, 'crit'), this.playerStat('passive_critical_strike'), this.rng, dv?.stat('item_deadlystrike') ?? 0)) {
      d.phys *= 2;
      d.crit = true;
    }
    d.phys += spec.flat256;
    if (spec.physPct) d.phys = Math.max(0, d.phys + Math.trunc((d.phys * spec.physPct) / 100));
    // Maul 상태: 기절 (aurastat stunlength)
    const stunSt = this.player.states.stat('stunlength');
    if (stunSt > 0) d.stunLen += stunSt;
    if (spec.convPct && spec.convPct > 0 && spec.convType) {
      // 물리 피해의 convPct % 를 원소로 (Berserk calc4 = 100 → 전부 마법). 출처: SUNITDMG_FillDamageValues (dwConvPct)
      const conv = Math.trunc((d.phys * Math.min(100, spec.convPct)) / 100);
      d.phys -= conv;
      addElemental(d, spec.convType, conv, 0);
    }
    for (const pc of spec.prgConv ?? []) {
      const conv = Math.min(Math.trunc((d.phys * Math.min(100, pc.pct)) / 100), d.phys);
      d.phys -= conv;
      addElemental(d, pc.eType, conv, 0);
    }
    d.hitClass = spec.hitClass || (w ? (data.hitClassIndex.get(w.hitClass) ?? 1) : 1);
    if (spec.elem) addElemental(d, spec.elem.eType, spec.elem.amount, spec.elem.len);
    if (spec.extra) addDamage(d, spec.extra);
    if (spec.freezeDiv) d.freezeLen += Math.trunc(d.coldLen / spec.freezeDiv);
    this.addStatElemental(d);
    if (spec.hitClass) d.hitClass = spec.hitClass;
    const hpBefore = m.hp;
    this.lastMeleePhys = d.phys;
    this.damageMonster(m, d, 'player', undefined, 'melee');
    this.procItemSkills('item_skillonattack', m, m);
    if (!spec.shield && !spec.kick) this.wearWeapon();
    if (spec.knockback && m.mode !== 'DT' && m.mode !== 'DD') this.knockBack(m);
    // 생명·마나 흡수: 준 물리 피해의 lifedrainmindam / manadrainmindam % (Normal LifeStealDivisor 1). 출처: itemstatcost.txt, DifficultyLevels.txt
    const dvl = this.derived();
    if (dvl) {
      const phys = Math.min(applyMonsterResists(d, this.monsterResists(m)).phys / 256, Math.max(0, hpBefore));
      // 상태 흡수 (Feral Rage aurastat lifedrainmindam) 포함
      const ll = dvl.stat('lifedrainmindam') + this.player.states.stat('lifedrainmindam') + (spec.leech?.life ?? 0);
      const ml = dvl.stat('manadrainmindam') + this.player.states.stat('manadrainmindam') + (spec.leech?.mana ?? 0);
      if (ll > 0) c.life = Math.min(this.maxLife(), c.life + (phys * ll) / 100 / this.rules.lifeStealDivisor);
      if (ml > 0) c.mana = Math.min(this.maxMana(), c.mana + (phys * ml) / 100 / this.rules.manaStealDivisor);
    }
    if (spec.selfDamagePct) {
      // Sacrifice: 준 물리 피해(대상 생명 이하)의 calc2 % 만큼 자신 피해 (출처: SKILLS_SrvDo064_Sacrifice)
      const dealt = Math.min(applyMonsterResists(d, m.type.resist).phys / 256, Math.max(0, hpBefore));
      c.life = Math.max(0, c.life - Math.trunc((dealt * spec.selfDamagePct) / 100));
      if (c.life <= 0) this.playerDie();
    }
    return true;
  }

  /**
   * 스탯으로 붙은 원소 피해 (Enchant 의 firemindam/firemaxdam 등): 무기 공격에 더한다.
   * 출처: SUNITDMG_FillDamageValues — SrcDam 128 이면 스탯 최소~최대 << 8 굴림 (+ 원소 마스터리)
   */
  private addStatElemental(d: DamagePacket): void {
    const roll = (minStat: string, maxStat: string) => {
      const max = this.playerStat(maxStat) * 256;
      if (max < 8) return 0;
      const min = this.playerStat(minStat) * 256;
      return min + (max > min ? this.rng.pick(max - min) : 0);
    };
    d.fire += roll('firemindam', 'firemaxdam');
    d.ltng += roll('lightmindam', 'lightmaxdam');
    d.cold += roll('coldmindam', 'coldmaxdam');
    d.mag += roll('magicmindam', 'magicmaxdam');
    // 독 (Venom 상태): 스탯 값이 이미 프레임당 1/256 (skills.txt enms·exms) — << 8 하지 않는다.
    // 길이 = skill_poison_override_length 가 있으면 그 값, 아니면 poisonlength. 출처: SUNITDMG_FillDamageValues
    const pmin = this.playerStat('poisonmindam'), pmax = this.playerStat('poisonmaxdam');
    const pois = pmax > 0 ? pmin + (pmax > pmin ? this.rng.pick(pmax - pmin) : 0) : 0;
    if (pois > 0) {
      d.pois += pois;
      d.poisLen = Math.max(d.poisLen, this.playerStat('skill_poison_override_length') || this.playerStat('poisonlength'));
    }
  }

  /** 몬스터 방어력 (상태 반영): (기본 + armorclass) × (100 + skill_armor_percent) / 100 */
  private monsterDefense(m: MonsterUnit, _missile: boolean): number {
    const base = m.stats.defense + m.states.stat('armorclass');
    return Math.max(0, Math.trunc((base * (100 + m.states.stat('skill_armor_percent'))) / 100));
  }

  /**
   * 몬스터에게 피해 적용: 저항 → 생명 감소 → 기절·냉기·빙결·독 → 피격 경직/사망.
   * 출처: SUNITDMG_CalculateTotalDamage / SUNITDMG_ExecuteEvents (기절 최대 250, 냉기 = coldeffect 감속, 빙결은 coldeffect < 0 인 몬스터만,
   *       독 = 매 프레임 hpregen 감소, 같은 독은 더 센 쪽으로 갱신)
   */
  /** @param proc 플레이어 무기 공격 (근접 / 무기 피해를 실은 미사일) — 아이템 공격 사건 (강타·상처 악화·감속 …) */
  private damageMonster(m: MonsterUnit, raw: DamagePacket, source: 'player' | 'pet' | 'other' = 'player', attackerId?: number, proc?: 'melee' | 'missile'): void {
    this.applyMonsterDamage(m, raw, source, attackerId, proc);
    // 명중 사건 (domeleedamage / domissiledamage) 의 스킬 발동 — 대상이 죽었으면 그 자리에 (출처: SKILLITEM_EventFunc20)
    if (proc && source === 'player' && !m.pet && !m.hidden) this.procItemSkills('item_skillonhit', m.mode === 'DT' || m.mode === 'DD' ? undefined : m, { x: m.x, y: m.y });
  }

  private applyMonsterDamage(m: MonsterUnit, raw: DamagePacket, source: 'player' | 'pet' | 'other', attackerId: number | undefined, proc: 'melee' | 'missile' | undefined): void {
    if (m.pet) {
      this.damagePet(m, raw);
      return;
    }
    // Phase 5: 대상이 될 수 없는 몬스터 (굴 속·물속·비행) 는 맞지 않는다
    if (m.hidden) return;
    // Phase 8: 용병이 보스(monstats boss)에게 주는 피해 = DifficultyLevels HireableBossDamagePercent (50/35/25 %). 출처: SUnitDmg.cpp nDamagePercent
    if (source === 'pet' && attackerId !== undefined && attackerId === this.merc?.unitId && m.type.boss) raw = scaleDamage(raw, this.rules.hireableBossDamagePercent);
    const d = applyMonsterResists(raw, source === 'player' ? this.piercedResists(m) : this.monsterResists(m));
    // Phase 5: 몬스터 Bone Armor (Abyss/Oblivion Knight) — 물리 피해 흡수 (출처: SKILLS_EventFunc22 absorbdamage)
    const bone = m.states.get('bonearmor');
    if (bone && (bone.stats.bonearmor ?? 0) > 0 && d.phys > 0) {
      const ab = Math.min(d.phys, bone.stats.bonearmor ?? 0);
      bone.stats.bonearmor = (bone.stats.bonearmor ?? 0) - ab;
      d.phys -= ab;
      if ((bone.stats.bonearmor ?? 0) <= 0) m.states.remove('bonearmor');
    }
    // 피해를 주는 사건 (domeleedamage / domissiledamage): 생명 감소 전 (출처: SUNITDMG_ExecuteEvents)
    const knock = proc && source === 'player' && !m.pet ? this.itemDamageEvents(m, proc === 'missile') : false;
    const total = totalDamage(d);
    const hpBefore = m.hp;
    m.hp -= total / 256;
    m.aggro = true;
    // 용병 생명 흡수 (장비 lifedrainmindam): 준 물리 피해(대상 생명 이하)의 % / LifeStealDivisor. 출처: SUnitDmg.cpp:484 (용병은 플레이어처럼 아이템 % 흡수)
    const mu = source === 'pet' && attackerId !== undefined && attackerId === this.merc?.unitId ? this.mercUnit() : undefined;
    const mll = mu ? mu.states.stat('lifedrainmindam') : 0;
    if (mu && mll > 0) mu.hp = Math.min(mu.stats.maxHp, mu.hp + (Math.min(d.phys / 256, Math.max(0, hpBefore)) * mll) / 100 / this.rules.lifeStealDivisor);
    // 출처: SUnitDmg.cpp — 피격 경직 없이 맞으면 AI 상태 19 (방금 맞음)
    m.aiState = 19;
    if (m.hp > 0) this.onMonsterDamaged(m);
    // Howl 공포는 맞으면 풀린다 (Terror 저주는 유지)
    if (!m.states.get('terror')?.skill) m.states.remove('terror');
    // Life Tap: 저주받은 몬스터에게 준 피해의 calc1 % 만큼 회복 (auraevent damagedinmelee/damagedbymissile)
    const lt = m.states.get('lifetap');
    const c = this.character;
    if (lt?.skill && source === 'player' && c) {
      const ls = this.skillRecord(lt.skill.id), calc = this.data?.skillCalc;
      if (ls && calc) c.life = Math.min(this.maxLife(), c.life + (total / 256) * calc.calc(ls, 1, lt.skill.lvl, this.owner()) / 100);
    }
    this.events.push({ type: 'monsterHit', targetId: m.id, damage: Math.floor(total / 256), crit: d.crit });
    if (d.stunLen > 0) m.states.set('stunned', this.tickCount + Math.min(d.stunLen, 250));
    // 출처: DifficultyLevels.txt MonsterColdDivisor / MonsterFreezeDivisor (현재 난이도 행)
    const coldDiv = this.rules.monsterColdDivisor, frzDiv = this.rules.monsterFreezeDivisor;
    if (d.coldLen > 0 && m.type.coldEffect < 0) {
      const eff = m.type.coldEffect;
      m.states.set('cold', this.tickCount + Math.max(1, Math.trunc(d.coldLen / coldDiv)), { velocitypercent: eff, attackrate: eff, other_animrate: eff });
    }
    if (d.freezeLen > 0 && m.type.coldEffect < 0) m.states.set('freeze', this.tickCount + Math.trunc(d.freezeLen / frzDiv));
    if (d.pois > 0 && d.poisLen > 0) {
      const cur = m.states.get('poison');
      if (!cur || -(cur.stats.hpregen ?? 0) <= d.pois) m.states.set('poison', this.tickCount + d.poisLen, { hpregen: -d.pois });
    }
    if (m.hp <= 0) {
      this.killMonster(m, source, attackerId);
      return;
    }
    const stunned = m.states.has('stunned') || m.states.has('freeze');
    // 밀쳐내기 (결과 플래그 8): 경직 판정 대신 밀려난다 (출처: SUnitDmg.cpp:2070 — KNOCKBACK 모드가 없으면 GETHIT)
    if (knock && !stunned) {
      this.knockBack(m);
      return;
    }
    if (!stunned && m.type.modes.has('GH') && rollGetHit(total / 256, m.stats.maxHp, d.hitClass, m.rng)) {
      // Phase 5: Sand Leaper 는 경직되면 밀려난다 (출처: MonsterMode.cpp sub_6FC62DF0 — GETHIT 이고 빙결이 아니면 결과 플래그 8 = 밀쳐내기)
      if (m.type.baseId === 'sandleaper1' && source !== 'other') this.knockBack(m);
      else this.startMonsterMode(m, 'GH');
    }
  }

  /** 보스 계열 (MonStats boss · 슈퍼유니크) */
  private isBossLike(m: MonsterUnit): boolean {
    return m.type.boss || (m.flags & MONFLAG.SUPERUNIQUE) !== 0;
  }

  /** 악마·언데드 대상 스탯 합 (item_demon_* / item_undead_*) */
  private vsTypeStat(m: MonsterUnit, demonStat: string, undeadStat: string): number {
    const dv = this.derived();
    if (!dv) return 0;
    return (m.type.demon ? dv.stat(demonStat) : 0) + (m.type.undead ? dv.stat(undeadStat) : 0);
  }

  /**
   * 악마·언데드 피해 % (ED 합산, 양수만) + 언데드에게 둔기 +50.
   * 출처: SUNITDMG_FillDamageValues:274-297 (ITEMTYPE_BLUNT +50)
   */
  private vsTypeDamagePct(m: MonsterUnit, w: ItemBase | undefined): number {
    const items = this.data?.items;
    const blunt = m.type.undead && !!w && !!items && items.isType(w, 'blun') ? 50 : 0;
    return Math.max(0, this.vsTypeStat(m, 'item_demondamage_percent', 'item_undeaddamage_percent')) + blunt;
  }

  /**
   * 명중 판정에 쓰는 대상 방어: 방어 무시(item_ignoretargetac — 유니크·슈퍼유니크·보스·용병 제외, 챔피언은 됨),
   * 방어 감소 %(item_fractionaltargetac — 보스·슈퍼유니크·용병에게는 절반, 0~100).
   * 출처: SUNITDMG_IsHitSuccessful:2478-2493
   */
  private targetDefense(m: MonsterUnit, missile: boolean): number {
    const def = this.monsterDefense(m, missile), dv = this.derived();
    if (!dv || m.pet) return def;
    const uniq = (m.flags & (MONFLAG.UNIQUE | MONFLAG.SUPERUNIQUE)) !== 0;
    if (dv.stat('item_ignoretargetac') > 0 && !uniq && !m.type.boss) return 0;
    let frac = dv.stat('item_fractionaltargetac');
    if (frac <= 0) return def;
    if (this.isBossLike(m)) frac = Math.trunc(frac / 2);
    frac = Math.min(100, frac);
    return def - Math.trunc((def * frac) / 100);
  }

  /**
   * 명중한 플레이어 무기 공격: 회복 불가(item_preventheal — 몬스터 양수 재생 막음), 몬스터 방어 영구 감소(item_damagetargetac, 최소 0).
   * 출처: SUNITDMG_PreventMonsterHeal (SUnitDmg.cpp:2422, 2572), SUNITDMG_FillDamageValues:265-272
   */
  private onPlayerHitMonster(m: MonsterUnit): void {
    const dv = this.derived();
    if (!dv || m.pet) return;
    if (dv.stat('item_preventheal') > 0) m.states.set('preventheal', this.tickCount + 120000);
    const ac = dv.stat('item_damagetargetac');
    if (ac) m.stats.defense = Math.max(0, m.stats.defense + ac);
  }

  /**
   * 피해를 주는 아이템 사건 (ItemStatCost itemevent domeleedamage / domissiledamage) — 강타(16)·상처 악화(15)·감속(19)·빙결(14)·공포(8)·밀쳐내기(7).
   * @returns 밀쳐내기 성공
   * 출처: D2MOO SkillItem.cpp SKILLITEM_EventFunc07/08/14/15/16/19
   */
  private itemDamageEvents(m: MonsterUnit, ranged: boolean): boolean {
    const dv = this.derived(), c = this.character;
    if (!dv || !c || m.mode === 'DT' || m.mode === 'DD') return false;
    const roll100 = () => this.rng.pick(100);
    const champUniq = (m.flags & (MONFLAG.CHAMPION | MONFLAG.UNIQUE)) !== 0;
    // 강타: 현재 생명 / (일반·챔피언·유니크 4, 보스·슈퍼유니크 8, 원거리 ×2), 물리 저항만큼 감소 (EventFunc16)
    const cb = dv.stat('item_crushingblow');
    if (cb > 0 && roll100() < cb && m.hp > 0) {
      const div = (this.isBossLike(m) ? 8 : 4) * (ranged ? 2 : 1);
      let hp = Math.trunc((m.hp * 256) / div);
      hp -= Math.trunc((hp * Math.min(this.monsterResists(m).dm, 100)) / 100);
      m.hp -= hp / 256;
      this.events.push({ type: 'crushingBlow', targetId: m.id, damage: hp / 256 });
    }
    // 상처 악화: 200 프레임 동안 hpregen −(f(공격자 레벨) + 40), 챔피언·유니크 /2 (EventFunc15, SKILLITEM_CalculateOpenWoundsHpRegen)
    const ow = dv.stat('item_openwounds');
    if (ow > 0 && roll100() < ow) {
      let regen = openWoundsRegen(c.level) + 40;
      if (champUniq) regen = Math.trunc(regen / 2);
      m.states.set('openwounds', this.tickCount + 200, { hpregen: -regen });
    }
    // 감속: 750 프레임 이동·공격·애니 −v, 챔피언·유니크·보스 50 / 슈퍼유니크 75 / 그 밖 90 상한 (EventFunc19)
    // 근사: D2MOO 판본의 if (nSlowValue) return 0 반전은 원래 의도(0 이면 없음)로
    const slow = dv.stat('item_slow');
    if (slow > 0) {
      const cap = champUniq || m.type.boss ? 50 : (m.flags & MONFLAG.SUPERUNIQUE) !== 0 ? 75 : 90;
      const v = Math.min(slow, cap);
      m.states.set('slowed', this.tickCount + 750, { velocitypercent: -v, attackrate: -v, other_animrate: -v });
    }
    // 빙결: 확률 5×(4(v−1) − 대상 레벨 + 공격자 레벨 + 10) (원거리: 공격자 레벨 −6, /3), 길이 2(확률 − rand) + 25 (25~250) — 냉기 저항으로 줄고
    //       보스·유니크는 냉기 둔화만, 냉기 효과 없는 몬스터는 면역 (EventFunc14, SUNITDMG_ApplyFreezeState)
    const fz = dv.stat('item_freeze');
    if (fz > 0 && m.type.coldEffect < 0) {
      let chance = 5 * (4 * (fz - 1) - m.stats.level + c.level - (ranged ? 6 : 0) + 10);
      if (ranged) chance = Math.trunc(chance / 3);
      chance = Math.max(0, Math.min(100, chance));
      const diff = chance - roll100();
      if (diff > 0) {
        let len = Math.max(25, Math.min(250, 2 * diff + 25));
        len = Math.trunc((len * (100 - Math.max(-100, Math.min(100, this.piercedResists(m).co)))) / 100);
        if (len > 0) {
          const eff = m.type.coldEffect;
          if (this.isBossLike(m) || (m.flags & MONFLAG.UNIQUE) !== 0) m.states.set('cold', this.tickCount + Math.max(1, Math.trunc(len / this.rules.monsterColdDivisor)), { velocitypercent: eff, attackrate: eff, other_animrate: eff });
          else m.states.set('freeze', this.tickCount + Math.max(1, Math.trunc(len / this.rules.monsterFreezeDivisor)));
        }
      }
    }
    // 공포: 유니크·챔피언 아니면 (rand & 127) < v 일 때 20 프레임 공포 (EventFunc08 → AIUTIL_ApplyTerrorCurseState)
    const howl = dv.stat('item_howl');
    if (howl > 0 && !champUniq && !(m.flags & MONFLAG.SUPERUNIQUE) && (this.rng.pick(128) < howl)) {
      m.states.set('terror', this.tickCount + 20);
      m.path = [];
      m.nextThink = this.tickCount;
    }
    // 실명: 확률 5×(공격자 레벨 + 4v − 대상 레벨 + 6) (원거리 /3, 1~99), 성공 폭 d 로 Dim Vision 레벨 d/5 + 1 (1~20) (EventFunc09)
    const stu = dv.stat('item_stupidity');
    if (stu > 0) {
      let chance = 5 * (c.level + 4 * stu - m.stats.level + 6);
      if (ranged) chance = Math.trunc(chance / 3);
      chance = Math.max(1, Math.min(99, chance));
      const diff = chance - roll100();
      const dim = this.data?.skills?.byNameOf('Dim Vision');
      if (diff > 0 && dim && !this.inItemSkill) {
        this.inItemSkill = true;
        try {
          this.skillEvent({ skill: dim, lvl: Math.max(1, Math.min(20, Math.trunc(diff / 5) + 1)), targetId: m.id, tx: m.x, ty: m.y, start: this.tickCount, end: this.tickCount, hitTicks: [], fired: 0 }, 0);
        } finally {
          this.inItemSkill = false;
        }
      }
    }
    // 밀쳐내기: (rand & 127) < 64 (큰 몬스터 32, 작은 몬스터 128) (EventFunc07)
    if (dv.stat('item_knockback') > 0) {
      const chance = m.type.large ? 32 : m.type.small ? 128 : 64;
      if (this.rng.pick(128) < chance) return true;
    }
    return false;
  }

  /**
   * 플레이어가 준 피해의 저항: 원소 관통(passive_<원소>_pierce, Cold Mastery)은 저항 100 미만인 몬스터에게만,
   * Sanctuary 상태의 공격자는 언데드의 물리 저항을 0 으로 (양수일 때).
   * 출처: D2MOO SUNITDMG_ApplyResistancesAndAbsorb (nResValue < 100 || 방어자가 몬스터 아님 → − pierce; STATE_SANCTUARY && 언데드 → 0)
   */
  private piercedResists(m: MonsterUnit): { dm: number; fi: number; li: number; co: number; ma: number; po: number } {
    const r = this.monsterResists(m);
    const pierce = (v: number, stat: string) => {
      const p = this.playerStat(stat);
      return p && v < 100 ? v - p : v;
    };
    return {
      dm: r.dm > 0 && m.type.undead && this.player.states.has('sanctuary') ? 0 : r.dm,
      fi: pierce(r.fi, 'passive_fire_pierce'), li: pierce(r.li, 'passive_ltng_pierce'), co: pierce(r.co, 'passive_cold_pierce'),
      ma: r.ma, po: pierce(r.po, 'passive_pois_pierce'),
    };
  }

  /**
   * 몬스터 저항 + 저주·오라 (Amplify Damage: damageresist −100, Lower Resist, Conviction).
   * 면역(기본 저항 ≥ 100)인 칸의 저항 감소는 1/5 만 적용된다 (용병·플레이어 제외) — 클래식 1.14d 도 같은 코드 (확장 여부 검사 없음).
   * 출처: D2MOO SkillNec.cpp sub_6FD0B450 / sub_6FD0C2F0 (저주: nValue <= 0 && STATLIST_GetUnitBaseStat ≥ 100 → nValue /= 5),
   *       sub_6FD0B3D0 (오라 SKILLS_AuraCallback_BasicAura — Conviction 같은 규칙)
   */
  private monsterResists(m: MonsterUnit): { dm: number; fi: number; li: number; co: number; ma: number; po: number } {
    const r = m.resist, st = m.states;
    const sum = (base: number, stat: string) => base + st.statBy(stat, (v) => (v < 0 && base >= 100 && !m.pet ? Math.trunc(v / 5) : v));
    return {
      dm: sum(r.dm, 'damageresist'), fi: sum(r.fi, 'fireresist'), li: sum(r.li, 'lightresist'),
      co: sum(r.co, 'coldresist'), ma: sum(r.ma, 'magicresist'), po: sum(r.po, 'poisonresist'),
    };
  }

  private killMonster(m: MonsterUnit, source: 'player' | 'pet' | 'other' = 'player', attackerId?: number): void {
    m.hp = 0;
    m.path = [];
    // 출처: SkillDruid.cpp sub_6FD01B00 — 임신 상태가 풀릴 때 죽어 있으면 Pain Worm (skills.txt Impregnate summon) 이 나온다
    const brood = m.states.has('pregnant') ? m.pregnantWith : undefined;
    m.states.clear();
    if (brood && this.data?.monsters.types.has(brood)) {
      const w2 = this.spawnMonMinion(m, brood, m.x, m.y, 'NU', { noTc: true });
      if (w2) this.events.push({ type: 'monsterBirth', monsterId: w2.id, from: m.id });
    }
    m.cast = undefined;
    this.startMonsterMode(m, 'DT');
    m.deathFrame = this.tickCount;
    this.events.push({ type: 'monsterKilled', targetId: m.id, typeId: m.type.id, flags: m.flags, ...(m.superUnique !== undefined ? { superUnique: m.superUnique } : {}) });
    m.hidden = false;
    m.dash = undefined;
    m.stream = undefined;
    m.pathMode = false;
    // Phase 5: 봉인 보스·디아블로 (A4Q2), 죽을 때 터지는 몬스터
    this.onChaosKill(m);
    this.monDeathDamage(m);
    const c = this.character, cs = this.classStats, table = this.expTable;
    // 소환수가 죽인 몬스터도 주인이 경험치를 받는다. 혼란·가시 등 다른 원인도 플레이어 근처면 받음 (근사)
    // 부활·둥지 스폰 몬스터는 경험치·드롭 없음 (UNITFLAG_NOXP | NOTC)
    if (!m.noXp && c && cs && table && (source !== 'other' || Math.hypot(m.x - this.player.x, m.y - this.player.y) < 40)) {
      // 경험 신전: item_addexperience % 만큼 더 (출처: shrines.txt Experience Boost Arg0 = 50, itemstatcost item_addexperience)
      const bonus = this.playerStat('item_addexperience');
      this.gainExperience(Math.trunc((adjustedExperience(m.stats.exp, c.level, m.stats.level) * (100 + bonus)) / 100));
    }
    if (!m.noXp && source !== 'other') this.mercGainExp(m, attackerId);
    if (source === 'player') this.onPlayerKill(m);
    this.onMonsterDeathMods(m);
    const data = this.data;
    // 드롭 TC 는 퀘스트 콜백보다 먼저 정한다 (첫 처치 = 퀘스트 드롭)
    const tc = m.noTc ? '' : this.monsterTc(m, source);
    if (data && tc) {
      for (const item of data.treasure.drop(tc, m.stats.level, m.rng, this.derived()?.stat('item_magicbonus') ?? 0, { goldFind: source === 'other' ? 0 : (this.derived()?.stat('item_goldbonus') ?? 0) })) {
        this.dropItem(item, m.x + 1, m.y + 1);
        this.events.push({ type: 'itemDropped', itemId: item.id, code: item.code, quality: item.quality, tc });
      }
    }
    // 출처: QUESTS_ParseKill — 몬스터의 퀘스트 연결 (플레이어·소환수·용병이 죽였으면 pPlayer)
    if (!m.pet && !m.npc) {
      const levelNo = this.levels.get(m.levelKey ?? '')?.def.levelNo ?? this.level.def.levelNo ?? 0;
      const su = m.superUnique !== undefined ? this.data?.uniques?.superUnique(m.superUnique)?.key : undefined;
      // 근사(원작 미확인): "같은 방이나 이웃 방" 대신 같은 레벨의 40 서브타일 안
      const near = this.level.monsters.includes(m) && Math.hypot(m.x - this.player.x, m.y - this.player.y) < 40;
      this.questControl.monsterKilled({ levelNo, typeId: m.type.id, ...(su ? { superUnique: su } : {}), x: m.x, y: m.y, byPlayer: source !== 'other', playerNear: near,
        // Phase 7: 유닛 번호·유니크(MONTYPEFLAG 2 SUPERUNIQUE | 8 UNIQUE)·비행 (옥 조각상·기드빈 보스)
        id: m.id, boss: (m.flags & 10) !== 0, flying: m.type.flying });
    }
  }

  /**
   * 아이템 효과 스킬: 마나·쿨다운·애니 없이 즉시 효과 (skills.txt ItemEffect 가 있는 스킬만).
   * 대상 = ItemTarget (1 자신 · 2 ±20 무작위 지점 · 3 근처 시체 · 4 마지막 공격자, 그 밖은 상대).
   * 출처: D2MOO SKILLITEM_CastSkillOnTarget / OnPosition → SKILLITEM_HandleItemEffectSkill → D2GAME_SKILLS_Handler (a6 = 1)
   * 근사(원작 미확인): ItemTgtDo(상대가 자기에게 시전 — Teleport) 는 건너뛴다, ItemEffect 의 별도 srvdofunc(36·151)는 skills.txt srvdofunc 로
   */
  private castItemSkill(skillId: number, lvl: number, target: MonsterUnit | undefined, at: Pt): boolean {
    const s = this.skillRecord(skillId), p = this.player;
    if (!s || !s.itemEffect || lvl <= 0 || s.itemTgtDo || this.isDead) return false;
    let tx = target?.x ?? at.x, ty = target?.y ?? at.y, targetId = target && target.mode !== 'DT' && target.mode !== 'DD' ? target.id : undefined;
    if (s.itemTarget === 1) {
      tx = p.x;
      ty = p.y;
      targetId = undefined;
    } else if (s.itemTarget === 2) {
      tx = p.x + this.rng.pick(41) - 20;
      ty = p.y + this.rng.pick(41) - 20;
      targetId = undefined;
    } else if (s.itemTarget === 3) {
      const corpse = this.monsters.filter((m) => m.mode === 'DD' && !m.corpseUsed && !m.pet).sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty))[0];
      if (!corpse) return false;
      tx = corpse.x;
      ty = corpse.y;
      targetId = corpse.id;
    } else if (s.itemTarget === 4) {
      const last = this.monsters.find((m) => m.id === this.lastAttackerId && m.mode !== 'DT' && m.mode !== 'DD') ?? target;
      if (!last) return false;
      tx = last.x;
      ty = last.y;
      targetId = last.id;
    }
    if (s.itemCheckStart && !this.startCheck(s, targetId)) return false;
    this.inItemSkill = true;
    try {
      this.skillEvent({ skill: s, lvl, targetId, tx, ty, start: this.tickCount, end: this.tickCount, hitTicks: [], fired: 0 }, 0);
    } finally {
      this.inItemSkill = false;
    }
    this.events.push({ type: 'itemSkill', skill: s.id, level: lvl });
    return true;
  }

  /**
   * 아이템 스킬 발동 (layer = 스킬 << 6 | 레벨, 값 = 확률 %, 같은 layer 합산): 공격 시도·명중·피격·처치·죽음·레벨업.
   * 출처: D2MOO SKILLITEM_EventFunc20 (attack/hit/kill) · 21 (struck) · 30 (death/levelup), ItemStatCost itemevent
   */
  private procItemSkills(stat: 'item_skillonattack' | 'item_skillonhit' | 'item_skillongethit' | 'item_skillonkill' | 'item_skillondeath' | 'item_skillonlevelup', target: MonsterUnit | undefined, at: Pt): void {
    if (this.inItemSkill) return;
    const dv = this.derived();
    if (!dv) return;
    const byLayer = new Map<number, number>();
    for (const l of dv.layered) if (l.stat === stat) byLayer.set(l.param, (byLayer.get(l.param) ?? 0) + l.value);
    for (const [layer, chance] of byLayer) if (chance > 0 && this.rng.pick(100) < chance) this.castItemSkill(layer >> 6, layer & 63, target, at);
  }

  /**
   * 처치 사건 (kill): 처치 후 생명(item_healafterkill)·악마 처치 후 생명(item_healafterdemonkill)·마나(item_manaafterkill), 최대치까지.
   * 출처: D2MOO SKILLITEM_EventFunc28 / EventFunc18 / EventFunc17 (ItemStatCost itemevent kill)
   */
  private onPlayerKill(m: MonsterUnit): void {
    const c = this.character, dv = this.derived();
    if (!c || !dv || this.isDead) return;
    this.procItemSkills('item_skillonkill', undefined, { x: m.x, y: m.y });
    const life = dv.stat('item_healafterkill') + (m.type.demon ? dv.stat('item_healafterdemonkill') : 0);
    if (life > 0 && c.life < this.maxLife()) c.life = Math.min(this.maxLife(), c.life + life);
    const mana = dv.stat('item_manaafterkill');
    if (mana > 0 && c.mana < this.maxMana()) c.mana = Math.min(this.maxMana(), c.mana + mana);
    // 처치한 몬스터는 편히 쉰다 (시체를 쓸 수 없음). 출처: SKILLITEM_EventFunc29 (STATE_RESTINPEACE)
    // 근사(원작 미확인): 상태 대신 시체 사용 불가 표시
    if (dv.stat('item_restinpeace') > 0) m.corpseUsed = true;
    // 되살리기 (item_reanimate, param = MonStats 번호): 유니크·챔피언이 아니면 v% 로 그 몬스터가 소환수로 살아난다.
    // 출처: SKILLITEM_EventFunc31 / SKILLITEM_TimerCallback_ReanimateMonster — 근사(원작 미확인): UMod 21 이벤트(+1500 프레임)를 수명으로
    if (m.corpseUsed || (m.flags & (MONFLAG.UNIQUE | MONFLAG.CHAMPION)) !== 0) return;
    for (const l of dv.layered) {
      if (l.stat !== 'item_reanimate' || l.value <= 0 || this.rng.pick(100) >= l.value) continue;
      const type = this.data?.monsters.list[l.param];
      const s = this.skillRecord(0);
      if (!type || !s) continue;
      if (this.summonPet(s, 1, type.id, m.x, m.y, 'none', { expires: this.tickCount + 1500 }, { level: m.stats.level })) {
        m.corpseUsed = true;
        this.events.push({ type: 'reanimated', targetId: m.id, typeId: type.id });
      }
      break;
    }
  }

  /**
   * 몬스터 드롭 TC. 출처: MonsterMode.cpp sub_6FC631B0 — 슈퍼유니크 = SuperUniques TC, 챔피언 = TreasureClass2, 유니크 = TreasureClass3,
   * 그 밖 = TreasureClass1; TCQuestId 가 있고 죽인 플레이어의 퀘스트 기록에서 COMPLETEDBEFORE·REWARDPENDING·TCQuestCP 비트가 모두 꺼져 있으면
   * TreasureClass4 (Andariel → Andarielq).
   * TC 레벨 업그레이드는 몬스터 레벨 (챔피언 +2, 유니크 +3) 로 TreasureDb.resolve 가 처리
   */
  monsterTc(m: MonsterUnit, source: 'player' | 'pet' | 'other' = 'player'): string {
    const t = m.type;
    let tc = t.treasure[0] ?? '';
    if (m.superUnique !== undefined) tc = this.data?.uniques?.superUnique(m.superUnique)?.tc || t.treasure[2] || '';
    else if (m.flags & MONFLAG.CHAMPION) tc = t.treasure[1] ?? '';
    else if (m.flags & MONFLAG.UNIQUE) tc = t.treasure[2] ?? '';
    const r = this.questRecord;
    if (t.tcQuestId && t.treasure[3] && source !== 'other' && !r.get(t.tcQuestId, QFLAG.COMPLETEDBEFORE) && !r.get(t.tcQuestId, QFLAG.REWARDPENDING) && !r.get(t.tcQuestId, t.tcQuestCP)) tc = t.treasure[3];
    return tc;
  }

  /**
   * 보스 수식어의 죽음 효과 (MonUMod 표 1·2번 칸).
   * 출처: MONSTERUNIQUE_CastCorpseExplode (Fire Enchanted: 최대 = monstats 생명(현재 레벨) × MonsterCEDamagePercent / 100, 최소 60%,
   *       물리·화염 반씩, 반경 난이도+4), MONSTERUNIQUE_CastColdUniqueMissile (Cold Enchanted: coldunique 노바, 레벨 mlvl/2)
   * 근사(원작 미확인): 원작은 죽고 4 프레임 뒤 — 여기서는 죽는 순간
   */
  private onMonsterDeathMods(m: MonsterUnit): void {
    const data = this.data;
    if (!data || !m.umods.length) return;
    const unique = (m.flags & MONFLAG.UNIQUE) !== 0;
    if (m.umods.includes(UMOD.FIRE) && unique) {
      const hp = Math.trunc((m.type.maxHpPct * data.monsters.levelBase(Math.max(1, m.stats.level), 'HP')) / 100);
      const pct = this.rules.monsterCEDamagePercent;
      const max = Math.trunc((hp * pct) / 100), min = Math.trunc((max * 60) / 100);
      const dmg = min + m.rng.pick(Math.max(0, max - min));
      const explode = data.missiles.get('monstercorpseexplode');
      if (explode) this.missiles.push({ id: this.nextUnitId++, def: explode, x: m.x, y: m.y, dx: 0, dy: 0, left: explode.range, age: 0, owner: 'monster', ownerId: m.id, ownerLevel: m.stats.level, hitClass: 0, hit: new Set(), lvl: 1, visual: true });
      if (Math.hypot(this.player.x - m.x, this.player.y - m.y) <= this.difficulty + 4) {
        const pkt = emptyDamage();
        pkt.phys = (dmg << 8) >> 1;
        pkt.fire = (dmg << 8) >> 1;
        this.damagePlayerDirect(pkt, 'fireEnchanted');
      }
      this.events.push({ type: 'enchantEffect', monsterId: m.id, effect: 'fireExplosion', damage: dmg });
    }
    if (m.umods.includes(UMOD.COLD) && unique) {
      const lvl = Math.max(1, Math.trunc(m.stats.level / 2));
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.launchMonsterMissile(m, 'coldunique', m.x + Math.cos(a) * 10, m.y + Math.sin(a) * 10, { lvl, mode: 'A1', noMulti: true });
      }
      this.events.push({ type: 'enchantEffect', monsterId: m.id, effect: 'coldNova' });
    }
  }

  /**
   * 부활. 출처: SkillMonst.cpp SKILLS_ResurrectUnit / SrvDo097_Resurrect — 생명 가득, NOTC|NOXP, MonStats2 ResurrectMode
   * (ResurrectSkill 이 있으면 그 스킬 시퀀스: 스켈레톤 SkeletonRaise = 죽음 애니메이션 거꾸로)
   */
  private resurrectMonster(t: MonsterUnit): void {
    t.hp = t.stats.maxHp;
    t.noXp = true;
    t.noTc = true;
    t.corpseUsed = false;
    t.deathFrame = -1;
    t.states.clear();
    t.path = [];
    t.aiState = 1;
    t.nextThink = this.tickCount + 1;
    const skill = t.type.resurrectSkill ? t.type.skills.find((s) => s.name === t.type.resurrectSkill) : undefined;
    const seq = skill?.mode.startsWith('seq_') ? this.data?.monsters.seqs.get(skill.mode) : undefined;
    t.mode = 'NU';
    if (seq?.length) this.startMonsterMode(t, 'SQ', this.makeCast(t, -2, 'resurrect', 1, null, seq));
    else {
      const mode = (t.type.resurrectMode in MONMODE_INDEX ? t.type.resurrectMode : 'NU') as MonMode;
      this.startMonsterMode(t, mode);
    }
    this.events.push({ type: 'monsterResurrected', targetId: t.id, typeId: t.type.id });
  }

  /** Lightning Enchanted: 맞을 때 (10 프레임에 한 번) 사방으로 충전 볼트 8 개. 출처: MONSTERUNIQUE_CastLightUniqueMissile (레벨 mlvl/2) */
  private onMonsterDamaged(m: MonsterUnit): void {
    if (!m.umods.includes(UMOD.LIGHTNING) || !(m.flags & MONFLAG.UNIQUE)) return;
    if (m.lastBolt !== undefined && Math.abs(this.tickCount - m.lastBolt) < 10) return;
    m.lastBolt = this.tickCount;
    const lvl = Math.max(1, Math.trunc(m.stats.level / 2));
    const offs = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    for (const [ox, oy] of offs) for (let j = 0; j < 2; j++) this.launchMonsterMissile(m, 'lightunique', m.x + ox * 8 + j, m.y + oy * 8 - j, { lvl, mode: 'A1', noMulti: true });
    this.events.push({ type: 'enchantEffect', monsterId: m.id, effect: 'chargedBolts' });
  }

  // ---------------------------------------------------------------- 플레이어 미사일

  /** 스킬 미사일 (srvmissile): 피해는 스킬 수치(+ 무기 SrcDam). 출처: D2MOO MISSILE_CalculateDamageData */
  private launchSkillMissile(s: SkillRecord, lvl: number, name: string, tx: number, ty: number, targetId?: number): void {
    const def = this.data?.missiles.get(name);
    if (!def) return;
    this.spawnPlayerMissile(def, s, lvl, tx, ty, targetId, { srcDam: def.srcDamage === -1 ? 0 : s.srcDam, useSkillDamage: true, thrown: this.isThrownWeapon() });
  }

  /** 무기 미사일 (활 Attack, Throw, Double Throw): 무기 missiletype 미사일, 무기 피해 */
  private launchWeaponMissile(s: SkillRecord, lvl: number, tx: number, ty: number, targetId: number | undefined, thrown = false, toHitPct = 0, damagePct = 0): void {
    const w = this.weaponBase(), data = this.data;
    if (!w || !data) return;
    // 마법·폭발 화살 (item_magicarrow / item_explosivearrow): 활 기본 공격이 미사일 27 / 41, 레벨 = 값 (출처: D2COMMON_11039_CheckWeaponIsMissileBased)
    const special = !thrown ? this.specialArrow() : null;
    const def = (special && [...data.missiles.values()].find((m) => m.id === special.missile)) || [...data.missiles.values()].find((m) => m.id === w.missileType) || data.missiles.get(thrown ? 'javelin' : 'arrow');
    if (!def) return;
    if (special) {
      const sk = this.skillFor(def) ?? s;
      this.spawnPlayerMissile(def, sk, special.lvl, tx, ty, targetId, { srcDam: def.srcDamage < 0 ? 0 : def.srcDamage || 128, useSkillDamage: sk !== s, toHitPct, damagePct });
      return;
    }
    this.spawnPlayerMissile(def, s, lvl, tx, ty, targetId, { srcDam: def.srcDamage < 0 ? 0 : def.srcDamage || 128, useSkillDamage: false, thrown, toHitPct, damagePct });
  }

  /** 마법 화살(27, 화살 필요 없음) · 폭발 화살(41) 아이템 — 활만 (출처: D2Skills.cpp:3340, magicarrow 는 탄약 검사 생략 :1787) */
  private specialArrow(): { missile: number; lvl: number; noAmmo: boolean } | null {
    const dv = this.derived();
    if (!dv || !this.isBowWeapon()) return null;
    const ex = dv.stat('item_explosivearrow'), ma = dv.stat('item_magicarrow');
    if (ex > 0) return { missile: 41, lvl: ex, noAmmo: false };
    if (ma > 0) return { missile: 27, lvl: ma, noAmmo: true };
    return null;
  }

  private isThrownWeapon(): boolean {
    const w = this.weaponBase(), items = this.data?.items;
    return !!w && !!items && items.isType(w, 'thro');
  }

  private spawnPlayerMissile(def: MissileDef, s: SkillRecord, lvl: number, tx: number, ty: number, targetId: number | undefined, o: PlayerMissileOpts): Missile | undefined {
    const p = this.player, c = this.character, data = this.data;
    if (!c || !data) return undefined;
    const from = o.from ?? { x: p.x, y: p.y };
    const speed = missileStep(o.velocity ?? def.vel + Math.trunc((lvl * def.velLev) / 8));
    let dx = tx - from.x, dy = ty - from.y;
    const len = Math.hypot(dx, dy) || 1;
    dx = (dx / len) * speed;
    dy = (dy / len) * speed;
    const roll = o.ownDamage ? this.missileOwnRoller(def, s, lvl) : this.missileDamageRoller(def, s, lvl, o);
    const passives = this.passives();
    const w = this.weaponBase();
    let ar: number | undefined;
    if (def.toHit) {
      const base = this.playerAR();
      const skillTh = o.useSkillDamage || s.id > 5 ? (data.skillCalc?.toHit(s, lvl, this.owner()) ?? 0) : 0;
      const pct = skillTh + (o.toHitPct ?? 0) + this.playerStat('item_tohit_percent') + (o.thrown ? masteryBonus(passives, data.items, w, 'th', true) : 0);
      ar = base + Math.trunc((base * pct) / 100);
    }
    const m: Missile = {
      id: this.nextUnitId++, def, x: from.x, y: from.y, dx, dy, left: o.range ?? def.range + lvl * def.levRange, age: 0,
      owner: 'player', ownerId: p.id, ownerLevel: c.level, hitClass: def.hitClass || s.hitClass || 10, ar, roll, hit: new Set(o.skipIds ?? []),
      homingTarget: o.homing ? targetId : undefined, wander: o.wander, group: o.group, skill: s, lvl,
      ...(o.chain ? { chain: o.chain } : {}),
      ...(o.spiral ? { spiral: { cx: from.x, cy: from.y, a: Math.atan2(ty - from.y, tx - from.x), r: 0 } } : {}),
      ...(o.seek ? { seek: o.seek } : {}),
      // 무기 피해를 실은 미사일은 아이템 공격 사건이 붙는다 (출처: Missile.cpp:579 — srcdam ≠ 0 이면 미사일 플래그 1 → DAMAGEHITFLAG_32)
      ...(o.srcDam > 0 ? { procs: true } : {}),
    };
    // 관통: Pierce 플래그 미사일(화살·투창)이 skill_pierce + item_pierce % 로 적을 뚫고 계속 (출처: Missiles.cpp:319-338, missiles.txt Pierce)
    if (def.pierce) {
      const pc = this.playerStat('skill_pierce') + (this.derived()?.stat('item_pierce') ?? 0);
      if (pc > 0) m.pierceChance = pc;
    }
    if (def.srvDoFunc === 15) this.attachFrozenOrb(m, def, s, lvl);
    // 부속 미사일: Exploding Arrow 폭발(HitSubMissile1, 반경 sHitPar1), Poison Javelin 구름 자취(SubMissile1), Plague Javelin 구름(HitSubMissile1)
    const hitSub = def.hitSubMissile1 ? data.missiles.get(def.hitSubMissile1) : undefined;
    if (hitSub && def.srvHitFunc === 4) {
      m.explode = { radius: hitSub.hitParams[0] || 3, roll: this.missileDamageRoller(hitSub, this.skillFor(hitSub) ?? s, lvl, { srcDam: 0, useSkillDamage: true }) };
    }
    if (hitSub && def.srvHitFunc === 2) {
      m.cloudBurst = { def: hitSub, count: 8, roll: this.missileDamageRoller(hitSub, s, lvl, { srcDam: 0, useSkillDamage: o.useSkillDamage }) };
    }
    const sub = def.subMissile1 ? data.missiles.get(def.subMissile1) : undefined;
    // 지면 불(Fire Wall)은 매 프레임, 독 구름은 Param1 프레임마다
    if (sub && isGroundFire(sub)) m.groundTrail = { def: sub, roll: this.missileDamageRoller(sub, this.skillFor(sub) ?? s, lvl, { srcDam: 0, useSkillDamage: true }) };
    else if (sub) m.trail = { def: sub, every: Math.max(1, sub.params[0] || 2), roll: this.missileDamageRoller(sub, s, lvl, { srcDam: 0, useSkillDamage: true }) };
    this.attachDruidMissile(m, def, s, lvl);
    this.missiles.push(m);
    return m;
  }

  /**
   * Frozen Orb: 본체는 적과 부딪히지 않고 Param1 프레임마다 볼트(SubMissile1)를 64방향 표의 방향으로 뿌리며 방향 번호 += Param2,
   * 수명이 끝나면 sHitPar1 간격으로 노바(HitSubMissile1). 볼트는 Frozen Orb 스킬 냉기 피해.
   * 출처: MISSMODE_SrvDo15_FrozenOrb / MISSMODE_SrvHit29_FrozenOrb
   * 근사(원작 미확인): 노바 볼트(frozenorbnova)의 휘는 경로(SrvDo16)는 직선으로
   */
  private attachFrozenOrb(m: Missile, def: MissileDef, s: SkillRecord, lvl: number): void {
    const data = this.data;
    const bolt = def.subMissile1 ? data?.missiles.get(def.subMissile1) : undefined;
    const nova = def.hitSubMissile1 ? data?.missiles.get(def.hitSubMissile1) : undefined;
    if (!bolt) return;
    const every = Math.max(def.params[0] ?? 1, 1), step = def.params[1] ?? 19;
    const boltRoll = this.missileDamageRoller(bolt, this.skillFor(bolt) ?? s, lvl, { srcDam: 0, useSkillDamage: true });
    let index = 0;
    const shoot = (d: MissileDef, i: number, from: Missile, roll: () => DamagePacket) => {
      const sp = missileStep(d.vel), len = 30;
      this.missiles.push({
        id: this.nextUnitId++, def: d, x: from.x, y: from.y, dx: ((ORB_X[i] ?? 0) / len) * sp, dy: ((ORB_Y[i] ?? 0) / len) * sp, left: d.range, age: 0,
        owner: 'player', ownerId: from.ownerId, ownerLevel: from.ownerLevel, hitClass: d.hitClass || 0x30, roll, hit: new Set(), lvl, skill: s,
      });
    };
    m.noCollide = true;
    m.onTick = (ms) => {
      if (ms.left % every !== 0) return;
      shoot(bolt, index, ms, boltRoll);
      index = orbNextIndex(index, step);
    };
    m.onEnd = (ms) => {
      if (!nova) return;
      const roll = this.missileDamageRoller(nova, this.skillFor(nova) ?? s, lvl, { srcDam: 0, useSkillDamage: true });
      for (const i of orbNovaIndices(def.hitParams[0] ?? 4)) shoot(nova, i, ms, roll);
    };
  }

  // ---------------------------------------------------------------- 드루이드 원소

  /**
   * Firestorm(Do117)·Twister/Tornado(Do118): calc1 발. Firestorm 은 첫 발이 대상으로 곧게, 나머지는 흔들리는 경로(ChargedBolt init).
   * 출처: SKILLS_SrvDo117_Firestorm / SKILLS_SrvDo118_Twister_Tornado → sub_6FCFE4C0
   * 근사(원작 미확인): D2MOO 디컴파일의 Firestorm 개수 검사(nParam >= 0 이면 실패)는 부호 오타로 보고 Do118 처럼 1 이상이면 쏜다
   */
  private druidMissiles(s: SkillRecord, lvl: number, tx: number, ty: number, targetId?: number): void {
    const data = this.data, calc = data?.skillCalc;
    const def = data?.missiles.get(s.srvMissileA);
    if (!calc || !def) return;
    let n = calc.calc(s, 1, lvl, this.owner());
    if (n <= 0) return;
    const p = this.player;
    if (s.srvDoFunc === 117) {
      this.spawnPlayerMissile(def, s, lvl, tx, ty, targetId, { srcDam: 0, useSkillDamage: true });
      n--;
    }
    const base = Math.atan2(ty - p.y, tx - p.x);
    for (let i = 0; i < n; i++) {
      const a = base + ((this.rng.pick(9) - 4) * Math.PI) / 12;
      this.spawnPlayerMissile(def, s, lvl, p.x + Math.cos(a) * 10, p.y + Math.sin(a) * 10, undefined, { srcDam: 0, useSkillDamage: true, wander: true });
    }
  }

  /** 제자리 미사일 (Firestorm 불길·Fissure 갈라짐): 스킬 피해, NextHit 이면 NextDelay 프레임 뒤 다시 맞힌다 */
  private spawnStillMissile(def: MissileDef, x: number, y: number, parent: Missile, roll: () => DamagePacket): void {
    if (!this.map.walkable(Math.floor(x), Math.floor(y))) return;
    this.missiles.push({
      id: this.nextUnitId++, def, x, y, dx: 0, dy: 0, left: def.range + parent.lvl * def.levRange, age: 0,
      owner: 'player', ownerId: parent.ownerId, ownerLevel: parent.ownerLevel, hitClass: def.hitClass || 0x20, roll, hit: new Set(),
      lvl: parent.lvl, skill: parent.skill, ...(def.nextHit ? { rehit: new Map<number, number>() } : {}),
      // 덩굴 자취는 생긴 뒤 sHitPar1 프레임 동안만 맞힌다 (MISSMODE_SrvHit50_PlagueVinesTrail)
      ...(def.srvHitFunc === 50 ? { onTick: (ms: Missile) => { if (ms.age > (def.hitParams[0] ?? 0)) ms.noCollide = true; } } : {}),
    });
  }

  /**
   * 드루이드 미사일 함수 (missiles.txt pSrvDoFunc / pSrvHitFunc):
   * Do23 maker 가 새 칸마다 SubMissile 불길, Do25 Eruption 갈라짐, Do27 Tornado 주기 범위 피해,
   * Hit48 Molten Boulder 솟아남 → 굴러가는 바위, 바위(Do6)는 불 자취(SubMissile, 자체 피해)를 남기며 큰 몬스터가 아니면 지나간다(Hit47).
   * 출처: MISSMODE_SrvDo23_24 / SrvDo25_EruptionCenter / SrvDo27_Tornado / SrvHit47 / SrvHit48
   */
  private attachDruidMissile(m: Missile, def: MissileDef, s: SkillRecord, lvl: number): void {
    const data = this.data, calc = data?.skillCalc;
    if (!data || !calc) return;
    const o = this.owner();
    const sub = def.subMissile1 ? data.missiles.get(def.subMissile1) : undefined;
    if (def.srvDoFunc === 23 && sub) {
      m.trail = undefined;
      m.groundTrail = undefined;
      const roll = this.missileDamageRoller(sub, this.skillFor(sub) ?? s, lvl, { srcDam: 0, useSkillDamage: true });
      let cell = -1;
      m.onTick = (ms) => {
        const k = Math.floor(ms.x) * 4096 + Math.floor(ms.y);
        if (k === cell) return;
        cell = k;
        this.spawnStillMissile(sub, ms.x, ms.y, ms, roll);
      };
    }
    if (def.srvDoFunc === 25 && sub) {
      m.trail = undefined;
      m.noCollide = true;
      const range = calc.calc(s, 1, lvl, o), every = calc.calc(s, 2, lvl, o);
      const roll = this.missileDamageRoller(sub, this.skillFor(sub) ?? s, lvl, { srcDam: 0, useSkillDamage: true });
      m.onTick = (ms) => {
        if (every <= 0 || ms.left % every !== 0) return;
        const r = range - 1;
        this.spawnStillMissile(sub, ms.x + this.rng.pick(2 * r + 1) - r, ms.y + this.rng.pick(2 * r + 1) - r, ms, roll);
      };
    }
    if (def.srvDoFunc === 27) {
      const every = (def.params[0] ?? 0) > 0 ? (def.params[0] ?? 1) : Math.max(calc.calc(s, 4, lvl, o), 1);
      const radius = (def.params[1] ?? 0) > 0 ? (def.params[1] ?? 1) : Math.max(calc.eval(s, s.auraRangeCalc, lvl, o), 1);
      m.rehit = new Map();
      m.onTick = (ms) => {
        if (ms.left % every !== 0 || !ms.roll) return;
        for (const t of this.monstersNear(ms.x, ms.y, radius)) this.damageMonster(t, ms.roll(), 'player');
      };
    }
    if (def.nextHit && !m.rehit) m.rehit = new Map();
    if (def.srvHitFunc === 48) {
      const boulder = def.hitSubMissile1 ? data.missiles.get(def.hitSubMissile1) : undefined;
      m.noCollide = true;
      m.onEnd = (ms) => {
        if (!boulder) return;
        const sp = Math.hypot(ms.dx, ms.dy) || 1;
        this.spawnPlayerMissile(boulder, s, lvl, ms.x + (ms.dx / sp) * 50, ms.y + (ms.dy / sp) * 50, undefined, { srcDam: 0, useSkillDamage: true, from: { x: ms.x, y: ms.y } });
      };
    }
    if (def.srvDoFunc === 26 && sub) {
      // plague vines: 남은 프레임이 Param1 의 배수일 때 자취 (MISSMODE_SrvDo26_Vines_PlagueVines)
      m.trail = undefined;
      m.noCollide = true;
      const every = Math.max(def.params[0] ?? 1, 1);
      const trailSkill = this.skillFor(sub) ?? s;
      const roll = this.missileDamageRoller(sub, trailSkill, lvl, { srcDam: 0, useSkillDamage: true });
      m.onTick = (ms) => {
        if (ms.left % every === 0) this.spawnStillMissile(sub, ms.x, ms.y, ms, roll);
      };
    }
    if (def.srvHitFunc === 50) {
      // 덩굴 자취는 생긴 뒤 sHitPar1 프레임 동안만 맞힌다 (MISSMODE_SrvHit50_PlagueVinesTrail)
      m.onTick = (ms) => {
        if (ms.age > (def.hitParams[0] ?? 0)) ms.noCollide = true;
      };
    }
    if (def.srvDoFunc === 28 && sub) {
      // Volcano: 남은 프레임이 (Param3, Param4) 사이에서 calc4(Param1) 프레임마다 반경 aurarange(Param2) 무작위 지점으로 돌덩이 (MISSMODE_SrvDo28_Volcano)
      m.trail = undefined;
      const every = (def.params[0] ?? 0) > 0 ? (def.params[0] ?? 1) : Math.max(calc.calc(s, 4, lvl, o), 1);
      const radius = (def.params[1] ?? 0) > 0 ? (def.params[1] ?? 1) : Math.max(calc.eval(s, s.auraRangeCalc, lvl, o), 1);
      m.onTick = (ms) => {
        if (ms.left <= (def.params[2] ?? 0) || ms.left >= (def.params[3] ?? 0) || ms.left % every !== 0) return;
        const tx = ms.x + this.rng.pick(2 * radius + 1) - radius, ty = ms.y + this.rng.pick(2 * radius + 1) - radius;
        const rock = this.spawnPlayerMissile(sub, s, lvl, tx, ty, undefined, { srcDam: 0, useSkillDamage: true, from: { x: ms.x, y: ms.y } });
        if (rock) rock.left = Math.max(1, Math.round(Math.hypot(tx - ms.x, ty - ms.y) / (Math.hypot(rock.dx, rock.dy) || 1)));
      };
    }
    if (def.srvHitFunc === 51 || def.srvHitFunc === 56) {
      // Volcano 돌덩이: 떨어진 자리에 작은 불 (HitSubMissile1, 스킬 피해). Armageddon: 반경 sHitPar1 피해 + armageddonfire (자체 피해)
      // 출처: MISSMODE_SrvHit51_VolcanoDebris / MISSMODE_SrvHit56_ArmageddonControl
      const fire = def.hitSubMissile1 ? data.missiles.get(def.hitSubMissile1) : undefined;
      m.noCollide = true;
      m.trail = undefined;
      m.onEnd = (ms) => {
        if (def.srvHitFunc === 56 && ms.roll) {
          const r = (def.hitParams[0] ?? 0) > 0 ? (def.hitParams[0] ?? 1) : Math.max(calc.eval(s, s.auraRangeCalc, lvl, o), 1);
          for (const t of this.monstersNear(ms.x, ms.y, r)) this.damageMonster(t, ms.roll(), 'player');
        }
        if (!fire) return;
        const roll = fire.skill ? this.missileDamageRoller(fire, this.skillFor(fire) ?? s, lvl, { srcDam: 0, useSkillDamage: true }) : this.missileOwnRoller(fire, s, lvl);
        this.spawnStillMissile(fire, ms.x, ms.y, ms, roll);
      };
    }
    if (def.srvHitFunc === 47) {
      m.pass = (t) => !t.type.large;
      if (sub && !sub.skill) m.groundTrail = { def: sub, roll: this.missileOwnRoller(sub, s, lvl) };
      m.trail = undefined;
    }
  }

  /**
   * 드루이드 소환 (Raven Do114 은 자기 자리, 늑대·Fenris·Grizzly·토템 Do119 는 대상 지점): 펫 레벨 = calc2 (최소 1),
   * petmax 는 pettype 별. Raven 은 생명 재생이 없고 공격 횟수 par5 + (lvl−1)·par6 를 다 쓰면 죽는다.
   * 출처: SKILLS_SrvDo114_Raven / SKILLS_SrvDo119_DruidSummon, AITHINK_Fn107_Raven (dwAiParam[0])
   */
  private druidSummon(s: SkillRecord, lvl: number, x: number, y: number): void {
    const calc = this.data?.skillCalc;
    if (!calc || !s.summon) return;
    const level = Math.max(1, calc.calc(s, 2, lvl, this.owner()));
    const extra: Partial<PetInfo> = s.srvDoFunc === 114 ? { shots: lvl > 0 ? (s.params[4] ?? 0) + (lvl - 1) * (s.params[5] ?? 0) : 0 } : {};
    // 덩굴: 소환수 스킬 (Plague Poppy = Vine Attack, Cycle of Life = CorpseCycler, Vines = VineCycler — monstats Skill1 과 같은 것)
    if (s.srvDoFunc === 115) {
      const own = this.data?.skills?.byNameOf(s.sumSkill2 || s.sumSkill1);
      if (own) extra.vine = { skill: own.id, lvl: Math.max(1, calc.eval(s, s.sumSkill2 ? s.sumSk2Calc : s.sumSk1Calc, lvl, this.owner())) };
    }
    const pet = this.summonPet(s, lvl, s.summon, x, y, s.petType, extra, { level });
    if (!pet) return;
    if (s.srvDoFunc === 114) pet.hpRegen = false;
    // 덩굴은 땅에서 솟아난다 (summonArg.nMonMode 8 = S1), vine_beast 상태. 출처: SKILLS_SrvDo115_Vines
    if (s.srvDoFunc === 115) {
      if (s.auraState) pet.states.set(s.auraState, Infinity, {});
      if (pet.type.modes.has('S1')) this.startMonsterMode(pet, 'S1');
    }
  }

  /**
   * Werewolf·Werebear: 같은 states.txt group 의 상태(늑대·곰·Feral Rage·Maul)가 하나라도 있으면 모두 풀고 사람으로 (스킬 지연은 시작 때 걸림),
   * 없으면 aurastate 를 auralencalc 프레임 동안 + aurastat. 출처: SKILLS_SrvDo116_Wearwolf_Wearbear (sub_6FD11C90, sub_6FD11BA0)
   */
  private shapeShift(s: SkillRecord, lvl: number): void {
    const data = this.data, calc = data?.skillCalc, p = this.player;
    if (!calc || !s.auraState) return;
    const group = data?.stateGroups?.get(s.auraState);
    const on = group ? p.states.names().filter((st) => data?.stateGroups?.get(st) === group) : [];
    if (on.length) {
      for (const st of on) p.states.remove(st);
      this.statsDirty = true;
      this.events.push({ type: 'shapeShift', state: null });
      return;
    }
    const o = this.owner();
    const stats: Record<string, number> = {};
    for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
    p.states.set(s.auraState, this.tickCount + calc.eval(s, s.auraLenCalc, lvl, o), stats, { id: s.id, lvl });
    this.statsDirty = true;
    this.events.push({ type: 'shapeShift', state: s.auraState });
  }

  /**
   * Rabies: 근접 명중이면 스킬 독 피해 + 대상에게 rabies (독 길이), 대상에 붙은 rabiesplague 가 Param1 프레임마다 rabiescontagion 을 퍼뜨린다.
   * 옮은 적은 남은 독 길이(10 이상)만큼 같은 독과 rabies 를 받고 다시 퍼뜨린다.
   * 출처: SKILLS_SrvSt57_Rabies / SKILLS_SrvDo121_Rabies, MISSMODE_SrvDo30_RabiesPlague / SrvHit53_RabiesContagion / SrvDmg11_RabiesContagion
   * 근사(원작 미확인): 퍼지는 방향은 무작위
   */
  private rabies(s: SkillRecord, lvl: number, t: MonsterUnit | undefined): void {
    if (!t) return;
    const spec = this.meleeSpecFor(s, lvl);
    if (!this.meleeHit(t, spec)) return;
    const len = Math.max(10, spec.elem?.len ?? 0);
    this.infectRabies(s, lvl, t, this.tickCount + len);
  }

  private infectRabies(s: SkillRecord, lvl: number, t: MonsterUnit, until: number): void {
    const data = this.data;
    if (!data || t.states.has(s.auraTargetState) || t.mode === 'DT' || t.mode === 'DD') return;
    t.states.set(s.auraTargetState, until, {});
    const plague = data.missiles.get(s.srvMissileA);
    const contagion = plague?.subMissile1 ? data.missiles.get(plague.subMissile1) : undefined;
    if (!plague || !contagion) return;
    const every = Math.max(plague.params[0] ?? 1, 1);
    this.missiles.push({
      id: this.nextUnitId++, def: plague, x: t.x, y: t.y, dx: 0, dy: 0, left: until - this.tickCount, age: 0, owner: 'player', ownerId: this.player.id,
      ownerLevel: this.character?.level ?? 1, hitClass: 0, hit: new Set(), lvl, skill: s, noCollide: true,
      onTick: (ms) => {
        if (t.mode === 'DT' || t.mode === 'DD') {
          ms.left = 0;
          return;
        }
        ms.x = t.x;
        ms.y = t.y;
        if (ms.left % every !== 0) return;
        const a = this.rng.pick(64) * (Math.PI / 32);
        const c = this.spawnPlayerMissile(contagion, s, lvl, t.x + Math.cos(a) * 10, t.y + Math.sin(a) * 10, undefined, { srcDam: 0, useSkillDamage: true, from: { x: t.x, y: t.y } });
        if (c) {
          c.hit.add(t.id);
          c.until = until;
        }
      },
    });
  }

  /** Volcano: 목표 지점에 화산 미사일. 출처: SKILLS_SrvDo123_Volcano */
  private volcano(s: SkillRecord, lvl: number, tx: number, ty: number): void {
    const def = this.data?.missiles.get(s.srvMissileA);
    if (!def || !this.map.walkable(Math.floor(tx), Math.floor(ty))) return;
    this.spawnPlayerMissile(def, s, lvl, tx, ty, undefined, { srcDam: 0, useSkillDamage: true, from: { x: tx, y: ty } });
  }

  /**
   * Armageddon·Hurricane: 자신에게 aurastate (지속 auralencalc, 최소 1) — 주기 par4 마다 states.txt srvactivefunc.
   * 출처: SKILLS_SrvDo124_Armageddon_Hurricane (EVENTTYPE_ACTIVESTATE, dwParam[3])
   */
  private startDruidStorm(s: SkillRecord, lvl: number): void {
    const calc = this.data?.skillCalc;
    if (!calc || !s.auraState) return;
    const o = this.owner();
    const stats: Record<string, number> = {};
    for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
    this.player.states.set(s.auraState, this.tickCount + Math.max(1, calc.eval(s, s.auraLenCalc, lvl, o)), stats, { id: s.id, lvl });
    this.druidStorm.set(s.auraState, this.tickCount + (s.params[3] ?? 0));
  }

  /**
   * 폭풍 주기: 145 Hurricane = 반경 aurarange 안 적에게 스킬 물리 + 냉기, 146 Armageddon = 반경 안 무작위 지점(5번 시도)에 armageddoncontrol.
   * 마을(스킬 InTown 아님)에 들어가면 상태가 풀린다. 출처: SKILLS_SrvDo145_Unused / SKILLS_SrvDo146_Unused (states.txt srvactivefunc)
   * 근사(원작 미확인): 떨어지는 바위·잔해 그림(cltmissile)은 대표 미사일 하나를 그린다
   */
  private updateDruidStorms(): void {
    const data = this.data, calc = data?.skillCalc, p = this.player;
    if (!data || !calc) return;
    for (const [state, next] of this.druidStorm) {
      const st = p.states.get(state);
      const s = st?.skill ? this.skillRecord(st.skill.id) : undefined;
      if (!st?.skill || !s) {
        this.druidStorm.delete(state);
        continue;
      }
      if (this.inTown && !s.inTown) {
        p.states.remove(state);
        this.druidStorm.delete(state);
        continue;
      }
      if (this.tickCount < next) continue;
      this.druidStorm.set(state, this.tickCount + Math.max(1, s.params[3] ?? 1));
      if (this.inTown) continue;
      const lvl = st.skill.lvl, o = this.owner();
      const range = calc.eval(s, s.auraRangeCalc, lvl, o);
      if (range <= 0) continue;
      const active = data.stateInfo?.get(state)?.srvActive ?? 0;
      if (active === 145) {
        const min = calc.minPhys256(s, lvl, o), max = calc.maxPhys256(s, lvl, o);
        const swoosh = s.cltMissile?.[0];
        if (swoosh) this.spawnVisual(swoosh, p.x + this.rng.pick(2 * range + 1) - range, p.y + this.rng.pick(2 * range + 1) - range);
        for (const m of this.monstersNear(p.x, p.y, range)) {
          const d = emptyDamage();
          if (max > 0) d.phys += min + this.rng.pick(Math.max(0, max - min));
          const el = this.skillElemental(s, lvl);
          if (el) addElemental(d, el.eType, el.amount, el.len);
          this.damageMonster(m, d, 'player');
        }
      } else if (active === 146) {
        const def = data.missiles.get(s.srvMissileA);
        if (!def) continue;
        for (let k = 0; k < 5; k++) {
          const x = Math.floor(p.x) + this.rng.pick(2 * range + 1) - range + 0.5, y = Math.floor(p.y) + this.rng.pick(2 * range + 1) - range + 0.5;
          if (!this.map.walkable(Math.floor(x), Math.floor(y))) continue;
          this.spawnPlayerMissile(def, s, lvl, x, y, undefined, { srcDam: 0, useSkillDamage: true, from: { x, y } });
          const rock = s.cltMissile?.[1];
          if (rock) this.spawnVisual(rock, x - 10, y - 10, { life: def.range, to: { x, y } });
          break;
        }
      }
    }
  }

  /**
   * Molten Boulder 가 큰 몬스터에 막힘: 반경(sHitPar1, 0 이면 스킬 aurarange) 안 피해 + 운석 자리 18곳(sHitPar2 간격)에 불 자취.
   * 출처: MISSMODE_SrvHit47_MoltenBoulder → MISSMODE_CreateMeteor_MoltenBoulderSubmissiles
   */
  private boulderBurst(ms: Missile): void {
    const s = ms.skill, data = this.data, calc = data?.skillCalc;
    if (!s || !calc || !data || !ms.roll) return;
    const radius = (ms.def.hitParams[0] ?? 0) > 0 ? (ms.def.hitParams[0] ?? 0) : Math.max(calc.eval(s, s.auraRangeCalc, ms.lvl, this.owner()), 1);
    for (const t of this.monstersNear(ms.x, ms.y, radius)) this.damageMonster(t, ms.roll(), 'player');
    const fire = ms.def.hitSubMissile1 ? data.missiles.get(ms.def.hitSubMissile1) : undefined;
    if (!fire) return;
    const roll = this.missileOwnRoller(fire, s, ms.lvl);
    for (let i = 0; i < 18; i += Math.max(ms.def.hitParams[1] ?? 1, 1)) this.spawnGroundFire(fire, ms.x + (METEOR_FIRE_X[i] ?? 0), ms.y + (METEOR_FIRE_Y[i] ?? 0), roll, ms);
  }

  private skillFor(def: MissileDef): SkillRecord | undefined {
    return def.skill ? this.data?.skills?.byNameOf(def.skill) : undefined;
  }

  /**
   * 미사일 피해 굴림 함수.
   * 출처: D2MOO MISSILE_CalculateDamageData — 스킬 연결 미사일은 스킬 물리/원소 피해 + (SrcDam/128) × 무기 피해,
   *       아니면 미사일 자체 Min/MaxDamage + (SrcDamage/128) × 무기 피해 (투척 무기는 minmisdam)
   *       MISSMODE_SrvDmg01 (DmgCalc1 % 만큼 물리 → 원소 변환), SrvDmg02 (Ice Arrow: 냉기 지속 → 빙결), SrvDmg12 (Lightning Bolt: 물리 → 번개)
   */
  private missileDamageRoller(def: MissileDef, s: SkillRecord, lvl: number, o: PlayerMissileOpts): () => DamagePacket {
    const data = this.data as GameData, calc = data.skillCalc, c = this.character as Character;
    const passives = this.passives();
    const w = this.weaponBase();
    const skill = o.useSkillDamage ? s : undefined;
    const own = this.owner();
    return () => {
      const d = emptyDamage();
      d.hitClass = def.hitClass || s.hitClass || 10;
      if (o.srcDam > 0) {
        const dv = this.derived();
        d.phys += rollWeaponDamage({
          weapon: w, thrown: o.thrown, str: this.effStat('str'), dex: this.effStat('dex'), enDmgPct: o.damagePct ?? 0, damagePercent: this.playerStat('damagepercent'),
          weaponRange: dv && w && !o.thrown ? { min: dv.weaponMin + dv.addMin, max: dv.weaponMax + dv.addMax } : undefined,
          itemDamagePct: dv?.offWeaponEdPct ?? 0,
          masteryDmg: masteryBonus(passives, data.items, w, 'dmg', o.thrown), srcDam: o.srcDam,
        }, this.rng);
        // 근사(원작 미확인 아님): 원작은 미사일을 만들 때 한 번 판정 (Missile.cpp:798) — 여기서는 맞을 때 굴림
        if (rollCritical(o.thrown ? masteryBonus(passives, data.items, w, 'crit', true) : 0, this.playerStat('passive_critical_strike'), this.rng, this.derived()?.stat('item_deadlystrike') ?? 0)) {
          d.phys *= 2;
          d.crit = true;
        }
        if (o.srcDam === 128) this.addStatElemental(d);
      }
      if (skill && calc) {
        const min = calc.minPhys256(skill, lvl, own), max = calc.maxPhys256(skill, lvl, own);
        if (max > 0) d.phys += min + this.rng.pick(Math.max(0, max - min));
        const el = this.skillElemental(skill, lvl);
        if (el) addElemental(d, el.eType, el.amount, el.len);
      } else {
        const sh = 2 ** def.hitShift;
        if (def.maxDamage > 0) d.phys += def.minDamage * sh + this.rng.pick(Math.max(0, (def.maxDamage - def.minDamage) * sh));
        if (def.eType && def.eMax > 0) addElemental(d, def.eType, def.eMin * sh + this.rng.pick(Math.max(0, (def.eMax - def.eMin) * sh)), def.eLen);
      }
      const eType = skill?.eType || def.eType;
      if (def.srvDmgFunc === 1 || def.srvDmgFunc === 12) {
        const pct = Math.min(100, evalCalc(def.dmgCalc, { param: (nm) => missileParam(def, nm, lvl), ref: () => 0 }));
        if (pct > 0) {
          const conv = Math.min(Math.trunc((d.phys * pct) / 100), d.phys);
          d.phys -= conv;
          addElemental(d, def.srvDmgFunc === 12 ? 'ltng' : eType, conv, 0);
          if (eType === 'cold' && d.coldLen === 0) d.coldLen = skill && calc ? calc.elemLength(skill, lvl, own) : 0;
        }
      } else if (def.srvDmgFunc === 2) {
        d.freezeLen = Math.trunc((d.coldLen * Math.max(def.dmgParams[0] ?? 0, 0)) / 100);
        d.coldLen = 0;
      } else if (def.srvDmgFunc === 4) {
        // Ice Blast: 냉기 지속시간만큼 빙결. 출처: MISSMODE_SrvDmg04_IceBlast
        d.freezeLen = d.coldLen;
        d.coldLen = 0;
      } else if (def.srvDmgFunc === 9) {
        // Twister: 기절 dParam1 (0 이면 스킬 par2), HitClass 0x60. 출처: MISSMODE_SrvDmg09_Twister
        d.stunLen = (def.dmgParams[0] ?? 0) > 0 ? (def.dmgParams[0] ?? 0) : (s.params[1] ?? 0);
        d.hitClass = 0x60;
      } else if (def.srvDmgFunc === 7) {
        // War Cry: 기절 dParam1 (0 이면 par1 + (lvl−1) × par2), HitClass 0x60. 출처: MISSMODE_SrvDmg07_Warcry_ShockWave
        d.stunLen = (def.dmgParams[0] ?? 0) > 0 ? (def.dmgParams[0] ?? 0) : lvl > 0 ? (s.params[0] ?? 0) + (lvl - 1) * (s.params[1] ?? 0) : 0;
        d.hitClass = 0x60;
      }
      // Freezing Arrow 폭발: 미사일 EType frze → 스킬 냉기 지속을 빙결로 (출처: missiles.txt freezingarrowexp3 EType frze, D2DamageStrc dwFrzLen)
      if (def.eType === 'frze' && d.coldLen > 0) {
        d.freezeLen = d.coldLen;
        d.coldLen = 0;
      }
      return d;
    };
  }

  // ---------------------------------------------------------------- monsters

  /**
   * 모드 전환 + 원작 AI 상태 갱신.
   * 출처: MonsterMode.cpp D2GAME_ModeChange — 중립이 아닌 모드를 벗어날 때 dwAiState = 그 모드 번호 (19 이상이면 −16), AI 속도 인자 초기화
   */
  private setMonMode(m: MonsterUnit, mode: MonMode): void {
    if (m.mode !== 'NU') m.aiState = m.aiState >= 16 ? m.aiState - 16 : MONMODE_INDEX[m.mode];
    m.mode = mode;
    m.modeStart = this.tickCount;
    m.velPct = 0;
  }

  private startMonsterMode(m: MonsterUnit, mode: MonMode, cast?: MonCast): void {
    this.setMonMode(m, mode);
    m.hitDone = true;
    m.cast = cast;
    if (mode === 'NU' || mode === 'DD') m.path = [];
    if (mode === 'NU' || mode === 'WL' || mode === 'RN' || mode === 'DD' || !this.data) return;
    m.path = [];
    const action = mode === 'A1' || mode === 'A2' || mode === 'S1' || mode === 'S2' || mode === 'S3' || mode === 'S4' || mode === 'SC' || mode === 'SQ';
    // 냉기: attackrate / other_animrate 감소 → 애니메이션이 느려진다 (출처: SUNITDMG_ApplyColdState)
    let rate = action ? m.states.stat('attackrate') : m.states.stat('other_animrate');
    // 용병 장비 공격 속도 (item_fasterattackrate). 근사(원작 미확인): 몬스터 IAS 공식 대신 EIAS = 120·IAS/(120+IAS) 를 애니메이션 속도 % 에
    const ias = action && m.id === this.merc?.unitId ? m.states.stat('item_fasterattackrate') : 0;
    if (ias > 0) rate += Math.trunc((120 * ias) / (120 + ias));
    if (cast?.seq) {
      // 몬스터 시퀀스 (monseq.txt): 한 줄 = 한 프레임, SQ 애니메이션 속도로 진행. 근사(원작 미확인): 원작 시퀀스 프레임 진행 세부
      const r = this.data.anim.get(`${m.type.code}SQ${m.type.baseW}`) ?? this.data.anim.get(`${m.type.code}${cast.seq[0]?.mode ?? 'A1'}${m.type.baseW}`);
      const speed = Math.max(1, ((r?.speed ?? 256) * (100 + rate)) / 100);
      m.seqRate = speed;
      m.modeEnd = this.tickCount + Math.max(1, Math.ceil((cast.seq.length * 256) / speed));
      cast.events = [];
      cast.seq.forEach((f, i) => {
        if (f.event) cast.events.push(Math.floor((i * 256) / speed));
      });
      if (!cast.events.length) cast.events.push(Math.max(0, m.modeEnd - this.tickCount - 1));
      m.hitTick = cast.events[0] ?? 0;
    } else {
      const t = modeTiming(this.data.anim, m.type.code, mode, m.type.baseW, 100 + rate);
      m.modeEnd = this.tickCount + t.duration;
      m.hitTick = t.hitTick >= 0 ? t.hitTick : Math.trunc(t.duration / 2);
      if (cast) cast.events = [m.hitTick];
    }
    // Phase 5: S1·SC 모드도 그 모드의 미사일이 있으면 판정 (Council Member S1 highpriestlightning, Gloam SC willowisplightningbolt)
    m.hitDone = !(mode === 'A1' || mode === 'A2' || cast || (mode === 'S1' && !!m.type.missS1) || (mode === 'SC' && !!m.type.missC));
    if (action) {
      const t = cast && cast.targetId === undefined ? { x: cast.tx, y: cast.ty } : this.targetOf(m);
      if (t.x !== m.x || t.y !== m.y) m.dir = dir64(t.x - m.x, t.y - m.y);
    }
  }

  /** 날아다니는 몬스터 (monstats flying): 벽(0x01)이 아니라 미사일 벽·문만 막힌다. 출처: D2Collision.h COLLIDE_MASK_FLYING_UNIT */
  private flyMap(): WalkMap {
    const map = this.map;
    return { width: map.width, height: map.height, walkable: (x, y) => map.inBounds(x, y) && !(map.mask(x, y) & (0x04 | 0x0800 | 0x0020)) };
  }

  /**
   * 몬스터 이동 (걷기/달리기). steps = 원작 PATH_SetStepNum (곧은 구간 수), 한 번에 최대 20 서브타일 (PATH_SetDistance(20)).
   * 속도 = (RN 모드면 Run, 아니면 Velocity) × (100 + AI 속도% + velocitypercent) / 100.
   * 출처: MonsterMode.cpp D2GAME_ModeChange (AI 인자 nVelocity → STAT_VELOCITYPERCENT), MONSTERMODE_GetModeChangeInfo
   */
  private monsterMoveTo(m: MonsterUnit, x: number, y: number, run: boolean, steps?: number): boolean {
    const map = m.type.flying ? this.flyMap() : this.map;
    const t = nearestWalkable(map, { x, y }, 4);
    let path = t ? findPath(map, m, { x: t.x + 0.5, y: t.y + 0.5 }, 3000) : null;
    if (!path || path.length === 0) return false;
    if (steps) path = firstSegments(path, steps);
    if (path.length > 20) path = path.slice(0, 20);
    const vel = m.velPct;
    const hasRun = m.type.modes.has('RN');
    const mode: MonMode = run && hasRun ? 'RN' : 'WL';
    if (!m.type.modes.has(mode)) return false;
    if (m.mode !== mode) this.setMonMode(m, mode);
    m.cast = undefined;
    m.path = path;
    m.moveVelPct = vel;
    const base = mode === 'RN' ? m.type.run : m.type.velocity;
    m.moveSpeed = Math.max(0, (base * (100 + vel + (m.bonus.velocitypercent ?? 0))) / 100);
    return true;
  }

  /** 미사일 벽(COLLIDE_MISSILE_BARRIER 0x04) 에 막히지 않는 직선인가 (서브타일 브레젠험). 근사(원작 미확인): 원작 D2Common_11025 경로 검사 */
  private lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    let x0 = Math.floor(ax), y0 = Math.floor(ay);
    const x1 = Math.floor(bx), y1 = Math.floor(by);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 200; i++) {
      if (this.map.mask(x0, y0) & 0x04) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return true;
  }

  /** 원작 sub_6FCF2CC0: 미사일로 쏠 수 있는 가장 가까운 대상 (플레이어·소환수, 거리 48 이내) */
  private monsterMissileTarget(m: MonsterUnit): { x: number; y: number; dist: number; unitId?: number } | null {
    const p = this.player;
    let best: { x: number; y: number; dist: number; unitId?: number } | null = null;
    const consider = (x: number, y: number, unitId?: number) => {
      const d = aiDistance(m.x, m.y, x, y);
      if (d > 48 || (best && d >= best.dist) || !this.lineOfSight(m.x, m.y, x, y)) return;
      best = { x, y, dist: d, ...(unitId !== undefined ? { unitId } : {}) };
    };
    if (p.mode !== 'DT' && p.mode !== 'DD' && !this.inTown) consider(p.x, p.y);
    for (const pet of this.pets) if (pet.mode !== 'DT' && pet.mode !== 'DD' && pet.pet?.petType !== 'none') consider(pet.x, pet.y, pet.id);
    return best;
  }

  private aiWorld(): AiWorld {
    const p = this.player;
    return {
      frame: this.tickCount,
      target: { x: p.x, y: p.y, size: PLAYER_SIZE, dead: p.mode === 'DT' || p.mode === 'DD', inTown: this.inTown },
      levelId: this.level.def.id,
      difficulty: this.difficulty,
      monsters: this.monsters,
      startMode: (m, mode) => this.startMonsterMode(m, mode),
      moveTo: (m, x, y, run, steps) => this.monsterMoveTo(m, x, y, run, steps),
      useSkill: (m, slot, t) => this.monsterUseSkill(m, slot, t),
      missileTarget: (m) => this.monsterMissileTarget(m),
      lifePct: (m) => Math.trunc((100 * Math.max(0, m.hp)) / Math.max(1, m.stats.maxHp)),
      targetLifePct: () => {
        const c = this.character;
        return c ? Math.trunc((100 * c.life) / Math.max(1, this.maxLife())) : 100;
      },
      canUseSkill: (m, slot, t) => this.monsterCanUseSkill(m, slot, t),
      dieQuietly: (m) => {
        m.noXp = true;
        m.noTc = true;
        this.killMonster(m, 'other');
      },
      // ---- Phase 5 (Act 2~4 AI 요청) ----
      levelNo: this.level.def.levelNo ?? 0,
      moveMode: (m, x, y, mode) => this.monsterMoveMode(m, x, y, mode),
      modeOnly: (m, mode) => this.startMonsterMode(m, mode),
      targetInfo: () => this.monTargetInfo(),
      missileBlocked: (m) => {
        const t = this.targetOf(m);
        return !this.lineOfSight(m.x, m.y, t.x, t.y);
      },
      spawn: (owner, typeId, x, y, mode) => this.spawnMonMinion(owner, typeId, x, y, mode),
      canSpawnAt: (typeId, x, y) => {
        const t = this.data?.monsters.types.get(typeId);
        if (!t) return false;
        const map = t.flying ? this.flyMap() : this.map;
        return map.walkable(Math.floor(x), Math.floor(y)) && !this.blockedByUnit({}, Math.floor(x) + 0.5, Math.floor(y) + 0.5, t.sizeX);
      },
      questState: (q, f) => this.questRecord.get(q, f),
      unit: (id) => this.monsters.find((o) => o.id === id) ?? this.pets.find((o) => o.id === id),
      event: (e) => this.events.push(e),
      missileRange: (name) => this.data?.missiles.get(name)?.range ?? 0,
      skillLevel: (m, slot) => this.monSkillLvl(m, slot),
      levelVars: this.levelAiVarsOf(this.level.def.id),
      // ---- 확장팩 Act 5 ----
      useNamedSkill: (m, skill, mode, t) => this.monsterUseNamedSkill(m, skill, mode, t),
      monsterParam: (id, i) => this.data?.monsters.types.get(id)?.aiParams[i] ?? 0,
      skillParam: (skill, i) => this.data?.skills?.byNameOf(skill)?.params[i] ?? 0,
      levelPool: () => this.level.def.monsterInfo?.pool ?? [],
      isGenericSpawn: (id) => !!this.data?.monsters.types.get(id)?.genericSpawn,
      ancientsActive: () => this.act5Quests()?.ancientsActivatable() ?? true,
      targetUnit: () => ({
        cursed: CURSE_STATES.some((c) => this.player.states.has(c)),
        player: true,
        lifeOverMana: this.maxLife() > this.maxMana(),
        neutral: p.mode === 'NU',
      }),
    };
  }

  /**
   * monstats 칸에 없는 스킬 (원작 AITACTICS_UseSkill(pGame, pUnit, nMode, nSkillId, …) — Catapult Spotter 의 다섯 투석기 스킬·Baal Taunt·Impregnate).
   * 스킬 레벨: 같은 스킬이 칸에 있으면 그 레벨, 아니면 1 (+ 난이도 MonsterSkillBonus).
   * 근사(원작 미확인): 그 모드 애니메이션이 없는 몬스터는 A1 → S1 → NU 중 있는 것
   */
  private monsterUseNamedSkill(m: MonsterUnit, skill: string, mode: string, t: SkillTarget | null): boolean {
    if (!this.data?.skills?.byNameOf(skill)) return false;
    const slot = m.type.skills.findIndex((d) => d?.name === skill);
    const lvl = (slot >= 0 ? Math.max(1, m.type.skills[slot]?.lvl ?? 1) : 1) + this.rules.monsterSkillBonus;
    const want = (mode in MONMODE_INDEX ? mode : 'A1') as MonMode;
    const use = ([want, 'A1', 'S1', 'NU'] as MonMode[]).find((x) => m.type.modes.has(x)) ?? 'NU';
    const cast = this.makeCast(m, slot >= 0 ? slot : -1, skill, lvl, t ?? { unitId: m.targetId, ...this.targetOf(m) }, undefined);
    this.startMonsterMode(m, use, cast);
    this.monSkillStart(m, cast);
    this.events.push({ type: 'monsterSkill', monsterId: m.id, skill });
    return true;
  }

  /** 레벨별 AI 공용 값 (원작 D2MonsterRegionStrc) */
  private readonly levelAiVars = new Map<string, Record<string, number>>();
  private levelAiVarsOf(id: string): Record<string, number> {
    let v = this.levelAiVars.get(id);
    if (!v) {
      v = {};
      this.levelAiVars.set(id, v);
    }
    return v;
  }

  private expireStates(): void {
    this.player.states.expire(this.tickCount);
    for (const m of this.monsters) if (m.states.expire(this.tickCount).includes('conversion')) this.unconvert(m);
    for (const m of this.pets) m.states.expire(this.tickCount);
  }

  private updateMonsters(): void {
    const w = this.aiWorld();
    this.updateChaos();
    this.updateAttached();
    for (const m of [...this.monsters]) {
      if (m.mode === 'DD') {
        // Prowling Dead 시체가 일어난다 (Self-resurrect — SrvSt61: SKILLS_ResurrectUnit)
        if (m.riseAt !== undefined && this.tickCount >= m.riseAt) {
          m.riseAt = undefined;
          this.resurrectMonster(m);
        }
        continue;
      }
      if (m.mode === 'DT') {
        if (this.tickCount >= m.modeEnd) {
          this.setMonMode(m, 'DD');
          m.cast = undefined;
          this.monEndDeath(m);
        }
        continue;
      }
      // ---- Phase 5: 만료되는 소환 유닛 (Hydra·Bone Prison), 몬스터 오라 (Duriel Holy Freeze), 돌진 ----
      if (m.expires !== undefined && this.tickCount > m.expires && !m.pet) {
        w.dieQuietly(m);
        continue;
      }
      this.updateMonsterAuras(m);
      if (m.dash && !m.states.has('freeze') && !m.states.has('stunned')) this.updateMonsterDash(m);
      if (m.pathMode) {
        // 모드 지정 경로 이동 (Vulture S1 비행 — 날고 있으면 유닛 충돌 없이)
        if (m.path.length && !m.states.has('freeze') && !m.states.has('stunned')) {
          const v = ((m.moveSpeed * SUBTILES_PER_YARD) / ENGINE_FPS) * (100 + m.states.stat('velocitypercent')) / 100;
          if (m.hidden) {
            let budget = v;
            while (budget > 0 && m.path.length) {
              const nx = m.path[0] as Pt, dx = nx.x - m.x, dy = nx.y - m.y, d = Math.hypot(dx, dy);
              if (d > 1e-9) m.dir = dir64(dx, dy);
              if (d <= budget) {
                m.x = nx.x;
                m.y = nx.y;
                budget -= d;
                m.path.shift();
              } else {
                m.x += (dx / d) * budget;
                m.y += (dy / d) * budget;
                budget = 0;
              }
            }
          } else this.advance(m, v, (d) => (m.dir = d), m.type.sizeX);
          continue;
        }
        m.pathMode = false;
        m.path = [];
        this.setMonMode(m, 'NU');
      }
      // 빙결·기절: 행동 정지 (진행 중 모드의 종료 시점도 함께 미룬다)
      if (m.states.has('freeze') || m.states.has('stunned')) {
        m.modeEnd++;
        m.nextThink = Math.max(m.nextThink, this.tickCount + 1);
        if (m.mode === 'WL' || m.mode === 'RN') {
          m.path = [];
          this.setMonMode(m, 'NU');
        }
        continue;
      }
      if (m.mode !== 'NU' && m.mode !== 'WL' && m.mode !== 'RN') {
        if (m.cast) this.updateMonsterCast(m);
        else if (!m.hitDone && this.tickCount - m.modeStart >= m.hitTick) {
          m.hitDone = true;
          this.resolveMonsterAttack(m);
        }
        if (this.tickCount < m.modeEnd || (m.mode as MonMode) === 'DT' || (m.mode as MonMode) === 'DD') continue;
        this.setMonMode(m, 'NU');
        m.cast = undefined;
        m.dash = undefined;
        // 출처: AITHINK_Fn027_ThornHulk — AITACTICS_Idle(ENDANIM + aip5 − 현재): 모드가 끝난 뒤 nextAfterMode 프레임
        m.nextThink = this.tickCount + (m.nextAfterMode ?? m.type.aiDelay);
        m.nextAfterMode = undefined;
        // 출처: MonsterMode.cpp (nSplEndGeneric) — Bat Demon S3·S4, Frog Demon SQ, Trapped Soul 은 모드가 끝나면 바로 AI 를 부른다
        if (m.type.splEndGeneric && this.splEndNow(m)) m.nextThink = this.tickCount;
      }
      if (m.mode === 'WL' || m.mode === 'RN') {
        if (m.path.length) {
          const v = ((m.moveSpeed * SUBTILES_PER_YARD) / ENGINE_FPS) * (100 + m.states.stat('velocitypercent')) / 100;
          this.advance(m, v, (d) => (m.dir = d), m.type.sizeX);
          if (m.states.has('spiderlay') && this.tickCount % 8 === 0) this.dropSpiderGoo(m);
          continue;
        }
        this.setMonMode(m, 'NU');
        m.nextThink = this.tickCount + m.type.aiDelay;
        // 출처: MonsterMode.cpp (nSplEndGeneric) — Willowisp 는 걷기가 끝나면 바로 AI
        if (m.type.splEndGeneric && m.type.baseId === 'willowisp1') m.nextThink = this.tickCount;
      }
      if (this.tickCount >= m.nextThink && hasAi(aiName(m))) {
        w.frame = this.tickCount;
        this.chooseMonsterTarget(m, w);
        if (m.states.has('terror')) this.thinkTerror(w, m);
        else if (m.states.has('taunt')) this.thinkTaunt(w, m);
        else if (!this.aiPreThink(w, m)) think(w, m);
        // 판단이 아무 행동도 정하지 않았으면 aidel 뒤 다시 (원작: AI 틱 이벤트)
        if (m.nextThink <= this.tickCount && m.mode === 'NU') m.nextThink = this.tickCount + Math.max(1, m.type.aiDelay);
      }
    }
  }

  /**
   * AI 공통 처리 (원작 AI 틱 함수의 AI 함수 호출 전 단계).
   * 출처: AiThink.cpp D2GAME_AICORE_MinionLeash_6FCF0D10 (주인에게서 20 넘게 떨어지면 주인 쪽 거리 19 배회),
   *       sub_6FCF0E40 (유니크·보스는 대상이 20 안에 처음 들어오면 20 프레임 멈춤, 순간이동 수식어: 40% × (생명 30% 미만 또는 원거리·10 미만) × 15%)
   */
  private aiPreThink(w: AiWorld, m: MonsterUnit): boolean {
    if (m.leaderId !== m.id && m.type.modes.has('WL')) {
      const owner = this.monsters.find((o) => o.id === m.leaderId && o.mode !== 'DT' && o.mode !== 'DD');
      if (!owner) m.leaderId = m.id;
      else if (aiDistance(m.x, m.y, owner.x, owner.y) > 20) {
        const [ox, oy] = [owner.x + m.rng.pick(39) - 19, owner.y + m.rng.pick(39) - 19];
        if (this.monsterMoveTo(m, ox, oy, false, 1)) return true;
      }
    }
    const t = w.target;
    if (t.dead || t.inTown) return false;
    const dist = aiDistance(m.x, m.y, t.x, t.y);
    if (((m.flags & MONFLAG.UNIQUE) || m.type.boss) && dist < 20 && t.id === undefined && !m.noticed) {
      m.noticed = true;
      idle(w, m, 20);
      this.events.push({ type: 'monsterNotice', monsterId: m.id });
      return true;
    }
    if (m.umods.includes(UMOD.TELEPORT) && m.rng.pick(100) < 40) {
      const life = Math.trunc((100 * m.hp) / Math.max(1, m.stats.maxHp));
      const melee = m.type.isMelee || m.type.baseId === 'bighead1';
      if ((life >= 30 && (melee || dist >= 10)) || m.rng.pick(100) >= 15) return false;
      const room = this.roomAt(m.x, m.y);
      const spot = room ? this.roomSpot(room, m.type) : null;
      if (!spot) return false;
      if (life < 30 && m.rng.pick(100) < 25) m.hp = Math.min(m.stats.maxHp, m.hp + m.stats.level);
      this.startMonsterMode(m, 'A1', this.makeCast(m, -1, 'MonTeleport', 1, { x: spot.x, y: spot.y }, undefined));
      return true;
    }
    return false;
  }

  private makeCast(m: MonsterUnit, slot: number, skill: string, lvl: number, t: SkillTarget | null, seq: MonSeqFrame[] | undefined): MonCast {
    const tx = t?.x ?? m.x, ty = t?.y ?? m.y;
    return { slot, skill, lvl, tx, ty, fired: 0, events: [], ...(t?.unitId !== undefined ? { targetId: t.unitId } : {}), ...(seq ? { seq } : {}), ...(t?.fixed ? { fixed: true } : {}) };
  }

  /**
   * 원작 AITACTICS_UseSkill / UseSequenceSkill: monstats Skill 칸의 스킬을 Sk*mode 로 (seq_ 이면 SQ 시퀀스).
   * 스킬 레벨 = Sk*lvl + DifficultyLevels MonsterSkillBonus (Normal 0)
   */
  private monsterUseSkill(m: MonsterUnit, slot: number, t: SkillTarget | null): boolean {
    const def = m.type.skills[slot];
    if (!def?.name || !this.data) return false;
    let mode: MonMode, seq: MonSeqFrame[] | undefined;
    if (def.mode.startsWith('seq_')) {
      seq = this.data.monsters.seqs.get(def.mode);
      if (!seq?.length) return false;
      mode = 'SQ';
    } else {
      if (!(def.mode in MONMODE_INDEX)) return false;
      mode = def.mode as MonMode;
    }
    const bonus = this.rules.monsterSkillBonus;
    // 몬스터 Hydra 의 미사일 레벨 = 소환한 스킬 레벨 (Phase 5)
    const cast = this.makeCast(m, slot, def.name, m.summonLvl ?? Math.max(1, def.lvl) + bonus, t ?? { unitId: m.targetId, ...this.targetOf(m) }, seq);
    // Nest(둥지): 시작할 때 스폰 자리를 정한다 (출처: SKILLS_SrvSt49_Nest_EvilHutSpawner → MONSTERS_GetMinionSpawnInfo)
    if (def.name === 'Nest') {
      const sp = this.nestSpawnInfo(m, cast);
      if (!sp) return false;
      cast.tx = sp.x;
      cast.ty = sp.y;
    }
    // AndrialSpray: 시작할 때 대상 좌표 고정 (SKILLS_SrvSt46_AndrialSpray)
    this.startMonsterMode(m, mode, cast);
    this.monSkillStart(m, cast);
    this.events.push({ type: 'monsterSkill', monsterId: m.id, skill: def.name });
    return true;
  }

  /**
   * Phase 5: 스킬 시작 효과 (skills.txt srvstfunc). 출처: SkillMonst.cpp SrvSt43 MaggotEgg · St44 MaggotUp · St45 MaggotDown (대상 가능 여부),
   * St51 Submerge · St52 Emerge, SkillPal.cpp SrvSt31 Charge · SkillMonst.cpp St47 Jump · St54 DiabRun (돌진), St53 MonInferno (분사 초기화)
   */
  private monSkillStart(m: MonsterUnit, cast: MonCast): void {
    switch (cast.skill) {
      case 'MaggotEgg':
      case 'MagottDown':
      case 'Submerge':
        m.hidden = true;
        break;
      case 'MagottUp':
      case 'Emerge':
        m.hidden = false;
        break;
      case 'Charge':
      case 'SerpentCharge':
      case 'DiabRun':
      case 'Leap':
      case 'Leap Attack':
      case 'Whirlwind':
        this.monStartDash(m, cast);
        break;
      case 'FetishInferno':
      case 'MegademonInferno':
      case 'DiabLight':
      case 'Horror Arctic Blast':
        m.stream = undefined;
        break;
      default:
        break;
    }
  }

  /** 출처: MONSTERS_GetMinionSpawnInfo — Crow Nest: 계열 Foul Crow 를 (x, y+3) 에 NU, Blood Raven: zombie2 를 경로 첫 지점(스킬 대상)에 S1 (땅에서 일어남) */
  private nestSpawnInfo(m: MonsterUnit, cast: MonCast): { id: string; x: number; y: number; mode: MonMode } | null {
    const data = this.data;
    if (!data) return null;
    if (m.type.baseId === 'crownest1') {
      const base = data.monsters.types.get('foulcrow1');
      let id = 'foulcrow1';
      const idx = data.monsters.chainIndex(m.type);
      let cur = base;
      for (let i = 0; i < idx && cur?.nextInClass; i++) {
        cur = data.monsters.types.get(cur.nextInClass);
        if (cur) id = cur.id;
      }
      const spot = nearestWalkable(this.flyMap(), { x: m.x, y: m.y + 3 }, 3);
      return spot ? { id, x: spot.x + 0.5, y: spot.y + 0.5, mode: 'NU' } : null;
    }
    // ---- Phase 5 ---- 출처: MONSTERS_GetMinionSpawnInfo — Sarcophagus: 레벨 계열 Mummy (D2Common_11063) 를 (x, y+2) 에 NU,
    // Mosquito Nest(suckernest): 계열 Mosquito 를 (x−2, y−2) 에 NU, Vile Mother: 계열 Vile Child 를 스킬 대상 지점에 NU
    // 확장팩: Evil Hut (Generic Spawner) — AI 가 고른 몬스터를 (x+2, y+4) 에 (MonsterSpawn.cpp MONSTER_EVILHUT)
    if (m.type.baseId === 'evilhut' && m.spawnType && data.monsters.types.has(m.spawnType)) {
      const spot = nearestWalkable(this.map, { x: m.x + 2, y: m.y + 4 }, 2);
      return spot ? { id: m.spawnType, x: spot.x + 0.5, y: spot.y + 0.5, mode: 'NU' } : null;
    }
    if (m.type.baseId === 'sarcophagus' || m.type.baseId === 'suckernest1') {
      const info = this.level.def.monsterInfo;
      let id = m.type.spawn || 'mummy1';
      if (m.type.baseId === 'sarcophagus') id = data.monsters.forLevel('mummy1', info?.pool ?? [], info?.monLvlEx ?? 0);
      const dx = m.type.baseId === 'sarcophagus' ? 0 : -2, dy = m.type.baseId === 'sarcophagus' ? 2 : -2;
      const t = data.monsters.types.get(id);
      const spot = t ? nearestWalkable(t.flying ? this.flyMap() : this.map, { x: m.x + dx, y: m.y + dy }, 2) : null;
      return spot ? { id, x: spot.x + 0.5, y: spot.y + 0.5, mode: 'NU' } : null;
    }
    const spot = nearestWalkable(this.map, { x: cast.tx, y: cast.ty }, 4);
    return spot ? { id: m.type.spawn || 'zombie2', x: spot.x + 0.5, y: spot.y + 0.5, mode: (m.type.spawnMode as MonMode) || 'S1' } : null;
  }

  /** 출처: MonsterSpawn.cpp sub_6FC68630 — 스킬 사용 가능 (부활: 대상 자리가 비어 있어야, AndrialSpray: 대상 필요, Nest: 스폰 자리) */
  private monsterCanUseSkill(m: MonsterUnit, slot: number, t: SkillTarget | null): boolean {
    const def = m.type.skills[slot];
    if (!def?.name) return false;
    if (def.name === 'Nest') return !!this.nestSpawnInfo(m, this.makeCast(m, slot, def.name, 1, t, undefined));
    if (def.name === 'Resurrect') {
      const u = t?.unitId !== undefined ? this.monsters.find((o) => o.id === t.unitId) : undefined;
      return !!u && !this.blockedByUnit(u, u.x, u.y, u.type.sizeX);
    }
    if (def.name === 'AndrialSpray') return !!t;
    // ---- Phase 5 ---- 출처: sub_6FC68630
    if (def.name === 'Resurrect2') {
      const u = t?.unitId !== undefined ? this.monsters.find((o) => o.id === t.unitId) : undefined;
      return !!u && !this.blockedByUnit(u, u.x, u.y, u.type.sizeX);
    }
    if (def.name === 'Leap') {
      // srvdofunc 77: 대상 너머 (2 × 대상 − 자신) 자리가 비어 있고 곧게 이어져야
      if (!t || m.mode === 'DT' || m.mode === 'DD') return false;
      const x = 2 * t.x - m.x, y = 2 * t.y - m.y;
      return this.map.walkable(Math.floor(x), Math.floor(y)) && this.clearLine(m.x, m.y, x, y);
    }
    if (def.name === 'Charge' || def.name === 'SerpentCharge' || def.name === 'DiabRun') return !!t && !this.inTown && this.clearLine(m.x, m.y, t.x, t.y);
    if (def.name === 'MonTeleport') return !!t && this.map.walkable(Math.floor(t.x), Math.floor(t.y)) && !this.blockedByUnit(m, Math.floor(t.x) + 0.5, Math.floor(t.y) + 0.5, m.type.sizeX);
    if (def.name === 'DesertTurret') return !!t && this.lineOfSight(m.x, m.y, t.x, t.y);
    if (def.name === 'DiabPrison') {
      // sub_6FC6A810(…, 검사만): 대상 둘레에 이미 감옥이 없고 자리가 있어야. 근사(원작 미확인): 반경 3 안 뼈 감옥이 없으면 가능
      return !!t && !this.monsters.some((o) => o.type.baseId === 'boneprison1' && o.mode !== 'DT' && o.mode !== 'DD' && Math.hypot(o.x - t.x, o.y - t.y) < 3);
    }
    return true;
  }

  /** 진행 중인 스킬의 판정 이벤트 (시퀀스 이벤트 프레임 또는 모드 판정 프레임) */
  private updateMonsterCast(m: MonsterUnit): void {
    const cast = m.cast;
    if (!cast) return;
    // 경과 시간은 매번 다시 (분사·빨기 스킬이 이벤트를 되풀이하며 modeStart 를 옮긴다 — Phase 5)
    while (cast.fired < cast.events.length && this.tickCount - m.modeStart >= (cast.events[cast.fired] ?? 0)) {
      this.monsterSkillEvent(m, cast, cast.fired);
      cast.fired++;
      if (m.cast !== cast) return;
    }
  }

  /** 시퀀스(SQ) 모드에서 지금 그릴 모드·프레임 (렌더용) */
  private monsterSeqAnim(m: MonsterUnit): { mode: string; frame: number } | undefined {
    const seq = m.mode === 'SQ' ? m.cast?.seq : undefined;
    if (!seq?.length) return undefined;
    const i = Math.min(seq.length - 1, Math.floor(((this.tickCount - m.modeStart) * (m.seqRate ?? 256)) / 256));
    const f = seq[i] as MonSeqFrame;
    return { mode: f.mode, frame: f.frame };
  }

  /**
   * 몬스터 스킬 효과 (skills.txt srvdofunc).
   * 출처: SkillMonst.cpp SKILLS_SrvDo085_UnholyBolt_ShamanFire (미사일 = srvmissilea + 계열 순번), SrvDo088_AndrialSpray (방향·프레임 오프셋 표),
   *       SrvDo091_Nest (소환, 경험치·드롭 없음), SrvDo092_QuickStrike (raven1), SrvDo093_GargoyleTrap, SrvDo097_Resurrect (생명 가득, NOTC|NOXP),
   *       SrvDo098_MonTeleport; SkillSor.cpp SrvDo023 (SpiderLay: 상태), SrvDo024 (불벽 생성기)
   */
  private monsterSkillEvent(m: MonsterUnit, cast: MonCast, index: number): void {
    const data = this.data;
    if (!data) return;
    // Phase 5: Act 2~4 몬스터 스킬 (monSkillEventEx) 이 먼저
    if (this.monSkillEventEx(m, cast, index)) return;
    const rec = data.skills?.byNameOf(cast.skill);
    const target = cast.targetId !== undefined ? this.pets.find((x) => x.id === cast.targetId) ?? this.monsters.find((x) => x.id === cast.targetId) : undefined;
    const tx = target ? target.x : cast.targetId === undefined && !cast.fixed && cast.skill !== 'Nest' && cast.slot >= 0 && !['Resurrect'].includes(cast.skill) ? this.targetOf(m).x : cast.tx;
    const ty = target ? target.y : cast.targetId === undefined && !cast.fixed && cast.skill !== 'Nest' && cast.slot >= 0 && !['Resurrect'].includes(cast.skill) ? this.targetOf(m).y : cast.ty;
    switch (cast.skill) {
      case 'Resurrect': {
        const t = this.monsters.find((o) => o.id === cast.targetId);
        if (t && t.mode === 'DD') this.resurrectMonster(t);
        return;
      }
      case 'ShamanFire': {
        const base = data.missiles.get(rec?.srvMissileA ?? 'shafire1');
        const name = base ? [...data.missiles.values()].find((d) => d.id === base.id + data.monsters.chainIndex(m.type))?.name ?? base.name : 'shafire1';
        this.launchMonsterMissile(m, name, tx, ty, { lvl: cast.lvl, mode: 'A1' });
        return;
      }
      case 'AndrialSpray': {
        // 근사(원작 미확인): 원작 방향별 오프셋 표 대신 이벤트 순번에 따라 −40°~+40° 부채꼴
        const a = Math.atan2(cast.ty - m.y, cast.tx - m.x) + ((index - 4) * Math.PI) / 22;
        const d = Math.max(4, Math.hypot(cast.tx - m.x, cast.ty - m.y));
        this.launchMonsterMissile(m, rec?.srvMissileA || 'andarielspray', m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, { lvl: cast.lvl, mode: 'SQ' });
        return;
      }
      case 'Nest': {
        const sp = this.nestSpawnInfo(m, cast);
        if (!sp || !data.monsters.types.has(sp.id)) return;
        const s = this.spawnMonster(sp.id, sp.x, sp.y, m.type.baseId === 'crownest1' ? undefined : m.id);
        s.noXp = true;
        s.noTc = true;
        if (sp.mode !== 'NU' && s.type.modes.has(sp.mode)) this.startMonsterMode(s, sp.mode);
        return;
      }
      case 'Quick Strike':
        this.launchMonsterMissile(m, rec?.srvMissileA || 'raven1', tx, ty, { lvl: cast.lvl, mode: 'A1' });
        return;
      case 'GargoyleTrap':
        this.launchMonsterMissile(m, rec?.srvMissileA || 'shafire3', tx, ty, { lvl: cast.lvl, mode: 'A1' });
        return;
      case 'SpiderLay': {
        // 근사(원작 미확인): 상태 지속 = skills.txt auralencalc 대신 5초
        m.states.set('spiderlay', this.tickCount + 125);
        return;
      }
      case 'CountessFirewall':
      case 'VampireFirewall':
        this.monsterFirewall(m, rec?.srvMissileA ?? '', rec?.srvMissileB ?? '', cast.tx, cast.ty, cast.lvl);
        return;
      case 'MonTeleport': {
        const spot = nearestWalkable(this.map, { x: cast.tx, y: cast.ty }, 3);
        if (spot) {
          m.x = spot.x + 0.5;
          m.y = spot.y + 0.5;
        }
        return;
      }
      default: {
        // 미사일 스킬 (VampireFireball, AndyPoisonBolt …): skills.txt srvmissile
        const miss = rec?.srvMissile || rec?.srvMissileA;
        if (miss) this.launchMonsterMissile(m, miss, tx, ty, { lvl: cast.lvl, mode: m.mode === 'SQ' ? 'A1' : m.mode });
      }
    }
  }

  // =====================================================================================================
  // Phase 5: Act 2~4 몬스터 스킬·미사일·오라·봉인 (몬스터 전용 블록)
  // 출처: D2MOO D2Game/src/SKILLS/SkillMonst.cpp (SKILLS_SrvSt4x / SrvDo083~112·148·152), SkillSor.cpp (SrvDo017·022·026·028·144),
  //       SkillNec.cpp (SrvDo010·018·030), SkillPal.cpp (SrvDo067·081·150), SkillAma.cpp (SrvDo007), MissMode.cpp (몬스터 미사일)
  // =====================================================================================================

  /** 몬스터 스킬 칸 실제 레벨 (Sk*lvl + DifficultyLevels MonsterSkillBonus). 출처: SKILLS_GetSkillLevel */
  private monSkillLvl(m: MonsterUnit, slot: number): number {
    const d = m.type.skills[slot];
    return d?.name ? Math.max(1, d.lvl) + this.rules.monsterSkillBonus : 0;
  }

  /** 스킬 공식의 주인 = 몬스터 (스킬 레벨은 monstats 칸, 시너지 없음) */
  private monOwner(m: MonsterUnit): SkillOwner {
    const lvlOf = (id: number) => {
      const rec = this.data?.skills?.byId.get(id);
      const i = rec ? m.type.skills.findIndex((k) => k.name === rec.name) : -1;
      return i >= 0 ? this.monSkillLvl(m, i) : 0;
    };
    return { baseLevel: lvlOf, skillLevel: lvlOf, unitLevel: Math.max(1, m.stats.level) };
  }

  /** 몬스터가 쓴 스킬의 물리·원소 피해 (1/256). 출처: D2GAME_RollPhysicalDamage_6FD14EC0 / RollElementalDamage_6FD14DD0 */
  private monSkillDamage(m: MonsterUnit, s: SkillRecord, lvl: number): DamagePacket {
    const d = emptyDamage();
    const calc = this.data?.skillCalc;
    if (!calc) return d;
    const o = this.monOwner(m);
    const min = calc.minPhys256(s, lvl, o), max = calc.maxPhys256(s, lvl, o);
    if (max > 0) d.phys += min + m.rng.pick(Math.max(0, max - min));
    if (s.eType) {
      const emin = calc.minElem256(s, lvl, o, true), emax = calc.maxElem256(s, lvl, o, true);
      if (emax > 0) addElemental(d, s.eType, emin + m.rng.pick(Math.max(0, emax - emin)), calc.elemLength(s, lvl, o));
    }
    d.hitClass = s.hitClass;
    return d;
  }

  /**
   * 몬스터 미사일 피해: missiles.txt Skill 이 있으면 그 스킬 수치 (Frost Nova·Hydra·Charged Strike …), 없으면 미사일 자체 수치,
   * SrcDamage 가 있으면 모드 공격 피해 × SrcDamage/128 을 더한다. 출처: MISSILE_CalculateDamageData
   */
  private monMissilePacket(m: MonsterUnit, def: MissileDef, lvl: number, mode: MonMode): { pkt: DamagePacket & { manaDrain: number }; min: number; max: number; toHit: number; alwaysHit: boolean } {
    const rec = def.skill ? this.data?.skills?.byNameOf(def.skill) : undefined;
    const own = rec ? this.monSkillDamage(m, rec, lvl) : this.missileOwnDamage(def, lvl);
    const pkt = { ...own, manaDrain: 0 };
    const src = def.srcDamage > 0 ? def.srcDamage : 0;
    let min = 0, max = 0, toHit = 0;
    if (src) {
      const atk = this.monsterAttack(m, mode);
      min = Math.floor((atk.min * src) / 128);
      max = Math.floor((atk.max * src) / 128);
      toHit = atk.toHit;
      for (const k of ['fire', 'ltng', 'cold', 'pois', 'mag'] as const) pkt[k] += Math.trunc((atk.elem[k] * src) / 128);
      pkt.coldLen = Math.max(pkt.coldLen, atk.elem.coldLen);
      pkt.poisLen = Math.max(pkt.poisLen, atk.elem.poisLen);
      pkt.manaDrain = atk.elem.manaDrain;
    }
    pkt.hitClass = def.hitClass || pkt.hitClass;
    return { pkt, min, max, toHit, alwaysHit: !src || !def.toHit };
  }

  /**
   * 몬스터 스킬 미사일 한 발 (from → to). 확장 옵션 (mon): 관통·지속 피해(DamageRate), 유도, 무리(한 번만), 폭발, 적중 효과.
   * 속도 = missileStep(Vel + VelLev × lvl / 8) (원작 MISSILES_CreateMissileFromParams)
   */
  private fireMonMissile(m: MonsterUnit, name: string, from: Pt, to: Pt, o: {
    lvl: number; mode?: MonMode; range?: number; vel?: number; pierce?: boolean; homing?: boolean; wander?: boolean; group?: Set<number>;
    explode?: { radius: number; visual?: string }; onHit?: () => void; onTick?: (ms: Missile) => void; onEnd?: (ms: Missile) => void; noCollide?: boolean; every?: number;
  }): Missile | null {
    const def = this.data?.missiles.get(name);
    if (!def) return null;
    let speed = missileStep(o.vel ?? def.vel + Math.trunc((o.lvl * def.velLev) / 8));
    const slow = m.states.get('slowmissiles');
    if (slow) speed = (speed * (slow.stats.skill_handofathena ?? 100)) / 100;
    const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy) || 1;
    const dmg = this.monMissilePacket(m, def, o.lvl, o.mode ?? 'A1');
    // 지속 피해 (Inferno·DiabLight·Mummy 숨결): DamageRate/1024 만큼 매 프레임. 출처: MISSMODE_SrvDmg (DamageRate)
    if (o.pierce && def.damageRate > 0) {
      for (const k of ['phys', 'fire', 'ltng', 'cold', 'mag'] as const) dmg.pkt[k] = Math.trunc((dmg.pkt[k] * def.damageRate) / 1024);
      dmg.min = Math.trunc((dmg.min * def.damageRate) / 1024);
      dmg.max = Math.trunc((dmg.max * def.damageRate) / 1024);
    }
    const ms: Missile = {
      id: this.nextUnitId++, def, x: from.x, y: from.y, dx: (dx / d) * speed, dy: (dy / d) * speed, left: o.range ?? def.range, age: 0,
      owner: 'monster', ownerId: m.id, ownerLevel: m.stats.level, damage: { min: dmg.min, max: dmg.max }, toHit: dmg.toHit,
      hitClass: def.hitClass || 10, hit: new Set(), lvl: o.lvl, mpkt: dmg.pkt, alwaysHit: dmg.alwaysHit,
      ...(o.wander ? { wander: true } : {}), ...(o.group ? { group: o.group } : {}), ...(o.onTick ? { onTick: o.onTick } : {}), ...(o.onEnd ? { onEnd: o.onEnd } : {}),
      ...(o.noCollide ? { noCollide: true } : {}),
      mon: {
        pierce: !!o.pierce, homing: !!o.homing, every: Math.max(1, o.every ?? (def.nextDelay || (def.damageRate > 0 ? 1 : 1000))), nextHit: 0,
        ...(o.explode ? { explode: o.explode } : {}), ...(o.onHit ? { onHit: o.onHit } : {}),
      },
    };
    this.missiles.push(ms);
    this.events.push({ type: 'monsterMissile', monsterId: m.id, name });
    return ms;
  }

  /** 확장 몬스터 미사일 한 프레임 (fireMonMissile). 반환 true = 소멸 */
  private updateMonMissileEx(ms: Missile, p: PlayerState): boolean {
    const mo = ms.mon;
    if (!mo) return true;
    ms.onTick?.(ms);
    const end = (): boolean => {
      if (mo.explode) {
        if (mo.explode.visual) this.spawnVisual(mo.explode.visual, ms.x, ms.y);
        if (p.mode !== 'DT' && p.mode !== 'DD' && Math.hypot(p.x - ms.x, p.y - ms.y) <= mo.explode.radius && !(ms.group?.has(p.id))) {
          ms.group?.add(p.id);
          this.hitPlayer({ min: 0, max: 0, toHit: 0 }, ms.ownerLevel, ms.hitClass, true, undefined, this.rollMonPacket(ms), true);
        }
      }
      ms.onEnd?.(ms);
      return true;
    };
    if (ms.noCollide) {
      ms.x += ms.dx;
      ms.y += ms.dy;
      return ms.left <= 0 ? end() : false;
    }
    const pAlive = p.mode !== 'DT' && p.mode !== 'DD' && !this.inTown;
    if (mo.homing && pAlive) {
      // 출처: MISSMODE_SrvDo07 (Bone Spirit)·SrvDo11 (Finger Mage 거미) — 대상 쪽으로 방향을 다시 잡는다
      const sp = Math.hypot(ms.dx, ms.dy);
      const d = Math.hypot(p.x - ms.x, p.y - ms.y) || 1;
      ms.dx = ((p.x - ms.x) / d) * sp;
      ms.dy = ((p.y - ms.y) / d) * sp;
    }
    if (ms.wander && ms.age % 3 === 0) {
      const sp = Math.hypot(ms.dx, ms.dy);
      const a = Math.atan2(ms.dy, ms.dx) + ((this.rng.pick(5) - 2) * Math.PI) / 8;
      ms.dx = Math.cos(a) * sp;
      ms.dy = Math.sin(a) * sp;
    }
    const size = ms.def.size;
    const steps = Math.max(1, Math.ceil(Math.hypot(ms.dx, ms.dy)));
    for (let k = 0; k < steps; k++) {
      ms.x += ms.dx / steps;
      ms.y += ms.dy / steps;
      if ((this.map.mask(Math.floor(ms.x), Math.floor(ms.y)) & (0x04 | 0x0800 | 0x0020)) !== 0) return end();
      if (pAlive && footprintsOverlap(ms.x, ms.y, size, p.x, p.y, PLAYER_SIZE)) {
        if (ms.group?.has(p.id)) continue;
        if (mo.pierce) {
          if (ms.age < mo.nextHit) continue;
          mo.nextHit = ms.age + mo.every;
          this.hitPlayer({ min: ms.damage?.min ?? 0, max: ms.damage?.max ?? 0, toHit: ms.toHit ?? 0 }, ms.ownerLevel, ms.hitClass, true, undefined, ms.mpkt, ms.alwaysHit);
          mo.onHit?.();
          continue;
        }
        ms.group?.add(p.id);
        this.hitPlayer({ min: ms.damage?.min ?? 0, max: ms.damage?.max ?? 0, toHit: ms.toHit ?? 0 }, ms.ownerLevel, ms.hitClass, true, undefined, ms.mpkt, ms.alwaysHit);
        mo.onHit?.();
        this.chillingArmorReturn(ms);
        return end();
      }
      const pet = this.pets.find((pt) => pt.mode !== 'DT' && pt.mode !== 'DD' && !ms.hit.has(pt.id) && footprintsOverlap(ms.x, ms.y, size, pt.x, pt.y, pt.type.sizeX));
      if (pet) {
        ms.hit.add(pet.id);
        this.damagePet(pet, this.rollMonPacket(ms));
        if (!mo.pierce) return end();
      }
    }
    return ms.left <= 0 ? end() : false;
  }

  private rollMonPacket(ms: Missile): DamagePacket {
    const d = ms.mpkt ? { ...ms.mpkt } : emptyDamage();
    if (ms.damage && ms.damage.max > 0) d.phys += rollDamage(ms.damage, this.rng) * 256;
    return d;
  }

  /** 대상 좌표 (스킬 대상 유닛 → 플레이어) */
  private castTarget(m: MonsterUnit, cast: MonCast): Pt & { unit?: MonsterUnit } {
    const u = cast.targetId !== undefined ? this.pets.find((x) => x.id === cast.targetId) ?? this.monsters.find((x) => x.id === cast.targetId) : undefined;
    if (u) return { x: u.x, y: u.y, unit: u };
    if (cast.targetId === undefined && cast.slot >= 0 && !cast.fixed) return this.targetOf(m);
    return { x: cast.tx, y: cast.ty };
  }

  /** 서브타일 직선이 걸을 수 있는 칸으로만 이어지는가 (원작 D2Common_11025(…, 0xC01) 근사) */
  private clearLine(ax: number, ay: number, bx: number, by: number): boolean {
    let x0 = Math.floor(ax), y0 = Math.floor(ay);
    const x1 = Math.floor(bx), y1 = Math.floor(by);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 200; i++) {
      if (!this.map.walkable(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return true;
  }

  /**
   * 몬스터 근접 스킬 한 방 (Fire Hit·Jab·Smite·MonFrenzy·Charge·DiabRun·Leap).
   * 출처: SKILLS_SrvSt42_FireHit (S1 공격 수치), SrvDo007_Jab (피해 +calc1%), SrvDo150_Smite (피해 +calc1%, 항상 명중, calc2 프레임 기절),
   *       SKILLS_RollMonFrenzyDamage (맞으면 광란 상태), SrvDo067_Charge (피해 +calc1%), SrvDo103_DiabRun (스킬 물리 피해)
   * 반환 = 맞혔는가
   */
  private monMeleeSkill(m: MonsterUnit, cast: MonCast, o: { mode: MonMode; enDmgPct?: number; stun?: number; always?: boolean; skillPhys?: boolean }): boolean {
    const tp = this.castTarget(m, cast);
    const data = this.data, rec = data?.skills?.byNameOf(cast.skill);
    if (tp.unit) {
      if (!isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, tp.unit.x, tp.unit.y, tp.unit.type.sizeX, 1)) return false;
      const atk = this.monsterAttack(m, o.mode);
      const k = 100 + (o.enDmgPct ?? 0);
      this.monsterHitsUnit(m, tp.unit, { min: Math.max(0, Math.trunc((atk.min * k) / 100)), max: Math.max(0, Math.trunc((atk.max * k) / 100)), toHit: atk.toHit });
      return true;
    }
    const p = this.player;
    if (!isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, p.x, p.y, PLAYER_SIZE, 1)) return false;
    const atk = this.monsterAttack(m, o.mode);
    const k = 100 + (o.enDmgPct ?? 0);
    let min = Math.max(0, Math.trunc((atk.min * k) / 100)), max = Math.max(0, Math.trunc((atk.max * k) / 100));
    const elem = { ...atk.elem };
    if (o.skillPhys && rec) {
      const sd = this.monSkillDamage(m, rec, cast.lvl);
      min += Math.trunc(sd.phys / 256);
      max += Math.trunc(sd.phys / 256);
      for (const key of ['fire', 'ltng', 'cold', 'pois', 'mag'] as const) elem[key] += sd[key];
    }
    const life = this.character?.life ?? 0;
    this.onAttackedInMelee(m);
    this.hitPlayer({ min, max, toHit: atk.toHit }, m.stats.level, rec?.hitClass || m.type.hitClass, false, m, elem, !!o.always);
    const hit = (this.character?.life ?? 0) < life || !!o.always;
    if (o.stun && hit && this.character && this.character.life > 0) {
      this.player.states.set('stunned', this.tickCount + Math.min(250, o.stun));
      this.events.push({ type: 'playerStunned', by: m.id, until: this.tickCount + Math.min(250, o.stun) });
    }
    return hit;
  }

  /** 새 몬스터 (스킬·AI 가 부른다): 경험치 없음, 모드 지정 */
  private spawnMonMinion(owner: MonsterUnit, typeId: string, x: number, y: number, mode: MonMode, opts: { noTc?: boolean; leader?: boolean } = {}): MonsterUnit | null {
    const data = this.data;
    if (!data?.monsters.types.has(typeId)) return null;
    const t = data.monsters.get(typeId);
    const spot = this.map.walkable(Math.floor(x), Math.floor(y)) && !this.blockedByUnit({}, Math.floor(x) + 0.5, Math.floor(y) + 0.5, t.sizeX)
      ? { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 } : this.spawnSpot(x, y, 2, t);
    if (!spot) return null;
    const s = this.spawnMonster(typeId, spot.x, spot.y, opts.leader ? owner.id : undefined);
    s.noXp = true;
    if (opts.noTc) s.noTc = true;
    if (mode !== 'NU' && s.type.modes.has(mode)) this.startMonsterMode(s, mode);
    return s;
  }

  /**
   * 투석기 돌 (Catapult Spotter 의 다섯 스킬, SrvDo028: 목표 지점에 위에서 떨어지는 미사일).
   * 출처: missiles.txt — catapultchargedball (Hit 38 → catapultchargedballbolt 번개 조각), catapult spike ball (Hit 40 → spike in air → on ground 불),
   *   catapult cold ball (Hit 1 냉기), catapult plague ball (Hit 2 → catapult plague cloud 독구름), catapult meteor ball (Hit 14 → catapult meteor fire 불길)
   * 근사(원작 미확인): 떨어지는 시간 = 미사일 AnimLen × 4 프레임 (HellMeteor 와 같게), 터짐 반경 3, 번개 조각 수 = skills.txt Param1 (없으면 4)
   */
  private catapultShot(m: MonsterUnit, skill: string, rec: SkillRecord, lvl: number, tx: number, ty: number): void {
    const data = this.data;
    const ball = data?.missiles.get(rec.srvMissileA);
    if (!data || !ball) return;
    const fall = Math.max(8, ball.animLen * 4);
    const at = { x: tx, y: ty };
    const ground = (name: string) => {
      const def = data.missiles.get(name);
      if (!def) return;
      this.missiles.push({
        id: this.nextUnitId++, def, x: Math.floor(tx) + 0.5, y: Math.floor(ty) + 0.5, dx: 0, dy: 0, left: def.range, age: 0, owner: 'monster', ownerId: m.id,
        ownerLevel: m.stats.level, hitClass: def.hitClass || 0x20, hit: new Set(), lvl, mpkt: this.missileOwnDamage(def, lvl), groundFire: true,
      });
    };
    switch (skill) {
      case 'Catapult Charged Ball': {
        const n = Math.max(1, rec.params[0] || 4);
        this.fireMonMissile(m, ball.name, at, at, {
          lvl, noCollide: true, range: fall,
          onEnd: () => {
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2;
              this.fireMonMissile(m, 'catapultchargedballbolt', at, { x: tx + Math.cos(a) * 8, y: ty + Math.sin(a) * 8 }, { lvl, wander: true });
            }
          },
        });
        return;
      }
      case 'Catapult Spike Ball':
        this.fireMonMissile(m, ball.name, at, at, { lvl, noCollide: true, range: fall, onEnd: () => ground('catapult spike on ground') });
        return;
      case 'CatapultBlizzard':
        this.fireMonMissile(m, ball.name, at, at, { lvl, noCollide: true, range: fall, explode: { radius: 3, visual: 'catapult cold explosion' } });
        return;
      case 'CatapultPlague':
        this.fireMonMissile(m, ball.name, at, at, {
          lvl, noCollide: true, range: fall,
          onEnd: () => {
            const cloud = data.missiles.get('catapult plague cloud');
            if (cloud) this.fireMonMissile(m, cloud.name, at, at, { lvl, noCollide: true, pierce: true, every: 25, range: cloud.range });
          },
        });
        return;
      case 'CatapultMeteor':
        this.fireMonMissile(m, ball.name, at, at, { lvl, noCollide: true, range: fall, explode: { radius: 3 }, onEnd: () => ground('catapult meteor fire') });
        return;
    }
  }

  /**
   * 출처: SkillDruid.cpp sub_6FD01010 — 탄 임프가 내린다: 상태 attached 해제·주인 끊기, 생명 10% 미만이면 죽는다. 자리 = 대상 지점 (sub_6FCBDFE0 순간이동)
   */
  private impDetach(m: MonsterUnit, x: number, y: number): void {
    m.states.remove('attached');
    m.leaderId = m.id;
    m.hidden = false;
    m.ai[0] = -1;
    const spot = nearestWalkable(this.map, { x, y }, 6);
    if (spot) {
      m.x = spot.x + 0.5;
      m.y = spot.y + 0.5;
    }
    if (this.lifePctOf(m) < 10) this.killMonster(m, 'other');
  }

  private lifePctOf(m: MonsterUnit): number {
    return Math.trunc((100 * Math.max(0, m.hp)) / Math.max(1, m.stats.maxHp));
  }

  /** 탄 임프는 탈 것 자리를 따라간다 (원작: 주인에 붙은 상태 — 클라이언트가 같이 그린다). 탈 것이 죽으면 내린다 */
  private updateAttached(): void {
    for (const m of this.monsters) {
      if (!m.states.has('attached')) continue;
      const o = this.monsters.find((x) => x.id === m.leaderId);
      if (!o || o.mode === 'DT' || o.mode === 'DD') {
        this.impDetach(m, m.x, m.y);
        continue;
      }
      m.x = o.x;
      m.y = o.y;
    }
  }

  /** 노바 (64 방향, 한 대상은 한 번). 출처: SKILLS_SrvDo022_NovaAttack + sub_6FD14170 */
  private monNova(m: MonsterUnit, name: string, lvl: number, vel?: number): void {
    const group = new Set<number>();
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      this.fireMonMissile(m, name, { x: m.x, y: m.y }, { x: m.x + Math.cos(a) * 30, y: m.y + Math.sin(a) * 30 }, { lvl, group, ...(vel !== undefined ? { vel } : {}) });
    }
  }

  /**
   * Blizzard / MonBlizzard: 목표 지점 중심 미사일이 수명 동안 every 프레임마다 반경 안 무작위 지점에 얼음 조각.
   * 출처: SKILLS_SrvDo028 → MISSMODE_SrvDo08/10 (blizzardcenter / monblizcenter → SubMissile1)
   * 근사(원작 미확인): 조각이 떨어지는 시간 = 조각 미사일 수명, 떨어진 자리에 플레이어가 있으면 한 번 피해
   */
  private monBlizzard(m: MonsterUnit, s: SkillRecord, lvl: number, tx: number, ty: number): void {
    const data = this.data;
    const center = data?.missiles.get(s.srvMissileA), shard = center?.subMissile1 ? data?.missiles.get(center.subMissile1) : undefined;
    if (!center || !shard) return;
    const calc = data?.skillCalc, o = this.monOwner(m);
    const radius = Math.max(1, (s.calcs[0] && calc ? calc.calc(s, 1, lvl, o) : 0) || center.params[0] || 5);
    const every = Math.max(1, (s.calcs[1] && calc ? calc.calc(s, 2, lvl, o) : 0) || center.params[2] || 4);
    const life = center.range + lvl * center.levRange;
    const rec = s;
    this.fireMonMissile(m, center.name, { x: tx, y: ty }, { x: tx, y: ty }, {
      lvl, noCollide: true, range: life,
      onTick: (ms) => {
        if (ms.age % every !== 0) return;
        const a = (this.rng.pick(64) * Math.PI) / 32, r = this.rng.pick(radius * 16) / 16;
        const x = ms.x + Math.cos(a) * r, y = ms.y + Math.sin(a) * r;
        this.fireMonMissile(m, shard.name, { x, y }, { x, y }, {
          lvl, noCollide: true, range: Math.max(1, shard.range),
          onEnd: (sh) => {
            const p = this.player;
            if (p.mode !== 'DT' && p.mode !== 'DD' && footprintsOverlap(sh.x, sh.y, Math.max(2, shard.size), p.x, p.y, PLAYER_SIZE)) {
              const d = this.monSkillDamage(m, rec, lvl);
              d.hitClass = shard.hitClass || 0x30;
              this.hitPlayer({ min: 0, max: 0, toHit: 0 }, m.stats.level, d.hitClass, true, undefined, d, true);
            }
          },
        });
      },
    });
  }

  /**
   * 연속 분사 (Inferno 계열: FetishInferno·MegademonInferno·DiabLight): 판정 이벤트마다 불길 한 줄기, 지속 calc2 프레임 동안 calc3 프레임마다 이벤트를 되풀이.
   * 출처: SKILLS_SrvSt53_MonInferno (param1 = 현재 + calc2, STATE_INFERNO), SrvDo095 / SrvDo152 (속도 Vel + lvl × VelLev / 8,
   *       수명 = calc1 또는 Param2 + lvl − 1, 반복 = MODECHANGE calc3 프레임 뒤, 끝 = ENDANIM InfernoLen)
   */
  private monInferno(m: MonsterUnit, cast: MonCast, index: number, rec: SkillRecord): void {
    const calc = this.data?.skillCalc, def = this.data?.missiles.get(rec.srvMissileA);
    if (!calc || !def) return;
    const o = this.monOwner(m);
    if (!m.stream) {
      m.stream = { until: this.tickCount + Math.max(1, calc.calc(rec, 2, cast.lvl, o)), next: 0, every: Math.max(1, calc.calc(rec, 3, cast.lvl, o)) };
      m.states.set('inferno', Infinity);
    }
    const tp = this.castTarget(m, cast);
    let frames = calc.calc(rec, 1, cast.lvl, o);
    if (frames <= 0) frames = (def.params[1] ?? 0) + cast.lvl - 1;
    frames = Math.min(255, Math.max(1, frames));
    this.fireMonMissile(m, def.name, { x: m.x, y: m.y }, tp, { lvl: cast.lvl, range: frames, pierce: true, mode: m.mode === 'SQ' ? 'A1' : m.mode });
    if (this.tickCount < m.stream.until && m.states.has('inferno')) {
      // 같은 판정 프레임을 every 프레임 뒤에 다시 (애니메이션은 그 프레임 부근에 머문다)
      const t = cast.events[index] ?? 0;
      const every = m.stream.every;
      cast.events.splice(index + 1, 0, t);
      m.modeStart = this.tickCount - t + every;
      m.modeEnd = Math.max(m.modeEnd, this.tickCount + every + 1);
      return;
    }
    m.stream = undefined;
    m.states.remove('inferno');
  }

  /**
   * Act 2~4 몬스터 스킬 효과 (monsterSkillEvent 에서 먼저 부른다). 반환 true = 처리함.
   * 원작 skills.txt srvdofunc 번호별 (주석) — 이 블록이 처리하지 않는 스킬은 기존 처리 (미사일 기본값)로 간다
   */
  private monSkillEventEx(m: MonsterUnit, cast: MonCast, index: number): boolean {
    const data = this.data;
    const rec = data?.skills?.byNameOf(cast.skill);
    const calc = data?.skillCalc;
    if (!data || !rec || !calc) return false;
    const o = this.monOwner(m);
    const lvl = cast.lvl;
    const tp = this.castTarget(m, cast);
    const player = this.player;
    switch (cast.skill) {
      case 'Fire Hit':
        // SrvSt42/SrvDo083: S1 공격 수치 (El S1 불·냉기)
        this.monMeleeSkill(m, cast, { mode: 'S1' });
        return true;
      case 'Jab':
        // SrvDo007: 시퀀스 타격마다 피해 +calc1 % (ln34: par3 + (lvl−1) × par4)
        this.monMeleeSkill(m, cast, { mode: 'A1', enDmgPct: calc.calc(rec, 1, lvl, o) });
        return true;
      case 'Smite':
        // SrvDo150: 피해 +calc1 %, 항상 명중, calc2 프레임 기절 (최대 250)
        this.monMeleeSkill(m, cast, { mode: 'A1', enDmgPct: calc.calc(rec, 1, lvl, o), stun: calc.calc(rec, 2, lvl, o), always: true });
        return true;
      case 'MonFrenzy':
      case 'BloodLordFrenzy': {
        // SrvDo109 → SKILLS_RollMonFrenzyDamage (A2 공격, 피해 +calc2 %), 맞히면 SKILLS_ApplyFrenzyStats (aurastate monfrenzy, auralen ln12, 속도·공속 dm34)
        if (this.monMeleeSkill(m, cast, { mode: 'A2', enDmgPct: calc.calc(rec, 2, lvl, o) })) {
          const stats: Record<string, number> = {};
          for (const a of rec.auraStats) stats[a.stat] = calc.eval(rec, a.calc, lvl, o);
          m.states.set(rec.auraState || 'monfrenzy', this.tickCount + Math.max(1, calc.eval(rec, rec.auraLenCalc, lvl, o)), stats);
        }
        return true;
      }
      case 'Whirlwind':
        // 회전 이동 중 타격은 updateMonsterDash (spin)
        return true;
      case 'Shout': {
        // SrvDo068 (몬스터 Madawc): 자신과 함성 범위 안 같은 편에 aurastate (skill_armor_percent), 지속 auralen
        const def = data.missiles.get(rec.srvMissileA);
        const radius = def ? missileStep(def.vel) * def.range : 6;
        const len = Math.max(1, calc.eval(rec, rec.auraLenCalc, lvl, o));
        const stats: Record<string, number> = {};
        for (const a of rec.auraStats) stats[a.stat] = calc.eval(rec, a.calc, lvl, o);
        for (const x of [m, ...this.monsters.filter((u) => u !== m && !u.pet && u.mode !== 'DT' && u.mode !== 'DD' && Math.hypot(u.x - m.x, u.y - m.y) <= radius)]) {
          x.states.set(rec.auraState || 'shout', this.tickCount + len, stats);
        }
        return true;
      }
      case 'Charge':
      case 'SerpentCharge':
      case 'DiabRun':
      case 'Leap':
      case 'Leap Attack':
        // 돌진 중이면 도착 때 한 번 친다 (updateMonsterDash). 이미 도착했으면 지금
        if (m.dash) return true;
        if (!cast.dashHit) {
          cast.dashHit = true;
          this.monDashStrike(m, cast, rec);
        }
        return true;
      case 'MagottUp':
        // SrvSt44: 땅 위로 (대상 가능)
        m.hidden = false;
        return true;
      case 'MagottDown': {
        // SrvSt45/SrvDo086: 굴 속으로 (대상 불가) + 현재 생명 calc1 % 회복
        m.hidden = true;
        const pct = calc.calc(rec, 1, lvl, o);
        if (pct > 0) m.hp = Math.min(m.stats.maxHp, m.hp + (m.hp * pct) / 100);
        return true;
      }
      case 'MagottLay': {
        // SrvDo087: 대상 반대쪽 (방향 표 [10,8,22,20,18,16,14,12]) 에 알 (monstats spawn), 경험치 없음
        // 근사(원작 미확인): D2Common_11055 방향 오프셋 → 대상 반대쪽 2 서브타일
        const d = Math.hypot(tp.x - m.x, tp.y - m.y) || 1;
        const egg = m.type.spawn;
        if (egg) this.spawnMonMinion(m, egg, m.x - ((tp.x - m.x) / d) * 2, m.y - ((tp.y - m.y) / d) * 2, (m.type.spawnMode as MonMode) || 'NU');
        return true;
      }
      case 'MaggotEgg': {
        // SrvDo084: 새끼 calc1 마리 ((lvl < 5) ? lvl : min(12, 5 + (lvl−5)/3)), 경험치 없음, 알은 죽는다
        const n = Math.max(0, calc.calc(rec, 1, lvl, o));
        const baby = m.type.spawn;
        for (let i = 0; i < n && baby; i++) {
          const a = this.rng.pick(64) * (Math.PI / 32);
          this.spawnMonMinion(m, baby, m.x + Math.cos(a) * (i ? 2 : 0), m.y + Math.sin(a) * (i ? 2 : 0), i ? 'S1' : ((m.type.spawnMode as MonMode) || 'S1'));
        }
        // SUNITDMG_KillMonster(pGame, pUnit, pUnit, 1) — 알은 깨어나며 죽는다 (경험치·드롭 없음)
        m.noXp = true;
        m.noTc = true;
        m.hidden = false;
        this.killMonster(m, 'other');
        return true;
      }
      case 'Submerge':
        // SrvSt51: 물속으로 (대상 불가)
        m.hidden = true;
        return true;
      case 'Emerge':
        // SrvSt52: 물 밖으로
        m.hidden = false;
        return true;
      case 'Mosquito': {
        // SrvSt55/SrvDo107: 근접이면 독(2 × 물리) + 마나·스태미나 흡수, 물리 피해의 calc3 % 만큼 회복. calc1~calc2 번 되풀이
        if (!cast.repeat) cast.repeat = Math.max(1, calc.calc(rec, 1, lvl, o) + this.rng.pick(Math.max(0, calc.calc(rec, 2, lvl, o) - calc.calc(rec, 1, lvl, o))));
        if (!isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, player.x, player.y, PLAYER_SIZE, 1)) return true;
        const min = calc.minPhys256(rec, lvl, o) >> 8, max = calc.maxPhys256(rec, lvl, o) >> 8;
        const d = this.monSkillDamage(m, rec, lvl);
        d.pois = 2 * (min + m.rng.pick(Math.max(0, max - min)));
        d.poisLen = calc.elemLength(rec, lvl, o);
        const mana = (min + m.rng.pick(Math.max(0, max - min))) << 8;
        const stam = (min + m.rng.pick(Math.max(0, max - min))) << 8;
        m.hp = Math.min(m.stats.maxHp, m.hp + ((d.phys / 256) * calc.calc(rec, 3, lvl, o)) / 100);
        this.hitPlayer({ min: 0, max: 0, toHit: 0 }, m.stats.level, rec.hitClass, false, m, { ...d, manaDrain: mana }, true);
        if (this.character) this.character.stamina = Math.max(0, this.character.stamina - stam / 256);
        cast.repeat--;
        if (cast.repeat > 0) {
          const t = cast.events[index] ?? 0;
          cast.events.splice(index + 1, 0, t);
          m.modeStart = this.tickCount - t + 4;
          m.modeEnd = Math.max(m.modeEnd, this.tickCount + 5);
        }
        return true;
      }
      case 'ZakarumHeal':
      case 'Bestow': {
        // SrvDo096: 대상 생명 + (calc1 ~ calc2) % × 최대 생명
        const t = tp.unit;
        if (!t || t.mode === 'DT' || t.mode === 'DD') return true;
        const nMax = Math.min(100, Math.max(0, calc.calc(rec, 2, lvl, o)));
        const nMin = Math.min(nMax, Math.max(0, calc.calc(rec, 1, lvl, o)));
        const pct = m.rng.pick(nMax - nMin) + nMin;
        t.hp = Math.min(t.stats.maxHp, Math.max(1, t.hp + calcPercentage(t.stats.maxHp, pct, 100)));
        this.events.push({ type: 'monsterHealed', monsterId: t.id, by: m.id, pct });
        return true;
      }
      case 'Resurrect2': {
        const t = this.monsters.find((x) => x.id === cast.targetId);
        if (t && t.mode === 'DD' && !t.corpseUsed) this.resurrectMonster(t);
        return true;
      }
      case 'UnHolyBolt': {
        // SrvDo085: 미사일 = srvmissilea + 계열 순번 (unholybolt1~5)
        const base = data.missiles.get(rec.srvMissileA);
        const name = base ? [...data.missiles.values()].find((d) => d.id === base.id + data.monsters.chainIndex(m.type))?.name ?? base.name : '';
        if (name) this.fireMonMissile(m, name, { x: m.x, y: m.y }, tp, { lvl, mode: 'A1' });
        return true;
      }
      case 'FetishInferno':
      case 'MegademonInferno':
      case 'DiabLight':
      case 'Horror Arctic Blast':
        this.monInferno(m, cast, index, rec);
        return true;
      case 'DoomKnightMissile': {
        // SrvDo148: 미사일 = srvmissilea + S3 레이어 변형 순번 (undeadmissile1~4)
        const base = data.missiles.get(rec.srvMissileA);
        const v = m.components?.S3 ?? 0;
        const name = base ? [...data.missiles.values()].find((d) => d.id === base.id + v)?.name ?? base.name : '';
        if (name) this.fireMonMissile(m, name, { x: m.x, y: m.y }, tp, { lvl, mode: 'S1' });
        return true;
      }
      case 'MonBoneArmor': {
        // SrvDo018: 뼈 갑옷 상태 (흡수량 bonearmor = ln12 × 256)
        const stats: Record<string, number> = {};
        for (const a of rec.auraStats) stats[a.stat] = calc.eval(rec, a.calc, lvl, o);
        m.states.set(rec.auraState || 'bonearmor', Infinity, stats);
        return true;
      }
      case 'MonBoneSpirit':
        // SrvDo010: 대상을 따라가는 미사일
        this.fireMonMissile(m, rec.srvMissileA, { x: m.x, y: m.y }, tp, { lvl, homing: true, explode: { radius: 0, visual: data.missiles.get(rec.srvMissileA)?.explosionMissile || '' } });
        return true;
      case 'FingerMageSpider': {
        // SrvDo101 + MISSMODE_SrvHit19: 대상을 따라가는 거미, 맞으면 fingermagecurse (manarecovery −par3 × lvl, 지속 ln12)
        const len = calc.eval(rec, rec.auraLenCalc, lvl, o);
        const stats: Record<string, number> = {};
        for (const a of rec.auraStats) stats[a.stat] = calc.eval(rec, a.calc, lvl, o);
        this.fireMonMissile(m, rec.srvMissileA, { x: m.x, y: m.y }, tp, {
          lvl, homing: true, range: (data.missiles.get(rec.srvMissileA)?.range ?? 80) + Math.max(0, calc.calc(rec, 1, lvl, o)),
          onHit: () => {
            this.player.states.set(rec.auraTargetState || 'fingermagecurse', this.tickCount + Math.max(1, len), stats);
            this.events.push({ type: 'playerCursed', curse: rec.auraTargetState || 'fingermagecurse', by: m.id });
          },
        });
        return true;
      }
      // ---- 확장팩 Act 5 몬스터 스킬 (SkillDruid.cpp SrvDo128~136, SkillSor.cpp SrvDo017·028) ----
      case 'Imp Teleport': {
        // SrvDo129: 탄 채면 대상 자리로 뛰어내림 (sub_6FD01010), 대상이 탈 것(Siege Beast·Barricade Tower)이면 올라탄다 (sub_6FD00EC0), 대상이 없으면 MonTeleport
        const owner = m.states.has('attached') ? this.monsters.find((x) => x.id === m.leaderId) : undefined;
        if (owner) {
          this.impDetach(m, tp.x, tp.y);
          return true;
        }
        const t = tp.unit;
        if (t && !t.pet && t.mode !== 'DT' && t.mode !== 'DD' && ['barricadetower', 'siegebeast1'].includes(t.type.baseId || t.type.id)
          && !this.monsters.some((x) => x !== m && x.leaderId === t.id && x.states.has('attached'))) {
          m.states.set(rec.auraState || 'attached', Infinity);
          m.leaderId = t.id;
          m.hidden = true;
          m.ai[1] = 0;
          m.x = t.x;
          m.y = t.y;
          this.events.push({ type: 'monsterAttached', monsterId: m.id, ownerId: t.id });
          return true;
        }
        if (!t) {
          // Nihlathak: AITACTICS_UseSkillInRange 가 고른 지점 (fixed)
          const spot = nearestWalkable(this.map, cast.fixed ? { x: tp.x, y: tp.y } : { x: m.x + m.rng.pick(9) - 4, y: m.y + m.rng.pick(9) - 4 }, 4);
          if (spot) {
            m.x = spot.x + 0.5;
            m.y = spot.y + 0.5;
          }
        }
        return true;
      }
      case 'ImpBolt': {
        // SrvDo017: calc1 개의 충전 볼트 (PATHTYPE_CHARGEDBOLT)
        const n = Math.max(1, calc.calc(rec, 1, lvl, o));
        const a0 = Math.atan2(tp.y - m.y, tp.x - m.x);
        for (let i = 0; i < n; i++) {
          const a = a0 + ((this.rng.pick(9) - 4) * Math.PI) / 12;
          this.fireMonMissile(m, rec.srvMissileA, { x: m.x, y: m.y }, { x: m.x + Math.cos(a) * 10, y: m.y + Math.sin(a) * 10 }, { lvl, wander: true });
        }
        return true;
      }
      case 'Imp Fire Missile': {
        // SrvDo132: 미사일 = srvmissilea + 계열 순번 (impmiss21 …)
        const b = data.missiles.get(rec.srvMissileA);
        if (!b) return true;
        const name = [...data.missiles.values()].find((d) => d.id === b.id + data.monsters.chainIndex(m.type))?.name ?? b.name;
        this.fireMonMissile(m, name, { x: m.x, y: m.y }, tp, { lvl, explode: { radius: 0, visual: data.missiles.get(name)?.explosionMissile || '' } });
        return true;
      }
      case 'Siege Beast Stomp': {
        // SrvDo134: 자기 둘레 aurarange 안 모두에게 물리·원소 피해 (sub_6FD10200)
        const r = Math.max(1, calc.eval(rec, rec.auraRangeCalc, lvl, o));
        const d = this.monSkillDamage(m, rec, lvl);
        for (const pet of [...this.pets]) if (pet.mode !== 'DT' && pet.mode !== 'DD' && Math.hypot(pet.x - m.x, pet.y - m.y) <= r) this.damagePet(pet, d);
        if (Math.hypot(player.x - m.x, player.y - m.y) <= r) this.hitPlayer({ min: 0, max: 0, toHit: 0 }, m.stats.level, rec.hitClass, false, m, { ...d, manaDrain: 0 }, true);
        return true;
      }
      case 'Catapult Charged Ball':
      case 'Catapult Spike Ball':
      case 'CatapultBlizzard':
      case 'CatapultPlague':
      case 'CatapultMeteor':
        this.catapultShot(m, cast.skill, rec, lvl, cast.tx, cast.ty);
        return true;
      case 'Cry Help': {
        // SrvDo128: 이 몬스터의 하수인에게 AI 명령 (대상 공격, calc1 프레임 동안 — Minion AI 가 따른다)
        const until = this.tickCount + Math.max(1, calc.calc(rec, 1, lvl, o));
        const targetId = tp.unit?.id ?? -1;
        for (const x of this.monsters) {
          if (x === m || x.leaderId !== m.id || x.mode === 'DT' || x.mode === 'DD') continue;
          x.cmdTarget = targetId;
          x.cmdUntil = until;
        }
        return true;
      }
      case 'Healing Vortex': {
        // MISSMODE_SrvHit43_HealingVortex: 맞은 몬스터 생명 += 스킬 물리 피해 (최대 생명까지). 근사(원작 미확인): 미사일 비행 대신 바로
        const t = tp.unit;
        if (t && !t.pet && t.mode !== 'DT' && t.mode !== 'DD') t.hp = Math.min(t.stats.maxHp, t.hp + (this.monSkillDamage(m, rec, lvl).phys >> 8));
        return true;
      }
      case 'NihlathakCorpseExplosion': {
        // SrvDo055 (몬스터): 시체 최대 생명 (MonStats 평균 × 128 = 256 단위 절반) × calc1~calc2 %, 시전자 레벨이 낮으면 비율,
        //   calc3 % 는 원소 (fire), 반경 (aurarange + 1)/2 안의 적 — 물리는 aurarange/2 안만 (sub_6FD0D000)
        const t = this.monsters.find((x) => x.id === cast.targetId);
        if (!t || t.mode !== 'DD' || t.corpseUsed) return true;
        t.corpseUsed = true;
        const hp256 = Math.trunc(((data.monsters.levelBase(t.stats.level, 'HP') * (t.type.minHpPct + t.type.maxHpPct)) / 100 / 2)) * 256;
        const lo = Math.trunc((calc.calc(rec, 1, lvl, o) * hp256) / 100), hi = Math.trunc((calc.calc(rec, 2, lvl, o) * hp256) / 100);
        let dmg = lo + t.rng.pick(Math.max(0, hi - lo));
        if (t.stats.level && m.stats.level < t.stats.level) dmg = Math.trunc((dmg * m.stats.level) / t.stats.level);
        const pct = Math.max(0, Math.min(100, calc.calc(rec, 3, lvl, o)));
        const ar = calc.eval(rec, rec.auraRangeCalc, lvl, o), r = Math.trunc((ar + 1) / 2), half = Math.trunc(ar / 2);
        const d = emptyDamage();
        if (pct > 0 && rec.eType) addElemental(d, rec.eType, Math.trunc((dmg * pct) / 100), calc.elemLength(rec, lvl, o));
        const phys = Math.trunc((dmg * (100 - (pct > 0 && rec.eType ? pct : 0))) / 100);
        const at = (x: number, y: number) => ({ ...d, phys: (x - t.x) ** 2 + (y - t.y) ** 2 > half * half ? 0 : phys });
        for (const pet of [...this.pets]) if (pet.mode !== 'DT' && pet.mode !== 'DD' && Math.hypot(pet.x - t.x, pet.y - t.y) <= r) this.damagePet(pet, at(pet.x, pet.y));
        if (Math.hypot(player.x - t.x, player.y - t.y) <= r) this.hitPlayer({ min: 0, max: 0, toHit: 0 }, m.stats.level, rec.hitClass, false, m, { ...at(player.x, player.y), manaDrain: 0 }, true);
        this.events.push({ type: 'corpseExploded', targetId: t.id });
        return true;
      }
      case 'Overseer Whip': {
        // SrvDo131: minion 계열이면 rand%100 >= calc1 이고 Bloodlust 가 아닐 때 같은 순번의 suicideminion 으로 바꾼다 (SpecialState WHIPPED),
        //   아니면 aurastate 저주 (Bloodlust: auralen 동안 aurastat)
        const t = tp.unit;
        if (!t || t.pet || t.mode === 'DT' || t.mode === 'DD') return true;
        if ((t.type.baseId || t.type.id) === 'minion1' && (m.rng.roll() >>> 0) % 100 >= calc.calc(rec, 1, lvl, o) && !t.states.has(rec.auraTargetState || 'bloodlust')) {
          const idx = data.monsters.chainIndex(t.type);
          let id = rec.summon || 'suicideminion1';
          for (let i = 0; i < idx; i++) id = data.monsters.types.get(id)?.nextInClass || id;
          if (data.monsters.types.has(id)) {
            const hpPct = t.hp / Math.max(1, t.stats.maxHp);
            t.type = data.monsters.get(id);
            t.stats = rollMonsterStats(data.monsters, t.type, t.rng);
            t.hp = Math.max(1, Math.round(t.stats.maxHp * hpPct));
            t.aiOverride = 'Whipped';
            t.ai = [0, 0, 0];
            t.states.set('changeclass', Infinity);
            this.events.push({ type: 'monsterReinitialized', monsterId: t.id, typeId: id });
          }
          return true;
        }
        const stats: Record<string, number> = {};
        for (const a of rec.auraStats) stats[a.stat] = calc.eval(rec, a.calc, lvl, o);
        t.states.set(rec.auraTargetState || 'bloodlust', this.tickCount + Math.max(1, calc.eval(rec, rec.auraLenCalc, lvl, o)), stats);
        return true;
      }
      case 'MinionSpawner': {
        // SrvSt62/SrvDo135: monstats spawn 칸 몬스터를 둘레에 (경험치·드롭 없음, 주인 = 생성기)
        const id = m.type.spawn || 'minion1';
        const s2 = this.spawnMonMinion(m, id, m.x + m.rng.pick(5) - 2, m.y + m.rng.pick(5) - 2, (m.type.spawnMode as MonMode) || 'NU', { noTc: true });
        if (s2) s2.leaderId = m.id;
        return true;
      }
      case 'DeathMaul': {
        // SrvDo136: 땅속으로 대상까지 가는 미사일 (death mauler — 뒤에 흔적), 닿으면 스킬 물리 피해. 근사(원작 미확인): 프레임 맞춤 대신 대상 지점에서 반경 1 터짐
        const def = data.missiles.get(rec.srvMissileA);
        if (def) this.fireMonMissile(m, def.name, { x: m.x, y: m.y }, tp, { lvl, noCollide: true, range: Math.max(4, Math.ceil(Math.hypot(tp.x - m.x, tp.y - m.y) / Math.max(0.1, missileStep(def.vel || 12)))), explode: { radius: 1 } });
        return true;
      }
      case 'Impregnate': {
        // SrvDo133: 같은 편 몬스터에 임신 상태 — 그 몬스터가 죽으면 summon (painworm1) 이 나온다 (sub_6FD01B00)
        const t = tp.unit;
        if (!t || t.pet || t.mode === 'DT' || t.mode === 'DD' || ['putriddefiler1', 'painworm1'].includes(t.type.baseId || t.type.id) || t.states.has('pregnant')) return true;
        t.states.set('pregnant', Infinity);
        t.pregnantWith = rec.summon || 'painworm1';
        return true;
      }
      case 'Baal Taunt': {
        // SrvDo028 → baal taunt control (SubMissile: 번개·독 조종기 → 번개 줄기·독구름). 근사(원작 미확인): 두 조종기 대신 대상에게 번개·독 미사일 하나씩
        for (const name of ['baal taunt lightning', 'baal taunt poison']) {
          const def = data.missiles.get(name);
          if (def) this.fireMonMissile(m, def.name, tp, tp, { lvl, noCollide: true, pierce: true, every: 25, range: def.range });
        }
        this.events.push({ type: 'baalTaunt', monsterId: m.id });
        return true;
      }
      case 'Decrepify':
      case 'Weaken':
      case 'Amplify Damage':
      case 'Defense Curse':
      case 'Blood Mana': {
        // SrvDo030 (몬스터 → 플레이어 저주): aurarange 안이면 auratargetstate + aurastat, 지속 auralen
        const range = calc.eval(rec, rec.auraRangeCalc, lvl, o);
        if (Math.hypot(player.x - tp.x, player.y - tp.y) > Math.max(1, range)) return true;
        const stats: Record<string, number> = {};
        for (const a of rec.auraStats) stats[a.stat] = calc.eval(rec, a.calc, lvl, o);
        for (const c of CURSE_STATES) if (c !== rec.auraTargetState) this.player.states.remove(c);
        this.player.states.set(rec.auraTargetState, this.tickCount + Math.max(1, calc.eval(rec, rec.auraLenCalc, lvl, o)), stats);
        this.events.push({ type: 'playerCursed', curse: rec.auraTargetState, by: m.id });
        return true;
      }
      case 'MonCurseCast': {
        // SrvDo112: 여섯 저주 중 무작위 (Amplify Damage·Weaken·Iron Maiden·Life Tap·Decrepify·Lower Resist)
        const curses = ['amplifydamage', 'weaken', 'ironmaiden', 'lifetap', 'decrepify', 'lowerresist'];
        const idx = (m.rng.roll() >>> 0) % 6;
        const range = calc.eval(rec, rec.auraRangeCalc, lvl, o);
        const len = calc.eval(rec, rec.auraLenCalc, lvl, o);
        if (Math.hypot(player.x - tp.x, player.y - tp.y) > Math.max(1, range)) return true;
        const par7 = rec.params[6] ?? -50;
        const stats: Record<string, number>[] = [
          { damageresist: -100 }, { damagepercent: -50 }, {}, {}, { velocitypercent: par7, damagepercent: -50, damageresist: -50, attackrate: par7 }, {},
        ];
        const st = stats[idx] ?? {};
        if (idx === 5) {
          // 근사(원작 미확인): D2COMMON_11036_GetMonCurseResistanceSubtraction 대신 Lower Resist 스킬의 aurastat 공식
          const lr = data.skills?.byNameOf('Lower Resist');
          const v = lr ? -Math.abs(calc.eval(lr, lr.auraStats[0]?.calc ?? null, lvl, o)) : -25;
          for (const k of ['magicresist', 'fireresist', 'lightresist', 'coldresist', 'poisonresist']) st[k] = v;
        }
        const name = curses[idx] as string;
        for (const c of CURSE_STATES) if (c !== name) this.player.states.remove(c);
        this.player.states.set(name, this.tickCount + Math.max(1, len), st);
        this.events.push({ type: 'playerCursed', curse: name, by: m.id });
        return true;
      }
      case 'RegurgitatorEat': {
        // SrvDo108: 무른 시체를 먹어 없애고 그 최대 생명의 calc1 % 회복
        const t = tp.unit;
        if (!t || t.mode !== 'DD' || t.pet) return true;
        const i = this.monsters.indexOf(t);
        if (i >= 0) this.monsters.splice(i, 1);
        m.hp = Math.min(m.stats.maxHp, Math.max(1, m.hp + calcPercentage(t.stats.maxHp, calc.calc(rec, 1, lvl, o), 100)));
        this.events.push({ type: 'corpseEaten', monsterId: m.id, corpseId: t.id });
        return true;
      }
      case 'DesertTurret': {
        // SrvDo105: calc1 발의 화염구를 대상 방향에 수직으로 2 씩 벌려서 (원작 시작점 Y 에 X 오프셋을 쓰는 버그 그대로)
        const xd = Math.floor(tp.x) - Math.floor(m.x), yd = Math.floor(tp.y) - Math.floor(m.y);
        if (!xd && !yd) return true;
        const bx = yd < 0 ? 2 : yd > 0 ? -2 : 0, by = xd < 0 ? -2 : xd > 0 ? 2 : 0;
        const n = Math.max(1, calc.calc(rec, 1, lvl, o));
        let ox = xd - Math.trunc((bx * n) / 2), oy = yd - Math.trunc((by * n) / 2);
        for (let i = 0; i < n; i++) {
          const from = { x: m.x + Math.trunc(ox / 6), y: m.y + Math.trunc(ox / 6) };
          this.fireMonMissile(m, rec.srvMissileA, from, { x: from.x + ox, y: from.y + oy }, { lvl, explode: { radius: 2, visual: data.missiles.get(rec.srvMissileA)?.explosionMissile || '' } });
          ox += bx;
          oy += by;
        }
        return true;
      }
      case 'ArcaneTower':
      case 'Frost Nova':
      case 'MephFrostNova':
      case 'DiabFire': {
        // SrvDo106 / SrvDo022: 노바 (64 방향)
        const def = data.missiles.get(rec.srvMissileA);
        if (def) this.monNova(m, def.name, lvl, def.vel + (rec.calcs[0] ? calc.calc(rec, 1, lvl, o) : 0));
        return true;
      }
      case 'MonBlizzard':
      case 'Blizzard':
        this.monBlizzard(m, rec, lvl, tp.x, tp.y);
        return true;
      case 'HellMeteor': {
        // SrvDo028 → hellmeteordown (MISSMODE_SrvHit13: sHitPar1 반경 화염). 근사(원작 미확인): 떨어지는 시간 = 미사일 AnimLen × 4 프레임
        const def = data.missiles.get(rec.srvMissileA);
        if (!def) return true;
        const fall = Math.max(8, def.animLen * 4);
        const radius = def.hitParams[0] || 5;
        this.fireMonMissile(m, def.name, { x: tp.x, y: tp.y }, { x: tp.x, y: tp.y }, { lvl, noCollide: true, range: fall, explode: { radius } });
        return true;
      }
      case 'PrimeBolt': {
        // SrvDo017: calc1 (lvl + 2) 개의 충전 볼트 (PATHTYPE_CHARGEDBOLT)
        const n = Math.max(1, calc.calc(rec, 1, lvl, o));
        const base = Math.atan2(tp.y - m.y, tp.x - m.x);
        for (let i = 0; i < n; i++) {
          const a = base + ((this.rng.pick(9) - 4) * Math.PI) / 12;
          this.fireMonMissile(m, rec.srvMissileA, { x: m.x, y: m.y }, { x: m.x + Math.cos(a) * 10, y: m.y + Math.sin(a) * 10 }, { lvl, wander: true });
        }
        return true;
      }
      case 'PrimePoisonNova': {
        // SrvDo099: 16 방향 표의 짝수 8 곳으로 독구름 (속도 par1), calc2 > 1 이면 홀수 방향에 한 겹 더 (속도 par2)
        const X = [0, 1, 2, 2, 2, 2, 2, 1, 0, -1, -2, -2, -2, -2, -2, -1], Y = [2, 2, 2, 1, 0, -1, -2, -2, -2, -2, -2, -1, 0, 1, 2, 2];
        const def = data.missiles.get(rec.srvMissileA);
        if (!def) return true;
        const cloud = (i: number, par: number) => {
          const tx = m.x + (X[i] ?? 0) * 8, ty = m.y + (Y[i] ?? 0) * 8;
          this.fireMonMissile(m, def.name, { x: m.x, y: m.y }, { x: tx, y: ty }, { lvl, vel: Math.max(1, par) * 2, pierce: true, every: 25 });
        };
        for (let i = 0; i < 16; i += 2) cloud(i, def.params[0] ?? 2);
        const step = Math.max(1, calc.calc(rec, 2, lvl, o));
        if (step > 1) for (let i = 0; i < 15; i += step) cloud(i + 1, def.params[1] ?? 4);
        return true;
      }
      case 'MephistoMissile': {
        const def = data.missiles.get(rec.srvMissile || rec.srvMissileA);
        if (def) this.fireMonMissile(m, def.name, { x: m.x, y: m.y }, tp, { lvl, explode: { radius: 1, visual: def.explosionMissile } });
        return true;
      }
      case 'DiabCold': {
        // SrvDo100: 대상에게 바로 (명중 판정 없음) 마법 피해 + 빙결 (지속 = 원소 지속)
        const d = this.monSkillDamage(m, rec, lvl);
        const frz = calc.elemLength(rec, lvl, o);
        if (tp.unit) {
          this.damagePet(tp.unit, d);
          return true;
        }
        if (Math.hypot(player.x - m.x, player.y - m.y) > m.type.meleeRange + 6) return true;
        this.hitPlayer({ min: 0, max: 0, toHit: 0 }, m.stats.level, rec.hitClass, false, m, { ...d, manaDrain: 0 }, true);
        const pfrz = this.playerFreezeLen(frz);
        if (pfrz > 0 && this.character && this.character.life > 0) {
          this.player.states.set('freeze', this.tickCount + pfrz);
          this.events.push({ type: 'playerFrozen', by: m.id, until: this.tickCount + pfrz });
        }
        return true;
      }
      case 'DiabWall': {
        // SrvDo102: calc1 (lvl) 개의 불길 생성기, 80% 는 충전 볼트처럼 흔들리며 지나간 자리에 화염 (diabwall)
        const n = Math.max(1, calc.calc(rec, 1, lvl, o));
        const fire = data.missiles.get(data.missiles.get(rec.srvMissileA)?.subMissile1 ?? '');
        for (let i = 0; i < n; i++) {
          const wobble = this.rng.pick(100) >= 20;
          const a = Math.atan2(tp.y - m.y, tp.x - m.x) + ((this.rng.pick(9) - 4) * Math.PI) / 24;
          this.fireMonMissile(m, rec.srvMissileA, { x: m.x, y: m.y }, { x: m.x + Math.cos(a) * 20, y: m.y + Math.sin(a) * 20 }, {
            lvl, wander: wobble, noCollide: true, range: Math.min(77, data.missiles.get(rec.srvMissileA)?.range ?? 77),
            onTick: (ms) => {
              if (!fire || ms.age % 2 !== 0 || !this.map.walkable(Math.floor(ms.x), Math.floor(ms.y))) return;
              this.missiles.push({
                id: this.nextUnitId++, def: fire, x: Math.floor(ms.x) + 0.5, y: Math.floor(ms.y) + 0.5, dx: 0, dy: 0, left: fire.range, age: 0, owner: 'monster', ownerId: m.id,
                ownerLevel: m.stats.level, hitClass: fire.hitClass || 0x20, hit: new Set(), lvl, mpkt: this.missileOwnDamage(fire, lvl), groundFire: true,
              });
            },
          });
        }
        return true;
      }
      case 'PrimeFirewall':
        this.monsterFirewall(m, rec.srvMissileA, rec.srvMissileB, tp.x, tp.y, lvl);
        return true;
      case 'DiabPrison': {
        // SrvDo104 → sub_6FC6A810: 대상 둘레에 뼈 감옥 (boneprison1~). 근사(원작 미확인): 둘레 8 칸, 지속 200 프레임
        const sum = rec.summon || 'boneprison1';
        const offs = [[-2, -2], [0, -2], [2, -2], [2, 0], [2, 2], [0, 2], [-2, 2], [-2, 0]] as const;
        offs.forEach(([ox, oy], i) => {
          const id = i % 2 ? sum.replace(/1$/, '2') : sum;
          const b = this.spawnMonMinion(m, data.monsters.types.has(id) ? id : sum, Math.floor(tp.x) + ox, Math.floor(tp.y) + oy, 'S1', { noTc: true });
          if (b) b.expires = this.tickCount + 200;
        });
        this.events.push({ type: 'boneprison', by: m.id, x: tp.x, y: tp.y });
        return true;
      }
      case 'Hydra': {
        // SrvDo144: 목표 둘레에 머리 3 개 (hydra1~3), 지속 par1 + (lvl−1) × par2 프레임, 미사일 레벨 = 스킬 레벨
        const life = (rec.params[0] ?? 0) + (lvl - 1) * (rec.params[1] ?? 0);
        const base = (rec.summon || 'hydra1').replace(/\d+$/, '');
        for (let i = 0; i < 3; i++) {
          const h = this.spawnMonMinion(m, `${base}${i + 1}`, cast.tx + (HYDRA_X[i] ?? 0) * 2, cast.ty + (HYDRA_Y[i] ?? 0) * 2, 'NU', { noTc: true });
          if (h) {
            h.expires = this.tickCount + life;
            h.summonLvl = lvl;
          }
        }
        return true;
      }
      case 'HydraMissile': {
        const def = data.missiles.get(rec.srvMissile || 'hydra');
        if (def) this.fireMonMissile(m, def.name, { x: m.x, y: m.y }, tp, { lvl: m.summonLvl ?? lvl, explode: { radius: 0, visual: def.explosionMissile } });
        return true;
      }
      case 'Chain Lightning':
      case 'ZakarumLightning':
      case 'PrimeLightning':
      case 'Glacial Spike':
      case 'Fire Ball': {
        const def = data.missiles.get(rec.srvMissile || rec.srvMissileA);
        if (def) this.fireMonMissile(m, def.name, { x: m.x, y: m.y }, tp, { lvl, explode: { radius: 0, visual: def.explosionMissile } });
        return true;
      }
      default:
        return false;
    }
  }

  /** 돌진 시작 (Charge·SerpentCharge·DiabRun: 대상까지 / Leap: 대상 너머 2×대상 − 자신). 출처: SKILLS_SrvSt31_Charge, SrvSt47_Jump, SrvSt54_DiabRun */
  private monStartDash(m: MonsterUnit, cast: MonCast): void {
    const tp = this.castTarget(m, cast);
    const leap = cast.skill === 'Leap';
    let x = tp.x, y = tp.y;
    if (leap) {
      x = 2 * tp.x - m.x;
      y = 2 * tp.y - m.y;
      const spot = nearestWalkable(this.map, { x, y }, 3);
      if (!spot) return;
      x = spot.x + 0.5;
      y = spot.y + 0.5;
    }
    // 출처: SrvSt31 — 속도 = Run × (par1 + 100 + velocitypercent)/100. 근사(원작 미확인): Leap·DiabRun 은 같은 식에 par1 150
    const rec = this.data?.skills?.byNameOf(cast.skill);
    const pct = cast.skill === 'DiabRun' ? 100 * ((rec?.calcs[0] && this.data?.skillCalc ? this.data.skillCalc.calc(rec, 1, cast.lvl, this.monOwner(m)) : 20) / 8) : (rec?.params[0] || 150);
    const base = Math.max(m.type.run, m.type.velocity, 4);
    const speed = ((base * SUBTILES_PER_YARD) / ENGINE_FPS) * (pct + 100 + (m.bonus.velocitypercent ?? 0)) / 100;
    m.dash = { x, y, ...(tp.unit ? { targetId: tp.unit.id } : {}), hit: leap, speed: Math.min(speed, 3) };
    // Whirlwind (Talic, AITHINK_AncientBarb1SkillHandler): AI 가 정한 지점 (대상 너머 aip4) 까지 곧게, 지나가며 친다
    if (cast.skill === 'Whirlwind') m.dash = { x: cast.tx, y: cast.ty, hit: false, speed: Math.min(speed, 3), spin: this.tickCount };
    if (leap) {
      // 출처: SrvSt47_Jump — 뛰어오를 때 대상에게 한 번 (피해 +calc1 %)
      cast.dashHit = true;
      this.monDashStrike(m, cast, rec);
    }
  }

  /** 돌진 한 프레임: 목표로 곧장 (충돌 무시), 대상과 근접이면 멈추고 친다. 도착·50 프레임이면 끝 */
  private updateMonsterDash(m: MonsterUnit): void {
    const dash = m.dash;
    if (!dash) return;
    const cast = m.cast;
    // 돌진하는 동안 시퀀스(애니메이션)를 첫 프레임 부근에 붙잡아 둔다
    m.modeStart++;
    m.modeEnd++;
    const leap = cast?.skill === 'Leap';
    if (dash.spin !== undefined) {
      // 근사(원작 미확인): 원작은 monseq 이벤트 프레임마다 반경 안 대상 — 여기서는 6 프레임마다 근접 범위 + 2 안의 플레이어
      if (cast && this.tickCount >= dash.spin && isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange + 2, this.player.x, this.player.y, PLAYER_SIZE)) {
        dash.spin = this.tickCount + 6;
        this.monMeleeSkill(m, cast, { mode: 'A1', enDmgPct: 0 });
      }
      const dw = Math.hypot(dash.x - m.x, dash.y - m.y);
      const sx = m.x + ((dash.x - m.x) / Math.max(dw, 1e-6)) * dash.speed, sy = m.y + ((dash.y - m.y) / Math.max(dw, 1e-6)) * dash.speed;
      if (dw <= dash.speed || this.tickCount - m.modeStart > 60 || !this.map.walkable(Math.floor(sx), Math.floor(sy))) {
        m.dash = undefined;
        return;
      }
      m.dir = dir64(dash.x - m.x, dash.y - m.y);
      m.x = sx;
      m.y = sy;
      return;
    }
    const t = !leap && dash.targetId === undefined ? this.player : undefined;
    const tx = t ? t.x : dash.x, ty = t ? t.y : dash.y;
    const tSize = PLAYER_SIZE;
    if (!leap && isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, tx, ty, tSize)) {
      m.dash = undefined;
      return;
    }
    const d = Math.hypot(tx - m.x, ty - m.y);
    if (d <= dash.speed || this.tickCount - m.modeStart > 60) {
      if (leap || d <= dash.speed) {
        const spot = nearestWalkable(m.type.flying ? this.flyMap() : this.map, { x: tx, y: ty }, 2);
        if (spot && leap) {
          m.x = spot.x + 0.5;
          m.y = spot.y + 0.5;
        }
      }
      m.dash = undefined;
      return;
    }
    const nx = m.x + ((tx - m.x) / d) * dash.speed, ny = m.y + ((ty - m.y) / d) * dash.speed;
    if (!leap && (!this.map.walkable(Math.floor(nx), Math.floor(ny)) || this.blockedByUnit(m, nx, ny, m.type.sizeX))) {
      m.dash = undefined;
      return;
    }
    m.dir = dir64(tx - m.x, ty - m.y);
    m.x = nx;
    m.y = ny;
  }

  /** 돌진 끝의 일격 (Charge: +calc1 %, SerpentCharge: 기본, DiabRun: 스킬 물리 피해, Leap: +calc1 %) */
  private monDashStrike(m: MonsterUnit, cast: MonCast, rec: SkillRecord | undefined): void {
    const calc = this.data?.skillCalc;
    const pct = rec && calc && rec.calcs[0] && cast.skill !== 'DiabRun' ? calc.calc(rec, 1, cast.lvl, this.monOwner(m)) : 0;
    this.monMeleeSkill(m, cast, { mode: 'A1', enDmgPct: pct, skillPhys: cast.skill === 'DiabRun' });
  }

  /**
   * 몬스터 오라 (Duriel Holy Freeze — 오른쪽 스킬로 켜 둔 오라). 출처: AITHINK_Fn044_Duriel (D2GAME_SetSkills 레벨 = aip1),
   * SKILLS_SrvDo081_HolyFreeze — 주기 perdelay 마다 범위 aurarange 안 적에게 holywindcold (속도·공속 −dm34, 냉기 효과로 제한) + 냉기 피해
   */
  private updateMonsterAuras(m: MonsterUnit): void {
    const i = m.type.skills.findIndex((k) => k.name === 'Holy Freeze');
    if (i < 0 || this.inTown) return;
    if (m.auraNext !== undefined && this.tickCount < m.auraNext) return;
    const data = this.data, calc = data?.skillCalc, s = data?.skills?.byNameOf('Holy Freeze');
    if (!s || !calc) return;
    const lvl = Math.max(1, (m.type.aiParams[0] ?? 1) + this.rules.monsterSkillBonus);
    const o = this.monOwner(m);
    const period = Math.max(5, calc.eval(s, s.perDelay, lvl, o));
    m.auraNext = this.tickCount + period;
    m.states.set(s.auraState, this.tickCount + period + 1);
    const range = calc.eval(s, s.auraRangeCalc, lvl, o);
    const p = this.player;
    if (p.mode === 'DT' || p.mode === 'DD' || Math.hypot(p.x - m.x, p.y - m.y) > range) return;
    const stats: Record<string, number> = {};
    for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
    if (stats.attackrate !== undefined && stats.other_animrate === undefined) stats.other_animrate = stats.attackrate;
    p.states.set(s.auraTargetState, this.tickCount + period + 1, stats);
    const d = this.monSkillDamage(m, s, lvl);
    d.coldLen = 0;
    d.hitClass = s.hitClass || 0x0d;
    if (d.cold > 0) this.hitPlayer({ min: 0, max: 0, toHit: 0 }, m.stats.level, d.hitClass, true, undefined, { ...d, manaDrain: 0 }, true);
  }

  /** 모드 지정 경로 이동 (Vulture S1 비행). 출처: AITACTICS_ChangeModeAndTargetCoordinatesOneStep(…, nMode) */
  private monsterMoveMode(m: MonsterUnit, x: number, y: number, mode: MonMode): boolean {
    if (!m.type.modes.has(mode)) return this.monsterMoveTo(m, x, y, false, 1);
    const map = this.flyMap();
    // 출처: AITHINK_Fn023_Vulture — 목표가 막혔으면 COLLISION_GetFreeCoordinates 로 가까운 빈 곳 (근사: 맵 안으로 자르고 반경 10)
    const cx = Math.min(map.width - 1, Math.max(0, Math.floor(x))), cy = Math.min(map.height - 1, Math.max(0, Math.floor(y)));
    const t = nearestWalkable(map, { x: cx, y: cy }, 10);
    let path = t ? findPath(map, m, { x: t.x + 0.5, y: t.y + 0.5 }, 3000) : null;
    if (!path || !path.length) {
      // 제자리 모드 (착륙 S2)
      this.startMonsterMode(m, mode);
      return true;
    }
    path = firstSegments(path, 1);
    if (path.length > 20) path = path.slice(0, 20);
    this.setMonMode(m, mode);
    m.cast = undefined;
    m.path = path;
    m.pathMode = true;
    m.moveVelPct = m.velPct;
    m.moveSpeed = Math.max(0, (m.type.velocity * (100 + m.velPct + (m.bonus.velocitypercent ?? 0))) / 100);
    return true;
  }

  /** AI 가 쓰는 대상 정보 (저항·냉기·생명·특수 기술·포털·점수). 출처: AITHINK_GetTargetScore, AI_CheckSpecialSkillsOnPrimeEvil */
  private monTargetInfo(): NonNullable<ReturnType<NonNullable<AiWorld['targetInfo']>>> {
    const c = this.character;
    const fireRes = this.playerResist('fireresist'), coldRes = this.playerResist('coldresist'), lightRes = this.playerResist('lightresist');
    const life = c ? Math.trunc((100 * c.life) / Math.max(1, this.maxLife())) : 100;
    const cold = this.player.states.has('cold');
    let special = false;
    for (const id of [c?.leftSkill ?? 0, c?.rightSkill ?? 0]) {
      const s = this.skillRecord(id);
      if (!s) continue;
      const lvl = this.effectiveSkillLevel(s.id);
      if (s.name === 'Blizzard' || s.name === 'Meteor' || (s.name === 'Fire Wall' && lvl > 3) || (s.name === 'Immolation Arrow' && lvl > 7)) special = true;
    }
    const tp = this.townPortal;
    const po = tp && tp.fieldLevel === this.level.def.id ? this.level.objects.find((o) => o.id === tp.fieldId) : undefined;
    // 출처: AITHINK_GetTargetScore — (저항 + 5 × (범위 + 기본) + 2 × (피해 + 스킬 + 2 × 냉기) + 3 × 생명 20% 미만) / 22
    // 근사(원작 미확인): 피해·스킬 항은 캐릭터 레벨로, 범위는 근접 거리 판정 없이 75
    const resist = Math.trunc((fireRes + lightRes + coldRes) / 15);
    const score = Math.max(1, Math.trunc((resist + 5 * 75 + 2 * ((c?.level ?? 1) + 2 * (cold ? 100 : 0)) + 3 * (life < 20 ? 100 : 0)) / 22));
    return { fireRes, coldRes, lightRes, cold, lifePct: life, special, states: this.player.states.names(), ...(po ? { portal: { x: po.x, y: po.y } } : {}), score };
  }

  /**
   * 죽을 때 터짐 (monstats deathDmg — Undead Stygian Doll 계열). 출처: MonsterMode.cpp 죽음 모드 전환 —
   * monstercorpseexplode, 최대 = monstats 생명(현재 레벨) × MonsterCEDmgPercent / 100, 최소 60 %, 물리 (<< 7), 반경 5
   */
  private monDeathDamage(m: MonsterUnit): void {
    const data = this.data;
    if (!data || !m.type.deathDmg || m.type.baseId !== 'bonefetish1') return;
    const hp = Math.trunc((m.type.maxHpPct * data.monsters.levelBase(Math.max(1, m.stats.level), 'HP')) / 100);
    const max = Math.trunc((hp * this.rules.monsterCEDamagePercent) / 100), min = Math.trunc((max * 60) / 100);
    const dmg = min + m.rng.pick(Math.max(0, max - min));
    const explode = data.missiles.get('monstercorpseexplode');
    if (explode) this.missiles.push({ id: this.nextUnitId++, def: explode, x: m.x, y: m.y, dx: 0, dy: 0, left: explode.range, age: 0, owner: 'monster', ownerId: m.id, ownerLevel: m.stats.level, hitClass: 0, hit: new Set(), lvl: 1, visual: true });
    const p = this.player;
    if (p.mode !== 'DT' && p.mode !== 'DD' && Math.hypot(p.x - m.x, p.y - m.y) <= 5) {
      const pkt = emptyDamage();
      pkt.phys = dmg << 7;
      this.damagePlayerDirect(pkt, 'deathDmg');
    }
    this.events.push({ type: 'monsterExploded', monsterId: m.id, damage: dmg / 2 });
  }

  /** 죽음 애니메이션이 끝남. 출처: MonsterMode.cpp sub_6FC641D0 — SplEndDeath 1: MONSTER_Reinitialize(minion1) (Fetish Shaman 시체 → Fetish 시체) */
  private monEndDeath(m: MonsterUnit): void {
    const data = this.data;
    if (!data || m.type.splEndDeath !== 1) return;
    const id = m.type.minions[0];
    if (!id || !data.monsters.types.has(id)) return;
    m.type = data.monsters.get(id);
    m.stats = rollMonsterStats(data.monsters, m.type, m.rng);
    m.hp = 0;
    this.events.push({ type: 'monsterReinitialized', monsterId: m.id, typeId: id });
  }

  /** SplEndGeneric 몬스터가 방금 끝낸 모드가 바로 AI 를 부르는 모드인가 (MonsterMode.cpp 표: Bat Demon S3/S4, Frog Demon SQ, Trapped Soul 전부) */
  private splEndNow(m: MonsterUnit): boolean {
    const last = (Object.keys(MONMODE_INDEX) as MonMode[]).find((k) => MONMODE_INDEX[k] === m.aiState);
    switch (m.type.baseId) {
      case 'batdemon1': return last === 'S3' || last === 'S4';
      case 'frogdemon1': return last === 'SQ';
      case 'trappedsoul1': return true;
      default: return false;
    }
  }

  /** 카오스 생추어리 봉인·보스·디아블로 상태 (게임마다) */
  private readonly chaos = new ChaosState();

  /**
   * Diablo 봉인 조작 (objects.txt OperateFn 52/54/55/56). 출처: A4Q2.cpp OBJECTS_OperateFunction52/54/55/56_DiabloSeal
   * 근사(원작 미확인): 보스 자리 빈칸 찾기 (QUESTS_GetFreePosition) 는 spawnSuperUnique 의 빈칸 탐색으로
   */
  private opDiabloSeal(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.setMode(o, OBJMODE.OPERATING);
    this.scheduleEndAnim(o);
    const actions = this.chaos.operateSeal(o.type.id);
    const idx = SEAL_IDS.indexOf(o.type.id);
    this.events.push({ type: 'sealOperated', objectId: o.id, classId: o.type.id, index: idx, opened: this.chaos.sealActivated.filter(Boolean).length });
    this.runChaos(actions, Math.floor(o.x), Math.floor(o.y));
  }

  private runChaos(actions: ChaosAction[], sx: number, sy: number): void {
    for (const a of actions) {
      if (a.kind === 'spawnBoss') {
        // 근사(원작 미확인): 원작 오프셋은 원작 봉인 좌표 기준이라 우리 DRLG 배치에서는 화면 밖 먼 곳·고립 지역에 떨어진다.
        //   봉인을 연 플레이어(걸어서 온 곳 — 길과 이어짐)에서 걸어 이어진 SEAL_BOSS_RADIUS 칸 안 중 원작 방향에 가장 가까운 칸 — 열면 화면 안에 나타난다
        const at = reachableNear(this.map, this.player, { x: sx + a.dx, y: sy + a.dy }, SEAL_BOSS_RADIUS) ?? { x: sx + a.dx, y: sy + a.dy };
        const b = this.spawnSuperUnique(a.superUnique, at.x, at.y, undefined, true);
        if (b) {
          b.sealBoss = true;
          this.events.push({ type: 'sealBossSpawned', monsterId: b.id, superUnique: a.superUnique, x: b.x, y: b.y });
        }
      } else if (a.kind === 'clear') {
        // 출처: ACT4Q2_KillAllMonstersInCS — 디아블로 말고 살아 있는 악 몬스터를 죽음 모드로 (경험치·드롭 없음)
        for (const m of [...this.monsters]) {
          if (m.pet || m.npc || m.mode === 'DT' || m.mode === 'DD' || m.type.id === 'diablo') continue;
          m.noXp = true;
          m.noTc = true;
          this.killMonster(m, 'other');
        }
        this.events.push({ type: 'chaosCleared' });
      }
    }
  }

  /** 봉인 보스·디아블로 처치 (killMonster 에서) */
  private onChaosKill(m: MonsterUnit): void {
    if (m.type.id === 'diablo') {
      this.chaos.diabloKilled = true;
      this.events.push({ type: 'diabloKilled', monsterId: m.id, x: m.x, y: m.y });
      return;
    }
    if (!m.sealBoss) return;
    this.events.push({ type: 'sealBossKilled', monsterId: m.id, superUnique: m.superUnique });
    this.runChaos(this.chaos.bossKilled(), 0, 0);
  }

  /** 디아블로 타이머 (매 프레임). 출처: ACT4Q2_SpawnDiablo — Diablo 시작 자리 (InitFn 55 오브젝트) 에 NU 모드 */
  private updateChaos(): void {
    if (!this.chaos.tick()) return;
    const level = [...this.levels.values()].find((l) => l.def.levelNo === 108);
    const start = level?.objects.find((o) => o.type.initFn === 55) ?? level?.def.objects?.find((o) => o.classId === 255);
    if (!level || !start || !this.data?.monsters.types.has('diablo')) return;
    const prev = this.level;
    this.level = level;
    const t = this.data.monsters.get('diablo');
    const spot = this.spawnSpot(start.x, start.y, 10, t);
    if (spot) {
      const d = this.spawnMonster('diablo', spot.x, spot.y);
      this.chaos.spawned();
      this.events.push({ type: 'diabloSpawned', monsterId: d.id, x: d.x, y: d.y });
    }
    this.level = prev;
  }

  /** 봉인 상태 (Phase 7 퀘스트·테스트) */
  get chaosState(): Readonly<ChaosState> {
    return this.chaos;
  }

  /**
   * Arach 거미줄 (SpiderLay 상태로 걷는 동안 spidergoolay). 놓인 줄(spidergoolay)이 끝나면 점액(spidergoo, Size 3, Range 200)이 남고,
   * 점액에 닿은 적(플레이어)은 SpiderLay 의 auratargetstate(slowed)·aurastat(velocitypercent −100)를 calc4 (최소 5) 프레임 받는다.
   * 출처: MissMode.cpp MISSMODE_SrvHit15_SpiderGooLay (HitSubMissile1 생성), MISSMODE_SrvHit16_SpiderGoo (auratargetstate, 길이 max(calc4, 5)),
   *       이동 속도 하한 25 % (Units.cpp UNITS_UpdateRunWalkAnimRateAndVelocity) → 점액 위에서는 걷기 속도의 25 %
   * 근사(원작 미확인): 놓인 줄의 적중 시점(CollideType 1)을 수명 끝으로
   */
  private dropSpiderGoo(m: MonsterUnit): void {
    const def = this.data?.missiles.get('spidergoolay');
    if (!def) return;
    this.missiles.push({
      id: this.nextUnitId++, def, x: m.x, y: m.y, dx: 0, dy: 0, left: def.range, age: 0, owner: 'monster', ownerId: m.id, ownerLevel: m.stats.level,
      hitClass: 0, hit: new Set(), lvl: 1, goo: true,
    });
  }

  /** 거미줄·점액 한 프레임 (반환 true = 소멸) */
  private updateGoo(ms: Missile, p: PlayerState): boolean {
    const data = this.data;
    if (ms.def.srvHitFunc === 15) {
      if (ms.left > 0) return false;
      const sub = ms.def.hitSubMissile1 ? data?.missiles.get(ms.def.hitSubMissile1) : undefined;
      if (sub) {
        this.missiles.push({
          id: this.nextUnitId++, def: sub, x: ms.x, y: ms.y, dx: 0, dy: 0, left: sub.range, age: 0, owner: 'monster', ownerId: ms.ownerId, ownerLevel: ms.ownerLevel,
          hitClass: 0, hit: new Set(), lvl: ms.lvl, goo: true,
        });
      }
      return true;
    }
    if (p.mode !== 'DT' && p.mode !== 'DD' && footprintsOverlap(ms.x, ms.y, ms.def.size, p.x, p.y, PLAYER_SIZE)) {
      const s = data?.skills?.byNameOf('SpiderLay'), calc = data?.skillCalc;
      if (s && calc && s.auraTargetState) {
        const o = this.owner();
        const len = Math.max(calc.calc(s, 4, ms.lvl, o), 5);
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, ms.lvl, o);
        const had = this.player.states.has(s.auraTargetState);
        this.player.states.remove(s.auraTargetState);
        this.player.states.set(s.auraTargetState, this.tickCount + len, stats);
        if (!had) this.events.push({ type: 'playerSlowed', state: s.auraTargetState, until: this.tickCount + len });
      }
    }
    return ms.left <= 0;
  }

  /** 불벽 생성기 (SrvDo024): 생성기 미사일이 대상 쪽으로 가며 지면 불을 남긴다. 근사(원작 미확인): 생성기 경로는 직선 */
  private monsterFirewall(m: MonsterUnit, makerName: string, fireName: string, tx: number, ty: number, lvl: number): void {
    const data = this.data;
    const fire = data?.missiles.get(fireName), maker = data?.missiles.get(makerName);
    if (!fire || !maker) return;
    const steps = Math.max(1, Math.trunc((maker.range * missileStep(maker.vel)) / 1));
    const d = Math.hypot(tx - m.x, ty - m.y) || 1;
    const ux = (tx - m.x) / d, uy = (ty - m.y) / d;
    for (let i = 0; i < steps; i++) {
      const x = Math.floor(tx + ux * (i - steps / 2)), y = Math.floor(ty + uy * (i - steps / 2));
      if (!this.map.walkable(x, y) || this.missiles.some((o) => o.def === fire && Math.floor(o.x) === x && Math.floor(o.y) === y)) continue;
      const pkt = this.missileOwnDamage(fire, lvl);
      this.missiles.push({
        id: this.nextUnitId++, def: fire, x: x + 0.5, y: y + 0.5, dx: 0, dy: 0, left: Math.min(fire.range + lvl * fire.levRange, 250), age: 0, owner: 'monster', ownerId: m.id,
        ownerLevel: m.stats.level, hitClass: fire.hitClass || 0x20, hit: new Set(), lvl, mpkt: pkt, groundFire: true,
      });
    }
  }

  /** 미사일 자체 피해 (1/256): MinDamage + 레벨 보너스, 원소 EMin~EMax + 레벨 보너스, 지속 ELen + ELevLen. 출처: MISSILE_CalculateDamageData */
  private missileOwnDamage(def: MissileDef, lvl: number): DamagePacket {
    const d = emptyDamage();
    const sh = 2 ** def.hitShift;
    const minP = (def.minDamage + levelDamageBonus(lvl, def.minDamLev)) * sh, maxP = (def.maxDamage + levelDamageBonus(lvl, def.maxDamLev)) * sh;
    if (maxP > 0) d.phys += minP + this.rng.pick(Math.max(0, maxP - minP));
    if (def.eType) {
      const min = (def.eMin + levelDamageBonus(lvl, def.eMinLev)) * sh, max = (def.eMax + levelDamageBonus(lvl, def.eMaxLev)) * sh;
      const len = def.eLen + levelDamageBonus(lvl, def.eLevLen);
      if (max > 0) addElemental(d, def.eType, min + this.rng.pick(Math.max(0, max - min)), len);
    }
    d.hitClass = def.hitClass;
    return d;
  }

  /**
   * 몬스터 미사일 발사. 피해 = 모드 공격 피해 × SrcDamage/128 (+ 몬스터 원소 피해) + 미사일 자체 피해 (레벨 = 스킬 레벨, 공격 미사일은 1).
   * 출처: MonsterMode.cpp 공격 이벤트 (미사일 레벨 = MonsterSkillBonus + 1), MISSILE_CalculateDamageData
   *       MonsterUnique.cpp sub_6FC6DA40 (Multiple Shots: 대상 좌우로 두 발 더)
   */
  private launchMonsterMissile(m: MonsterUnit, name: string, tx: number, ty: number, o: { lvl: number; mode: MonMode; noMulti?: boolean }): void {
    const data = this.data;
    const md = data?.missiles.get(name);
    if (!data || !md) return;
    let speed = missileStep(md.vel);
    // Slow Missiles: skill_handofathena % 로 미사일 속도. 출처: MISSILES_CreateMissileFromParams (CanSlow + STATE_SLOWMISSILES)
    const slow = m.states.get('slowmissiles');
    if (slow) speed = (speed * (slow.stats.skill_handofathena ?? 100)) / 100;
    const dx = tx - m.x, dy = ty - m.y;
    const d = Math.hypot(dx, dy) || 1;
    const atk = this.monsterAttack(m, o.mode);
    const src = md.srcDamage > 0 ? md.srcDamage : 0;
    const own = this.missileOwnDamage(md, o.lvl);
    const pkt = emptyDamage();
    if (src) {
      pkt.fire = Math.trunc((atk.elem.fire * src) / 128);
      pkt.ltng = Math.trunc((atk.elem.ltng * src) / 128);
      pkt.cold = Math.trunc((atk.elem.cold * src) / 128);
      pkt.coldLen = atk.elem.coldLen;
      pkt.pois = Math.trunc((atk.elem.pois * src) / 128);
      pkt.poisLen = atk.elem.poisLen;
      pkt.mag = Math.trunc((atk.elem.mag * src) / 128);
    }
    pkt.phys += own.phys;
    pkt.fire += own.fire;
    pkt.ltng += own.ltng;
    pkt.cold += own.cold;
    pkt.coldLen = Math.max(pkt.coldLen, own.coldLen);
    pkt.pois += own.pois;
    pkt.poisLen = Math.max(pkt.poisLen, own.poisLen);
    pkt.mag += own.mag;
    pkt.manaDrain = src ? atk.elem.manaDrain : 0;
    this.missiles.push({
      id: this.nextUnitId++, def: md, x: m.x, y: m.y, dx: (dx / d) * speed, dy: (dy / d) * speed, left: md.range, age: 0,
      owner: 'monster', ownerId: m.id, ownerLevel: m.stats.level,
      damage: src ? { min: Math.floor((atk.min * src) / 128), max: Math.floor((atk.max * src) / 128) } : { min: 0, max: 0 },
      toHit: atk.toHit, hitClass: md.hitClass || 10, hit: new Set(), lvl: o.lvl, mpkt: pkt, alwaysHit: !src,
      ...(md.name === 'lightunique' ? { wander: true } : {}),
    });
    this.events.push({ type: 'monsterMissile', monsterId: m.id, name });
    // Multiple Shots (유니크 수식어 29): 대상 좌우 (수직 방향 ±1) 로 두 발 더
    if (!o.noMulti && m.umods.includes(UMOD.MULTISHOT) && (m.flags & MONFLAG.UNIQUE)) {
      const sx = Math.sign(Math.floor(m.x) - Math.floor(tx)), sy = Math.sign(Math.floor(m.y) - Math.floor(ty));
      this.launchMonsterMissile(m, name, tx - sy, ty + sx, { ...o, noMulti: true });
      this.launchMonsterMissile(m, name, tx + sy, ty - sx, { ...o, noMulti: true });
    }
  }

  /** 이 몬스터의 현재 공격 대상 위치 (소환수·혼란 대상 또는 플레이어) */
  private targetOf(m: MonsterUnit): { x: number; y: number; unit?: MonsterUnit } {
    if (m.targetId !== undefined) {
      const u = this.pets.find((x) => x.id === m.targetId) ?? this.monsters.find((x) => x.id === m.targetId);
      if (u && u.mode !== 'DT' && u.mode !== 'DD') return { x: u.x, y: u.y, unit: u };
    }
    return { x: this.player.x, y: this.player.y };
  }

  /**
   * 몬스터 공격 대상 고르기: 플레이어와 소환수 중 가장 가까운 쪽 (aidist 안).
   * Confuse 저주: 가장 가까운 다른 몬스터. Dim Vision 저주: 거리 4 밖은 보이지 않는다.
   * 근사(원작 미확인): 원작 AI 의 대상 선택 가중치(AIUTIL 대상 탐색) 대신 거리만 비교
   */
  private chooseMonsterTarget(m: MonsterUnit, w: AiWorld): void {
    const p = this.player;
    const pDead = p.mode === 'DT' || p.mode === 'DD';
    type Cand = { x: number; y: number; size: number; id?: number };
    const cands: Cand[] = [];
    // Attract: 저주받은 몬스터를 노린다 (출처: SKILLS_SrvDo059_Attract → sub_6FC61E30 대상 지정, AIRESET 까지)
    const att = this.attracted.get(m.id);
    const attTarget = att && att.until > this.tickCount ? this.monsters.find((o) => o.id === att.target && o !== m && o.mode !== 'DT' && o.mode !== 'DD' && o.states.has('attract')) : undefined;
    if (att && !attTarget) this.attracted.delete(m.id);
    if (attTarget) {
      cands.push({ x: attTarget.x, y: attTarget.y, size: attTarget.type.sizeX, id: attTarget.id });
    } else if (m.states.has('confuse') || m.states.has('conversion')) {
      // Conversion: 편이 된 몬스터는 다른 몬스터를 공격 (출처: SKILLS_SrvDo079_Conversion — 정렬 변경 sub_6FCBDD30(pTarget, 2))
      for (const o of this.monsters) if (o !== m && o.mode !== 'DT' && o.mode !== 'DD' && !(m.states.has('conversion') && o.states.has('conversion'))) cands.push({ x: o.x, y: o.y, size: o.type.sizeX, id: o.id });
    } else {
      if (!pDead) cands.push({ x: p.x, y: p.y, size: PLAYER_SIZE });
      // 근사(원작 미확인): Hydra 머리(생명 없는 소환수)는 몬스터의 공격 대상이 아니다
      for (const pet of this.pets) if (pet.mode !== 'DT' && pet.mode !== 'DD' && pet.pet?.petType !== 'none' && pet.pet?.petType !== 'hydra') cands.push({ x: pet.x, y: pet.y, size: pet.type.sizeX, id: pet.id });
      for (const o of this.monsters) if (o !== m && o.mode !== 'DT' && o.mode !== 'DD' && o.states.has('conversion')) cands.push({ x: o.x, y: o.y, size: o.type.sizeX, id: o.id });
    }
    let best: Cand | undefined, bd = Infinity;
    for (const c of cands) {
      const d = aiDistance(m.x, m.y, c.x, c.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    const blind = m.states.has('dimvision') && bd > 4;
    m.targetId = best?.id;
    w.target = best && !blind
      ? { x: best.x, y: best.y, size: best.size, dead: false, inTown: this.inTown && best.id === undefined, ...(best.id !== undefined ? { id: best.id } : {}) }
      : { x: p.x, y: p.y, size: PLAYER_SIZE, dead: true, inTown: this.inTown };
  }

  /**
   * 공포(Howl): 대상에게서 도망친다.
   * 근사(원작 미확인): 원작 AISPECIALSTATE_TERROR 전용 AI 대신 D2GAME_AICORE_Escape 로 거리 10 도주 반복.
   */
  private thinkTerror(w: AiWorld, m: MonsterUnit): void {
    if (!escape(w, m, 10)) idle(w, m, 10);
  }

  /**
   * 도발(Taunt): 도발한 캐릭터에게 다가가 근접 공격한다.
   * 근사(원작 미확인): 원작 AISPECIALSTATE_TAUNT 전용 AI 대신 접근 + A1 공격.
   */
  private thinkTaunt(w: AiWorld, m: MonsterUnit): void {
    const t = w.target;
    if (t.dead || t.inTown) {
      idle(w, m, 25);
      return;
    }
    if (isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, t.x, t.y, PLAYER_SIZE)) w.startMode(m, 'A1');
    else walkToTarget(w, m, false);
  }

  /**
   * 몬스터 공격 수치 (모드별). 원소 피해는 1/256 단위로 굴린 값.
   * 출처: MonsterMode.cpp sub_6FC627B0 — A2 = A2 피해, BL/SC/S1 = S1 피해, 그 밖 = A1 피해; El1~3 (모드 일치, Pct% 확률,
   *       독 = 10 × 피해 (프레임당 1/256) · 길이 2 × Dur, 냉기 길이 = Dur); 수식어 스탯 (firemindam … damagepercent, item_tohit_percent)
   *       MonsterUnique.cpp MONSTERUNIQUE_ApplyElementalDamage (Spectral Hit: 공격마다 무작위 원소)
   */
  private monsterAttack(m: MonsterUnit, mode: MonMode): { min: number; max: number; toHit: number; elem: DamagePacket & { manaDrain: number } } {
    const base = mode === 'A2' ? m.stats.a2 : mode === 'S1' || mode === 'SC' || mode === 'BL' ? m.stats.s1 : m.stats.a1;
    const dmgPct = m.states.stat('damagepercent') + (m.bonus.damagepercent ?? 0), thPct = m.states.stat('item_tohit_percent') + (m.bonus.item_tohit_percent ?? 0);
    const elem = { ...emptyDamage(), manaDrain: 0 };
    const roll = (lo: number, hi: number) => (hi > lo ? lo + m.rng.pick(hi - lo + 1) : lo);
    const addEl = (type: string, min: number, max: number, dur: number) => {
      switch (type) {
        case 'fire': elem.fire += roll(min, max) * 256; break;
        case 'ltng': elem.ltng += roll(min, max) * 256; break;
        case 'mag': elem.mag += roll(min, max) * 256; break;
        case 'cold': elem.cold += roll(min, max) * 256; elem.coldLen = Math.max(elem.coldLen, dur); break;
        case 'pois': elem.pois += roll(10 * min, 10 * max); elem.poisLen = Math.max(elem.poisLen, 2 * dur); break;
        case 'mana': elem.manaDrain += roll(min, max) * 256; break;
        case 'stun': elem.stunLen = Math.max(elem.stunLen, dur); break;
        // Phase 5: El*Type rand (Doom Knight) — 공격마다 무작위 원소. 근사(원작 미확인): 불·번개·냉기·독·마법 중 균등
        case 'rand': addEl((['fire', 'ltng', 'cold', 'pois', 'mag'] as const)[(m.rng.roll() >>> 0) % 5] as string, min, max, dur || 40); break;
        default: break;
      }
    };
    m.type.elem.forEach((e, i) => {
      if (!e.mode || e.mode !== mode || !e.pct) return;
      if (e.pct < 100 && (m.rng.roll() >>> 0) % 100 >= e.pct) return;
      const v = m.stats.elem[i];
      if (v) addEl(e.type, v.min, v.max, e.dur);
    });
    const b = m.bonus;
    if (b.firemaxdam) addEl('fire', b.firemindam ?? 0, b.firemaxdam, 0);
    if (b.lightmaxdam) addEl('ltng', b.lightmindam ?? 0, b.lightmaxdam, 0);
    if (b.coldmaxdam) addEl('cold', b.coldmindam ?? 0, b.coldmaxdam, b.coldlength ?? 0);
    if (b.poisonmaxdam) {
      elem.pois += roll(b.poisonmindam ?? 0, b.poisonmaxdam);
      elem.poisLen = Math.max(elem.poisLen, b.poisonlength ?? 0);
    }
    if (b.manadrainmaxdam) elem.manaDrain += roll(b.manadrainmindam ?? 0, b.manadrainmaxdam);
    if (m.umods.includes(UMOD.SPECTRALHIT) && (m.flags & MONFLAG.UNIQUE) && this.data) {
      const dm = this.data.monsters.levelBase(Math.max(1, m.stats.level), 'DM');
      const lo = Math.trunc((dm * (this.data.uniques?.constant(28) ?? 0)) / 100), hi = Math.trunc((dm * (this.data.uniques?.constant(31) ?? 0)) / 100);
      const kind = ['fire', 'ltng', 'mag', 'cold', 'pois'][(m.rng.roll() >>> 0) % 5] as string;
      addEl(kind, lo, hi, kind === 'cold' || kind === 'pois' ? 40 : 0);
    }
    return {
      min: Math.max(0, base.min + Math.trunc((base.min * dmgPct) / 100)),
      max: Math.max(0, base.max + Math.trunc((base.max * dmgPct) / 100)),
      toHit: Math.max(0, base.toHit + Math.trunc((base.toHit * thPct) / 100)),
      elem,
    };
  }

  private resolveMonsterAttack(m: MonsterUnit): void {
    const data = this.data;
    const atk = this.monsterAttack(m, m.mode);
    const missName = m.mode === 'A2' ? m.type.missA2 : m.mode === 'A1' ? m.type.missA1 : m.mode === 'S1' ? m.type.missS1 : m.mode === 'SC' ? m.type.missC : m.mode === 'SQ' ? m.type.missSQ : '';
    if (missName && data?.missiles.has(missName)) {
      const tp = this.targetOf(m);
      // 출처: MonsterMode.cpp 공격 이벤트 — 미사일 레벨 = MonsterSkillBonus + 1
      const lvl = this.rules.monsterSkillBonus + 1;
      this.launchMonsterMissile(m, missName, tp.x, tp.y, { lvl, mode: m.mode });
      // 출처: 같은 곳 — Quill Rat 계열은 aip3 개수만큼 대상 ±5 지점에도 (시드 'SEIS')
      if (m.type.baseId === 'quillrat1') {
        const n = m.type.aiParams[2] ?? 0;
        const seed = new Rng(0x53454953);
        let ox = 5, oy = 5;
        for (let i = 0; i < n; i++) {
          if (seed.roll() & 1) ox = -ox;
          if (seed.roll() & 1) oy = -oy;
          this.launchMonsterMissile(m, missName, tp.x + ox, tp.y + oy, { lvl: 1, mode: m.mode, noMulti: true });
        }
      }
      return;
    }
    if (m.mode === 'S2') return;
    const tgt = this.targetOf(m);
    if (tgt.unit) {
      if (!isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, tgt.unit.x, tgt.unit.y, tgt.unit.type.sizeX, 1)) return;
      this.monsterHitsUnit(m, tgt.unit, atk);
      return;
    }
    const p = this.player;
    if (!isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, p.x, p.y, PLAYER_SIZE, 1)) return;
    this.onAttackedInMelee(m);
    this.hitPlayer(atk, m.stats.level, m.type.hitClass, false, m, atk.elem);
  }

  /** 몬스터가 소환수(또는 혼란으로 다른 몬스터)를 근접 공격. 출처: SUNITDMG_IsHitSuccessful (몬스터 AR vs 방어, 레벨 비교) */
  private monsterHitsUnit(m: MonsterUnit, t: MonsterUnit, atk: { min: number; max: number; toHit: number }): void {
    if (!rollPercent(hitChance(atk.toHit, this.monsterDefense(t, false), m.stats.level, t.stats.level), m.rng)) return;
    const d = emptyDamage();
    d.phys = rollDamage({ min: atk.min, max: atk.max }, m.rng) * 256;
    d.hitClass = m.type.hitClass;
    if (t.pet) this.damagePet(t, d);
    else this.damageMonster(t, d, 'other');
    this.ironMaiden(m, d.phys / 256);
  }

  /** Iron Maiden 저주: 저주받은 몬스터가 근접으로 준 피해의 calc1 % 를 자신이 받는다 (auraevent domeleedamage) */
  private ironMaiden(m: MonsterUnit, dealt: number): void {
    const st = m.states.get('ironmaiden');
    const s = st?.skill ? this.skillRecord(st.skill.id) : undefined, calc = this.data?.skillCalc;
    if (!st?.skill || !s || !calc || dealt <= 0 || m.mode === 'DT' || m.mode === 'DD') return;
    const d = emptyDamage();
    d.phys = Math.trunc((dealt * 256 * calc.calc(s, 1, st.skill.lvl, this.owner())) / 100);
    d.hitClass = s.hitClass || 0x0d;
    this.damageMonster(m, d, 'other');
  }

  /**
   * 근접 피격 이벤트 (auraevent damagedinmelee): Frozen Armor — 공격자 빙결 (calc1 프레임).
   * 출처: SKILLS_EventFunc02_FrozenArmor (물리 피해가 있을 때만)
   */
  private onDamagedInMelee(attacker: MonsterUnit, dmg = 0): void {
    // Thorns: 근접 공격자에게 받은 피해의 thorns_percent % 를 물리 피해로 되돌림 (출처: itemstatcost.txt thorns_percent)
    const thorns = this.playerStat('thorns_percent');
    if (thorns > 0 && dmg > 0 && attacker.mode !== 'DT' && attacker.mode !== 'DD') {
      const d = emptyDamage();
      d.phys = Math.trunc((dmg * 256 * thorns) / 100);
      d.hitClass = 0x0d;
      this.damageMonster(attacker, d);
    }
    const st = this.player.states.get('frozenarmor');
    const s = st?.skill ? this.skillRecord(st.skill.id) : undefined, calc = this.data?.skillCalc;
    if (!st?.skill || !s || !calc || attacker.type.coldEffect >= 0) return;
    const len = calc.calc(s, 1, st.skill.lvl, this.owner());
    if (len > 0) attacker.states.set('freeze', this.tickCount + len);
  }

  /**
   * 미사일에 맞음 이벤트 (auraevent hitbymissile): Chilling Armor — ReturnFire 미사일을 쏜 몬스터에게 얼음 볼트를 되쏜다.
   * 출처: D2MOO SKILLS_EventFunc01_ChillingArmor (missiles.txt ReturnFire 인 미사일만, 볼트 = srvmissilea chillingarmorbolt)
   */
  private chillingArmorReturn(ms: Missile): void {
    const st = this.player.states.get('chillingarmor');
    const s = st?.skill ? this.skillRecord(st.skill.id) : undefined, def = s ? this.data?.missiles.get(s.srvMissileA) : undefined;
    if (!st?.skill || !s || !def || !ms.def.returnFire) return;
    const src = this.monsters.find((m) => m.id === ms.ownerId && m.mode !== 'DT' && m.mode !== 'DD');
    if (src) this.spawnPlayerMissile(def, s, st.skill.lvl, src.x, src.y, undefined, { srcDam: 0, useSkillDamage: true });
  }

  /**
   * 근접 공격받음 이벤트 (auraevent attackedinmelee): Shiver Armor — 공격자에게 냉기 피해.
   * 출처: SKILLS_EventFunc03_ShiverArmor
   */
  private onAttackedInMelee(attacker: MonsterUnit): void {
    const st = this.player.states.get('shiverarmor');
    const s = st?.skill ? this.skillRecord(st.skill.id) : undefined;
    if (!st?.skill || !s) return;
    const el = this.skillElemental(s, st.skill.lvl);
    if (!el) return;
    const d = emptyDamage();
    addElemental(d, el.eType, el.amount, el.len);
    d.hitClass = 0x0d;
    this.damageMonster(attacker, d);
  }

  /**
   * 몬스터 → 플레이어 피해.
   * 출처: SUNITDMG_GetResultFlags — 달리는 플레이어는 항상 맞는다, 명중 후 막기(달리기 1/3) → 회피
   *       SUNITDMG_ApplyDodge — 걷기/달리기 중이면 Evade, 아니면 근접은 Dodge, 미사일은 Avoid
   *       SUNITDMG_ApplyResistancesAndAbsorb — 저항 % (Normal 저항 감소 0), damageresist %, normal_damage_reduction,
   *       냉기 = 느려짐 (속도·공격 −50%, 길이 × (100 − 냉기 저항)/100), 독 = 프레임당 hpregen 감소
   * 근사(원작 미확인): 플레이어 냉기 둔화 50% 고정, 독 길이도 독 저항으로 줄인다
   */
  private hitPlayer(atk: { min: number; max: number; toHit: number }, attackerLevel: number, hitClass: number, missile: boolean, attacker?: MonsterUnit, elem?: DamagePacket & { manaDrain?: number }, alwaysHit = false): void {
    const c = this.character, cs = this.classStats;
    const p = this.player;
    if (!c || !cs || p.mode === 'DT' || p.mode === 'DD') return;
    const running = p.mode === 'RN';
    if (!alwaysHit && !running && !rollPercent(hitChance(atk.toHit, this.playerDefenseValue(), attackerLevel, c.level), this.rng)) {
      this.events.push({ type: 'playerMissed' });
      return;
    }
    const shield = this.equipment.larm ? this.data?.items.base(this.equipment.larm.code) : undefined;
    const dv = this.derived();
    // Holy Shield: toblock 상태 스탯을 방패 막기에 더한다 (출처: skills.txt Holy Shield aurastat1 toblock)
    const block = shield?.block && !alwaysHit ? blockChance((dv?.block ?? shield.block) + this.player.states.stat('toblock'), cs.blockFactor, this.effStat('dex'), c.level, running) : 0;
    if (block > 0 && rollPercent(block, this.rng)) {
      this.events.push({ type: 'playerBlocked' });
      this.playerBlockAnim();
      return;
    }
    const moving = p.mode === 'WL' || p.mode === 'RN';
    // 무기 막기 (어쌔신 Weapon Block): 서 있고 손톱 두 개(무기 클래스 HT2)면 passive_weaponblock % 로 막는다.
    // 출처: D2MOO SUNITDMG_ApplyDodge → SUNITDMG_GetWeaponBlock (손에 든 종류와 맞는 passivestat 값 중 큰 것)
    const wb = moving ? 0 : this.weaponBlockChance();
    if (wb > 0 && this.rng.pick(100) < wb) {
      this.events.push({ type: 'playerBlocked', weapon: true });
      this.playerBlockAnim();
      return;
    }
    const evadeStat = moving ? 'passive_evade' : missile ? 'passive_avoid' : 'passive_dodge';
    const ev = this.playerStat(evadeStat);
    if (ev > 0 && this.rng.pick(100) < ev) {
      this.events.push({ type: 'playerAvoided', how: evadeStat });
      return;
    }
    if (!missile) this.wearArmor();
    let dmg = atk.max > 0 ? rollDamage({ min: atk.min, max: atk.max }, this.rng) : 0;
    // 몬스터 치명타: monstats Crit % 로 모든 피해 ×2. 출처: D2GAME_MONSTER_ApplyCriticalDamage_6FC62E70
    let crit = 1;
    if (attacker && !missile && attacker.type.crit && (attacker.rng.roll() >>> 0) % 100 < attacker.type.crit) crit = 2;
    dmg *= crit;
    // Energy Shield: 저항 적용 전 피해 칸(물리·화염·번개·냉기·마법)마다 흡수 (출처: SUNITDMG_CalculateTotalDamage — UNITEVENT_ABSORBDAMAGE 가 저항 루프보다 먼저)
    const es = this.energyShield([dmg * 256, (elem?.fire ?? 0) * crit, (elem?.ltng ?? 0) * crit, (elem?.cold ?? 0) * crit, (elem?.mag ?? 0) * crit]);
    if (es) {
      dmg = (es[0] ?? 0) / 256;
      if (elem) elem = { ...elem, fire: (es[1] ?? 0) / crit, ltng: (es[2] ?? 0) / crit, cold: (es[3] ?? 0) / crit, mag: (es[4] ?? 0) / crit };
    }
    // Cyclone Armor: 화염·냉기·번개를 흡수량(bonearmor, 1/256)이 남는 동안 이 순서로 흡수, 다 쓰면 상태가 풀린다.
    // 출처: D2GAME_EventFunc25_6FD00140 (auraevent absorbdamage, 저항 전 UNITEVENT_ABSORBDAMAGE)
    const ca = this.player.states.get('cyclonearmor');
    if (ca && elem) {
      let left = ca.stats.bonearmor ?? 0;
      const take = (v: number) => {
        const a = Math.min(Math.max(0, v) * crit, left);
        left -= a;
        return Math.max(0, v - a / crit);
      };
      elem = { ...elem, fire: take(elem.fire), cold: take(elem.cold), ltng: take(elem.ltng) };
      ca.stats.bonearmor = left;
      if (left <= 0) this.player.states.remove('cyclonearmor');
    }
    // 물리: normal_damage_reduction 을 먼저 빼고 damageresist % (최대 50, Amplify Damage −100).
    // 원소: magic_damage_reduction 을 먼저 빼고 저항 % → % 흡수(최대 40) → 고정 흡수, 흡수량은 생명으로.
    // 출처: D2MOO SUNITDMG_ApplyResistancesAndAbsorb (sgDamageStatTable: 화염·번개·냉기·마법 = DAMAGE_REDUCTION_MAGICAL), ExecuteEvents dwAbsLife
    const dr = (dv?.stat('damageresist') ?? 0) + this.player.states.stat('damageresist');
    dmg = Math.max(0, dmg - (dv?.stat('normal_damage_reduction') ?? 0));
    if (dr) dmg = Math.max(0, dmg - (dmg * Math.max(-100, Math.min(dr, 50))) / 100);
    // Bone Armor: 근접 물리 피해를 흡수량(bonearmor, 1/256)이 남는 동안 흡수 (auraevent absorbdamage, EventFunc22)
    const ba = missile ? undefined : this.player.states.get('bonearmor');
    if (ba && (ba.stats.bonearmor ?? 0) > 0 && dmg > 0) {
      const absorb = Math.min(dmg * 256, ba.stats.bonearmor ?? 0);
      ba.stats.bonearmor = (ba.stats.bonearmor ?? 0) - absorb;
      dmg -= absorb / 256;
      if ((ba.stats.bonearmor ?? 0) <= 0) this.player.states.remove('bonearmor');
    }
    let elemental = 0, absLife = 0;
    if (elem) {
      // Natural Resistance(패시브)·Salvation(상태) 저항 포함
      // 상태 저항·최대 저항(해독·해동 물약 maxpoisonresist·maxcoldresist) 포함, 최대 75 + 최대 저항 증가 (절대 상한 95)
      const res = (_k: 'fi' | 'co' | 'li' | 'po' | 'ma', st: 'fireresist' | 'coldresist' | 'lightresist' | 'poisonresist' | 'magicresist') => this.playerResist(st);
      const cut = (v: number, r: number) => (v > 0 ? Math.trunc((v * (100 - Math.max(-100, r))) / 100) : 0);
      const mdr = (dv?.stat('magic_damage_reduction') ?? 0) * 256;
      const absorbed = (v: number, pctStat: string, flatStat: string) => {
        if (v <= 0) return 0;
        const pct = Math.min(dv?.stat(pctStat) ?? 0, 40);
        const a = pct > 0 ? Math.trunc((v * pct) / 100) : 0;
        v -= a;
        const b = Math.min(Math.max(0, (dv?.stat(flatStat) ?? 0) * 256), v);
        absLife += a + b;
        return v - b;
      };
      const elemPart = (v: number, k: 'fi' | 'co' | 'li' | 'ma', st: 'fireresist' | 'coldresist' | 'lightresist' | 'magicresist', pctStat: string, flatStat: string) =>
        absorbed(cut(Math.max(0, v * crit - mdr), res(k, st)), pctStat, flatStat);
      const fire = elemPart(elem.fire, 'fi', 'fireresist', 'item_absorbfire_percent', 'item_absorbfire');
      const ltng = elemPart(elem.ltng, 'li', 'lightresist', 'item_absorblight_percent', 'item_absorblight');
      const cold = elemPart(elem.cold, 'co', 'coldresist', 'item_absorbcold_percent', 'item_absorbcold');
      const mag = elemPart(elem.mag, 'ma', 'magicresist', 'item_absorbmagic_percent', 'item_absorbmagic');
      elemental = (fire + ltng + cold + mag + elem.phys) / 256;
      // 얼지 않음 / 빙결 절반 (출처: SUNITDMG_CalculateTotalDamage — STAT_ITEM_CANNOTBEFROZEN / HALFFREEZEDURATION)
      const coldLen = this.playerFreezeLen(cut(elem.coldLen, res('co', 'coldresist')));
      if (cold > 0 && coldLen > 0) this.player.states.set('cold', this.tickCount + coldLen, { velocitypercent: -50, attackrate: -50, other_animrate: -50 });
      const pois = cut(elem.pois * crit, res('po', 'poisonresist')), poisLen = cut(elem.poisLen, res('po', 'poisonresist'));
      if (pois > 0 && poisLen > 0) {
        const cur = this.player.states.get('poison');
        if (!cur || -(cur.stats.hpregen ?? 0) <= pois) this.player.states.set('poison', this.tickCount + poisLen, { hpregen: -pois });
      }
      if (elem.manaDrain) c.mana = Math.max(0, c.mana - elem.manaDrain / 256);
    }
    // 흡수한 피해만큼 생명 회복 (피해보다 먼저). 출처: SUNITDMG_ExecuteEvents dwAbsLife
    if (absLife > 0) c.life = Math.min(this.maxLife(), c.life + absLife / 256);
    const total = dmg + elemental;
    c.life = Math.max(0, c.life - total);
    this.events.push({ type: 'playerHit', damage: total, ...(elemental ? { elemental } : {}), ...(absLife ? { absorbed: absLife / 256 } : {}) });
    // 받은 피해의 % 를 마나로 (근접·미사일, 저항·흡수 뒤 합계). 출처: SKILLITEM_EventFunc13 (damagedinmelee / damagedbymissile)
    const toMana = dv?.stat('item_damagetomana') ?? 0;
    if (toMana > 0 && total > 0 && c.mana < this.maxMana()) c.mana = Math.min(this.maxMana(), c.mana + (total * toMana) / 100);
    if (!missile && attacker && dmg > 0) {
      this.onDamagedInMelee(attacker, dmg);
      this.ironMaiden(attacker, dmg);
    }
    // 근접으로 맞으면 공격자가 피해 (물리·번개, 고정값 — 공격자 저항 적용). 출처: SKILLITEM_EventFunc06 / EventFunc10 (damagedinmelee)
    if (!missile && attacker) this.attackerTakesDamage(attacker);
    if (attacker && total > 0) this.onMonsterHitPlayer(attacker);
    if (attacker) this.lastAttackerId = attacker.id;
    if (c.life <= 0) {
      this.playerDie();
      return;
    }
    // 피격 사건 (damagedinmelee / damagedbymissile, GETHIT 결과): 공격자에게 (출처: SKILLITEM_EventFunc21)
    if (total > 0) this.procItemSkills('item_skillongethit', attacker, attacker ?? p);
    // 출처: Maxroll — Breakpoints & Animations: 최대 생명의 1/12 이상 피해 시 피격 경직 (공격·시전 중에는 무시)
    // 피격 애니 속도 50 + EFHR %. 출처: D2MOO Units.cpp:1540 (item_fastergethitrate)
    if (total * 12 >= this.maxLife() && !p.cast) {
      p.path = [];
      this.setPlayerMode('GH', 50 + effectiveRate(dv?.stat('item_fastergethitrate') ?? 0));
    }
    void hitClass;
  }

  /**
   * 플레이어 저항 = 장비 + 상태(신전·물약·Salvation·패시브), 상한 = 75 + 장비·상태 max<원소>resist (최대 95).
   * 출처: The Arreat Summit — Resistances (최대 75 %, 최대 저항 증가), misc.txt 해독·해동 물약 maxpoisonresist/maxcoldresist
   */
  playerResist(st: 'fireresist' | 'coldresist' | 'lightresist' | 'poisonresist' | 'magicresist'): number {
    const dv = this.derived();
    const maxSt = 'max' + st;
    const raw = (dv?.stat(st) ?? 0) + this.playerStat(st);
    const cap = 75 + (dv?.stat(maxSt) ?? 0) + this.playerStat(maxSt);
    // Phase 8: 클래식 난이도 저항 페널티 (마법 저항 제외 — 원작도 DAMAGERESIST·MAGICRESIST 는 빼지 않는다). 출처: SUnitDmg.cpp
    return applyResistPenalty(raw, Math.min(95, cap), st === 'magicresist' ? 0 : this.rules.playerResistPenalty);
  }

  /** 막기 애니: 속도 50 (Holy Shield 100) + EFBR %. 출처: D2MOO Units.cpp 막기 애니 속도 (item_fasterblockrate) */
  private playerBlockAnim(): void {
    const p = this.player;
    if (p.cast) return;
    p.path = [];
    this.setPlayerMode('BL', (p.states.has('holyshield') ? 100 : 50) + effectiveRate(this.derived()?.stat('item_fasterblockrate') ?? 0));
  }

  /** 무기 막기 확률: 손톱 두 개(HT2)일 때 passive_weaponblock (패시브 itype 이 손에 든 무기와 맞는 값 중 최대) */
  private weaponBlockChance(): number {
    const items = this.data?.items;
    if (!items || this.weaponWclass() !== 'HT2') return 0;
    const hands = [this.equipment.rarm, this.equipment.larm].map((it) => (it ? items.base(it.code) : undefined));
    let best = 0;
    for (const ps of this.passives()) {
      if (ps.stat !== 'passive_weaponblock') continue;
      if (ps.itype && !hands.some((b) => b && items.isType(b, ps.itype as string))) continue;
      best = Math.max(best, ps.value);
    }
    return best;
  }

  /** 얼지 않음(0) · 빙결 절반(/2) — 냉기·빙결 길이 (출처: SUNITDMG_CalculateTotalDamage) */
  private playerFreezeLen(len: number): number {
    const dv = this.derived();
    if (len <= 0 || !dv) return len;
    if (dv.stat('item_cannotbefrozen') > 0) return 0;
    return dv.stat('item_halffreezeduration') > 0 ? len >> 1 : len;
  }

  /** 근접 공격자가 받는 피해: item_attackertakesdamage (물리) · item_attackertakeslightdamage (번개), 값 << 8. 출처: SKILLITEM_EventFunc06 / 10 */
  private attackerTakesDamage(attacker: MonsterUnit): void {
    const dv = this.derived();
    if (!dv || attacker.mode === 'DT' || attacker.mode === 'DD') return;
    const phys = dv.stat('item_attackertakesdamage'), ltng = dv.stat('item_attackertakeslightdamage');
    if (phys <= 0 && ltng <= 0) return;
    const d = emptyDamage();
    d.phys = Math.max(0, phys) * 256;
    d.ltng = Math.max(0, ltng) * 256;
    d.hitClass = 0x8d;
    this.damageMonster(attacker, d, 'player');
  }

  /**
   * Energy Shield: 피해 칸(1/256)마다 calc1 % 를 마나로 흡수 (마나 = 흡수 × calc2 / 16), 마나가 다하면 상태 해제. 상태가 없으면 null.
   * 출처: D2MOO SKILLS_EventFunc24_EnergyShield (auraevent absorbdamage)
   */
  private energyShield(parts: number[]): number[] | null {
    const st = this.player.states.get('energyshield'), c = this.character;
    const s = st?.skill ? this.skillRecord(st.skill.id) : undefined, calc = this.data?.skillCalc;
    if (!st?.skill || !s || !calc || !c || !parts.some((v) => v > 0)) return null;
    const o = this.owner();
    const r = energyShieldAbsorb(parts, Math.floor(c.mana * 256), calc.calc(s, 1, st.skill.lvl, o), calc.calc(s, 2, st.skill.lvl, o));
    c.mana = r.mana / 256;
    if (r.mana <= 0) this.player.states.remove('energyshield');
    if (r.absorbed > 0) this.events.push({ type: 'energyShield', absorbed: r.absorbed / 256 });
    return r.left;
  }

  /**
   * 보스 수식어의 적중 효과 (MonUMod 표 3번 칸). 출처: MONSTERUNIQUE_CastAmplifyDamage (Cursed: rand & 3 ≥ 1 이면 레벨 mlvl/5+1 Amplify Damage)
   */
  private onMonsterHitPlayer(m: MonsterUnit): void {
    if (!m.umods.includes(UMOD.CURSE) || !(m.flags & MONFLAG.UNIQUE)) return;
    if (((m.rng.roll() >>> 0) & 3) < 1) return;
    const s = this.data?.skills?.byNameOf('Amplify Damage'), calc = this.data?.skillCalc;
    if (!s || !calc) return;
    const lvl = Math.max(1, Math.trunc(m.stats.level / 5) + 1);
    const len = calc.eval(s, s.auraLenCalc, lvl, this.owner()) || 200;
    const stats: Record<string, number> = {};
    for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, this.owner());
    if (!('damageresist' in stats)) stats.damageresist = -100;
    this.player.states.set('amplifydamage', this.tickCount + len, stats);
    this.events.push({ type: 'playerCursed', curse: 'amplifydamage', by: m.id });
  }

  /** 플레이어에게 직접 피해 (폭발 등, 명중 판정 없음) */
  private damagePlayerDirect(pkt: DamagePacket, source: string): void {
    this.hitPlayer({ min: 0, max: 0, toHit: 0 }, 1, 0, true, undefined, pkt, true);
    void source;
  }

  // ---------------------------------------------------------------- 내구도

  /**
   * 내구도 1 감소 판정: 방어구 10%, 무기 4%, 클래식 투척 무기는 닳지 않는다. 0 이 되면 부서짐(스탯 미적용).
   * 출처: D2MOO ITEMS/Items.cpp ITEMS_UpdateDurability (nChance 4 / 10, bExpansion 아니면 투척 무기 return)
   */
  private wearItem(it: ItemInstance): void {
    const items = this.data?.items;
    const b = items?.base(it.code);
    if (!items || !b || b.noDurability || !b.durability || it.maxDurability <= 0 || it.durability <= 0) return;
    const armor = items.isType(b, 'armo'), weapon = items.isType(b, 'weap');
    if (!armor && !weapon) return;
    if (!armor && items.types.get(b.type)?.throwable) return;
    if (this.rng.pick(100) >= (armor ? 10 : 4)) return;
    it.durability--;
    if (it.durability <= 0) {
      it.durability = 0;
      this.statsDirty = true;
      this.events.push({ type: 'itemBroken', itemId: it.id, code: it.code });
    }
  }

  /** 근접 공격 성공 시 무기 (출처: SUNITDMG_DrainItemDurability — 공격자가 플레이어면 무기) */
  private wearWeapon(): void {
    const items = this.data?.items;
    if (!items) return;
    const w = [this.equipment.rarm, this.equipment.larm].find((it) => { const b = it && items.base(it.code); return !!b && items.isType(b, 'weap'); });
    if (w) this.wearItem(w);
  }

  /**
   * 근접 공격을 맞으면 방어구 하나: 부위 가중치 머리 3 · 몸통 5 · 오른손 4 · 왼손 4 · 벨트 2 · 신발 2 · 장갑 2,
   * 임의 시작 부위에서 가중치를 빼 나가며 고른다.
   * 출처: SUNITDMG_DrainItemDurability sgDurabilityLossWeights
   */
  private wearArmor(): void {
    const items = this.data?.items;
    if (!items) return;
    const W: [keyof typeof this.store.equipment, number][] = [['head', 3], ['tors', 5], ['rarm', 4], ['larm', 4], ['belt', 2], ['feet', 2], ['glov', 2]];
    const slots = W.map(([slot]) => {
      const it = this.equipment[slot];
      const b = it && items.base(it.code);
      return b && items.isType(b, 'armo') ? it : undefined;
    });
    const total = W.reduce((a, [, w], i) => a + (slots[i] ? w : 0), 0);
    if (total <= 0) return;
    let i = this.rng.pick(W.length);
    let weight = this.rng.pick(total);
    for (;;) {
      const it = slots[i];
      if (it) {
        const w = (W[i] as [string, number])[1];
        if (weight < w) {
          this.wearItem(it);
          return;
        }
        weight -= w;
      }
      i = (i + 1) % W.length;
    }
  }

  // ---------------------------------------------------------------- 소환수

  /**
   * 소환: 펫 레벨 = 스킬레벨 + 3 × 캐릭터레벨 / 4 (캐릭터 레벨 이하), MonLvl AC·TH 추가,
   * 스킬 passivestat·aurastat 보너스, 최대 생명 × (100 + calc1)%. 같은 종류가 petmax 를 넘으면 가장 오래된 것이 사라진다.
   * 출처: D2MOO D2GAME_SKILLS_SetSummonBaseStats / D2GAME_SetSummonPassiveStats / D2GAME_SummonPet (sub_6FC7D7A0)
   */
  private summonPet(s: SkillRecord, lvl: number, typeId: string, x: number, y: number, petType: string, extra: Partial<PetInfo> = {}, opt: SummonOpts = {}): MonsterUnit | null {
    const data = this.data, calc = data?.skillCalc, c = this.character;
    // skills.txt summon 은 대소문자가 monstats Id 와 다를 수 있다 (ClayGolem ↔ claygolem)
    const key = data ? [...data.monsters.types.keys()].find((k) => k.toLowerCase() === typeId.toLowerCase()) : undefined;
    if (!data || !calc || !c || !key) return null;
    const o = this.owner();
    const spot = opt.exact ? (this.map.walkable(Math.floor(x), Math.floor(y)) ? { x: Math.floor(x), y: Math.floor(y) } : null) : nearestWalkable(this.map, { x, y }, 5);
    if (!spot) return null;
    const type = data.monsters.get(key);
    // 출처: D2GAME_SKILLS_SetSummonBaseStats — 레벨 인자가 있으면 그 레벨 (Dopplezon = 캐릭터 레벨, Revive = 시체 레벨)
    const petLvl = opt.level ?? Math.max(1, Math.min(c.level, lvl + Math.trunc((3 * c.level) / 4)));
    const rng = new Rng(Number(this.rng.next() & 0xffffffffn) || 1);
    const stats = rollMonsterStats(data.monsters, type, rng, petLvl);
    if (opt.hpBase !== undefined) stats.maxHp = Math.max(1, opt.hpBase);
    stats.defense += data.monsters.levelBase(petLvl, 'AC');
    stats.a1.toHit += data.monsters.levelBase(petLvl, 'TH');
    stats.a2.toHit += data.monsters.levelBase(petLvl, 'TH');
    // monstats SkillDamage: 피해 = 주인의 그 스킬 물리 피해, 명중 + 그 스킬 ToHit (출처: sub_6FD14D20 — D2MonSkillInfoStrc)
    // 근사(원작 미확인): 원작 nToHit 이 몬스터 명중을 대신하는지 더하는지 — 여기서는 더한다
    const dmgSkill = type.skillDamage ? data.skills?.byNameOf(type.skillDamage) : undefined;
    if (dmgSkill) {
      const sl = this.skillLevel(dmgSkill);
      for (const a of [stats.a1, stats.a2]) {
        a.min = calc.minPhys256(dmgSkill, sl, o) >> 8;
        a.max = calc.maxPhys256(dmgSkill, sl, o) >> 8;
        a.toHit += calc.toHit(dmgSkill, sl, o);
      }
    }
    const info: PetInfo = { skillId: s.id, petType, expires: Infinity, missileLvl: 0, damagePct: 0, normalDamage: 0, slowPct: 0, ...extra };
    const res = { dm: 0, ma: 0, fi: 0, li: 0, co: 0, po: 0 };
    const pv: Record<string, number> = {};
    const bonus = (stat: string, v: number) => {
      if (stat === 'maxhp') stats.maxHp += v / 256;
      else if (stat === 'item_normaldamage') info.normalDamage += v;
      else if (stat === 'damagepercent') info.damagePct += v;
      else if (stat === 'tohit') {
        stats.a1.toHit += v;
        stats.a2.toHit += v;
      } else if (stat === 'armorclass') stats.defense += v;
      else if (stat === 'item_slow') info.slowPct += v;
      else if (stat === 'item_armor_percent') stats.defense += Math.trunc((stats.defense * v) / 100);
      else if (stat === 'velocitypercent') pv.velocitypercent = (pv.velocitypercent ?? 0) + v;
      else if (RESIST_STAT[stat]) res[RESIST_STAT[stat] as keyof MonsterUnit['resist']] += v;
    };
    if (!opt.noBonus) {
      for (const ps of s.passiveStats) bonus(ps.stat, calc.eval(s, ps.calc, lvl, o));
      for (const a of s.auraStats) bonus(a.stat, calc.eval(s, a.calc, lvl, o));
      stats.maxHp += Math.trunc((stats.maxHp * calc.calc(s, 1, lvl, o)) / 100);
    }
    const id = this.nextUnitId++;
    const pet: MonsterUnit = { ...this.newMonsterUnit(id, type, stats, rng, spot.x + 0.5, spot.y + 0.5), corpseUsed: true, pet: info };
    for (const k of Object.keys(res) as (keyof typeof res)[]) pet.resist[k] += res[k];
    // Summon Resist: 소환수 화염·번개·냉기·독 저항 + passive_summon_resist (출처: D2GAME_SetSummonResistance_6FD0C2E0)
    const sr = passiveStat(this.passives(), 'passive_summon_resist');
    if (sr && petType !== 'none') for (const k of ['fi', 'li', 'co', 'po'] as const) pet.resist[k] += sr;
    if (Object.keys(pv).length) pet.states.set('summonbonus', Infinity, pv);
    // Fire Golem: 소환수 스킬 Holy Fire 오라 (sumskill1 / sumsk1calc)
    const aura = s.sumSkill1 ? data.skills?.byNameOf(s.sumSkill1) : undefined;
    if (aura?.aura) this.petAura.set(id, { skill: aura, lvl: Math.max(1, calc.eval(s, s.sumSk1Calc, lvl, o)), next: this.tickCount + 1 });
    const max = this.petMax(s, lvl);
    // 같은 pettype 끼리 petmax (함정 5종·Blade Sentinel 은 assassintrap 하나로 5개). 출처: D2GAME_SummonPet_6FD14430 → sub_6FC7D7A0(pettype, petmax)
    const same = this.pets.filter((x) => (petType ? x.pet?.petType === petType : x.pet?.skillId === s.id) && x.mode !== 'DT' && x.mode !== 'DD');
    while (same.length >= max && petType !== 'none') {
      const old = same.shift() as MonsterUnit;
      this.pets.splice(this.pets.indexOf(old), 1);
    }
    this.pets.push(pet);
    this.events.push({ type: 'petSummoned', skill: s.id, typeId, petId: id });
    return pet;
  }

  private petMax(s: SkillRecord, lvl: number): number {
    const row = s.petMax;
    const calc = this.data?.skillCalc;
    return row && calc ? Math.max(1, calc.eval(s, row, lvl, this.owner())) : 1;
  }

  private warpPet(pet: MonsterUnit): void {
    const spot = nearestWalkable(this.map, { x: this.player.x + 1, y: this.player.y + 1 }, 6);
    if (!spot) return;
    pet.x = spot.x + 0.5;
    pet.y = spot.y + 0.5;
    pet.path = [];
    if (pet.mode === 'WL' || pet.mode === 'RN') pet.mode = 'NU';
  }

  /** 소환수 피해·사망 (시체는 남기지 않는다) */
  private damagePet(pet: MonsterUnit, raw: DamagePacket): void {
    if (pet.mode === 'DT' || pet.mode === 'DD') return;
    const d = applyMonsterResists(raw, this.monsterResists(pet));
    pet.hp -= totalDamage(d) / 256;
    if (pet.hp <= 0) {
      pet.hp = 0;
      pet.path = [];
      this.startMonsterMode(pet, 'DT');
      this.events.push({ type: 'petDied', petId: pet.id });
      // 용병: 기록은 남고 Kashya 에게서 부활 (출처: D2GAME_NPC_ResurrectMerc — 죽은 용병 sub_6FC7E8B0(…, 7, 1))
      if (pet.pet?.hireling && this.merc?.unitId === pet.id) {
        this.merc.dead = true;
        this.merc.unitId = null;
        this.events.push({ type: 'mercDied' });
      }
    }
  }

  /**
   * 소환수 AI: 주인에게서 멀면 따라가고(25 넘으면 곁으로 이동), 가까운 적(12 이내)을 공격, 없으면 주인 곁에서 대기.
   * 원거리(스켈레톤 메이지)는 10 이내 적에게 미사일.
   * 근사(원작 미확인): 원작 NecroPet AI(AITHINK_Fn_NecroPet)의 세부 거리·확률 대신 위 규칙
   */
  private updatePets(): void {
    const p = this.player;
    for (let i = this.pets.length - 1; i >= 0; i--) {
      const pet = this.pets[i] as MonsterUnit;
      const info = pet.pet as PetInfo;
      if (pet.mode === 'DD' || this.tickCount >= info.expires) {
        this.pets.splice(i, 1);
        this.petRoll.delete(pet.id);
        this.petAura.delete(pet.id);
        continue;
      }
      if (pet.mode === 'DT') {
        if (this.tickCount >= pet.modeEnd) pet.mode = 'DD';
        continue;
      }
      if (info.petType === 'none' || info.petType === 'dopplezon') continue; // 뼈벽·Decoy(AI Idle): 제자리
      if (info.creeper) {
        this.updateCreeper(pet);
        continue;
      }
      if (info.petType === 'assassintrap') {
        if (this.tickCount >= pet.modeEnd && pet.mode !== 'NU') {
          pet.mode = 'NU';
          pet.modeStart = this.tickCount;
        }
        if (this.tickCount >= pet.nextThink) this.thinkSentry(pet);
        continue;
      }
      if (pet.states.has('freeze') || pet.states.has('stunned')) {
        pet.modeEnd++;
        continue;
      }
      if (info.hireling && this.updateMercAction(pet)) continue;
      if (pet.mode === 'A1' || pet.mode === 'A2' || pet.mode === 'GH' || (info.shadow && pet.mode === 'SC')) {
        if (!pet.hitDone && this.tickCount - pet.modeStart >= pet.hitTick) {
          pet.hitDone = true;
          if (info.hireling) this.mercShoot(pet);
          else this.petAttack(pet);
        }
        if (this.tickCount < pet.modeEnd) continue;
        pet.mode = 'NU';
        pet.modeStart = this.tickCount;
      }
      // 덩굴의 솟아나기·스킬(S1)은 애니메이션이 끝나면 서 있기로
      if (pet.mode === 'S1' && info.vine) {
        if (this.tickCount < pet.modeEnd) continue;
        pet.mode = 'NU';
        pet.modeStart = this.tickCount;
      }
      if (pet.mode === 'WL' || pet.mode === 'RN') {
        if (pet.path.length) {
          this.advance(pet, (pet.moveSpeed * SUBTILES_PER_YARD) / ENGINE_FPS * (100 + pet.states.stat('velocitypercent')) / 100, (d) => (pet.dir = d), pet.type.sizeX);
          continue;
        }
        pet.mode = 'NU';
        pet.modeStart = this.tickCount;
      }
      if (this.tickCount < pet.nextThink) continue;
      if (info.hireling) {
        this.thinkMerc(pet);
        continue;
      }
      if (info.shadow) {
        this.thinkShadow(pet);
        continue;
      }
      pet.nextThink = this.tickCount + Math.max(3, Math.trunc(pet.type.aiDelay / 3));
      if (info.petType === 'raven') {
        this.thinkRaven(pet);
        continue;
      }
      if (info.petType === 'totem') {
        this.thinkTotem(pet);
        continue;
      }
      if (info.petType === 'fenris' && this.fenrisEat(pet)) continue;
      if (info.vine) {
        this.thinkVine(pet);
        continue;
      }
      if (info.petType === 'hydra') {
        // Hydra: 움직이지 않고 사거리 안 적에게 화염 볼트. 근사(원작 미확인): 원작 Hydra AI 의 사거리·간격 대신 거리 15, 공격 애니메이션마다 한 발
        const enemy = this.inTown ? undefined : this.monstersNear(pet.x, pet.y, 15)[0];
        if (enemy) {
          pet.targetId = enemy.id;
          this.startMonsterMode(pet, pet.type.modes.has('A1') ? 'A1' : 'NU');
          pet.dir = dir64(enemy.x - pet.x, enemy.y - pet.y);
        }
        continue;
      }
      const toOwner = Math.hypot(pet.x - p.x, pet.y - p.y);
      if (toOwner > 25) {
        this.warpPet(pet);
        continue;
      }
      const enemy = this.inTown ? undefined : this.monstersNear(pet.x, pet.y, 12).find((m) => Math.hypot(m.x - p.x, m.y - p.y) < 20);
      if (enemy && toOwner < 15) {
        pet.targetId = enemy.id;
        const ranged = !!info.missile;
        if (ranged ? Math.hypot(enemy.x - pet.x, enemy.y - pet.y) <= 10 : isInMeleeRange(pet.x, pet.y, pet.type.sizeX, pet.type.meleeRange, enemy.x, enemy.y, enemy.type.sizeX)) {
          this.startMonsterMode(pet, !ranged && pet.type.modes.has('A2') && pet.rng.pick(2) ? 'A2' : 'A1');
          pet.dir = dir64(enemy.x - pet.x, enemy.y - pet.y);
        } else this.petMoveTo(pet, enemy.x, enemy.y, true);
        continue;
      }
      pet.targetId = undefined;
      if (toOwner > 5) this.petMoveTo(pet, p.x + (pet.rng.pick(5) - 2), p.y + (pet.rng.pick(5) - 2), toOwner > 8);
    }
  }

  /**
   * Raven AI: 공격 횟수를 다 쓰면 죽고, 주인에서 50 넘으면 곁으로, 28 넘으면 달려간다. 다음 공격 프레임이 지났고 aip4 % 이고
   * 대상이 aip5 안이면 근접이면 쪼고(횟수 −1, 다음 공격 = aip3 × 10 프레임 뒤) 아니면 다가간다. 그 밖엔 주인 둘레 aip2~aip1 을 돈다.
   * 출처: AITHINK_Fn107_Raven (RAVEN_AI_PARAM_CIRCLE_OWNER_MAX/MIN_DISTANCE, ATTACK_DELAY, ATTACK_CHANCE_PCT, MAX_TARGET_DISTANCE)
   * 근사(원작 미확인): 주인 둘레를 도는 경로(AITACTICS_WalkAroundTargetWithScaledDistance)는 평균 거리의 무작위 지점으로
   */
  private thinkRaven(pet: MonsterUnit): void {
    const info = pet.pet as PetInfo, p = this.player, ap = pet.type.aiParams;
    if ((info.shots ?? 0) <= 0) {
      pet.hp = 0;
      this.startMonsterMode(pet, 'DT');
      this.events.push({ type: 'petDied', petId: pet.id });
      return;
    }
    const toOwner = Math.hypot(pet.x - p.x, pet.y - p.y);
    if (toOwner > 50) return this.warpPet(pet);
    if (toOwner > 28) return this.petMoveTo(pet, p.x, p.y, true);
    const t = this.inTown ? undefined : this.monstersNear(pet.x, pet.y, ap[4] ?? 35)[0];
    if (t && this.tickCount > (info.nextAttack ?? 0) && pet.rng.pick(100) < (ap[3] ?? 0)) {
      pet.targetId = t.id;
      if (isInMeleeRange(pet.x, pet.y, pet.type.sizeX, pet.type.meleeRange, t.x, t.y, t.type.sizeX, 1)) {
        this.startMonsterMode(pet, 'A1');
        pet.dir = dir64(t.x - pet.x, t.y - pet.y);
        info.nextAttack = this.tickCount + 10 * (ap[2] ?? 0);
        info.shots = (info.shots ?? 0) - 1;
      } else this.petMoveTo(pet, t.x, t.y, true);
      return;
    }
    const lo = ap[1] ?? 6, hi = ap[0] ?? 10;
    if (toOwner < lo || toOwner > hi) {
      const a = pet.rng.pick(64) * (Math.PI / 32), r = (lo + hi) / 2;
      this.petMoveTo(pet, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, false);
    }
  }

  /**
   * 토템 AI: 공격하지 않는다. 주인에서 aip3 넘으면 곁으로 옮겨 가고, aip4 넘으면 주인이 걸을 때 따라간다.
   * 출처: AITHINK_Fn109_Totem (TOTEM_AI_PARAM_TELEPORT_TO_OWNER_DISTANCE, FOLLOW_OWNER_DISTANCE)
   * 근사(원작 미확인): 적에게서 물러나기(WALK_AWAY_CHANCE)는 하지 않는다
   */
  private thinkTotem(pet: MonsterUnit): void {
    const p = this.player, ap = pet.type.aiParams;
    const toOwner = Math.hypot(pet.x - p.x, pet.y - p.y);
    if (toOwner > (ap[2] ?? 30)) return this.warpPet(pet);
    if (toOwner > (ap[3] ?? 20) && (p.mode === 'WL' || p.mode === 'RN' || p.mode === 'TW')) this.petMoveTo(pet, p.x, p.y, p.mode === 'RN');
  }

  /**
   * Fenris: 싸울 적이 없으면 aip3 % 로 근처 시체를 먹고 fenris_rage (피해 +par2 %, par1 프레임). 시체는 사라진다.
   * 출처: AITHINK_Fn108_Fenris (DRUIDWOLF_FENRIS_AI_PARAM_EAT_CORPSE_CHANCE_PCT) → monstats Skill1 'fenris rage' (Do137)
   * 근사(원작 미확인): 시체 찾는 거리 10
   */
  private fenrisEat(pet: MonsterUnit): boolean {
    if (this.inTown || this.monstersNear(pet.x, pet.y, 12).length) return false;
    if (pet.rng.pick(100) >= (pet.type.aiParams[2] ?? 0)) return false;
    const body = this.monsters.find((m) => m.mode === 'DD' && !m.corpseUsed && !m.pet && Math.hypot(m.x - pet.x, m.y - pet.y) <= 10);
    const rage = this.data?.skills?.byNameOf('fenris rage');
    if (!body || !rage) return false;
    body.corpseUsed = true;
    this.monsters.splice(this.monsters.indexOf(body), 1);
    this.spawnVisual(rage.cltMissile[0] ?? 'corpseexplosion', body.x, body.y);
    pet.states.set(rage.auraState, this.tickCount + (rage.params[0] ?? 0), { damagepercent: rage.params[1] ?? 0 });
    this.events.push({ type: 'fenrisRage', petId: pet.id });
    return true;
  }

  /**
   * 덩굴 AI. Plague Poppy(Vines AI): 시야 aip2 안 적에게 aip1 프레임마다 Vine Attack, 이미 중독된 적에게서는 물러난다.
   * Cycle of Life·Vines(CycleOfLife AI): 시야 aip2 안 쓸 수 있는 시체로 가서 주인 생명(마나)이 다 차지 않았으면 aip1 프레임마다 먹는다.
   * 주인에서 aip5 넘으면 곁으로. 출처: AITHINK_Fn110_Vines / AITHINK_Fn111_CycleOfLife
   * 근사(원작 미확인): 물러나기(Escape) 는 하지 않고 제자리에 머문다
   */
  private thinkVine(pet: MonsterUnit): void {
    const info = pet.pet as PetInfo, p = this.player, ap = pet.type.aiParams, c = this.character;
    const vine = info.vine, s = vine ? this.skillRecord(vine.skill) : undefined;
    if (!vine || !s || !c) return;
    const toOwner = Math.hypot(pet.x - p.x, pet.y - p.y);
    if (toOwner >= (ap[4] ?? 35)) return this.warpPet(pet);
    if (this.inTown) return;
    const ready = this.tickCount > (info.nextAttack ?? 0) + (ap[0] ?? 0);
    if (s.srvDoFunc === 130) {
      const t = this.monstersNear(pet.x, pet.y, ap[1] ?? 20).find((m) => !m.states.has('poison'));
      if (!t || !ready) return;
      info.nextAttack = this.tickCount;
      pet.targetId = t.id;
      if (pet.type.modes.has('S1')) this.startMonsterMode(pet, 'S1');
      this.vineAttack(s, vine.lvl, pet, t);
      return;
    }
    // CorpseCycler·VineCycler (St63): 시체 반경 clamp(aurarange, 5, 50)
    const range = Math.min(50, Math.max(5, this.data?.skillCalc?.eval(s, s.auraRangeCalc, vine.lvl, this.owner()) ?? 10));
    const body = this.monsters.find((m) => m.mode === 'DD' && !m.corpseUsed && !m.pet && Math.hypot(m.x - pet.x, m.y - pet.y) <= Math.min(range, ap[1] ?? 20));
    if (!body) return;
    const life = s.srvMissileA === 'recycler delay';
    const need = life ? c.life < this.maxLife() : c.mana < this.maxMana();
    if (!isInMeleeRange(pet.x, pet.y, pet.type.sizeX, Math.max(pet.type.meleeRange, 2), body.x, body.y, body.type.sizeX, 1)) {
      this.petMoveTo(pet, body.x, body.y, false);
      return;
    }
    if (!need || !ready) return;
    info.nextAttack = this.tickCount;
    if (pet.type.modes.has('S1')) this.startMonsterMode(pet, 'S1');
    this.recycleCorpse(s, vine.lvl, body);
  }

  /**
   * Vine Attack: 대상 자리에서 calc1 개의 plague vines 가 네 방향으로 흔들리며 뻗고, Param1 프레임마다 독 덩굴 자취(Plague Poppy 스킬 피해).
   * 출처: SKILLS_SrvDo130_VineAttack (ChargedBolt init, x/yOffsets) → MISSMODE_SrvDo26_Vines_PlagueVines → plague vines trail (SrvHit50: 처음 sHitPar1 프레임만 맞힘)
   */
  private vineAttack(s: SkillRecord, lvl: number, pet: MonsterUnit, t: MonsterUnit): void {
    const data = this.data, calc = data?.skillCalc;
    const def = data?.missiles.get(s.srvMissileA);
    if (!calc || !def) return;
    const n = calc.calc(s, 1, lvl, this.owner());
    const OX = [0, 0, 1, -1], OY = [1, -1, 0, 0];
    for (let i = 0; i < n; i++) {
      const k = i % 4;
      this.spawnPlayerMissile(def, s, lvl, t.x + (OX[k] ?? 0) * 10, t.y + (OY[k] ?? 0) * 10, undefined, { srcDam: 0, useSkillDamage: true, wander: true, from: { x: t.x, y: t.y } });
    }
  }

  /**
   * CorpseCycler·VineCycler: 시체를 먹고(더 쓸 수 없게) recycler delay 미사일 — 남은 프레임이 Param1 이 될 때 주인 생명(마나)을 최대치의 calc1 % 회복.
   * 출처: SKILLS_SrvSt63_Corpse_VineCycler → MISSMODE_SrvDo29_RecyclerDelay / SrvDo33_VineRecyclerDelay
   */
  private recycleCorpse(s: SkillRecord, lvl: number, body: MonsterUnit): void {
    const data = this.data, calc = data?.skillCalc, c = this.character;
    const def = data?.missiles.get(s.srvMissileA);
    if (!calc || !def || !c) return;
    body.corpseUsed = true;
    const pct = calc.calc(s, 1, lvl, this.owner());
    const life = def.srvDoFunc === 29;
    this.missiles.push({
      id: this.nextUnitId++, def, x: body.x, y: body.y, dx: 0, dy: 0, left: def.range, age: 0, owner: 'player', ownerId: this.player.id, ownerLevel: c.level,
      hitClass: 0, hit: new Set(), lvl, skill: s, noCollide: true,
      onTick: (ms) => {
        if (ms.left !== (def.params[0] ?? 0) || this.isDead) return;
        if (life) c.life = Math.min(this.maxLife(), c.life + Math.trunc((this.maxLife() * pct) / 100));
        else c.mana = Math.min(this.maxMana(), c.mana + Math.trunc((this.maxMana() * pct) / 100));
        this.events.push({ type: 'recycled', life, pct });
      },
    });
  }

  private petMoveTo(pet: MonsterUnit, x: number, y: number, run: boolean): void {
    const t = nearestWalkable(this.map, { x, y }, 4);
    const path = t ? findPath(this.map, pet, { x: t.x + 0.5, y: t.y + 0.5 }, 3000) : null;
    if (!path || !path.length) return;
    pet.path = path;
    const mode = run ? 'RN' : 'WL';
    if (pet.mode !== mode) pet.modeStart = this.tickCount;
    pet.mode = mode;
    pet.moveSpeed = run ? pet.type.run : pet.type.velocity;
  }

  /** 소환수 공격 판정: 근접은 명중 굴림 후 물리 (+ item_normaldamage, × damagepercent), 메이지는 원소 미사일 */
  private petAttack(pet: MonsterUnit): void {
    const info = pet.pet as PetInfo;
    const t = pet.targetId !== undefined ? this.monsters.find((m) => m.id === pet.targetId && m.mode !== 'DT' && m.mode !== 'DD') : undefined;
    if (!t) return;
    if (info.shadow) {
      this.shadowEffect(pet, t);
      return;
    }
    if (info.missile) {
      const def = this.data?.missiles.get(info.missile);
      if (!def) return;
      const d = Math.hypot(t.x - pet.x, t.y - pet.y) || 1, sp = missileStep(def.vel);
      const lvl = info.missileLvl;
      const roll = this.petRoll.get(pet.id) ?? (() => {
        const pk = emptyDamage();
        const sh = 2 ** def.hitShift;
        const min = (def.eMin + levelDamageBonus(lvl, def.eMinLev)) * sh, max = (def.eMax + levelDamageBonus(lvl, def.eMaxLev)) * sh;
        const lenLv = lvl <= 8 ? (def.eLevLen[0] ?? 0) * (lvl - 1) : lvl <= 16 ? 7 * (def.eLevLen[0] ?? 0) + (lvl - 8) * (def.eLevLen[1] ?? 0) : 7 * (def.eLevLen[0] ?? 0) + 8 * (def.eLevLen[1] ?? 0) + (lvl - 16) * (def.eLevLen[2] ?? 0);
        addElemental(pk, def.eType, min + (max > min ? pet.rng.pick(max - min) : 0), def.eLen + lenLv);
        return pk;
      });
      this.missiles.push({
        id: this.nextUnitId++, def, x: pet.x, y: pet.y, dx: ((t.x - pet.x) / d) * sp, dy: ((t.y - pet.y) / d) * sp, left: def.range, age: 0,
        owner: 'player', ownerId: pet.id, ownerLevel: pet.stats.level, hitClass: def.hitClass || 0x0d, roll, hit: new Set(), lvl,
      });
      return;
    }
    if (!isInMeleeRange(pet.x, pet.y, pet.type.sizeX, pet.type.meleeRange, t.x, t.y, t.type.sizeX, 1)) return;
    const atk = pet.mode === 'A2' ? pet.stats.a2 : pet.stats.a1;
    if (!rollPercent(hitChance(atk.toHit, this.monsterDefense(t, false), pet.stats.level, t.stats.level), pet.rng)) return;
    const d = emptyDamage();
    const base = rollDamage({ min: atk.min + info.normalDamage, max: atk.max + info.normalDamage }, pet.rng);
    // Grizzly: aip3 % 로 BearSmite (피해 +calc1 %, 기절 ln12). 출처: AITHINK_Fn112_DruidBear → monstats Skill1 BearSmite (St32/Do2)
    // 근사(원작 미확인): BearSmite 기절 길이를 calc2 max(250, ln12) 대신 ln12 (par1 + (lvl−1)·par2) 로
    let smite = 0;
    if (info.petType === 'grizzly' && pet.rng.pick(100) < (pet.type.aiParams[2] ?? 0)) {
      const bs = this.data?.skills?.byNameOf(pet.type.skills[0]?.name ?? '');
      const own: SkillOwner = { baseLevel: () => 1, skillLevel: () => 1, unitLevel: pet.stats.level };
      if (bs && this.data?.skillCalc) {
        smite = this.data.skillCalc.calc(bs, 1, 1, own);
        d.stunLen = linearPct(bs.params[0] ?? 0, bs.params[1] ?? 0, 1);
      }
    }
    d.phys = Math.trunc((base * 256 * (100 + info.damagePct + smite + pet.states.stat('damagepercent'))) / 100);
    d.hitClass = pet.type.hitClass;
    this.damageMonster(t, d, 'pet');
    // Clay Golem: 맞은 적 감속 (item_slow). 근사(원작 미확인): 지속 50 프레임
    if (info.slowPct > 0 && t.mode !== 'DT') t.states.set('slowed', this.tickCount + 50, { velocitypercent: -info.slowPct });
  }

  // ---------------------------------------------------------------- 마을 NPC

  /**
   * 마을 NPC·장식 유닛 배치 (공격 불가). interact NPC 는 Npc AI, 나머지(Rogue 경비·닭·소)는 제자리.
   * 출처: D2GAME_SpawnPresetMonster (DS1 프리셋 → monstats), AITHINK_Fn032_Npc 첫 판단 (원위치 기록 후 20 프레임 대기),
   *       MONSTERAI_AllocMonsterInteract (monstats interact)
   * 근사(원작 미확인): NPC 레이어 외형은 monstats2 첫 변형
   */
  spawnNpc(typeId: string, x: number, y: number, path: NpcPathNode[] = []): MonsterUnit | null {
    const data = this.data;
    if (!data?.monsters.types.has(typeId)) return null;
    const type = data.monsters.get(typeId);
    const spot = this.map.walkable(Math.floor(x), Math.floor(y)) ? { x: Math.floor(x), y: Math.floor(y) } : nearestWalkable(this.map, { x, y }, 6);
    if (!spot) return null;
    const rng = new Rng(this.npcRng.roll() || 1);
    const stats = rollMonsterStats(data.monsters, type, rng);
    const m = this.newMonsterUnit(this.nextUnitId++, type, stats, rng, spot.x + 0.5, spot.y + 0.5);
    m.components = Object.fromEntries(Object.keys(type.layers).map((k) => [k, 0]));
    m.levelKey = this.level.def.id;
    m.nextThink = this.tickCount + 20;
    m.noXp = true;
    m.noTc = true;
    m.npc = { home: { x: m.x, y: m.y }, interact: type.interact && type.npc, talking: false, greet: 0, path };
    this.level.npcs.push(m);
    return m;
  }

  /**
   * Cain 구출 뒤 마을의 Cain (MONSTER_CAIN5).
   * 근사(원작 미확인): 원작은 A1Q4 퀘스트 코드가 정한 자리(마을 포털로 들어옴) — 여기서는 마을 포털 자리 옆
   */
  private spawnCain(): void {
    // Act 2~4 마을 Cain(CAIN2~4)은 마을 DS1 프리셋 — CAIN5 는 Act 1 마을에만
    if (this.act !== 0) return;
    const town = this.levels.get(this.townKey() ?? '');
    if (!town || town.npcs.some((n) => n.type.id === 'cain5')) return;
    const prev = this.level;
    this.level = town;
    const at = town.def.portalSpot ?? { x: town.def.map.width / 2, y: town.def.map.height / 2 };
    this.spawnNpc('cain5', at.x + 4, at.y + 4);
    this.level = prev;
  }

  /**
   * 퀘스트가 자리를 정하는 마을 NPC (DS1 프리셋이 아니라 오브젝트 InitFn 이 만든다). 다시 부르면 자리를 고친다 (Phase 7 퀘스트 훅).
   * 출처: Quests.cpp OBJECTS_InitFunction18_JerhynPosition (오브젝트 121) → ACT2Q4_InitializeJerhynStartObject — A2Q0·A2Q4 PRIMARYGOALDONE 이 아니면 시작 자리에 Jerhyn,
   *       OBJECTS_InitFunction19_JerhynPositionEx (오브젝트 122) → ACT2Q4_InitializeJerhynPalaceObject — A2Q6 PRIMARYGOALDONE 전이면 (x+1, y) 에 Kaelan(ACT2GUARD2), 그 밖엔 궁전 자리에 Jerhyn,
   *       A3Q0.cpp OBJECTS_InitFunction49_HratliStart (378) / 50_HratliEnd (379) — A3Q0 PRIMARYGOALDONE 이면 끝 자리, 아니면 시작 자리에 Hratli
   * 근사(원작 미확인): 원작은 게임 전역 퀘스트 상태(pQuestFlags)와 A2Q6 bNotIntro·fState 로 판단 — 여기서는 플레이어 퀘스트 기록(보상 받음·주 목표 완료)으로
   */
  refreshTownQuestNpcs(level: LevelState = this.level): void {
    if (!level.def.inTown || !level.populated) return;
    const rec = this.questRecord;
    const done = (q: number) => rec.get(q, QFLAG.PRIMARYGOALDONE) || rec.get(q, QFLAG.REWARDGRANTED);
    const at = (cls: number) => level.objects.find((o) => o.type.id === cls);
    const want: { id: string; o: { x: number; y: number } | undefined; dx?: number }[] = [];
    if (level.def.levelNo === 40) {
      const start = at(121), palace = at(122);
      want.push({ id: 'jerhyn', o: !done(QUESTFLAG_A2Q0) && !done(QUESTFLAG_A2Q4) ? start : palace });
      if (!done(QUESTFLAG_A2Q6)) want.push({ id: 'act2guard2', o: palace, dx: 1 });
    } else if (level.def.levelNo === 75) {
      want.push({ id: 'hratli', o: done(QUESTFLAG_A3Q0) ? at(379) : at(378) });
    }
    const prev = this.level;
    this.level = level;
    for (const w of want) {
      const have = level.npcs.find((n) => n.type.id === w.id);
      if (!w.o) continue;
      const tx = w.o.x + (w.dx ?? 0), ty = w.o.y;
      if (have && Math.hypot(have.npc!.home.x - tx, have.npc!.home.y - ty) < 3) continue;
      if (have) {
        if (this.talk?.npcId === have.id) this.closeTalk();
        level.npcs.splice(level.npcs.indexOf(have), 1);
      }
      this.spawnNpc(w.id, tx, ty);
    }
    // Kaelan: A2Q6 이 끝나면 사라진다
    if (level.def.levelNo === 40 && done(QUESTFLAG_A2Q6)) {
      const k = level.npcs.findIndex((n) => n.type.id === 'act2guard2');
      if (k >= 0) level.npcs.splice(k, 1);
    }
    this.level = prev;
  }

  /** 예전 퀘스트 이름 → 기록 비트. 'a1q2' = A1Q2 보상 받음, 'cain' = A1Q4 보상 받음 */
  private legacyQuest(flag: string): void {
    if (flag === 'a1q2') this.questRecord.set(QUEST.BLOODRAVEN, QFLAG.REWARDGRANTED);
    else if (flag === 'cain') this.questRecord.set(QUEST.CAIN, QFLAG.REWARDGRANTED);
  }

  /** 디버그·테스트: 예전 퀘스트 이름으로 보상 받음 표시 ('cain' 이면 마을에 Cain 을 세운다) */
  setQuest(flag: string): void {
    this.legacyQuest(flag);
    if (flag === 'cain') this.quests.forceCainInTown();
    const town = this.levels.get(this.townKey() ?? '');
    if (flag === 'cain' && town?.populated) this.spawnCain();
  }

  /**
   * NPC 기능의 퀘스트 조건. 숫자 = npc.txt questflag (출처: ITEMS_CalculateTransactionCost — REWARDGRANTED 또는 REWARDPENDING),
   * 'a1q2' = Kashya 고용 (출처: SUnitNpc.cpp — A1Q2 REWARDGRANTED), 'cain' = 무료 감정 (D2GAME_NPC_IdentifyAllItems — A1Q4 GRANTED 또는 PENDING)
   */
  questDone(f: number | string): boolean {
    const r = this.questRecord;
    if (typeof f === 'number') return r.get(f, QFLAG.REWARDGRANTED) || r.get(f, QFLAG.REWARDPENDING);
    if (f === 'a1q2') return r.get(QUEST.BLOODRAVEN, QFLAG.REWARDGRANTED);
    if (f === 'a5q2') return r.get(QW.A5Q2, QFLAG.REWARDGRANTED);
    if (f === 'cain') return r.get(QUEST.CAIN, QFLAG.REWARDGRANTED) || r.get(QUEST.CAIN, QFLAG.REWARDPENDING);
    return false;
  }

  /** 지금 레벨의 NPC (읽기 전용) */
  get npcs(): readonly MonsterUnit[] {
    return this.level.npcs;
  }

  /** 대화 중인 NPC */
  private talking(): MonsterUnit | undefined {
    const t = this.talk;
    return t && t.levelId === this.level.def.id ? this.level.npcs.find((n) => n.id === t.npcId) : undefined;
  }

  /**
   * NPC 메뉴 (원작 메뉴 + 용병이 죽었으면 Kashya 에게 부활) + 퀘스트 항목(talk 바로 뒤) + Charsi imbue (A1Q3 REWARDPENDING) + Warriv go east (A1Q6 REWARDGRANTED).
   * 근사(원작 미확인): 퀘스트 항목·imbue·go east 의 메뉴 위치 (원작 D2Client 메뉴 조립)
   */
  npcOptions(n: MonsterUnit): NpcOption[] {
    const def = NPC_DEFS[n.type.id];
    if (!def) return ['talk', 'cancel'];
    const out: NpcOption[] = [];
    const t = this.talk;
    const topics = t && t.npcId === n.id ? this.topicsOf(t.speeches) : [];
    for (const o of def.menu) {
      if (o === 'cancel') {
        if (n.type.id === 'charsi' && this.quests.canImbue()) out.push('imbue');
        // 확장팩: Larzuk 소켓 (A5Q1 REWARDPENDING)
        if (n.type.id === 'larzuk' && this.act5Quests()?.canSocket()) out.push('socket');
        // 확장팩: Anya 이름 새기기 (A5Q4 REWARDPENDING)
        if (n.type.id === 'drehya' && this.act5Quests()?.canPersonalize()) out.push('personalize');
        // 막 이동 (출처: NPC_HandleDialogMessage — WARRIV1 A1Q6 REWARDGRANTED, MESHIF1 A2Q6 REWARDGRANTED, WARRIV2·MESHIF2 조건 없음)
        for (const [opt, tr] of Object.entries(TRAVEL) as [NpcOption, { npc: string; to: number }][]) {
          if (tr.npc === n.type.id && this.canTravelAct(tr.to)) out.push(opt);
        }
        // Tyrael 부활 (고용 목록이 없는 부활 NPC 는 cancel 앞)
        if (def.resurrect && !def.hire && this.merc?.dead) out.push('resurrect');
      }
      out.push(o);
      if (o === 'talk') for (const tp of topics) out.push(tp.option);
      if (o === 'hire' && def.resurrect && this.merc?.dead) out.push('resurrect');
    }
    return out;
  }

  /**
   * 막 이동 조건 (NPC 메뉴·Phase 7 퀘스트가 쓴다).
   * 출처: SUnitNpc.cpp NPC_HandleDialogMessage — Act 1 → 2: A1Q6(Andariel) REWARDGRANTED, Act 2 → 3: A2Q6(Duriel·Jerhyn) REWARDGRANTED,
   *       서쪽(Act 2 → 1, Act 3 → 2)은 조건 없음. Act 3 → 4 는 NPC 가 아니라 증오의 억류지 포털 (A3Q6 Mephisto 처치 — Phase 7)
   */
  canTravelAct(to: number): boolean {
    if (to === this.act + 1) {
      if (this.act === 0) return this.quests.canGoEast();
      if (this.act === 1) return this.questRecord.get(QUESTFLAG_A2Q6, QFLAG.REWARDGRANTED);
      if (this.act === 2) return this.questRecord.get(QUESTFLAG_A3Q6, QFLAG.PRIMARYGOALDONE) || this.questRecord.get(QUESTFLAG_A3Q6, QFLAG.REWARDGRANTED);
      // 출처: NPC_HandleDialogMessage (TYRAEL2) — 확장팩 + A4Q2 REWARDGRANTED
      if (this.act === 3) return this.expansion && this.questRecord.get(QW.A4Q2, QFLAG.REWARDGRANTED);
      return false;
    }
    return to === this.act - 1 && (this.act === 1 || this.act === 2);
  }

  /**
   * 막 이동 (Warriv·Meshif·증오의 억류지 포털). 성공하면 true, 도착 막 월드가 아직 없으면 false (actChange 이벤트 available:false).
   * 출처: SUnitNpc.cpp — D2GAME_PlayerChangeAct(pGame, pPlayer, 도착 마을, nTileInfo), QUESTS_ActChange_HirelingChangeAct (용병도 따라옴),
   *       WAYPOINTS_ActivateWaypoint (동쪽으로 가면 도착 마을 웨이포인트를 켠다)
   * 근사(원작 미확인): 서쪽 이동(nTileInfo 5)의 도착 칸 — 도착 마을의 이동 NPC(Warriv·Meshif) 곁, 없으면 막 시작 위치
   * @param force true 면 조건을 보지 않는다 (Phase 7 퀘스트·디버그: 증오의 억류지 포털 → Act 4)
   */
  travelAct(to: number, force = false): boolean {
    if (!force && !this.canTravelAct(to)) return false;
    const from = this.act;
    const townKey = ACT_TOWN_KEYS[to] ?? '';
    if (!this.changeAct(to, 'town')) {
      this.events.push({ type: 'actChange', to: townKey, act: to, available: false });
      return false;
    }
    // 서쪽으로 왔으면 이동 NPC 곁 (Act 1: warriv1, Act 2: meshif1)
    if (to < from) {
      const via = to === 0 ? 'warriv1' : to === 1 ? 'meshif1' : '';
      const n = this.level.npcs.find((x) => x.type.id === via);
      const spot = n ? nearestWalkable(this.map, { x: n.x + 2, y: n.y + 2 }, 8) : null;
      if (spot) {
        this.player.x = spot.x + 0.5;
        this.player.y = spot.y + 0.5;
        for (const pet of this.pets) this.warpPet(pet);
      }
    } else {
      const wp = this.waypointNoOf(this.level.def.levelNo);
      if (wp !== 255) this.waypoints.activate(wp);
    }
    // 출처: QUESTS_ActChange_HirelingChangeAct (Phase 7: A1COMPLETED·A2COMPLETED)
    this.questControl.actChanged(from, to);
    this.events.push({ type: 'actChange', to: townKey, act: to, available: true });
    return true;
  }

  /** 퀘스트 대사 → 메뉴 항목 (퀘스트마다 하나) */
  private topicsOf(sp: readonly QuestSpeech[]): { option: NpcOption; quest: number; key: string }[] {
    const out: { option: NpcOption; quest: number; key: string }[] = [];
    for (const x of sp) if (!out.some((o) => o.quest === x.quest)) out.push({ option: `quest:${x.quest}:${x.index}`, quest: x.quest, key: x.key });
    return out;
  }

  /** 퀘스트 대사 재생: 클라이언트가 두루마리를 띄우고 문자열 번호를 돌려보낸다 (QUESTS_NPCMessage → ScrollMessage) → 목록 다시 (QUESTS_NPCActivateSpeeches) */
  private playSpeech(n: MonsterUnit, sp: QuestSpeech): void {
    this.events.push({ type: 'questSpeech', npcId: n.id, typeId: n.type.id, quest: sp.quest, index: sp.index, key: sp.key });
    this.questControl.scrollMessage(n.type.id, sp.index);
    const t = this.talk;
    if (t && t.npcId === n.id) {
      // 다시 만든 목록: 방금 재생한 대사는 메뉴 항목으로 남긴다 (원작 nMenu 0 → 2 로 다시 보냄 — 근사)
      const next = this.questControl.npcActivate(n.type.id);
      if (!next.some((x) => x.quest === sp.quest)) next.push({ ...sp, menu: 2 });
      t.speeches = next.map((x) => (x.index === sp.index ? { ...x, menu: 2 as const } : x));
    }
  }

  /** 상점 기능이 쓰는 게임 접근 */
  private tradeHost(): TradeHost {
    // getter/setter 로 게임 값을 그대로 노출 (골드 변경이 곧바로 게임에 반영)
    const g = this;
    return {
      get data() {
        return g.data as GameData;
      },
      store: g.store,
      get gold() {
        return g.gold;
      },
      set gold(v: number) {
        g.gold = v;
      },
      get stashGold() {
        return g.stashGold;
      },
      set stashGold(v: number) {
        g.stashGold = v;
      },
      get playerLevel() {
        return g.character?.level ?? 1;
      },
      get reducePct() {
        return g.derived()?.stat('item_reducedprices') ?? 0;
      },
      difficulty: g.difficulty,
      questDone: (f) => g.questDone(f),
      emit: (ev) => g.events.push(ev),
      itemsChanged: () => {
        g.statsDirty = true;
      },
    };
  }

  /** NPC 까지 걸어가서 말 걸기. 근사(원작 미확인): 대화 거리 = 유닛 가장자리 사이 2 서브타일 이내 */
  private driveNpcAction(id: number): void {
    const p = this.player;
    const n = this.level.npcs.find((x) => x.id === id);
    if (!n?.npc?.interact) {
      p.action = null;
      return;
    }
    if (Math.hypot(n.x - p.x, n.y - p.y) - (n.type.sizeX + PLAYER_SIZE) / 2 <= 2) {
      p.path = [];
      p.action = null;
      this.startTalk(n);
      return;
    }
    if (this.tickCount < p.repathAt && p.path.length) return;
    p.repathAt = this.tickCount + 10;
    if (!this.pathPlayerTo(n.x, n.y, p.running)) p.action = null;
  }

  /** 대화 시작: NPC 멈춤·플레이어 바라봄, Akara 치료 (출처: D2GAME_NPC_Heal_6FCCB220) */
  private startTalk(n: MonsterUnit): void {
    const s = n.npc as NonNullable<MonsterUnit['npc']>;
    this.closeTalk();
    s.talking = true;
    n.path = [];
    if (n.mode !== 'NU') this.setMonMode(n, 'NU');
    n.dir = dir64(this.player.x - n.x, this.player.y - n.y);
    // 출처: QUESTS_NPCActivate — 퀘스트마다 대사 목록 (nMenu 0 은 말을 걸자마자 재생)
    const speeches = this.questControl.npcActivate(n.type.id);
    this.talk = { levelId: this.level.def.id, npcId: n.id, mode: 'menu', speeches };
    if (NPC_DEFS[n.type.id]?.heal) this.healAtNpc();
    this.events.push({ type: 'npcInteract', npcId: n.id, typeId: n.type.id });
    const auto = speeches.find((x) => x.menu === 0);
    if (auto) this.playSpeech(n, auto);
  }

  /** 대화 끝 (원작 D2GAME_NPC_ResetInteract) — 도박 목록은 버린다 (SUNITPROXY_FreeNpcGamble) */
  closeTalk(): void {
    const t = this.talk;
    if (!t) return;
    const n = this.levels.get(t.levelId)?.npcs.find((x) => x.id === t.npcId);
    if (n?.npc) n.npc.talking = false;
    this.talk = null;
    this.npc.gamble = null;
    if (n) this.npc.endTrade(n.type.id);
    this.events.push({ type: 'npcClosed', npcId: t.npcId });
    // 출처: QUESTS_NPCDeactivate
    if (n) this.questControl.npcDeactivate(n.type.id);
  }

  private npcMenu(option: NpcOption): void {
    const t = this.talk, n = this.talking();
    if (!t || !n || !this.npcOptions(n).includes(option)) return;
    const h = this.tradeHost();
    const id = n.type.id;
    if (option.startsWith('quest:')) {
      const [, qn, idx] = option.split(':').map(Number);
      const sp = t.speeches.find((x) => x.quest === qn && x.index === idx) ?? t.speeches.find((x) => x.quest === qn);
      if (sp) this.playSpeech(n, sp);
      return;
    }
    switch (option) {
      case 'imbue':
        // 출처: NPC_HandleDialogMessage (CHARSI) — 담금질 창: 아이템을 커서로 들어 Charsi 에게
        t.mode = 'imbue';
        this.events.push({ type: 'imbueOpened', npcId: n.id });
        return;
      case 'socket':
        // 출처: NPC_HandleDialogMessage (LARZUK) — 소켓 창: 아이템을 커서로 들어 Larzuk 에게 (담금질과 같은 창)
        t.mode = 'socket';
        this.events.push({ type: 'imbueOpened', npcId: n.id, service: 'socket' });
        return;
      case 'personalize':
        // 출처: NPC_HandleDialogMessage (DREHYA) — 이름 새기기 창 (담금질과 같은 창)
        t.mode = 'personalize';
        this.events.push({ type: 'imbueOpened', npcId: n.id, service: 'personalize' });
        return;
      case 'goEast':
      case 'goWest':
      case 'sailEast':
      case 'sailWest':
      case 'goHarrogath': {
        // 출처: NPC_HandleDialogMessage (WARRIV1·WARRIV2·MESHIF1·MESHIF2) — D2GAME_PlayerChangeAct. 월드가 아직 없으면 대화를 연 채 둔다 (브라우저가 막 파일을 읽고 다시 고른다)
        const tr = TRAVEL[option];
        if (tr) this.travelAct(tr.to);
        return;
      }
      case 'talk': {
        const intro = !this.npc.introSeen.has(id);
        this.npc.introSeen.add(id);
        this.events.push({ type: 'npcTalk', npcId: n.id, typeId: id, intro, gossip: NPC_DEFS[id]?.gossip ?? '', pick: this.npcRng.roll() });
        return;
      }
      case 'trade':
      case 'tradeRepair':
        this.npc.storeOf(h, id);
        t.mode = 'trade';
        this.events.push({ type: 'storeOpened', npcId: n.id, typeId: id });
        return;
      case 'gamble':
        this.npc.openGamble(h);
        t.mode = 'gamble';
        this.events.push({ type: 'storeOpened', npcId: n.id, typeId: id, gamble: true });
        return;
      case 'hire':
        this.npc.hireList(h, id);
        t.mode = 'hire';
        this.events.push({ type: 'hireOpened', npcId: n.id });
        return;
      case 'resurrect':
        this.resurrectMerc();
        return;
      case 'identify':
        // 출처: D2GAME_NPC_IdentifyAllItems — A1Q4(Cain) 보상을 받았으면(받을 차례면) 무료
        this.npc.identifyAll(h, this.questDone('cain'));
        return;
      case 'cancel':
        this.closeTalk();
        return;
    }
  }

  /** 가격 (UI 툴팁): 상점 아이템은 buy, 플레이어 아이템은 sell / repair */
  priceOf(item: ItemInstance, kind: 'buy' | 'sell' | 'repair'): number {
    const n = this.talking();
    return n && this.data ? this.npc.priceOf(this.tradeHost(), n.type.id, item, kind) : 0;
  }

  private interactionSnapshot(): InteractionSnapshot | null {
    const t = this.talk, n = this.talking();
    if (!t || !n) return null;
    const h = this.tradeHost();
    const id = n.type.id;
    const store = t.mode === 'gamble' ? (this.npc.gamble ?? []) : t.mode === 'trade' ? (this.npc.stores.get(id) ?? []) : [];
    return {
      npcId: n.id, typeId: id, mode: t.mode, options: this.npcOptions(n), topics: this.topicsOf(t.speeches), store, repair: !!NPC_DEFS[id]?.repair,
      hire: t.mode === 'hire' && this.data ? this.npc.candidates(h, id) : [],
    };
  }

  /**
   * 치료. 출처: D2GAME_NPC_HealPlayer_6FCCB080 — 생명·마나 최대, 독·빙결·치료 가능 상태(states.txt curable) 해제, 소환수·용병도 (SUNITNPC_PetIterate_Heal)
   */
  private healAtNpc(): void {
    const c = this.character;
    const curable = ['poison', 'freeze', 'amplifydamage', 'weaken', 'dimvision', 'taunt', 'ironmaiden', 'terror', 'attract', 'lifetap', 'confuse', 'decrepify', 'lowerresist', 'defense_curse', 'blood_mana'];
    let healed = false;
    if (c) {
      if (c.life < this.maxLife() || c.mana < this.maxMana()) healed = true;
      c.life = this.maxLife();
      c.mana = this.maxMana();
    }
    for (const st of curable) {
      if (this.player.states.has(st)) {
        this.player.states.remove(st);
        healed = true;
      }
    }
    for (const pet of this.pets) {
      if (pet.mode === 'DT' || pet.mode === 'DD') continue;
      if (pet.hp < pet.stats.maxHp) healed = true;
      pet.hp = pet.stats.maxHp;
      for (const st of curable) pet.states.remove(st);
    }
    this.events.push({ type: 'healed', sound: healed });
  }

  /** NPC AI (Npc / Navi / Idle). 대화 중이면 멈춰서 플레이어를 본다 */
  private updateNpcs(): void {
    const npcs = this.level.npcs;
    if (!npcs.length) return;
    const w = this.aiWorld();
    const p = this.player;
    // 출처: sub_6FCE5EE0 — PLAYER_IsBusy (상점·대화 중인 플레이어에게는 다가가지 않는다)
    const busy = this.talk !== null;
    for (const m of npcs) {
      const s = m.npc as NonNullable<MonsterUnit['npc']>;
      if (m.mode === 'WL' || m.mode === 'RN') {
        if (m.path.length && !s.talking) {
          this.advance(m, ((m.moveSpeed * SUBTILES_PER_YARD) / ENGINE_FPS), (d) => (m.dir = d), m.type.sizeX);
          continue;
        }
        m.path = [];
        this.setMonMode(m, 'NU');
      } else if (m.mode !== 'NU') {
        // 스킬 모드 (Charsi 망치질 S1 …) 가 끝날 때까지 판단하지 않는다
        if (this.tickCount < m.modeEnd && !s.talking) continue;
        this.setMonMode(m, 'NU');
      }
      if (this.tickCount < m.nextThink && !(s.talking && m.mode !== 'NU')) continue;
      w.frame = this.tickCount;
      w.target = { x: p.x, y: p.y, size: PLAYER_SIZE, dead: this.isDead, inTown: false };
      thinkNpc(w, m, s, busy);
    }
    // 대화 상대와 멀어지면 닫는다 (원작 SUNIT_ResetInteractInfo)
    const n = this.talking();
    if (this.talk && (!n || Math.hypot(n.x - p.x, n.y - p.y) > 8)) this.closeTalk();
  }

  // ---------------------------------------------------------------- 퀘스트

  /** Phase 7: Act 2 오염된 태양 (ENVIRONMENT_TaintedSunBegin~End) — 렌더러가 Act 2 화면을 어둡게 */
  get taintedSun(): boolean {
    return this.act === 1 && this.questControl.taintedSun;
  }

  /** 퀘스트 상태 기계가 게임에 요청하는 것 (QuestHost + Phase 7 ActsQuestHost) */
  private questHost(): ActsQuestHost {
    const g = this;
    const findCode = (code: string): ItemInstance | undefined => {
      // 출처: ITEMS_FindQuestItem — 플레이어 인벤토리 목록 전체 (원작 pInventory 는 몸·벨트·인벤토리·큐브·창고·커서를 한 목록으로 가진다.
      //   Phase 7: 큐브 속 호라드릭 지팡이, 손에 든 칼림의 의지·헬포지 망치도 찾는다)
      const st = g.store;
      if (st.cursor?.code === code) return st.cursor;
      return st.allItems().find((it) => it.code === code);
    };
    return {
      get record() {
        return g.questRecord;
      },
      get global() {
        return g.questGlobal;
      },
      get seed() {
        return g.questRng;
      },
      playerLevel: () => g.character?.level ?? 1,
      levelNo: () => g.level.def.levelNo ?? 0,
      hasItem: (code) => !!findCode(code),
      deleteItem: (code) => {
        const it = findCode(code);
        if (!it) return false;
        g.store.consume(it.id);
        g.statsDirty = true;
        g.events.push({ type: 'questItemRemoved', code });
        return true;
      },
      giveItem: (code, ilvl, quality) => g.giveQuestItem(code, ilvl, quality),
      dropAt: (code, x, y, quality) => g.dropQuestCode(code, x, y, quality),
      dropChestTc: (o, quality) => {
        const lv = [...g.levels.values()].find((l) => l.objects.includes(o));
        const prev = g.level;
        if (lv) g.level = lv;
        g.dropChest(o, quality);
        g.level = prev;
      },
      addSkillPoints: (n) => {
        // 출처: STATLIST_AddUnitStat(pPlayer, STAT_SKILLPTS, 1, 0)
        if (g.character) g.character.skillPoints += n;
      },
      assignMercenary: (npc) => {
        const n = [...g.levels.values()].flatMap((l) => l.npcs).find((x) => x.type.id === npc);
        const r = g.npc.assignFree(g.tradeHost(), npc, !!g.mercUnit());
        if (r) g.hireMerc(r.entry.name, r.entry.seed, r.init.id, r.init.level, r.init.experience, n?.x ?? g.player.x, n?.y ?? g.player.y);
      },
      aliveMonsters: (levelNo) => {
        const lv = [...g.levels.values()].find((l) => l.def.levelNo === levelNo);
        return lv ? lv.monsters.filter((m) => m.mode !== 'DT' && m.mode !== 'DD' && !m.pet).length : 0;
      },
      setObjectMode: (o, mode, endAnim) => {
        const lv = [...g.levels.values()].find((l) => l.objects.includes(o));
        setObjectMode(o, mode, (lv ?? g.level).def.map, g.tickCount);
        if (endAnim) g.scheduleEndAnim(o);
      },
      spawnCainTristram: (x, y) => {
        const lv = [...g.levels.values()].find((l) => l.def.levelNo === LEVEL.TRISTRAM);
        if (!lv) return false;
        const prev = g.level;
        g.level = lv;
        const c = g.spawnNpc('cain1', x, y);
        g.level = prev;
        return !!c;
      },
      moveCainToTown: () => {
        for (const l of g.levels.values()) {
          const i = l.npcs.findIndex((n) => n.type.id === 'cain1');
          if (i >= 0) {
            if (g.talk?.npcId === (l.npcs[i] as MonsterUnit).id) g.talk = null;
            l.npcs.splice(i, 1);
          }
        }
        const town = g.levels.get(g.townKey() ?? '');
        if (town?.populated) g.spawnCain();
        g.events.push({ type: 'cainToTown' });
      },
      openPortal: (levelNo, x, y, toLevelNo) => g.openQuestPortal(levelNo, x, y, toLevelNo),
      townPortalAtPlayer: () => {
        // 출처: ACT1Q6_UnitIterate_CreatePortalToTown — 플레이어 자리에 마을 포털 (오브젝트 59, 주인 없음)
        g.createPortalPair(g.player.x, g.player.y, false);
      },
      emit: (ev) => g.events.push(ev),
      ...g.actsQuestHost(),
    };
  }

  /** Phase 7: Act 2~4 퀘스트가 더 요청하는 것 (quests/acts-base.ts ActsQuestHost) */
  private actsQuestHost(): Omit<ActsQuestHost, keyof QuestHost> {
    const g = this;
    const levelOf = (levelNo: number): LevelState | undefined => [...g.levels.values()].find((l) => l.def.levelNo === levelNo);
    return {
      addStatPoints: (n) => {
        if (g.character) g.character.statPoints += n;
      },
      addLife: (n) => {
        const c = g.character;
        if (!c) return;
        c.maxLife += n;
        c.life += n;
        g.statsDirty = true;
      },
      // 출처: INVENTORY_GetLeftHandWeapon — 손에 든 무기
      weaponCode: () => (g.store.equipment.rarm ?? g.store.equipment.larm)?.code,
      findObject: (levelNo, classId) => levelOf(levelNo)?.objects.find((o) => o.type.id === classId),
      findObjectById: (levelNo, id) => levelOf(levelNo)?.objects.find((o) => o.id === id),
      createObject: (levelNo, classId, x, y, mode) => {
        const lv = levelOf(levelNo);
        if (!lv) return null;
        const at = g.freeSpot(lv.def.map, x, y, 1, 8) ?? { x, y };
        return g.createObject(lv, { classId, x: at.x, y: at.y, mode });
      },
      spawnMonster: (levelNo, typeId, x, y, opts) => {
        const lv = levelOf(levelNo);
        if (!lv || !g.data?.monsters.types.has(typeId)) return null;
        const prev = g.level;
        g.level = lv;
        let id: number | null = null;
        if (opts?.npc) id = g.spawnNpc(typeId, x, y)?.id ?? null;
        else if (opts?.boss) id = g.spawnBoss(typeId, x, y, false)?.id ?? null;
        else {
          const spot = nearestWalkable(lv.def.map, { x, y }, 8);
          if (spot) id = g.spawnMonster(typeId, spot.x + 0.5, spot.y + 0.5).id;
        }
        g.level = prev;
        return id;
      },
      levelMonsters: (levelNo) => (levelOf(levelNo)?.monsters ?? []).filter((m) => m.mode !== 'DT' && m.mode !== 'DD' && !m.pet)
        .map((m) => {
          const su = m.superUnique !== undefined ? g.data?.uniques?.superUnique(m.superUnique)?.key : undefined;
          return { id: m.id, typeId: m.type.id, x: m.x, y: m.y, ...(su ? { superUnique: su } : {}) };
        }),
      warpToLevel: (levelNo) => {
        const lv = levelOf(levelNo);
        if (!lv) return false;
        g.populate(lv);
        const at = lv.def.portalSpot ?? { x: lv.def.map.width / 2, y: lv.def.map.height / 2 };
        const spot = nearestWalkable(lv.def.map, at, 40) ?? { x: Math.floor(at.x), y: Math.floor(at.y) };
        g.changeLevel(lv.def.id, spot.x + 0.5, spot.y + 0.5);
        g.events.push({ type: 'questWarp', to: lv.def.id });
        return true;
      },
      travelAct: (act) => g.travelAct(act, true),
      refreshTownNpcs: () => {
        const town = g.levels.get(g.townKey() ?? '');
        if (town) g.refreshTownQuestNpcs(town);
      },
      chaos: () => {
        const c = g.chaos;
        return { sealsOpened: c.sealActivated.filter(Boolean).length, diabloSpawned: c.diabloSpawned, diabloKilled: c.diabloKilled, cleared: c.sanctumCleared };
      },
      completeDifficulty: () => {
        // 출처: 클래식 — 디아블로를 죽이면 다음 난이도 (Normal → Nightmare → Hell)
        g.difficultyUnlocked = Math.max(g.difficultyUnlocked, Math.min(g.difficulty + 1, 2)) as 0 | 1 | 2;
      },
      progress: (nAct) => {
        // 출처: CLIENTS_UpdateCharacterProgression — 난이도마다 NUM_ACTS (클래식 4, 확장팩 5)
        g.progression = Math.max(g.progression, nAct + g.difficulty * actCount(g.expansion));
      },
      difficulty: () => g.difficulty,
      act: () => g.act,
      expansion: () => g.expansion,
      superUniqueKey: (idx) => g.data?.uniques?.superUnique(idx)?.key,
      spawnSuperUnique: (key, x, y) => {
        const su = g.data?.uniques?.superUnique(key);
        return su ? (g.spawnSuperUnique(su.idx, x, y, undefined, true)?.id ?? null) : null;
      },
      removeUnit: (levelNo, id) => {
        const lv = levelOf(levelNo);
        if (!lv) return;
        for (const list of [lv.monsters, lv.npcs]) {
          const i = list.findIndex((u) => u.id === id);
          if (i >= 0) list.splice(i, 1);
        }
        // 오브젝트 (DUNGEON_AllocDrlgDelete + UNITROOM_RemoveUnitFromRoom — 얼음 Anya 558)
        if (lv.objects.some((o) => o.id === id)) g.removeObject(lv.def.id, id);
      },
      playerClass: () => g.classStats?.cls,
      giveQuestExperience: (amount) => {
        // 출처: ACT5Q5_RewardPlayer — 최대 레벨이면 없음, 지금 레벨 다음 칸의 폭 (Threshold(lvl+1) − Threshold(lvl)) 까지
        const c = g.character, t = g.expTable;
        if (!c || !t || c.level >= t.maxLevel) return 0;
        const n = Math.max(0, Math.min(amount, t.threshold(c.level + 1) - t.threshold(c.level)));
        if (n > 0) g.gainExperience(n);
        return n;
      },
      closeTownPortalIn: (levelNo) => {
        // 출처: ACT5Q5_UnitIterate_ClosePortals — 플레이어 마을 포털이 그 레벨에 있으면 닫는다 (sub_6FC7C170)
        const tp = g.townPortal;
        if (tp && g.findLevel(tp.fieldLevel)?.level.def.levelNo === levelNo) g.closeTownPortal();
      },
      waypointActive: (levelNo) => {
        const no = g.waypointNoOf(levelNo);
        return no === 255 || g.waypoints.has(no);
      },
      npcPos: (typeId) => {
        const n = g.level.npcs.find((x) => x.type.id === typeId);
        return n ? { x: Math.floor(n.x), y: Math.floor(n.y) } : null;
      },
    };
  }

  /**
   * 퀘스트 보상 아이템. 출처: QUESTS_CreateItem — 아이템 레벨 = nLevel (0 이면 플레이어 레벨), 최대 내구, 인벤토리 → 자리가 없으면 발밑, 감정됨
   */
  private giveQuestItem(code: string, ilvl: number, quality: number): boolean {
    const data = this.data, b = data?.items.base(code);
    if (!data || !b) return false;
    const lvl = ilvl || Math.max(this.character?.level ?? 1, 1);
    const it = data.treasure.createItem(b, lvl, this.rng, quality as ItemInstance['quality'], quality > QUALITY.NORMAL);
    if (it.maxDurability > 0) it.durability = it.maxDurability;
    it.identified = true;
    if (!this.store.inv.autoAdd(it)) this.dropItem(it, this.player.x, this.player.y);
    this.statsDirty = true;
    this.events.push({ type: 'questItemGiven', code, itemId: it.id, quality: it.quality });
    return true;
  }

  /** 오브젝트·몬스터 자리에 아이템 (D2GAME_DropItemAtUnit: 아이템 레벨 = 레벨 몬스터 레벨, 골드 수량은 그 레벨로) */
  private dropQuestCode(code: string, x: number, y: number, quality: number = QUALITY.NORMAL): boolean {
    const data = this.data, b = data?.items.base(code);
    if (!data || !b) return false;
    const lvl = data.objects?.levels.get(this.level.def.levelNo ?? 0)?.monLvl || this.character?.level || 1;
    const it = data.treasure.createItem(b, lvl, this.rng, quality as ItemInstance['quality'], quality > QUALITY.NORMAL);
    it.quantity = Math.max(1, it.quantity);
    this.dropItem(it, x, y);
    this.events.push({ type: 'itemDropped', itemId: it.id, code: it.code, quality: it.quality, source: 'quest' });
    return true;
  }

  /**
   * 붉은 영구 포털 한 쌍 (오브젝트 60 PermanentTownPortal). 출처: D2GAME_CreatePortalObject(…, OBJECT_PERMANENT_TOWN_PORTAL, bPerm=1) —
   *   반대쪽은 도착 레벨의 포털 자리 (levels.txt Position → 타일 정보 11). 근사(원작 미확인): 도착 레벨에 포털 자리가 없으면 레벨 한가운데 근처
   */
  private openQuestPortal(levelNo: number, x: number, y: number, toLevelNo: number): boolean {
    const from = [...this.levels.values()].find((l) => l.def.levelNo === levelNo);
    const to = [...this.levels.values()].find((l) => l.def.levelNo === toLevelNo);
    if (!from || !to) return false;
    if (from.objects.some((o) => o.portal?.toLevel === to.def.id && o.type.id === OBJ.PERMANENT_TOWN_PORTAL)) return true;
    const a = this.freeSpot(from.def.map, x, y, 1, 12);
    if (!a) return false;
    const field = this.createObject(from, { classId: OBJ.PERMANENT_TOWN_PORTAL, x: a.x, y: a.y, mode: OBJMODE.OPERATING, preOperateLock: true });
    if (!field) return false;
    field.endAnimAt = this.tickCount + animFrames(field.type, OBJMODE.OPERATING) + 1;
    this.populate(to);
    const spot = to.def.portalSpot ?? nearestWalkable(to.def.map, { x: to.def.map.width / 2, y: to.def.map.height / 2 }, 40) ?? { x: to.def.map.width / 2, y: to.def.map.height / 2 };
    const b = this.freeSpot(to.def.map, spot.x, spot.y, 1, 20) ?? { x: Math.floor(spot.x), y: Math.floor(spot.y) };
    const link = this.createObject(to, { classId: OBJ.PERMANENT_TOWN_PORTAL, x: b.x, y: b.y, mode: OBJMODE.OPENED, preOperateLock: true });
    if (!link) return false;
    field.portal = { toLevel: to.def.id, linkId: link.id, linkLevel: to.def.id, owner: false };
    link.portal = { toLevel: from.def.id, linkId: field.id, linkLevel: from.def.id, owner: false };
    this.events.push({ type: 'portalOpened', fieldLevel: from.def.id, fieldId: field.id, townId: link.id, to: to.def.id, quest: true });
    return true;
  }

  /**
   * Charsi 담금질 (A1Q3 보상). 출처: SUnitNpc.cpp NPC_HandleDialogMessage (CHARSI) —
   *   A1Q3 REWARDPENDING 이어야 함, ITEMS_IsImbueable, 같은 기본 아이템을 레어로 (아이템 레벨 = 플레이어 레벨, 5 초과면 +4),
   *   D2GAME_NPC_RepairItem (내구 최대), 인벤토리 (자리가 없으면 발밑), ACT1Q3_SetRewardGranted
   */
  imbue(itemId: number): boolean {
    const t = this.talk, n = this.talking(), data = this.data, c = this.character;
    if (!t || !n || n.type.id !== 'charsi' || !data || !c) return false;
    if (!this.quests.canImbue()) {
      this.events.push({ type: 'imbueFailed', reason: 'quest' });
      return false;
    }
    const found = this.store.find(itemId);
    if (!found || !(found.where.kind === 'cursor' || found.where.kind === 'inventory')) return false;
    const it = found.item, b = data.items.base(it.code);
    if (!b || !imbueable(data.items, it)) {
      this.events.push({ type: 'imbueFailed', reason: 'item', itemId });
      return false;
    }
    this.store.consume(it.id);
    let ilvl = Math.max(c.level, 1);
    if (ilvl > 5) ilvl += 4;
    const out = data.treasure.createItem(b, ilvl, this.rng, QUALITY.RARE, true);
    if (out.maxDurability > 0) out.durability = out.maxDurability;
    // 근사(원작 미확인): 원작 sub_6FC4BBB0 (감정 여부) — 담금질한 아이템은 감정된 채로 준다
    out.identified = true;
    if (!this.store.inv.autoAdd(out)) this.dropItem(out, this.player.x, this.player.y);
    this.statsDirty = true;
    this.quests.imbueDone();
    t.mode = 'menu';
    this.events.push({ type: 'imbued', itemId: out.id, code: out.code, quality: out.quality, ilvl });
    return true;
  }

  /** 확장팩 Act 5 퀘스트 모듈 (클래식 게임이면 없음) */
  private act5Quests(): Act5Quests | undefined {
    return this.questControl.get(4) as Act5Quests | undefined;
  }

  /**
   * Larzuk 소켓 (A5Q1 보상). 출처: SUnitNpc.cpp NPC_HandleDialogMessage (MONSTER_LARZUK) — A5Q1 REWARDPENDING, ITEMS_IsSocketable,
   *   ITEMS_Duplicate 뒤 소켓 수 (larzukSockets), D2GAME_NPC_RepairItem, 인벤토리 (자리가 없으면 발밑), ACT5Q1_SetRewardGranted
   */
  /**
   * Anya 이름 새기기. 출처: NPC_HandleDialogMessage (MONSTER_DREHYA) — A5Q4 REWARDPENDING 이 아니면 거절, ITEMS_IsPersonalizable,
   *   ITEMS_Duplicate → 수리 → 인벤토리 (자리가 없으면 발밑), IFLAG_PERSONALIZED + ITEMS_SetEarName (캐릭터 이름), ACT5Q4_SetRewardGranted
   */
  personalizeItem(itemId: number): boolean {
    const t = this.talk, n = this.talking(), data = this.data, q = this.act5Quests();
    if (!t || !n || n.type.id !== 'drehya' || !data || !q) return false;
    if (!q.canPersonalize()) {
      this.events.push({ type: 'personalizeFailed', reason: 'quest' });
      return false;
    }
    const found = this.store.find(itemId);
    if (!found || !(found.where.kind === 'cursor' || found.where.kind === 'inventory')) return false;
    const it = found.item;
    if (!isPersonalizable(data.items, it)) {
      this.events.push({ type: 'personalizeFailed', reason: 'item', itemId });
      return false;
    }
    this.store.consume(it.id);
    const out = structuredClone(it);
    if (out.maxDurability > 0) out.durability = out.maxDurability;
    out.personalized = (this.playerName || 'Hero').slice(0, 15);
    if (!this.store.inv.autoAdd(out)) this.dropItem(out, this.player.x, this.player.y);
    this.statsDirty = true;
    q.personalizeDone();
    t.mode = 'menu';
    this.events.push({ type: 'personalized', itemId: out.id, code: out.code, name: out.personalized });
    return true;
  }

  socketItem(itemId: number): boolean {
    const t = this.talk, n = this.talking(), data = this.data, q = this.act5Quests();
    if (!t || !n || n.type.id !== 'larzuk' || !data || !q) return false;
    if (!q.canSocket()) {
      this.events.push({ type: 'socketFailed', reason: 'quest' });
      return false;
    }
    const found = this.store.find(itemId);
    if (!found || !(found.where.kind === 'cursor' || found.where.kind === 'inventory')) return false;
    const it = found.item;
    if (!isSocketable(data.items, it)) {
      this.events.push({ type: 'socketFailed', reason: 'item', itemId });
      return false;
    }
    this.store.consume(it.id);
    const out = structuredClone(it);
    out.sockets = larzukSockets(data.items, out, this.rng);
    if (out.maxDurability > 0) out.durability = out.maxDurability;
    if (!this.store.inv.autoAdd(out)) this.dropItem(out, this.player.x, this.player.y);
    this.statsDirty = true;
    q.socketDone();
    t.mode = 'menu';
    this.events.push({ type: 'socketed', itemId: out.id, code: out.code, sockets: out.sockets });
    return true;
  }

  // ---------------------------------------------------------------- 호라드릭 큐브

  /**
   * 큐브 창 열기 (인벤토리·보관함의 큐브 오른쪽 클릭). 출처: PLRTRADE — 큐브 단추는 상호작용 대상이 아이템(큐브)일 때만 (nInteractUnitType == UNIT_ITEM)
   */
  openCube(itemId: number): boolean {
    const f = this.store.find(itemId);
    if (!f || f.item.code !== 'box' || f.where.kind === 'cube' || f.where.kind === 'equip') return false;
    this.cubeOpen = true;
    this.events.push({ type: 'cubeOpened', itemId });
    return true;
  }

  /**
   * 트랜스뮤트 단추. 출처: PLRTRADE_HandleCubeInteraction → PLRTRADE_CreateCubeOutputs —
   *   맞는 조합이 없으면 아무 일도 없다, 있으면 큐브 안 아이템을 모두 없애고 결과를 큐브에 (자리가 없으면 결과는 사라진다 — SUNIT_RemoveUnit),
   *   결과 소리 (SUNIT_AttachSound 4), Horadric Staff (hst)·Khalim's Will (qf2) 은 퀘스트에 알린다 (ACT2Q2 / ACT3Q2 Update…ItemCounts — Phase 7)
   * 근사(원작 미확인): Cow Portal(Wirt 의 다리 + 마을 포털 책)은 소 레벨이 없어 실패로 둔다 (입력이 남는다)
   */
  transmuteCube(): boolean {
    const data = this.data, db = data?.cube, c = this.character;
    if (!this.cubeOpen || !data || !db || !c) return false;
    const inCube = this.store.cube.items.map((p) => p.item);
    const cls = CLASS_CODE[c.cls] ?? '';
    const r = transmute(db, { items: data.items, treasure: data.treasure, rng: this.rng, playerLevel: c.level, difficulty: this.difficulty, cls, expansion: data.expansion ?? false }, inCube);
    if (!r || r.special === 'cow') {
      this.events.push({ type: 'transmuteFailed', count: inCube.length, ...(r?.special ? { special: r.special } : {}) });
      return false;
    }
    for (const it of r.consumed) this.store.consume(it.id);
    const placed: number[] = [];
    for (const it of r.outputs) {
      if (this.store.cube.autoAdd(it)) placed.push(it.id);
    }
    this.statsDirty = true;
    this.events.push({ type: 'transmuted', recipe: r.recipe.row, description: r.recipe.description, outputs: r.outputs.map((o) => o.code), itemIds: placed });
    for (const it of r.outputs) if (it.code === 'hst' || it.code === 'qf2') this.events.push({ type: 'cubeQuestItem', code: it.code, itemId: it.id });
    return true;
  }

  /**
   * 호라드릭 큐브 떨어뜨리기 (Phase 7 퀘스트 훅: A2Q2 — Halls of the Dead 상자). 아이템 레벨 = 그 레벨 몬스터 레벨 (D2GAME_DropItemAtUnit 규칙).
   * @returns 만든 큐브 아이템 (레벨이 없으면 null)
   */
  spawnCube(levelId: string, x: number, y: number): ItemInstance | null {
    const data = this.data, b = data?.items.base('box');
    const lv = this.levels.get(levelId);
    if (!data || !b || !lv) return null;
    const lvl = data.objects?.levels.get(lv.def.levelNo ?? 0)?.monLvl || this.character?.level || 1;
    const it = data.treasure.createItem(b, lvl, this.rng, QUALITY.NORMAL, true);
    it.identified = true;
    const prev = this.level;
    this.level = lv;
    this.dropItem(it, x, y);
    this.level = prev;
    this.events.push({ type: 'itemDropped', itemId: it.id, code: it.code, quality: it.quality, source: 'quest' });
    return it;
  }

  // ---------------------------------------------------------------- 용병

  /** 살아 있는 용병 유닛 */
  mercUnit(): MonsterUnit | undefined {
    const id = this.merc?.unitId;
    return id === null || id === undefined ? undefined : this.pets.find((x) => x.id === id);
  }

  /** 저장용 용병 기록 */
  mercSave(): MercSave | null {
    const m = this.merc;
    return m ? { name: m.name, seed: m.seed, hirelingId: m.hirelingId, level: m.level, experience: m.experience, dead: m.dead, ...(m.items && Object.keys(m.items).length ? { items: { ...m.items } } : {}) } : null;
  }

  private mercSnapshot(): MercSnapshot | null {
    const m = this.merc;
    if (!m) return null;
    const u = this.mercUnit();
    const typeId = u?.type.id ?? (this.mercInfo ? this.data?.monsters.list.find((t) => t.hcIdx === this.mercInfo?.row.cls)?.id : undefined);
    const st = this.mercInfo, dv = this.mercDv;
    const stats = st && this.data?.expansion
      ? { str: dv?.str ?? st.str, dex: dv?.dex ?? st.dex, min: u?.stats.a1.min ?? st.minDamage, max: u?.stats.a1.max ?? st.maxDamage, defense: u?.stats.defense ?? st.defense,
          resist: dv?.resist ?? { fi: st.resist, co: st.resist, li: st.resist, po: st.resist }, hireDesc: st.row.hireDesc }
      : undefined;
    return { id: m.unitId, name: m.name, level: m.level, hp: u ? u.hp : 0, maxHp: u ? u.stats.maxHp : (this.mercInfo?.maxHp ?? 0), dead: m.dead, experience: m.experience, nextExp: this.mercInfo?.nextExp ?? 0, ...(typeId ? { typeId } : {}),
      ...(this.data?.expansion ? { items: { ...m.items } } : {}), ...(stats ? { stats } : {}) };
  }

  /**
   * 고용 (NPC 곁에 새 용병, 있던 용병은 사라진다). 출처: sub_6FCC7FA0 → sub_6FC68D70 (NPC 곁), sub_6FC61270 (예전 용병 제거·기록·스탯)
   */
  hireMerc(name: string, seed: number, hirelingId: number, level: number, experience: number, x: number, y: number): MonsterUnit | null {
    const old = this.mercUnit();
    if (old) this.pets.splice(this.pets.indexOf(old), 1);
    this.merc = { name, seed, hirelingId, level, experience, dead: false, unitId: null };
    const u = this.spawnMerc(x, y);
    if (u) this.events.push({ type: 'mercHired', name, level, unitId: u.id });
    return u;
  }

  /**
   * 용병 유닛 만들기 (레벨 스탯 = MONSTERAI_UpdateMercStatsAndSkills).
   * 출처: sub_6FC61270 — UNITFLAG_NOXP|NOTC|ISMERC, 레이어 외형 0 (HD TR RH LH SH), 펫 종류 hireable
   */
  private spawnMerc(x: number, y: number): MonsterUnit | null {
    const rec = this.merc, data = this.data, db = data?.hirelings;
    if (!rec || !data || !db) return null;
    const st = mercStats(db, rec.hirelingId, rec.level, (sk) => data.skills?.byNameOf(sk)?.reqLevel ?? 0);
    const type = st ? data.monsters.list.find((t) => t.hcIdx === st.row.cls) : undefined;
    if (!st || !type) return null;
    const spot = nearestWalkable(this.map, { x, y }, 6);
    if (!spot) return null;
    const stats: MonsterStats = {
      level: st.level, maxHp: st.maxHp, defense: st.defense, exp: 0,
      a1: { min: st.minDamage, max: st.maxDamage, toHit: st.toHit }, a2: { min: st.minDamage, max: st.maxDamage, toHit: st.toHit },
      s1: { min: st.minDamage, max: st.maxDamage, toHit: st.toHit }, elem: [],
    };
    const id = this.nextUnitId++;
    const u: MonsterUnit = {
      ...this.newMonsterUnit(id, type, stats, new Rng((rec.seed ^ id) >>> 0 || 1), spot.x + 0.5, spot.y + 0.5),
      corpseUsed: true, noXp: true, noTc: true,
      pet: { skillId: -1, petType: 'hireable', expires: Infinity, missileLvl: 1, damagePct: 0, normalDamage: 0, slowPct: 0, hireling: true },
    };
    u.resist = { dm: 0, ma: 0, fi: st.resist, li: st.resist, co: st.resist, po: st.resist };
    u.components = Object.fromEntries(Object.keys(type.layers).map((k) => [k, 0]));
    u.leaderId = this.player.id;
    this.mercInfo = st;
    this.mercAura = null;
    this.mercItemAuras.clear();
    rec.unitId = id;
    rec.dead = false;
    this.pets.push(u);
    this.refreshMerc(true);
    return u;
  }

  /**
   * 장비를 더한 용병 능력치를 유닛에 넣는다 (확장팩). 장착·레벨업 때 다시 부른다.
   * 출처: D2GAME_ITEMS_UpdateItemStatlist (장비 스탯을 용병 스탯에 합침) · STATREGEN 이벤트
   * 피해 % (damagepercent·ED·Str/DexBonus)는 기본 피해에 넣었으므로 상태 스탯에서 뺀다. 그 밖의 장비 스탯(명중 %, 흡수 …)은
   * 'mercitems' 상태로 붙여 기존 용병 공격 코드(pet.states.stat)가 읽는다.
   * 근사(원작 미확인): 무기가 없으면 지금처럼 hireling 피해 (원작 맨손 용병 피해 경로 미확인)
   * @param full 생명을 최대로 (새 유닛·레벨업), 아니면 생명 비율 유지
   */
  private refreshMerc(full = false): void {
    const rec = this.merc, u = this.mercUnit(), st = this.mercInfo, data = this.data;
    if (!rec || !u || !st || !data?.expansion) {
      this.mercDv = null;
      this.mercItemAuras.clear();
      return;
    }
    const dv = mercDerived(st, u.type.id, u.type.a1, rec.items ?? {}, data.items, data.treasure.gen);
    this.mercDv = dv;
    const ratio = u.stats.maxHp > 0 ? u.hp / u.stats.maxHp : 1;
    const atk = { min: dv.dmg?.min ?? st.minDamage, max: dv.dmg?.max ?? st.maxDamage, toHit: dv.toHit };
    u.stats = { ...u.stats, level: rec.level, maxHp: dv.maxHp, defense: dv.defense, a1: atk, a2: { ...atk }, s1: { ...atk } };
    u.hp = full ? dv.maxHp : Math.max(1, Math.min(dv.maxHp, ratio * dv.maxHp));
    u.resist = { dm: dv.stat('damageresist'), ma: dv.stat('magicresist'), fi: dv.resist.fi, li: dv.resist.li, co: dv.resist.co, po: dv.resist.po };
    const want = new Map<number, number>();
    for (const l of dv.layered) if (l.stat === 'item_aura' && l.value > 0) want.set(l.param, (want.get(l.param) ?? 0) + l.value);
    for (const [id, run] of this.mercItemAuras) {
      if (want.get(id) === run.lvl) continue;
      u.states.remove(run.skill.auraState);
      this.mercItemAuras.delete(id);
    }
    for (const [id, lvl] of want) {
      const sk = this.skillRecord(id);
      if (sk?.aura && sk.auraState && !this.mercItemAuras.has(id)) this.mercItemAuras.set(id, { skill: sk, lvl, next: this.tickCount });
    }
    const SKIP = new Set(['damagepercent', 'item_mindamage_percent', 'item_maxdamage_percent', 'mindamage', 'maxdamage', 'secondary_mindamage', 'secondary_maxdamage',
      'strength', 'dexterity', 'maxhp', 'item_maxhp_percent', 'armorclass', 'tohit', 'fireresist', 'coldresist', 'lightresist', 'poisonresist', 'magicresist', 'damageresist',
      'maxfireresist', 'maxcoldresist', 'maxlightresist', 'maxpoisonresist', 'item_allskills']);
    const stats: Record<string, number> = {};
    for (const it of dv.active) for (const x of [...it.stats, ...it.socketed.flatMap((g) => g.stats)]) if (!x.param && !SKIP.has(x.stat)) stats[x.stat] = (stats[x.stat] ?? 0) + x.value;
    if (Object.keys(stats).length) u.states.set('mercitems', Infinity, stats);
    else u.states.remove('mercitems');
  }

  /**
   * 용병 장비 놓기·빼기 (확장팩). 출처: D2GAME_PACKETCALLBACK_Rcv0x61_DropPickupMercItem —
   *   커서에 아이템: 치료·해동·해독 물약은 용병이 마시고, 아니면 종류 표·요구치 확인 뒤 D2GAME_MERCS_EquipItem
   *   (칸 = 아이템 종류로, 차 있으면 원래 장비를 빼고 요구치를 다시 본 뒤 원래 장비를 커서로),
   *   커서가 비었으면 그 칸 장비를 커서로.
   * 근사(원작 미확인): 원작은 용병이 가까이 있어야 한다 — 여기서는 거리를 보지 않는다
   */
  private mercItem(slot?: MercSlot): void {
    const rec = this.merc, u = this.mercUnit(), st = this.mercInfo, data = this.data;
    if (!rec || !u || !st || !data?.expansion || rec.dead || this.isDead) return;
    const cur = this.store.cursor;
    const items = (rec.items ??= {});
    if (!cur) {
      const it = slot ? items[slot] : undefined;
      if (!slot || !it) return;
      delete items[slot];
      this.store.cursor = it;
      this.refreshMerc();
      this.events.push({ type: 'mercUnequipped', slot, itemId: it.id });
      return;
    }
    const b = data.items.base(cur.code);
    if (b && this.isMercPotion(b)) {
      this.mercPotion(cur.id);
      return;
    }
    const target = b ? mercSlotFor(data.items, u.type.id, b) : null;
    const old = target ? items[target] : undefined;
    const without = { ...items };
    if (target) delete without[target];
    const dv = mercDerived(st, u.type.id, u.type.a1, without, data.items, data.treasure.gen);
    const err = mercCanEquip(data.items, u.type.id, cur, { level: rec.level, str: dv.str, dex: dv.dex });
    if (err || !target) {
      this.events.push({ type: 'mercEquipFailed', reason: err ?? 'type', itemId: cur.id });
      return;
    }
    items[target] = cur;
    this.store.cursor = old ?? null;
    this.refreshMerc();
    this.events.push({ type: 'mercEquipped', slot: target, itemId: cur.id, ...(old ? { swapped: old.id } : {}) });
  }

  /** 용병이 마시는 물약: 치료(pSpell 3 생명)·회복(pSpell 5)·해독·해동 (출처: Rcv0x61 — SKILLITEM_pSpell_Handler 로 용병에게) */
  private isMercPotion(b: ItemBase): boolean {
    return (b.pSpell === 3 && b.useStats.some((u) => u.stat === 'hpregen' || u.stat === 'hitpoints')) || b.pSpell === 5 || (b.pSpell === 6 || b.pSpell === 9) && b.cureStates.length > 0;
  }

  /**
   * 물약을 용병에게 (초상화에 놓기 · Shift+벨트 키). 출처: SKILLITEM_pSpell03_Potion / pSpell05_RejuvPotion / pSpell09_AntidoteThawingPotion —
   *   용병은 플레이어가 아니라 직업 보너스·활력 두 배가 없다. 치료는 len 프레임에 나눠 회복 ('healthpot' 상태, regen 에서)
   */
  private mercPotion(itemId: number): void {
    const u = this.mercUnit(), data = this.data, found = this.store.find(itemId);
    if (!u || !data?.expansion || !found || this.isDead) return;
    const b = data.items.base(found.item.code);
    if (!b || !this.isMercPotion(b)) return;
    if (b.pSpell === 3) {
      for (const us of b.useStats) {
        if (us.stat !== 'hpregen' && us.stat !== 'hitpoints') continue;
        const cur = u.states.get('healthpot');
        const remaining = cur && Number.isFinite(cur.until) ? Math.max(0, cur.until - this.tickCount) : 0;
        const perFrame = ((us.calc << 8) + remaining * (cur?.stats.potion ?? 0)) / (remaining + b.useLen);
        u.states.remove('healthpot');
        u.states.set('healthpot', this.tickCount + remaining + b.useLen, { potion: perFrame });
      }
    } else if (b.pSpell === 5) {
      for (const us of b.useStats) if (us.stat === 'hitpoints') u.hp = Math.min(u.stats.maxHp, u.hp + (u.stats.maxHp * us.calc) / 100);
    } else {
      for (const cs of b.cureStates) u.states.remove(cs);
    }
    this.store.consume(itemId);
    this.events.push({ type: 'mercPotion', itemId, code: found.item.code });
  }

  /**
   * 부활 (Kashya). 출처: D2GAME_NPC_ResurrectMerc_6FCC9350 — 죽은 용병이 있어야 하고, 비용 = MONSTERS_GetHirelingResurrectionCost,
   *   골드 → 창고 순 지불, 생명 최대로 플레이어 곁에
   */
  resurrectMerc(): boolean {
    const rec = this.merc;
    if (!rec?.dead) return false;
    const cost = resurrectCost(rec.level);
    const h = this.tradeHost();
    if (cost > h.gold + h.stashGold) {
      this.events.push({ type: 'resurrectFailed', reason: 'gold', cost });
      return false;
    }
    if (cost > this.gold) {
      this.stashGold -= cost - this.gold;
      this.gold = 0;
    } else this.gold -= cost;
    const u = this.spawnMerc(this.player.x + 1, this.player.y + 1);
    this.events.push({ type: 'mercResurrected', cost });
    return !!u;
  }

  /**
   * 용병 AI (Rogue Scout·사막 용병·철늑대). 출처: AITHINK_Fn061_Hireable —
   *   주인과 거리 > 100 이면 곁으로 순간 이동, > 최대(24) 면 달려서 따라감, > 최소(16) 이고 주인이 걷거나 뛰면 따라감,
   *   서 있으면: 마을 밖이고 25 안에 보이는 적이 있으면 공격 판단(sub_6FCE4610), 주인과 붙어 있으면 비켜서고, 5% 로 주인 곁으로, 아니면 5 프레임 대기.
   *   거리 단계는 dwAiParam[0] 이 17~19 면 (param, 2·param)
   * 근사(원작 미확인): D2GAME_PETAI_PetMove 의 주인 발자취(20 칸 기록)·앞쪽 8 서브타일 지점 대신 주인 위치로 이동
   */
  private thinkMerc(pet: MonsterUnit): void {
    const p = this.player;
    const param = pet.ai[0];
    let minD = 16, maxD = 24;
    if (param > 16 && param < 20) {
      maxD = 2 * param;
      minD = param;
    }
    const dist = aiDistance(pet.x, pet.y, p.x, p.y);
    pet.nextThink = this.tickCount + 5;
    if (dist > 100) {
      this.warpPet(pet);
      return;
    }
    if (dist > maxD) {
      this.petMoveTo(pet, p.x, p.y, true);
      return;
    }
    if (dist > minD && (p.mode === 'WL' || p.mode === 'RN')) {
      this.petMoveTo(pet, p.x, p.y, p.mode === 'RN');
      return;
    }
    if (pet.mode !== 'NU') return;
    if (!this.inTown) {
      const t = this.mercTarget(pet);
      if (t && aiDistance(pet.x, pet.y, t.x, t.y) < 25) {
        this.mercAttack(pet, t);
        return;
      }
    }
    if (dist <= 1) {
      this.petMoveTo(pet, p.x + (pet.rng.pick(9) - 4), p.y + (pet.rng.pick(9) - 4), false);
      return;
    }
    if (pet.rng.pick(100) < 5) this.petMoveTo(pet, p.x + (pet.rng.pick(5) - 2), p.y + (pet.rng.pick(5) - 2), false);
  }

  /** 출처: sub_6FCF2CC0 — 미사일 벽에 가리지 않은 가장 가까운 적 */
  private mercTarget(pet: MonsterUnit): MonsterUnit | undefined {
    let best: MonsterUnit | undefined, bd = Infinity;
    for (const m of this.monsters) {
      if (m.mode === 'DT' || m.mode === 'DD' || m.pet) continue;
      const d = aiDistance(pet.x, pet.y, m.x, m.y);
      if (d < bd && this.lineOfSight(pet.x, pet.y, m.x, m.y)) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /**
   * 공격 판단. 출처: sub_6FCE4610 — 확률: ACT2HIRE 98, 그 밖 = min(dwAiParam[0] + 40 + 2·레벨, 95). 실패하면 dwAiParam[0] += 10 후 10 프레임 대기.
   *   근접형(monstats aip1 = HIREABLE_AI_PARAM_IS_MELEE — 사막 용병): 거리 3 이상이거나 근접 범위 밖이면 대상에게 달려감, 아니면 스킬.
   *   원거리(Rogue·철늑대): 거리 4 이상이거나 50% 면 스킬, 가까우면 주인 쪽으로 물러난다 (실패하면 도망, 그것도 안 되면 스킬)
   */
  private mercAttack(pet: MonsterUnit, t: MonsterUnit): void {
    const chance = pet.type.id === 'act2hire' ? 98 : Math.min(pet.ai[0] + 40 + 2 * pet.stats.level, 95);
    const use = pet.rng.pick(100) < chance;
    if (use) pet.ai[0] = 0;
    else pet.ai[0] += 10;
    const d = aiDistance(pet.x, pet.y, t.x, t.y);
    if (pet.type.aiParams[0] === 1) {
      if (d >= 3 || !isInMeleeRange(pet.x, pet.y, pet.type.sizeX, pet.type.meleeRange, t.x, t.y, t.type.sizeX)) {
        pet.targetId = t.id;
        this.petMoveTo(pet, t.x, t.y, true);
        return;
      }
      if (use) this.mercUseSkill(pet, t);
      else pet.nextThink = this.tickCount + 10;
      return;
    }
    if (d >= 4 || pet.rng.pick(100) >= 50) {
      if (use) this.mercUseSkill(pet, t);
      else pet.nextThink = this.tickCount + 10;
      return;
    }
    const p = this.player;
    const before = pet.path.length;
    this.petMoveTo(pet, p.x + (pet.rng.pick(9) - 4), p.y + (pet.rng.pick(9) - 4), false);
    if (pet.path.length || before) return;
    const sx = Math.sign(pet.x - t.x) || 1, sy = Math.sign(pet.y - t.y) || 1;
    this.petMoveTo(pet, pet.x + sx * 4, pet.y + sy * 4, false);
    if (!pet.path.length) this.mercUseSkill(pet, t);
  }

  /**
   * 스킬 고르기. 출처: sub_6FCE4830 — 누적 확률 = DefaultChance + Σ(Chance + max(레벨 − 행 레벨, 0) × ChancePerLvl / 4) (배운 스킬만,
   *   skills.txt aitype 1(Frozen Armor)은 그 상태가 이미 있으면 빼고, Inferno 는 대상이 스킬 레벨 / 2 + 4 안일 때만),
   *   rand(누적 + 1) ≥ DefaultChance 면 그 구간의 hireling 스킬 — 오라면 D2GAME_AssignSkill (오라를 켜고 10 프레임 대기),
   *   아니면 AITACTICS_UseSkill(hireling.txt Mode). 그 밖: ROGUEHIRE = monstats Skill1 (RogueMissile, A1),
   *   ACT2HIRE·ACT3HIRE = 근접 범위면 A1 (기본 공격), 아니면 10 프레임 대기
   */
  private mercUseSkill(pet: MonsterUnit, t: MonsterUnit): void {
    const st = this.mercInfo, skills = this.data?.skills;
    if (!st || !skills) return;
    const row = st.row;
    const diff = Math.max(pet.stats.level - row.level, 0);
    let total = row.defaultChance;
    const cum: { name: string; lvl: number; mode: number; upto: number; rec: SkillRecord }[] = [];
    for (const s of row.skills) {
      const rec = skills.byNameOf(s.name);
      if (!rec) break;
      const learned = st.skills.find((x) => x.name === s.name);
      if (!learned) continue;
      if (rec.aiType === 1 && rec.auraState && pet.states.has(rec.auraState)) continue;
      if (rec.name === 'Inferno' && aiDistance(pet.x, pet.y, t.x, t.y) > Math.trunc(learned.level / 2) + 4) continue;
      total += s.chance + Math.trunc((diff * s.chancePerLvl) / 4);
      // 장비 +모든 스킬·oskill (확장팩). 출처: SKILLS_GetBonusSkillLevel
      cum.push({ name: s.name, lvl: learned.level + mercSkillBonus(this.mercDv, rec.id), mode: s.mode, upto: total, rec });
    }
    const roll = pet.rng.pick(total + 1);
    if (roll >= row.defaultChance) {
      const hit = cum.find((c) => roll <= c.upto);
      if (hit) {
        if (hit.rec.aura) {
          // 출처: D2GAME_AssignSkill_6FD13800 — 오라를 켠다 (켠 오라는 유닛이 사라질 때까지 유지)
          if (this.mercAura?.skill.id !== hit.rec.id || this.mercAura.lvl !== hit.lvl) {
            this.mercAura = { skill: hit.rec, lvl: hit.lvl, next: this.tickCount };
            this.events.push({ type: 'mercAura', skill: hit.rec.name, lvl: hit.lvl });
          }
          pet.nextThink = this.tickCount + 10;
          return;
        }
        this.mercCast(pet, t, hit.name, hit.lvl, MERC_MODES[hit.mode] ?? 'A1');
        return;
      }
    }
    if (pet.type.id === 'roguehire') {
      const s1 = pet.type.skills[0];
      this.mercCast(pet, t, s1?.name || 'RogueMissile', 1, 'A1');
      return;
    }
    if (isInMeleeRange(pet.x, pet.y, pet.type.sizeX, pet.type.meleeRange, t.x, t.y, t.type.sizeX)) {
      this.mercCast(pet, t, '', 0, 'A1');
      return;
    }
    pet.nextThink = this.tickCount + 10;
  }

  /**
   * 스킬 동작 시작 (AITACTICS_UseSkill). 모드 14(SQ)는 monstats 스킬 칸의 시퀀스 (사막 용병 Jab = seq_act2guardjab, monseq.txt).
   * 근사(원작 미확인): 유닛에 그 모드 그림이 없으면 A1 로
   */
  private mercCast(pet: MonsterUnit, t: MonsterUnit, skill: string, lvl: number, mode: MonMode): void {
    (pet.pet as PetInfo).mercSkill = skill ? { name: skill, lvl } : undefined;
    pet.targetId = t.id;
    let seq: MonSeqFrame[] | undefined;
    if (mode === 'SQ') {
      const slot = pet.type.skills.find((s) => s.name === skill);
      seq = slot ? this.data?.monsters.seqs.get(slot.mode) : undefined;
      if (!seq?.length) mode = 'A1';
    } else if (!pet.type.modes.has(mode)) mode = 'A1';
    this.startMonsterMode(pet, mode, this.makeCast(pet, 0, skill, lvl, { unitId: t.id, x: t.x, y: t.y }, seq));
    pet.dir = dir64(t.x - pet.x, t.y - pet.y);
  }

  /**
   * 용병 스킬 동작 진행: 판정 틱(모드 애니메이션 판정 프레임 또는 monseq 이벤트 프레임)마다 mercShoot, 끝나면 NU.
   * @returns 동작 중이면 true (이번 틱은 판단하지 않는다)
   */
  private updateMercAction(pet: MonsterUnit): boolean {
    const c = pet.cast;
    if (!c || pet.mode === 'NU' || pet.mode === 'WL' || pet.mode === 'RN' || pet.mode === 'DT' || pet.mode === 'DD') return false;
    const el = this.tickCount - pet.modeStart;
    while (c.fired < c.events.length && el >= (c.events[c.fired] as number)) {
      c.fired++;
      this.mercShoot(pet);
    }
    if (this.tickCount < pet.modeEnd) return true;
    pet.cast = undefined;
    pet.mode = 'NU';
    pet.modeStart = this.tickCount;
    return false;
  }

  /**
   * 용병 공격 판정: 기본 근접 공격, 근접 스킬(Jab), 스킬 미사일(불·얼음 화살, Fire Ball·Ice Blast·Glacial Spike·Lightning·Charged Bolt·Inferno),
   * Inner Sight, Frozen Armor.
   * 출처: skills.txt RogueMissile(srvmissilea rogue1)·Fire Arrow(firearrow, SrcDam 128, EMin~EMax)·Cold Arrow(coldarrow, HitShift 7, ELen)·
   *       Inner Sight(aurastat armorclass −edmn, auralencalc, aurarangecalc — auratargetstate innersight),
   *       Jab(srvdofunc 7 근접, ToHit 10 + LevToHit 9, calc1 ln34 = 피해 %), Frozen Armor(srvdofunc 18 — aurastate frozenarmor, skill_armor_percent ln12),
   *       Charged Bolt(calc1 min(24, ln12) 발), 주문(SrcDam 없음)은 무기 피해를 더하지 않는다,
   *       missiles.txt rogue1 (SrcDamage 128) — 물리 = 용병 피해(hireling Dmg) × SrcDam / 128, 명중 = 용병 AR × (100 + ToHit + LevToHit·(lvl−1)) / 100
   * 근사(원작 미확인): Jab 시퀀스의 판정마다 한 번씩 때린다(원작 SKILLS_SrvDo007 세부 미확인), Charged Bolt 퍼짐 각도, Inferno 는 판정마다 불꽃 미사일 하나
   */
  private mercShoot(pet: MonsterUnit): void {
    const data = this.data, info = pet.pet as PetInfo;
    const t = pet.targetId !== undefined ? this.monsters.find((m) => m.id === pet.targetId && m.mode !== 'DT' && m.mode !== 'DD') : undefined;
    const sk = info.mercSkill;
    const calc = data?.skillCalc;
    if (!data || !calc) return;
    if (!sk) {
      if (t) this.mercMeleeHit(pet, t, 0, 0);
      return;
    }
    const s = data.skills?.byNameOf(sk.name);
    if (!s) return;
    const lvl = sk.lvl;
    const own: SkillOwner = { baseLevel: (id) => (id === s.id ? lvl : 0), skillLevel: (id) => (id === s.id ? lvl : 0), unitLevel: pet.stats.level };
    if (s.srvDoFunc === 18 && s.auraState) {
      // Frozen Armor: 자신에게 상태 (방어 %). 지속 = auralencalc (없으면 Param3 + (lvl − 1)·Param4 프레임)
      const stats: Record<string, number> = {};
      for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, own);
      const len = s.auraLenCalc ? calc.eval(s, s.auraLenCalc, lvl, own) : (s.params[2] ?? 0) + (lvl - 1) * (s.params[3] ?? 0);
      pet.states.set(s.auraState, this.tickCount + Math.max(25, len), stats, { id: s.id, lvl });
      this.events.push({ type: 'mercSkill', skill: s.name });
      return;
    }
    if (!t) return;
    if (s.auraTargetState && !s.aura) {
      const radius = Math.max(1, calc.eval(s, s.auraRangeCalc, lvl, own));
      const len = Math.max(1, calc.eval(s, s.auraLenCalc, lvl, own));
      const stats: Record<string, number> = {};
      for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, own);
      for (const m of this.monstersNear(pet.x, pet.y, radius)) m.states.set(s.auraTargetState, this.tickCount + len, stats);
      this.events.push({ type: 'mercSkill', skill: s.name });
      return;
    }
    const mname = s.srvMissile || s.srvMissileA;
    if (!mname) {
      // 근접 스킬 (Jab): 명중 +ToHit%, 피해 +calc1 %
      this.mercMeleeHit(pet, t, s.toHit + s.levToHit * (lvl - 1), s.calcs[0] ? calc.eval(s, s.calcs[0], lvl, own) : 0);
      this.events.push({ type: 'mercSkill', skill: s.name });
      return;
    }
    const def = data.missiles.get(mname);
    if (!def) return;
    const srcDam = s.srcDam || (s.eType ? 0 : def.srcDamage || 128);
    const a = pet.stats.a1;
    const roll = () => {
      const d = emptyDamage();
      d.hitClass = def.hitClass || 10;
      if (srcDam) d.phys = Math.trunc((rollDamage({ min: a.min, max: a.max }, pet.rng) * 256 * srcDam) / 128);
      if (s.eType) {
        const min = calc.minElem256(s, lvl, own, false), max = calc.maxElem256(s, lvl, own, false);
        addElemental(d, s.eType, min + pet.rng.pick(Math.max(0, max - min)), calc.elemLength(s, lvl, own));
      }
      return d;
    };
    const th = s.toHit + s.levToHit * (lvl - 1);
    const ar = a.toHit + Math.trunc((a.toHit * (th + pet.states.stat('item_tohit_percent'))) / 100);
    const sp = missileStep(def.vel), dd = Math.hypot(t.x - pet.x, t.y - pet.y) || 1;
    const base = Math.atan2(t.y - pet.y, t.x - pet.x);
    const count = s.name === 'Charged Bolt' && s.calcs[0] ? Math.max(1, calc.eval(s, s.calcs[0], lvl, own)) : 1;
    for (let i = 0; i < count; i++) {
      const ang = count > 1 ? base + (pet.rng.pick(61) - 30) * (Math.PI / 180) : base;
      const dx = count > 1 ? Math.cos(ang) * sp : ((t.x - pet.x) / dd) * sp, dy = count > 1 ? Math.sin(ang) * sp : ((t.y - pet.y) / dd) * sp;
      this.missiles.push({
        id: this.nextUnitId++, def, x: pet.x, y: pet.y, dx, dy, left: def.range, age: 0,
        owner: 'player', ownerId: pet.id, ownerLevel: pet.stats.level, hitClass: def.hitClass || 10, ar, roll, hit: new Set(), lvl, skill: s,
      });
    }
    this.events.push({ type: 'mercShot', skill: s.name, missile: def.name, count });
  }

  /**
   * 용병 근접 타격 (기본 A1 · Jab). 명중 = AR × (100 + 스킬 ToHit % + 오라 item_tohit_percent) / 100,
   * 피해 = hireling Dmg × (100 + 스킬 피해 % + 오라 damagepercent(Might)) / 100.
   * 출처: SUNITDMG 근접 판정 (hitChance), hireling.txt Dmg-Min/Max·AR, skills.txt Might aurastat damagepercent · Blessed Aim item_tohit_percent
   */
  private mercMeleeHit(pet: MonsterUnit, t: MonsterUnit, toHitPct: number, dmgPct: number): void {
    if (!isInMeleeRange(pet.x, pet.y, pet.type.sizeX, pet.type.meleeRange, t.x, t.y, t.type.sizeX, 1)) return;
    const a = pet.stats.a1;
    const ar = a.toHit + Math.trunc((a.toHit * (toHitPct + pet.states.stat('item_tohit_percent'))) / 100);
    if (!rollPercent(hitChance(ar, this.monsterDefense(t, false), pet.stats.level, t.stats.level), pet.rng)) {
      this.events.push({ type: 'mercMiss', targetId: t.id });
      return;
    }
    const d = emptyDamage();
    const base = rollDamage({ min: a.min, max: a.max }, pet.rng);
    d.phys = Math.max(0, Math.trunc((base * 256 * (100 + dmgPct + pet.states.stat('damagepercent'))) / 100));
    d.hitClass = pet.type.hitClass;
    this.damageMonster(t, d, 'pet', pet.id);
    this.events.push({ type: 'mercHit', targetId: t.id });
  }

  /**
   * 용병 오라 (사막 용병 Prayer·Defiance·Blessed Aim·Thorns·Holy Freeze·Might). 켠 뒤 perdelay 마다 용병 자신과 범위(aurarangecalc) 안의 플레이어에게
   * aurastate + aurastat (Prayer 는 hitpoints 회복), Holy Freeze(srvdofunc 81)는 범위 안 몬스터를 느리게(auratargetstate, 몬스터 coldeffect 상한)
   * 하고 냉기 피해 (EMin~EMax).
   * 출처: SKILLS_SrvDo065_BasicAura / SKILLS_SrvDo081 (Holy Freeze), skills.txt 각 오라 행, D2GAME_AssignSkill (용병은 마나를 쓰지 않는다)
   * 근사(원작 미확인): 플레이어의 같은 오라 상태와 겹치면 나중 것이 덮어쓴다 (원작 오라 상태 중첩 규칙 미확인)
   */
  private updateMercAura(): void {
    if (this.mercAura) this.runMercAura(this.mercAura);
    // 아이템 오라: 같은 오라를 용병 스킬이 같거나 높은 레벨로 켜 두었으면 그쪽만 (출처: sub_6FD10EC0 — 낮은 레벨은 무시)
    for (const run of this.mercItemAuras.values()) if (!(this.mercAura?.skill.id === run.skill.id && this.mercAura.lvl >= run.lvl)) this.runMercAura(run);
  }

  /** 용병 오라 한 주기 (고용 스킬 오라·아이템 오라 공통) */
  private runMercAura(a: { skill: SkillRecord; lvl: number; next: number }): void {
    const u = this.mercUnit(), calc = this.data?.skillCalc;
    if (!u || !calc || u.mode === 'DT' || u.mode === 'DD') return;
    if (this.tickCount < a.next) return;
    const s = a.skill, lvl = a.lvl;
    const own: SkillOwner = { baseLevel: (id) => (id === s.id ? lvl : 0), skillLevel: (id) => (id === s.id ? lvl : 0), unitLevel: u.stats.level };
    const period = Math.max(5, calc.eval(s, s.perDelay, lvl, own));
    a.next = this.tickCount + period;
    const until = this.tickCount + period + 1;
    const range = Math.max(1, calc.eval(s, s.auraRangeCalc, lvl, own));
    const stats: Record<string, number> = {};
    let heal = 0;
    if (s.srvDoFunc === 81) {
      for (const ps of s.passiveStats) stats[ps.stat] = calc.eval(s, ps.calc, lvl, own);
    } else if (s.srvDoFunc !== 66) {
      // 66 (Conviction 류): aurastat 은 몬스터 쪽 (아래)
      for (const x of s.auraStats) {
        const v = calc.eval(s, x.calc, lvl, own);
        if (x.stat === 'hitpoints') heal = v;
        else if (v) stats[x.stat] = v;
      }
    }
    u.states.set(s.auraState, until, stats, { id: s.id, lvl });
    if (heal) u.hp = Math.min(u.stats.maxHp, u.hp + heal / 256);
    const p = this.player, c = this.character;
    if (!this.isDead && Math.hypot(p.x - u.x, p.y - u.y) <= range) {
      if (s.srvDoFunc !== 81) p.states.set(s.auraState, until, stats, { id: s.id, lvl });
      if (heal && c) c.life = Math.min(this.maxLife(), c.life + heal / 256);
      this.statsDirty = true;
    }
    if (s.srvDoFunc === 81 && !this.inTown) {
      const target: Record<string, number> = {};
      for (const x of s.auraStats) target[x.stat] = calc.eval(s, x.calc, lvl, own);
      const min = calc.minElem256(s, lvl, own, false), max = calc.maxElem256(s, lvl, own, false);
      for (const m of this.monstersNear(u.x, u.y, range)) {
        if (m.pet) continue;
        const capped: Record<string, number> = {};
        for (const [k, v] of Object.entries(target)) capped[k] = k === 'velocitypercent' || k === 'attackrate' || k === 'other_animrate' ? Math.max(v, m.type.coldEffect) : v;
        if (m.type.coldEffect < 0) m.states.set(s.auraTargetState, until, capped);
        const d = emptyDamage();
        addElemental(d, s.eType, min + this.rng.pick(Math.max(0, max - min)), 0);
        d.hitClass = 0x0d;
        this.damageMonster(m, d, 'pet', u.id);
      }
    }
    // Conviction 류 (srvdofunc 66): 범위 안 몬스터에 auratargetstate + aurastat (출처: SKILLS_SrvDo066 → SKILLS_AuraCallback_BasicAura)
    if (s.srvDoFunc === 66 && s.auraTargetState && !this.inTown) {
      const target: Record<string, number> = {};
      for (const x of s.auraStats) target[x.stat] = calc.eval(s, x.calc, lvl, own);
      for (const m of this.monstersNear(u.x, u.y, range)) if (!m.pet) m.states.set(s.auraTargetState, until, target, { id: s.id, lvl });
    }
  }

  /**
   * 용병 경험치. 출처: SUNITDMG_ComputeExperienceGain(용병 레벨 기준, 상한 (Exp(L+1) − Exp(L)) >> 6), 용병이 죽인 게 아니면 × 86/256,
   *   SUNITDMG_AddExperienceForHireling — 용병 레벨 ≥ 플레이어 레벨이면 없음, 레벨업 시 MONSTERAI_UpdateMercStatsAndSkills
   */
  private mercGainExp(m: MonsterUnit, attackerId?: number): void {
    const rec = this.merc, u = this.mercUnit(), st = this.mercInfo, c = this.character, db = this.data?.hirelings;
    if (!rec || !u || !st || !c || !db || rec.level >= c.level) return;
    const gain = mercExpGain(adjustedExperience(m.stats.exp, rec.level, m.stats.level), rec.level, st.row, attackerId === u.id);
    if (gain <= 0) return;
    rec.experience += gain;
    const lvl = mercLevelFor(rec.experience, rec.level, st.row);
    this.events.push({ type: 'mercExperience', amount: gain });
    if (lvl <= rec.level) return;
    rec.level = lvl;
    const next = mercStats(db, rec.hirelingId, lvl, (sk) => this.data?.skills?.byNameOf(sk)?.reqLevel ?? 0);
    if (!next) return;
    this.mercInfo = next;
    u.stats = { ...u.stats, level: lvl, maxHp: next.maxHp, defense: next.defense,
      a1: { min: next.minDamage, max: next.maxDamage, toHit: next.toHit }, a2: { min: next.minDamage, max: next.maxDamage, toHit: next.toHit },
      s1: { min: next.minDamage, max: next.maxDamage, toHit: next.toHit } };
    u.hp = next.maxHp;
    u.resist = { dm: 0, ma: 0, fi: next.resist, li: next.resist, co: next.resist, po: next.resist };
    this.refreshMerc(true);
    this.events.push({ type: 'mercLevelUp', level: lvl });
  }

  private playerDie(): void {
    const p = this.player;
    // 죽음 사건 (killed): 쓰러지는 자리에 (출처: SKILLITEM_EventFunc30)
    this.procItemSkills('item_skillondeath', undefined, p);
    p.path = [];
    p.action = null;
    p.cast = null;
    this.setPlayerMode('DT');
    this.applyDeathPenalty();
    this.events.push({ type: 'playerDied', levelNo: this.level.def.levelNo ?? 0 });
  }

  /**
   * 죽음 벌칙 (몬스터에게 죽었을 때).
   * 골드: (인벤토리 + 창고) × min(레벨, 20)% 를 잃는다. 벌칙이 인벤토리 골드 이하면 나머지는 땅에 떨어뜨리고,
   *       넘치면 창고에서 모자란 만큼 뺀다. 인벤토리 골드는 0.
   * 경험치: (현재 레벨 경험치 구간) × DeathExpPenalty% (Normal 0 / Nightmare 5 / Hell 10), 레벨 아래로는 안 내려감.
   * 출처: D2MOO PLAYER/Player.cpp PLAYER_ApplyDeathPenalty, DifficultyLevels.txt DeathExpPenalty
   */
  private applyDeathPenalty(): void {
    const c = this.character;
    if (!c) return;
    const inv = this.gold, total = inv + this.stashGold;
    const penalty = Math.trunc((total * Math.min(c.level, 20)) / 100);
    if (penalty > inv) this.stashGold = total - penalty;
    else if (inv - penalty > 0) this.dropGold(inv - penalty, this.player.x, this.player.y);
    this.gold = 0;
    this.events.push({ type: 'goldLost', amount: penalty });
    const et = this.expTable;
    const pct = this.rules.deathExpPenalty;
    if (c.level > 1 && et && pct > 0) {
      const prev = et.threshold(c.level - 1), cur = et.threshold(c.level);
      let loss = Math.trunc(((cur - prev) * pct) / 100);
      let next = c.experience - loss;
      if (next <= prev) {
        loss = Math.max(0, loss + next - prev);
        next = prev + 1;
      }
      this.expLoss = loss;
      c.experience = next;
    }
  }

  // ---------------------------------------------------------------- 미사일 진행

  private updateMissiles(): void {
    const p = this.player;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const ms = this.missiles[i] as Missile;
      ms.age++;
      if (ms.owner === 'monster') {
        if (this.updateMonsterMissile(ms, p)) this.missiles.splice(i, 1);
        continue;
      }
      if (this.updatePlayerMissile(ms)) this.missiles.splice(this.missiles.indexOf(ms), 1);
    }
  }

  /**
   * 몬스터 미사일 한 프레임. 반환 true = 소멸.
   * 근사(원작 미확인): 충돌 = 플레이어와 1 서브타일 이내, 벽 = COLLIDE_MISSILE_BARRIER(0x04)·문, 지면 불 피해 = 원소 × DamageRate / 1024 매 프레임
   */
  private updateMonsterMissile(ms: Missile, p: PlayerState): boolean {
    ms.left--;
    if (ms.visual) return ms.left <= 0;
    if (ms.goo) return this.updateGoo(ms, p);
    if (ms.mon) return this.updateMonMissileEx(ms, p);
    const pAlive = p.mode !== 'DT' && p.mode !== 'DD';
    if (ms.groundFire) {
      if (pAlive && ms.mpkt && Math.hypot(ms.x - p.x, ms.y - p.y) <= 1) {
        const rate = ms.def.damageRate || 1024;
        const pk = { ...ms.mpkt, fire: Math.trunc((ms.mpkt.fire * rate) / 1024), phys: 0 };
        this.hitPlayer({ min: 0, max: 0, toHit: 0 }, ms.ownerLevel, 0, true, undefined, pk, true);
      }
      return ms.left <= 0;
    }
    if (ms.wander && ms.age % 3 === 0) {
      // 근사(원작 미확인): 충전 볼트(PATHTYPE_CHARGEDBOLT) 불규칙 경로를 3프레임마다 무작위 방향 전환으로
      const sp = Math.hypot(ms.dx, ms.dy);
      const a = Math.atan2(ms.dy, ms.dx) + ((this.rng.pick(5) - 2) * Math.PI) / 8;
      ms.dx = Math.cos(a) * sp;
      ms.dy = Math.sin(a) * sp;
    }
    // 충돌: 미사일 크기 패턴과 유닛 크기 패턴이 겹치면 (한 프레임 이동을 1 서브타일 이하 조각으로 나눠 검사 — 원작 경로는 서브타일마다 충돌 검사).
    // 전향(Conversion)된 시전자의 미사일은 플레이어 편이라 다른 몬스터만, 혼란(Confuse)된 시전자의 미사일은 몬스터도 맞힌다.
    // 출처: D2MOO D2Collision.cpp COLLISION_CheckMaskWithSize (미사일 Size), 유닛 크기 패턴 (COLLISION_SetMaskWithPattern), MISSILE 충돌 → pSrvHitFunc
    // 근사(원작 미확인): 혼란된 몬스터의 미사일이 플레이어도 맞히는지 (여기서는 맞힌다)
    const caster = this.monsters.find((x) => x.id === ms.ownerId);
    const allied = !!caster?.states.has('conversion');
    const hitsMonsters = allied || !!caster?.states.has('confuse');
    const size = ms.def.size;
    const steps = Math.max(1, Math.ceil(Math.hypot(ms.dx, ms.dy)));
    const roll = (): DamagePacket => {
      const d = ms.mpkt ? { ...ms.mpkt } : emptyDamage();
      if (ms.damage && ms.damage.max > 0) d.phys += rollDamage(ms.damage, this.rng) * 256;
      return d;
    };
    for (let k = 0; k < steps; k++) {
      ms.x += ms.dx / steps;
      ms.y += ms.dy / steps;
      if ((this.map.mask(Math.floor(ms.x), Math.floor(ms.y)) & (0x04 | 0x0800 | 0x0020)) !== 0) return true;
      if (!allied && pAlive && footprintsOverlap(ms.x, ms.y, size, p.x, p.y, PLAYER_SIZE)) {
        this.hitPlayer({ min: ms.damage?.min ?? 0, max: ms.damage?.max ?? 0, toHit: ms.toHit ?? 0 }, ms.ownerLevel, ms.hitClass, true, undefined, ms.mpkt, ms.alwaysHit);
        this.chillingArmorReturn(ms);
        return true;
      }
      const petHit = allied ? undefined : this.pets.find((pt) => pt.mode !== 'DT' && pt.mode !== 'DD' && footprintsOverlap(ms.x, ms.y, size, pt.x, pt.y, pt.type.sizeX));
      if (petHit) {
        this.damagePet(petHit, roll());
        return true;
      }
      if (hitsMonsters) {
        const t = this.monsters.find((o) => o !== caster && o.mode !== 'DT' && o.mode !== 'DD' && !(allied && o.states.has('conversion')) && footprintsOverlap(ms.x, ms.y, size, o.x, o.y, o.type.sizeX));
        if (t) {
          this.damageMonster(t, roll(), 'other');
          this.events.push({ type: 'monsterMissileHitMonster', missileId: ms.id, ownerId: ms.ownerId, targetId: t.id });
          return true;
        }
      }
    }
    return ms.left <= 0;
  }

  /**
   * 유니크 색 (원작 Utrans 번호 2~31 → RandTransforms.dat 의 번호 − 2 번째 색표).
   * 슈퍼유니크 = SuperUniques.txt Utrans, 유니크 = MonStats2 Utrans (없으면 이름 시드 % 30 + 2), noUniqueShift 면 없음.
   * 근사(원작 미확인): 무작위 유니크 색 번호 공식 (이름 시드 기반), 챔피언·미니언은 색 바꿈 없음
   */
  private uniqueTrans(m: MonsterUnit): number | undefined {
    if (m.type.noUniqueShift || !(m.flags & MONFLAG.UNIQUE) || (m.flags & MONFLAG.CHAMPION)) return undefined;
    if (m.superUnique !== undefined) {
      const u = this.data?.uniques?.superUnique(m.superUnique)?.utrans ?? 0;
      return u >= 2 ? u : undefined;
    }
    return m.type.utrans >= 2 ? m.type.utrans : (m.nameSeed % 30) + 2;
  }

  /** 플레이어 미사일 한 프레임. 반환 true = 소멸 */
  private updatePlayerMissile(ms: Missile): boolean {
    ms.left--;
    if (ms.visual) {
      ms.x += ms.dx;
      ms.y += ms.dy;
      return ms.left <= 0;
    }
    ms.onTick?.(ms);
    if (ms.cloud) {
      if (ms.age % ms.cloud.every === 0) for (const m of this.monstersNear(ms.x, ms.y, ms.cloud.radius)) this.missileHit(ms, m, false);
      return ms.left <= 0;
    }
    if (ms.seek && ms.homingTarget === undefined && Math.hypot(ms.seek.tx - ms.x, ms.seek.ty - ms.y) <= Math.hypot(ms.dx, ms.dy) + 0.5) {
      // Bone Spirit: 목표 지점에 닿으면 반경 안 적을 찾아 따라가고 수명을 다시 채운다 (출처: MISSMODE_SrvHit10 — Range + LevRange × (lvl−1))
      const t = this.monstersNear(ms.x, ms.y, ms.seek.radius)[0];
      if (t) {
        ms.homingTarget = t.id;
        ms.left = ms.def.range + ms.def.levRange * (ms.lvl - 1);
      }
      ms.seek = undefined;
    }
    if (ms.homingTarget !== undefined) {
      const t = this.monsters.find((m) => m.id === ms.homingTarget && m.mode !== 'DT' && m.mode !== 'DD');
      if (t) {
        const sp = Math.hypot(ms.dx, ms.dy);
        const d = Math.hypot(t.x - ms.x, t.y - ms.y) || 1;
        ms.dx = ((t.x - ms.x) / d) * sp;
        ms.dy = ((t.y - ms.y) / d) * sp;
      }
    }
    if (ms.wander && ms.age % 3 === 0) {
      // 근사(원작 미확인): Charged Bolt / Charged Strike 볼트의 불규칙 경로(PATHTYPE_CHARGEDBOLT)를 3프레임마다 무작위 방향 전환으로 근사
      const sp = Math.hypot(ms.dx, ms.dy);
      const a = Math.atan2(ms.dy, ms.dx) + ((this.rng.pick(5) - 2) * Math.PI) / 8;
      ms.dx = Math.cos(a) * sp;
      ms.dy = Math.sin(a) * sp;
    }
    if (ms.spiral) {
      // 근사(원작 미확인): PATHTYPE_BLESSEDHAMMER 의 나선을 프레임당 각 0.12rad, 반지름 +0.07 서브타일로 근사 (Range 120 → 약 2바퀴, 반지름 8)
      const sp = ms.spiral;
      sp.a += 0.12;
      sp.r += 0.07;
      const nx = sp.cx + Math.cos(sp.a) * sp.r, ny = sp.cy + Math.sin(sp.a) * sp.r;
      ms.dx = nx - ms.x;
      ms.dy = ny - ms.y;
    }
    ms.x += ms.dx;
    ms.y += ms.dy;
    if (ms.trail && ms.age % ms.trail.every === 0) this.spawnCloud(ms.trail.def, ms.x, ms.y, ms.trail.roll, ms);
    if (ms.groundTrail) this.spawnGroundFire(ms.groundTrail.def, ms.x, ms.y, ms.groundTrail.roll, ms);
    // 용병 화살은 몬스터 미사일처럼 미사일 벽(0x04)·문에만 막힌다 (대상 고르기 sub_6FCF2CC0 의 시야 판정과 같은 기준)
    const mercMissile = this.merc?.unitId !== null && ms.ownerId === this.merc?.unitId;
    const blocked = mercMissile
      ? (this.map.mask(Math.floor(ms.x), Math.floor(ms.y)) & (0x04 | 0x0800 | 0x0020)) !== 0
      : !this.map.walkable(Math.floor(ms.x), Math.floor(ms.y));
    if (blocked || ms.left <= 0) {
      this.missileEnd(ms, undefined);
      return true;
    }
    if (ms.noCollide) return false;
    const reach = (ms.def.size + 1) / 2;
    // 지속 피해(Inferno 불꽃): 닿아 있는 적에게 매 프레임
    if (isContinuous(ms.def)) {
      for (const m of this.monsters) {
        if (m.mode === 'DT' || m.mode === 'DD') continue;
        if (Math.hypot(m.x - ms.x, m.y - ms.y) <= reach + m.type.sizeX / 2) this.missileHit(ms, m, false);
      }
      return false;
    }
    // 충돌: 미사일 크기 패턴과 몬스터 크기 패턴이 겹치나 (이번 프레임 이동 경로를 1 서브타일 이하 조각으로). 출처: D2Collision.cpp COLLISION_CheckMaskWithSize
    const steps = Math.max(1, Math.ceil(Math.hypot(ms.dx, ms.dy)));
    const touches = (m: MonsterUnit): boolean => {
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        if (footprintsOverlap(ms.x - ms.dx * (1 - f), ms.y - ms.dy * (1 - f), ms.def.size, m.x, m.y, m.type.sizeX)) return true;
      }
      return false;
    };
    if (ms.rehit) for (const [id, at] of ms.rehit) if (ms.age >= at) {
      ms.hit.delete(id);
      ms.rehit.delete(id);
    }
    for (const m of this.monsters) {
      if (m.mode === 'DT' || m.mode === 'DD' || ms.hit.has(m.id) || ms.group?.has(m.id) || m.states.has('conversion')) continue;
      if (!touches(m)) continue;
      // Holy Bolt: 언데드만 맞는다 (sHitPar2 = 1), 나머지는 통과. 출처: MISSMODE_SrvHit07_HolyBolt
      if (ms.def.srvHitFunc === 7 && ms.def.hitParams[1] === 1 && !m.type.undead) continue;
      // Guided Arrow: 대상이 아닌 적은 통과. 출처: MISSMODE_SrvHit10_GuidedArrow
      if (ms.homingTarget !== undefined && m.id !== ms.homingTarget && this.monsters.some((x) => x.id === ms.homingTarget && x.mode !== 'DT' && x.mode !== 'DD')) continue;
      ms.hit.add(m.id);
      ms.group?.add(m.id);
      ms.rehit?.set(m.id, ms.age + Math.max(1, ms.def.nextDelay));
      this.onMissileCollide(ms, m);
      if (ms.def.collideKill && !ms.pass?.(m)) {
        if (ms.pierceChance && this.rng.pick(100) < ms.pierceChance) continue;
        this.missileEnd(ms, m);
        return true;
      }
    }
    return false;
  }

  /**
   * 미사일이 적과 부딪힘: pSrvHitFunc 별 처리.
   * 출처: D2MOO MissMode.cpp — SrvHit01(Fire Ball: 반경 sHitPar1 폭발), SrvHit12(Chain Lightning: aurarange 안 다른 적에게 다음 번개),
   *       SrvHit13(Glacial Spike: aurarange 반경 폭발 + auralen 빙결)
   */
  private onMissileCollide(ms: Missile, m: MonsterUnit): void {
    const def = ms.def, calc = this.data?.skillCalc, s = ms.skill;
    if (def.srvHitFunc === 1 && ms.roll) {
      const radius = def.hitParams[0] || (s && calc ? Math.max(calc.calc(s, 1, ms.lvl, this.owner()), 1) : 1);
      for (const t of this.monstersNear(ms.x, ms.y, Math.max(radius, reachOf(def, m)))) this.damageMonster(t, ms.roll());
      return;
    }
    if (def.srvHitFunc === 13 && ms.roll && s && calc) {
      const o = this.owner();
      const radius = def.hitParams[0] || Math.max(calc.eval(s, s.auraRangeCalc, ms.lvl, o), 1);
      const len = def.hitParams[1] || calc.eval(s, s.auraLenCalc, ms.lvl, o);
      for (const t of this.monstersNear(ms.x, ms.y, Math.max(radius, reachOf(def, m)))) {
        const d = ms.roll();
        if (len > 0) d.freezeLen = len;
        this.damageMonster(t, d);
      }
      return;
    }
    if (def.srvHitFunc === 9 && ms.roll) {
      this.immolationHit(ms);
      return;
    }
    if (def.srvHitFunc === 53) {
      // Rabies 옮김: 이미 rabies 면 지나가고, 남은 독 길이가 10 이상이면 그 길이로 독 + rabies (출처: MISSMODE_SrvHit53 / SrvDmg11)
      const left = (ms.until ?? 0) - this.tickCount;
      if (!s || !ms.roll || m.states.has(s.auraTargetState) || left < 10) return;
      const d = ms.roll();
      d.poisLen = left;
      this.damageMonster(m, d, 'player');
      this.infectRabies(s, ms.lvl, m, ms.until ?? 0);
      return;
    }
    if (def.srvHitFunc === 47 && m.type.large) {
      this.boulderBurst(ms);
      return;
    }
    this.missileHit(ms, m, true);
    if (def.srvHitFunc === 20 && s && calc) {
      // Lightning Fury: 맞은 자리에서 aurarange 안 적 calc1 명에게 번개(HitSubMissile1). 출처: MISSMODE_SrvHit20_LightningFury + AuraCallback
      const sub = def.hitSubMissile1 ? this.data?.missiles.get(def.hitSubMissile1) : undefined;
      const o = this.owner();
      const range = def.hitParams[0] || Math.max(calc.eval(s, s.auraRangeCalc, ms.lvl, o), 1);
      const n = def.hitParams[1] || Math.max(calc.calc(s, 1, ms.lvl, o), 1);
      if (sub) {
        const roll = this.missileDamageRoller(sub, this.skillFor(sub) ?? s, ms.lvl, { srcDam: 0, useSkillDamage: true });
        let k = 0;
        for (const t of this.monstersNear(ms.x, ms.y, range)) {
          if (t.id === m.id) continue;
          if (k++ >= n) break;
          const d = Math.hypot(t.x - ms.x, t.y - ms.y) || 1, sp = missileStep(sub.vel);
          this.missiles.push({
            id: this.nextUnitId++, def: sub, x: ms.x, y: ms.y, dx: ((t.x - ms.x) / d) * sp, dy: ((t.y - ms.y) / d) * sp, left: sub.range, age: 0,
            owner: 'player', ownerId: ms.ownerId, ownerLevel: ms.ownerLevel, hitClass: sub.hitClass || 0x40, roll, hit: new Set([m.id]), lvl: ms.lvl, skill: s,
          });
        }
      }
      return;
    }
    if (def.srvHitFunc === 12 && ms.chain && ms.chain.left > 1) {
      // 방금 맞은 대상만 빼고 반경 안에서 고른다 (되돌아올 수 있음). 출처: MISSMODE_SrvHit12 — sub_6FD107F0(…, pUnit->dwUnitId)
      // 근사(원작 미확인): 원작 탐색 순서 대신 무작위
      const cands = this.monstersNear(ms.x, ms.y, ms.chain.range).filter((t) => t.id !== m.id);
      const next = cands.length ? cands[this.rng.pick(cands.length)] : undefined;
      if (next && s) {
        this.spawnPlayerMissile(def, s, ms.lvl, next.x, next.y, next.id, {
          from: { x: ms.x, y: ms.y }, srcDam: 0, useSkillDamage: true, chain: { left: ms.chain.left - 1, range: ms.chain.range }, skipIds: [m.id],
        });
      }
    }
  }

  /**
   * Immolation Arrow 적중: 반경 calc1 원판에 불길(HitSubMissile1, 지속 SHitCalc1 = 100프레임, 불길 자체 피해), 반경 calc2 안 화살 피해.
   * 출처: MISSMODE_SrvHit09_ImmolationArrow + MISSMODE_CreateImmolationArrowHitSubmissiles
   */
  private immolationHit(ms: Missile): void {
    const def = ms.def, s = ms.skill, data = this.data, calc = data?.skillCalc;
    if (!s || !calc || !data || !ms.roll || ms.exploded) return;
    ms.exploded = true;
    const o = this.owner();
    const fire = def.hitSubMissile1 ? data.missiles.get(def.hitSubMissile1) : undefined;
    if (fire) {
      const r = (def.hitParams[0] ?? 0) > 0 ? (def.hitParams[0] ?? 0) : Math.max(calc.calc(s, 1, ms.lvl, o), 1);
      const life = evalCalc(def.sHitCalc, { param: (nm) => missileParam(def, nm, ms.lvl), ref: () => 0 });
      const fr = this.missileOwnRoller(fire, this.skillFor(fire) ?? s, ms.lvl);
      if (!this.inTown) for (const off of discOffsets(r)) this.spawnGroundFire(fire, ms.x + off.x, ms.y + off.y, fr, ms, life > 0 ? life : undefined);
    }
    const radius = (def.hitParams[1] ?? 0) > 0 ? (def.hitParams[1] ?? 0) : Math.max(calc.calc(s, 2, ms.lvl, o), 1);
    for (const m of this.monstersNear(ms.x, ms.y, radius)) this.damageMonster(m, ms.roll());
  }

  private missileHit(ms: Missile, m: MonsterUnit, checkToHit: boolean): void {
    const c = this.character;
    if (!c || !ms.roll) return;
    const mine = ms.procs && ms.ownerId === this.player.id;
    const ar = ms.ar !== undefined && mine ? ms.ar + this.vsTypeStat(m, 'item_demon_tohit', 'item_undead_tohit') : ms.ar;
    if (checkToHit && ar !== undefined && !rollPercent(hitChance(ar, mine ? this.targetDefense(m, true) : this.monsterDefense(m, true), ms.ownerId === this.player.id ? c.level : ms.ownerLevel, m.stats.level), this.rng)) {
      this.events.push({ type: 'miss', targetId: m.id });
      return;
    }
    if (mine) this.onPlayerHitMonster(m);
    const d = ms.roll();
    // 악마·언데드 피해 % 는 미사일 피해 % 에 (출처: Missile.cpp:647-669 → MissMode.cpp:214-255, −90 하한)
    // 근사(원작 미확인): 굴린 물리 피해에 곱한다
    if (mine) {
      const pct = this.vsTypeDamagePct(m, this.isThrownWeapon() ? this.weaponBase() : undefined);
      if (pct) d.phys += Math.trunc((d.phys * pct) / 100);
    }
    if (ms.def.srvDmgFunc === 5) {
      // Blessed Hammer: 언데드 +dParam1%, 악마 +dParam2%. 출처: MISSMODE_SrvDmg05_BlessedHammer
      const base = d.mag;
      if (m.type.undead) d.mag += Math.trunc((base * (ms.def.dmgParams[0] ?? 0)) / 100);
      if (m.type.demon) d.mag += Math.trunc((base * (ms.def.dmgParams[1] ?? 0)) / 100);
    }
    const byMerc = this.merc?.unitId !== null && ms.ownerId === this.merc?.unitId;
    this.damageMonster(m, d, byMerc ? 'pet' : 'player', byMerc ? ms.ownerId : undefined, mine ? 'missile' : undefined);
    // Molten Boulder: 몬스터 크기에 따른 확률로 넉백 (출처: MISSMODE_SrvDmg14_MoltenBoulder — wResultFlags |= 8)
    if (ms.def.srvDmgFunc === 14 && m.mode !== 'DT' && m.mode !== 'DD') {
      const chance = boulderKnockChance(ms.def.dmgParams[0] ?? 0, ms.def.dmgParams[1] ?? 0, m.type);
      if (chance > 0 && this.rng.pick(100) < chance) this.knockBack(m);
    }
  }

  /** 충돌·소멸: 폭발(Exploding Arrow, 벽에 맞은 Fire Ball), 구름(Plague Javelin) */
  private missileEnd(ms: Missile, hitUnit: MonsterUnit | undefined): void {
    ms.onEnd?.(ms);
    // Immolation Arrow 는 벽·수명 끝에서도 터진다 (AlwaysExplode)
    if (!hitUnit && ms.roll && ms.def.srvHitFunc === 9 && ms.def.alwaysExplode) this.immolationHit(ms);
    if (ms.explode) for (const m of this.monstersNear(ms.x, ms.y, ms.explode.radius)) this.damageMonster(m, ms.explode.roll());
    // 폭발 물약: 유닛에 맞지 않고(수명 끝·벽) 끝나면 폭발. 출처: MISSMODE_SrvHit03_ExplosivePotion_BombOnGround → SrvHit44 (반경 sHitPar1)
    // 근사(원작 미확인): sHitPar1 이 0 이면 스킬 aurarange 대신 반경 3
    if (!hitUnit && ms.roll && ms.def.srvHitFunc === 3) for (const m of this.monstersNear(ms.x, ms.y, ms.def.hitParams[0] || 3)) this.damageMonster(m, ms.roll());
    if (!hitUnit && ms.roll && (ms.def.srvHitFunc === 1 || ms.def.srvHitFunc === 13) && ms.def.alwaysExplode) {
      const any = this.monstersNear(ms.x, ms.y, 3)[0];
      if (any) this.onMissileCollide(ms, any);
    }
    if (ms.cloudBurst) {
      const b = ms.cloudBurst;
      const cx = hitUnit?.x ?? ms.x, cy = hitUnit?.y ?? ms.y;
      for (let k = 0; k < b.count; k++) {
        const a = (k / b.count) * Math.PI * 2;
        this.spawnCloud(b.def, cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, b.roll, ms);
      }
      this.spawnCloud(b.def, cx, cy, b.roll, ms);
    }
  }

  /**
   * 독 구름: 제자리에 Range 프레임 동안 머물며 반경(Size) 안 적에게 주기적으로 독.
   * 근사(원작 미확인): 원작 구름 미사일(pSrvDoFunc 3)의 피해 주기 세부 대신 Param2 프레임(없으면 4)마다 적용.
   */
  private spawnCloud(def: MissileDef, x: number, y: number, roll: () => DamagePacket, parent: Missile): void {
    if (!this.map.walkable(Math.floor(x), Math.floor(y))) return;
    this.missiles.push({
      id: this.nextUnitId++, def, x, y, dx: 0, dy: 0, left: def.range, age: 0,
      owner: 'player', ownerId: parent.ownerId, ownerLevel: parent.ownerLevel, hitClass: def.hitClass || 0x50, roll, hit: new Set(),
      cloud: { radius: Math.max(1, def.size), every: Math.max(1, def.params[1] || 4) }, lvl: parent.lvl, skill: parent.skill,
    });
  }

  /**
   * 지면 불 (Blaze·Fire Wall): 제자리에서 Range + LevRange×레벨 프레임 동안 닿는 적에게 매 프레임 화염.
   * 같은 칸에 이미 불이 있으면 새로 만들지 않는다.
   */
  private spawnGroundFire(def: MissileDef, x: number, y: number, roll: () => DamagePacket, parent: { ownerId: number; ownerLevel: number; lvl: number; skill?: SkillRecord }, range?: number): void {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (!this.map.walkable(cx, cy)) return;
    if (this.missiles.some((o) => o.def === def && Math.floor(o.x) === cx && Math.floor(o.y) === cy)) return;
    this.missiles.push({
      id: this.nextUnitId++, def, x: cx + 0.5, y: cy + 0.5, dx: 0, dy: 0, left: range ?? def.range + parent.lvl * def.levRange, age: 0,
      owner: 'player', ownerId: parent.ownerId, ownerLevel: parent.ownerLevel, hitClass: def.hitClass || 0x20, roll, hit: new Set(),
      lvl: parent.lvl, skill: parent.skill,
    });
  }

  /**
   * 재생. 몬스터: HP 재생 = maxHP(×256) × DamageRegen >> 12 (1/256 단위/프레임) (출처: D2MOO Monster.cpp STAT_HPREGEN)
   *       독: 상태의 hpregen(음수, 1/256/프레임) 만큼 감소 — 독으로도 죽는다 (출처: SUNITDMG_ApplyPoisonDamage)
   * 플레이어 마나: 초당 25 × (256 × 최대마나 / (25 × 120)) / 256 (출처: Maxroll Life & Mana Mechanics, charstats ManaRegen=120)
   */
  // ---------------------------------------------------------------- 오브젝트

  /** 플레이어 상태 (읽기 전용 복사: 이름·만료 틱·스탯) */
  playerState(name: string): { until: number; stats: Record<string, number> } | undefined {
    const st = this.player.states.get(name);
    return st ? { until: st.until, stats: { ...st.stats } } : undefined;
  }

  /** 현재 레벨 오브젝트 (읽기 전용 목록) */
  get objects(): readonly ObjectUnit[] {
    return this.level.objects;
  }
  /** 레벨의 오브젝트 (방문하지 않은 레벨은 빈 목록) */
  objectsOf(levelId: string): readonly ObjectUnit[] {
    return this.findLevel(levelId)?.level.objects ?? [];
  }
  /** 레벨의 자동 지도 탐험 기록 */
  automapOf(levelId: string): AutomapReveal | undefined {
    return this.findLevel(levelId)?.level.automap;
  }
  /** 레벨 정의 (UI: 웨이포인트 목록·자동 지도 표시) */
  levelDef(levelId: string): LevelDef | undefined {
    return this.findLevel(levelId)?.level.def;
  }
  /** 레벨 번호(levels.txt) → 레벨 키 (현재 막 먼저, 없으면 만들어 둔 다른 막) */
  levelKeyOf(levelNo: number): string | undefined {
    for (const l of this.levels.values()) if (l.def.levelNo === levelNo) return l.def.id;
    for (const a of this.acts.values()) for (const l of a.levels.values()) if (l.def.levelNo === levelNo) return l.def.id;
    return undefined;
  }
  /** 퀘스트 패널 탭 (막) 의 줄 */
  questLog(act: number): QuestLogEntry[] {
    return this.questControl.log(act);
  }

  /**
   * 레벨 첫 입장 때 오브젝트 생성: DS1 프리셋 → 방마다 오브젝트 그룹 배치.
   * 출처: Objects.cpp OBJECTS_SpawnPresetObject / OBJECTS_PopulationHandler (마을 방은 배치 안 함)
   */
  private createLevelObjects(level: LevelState): void {
    const db = this.data?.objects;
    if (!db) return;
    const def = level.def, levelNo = def.levelNo ?? 0;
    const rooms = def.rooms ?? [];
    level.region = newRegion(rooms.filter((r) => !r.noPopulate && !r.hasWaypoint).length);
    const create = (s: ObjectSpawn) => this.createObject(level, s);
    for (const p of def.objects ?? []) {
      const s = presetObject(p.classId, p.x, p.y, levelNo, this.objControl);
      if (s) create(s);
    }
    if (def.inTown) return;
    rooms.forEach((r, i) => {
      // 근사(원작 미확인): 원작 방 시드(pRoom->pSeed)는 DRLG 방 생성에서 나온다 — 여기서는 게임 시드·레벨·방 순번으로 고정
      const roomRng = new Rng(((this.seed ^ Math.imul(levelNo + 1, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0) || 1);
      populateRoomObjects(db, levelNo, r, def.map, this.objControl, roomRng, level.region as ObjectRegion, create);
    });
  }

  /** SUNIT_AllocUnitData(UNIT_OBJECT, …) + OBJECTS_InitHandler + 충돌 기록 */
  private createObject(level: LevelState, s: ObjectSpawn): ObjectUnit | null {
    const db = this.data?.objects;
    const t = db?.type(s.classId);
    if (!db || !t) return null;
    const o: ObjectUnit = {
      id: this.nextUnitId++, type: t, x: s.x + 0.5, y: s.y + 0.5, mode: s.mode ?? OBJMODE.NEUTRAL, modeStart: this.tickCount, interact: 0, spark: false,
      operated: false, endAnimAt: -1, regenAt: -1, resetAt: -1, rng: new Rng((this.objControl.roll() % 65534) + 1), blocking: false, lastOperate: -100,
    };
    initObject(o, s, { db, levelNo: level.def.levelNo ?? 0, inTown: level.def.inTown, control: this.objControl });
    if (t.initFn === 22) {
      // 출처: Objects.cpp OBJECTS_InitFunction22_Fire — Mode2 가 있고 Mode0 이 없으면 열린(타는) 모드, 25 프레임 뒤 MODECHANGE (불 피해)
      if (t.mode[OBJMODE.OPENED] && !t.mode[OBJMODE.NEUTRAL] && o.mode === OBJMODE.NEUTRAL) o.mode = OBJMODE.OPENED;
      o.fireAt = this.tickCount + 25;
    }
    updateObjectCollision(o, level.def.map);
    level.objects.push(o);
    // 퀘스트 오브젝트 InitFn (Act 1: 4 TowerTome … 47 CountessChest, Phase 7: Act 2~4 — quests/index.ts QUEST_INIT_FNS)
    if (QUEST_INIT_FNS.has(t.initFn)) {
      const prev = this.level;
      this.level = level;
      this.questControl.initObject(o);
      this.level = prev;
    }
    return o;
  }

  /** 예약 이벤트: ENDANIM(작동 → 열림), 우물 재생, 신전 초기화. 출처: ObjMode.cpp D2GAME_OBJMODE_InvokeEventFunction (sub_6FC74AC0 / sub_6FC74B40 / sub_6FC74B00) */
  private updateObjects(): void {
    const now = this.tickCount;
    for (const lv of this.levels.values()) {
      if (!lv.objects.length) continue;
      for (const o of lv.objects) {
        if (o.endAnimAt >= 0 && now >= o.endAnimAt) {
          o.endAnimAt = -1;
          if (o.mode === OBJMODE.OPERATING && o.type.mode[OBJMODE.OPENED]) setObjectMode(o, OBJMODE.OPENED, lv.def.map, now);
        }
        if (o.regenAt >= 0 && now >= o.regenAt) {
          o.regenAt = -1;
          const r = wellRegen(o.type, o.interact);
          o.interact = r.left;
          if (r.mode !== null) setObjectMode(o, r.mode, lv.def.map, now);
        }
        if (lv === this.level && o.trapAt !== undefined && now >= o.trapAt) {
          o.trapAt = undefined;
          this.fireTrap(o);
        }
        if (lv === this.level && o.fireAt !== undefined && now >= o.fireAt) this.burnFire(o);
        if (o.resetAt >= 0 && now >= o.resetAt) {
          o.resetAt = -1;
          if (o.type.subClass & SUBCLASS.SHRINE) {
            setObjectMode(o, OBJMODE.NEUTRAL, lv.def.map, now);
            o.operated = false;
            this.events.push({ type: 'shrineRefreshed', objectId: o.id });
          }
        }
      }
    }
  }

  private scheduleEndAnim(o: ObjectUnit): void {
    o.endAnimAt = this.tickCount + animFrames(o.type, OBJMODE.OPERATING) + 1;
  }

  /** 오브젝트까지 걸어가서 조작 (원작 PLAYER interact: OperateRange 안에 들어가면 OBJECTS_OperateHandler) */
  private driveObjectAction(id: number): void {
    const p = this.player;
    const o = this.level.objects.find((x) => x.id === id);
    if (!o) {
      p.action = null;
      return;
    }
    // 근사(원작 미확인): 거리 = 오브젝트 상자 가장자리까지, OperateRange(서브타일) + 1 안이면 조작
    if (distanceToObject(o, p.x, p.y) <= Math.max(o.type.operateRange, 1) + 1) {
      p.path = [];
      p.action = null;
      this.operateObject(o);
      return;
    }
    if (this.tickCount < p.repathAt) return;
    p.repathAt = this.tickCount + 10;
    if (!this.pathPlayerTo(o.x, o.y, p.running) || p.path.length === 0) p.action = null;
  }

  /**
   * 조작 함수 표 (objects.txt OperateFn).
   * 출처: ObjMode.cpp gpObjOperateFnTable — 1 Casket, 2 Shrine, 3 Urn, 4 Chest, 5 Barrel, 7 ExplodingBarrel, 8 Door, 14 Corpse,
   *       15 Portal, 19 ArmorStand, 20 WeaponRack, 22 Well, 23 Waypoint, 26 BookShelf, 30 ExplodingChest
   */
  operateObject(o: ObjectUnit): void {
    if (this.isDead) return;
    const fn = o.type.operateFn;
    // 퀘스트 오브젝트 (6 TowerTome, 9 Monolith, 10 CainGibbet, 12 InifussTree, 21 Malus, 33 WirtsBody)
    if (this.questControl.operate(o)) return;
    switch (fn) {
      case 1: return this.opCasket(o);
      case 2: return this.opShrine(o);
      case 3: return this.opUrn(o);
      case 4: return this.opChest(o);
      case 5: return this.opBarrel(o);
      case 7: return this.opExplodingBarrel(o);
      case 8: return this.opDoor(o);
      case 14: return this.opCorpse(o);
      case 15: return this.usePortal(o);
      case 19:
      case 20:
        // 근사(원작 미확인): 원작은 D2GAME_DropArmor / DropWeapon (방어구·무기 전용 드롭) — 여기서는 상자 TC 한 번
        if (o.mode !== OBJMODE.NEUTRAL) return;
        this.dropChest(o, 0);
        this.setMode(o, OBJMODE.OPENED);
        return;
      case 22: return this.opWell(o);
      case 23: return this.opWaypoint(o);
      case 26: return this.opBookShelf(o);
      case 52:
      case 54:
      case 55:
      case 56:
        // Phase 5: 카오스 생추어리 봉인 (A4Q2.cpp OBJECTS_OperateFunction52/54/55/56_DiabloSeal)
        return this.opDiabloSeal(o);
      case 30:
        if (o.mode !== OBJMODE.NEUTRAL) return;
        this.trapDamagePlayer(o, 0);
        this.trapDamagePlayer(o, 1);
        this.setMode(o, OBJMODE.OPERATING);
        this.scheduleEndAnim(o);
        return;
      default:
        this.events.push({ type: 'objectUnsupported', objectId: o.id, operateFn: fn });
    }
  }

  private setMode(o: ObjectUnit, mode: number): void {
    setObjectMode(o, mode, this.level.def.map, this.tickCount);
  }

  /**
   * 상자 TC 드롭 (OBJMODE_DropFromChestTCWithQuality): "Act N Chest A/B/C", 아이템 레벨 = 레벨 몬스터 레벨 (levels.txt MonLvl1), 오브젝트 시드.
   * 첫 아이템(없으면 null) 을 돌려준다 (원작 ppDroppableItems[0])
   */
  private dropChest(o: ObjectUnit, quality: number): ItemInstance | null {
    const data = this.data, db = data?.objects;
    if (!data || !db) return null;
    const levelNo = this.level.def.levelNo ?? 0;
    const tc = chestTcName(db, levelNo);
    const mlvl = db.levels.get(levelNo)?.monLvl || 1;
    const items = data.treasure.drop(tc, mlvl, o.rng, this.derived()?.stat('item_magicbonus') ?? 0, { exact: true, quality, goldFind: this.derived()?.stat('item_goldbonus') ?? 0 });
    for (const it of items) {
      this.dropItem(it, o.x, o.y);
      this.events.push({ type: 'itemDropped', itemId: it.id, code: it.code, quality: it.quality, source: 'object', objectId: o.id });
    }
    this.events.push({ type: 'chestDrop', objectId: o.id, tc, count: items.length });
    return items[0] ?? null;
  }

  /** 정해진 코드의 아이템 하나 떨어뜨리기 (OBJMODE_DropItemWithCodeAndQuality / DropItemAtUnit) */
  private dropCode(code: string, x: number, y: number): void {
    const data = this.data, b = data?.items.base(code);
    if (!data || !b) return;
    const lvl = this.data?.objects?.levels.get(this.level.def.levelNo ?? 0)?.monLvl || 1;
    const it = data.treasure.createItem(b, lvl, this.rng, QUALITY.NORMAL, true);
    it.quantity = Math.max(1, it.quantity);
    this.dropItem(it, x, y);
    this.events.push({ type: 'itemDropped', itemId: it.id, code: it.code, quality: it.quality, source: 'object' });
  }

  /** 함정 몬스터 (Casket/Barrel): rand(10000) & 0xFFFFE000 ≠ 0 (약 18%). 출처: ObjMode.cpp D2GAME_SpawnTrapMonster_6FC75B40, ObjRgn.cpp OBJRGN_GetTrapMonsterId */
  private trapMonster(o: ObjectUnit): void {
    if (((this.objControl.roll() % 10000) & 0xffffe000) === 0) return;
    const id = this.trapMonsterId();
    // 출처: D2GAME_SpawnTrapMonster — 234(flyingscimitar)는 Act 1 에서 나오지 않는다
    if (!id || id === 'flyingscimitar' || !this.data?.monsters.types.has(id)) return;
    const spot = nearestWalkable(this.map, { x: o.x + 1, y: o.y + 1 }, 6);
    if (!spot) return;
    const m = this.spawnMonster(id, spot.x + 0.5, spot.y + 0.5);
    this.events.push({ type: 'trapMonster', objectId: o.id, monsterId: m.id, typeId: id });
  }

  /**
   * 출처: OBJRGN_GetTrapMonsterId — 레벨 몬스터 중 zombie1~5 가 있으면 zombie1, skeleton/sk_archer/skmage_* 1~4 가 있으면 그 첫 번호, 없으면 flyingscimitar
   * (monstats 행 순서로 번호 범위를 판정)
   */
  private trapMonsterId(): string {
    const ids = [...(this.data?.monsters.types.keys() ?? [])];
    const idx = (id: string) => ids.indexOf(id);
    for (const m of this.level.def.monsterPool ?? []) {
      const k = idx(m);
      if (k < 0) continue;
      const z = idx('zombie1');
      if (z >= 0 && k >= z && k < z + 5) return 'zombie1';
      for (const base of ['skeleton1', 'sk_archer1', 'skmage_pois1', 'skmage_cold1', 'skmage_fire1', 'skmage_ltng1']) {
        const b = idx(base);
        if (b >= 0 && k >= b && k < b + 4) return base;
      }
    }
    return 'flyingscimitar';
  }

  /**
   * 함정 오브젝트 피해 (OBJEVAL_ApplyTrapObjectDamage): 최소 hp>>5, 최대 hp>>3 (1/256 단위), 명중 = max(2·(lvl + rand(lvl/4) − 5·(dex/2) − lvl) − 방어 + 125, 65)%,
   * 피해 = (rand(max − min + 256) + min) × objects.txt Damage / 100. 마을에서는 무효
   */
  private trapDamagePlayer(o: ObjectUnit, dmgType: number): void {
    const c = this.character;
    if (!c || this.inTown || this.isDead) return;
    const hp = Math.trunc(c.life * 256);
    const min = Math.max(hp >> 5, 1), max = Math.max(hp >> 3, min + 1);
    const lvl = c.level;
    const param = 2 * (((lvl + o.rng.pick(lvl >> 2)) & 0xff) - 5 * (this.effStat('dex') >> 1) - lvl);
    const chance = Math.max(param - this.playerDefenseValue() + 125, 65);
    if (o.rng.roll() % 100 >= chance) return;
    const dmg = Math.trunc(((o.rng.pick(max - min + 256) + min) * o.type.damage) / 100);
    if (!dmg) return;
    c.life = Math.max(0, c.life - dmg / 256);
    this.events.push({ type: 'playerHit', damage: dmg / 256, source: 'trap', element: dmgType === 1 ? 'fire' : 'physical' });
    if (c.life <= 0) this.playerDie();
  }

  private trapDamageMonster(o: ObjectUnit, m: MonsterUnit): void {
    const hp = Math.trunc(m.hp * 256);
    const min = Math.max(hp >> 5, 1), max = Math.max(hp >> 3, min + 1);
    const dmg = Math.trunc(((o.rng.pick(max - min + 256) + min) * o.type.damage) / 100);
    if (dmg > 0) this.damageMonster(m, { ...emptyDamage(), phys: dmg }, 'other');
  }

  /**
   * 함정 걸기 (상자·관·항아리를 연 뒤). 함정 종류 = InteractType & 0x7F (1~8, InitFn 02·03 에서 굴림).
   * 출처: ObjMode.cpp D2GAME_SetTrapCallback_6FC764B0 — 처리 함수가 있으면 35 프레임 뒤 EVENTTYPE_TRAP (+ 소리 13),
   *       몬스터 함정(8·9)은 함정 몬스터가 Act 1 의 flyingscimitar 면 걸지 않는다
   */
  private armTrap(o: ObjectUnit): void {
    const t = o.interact & 0x7f;
    if (t < 1 || t > 9) return;
    if ((t === 8 || t === 9) && this.trapMonsterId() === 'flyingscimitar' && (this.data?.objects?.levels.get(this.level.def.levelNo ?? 0)?.act ?? 0) === 0) return;
    o.trapAt = this.tickCount + 35;
    this.events.push({ type: 'trapArmed', objectId: o.id, trap: t });
  }

  /**
   * 함정 발동 (EVENTTYPE_TRAP). 출처: ObjMode.cpp sub_6FC74DF0 + gpObjectTrapHandlerTable —
   *   1 번개(trap-lightning)·4 노바(trap-nova): 레벨 번호 < 40 (Act 1) 이면 화염탄(2)으로,
   *   3 독구름(trap-poisoncloud): 레벨 < 40 이고 25(탑 지하 5층)가 아니면 화염탄으로,
   *   8 몬스터: 레벨 ≥ 75 면 화염탄, 2·6 화염탄(trap-firebolt), 5·7 불(오브젝트 162 큰 불 + x+1 에 160 작은 불), 8·9 몬스터 1~2 마리
   */
  private fireTrap(o: ObjectUnit): void {
    const levelNo = this.level.def.levelNo ?? 0;
    let t = o.interact & 0x7f;
    if (t === 8 && levelNo >= 75) t = 2;
    else if (t === 3 && levelNo < 40 && levelNo !== 25) t = 2;
    else if ((t === 1 || t === 4) && levelNo < 40) t = 2;
    this.events.push({ type: 'trapFired', objectId: o.id, trap: t });
    switch (t) {
      case 1: return this.trapShooter(o, 'trap-lightning');
      case 2:
      case 6: return this.trapShooter(o, 'trap-firebolt');
      case 3: return this.trapShooter(o, 'trap-poisoncloud');
      case 4: return this.trapShooter(o, 'trap-nova');
      case 5:
      case 7: {
        // 출처: D2GAME_OBJECTS_TrapHandler5_7 — 큰 불(162) 제자리, 작은 불(160) x + 1. 근사(원작 미확인): 방 경계 검사 생략, SetSparkChest(2) 의미 미확인
        const fx = Math.floor(o.x), fy = Math.floor(o.y);
        const big = this.createObject(this.level, { classId: 162, x: fx, y: fy });
        const small = this.createObject(this.level, { classId: 160, x: fx + 1, y: fy });
        this.events.push({ type: 'trapFire', objectId: o.id, fires: [big?.id, small?.id].filter((x) => x !== undefined) });
        return;
      }
      case 8:
      case 9: {
        // 출처: D2GAME_OBJECTS_TrapHandler8_9 — (rand & 1) + 1 마리, OBJRGN_GetTrapMonsterId
        const n = (this.objControl.roll() & 1) + 1;
        const id = this.trapMonsterId();
        if (id === 'flyingscimitar' || !this.data?.monsters.types.has(id)) return;
        for (let i = 0; i < n; i++) {
          const spot = nearestWalkable(this.map, { x: o.x + 1, y: o.y + 1 }, 6);
          if (!spot) return;
          const m = this.spawnMonster(id, spot.x + 0.5, spot.y + 0.5);
          this.events.push({ type: 'trapMonster', objectId: o.id, monsterId: m.id, typeId: id });
        }
        return;
      }
      default:
    }
  }

  /**
   * 함정 몬스터(보이지 않는 발사대)의 한 번 공격. 원작은 함정 몬스터를 만들고 AI 가 거리 aip1 안의 대상에게 aip2 번 쏜 뒤 죽는다.
   * 출처: AiThink.cpp AITHINK_Fn077_TrapMissile / Fn080_092_TrapPoison_TrapNova (aip1 거리 25/20, aip2 횟수 1),
   *       MonsterUnique.cpp MONSTERUNIQUE_SetTrapDamage — 레벨 = 지역 몬스터 레벨(최소 1, 없으면 2), 화염탄: 화염 lvl>>1 ~ 3·lvl>>1,
   *       번개·노바: 번개 같은 값, 독구름: 독 lvl ~ 2·lvl, 지속 2·lvl
   * 근사(원작 미확인): 함정 몬스터 유닛 대신 오브젝트에서 바로 미사일 (공격 애니메이션 지연 없음), 명중 판정 없이 맞음(원소 피해만),
   *   독구름·노바는 16 방향 고리
   */
  private trapShooter(o: ObjectUnit, monId: string): void {
    const data = this.data, mt = data?.monsters.types.get(monId);
    if (!data || !mt) return;
    const p = this.player;
    const range = monId === 'trap-poisoncloud' || monId === 'trap-nova' ? 20 : 25;
    if (this.isDead || aiDistance(o.x, o.y, p.x, p.y) > range) return;
    const lvl = Math.max(this.data?.objects?.levels.get(this.level.def.levelNo ?? 0)?.monLvl ?? 2, 1);
    const pkt = emptyDamage();
    const roll = (lo: number, hi: number) => (lo + this.rng.pick(Math.max(0, hi - lo) + 1)) << 8;
    let name = mt.missA1 || 'trapfirebolt', ring = false;
    if (monId === 'trap-firebolt') pkt.fire = roll(lvl >> 1, (3 * lvl) >> 1);
    else if (monId === 'trap-lightning') pkt.ltng = roll(lvl >> 1, (3 * lvl) >> 1);
    else if (monId === 'trap-nova') {
      pkt.ltng = roll(lvl >> 1, (3 * lvl) >> 1);
      name = data.missiles.has('trapnova') ? 'trapnova' : 'nova';
      ring = true;
    } else {
      pkt.pois = lvl + this.rng.pick(lvl + 1);
      pkt.poisLen = 2 * lvl;
      name = data.missiles.has('primepoisoncloud') ? 'primepoisoncloud' : name;
      ring = true;
    }
    const md = data.missiles.get(name);
    if (!md) return;
    const own = this.missileOwnDamage(md, 1);
    pkt.fire += own.fire;
    pkt.ltng += own.ltng;
    pkt.pois += own.pois;
    pkt.poisLen = Math.max(pkt.poisLen, own.poisLen);
    const speed = Math.max(missileStep(md.vel), ring ? 0.5 : 0);
    const dirs = ring ? Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2) : [Math.atan2(p.y - o.y, p.x - o.x)];
    for (const a of dirs) {
      this.missiles.push({
        id: this.nextUnitId++, def: md, x: o.x, y: o.y, dx: Math.cos(a) * speed, dy: Math.sin(a) * speed, left: md.range, age: 0,
        owner: 'monster', ownerId: o.id, ownerLevel: lvl, damage: { min: 0, max: 0 }, toHit: 0, hitClass: md.hitClass || 10, hit: new Set(), lvl: 1, mpkt: { ...pkt }, alwaysHit: true,
      });
    }
    this.events.push({ type: 'trapShot', objectId: o.id, monster: monId, missile: name });
  }

  /**
   * 불 오브젝트 (InitFn 22, 함정 5·7 이 만드는 불 포함): 작동 모드면 열림으로, 거리 Parm0 + 1 안의 살아 있는 플레이어에게 화염 함정 피해,
   * 다음은 rand(35) + 15 프레임 뒤. 출처: ObjMode.cpp sub_6FC74D10 (EVENTTYPE_MODECHANGE) → OBJEVAL_ApplyTrapObjectDamage(…, 1)
   * 근사(원작 미확인): UNITS_GetDistanceToOtherUnit 을 체비셰프 거리로
   */
  private burnFire(o: ObjectUnit): void {
    if (o.mode === OBJMODE.OPERATING) this.setMode(o, OBJMODE.OPENED);
    const p = this.player;
    if (!this.isDead && Math.max(Math.abs(Math.floor(p.x) - Math.floor(o.x)), Math.abs(Math.floor(p.y) - Math.floor(o.y))) <= (o.type.parm[0] ?? 0) + 1) this.trapDamagePlayer(o, 1);
    o.fireAt = this.tickCount + (this.objControl.roll() % 35) + 15;
  }

  /** 출처: ObjMode.cpp OBJECTS_OperateFunction01_Casket */
  private opCasket(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL || !this.dropChest(o, 0)) return;
    this.setMode(o, OBJMODE.OPERATING);
    this.scheduleEndAnim(o);
    this.trapMonster(o);
    this.armTrap(o);
    this.events.push({ type: 'objectOpened', objectId: o.id });
  }

  /** 출처: ObjMode.cpp OBJECTS_OperateFunction03_Urn_Basket_Jar — rand(100) <= 20 이면 상자 TC */
  private opUrn(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.setMode(o, OBJMODE.OPERATING);
    this.scheduleEndAnim(o);
    if (this.objControl.roll() % 100 <= 20) this.dropChest(o, 0);
    this.armTrap(o);
    this.events.push({ type: 'objectOpened', objectId: o.id });
  }

  /** 출처: ObjMode.cpp OBJECTS_OperateFunction14_Corpse (시체·숨은 보물·통나무·돌무더기) — 항상 상자 TC */
  private opCorpse(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.dropChest(o, 0);
    this.setMode(o, OBJMODE.OPERATING);
    this.scheduleEndAnim(o);
    this.events.push({ type: 'objectOpened', objectId: o.id });
  }

  /**
   * 출처: ObjMode.cpp OBJECTS_OperateFunction04_Chest — 잠긴 상자(InteractType & 0x80)는 열쇠 필요(없으면 소리만), 드롭 2번.
   *       스파크 상자는 매직(5% 레어) 품질, 75% 확률로 드롭 (잠김·스파크는 항상). 끝에 OBJECTS_ChestEnd (Mode1 있으면 작동 애니메이션)
   */
  private opChest(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    const locked = (o.interact & 0x80) !== 0;
    // 어쌔신은 열쇠 없이 잠긴 상자를 연다 (출처: D2MOO ObjMode.cpp:1267 — PCLASS_ASSASSIN 이면 열쇠 확인 생략)
    if (locked) {
      if (this.character?.cls !== 'Assassin' && !this.useKey()) {
        this.events.push({ type: 'locked', objectId: o.id });
        return;
      }
      this.events.push({ type: 'unlocked', objectId: o.id });
    }
    let quality = 0;
    if (o.spark) quality = this.objControl.roll() % 100 < 5 ? QUALITY.RARE : QUALITY.MAGIC;
    // 드롭 여부 굴림은 원작처럼 오브젝트 조작 시드(pObjectregion) 사용
    let drops = chestDropRolls(o, this.objControl);
    let magic = 0;
    while (drops-- > 0) {
      const it = this.dropChest(o, quality);
      if (it && it.quality >= QUALITY.MAGIC) magic++;
    }
    if (o.spark && !magic) {
      for (let i = 0; i < 10; i++) {
        const it = this.dropChest(o, quality);
        if (it && it.quality >= QUALITY.MAGIC) break;
      }
    }
    this.setMode(o, o.type.mode[OBJMODE.OPERATING] ? OBJMODE.OPERATING : OBJMODE.OPENED);
    if ((o.mode as number) === OBJMODE.OPERATING) this.scheduleEndAnim(o);
    this.armTrap(o);
    this.events.push({ type: 'objectOpened', objectId: o.id, locked });
  }

  /** 열쇠 하나 쓰기. 출처: D2GAME_DoKeyCheck_6FC4A4B0 (인벤토리 열쇠 수량 1 감소, 0 이면 사라짐) */
  private useKey(): boolean {
    const key = this.store.inventoryItems.find((it) => it.code === 'key' && it.quantity > 0);
    if (!key) return false;
    key.quantity--;
    if (key.quantity <= 0) this.store.consume(key.id);
    return true;
  }

  /**
   * 출처: ObjMode.cpp OBJECTS_OperateFunction05_Barrel — 부서짐, 함정 몬스터, rand(100) <= 20 이면 상자 TC
   * 근사(원작 미확인): 원작은 이때 플레이어가 통을 때리는 공격 모드(스킬 1)로 바뀐다 — 여기서는 애니메이션 없이 바로 부순다
   */
  private opBarrel(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.setMode(o, OBJMODE.OPERATING);
    this.trapMonster(o);
    if (this.objControl.roll() % 100 <= 20) this.dropChest(o, 0);
    this.scheduleEndAnim(o);
    this.events.push({ type: 'objectOpened', objectId: o.id });
  }

  /**
   * 출처: ObjMode.cpp OBJECTS_OperateFunction07_ExplodingBarrel — 반경 3 안의 플레이어·몬스터에게 함정 피해, 거리 2 안의 폭발 통(11)도 연쇄 폭발
   * 근사(원작 미확인): 폭발 그림은 통의 작동(OP) 애니메이션만 그린다
   */
  private opExplodingBarrel(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.setMode(o, OBJMODE.OPERATING);
    this.events.push({ type: 'barrelExploded', objectId: o.id, x: o.x, y: o.y });
    const p = this.player;
    if (Math.hypot(p.x - o.x, p.y - o.y) <= 3) this.trapDamagePlayer(o, 0);
    for (const m of [...this.monsters]) if (m.mode !== 'DT' && m.mode !== 'DD' && Math.hypot(m.x - o.x, m.y - o.y) <= 3) this.trapDamageMonster(o, m);
    for (const b of this.level.objects) if (b !== o && b.type.id === OBJ.EXPLODING_BARREL && b.mode === OBJMODE.NEUTRAL && Math.hypot(b.x - o.x, b.y - o.y) <= 2) this.opExplodingBarrel(b);
    this.scheduleEndAnim(o);
  }

  /**
   * 출처: ObjMode.cpp OBJECTS_OperateFunction08_Door — 0.5초 안 재조작 무시, 닫힘 → 열림(충돌 해제), 열림 → 닫힘(문 자리에 유닛이 없을 때, 충돌 기록),
   *       유닛이 있으면 S3(막힘), 잠긴 문(S4)은 열쇠
   */
  private opDoor(o: ObjectUnit): void {
    // 500ms = 원작 25fps 기준 12.5 틱
    if (this.tickCount < o.lastOperate + 13) return;
    const t = o.type;
    const occupied = () => {
      const l = Math.floor(o.x) - Math.trunc(t.sizeX / 2), b = Math.floor(o.y) - Math.trunc(t.sizeY / 2);
      const inBox = (x: number, y: number) => x >= l && x < l + t.sizeX && y >= b && y < b + t.sizeY;
      return inBox(Math.floor(this.player.x), Math.floor(this.player.y)) || this.monsters.some((m) => m.mode !== 'DT' && m.mode !== 'DD' && inBox(Math.floor(m.x), Math.floor(m.y)));
    };
    switch (o.mode) {
      case OBJMODE.SPECIAL4:
        if (!this.useKey()) {
          this.events.push({ type: 'locked', objectId: o.id });
          return;
        }
        this.setMode(o, OBJMODE.OPENED);
        break;
      case OBJMODE.NEUTRAL:
        this.setMode(o, OBJMODE.OPENED);
        this.events.push({ type: 'doorOpened', objectId: o.id });
        break;
      case OBJMODE.OPENED:
      case OBJMODE.SPECIAL3:
        if (!occupied()) {
          this.setMode(o, OBJMODE.NEUTRAL);
          this.events.push({ type: 'doorClosed', objectId: o.id });
        } else if (o.mode !== OBJMODE.SPECIAL3) this.setMode(o, OBJMODE.SPECIAL3);
        else return;
        break;
      default:
        return;
    }
    o.lastOperate = this.tickCount;
  }

  /** 출처: ObjMode.cpp OBJECTS_OperateFunction26_BookShelf — rand(20) <= 12 이면 두루마리(isc/tsc), 아니면 책(ibk/tbk) */
  private opBookShelf(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.setMode(o, OBJMODE.OPENED);
    const scroll = this.objControl.roll() % 20 <= 12;
    const first = (this.objControl.roll() & 1) === 1;
    this.dropCode(scroll ? (first ? 'isc' : 'tsc') : first ? 'ibk' : 'tbk', o.x, o.y);
  }

  /**
   * 출처: ObjMode.cpp OBJECTS_OperateFunction22_Well — 남은 횟수가 있고 생명(Parm3 & 2)·마나(Parm3 & 1)가 모자라면 최대치 × Parm1 / 256 회복,
   *       독·빙결 해제, 쓰면 횟수 −1 (모드 갱신), Parm0 + 1 프레임 뒤 한 칸 재생 (EVENTTYPE_AITHINK → sub_6FC74B40)
   */
  private opWell(o: ObjectUnit): void {
    const c = this.character;
    if (!c || !o.interact) return;
    const t = o.type;
    let used = false;
    const ml = this.maxLife(), mm = this.maxMana();
    if (c.life < ml && t.parm[3]! & 2) {
      c.life = Math.min(ml, c.life + (ml * t.parm[1]!) / 256);
      used = true;
    }
    if (c.mana < mm && t.parm[3]! & 1) {
      c.mana = Math.min(mm, c.mana + (mm * t.parm[1]!) / 256);
      used = true;
    }
    for (const st of ['poison', 'freeze', 'cold']) {
      if (this.player.states.has(st)) {
        this.player.states.remove(st);
        used = true;
      }
    }
    if (!used) return;
    const r = wellAfterUse(t, o.interact);
    o.interact = r.left;
    if (r.mode !== null) this.setMode(o, r.mode);
    o.regenAt = this.tickCount + t.parm[0]! + 1;
    this.events.push({ type: 'wellUsed', objectId: o.id, left: o.interact });
  }

  /**
   * 출처: ObjMode.cpp OBJECTS_OperateFunction02_Shrine — 한 번만(다시 채워질 때까지), 메시지(ShrMsg<code>), shrines.txt Code 로 효과,
   *       reset time in minutes > 0 이면 1200 × 분 + 1 프레임 뒤 다시 사용 가능, 작동 애니메이션이 끝나면 열림
   */
  private opShrine(o: ObjectUnit): void {
    const db = this.data?.objects;
    if (!db || o.operated || o.mode !== OBJMODE.NEUTRAL) return;
    o.operated = true;
    this.setMode(o, OBJMODE.OPERATING);
    const s = db.shrine(o.interact) ?? db.shrine(1);
    if (!s) return;
    this.events.push({ type: 'shrine', objectId: o.id, code: s.code, name: s.name, message: `ShrMsg${s.code}` });
    this.applyShrine(o, s.code >= 0 && s.code < 24 ? s.code : 1);
    if (s.resetMinutes) o.resetAt = this.tickCount + 1200 * s.resetMinutes + 1;
    if ((o.mode as number) === OBJMODE.OPERATING && !o.type.cycleAnim[1] && o.type.mode[2]) this.scheduleEndAnim(o);
  }

  /**
   * 신전 효과 (gpShrineTable_6FD28D18, Code 순서).
   * 출처: ObjMode.cpp D2GAME_SHRINES_* — 상태 이름은 states.txt shrine_*, 스탯은 표의 스탯 번호 (171 skill_armor_percent, 39 fireresist,
   *       43 coldresist, 41 lightresist, 45 poisonresist, 27 manarecoverybonus, 85 item_addexperience), 값 = sub_6FC77750 (그대로 Arg0)
   */
  applyShrine(o: ObjectUnit, code: number): void {
    const db = this.data?.objects, c = this.character;
    const s = db?.shrine(code);
    if (!s || !c) return;
    const until = this.tickCount + s.duration;
    const st = this.player.states;
    const ml = this.maxLife(), mm = this.maxMana();
    switch (code) {
      case 1: c.life = ml; c.mana = mm; break;
      case 2: c.life = ml; break;
      case 3: c.mana = mm; break;
      case 4: {
        const v = Math.trunc((c.life * s.arg0) / 100);
        c.life -= v;
        c.mana = c.mana + (v * s.arg1) / 100;
        break;
      }
      case 5: {
        const v = Math.trunc((c.mana * s.arg0) / 100);
        c.mana -= v;
        c.life = c.life + (v * s.arg1) / 100;
        break;
      }
      case 6: st.set('shrine_armor', until, { skill_armor_percent: s.arg0 }); break;
      case 7:
        // 출처: D2GAME_SHRINES_CombatBoost — tohit = Arg0 × 명중률 / 100, damagepercent = Arg1.
        // 근사(원작 미확인): 명중률(OBJMODE_GetToHitPercentage)의 무기 마스터리·스킬 명중 보너스는 빼고 현재 AR 로 계산
        st.set('shrine_combat', until, { tohit: Math.trunc((s.arg0 * this.playerAR()) / 100), damagepercent: s.arg1 });
        break;
      case 8: st.set('shrine_resist_fire', until, { fireresist: s.arg0 }); break;
      case 9: st.set('shrine_resist_cold', until, { coldresist: s.arg0 }); break;
      case 10: st.set('shrine_resist_lightning', until, { lightresist: s.arg0 }); break;
      case 11: st.set('shrine_resist_poison', until, { poisonresist: s.arg0 }); break;
      case 12: st.set('shrine_skill', until, { allskills: s.arg0 }); this.passiveCache = null; break;
      case 13: st.set('shrine_mana_regen', until, { manarecoverybonus: s.arg0 }); break;
      case 14:
        // 출처: D2GAME_SHRINES_Stamina — 스태미나 = 최대, 상태 shrine_stamina: 스탯 162 skill_staminapercent = Arg0, staminarecoverybonus 1000 (무한 스태미나)
        // 근사(원작 미확인): 상태 스탯 목록의 STAT_STAMINA 2 × 값(1/256 단위, 약 1.6)은 생략
        c.stamina = this.maxStamina();
        st.set('shrine_stamina', until, { skill_staminapercent: s.arg0, staminarecoverybonus: 1000 });
        break;
      case 15: st.set('shrine_experience', until, { item_addexperience: s.arg0 }); break;
      case 17: this.createPortalPair(this.player.x + 5, this.player.y + 5, false); break;
      case 18: this.shrineGem(); break;
      case 19: {
        // 출처: D2GAME_SHRINES_Storm — 반경 Arg1 안의 살아 있는 플레이어·몬스터 생명 −Arg0 % (−(hp >> 8) × Arg0 / 100 << 8)
        const hit = (hp: number) => Math.trunc((Math.trunc(hp) * s.arg0) / 100);
        if (!this.isDead) c.life = Math.max(1, c.life - hit(c.life));
        for (const m of this.monsters) if (m.mode !== 'DT' && m.mode !== 'DD' && Math.hypot(m.x - o.x, m.y - o.y) <= s.arg1) m.hp = Math.max(1, m.hp - hit(m.hp));
        // 그리고 신전에서 파이어볼(미사일 62) 16발: x·y = 1..4, 목표 = (홀수면 +5, 짝수면 −5) × x / y, 주인 = 플레이어, 레벨 = clvl/5 (1~8)
        // 근사(원작 미확인): dwFlags 3 의 목표 좌표를 신전 기준 상대 좌표로 본다
        const targets: Pt[] = [];
        for (let x = 1; x < 5; x++) for (let y = 1; y < 5; y++) targets.push({ x: o.x + (x & 1 ? 5 * x : -5 * x), y: o.y + (y & 1 ? 5 * y : -5 * y) });
        this.shrineMissiles(o, 'fireball', targets);
        break;
      }
      case 20:
        this.shrineWarp();
        break;
      case 21:
      case 22: {
        // 출처: D2GAME_SHRINES_Exploding / Poison — rand(Arg1 − Arg0) + Arg0 개의 투척 물약(opm / gpm)을 플레이어 옆에,
        //       그리고 신전에서 (±6, ±6)·(0, ±6) 쪽으로 미사일 6발 (45 explosivepotion / 48 chokinggaspoition), 주인 = 플레이어, 레벨 = clvl/5 (1~8)
        const cnt = o.rng.pick(s.arg1 - s.arg0) + s.arg0;
        for (let i = 0; i < cnt; i++) this.dropCode(code === 21 ? 'opm' : 'gpm', this.player.x, this.player.y);
        const ox = [-6, -6, 0, 0, 6, 6], oy = [6, -6, 6, -6, 6, -6];
        this.shrineMissiles(o, code === 21 ? 'explosivepotion' : 'chokinggaspoition', ox.map((x, i) => ({ x: o.x + x, y: o.y + (oy[i] as number) })));
        break;
      }
      default:
        // 16 Enirhs 는 InitFn 에서 18 로 바뀌어 나오지 않음
        this.events.push({ type: 'shrineUnsupported', code });
    }
  }

  /** 신전 미사일 (주인 = 플레이어, 신전 위치에서). 레벨 = 캐릭터 레벨 / 5 (1~8). 스킬이 있는 미사일(fireball)은 그 스킬 피해, 없으면 미사일 자체 피해 */
  private shrineMissiles(o: ObjectUnit, name: string, targets: Pt[]): void {
    const c = this.character, def = this.data?.missiles.get(name);
    if (!c || !def) return;
    const lvl = Math.min(8, Math.max(1, Math.trunc(c.level / 5)));
    const skill = this.skillFor(def);
    const s = skill ?? this.skillRecord(SKILL_ATTACK);
    if (!s) return;
    // 근사(원작 미확인): 원작은 신전(pOrigin) 칸에서 쏘아도 신전 자신과 부딪히지 않는다 — 여기서는 신전 크기 바깥에서 출발
    const off = Math.max(o.type.sizeX, o.type.sizeY) / 2 + 1;
    for (const t of targets) {
      const d = Math.hypot(t.x - o.x, t.y - o.y) || 1;
      const from = { x: o.x + ((t.x - o.x) / d) * off, y: o.y + ((t.y - o.y) / d) * off };
      this.spawnPlayerMissile(def, s, lvl, t.x, t.y, undefined, { srcDam: 0, useSkillDamage: !!skill, from });
    }
    this.events.push({ type: 'shrineMissiles', objectId: o.id, missile: name, count: targets.length });
  }

  /**
   * 변환 신전 (Warping, 코드 20): 플레이어에게 가장 가까운 일반 몬스터 하나를 유니크로.
   * 출처: D2GAME_SHRINES_Monster_6FC76ED0 + sub_6FC76F60 — 악한 몬스터, 살아 있고 중립/걷기 모드, 걷기 모드가 있고, 보스·프라임 이블이 아니며
   *       이미 특수(수식어 플래그 0x1F)가 아닌 것. nTypeFlag |= OTHER | UNIQUE, 수식어(sub_6FC6E940), 미니언 0 (D2GAME_SpawnMinions(…, 0, 0))
   * 근사(원작 미확인): 탐색 범위(UNITFINDS_GetNearestTestedUnit, 주변 방)를 현재 레벨 전체로, 수식어 굴림은 챔피언 없이
   */
  private shrineWarp(): void {
    const p = this.player, data = this.data;
    if (!data?.uniques) return;
    let best: MonsterUnit | undefined, bd = Infinity;
    for (const m of this.monsters) {
      if (m.pet || m.npc || m.mode === 'DT' || m.mode === 'DD' || (m.mode !== 'NU' && m.mode !== 'WL')) continue;
      if (!m.type.modes.has('WL') || m.type.boss || m.type.primeEvil || (m.flags & 0x1f) || m.states.has('conversion')) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (!best) return;
    best.flags |= MONFLAG.OTHER | MONFLAG.UNIQUE;
    best.umods = data.uniques.rollBossMods(best.type, best.rng, false, best.umods, this.difficulty).umods;
    this.spawnMinions(best, false, 0, 0);
    this.events.push({ type: 'shrineWarp', monsterId: best.id });
  }

  /** 출처: D2GAME_SHRINES_Gem_6FC76910 — 배낭의 보석 하나를 BetterGem 으로 (없으면 무작위 조각 보석 gcw/gcr/gcg/gcb/gcy/gcv) */
  private shrineGem(): void {
    const data = this.data;
    if (!data) return;
    for (const it of this.store.inventoryItems) {
      const b = data.items.base(it.code);
      if (!b || !data.items.isType(b, 'gem') || !b.betterGem || b.betterGem === 'non') continue;
      if (!data.items.base(b.betterGem)) continue;
      this.store.consume(it.id);
      this.dropCode(b.betterGem, this.player.x, this.player.y);
      return;
    }
    const codes = ['gcw', 'gcr', 'gcg', 'gcb', 'gcy', 'gcv'];
    this.dropCode(codes[this.rng.roll() % 6] as string, this.player.x, this.player.y);
  }

  // ---------------------------------------------------------------- 웨이포인트

  /** 레벨의 웨이포인트 위치 (DS1 프리셋 objects.txt SubClass 0x40) */
  waypointPos(levelId: string): { x: number; y: number } | null {
    const lv = this.findLevel(levelId)?.level, db = this.data?.objects;
    if (!lv || !db) return null;
    const live = lv.objects.find((o) => o.type.subClass & SUBCLASS.WAYPOINT);
    if (live) return { x: live.x, y: live.y };
    const p = (lv.def.objects ?? []).find((q) => (db.type(q.classId)?.subClass ?? 0) & SUBCLASS.WAYPOINT);
    return p ? { x: p.x + 0.5, y: p.y + 0.5 } : null;
  }

  private waypointNo(levelId: string): number {
    return this.waypointNoOf(this.findLevel(levelId)?.level.def.levelNo);
  }
  /** levels.txt Waypoint (전역 번호: Act 1 0~8, Act 2 9~17, Act 3 18~26, Act 4 27~29) */
  private waypointNoOf(levelNo: number | undefined): number {
    return levelNo === undefined ? 255 : (this.data?.objects?.levels.get(levelNo)?.waypoint ?? 255);
  }

  /**
   * 웨이포인트 활성 (OBJECTS_OperateFunction23_Waypoint 첫 부분: WAYPOINTS_ActivateWaypoint, 처음이면 작동 애니메이션)
   */
  private activateWaypoint(o: ObjectUnit): void {
    const no = this.waypointNo(this.level.def.id);
    if (no !== 255 && this.waypoints.activate(no)) this.events.push({ type: 'waypointActivated', no, level: this.level.def.id });
    if (o.mode === OBJMODE.NEUTRAL) {
      this.setMode(o, OBJMODE.OPERATING);
      this.scheduleEndAnim(o);
    }
  }

  /** 출처: OBJECTS_OperateFunction23_Waypoint — 활성 + (열려 있으면) 목록 패널 (packet 0x63) */
  private opWaypoint(o: ObjectUnit): void {
    this.activateWaypoint(o);
    this.waypointOpen = { levelId: this.level.def.id, objectId: o.id };
    this.events.push({ type: 'waypointMenu', objectId: o.id, level: this.level.def.id });
  }

  /** 웨이포인트는 클릭(조작)해야 활성 (opWaypoint). 여기서는 멀어지면 목록 패널만 닫는다 */
  private touchWaypoint(): void {
    const p = this.player;
    // 웨이포인트에서 멀어지면 목록 패널 대상 해제 (원작 SUNIT_ResetInteractInfo — 걸어서 벗어나면 패널이 닫힌다)
    const open = this.waypointOpen;
    if (open) {
      const src = open.levelId === this.level.def.id ? this.level.objects.find((o) => o.id === open.objectId) : undefined;
      if (!src || distanceToObject(src, p.x, p.y) > 6) this.waypointOpen = null;
    }
  }

  /**
   * 목록에서 고른 레벨로 이동. 출처: D2GAME_WAYPOINT_Unk_6FC79600 — 조작 중인 웨이포인트가 있어야 하고, 다른 레벨이며 활성된 웨이포인트여야 한다.
   * 도착 = 도착 레벨 웨이포인트 옆 (근사(원작 미확인): 원작 DUNGEON_FindActSpawnLocation(마을 13) 대신 웨이포인트 옆 가장 가까운 걷기 칸)
   */
  travelWaypoint(target: string | number): boolean {
    const open = this.waypointOpen;
    if (!open || open.levelId !== this.level.def.id || this.isDead) return false;
    const src = this.level.objects.find((o) => o.id === open.objectId);
    if (!src || distanceToObject(src, this.player.x, this.player.y) > 6) {
      this.waypointOpen = null;
      return false;
    }
    // 대상: 레벨 키 또는 levels.txt 번호. 다른 막이면 그 막 월드를 준비한다 (출처: D2GAME_WAYPOINT_Unk_6FC79600 — 막이 다르면 D2GAME_PlayerChangeAct)
    const levelNo = typeof target === 'number' ? target : this.findLevel(target)?.level.def.levelNo;
    const no = this.waypointNoOf(levelNo);
    if (levelNo === undefined || levelNo === this.level.def.levelNo || no === 255 || !this.waypoints.has(no)) return false;
    const targetAct = this.data?.objects?.levels.get(levelNo)?.act ?? this.act;
    let levelId = typeof target === 'string' ? target : this.levelKeyOf(levelNo);
    if (levelId === undefined || !this.findLevel(levelId)) {
      const st = this.ensureAct(targetAct);
      if (!st) return false;
      levelId = [...st.levels.values()].find((l) => l.def.levelNo === levelNo)?.def.id;
      if (levelId === undefined) return false;
    }
    const target_ = this.findLevel(levelId);
    if (!target_) return false;
    const targetLv = target_.level;
    // 다른 막이면 막부터 바꾼다 (첫 배치의 마을·퀘스트 판단이 그 막 기준이 되게). 실패하면 되돌린다
    const fromAct = this.act;
    if (target_.act !== fromAct) this.switchAct(target_.act);
    this.populate(targetLv);
    const wp = this.waypointPos(levelId);
    if (!wp) {
      if (this.act !== fromAct) this.switchAct(fromAct);
      return false;
    }
    const spot = nearestWalkable(targetLv.def.map, { x: wp.x, y: wp.y + 3 }, 12) ?? { x: Math.floor(wp.x), y: Math.floor(wp.y) };
    this.waypointOpen = null;
    this.changeLevel(levelId, spot.x + 0.5, spot.y + 0.5);
    this.events.push({ type: 'waypointTravel', level: levelId, no });
    return true;
  }

  // ---------------------------------------------------------------- 마을 포털

  /** 3×3 이 빈 칸 찾기 (COLLISION_GetFreeCoordinatesWithField 근사: 벽·오브젝트·문이 없는 3×3, 가까운 순) */
  private freeSpot(map: CollisionMap, x: number, y: number, size = 3, radius = 12): { x: number; y: number } | null {
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let r = 0; r <= radius; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const px = cx + dx, py = cy + dy;
          if (map.maskInBox(px, py, size, size, 0x01 | 0x0400 | 0x0800) === 0) return { x: px, y: py };
        }
    return null;
  }

  private townKey(): string | undefined {
    for (const l of this.levels.values()) if (l.def.inTown) return l.def.id;
    return undefined;
  }

  /**
   * 마을 포털 열기 (두루마리·책). 출처: SkillItem.cpp SKILLITEM_pSpell02_CastPortal — 마을이면 실패, 이전 포털 한 쌍을 닫고(sub_6FC7C170)
   *       Skills.cpp D2GAME_CreatePortalObject (현재 위치 3×3 빈칸, 오브젝트 59 모드 1) → D2GAME_CreateLinkPortal (마을 타일 정보 11 근처, 모드 2)
   */
  castTownPortal(): boolean {
    if (this.inTown || this.isDead) return false;
    this.closeTownPortal();
    const pair = this.createPortalPair(this.player.x, this.player.y, true);
    return pair;
  }

  /** 출처: PLAYER_Player.cpp sub_6FC7C170 — 플레이어의 마을 포털 한 쌍 제거 */
  private closeTownPortal(): void {
    const tp = this.townPortal;
    if (!tp) return;
    this.removeObject(tp.fieldLevel, tp.fieldId);
    this.removeObject(tp.townLevel, tp.townId);
    this.townPortal = null;
    this.events.push({ type: 'portalClosed', fieldLevelNo: this.findLevel(tp.fieldLevel)?.level.def.levelNo ?? 0 });
  }

  private removeObject(levelId: string, id: number): void {
    const lv = this.findLevel(levelId)?.level;
    if (!lv) return;
    const i = lv.objects.findIndex((o) => o.id === id);
    if (i < 0) return;
    const o = lv.objects[i] as ObjectUnit;
    if (o.blocking) lv.def.map.setUnitBox(Math.floor(o.x), Math.floor(o.y), o.type.sizeX, o.type.sizeY, objectCollisionBit(o.type), false);
    lv.objects.splice(i, 1);
  }

  private createPortalPair(x: number, y: number, owned: boolean): boolean {
    const town = this.townKey();
    const townLv = town ? this.levels.get(town) : undefined;
    if (!town || !townLv || this.level.def.inTown) return false;
    const here = this.level;
    const a = this.freeSpot(here.def.map, x, y);
    if (!a) return false;
    const field = this.createObject(here, { classId: OBJ.TOWN_PORTAL, x: a.x, y: a.y, mode: OBJMODE.OPERATING, preOperateLock: true });
    if (!field) return false;
    this.scheduleEndAnim(field);
    this.populate(townLv);
    const spot = townLv.def.portalSpot ?? { x: townLv.def.map.width / 2, y: townLv.def.map.height / 2 };
    const b = this.freeSpot(townLv.def.map, spot.x, spot.y, 3, 20) ?? { x: Math.floor(spot.x), y: Math.floor(spot.y) };
    const link = this.createObject(townLv, { classId: OBJ.TOWN_PORTAL, x: b.x, y: b.y, mode: OBJMODE.OPENED, preOperateLock: true });
    if (!link) return false;
    field.portal = { toLevel: town, linkId: link.id, linkLevel: town, owner: owned };
    link.portal = { toLevel: here.def.id, linkId: field.id, linkLevel: here.def.id, owner: owned };
    if (owned) this.townPortal = { fieldLevel: here.def.id, fieldId: field.id, townLevel: town, townId: link.id };
    this.events.push({ type: 'portalOpened', fieldLevel: here.def.id, fieldLevelNo: here.def.levelNo ?? 0, fieldId: field.id, townId: link.id, owned });
    return true;
  }

  /**
   * 포털 들어가기. 출처: ObjMode.cpp OBJECTS_OperateFunction15_Portal — 짝 포털 위치로 이동(COLLISION_GetFreeCoordinates),
   *       주인이 마을 쪽 포털을 타고 돌아오면(짝 id == 플레이어 고유 id) 두 포털 모두 사라진다
   */
  usePortal(o: ObjectUnit): void {
    const pt = o.portal;
    if (!pt || this.isDead) return;
    const dest = this.findLevel(pt.linkLevel)?.level;
    if (!dest) return;
    this.populate(dest);
    const link = dest.objects.find((x) => x.id === pt.linkId);
    const at = link ? { x: link.x, y: link.y } : { x: dest.def.map.width / 2, y: dest.def.map.height / 2 };
    const spot = nearestWalkable(dest.def.map, { x: at.x, y: at.y + 3 }, 12) ?? { x: Math.floor(at.x), y: Math.floor(at.y) };
    const tp = this.townPortal;
    const closing = !!tp && link?.id === tp.fieldId && o.id === tp.townId;
    this.changeLevel(pt.linkLevel, spot.x + 0.5, spot.y + 0.5);
    this.events.push({ type: 'portalTaken', to: pt.linkLevel });
    if (closing) this.closeTownPortal();
  }

  /**
   * 자동 수리(item_replenish_durability) · 수량 채움(item_replenish_quantity): 아이템마다 2500/v + 1 프레임 뒤 첫 +1,
   * 이후 max(2500/v + 1, 125) 프레임마다. 부서진 아이템은 수리되지 않는다. 가득 차면 멈췄다가 줄면 다시 (근사: 원작 재등록 시점 sub_6FC512C0).
   * 출처: D2MOO ItemMode.cpp sub_6FC4A2E0 / sub_6FC4A350, Items.cpp (EVENTTYPE_STATREGEN 등록)
   */
  private replenishItems(): void {
    const items = this.data?.items;
    if (!items) return;
    const all = [...this.store.allItems(), ...Object.values(this.store.altWeapons).filter((x): x is ItemInstance => !!x)];
    for (const it of all) {
      if (!it.identified) continue;
      const dur = statOf(it, 'item_replenish_durability'), qty = statOf(it, 'item_replenish_quantity');
      if (dur <= 0 && qty <= 0) continue;
      const b = items.base(it.code);
      const durOk = dur > 0 && !isBroken(it) && it.maxDurability > 0 && it.durability < it.maxDurability;
      const qtyOk = qty > 0 && !!b?.stackable && it.quantity < b.maxStack;
      if (!durOk && !qtyOk) {
        this.replenishAt.delete(it.id);
        continue;
      }
      const v = durOk ? dur : qty;
      const next = this.replenishAt.get(it.id);
      if (next === undefined) {
        this.replenishAt.set(it.id, this.tickCount + Math.trunc(2500 / v) + 1);
        continue;
      }
      if (this.tickCount < next) continue;
      if (durOk) it.durability++;
      else it.quantity++;
      this.replenishAt.set(it.id, this.tickCount + Math.max(Math.trunc(2500 / v) + 1, 125));
    }
  }

  private regen(): void {
    this.replenishItems();
    // 용병 생명 재생: STAT_HPREGEN = 최대 생명(<<8) / 2000 (1/256 단위, 매 프레임). 출처: MONSTERAI_UpdateMercStatsAndSkills
    // 근사(원작 미확인): 재생 적용 주기 — 매 프레임
    const mu = this.mercUnit();
    if (mu && this.mercInfo && mu.hp < mu.stats.maxHp) mu.hp = Math.min(mu.stats.maxHp, mu.hp + this.mercInfo.hpRegen / 256);
    // 용병이 마신 치료 물약 (mercPotion — 1/256 단위 매 프레임)
    const pot = mu?.states.get('healthpot');
    if (mu && pot) {
      if (this.tickCount >= pot.until) mu.states.remove('healthpot');
      else mu.hp = Math.min(mu.stats.maxHp, mu.hp + (pot.stats.potion ?? 0) / 256);
    }
    for (const m of this.monsters) {
      if (m.mode === 'DT' || m.mode === 'DD') continue;
      const poison = m.states.stat('hpregen');
      if (poison < 0) {
        m.hp += poison / 256;
        if (m.hp <= 0) {
          this.killMonster(m);
          continue;
        }
        continue;
      }
      // 회복 불가 (item_preventheal): 양수 재생을 막는다 (출처: MonsterMode.cpp:587 STATE_PREVENTHEAL)
      if (m.hp >= m.stats.maxHp || !m.hpRegen || m.states.has('preventheal')) continue;
      // Phase 5: Baboon·Bat Demon 쉬는 동안 재생 × (1 + regenX8 / 8)
      m.hp = Math.min(m.stats.maxHp, m.hp + ((m.stats.maxHp * m.type.damageRegen) / 4096) * (1 + (m.regenX8 ?? 0) / 8));
    }
    const c = this.character;
    // 플레이어 독: 상태 hpregen (1/256/프레임) 만큼 감소 (출처: SUNITDMG_ApplyPoisonDamage)
    const ppois = this.player.states.get('poison')?.stats.hpregen ?? 0;
    if (c && ppois < 0 && !this.isDead) {
      c.life = Math.max(0, c.life + ppois / 256);
      if (c.life <= 0) this.playerDie();
    }
    // 물약: 매 프레임 회복 (1/256 단위)
    if (c && !this.isDead) {
      const hp = this.player.states.get('healthpot'), mp = this.player.states.get('manapot');
      if (hp) c.life = Math.min(this.maxLife(), c.life + (hp.stats.potion ?? 0) / 256);
      if (mp) c.mana = Math.min(this.maxMana(), c.mana + (mp.stats.potion ?? 0) / 256);
    }
    if (c) {
      // 장비를 벗어 최대치가 줄면 현재 값도 줄인다
      c.life = Math.min(c.life, this.maxLife());
      c.mana = Math.min(c.mana, this.maxMana());
    }
    if (c) {
      // 최대치가 줄면(장비·상태 해제) 현재 스태미나도 (물약은 최대 + 1 까지 채운다)
      const ms = this.maxStamina();
      if (c.stamina > ms + 1) c.stamina = ms;
      this.regenStamina();
    }
    if (c && this.player.mode !== 'DT' && this.player.mode !== 'DD' && c.mana < this.maxMana()) {
      // Warmth: manarecoverybonus % 만큼 마나 재생 증가 (출처: itemstatcost.txt manarecoverybonus)
      const bonus = this.playerStat('manarecoverybonus');
      const mm = this.maxMana();
      c.mana = Math.min(mm, c.mana + (((256 * mm) / (25 * 120)) / 256) * (100 + bonus) / 100);
    }
  }
}

interface MeleeSpec {
  /** 스킬 명중 보너스 % */
  toHitPct: number;
  /** 스킬 피해 강화 % (calc1) */
  enDmgPct: number;
  /** 추가 물리 피해 (1/256) */
  flat256: number;
  elem: { eType: string; amount: number; len: number } | null;
  /** 스킬 HitClass (0 = 무기) */
  hitClass: number;
  srcDam: number;
  /** Smite: 무기 대신 방패 피해, 항상 명중, 기절 */
  shield?: boolean;
  stunLen?: number;
  /** Vengeance: 무기 기본 피해의 % 를 원소 피해로 추가 (+ 냉기 지속) */
  vengeance?: { fire: number; cold: number; ltng: number; coldLen: number };
  /** Sacrifice: 준 물리 피해의 % 만큼 자신도 피해 */
  selfDamagePct?: number;
  /** 근접 판정 거리 (Whirlwind: 반경 5) */
  reach?: number;
  /** 물리 → 원소 변환 % (Berserk·Frenzy: 마법). 출처: D2DamageStrc dwConvPct / nConvType */
  convPct?: number;
  convType?: string;
  /** 무기 피해에 더하는 스킬 피해 (Blade Shield: 스킬 물리·원소) */
  extra?: DamagePacket;
  /** 무술 차지 보너스: Cobra 흡수 %, 속성 차지의 물리 → 원소 변환·빙결 (출처: SkillAss.cpp sub_6FCF5870 / sub_6FCF5BC0) */
  leech?: { life: number; mana: number };
  prgConv?: { pct: number; eType: string }[];
  freezeDiv?: number;
  /** 발차기 (Dragon Talon·Tail·Flight): 무기 대신 장화 피해 + 스킬 물리, hitclass 1 (출처: SkillAss.cpp sub_6FCF7CE0) */
  kick?: { s: SkillRecord; lvl: number };
  /** 명중하면 밀쳐내기 */
  knockback?: boolean;
  /** 물리 피해 % 가감 (Hunger calc1 = −75). 출처: SKILLS_SrvDo122_Hunger (dwPhysDamage += % calc1) */
  physPct?: number;
}

/** 소환 선택 사항: 정확한 칸(뼈 감옥), 기본 생명(Decoy·Hydra), 펫 레벨(Decoy·Revive) */
interface SummonOpts { exact?: boolean; hpBase?: number; level?: number; /** 스킬 passivestat·aurastat·calc1 생명 보너스를 붙이지 않는다 (그림자 — SrvDo049 가 따로) */ noBonus?: boolean }

/** 저항 스탯 이름 → 몬스터 저항 칸 */
/** 피해 칸(물리·원소·마법)을 pct % 로. 출처: SUnitDmg.cpp — nDamagePercent != 100 이면 양수 피해 칸마다 MONSTERUNIQUE_CalculatePercentage (길이 칸 제외) */
function scaleDamage(d: DamagePacket, pct: number): DamagePacket {
  const f = (v: number) => (v > 0 ? Math.trunc((v * pct) / 100) : v);
  return { ...d, phys: f(d.phys), fire: f(d.fire), ltng: f(d.ltng), cold: f(d.cold), pois: f(d.pois), mag: f(d.mag) };
}

const RESIST_STAT: Record<string, string> = { fireresist: 'fi', lightresist: 'li', coldresist: 'co', poisonresist: 'po', magicresist: 'ma', damageresist: 'dm' };

interface PlayerMissileOpts {
  /** 무기 피해 반영 (128 = 100%, 0 = 없음) */
  srcDam: number;
  /** 스킬 물리/원소 피해를 더함 */
  useSkillDamage: boolean;
  thrown?: boolean;
  toHitPct?: number;
  damagePct?: number;
  homing?: boolean;
  wander?: boolean;
  from?: Pt;
  /** 수명(프레임) 지정 (Inferno: calc1) */
  range?: number;
  /** 속도 지정 (Nova: 미사일 속도 + calc1) */
  velocity?: number;
  group?: Set<number>;
  chain?: { left: number; range: number };
  /** Blessed Hammer 나선 경로 */
  spiral?: boolean;
  /** Bone Spirit / Guided Arrow 를 대상 없이: 목표 지점 뒤 반경 안 적 탐색 */
  seek?: { tx: number; ty: number; radius: number };
  /** 이미 맞힌 것으로 칠 유닛 (연쇄 번개가 방금 맞은 대상 안에서 생겨 다시 맞히지 않게) */
  skipIds?: number[];
  /** 미사일 자신의 피해 (missiles.txt EMin~EMax + 레벨·시너지) — 무술 차지 풀기 미사일 */
  ownDamage?: boolean;
}

/** 미사일이 유닛에 닿는 거리 */
const reachOf = (d: MissileDef, m: MonsterUnit): number => (d.size + 1) / 2 + m.type.sizeX / 2;
/** 지면 불 미사일 (Blaze·Fire Wall: pSrvDmgFunc 3, 제자리에서 닿는 적에게 매 프레임 피해) */
const isGroundFire = (d: MissileDef): boolean => d.srvDmgFunc === 3 || d.srvDoFunc === 5;
/** 지속 피해 미사일 (Inferno 불꽃: DamageRate 가 있고 관통) */
const isContinuous = (d: MissileDef): boolean => isGroundFire(d) || (d.damageRate > 0 && !d.collideKill);

/** 경로의 처음 steps 개 곧은 구간 (원작 PATH_SetStepNum — 경로 점 사이 한 구간씩) */
function firstSegments(path: Pt[], steps: number): Pt[] {
  if (steps <= 0 || path.length <= 1) return path;
  let seg = 1, pdx = NaN, pdy = NaN;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Pt, b = path[i] as Pt;
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    if (i > 1 && (dx !== pdx || dy !== pdy)) {
      seg++;
      if (seg > steps) return path.slice(0, i);
    }
    pdx = dx;
    pdy = dy;
  }
  return path;
}

/**
 * 담금질할 수 있는 아이템. 출처: D2Common Items.cpp ITEMS_IsImbueable — 골드 아님, bitfield1 & 1, (클래식) 던지는 무기 아님,
 *   퀘스트 아이템 아님 (Wirt 의 다리 'leg' 는 가능), 소켓 없음.
 * 근사(원작 미확인): D2MOO 디컴파일의 품질 조건(4~9)은 원작 동작(흰 아이템만 담금질)과 반대로 보여 — 하급·보통·상급(1~3)만 허용
 */
export function imbueable(items: ItemDb, it: ItemInstance): boolean {
  const b = items.base(it.code);
  if (!b || b.code === 'gld' || !(b.bitfield1 & 1)) return false;
  if ([...items.typeChain(b.type)].some((t) => items.types.get(t)?.throwable)) return false;
  if (b.quest && b.code !== 'leg') return false;
  if (it.sockets > 0 || it.socketed.length) return false;
  return it.quality <= QUALITY.SUPERIOR;
}

export { aiDistance };

/** 실효 속도 보너스 EF = ⌊120 × v / (120 + v)⌋ (FHR·FBR). 출처: D2MOO Units.cpp */
export function effectiveRate(v: number): number {
  return v > 0 ? Math.trunc((120 * v) / (120 + v)) : 0;
}

/**
 * 상처 악화 hpregen (1/256/프레임, +40 전): 레벨 구간마다 9·18·27·36·45 씩.
 * 출처: D2MOO SKILLITEM_CalculateOpenWoundsHpRegen (SkillItem.cpp:1296)
 */
export function openWoundsRegen(level: number): number {
  const L = Math.max(1, level);
  const steps = [9, 18, 27, 36, 45];
  let v = 0, prev = 1;
  for (let i = 0; i < steps.length; i++) {
    const top = i < 4 ? 15 * (i + 1) : Infinity;
    if (L <= top) return v + (steps[i] as number) * (L - prev);
    v += (steps[i] as number) * (top - prev);
    prev = top;
  }
  return v;
}
