// 원작 excel 테이블·DS1 파일 → 엔진 DRLG 입력 (DrlgData).
// 출처: D2MOO DataTbls/LevelsTbls.cpp — Levels/LvlPrest/LvlSub/LvlWarp 로더 필드 (난이도별 크기는 Normal 열 SizeX/SizeY)
import { parseDs1, type Ds1 } from '../formats/ds1';
import type { TxtRow } from '../formats/txt';
import type { DrlgData, LevelRec, LvlPrestRec, LvlSubRec, LvlWarpRec } from '../engine/drlg/types';
import { num, type AssetSource, type GameTables } from './tables';

export const TILES_DIR = 'data\\global\\tiles\\';
/** LvlPrest/LvlSub/LvlTypes 의 상대 경로 → MPQ 경로 */
export const tilePath = (f: string): string => `${TILES_DIR}${f.replace(/\//g, '\\')}`;
const fileOrEmpty = (v: string | undefined): string => (v && v !== '0' ? v : '');

export function levelRec(r: TxtRow): LevelRec {
  return {
    id: num(r.Id), name: r.Name ?? '', levelName: r.LevelName ?? '', act: num(r.Act), drlgType: num(r.DrlgType), levelType: num(r.LevelType),
    sizeX: num(r.SizeX), sizeY: num(r.SizeY), offsetX: num(r.OffsetX), offsetY: num(r.OffsetY), depend: num(r.Depend),
    vis: Array.from({ length: 8 }, (_, i) => num(r[`Vis${i}`])), warp: Array.from({ length: 8 }, (_, i) => num(r[`Warp${i}`], -1)),
    subType: num(r.SubType, -1), subTheme: num(r.SubTheme, -1), subWaypoint: num(r.SubWaypoint, -1), subShrine: num(r.SubShrine, -1),
    waypoint: num(r.Waypoint, 255), position: num(r.Position),
  };
}

export function lvlPrestRec(r: TxtRow): LvlPrestRec {
  return {
    def: num(r.Def), name: r.Name ?? '', levelId: num(r.LevelId), populate: num(r.Populate) !== 0, outdoors: num(r.Outdoors) !== 0,
    killEdge: num(r.KillEdge) !== 0, fillBlanks: num(r.FillBlanks) !== 0, sizeX: num(r.SizeX), sizeY: num(r.SizeY), scan: num(r.Scan) !== 0,
    pops: num(r.Pops), files: num(r.Files), file: Array.from({ length: 6 }, (_, i) => fileOrEmpty(r[`File${i + 1}`])), dt1Mask: num(r.Dt1Mask) >>> 0,
  };
}

export function lvlSubRec(r: TxtRow): LvlSubRec {
  return {
    type: num(r.Type, -1), file: fileOrEmpty(r.File), checkAll: num(r.CheckAll) !== 0, bordType: num(r.BordType), gridSize: num(r.GridSize, 1),
    dt1Mask: num(r.Dt1Mask) >>> 0,
    prob: Array.from({ length: 5 }, (_, i) => num(r[`Prob${i}`])), trials: Array.from({ length: 5 }, (_, i) => num(r[`Trials${i}`])),
    max: Array.from({ length: 5 }, (_, i) => num(r[`Max${i}`])),
  };
}

export function lvlWarpRec(r: TxtRow): LvlWarpRec {
  return { id: num(r.Id, -1), name: r.Name ?? '', offsetX: num(r.OffsetX), offsetY: num(r.OffsetY), exitWalkX: num(r.ExitWalkX), exitWalkY: num(r.ExitWalkY), direction: r.Direction ?? 'b' };
}

/** 테이블/파일 접근을 DrlgData 로 감싼다 (파싱 결과 캐시) */
export function makeDrlgData(src: AssetSource, tables: GameTables): DrlgData & { files: Set<string> } {
  const levels = new Map<number, LevelRec>();
  for (const r of tables.table('Levels')) if (r.Id !== undefined && r.Id !== '') levels.set(num(r.Id), levelRec(r));
  const prests = new Map<number, LvlPrestRec>();
  for (const r of tables.table('LvlPrest')) if (r.Def !== undefined && r.Def !== '') prests.set(num(r.Def), lvlPrestRec(r));
  // 원작 로더는 "Expansion" 구분 행을 건너뛴다 (Type 이 비어 있는 행)
  const lvlSub = tables.table('LvlSub').filter((r) => r.Type !== undefined && r.Type !== '').map(lvlSubRec);
  const lvlWarp = tables.table('LvlWarp').filter((r) => r.Id !== undefined && r.Id !== '').map(lvlWarpRec);
  const subClass = new Map<number, number>();
  for (const r of tables.table('Objects')) if (r.Id !== undefined && r.Id !== '') subClass.set(num(r.Id), num(r.SubClass));
  const ds1Cache = new Map<string, Ds1>();
  const files = new Set<string>();
  return {
    files,
    lvlSub,
    lvlWarp,
    level(id) {
      const r = levels.get(id);
      if (!r) throw new Error(`levels.txt: id ${id} not found`);
      return r;
    },
    lvlPrest(def) {
      const r = prests.get(def);
      if (!r) throw new Error(`LvlPrest.txt: Def ${def} not found`);
      return r;
    },
    lvlPrestByLevel(levelId) {
      for (const r of prests.values()) if (r.levelId === levelId) return r;
      return undefined;
    },
    ds1(file) {
      const key = file.toLowerCase();
      let d = ds1Cache.get(key);
      if (!d) {
        const path = tilePath(file);
        files.add(path);
        const b = src.read(path);
        if (!b) throw new Error(`DS1 not found: ${path}`);
        d = parseDs1(b);
        ds1Cache.set(key, d);
      }
      return d;
    },
    objectSubClass(id) {
      return subClass.get(id) ?? 0;
    },
  };
}
