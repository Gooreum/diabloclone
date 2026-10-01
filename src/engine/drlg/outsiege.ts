// 확장팩 Act 5 야외 (Bloody Foothills · Frigid Highlands · Arreat Plateau · Frozen Tundra) 셀 격자 초기화.
// 출처: D2MOO D2Common/src/Drlg/DrlgOutSiege.cpp — DRLGOUTSIEGE_InitAct5OutdoorLevel, sub_6FD84100 (테두리 열 4/5), PlaceCaves,
//       PlaceBarricadeEntrancesAndExits, sub_6FD846C0, AddACt5SecondaryBorder (LVLSUB_ACT5_BARRICADE + sub_6FD84820 / sub_6FD84780),
//       PlaceSpecialPresets, PlacePrisons, ConnectBarricadeAndSiege
// 출처: D2MOO DrlgOutPlace.cpp — gnBarricadeCliffBorderIds[14][2], sub_6FD80BE0 / sub_6FD80C10 (a3 ≥ 4 이면 Barricade 표)
import { Op } from './grid';
import { BORDER_INDICES, addSecondaryBorder, nonLvlLink, setOutGridLinkFlags, spawnPreset, spawnPresetEx, type Ctx, type OutdoorLevel } from './outdoors';
import { coordDiff } from './vertex';
import { G2 } from './types';
import { LEVEL5, LVLSUB_ACT5_BARRICADE, PREST5 as P } from './act5-ids';

/** 출처: gnBarricadeCliffBorderIds — [행][0 일반, 1 눈 (Frozen Tundra)]. 행 12·13 은 원작의 쓰레기 값 */
const CLIFF_BORDER: readonly (readonly [number, number])[] = [
  ...Array.from({ length: 12 }, (_, i) => [P.CLIFF_BORDER_1 + i, P.CLIFF_BORDER_1_SNOW + i] as const),
  [-1, 1], [-1, 0],
];

/** 출처: sub_6FD84100 — Frozen Tundra 는 열 5 (눈), 나머지 열 4 */
const lookupOf = (lv: OutdoorLevel): 4 | 5 => (lv.id === LEVEL5.FROZENTUNDRA ? 5 : 4);
const snow = (lv: OutdoorLevel) => lv.id === LEVEL5.FROZENTUNDRA;

/** 출처: sub_6FD80BE0(a1, a2, a3 ≥ 4) — 직선 구간 절벽 테두리 */
function straight(dx: number, dy: number, col: 4 | 5): number {
  const idx = BORDER_INDICES[dx + 3 * dy + 4] as number;
  return (CLIFF_BORDER[idx] as readonly [number, number])[col - 4] as number;
}

/** 출처: sub_6FD80C10(a1..a4, a5 ≥ 4) — 모서리 절벽 테두리 (없으면 0) */
function corner(a1: number, a2: number, a3: number, a4: number, col: 4 | 5): number {
  if (a1 > 0) a1 += 2; else if (a1 < 0) a1 -= 2;
  if (a3 > 0) a3 += 2; else if (a3 < 0) a3 -= 2;
  const v6 = BORDER_INDICES[a2 + a1 + 9 * (a4 + a3) + 50];
  if (v6 === undefined || v6 === -1) return 0;
  return (CLIFF_BORDER[v6 - 1] as readonly [number, number])[col - 4] as number;
}

/** 출처: stru_6FDD09C8 — 절벽 테두리 번호(0~11) → 골짜기 테두리를 따라갈 다음 칸 방향 */
const RAVINE_STEP: readonly (readonly [number, number])[] = [
  [-1, 0], [0, -1], [1, 0], [0, 1], [0, -1], [1, 0], [0, 1], [-1, 0], [-1, 0], [0, -1], [1, 0], [0, 1],
];

/** 출처: DRLGOUTDOORS_GetPresetIndexFromGridCell */
const presetAt = (lv: OutdoorLevel, x: number, y: number): number => (lv.grid[2].get(x, y) & G2.HAS_PICKED_FILE ? lv.grid[0].get(x, y) : 0);

