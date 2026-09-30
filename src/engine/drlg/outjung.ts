// Act 3 야외: 정글 3 개(거미 숲·거대 늪·불꽃 강 정글)의 배치·프리셋 블록 결정, 정글/쿠라스트/둑길/트라빈칼 셀 격자, 방 생성.
// 출처: D2MOO DrlgOutPlace.cpp DRLG_GenerateJungles (DRLG_GenerateJunglesAttachPoints, DRLG_JungleComputeConnexity,
//       DRLG_JungleUpdateAttachPointsDirections, DRLG_JungleNormalizeLevelPresetId, gJunglePresets, gSpiderForestPresets),
//       sub_6FD83970 (정글 상대 위치), DRLGOUTPLACE_BuildKurast, DRLGOUTPLACE_InitAct3OutdoorLevel,
//       DRLGOUTPLACE_InitOutdoorRoomGrids (LVLTYPE_ACT3_JUNGLE 0x120000 / ACT3_KURAST 0x100000 바닥 플래그)
// 출처: D2MOO DrlgOutJung.cpp DRLGOUTJUNG_BuildJungle, BuildLowerKurast, BuildKurastBazaar, BuildUpperKurast, SpawnRandomPreset
// 출처: D2MOO DrlgOutdoors.cpp DRLGOUTDOORS_GenerateLevel (격자 → 방: 프리셋 셀 / 빈 셀 야외 방, DT1 마스크 정글 0x04·쿠라스트 0x01)
// 출처: D2MOO D2DrlgOutPlace.h JUNGLE_MAX_ATTACH 3, JUNGLE_PRESET2_ATTACH_POINT 2, JUNGLE_FLAG_LEFT_/RIGHT_/BOTTOM_/TOP_ 1/2/4/8
import type { Rng } from '../rng';
import type { Act1Placement } from './act1-link';
import { notOverlapping } from './act1-link';
import { DrlgGrid, Op, type Box } from './grid';
import { Assembler, presetMapRooms, type LevelLayout } from './layout';
import { generateOutdoorGrid, spawnPreset, spawnPresetEx, setOutGridLinkFlags, testPreset, type OutdoorLevel } from './outdoors';
import { buildOutdoorRoom, type RoomBuild } from './rooms';
import { G2, pickedFileOf, type DrlgData } from './types';

// ---- 레벨 ID (출처: LevelsIds.h D2C_Levels — Act 3) ----
export const L3 = {
  KURASTDOCKTOWN: 75, SPIDERFOREST: 76, GREATMARSH: 77, FLAYERJUNGLE: 78, LOWERKURAST: 79, KURASTBAZAAR: 80, UPPERKURAST: 81,
  KURASTCAUSEWAY: 82, TRAVINCAL: 83, SPIDERCAVE: 84, SPIDERCAVERN: 85, SWAMPYPITLEV1: 86, SWAMPYPITLEV2: 87, FLAYERDUNGEONLEV1: 88,
  FLAYERDUNGEONLEV2: 89, SWAMPYPITLEV3: 90, FLAYERDUNGEONLEV3: 91, SEWERSLEV1: 92, SEWERSLEV2: 93, RUINEDTEMPLE: 94, DISUSEDFANE: 95,
  FORGOTTENRELIQUARY: 96, FORGOTTENTEMPLE: 97, RUINEDFANE: 98, DISUSEDRELIQUARY: 99, DURANCEOFHATELEV1: 100, DURANCEOFHATELEV2: 101,
  DURANCEOFHATELEV3: 102,
} as const;

// ---- LvlTypes Id (출처: LevelsIds.h D2C_LvlTypes — Act 3) ----
export const LT3 = { TOWN: 20, JUNGLE: 21, KURAST: 22, SPIDER: 23, DUNGEON: 24, SEWER: 25 } as const;

