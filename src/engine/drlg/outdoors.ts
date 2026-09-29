// Act 1 야외 레벨의 8×8 타일 셀 격자 생성 (프리셋 배치·테두리·강·절벽 동굴·마을 전환·동굴 입구·흙길·웨이포인트·신전·특수 프리셋).
// 출처: D2MOO DrlgOutdoors.cpp DRLGOUTDOORS_GenerateLevel (격자 단계), DRLGOUTDOORS_SpawnOutdoorLevelPresetEx,
//       TestOutdoorLevelPreset, TestGridCellSpawnValid, SpawnPresetFarAway, SpawnOutdoorLevelPreset, SpawnRandomOutdoorDS1,
//       SpawnAct12Waypoint, SpawnAct12Shrines, AddAct124SecondaryBorder, GetOutLinkVisFlag, SpawnAct1DirtPaths,
//       CalculatePathCoordinates, sub_6FD7F5B0, sub_6FD7F810
// 출처: D2MOO DrlgOutPlace.cpp DRLGOUTPLACE_SetOutGridLinkFlags, PlaceAct1245OutdoorBorders, SetBlankBorderGridCells,
//       sub_6FD80BE0/80C10 (테두리 프리셋 표), sub_6FD80750 (흙길 격자 경로 탐색)
// 출처: D2MOO DrlgOutWild.cpp DRLGOUTWILD_InitAct1OutdoorLevel, TestSpawnRiver, SpawnRiver, SpawnCliffCaves,
//       SpawnTownTransitionsAndCaves, SpawnSpecialPresets, SpawnCottage, GetBridgeCoords
// 출처: D2MOO DrlgTileSub.cpp DRLGTILESUB_AddSecondaryBorder, TestReplaceSubPreset, ReplaceSubPreset
// 출처: D2MOO PathMisc.cpp sub_6FDAB610 / sub_6FDAB750 (방향 인덱스)
import type { Rng } from '../rng';
import type { Act1Placement, PlacedLevel } from './act1-link';
import { levelSeed } from './act1-link';
import { DrlgGrid, Op, alterVertexSegment, inBox, setVertexGridFlags, type Box } from './grid';
import { Vertex, coordDiff, createVertices, type Orth } from './vertex';
import { G2, LEVEL, LVLSUB, LVLTYPE, OUT, PREST, pickedFileOf, type DrlgData, type LevelRec, type LvlSubRec } from './types';

/** 야외 레벨 생성 상태 (원작 D2DrlgOutdoorInfoStrc + 레벨 시드) */
export interface OutdoorLevel {
  id: number;
  rec: LevelRec;
  /** 월드 타일 좌표 (원작 nPosX/nPosY/nWidth/nHeight) */
  box: Box;
  gw: number;
  gh: number;
  /** 0: 프리셋 Def, 1: 방 플래그(warp/웨이포인트/신전), 2: 셀 상태(G2), 3: 확장 플래그 */
  grid: [DrlgGrid, DrlgGrid, DrlgGrid, DrlgGrid];
  flags: number;
  vertex: Vertex;
  orths: Orth[];
  /** 원작 pVertices[24] (0~5 입구, 6~11 입구 경로점, 12~17 중심 경로점, 18~23 중심) */
  pv: Vertex[];
  nVertices: number;
  /** 흙길 경로 (격자 → sub_6FD7F810 후 월드 타일 좌표) */
  pathStarts: (Vertex | null)[];
  /** 원작 pLevel->pBuild: 프리셋별 파일 순환 */
  builds: Map<number, { div: number; rand: number }>;
  seed: Rng;
  placed: PlacedLevel;
}

export interface Ctx { data: DrlgData; world: Act1Placement }

const g2 = (lv: OutdoorLevel, x: number, y: number) => lv.grid[2].get(x, y);

/** 출처: DRLGOUTDOORS_TestGridCellSpawnValid — !(값 & 0x1B81) */
export function spawnValid(lv: OutdoorLevel, x: number, y: number): boolean {
  return (g2(lv, x, y) & (G2.BORDER | G2.DIRT_PATH | G2.BLANK | G2.HAS_PICKED_FILE | G2.WAYPOINT | G2.SHRINE)) === 0;
}

/** 출처: DRLGOUTDOORS_TestGridCellNonLvlLink */
const nonLvlLink = (lv: OutdoorLevel, x: number, y: number) => (g2(lv, x, y) & G2.LVL_LINK) === 0;

/** 출처: DRLGOUTDOORS_TestOutdoorLevelPreset */
export function testPreset(ctx: Ctx, lv: OutdoorLevel, x: number, y: number, prest: number, offset: number, flags: number): boolean {
  let sx = 1, sy = 1, x0 = x, y0 = y;
  if (prest) {
    const r = ctx.data.lvlPrest(prest);
    sx = Math.trunc(r.sizeX / 8);
    sy = Math.trunc(r.sizeY / 8);
  }
  if (offset) {
    if (flags & 1) { y0 -= offset; sy += offset; }
    if (flags & 2) sx += offset;
    if (flags & 4) sy += offset;
    if (flags & 8) { x0 -= offset; sx += offset; }
  }
  for (let i = y0; i < y0 + sy; i++)
    for (let j = x0; j < x0 + sx; j++) if (!lv.grid[2].inside(j, i) || !spawnValid(lv, j, i)) return false;
  return true;
}

/** 출처: DRLGOUTDOORS_SpawnOutdoorLevelPresetEx */
export function spawnPresetEx(ctx: Ctx, lv: OutdoorLevel, x: number, y: number, prest: number, picked: number, border: boolean): void {
  const r = ctx.data.lvlPrest(prest);
  const sx = Math.trunc(r.sizeX / 8), sy = Math.trunc(r.sizeY / 8);
  if (picked === -1) {
    let b = lv.builds.get(prest);
    if (!b) {
      b = { div: r.files, rand: lv.seed.pick(r.files) };
      lv.builds.set(prest, b);
    }
    // 원작: nDivisor 가 0 이면 0 나눗셈 — 호출되지 않는 경로 (Files=0 프리셋은 항상 파일을 지정해 호출)
    b.rand = b.div ? (b.rand + 1) % b.div : 0;
    picked = b.rand;
  }
  const isBorder = (prest >= PREST.WILD_BORDER_1 && prest <= PREST.WILD_BORDER_12) || (prest >= PREST.ACT2_DESERT_BORDER_1 && prest <= PREST.ACT2_DESERT_BORDER_12);
  for (let j = y; j < y + sy; j++)
    for (let i = x; i < x + sx; i++) {
      lv.grid[2].alter(i, j, G2.PICKED_FILE_MASK, Op.AND_NEGATED);
      lv.grid[2].alter(i, j, G2.HAS_PICKED_FILE | ((picked & 0xf) << 16), Op.OR);
      if (border && isBorder) lv.grid[2].alter(i, j, G2.BORDER, Op.OR);
      lv.grid[0].alter(i, j, 0, Op.OVERWRITE);
    }
  lv.grid[0].alter(x, y, prest, Op.OVERWRITE);
}

