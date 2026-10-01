// 확장팩 Act 5 DRLG (Harrogath ~ Worldstone Chamber) 이식 검증. 확장팩 MPQ 체인 (game-data/lod/patch_d2 + d2exp) 이 있어야 실행된다.
// 기대값 출처: 확장팩 levels.txt (109~132 DrlgType/LevelType/SizeX/SizeY/OffsetX/OffsetY/Vis/Warp/Waypoint), LvlMaze.txt, LvlPrest.txt (863~1089),
//             D2MOO DrlgOutPlace.cpp gAct5OutdoorDrlgLink / gAct5TundraDrlgLink, DrlgOutRoom.cpp (64×160 · 160×64), DrlgOutSiege.cpp, DrlgMaze.cpp
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { GAME_DATA } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { makeDrlgData } from '../../src/data/drlg-data';
import { actWorldPaths, buildActWorld, levelKey, type ActWorld } from '../../src/data/world';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { ACT5_ALL, LEVEL5, generateAct5World, placeAct5, type Act5World } from '../../src/engine/drlg/act5';
import { PREST5 } from '../../src/engine/drlg/act5-ids';
import { ACT_DRLG } from '../../src/engine/drlg/acts';
import { DRLGTYPE, type DrlgData } from '../../src/engine/drlg/types';
import { nearestWalkable } from '../../src/engine/path';
import type { GameData, LevelDef } from '../../src/engine/game';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));
let chain: MpqChain;

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

