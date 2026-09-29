// DRLG 입력 데이터 (원작 excel 테이블 행을 엔진용으로 정리한 것) 와 ID 상수.
// 출처: D2MOO D2Common/include/DataTbls/LevelsIds.h (D2C_Levels, D2C_LvlPrestIds, D2C_LvlSubIds, D2C_LvlTypes)
//       D2MOO DataTbls/LevelsTbls.cpp (Levels/LvlPrest/LvlSub/LvlWarp 필드)
import type { Ds1 } from '../../formats/ds1';

/** levels.txt 한 행 (1.14d 클래식: 난이도별 크기는 Normal 사용) */
export interface LevelRec {
  id: number;
  name: string;
  levelName: string;
  act: number;
  drlgType: number;
  levelType: number;
  sizeX: number;
  sizeY: number;
  offsetX: number;
  offsetY: number;
  depend: number;
  vis: number[];
  warp: number[];
  subType: number;
  subTheme: number;
  subWaypoint: number;
  subShrine: number;
  /** levels.txt Waypoint (255 = 없음) */
  waypoint: number;
  /** levels.txt Position (1 이면 마을 시작 타일 정보 사용) */
  position: number;
}

/** LvlPrest.txt 한 행 (행 번호 = Def) */
export interface LvlPrestRec {
  def: number;
  name: string;
  levelId: number;
  populate: boolean;
  outdoors: boolean;
  killEdge: boolean;
  fillBlanks: boolean;
  sizeX: number;
  sizeY: number;
  scan: boolean;
  pops: number;
  /** 원작 dwFiles (무작위로 고를 파일 수) */
  files: number;
  /** File1..File6 ('0' 은 빈 문자열) */
  file: string[];
  dt1Mask: number;
}

/** LvlSub.txt 한 행 */
export interface LvlSubRec {
  type: number;
  file: string;
  checkAll: boolean;
  bordType: number;
  gridSize: number;
  dt1Mask: number;
  prob: number[];
  trials: number[];
  max: number[];
}

/** LvlWarp.txt 한 행 */
export interface LvlWarpRec { id: number; name: string; offsetX: number; offsetY: number; exitWalkX: number; exitWalkY: number; direction: string }

/** 엔진이 원작 데이터를 읽는 창구 (src/data 에서 구현) */
export interface DrlgData {
  level(id: number): LevelRec;
  lvlPrest(def: number): LvlPrestRec;
  lvlPrestByLevel(levelId: number): LvlPrestRec | undefined;
  /** LvlSub 전체 행 (원작처럼 같은 Type 행이 연속) */
  lvlSub: LvlSubRec[];
  lvlWarp: LvlWarpRec[];
  /** DS1 경로(LvlPrest/LvlSub 의 상대 경로, 예: "Act1/Outdoors/Bord1.ds1") → 파싱 결과 */
  ds1(file: string): Ds1;
  /** objects.txt SubClass (원작 OBJSUBCLASS_* 비트) */
  objectSubClass(objectId: number): number;
}

// ---- 레벨 ID (출처: LevelsIds.h D2C_Levels) ----
export const LEVEL = {
  ROGUEENCAMPMENT: 1, BLOODMOOR: 2, COLDPLAINS: 3, STONYFIELD: 4, DARKWOOD: 5, BLACKMARSH: 6, TAMOEHIGHLAND: 7,
  DENOFEVIL: 8, BURIALGROUNDS: 17, FORGOTTENTOWER: 20, MONASTERYGATE: 26, OUTERCLOISTER: 27, TRISTRAM: 38, MOOMOOFARM: 39,
} as const;

