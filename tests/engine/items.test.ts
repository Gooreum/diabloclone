import { beforeAll, describe, expect, it } from 'vitest';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { QUALITY, type ItemInstance, type Quality } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { statOf, type ItemGen } from '../../src/engine/itemgen';
import { armorDefense, computeDerived, weaponDamage } from '../../src/engine/charstats';
import { classStats, createCharacter } from '../../src/engine/player';
import { gameChain, hasGameData } from '../support/gamedata';

describe.skipIf(!hasGameData)('아이템 생성 (출처: D2MOO ItemsMagic.cpp / ItemMode.cpp sub_6FC4C5F0 / ItemMods.cpp)', () => {
  let data: GameData, gen: ItemGen, tables: GameTables;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
    gen = data.treasure.gen as ItemGen;
  });
  const make = (code: string, ilvl: number, q: Quality, seed = 1): ItemInstance => {
    data.treasure.droppedUniques.clear();
    return data.treasure.createItem(data.items.base(code)!, ilvl, new Rng(seed), q, true);
  };

  // 출처: ITEMS_ComputeCraftedMagicAffixLevel — magic lvl 이 있으면 max(ilvl, qlvl) + magic lvl, 없으면 L − ⌊qlvl/2⌋ (L ≥ 99 − ⌊q/2⌋ 이면 2L − 99)
  it('접사 레벨(alvl): 손도끼(qlvl 3) ilvl 10 → 9, 완드(magic lvl 1) ilvl 10 → 11, ilvl 99 → 99', () => {
    expect(gen.affixLevel(10, data.items.base('hax')!)).toBe(9);
    expect(gen.affixLevel(10, data.items.base('wnd')!)).toBe(11);
    expect(gen.affixLevel(99, data.items.base('hax')!)).toBe(99);
  });

  it('매직: 접사 1~2개, 모든 접사 level ≤ alvl · 아이템 타입 허용 · 클래식(version < 100), 미감정', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const it = make('hax', 5, QUALITY.MAGIC, seed);
      expect(it.quality).toBe(QUALITY.MAGIC);
      expect(it.prefixes.length + it.suffixes.length).toBeGreaterThanOrEqual(1);
      expect(it.prefixes.length).toBeLessThanOrEqual(1);
      expect(it.suffixes.length).toBeLessThanOrEqual(1);
      expect(it.identified).toBe(false);
      const alvl = gen.affixLevel(5, data.items.base('hax')!);
      for (const a of [...it.prefixes.map((i) => gen.prefixes[i]!), ...it.suffixes.map((i) => gen.suffixes[i]!)]) {
        expect(a.level).toBeLessThanOrEqual(alvl);
        expect(a.itypes.some((t) => data.items.isType(data.items.base('hax')!, t))).toBe(true);
      }
    }
  });

  // 출처: ITEMS_RollMagicAffixesNew — rand(2) 로 접두 여부, 접두가 없으면 접미 강제 → 접두만 1/4, 둘 다 1/4, 접미만 1/2
  it('매직 접사 조합 분포 ≈ 접두만 25% / 둘 다 25% / 접미만 50%', () => {
    const cnt = { p: 0, b: 0, s: 0 };
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
      const it = make('cap', 30, QUALITY.MAGIC, seed * 7919);
      if (it.prefixes.length && it.suffixes.length) cnt.b++;
      else if (it.prefixes.length) cnt.p++;
      else cnt.s++;
    }
    expect(cnt.p / N).toBeGreaterThan(0.2);
    expect(cnt.p / N).toBeLessThan(0.3);
    expect(cnt.b / N).toBeGreaterThan(0.2);
    expect(cnt.b / N).toBeLessThan(0.3);
    expect(cnt.s / N).toBeGreaterThan(0.44);
    expect(cnt.s / N).toBeLessThan(0.56);
  });

  it('같은 시드 → 같은 아이템', () => {
    const a = make('cap', 20, QUALITY.RARE, 42), b = make('cap', 20, QUALITY.RARE, 42);
    expect({ ...a, id: 0 }).toEqual({ ...b, id: 0 });
  });

  // 출처: D2GAME_RollRareItem — 이름 접두·접미 필수, 접사 {3,4,4,5,5,5,6,6}, 한쪽 최대 3, 같은 그룹 중복 없음
  it('레어: 레어 이름, 접사 1~6개(한쪽 ≤ 3), 그룹 중복 없음', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const it = make('cap', 30, QUALITY.RARE, seed);
      expect(it.quality).toBe(QUALITY.RARE);
      expect(it.rareName).toBeDefined();
      expect(it.prefixes.length).toBeLessThanOrEqual(3);
      expect(it.suffixes.length).toBeLessThanOrEqual(3);
      const groups = [...it.prefixes.map((i) => gen.prefixes[i]!.group), ...it.suffixes.map((i) => gen.suffixes[i]!.group)].filter(Boolean);
      expect(new Set(groups).size).toBe(groups.length);
    }
  });

  // 출처: uniqueitems.txt The Gnasher — hax, lvl 7, str +8
  it('유니크: 손도끼 ilvl 7 → The Gnasher (힘 +8), 요구 레벨 5', () => {
    const it = make('hax', 7, QUALITY.UNIQUE, 3);
    expect(it.quality).toBe(QUALITY.UNIQUE);
    expect(gen.uniques[it.uniqueIdx!]!.name).toBe('The Gnasher');
    expect(statOf(it, 'strength')).toBe(8);
    expect(it.levelReq).toBe(5);
  });

  // 출처: sub_6FC4C5F0 — 유니크 실패 시 내구 ×3 → 레어, 게임당 같은 유니크는 한 번 (pGame->dwUniqueFlags)
  it('유니크 실패(레벨 부족·이미 나옴): 내구 ×3 레어', () => {
    const low = make('hax', 5, QUALITY.UNIQUE, 3);
    const base = data.items.base('hax')!;
    expect(low.quality).toBe(QUALITY.RARE);
    expect(low.maxDurability).toBe(Math.min(base.durability * 3, 255));
    data.treasure.droppedUniques.clear();
    const first = data.treasure.createItem(base, 7, new Rng(3), QUALITY.UNIQUE, true);
    const second = data.treasure.createItem(base, 7, new Rng(4), QUALITY.UNIQUE, true);
    expect([first.quality, second.quality]).toEqual([QUALITY.UNIQUE, QUALITY.RARE]);
  });

  // 출처: setitems.txt Arctic Furs — qui, lvl 3, ac% 275~325
  it('세트: 누비 갑옷 ilvl 3 → Arctic Furs, 방어% 275~325 로 기본 방어 = maxac + 1', () => {
    const it = make('qui', 3, QUALITY.SET, 5);
    expect(it.quality).toBe(QUALITY.SET);
    expect(gen.setItems[it.setIdx!]!.name).toBe('Arctic Furs');
    const ed = statOf(it, 'item_armor_percent');
    expect(ed).toBeGreaterThanOrEqual(275);
    expect(ed).toBeLessThanOrEqual(325);
    expect(it.defense).toBe(data.items.base('qui')!.maxAc + 1);
    expect(armorDefense(it)).toBe(Math.trunc((it.defense * (100 + ed)) / 100));
  });

  // 출처: qualityitems.txt — 무기는 att / dmg% / dur% 조합, 방어구는 ac% / dur%
  it('상급: qualityitems 행의 속성 (무기 피해 5~15% 등)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const it = make('hax', 5, QUALITY.SUPERIOR, seed);
      expect(it.quality).toBe(QUALITY.SUPERIOR);
      expect(it.superiorIdx).toBeDefined();
      const ed = statOf(it, 'item_maxdamage_percent');
      if (ed) {
        expect(ed).toBeGreaterThanOrEqual(5);
        expect(ed).toBeLessThanOrEqual(15);
        const d = weaponDamage(it, data.items.base('hax')!);
        expect(d.max).toBe(Math.trunc((data.items.base('hax')!.maxDam * (100 + ed)) / 100));
      }
    }
  });

  // 출처: sub_6FC549F0 — 하급: 이름(Crude…), 최대 내구 = 기본/3, 무기 피해 75%
  it('하급: 이름 4종 중 하나, 최대 내구 기본/3, 피해 75%', () => {
    const it = make('hax', 5, QUALITY.INFERIOR, 9);
    const base = data.items.base('hax')!;
    expect(it.quality).toBe(QUALITY.INFERIOR);
    expect(gen.lowQualityNames[it.lowQualityIdx!]).toMatch(/Crude|Cracked|Damaged|Low Quality/);
    expect(it.maxDurability).toBe(Math.max(Math.trunc(base.durability / 3), 1));
    expect(weaponDamage(it, base).max).toBe(Math.max(Math.trunc((75 * base.maxDam) / 100), 2));
  });

  // 출처: ITEMMODS_CanItemHaveMagicAffix — 클래식은 겹치는(스택)·투척 아이템에 접사 불가 → 매직 실패 → 상급
  it('클래식 투창은 매직이 될 수 없다 (매직 → 상급)', () => {
    const it = make('jav', 10, QUALITY.MAGIC, 1);
    expect(it.quality).not.toBe(QUALITY.MAGIC);
  });

  // 출처: sub_6FC4D6B0 — 일반·상급만 33%, 개수 ≤ min(gemsockets, MaxSock, Normal 3), 클래식 몸통 갑옷 없음
  it('소켓: 일반 무기는 약 1/3 확률로 1~3개, 몸통 갑옷·매직은 없음', () => {
    let socketed = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const it = make('bsd', 20, QUALITY.NORMAL, seed);
      if (it.sockets) {
        socketed++;
        expect(it.sockets).toBeGreaterThanOrEqual(1);
        expect(it.sockets).toBeLessThanOrEqual(3);
      }
      expect(make('qui', 20, QUALITY.NORMAL, seed).sockets).toBe(0);
    }
    expect(socketed / 600).toBeGreaterThan(0.27);
    expect(socketed / 600).toBeLessThan(0.39);
    for (let seed = 1; seed <= 50; seed++) expect(make('bsd', 20, QUALITY.MAGIC, seed).sockets).toBe(0);
  });

  it('res-all: 네 저항이 같은 값 (properties.txt func 3 = 앞 값 재사용)', () => {
    const it = make('cap', 1, QUALITY.NORMAL, 1);
    gen.assignMods(it, data.items.base('cap')!, [{ code: 'res-all', param: '', min: 5, max: 30 }], new Rng(77));
    const v = statOf(it, 'fireresist');
    expect(v).toBeGreaterThanOrEqual(5);
    expect([statOf(it, 'coldresist'), statOf(it, 'lightresist'), statOf(it, 'poisonresist')]).toEqual([v, v, v]);
  });

  it('장착 파생 스탯: 힘 +8 도끼 → 힘, 생명 +15 투구 → 최대 생명', () => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    const gnasher = make('hax', 7, QUALITY.UNIQUE, 3);
    const bonnet = make('cap', 4, QUALITY.UNIQUE, 1);
    expect(gen.uniques[bonnet.uniqueIdx!]!.name).toBe('War Bonnet');
    // 출처: The Arreat Summit — 미감정 아이템은 마법 속성이 적용되지 않는다
    expect(computeDerived(ch, cs, { rarm: gnasher, head: bonnet }, data.items, gen).str).toBe(ch.str);
    gnasher.identified = bonnet.identified = true;
    const d = computeDerived(ch, cs, { rarm: gnasher, head: bonnet }, data.items, gen);
    expect(d.str).toBe(ch.str + 8);
    expect(d.maxLife).toBe(ch.maxLife + 15);
    expect(d.toHit).toBe(30);
  });
});