/** 출처: DRLGOUTDOORS_SpawnPresetFarAway — 기준 상자(마을)에서 가장 먼 가능 위치 */
function spawnPresetFarAway(ctx: Ctx, lv: OutdoorLevel, from: Box, prest: number, rand: number, offset: number, flags: number): boolean {
  const w = lv.gw - 2, h = lv.gh - 2;
  const rx = lv.seed.pick(w), ry = lv.seed.pick(h);
  const bx = from.x + Math.trunc(from.w / 2), by = from.y + Math.trunc(from.h / 2);
  let fx = -1, fy = -1, best = 0;
  for (let i = 0; i <= h; i++) {
    const py = ((i + ry) % h) + 1;
    for (let j = 0; j <= w; j++) {
      const px = ((j + rx) % w) + 1;
      if (!testPreset(ctx, lv, px, py, prest, offset, flags)) continue;
      const ax = Math.abs(8 * px - bx + lv.box.x + 4), ay = Math.abs(8 * py - by + lv.box.y + 4);
      const t = ax <= ay ? ax + 2 * ay : ay + 2 * ax;
      if (best < Math.trunc(t / 2)) {
        best = Math.trunc(t / 2);
        fx = px;
        fy = py;
      }
    }
  }
  if (fx === -1 || fy === -1) return false;
  spawnPresetEx(ctx, lv, fx, fy, prest, rand, false);
  return true;
}

/** 원작 공통 패턴: 내부 셀((gw-2)×(gh-2)) 좌표를 두 번 롤로 섞은 목록 */
export function shuffledCells(lv: OutdoorLevel): { x: number; y: number }[] {
  const w = lv.gw - 2, area = w * (lv.gh - 2);
  const c: { x: number; y: number }[] = [];
  for (let i = 0; i < area; i++) c.push({ x: i % w, y: Math.trunc(i / w) });
  for (let i = 0; i < area; i++) {
    const r1 = lv.seed.pick(area), r2 = lv.seed.pick(area);
    const t = c[r1] as { x: number; y: number };
    c[r1] = c[r2] as { x: number; y: number };
    c[r2] = t;
  }
  return c;
}

/** 출처: DRLGOUTDOORS_SpawnOutdoorLevelPreset */
export function spawnPreset(ctx: Ctx, lv: OutdoorLevel, prest: number, rand: number, offset: number, flags: number): boolean {
  const area = (lv.gw - 2) * (lv.gh - 2);
  if (!area) return false;
  for (const c of shuffledCells(lv)) {
    if (testPreset(ctx, lv, c.x + 1, c.y + 1, prest, offset, flags)) {
      spawnPresetEx(ctx, lv, c.x + 1, c.y + 1, prest, rand, false);
      return true;
    }
  }
  return false;
}

/** 출처: DRLGOUTDOORS_SpawnRandomOutdoorDS1 — 흙길 셀 이웃에 우선 배치, 실패하면 아무 곳 */
export function spawnRandomDs1(ctx: Ctx, lv: OutdoorLevel, prest: number, rand: number): boolean {
  const OX = [-1, 0, 0, 1, -1, 1, 1, -1], OY = [0, -1, 1, 0, -1, 1, -1, 1];
  const area = (lv.gw - 2) * (lv.gh - 2);
  if (!area) return false;
  if (area > 0) {
    for (const c of shuffledCells(lv)) {
      const x = c.x + 1, y = c.y + 1;
      if (!(g2(lv, x, y) & G2.DIRT_PATH)) continue;
      for (let j = 0; j < 8; j++) {
        const px = x + (OX[j] as number), py = y + (OY[j] as number);
        if (testPreset(ctx, lv, px, py, prest, 0, 15)) {
          spawnPresetEx(ctx, lv, px, py, prest, rand, false);
          return true;
        }
      }
    }
  }
  return spawnPreset(ctx, lv, prest, rand, 0, 15);
}

/** 출처: DRLGOUTDOORS_GetOutLinkVisFlag — 가장자리 꼭짓점이 닿은 이웃 레벨의 vis 비트 (1 << (i+4)) */
function outLinkVisFlag(lv: OutdoorLevel, v: Vertex): number {
  const OFF = [[-4, 4], [4, -4], [12, 4], [4, 12]] as const;
  let idx: number;
  if (v.x === 0) idx = v.y === 0 ? 1 : 0;
  else if (v.y === 0) idx = (v.x === lv.gw - 1 ? 1 : 0) + 1;
  else if (v.x === lv.gw - 1) idx = (v.y === lv.gh - 1 ? 1 : 0) + 2;
  else if (v.y === lv.gh - 1) idx = 3;
  else return 0;
  const o = OFF[idx] as readonly [number, number];
  const x = lv.box.x + o[0] + 8 * v.x, y = lv.box.y + o[1] + 8 * v.y;
  for (const r of lv.orths) {
    if (idx === r.dir && inBox(r.box, x, y)) {
      for (let i = 0; i < 8; i++) if (lv.placed.vis[i] === r.levelId) return 1 << (i + 4);
      return 0;
    }
  }
  return 0;
}

/** 출처: DRLGOUTPLACE_SetOutGridLinkFlags */
export function setOutGridLinkFlags(lv: OutdoorLevel): void {
  let v = lv.vertex;
  do {
    if (v.flags & 1) {
      alterVertexSegment(lv.grid[1], v, outLinkVisFlag(lv, v), Op.OR, true);
      alterVertexSegment(lv.grid[2], v, G2.BORDER | (v.dir !== 0 ? G2.HAS_DIRECTION : 0), Op.OR, true);
    }
    v = v.next;
  } while (v !== lv.vertex);
}

// 출처: DrlgOutPlace.cpp nBorderIndices (두 표가 메모리상 이어져 있어 한 배열로 둔다)
export const BORDER_INDICES = [
  -1, 1, -1, 0, -1, 2, -1, 3, -1, 0,
  1, 9, 9, -1, -1, 1, 8, -1, -1, 12,
  -1, -1, -1, -1, 12, 4, -1, -1, 5, 2,
  2, 10, -1, -1, -1, -1, 10, 1, 9, 9,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, 11, 11, 3, 12, -1, -1, -1, -1, 12,
  4, 4, 7, -1, -1, 2, 10, -1, -1, -1,
  -1, 10, -1, -1, 6, 3, -1, -1, 11, 11,
  3,
];
// 출처: DrlgOutPlace.cpp levelPrestBorder[13][4] (열 0 = Act1 절벽, 1 = Act1 테두리; 2/3 은 Act 2/4 — 여기서는 사용 안 함)
const P = PREST;
const BORDER_PREST: readonly (readonly [number, number])[] = [
  [-1, -1], // 원작 0 행은 쓰레기 값
  [P.NONE, P.WILD_BORDER_1],
  [P.WILD_CLIFF_BORDER_2, P.WILD_BORDER_2],
  [P.WILD_CLIFF_BORDER_3, P.WILD_BORDER_3],
  [P.NONE, P.WILD_BORDER_4],
  [P.WILD_CLIFF_BORDER_5, P.WILD_BORDER_5],
  [P.WILD_CLIFF_BORDER_6A, P.WILD_BORDER_6],
  [P.WILD_CLIFF_BORDER_7, P.WILD_BORDER_7],
  [P.NONE, P.WILD_BORDER_8],
  [P.NONE, P.WILD_BORDER_9],
  [P.WILD_CLIFF_BORDER_10, P.WILD_BORDER_10],
  [P.NONE, P.WILD_BORDER_11],
  [P.NONE, P.WILD_BORDER_12],
];

/** 출처: sub_6FD80BE0 — 직선 구간 테두리 (a3: 1 = 일반, 0 = 절벽) */
function borderStraight(dx: number, dy: number, a3: number): number {
  const idx = BORDER_INDICES[dx + 3 * dy + 4] as number;
  return (BORDER_PREST[idx + 1] as readonly [number, number])[a3] as number;
}

