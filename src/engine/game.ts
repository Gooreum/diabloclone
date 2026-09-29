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
import type { MonsterDb } from './monster';
import { aiDistance, isInMeleeRange, modeTiming, rollGetHit, rollMonsterStats } from './monster';
import { escape, hasAi, idle, think, walkToTarget, type AiWorld, type MonMode, type MonsterUnit, type PetInfo } from './ai';
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
  /** 처음 들어갈 때 배치할 몬스터 */
  spawns?: { typeId: string; x: number; y: number; leaderIndex: number }[];
}

interface LevelState { def: LevelDef; monsters: MonsterUnit[]; ground: GroundItem[]; missiles: Missile[]; populated: boolean }

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
}
export interface GroundItemSnapshot { id: number; code: string; quality: number; quantity: number; x: number; y: number }
export interface MissileSnapshot { id: number; name: string; x: number; y: number; dir: number; celFile: string; frame: number }
/** 플레이어 시체 (죽을 때 장착 아이템이 남는다) */
export interface CorpseSnapshot { x: number; y: number; dir: number; items: ItemInstance[] }
export interface WorldSnapshot {
  tick: number;
  corpse: CorpseSnapshot | null;
  player: PlayerSnapshot;
  monsters: MonsterSnapshot[];
  items: GroundItemSnapshot[];
  missiles: MissileSnapshot[];
  inventory: ItemInstance[];
}

