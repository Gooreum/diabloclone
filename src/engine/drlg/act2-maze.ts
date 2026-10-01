// Act 2 미로 레벨 (DrlgType 1): 하수도·할렘 2·궁전 지하 1~3·무덤(바위 무덤·죽은 자의 전당·발톱 독사 사원·탈 라샤 무덤 7)·
// 구더기 굴·고대 토굴·비전의 성역.
// 미로 공용 규칙(방 붙이기·합치기·특수 방 바꾸기)은 maze.ts 를 쓰고, 여기는 Act 2 LvlType 분기만 이식한다.
// 출처: D2MOO DrlgMaze.cpp DRLGMAZE_GenerateLevel (LVLTYPE_ACT2_SEWER / HAREM / BASEMENT / TOMB / LAIR / ARCANE 분기),
//       DRLGMAZE_PickRoomPreset (Act 2 분기·nHardcodedPresetsRemapping), DRLGMAZE_BuildBasicMaze, DRLGMAZE_PlaceAct2TombPrev_Act5BaalPrev,
//       DRLGMAZE_PlaceAct2TombStuff, DRLGMAZE_PlaceAct2LairStuff, DRLGMAZE_ScanReplaceSpecialAct2SewersPresets,
//       DRLGMAZE_RollAct_1_2_3_BasicPresets, DRLGMAZE_RollBasicPresets (Act 2 기준 Def)
import type { Act1Placement } from './act1-link';
import { levelSeed } from './act1-link';
import type { Box } from './grid';
import { Assembler } from './layout';
import { placeArcaneSanctuary } from './logic';
import {
  type MazeId, type MazeLayout, type MazeLevel, type MazeRoom, addAdjacentMazeRoom, addRoomToLevel, addSpecialPreset, allocOrths, allocRoom,
  freeLocation, freeRoom, initBasicMazeLayout, initRoomFixedPreset, linkMazeRooms, mergeMazeRooms, nesw, pickRoomPreset, placeAdjacentPresetRoom,
  randomRoom, replaceRoomPreset, roomBounds, scanReplaceSpecialPreset, setPickedFileAndPresetId, updateRoomCoordinates,
} from './maze';
import { buildPresetRooms, type RoomBuild } from './rooms';
import type { DrlgData } from './types';

// ---- LvlTypes Id (출처: LevelsIds.h D2C_LvlTypes) ----
const T = { SEWER: 13, HAREM: 14, BASEMENT: 15, TOMB: 17, LAIR: 18, ARCANE: 19 } as const;

// ---- LvlPrest Def (출처: LevelsIds.h D2C_LvlPrestIds — LvlPrest.txt 행 번호, Act 2 미로) ----
export const MZ2 = {
  TOWN: 301, // 하수도 방 기준 (LVLPREST_ACT2_TOWN + 방향 비트 = SEWER_W..NSEW)
  SEWER_PREV_W: 332, SEWER_PREV_E: 333, SEWER_PREV_NS: 336, SEWER_NEXT_W: 337, SEWER_RADAMENT_W: 341, SEWER_WAYPOINT_W: 345, SEWER_CHEST_W: 349,
  CORRUPT_HAREM_NE: 354, CORRUPT_HAREM_SE: 355, CORRUPT_HAREM_SW: 356, CORRUPT_HAREM_NW: 357,
  BASEMENT_NE: 358, BASEMENT_SE: 359, BASEMENT_SW: 360, BASEMENT_NW: 361,
  RUINS_ELDER: 413, // 무덤 방 기준 (+ 방향 비트 = TOMB_W..NSEW)
  TOMB_PREV_SEW: 444, TOMB_PREV_NEW: 445, TOMB_PREV_NSW: 446, TOMB_PREV_NSE: 447,
  TOMB_NEXT_W: 448, TOMB_TREASURE_W: 452, TOMB_CUBE_W: 456, TOMB_TALRASHA_W: 460, TOMB_LEATHERARM_W: 464, TOMB_KAA_W: 468,
  TOMB_CHEST_W: 472, TOMB_WAYPOINT_W: 476, TOMB_TAINTED_SUN_X: 480,
  DURIELS_LAIR: 481, // 구더기 굴 방 기준 (+ 방향 비트 = LAIR_W..NSEW)
  LAIR_S: 485, LAIR_W: 482, LAIR_PREV_W: 497, LAIR_NEXT_W: 501, LAIR_TREASURE_W: 505, LAIR_TIGHT_SPOT_S: 509, // 성역 방 기준 (+ 비트 = ARCANE_W..)
  ARCANE_SUMMONER_W: 525,
} as const;

