// 방(8×8 타일) 단위 타일 격자: 프리셋 방(DS1 레이어 뷰)과 야외 방(기본 잔디 + 흙길 + LvlSub 치환).
// 출처: D2MOO DrlgOutPlace.cpp DRLGOUTPLACE_CreateOutdoorRoomEx, DRLGOUTPLACE_InitOutdoorRoomGrids
// 출처: D2MOO DrlgOutdoors.cpp DRLG_OUTDOORS_GenerateDirtPath (byte_6FDCF958 흙길 타일 표)
// 출처: D2MOO DrlgTileSub.cpp sub_6FD8AA80, DRLGTILESUB_DoSubstitutions, sub_6FD8ACE0, sub_6FD8B010, DRLGTILESUB_PickSubThemes
// 출처: D2MOO DrlgDrlgRoom.cpp DRLGROOM_AllocRoomEx (방 시드), DrlgRoomTile.cpp DRLGROOMTILE_InitRoomGrids
// 출처: D2MOO DrlgPreset.cpp DRLGPRESET_InitPresetRoomGrids, DRLGPRESET_ParseDS1File (오브젝트 프리셋 번호 변환),
//       DRLGPRESET_GetObjectIndexFromObjPreset (Act 1 행)
import { Rng } from '../rng';
import type { Ds1 } from '../../formats/ds1';
import { DrlgGrid, Op, drawLine, type Box } from './grid';
import type { OutdoorLevel } from './outdoors';
import { ROOM, type DrlgData, type LvlSubRec } from './types';

/** 원시 레이어를 복사 없이 부호 있는 32비트 뷰로 */
export const asI32 = (a: Uint32Array): Int32Array => new Int32Array(a.buffer, a.byteOffset, a.length);

/** 방 안의 프리셋 유닛 (좌표: 방 기준 서브타일) */
export interface RoomUnit {
  type: number; id: number; x: number; y: number; code?: string;
  /** DS1 유닛 플래그 (bit 1 = 배치 안 함 — 원작 bSpawned & 1) */
  flags?: number;
  /** DS1 유닛 경로 (서브타일, 유닛과 같은 좌표계, 점마다 원작 경로 동작) — 원작 pMapAI (Countess 불벽 지점, 마을 NPC 동작) */
  path?: { x: number; y: number; action?: number }[];
}

/** 유닛과 경로를 함께 옮긴다 */
export function shiftUnit<T extends RoomUnit>(u: T, dx: number, dy: number): T {
  const out = { ...u, x: u.x + dx, y: u.y + dy };
  if (u.path) out.path = u.path.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  return out;
}

export interface RoomBuild {
  /** 레벨 기준 타일 좌표 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** (w+1)×(h+1) 격자 — 마지막 행/열은 이웃 방과 겹치는 가장자리 */
  floors: DrlgGrid[];
  walls: DrlgGrid[];
  types: DrlgGrid[];
  shadow: DrlgGrid | null;
  killEdgeX: boolean;
  killEdgeY: boolean;
  /** LvlTypes 파일 비트 마스크 (원작 dwDT1Mask) */
  dt1Mask: number;
  /** 원작 DRLGROOMFLAG_* */
  flags: number;
  units: RoomUnit[];
  /** 프리셋 Def (야외 방은 0) */
  prest: number;
}

// 출처: DrlgPreset.cpp dword_6FDE1180[0] — Act 1 DS1 오브젝트 번호 → objects.txt 번호 (Act 2~5 행은 이 단계 범위 밖)
const OBJ_PRESET_ACT1 = [
  12, 37, 39, 35, 36, 5, 17, 18, 19, 20, 21, 22, 30, 70, 70, 69, 69, 29, 31, 33, 34, 37, 61, 65, 66,
  8, 26, 28, 82, 2, 81, 84, 83, 78, 61, 103, 108, 119, 580, 130, 159, 163, 169, 160, 161, 162, 104, 105, 106, 107,
  179, 180, 119, 157, 247, 248, 155, 174, 175, 139, 140, 141, 144, 6, 240, 241, 242, 54, 55, 56, 57, 58, 171, 178, 239,
  245, 250, 111, 138, 132, 164, 165, 77, 85, 86, 262, 263, 264, 265, 50, 51, 79, 53, 1, 3, 7, 46, 38, 256, 257,
  258, 129, 267, 268, 269, 581, 351, 352, 353, 374, 385, 397, 321,
];

