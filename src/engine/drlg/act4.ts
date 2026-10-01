// Act 4 월드 전체 생성: 판데모니움 요새(프리셋) · 외부 초원 · 절망의 평원 · 저주받은 도시(야외 메사) · 불꽃의 강(용암 미로) ·
// 카오스 생추어리(용암 야외: 디아블로 날개 프리셋 5×5) · 레벨 연결 · 특수 위치(웨이포인트·신전·헬포지·봉인·디아블로 자리).
// 출처: D2MOO DrlgDrlg.cpp DRLG_AllocDrlg (ACT_IV: 추가 롤 없음), DRLG_InitLevel
// 출처: D2MOO DrlgOutPlace.cpp DRLGOUTPLACE_CreateLevelConnections (ACT_IV), gAct4OutdoorDrlgLink, gAct4ChaosSanctumDrlgLink,
//       sub_6FD81CA0 (외부 초원 링커), sub_6FD81380, sub_6FD81330, sub_6FD81430/81850, DRLGOUTPLACE_LinkAct4Outdoors,
//       DRLGOUTPLACE_LinkAct4ChaosSanctum, sub_6FD823C0, sub_6FD82750, DRLGOUTPLACE_PlaceAct1245OutdoorBorders (LVLTYPE_ACT4_MESA 분기),
//       sub_6FD80BE0 / sub_6FD80C10 (levelPrestBorder 열 3 = Mesa Border), DRLGOUTPLACE_InitOutdoorRoomGrids (Mesa 0xA00000 / Lava 0x1600000)
// 출처: D2MOO DrlgOutdoors.cpp DRLGOUTDOORS_InitAct4OutdoorLevel, DRLGOUTDOORS_GenerateLevel (DT1 마스크 0x01, 방 생성 루프)
// 출처: D2MOO DrlgMaze.cpp DRLGMAZE_GenerateLevel (LVLTYPE_ACT4_LAVA: BuildBasicMaze), DRLGMAZE_PlaceAct4Lava,
//       DRLGMAZE_FillBlankMazeSpaces, DRLGMAZE_PickRoomPreset (LAVA_X 기준), DRLGMAZE_RollBasicPresets (LAVA_X 기준)
// 출처: D2MOO D2Game QUESTS/ACT4/A4Q2.cpp OBJECTS_InitFunction55_DiabloStartPoint (디아블로 자리 = InitFn 55 오브젝트),
//       OBJECTS_OperateFunction54/55/56_DiabloSeal (봉인 → 보스 자리 오프셋), ACT4Q2_SpawnSealBoss (슈퍼유니크 36/37/38)
import { Rng } from '../rng';
import { type Act1Placement, type PlacedLevel, levelSeed, notOverlapping } from './act1-link';
import { edgeExitsVia, type Act1Level, type EdgeExit, type SpecialPos } from './act1';
import type { DrlgWorld } from './acts';
import { DrlgGrid, Op, type Box } from './grid';
import { Assembler, generatePresetLevel, presetMapRooms, type LevelLayout } from './layout';
import {
  addRoomToLevel, allocOrths, allocRoom, freeLocation, freeRoom, growRooms, linkMazeRooms, pickRoomPreset, placeAdjacentPresetRoom,
  roomBounds, scanReplaceSpecialPreset, setPickedFileAndPresetId, type MazeId, type MazeLevel, type MazeRoom,
} from './maze';
import {
  BORDER_INDICES, addSecondaryBorder, generateOutdoorGrid, setBlankBorderCells, setOutGridLinkFlags, spawnPreset, spawnPresetEx,
  type Ctx, type OutdoorLevel,
} from './outdoors';
import { buildOutdoorRoom, buildPresetRooms, type RoomBuild } from './rooms';
import { addOrth, coordDiff } from './vertex';
import { DRLGTYPE, G2, OBJSUBCLASS, pickedFileOf, type DrlgData } from './types';

// ---- 레벨 ID (출처: LevelsIds.h D2C_Levels) ----
export const LEVEL4 = {
  FORTRESS: 103, OUTERSTEPPES: 104, PLAINSOFDESPAIR: 105, CITYOFTHEDAMNED: 106, RIVEROFFLAME: 107, CHAOSSANCTUM: 108,
} as const;

/** Act 4 전체 (levels.txt 순서) */
export const ACT4_ALL: readonly number[] = [103, 104, 105, 106, 107, 108];

// ---- LvlPrest Def (출처: LevelsIds.h D2C_LvlPrestIds — LvlPrest.txt 행 번호) ----
export const PREST4 = {
  FORTRESS: 797, FORTRESS_TRANSITION: 798, MESA_BORDER_1: 799, MESA_WARP: 811,
  MESA_1_24X24: 812, MESA_2_24X24: 817, MESA_2_IZUAL: 822, MESA_3_24X24: 823,
  PITS_1_16X16: 828, PITS_2_16X16: 832,
  LAVA_X: 836, LAVA_W: 837, LAVA_E: 838, LAVA_WARP_N: 852, LAVA_FORGE_W: 853, LAVA_FORGE_E: 854, BRIDGE_1: 855, BRIDGE_2: 856,
  DIABLO_ENTRY: 857, DIABLO_ARM_W: 858, DIABLO_ARM_E: 859, DIABLO_ARM_S: 860, DIABLO_ARM_N: 861, DIABLO_HEART: 862,
} as const;

/** LvlTypes Id (출처: LevelsIds.h D2C_LvlTypes) */
export const LVLTYPE4 = { TOWN: 26, MESA: 27, LAVA: 28 } as const;

