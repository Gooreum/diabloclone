// 레벨 조립: 방들의 타일 격자를 레벨 하나의 DS1 형태 레이어로 합치고, 프리셋 유닛·레벨 이동 지점·타일 정보를 모은다.
// 출처: D2MOO DrlgOutdoors.cpp DRLGOUTDOORS_GenerateLevel (방 생성 루프: 프리셋 셀 → DRLGPRESET_AllocDrlgMap/BuildArea,
//       나머지 → DRLGOUTPLACE_CreateOutdoorRoomEx), Act 1 황야 DT1 마스크 0x44103
// 출처: D2MOO DrlgPreset.cpp DRLGPRESET_AllocDrlgMap, DRLGPRESET_BuildPresetArea (타일 정보 30~33),
//       DRLGPRESET_GenerateLevel, DRLGPRESET_SpawnHardcodedPresetUnits (Blood Moor 입구 Flavie)
// 출처: D2MOO DrlgRoomTile.cpp DRLGROOMTILE_LoadInitRoomTiles (숨김 규칙, 출구 타일 style < 8 = 레벨 이동, KillEdge),
//       DRLGROOMTILE_AddWarp (LvlWarp OffsetX/Y), DRLGROOMTILE_LoadFloorWarpTiles (이동 지점 방은 몬스터 없음)
// 출처: D2MOO DrlgDrlgWarp.cpp sub_6FD788D0 (마을 시작 위치: 타일 정보 0~4 중 하나 + 서브타일 +3)
// 근사(원작 미확인): 방 가장자리(겹침) 타일의 연결 처리(DRLGROOMTILE_LinkedTileDataManager 의 벽 종류 재매핑)는
//   "안쪽 칸 우선, 비어 있으면 이웃 방 가장자리 칸" 으로 단순화했다.
import type { Ds1, Ds1Cell } from '../../formats/ds1';
import type { Rng } from '../rng';
import { type Act1Placement, levelSeed } from './act1-link';
import type { Box, DrlgGrid } from './grid';
import { generateOutdoorGrid, type OutdoorLevel } from './outdoors';
import { allocRoomSeed, buildOutdoorRoom, buildPresetRooms, shiftUnit, type RoomBuild } from './rooms';
import { G2, LEVEL, PREST, ROOM, TILE, TILETYPE, pickedFileOf, tileSequence, tileStyle, type DrlgData } from './types';

export interface LayoutUnit { type: number; id: number; x: number; y: number; code?: string; flags?: number; path?: { x: number; y: number; action?: number }[] }
/** 레벨 이동 타일 (동굴 입구 등). 좌표 = 레벨 기준 서브타일 */
export interface WarpPoint { x: number; y: number; toLevel: number; warpId: number; visIndex: number }
export interface LayoutRoom { x: number; y: number; w: number; h: number; flags: number; prest: number }

export interface LevelLayout {
  id: number;
  /** 월드 타일 좌표 */
  box: Box;
  ds1: Ds1;
  /** 타일별 LvlTypes DT1 파일 마스크 (비트 i = LvlTypes "File i+1") */
  tileMask: Uint32Array;
  units: LayoutUnit[];
  warps: WarpPoint[];
  /** 원작 pTileInfo (타일 좌표, 인덱스) — 마을 시작/이동 도착 지점 */
  tileInfo: { x: number; y: number; index: number }[];
  /** 방 목록 (서브타일) */
  rooms: LayoutRoom[];
  /** 야외 레벨만: 셀 격자 생성 상태 (테스트·디버그용) */
  outdoor?: OutdoorLevel;
  /** 타일별 이동 불가 (원작 바닥 bUnwalkable 0x20000 → MAPTILE_UNWALKABLE). 없으면 DT1 서브타일 플래그만 — Act 3 정글 빈 블록 등 */
  unwalkable?: Uint8Array;
}

const MAX_WALL_LAYERS = 4, MAX_FLOOR_LAYERS = 2;

export class Assembler {
  readonly W: number;
  readonly H: number;
  readonly floors: Uint32Array[];
  readonly walls: Uint32Array[];
  readonly types: Uint32Array[];
  readonly shadow: Uint32Array;
  readonly mask: Uint32Array;
  readonly units: LayoutUnit[] = [];
  readonly warps: WarpPoint[] = [];
  readonly tileInfo: { x: number; y: number; index: number }[] = [];
  readonly rooms: LayoutRoom[] = [];
  private readonly vis: number[];
  private readonly warp: number[];
  private readonly data: DrlgData;

