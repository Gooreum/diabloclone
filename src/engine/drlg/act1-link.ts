// Act 1 레벨 배치 (위치·크기) · 레벨 간 연결(vis/warp) · 레벨 가장자리 이웃(orth).
// 출처: D2MOO DrlgOutPlace.cpp DRLGOUTPLACE_CreateLevelConnections (ACT_I), sub_6FD823C0, gAct1WildernessDrlgLink,
//       gAct1MonasteryDrlgLink, sub_6FD81330/81380/81720/81950/81AD0 (링커), sub_6FD81430/81850 (좌표 배치),
//       sub_6FD82050/82130 (겹침 검사), sub_6FD82360 (강·다리·마을 전환 플래그), sub_6FD82750 (orth 생성)
// 출처: D2MOO DrlgDrlg.cpp DRLG_AllocDrlg (dwStartSeed), DRLG_SetLevelPositionAndSize, DRLG_GetDirectionFromCoordinates,
//       DRLG_GetDrlgWarpFromLevelId, DRLG_SetWarpId
// 출처: D2MOO DrlgDrlgRoom.cpp DRLG_CheckNotOverlappingUsingManhattanDistance, DRLG_ComputeManhattanDistance
import { Rng } from '../rng';
import type { Box } from './grid';
import { addOrth, type Orth } from './vertex';
import { DRLGTYPE, LEVEL, type DrlgData } from './types';

type Linker = (d: LinkData) => boolean;
interface LinkEntry { linker: Linker; level: number; link: number; linkEx: number }

interface LinkData {
  seed: Rng;
  coord: Box[];
  table: LinkEntry[];
  /** 원작 nRand[4][15] (평탄화: nRand2[60] 과 같은 메모리) */
  rand: Int32Array;
  it: number;
  cur: number;
}

const R = (k: number, i: number) => k * 15 + i;

/** 출처: sub_6FD81330 — levels.txt OffsetX/Y 에 고정 */
function linkOffset(data: DrlgData): Linker {
  return (d) => {
    if (d.rand[R(1, d.it)] === -1) d.rand[R(0, d.it)] = -1;
    const lv = data.level(d.cur);
    const c = d.coord[d.it] as Box;
    c.x = lv.offsetX;
    c.y = lv.offsetY;
    return true;
  };
}

/** 출처: sub_6FD81430 — 방향 a3 로 c2 를 c1 옆에 붙인다 (a4 = 추가 어긋남 종류) */
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

const linkedCoord = (d: LinkData) => d.coord[(d.table[d.it] as LinkEntry).link] as Box;

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

/** 출처: sub_6FD81720 — Rogue Encampment: 방향(0~3) × 정렬(0/1) */
const linkRogue: Linker = (d) => {
  const i = d.it;
  let rand2: number;
  if (d.rand[R(1, i)] === -1) {
    d.rand[R(1, i)] = d.seed.roll() & 3;
    d.rand[R(0, i)] = d.rand[R(1, i)] as number;
    d.rand[R(3, i)] = d.seed.roll() & 1;
    rand2 = d.rand[R(3, i)] as number;
  } else {
    const rand0 = ((d.rand[R(2, i)] as number) + (d.rand[R(0, i)] as number)) % 4;
    rand2 = ((d.rand[R(2, i)] as number) + 1) % 2;
    if (rand0 === d.rand[R(1, i)] && rand2 === d.rand[R(3, i)]) return false;
    d.rand[R(0, i)] = rand0;
  }
  d.rand[R(2, i)] = rand2;
  if (d.rand[R(2, i)] === 1) place1430(linkedCoord(d), d.coord[i] as Box, d.rand[R(0, i)] as number, 2);
  else place1850(linkedCoord(d), d.coord[i] as Box, d.rand[R(0, i)] as number, 2);
  return true;
};

/** 출처: sub_6FD81950 — Blood Moor: 방향에 따라 96×56 또는 56×96 */
const linkBloodMoor: Linker = (d) => {
  const i = d.it;
  let rand2: number;
  if (d.rand[R(1, i)] === -1) {
    d.rand[R(1, i)] = d.seed.roll() & 3;
    d.rand[R(0, i)] = d.rand[R(1, i)] as number;
    d.rand[R(3, i)] = d.seed.roll() & 1;
    rand2 = d.rand[R(3, i)] as number;
  } else {
    const rand0 = ((d.rand[R(2, i)] as number) + (d.rand[R(0, i)] as number)) % 4;
    rand2 = ((d.rand[R(2, i)] as number) + 1) % 2;
    if (rand0 === d.rand[R(1, i)] && rand2 === d.rand[R(3, i)]) return false;
    d.rand[R(0, i)] = rand0;
  }
  d.rand[R(2, i)] = rand2;
  const c = d.coord[i] as Box;
  const odd = (d.rand[R(0, i)] as number) % 2 !== 0;
  c.w = odd ? 96 : 56;
  c.h = odd ? 56 : 96;
  if (d.rand[R(2, i)] === 1) place1430(linkedCoord(d), c, d.rand[R(0, i)] as number, 1);
  else place1850(linkedCoord(d), c, d.rand[R(0, i)] as number, 1);
  return true;
};

