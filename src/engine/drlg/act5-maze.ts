// 확장팩 Act 5 미로 레벨 (DrlgType 1): 얼음 동굴(Crystalline Passage · Frozen River · Glacial Trail · Drifter Cavern · Ancients' Way · Icy Cellar),
// Nihlathak 신전(Halls of Anguish · Halls of Pain), 월드스톤 킵 1~3, 지옥 구덩이(Abaddon · Pit of Acheron · Infernal Pit).
// 방 붙이기·겹침 검사 등 공용 단계는 maze.ts 를 쓰고, Act 5 분기만 여기 둔다.
// 출처: D2MOO DrlgMaze.cpp DRLGMAZE_GenerateLevel (LVLTYPE_ACT5_ICE_CAVES / TEMPLE / BAAL / LAVA 분기),
//       sSetChamberPreset (얼음 동굴: 방이 하나가 아니면 BARRICADE_16_SNOW 기준, 신전·용암: nExpansionHardcodedPresetsRemapping, 월드스톤: LAVA_NS 기준),
//       DRLGMAZE_PlaceAct5IceStuff, DRLGMAZE_PlaceAct5TempleStuff, DRLGMAZE_PlaceAct2TombPrev_Act5BaalPrev, DRLGMAZE_PlaceAct5BaalStuff,
//       DRLGMAZE_PlaceAct5LavaPresets (PlaceLavaPreset, dword_6FDCE850), DRLGMAZE_FillBlankMazeSpaces (LVLPREST_ACT4_LAVA_X),
//       DRLGMAZE_RollBasicPresets (얼음 BARRICADE_16_SNOW, 월드스톤 LAVA_NS, 용암 TEMPLE_SW_WAYPOINT 기준; 신전은 기준 없음)
import { type Act1Placement, levelSeed } from './act1-link';
import { placeTombPrev } from './act2-maze';
import { PREST4, fillBlankMazeSpaces } from './act4';
import { LEVEL5, LVLTYPE5, PREST5 as P } from './act5-ids';
import type { Box } from './grid';
import { Assembler } from './layout';
import {
  addRoomToLevel, addSpecialPreset, allocOrths, allocRoom, freeRoom, growRooms, initBasicMazeLayout, initRoomFixedPreset, linkMazeRooms,
  pickRoomPreset, replaceRoomPreset, roomBounds, setPickedFileAndPresetId, updateRoomCoordinates,
  type MazeId, type MazeLayout, type MazeLevel, type MazeRoom,
} from './maze';
import { buildPresetRooms, type RoomBuild } from './rooms';
import type { DrlgData } from './types';

/** 방향 비트 (방향 0 서 → 1, 1 북 → 8, 2 동 → 2, 3 남 → 4) */
const DIR_BITS = [1, 8, 2, 4];

/** 출처: nExpansionHardcodedPresetsRemapping — 이웃 비트 → [신전, 용암] (없는 모양은 0) */
const REMAP: Readonly<Record<number, readonly [number, number]>> = {
  1: [0, P.LAVA_W], 2: [0, P.LAVA_E], 3: [0, P.LAVA_EW], 4: [0, P.LAVA_S], 5: [P.TEMPLE_SW, 0], 6: [P.TEMPLE_SE_UP, 0],
  8: [0, P.LAVA_N], 9: [P.TEMPLE_NW, 0], 10: [P.TEMPLE_NE, 0], 12: [0, P.LAVA_NS],
};

/** 출처: sSetChamberPreset (Act 5 분기) */
function pickAct5(L: MazeLevel, r: MazeRoom, reset: boolean): void {
  let bits = 0;
  for (const o of r.orths) bits |= DIR_BITS[o.dir] ?? 0;
  let prest = bits;
  switch (L.levelType) {
    case LVLTYPE5.ICE_CAVES:
      if (L.maze.rooms !== 1) prest += P.BARRICADE_16_SNOW;
      break;
    case LVLTYPE5.TEMPLE:
      prest = REMAP[bits]?.[0] ?? 0;
      break;
    case LVLTYPE5.BAAL:
      prest += P.LAVA_NS;
      break;
    case LVLTYPE5.LAVA:
      prest = REMAP[bits]?.[1] ?? 0;
      break;
    default:
      throw new Error(`sSetChamberPreset() - Some really bad voodoo here! (levelType ${L.levelType})`);
  }
  if (prest) setPickedFileAndPresetId(r, prest, -1, reset);
}