// ---- LvlPrest Def (출처: LevelsIds.h D2C_LvlPrestIds — Act 3, LvlPrest.txt 행 번호와 같음) ----
export const P3 = {
  TOWN: 529,
  JUNGLE_W_E: 545, JUNGLE_W_S: 546, JUNGLE_W_N: 547, JUNGLE_E_W: 548, JUNGLE_E_S: 549, JUNGLE_E_N: 550, JUNGLE_EW_S: 551, JUNGLE_EW_N: 552,
  JUNGLE_S_W: 553, JUNGLE_S_E: 554, JUNGLE_S_N: 555, JUNGLE_SW_E: 556, JUNGLE_SW_N: 557, JUNGLE_SE_W: 558, JUNGLE_SE_N: 559, JUNGLE_SEW_N: 560,
  JUNGLE_N_W: 561, JUNGLE_N_E: 562, JUNGLE_N_S: 563, JUNGLE_NW_E: 564, JUNGLE_NW_S: 565, JUNGLE_NE_W: 566, JUNGLE_NE_S: 567, JUNGLE_NEW_S: 568,
  JUNGLE_NS_W: 569, JUNGLE_NS_E: 570, JUNGLE_NSW_E: 571, JUNGLE_NSE_W: 572, JUNGLE_HEAD: 573, JUNGLE_TAIL: 574,
  CLEARING_WEBBY_W: 575, CLEARING_WEBBY_E: 576, CLEARING_WEBBY_EW: 577, CLEARING_WEBBY_S: 578, CLEARING_WEBBY_SW: 579, CLEARING_WEBBY_SE: 580,
  CLEARING_WEBBY_N: 581, CLEARING_WEBBY_NW: 582, CLEARING_WEBBY_NE: 583, CLEARING_WEBBY_NS: 584,
  SLUMS_BORDER_N: 605, SLUMS_BORDER_S: 606, SLUMS_BORDER_E: 607, SLUMS_BORDER_W: 608, SLUMS_BORDER_NE: 609, SLUMS_BORDER_NW: 610,
  SLUMS_BORDER_SE: 611, SLUMS_BORDER_SW: 612, SLUMS_08X08: 615, SLUMS_08X16: 616, SLUMS_16X08: 617, SLUMS_16X16: 618,
  BURBS_BORDER_N: 619, BURBS_BORDER_S: 620, BURBS_BORDER_E: 621, BURBS_BORDER_W: 622, BURBS_BORDER_NE: 623, BURBS_BORDER_NW: 624,
  BURBS_BORDER_SE: 625, BURBS_BORDER_SW: 626, BURBS_SEWER: 629, BURBS_TEMPLE: 630, BURBS_WAYPOINT: 631,
  BURBS_08X08: 632, BURBS_08X16: 633, BURBS_16X08: 634, BURBS_16X16: 635,
  METRO_BORDER_N: 636, METRO_BORDER_S: 637, METRO_BORDER_E: 638, METRO_BORDER_W: 639, METRO_BORDER_NE: 640, METRO_BORDER_NW: 641,
  METRO_BORDER_SE: 642, METRO_BORDER_SW: 643, METRO_SEWER: 646, METROTEMPLE: 647, METRO_08X08: 648, METRO_08X16: 649, METRO_16X08: 650,
  METRO_16X16: 651, BRIDGE: 652,
  TRAVINCAL_NW: 653, TRAVINCAL_N: 654, TRAVINCAL_NE: 655, TRAVINCAL_SW: 656, TRAVINCAL_S: 657, TRAVINCAL_SE: 658,
  SPIDER_SW: 659, SPIDER_SE: 660, SPIDER_NW: 661, SPIDER_NE: 662, SPIDER_CHEST_NW: 663, SPIDER_CHEST_NE: 664,
  DUNGEON_W: 665, DUNGEON_E: 666, DUNGEON_S: 668, DUNGEON_N: 672,
  DUNGEON_PREV_W: 695, DUNGEON_NEXT_W: 699, DUNGEON_TREASURE_2: 704,
  SEWER_W: 705, SEWER_E: 706, SEWER_S: 708, SEWER_SW: 709, SEWER_SE: 710, SEWER_N: 712, SEWER_NW: 713, SEWER_NE: 714,
  SEWER_PREV_SW: 735, SEWER_PREV_SE: 736, SEWER_PREV_NW: 737, SEWER_PREV_NE: 738, SEWER_DRAIN_W: 739, SEWER_CHEST_W: 743,
  TEMPLE_6: 753, MEPHISTO_W: 754, MEPHISTO_E: 755, MEPHISTO_S: 757, MEPHISTO_N: 761,
  MEPHISTO_PREV_W: 784, MEPHISTO_NEXT_W: 788, MEPHISTO_WAYPOINT_W: 792,
} as const;

/** Act 3 배치 결과: Act 1 배치와 같은 모양 + 정글 프리셋 블록 */
export interface Act3Placement extends Act1Placement {
  /** 원작 pDrlg->bJungleInterlink (DRLG_AllocDrlg ACT_III: 두 번째 DRLG 롤 & 1) */
  jungleInterlink: boolean;
  /** 정글 레벨별 원작 pLevel->pJungleDefs (2×6 블록, 행 우선) 와 nJungleDefs (공터 수) */
  jungles: Map<number, { defs: number[]; clearings: number }>;
}

// ---------------- 정글 배치 (DRLG_GenerateJungles) ----------------

const JUNGLE_MAX_ATTACH = 3, ATTACH = 2;
const J_LEFT = 1, J_RIGHT = 2, J_BOTTOM = 4, J_TOP = 8;
const BLOCK = 32;

interface Jungle {
  box: Box;
  /** 원작 field_10 (sub_6FD83970 의 방향 0~4) */
  dir: number;
  branches: Jungle[];
  bx: number;
  by: number;
  defs: number[];
  clearings: number;
}

/** 부호 있는 32 비트 */
const i32 = (v: number): number => v | 0;

