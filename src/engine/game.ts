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
import type { ItemInstance, TreasureDb } from './treasure';
import type { MonsterDb } from './monster';
import { aiDistance, isInMeleeRange, modeTiming, rollGetHit, rollMonsterStats } from './monster';
import { escape, hasAi, idle, think, walkToTarget, type AiWorld, type MonMode, type MonsterUnit } from './ai';
import { addExperience, spendStat, type Character, type ClassName, type ClassStats, type ExpTable } from './player';
import { blockChance, hitChance, playerAttackRating, playerDefense, rollDamage, rollPercent } from './combat';
import { adjustedExperience } from './experience';
import { StateList } from './states';
import type { MissileDef } from './missiles';
import { missileParam } from './missiles';
import type { SkillDb, SkillRecord } from './skills/db';
import type { SkillCalc, SkillOwner } from './skills/formulas';
import { characterOwner, learnSkill, masteryBonus, passiveStat, passiveStats, type PassiveStat } from './skills/rules';
import { addElemental, applyMonsterResists, emptyDamage, totalDamage, type DamagePacket } from './skills/damage';
import { rollCritical, rollWeaponDamage } from './skills/player-damage';
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
  /** 장착 아이템 (슬롯 코드 → 아이템). 슬라이스: rarm, larm */
  equipment?: Record<string, ItemInstance>;
  inTown?: boolean;
  inventory?: ItemInstance[];
  gold?: number;
  /** 여러 레벨 (지정 시 map/inTown 대신 사용). 첫 레벨이 시작 레벨 */
  levels?: LevelDef[];
}

/** 레벨 출구: 플레이어가 영역(서브타일)에 들어가면 다른 레벨의 지정 위치로 이동 */
export interface LevelExit {
  x: number; y: number; w: number; h: number; to: string; toX: number; toY: number;
  /** 지정 시 도착 y = 현재 y + dy (야외 경계처럼 나란히 이어지는 출구) */
  dy?: number;
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
export interface MonsterSnapshot { id: number; typeId: string; code: string; x: number; y: number; mode: MonMode; dir: number; modeTick: number; hp: number; maxHp: number; states: string[] }
export interface GroundItemSnapshot { id: number; code: string; quality: number; quantity: number; x: number; y: number }
export interface MissileSnapshot { id: number; name: string; x: number; y: number; dir: number; celFile: string; frame: number }
export interface WorldSnapshot {
  tick: number;
  player: PlayerSnapshot;
  monsters: MonsterSnapshot[];
  items: GroundItemSnapshot[];
  missiles: MissileSnapshot[];
  inventory: ItemInstance[];
}

type PlayerAction =
  | { kind: 'skill'; skillId: number; targetId?: number; x: number; y: number; standStill: boolean; repeat: boolean }
  | { kind: 'pickup'; itemId: number };

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
}

interface PlayerState {
  id: number; x: number; y: number; mode: PlayerMode; dir: number;
  path: Pt[]; running: boolean; walkVelocity: number; runVelocity: number;
  modeEnd: number; modeStart: number;
  action: PlayerAction | null;
  cast: Cast | null;
  repathAt: number;
  states: StateList;
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
}

/** 원작 미사일 Vel(프레임당 픽셀) → 프레임당 서브타일. 출처: Phrozen Keep KB a=463 — Yards = Vel × Range / 32 */
const missileStep = (vel: number): number => (vel / 32) * SUBTILES_PER_YARD;

export class Game {
  readonly rng: Rng;
  readonly data: GameData | undefined;
  readonly character: Character | undefined;
  readonly classStats: ClassStats | undefined;
  private readonly expTable: ExpTable | undefined;
  readonly equipment: Record<string, ItemInstance>;
  readonly inventory: ItemInstance[] = [];
  gold = 0;
  private tickCount = 0;
  private readonly queue: Command[] = [];
  private readonly player: PlayerState;
  private readonly levels = new Map<string, LevelState>();
  private level: LevelState;
  private nextUnitId = 100;
  private events: GameEvent[] = [];
  private passiveCache: { key: string; list: PassiveStat[] } | null = null;