/** 출처: sub_6FD80C10 — 모서리 테두리 */
function borderCorner(a1: number, a2: number, a3: number, a4: number, a5: number): number {
  if (a1 > 0) a1 += 2; else if (a1 < 0) a1 -= 2;
  if (a3 > 0) a3 += 2; else if (a3 < 0) a3 -= 2;
  const v6 = BORDER_INDICES[a2 + a1 + 9 * (a4 + a3) + 50];
  if (v6 === undefined || v6 === -1) return 0;
  return (BORDER_PREST[v6] as readonly [number, number])[a5] as number;
}

/** 출처: DRLGOUTPLACE_PlaceAct1245OutdoorBorders (Act 1 분기만) */
function placeBorders(ctx: Ctx, lv: OutdoorLevel): void {
  let v = lv.vertex, n = v.next;
  do {
    let packed = G2.BORDER | (v.dir !== 0 ? G2.HAS_DIRECTION : 0);
    const cd = coordDiff(v), nd = coordDiff(n);
    let cx = v.x, cy = v.y;
    const nx = n.x, ny = n.y;
    const diff = Math.abs(cd.dx ? cx - nx : cy - ny);
    // Act 1 Wilderness: a3 = (방향 0 ? 1 : 0). 그 외 레벨 종류 분기는 Act 2/4/5 전용
    const a3 = ctx.data.level(lv.id).levelType === LVLTYPE.ACT1_WILDERNESS ? (v.dir === 0 ? 1 : 0) : -1;
    let prest = a3 >= 0 ? borderStraight(cd.dx, cd.dy, a3) : 0;
    if (!(v.flags & 2)) {
      while (cx !== nx || cy !== ny) {
        cx += cd.dx;
        cy += cd.dy;
        spawnPresetEx(ctx, lv, cx, cy, prest, -1, false);
        lv.grid[2].alter(cx, cy, packed, Op.OR);
      }
    }
    if (v.flags & 1 && !(v.flags & 2)) {
      // ACT_I: 링크 구간 중앙 셀을 레벨 연결 입구(파일 3 = 트인 테두리, Burial Grounds 는 4)로
      const mx = Math.min(v.x, n.x) + Math.trunc((Math.abs(cd.dx) * diff) / 2);
      const my = Math.min(v.y, n.y) + Math.trunc((Math.abs(cd.dy) * diff) / 2);
      lv.grid[2].alter(mx, my, G2.PICKED_FILE_MASK, Op.AND_NEGATED);
      lv.grid[2].alter(mx, my, G2.LVL_LINK | ((lv.id === LEVEL.BURIALGROUNDS ? 4 : 3) << 16), Op.OR);
    }
    let dir = v.dir;
    if (dir) packed |= G2.HAS_DIRECTION;
    else {
      dir = n.dir;
      packed = dir !== 0 ? packed | G2.HAS_DIRECTION : packed & ~G2.HAS_DIRECTION;
    }
    const v41 = a3 >= 0 ? (dir === 0 ? 1 : 0) : -1;
    if (v41 >= 0) {
      const k1 = v.flags & 2 ? 1 : 2, k2 = n.flags & 2 ? 1 : 2;
      prest = borderCorner(k1 * cd.dx, k1 * cd.dy, k2 * nd.dx, k2 * nd.dy, v41);
    } else prest = 0;
    if (prest === P.WILD_CLIFF_BORDER_6A) {
      if (v.dir === 1) {
        if (n.dir !== 1) prest = P.WILD_CLIFF_BORDER_6B;
      } else prest = P.WILD_CLIFF_BORDER_6C;
      spawnPresetEx(ctx, lv, nx, ny, prest, -1, false);
      lv.grid[2].alter(nx, ny, packed, Op.OR);
    } else if (prest !== P.NONE) {
      spawnPresetEx(ctx, lv, nx, ny, prest, -1, false);
      lv.grid[2].alter(nx, ny, packed, Op.OR);
    }
    v = n;
    n = n.next;
  } while (v !== lv.vertex);
  setBlankBorderCells(lv);
}

/** 출처: DRLGOUTPLACE_SetBlankBorderGridCells — 네 모서리에서 테두리 안쪽까지 빈 셀 표시 */
export function setBlankBorderCells(lv: OutdoorLevel): void {
  const OFFS = [[[0, 0], [1, 1]], [[1, 0], [-1, 1]], [[0, 1], [1, -1]], [[1, 1], [-1, -1]]] as const;
  for (const [[sx, sy], [dx, dy]] of OFFS) {
    const x0 = sx ? lv.gw - 1 : 0, y0 = sy ? lv.gh - 1 : 0;
    for (let j = y0; lv.grid[2].inside(x0, j) && !(g2(lv, x0, j) & G2.BORDER); j += dy)
      for (let i = x0; lv.grid[2].inside(i, j) && !(g2(lv, i, j) & G2.BORDER); i += dx) lv.grid[2].alter(i, j, G2.BLANK, Op.OR);
  }
}

/** LvlSub 행의 치환 파일 격자 (출처: DRLGTILESUB_InitializeDrlgFile — 벽 레이어 0, 바닥 레이어 0) */
function subFile(ctx: Ctx, rec: LvlSubRec) {
  const d = ctx.data.ds1(rec.file);
  const raw = d.raw;
  if (!raw) throw new Error(`LvlSub file without raw layers: ${rec.file}`);
  const wall = raw.walls[0] ? new DrlgGrid(d.width, d.height, new Int32Array(raw.walls[0].buffer, raw.walls[0].byteOffset, raw.walls[0].length)) : null;
  const floor = raw.floors[0] ? new DrlgGrid(d.width, d.height, new Int32Array(raw.floors[0].buffer, raw.floors[0].byteOffset, raw.floors[0].length)) : null;
  return { groups: raw.groups, wall, floor };
}

/** 출처: DRLGOUTDOORS_AddAct124SecondaryBorder → DRLGTILESUB_AddSecondaryBorder */
export function addSecondaryBorder(ctx: Ctx, lv: OutdoorLevel, subId: number, prestBase: number): void {
  const rows = ctx.data.lvlSub;
  let ri = rows.findIndex((r) => r.type === subId);
  let wildcard = -1;
  const wild = lv.id >= LEVEL.BLOODMOOR && lv.id <= LEVEL.TAMOEHIGHLAND;
  for (; ri >= 0 && ri < rows.length && (rows[ri] as LvlSubRec).type === subId; ri++) {
    const rec = rows[ri] as LvlSubRec;
    const f = subFile(ctx, rec);
    const ng = f.groups.length;
    if (ng <= 0) continue;
    if (wildcard === -1) wildcard = 62;
    const rand = rec.bordType ? 0 : lv.seed.pick(ng);
    let stop = false;
    for (let j = 0; j < ng && !stop; j++) {
      const grp = f.groups[(rand + j) % ng] as { x: number; y: number; w: number; h: number; alternatives: number };
      const off = subId === LVLSUB.BORDER_MIDDLE && lv.flags & 12 ? -1 : 1;
      const w = off + lv.gw - rec.gridSize * grp.w;
      const h = 1 + lv.gh - rec.gridSize * grp.h;
      const area = w * h;
      if (area <= 0) continue;
      const small = subId === LVLSUB.BORDER_MIDDLE && wild && w < 6 && h < 6;
      const c: { x: number; y: number }[] = [];
      for (let i = 0; i < area; i++) c.push({ x: i % w, y: Math.trunc(i / w) });
      for (let i = 0; i < area; i++) {
        const r1 = lv.seed.pick(area), r2 = lv.seed.pick(area);
        const t = c[r1] as { x: number; y: number };
        c[r1] = c[r2] as { x: number; y: number };
        c[r2] = t;
      }
      for (let i = 0; i < area; i++) {
        const { x, y } = c[i] as { x: number; y: number };
        if (small && x === 2 && y === 2) continue;
        if (!testReplaceSub(ctx, lv, x, y, f, grp, rec, prestBase, wildcard)) continue;
        replaceSub(ctx, lv, x, y, f, grp, rec, prestBase, wildcard, (lv.seed.pick(grp.alternatives) + 1) * (grp.w + 1));
        if (rec.bordType === 0) { stop = true; break; }
        if (rec.bordType === 1) break;
      }
    }
    // 원작: bBreak 는 그룹 루프만 끝내고 같은 Type 의 다음 LvlSub 행으로 계속 진행
  }
}