// ---- LvlPrest Def (출처: LevelsIds.h D2C_LvlPrestIds — LvlPrest.txt 행 번호와 같음) ----
export const PREST = {
  NONE: 0, ACT1_TOWN_1: 1, TOWN_1_TRANSITION_E: 2, TOWN_1_TRANSITION_S: 3,
  WILD_BORDER_1: 4, WILD_BORDER_2: 5, WILD_BORDER_3: 6, WILD_BORDER_4: 7, WILD_BORDER_5: 8, WILD_BORDER_6: 9, WILD_BORDER_7: 10,
  WILD_BORDER_8: 11, WILD_BORDER_9: 12, WILD_BORDER_10: 13, WILD_BORDER_11: 14, WILD_BORDER_12: 15,
  WILD_CLIFF_BORDER_2: 16, WILD_CLIFF_BORDER_3: 17, WILD_CLIFF_BORDER_5: 18, WILD_CLIFF_BORDER_6A: 19, WILD_CLIFF_BORDER_6B: 20,
  WILD_CLIFF_BORDER_6C: 21, WILD_CLIFF_BORDER_7: 22, WILD_CLIFF_BORDER_10: 23, WILD_CLIFF_CAVE_RIGHT: 24, WILD_CLIFF_CAVE_LEFT: 25,
  RIVER_UPPER: 26, RIVER_LOWER: 27, BRIDGE: 28, STONE_FILL_1: 29, STONE_FILL_2: 30, CORRAL_FILL: 31,
  SWAMP_FILL_1: 38, SWAMP_FILL_2: 39, TREE_FILL: 40, RUIN: 41, FALLEN_CAMP_1: 42, FALLEN_CAMP_2: 43, FALLEN_CAMP_BISHIBOSH: 44,
  CAMP: 45, POND: 46, COTTAGES_1: 47, COTTAGES_2: 48, COTTAGES_3: 49, BIVOUAC: 50, CAVE_ENTRANCE: 51, DOE_ENTRANCE: 52,
  GRAVEYARD: 108,
  // 출처: LevelsIds.h — Act 1 야외 특수 프리셋 (Stony Field 돌, Dark Wood 이니퍼스 나무, Black Marsh 탑)
  CAIRN_STONES: 160, INIFUS: 161, TOWER_TOME: 162, TOWER_1: 163,
  // 출처: LevelsIds.h — Act 2 사막 테두리 (SpawnOutdoorLevelPresetEx 의 bBorder 판정에만 사용)
  ACT2_DESERT_BORDER_1: 364, ACT2_DESERT_BORDER_12: 375,
} as const;

// ---- LvlSub Type (출처: LevelsIds.h D2C_LvlSubIds) ----
export const LVLSUB = { BORDER_CLIFFS: 0, BORDER_MIDDLE: 1, BORDER_CORNER: 2, BORDER_BORDER: 3 } as const;

// ---- LvlTypes Id (출처: LevelsIds.h D2C_LvlTypes) ----
export const LVLTYPE = { ACT1_TOWN: 1, ACT1_WILDERNESS: 2 } as const;

export const DRLGTYPE = { MAZE: 1, PRESET: 2, OUTDOOR: 3 } as const;

// ---- 레벨 격자 2 (원작 D2DrlgOutdoorPackedGrid2InfoStrc) 비트 ----
export const G2 = {
  BORDER: 0x1, // nUnkb00
  HAS_DIRECTION: 0x2,
  DIRT_PATH: 0x80, // nUnkb07
  BLANK: 0x100, // nUnkb08
  HAS_PICKED_FILE: 0x200,
  LVL_LINK: 0x400,
  WAYPOINT: 0x800, // nUnkb11
  SHRINE: 0x1000, // nUnkb12
  PICKED_FILE_MASK: 0xf0000,
} as const;

export const pickedFileOf = (g2: number): number => (g2 >>> 16) & 0xf;

// ---- 야외 레벨 플래그 (출처: D2DrlgOutdoors.h D2C_OutDoorInfoFlags) ----
export const OUT = {
  BRIDGE: 0x4, RIVER_OTHER: 0x8, RIVER: 0x10, CLIFFS: 0x20, OUT_CAVES: 0x40,
  SOUTHWEST: 0x80, NORTHWEST: 0x100, SOUTHEAST: 0x200, NORTHEAST: 0x400,
} as const;

// ---- 방 플래그 (출처: D2DrlgDrlg.h DRLGROOMFLAG_*) ----
export const ROOM = {
  HAS_WARP_0: 0x10, SUBSHRINE_MASK: 0xf000, HAS_WAYPOINT: 0x10000, HAS_WAYPOINT_SMALL: 0x20000, WAYPOINT_MASK: 0x30000,
  POPULATION_ZERO: 0x800000,
} as const;

// ---- 타일 종류 (출처: D2CMP.h TILETYPE_*) ----
export const TILETYPE = { FLOOR: 0, WALL_TOP_CORNER_RIGHT: 3, WALL_LEFT_EXIT: 10, WALL_RIGHT_EXIT: 11, SHADOW: 13 } as const;

// ---- 원시 타일 값 비트 (출처: D2DrlgRoomTile.h D2C_PackedTileInformation) ----
export const TILE = { IS_WALL: 0x1, IS_FLOOR: 0x2, SHADOW: 0x8000000, HIDDEN: 0x80000000 } as const;
export const tileStyle = (v: number): number => (v >>> 20) & 0x3f;
export const tileSequence = (v: number): number => (v >>> 8) & 0xff;

// ---- 오브젝트 SubClass 비트 (출처: D2MOO DataTbls/ObjectsTbls.h D2C_ObjectSubClasses) ----
export const OBJSUBCLASS = { SHRINE: 0x1, WELL: 0x20, WAYPOINT: 0x40 } as const;
