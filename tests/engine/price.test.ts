import { beforeAll, describe, expect, it } from 'vitest';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { isBroken, isRepairable, transactionCost, type PriceCtx } from '../../src/engine/price';
import { computeDerived } from '../../src/engine/charstats';
import { classStats, createCharacter } from '../../src/engine/player';
import { gameChain, hasGameData } from '../support/gamedata';

// 출처: D2MOO D2Common/src/Items/Items.cpp ITEMS_CalculateTransactionCost, npc.txt (charsi buy 512 / sell 960 / rep 128 / max buy 5000)
describe.skipIf(!hasGameData)('상점 가격 (ITEMS_CalculateTransactionCost)', () => {
  let data: GameData, tables: GameTables, ctx: PriceCtx;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
    ctx = { items: data.items, gen: data.treasure.gen ?? null, npc: data.npcPrices!.get('charsi')!, difficulty: 0, bookCharge: data.bookCharge };
  });
  const make = (code: string, q: number = QUALITY.NORMAL, seed = 1): ItemInstance => {
    data.treasure.droppedUniques.clear();
    return data.treasure.createItem(data.items.base(code)!, 5, new Rng(seed), q as never, true);
  };

  // hax cost 170 (weapons.txt): 사기 170 × 960/1024 = 159, 팔기 170 × 512/1024 = 85
  it('일반 손도끼: 사기 159 · 팔기 85', () => {
    const it = { ...make('hax'), sockets: 0, socketed: [], stats: [], identified: true };
    expect(transactionCost(it, 'buy', ctx)).toBe(Math.trunc((170 * 960) / 1024));
    expect(transactionCost(it, 'sell', ctx)).toBe(Math.trunc((170 * 512) / 1024));
  });

  // cap cost 64, maxac 5: 방어도 비율 cost × ac / maxac
  it('방어구 가격은 기본 방어도 / 최대 방어도 비율', () => {
    const it = { ...make('cap'), stats: [], identified: true, defense: 3 };
    expect(transactionCost(it, 'buy', ctx)).toBe(Math.trunc((Math.trunc((3 * 64) / 5) * 960) / 1024));
  });

  // 수리비: cost × repMult/1024 × (max − dur)/max. 내구 가득이면 0 → 최소 1, 미감정은 수리 불가(0)
  it('수리비는 잃은 내구 비율, 가득 차면 최소 1, 미감정은 0', () => {
    const it = { ...make('hax'), stats: [], identified: true, durability: 14, maxDurability: 28 };
    expect(isRepairable(data.items, it)).toBe(true);
    expect(transactionCost(it, 'repair', ctx)).toBe(Math.trunc((Math.trunc((170 * 14) / 28) * 128) / 1024));
    expect(transactionCost({ ...it, durability: 28 }, 'repair', ctx)).toBe(1);
    expect(transactionCost({ ...it, identified: false }, 'repair', ctx)).toBe(0);
  });

  it('매직·레어는 일반보다 비싸고, 하급은 절반', () => {
    const normal = transactionCost({ ...make('bsd'), stats: [], sockets: 0, socketed: [], identified: true }, 'buy', ctx);
    const magic = make('bsd', QUALITY.MAGIC, 3);
    magic.identified = true;
    expect(transactionCost(magic, 'buy', ctx)).toBeGreaterThan(normal);
    const inferior = { ...make('bsd', QUALITY.INFERIOR, 4), stats: [], identified: true };
    expect(transactionCost(inferior, 'buy', ctx)).toBe(Math.trunc(((data.items.base('bsd')!.cost - Math.trunc(data.items.base('bsd')!.cost / 2)) * 960) / 1024));
  });

  // 팔기 상한: npc.txt max buy (Normal 5000)
  it('팔기 값은 max buy 를 넘지 않는다', () => {
    const it = make('bsd', QUALITY.UNIQUE, 1);
    it.identified = true;
    expect(transactionCost(it, 'sell', { ...ctx, npc: { ...ctx.npc, buyMult: 1024 * 100 } })).toBe(5000);
  });

  // books.txt Identify CostPerCharge × 수량 + ibk cost
  it('감정의 책: cost + 수량 × CostPerCharge', () => {
    const it = { ...make('ibk'), quantity: 10 };
    const per = data.bookCharge!.get('ibk')!;
    expect(transactionCost(it, 'buy', ctx)).toBe(Math.trunc(((200 + 10 * per) * 960) / 1024));
  });

  it('부서진 아이템(내구 0)은 스탯이 적용되지 않는다', () => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    const g = make('hax', QUALITY.UNIQUE, 3);
    data.treasure.droppedUniques.clear();
    const gn = data.treasure.createItem(data.items.base('hax')!, 7, new Rng(3), QUALITY.UNIQUE, true);
    gn.identified = true;
    expect(computeDerived(ch, cs, { rarm: gn }, data.items, data.treasure.gen!).str).toBe(ch.str + 8);
    gn.durability = 0;
    expect(isBroken(gn)).toBe(true);
    expect(computeDerived(ch, cs, { rarm: gn }, data.items, data.treasure.gen!).str).toBe(ch.str);
    void g;
  });
});
