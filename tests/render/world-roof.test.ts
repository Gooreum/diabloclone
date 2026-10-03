// 지붕 숨김: 플레이어가 선 셀의 지붕 묶음(이어진 지붕 = 한 건물)만 건너뛴다 (원작: 건물 안에 들어가면 지붕이 사라진다)
import { describe, expect, it } from 'vitest';
import { CollisionMap } from '../../src/engine/collision';
import type { PlacedTile, PresetLevel } from '../../src/engine/drlg/preset';
import type { Dt1Tile } from '../../src/formats/dt1';
import type { DrawOpts, IndexedImage, SpriteSink } from '../../src/render/sink';
import { WALL_FADE_BLEND, WorldRenderer, roofGroups } from '../../src/render/world';

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
  const drawn: { id: string; x: number; y: number; blend?: number }[] = [];
  const sink: SpriteSink = { begin() {}, end() {}, setPalette() {}, draw: (img: IndexedImage, x: number, y: number, o?: DrawOpts) => { drawn.push({ id: img.id, x, y, ...(o?.blend !== undefined ? { blend: o.blend } : {}) }); } };
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

describe('지붕 숨김', () => {
  const roofCells: [number, number][] = [[1, 1], [2, 1], [1, 2], [4, 4]];
  const roofDraws = (drawn: { id: string }[]) => drawn.filter((d) => d.id.endsWith(':1')).length;

  it('viewer 없음·지붕 없는 셀 위 → 지붕 4장 전부 그리고 roofsHidden 0', () => {
    const r = new WorldRenderer(level(roofCells));
    const a = fakeSink();
    r.render(a.sink, cam);
    expect(roofDraws(a.drawn)).toBe(4);
    expect(r.roofsHidden).toBe(0);
    const b = fakeSink();
    r.render(b.sink, cam, [], { x: 0.5, y: 0.5 });
    expect(roofDraws(b.drawn)).toBe(4);
    expect(r.roofsHidden).toBe(0);
  });

  it('지붕 아래(셀 (1,1) 의 서브타일 7.5,7.5) → 그 건물 3장 건너뛰고 다른 건물 1장은 그린다', () => {
    const r = new WorldRenderer(level(roofCells));
    const a = fakeSink();
    r.render(a.sink, cam, [], { x: 7.5, y: 7.5 });
    expect(roofDraws(a.drawn)).toBe(1);
    expect(r.roofsHidden).toBe(3);
    // 다른 건물 (4,4) 아래로 가면 그쪽만 숨김
    const b = fakeSink();
    r.render(b.sink, cam, [], { x: 22, y: 22 });
    expect(roofDraws(b.drawn)).toBe(3);
    expect(r.roofsHidden).toBe(1);
    // 바닥은 그대로 전부 그린다 (36장)
    expect(b.drawn.filter((d) => d.id.endsWith(':0')).length).toBe(36);
  });

  it('벽 반투명: 플레이어보다 앞이고 플레이어 상자와 겹치는 벽만 blend 1', () => {
    // 벽 타일(tiles[2], 방향 1): RLE 블록 하나, y=-160 → 그림 top -160, 높이 192 (32줄). 셀 (3,3)
    const wall = tile(1);
    wall.blocks = [{ x: 0, y: -160, gridX: 0, gridY: 0, format: 0, data: new Uint8Array([1, 1, 5, 0, 0]) }];
    const lv = level([], 6, 6, [{ x: 3, y: 3, orientation: 1, tileIndex: 2 }]);
    lv.tiles[2] = wall;
    const r = new WorldRenderer(lv);
    const wallDraw = (d: { id: string; blend?: number }[]) => d.find((x) => x.id.endsWith(':2'));
    // 셀 (2,2) 중앙: 벽 깊이 34.9 > 25, 벽 그림이 발밑 위에 걸림 → 반투명
    const a = fakeSink();
    r.render(a.sink, { x: 12.5, y: 12.5, width: 800, height: 600 }, [], { x: 12.5, y: 12.5 });
    expect(wallDraw(a.drawn)?.blend).toBe(WALL_FADE_BLEND);
    expect(r.wallsFaded).toBe(1);
    // 셀 (4,4): 벽이 플레이어 뒤 (깊이 34.9 < 45) → 불투명
    const b = fakeSink();
    r.render(b.sink, { x: 22.5, y: 22.5, width: 800, height: 600 }, [], { x: 22.5, y: 22.5 });
    expect(wallDraw(b.drawn)?.blend).toBeUndefined();
    expect(r.wallsFaded).toBe(0);
    // viewer 없음 → 불투명
    const c = fakeSink();
    r.render(c.sink, { x: 12.5, y: 12.5, width: 800, height: 600 });
    expect(wallDraw(c.drawn)?.blend).toBeUndefined();
    expect(r.wallsFaded).toBe(0);
    expect(r.wallsFadedAt(12.5, 12.5, 800, 600)).toBe(1);
    expect(r.wallsFadedAt(22.5, 22.5, 800, 600)).toBe(0);
  });

  it('벽 반투명: 앞에 있어도 화면에서 멀리(가로 240px) 떨어진 벽은 불투명', () => {
    const wall = tile(1);
    wall.blocks = [{ x: 0, y: -160, gridX: 0, gridY: 0, format: 0, data: new Uint8Array([1, 1, 5, 0, 0]) }];
    // 셀 (3,0): 깊이 19.9 → 플레이어 (0.5,2.5) 깊이 3 보다 앞. 화면 x 차 = (3-0)*80 - (0-2)*... = 셀 (0,0) 기준 +240px
    const lv = level([], 6, 6, [{ x: 3, y: 0, orientation: 1, tileIndex: 2 }]);
    lv.tiles[2] = wall;
    const r = new WorldRenderer(lv);
    const a = fakeSink();
    r.render(a.sink, { x: 2.5, y: 2.5, width: 800, height: 600 }, [], { x: 2.5, y: 2.5 });
    expect(a.drawn.find((x) => x.id.endsWith(':2'))?.blend).toBeUndefined();
    expect(r.wallsFaded).toBe(0);
    expect(r.wallsFadedAt(2.5, 2.5, 800, 600)).toBe(0);
  });

  it('roofGroupAt: 서브타일 → 셀 (÷5), 범위 밖은 0', () => {
    const r = new WorldRenderer(level(roofCells));
    expect(r.roofGroupAt(7, 7)).toBe(1);
    expect(r.roofGroupAt(14.9, 5)).toBe(1);
    expect(r.roofGroupAt(22, 22)).toBe(2);
    expect(r.roofGroupAt(0, 0)).toBe(0);
    expect(r.roofGroupAt(-1, 0)).toBe(0);
    expect(r.roofGroupAt(30, 30)).toBe(0);
  });
});