/** 출처: DRLGOUTSIEGE_PlaceCaves — { 레벨, 파일, 반대쪽(1 = 아래/오른쪽), 32×16 프리셋, 16×32 프리셋 } */
const CAVES: readonly [number, number, number, number, number][] = [
  [LEVEL5.ARREATPLATEAU, 0, 0, P.TO_CAVE_32X16, P.TO_CAVE_16X32],
  [LEVEL5.FROZENTUNDRA, 0, 1, P.FROM_CAVE_32X16_SNOW, P.FROM_CAVE_16X32_SNOW],
  [LEVEL5.FROZENTUNDRA, 0, 0, P.TO_CAVE_32X16_SNOW, P.TO_CAVE_16X32_SNOW],
];

function placeCaves(ctx: Ctx, lv: OutdoorLevel): void {
  for (const [id, file, far, p1, p2] of CAVES) {
    if (lv.id !== id) continue;
    // 원작: pLevel->nWidth <= nHeight 면 위/아래 가장자리 (32×16), 아니면 왼쪽/오른쪽 (16×32)
    if (lv.box.w <= lv.box.h) spawnPresetEx(ctx, lv, 2, far ? lv.gh - 2 : 0, p1, file, false);
    else spawnPresetEx(ctx, lv, far ? lv.gw - 2 : 0, 2, p2, file, false);
  }
}

/** 출처: DRLGOUTSIEGE_PlaceBarricadeEntrancesAndExits — 네 가장자리에서 처음 만나는 레벨 연결 칸에 입·출구 */
function placeEntrancesAndExits(ctx: Ctx, lv: OutdoorLevel): void {
  const file = 2 * (lv.id === LEVEL5.BLOODYFOOTHILLS ? 1 : 0) - 1;
  const link = (x: number, y: number) => (lv.grid[2].get(x, y) & G2.LVL_LINK) !== 0;
  for (let i = 0; i < lv.gw; i++) if (link(i, 0)) { spawnPresetEx(ctx, lv, i, 0, P.EXIT_32X16, file, false); break; }
  for (let i = 0; i < lv.gw; i++) if (link(i, lv.gh - 2)) { spawnPresetEx(ctx, lv, i, lv.gh - 2, P.ENTRANCE_32X16, file, false); break; }
  for (let i = 0; i < lv.gh; i++) if (link(0, i)) { spawnPresetEx(ctx, lv, 0, i, P.EXIT_16X32, file, false); break; }
  for (let i = 0; i < lv.gh; i++) if (link(lv.gw - 2, i)) { spawnPresetEx(ctx, lv, lv.gw - 2, i, P.ENTRANCE_16X32, file, false); break; }
}

/** 출처: stru_6FDD0A28 — { DS1 벽 스타일, 순번 범위, 일반 프리셋, 눈 프리셋 } */
const SUB_STYLE: readonly [number, number, number, number, number][] = [
  [49, 1, 16, P.BARRICADE_1, P.BARRICADE_1_SNOW],
  [49, 31, 46, P.BARRICADE_1, P.BARRICADE_1_SNOW],
  [48, 1, 1, P.CLIFF_BORDER_3, P.CLIFF_BORDER_3_SNOW],
  [48, 2, 3, P.CLIFF_BORDER_1, P.CLIFF_BORDER_1_SNOW],
  [48, 4, 4, P.CLIFF_BORDER_4, P.CLIFF_BORDER_4_SNOW],
  [48, 5, 5, P.RAVINE_BORDER_3, P.RAVINE_BORDER_3_SNOW],
  [48, 6, 7, P.RAVINE_BORDER_1, P.RAVINE_BORDER_1_SNOW],
  [48, 8, 8, P.RAVINE_BORDER_4, P.RAVINE_BORDER_4_SNOW],
  [48, 30, 30, 0, 0],
  [48, 31, 31, -5, -5],
];