type SubF = ReturnType<typeof subFile>;
type Grp = { x: number; y: number; w: number; h: number; alternatives: number };

/** 출처: DRLGTILESUB_TestReplaceSubPreset */
function testReplaceSub(ctx: Ctx, lv: OutdoorLevel, a1: number, a2: number, f: SubF, grp: Grp, rec: LvlSubRec, prestBase: number, wildcard: number): boolean {
  const gs = rec.gridSize;
  const bx = a1 - (a1 % gs), by = a2 - (a2 % gs);
  for (let j = 0; j < grp.h; j++)
    for (let i = 0; i < grp.w; i++) {
      const fl = f.floor ? f.floor.get(i + grp.x, j + grp.y) : 0;
      const wl = f.wall ? f.wall.get(i + grp.x, j + grp.y) : 0;
      const x = bx + i * gs, y = by + j * gs;
      const cur = lv.grid[0].get(x, y);
      if (wl & 1) {
        const v18 = ((wl >>> 8) & 0xff) - 1;
        if (v18 !== wildcard && v18 + prestBase !== cur) return false;
        if (!nonLvlLink(lv, x, y)) return false;
      } else if (fl & 2) {
        if (!testPreset(ctx, lv, x, y, 0, 0, 0)) return false;
      }
    }
  return true;
}

/** 출처: DRLGTILESUB_ReplaceSubPreset */
function replaceSub(ctx: Ctx, lv: OutdoorLevel, a1: number, a2: number, f: SubF, grp: Grp, rec: LvlSubRec, prestBase: number, wildcard: number, a6: number): void {
  const gs = rec.gridSize;
  const bx = a1 - (a1 % gs), by = a2 - (a2 % gs);
  for (let j = 0; j < grp.h; j++)
    for (let i = 0; i < grp.w; i++) {
      const wl = f.wall ? f.wall.get(a6 + grp.x + i, grp.y + j) : 0;
      const fl = f.floor ? f.floor.get(a6 + grp.x + i, grp.y + j) : 0;
      const x = bx + i * gs, y = by + j * gs;
      if (wl & 1) {
        const v17 = ((wl >>> 8) & 0xff) - 1;
        const v18 = v17 + prestBase;
        if (v18 !== -5 && v17 !== wildcard) spawnPresetEx(ctx, lv, x, y, v18, 0, true);
      } else if (fl & 2) {
        // 출처: DRLGOUTDOORS_AlterAdjacentPresetGridCells — 셀을 일반 야외 방으로 되돌림
        lv.grid[0].alter(x, y, 0, Op.OVERWRITE);
        lv.grid[2].alter(x, y, 0, Op.OVERWRITE);
      } else {
        // 출처: DRLGOUTDOORS_SetBlankGridCell
        lv.grid[0].alter(x, y, 0, Op.OVERWRITE);
        lv.grid[2].alter(x, y, G2.BLANK, Op.OVERWRITE);
      }
    }
}

// ---------------- 강·다리·절벽 동굴·마을 전환 (DrlgOutWild.cpp) ----------------

/** 출처: DRLGOUTWILD_GetBridgeCoords (원작처럼 y 범위에 격자 너비를 사용) */
function bridgeCoords(lv: OutdoorLevel): { x: number; y: number } {
  const x = Math.trunc(lv.gw / 2) - 1;
  for (let y = 1; y < lv.gw - 1; y++) {
    if (lv.grid[0].get(x, y) === P.BRIDGE && pickedFileOf(g2(lv, x, y)) === 1) return { x, y };
  }
  return { x: -1, y: -1 };
}

/** 출처: DRLGOUTWILD_TestSpawnRiver */
function testSpawnRiver(lv: OutdoorLevel, x: number): boolean {
  for (let y = 0; y < lv.gh; y++) if (g2(lv, x, y) & G2.HAS_DIRECTION || g2(lv, x + 1, y) & G2.HAS_DIRECTION) return false;
  return true;
}

/** 출처: DRLGOUTWILD_SpawnRiverPreset (1.10f 인라인) */
function spawnRiverPreset(ctx: Ctx, lv: OutdoorLevel, x: number, y: number, lower: boolean): void {
  // 출처: stru_6FDD0CA0 { 위 파일, 아래 파일 } — 테두리 1~12 별
  const FILES = [[2, 2], [0, 3], [1, 1], [3, 0], [0, 2], [0, 1], [1, 0], [2, 0], [2, 3], [1, 3], [3, 1], [3, 2]] as const;
  const px = x + (lower ? 1 : 0);
  const info = g2(lv, px, y);
  const f2 = lv.grid[0].get(px, y);
  let picked: number;
  if (f2) {
    if (f2 !== P.WILD_BORDER_4 || pickedFileOf(info) !== 3) {
      const e = FILES[f2 - P.WILD_BORDER_1];
      // 근사(원작 미확인): 표 범위 밖 프리셋이면 원작은 인접 메모리를 읽는다 — 트인 파일(3) 로 둔다
      picked = e ? (lower ? e[1] : e[0]) : 3;
    } else picked = 3;
  } else picked = info & G2.BLANK ? 0 : 3;
  spawnPresetEx(ctx, lv, px, y, lower ? P.RIVER_LOWER : P.RIVER_UPPER, picked, false);
}

/** 출처: DRLGOUTWILD_SpawnRiver */
function spawnRiver(ctx: Ctx, lv: OutdoorLevel, x: number): void {
  for (let y = 0; y < lv.gh; y++) {
    spawnRiverPreset(ctx, lv, x, y, false);
    spawnRiverPreset(ctx, lv, x, y, true);
  }
  if (lv.flags & (OUT.RIVER | OUT.BRIDGE)) {
    const rows = lv.gh - 2;
    const r = lv.seed.pick(rows);
    for (let i = 0; i < rows; i++) {
      const y = ((r + i) % rows) + 1;
      if (spawnValid(lv, x - 1, y) && ((lv.flags & OUT.BRIDGE) !== 0 || spawnValid(lv, x + 2, y))) {
        if (pickedFileOf(g2(lv, x, y)) === 3 && pickedFileOf(g2(lv, x + 1, y)) === 3) {
          spawnPresetEx(ctx, lv, x, y, P.BRIDGE, 1, false);
          spawnPresetEx(ctx, lv, x + 1, y, P.BRIDGE, lv.flags & OUT.BRIDGE ? 3 : 2, false);
          return;
        }
      }
    }
  }
}

/** 출처: sub_6FD85300 */
function isCliffEnd(v: Vertex): boolean {
  const n = v.next;
  if (v.x >= n.x || n.y >= n.next.y || v.flags & 1 || n.flags & 1) {
    if (v.y <= n.y || n.x >= n.next.x || v.flags & 1 || n.flags & 1) return false;
  }
  return true;
}

/** 출처: sub_6FD85350 */
function isCliffStop(v: Vertex): boolean {
  const n = v.next;
  if (v.y >= n.y && v.x <= n.x) {
    if (!(v.flags & 1)) return (n.flags & 1) !== 0;
  }
  return true;
}

