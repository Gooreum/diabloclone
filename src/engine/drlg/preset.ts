// DS1 프리셋 → 레벨 타일 배치 + 서브타일 충돌 맵.
// 출처: Paul Siramy — DS1/DT1 문서: 타일 = 5×5 서브타일, 타일 헤더의 서브타일 플래그 25바이트 (bit0 = 걷기 차단)
//       (https://d2mods.info/forum/kb/viewarticle?a=21, a=22)
// 출처: OpenDiablo2 d2dt1/subtile.go — 플래그 비트: BlockWalk, BlockLOS, BlockJump, BlockPlayerWalk, ?, BlockLight
// 타일 변형 선택: 같은 (방향, main, sub) 타일이 여러 개면 rarity 가중 무작위 (레벨 시드)
import type { Ds1 } from '../../formats/ds1';
import type { Dt1Tile } from '../../formats/dt1';
import { CollisionMap } from '../collision';
import { Rng } from '../rng';

export interface PlacedTile { x: number; y: number; orientation: number; tileIndex: number }

export interface PresetLevel {
  widthTiles: number;
  heightTiles: number;
  /** 모든 DT1 타일 (ds1.files 순서로 이어붙임) */
  tiles: Dt1Tile[];
  floors: PlacedTile[];
  walls: PlacedTile[];
  shadows: PlacedTile[];
  collision: CollisionMap;
}

export const tileKey = (orientation: number, main: number, sub: number): string => `${orientation}:${main}:${sub}`;

/** 벽 방향 3(왼쪽 모서리)은 4(오른쪽 부분)와 한 쌍으로 그린다 (DS1 문서 — 방향 3/4 코너 타일) */
export function wallOrientations(o: number): number[] {
  return o === 3 ? [3, 4] : [o];
}

/**
 * 서브타일 플래그 인덱스 (DT1 25바이트 배열 → 타일 내부 x,y). 배열은 y 가 뒤집혀 저장된다.
 * 검증: scripts/dump-collision.mjs 로 Rogue Encampment(townE1.ds1) 충돌을 원작 그래픽 위에 겹쳐 비교 —
 *       x + (4 − y)×5 일 때만 돌담·마차·텐트 발밑과 일치 (x + y×5 는 반 타일 어긋남)
 */
export function subtileIndex(x: number, y: number): number {
  return x + (4 - y) * 5;
}

export function buildPresetLevel(ds1: Ds1, dt1s: Dt1Tile[][], seed: number): PresetLevel {
  const tiles = dt1s.flat();
  const byKey = new Map<string, number[]>();
  tiles.forEach((t, i) => {
    const k = tileKey(t.orientation, t.mainIndex, t.subIndex);
    const list = byKey.get(k);
    if (list) list.push(i);
    else byKey.set(k, [i]);
  });
  const rng = new Rng(seed);
  const pick = (k: string): number => {
    const list = byKey.get(k);
    if (!list || list.length === 0) return -1;
    if (list.length === 1) return list[0] as number;
    const total = list.reduce((s, i) => s + Math.max(tiles[i]?.rarity ?? 0, 0), 0);
    if (total <= 0) return list[0] as number;
    let r = rng.pick(total);
    for (const i of list) {
      r -= Math.max(tiles[i]?.rarity ?? 0, 0);
      if (r < 0) return i;
    }
    return list[0] as number;
  };

  const W = ds1.width, H = ds1.height;
  const collision = new CollisionMap(W * 5, H * 5);
  const applyFlags = (tileIdx: number, tx: number, ty: number) => {
    const t = tiles[tileIdx];
    if (!t) return;
    for (let sy = 0; sy < 5; sy++)
      for (let sx = 0; sx < 5; sx++) {
        const f = t.subTileFlags[subtileIndex(sx, sy)] ?? 0;
        if (f) collision.block(tx * 5 + sx, ty * 5 + sy, f);
      }
  };

  const floors: PlacedTile[] = [];
  for (const layer of ds1.floors) {
    layer.forEach((c, i) => {
      if (!c.prop1 || c.hidden) return;
      const x = i % W, y = Math.floor(i / W);
      const idx = pick(tileKey(0, c.style, c.sequence));
      if (idx < 0) return;
      floors.push({ x, y, orientation: 0, tileIndex: idx });
      applyFlags(idx, x, y);
    });
  }
  const walls: PlacedTile[] = [];
  for (const layer of ds1.walls) {
    layer.forEach((c, i) => {
      if (!c.prop1 || c.hidden || c.orientation === 0) return;
      const x = i % W, y = Math.floor(i / W);
      for (const o of wallOrientations(c.orientation)) {
        const idx = pick(tileKey(o, c.style, c.sequence));
        if (idx < 0) continue;
        walls.push({ x, y, orientation: o, tileIndex: idx });
        applyFlags(idx, x, y);
      }
    });
  }
  const shadows: PlacedTile[] = [];
  for (const layer of ds1.shadows) {
    layer.forEach((c, i) => {
      if (!c.prop1 || c.hidden) return;
      const idx = pick(tileKey(13, c.style, c.sequence));
      if (idx >= 0) shadows.push({ x: i % W, y: Math.floor(i / W), orientation: 13, tileIndex: idx });
    });
  }
  return { widthTiles: W, heightTiles: H, tiles, floors, walls, shadows, collision };
}
