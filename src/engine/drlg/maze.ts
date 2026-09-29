// Act 1 미로 레벨 (DrlgType 1): 동굴·지하묘지(Crypt)·병영·감옥·카타콤.
// 방(LvlMaze SizeX×SizeY)을 무작위로 이어 붙이고, 이웃 방향 비트로 LvlPrest 방 프리셋을 고른 뒤,
// 특수 방(이전/다음 층 계단·보스·웨이포인트)을 바꿔 넣고, 방마다 DS1 을 골라 타일 방으로 만든다.
// 출처: D2MOO DrlgMaze.cpp DRLGMAZE_GenerateLevel (Act 1 분기), DRLGMAZE_PickRoomPreset, DRLGMAZE_AddAdjacentMazeRoom,
//       DRLGMAZE_InitBasicMazeLayout, DRLGMAZE_LinkMazeRooms, DRLGMAZE_MergeMazeRooms, DRLGMAZE_GetRandomRoomExFromLevel,
//       DRLGMAZE_PlaceAdjacentPresetRoom, DRLGMAZE_ScanReplaceSpecialPreset, DRLGMAZE_AddSpecialPreset,
//       DRLGMAZE_CheckIfMayPlaceAdjacentPresetRoom, DRLGMAZE_GetFreeLocationForRoom*, DRLGMAZE_InitRoomFixedPreset,
//       DRLGMAZE_PlaceAct1Barracks, DRLGMAZE_RollAct_1_2_3_BasicPresets, DRLGMAZE_RollBasicPresets
// 출처: D2MOO DrlgDrlgRoom.cpp DRLGROOM_AllocRoomEx, DRLGROOM_FreeRoomEx, DRLGROOM_AllocDrlgOrthsForRooms, DRLGROOM_AddOrth,
//       DRLGROOM_AddRoomExToLevel (머리에 삽입), DRLGMAZE_CheckRoomNotOverlaping, DRLG_GetRectanglesManhattanDistanceAndCheckNotOverlapping
// 출처: D2MOO DrlgDrlg.cpp DRLG_InitLevel (레벨 시드 = levelId + dwStartSeed), DRLG_UpdateRoomExCoordinates,
//       DRLG_GetMinAndMaxCoordinatesFromLevel
// 출처: D2MOO DrlgPreset.cpp DRLGPRESET_AllocDrlgMap (파일 롤), DRLGPRESET_BuildArea (bSingleRoom)
import { Rng } from '../rng';
import { type Act1Placement, directionFromCoords, levelSeed, notOverlapping } from './act1-link';
import type { Box } from './grid';
import { Assembler, type LevelLayout } from './layout';
import { allocRoomSeed, buildPresetRooms, type RoomBuild } from './rooms';
import { LEVEL, LVLTYPE, PREST, type DrlgData, type LvlMazeRec } from './types';

/** 방 가장자리 이웃 (원작 D2DrlgOrthStrc: 방 사이 = bInit 1, 레벨 사이 = bInit 0) */
interface MazeOrth { room: MazeRoom | null; levelId: number; dir: number; init: boolean; box: Box }

/** 미로 방 (원작 D2DrlgRoomStrc + D2DrlgPresetRoomStrc 중 미로 단계에서 쓰는 필드) */
export interface MazeRoom {
  box: Box;
  seed: Rng;
  orths: MazeOrth[];
  /** 원작 pMaze->nLevelPrest */
  prest: number;
  /** 원작 pMaze->nPickedFile (-1 = 무작위) */
  picked: number;
  /** 원작 DRLGPRESETROOMFLAG_HAS_MAP_DS1 (특수 방으로 고정됨) */
  hasMap: boolean;
}

interface MazeLevel {
  id: number;
  levelType: number;
  maze: LvlMazeRec;
  seed: Rng;
  /** 원작 pFirstRoomEx 목록 (0 = 머리) */
  rooms: MazeRoom[];
  pos: Box;
}

/** 원작 D2MazeLevelIdStrc { nLevelPrestId1, nLevelPrestId2, nPickedFile, nDirection } */
type MazeId = readonly [number, number, number, number];

