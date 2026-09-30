// DCC: 캐릭터·몬스터 애니메이션 압축 포맷 (방향별 비트스트림, 4×4 셀 기반 차분 부호화).
// 출처: Paul Siramy — "DCC file format" (Phrozen Keep, https://d2mods.info/forum/kb/viewarticle?a=24)
// 출처: OpenDiablo2 d2dcc — dcc_direction.go 의 2단계 디코딩(fillPixelBuffer / generateFrames)을 그대로 옮김
//       (https://github.com/OpenDiablo2/OpenDiablo2/tree/master/d2common/d2fileformats/d2dcc)

/** LSB 우선 비트 리더 (DCC 비트스트림) */
export class BitStream {
  private readonly data: Uint8Array;
  /** 절대 비트 위치 */
  pos: number;
  private readonly end: number;
  constructor(data: Uint8Array, startBit = 0, lengthBits = data.length * 8 - startBit) {
    this.data = data;
    this.pos = startBit;
    this.end = startBit + lengthBits;
  }
  bits(n: number): number {
    if (n === 0) return 0;
    if (this.pos + n > this.end) throw new Error('dcc: bitstream overrun');
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.data[(this.pos >> 3)] ?? 0;
      v += ((byte >> (this.pos & 7)) & 1) * 2 ** i;
      this.pos++;
    }
    return v;
  }
  signed(n: number): number {
    if (n === 0) return 0;
    const v = this.bits(n);
    return v >= 2 ** (n - 1) ? v - 2 ** n : v;
  }
  /** 현재 위치에서 length 비트 구간을 독립 스트림으로 떼어내고 건너뛴다 */
  sub(lengthBits: number): BitStream {
    const s = new BitStream(this.data, this.pos, lengthBits);
    this.pos += lengthBits;
    return s;
  }
  rest(): BitStream {
    return new BitStream(this.data, this.pos, this.end - this.pos);
  }
}

// 출처: DCC 문서 — 필드 비트폭 인코딩 테이블 ("crazy bit table")
const CRAZY_BITS = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 26, 28, 30, 32];
// 출처: DCC 문서 — 4비트 픽셀 마스크의 설정 비트 수
const PIXEL_MASK_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export interface Box { left: number; top: number; width: number; height: number }
export interface DccFrame {
  box: Box;
  /** 방향 박스 크기의 팔레트 인덱스 버퍼 (0 = 투명) */
  pixels: Uint8Array;
}
export interface DccDirection { box: Box; frames: DccFrame[] }
export interface Dcc { directions: DccDirection[]; framesPerDirection: number }

interface Cell { x: number; y: number; w: number; h: number }
interface PBE { value: [number, number, number, number]; frame: number; cellIndex: number }
interface FrameHdr { box: Box; hCells: number; vCells: number; cells: Cell[] }

/** 파일 머리: 방향 수·방향당 프레임 수·방향별 시작 바이트 */
export interface DccHeader { directions: number; framesPerDirection: number; offsets: number[] }

export function parseDccHeader(buf: Uint8Array): DccHeader {
  if (buf.length < 15 || buf[0] !== 0x74) throw new Error('dcc: bad signature');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const directions = buf[2] ?? 0;
  const offsets: number[] = [];
  for (let d = 0; d < directions; d++) offsets.push(dv.getUint32(15 + d * 4, true));
  return { directions, framesPerDirection: dv.getUint32(3, true), offsets };
}

/** 방향 하나만 해석 (방향마다 독립된 비트스트림이라 필요한 방향만 풀 수 있다) */
export function parseDccDirection(buf: Uint8Array, h: DccHeader, d: number): DccDirection {
  return decodeDirection(buf, (h.offsets[d] ?? 0) * 8, h.framesPerDirection);
}

export function parseDcc(buf: Uint8Array): Dcc {
  const h = parseDccHeader(buf);
  return { directions: h.offsets.map((_, d) => parseDccDirection(buf, h, d)), framesPerDirection: h.framesPerDirection };
}