/** 오브젝트 번호 (objects.txt Id) */
export const OBJ4 = {
  /** Diablo 봉인 (OperateFn 54/52/55/52/56) */
  SEALS: [392, 393, 394, 395, 396] as readonly number[],
  /** InitFn 55 = OBJECTS_InitFunction55_DiabloStartPoint */
  DIABLO_START: 255,
  HELLFORGE: 376,
} as const;

/** 출처: DRLGOUTDOORS_GenerateLevel — LVLTYPE_ACT4_MESA / LVLTYPE_ACT4_LAVA 의 DT1 마스크 */
export const ACT4_OUTDOOR_DT1_MASK = 0x01;

/** 출처: DRLGOUTPLACE_InitOutdoorRoomGrids — 빈 바닥 칸에 OR 하는 값 (Mesa: style 10, Lava: style 22) */
const OUTDOOR_FLOOR_FLAGS: Readonly<Record<number, number>> = { [LVLTYPE4.MESA]: 0xa00000, [LVLTYPE4.LAVA]: 0x1600000 };

// =====================================================================================================
// 레벨 배치 (DRLGOUTPLACE_CreateLevelConnections ACT_IV)
// =====================================================================================================

type Linker = (d: LinkData) => boolean;
interface LinkEntry { linker: Linker; level: number; link: number; linkEx: number }
interface LinkData { seed: Rng; coord: Box[]; table: LinkEntry[]; rand: Int32Array; it: number; cur: number }
const R = (k: number, i: number) => k * 15 + i;
const linkedCoord = (d: LinkData) => d.coord[(d.table[d.it] as LinkEntry).link] as Box;

/** 출처: sub_6FD81430 — 방향 a3 로 c2 를 c1 옆에 붙인다 (a4 = 추가 어긋남 종류). act1-link.ts 와 같은 원작 함수 */
function place1430(c1: Box, c2: Box, a3: number, a4: number): void {
  switch (a3) {
    case 0:
      c2.x = c1.x; c2.y = c1.y + c1.h;
      if (a4 === 1) c2.x -= 16;
      break;
    case 1:
      c2.x = c1.x - c2.w; c2.y = c1.y;
      if (a4 === 1) c2.y -= 16; else if (a4 === 2) c2.y += 8;
      break;
    case 2:
      c2.x = c1.x + c1.w - c2.w; c2.y = c1.y - c2.h;
      if (a4 === 1) c2.x += 16;
      break;
    case 3:
      c2.x = c1.x + c1.w; c2.y = c1.y + c1.h - c2.h;
      if (a4 === 1) c2.y += 16; else if (a4 === 2) c2.y -= 8; else if (a4 === 3) c2.y += 8;
      break;
  }
}

/** 출처: sub_6FD81850 — sub_6FD81430 의 반대쪽 정렬 */
function place1850(c1: Box, c2: Box, a3: number, a4: number): void {
  switch (a3) {
    case 0:
      c2.x = c1.x + c1.w - c2.w; c2.y = c1.y + c1.h;
      if (a4 === 1) c2.x += 16;
      break;
    case 1:
      c2.x = c1.x - c2.w; c2.y = c1.y + c1.h - c2.h;
      if (a4 === 1) c2.y += 16; else if (a4 === 2) c2.y -= 8;
      break;
    case 2:
      c2.x = c1.x; c2.y = c1.y - c2.h;
      if (a4 === 1) c2.x -= 16;
      break;
    case 3:
      c2.x = c1.x + c1.w; c2.y = c1.y;
      if (a4 === 1) c2.y -= 16; else if (a4 === 2) c2.y += 8; else if (a4 === 3) c2.y -= 8;
      break;
  }
}

/** 출처: sub_6FD81380 — 4 방향 중 무작위 시작, 실패 시 다음 방향 */
const linkRand4: Linker = (d) => {
  const i = d.it;
  if (d.rand[R(1, i)] === -1) {
    d.rand[R(1, i)] = d.seed.roll() & 3;
    d.rand[R(0, i)] = d.rand[R(1, i)] as number;
  } else {
    if (((d.rand[R(0, i)] as number) + 1) % 4 === d.rand[R(1, i)]) return false;
    d.rand[R(0, i)] = ((d.rand[R(0, i)] as number) + 1) % 4;
  }
  place1430(linkedCoord(d), d.coord[i] as Box, d.rand[R(0, i)] as number, 1);
  return true;
};

/** 출처: DRLGOUTPLACE_LinkAct4Outdoors / DRLGOUTPLACE_LinkAct4ChaosSanctum — 링크 대상이 아닌 앞 레벨과 겹치지 않음 */
const checkNoOverlap = (d: LinkData, it: number): boolean => {
  const link = (d.table[it] as LinkEntry).link;
  for (let i = 0; i < it; i++) if (i !== link && !notOverlapping(d.coord[it] as Box, d.coord[i] as Box, 0)) return false;
  return true;
};

/** Act 4 배치 결과 (Act 1 배치와 같은 모양 — outdoors.ts / layout.ts 가 그대로 받는다) */
export interface Act4Placement extends Act1Placement {
  /** 원작 dword_6FDEA6FC — 외부 초원 플래그 (0x400000: 요새 전환 셀 (0,1), 0x800000: (0,4)) */
  steppesFlag: number;
}

/**
 * Act 4 레벨 배치 전체.
 * 출처: DRLG_AllocDrlg (SEED_InitLowSeed(nInitSeed) → dwStartSeed 롤, ACT_IV 는 추가 롤 없음) → DRLGOUTPLACE_CreateLevelConnections (ACT_IV)
 */