/** 방향 비트 (DRLGMAZE_PickRoomPreset: 방향 0 서 → 1, 1 북 → 8, 2 동 → 2, 3 남 → 4) */
const BIT_W = 1, BIT_E = 2, BIT_S = 4, BIT_N = 8;

/** 이웃 방향 → 기준 Def 에 더할 값 (W/E/S/N 만 있는 특수 방 표: 원작 N, E, S, W 순서) */
function nesw(base: number, special: number): MazeId[] {
  // 특수 방 Def 는 W, E, S, N 순서로 연속 (LvlPrest.txt)
  return [
    [base + BIT_N, special + 3, -1, 3],
    [base + BIT_E, special + 1, -1, 0],
    [base + BIT_S, special + 2, -1, 1],
    [base + BIT_W, special + 0, -1, 2],
  ];
}

// 출처: DrlgMaze.cpp DRLGMAZE_GenerateLevel 정적 표 (nAct1Cave*Ids, nAct1Crypt*Ids, nAct1Jail*Ids, nAct1Catacombs*Ids)
//       / DRLGMAZE_PlaceAct1Barracks (nAct1BarracksNextIds, nAct1BarracksForgeIds)
const CAVE = PREST.DOE_ENTRANCE, CRYPT = PREST.GRAVEYARD, BARRACKS = PREST.BARRACKS_COURT_CONNECT, JAIL = PREST.BARRACKS_FORGE_N, CATA = PREST.CATHEDRAL;
const CAVE_PREV = nesw(CAVE, PREST.CAVE_PREV_W), CAVE_DOE = nesw(CAVE, PREST.CAVE_DEN_OF_EVIL_W), CAVE_DOWN = nesw(CAVE, PREST.CAVE_DOWN_W);
const CAVE_COLDCROW = nesw(CAVE, PREST.CAVE_COLDCROW_W), CAVE_NEXT = nesw(CAVE, PREST.CAVE_NEXT_W);
const CRYPT_PREV = nesw(CRYPT, PREST.CRYPT_PREV_W), CRYPT_SPECIAL = [...nesw(CRYPT, PREST.CRYPT_BONEBREAK_W), ...nesw(CRYPT, PREST.CRYPT_PORTAL_W)];
const CRYPT_CHEST = nesw(CRYPT, PREST.CRYPT_CHEST_W), CRYPT_NEXT = nesw(CRYPT, PREST.CRYPT_NEXT_W);
const JAIL_PREV = nesw(JAIL, PREST.JAIL_PREV_W), JAIL_CATH = nesw(JAIL, PREST.JAIL_CATH_W), JAIL_NEXT = nesw(JAIL, PREST.JAIL_NEXT_W);
const JAIL_WAYPOINT = nesw(JAIL, PREST.JAIL_WAYPOINT_W), JAIL_PITSPAWN = nesw(JAIL, PREST.JAIL_PITSPAWN_W);
const CATA_NEXT = nesw(CATA, PREST.CATACOMBS_NEXT_W), CATA_WAYPOINT = nesw(CATA, PREST.CATACOMBS_WAYPOINT_W);
const BARRACKS_NEXT = nesw(BARRACKS, PREST.BARRACKS_NEXT_W), BARRACKS_FORGE = nesw(BARRACKS, PREST.BARRACKS_FORGE_W);

/** 레벨 종류별 기준 Def (출처: DRLGMAZE_PickRoomPreset / DRLGMAZE_RollAct_1_2_3_BasicPresets / DRLGMAZE_RollBasicPresets) */
export function mazeBasePreset(levelType: number): number {
  switch (levelType) {
    case LVLTYPE.ACT1_CAVE: return CAVE;
    case LVLTYPE.ACT1_CRYPT: return CRYPT;
    case LVLTYPE.ACT1_BARRACKS: return BARRACKS;
    case LVLTYPE.ACT1_JAIL: return JAIL;
    case LVLTYPE.ACT1_CATACOMBS: return CATA;
    default: throw new Error(`sSetChamberPreset() - Some really bad voodoo here! (levelType ${levelType})`);
  }
}

// ---- 방 할당·목록 ----

