// 오브젝트(상자·통·항아리·문·신전·우물·웨이포인트·포털 …): 원작 objects.txt / ObjGroup.txt / shrines.txt 를 읽어
// 유닛 생성(DS1 프리셋 + 방 오브젝트 그룹 배치)과 초기화(InitFn)를 한다. 조작(OperateFn)은 game.ts 가 이 모듈의 도움 함수로 처리.
// 출처: D2MOO D2Game/src/OBJECTS/Objects.cpp (OBJECTS_PopulationHandler, OBJECTS_PopulateFn1~8, OBJECTS_CreateObject,
//       OBJECTS_SpawnPresetObject/SpawnPresetChest/SpawnSpecialChest, OBJECTS_InitHandler, OBJECTS_InitFunction01/02/03/16/57)
//       D2Game/src/OBJECTS/ObjRgn.cpp (우물·신전 개수/거리 제한, 신전 효과 분류표)
//       D2Common/src/DataTbls/ObjectsTbls.cpp (objects.txt 필드, FrameCnt <<= 8)
import type { TxtRow } from '../formats/txt';
import { COLLIDE_DOOR, COLLIDE_MASK_PLACEMENT, COLLIDE_OBJECT, type CollisionMap } from './collision';
import { Rng } from './rng';
import type { Difficulty } from './difficulty';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

/** 출처: ObjMode.txt (NU OP ON S1 S2 S3 S4 S5) — D2MOO OBJMODE_* 순서 */
export const OBJMODE = { NEUTRAL: 0, OPERATING: 1, OPENED: 2, SPECIAL1: 3, SPECIAL2: 4, SPECIAL3: 5, SPECIAL4: 6, SPECIAL5: 7 } as const;
export const OBJMODE_TOKENS = ['NU', 'OP', 'ON', 'S1', 'S2', 'S3', 'S4', 'S5'] as const;

// 출처: D2MOO D2Common/include/DataTbls/ObjectsIds.h
export const OBJ = {
  CASKET5: 1, CASKET6: 3, URN1: 4, LARGE_CHEST_RIGHT: 5, LARGE_CHEST_LEFT: 6, BARREL: 7, URN2: 9, EXPLODING_BARREL: 11,
  CRATE: 46, URN3: 52, ROGUE_ON_STICK1: 57, ROGUE_ON_STICK2: 58, TOWN_PORTAL: 59, PERMANENT_TOWN_PORTAL: 60,
  CASKET3: 79, HEALINGWELL: 84, MUMMY_COFFIN_LEFT: 89, URN4: 94, URN5: 95, FLIES: 103,
  CHEST_RIGHT_LARGE_ACT1: 139, CHEST_RIGHT_TALLSKINNY_ACT1: 140, CHEST_RIGHT_MEDIUM_ACT1: 141, LEFT_CHEST_ACT1: 144,
  CHEST_LEFT_MEDIUM: 176, CHEST_LEFT_LARGE: 177, CHEST_LEFT_TALLSKINNY: 198, BASKET1: 208, BASKET2: 209,
  GENERAL_CHEST_LEFT1: 240, GENERAL_CHEST_RIGHT2: 241, GENERAL_CHEST_RIGHT3: 242, GENERAL_CHEST_LEFT3: 243, CHEST: 371,
} as const;

/** 출처: ObjectsTbls.h D2C_ObjectSubClasses */
export const SUBCLASS = { SHRINE: 0x1, OBELISK: 0x2, TOWNPORTAL: 0x4, CHEST: 0x8, PORTAL: 0x10, WELL: 0x20, WAYPOINT: 0x40, DOOR: 0x80 } as const;

/** objects.txt 한 행 */
export interface ObjectType {
  id: number; name: string; token: string;
  sizeX: number; sizeY: number;
  /** 모드별 (0~7): 프레임 수, 프레임 진행(256 = 1프레임/틱), 반복, 사용 여부, 충돌, 선택 가능, 시작 프레임 */
  frameCnt: number[]; frameDelta: number[]; cycleAnim: boolean[]; mode: boolean[]; hasCollision: boolean[]; selectable: boolean[]; start: number[];
  orderFlag: number[];
  isDoor: boolean; blocksVis: boolean; subClass: number; operateRange: number;
  operateFn: number; populateFn: number; initFn: number; clientFn: number;
  parm: number[]; lockable: boolean; gore: number; damage: number; xSpace: number; ySpace: number; orientation: number;
  preOperate: boolean; drawUnder: boolean;
  /** 선택 상자 (유닛 화면 위치 기준 픽셀) */
  left: number; top: number; width: number; height: number;
  automap: number; isAttackable: boolean;
  /** COF 레이어 사용 여부 (HD TR LG RA LA RH LH SH S1~S8) */
  layers: string[];
}

/** shrines.txt 한 행 (행 번호 = Code) */
export interface ShrineRec { code: number; name: string; arg0: number; arg1: number; duration: number; resetMinutes: number; effectClass: number; levelMin: number }

export interface ObjGroupRec { id: number; entries: { id: number; density: number; prob: number }[]; shrines: boolean; wells: boolean }

/**
 * levels.txt 에서 오브젝트가 쓰는 칸. monLvl = 이 표 난이도의 클래식 레벨 몬스터 레벨 (MonLvl1 / MonLvl2 / MonLvl3).
 * 출처: DATATBLS_GetMonsterLevelInArea(nLevelId, nDifficulty, bExpansion) — 클래식은 wMonLvl[난이도]
 */
export interface LevelObjInfo { id: number; act: number; waypoint: number; monLvl: number; monLvlByDiff?: number[]; themes: number; objGrp: number[]; objPrb: number[] }

const LAYERS = ['HD', 'TR', 'LG', 'RA', 'LA', 'RH', 'LH', 'SH', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];