export function placeAct4(data: DrlgData, initSeed: number): Act4Placement {
  const drlgSeed = new Rng(initSeed >>> 0);
  const startSeed = drlgSeed.roll();
  const levels = new Map<number, PlacedLevel>();

  // 출처: DRLG_GetLevel → DRLG_AllocLevel (프리셋: DRLGPRESET_InitLevelData 파일 롤, 미로: DRLGMAZE_InitLevelData) + DRLG_SetLevelPositionAndSize
  const getLevel = (id: number): PlacedLevel => {
    let lv = levels.get(id);
    if (lv) return lv;
    const rec = data.level(id);
    lv = { id, drlgType: rec.drlgType, box: { x: 0, y: 0, w: 0, h: 0 }, vis: [...rec.vis], warp: [...rec.warp], orths: [], outdoorFlags: 0, presetDirection: 0 };
    levels.set(id, lv);
    if (rec.drlgType === DRLGTYPE.PRESET || rec.drlgType === DRLGTYPE.MAZE) {
      if (rec.drlgType === DRLGTYPE.PRESET) {
        const prest = data.lvlPrestByLevel(id);
        lv.presetDirection = prest && prest.files ? levelSeed(startSeed, id).pick(prest.files) : -1;
      }
      let px = 0, py = 0;
      if (rec.depend) {
        const dep = getLevel(rec.depend);
        px = dep.box.x;
        py = dep.box.y;
      }
      lv.box = { x: px + rec.offsetX, y: py + rec.offsetY, w: rec.sizeX, h: rec.sizeY };
    }
    return lv;
  };

  // 출처: DRLG_SetWarpId
  const setWarp = (lv: PlacedLevel, vis: number, warp: number) => {
    for (let i = 0; i < 8; i++) if (lv.vis[i] === vis) { lv.warp[i] = warp; return; }
    for (let i = 0; i < 8; i++) if (!lv.vis[i] && lv.warp[i] === -1) { lv.vis[i] = vis; lv.warp[i] = warp; return; }
    throw new Error(`DRLG_SetWarpId: no slot (level ${lv.id} vis ${vis})`);
  };

  // 출처: sub_6FD81330 — levels.txt OffsetX/Y 에 고정
  const linkOffset: Linker = (d) => {
    if (d.rand[R(1, d.it)] === -1) d.rand[R(0, d.it)] = -1;
    const rec = data.level(d.cur);
    const c = d.coord[d.it] as Box;
    c.x = rec.offsetX;
    c.y = rec.offsetY;
    return true;
  };

  // 출처: sub_6FD81CA0 — 외부 초원: 항상 방향 3 (요새 동쪽), DRLG 시드 복사본 1 롤로 정렬(위/아래 8 어긋남)과 플래그
  let steppesFlag = 0;
  const linkSteppes: Linker = (d) => {
    const i = d.it;
    d.rand[R(1, i)] = 3;
    d.rand[R(0, i)] = 3;
    if (!(d.seed.roll() & 1)) {
      place1850(linkedCoord(d), d.coord[i] as Box, 3, 3);
      steppesFlag = 0x400000;
    } else {
      place1430(linkedCoord(d), d.coord[i] as Box, 3, 3);
      steppesFlag = 0x800000;
    }
    return true;
  };

  // 출처: sub_6FD823C0 — 링크 표 한 번 (DRLG 시드 복사본 사용: 원래 DRLG 시드는 그대로)
  const runTable = (table: LinkEntry[]) => {
    const d: LinkData = {
      seed: new Rng(drlgSeed.low, drlgSeed.high),
      coord: Array.from({ length: 15 }, () => ({ x: 0, y: 0, w: 0, h: 0 })),
      table, rand: new Int32Array(60).fill(-1), it: 0, cur: 0,
    };
    table.forEach((e, i) => {
      const rec = data.level(e.level);
      (d.coord[i] as Box).w = rec.sizeX;
      (d.coord[i] as Box).h = rec.sizeY;
    });
    let n = 0, guard = 0;
    while (n < table.length) {
      if (++guard > 100000) throw new Error('placeAct4: link loop did not converge');
      d.it = n;
      d.cur = (table[n] as LinkEntry).level;
      if ((table[n] as LinkEntry).linker(d)) {
        if (checkNoOverlap(d, n)) ++n;
      } else {
        for (let k = 0; k < 4; k++) d.rand[R(k, n)] = -1;
        --n;
      }
    }
    table.forEach((e, i) => {
      const vis = e.link !== -1 ? (table[e.link] as LinkEntry).level : 0;
      const visEx = e.linkEx !== -1 ? (table[e.linkEx] as LinkEntry).level : 0;
      const lv = getLevel(e.level);
      lv.box = { ...(d.coord[i] as Box) };
      // 원작: Act 5 가 아니면 링크된 두 레벨을 서로 vis 로 등록 (warp -1 = 가장자리 연결)
      if (vis) {
        setWarp(lv, vis, -1);
        setWarp(getLevel(vis), e.level, -1);
      }
      if (visEx) {
        setWarp(lv, visEx, -1);
        setWarp(getLevel(visEx), e.level, -1);
      }
    });
  };

  // 출처: gAct4OutdoorDrlgLink / gAct4ChaosSanctumDrlgLink
  runTable([
    { linker: linkOffset, level: LEVEL4.FORTRESS, link: -1, linkEx: -1 },
    { linker: linkSteppes, level: LEVEL4.OUTERSTEPPES, link: 0, linkEx: -1 },
    { linker: linkRand4, level: LEVEL4.PLAINSOFDESPAIR, link: 1, linkEx: -1 },
    { linker: linkRand4, level: LEVEL4.CITYOFTHEDAMNED, link: 2, linkEx: -1 },
  ]);
  runTable([{ linker: linkOffset, level: LEVEL4.CHAOSSANCTUM, link: -1, linkEx: -1 }]);
  // 원작: pLevel->pOutdoors->dwFlags |= dword_6FDEA6FC (외부 초원)
  getLevel(LEVEL4.OUTERSTEPPES).outdoorFlags |= steppesFlag;

  // 출처: sub_6FD82750(FORTRESS..CITYOFTHEDAMNED) — 야외 레벨의 warp -1 vis 로 orth 목록 (카오스 생추어리는 제외)
  for (let id = LEVEL4.FORTRESS; id <= LEVEL4.CITYOFTHEDAMNED; id++) {
    const lv = getLevel(id);
    if (lv.drlgType !== DRLGTYPE.OUTDOOR) continue;
    for (let j = 0; j < 8; j++) {
      const vis = lv.vis[j] as number;
      if (vis && lv.warp[j] === -1) {
        const other = getLevel(vis);
        addOrth(lv.orths, { levelId: vis, dir: dirFromCoords(lv.box, other.box), preset: other.drlgType === DRLGTYPE.PRESET, box: other.box });
      }
    }
  }
  // 불꽃의 강 (미로): 할당은 공용 시드를 쓰지 않는다 (DRLGMAZE_InitLevelData)
  getLevel(LEVEL4.RIVEROFFLAME);
  return { startSeed, levels, steppesFlag };
}

