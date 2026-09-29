// 게임 시뮬레이션: 명령 큐 → 고정 25fps 틱 → 이벤트 + 읽기 전용 스냅샷. (DOM/렌더 비의존)
import type { Command } from './command';
import type { CollisionMap } from './collision';
import { dir64, SUBTILES_PER_YARD, type Pt } from './geom';
import { ENGINE_FPS } from './index';
import { findPath, nearestWalkable, type WalkMap } from './path';
import { Rng } from './rng';
import type { AnimData } from '../formats/animdata';
import { actionFrame } from '../formats/animdata';
import type { ItemBase, ItemDb } from './items';
import { QUALITY, type ItemInstance, type TreasureDb } from './treasure';
import type { MonsterDb, MonsterStats, MonsterType, MonSeqFrame } from './monster';
import { aiDistance, isInMeleeRange, modeTiming, rollGetHit, rollMonsterStats } from './monster';
import { aiName, escape, hasAi, idle, MONMODE_INDEX, think, thinkNpc, walkToTarget, type AiWorld, type MonCast, type MonMode, type MonsterUnit, type NpcPathNode, type PetInfo, type SkillTarget } from './ai';
import { applyUModInit, MONFLAG, rollMinionCount, UMOD, xferMods, type UniqueDb, type UModContext } from './uniques';
import { addExperience, spendStat, type Character, type ClassName, type ClassStats, type ExpTable } from './player';
import { blockChance, hitChance, playerAttackRating, playerDefense, rollDamage, rollPercent } from './combat';
import { adjustedExperience } from './experience';
import { StateList } from './states';
import { ItemStore } from './itemstore';
import { computeDerived, type Derived } from './charstats';
import { gemStats } from './itemgen';
import type { TxtRow } from '../formats/txt';
import type { NpcPrice } from './price';
import type { Placed } from './inventory';
import type { MissileDef } from './missiles';
import { missileParam } from './missiles';
import type { SkillDb, SkillRecord } from './skills/db';
import { levelDamageBonus, type SkillCalc, type SkillOwner } from './skills/formulas';
import { characterOwner, learnSkill, masteryBonus, passiveStat, passiveStats, type PassiveStat } from './skills/rules';
import { addElemental, applyMonsterResists, emptyDamage, totalDamage, type DamagePacket } from './skills/damage';
import { rollCritical, rollWeaponDamage, weaponBaseRange } from './skills/player-damage';
import { PLAYER_SEQUENCES, type SeqFrame } from './skills/sequences';
import { evalCalc } from './skills/calc';
import {
  OBJ, OBJMODE, SUBCLASS, animFrames, objectCollisionBit, chestDropRolls, chestTcName, distanceToObject, initObject, newRegion, populateRoomObjects, presetObject,
  setObjectMode, updateObjectCollision, wellAfterUse, wellRegen, type ObjectDb, type ObjectRegion, type ObjectSpawn, type ObjectUnit, type PopulateRoom,
} from './objects';
import { WaypointFlags } from './waypoints';
import { AutomapReveal } from './automap';
import { mercExpGain, mercLevelFor, mercStats, resurrectCost, type HirelingDb, type MercSave, type MercStats } from './hireling';
import { NPC_DEFS, NpcServices, type HireCandidate, type NpcOption, type TradeHost } from './npc';
import type { StoreItem } from './shop';
import type { GambleTable } from './shop';

/**
 * 원작 플레이어 애니메이션 모드 토큰: NU 대기, WL 걷기, RN 달리기, TN/TW 마을, A1/A2 공격, SC 시전, TH 던지기,
 * S1~S4 특수, KK 발차기, SQ 시퀀스(스킬 전용 프레임 조합), GH 피격, DT 사망, DD 시체
 */
export type PlayerMode = string;

// 출처: 원작 MPQ 경로 data\global\CHARS\<토큰>\ (AM, SO, NE, PA, BA)
export const CLASS_TOKEN: Record<ClassName, string> = { Amazon: 'AM', Sorceress: 'SO', Necromancer: 'NE', Paladin: 'PA', Barbarian: 'BA' };
const PLAYER_SIZE = 2;
const PICKUP_RANGE = 2;
/** 스킬 Id: 일반 스킬 (skills.txt 0~5) */
export const SKILL_ATTACK = 0;
export const SKILL_THROW = 2;

export interface GameData {
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
  /** gamble.txt 선택표 (도박) */
  gamble?: GambleTable;
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
  inTown?: boolean;
  /** 인벤토리 — 자리 없이 주면 벨트/빈 자리에 자동 배치, 자리 있으면 그대로 */
  inventory?: ItemInstance[];
  inventoryGrid?: Placed[];
  stash?: Placed[];
  belt?: (ItemInstance | null)[];
  gold?: number;
  /** 창고 골드 */
  stashGold?: number;
  /** 난이도 0 Normal / 1 Nightmare / 2 Hell (DifficultyLevels.txt 행) */
  difficulty?: 0 | 1 | 2;
  /** 저장된 시체 (게임을 나갔다 들어오면 시작 위치 옆에 놓인다) */
  corpse?: Record<string, ItemInstance>;
  /** 여러 레벨 (지정 시 map/inTown 대신 사용). 첫 레벨이 시작 레벨 */
  levels?: LevelDef[];
  /** 활성 웨이포인트 번호 (levels.txt Waypoint). 0(마을)은 항상 활성 */
  waypoints?: number[];
  /** 저장된 용병 */
  merc?: MercSave | null;
  /** 끝낸 퀘스트 상태 (NPC 기능 조건: 'a1q2' Blood Raven 보상, 'cain' Cain 구출 — Phase 10 Step 2 퀘스트가 채운다) */
  quests?: string[];
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
  presetMonsters?: { id: number; x: number; y: number; path?: (Pt & { action?: number })[]; code?: string }[];
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

export interface PlayerSnapshot {
  id: number; x: number; y: number; mode: PlayerMode; dir: number; modeTick: number;
  /** 시퀀스(SQ) 스킬 중이면 지금 그릴 모드·프레임 */
  anim?: { mode: string; frame: number };
  life: number; maxLife: number; mana: number; maxMana: number; level: number; experience: number; gold: number;
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
  /** 마을 NPC·장식 (공격 불가), 말을 걸 수 있음, 플레이어의 용병 */
  npc?: boolean; interact?: boolean; merc?: boolean;
}
/** NPC 와 대화 중 (메뉴·상점·도박·고용 목록) */
export interface InteractionSnapshot {
  npcId: number; typeId: string;
  mode: 'menu' | 'trade' | 'gamble' | 'hire';
  options: NpcOption[];
  /** 상점·도박 목록 (mode trade/gamble) */
  store: readonly StoreItem[];
  /** 이 NPC 가 수리함 (Charsi) */
  repair: boolean;
  /** 고용 후보 (mode hire) */
  hire: readonly HireCandidate[];
}
/** 용병 (왼쪽 위 생명 막대) */
export interface MercSnapshot { id: number | null; name: string; level: number; hp: number; maxHp: number; dead: boolean; experience: number; nextExp: number }
export interface GroundItemSnapshot { id: number; code: string; quality: number; quantity: number; x: number; y: number }
export interface MissileSnapshot { id: number; name: string; x: number; y: number; dir: number; celFile: string; frame: number }
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
}

/** 저주 상태 (한 몬스터에 하나만). 출처: states.txt curse = 1 (클래식 네크로맨서 저주) */
const CURSE_STATES = ['amplifydamage', 'dimvision', 'weaken', 'ironmaiden', 'terror', 'confuse', 'lifetap', 'attract', 'decrepify', 'lowerresist'];

/** 원작 미사일 Vel(프레임당 픽셀) → 프레임당 서브타일. 출처: Phrozen Keep KB a=463 — Yards = Vel × Range / 32 */
const missileStep = (vel: number): number => (vel / 32) * SUBTILES_PER_YARD;

export class Game {
  readonly rng: Rng;
  readonly data: GameData | undefined;
  readonly character: Character | undefined;
  readonly classStats: ClassStats | undefined;
  private readonly expTable: ExpTable | undefined;
  /** 인벤토리 격자·창고·벨트·장착·커서 */
  readonly store: ItemStore;
  /** 장착이 바뀌어 파생 스탯을 다시 계산해야 함 */
  private statsDirty = true;
  private derivedCache: Derived | null = null;
  private derivedKey = '';
  gold = 0;
  stashGold = 0;
  readonly difficulty: 0 | 1 | 2;
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
  private readonly levels = new Map<string, LevelState>();
  private level: LevelState;
  /** 출구로 막 넘어옴: 도착 칸을 덮는 출구는 벗어날 때까지 무시 */
  private exitHold = false;
  private nextUnitId = 100;
  private events: GameEvent[] = [];
  private passiveCache: { key: string; list: PassiveStat[] } | null = null;
  /** 플레이어 소환수 (레벨을 옮겨 다녀도 따라온다) */
  readonly pets: MonsterUnit[] = [];
  /** 켜져 있는 오라 (오른쪽 버튼의 오라 스킬) */
  private aura: { skill: SkillRecord; lvl: number; next: number } | null = null;
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
  private talk: { levelId: string; npcId: number; mode: InteractionSnapshot['mode'] } | null = null;
  /** 끝낸 퀘스트 상태 ('a1q2' Blood Raven 보상 → Kashya 고용, 'cain' Cain 구출 → 마을에 Cain·무료 감정, 'q<번호>' npc.txt questflag) */
  readonly quests: Set<string>;
  /** 용병 기록 (죽어도 남는다 — 부활 대상). unitId = 살아 있는 유닛 */
  merc: (MercSave & { unitId: number | null }) | null = null;
  private mercInfo: MercStats | null = null;

