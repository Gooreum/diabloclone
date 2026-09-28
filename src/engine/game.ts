// 게임 시뮬레이션: 명령 큐 → 고정 25fps 틱 → 이벤트 + 읽기 전용 스냅샷. (DOM/렌더 비의존)
import type { Command } from './command';
import type { CollisionMap } from './collision';
import { dir64, SUBTILES_PER_YARD, type Pt } from './geom';
import { ENGINE_FPS } from './index';
import { findPath, nearestWalkable } from './path';
import { Rng } from './rng';
import type { AnimData } from '../formats/animdata';
import type { ItemDb } from './items';
import type { ItemInstance, TreasureDb } from './treasure';
import type { MonsterDb } from './monster';
import { isInMeleeRange, modeTiming, rollGetHit, rollMonsterStats } from './monster';
import { hasAi, think, type AiWorld, type MonMode, type MonsterUnit } from './ai';
import { addExperience, type Character, type ClassName, type ClassStats, type ExpTable } from './player';
import { blockChance, hitChance, physicalDamageRange, playerAttackRating, playerDefense, rollDamage, rollPercent } from './combat';
import { adjustedExperience } from './experience';

/** 원작 애니메이션 모드 토큰: NU 대기, WL 걷기, RN 달리기, A1 공격, GH 피격, DT 사망, TN 마을 대기 */
export type PlayerMode = 'NU' | 'WL' | 'RN' | 'TN' | 'TW' | 'A1' | 'GH' | 'DT' | 'DD';

// 출처: 원작 MPQ 경로 data\global\CHARS\<토큰>\ (AM, SO, NE, PA, BA)
export const CLASS_TOKEN: Record<ClassName, string> = { Amazon: 'AM', Sorceress: 'SO', Necromancer: 'NE', Paladin: 'PA', Barbarian: 'BA' };
const PLAYER_SIZE = 2;
const PICKUP_RANGE = 2;

