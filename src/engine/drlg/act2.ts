// Act 2 월드: 레벨 배치 (루트 골레인·사막 야외 링크) · 탈 라샤 무덤 선택 · 레벨 생성 · 가장자리/포털 연결.
// 출처: D2MOO DrlgDrlg.cpp DRLG_AllocDrlg (ACT_II: dwStartSeed 롤 → nStaffTombLevel / nBossTombLevel 롤 → CreateLevelConnections)
// 출처: D2MOO DrlgOutPlace.cpp DRLGOUTPLACE_CreateLevelConnections (ACT_II), gAct2OutdoorDrlgLink, gAct2CanyonDrlgLink,
//       sub_6FD81330 (오프셋), sub_6FD81B30 (Rocky Waste), sub_6FD81530 / sub_6FD81BF0 (8 방향), sub_6FD81430 / sub_6FD81850 / sub_6FD815E0 (좌표 배치),
//       DRLGOUTPLACE_LinkAct2Outdoors / LinkAct2Canyon (겹침 검사), sub_6FD823C0 (링크 실행·Lut Gholein 파일 방향·vis 등록), sub_6FD82750 (orth)
// 출처: D2MOO DrlgDrlg.cpp DRLG_AllocLevel / DRLG_InitLevel (레벨 시드 = levelId + dwStartSeed), DRLG_SetWarpId
// Act 1 파일(act1*.ts)과 같은 모양의 결과(Act1Placement / DrlgLevel)를 만들어 layout.ts·world-level.ts 를 그대로 쓴다.
import { Rng } from '../rng';
import { type Act1Level, type EdgeExit, type SpecialPos, edgeExitsVia } from './act1';
import { type Act1Placement, type PlacedLevel, directionFromCoords, levelSeed, notOverlapping } from './act1-link';
import { generateAct2MazeLevel } from './act2-maze';
import type { Box } from './grid';
import { generatePresetLevel, townStartSubtile, type LevelLayout } from './layout';
import { generateDesertLevel } from './outdesr';
import { DRLGTYPE, OBJSUBCLASS, type DrlgData } from './types';
import { addOrth } from './vertex';

// ---- 레벨 ID (출처: LevelsIds.h D2C_Levels — Act 2) ----
export const A2 = {
  LUTGHOLEIN: 40, ROCKYWASTE: 41, DRYHILLS: 42, FAROASIS: 43, LOSTCITY: 44, VALLEYOFSNAKES: 45, CANYONOFTHEMAGI: 46,
  SEWERSLEV1: 47, SEWERSLEV2: 48, SEWERSLEV3: 49, HAREMLEV1: 50, HAREMLEV2: 51,
  PALACECELLARLEV1: 52, PALACECELLARLEV2: 53, PALACECELLARLEV3: 54,
  STONYTOMBLEV1: 55, HALLSOFTHEDEADLEV1: 56, HALLSOFTHEDEADLEV2: 57, CLAWVIPERTEMPLELEV1: 58, STONYTOMBLEV2: 59,
  HALLSOFTHEDEADLEV3: 60, CLAWVIPERTEMPLELEV2: 61, MAGGOTLAIRLEV1: 62, MAGGOTLAIRLEV2: 63, MAGGOTLAIRLEV3: 64, ANCIENTTUNNELS: 65,
  TALRASHASTOMB1: 66, TALRASHASTOMB7: 72, DURIELSLAIR: 73, ARCANESANCTUARY: 74,
} as const;

// ---- LvlTypes Id (출처: LevelsIds.h D2C_LvlTypes — Act 2) ----
export const LVLTYPE2 = { TOWN: 12, SEWER: 13, HAREM: 14, BASEMENT: 15, DESERT: 16, TOMB: 17, LAIR: 18, ARCANE: 19 } as const;

/** 탈 라샤 무덤 7 개 (levels.txt 66~72) */
export const TAL_RASHA_TOMBS: readonly number[] = [66, 67, 68, 69, 70, 71, 72];

