#!/usr/bin/env node
// 프리셋 레벨의 충돌 맵을 등각으로 그려 PNG 로 덤프 (서브타일 플래그 배치 검증용)
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MpqArchive, MpqChain } from '../src/formats/mpq.ts';
import { parsePalette } from '../src/formats/palette.ts';
import { parseDt1, renderTile } from '../src/formats/dt1.ts';
import { parseDs1, normalizeDs1File } from '../src/formats/ds1.ts';
import { buildPresetLevel } from '../src/engine/drlg/preset.ts';

const [path, out] = process.argv.slice(2);
const chain = new MpqChain(['patch_d2', 'd2data'].map((n) => MpqArchive.open(readFileSync(`game-data/${n}.mpq`))));
const pal = parsePalette(chain.read('data\\global\\palette\\ACT1\\pal.dat'));
const ds1 = parseDs1(chain.read(path));
const dt1s = ds1.files.map((f) => chain.read(normalizeDs1File(f))).filter(Boolean).map(parseDt1);
const lvl = buildPresetLevel(ds1, dt1s, 1);
const imgs = lvl.tiles.map((t) => renderTile(t));
const W = (lvl.widthTiles + lvl.heightTiles) * 80 + 160, H = (lvl.widthTiles + lvl.heightTiles) * 40 + 400;
const ox = lvl.heightTiles * 80, oy = 300;
const rgba = new Uint8Array(W * H * 4);
const draw = (img, sx, sy) => { for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const c = img.pixels[y * img.width + x]; if (!c) continue; const X = sx + x, Y = sy + y + img.top; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const o = (Y * W + X) * 4; rgba[o] = pal[c * 4]; rgba[o + 1] = pal[c * 4 + 1]; rgba[o + 2] = pal[c * 4 + 2]; rgba[o + 3] = 255; } };
for (const t of lvl.floors) draw(imgs[t.tileIndex], ox + (t.x - t.y) * 80, oy + (t.x + t.y) * 40);
for (const t of lvl.walls) draw(imgs[t.tileIndex], ox + (t.x - t.y) * 80, oy + (t.x + t.y) * 40 + (t.orientation >= 1 && t.orientation <= 14 ? 80 : 0));
// 막힌 서브타일: 빨간 마름모 점 (서브타일 (sx,sy) → 화면 ((sx-sy)*16, (sx+sy)*8) + 타일 원점 보정 +80 가로 중앙)
const cm = lvl.collision;
for (let y = 0; y < cm.height; y++) for (let x = 0; x < cm.width; x++) if (!cm.walkable(x, y)) {
  const cx = ox + 80 + (x - y) * 16, cy = oy + (x + y) * 8 + 8;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -6; dx <= 6; dx++) { if (Math.abs(dx) / 6 + Math.abs(dy) / 3 > 1) continue; const X = cx + dx, Y = cy + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const o = (Y * W + X) * 4; rgba[o] = 255; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = 255; }
}
for (let i = 3; i < rgba.length; i += 4) if (!rgba[i]) rgba[i] = 255;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) Buffer.from(rgba.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 6;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`collision ${cm.width}x${cm.height}, blocked=${[...Array(cm.width * cm.height).keys()].filter((i) => !cm.walkable(i % cm.width, Math.floor(i / cm.width))).length}`);