function decodeDirection(buf: Uint8Array, startBit: number, numFrames: number): DccDirection {
  const bs = new BitStream(buf, startBit);
  bs.bits(32); // outSizeCoded
  const compression = bs.bits(2);
  const v0Bits = CRAZY_BITS[bs.bits(4)] ?? 0;
  const wBits = CRAZY_BITS[bs.bits(4)] ?? 0;
  const hBits = CRAZY_BITS[bs.bits(4)] ?? 0;
  const xBits = CRAZY_BITS[bs.bits(4)] ?? 0;
  const yBits = CRAZY_BITS[bs.bits(4)] ?? 0;
  const optBits = CRAZY_BITS[bs.bits(4)] ?? 0;
  const codedBits = CRAZY_BITS[bs.bits(4)] ?? 0;

  const frameBoxes: Box[] = [];
  let optionalTotal = 0;
  for (let f = 0; f < numFrames; f++) {
    bs.bits(v0Bits);
    const width = bs.bits(wBits);
    const height = bs.bits(hBits);
    const x = bs.signed(xBits);
    const y = bs.signed(yBits);
    optionalTotal += bs.bits(optBits);
    bs.bits(codedBits);
    const bottomUp = bs.bits(1);
    frameBoxes.push(bottomUp ? { left: x, top: y, width, height } : { left: x, top: y - height + 1, width, height });
  }
  if (optionalTotal > 0) {
    bs.pos = Math.ceil(bs.pos / 8) * 8 + optionalTotal * 8;
  }

  const equalCellsSize = compression & 0x2 ? bs.bits(20) : 0;
  const pixelMaskSize = bs.bits(20);
  let encodingTypeSize = 0;
  let rawPixelSize = 0;
  if (compression & 0x1) {
    encodingTypeSize = bs.bits(20);
    rawPixelSize = bs.bits(20);
  }
  const paletteEntries: number[] = [];
  for (let i = 0; i < 256; i++) if (bs.bits(1)) paletteEntries.push(i);

  const equalCells = bs.sub(equalCellsSize);
  const pixelMask = bs.sub(pixelMaskSize);
  const encodingType = bs.sub(encodingTypeSize);
  const rawPixels = bs.sub(rawPixelSize);
  const codes = bs.rest();

  // 방향 박스 = 모든 프레임 박스의 합집합
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const fb of frameBoxes) {
    l = Math.min(l, fb.left);
    t = Math.min(t, fb.top);
    r = Math.max(r, fb.left + fb.width - 1);
    b = Math.max(b, fb.top + fb.height - 1);
  }
  const box: Box = { left: l, top: t, width: r - l + 1, height: b - t + 1 };
  const dirHCells = 1 + Math.floor((box.width - 1) / 4);
  const dirVCells = 1 + Math.floor((box.height - 1) / 4);

  // 프레임별 셀 분할 (출처: dcc_direction_frame.go recalculateCells)
  const frames: FrameHdr[] = frameBoxes.map((fb) => {
    const w0 = 4 - ((fb.left - box.left) % 4);
    let hCells: number;
    if (fb.width - w0 <= 1) hCells = 1;
    else {
      const tmp = fb.width - w0 - 1;
      hCells = 2 + Math.floor(tmp / 4);
      if (tmp % 4 === 0) hCells--;
    }
    const h0 = 4 - ((fb.top - box.top) % 4);
    let vCells: number;
    if (fb.height - h0 <= 1) vCells = 1;
    else {
      const tmp = fb.height - h0 - 1;
      vCells = 2 + Math.floor(tmp / 4);
      if (tmp % 4 === 0) vCells--;
    }
    const widths = new Array<number>(hCells).fill(4);
    if (hCells === 1) widths[0] = fb.width;
    else {
      widths[0] = w0;
      widths[hCells - 1] = fb.width - (w0 + 4 * (hCells - 2));
    }
    const heights = new Array<number>(vCells).fill(4);
    if (vCells === 1) heights[0] = fb.height;
    else {
      heights[0] = h0;
      heights[vCells - 1] = fb.height - (h0 + 4 * (vCells - 2));
    }
    const cells: Cell[] = [];
    let yy = fb.top - box.top;
    for (let cy = 0; cy < vCells; cy++) {
      let xx = fb.left - box.left;
      for (let cx = 0; cx < hCells; cx++) {
        cells.push({ x: xx, y: yy, w: widths[cx] ?? 0, h: heights[cy] ?? 0 });
        xx += widths[cx] ?? 0;
      }
      yy += heights[cy] ?? 0;
    }
    return { box: fb, hCells, vCells, cells };
  });

  // 1단계: 픽셀 버퍼 채우기 (출처: dcc_direction.go fillPixelBuffer)
  const cellBuffer: (PBE | null)[] = new Array(dirHCells * dirVCells).fill(null);
  const pixelData: PBE[] = [];
  frames.forEach((fr, frameIndex) => {
    const originX = Math.floor((fr.box.left - box.left) / 4);
    const originY = Math.floor((fr.box.top - box.top) / 4);
    for (let cy = 0; cy < fr.vCells; cy++) {
      for (let cx = 0; cx < fr.hCells; cx++) {
        const cur = originX + cx + (cy + originY) * dirHCells;
        let mask: number;
        const old = cellBuffer[cur] ?? null;
        if (old) {
          const same = equalCellsSize > 0 ? equalCells.bits(1) : 0;
          if (same) continue;
          mask = pixelMask.bits(4);
        } else {
          mask = 0x0f;
        }
        const stack = [0, 0, 0, 0];
        let last = 0;
        const nBits = PIXEL_MASK_BITS[mask] ?? 0;
        const enc = nBits !== 0 && encodingTypeSize > 0 ? encodingType.bits(1) : 0;
        let decoded = 0;
        for (let i = 0; i < nBits; i++) {
          if (enc) stack[i] = rawPixels.bits(8);
          else {
            let disp = codes.bits(4);
            stack[i] = last + disp;
            while (disp === 15) {
              disp = codes.bits(4);
              stack[i] = (stack[i] ?? 0) + disp;
            }
          }
          if (stack[i] === last) {
            stack[i] = 0;
            break;
          }
          last = stack[i] ?? 0;
          decoded++;
        }
        const entry: PBE = { value: [0, 0, 0, 0], frame: frameIndex, cellIndex: cx + cy * fr.hCells };
        let ci = decoded - 1;
        for (let i = 0; i < 4; i++) {
          if (mask & (1 << i)) entry.value[i] = ci >= 0 ? stack[ci--] ?? 0 : 0;
          else entry.value[i] = old?.value[i] ?? 0;
        }
        cellBuffer[cur] = entry;
        pixelData.push(entry);
      }
    }
  });
  // 팔레트 엔트리 인덱스 → 실제 팔레트 인덱스. 복사된 값도 변환 전 인덱스이므로 마지막에 한 번에 변환한다.
  for (const e of pixelData) {
    for (let i = 0; i < 4; i++) e.value[i] = paletteEntries[e.value[i] ?? 0] ?? 0;
  }

  // 2단계: 프레임 생성 (출처: dcc_direction.go generateFrames)
  const W = box.width, H = box.height;
  const pixelBuffer = new Uint8Array(W * H);
  const lastCell = Array.from({ length: dirHCells * dirVCells }, () => ({ w: -1, h: -1, x: 0, y: 0 }));
  let pb = 0;
  const outFrames: DccFrame[] = frames.map((fr, frameIndex) => {
    const out = new Uint8Array(W * H);
    for (let cy = 0; cy < fr.vCells; cy++) {
      for (let cx = 0; cx < fr.hCells; cx++) {
        const cell = fr.cells[cx + cy * fr.hCells] as Cell;
        const bIndex = Math.floor(cell.x / 4) + Math.floor(cell.y / 4) * dirHCells;
        const bc = lastCell[bIndex] as { w: number; h: number; x: number; y: number };
        const pbe = pixelData[pb];
        if (!pbe || pbe.frame !== frameIndex || pbe.cellIndex !== cx + cy * fr.hCells) {
          if (cell.w !== bc.w || cell.h !== bc.h) {
            for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) pixelBuffer[x + cell.x + (y + cell.y) * W] = 0;
          } else {
            for (let y = 0; y < cell.h; y++)
              for (let x = 0; x < cell.w; x++)
                pixelBuffer[x + cell.x + (y + cell.y) * W] = pixelBuffer[x + bc.x + (y + bc.y) * W] ?? 0;
            for (let y = 0; y < cell.h; y++)
              for (let x = 0; x < cell.w; x++) out[x + cell.x + (y + cell.y) * W] = pixelBuffer[x + cell.x + (y + cell.y) * W] ?? 0;
          }
        } else {
          if (pbe.value[0] === pbe.value[1]) {
            for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) pixelBuffer[x + cell.x + (y + cell.y) * W] = pbe.value[0];
          } else {
            const nb = pbe.value[1] !== pbe.value[2] ? 2 : 1;
            for (let y = 0; y < cell.h; y++)
              for (let x = 0; x < cell.w; x++) pixelBuffer[x + cell.x + (y + cell.y) * W] = pbe.value[codes.bits(nb) & 3] ?? 0;
          }
          for (let y = 0; y < cell.h; y++)
            for (let x = 0; x < cell.w; x++) out[x + cell.x + (y + cell.y) * W] = pixelBuffer[x + cell.x + (y + cell.y) * W] ?? 0;
          pb++;
        }
        bc.w = cell.w;
        bc.h = cell.h;
        bc.x = cell.x;
        bc.y = cell.y;
      }
    }
    return { box: fr.box, pixels: out };
  });
  return { box, frames: outFrames };
}