  constructor(data: DrlgData, W: number, H: number, vis: number[], warp: number[]) {
    this.data = data;
    this.W = W;
    this.H = H;
    const n = W * H;
    this.floors = Array.from({ length: MAX_FLOOR_LAYERS }, () => new Uint32Array(n));
    this.walls = Array.from({ length: MAX_WALL_LAYERS }, () => new Uint32Array(n));
    this.types = Array.from({ length: MAX_WALL_LAYERS }, () => new Uint32Array(n));
    this.shadow = new Uint32Array(n);
    this.mask = new Uint32Array(n);
    this.vis = vis;
    this.warp = warp;
  }

  /** 출처: DRLGROOMTILE_LoadInitRoomTiles 규칙으로 방 셀 하나를 레벨 레이어에 기록 (edge = 가장자리 겹침 칸) */
  private put(room: RoomBuild, tx: number, ty: number, edge: boolean): void {
    const lx = room.x + tx, ly = room.y + ty;
    if (lx < 0 || ly < 0 || lx >= this.W || ly >= this.H) return;
    const k = ly * this.W + lx;
    let wrote = false;
    room.floors.forEach((g, li) => {
      if (li >= MAX_FLOOR_LAYERS) return;
      let v = g.get(tx, ty) >>> 0;
      if (!(v & TILE.IS_FLOOR)) return;
      // 출처: LoadInitRoomTiles — 바닥 style 30 sequence 0/1 은 숨김
      if (tileStyle(v) === 30 && (tileSequence(v) === 0 || tileSequence(v) === 1)) v = (v | TILE.HIDDEN) >>> 0;
      if (edge && (this.floors[li] as Uint32Array)[k]! & TILE.IS_FLOOR) return;
      (this.floors[li] as Uint32Array)[k] = v;
      wrote = true;
    });
    room.walls.forEach((g, li) => {
      if (li >= MAX_WALL_LAYERS) return;
      const v = g.get(tx, ty) >>> 0;
      const type = (room.types[li] as DrlgGrid | undefined)?.get(tx, ty) ?? 0;
      if (!(v & TILE.IS_WALL) && type !== TILETYPE.WALL_LEFT_EXIT && type !== TILETYPE.WALL_RIGHT_EXIT) return;
      if (type === TILETYPE.WALL_LEFT_EXIT || type === TILETYPE.WALL_RIGHT_EXIT) {
        const st = tileStyle(v);
        if (st >= 8) {
          // 출처: BuildPresetArea — style 30~33 은 타일 정보 (마을 시작·이동 도착 지점)
          if (!edge && st >= 30 && st <= 33) {
            const idx = st === 30 ? tileSequence(v) : st === 31 ? tileSequence(v) + 5 : st === 32 ? 10 : 11;
            this.tileInfo.push({ x: lx, y: ly, index: idx });
          }
          return;
        }
        // style < 8 = vis 인덱스 → 레벨 이동 (숨김 타일, 또는 보이는 벽의 sequence 0/4)
        if (!edge && (v & TILE.HIDDEN || tileSequence(v) === 0 || tileSequence(v) === 4)) this.addWarp(room, tx, ty, st, lx, ly);
        if (v & TILE.HIDDEN) {
          room.flags |= ROOM.POPULATION_ZERO;
          return;
        }
      }
      if (!(v & TILE.IS_WALL)) return;
      if (edge && (this.walls[li] as Uint32Array)[k]! & TILE.IS_WALL) return;
      (this.walls[li] as Uint32Array)[k] = v;
      (this.types[li] as Uint32Array)[k] = type;
      wrote = true;
    });
    const sh = room.shadow ? room.shadow.get(tx, ty) >>> 0 : 0;
    if (sh & TILE.SHADOW && !(edge && this.shadow[k]! & TILE.SHADOW)) {
      this.shadow[k] = sh;
      wrote = true;
    }
    if (!edge || wrote) this.mask[k] = (this.mask[k] as number) | room.dt1Mask;
  }