/** Act 2 오버월드 (마을 + 사막 야외 DrlgType 3) */
export const ACT2_OVERWORLD: readonly number[] = [40, 41, 42, 43, 44, 45, 46];
/** Act 2 던전 (미로 DrlgType 1 + 프리셋 DrlgType 2: 할렘 1·두리엘 방) — levels.txt 순서 */
export const ACT2_DUNGEONS: readonly number[] = Array.from({ length: 74 - 47 + 1 }, (_, i) => 47 + i);
/** Act 2 전체 */
export const ACT2_ALL: readonly number[] = [...ACT2_OVERWORLD, ...ACT2_DUNGEONS];

// ---------------- 레벨 링크 (DrlgOutPlace.cpp) ----------------

interface LinkEntry { linker: (d: LinkData) => boolean; level: number; link: number }
interface LinkData { seed: Rng; coord: Box[]; table: LinkEntry[]; rand: Int32Array; it: number; cur: number }
const R = (k: number, i: number) => k * 15 + i;
const linked = (d: LinkData) => d.coord[(d.table[d.it] as LinkEntry).link] as Box;

/** 출처: sub_6FD81430 */
function place1430(c1: Box, c2: Box, a3: number, a4: number): void {
  switch (a3) {
    case 0: c2.x = c1.x; c2.y = c1.y + c1.h; if (a4 === 1) c2.x -= 16; break;
    case 1: c2.x = c1.x - c2.w; c2.y = c1.y; if (a4 === 1) c2.y -= 16; else if (a4 === 2) c2.y += 8; break;
    case 2: c2.x = c1.x + c1.w - c2.w; c2.y = c1.y - c2.h; if (a4 === 1) c2.x += 16; break;
    case 3: c2.x = c1.x + c1.w; c2.y = c1.y + c1.h - c2.h; if (a4 === 1) c2.y += 16; else if (a4 === 2) c2.y -= 8; else if (a4 === 3) c2.y += 8; break;
  }
}

/** 출처: sub_6FD81850 (sub_6FD81430 의 반대쪽 정렬) */
function place1850(c1: Box, c2: Box, a3: number, a4: number): void {
  switch (a3) {
    case 0: c2.x = c1.x + c1.w - c2.w; c2.y = c1.y + c1.h; if (a4 === 1) c2.x += 16; break;
    case 1: c2.x = c1.x - c2.w; c2.y = c1.y + c1.h - c2.h; if (a4 === 1) c2.y += 16; else if (a4 === 2) c2.y -= 8; break;
    case 2: c2.x = c1.x; c2.y = c1.y - c2.h; if (a4 === 1) c2.x -= 16; break;
    case 3: c2.x = c1.x + c1.w; c2.y = c1.y; if (a4 === 1) c2.y -= 16; else if (a4 === 2) c2.y += 8; else if (a4 === 3) c2.y -= 8; break;
  }
}

/** 출처: sub_6FD815E0 — 8 방향 (a4 = 1 이면 상대 크기의 절반 + 8 만큼 어긋남) */
function place815E0(c1: Box, c2: Box, a3: number, a4: number): void {
  const hw = Math.trunc(c2.w / 2) + 8, hh = Math.trunc(c2.h / 2) + 8;
  switch (a3) {
    case 0: c2.x = c1.x; c2.y = c1.y + c1.h; if (a4 === 1) c2.x -= hw; break;
    case 1: c2.x = c1.x; c2.y = c1.y + c1.h; if (a4 === 1) c2.x += hw; break;
    case 2: c2.x = c1.x - c2.w; c2.y = c1.y; if (a4 === 1) c2.y -= hh; break;
    case 3: c2.x = c1.x - c2.w; c2.y = c1.y; if (a4 === 1) c2.y += hh; break;
    case 4: c2.x = c1.x; c2.y = c1.y - c2.h; if (a4 === 1) c2.x -= hw; break;
    case 5: c2.x = c1.x; c2.y = c1.y - c2.h; if (a4 === 1) c2.x += hw; break;
    case 6: c2.x = c1.x + c1.w; c2.y = c1.y; if (a4 === 1) c2.y -= hh; break;
    case 7: c2.x = c1.x + c1.w; c2.y = c1.y; if (a4 === 1) c2.y += hh; break;
  }
}

