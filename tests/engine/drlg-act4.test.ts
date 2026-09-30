// Act 4 DRLG (판데모니움 요새 · 메사 3 레벨 · 불꽃의 강 · 카오스 생추어리) 이식 검증.
// 기대값 출처: levels.txt (Id 103~108 DrlgType/LevelType/SizeX/SizeY/OffsetX/OffsetY/Vis/Warp/Waypoint), LvlMaze.txt (107: Rooms 6, 24×24),
//             LvlPrest.txt (797~862 Act 4 행 이름·크기·Dt1Mask), objects.txt (392~396 Seal OperateFn, 255 InitFn 55, 376 Hellforge, 238/398 Waypoint),
//             D2MOO DrlgOutPlace.cpp gAct4OutdoorDrlgLink / sub_6FD81CA0, DrlgOutdoors.cpp DRLGOUTDOORS_InitAct4OutdoorLevel,
//             DrlgMaze.cpp DRLGMAZE_PlaceAct4Lava, A4Q2.cpp OBJECTS_OperateFunction54/55/56_DiabloSeal
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { makeDrlgData } from '../../src/data/drlg-data';
import { actWorldPaths, buildActWorld, levelKey, type ActWorld } from '../../src/data/world';
import { ACT4_ALL, LEVEL4, OBJ4, PREST4, generateAct4World, placeAct4, type Act4World } from '../../src/engine/drlg/act4';
import { ACT_DRLG } from '../../src/engine/drlg/acts';
import { DRLGTYPE, type DrlgData } from '../../src/engine/drlg/types';
import { nearestWalkable } from '../../src/engine/path';
import type { GameData, LevelDef } from '../../src/engine/game';

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

function exitHit(def: LevelDef, seen: Uint8Array, e: LevelDef['exits'][number]): { x: number; y: number } | null {
  const m = def.map;
  for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (m.walkable(x, y) && seen[y * m.width + x]) return { x, y };
  return null;
}