/**
 * DS1 유닛 → 원작 프리셋 유닛 (좌표는 DS1 기준 서브타일). 오브젝트 번호만 변환하고 몬스터는 DS1 번호 그대로 둔다.
 * 출처: DRLGPRESET_ParseDS1File (UNIT_OBJECT: 버전 > 5 이면 150 이상 → -150, 아니면 obj preset 표)
 * 근사(원작 미확인): 몬스터 MonPreset 변환은 몬스터 배치 단계(Phase 9)에서 다룬다.
 */
export function ds1Units(d: Ds1): RoomUnit[] {
  const out: RoomUnit[] = [];
  for (const o of d.objects) {
    let id = o.id;
    if (o.type === 2) {
      if (d.version > 5) id = id >= 150 ? id - 150 : d.act === 0 ? OBJ_PRESET_ACT1[id] ?? 0 : -1;
      else if (id === 573) id = -1;
      // 원작: 표 값 0 은 ObjPreset 끝 표시 — 번호 0 오브젝트로 그대로 둔다
    }
    if (id < 0) continue;
    const u: RoomUnit = { type: o.type, id, x: o.x, y: o.y };
    if (o.flags) u.flags = o.flags;
    if (o.type === 1 && o.path.length) u.path = o.path.map((p) => ({ x: p.x, y: p.y, action: p.action }));
    out.push(u);
  }
  return out;
}

/** 출처: DrlgOutdoors.cpp byte_6FDCF958 — 3×3 이웃 흙길 비트 → 흙길 바닥 타일 sequence */
const DIRT_TILE = [
  0x00, 0x00, 0x10, 0x10, 0x00, 0x00, 0x10, 0x10, 0x0e, 0x0e, 0x06, 0x13, 0x0e, 0x0e, 0x06, 0x13,
  0x0f, 0x0f, 0x05, 0x05, 0x0f, 0x0f, 0x15, 0x15, 0x08, 0x08, 0x0a, 0x26, 0x08, 0x08, 0x28, 0x14,
  0x00, 0x00, 0x10, 0x10, 0x00, 0x00, 0x10, 0x10, 0x0e, 0x0e, 0x06, 0x13, 0x0e, 0x0e, 0x06, 0x13,
  0x0f, 0x0f, 0x05, 0x05, 0x0f, 0x0f, 0x15, 0x15, 0x08, 0x08, 0x0a, 0x26, 0x08, 0x08, 0x28, 0x14,
  0x0d, 0x0d, 0x07, 0x07, 0x0d, 0x0d, 0x0d, 0x07, 0x04, 0x04, 0x0b, 0x25, 0x04, 0x04, 0x0b, 0x2b,
  0x03, 0x03, 0x0c, 0x0c, 0x03, 0x03, 0x27, 0x27, 0x09, 0x09, 0x02, 0x2b, 0x09, 0x09, 0x2c, 0x1a,
  0x0d, 0x0d, 0x07, 0x07, 0x0d, 0x0d, 0x0d, 0x07, 0x17, 0x17, 0x29, 0x11, 0x17, 0x17, 0x29, 0x11,
  0x03, 0x03, 0x0c, 0x0c, 0x03, 0x03, 0x27, 0x27, 0x2a, 0x2a, 0x2e, 0x2a, 0x2a, 0x2a, 0x21, 0x1f,
  0x00, 0x00, 0x10, 0x10, 0x00, 0x00, 0x10, 0x10, 0x0e, 0x0e, 0x06, 0x13, 0x0e, 0x0e, 0x06, 0x13,
  0x0f, 0x0f, 0x05, 0x05, 0x0f, 0x0f, 0x15, 0x15, 0x08, 0x08, 0x0a, 0x26, 0x08, 0x08, 0x23, 0x14,
  0x00, 0x00, 0x10, 0x10, 0x00, 0x00, 0x10, 0x10, 0x0e, 0x0e, 0x06, 0x13, 0x0e, 0x0e, 0x06, 0x13,
  0x0f, 0x0f, 0x05, 0x05, 0x0f, 0x0f, 0x15, 0x15, 0x08, 0x08, 0x0a, 0x26, 0x08, 0x08, 0x28, 0x14,
  0x0d, 0x0d, 0x07, 0x07, 0x0d, 0x0d, 0x0d, 0x07, 0x04, 0x04, 0x0b, 0x25, 0x04, 0x04, 0x0b, 0x25,
  0x12, 0x12, 0x23, 0x23, 0x12, 0x12, 0x16, 0x16, 0x24, 0x24, 0x2d, 0x22, 0x24, 0x24, 0x1c, 0x1d,
  0x0d, 0x0d, 0x07, 0x07, 0x0d, 0x0d, 0x0d, 0x07, 0x17, 0x17, 0x29, 0x11, 0x17, 0x17, 0x29, 0x11,
  0x12, 0x12, 0x23, 0x23, 0x12, 0x12, 0x16, 0x16, 0x18, 0x18, 0x19, 0x20, 0x18, 0x18, 0x1e, 0x01,
];