/** 출처: sub_6FD81330 — levels.txt OffsetX/Y 에 고정 */
function linkOffset(data: DrlgData): LinkEntry['linker'] {
  return (d) => {
    if (d.rand[R(1, d.it)] === -1) d.rand[R(0, d.it)] = -1;
    const lv = data.level(d.cur);
    const c = d.coord[d.it] as Box;
    c.x = lv.offsetX;
    c.y = lv.offsetY;
    return true;
  };
}

/** 출처: sub_6FD81B30 — Rocky Waste: 마을 서쪽(1) 또는 북쪽(2) */
const linkRockyWaste: LinkEntry['linker'] = (d) => {
  const i = d.it;
  if (d.rand[R(1, i)] === -1) {
    d.rand[R(1, i)] = (d.seed.roll() & 1) + 1;
    d.rand[R(0, i)] = d.rand[R(1, i)] as number;
  } else {
    const n = 2 - (d.rand[R(0, i)] !== 1 ? 1 : 0);
    if (n === d.rand[R(1, i)]) return false;
    d.rand[R(0, i)] = n;
  }
  if (d.rand[R(0, i)] === 1) place1430(linked(d), d.coord[i] as Box, 1, 0);
  else place1850(linked(d), d.coord[i] as Box, d.rand[R(0, i)] as number, 0);
  return true;
};

/** 출처: sub_6FD81530 (a4 = 1) / sub_6FD81BF0 (a4 = 0) — 8 방향 중 무작위 시작, 실패 시 다음 방향 */
function link8(a4: number): LinkEntry['linker'] {
  return (d) => {
    const i = d.it;
    if (d.rand[R(1, i)] === -1) {
      d.rand[R(1, i)] = d.seed.roll() & 7;
      d.rand[R(0, i)] = d.rand[R(1, i)] as number;
    } else {
      const n = ((d.rand[R(0, i)] as number) + 1) % 8;
      if (n === d.rand[R(1, i)]) return false;
      d.rand[R(0, i)] = n;
    }
    place815E0(linked(d), d.coord[i] as Box, d.rand[R(0, i)] as number, a4);
    return true;
  };
}

/** Act 2 배치 결과 (Act 1 과 같은 모양 + 무덤 선택) */
export interface Act2Placement extends Act1Placement {
  /** 원작 pDrlg->nStaffTombLevel: 호라드릭 지팡이를 꽂는 진짜 무덤 (Tal Rasha 방·두리엘 방 입구) */
  staffTomb: number;
  /** 원작 pDrlg->nBossTombLevel: 고대인 카아(Kaa the Soulless) 가 있는 가짜 무덤 */
  bossTomb: number;
}

/**
 * 진짜 탈 라샤 무덤 고르기 (DRLG 시드를 소비한다).
 * 출처: DrlgDrlg.cpp DRLG_AllocDrlg (ACT_II) — do { staff = roll % 7; boss = roll % 7 } while (staff == boss)
 */
export function rollTalRashaTombs(drlgSeed: Rng): { staffTomb: number; bossTomb: number } {
  let staff = 0, boss = 0;
  do {
    staff = (drlgSeed.roll() >>> 0) % 7;
    boss = (drlgSeed.roll() >>> 0) % 7;
  } while (staff === boss);
  return { staffTomb: A2.TALRASHASTOMB1 + staff, bossTomb: A2.TALRASHASTOMB1 + boss };
}

/**
 * Act 2 레벨 배치 전체.
 * 출처: DRLG_AllocDrlg (ACT_II: SEED_InitLowSeed(nInitSeed) → dwStartSeed 롤 → 무덤 롤 → DRLGOUTPLACE_CreateLevelConnections)
 */