/**
 * 출처: sub_6FD84780 — 치환 파일 벽 칸 (스타일, 순번) → 프리셋 Def.
 * 근사(원작 미확인): 표에 없는 칸은 원작이 D2_UNREACHABLE (실제 데이터에는 없음) — 여기서는 null (검사 실패로 다룬다)
 */
function subPreset(lv: OutdoorLevel, style: number, seq: number): number | null {
  for (const [st, lo, hi, p1, p2] of SUB_STYLE) {
    if (style === st && seq >= lo && seq <= hi) return seq + (snow(lv) ? p2 : p1) - lo;
  }
  return null;
}

/** 출처: DRLGOUTSIEGE_AddACt5SecondaryBorder (Bloody Foothills 제외) → DRLGTILESUB_AddSecondaryBorder (field_24 = sub_6FD84820, field_28 = sub_6FD84780) */
function addAct5SecondaryBorder(ctx: Ctx, lv: OutdoorLevel): void {
  if (lv.id === LEVEL5.BLOODYFOOTHILLS) return;
  addSecondaryBorder(ctx, lv, LVLSUB_ACT5_BARRICADE, 0, {
    // 출처: sub_6FD84820 — -5 는 아무 칸, 같은 프리셋이면 레벨 연결이 아닌 칸만
    test: (l, x, y, cur, _fl, wl) => {
      const v = subPreset(l, (wl >>> 20) & 0x3f, (wl >>> 8) & 0xff);
      if (v === -5) return true;
      return v === cur && nonLvlLink(l, x, y);
    },
    map: (l, style, seq) => subPreset(l, style, seq) ?? -5,
  });
}

/** 출처: DRLGOUTSIEGE_PlaceSpecialPresets — { 레벨, 세로로 긴 레벨 프리셋, 가로로 긴 레벨 프리셋, 파일, 횟수 } */
const SPECIAL: readonly [number, number, number, number, number][] = [
  [LEVEL5.FRIGIDHIGHLANDS, P.HELL_PORTAL_N, P.HELL_PORTAL_W, 0, 1],
  [LEVEL5.ARREATPLATEAU, P.HELL_PORTAL_N, P.HELL_PORTAL_W, 0, 1],
  [LEVEL5.FROZENTUNDRA, P.HELL_PORTAL_N, P.HELL_PORTAL_W, 1, 1],
  [LEVEL5.ARREATPLATEAU, P.WAYPOINT_DIRT, P.WAYPOINT_DIRT, -1, 1],
  [LEVEL5.FROZENTUNDRA, P.WAYPOINT_SNOW, P.WAYPOINT_SNOW, -1, 1],
  [LEVEL5.FRIGIDHIGHLANDS, P.RUINS_N_TREASURE, P.RUINS_W_TREASURE, -1, 1],
  [LEVEL5.FRIGIDHIGHLANDS, P.RUINS_N_1, P.RUINS_W_1, -1, 4],
  [LEVEL5.FRIGIDHIGHLANDS, P.RUINS_N_2, P.RUINS_W_2, -1, 4],
  [LEVEL5.ARREATPLATEAU, P.FILLER_TREASURE, P.FILLER_TREASURE, -1, 1],
  [LEVEL5.ARREATPLATEAU, P.BUILDING, P.BUILDING, -1, 1],
  [LEVEL5.ARREATPLATEAU, P.FILLER, P.FILLER, -1, 5],
  [LEVEL5.FROZENTUNDRA, P.SNOW_LAKE_1, P.SNOW_LAKE_1, -1, 4],
  [LEVEL5.FROZENTUNDRA, P.SNOW_LAKE_2, P.SNOW_LAKE_2, -1, 4],
  [LEVEL5.FROZENTUNDRA, P.SNOW_OTHER, P.SNOW_OTHER, -1, 4],
  [LEVEL5.FROZENTUNDRA, P.SNOW_TREASURE, P.SNOW_TREASURE, -1, 3],
];

