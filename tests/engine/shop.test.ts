import { beforeAll, describe, expect, it } from 'vitest';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { QUALITY } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { fillGamble, fillStore, parseGamble, STORE_GRID_H, STORE_GRID_W, type StoreCtx, type StoreItem } from '../../src/engine/shop';
import { gameChain, hasGameData } from '../support/gamedata';

const noOverlap = (list: StoreItem[]) => {
  const cells = new Set<string>();
  for (const s of list) {
    for (let dy = 0; dy < s.item.invH; dy++) {
      for (let dx = 0; dx < s.item.invW; dx++) {
        const k = `${s.page}:${s.x + dx}:${s.y + dy}`;
        if (cells.has(k)) return false;
        cells.add(k);
        if (s.x + dx >= STORE_GRID_W || s.y + dy >= STORE_GRID_H) return false;
      }
    }
  }
  return true;
};

// 출처: D2MOO D2Game/src/UNIT/SUnitNpc.cpp D2GAME_NPC_FillStoreInventory_6FCC7100 · D2GAME_STORES_FillGamble_6FCCA9F0,
//       misc.txt PermStoreItem · AkaraMax, gamble.txt, DifficultyLevels.txt GambleRare/GambleSet/GambleUnique
describe.skipIf(!hasGameData)('상점 판매 목록', () => {
  let data: GameData, tables: GameTables;
  const ctx = (seed: number, difficulty = 0): StoreCtx => ({ items: data.items, treasure: data.treasure, rng: new Rng(seed), difficulty });
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });

  // misc.txt: PermStoreItem=1 이고 AkaraMax>0 → tsc isc hp1 mp1 key vps yps wms tbk ibk
  it('아카라는 상시 품목(두루마리·책·작은 물약·열쇠·해독제)을 항상 판다', () => {
    const codes = new Set(fillStore(ctx(1), 'akara', 0, 1).map((s) => s.item.code));
    for (const c of ['tsc', 'isc', 'hp1', 'mp1', 'key', 'vps', 'yps', 'wms', 'tbk', 'ibk']) expect(codes.has(c), c).toBe(true);
    // AkaraMax 가 비어 있는 hp2 는 없음
    expect(codes.has('hp2')).toBe(false);
  });

  it('상점 아이템은 감정·내구도 최대이고 격자에 겹치지 않는다', () => {
    const list = fillStore(ctx(7), 'charsi', 0, 5);
    expect(list.length).toBeGreaterThan(10);
    for (const s of list) {
      expect(s.item.identified).toBe(true);
      expect(s.item.durability).toBe(s.item.maxDurability);
      expect(s.page).toBeGreaterThanOrEqual(0);
      expect(s.page).toBeLessThan(4);
    }
    expect(noOverlap(list)).toBe(true);
  });

  // ilvl = plvl + 5, 보통 난이도 Act 1 상한 12
  it('보통 난이도 Act 1: 플레이어 30레벨이어도 아이템 레벨 12 이하 품목만', () => {
    const list = fillStore(ctx(3), 'charsi', 0, 30);
    for (const s of list) {
      expect(s.item.ilvl).toBe(12);
      const b = data.items.base(s.item.code)!;
      if (!b.permStore) expect(b.level).toBeLessThanOrEqual(12);
    }
  });

  it('ilvl 5 이상이면 하급 품질은 나오지 않고 매직 무기가 섞인다', () => {
    let magic = 0;
    for (let seed = 1; seed <= 10; seed++) {
      for (const s of fillStore(ctx(seed), 'charsi', 0, 1)) {
        expect(s.item.quality).not.toBe(QUALITY.INFERIOR);
        if (s.item.quality === QUALITY.MAGIC) magic++;
      }
    }
    expect(magic).toBeGreaterThan(0);
  });

  it('같은 시드면 같은 목록 (결정적)', () => {
    const a = fillStore(ctx(42), 'gheed', 0, 8).map((s) => `${s.item.code}@${s.page}:${s.x},${s.y}`);
    const b = fillStore(ctx(42), 'gheed', 0, 8).map((s) => `${s.item.code}@${s.page}:${s.x},${s.y}`);
    expect(a).toEqual(b);
  });

  // DATATBLS_LoadGambleTxt: chooseLimit[0] = 2, 선택표는 레벨 오름차순
  it('도박 선택표: 레벨 오름차순, 한도 = 그 레벨 이하 개수', () => {
    const t = parseGamble(data.items, tables.table('Gamble'));
    const lv = t.selection.map((c) => data.items.base(c)!.level);
    expect(lv).toEqual([...lv].sort((x, y) => x - y));
    expect(t.chooseLimit[0]).toBe(2);
    expect(t.chooseLimit[10]).toBe(lv.filter((l) => l <= 10).length);
  });

  // 클래식 투척 무기는 접사가 없어 매직 → 상급으로 대체됨 (itemgen applyQuality 대체 순서)
  it('도박 목록: 14개, 첫 두 개는 반지·목걸이, 전부 미감정, 일반 품질 없음', () => {
    const t = parseGamble(data.items, tables.table('Gamble'));
    const normal = tables.table('DifficultyLevels')[0];
    const list = fillGamble(ctx(5), t, normal, 10);
    expect(list.length).toBe(14);
    expect(list[0]!.item.code).toBe('rin');
    expect(list[1]!.item.code).toBe('amu');
    for (const s of list) {
      expect(s.item.identified).toBe(false);
      expect(s.item.quality).toBeGreaterThanOrEqual(s.item.code === 'tax' || s.item.code === 'bkf' ? QUALITY.SUPERIOR : QUALITY.MAGIC);
    }
  });

  // GambleRare 10000 / 100000 = 10% (+세트·유니크 0.15%)
  it('도박 레어 비율 약 10%', () => {
    const t = parseGamble(data.items, tables.table('Gamble'));
    const normal = tables.table('DifficultyLevels')[0];
    let rare = 0, total = 0;
    for (let seed = 1; seed <= 150; seed++) {
      for (const s of fillGamble(ctx(seed), t, normal, 20)) {
        total++;
        if (s.item.quality === QUALITY.RARE) rare++;
      }
    }
    expect(rare / total).toBeGreaterThan(0.07);
    expect(rare / total).toBeLessThan(0.13);
  });
});
