// Act 3 미로 레벨 (DrlgType 1): 거미 동굴·거미굴(LvlType Spider), 늪지 구덩이·꽃불 던전(Dungeon), 쿠라스트 하수도 1층(Sewer),
// 증오의 억류지 1·2층(Kurast). 방 붙이기·겹침 검사 등 공용 단계는 maze.ts 를 쓰고, Act 3 분기만 여기 둔다.
// 출처: D2MOO DrlgMaze.cpp DRLGMAZE_GenerateLevel (LVLTYPE_ACT3_SPIDER/KURAST/DUNGEON/SEWER 분기),
//       DRLGMAZE_PickRoomPreset (nHardcodedPresetsRemapping 의 거미 열, 거미 동굴 NE → Chest NE, 거미굴 NW → Chest NW),
//       DRLGMAZE_BuildBasicMaze, DRLGMAZE_PlaceAct3DungeonStuff, DRLGMAZE_PlaceAct3SewerStuff, DRLGMAZE_PlaceAct3MephistoStuff,
//       DRLGMAZE_RollAct_1_2_3_BasicPresets, DRLGMAZE_RollBasicPresets
import type { Act1Placement } from './act1-link';
import { levelSeed } from './act1-link';
import type { Box } from './grid';
import { Assembler } from './layout';
import {
  addRoomToLevel, addSpecialPreset, allocRoom, growRooms, initBasicMazeLayout, initRoomFixedPreset, pickRoomPreset, placeAdjacentPresetRoom,
  replaceRoomPreset, roomBounds, setPickedFileAndPresetId, updateRoomCoordinates, type MazeId, type MazeLayout, type MazeLevel, type MazeRoom,
} from './maze';
import { buildPresetRooms, type RoomBuild } from './rooms';
import { L3, LT3, P3 } from './outjung';
import type { DrlgData } from './types';

/** 방향 비트 (DRLGMAZE_PickRoomPreset: 방향 0 서 → 1, 1 북 → 8, 2 동 → 2, 3 남 → 4) */
const DIR_BITS = [1, 8, 2, 4];

/** 출처: DRLGMAZE_PickRoomPreset / RollAct_1_2_3_BasicPresets / RollBasicPresets — Act 3 LvlType 별 기준 Def (거미 동굴은 없음) */
export function act3MazeBase(levelType: number): number {
  switch (levelType) {
    case LT3.KURAST: return P3.TEMPLE_6;
    case LT3.DUNGEON: return P3.SPIDER_CHEST_NE;
    case LT3.SEWER: return P3.DUNGEON_TREASURE_2;
    default: return 0;
  }
}

/** 출처: DrlgMaze.cpp nHardcodedPresetsRemapping 의 세 번째 열 (거미 동굴: 대각선 모양만 있음) */
const SPIDER_REMAP: Record<number, number> = { 5: P3.SPIDER_SW, 6: P3.SPIDER_SE, 9: P3.SPIDER_NW, 10: P3.SPIDER_NE };

/** 출처: DRLGMAZE_PickRoomPreset (Act 3 분기) */
function pickAct3(L: MazeLevel, r: MazeRoom, reset: boolean): void {
  let bits = 0;
  for (const o of r.orths) bits |= DIR_BITS[o.dir] ?? 0;
  let prest: number;
  if (L.levelType === LT3.SPIDER) {
    prest = SPIDER_REMAP[bits] ?? 0;
    if (L.id === L3.SPIDERCAVE && prest === P3.SPIDER_NE) prest = P3.SPIDER_CHEST_NE;
    if (L.id === L3.SPIDERCAVERN && prest === P3.SPIDER_NW) prest = P3.SPIDER_CHEST_NW;
  } else {
    const base = act3MazeBase(L.levelType);
    if (!base) throw new Error(`sSetChamberPreset() - Some really bad voodoo here! (levelType ${L.levelType})`);
    prest = bits + base;
  }
  if (prest) setPickedFileAndPresetId(r, prest, -1, reset);
}