/** 출처: DRLG_GetDirectionFromCoordinates (act1-link.ts directionFromCoords 와 같은 원작 함수) */
function dirFromCoords(c1: Box, c2: Box): number {
  if (c1.x <= c2.x) {
    if (c2.x === c1.x + c1.w) return 2;
  } else if (c1.x === c2.x + c2.w) return 0;
  if (c1.y <= c2.y) {
    if (c2.y === c1.y + c1.h) return 3;
  } else if (c1.y === c2.y + c2.h) return 1;
  return -1;
}

// =====================================================================================================
// 야외 메사 / 카오스 생추어리 (DRLGOUTDOORS_InitAct4OutdoorLevel)
// =====================================================================================================

/** 출처: levelPrestBorder[행][3] — 행 1~12 = Act 4 Mesa Border 1~12 (행 0 은 원작도 쓰레기 값) */
const mesaBorder = (row: number): number => (row >= 1 && row <= 12 ? PREST4.MESA_BORDER_1 + row - 1 : 0);

/** 출처: sub_6FD80BE0(a1, a2, 3) — 직선 구간 테두리 */
function mesaStraight(dx: number, dy: number): number {
  const idx = BORDER_INDICES[dx + 3 * dy + 4] as number;
  return mesaBorder(idx + 1);
}

/** 출처: sub_6FD80C10(a1..a4, 3) — 모서리 테두리 */
function mesaCorner(a1: number, a2: number, a3: number, a4: number): number {
  if (a1 > 0) a1 += 2; else if (a1 < 0) a1 -= 2;
  if (a3 > 0) a3 += 2; else if (a3 < 0) a3 -= 2;
  const v6 = BORDER_INDICES[a2 + a1 + 9 * (a4 + a3) + 50];
  if (v6 === undefined || v6 === -1) return 0;
  return mesaBorder(v6);
}

/** 출처: DRLGOUTPLACE_PlaceAct1245OutdoorBorders — LVLTYPE_ACT4_MESA 분기 (열 3) + ACT_IV 링크 중앙 셀 (파일 3) */
function placeMesaBorders(ctx: Ctx, lv: OutdoorLevel): void {
  let v = lv.vertex, n = v.next;
  do {
    let packed = G2.BORDER | (v.dir !== 0 ? G2.HAS_DIRECTION : 0);
    const cd = coordDiff(v), nd = coordDiff(n);
    let cx = v.x, cy = v.y;
    const nx = n.x, ny = n.y;
    const diff = Math.abs(cd.dx ? cx - nx : cy - ny);
    let prest = mesaStraight(cd.dx, cd.dy);
    if (!(v.flags & 2)) {
      while (cx !== nx || cy !== ny) {
        cx += cd.dx;
        cy += cd.dy;
        spawnPresetEx(ctx, lv, cx, cy, prest, -1, false);
        lv.grid[2].alter(cx, cy, packed, Op.OR);
      }
    }
    if (v.flags & 1 && !(v.flags & 2)) {
      // ACT_IV: 링크 구간 중앙 셀을 레벨 연결 입구(파일 3 = 트인 테두리 "o")로
      const mx = Math.min(v.x, n.x) + Math.trunc((Math.abs(cd.dx) * diff) / 2);
      const my = Math.min(v.y, n.y) + Math.trunc((Math.abs(cd.dy) * diff) / 2);
      lv.grid[2].alter(mx, my, G2.PICKED_FILE_MASK, Op.AND_NEGATED);
      lv.grid[2].alter(mx, my, G2.LVL_LINK | (3 << 16), Op.OR);
    }
    if (v.dir) packed |= G2.HAS_DIRECTION;
    else packed = n.dir !== 0 ? packed | G2.HAS_DIRECTION : packed & ~G2.HAS_DIRECTION;
    const k1 = v.flags & 2 ? 1 : 2, k2 = n.flags & 2 ? 1 : 2;
    prest = mesaCorner(k1 * cd.dx, k1 * cd.dy, k2 * nd.dx, k2 * nd.dy);
    if (prest !== 0) {
      spawnPresetEx(ctx, lv, nx, ny, prest, -1, false);
      lv.grid[2].alter(nx, ny, packed, Op.OR);
    }
    v = n;
    n = n.next;
  } while (v !== lv.vertex);
  setBlankBorderCells(lv);
}