/** 출처: DRLG_OUTDOORS_GenerateDirtPath — 레벨 흙길 선분을 방 격자(가장자리 1칸 포함)에 그리고 이웃 모양으로 타일 선택 */
function generateDirtPath(lv: OutdoorLevel, room: RoomBuild, worldX: number, worldY: number): void {
  const grid = new DrlgGrid(room.w + 3, room.h + 3);
  const box: Box = { x: worldX - 1, y: worldY - 1, w: room.w + 3, h: room.h + 3 };
  for (let i = 0; i < lv.nVertices; i++)
    for (let v = lv.pathStarts[i] ?? null; v; v = v.nextOpen) if (v.nextOpen) drawLine(grid, v, box, 1, Op.OR, 2);
  const floor = room.floors[0] as DrlgGrid;
  const idx = (ox: number, oy: number) => (1 + ox) * 3 + (2 - (1 + oy));
  for (let nx = 1; nx <= room.w + 1; nx++) {
    const f = new Array<number>(9).fill(0);
    const sy = room.h + 1;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) f[idx(ox, oy)] = grid.get(nx + ox, sy + oy);
    for (let ny = sy; ny >= 1; ny--) {
      if (f[idx(0, 0)]) {
        let bits = 0;
        for (let b = 8; b >= 0; b--) {
          if (b === idx(0, 0)) continue;
          bits <<= 1;
          if (f[b]) bits |= 1;
        }
        if (bits) {
          const t = DIRT_TILE[bits] as number;
          if (t) floor.alter(nx - 1, ny - 1, (t << 8) | 0x82, Op.OVERWRITE);
        }
      }
      if (ny >= 2) {
        for (let k = 0; k < 8; k++) f[k] = f[k + 1] as number;
        f[idx(-1, -1)] = grid.get(nx - 1, ny - 2);
        f[idx(0, -1)] = grid.get(nx, ny - 2);
        f[idx(1, -1)] = grid.get(nx + 1, ny - 2);
      }
    }
  }
}

interface SubCtx { room: RoomBuild; seed: Rng; subTheme: number }