/** 출처: DRLGOUTWILD_SpawnCliffCaves */
function spawnCliffCaves(ctx: Ctx, lv: OutdoorLevel, x: number, y: number): boolean {
  switch (lv.grid[0].get(x, y)) {
    case P.WILD_CLIFF_BORDER_2:
      spawnPresetEx(ctx, lv, x, y, P.WILD_CLIFF_CAVE_LEFT, -1, false);
      lv.flags |= OUT.OUT_CAVES;
      return true;
    case P.WILD_CLIFF_BORDER_3:
      spawnPresetEx(ctx, lv, x, y, P.WILD_CLIFF_CAVE_RIGHT, -1, false);
      lv.flags |= OUT.OUT_CAVES;
      return true;
    default:
      return false;
  }
}

/** 출처: DRLGOUTWILD_SpawnTownTransitionsAndCaves */
function spawnTownTransitionsAndCaves(ctx: Ctx, lv: OutdoorLevel, town: Box | null): void {
  if (lv.id === LEVEL.MOOMOOFARM) return;
  if (lv.flags & OUT.RIVER) {
    const x = Math.trunc(lv.gw / 2) - 1;
    if (lv.gh <= 0) spawnRiver(ctx, lv, x);
    else {
      let y = 0;
      while (!(g2(lv, x, y) & G2.HAS_DIRECTION) && !(g2(lv, x + 1, y) & G2.HAS_DIRECTION)) {
        ++y;
        if (y >= lv.gh) {
          spawnRiver(ctx, lv, x);
          break;
        }
      }
    }
  }
  if (lv.flags & OUT.SOUTHWEST) spawnPresetEx(ctx, lv, 0, 0, P.TOWN_1_TRANSITION_S, 1, false);
  if (lv.flags & OUT.NORTHWEST) spawnPresetEx(ctx, lv, lv.gw - 7, 0, P.TOWN_1_TRANSITION_S, 2, false);
  if (lv.flags & OUT.SOUTHEAST) spawnPresetEx(ctx, lv, 0, 1, P.TOWN_1_TRANSITION_E, 1, false);
  if (lv.flags & OUT.NORTHEAST) spawnPresetEx(ctx, lv, 0, lv.gh - 6, P.TOWN_1_TRANSITION_E, 1, false);
  if (!(lv.flags & OUT.OUT_CAVES)) {
    if (lv.id === LEVEL.BLOODMOOR && town) spawnPresetFarAway(ctx, lv, town, P.DOE_ENTRANCE, -1, 1, 15);
    else spawnPreset(ctx, lv, P.CAVE_ENTRANCE, -1, 1, 15);
    // 원작: 실패 시 경고만 (FOG_DisplayWarning "fAdded")
    lv.flags |= OUT.OUT_CAVES;
  }
}

/** 출처: DRLGOUTWILD_SpawnCottage */
function spawnCottage(ctx: Ctx, lv: OutdoorLevel, prest: number, a3: boolean): void {
  if (lv.seed.roll() & 3) {
    spawnRandomDs1(ctx, lv, prest, -1);
    if (a3 && lv.seed.roll() & 1) spawnRandomDs1(ctx, lv, P.COTTAGES_3, -1);
  } else {
    spawnRandomDs1(ctx, lv, prest, -1);
    spawnRandomDs1(ctx, lv, prest, -1);
  }
}

/** 출처: DRLGOUTWILD_SpawnSpecialPresets (Moo Moo Farm 제외) */
function spawnSpecialPresets(ctx: Ctx, lv: OutdoorLevel): void {
  const S = (p: number) => spawnPreset(ctx, lv, p, -1, 0, 15);
  const R = (p: number) => spawnRandomDs1(ctx, lv, p, -1);
  switch (lv.id) {
    case LEVEL.BLOODMOOR:
      R(P.POND);
      if (!(lv.seed.roll() & 3)) R(P.COTTAGES_1);
      R(P.COTTAGES_1);
      S(P.STONE_FILL_1);
      S(P.STONE_FILL_2);
      return;
    case LEVEL.COLDPLAINS:
      if (lv.seed.roll() & 3) {
        R(P.COTTAGES_2);
        if (lv.seed.roll() & 1) R(P.COTTAGES_3);
      } else {
        R(P.COTTAGES_2);
        R(P.COTTAGES_2);
      }
      S(P.FALLEN_CAMP_BISHIBOSH);
      S(P.STONE_FILL_1);
      S(P.STONE_FILL_2);
      return;
    case LEVEL.STONYFIELD:
      R(P.CAIRN_STONES);
      R(P.CAMP);
      S(P.TOWER_TOME);
      if (lv.seed.roll() & 3) {
        R(P.COTTAGES_1);
        if (lv.seed.roll() & 1) R(P.COTTAGES_3);
      } else {
        R(P.COTTAGES_1);
        R(P.COTTAGES_1);
      }
      if (!(lv.seed.roll() & 3)) R(P.FALLEN_CAMP_1);
      R(P.FALLEN_CAMP_1);
      S(P.CORRAL_FILL);
      return;
    case LEVEL.DARKWOOD:
      S(P.INIFUS);
      S(P.RUIN);
      S(P.TREE_FILL);
      if (lv.seed.roll() & 3) {
        R(P.COTTAGES_2);
        if (lv.seed.roll() & 1) R(P.COTTAGES_3);
      } else {
        R(P.COTTAGES_2);
        R(P.COTTAGES_2);
      }
      if (!(lv.seed.roll() & 3)) R(P.FALLEN_CAMP_2);
      R(P.FALLEN_CAMP_2);
      S(P.STONE_FILL_1);
      S(P.STONE_FILL_2);
      return;
    case LEVEL.BLACKMARSH:
      S(P.TOWER_1);
      S(P.SWAMP_FILL_1);
      S(P.SWAMP_FILL_2);
      if (lv.seed.roll() & 3) {
        R(P.COTTAGES_1);
        if (lv.seed.roll() & 1) R(P.COTTAGES_3);
      } else {
        R(P.COTTAGES_1);
        R(P.COTTAGES_1);
      }
      if (!(lv.seed.roll() & 3)) R(P.FALLEN_CAMP_1);
      R(P.FALLEN_CAMP_1);
      S(P.STONE_FILL_1);
      S(P.STONE_FILL_2);
      return;
    case LEVEL.TAMOEHIGHLAND:
      spawnCottage(ctx, lv, P.COTTAGES_2, true);
      spawnCottage(ctx, lv, P.FALLEN_CAMP_2, false);
      S(P.CORRAL_FILL);
      return;
    case LEVEL.BURIALGROUNDS:
      spawnPresetEx(ctx, lv, 1, 1, P.GRAVEYARD, -1, false);
      return;
    default:
      return;
  }
}

// ---------------- 웨이포인트·신전 (DrlgOutdoors.cpp) ----------------

/** 출처: DRLGOUTDOORS_SpawnAct12Waypoint */
export function spawnWaypoint(lv: OutdoorLevel): void {
  if (lv.id === LEVEL.COLDPLAINS) {
    let flag = 0;
    for (let i = 0; i < 8; i++) if (lv.placed.vis[i] === LEVEL.BLOODMOOR) { flag = 1 << (i + 4); break; }
    for (let i = 0; i < lv.gh; i++)
      for (let j = 0; j < lv.gw; j++) {
        if (lv.grid[1].get(j, i) & flag && !nonLvlLink(lv, j, i)) {
          let x = j, y = i;
          if (!x) x = 1;
          if (!y) y = 1;
          if (x === lv.gw - 1) --x;
          if (y === lv.gh - 1) --y;
          lv.grid[1].alter(x, y, 0x20000, Op.OR);
          lv.grid[2].alter(x, y, G2.WAYPOINT, Op.OR);
          return;
        }
      }
  }
  const area = (lv.gw - 2) * (lv.gh - 2);
  if (area <= 0) return;
  for (const c of shuffledCells(lv)) {
    if (spawnValid(lv, c.x + 1, c.y + 1)) {
      lv.grid[1].alter(c.x + 1, c.y + 1, 0x10000, Op.OR);
      lv.grid[2].alter(c.x + 1, c.y + 1, G2.WAYPOINT, Op.OR);
      break;
    }
  }
}

