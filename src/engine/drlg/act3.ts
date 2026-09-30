// Act 3 월드 전체: 레벨 배치(쿠라스트 부두 → 정글 3 개 → 쿠라스트 5 개를 북쪽으로 쌓음)·레벨 연결(vis/warp)·레벨 생성.
// 출처: D2MOO DrlgDrlg.cpp DRLG_AllocDrlg (ACT_III: dwStartSeed 롤 → bJungleInterlink = 롤 & 1),
//       DRLG_SetLevelPositionAndSize, DRLG_GetDrlgWarpFromLevelId, DRLG_SetWarpId
// 출처: D2MOO DrlgOutPlace.cpp DRLGOUTPLACE_CreateLevelConnections (ACT_III 분기), DRLG_GenerateJungles,
//       sub_6FD826D0 (맞닿은 레벨끼리 vis 등록), sub_6FD82750 (야외 레벨 orth)
// 출처: D2MOO DrlgDrlgRoom.cpp DRLG_CheckOverlappingWithOrthogonalMargin (margin −1 = 변이 맞닿고 1 칸 이상 겹침)
// 레벨 생성은 DRLG_InitLevel 과 같다: 야외(DrlgType 3) → outjung.ts, 미로(1) → act3-maze.ts, 프리셋(2) → layout.ts generatePresetLevel.
import { Rng } from '../rng';
import { directionFromCoords, levelSeed, type PlacedLevel } from './act1-link';
import { edgeExitsVia, type Act1Level, type EdgeExit, type SpecialPos } from './act1';
import { generateAct3MazeLevel } from './act3-maze';
import type { DrlgWorld } from './acts';
import type { Box } from './grid';
import { generatePresetLevel, type LevelLayout } from './layout';
import { generateAct3OutdoorLevel, generateJungles, L3, type Act3Placement } from './outjung';
import { addOrth } from './vertex';
import { DRLGTYPE, OBJSUBCLASS, type DrlgData } from './types';

export { L3 } from './outjung';

/** Act 3 야외 (마을 + 정글 3 + 쿠라스트 5) — levels.txt 75~83 */
export const ACT3_OVERWORLD: readonly number[] = [
  L3.KURASTDOCKTOWN, L3.SPIDERFOREST, L3.GREATMARSH, L3.FLAYERJUNGLE, L3.LOWERKURAST, L3.KURASTBAZAAR, L3.UPPERKURAST, L3.KURASTCAUSEWAY, L3.TRAVINCAL,
];

/** Act 3 던전 (동굴·던전·하수도·사원 6·증오의 억류지) — levels.txt 84~102 */
export const ACT3_DUNGEONS: readonly number[] = Array.from({ length: L3.DURANCEOFHATELEV3 - L3.SPIDERCAVE + 1 }, (_, i) => L3.SPIDERCAVE + i);

/** Act 3 전체 */
export const ACT3_ALL: readonly number[] = [...ACT3_OVERWORLD, ...ACT3_DUNGEONS];

/** 출처: DRLG_CheckOverlappingWithOrthogonalMargin (nOrthogonalDistanceMax ≠ 0 분기) */
function overlapsOrthogonal(a: Box, b: Box, margin: number): boolean {
  const dx = a.x >= b.x ? a.x - b.w - b.x : b.x - a.w - a.x;
  const dy = a.y >= b.y ? a.y - b.h - b.y : b.y - a.h - a.y;
  return (dx === 0 && dy <= margin) || (dy === 0 && dx <= margin);
}

/**
 * Act 3 레벨 배치.
 * 출처: DRLG_AllocDrlg (ACT_III) → DRLGOUTPLACE_CreateLevelConnections (ACT_III)
 */
