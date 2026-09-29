// Act 1 월드 (마을 + 야외 전 지역 + 수도원 + 모든 던전·트리스트럼): 원작 DRLG 이식 결과를 엔진 레벨로 조립.
// 순수 알고리즘은 src/engine/drlg/* (act1.ts), 여기서는 원작 테이블·DS1/DT1 파일 접근과 LevelDef 구성만 한다.
import { parseDt1, type Dt1Tile } from '../formats/dt1';
import { buildPresetLevel, type PresetLevel } from '../engine/drlg/preset';
import { ACT1_ALL, generateAct1World, type Act1World } from '../engine/drlg/act1';
import { townStartSubtile } from '../engine/drlg/layout';
import { LEVEL, PREST, ROOM, type DrlgData } from '../engine/drlg/types';
import { levelMonsterInfo, planLevel } from '../engine/spawn';
import { nearestWalkable } from '../engine/path';
import { Rng } from '../engine/rng';
import type { GameData, LevelDef, LevelExit } from '../engine/game';
import { makeDrlgData, tilePath } from './drlg-data';
import type { AssetSource, GameTables } from './tables';
import { AutomapTable } from '../engine/automap';

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
  [LEVEL.DENOFEVIL]: 'denofevil',
  [LEVEL.CAVELEV1]: 'cave1',
  [LEVEL.CAVELEV2]: 'cave2',
  [LEVEL.UNDERGROUNDPASSAGELEV1]: 'passage1',
  [LEVEL.UNDERGROUNDPASSAGELEV2]: 'passage2',
  [LEVEL.HOLELEV1]: 'hole1',
  [LEVEL.HOLELEV2]: 'hole2',
  [LEVEL.PITLEV1]: 'pit1',
  [LEVEL.PITLEV2]: 'pit2',
  [LEVEL.CRYPT]: 'crypt',
  [LEVEL.MAUSOLEUM]: 'mausoleum',
  [LEVEL.FORGOTTENTOWER]: 'tower',
  [LEVEL.TOWERCELLARLEV1]: 'towercellar1',
  [LEVEL.TOWERCELLARLEV2]: 'towercellar2',
  [LEVEL.TOWERCELLARLEV3]: 'towercellar3',
  [LEVEL.TOWERCELLARLEV4]: 'towercellar4',
  [LEVEL.TOWERCELLARLEV5]: 'towercellar5',
  [LEVEL.BARRACKS]: 'barracks',
  [LEVEL.JAILLEV1]: 'jail1',
  [LEVEL.JAILLEV2]: 'jail2',
  [LEVEL.JAILLEV3]: 'jail3',
  [LEVEL.INNERCLOISTER]: 'innercloister',
  [LEVEL.CATHEDRAL]: 'cathedral',
  [LEVEL.CATACOMBSLEV1]: 'catacombs1',
  [LEVEL.CATACOMBSLEV2]: 'catacombs2',
  [LEVEL.CATACOMBSLEV3]: 'catacombs3',
  [LEVEL.CATACOMBSLEV4]: 'catacombs4',
  [LEVEL.TRISTRAM]: 'tristram',
};

/** DRLG 에 필요한 excel 테이블 (브라우저 preload 용) */
export const ACT1_WORLD_TABLES = ['Levels', 'LvlPrest', 'LvlSub', 'LvlTypes', 'LvlWarp', 'LvlMaze', 'Objects'];

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

/** 원작 DS1 (LvlPrest/LvlSub) 목록: Act 1 월드(오버월드 + 던전) 생성이 읽을 수 있는 모든 파일 */
function act1Ds1Paths(tables: GameTables, data: DrlgData): string[] {
  const out = new Set<string>();
  const prestDefs = new Set<number>();
  // 출처: LevelsIds.h D2C_LvlPrestIds — Act 1 행 (Def 1 마을 ~ 300 트리스트럼): 야외 프리셋·미로 방 프리셋·던전 프리셋 레벨
  for (let d = 1; d <= PREST.TRISTRAM; d++) prestDefs.add(d);
  for (const id of ACT1_ALL) {
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
  for (const id of ACT1_ALL) types.add(data.level(id).levelType);
  for (const t of types) for (const p of levelTypeDt1Paths(tables, t)) if (p) set.add(p);
  return [...set];
}

/** 이동 지점 둘레 3×3 서브타일 (걷기 가능한 칸이 없으면 5×5, 7×7 로 넓힌다 — 근사(원작 미확인)) */
function warpRect(map: LevelDef['map'], x: number, y: number): { x: number; y: number; w: number; h: number } {
  for (let r = 1; r <= 4; r++) {
    for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) if (map.walkable(i, j)) return { x: x - r, y: y - r, w: 2 * r + 1, h: 2 * r + 1 };
  }
  return { x: x - 1, y: y - 1, w: 3, h: 3 };
}

