// Act 2 사막 야외 (DrlgType 3): Rocky Waste · Dry Hills · Far Oasis · Lost City · Valley of Snakes · Canyon of the Magi.
// 8×8 셀 격자에 테두리·큰 절벽·마을 전환·던전 입구·웨이포인트·신전·특수 프리셋을 놓고, 나머지 셀은 사막 방으로 만든다.
// 출처: D2MOO DrlgOutDesr.cpp DRLGOUTDESR_InitAct2OutdoorLevel, PlaceDesertTransitionToTown, PlacePresetVariants, PlaceCliffs,
//       PlaceBorders, AddExits, PlaceFillsInFarOasis, PlaceRuinsInLostCity, PlaceFillsInLostCity, PlaceTombEntriesInCanyon, PlaceFillsInCanyon
// 출처: D2MOO DrlgOutPlace.cpp DRLGOUTPLACE_PlaceAct1245OutdoorBorders (LVLTYPE_ACT2_DESERT: levelPrestBorder 열 2, ACT_II 링크 입구 nDesertBorderIds),
//       DRLGOUTPLACE_InitOutdoorRoomGrids (사막 바닥 0x100)
// 출처: D2MOO DrlgOutdoors.cpp DRLGOUTDOORS_GenerateLevel (ACT_II 분기, LVLTYPE_ACT2_DESERT DT1 마스크 0x01)
import type { Act1Placement } from './act1-link';
import { DrlgGrid, Op } from './grid';
import { Assembler, presetMapRooms, type LevelLayout } from './layout';
import {
  type Ctx, type OutdoorLevel, addSecondaryBorder, generateOutdoorGrid, setBlankBorderCells, setOutGridLinkFlags, spawnPreset, spawnPresetEx, spawnShrines, spawnWaypoint,
} from './outdoors';
import { buildOutdoorRoom, type RoomBuild } from './rooms';
import { G2, LVLSUB, pickedFileOf, type DrlgData } from './types';
import { coordDiff } from './vertex';

// ---- LvlPrest Def (출처: LevelsIds.h D2C_LvlPrestIds — LvlPrest.txt 행 번호, Act 2 사막) ----
export const DESR = {
  TOWN: 301,
  DESERT_TRANSITION_W: 362, DESERT_TRANSITION_N: 363,
  DESERT_BORDER_1: 364, DESERT_BORDER_9: 372, DESERT_BORDER_10: 373, DESERT_BORDER_11: 374, DESERT_BORDER_12: 375,
  CLIFF_RIGHT_ENDS: 376, CLIFF_RIGHT_WALL: 377, CLIFF_RIGHT_PATH: 378, CLIFF_LEFT_ENDS: 379, CLIFF_LEFT_WALL: 380, CLIFF_LEFT_PATH: 381, CLIFF_TOP: 382,
  CLIFF_RIGHT_KING_TOMB: 383, CLIFF_RIGHT_KING_ENDS: 384, CLIFF_LEFT_KING_TOMB: 385, CLIFF_LEFT_KING_ENDS: 386, CLIFF_TOP_KING_TOMB: 387,
  TOMB_1: 388, TOMB_2: 389, LAIR_1: 390, LAIR_2: 391, VALLEY_RUIN_1: 392, VALLEY_RUIN_2: 393, VALLEY_WARP: 394,
  OASIS_1: 395, OASIS_2: 396, OASIS_3: 397, FILL_MESA_1: 398, FILL_HEAD_1: 399, FILL_HEAD_2: 400, FILL_BONE_1: 401, FILL_BONE_2: 402,
  FILL_WAGON_1: 403, FILL_BERMS_1: 404, FILL_BERMS_2: 405, FILL_BERMS_3: 406, FILL_BERMS_4: 407,
  RUINS_16X16: 408, RUINS_16X08: 409, RUINS_08X16: 410, RUINS_08X08: 411, RUINS_SEWER: 412, RUINS_ELDER: 413,
} as const;

const L2 = { ROCKYWASTE: 41, DRYHILLS: 42, FAROASIS: 43, LOSTCITY: 44, VALLEYOFSNAKES: 45, CANYONOFTHEMAGI: 46, LUTGHOLEIN: 40 } as const;

/** 출처: DRLGOUTDOORS_GenerateLevel — LVLTYPE_ACT2_DESERT 야외 방 DT1 마스크 */
export const ACT2_DESERT_DT1_MASK = 0x01;
/** 출처: DRLGOUTPLACE_InitOutdoorRoomGrids — LVLTYPE_ACT2_DESERT: 비어 있는 바닥 칸에 OR 하는 값 (sequence 1 = 모래) */
export const ACT2_DESERT_FLOOR = 0x100;

