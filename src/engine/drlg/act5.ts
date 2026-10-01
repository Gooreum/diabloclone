// 확장팩 Act 5 월드 전체: Harrogath(프리셋) · Bloody Foothills(공성 띠) · Frigid Highlands · Arreat Plateau · Frozen Tundra(Barricade 야외) ·
// 얼음 동굴 7 · Arreat Summit · Nihlathak 신전 4 · 지옥 구덩이 3 · Worldstone Keep 3 · 파괴의 왕좌 · Worldstone Chamber · 레벨 연결 · 특수 위치.
// 출처: D2MOO DrlgDrlg.cpp DRLG_AllocDrlg (ACT_V: 추가 롤 없음), DRLG_InitLevel
// 출처: D2MOO DrlgOutPlace.cpp DRLGOUTPLACE_CreateLevelConnections (ACT_V), gAct5OutdoorDrlgLink, gAct5TundraDrlgLink,
//       sub_6FD823C0 (Act 5 는 링크 표의 vis/warp −1 등록을 하지 않는다, 겹침 검사 함수 없음), sub_6FD81330, sub_6FD826D0, sub_6FD82750,
//       DRLGOUTPLACE_InitOutdoorRoomGrids (LVLTYPE_ACT5_BARRICADE: Frozen Tundra 0x600000)
// 출처: D2MOO DrlgOutRoom.cpp DRLGOUTROOM_LinkLevelsByLevelCoords / ByLevelDef / ByOffsetCoords (64×160 또는 160×64)
// 출처: D2MOO DrlgOutdoors.cpp DRLGOUTDOORS_GenerateLevel (ACT_V → DRLGOUTSIEGE_InitAct5OutdoorLevel, DT1 마스크 0x11)
import { Rng } from '../rng';
import { directionFromCoords, levelSeed, type Act1Placement, type PlacedLevel } from './act1-link';
import { edgeExitsVia, type Act1Level, type EdgeExit, type SpecialPos } from './act1';
import { generateAct5MazeLevel } from './act5-maze';
import { ACT5_ALL, LEVEL5, LVLTYPE5 } from './act5-ids';
import type { DrlgWorld } from './acts';
import { DrlgGrid, Op, type Box } from './grid';
import { Assembler, generatePresetLevel, presetMapRooms, type LayoutUnit, type LevelLayout } from './layout';
import { generateOutdoorGrid } from './outdoors';
import { initAct5Outdoor } from './outsiege';
import { buildOutdoorRoom, type RoomBuild } from './rooms';
import { addOrth } from './vertex';
import { DRLGTYPE, G2, OBJSUBCLASS, pickedFileOf, type DrlgData } from './types';

export { ACT5_ALL, LEVEL5 } from './act5-ids';

/** 출처: DRLGOUTDOORS_GenerateLevel — LVLTYPE_ACT5_SIEGE / LVLTYPE_ACT5_BARRICADE 의 DT1 마스크 */
export const ACT5_OUTDOOR_DT1_MASK = 0x11;

// =====================================================================================================
// 레벨 배치 (DRLGOUTPLACE_CreateLevelConnections ACT_V)
// =====================================================================================================

interface LinkEntry { linker: (d: LinkData) => boolean; level: number; link: number }
interface LinkData { seed: Rng; coord: Box[]; table: LinkEntry[]; rand: Int32Array; it: number; cur: number }
const R = (k: number, i: number) => k * 15 + i;

/** 원작 링크 표 하나 (sub_6FD823C0). Act 5 는 vis 등록·겹침 검사가 없다 */
function runTable(data: DrlgData, drlgSeed: Rng, table: LinkEntry[]): Box[] {
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
    if (++guard > 100000) throw new Error('placeAct5: link loop did not converge');
    d.it = n;
    d.cur = (table[n] as LinkEntry).level;
    if ((table[n] as LinkEntry).linker(d)) ++n;
    else {
      for (let k = 0; k < 4; k++) d.rand[R(k, n)] = -1;
      --n;
    }
  }
  return d.coord;
}

/** 출처: sub_6FD81330 — levels.txt OffsetX/Y 에 고정 */
const linkOffset = (data: DrlgData) => (d: LinkData): boolean => {
  if (d.rand[R(1, d.it)] === -1) d.rand[R(0, d.it)] = -1;
  const rec = data.level(d.cur);
  const c = d.coord[d.it] as Box;
  c.x = rec.offsetX;
  c.y = rec.offsetY;
  return true;
};

/** 64×160 (0) / 160×64 (1) */
function setOrientation(c: Box, r: number): void {
  if (r === 0) { c.w = 64; c.h = 160; } else if (r === 1) { c.w = 160; c.h = 64; }
}

