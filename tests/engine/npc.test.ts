// 마을 NPC·상점·도박·치료·감정 — 기대값 출처: misc.txt / weapons.txt cost, npc.txt (Akara sell mult 1024, Charsi buy mult 512 · rep mult 128,
// Gheed sell mult 1088), gamble cost (rin 50000), D2MOO D2Game/src/UNIT/SUnitNpc.cpp (sub_6FCC88B0 사기, D2GAME_STORES_SellItem 팔기,
// D2GAME_NPC_Repair 수리, D2GAME_NPC_HealPlayer 치료, D2GAME_NPC_IdentifyAllItems 감정), SUnitProxy.cpp SUNITPROXY_UpdateVendorInventory (재고 초기화)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World, type Act1GameWorld } from '../../src/data/act1-world';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { nearestWalkable } from '../../src/engine/path';
import { QUALITY, type ItemInstance, type Quality } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { gambleCost, transactionCost } from '../../src/engine/price';
import type { MonsterUnit } from '../../src/engine/ai';

const d = hasGameData ? describe : describe.skip;

let tables: GameTables;
let data: GameData;
let world: Act1GameWorld;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
  world = buildAct1World(gameChain(), tables, data, 4242);
});

function makeGame(opts: { level?: number; gold?: number; stashGold?: number; seed?: number } = {}): Game {
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 1;
  // 레벨 정의(맵)는 게임마다 새로 만든다 (NPC·오브젝트 충돌이 맵에 기록되므로)
  const w = buildAct1World(gameChain(), tables, data, opts.seed ?? 4242);
  const g = new Game({
    map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), seed: opts.seed ?? 4242, data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), gold: opts.gold ?? 0, stashGold: opts.stashGold ?? 0,
  });
  g.tick();
  return g;
}

const npcOf = (g: Game, id: string) => g.npcs.find((n) => n.type.id === id) as MonsterUnit;

/** NPC 곁으로 옮겨 말을 건다 (메뉴가 열릴 때까지 틱) */
function talkTo(g: Game, id: string): MonsterUnit {
  const n = npcOf(g, id);
  const spot = nearestWalkable(g.map, { x: n.x + 3, y: n.y + 1 }, 8)!;
  g.changeLevel(g.levelId, spot.x + 0.5, spot.y + 0.5);
  g.enqueue({ type: 'interact', unitId: n.id });
  for (let i = 0; i < 300 && !g.snapshot().interaction; i++) g.tick();
  expect(g.snapshot().interaction?.typeId).toBe(id);
  return n;
}

function openStore(g: Game, id: string, option: 'trade' | 'tradeRepair' | 'gamble'): void {
  talkTo(g, id);
  g.enqueue({ type: 'npcMenu', option });
  g.tick();
}

function newItem(code: string, quality: Quality = QUALITY.NORMAL): ItemInstance {
  const it = data.treasure.createItem(data.items.base(code)!, 5, new Rng(9), quality);
  it.identified = true;
  // 바닥 드롭은 내구가 무작위 — 테스트는 최대 내구에서 시작
  it.durability = it.maxDurability;
  return it;
}