type PlayerAction =
  | { kind: 'skill'; skillId: number; targetId?: number; targetItem?: number; x: number; y: number; standStill: boolean; repeat: boolean }
  | { kind: 'pickup'; itemId: number }
  | { kind: 'corpse' };

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

  constructor(init: GameInit) {
    const defs = init.levels ?? [{ id: 'main', map: init.map, inTown: init.inTown ?? false, exits: [] }];
    for (const d of defs) this.levels.set(d.id, { def: d, monsters: [], ground: [], missiles: [], populated: false });
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
    const leaders: number[] = [];
    level.def.spawns?.forEach((sp, i) => {
      const leader = sp.leaderIndex === i ? undefined : leaders[sp.leaderIndex];
      const m = this.spawnMonster(sp.typeId, sp.x, sp.y, leader);
      leaders[i] = m.id;
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
    this.updateMonsters();
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
      monsters: [...this.monsters, ...this.pets].map((m) => ({
        id: m.id, typeId: m.type.id, code: m.type.code, x: m.x, y: m.y, mode: m.mode, dir: m.dir, modeTick: this.tickCount - m.modeStart,
        hp: m.hp, maxHp: m.stats.maxHp, states: m.states.names(), ...(m.pet ? { ally: true } : {}),
      })),
      items: this.ground.map((g) => ({ id: g.item.id, code: g.item.code, quality: g.item.quality, quantity: g.item.quantity, x: g.x, y: g.y })),
      missiles: this.missiles.map((m) => ({ id: m.id, name: m.def.name, x: m.x, y: m.y, dir: dir64(m.dx, m.dy), celFile: m.def.celFile, frame: m.age % m.def.animLen })),
      inventory: [...this.inventory],
    };
  }

  // ---------------------------------------------------------------- spawning

  spawnMonster(typeId: string, x: number, y: number, leaderId?: number): MonsterUnit {
    if (!this.data) throw new Error('spawnMonster requires game data');
    const type = this.data.monsters.get(typeId);
    const rng = new Rng(Number(this.rng.next() & 0xffffffffn) || 1);
    const stats = rollMonsterStats(this.data.monsters, type, rng);
    const id = this.nextUnitId++;
    const m: MonsterUnit = {
      id, type, stats, x, y, hp: stats.maxHp, mode: 'NU', dir: 0, path: [], moveSpeed: 0,
      nextThink: this.tickCount + rng.pick(Math.max(type.aiDelay, 1)), modeStart: this.tickCount, modeEnd: 0, hitTick: -1, hitDone: true,
      rng, aggro: false, aiParam0: 0, command: 0, leaderId: leaderId ?? id, deathFrame: -1, states: new StateList(), corpseUsed: false,
    };
    this.monsters.push(m);
    return m;
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
        const warp = this.warpClickTarget(cmd.x, cmd.y);
        this.pathPlayerTo(warp ? warp.x : cmd.x, warp ? warp.y : cmd.y, cmd.run);
        return;
      }
      case 'attack': {
        const m = this.monsters.find((x) => x.id === cmd.targetId && x.mode !== 'DT' && x.mode !== 'DD');
        if (!m) return;
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
    return c && cs ? playerAttackRating(this.effStat('dex'), cs.toHitFactor, this.derived()?.toHit ?? 0) : 0;
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
    return this.character?.skills[s.id] ?? 0;
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
  private damageMonster(m: MonsterUnit, raw: DamagePacket, source: 'player' | 'pet' | 'other' = 'player'): void {
    if (m.pet) {
      this.damagePet(m, raw);
      return;
    }
    const d = applyMonsterResists(raw, this.monsterResists(m));
    const total = totalDamage(d);
    m.hp -= total / 256;
    m.aggro = true;
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
      this.killMonster(m, source);
      return;
    }
    const stunned = m.states.has('stunned') || m.states.has('freeze');
    if (!stunned && m.type.modes.has('GH') && rollGetHit(total / 256, m.stats.maxHp, d.hitClass, m.rng)) this.startMonsterMode(m, 'GH');
  }

  /** 몬스터 저항 + 저주 (Amplify Damage: damageresist −100) */
  private monsterResists(m: MonsterUnit): { dm: number; fi: number; li: number; co: number; ma: number; po: number } {
    const r = m.type.resist, st = m.states;
    return {
      dm: r.dm + st.stat('damageresist'), fi: r.fi + st.stat('fireresist'), li: r.li + st.stat('lightresist'),
      co: r.co + st.stat('coldresist'), ma: r.ma + st.stat('magicresist'), po: r.po + st.stat('poisonresist'),
    };
  }

  private killMonster(m: MonsterUnit, source: 'player' | 'pet' | 'other' = 'player'): void {
    m.hp = 0;
    m.path = [];
    m.states.clear();
    this.startMonsterMode(m, 'DT');
    m.deathFrame = this.tickCount;
    this.events.push({ type: 'monsterKilled', targetId: m.id, typeId: m.type.id });
    const c = this.character, cs = this.classStats, table = this.expTable;
    // 소환수가 죽인 몬스터도 주인이 경험치를 받는다. 혼란·가시 등 다른 원인도 플레이어 근처면 받음 (근사)
    if (c && cs && table && (source !== 'other' || Math.hypot(m.x - this.player.x, m.y - this.player.y) < 40)) {
      this.gainExperience(adjustedExperience(m.stats.exp, c.level, m.stats.level));
    }
    const data = this.data;
    const tc = m.type.treasure[0];
    if (data && tc) {
      for (const item of data.treasure.drop(tc, m.stats.level, m.rng, this.derived()?.stat('item_magicbonus') ?? 0)) {
        this.dropItem(item, m.x + 1, m.y + 1);
        this.events.push({ type: 'itemDropped', itemId: item.id, code: item.code, quality: item.quality });
      }
    }
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

  private startMonsterMode(m: MonsterUnit, mode: MonMode): void {
    m.mode = mode;
    m.modeStart = this.tickCount;
    m.hitDone = true;
    if (!this.data) return;
    if (mode === 'A1' || mode === 'A2' || mode === 'S2' || mode === 'GH' || mode === 'DT') {
      // 냉기: attackrate / other_animrate 감소 → 애니메이션이 느려진다 (출처: SUNITDMG_ApplyColdState)
      const rate = mode === 'A1' || mode === 'A2' || mode === 'S2' ? m.states.stat('attackrate') : m.states.stat('other_animrate');
      const t = modeTiming(this.data.anim, m.type.code, mode, m.type.baseW, 100 + rate);
      m.modeEnd = this.tickCount + t.duration;
      m.hitTick = t.hitTick;
      m.hitDone = !(mode === 'A1' || mode === 'A2');
      m.path = [];
      if (mode === 'A1' || mode === 'A2') {
        const t = this.targetOf(m);
        m.dir = dir64(t.x - m.x, t.y - m.y);
      }
    }
  }

  private aiWorld(): AiWorld {
    const p = this.player;
    return {
      frame: this.tickCount,
      target: { x: p.x, y: p.y, size: PLAYER_SIZE, dead: p.mode === 'DT' || p.mode === 'DD', inTown: this.inTown },
      monsters: this.monsters,
      startMode: (m, mode) => this.startMonsterMode(m, mode),
      moveTo: (m, x, y, run) => {
        const t = nearestWalkable(this.map, { x, y }, 4);
        const path = t ? findPath(this.map, m, { x: t.x + 0.5, y: t.y + 0.5 }, 3000) : null;
        if (!path || path.length === 0) return false;
        m.path = path;
        const mode = run ? 'RN' : 'WL';
        if (m.mode !== mode) m.modeStart = this.tickCount;
        m.mode = mode;
        m.moveSpeed = run ? m.type.run : m.type.velocity;
        return true;
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
    for (const m of this.monsters) {
      if (m.mode === 'DD') continue;
      if (m.mode === 'DT') {
        if (this.tickCount >= m.modeEnd) m.mode = 'DD';
        continue;
      }
      // 빙결·기절: 행동 정지 (진행 중 모드의 종료 시점도 함께 미룬다)
      if (m.states.has('freeze') || m.states.has('stunned')) {
        m.modeEnd++;
        m.nextThink = Math.max(m.nextThink, this.tickCount + 1);
        if (m.mode === 'WL' || m.mode === 'RN') {
          m.path = [];
          m.mode = 'NU';
          m.modeStart = this.tickCount;
        }
        continue;
      }
      if (m.mode === 'A1' || m.mode === 'A2' || m.mode === 'S2' || m.mode === 'GH') {
        if (!m.hitDone && this.tickCount - m.modeStart >= m.hitTick) {
          m.hitDone = true;
          this.resolveMonsterAttack(m);
        }
        if (this.tickCount < m.modeEnd) continue;
        m.mode = 'NU';
        m.modeStart = this.tickCount;
        m.nextThink = this.tickCount + m.type.aiDelay;
      }
      if (m.mode === 'WL' || m.mode === 'RN') {
        if (m.path.length) {
          const v = (m.moveSpeed * SUBTILES_PER_YARD) / ENGINE_FPS * (100 + m.states.stat('velocitypercent')) / 100;
          this.advance(m, v, (d) => (m.dir = d), m.type.sizeX);
          continue;
        }
        m.mode = 'NU';
        m.modeStart = this.tickCount;
        m.nextThink = this.tickCount + m.type.aiDelay;
      }
      if (this.tickCount >= m.nextThink && hasAi(m.type.ai)) {
        w.frame = this.tickCount;
        this.chooseMonsterTarget(m, w);
        if (m.states.has('terror')) this.thinkTerror(w, m);
        else if (m.states.has('taunt')) this.thinkTaunt(w, m);
        else think(w, m);
      }
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
      ? { x: best.x, y: best.y, size: best.size, dead: false, inTown: this.inTown && best.id === undefined }
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

  private resolveMonsterAttack(m: MonsterUnit): void {
    const data = this.data;
    const base = m.mode === 'A2' ? m.stats.a2 : m.stats.a1;
    // 저주: damagepercent (Taunt, Battle Cry), item_tohit_percent (Taunt)
    const dmgPct = m.states.stat('damagepercent'), thPct = m.states.stat('item_tohit_percent');
    const atk = {
      min: Math.max(0, base.min + Math.trunc((base.min * dmgPct) / 100)),
      max: Math.max(0, base.max + Math.trunc((base.max * dmgPct) / 100)),
      toHit: Math.max(0, base.toHit + Math.trunc((base.toHit * thPct) / 100)),
    };
    const missName = m.mode === 'A2' ? m.type.missA2 : m.mode === 'A1' ? m.type.missA1 : '';
    if (missName && data) {
      const md = data.missiles.get(missName);
      if (md) {
        let speed = missileStep(md.vel);
        // Slow Missiles: skill_handofathena % 로 미사일 속도. 출처: MISSILES_CreateMissileFromParams (CanSlow + STATE_SLOWMISSILES)
        const slow = m.states.get('slowmissiles');
        if (slow) speed = (speed * (slow.stats.skill_handofathena ?? 100)) / 100;
        const tp = this.targetOf(m);
        const dx = tp.x - m.x, dy = tp.y - m.y;
        const d = Math.hypot(dx, dy) || 1;
        this.missiles.push({
          id: this.nextUnitId++, def: md, x: m.x, y: m.y, dx: (dx / d) * speed, dy: (dy / d) * speed, left: md.range, age: 0,
          owner: 'monster', ownerId: m.id, ownerLevel: m.stats.level,
          damage: { min: Math.floor((atk.min * md.srcDamagePct) / 128) + md.minDamage, max: Math.floor((atk.max * md.srcDamagePct) / 128) + md.maxDamage },
          toHit: atk.toHit, hitClass: 10, hit: new Set(), lvl: 0,
        });
        return;
      }
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
    this.hitPlayer(atk, m.stats.level, m.type.hitClass, false, m);
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
   */
  private hitPlayer(atk: { min: number; max: number; toHit: number }, attackerLevel: number, hitClass: number, missile: boolean, attacker?: MonsterUnit): void {
    const c = this.character, cs = this.classStats;
    const p = this.player;
    if (!c || !cs || p.mode === 'DT' || p.mode === 'DD') return;
    const running = p.mode === 'RN';
    if (!running && !rollPercent(hitChance(atk.toHit, this.playerDefenseValue(), attackerLevel, c.level), this.rng)) {
      this.events.push({ type: 'playerMissed' });
      return;
    }
    const shield = this.equipment.larm ? this.data?.items.base(this.equipment.larm.code) : undefined;
    const dv = this.derived();
    const block = shield?.block ? blockChance(dv?.block ?? shield.block, cs.blockFactor, this.effStat('dex'), c.level, running) : 0;
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
    let dmg = rollDamage({ min: atk.min, max: atk.max }, this.rng);
    // Bone Armor: 근접 물리 피해를 흡수량(bonearmor, 1/256)이 남는 동안 흡수 (auraevent absorbdamage, EventFunc22)
    const ba = missile ? undefined : this.player.states.get('bonearmor');
    if (ba && (ba.stats.bonearmor ?? 0) > 0 && dmg > 0) {
      const absorb = Math.min(dmg * 256, ba.stats.bonearmor ?? 0);
      ba.stats.bonearmor = (ba.stats.bonearmor ?? 0) - absorb;
      dmg -= absorb / 256;
      if ((ba.stats.bonearmor ?? 0) <= 0) this.player.states.remove('bonearmor');
    }
    c.life = Math.max(0, c.life - dmg);
    this.events.push({ type: 'playerHit', damage: dmg });
    if (!missile && attacker && dmg > 0) {
      this.onDamagedInMelee(attacker, dmg);
      this.ironMaiden(attacker, dmg);
    }
    if (c.life <= 0) {
      this.playerDie();
      return;
    }
    // 출처: Maxroll — Breakpoints & Animations: 최대 생명의 1/12 이상 피해 시 피격 경직 (공격·시전 중에는 무시)
    if (dmg * 12 >= this.maxLife() && !p.cast) {
      p.path = [];
      this.setPlayerMode('GH');
    }
    void hitClass;
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
    const pet: MonsterUnit = {
      id, type, stats, x: spot.x + 0.5, y: spot.y + 0.5, hp: stats.maxHp, mode: 'NU', dir: 0, path: [], moveSpeed: 0,
      nextThink: this.tickCount + 1, modeStart: this.tickCount, modeEnd: 0, hitTick: -1, hitDone: true,
      rng, aggro: false, aiParam0: 0, command: 0, leaderId: id, deathFrame: -1, states: new StateList(), corpseUsed: true, pet: info,
    };
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
          this.petAttack(pet);
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
        ms.x += ms.dx;
        ms.y += ms.dy;
        ms.left--;
        const blocked = !this.map.walkable(Math.floor(ms.x), Math.floor(ms.y));
        const hit = Math.hypot(ms.x - p.x, ms.y - p.y) <= 1;
        if (hit && ms.damage) this.hitPlayer({ min: ms.damage.min, max: ms.damage.max, toHit: ms.toHit ?? 0 }, ms.ownerLevel, ms.hitClass, true);
        const petHit = hit ? undefined : this.pets.find((pt) => pt.mode !== 'DT' && pt.mode !== 'DD' && Math.hypot(ms.x - pt.x, ms.y - pt.y) <= 1 + pt.type.sizeX / 2);
        if (petHit && ms.damage) {
          const d = emptyDamage();
          d.phys = rollDamage(ms.damage, this.rng) * 256;
          this.damagePet(petHit, d);
        }
        if (hit || petHit || blocked || ms.left <= 0) this.missiles.splice(i, 1);
        continue;
      }
      if (this.updatePlayerMissile(ms)) this.missiles.splice(this.missiles.indexOf(ms), 1);
    }
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
    const blocked = !this.map.walkable(Math.floor(ms.x), Math.floor(ms.y));
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
    if (checkToHit && ms.ar !== undefined && !rollPercent(hitChance(ms.ar, this.monsterDefense(m, true), c.level, m.stats.level), this.rng)) {
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
    this.damageMonster(m, d);
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
  private regen(): void {
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
      if (m.hp >= m.stats.maxHp) continue;
      m.hp = Math.min(m.stats.maxHp, m.hp + (m.stats.maxHp * m.type.damageRegen) / 4096);
    }
    const c = this.character;
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

export { aiDistance };