/** 마을 도착 위치에서 걸어서 갈 수 있는 출구만 따라가는 BFS (가장자리·워프 출구) */
function explore(world: ActWorld): { arrival: Map<string, { x: number; y: number }>; edges: Set<string> } {
  const arrival = new Map<string, { x: number; y: number }>([[world.townId, world.start]]);
  const edges = new Set<string>();
  const queue = [world.townId];
  while (queue.length) {
    const key = queue.shift()!;
    const lv = world.byKey.get(key)!;
    const seen = reachable(lv.def, arrival.get(key)!);
    for (const e of lv.def.exits) {
      let hit: { x: number; y: number } | null = null;
      for (let y = e.y; y < e.y + e.h && !hit; y++) for (let x = e.x; x < e.x + e.w && !hit; x++) if (lv.def.map.walkable(x, y) && seen[y * lv.def.map.width + x]) hit = { x, y };
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

function digest(w: Act5World): string {
  const out: string[] = [];
  for (const l of w.levels.values()) {
    let h = 0;
    for (const layer of [...l.layout.ds1.floors, ...l.layout.ds1.walls]) for (const c of layer) h = (Math.imul(h, 31) + c.prop1 * 7 + c.style * 131 + c.sequence * 17 + c.orientation) | 0;
    out.push(`${l.id}:${JSON.stringify(l.box)}:${h}:${l.layout.units.map((u) => `${u.type}/${u.id}@${u.x},${u.y}`).join(';')}`);
  }
  return out.join('\n');
}

describe.skipIf(!hasLod)('Act 5 DRLG (확장팩 원작 데이터)', () => {
  let tables: GameTables, gameData: GameData, data: DrlgData;
  const SEEDS = [1, 7, 4242, 12345, 0xdeadbeef];
  const worlds = new Map<number, Act5World>();
  const gen = (s: number) => {
    let w = worlds.get(s);
    if (!w) worlds.set(s, (w = generateAct5World(data, s)));
    return w;
  };
  beforeAll(() => {
    chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
    tables = new GameTables(chain);
    gameData = buildGameData(chain, tables, { expansion: true });
    data = makeDrlgData(chain, tables);
  }, 180_000);

  describe('배치', () => {
    it('Act 5 프리셋 Def 상수가 LvlPrest.txt 이름과 일치', () => {
      const name = (d: number) => data.lvlPrest(d).name.replace(/\s+/g, ' ').trim();
      expect(name(PREST5.TOWN)).toBe('Act 5 - Town');
      expect(name(PREST5.SIEGE_TO_TOWN)).toBe('Act 5 - Siege To Town');
      expect(name(PREST5.BARRICADE_TO_SIEGE)).toBe('Act 5 - Barricade To Siege');
      expect(name(PREST5.CLIFF_BORDER_1)).toBe('Act 5 - Barricade Cliff Border 1');
      expect(name(PREST5.RAVINE_BORDER_1)).toBe('Act 5 - Barricade Ravine Border 1');
      expect(name(PREST5.PRISON_1)).toBe('Act 5 - Barricade Prison 1');
      expect(name(PREST5.HELL_PORTAL_N)).toBe('Act 5 - Barricade Hell Portal N');
      expect(name(PREST5.CLIFF_BORDER_1_SNOW)).toBe('Act 5 - Barricade Cliff Border 1 Snow');
      expect(name(PREST5.BARRICADE_16_SNOW)).toBe('Act 5 - Barricade 16 Snow');
      expect(name(PREST5.ICE_W)).toBe('Act 5 - Ice W');
      expect(name(PREST5.ICE_WAYPOINT_N)).toBe('Act 5 - Ice waypoint N');
      expect(name(PREST5.ICE_POOL_B)).toBe('Act 5 - Ice Pool B');
      expect(name(PREST5.TEMPLE_NE)).toBe('Act 5 - Temple NE');
      expect(name(PREST5.TEMPLE_SW_WAYPOINT)).toBe('Act 5 - Temple SW Waypoint');
      expect(name(PREST5.LAVA_N)).toBe('Act 5 - Lava N');
      expect(name(PREST5.BAAL_W)).toBe('Act 5 - Baal W');
      expect(name(PREST5.BAAL_PREV_NEW)).toBe('Act 5 - Baal Prev NEW');
      expect(name(PREST5.BAAL_WAYPOINT_W)).toBe('Act 5 - Baal Waypoint W');
      expect(name(PREST5.BAAL_ENTRANCE)).toBe('Act 5 - Baal Entrance');
    });

    it('ACT_DRLG[4] 에 등록, 마을 Harrogath, 레벨 24 개', () => {
      expect(ACT_DRLG[4]?.town).toBe(LEVEL5.HARROGATH);
      expect(ACT_DRLG[4]?.levels).toEqual(ACT5_ALL);
      expect(ACT5_ALL).toHaveLength(24);
      expect([109, 110, 111, 112, 117].map((id) => data.level(id).drlgType)).toEqual([DRLGTYPE.PRESET, DRLGTYPE.OUTDOOR, DRLGTYPE.OUTDOOR, DRLGTYPE.OUTDOOR, DRLGTYPE.OUTDOOR]);
    });

    // 출처: gAct5OutdoorDrlgLink — Harrogath·Bloody Foothills 는 levels.txt 위치, Frigid Highlands 는 Foothills 왼쪽(아래 끝 16 위),
    //       Arreat Plateau 는 Highlands 기준 어긋남 표, Frozen Tundra 는 levels.txt 위치 (모두 64×160 또는 160×64)
    it('야외 배치: 여러 시드에서 상자·맞닿음·vis 가 원작 규칙대로', () => {
      const orient = new Set<string>();
      for (const s of SEEDS) {
        const p = placeAct5(data, s);
        const box = (id: number) => p.levels.get(id)!.box;
        expect(box(109)).toEqual({ x: 1000, y: 1000, w: 40, h: 40 });
        expect(box(110)).toEqual({ x: 760, y: 1000, w: 240, h: 48 });
        const hi = box(111), pl = box(112), tu = box(117);
        for (const b of [hi, pl, tu]) expect([`64x160`, `160x64`]).toContain(`${b.w}x${b.h}`);
        expect(hi.x + hi.w).toBe(760);
        expect(hi.y + hi.h).toBe(1032);
        expect({ x: tu.x, y: tu.y }).toEqual({ x: 2000, y: 1896 });
        orient.add(`${hi.w}/${pl.w}`);
        // sub_6FD826D0: 맞닿은 쌍만 vis (warp −1)
        const vis = (a: number, b: number) => p.levels.get(a)!.vis.some((v, k) => v === b && p.levels.get(a)!.warp[k] === -1);
        expect(vis(109, 110) && vis(110, 109) && vis(110, 111) && vis(111, 110) && vis(111, 112) && vis(112, 111), `${s}`).toBe(true);
        expect(vis(109, 111)).toBe(false);
        // Frigid Highlands 의 orth 는 Arreat Plateau 만 (82750 은 Foothills 등록 전)
        expect(p.levels.get(111)!.orths.map((o) => o.levelId)).toEqual([112]);
      }
      expect(orient.size).toBeGreaterThan(1);
    });

    it('Harrogath: 웨이포인트 프리셋, 결정적', () => {
      for (const s of [1, 12345]) {
        const a = generateAct5World(data, s, [109]), b = generateAct5World(data, s, [109]);
        expect(digest(a)).toBe(digest(b));
        expect(a.levels.get(109)!.waypoint).not.toBeNull();
      }
    });
  });

  describe('야외', () => {
    it('Bloody Foothills: 공성 띠 15 개 (마을 쪽 Siege To Town ~ 왼쪽 Siege To Barricade)', () => {
      const og = gen(1).levels.get(110)!.layout.outdoor!;
      expect(og.gw).toBe(30);
      expect(og.grid[0].get(28, 0)).toBe(PREST5.SIEGE_TO_TOWN);
      expect(og.grid[0].get(0, 0)).toBe(PREST5.SIEGE_TO_TOWN + 14);
    });

    it('Frigid Highlands: 감옥 3 개 (A5Q2), Bloody Foothills 연결 프리셋, 지옥 포털', () => {
      for (const s of SEEDS) {
        const og = gen(s).levels.get(111)!.layout.outdoor!;
        const all: number[] = [];
        for (let j = 0; j < og.gh; j++) for (let i = 0; i < og.gw; i++) all.push(og.grid[0].get(i, j));
        expect(all.filter((p) => p >= PREST5.PRISON_1 && p < PREST5.PRISON_1 + 8).length, `${s}`).toBe(3);
        expect(all.filter((p) => p === PREST5.BARRICADE_TO_SIEGE)).toHaveLength(1);
        expect(all.filter((p) => p === PREST5.HELL_PORTAL_N || p === PREST5.HELL_PORTAL_W)).toHaveLength(1);
      }
    });

    it('Arreat Plateau·Frozen Tundra: 동굴 입구 워프·웨이포인트, Tundra 는 눈 테두리', () => {
      for (const s of SEEDS) {
        const w = gen(s);
        expect(w.levels.get(112)!.layout.warps.map((x) => x.toLevel), `${s}`).toContain(113);
        expect(w.levels.get(117)!.layout.warps.map((x) => x.toLevel).sort(), `${s}`).toEqual([115, 118]);
        expect(w.levels.get(112)!.waypoint).not.toBeNull();
        expect(w.levels.get(117)!.waypoint).not.toBeNull();
        const og = w.levels.get(117)!.layout.outdoor!;
        let snowBorder = 0;
        for (let j = 0; j < og.gh; j++) for (let i = 0; i < og.gw; i++) {
          const p = og.grid[0].get(i, j);
          if (p >= PREST5.CLIFF_BORDER_1_SNOW && p <= PREST5.RAVINE_BORDER_1_SNOW + 11) snowBorder++;
        }
        expect(snowBorder).toBeGreaterThan(0);
      }
    });
  });

  describe('전체 월드', () => {
    it('24 개 레벨 모두 생성, 결정적, 다른 시드는 다르다', () => {
      for (const s of [1, 12345]) {
        const w = gen(s);
        expect([...w.levels.keys()].sort((a, b) => a - b)).toEqual([...ACT5_ALL]);
        expect(digest(generateAct5World(data, s))).toBe(digest(w));
      }
      expect(digest(gen(1))).not.toBe(digest(gen(12345)));
    });

    // 출처: levels.txt Waypoint — 109(30) 111(31) 112(32) 113(33) 115(34) 117(36) 118(37) 123(35) 129(38)
    it('웨이포인트: 원작 9 곳에만', () => {
      const WP = [109, 111, 112, 113, 115, 117, 118, 123, 129];
      for (const s of SEEDS) {
        const w = gen(s);
        for (const id of ACT5_ALL) expect(!!w.levels.get(id)!.waypoint, `${s} ${id}`).toBe(WP.includes(id));
      }
      expect(WP.map((id) => data.level(id).waypoint)).toEqual([30, 31, 32, 33, 34, 36, 37, 35, 38]);
    });

    it('미로 방: 얼음 동굴 이전/다음/아래층 계단, 월드스톤 킵 다음 층 계단, 신전 아래층, 지옥 구덩이 용암 한 벌', () => {
      for (const s of SEEDS) {
        const w = gen(s);
        const warps = (id: number) => w.levels.get(id)!.layout.warps.map((x) => x.toLevel).sort((a, b) => a - b);
        expect(warps(113), `${s}`).toEqual([112, 114, 115]);
        expect(warps(115), `${s}`).toEqual([113, 116, 117]);
        expect(warps(118), `${s}`).toEqual([117, 119, 120]);
        expect(warps(128)).toEqual([120, 129]);
        expect(warps(129)).toEqual([128, 130]);
        expect(warps(130)).toEqual([129, 131]);
        expect(warps(122)).toEqual([121, 123]);
        expect(warps(123)).toEqual([122, 124]);
        const rooms = (id: number) => (w.levels.get(id)!.layout as unknown as { mazeRooms: { prest: number }[] }).mazeRooms;
        for (const id of [125, 126, 127]) expect(rooms(id).filter((r) => r.prest >= PREST5.LAVA_N && r.prest <= PREST5.LAVA_W), `${s} ${id}`).toHaveLength(2);
      }
    });

    it('엔진 월드 조립: Harrogath 에서 걸어서 Bloody Foothills → Frigid Highlands → Arreat Plateau → Crystalline Passage …', () => {
      for (const s of [1, 12345]) {
        const world = buildActWorld(chain, tables, gameData, s, 4);
        expect(world.townId).toBe('harrogath');
        for (const l of world.levels) expect(l.preset.missing, `${s} ${l.key}`).toBe(0);
        const { arrival, edges } = explore(world);
        for (const id of [110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 128, 129, 130, 131]) expect(arrival.has(levelKey(id)), `${s} ${levelKey(id)}`).toBe(true);
        for (const e of ['harrogath>bloodyfoothills', 'bloodyfoothills>frigidhighlands', 'frigidhighlands>arreatplateau', 'arreatplateau>crystallinepassage', 'throneofdestruction>worldstonekeep3'])
          expect(edges.has(e), `${s} ${e}`).toBe(true);
      }
    }, 300_000);

    it('브라우저 preload 목록(actWorldPaths 4)이 월드가 읽는 DS1 을 모두 담는다', () => {
      const set = new Set(actWorldPaths(chain, tables, 4).map((p) => p.toLowerCase()));
      const d = makeDrlgData(chain, tables);
      generateAct5World(d, 1);
      for (const f of d.files) expect(set.has(f.toLowerCase()), f).toBe(true);
    });
  });
});
