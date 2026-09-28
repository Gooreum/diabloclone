import { describe, expect, it } from 'vitest';
import { gameChain, hasGameData, mustRead } from '../support/gamedata';
import { parseDt1, renderTile } from '../../src/formats/dt1';
import { floorTileRefs, normalizeDs1File, parseDs1 } from '../../src/formats/ds1';

describe('합성 입력', () => {
  it('DT1 버전이 7.6 이 아니면 에러', () => {
    expect(() => parseDt1(new Uint8Array(300))).toThrow(/version/);
  });
  it('DS1 경로 정규화', () => {
    expect(normalizeDs1File('/d2/data/global/tiles/ACT1/TOWN/floor.tg1')).toBe('data\\global\\tiles\\ACT1\\TOWN\\floor.dt1');
  });
  it('잘린 DS1 은 에러', () => {
    expect(() => parseDs1(new Uint8Array(6))).toThrow(/truncated/);
  });
});

describe.skipIf(!hasGameData)('실제 원작 파일', () => {
  const ds1 = () => parseDs1(mustRead('data\\global\\tiles\\ACT1\\TOWN\\townE1.ds1'));

  it('Rogue Encampment townE1.ds1 파싱', () => {
    const d = ds1();
    expect(d.width).toBeGreaterThan(0);
    expect(d.height).toBeGreaterThan(0);
    expect(d.floors.length).toBeGreaterThan(0);
    expect(d.objects.length).toBeGreaterThan(0);
    expect(d.files.some((f) => /floor\.(dt1|tg1)$/i.test(f))).toBe(true);
  });

  it('act1 town floor.dt1: 타일 목록과 블록 디코딩', () => {
    const tiles = parseDt1(mustRead('data\\global\\tiles\\ACT1\\TOWN\\floor.dt1'));
    expect(tiles.length).toBeGreaterThan(0);
    const floor = tiles.find((t) => t.orientation === 0 && t.blocks.length > 0);
    expect(floor).toBeDefined();
    const img = renderTile(floor!);
    expect(img.width).toBe(160);
    expect(img.pixels.some((v) => v !== 0)).toBe(true);
  });

  it('DS1 의 모든 바닥·벽 셀이 참조하는 타일이 DT1 에서 발견된다', () => {
    const d = ds1();
    const keys = new Set<string>();
    for (const f of d.files) {
      const b = gameChain().read(normalizeDs1File(f));
      if (!b) continue;
      for (const t of parseDt1(b)) keys.add(`${t.orientation}:${t.mainIndex}:${t.subIndex}`);
    }
    const missing: string[] = [];
    for (const layer of d.floors) for (const c of layer) if (c.prop1 && !c.hidden && !keys.has(`0:${c.style}:${c.sequence}`)) missing.push(`0:${c.style}:${c.sequence}`);
    for (const layer of d.walls)
      for (const c of layer) if (c.prop1 && !c.hidden && c.orientation !== 0 && !keys.has(`${c.orientation}:${c.style}:${c.sequence}`)) missing.push(`${c.orientation}:${c.style}:${c.sequence}`);
    expect(missing).toEqual([]);
  });

  it('빈 셀(prop1=0)은 렌더 목록에서 제외된다', () => {
    const d = ds1();
    const all = d.floors.flat();
    const empties = all.filter((c) => c.prop1 === 0 || c.hidden).length;
    expect(empties).toBeGreaterThan(0);
    expect(floorTileRefs(d).length).toBe(all.length - empties);
  });
});