export class ObjectDb {
  readonly types: ObjectType[] = [];
  readonly shrines: ShrineRec[] = [];
  readonly groups: ObjGroupRec[] = [];
  readonly levels = new Map<number, LevelObjInfo>();
  /**
   * 신전 효과 분류(effectclass) → shrines.txt 코드 목록.
   * 출처: ObjRgn.cpp OBJRGN_AllocObjectControl (pShrineSubTypeIds)
   */
  readonly shrineClasses: number[][] = [[], [], [], [], [], [], [], []];
  /** 이 표 난이도 (레벨 몬스터 레벨·상자 TC) */
  readonly difficulty: Difficulty = 0;

  /** 난이도 칸 (MonLvl2/3, 상자 "Act N (N) Chest") 을 쓰는 사본 — 오브젝트·신전 표는 같이 쓴다 */
  forDifficulty(d: Difficulty): ObjectDb {
    if (d === this.difficulty) return this;
    const levels = new Map([...this.levels].map(([k, v]) => [k, { ...v, monLvl: v.monLvlByDiff?.[d] ?? v.monLvl }]));
    return Object.assign(Object.create(ObjectDb.prototype) as ObjectDb, this, { difficulty: d, levels });
  }

  constructor(t: { objects: TxtRow[]; objGroup: TxtRow[]; shrines: TxtRow[]; levels: TxtRow[] }) {
    for (const r of t.objects) {
      // 'Expansion' 구분선은 Id 가 비어 있다 (그대로 두면 0 번 Dummy 를 덮는다)
      if (!r.Id) continue;
      const id = n(r.Id);
      const arr = (p: string) => Array.from({ length: 8 }, (_, i) => n(r[`${p}${i}`]));
      this.types[id] = {
        id, name: r.Name ?? '', token: r.Token ?? '', sizeX: n(r.SizeX), sizeY: n(r.SizeY),
        // 출처: ObjectsTbls.cpp — dwFrameCnt <<= 8 (서버는 >> 8 로 프레임 수를 쓴다)
        frameCnt: arr('FrameCnt'), frameDelta: arr('FrameDelta'), cycleAnim: arr('CycleAnim').map(Boolean), mode: arr('Mode').map(Boolean),
        hasCollision: arr('HasCollision').map(Boolean), selectable: arr('Selectable').map(Boolean), start: arr('Start'), orderFlag: arr('OrderFlag'),
        isDoor: n(r.IsDoor) === 1, blocksVis: n(r.BlocksVis) === 1, subClass: n(r.SubClass), operateRange: n(r.OperateRange),
        operateFn: n(r.OperateFn), populateFn: n(r.PopulateFn), initFn: n(r.InitFn), clientFn: n(r.ClientFn),
        parm: arr('Parm'), lockable: n(r.Lockable) === 1, gore: n(r.Gore), damage: n(r.Damage), xSpace: n(r.Xspace), ySpace: n(r.Yspace),
        orientation: n(r.Orientation), preOperate: n(r.PreOperate) === 1, drawUnder: n(r.DrawUnder) === 1,
        left: n(r.Left), top: n(r.Top), width: n(r.Width), height: n(r.Height), automap: n(r.AutoMap), isAttackable: n(r.IsAttackable0) === 1,
        layers: LAYERS.filter((l) => n(r[l]) === 1),
      };
    }
    t.shrines.forEach((r, i) => {
      const s: ShrineRec = {
        code: n(r.Code) || i, name: r['Shrine name'] ?? '', arg0: n(r.Arg0), arg1: n(r.Arg1), duration: n(r['Duration in frames']),
        resetMinutes: n(r['reset time in minutes']), effectClass: n(r.effectclass), levelMin: n(r.LevelMin),
      };
      this.shrines[i] = s;
      if (s.effectClass < 8) this.shrineClasses[s.effectClass]?.push(i);
    });
    t.objGroup.forEach((r, i) => {
      const entries: ObjGroupRec['entries'] = [];
      for (let k = 0; k < 8; k++) entries.push({ id: n(r[`ID${k}`]), density: n(r[`DENSITY${k}`]), prob: n(r[`PROB${k}`]) });
      this.groups[n(r.Offset) || i] = { id: i, entries, shrines: n(r.SHRINES) === 1, wells: n(r.WELLS) === 1 };
    });
    for (const r of t.levels) {
      const id = n(r.Id);
      if (!r.Name || r.Name === 'Expansion') continue;
      this.levels.set(id, {
        id, act: n(r.Act), waypoint: r.Waypoint === undefined || r.Waypoint === '' ? 255 : n(r.Waypoint), monLvl: n(r.MonLvl1), monLvlByDiff: [n(r.MonLvl1), n(r.MonLvl2), n(r.MonLvl3)], themes: n(r.Themes),
        objGrp: Array.from({ length: 8 }, (_, k) => n(r[`ObjGrp${k}`])), objPrb: Array.from({ length: 8 }, (_, k) => n(r[`ObjPrb${k}`])),
      });
    }
  }

  type(id: number): ObjectType | undefined {
    return this.types[id];
  }
  shrine(code: number): ShrineRec | undefined {
    return this.shrines[code];
  }
}

/** 오브젝트 유닛 (게임 상태) */
export interface ObjectUnit {
  id: number;
  type: ObjectType;
  x: number; y: number;
  mode: number;
  modeStart: number;
  /** 원작 pObjectData->InteractType: 상자 = 함정/잠김(0x80), 신전 = shrines.txt 코드, 우물 = 남은 사용 횟수, 포털 = 도착 레벨 번호 */
  interact: number;
  /** 원작 bSparkChest */
  spark: boolean;
  /** 신전: 이미 사용됨 (dwOperateGUID) */
  operated: boolean;
  /** 예약된 이벤트 (틱): ENDANIM(작동 → 열림), 우물 재생, 신전 초기화 */
  endAnimAt: number; regenAt: number; resetAt: number;
  /** 함정 발동 틱 (EVENTTYPE_TRAP: 연 뒤 35 프레임), 불 오브젝트 피해 틱 (EVENTTYPE_MODECHANGE) — 없으면 undefined */
  trapAt?: number; fireAt?: number;
  /** 포털: 도착 레벨 키·짝 포털 id·주인 플레이어 (마을 포털) */
  portal?: { toLevel: string; linkId: number; linkLevel: string; owner: boolean };
  /** 오브젝트 전용 시드 (원작 pObject->pSeed: 상자 InitFn 에서 초기화) */
  rng: Rng;
  /** 충돌이 기록돼 있음 */
  blocking: boolean;
  /** 원작 dwDropItemCode (부서진 통 등에서 떨어뜨릴 코드) */
  dropCode?: string;
  /** 마지막 조작 시각(틱) — 문 여닫기 0.5초 제한 */
  lastOperate: number;
}