/** 출처: DRLGOUTDOORS_SpawnAct12Shrines */
export function spawnShrines(lv: OutdoorLevel, count: number): void {
  const BITS = [0x1000, 0x2000, 0x4000, 0x8000];
  const area = (lv.gw - 2) * (lv.gh - 2);
  let idx = lv.seed.roll() & 3;
  if (area <= 0) return;
  for (const c of shuffledCells(lv)) {
    if (count <= 0) break;
    const x = c.x + 1, y = c.y + 1;
    if (spawnValid(lv, x, y)) {
      lv.grid[1].alter(x, y, BITS[idx] as number, Op.OR);
      lv.grid[2].alter(x, y, G2.SHRINE, Op.OR);
      idx = (idx + 1) % 4;
      --count;
    }
  }
}

// ---------------- 흙길 (DrlgOutdoors.cpp / DrlgOutPlace.cpp) ----------------

/** 출처: PathMisc.cpp sub_6FDAB610 (방향 표 인덱스) */
function pathDirIndex(x1: number, y1: number, x2: number, y2: number): number {
  let dx = x2 - x1, dy = y2 - y1;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 2 * ay) {
    if (ay >= 2 * ax) {
      if (dx < 0) {
        if (dy < -1) return 5;
        else if (dy > 1) dy = 2;
        return dy + 7;
      }
      dx &= 1;
    }
  } else {
    if (dy >= 0) dy &= 1;
    else dy = -1;
  }
  if (dx < -1) dx = -2;
  else if (dx > 1) dx = 2;
  if (dy < -1) return 5 * dx + 10;
  else if (dy > 1) dy = 2;
  return dy + 5 * dx + 12;
}
// 출처: PathMisc.cpp stru_6FDD2158[].unk0x00
const PATH_DIR = [5, 4, 4, 4, 3, 6, 5, 4, 3, 2, 6, 6, 6, 2, 2, 6, 7, 0, 1, 2, 7, 0, 0, 0, 1];
/** 출처: sub_6FDAB750 */
const pathDir = (x1: number, y1: number, x2: number, y2: number) => PATH_DIR[pathDirIndex(x1, y1, x2, y2)] as number;

/** 출처: DRLGOUTDOORS_CalculatePathCoordinates */
function calcPathCoord(lv: OutdoorLevel, v1: Vertex, v2: Vertex): void {
  v2.x = v1.x - lv.box.x;
  v2.y = v1.y - lv.box.y;
  switch (v1.dir) {
    case 0: v2.x = 8 * Math.trunc(v2.x / 8) + 11; break;
    case 1: v2.y = 8 * Math.trunc(v2.y / 8) + 11; break;
    case 2: v2.x = 8 * Math.trunc(v2.x / 8) - 5; break;
    case 3: v2.y = 8 * Math.trunc(v2.y / 8) - 5; break;
  }
  v2.x += lv.box.x;
  v2.y += lv.box.y;
}

/** 출처: sub_6FD7F5B0 — 흙길이 모이는 중심 (다리가 있으면 다리 양끝) */
function computePathHubs(lv: OutdoorLevel): void {
  const XO = [-1, 0, 0, 1], YO = [0, 1, -1, 0];
  const pv = lv.pv;
  let bx = -1, by = -1;
  if (lv.flags & OUT.RIVER) ({ x: bx, y: by } = bridgeCoords(lv));
  if (lv.flags & OUT.RIVER && bx !== -1) {
    const px = lv.box.x + 8 * bx + 3, py = lv.box.y + 8 * by + 3;
    for (let i = 0; i < lv.nVertices; i++) {
      const h = pv[18 + i] as Vertex;
      h.y = py;
      if ((pv[i] as Vertex).x <= px) { h.x = px; h.dir = 2; } else { h.dir = 0; h.x = px + 8; }
    }
  } else {
    for (let i = 0; i < lv.nVertices; i++) {
      const h = pv[18 + i] as Vertex;
      if (i) {
        h.x = (pv[18] as Vertex).x;
        h.y = (pv[18] as Vertex).y;
        h.dir = 4;
        continue;
      }
      let px: number, py: number;
      if (lv.nVertices === 1) {
        px = Math.trunc(lv.gw / 2);
        py = Math.trunc(lv.gh / 2);
      } else {
        let sx = 0, sy = 0;
        for (let j = 0; j < lv.nVertices; j++) {
          sx += (pv[j] as Vertex).x - lv.box.x;
          sy += (pv[j] as Vertex).y - lv.box.y;
        }
        px = Math.trunc(sx / (8 * lv.nVertices));
        py = Math.trunc(sy / (8 * lv.nVertices));
      }
      let nx = -1, ny = -1, found = false;
      for (let j = 0; j < 8 && !found; j++)
        for (let k = 0; k < 4; k++) {
          nx = px + j * (XO[k] as number);
          ny = py + j * (YO[k] as number);
          if (nx >= 0 && nx < lv.gw && ny >= 0 && ny < lv.gh && spawnValid(lv, nx, ny)) {
            found = true;
            break;
          }
        }
      h.x = lv.box.x + 8 * nx + 3;
      h.y = lv.box.y + 8 * ny + 3;
      h.dir = 4;
    }
  }
  for (let i = 0; i < lv.nVertices; i++) calcPathCoord(lv, pv[18 + i] as Vertex, pv[12 + i] as Vertex);
}

// 출처: DrlgOutPlace.cpp byte_6FDCFB70 / byte_6FDCFB80 / byte_6FDCFB84
const TRY_TABLE = [0, 1, 2, 3, 0, 1, 1, 1, 3, 2, 1, 2, 0, 3, 2, 1];
const STEP_X = [1, 0, -1, 0], STEP_Y = [0, 1, 0, -1];

interface PathNode {
  f0: number; f4: number; f8: number; x: number; y: number; f14: number;
  /** field_18: TRY_TABLE 안의 위치 */
  f18: number;
  idx: number;
  /** pNext: 부모(시작 쪽) */
  parent: PathNode | null;
  /** field_24: 재사용되는 자식 */
  child: PathNode | null;
}

/**
 * 출처: DrlgOutPlace.cpp sub_6FD80750 — 입구 경로점(6+i) → 중심 경로점(12+i) 사이 격자 경로 (깊이 제한을 늘려가는 DFS).
 * 결과 pathStarts[i] 는 격자 좌표 꼭짓점 목록 (끝 → 시작 순서, 원작 그대로).
 */