// 출처: DrlgOutPlace.cpp nBorderIndices (sub_6FD80BE0 / sub_6FD80C10 이 같은 배열을 오프셋 4 / 50 으로 읽는다)
const BORDER_INDICES = [
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

/** levelPrestBorder[행][2] (Act 2 사막 열): 행 k (1~12) = LVLPREST_ACT2_DESERT_BORDER_k. 근사(원작 미확인): 0 행은 원작 쓰레기 값 → 없음 */
const desertBorderRow = (row: number): number => (row >= 1 && row <= 12 ? DESR.DESERT_BORDER_1 + row - 1 : 0);

/** 출처: sub_6FD80BE0 (a3 = 2) — 직선 구간 테두리 */
function borderStraight(dx: number, dy: number): number {
  return desertBorderRow((BORDER_INDICES[dx + 3 * dy + 4] as number) + 1);
}

/** 출처: sub_6FD80C10 (a5 = 2) — 모서리 테두리 */
function borderCorner(a1: number, a2: number, a3: number, a4: number): number {
  if (a1 > 0) a1 += 2; else if (a1 < 0) a1 -= 2;
  if (a3 > 0) a3 += 2; else if (a3 < 0) a3 -= 2;
  const v6 = BORDER_INDICES[a2 + a1 + 9 * (a4 + a3) + 50];
  if (v6 === undefined || v6 === -1) return 0;
  return desertBorderRow(v6);
}

/** 출처: DRLGOUTPLACE_PlaceAct1245OutdoorBorders (LVLTYPE_ACT2_DESERT + ACT_II 링크 입구) */
function placeDesertBorders(ctx: Ctx, lv: OutdoorLevel): void {
  // 출처: nDesertBorderIds[5][2] — 연결 구간 중앙에 트인 테두리 두 칸 (인덱스 = dx + 2·dy + 2)
  const LINK: readonly (readonly [number, number])[] = [
    [DESR.DESERT_BORDER_10, DESR.DESERT_BORDER_9], [DESR.DESERT_BORDER_9, DESR.DESERT_BORDER_12], [0, 0],
    [DESR.DESERT_BORDER_10, DESR.DESERT_BORDER_11], [DESR.DESERT_BORDER_11, DESR.DESERT_BORDER_12],
  ];
  let v = lv.vertex, n = v.next;
  do {
    let packed = G2.BORDER | (v.dir !== 0 ? G2.HAS_DIRECTION : 0);
    const cd = coordDiff(v), nd = coordDiff(n);
    let cx = v.x, cy = v.y;
    const nx = n.x, ny = n.y;
    const diff = Math.abs(cd.dx ? cx - nx : cy - ny);
    let prest = borderStraight(cd.dx, cd.dy);
    if (!(v.flags & 2)) {
      while (cx !== nx || cy !== ny) {
        cx += cd.dx;
        cy += cd.dy;
        spawnPresetEx(ctx, lv, cx, cy, prest, -1, false);
        lv.grid[2].alter(cx, cy, packed, Op.OR);
      }
    }
    if (v.flags & 1 && !(v.flags & 2)) {
      const mx = Math.min(v.x, n.x) + Math.trunc((Math.abs(cd.dx) * diff) / 2);
      const my = Math.min(v.y, n.y) + Math.trunc((Math.abs(cd.dy) * diff) / 2);
      const pair = LINK[cd.dx + 2 * cd.dy + 2] as readonly [number, number];
      spawnPresetEx(ctx, lv, mx, my, pair[0], -1, false);
      spawnPresetEx(ctx, lv, mx + Math.abs(cd.dx), my + Math.abs(cd.dy), pair[1], -1, false);
    }
    if (v.dir) packed |= G2.HAS_DIRECTION;
    else packed = n.dir !== 0 ? packed | G2.HAS_DIRECTION : packed & ~G2.HAS_DIRECTION;
    const k1 = v.flags & 2 ? 1 : 2, k2 = n.flags & 2 ? 1 : 2;
    prest = borderCorner(k1 * cd.dx, k1 * cd.dy, k2 * nd.dx, k2 * nd.dy);
    if (prest) {
      spawnPresetEx(ctx, lv, nx, ny, prest, -1, false);
      lv.grid[2].alter(nx, ny, packed, Op.OR);
    }
    v = n;
    n = n.next;
  } while (v !== lv.vertex);
  setBlankBorderCells(lv);
}

/** 출처: DRLGOUTDESR_PlaceDesertTransitionToTown (인라인) — 마을이 남쪽(3)이면 N 전환을 맨 아래 줄, 아니면 W 전환을 맨 오른쪽 열 */
function placeTransitionToTown(ctx: Ctx, lv: OutdoorLevel): void {
  const town = lv.orths.find((o) => o.levelId === L2.LUTGHOLEIN);
  if (!town) return;
  if (town.dir === 3) spawnPresetEx(ctx, lv, 0, lv.gh - 1, DESR.DESERT_TRANSITION_N, -1, false);
  else spawnPresetEx(ctx, lv, lv.gw - 1, 0, DESR.DESERT_TRANSITION_W, -1, false);
}

/** 출처: DRLGOUTDESR_PlacePresetVariants — 무작위 시작 변형부터 차례로 (bIterateFiles 면 파일마다 하나씩) */
function placePresetVariants(ctx: Ctx, lv: OutdoorLevel, ids: readonly number[], iterateFiles: boolean): void {
  let r = lv.seed.pick(ids.length);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[r] as number;
    if (iterateFiles) {
      const files = ctx.data.lvlPrest(id).files;
      for (let f = 0; f < files; f++) spawnPreset(ctx, lv, id, f, 0, 15);
    } else spawnPreset(ctx, lv, id, -1, 0, 15);
    r = (r + 1) % ids.length;
  }
}

