import { beforeAll, describe, expect, it } from 'vitest';
import { Grid, INV_H, INV_W, STASH_H, STASH_W, beltBoxes, beltable, bodyLocsOf, canEquip, type EquipContext } from '../../src/engine/inventory';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { gameChain, hasGameData } from '../support/gamedata';

const dummy = (id: number, w: number, h: number): ItemInstance => ({
  id, code: 'x', quality: QUALITY.NORMAL, ilvl: 1, identified: true, quantity: 1, durability: 0, maxDurability: 0, defense: 0,
  invW: w, invH: h, levelReq: 0, prefixes: [], suffixes: [], sockets: 0, socketed: [], stats: [],
});

// 출처: inventory.txt — 캐릭터 gridX 10 gridY 4, Bank Page 1 gridX 6 gridY 4
describe('격자 (inventory.txt)', () => {
  it('인벤토리 10×4, 창고 6×4', () => {
    expect([INV_W, INV_H, STASH_W, STASH_H]).toEqual([10, 4, 6, 4]);
  });
  it('겹치지 않게 놓고, 경계 밖·겹침은 거부', () => {
    const g = new Grid(INV_W, INV_H);
    const sword = dummy(1, 1, 3), armor = dummy(2, 2, 3);
    expect(g.add(sword, 0, 0)).toBe(true);
    expect(g.add(armor, 0, 0)).toBe(false);
    expect(g.add(armor, 9, 0)).toBe(false);
    expect(g.add(armor, 1, 0)).toBe(true);
    expect(g.at(2, 2)?.item).toBe(armor);
    expect(g.overlapping(dummy(3, 2, 2), 0, 2).map((p) => p.item.id).sort()).toEqual([1, 2]);
  });
  it('빈 자리 찾기는 열 우선(위→아래, 왼쪽→오른쪽), 꽉 차면 null', () => {
    const g = new Grid(2, 2);
    const a = dummy(1, 1, 1), b = dummy(2, 1, 1);
    g.autoAdd(a);
    g.autoAdd(b);
    expect(g.items.map((p) => [p.x, p.y])).toEqual([[0, 0], [0, 1]]);
    expect(g.findSpace(dummy(3, 2, 1))).toBeNull();
    expect(g.findSpace(dummy(4, 1, 2))).toEqual({ x: 1, y: 0 });
  });
});