d('마을 NPC 배치 (DS1 프리셋)', () => {
  // 출처: MonPreset.txt Act 1 (0 gheed, 2 akara, 5 kashya, 7 warriv1, 8 charsi, 3 chicken, 4 rogue1, 13 cow) + monstats interact
  it('마을에 Akara·Charsi·Gheed·Kashya·Warriv 가 서 있고, 몬스터 목록(공격 대상)에는 없다', () => {
    const g = makeGame();
    const talkers = g.npcs.filter((n) => n.npc?.interact).map((n) => n.type.id).sort();
    expect(talkers).toEqual(['akara', 'charsi', 'gheed', 'kashya', 'warriv1']);
    expect(g.npcs.some((n) => n.type.id === 'rogue1' && !n.npc?.interact)).toBe(true);
    expect(g.monsters.length).toBe(0);
    // 공격 명령은 NPC 에게 통하지 않는다
    g.enqueue({ type: 'attack', targetId: npcOf(g, 'akara').id, standStill: false });
    g.tick();
    expect(g.snapshot().player.mode).not.toBe('A1');
  });

  it('Cain 은 구출(퀘스트 플래그) 뒤에만 마을에 나타난다', () => {
    const g = makeGame();
    expect(g.npcs.some((n) => n.type.id === 'cain5')).toBe(false);
    g.setQuest('cain');
    expect(g.npcs.some((n) => n.type.id === 'cain5')).toBe(true);
  });

  // 출처: DRLGPRESET_SpawnHardcodedPresetUnits — Blood Moor 첫 테두리 방에 Flavie (navi)
  it('Blood Moor 입구에 Flavie (navi)', () => {
    const g = makeGame();
    const bm = world.byKey.get('bloodmoor')!;
    const sp = nearestWalkable(bm.def.map, { x: bm.def.map.width / 2, y: bm.def.map.height / 2 }, 80)!;
    g.changeLevel('bloodmoor', sp.x + 0.5, sp.y + 0.5);
    g.tick();
    expect(g.npcs.some((n) => n.type.id === 'navi' && n.npc?.interact)).toBe(true);
  });

  it('NPC 는 원위치 주변에서 움직이고, 말을 걸면 멈춰 플레이어를 본다', () => {
    const g = makeGame();
    const n = npcOf(g, 'kashya');
    const home = { ...n.npc!.home };
    for (let i = 0; i < 600; i++) g.tick();
    // 원위치에서 멀리 가지 않는다 (DS1 경로 점 + 원위치 16 안)
    expect(Math.hypot(n.x - home.x, n.y - home.y)).toBeLessThan(20);
    talkTo(g, 'kashya');
    const pos = { x: n.x, y: n.y };
    for (let i = 0; i < 100; i++) g.tick();
    expect(n.npc!.talking).toBe(true);
    expect(n.x).toBe(pos.x);
    expect(n.y).toBe(pos.y);
    expect(n.mode).toBe('NU');
  });
});