// ---- Act 2 레벨 ID (출처: LevelsIds.h) ----
const LV = {
  SEWERSLEV1: 47, SEWERSLEV2: 48, SEWERSLEV3: 49, PALACECELLARLEV1: 52, PALACECELLARLEV3: 54,
  STONYTOMBLEV1: 55, HALLSOFTHEDEADLEV2: 57, CLAWVIPERTEMPLELEV1: 58, STONYTOMBLEV2: 59, HALLSOFTHEDEADLEV3: 60, CLAWVIPERTEMPLELEV2: 61,
  MAGGOTLAIRLEV3: 64, ANCIENTTUNNELS: 65, TALRASHASTOMB1: 66, TALRASHASTOMB7: 72,
} as const;

// 출처: DRLGMAZE_PickRoomPreset nHardcodedPresetsRemapping[16][3] 의 열 0 (할렘)·1 (지하) — 방향 비트(W1 E2 S4 N8) → 대각선 방
const REMAP_HAREM: Record<number, number> = { 5: MZ2.CORRUPT_HAREM_SW, 6: MZ2.CORRUPT_HAREM_SE, 9: MZ2.CORRUPT_HAREM_NW, 10: MZ2.CORRUPT_HAREM_NE };
const REMAP_BASEMENT: Record<number, number> = { 5: MZ2.BASEMENT_SW, 6: MZ2.BASEMENT_SE, 9: MZ2.BASEMENT_NW, 10: MZ2.BASEMENT_NE };

/** 출처: DRLGMAZE_PickRoomPreset — Act 2 LvlType 분기 */
export function pickAct2RoomPreset(L: MazeLevel, r: MazeRoom, reset: boolean): void {
  let bits = 0;
  for (const o of r.orths) bits |= [1, 8, 2, 4][o.dir] ?? 0;
  let prest: number, file = -1;
  switch (L.levelType) {
    case T.SEWER: prest = bits + MZ2.TOWN; break;
    case T.HAREM: prest = REMAP_HAREM[bits] ?? 0; break;
    case T.BASEMENT:
      prest = REMAP_BASEMENT[bits] ?? 0;
      // 출처: Palace Cellar 1 의 NW 방 = 파일 2 (CelNWWaypoint), Palace Cellar 3 의 NW·SE 방 = 파일 3 (CelSE3 = 비전의 성역 포털)
      if (L.id === LV.PALACECELLARLEV1 && prest === MZ2.BASEMENT_NW) file = 2;
      if (L.id === LV.PALACECELLARLEV3 && (prest === MZ2.BASEMENT_NW || prest === MZ2.BASEMENT_SE)) file = 3;
      break;
    case T.TOMB: prest = bits + MZ2.RUINS_ELDER; break;
    case T.LAIR: prest = bits + MZ2.DURIELS_LAIR; break;
    case T.ARCANE: prest = bits + MZ2.LAIR_TIGHT_SPOT_S; break;
    default: throw new Error(`sSetChamberPreset() - Some really bad voodoo here! (levelType ${L.levelType})`);
  }
  if (prest) setPickedFileAndPresetId(r, prest, file, reset);
}

/** Act 2 무덤 선택 (원작 pDrlg->nStaffTombLevel / nBossTombLevel) — 방 수 3 배 / 2 배 */
interface TombPick { staffTomb: number; bossTomb: number }

/** 출처: DRLGMAZE_BuildBasicMaze — 무작위 방 옆에 방을 붙여 LvlMaze Rooms (진짜 무덤 ×3, 카아 무덤 ×2) 까지 */
function buildBasicMaze(L: MazeLevel, tombs: TombPick): void {
  let n = L.maze.rooms;
  if (L.id === tombs.staffTomb) n *= 3;
  if (L.id === tombs.bossTomb) n *= 2;
  let guard = 0;
  while (L.rooms.length < n) {
    if (++guard > 100000) throw new Error(`maze ${L.id}: BuildBasicMaze did not converge`);
    const r = randomRoom(L);
    const dir = r.seed.roll() & 3;
    if (!r.hasMap) addAdjacentMazeRoom(L, r, dir, true);
  }
}

