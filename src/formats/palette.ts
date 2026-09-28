// D2 팔레트 (data\global\palette\<act>\pal.dat): 256색 × BGR 3바이트 = 768바이트.
// 출처: Phrozen Keep — "Palette (.dat) file format" (BGR 순서) (https://d2mods.info/forum/kb/viewarticle?a=436)

export type Palette = Uint8Array; // RGBA 256×4, 인덱스 0 은 투명으로 취급

export function parsePalette(buf: Uint8Array): Palette {
  if (buf.length < 768) throw new Error(`palette: expected 768 bytes, got ${buf.length}`);
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4] = buf[i * 3 + 2] ?? 0;
    out[i * 4 + 1] = buf[i * 3 + 1] ?? 0;
    out[i * 4 + 2] = buf[i * 3] ?? 0;
    out[i * 4 + 3] = i === 0 ? 0 : 255;
  }
  return out;
}