export function placeAct2(data: DrlgData, initSeed: number): Act2Placement {
  const drlgSeed = new Rng(initSeed >>> 0);
  const startSeed = drlgSeed.roll();
  const { staffTomb, bossTomb } = rollTalRashaTombs(drlgSeed);
  const levels = new Map<number, PlacedLevel>();

  // 출처: DRLG_GetLevel → DRLG_AllocLevel (프리셋: DRLGPRESET_InitLevelData 파일 방향 롤, 미로: DRLGMAZE_InitLevelData) + DRLG_SetLevelPositionAndSize
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

  // 출처: sub_6FD823C0 (a4 = 0: Act 2 는 야외 플래그 규칙 없음) + DRLGOUTPLACE_LinkAct2Outdoors/LinkAct2Canyon (겹침 검사)
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
    const check = (it: number): boolean => {
      const link = (table[it] as LinkEntry).link;
      for (let i = 0; i < it; i++) if (i !== link && !notOverlapping(d.coord[it] as Box, d.coord[i] as Box, 0)) return false;
      return true;
    };
    let n = 0, guard = 0;
    while (n < table.length) {
      if (++guard > 100000) throw new Error('placeAct2: link loop did not converge');
      if (n < 0) throw new Error('placeAct2: link table exhausted');
      d.it = n;
      d.cur = (table[n] as LinkEntry).level;
      if ((table[n] as LinkEntry).linker(d)) {
        if (check(n)) ++n;
      } else {
        for (let k = 0; k < 4; k++) d.rand[R(k, n)] = -1;
        --n;
      }
    }
    table.forEach((e, i) => {
      const vis = e.link !== -1 ? (table[e.link] as LinkEntry).level : 0;
      const lv = getLevel(e.level);
      lv.box = { ...(d.coord[i] as Box) };
      // 출처: sub_6FD823C0 — Lut Gholein 파일 방향 = 다음 항목(Rocky Waste) 의 nRand[0] (1 = LutW, 2 = LutN)
      if (lv.drlgType === DRLGTYPE.PRESET && lv.id === A2.LUTGHOLEIN) lv.presetDirection = d.rand[R(0, i + 1)] as number;
      if (vis) {
        setWarp(lv, vis, -1);
        setWarp(getLevel(vis), e.level, -1);
      }
    });
  };

  const off = linkOffset(data);
  // 출처: gAct2OutdoorDrlgLink
  runTable([
    { linker: off, level: A2.LUTGHOLEIN, link: -1 },
    { linker: linkRockyWaste, level: A2.ROCKYWASTE, link: 0 },
    { linker: link8(1), level: A2.DRYHILLS, link: 1 },
    { linker: link8(1), level: A2.FAROASIS, link: 2 },
    { linker: link8(1), level: A2.LOSTCITY, link: 3 },
    { linker: link8(0), level: A2.VALLEYOFSNAKES, link: 4 },
  ]);
  // 출처: gAct2CanyonDrlgLink
  runTable([{ linker: off, level: A2.CANYONOFTHEMAGI, link: -1 }]);

  // 출처: sub_6FD82750(LUTGHOLEIN, CANYONOFTHEMAGI) — 야외 레벨의 warp -1 vis 로 orth 목록 구성
  for (let id = A2.LUTGHOLEIN; id <= A2.CANYONOFTHEMAGI; id++) {
    const lv = getLevel(id);
    if (lv.drlgType !== DRLGTYPE.OUTDOOR) continue;
    for (let j = 0; j < 8; j++) {
      const vis = lv.vis[j] as number;
      if (vis && lv.warp[j] === -1) {
        const other = getLevel(vis);
        addOrth(lv.orths, { levelId: vis, dir: directionFromCoords(lv.box, other.box), preset: other.drlgType === DRLGTYPE.PRESET, box: other.box });
      }
    }
  }
  // 원작은 레벨을 처음 참조할 때 할당한다 (공용 시드를 쓰지 않으므로 순서 무관)
  for (const id of ACT2_DUNGEONS) getLevel(id);
  return { startSeed, levels, staffTomb, bossTomb };
}

// ---------------- 월드 생성 ----------------

