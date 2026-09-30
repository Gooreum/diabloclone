import { describe, expect, it } from 'vitest';
import { FULL_LIGHT, LightTables, PLAYER_LIGHT, ambientOf, lightAt, lightSources } from '../../src/engine/lighting';
import { parseTxt } from '../../src/formats/txt';
import { hasGameData, mustRead } from '../support/gamedata';

describe('조명 계산', () => {
  it('주변광: 실내 0, 야외·마을 31', () => {
    expect(ambientOf(true)).toBe(0);
    expect(ambientOf(false)).toBe(FULL_LIGHT);
    // 낮·밤 밝기 매핑: 128 이상 = 31, 한밤 64 = 22, 일식 32 = 16, 불꽃의 강 16 = 11, 0 = 0
    expect([255, 128, 64, 32, 16, 0].map((i) => ambientOf(false, i))).toEqual([31, 31, 22, 16, 11, 0]);
    expect(ambientOf(true, 255)).toBe(0);
  });
  it('lightAt: 광원 중심 31, 반경 끝 0, 반경 밖은 주변광', () => {
    const src = [{ x: 10, y: 10, r: 10 }];
    expect(lightAt(0, src, 10, 10)).toBe(31);
    expect(lightAt(0, src, 20, 10)).toBe(0);
    expect(lightAt(0, src, 15, 10)).toBe(16);
    expect(lightAt(0, src, 40, 40)).toBe(0);
    expect(lightAt(31, src, 40, 40)).toBe(31);
  });
  it('lightAt: 여러 광원은 가장 밝은 것, 반경 0 광원과 빈 목록은 무시', () => {
    const src = [{ x: 0, y: 0, r: 4 }, { x: 2, y: 0, r: 10 }, { x: 5, y: 5, r: 0 }];
    expect(lightAt(0, src, 2, 0)).toBe(31);
    expect(lightAt(0, [], 3, 3)).toBe(0);
    expect(lightAt(0, src, 5, 5)).toBeGreaterThan(0);
  });
  it('lightSources: 플레이어·빛 있는 몬스터·미사일·오브젝트만, 시체(DD)는 뺀다', () => {
    const t = new LightTables({
      levels: [{ Id: '8', IsInside: '1' }],
      monStats: [{ Id: 'andariel', MonStatsEx: 'andariel' }, { Id: 'zombie1', MonStatsEx: 'zombie1' }],
      monStats2: [{ Id: 'andariel', Light: '8', Shadow: '1' }, { Id: 'zombie1', Light: '', Shadow: '0' }],
      missiles: [{ Missile: 'firebolt', Light: '7' }, { Missile: 'arrow', Light: '' }],
      objects: [{ Id: '37', Lit0: '19', Lit1: '0' }],
    });
    const src = lightSources({
      player: { x: 1, y: 1 },
      monsters: [{ typeId: 'andariel', x: 5, y: 5, mode: 'NU' }, { typeId: 'andariel', x: 9, y: 9, mode: 'DD' }, { typeId: 'zombie1', x: 3, y: 3, mode: 'WL' }],
      missiles: [{ name: 'firebolt', x: 2, y: 2 }, { name: 'arrow', x: 4, y: 4 }],
      objects: [{ classId: 37, mode: 0, x: 7, y: 7 }, { classId: 37, mode: 1, x: 8, y: 8 }],
    }, t, PLAYER_LIGHT + 2);
    expect(src).toEqual([{ x: 1, y: 1, r: 15 }, { x: 5, y: 5, r: 8 }, { x: 2, y: 2, r: 7 }, { x: 7, y: 7, r: 9.5 }]);
    expect(t.isInside(8)).toBe(true);
    expect(t.isInside(999)).toBe(false);
    expect(t.monsterShadow('zombie1')).toBe(false);
    expect(t.monsterShadow('unknown')).toBe(true);
  });
});

describe.skipIf(!hasGameData)('조명 (원작 표)', () => {
  const tbl = (n: string) => parseTxt(new TextDecoder().decode(mustRead(`data\\global\\excel\\${n}.txt`)));
  it('Den of Evil(8)·지하묘지는 실내, 로그 야영지(1)·Blood Moor(2) 는 야외, 원작 빛 반경', () => {
    const t = new LightTables({ levels: tbl('Levels'), monStats: tbl('MonStats'), monStats2: tbl('MonStats2'), missiles: tbl('Missiles'), objects: tbl('Objects') });
    expect([t.isInside(8), t.isInside(18), t.isInside(1), t.isInside(2), t.isInside(40)]).toEqual([true, true, false, false, false]);
    expect(t.monsterLight('andariel')).toBe(8);
    expect(t.monsterLight('zombie1')).toBe(0);
    expect(t.monsterShadow('zombie1')).toBe(true);
    expect(t.missileLight('firebolt')).toBe(7);
    expect(t.missileLight('frozenorb')).toBe(6);
    expect(t.missileLight('arrow')).toBe(0);
  });
});
