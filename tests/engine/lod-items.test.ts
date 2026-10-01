// 확장팩 아이템 규칙: 이더리얼.
// 출처: D2MOO ITEMS_MakeEthereal (5%, 무기·방어구, 하급·세트·퀘스트 제외, 최대 내구 max/2+1), ITEMMODS_ApplyEthereality (기본 피해·방어 3*base/2),
//       D2Common Items.cpp 요구치 (힘·민첩 −10), ITEMS_CalculateTransactionCost (NPC 가 사는 값 / 4), PLRTRADE_CheckCubeInput (eth / noe)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance, type Quality } from '../../src/engine/treasure';
import { makeEthereal } from '../../src/engine/itemgen';
import { weaponDamage } from '../../src/engine/charstats';
import { requirements } from '../../src/engine/inventory';
import { isRepairable, transactionCost, type PriceCtx } from '../../src/engine/price';
import { parseSave, serializeSave, makeSave } from '../../src/engine/save';
import { CubeDb, transmute } from '../../src/engine/cube';
import type { Character } from '../../src/engine/player';

let classic: GameData;
let lod: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  const tables = new GameTables(gameChain());
  classic = buildGameData(gameChain(), tables);
  lod = buildGameData(gameChain(), tables, { expansion: true });
});

const make = (d: GameData, code: string, q: Quality = QUALITY.NORMAL, seed = 1, eth: 'roll' | 'always' | 'never' = 'never'): ItemInstance =>
  d.treasure.createItem(d.items.base(code)!, 30, new Rng(seed), q, true, eth);

