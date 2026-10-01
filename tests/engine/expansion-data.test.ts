// 확장팩 캐릭터용 데이터 (buildGameData {expansion:true}) — 표는 클래식과 같고 생성 규칙만 다르다.
// 출처: 원작 D2GAME wVersion (확장팩 캐릭터 = 100), weapons/armor/misc version 100 = 확장팩 기본템, UniqueItems/Sets/MagicPrefix version 100,
//       cubemain version 100 (룬 합치기 3 El → Eld 등), FillStoreInventory (wVersion < 100 이면 확장팩 기본템 제외)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { fillStore, type StoreCtx } from '../../src/engine/shop';
import { transmute } from '../../src/engine/cube';

let classic: GameData;
let lod: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  const tables = new GameTables(gameChain());
  classic = buildGameData(gameChain(), tables);
  lod = buildGameData(gameChain(), tables, { expansion: true });
});

/** TC 를 n 번 굴린 결과 기본템 코드 */
function drops(d: GameData, tc: string, mlvl: number, n: number): string[] {
  const rng = new Rng(1234);
  const out: string[] = [];
  for (let i = 0; i < n; i++) for (const it of d.treasure.drop(tc, mlvl, rng)) out.push(it.code);
  return out;
}
const isExp = (d: GameData, code: string) => (d.items.base(code)?.version ?? 0) >= 100;

describe.skipIf(!hasGameData)('확장팩 데이터 판본', () => {
  it('플래그: 클래식 false, 확장팩 true', () => {
    expect(classic.expansion).toBe(false);
    expect(lod.expansion).toBe(true);
  });

  it('드롭: 확장팩은 확장팩 기본템(엘리트 등)·룬이 나오고 클래식은 하나도 없다', () => {
    const c = drops(classic, 'Act 4 (H) Good', 85, 3000);
    const x = drops(lod, 'Act 4 (H) Good', 85, 3000);
    expect(c.filter((k) => isExp(classic, k))).toEqual([]);
    expect(x.filter((k) => isExp(lod, k)).length).toBeGreaterThan(0);
    expect(x.some((k) => /^r\d\d$/.test(k))).toBe(true);
  });

  it('유니크·세트: 확장팩 행은 확장팩에서만 켜진다', () => {
    const expUnique = (d: GameData) => d.treasure.gen!.uniques.filter((u) => u.enabled).length;
    expect(expUnique(lod)).toBeGreaterThan(expUnique(classic));
    // Tal Rasha's (확장팩 세트) 는 클래식 rarity -1
    const tal = (d: GameData) => d.treasure.gen!.setItems.find((s) => s.set === "Tal Rasha's Wrappings");
    expect(tal(classic)?.rarity).toBe(-1);
    expect(tal(lod)!.rarity).toBeGreaterThanOrEqual(0);
    // 레어 접사 순서(저장된 아이템 이름)는 두 판본이 같다
    expect(lod.treasure.gen!.rarePrefixes.map((r) => r.name)).toEqual(classic.treasure.gen!.rarePrefixes.map((r) => r.name));
  });

  it('상점: 확장팩 ctx 는 확장팩 기본템을 진열할 수 있고 클래식은 없다', () => {
    const ctx = (d: GameData, seed: number): StoreCtx => ({ items: d.items, treasure: d.treasure, rng: new Rng(seed), difficulty: 2, expansion: d.expansion });
    const codes = (d: GameData) => {
      const all: string[] = [];
      for (let s = 1; s <= 20; s++) for (const si of fillStore(ctx(d, s), 'charsi', 0, 80)) all.push(si.item.code);
      return all;
    };
    expect(codes(classic).filter((k) => isExp(classic, k))).toEqual([]);
    expect(codes(lod).filter((k) => isExp(lod, k)).length).toBeGreaterThan(0);
  });

  it('큐브: 룬 합치기 (El 3개 → Eld, cubemain version 100) 는 확장팩 캐릭터만', () => {
    const el = (d: GameData): ItemInstance => d.treasure.createItem(d.items.base('r01')!, 20, new Rng(3), QUALITY.NORMAL, false);
    const run = (d: GameData) => transmute(d.cube!, { items: d.items, treasure: d.treasure, rng: new Rng(9), playerLevel: 20, difficulty: 0, cls: 'pal', expansion: d.expansion }, [el(d), el(d), el(d)]);
    expect(run(classic)).toBeNull();
    const r = run(lod);
    expect(r?.outputs?.map((o) => o.code) ?? r).toEqual(['r02']);
  });

  it('구분선 행: Objects 0번은 Dummy 그대로, 슈퍼유니크에 Expansion 없음', () => {
    expect(classic.objects!.types[0]?.name).not.toBe('Expansion');
    expect(classic.uniques!.superUniques.some((s) => s.key === 'Expansion')).toBe(false);
  });
});