/** 요새 도착 위치에서 걸어서 갈 수 있는 출구만 따라가는 BFS. 반환: 레벨 key → 도착 지점, 지나간 간선, 레벨별 도달 칸 */
function explore(world: ActWorld): { arrival: Map<string, { x: number; y: number }>; edges: Set<string>; seen: Map<string, Uint8Array> } {
  const arrival = new Map<string, { x: number; y: number }>([[world.townId, world.start]]);
  const edges = new Set<string>();
  const seenBy = new Map<string, Uint8Array>();
  const queue = [world.townId];
  while (queue.length) {
    const key = queue.shift()!;
    const lv = world.byKey.get(key)!;
    const seen = reachable(lv.def, arrival.get(key)!);
    seenBy.set(key, seen);
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
  return { arrival, edges, seen: seenBy };
}

/** 월드 비교용 요약 (상자·프리셋 격자·타일·유닛) */
function digest(w: Act4World): string {
  const out: string[] = [];
  for (const l of w.levels.values()) {
    const d = l.layout.ds1;
    let h = 0;
    for (const layer of [...d.floors, ...d.walls]) for (const c of layer) h = (Math.imul(h, 31) + c.prop1 * 7 + c.style * 131 + c.sequence * 17 + c.orientation) | 0;
    out.push(`${l.id}:${JSON.stringify(l.box)}:${h}:${l.layout.units.map((u) => `${u.type}/${u.id}@${u.x},${u.y}`).join(';')}`);
  }
  return out.join('\n');
}

describe.skipIf(!hasGameData)('Act 4 DRLG (원작 데이터)', () => {
  let tables: GameTables, gameData: GameData, data: DrlgData, world: ActWorld;
  const SEED = 4242;
  const SEEDS = [1, 7, 4242, 12345, 99991, 0xdeadbeef];
  const worlds = new Map<number, Act4World>();
  const gen = (s: number) => {
    let w = worlds.get(s);
    if (!w) worlds.set(s, (w = generateAct4World(data, s)));
    return w;
  };
  beforeAll(() => {
    tables = new GameTables(gameChain());
    gameData = buildGameData(gameChain(), tables);
    data = makeDrlgData(gameChain(), tables);
    world = buildActWorld(gameChain(), tables, gameData, SEED, 3);
  }, 180_000);

  // 출처: LevelsIds.h D2C_LvlPrestIds ↔ LvlPrest.txt Def
  it('Act 4 프리셋 Def 상수가 LvlPrest.txt 이름과 일치', () => {
    const name = (d: number) => data.lvlPrest(d).name;
    expect(name(PREST4.FORTRESS)).toBe('Act 4 - Fortress');
    expect(name(PREST4.FORTRESS_TRANSITION)).toBe('Act 4 - Fortress Transition');
    expect(name(PREST4.MESA_BORDER_1)).toBe('Act 4 - Mesa Border 1');
    expect(name(PREST4.MESA_BORDER_1 + 11)).toBe('Act 4 - Mesa Border 12');
    expect(name(PREST4.MESA_WARP)).toBe('Act 4 - Mesa Warp');
    expect(name(PREST4.MESA_1_24X24)).toBe('Act 4 - Mesa 1 24X24');
    expect(name(PREST4.MESA_2_24X24 + 4)).toBe('Act 4 - Mesa 2 08X08');
    expect(name(PREST4.MESA_2_IZUAL)).toBe('Act 4 - Mesa 2 Izual');
    expect(name(PREST4.MESA_3_24X24)).toBe('Act 4 - Mesa 3 24X24');
    expect(name(PREST4.PITS_1_16X16 + 3)).toBe('Act 4 - Pits 1 08X08');
    expect(name(PREST4.PITS_2_16X16)).toBe('Act 4 - Pits 2 16X16');
    expect(name(PREST4.LAVA_X)).toBe('Act 4 - Lava X');
    expect(name(PREST4.LAVA_X + 15)).toBe('Act 4 - Lava NSEW');
    expect(name(PREST4.LAVA_WARP_N)).toBe('Act 4 - Lava Warp N');
    expect(name(PREST4.LAVA_FORGE_W)).toBe('Act 4 - Lava Forge W');
    expect(name(PREST4.BRIDGE_1)).toBe('Act 4 - Bridge 1');
    expect(name(PREST4.DIABLO_ENTRY)).toBe('Act 4 - Diablo Entry');
    expect(name(PREST4.DIABLO_HEART)).toBe('Act 4 - Diablo Heart');
  });

  it('ACT_DRLG[3] 에 등록, 레벨 목록·종류가 levels.txt 와 일치', () => {
    expect(ACT_DRLG[3]?.town).toBe(LEVEL4.FORTRESS);
    expect(ACT_DRLG[3]?.levels).toEqual(ACT4_ALL);
    const types = ACT4_ALL.map((id) => data.level(id).drlgType);
    expect(types).toEqual([DRLGTYPE.PRESET, DRLGTYPE.OUTDOOR, DRLGTYPE.OUTDOOR, DRLGTYPE.OUTDOOR, DRLGTYPE.MAZE, DRLGTYPE.OUTDOOR]);
    expect(ACT4_ALL.map((id) => data.level(id).levelType)).toEqual([26, 27, 27, 27, 28, 28]);
    expect(data.lvlMaze(LEVEL4.RIVEROFFLAME)).toMatchObject({ rooms: 6, sizeX: 24, sizeY: 24 });
  });

  it('결정성: 같은 시드 → 같은 월드 (배치·타일·유닛), 다른 시드 → 다른 월드', () => {
    for (const s of [SEED, 12345]) expect(digest(generateAct4World(data, s))).toBe(digest(gen(s)));
    expect(digest(gen(1))).not.toBe(digest(gen(12345)));
    // 브라우저 조립 결과도 결정적
    const w2 = buildActWorld(gameChain(), tables, gameData, SEED, 3);
    expect(w2.start).toEqual(world.start);
    for (const l of world.levels) {
      const o = w2.byKey.get(l.key)!;
      expect(o.def.map.width, l.key).toBe(l.def.map.width);
      expect(o.def.exits, l.key).toEqual(l.def.exits);
      expect(o.def.objects, l.key).toEqual(l.def.objects);
    }
  });

  // 출처: levels.txt SizeX/SizeY/OffsetX/OffsetY + gAct4OutdoorDrlgLink (요새 고정, 초원은 요새 동쪽 sub_6FD81CA0, 나머지 sub_6FD81380)
  it('레벨 크기·위치: 요새 32×24 @(1000,1000), 메사 80×64 / 64×80 / 80×64, 카오스 120×120 @(1500,1000), 강은 카오스 바로 아래', () => {
    for (const s of SEEDS) {
      const w = gen(s);
      const box = (id: number) => w.levels.get(id)!.box;
      expect(box(LEVEL4.FORTRESS)).toEqual({ x: 1000, y: 1000, w: 32, h: 24 });
      expect(box(LEVEL4.OUTERSTEPPES)).toMatchObject({ x: 1032, w: 80, h: 64 });
      // sub_6FD81850/81430 (a3 = 3, a4 = 3): 요새 위쪽 8 위 또는 아래쪽 맞춤 + 8
      expect([992, 968]).toContain(box(LEVEL4.OUTERSTEPPES).y);
      expect(w.placement.steppesFlag).toBe(box(LEVEL4.OUTERSTEPPES).y === 992 ? 0x400000 : 0x800000);
      expect(box(LEVEL4.PLAINSOFDESPAIR)).toMatchObject({ w: 64, h: 80 });
      expect(box(LEVEL4.CITYOFTHEDAMNED)).toMatchObject({ w: 80, h: 64 });
      expect(box(LEVEL4.CHAOSSANCTUM)).toEqual({ x: 1500, y: 1000, w: 120, h: 120 });
      const river = box(LEVEL4.RIVEROFFLAME);
      expect(river.y).toBe(1120);
      // 방 24×24 (+1 가장자리): 기본 6 방 + 이동 방 + 다리 3 + 빈 자리 채우기
      expect((river.w - 1) % 24).toBe(0);
      expect((river.h - 1) % 24).toBe(0);
      // 메사 레벨끼리·요새와 겹치지 않음
      const ids = [103, 104, 105, 106];
      for (const a of ids) for (const b of ids) if (a < b) {
        const A = box(a), B = box(b);
        expect(A.x >= B.x + B.w || B.x >= A.x + A.w || A.y >= B.y + B.h || B.y >= A.y + A.h, `${a}/${b}`).toBe(true);
      }
      const rooms = (w.levels.get(LEVEL4.RIVEROFFLAME)!.layout as unknown as { mazeRooms: { prest: number; box: { x: number; y: number } }[] }).mazeRooms;
      // 마지막 다리가 카오스 아래 가운데 (x = 카오스 x + 48)
      const bridges = rooms.filter((r) => r.prest === PREST4.BRIDGE_2 || r.prest === PREST4.BRIDGE_1);
      expect(bridges).toHaveLength(3);
      expect(bridges.some((r) => r.box.x === 1548 && r.box.y === 1120)).toBe(true);
      expect(rooms.filter((r) => r.prest === PREST4.LAVA_WARP_N)).toHaveLength(1);
      expect(rooms.filter((r) => r.prest === PREST4.LAVA_FORGE_W || r.prest === PREST4.LAVA_FORGE_E)).toHaveLength(1);
    }
    // 두 정렬(0x400000 / 0x800000)이 모두 나온다
    expect(new Set(SEEDS.map((s) => gen(s).placement.steppesFlag)).size).toBe(2);
  });

  // 출처: DRLGROOMTILE_LoadDT1FilesForRoom — 방 DT1 마스크(LvlPrest Dt1Mask / 야외 0x01) 비트 = LvlTypes File N
  it('DT1 마스크: 모든 Act 4 타일이 그 레벨 LvlTypes DT1 (방 마스크 안)에서 발견된다', () => {
    const worlds = [world, buildActWorld(gameChain(), tables, gameData, 12345, 3)];
    for (const w of worlds)
      for (const l of w.levels) {
        expect(l.preset.missing, l.key).toBe(0);
        expect(l.preset.maskFallback, l.key).toBe(0);
        expect(l.preset.floors.length, l.key).toBeGreaterThan(0);
      }
    // 마스크 비트가 LvlTypes 파일 수 안 (Mesa 9 개, Lava 11 개, Town 7 개)
    const files: Record<number, number> = { 26: 7, 27: 9, 28: 11 };
    for (const s of [SEED, 12345]) {
      const w = gen(s);
      for (const l of w.levels.values()) {
        const n = files[data.level(l.id).levelType]!;
        let all = 0;
        for (const m of l.layout.tileMask) all |= m;
        expect(all >>> n, `${l.id}`).toBe(0);
        expect(all, `${l.id}`).not.toBe(0);
      }
    }
  });

  // 출처: levels.txt Vis/Warp — 요새 ↔ 초원 ↔ 평원 ↔ 도시 (가장자리), 도시 → 강 (Warp 69/70), 강 ↔ 카오스 (다리 가장자리)
  it('BFS: 요새 도착 위치에서 걸어서 카오스 생추어리까지 도달 (여러 시드)', () => {
    for (const s of [SEED, 1, 12345]) {
      const w = s === SEED ? world : buildActWorld(gameChain(), tables, gameData, s, 3);
      const { arrival, edges } = explore(w);
      for (const id of ACT4_ALL) expect(arrival.has(levelKey(id)), `${s} ${levelKey(id)}`).toBe(true);
      for (const e of ['pandemonium>outersteppes', 'outersteppes>plainsofdespair', 'plainsofdespair>cityofthedamned', 'cityofthedamned>riverofflame', 'riverofflame>chaossanctuary', 'chaossanctuary>riverofflame', 'riverofflame>cityofthedamned'])
        expect(edges.has(e), `${s} ${e}`).toBe(true);
    }
  });

  // 출처: objects.txt (392~396 Seal, 255 InitFn 55 DiabloStartPoint), A4Q2.cpp OperateFn 54/55/56 (보스 36/37/38)
  it('카오스 생추어리: 봉인 오브젝트 5 개 + 디아블로 자리, 봉인 보스 3 곳, 날개 파일 변형이 시드마다 달라진다', () => {
    const variants = new Set<string>();
    for (const s of SEEDS) {
      const w = gen(s);
      expect(w.chaos.seals.map((x) => x.objectId)).toEqual([392, 393, 394, 395, 396]);
      expect(w.chaos.diablo).not.toBeNull();
      // 디아블로 자리는 심장(Heart) 프리셋 (가운데 5×5 칸의 (2,2) = 셀 6..8 → 서브타일 240..359)
      expect(w.chaos.diablo!.x).toBeGreaterThanOrEqual(240);
      expect(w.chaos.diablo!.x).toBeLessThan(360);
      expect(w.chaos.diablo!.y).toBeGreaterThanOrEqual(240);
      expect(w.chaos.diablo!.y).toBeLessThan(360);
      const bosses = w.chaos.seals.filter((x) => x.boss).map((x) => [x.objectId, x.boss!.superUnique]);
      expect(bosses).toEqual([[392, 36], [394, 37], [396, 38]]);
      const s392 = w.chaos.seals[0]!;
      expect(s392.boss).toMatchObject({ x: s392.x - 12, y: s392.y - 52 });
      // 봉인은 레벨 안, 날개 프리셋 4 개 (W/E/S/N)
      for (const x of w.chaos.seals) {
        expect(x.x).toBeGreaterThan(0);
        expect(x.x).toBeLessThan(600);
        expect(x.y).toBeGreaterThan(0);
        expect(x.y).toBeLessThan(600);
      }
      expect(w.chaos.wings.map((x) => x.prest).sort()).toEqual([PREST4.DIABLO_ARM_W, PREST4.DIABLO_ARM_E, PREST4.DIABLO_ARM_S, PREST4.DIABLO_ARM_N].sort());
      variants.add(JSON.stringify(w.chaos.wings));
    }
    expect(variants.size).toBeGreaterThan(1);
    // 엔진 레벨에도 봉인·디아블로 자리 오브젝트가 들어간다
    const cs = world.byKey.get('chaossanctuary')!.def;
    expect(cs.objects!.filter((o) => OBJ4.SEALS.includes(o.classId))).toHaveLength(5);
    expect(cs.objects!.filter((o) => o.classId === OBJ4.DIABLO_START)).toHaveLength(1);
  });

  // 출처: DRLGMAZE_PlaceAct4Lava — nAct4LavaForgeIds (Lava W → Forge W, Lava E → Forge E), objects.txt 376 Hellforge
  it('불꽃의 강: 헬포지 오브젝트가 있고 걸어서 닿는다', () => {
    for (const s of SEEDS) {
      const w = gen(s);
      expect(w.hellforge, `${s}`).not.toBeNull();
      expect(w.hellforge!.objectId).toBe(376);
    }
    const { arrival } = explore(world);
    const river = world.byKey.get('riverofflame')!.def;
    const seen = reachable(river, arrival.get('riverofflame')!);
    const f = river.objects!.find((o) => o.classId === OBJ4.HELLFORGE)!;
    let near = false;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (seen[(f.y + dy) * river.map.width + f.x + dx]) near = true;
    expect(near).toBe(true);
  });

  // 출처: levels.txt Waypoint (103: 27, 106: 28, 107: 29), objects.txt SubClass 64 (398 요새, 238 Act 4 웨이포인트)
  it('웨이포인트: 요새·저주받은 도시·불꽃의 강, 나머지 레벨에는 없음. 신전은 프리셋에서만', () => {
    for (const s of SEEDS) {
      const w = gen(s);
      const wp = (id: number) => w.levels.get(id)!.waypoint;
      expect(wp(LEVEL4.FORTRESS)?.objectId, `${s}`).toBe(398);
      expect(wp(LEVEL4.CITYOFTHEDAMNED)?.objectId, `${s}`).toBe(238);
      expect(wp(LEVEL4.RIVEROFFLAME)?.objectId, `${s}`).toBe(238);
      for (const id of [LEVEL4.OUTERSTEPPES, LEVEL4.PLAINSOFDESPAIR, LEVEL4.CHAOSSANCTUM]) expect(wp(id), `${s} ${id}`).toBeNull();
      expect([103, 106, 107].map((id) => data.level(id).waypoint)).toEqual([27, 28, 29]);
      // 도시의 웨이포인트는 강으로 가는 이동 지점 (Mesa Warp 프리셋) 근처
      const city = w.levels.get(LEVEL4.CITYOFTHEDAMNED)!;
      const warp = city.layout.warps.find((x) => x.toLevel === LEVEL4.RIVEROFFLAME)!;
      expect(Math.hypot(warp.x - wp(LEVEL4.CITYOFTHEDAMNED)!.x, warp.y - wp(LEVEL4.CITYOFTHEDAMNED)!.y)).toBeLessThan(45);
    }
    // 걸어서 웨이포인트에 닿는다
    const { arrival } = explore(world);
    for (const key of ['pandemonium', 'cityofthedamned', 'riverofflame']) {
      const def = world.byKey.get(key)!.def;
      const seen = reachable(def, arrival.get(key)!);
      const o = def.objects!.find((x) => x.classId === 238 || x.classId === 398)!;
      let near = false;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (seen[(o.y + dy) * def.map.width + o.x + dx]) near = true;
      expect(near, key).toBe(true);
    }
  });

  it('외부 초원의 요새 전환 프리셋이 플래그 셀 ((0,1) 또는 (0,4))에 놓인다', () => {
    for (const s of SEEDS) {
      const p = placeAct4(data, s);
      const w = gen(s);
      const og = w.levels.get(LEVEL4.OUTERSTEPPES)!.layout.outdoor!;
      const y = p.steppesFlag === 0x400000 ? 1 : 4;
      expect(og.grid[0].get(0, y), `${s}`).toBe(PREST4.FORTRESS_TRANSITION);
    }
  });

  it('브라우저 preload 목록(actWorldPaths 3)이 Act 4 DS1/DT1 을 모두 담고 전부 MPQ 에서 읽힌다', () => {
    const paths = actWorldPaths(gameChain(), tables, 3);
    // LvlSub 전체(확장팩 행 포함)는 world.ts 공용 규칙 — Act 4 경로만 읽기 확인
    for (const p of paths) if (/\\act4\\/i.test(p)) expect(gameChain().read(p), p).toBeTruthy();
    const set = new Set(paths.map((p) => p.toLowerCase()));
    for (const f of ['act4\\fort\\fortress.ds1', 'act4\\mesa\\warplava.ds1', 'act4\\lava\\forgew.ds1', 'act4\\diab\\heart.ds1', 'act4\\diab\\wingw2.ds1', 'act4\\mesa\\floor.dt1', 'act4\\lava\\floor.dt1', 'act4\\diab\\walls.dt1'])
      expect(set.has(`data\\global\\tiles\\${f}`), f).toBe(true);
    // 월드가 실제로 읽은 DS1 이 목록에 모두 있다
    const d = makeDrlgData(gameChain(), tables);
    generateAct4World(d, SEED);
    for (const f of d.files) expect(set.has(f.toLowerCase()), f).toBe(true);
  });
});