/** 특수 방 표 (원작 N, E, S, W 순서: { 모양 Def, 특수 Def, 파일 -1, 붙일 방향 }) */
function nesw(n: number, e: number, s: number, w: number): MazeId[] {
  return [[P.ICE_N, n, -1, 3], [P.ICE_E, e, -1, 0], [P.ICE_S, s, -1, 1], [P.ICE_W, w, -1, 2]];
}
// 출처: nAct5IcePrevIds / NextIds / DownIds / ThemeIds (특수 Def 는 W, E, S, N 순서) / WaypointIds (N, S, E, W 순서)
const ICE_PREV = nesw(P.ICE_PREV_W + 3, P.ICE_PREV_W + 1, P.ICE_PREV_W + 2, P.ICE_PREV_W);
const ICE_NEXT = nesw(P.ICE_NEXT_W + 3, P.ICE_NEXT_W + 1, P.ICE_NEXT_W + 2, P.ICE_NEXT_W);
const ICE_DOWN = nesw(P.ICE_DOWN_W + 3, P.ICE_DOWN_W + 1, P.ICE_DOWN_W + 2, P.ICE_DOWN_W);
const ICE_THEME = nesw(P.ICE_THEME_W + 3, P.ICE_THEME_W + 1, P.ICE_THEME_W + 2, P.ICE_THEME_W);
const ICE_WAYPOINT = nesw(P.ICE_WAYPOINT_N, P.ICE_WAYPOINT_E, P.ICE_WAYPOINT_S, P.ICE_WAYPOINT_W);

/** 원작 공통 패턴: 모양이 맞는 방(HAS_MAP 아님)을 특수 방으로 — 찾으면 그 방 */
function setIfShape(L: MazeLevel, m: MazeId): MazeRoom | null {
  for (const r of L.rooms) {
    if (!r.hasMap && r.prest === m[0]) {
      setPickedFileAndPresetId(r, m[1], m[2], false);
      return r;
    }
  }
  return null;
}

/** 원작 공통 패턴: 모양이 맞는 방을 특수 방으로, 없으면 아무 방 옆에 고정 프리셋 방 (InitRoomFixedPreset) */
function setOrAttach(L: MazeLevel, m: MazeId): void {
  if (setIfShape(L, m)) return;
  for (const i of [...L.rooms]) if (!i.hasMap && initRoomFixedPreset(L, i, m[3], m[1], m[2], true)) break;
}

/** 출처: DRLGMAZE_PlaceAct5IceStuff */
function placeIceStuff(L: MazeLevel): void {
  let dir = L.seed.roll() & 3;
  for (const table of [ICE_PREV, ICE_NEXT, ICE_DOWN]) {
    const m = table[dir] as MazeId;
    if (!setIfShape(L, m)) addSpecialPreset(L, m[3], m[1], m[2]);
    dir = (dir + 1) % 4;
  }
  if (L.id !== LEVEL5.CRYSTALLINEPASSAGE) {
    if (L.id === LEVEL5.GLACIALTRAIL) {
      const m = ICE_THEME[dir] as MazeId;
      if (!replaceRoomPreset(L, m[0], m[1], m[2], false)) addSpecialPreset(L, m[3], m[1], m[2]);
      dir = (dir + 1) % 4;
    } else if (L.id !== LEVEL5.ANCIENTSWAY) return;
  }
  const m = ICE_WAYPOINT[dir] as MazeId;
  if (!replaceRoomPreset(L, m[0], m[1], m[2], false)) addSpecialPreset(L, m[3], m[1], m[2]);
}

// 출처: nAct5TempleSpecialIds
const TEMPLE: readonly MazeId[] = [
  [P.TEMPLE_NE, P.TEMPLE_NE_DOWN, -1, 1], [P.TEMPLE_NW, P.TEMPLE_NW_DOWN, -1, 0], [P.TEMPLE_SW, P.TEMPLE_SW_DOWN, -1, 3],
  [P.TEMPLE_NE, P.TEMPLE_NE_WAYPOINT, -1, 1], [P.TEMPLE_NW, P.TEMPLE_NW_WAYPOINT, -1, 0], [P.TEMPLE_SW, P.TEMPLE_SW_WAYPOINT, -1, 3],
  [P.TEMPLE_SE_UP, P.TEMPLE_SE_WAYPOINT, -1, 2],
];

