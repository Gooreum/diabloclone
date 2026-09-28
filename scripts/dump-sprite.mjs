#!/usr/bin/env node
// 원작 스프라이트(DC6/DCC)를 팔레트 적용해 PNG 로 덤프 (디코더 육안 검증용)
// 사용: node scripts/dump-sprite.mjs <mpq 내부 경로> <out.png> [dir] [cols]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MpqArchive, MpqChain } from '../src/formats/mpq.ts';
import { parsePalette } from '../src/formats/palette.ts';
import { parseDc6 } from '../src/formats/dc6.ts';
import { parseDcc } from '../src/formats/dcc.ts';

const [path, outPath, dirArg = '0', colsArg = '8'] = process.argv.slice(2);
const chain = new MpqChain(['patch_d2', 'd2char', 'd2data'].map((n) => MpqArchive.open(readFileSync(`game-data/${n}.mpq`))));
const pal = parsePalette(chain.read('data\\global\\palette\\ACT1\\pal.dat'));
const buf = chain.read(path);
if (!buf) throw new Error('not found: ' + path);
let frames;
if (/\.dc6$/i.test(path)) frames = parseDc6(buf).frames.map((f) => ({ w: f.width, h: f.height, px: f.pixels }));
else {
  const d = parseDcc(buf).directions[Number(dirArg)];
  frames = d.frames.map((f) => ({ w: d.box.width, h: d.box.height, px: f.pixels }));
}
const cols = Math.min(Number(colsArg), frames.length);
const cw = Math.max(...frames.map((f) => f.w)), ch = Math.max(...frames.map((f) => f.h));
const rows = Math.ceil(frames.length / cols);
const W = cw * cols, H = ch * rows;
const rgba = new Uint8Array(W * H * 4).fill(40);
frames.forEach((f, i) => {
  const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const c = f.px[y * f.w + x]; if (!c) continue;
    const o = ((oy + y) * W + ox + x) * 4;
    rgba[o] = pal[c * 4]; rgba[o + 1] = pal[c * 4 + 1]; rgba[o + 2] = pal[c * 4 + 2]; rgba[o + 3] = 255;
  }
});
for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(outPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${outPath}: ${frames.length} frames ${cw}x${ch}`);