/** 출처: DRLGOUTDOORS_InitAct4OutdoorLevel */
function initAct4Outdoor(ctx: Ctx, lv: OutdoorLevel): void {
  // 출처: DrlgOutdoors.cpp nMesaLvlPrestIds / nPitsLvlPrestIds (레벨 104~106 순) / nLavaLvlPrestIds (5×5, 3 셀 간격)
  const MESA = [PREST4.MESA_1_24X24, PREST4.MESA_2_24X24, PREST4.MESA_3_24X24];
  const PITS = [PREST4.PITS_1_16X16, PREST4.PITS_2_16X16, PREST4.PITS_2_16X16];
  const X = PREST4.LAVA_X;
  const LAVA = [
    X, X, X, X, X,
    X, X, PREST4.DIABLO_ARM_N, X, X,
    X, PREST4.DIABLO_ARM_W, PREST4.DIABLO_HEART, PREST4.DIABLO_ARM_E, X,
    X, X, PREST4.DIABLO_ARM_S, X, X,
    X, X, PREST4.DIABLO_ENTRY, X, X,
  ];
  setOutGridLinkFlags(lv);
  if (lv.id !== LEVEL4.CHAOSSANCTUM) placeMesaBorders(ctx, lv);
  if (lv.id >= LEVEL4.OUTERSTEPPES && lv.id <= LEVEL4.CITYOFTHEDAMNED) {
    if (lv.flags & 0x400000) spawnPresetEx(ctx, lv, 0, 1, PREST4.FORTRESS_TRANSITION, -1, false);
    if (lv.flags & 0x800000) spawnPresetEx(ctx, lv, 0, 4, PREST4.FORTRESS_TRANSITION, -1, false);
    addSecondaryBorder(ctx, lv, 1, PREST4.MESA_BORDER_1);
    addSecondaryBorder(ctx, lv, 2, PREST4.MESA_BORDER_1);
    addSecondaryBorder(ctx, lv, 3, PREST4.MESA_BORDER_1);
    if (lv.id === LEVEL4.CITYOFTHEDAMNED) spawnPreset(ctx, lv, PREST4.MESA_WARP, -1, 0, 15);
    const mesa = MESA[lv.id - LEVEL4.OUTERSTEPPES] as number, pit = PITS[lv.id - LEVEL4.OUTERSTEPPES] as number;
    for (const k of [0, 1, 1, 2, 2, 3, 3]) spawnPreset(ctx, lv, mesa + k, -1, 0, 15);
    if (lv.id === LEVEL4.PLAINSOFDESPAIR) spawnPreset(ctx, lv, PREST4.MESA_2_IZUAL, -1, 0, 15);
    for (const k of [4, 4, 4, 4]) spawnPreset(ctx, lv, mesa + k, -1, 0, 15);
    for (const k of [0, 1, 1, 2, 2, 3, 3, 3, 3]) spawnPreset(ctx, lv, pit + k, -1, 0, 15);
  } else if (lv.id === LEVEL4.CHAOSSANCTUM) {
    LAVA.forEach((p, i) => spawnPresetEx(ctx, lv, 3 * (i % 5), 3 * Math.trunc(i / 5), p, -1, false));
  }
}

/** 출처: DRLGOUTPLACE_InitOutdoorRoomGrids — 빈 바닥 칸(값 & 0x3F0FF80 == 0)에 LvlType 별 값 OR */
function applyOutdoorFloorFlags(room: RoomBuild, flags: number): void {
  if (!flags) return;
  const floor = room.floors[0] as DrlgGrid;
  for (let y = 0; y <= room.h; y++)
    for (let x = 0; x <= room.w; x++) if (!(floor.get(x, y) & 0x3f0ff80)) floor.alter(x, y, flags, Op.OR);
}

/** Act 4 야외 레벨 (Outer Steppes / Plains of Despair / City of the Damned / Chaos Sanctum) */
export function generateAct4OutdoorLevel(data: DrlgData, placement: Act4Placement, id: number): LevelLayout {
  const lv = generateOutdoorGrid(data, placement, id, initAct4Outdoor);
  const placed = lv.placed;
  const floorFlags = OUTDOOR_FLOOR_FLAGS[lv.rec.levelType] ?? 0;
  const A = new Assembler(data, lv.box.w, lv.box.h, placed.vis, placed.warp);
  const all: RoomBuild[] = [];
  // 출처: DRLGOUTDOORS_GenerateLevel 방 생성 루프 (프리셋 셀 → AllocDrlgMap/BuildArea, 나머지 → CreateOutdoorRoomEx)
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
        const r = buildOutdoorRoom(data, lv, i, j, flags, ACT4_OUTDOOR_DT1_MASK);
        applyOutdoorFloorFlags(r, floorFlags);
        all.push(r);
      }
    }
  for (const r of all) A.addRoom(r);
  for (const r of all) A.addRoomEdges(r);
  return { id, box: lv.box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, outdoor: lv };
}