function findDirtPath(lv: OutdoorLevel, vid: number): boolean {
  const s = lv.pv[6 + vid] as Vertex, e = lv.pv[12 + vid] as Vertex;
  const x1 = Math.trunc((s.x - lv.box.x) / 8), y1 = Math.trunc((s.y - lv.box.y) / 8);
  const x2 = Math.trunc((e.x - lv.box.x) / 8), y2 = Math.trunc((e.y - lv.box.y) / 8);
  const dxa = Math.abs(x1 - x2), dya = Math.abs(y1 - y2);
  if (dxa + dya < 2) {
    const a = new Vertex(x1, y1), b = new Vertex(x2, y2);
    a.nextOpen = b;
    lv.pathStarts[vid] = a;
    return true;
  }
  const v18 = Math.trunc(pathDir(x1, y1, x2, y2) / 2);
  const mn = Math.min(dxa, dya), mx = Math.max(dxa, dya);
  const init = (): PathNode => ({ f0: mn + 2 * mx, f4: mn + 2 * mx, f8: 0, x: x1, y: y1, f14: -1, f18: 0, idx: v18 & 3, parent: null, child: null });
  const pool: (PathNode | null)[] = new Array(901).fill(null);
  const initNode = init();
  let v58 = initNode.f4 + Math.trunc(initNode.f4 / 2);
  const v64 = v58 + 35;
  let nextIdx = 1;
  let cur: PathNode | null = null;
  const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < lv.gw && y < lv.gh;

  for (;;) {
    const root: PathNode = init();
    pool[0] = root;
    cur = root;
    // 거절 처리: 다음 방향 시도, 3 번 실패하면 부모로 되돌아가기 (false = 경로 없음 → cur=null)
    const reject = (): boolean => {
      const c = cur as PathNode;
      if (c.f14 < 4) {
        c.f18++;
        c.idx = (c.idx + (TRY_TABLE[c.f18] ?? 0)) & 3;
      }
      c.f14++;
      if (c.f14 === 3) {
        let p = c;
        while (p !== root) {
          p = p.parent as PathNode;
          p.f18++;
          p.idx = (p.idx + (TRY_TABLE[p.f18] ?? 0)) & 3;
          p.f14++;
          if (p.f14 !== 3) {
            cur = p;
            return true;
          }
        }
        cur = null;
        return false;
      }
      return true;
    };
    let guard = 0;
    while (cur && (cur.x !== x2 || cur.y !== y2)) {
      if (++guard > 2_000_000) { cur = null; break; }
      const c: PathNode = cur;
      const tx = c.x + (STEP_X[c.idx] as number), ty = c.y + (STEP_Y[c.idx] as number);
      let accept = false;
      if (tx === x2 && ty === y2) accept = true;
      else if (inGrid(tx, ty) && !(g2(lv, tx, ty) & G2.HAS_PICKED_FILE)) {
        let q: PathNode | null = c;
        while (q && (q.x !== tx || q.y !== ty)) q = q.parent;
        if (!q) accept = true; // 경로에 없는 셀
      }
      if (!accept) {
        if (!reject()) break;
        continue;
      }
      // LABEL_26
      const v29 = c.x !== tx && c.y !== ty ? 3 : 2;
      const v30 = v29 + c.f8;
      const ax = Math.abs(tx - x2), ay = Math.abs(ty - y2);
      const v34 = Math.min(ax, ay) + 2 * Math.max(ax, ay);
      const v35 = v34 + v30;
      if (v35 <= v58) {
        if (!c.child) {
          let n: PathNode | null = null;
          if (nextIdx !== 900) {
            ++nextIdx;
            n = { f0: 0, f4: 0, f8: 0, x: 0, y: 0, f14: 0, f18: 0, idx: 0, parent: null, child: null };
            pool[nextIdx] = n;
          }
          c.child = n;
          if (!n) { cur = null; break; }
          n.parent = c;
        }
        const n = c.child as PathNode;
        n.f0 = v35;
        n.f8 = v30;
        n.f4 = v34;
        n.f14 = 0;
        const v53 = Math.trunc(pathDir(tx, ty, x2, y2) / 2);
        n.f18 = 4 * (((n.parent as PathNode).idx - v53) & 3);
        n.x = tx;
        n.y = ty;
        n.idx = (v53 + (TRY_TABLE[n.f18] as number)) & 3;
        cur = n;
      } else if (!reject()) break;
    }
    v58 += 5;
    if (nextIdx >= 900) return false;
    nextIdx = 1;
    if (cur) break;
    if (v58 >= v64) return false;
  }
  let head: Vertex | null = null, prev: Vertex | null = null;
  for (let c: PathNode | null = cur; c; c = c.parent) {
    const v = new Vertex(c.x, c.y);
    if (prev) prev.nextOpen = v;
    else head = v;
    prev = v;
  }
  lv.pathStarts[vid] = head;
  return true;
}

/** 출처: sub_6FD7F810 — 격자 경로를 월드 타일 좌표로 (셀 중앙 +3, 무작위 ±2~3 흔들기) 하고 양끝 연결 */
function finalizeDirtPath(lv: OutdoorLevel, vid: number): void {
  const XO = [1, 0, -1, 0], YO = [0, 1, 0, -1];
  let v = lv.pathStarts[vid] ?? null;
  let idx = lv.seed.roll() & 3;
  if (!v) return;
  const hub = lv.pv[18 + vid] as Vertex;
  if (hub.dir !== 4) {
    const nv = new Vertex(hub.x, hub.y);
    nv.nextOpen = v;
    lv.pathStarts[vid] = nv;
  }
  v.x = (lv.pv[12 + vid] as Vertex).x;
  v.y = (lv.pv[12 + vid] as Vertex).y;
  let p: Vertex | null = v.nextOpen;
  if (!p) return;
  while (p.nextOpen) {
    const ox = ((lv.seed.roll() & 1) + 2) * (XO[idx] as number);
    const oy = ((lv.seed.roll() & 1) + 2) * (YO[idx] as number);
    idx = (idx + 1) % 4;
    p.x = 8 * p.x + lv.box.x + ox + 3;
    p.y = 8 * p.y + lv.box.y + oy + 3;
    p = p.nextOpen;
  }
  p.x = (lv.pv[6 + vid] as Vertex).x;
  p.y = (lv.pv[6 + vid] as Vertex).y;
  const end = new Vertex((lv.pv[vid] as Vertex).x, (lv.pv[vid] as Vertex).y);
  p.nextOpen = end;
}

/** 출처: DRLGOUTDOORS_SpawnAct1DirtPaths */
function spawnDirtPaths(ctx: Ctx, lv: OutdoorLevel): void {
  lv.nVertices = 0;
  const pv = lv.pv;
  for (const o of lv.orths) {
    const v = pv[lv.nVertices] as Vertex;
    const other = ctx.world.levels.get(o.levelId);
    if (!other) continue;
    if (o.levelId === LEVEL.ROGUEENCAMPMENT) {
      v.dir = o.dir;
      switch (o.dir) {
        case 0: v.x = other.box.x + 59; v.y = other.box.y + 19; break;
        case 1: v.x = other.box.x + 29; v.y = other.box.y + 35; break;
        case 2: v.x = other.box.x + 4; v.y = other.box.y + 22; break;
        case 3: v.x = other.box.x + 29; v.y = other.box.y + 3; break;
      }
      ++lv.nVertices;
    } else if (o.levelId === LEVEL.MONASTERYGATE) {
      v.x = other.box.x + 27;
      v.y = other.box.y + 13;
      v.dir = 1;
      ++lv.nVertices;
    }
  }
  for (let i = 0; i < lv.gw; i++)
    for (let j = 0; j < lv.gh; j++) {
      const g0 = lv.grid[0].get(i, j);
      const pf = pickedFileOf(g2(lv, i, j));
      const v = pv[lv.nVertices] as Vertex;
      v.x = lv.box.x + 8 * i + 3;
      v.y = lv.box.y + 8 * j + 3;
      v.dir = 4;
      switch (g0) {
        case 4: if (pf === 3) v.dir = 3; break;
        case 5: if (pf === 3) v.dir = 0; break;
        case 6: if (pf === 3) v.dir = 1; break;
        case 7: if (pf === 3) v.dir = 2; break;
        case 24: v.dir = 1; break;
        case 25: v.dir = 0; break;
        case 28: if (pf === 1 && i === lv.gw - 2) v.dir = 2; break;
        case 51:
        case 52: v.dir = pf !== 0 ? 1 : 0; break;
      }
      if (v.dir !== 4) ++lv.nVertices;
    }
  for (let i = 0; i < lv.nVertices; i++) calcPathCoord(lv, pv[i] as Vertex, pv[6 + i] as Vertex);
  computePathHubs(lv);
  for (let i = 0; i < lv.nVertices; i++) {
    if (findDirtPath(lv, i)) {
      setVertexGridFlags(lv.grid[2], lv.pathStarts[i] ?? null, G2.DIRT_PATH);
      finalizeDirtPath(lv, i);
    }
  }
}

