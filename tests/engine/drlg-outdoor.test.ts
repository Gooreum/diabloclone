// Act 1 야외 DRLG 이식 검증 — 기대값은 원작 데이터 테이블(levels.txt/LvlPrest.txt)과 D2MOO 규칙에서 유도.
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { makeDrlgData } from '../../src/data/drlg-data';
import { buildAct1World, levelTypeDt1Paths, type Act1GameWorld } from '../../src/data/act1-world';
import { placeAct1, directionFromCoords, notOverlapping } from '../../src/engine/drlg/act1-link';
import { generateAct1World, edgeExits } from '../../src/engine/drlg/act1';
import { createVertices } from '../../src/engine/drlg/vertex';
import { DrlgGrid, Op, drawLine } from '../../src/engine/drlg/grid';
import { Vertex } from '../../src/engine/drlg/vertex';
import { Rng } from '../../src/engine/rng';
import { nearestWalkable } from '../../src/engine/path';
import { Game, type GameData, type LevelDef } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { LEVEL, PREST, type DrlgData } from '../../src/engine/drlg/types';
import { parseDt1 } from '../../src/formats/dt1';

describe('DRLG 기본 구성요소 (합성 입력)', () => {
  // 출처: D2Seed.h SEED_RollRandomNumber — lSeed = high + 0x6AC690C5 × low
  it('Rng.roll = 새 low (0x6AC690C5 × low + high 의 하위 32비트)', () => {
    const r = new Rng(1);
    expect(r.roll()).toBe((0x6ac690c5 + 666) >>> 0);
  });

  // 출처: DrlgDrlgVer.cpp DRLGVER_CreateVertices — 4 모서리 + 이웃 구간 꼭짓점 (bit0 = 연결, bit1 = 프리셋)
  it('createVertices: 동쪽(방향 2) 절반에 맞닿은 이웃 → 연결 꼭짓점 삽입, 로컬 좌표', () => {
    const v0 = createVertices({ x: 100, y: 200, w: 80, h: 80 }, [{ levelId: 9, dir: 2, preset: true, box: { x: 180, y: 240, w: 80, h: 80 } }]);
    const pts: string[] = [];
    let v = v0;
    do { pts.push(`${v.x},${v.y},${v.flags}`); v = v.next; } while (v !== v0);
    expect(pts).toEqual(['0,79,0', '0,0,0', '79,0,0', '79,40,3', '79,79,0']);
  });

  // 출처: DrlgDrlg.cpp DRLG_GetDirectionFromCoordinates
  it('directionFromCoords: 0=x 작은 쪽, 1=y 작은 쪽, 2=x 큰 쪽, 3=y 큰 쪽', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(directionFromCoords(a, { x: -5, y: 0, w: 5, h: 5 })).toBe(0);
    expect(directionFromCoords(a, { x: 0, y: -5, w: 5, h: 5 })).toBe(1);
    expect(directionFromCoords(a, { x: 10, y: 3, w: 5, h: 5 })).toBe(2);
    expect(directionFromCoords(a, { x: 3, y: 10, w: 5, h: 5 })).toBe(3);
    expect(directionFromCoords(a, { x: 30, y: 30, w: 5, h: 5 })).toBe(-1);
    expect(notOverlapping(a, { x: 10, y: 0, w: 5, h: 5 }, 0)).toBe(true);
    expect(notOverlapping(a, { x: 9, y: 0, w: 5, h: 5 }, 0)).toBe(false);
  });

  // 출처: DrlgDrlgGrid.cpp sub_6FD75F60 — 굵기 2 브레젠험 선
  it('drawLine: 가로 선은 y, y+1 두 줄', () => {
    const g = new DrlgGrid(6, 4);
    const a = new Vertex(0, 1), b = new Vertex(4, 1);
    a.nextOpen = b;
    drawLine(g, a, { x: 0, y: 0, w: 6, h: 4 }, 1, Op.OR, 2);
    const rows = [0, 1, 2, 3].map((y) => [0, 1, 2, 3, 4, 5].map((x) => g.get(x, y)).join(''));
    expect(rows).toEqual(['000000', '111110', '111110', '000000']);
  });

  it('edgeExits: 맞닿은 두 레벨의 출구는 양방향 대칭 (도착 좌표가 상대 레벨 로컬)', () => {
    const ex = edgeExits(1, { x: 0, y: 0, w: 10, h: 10 }, 2, { x: 10, y: 4, w: 10, h: 10 });
    expect(ex).toHaveLength(2);
    const [ab, ba] = ex as [NonNullable<(typeof ex)[0]>, NonNullable<(typeof ex)[0]>];
    expect(ab).toMatchObject({ from: 1, to: 2, x: 48, y: 20, w: 2, h: 30, dy: -20 });
    expect(ba).toMatchObject({ from: 2, to: 1, x: 0, y: 0, w: 2, h: 30, dy: 20 });
  });
});