/** 출처: DRLGOUTDESR_PlaceCliffs pOutDesertInit[8][5] — { 프리셋, 파일, x, y } */
const CLIFFS: readonly (readonly (readonly [number, number, number, number])[])[] = (() => {
  const D = DESR;
  return [
    [[D.CLIFF_RIGHT_ENDS, 1, 0, 4], [D.CLIFF_RIGHT_PATH, -1, 2, 4], [D.CLIFF_RIGHT_WALL, -1, 4, 4], [D.CLIFF_RIGHT_WALL, -1, 6, 4], [D.CLIFF_RIGHT_ENDS, 2, 8, 4]],
    [[D.CLIFF_RIGHT_ENDS, 1, 0, 4], [D.CLIFF_RIGHT_WALL, -1, 2, 4], [D.CLIFF_RIGHT_PATH, -1, 4, 4], [D.CLIFF_RIGHT_WALL, -1, 6, 4], [D.CLIFF_RIGHT_ENDS, 2, 8, 4]],
    [[D.CLIFF_RIGHT_ENDS, 1, 0, 4], [D.CLIFF_RIGHT_WALL, -1, 2, 4], [D.CLIFF_RIGHT_WALL, -1, 4, 4], [D.CLIFF_RIGHT_PATH, -1, 6, 4], [D.CLIFF_RIGHT_ENDS, 2, 8, 4]],
    [[D.CLIFF_RIGHT_ENDS, 2, 8, 4], [D.CLIFF_RIGHT_WALL, -1, 6, 4], [D.CLIFF_TOP, -1, 4, 4], [D.CLIFF_LEFT_PATH, -1, 4, 6], [D.CLIFF_LEFT_ENDS, 2, 4, 8]],
    [[D.CLIFF_RIGHT_ENDS, 2, 8, 4], [D.CLIFF_RIGHT_PATH, -1, 6, 4], [D.CLIFF_TOP, -1, 4, 4], [D.CLIFF_LEFT_WALL, -1, 4, 6], [D.CLIFF_LEFT_ENDS, 2, 4, 8]],
    [[D.CLIFF_LEFT_ENDS, 1, 4, 0], [D.CLIFF_LEFT_PATH, -1, 4, 2], [D.CLIFF_LEFT_WALL, -1, 4, 4], [D.CLIFF_LEFT_WALL, -1, 4, 6], [D.CLIFF_LEFT_ENDS, 2, 4, 8]],
    [[D.CLIFF_LEFT_ENDS, 1, 4, 0], [D.CLIFF_LEFT_WALL, -1, 4, 2], [D.CLIFF_LEFT_PATH, -1, 4, 4], [D.CLIFF_LEFT_WALL, -1, 4, 6], [D.CLIFF_LEFT_ENDS, 2, 4, 8]],
    [[D.CLIFF_LEFT_ENDS, 1, 4, 0], [D.CLIFF_LEFT_WALL, -1, 4, 2], [D.CLIFF_LEFT_WALL, -1, 4, 4], [D.CLIFF_LEFT_PATH, -1, 4, 6], [D.CLIFF_LEFT_ENDS, 2, 4, 8]],
  ];
})();