/** 출처: DRLGROOM_AllocRoomEx (레벨 시드 1 회 → 방 시드) + DRLGMAZE_SetRoomSize */
function allocRoom(L: MazeLevel): MazeRoom {
  const { seed } = allocRoomSeed(L.seed);
  return { box: { x: 0, y: 0, w: L.maze.sizeX, h: L.maze.sizeY }, seed, orths: [], prest: 0, picked: 0, hasMap: false };
}

/** 출처: DRLGROOM_AddRoomExToLevel — 목록 머리에 삽입 */
function addRoomToLevel(L: MazeLevel, r: MazeRoom): void {
  L.rooms.unshift(r);
}

/** 출처: DRLGROOM_FreeRoomEx — 방 사이 이웃(bInit) 을 양쪽에서 지우고 목록에서 뺀다 */
function freeRoom(L: MazeLevel, r: MazeRoom): void {
  for (const o of r.orths) {
    if (!o.init || !o.room) continue;
    const other = o.room.orths;
    const k = other.findIndex((b) => b.init && b.room === r);
    if (k >= 0) other.splice(k, 1);
  }
  r.orths = [];
  const i = L.rooms.indexOf(r);
  if (i >= 0) L.rooms.splice(i, 1);
}

/** 출처: DRLGROOM_AllocDrlgOrthsForRooms — 양쪽에 없으면 머리에 추가 (반대 방향 = (dir − 2) & 3) */
function allocOrths(r1: MazeRoom, r2: MazeRoom, dir: number): void {
  if (!r1.orths.some((o) => o.room === r2)) r1.orths.unshift({ room: r2, levelId: 0, dir, init: true, box: r2.box });
  if (!r2.orths.some((o) => o.room === r1)) r2.orths.unshift({ room: r1, levelId: 0, dir: (dir - 2) & 3, init: true, box: r1.box });
}

/** 출처: DRLGMAZE_CheckRoomNotOverlaping */
function roomNotOverlapping(L: MazeLevel, r: MazeRoom, ignored: MazeRoom | null, margin: number): boolean {
  for (const c of L.rooms) if (c !== r && c !== ignored && !notOverlapping(r.box, c.box, margin)) return false;
  return true;
}

/** 원작 방향별 이웃 위치 (DRLGMAZE_LinkMazeRooms / AddAdjacentMazeRoom / PlaceAdjacentPresetRoom 의 switch) */
function placeNextTo(r: MazeRoom, parent: MazeRoom, dir: number): void {
  const p = parent.box;
  const dx = [-1, 0, 1, 0, -1, 1, 1, -1][dir], dy = [0, -1, 0, 1, -1, -1, 1, 1][dir];
  if (dx === undefined || dy === undefined) return;
  r.box.x = p.x + dx * p.w;
  r.box.y = p.y + dy * p.h;
}

const overlapsOrth = (r: MazeRoom, orths: MazeOrth[]): boolean => orths.some((o) => !notOverlapping(r.box, o.box, 0));

// ---- 방 프리셋 ----

/** 출처: DRLGMAZE_SetPickedFileAndPresetId */
function setPickedFileAndPresetId(r: MazeRoom, prest: number, file: number, reset: boolean): void {
  r.picked = file;
  r.prest = prest;
  r.hasMap = !reset;
}

/** 출처: DRLGMAZE_PickRoomPreset (sSetChamberPreset) — 이웃 방향 비트 + 레벨 종류 기준 Def */
function pickRoomPreset(L: MazeLevel, r: MazeRoom, reset: boolean): void {
  let bits = 0;
  for (const o of r.orths) bits |= [BIT_W, BIT_N, BIT_E, BIT_S][o.dir] ?? 0;
  const prest = bits + mazeBasePreset(L.levelType);
  if (prest) setPickedFileAndPresetId(r, prest, -1, reset);
}

/** 출처: DRLGMAZE_ReplaceRoomPreset */
function replaceRoomPreset(L: MazeLevel, id1: number, id2: number, file: number, reset: boolean): MazeRoom | null {
  for (const r of L.rooms) {
    if (!r.hasMap && r.prest === id1) {
      setPickedFileAndPresetId(r, id2, file, reset);
      return r;
    }
  }
  return null;
}

// ---- 방 붙이기 ----