  constructor(init: GameInit) {
    const defs = init.levels ?? [{ id: 'main', map: init.map, inTown: init.inTown ?? false, exits: [] }];
    for (const d of defs) {
      this.levels.set(d.id, {
        def: d, monsters: [], ground: [], missiles: [], populated: false, npcs: [], objects: [], region: null, variants: new Map(),
        automap: new AutomapReveal(Math.ceil(d.map.width / 5), Math.ceil(d.map.height / 5)),
      });
    }
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
    // 위치가 있는 인벤토리는 그대로, 없는 것(x < 0, 예전 저장)은 빈 자리에 자동 배치
    const placed = (init.inventoryGrid ?? []).filter((p) => p.x >= 0);
    const loose = [...(init.inventoryGrid ?? []).filter((p) => p.x < 0).map((p) => p.item), ...(init.inventory ?? [])];
    this.store = new ItemStore(init.data?.items, { inventory: placed, stash: init.stash, belt: init.belt, equipment: init.equipment });
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
    this.quests = new Set(init.quests ?? []);
    // 저장된 용병: 게임을 시작하면 플레이어 곁에 (죽은 용병은 기록만 — 부활 대상). 출처: D2GAME_MERCS_Create_6FCC8630
    if (init.merc) {
      this.merc = { ...init.merc, unitId: null };
      if (!init.merc.dead) this.spawnMerc(p.x + 1, p.y + 1);
    }
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

  /** 레벨 전환: 진행 중 행동 취소, 첫 방문이면 몬스터 배치 */
  changeLevel(id: string, x: number, y: number): void {
    const next = this.levels.get(id);
    if (!next) throw new Error(`unknown level ${id}`);
    this.exitHold = false;
    this.closeTalk();
    // 마을에 플레이어가 없으면 상인 재고를 비운다 (출처: SUNITPROXY_UpdateVendorInventory)
    if (this.level.def.inTown && !next.def.inTown) this.npc.leaveTown();
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
   * 시체 만들기: 커서·장착 아이템(bodyloc −1 ~ 12)을 시체로 옮기고, 잃은 경험치의 75% 를 시체에 저장.
   * 이미 시체가 있으면 원작은 여러 개를 두지만(최대 15) 여기서는 이전 시체 아이템을 합친다 (근사).
   * 출처: D2GAME_CORPSE_Handler_6FC7FBD0 — STAT_EXPERIENCE = 75 × expLoss / 100
   */
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
      if (slot in { head: 1, neck: 1, tors: 1, rarm: 1, larm: 1, rrin: 1, lrin: 1, belt: 1, feet: 1, glov: 1 } && !st.equipment[slot]) st.equipment[slot] = it;
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
    if (level.def.inTown && this.quests.has('cain')) this.spawnCain();
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
    this.updatePlayer();
    this.checkExits();
    this.updateObjects();
    this.touchWaypoint();
    this.level.automap.revealAround(this.player.x, this.player.y);
    this.updateMonsters();
    this.updateNpcs();
    this.updatePets();
    this.updateMissiles();
    this.regen();
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
        life: c?.life ?? 0, maxLife: this.maxLife(), mana: c?.mana ?? 0, maxMana: this.maxMana(),
        level: c?.level ?? 1, experience: c?.experience ?? 0, gold: this.gold,
        states: p.states.names(), leftSkill: c?.leftSkill ?? 0, rightSkill: c?.rightSkill ?? 0,
      },
      monsters: [...this.monsters, ...this.pets, ...this.level.npcs].map((m) => {
        const anim = this.monsterSeqAnim(m);
        const ut = this.uniqueTrans(m);
        return {
          id: m.id, typeId: m.type.id, code: m.type.code, x: m.x, y: m.y, mode: m.mode, dir: m.dir, modeTick: this.tickCount - m.modeStart,
          hp: m.hp, maxHp: m.stats.maxHp, states: m.states.names(), ...(m.pet ? { ally: true } : {}),
          ...(m.npc ? { npc: true, interact: m.npc.interact } : {}), ...(m.pet?.hireling ? { merc: true } : {}),
          flags: m.flags, umods: [...m.umods], nameSeed: m.nameSeed, ...(m.superUnique !== undefined ? { superUnique: m.superUnique } : {}),
          ...(m.components ? { components: m.components } : {}), ...(ut !== undefined ? { uniqueTrans: ut } : {}), ...(anim ? { anim } : {}),
        };
      }),
      items: this.ground.map((g) => ({ id: g.item.id, code: g.item.code, quality: g.item.quality, quantity: g.item.quantity, x: g.x, y: g.y })),
      missiles: this.missiles.map((m) => ({ id: m.id, name: m.def.name, x: m.x, y: m.y, dir: dir64(m.dx, m.dy), celFile: m.def.celFile, frame: m.age % m.def.animLen })),
      objects: this.level.objects.map((o) => ({
        id: o.id, classId: o.type.id, token: o.type.token, name: o.type.name, x: o.x, y: o.y, mode: o.mode, modeTick: this.tickCount - o.modeStart,
        selectable: !!o.type.selectable[o.mode], subClass: o.type.subClass, ...(o.portal ? { portalTo: o.portal.toLevel } : {}),
      })),
      inventory: [...this.inventory],
      interaction: this.interactionSnapshot(),
      merc: this.mercSnapshot(),
    };
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
    const row = d.difficultyRows?.[this.difficulty];
    return { db: d.uniques, monsters: d.monsters, difficulty: this.difficulty, championDmgBonus: Number(row?.ChampionDamageBonus ?? 90) || 90 };
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
  /** 완료한 퀘스트 (TCQuestId — 퀘스트 드롭 한 번). 근사: Phase 10 퀘스트 기록 전까지 게임 안에서만 */
  readonly questsDone = new Set<number>();