// =====================================================================================================
// 불꽃의 강 (용암 미로, DRLGMAZE_GenerateLevel LVLTYPE_ACT4_LAVA + DRLGMAZE_PlaceAct4Lava)
// =====================================================================================================

/** 출처: DRLGMAZE_PickRoomPreset (sSetChamberPreset) — LVLTYPE_ACT4_LAVA: 이웃 방향 비트 + LAVA_X */
function pickLavaPreset(_L: MazeLevel, r: MazeRoom, reset: boolean): void {
  const BITS = [1, 8, 2, 4]; // 방향 0 서 → W(1), 1 북 → N(8), 2 동 → E(2), 3 남 → S(4)
  let bits = 0;
  for (const o of r.orths) bits |= BITS[o.dir] ?? 0;
  setPickedFileAndPresetId(r, bits + PREST4.LAVA_X, -1, reset);
}

/** 출처: DRLGMAZE_FillBlankMazeSpaces — 처음 방 목록의 방마다 8 방향 빈 자리를 LAVA_X 방으로 */
export function fillBlankMazeSpaces(L: MazeLevel, prest: number, ignore: MazeRoom | null): void {
  for (const cur of [...L.rooms]) {
    if (cur === ignore) continue;
    for (let j = 0; j < 8; j++) {
      const nr = allocRoom(L);
      if (linkMazeRooms(L, nr, cur, j)) {
        allocOrths(cur, nr, j);
        addRoomToLevel(L, nr);
        setPickedFileAndPresetId(nr, prest, -1, false);
      } else freeRoom(L, nr);
    }
  }
}

/**
 * 출처: DRLGMAZE_PlaceAct4Lava — 가장 남쪽 방 아래에 메사로 가는 이동 방(Lava Warp N), 가장 북쪽 방 위로 다리 3 칸
 * (Bridge 1 = 웨이포인트, Bridge 2 ×2) 을 놓고 마지막 다리를 카오스 생추어리 아래 가운데(가로 2 칸째)에 붙인다.
 * 헬포지 방(서/동 중 하나) → 빈 자리 채우기 → 전체 이동.
 */
function placeAct4Lava(L: MazeLevel, chaos: Box): MazeRoom {
  const FORGE: readonly MazeId[] = [
    [PREST4.LAVA_W, PREST4.LAVA_FORGE_W, -1, 2],
    [PREST4.LAVA_E, PREST4.LAVA_FORGE_E, -1, 0],
  ];
  // DRLGMAZE_GetFreeLocationForRoomNorth: 가장 남쪽(y 큰) 방 중 남쪽에 붙일 수 있는 것
  const parent = freeLocation(L, (r, b) => r.box.y > b.box.y, 3);
  if (!parent) throw new Error('PlaceAct4Lava: no room for the mesa warp');
  const warpRoom = allocRoom(L);
  if (linkMazeRooms(L, warpRoom, parent, 3)) {
    allocOrths(parent, warpRoom, 3);
    addRoomToLevel(L, warpRoom);
    pickRoomPreset(L, parent, true);
    setPickedFileAndPresetId(warpRoom, PREST4.LAVA_WARP_N, -1, false);
  } else freeRoom(L, warpRoom);

  // DRLGMAZE_GetFreeLocationForRoomSouth: 가장 북쪽(y 작은) 방 중 북쪽에 붙일 수 있는 것
  const south = freeLocation(L, (r, b) => r.box.y < b.box.y, 1);
  if (!south) throw new Error('PlaceAct4Lava: no room for the bridge');
  const b1 = placeAdjacentPresetRoom(L, south, 1, false);
  if (!b1) throw new Error('PlaceAct4Lava: bridge 1 failed');
  pickRoomPreset(L, south, true);
  setPickedFileAndPresetId(b1, PREST4.BRIDGE_1, -1, false);
  const b2 = placeAdjacentPresetRoom(L, b1, 1, false);
  if (!b2) throw new Error('PlaceAct4Lava: bridge 2 failed');
  setPickedFileAndPresetId(b2, PREST4.BRIDGE_2, -1, false);
  const b3 = placeAdjacentPresetRoom(L, b2, 1, false);
  if (!b3) throw new Error('PlaceAct4Lava: bridge 3 failed');
  setPickedFileAndPresetId(b3, PREST4.BRIDGE_2, -1, false);
  // 출처: DRLGROOM_AddOrth(&pBridgeRoomEx3->pDrlgOrth, pChaosSanctum, ALTDIR_NORTH, FALSE)
  b3.orths.push({ room: null, levelId: LEVEL4.CHAOSSANCTUM, dir: 1, init: false, box: chaos });
  const nX = chaos.x + 2 * b3.box.w - b3.box.x;
  const nY = chaos.y + chaos.h - b3.box.y;
  scanReplaceSpecialPreset(L, FORGE[L.seed.roll() & 1] as MazeId, 0);
  fillBlankMazeSpaces(L, PREST4.LAVA_X, b3);
  for (const r of L.rooms) {
    r.box.x += nX;
    r.box.y += nY;
  }
  L.pos = roomBounds(L);
  return b3;
}

/**
 * 출처: DRLGMAZE_RollBasicPresets (LVLTYPE_ACT4_LAVA → 기준 LAVA_X) — 방마다 AllocDrlgMap 파일 롤 → 기본 방 모양은 DrlgBuild 순환
 * → BuildArea (24×24 방이라 bSingleRoom = 0: 8×8 조각). maze.ts rollBasicPresets 와 같은 원작 함수 (기준 Def 만 다름).
 */