/**
 * 출처: sub_6FD83970 — 기준 정글 옆에 새 정글 (0 북, 1 서쪽 위 1/3, 2 동쪽 위 1/3, 3 서쪽 위 2/3, 4 동쪽 위 2/3).
 * 원작의 부호 있는 나눗셈 관용 코드(0x55555555 곱셈)를 그대로 계산한다.
 */
function placeJungle(from: Box, dir: number, sx: number, sy: number): Jungle {
  let x = 0, y = 0;
  if (dir === 0) y = -sy;
  else if (dir === 1 || dir === 2) {
    const t = i32(i32(Number((0x55555555n * BigInt(sy)) >> 32n)) - sy) >> 1;
    y = i32((t >>> 31) + t);
    x = dir === 1 ? -sx : sx;
  } else if (dir === 3 || dir === 4) {
    const t = Number((((0xffffffff55555554n * BigInt(sy)) & 0xffffffffffffffffn) >> 32n) & 0xffffffffn);
    y = i32((t >>> 31) + t);
    x = dir === 3 ? -sx : sx;
  }
  return { box: { x: x + from.x, y: y + from.y, w: sx, h: sy }, dir, branches: [], bx: 0, by: 0, defs: [], clearings: 0 };
}

// 출처: DrlgOutPlace.cpp gJunglePresets (0x6FDD0828)
const P = P3;
const JUNGLE_PRESETS: readonly number[] = [
  0, P.JUNGLE_W_E, P.JUNGLE_W_S, P.JUNGLE_W_N,
  P.JUNGLE_E_W, 0, P.JUNGLE_E_S, P.JUNGLE_E_N,
  0, 0, P.JUNGLE_EW_S, P.JUNGLE_EW_N,
  P.JUNGLE_S_W, P.JUNGLE_S_E, 0, P.JUNGLE_S_N,
  0, P.JUNGLE_SW_E, 0, P.JUNGLE_SW_N,
  P.JUNGLE_SE_W, 0, 0, P.JUNGLE_SE_N,
  0, 0, 0, P.JUNGLE_SEW_N,
  P.JUNGLE_N_W, P.JUNGLE_N_E, P.JUNGLE_N_S, 0,
  0, P.JUNGLE_NW_E, P.JUNGLE_NW_S, 0,
  P.JUNGLE_NE_W, 0, P.JUNGLE_NE_S, 0,
  0, 0, P.JUNGLE_NEW_S, 0,
  P.JUNGLE_NS_W, P.JUNGLE_NS_E, 0, 0,
  0, P.JUNGLE_NSW_E, 0, 0,
  P.JUNGLE_NSE_W, 0, 0, 0,
  0, 0, 0, 0,
];
// 출처: DrlgOutPlace.cpp gSpiderForestPresets (0x6FDD0924)
const SPIDER_FOREST_PRESETS: readonly number[] = [
  0, P.CLEARING_WEBBY_W, P.CLEARING_WEBBY_E, P.CLEARING_WEBBY_EW,
  P.CLEARING_WEBBY_S, P.CLEARING_WEBBY_SW, P.CLEARING_WEBBY_SE, 0,
  P.CLEARING_WEBBY_N, P.CLEARING_WEBBY_NW, P.CLEARING_WEBBY_NE, 0,
  P.CLEARING_WEBBY_NS, 0, 0, 0,
  0,
];

/** 배열 읽기 (원작은 범위 검사 없이 읽는다 — 정상 흐름에서는 범위 밖을 읽지 않으며, 읽으면 0) */
const at = (a: Int32Array, i: number): number => (i >= 0 && i < a.length ? (a[i] as number) : 0);