// ---------------- 레벨 생성 진입점 ----------------

/**
 * 야외 레벨의 셀 격자 생성.
 * 출처: DRLGOUTDOORS_GenerateLevel (방 생성 직전까지) + DRLGOUTWILD_InitAct1OutdoorLevel
 * @param init 막별 격자 초기화 (기본 = Act 1 DRLGOUTWILD_InitAct1OutdoorLevel — 다른 막은 DRLGOUTDOORS_GenerateLevel 의 막 분기)
 */
export function generateOutdoorGrid(data: DrlgData, world: Act1Placement, id: number, init: (ctx: Ctx, lv: OutdoorLevel) => void = initAct1Outdoor): OutdoorLevel {
  const placed = world.levels.get(id);
  if (!placed) throw new Error(`generateOutdoorGrid: level ${id} not placed`);
  const rec = data.level(id);
  const ctx: Ctx = { data, world };
  const gw = Math.trunc(placed.box.w / 8), gh = Math.trunc(placed.box.h / 8);
  const lv: OutdoorLevel = {
    id, rec, box: placed.box, gw, gh,
    grid: [new DrlgGrid(gw, gh), new DrlgGrid(gw, gh), new DrlgGrid(gw, gh), new DrlgGrid(gw, gh)],
    flags: placed.outdoorFlags,
    vertex: createVertices(placed.box, placed.orths, 0),
    orths: placed.orths,
    pv: Array.from({ length: 24 }, () => new Vertex()),
    nVertices: 0,
    pathStarts: [null, null, null, null, null, null],
    builds: new Map(),
    // 출처: DRLG_InitLevel — SEED_InitLowSeed(levelId + dwStartSeed)
    seed: levelSeed(world.startSeed, id),
    placed,
  };
  // 꼭짓점 → 셀 좌표 (/8) 후 같은 좌표 연속 꼭짓점 합치기
  let v = lv.vertex;
  do {
    v.x = Math.trunc(v.x / 8);
    v.y = Math.trunc(v.y / 8);
    v = v.next;
  } while (v !== lv.vertex);
  do {
    const n = v.next;
    if (v.x === n.x && v.y === n.y) {
      if (n === lv.vertex) lv.vertex = v;
      v.next = n.next;
      v.flags |= n.flags;
      v.dir = n.dir;
    }
    v = v.next;
  } while (v !== lv.vertex);

  init(ctx, lv);
  return lv;
}

/** 출처: DRLGOUTWILD_InitAct1OutdoorLevel */
function initAct1Outdoor(ctx: Ctx, lv: OutdoorLevel): void {
  if (lv.id !== LEVEL.BLOODMOOR && lv.id !== LEVEL.COLDPLAINS && lv.id !== LEVEL.BURIALGROUNDS) {
    // 절벽 구간 찾기: 오른쪽/아래로 꺾이는 연결되지 않은 외곽 구간의 꼭짓점 방향을 1 로
    let pv = lv.vertex;
    let prev = pv;
    for (let i = pv.next; i !== pv; i = i.next) prev = i;
    let brk = false;
    do {
      const n = pv.next;
      if ((pv.x < n.x && prev.y > pv.y && !(pv.flags & 1) && !(prev.flags & 1)) || (pv.y > n.y && prev.x > pv.x && !(pv.flags & 1) && !(prev.flags & 1))) {
        const first = pv;
        let special: Vertex | null = null;
        do {
          if (pv === lv.vertex) brk = true;
          if (isCliffStop(pv)) break;
          if (isCliffEnd(pv)) special = pv;
          pv = pv.next;
        } while (pv !== first);
        if (special) {
          for (let j = first; j !== special; j = j.next) j.dir = 1;
          special.dir = 1;
          lv.flags |= OUT.CLIFFS;
        }
      }
      prev = pv;
      pv = pv.next;
    } while (!brk && pv !== lv.vertex);
  }

  setOutGridLinkFlags(lv);
  placeBorders(ctx, lv);

  const town = ctx.world.levels.get(LEVEL.ROGUEENCAMPMENT)?.box ?? null;
  if (lv.id >= LEVEL.BLOODMOOR && lv.id <= LEVEL.TAMOEHIGHLAND) {
    addSecondaryBorder(ctx, lv, LVLSUB.BORDER_CLIFFS, P.WILD_BORDER_1);
    if (lv.flags & (OUT.BRIDGE | OUT.RIVER_OTHER)) {
      if (testSpawnRiver(lv, lv.gw - 2)) spawnRiver(ctx, lv, lv.gw - 2);
    }
    if (lv.flags & OUT.CLIFFS && !(lv.flags & OUT.OUT_CAVES)) {
      let added = false;
      if (!(lv.seed.roll() & 1)) {
        for (let j = 0; j < lv.gh && !added; j++) for (let i = 0; i < lv.gw && !added; i++) added = spawnCliffCaves(ctx, lv, i, j);
      } else {
        // 원작: 인자 순서를 바꿔 (j, i) 로 호출
        for (let j = 0; j < lv.gh && !added; j++) for (let i = 0; i < lv.gw && !added; i++) added = spawnCliffCaves(ctx, lv, j, i);
      }
    }
    if (lv.flags & (OUT.BRIDGE | OUT.RIVER_OTHER | OUT.RIVER) && !(lv.flags & OUT.OUT_CAVES)) {
      let y = lv.gh - 4;
      let x = lv.gw - (((~lv.flags & 0x10) | 0x40) >> 4);
      const v21 = lv.seed.roll() & 3;
      if (v21 % 2 !== 0) x = 3;
      if (Math.trunc(v21 / 2)) y = 3;
      spawnPresetEx(ctx, lv, x, y, lv.id === LEVEL.BLOODMOOR ? P.DOE_ENTRANCE : P.CAVE_ENTRANCE, -1, false);
      lv.flags |= OUT.OUT_CAVES;
    }
    addSecondaryBorder(ctx, lv, LVLSUB.BORDER_MIDDLE, P.WILD_BORDER_1);
    addSecondaryBorder(ctx, lv, LVLSUB.BORDER_CORNER, P.WILD_BORDER_1);
    spawnTownTransitionsAndCaves(ctx, lv, town);
    addSecondaryBorder(ctx, lv, LVLSUB.BORDER_BORDER, P.WILD_BORDER_1);
    spawnDirtPaths(ctx, lv);
  }
  // Moo Moo Farm 분기는 생성하지 않음 (Act 1 오버월드 밖)
  if (lv.id >= LEVEL.COLDPLAINS && lv.id <= LEVEL.BLACKMARSH) spawnWaypoint(lv);
  if (lv.id >= LEVEL.BLOODMOOR && lv.id <= LEVEL.TAMOEHIGHLAND) spawnShrines(lv, 5);
  spawnSpecialPresets(ctx, lv);
}