function rollLavaPresets(data: DrlgData, L: MazeLevel, origin: { x: number; y: number }): RoomBuild[] {
  const base = PREST4.LAVA_X;
  const builds: { preset: number; divisor: number; rand: number }[] = [];
  const out: RoomBuild[] = [];
  for (const r of [...L.rooms]) {
    const prest = data.lvlPrest(r.prest);
    const rolled = L.seed.pick(prest.files);
    let file = r.picked;
    if (file === -1) {
      file = rolled;
      if (prest.def > base && prest.def < base + 16) {
        let b = builds.find((x) => x.preset === prest.def);
        if (!b) {
          b = { preset: prest.def, divisor: prest.files, rand: L.seed.pick(prest.files) };
          builds.unshift(b);
        }
        b.rand = (b.rand + 1) % b.divisor;
        file = b.rand;
      }
    }
    const path = prest.file[file];
    if (!path) throw new Error(`LvlPrest ${prest.def} (${prest.name}) has no file ${file}`);
    const w = prest.sizeX && prest.sizeY ? prest.sizeX : r.box.w;
    const h = prest.sizeX && prest.sizeY ? prest.sizeY : r.box.h;
    // 근사(원작 미확인): DRLGPRESET_AddPresetUnitToDrlgMap 의 유닛별 롤은 Act 4 Scan/Pops 프리셋에 해당 유닛(바닥 함정·581 번·
    //   Act 5 탑)이 없어 레벨 시드에 영향이 없다 (DS1 유닛 목록으로 확인). 비-Scan 프리셋의 580 번 롤은 방 시드라 배치와 무관.
    const rooms = buildPresetRooms(data.ds1(path), { def: prest.def, killEdge: prest.killEdge, populate: prest.populate, dt1Mask: prest.dt1Mask },
      r.box.x - origin.x, r.box.y - origin.y, w, h, L.seed, r.box.w <= 12 && r.box.h <= 12);
    out.unshift(...rooms.reverse());
  }
  return out;
}

export interface Act4MazeLayout extends LevelLayout {
  mazeRooms: { box: Box; prest: number; picked: number }[];
  /** 카오스 생추어리와 맞닿은 방 (마지막 다리). 월드 타일 좌표 */
  orthBoxes: { levelId: number; box: Box }[];
}

/** 불꽃의 강 생성 (출처: DRLG_InitLevel → DRLGMAZE_GenerateLevel) */
export function generateRiverOfFlame(data: DrlgData, placement: Act4Placement): Act4MazeLayout {
  const id = LEVEL4.RIVEROFFLAME;
  const placed = placement.levels.get(id);
  const chaos = placement.levels.get(LEVEL4.CHAOSSANCTUM);
  if (!placed || !chaos) throw new Error('generateRiverOfFlame: levels not placed');
  const rec = data.level(id);
  const L: MazeLevel = { id, levelType: rec.levelType, maze: data.lvlMaze(id), seed: levelSeed(placement.startSeed, id), rooms: [], pos: { ...placed.box }, pick: pickLavaPreset };
  const first = allocRoom(L);
  first.box.x = L.pos.x + Math.trunc((L.pos.w - first.box.w) / 2);
  first.box.y = L.pos.y + Math.trunc((L.pos.h - first.box.h) / 2);
  addRoomToLevel(L, first);
  // LVLTYPE_ACT4_LAVA: DRLGMAZE_BuildBasicMaze (= 공통 방 늘리기)
  growRooms(L);
  placeAct4Lava(L, chaos.box);
  // DRLGMAZE_RollAct_1_2_3_BasicPresets: LVLTYPE_ACT4_LAVA 는 default → 바로 반환
  const bounds = roomBounds(L);
  const mazeRooms = L.rooms.map((r) => ({ box: { ...r.box }, prest: r.prest, picked: r.picked }));
  const orthBoxes = L.rooms.flatMap((r) => r.orths.filter((o) => !o.init).map((o) => ({ levelId: o.levelId, box: { ...r.box } })));
  const built = rollLavaPresets(data, L, bounds);
  const box: Box = { x: bounds.x, y: bounds.y, w: bounds.w + 1, h: bounds.h + 1 };
  const A = new Assembler(data, box.w, box.h, placed.vis, placed.warp);
  for (const r of built) A.addRoom(r);
  for (const r of built) A.addRoomEdges(r);
  return { id, box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, mazeRooms, orthBoxes };
}

// =====================================================================================================
// 월드
// =====================================================================================================

/** 봉인 하나 (레벨 기준 서브타일) + 그 봉인이 부르는 보스 (없으면 null) */
export interface SealPos extends SpecialPos {
  /** 봉인 보스 슈퍼유니크 (SuperUniques.txt 행: 36 Infector of Souls / 37 Lord De Seis / 38 Grand Vizier of Chaos) */
  boss: { superUnique: number; x: number; y: number } | null;
}

export interface Act4World extends DrlgWorld {
  placement: Act4Placement;
  levels: Map<number, Act1Level>;
  exits: EdgeExit[];
  /** 카오스 생추어리: 봉인 5 개, 디아블로 자리 (레벨 기준 서브타일) */
  chaos: { seals: SealPos[]; diablo: { x: number; y: number } | null; wings: { prest: number; file: number }[] };
  /** 불꽃의 강 헬포지 (레벨 기준 서브타일) */
  hellforge: SpecialPos | null;
}

