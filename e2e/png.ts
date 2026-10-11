import { inflateSync } from 'node:zlib';

/** Playwright 스크린샷(PNG, 8비트 RGB/RGBA, 비인터레이스) → 밝은 픽셀 비율·해시. WebGL 캔버스는 getImageData 로 못 읽어서 */
export function pngStats(buf: Buffer): { lit: number; hash: number; w: number; h: number } {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9]!;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!, src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp]! : 0, b = y ? out[row - stride + x]! : 0, c = x >= bpp && y ? out[row - stride + x - bpp]! : 0;
      let v = src[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[row + x] = v & 255;
    }
  }
  let lit = 0, hash = 0;
  for (let i = 0; i < out.length; i += bpp) {
    if (out[i]! + out[i + 1]! + out[i + 2]! > 60) lit++;
    hash = (hash * 31 + out[i]! + out[i + 1]! * 7 + out[i + 2]! * 13) | 0;
  }
  return { lit: lit / (w * h), hash, w, h };
}