  /**
   * 슈퍼유니크. 출처: D2GAME_SpawnSuperUnique_6FC6F690 — AutoPos 면 방 안 무작위 지점, 한 게임에 한 번 (Stacks 0),
   * UNIQUE|SUPERUNIQUE, 수식어 = SuperUniques Mod1~3 (Thief 제외), 미니언 MinGrp~MaxGrp, Countess 는 특수 AI, 퀘스트 수식어 22
   */
  spawnSuperUnique(idx: number, x: number, y: number, path?: Pt[]): MonsterUnit | null {
    const data = this.data;
    const su = data?.uniques?.superUnique(idx);
    if (!data || !su || !data.monsters.types.has(su.cls)) return null;
    if (!su.stacks && this.bossFlags.has(su.idx)) return null;
    const t = data.monsters.get(su.cls);
    let pos: Pt | null = { x: x + 0.5, y: y + 0.5 };
    if (su.autoPos) {
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
    // 출처: D2GAME_BOSSES_AssignUMod_6FC6FF10(…, MONUMOD_QUESTMOD, 1)
    if (m.umods.length < 9) m.umods.push(UMOD.QUESTCOMPLETE);
    return m;
  }

  /**
   * DS1 프리셋 몬스터. 출처: D2GAME_SpawnPresetMonster_6FC66560 — 슈퍼유니크, monstats 몬스터 (파티 포함), monplace:
   * 2 유니크 무리(umon, 챔피언 없음), 3 챔피언(umon + 1~3 챔피언), 5 Blood Raven, 17 Fallen, 18 Fallen Shaman (D2Common_11063 레벨 계열 + 레벨 보정)
   */
  private spawnPreset(p: { id: number; x: number; y: number; path?: (Pt & { action?: number })[]; code?: string }): void {
    const data = this.data, info = this.level.def.monsterInfo;
    if (!data?.uniques) return;
    const npcPath = (): NpcPathNode[] => (p.path ?? []).map((q) => ({ x: q.x + 0.5, y: q.y + 0.5, action: q.action ?? 1 }));
    // 하드코딩 프리셋 (Blood Moor Flavie 'navi' — DRLGPRESET_SpawnHardcodedPresetUnits)
    if (p.code) {
      this.spawnNpc(p.code, p.x, p.y, npcPath());
      return;
    }
    const k = data.uniques.preset(info?.act ?? 1, p.id);
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
      spawnAt(k.id);
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

  /** 경험치 얻기 (레벨업 이벤트 포함) */
  private gainExperience(exp: number): void {
    const c = this.character, cs = this.classStats, table = this.expTable;
    if (!c || !cs || !table) return;
    const gained = addExperience(c, cs, table, exp);
    this.events.push({ type: 'experience', amount: exp });
    if (gained > 0) {
      this.passiveCache = null;
      this.events.push({ type: 'levelUp', level: c.level });
    }
  }

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
        const r = this.store.move(cmd.itemId, cmd.to, { cls: c.cls, level: c.level, str: this.effStat('str'), dex: this.effStat('dex') });
        if (!r.ok) {
          this.events.push({ type: 'itemMoveFailed', itemId: cmd.itemId, reason: r.reason });
          return;
        }
        if (cmd.to.kind === 'ground') this.dropItem(found.item, p.x, p.y);
        if (cmd.to.kind === 'socket') {
          // 박힌 보석은 대상 종류에 맞는 속성을 갖는다 (gems.txt)
          const target = this.store.find(cmd.to.itemId);
          const tb = target ? this.data?.items.base(target.item.code) : undefined;
          const gen = this.data?.treasure.gen;
          if (tb && gen) found.item.stats = gemStats(gen, found.item, tb);
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
      case 'closeNpc': {
        this.closeTalk();
        return;
      }
      case 'waypoint': {
        this.travelWaypoint(cmd.level);
        return;
      }
      case 'setSkill': {
        const s = this.data?.skills?.byId.get(cmd.skill);
        if (!c || !s || !this.canSelectSkill(s, cmd.hand)) return;
        if (cmd.hand === 'left') c.leftSkill = s.id;
        else c.rightSkill = s.id;
        return;
      }
      default:
        this.events.push({ type: 'unhandledCommand', command: cmd.type });
    }
  }

  /** 버튼에 올릴 수 있는 스킬: 배운 액티브 스킬 또는 일반 스킬(Attack, Throw). 왼쪽은 leftskill 플래그 필요 */
  canSelectSkill(s: SkillRecord, hand: 'left' | 'right'): boolean {
    if (s.passive) return false;
    if (hand === 'left' && !s.leftSkill) return false;
    if (s.id === SKILL_ATTACK || s.id === SKILL_THROW) return true;
    return (this.character?.skills[s.id] ?? 0) > 0;
  }

  private isBusy(): boolean {
    const p = this.player;
    return p.cast !== null || (p.mode === 'GH' && this.tickCount < p.modeEnd);
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
    p.running = run;
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
    const base = this.weaponBase();
    return (base?.wclass || 'hth').toUpperCase();
  }

  private playerToken(): string {
    return this.character ? CLASS_TOKEN[this.character.cls] : 'BA';
  }

  private owner(): SkillOwner {
    return this.character ? characterOwner(this.character) : { baseLevel: () => 0, skillLevel: () => 0, unitLevel: 1 };
  }

  private passives(): PassiveStat[] {
    const c = this.character, db = this.data?.skills, calc = this.data?.skillCalc;
    if (!c || !db || !calc) return [];
    const aura = this.aura?.skill.id ?? -1;
    const key = JSON.stringify(c.skills) + c.level + ':' + aura;
    if (this.passiveCache?.key !== key) this.passiveCache = { key, list: passiveStats(c, db, calc, aura) };
    return this.passiveCache.list;
  }

  /** 플레이어 스탯 = 패시브 스킬 + 상태(버프) */
  private playerStat(stat: string): number {
    return passiveStat(this.passives(), stat) + this.player.states.stat(stat);
  }

  /**
   * 파생 스탯 (기본 + 장착). 장착·레벨·스탯 포인트가 바뀌면 다시 계산.
   */
  derived(): Derived | null {
    const c = this.character, cs = this.classStats, data = this.data;
    if (!c || !cs || !data) return null;
    const key = `${c.level}:${c.str}:${c.dex}:${c.vit}:${c.ene}:${c.maxLife}:${c.maxMana}`;
    if (this.statsDirty || !this.derivedCache || key !== this.derivedKey) {
      this.derivedCache = computeDerived(c, cs, this.equipment, data.items, data.treasure.gen);
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
  maxLife(): number {
    return this.derived()?.maxLife ?? this.character?.maxLife ?? 0;
  }
  maxMana(): number {
    return this.derived()?.maxMana ?? this.character?.maxMana ?? 0;
  }

  private playerDefenseValue(): number {
    const c = this.character;
    if (!c) return 0;
    const d = this.derived();
    const armor = Object.values(this.equipment).reduce((s, it) => s + it.defense, 0);
    const base = d ? d.defense : playerDefense(c.dex, armor);
    // 출처: itemstatcost.txt skill_armor_percent — 방어력 % 증가 (Iron Skin, Shout, Concentrate)
    return Math.trunc((base * (100 + this.playerStat('skill_armor_percent'))) / 100);
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
    if (mode === 'GH' || mode === 'DT') {
      if (!this.data) p.modeEnd = this.tickCount + 10;
      else p.modeEnd = this.tickCount + modeTiming(this.data.anim, this.playerToken(), mode, this.weaponWclass(), speedPercent, false).duration;
    }
  }

  private updatePlayer(): void {
    const p = this.player;
    if (p.mode === 'DD') return;
    if (p.mode === 'DT') {
      if (this.tickCount >= p.modeEnd) p.mode = 'DD';
      return;
    }
    if (p.cast) {
      this.updateCast(p.cast);
      if (p.cast) return;
    }
    if (p.mode === 'GH') {
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

  /** 1프레임 이동량 (서브타일) = 속도(야드/초) × 1.5 / 25 × (100 + velocitypercent)/100 */
  private stepLength(): number {
    const v = this.player.running ? this.player.runVelocity : this.player.walkVelocity;
    // 이동 속도: 스킬 velocitypercent + 장비 FRW (EFRW = ⌊150 × FRW / (150 + FRW)⌋). 출처: Maxroll Movement Speed
    const frw = this.derived()?.stat('item_fastermovevelocity') ?? 0;
    return ((v * SUBTILES_PER_YARD) / ENGINE_FPS) * (100 + this.playerStat('velocitypercent') + Math.trunc((150 * frw) / (150 + frw))) / 100;
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
      if (m === self || m.mode === 'DT' || m.mode === 'DD') continue;
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
    const lifeBonus = (v: number) => (cls === 'Barbarian' ? 2 * v : cls === 'Amazon' || cls === 'Paladin' ? v + (v >> 1) : v);
    const manaBonus = (v: number) => (cls === 'Sorceress' || cls === 'Necromancer' ? 2 * v : cls === 'Amazon' || cls === 'Paladin' ? v + (v >> 1) : v);
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
    } else {
      this.events.push({ type: 'itemUseUnsupported', itemId: id, code: found.item.code });
      return;
    }
    this.store.consume(id);
    this.events.push({ type: 'itemUsed', itemId: id, code: found.item.code });
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
    const lvl = s ? (c.skills[s.id] ?? 0) : 0;
    if (!s || !s.aura || lvl <= 0) {
      if (this.aura) this.endAura();
      return;
    }
    if (this.aura && (this.aura.skill.id !== s.id || this.aura.lvl !== lvl)) this.endAura();
    if (!this.aura) {
      this.aura = { skill: s, lvl, next: s.immediate ? this.tickCount : this.tickCount + 1 };
      this.passiveCache = null;
    }
    if (this.tickCount < this.aura.next) return;
    const o = this.owner();
    const period = Math.max(5, calc.eval(s, s.perDelay, lvl, o));
    this.aura.next = this.tickCount + period;
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
      for (const m of this.monstersNear(this.player.x, this.player.y, range)) {
        if (s.auraTargetState && Object.keys(targetStats).length) {
          // 감속은 몬스터 냉기 효과(coldeffect)보다 강해질 수 없다 (출처: SKILLS_AuraCallback_BasicAura)
          const capped: Record<string, number> = {};
          for (const [k, v] of Object.entries(targetStats)) capped[k] = k === 'velocitypercent' || k === 'attackrate' || k === 'other_animrate' ? Math.max(v, m.type.coldEffect) : v;
          if (m.type.coldEffect < 0) m.states.set(s.auraTargetState, until, capped);
        }
        if (el) {
          const d = emptyDamage();
          addElemental(d, el.eType, el.amount, 0);
          d.hitClass = s.hitClass || 0x0d;
          this.damageMonster(m, d);
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
    if (s.id <= 5) return 1;
    const hard = this.character?.skills[s.id] ?? 0;
    // 스킬 신전: 배운 스킬 +Arg0 (shrines.txt Skill Boost Arg0 = 2, 상태 shrine_skill). 근사(원작 미확인): 원작은 상태 해제 콜백에서 스킬을 다시 계산
    const boost = this.player.states.get('shrine_skill')?.stats.allskills ?? 0;
    return hard > 0 ? hard + boost : 0;
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
    // 원작: AttackNoMana 스킬은 마나가 모자라면 일반 공격으로 대신한다
    const needMana = s.repeat ? s.startMana * 256 : (this.data.skillCalc?.manaCost256(s, this.skillLevel(s)) ?? 0);
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
  private startCast(s: SkillRecord, targetId: number | undefined, tx: number, ty: number, targetItem?: number): boolean {
    const p = this.player, c = this.character, data = this.data;
    if (!data) return false;
    const lvl = this.skillLevel(s);
    if (!this.startCheck(s, targetId)) return false;
    // 반복 스킬은 발사할 때마다 마나를 쓴다 (skills.txt startmana 로 시작 조건만 검사)
    if (c && s.id > 5 && data.skillCalc && !s.repeat) c.mana = Math.max(0, c.mana - data.skillCalc.manaCost256(s, lvl) / 256);
    if (Math.hypot(tx - p.x, ty - p.y) > 1e-6) p.dir = dir64(tx - p.x, ty - p.y);
    const wclass = this.weaponWclass();
    const token = this.playerToken();
    // 무기 공격 속도: weapons.txt speed (WSM, 음수 = 빠름). 출처: Maxroll Attack Speed — AnimRate − WSM
    // 공격 속도: WSM + IAS / 시전 속도: FCR (EFCR = ⌊120 × FCR / (120 + FCR)⌋). 출처: Maxroll Attack Speed / Cast Rate
    const fcr = this.derived()?.stat('item_fastercastrate') ?? 0;
    const speedPct = s.useAttackRate ? this.attackSpeedPct() : s.anim === 'SC' ? 100 + Math.trunc((120 * fcr) / (120 + fcr)) : 100;
    const cast: Cast = { skill: s, lvl, targetId, tx, ty, start: this.tickCount, end: this.tickCount + 1, hitTicks: [], fired: 0, targetItem };
    const seq = s.seqNum > 0 ? PLAYER_SEQUENCES[s.seqNum]?.[wclass] : undefined;
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
      const r = data.anim.get(`${token}${mode}${wclass}`);
      const t = modeTiming(data.anim, token, mode, wclass, speedPct, true);
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
    if (s.srvStFunc === 31) this.prepareCharge(cast);
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
  private startCheck(s: SkillRecord, targetId: number | undefined): boolean {
    // Attack·화살 스킬: 활/석궁이면 화살 필요 (출처: SKILLS_SrvSt01 / SrvSt04 — sub_6FD119C0 탄약 확인)
    if ((s.srvStFunc === 1 || s.srvStFunc === 4) && this.isBowWeapon() && !this.ammo()) {
      this.events.push({ type: 'skillUnusable', skill: s.id, reason: 'ammo' });
      return false;
    }
    // Throw: 던질 무기 수량 (SKILLS_SrvSt65)
    if (s.srvStFunc === 65) {
      const w = this.weaponItem();
      if (!w || w.quantity <= 0) return false;
    }
    if ((s.srvStFunc === 5 || s.srvStFunc === 6 || s.srvStFunc === 7 || s.srvStFunc === 32) && targetId === undefined) return false;
    return true;
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
      if (cast.skill.repeat) this.payRepeatMana(cast);
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
        this.payRepeatMana(cast);
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
      this.launchSkillMissile(s, lvl, s.srvMissile, cast.tx, cast.ty, live?.id);
      if (s.decQuant) this.decQuantity(this.isBowWeapon() ? 'larm' : 'rarm');
      return;
    }
    switch (s.srvDoFunc || s.srvStFunc) {
      case 1: {
        // Attack: 활이면 화살, 아니면 근접. 출처: SKILLS_SrvDo001_Attack
        if (this.isBowWeapon()) {
          this.launchWeaponMissile(s, lvl, cast.tx, cast.ty, live?.id);
          this.decQuantity('larm');
        } else if (live) this.meleeHit(live, { toHitPct: 0, enDmgPct: 0, flat256: 0, elem: null, hitClass: 0, srcDam: 128 });
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
        const t = live && isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, live.x, live.y, live.type.sizeX, 1) ? live
          : this.monstersNear(p.x, p.y, 4).find((m) => isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, m.x, m.y, m.type.sizeX, 1));
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
        // Guided Arrow: 대상을 따라가는 화살, 피해 +calc1%. 출처: SKILLS_SrvDo010_GuidedArrow
        const def = data.missiles.get(s.srvMissileA);
        if (!def) return;
        const bonus = calc.calc(s, 1, lvl, o);
        this.spawnPlayerMissile(def, s, lvl, cast.tx, cast.ty, live?.id, { srcDam: 128, useSkillDamage: true, damagePct: bonus, homing: true });
        this.decQuantity('larm');
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
        // Frozen Armor / Shiver Armor (Bone Armor 도 같은 함수): 자신에게 방어 버프, 다른 아머는 해제. 출처: SKILLS_SrvDo018_DefensiveBuff
        for (const other of ['frozenarmor', 'shiverarmor', 'chillingarmor']) if (other !== s.auraState) this.player.states.remove(other);
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
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
        target.corpseUsed = true;
        const hp256 = Math.trunc(((data.monsters.levelBase(target.stats.level, 'HP') * (target.type.minHpPct + target.type.maxHpPct)) / 100 / 2)) * 256;
        const lo = Math.trunc((calc.calc(s, 1, lvl, o) * hp256) / 100), hi = Math.trunc((calc.calc(s, 2, lvl, o) * hp256) / 100);
        let dmg = lo + (hi > lo ? this.rng.pick(hi - lo) : 0);
        const cl = this.character?.level ?? 1;
        if (target.stats.level && cl < target.stats.level) dmg = Math.trunc((dmg * cl) / target.stats.level);
        const pct = Math.max(0, Math.min(100, calc.calc(s, 3, lvl, o)));
        const radius = Math.trunc((calc.eval(s, s.auraRangeCalc, lvl, o) + 1) / 2);
        for (const m of this.monstersNear(target.x, target.y, radius)) {
          const d = emptyDamage();
          if (pct > 0 && s.eType) addElemental(d, s.eType, Math.trunc((dmg * pct) / 100), calc.elemLength(s, lvl, o));
          d.phys += Math.trunc((dmg * (100 - pct)) / 100);
          this.damageMonster(m, d);
        }
        this.events.push({ type: 'corpseExploded', targetId: target.id });
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
        const len = calc.eval(s, s.auraLenCalc, lvl, o);
        const stats: Record<string, number> = {};
        for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, o);
        if (s.auraState) this.player.states.set(s.auraState, this.tickCount + len, stats);
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
      default:
        void index;
    }
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

  private monstersNear(x: number, y: number, radius: number): MonsterUnit[] {
    return this.monsters
      .filter((m) => m.mode !== 'DT' && m.mode !== 'DD' && Math.hypot(m.x - x, m.y - y) <= radius)
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
    if (!isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, m.x, m.y, m.type.sizeX, 1)) return false;
    const shieldBase = spec.shield && this.equipment.larm ? data.items.base(this.equipment.larm.code) : undefined;
    const w = spec.shield ? shieldBase : this.weaponBase();
    const passives = this.passives();
    const pct = spec.toHitPct + masteryBonus(passives, data.items, w, 'th') + this.playerStat('item_tohit_percent') + (this.derived()?.toHitPct ?? 0);
    const ar = this.playerAR();
    // Smite: 명중 판정 결과와 무관하게 성공 (출처: SKILLS_SrvDo150_Smite — GetResultFlags | SUCCESSFULHIT)
    if (!spec.shield && !rollPercent(hitChance(ar + Math.trunc((ar * pct) / 100), this.monsterDefense(m, false), c.level, m.stats.level), this.rng)) {
      this.events.push({ type: 'miss', targetId: m.id });
      return false;
    }
    const d = emptyDamage();
    const dv = this.derived();
    d.phys = rollWeaponDamage({
      weapon: w, str: this.effStat('str'), dex: this.effStat('dex'), enDmgPct: spec.enDmgPct, damagePercent: this.playerStat('damagepercent'),
      masteryDmg: spec.shield ? 0 : masteryBonus(passives, data.items, w, 'dmg'), srcDam: spec.srcDam,
      weaponRange: !spec.shield && dv && w ? { min: dv.weaponMin + dv.addMin, max: dv.weaponMax + dv.addMax } : undefined,
      itemDamagePct: dv?.offWeaponEdPct ?? 0,
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
    if (rollCritical(masteryBonus(passives, data.items, w, 'crit'), this.playerStat('passive_critical_strike'), this.rng)) {
      d.phys *= 2;
      d.crit = true;
    }
    d.phys += spec.flat256;
    d.hitClass = spec.hitClass || (w ? (data.hitClassIndex.get(w.hitClass) ?? 1) : 1);
    if (spec.elem) addElemental(d, spec.elem.eType, spec.elem.amount, spec.elem.len);
    this.addStatElemental(d);
    if (spec.hitClass) d.hitClass = spec.hitClass;
    const hpBefore = m.hp;
    this.damageMonster(m, d);
    if (!spec.shield) this.wearWeapon();
    // 생명·마나 흡수: 준 물리 피해의 lifedrainmindam / manadrainmindam % (Normal LifeStealDivisor 1). 출처: itemstatcost.txt, DifficultyLevels.txt
    const dvl = this.derived();
    if (dvl) {
      const phys = Math.min(applyMonsterResists(d, this.monsterResists(m)).phys / 256, Math.max(0, hpBefore));
      const ll = dvl.stat('lifedrainmindam'), ml = dvl.stat('manadrainmindam');
      if (ll > 0) c.life = Math.min(this.maxLife(), c.life + (phys * ll) / 100);
      if (ml > 0) c.mana = Math.min(this.maxMana(), c.mana + (phys * ml) / 100);
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
  private damageMonster(m: MonsterUnit, raw: DamagePacket, source: 'player' | 'pet' | 'other' = 'player', attackerId?: number): void {
    if (m.pet) {
      this.damagePet(m, raw);
      return;
    }
    const d = applyMonsterResists(raw, this.monsterResists(m));
    const total = totalDamage(d);
    m.hp -= total / 256;
    m.aggro = true;
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
    const coldDiv = this.data?.coldDivisor || 1, frzDiv = this.data?.freezeDivisor || 1;
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
    if (!stunned && m.type.modes.has('GH') && rollGetHit(total / 256, m.stats.maxHp, d.hitClass, m.rng)) this.startMonsterMode(m, 'GH');
  }

  /** 몬스터 저항 + 저주 (Amplify Damage: damageresist −100) */
  private monsterResists(m: MonsterUnit): { dm: number; fi: number; li: number; co: number; ma: number; po: number } {
    const r = m.resist, st = m.states;
    return {
      dm: r.dm + st.stat('damageresist'), fi: r.fi + st.stat('fireresist'), li: r.li + st.stat('lightresist'),
      co: r.co + st.stat('coldresist'), ma: r.ma + st.stat('magicresist'), po: r.po + st.stat('poisonresist'),
    };
  }

  private killMonster(m: MonsterUnit, source: 'player' | 'pet' | 'other' = 'player', attackerId?: number): void {
    m.hp = 0;
    m.path = [];
    m.states.clear();
    m.cast = undefined;
    this.startMonsterMode(m, 'DT');
    m.deathFrame = this.tickCount;
    this.events.push({ type: 'monsterKilled', targetId: m.id, typeId: m.type.id, flags: m.flags, ...(m.superUnique !== undefined ? { superUnique: m.superUnique } : {}) });
    const c = this.character, cs = this.classStats, table = this.expTable;
    // 소환수가 죽인 몬스터도 주인이 경험치를 받는다. 혼란·가시 등 다른 원인도 플레이어 근처면 받음 (근사)
    // 부활·둥지 스폰 몬스터는 경험치·드롭 없음 (UNITFLAG_NOXP | NOTC)
    if (!m.noXp && c && cs && table && (source !== 'other' || Math.hypot(m.x - this.player.x, m.y - this.player.y) < 40)) {
      // 경험 신전: item_addexperience % 만큼 더 (출처: shrines.txt Experience Boost Arg0 = 50, itemstatcost item_addexperience)
      const bonus = this.playerStat('item_addexperience');
      this.gainExperience(Math.trunc((adjustedExperience(m.stats.exp, c.level, m.stats.level) * (100 + bonus)) / 100));
    }
    if (!m.noXp && source !== 'other') this.mercGainExp(m, attackerId);
    this.onMonsterDeathMods(m);
    const data = this.data;
    const tc = m.noTc ? '' : this.monsterTc(m, source);
    if (data && tc) {
      for (const item of data.treasure.drop(tc, m.stats.level, m.rng, this.derived()?.stat('item_magicbonus') ?? 0)) {
        this.dropItem(item, m.x + 1, m.y + 1);
        this.events.push({ type: 'itemDropped', itemId: item.id, code: item.code, quality: item.quality, tc });
      }
    }
    if (m.type.tcQuestId && m.type.treasure[3] && tc === m.type.treasure[3]) this.questsDone.add(m.type.tcQuestId);
  }

  /**
   * 몬스터 드롭 TC. 출처: MonsterMode.cpp sub_6FC631B0 — 슈퍼유니크 = SuperUniques TC, 챔피언 = TreasureClass2, 유니크 = TreasureClass3,
   * 그 밖 = TreasureClass1; TCQuestId 가 있고 플레이어가 그 퀘스트를 끝내지 않았으면 TreasureClass4 (Andariel → Andarielq).
   * TC 레벨 업그레이드는 몬스터 레벨 (챔피언 +2, 유니크 +3) 로 TreasureDb.resolve 가 처리
   */
  monsterTc(m: MonsterUnit, source: 'player' | 'pet' | 'other' = 'player'): string {
    const t = m.type;
    let tc = t.treasure[0] ?? '';
    if (m.superUnique !== undefined) tc = this.data?.uniques?.superUnique(m.superUnique)?.tc || t.treasure[2] || '';
    else if (m.flags & MONFLAG.CHAMPION) tc = t.treasure[1] ?? '';
    else if (m.flags & MONFLAG.UNIQUE) tc = t.treasure[2] ?? '';
    if (t.tcQuestId && t.treasure[3] && source !== 'other' && !this.questsDone.has(t.tcQuestId)) tc = t.treasure[3];
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
      const pct = Number(data.difficultyRows?.[this.difficulty]?.MonsterCEDamagePercent ?? 50) || 50;
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
    const def = [...data.missiles.values()].find((m) => m.id === w.missileType) ?? data.missiles.get(thrown ? 'javelin' : 'arrow');
    if (!def) return;
    this.spawnPlayerMissile(def, s, lvl, tx, ty, targetId, { srcDam: def.srcDamage < 0 ? 0 : def.srcDamage || 128, useSkillDamage: false, thrown, toHitPct, damagePct });
  }

  private isThrownWeapon(): boolean {
    const w = this.weaponBase(), items = this.data?.items;
    return !!w && !!items && items.isType(w, 'thro');
  }

  private spawnPlayerMissile(def: MissileDef, s: SkillRecord, lvl: number, tx: number, ty: number, targetId: number | undefined, o: PlayerMissileOpts): void {
    const p = this.player, c = this.character, data = this.data;
    if (!c || !data) return;
    const from = o.from ?? { x: p.x, y: p.y };
    const speed = missileStep(o.velocity ?? def.vel + Math.trunc((lvl * def.velLev) / 8));
    let dx = tx - from.x, dy = ty - from.y;
    const len = Math.hypot(dx, dy) || 1;
    dx = (dx / len) * speed;
    dy = (dy / len) * speed;
    const roll = this.missileDamageRoller(def, s, lvl, o);
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
      owner: 'player', ownerId: p.id, ownerLevel: c.level, hitClass: def.hitClass || s.hitClass || 10, ar, roll, hit: new Set(),
      homingTarget: o.homing ? targetId : undefined, wander: o.wander, group: o.group, skill: s, lvl,
      ...(o.chain ? { chain: o.chain } : {}),
      ...(o.spiral ? { spiral: { cx: from.x, cy: from.y, a: Math.atan2(ty - from.y, tx - from.x), r: 0 } } : {}),
    };
    // 부속 미사일: Exploding Arrow 폭발(HitSubMissile1, 반경 sHitPar1), Poison Javelin 구름 자취(SubMissile1), Plague Javelin 구름(HitSubMissile1)
    const hitSub = def.hitSubMissile1 ? data.missiles.get(def.hitSubMissile1) : undefined;
    if (hitSub && def.srvHitFunc === 4) {
      m.explode = { radius: hitSub.hitParams[0] || 3, roll: this.missileDamageRoller(hitSub, this.skillFor(hitSub) ?? s, lvl, { srcDam: 0, useSkillDamage: true }) };
    }
    if (hitSub && def.srvHitFunc === 2) {
      m.cloudBurst = { def: hitSub, count: 8, roll: this.missileDamageRoller(hitSub, s, lvl, { srcDam: 0, useSkillDamage: true }) };
    }
    const sub = def.subMissile1 ? data.missiles.get(def.subMissile1) : undefined;
    // 지면 불(Fire Wall)은 매 프레임, 독 구름은 Param1 프레임마다
    if (sub && isGroundFire(sub)) m.groundTrail = { def: sub, roll: this.missileDamageRoller(sub, this.skillFor(sub) ?? s, lvl, { srcDam: 0, useSkillDamage: true }) };
    else if (sub) m.trail = { def: sub, every: Math.max(1, sub.params[0] || 2), roll: this.missileDamageRoller(sub, s, lvl, { srcDam: 0, useSkillDamage: true }) };
    this.missiles.push(m);
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
        if (rollCritical(o.thrown ? masteryBonus(passives, data.items, w, 'crit', true) : 0, this.playerStat('passive_critical_strike'), this.rng)) {
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
    const rate = action ? m.states.stat('attackrate') : m.states.stat('other_animrate');
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
    m.hitDone = !(mode === 'A1' || mode === 'A2' || cast);
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
    };
  }

  private expireStates(): void {
    this.player.states.expire(this.tickCount);
    for (const m of this.monsters) m.states.expire(this.tickCount);
    for (const m of this.pets) m.states.expire(this.tickCount);
  }

  private updateMonsters(): void {
    const w = this.aiWorld();
    for (const m of [...this.monsters]) {
      if (m.mode === 'DD') continue;
      if (m.mode === 'DT') {
        if (this.tickCount >= m.modeEnd) {
          this.setMonMode(m, 'DD');
          m.cast = undefined;
        }
        continue;
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
        m.nextThink = this.tickCount + m.type.aiDelay;
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
    return { slot, skill, lvl, tx, ty, fired: 0, events: [], ...(t?.unitId !== undefined ? { targetId: t.unitId } : {}), ...(seq ? { seq } : {}) };
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
    const bonus = Number(this.data.difficultyRows?.[this.difficulty]?.MonsterSkillBonus ?? 0) || 0;
    const cast = this.makeCast(m, slot, def.name, Math.max(1, def.lvl) + bonus, t ?? { unitId: m.targetId, ...this.targetOf(m) }, seq);
    // Nest(둥지): 시작할 때 스폰 자리를 정한다 (출처: SKILLS_SrvSt49_Nest_EvilHutSpawner → MONSTERS_GetMinionSpawnInfo)
    if (def.name === 'Nest') {
      const sp = this.nestSpawnInfo(m, cast);
      if (!sp) return false;
      cast.tx = sp.x;
      cast.ty = sp.y;
    }
    // AndrialSpray: 시작할 때 대상 좌표 고정 (SKILLS_SrvSt46_AndrialSpray)
    this.startMonsterMode(m, mode, cast);
    this.events.push({ type: 'monsterSkill', monsterId: m.id, skill: def.name });
    return true;
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
    return true;
  }

  /** 진행 중인 스킬의 판정 이벤트 (시퀀스 이벤트 프레임 또는 모드 판정 프레임) */
  private updateMonsterCast(m: MonsterUnit): void {
    const cast = m.cast;
    if (!cast) return;
    const el = this.tickCount - m.modeStart;
    while (cast.fired < cast.events.length && el >= (cast.events[cast.fired] ?? 0)) {
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
    const rec = data.skills?.byNameOf(cast.skill);
    const target = cast.targetId !== undefined ? this.pets.find((x) => x.id === cast.targetId) ?? this.monsters.find((x) => x.id === cast.targetId) : undefined;
    const tx = target ? target.x : cast.targetId === undefined && cast.skill !== 'Nest' && cast.slot >= 0 && !['Resurrect'].includes(cast.skill) ? this.targetOf(m).x : cast.tx;
    const ty = target ? target.y : cast.targetId === undefined && cast.skill !== 'Nest' && cast.slot >= 0 && !['Resurrect'].includes(cast.skill) ? this.targetOf(m).y : cast.ty;
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

  /** Arach 거미줄 (SpiderLay 상태로 걷는 동안 spidergoolay). 근사(원작 미확인): 둔화 효과 생략, 그림만 */
  private dropSpiderGoo(m: MonsterUnit): void {
    const def = this.data?.missiles.get('spidergoolay');
    if (!def) return;
    this.missiles.push({
      id: this.nextUnitId++, def, x: m.x, y: m.y, dx: 0, dy: 0, left: def.range, age: 0, owner: 'monster', ownerId: m.id, ownerLevel: m.stats.level,
      hitClass: 0, hit: new Set(), lvl: 1, visual: true,
    });
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
    if (m.states.has('confuse')) {
      for (const o of this.monsters) if (o !== m && o.mode !== 'DT' && o.mode !== 'DD') cands.push({ x: o.x, y: o.y, size: o.type.sizeX, id: o.id });
    } else {
      if (!pDead) cands.push({ x: p.x, y: p.y, size: PLAYER_SIZE });
      for (const pet of this.pets) if (pet.mode !== 'DT' && pet.mode !== 'DD' && pet.pet?.petType !== 'none') cands.push({ x: pet.x, y: pet.y, size: pet.type.sizeX, id: pet.id });
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
      const lvl = (Number(data.difficultyRows?.[this.difficulty]?.MonsterSkillBonus ?? 0) || 0) + 1;
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
    const block = shield?.block && !alwaysHit ? blockChance(dv?.block ?? shield.block, cs.blockFactor, this.effStat('dex'), c.level, running) : 0;
    if (block > 0 && rollPercent(block, this.rng)) {
      this.events.push({ type: 'playerBlocked' });
      return;
    }
    const moving = p.mode === 'WL' || p.mode === 'RN';
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
    // 물리 피해 감소: damageresist % (Amplify Damage −100) · normal_damage_reduction
    const dr = (dv?.stat('damageresist') ?? 0) + this.player.states.stat('damageresist');
    if (dr) dmg = Math.max(0, dmg - (dmg * Math.min(dr, 50)) / 100);
    dmg = Math.max(0, dmg - (dv?.stat('normal_damage_reduction') ?? 0));
    // Bone Armor: 근접 물리 피해를 흡수량(bonearmor, 1/256)이 남는 동안 흡수 (auraevent absorbdamage, EventFunc22)
    const ba = missile ? undefined : this.player.states.get('bonearmor');
    if (ba && (ba.stats.bonearmor ?? 0) > 0 && dmg > 0) {
      const absorb = Math.min(dmg * 256, ba.stats.bonearmor ?? 0);
      ba.stats.bonearmor = (ba.stats.bonearmor ?? 0) - absorb;
      dmg -= absorb / 256;
      if ((ba.stats.bonearmor ?? 0) <= 0) this.player.states.remove('bonearmor');
    }
    let elemental = 0;
    if (elem) {
      const res = (k: 'fi' | 'co' | 'li' | 'po' | 'ma', st: string) => Math.min(95, (dv?.res[k] ?? 0) + this.player.states.stat(st));
      const cut = (v: number, r: number) => (v > 0 ? Math.trunc((v * (100 - Math.max(-100, r))) / 100) : 0);
      const fire = cut(elem.fire * crit, res('fi', 'fireresist')), ltng = cut(elem.ltng * crit, res('li', 'lightresist')), cold = cut(elem.cold * crit, res('co', 'coldresist'));
      const mag = cut(elem.mag * crit, res('ma', 'magicresist')) - (dv?.stat('magic_damage_reduction') ?? 0) * 256;
      elemental = (fire + ltng + cold + Math.max(0, mag) + elem.phys) / 256;
      const coldLen = cut(elem.coldLen, res('co', 'coldresist'));
      if (cold > 0 && coldLen > 0) this.player.states.set('cold', this.tickCount + coldLen, { velocitypercent: -50, attackrate: -50, other_animrate: -50 });
      const pois = cut(elem.pois * crit, res('po', 'poisonresist')), poisLen = cut(elem.poisLen, res('po', 'poisonresist'));
      if (pois > 0 && poisLen > 0) {
        const cur = this.player.states.get('poison');
        if (!cur || -(cur.stats.hpregen ?? 0) <= pois) this.player.states.set('poison', this.tickCount + poisLen, { hpregen: -pois });
      }
      if (elem.manaDrain) c.mana = Math.max(0, c.mana - elem.manaDrain / 256);
    }
    const total = dmg + elemental;
    c.life = Math.max(0, c.life - total);
    this.events.push({ type: 'playerHit', damage: total, ...(elemental ? { elemental } : {}) });
    if (!missile && attacker && dmg > 0) {
      this.onDamagedInMelee(attacker, dmg);
      this.ironMaiden(attacker, dmg);
    }
    if (attacker && total > 0) this.onMonsterHitPlayer(attacker);
    if (c.life <= 0) {
      this.playerDie();
      return;
    }
    // 출처: Maxroll — Breakpoints & Animations: 최대 생명의 1/12 이상 피해 시 피격 경직 (공격·시전 중에는 무시)
    if (total * 12 >= this.maxLife() && !p.cast) {
      p.path = [];
      this.setPlayerMode('GH');
    }
    void hitClass;
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
  private summonPet(s: SkillRecord, lvl: number, typeId: string, x: number, y: number, petType: string, extra: Partial<PetInfo> = {}): MonsterUnit | null {
    const data = this.data, calc = data?.skillCalc, c = this.character;
    // skills.txt summon 은 대소문자가 monstats Id 와 다를 수 있다 (ClayGolem ↔ claygolem)
    const key = data ? [...data.monsters.types.keys()].find((k) => k.toLowerCase() === typeId.toLowerCase()) : undefined;
    if (!data || !calc || !c || !key) return null;
    const o = this.owner();
    const spot = nearestWalkable(this.map, { x, y }, 5);
    if (!spot) return null;
    const type = data.monsters.get(key);
    const petLvl = Math.max(1, Math.min(c.level, lvl + Math.trunc((3 * c.level) / 4)));
    const rng = new Rng(Number(this.rng.next() & 0xffffffffn) || 1);
    const stats = rollMonsterStats(data.monsters, type, rng, petLvl);
    stats.defense += data.monsters.levelBase(petLvl, 'AC');
    stats.a1.toHit += data.monsters.levelBase(petLvl, 'TH');
    stats.a2.toHit += data.monsters.levelBase(petLvl, 'TH');
    const info: PetInfo = { skillId: s.id, petType, expires: Infinity, missileLvl: 0, damagePct: 0, normalDamage: 0, slowPct: 0, ...extra };
    const bonus = (stat: string, v: number) => {
      if (stat === 'maxhp') stats.maxHp += v / 256;
      else if (stat === 'item_normaldamage') info.normalDamage += v;
      else if (stat === 'damagepercent') info.damagePct += v;
      else if (stat === 'tohit') {
        stats.a1.toHit += v;
        stats.a2.toHit += v;
      } else if (stat === 'armorclass') stats.defense += v;
      else if (stat === 'item_slow') info.slowPct += v;
    };
    for (const ps of s.passiveStats) bonus(ps.stat, calc.eval(s, ps.calc, lvl, o));
    for (const a of s.auraStats) bonus(a.stat, calc.eval(s, a.calc, lvl, o));
    stats.maxHp += Math.trunc((stats.maxHp * calc.calc(s, 1, lvl, o)) / 100);
    const id = this.nextUnitId++;
    const pet: MonsterUnit = { ...this.newMonsterUnit(id, type, stats, rng, spot.x + 0.5, spot.y + 0.5), corpseUsed: true, pet: info };
    const max = this.petMax(s, lvl);
    const same = this.pets.filter((x) => x.pet?.skillId === s.id && x.mode !== 'DT' && x.mode !== 'DD');
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
        continue;
      }
      if (pet.mode === 'DT') {
        if (this.tickCount >= pet.modeEnd) pet.mode = 'DD';
        continue;
      }
      if (info.petType === 'none') continue; // 뼈벽: 제자리
      if (pet.states.has('freeze') || pet.states.has('stunned')) {
        pet.modeEnd++;
        continue;
      }
      if (pet.mode === 'A1' || pet.mode === 'A2' || pet.mode === 'GH') {
        if (!pet.hitDone && this.tickCount - pet.modeStart >= pet.hitTick) {
          pet.hitDone = true;
          if (info.hireling) this.mercShoot(pet);
          else this.petAttack(pet);
        }
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
      pet.nextThink = this.tickCount + Math.max(3, Math.trunc(pet.type.aiDelay / 3));
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
    if (info.missile) {
      const def = this.data?.missiles.get(info.missile);
      if (!def) return;
      const d = Math.hypot(t.x - pet.x, t.y - pet.y) || 1, sp = missileStep(def.vel);
      const lvl = info.missileLvl;
      const roll = () => {
        const pk = emptyDamage();
        const sh = 2 ** def.hitShift;
        const min = (def.eMin + levelDamageBonus(lvl, def.eMinLev)) * sh, max = (def.eMax + levelDamageBonus(lvl, def.eMaxLev)) * sh;
        const lenLv = lvl <= 8 ? (def.eLevLen[0] ?? 0) * (lvl - 1) : lvl <= 16 ? 7 * (def.eLevLen[0] ?? 0) + (lvl - 8) * (def.eLevLen[1] ?? 0) : 7 * (def.eLevLen[0] ?? 0) + 8 * (def.eLevLen[1] ?? 0) + (lvl - 16) * (def.eLevLen[2] ?? 0);
        addElemental(pk, def.eType, min + (max > min ? pet.rng.pick(max - min) : 0), def.eLen + lenLv);
        return pk;
      };
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
    d.phys = Math.trunc((base * 256 * (100 + info.damagePct)) / 100);
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
    const town = this.levels.get(this.townKey() ?? '');
    if (!town || town.npcs.some((n) => n.type.id === 'cain5')) return;
    const prev = this.level;
    this.level = town;
    const at = town.def.portalSpot ?? { x: town.def.map.width / 2, y: town.def.map.height / 2 };
    this.spawnNpc('cain5', at.x + 4, at.y + 4);
    this.level = prev;
  }

  /** 퀘스트 상태 기록 (Phase 10 Step 2 퀘스트가 부른다). 'cain' 이면 마을에 Cain 을 세운다 */
  setQuest(flag: string): void {
    this.quests.add(flag);
    const town = this.levels.get(this.townKey() ?? '');
    if (flag === 'cain' && town?.populated) this.spawnCain();
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

  /** NPC 메뉴 (원작 메뉴 + 용병이 죽었으면 Kashya 에게 부활) */
  npcOptions(n: MonsterUnit): NpcOption[] {
    const def = NPC_DEFS[n.type.id];
    if (!def) return ['talk', 'cancel'];
    const out: NpcOption[] = [];
    for (const o of def.menu) {
      out.push(o);
      if (o === 'hire' && this.merc?.dead) out.push('resurrect');
    }
    return out;
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
      difficulty: g.difficulty,
      questDone: (f) => g.quests.has(typeof f === 'number' ? `q${f}` : f),
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
    this.talk = { levelId: this.level.def.id, npcId: n.id, mode: 'menu' };
    if (NPC_DEFS[n.type.id]?.heal) this.healAtNpc();
    this.events.push({ type: 'npcInteract', npcId: n.id, typeId: n.type.id });
  }

  /** 대화 끝 (원작 D2GAME_NPC_ResetInteract) — 도박 목록은 버린다 (SUNITPROXY_FreeNpcGamble) */
  closeTalk(): void {
    const t = this.talk;
    if (!t) return;
    const n = this.levels.get(t.levelId)?.npcs.find((x) => x.id === t.npcId);
    if (n?.npc) n.npc.talking = false;
    this.talk = null;
    this.npc.gamble = null;
    this.events.push({ type: 'npcClosed', npcId: t.npcId });
  }

  private npcMenu(option: NpcOption): void {
    const t = this.talk, n = this.talking();
    if (!t || !n || !this.npcOptions(n).includes(option)) return;
    const h = this.tradeHost();
    const id = n.type.id;
    switch (option) {
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
        this.npc.identifyAll(h, this.quests.has('cain'));
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
      npcId: n.id, typeId: id, mode: t.mode, options: this.npcOptions(n), store, repair: !!NPC_DEFS[id]?.repair,
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

  // ---------------------------------------------------------------- 용병

  /** 살아 있는 용병 유닛 */
  mercUnit(): MonsterUnit | undefined {
    const id = this.merc?.unitId;
    return id === null || id === undefined ? undefined : this.pets.find((x) => x.id === id);
  }

  /** 저장용 용병 기록 */
  mercSave(): MercSave | null {
    const m = this.merc;
    return m ? { name: m.name, seed: m.seed, hirelingId: m.hirelingId, level: m.level, experience: m.experience, dead: m.dead } : null;
  }

  private mercSnapshot(): MercSnapshot | null {
    const m = this.merc;
    if (!m) return null;
    const u = this.mercUnit();
    return { id: m.unitId, name: m.name, level: m.level, hp: u ? u.hp : 0, maxHp: u ? u.stats.maxHp : (this.mercInfo?.maxHp ?? 0), dead: m.dead, experience: m.experience, nextExp: this.mercInfo?.nextExp ?? 0 };
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
    rec.unitId = id;
    rec.dead = false;
    this.pets.push(u);
    return u;
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
   * 용병 AI (Rogue Scout). 출처: AITHINK_Fn061_Hireable —
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
   * 공격 판단. 출처: sub_6FCE4610 — 확률 = min(dwAiParam[0] + 40 + 2·레벨, 95) 로 스킬, 실패하면 dwAiParam[0] += 10 후 10 프레임 대기.
   *   원거리(Rogue): 거리 4 이상이거나 50% 면 쏜다, 가까우면 주인 쪽으로 물러난다 (실패하면 도망, 그것도 안 되면 쏜다)
   */
  private mercAttack(pet: MonsterUnit, t: MonsterUnit): void {
    const chance = Math.min(pet.ai[0] + 40 + 2 * pet.stats.level, 95);
    const use = pet.rng.pick(100) < chance;
    if (use) pet.ai[0] = 0;
    else pet.ai[0] += 10;
    const d = aiDistance(pet.x, pet.y, t.x, t.y);
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
   * 스킬 고르기. 출처: sub_6FCE4830 — 누적 확률 = DefaultChance + Σ(Chance + max(레벨 − 행 레벨, 0) × ChancePerLvl / 4) (배운 스킬만),
   *   rand(누적 + 1) ≥ DefaultChance 면 그 구간의 hireling 스킬, 아니면 monstats Skill1 (Rogue: RogueMissile, 모드 A1)
   */
  private mercUseSkill(pet: MonsterUnit, t: MonsterUnit): void {
    const st = this.mercInfo;
    if (!st) return;
    const row = st.row;
    const diff = Math.max(pet.stats.level - row.level, 0);
    let total = row.defaultChance;
    const cum: { name: string; lvl: number; upto: number }[] = [];
    for (const s of row.skills) {
      const learned = st.skills.find((x) => x.name === s.name);
      if (!learned) continue;
      total += s.chance + Math.trunc((diff * s.chancePerLvl) / 4);
      cum.push({ name: s.name, lvl: learned.level, upto: total });
    }
    const roll = pet.rng.pick(total + 1);
    let skill = { name: pet.type.skills[0]?.name || 'RogueMissile', lvl: 1 };
    if (roll >= row.defaultChance) {
      const hit = cum.find((c) => roll <= c.upto);
      if (hit) skill = { name: hit.name, lvl: hit.lvl };
    }
    (pet.pet as PetInfo).mercSkill = skill;
    pet.targetId = t.id;
    // 출처: hireling.txt Mode = 4 (A1), monstats Sk1mode A1
    this.startMonsterMode(pet, 'A1');
    pet.dir = dir64(t.x - pet.x, t.y - pet.y);
  }

  /**
   * 용병 공격 판정 (A1 판정 프레임): 스킬 미사일 발사 또는 Inner Sight.
   * 출처: skills.txt RogueMissile(srvmissilea rogue1)·Fire Arrow(firearrow, SrcDam 128, EMin~EMax)·Cold Arrow(coldarrow, HitShift 7, ELen)·
   *       Inner Sight(aurastat armorclass −edmn, auralencalc, aurarangecalc — auratargetstate innersight),
   *       missiles.txt rogue1 (SrcDamage 128) — 물리 = 용병 피해(hireling Dmg) × SrcDam / 128, 명중 = 용병 AR × (100 + ToHit + LevToHit·(lvl−1)) / 100
   */
  private mercShoot(pet: MonsterUnit): void {
    const data = this.data, info = pet.pet as PetInfo;
    const t = pet.targetId !== undefined ? this.monsters.find((m) => m.id === pet.targetId && m.mode !== 'DT' && m.mode !== 'DD') : undefined;
    const sk = info.mercSkill ?? { name: 'RogueMissile', lvl: 1 };
    const s = data?.skills?.byNameOf(sk.name);
    const calc = data?.skillCalc;
    if (!data || !s || !calc || !t) return;
    const lvl = sk.lvl;
    const own: SkillOwner = { baseLevel: (id) => (id === s.id ? lvl : 0), skillLevel: (id) => (id === s.id ? lvl : 0), unitLevel: pet.stats.level };
    if (s.auraTargetState) {
      const radius = Math.max(1, calc.eval(s, s.auraRangeCalc, lvl, own));
      const len = Math.max(1, calc.eval(s, s.auraLenCalc, lvl, own));
      const stats: Record<string, number> = {};
      for (const a of s.auraStats) stats[a.stat] = calc.eval(s, a.calc, lvl, own);
      for (const m of this.monstersNear(pet.x, pet.y, radius)) m.states.set(s.auraTargetState, this.tickCount + len, stats);
      this.events.push({ type: 'mercSkill', skill: s.name });
      return;
    }
    const mname = s.srvMissile || s.srvMissileA;
    const def = data.missiles.get(mname);
    if (!def) return;
    const srcDam = s.srcDam || def.srcDamage || 128;
    const a = pet.stats.a1;
    const roll = () => {
      const d = emptyDamage();
      d.hitClass = def.hitClass || 10;
      d.phys = Math.trunc((rollDamage({ min: a.min, max: a.max }, pet.rng) * 256 * srcDam) / 128);
      if (s.eType) {
        const min = calc.minElem256(s, lvl, own, false), max = calc.maxElem256(s, lvl, own, false);
        addElemental(d, s.eType, min + pet.rng.pick(Math.max(0, max - min)), calc.elemLength(s, lvl, own));
      }
      return d;
    };
    const th = s.toHit + s.levToHit * (lvl - 1);
    const ar = a.toHit + Math.trunc((a.toHit * th) / 100);
    const sp = missileStep(def.vel), dd = Math.hypot(t.x - pet.x, t.y - pet.y) || 1;
    this.missiles.push({
      id: this.nextUnitId++, def, x: pet.x, y: pet.y, dx: ((t.x - pet.x) / dd) * sp, dy: ((t.y - pet.y) / dd) * sp, left: def.range, age: 0,
      owner: 'player', ownerId: pet.id, ownerLevel: pet.stats.level, hitClass: def.hitClass || 10, ar, roll, hit: new Set(), lvl, skill: s,
    });
    this.events.push({ type: 'mercShot', skill: s.name, missile: def.name });
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
    this.events.push({ type: 'mercLevelUp', level: lvl });
  }

  private playerDie(): void {
    const p = this.player;
    p.path = [];
    p.action = null;
    p.cast = null;
    this.setPlayerMode('DT');
    this.applyDeathPenalty();
    this.events.push({ type: 'playerDied' });
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
    const pct = Number(this.data?.difficultyRows?.[this.difficulty]?.DeathExpPenalty ?? 0);
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
    ms.x += ms.dx;
    ms.y += ms.dy;
    const blocked = (this.map.mask(Math.floor(ms.x), Math.floor(ms.y)) & (0x04 | 0x0800 | 0x0020)) !== 0;
    const hit = pAlive && Math.hypot(ms.x - p.x, ms.y - p.y) <= 1;
    if (hit) this.hitPlayer({ min: ms.damage?.min ?? 0, max: ms.damage?.max ?? 0, toHit: ms.toHit ?? 0 }, ms.ownerLevel, ms.hitClass, true, undefined, ms.mpkt, ms.alwaysHit);
    const petHit = hit ? undefined : this.pets.find((pt) => pt.mode !== 'DT' && pt.mode !== 'DD' && Math.hypot(ms.x - pt.x, ms.y - pt.y) <= 1 + pt.type.sizeX / 2);
    if (petHit) {
      const d = ms.mpkt ? { ...ms.mpkt } : emptyDamage();
      if (ms.damage && ms.damage.max > 0) d.phys += rollDamage(ms.damage, this.rng) * 256;
      this.damagePet(petHit, d);
    }
    return hit || !!petHit || blocked || ms.left <= 0;
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
    if (ms.cloud) {
      if (ms.age % ms.cloud.every === 0) for (const m of this.monstersNear(ms.x, ms.y, ms.cloud.radius)) this.missileHit(ms, m, false);
      return ms.left <= 0;
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
    const reach = (ms.def.size + 1) / 2;
    // 지속 피해(Inferno 불꽃): 닿아 있는 적에게 매 프레임
    if (isContinuous(ms.def)) {
      for (const m of this.monsters) {
        if (m.mode === 'DT' || m.mode === 'DD') continue;
        if (Math.hypot(m.x - ms.x, m.y - ms.y) <= reach + m.type.sizeX / 2) this.missileHit(ms, m, false);
      }
      return false;
    }
    for (const m of this.monsters) {
      if (m.mode === 'DT' || m.mode === 'DD' || ms.hit.has(m.id) || ms.group?.has(m.id)) continue;
      if (Math.hypot(m.x - ms.x, m.y - ms.y) > reach + m.type.sizeX / 2) continue;
      // Holy Bolt: 언데드만 맞는다 (sHitPar2 = 1), 나머지는 통과. 출처: MISSMODE_SrvHit07_HolyBolt
      if (ms.def.srvHitFunc === 7 && ms.def.hitParams[1] === 1 && !m.type.undead) continue;
      // Guided Arrow: 대상이 아닌 적은 통과. 출처: MISSMODE_SrvHit10_GuidedArrow
      if (ms.homingTarget !== undefined && m.id !== ms.homingTarget && this.monsters.some((x) => x.id === ms.homingTarget && x.mode !== 'DT' && x.mode !== 'DD')) continue;
      ms.hit.add(m.id);
      ms.group?.add(m.id);
      this.onMissileCollide(ms, m);
      if (ms.def.collideKill) {
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
    this.missileHit(ms, m, true);
    if (def.srvHitFunc === 12 && ms.chain && ms.chain.left > 1) {
      const next = this.monstersNear(ms.x, ms.y, ms.chain.range).find((t) => t.id !== m.id);
      if (next && s) {
        this.spawnPlayerMissile(def, s, ms.lvl, next.x, next.y, next.id, {
          from: { x: ms.x, y: ms.y }, srcDam: 0, useSkillDamage: true, chain: { left: ms.chain.left - 1, range: ms.chain.range },
        });
      }
    }
  }

  private missileHit(ms: Missile, m: MonsterUnit, checkToHit: boolean): void {
    const c = this.character;
    if (!c || !ms.roll) return;
    if (checkToHit && ms.ar !== undefined && !rollPercent(hitChance(ms.ar, this.monsterDefense(m, true), ms.ownerId === this.player.id ? c.level : ms.ownerLevel, m.stats.level), this.rng)) {
      this.events.push({ type: 'miss', targetId: m.id });
      return;
    }
    const d = ms.roll();
    if (ms.def.srvDmgFunc === 5) {
      // Blessed Hammer: 언데드 +dParam1%, 악마 +dParam2%. 출처: MISSMODE_SrvDmg05_BlessedHammer
      const base = d.mag;
      if (m.type.undead) d.mag += Math.trunc((base * (ms.def.dmgParams[0] ?? 0)) / 100);
      if (m.type.demon) d.mag += Math.trunc((base * (ms.def.dmgParams[1] ?? 0)) / 100);
    }
    const byMerc = this.merc?.unitId !== null && ms.ownerId === this.merc?.unitId;
    this.damageMonster(m, d, byMerc ? 'pet' : 'player', byMerc ? ms.ownerId : undefined);
  }

  /** 충돌·소멸: 폭발(Exploding Arrow, 벽에 맞은 Fire Ball), 구름(Plague Javelin) */
  private missileEnd(ms: Missile, hitUnit: MonsterUnit | undefined): void {
    if (ms.explode) for (const m of this.monstersNear(ms.x, ms.y, ms.explode.radius)) this.damageMonster(m, ms.explode.roll());
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
  private spawnGroundFire(def: MissileDef, x: number, y: number, roll: () => DamagePacket, parent: { ownerId: number; ownerLevel: number; lvl: number; skill?: SkillRecord }): void {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (!this.map.walkable(cx, cy)) return;
    if (this.missiles.some((o) => o.def === def && Math.floor(o.x) === cx && Math.floor(o.y) === cy)) return;
    this.missiles.push({
      id: this.nextUnitId++, def, x: cx + 0.5, y: cy + 0.5, dx: 0, dy: 0, left: def.range + parent.lvl * def.levRange, age: 0,
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
    return this.levels.get(levelId)?.objects ?? [];
  }
  /** 레벨의 자동 지도 탐험 기록 */
  automapOf(levelId: string): AutomapReveal | undefined {
    return this.levels.get(levelId)?.automap;
  }
  /** 레벨 정의 (UI: 웨이포인트 목록·자동 지도 표시) */
  levelDef(levelId: string): LevelDef | undefined {
    return this.levels.get(levelId)?.def;
  }
  /** 레벨 번호(levels.txt) → 레벨 키 */
  levelKeyOf(levelNo: number): string | undefined {
    for (const l of this.levels.values()) if (l.def.levelNo === levelNo) return l.def.id;
    return undefined;
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
    updateObjectCollision(o, level.def.map);
    level.objects.push(o);
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
    const items = data.treasure.drop(tc, mlvl, o.rng, this.derived()?.stat('item_magicbonus') ?? 0, { exact: true, quality });
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

  /** 출처: ObjMode.cpp OBJECTS_OperateFunction01_Casket */
  private opCasket(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL || !this.dropChest(o, 0)) return;
    this.setMode(o, OBJMODE.OPERATING);
    this.scheduleEndAnim(o);
    this.trapMonster(o);
    this.events.push({ type: 'objectOpened', objectId: o.id });
  }

  /** 출처: ObjMode.cpp OBJECTS_OperateFunction03_Urn_Basket_Jar — rand(100) <= 20 이면 상자 TC */
  private opUrn(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.setMode(o, OBJMODE.OPERATING);
    this.scheduleEndAnim(o);
    if (this.objControl.roll() % 100 <= 20) this.dropChest(o, 0);
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
    if (locked) {
      if (!this.useKey()) {
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
      // 근사(원작 미확인): 이 엔진에는 기력(스태미나)이 없어 상태만 건다
      case 14: st.set('shrine_stamina', until, {}); break;
      case 15: st.set('shrine_experience', until, { item_addexperience: s.arg0 }); break;
      case 17: this.createPortalPair(this.player.x + 5, this.player.y + 5, false); break;
      case 18: this.shrineGem(); break;
      case 19: {
        // 출처: D2GAME_SHRINES_Storm — 반경 Arg1 안의 살아 있는 플레이어·몬스터 생명 −Arg0 %. 근사(원작 미확인): 원작의 파이어볼 16발(미사일 62)은 생략
        const hit = (hp: number) => Math.trunc((Math.trunc(hp) * s.arg0) / 100);
        if (!this.isDead) c.life = Math.max(1, c.life - hit(c.life));
        for (const m of this.monsters) if (m.mode !== 'DT' && m.mode !== 'DD' && Math.hypot(m.x - o.x, m.y - o.y) <= s.arg1) m.hp = Math.max(1, m.hp - hit(m.hp));
        break;
      }
      case 21:
      case 22: {
        // 출처: D2GAME_SHRINES_Exploding / Poison — rand(Arg1 − Arg0) + Arg0 개의 투척 물약(opm / gpm)을 플레이어 옆에
        // 근사(원작 미확인): 원작이 신전 주위로 쏘는 미사일 6발(45 / 48)은 생략
        const cnt = o.rng.pick(s.arg1 - s.arg0) + s.arg0;
        for (let i = 0; i < cnt; i++) this.dropCode(code === 21 ? 'opm' : 'gpm', this.player.x, this.player.y);
        break;
      }
      default:
        // 20 Warping(몬스터 → 유니크)·16 Enirhs 는 미구현 (Enirhs 는 InitFn 에서 18 로 바뀌어 나오지 않음)
        this.events.push({ type: 'shrineUnsupported', code });
    }
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
    const lv = this.levels.get(levelId), db = this.data?.objects;
    if (!lv || !db) return null;
    const live = lv.objects.find((o) => o.type.subClass & SUBCLASS.WAYPOINT);
    if (live) return { x: live.x, y: live.y };
    const p = (lv.def.objects ?? []).find((q) => (db.type(q.classId)?.subClass ?? 0) & SUBCLASS.WAYPOINT);
    return p ? { x: p.x + 0.5, y: p.y + 0.5 } : null;
  }

  private waypointNo(levelId: string): number {
    const no = this.levels.get(levelId)?.def.levelNo;
    return no === undefined ? 255 : (this.data?.objects?.levels.get(no)?.waypoint ?? 255);
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
  travelWaypoint(levelId: string): boolean {
    const open = this.waypointOpen;
    if (!open || open.levelId !== this.level.def.id || this.isDead) return false;
    const src = this.level.objects.find((o) => o.id === open.objectId);
    if (!src || distanceToObject(src, this.player.x, this.player.y) > 6) {
      this.waypointOpen = null;
      return false;
    }
    const no = this.waypointNo(levelId);
    if (levelId === this.level.def.id || no === 255 || !this.waypoints.has(no)) return false;
    const target = this.levels.get(levelId);
    if (!target) return false;
    this.populate(target);
    const wp = this.waypointPos(levelId);
    if (!wp) return false;
    const spot = nearestWalkable(target.def.map, { x: wp.x, y: wp.y + 3 }, 12) ?? { x: Math.floor(wp.x), y: Math.floor(wp.y) };
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
    this.events.push({ type: 'portalClosed' });
  }

  private removeObject(levelId: string, id: number): void {
    const lv = this.levels.get(levelId);
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
    this.events.push({ type: 'portalOpened', fieldLevel: here.def.id, fieldId: field.id, townId: link.id });
    return true;
  }

  /**
   * 포털 들어가기. 출처: ObjMode.cpp OBJECTS_OperateFunction15_Portal — 짝 포털 위치로 이동(COLLISION_GetFreeCoordinates),
   *       주인이 마을 쪽 포털을 타고 돌아오면(짝 id == 플레이어 고유 id) 두 포털 모두 사라진다
   */
  usePortal(o: ObjectUnit): void {
    const pt = o.portal;
    if (!pt || this.isDead) return;
    const dest = this.levels.get(pt.linkLevel);
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

  private regen(): void {
    // 용병 생명 재생: STAT_HPREGEN = 최대 생명(<<8) / 2000 (1/256 단위, 매 프레임). 출처: MONSTERAI_UpdateMercStatsAndSkills
    // 근사(원작 미확인): 재생 적용 주기 — 매 프레임
    const mu = this.mercUnit();
    if (mu && this.mercInfo && mu.hp < mu.stats.maxHp) mu.hp = Math.min(mu.stats.maxHp, mu.hp + this.mercInfo.hpRegen / 256);
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
      if (m.hp >= m.stats.maxHp || !m.hpRegen) continue;
      m.hp = Math.min(m.stats.maxHp, m.hp + (m.stats.maxHp * m.type.damageRegen) / 4096);
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
}

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
}

/** 미사일이 유닛에 닿는 거리 */
const reachOf = (d: MissileDef, m: MonsterUnit): number => (d.size + 1) / 2 + m.type.sizeX / 2;
/** 지면 불 미사일 (Blaze·Fire Wall: pSrvDmgFunc 3, 제자리에서 닿는 적에게 매 프레임 피해) */
const isGroundFire = (d: MissileDef): boolean => d.srvDmgFunc === 3;
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

export { aiDistance };