/** 레벨 사이 포털 (오브젝트) — 원작은 오브젝트를 눌러 넘어간다 */
export interface Act2Portal {
  from: number;
  to: number;
  /** 포털 오브젝트 위치 (from 레벨 서브타일) */
  x: number;
  y: number;
  /** 도착 위치 (to 레벨 서브타일) */
  toX: number;
  toY: number;
  /** 퀘스트로 열리는 포털 (Phase 7 에서 연결) */
  quest: string | null;
}

export interface Act2World {
  seed: number;
  placement: Act2Placement;
  levels: Map<number, Act1Level>;
  exits: EdgeExit[];
  /** 진짜 탈 라샤 무덤 (Tal Rasha 방·오리피스·두리엘 방 입구) = 원작 nStaffTombLevel */
  realTomb: number;
  /** 고대인 카아 무덤 = 원작 nBossTombLevel */
  kaaTomb: number;
  /** 루트 골레인 프리셋 파일 (1 LutW, 2 LutN) */
  townFile: number;
  /** 포털 (항상 열린 것 + 퀘스트 포털). 퀘스트 포털은 bridgeQuestPortals 일 때만 exits 에 들어간다 */
  portals: Act2Portal[];
}

export interface Act2Options {
  /** 디버그·테스트: 퀘스트 포털(비전의 성역 → 마기의 협곡, 진짜 무덤 → 두리엘 방)도 출구로 잇는다 */
  bridgeQuestPortals?: boolean;
}

/** 출처: objects.txt — 298 portal (Palace Cellar 3 ↔ Arcane Sanctuary), 152 orifice, 357 Tome (Horazon 의 일지) */
export const OBJ_ARCANE_PORTAL = 298, OBJ_ORIFICE = 152, OBJ_HORAZON_JOURNAL = 357;

/** Position=1 레벨 도착 위치 (마을과 같은 타일 정보 규칙 — DUNGEON_FindActSpawnLocationEx). 근사(원작 미확인): 후보 선택 시드는 레벨별 새 시드 */
function positionStart(layout: LevelLayout, seed: number): { x: number; y: number } {
  return townStartSubtile(layout, new Rng((seed ^ (layout.id * 0x27d4eb2d)) >>> 0)) ?? { x: Math.trunc((layout.box.w * 5) / 2), y: Math.trunc((layout.box.h * 5) / 2) };
}

/** 포털 오브젝트 둘레 5×5 서브타일 출구 (근사(원작 미확인): 원작은 오브젝트 클릭, 여기서는 들어서면 넘어간다) */
function portalExit(p: Act2Portal): EdgeExit {
  return { from: p.from, to: p.to, x: p.x - 2, y: p.y - 2, w: 5, h: 5, toX: p.toX, toY: p.toY };
}

/**
 * Act 2 월드 전체 생성.
 * 출처: DRLG_InitLevel → DRLGOUTDOORS_GenerateLevel (ACT_II: DRLGOUTDESR_InitAct2OutdoorLevel) / DRLGMAZE_GenerateLevel / DRLGPRESET_GenerateLevel
 */