describe.skipIf(!hasGameData)('Act 1 야외 DRLG (원작 데이터)', () => {
  let tables: GameTables, gameData: GameData, data: DrlgData, world: Act1GameWorld;
  const SEED = 1234;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    gameData = buildGameData(gameChain(), tables);
    data = makeDrlgData(gameChain(), tables);
    world = buildAct1World(gameChain(), tables, gameData, SEED);
  }, 60_000);

  // 출처: LevelsIds.h D2C_LvlPrestIds ↔ LvlPrest.txt Def
  it('프리셋 Def 상수가 LvlPrest.txt 이름과 일치', () => {
    expect(data.lvlPrest(PREST.TOWN_1_TRANSITION_E).name).toBe('Act 1 - Town 1 Transition E');
    expect(data.lvlPrest(PREST.WILD_BORDER_1).name).toBe('Act 1 - Wild Border 1');
    expect(data.lvlPrest(PREST.DOE_ENTRANCE).name).toBe('Act 1 - DOE Entrance');
    expect(data.lvlPrest(PREST.GRAVEYARD).name).toBe('Act 1 - Graveyard');
    expect(data.lvlPrest(PREST.CAIRN_STONES).name).toBe('Act 1 - Cairn Stones');
    expect(data.lvlPrest(PREST.TOWER_1).name).toBe('Act 1 - Tower 1');
  });

  it('같은 시드 → 같은 월드 (배치·타일·몬스터), 다른 시드 → 다른 배치', () => {
    const w2 = buildAct1World(gameChain(), tables, gameData, SEED);
    for (const l of world.levels) {
      const o = w2.byKey.get(l.key)!;
      expect(o.preset.floors.map((f) => f.tileIndex)).toEqual(l.preset.floors.map((f) => f.tileIndex));
      expect(o.def.spawns?.length).toBe(l.def.spawns?.length);
    }
    const layouts = new Set<string>();
    for (const s of [1, 2, 3, 4, 5, 6]) layouts.add(JSON.stringify([...placeAct1(data, s).levels.values()].map((l) => l.box)));
    expect(layouts.size).toBeGreaterThan(1);
  });

  // 출처: levels.txt SizeX/SizeY (Blood Moor 만 sub_6FD81950 이 방향에 따라 56×96 / 96×56 으로 바꾼다)
  it('모든 야외 레벨 크기 = levels.txt (Blood Moor 는 링커 규칙 56×96/96×56)', () => {
    for (let s = 1; s <= 8; s++) {
      const p = placeAct1(data, s);
      for (const id of [LEVEL.COLDPLAINS, LEVEL.STONYFIELD, LEVEL.DARKWOOD, LEVEL.BLACKMARSH, LEVEL.TAMOEHIGHLAND, LEVEL.BURIALGROUNDS]) {
        const rec = data.level(id);
        expect([p.levels.get(id)!.box.w, p.levels.get(id)!.box.h]).toEqual([rec.sizeX, rec.sizeY]);
      }
      const bm = p.levels.get(LEVEL.BLOODMOOR)!.box;
      expect([[56, 96], [96, 56]]).toContainEqual([bm.w, bm.h]);
    }
    for (const l of world.levels) {
      const box = world.world.levels.get(l.id)!.box;
      expect([l.preset.widthTiles, l.preset.heightTiles]).toEqual([box.w, box.h]);
    }
  });

  // 출처: sub_6FD823C0 (Rogue Encampment nDirection = 링크 방향) + LvlPrest "Act 1 - Town 1" File1~4 = TownN1/E1/S1/W1
  it('마을 프리셋 파일은 Blood Moor 쪽 방향으로 선택된다', () => {
    const FILE_SIDE = ['n', 'e', 's', 'w'];
    for (let s = 1; s <= 12; s++) {
      const w = generateAct1World(data, s, [LEVEL.ROGUEENCAMPMENT]);
      const town = w.placement.levels.get(LEVEL.ROGUEENCAMPMENT)!, bm = w.placement.levels.get(LEVEL.BLOODMOOR)!;
      const d = directionFromCoords(town.box, bm.box); // Blood Moor 가 마을의 어느 쪽인가
      // 방향 0 = x 작은 쪽(서), 1 = y 작은 쪽(북), 2 = x 큰 쪽(동), 3 = y 큰 쪽(남)
      const side = ['w', 'n', 'e', 's'][d];
      expect(FILE_SIDE[w.townFile]).toBe(side);
      expect(data.lvlPrest(1).file[w.townFile]!.toLowerCase()).toBe(`act1/town/town${side}1.ds1`);
    }
  });

  // 출처: levels.txt Waypoint 열 (255 = 없음) + DrlgOutWild.cpp (COLDPLAINS..BLACKMARSH 만 SpawnAct12Waypoint)
  it('웨이포인트는 levels.txt Waypoint 가 있는 야외 레벨에만 있다', () => {
    for (const id of [LEVEL.BLOODMOOR, LEVEL.COLDPLAINS, LEVEL.STONYFIELD, LEVEL.DARKWOOD, LEVEL.BLACKMARSH, LEVEL.TAMOEHIGHLAND]) {
      const has = data.level(id).waypoint !== 255;
      const lv = world.world.levels.get(id)!;
      expect(!!lv.waypoint, data.level(id).levelName).toBe(has);
      if (lv.waypoint) expect(data.objectSubClass(lv.waypoint.objectId) & 0x40).toBe(0x40);
    }
    expect([LEVEL.COLDPLAINS, LEVEL.STONYFIELD, LEVEL.DARKWOOD, LEVEL.BLACKMARSH].every((id) => data.level(id).waypoint !== 255)).toBe(true);
  });

  // 출처: DRLGOUTDOORS_SpawnAct12Shrines(pLevel, 5) — 신전/우물 셀 5 개 (LvlSub SubShrine 파일 오브젝트)
  it('야외 레벨마다 신전·우물 오브젝트가 배치된다', () => {
    for (const id of [LEVEL.BLOODMOOR, LEVEL.COLDPLAINS, LEVEL.STONYFIELD, LEVEL.DARKWOOD, LEVEL.BLACKMARSH, LEVEL.TAMOEHIGHLAND]) {
      expect(world.world.levels.get(id)!.shrines.length).toBeGreaterThanOrEqual(3);
    }
  });

  // 출처: levels.txt Vis/Warp (Blood Moor → Den of Evil, Cold Plains → Cave, Stony Field/Dark Wood → Underground Passage,
  //       Black Marsh → Forgotten Tower·Hole, Tamoe → Pit, Burial Grounds → Crypt·Mausoleum)
  it('동굴·탑·묘지 입구가 대상 레벨 id 와 함께 기록된다', () => {
    const to = (id: number) => world.world.levels.get(id)!.entrances.map((e) => e.toLevel).sort((a, b) => a - b);
    expect(to(LEVEL.BLOODMOOR)).toEqual([8]);
    expect(to(LEVEL.COLDPLAINS)).toEqual([9]);
    expect(to(LEVEL.STONYFIELD)).toEqual([10]);
    expect(to(LEVEL.DARKWOOD)).toEqual([10]);
    expect(to(LEVEL.BLACKMARSH)).toEqual([11, 20]);
    expect(to(LEVEL.TAMOEHIGHLAND)).toEqual([12]);
    expect(to(LEVEL.BURIALGROUNDS)).toEqual([18, 19]);
  });

  it('레벨이 참조하는 모든 타일이 그 레벨 LvlTypes DT1 집합(방 DT1 마스크 안)에서 발견된다', () => {
    for (const l of world.levels) {
      expect(l.preset.missing, l.key).toBe(0);
      expect(l.preset.maskFallback, l.key).toBe(0);
      const n = levelTypeDt1Paths(tables, data.level(l.id).levelType).filter((p) => p && gameChain().read(p)).map((p) => parseDt1(gameChain().read(p)!)).length;
      expect(n).toBeGreaterThan(0);
    }
  });

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

  it('출구는 걸어서 닿을 수 있고 상대 레벨의 걷기 가능한 곳으로 이어진다 — 마을에서 Tamoe Highland·Monastery Gate 까지 BFS', () => {
    const byKey = world.byKey;
    const visited = new Set<string>(['town']);
    const queue: { key: string; from: { x: number; y: number } }[] = [{ key: 'town', from: world.start }];
    while (queue.length) {
      const { key, from } = queue.shift()!;
      const lv = byKey.get(key)!;
      const seen = reachable(lv.def, from);
      const m = lv.def.map;
      for (const e of lv.def.exits) {
        // 출구 사각형 안의 도달 가능 서브타일
        let hit: { x: number; y: number } | null = null;
        for (let y = e.y; y < e.y + e.h && !hit; y++) for (let x = e.x; x < e.x + e.w && !hit; x++) if (m.walkable(x, y) && seen[y * m.width + x]) hit = { x, y };
        if (!hit || visited.has(e.to)) continue;
        const target = byKey.get(e.to)!;
        const tx = e.dx !== undefined ? hit.x + 0.5 + e.dx : e.toX, ty = e.dy !== undefined ? hit.y + 0.5 + e.dy : e.toY;
        const spot = nearestWalkable(target.def.map, { x: tx, y: ty }, 12);
        expect(spot, `${key} → ${e.to}`).not.toBeNull();
        visited.add(e.to);
        queue.push({ key: e.to, from: spot! });
      }
    }
    for (const k of ['bloodmoor', 'coldplains', 'stonyfield', 'burialgrounds', 'darkwood', 'blackmarsh', 'tamoe', 'monasterygate']) expect(visited.has(k), k).toBe(true);
  });

  it('게임 엔진: 마을에서 Blood Moor 출구로 걸어 나가면 전환되고, 되돌아오면 마을 (몬스터는 levels.txt 풀)', () => {
    const levels = world.levels.map((l) => l.def);
    const g = new Game({ map: new CollisionMap(1, 1), levels, player: { x: world.start.x, y: world.start.y, walkVelocity: 6, runVelocity: 9 }, seed: 1, data: gameData });
    const town = world.byKey.get('town')!.def;
    const exit = town.exits.find((e) => e.to === 'bloodmoor')!;
    const seen = reachable(town, world.start);
    let goal: { x: number; y: number } | null = null;
    for (let y = exit.y; y < exit.y + exit.h && !goal; y++) for (let x = exit.x; x < exit.x + exit.w && !goal; x++) if (seen[y * town.map.width + x]) goal = { x, y };
    expect(goal).not.toBeNull();
    g.changeLevel('town', goal!.x + 0.5, goal!.y + 0.5);
    g.tick();
    expect(g.levelId).toBe('bloodmoor');
    expect(g.monsters.length).toBeGreaterThan(10);
    for (const m of g.monsters) expect(['zombie1', 'fallen1', 'quillrat1']).toContain(m.type.id);
  });

  it('마을 시작 위치: 타일 정보(style 30, sequence 0) 기준 서브타일 +3 근처의 걷기 가능한 칸', () => {
    const t = world.byKey.get('town')!.def.map;
    expect(t.walkable(Math.floor(world.start.x), Math.floor(world.start.y))).toBe(true);
    const layout = world.world.levels.get(LEVEL.ROGUEENCAMPMENT)!.layout;
    const info = layout.tileInfo.find((i) => i.index === 0)!;
    expect(Math.hypot(world.start.x - (info.x * 5 + 3), world.start.y - (info.y * 5 + 3))).toBeLessThan(12);
  });
});
