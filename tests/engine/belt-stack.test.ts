// 벨트 칸 규칙·책 채우기·묶음 합치기 (사용자 신고: Shift+클릭 벨트 적재, 두루마리를 책에 넣기)
// 출처: D2MOO INVENTORY_GetFreeBeltSlot · ITEMS_ComparePotionTypes · ITEMS_CheckIfAutoBeltable · INVENTORY_FindFillableBook ·
//       sub_6FC49AE0 (ScrollToBook) · sub_6FC484E0 (StackItems) · ItemMode.cpp:1173 (줍기) · Rcv0x63_ShiftLeftClickItemToBelt
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { ItemStore, samePotionKind } from '../../src/engine/itemstore';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance, type Quality } from '../../src/engine/treasure';

let tables: GameTables;
let data: GameData;
const rng = new Rng(3);
beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables, { expansion: true });
});

function make(code: string, quantity?: number, quality: Quality = QUALITY.NORMAL): ItemInstance {
  const it = data.treasure.createItem(data.items.base(code)!, 1, rng, quality);
  if (quantity !== undefined) it.quantity = quantity;
  return it;
}

/** 아래 줄부터 벨트를 채운 저장소 (null = 빈 칸). 장착 벨트 없음 → 4칸 */
function storeWith(belt: (string | null)[], beltItem?: string): ItemStore {
  return new ItemStore(data.items, {
    belt: belt.map((c) => (c ? make(c) : null)),
    ...(beltItem ? { equipment: { belt: make(beltItem) } } : {}),
  });
}

describe.skipIf(!hasGameData)('벨트 칸 규칙 (INVENTORY_GetFreeBeltSlot)', () => {
  it('같은 종류: 같은 코드, 생명끼리, 마나끼리, 회복끼리', () => {
    expect(samePotionKind(make('hp1'), make('hp5'))).toBe(true);
    expect(samePotionKind(make('mp2'), make('mp3'))).toBe(true);
    expect(samePotionKind(make('rvl'), make('rvs'))).toBe(true);
    expect(samePotionKind(make('hp1'), make('mp1'))).toBe(false);
    expect(samePotionKind(make('isc'), make('isc'))).toBe(true);
    expect(samePotionKind(make('isc'), make('tsc'))).toBe(false);
  });
  it('TC-1·2: 아래 줄 [hp1, mp1, -, -] + 8칸 벨트 — hp3 → 4, mp2 → 5 (같은 종류 열 위)', () => {
    const st = storeWith(['hp1', 'mp1', null, null], 'lbl');
    expect(st.beltCapacity()).toBe(8);
    expect(st.freeBeltSlot(make('hp3'))).toBe(4);
    expect(st.freeBeltSlot(make('mp2'))).toBe(5);
  });
  it('TC-3: 같은 종류 열이 없는 autobelt 물약(rvs) → 아래 줄 첫 빈 칸 2', () => {
    const st = storeWith(['hp1', 'mp1', null, null], 'lbl');
    expect(data.items.base('rvs')?.autoBelt).toBe(true);
    expect(st.freeBeltSlot(make('rvs'))).toBe(2);
  });
  it('TC-4: 생명 열이 꽉 차면 autobelt 규칙으로 아래 줄 첫 빈 칸', () => {
    // 8칸: 0열 hp1 ×2 (0, 4) 꽉 찼고 1열은 비었다
    const st = storeWith(['hp1', null, 'mp1', null, 'hp1', null, null, null], 'lbl');
    expect(st.freeBeltSlot(make('hp2'))).toBe(1);
  });
  it('TC-5: 두루마리는 autobelt 가 아니라 같은 두루마리 열이 없으면 null, 있으면 그 열 위', () => {
    expect(data.items.base('isc')?.autoBelt).toBe(false);
    expect(storeWith(['hp1', null, null, null], 'lbl').freeBeltSlot(make('isc'))).toBeNull();
    expect(storeWith(['isc', null, null, null], 'lbl').freeBeltSlot(make('isc'))).toBe(4);
  });
  it('TC-6: 1×1 이 아니거나 벨트용이 아니면 null', () => {
    const st = storeWith([null, null, null, null]);
    expect(st.freeBeltSlot(make('cap'))).toBeNull();
    expect(st.freeBeltSlot(make('key'))).toBeNull();
  });
  it('벨트가 꽉 차면 null', () => {
    expect(storeWith(['hp1', 'hp1', 'hp1', 'hp1']).freeBeltSlot(make('hp1'))).toBeNull();
  });
});