function placeSpecialPresets(ctx: Ctx, lv: OutdoorLevel): void {
  for (const [id, p1, p2, file, count] of SPECIAL) {
    if (lv.id !== id) continue;
    const prest = lv.box.w < lv.box.h ? p1 : p2;
    // 원작: 반드시 있어야 하는 프리셋(포털·웨이포인트)이 안 들어가면 D2_ASSERT — 여기서는 그대로 진행
    for (let j = 0; j < count; j++) spawnPreset(ctx, lv, prest, file, 0, 15);
  }
}

/** 출처: DRLGOUTSIEGE_PlacePrisons — Frigid Highlands: Barricade 1~8 칸 셋을 감옥(+16)으로 (A5Q2 포로 구출) */
function placePrisons(ctx: Ctx, lv: OutdoorLevel): void {
  if (lv.id !== LEVEL5.FRIGIDHIGHLANDS) return;
  let placed = 0;
  const isBarricade = (p: number) => p >= P.BARRICADE_1 && p <= P.BARRICADE_8;
  for (let n = 0; n < 90 && placed < 3; n++) {
    const x = 2 * lv.seed.pick(Math.trunc(lv.gw / 2)), y = 2 * lv.seed.pick(Math.trunc(lv.gh / 2));
    const p = presetAt(lv, x, y);
    if (isBarricade(p)) {
      spawnPresetEx(ctx, lv, x, y, p + 16, -1, false);
      ++placed;
    }
  }
  const rx = 2 * lv.seed.pick(Math.trunc(lv.gw / 2)), ry = 2 * lv.seed.pick(Math.trunc(lv.gh / 2));
  for (let j = 0; j < lv.gh && placed < 3; j++)
    for (let i = 0; i < lv.gw && placed < 3; i++) {
      const x = (i + rx) % lv.gw, y = (j + ry) % lv.gh;
      const p = presetAt(lv, x, y);
      if (isBarricade(p)) {
        spawnPresetEx(ctx, lv, x, y, p + 16, -1, false);
        ++placed;
      }
    }
  // 원작: 3 개를 못 놓으면 경고만 ("Could not place enough prisons for quest 2")
}

/** 출처: DRLGOUTSIEGE_ConnectBarricadeAndSiege — Frigid Highlands 오른쪽 아래에 Bloody Foothills 로 가는 길 */
function connectBarricadeAndSiege(ctx: Ctx, lv: OutdoorLevel): void {
  const r = ctx.data.lvlPrest(P.BARRICADE_TO_SIEGE);
  const x = lv.gw - Math.trunc(r.sizeX / 8), y = lv.gh - Math.trunc(r.sizeY / 8);
  spawnPresetEx(ctx, lv, x, y, P.BARRICADE_TO_SIEGE, -1, false);
  spawnPresetEx(ctx, lv, x, y - 2, P.RAVINE_BORDER_4, -1, false);
}