describe.skipIf(!hasGameData)('장착 규칙 (itemtypes.txt BodyLoc, weapons.txt 2handed, 요구치)', () => {
  let data: GameData;
  beforeAll(() => {
    data = buildGameData(gameChain(), new GameTables(gameChain()));
  });
  const make = (code: string) => data.treasure.createItem(data.items.base(code)!, 1, new Rng(1), QUALITY.NORMAL);
  const ctx = (over: Partial<EquipContext> = {}): EquipContext => ({ items: data.items, cls: 'Amazon', level: 30, str: 100, dex: 100, equipment: {}, ...over });

  it('타입별 장착 위치: 투구 head, 반지 rrin/lrin, 방패·무기 rarm/larm, 벨트 belt', () => {
    expect(bodyLocsOf(data.items, data.items.base('cap')!)).toEqual(['head']);
    expect(bodyLocsOf(data.items, data.items.base('rin')!)).toEqual(['rrin', 'lrin']);
    expect(bodyLocsOf(data.items, data.items.base('buc')!)).toEqual(['rarm', 'larm']);
    expect(bodyLocsOf(data.items, data.items.base('lbl')!)).toEqual(['belt']);
    expect(canEquip(ctx(), make('cap'), 'tors')).toBe('slot');
  });
  // 출처: weapons.txt Broad Sword reqstr 48, armor.txt Quilted Armor reqstr 12
  it('요구 힘이 모자라면 불가', () => {
    expect(canEquip(ctx({ str: 47 }), make('bsd'), 'rarm')).toBe('str');
    expect(canEquip(ctx({ str: 48 }), make('bsd'), 'rarm')).toBeNull();
  });
  it('양손 무기(활)와 방패는 함께 못 들고, 화살통은 된다', () => {
    const bow = make('sbw');
    expect(canEquip(ctx({ equipment: { rarm: bow } }), make('buc'), 'larm')).toBe('twohand');
    expect(canEquip(ctx({ equipment: { rarm: bow } }), make('aqv'), 'larm')).toBeNull();
  });
  it('무기 두 개는 바바리안만, 바바리안은 1or2handed 양손검을 한 손에', () => {
    expect(canEquip(ctx({ equipment: { rarm: make('hax') } }), make('ssd'), 'larm')).toBe('dualwield');
    expect(canEquip(ctx({ cls: 'Barbarian', equipment: { rarm: make('hax') } }), make('ssd'), 'larm')).toBeNull();
    // 출처: weapons.txt Two-Handed Sword (2hs) 2handed 1, 1or2handed 1
    expect(canEquip(ctx({ cls: 'Barbarian', equipment: { rarm: make('2hs') } }), make('buc'), 'larm')).toBeNull();
    expect(canEquip(ctx({ cls: 'Paladin', equipment: { rarm: make('2hs') } }), make('buc'), 'larm')).toBe('twohand');
  });
  // 출처: belts.txt — default 4, sash 8, girdle 16
  it('벨트 칸: 없음 4, Sash 8, Girdle 16. 물약·두루마리만 벨트에', () => {
    expect(beltBoxes(data.items, undefined)).toBe(4);
    expect(beltBoxes(data.items, make('lbl'))).toBe(8);
    expect(beltBoxes(data.items, make('hbl'))).toBe(16);
    expect(beltable(data.items, make('hp1'))).toBe(true);
    expect(beltable(data.items, make('isc'))).toBe(true);
    expect(beltable(data.items, make('cap'))).toBe(false);
  });
});

// 출처: gems.txt Chipped Ruby (gcr) — weaponMod fire-min/max 3~4, helmMod hp 10, shieldMod res-fire 12
describe.skipIf(!hasGameData)('소켓에 보석 박기 (gems.txt)', () => {
  let data: GameData;
  beforeAll(() => {
    data = buildGameData(gameChain(), new GameTables(gameChain()));
  });
  it('깨진 루비: 투구 생명 +10 / 방패 화염 저항 12 / 무기 화염 3~4, 소켓이 차면 더 못 박음', async () => {
    const { ItemStore } = await import('../../src/engine/itemstore');
    const { gemStats } = await import('../../src/engine/itemgen');
    const gen = data.treasure.gen!;
    const mk = (code: string, sockets: number) => ({ ...data.treasure.createItem(data.items.base(code)!, 1, new Rng(1), QUALITY.NORMAL), sockets });
    const cap = mk('cap', 1), gem1 = mk('gcr', 0), gem2 = mk('gcr', 0);
    const asPairs = (code: string) => gemStats(gen, gem1, data.items.base(code)!).map((s) => [s.stat, s.value]);
    expect(asPairs('cap')).toEqual([['maxhp', 10]]);
    expect(asPairs('buc')).toEqual([['fireresist', 12]]);
    expect(asPairs('hax')).toEqual([['firemindam', 3], ['firemaxdam', 4]]);
    const store = new ItemStore(data.items, { inventory: [{ item: cap, x: 0, y: 0 }, { item: gem1, x: 3, y: 0 }, { item: gem2, x: 4, y: 0 }] });
    expect(store.move(gem1.id, { kind: 'socket', itemId: cap.id }).ok).toBe(true);
    expect(cap.socketed).toHaveLength(1);
    expect(store.find(gem1.id)).toBeNull();
    expect(store.move(gem2.id, { kind: 'socket', itemId: cap.id }).ok).toBe(false);
  });
});
