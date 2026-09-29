// 서브타일 단위 이동 가능 여부 맵.
// 출처: Paul Siramy — DT1 문서: 타일 헤더의 5×5 서브타일 플래그, bit 0x01 = "block walk" (https://d2mods.info/forum/kb/viewarticle?a=21)

export const SUBTILE_BLOCK_WALK = 0x01;

// 출처: D2MOO D2Common/include/D2Collision.h — 유닛이 충돌 맵에 남기는 마스크 (COLLIDE_OBJECT, COLLIDE_DOOR)
export const COLLIDE_OBJECT = 0x0400;
export const COLLIDE_DOOR = 0x0800;
/** 출처: D2Collision.h COLLIDE_MASK_PLACEMENT (= SPAWN | PRESET | MONSTER) 중 이 엔진이 기록하는 비트: 벽·프리셋 바닥·오브젝트·문 */
export const COLLIDE_MASK_PLACEMENT = 0x01 | 0x10 | COLLIDE_OBJECT | COLLIDE_DOOR;

export class CollisionMap {
  readonly width: number;
  readonly height: number;
  private readonly flags: Uint8Array;
  /** 유닛(오브젝트·문)이 겹겹이 막는 서브타일: 마스크별 개수 (0x0400 오브젝트, 0x0800 문) */
  private unitObj: Uint8Array | null = null;
  private unitDoor: Uint8Array | null = null;

  constructor(width: number, height: number, flags?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.flags = flags ?? new Uint8Array(width * height);
  }

  static fromRows(rows: string[]): CollisionMap {
    const h = rows.length, w = rows[0]?.length ?? 0;
    const m = new CollisionMap(w, h);
    rows.forEach((r, y) => [...r].forEach((c, x) => c === '#' && m.block(x, y)));
    return m;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  walkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.width + x;
    if (((this.flags[i] ?? 0) & SUBTILE_BLOCK_WALK) !== 0) return false;
    // 출처: D2Collision.h COLLIDE_MASK_PLAYER_PATH — 오브젝트·문이 있는 칸은 지나갈 수 없다
    return !(this.unitObj?.[i] || this.unitDoor?.[i]);
  }

  /** 서브타일 충돌 마스크 (타일 플래그 | 유닛 마스크). 밖이면 0xFFFF (출처: COLLIDE_BLANK 규칙 — 방 밖 = 전부 막힘) */
  mask(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0xffff;
    const i = y * this.width + x;
    return (this.flags[i] ?? 0) | (this.unitObj?.[i] ? COLLIDE_OBJECT : 0) | (this.unitDoor?.[i] ? COLLIDE_DOOR : 0);
  }

  /**
   * 중심 (x, y), 크기 sx×sy 상자 안의 마스크 합.
   * 출처: D2Collision.cpp COLLISION_CheckMaskWithSizeXY / COLLISION_CreateBoundingBox (left = x − sx/2, bottom = y − sy/2)
   */
  maskInBox(x: number, y: number, sx: number, sy: number, mask: number): number {
    const w = Math.max(sx, 1), h = Math.max(sy, 1);
    const l = x - Math.trunc(w / 2), b = y - Math.trunc(h / 2);
    let r = 0;
    for (let j = b; j < b + h; j++) for (let i = l; i < l + w; i++) r |= this.mask(i, j) & mask;
    return r;
  }

  /**
   * 유닛 충돌 상자 기록/해제 (UNITS_BlockCollisionPath / UNITS_FreeCollisionPath).
   * 출처: D2MOO D2Common Units.cpp UNITS_BlockCollisionPath → COLLISION_SetMaskWithSizeXY (같은 상자 규칙)
   */
  setUnitBox(x: number, y: number, sx: number, sy: number, bit: typeof COLLIDE_OBJECT | typeof COLLIDE_DOOR, on: boolean): void {
    if (sx <= 0 || sy <= 0) return;
    const arr = bit === COLLIDE_DOOR ? (this.unitDoor ??= new Uint8Array(this.width * this.height)) : (this.unitObj ??= new Uint8Array(this.width * this.height));
    const l = x - Math.trunc(sx / 2), b = y - Math.trunc(sy / 2);
    for (let j = b; j < b + sy; j++)
      for (let i = l; i < l + sx; i++) {
        if (!this.inBounds(i, j)) continue;
        const k = j * this.width + i;
        arr[k] = on ? Math.min(255, (arr[k] ?? 0) + 1) : Math.max(0, (arr[k] ?? 0) - 1);
      }
  }
  block(x: number, y: number, flag = SUBTILE_BLOCK_WALK): void {
    if (this.inBounds(x, y)) this.flags[y * this.width + x] = (this.flags[y * this.width + x] ?? 0) | flag;
  }
}

/**
 * 유닛·미사일이 차지하는 서브타일 (중심 칸 기준 오프셋).
 * 출처: D2MOO D2Collision.cpp COLLISION_CheckMaskWithSize / COLLISION_SetMaskWithPattern —
 *   크기 0·1 = 한 칸, 2 = 중심 + 상하좌우 (SMALL, 십자), 3 이상 = 3×3 (BIG, COLLISION_CreateBoundingBox)
 */
export function footprint(size: number): readonly (readonly [number, number])[] {
  if (size <= 1) return FP1;
  if (size === 2) return FP2;
  return FP3;
}
const FP1 = [[0, 0]] as const;
const FP2 = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const FP3 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

/**
 * 두 유닛(미사일 포함)의 차지 칸이 겹치나. 미사일은 자기 크기 패턴으로 유닛의 존재 마스크를 검사한다.
 * 출처: D2MOO MISSILE 충돌 — COLLISION_CheckMaskWithSize(미사일 위치, 미사일 Size, 유닛 마스크)
 */
export function footprintsOverlap(ax: number, ay: number, aSize: number, bx: number, by: number, bSize: number): boolean {
  const dx = Math.floor(bx) - Math.floor(ax), dy = Math.floor(by) - Math.floor(ay);
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) return false;
  const fb = footprint(bSize);
  for (const [x1, y1] of footprint(aSize)) for (const [x2, y2] of fb) if (x1 === dx + x2 && y1 === dy + y2) return true;
  return false;
}