  /** 출처: DRLGROOMTILE_AddWarp — LvlWarp(warp id, 방향 'b'/'l'/'r') OffsetX/Y 만큼 이동한 서브타일에 이동 지점 */
  private addWarp(room: RoomBuild, tx: number, ty: number, style: number, lx: number, ly: number): void {
    if (tx === room.w || ty === room.h) return;
    const warpId = this.warp[style] ?? -1;
    const toLevel = this.vis[style] ?? 0;
    if (warpId < 0 || !toLevel) return;
    const rec = this.data.lvlWarp.find((r) => r.id === warpId);
    if (!rec) return;
    this.warps.push({ x: lx * 5 + rec.offsetX, y: ly * 5 + rec.offsetY, toLevel, warpId, visIndex: style });
  }

  addRoom(room: RoomBuild): void {
    for (let ty = 0; ty < room.h; ty++) for (let tx = 0; tx < room.w; tx++) this.put(room, tx, ty, false);
    for (const u of room.units) this.units.push(shiftUnit(u, room.x * 5, room.y * 5));
    this.rooms.push({ x: room.x * 5, y: room.y * 5, w: room.w * 5, h: room.h * 5, flags: room.flags, prest: room.prest });
  }

  addRoomEdges(room: RoomBuild): void {
    const cw = room.w + (room.killEdgeX ? 0 : 1), ch = room.h + (room.killEdgeY ? 0 : 1);
    for (let ty = 0; ty < ch; ty++)
      for (let tx = 0; tx < cw; tx++) if (tx >= room.w || ty >= room.h) this.put(room, tx, ty, true);
  }

  toDs1(): Ds1 {
    const cell = (v: number, orientation: number, present: boolean): Ds1Cell => ({
      prop1: present ? v & 0xff || 1 : 0,
      sequence: (v >>> 8) & 0xff,
      style: (v >>> 20) & 0x3f,
      hidden: (v & TILE.HIDDEN) !== 0,
      orientation,
    });
    const floors = this.floors.map((l) => Array.from(l, (v) => cell(v, 0, (v & TILE.IS_FLOOR) !== 0)));
    const walls = this.walls.map((l, li) => Array.from(l, (v, i) => cell(v, (this.types[li] as Uint32Array)[i] as number, (v & TILE.IS_WALL) !== 0)));
    const shadows = [Array.from(this.shadow, (v) => cell(v, 13, (v & TILE.SHADOW) !== 0))];
    return { version: 18, width: this.W, height: this.H, act: 0, substitutionType: 0, files: [], walls, floors, shadows, objects: [] };
  }
}

/** 프리셋 셀 하나 → 방들 (출처: DRLGPRESET_AllocDrlgMap + DRLGPRESET_SetPickedFileInDrlgMap + DRLGPRESET_BuildArea) */
export function presetMapRooms(data: DrlgData, seed: Rng, prestId: number, picked: number, x: number, y: number, fallbackW: number, fallbackH: number): { rooms: RoomBuild[]; picked: number } {
  const prest = data.lvlPrest(prestId);
  // AllocDrlgMap: 파일 수만큼 롤 (이후 격자의 파일 번호로 덮어씀)
  const rolled = seed.pick(prest.files);
  const file = picked >= 0 ? picked : rolled;
  const w = prest.sizeX && prest.sizeY ? prest.sizeX : fallbackW;
  const h = prest.sizeX && prest.sizeY ? prest.sizeY : fallbackH;
  const path = prest.file[file];
  if (!path) throw new Error(`LvlPrest ${prestId} (${prest.name}) has no file ${file}`);
  // 근사(원작 미확인): DRLGPRESET_AddPresetUnitToDrlgMap 의 유닛별 롤(OBJECT_FLOORTRAP/TOMBFLOORTRAP·581 번·Act 2/4/5 몬스터)은
  //   생략. Act 1 Scan 프리셋 중 트리스트럼(Tri_Town4.ds1)에만 "a trap"(objects.txt 250) 이 있으나 250 이 OBJECT_FLOORTRAP 인지
  //   확인하지 못했다 — 롤을 하든 않든 프리셋 레벨의 파일 선택은 롤보다 먼저라 타일 배치는 같다(방 시드만 달라질 수 있음)
  const rooms = buildPresetRooms(data.ds1(path), { def: prestId, killEdge: prest.killEdge, populate: prest.populate, dt1Mask: prest.dt1Mask }, x, y, w, h, seed);
  return { rooms, picked: file };
}

/** 출처: DRLGOUTDOORS_GenerateLevel 의 LvlType 별 DT1 마스크 (Act 1 Wilderness) */
export const ACT1_WILD_DT1_MASK = 0x44103;

