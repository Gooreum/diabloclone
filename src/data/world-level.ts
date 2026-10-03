// 막 DRLG 결과 → 엔진 LevelDef + 렌더용 PresetLevel 조립 (모든 막 공용).
// Act 1 (act1-world.ts buildAct1World) 에서 쓰던 조립 코드를 막 번호를 받도록 옮긴 것이다 — Act 1 결과는 그대로.
// 순수 알고리즘은 src/engine/drlg/*, 여기서는 원작 테이블·DS1/DT1 파일 접근과 LevelDef 구성만 한다.
import { parseDt1, type Dt1Tile } from '../formats/dt1';
import { buildPresetLevel, type PresetLevel } from '../engine/drlg/preset';
import type { DrlgWorld } from '../engine/drlg/acts';
import { townStartSubtile } from '../engine/drlg/layout';
import { LEVEL, ROOM, type DrlgData } from '../engine/drlg/types';
import { levelMonsterInfo, planLevel } from '../engine/spawn';
import { nearestWalkable } from '../engine/path';
import { Rng } from '../engine/rng';
import type { GameData, LevelDef, LevelExit } from '../engine/game';
import { tilePath } from './drlg-data';
import type { AssetSource, GameTables } from './tables';
import { AutomapTable } from '../engine/automap';
import { ACT2_LEVEL_KEYS } from './act2-keys';

/** 엔진 레벨 id (게임·저장·HUD 에서 쓰는 문자열) ← levels.txt Id. 표에 없는 레벨은 `level<Id>` */
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
  // Act 2~4 마을 (나머지 레벨 이름은 Phase 2~4 가 더한다)
  40: 'lutgholein',
  // Act 2 (act2-keys.ts)
  ...ACT2_LEVEL_KEYS,
  75: 'kurastdocks',
  // Act 3 (출처: levels.txt 76~102 LevelName)
  76: 'spiderforest', 77: 'greatmarsh', 78: 'flayerjungle', 79: 'lowerkurast', 80: 'kurastbazaar', 81: 'upperkurast', 82: 'kurastcauseway',
  83: 'travincal', 84: 'spidercave', 85: 'spidercavern', 86: 'swampypit1', 87: 'swampypit2', 88: 'flayerdungeon1', 89: 'flayerdungeon2',
  90: 'swampypit3', 91: 'flayerdungeon3', 92: 'kurastsewers1', 93: 'kurastsewers2', 94: 'ruinedtemple', 95: 'disusedfane',
  96: 'forgottenreliquary', 97: 'forgottentemple', 98: 'ruinedfane', 99: 'disusedreliquary', 100: 'durance1', 101: 'durance2', 102: 'durance3',
  103: 'pandemonium',
  // Act 4 (출처: levels.txt 104~108 LevelName)
  104: 'outersteppes',
  105: 'plainsofdespair',
  106: 'cityofthedamned',
  107: 'riverofflame',
  108: 'chaossanctuary',
  // 확장팩 Act 5 (출처: levels.txt 109~132 LevelName)
  109: 'harrogath', 110: 'bloodyfoothills', 111: 'frigidhighlands', 112: 'arreatplateau', 113: 'crystallinepassage', 114: 'frozenriver',
  115: 'glacialtrail', 116: 'driftercavern', 117: 'frozentundra', 118: 'ancientsway', 119: 'icycellar', 120: 'arreatsummit',
  121: 'nihlathakstemple', 122: 'hallsofanguish', 123: 'hallsofpain', 124: 'hallsofvaught', 125: 'abaddon', 126: 'pitofacheron',
  127: 'infernalpit', 128: 'worldstonekeep1', 129: 'worldstonekeep2', 130: 'worldstonekeep3', 131: 'throneofdestruction', 132: 'worldstonechamber',
};

