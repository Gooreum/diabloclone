// Act 2 월드 DRLG (루트 골레인 프리셋 + 사막 야외 DrlgOutDesr + 미로·프리셋 던전) 이식 검증.
// 기대값은 원작 데이터 테이블(levels.txt / LvlMaze.txt / LvlPrest.txt)과 D2MOO DrlgDrlg.cpp·DrlgOutPlace.cpp·DrlgOutDesr.cpp·DrlgMaze.cpp 규칙에서 유도.
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { makeDrlgData } from '../../src/data/drlg-data';
import { actWorldPaths, buildActWorld, type ActWorld } from '../../src/data/world';
import { assembleWorld, levelKey, levelTypeDt1Paths, type WorldLevel } from '../../src/data/world-level';
import { A2, ACT2_ALL, TAL_RASHA_TOMBS, generateAct2World, placeAct2, rollTalRashaTombs, type Act2World } from '../../src/engine/drlg/act2';
import { generateAct2MazeLevel, MZ2 } from '../../src/engine/drlg/act2-maze';
import { DESR } from '../../src/engine/drlg/outdesr';
import { arcaneDirection } from '../../src/engine/drlg/logic';
import { actAvailable, ACT_DRLG } from '../../src/engine/drlg/acts';
import { DRLGTYPE, OBJSUBCLASS, type DrlgData } from '../../src/engine/drlg/types';
import { nearestWalkable } from '../../src/engine/path';
import { Rng } from '../../src/engine/rng';
import type { GameData, LevelDef } from '../../src/engine/game';

const SEED = 1234;

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

/** 마을 시작점에서 걸어서 닿는 출구만 따라가는 BFS. 반환: 레벨 key → 도착 지점, 지나간 간선 */
function explore(byKey: Map<string, WorldLevel>, start: { x: number; y: number }): { arrival: Map<string, { x: number; y: number }>; edges: Set<string> } {
  const arrival = new Map<string, { x: number; y: number }>([['lutgholein', start]]);
  const edges = new Set<string>();
  const queue = ['lutgholein'];
  while (queue.length) {
    const key = queue.shift()!;
    const lv = byKey.get(key)!;
    const seen = reachable(lv.def, arrival.get(key)!);
    const m = lv.def.map;
    for (const e of lv.def.exits) {
      let hit: { x: number; y: number } | null = null;
      for (let y = e.y; y < e.y + e.h && !hit; y++) for (let x = e.x; x < e.x + e.w && !hit; x++) if (m.walkable(x, y) && seen[y * m.width + x]) hit = { x, y };
      if (!hit) continue;
      edges.add(`${key}>${e.to}`);
      if (arrival.has(e.to)) continue;
      const target = byKey.get(e.to)!;
      const tx = e.dx !== undefined ? hit.x + 0.5 + e.dx : e.toX, ty = e.dy !== undefined ? hit.y + 0.5 + e.dy : e.toY;
      const spot = nearestWalkable(target.def.map, { x: tx, y: ty }, 12);
      if (!spot) continue;
      arrival.set(e.to, { x: spot.x + 0.5, y: spot.y + 0.5 });
      queue.push(e.to);
    }
  }
  return { arrival, edges };
}