d('상점: 사기·팔기', () => {
  // 출처: misc.txt hp1 cost 30 × npc.txt akara sell mult 1024 / 1024 = 30 (원작 Minor Healing Potion 30 골드)
  it('Akara 에게 hp1 사기: 30 골드, 자동 벨트 물약은 벨트로', () => {
    const g = makeGame({ gold: 1000 });
    openStore(g, 'akara', 'trade');
    const inter = g.snapshot().interaction!;
    expect(inter.mode).toBe('trade');
    const hp1 = inter.store.find((s) => s.item.code === 'hp1')!;
    expect(g.priceOf(hp1.item, 'buy')).toBe(30);
    g.enqueue({ type: 'buy', itemId: hp1.item.id });
    g.tick();
    expect(g.gold).toBe(970);
    expect(g.store.belt[0]?.code).toBe('hp1');
    // 상시 품목은 상점에 남는다
    expect(g.snapshot().interaction!.store.some((s) => s.item.id === hp1.item.id)).toBe(true);
  });

  // 출처: sub_6FCC88B0 — 멀티바이는 벨트가 찰 때까지 (벨트 없음 = 4 칸)
  it('Shift+우클릭 멀티바이: 빈 벨트 4 칸을 채우고 4 × 30 골드', () => {
    const g = makeGame({ gold: 1000 });
    openStore(g, 'akara', 'trade');
    const hp1 = g.snapshot().interaction!.store.find((s) => s.item.code === 'hp1')!;
    g.enqueue({ type: 'buy', itemId: hp1.item.id, multi: true });
    g.tick();
    expect(g.store.belt.slice(0, 4).map((x) => x?.code)).toEqual(['hp1', 'hp1', 'hp1', 'hp1']);
    expect(g.gold).toBe(1000 - 4 * 30);
    expect(g.inventory.length).toBe(0);
  });

  // 출처: sub_6FCC88B0 — 두루마리(ITEMTYPE scro)는 같은 책에, 멀티바이면 min(골드 / 값, 책 빈 칸). tbk maxstack 20, tsc cost 100
  it('두루마리 멀티바이: 마을 포털 책(5장)을 20장까지 채우고 15 × 100 골드', () => {
    const g = makeGame({ gold: 5000 });
    const tome = newItem('tbk');
    tome.quantity = 5;
    g.store.inv.autoAdd(tome);
    openStore(g, 'akara', 'trade');
    const tsc = g.snapshot().interaction!.store.find((s) => s.item.code === 'tsc')!;
    g.enqueue({ type: 'buy', itemId: tsc.item.id, multi: true });
    g.tick();
    expect(tome.quantity).toBe(20);
    expect(g.gold).toBe(5000 - 15 * 100);
  });

  it('골드 + 창고 골드가 모자라면 실패, 모자란 인벤토리 골드는 창고 골드로 채운다', () => {
    const g = makeGame({ gold: 10 });
    openStore(g, 'akara', 'trade');
    const hp1 = g.snapshot().interaction!.store.find((s) => s.item.code === 'hp1')!;
    g.enqueue({ type: 'buy', itemId: hp1.item.id });
    const ev = g.tick();
    expect(ev.some((e) => e.type === 'buyFailed' && e.reason === 'gold')).toBe(true);
    expect(g.gold).toBe(10);
    expect(g.store.belt[0]).toBeNull();
    g.stashGold = 100;
    g.enqueue({ type: 'buy', itemId: hp1.item.id });
    g.tick();
    // 출처: PLRTRADE_AddGold(STAT_GOLD, −gold), (STAT_GOLDBANK, gold − cost)
    expect(g.gold).toBe(0);
    expect(g.stashGold).toBe(80);
  });

  it('Charsi 무기 사기: 값 = transactionCost(buy), 상시 품목이 아니면 상점에서 빠진다', () => {
    const g = makeGame({ gold: 50000, level: 5 });
    openStore(g, 'charsi', 'tradeRepair');
    const si = g.snapshot().interaction!.store.find((s) => s.page === 1)!;
    const ctx = { items: data.items, gen: data.treasure.gen ?? null, npc: data.npcPrices!.get('charsi')!, difficulty: 0 as const, bookCharge: data.bookCharge };
    const cost = transactionCost(si.item, 'buy', ctx);
    g.enqueue({ type: 'buy', itemId: si.item.id, toInventory: true });
    g.tick();
    expect(g.gold).toBe(50000 - cost);
    expect(g.inventory.some((it) => it.code === si.item.code)).toBe(true);
    expect(g.snapshot().interaction!.store.some((s) => s.item.id === si.item.id)).toBe(false);
  });

  // 출처: weapons.txt hax cost 170, npc.txt charsi buy mult 512 → 170 × 512 / 1024 = 85 (내구 최대 보통 품질)
  it('팔기: 보통 Hand Axe 85 골드, 상점 되사기 목록에 감정·내구 최대로 들어간다', () => {
    const g = makeGame({ gold: 0, level: 5 });
    const hax = newItem('hax');
    expect(hax.durability).toBe(hax.maxDurability);
    g.store.inv.autoAdd(hax);
    openStore(g, 'charsi', 'tradeRepair');
    g.enqueue({ type: 'sell', itemId: hax.id });
    g.tick();
    expect(g.gold).toBe(85);
    expect(g.inventory.some((it) => it.id === hax.id)).toBe(false);
    const back = g.snapshot().interaction!.store.filter((s) => s.item.code === 'hax');
    expect(back.length).toBeGreaterThan(0);
    // 되사기 가격 = charsi sell mult 960: 170 × 960 / 1024 = 159
    const ctx = { items: data.items, gen: data.treasure.gen ?? null, npc: data.npcPrices!.get('charsi')!, difficulty: 0 as const };
    expect(transactionCost(hax, 'buy', ctx)).toBe(159);
  });

  // 출처: SUNITPROXY_UpdateVendorInventory — 마을에 플레이어가 없으면 재고를 비우고, 다음 거래 때 새로 채운다
  it('마을을 떠났다 오면 재고가 새로 생긴다', () => {
    const g = makeGame({ gold: 0, level: 5 });
    openStore(g, 'charsi', 'tradeRepair');
    const before = g.snapshot().interaction!.store;
    const beforeIds = before.map((s) => s.item.id);
    g.enqueue({ type: 'closeNpc' });
    g.tick();
    const start = { x: g.snapshot().player.x, y: g.snapshot().player.y };
    const bm = world.byKey.get('bloodmoor')!;
    const sp = nearestWalkable(bm.def.map, { x: bm.def.map.width / 2, y: bm.def.map.height / 2 }, 80)!;
    g.changeLevel('bloodmoor', sp.x + 0.5, sp.y + 0.5);
    g.tick();
    g.changeLevel('town', start.x, start.y);
    g.tick();
    openStore(g, 'charsi', 'tradeRepair');
    const after = g.snapshot().interaction!.store.map((s) => s.item.id);
    expect(after.some((id) => beforeIds.includes(id))).toBe(false);
  });
});