/** 특수 방 표 (원작 N, E, S, W 순서: { 모양 Def, 특수 Def, 파일 -1, 붙일 방향 }). 특수 Def 는 W, E, S, N 순서로 연속 */
function nesw(n: number, e: number, s: number, w: number, special: number): MazeId[] {
  return [[n, special + 3, -1, 3], [e, special + 1, -1, 0], [s, special + 2, -1, 1], [w, special, -1, 2]];
}
// 출처: DRLGMAZE_PlaceAct3DungeonStuff nAct3DungeonPrevIds / nAct3DungeonNextIds
const DUNGEON_PREV = nesw(P3.DUNGEON_N, P3.DUNGEON_E, P3.DUNGEON_S, P3.DUNGEON_W, P3.DUNGEON_PREV_W);
const DUNGEON_NEXT = nesw(P3.DUNGEON_N, P3.DUNGEON_E, P3.DUNGEON_S, P3.DUNGEON_W, P3.DUNGEON_NEXT_W);
// 출처: DRLGMAZE_PlaceAct3SewerStuff nAct3SewerDrainIds / nAct3SewerChestIds
const SEWER_DRAIN = nesw(P3.SEWER_N, P3.SEWER_E, P3.SEWER_S, P3.SEWER_W, P3.SEWER_DRAIN_W);
const SEWER_CHEST = nesw(P3.SEWER_N, P3.SEWER_E, P3.SEWER_S, P3.SEWER_W, P3.SEWER_CHEST_W);
// 출처: DRLGMAZE_PlaceAct3MephistoStuff nAct3MephistoPrevIds / WaypointIds / NextIds
const MEPH_PREV = nesw(P3.MEPHISTO_N, P3.MEPHISTO_E, P3.MEPHISTO_S, P3.MEPHISTO_W, P3.MEPHISTO_PREV_W);
const MEPH_WAYPOINT = nesw(P3.MEPHISTO_N, P3.MEPHISTO_E, P3.MEPHISTO_S, P3.MEPHISTO_W, P3.MEPHISTO_WAYPOINT_W);
const MEPH_NEXT = nesw(P3.MEPHISTO_N, P3.MEPHISTO_E, P3.MEPHISTO_S, P3.MEPHISTO_W, P3.MEPHISTO_NEXT_W);

/** 원작 공통 패턴 — 모양이 맞는 방을 특수 방으로, 없으면 아무 방 옆에 새 방(PlaceAdjacentPresetRoom)을 붙여 특수 방으로 */
function replaceOrAttach(L: MazeLevel, m: MazeId): void {
  const [id1, id2, file, dir] = m;
  for (const r of L.rooms) {
    if (!r.hasMap && r.prest === id1) {
      r.prest = id2;
      r.picked = file;
      r.hasMap = true;
      return;
    }
  }
  for (const i of [...L.rooms]) {
    if (i.hasMap) continue;
    const r = placeAdjacentPresetRoom(L, i, dir, false);
    if (r) {
      pickRoomPreset(L, i, true);
      setPickedFileAndPresetId(r, id2, file, false);
      return;
    }
  }
}

/** 출처: DRLGMAZE_PlaceAct3DungeonStuff / DRLGMAZE_PlaceAct3SewerStuff (같은 구조: 이전(또는 배수구) → 다음(또는 상자)) */
function placeTwo(L: MazeLevel, first: readonly MazeId[], second: readonly MazeId[]): void {
  const d = L.seed.roll() & 3;
  replaceOrAttach(L, first[d] as MazeId);
  replaceOrAttach(L, second[(d + 1) % 4] as MazeId);
}

/** 모양이 맞는 방을 특수 방으로 (SetPickedFileAndPresetId(…, FALSE)) — 찾으면 true */
function setIfShape(L: MazeLevel, m: MazeId): boolean {
  for (const r of L.rooms) {
    if (!r.hasMap && r.prest === m[0]) {
      setPickedFileAndPresetId(r, m[1], m[2], false);
      return true;
    }
  }
  return false;
}

/** 출처: DRLGMAZE_PlaceAct3MephistoStuff */
function placeMephistoStuff(L: MazeLevel): void {
  const rand = L.seed.roll() & 3;
  let m = MEPH_PREV[rand] as MazeId;
  if (!setIfShape(L, m)) {
    for (const i of [...L.rooms]) if (!i.hasMap && initRoomFixedPreset(L, i, m[3], m[1], m[2], true)) break;
  }
  let v9 = (rand + 1) % 4;
  if (L.id === L3.DURANCEOFHATELEV2) {
    m = MEPH_WAYPOINT[v9] as MazeId;
    if (!setIfShape(L, m)) addSpecialPreset(L, m[3], m[1], m[2]);
    const v14 = (v9 + 1) % 4;
    m = MEPH_NEXT[v14] as MazeId;
    if (!setIfShape(L, m)) addSpecialPreset(L, m[3], m[1], m[2]);
    v9 = (v14 + 1) % 4;
  }
  if (L.id === L3.DURANCEOFHATELEV1) {
    m = MEPH_NEXT[v9] as MazeId;
    if (!replaceRoomPreset(L, m[0], m[1], m[2], false)) addSpecialPreset(L, m[3], m[1], m[2]);
  }
}