/** 출처: DRLGOUTROOM_LinkLevelsByLevelCoords — 무작위 방향, 링크 레벨의 왼쪽에 아래 끝을 16 위로 맞춰 */
const linkByLevelCoords = (d: LinkData): boolean => {
  const i = d.it, r = d.seed.roll() & 1;
  d.rand[R(0, i)] = r;
  d.rand[R(1, i)] = r;
  const c = d.coord[i] as Box, l = d.coord[(d.table[i] as LinkEntry).link] as Box;
  setOrientation(c, r);
  c.x = l.x - c.w;
  c.y = l.h - c.h + l.y - 16;
  return true;
};

/** 출처: DRLGOUTROOM_LinkLevelsByLevelDef — 무작위 방향, levels.txt OffsetX/Y */
const linkByLevelDef = (data: DrlgData) => (d: LinkData): boolean => {
  const i = d.it, r = d.seed.roll() & 1;
  d.rand[R(0, i)] = r;
  d.rand[R(1, i)] = r;
  const c = d.coord[i] as Box;
  setOrientation(c, r);
  const rec = data.level(d.cur);
  c.x = rec.offsetX;
  c.y = rec.offsetY;
  return true;
};

/** 출처: DRLGOUTROOM_LinkLevelsByOffsetCoords — 두 방향을 차례로 시도, 링크 레벨 방향과 합쳐 4 가지 어긋남 */
const OFFSET_COORDS: readonly (readonly [number, number])[] = [[0, -160], [-96, -64], [-64, -96], [-160, 0]];
const linkByOffsetCoords = (d: LinkData): boolean => {
  const i = d.it;
  if (d.rand[R(1, i)] === -1) {
    d.rand[R(1, i)] = d.seed.roll() & 1;
    d.rand[R(0, i)] = d.rand[R(1, i)] as number;
  } else {
    const b = d.rand[R(0, i)] === 0 ? 1 : 0;
    if (b === d.rand[R(1, i)]) return false;
    d.rand[R(0, i)] = b;
  }
  const c = d.coord[i] as Box;
  const link = (d.table[i] as LinkEntry).link;
  setOrientation(c, d.rand[R(0, i)] as number);
  const o = OFFSET_COORDS[(d.rand[R(0, i)] as number) + 2 * (d.rand[R(0, link)] as number)] as readonly [number, number];
  const l = d.coord[link] as Box;
  c.x = l.x + o[0];
  c.y = l.y + o[1];
  return true;
};

/** 출처: DRLG_CheckOverlappingWithOrthogonalMargin (margin −1 = 변이 맞닿고 1 칸 이상 겹침) */
function overlapsOrthogonal(a: Box, b: Box, margin: number): boolean {
  const dx = a.x >= b.x ? a.x - b.w - b.x : b.x - a.w - a.x;
  const dy = a.y >= b.y ? a.y - b.h - b.y : b.y - a.h - a.y;
  return (dx === 0 && dy <= margin) || (dy === 0 && dx <= margin);
}

/**
 * Act 5 레벨 배치 전체.
 * 출처: DRLG_AllocDrlg (SEED_InitLowSeed(nInitSeed) → dwStartSeed 롤) → DRLGOUTPLACE_CreateLevelConnections (ACT_V)
 */
