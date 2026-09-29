// Act 1 오버월드 (마을 + 야외 전 지역 + 수도원 정문/바깥 회랑): 원작 DRLG 이식 결과를 엔진 레벨로 조립.
// 순수 알고리즘은 src/engine/drlg/* (act1.ts), 여기서는 원작 테이블·DS1/DT1 파일 접근과 LevelDef 구성만 한다.
import { parseDt1, type Dt1Tile } from '../formats/dt1';
import { buildPresetLevel, type PresetLevel } from '../engine/drlg/preset';
import { ACT1_OVERWORLD, generateAct1World, type Act1World } from '../engine/drlg/act1';
import { townStartSubtile } from '../engine/drlg/layout';
import { LEVEL, ROOM, type DrlgData } from '../engine/drlg/types';
import { levelMonsterInfo, planSpawns } from '../engine/spawn';
import { nearestWalkable } from '../engine/path';
import { Rng } from '../engine/rng';
import type { GameData, LevelDef, LevelExit } from '../engine/game';
import { makeDrlgData, tilePath } from './drlg-data';
import type { AssetSource, GameTables } from './tables';

/** 엔진 레벨 id (게임·저장·HUD 에서 쓰는 문자열) ← levels.txt Id */
export const LEVEL_KEYS: Record<number, string> = {
  [LEVEL.ROGUEENCAMPMENT]: 'town',
  [LEVEL.BLOODMOOR]: 'bloodmoor',
  [LEVEL.COLDPLAINS]: 'coldplains',
  [LEVEL.STONYFIELD]: 'stonyfield',
  [LEVEL.DARKWOOD]: 'darkwood',
  [LEVEL.BLACKMARSH]: 'blackmarsh',
  [LEVEL.TAMOEHIGHLAND]: 'tamoe',
  [LEVEL.BURIALGROUNDS]: 'burialgrounds',
  [LEVEL.MONASTERYGATE]: 'monasterygate',
  [LEVEL.OUTERCLOISTER]: 'outercloister',
};

/** DRLG 에 필요한 excel 테이블 (브라우저 preload 용) */
export const ACT1_WORLD_TABLES = ['Levels', 'LvlPrest', 'LvlSub', 'LvlTypes', 'LvlWarp', 'Objects'];

// 출처: D2MOO DrlgRoomTile.cpp DRLGROOMTILE_LoadDT1FilesForRoom — 마스크와 무관하게 항상 로드하는 DT1
const ALWAYS_DT1 = ['Act1/Outdoors/Blank.dt1', 'Act1/Barracks/InvisWal.dt1', 'Act1/Barracks/Warp.dt1'];

/** LvlTypes 한 행의 DT1 경로 (비트 순서 유지: 빈 칸은 '') + 항상 로드 3 개 */
export function levelTypeDt1Paths(tables: GameTables, levelType: number): string[] {
  const row = tables.table('LvlTypes').find((r) => Number(r.Id) === levelType);
  const out: string[] = [];
  for (let i = 1; i <= 32; i++) {
    const f = row?.[`File ${i}`];
    out.push(f && f !== '0' ? tilePath(f) : '');
  }
  return [...out, ...ALWAYS_DT1.map(tilePath)];
}

/** 원작 DS1 (LvlPrest/LvlSub) 목록: Act 1 오버월드 생성이 읽을 수 있는 모든 파일 */
function act1Ds1Paths(tables: GameTables, data: DrlgData): string[] {
  const out = new Set<string>();
  const prestDefs = new Set<number>();
  // 출처: DrlgOutWild/DrlgOutPlace 가 쓰는 LvlPrest Def 범위 (Act 1 마을 ~ DOE 입구, 묘지, 특수 프리셋) + 오버월드 프리셋 레벨
  for (let d = 1; d <= 52; d++) prestDefs.add(d);
  for (const d of [108, 160, 161, 162, 163]) prestDefs.add(d);
  for (const id of ACT1_OVERWORLD) {
    const p = data.lvlPrestByLevel(id);
    if (p) prestDefs.add(p.def);
  }
  for (const d of prestDefs) {
    let r;
    try {
      r = data.lvlPrest(d);
    } catch {
      continue;
    }
    for (const f of r.file) if (f) out.add(tilePath(f));
  }
  for (const s of data.lvlSub) if (s.type >= 0 && s.type <= 6 && s.file) out.add(tilePath(s.file));
  void tables;
  return [...out];
}

/** 브라우저 preload 목록 (테이블은 ACT1_WORLD_TABLES 를 먼저 불러온 뒤 호출) */
export function act1WorldPaths(src: AssetSource, tables: GameTables): string[] {
  const data = makeDrlgData(src, tables);
  const set = new Set<string>(act1Ds1Paths(tables, data));
  const types = new Set<number>();
  for (const id of ACT1_OVERWORLD) types.add(data.level(id).levelType);
  for (const t of types) for (const p of levelTypeDt1Paths(tables, t)) if (p) set.add(p);
  return [...set];
}