/**
 * 출처: DRLGMAZE_PlaceAct2TombPrev_Act5BaalPrev — 첫 방 둘레 세 방향에 방을 붙이고 첫 방을 이전 층 방(세 갈래)으로.
 * @param PREV 원작 dword_6FDCE8B4 열 (Act 2 무덤: TOMB_PREV_NSE/SEW/NSW/NEW, Act 5 월드스톤 킵: BAAL_PREV_…)
 */
export function placeTombPrev(L: MazeLevel, PREV: readonly number[] = [MZ2.TOMB_PREV_NSE, MZ2.TOMB_PREV_SEW, MZ2.TOMB_PREV_NSW, MZ2.TOMB_PREV_NEW]): void {
  const first = L.rooms[0] as MazeRoom;
  let dir = L.seed.roll() & 3;
  for (let i = 0; i < 3; i++) {
    const r = allocRoom(L);
    if (linkMazeRooms(L, r, first, dir)) {
      allocOrths(first, r, dir);
      mergeMazeRooms(L, r);
      addRoomToLevel(L, r);
      pickRoomPreset(L, first, true);
      pickRoomPreset(L, r, true);
    } else freeRoom(L, r);
    dir = (dir + 1) % 4;
  }
  first.prest = PREV[dir] as number;
  first.picked = -1;
  first.hasMap = true;
}

/** 바꾸기, 없으면 붙이기 (DRLGMAZE_ReplaceRoomPreset → DRLGMAZE_AddSpecialPreset) */
function replaceOrAdd(L: MazeLevel, m: MazeId): void {
  if (!replaceRoomPreset(L, m[0], m[1], m[2], false)) addSpecialPreset(L, m[3], m[1], m[2]);
}

/** 출처: DRLGMAZE_PlaceAct2TombStuff — 이전 층 방 모양으로 방향을 정하고, 레벨별 특수 방을 차례로 */
function placeTombStuff(L: MazeLevel, tombs: TombPick): void {
  const B = MZ2.RUINS_ELDER;
  let prev: MazeRoom | null = null;
  for (const r of L.rooms) {
    prev = r;
    if (r.prest > B + 15) break;
  }
  let dir: number;
  switch (prev?.prest) {
    case MZ2.TOMB_PREV_NSW: dir = 0; break;
    case MZ2.TOMB_PREV_NEW: dir = 1; break;
    case MZ2.TOMB_PREV_NSE: dir = 2; break;
    case MZ2.TOMB_PREV_SEW: dir = 3; break;
    default: throw new Error("sPlaceTombStuff() - Why isn't the first room the preset warp room?");
  }
  const step = (special: number) => {
    replaceOrAdd(L, nesw(B, special)[dir] as MazeId);
    dir = (dir + 1) % 4;
  };
  const isTal = L.id >= LV.TALRASHASTOMB1 && L.id <= LV.TALRASHASTOMB7;
  if (L.id >= LV.STONYTOMBLEV1 && L.id <= LV.CLAWVIPERTEMPLELEV1) {
    // 원작: 바꾸기 실패 시 InitRoomFixedPreset 루프 (DRLGMAZE_AddSpecialPreset 과 같은 동작)
    const m = nesw(B, MZ2.TOMB_NEXT_W)[dir] as MazeId;
    if (!replaceRoomPreset(L, m[0], m[1], m[2], false)) {
      for (const i of [...L.rooms]) if (!i.hasMap && initRoomFixedPreset(L, i, m[3], m[1], m[2], true)) break;
    }
    dir = (dir + 1) % 4;
  }
  if (L.id === LV.HALLSOFTHEDEADLEV2) step(MZ2.TOMB_WAYPOINT_W);
  if (L.id === LV.STONYTOMBLEV2 || L.id === LV.CLAWVIPERTEMPLELEV2) step(MZ2.TOMB_CHEST_W);
  if (isTal && L.id !== tombs.staffTomb) step(MZ2.TOMB_CHEST_W);
  if (L.id === LV.STONYTOMBLEV2) step(MZ2.TOMB_LEATHERARM_W);
  if (L.id === LV.HALLSOFTHEDEADLEV3) step(MZ2.TOMB_CUBE_W);
  if (L.id === LV.STONYTOMBLEV2 || L.id === LV.CLAWVIPERTEMPLELEV2) step(MZ2.TOMB_TREASURE_W);
  if (L.id === tombs.staffTomb) step(MZ2.TOMB_TALRASHA_W);
  if (L.id === tombs.bossTomb) dir = scanReplaceSpecialPreset(L, nesw(B, MZ2.TOMB_KAA_W)[dir] as MazeId, dir);
}