export function placeAct5(data: DrlgData, initSeed: number): Act1Placement {
  const drlgSeed = new Rng(initSeed >>> 0);
  const startSeed = drlgSeed.roll();
  const levels = new Map<number, PlacedLevel>();

  // 출처: DRLG_GetLevel → DRLG_AllocLevel (프리셋 파일 롤) + DRLG_SetLevelPositionAndSize
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
  const apply = (table: LinkEntry[], coord: Box[]) => table.forEach((e, i) => { getLevel(e.level).box = { ...(coord[i] as Box) }; });

  // 출처: gAct5OutdoorDrlgLink / gAct5TundraDrlgLink
  const outdoor: LinkEntry[] = [
    { linker: linkOffset(data), level: LEVEL5.HARROGATH, link: -1 },
    { linker: linkOffset(data), level: LEVEL5.BLOODYFOOTHILLS, link: 0 },
    { linker: linkByLevelCoords, level: LEVEL5.FRIGIDHIGHLANDS, link: 1 },
    { linker: linkByOffsetCoords, level: LEVEL5.ARREATPLATEAU, link: 2 },
  ];
  apply(outdoor, runTable(data, drlgSeed, outdoor));
  const tundra: LinkEntry[] = [{ linker: linkByLevelDef(data), level: LEVEL5.FROZENTUNDRA, link: -1 }];
  apply(tundra, runTable(data, drlgSeed, tundra));

  // 출처: sub_6FD826D0 — 변이 맞닿은 레벨끼리 vis 로 (warp −1 = 가장자리 연결)
  const link826 = (from: number, to: number) => {
    for (let i = from; i <= to; ++i) {
      const a = getLevel(i);
      for (let j = from; j <= to; ++j) if (i !== j && overlapsOrthogonal(a.box, getLevel(j).box, -1)) setWarp(a, j, -1);
    }
  };
  // 출처: sub_6FD82750 — 야외 레벨의 warp −1 이웃을 orth 로
  const orth750 = (from: number, to: number) => {
    for (let i = from; i <= to; ++i) {
      const lv = getLevel(i);
      if (lv.drlgType !== DRLGTYPE.OUTDOOR) continue;
      for (let j = 0; j < 8; j++) {
        const vis = lv.vis[j] as number;
        if (vis && lv.warp[j] === -1) {
          const o = getLevel(vis);
          addOrth(lv.orths, { levelId: vis, dir: directionFromCoords(lv.box, o.box), preset: o.drlgType === DRLGTYPE.PRESET, box: o.box });
        }
      }
    }
  };
  link826(LEVEL5.FRIGIDHIGHLANDS, LEVEL5.ARREATPLATEAU);
  orth750(LEVEL5.FRIGIDHIGHLANDS, LEVEL5.ARREATPLATEAU);
  link826(LEVEL5.BLOODYFOOTHILLS, LEVEL5.FRIGIDHIGHLANDS);
  link826(LEVEL5.HARROGATH, LEVEL5.BLOODYFOOTHILLS);
  // 나머지(프리셋·미로)는 공용 시드를 쓰지 않으므로 한꺼번에 할당해도 같다
  for (const id of ACT5_ALL) getLevel(id);
  return { startSeed, levels };
}

// =====================================================================================================
// 야외 레벨 방 만들기
// =====================================================================================================

/** 출처: DRLGOUTPLACE_InitOutdoorRoomGrids — LVLTYPE_ACT5_BARRICADE: Frozen Tundra 만 빈 바닥 칸에 0x600000 */
function applyOutdoorFloorFlags(room: RoomBuild, flags: number): void {
  if (!flags) return;
  const floor = room.floors[0] as DrlgGrid;
  for (let y = 0; y <= room.h; y++)
    for (let x = 0; x <= room.w; x++) if (!(floor.get(x, y) & 0x3f0ff80)) floor.alter(x, y, flags, Op.OR);
}

/** Act 5 야외 레벨 (Bloody Foothills / Frigid Highlands / Arreat Plateau / Frozen Tundra) */
export function generateAct5OutdoorLevel(data: DrlgData, placement: Act1Placement, id: number): LevelLayout {
  const lv = generateOutdoorGrid(data, placement, id, initAct5Outdoor);
  const floorFlags = lv.rec.levelType === LVLTYPE5.BARRICADE && id === LEVEL5.FROZENTUNDRA ? 0x600000 : 0;
  const A = new Assembler(data, lv.box.w, lv.box.h, lv.placed.vis, lv.placed.warp);
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
        const r = buildOutdoorRoom(data, lv, i, j, flags, ACT5_OUTDOOR_DT1_MASK);
        applyOutdoorFloorFlags(r, floorFlags);
        all.push(r);
      }
    }
  for (const r of all) A.addRoom(r);
  for (const r of all) A.addRoomEdges(r);
  return { id, box: lv.box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, outdoor: lv };
}

// =====================================================================================================
// 벽 타일이 만드는 유닛 (DRLGROOMTILE_AddTilePresetUnits — Act 5 줄)
// =====================================================================================================

/**
 * 출처: DrlgRoomTile.cpp stru_6FDD0DA8 (레벨 → 표 범위: Harrogath 23~24, Frigid Highlands·Arreat Plateau·Frozen Tundra 24~33) ·
 *   stru_6FDD0F68 { 스타일, 순번, 오른쪽 벽 문인가, 유닛, 종류, dx, dy } — 문 달린 벽 타일 (TILETYPE_WALL_LEFT_DOOR 8 / RIGHT_DOOR 9) 에서
 */