/** 출처: sub_6FD81AD0 — Tamoe Highland: 항상 방향 0 */
const linkTamoe: Linker = (d) => {
  d.rand[R(1, d.it)] = 0;
  d.rand[R(0, d.it)] = 0;
  place1430(linkedCoord(d), d.coord[d.it] as Box, 0, 0);
  return true;
};

/** 출처: DRLG_ComputeManhattanDistance + DRLG_CheckNotOverlappingUsingManhattanDistance */
export function notOverlapping(a: Box, b: Box, margin: number): boolean {
  const dx = a.x >= b.x ? a.x - b.w - b.x : b.x - a.w - a.x;
  const dy = a.y >= b.y ? a.y - b.h - b.y : b.y - a.h - a.y;
  return dx >= margin || dy >= margin;
}

/** 출처: DRLG_GetDirectionFromCoordinates — 0 = c2 가 x 작은 쪽, 1 = y 작은 쪽, 2 = x 큰 쪽, 3 = y 큰 쪽, -1 = 맞닿지 않음 */
export function directionFromCoords(c1: Box, c2: Box): number {
  if (c1.x <= c2.x) {
    if (c2.x === c1.x + c1.w) return 2;
  } else if (c1.x === c2.x + c2.w) return 0;
  if (c1.y <= c2.y) {
    if (c2.y === c1.y + c1.h) return 3;
  } else if (c1.y === c2.y + c2.h) return 1;
  return -1;
}

/** 출처: sub_6FD82050 — 황야 링크 검사 (겹침 + Burial Grounds 방향 중복 + 마을 방향 허용 표) */
function checkWilderness(table: LinkEntry[]): (d: LinkData, it: number) => boolean {
  // 출처: DrlgOutPlace.cpp dword_6FDD05C0
  const ALLOWED = [
    1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1,
    0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1,
  ];
  return (d, it) => {
    const link = (table[it] as LinkEntry).link;
    for (let i = 0; i < it; i++) {
      if (i !== link && !notOverlapping(d.coord[it] as Box, d.coord[i] as Box, 0)) return false;
    }
    if ((table[it] as LinkEntry).level !== LEVEL.ROGUEENCAMPMENT) {
      if ((table[it] as LinkEntry).level === LEVEL.BURIALGROUNDS) {
        for (let i = 0; i < 15; i++) {
          // 원작: 15 칸 전체를 훑는다 (빈 칸의 nLevelLink 는 0 으로 읽힘)
          const li = i < table.length ? (table[i] as LinkEntry).link : 0;
          if (i !== it && li === link && d.rand[it] === d.rand[i]) return false;
        }
      }
      return true;
    }
    const r = (k: number, i: number) => d.rand[R(k, i)] as number;
    return ALLOWED[r(0, it) + 4 * (r(2, it) + 2 * (r(0, link) + 4 * r(2, link)))] === 1;
  };
}

/** 출처: sub_6FD82130 — 수도원 링크 검사 (겹침 + Moo Moo Farm 을 위로 200 늘린 상자와 겹침) */
function checkMonastery(table: LinkEntry[]): (d: LinkData, it: number) => boolean {
  return (d, it) => {
    let n = 0;
    while (n < it) {
      if (n !== (table[it] as LinkEntry).link && !notOverlapping(d.coord[it] as Box, d.coord[n] as Box, 0)) return false;
      ++n;
    }
    let ok = true;
    if (it) {
      const c0 = d.coord[0] as Box;
      c0.h += 200;
      c0.y -= 200;
      ok = notOverlapping(c0, d.coord[n] as Box, 0);
      c0.h -= 200;
      c0.y += 200;
    }
    return ok;
  };
}

