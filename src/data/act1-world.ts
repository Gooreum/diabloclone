// Act 1 월드 (마을 + 야외 전 지역 + 수도원 + 모든 던전·트리스트럼): 원작 DRLG 이식 결과를 엔진 레벨로 조립.
// 순수 알고리즘은 src/engine/drlg/* (act1.ts), 레벨 조립은 막 공용 world-level.ts (assembleWorld). 여러 막 진입점은 world.ts.
import { ACT1_ALL, generateAct1World, type Act1World } from '../engine/drlg/act1';
import { townStartSubtile } from '../engine/drlg/layout';
import { LEVEL, PREST, type DrlgData } from '../engine/drlg/types';
import { nearestWalkable } from '../engine/path';
import { Rng } from '../engine/rng';
import type { GameData } from '../engine/game';
import { makeDrlgData, tilePath } from './drlg-data';
import type { AssetSource, GameTables } from './tables';
import { assembleWorld, levelTypeDt1Paths, type WorldLevel } from './world-level';

export { LEVEL_KEYS, levelTypeDt1Paths, type WorldLevel } from './world-level';

/** DRLG 에 필요한 excel 테이블 (브라우저 preload 용) */
export const ACT1_WORLD_TABLES = ['Levels', 'LvlPrest', 'LvlSub', 'LvlTypes', 'LvlWarp', 'LvlMaze', 'Objects'];

/** 원작 DS1 (LvlPrest/LvlSub) 목록: Act 1 월드(오버월드 + 던전) 생성이 읽을 수 있는 모든 파일 */
function act1Ds1Paths(tables: GameTables, data: DrlgData): string[] {
  const out = new Set<string>();
  const prestDefs = new Set<number>();
  // 출처: LevelsIds.h D2C_LvlPrestIds — Act 1 행 (Def 1 마을 ~ 300 트리스트럼): 야외 프리셋·미로 방 프리셋·던전 프리셋 레벨
  for (let d = 1; d <= PREST.TRISTRAM; d++) prestDefs.add(d);
  for (const id of ACT1_ALL) {
    const p = data.lvlPrestByLevel(id);
    if (p) prestDefs.add(p.def);
  }
  for (const d of prestDefs) {
    let r;
    try {
      r = data.lvlPrest(d);
    } catch {
      continue;
    }
    for (const f of r.file) if (f) out.add(tilePath(f));
  }
  for (const s of data.lvlSub) if (s.type >= 0 && s.type <= 6 && s.file) out.add(tilePath(s.file));
  void tables;
  return [...out];
}

/** 브라우저 preload 목록 (테이블은 ACT1_WORLD_TABLES 를 먼저 불러온 뒤 호출) */
export function act1WorldPaths(src: AssetSource, tables: GameTables): string[] {
  const data = makeDrlgData(src, tables);
  const set = new Set<string>(act1Ds1Paths(tables, data));
  const types = new Set<number>();
  for (const id of ACT1_ALL) types.add(data.level(id).levelType);
  for (const t of types) for (const p of levelTypeDt1Paths(tables, t)) if (p) set.add(p);
  return [...set];
}

export interface Act1GameWorld {
  world: Act1World;
  levels: WorldLevel[];
  byKey: Map<string, WorldLevel>;
  /** 새 게임 시작 위치 (마을, 서브타일) */
  start: { x: number; y: number };
  /** 트리스트럼 도착 위치 (디버그·테스트용 진입 경로; 게임 안 포털은 Phase 10) */
  tristram: { x: number; y: number } | null;
}

/**
 * Act 1 오버월드 → 엔진 LevelDef + 렌더용 PresetLevel.
 * @param seed 게임 시드 (원작 DRLG_AllocDrlg nInitSeed)
 */
export function buildAct1World(src: AssetSource, tables: GameTables, gameData: GameData, seed: number): Act1GameWorld {
  const data = makeDrlgData(src, tables);
  const world = generateAct1World(data, seed);
  const { levels, byKey, byId, start } = assembleWorld(src, tables, gameData, data, world, seed, 0, LEVEL.ROGUEENCAMPMENT);
  // 트리스트럼 도착 위치 (levels.txt Position=1: 마을과 같은 타일 정보 규칙). 포털은 Phase 10 퀘스트 단계
  let tristram: { x: number; y: number } | null = null;
  const tri = byId.get(LEVEL.TRISTRAM), triLayout = world.levels.get(LEVEL.TRISTRAM)?.layout;
  if (tri && triLayout) {
    const t = townStartSubtile(triLayout, new Rng((seed ^ 0x26) >>> 0)) ?? { x: Math.trunc(tri.preset.collision.width / 2), y: Math.trunc(tri.preset.collision.height / 2) };
    const q = nearestWalkable(tri.preset.collision, t, 30) ?? t;
    tristram = { x: q.x + 0.5, y: q.y + 0.5 };
  }
  return { world, levels, byKey, start, tristram };
}