/** levels.txt Id → 엔진 레벨 id (모든 막에서 겹치지 않는다) */
export function levelKey(id: number): string {
  return LEVEL_KEYS[id] ?? `level${id}`;
}

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
  /** AutoMap.txt LevelName (LvlTypes Id 고정 표 — "Act 5 - Ice Caves"(33) → "5 Ice") */
  automapName: string;
  /** levels.txt LevelWarp 문자열 ("To The Cold Plains") — 자동 지도 출구 표시 */
  warpLabel: string;
  preset: PresetLevel;
  def: LevelDef;
}

export interface AssembledWorld {
  levels: WorldLevel[];
  byKey: Map<string, WorldLevel>;
  byId: Map<number, WorldLevel>;
  /** 새 게임·막 도착 위치 (마을, 서브타일) */
  start: { x: number; y: number };
}

/**
 * 막 DRLG 결과 → 엔진 레벨.
 * @param act 막 번호 (0 = Act 1) — MonPreset·슈퍼유니크 막 (monsterInfo.act 는 원작처럼 1부터)
 * @param town 마을 레벨 (levels.txt Id) — 시작 위치
 */
export function assembleWorld(src: AssetSource, tables: GameTables, gameData: GameData, data: DrlgData, world: DrlgWorld, seed: number, act: number, town: number): AssembledWorld {
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
    const key = levelKey(lv.id);
    const rec = data.level(lv.id);
    const dt1s = levelTypeDt1Paths(tables, rec.levelType).map(loadDt1);
    const preset = buildPresetLevel(lv.layout.ds1, dt1s, (seed ^ (lv.id * 0x9e3779b1)) >>> 0, { tileMask: lv.layout.tileMask, blockEmpty: true });
    // 출처: DRLGROOMTILE_InitializeTileDataFlags — 바닥 bUnwalkable 타일은 통째로 막는다 (레이아웃이 표시한 경우만)
    const unw = lv.layout.unwalkable;
    if (unw) for (let i = 0; i < unw.length; i++) if (unw[i]) for (let k = 0; k < 25; k++) preset.collision.block((i % lv.layout.ds1.width) * 5 + (k % 5), Math.trunc(i / lv.layout.ds1.width) * 5 + Math.trunc(k / 5));
    const inTown = lv.id === town;
    let spawns: LevelDef['spawns'];
    let monsterPool: string[] | undefined;
    let monsterInfo: LevelDef['monsterInfo'];
    if (!inTown) {
      // 출처: levels.txt 몬스터 풀 + 방 단위 배치 (spawn.ts). 원작처럼 몬스터 없는 방(POPULATION_ZERO: Populate=0 프리셋·이동 타일 방)은 제외
      // 출처: sub_6FC66260 — 이동 지점·마을 포털 자리에서 levels.txt WarpDist(거리²) 안에는 놓지 않는다
      // 난이도: 월드를 만드는 GameData 의 몬스터 표 난이도 (withDifficulty) — MonDen·MonUMin/Max·nmon 목록
      const info = levelMonsterInfo(tables.table('Levels'), rec.levelName, gameData.monsters.difficulty ?? 0, gameData.expansion);
      const rooms = lv.layout.rooms.filter((r) => !(r.flags & ROOM.POPULATION_ZERO));
      const warpPts = lv.layout.warps.map((w) => ({ x: w.x, y: w.y }));
      const ti11 = lv.layout.tileInfo.find((t) => t.index === 11);
      if (ti11) warpPts.push({ x: ti11.x * 5, y: ti11.y * 5 });
      const exclude = (x: number, y: number) => warpPts.some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < info.warpDist);
      const plan = planLevel(info, rooms, preset.collision, gameData.monsters, new Rng((seed ^ (lv.id * 0x5bd1e995)) >>> 0), exclude);
      spawns = plan.requests;
      monsterPool = plan.region;
      monsterInfo = { pool: info.pool, region: plan.region, umon: info.umon, monLvlEx: info.monLvlEx, act: act + 1, warpDist: info.warpDist, warpPoints: warpPts };
    }
    // 프리셋 몬스터 (DS1 유닛 type 1: MonPreset 번호 — 슈퍼유니크·Andariel·Blood Raven·place_* 자리). 원작 bSpawned & 1 이면 배치 안 함
    // 마을 프리셋 (MonPreset Act 1: gheed·akara·kashya·warriv1·charsi·rogue1·chicken·cow) 은 NPC·장식 유닛, 하드코딩 프리셋 code(Flavie 'navi')도 포함
    const presetMonsters = lv.layout.units.filter((u) => u.type === 1 && (u.id >= 0 || !!u.code || !!u.mon) && !((u.flags ?? 0) & 1))
      .map((u) => ({ id: u.id, x: u.x, y: u.y, ...(u.path ? { path: u.path } : {}), ...(u.code ? { code: u.code } : {}), ...(u.mon ? { mon: u.mon } : {}) }));
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
    // LvlPrest AutoMap=1 (마을 5곳) → 자동 지도 전부 드러냄. 출처: DRLGPRESET — pfAutomap 을 모든 방에 (1·3막) / pfTownAutomap 그림 (2·4·5막)
    if (tables.table('LvlPrest').some((r) => Number(r.LevelId) === lv.id && Number(r.AutoMap) === 1)) def.automapAll = true;
    const warpKey = tables.table('Levels').find((r) => Number(r.Id) === lv.id)?.LevelWarp ?? '';
    levels.push({
      key, id: lv.id, name: tables.string(rec.levelName) || rec.levelName, automapName: AutomapTable.levelName(rec.levelType), warpLabel: warpKey ? tables.string(warpKey) : '', preset, def,
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
      // 같은 레벨로 가는 vis 칸이 여럿이면 (Lut Gholein ↔ 하수도 두 입구, 할렘 ↔ 할렘 2 두 계단) vis 순서가 같은 짝끼리 잇는다
      // 근사(원작 미확인): 원작은 방 타일끼리 연결 (DRLGWARP_GetDestinationRoom). vis 가 하나면 이전과 같다
      const visOf = (ws: typeof lv.layout.warps, to: number) => [...new Set(ws.filter((b) => b.toLevel === to).map((b) => b.visIndex))].sort((a, b) => a - b);
      const backVis = visOf(dst.layout.warps, lv.id)[visOf(lv.layout.warps, w.toLevel).indexOf(w.visIndex)];
      const back = dst.layout.warps.find((b) => b.toLevel === lv.id && (backVis === undefined || b.visIndex === backVis));
      if (!back) continue;
      const rec = data.lvlWarp.find((r) => r.id === w.warpId), brec = data.lvlWarp.find((r) => r.id === back.warpId);
      const exit: LevelExit = { ...warpRect(from.def.map, w.x, w.y), to: to.key, toX: back.x + (brec?.exitWalkX ?? 0), toY: back.y + (brec?.exitWalkY ?? 0) };
      if (rec) exit.warp = { x: w.x, y: w.y, selectX: rec.selectX, selectY: rec.selectY, selectDX: rec.selectDX, selectDY: rec.selectDY };
      from.def.exits.push(exit);
    }
  }
  const townLv = byId.get(town);
  if (!townLv) throw new Error(`Act ${act + 1} world has no town (level ${town})`);
  const townLayout = world.levels.get(town)!.layout;
  const s = townStartSubtile(townLayout, new Rng((seed ^ 0x1) >>> 0)) ?? { x: Math.trunc(townLv.preset.collision.width / 2), y: Math.trunc(townLv.preset.collision.height / 2) };
  // 출처: DUNGEON_FindActSpawnLocationEx → COLLISION_GetFreeCoordinates (근사: 가장 가까운 걷기 가능 서브타일)
  const p = nearestWalkable(townLv.preset.collision, s, 20) ?? s;
  return { levels, byKey, byId, start: { x: p.x + 0.5, y: p.y + 0.5 } };
}
