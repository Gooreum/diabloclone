// 내구도·수량 경고 판정 (사용자 신고: 내구도가 다 떨어져도 신호가 없다)
// 출처: Arreat Summit basics (오른쪽 위 실루엣, 낮으면 노랑·0 이면 빨강) · Amazon Basin wiki Durability (< 21%) · 원작 invwarn.DC6 (8 종류 × 3 색)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { ItemStore } from '../../src/engine/itemstore';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { invWarnings, warnKind, WARN_KIND } from '../../src/ui/invwarn';
import { ItemText } from '../../src/ui/itemtext';

let tables: GameTables;
let data: GameData;
const rng = new Rng(5);
beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables, { expansion: true });
});

function make(code: string, durability?: number, quantity?: number): ItemInstance {
  const it = data.treasure.createItem(data.items.base(code)!, 1, rng, QUALITY.NORMAL);
  if (durability !== undefined) it.durability = durability;
  if (quantity !== undefined) it.quantity = quantity;
  return it;
}
const kind = (code: string) => warnKind(data.items, data.items.base(code)!);
const storeWith = (equipment: Record<string, ItemInstance>) => new ItemStore(data.items, { equipment });

describe.skipIf(!hasGameData)('invwarn 종류 (warnKind)', () => {
  it('TC-1: 도끼·방패·갑옷·투구·화살·볼트·투창·투척 물약', () => {
    expect(kind('hax')).toBe(WARN_KIND.weapon);
    expect(kind('buc')).toBe(WARN_KIND.shield);
    expect(kind('qui')).toBe(WARN_KIND.armor);
    expect(kind('cap')).toBe(WARN_KIND.helm);
    expect(kind('aqv')).toBe(WARN_KIND.arrows);
    expect(kind('cqv')).toBe(WARN_KIND.bolts);
    expect(kind('jav')).toBe(WARN_KIND.throw);
    expect(kind('opl')).toBe(WARN_KIND.tpot);
  });
  it('TC-2: 반지·물약은 종류 없음', () => {
    expect(kind('rin')).toBeNull();
    expect(kind('hp1')).toBeNull();
  });
  it('TC-3: 확장팩 직업 장비는 itemtypes Equiv 사슬로 투구·방패', () => {
    expect(kind('dr1')).toBe(WARN_KIND.helm);
    expect(kind('ba1')).toBe(WARN_KIND.helm);
    expect(kind('pa1')).toBe(WARN_KIND.shield);
    expect(kind('ne1')).toBe(WARN_KIND.shield);
  });
});

describe.skipIf(!hasGameData)('invwarn 경고 목록 (invWarnings)', () => {
  it('TC-4: 내구도가 21% 이상이면 경고 없음', () => {
    const w = make('hax');
    w.durability = Math.ceil(w.maxDurability * 0.21);
    expect(invWarnings(storeWith({ rarm: w }), data.items)).toEqual([]);
  });
  it('TC-5: 내구도가 21% 미만이면 노랑 (무기 frame 12)', () => {
    const w = make('hax');
    w.durability = Math.floor(w.maxDurability * 0.2);
    expect(invWarnings(storeWith({ rarm: w }), data.items)).toEqual([{ slot: 'rarm', frame: 12, level: 0 }]);
  });
  it('TC-6: 내구도 0 이면 빨강 (무기 frame 14)', () => {
    expect(invWarnings(storeWith({ rarm: make('hax', 0) }), data.items)).toEqual([{ slot: 'rarm', frame: 14, level: 2 }]);
  });
  it('TC-7: 머리·몸통·오른손·왼손 순서, 종류별 프레임', () => {
    const w = make('hax');
    w.durability = 1;
    const out = invWarnings(storeWith({ head: make('cap', 0), tors: make('qui', 0), rarm: w, larm: make('buc', 0) }), data.items);
    expect(out.map((x) => x.slot)).toEqual(['head', 'tors', 'rarm', 'larm']);
    expect(out.map((x) => x.frame)).toEqual([23, 20, 12, 17]);
  });
  it('TC-8: 반지·벨트·신발·장갑은 내구도 0 이어도 아이콘 없음 (원작 DC6 에 종류 없음)', () => {
    const st = storeWith({ belt: make('lbl', 0), feet: make('lbt', 0), glov: make('lgl', 0), rrin: make('rin') });
    expect(invWarnings(st, data.items)).toEqual([]);
  });
  it('TC-9: 화살 수량이 21% 미만이면 노랑 (frame 0), 아니면 없음', () => {
    const max = data.items.base('aqv')!.maxStack;
    expect(max).toBeGreaterThan(0);
    expect(invWarnings(storeWith({ larm: make('aqv', undefined, Math.floor(max * 0.2)) }), data.items)).toEqual([{ slot: 'larm', frame: 0, level: 0 }]);
    expect(invWarnings(storeWith({ larm: make('aqv', undefined, Math.ceil(max * 0.5)) }), data.items)).toEqual([]);
  });
});

describe.skipIf(!hasGameData)('툴팁: 부서진 아이템 이름은 빨강', () => {
  const text = () => new ItemText(data.items, data.treasure.gen!, (k) => tables.string(k), tables.table('ItemStatCost'), tables.table('charstats'), tables.table('skills'), tables.table('skilldesc'));
  const ctx = { level: 1, str: 30, dex: 20, cls: 'barbarian' };
  it('TC-1: 내구도 0 → #ff5050', () => {
    expect(text().lines(make('cap', 0), ctx)[0]?.color).toBe('#ff5050');
  });
  it('TC-2: 멀쩡하면 품질 색 그대로', () => {
    const c = text().lines(make('cap'), ctx)[0]?.color;
    expect(c).not.toBe('#ff5050');
    expect(c?.toLowerCase()).toMatch(/^#f/);
  });
});