/** 출처: DRLG_GenerateJunglesAttachPoints */
function attachPoints(seed: Rng, J: Jungle[], minX: number, minY: number, sfx: number, sfy: number, W: number, p0: Int32Array, p1: Int32Array, p2: Int32Array, lp: Int32Array): void {
  p0.fill(0); p1.fill(0); p2.fill(0); lp.fill(0);
  const bsx = Math.trunc(sfx / BLOCK), bsy = Math.trunc(sfy / BLOCK);
  for (let idx = 0; idx < JUNGLE_MAX_ATTACH; idx++) {
    const cur = J[idx] as Jungle;
    const ox = cur.box.x - minX, oy = cur.box.y - minY;
    cur.bx = (((ox & 0x1f) + ox) >> 5) + 1;
    cur.by = (((oy & 0x1f) + oy) >> 5) + 1;
    let ls = idx !== 0 ? cur.dir % 2 : seed.pick(2);
    let n = 0;
    while (n < 2) {
      let row = cur.bx + W * cur.by;
      for (let y = 0; y < bsy; y++) {
        for (let x = 0; x < bsx; x++) {
          const k = row + x;
          p0[k] = idx + 1; p1[k] = 0; p2[k] = 0; lp[k] = 0;
        }
        row += W;
      }
      const firstY = cur.by, lastY = firstY + bsy - 1;
      if (idx !== 0) {
        const f = lastY * W + cur.bx;
        p2[f + ls] = 1;
        p2[f + (ls ? 0 : 1)] = ATTACH;
      }
      for (const b of cur.branches) {
        const [ox2, oy2] = ([[0, 0], [0, 3], [1, 3], [0, 1], [1, 1]] as const)[b.dir] ?? [0, 0];
        p2[cur.bx + ox2 + W * (cur.by + oy2)] = 1;
      }
      n = idx !== 0 ? 1 : 0;
      // 첫 두 열에서 지그재그로 경로(p1 = 거리값)를 긋고, 반대 열에 연결점 후보(2)를 표시
      const cx = cur.bx;
      let v = 20 * (5 * idx + 5);
      let col = 0;
      for (let cy = lastY; cy >= firstY;) {
        const ro = cy * W;
        p1[ro + cx + ls] = v++;
        if (col === 0 || cy === firstY || seed.pick(3)) {
          col++;
          if (col >= 2 && cy > 1) {
            const k = ro + cx + (ls ? 0 : 1);
            if (p2[k] === 0) {
              p2[k] = ATTACH;
              n++;
            }
          }
          cy--;
        } else {
          col = 0;
          ls = ls ? 0 : 1;
        }
      }
    }
    // 연결점 후보를 3 개로 줄인다
    while (n > 3) {
      let done = false, found = 0;
      const remove = seed.pick(n);
      for (let y = 0; y < bsy && !done; y++) {
        const off = cur.bx + (cur.by + y) * W;
        for (let x = 0; x < bsx && !done; x++) {
          const k = off + x;
          if (p2[k] === ATTACH) {
            if (found === remove) {
              p2[k] = 0;
              done = true;
              n--;
            }
            ++found;
          }
        }
      }
    }
  }
}

/** 출처: DRLG_JungleComputeConnexity */
function connexity(W: number, H: number, p0: Int32Array, p1: Int32Array, p2: Int32Array, lp: Int32Array): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let flags = 0, last = 0x7fffffff;
      const c = y * W + x, r = c + 1, l = c - 1, t = (y - 1) * W + x, b = (y + 1) * W + x;
      if (at(p2, c) === 1) {
        const v0 = at(p0, c);
        const upd = (k: number, f: number) => {
          const v1 = at(p1, k);
          if (v1 !== 0 && v1 < last && at(p0, k) === v0) {
            flags = f;
            last = v1;
          }
        };
        upd(t, J_TOP);
        upd(b, J_BOTTOM);
        upd(r, J_RIGHT);
        upd(l, J_LEFT);
        const orLp = (k: number, f: number) => { if (k >= 0 && k < lp.length) lp[k] = (lp[k] as number) | f; };
        if (flags & J_TOP) orLp(t, J_BOTTOM);
        if (flags & J_BOTTOM) orLp(b, J_TOP);
        if (flags & J_RIGHT) orLp(r, J_LEFT);
        if (flags & J_LEFT) orLp(l, J_RIGHT);
        if (at(p2, t) === 1 && at(p0, t) !== v0) flags |= J_TOP;
        if (at(p2, b) === 1 && at(p0, b) !== v0) flags |= J_BOTTOM;
        if (at(p2, r) === 1 && at(p0, r) !== v0) flags |= J_RIGHT;
        if (at(p2, l) === 1 && at(p0, l) !== v0) flags |= J_LEFT;
      }
      const v1 = at(p1, c);
      if (v1) {
        if (Math.abs(at(p1, t) - v1) === 1) flags |= J_TOP;
        if (Math.abs(at(p1, b) - v1) === 1) flags |= J_BOTTOM;
        if (Math.abs(at(p1, r) - v1) === 1) flags |= J_RIGHT;
        if (Math.abs(at(p1, l) - v1) === 1) flags |= J_LEFT;
      }
      lp[c] = (lp[c] as number) | flags;
    }
}

