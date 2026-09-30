import { describe, expect, it } from 'vitest';
import { reachableNear } from '../../src/engine/path';

/** 문자열 격자 → 맵 ('.' 걸을 수 있음, '#' 벽) */
const grid = (rows: string[]) => ({
  width: rows[0]!.length,
  height: rows.length,
  walkable: (x: number, y: number) => rows[y]?.[x] === '.',
});

describe('reachableNear (봉인 보스 자리)', () => {
  const m = grid([
    '..........',
    '..........',
    '######.###',
    '#....#.#..',
    '#....#.#..',
    '######.###',
  ]);
  it('목표가 이어져 있으면 그 칸 그대로', () => {
    expect(reachableNear(m, { x: 0, y: 0 }, { x: 6, y: 4 })).toEqual({ x: 6, y: 4 });
  });
  it('목표가 막힌 섬 안이면 이어진 칸 중 가장 가까운 칸', () => {
    // (2,3) 은 벽으로 둘러싸인 방 — 이어진 칸 중 가장 가까운 칸은 (2,1)
    expect(reachableNear(m, { x: 0, y: 0 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 1 });
    // (9,3) 은 오른쪽 섬 — 가장 가까운 이어진 칸 (9,1)
    expect(reachableNear(m, { x: 0, y: 0 }, { x: 9, y: 3 })).toEqual({ x: 9, y: 1 });
  });
  it('출발 둘레에 걸을 칸이 없으면 null', () => {
    expect(reachableNear(grid(['###', '###', '###']), { x: 1, y: 1 }, { x: 0, y: 0 })).toBeNull();
  });
});
