// Act 1 던전 DRLG (미로 DrlgType 1 + 던전 프리셋) 이식 검증.
// 기대값은 원작 데이터 테이블(levels.txt / LvlMaze.txt / LvlPrest.txt / LvlWarp.txt)과 D2MOO DrlgMaze.cpp 규칙에서 유도.
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { makeDrlgData } from '../../src/data/drlg-data';
import { ACT1_WORLD_TABLES, act1WorldPaths, buildAct1World, levelTypeDt1Paths, type Act1GameWorld } from '../../src/data/act1-world';
import { placeAct1, notOverlapping } from '../../src/engine/drlg/act1-link';
import { ACT1_DUNGEONS } from '../../src/engine/drlg/act1';
import { generateMazeLevel, mazeBasePreset } from '../../src/engine/drlg/maze';
import { DRLGTYPE, LEVEL, LVLTYPE, PREST, type DrlgData } from '../../src/engine/drlg/types';
import { nearestWalkable } from '../../src/engine/path';
import { Game, type GameData, type LevelDef } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { parseDt1 } from '../../src/formats/dt1';

/** levels.txt DrlgType = 1 인 Act 1 레벨 */
const MAZES = [8, 9, 10, 11, 12, 18, 19, 21, 22, 23, 24, 28, 29, 30, 31, 34, 35, 36];

function reachable(def: LevelDef, from: { x: number; y: number }): Uint8Array {
  const m = def.map;
  const seen = new Uint8Array(m.width * m.height);
  const s = nearestWalkable(m, from, 12);
  if (!s) return seen;
  const q = [s.y * m.width + s.x];
  seen[q[0]!] = 1;
  while (q.length) {
    const k = q.pop()!;
    const x = k % m.width, y = Math.floor(k / m.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy, nk = ny * m.width + nx;
      if (m.walkable(nx, ny) && !seen[nk]) { seen[nk] = 1; q.push(nk); }
    }
  }
  return seen;
}

/** 출구 사각형 안의 도달 가능한 서브타일 */
function exitHit(def: LevelDef, seen: Uint8Array, e: LevelDef['exits'][number]): { x: number; y: number } | null {
  const m = def.map;
  for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (m.walkable(x, y) && seen[y * m.width + x]) return { x, y };
  return null;
}

/** 마을에서 출구를 따라가는 BFS. 반환: 레벨 key → 처음 도착한 지점, 그리고 지나간 (from → to) 간선 */
function explore(world: Act1GameWorld): { arrival: Map<string, { x: number; y: number }>; edges: Set<string> } {
  const arrival = new Map<string, { x: number; y: number }>([['town', world.start]]);
  const edges = new Set<string>();
  const queue = ['town'];
  while (queue.length) {
    const key = queue.shift()!;
    const lv = world.byKey.get(key)!;
    const seen = reachable(lv.def, arrival.get(key)!);
    for (const e of lv.def.exits) {
      const hit = exitHit(lv.def, seen, e);
      if (!hit) continue;
      edges.add(`${key}>${e.to}`);
      if (arrival.has(e.to)) continue;
      const target = world.byKey.get(e.to)!;
      const tx = e.dx !== undefined ? hit.x + 0.5 + e.dx : e.toX, ty = e.dy !== undefined ? hit.y + 0.5 + e.dy : e.toY;
      const spot = nearestWalkable(target.def.map, { x: tx, y: ty }, 12);
      if (!spot) continue;
      arrival.set(e.to, { x: spot.x + 0.5, y: spot.y + 0.5 });
      queue.push(e.to);
    }
  }
  return { arrival, edges };
}