/** 출처: DRLGOUTDESR_PlaceCliffs — 큰 절벽 한 줄 (8 가지 모양 중 하나) */
function placeCliffs(ctx: Ctx, lv: OutdoorLevel): void {
  const set = CLIFFS[lv.seed.roll() & 7] as readonly (readonly [number, number, number, number])[];
  for (const [prest, file, x, y] of set) spawnPresetEx(ctx, lv, x, y, prest, file, false);
}

/** 출처: DRLGOUTDESR_PlaceBorders — LvlSub 2(모서리)·1(가운데)·3(테두리) 순서 */
function placeBorders(ctx: Ctx, lv: OutdoorLevel): void {
  addSecondaryBorder(ctx, lv, LVLSUB.BORDER_CORNER, DESR.DESERT_BORDER_1);
  addSecondaryBorder(ctx, lv, LVLSUB.BORDER_MIDDLE, DESR.DESERT_BORDER_1);
  addSecondaryBorder(ctx, lv, LVLSUB.BORDER_BORDER, DESR.DESERT_BORDER_1);
}

/** 출처: DRLGOUTDESR_AddExits — 던전 입구 프리셋 (실패하면 원작은 종료) */
function addExits(ctx: Ctx, lv: OutdoorLevel): void {
  let prest: number;
  switch (lv.id) {
    case L2.ROCKYWASTE:
    case L2.DRYHILLS: prest = DESR.TOMB_1; break;
    case L2.FAROASIS: prest = DESR.LAIR_1; break;
    case L2.LOSTCITY: prest = DESR.RUINS_SEWER; break;
    case L2.VALLEYOFSNAKES: prest = DESR.TOMB_2; break;
    default: throw new Error('sAddTheExitsAndStuff() - Could not add the exit!');
  }
  if (!spawnPreset(ctx, lv, prest, -1, 0, 15)) throw new Error(`sAddTheExitsAndStuff() - Could not add the exit! (level ${lv.id})`);
}

/** 출처: DRLGOUTDESR_PlaceTombEntriesInCanyon — 일곱 무덤 입구 절벽 (고정 배치) + 가운데 웨이포인트 */
function placeTombEntriesInCanyon(ctx: Ctx, lv: OutdoorLevel): void {
  const D = DESR;
  const SET: readonly (readonly [number, number, number, number])[] = [
    [D.CLIFF_RIGHT_KING_ENDS, 0, 8, 0], [D.CLIFF_RIGHT_KING_TOMB, 2, 6, 0], [D.CLIFF_RIGHT_KING_TOMB, 1, 4, 0], [D.CLIFF_RIGHT_KING_TOMB, 0, 2, 0],
    [D.CLIFF_TOP_KING_TOMB, 0, 0, 0], [D.CLIFF_LEFT_KING_TOMB, 0, 0, 2], [D.CLIFF_LEFT_KING_TOMB, 1, 0, 4], [D.CLIFF_LEFT_KING_TOMB, 2, 0, 6],
    [D.CLIFF_LEFT_KING_ENDS, 0, 0, 8],
  ];
  for (const [prest, file, x, y] of SET) spawnPresetEx(ctx, lv, x, y, prest, file, false);
  spawnPresetEx(ctx, lv, 4, 4, D.VALLEY_WARP, -1, false);
}

/**
 * Act 2 야외 격자 초기화.
 * 출처: DRLGOUTDESR_InitAct2OutdoorLevel
 */
