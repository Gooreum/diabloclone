// Act 3 월드 DRLG (쿠라스트 부두 ~ 증오의 억류지 3층) 이식 검증.
// 기대값 출처: levels.txt (SizeX/SizeY·DrlgType·LevelType·Vis/Warp·Waypoint), LvlPrest.txt (Def·Name), LvlMaze.txt,
//             D2MOO DrlgOutPlace.cpp DRLGOUTPLACE_CreateLevelConnections (ACT_III), DRLG_GenerateJungles, DrlgOutJung.cpp, DrlgMaze.cpp (Act 3 분기)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { makeDrlgData } from '../../src/data/drlg-data';
import { actWorldPaths, buildActWorld, type ActWorld } from '../../src/data/world';
import { ACT_DRLG } from '../../src/engine/drlg/acts';
import { ACT3_ALL, ACT3_DUNGEONS, ACT3_OVERWORLD, generateAct3World, placeAct3 } from '../../src/engine/drlg/act3';
import { generateAct3MazeLevel } from '../../src/engine/drlg/act3-maze';
import { jungleNormalize, L3, LT3, P3 } from '../../src/engine/drlg/outjung';
import { notOverlapping } from '../../src/engine/drlg/act1-link';
import { DRLGTYPE, type DrlgData } from '../../src/engine/drlg/types';
import { nearestWalkable } from '../../src/engine/path';
import type { GameData, LevelDef } from '../../src/engine/game';

/** 넘어간 곳: 도착 = 가장 가까운 걷기 가능 칸 (엔진 Game.checkExits 와 같은 12 반경). 원작은 한 좌표계라 건너편이 막히면 넘지 못하므로 그런 칸은 세지 않는다 */
function crossTo(world: ActWorld, e: LevelDef['exits'][number], x: number, y: number): { x: number; y: number } | null {
  const target = world.byKey.get(e.to)!;
  const tx = e.dx !== undefined ? x + 0.5 + e.dx : e.toX, ty = e.dy !== undefined ? y + 0.5 + e.dy : e.toY;
  return nearestWalkable(target.def.map, { x: tx, y: ty }, 12);
}

/**
 * 퀘스트로 열리는 통로 (원작: 트라빈칼의 강요의 구슬을 칼림의 의지로 부숴야 증오의 억류지 계단이 열린다 — A3Q4).
 * 디버그 경로: 걸어서 BFS 할 때는 막고, 다 돈 뒤 "퀘스트 완료" 로 보고 이어 준다.
 */
const QUEST_GATED = new Set(['travincal>durance1']);

/**
 * 마을에서 출구를 따라가는 BFS (레벨마다 걸어서 닿은 영역을 넓혀 가며, 새로 닿은 곳의 출구로 넘어간다). debugBridge 이면 퀘스트 관문도 연다.
 * 반환: 레벨 key → 처음 도착한 지점, 지나간 (from → to) 간선
 */
function explore(world: ActWorld, debugBridge: boolean): { arrival: Map<string, { x: number; y: number }>; edges: Set<string> } {
  const arrival = new Map<string, { x: number; y: number }>();
  const seenOf = new Map<string, Uint8Array>();
  const edges = new Set<string>();
  const queue: string[] = [];
  const pending: { from: string; to: string; p: { x: number; y: number } }[] = [];
  // 걸어서 닿는 영역 넓히기 (새 영역이면 출구 검사 대기열에)
  const arrive = (key: string, p: { x: number; y: number }) => {
    const m = world.byKey.get(key)!.def.map;
    let seen = seenOf.get(key);
    if (!seen) seenOf.set(key, (seen = new Uint8Array(m.width * m.height)));
    const s = nearestWalkable(m, p, 12);
    if (!s || seen[s.y * m.width + s.x]) return;
    if (!arrival.has(key)) arrival.set(key, { x: s.x + 0.5, y: s.y + 0.5 });
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
    queue.push(key);
  };
  arrive(world.townId, world.start);
  for (;;) {
    while (queue.length) {
      const key = queue.shift()!;
      const def = world.byKey.get(key)!.def, m = def.map, seen = seenOf.get(key)!;
      for (const e of def.exits) {
        const gated = QUEST_GATED.has(`${key}>${e.to}`);
        for (let y = e.y; y < e.y + e.h; y++)
          for (let x = e.x; x < e.x + e.w; x++) {
            if (!m.walkable(x, y) || !seen[y * m.width + x]) continue;
            const to = crossTo(world, e, x, y);
            if (!to) continue;
            if (gated) pending.push({ from: key, to: e.to, p: to });
            else {
              edges.add(`${key}>${e.to}`);
              arrive(e.to, to);
            }
          }
      }
    }
    // 디버그 경로: 퀘스트 관문 (칼림의 의지로 구슬을 부순 것으로 본다)
    if (!debugBridge || !pending.length) break;
    for (const p of pending.splice(0)) {
      edges.add(`${p.from}>${p.to}`);
      arrive(p.to, p.p);
    }
  }
  return { arrival, edges };
}

