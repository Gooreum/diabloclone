// 막별 DRLG 등록표: 막마다 만드는 레벨 목록·마을 레벨·월드 생성 함수.
// 출처: D2MOO D2Common/src/Drlg/Drlg.cpp DRLG_AllocDrlg — 막(nAct)마다 DRLG 를 따로 할당하고
//       DRLG_InitAct → 막별 CreateLevelConnections (Act 1: DRLGACTIVATE_…Act1 / Act 2~4: Drlg.cpp 의 막 분기)
// 원작처럼 막 단위로 한 번에 만든다: 플레이어가 그 막에 처음 들어갈 때 (world.ts buildActWorld → Game.onActChange).
// Act 2~4 는 Phase 2~4 가 여기 ACT_DRLG 에 항목을 더한다 (outdesr.ts / outjung.ts / logic.ts 등 새 파일). Act 1 파일(act1*.ts)은 건드리지 않는다.
import { ACT1_ALL, generateAct1World, type Act1Level, type EdgeExit } from './act1';
import { ACT2_ALL, generateAct2World } from './act2';
import { ACT3_ALL, generateAct3World } from './act3';
import { LEVEL, type DrlgData } from './types';
import { ACT4_ALL, LEVEL4, generateAct4World } from './act4';

/** 막 DRLG 한 레벨 (Act 1 과 같은 모양: 배치 결과·특수 위치·가장자리 접촉) */
export type DrlgLevel = Act1Level;

/** 한 막의 DRLG 결과 (Act1World 가 이 모양을 만족한다) */
export interface DrlgWorld {
  seed: number;
  levels: Map<number, DrlgLevel>;
  /** 레벨 가장자리 출구 (양방향) */
  exits: EdgeExit[];
}

export interface ActDrlg {
  /** 막 번호 (0 = Act 1) */
  act: number;
  /** 마을 레벨 (levels.txt Id) */
  town: number;
  /** 이 막에서 만드는 레벨 (levels.txt Id) */
  levels: readonly number[];
  /** 막 월드 생성 (게임 시드 → 결정적) */
  generate(data: DrlgData, seed: number): DrlgWorld;
}

/** 출처: levels.txt Act 칸 — 막별 마을 (Rogue Encampment 1, Lut Gholein 40, Kurast Docks 75, Pandemonium Fortress 103) */
export const ACT_TOWNS: readonly number[] = [LEVEL.ROGUEENCAMPMENT, 40, 75, 103];

/** 클래식 막 수 (Act 1~4) */
export const ACT_COUNT = 4;

/** 막별 DRLG 등록표. 없는 막은 아직 만들지 않은 것 (Phase 2~4) */
export const ACT_DRLG: Readonly<Record<number, ActDrlg>> = {
  0: { act: 0, town: LEVEL.ROGUEENCAMPMENT, levels: ACT1_ALL, generate: (data, seed) => generateAct1World(data, seed) },
  1: { act: 1, town: 40, levels: ACT2_ALL, generate: (data, seed) => generateAct2World(data, seed) },
  3: { act: 3, town: LEVEL4.FORTRESS, levels: ACT4_ALL, generate: (data, seed) => generateAct4World(data, seed) },
  2: { act: 2, town: 75, levels: ACT3_ALL, generate: (data, seed) => generateAct3World(data, seed) },
};

/** 막 DRLG (없으면 "아직 없음" 오류) */
export function actDrlg(act: number): ActDrlg {
  const d = ACT_DRLG[act];
  if (!d) throw new Error(`Act ${act + 1} world is not implemented yet`);
  return d;
}

/** 월드를 만들 수 있는 막 */
export function actAvailable(act: number): boolean {
  return !!ACT_DRLG[act];
}