/** 출처: DRLG_GetRectanglesManhattanDistanceAndCheckNotOverlapping(…, 1) 이 거짓이고 nX ≠ nY (변이 맞닿음) */
function touchesSide(a: Box, b: Box): boolean {
  const dx = a.x >= b.x ? a.x - b.w - b.x : b.x - a.w - a.x;
  const dy = a.y >= b.y ? a.y - b.h - b.y : b.y - a.h - a.y;
  return !(dx >= 1 || dy >= 1) && dx !== dy;
}

/** 출처: DRLGMAZE_MergeMazeRooms (새 방은 아직 목록에 없음) + AddAdjacentMazeRoom 의 같은 루프 */
function mergeInto(L: MazeLevel, r: MazeRoom): void {
  for (const i of L.rooms) {
    if (i === r || i.hasMap) continue;
    if (!touchesSide(r.box, i.box)) continue;
    if (r.orths.some((o) => o.room === i)) continue;
    if (i.seed.roll() % 1000 < L.maze.merge) {
      const dir = directionFromCoords(i.box, r.box);
      if (dir !== -1) {
        allocOrths(i, r, dir);
        pickRoomPreset(L, i, true);
      }
    }
  }
}

/** 출처: DRLGMAZE_MergeMazeRooms */
function mergeMazeRooms(L: MazeLevel, r: MazeRoom): void {
  if (!r.hasMap) mergeInto(L, r);
}

/** 출처: DRLGMAZE_AddAdjacentMazeRoom */
function addAdjacentMazeRoom(L: MazeLevel, parent: MazeRoom, dir: number, merge: boolean): MazeRoom | null {
  const r = allocRoom(L);
  placeNextTo(r, parent, dir);
  if (overlapsOrth(r, parent.orths) || !roomNotOverlapping(L, r, parent, 0)) {
    freeRoom(L, r);
    return null;
  }
  allocOrths(parent, r, dir);
  if (merge && !parent.hasMap) mergeInto(L, r);
  addRoomToLevel(L, r);
  if (merge) pickRoomPreset(L, parent, true);
  pickRoomPreset(L, r, true);
  return r;
}

/** 출처: DRLGMAZE_LinkMazeRooms */
function linkMazeRooms(L: MazeLevel, r1: MazeRoom, r2: MazeRoom, dir: number): boolean {
  placeNextTo(r1, r2, dir);
  if (overlapsOrth(r1, r2.orths)) return false;
  return roomNotOverlapping(L, r1, r2, 0);
}

/** 출처: DRLGMAZE_InitBasicMazeLayout — 첫 방에서 북·서·남·동으로 이어 고리 */
function initBasicMazeLayout(L: MazeLevel, n: number): void {
  const first = L.rooms[0] as MazeRoom;
  let cur: MazeRoom | null = first;
  const run = (count: number, dir: number) => {
    for (let i = count; i > 0; --i) {
      if (!cur) throw new Error('InitBasicMazeLayout: link failed');
      let nr: MazeRoom | null = allocRoom(L);
      if (linkMazeRooms(L, nr, cur, dir)) {
        allocOrths(cur, nr, dir);
        mergeMazeRooms(L, nr);
        addRoomToLevel(L, nr);
        pickRoomPreset(L, cur, true);
        pickRoomPreset(L, nr, true);
      } else {
        freeRoom(L, nr);
        nr = null;
      }
      cur = nr;
    }
  };
  run(n - 1, 1);
  run(n - 1, 0);
  run(n - 1, 3);
  run(n - 2, 2);
  if (!cur) throw new Error('InitBasicMazeLayout: link failed');
  allocOrths(cur, first, 2);
  pickRoomPreset(L, cur, true);
  pickRoomPreset(L, first, true);
}

/** 출처: DRLGMAZE_GetRandomRoomExFromLevel */
function randomRoom(L: MazeLevel): MazeRoom {
  return L.rooms[L.seed.pick(L.rooms.length)] as MazeRoom;
}