/** 충돌 비트: 문은 COLLIDE_DOOR, 나머지는 COLLIDE_OBJECT (출처: D2Common UNITS_GetCollisionMask — 문 오브젝트 = 문 마스크) */
export const objectCollisionBit = (t: ObjectType): typeof COLLIDE_OBJECT | typeof COLLIDE_DOOR => (t.isDoor ? COLLIDE_DOOR : COLLIDE_OBJECT);

/** 모드 바꾸기 + 충돌 갱신 (UNITS_ChangeAnimMode → 충돌은 HasCollision[mode]) */
export function setObjectMode(o: ObjectUnit, mode: number, map: CollisionMap, frame: number): void {
  o.mode = mode;
  o.modeStart = frame;
  updateObjectCollision(o, map);
}

export function updateObjectCollision(o: ObjectUnit, map: CollisionMap): void {
  const want = !!o.type.hasCollision[o.mode] && o.type.sizeX > 0 && o.type.sizeY > 0;
  if (want === o.blocking) return;
  map.setUnitBox(Math.floor(o.x), Math.floor(o.y), o.type.sizeX, o.type.sizeY, objectCollisionBit(o.type), want);
  o.blocking = want;
}

/** 플레이어와 오브젝트 사이 거리: 오브젝트 상자 가장자리까지 (서브타일). 근사(원작 미확인): 원작은 UNITS_IsInRange 로 크기를 고려한 거리 판정 */
export function distanceToObject(o: ObjectUnit, x: number, y: number): number {
  const l = Math.floor(o.x) - Math.trunc(o.type.sizeX / 2), b = Math.floor(o.y) - Math.trunc(o.type.sizeY / 2);
  const r = l + Math.max(o.type.sizeX, 1), t = b + Math.max(o.type.sizeY, 1);
  const dx = x < l ? l - x : x > r ? x - r : 0, dy = y < b ? b - y : y > t ? y - t : 0;
  return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------- 레벨 오브젝트 상태 (ObjRgn)

/** 출처: D2MOO D2ObjectRegionStrc — 레벨별 배치 카운터 */
export interface ObjectRegion {
  populatedRooms: number;
  /** field_4: 지금까지 배치를 돈 방 수 */
  roomsDone: number;
  healingShrines: number;
  wells: { x: number; y: number }[];
  shrines: { x: number; y: number }[];
}

export const newRegion = (populatedRooms: number): ObjectRegion => ({ populatedRooms, roomsDone: 0, healingShrines: 0, wells: [], shrines: [] });

// 출처: ObjRgn.cpp OBJRGN_CanNotSpawnMoreWells / ShouldSpawnHealingShrineOrWell / CanNotSpawnMoreShrines / CanSpawnWell / CanSpawnShrine
const cannotMoreWells = (r: ObjectRegion) => r.wells.length === 4 || r.wells.length > Math.trunc(r.populatedRooms / 8);
const shouldHealing = (r: ObjectRegion) => r.populatedRooms > 0 && Math.trunc((r.roomsDone << 7) / r.populatedRooms) > 96 && !r.healingShrines;
const cannotMoreShrines = (r: ObjectRegion) => r.shrines.length === 10 || r.shrines.length > Math.trunc(r.populatedRooms / 8);
// 원작 그대로: x 또는 y 한쪽만 가까워도 거부 (||)
const canWell = (r: ObjectRegion, x: number, y: number) => !r.wells.some((w) => Math.abs(w.x - x) < 100 || Math.abs(w.y - y) < 100);
const canShrine = (r: ObjectRegion, x: number, y: number) => !r.shrines.some((w) => Math.abs(w.x - x) < 50 || Math.abs(w.y - y) < 50);

// ---------------------------------------------------------------- 배치 (Populate)

/** 배치 요청: 게임이 실제 유닛으로 만든다 (initFn 포함) */
export interface ObjectSpawn { classId: number; x: number; y: number; mode?: number; spark?: boolean; preOperateLock?: boolean; interact?: number }

export interface PopulateRoom { x: number; y: number; w: number; h: number; hasWaypoint: boolean; noPopulate: boolean }

/** ITEMS_RollLimitedRandomNumber: n <= 0 이면 0 (Rng.pick 와 같음) */
const lim = (rng: Rng, m: number): number => rng.pick(m);
/** ITEMS_RollRandomNumber 의 하위 32비트 (부호 없는 나눗셈) */
const roll = (rng: Rng): number => rng.roll();

/** 유닛 생성기: SUNIT_AllocUnitData(UNIT_OBJECT, …) — 생성 + InitFn + 충돌 기록 (다음 배치 검사가 보도록) */
export type ObjectCreate = (s: ObjectSpawn) => ObjectUnit | null;

interface PlaceCtx {
  db: ObjectDb; map: CollisionMap; control: Rng; roomRng: Rng; region: ObjectRegion; create: ObjectCreate; levelNo: number;
}

function alloc(c: PlaceCtx, classId: number, x: number, y: number): ObjectUnit | null {
  if (!c.db.type(classId)) return null;
  return c.create({ classId, x, y });
}

const chk = (c: PlaceCtx, x: number, y: number, sx: number, sy: number, mask: number): boolean => c.map.maskInBox(x, y, sx, sy, mask) !== 0;
const u16 = (v: number) => v & 0xffff;

/** 출처: Objects.cpp OBJECTS_CreateObject (5번 시도) */
function createObject(c: PlaceCtx, room: PopulateRoom, classId: number, sx: number, sy: number): ObjectUnit | null {
  if (room.w < 2 || room.h < 2) return null;
  for (let i = 0; i < 5; i++) {
    const x = u16(lim(c.control, room.w - sx - 1) + room.x), y = u16(lim(c.control, room.h - sy - 1) + room.y);
    if (x && y && x >= room.x + 1 && y >= room.y + 1 && x < room.x + room.w - 1 && y < room.y + room.h - 1 && !chk(c, x, y, sx + 6, sy + 6, COLLIDE_MASK_PLACEMENT)) {
      return alloc(c, classId, x, y);
    }
  }
  return null;
}

const SIGN_X = [-1, 0, 1, -1, 1, -1, 0, 1], SIGN_Y = [-1, -1, -1, 0, 0, 1, 1, 1];

/** 출처: Objects.cpp OBJECTS_PopulateFn1_CasketJarSarcophagusUrn */
function populate1(c: PlaceCtx, room: PopulateRoom, density: number, objectId: number, prob: number): void {
  const t = c.db.type(objectId);
  if (!t) return;
  if (roll(c.control) % 100 > prob) return;
  let tries = 12, nearMode = false, baseStep = 1, maxStep = 0;
  let ids: number[];
  if (objectId === OBJ.CASKET6) { ids = [OBJ.CASKET6, 28]; tries = 18; baseStep = 5; maxStep = 5; }
  else if (objectId === OBJ.CASKET3 || objectId === OBJ.CASKET5) { ids = [OBJ.CASKET3, 53, OBJ.CASKET5]; baseStep = 5; maxStep = 5; }
  else if (objectId === OBJ.URN1) { ids = [OBJ.URN1, OBJ.URN2, OBJ.URN3, OBJ.URN4, OBJ.URN5]; nearMode = true; }
  else if (objectId === OBJ.MUMMY_COFFIN_LEFT) { ids = [OBJ.MUMMY_COFFIN_LEFT, 284]; baseStep = 5; maxStep = 5; }
  else if (objectId === OBJ.BASKET1 || objectId === OBJ.BASKET2) { ids = [OBJ.BASKET1, OBJ.BASKET2]; nearMode = true; }
  else return;
  const sx = t.sizeX, sy = t.sizeY;
  const okFar = (x: number, y: number) => room.w >= sx + 2 && room.h >= sy + 2 && x > room.x + 1 && y > room.y + 1 && x < room.x - sx + room.w - 2 && y < room.y - sy + room.h - 2
    && !chk(c, x, y, sx + 7, sy + 7, 0xc01) && !chk(c, x, y, sx, sy, COLLIDE_MASK_PLACEMENT);
  const okNear = (x: number, y: number) => room.w >= 2 && room.h >= 2 && x > room.x + 2 && y > room.y + 2 && x < room.w + room.x - sx && y < room.h + room.y - sy
    && !chk(c, x, y, sx + 2, sy + 2, COLLIDE_MASK_PLACEMENT);
  let dens = (density * ((room.w * room.h) >> 7)) >> 8;
  while (dens > 0 && tries > 0) {
    const pick = ids[lim(c.control, ids.length)] as number;
    let x = u16(room.x + lim(c.control, room.w - sx - 1)), y = u16(room.y + lim(c.control, room.h - sy - 1));
    if (okFar(x, y)) {
      alloc(c, pick, x, y);
      let spawned = 1, found = true, guard = 0;
      // 원작 LABEL_45 루프: 무리 짓기 (rand(spawned/2) == 0 인 동안 근처에 하나 더)
      while (lim(c.control, spawned >> 1) === 0 && found && guard++ < 64) {
        found = false;
        const limit = 3 * Math.max(dens, 4);
        for (let k = 0; k < limit; k++) {
          const d = roll(c.control) & 7;
          x += 2 * (baseStep + lim(c.control, maxStep)) * (SIGN_X[d] as number);
          y += 2 * (baseStep + lim(c.control, maxStep)) * (SIGN_Y[d] as number);
          found = nearMode ? okNear(x, y) : okFar(x, y);
          if (found) break;
        }
        if (found) {
          alloc(c, ids[lim(c.control, ids.length)] as number, x, y);
          spawned++;
        }
      }
      // 원작 LABEL_45: 무리 짓기가 끝나면(굴림 실패 또는 자리 없음) else 분기에서 --nDensity
      dens--;
    }
    tries--;
  }
}

/** 출처: Objects.cpp OBJECTS_PopulateFn3_CommonObjects */
function populate3(c: PlaceCtx, room: PopulateRoom, density: number, objectId: number, chance: number): ObjectUnit | null {
  const t = c.db.type(objectId);
  if (!t) return null;
  if (roll(c.control) % 100 > chance) return null;
  let last: ObjectUnit | null = null;
  const max = (density * ((room.w * room.h) >> 7)) >> 8;
  for (let i = 0; i < max; i++) last = createObject(c, room, objectId, t.sizeX, t.sizeY) ?? last;
  return last;
}

/** 출처: Objects.cpp OBJECTS_PopulateFn6_RogueGuardCorpse (70% 초과면 파리) */
function populate6(c: PlaceCtx, room: PopulateRoom, density: number, objectId: number, prob: number): void {
  const o = populate3(c, room, density, objectId, prob);
  if (!o) return;
  if (roll(c.control) % 100 <= 70) return;
  alloc(c, OBJ.FLIES, Math.floor(o.x), Math.floor(o.y));
}

/** 출처: Objects.cpp OBJECTS_PopulateFn7_RogueOnStick */
function populate7(c: PlaceCtx, room: PopulateRoom, _density: number, objectId: number, prob: number): void {
  const SHAPES: [number, number][][] = [
    [[-4, 0], [0, 0], [4, 0], [8, 0], [0, 4], [0, -4]],
    [[-8, 0], [-4, 0], [0, 0], [4, 0], [8, 0]],
    [[0, -8], [0, -4], [0, 0], [0, 4], [0, 8]],
    [[-7, -5], [-5, -3], [-3, -1], [0, 0], [3, -1], [5, -3], [7, -5]],
  ];
  if (roll(c.control) % 100 > prob) return;
  const shape = SHAPES[lim(c.control, SHAPES.length)] as [number, number][];
  const t = c.db.type(objectId);
  if (!t) return;
  for (let i = 0; i < 8; i++) {
    const bx = room.x + lim(c.control, room.w - t.sizeX - 1), by = room.y + lim(c.control, room.h - t.sizeY - 1);
    if (room.w >= 7 && room.h >= 7 && u16(bx) > room.x + 1 && u16(by) > room.y + 1 && u16(bx) < room.w + room.x - 7 && u16(by) < room.h + room.y - 7
      && !chk(c, bx, by, 12, 12, 0xc01) && !chk(c, bx, by, 5, 5, COLLIDE_MASK_PLACEMENT)) {
      for (const [dx, dy] of shape) {
        const x = bx + dx, y = by + dy;
        if (room.w >= t.sizeX + 2 && room.h >= t.sizeY + 2 && u16(x) > room.x + 1 && u16(y) > room.y + 1
          && u16(x) < room.x + room.w - t.sizeX - 2 && u16(y) < room.y + room.h - t.sizeY - 2
          && !chk(c, x, y, t.sizeX + 7, t.sizeY + 7, 0xc01) && !chk(c, x, y, t.sizeX, t.sizeY, COLLIDE_MASK_PLACEMENT)) {
          const o = alloc(c, (roll(c.control) & 1) + OBJ.ROGUE_ON_STICK1, x, y);
          // 출처: OBJECTS_SpawnFliesOnCorpse (70% 초과면 파리)
          if (o && roll(c.control) % 100 > 70) alloc(c, OBJ.FLIES, x, y);
        }
      }
      return;
    }
  }
}

/** 출처: Objects.cpp OBJECTS_PopulateFn8_Well (방 시드 사용) */
function populate8(c: PlaceCtx, room: PopulateRoom, _density: number, objectId: number, prob: number): void {
  if (cannotMoreWells(c.region)) return;
  const t = c.db.type(objectId);
  if (!t) return;
  if (roll(c.roomRng) % 100 > prob) return;
  const sx = 2 * t.sizeX + 1, sy = 2 * t.sizeY + 1;
  if (!(room.w >= 2 && room.h >= 2 && room.w > sx && room.h > sy)) return;
  for (let j = 0; j < 5; j++) {
    const x = room.x + lim(c.roomRng, room.w - sx - 1), y = room.y + lim(c.roomRng, room.h - sy - 1);
    if (x && y && u16(x) >= room.x + 1 && u16(y) >= room.y + 1 && u16(x) < room.x + room.w - 1 && u16(y) < room.h + room.y - 1) {
      if (!chk(c, x, y, sx + 6, sy + 6, COLLIDE_MASK_PLACEMENT) && canWell(c.region, x, y)) {
        alloc(c, objectId, x, y);
        c.region.wells.push({ x, y });
        return;
      }
    }
  }
}

/** 출처: Objects.cpp OBJECTS_PopulateFn2_WaypointShrine (방 시드 사용, 치유 우물/신전 보장) */
function populate2(c: PlaceCtx, room: PopulateRoom, _density: number, objectId: number, prob: number): void {
  const t = c.db.type(objectId);
  if (!t) return;
  let healing = false, count = 3;
  if (shouldHealing(c.region)) {
    healing = true;
    count = 30;
  } else if (roll(c.roomRng) % 100 > prob) return;
  if (cannotMoreShrines(c.region)) return;
  while (count > 0) {
    if (room.w >= t.sizeX + 2 && room.h >= t.sizeY + 2) {
      for (let k = 0; k < 5; k++) {
        let x: number, y: number;
        if (t.orientation === 1) {
          x = room.x + Math.trunc(room.w / 4) + lim(c.roomRng, Math.trunc(room.w / 2));
          y = room.y + lim(c.roomRng, 1) + 1;
        } else if (t.orientation === 2) {
          x = room.x + lim(c.roomRng, 1) + 1;
          y = lim(c.roomRng, Math.trunc(room.h / 2)) + room.y + Math.trunc(room.h / 4);
        } else {
          x = room.x + lim(c.roomRng, room.w - t.sizeX - 1);
          y = room.y + lim(c.roomRng, room.h - t.sizeY - 1);
        }
        if (x && y && u16(x) >= room.x + 1 && u16(y) >= room.y + 1 && u16(x) < room.x + room.w - 1 && u16(y) < room.y + room.h - 1) {
          if (!chk(c, x, y, t.sizeX + 6, t.sizeY + 6, COLLIDE_MASK_PLACEMENT) && canShrine(c.region, x, y)) {
            const o = alloc(c, objectId, x, y);
            if (o) {
              if (o.interact === 2) c.region.healingShrines++;
              else if (healing) {
                // 치유 신전 보장: 클래스를 Parm1 의 오브젝트(없으면 치유 신전 84)로 바꾸고 shrines.txt 2 (Health Boost). 원작도 충돌은 그대로 둔다
                const parm1 = t.parm[1] ?? 0;
                const nt = c.db.type(parm1 && parm1 < 573 ? parm1 : OBJ.HEALINGWELL);
                if (nt) o.type = nt;
                o.interact = 2;
                c.region.healingShrines++;
              }
              c.region.shrines.push({ x, y });
            }
            return;
          }
          break;
        }
      }
    }
    count--;
  }
}

/** 출처: Objects.cpp OBJECTS_PopulateFn4_Barrel (1/3 확률 폭발 통, 무리) */
function populate4(c: PlaceCtx, room: PopulateRoom, density: number, _objectId: number, prob: number): void {
  const t = c.db.type(OBJ.BARREL);
  if (!t) return;
  if (roll(c.control) % 100 > prob) return;
  let j = (density * ((room.w * room.h) >> 7)) >> 8, k = 2 * j, count = 0;
  const ok = (x: number, y: number) => room.w >= 2 && room.h >= 2 && u16(x) > room.x + 2 && u16(y) > room.y + 2
    && u16(x) < room.w + room.x - t.sizeX && u16(y) < room.h + room.y - t.sizeY && !chk(c, x, y, t.sizeX + 2, t.sizeY + 2, COLLIDE_MASK_PLACEMENT);
  while (j > 0 && k > 0) {
    const cls = roll(c.control) % 3 === 0 ? OBJ.EXPLODING_BARREL : OBJ.BARREL;
    let x = room.x + lim(c.control, room.w), y = room.y + lim(c.control, room.h);
    if (ok(x, y)) {
      alloc(c, cls, x, y);
      if (++count >= 8) return;
      let spawn = true, max = 1;
      while (lim(c.control, max >> 1) === 0 && spawn) {
        spawn = false;
        for (let i = 0; !spawn && i < 15; i++) {
          const d = roll(c.control) & 7;
          x += t.xSpace * (SIGN_X[d] as number);
          y += t.ySpace * (SIGN_Y[d] as number);
          spawn = ok(x, y);
        }
        if (spawn) {
          alloc(c, (roll(c.control) & 3) === 0 ? OBJ.EXPLODING_BARREL : OBJ.BARREL, x, y);
          max++;
          if (++count >= 8) return;
        }
      }
      j--;
    }
    k--;
  }
}

/** 출처: Objects.cpp OBJECTS_PopulateFn5_Crate (상자·항아리 무리) */
function populate5(c: PlaceCtx, room: PopulateRoom, density: number, objectId: number, prob: number): void {
  const t = c.db.type(objectId);
  if (!t) return;
  if (roll(c.control) % 100 > prob) return;
  const URNS = [OBJ.URN1, OBJ.URN2, OBJ.URN3, OBJ.URN4, OBJ.URN5];
  let j = (density * ((room.w * room.h) >> 7)) >> 8, k = 2 * j, l = 4 * j, count = 0;
  const inRoom = (x: number, y: number) => room.w >= 2 && room.h >= 2 && u16(x) > room.x + 2 && u16(y) > room.y + 2 && u16(x) < room.w + room.x - t.sizeX && u16(y) < room.h + room.y - t.sizeY;
  while (j > 0 && k > 0) {
    let cls: number = objectId;
    if (objectId !== OBJ.CRATE) cls = URNS[lim(c.control, URNS.length)] as number;
    let x = room.x + lim(c.control, room.w), y = room.y + lim(c.control, room.h);
    if (inRoom(x, y)) {
      if (!chk(c, x, y, t.sizeX + 2, t.sizeY + 2, COLLIDE_MASK_PLACEMENT)) {
        if (cls !== OBJ.CRATE) cls = URNS[lim(c.control, URNS.length)] as number;
        alloc(c, cls, x, y);
        let spawn = true, max = 1, guard = 0;
        // 근사(원작 미확인): 원작 while (!rand(max/2) || spawn) 은 max < 4 이고 자리가 없으면 끝나지 않을 수 있어 256 회로 자른다
        while ((lim(c.control, max >> 1) === 0 || spawn) && guard++ < 256) {
          spawn = false;
          const cnt = l >= 4 ? l : 4;
          for (let i = 0; !spawn && i < cnt; i++) {
            const d = roll(c.control) & 7;
            x += t.xSpace * (SIGN_X[d] as number);
            y += t.ySpace * (SIGN_Y[d] as number);
            spawn = inRoom(x, y) && !chk(c, x, y, t.sizeX + 2, t.sizeY + 2, COLLIDE_MASK_PLACEMENT);
          }
          if (spawn) {
            alloc(c, cls, x, y);
            if (++count >= 8) return;
            max++;
          }
        }
        j--;
        l -= 4;
      }
    }
    k--;
  }
}

type PopulateFn = (c: PlaceCtx, room: PopulateRoom, density: number, objectId: number, prob: number) => void;
/** 출처: Objects.cpp gpObjectPopulateTable (9 TrappedSoul 은 Act 1 에 없음) */
const POPULATE: (PopulateFn | null)[] = [null, populate1, populate2, (c, r, d, id, p) => void populate3(c, r, d, id, p), populate4, populate5, populate6, populate7, populate8, null];

/**
 * 방 하나의 오브젝트 그룹 배치.
 * 출처: Objects.cpp OBJECTS_PopulationHandler — 웨이포인트 방·마을·배치 제외 방은 건너뜀, levels.txt ObjGrp0~7/ObjPrb0~7,
 *       ObjGroup.txt 누적 확률로 오브젝트 하나를 골라 그 오브젝트의 PopulateFn (Gore <= 2), Density 는 ObjGroup DENSITY
 * 근사(원작 미확인): 원작은 방이 활성화되는 순서(플레이어가 다가가는 순서)대로 배치한다 — 여기서는 레벨 첫 입장 때 방 목록 순서로 전부.
 *   Themes 분기는 원작 조건(nIndices[i] < nMax)상 Act 1 레벨에서 항상 실패하므로 확률 굴림만 재현한다.
 */
export function populateRoomObjects(db: ObjectDb, levelNo: number, room: PopulateRoom, map: CollisionMap, control: Rng, roomRng: Rng, region: ObjectRegion, create: ObjectCreate): void {
  const lv = db.levels.get(levelNo);
  if (!lv || room.hasWaypoint || room.noPopulate || !levelNo) return;
  region.roomsDone++;
  const c: PlaceCtx = { db, map, control, roomRng, region, create, levelNo };
  if (lv.themes && region.populatedRooms >= 0) {
    let p = 0;
    if (region.roomsDone > Math.trunc(region.populatedRooms / 2)) p = 5;
    if (region.roomsDone > region.populatedRooms - Math.trunc(region.populatedRooms / 4)) p += 5;
    if (lim(control, 100) < p + 12) {
      const idx: number[] = [];
      for (let i = 0; i < 7; i++) if ((1 << i) & lv.themes) idx.push(i + 1);
      const k = lim(control, idx.length);
      // 원작 조건 nIndices[k] < nMax 와 bActive 표 (1 SpawnNothing, 2 SpawnBarrel, 4 SpawnNothing2, 5/6 갑옷대·무기대)
      const ACTIVE = [false, true, true, false, true, true, true];
      const th = idx[k];
      if (th !== undefined && th < idx.length && ACTIVE[th]) {
        if (th === 2) spawnBarrelTheme(c, room);
        return;
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    const grp = lv.objGrp[i] ?? 0;
    let p = roll(roomRng) % 100;
    // 원작 그대로: 그룹 번호로 objects.txt 행을 조회해 SubClass 가 있으면 확률 100
    if (shouldHealing(region) && (db.type(grp)?.subClass ?? 0)) p = 100;
    if (grp && p <= (lv.objPrb[i] ?? 0)) {
      const g = db.groups[grp];
      if (!g) return;
      let acc = 0;
      p = roll(roomRng) % 100;
      for (let k = 0; k < 8; k++) {
        const e = g.entries[k];
        if (!e || !e.id) break;
        acc += e.prob;
        const t = db.type(e.id);
        if (p < acc && t && t.gore <= 2) {
          POPULATE[t.populateFn]?.(c, room, e.density, e.id, 100);
          break;
        }
      }
    }
  }
}

/** 출처: Objects.cpp OBJECTS_SpawnBarrel (테마: 방을 통으로 채움) */
function spawnBarrelTheme(c: PlaceCtx, room: PopulateRoom): void {
  const t = c.db.type(OBJ.BARREL);
  if (!t) return;
  let count = 0;
  for (let x = room.x; x < room.x + room.w + 1; x += 2)
    for (let y = room.y; y < room.y + room.h + 1; y += 2) {
      const cls = (roll(c.control) & 3) === 0 ? OBJ.EXPLODING_BARREL : OBJ.BARREL;
      if (room.w >= 2 && room.h >= 2 && x > room.x + 2 && y > room.y + 2 && x < room.w + room.x - t.sizeX && y < room.h + room.y - t.sizeY
        && !chk(c, x, y, t.sizeX + 2, t.sizeY + 2, COLLIDE_MASK_PLACEMENT)) {
        alloc(c, cls, x, y);
        if (++count >= 32) return;
      }
    }
}

// ---------------------------------------------------------------- 프리셋 오브젝트

/** 출처: Objects.cpp OBJECTS_SpawnPresetChest — Act 1 (기본 표) 무작위 상자 */
const PRESET_CHESTS_ACT1 = [
  OBJ.LARGE_CHEST_RIGHT, OBJ.LARGE_CHEST_LEFT, OBJ.CHEST_RIGHT_LARGE_ACT1, OBJ.CHEST_RIGHT_TALLSKINNY_ACT1, OBJ.CHEST_RIGHT_MEDIUM_ACT1,
  OBJ.LEFT_CHEST_ACT1, OBJ.CHEST_LEFT_MEDIUM, OBJ.CHEST_LEFT_LARGE, OBJ.CHEST_LEFT_TALLSKINNY, OBJ.GENERAL_CHEST_LEFT1,
  OBJ.GENERAL_CHEST_RIGHT2, OBJ.GENERAL_CHEST_RIGHT3, OBJ.GENERAL_CHEST_LEFT3,
];

/**
 * DS1 프리셋 오브젝트 번호 → 실제 생성 (574 이상은 특수 표).
 * 출처: Objects.cpp OBJECTS_SpawnPresetObject (580 SpawnSpecialChest, 581 SpawnPresetChest), SpawnSpecialChest (Tower Cellar 5 = OBJECT_CHEST, 스파크 상자)
 */
export function presetObject(classId: number, x: number, y: number, levelNo: number, control: Rng): ObjectSpawn | null {
  const TOWERCELLAR5 = 25;
  if (classId <= 573) return { classId, x, y };
  if (classId === 580) {
    const id = levelNo !== TOWERCELLAR5 ? 580 : OBJ.CHEST;
    const pick = PRESET_CHESTS_ACT1[roll(control) % PRESET_CHESTS_ACT1.length] as number;
    const s: ObjectSpawn = { classId: id === OBJ.CHEST ? OBJ.CHEST : pick, x, y, spark: true, preOperateLock: true };
    if (levelNo === TOWERCELLAR5) s.interact = 3;
    return s;
  }
  if (classId === 581) return { classId: PRESET_CHESTS_ACT1[roll(control) % PRESET_CHESTS_ACT1.length] as number, x, y };
  // 574~579 신전 표·582 비전 기호는 Act 1 DS1 변환 표(OBJ_PRESET_ACT1)에 나오지 않는다
  return null;
}

// ---------------------------------------------------------------- 초기화 (InitFn)

export interface InitCtx { db: ObjectDb; levelNo: number; inTown: boolean; control: Rng }

/**
 * 출처: Objects.cpp OBJECTS_InitHandler + InitFunction01 (신전) / 02 (항아리 함정) / 03·57 (상자 함정·잠김·시드) / 16 (우물) / 17 (마을 웨이포인트 열림, ObjRgn.cpp)
 *       PreOperate 가 있으면 1/14 확률로 이미 열린 상태(OBJMODE_OPENED)
 */
export function initObject(o: ObjectUnit, spawn: ObjectSpawn, c: InitCtx): void {
  const t = o.type, lv = c.db.levels.get(c.levelNo);
  const monLvl = lv?.monLvl ?? 0;
  o.interact = 0;
  switch (t.initFn) {
    case 1: {
      // 출처: InitFunction01_Shrine — Parm0 이 있으면 분류(1 → 2 체력, 2 → 3 마나, 그 외 → 4 부스터 (1/10 확률 1 매직)), 없으면 전체 중 무작위
      let code = 0;
      if (t.parm[0]) {
        let cls = 4;
        if (t.parm[0] - 1 === 0) cls = 2;
        else if (t.parm[0] - 1 === 1) cls = 3;
        else if (roll(c.control) % 10 === 0) cls = 1;
        code = shrineFromClass(c.db, cls, c.levelNo, c.control);
      } else {
        for (let i = 0; i < 8; i++) {
          code = lim(c.control, c.db.shrines.length - 1) + 1;
          if (c.levelNo >= (c.db.shrine(code)?.levelMin ?? 0)) break;
        }
      }
      if (code === 4) code = 2;
      else if (code === 5) code = 3;
      else if (code === 16) code = 18;
      o.interact = code;
      break;
    }
    case 2:
      if (roll(c.control) % 100 < Math.trunc(monLvl / 8) + 5) o.interact = (roll(c.control) & 7) + 1;
      break;
    case 3:
    case 57: {
      o.interact = roll(c.control) % 100 >= Math.trunc(monLvl / 8) + 5 ? 0 : (roll(c.control) & 7) + 1;
      if (t.lockable && roll(c.control) % 100 < Math.trunc(monLvl / 2) + 8) o.interact |= 0x80;
      else o.interact &= 0x7f;
      o.rng = new Rng((roll(c.control) % 65534) + 1);
      if (t.initFn === 57) o.spark = true;
      break;
    }
    case 16:
      o.interact = 2 * ((t.parm[2] ?? 0) & 0xff);
      break;
    case 17:
      if (c.inTown) o.mode = OBJMODE.OPENED;
      break;
    default:
      break;
  }
  if (spawn.interact !== undefined) o.interact = spawn.interact;
  if (spawn.spark) o.spark = true;
  if (spawn.mode !== undefined) o.mode = spawn.mode;
  if (t.preOperate && !spawn.preOperateLock && roll(c.control) % 14 === 0) o.mode = OBJMODE.OPENED;
}

/** 출처: Objects.cpp OBJECTS_GetShrineId — 분류 안에서 무작위, LevelMin 을 만족할 때까지 최대 8번 */
export function shrineFromClass(db: ObjectDb, cls: number, levelNo: number, control: Rng): number {
  const c = !cls || cls > 4 ? 2 : cls;
  const ids = db.shrineClasses[c] ?? [];
  let code = 0;
  for (let i = 0; i < 8; i++) {
    code = ids[lim(control, ids.length)] ?? 0;
    if (!code) code = 1;
    if (levelNo >= (db.shrine(code)?.levelMin ?? 0)) break;
  }
  return code;
}

// ---------------------------------------------------------------- 상자 TC

/** 출처: ObjMode.cpp OBJMODE_DropFromChestTCWithQuality — 액트별 최소/최대 레벨 번호 (Act 1 = 2 Blood Moor ~ 37 Catacombs 4) */
const ACT_LEVEL_RANGE = [[2, 37], [41, 73], [76, 102], [104, 108], [109, 132]] as const;

/**
 * 상자 TC 인덱스 (0 = "Act N Chest A", 1 = B, 2 = C).
 * 출처: OBJMODE_DropFromChestTCWithQuality — 레벨 몬스터 레벨이 액트 범위를 세 구간으로 나눈 어디에 있는지
 *       DATATBLS_GetTreasureClassExRecordFromActAndDifficulty — "Act %d%s Chest %s" (A/B/C)
 */
export function chestTcIndex(db: ObjectDb, levelNo: number): number {
  const lv = db.levels.get(levelNo);
  const act = lv?.act ?? 0;
  const [lo, hi] = ACT_LEVEL_RANGE[Math.min(Math.max(act, 0), 4)] as readonly [number, number];
  const cur = lv?.monLvl ?? 0, min = db.levels.get(lo)?.monLvl ?? 0, max = db.levels.get(hi)?.monLvl ?? 0;
  const off = Math.trunc((Math.abs(max - min) + 1) / 3);
  if (cur >= off + min) return (cur >= min + 2 * off ? 1 : 0) + 1;
  return 0;
}

/** 출처: DATATBLS_GetTreasureClassExRecordFromActAndDifficulty — pChestTreasureClasses[색인 + 3 × (막 + 5 × 난이도)] ("Act N (N) Chest A" …) */
export function chestTcName(db: ObjectDb, levelNo: number): string {
  const act = (db.levels.get(levelNo)?.act ?? 0) + 1;
  const diff = ['', ' (N)', ' (H)'][db.difficulty ?? 0] ?? '';
  return `Act ${act}${diff} Chest ${'ABC'[chestTcIndex(db, levelNo)]}`;
}

/** 원작 상자 조작: 떨어뜨릴 TC 굴림 횟수. 출처: OBJECTS_OperateFunction04_Chest — 잠김 2, 그 외 1 (25% 는 빈 상자, 스파크·잠김은 항상) */
export function chestDropRolls(o: ObjectUnit, rng: Rng): number {
  const locked = (o.interact & 0x80) !== 0;
  if (roll(rng) % 100 >= 25 || o.spark || locked) return locked ? 2 : 1;
  return 0;
}

/**
 * 우물 사용 후 남은 횟수·모드.
 * 출처: ObjMode.cpp OBJECTS_OperateFunction22_Well (--nType, nType <= 2×Parm2 이고 nType % Parm2 == 0 이면 모드 = 2 − nType/Parm2)
 */
export function wellAfterUse(t: ObjectType, left: number): { left: number; mode: number | null } {
  const per = t.parm[2] || 1;
  const k = (left - 1) & 0xff;
  return { left: k, mode: k <= 2 * per && k % per === 0 ? 2 - Math.trunc(k / per) : null };
}

/** 출처: ObjMode.cpp sub_6FC74B40 (EVENTTYPE_AITHINK: 우물 한 칸 재생) */
export function wellRegen(t: ObjectType, left: number): { left: number; mode: number | null } {
  const per = t.parm[2] || 1;
  if (Math.trunc(left / per) >= 2) return { left, mode: null };
  const max = 2 * per, k = left + 1;
  if (max - left < 0) return { left: max, mode: null };
  return { left: k, mode: k <= max && k % Math.trunc(max / 2) === 0 ? 2 - Math.trunc(k / per) : null };
}

/** 서버 애니메이션 길이 (ENDANIM = FrameCnt[mode] 프레임 뒤 + 1). 출처: ObjMode.cpp EVENT_SetEvent(… dwFrameCnt[1] >> 8 …) */
export const animFrames = (t: ObjectType, mode: number): number => t.frameCnt[mode] ?? 0;
