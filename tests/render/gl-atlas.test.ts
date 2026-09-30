import { describe, expect, it } from 'vitest';
import { ShelfAtlas, ShiftRows, type Slot } from '../../src/render/gl/atlas';
import { FLOATS_PER_VERTEX, QuadBatch } from '../../src/render/gl/batch';

const overlap = (a: Slot, b: Slot) => a.page === b.page && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('ShelfAtlas', () => {
  it('여러 크기의 그림을 겹치지 않게 배치하고 같은 id 는 같은 자리', () => {
    const a = new ShelfAtlas(256, 4);
    const slots: Slot[] = [];
    for (let i = 0; i < 40; i++) slots.push(a.place(`s${i}`, 10 + (i % 7) * 5, 8 + (i % 5) * 6, 1)!.slot);
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) expect(overlap(slots[i]!, slots[j]!)).toBe(false);
    for (const s of slots) expect(s.x + s.w <= 256 && s.y + s.h <= 256).toBe(true);
    expect(a.get('s3', 2)).toEqual(slots[3]);
  });

  it('페이지가 차면 새 페이지를 쓴다', () => {
    const a = new ShelfAtlas(64, 3);
    for (let i = 0; i < 4; i++) a.place(`q${i}`, 32, 32, 1);
    expect(a.pageCount).toBe(1);
    const r = a.place('q4', 32, 32, 1)!;
    expect(r.slot.page).toBe(1);
    expect(r.evicted).toBeUndefined();
  });

  it('한도를 넘으면 가장 오래 안 쓴 페이지를 비우고 그 자리를 쓴다', () => {
    const a = new ShelfAtlas(64, 2);
    a.place('p0', 64, 64, 1); // 페이지 0
    a.place('p1', 64, 64, 2); // 페이지 1
    a.get('p0', 3); // 페이지 0 을 최근에 씀 → 페이지 1 이 가장 오래됨
    const r = a.place('p2', 64, 64, 4)!;
    expect(r.evicted).toBe(1);
    expect(r.slot.page).toBe(1);
    expect(a.get('p1', 5)).toBeUndefined();
    expect(a.get('p0', 5)).toBeDefined();
  });

  it('페이지보다 큰 그림·크기 0 은 배치하지 않는다', () => {
    const a = new ShelfAtlas(64, 2);
    expect(a.place('big', 65, 10, 1)).toBeNull();
    expect(a.place('zero', 0, 10, 1)).toBeNull();
  });

  it('reset 뒤에는 아무것도 없다', () => {
    const a = new ShelfAtlas(64, 2);
    a.place('x', 8, 8, 1);
    a.reset();
    expect(a.get('x', 2)).toBeUndefined();
    expect(a.pageCount).toBe(0);
  });
});

describe('ShiftRows', () => {
  it('0 번 줄(항등)은 배정하지 않고, 같은 키는 같은 줄', () => {
    const r = new ShiftRows(4);
    const a = r.row('rt1', 1);
    expect(a).toEqual({ row: 1, fresh: true });
    expect(r.row('rt1', 2)).toEqual({ row: 1, fresh: false });
    expect(r.row('rt2', 3).row).toBe(2);
  });

  it('줄이 모자라면 가장 오래 안 쓴 줄을 다시 쓴다', () => {
    const r = new ShiftRows(3); // 쓸 수 있는 줄 1, 2
    r.row('a', 1);
    r.row('b', 2);
    r.row('a', 3);
    const c = r.row('c', 4);
    expect(c).toEqual({ row: 2, fresh: true });
    expect(r.row('b', 5).fresh).toBe(true);
  });
});

describe('QuadBatch', () => {
  it('같은 페이지·혼합이 이어지면 한 번에 그리고, 바뀌면 순서대로 나눠 그린다', () => {
    const calls: [number, number, number][] = [];
    const b = new QuadBatch((page, blend, _d, v) => calls.push([page, blend, v]));
    b.push(0, -1, 0, 0, 10, 10, 0, 0, 0, 1);
    b.push(0, -1, 5, 5, 10, 10, 0, 0, 0, 1);
    b.push(0, 3, 5, 5, 10, 10, 0, 0, 0, 1);
    b.push(1, 3, 5, 5, 10, 10, 0, 0, 0, 1);
    b.push(0, -1, 5, 5, 10, 10, 0, 0, 0, 1);
    b.flush();
    expect(calls).toEqual([[0, -1, 12], [0, 3, 6], [1, 3, 6], [0, -1, 6]]);
  });

  it('정점에 화면 좌표·텍셀 좌표·색 줄·밝기가 들어간다', () => {
    let data: Float32Array | null = null;
    const b = new QuadBatch((_p, _b, d) => (data = d.slice()));
    b.push(2, -1, 100, 50, 20, 10, 300, 400, 7, 1.6);
    b.flush();
    const v = Array.from(data!).map((x) => Math.round(x * 10) / 10);
    expect(v.slice(0, FLOATS_PER_VERTEX)).toEqual([100, 50, 300, 400, 7, 1.6]);
    // 오른쪽 아래 꼭짓점 (5번째 정점)
    expect(v.slice(4 * FLOATS_PER_VERTEX, 5 * FLOATS_PER_VERTEX)).toEqual([120, 60, 320, 410, 7, 1.6]);
  });

  it('많은 사각형도 버퍼를 늘려 모두 담는다', () => {
    let verts = 0;
    const b = new QuadBatch((_p, _b, _d, v) => (verts += v));
    for (let i = 0; i < 5000; i++) b.push(0, -1, i, 0, 1, 1, 0, 0, 0, 1);
    b.flush();
    expect(verts).toBe(30000);
  });

  it('혼합 번호 정리: 5·6 = 더하기(3), 범위 밖 = 불투명', () => {
    expect([undefined, -1, 0, 2, 3, 4, 5, 6, 7].map((x) => QuadBatch.normBlend(x))).toEqual([-1, -1, 0, 2, 3, 4, 3, 3, -1]);
  });
});
