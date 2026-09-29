import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { Rng } from '../../src/engine/rng';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';

interface Internals { wearWeapon(): void; wearArmor(): void; playerDie(): void; events: { type: string }[] }

describe.skipIf(!hasGameData)('내구도·감정·죽음 벌칙', () => {
  let data: GameData, tables: GameTables;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });
  const make = (code: string, q: number = QUALITY.NORMAL, seed = 1): ItemInstance => data.treasure.createItem(data.items.base(code)!, 5, new Rng(seed), q as never, true);
  const newGame = (equipment: Record<string, ItemInstance>, extra: { gold?: number; stashGold?: number; level?: number; inventory?: ItemInstance[] } = {}) => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    ch.level = extra.level ?? 1;
    const game = new Game({
      map: new CollisionMap(60, 60), player: { x: 10.5, y: 10.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
      seed: 7, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), equipment,
      gold: extra.gold, stashGold: extra.stashGold, inventory: extra.inventory,
    });
    return { game, ch, inner: game as unknown as Internals };
  };

  // 출처: D2MOO ITEMS_UpdateDurability — 무기 4%, 방어구 10%
  it('무기는 성공한 근접 공격마다 약 4% 확률로 내구 1 감소', () => {
    const hax = make('hax');
    const { inner } = newGame({ rarm: hax });
    let lost = 0;
    for (let i = 0; i < 5000; i++) {
      hax.durability = hax.maxDurability;
      inner.wearWeapon();
      if (hax.durability < hax.maxDurability) lost++;
    }
    expect(lost / 5000).toBeGreaterThan(0.03);
    expect(lost / 5000).toBeLessThan(0.05);
  });

  it('클래식 투척 무기(투창)는 닳지 않는다', () => {
    const jav = make('jav');
    const { inner } = newGame({ rarm: jav });
    const before = jav.durability;
    for (let i = 0; i < 500; i++) inner.wearWeapon();
    expect(jav.durability).toBe(before);
  });

  // 출처: SUNITDMG_DrainItemDurability 가중치 머리 3 · 몸통 5
  it('근접 피격 시 방어구 하나가 10% 확률로 닳고, 머리:몸통 ≈ 3:5', () => {
    const cap = make('cap'), qui = make('qui');
    const { inner } = newGame({ head: cap, tors: qui });
    let head = 0, tors = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      cap.durability = cap.maxDurability;
      qui.durability = qui.maxDurability;
      inner.wearArmor();
      if (cap.durability < cap.maxDurability) head++;
      if (qui.durability < qui.maxDurability) tors++;
    }
    expect((head + tors) / N).toBeGreaterThan(0.085);
    expect((head + tors) / N).toBeLessThan(0.115);
    expect(head / (head + tors)).toBeGreaterThan(0.3);
    expect(head / (head + tors)).toBeLessThan(0.45);
  });

  it('내구 0 이 되면 부서짐 이벤트, 이후 더 줄지 않음', () => {
    const hax = make('hax');
    hax.durability = 1;
    const { inner } = newGame({ rarm: hax });
    for (let i = 0; i < 2000 && hax.durability > 0; i++) inner.wearWeapon();
    expect(hax.durability).toBe(0);
    expect(inner.events.some((e) => e.type === 'itemBroken')).toBe(true);
    for (let i = 0; i < 500; i++) inner.wearWeapon();
    expect(hax.durability).toBe(0);
  });

  it('감정 두루마리: 미감정 매직 아이템을 감정하고 두루마리는 사라진다', () => {
    const isc = make('isc'), ring = make('rin', QUALITY.MAGIC, 3);
    expect(ring.identified).toBe(false);
    const { game } = newGame({}, { inventory: [isc, ring] });
    game.enqueue({ type: 'useItem', itemId: isc.id, targetId: ring.id });
    game.tick();
    expect(ring.identified).toBe(true);
    expect(game.store.find(isc.id)).toBeNull();
  });

  // 출처: D2MOO PLAYER_ApplyDeathPenalty — (인벤 + 창고) × min(레벨, 20)%
  it('죽음: 레벨 10, 인벤 1000 · 창고 5000 → 600 잃고 400 은 땅에, 인벤 0', () => {
    const { game, inner } = newGame({}, { gold: 1000, stashGold: 5000, level: 10 });
    inner.playerDie();
    expect(game.gold).toBe(0);
    expect(game.stashGold).toBe(5000);
    expect(game.snapshot().items.filter((i) => i.code === 'gld').map((i) => i.quantity)).toEqual([400]);
  });

  it('죽음: 벌칙이 인벤 골드보다 크면 창고에서 뺀다 (레벨 30 → 20%)', () => {
    const { game, inner } = newGame({}, { gold: 100, stashGold: 1000, level: 30 });
    inner.playerDie();
    expect(game.gold).toBe(0);
    expect(game.stashGold).toBe(1100 - 220);
    expect(game.snapshot().items.length).toBe(0);
  });

  it('부활하면 장착 아이템은 시체에 남고, 시체를 주우면 다시 장착된다', () => {
    const hax = make('hax'), cap = make('cap');
    const { game, inner } = newGame({ rarm: hax, head: cap });
    inner.playerDie();
    game.respawn('main', 10.5, 10.5);
    expect(game.equipment.rarm).toBeUndefined();
    expect(game.snapshot().corpse?.items.map((i) => i.id).sort()).toEqual([hax.id, cap.id].sort());
    expect(game.takeCorpse()).toBe(true);
    expect(game.equipment.rarm).toBe(hax);
    expect(game.equipment.head).toBe(cap);
    expect(game.snapshot().corpse).toBeNull();
  });
});
