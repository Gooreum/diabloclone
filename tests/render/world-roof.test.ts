// 지붕 숨김: 플레이어가 선 셀의 지붕 묶음(이어진 지붕 = 한 건물)만 건너뛴다 (원작: 건물 안에 들어가면 지붕이 사라진다)
import { describe, expect, it } from 'vitest';
import { CollisionMap } from '../../src/engine/collision';
import type { PlacedTile, PresetLevel } from '../../src/engine/drlg/preset';
import type { Dt1Tile } from '../../src/formats/dt1';
import type { IndexedImage, SpriteSink } from '../../src/render/sink';
import { WorldRenderer, roofGroups } from '../../src/render/world';

const tile = (orientation: number, roofHeight = 80): Dt1Tile => ({
  direction: 0, roofHeight, soundIndex: 0, animated: false, height: 80, width: 160, orientation, mainIndex: 0, subIndex: 0, rarity: 0, subTileFlags: new Uint8Array(25), blocks: [],
});

/** W×H 레벨: 바닥 전부(tiles[0]) + roofCells 에 지붕(tiles[1], 방향 15) + extraWalls */
function level(roofCells: [number, number][], W = 6, H = 6, extraWalls: PlacedTile[] = []): PresetLevel {
  const floors: PlacedTile[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) floors.push({ x, y, orientation: 0, tileIndex: 0 });
  const walls: PlacedTile[] = [...roofCells.map(([x, y]) => ({ x, y, orientation: 15, tileIndex: 1 })), ...extraWalls];
  return { widthTiles: W, heightTiles: H, tiles: [tile(0), tile(15), tile(1)], floors, walls, shadows: [], collision: new CollisionMap(W * 5, H * 5), missing: 0, maskFallback: 0 };
}

function fakeSink() {
  const drawn: { id: string; x: number; y: number }[] = [];
  const sink: SpriteSink = { begin() {}, end() {}, setPalette() {}, draw: (img: IndexedImage, x: number, y: number) => { drawn.push({ id: img.id, x, y }); } };
  return { sink, drawn };
}
const cam = { x: 15, y: 15, width: 800, height: 600 };
const at = (g: Int32Array, x: number, y: number, W = 6) => g[y * W + x];

describe('지붕 묶음', () => {
  it('이어진 지붕 셀은 같은 번호, 떨어진 건물은 다른 번호, 지붕 없는 셀은 0', () => {
    const g = roofGroups(level([[1, 1], [2, 1], [1, 2], [4, 4]]));
    expect([at(g, 1, 1), at(g, 2, 1), at(g, 1, 2)]).toEqual([1, 1, 1]);
    expect(at(g, 4, 4)).toBe(2);
    expect([at(g, 0, 0), at(g, 3, 1), at(g, 5, 5)]).toEqual([0, 0, 0]);
  });
  it('대각선만 닿는 지붕은 다른 건물', () => {
    const g = roofGroups(level([[1, 1], [2, 2]]));
    expect(at(g, 1, 1)).toBe(1);
    expect(at(g, 2, 2)).toBe(2);
  });
  it('레벨 밖 좌표와 방향 15 가 아닌 벽은 무시', () => {
    const g = roofGroups(level([[-1, 0], [6, 6]], 6, 6, [{ x: 2, y: 2, orientation: 1, tileIndex: 2 }]));
    expect(g.length).toBe(36);
    expect(g.every((v) => v === 0)).toBe(true);
  });
});