/** LvlSub 파일 격자 (출처: DRLGTILESUB_InitializeDrlgFile) */
function lvlSubGrids(data: DrlgData, rec: LvlSubRec) {
  const d = data.ds1(rec.file);
  const raw = d.raw;
  if (!raw) throw new Error(`LvlSub file without raw layers: ${rec.file}`);
  const mk = (a: Uint32Array | undefined) => (a ? new DrlgGrid(d.width, d.height, asI32(a)) : null);
  return { d, groups: raw.groups, floor: mk(raw.floors[0]), walls: raw.walls.map((w) => mk(w) as DrlgGrid), types: raw.tileTypes.map((t) => mk(t) as DrlgGrid), shadow: mk(raw.shadow), units: ds1Units(d) };
}
type SubGrids = ReturnType<typeof lvlSubGrids>;
type Grp = { x: number; y: number; w: number; h: number };

/** 출처: sub_6FD8B010 — 치환 대상 칸이 기본 잔디(style 0, sequence 0)이고 벽이 없어야 함 */
function substFits(c: SubCtx, a1: number, a2: number, g: Grp, s: SubGrids): boolean {
  for (let j = 0; j < g.h; j++)
    for (let i = 0; i < g.w; i++) {
      const ff = s.floor ? s.floor.get(i + g.x, j + g.y) : 0;
      const wf = s.walls[0] && s.walls[0].w ? s.walls[0].get(i + g.x, j + g.y) : 0;
      if (ff & 2 || wf & 1) {
        const f = (c.room.floors[0] as DrlgGrid).get(a1 + i, a2 + j);
        if (f & 0x3f0ff00 || !(f & 2)) return false;
        if ((c.room.walls[0] as DrlgGrid).get(a1 + i, a2 + j) & 1) return false;
      }
    }
  return true;
}

/** 출처: sub_6FD8ACE0 — 치환 그룹을 방 격자에 복사 (바닥·벽 레이어 0·타일 종류·그림자·프리셋 유닛) */
function substApply(c: SubCtx, nx: number, ny: number, g: Grp, s: SubGrids, a7: number): void {
  const room = c.room;
  for (let j = 0; j < g.h; j++)
    for (let i = 0; i < g.w; i++) {
      const fx = i + g.x + a7, fy = j + g.y;
      let f = s.floor ? s.floor.get(fx, fy) : 0;
      if (f & 2) {
        f |= 0x80;
        (room.floors[0] as DrlgGrid).alter(nx + i, ny + j, f, Op.OVERWRITE);
      }
      for (let layer = 0; layer < s.walls.length; layer++) {
        const wf = (s.walls[layer] as DrlgGrid).get(fx, fy);
        // 원작: 야외 방은 벽 격자 1 개(pWallsGrids[0])만 연결되어 있다
        if (wf & 1 && layer === 0) (room.walls[0] as DrlgGrid).alter(nx + i, ny + j, wf, Op.OVERWRITE);
        const tt = (s.types[layer] as DrlgGrid).get(fx, fy);
        if (tt && layer === 0) (room.types[0] as DrlgGrid).alter(nx + i, ny + j, tt, Op.OVERWRITE);
      }
      const sh = s.shadow ? s.shadow.get(fx, fy) : 0;
      if (sh & 0x8000000) (room.shadow as DrlgGrid).alter(nx + i, ny + j, sh, Op.OVERWRITE);
    }
  const minX = g.x * 5, minY = g.y * 5, maxX = g.w * 5, maxY = g.h * 5;
  for (const u of s.units) {
    if (u.x > minX && u.x < minX + maxX && u.y > minY && u.y < minY + maxY) {
      room.units.push(shiftUnit(u, nx * 5 - minX, ny * 5 - minY));
    }
  }
}

