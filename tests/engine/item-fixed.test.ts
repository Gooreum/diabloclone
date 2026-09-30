import { beforeAll, describe, expect, it } from 'vitest';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { MaxRng } from '../../src/engine/rng';
import { statOf, type ItemGen } from '../../src/engine/itemgen';
import { requirements } from '../../src/engine/inventory';
import { gameChain, hasGameData } from '../support/gamedata';

// 개발용 프리셋 아이템: 품질을 정해서 붙이고 가변 옵션은 최대값. 요구치 감소(ease = item_req_percent)
describe.skipIf(!hasGameData)('정해진 품질 아이템 (makeFixed) · 요구치 감소', () => {
  let data: GameData, gen: ItemGen;
  beforeAll(() => {
    data = buildGameData(gameChain(), new GameTables(gameChain()));
    gen = data.treasure.gen as ItemGen;
  });
  const fixed = (code: string, spec: Parameters<ItemGen['makeFixed']>[2]): ItemInstance => {
    const base = data.items.base(code)!;
    const it = data.treasure.createItem(base, 99, new MaxRng(), QUALITY.NORMAL);
    gen.makeFixed(it, base, spec);
    return it;
  };
  const uniqueIdx = (name: string) => gen.uniques.findIndex((u) => u.name === name);

  it('The Ward: 저항 모두 최대 50, 방어 +100%, 유니크·감정됨, 요구 레벨 26, 기본 방어 = maxac + 1', () => {
    const it = fixed('gts', { uniqueIdx: uniqueIdx('The Ward') });
    expect(it.quality).toBe(QUALITY.UNIQUE);
    expect(it.identified).toBe(true);
    expect(it.levelReq).toBe(26);
    for (const r of ['fireresist', 'coldresist', 'lightresist', 'poisonresist']) expect(statOf(it, r)).toBe(50);
    expect(statOf(it, 'item_armor_percent')).toBe(100);
    expect(it.defense).toBe(data.items.base('gts')!.maxAc + 1);
  });

  it('Steeldriver: 요구 힘 = Great Maul 요구 힘의 절반 (item_req_percent −50)', () => {
    const it = fixed('gma', { uniqueIdx: uniqueIdx('Steeldriver') });
    expect(statOf(it, 'item_req_percent')).toBe(-50);
    expect(requirements(data.items, it).str).toBe(Math.trunc(data.items.base('gma')!.reqStr / 2));
  });

  it('요구치 감소가 없는 아이템은 기본 요구치 그대로, 미감정이면 감소를 적용하지 않는다', () => {
    const plain = data.treasure.createItem(data.items.base('gma')!, 30, new MaxRng(), QUALITY.NORMAL);
    expect(requirements(data.items, plain).str).toBe(data.items.base('gma')!.reqStr);
    const sd = fixed('gma', { uniqueIdx: uniqueIdx('Steeldriver') });
    sd.identified = false;
    expect(requirements(data.items, sd).str).toBe(data.items.base('gma')!.reqStr);
  });

  it('레어 접사 지정: Merciless + of Quickness → 대미지 100%, 공속 40, 레어, 요구 레벨 = 접사 levelreq 최대', () => {
    const p = gen.prefixes.find((a) => a.name === 'Merciless' && a.frequency > 0)!;
    const s = gen.suffixes.find((a) => a.name === 'of Quickness' && a.frequency > 0)!;
    const it = fixed('gma', { prefixes: [p.idx], suffixes: [s.idx], rareName: [0, 0] });
    expect(it.quality).toBe(QUALITY.RARE);
    expect(statOf(it, 'item_maxdamage_percent')).toBe(100);
    expect(statOf(it, 'item_fasterattackrate')).toBe(40);
    expect(it.levelReq).toBe(Math.max(data.items.base('gma')!.levelReq, p.levelReq, s.levelReq));
  });
});