const TILE_UNITS: readonly { style: number; seq: number; right: boolean; type: 1 | 2; unit: string | number; dx: number; dy: number }[] = [
  { style: 3, seq: 3, right: false, type: 2, unit: 449, dx: -2, dy: 4 }, // 23 OBJECT_HARROGATH_TOWN_MAIN_GATE
  { style: 2, seq: 1, right: false, type: 1, unit: 'barricadetower', dx: 1, dy: 2 }, // 24
  { style: 2, seq: 1, right: true, type: 1, unit: 'barricadetower', dx: 2, dy: 1 },
  { style: 2, seq: 6, right: false, type: 1, unit: 'barricadetower', dx: 1, dy: 1 },
  { style: 2, seq: 2, right: false, type: 1, unit: 'barricadedoor2', dx: 0, dy: 1 },
  { style: 2, seq: 3, right: true, type: 1, unit: 'barricadedoor1', dx: 1, dy: 0 },
  { style: 26, seq: 0, right: false, type: 1, unit: 'prisondoor', dx: 0, dy: 1 },
  { style: 2, seq: 4, right: true, type: 1, unit: 'barricadewall1', dx: 0, dy: 0 },
  { style: 2, seq: 4, right: false, type: 1, unit: 'barricadewall2', dx: 0, dy: 0 },
  { style: 29, seq: 0, right: true, type: 2, unit: 60, dx: 2, dy: 0 }, // OBJECT_PERMANENT_TOWN_PORTAL
  { style: 29, seq: 0, right: false, type: 2, unit: 60, dx: 0, dy: 2 }, // 33
];
const TILE_UNIT_RANGE: Readonly<Record<number, readonly [number, number]>> = {
  [LEVEL5.HARROGATH]: [0, 1], [LEVEL5.FRIGIDHIGHLANDS]: [1, 10], [LEVEL5.ARREATPLATEAU]: [1, 10], [LEVEL5.FROZENTUNDRA]: [1, 10],
};

/**
 * 레벨의 문 달린 벽 타일 → 유닛 (몬스터는 monstats Id, 오브젝트는 objects.txt 번호). 표의 첫 일치 줄 하나.
 * 근사(원작 미확인): 원작은 방마다 (방 안 서브타일만) — 여기서는 레벨 전체 (같은 타일이 이웃 방 가장자리에 겹쳐도 한 번)
 */
export function act5TileUnits(levelId: number, layout: LevelLayout): LayoutUnit[] {
  const range = TILE_UNIT_RANGE[levelId];
  if (!range) return [];
  const out: LayoutUnit[] = [];
  const seen = new Set<string>();
  const W = layout.ds1.width;
  for (const layer of layout.ds1.walls) {
    layer.forEach((c, i) => {
      if (c.orientation !== 8 && c.orientation !== 9) return;
      const right = c.orientation === 9;
      for (let j = range[0]; j <= range[1]; j++) {
        const t = TILE_UNITS[j] as (typeof TILE_UNITS)[number];
        if (c.style !== t.style || c.sequence !== t.seq || right !== t.right) continue;
        const x = (i % W) * 5 + t.dx, y = Math.floor(i / W) * 5 + t.dy;
        const k = `${x},${y}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(t.type === 1 ? { type: 1, id: -1, x, y, mon: t.unit as string } : { type: 2, id: t.unit as number, x, y });
        }
        return;
      }
    });
  }
  return out;
}

// =====================================================================================================
// 월드
// =====================================================================================================

export interface Act5World extends DrlgWorld {
  placement: Act1Placement;
  levels: Map<number, Act1Level>;
  exits: EdgeExit[];
}

/** 레벨 결과 → 웨이포인트·신전 (objects.txt SubClass) */
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

/** Act 5 월드 (게임 시드 → 결정적) */
export function generateAct5World(data: DrlgData, seed: number, ids: readonly number[] = ACT5_ALL): Act5World {
  const placement = placeAct5(data, seed);
  const levels = new Map<number, Act1Level>();
  for (const id of ids) {
    const placed = placement.levels.get(id);
    if (!placed) continue;
    let layout: LevelLayout;
    let box = placed.box;
    if (placed.drlgType === DRLGTYPE.MAZE) {
      const m = generateAct5MazeLevel(data, placement, id);
      layout = m;
      box = m.box;
    } else if (placed.drlgType === DRLGTYPE.OUTDOOR) layout = generateAct5OutdoorLevel(data, placement, id);
    else layout = generatePresetLevel(data, placement, id);
    // 문 달린 벽 타일이 만드는 유닛 (감옥 문·바리케이드 문·벽·탑, Harrogath 정문)
    layout.units.push(...act5TileUnits(id, layout));
    const { waypoint, shrines } = specials(data, layout);
    const seen = new Set<number>();
    const entrances = layout.warps.filter((w) => !seen.has(w.toLevel) && (seen.add(w.toLevel), true));
    levels.set(id, { id, drlgType: placed.drlgType, layout, box, waypoint, shrines, entrances, touch: [] });
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
      exits.push(...edgeExitsVia(a.id, a.box, a.box, b.id, b.box, b.box));
    }
  return { seed, placement, levels, exits };
}
