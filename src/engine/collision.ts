// 서브타일 단위 이동 가능 여부 맵.
// 출처: Paul Siramy — DT1 문서: 타일 헤더의 5×5 서브타일 플래그, bit 0x01 = "block walk" (https://d2mods.info/forum/kb/viewarticle?a=21)

export const SUBTILE_BLOCK_WALK = 0x01;

export class CollisionMap {
  readonly width: number;
  readonly height: number;
  private readonly flags: Uint8Array;

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
    return this.inBounds(x, y) && ((this.flags[y * this.width + x] ?? 0) & SUBTILE_BLOCK_WALK) === 0;
  }
  block(x: number, y: number, flag = SUBTILE_BLOCK_WALK): void {
    if (this.inBounds(x, y)) this.flags[y * this.width + x] = (this.flags[y * this.width + x] ?? 0) | flag;
  }
}