  constructor(init: GameInit) {
    const defs = init.levels ?? [{ id: 'main', map: init.map, inTown: init.inTown ?? false, exits: [] }];
    for (const d of defs) this.levels.set(d.id, { def: d, monsters: [], ground: [], missiles: [], populated: false });
    this.level = this.levels.get((defs[0] as LevelDef).id) as LevelState;
    this.rng = new Rng(init.seed);
    this.data = init.data;
    this.character = init.character;
    this.classStats = init.classStats;
    this.expTable = init.expTable;
    this.equipment = init.equipment ?? {};
    this.inventory.push(...(init.inventory ?? []));
    this.gold = init.gold ?? 0;
    const p = init.player;
    this.player = {
      id: 1, x: p.x, y: p.y, mode: 'NU', dir: 0, path: [], running: false,
      walkVelocity: p.walkVelocity, runVelocity: p.runVelocity,
      modeEnd: 0, modeStart: 0, action: null, cast: null, repathAt: 0, states: new StateList(),
    };
  }

  get frame(): number {
    return this.tickCount;
  }
  get map(): CollisionMap {
    return this.level.def.map;
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
    this.level = next;
    const p = this.player;
    p.x = x;
    p.y = y;
    p.path = [];
    p.action = null;
    p.cast = null;
    if (p.mode !== 'DT' && p.mode !== 'DD' && p.mode !== 'NU') p.mode = 'NU';
    this.populate(next);
    this.events.push({ type: 'levelChanged', level: id });
  }

  /**
   * 사망 후 부활: 마을에서 생명·마나 가득 찬 상태로 다시 시작.
   * 근사(원작 차이): 원작은 시체에 장비를 남기고 골드 일부를 잃는다 — Phase 7(아이템)에서 구현.
   */
  respawn(levelId: string, x: number, y: number): void {
    const p = this.player;
    p.mode = 'NU';
    p.modeStart = this.tickCount;
    p.states.clear();
    if (this.character) {
      this.character.life = this.character.maxLife;
      this.character.mana = this.character.maxMana;
    }
    this.changeLevel(levelId, x, y);
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
    for (const e of this.level.def.exits) {
      if (p.x >= e.x && p.x < e.x + e.w && p.y >= e.y && p.y < e.y + e.h) {
        const target = this.levels.get(e.to);
        const ty = e.dy !== undefined ? p.y + e.dy : e.toY;
        const spot = target ? nearestWalkable(target.def.map, { x: e.toX, y: ty }, 12) : null;
        this.changeLevel(e.to, spot ? spot.x + 0.5 : e.toX, spot ? spot.y + 0.5 : ty);
        return;
      }
    }
  }

  enqueue(cmd: Command): void {
    this.queue.push(cmd);
  }

  tick(): GameEvent[] {
    this.events = [];
    this.populate(this.level);
    for (const cmd of this.queue.splice(0)) this.apply(cmd);
    this.expireStates();
    this.updatePlayer();
    this.checkExits();
    this.updateMonsters();
    this.updateMissiles();
    this.regen();
    this.tickCount++;
    return this.events;
  }

