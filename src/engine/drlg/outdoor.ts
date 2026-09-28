// 야외 레벨 조립 (Blood Moor 슬라이스용 근사).
// 근사(원작 미확인 → Phase 8 에서 D2MOO DrlgOutWild/DrlgOutdoors/DrlgOutPlace 정밀 이식으로 교체):
//   원작은 액트 전체 외곽선(버텍스) → 8×8 타일 그리드 → LvlSub 테두리 치환 → 강/절벽 동굴/마을 전환/흙길/웨이포인트/신전 → 빈칸 채움.
//   여기서는 원작 프리셋 DS1(마을 전환 TownETrans, 채움·테두리 프리셋)과 원작 잔디 타일만 사용해 그리드에 배치한다.
// 출처: levels.txt Blood Moor SizeX/SizeY 80×80, LvlPrest "Act 1 - Town 1 Transition E"(8×40), 채움 프리셋(8×8),
//       LvlTypes "Act 1 - Wilderness" DT1 목록
import type { Ds1, Ds1Cell } from '../../formats/ds1';
import type { Rng } from '../rng';

export interface Stamp { ds1: Ds1; x: number; y: number }

const EMPTY: Ds1Cell = { prop1: 0, sequence: 0, style: 0, hidden: false, orientation: 0 };

/** 여러 DS1 을 타일 좌표에 찍어 하나의 DS1 로 합친다 (뒤에 찍힌 것이 비어있지 않은 셀을 덮어씀) */
export function mergeStamps(width: number, height: number, stamps: Stamp[], baseFloor?: { style: number; sequence: number }): Ds1 {
  const cells = width * height;
  const floor: Ds1Cell[] = Array.from({ length: cells }, () =>
    baseFloor ? { prop1: 1, sequence: baseFloor.sequence, style: baseFloor.style, hidden: false, orientation: 0 } : { ...EMPTY },
  );
  const wallLayers = Math.max(1, ...stamps.map((s) => s.ds1.walls.length));
  const walls: Ds1Cell[][] = Array.from({ length: wallLayers }, () => Array.from({ length: cells }, () => ({ ...EMPTY })));
  const shadow: Ds1Cell[] = Array.from({ length: cells }, () => ({ ...EMPTY }));
  const objects: Ds1['objects'] = [];
  for (const st of stamps) {
    const d = st.ds1;
    for (let y = 0; y < d.height; y++)
      for (let x = 0; x < d.width; x++) {
        const tx = st.x + x, ty = st.y + y;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const di = y * d.width + x, ti = ty * width + tx;
        for (const layer of d.floors) {
          const c = layer[di];
          if (c && c.prop1) floor[ti] = { ...c };
        }
        d.walls.forEach((layer, li) => {
          const c = layer[di];
          if (c && c.prop1) (walls[li] as Ds1Cell[])[ti] = { ...c };
        });
        const sc = d.shadows[0]?.[di];
        if (sc && sc.prop1) shadow[ti] = { ...sc };
      }
    for (const o of d.objects) objects.push({ ...o, x: o.x + st.x * 5, y: o.y + st.y * 5 });
  }
  return { version: 18, width, height, act: 0, substitutionType: 0, files: [], walls, floors: [floor], shadows: [shadow], objects };
}

/** 가장 흔한 바닥 (style, sequence) — 기본 잔디 */
export function mostCommonFloor(ds1s: Ds1[]): { style: number; sequence: number } {
  const count = new Map<string, number>();
  for (const d of ds1s) for (const layer of d.floors) for (const c of layer) if (c.prop1) count.set(`${c.style}:${c.sequence}`, (count.get(`${c.style}:${c.sequence}`) ?? 0) + 1);
  const [best] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['0:0'];
  const [style, sequence] = best.split(':').map(Number);
  return { style: style ?? 0, sequence: sequence ?? 0 };
}

export interface WildPresets {
  townTransE: Ds1;
  /** 8×8 채움 프리셋 후보 */
  fills: Ds1[];
  /** 테두리(나무·돌담) 조각 */
  borders: Ds1[];
}

export interface WildLayout {
  ds1: Ds1;
  /** 마을 전환 프리셋이 놓인 타일 y (x = 0) */
  townTransY: number;
}

/** Blood Moor 근사 레이아웃: 80×80 타일 = 10×10 셀, 서쪽 중앙에 마을 전환, 외곽 테두리, 내부 채움 */
export function layoutWild(presets: WildPresets, rng: Rng, widthTiles = 80, heightTiles = 80): WildLayout {
  const cellsX = Math.floor(widthTiles / 8), cellsY = Math.floor(heightTiles / 8);
  const stamps: Stamp[] = [];
  const townTransY = Math.floor((heightTiles - presets.townTransE.height) / 2 / 8) * 8;
  const transCells = Math.ceil(presets.townTransE.height / 8);
  const isTrans = (cx: number, cy: number) => cx === 0 && cy >= townTransY / 8 && cy < townTransY / 8 + transCells;
  for (let cy = 0; cy < cellsY; cy++)
    for (let cx = 0; cx < cellsX; cx++) {
      if (isTrans(cx, cy)) continue;
      const edge = cx === 0 || cy === 0 || cx === cellsX - 1 || cy === cellsY - 1;
      const r = rng.pick(100);
      let pick: Ds1 | undefined;
      if (edge) pick = presets.borders[rng.pick(presets.borders.length)];
      else if (r < 30) pick = presets.fills[rng.pick(presets.fills.length)];
      else if (r < 42) pick = presets.borders[rng.pick(presets.borders.length)];
      if (pick) stamps.push({ ds1: pick, x: cx * 8, y: cy * 8 });
    }
  stamps.push({ ds1: presets.townTransE, x: 0, y: townTransY });
  const base = mostCommonFloor(presets.borders);
  return { ds1: mergeStamps(widthTiles, heightTiles, stamps, base), townTransY };
}
