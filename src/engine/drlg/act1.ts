// Act 1 월드 전체 생성: 레벨 배치 → 야외/프리셋/미로 레벨 생성 → 레벨 가장자리 연결(출구) · 특수 위치(웨이포인트·신전·동굴 입구).
// 출처: D2MOO DrlgDrlg.cpp DRLG_AllocDrlg (Act 1) / DRLG_InitLevel (DRLGTYPE_OUTDOOR → DRLGOUTDOORS_GenerateLevel,
//       DRLGTYPE_PRESET → DRLGPRESET_GenerateLevel)
// 원작은 모든 레벨이 한 월드 좌표계에 있어 가장자리를 걸어서 넘어간다. 엔진은 레벨별 지도이므로 맞닿은 구간을
// 양쪽 레벨의 출구 사각형으로 바꾼다 (각 레벨 로컬 서브타일 좌표, 양방향 대칭).
import { type Act1Placement, directionFromCoords, placeAct1 } from './act1-link';
import type { Box } from './grid';
import { generateOutdoorLevel, generatePresetLevel, type LevelLayout, type WarpPoint } from './layout';
import { generateMazeLevel } from './maze';
import { DRLGTYPE, LEVEL, OBJSUBCLASS, type DrlgData } from './types';

/** 이 단계에서 생성하는 Act 1 오버월드 레벨 (야외 DrlgType 3 + 이어지는 프리셋: 마을·수도원 정문·바깥 회랑) */
export const ACT1_OVERWORLD: readonly number[] = [
  LEVEL.ROGUEENCAMPMENT, LEVEL.BLOODMOOR, LEVEL.COLDPLAINS, LEVEL.STONYFIELD, LEVEL.DARKWOOD, LEVEL.BLACKMARSH,
  LEVEL.TAMOEHIGHLAND, LEVEL.BURIALGROUNDS, LEVEL.MONASTERYGATE, LEVEL.OUTERCLOISTER,
];

/**
 * Act 1 던전 (Step 2): 동굴·지하묘지·탑 지하·수도원 병영/감옥/안뜰/대성당/카타콤·트리스트럼.
 * 미로(DrlgType 1) 와 프리셋(DrlgType 2) — levels.txt 순서
 */
export const ACT1_DUNGEONS: readonly number[] = [
  LEVEL.DENOFEVIL, LEVEL.CAVELEV1, LEVEL.UNDERGROUNDPASSAGELEV1, LEVEL.HOLELEV1, LEVEL.PITLEV1,
  LEVEL.CAVELEV2, LEVEL.UNDERGROUNDPASSAGELEV2, LEVEL.HOLELEV2, LEVEL.PITLEV2,
  LEVEL.CRYPT, LEVEL.MAUSOLEUM, LEVEL.FORGOTTENTOWER,
  LEVEL.TOWERCELLARLEV1, LEVEL.TOWERCELLARLEV2, LEVEL.TOWERCELLARLEV3, LEVEL.TOWERCELLARLEV4, LEVEL.TOWERCELLARLEV5,
  LEVEL.BARRACKS, LEVEL.JAILLEV1, LEVEL.JAILLEV2, LEVEL.JAILLEV3, LEVEL.INNERCLOISTER, LEVEL.CATHEDRAL,
  LEVEL.CATACOMBSLEV1, LEVEL.CATACOMBSLEV2, LEVEL.CATACOMBSLEV3, LEVEL.CATACOMBSLEV4, LEVEL.TRISTRAM,
];

/** Act 1 전체 (오버월드 + 던전) */
export const ACT1_ALL: readonly number[] = [...ACT1_OVERWORLD, ...ACT1_DUNGEONS];

/** 레벨 가장자리 출구 (from 레벨 로컬 서브타일). 도착: x = dx 가 있으면 현재 x + dx, 없으면 toX (y 도 같음) */
export interface EdgeExit { from: number; to: number; x: number; y: number; w: number; h: number; toX: number; toY: number; dx?: number; dy?: number }

export interface SpecialPos { x: number; y: number; objectId: number }

export interface Act1Level {
  id: number;
  drlgType: number;
  layout: LevelLayout;
  /** 월드 타일 좌표 */
  box: Box;
  waypoint: SpecialPos | null;
  shrines: SpecialPos[];
  /** 동굴·탑·지하묘지 입구 (대상 레벨 id 별 첫 이동 지점) */
  entrances: WarpPoint[];
  /** 다른 레벨과 가장자리로 맞닿은 부분 (월드 타일). 없으면 레벨 사각형 전체 — 미로 레벨 Barracks 의 연결 방 */
  touch: { levelId: number; box: Box }[];
}

export interface Act1World {
  seed: number;
  placement: Act1Placement;
  levels: Map<number, Act1Level>;
  exits: EdgeExit[];
  /** 마을 프리셋 파일 (0 N1, 1 E1, 2 S1, 3 W1) */
  townFile: number;
}

/** 출구 폭(서브타일)과 도착 지점의 가장자리 거리 */
const EXIT_DEPTH = 2, ARRIVE_DEPTH = 4;