export interface GameData {
  monsters: MonsterDb;
  treasure: TreasureDb;
  items: ItemDb;
  anim: AnimData;
  /** HitClass.txt 코드 → 행 번호 */
  hitClassIndex: Map<string, number>;
  missiles: Map<string, { vel: number; range: number; size: number; srcDamagePct: number; minDamage: number; maxDamage: number }>;
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

export interface PlayerSnapshot { id: number; x: number; y: number; mode: PlayerMode; dir: number; modeTick: number; life: number; maxLife: number; mana: number; maxMana: number; level: number; experience: number; gold: number }
export interface MonsterSnapshot { id: number; typeId: string; code: string; x: number; y: number; mode: MonMode; dir: number; modeTick: number; hp: number; maxHp: number }
export interface GroundItemSnapshot { id: number; code: string; quality: number; quantity: number; x: number; y: number }
export interface MissileSnapshot { id: number; name: string; x: number; y: number }
export interface WorldSnapshot {
  tick: number;
  player: PlayerSnapshot;
  monsters: MonsterSnapshot[];
  items: GroundItemSnapshot[];
  missiles: MissileSnapshot[];
  inventory: ItemInstance[];
}

interface PlayerState {
  id: number; x: number; y: number; mode: PlayerMode; dir: number;
  path: Pt[]; running: boolean; walkVelocity: number; runVelocity: number;
  modeEnd: number; hitTick: number; hitDone: boolean; modeStart: number;
  /** 진행 중인 행동 */
  action: { kind: 'attack'; targetId: number; standStill: boolean } | { kind: 'pickup'; itemId: number } | null;
  repathAt: number;
}

interface GroundItem { item: ItemInstance; x: number; y: number }
interface Missile { id: number; name: string; x: number; y: number; dx: number; dy: number; left: number; ownerId: number; damage: { min: number; max: number }; toHit: number; ownerLevel: number; hitClass: number }

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
    const p = init.player;
    this.player = {
      id: 1, x: p.x, y: p.y, mode: 'NU', dir: 0, path: [], running: false,
      walkVelocity: p.walkVelocity, runVelocity: p.runVelocity,
      modeEnd: 0, hitTick: -1, hitDone: true, modeStart: 0, action: null, repathAt: 0,
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
    if (p.mode === 'WL' || p.mode === 'RN') p.mode = 'NU';
    this.populate(next);
    this.events.push({ type: 'levelChanged', level: id });
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
        id: p.id, x: p.x, y: p.y, mode: p.mode, dir: p.dir, modeTick: this.tickCount - p.modeStart,
        life: c?.life ?? 0, maxLife: c?.maxLife ?? 0, mana: c?.mana ?? 0, maxMana: c?.maxMana ?? 0,
        level: c?.level ?? 1, experience: c?.experience ?? 0, gold: this.gold,
      },
      monsters: this.monsters.map((m) => ({ id: m.id, typeId: m.type.id, code: m.type.code, x: m.x, y: m.y, mode: m.mode, dir: m.dir, modeTick: this.tickCount - m.modeStart, hp: m.hp, maxHp: m.stats.maxHp })),
      items: this.ground.map((g) => ({ id: g.item.id, code: g.item.code, quality: g.item.quality, quantity: g.item.quantity, x: g.x, y: g.y })),
      missiles: this.missiles.map((m) => ({ id: m.id, name: m.name, x: m.x, y: m.y })),
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
      rng, aggro: false, aiParam0: 0, command: 0, leaderId: leaderId ?? id, deathFrame: -1,
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
    const p = this.player;
    if (p.mode === 'DT' || p.mode === 'DD') return;
    switch (cmd.type) {
      case 'move': {
        if (this.isBusy()) return;
        p.action = null;
        this.pathPlayerTo(cmd.x, cmd.y, cmd.run);
        return;
      }
      case 'attack': {
        if (!this.monsters.some((m) => m.id === cmd.targetId && m.mode !== 'DT' && m.mode !== 'DD')) return;
        p.action = { kind: 'attack', targetId: cmd.targetId, standStill: cmd.standStill };
        return;
      }
      case 'pickup': {
        if (!this.ground.some((g) => g.item.id === cmd.itemId)) return;
        p.action = { kind: 'pickup', itemId: cmd.itemId };
        return;
      }
      default:
        this.events.push({ type: 'unhandledCommand', command: cmd.type });
    }
  }

  private isBusy(): boolean {
    const m = this.player.mode;
    return (m === 'A1' || m === 'GH') && this.tickCount < this.player.modeEnd;
  }

  private pathPlayerTo(x: number, y: number, run: boolean): boolean {
    const p = this.player;
    const target = nearestWalkable(this.map, { x, y });
    const path = target ? findPath(this.map, p, { x: target.x + 0.5, y: target.y + 0.5 }) : null;
    if (!path) {
      this.events.push({ type: 'moveBlocked' });
      return false;
    }
    p.path = path;
    p.running = run;
    return true;
  }

  // ---------------------------------------------------------------- player

  private weaponWclass(): string {
    const w = this.equipment.rarm;
    const base = w ? this.data?.items.base(w.code) : undefined;
    return (base?.wclass || 'hth').toUpperCase();
  }

  private playerToken(): string {
    return this.character ? CLASS_TOKEN[this.character.cls] : 'BA';
  }

  private setPlayerMode(mode: PlayerMode, speedPercent = 100): void {
    const p = this.player;
    p.mode = mode;
    p.modeStart = this.tickCount;
    p.hitDone = true;
    if (mode === 'A1' || mode === 'GH' || mode === 'DT') {
      if (!this.data) {
        p.modeEnd = this.tickCount + 10;
        p.hitTick = 5;
      } else {
        const t = modeTiming(this.data.anim, this.playerToken(), mode, this.weaponWclass(), speedPercent, mode === 'A1');
        p.modeEnd = this.tickCount + t.duration;
        p.hitTick = t.hitTick;
      }
      p.hitDone = mode !== 'A1';
    }
  }

  private updatePlayer(): void {
    const p = this.player;
    if (p.mode === 'DD') return;
    if (p.mode === 'DT') {
      if (this.tickCount >= p.modeEnd) p.mode = 'DD';
      return;
    }
    if (p.mode === 'A1' || p.mode === 'GH') {
      if (p.mode === 'A1' && !p.hitDone && this.tickCount - p.modeStart >= p.hitTick) {
        p.hitDone = true;
        this.resolvePlayerHit();
      }
      if (this.tickCount < p.modeEnd) return;
      p.mode = 'NU';
      p.modeStart = this.tickCount;
    }
    const act = p.action;
    if (act?.kind === 'attack') {
      const target = this.monsters.find((m) => m.id === act.targetId);
      if (!target || target.mode === 'DT' || target.mode === 'DD') {
        p.action = null;
      } else if (isInMeleeRange(p.x, p.y, PLAYER_SIZE, this.playerMeleeRange(), target.x, target.y, target.type.sizeX)) {
        p.path = [];
        p.dir = dir64(target.x - p.x, target.y - p.y);
        this.setPlayerMode('A1', 100 - this.weaponSpeed());
        return;
      } else if (act.standStill) {
        p.dir = dir64(target.x - p.x, target.y - p.y);
        this.setPlayerMode('A1', 100 - this.weaponSpeed());
        p.action = null;
        p.hitDone = true;
        return;
      } else if (this.tickCount >= p.repathAt) {
        this.pathPlayerTo(target.x, target.y, p.running);
        p.repathAt = this.tickCount + 5;
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

  private playerMeleeRange(): number {
    return 0;
  }

  private weaponSpeed(): number {
    const w = this.equipment.rarm;
    return w ? (this.data?.items.base(w.code)?.speed ?? 0) : 0;
  }

  /** 1프레임 이동량 (서브타일) = 속도(야드/초) × 1.5 / 25 */
  private stepLength(): number {
    const v = this.player.running ? this.player.runVelocity : this.player.walkVelocity;
    return (v * SUBTILES_PER_YARD) / ENGINE_FPS;
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

  /** 플레이어 근접 공격 판정 (출처: combat.ts 의 Maxroll 공식) */
  private resolvePlayerHit(): void {
    const act = this.player.action;
    const c = this.character, cs = this.classStats, data = this.data;
    if (!act || act.kind !== 'attack' || !c || !cs || !data) return;
    const m = this.monsters.find((x) => x.id === act.targetId);
    if (!m || m.mode === 'DT' || m.mode === 'DD') return;
    if (!isInMeleeRange(this.player.x, this.player.y, PLAYER_SIZE, this.playerMeleeRange(), m.x, m.y, m.type.sizeX, 1)) return;
    const ar = playerAttackRating(c.dex, cs.toHitFactor);
    if (!rollPercent(hitChance(ar, m.stats.defense, c.level, m.stats.level), this.rng)) {
      this.events.push({ type: 'miss', targetId: m.id });
      return;
    }
    const wItem = this.equipment.rarm;
    const w = wItem ? data.items.base(wItem.code) : undefined;
    // 맨손: 1~2 (출처: charstats 기본 무기 클래스 hth — 무기 없음 시 최소 피해, 원작 수치 미확인 → 근사)
    const range = w ? physicalDamageRange({ min: w.minDam, max: w.maxDam, strBonus: w.strBonus, dexBonus: w.dexBonus }, c.str, c.dex) : { min: 1, max: 2 };
    let dmg = rollDamage(range, this.rng);
    dmg = Math.floor((dmg * (100 - Math.min(m.type.resist.dm, 100))) / 100);
    const hitClass = w ? (data.hitClassIndex.get(w.hitClass) ?? 1) : 1;
    this.damageMonster(m, dmg, hitClass);
  }

  private damageMonster(m: MonsterUnit, dmg: number, hitClass: number): void {
    m.hp -= dmg;
    m.aggro = true;
    this.events.push({ type: 'monsterHit', targetId: m.id, damage: dmg });
    if (m.hp <= 0) {
      this.killMonster(m);
      return;
    }
    if (m.type.modes.has('GH') && rollGetHit(dmg, m.stats.maxHp, hitClass, m.rng)) this.startMonsterMode(m, 'GH');
  }

  private killMonster(m: MonsterUnit): void {
    m.hp = 0;
    m.path = [];
    this.startMonsterMode(m, 'DT');
    m.deathFrame = this.tickCount;
    this.events.push({ type: 'monsterKilled', targetId: m.id, typeId: m.type.id });
    const c = this.character, cs = this.classStats, table = this.expTable;
    if (c && cs && table) {
      const exp = adjustedExperience(m.stats.exp, c.level, m.stats.level);
      const gained = addExperience(c, cs, table, exp);
      this.events.push({ type: 'experience', amount: exp });
      if (gained > 0) this.events.push({ type: 'levelUp', level: c.level });
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

  // ---------------------------------------------------------------- monsters

  private startMonsterMode(m: MonsterUnit, mode: MonMode): void {
    m.mode = mode;
    m.modeStart = this.tickCount;
    m.hitDone = true;
    if (!this.data) return;
    if (mode === 'A1' || mode === 'A2' || mode === 'S2' || mode === 'GH' || mode === 'DT') {
      const t = modeTiming(this.data.anim, m.type.code, mode, m.type.baseW);
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

  private updateMonsters(): void {
    const w = this.aiWorld();
    for (const m of this.monsters) {
      if (m.mode === 'DD') continue;
      if (m.mode === 'DT') {
        if (this.tickCount >= m.modeEnd) m.mode = 'DD';
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
          this.advance(m, (m.moveSpeed * SUBTILES_PER_YARD) / ENGINE_FPS, (d) => (m.dir = d), m.type.sizeX);
          continue;
        }
        m.mode = 'NU';
        m.modeStart = this.tickCount;
        m.nextThink = this.tickCount + m.type.aiDelay;
      }
      if (this.tickCount >= m.nextThink && hasAi(m.type.ai)) {
        w.frame = this.tickCount;
        think(w, m);
      }
    }
  }

  private resolveMonsterAttack(m: MonsterUnit): void {
    const data = this.data;
    const atk = m.mode === 'A2' ? m.stats.a2 : m.stats.a1;
    const missName = m.mode === 'A2' ? m.type.missA2 : m.mode === 'A1' ? m.type.missA1 : '';
    if (missName && data) {
      const md = data.missiles.get(missName);
      if (md) {
        // 출처: Phrozen Keep KB a=463 — Vel = 프레임당 픽셀, Yards = Vel × Range / 32 → 프레임당 Vel/32 야드
        const speed = (md.vel / 32) * SUBTILES_PER_YARD;
        const dx = this.player.x - m.x, dy = this.player.y - m.y;
        const d = Math.hypot(dx, dy) || 1;
        this.missiles.push({
          id: this.nextUnitId++, name: missName, x: m.x, y: m.y, dx: (dx / d) * speed, dy: (dy / d) * speed, left: md.range, ownerId: m.id,
          damage: { min: Math.floor((atk.min * md.srcDamagePct) / 128) + md.minDamage, max: Math.floor((atk.max * md.srcDamagePct) / 128) + md.maxDamage },
          toHit: atk.toHit, ownerLevel: m.stats.level, hitClass: 10,
        });
        return;
      }
    }
    if (m.mode === 'S2') return;
    const p = this.player;
    if (!isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, p.x, p.y, PLAYER_SIZE, 1)) return;
    this.hitPlayer(atk, m.stats.level, m.type.hitClass);
  }

  private hitPlayer(atk: { min: number; max: number; toHit: number }, attackerLevel: number, hitClass: number): void {
    const c = this.character, cs = this.classStats;
    const p = this.player;
    if (!c || !cs || p.mode === 'DT' || p.mode === 'DD') return;
    const armor = Object.values(this.equipment).reduce((s, it) => s + it.defense, 0);
    if (!rollPercent(hitChance(atk.toHit, playerDefense(c.dex, armor), attackerLevel, c.level), this.rng)) {
      this.events.push({ type: 'playerMissed' });
      return;
    }
    const shield = this.equipment.larm ? this.data?.items.base(this.equipment.larm.code) : undefined;
    const block = shield?.block ? blockChance(shield.block, cs.blockFactor, c.dex, c.level, p.mode === 'RN') : 0;
    if (block > 0 && rollPercent(block, this.rng)) {
      this.events.push({ type: 'playerBlocked' });
      return;
    }
    const dmg = rollDamage({ min: atk.min, max: atk.max }, this.rng);
    c.life = Math.max(0, c.life - dmg);
    this.events.push({ type: 'playerHit', damage: dmg });
    if (c.life <= 0) {
      p.path = [];
      p.action = null;
      this.setPlayerMode('DT');
      this.events.push({ type: 'playerDied' });
      return;
    }
    // 출처: Maxroll — Breakpoints & Animations: 최대 생명의 1/12 이상 피해 시 피격 경직
    if (dmg * 12 >= c.maxLife && p.mode !== 'A1') {
      p.path = [];
      this.setPlayerMode('GH');
    }
    void hitClass;
  }

  private updateMissiles(): void {
    const p = this.player;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const ms = this.missiles[i] as Missile;
      ms.x += ms.dx;
      ms.y += ms.dy;
      ms.left--;
      const blocked = !this.map.walkable(Math.floor(ms.x), Math.floor(ms.y));
      const hit = Math.hypot(ms.x - p.x, ms.y - p.y) <= 1;
      if (hit) this.hitPlayer({ min: ms.damage.min, max: ms.damage.max, toHit: ms.toHit }, ms.ownerLevel, ms.hitClass);
      if (hit || blocked || ms.left <= 0) this.missiles.splice(i, 1);
    }
  }

  /**
   * 재생. 몬스터: HP 재생 = maxHP(×256) × DamageRegen >> 12 (1/256 단위/프레임) (출처: D2MOO Monster.cpp STAT_HPREGEN)
   * 플레이어 마나: 초당 25 × (256 × 최대마나 / (25 × 120)) / 256 (출처: Maxroll Life & Mana Mechanics, charstats ManaRegen=120)
   */
  private regen(): void {
    for (const m of this.monsters) {
      if (m.mode === 'DT' || m.mode === 'DD' || m.hp >= m.stats.maxHp) continue;
      m.hp = Math.min(m.stats.maxHp, m.hp + (m.stats.maxHp * m.type.damageRegen) / 4096);
    }
    const c = this.character;
    if (c && this.player.mode !== 'DT' && this.player.mode !== 'DD' && c.mana < c.maxMana) {
      c.mana = Math.min(c.maxMana, c.mana + ((256 * c.maxMana) / (25 * 120)) / 256);
    }
  }
}