/** 출처: DRLGTILESUB_DoSubstitutions */
function doSubstitutions(data: DrlgData, c: SubCtx, rec: LvlSubRec): void {
  const s = lvlSubGrids(data, rec);
  const ng = s.groups.length;
  if (!ng) return;
  const max = rec.max[c.subTheme] ?? 0;
  for (let k = 0; k < max; k++) {
    const g = s.groups[c.seed.pick(ng)] as Grp;
    const ax = c.room.w - g.w, ay = c.room.h - g.h;
    if (ax <= 0 || ay <= 0) continue;
    const trials = rec.trials[c.subTheme] ?? 0;
    if (trials !== -1) {
      for (let i = 0; i < trials; i++) {
        const x = c.seed.pick(ax) + 1, y = c.seed.pick(ay) + 1;
        if (substFits(c, x, y, g, s)) {
          substApply(c, x, y, g, s, 0);
          break;
        }
      }
    } else {
      const area = ax * ay;
      const t: { x: number; y: number }[] = [];
      for (let i = 0; i < area; i++) t.push({ x: i % ax, y: Math.trunc(i / ax) });
      for (let i = 0; i < area; i++) {
        const r1 = c.seed.pick(area), r2 = c.seed.pick(area);
        const tmp = t[r1] as { x: number; y: number };
        t[r1] = t[r2] as { x: number; y: number };
        t[r2] = tmp;
      }
      for (const p of t) {
        if (substFits(c, p.x + 1, p.y + 1, g, s)) {
          substApply(c, p.x + 1, p.y + 1, g, s, 0);
          break;
        }
      }
    }
  }
}

/** 출처: sub_6FD8AA80 — 고른 테마 비트마다 해당 LvlSub 행으로 치환 (CheckAll 행은 Act 1 에 없음) */
function applySubTheme(data: DrlgData, c: SubCtx, subType: number, picked: number): void {
  if (subType === -1) return;
  let ri = data.lvlSub.findIndex((r) => r.type === subType);
  if (ri < 0) return;
  for (let flag = picked; flag; flag >>>= 1, ri++) {
    if (!(flag & 1)) continue;
    const rec = data.lvlSub[ri];
    if (!rec) break;
    // 근사(원작 미확인): CheckAll=1 (고정/무작위 전체 검사) 분기는 Act 1 LvlSub 에 쓰이지 않아 생략
    if (!rec.checkAll) doSubstitutions(data, c, rec);
  }
}

/** 출처: DRLGTILESUB_PickSubThemes — 행마다 확률로 테마 비트 선택, 고른 행의 DT1 마스크 추가 */
function pickSubThemes(data: DrlgData, seed: Rng, room: RoomBuild, subType: number, subTheme: number): number {
  if (subType === -1 || subTheme === -1) return 0;
  let ri = data.lvlSub.findIndex((r) => r.type === subType);
  let mask = 0, n = 0;
  for (; ri >= 0 && ri < data.lvlSub.length && (data.lvlSub[ri] as LvlSubRec).type === subType; ri++, n++) {
    const rec = data.lvlSub[ri] as LvlSubRec;
    if (seed.roll() % 100 < (rec.prob[subTheme] ?? 0)) {
      mask |= 1 << n;
      room.dt1Mask |= rec.dt1Mask;
    }
  }
  return mask;
}

/** 원작 방 시드 (출처: DRLGROOM_AllocRoomEx — 레벨 시드 1 회 롤 → 방 시드, 방 시드 1 회 롤 → dwInitSeed) */
export function allocRoomSeed(levelSeed: Rng): { seed: Rng; initSeed: number } {
  const seed = new Rng(levelSeed.roll());
  const initSeed = seed.roll();
  return { seed, initSeed };
}

/**
 * 야외 방 생성 (레벨 격자 셀 하나).
 * 출처: DRLGOUTPLACE_CreateOutdoorRoomEx + DRLGROOMTILE_InitRoomGrids → DRLGOUTPLACE_InitOutdoorRoomGrids
 */