/** 출처: DRLGMAZE_GenerateLevel 의 공통 루프 — 방 수가 LvlMaze Rooms 가 될 때까지 무작위 방 옆에 붙인다 */
function growRooms(L: MazeLevel): void {
  // 원작: nStaffTombLevel/nBossTombLevel 배수는 Act 2 전용 (Act 1 은 0)
  const n = L.maze.rooms;
  let guard = 0;
  while (L.rooms.length < n) {
    if (++guard > 100000) throw new Error(`maze ${L.id}: room growth did not converge`);
    const r = randomRoom(L);
    const dir = r.seed.roll() & 3;
    if (!r.hasMap) addAdjacentMazeRoom(L, r, dir, true);
  }
}

/** 출처: DRLGMAZE_PlaceAdjacentPresetRoom */
function placeAdjacentPresetRoom(L: MazeLevel, parent: MazeRoom, dir: number, merge: boolean): MazeRoom | null {
  const r = allocRoom(L);
  placeNextTo(r, parent, dir);
  // 출처: DRLGMAZE_CheckIfRoomOverlapsAythingOtherThanParent
  if (overlapsOrth(r, parent.orths) || !roomNotOverlapping(L, r, parent, 0)) {
    freeRoom(L, r);
    return null;
  }
  allocOrths(parent, r, dir);
  if (merge) mergeMazeRooms(L, r);
  addRoomToLevel(L, r);
  return r;
}

/** 출처: DRLGMAZE_ScanReplaceSpecialPreset — 해당 모양 방이 있으면 바꾸고, 없으면 새 방을 붙여 특수 방으로. 반환 = 갱신된 nRand */
function scanReplaceSpecialPreset(L: MazeLevel, m: MazeId, rand: number): number {
  const [id1, id2, file, dir] = m;
  for (const r of L.rooms) {
    if (!r.hasMap && r.prest === id1) {
      r.prest = id2;
      r.picked = file;
      r.hasMap = true;
      return (rand + 1) % 4;
    }
  }
  for (const i of [...L.rooms]) {
    if (i.hasMap) continue;
    const r = allocRoom(L);
    if (!linkMazeRooms(L, r, i, dir)) {
      freeRoom(L, r);
    } else {
      allocOrths(i, r, dir);
      addRoomToLevel(L, r);
      pickRoomPreset(L, i, true);
      r.prest = id2;
      r.picked = file;
      r.hasMap = true;
      break;
    }
  }
  return (rand + 1) % 4;
}

/** 출처: DRLGMAZE_InitRoomFixedPreset */
function initRoomFixedPreset(L: MazeLevel, parent: MazeRoom, dir: number, prest: number, file: number, useInitPreset: boolean): MazeRoom | null {
  const r = allocRoom(L);
  if (linkMazeRooms(L, r, parent, dir)) {
    allocOrths(parent, r, dir);
    addRoomToLevel(L, r);
    if (useInitPreset) pickRoomPreset(L, parent, true);
    r.prest = prest;
    r.picked = file;
    r.hasMap = true;
    return r;
  }
  freeRoom(L, r);
  return null;
}

/** 출처: DRLGMAZE_AddSpecialPreset */
function addSpecialPreset(L: MazeLevel, dir: number, prest: number, file: number): void {
  for (const r of [...L.rooms]) {
    if (!r.hasMap && initRoomFixedPreset(L, r, dir, prest, file, true)) break;
  }
}

/** 출처: DRLGMAZE_CheckIfMayPlaceAdjacentPresetRoom — 임시 방을 붙여 보고 곧 해제 (시드는 소비됨) */
function mayPlaceAdjacent(L: MazeLevel, r: MazeRoom, dir: number): boolean {
  if (r.hasMap) return false;
  if (r.orths.some((o) => o.dir === dir)) return false;
  const nr = placeAdjacentPresetRoom(L, r, dir, false);
  if (nr) {
    pickRoomPreset(L, nr, true);
    freeRoom(L, nr);
  }
  return nr !== null;
}

/** 출처: DRLGMAZE_GetFreeLocationForRoomEast/West/North/South — 가장 바깥 방 중 해당 방향에 붙일 수 있는 것 */
function freeLocation(L: MazeLevel, better: (r: MazeRoom, best: MazeRoom) => boolean, dir: number): MazeRoom | null {
  let best: MazeRoom | null = null;
  for (const r of [...L.rooms]) {
    if ((!best || better(r, best)) && mayPlaceAdjacent(L, r, dir)) best = r;
  }
  return best;
}