/** 출처: DRLGMAZE_PlaceAct2LairStuff — 구더기 굴 3 은 여왕 방(Tight Spot S)·보물 방, 나머지는 다음 층 방; 끝으로 이전 층 방 */
function placeLairStuff(L: MazeLevel): void {
  const B = MZ2.DURIELS_LAIR;
  const rand = L.seed.roll() & 3;
  let idx: number;
  if (L.id === LV.MAGGOTLAIRLEV3) {
    let r = L.rooms.find((x) => !x.hasMap && x.prest === MZ2.LAIR_S) ?? null;
    if (r) setPickedFileAndPresetId(r, MZ2.LAIR_TIGHT_SPOT_S, -1, false);
    else for (const i of [...L.rooms]) if (!i.hasMap && initRoomFixedPreset(L, i, 1, MZ2.LAIR_TIGHT_SPOT_S, -1, true)) break;
    r = L.rooms.find((x) => !x.hasMap && x.prest === MZ2.LAIR_W) ?? null;
    if (r) setPickedFileAndPresetId(r, MZ2.LAIR_TREASURE_W, -1, false);
    else addSpecialPreset(L, 2, MZ2.LAIR_TREASURE_W, -1);
    idx = 0;
  } else {
    // 출처: nAct2LairSpecialIds[nRand] — nRand 는 0~3 이므로 항상 다음 층(Next) 방
    const m = nesw(B, MZ2.LAIR_NEXT_W)[rand] as MazeId;
    const r = L.rooms.find((x) => !x.hasMap && x.prest === m[0]) ?? null;
    if (r) setPickedFileAndPresetId(r, m[1], m[2], false);
    else addSpecialPreset(L, m[3], m[1], m[2]);
    idx = (rand + 1) % 4;
  }
  replaceOrAdd(L, nesw(B, MZ2.LAIR_PREV_W)[idx] as MazeId);
}

