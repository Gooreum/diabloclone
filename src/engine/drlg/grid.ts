// DRLG 격자: 셀마다 32비트 플래그. 레벨 격자(8×8 타일 단위), 방 격자(타일 단위), 파일 격자(DS1 레이어 뷰)에 공용.
// 출처: D2MOO DrlgDrlgGrid.cpp (DRLGGRID_*), D2DrlgDrlgGrid.h FlagOperation
import type { Vertex } from './vertex';

export const enum Op { OR, AND, XOR, OVERWRITE, OVERWRITE_IF_ZERO, AND_NEGATED }

export interface Box { x: number; y: number; w: number; h: number }

/** 출처: DrlgDrlgRoom.cpp DRLGROOM_AreXYInsideCoordinates */
export const inBox = (b: Box, x: number, y: number): boolean => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;

export class DrlgGrid {
  readonly w: number;
  readonly h: number;
  /** 셀 저장소 (다른 격자와 공유 가능 — 원작 DRLGGRID_FillNewCellFlags 의 파일 뷰) */
  readonly data: Int32Array;
  readonly offset: number;
  readonly stride: number;

  /** 출처: DRLGGRID_InitializeGridCells (0 으로 초기화) / DRLGGRID_FillNewCellFlags (기존 배열의 부분 뷰) */
  constructor(w: number, h: number, data?: Int32Array, offset = 0, stride = w) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Int32Array(Math.max(0, w * h));
    this.offset = offset;
    this.stride = stride;
  }

  /** 출처: DRLGGRID_IsPointInsideGridArea */
  inside(x: number, y: number): boolean {
    return x >= 0 && x < this.w && y >= 0 && y < this.h;
  }

  /**
   * 출처: DRLGGRID_GetGridEntry. 원작은 범위 검사 없이 읽는다 — 범위 밖은 0 으로 둔다
   * (근사(원작 미확인): 원작은 인접 메모리 값을 읽음. 정상 흐름에서는 범위 안만 읽는다)
   */
  get(x: number, y: number): number {
    if (y < 0 || y >= this.h || x < 0 || x >= this.stride) return 0;
    return this.data[this.offset + x + y * this.stride] ?? 0;
  }

  /** 출처: DRLGGRID_AlterGridFlag + gpfFlagOperations (범위 밖 쓰기는 무시) */
  alter(x: number, y: number, flag: number, op: Op): void {
    if (y < 0 || y >= this.h || x < 0 || x >= this.stride) return;
    const i = this.offset + x + y * this.stride;
    const v = this.data[i] ?? 0;
    switch (op) {
      case Op.OR: this.data[i] = v | flag; break;
      case Op.AND: this.data[i] = v & flag; break;
      case Op.XOR: this.data[i] = v ^ flag; break;
      case Op.OVERWRITE: this.data[i] = flag; break;
      case Op.OVERWRITE_IF_ZERO: if (v === 0) this.data[i] = flag; break;
      case Op.AND_NEGATED: this.data[i] = v & ~flag; break;
    }
  }

  /** 출처: DRLGGRID_AlterAllGridFlags */
  alterAll(flag: number, op: Op): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.alter(x, y, flag, op);
  }

  /** 출처: DRLGGRID_AlterEdgeGridFlags */
  alterEdges(flag: number, op: Op): void {
    for (let i = 0; i < this.w; i++) {
      this.alter(i, 0, flag, op);
      this.alter(i, this.h - 1, flag, op);
    }
    for (let i = 1; i < this.h; i++) {
      this.alter(0, i, flag, op);
      this.alter(this.w - 1, i, flag, op);
    }
  }
}

/** 출처: DrlgDrlgGrid.cpp sub_6FD75DE0 — 꼭짓점→다음 꼭짓점 구간(축 정렬)의 셀들에 플래그 */
export function alterVertexSegment(grid: DrlgGrid, v: Vertex, flag: number, op: Op, alterNext: boolean): void {
  const n = v.next;
  if (v.x === n.x && v.y === n.y) {
    grid.alter(v.x, v.y, flag, op);
    return;
  }
  if (v.x === n.x) {
    let y: number, endY: number;
    if (v.y >= n.y) { y = n.y + 1; endY = v.y; } else { y = v.y + 1; endY = n.y; }
    for (; y !== endY; y++) grid.alter(v.x, y, flag, op);
  } else {
    let x: number, endX: number;
    if (v.x >= n.x) { endX = v.x; x = n.x + 1; } else { endX = n.x; x = v.x + 1; }
    for (; x !== endX; x++) grid.alter(x, v.y, flag, op);
  }
  grid.alter(v.x, v.y, flag, op);
  if (alterNext) grid.alter(n.x, n.y, flag, op);
}

/** 출처: DRLGGRID_SetVertexGridFlags — 경로(열린 목록) 꼭짓점 셀들에 OR */
export function setVertexGridFlags(grid: DrlgGrid, start: Vertex | null, flag: number): void {
  for (let v = start; v; v = v.nextOpen) {
    if (grid.inside(v.x, v.y)) grid.alter(v.x, v.y, flag, Op.OR);
  }
}

/** 출처: DrlgDrlgGrid.cpp sub_6FD75F60 — 두 꼭짓점 사이 브레젠험 선(굵기 nSize)을 box 기준 격자에 */
export function drawLine(grid: DrlgGrid, v: Vertex, box: Box, flag: number, op: Op, size: number): void {
  let x = v.x, y = v.y;
  const nx = v.nextOpen as Vertex;
  let dx = nx.x - x, dy = nx.y - y;
  let incX: number, incY: number;
  if (dx >= 0) incX = 1; else { dx = -dx; incX = -1; }
  if (dy >= 0) incY = 1; else { dy = -dy; incY = -1; }
  let check = 0;
  const put = (px: number, py: number) => {
    if (inBox(box, px, py)) grid.alter(px - box.x, py - box.y, flag, op);
  };
  if (dx >= dy) {
    for (let i = 0; i < size; i++) put(x, y + i);
    for (let j = 0; j < dx; j++) {
      x += incX;
      check += dy;
      if (check > dx) { y += incY; check -= dx; }
      for (let i = 0; i < size; i++) put(x, y + i);
    }
  } else {
    for (let i = 0; i < size; i++) put(x + i, y);
    for (let j = 0; j < dy; j++) {
      y += incY;
      check += dx;
      if (check > dy) { x += incX; check -= dy; }
      for (let i = 0; i < size; i++) put(x + i, y);
    }
  }
}