describe.skipIf(!hasGameData)('Act 1 던전 DRLG (원작 데이터)', () => {
  let tables: GameTables, gameData: GameData, data: DrlgData, world: Act1GameWorld;
  const SEED = 1234;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    gameData = buildGameData(gameChain(), tables);
    data = makeDrlgData(gameChain(), tables);
    world = buildAct1World(gameChain(), tables, gameData, SEED);
  }, 120_000);

  // 출처: LevelsIds.h D2C_LvlPrestIds ↔ LvlPrest.txt Def (미로 방 기준 Def + 방향 비트 W1 E2 S4 N8)
  it('미로 프리셋 Def 상수가 LvlPrest.txt 이름과 일치', () => {
    const name = (d: number) => data.lvlPrest(d).name;
    expect(name(PREST.DOE_ENTRANCE + 1)).toBe('Act 1 - Cave W');
    expect(name(PREST.DOE_ENTRANCE + 8)).toBe('Act 1 - Cave N');
    expect(name(PREST.DOE_ENTRANCE + 15)).toBe('Act 1 - Cave NSEW');
    expect(name(PREST.DOE_ENTRANCE + 1 + 15)).toBe('Act 1 - Cave Theme W');
    expect(name(PREST.CAVE_PREV_W)).toBe('Act 1 - Cave Prev W');
    expect(name(PREST.CAVE_NEXT_W + 3)).toBe('Act 1 - Cave Next N');
    expect(name(PREST.CAVE_DOWN_W)).toBe('Act 1 - Cave Down W');
    expect(name(PREST.CAVE_DEN_OF_EVIL_W)).toBe('Act 1 - Cave Den Of Evil W');
    expect(name(PREST.CAVE_COLDCROW_W)).toBe('Act 1 - Cave Coldcrow W');
    expect(name(PREST.GRAVEYARD + 1)).toBe('Act 1 - Crypt W');
    expect(name(PREST.CRYPT_PREV_W)).toBe('Act 1 - Crypt Prev W');
    expect(name(PREST.CRYPT_NEXT_W)).toBe('Act 1 - Crypt Next W');
    expect(name(PREST.CRYPT_BONEBREAK_W)).toBe('Act 1 - Crypt Bonebreak W');
    expect(name(PREST.CRYPT_CHEST_W)).toBe('Act 1 - Crypt Chest W');
    expect(name(PREST.CRYPT_PORTAL_W)).toBe('Act 1 - Crypt Portal W');
    expect(name(PREST.BARRACKS_COURT_CONNECT)).toBe('Act 1 - Barracks Court Connect');
    expect(name(PREST.BARRACKS_COURT_CONNECT + 1)).toBe('Act 1 - Barracks W');
    expect(name(PREST.BARRACKS_NEXT_W)).toBe('Act 1 - Barracks Next W');
    expect(name(PREST.BARRACKS_FORGE_W)).toBe('Act 1 - Barracks Forge W');
    expect(name(PREST.BARRACKS_FORGE_N)).toBe('Act 1 - Barracks Forge N');
    expect(name(PREST.BARRACKS_FORGE_N + 1)).toBe('Act 1 - Jail W');
    expect(name(PREST.JAIL_PREV_W)).toBe('Act 1 - Jail Prev W');
    expect(name(PREST.JAIL_NEXT_W)).toBe('Act 1 - Jail Next W');
    expect(name(PREST.JAIL_CATH_W)).toBe('Act 1 - Jail Cath W');
    expect(name(PREST.JAIL_WAYPOINT_W)).toBe('Act 1 - Jail Waypoint W');
    expect(name(PREST.JAIL_PITSPAWN_W)).toBe('Act 1 - Jail Pitspawn W');
    expect(name(PREST.CATHEDRAL)).toBe('Act 1 - Cathedral');
    expect(name(PREST.CATHEDRAL + 1)).toBe('Act 1 - Catacombs W');
    expect(name(PREST.CATACOMBS_PREV_EW)).toBe('Act 1 - Catacombs Prev EW');
    expect(name(PREST.CATACOMBS_PREV_NS)).toBe('Act 1 - Catacombs Prev NS');
    expect(name(PREST.CATACOMBS_PREV_NSEW)).toBe('Act 1 - Catacombs Prev NSEW');
    expect(name(PREST.CATACOMBS_NEXT_W)).toBe('Act 1 - Catacombs Next W');
    expect(name(PREST.CATACOMBS_WAYPOINT_W)).toBe('Act 1 - Catacombs Waypoint W');
    expect(name(PREST.TRISTRAM)).toBe('Act 1 - Tristram');
  });

  // 출처: levels.txt DrlgType/LevelType (LevelsIds.h D2C_LvlTypes: 3 Cave, 4 Crypt, 7 Barracks, 8 Jail, 10 Catacombs)
  it('미로 레벨 목록과 종류가 levels.txt 와 일치', () => {
    for (const id of ACT1_DUNGEONS) {
      const rec = data.level(id);
      expect(rec.drlgType === DRLGTYPE.MAZE, rec.levelName).toBe(MAZES.includes(id));
      if (rec.drlgType === DRLGTYPE.MAZE) {
        expect([LVLTYPE.ACT1_CAVE, LVLTYPE.ACT1_CRYPT, LVLTYPE.ACT1_BARRACKS, LVLTYPE.ACT1_JAIL, LVLTYPE.ACT1_CATACOMBS]).toContain(rec.levelType);
        expect(data.lvlMaze(id).levelId).toBe(id);
      }
    }
    expect(data.lvlMaze(LEVEL.DENOFEVIL)).toMatchObject({ rooms: 1, sizeX: 24, sizeY: 24, merge: 500 });
    expect(data.lvlMaze(LEVEL.CRYPT)).toMatchObject({ rooms: 12, sizeX: 8, sizeY: 8 });
    expect(data.lvlMaze(LEVEL.BARRACKS)).toMatchObject({ rooms: 10, sizeX: 10, sizeY: 14 });
  });

  it('같은 시드 → 같은 미로 (방 위치·프리셋·파일·타일), 다른 시드 → 다른 미로', () => {
    const w2 = buildAct1World(gameChain(), tables, gameData, SEED);
    for (const id of ACT1_DUNGEONS) {
      const a = world.world.levels.get(id)!, b = w2.world.levels.get(id)!;
      expect(b.box).toEqual(a.box);
      expect((b.layout as { mazeRooms?: unknown }).mazeRooms).toEqual((a.layout as { mazeRooms?: unknown }).mazeRooms);
      const key = world.levels.find((l) => l.id === id)!.key;
      expect(w2.byKey.get(key)!.preset.walls.map((t) => t.tileIndex)).toEqual(world.byKey.get(key)!.preset.walls.map((t) => t.tileIndex));
    }
    for (const id of MAZES) {
      const shapes = new Set<string>();
      // 연속된 작은 시드는 원작 LCG 하위 비트가 비슷해 Den of Evil(3 방) 모양이 같게 나오므로 떨어진 시드를 쓴다
      for (const s of [1, 12, 1000, 55555, 987654321, 0x7fffffff]) shapes.add(JSON.stringify(generateMazeLevel(data, placeAct1(data, s), id).mazeRooms));
      expect(shapes.size, data.level(id).levelName).toBeGreaterThan(1);
    }
  });

  // 출처: DRLGMAZE_GenerateLevel — 방 수가 LvlMaze Rooms 가 될 때까지 붙인 뒤 특수 방(ScanReplaceSpecialPreset,
  //       Barracks 는 Court Connect·Next·Forge) 은 기존 방을 바꾸거나 새로 하나씩 붙인다. 방 크기 = LvlMaze SizeX×SizeY
  it('방 수·크기가 LvlMaze Rooms/SizeX/SizeY 규칙 안이고 방끼리 겹치지 않는다', () => {
    // 레벨별 특수 방 최대 추가 수 (ScanReplaceSpecialPreset 호출 수)
    const extra: Record<number, number> = { 8: 2, 9: 3, 10: 3, 11: 2, 12: 2, 18: 2, 19: 2, 21: 2, 22: 2, 23: 2, 24: 2, 28: 3, 29: 3, 30: 3, 31: 2, 34: 1, 35: 2, 36: 1 };
    for (const s of [SEED, 7, 99, 31337]) {
      const p = placeAct1(data, s);
      for (const id of MAZES) {
        const m = data.lvlMaze(id);
        const lv = generateMazeLevel(data, p, id);
        const n = lv.mazeRooms.length;
        expect(n, `${data.level(id).levelName} seed ${s}`).toBeGreaterThanOrEqual(m.rooms);
        expect(n, `${data.level(id).levelName} seed ${s}`).toBeLessThanOrEqual(m.rooms + (extra[id] ?? 0));
        for (const r of lv.mazeRooms) {
          expect([r.box.w, r.box.h]).toEqual([m.sizeX, m.sizeY]);
          // 방 프리셋은 그 레벨 종류의 Def 범위 (기준 + 1 … 특수 방까지)
          expect(r.prest).toBeGreaterThan(mazeBasePreset(data.level(id).levelType) - (id === LEVEL.BARRACKS ? 1 : 0));
        }
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(notOverlapping(lv.mazeRooms[i]!.box, lv.mazeRooms[j]!.box, 0)).toBe(true);
        // 레벨 크기는 levels.txt SizeX/SizeY 안 (DRLG_UpdateRoomExCoordinates 의 검사)
        const rec = data.level(id);
        if (id !== LEVEL.BARRACKS) expect(lv.box.w - 1).toBeLessThanOrEqual(rec.sizeX);
        if (id !== LEVEL.BARRACKS) expect(lv.box.h - 1).toBeLessThanOrEqual(rec.sizeY);
      }
    }
  });

  // 출처: DrlgMaze.cpp nAct1Cave*Ids 등 — 레벨마다 들어가야 하는 특수 방
  it('레벨마다 원작 특수 방(이전/다음 층·보스·웨이포인트)이 정확히 하나씩', () => {
    const p = placeAct1(data, SEED);
    const has = (id: number, first: number) => generateMazeLevel(data, p, id).mazeRooms.filter((r) => r.prest >= first && r.prest < first + 4).length;
    expect(has(LEVEL.DENOFEVIL, PREST.CAVE_PREV_W)).toBe(1);
    expect(has(LEVEL.DENOFEVIL, PREST.CAVE_DEN_OF_EVIL_W)).toBe(1);
    expect(has(LEVEL.CAVELEV1, PREST.CAVE_DOWN_W)).toBe(1);
    expect(has(LEVEL.CAVELEV1, PREST.CAVE_COLDCROW_W)).toBe(1);
    expect(has(LEVEL.UNDERGROUNDPASSAGELEV1, PREST.CAVE_NEXT_W)).toBe(1);
    expect(has(LEVEL.CRYPT, PREST.CRYPT_BONEBREAK_W)).toBe(1);
    expect(has(LEVEL.MAUSOLEUM, PREST.CRYPT_CHEST_W)).toBe(1);
    for (const id of [21, 22, 23, 24]) expect(has(id, PREST.CRYPT_NEXT_W)).toBe(1);
    expect(has(LEVEL.JAILLEV1, PREST.JAIL_WAYPOINT_W)).toBe(1);
    expect(has(LEVEL.JAILLEV2, PREST.JAIL_PITSPAWN_W)).toBe(1);
    expect(has(LEVEL.JAILLEV3, PREST.JAIL_CATH_W)).toBe(1);
    expect(has(LEVEL.CATACOMBSLEV2, PREST.CATACOMBS_WAYPOINT_W)).toBe(1);
    expect(has(LEVEL.BARRACKS, PREST.BARRACKS_NEXT_W)).toBe(1);
    expect(has(LEVEL.BARRACKS, PREST.BARRACKS_FORGE_W)).toBe(1);
    expect(generateMazeLevel(data, p, LEVEL.BARRACKS).mazeRooms.filter((r) => r.prest === PREST.BARRACKS_COURT_CONNECT)).toHaveLength(1);
  });

  // 출처: DRLGROOMTILE_LoadDT1FilesForRoom — 방 DT1 마스크(LvlPrest Dt1Mask) 비트 = LvlTypes File N
  it('모든 던전 타일이 그 레벨 LvlTypes DT1 (방 DT1 마스크 안) 에서 발견된다 — 여러 시드', () => {
    const worlds = [world, buildAct1World(gameChain(), tables, gameData, 4321)];
    for (const w of worlds)
      for (const l of w.levels) {
        if (!ACT1_DUNGEONS.includes(l.id)) continue;
        expect(l.preset.missing, l.key).toBe(0);
        expect(l.preset.maskFallback, l.key).toBe(0);
        expect(l.preset.floors.length, l.key).toBeGreaterThan(0);
        expect(l.preset.walls.length, l.key).toBeGreaterThan(0);
      }
    for (const t of [LVLTYPE.ACT1_CAVE, LVLTYPE.ACT1_CRYPT, LVLTYPE.ACT1_BARRACKS, LVLTYPE.ACT1_JAIL, LVLTYPE.ACT1_CATHEDRAL, LVLTYPE.ACT1_CATACOMBS, LVLTYPE.ACT1_TRISTRAM]) {
      const dt1 = levelTypeDt1Paths(tables, t).filter((p) => p && gameChain().read(p)).map((p) => parseDt1(gameChain().read(p)!));
      expect(dt1.length).toBeGreaterThan(0);
    }
  });

  it('브라우저 preload 목록(act1WorldPaths)이 던전 DS1/DT1 을 모두 담고 전부 MPQ 에서 읽힌다', () => {
    expect(ACT1_WORLD_TABLES).toContain('LvlMaze');
    const paths = act1WorldPaths(gameChain(), tables);
    for (const p of paths) expect(gameChain().read(p), p).toBeTruthy();
    const set = new Set(paths.map((p) => p.toLowerCase()));
    for (const f of ['act1\\caves\\cavewpre1.ds1', 'act1\\crypt\\cryptwwarpprev.ds1', 'act1\\barracks\\courtwb.ds1', 'act1\\catacomb\\andy3.ds1', 'act1\\tristram\\tri_town4.ds1', 'act1\\caves\\cave.dt1', 'act1\\catacomb\\floor.dt1', 'act1\\tristram\\town.dt1'])
      expect(set.has(`data\\global\\tiles\\${f}`), f).toBe(true);
  });

  // 출처: levels.txt Vis/Warp — 모든 던전 체인이 마을에서 이어진다 (야외 입구 → 미로 → 다음 층 / 보물 방)
  it('BFS: 마을에서 카타콤 4 까지, 모든 던전 체인을 거쳐 도달 (Stony Field → Underground Passage 1 → 2 → Dark Wood 포함)', () => {
    const { arrival, edges } = explore(world);
    const all = world.levels.map((l) => l.key).filter((k) => k !== 'tristram');
    for (const k of all) expect(arrival.has(k), k).toBe(true);
    for (const e of [
      'bloodmoor>denofevil', 'denofevil>bloodmoor', 'coldplains>cave1', 'cave1>cave2', 'cave2>cave1',
      'stonyfield>passage1', 'passage1>stonyfield', 'passage1>passage2', 'passage2>passage1', 'passage1>darkwood', 'darkwood>passage1',
      'blackmarsh>hole1', 'hole1>hole2', 'blackmarsh>tower', 'tower>towercellar1', 'towercellar1>towercellar2', 'towercellar2>towercellar3',
      'towercellar3>towercellar4', 'towercellar4>towercellar5', 'towercellar5>towercellar4', 'tamoe>pit1', 'pit1>pit2',
      'burialgrounds>crypt', 'crypt>burialgrounds', 'burialgrounds>mausoleum', 'mausoleum>burialgrounds',
      'outercloister>barracks', 'barracks>outercloister', 'barracks>jail1', 'jail1>barracks', 'jail1>jail2', 'jail2>jail3', 'jail3>innercloister',
      'innercloister>jail3', 'innercloister>cathedral', 'cathedral>innercloister', 'cathedral>catacombs1', 'catacombs1>catacombs2',
      'catacombs2>catacombs3', 'catacombs3>catacombs4', 'catacombs4>catacombs3',
    ]) expect(edges.has(e), e).toBe(true);
    // 임시 직결(Stony Field ↔ Dark Wood) 은 없어졌다
    expect(world.byKey.get('stonyfield')!.def.exits.some((e) => e.to === 'darkwood')).toBe(false);
    expect(world.byKey.get('darkwood')!.def.exits.some((e) => e.to === 'stonyfield')).toBe(false);
  });

  it('던전마다 입구(도착 지점)에서 그 레벨의 모든 출구에 걸어서 닿고, 출구 도착 지점은 상대 입구 옆', () => {
    const { arrival } = explore(world);
    for (const l of world.levels) {
      if (!ACT1_DUNGEONS.includes(l.id) || l.id === LEVEL.TRISTRAM) continue;
      const seen = reachable(l.def, arrival.get(l.key)!);
      expect(l.def.exits.length, l.key).toBeGreaterThan(0);
      for (const e of l.def.exits) {
        expect(exitHit(l.def, seen, e), `${l.key} → ${e.to}`).not.toBeNull();
        if (e.warp) {
          // 도착 = 상대 레벨의 되돌아오는 이동 지점 + ExitWalk (출처: LvlWarp ExitWalkX/Y)
          const back = world.byKey.get(e.to)!.def.exits.find((b) => b.to === l.key && b.warp);
          expect(back, `${e.to} → ${l.key}`).toBeTruthy();
          expect(Math.hypot(e.toX - back!.warp!.x, e.toY - back!.warp!.y)).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  // 출처: DRLGMAZE_PlaceAct1Barracks — Court Connect 방이 Outer Cloister 옆 (파일 0 W, 1 N, 2 E)
  it('Barracks 는 Outer Cloister 에 맞닿고 Cathedral 은 Inner Cloister 에 맞닿는다 (가장자리 출구)', () => {
    const bar = world.world.levels.get(LEVEL.BARRACKS)!, oc = world.world.levels.get(LEVEL.OUTERCLOISTER)!;
    const court = bar.touch.find((t) => t.levelId === LEVEL.OUTERCLOISTER)!.box;
    const dir = world.world.placement.levels.get(LEVEL.OUTERCLOISTER)!.presetDirection;
    if (dir === 0) expect(court.x + court.w).toBe(oc.box.x);
    if (dir === 1) expect(court.y + court.h).toBe(oc.box.y);
    if (dir === 2) expect(court.x).toBe(oc.box.x + oc.box.w);
    const ic = world.world.levels.get(LEVEL.INNERCLOISTER)!, cat = world.world.levels.get(LEVEL.CATHEDRAL)!;
    expect(cat.box.y + cat.box.h).toBe(ic.box.y);
  });

  it('웨이포인트: Jail 1·Catacombs 2·Inner Cloister (levels.txt Waypoint) 에 있다', () => {
    for (const id of [LEVEL.JAILLEV1, LEVEL.CATACOMBSLEV2, LEVEL.INNERCLOISTER]) {
      expect(data.level(id).waypoint).not.toBe(255);
      expect(world.world.levels.get(id)!.waypoint, data.level(id).levelName).not.toBeNull();
    }
    expect(world.world.levels.get(LEVEL.DENOFEVIL)!.waypoint).toBeNull();
  });

  it('트리스트럼(프리셋 38)은 생성되고 디버그 도착 위치가 걷기 가능 (포털은 Phase 10)', () => {
    const tri = world.byKey.get('tristram')!;
    expect([tri.preset.widthTiles, tri.preset.heightTiles]).toEqual([data.level(LEVEL.TRISTRAM).sizeX, data.level(LEVEL.TRISTRAM).sizeY]);
    expect(world.tristram).not.toBeNull();
    expect(tri.def.map.walkable(Math.floor(world.tristram!.x), Math.floor(world.tristram!.y))).toBe(true);
    expect(tri.def.exits).toHaveLength(0);
  });

  it('게임 엔진: 동굴 입구로 걸어 들어가면 Den of Evil, 출구로 나오면 입구 옆 (되돌아 튕기지 않음)', () => {
    const g = new Game({ map: new CollisionMap(1, 1), levels: world.levels.map((l) => l.def), player: { x: world.start.x, y: world.start.y, walkVelocity: 6, runVelocity: 9 }, seed: 1, data: gameData });
    const bm = world.byKey.get('bloodmoor')!.def;
    const ent = bm.exits.find((e) => e.to === 'denofevil')!;
    const spot = exitHit(bm, reachable(bm, { x: ent.x + 1, y: ent.y + 1 }), ent) ?? { x: ent.x + 1, y: ent.y + 1 };
    g.changeLevel('bloodmoor', spot.x + 0.5, spot.y + 0.5);
    g.tick();
    expect(g.levelId).toBe('denofevil');
    for (let i = 0; i < 5; i++) g.tick();
    expect(g.levelId).toBe('denofevil');
    const doe = world.byKey.get('denofevil')!.def;
    const up = doe.exits.find((e) => e.to === 'bloodmoor')!;
    const u = exitHit(doe, reachable(doe, g.snapshot().player), up)!;
    g.changeLevel('denofevil', u.x + 0.5, u.y + 0.5);
    g.tick();
    expect(g.levelId).toBe('bloodmoor');
    const p = g.snapshot().player;
    expect(Math.hypot(p.x - ent.warp!.x, p.y - ent.warp!.y)).toBeLessThan(10);
    for (let i = 0; i < 5; i++) g.tick();
    expect(g.levelId).toBe('bloodmoor');
  });

  it('게임 엔진: 입구 그림(LvlWarp Select 상자)을 클릭하면 걸어가서 들어간다', () => {
    const g = new Game({ map: new CollisionMap(1, 1), levels: world.levels.map((l) => l.def), player: { x: world.start.x, y: world.start.y, walkVelocity: 6, runVelocity: 9 }, seed: 1, data: gameData });
    const bm = world.byKey.get('bloodmoor')!.def;
    const ent = bm.exits.find((e) => e.to === 'denofevil' && e.warp)!;
    // 입구에서 조금 떨어진 걷기 가능한 곳에서 시작
    const seen = reachable(bm, { x: ent.x + 1, y: ent.y + 1 });
    let start: { x: number; y: number } | null = null;
    for (let r = 6; r < 14 && !start; r++)
      for (let dy = -r; dy <= r && !start; dy++)
        for (let dx = -r; dx <= r && !start; dx++) {
          const x = ent.warp!.x + dx, y = ent.warp!.y + dy;
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && bm.map.walkable(x, y) && seen[y * bm.map.width + x]) start = { x, y };
        }
    g.changeLevel('bloodmoor', start!.x + 0.5, start!.y + 0.5);
    // 클릭 지점 = 이동 지점 화면 좌표에서 Select 상자 중앙 → 서브타일 (render/iso.ts 역변환)
    const w = ent.warp!;
    const px = w.selectX + w.selectDX / 2, py = w.selectY + w.selectDY / 2;
    g.enqueue({ type: 'move', x: w.x + py / 16 + px / 32, y: w.y + py / 16 - px / 32, run: true });
    for (let i = 0; i < 400 && g.levelId === 'bloodmoor'; i++) g.tick();
    expect(g.levelId).toBe('denofevil');
  });
});