export function placeAct3(data: DrlgData, initSeed: number): Act3Placement {
  const drlgSeed = new Rng(initSeed >>> 0);
  const startSeed = drlgSeed.roll();
  const jungleInterlink = (drlgSeed.roll() & 1) !== 0;
  const levels = new Map<number, PlacedLevel>();

  // 출처: DRLG_GetLevel → DRLG_AllocLevel (프리셋: DRLGPRESET_InitLevelData 파일 방향 롤, 프리셋·미로: DRLG_SetLevelPositionAndSize)
  const getLevel = (id: number): PlacedLevel => {
    let lv = levels.get(id);
    if (lv) return lv;
    const rec = data.level(id);
    lv = { id, drlgType: rec.drlgType, box: { x: 0, y: 0, w: 0, h: 0 }, vis: [...rec.vis], warp: [...rec.warp], orths: [], outdoorFlags: 0, presetDirection: 0 };
    levels.set(id, lv);
    if (rec.drlgType === DRLGTYPE.PRESET || rec.drlgType === DRLGTYPE.MAZE) {
      if (rec.drlgType === DRLGTYPE.PRESET) {
        const prest = data.lvlPrestByLevel(id);
        lv.presetDirection = prest && prest.files ? levelSeed(startSeed, id).pick(prest.files) : -1;
      }
      let px = 0, py = 0;
      if (rec.depend) {
        const dep = getLevel(rec.depend);
        px = dep.box.x;
        py = dep.box.y;
      }
      lv.box = { x: px + rec.offsetX, y: py + rec.offsetY, w: rec.sizeX, h: rec.sizeY };
    }
    return lv;
  };
  // 출처: DRLG_SetWarpId (nId = −1)
  const setWarp = (lv: PlacedLevel, vis: number, warp: number) => {
    for (let i = 0; i < 8; i++) if (lv.vis[i] === vis) { lv.warp[i] = warp; return; }
    for (let i = 0; i < 8; i++) if (!lv.vis[i] && lv.warp[i] === -1) { lv.vis[i] = vis; lv.warp[i] = warp; return; }
    throw new Error(`DRLG_SetWarpId: no slot (level ${lv.id} vis ${vis})`);
  };

  const town = getLevel(L3.KURASTDOCKTOWN);
  const trec = data.level(L3.KURASTDOCKTOWN);
  town.box = { x: trec.offsetX, y: trec.offsetY, w: trec.sizeX, h: trec.sizeY };
  const sf = data.level(L3.SPIDERFOREST);
  const jungles = new Map<number, { defs: number[]; clearings: number }>();
  let flayer: PlacedLevel | null = null;
  for (const j of generateJungles(drlgSeed, town.box, sf.sizeX, sf.sizeY)) {
    const lv = getLevel(j.id);
    lv.box = { ...j.box };
    jungles.set(j.id, { defs: j.defs, clearings: j.clearings });
    flayer = lv;
  }
  if (!flayer) throw new Error('placeAct3: no jungle');
  // 쿠라스트 5 개: 불꽃 강 정글 위로 차례로 쌓고 가로 가운데 정렬
  let posY = 0;
  for (let id = L3.LOWERKURAST; id <= L3.TRAVINCAL; ++id) {
    const r = data.level(id);
    posY -= r.sizeY;
    const lv = getLevel(id);
    lv.box = { x: Math.trunc(flayer.box.w / 2) + flayer.box.x - Math.trunc(r.sizeX / 2), y: posY + flayer.box.y, w: r.sizeX, h: r.sizeY };
  }
  // 출처: sub_6FD826D0(KURASTDOCKTOWN, TRAVINCAL) — 변이 맞닿은 레벨끼리 가장자리 연결(warp −1)
  for (let i = L3.KURASTDOCKTOWN; i <= L3.TRAVINCAL; ++i) {
    const a = getLevel(i);
    for (let j = L3.KURASTDOCKTOWN; j <= L3.TRAVINCAL; ++j) if (i !== j && overlapsOrthogonal(a.box, getLevel(j).box, -1)) setWarp(a, j, -1);
  }
  // 출처: sub_6FD82750(KURASTDOCKTOWN, TRAVINCAL) — 야외 레벨의 warp −1 이웃을 orth 로
  for (let i = L3.KURASTDOCKTOWN; i <= L3.TRAVINCAL; ++i) {
    const lv = getLevel(i);
    if (lv.drlgType !== DRLGTYPE.OUTDOOR) continue;
    for (let j = 0; j < 8; j++) {
      const vis = lv.vis[j] as number;
      if (vis && lv.warp[j] === -1) {
        const o = getLevel(vis);
        addOrth(lv.orths, { levelId: vis, dir: directionFromCoords(lv.box, o.box), preset: o.drlgType === DRLGTYPE.PRESET, box: o.box });
      }
    }
  }
  // 나머지(던전·사원·증오의 억류지)는 공용 시드를 쓰지 않으므로 한꺼번에 할당해도 같다
  for (const id of ACT3_DUNGEONS) getLevel(id);
  return { startSeed, levels, jungleInterlink, jungles };
}

