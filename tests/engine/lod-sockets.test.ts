// 확장팩 소켓 규칙: 룬워드 완성, 주얼 자기 속성, 박힌 물건 속성은 부모 아이템 속성, 레어 주얼 접사 수, 드롭 소켓 난이도 상한.
// 출처: D2MOO ITEMS_GetRunesTxtRecordFromItem / ITEMMODS_UpdateRuneword, ItemMode.cpp 소켓 처리 (보석·룬 gems.txt, 주얼 자기 속성),
//       D2GAME_RollRareItem (레어 주얼 3~4), sub_6FC4D6B0 (소켓 상한 Normal 3 · Nightmare 4 · Hell 6)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World } from '../../src/data/act1-world';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance, type Quality } from '../../src/engine/treasure';
import { weaponDamage } from '../../src/engine/charstats';
import { statOf } from '../../src/engine/itemgen';

let tables: GameTables;
let classic: GameData;
let lod: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  classic = buildGameData(gameChain(), tables);
  lod = buildGameData(gameChain(), tables, { expansion: true });
});

const make = (d: GameData, code: string, q: Quality = QUALITY.NORMAL, sockets = 0): ItemInstance => {
  const it = d.treasure.createItem(d.items.base(code)!, 30, new Rng(7), q, false);
  it.sockets = sockets;
  return it;
};

function game(d: GameData, inv: ItemInstance[]): Game {
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const ch = createCharacter(cs);
  ch.level = 30;
  ch.str = 200;
  ch.dex = 200;
  const w = buildAct1World(gameChain(), tables, d, 55);
  const g = new Game({
    map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), seed: 55, data: d,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
    inventory: inv,
  });
  g.tick();
  return g;
}

const insert = (g: Game, gem: ItemInstance, target: ItemInstance) => {
  g.enqueue({ type: 'moveItem', itemId: gem.id, to: { kind: 'socket', itemId: target.id } });
  g.tick();
};

describe.skipIf(!hasGameData)('룬워드', () => {
  it("Ral·Ort·Tal 을 3소켓 일반 방패에 순서대로 박으면 Ancient's Pledge 가 완성된다", () => {
    const sh = make(lod, 'lrg', QUALITY.NORMAL, 3);
    const runes = ['r08', 'r09', 'r07'].map((c) => make(lod, c));
    const g = game(lod, [sh, ...runes]);
    const res0 = g.derived()!.res.co;
    runes.forEach((r) => insert(g, r, sh));
    expect(sh.socketed.map((x) => x.code)).toEqual(['r08', 'r09', 'r07']);
    const rw = lod.runewords!.get(sh.runeword);
    expect(rw?.name).toBe("Ancient's Pledge");
    expect(statOf(sh, 'item_armor_percent')).toBe(50);
    expect(statOf(sh, 'coldresist')).toBeGreaterThanOrEqual(30 + 13);
    // 인벤토리에 있는 동안은 캐릭터 저항이 그대로 (장착해야 적용)
    expect(g.derived()!.res.co).toBe(res0);
  });

  it('순서가 다르거나·소켓이 덜 찼거나·매직이거나·클래식 캐릭터면 완성되지 않는다', () => {
    const order = make(lod, 'lrg', QUALITY.NORMAL, 3);
    const half = make(lod, 'lrg', QUALITY.NORMAL, 4);
    const magic = make(lod, 'lrg', QUALITY.MAGIC, 3);
    const rs = (codes: string[]) => codes.map((c) => make(lod, c));
    const a = rs(['r09', 'r08', 'r07']), b = rs(['r08', 'r09', 'r07']), c = rs(['r08', 'r09', 'r07']);
    const g = game(lod, [order, half, magic, ...a, ...b, ...c]);
    a.forEach((r) => insert(g, r, order));
    b.forEach((r) => insert(g, r, half));
    c.forEach((r) => insert(g, r, magic));
    expect(order.socketed).toHaveLength(3);
    expect(half.socketed).toHaveLength(3);
    expect(magic.socketed).toHaveLength(3);
    expect([order.runeword, half.runeword, magic.runeword]).toEqual([undefined, undefined, undefined]);

    const csh = make(classic, 'lrg', QUALITY.NORMAL, 3);
    const cr = ['r08', 'r09', 'r07'].map((x) => make(classic, x));
    const cg = game(classic, [csh, ...cr]);
    cr.forEach((r) => insert(cg, r, csh));
    expect(csh.runeword).toBeUndefined();
  });

  it('완성 표: runes.txt complete 행 78 개, 각 행은 룬 1~6 개와 itype 이 있다', () => {
    const list = lod.runewords!.list;
    expect(list).toHaveLength(78);
    for (const rw of list) {
      expect(rw.runes.length).toBeGreaterThan(0);
      expect(rw.itypes.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!hasGameData)('주얼 · 소켓 속성', () => {
  it('주얼은 박아도 자기 속성 그대로, 무기에 박힌 ED% 는 그 무기 피해를 올린다', () => {
    const w = make(lod, 'lsd', QUALITY.NORMAL, 1);
    const jew = make(lod, 'jew', QUALITY.MAGIC);
    jew.stats = [{ stat: 'item_maxdamage_percent', param: 0, value: 30 }, { stat: 'item_mindamage_percent', param: 0, value: 30 }];
    const g = game(lod, [w, jew]);
    const before = weaponDamage(w, lod.items.base('lsd')!);
    insert(g, jew, w);
    expect(w.socketed[0]?.stats.find((s) => s.stat === 'item_maxdamage_percent')?.value).toBe(30);
    const after = weaponDamage(w, lod.items.base('lsd')!);
    expect(after.max).toBeGreaterThan(before.max);
  });

  it('보석 방어는 방어구 자체 방어로 합쳐져도 캐릭터 방어 총합은 같다 (클래식 회귀)', () => {
    const helm = make(classic, 'cap', QUALITY.NORMAL, 1);
    const gem = make(classic, 'gsw');
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    const w = buildAct1World(gameChain(), tables, classic, 55);
    const g = new Game({
      map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), seed: 55, data: classic,
      player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
      character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
      equipment: { head: helm }, inventory: [gem],
    });
    g.tick();
    const d0 = g.derived()!.defense;
    insert(g, gem, helm);
    const gemAc = statOf(gem, 'armorclass');
    expect(g.derived()!.defense).toBe(d0 + gemAc);
  });

  it('레어 주얼은 접사 3~4 개', () => {
    const counts = new Set<number>();
    for (let i = 1; i <= 300; i++) {
      const it = lod.treasure.createItem(lod.items.base('jew')!, 60, new Rng(i), QUALITY.RARE, true);
      if (it.quality !== QUALITY.RARE) continue;
      counts.add(it.prefixes.length + it.suffixes.length);
    }
    expect([...counts].every((c) => c >= 3 && c <= 4)).toBe(true);
    expect(counts.size).toBeGreaterThan(0);
  });

  it('확장팩 드롭 소켓 상한: Normal 3 · Hell 6', () => {
    const max = (diff: number) => {
      lod.treasure.difficulty = diff;
      let m = 0;
      for (let i = 1; i <= 3000; i++) m = Math.max(m, lod.treasure.createItem(lod.items.base('7cr')!, 85, new Rng(i), QUALITY.NORMAL, true).sockets);
      return m;
    };
    expect(max(0)).toBeLessThanOrEqual(3);
    expect(max(2)).toBeGreaterThan(3);
    expect(max(2)).toBeLessThanOrEqual(6);
    lod.treasure.difficulty = 0;
  });
});