/** 출처: DRLG_JungleUpdateAttachPointsDirections — 거짓이면 처음부터 다시 */
function attachDirections(seed: Rng, W: number, H: number, p0: Int32Array, p2: Int32Array, lp: Int32Array): boolean {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      let base = seed.pick(4);
      if (p2[c] !== ATTACH) continue;
      const r = c + 1, l = c - 1, t = (y - 1) * W + x, b = (y + 1) * W + x;
      const v0 = at(p0, c);
      let cur = at(lp, c);
      const hadNone = cur === 0;
      let look = true;
      const lookFor = (check: (k: number, f: number) => void) => {
        for (let i = 0; i < 4 && look; i++) {
          switch ((base + i) % 4) {
            case 0: check(t, J_TOP); break; // DIRECTION_SOUTHWEST
            case 1: check(b, J_BOTTOM); break; // DIRECTION_NORTHWEST
            case 2: check(r, J_RIGHT); break; // DIRECTION_SOUTHEAST
            case 3: check(l, J_LEFT); break; // DIRECTION_NORTHEAST
          }
        }
      };
      lookFor((k, f) => {
        if (at(p0, k) === v0 && at(lp, k) && at(lp, k) < 15) {
          cur |= f << 4;
          look = false;
        }
      });
      if (!cur) return false;
      if (hadNone) {
        look = true;
        lookFor((k, f) => {
          if (at(p0, k) !== v0 && at(p2, k) === ATTACH) {
            cur |= f << 4;
            look = false;
          }
        });
        // 원작: SEED_RollLimitedRandomNumber(2) != 0 && bLook (롤은 항상 먼저)
        look = seed.pick(2) !== 0 && look;
        base = seed.pick(4);
        lookFor((k, f) => {
          if (at(lp, k) && at(lp, k) < 15 && (cur & (f << 4)) === 0) {
            cur |= f << 4;
            look = false;
          }
        });
      }
      const orLp = (k: number, f: number) => { if (k >= 0 && k < lp.length) lp[k] = (lp[k] as number) | f; };
      if (cur & (J_TOP << 4)) orLp(t, J_BOTTOM << 4);
      if (cur & (J_BOTTOM << 4)) orLp(b, J_TOP << 4);
      if (cur & (J_RIGHT << 4)) orLp(r, J_LEFT << 4);
      if (cur & (J_LEFT << 4)) orLp(l, J_RIGHT << 4);
      p2[c] = 0;
      lp[c] = (lp[c] as number) | cur;
    }
  return true;
}

/** 출처: DRLG_JungleNormalizeLevelPresetId — 연결 비트 → LvlPrest Def (정글 길·공터) */
export function jungleNormalize(v: number): number {
  let d = v % 16;
  if (d !== 0) {
    if (v < 16) d += P.TOWN;
    else {
      const o = 4 * (d - 1);
      if (v & (J_LEFT << 4)) d = JUNGLE_PRESETS[o] ?? 0;
      if (v & (J_RIGHT << 4)) d = JUNGLE_PRESETS[o + 1] ?? 0;
      if (v & (J_BOTTOM << 4)) d = JUNGLE_PRESETS[o + 2] ?? 0;
      if (v & (J_TOP << 4)) d = JUNGLE_PRESETS[o + 3] ?? 0;
    }
  } else if (v >= 16) d = SPIDER_FOREST_PRESETS[v >> 4] ?? 0;
  return d;
}

/**
 * 정글 3 개 배치와 프리셋 블록.
 * 출처: DRLG_GenerateJungles — DRLG 시드(pDrlg->pSeed)를 직접 쓴다. 결과 정글은 nPosY 큰 순(마을에 가까운 순)으로
 *       Spider Forest(76)·Great Marsh(77)·Flayer Jungle(78) 에 배정.
 * 근사(원작 미확인): 원작 std::sort 는 원소 3 개에서 삽입 정렬(안정)로 동작한다고 보고 안정 정렬을 쓴다 (같은 nPosY 일 때 순서).
 * @returns 레벨별 사각형·블록 (76, 77, 78)
 */
export function generateJungles(seed: Rng, town: Box, sfx: number, sfy: number): { id: number; box: Box; defs: number[]; clearings: number }[] {
  let minX = town.x, maxX = sfx + minX;
  const maxY = town.y;
  let minY = maxY - sfy;
  const J: Jungle[] = [placeJungle(town, 0, sfx, sfy)];
  for (let idx = 1; idx < JUNGLE_MAX_ATTACH; idx++) {
    const baseOn = seed.pick(idx);
    const cur = placeJungle((J[baseOn] as Jungle).box, seed.pick(5), sfx, sfy);
    let k = 0;
    for (; k < idx; k++) if (!notOverlapping((J[k] as Jungle).box, cur.box, 0)) break;
    if (k < idx) {
      idx--;
      continue;
    }
    J[idx] = cur;
    (J[baseOn] as Jungle).branches.push(cur);
    if (minX > cur.box.x) minX = cur.box.x;
    if (minY > cur.box.y) minY = cur.box.y;
    if (maxX < cur.box.w + cur.box.x) maxX = cur.box.w + cur.box.x;
  }
  const W = Math.trunc((maxX - minX) / BLOCK) + 2, H = Math.trunc((maxY - minY) / BLOCK) + 2;
  const n = W * H;
  const p0 = new Int32Array(n), p1 = new Int32Array(n), p2 = new Int32Array(n), lp = new Int32Array(n);
  let guard = 0;
  do {
    if (++guard > 10000) throw new Error('generateJungles: attach points did not converge');
    attachPoints(seed, J, minX, minY, sfx, sfy, W, p0, p1, p2, lp);
    connexity(W, H, p0, p1, p2, lp);
  } while (!attachDirections(seed, W, H, p0, p2, lp));
  for (let i = 0; i < n; i++) lp[i] = jungleNormalize(lp[i] as number);
  const bsx = Math.trunc(sfx / BLOCK), bsy = Math.trunc(sfy / BLOCK);
  for (const j of J) {
    j.defs = [];
    for (let by = 0; by < bsy; by++)
      for (let bx = 0; bx < bsx; bx++) {
        const v = lp[bx + j.bx + W * (by + j.by)] as number;
        j.defs.push(v);
        if (v > P.JUNGLE_TAIL) ++j.clearings;
      }
  }
  const sorted = [...J].sort((a, b) => b.box.y - a.box.y);
  return sorted.map((j, i) => ({ id: L3.SPIDERFOREST + i, box: j.box, defs: j.defs, clearings: j.clearings }));
}