/** 출처: DRLG_GetMinAndMaxCoordinatesFromLevel */
function roomBounds(L: MazeLevel): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of L.rooms) {
    minX = Math.min(minX, r.box.x);
    minY = Math.min(minY, r.box.y);
    maxX = Math.max(maxX, r.box.x + r.box.w);
    maxY = Math.max(maxY, r.box.y + r.box.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 출처: DRLGMAZE_PlaceAct1Barracks — Outer Cloister 프리셋 파일(0 W, 1 N, 2 E)에 맞춰 연결 방(Court Connect)을 붙이고,
 * 다음 층 계단(Next)·대장간(Forge) 방을 놓은 뒤 병영 전체를 바깥 회랑 옆으로 옮긴다.
 */
function placeAct1Barracks(L: MazeLevel, world: Act1Placement): void {
  const cloister = world.levels.get(LEVEL.OUTERCLOISTER);
  if (!cloister) throw new Error('PlaceAct1Barracks: Outer Cloister not placed');
  const dir = cloister.presetDirection;
  const getters = [
    () => freeLocation(L, (r, b) => r.box.x > b.box.x, 2), // DRLGMAZE_GetFreeLocationForRoomWest (동쪽에 붙일 수 있는 가장 동쪽 방)
    () => freeLocation(L, (r, b) => r.box.y > b.box.y, 3), // DRLGMAZE_GetFreeLocationForRoomNorth
    () => freeLocation(L, (r, b) => r.box.x < b.box.x, 0), // DRLGMAZE_GetFreeLocationForRoomEast
  ];
  const entry = getters[dir]?.();
  if (!entry) throw new Error(`PlaceAct1Barracks: no entry room (direction ${dir})`);
  let nX = cloister.box.x, nY = cloister.box.y;
  let court: MazeRoom | null = null;
  const c = cloister.box;
  if (dir === 0 || dir === 1) {
    const d = dir === 0 ? 2 : 3;
    court = allocRoom(L);
    if (linkMazeRooms(L, court, entry, d)) {
      allocOrths(entry, court, d);
      addRoomToLevel(L, court);
      pickRoomPreset(L, entry, true);
      setPickedFileAndPresetId(court, PREST.BARRACKS_COURT_CONNECT, dir, false);
    } else {
      freeRoom(L, court);
      court = null;
    }
    if (!court) throw new Error('PlaceAct1Barracks: court connect room failed');
    // 출처: DRLGROOM_AddOrth(&pBarracksRoomEx->pDrlgOrth, pOuterCloisterLevel, 2 또는 3, FALSE)
    court.orths.push({ room: null, levelId: LEVEL.OUTERCLOISTER, dir: d, init: false, box: c });
    if (dir === 0) {
      nX -= L.maze.sizeX + court.box.x;
      nY += Math.trunc(c.h / 2) - court.box.y;
    } else {
      nX += Math.trunc(c.w / 2) - court.box.x - 6;
      nY -= L.maze.sizeY + court.box.y;
    }
  } else if (dir === 2) {
    court = placeAdjacentPresetRoom(L, entry, 0, false);
    if (!court) throw new Error('PlaceAct1Barracks: court connect room failed');
    pickRoomPreset(L, entry, true);
    setPickedFileAndPresetId(court, PREST.BARRACKS_COURT_CONNECT, 2, false);
    court.orths.push({ room: null, levelId: LEVEL.OUTERCLOISTER, dir: 0, init: false, box: c });
    nX += c.w - court.box.x;
    nY += Math.trunc(c.h / 2) - court.box.y + 1;
  }

  if (L.seed.roll() & 1) {
    let m = BARRACKS_NEXT[dir] as MazeId;
    if (!replaceRoomPreset(L, m[0], m[1], m[2], false)) {
      for (const i of [...L.rooms]) if (!i.hasMap && initRoomFixedPreset(L, i, m[3], m[1], m[2], true)) break;
    }
    m = BARRACKS_FORGE[(dir + 1) % 4] as MazeId;
    if (!replaceRoomPreset(L, m[0], m[1], m[2], false)) addSpecialPreset(L, m[3], m[1], m[2]);
  } else {
    const m = BARRACKS_FORGE[dir] as MazeId;
    if (!replaceRoomPreset(L, m[0], m[1], m[2], false)) addSpecialPreset(L, m[3], m[1], m[2]);
    const r = (dir + 1) % 4;
    scanReplaceSpecialPreset(L, BARRACKS_NEXT[r] as MazeId, r);
  }
  for (const r of L.rooms) {
    r.box.x += nX;
    r.box.y += nY;
  }
  L.pos = roomBounds(L);
}

/** 출처: DRLG_UpdateRoomExCoordinates — 최소 좌표를 레벨 위치에 맞춘다 */
function updateRoomCoordinates(L: MazeLevel): void {
  const b = roomBounds(L);
  for (const r of L.rooms) {
    r.box.x += L.pos.x - b.x;
    r.box.y += L.pos.y - b.y;
  }
}

/** 출처: DRLGMAZE_RollAct_1_2_3_BasicPresets — 방 수/5+1 (최소 2) 개를 같은 모양의 테마 방(+15)으로 */
function rollThemes(L: MazeLevel): void {
  if (L.id === LEVEL.DENOFEVIL) return;
  const base = mazeBasePreset(L.levelType);
  const offsets = Array.from({ length: 15 }, (_, i) => i);
  let index = L.seed.roll() % 15;
  for (let i = 0; i < 15; ++i) {
    const i2 = L.seed.roll() % 15;
    const i1 = L.seed.roll() % 15;
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

/**
 * 출처: DRLGMAZE_RollBasicPresets — 방마다 DRLGPRESET_AllocDrlgMap(파일 롤) → 파일 선택(기본 방 모양은 DrlgBuild 순환)
 * → DRLGPRESET_BuildArea(bSingleRoom = 12×12 이하). 반환 방은 레벨 로컬 타일 좌표.
 */
function rollBasicPresets(data: DrlgData, L: MazeLevel, origin: { x: number; y: number }): RoomBuild[] {
  const base = mazeBasePreset(L.levelType);
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
    // 근사(원작 미확인): DRLGPRESET_AddPresetUnitToDrlgMap 의 유닛별 롤(바닥 함정·581 번 오브젝트·Act 2~5 몬스터)은
    //   Act 1 미로 방 프리셋에 해당 유닛이 없어 생략 (Scan 프리셋 오브젝트 목록으로 확인)
    const rooms = buildPresetRooms(data.ds1(path), { def: prest.def, killEdge: prest.killEdge, populate: prest.populate, dt1Mask: prest.dt1Mask },
      r.box.x - origin.x, r.box.y - origin.y, w, h, L.seed, r.box.w <= 12 && r.box.h <= 12);
    // 원작: 새 방은 레벨 목록 머리에 삽입
    out.unshift(...rooms.reverse());
  }
  return out;
}

export interface MazeLayout extends LevelLayout {
  /** 미로 방 (월드 타일 좌표, 원작 목록 순서) — 테스트·디버그용 */
  mazeRooms: { box: Box; prest: number; picked: number }[];
  /** 다른 레벨과 맞닿은 방 (Barracks 의 Court Connect ↔ Outer Cloister). 월드 타일 좌표 */
  orthBoxes: { levelId: number; box: Box }[];
}

/**
 * 미로 레벨 하나 생성.
 * 출처: DRLG_InitLevel → DRLGMAZE_GenerateLevel (Act 1 분기)
 */
export function generateMazeLevel(data: DrlgData, world: Act1Placement, id: number): MazeLayout {
  const placed = world.levels.get(id);
  if (!placed) throw new Error(`generateMazeLevel: level ${id} not placed`);
  const rec = data.level(id);
  const L: MazeLevel = { id, levelType: rec.levelType, maze: data.lvlMaze(id), seed: levelSeed(world.startSeed, id), rooms: [], pos: { ...placed.box } };
  const first = allocRoom(L);
  first.box.x = L.pos.x + Math.trunc((L.pos.w - first.box.w) / 2);
  first.box.y = L.pos.y + Math.trunc((L.pos.h - first.box.h) / 2);
  addRoomToLevel(L, first);

  let rand = 0;
  const scan = (table: readonly MazeId[]) => {
    rand = scanReplaceSpecialPreset(L, table[rand] as MazeId, rand);
  };
  switch (L.levelType) {
    case LVLTYPE.ACT1_CAVE:
      growRooms(L);
      rand = L.seed.roll() & 3;
      scan(CAVE_PREV);
      scan(id === LEVEL.DENOFEVIL ? CAVE_DOE : CAVE_DOWN);
      if (id === LEVEL.CAVELEV1) scan(CAVE_COLDCROW);
      if (id === LEVEL.UNDERGROUNDPASSAGELEV1) scan(CAVE_NEXT);
      break;
    case LVLTYPE.ACT1_CRYPT:
      growRooms(L);
      rand = L.seed.roll() & 3;
      scan(CRYPT_PREV);
      if (id === LEVEL.CRYPT) scan(CRYPT_SPECIAL);
      if (id === LEVEL.MAUSOLEUM) scan(CRYPT_CHEST);
      if (id >= LEVEL.TOWERCELLARLEV1 && id <= LEVEL.TOWERCELLARLEV4) scan(CRYPT_NEXT);
      break;
    case LVLTYPE.ACT1_BARRACKS:
      initBasicMazeLayout(L, 2);
      growRooms(L);
      break;
    case LVLTYPE.ACT1_JAIL:
      initBasicMazeLayout(L, 2);
      growRooms(L);
      rand = L.seed.roll() & 3;
      scan(JAIL_PREV);
      if (id === LEVEL.JAILLEV1) scan(JAIL_WAYPOINT);
      if (id === LEVEL.JAILLEV2) scan(JAIL_PITSPAWN);
      scan(id === LEVEL.JAILLEV3 ? JAIL_CATH : JAIL_NEXT);
      break;
    case LVLTYPE.ACT1_CATACOMBS:
      if (id === LEVEL.CATACOMBSLEV1) {
        for (const d of [1, 2, 3, 0]) addAdjacentMazeRoom(L, first, d, true);
        setPickedFileAndPresetId(first, PREST.CATACOMBS_PREV_NSEW, -1, false);
      } else if (L.seed.roll() & 1) {
        addAdjacentMazeRoom(L, first, 0, true);
        addAdjacentMazeRoom(L, first, 2, true);
        setPickedFileAndPresetId(first, PREST.CATACOMBS_PREV_EW, -1, false);
      } else {
        addAdjacentMazeRoom(L, first, 1, true);
        addAdjacentMazeRoom(L, first, 3, true);
        setPickedFileAndPresetId(first, PREST.CATACOMBS_PREV_NS, -1, false);
      }
      growRooms(L);
      rand = L.seed.roll() & 3;
      scan(CATA_NEXT);
      if (id === LEVEL.CATACOMBSLEV2) scan(CATA_WAYPOINT);
      break;
    default:
      throw new Error(`MazeLevelGenerate() - Some really bad voodoo here! (level ${id}, type ${L.levelType})`);
  }
  if (id === LEVEL.BARRACKS) placeAct1Barracks(L, world);
  else updateRoomCoordinates(L);
  rollThemes(L);

  const bounds = roomBounds(L);
  const mazeRooms = L.rooms.map((r) => ({ box: { ...r.box }, prest: r.prest, picked: r.picked }));
  const orthBoxes = L.rooms.flatMap((r) => r.orths.filter((o) => !o.init).map((o) => ({ levelId: o.levelId, box: { ...r.box } })));
  const built = rollBasicPresets(data, L, bounds);
  // 레벨 크기 = 방 경계 + 1 (마지막 행·열 방의 가장자리 겹침 칸까지 담는다)
  const box: Box = { x: bounds.x, y: bounds.y, w: bounds.w + 1, h: bounds.h + 1 };
  const A = new Assembler(data, box.w, box.h, placed.vis, placed.warp);
  for (const r of built) A.addRoom(r);
  for (const r of built) A.addRoomEdges(r);
  return { id, box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, mazeRooms, orthBoxes };
}