const d = hasGameData ? describe : describe.skip;

d('Act 3 월드 DRLG (원작 데이터)', () => {
  let tables: GameTables, gameData: GameData, data: DrlgData, world: ActWorld;
  const SEED = 1234;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    gameData = buildGameData(gameChain(), tables);
    data = makeDrlgData(gameChain(), tables);
    world = buildActWorld(gameChain(), tables, gameData, SEED, 2);
  }, 120_000);

  // 출처: LevelsIds.h D2C_LvlPrestIds ↔ LvlPrest.txt Def
  it('Act 3 프리셋 Def 상수가 LvlPrest.txt 이름과 일치', () => {
    const name = (x: number) => data.lvlPrest(x).name;
    expect(name(P3.TOWN)).toBe('Act 3 - Town');
    expect(name(P3.TOWN + 1)).toBe('Act 3 - Jungle W');
    expect(name(P3.JUNGLE_W_E)).toBe('Act 3 - Jungle W E');
    expect(name(P3.JUNGLE_NSE_W)).toBe('Act 3 - Jungle NSE W');
    expect(name(P3.JUNGLE_HEAD)).toBe('Act 3 - Jungle Head');
    expect(name(P3.JUNGLE_TAIL)).toBe('Act 3 - Jungle Tail');
    expect(name(P3.CLEARING_WEBBY_W)).toBe('Act 3 - Clearing Webby W');
    expect(name(P3.CLEARING_WEBBY_W + 10)).toBe('Act 3 - Clearing Boggy W');
    expect(name(P3.CLEARING_WEBBY_W + 20)).toBe('Act 3 - Clearing Pygmy W');
    expect(name(P3.SLUMS_BORDER_N)).toBe('Act 3 - Slums Border N');
    expect(name(P3.SLUMS_BORDER_N + 8)).toBe('Act 3 - Slums Gate N');
    expect(name(P3.BURBS_WAYPOINT)).toBe('Act 3 - Burbs Waypoint');
    expect(name(P3.METRO_BORDER_S + 8)).toBe('Act 3 - Metro Gate S');
    expect(name(P3.BRIDGE)).toBe('Act 3 - Bridge');
    expect(name(P3.TRAVINCAL_SE)).toBe('Act 3 - Travincal SE');
    expect(name(P3.SPIDER_CHEST_NE)).toBe('Act 3 - Spider Chest NE');
    expect(name(P3.SPIDER_CHEST_NE + 1)).toBe('Act 3 - Dungeon W');
    expect(name(P3.DUNGEON_PREV_W)).toBe('Act 3 - Dungeon Prev W');
    expect(name(P3.DUNGEON_TREASURE_2 + 1)).toBe('Act 3 - Sewer W');
    expect(name(P3.SEWER_PREV_NE)).toBe('Act 3 - Sewer Prev NE');
    expect(name(P3.SEWER_CHEST_W)).toBe('Act 3 - Sewer Chest W');
    expect(name(P3.TEMPLE_6 + 1)).toBe('Act 3 - Mephisto W');
    expect(name(P3.MEPHISTO_WAYPOINT_W)).toBe('Act 3 - Mephisto Waypoint W');
    expect(name(P3.MEPHISTO_NEXT_W + 3)).toBe('Act 3 - Mephisto Next N');
  });

  // 출처: levels.txt 75~102 (Act 칸 2), DrlgType (1 미로·2 프리셋·3 야외)
  it('등록표: Act 3 레벨 28 개 · 마을 = 쿠라스트 부두 · 종류가 levels.txt 와 일치', () => {
    expect(ACT_DRLG[2]!.town).toBe(L3.KURASTDOCKTOWN);
    expect(ACT3_ALL).toHaveLength(28);
    for (const id of ACT3_ALL) expect(data.level(id).act, String(id)).toBe(2);
    for (const id of ACT3_OVERWORLD.slice(1)) expect(data.level(id).drlgType).toBe(DRLGTYPE.OUTDOOR);
    expect(data.level(L3.KURASTDOCKTOWN).drlgType).toBe(DRLGTYPE.PRESET);
    const mazes = ACT3_DUNGEONS.filter((id) => data.level(id).drlgType === DRLGTYPE.MAZE);
    expect(mazes).toEqual([84, 85, 86, 87, 88, 89, 92, 100, 101]);
    expect(world.levels.map((l) => l.id).sort((a, b) => a - b)).toEqual([...ACT3_ALL].sort((a, b) => a - b));
  });

  it('결정성: 같은 시드 → 같은 배치·정글 블록·타일, 다른 시드 → 다른 정글', () => {
    const a = generateAct3World(data, SEED), b = generateAct3World(data, SEED);
    for (const id of ACT3_ALL) {
      expect(b.levels.get(id)!.box).toEqual(a.levels.get(id)!.box);
      expect(Array.from(b.levels.get(id)!.layout.tileMask)).toEqual(Array.from(a.levels.get(id)!.layout.tileMask));
    }
    expect(b.placement.jungles).toEqual(a.placement.jungles);
    const w2 = buildActWorld(gameChain(), tables, gameData, SEED, 2);
    for (const l of world.levels) expect(w2.byKey.get(l.key)!.preset.walls.map((t) => t.tileIndex), l.key).toEqual(l.preset.walls.map((t) => t.tileIndex));
    const layouts = new Set<string>();
    for (const s of [1, 12, 1000, 55555, 987654321]) {
      const p = placeAct3(data, s);
      layouts.add(JSON.stringify([...p.jungles.values()].map((j) => j.defs)) + JSON.stringify([...p.levels.values()].filter((l) => l.id <= 83).map((l) => l.box)));
    }
    expect(layouts.size).toBeGreaterThan(1);
  });

  // 출처: DRLGOUTPLACE_CreateLevelConnections (ACT_III) — 정글은 부두 북쪽, 쿠라스트 5 개는 불꽃 강 정글 위로 쌓고 가운데 정렬
  it('배치: 레벨 크기 = levels.txt, 정글 3 개는 겹치지 않고 거미 숲이 부두에 맞닿으며 쿠라스트가 차례로 쌓인다', () => {
    for (const s of [SEED, 7, 99, 31337]) {
      const p = placeAct3(data, s);
      const box = (id: number) => p.levels.get(id)!.box;
      for (const id of ACT3_OVERWORLD) expect([box(id).w, box(id).h], String(id)).toEqual([data.level(id).sizeX, data.level(id).sizeY]);
      const t = box(L3.KURASTDOCKTOWN);
      expect(t).toMatchObject({ x: 1000, y: 1000 });
      expect(box(L3.SPIDERFOREST)).toMatchObject({ x: t.x, y: t.y - 192 });
      for (const i of [76, 77, 78]) for (const j of [76, 77, 78]) if (i < j) expect(notOverlapping(box(i), box(j), 0)).toBe(true);
      // 원작: nPosY 큰 순 (거미 숲 ≥ 거대 늪 ≥ 불꽃 강 정글)
      expect(box(76).y).toBeGreaterThanOrEqual(box(77).y);
      expect(box(77).y).toBeGreaterThanOrEqual(box(78).y);
      const fj = box(L3.FLAYERJUNGLE);
      let y = fj.y;
      for (let id = L3.LOWERKURAST; id <= L3.TRAVINCAL; id++) {
        y -= data.level(id).sizeY;
        expect(box(id)).toEqual({ x: fj.x + 32 - Math.trunc(data.level(id).sizeX / 2), y, w: data.level(id).sizeX, h: data.level(id).sizeY });
      }
      // 부두·쿠라스트 링크 (warp −1 = 가장자리)
      const lk = (a: number, b: number) => p.levels.get(a)!.vis.some((v, k) => v === b && p.levels.get(a)!.warp[k] === -1);
      expect(lk(75, 76) && lk(76, 75)).toBe(true);
      expect(lk(78, 79) && lk(79, 80) && lk(80, 81) && lk(81, 82) && lk(82, 83)).toBe(true);
      // levels.txt Vis/Warp 로 이어지는 던전 입구는 그대로
      expect(p.levels.get(76)!.vis.slice(0, 2)).toEqual([84, 85]);
      expect(p.levels.get(83)!.vis[0]).toBe(100);
    }
  });

  // 출처: DRLG_GenerateJungles — 블록 2×6, 공터(>JUNGLE_TAIL) 는 2~3 개, 머리/꼬리 프리셋
  it('정글 블록: 레벨마다 2×6, 연결점(공터) 2~3 개, 정규화 표 (gJunglePresets / gSpiderForestPresets)', () => {
    expect(jungleNormalize(0)).toBe(0);
    expect(jungleNormalize(5)).toBe(P3.TOWN + 5);
    expect(jungleNormalize(1 | (2 << 4))).toBe(P3.JUNGLE_W_E);
    expect(jungleNormalize(1 << 4)).toBe(P3.CLEARING_WEBBY_W);
    for (const s of [SEED, 1, 7, 99, 31337, 987654321]) {
      const p = placeAct3(data, s);
      expect([...p.jungles.keys()]).toEqual([76, 77, 78]);
      for (const [id, j] of p.jungles) {
        expect(j.defs, `${id} seed ${s}`).toHaveLength(12);
        expect(j.clearings, `${id} seed ${s}`).toBeGreaterThanOrEqual(1);
        expect(j.clearings, `${id} seed ${s}`).toBeLessThanOrEqual(4);
        for (const v of j.defs) if (v) expect(data.lvlPrest(v).name).toMatch(/^Act 3 - (Jungle|Clearing Webby)/);
      }
    }
    const sf = world.byKey.get('spiderforest')!;
    expect([sf.preset.widthTiles, sf.preset.heightTiles]).toEqual([64, 192]);
  });

  // 출처: DrlgMaze.cpp — 방 크기 LvlMaze SizeX×SizeY, 레벨 크기는 levels.txt 안, 특수 방
  it('미로: 방 수·크기 규칙, 레벨 크기가 levels.txt 안, 특수 방(이전/다음·배수구·상자·웨이포인트)', () => {
    for (const s of [SEED, 7, 99]) {
      const p = placeAct3(data, s);
      for (const id of [84, 85, 86, 87, 88, 89, 92, 100, 101]) {
        const m = data.lvlMaze(id);
        const lv = generateAct3MazeLevel(data, p, id);
        expect(lv.mazeRooms.length, `${id} seed ${s}`).toBeGreaterThanOrEqual(data.level(id).levelType === LT3.SPIDER ? 4 : m.rooms);
        for (const r of lv.mazeRooms) expect([r.box.w, r.box.h]).toEqual([m.sizeX, m.sizeY]);
        const n = lv.mazeRooms.length;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(notOverlapping(lv.mazeRooms[i]!.box, lv.mazeRooms[j]!.box, 0)).toBe(true);
        expect(lv.box.w - 1).toBeLessThanOrEqual(data.level(id).sizeX);
        expect(lv.box.h - 1).toBeLessThanOrEqual(data.level(id).sizeY);
      }
      const has = (id: number, first: number) => generateAct3MazeLevel(data, p, id).mazeRooms.filter((r) => r.prest >= first && r.prest < first + 4).length;
      for (const id of [86, 87, 88, 89]) {
        expect(has(id, P3.DUNGEON_PREV_W), `${id}`).toBe(1);
        expect(has(id, P3.DUNGEON_NEXT_W), `${id}`).toBe(1);
      }
      expect(has(92, P3.SEWER_PREV_SW)).toBe(4);
      expect(has(92, P3.SEWER_DRAIN_W)).toBe(1);
      expect(has(92, P3.SEWER_CHEST_W)).toBe(1);
      expect(has(100, P3.MEPHISTO_PREV_W)).toBe(1);
      expect(has(100, P3.MEPHISTO_NEXT_W)).toBe(1);
      expect(has(101, P3.MEPHISTO_WAYPOINT_W)).toBe(1);
      expect(has(101, P3.MEPHISTO_NEXT_W)).toBe(1);
      // 거미 동굴: 대각선 방 4 개 (+ 상자 방)
      expect(generateAct3MazeLevel(data, p, L3.SPIDERCAVE).mazeRooms.some((r) => r.prest === P3.SPIDER_CHEST_NE)).toBe(true);
      expect(generateAct3MazeLevel(data, p, L3.SPIDERCAVERN).mazeRooms.some((r) => r.prest === P3.SPIDER_CHEST_NW)).toBe(true);
    }
  });

  it('프리셋 레벨 크기: 부두·사원 6·하수도 2·보물 방·메피스토 방 = levels.txt SizeX/SizeY', () => {
    for (const l of world.levels) {
      const rec = data.level(l.id);
      if (rec.drlgType === DRLGTYPE.MAZE) continue;
      expect([l.preset.widthTiles, l.preset.heightTiles], l.key).toEqual([rec.sizeX, rec.sizeY]);
    }
  });

  // 출처: DRLGROOMTILE_LoadDT1FilesForRoom — 방 DT1 마스크 비트 = LvlTypes File N
  // 근사(원작 미확인): 정글의 빈 블록(Def 0) 야외 방은 원작 마스크 0x04(DarkMud) 에 없는 바닥(style 1 = DarkGrass)을 쓴다.
  //   원작 타일 라이브러리는 막 단위로 누적되어 앞서 읽은 DarkGrass 에서 찾는 것으로 보고 마스크 밖 폴백을 그 방에만 허용한다.
  it('모든 Act 3 타일이 LvlTypes DT1 에서 발견되고, 마스크 밖 폴백은 정글 빈 블록 방에만 — 여러 시드', () => {
    const worlds = [world, buildActWorld(gameChain(), tables, gameData, 4321, 2), buildActWorld(gameChain(), tables, gameData, 99, 2)];
    for (const w of worlds)
      for (const l of w.levels) {
        expect(l.preset.missing, l.key).toBe(0);
        expect(l.preset.floors.length, l.key).toBeGreaterThan(0);
        expect(l.preset.walls.length, l.key).toBeGreaterThan(0);
        if (data.level(l.id).levelType !== LT3.JUNGLE) expect(l.preset.maskFallback, l.key).toBe(0);
      }
    const j = generateAct3World(data, 4321);
    for (const id of [76, 77, 78]) {
      const lv = j.levels.get(id)!;
      const filler = lv.layout.rooms.filter((r) => r.prest === 0).length;
      const wl = worlds[1]!.byKey.get(['spiderforest', 'greatmarsh', 'flayerjungle'][id - 76]!)!;
      expect(wl.preset.maskFallback, String(id)).toBeLessThanOrEqual(filler * 64);
    }
  });

  it('BFS: 쿠라스트 부두에서 걸어서 Act 3 모든 레벨 도달 (퀘스트 관문 트라빈칼 → 억류지는 디버그 경로로 이음) — 여러 시드', () => {
    for (const w of [world, buildActWorld(gameChain(), tables, gameData, 7, 2), buildActWorld(gameChain(), tables, gameData, 31337, 2)]) {
      // 퀘스트 관문을 열지 않으면 억류지 1~3 층에는 가지 못한다
      const walk = explore(w, false);
      for (const k of ['durance1', 'durance2', 'durance3']) expect(walk.arrival.has(k), k).toBe(false);
      const { arrival, edges } = explore(w, true);
      for (const l of w.levels) expect(arrival.has(l.key), l.key).toBe(true);
      for (const e of [
        'kurastdocks>spiderforest', 'spiderforest>kurastdocks', 'spiderforest>spidercave', 'spidercave>spiderforest', 'spiderforest>spidercavern',
        'flayerjungle>swampypit1', 'swampypit1>swampypit2', 'swampypit2>swampypit3', 'swampypit3>swampypit2', 'flayerjungle>flayerdungeon1',
        'flayerdungeon1>flayerdungeon2', 'flayerdungeon2>flayerdungeon3', 'flayerjungle>lowerkurast', 'lowerkurast>kurastbazaar',
        'kurastbazaar>upperkurast', 'kurastbazaar>ruinedtemple', 'kurastbazaar>disusedfane', 'kurastbazaar>kurastsewers1', 'kurastsewers1>kurastsewers2',
        'upperkurast>forgottenreliquary', 'upperkurast>forgottentemple', 'upperkurast>kurastcauseway', 'kurastcauseway>ruinedfane',
        'kurastcauseway>disusedreliquary', 'kurastcauseway>travincal', 'travincal>durance1', 'durance1>durance2', 'durance2>durance3', 'durance3>durance2',
      ]) expect(edges.has(e), e).toBe(true);
    }
  });

  // 출처: levels.txt Waypoint (255 = 없음) — Act 3: 부두·거미 숲·거대 늪·불꽃 강 정글·하부/시장/상부 쿠라스트·트라빈칼·억류지 2
  it('웨이포인트: levels.txt Waypoint 레벨마다 웨이포인트 오브젝트가 있고, 없는 레벨에는 없다 — 여러 시드', () => {
    const wp = ACT3_ALL.filter((id) => data.level(id).waypoint !== 255);
    expect(wp).toEqual([75, 76, 77, 78, 79, 80, 81, 83, 101]);
    for (const s of [SEED, 7, 99, 31337]) {
      const w = generateAct3World(data, s);
      for (const id of ACT3_ALL) expect(w.levels.get(id)!.waypoint !== null, `${data.level(id).levelName} seed ${s}`).toBe(wp.includes(id));
    }
    // 엔진 레벨에도 웨이포인트 오브젝트
    for (const id of wp) {
      const l = world.levels.find((x) => x.id === id)!;
      expect(l.def.objects!.some((o) => (data.objectSubClass(o.classId) & 0x40) !== 0), l.key).toBe(true);
    }
  });

  it('브라우저 preload 목록(actWorldPaths)이 Act 3 월드가 읽는 DS1/DT1 을 모두 담고 전부 MPQ 에서 읽힌다', () => {
    const paths = actWorldPaths(gameChain(), tables, 2);
    const set = new Set(paths.map((p) => p.toLowerCase()));
    // 공용 목록은 LvlSub 전체(확장팩 행 포함 — 클래식 MPQ 에 없으면 null 로 캐시)를 담는다. Act 3 파일은 모두 읽혀야 한다
    for (const p of paths) if (/\\act3\\/i.test(p)) expect(gameChain().read(p), p).toBeTruthy();
    const d2 = makeDrlgData(gameChain(), tables);
    generateAct3World(d2, SEED);
    for (const f of d2.files) expect(set.has(f.toLowerCase()), f).toBe(true);
  });
});
