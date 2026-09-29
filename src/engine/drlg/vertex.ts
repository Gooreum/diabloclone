// 레벨 외곽선 꼭짓점 (원형 연결 리스트) 과 흙길 경로 꼭짓점 (열린 리스트).
// 출처: D2MOO DrlgDrlgVer.cpp (DRLGVER_*), D2DrlgDrlgVer.h D2DrlgVertexStrc
import type { Box } from './grid';

export class Vertex {
  x: number;
  y: number;
  /** 원작 nDirection (외곽선: 0 일반 테두리, 1 절벽 / 경로: ALTDIR) */
  dir: number;
  /** bit0 = 이 꼭짓점→다음 구간이 다른 레벨과 맞닿음, bit1 = 맞닿은 레벨이 프리셋 */
  flags = 0;
  /** 외곽선(원형) 다음 */
  next: Vertex = this;
  /** 경로(열린 리스트) 다음 */
  nextOpen: Vertex | null = null;

  constructor(x = 0, y = 0, dir = 0) {
    this.x = x;
    this.y = y;
    this.dir = dir;
  }
}

/** 레벨 가장자리에 맞닿은 이웃 (원작 D2DrlgOrthStrc) */
export interface Orth { levelId: number; dir: number; preset: boolean; box: Box }

/** 출처: DrlgDrlgRoom.cpp sub_6FD776B0 — AddOrth 정렬 비교 (true = a 앞에 b 삽입) */
function orthBefore(a: Orth, b: Orth): boolean {
  if (a.dir <= b.dir) {
    if (a.dir === b.dir) {
      switch (b.dir) {
        case 0: if (a.box.y <= b.box.y) return false; break;
        case 1: if (a.box.x >= b.box.x) return false; break;
        case 2: if (a.box.y >= b.box.y) return false; break;
        case 3: if (a.box.x <= b.box.x) return false; break;
        default: return false;
      }
    } else return false;
  }
  return true;
}

/** 출처: DrlgDrlgRoom.cpp DRLGROOM_AddOrth — 정렬 삽입 (원작 연결 리스트 순서 그대로) */
export function addOrth(list: Orth[], o: Orth): void {
  if (list.length === 0) {
    list.push(o);
    return;
  }
  if (list.length === 1) {
    if (orthBefore(list[0] as Orth, o)) list.unshift(o);
    else list.push(o);
    return;
  }
  // 원작: pPrevious = head, pNext = head->pNext 부터 비교 (머리 원소와는 비교하지 않음)
  let i = 1;
  for (; i < list.length; i++) if (orthBefore(list[i] as Orth, o)) break;
  list.splice(i, 0, o);
}

/**
 * 출처: DrlgDrlgVer.cpp DRLGVER_CreateVertices — 레벨 사각형 4 꼭짓점 + 이웃 레벨이 맞닿은 구간 꼭짓점.
 * 좌표는 타일 단위, 레벨 원점 기준으로 변환해 반환. (원작처럼 폭/높이를 1 줄여 포함 좌표로 계산)
 */
export function createVertices(level: Box, orths: Orth[], dir = 0): Vertex {
  const c = { x: level.x, y: level.y, w: level.w - 1, h: level.h - 1 };
  const v0 = new Vertex(c.x, c.y + c.h, dir);
  const v1 = new Vertex(c.x, c.y, dir);
  const v2 = new Vertex(c.x + c.w, c.y, dir);
  const v3 = new Vertex(c.x + c.w, c.y + c.h, dir);
  v0.next = v1; v1.next = v2; v2.next = v3; v3.next = v0;
  const insertAfter = (p: Vertex, n: Vertex) => { n.next = p.next; p.next = n; };
  for (const o of orths) {
    const b = { x: o.box.x, y: o.box.y, w: o.box.w - 1, h: o.box.h - 1 };
    let pv: Vertex, vertical: boolean, v16: number, v15: number, v21: number, v23: number, sign: number;
    switch (o.dir) {
      case 0: pv = v0; vertical = true; v16 = b.y + b.h; v15 = b.y; v21 = v0.y; v23 = v1.y; sign = -1; break;
      case 1: pv = v1; vertical = false; v16 = b.x; v15 = b.x + b.w; v21 = v1.x; v23 = v2.x; sign = 1; break;
      case 2: pv = v2; vertical = true; v16 = b.y; v15 = b.y + b.h; v21 = v2.y; v23 = v3.y; sign = 1; break;
      case 3: pv = v3; vertical = false; v16 = b.x + b.w; v15 = b.x; v21 = v3.x; v23 = v0.x; sign = -1; break;
      default: throw new Error('createVertices: bad orth direction');
    }
    const mk = (val: number) => (vertical ? new Vertex(pv.x, val, dir) : new Vertex(val, pv.y, dir));
    if (sign * v16 > sign * v21) {
      if (sign * v16 <= sign * v23) {
        const nv = mk(v16);
        insertAfter(pv, nv);
        pv = nv;
        pv.flags |= 1;
        if (o.preset) pv.flags |= 2;
        if (sign * v15 < sign * v23) insertAfter(pv, mk(v15));
      }
    } else if (sign * v15 >= sign * v21) {
      pv.flags |= 1;
      if (o.preset) pv.flags |= 2;
      if (sign * v15 < sign * v23) insertAfter(pv, mk(v15));
    }
  }
  let v = v0;
  do {
    v.x -= c.x;
    v.y -= c.y;
    v = v.next;
  } while (v !== v0);
  return v0;
}

/** 출처: DRLGVER_GetCoordDiff — 다음 꼭짓점 방향 부호 */
export function coordDiff(v: Vertex): { dx: number; dy: number } {
  return { dx: Math.sign(v.next.x - v.x), dy: Math.sign(v.next.y - v.y) };
}