export function buildOutdoorRoom(data: DrlgData, lv: OutdoorLevel, cx: number, cy: number, roomFlags: number, dt1Mask: number): RoomBuild {
  const w = 8, h = 8;
  const room: RoomBuild = {
    x: cx * 8, y: cy * 8, w, h,
    floors: [new DrlgGrid(w + 1, h + 1)], walls: [new DrlgGrid(w + 1, h + 1)], types: [new DrlgGrid(w + 1, h + 1)], shadow: new DrlgGrid(w + 1, h + 1),
    killEdgeX: false, killEdgeY: false, dt1Mask, flags: roomFlags | 0x80000, units: [], prest: 0,
  };
  const { seed, initSeed } = allocRoomSeed(lv.seed);
  const rec = lv.rec;
  const subThemePicked = pickSubThemes(data, seed, room, rec.subType, rec.subTheme);
  // 출처: DRLGROOMTILE_InitRoomGrids — SEED_InitLowSeed(dwInitSeed)
  const s = new Rng(initSeed);
  const floor = room.floors[0] as DrlgGrid;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) floor.alter(j, i, 0x40002, Op.OVERWRITE);
  generateDirtPath(lv, room, lv.box.x + room.x, lv.box.y + room.y);
  const c: SubCtx = { room, seed: s, subTheme: 0 };
  const wp = (roomFlags & ROOM.WAYPOINT_MASK) >>> 16;
  const shrine = (roomFlags & ROOM.SUBSHRINE_MASK) >>> 12;
  if (wp) applySubTheme(data, c, rec.subWaypoint, wp);
  if (shrine) applySubTheme(data, c, rec.subShrine, shrine);
  c.subTheme = rec.subTheme;
  applySubTheme(data, c, rec.subType, subThemePicked);
  return room;
}

/**
 * 프리셋 맵의 방들 (8×8 조각, 또는 맵 전체 한 방). 격자는 DS1 레이어의 부분 뷰.
 * 출처: DRLGPRESET_BuildArea (bSingleRoom=0: 8×8 조각, 1: 맵 좌표 그대로 방 하나) + DRLGPRESET_InitPresetRoomData
 *       + DRLGPRESET_InitPresetRoomGrids
 * @param mapX,mapY 레벨 기준 타일 좌표, mapW/mapH 맵 크기(타일)
 * @param single 원작 bSingleRoom (미로 방: 크기 12×12 이하이면 방 하나 — DRLGMAZE_RollBasicPresets)
 */
export function buildPresetRooms(d: Ds1, prest: { def: number; killEdge: boolean; populate: boolean; dt1Mask: number }, mapX: number, mapY: number, mapW: number, mapH: number, levelSeed: Rng, single = false): RoomBuild[] {
  const raw = d.raw;
  if (!raw) throw new Error('preset DS1 without raw layers');
  const rooms: RoomBuild[] = [];
  const units = ds1Units(d).filter((u) => u.x >= 0 && u.y >= 0 && u.x < mapW * 5 && u.y < mapH * 5);
  const step = single ? Math.max(mapW, mapH, 1) : 8;
  for (let y = mapY; y < mapY + mapH; y += step)
    for (let x = mapX; x < mapX + mapW; x += step) {
      const w = Math.min(step, mapX + mapW - x), h = Math.min(step, mapY + mapH - y);
      if (!w || !h) continue;
      allocRoomSeed(levelSeed);
      const ox = x - mapX, oy = y - mapY;
      const view = (a: Uint32Array) => new DrlgGrid(w + 1, h + 1, asI32(a), ox + oy * d.width, d.width);
      const room: RoomBuild = {
        x, y, w, h,
        floors: raw.floors.map(view), walls: raw.walls.map(view), types: raw.tileTypes.map(view), shadow: view(raw.shadow),
        killEdgeX: prest.killEdge && x + w === mapX + mapW,
        killEdgeY: prest.killEdge && y + h === mapY + mapH,
        dt1Mask: prest.dt1Mask, flags: prest.populate ? 0 : ROOM.POPULATION_ZERO, units: [], prest: prest.def,
      };
      for (const u of units) {
        if (u.x >= ox * 5 && u.y >= oy * 5 && u.x < (ox + w) * 5 && u.y < (oy + h) * 5) room.units.push(shiftUnit(u, -ox * 5, -oy * 5));
      }
      rooms.push(room);
    }
  return rooms;
}