// ---------------- 야외 셀 격자 (DRLGOUTPLACE_InitAct3OutdoorLevel) ----------------

interface Ctx3 { data: DrlgData; world: Act3Placement }

/** 출처: DRLGOUTJUNG_BuildJungle */
function buildJungle(ctx: Ctx3, lv: OutdoorLevel): void {
  if (lv.id < L3.SPIDERFOREST || lv.id > L3.FLAYERJUNGLE) return;
  // 출처: dword_6FDCFB18 (공터 Def 오프셋: 거미줄/늪/피그미), dword_6FDCFB28 (공터 파일 순열 6 개)
  const OFFS = [0, 10, 20, 0];
  const FILES = [0, 1, 2, 1, 0, 2, 0, 2, 1, 1, 2, 0, 2, 0, 1, 2, 1, 0];
  const sf = ctx.data.level(L3.SPIDERFOREST);
  const sx = sf.sizeX >> 5, sy = sf.sizeY >> 5;
  const j = ctx.world.jungles.get(lv.id);
  if (!j) throw new Error(`buildJungle: no jungle defs for level ${lv.id}`);
  const defs = j.defs;
  const rand = lv.seed.pick(4 * (j.clearings === 3 ? 1 : 0) + 2);
  let def = 0, fileIndex = 0;
  for (let i = 0; i < sy; ++i) {
    if (lv.id === L3.SPIDERFOREST && i === sy - 1) {
      spawnPresetEx(ctx, lv, 0, 4 * i, P.JUNGLE_HEAD, defs[sx * sy - 1] === 0 ? 1 : 0, false);
      def += 2;
    } else if (lv.id === L3.FLAYERJUNGLE && i === 0) {
      spawnPresetEx(ctx, lv, 0, 0, P.JUNGLE_TAIL, defs[1] === 0 ? 1 : 0, false);
      def += 2;
    } else {
      for (let k = 0; k < sx; ++k) {
        ++def;
        let jd = defs[def - 1] ?? 0;
        let file: number;
        if (jd > P.JUNGLE_TAIL) {
          // 원작: FOG_DisplayWarning("nFileIndex < 3") 후 그대로 진행
          jd += OFFS[lv.id - L3.SPIDERFOREST] ?? 0;
          file = FILES[fileIndex + 3 * rand] ?? 0;
          ++fileIndex;
        } else file = -1;
        if (jd) spawnPresetEx(ctx, lv, 4 * k, 4 * i, jd, file, false);
      }
    }
  }
}

