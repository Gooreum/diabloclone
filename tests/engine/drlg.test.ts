import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildSliceWorld, type SliceWorld } from '../../src/data/act1';
import { findPath, nearestWalkable } from '../../src/engine/path';
import { Game, type GameData } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { mergeStamps } from '../../src/engine/drlg/outdoor';
import type { Ds1 } from '../../src/formats/ds1';

describe('프리셋 합치기', () => {
  const tiny = (style: number, w = 2, h = 2): Ds1 => ({
    version: 18, width: w, height: h, act: 0, substitutionType: 0, files: [],
    floors: [Array.from({ length: w * h }, () => ({ prop1: 1, style, sequence: 0, hidden: false, orientation: 0 }))],
    walls: [], shadows: [[]], objects: [],
  });
  it('뒤에 찍힌 프리셋이 겹치는 셀을 덮고, 빈 곳은 기본 바닥', () => {
    const m = mergeStamps(4, 2, [{ ds1: tiny(1), x: 0, y: 0 }, { ds1: tiny(2), x: 1, y: 0 }], { style: 9, sequence: 0 });
    expect(m.floors[0]?.map((c) => c.style)).toEqual([1, 2, 2, 9, 1, 2, 2, 9]);
  });
});

describe.skipIf(!hasGameData)('Act 1 슬라이스 월드', () => {
  let tables: GameTables, data: GameData, world: SliceWorld;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
    world = buildSliceWorld(gameChain(), tables, data, 1234);
  });

  it('Blood Moor 크기 = levels.txt 80×80 타일', () => {
    expect([world.bloodMoor.widthTiles, world.bloodMoor.heightTiles]).toEqual([80, 80]);
  });

  it('마을 시작점 → 마을 동쪽 출구까지 걸어갈 수 있다', () => {
    const t = world.town.collision;
    const s = nearestWalkable(t, world.start, 10)!;
    const exit = world.levels[0]!.exits[0]!;
    const goal = nearestWalkable(t, { x: exit.x - 2, y: 100 }, 30)!;
    expect(findPath(t, { x: s.x + 0.5, y: s.y + 0.5 }, { x: goal.x + 0.5, y: goal.y + 0.5 }, 200000)).not.toBeNull();
  });

  it('Blood Moor 입구에서 레벨 대부분(이동 가능 영역의 70% 이상)에 도달 가능', () => {
    const m = world.bloodMoor.collision;
    const exit = world.levels[1]!.exits[0]!;
    const start = nearestWalkable(m, { x: 6, y: exit.y + exit.h / 2 }, 20)!;
    // BFS
    const seen = new Uint8Array(m.width * m.height);
    const q = [start.y * m.width + start.x];
    seen[q[0]!] = 1;
    let reach = 0;
    while (q.length) {
      const k = q.pop()!;
      reach++;
      const x = k % m.width, y = Math.floor(k / m.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy, nk = ny * m.width + nx;
        if (m.walkable(nx, ny) && !seen[nk]) { seen[nk] = 1; q.push(nk); }
      }
    }
    let walkable = 0;
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.walkable(x, y)) walkable++;
    expect(reach / walkable).toBeGreaterThan(0.7);
  });

  it('같은 시드 → 같은 Blood Moor', () => {
    const w2 = buildSliceWorld(gameChain(), tables, data, 1234);
    const a = world.bloodMoor.collision, b = w2.bloodMoor.collision;
    let same = true;
    for (let y = 0; y < a.height && same; y++) for (let x = 0; x < a.width; x++) if (a.walkable(x, y) !== b.walkable(x, y)) { same = false; break; }
    expect(same).toBe(true);
    expect(w2.levels[1]!.spawns?.length).toBe(world.levels[1]!.spawns?.length);
  });

  it('마을 동쪽 출구로 걸어가면 Blood Moor 로, 돌아오면 마을로 전환되고 몬스터는 풀 안에서만 배치', () => {
    const g = new Game({ map: new CollisionMap(1, 1), levels: world.levels, player: { x: world.start.x, y: world.start.y, walkVelocity: 6, runVelocity: 9 }, seed: 1, data });
    const t = world.town.collision;
    const exit = world.levels[0]!.exits[0]!;
    const goal = nearestWalkable(t, { x: exit.x + 1, y: 100 }, 30)!;
    g.changeLevel('town', goal.x - 3.5, goal.y + 0.5);
    g.enqueue({ type: 'move', x: goal.x + 0.5, y: goal.y + 0.5, run: true });
    const ev = [];
    for (let i = 0; i < 100 && g.levelId === 'town'; i++) ev.push(...g.tick());
    expect(g.levelId).toBe('bloodmoor');
    expect(ev.some((e) => e.type === 'levelChanged')).toBe(true);
    expect(g.monsters.length).toBeGreaterThan(20);
    for (const m of g.monsters) expect(['zombie1', 'fallen1', 'quillrat1']).toContain(m.type.id);
    // 서쪽 출구로 되돌아가기
    const back = world.levels[1]!.exits[0]!;
    const p = g.snapshot().player;
    g.enqueue({ type: 'move', x: back.x + 0.5, y: p.y, run: true });
    for (let i = 0; i < 200 && g.levelId === 'bloodmoor'; i++) g.tick();
    expect(g.levelId).toBe('town');
    expect(g.inTown).toBe(true);
  });
});