export interface Act3World extends DrlgWorld {
  placement: Act3Placement;
}

/** 레이아웃에서 웨이포인트·신전·입구 (Act 1 과 같은 규칙) */
function specials(data: DrlgData, layout: LevelLayout): { waypoint: SpecialPos | null; shrines: SpecialPos[]; entrances: LevelLayout['warps'] } {
  let waypoint: SpecialPos | null = null;
  const shrines: SpecialPos[] = [];
  for (const u of layout.units) {
    if (u.type !== 2) continue;
    const sc = data.objectSubClass(u.id);
    if (sc & OBJSUBCLASS.WAYPOINT) waypoint ??= { x: u.x, y: u.y, objectId: u.id };
    else if (sc & (OBJSUBCLASS.SHRINE | OBJSUBCLASS.WELL)) shrines.push({ x: u.x, y: u.y, objectId: u.id });
  }
  const seen = new Set<number>();
  const entrances = layout.warps.filter((w) => !seen.has(w.toLevel) && (seen.add(w.toLevel), true));
  return { waypoint, shrines, entrances };
}

/**
 * Act 3 월드 생성 (막 DRLG — 게임 시드 → 결정적).
 * 출처: DRLG_AllocDrlg(ACT_III) + 레벨마다 DRLG_InitLevel
 */
export function generateAct3World(data: DrlgData, seed: number, ids: readonly number[] = ACT3_ALL): Act3World {
  const placement = placeAct3(data, seed);
  const levels = new Map<number, Act1Level>();
  for (const id of ids) {
    const placed = placement.levels.get(id);
    if (!placed) continue;
    let layout: LevelLayout;
    if (placed.drlgType === DRLGTYPE.OUTDOOR) layout = generateAct3OutdoorLevel(data, placement, id);
    else if (placed.drlgType === DRLGTYPE.MAZE) layout = generateAct3MazeLevel(data, placement, id);
    else layout = generatePresetLevel(data, placement, id);
    const box = placed.drlgType === DRLGTYPE.MAZE ? layout.box : placed.box;
    levels.set(id, { id, drlgType: placed.drlgType, layout, box, ...specials(data, layout), touch: [] });
  }
  // 가장자리 연결: 서로 vis 에 있고 warp = −1 이며 사각형이 맞닿은 쌍 (Act 1 과 같은 방법)
  const exits: EdgeExit[] = [];
  const list = [...levels.values()];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as Act1Level, b = list[j] as Act1Level;
      const pa = placement.levels.get(a.id), pb = placement.levels.get(b.id);
      if (!pa || !pb) continue;
      const linked = pa.vis.some((v, k) => v === b.id && pa.warp[k] === -1) || pb.vis.some((v, k) => v === a.id && pb.warp[k] === -1);
      if (!linked) continue;
      exits.push(...edgeExitsVia(a.id, a.box, a.box, b.id, b.box, b.box));
    }
  return { seed, placement, levels, exits };
}