/** 출처: DRLGMAZE_PlaceAct5TempleStuff — 아래층 계단 (Halls of Vaught 제외), Halls of Pain 은 웨이포인트도 */
function placeTempleStuff(L: MazeLevel): void {
  let dir = (L.seed.roll() >>> 0) % 3;
  if (L.id !== LEVEL5.HALLSOFVAUGHT) {
    setOrAttach(L, TEMPLE[dir] as MazeId);
    dir = (dir + 1) % 4;
  }
  if (L.id === LEVEL5.HALLSOFPAIN) setOrAttach(L, TEMPLE[dir + 3] as MazeId);
}

// 출처: nAct5BaalNextIds / nAct5BaalWaypointIds (특수 Def 는 N, S, E, W 순서)
const BAAL_SHAPE = [P.BAAL_N, P.BAAL_E, P.BAAL_S, P.BAAL_W];
const BAAL_DIR = [3, 0, 1, 2];
const baalIds = (n: number, s: number, e: number, w: number): MazeId[] => [n, e, s, w].map((x, i) => [BAAL_SHAPE[i] as number, x, -1, BAAL_DIR[i] as number] as const);
const BAAL_NEXT = baalIds(P.BAAL_NEXT_N, P.BAAL_NEXT_S, P.BAAL_NEXT_E, P.BAAL_NEXT_W);
const BAAL_WAYPOINT = baalIds(P.BAAL_WAYPOINT_N, P.BAAL_WAYPOINT_S, P.BAAL_WAYPOINT_E, P.BAAL_WAYPOINT_W);

/** 출처: DRLGMAZE_PlaceAct5BaalStuff — 다음 층 계단, 월드스톤 킵 2 층은 웨이포인트도 */
function placeBaalStuff(L: MazeLevel): void {
  const dir = L.seed.roll() & 3;
  setOrAttach(L, BAAL_NEXT[dir] as MazeId);
  if (L.id === LEVEL5.WORLDSTONEKEEP2) setOrAttach(L, BAAL_WAYPOINT[(dir + 1) % 4] as MazeId);
}

/** 출처: dword_6FDCE850 — { 프리셋, 붙일 방향, 파일 } (두 개씩 한 벌) */
const LAVA_SETS: readonly (readonly [number, number, number])[] = [
  [P.LAVA_S, 1, 0], [P.LAVA_N, 3, 1], [P.LAVA_S, 1, 1], [P.LAVA_N, 3, 0],
  [P.LAVA_E, 0, 1], [P.LAVA_W, 2, 0], [P.LAVA_E, 0, 0], [P.LAVA_W, 2, 1],
];

/** 출처: PlaceLavaPreset */
function placeLavaPreset(L: MazeLevel, first: MazeRoom, set: number): void {
  const [prest, dir, file] = LAVA_SETS[set] as readonly [number, number, number];
  const r = allocRoom(L);
  if (linkMazeRooms(L, r, first, dir)) {
    allocOrths(first, r, dir);
    addRoomToLevel(L, r);
    pickRoomPreset(L, first, true);
    r.prest = prest;
    r.picked = file;
    r.hasMap = true;
  } else freeRoom(L, r);
}

/** 출처: DRLGMAZE_PlaceAct5LavaPresets — 첫 방의 방 시드로 한 벌을 고르고 남은 자리는 Act 4 용암(LAVA_X)으로 */
function placeLavaPresets(L: MazeLevel): void {
  const first = L.rooms[0] as MazeRoom;
  const set = 2 * (first.seed.roll() & 3);
  placeLavaPreset(L, first, set);
  placeLavaPreset(L, first, set + 1);
  fillBlankMazeSpaces(L, PREST4.LAVA_X, null);
}

/** 출처: DRLGMAZE_RollBasicPresets — Act 5 LvlType 기준 Def (신전은 기준 없음 → 롤한 파일 그대로) */
function rollBase(levelType: number): number {
  switch (levelType) {
    case LVLTYPE5.ICE_CAVES: return P.BARRICADE_16_SNOW;
    case LVLTYPE5.BAAL: return P.LAVA_NS;
    case LVLTYPE5.LAVA: return P.TEMPLE_SW_WAYPOINT;
    default: return 0;
  }
}