d('수리 (Charsi)', () => {
  const repCtx = () => ({ items: data.items, gen: data.treasure.gen ?? null, npc: data.npcPrices!.get('charsi')!, difficulty: 0 as const });

  // 출처: ITEMS_CalculateTransactionCost REPAIR — cost × (max − dur) / max × rep mult 128 / 1024 → 170 × 14/28 = 85 → 85 × 128 / 1024 = 10
  it('한 개 수리: 반쯤 닳은 Hand Axe 10 골드, 내구 최대', () => {
    const g = makeGame({ gold: 100 });
    const hax = newItem('hax');
    hax.durability = hax.maxDurability - 14;
    g.store.inv.autoAdd(hax);
    expect(transactionCost(hax, 'repair', repCtx())).toBe(Math.trunc((Math.trunc((170 * 14) / hax.maxDurability) * 128) / 1024));
    const cost = transactionCost(hax, 'repair', repCtx());
    openStore(g, 'charsi', 'tradeRepair');
    g.enqueue({ type: 'repair', itemId: hax.id });
    g.tick();
    expect(hax.durability).toBe(hax.maxDurability);
    expect(g.gold).toBe(100 - cost);
  });

  it('모두 수리: 장착·인벤토리 수리비 합계', () => {
    const g = makeGame({ gold: 1000 });
    const a = newItem('hax'), b = newItem('cap');
    a.durability = 1;
    b.durability = 2;
    g.store.inv.autoAdd(a);
    g.store.equipment.head = b;
    const total = transactionCost(a, 'repair', repCtx()) + transactionCost(b, 'repair', repCtx());
    openStore(g, 'charsi', 'tradeRepair');
    g.enqueue({ type: 'repair' });
    g.tick();
    expect(a.durability).toBe(a.maxDurability);
    expect(b.durability).toBe(b.maxDurability);
    expect(g.gold).toBe(1000 - total);
  });

  // 출처: D2GAME_NPC_Repair_6FCC95B0 — 모자라면 divisor = (값 << 10) / 잃은 내구, 회복 = (골드 << 10) / divisor, 골드 0
  it('골드가 모자라면 되는 만큼만 수리하고 골드 0', () => {
    const g = makeGame({ gold: 3 });
    const hax = newItem('hax');
    hax.durability = 1;
    g.store.inv.autoAdd(hax);
    const cost = transactionCost(hax, 'repair', repCtx());
    expect(cost).toBeGreaterThan(3);
    const divisor = Math.trunc((cost * 1024) / (hax.maxDurability - 1));
    const rep = Math.trunc((3 * 1024) / divisor);
    openStore(g, 'charsi', 'tradeRepair');
    g.enqueue({ type: 'repair', itemId: hax.id });
    g.tick();
    expect(g.gold).toBe(0);
    expect(hax.durability).toBe(1 + rep);
  });

  // 출처: D2GAME_NPC_Repair — CHARSI·FARA·HRATLI·HALBU·LARZUK 만 (Gheed 는 수리하지 않는다)
  it('Gheed 는 수리하지 않는다', () => {
    const g = makeGame({ gold: 1000 });
    const hax = newItem('hax');
    hax.durability = 1;
    g.store.inv.autoAdd(hax);
    openStore(g, 'gheed', 'trade');
    expect(g.snapshot().interaction!.repair).toBe(false);
    g.enqueue({ type: 'repair', itemId: hax.id });
    g.tick();
    expect(hax.durability).toBe(1);
    expect(g.gold).toBe(1000);
  });
});