/** 출처: DRLGOUTJUNG_BuildLowerKurast / BuildKurastBazaar / BuildUpperKurast — 테두리 프리셋 (+8 = 문 프리셋) */
function buildKurastBorders(ctx: Ctx3, lv: OutdoorLevel): void {
  const interlink = ctx.world.jungleInterlink;
  const W = Math.trunc(lv.box.w / 8) - 1, H = Math.trunc(lv.box.h / 8) - 1;
  const S = (x: number, y: number, p: number) => spawnPresetEx(ctx, lv, x, y, p, -1, false);
  let e: number, w: number, ne: number, nw: number, se: number, sw: number;
  if (lv.id === L3.LOWERKURAST) {
    const mid = Math.trunc(W / 2);
    const gateN = interlink ? 1 : W - 1;
    for (let i = 1; i < W; ++i) S(i, 0, 8 * (i === gateN ? 1 : 0) + P.SLUMS_BORDER_N);
    for (let i = 1; i < W; i += (i === mid ? 1 : 0) + 1) S(i, H, 8 * (i === mid ? 1 : 0) + P.SLUMS_BORDER_S);
    [e, w, ne, nw, se, sw] = [P.SLUMS_BORDER_E, P.SLUMS_BORDER_W, P.SLUMS_BORDER_NE, P.SLUMS_BORDER_NW, P.SLUMS_BORDER_SE, P.SLUMS_BORDER_SW];
  } else if (lv.id === L3.KURASTBAZAAR) {
    const [gN, gS] = interlink ? [Math.trunc(lv.box.w / 8) - 2, 1] : [1, Math.trunc(lv.box.w / 8) - 2];
    for (let i = 1; i < W; ++i) {
      S(i, 0, 8 * (i === gN ? 1 : 0) + P.BURBS_BORDER_N);
      S(i, H, 8 * (i === gS ? 1 : 0) + P.BURBS_BORDER_S);
    }
    [e, w, ne, nw, se, sw] = [P.BURBS_BORDER_E, P.BURBS_BORDER_W, P.BURBS_BORDER_NE, P.BURBS_BORDER_NW, P.BURBS_BORDER_SE, P.BURBS_BORDER_SW];
  } else if (lv.id === L3.UPPERKURAST) {
    const mid = Math.trunc(W / 2);
    const gS = interlink ? W - 1 : 1;
    for (let i = 1; i < W; i += (i === mid ? 1 : 0) + 1) S(i, 0, 8 * (i === mid ? 1 : 0) + P.METRO_BORDER_N);
    for (let i = 1; i < W; ++i) S(i, H, 8 * (i === gS ? 1 : 0) + P.METRO_BORDER_S);
    [e, w, ne, nw, se, sw] = [P.METRO_BORDER_E, P.METRO_BORDER_W, P.METRO_BORDER_NE, P.METRO_BORDER_NW, P.METRO_BORDER_SE, P.METRO_BORDER_SW];
  } else return;
  for (let i = 1; i < H; ++i) {
    S(W, i, e);
    S(0, i, w);
  }
  S(0, 0, nw);
  S(W, 0, ne);
  S(0, H, sw);
  S(W, H, se);
}

/** 출처: DRLGOUTJUNG_SpawnRandomPreset — 격자 전체(테두리 포함) 셀을 섞어 [id1, id2] 중 하나를 놓을 수 있는 곳마다 (최대 a4 개, 0 = 제한 없음) */
function spawnRandomPreset(ctx: Ctx3, lv: OutdoorLevel, id1: number, id2: number, max: number): void {
  const variants = id2 - id1 + 1;
  const n = lv.gw * lv.gh;
  if (!n) return;
  const c: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) c.push({ x: i % lv.gw, y: Math.trunc(i / lv.gw) });
  for (let i = 0; i < n; i++) {
    const a = lv.seed.pick(n), b = lv.seed.pick(n);
    const t = c[a] as { x: number; y: number };
    c[a] = c[b] as { x: number; y: number };
    c[b] = t;
  }
  let placed = 0;
  for (let i = 0; i < n; i++) {
    const { x, y } = c[i] as { x: number; y: number };
    const v = lv.seed.pick(variants);
    if (testPreset(ctx, lv, x, y, v + id1, 0, 15)) {
      spawnPresetEx(ctx, lv, x, y, v + id1, -1, false);
      ++placed;
      if (max > 0 && placed >= max) break;
    }
  }
}

/** 출처: DRLGOUTPLACE_BuildKurast */
function buildKurast(ctx: Ctx3, lv: OutdoorLevel): void {
  buildKurastBorders(ctx, lv);
  const gw = Math.trunc(lv.box.w / 8), gh = Math.trunc(lv.box.h / 8);
  switch (lv.id) {
    case L3.LOWERKURAST:
      spawnPreset(ctx, lv, P.BURBS_WAYPOINT, 0, 0, 15);
      spawnRandomPreset(ctx, lv, P.SLUMS_16X16, P.SLUMS_16X16, 4);
      spawnRandomPreset(ctx, lv, P.SLUMS_08X16, P.SLUMS_16X08, 0);
      spawnRandomPreset(ctx, lv, P.SLUMS_08X08, P.SLUMS_08X08, 0);
      break;
    case L3.KURASTBAZAAR:
      spawnPresetEx(ctx, lv, 3, 3, P.BURBS_SEWER, 0, false);
      spawnPresetEx(ctx, lv, gw - 4, 3, P.BURBS_SEWER, 1, false);
      spawnPreset(ctx, lv, P.BURBS_TEMPLE, 0, 0, 15);
      spawnPreset(ctx, lv, P.BURBS_TEMPLE, 1, 0, 15);
      spawnPreset(ctx, lv, P.BURBS_WAYPOINT, 0, 0, 15);
      spawnRandomPreset(ctx, lv, P.BURBS_16X16, P.BURBS_16X16, 4);
      spawnRandomPreset(ctx, lv, P.BURBS_08X16, P.BURBS_16X08, 0);
      spawnRandomPreset(ctx, lv, P.BURBS_08X08, P.BURBS_08X08, 0);
      break;
    case L3.UPPERKURAST:
      spawnPresetEx(ctx, lv, 3, gh - 4, P.METRO_SEWER, 0, false);
      spawnPresetEx(ctx, lv, gw - 4, gh - 4, P.METRO_SEWER, 1, false);
      spawnPreset(ctx, lv, P.METROTEMPLE, 0, 0, 15);
      spawnPreset(ctx, lv, P.METROTEMPLE, 1, 0, 15);
      spawnPreset(ctx, lv, P.BURBS_WAYPOINT, 0, 0, 15);
      spawnRandomPreset(ctx, lv, P.METRO_16X16, P.METRO_16X16, 4);
      spawnRandomPreset(ctx, lv, P.METRO_08X16, P.METRO_16X08, 0);
      spawnRandomPreset(ctx, lv, P.METRO_08X08, P.METRO_08X08, 0);
      break;
    case L3.KURASTCAUSEWAY:
      spawnPresetEx(ctx, lv, 0, 0, P.BRIDGE, 0, false);
      break;
  }
}

