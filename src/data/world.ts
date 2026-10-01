// 막별 월드 진입점: 막 번호 → 원작 DRLG 로 만든 엔진 레벨·렌더 프리셋.
// 출처: D2MOO Drlg.cpp DRLG_AllocDrlg — 원작도 막마다 DRLG 를 따로 할당한다 (플레이어가 그 막에 들어갈 때).
// Act 1 은 기존 act1-world.ts (buildAct1World) 에 맡기고, Act 2~4 는 engine/drlg/acts.ts ACT_DRLG 등록표로 만든다.
import { actDrlg, ACT_TOWNS } from '../engine/drlg/acts';
import type { GameData, LevelDef } from '../engine/game';
import type { Pt } from '../engine/geom';
import { ACT1_WORLD_TABLES, act1WorldPaths, buildAct1World } from './act1-world';
import { makeDrlgData, tilePath } from './drlg-data';
import type { AssetSource, GameTables } from './tables';
import { assembleWorld, levelKey, levelTypeDt1Paths, type WorldLevel } from './world-level';

export { levelKey, LEVEL_KEYS, type WorldLevel } from './world-level';

/** DRLG 에 필요한 excel 테이블 (모든 막 공용 — 브라우저 preload 용) */
export const WORLD_TABLES: readonly string[] = ACT1_WORLD_TABLES;

/** 한 막의 월드 */
export interface ActWorld {
  /** 막 번호 (0 = Act 1) */
  act: number;
  levels: WorldLevel[];
  byKey: Map<string, WorldLevel>;
  /** 마을 레벨 id (엔진 키) */
  townId: string;
  /** 막 도착 위치 (마을, 서브타일) */
  start: Pt;
  /** Act 1 만: 트리스트럼 도착 위치 (디버그·테스트) */
  tristram?: Pt | null;
}

/** 엔진에 넘길 막 레벨 (Game.addAct / onActChange 결과) */
export function actLevels(w: ActWorld): { levels: LevelDef[]; start: Pt } {
  return { levels: w.levels.map((l) => l.def), start: w.start };
}

/** 막 마을의 엔진 레벨 id */
export function actTownKey(act: number): string {
  const id = ACT_TOWNS[act];
  if (id === undefined) throw new Error(`unknown act ${act}`);
  return levelKey(id);
}

/**
 * 막 월드 만들기.
 * @param seed 게임 시드 (원작 DRLG_AllocDrlg nInitSeed — 막마다 같은 게임 시드)
 * @param act 0 = Act 1 … 3 = Act 4. 아직 없는 막이면 오류
 */
export function buildActWorld(src: AssetSource, tables: GameTables, data: GameData, seed: number, act: number): ActWorld {
  if (act === 0) {
    const w = buildAct1World(src, tables, data, seed);
    return { act: 0, levels: w.levels, byKey: w.byKey, townId: actTownKey(0), start: w.start, tristram: w.tristram };
  }
  const drlg = actDrlg(act);
  const dd = makeDrlgData(src, tables);
  const world = drlg.generate(dd, seed);
  const { levels, byKey, start } = assembleWorld(src, tables, data, dd, world, seed, act, drlg.town);
  return { act, levels, byKey, townId: levelKey(drlg.town), start };
}

/**
 * 브라우저 preload 목록: 막 월드가 읽는 DS1/DT1 (테이블은 WORLD_TABLES 를 먼저 불러온 뒤 호출).
 * 근사(원작 미확인): Act 2~4 는 LvlPrest 이름이 "Act n" 으로 시작하는 행 + 등록 레벨의 프리셋 + LvlSub 전부
 */
export function actWorldPaths(src: AssetSource, tables: GameTables, act: number): string[] {
  if (act === 0) return act1WorldPaths(src, tables);
  const drlg = actDrlg(act);
  const data = makeDrlgData(src, tables);
  const set = new Set<string>();
  const prefix = `Act ${act + 1}`;
  for (const r of tables.table('LvlPrest')) {
    // 확장팩 Act 5 지옥 구덩이는 빈 자리를 Act 4 용암 방으로 채운다 (DRLGMAZE_PlaceAct5LavaPresets → FillBlankMazeSpaces(LVLPREST_ACT4_LAVA_X))
    if (!(r.Name ?? '').startsWith(prefix) && !(act === 4 && r.Name === 'Act 4 - Lava X')) continue;
    for (let i = 1; i <= 6; i++) {
      const f = r[`File${i}`];
      if (f && f !== '0') set.add(tilePath(f));
    }
  }
  for (const id of drlg.levels) {
    const p = data.lvlPrestByLevel(id);
    if (p) for (const f of p.file) if (f) set.add(tilePath(f));
  }
  // LvlSub: 테두리 규칙 0~3 (DRLGOUTDOORS_AddAct124SecondaryBorder) + 이 막 레벨의 SubType/SubWaypoint/SubShrine 행만
  // (Act 1~4 에는 클래식 MPQ 에 없는 확장팩 LvlSub 파일 — Expansion/Siege — 을 넣지 않는다)
  const subTypes = new Set<number>([0, 1, 2, 3]);
  // 확장팩 Act 5: Barricade 치환 규칙 (LVLSUB_ACT5_BARRICADE 12, DRLGOUTSIEGE_AddACt5SecondaryBorder)
  if (act === 4) subTypes.add(12);
  for (const id of drlg.levels) {
    const r = data.level(id);
    for (const t of [r.subType, r.subWaypoint, r.subShrine]) if (t >= 0) subTypes.add(t);
  }
  for (const s of data.lvlSub) if (s.file && subTypes.has(s.type)) set.add(tilePath(s.file));
  const types = new Set<number>();
  for (const id of drlg.levels) types.add(data.level(id).levelType);
  for (const t of types) for (const p of levelTypeDt1Paths(tables, t)) if (p) set.add(p);
  return [...set];
}

/** 막 팔레트 (원작 data\global\palette\ACT1~ACT5\pal.dat) */
export function actPalettePath(act: number): string {
  return `data\\global\\palette\\ACT${act + 1}\\pal.dat`;
}