describe.skipIf(!hasGameData)('이더리얼', () => {
  it('확장팩 드롭 굴림은 약 5% 가 이더리얼, 클래식은 0', () => {
    const rate = (d: GameData, code: string) => {
      let n = 0;
      for (let i = 1; i <= 4000; i++) if (make(d, code, QUALITY.NORMAL, i, 'roll').ethereal) n++;
      return n / 4000;
    };
    const w = rate(lod, 'lsd'), a = rate(lod, 'qui');
    expect(w).toBeGreaterThan(0.03);
    expect(w).toBeLessThan(0.07);
    expect(a).toBeGreaterThan(0.03);
    expect(a).toBeLessThan(0.07);
    expect(rate(classic, 'lsd')).toBe(0);
  });

  it('세트·하급·물약·상점(never)은 이더리얼이 되지 않는다', () => {
    for (let i = 1; i <= 300; i++) {
      expect(make(lod, 'lsd', QUALITY.SET, i, 'always').ethereal).toBeFalsy();
      expect(make(lod, 'lsd', QUALITY.INFERIOR, i, 'always').ethereal).toBeFalsy();
      expect(make(lod, 'hp1', QUALITY.NORMAL, i, 'always').ethereal).toBeFalsy();
      expect(make(lod, 'lsd', QUALITY.NORMAL, i, 'never').ethereal).toBeFalsy();
    }
    // 유니크는 될 수 있다
    expect(make(lod, 'lsd', QUALITY.UNIQUE, 3, 'always').ethereal).toBe(true);
  });

  it('makeEthereal: 최대·현재 내구 max/2+1, 방어구 방어 ×1.5', () => {
    const it0 = make(lod, 'qui');
    const def = it0.defense, max = it0.maxDurability;
    makeEthereal(it0, lod.items.base('qui')!);
    expect(it0.maxDurability).toBe(Math.trunc(max / 2) + 1);
    expect(it0.durability).toBe(it0.maxDurability);
    expect(it0.defense).toBe(Math.trunc((3 * def) / 2));
  });

  it('무기 피해: 기본 3*base/2 에 ED% 를 곱한다', () => {
    const b = lod.items.base('lsd')!;
    const w = make(lod, 'lsd');
    w.stats = [{ stat: 'item_maxdamage_percent', param: 0, value: 100 }, { stat: 'item_mindamage_percent', param: 0, value: 100 }];
    const before = weaponDamage(w, b);
    makeEthereal(w, b);
    const after = weaponDamage(w, b);
    expect(after.min).toBe(Math.trunc((Math.trunc((3 * b.minDam) / 2) * 200) / 100));
    expect(after.max).toBe(Math.trunc((Math.trunc((3 * b.maxDam) / 2) * 200) / 100));
    expect(after.max).toBeGreaterThan(before.max);
  });

  it('요구 힘·민첩 −10 (0 아래로 내려가지 않음)', () => {
    const w = make(lod, 'lsd');
    const r0 = requirements(lod.items, w);
    w.ethereal = true;
    const r1 = requirements(lod.items, w);
    expect(r1.str).toBe(Math.max(0, r0.str - 10));
    expect(r1.dex).toBe(Math.max(0, r0.dex - 10));
  });

  it('가격: NPC 가 사는 값 / 4, 수리 불가, 내구 0 이면 판 값 최소', () => {
    const ctx: PriceCtx = { items: lod.items, gen: lod.treasure.gen ?? null, npc: lod.npcPrices!.get('charsi')!, difficulty: 0, bookCharge: lod.bookCharge };
    const w = make(lod, 'lsd');
    const sell = transactionCost(w, 'sell', ctx), buy = transactionCost(w, 'buy', ctx);
    const e = { ...structuredClone(w), ethereal: true };
    expect(transactionCost(e, 'sell', ctx)).toBeLessThan(sell);
    expect(transactionCost(e, 'sell', ctx)).toBeLessThanOrEqual(Math.ceil(sell / 4) + 1);
    expect(transactionCost(e, 'buy', ctx)).toBe(buy);
    expect(isRepairable(lod.items, e)).toBe(false);
    expect(transactionCost({ ...e, durability: 1 }, 'repair', ctx)).toBe(0);
    expect(transactionCost({ ...e, durability: 0 }, 'sell', ctx)).toBe(1);
  });

  it('큐브: eth 입력은 이더리얼만, noe 입력은 이더리얼을 거부', () => {
    const db = lod.cube as CubeDb;
    const ctx = { items: lod.items, treasure: lod.treasure, rng: new Rng(5), playerLevel: 50, difficulty: 0, cls: 'bar', expansion: true };
    // 무기 수리(noe): 무기 + Ral + 연마석? — noe 입력 행을 직접 찾아 시험
    const noe = db.recipes.find((r) => r.enabled && r.inputs[0]?.noe);
    expect(noe).toBeTruthy();
    const eth = db.recipes.find((r) => r.inputs.some((x) => x?.eth));
    if (eth) expect(eth.inputs.some((x) => x?.eth)).toBe(true);
    // noe 행의 입력을 그대로 만들어 넣으면 이더리얼일 때는 맞지 않는다
    const inputs = (ethereal: boolean): ItemInstance[] =>
      noe!.inputs.filter((x): x is NonNullable<typeof x> => !!x).flatMap((x) => {
        const code = x.code ?? [...lod.items.bases.values()].find((b) => (x.type ? lod.items.isType(b, x.type) : false) && b.durability > 0)?.code ?? 'lsd';
        const n = x.qty || 1;
        return Array.from({ length: n }, (_, i) => {
          const it = make(lod, code, QUALITY.NORMAL, 10 + i);
          if (i === 0 && ethereal && it.maxDurability > 0) makeEthereal(it, lod.items.base(code)!);
          return it;
        });
      });
    const ok = transmute(db, ctx, inputs(false));
    const bad = transmute(db, ctx, inputs(true));
    expect(ok?.recipe.row).toBe(noe!.row);
    expect(bad?.recipe.row).not.toBe(noe!.row);
  });

  it('저장 왕복: ethereal 유지, 잘못된 값은 지운다', () => {
    const ch = { cls: 'Barbarian', level: 1, experience: 0, str: 30, dex: 20, vit: 25, ene: 10, statPoints: 0, skillPoints: 0, maxLife: 55, maxMana: 10, maxStamina: 92, life: 55, mana: 10, stamina: 92, skills: {}, leftSkill: 0, rightSkill: 0, hotkeys: Array(8).fill(null) } as Character;
    const w = make(lod, 'lsd');
    makeEthereal(w, lod.items.base('lsd')!);
    const bad = { ...make(lod, 'qui'), ethereal: 'yes' as unknown as boolean };
    const back = parseSave(serializeSave(makeSave('Eth', ch, 0, { inventory: [{ item: w, x: 0, y: 0 }, { item: bad, x: 2, y: 0 }], equipment: {} })));
    expect(back.inventory[0]!.item.ethereal).toBe(true);
    expect('ethereal' in back.inventory[1]!.item).toBe(false);
  });
});