/** 출처: DRLGOUTPLACE_InitAct3OutdoorLevel */
function initAct3Outdoor(ctx: Ctx3, lv: OutdoorLevel): void {
  setOutGridLinkFlags(lv);
  buildJungle(ctx, lv);
  buildKurast(ctx, lv);
  if (lv.id === L3.TRAVINCAL) {
    spawnPresetEx(ctx, lv, 0, 0, P.TRAVINCAL_NW, -1, false);
    spawnPresetEx(ctx, lv, 2, 0, P.TRAVINCAL_N, -1, false);
    spawnPresetEx(ctx, lv, 6, 0, P.TRAVINCAL_NE, -1, false);
    spawnPresetEx(ctx, lv, 0, 4, P.TRAVINCAL_SW, -1, false);
    spawnPresetEx(ctx, lv, 2, 4, P.TRAVINCAL_S, -1, false);
    spawnPresetEx(ctx, lv, 6, 4, P.TRAVINCAL_SE, -1, false);
  }
}

/**
 * Act 3 야외 레벨의 셀 격자.
 * 출처: DRLGOUTDOORS_GenerateLevel (격자 단계: 꼭짓점 /8 · 합치기) + DRLGOUTPLACE_InitAct3OutdoorLevel
 */
export function generateAct3OutdoorGrid(data: DrlgData, world: Act3Placement, id: number): OutdoorLevel {
  return generateOutdoorGrid(data, world, id, (_ctx, lv) => initAct3Outdoor({ data, world }, lv));
}

/** 출처: DRLGROOMTILE_InitializeTileDataFlags — 바닥 값의 bUnwalkable(0x20000) → MAPTILE_UNWALKABLE (타일 전체 이동 불가) */
export function unwalkableTiles(A: Assembler): Uint8Array {
  const out = new Uint8Array(A.W * A.H);
  for (const l of A.floors) for (let i = 0; i < out.length; i++) if (((l[i] as number) & 0x20002) === 0x20002) out[i] = 1;
  return out;
}

/** 출처: DRLGOUTDOORS_GenerateLevel — LvlType 별 DT1 마스크 (정글 0x04, 쿠라스트 0x01) */
export const act3OutdoorDt1Mask = (levelType: number): number => (levelType === LT3.JUNGLE ? 0x04 : levelType === LT3.KURAST ? 0x01 : 0);

/** 출처: DRLGOUTPLACE_InitOutdoorRoomGrids — 빈 바닥 칸에 더하는 LvlType 플래그 (정글 0x120000, 쿠라스트 0x100000) */
const act3FloorFlags = (levelType: number): number => (levelType === LT3.JUNGLE ? 0x120000 : levelType === LT3.KURAST ? 0x100000 : 0);

/** Act 3 야외 레벨 하나 (격자 → 방 → 레벨 레이어) */
export function generateAct3OutdoorLevel(data: DrlgData, world: Act3Placement, id: number): LevelLayout {
  const lv = generateAct3OutdoorGrid(data, world, id);
  const A = new Assembler(data, lv.box.w, lv.box.h, lv.placed.vis, lv.placed.warp);
  const all: RoomBuild[] = [];
  const mask = act3OutdoorDt1Mask(lv.rec.levelType), ff = act3FloorFlags(lv.rec.levelType);
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
        // 근사(원작 미확인): 야외 방의 흙길(DRLG_OUTDOORS_GenerateDirtPath)은 원작도 Act 1 에서만 — 경로가 없어 그리지 않는다
        const room = buildOutdoorRoom(data, lv, i, j, flags, mask);
        const floor = room.floors[0] as DrlgGrid;
        for (let y = 0; y <= room.h; y++)
          for (let x = 0; x <= room.w; x++) if (!(floor.get(x, y) & 0x3f0ff80)) floor.alter(x, y, ff, Op.OR);
        all.push(room);
      }
    }
  for (const r of all) A.addRoom(r);
  for (const r of all) A.addRoomEdges(r);
  return { id, box: lv.box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, outdoor: lv, unwalkable: unwalkableTiles(A) };
}