  snapshot(): Readonly<WorldSnapshot> {
    const p = this.player, c = this.character;
    return {
      tick: this.tickCount,
      player: {
        id: p.id, x: p.x, y: p.y, mode: p.mode, dir: p.dir, modeTick: this.tickCount - p.modeStart, anim: this.seqAnim(),
        life: c?.life ?? 0, maxLife: c?.maxLife ?? 0, mana: c?.mana ?? 0, maxMana: c?.maxMana ?? 0,
        level: c?.level ?? 1, experience: c?.experience ?? 0, gold: this.gold,
        states: p.states.names(), leftSkill: c?.leftSkill ?? 0, rightSkill: c?.rightSkill ?? 0,
      },
      monsters: this.monsters.map((m) => ({
        id: m.id, typeId: m.type.id, code: m.type.code, x: m.x, y: m.y, mode: m.mode, dir: m.dir, modeTick: this.tickCount - m.modeStart,
        hp: m.hp, maxHp: m.stats.maxHp, states: m.states.names(),
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
        this.pathPlayerTo(cmd.x, cmd.y, cmd.run);
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
        p.action = { kind: 'skill', skillId: cmd.skill, targetId: cmd.targetId, x: cmd.x, y: cmd.y, standStill: true, repeat: false };
        return;
      }
      case 'pickup': {
        if (!this.ground.some((g) => g.item.id === cmd.itemId)) return;
        p.action = { kind: 'pickup', itemId: cmd.itemId };
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
    const key = JSON.stringify(c.skills) + c.level;
    if (this.passiveCache?.key !== key) this.passiveCache = { key, list: passiveStats(c, db, calc) };
    return this.passiveCache.list;
  }

  /** 플레이어 스탯 = 패시브 스킬 + 상태(버프) */
  private playerStat(stat: string): number {
    return passiveStat(this.passives(), stat) + this.player.states.stat(stat);
  }

  private playerDefenseValue(): number {
    const c = this.character;
    if (!c) return 0;
    const armor = Object.values(this.equipment).reduce((s, it) => s + it.defense, 0);
    const base = playerDefense(c.dex, armor);
    // 출처: itemstatcost.txt skill_armor_percent — 방어력 % 증가 (Iron Skin, Shout, Concentrate)
    return Math.trunc((base * (100 + this.playerStat('skill_armor_percent'))) / 100);
  }

  /** 플레이어 AR (명중% 보너스 적용 전). 출처: combat.ts playerAttackRating */
  private playerAR(): number {
    const c = this.character, cs = this.classStats;
    return c && cs ? playerAttackRating(c.dex, cs.toHitFactor) : 0;
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
    return ((v * SUBTILES_PER_YARD) / ENGINE_FPS) * (100 + this.playerStat('velocitypercent')) / 100;
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

  private pickUp(g: GroundItem): void {
    this.ground.splice(this.ground.indexOf(g), 1);
    if (g.item.code === 'gld') {
      this.gold += g.item.quantity;
      this.events.push({ type: 'goldPickup', amount: g.item.quantity });
    } else {
      this.inventory.push(g.item);
      this.events.push({ type: 'itemPickup', itemId: g.item.id, code: g.item.code });
    }
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
    if (c && s.id > 5 && this.data.skillCalc && this.data.skillCalc.manaCost256(s, this.skillLevel(s)) > c.mana * 256) {
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
    const target = act.targetId !== undefined ? this.monsters.find((m) => m.id === act.targetId) : undefined;
    const corpseSkill = s.targetCorpse;
    if (corpseSkill) {
      const corpse = target ?? this.findCorpse(act.x, act.y);
      if (!corpse || corpse.mode !== 'DD' || corpse.corpseUsed) {
        p.action = null;
        return;
      }
      if (isInMeleeRange(p.x, p.y, PLAYER_SIZE, 0, corpse.x, corpse.y, corpse.type.sizeX, 1)) {
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
  private startCast(s: SkillRecord, targetId: number | undefined, tx: number, ty: number): boolean {
    const p = this.player, c = this.character, data = this.data;
    if (!data) return false;
    const lvl = this.skillLevel(s);
    if (!this.startCheck(s, targetId)) return false;
    if (c && s.id > 5 && data.skillCalc) c.mana = Math.max(0, c.mana - data.skillCalc.manaCost256(s, lvl) / 256);
    if (Math.hypot(tx - p.x, ty - p.y) > 1e-6) p.dir = dir64(tx - p.x, ty - p.y);
    const wclass = this.weaponWclass();
    const token = this.playerToken();
    // 무기 공격 속도: weapons.txt speed (WSM, 음수 = 빠름). 출처: Maxroll Attack Speed — AnimRate − WSM
    const speedPct = s.useAttackRate ? 100 - (this.weaponBase()?.speed ?? 0) : 100;
    const cast: Cast = { skill: s, lvl, targetId, tx, ty, start: this.tickCount, end: this.tickCount + 1, hitTicks: [], fired: 0 };
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
    const t = this.tickCount - cast.start;
    if (cast.leap) {
      const L = cast.leap;
      const k = Math.min(1, t / Math.max(1, L.landTick));
      p.x = L.fx + (L.tx - L.fx) * k;
      p.y = L.fy + (L.ty - L.fy) * k;
    }
    while (cast.fired < cast.hitTicks.length && t >= (cast.hitTicks[cast.fired] as number)) {
      this.skillEvent(cast, cast.fired);
      cast.fired++;
      if (!p.cast) return;
    }
    if (this.tickCount >= cast.end) {
      p.cast = null;
      p.mode = 'NU';
      p.modeStart = this.tickCount;
      if (cast.skill.auraState && (cast.skill.srvDoFunc === 2 || cast.skill.srvStFunc === 32)) p.states.remove(cast.skill.auraState);
    }
  }

  /** 시퀀스 스킬 중이면 지금 그릴 [모드, 프레임] */
  private seqAnim(): { mode: string; frame: number } | undefined {
    const c = this.player.cast;
    if (!c?.seq) return undefined;
    const i = Math.min(c.seq.frames.length - 1, Math.floor(((this.tickCount - c.start) * c.seq.rate) / 256));
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
        // Bash/Stun/Concentrate(St32), Power Strike(St6), Impale(St7) — 근접 한 번
        if (!live) return;
        this.meleeHit(live, this.meleeSpecFor(s, lvl));
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
        const p = this.player;
        let ux = cast.tx - p.x, uy = cast.ty - p.y;
        const d = Math.hypot(ux, uy) || 1;
        ux /= d;
        uy /= d;
        for (let i = 0; i < count; i++) {
          const off = i - (count - 1) / 2;
          this.spawnPlayerMissile(def, s, lvl, cast.tx - uy * off, cast.ty + ux * off, undefined, { srcDam: def.srcDamage, useSkillDamage: false });
        }
        this.decQuantity('larm');
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
        // Howl: 퍼져 나가는 함성에 닿은 적이 공포(도주). 출처: SKILLS_SrvDo022 + MISSMODE_SrvHit17_Howl
        const def = data.missiles.get(s.srvMissileA);
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
    const w = this.weaponBase();
    const passives = this.passives();
    const pct = spec.toHitPct + masteryBonus(passives, data.items, w, 'th') + this.playerStat('item_tohit_percent');
    const ar = this.playerAR();
    if (!rollPercent(hitChance(ar + Math.trunc((ar * pct) / 100), this.monsterDefense(m, false), c.level, m.stats.level), this.rng)) {
      this.events.push({ type: 'miss', targetId: m.id });
      return false;
    }
    const d = emptyDamage();
    d.phys = rollWeaponDamage({
      weapon: w, str: c.str, dex: c.dex, enDmgPct: spec.enDmgPct, damagePercent: this.playerStat('damagepercent'),
      masteryDmg: masteryBonus(passives, data.items, w, 'dmg'), srcDam: spec.srcDam,
    }, this.rng);
    if (rollCritical(masteryBonus(passives, data.items, w, 'crit'), this.playerStat('passive_critical_strike'), this.rng)) {
      d.phys *= 2;
      d.crit = true;
    }
    d.phys += spec.flat256;
    d.hitClass = spec.hitClass || (w ? (data.hitClassIndex.get(w.hitClass) ?? 1) : 1);
    if (spec.elem) addElemental(d, spec.elem.eType, spec.elem.amount, spec.elem.len);
    if (spec.hitClass) d.hitClass = spec.hitClass;
    this.damageMonster(m, d);
    return true;
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
  private damageMonster(m: MonsterUnit, raw: DamagePacket): void {
    const d = applyMonsterResists(raw, m.type.resist);
    const total = totalDamage(d);
    m.hp -= total / 256;
    m.aggro = true;
    m.states.remove('terror');
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
      this.killMonster(m);
      return;
    }
    const stunned = m.states.has('stunned') || m.states.has('freeze');
    if (!stunned && m.type.modes.has('GH') && rollGetHit(total / 256, m.stats.maxHp, d.hitClass, m.rng)) this.startMonsterMode(m, 'GH');
  }

  private killMonster(m: MonsterUnit): void {
    m.hp = 0;
    m.path = [];
    m.states.clear();
    this.startMonsterMode(m, 'DT');
    m.deathFrame = this.tickCount;
    this.events.push({ type: 'monsterKilled', targetId: m.id, typeId: m.type.id });
    const c = this.character, cs = this.classStats, table = this.expTable;
    if (c && cs && table) {
      const exp = adjustedExperience(m.stats.exp, c.level, m.stats.level);
      const gained = addExperience(c, cs, table, exp);
      this.events.push({ type: 'experience', amount: exp });
      if (gained > 0) {
        this.passiveCache = null;
        this.events.push({ type: 'levelUp', level: c.level });
      }
    }
    const data = this.data;
    const tc = m.type.treasure[0];
    if (data && tc) {
      for (const item of data.treasure.drop(tc, m.stats.level, m.rng)) {
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
    const speed = missileStep(def.vel + Math.trunc((lvl * def.velLev) / 8));
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
      id: this.nextUnitId++, def, x: from.x, y: from.y, dx, dy, left: def.range + lvl * def.levRange, age: 0,
      owner: 'player', ownerId: p.id, ownerLevel: c.level, hitClass: def.hitClass || s.hitClass || 10, ar, roll, hit: new Set(),
      homingTarget: o.homing ? targetId : undefined, wander: o.wander,
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
    if (sub) m.trail = { def: sub, every: Math.max(1, sub.params[0] || 2), roll: this.missileDamageRoller(sub, s, lvl, { srcDam: 0, useSkillDamage: true }) };
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
        d.phys += rollWeaponDamage({
          weapon: w, thrown: o.thrown, str: c.str, dex: c.dex, enDmgPct: o.damagePct ?? 0, damagePercent: this.playerStat('damagepercent'),
          masteryDmg: masteryBonus(passives, data.items, w, 'dmg', o.thrown), srcDam: o.srcDam,
        }, this.rng);
        if (rollCritical(o.thrown ? masteryBonus(passives, data.items, w, 'crit', true) : 0, this.playerStat('passive_critical_strike'), this.rng)) {
          d.phys *= 2;
          d.crit = true;
        }
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
      if (mode === 'A1' || mode === 'A2') m.dir = dir64(this.player.x - m.x, this.player.y - m.y);
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
        if (m.states.has('terror')) this.thinkTerror(w, m);
        else if (m.states.has('taunt')) this.thinkTaunt(w, m);
        else think(w, m);
      }
    }
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
        const dx = this.player.x - m.x, dy = this.player.y - m.y;
        const d = Math.hypot(dx, dy) || 1;
        this.missiles.push({
          id: this.nextUnitId++, def: md, x: m.x, y: m.y, dx: (dx / d) * speed, dy: (dy / d) * speed, left: md.range, age: 0,
          owner: 'monster', ownerId: m.id, ownerLevel: m.stats.level,
          damage: { min: Math.floor((atk.min * md.srcDamagePct) / 128) + md.minDamage, max: Math.floor((atk.max * md.srcDamagePct) / 128) + md.maxDamage },
          toHit: atk.toHit, hitClass: 10, hit: new Set(),
        });
        return;
      }
    }
    if (m.mode === 'S2') return;
    const p = this.player;
    if (!isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, p.x, p.y, PLAYER_SIZE, 1)) return;
    this.hitPlayer(atk, m.stats.level, m.type.hitClass, false);
  }

  /**
   * 몬스터 → 플레이어 피해.
   * 출처: SUNITDMG_GetResultFlags — 달리는 플레이어는 항상 맞는다, 명중 후 막기(달리기 1/3) → 회피
   *       SUNITDMG_ApplyDodge — 걷기/달리기 중이면 Evade, 아니면 근접은 Dodge, 미사일은 Avoid
   */
  private hitPlayer(atk: { min: number; max: number; toHit: number }, attackerLevel: number, hitClass: number, missile: boolean): void {
    const c = this.character, cs = this.classStats;
    const p = this.player;
    if (!c || !cs || p.mode === 'DT' || p.mode === 'DD') return;
    const running = p.mode === 'RN';
    if (!running && !rollPercent(hitChance(atk.toHit, this.playerDefenseValue(), attackerLevel, c.level), this.rng)) {
      this.events.push({ type: 'playerMissed' });
      return;
    }
    const shield = this.equipment.larm ? this.data?.items.base(this.equipment.larm.code) : undefined;
    const block = shield?.block ? blockChance(shield.block, cs.blockFactor, c.dex, c.level, running) : 0;
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
    const dmg = rollDamage({ min: atk.min, max: atk.max }, this.rng);
    c.life = Math.max(0, c.life - dmg);
    this.events.push({ type: 'playerHit', damage: dmg });
    if (c.life <= 0) {
      p.path = [];
      p.action = null;
      p.cast = null;
      this.setPlayerMode('DT');
      this.events.push({ type: 'playerDied' });
      return;
    }
    // 출처: Maxroll — Breakpoints & Animations: 최대 생명의 1/12 이상 피해 시 피격 경직 (공격·시전 중에는 무시)
    if (dmg * 12 >= c.maxLife && !p.cast) {
      p.path = [];
      this.setPlayerMode('GH');
    }
    void hitClass;
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
        if (hit || blocked || ms.left <= 0) this.missiles.splice(i, 1);
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
      // 근사(원작 미확인): Charged Strike 볼트의 불규칙 이동을 3프레임마다 무작위 방향 전환으로 근사
      const sp = Math.hypot(ms.dx, ms.dy);
      const a = Math.atan2(ms.dy, ms.dx) + ((this.rng.pick(5) - 2) * Math.PI) / 8;
      ms.dx = Math.cos(a) * sp;
      ms.dy = Math.sin(a) * sp;
    }
    ms.x += ms.dx;
    ms.y += ms.dy;
    if (ms.trail && ms.age % ms.trail.every === 0) this.spawnCloud(ms.trail.def, ms.x, ms.y, ms.trail.roll, ms);
    const blocked = !this.map.walkable(Math.floor(ms.x), Math.floor(ms.y));
    if (blocked || ms.left <= 0) {
      this.missileEnd(ms, undefined);
      return true;
    }
    const reach = (ms.def.size + 1) / 2;
    for (const m of this.monsters) {
      if (m.mode === 'DT' || m.mode === 'DD' || ms.hit.has(m.id)) continue;
      if (Math.hypot(m.x - ms.x, m.y - ms.y) > reach + m.type.sizeX / 2) continue;
      // Guided Arrow: 대상이 아닌 적은 통과. 출처: MISSMODE_SrvHit10_GuidedArrow
      if (ms.homingTarget !== undefined && m.id !== ms.homingTarget && this.monsters.some((x) => x.id === ms.homingTarget && x.mode !== 'DT' && x.mode !== 'DD')) continue;
      ms.hit.add(m.id);
      this.missileHit(ms, m, true);
      if (ms.def.collideKill) {
        this.missileEnd(ms, m);
        return true;
      }
    }
    return false;
  }

  private missileHit(ms: Missile, m: MonsterUnit, checkToHit: boolean): void {
    const c = this.character;
    if (!c || !ms.roll) return;
    if (checkToHit && ms.ar !== undefined && !rollPercent(hitChance(ms.ar, this.monsterDefense(m, true), c.level, m.stats.level), this.rng)) {
      this.events.push({ type: 'miss', targetId: m.id });
      return;
    }
    this.damageMonster(m, ms.roll());
  }

  /** 충돌·소멸: 폭발(Exploding Arrow), 구름(Plague Javelin) */
  private missileEnd(ms: Missile, hitUnit: MonsterUnit | undefined): void {
    if (ms.explode) for (const m of this.monstersNear(ms.x, ms.y, ms.explode.radius)) this.damageMonster(m, ms.explode.roll());
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
      cloud: { radius: Math.max(1, def.size), every: Math.max(1, def.params[1] || 4) },
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
    if (c && this.player.mode !== 'DT' && this.player.mode !== 'DD' && c.mana < c.maxMana) {
      c.mana = Math.min(c.maxMana, c.mana + ((256 * c.maxMana) / (25 * 120)) / 256);
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
}

export { aiDistance };