// 출처: DrlgOutPlace.cpp sub_6FD82360 stru_6FDD06C0 — { 레벨(0=모두), 제외1, 제외2, 방향, 다음 방향, 플래그 }
const OUTDOOR_FLAG_RULES: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, LEVEL.BLOODMOOR, LEVEL.COLDPLAINS, 1, 0, 0x04],
  [0, LEVEL.BLOODMOOR, LEVEL.COLDPLAINS, 2, 3, 0x04],
  [0, LEVEL.COLDPLAINS, LEVEL.BURIALGROUNDS, 2, 1, 0x08],
  [0, LEVEL.COLDPLAINS, LEVEL.BURIALGROUNDS, 3, 0, 0x08],
  [0, LEVEL.COLDPLAINS, LEVEL.BURIALGROUNDS, 1, 1, 0x10],
  [0, LEVEL.COLDPLAINS, LEVEL.BURIALGROUNDS, 3, 3, 0x10],
  [LEVEL.BLOODMOOR, 0, 0, 0, 0, 0x08],
  [LEVEL.BLOODMOOR, 0, 0, 2, 2, 0x08],
  [LEVEL.BLOODMOOR, 0, 0, 3, 0, 0x08],
  [LEVEL.BLOODMOOR, 0, 0, 3, 2, 0x08],
  [LEVEL.BLOODMOOR, 0, 0, 0, 1, 0x400],
  [LEVEL.BLOODMOOR, 0, 0, 1, 1, 0x400],
  [LEVEL.BLOODMOOR, 0, 0, 2, 1, 0x200],
  [LEVEL.BLOODMOOR, 0, 0, 2, 2, 0x80],
  [LEVEL.BLOODMOOR, 0, 0, 3, 2, 0x100],
];

/** 레벨별 배치 결과 */
export interface PlacedLevel {
  id: number;
  drlgType: number;
  /** 월드 타일 좌표 (원작 pLevelCoords) */
  box: Box;
  /** 원작 D2DrlgWarpStrc nVis / nWarp (레벨 연결이 반영된 값) */
  vis: number[];
  warp: number[];
  /** 야외 레벨 가장자리 이웃 (원작 pOutdoors->pRoomData) */
  orths: Orth[];
  /** 야외 레벨 플래그 (원작 pOutdoors->dwFlags 초기값) */
  outdoorFlags: number;
  /** 프리셋 레벨의 파일 선택 (원작 pPreset->nDirection) — 마을: 0 N1, 1 E1, 2 S1, 3 W1 */
  presetDirection: number;
}

export interface Act1Placement {
  /** 원작 dwStartSeed = 첫 SEED_RollRandomNumber (레벨 시드 = levelId + dwStartSeed) */
  startSeed: number;
  levels: Map<number, PlacedLevel>;
}

/** 레벨 시드 (출처: DRLG_AllocLevel / DRLG_InitLevel — SEED_InitLowSeed(levelId + dwStartSeed)) */
export const levelSeed = (startSeed: number, levelId: number): Rng => new Rng((levelId + startSeed) >>> 0);

/**
 * Act 1 레벨 배치 전체.
 * 출처: DRLG_AllocDrlg (ACT_I: SEED_InitLowSeed(nInitSeed) → dwStartSeed 롤 → DRLGOUTPLACE_CreateLevelConnections)
 */
