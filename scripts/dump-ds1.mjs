#!/usr/bin/env node
// DS1 프리셋을 DT1 타일로 조립해 PNG 로 덤프 (파서 육안 검증용). 사용: node scripts/dump-ds1.mjs <ds1 경로> <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MpqArchive, MpqChain } from '../src/formats/mpq.ts';
import { parsePalette } from '../src/formats/palette.ts';
import { parseDt1, renderTile } from '../src/formats/dt1.ts';
import { parseDs1, normalizeDs1File } from '../src/formats/ds1.ts';

const [path, out] = process.argv.slice(2);
const chain = new MpqChain(['patch_d2', 'd2data'].map((n) => MpqArchive.open(readFileSync(`game-data/${n}.mpq`))));
const pal = parsePalette(chain.read('data\\global\\palette\\ACT1\\pal.dat'));
const ds1 = parseDs1(chain.read(path));
const tiles = new Map();
let missingFiles = 0;
for (const f of ds1.files) {
  const b = chain.read(normalizeDs1File(f));
  if (!b) { missingFiles++; continue; }
  for (const t of parseDt1(b)) {
    const k = `${t.orientation}:${t.mainIndex}:${t.subIndex}`;
    if (!tiles.has(k)) tiles.set(k, renderTile(t));
  }
}
const W = (ds1.width + ds1.height) * 80 + 160, H = (ds1.width + ds1.height) * 40 + 400;
const ox = ds1.height * 80, oy = 300;
const rgba = new Uint8Array(W * H * 4);
let drawn = 0, missing = 0;
const draw = (img, sx, sy) => {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const c = img.pixels[y * img.width + x]; if (!c) continue;
    const X = sx + x, Y = sy + y + img.top; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const o = (Y * W + X) * 4; rgba[o] = pal[c * 4]; rgba[o + 1] = pal[c * 4 + 1]; rgba[o + 2] = pal[c * 4 + 2]; rgba[o + 3] = 255;
  }
};
const cellAt = (layer, x, y) => layer[y * ds1.width + x];
// 바닥 → 벽 순서, 타일 좌표 (x,y) → 화면 ((x-y)*80, (x+y)*40)
for (const layer of ds1.floors) for (let y = 0; y < ds1.height; y++) for (let x = 0; x < ds1.width; x++) {
  const c = cellAt(layer, x, y); if (!c.prop1 || c.hidden) continue;
  const img = tiles.get(`0:${c.style}:${c.sequence}`); if (!img) { missing++; continue; }
  draw(img, ox + (x - y) * 80, oy + (x + y) * 40); drawn++;
}
for (let y = 0; y < ds1.height; y++) for (let x = 0; x < ds1.width; x++) for (const layer of ds1.walls) {
  const c = cellAt(layer, x, y); if (!c.prop1 || c.hidden || c.orientation === 0) continue;
  for (const o of c.orientation === 3 ? [3, 4] : [c.orientation]) {
    const img = tiles.get(`${o}:${c.style}:${c.sequence}`); if (!img) { missing++; continue; }
    draw(img, ox + (x - y) * 80, oy + (x + y) * 40 + (o >= 1 && o <= 14 ? 80 : 0)); drawn++;
  }
}
for (let i = 3; i < rgba.length; i += 4) if (!rgba[i]) { rgba[i] = 255; }
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) Buffer.from(rgba.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 6;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`ds1 v${ds1.version} ${ds1.width}x${ds1.height} files=${ds1.files.length} (missing ${missingFiles}) objects=${ds1.objects.length} drawn=${drawn} missingTiles=${missing} → ${out} ${W}x${H}`);