describe.skipIf(!hasGameData)('줍기 자동 벨트 (ITEMS_CheckIfAutoBeltable)', () => {
  it('TC-7: 두루마리는 벨트에 같은 두루마리가 있어도 인벤토리로', () => {
    const st = storeWith(['isc', null, null, null], 'lbl');
    const isc = make('isc');
    expect(st.autoBeltable(isc)).toBe(false);
    expect(st.store(isc)).toBe(true);
    expect(st.belt.includes(isc)).toBe(false);
    expect(st.inv.items.map((p) => p.item)).toContain(isc);
  });
  it('TC-8: hp1 을 주우면 아래 줄 hp2 열 위로 (autobelt 이면서 같은 종류 열 우선)', () => {
    const st = storeWith([null, 'hp2', null, null], 'lbl');
    const hp1 = make('hp1');
    expect(st.store(hp1)).toBe(true);
    expect(st.belt[5]).toBe(hp1);
  });
  it('autobelt 가 아닌 물약(해독 yps)은 같은 종류가 벨트에 있을 때만 벨트로', () => {
    expect(data.items.base('yps')?.autoBelt).toBe(false);
    const st1 = storeWith([null, null, null, null]);
    const a = make('yps');
    st1.store(a);
    expect(st1.belt.includes(a)).toBe(false);
    const st2 = storeWith(['yps', null, null, null], 'lbl');
    const b = make('yps');
    st2.store(b);
    expect(st2.belt[4]).toBe(b);
  });
});

describe.skipIf(!hasGameData)('묶음 합치기 (StackItems · ScrollToBook)', () => {
  function withInv(items: ItemInstance[], cursor?: ItemInstance): ItemStore {
    const st = new ItemStore(data.items);
    for (const it of items) st.inv.autoAdd(it);
    if (cursor) st.cursor = cursor;
    return st;
  }
  it('TC-9: 커서의 tsc 를 tbk(3) 에 → 1, 책 4, 두루마리 사라짐', () => {
    const tbk = make('tbk', 3), tsc = make('tsc');
    const st = withInv([tbk], tsc);
    expect(st.stackable(tsc, tbk)).toBe(true);
    expect(st.stackInto(tsc.id, tbk.id)).toBe(1);
    expect(tbk.quantity).toBe(4);
    expect(st.cursor).toBeNull();
    expect(st.find(tsc.id)).toBeNull();
  });
  it('TC-10: 꽉 찬 책에는 0, 그대로', () => {
    const max = data.items.base('tbk')!.maxStack;
    const tbk = make('tbk', max), tsc = make('tsc');
    const st = withInv([tbk], tsc);
    expect(st.stackInto(tsc.id, tbk.id)).toBe(0);
    expect(tbk.quantity).toBe(max);
    expect(st.cursor).toBe(tsc);
  });
  it('TC-11: isc 를 tbk 에 → 0 (종류 불일치)', () => {
    const tbk = make('tbk', 3), isc = make('isc');
    const st = withInv([tbk], isc);
    expect(st.stackable(isc, tbk)).toBe(false);
    expect(st.stackInto(isc.id, tbk.id)).toBe(0);
  });
  it('TC-12: key 5 + key 8 (maxstack 12) → 4 옮기고 대상 12, 커서 1', () => {
    expect(data.items.base('key')!.maxStack).toBe(12);
    const dst = make('key', 8), src = make('key', 5);
    const st = withInv([dst], src);
    expect(st.stackInto(src.id, dst.id)).toBe(4);
    expect(dst.quantity).toBe(12);
    expect(src.quantity).toBe(1);
    expect(st.cursor).toBe(src);
  });
  it('key 3 + key 2 → 전부 합쳐지고 커서 비움', () => {
    const dst = make('key', 2), src = make('key', 3);
    const st = withInv([dst], src);
    expect(st.stackInto(src.id, dst.id)).toBe(3);
    expect(dst.quantity).toBe(5);
    expect(st.cursor).toBeNull();
  });
  it('TC-13: 같은 코드라도 등급이 다른 투창은 합치지 않는다', () => {
    const a = make('jav', 10), b = make('jav', 10, QUALITY.MAGIC);
    const st = withInv([a], b);
    expect(st.stackable(b, a)).toBe(false);
    expect(st.stackInto(b.id, a.id)).toBe(0);
  });
  it('묶음이 아닌 아이템(cap)·소켓 있는 묶음은 합치지 않는다', () => {
    const st = withInv([make('cap')], make('cap'));
    expect(st.stackInto(st.cursor!.id, st.inv.items[0]!.item.id)).toBe(0);
    const a = make('jav', 10), b = make('jav', 10);
    a.sockets = 1;
    expect(new ItemStore(data.items).stackable(b, a)).toBe(false);
  });
  it('fillableBook: 수량이 남은 같은 종류 책만, 없으면 null', () => {
    const full = make('ibk', data.items.base('ibk')!.maxStack), part = make('ibk', 2), tbk = make('tbk', 1);
    const st = withInv([full, part, tbk]);
    expect(st.fillableBook('isc')).toBe(part);
    expect(st.fillableBook('ibk')).toBe(part);
    expect(st.fillableBook('tsc')).toBe(tbk);
    expect(withInv([full]).fillableBook('isc')).toBeNull();
    expect(st.fillableBook('hp1')).toBeNull();
  });
});