/** 출처: DRLGMAZE_RollAct_1_2_3_BasicPresets — 방 수/5+1 (최소 2) 개를 같은 모양의 테마 방(+15)으로 (거미 동굴은 없음) */
function rollThemes(L: MazeLevel): void {
  const base = act3MazeBase(L.levelType);
  if (!base) return;
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

/** 출처: DRLGMAZE_RollBasicPresets — 방마다 파일 롤 → (기본 방 모양은 DrlgBuild 순환) → DRLGPRESET_BuildArea */
function rollBasicPresets(data: DrlgData, L: MazeLevel, origin: { x: number; y: number }): RoomBuild[] {
  const base = act3MazeBase(L.levelType);
  const builds: { preset: number; divisor: number; rand: number }[] = [];
  const out: RoomBuild[] = [];
  for (const r of [...L.rooms]) {
    const prest = data.lvlPrest(r.prest);
    const rolled = L.seed.pick(prest.files);
    let file = r.picked;
    if (file === -1) {
      file = rolled;
      // 원작: 기준이 없는 LvlType(거미 동굴)은 nLvlPrestId = Def 라 조건이 거짓 → 롤한 파일 그대로
      if (base && prest.def > base && prest.def < base + 16) {
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
    // 근사(원작 미확인): DRLGPRESET_AddPresetUnitToDrlgMap 의 유닛별 롤(바닥 함정·Act 3 몬스터 치환)은 생략 — 방 시드만 달라질 수 있다
    const rooms = buildPresetRooms(data.ds1(path), { def: prest.def, killEdge: prest.killEdge, populate: prest.populate, dt1Mask: prest.dt1Mask },
      r.box.x - origin.x, r.box.y - origin.y, w, h, L.seed, r.box.w <= 12 && r.box.h <= 12);
    out.unshift(...rooms.reverse());
  }
  return out;
}

/**
 * Act 3 미로 레벨 하나.
 * 출처: DRLG_InitLevel → DRLGMAZE_GenerateLevel (Act 3 분기) → DRLG_UpdateRoomExCoordinates → RollAct_1_2_3 → RollBasicPresets
 */
export function generateAct3MazeLevel(data: DrlgData, world: Act1Placement, id: number): MazeLayout {
  const placed = world.levels.get(id);
  if (!placed) throw new Error(`generateAct3MazeLevel: level ${id} not placed`);
  const rec = data.level(id);
  const L: MazeLevel = { id, levelType: rec.levelType, maze: data.lvlMaze(id), seed: levelSeed(world.startSeed, id), rooms: [], pos: { ...placed.box }, pick: pickAct3 };
  const first = allocRoom(L);
  first.box.x = L.pos.x + Math.trunc((L.pos.w - first.box.w) / 2);
  first.box.y = L.pos.y + Math.trunc((L.pos.h - first.box.h) / 2);
  addRoomToLevel(L, first);
  switch (L.levelType) {
    case LT3.SPIDER:
      initBasicMazeLayout(L, 2);
      break;
    case LT3.KURAST:
      initBasicMazeLayout(L, 2);
      growRooms(L);
      placeMephistoStuff(L);
      break;
    case LT3.DUNGEON:
      initBasicMazeLayout(L, 2);
      growRooms(L);
      placeTwo(L, DUNGEON_PREV, DUNGEON_NEXT);
      break;
    case LT3.SEWER:
      if (id === L3.SEWERSLEV1) {
        initBasicMazeLayout(L, 5);
        // 원작: 네 모서리 방을 이전 층(쿠라스트 시장·상부 쿠라스트) 계단 방으로 — 실패하면 경고만
        replaceRoomPreset(L, P3.SEWER_SW, P3.SEWER_PREV_SW, -1, false);
        replaceRoomPreset(L, P3.SEWER_SE, P3.SEWER_PREV_SE, -1, false);
        replaceRoomPreset(L, P3.SEWER_NW, P3.SEWER_PREV_NW, -1, false);
        replaceRoomPreset(L, P3.SEWER_NE, P3.SEWER_PREV_NE, -1, false);
      } else initBasicMazeLayout(L, 2);
      growRooms(L);
      placeTwo(L, SEWER_DRAIN, SEWER_CHEST);
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