export function placeAct1(data: DrlgData, initSeed: number): Act1Placement {
  const drlgSeed = new Rng(initSeed >>> 0);
  const startSeed = drlgSeed.roll();
  const levels = new Map<number, PlacedLevel>();

  // 출처: DRLG_GetLevel → DRLG_AllocLevel (프리셋 레벨은 DRLGPRESET_InitLevelData: 파일 방향 롤 + DRLG_SetLevelPositionAndSize)
  const getLevel = (id: number): PlacedLevel => {
    let lv = levels.get(id);
    if (lv) return lv;
    const rec = data.level(id);
    lv = { id, drlgType: rec.drlgType, box: { x: 0, y: 0, w: 0, h: 0 }, vis: [...rec.vis], warp: [...rec.warp], orths: [], outdoorFlags: 0, presetDirection: 0 };
    levels.set(id, lv);
    if (rec.drlgType === DRLGTYPE.PRESET) {
      const prest = data.lvlPrestByLevel(id);
      const seed = levelSeed(startSeed, id);
      lv.presetDirection = prest && prest.files ? seed.pick(prest.files) : -1;
      // 출처: DRLG_SetLevelPositionAndSize
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

  // 출처: DRLG_SetWarpId — 같은 vis 가 있으면 warp 갱신, 없으면 빈 칸(vis 0 & warp -1)에 추가
  const setWarp = (lv: PlacedLevel, vis: number, warp: number) => {
    for (let i = 0; i < 8; i++) if (lv.vis[i] === vis) { lv.warp[i] = warp; return; }
    for (let i = 0; i < 8; i++) if (!lv.vis[i] && lv.warp[i] === -1) { lv.vis[i] = vis; lv.warp[i] = warp; return; }
    throw new Error(`DRLG_SetWarpId: no slot (level ${lv.id} vis ${vis})`);
  };

  const runTable = (table: LinkEntry[], check: (d: LinkData, it: number) => boolean) => {
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
    let n = 0;
    let guard = 0;
    while (n < table.length) {
      if (++guard > 100000) throw new Error('placeAct1: link loop did not converge');
      d.it = n;
      d.cur = (table[n] as LinkEntry).level;
      if ((table[n] as LinkEntry).linker(d)) {
        if (check(d, n)) ++n;
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
      if (lv.drlgType === DRLGTYPE.PRESET && lv.id === LEVEL.ROGUEENCAMPMENT) lv.presetDirection = d.rand[R(0, i)] as number;
      if (lv.id === LEVEL.BLACKMARSH) {
        // 출처: sub_6FD823C0 — Black Marsh 방향이 1/3 이면 Outer Cloister 파일 방향을 DRLG 시드로 다시 고른다
        const cloister = getLevel(LEVEL.OUTERCLOISTER);
        if (d.rand[R(0, i)] === 1) cloister.presetDirection = 2 - ((drlgSeed.roll() & 1) !== 0 ? 1 : 0);
        else if (d.rand[R(0, i)] === 3) cloister.presetDirection = ~drlgSeed.roll() & 1;
      }
      // 출처: sub_6FD82360 (a4) — 야외 레벨만
      if (lv.drlgType === DRLGTYPE.OUTDOOR) {
        for (const [lid, ex1, ex2, r0, r1, f] of OUTDOOR_FLAG_RULES) {
          if ((lv.id === lid || !lid) && lv.id !== ex1 && lv.id !== ex2 && d.rand[i] === r0 && d.rand[i + 1] === r1) lv.outdoorFlags |= f;
        }
      }
      // 출처: sub_6FD823C0 — Act 5 가 아니면 링크된 두 레벨을 서로 vis 로 등록 (warp -1 = 가장자리 연결)
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

  const off = linkOffset(data);
  // 출처: gAct1WildernessDrlgLink
  const wild: LinkEntry[] = [
    { linker: off, level: LEVEL.STONYFIELD, link: -1, linkEx: -1 },
    { linker: linkRand4, level: LEVEL.COLDPLAINS, link: 0, linkEx: -1 },
    { linker: linkBloodMoor, level: LEVEL.BLOODMOOR, link: 1, linkEx: -1 },
    { linker: linkRogue, level: LEVEL.ROGUEENCAMPMENT, link: 2, linkEx: -1 },
    { linker: linkRand4, level: LEVEL.BURIALGROUNDS, link: 1, linkEx: -1 },
  ];
  // 출처: gAct1MonasteryDrlgLink
  const mon: LinkEntry[] = [
    { linker: off, level: LEVEL.MOOMOOFARM, link: -1, linkEx: -1 },
    { linker: off, level: LEVEL.MONASTERYGATE, link: -1, linkEx: -1 },
    { linker: linkTamoe, level: LEVEL.TAMOEHIGHLAND, link: 1, linkEx: -1 },
    { linker: linkRand4, level: LEVEL.BLACKMARSH, link: 2, linkEx: -1 },
    { linker: linkRand4, level: LEVEL.DARKWOOD, link: 3, linkEx: -1 },
  ];
  runTable(wild, checkWilderness(wild));
  runTable(mon, checkMonastery(mon));

  // 출처: sub_6FD82750(ROGUEENCAMPMENT..BURIALGROUNDS) — 야외 레벨의 warp -1 vis 로 orth 목록 구성
  for (let id = LEVEL.ROGUEENCAMPMENT; id <= LEVEL.BURIALGROUNDS; id++) {
    const rec = data.level(id);
    if (rec.drlgType !== DRLGTYPE.OUTDOOR) continue;
    const lv = getLevel(id);
    for (let j = 0; j < 8; j++) {
      const vis = lv.vis[j] as number;
      if (vis && lv.warp[j] === -1) {
        const other = getLevel(vis);
        addOrth(lv.orths, { levelId: vis, dir: directionFromCoords(lv.box, other.box), preset: other.drlgType === DRLGTYPE.PRESET, box: other.box });
      }
    }
  }
  return { startSeed, levels };
}