/** 출처: DRLGMAZE_ScanReplaceSpecialAct2SewersPresets */
function placeSewerStuff(L: MazeLevel): void {
  const B = MZ2.TOWN;
  const PREV = nesw(B, MZ2.SEWER_PREV_W), NEXT = nesw(B, MZ2.SEWER_NEXT_W), WAYPOINT = nesw(B, MZ2.SEWER_WAYPOINT_W);
  const RADAMENT = nesw(B, MZ2.SEWER_RADAMENT_W), CHEST = nesw(B, MZ2.SEWER_CHEST_W);
  const dir = (2 * (L.seed.roll() & 1)) | 1;
  let rand = L.seed.roll() & 3;
  const scan = (t: MazeId[]) => {
    rand = scanReplaceSpecialPreset(L, t[rand] as MazeId, rand);
  };
  switch (L.id) {
    case LV.SEWERSLEV1: {
      // 마을 두 입구: 북쪽 끝 → 서쪽 입구 방 (PREV_E, 뚜껑 문), 동쪽 끝 → 남북 입구 방 (PREV_NS, 선착장)
      const chain = (start: MazeRoom | null, d: number, endDir: number, endPrest: number) => {
        if (!start) throw new Error('ScanReplaceSpecialAct2SewersPresets: no room');
        const r2 = placeAdjacentPresetRoom(L, start, d, true);
        if (r2) { pickRoomPreset(L, start, true); pickRoomPreset(L, r2, true); }
        if (!r2) throw new Error('ScanReplaceSpecialAct2SewersPresets: room 2');
        const r3 = placeAdjacentPresetRoom(L, r2, d, true);
        if (r3) { pickRoomPreset(L, r2, true); pickRoomPreset(L, r3, true); }
        if (!r3) throw new Error('ScanReplaceSpecialAct2SewersPresets: room 3');
        const r4 = placeAdjacentPresetRoom(L, r3, endDir, false);
        if (r4) { pickRoomPreset(L, r3, true); setPickedFileAndPresetId(r4, endPrest, 0, false); }
        return r4;
      };
      chain(freeLocation(L, (r, b) => r.box.y < b.box.y, 1), 1, 0, MZ2.SEWER_PREV_E);
      const r4 = chain(freeLocation(L, (r, b) => r.box.x > b.box.x, 2), 2, dir, MZ2.SEWER_PREV_NS);
      if (r4) {
        const r5 = placeAdjacentPresetRoom(L, r4, dir, false);
        if (r5) pickRoomPreset(L, r5, true);
      }
      replaceOrAdd(L, NEXT[rand] as MazeId);
      return;
    }
    case LV.SEWERSLEV2:
      replaceOrAdd(L, PREV[rand] as MazeId);
      rand = (rand + 1) % 4;
      scan(WAYPOINT);
      scan(NEXT);
      return;
    case LV.SEWERSLEV3:
      scan(PREV);
      scan(RADAMENT);
      return;
    case LV.ANCIENTTUNNELS:
      scan(PREV);
      scan(CHEST);
      return;
    default:
      return;
  }
}

/** 출처: DRLGMAZE_RollAct_1_2_3_BasicPresets — Act 2 는 하수도(301)·무덤(413)만 테마 방(+15) */
function rollThemes(L: MazeLevel): void {
  const base = L.levelType === T.SEWER ? MZ2.TOWN : L.levelType === T.TOMB ? MZ2.RUINS_ELDER : 0;
  if (!base) return;
  const offsets = Array.from({ length: 15 }, (_, i) => i);
  let index = (L.seed.roll() >>> 0) % 15;
  for (let i = 0; i < 15; ++i) {
    const i2 = (L.seed.roll() >>> 0) % 15;
    const i1 = (L.seed.roll() >>> 0) % 15;
    const t1 = offsets[i1] as number, t2 = offsets[i2] as number;
    offsets[i2] = t1;
    offsets[i1] = t2;
  }
  let c1 = Math.max(2, Math.trunc(L.rooms.length / 5) + 1);
  let c2 = 2 * L.rooms.length;
  while (c1 && c2) {
    const id = (offsets[index] as number) + base;
    for (const r of L.rooms) {
      if (!r.hasMap && r.prest === id) {
        r.prest = id + 15;
        r.picked = -1;
        r.hasMap = true;
        --c1;
        break;
      }
    }
    --c2;
    index = (index + 1) % 15;
  }
}

/** 출처: DRLGMAZE_RollBasicPresets — Act 2 기준 Def (하수도 301, 무덤 413, 구더기 굴 481, 나머지는 자기 Def = 순환 없음) */
function rollBasicPresets(data: DrlgData, L: MazeLevel, origin: { x: number; y: number }): RoomBuild[] {
  const base = L.levelType === T.SEWER ? MZ2.TOWN : L.levelType === T.TOMB ? MZ2.RUINS_ELDER : L.levelType === T.LAIR ? MZ2.DURIELS_LAIR : -1;
  const builds: { preset: number; divisor: number; rand: number }[] = [];
  const out: RoomBuild[] = [];
  for (const r of [...L.rooms]) {
    const prest = data.lvlPrest(r.prest);
    const rolled = L.seed.pick(prest.files);
    let file = r.picked;
    if (file === -1) {
      file = rolled;
      const b0 = base === -1 ? prest.def : base;
      if (prest.def > b0 && prest.def < b0 + 16) {
        let b = builds.find((x) => x.preset === prest.def);
        if (!b) {
          b = { preset: prest.def, divisor: prest.files, rand: L.seed.pick(prest.files) };
          builds.unshift(b);
        }
        b.rand = b.divisor ? (b.rand + 1) % b.divisor : 0;
        file = b.rand;
      }
    }
    const path = prest.file[file];
    if (!path) throw new Error(`LvlPrest ${prest.def} (${prest.name}) has no file ${file}`);
    const w = prest.sizeX && prest.sizeY ? prest.sizeX : r.box.w;
    const h = prest.sizeX && prest.sizeY ? prest.sizeY : r.box.h;
    // 근사(원작 미확인): DRLGPRESET_AddPresetUnitToDrlgMap 의 유닛별 롤(바닥 함정 50%·581 번 75%·Act 2 상인 1/3·Tormentor 등)은
    //   방 시드로 방이 활성화될 때 하는 일이라 생략한다 (DS1 유닛은 모두 둔다 — 레벨 타일 배치에는 영향 없음)
    const rooms = buildPresetRooms(data.ds1(path), { def: prest.def, killEdge: prest.killEdge, populate: prest.populate, dt1Mask: prest.dt1Mask },
      r.box.x - origin.x, r.box.y - origin.y, w, h, L.seed, r.box.w <= 12 && r.box.h <= 12);
    out.unshift(...rooms.reverse());
  }
  return out;
}