/** 출처: DRLGOUTSIEGE_InitAct5OutdoorLevel */
export function initAct5Outdoor(ctx: Ctx, lv: OutdoorLevel): void {
  if (lv.id === LEVEL5.BLOODYFOOTHILLS) {
    // 오른쪽(마을 쪽)부터 왼쪽으로 Siege To Town, Siege Strip 1~13, Siege To Barricade (16×48 = 2×6 칸)
    const r = ctx.data.lvlPrest(P.SIEGE_TO_TOWN);
    const step = Math.trunc(r.sizeX / 8);
    let x = lv.gw - step;
    for (let i = 0; i < 15; i++) {
      if (x < 0) throw new Error('Siege Level is the wrong size');
      spawnPresetEx(ctx, lv, x, 0, P.SIEGE_TO_TOWN + i, 0, false);
      x -= step;
    }
    return;
  }
  setOutGridLinkFlags(lv);
  const col = lookupOf(lv);
  let pv = lv.vertex, v = pv.next;
  do {
    const pd = coordDiff(pv), cd = coordDiff(v);
    let px = pv.x & ~1, py = pv.y & ~1;
    const cx = v.x & ~1, cy = v.y & ~1;
    const prest = straight(pd.dx, pd.dy, col);
    if (!(pv.flags & 2)) {
      let guard = 0;
      while (px !== cx || py !== cy) {
        if (++guard > 10000) throw new Error(`Act 5 border walk did not converge (level ${lv.id})`);
        px += 2 * pd.dx;
        py += 2 * pd.dy;
        spawnPresetEx(ctx, lv, px, py, prest, -1, false);
        lv.grid[2].alter(px, py, G2.BORDER, Op.OR);
      }
    }
    if (pv.flags & 1) {
      // 레벨 연결 구간: 끝에서 4 칸 앞의 두 칸(2 칸 간격)을 연결 칸으로
      const x = (Math.max(pv.x, v.x) - 4 * Math.abs(pd.dx)) & ~1;
      const y = (Math.max(pv.y, v.y) - 4 * Math.abs(pd.dy)) & ~1;
      lv.grid[2].alter(x, y, G2.LVL_LINK, Op.OR);
      lv.grid[2].alter(x + 2 * Math.abs(pd.dx), y + 2 * Math.abs(pd.dy), G2.LVL_LINK, Op.OR);
    }
    const c = corner(2 * pd.dx, 2 * pd.dy, 2 * cd.dx, 2 * cd.dy, col);
    if (c) {
      spawnPresetEx(ctx, lv, cx, cy, c, -1, false);
      lv.grid[2].alter(cx, cy, G2.BORDER, Op.OR);
    }
    pv = v;
    v = v.next;
  } while (pv !== lv.vertex);

  // 출처: sub_6FD846C0 — Frigid Highlands 오른쪽 가장자리 아래 두 칸 (Bloody Foothills 연결)
  if (lv.id === LEVEL5.FRIGIDHIGHLANDS) {
    lv.grid[2].alter(lv.gw - 2, lv.gh - 4, G2.LVL_LINK, Op.OR);
    lv.grid[2].alter(lv.gw - 2, lv.gh - 3, G2.LVL_LINK, Op.OR);
  }

  // 오른쪽 위에서 왼쪽 아래까지 절벽 테두리를 따라가며 골짜기 테두리로
  const cliff = snow(lv) ? P.CLIFF_BORDER_1_SNOW : P.CLIFF_BORDER_1;
  const ravine = snow(lv) ? P.RAVINE_BORDER_1_SNOW : P.RAVINE_BORDER_1;
  let x = lv.gw - 2, y = 0, guard = 0;
  while (x !== 0 || y !== lv.gh - 2) {
    const idx = lv.grid[0].get(x, y) - cliff;
    const step = RAVINE_STEP[idx];
    if (!step || ++guard > 10000) throw new Error(`Act 5 ravine walk failed (level ${lv.id} at ${x},${y})`);
    spawnPresetEx(ctx, lv, x, y, idx + ravine, -1, false);
    x += 2 * step[0];
    y += 2 * step[1];
  }
  spawnPresetEx(ctx, lv, lv.gw - 2, 0, snow(lv) ? P.CLIFF_RAVINE_BORDER_7_SNOW : P.CLIFF_RAVINE_BORDER_7, -1, false);
  spawnPresetEx(ctx, lv, 0, lv.gh - 2, snow(lv) ? P.RAVINE_CLIFF_BORDER_5_SNOW : P.RAVINE_CLIFF_BORDER_5, -1, false);

  placeEntrancesAndExits(ctx, lv);
  placeCaves(ctx, lv);
  if (lv.id === LEVEL5.FRIGIDHIGHLANDS) connectBarricadeAndSiege(ctx, lv);
  addAct5SecondaryBorder(ctx, lv);
  placePrisons(ctx, lv);
  placeSpecialPresets(ctx, lv);
}