export function generateAct2World(data: DrlgData, seed: number, opts: Act2Options = {}, ids: readonly number[] = ACT2_ALL): Act2World {
  const placement = placeAct2(data, seed);
  const levels = new Map<number, Act1Level>();
  let townFile = -1;
  for (const id of ids) {
    const placed = placement.levels.get(id);
    if (!placed) continue;
    let layout: LevelLayout;
    if (placed.drlgType === DRLGTYPE.OUTDOOR) layout = generateDesertLevel(data, placement, id);
    else if (placed.drlgType === DRLGTYPE.MAZE) layout = generateAct2MazeLevel(data, placement, id);
    else {
      const p = generatePresetLevel(data, placement, id);
      if (id === A2.LUTGHOLEIN) townFile = p.picked;
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
    const seen = new Set<number>();
    const entrances = layout.warps.filter((w) => !seen.has(w.toLevel) && (seen.add(w.toLevel), true));
    // 미로 레벨의 위치·크기는 생성 결과(방 경계)로 정해진다 (DRLG_UpdateRoomExCoordinates)
    const box = placed.drlgType === DRLGTYPE.MAZE ? layout.box : placed.box;
    levels.set(id, { id, drlgType: placed.drlgType, layout, box, waypoint, shrines, entrances, touch: [] });
  }

  // 가장자리 연결: vis 에 서로 있고 warp = -1 이며 사각형이 맞닿은 쌍 (사막 야외 + 루트 골레인)
  const exits: EdgeExit[] = [];
  const list = [...levels.values()];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as Act1Level, b = list[j] as Act1Level;
      const pa = placement.levels.get(a.id), pb = placement.levels.get(b.id);
      if (!pa || !pb) continue;
      const link = pa.vis.some((v, k) => v === b.id && pa.warp[k] === -1) || pb.vis.some((v, k) => v === a.id && pb.warp[k] === -1);
      if (link) exits.push(...edgeExitsVia(a.id, a.box, a.box, b.id, b.box, b.box));
    }

  // 포털: Palace Cellar 3 ↔ Arcane Sanctuary (오브젝트 298, 항상 열림), 비전의 성역 → 협곡·진짜 무덤 → 두리엘 방 (퀘스트)
  const portals: Act2Portal[] = [];
  const obj = (id: number, cls: number) => levels.get(id)?.layout.units.find((u) => u.type === 2 && u.id === cls) ?? null;
  const start = (id: number) => {
    const l = levels.get(id);
    return l ? positionStart(l.layout, seed) : null;
  };
  const cellar = obj(A2.PALACECELLARLEV3, OBJ_ARCANE_PORTAL), arcane = obj(A2.ARCANESANCTUARY, OBJ_ARCANE_PORTAL);
  const arcaneStart = start(A2.ARCANESANCTUARY);
  if (cellar && arcane && arcaneStart) {
    // 출처: objects.txt 298 portal (OperateFn 34) — Palace Cellar 3 (CelSE3.ds1) 과 성역 중앙 방 (SanctNSEW4.ds1) 에 하나씩
    portals.push({ from: A2.PALACECELLARLEV3, to: A2.ARCANESANCTUARY, x: cellar.x, y: cellar.y, toX: arcaneStart.x, toY: arcaneStart.y, quest: null });
    portals.push({ from: A2.ARCANESANCTUARY, to: A2.PALACECELLARLEV3, x: arcane.x, y: arcane.y, toX: cellar.x, toY: cellar.y + 3, quest: null });
  }
  const journal = obj(A2.ARCANESANCTUARY, OBJ_HORAZON_JOURNAL), canyonStart = start(A2.CANYONOFTHEMAGI);
  if (journal && canyonStart) {
    // 근사(원작 미확인): 원작은 일지를 읽으면(A2Q5) 붉은 포털이 열린다 — 여기서는 일지 자리를 포털 자리로 기록
    portals.push({ from: A2.ARCANESANCTUARY, to: A2.CANYONOFTHEMAGI, x: journal.x, y: journal.y, toX: canyonStart.x, toY: canyonStart.y, quest: 'A2Q5 소환사: 호라존의 일지' });
  }
  const orifice = obj(placement.staffTomb, OBJ_ORIFICE), lairStart = start(A2.DURIELSLAIR);
  if (orifice && lairStart) {
    // 근사(원작 미확인): 원작은 오리피스에 호라드릭 지팡이를 꽂으면(A2Q6) 두리엘 방 입구가 열린다
    portals.push({ from: placement.staffTomb, to: A2.DURIELSLAIR, x: orifice.x, y: orifice.y, toX: lairStart.x, toY: lairStart.y, quest: 'A2Q6 일곱 무덤: 호라드릭 지팡이' });
  }
  for (const p of portals) if (!p.quest || opts.bridgeQuestPortals) exits.push(portalExit(p));

  return { seed, placement, levels, exits, realTomb: placement.staffTomb, kaaTomb: placement.bossTomb, townFile, portals };
}