// ---------------------------------------------------------------- Game 명령 (Phase 1 Step 2)

function setup(opts: { inventory?: ItemInstance[]; belt?: (ItemInstance | null)[] } = {}) {
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const ch = createCharacter(cs);
  ch.level = 10;
  const game = new Game({
    map: new CollisionMap(40, 40), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 5, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), inTown: true,
    ...(opts.inventory ? { inventory: opts.inventory } : {}), ...(opts.belt ? { belt: opts.belt } : {}),
  });
  game.tick();
  return game;
}

const groundOf = (game: Game) => (game as unknown as { ground: { item: ItemInstance }[] }).ground;

function run(game: Game, ticks = 2): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) ev.push(...game.tick());
  return ev;
}

describe.skipIf(!hasGameData)('명령: toBelt (Shift+클릭) · stackItem', () => {
  it('toBelt: 인벤토리 hp1 이 벨트 빈 칸(같은 종류 열 위)으로, itemMoved 사건', () => {
    const hp = make('hp1');
    // 초기 inventory 는 줍기 규칙(store)으로 들어가 벨트로 가 버리니 격자에 직접 둔다
    const game = setup({ belt: [make('hp1'), null, null, null] });
    game.store.inv.autoAdd(hp);
    game.enqueue({ type: 'toBelt', itemId: hp.id });
    const ev = run(game);
    expect(ev.some((e) => e.type === 'itemMoved' && e.to === 'belt')).toBe(true);
    // 벨트 없음 → 4칸이라 0열 위(4)는 없고 아래 줄 첫 빈 칸 1
    expect(game.store.belt[1]).toBe(hp);
    expect(game.store.inv.items.length).toBe(0);
  });
  it('toBelt: 커서에 든 게 있으면 itemMoveFailed, 움직이지 않음', () => {
    const hp = make('hp1');
    const game = setup();
    game.store.inv.autoAdd(hp);
    game.store.cursor = make('cap');
    game.enqueue({ type: 'toBelt', itemId: hp.id });
    const ev = run(game);
    expect(ev.some((e) => e.type === 'itemMoveFailed')).toBe(true);
    expect(game.store.find(hp.id)?.where.kind).toBe('inventory');
  });
  it('toBelt: 빈 칸이 없으면 조용히 무시 (원작)', () => {
    const hp = make('hp1');
    const game = setup({ belt: [make('hp1'), make('hp1'), make('hp1'), make('hp1')] });
    game.store.inv.autoAdd(hp);
    game.enqueue({ type: 'toBelt', itemId: hp.id });
    const ev = run(game);
    expect(ev.filter((e) => e.type === 'itemMoved' || e.type === 'itemMoveFailed')).toEqual([]);
    expect(game.store.find(hp.id)?.where.kind).toBe('inventory');
  });
  it('toBelt: 벨트용이 아닌 아이템(cap)은 무시', () => {
    const cap = make('cap');
    const game = setup({ inventory: [cap] });
    game.enqueue({ type: 'toBelt', itemId: cap.id });
    run(game);
    expect(game.store.find(cap.id)?.where.kind).toBe('inventory');
  });
  it('stackItem: 커서 tsc → tbk +1, itemStacked 사건', () => {
    const tbk = make('tbk', 3), tsc = make('tsc');
    const game = setup({ inventory: [tbk] });
    game.store.cursor = tsc;
    game.enqueue({ type: 'stackItem', itemId: tsc.id, targetId: tbk.id });
    const ev = run(game);
    expect(ev.some((e) => e.type === 'itemStacked' && e.itemId === tbk.id && e.count === 1)).toBe(true);
    expect(tbk.quantity).toBe(4);
    expect(game.store.cursor).toBeNull();
  });
});