/**
 * Act 2 미로 레벨 하나 생성.
 * 출처: DRLG_InitLevel → DRLGMAZE_GenerateLevel (Act 2 분기) → DRLG_UpdateRoomExCoordinates → RollAct_1_2_3_BasicPresets → RollBasicPresets
 */
export function generateAct2MazeLevel(data: DrlgData, world: Act1Placement & TombPick, id: number): MazeLayout {
  const placed = world.levels.get(id);
  if (!placed) throw new Error(`generateAct2MazeLevel: level ${id} not placed`);
  const rec = data.level(id);
  const L: MazeLevel = { id, levelType: rec.levelType, maze: data.lvlMaze(id), seed: levelSeed(world.startSeed, id), rooms: [], pos: { ...placed.box }, pick: pickAct2RoomPreset };
  const first = allocRoom(L);
  first.box.x = L.pos.x + Math.trunc((L.pos.w - first.box.w) / 2);
  first.box.y = L.pos.y + Math.trunc((L.pos.h - first.box.h) / 2);
  addRoomToLevel(L, first);

  switch (L.levelType) {
    case T.SEWER:
      initBasicMazeLayout(L, 2);
      buildBasicMaze(L, world);
      placeSewerStuff(L);
      break;
    case T.TOMB:
      if (id === LV.CLAWVIPERTEMPLELEV2) {
        // 출처: 발톱 독사 사원 2 = 오염된 태양 제단 방 하나
        first.prest = MZ2.TOMB_TAINTED_SUN_X;
        first.picked = -1;
        first.hasMap = true;
      } else {
        placeTombPrev(L);
        buildBasicMaze(L, world);
        placeTombStuff(L, world);
      }
      break;
    case T.LAIR:
      initBasicMazeLayout(L, 2);
      buildBasicMaze(L, world);
      placeLairStuff(L);
      break;
    case T.ARCANE: {
      placeArcaneSanctuary(L);
      const rand = L.seed.roll() & 3;
      scanReplaceSpecialPreset(L, nesw(MZ2.LAIR_TIGHT_SPOT_S, MZ2.ARCANE_SUMMONER_W)[rand] as MazeId, rand);
      break;
    }
    case T.HAREM:
    case T.BASEMENT:
      initBasicMazeLayout(L, 2);
      break;
    default:
      throw new Error(`MazeLevelGenerate() - Some really bad voodoo here! (level ${id}, type ${L.levelType})`);
  }
  updateRoomCoordinates(L);
  rollThemes(L);

  const bounds = roomBounds(L);
  const mazeRooms = L.rooms.map((r) => ({ box: { ...r.box }, prest: r.prest, picked: r.picked }));
  const built = rollBasicPresets(data, L, bounds);
  const box: Box = { x: bounds.x, y: bounds.y, w: bounds.w + 1, h: bounds.h + 1 };
  const A = new Assembler(data, box.w, box.h, placed.vis, placed.warp);
  for (const r of built) A.addRoom(r);
  for (const r of built) A.addRoomEdges(r);
  return { id, box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, mazeRooms, orthBoxes: [] };
}
