// DC6 스프라이트 (UI 패널, 인벤토리 아이템, 폰트).
// 출처: Phrozen Keep — "DC6 file format" (https://d2mods.info/forum/kb/viewarticle?a=412)

export interface Dc6Frame {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** 팔레트 인덱스, 0 = 투명. 길이 width*height, 위→아래 행 순서 */
  pixels: Uint8Array;
}
export interface Dc6 { directions: number; framesPerDirection: number; frames: Dc6Frame[] }

export function parseDc6(buf: Uint8Array): Dc6 {
  if (buf.length < 24) throw new Error('dc6: too short');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = dv.getInt32(0, true);
  if (version !== 6) throw new Error(`dc6: bad version ${version}`);
  const directions = dv.getUint32(16, true);
  const framesPerDirection = dv.getUint32(20, true);
  const total = directions * framesPerDirection;
  if (24 + total * 4 > buf.length) throw new Error('dc6: frame table out of range');
  const frames: Dc6Frame[] = [];
  for (let i = 0; i < total; i++) {
    const p = dv.getUint32(24 + i * 4, true);
    if (p + 32 > buf.length) throw new Error('dc6: frame header out of range');
    const flip = dv.getInt32(p, true);
    const width = dv.getInt32(p + 4, true);
    const height = dv.getInt32(p + 8, true);
    const offsetX = dv.getInt32(p + 12, true);
    const offsetY = dv.getInt32(p + 16, true);
    const length = dv.getUint32(p + 28, true);
    if (width < 0 || height < 0 || p + 32 + length > buf.length) throw new Error('dc6: frame data out of range');
    const pixels = new Uint8Array(width * height);
    const data = buf.subarray(p + 32, p + 32 + length);
    // flip=0 이면 아래 행부터 기록된다
    let x = 0;
    let y = flip ? 0 : height - 1;
    for (let k = 0; k < data.length; ) {
      const b = data[k++] ?? 0;
      if (b === 0x80) {
        x = 0;
        y += flip ? 1 : -1;
      } else if (b & 0x80) {
        x += b & 0x7f;
      } else {
        for (let j = 0; j < b; j++) {
          const px = data[k++] ?? 0;
          if (x < width && y >= 0 && y < height) pixels[y * width + x] = px;
          x++;
        }
      }
    }
    frames.push({ width, height, offsetX, offsetY, pixels });
  }
  return { directions, framesPerDirection, frames };
}