/** Act 1 야외 레벨 하나 생성 */
export function generateOutdoorLevel(data: DrlgData, world: Act1Placement, id: number): LevelLayout {
  const lv = generateOutdoorGrid(data, world, id);
  const placed = lv.placed;
  const A = new Assembler(data, lv.box.w, lv.box.h, placed.vis, placed.warp);
  const all: RoomBuild[] = [];
  for (let j = 0; j < lv.gh; j++)
    for (let i = 0; i < lv.gw; i++) {
      const flags = lv.grid[1].get(i, j);
      const g = lv.grid[2].get(i, j);
      if (g & G2.HAS_PICKED_FILE) {
        const prest = lv.grid[0].get(i, j);
        if (!prest) continue;
        const { rooms, picked } = presetMapRooms(data, lv.seed, prest, pickedFileOf(g), i * 8, j * 8, 0, 0);
        // 출처: DRLGPRESET_SpawnHardcodedPresetUnits — Blood Moor 의 트인 테두리(파일 3)에 Flavie(Navi)
        if (id === LEVEL.BLOODMOOR && prest >= PREST.WILD_BORDER_1 && prest <= PREST.WILD_BORDER_4 && picked === 3) {
          const r = data.lvlPrest(prest);
          rooms[0]?.units.push({ type: 1, id: -1, x: Math.trunc(r.sizeX / 2) * 5, y: Math.trunc(r.sizeY / 2) * 5, code: 'navi' });
        }
        for (const r of rooms) r.flags |= flags;
        all.push(...rooms);
      } else if (!(g & G2.BLANK)) {
        all.push(buildOutdoorRoom(data, lv, i, j, flags, ACT1_WILD_DT1_MASK));
      }
    }
  for (const r of all) A.addRoom(r);
  for (const r of all) A.addRoomEdges(r);
  return { id, box: lv.box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, outdoor: lv };
}

/**
 * 프리셋 레벨 (Rogue Encampment, Monastery Gate, Outer Cloister …).
 * 출처: DRLGPRESET_GenerateLevel — 파일 = pPreset->nDirection (링크 단계에서 정해짐, -1 이면 맵의 무작위 파일)
 */
export function generatePresetLevel(data: DrlgData, world: Act1Placement, id: number): LevelLayout & { picked: number } {
  const placed = world.levels.get(id);
  if (!placed) throw new Error(`generatePresetLevel: level ${id} not placed`);
  const prest = data.lvlPrestByLevel(id);
  if (!prest) throw new Error(`generatePresetLevel: no LvlPrest for level ${id}`);
  const seed = levelSeed(world.startSeed, id);
  const W = placed.box.w, H = placed.box.h;
  const dir = placed.presetDirection;
  const { rooms, picked } = presetMapRooms(data, seed, prest.def, dir, 0, 0, W, H);
  const A = new Assembler(data, W, H, placed.vis, placed.warp);
  for (const r of rooms) A.addRoom(r);
  for (const r of rooms) A.addRoomEdges(r);
  return { id, box: placed.box, ds1: A.toDs1(), tileMask: A.mask, units: A.units, warps: A.warps, tileInfo: A.tileInfo, rooms: A.rooms, picked };
}

/** 원작 방 시드 할당만 필요한 경우 재수출 (테스트용) */
export { allocRoomSeed };

/**
 * 마을 시작 위치 (레벨 기준 서브타일).
 * 출처: DUNGEON_FindActSpawnLocationEx(마을, 타일 인덱스 0) → sub_6FD788D0 (levels.txt Position=1: 타일 정보 0~4 중 무작위) + (x·5+3, y·5+3)
 * 근사(원작 미확인): 후보가 여러 개일 때의 레벨 시드 상태는 생성 직후 새 시드로 대신한다 (Act 1 마을은 후보 1 개).
 */
export function townStartSubtile(layout: LevelLayout, seed: Rng): { x: number; y: number } | null {
  const STRU_Y = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 3, 4, 5];
  const matches = layout.tileInfo.filter((t) => t.index === 0 || STRU_Y[t.index] === 0);
  if (!matches.length) return null;
  let r = seed.pick(matches.length) + 1;
  for (const t of layout.tileInfo) {
    if (t.index === 0 || STRU_Y[t.index] === 0) --r;
    if (r <= 0) return { x: t.x * 5 + 3, y: t.y * 5 + 3 };
  }
  return null;
}