describe.skipIf(!hasGameData)('줍기: 두루마리·책은 가진 책에 (ItemMode.cpp:1173)', () => {
  function drop(game: Game, it: ItemInstance): void {
    (game as unknown as { dropItem(it: ItemInstance, x: number, y: number): void }).dropItem(it, 20.5, 20.5);
  }
  function pick(game: Game, it: ItemInstance): GameEvent[] {
    game.enqueue({ type: 'pickup', itemId: it.id });
    return run(game, 30);
  }
  it('tsc 를 주우면 tbk +1, 땅에서 사라지고 인벤토리에 tsc 없음', () => {
    const tbk = make('tbk', 3), tsc = make('tsc');
    const game = setup({ inventory: [tbk] });
    drop(game, tsc);
    const ev = pick(game, tsc);
    expect(tbk.quantity).toBe(4);
    expect(groundOf(game).find((g) => g.item.id === tsc.id)).toBeUndefined();
    expect(game.store.find(tsc.id)).toBeNull();
    expect(ev.some((e) => e.type === 'itemPickup' && e.code === 'tsc')).toBe(true);
  });
  it('책이 꽉 찼으면 tsc 는 그냥 인벤토리로', () => {
    const max = data.items.base('tbk')!.maxStack;
    const tbk = make('tbk', max), tsc = make('tsc');
    const game = setup({ inventory: [tbk] });
    drop(game, tsc);
    pick(game, tsc);
    expect(tbk.quantity).toBe(max);
    expect(game.store.find(tsc.id)?.where.kind).toBe('inventory');
  });
  it('tbk(5) 를 주우면 가진 tbk(3) 에 합쳐 8, 주운 책 사라짐', () => {
    const mine = make('tbk', 3), found = make('tbk', 5);
    const game = setup({ inventory: [mine] });
    drop(game, found);
    pick(game, found);
    expect(mine.quantity).toBe(8);
    expect(game.store.find(found.id)).toBeNull();
    expect(groundOf(game).find((g) => g.item.id === found.id)).toBeUndefined();
  });
  it('넘치면 가진 책 = maxstack, 땅의 책은 나머지 수량으로 남는다 (sub_6FC43BF0)', () => {
    const max = data.items.base('tbk')!.maxStack;
    const mine = make('tbk', max - 2), found = make('tbk', 5);
    const game = setup({ inventory: [mine] });
    drop(game, found);
    pick(game, found);
    expect(mine.quantity).toBe(max);
    expect(found.quantity).toBe(3);
    expect(groundOf(game).find((g) => g.item.id === found.id)).toBeDefined();
    expect(game.store.find(found.id)).toBeNull();
  });
  it('hp1 을 주우면 원작 벨트 규칙 (아래 줄 hp2 열 위)', () => {
    const hp1 = make('hp1');
    const game = setup({ belt: [null, make('hp2'), null, null] });
    game.store.equipment.belt = make('lbl');
    drop(game, hp1);
    pick(game, hp1);
    expect(game.store.belt[5]).toBe(hp1);
  });
});