export interface WorldLevel {
  key: string;
  id: number;
  name: string;
  /** AutoMap.txt LevelName (LvlTypes 이름 "Act 1 - Wilderness" → "1 Wilderness") */
  automapName: string;
  /** levels.txt LevelWarp 문자열 ("To The Cold Plains") — 자동 지도 출구 표시 */
  warpLabel: string;
  preset: PresetLevel;
  def: LevelDef;
}

export interface Act1GameWorld {
  world: Act1World;
  levels: WorldLevel[];
  byKey: Map<string, WorldLevel>;
  /** 새 게임 시작 위치 (마을, 서브타일) */
  start: { x: number; y: number };
  /** 트리스트럼 도착 위치 (디버그·테스트용 진입 경로; 게임 안 포털은 Phase 10) */
  tristram: { x: number; y: number } | null;
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
    let monsterPool: string[] | undefined;
    let monsterInfo: LevelDef['monsterInfo'];
    if (!inTown) {
      // 출처: levels.txt 몬스터 풀 + 방 단위 배치 (spawn.ts). 원작처럼 몬스터 없는 방(POPULATION_ZERO: Populate=0 프리셋·이동 타일 방)은 제외
      // 출처: sub_6FC66260 — 이동 지점·마을 포털 자리에서 levels.txt WarpDist(거리²) 안에는 놓지 않는다
      const info = levelMonsterInfo(tables.table('Levels'), rec.levelName);
      const rooms = lv.layout.rooms.filter((r) => !(r.flags & ROOM.POPULATION_ZERO));
      const warpPts = lv.layout.warps.map((w) => ({ x: w.x, y: w.y }));
      const ti11 = lv.layout.tileInfo.find((t) => t.index === 11);
      if (ti11) warpPts.push({ x: ti11.x * 5, y: ti11.y * 5 });
      const exclude = (x: number, y: number) => warpPts.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < info.warpDist);
      const plan = planLevel(info, rooms, preset.collision, gameData.monsters, new Rng((seed ^ (lv.id * 0x5bd1e995)) >>> 0), exclude);
      spawns = plan.requests;
      monsterPool = plan.region;
      monsterInfo = { pool: info.pool, region: plan.region, umon: info.umon, monLvlEx: info.monLvlEx, act: 1, warpDist: info.warpDist, warpPoints: warpPts };
    }
    // 프리셋 몬스터 (DS1 유닛 type 1: MonPreset 번호 — 슈퍼유니크·Andariel·Blood Raven·place_* 자리). 원작 bSpawned & 1 이면 배치 안 함
    // 마을 프리셋 (MonPreset Act 1: gheed·akara·kashya·warriv1·charsi·rogue1·chicken·cow) 은 NPC·장식 유닛, 하드코딩 프리셋 code(Flavie 'navi')도 포함
    const presetMonsters = lv.layout.units.filter((u) => u.type === 1 && (u.id >= 0 || !!u.code) && !((u.flags ?? 0) & 1))
      .map((u) => ({ id: u.id, x: u.x, y: u.y, ...(u.path ? { path: u.path } : {}), ...(u.code ? { code: u.code } : {}) }));
    // 오브젝트: DS1 프리셋 유닛(type 2 = 오브젝트, 번호는 DRLGPRESET_ParseDS1File 에서 objects.txt 번호로 변환됨)과 방 목록 (오브젝트 그룹 배치)
    // 출처: Objects.cpp OBJECTS_PopulationHandler — 웨이포인트 방(DUNGEON_HasWaypoint)은 배치 안 함
    const objects = lv.layout.units.filter((u) => u.type === 2).map((u) => ({ classId: u.id, x: u.x, y: u.y }));
    const popRooms = lv.layout.rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, hasWaypoint: (r.flags & ROOM.WAYPOINT_MASK) !== 0, noPopulate: (r.flags & ROOM.POPULATION_ZERO) !== 0 }));
    const def: LevelDef = { id: key, map: preset.collision, inTown, exits: [], spawns, levelNo: lv.id, objects, rooms: popRooms, presetMonsters };
    if (monsterPool) def.monsterPool = monsterPool;
    if (monsterInfo) def.monsterInfo = monsterInfo;
    // 마을 포털 자리: 원작 D2GAME_CreateLinkPortal → DUNGEON_FindActSpawnLocationEx(…, 11, …) = 타일 정보 11 (+ 서브타일 3, sub_6FD788D0 규칙)
    const ti = lv.layout.tileInfo.find((t) => t.index === 11);
    if (ti) def.portalSpot = { x: ti.x * 5 + 3, y: ti.y * 5 + 3 };
    const lvlTypeName = tables.table('LvlTypes').find((r) => Number(r.Id) === rec.levelType)?.Name ?? '';
    const warpKey = tables.table('Levels').find((r) => Number(r.Id) === lv.id)?.LevelWarp ?? '';
    levels.push({
      key, id: lv.id, name: tables.string(rec.levelName) || rec.levelName, automapName: AutomapTable.levelName(lvlTypeName), warpLabel: warpKey ? tables.string(warpKey) : '', preset, def,
    });
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
  // 레벨 이동 타일 (동굴 입구·계단·탑 문) → 출구. 도착 = 상대 레벨에서 이쪽으로 오는 이동 지점 + 그 LvlWarp ExitWalkX/Y.
  // 출처: DRLGROOMTILE_AddWarp (이동 지점 = 타일×5 + LvlWarp OffsetX/Y), DRLGWARP_GetDestinationRoom (상대 레벨에서 출발 레벨로 가는 이동 타일)
  // 근사(원작 미확인): 원작 D2Game 은 이동 지점 유닛을 클릭해야 넘어간다. 여기서는 이동 지점 둘레 3×3 서브타일에 들어서거나
  //   LvlWarp SelectX/Y/DX/DY 화면 상자를 클릭하면 넘어간다. 도착 위치의 ExitWalk 걷기는 순간 배치로 대신한다.
  for (const lv of world.levels.values()) {
    const from = byId.get(lv.id);
    if (!from) continue;
    for (const w of lv.layout.warps) {
      const to = byId.get(w.toLevel), dst = world.levels.get(w.toLevel);
      if (!to || !dst) continue;
      const back = dst.layout.warps.find((b) => b.toLevel === lv.id);
      if (!back) continue;
      const rec = data.lvlWarp.find((r) => r.id === w.warpId), brec = data.lvlWarp.find((r) => r.id === back.warpId);
      const exit: LevelExit = { ...warpRect(from.def.map, w.x, w.y), to: to.key, toX: back.x + (brec?.exitWalkX ?? 0), toY: back.y + (brec?.exitWalkY ?? 0) };
      if (rec) exit.warp = { x: w.x, y: w.y, selectX: rec.selectX, selectY: rec.selectY, selectDX: rec.selectDX, selectDY: rec.selectDY };
      from.def.exits.push(exit);
    }
  }
  const town = byId.get(LEVEL.ROGUEENCAMPMENT);
  if (!town) throw new Error('Act 1 world has no Rogue Encampment');
  const townLayout = world.levels.get(LEVEL.ROGUEENCAMPMENT)!.layout;
  const s = townStartSubtile(townLayout, new Rng((seed ^ 0x1) >>> 0)) ?? { x: Math.trunc(town.preset.collision.width / 2), y: Math.trunc(town.preset.collision.height / 2) };
  // 출처: DUNGEON_FindActSpawnLocationEx → COLLISION_GetFreeCoordinates (근사: 가장 가까운 걷기 가능 서브타일)
  const p = nearestWalkable(town.preset.collision, s, 20) ?? s;
  // 트리스트럼 도착 위치 (levels.txt Position=1: 마을과 같은 타일 정보 규칙). 포털은 Phase 10 퀘스트 단계
  let tristram: { x: number; y: number } | null = null;
  const tri = byId.get(LEVEL.TRISTRAM), triLayout = world.levels.get(LEVEL.TRISTRAM)?.layout;
  if (tri && triLayout) {
    const t = townStartSubtile(triLayout, new Rng((seed ^ 0x26) >>> 0)) ?? { x: Math.trunc(tri.preset.collision.width / 2), y: Math.trunc(tri.preset.collision.height / 2) };
    const q = nearestWalkable(tri.preset.collision, t, 30) ?? t;
    tristram = { x: q.x + 0.5, y: q.y + 0.5 };
  }
  return { world, levels, byKey, start: { x: p.x + 0.5, y: p.y + 0.5 }, tristram };
}