/**
 * 출처: A4Q2.cpp OBJECTS_OperateFunction54/55/56_DiabloSeal — 봉인 좌표 + 오프셋이 보스 자리 (pSealCoords[0..2]),
 * ACT4Q2_SpawnSealBoss 가 nSuperUniqueIds[36/37/38] 로 부른다. objects.txt OperateFn: 392 = 54, 394 = 55, 396 = 56 (393·395 = 52: 보스 없음)
 * 근사(원작 미확인): 원작은 이 자리에서 QUESTS_GetFreePosition 으로 빈 칸을 다시 찾는다 — 여기서는 오프셋 자리 그대로.
 */
const SEAL_BOSS: Readonly<Record<number, { superUnique: number; dx: number; dy: number }>> = {
  392: { superUnique: 36, dx: -12, dy: -52 },
  394: { superUnique: 37, dx: -39, dy: 33 },
  396: { superUnique: 38, dx: 32, dy: 16 },
};

/** 레벨 결과 → 웨이포인트·신전 (act1.ts 와 같은 규칙: objects.txt SubClass) */
function specials(data: DrlgData, layout: LevelLayout): { waypoint: SpecialPos | null; shrines: SpecialPos[] } {
  let waypoint: SpecialPos | null = null;
  const shrines: SpecialPos[] = [];
  for (const u of layout.units) {
    if (u.type !== 2) continue;
    const sc = data.objectSubClass(u.id);
    if (sc & OBJSUBCLASS.WAYPOINT) waypoint ??= { x: u.x, y: u.y, objectId: u.id };
    else if (sc & (OBJSUBCLASS.SHRINE | OBJSUBCLASS.WELL)) shrines.push({ x: u.x, y: u.y, objectId: u.id });
  }
  return { waypoint, shrines };
}

/** Act 4 월드 (게임 시드 → 결정적) */
export function generateAct4World(data: DrlgData, seed: number, ids: readonly number[] = ACT4_ALL): Act4World {
  const placement = placeAct4(data, seed);
  const levels = new Map<number, Act1Level>();
  let chaos: Act4World['chaos'] = { seals: [], diablo: null, wings: [] };
  let hellforge: SpecialPos | null = null;
  for (const id of ids) {
    const placed = placement.levels.get(id);
    if (!placed) continue;
    let layout: LevelLayout;
    let touch: { levelId: number; box: Box }[] = [];
    let box = placed.box;
    if (id === LEVEL4.RIVEROFFLAME) {
      const m = generateRiverOfFlame(data, placement);
      touch = m.orthBoxes;
      layout = m;
      box = m.box;
    } else if (placed.drlgType === DRLGTYPE.OUTDOOR) layout = generateAct4OutdoorLevel(data, placement, id);
    else layout = generatePresetLevel(data, placement, id);
    const { waypoint, shrines } = specials(data, layout);
    const seen = new Set<number>();
    const entrances = layout.warps.filter((w) => !seen.has(w.toLevel) && (seen.add(w.toLevel), true));
    levels.set(id, { id, drlgType: placed.drlgType, layout, box, waypoint, shrines, entrances, touch });
    if (id === LEVEL4.CHAOSSANCTUM) {
      const seals: SealPos[] = [];
      let diablo: { x: number; y: number } | null = null;
      for (const u of layout.units) {
        if (u.type !== 2) continue;
        if (OBJ4.SEALS.includes(u.id)) {
          const b = SEAL_BOSS[u.id];
          seals.push({ x: u.x, y: u.y, objectId: u.id, boss: b ? { superUnique: b.superUnique, x: u.x + b.dx, y: u.y + b.dy } : null });
        } else if (u.id === OBJ4.DIABLO_START) diablo ??= { x: u.x, y: u.y };
      }
      seals.sort((a, b) => a.objectId - b.objectId);
      // 날개 프리셋의 파일 선택 (봉인·보스 자리 변형)
      const og = layout.outdoor;
      const wings: { prest: number; file: number }[] = [];
      if (og) {
        for (let j = 0; j < og.gh; j++)
          for (let i = 0; i < og.gw; i++) {
            const p = og.grid[0].get(i, j);
            if (p >= PREST4.DIABLO_ARM_W && p <= PREST4.DIABLO_ARM_N) wings.push({ prest: p, file: pickedFileOf(og.grid[2].get(i, j)) });
          }
      }
      chaos = { seals, diablo, wings };
    }
    if (id === LEVEL4.RIVEROFFLAME) {
      const f = layout.units.find((u) => u.type === 2 && u.id === OBJ4.HELLFORGE);
      if (f) hellforge = { x: f.x, y: f.y, objectId: f.id };
    }
  }
  // 가장자리 연결: vis 에 서로 있고 warp = -1 이며 사각형이 맞닿은 쌍 (act1.ts 와 같은 규칙)
  const exits: EdgeExit[] = [];
  const list = [...levels.values()];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as Act1Level, b = list[j] as Act1Level;
      const pa = placement.levels.get(a.id), pb = placement.levels.get(b.id);
      if (!pa || !pb) continue;
      const linked = pa.vis.some((v, k) => v === b.id && pa.warp[k] === -1) || pb.vis.some((v, k) => v === a.id && pb.warp[k] === -1);
      if (!linked) continue;
      const ta = a.touch.find((t) => t.levelId === b.id)?.box ?? a.box, tb = b.touch.find((t) => t.levelId === a.id)?.box ?? b.box;
      exits.push(...edgeExitsVia(a.id, a.box, ta, b.id, b.box, tb));
    }
  return { seed, placement, levels, exits, chaos, hellforge };
}
