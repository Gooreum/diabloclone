// 8방향 A* 경로 탐색 (서브타일 격자). 대각선 이동 시 양 옆이 막혀 있으면 모서리 통과 금지.
// 참고: 원작의 경로 탐색 알고리즘 자체를 재현한 것은 아니다 (클릭 이동의 도달 결과를 맞추기 위한 엔진 구현).
import type { CollisionMap } from './collision';
import type { Pt } from './geom';

/** 경로 탐색이 쓰는 맵 인터페이스 (유닛 점유를 덧씌운 맵도 넘길 수 있게) */
export type WalkMap = Pick<CollisionMap, 'width' | 'height' | 'walkable'>;

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export function findPath(map: WalkMap, from: Pt, to: Pt, maxNodes = 20000): Pt[] | null {
  const sx = Math.floor(from.x), sy = Math.floor(from.y), tx = Math.floor(to.x), ty = Math.floor(to.y);
  if (!map.walkable(tx, ty)) return null;
  if (sx === tx && sy === ty) return [];
  const W = map.width;
  const key = (x: number, y: number) => y * W + x;
  const g = new Map<number, number>([[key(sx, sy), 0]]);
  const parent = new Map<number, number>();
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new MinHeap();
  heap.push(h(sx, sy), key(sx, sy));
  const closed = new Set<number>();
  let expanded = 0;
  while (heap.size > 0) {
    const k = heap.pop();
    if (closed.has(k)) continue;
    closed.add(k);
    const x = k % W, y = Math.floor(k / W);
    if (x === tx && y === ty) {
      const path: Pt[] = [];
      let c: number | undefined = k;
      while (c !== undefined && c !== key(sx, sy)) {
        path.push({ x: (c % W) + 0.5, y: Math.floor(c / W) + 0.5 });
        c = parent.get(c);
      }
      return path.reverse();
    }
    if (++expanded > maxNodes) return null;
    const gk = g.get(k) ?? 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!map.walkable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!map.walkable(x + dx, y) || !map.walkable(x, y + dy))) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const ng = gk + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        parent.set(nk, k);
        heap.push(ng + h(nx, ny), nk);
      }
    }
  }
  return null;
}

/** 목표가 막혀 있으면 가장 가까운 이동 가능 서브타일 (반경 탐색) */
export function nearestWalkable(map: WalkMap, p: Pt, radius = 10): Pt | null {
  const cx = Math.floor(p.x), cy = Math.floor(p.y);
  if (map.walkable(cx, cy)) return { x: cx, y: cy };
  for (let r = 1; r <= radius; r++) {
    let best: Pt | null = null, bd = Infinity;
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || !map.walkable(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < bd) { bd = d; best = { x, y }; }
      }
    if (best) return best;
  }
  return null;
}

/**
 * from 둘레(걸을 수 있는 가장 가까운 칸)에서 걸어서 이어진 칸 중 to 에 가장 가까운 칸 (4방향 BFS, from 에서 radius 안).
 * to 가 이어져 있으면 to 칸 그대로. from 둘레에 걸을 칸이 없으면 null.
 */
export function reachableNear(map: WalkMap, from: Pt, to: Pt, radius = 90): Pt | null {
  const s = nearestWalkable(map, from, 6);
  if (!s) return null;
  const tx = Math.floor(to.x), ty = Math.floor(to.y);
  const x0 = s.x - radius, y0 = s.y - radius, w = radius * 2 + 1;
  const seen = new Uint8Array(w * w);
  const q: number[] = [s.x - x0 + (s.y - y0) * w];
  seen[q[0]!] = 1;
  let best = s, bd = Math.hypot(s.x - tx, s.y - ty);
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    const x = (i % w) + x0, y = Math.floor(i / w) + y0;
    const d = Math.hypot(x - tx, y - ty);
    if (d < bd) {
      bd = d;
      best = { x, y };
      if (d === 0) break;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < x0 || ny < y0 || nx >= x0 + w || ny >= y0 + w) continue;
      const k = nx - x0 + (ny - y0) * w;
      if (seen[k] || !map.walkable(nx, ny)) continue;
      seen[k] = 1;
      q.push(k);
    }
  }
  return best;
}

/** (우선순위, 값) 최소 힙 */
class MinHeap {
  private readonly pri: number[] = [];
  private readonly val: number[] = [];
  get size(): number {
    return this.val.length;
  }
  push(p: number, v: number): void {
    this.pri.push(p);
    this.val.push(v);
    let i = this.val.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.pri[parent] ?? 0) <= p) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.val[0] ?? 0;
    const last = this.val.length - 1;
    this.swap(0, last);
    this.pri.pop();
    this.val.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.val.length && (this.pri[l] ?? 0) < (this.pri[m] ?? 0)) m = l;
      if (r < this.val.length && (this.pri[r] ?? 0) < (this.pri[m] ?? 0)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.pri[a], this.pri[b]] = [this.pri[b] ?? 0, this.pri[a] ?? 0];
    [this.val[a], this.val[b]] = [this.val[b] ?? 0, this.val[a] ?? 0];
  }
}