/** 출처: DRLGMAZE_RollBasicPresets — 방마다 파일 롤 → (기본 방 모양은 DrlgBuild 순환) → DRLGPRESET_BuildArea */
function rollBasicPresets(data: DrlgData, L: MazeLevel, origin: { x: number; y: number }): RoomBuild[] {
  const base = rollBase(L.levelType);
  const builds: { preset: number; divisor: number; rand: number }[] = [];
  const out: RoomBuild[] = [];
  for (const r of [...L.rooms]) {
    const prest = data.lvlPrest(r.prest);
    const rolled = L.seed.pick(prest.files);
    let file = r.picked;
    if (file === -1) {
      file = rolled;
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
    // 근사(원작 미확인): DRLGPRESET_AddPresetUnitToDrlgMap 의 유닛별 롤(바닥 함정·Act 5 몬스터 치환)은 생략 — 방 시드만 달라질 수 있다
    const rooms = buildPresetRooms(data.ds1(path), { def: prest.def, killEdge: prest.killEdge, populate: prest.populate, dt1Mask: prest.dt1Mask },
      r.box.x - origin.x, r.box.y - origin.y, w, h, L.seed, r.box.w <= 12 && r.box.h <= 12);
    out.unshift(...rooms.reverse());
  }
  return out;
}

/**
 * Act 5 미로 레벨 하나.
 * 출처: DRLG_InitLevel → DRLGMAZE_GenerateLevel (Act 5 분기) → DRLG_UpdateRoomExCoordinates → RollBasicPresets
 *       (RollAct_1_2_3_BasicPresets 는 Act 5 LvlType 에서 바로 반환)
 */
export function generateAct5MazeLevel(data: DrlgData, world: Act1Placement, id: number): MazeLayout {
  const placed = world.levels.get(id);
  if (!placed) throw new Error(`generateAct5MazeLevel: level ${id} not placed`);
  const rec = data.level(id);
  const L: MazeLevel = { id, levelType: rec.levelType, maze: data.lvlMaze(id), seed: levelSeed(world.startSeed, id), rooms: [], pos: { ...placed.box }, pick: pickAct5 };
  const first = allocRoom(L);
  first.box.x = L.pos.x + Math.trunc((L.pos.w - first.box.w) / 2);
  first.box.y = L.pos.y + Math.trunc((L.pos.h - first.box.h) / 2);
  addRoomToLevel(L, first);
  switch (L.levelType) {
    case LVLTYPE5.ICE_CAVES:
      if (id === LEVEL5.FROZENRIVER) setPickedFileAndPresetId(first, L.seed.pick(2) !== 0 ? P.ICE_RIVER_A : P.ICE_RIVER_B, -1, false);
      else if (id === LEVEL5.DRIFTERCAVERN) setPickedFileAndPresetId(first, P.ICE_POOL_A, -1, false);
      else if (id === LEVEL5.ICYCELLAR) setPickedFileAndPresetId(first, P.ICE_POOL_B, -1, false);
      else {
        initBasicMazeLayout(L, 2);
        growRooms(L);
        placeIceStuff(L);
      }
      break;
    case LVLTYPE5.TEMPLE:
      initBasicMazeLayout(L, 2);
      placeTempleStuff(L);
      break;
    case LVLTYPE5.BAAL:
      placeTombPrev(L, [P.BAAL_PREV_NSE, P.BAAL_PREV_SEW, P.BAAL_PREV_NSW, P.BAAL_PREV_NEW]);
      growRooms(L);
      placeBaalStuff(L);
      break;
    case LVLTYPE5.LAVA:
      placeLavaPresets(L);
      break;
    default:
      throw new Error(`MazeLevelGenerate() - Some really bad voodoo here! (level ${id}, type ${L.levelType})`);
  }
  updateRoomCoordinates(L);
  const bounds = roomBounds(L);
  const mazeRooms = L.rooms.map((r) => ({ box: { ...r.box }, prest: r.prest, picked: r.picked }));
  const built = rollBasicPresets(data, L, bounds);
  const box: Box = { x: bounds.x, y: bounds.y, w: bounds.w + 1, h: bounds.h + 1 };
  const A = new Assembler(data, box.w, box.h, placed.vis, placed.warp);
  for (const r of built) A.addRoom(r);
  for (const r of built) A.addRoomEdges(r);
  return { id, box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, mazeRooms, orthBoxes: [] };
}