export interface WorldLevel {
  key: string;
  id: number;
  name: string;
  preset: PresetLevel;
  def: LevelDef;
}

export interface Act1GameWorld {
  world: Act1World;
  levels: WorldLevel[];
  byKey: Map<string, WorldLevel>;
  /** 새 게임 시작 위치 (마을, 서브타일) */
  start: { x: number; y: number };
}

/**
 * Act 1 오버월드 → 엔진 LevelDef + 렌더용 PresetLevel.
 * @param seed 게임 시드 (원작 DRLG_AllocDrlg nInitSeed)
 */
export function buildAct1World(src: AssetSource, tables: GameTables, gameData: GameData, seed: number): Act1GameWorld {
  const data = makeDrlgData(src, tables);
  const world = generateAct1World(data, seed);
  const dt1Cache = new Map<string, Dt1Tile[]>();
  const loadDt1 = (p: string): Dt1Tile[] => {
    if (!p) return [];
    let t = dt1Cache.get(p);
    if (!t) {
      const b = src.read(p);
      t = b ? parseDt1(b) : [];
      dt1Cache.set(p, t);
    }
    return t;
  };
  const levels: WorldLevel[] = [];
  for (const lv of world.levels.values()) {
    const key = LEVEL_KEYS[lv.id] ?? `level${lv.id}`;
    const rec = data.level(lv.id);
    const dt1s = levelTypeDt1Paths(tables, rec.levelType).map(loadDt1);
    const preset = buildPresetLevel(lv.layout.ds1, dt1s, (seed ^ (lv.id * 0x9e3779b1)) >>> 0, { tileMask: lv.layout.tileMask, blockEmpty: true });
    const inTown = lv.id === LEVEL.ROGUEENCAMPMENT;
    let spawns: LevelDef['spawns'];
    if (!inTown) {
      // 출처: levels.txt 몬스터 풀 + 방 단위 배치 (spawn.ts). 원작처럼 몬스터 없는 방(POPULATION_ZERO: Populate=0 프리셋·이동 타일 방)은 제외
      const info = levelMonsterInfo(tables.table('Levels'), rec.levelName);
      const rooms = lv.layout.rooms.filter((r) => !(r.flags & ROOM.POPULATION_ZERO));
      spawns = planSpawns(info, rooms, preset.collision, gameData.monsters, new Rng((seed ^ (lv.id * 0x5bd1e995)) >>> 0));
    }
    levels.push({ key, id: lv.id, name: tables.string(rec.levelName) || rec.levelName, preset, def: { id: key, map: preset.collision, inTown, exits: [], spawns } });
  }
  const byKey = new Map(levels.map((l) => [l.key, l]));
  const byId = new Map(levels.map((l) => [l.id, l]));
  for (const e of world.exits) {
    const from = byId.get(e.from), to = byId.get(e.to);
    if (!from || !to) continue;
    const exit: LevelExit = { x: e.x, y: e.y, w: e.w, h: e.h, to: to.key, toX: e.toX, toY: e.toY };
    if (e.dx !== undefined) exit.dx = e.dx;
    if (e.dy !== undefined) exit.dy = e.dy;
    from.def.exits.push(exit);
  }
  // 근사(원작 미확인) — Step 2 전 임시 연결: 같은 던전(예: Underground Passage)으로 들어가는 입구가 두 오버월드 레벨에 있으면
  //   던전 생성 전까지 두 입구를 서로 직접 잇는다 (Stony Field ↔ Dark Wood). 도착 = 상대 입구 + LvlWarp ExitWalk 방향
  const entrances = [...world.levels.values()].flatMap((l) => l.entrances.map((e) => ({ level: l.id, e })));
  for (const a of entrances)
    for (const b of entrances) {
      if (a.level === b.level || a.e.toLevel !== b.e.toLevel) continue;
      const from = byId.get(a.level), to = byId.get(b.level);
      if (!from || !to) continue;
      const wb = data.lvlWarp.find((r) => r.id === b.e.warpId);
      from.def.exits.push({ x: a.e.x - 1, y: a.e.y - 1, w: 3, h: 3, to: to.key, toX: b.e.x + (wb?.exitWalkX ?? 3) * 2, toY: b.e.y + (wb?.exitWalkY ?? 3) * 2 });
    }
  const town = byId.get(LEVEL.ROGUEENCAMPMENT);
  if (!town) throw new Error('Act 1 world has no Rogue Encampment');
  const townLayout = world.levels.get(LEVEL.ROGUEENCAMPMENT)!.layout;
  const s = townStartSubtile(townLayout, new Rng((seed ^ 0x1) >>> 0)) ?? { x: Math.trunc(town.preset.collision.width / 2), y: Math.trunc(town.preset.collision.height / 2) };
  // 출처: DUNGEON_FindActSpawnLocationEx → COLLISION_GetFreeCoordinates (근사: 가장 가까운 걷기 가능 서브타일)
  const p = nearestWalkable(town.preset.collision, s, 20) ?? s;
  return { world, levels, byKey, start: { x: p.x + 0.5, y: p.y + 0.5 } };
}