/** 두 레벨이 맞닿은 구간을 양방향 출구로 */
export function edgeExits(aId: number, a: Box, bId: number, b: Box): EdgeExit[] {
  const dir = directionFromCoords(a, b);
  if (dir < 0) return [];
  const out: EdgeExit[] = [];
  if (dir === 0 || dir === 2) {
    const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
    if (y1 <= y0) return [];
    const L = dir === 2 ? { id: aId, box: a } : { id: bId, box: b }; // 서쪽(왼쪽) 레벨
    const R = dir === 2 ? { id: bId, box: b } : { id: aId, box: a };
    out.push({ from: L.id, to: R.id, x: L.box.w * 5 - EXIT_DEPTH, y: (y0 - L.box.y) * 5, w: EXIT_DEPTH, h: (y1 - y0) * 5, toX: ARRIVE_DEPTH, toY: 0, dy: (L.box.y - R.box.y) * 5 });
    out.push({ from: R.id, to: L.id, x: 0, y: (y0 - R.box.y) * 5, w: EXIT_DEPTH, h: (y1 - y0) * 5, toX: L.box.w * 5 - 1 - ARRIVE_DEPTH, toY: 0, dy: (R.box.y - L.box.y) * 5 });
  } else {
    const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
    if (x1 <= x0) return [];
    const T = dir === 3 ? { id: aId, box: a } : { id: bId, box: b }; // 위쪽 레벨
    const B = dir === 3 ? { id: bId, box: b } : { id: aId, box: a };
    out.push({ from: T.id, to: B.id, x: (x0 - T.box.x) * 5, y: T.box.h * 5 - EXIT_DEPTH, w: (x1 - x0) * 5, h: EXIT_DEPTH, toX: 0, toY: ARRIVE_DEPTH, dx: (T.box.x - B.box.x) * 5 });
    out.push({ from: B.id, to: T.id, x: (x0 - B.box.x) * 5, y: 0, w: (x1 - x0) * 5, h: EXIT_DEPTH, toX: 0, toY: T.box.h * 5 - 1 - ARRIVE_DEPTH, dx: (B.box.x - T.box.x) * 5 });
  }
  return out;
}

/**
 * 맞닿은 부분(touch)으로 출구를 만들고 각 레벨 로컬 좌표로 옮긴다.
 * @param aLevel,bLevel 레벨 사각형 (로컬 원점), aTouch,bTouch 실제로 맞닿은 사각형
 */
export function edgeExitsVia(aId: number, aLevel: Box, aTouch: Box, bId: number, bLevel: Box, bTouch: Box): EdgeExit[] {
  const lv = new Map([[aId, { L: aLevel, T: aTouch }], [bId, { L: bLevel, T: bTouch }]]);
  return edgeExits(aId, aTouch, bId, bTouch).map((e) => {
    const f = lv.get(e.from)!, t = lv.get(e.to)!;
    const out: EdgeExit = { ...e, x: e.x + (f.T.x - f.L.x) * 5, y: e.y + (f.T.y - f.L.y) * 5 };
    if (e.dx !== undefined) out.dx = (f.L.x - t.L.x) * 5;
    else out.toX = e.toX + (t.T.x - t.L.x) * 5;
    if (e.dy !== undefined) out.dy = (f.L.y - t.L.y) * 5;
    else out.toY = e.toY + (t.T.y - t.L.y) * 5;
    return out;
  });
}

export function generateAct1World(data: DrlgData, seed: number, ids: readonly number[] = ACT1_ALL): Act1World {
  const placement = placeAct1(data, seed);
  const levels = new Map<number, Act1Level>();
  let townFile = -1;
  for (const id of ids) {
    const placed = placement.levels.get(id);
    if (!placed) continue;
    let layout: LevelLayout;
    let touch: { levelId: number; box: Box }[] = [];
    if (placed.drlgType === DRLGTYPE.OUTDOOR) layout = generateOutdoorLevel(data, placement, id);
    else if (placed.drlgType === DRLGTYPE.MAZE) {
      const m = generateMazeLevel(data, placement, id);
      touch = m.orthBoxes;
      layout = m;
    } else {
      const p = generatePresetLevel(data, placement, id);
      if (id === LEVEL.ROGUEENCAMPMENT) townFile = p.picked;
      layout = p;
    }
    let waypoint: SpecialPos | null = null;
    const shrines: SpecialPos[] = [];
    for (const u of layout.units) {
      if (u.type !== 2) continue;
      const sc = data.objectSubClass(u.id);
      if (sc & OBJSUBCLASS.WAYPOINT) waypoint ??= { x: u.x, y: u.y, objectId: u.id };
      else if (sc & (OBJSUBCLASS.SHRINE | OBJSUBCLASS.WELL)) shrines.push({ x: u.x, y: u.y, objectId: u.id });
    }
    // 같은 대상으로 가는 이동 타일은 첫 번째만 (원작 방마다 하나의 room tile)
    const seen = new Set<number>();
    const entrances = layout.warps.filter((w) => !seen.has(w.toLevel) && (seen.add(w.toLevel), true));
    // 미로 레벨의 위치·크기는 생성 결과(방 경계)로 정해진다 (DRLG_UpdateRoomExCoordinates / PlaceAct1Barracks)
    const box = placed.drlgType === DRLGTYPE.MAZE ? layout.box : placed.box;
    levels.set(id, { id, drlgType: placed.drlgType, layout, box, waypoint, shrines, entrances, touch });
  }
  // 가장자리 연결: vis 에 서로 있고 warp = -1 이며 사각형이 맞닿은 쌍
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
  return { seed, placement, levels, exits, townFile };
}