export function initAct2Outdoor(ctx: Ctx, lv: OutdoorLevel): void {
  const D = DESR;
  setOutGridLinkFlags(lv);
  placeDesertBorders(ctx, lv);
  const V = (ids: readonly number[], iterate = false) => placePresetVariants(ctx, lv, ids, iterate);
  switch (lv.id) {
    case L2.ROCKYWASTE:
      placeTransitionToTown(ctx, lv);
      placeBorders(ctx, lv);
      addExits(ctx, lv);
      spawnShrines(lv, 5);
      V([D.OASIS_1, D.RUINS_08X08, D.FILL_BONE_1, D.FILL_BONE_2, D.FILL_HEAD_1, D.FILL_MESA_1, D.FILL_WAGON_1]);
      return;
    case L2.DRYHILLS:
      placeCliffs(ctx, lv);
      placeBorders(ctx, lv);
      addExits(ctx, lv);
      spawnWaypoint(lv);
      spawnShrines(lv, 5);
      V([D.OASIS_1, D.RUINS_08X08, D.FILL_HEAD_2, D.FILL_MESA_1]);
      V([D.FILL_BERMS_1, D.FILL_BERMS_2, D.FILL_BERMS_3, D.FILL_BERMS_4], true);
      return;
    case L2.FAROASIS:
      placeCliffs(ctx, lv);
      placeBorders(ctx, lv);
      addExits(ctx, lv);
      V([D.OASIS_2, D.OASIS_3]);
      spawnWaypoint(lv);
      spawnShrines(lv, 5);
      // 출처: DRLGOUTDESR_PlaceFillsInFarOasis
      V([D.RUINS_08X08, D.FILL_HEAD_1, D.FILL_MESA_1, D.FILL_WAGON_1]);
      V([D.OASIS_1], true);
      V([D.OASIS_1], true);
      return;
    case L2.LOSTCITY:
      placeCliffs(ctx, lv);
      placeBorders(ctx, lv);
      addExits(ctx, lv);
      // 출처: DRLGOUTDESR_PlaceRuinsInLostCity
      V([D.RUINS_ELDER, D.RUINS_16X16, D.RUINS_16X08, D.RUINS_08X16]);
      spawnWaypoint(lv);
      spawnShrines(lv, 5);
      // 출처: DRLGOUTDESR_PlaceFillsInLostCity
      V([D.OASIS_1, D.FILL_HEAD_2, D.FILL_MESA_1, D.FILL_BERMS_1, D.FILL_BERMS_2]);
      V([D.RUINS_08X08], true);
      V([D.RUINS_08X08], true);
      return;
    case L2.VALLEYOFSNAKES:
      addExits(ctx, lv);
      return;
    case L2.CANYONOFTHEMAGI:
      placeTombEntriesInCanyon(ctx, lv);
      placeBorders(ctx, lv);
      spawnShrines(lv, 5);
      // 출처: DRLGOUTDESR_PlaceFillsInCanyon
      V([D.FILL_BONE_1, D.FILL_BONE_2, D.FILL_BERMS_3, D.FILL_BERMS_4, D.FILL_WAGON_1]);
      V([D.VALLEY_RUIN_1, D.VALLEY_RUIN_2], true);
      return;
    default:
      return;
  }
}

/** 출처: DRLGOUTPLACE_InitOutdoorRoomGrids 끝부분 — 치환 뒤 비어 있는(0x3F0FF80 없음) 바닥 칸에 레벨 종류 값 OR */
function applyDesertFloor(room: RoomBuild): void {
  const f = room.floors[0] as DrlgGrid;
  for (let y = 0; y <= room.h; y++) for (let x = 0; x <= room.w; x++) if (!(f.get(x, y) & 0x3f0ff80)) f.alter(x, y, ACT2_DESERT_FLOOR, Op.OR);
}

/**
 * Act 2 사막 야외 레벨 하나 생성 (격자 → 방 → 레벨 레이어).
 * 출처: DRLGOUTDOORS_GenerateLevel — 프리셋 셀은 DRLGPRESET_AllocDrlgMap/BuildArea, 나머지는 DRLGOUTPLACE_CreateOutdoorRoomEx (DT1 마스크 0x01)
 */
export function generateDesertLevel(data: DrlgData, world: Act1Placement, id: number): LevelLayout {
  const lv = generateOutdoorGrid(data, world, id, initAct2Outdoor);
  const A = new Assembler(data, lv.box.w, lv.box.h, lv.placed.vis, lv.placed.warp);
  const all: RoomBuild[] = [];
  for (let j = 0; j < lv.gh; j++)
    for (let i = 0; i < lv.gw; i++) {
      const flags = lv.grid[1].get(i, j);
      const g = lv.grid[2].get(i, j);
      if (g & G2.HAS_PICKED_FILE) {
        const prest = lv.grid[0].get(i, j);
        if (!prest) continue;
        const { rooms } = presetMapRooms(data, lv.seed, prest, pickedFileOf(g), i * 8, j * 8, 0, 0);
        for (const r of rooms) r.flags |= flags;
        all.push(...rooms);
      } else if (!(g & G2.BLANK)) {
        const room = buildOutdoorRoom(data, lv, i, j, flags, ACT2_DESERT_DT1_MASK);
        applyDesertFloor(room);
        all.push(room);
      }
    }
  for (const r of all) A.addRoom(r);
  for (const r of all) A.addRoomEdges(r);
  return { id, box: lv.box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, outdoor: lv };
}