describe.skipIf(!hasGameData)('Act 2 월드 DRLG (원작 데이터)', () => {
  let tables: GameTables, gameData: GameData, data: DrlgData, world: ActWorld, drlg: Act2World;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    gameData = buildGameData(gameChain(), tables);
    data = makeDrlgData(gameChain(), tables);
    world = buildActWorld(gameChain(), tables, gameData, SEED, 1);
    drlg = generateAct2World(data, SEED);
  }, 120_000);

  // 출처: LevelsIds.h D2C_LvlPrestIds ↔ LvlPrest.txt Def
  it('프리셋 Def 상수가 LvlPrest.txt 이름과 일치', () => {
    expect(data.lvlPrest(DESR.TOWN).name).toBe('Act 2 - Town ');
    expect(data.lvlPrest(DESR.DESERT_BORDER_1).name).toBe('Act 2 - Desert Border 1');
    expect(data.lvlPrest(DESR.CLIFF_TOP_KING_TOMB).name).toBe('Act 2 - Desert Cliff Top King Tomb');
    expect(data.lvlPrest(DESR.VALLEY_WARP).name).toBe('Act 2 - Desert Valley Warp');
    expect(data.lvlPrest(DESR.RUINS_ELDER).name).toBe('Act 2 - Desert Ruins Elder');
    expect(data.lvlPrest(MZ2.SEWER_PREV_NS).name).toBe('Act 2 - Sewer Prev NS');
    expect(data.lvlPrest(MZ2.BASEMENT_NW).name).toBe('Act 2 - Basement NW');
    expect(data.lvlPrest(MZ2.TOMB_PREV_NSE).name).toBe('Act 2 - Tomb Prev NSE');
    expect(data.lvlPrest(MZ2.TOMB_TALRASHA_W).name).toBe('Act 2 - Tomb Talrasha W');
    expect(data.lvlPrest(MZ2.TOMB_KAA_W).name).toBe('Act 2 - Tomb Kaa W');
    expect(data.lvlPrest(MZ2.DURIELS_LAIR).name).toBe("Act 2 - Duriel's Lair");
    expect(data.lvlPrest(MZ2.LAIR_TIGHT_SPOT_S).name).toBe('Act 2 - Lair Tight Spot S');
    expect(data.lvlPrest(MZ2.ARCANE_SUMMONER_W).name).toBe('Act 2 - Arcane Summoner W');
  });

  it('막 등록표: Act 2 (마을 40, levels.txt Act=1 레벨 40~74 전부)', () => {
    expect(actAvailable(1)).toBe(true);
    expect(ACT_DRLG[1]!.town).toBe(A2.LUTGHOLEIN);
    const act2 = tables.table('Levels').filter((r) => r.Act === '1').map((r) => Number(r.Id));
    expect([...ACT2_ALL].sort((a, b) => a - b)).toEqual(act2);
    expect(world.townId).toBe('lutgholein');
    expect(world.levels).toHaveLength(35);
    for (const l of world.levels) expect(l.key, `${l.id}`).not.toMatch(/^level\d+$/);
  });

  // 출처: DRLG_AllocDrlg → 무덤 롤 → CreateLevelConnections — 같은 시드면 같은 배치·방·타일
  it('결정성: 같은 시드 → 같은 월드 (배치·미로 방·타일·몬스터), 다른 시드 → 다른 배치', () => {
    const w2 = buildActWorld(gameChain(), tables, gameData, SEED, 1);
    for (const l of world.levels) {
      const o = w2.byKey.get(l.key)!;
      expect(o.preset.widthTiles, l.key).toBe(l.preset.widthTiles);
      expect(o.preset.floors.map((f) => f.tileIndex), l.key).toEqual(l.preset.floors.map((f) => f.tileIndex));
      expect(o.preset.walls.map((f) => f.tileIndex), l.key).toEqual(l.preset.walls.map((f) => f.tileIndex));
      expect(o.def.spawns?.length, l.key).toBe(l.def.spawns?.length);
    }
    const d2 = generateAct2World(data, SEED);
    for (const [id, l] of drlg.levels) expect(d2.levels.get(id)!.layout.rooms, `${id}`).toEqual(l.layout.rooms);
    const layouts = new Set<string>(), tombs = new Set<number>();
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const p = placeAct2(data, s);
      layouts.add(JSON.stringify([...p.levels.values()].map((l) => l.box)));
      tombs.add(p.staffTomb);
    }
    expect(layouts.size).toBeGreaterThan(1);
    expect(tombs.size).toBeGreaterThan(1);
  });

  // 출처: levels.txt SizeX/SizeY·OffsetX/Y, gAct2OutdoorDrlgLink 링커 (sub_6FD81B30 / sub_6FD81530 / sub_6FD81BF0)
  it('크기·위치: 야외·프리셋 = levels.txt, Rocky Waste 는 마을 서쪽(LutW)/북쪽(LutN), 협곡은 OffsetX/Y 고정', () => {
    for (const id of [40, 41, 42, 43, 44, 45, 46, 50, 73]) {
      const r = data.level(id), l = drlg.levels.get(id)!;
      expect([l.box.w, l.box.h], `${id}`).toEqual([r.sizeX, r.sizeY]);
      const pl = world.levels.find((x) => x.id === id)!;
      expect([pl.preset.widthTiles, pl.preset.heightTiles], `${id}`).toEqual([r.sizeX, r.sizeY]);
    }
    for (const s of [1, 2, 3, 4, 5, SEED]) {
      const p = placeAct2(data, s);
      const town = p.levels.get(40)!, waste = p.levels.get(41)!;
      expect(town.box).toMatchObject({ x: 1000, y: 1000 });
      expect(p.levels.get(46)!.box).toMatchObject({ x: 2500, y: 1000 });
      // 1 = 서쪽 (sub_6FD81430 방향 1), 2 = 북쪽 (sub_6FD81850 방향 2) — 마을 파일 = 같은 값 (LutW = File2, LutN = File3)
      if (town.presetDirection === 1) expect(waste.box).toMatchObject({ x: town.box.x - 80, y: town.box.y });
      else {
        expect(town.presetDirection).toBe(2);
        expect(waste.box).toMatchObject({ x: town.box.x, y: town.box.y - 80 });
      }
      // 야외 사막 레벨은 서로 겹치지 않는다 (DRLGOUTPLACE_LinkAct2Outdoors)
      const boxes = [40, 41, 42, 43, 44, 45].map((id) => p.levels.get(id)!.box);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, b = boxes[j]!;
          expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${i}/${j}`).toBe(true);
        }
    }
    expect(drlg.townFile).toBe(drlg.placement.levels.get(40)!.presetDirection);
  });

  // 출처: LvlMaze.txt Rooms/SizeX/SizeY + DRLGMAZE_BuildBasicMaze (진짜 무덤 ×3, 카아 무덤 ×2)
  it('미로 방: 방 크기 = LvlMaze SizeX/Y, 방 수 ≥ LvlMaze Rooms (무덤 배수), 방끼리 겹치지 않는다', () => {
    const p = drlg.placement;
    for (const id of ACT2_ALL) {
      if (data.level(id).drlgType !== DRLGTYPE.MAZE) continue;
      const mz = data.lvlMaze(id);
      const m = generateAct2MazeLevel(data, p, id);
      for (const r of m.mazeRooms) expect([r.box.w, r.box.h], `${id}`).toEqual([mz.sizeX, mz.sizeY]);
      for (let i = 0; i < m.mazeRooms.length; i++)
        for (let j = i + 1; j < m.mazeRooms.length; j++) {
          const a = m.mazeRooms[i]!.box, b = m.mazeRooms[j]!.box;
          expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${id} ${i}/${j}`).toBe(true);
        }
      let need = mz.rooms;
      if (id === p.staffTomb) need *= 3;
      if (id === p.bossTomb) need *= 2;
      // 발톱 독사 사원 2 = 방 하나 (오염된 태양 제단), 할렘 2·궁전 지하 = 기본 고리 4 방, 성역 = 61 방
      if (id === A2.CLAWVIPERTEMPLELEV2) expect(m.mazeRooms).toHaveLength(1);
      else if (id >= 51 && id <= 54) expect(m.mazeRooms).toHaveLength(4);
      else expect(m.mazeRooms.length, `${id}`).toBeGreaterThanOrEqual(Math.min(need, 61));
    }
  });

  // 출처: DRLGROOMTILE_LoadDT1FilesForRoom — 방 DT1 마스크 비트 = LvlTypes File N. 원작 타일이 모두 있어야 구멍·쓰레기 없음
  it('모든 Act 2 레벨 타일이 그 레벨 LvlTypes DT1 (방 DT1 마스크 안) 에서 발견된다 — 여러 시드', () => {
    const worlds = [world, buildActWorld(gameChain(), tables, gameData, 777, 1)];
    for (const w of worlds)
      for (const l of w.levels) {
        expect(l.preset.missing, l.key).toBe(0);
        expect(l.preset.maskFallback, l.key).toBe(0);
        expect(l.preset.floors.length, l.key).toBeGreaterThan(0);
      }
    for (const t of [12, 13, 14, 15, 16, 17, 18, 19]) {
      const dt1 = levelTypeDt1Paths(tables, t).filter((p) => p && gameChain().read(p));
      expect(dt1.length, `LvlType ${t}`).toBeGreaterThan(3);
    }
  });

  it('브라우저 preload 목록(actWorldPaths(1))이 Act 2 생성에 쓰인 DS1/DT1 을 모두 담고 전부 MPQ 에서 읽힌다', () => {
    const paths = actWorldPaths(gameChain(), tables, 1);
    for (const p of paths) expect(gameChain().read(p), p).toBeTruthy();
    const set = new Set(paths.map((p) => p.toLowerCase()));
    const dd = makeDrlgData(gameChain(), tables);
    generateAct2World(dd, SEED);
    generateAct2World(dd, 777);
    for (const f of dd.files) expect(set.has(f.toLowerCase()), f).toBe(true);
    for (const t of [12, 13, 14, 15, 16, 17, 18, 19]) for (const p of levelTypeDt1Paths(tables, t)) if (p) expect(set.has(p.toLowerCase()), p).toBe(true);
  });

  // 출처: levels.txt Waypoint (255 = 없음) — Lut Gholein 9, Sewers 2 10, Dry Hills 11, Halls of the Dead 2 12, Far Oasis 13,
  //       Lost City 14, Palace Cellar 1 15, Arcane Sanctuary 16, Canyon of the Magi 17
  it('웨이포인트는 levels.txt Waypoint 가 있는 레벨에만, 하나씩 있다', () => {
    for (const s of [SEED, 99]) {
      const w = s === SEED ? drlg : generateAct2World(data, s);
      for (const [id, l] of w.levels) {
        const want = data.level(id).waypoint !== 255;
        expect(!!l.waypoint, `seed ${s} level ${id}`).toBe(want);
        const n = l.layout.units.filter((u) => u.type === 2 && data.objectSubClass(u.id) & OBJSUBCLASS.WAYPOINT).length;
        expect(n, `seed ${s} level ${id}`).toBe(want ? 1 : 0);
      }
    }
    const withWp = ACT2_ALL.filter((id) => data.level(id).waypoint !== 255).sort((a, b) => a - b);
    expect(withWp).toEqual([40, 42, 43, 44, 46, 48, 52, 57, 74]);
  });

  // 출처: DRLG_AllocDrlg (ACT_II) 무덤 롤 + DRLGMAZE_PlaceAct2TombStuff (진짜 무덤 = Tal Rasha 방·오리피스, 카아 무덤 = Kaa 방)
  it('진짜 탈 라샤 무덤은 정확히 하나 (Tal Rasha 방·오리피스), 카아 무덤도 하나이고 서로 다르다 — 여러 시드', () => {
    for (const s of [SEED, 1, 2, 3, 42, 777]) {
      const w = s === SEED ? drlg : generateAct2World(data, s);
      const r = new Rng(s >>> 0);
      r.roll(); // dwStartSeed
      const want = rollTalRashaTombs(r);
      expect(w.realTomb).toBe(want.staffTomb);
      expect(w.kaaTomb).toBe(want.bossTomb);
      expect(w.realTomb).not.toBe(w.kaaTomb);
      const rooms = (id: number) => generateAct2MazeLevel(data, w.placement, id).mazeRooms.map((m) => m.prest);
      const tal = TAL_RASHA_TOMBS.filter((id) => rooms(id).some((p) => p >= MZ2.TOMB_TALRASHA_W && p < MZ2.TOMB_TALRASHA_W + 4));
      const kaa = TAL_RASHA_TOMBS.filter((id) => rooms(id).some((p) => p >= MZ2.TOMB_KAA_W && p < MZ2.TOMB_KAA_W + 4));
      expect(tal).toEqual([w.realTomb]);
      expect(kaa).toEqual([w.kaaTomb]);
      const orifice = TAL_RASHA_TOMBS.filter((id) => w.levels.get(id)!.layout.units.some((u) => u.type === 2 && u.id === 152));
      expect(orifice).toEqual([w.realTomb]);
      // 가짜 무덤(진짜가 아닌 6 개)에는 상자 방
      for (const id of TAL_RASHA_TOMBS) if (id !== w.realTomb) expect(rooms(id).some((p) => p >= MZ2.TOMB_CHEST_W && p < MZ2.TOMB_CHEST_W + 4), `${id}`).toBe(true);
    }
  });

  // 출처: DRLGMAZE_PlaceArcaneSanctuary — 중앙 방 파일 4 (포털·웨이포인트), 네 가지 × 15 방, 소환사 방 하나
  it('비전의 성역: 중앙 방(포털·웨이포인트) + 네 나선 가지 + 소환사 방 하나', () => {
    const m = generateAct2MazeLevel(data, drlg.placement, A2.ARCANESANCTUARY);
    expect(m.mazeRooms.length).toBe(61);
    expect(m.mazeRooms.filter((r) => r.prest >= MZ2.ARCANE_SUMMONER_W && r.prest < MZ2.ARCANE_SUMMONER_W + 4)).toHaveLength(1);
    const center = m.mazeRooms.find((r) => r.picked === 4)!;
    expect(center.prest).toBe(MZ2.LAIR_TIGHT_SPOT_S + 15); // ARCANE_NSEW
    expect(arcaneDirection(2, 0)).toBe(2);
    expect(arcaneDirection(2, 2)).toBe(5);
    expect(arcaneDirection(2, 7)).toBe(3);
    expect(arcaneDirection(2, 13)).toBe(4);
    const units = drlg.levels.get(A2.ARCANESANCTUARY)!.layout.units;
    expect(units.filter((u) => u.type === 2 && u.id === 298)).toHaveLength(1);
    expect(units.filter((u) => u.type === 2 && u.id === 357)).toHaveLength(1);
  });

  it('하수도·궁전·무덤 특수 방: 이전/다음 층, 라다먼트 방, 큐브 방, 레더암 방, 성역 포털 방', () => {
    const p = drlg.placement;
    const prests = (id: number) => generateAct2MazeLevel(data, p, id).mazeRooms.map((m) => m.prest);
    const count = (id: number, base: number, n = 4) => prests(id).filter((x) => x >= base && x < base + n).length;
    expect(count(A2.SEWERSLEV1, MZ2.SEWER_PREV_E, 1)).toBe(1);
    expect(count(A2.SEWERSLEV1, MZ2.SEWER_PREV_NS, 1)).toBe(1);
    expect(count(A2.SEWERSLEV1, MZ2.SEWER_NEXT_W)).toBe(1);
    expect(count(A2.SEWERSLEV2, MZ2.SEWER_WAYPOINT_W)).toBe(1);
    expect(count(A2.SEWERSLEV3, MZ2.SEWER_RADAMENT_W)).toBe(1);
    expect(count(A2.ANCIENTTUNNELS, MZ2.SEWER_CHEST_W)).toBe(1);
    expect(count(A2.HALLSOFTHEDEADLEV3, MZ2.TOMB_CUBE_W)).toBe(1);
    expect(count(A2.STONYTOMBLEV2, MZ2.TOMB_LEATHERARM_W)).toBe(1);
    expect(count(A2.MAGGOTLAIRLEV3, MZ2.LAIR_TIGHT_SPOT_S, 1)).toBe(1);
    for (const id of [55, 56, 57, 58]) expect(count(id, MZ2.TOMB_NEXT_W), `${id}`).toBe(1);
    // Palace Cellar 3: SE 방 파일 3 = CelSE3 (포털 298)
    expect(drlg.levels.get(A2.PALACECELLARLEV3)!.layout.units.filter((u) => u.type === 2 && u.id === 298)).toHaveLength(1);
  });

  // 출처: levels.txt Vis/Warp + gAct2OutdoorDrlgLink (가장자리) + objects.txt 298 portal (궁전 지하 3 ↔ 성역)
  // 퀘스트 포털(성역 → 협곡 A2Q5, 진짜 무덤 → 두리엘 방 A2Q6)은 Phase 7 전까지 디버그 경로(bridgeQuestPortals)로만 잇는다
  it('BFS: 루트 골레인에서 걸어서 모든 Act 2 레벨에 닿는다 (퀘스트 포털 2 개는 디버그 연결로 표시)', () => {
    // 1) 게임 월드 그대로: 퀘스트 포털 없이 닿는 곳
    const plain = explore(world.byKey, world.start);
    const questOnly = new Set(['canyon', 'taltomb1', 'taltomb2', 'taltomb3', 'taltomb4', 'taltomb5', 'taltomb6', 'taltomb7', 'durielslair']);
    for (const l of world.levels) expect(plain.arrival.has(l.key), l.key).toBe(!questOnly.has(l.key));
    for (const e of [
      'lutgholein>rockywaste', 'rockywaste>lutgholein', 'rockywaste>dryhills', 'dryhills>faroasis', 'faroasis>lostcity', 'lostcity>valleyofsnakes', 'valleyofsnakes>lostcity',
      'lutgholein>sewers1', 'sewers1>lutgholein', 'sewers1>sewers2', 'sewers2>sewers3', 'sewers3>sewers2',
      'lutgholein>harem1', 'harem1>lutgholein', 'harem1>harem2', 'harem2>palacecellar1', 'palacecellar1>palacecellar2', 'palacecellar2>palacecellar3',
      'palacecellar3>arcane', 'arcane>palacecellar3',
      'rockywaste>stonytomb1', 'stonytomb1>stonytomb2', 'stonytomb2>stonytomb1', 'dryhills>hallsofdead1', 'hallsofdead1>hallsofdead2', 'hallsofdead2>hallsofdead3',
      'faroasis>maggotlair1', 'maggotlair1>maggotlair2', 'maggotlair2>maggotlair3', 'lostcity>ancienttunnels', 'ancienttunnels>lostcity',
      'valleyofsnakes>clawviper1', 'clawviper1>clawviper2', 'clawviper2>clawviper1',
    ]) expect(plain.edges.has(e), e).toBe(true);
    // 2) 디버그 연결 (퀘스트 포털을 출구로): 전부 닿는다
    const dd = makeDrlgData(gameChain(), tables);
    const bridged = generateAct2World(dd, SEED, { bridgeQuestPortals: true });
    const asm = assembleWorld(gameChain(), tables, gameData, dd, bridged, SEED, 1, A2.LUTGHOLEIN);
    const all = explore(asm.byKey, asm.start);
    for (const id of ACT2_ALL) expect(all.arrival.has(levelKey(id)), levelKey(id)).toBe(true);
    for (const id of TAL_RASHA_TOMBS) {
      expect(all.edges.has(`canyon>${levelKey(id)}`), `canyon>${levelKey(id)}`).toBe(true);
      expect(all.edges.has(`${levelKey(id)}>canyon`), `${levelKey(id)}>canyon`).toBe(true);
    }
    expect(all.edges.has('arcane>canyon')).toBe(true);
    expect(all.edges.has(`${levelKey(bridged.realTomb)}>durielslair`)).toBe(true);
    // 퀘스트 포털 자리 기록
    expect(bridged.portals.filter((p) => p.quest).map((p) => [p.from, p.to])).toEqual([[A2.ARCANESANCTUARY, A2.CANYONOFTHEMAGI], [bridged.realTomb, A2.DURIELSLAIR]]);
  });

  it('이동 타일 출구: 도착 = 상대 레벨의 되돌아오는 이동 지점 옆 (두 입구는 vis 순서대로 짝)', () => {
    for (const l of world.levels) {
      for (const e of l.def.exits) {
        if (!e.warp) continue;
        const backs = world.byKey.get(e.to)!.def.exits.filter((b) => b.to === l.key && b.warp);
        expect(backs.length, `${e.to} → ${l.key}`).toBeGreaterThan(0);
        expect(Math.min(...backs.map((b) => Math.hypot(e.toX - b.warp!.x, e.toY - b.warp!.y))), `${l.key} → ${e.to}`).toBeLessThanOrEqual(8);
      }
    }
    // 루트 골레인 → 하수도 두 입구 (뚜껑 문·선착장)는 서로 다른 하수도 출구로 도착한다
    const lut = world.byKey.get('lutgholein')!.def.exits.filter((e) => e.to === 'sewers1' && e.warp);
    const arrivals = new Set(lut.map((e) => `${Math.round(e.toX)},${Math.round(e.toY)}`));
    expect(arrivals.size).toBeGreaterThan(1);
  });
});
