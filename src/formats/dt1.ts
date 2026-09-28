// DT1: 바닥·벽·지붕·그림자 타일 그래픽.
// 출처: Paul Siramy — "DT1 file format" (Phrozen Keep, https://d2mods.info/forum/kb/viewarticle?a=21)
//       타일 헤더 96바이트, 블록 헤더 20바이트, 블록 포맷 1 = 등각(32×15), 그 외 = RLE(32×32)

export interface Dt1Block { x: number; y: number; gridX: number; gridY: number; format: number; data: Uint8Array }
export interface Dt1Tile {
  direction: number;
  roofHeight: number;
  soundIndex: number;
  animated: boolean;
  height: number;
  width: number;
  orientation: number;
  mainIndex: number;
  subIndex: number;
  rarity: number;
  /** 5×5 서브타일 플래그 (bit0 = 걷기 불가 등) */
  subTileFlags: Uint8Array;
  blocks: Dt1Block[];
}

export function parseDt1(buf: Uint8Array): Dt1Tile[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 276) throw new Error('dt1: too short');
  const v1 = dv.getInt32(0, true), v2 = dv.getInt32(4, true);
  if (v1 !== 7 || v2 !== 6) throw new Error(`dt1: bad version ${v1}.${v2}`);
  const numTiles = dv.getInt32(268, true);
  const headerOffset = dv.getInt32(272, true);
  const tiles: Dt1Tile[] = [];
  for (let i = 0; i < numTiles; i++) {
    const p = headerOffset + i * 96;
    if (p + 96 > buf.length) throw new Error('dt1: tile header out of range');
    const blockPtr = dv.getInt32(p + 72, true);
    const numBlocks = dv.getInt32(p + 80, true);
    const blocks: Dt1Block[] = [];
    for (let b = 0; b < numBlocks; b++) {
      const q = blockPtr + b * 20;
      if (q + 20 > buf.length) throw new Error('dt1: block header out of range');
      // 블록 헤더: x i16, y i16, 0 i16, gridX u8, gridY u8, format i16, length i32, 0 i16, offset i32
      const length = dv.getInt32(q + 10, true);
      const offset = dv.getInt32(q + 16, true);
      const start = blockPtr + offset;
      if (start + length > buf.length) throw new Error('dt1: block data out of range');
      blocks.push({
        x: dv.getInt16(q, true),
        y: dv.getInt16(q + 2, true),
        gridX: dv.getUint8(q + 6),
        gridY: dv.getUint8(q + 7),
        format: dv.getInt16(q + 8, true),
        data: buf.subarray(start, start + length),
      });
    }
    tiles.push({
      direction: dv.getInt32(p, true),
      roofHeight: dv.getInt16(p + 4, true),
      soundIndex: dv.getUint8(p + 6),
      animated: dv.getUint8(p + 7) !== 0,
      height: dv.getInt32(p + 8, true),
      width: dv.getInt32(p + 12, true),
      orientation: dv.getInt32(p + 20, true),
      mainIndex: dv.getInt32(p + 24, true),
      subIndex: dv.getInt32(p + 28, true),
      rarity: dv.getInt32(p + 32, true),
      subTileFlags: buf.slice(p + 40, p + 65),
      blocks,
    });
  }
  return tiles;
}

// 출처: DT1 문서 — 등각 블록(32×15)의 행별 시작 x 와 픽셀 수
const ISO_XJUMP = [14, 12, 10, 8, 6, 4, 2, 0, 2, 4, 6, 8, 10, 12, 14];
const ISO_NBPIX = [4, 8, 12, 16, 20, 24, 28, 32, 28, 24, 20, 16, 12, 8, 4];

export interface TileImage { width: number; height: number; /** 이미지 상단의 타일 기준 y (벽은 음수) */ top: number; pixels: Uint8Array }

/** 타일의 모든 블록을 하나의 팔레트 인덱스 이미지로 합친다 (0 = 투명) */
export function renderTile(tile: Dt1Tile): TileImage {
  let top = 0, bottom = 0;
  for (const b of tile.blocks) {
    const h = b.format === 1 ? 15 : 32;
    top = Math.min(top, b.y);
    bottom = Math.max(bottom, b.y + h);
  }
  const width = 160;
  const height = Math.max(1, bottom - top);
  const px = new Uint8Array(width * height);
  const put = (x: number, y: number, v: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) px[y * width + x] = v;
  };
  for (const b of tile.blocks) {
    const ox = b.x, oy = b.y - top;
    const d = b.data;
    if (b.format === 1) {
      let k = 0;
      for (let y = 0; y < 15; y++) {
        const xs = ISO_XJUMP[y] ?? 0, n = ISO_NBPIX[y] ?? 0;
        for (let i = 0; i < n; i++) put(ox + xs + i, oy + y, d[k++] ?? 0);
      }
    } else {
      // 출처: DT1 문서 — RLE 블록: (건너뛸 x, 픽셀 수) 쌍, (0,0) 이면 다음 줄
      let k = 0, x = 0, y = 0;
      while (k + 1 < d.length) {
        const skip = d[k] ?? 0, n = d[k + 1] ?? 0;
        k += 2;
        if (skip === 0 && n === 0) {
          x = 0;
          y++;
          continue;
        }
        x += skip;
        for (let i = 0; i < n; i++) put(ox + x++, oy + y, d[k++] ?? 0);
      }
    }
  }
  return { width, height, top, pixels: px };
}
