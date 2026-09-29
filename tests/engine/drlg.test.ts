// Act 1 월드 (원작 DRLG 이식) — 게임 엔진 통합: 레벨 전환·몬스터 풀. 세부 DRLG 규칙은 drlg-outdoor.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World, type Act1GameWorld } from '../../src/data/act1-world';
import { findPath, nearestWalkable } from '../../src/engine/path';
import { Game, type GameData } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';

describe.skipIf(!hasGameData)('Act 1 월드', () => {
  let tables: GameTables, data: GameData, world: Act1GameWorld;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
    world = buildAct1World(gameChain(), tables, data, 1234);
  }, 60_000);

  // 출처: DrlgOutPlace.cpp sub_6FD81950 — Blood Moor 는 56×96 또는 96×56 (levels.txt 80×80 을 링커가 바꿈)
  it('Blood Moor 크기 = 링커 규칙 56×96 / 96×56', () => {
    const bm = world.byKey.get('bloodmoor')!.preset;
    expect([[56, 96], [96, 56]]).toContainEqual([bm.widthTiles, bm.heightTiles]);
  });

  it('마을 시작점 → Blood Moor 출구까지 걸어갈 수 있다', () => {
    const town = world.byKey.get('town')!.def;
    const exit = town.exits.find((e) => e.to === 'bloodmoor')!;
    const s = nearestWalkable(town.map, world.start, 10)!;
    let path = null;
    for (let y = exit.y; y < exit.y + exit.h && !path; y += 2)
      for (let x = exit.x; x < exit.x + exit.w && !path; x++) if (town.map.walkable(x, y)) path = findPath(town.map, { x: s.x + 0.5, y: s.y + 0.5 }, { x: x + 0.5, y: y + 0.5 }, 400000);
    expect(path).not.toBeNull();
  });

  it('Blood Moor 로 넘어가고 되돌아오면 마을 (inTown)', () => {
    const g = new Game({ map: new CollisionMap(1, 1), levels: world.levels.map((l) => l.def), player: { x: world.start.x, y: world.start.y, walkVelocity: 6, runVelocity: 9 }, seed: 1, data });
    const town = world.byKey.get('town')!.def;
    const exit = town.exits.find((e) => e.to === 'bloodmoor')!;
    let spot: { x: number; y: number } | null = null;
    for (let y = exit.y; y < exit.y + exit.h && !spot; y++) for (let x = exit.x; x < exit.x + exit.w && !spot; x++) if (town.map.walkable(x, y)) spot = { x, y };
    g.changeLevel('town', spot!.x + 0.5, spot!.y + 0.5);
    g.tick();
    expect(g.levelId).toBe('bloodmoor');
    const back = world.byKey.get('bloodmoor')!.def.exits.find((e) => e.to === 'town')!;
    const bm = world.byKey.get('bloodmoor')!.def.map;
    let b: { x: number; y: number } | null = null;
    for (let y = back.y; y < back.y + back.h && !b; y++) for (let x = back.x; x < back.x + back.w && !b; x++) if (bm.walkable(x, y)) b = { x, y };
    g.changeLevel('bloodmoor', b!.x + 0.5, b!.y + 0.5);
    g.tick();
    expect(g.levelId).toBe('town');
    expect(g.inTown).toBe(true);
  });
});