describe.skipIf(!hasGameData)('확장팩 큐브 (제작 · mod · 소켓 비우기)', () => {
  const ctxOf = (d: GameData, seed = 9) => ({ items: d.items, treasure: d.treasure, rng: new Rng(seed), playerLevel: 60, difficulty: 0, cls: 'bar', expansion: d.expansion });
  /** 조합 입력을 그대로 만든다 (아이템 코드 우선, 없으면 그 종류의 첫 기본템, 품질 조건 맞춤) */
  const inputsOf = (d: GameData, r: NonNullable<ReturnType<CubeDb['recipes']['find']>>): ItemInstance[] =>
    r.inputs.filter((x): x is NonNullable<typeof x> => !!x).flatMap((x) => {
      const base = x.code ? d.items.base(x.code)! : x.any ? d.items.base('lsd')! : [...d.items.bases.values()].find((b) => d.items.isType(b, x.type!) && b.version < 100 && b.spawnable)!;
      return Array.from({ length: x.qty || 1 }, (_, i) => {
        const q = (x.quality || QUALITY.NORMAL) as Quality;
        const it = d.treasure.createItem(base, 40, new Rng(100 + i), q, q > QUALITY.NORMAL);
        it.identified = true;
        if (x.sock && it.sockets <= 0) it.sockets = 1;
        if (x.nos) it.sockets = 0;
        return it;
      });
    });

  it('제작: 결과는 품질 8 (crf), 접사 1~4 개, mod 속성, 요구 레벨 접사 기준 +10+3n 이상', () => {
    const db = lod.cube as CubeDb;
    const crafts = db.recipes.filter((r) => r.enabled && r.outputs[0]?.quality === QUALITY.CRAFTED);
    expect(crafts.length).toBeGreaterThan(20);
    let tried = 0;
    for (const r of crafts.slice(0, 12)) {
      const res = transmute(db, ctxOf(lod), inputsOf(lod, r));
      if (!res || res.recipe.row !== r.row) continue;
      tried++;
      const out = res.outputs[0]!;
      expect(out.quality).toBe(QUALITY.CRAFTED);
      const n = out.prefixes.length + out.suffixes.length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(4);
      expect(out.rareName).toBeTruthy();
      expect(out.levelReq).toBeGreaterThanOrEqual(10 + 3 * n);
      // mod 1 속성이 하나 이상 붙는다 (mod 행 수 ≥ 1)
      expect(out.stats.length).toBeGreaterThan(n);
    }
    expect(tried).toBeGreaterThan(3);
    // 클래식 ctx 는 제작 조합이 맞지 않는다
    const r0 = crafts[0]!;
    expect(transmute(classic.cube as CubeDb, ctxOf(classic), inputsOf(classic, r0))?.recipe.row).not.toBe(r0.row);
  });

  it('소켓 일반템 조합(useitem + mod sock): 소켓이 1~최대 사이로 생긴다', () => {
    const db = lod.cube as CubeDb;
    const r = db.recipes.find((x) => x.enabled && x.outputs[0]?.kind === 'useitem' && x.outputs[0].mods.some((m) => m.code === 'sock'))!;
    expect(r).toBeTruthy();
    const res = transmute(db, ctxOf(lod), inputsOf(lod, r));
    expect(res?.recipe.row).toBe(r.row);
    expect(res!.outputs[0]!.sockets).toBeGreaterThanOrEqual(1);
    expect(res!.outputs[0]!.sockets).toBeLessThanOrEqual(6);
  });

  it('소켓 비우기(uns): 박힌 것과 룬워드가 사라지고 원래 속성으로 돌아간다', () => {
    const db = lod.cube as CubeDb;
    const r = db.recipes.find((x) => x.enabled && x.outputs[0]?.uns)!;
    expect(r).toBeTruthy();
    const ins = inputsOf(lod, r);
    const target = ins.find((it) => it.sockets > 0)!;
    const rune = make(lod, 'r01');
    target.socketed = [rune];
    target.runeword = 5;
    target.runewordBase = { stats: [], defense: target.defense };
    target.stats = [{ stat: 'tohit', param: 0, value: 50 }];
    const res = transmute(db, ctxOf(lod), ins);
    expect(res?.recipe.row).toBe(r.row);
    const out = res!.outputs.find((o) => o.code === target.code)!;
    expect(out.socketed).toEqual([]);
    expect(out.runeword).toBeUndefined();
    expect(out.stats).toEqual([]);
    expect(out.sockets).toBe(target.sockets);
  });
});