d('도박 (Gheed)', () => {
  // 출처: D2GAME_STORES_FillGamble — 14 개 (첫 두 개 반지·목걸이), 미감정. misc.txt rin gamble cost 50000
  it('도박 목록 14 개, 반지 50000 골드, 산 아이템은 감정된다', () => {
    const g = makeGame({ gold: 200000, level: 20 });
    openStore(g, 'gheed', 'gamble');
    const inter = g.snapshot().interaction!;
    expect(inter.mode).toBe('gamble');
    expect(inter.store.length).toBe(14);
    expect(inter.store.every((s) => !s.item.identified)).toBe(true);
    const ring = inter.store.find((s) => s.item.code === 'rin')!;
    expect(g.priceOf(ring.item, 'buy')).toBe(50000);
    g.enqueue({ type: 'buy', itemId: ring.item.id });
    g.tick();
    expect(g.gold).toBe(150000);
    const got = g.inventory.find((it) => it.code === 'rin')!;
    expect(got.identified).toBe(true);
    expect(got.quality).toBeGreaterThanOrEqual(QUALITY.MAGIC);
    // 다른 아이템: 값 = gambleCost (ITEMS_CalculateTransactionCost GAMBLE)
    const other = inter.store.find((s) => s.item.code !== 'rin' && s.item.code !== 'amu')!;
    const before = g.gold;
    g.enqueue({ type: 'buy', itemId: other.item.id });
    g.tick();
    expect(g.gold).toBe(before - gambleCost(data.items, other.item.code, 20));
  });
});

d('치료 (Akara)·감정 (Cain)', () => {
  // 출처: D2GAME_NPC_Heal_6FCCB220 (AKARA) → D2GAME_NPC_HealPlayer: 생명·마나 최대, 독 해제
  it('Akara 에게 말을 걸면 생명·마나가 차고 독이 풀린다', () => {
    const g = makeGame();
    const c = g.character!;
    c.life = 1;
    c.mana = 0;
    (g as unknown as { player: { states: { set(n: string, u: number, s: Record<string, number>): void } } }).player.states.set('poison', 99999, { hpregen: -1 });
    talkTo(g, 'akara');
    expect(c.life).toBe(g.maxLife());
    expect(c.mana).toBe(g.maxMana());
    expect(g.snapshot().player.states).not.toContain('poison');
  });

  // 출처: D2GAME_NPC_IdentifyAllItems — A1Q4 보상 뒤 무료, 전이면 개당 100 골드
  it('Cain 감정: 인벤토리 미감정 아이템 모두 감정 (구출 뒤 무료)', () => {
    const g = makeGame({ gold: 500 });
    g.setQuest('cain');
    const a = newItem('hax', QUALITY.MAGIC), b = newItem('cap', QUALITY.MAGIC);
    a.identified = false;
    b.identified = false;
    g.store.inv.autoAdd(a);
    g.store.inv.autoAdd(b);
    talkTo(g, 'cain5');
    expect(g.snapshot().interaction!.options).toContain('identify');
    g.enqueue({ type: 'npcMenu', option: 'identify' });
    g.tick();
    expect(a.identified && b.identified).toBe(true);
    expect(g.gold).toBe(500);
    // 퀘스트 보상 전 규칙: 개당 100
    g.quests.delete('cain');
    const c2 = newItem('cap', QUALITY.MAGIC);
    c2.identified = false;
    g.store.inv.autoAdd(c2);
    g.enqueue({ type: 'npcMenu', option: 'identify' });
    g.tick();
    expect(c2.identified).toBe(true);
    expect(g.gold).toBe(400);
  });
});
