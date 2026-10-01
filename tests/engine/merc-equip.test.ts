// 확장팩 용병 장비 (원작 1.14d LoD): 장착 규칙·능력치·엔진 흐름.
// 확장팩 MPQ 체인 (game-data/lod/patch_d2 + d2exp) 이 있어야 실행된다.
// 출처: D2MOO PlrMsg.cpp Rcv0x61 (종류 표) · D2GAME_MERCS_EquipItem, Items.cpp ITEMS_CheckRequirements, SUnitDmg.cpp SUNITDMG_ApplyDamageBonuses,
//       확장팩 hireling.txt (Rogue Scout Id 0: Dmg 1-3 Dmg/Lvl 2, Str 35 Str/Lvl 10, Dex 45 Dex/Lvl 16 …), weapons.txt / armor.txt
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { buildGameData } from '../../src/data/gamedata';
import { GameTables } from '../../src/data/tables';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { GAME_DATA } from '../support/gamedata';
import type { GameData } from '../../src/engine/game';
import { mercStats } from '../../src/engine/hireling';
import { mercAllows, mercCanEquip, mercDerived, mercSlotFor } from '../../src/engine/mercequip';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));
const d = hasLod ? describe : describe.skip;

let tables: GameTables;
let lod: GameData;

beforeAll(() => {
  if (!hasLod) return;
  const chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
  tables = new GameTables(chain);
  lod = buildGameData(chain, tables, { expansion: true });
});

const base = (code: string) => lod.items.base(code)!;
const item = (code: string, stats: [string, number][] = []): ItemInstance => {
  const it = lod.treasure.createItem(base(code), 30, new Rng(2), QUALITY.NORMAL, false);
  it.stats.push(...stats.map(([stat, value]) => ({ stat, param: 0, value })));
  return it;
};
const A1 = { min: 0, max: 0, toHit: 0 };
const st = (id: number, lvl: number) => mercStats(lod.hirelings!, id, lvl)!;

d('Phase 1: 장착 규칙', () => {
  it('로그: 활·갑옷·투구·서클릿은 되고 검·장갑·반지는 안 된다', () => {
    for (const c of ['sbw', 'lea', 'cap', 'ci0']) expect(mercAllows(lod.items, 'roguehire', base(c)), c).toBe(true);
    for (const c of ['ssd', 'lgl', 'rin', 'spr', 'buc']) expect(mercAllows(lod.items, 'roguehire', base(c)), c).toBe(false);
  });

  it('아마존 활(직업 전용)은 로그도 못 쓴다 (class)', () => {
    expect(mercAllows(lod.items, 'roguehire', base('am1'))).toBe(true);
    expect(mercCanEquip(lod.items, 'roguehire', item('am1'), { level: 99, str: 999, dex: 999 })).toBe('class');
  });

  it('Act 2: 창·폴암, Act 3: 한손 검·방패 (방패는 왼손), 양손 검은 안 된다', () => {
    expect(mercAllows(lod.items, 'act2hire', base('spr'))).toBe(true);
    expect(mercAllows(lod.items, 'act2hire', base('bar'))).toBe(true);
    expect(mercAllows(lod.items, 'act2hire', base('ssd'))).toBe(false);
    expect(mercAllows(lod.items, 'act3hire', base('ssd'))).toBe(true);
    expect(mercAllows(lod.items, 'act3hire', base('buc'))).toBe(true);
    expect(mercAllows(lod.items, 'act3hire', base('2hs'))).toBe(false);
    expect(mercSlotFor(lod.items, 'act3hire', base('buc'))).toBe('larm');
    expect(mercSlotFor(lod.items, 'act3hire', base('ssd'))).toBe('rarm');
    expect(mercSlotFor(lod.items, 'roguehire', base('cap'))).toBe('head');
    expect(mercSlotFor(lod.items, 'roguehire', base('lea'))).toBe('tors');
  });

  it('Act 5: 한손 도끼와 바바리안 투구 (직업 예외), 로그는 바바리안 투구 거절', () => {
    expect(mercAllows(lod.items, 'act5hire1', base('hax'))).toBe(true);
    expect(mercCanEquip(lod.items, 'act5hire1', item('ba1'), { level: 99, str: 999, dex: 999 })).toBeNull();
    expect(mercCanEquip(lod.items, 'roguehire', item('ba1'), { level: 99, str: 999, dex: 999 })).toBe('class');
  });

  it('요구치: 힘 부족 str, 미감정 거절, 이더리얼은 힘 −10', () => {
    expect(mercCanEquip(lod.items, 'roguehire', item('lea'), { level: 10, str: 14, dex: 99 })).toBe('str');
    expect(mercCanEquip(lod.items, 'roguehire', item('lea'), { level: 10, str: 15, dex: 99 })).toBeNull();
    const un = item('lea');
    un.identified = false;
    expect(mercCanEquip(lod.items, 'roguehire', un, { level: 10, str: 99, dex: 99 })).toBe('type');
    const eth = item('lea');
    eth.ethereal = true;
    expect(mercCanEquip(lod.items, 'roguehire', eth, { level: 10, str: 5, dex: 99 })).toBeNull();
  });
});

d('Phase 1: 장비 능력치', () => {
  it('로그 + 단궁(양손): 피해 = hireling 피해 + 활 양손 피해, 민첩 보너스 %', () => {
    const b = st(0, 10);
    const dv = mercDerived(b, 'roguehire', A1, { rarm: item('sbw') }, lod.items, lod.treasure.gen);
    // sbw 2handmindam 1 · 2handmaxdam 4, DexBonus 100 → 피해 % = 민첩
    const pct = Math.trunc(dv.dex);
    expect(dv.dmg).toEqual({ min: b.minDamage + 1 + Math.trunc(((b.minDamage + 1) * pct) / 100), max: b.maxDamage + 4 + Math.trunc(((b.maxDamage + 4) * pct) / 100) });
  });

  it('ED 100% 활: 최소·최대 피해가 ED 없는 활보다 커진다 (item_min/maxdamage_percent)', () => {
    const b = st(0, 10);
    const plain = mercDerived(b, 'roguehire', A1, { rarm: item('sbw') }, lod.items, lod.treasure.gen).dmg!;
    const ed = mercDerived(b, 'roguehire', A1, { rarm: item('sbw', [['item_mindamage_percent', 100], ['item_maxdamage_percent', 100]]) }, lod.items, lod.treasure.gen).dmg!;
    const raw = b.maxDamage + 4;
    expect(ed.max - plain.max).toBe(raw);
    expect(ed.min).toBeGreaterThan(plain.min);
  });

  it('Act 3 + 한손 검: 피해 = monstats A1(비어 있음) + 검 한손 피해 (hireling 피해는 안 더함)', () => {
    const b = st(15, 20);
    const dv = mercDerived(b, 'act3hire', A1, { rarm: item('ssd') }, lod.items, lod.treasure.gen);
    const pct = dv.str; // ssd StrBonus 100
    expect(dv.dmg).toEqual({ min: 2 + Math.trunc((2 * pct) / 100), max: 7 + Math.trunc((7 * pct) / 100) });
  });

  it('갑옷 방어, 화염 저항 + 75 상한, 생명', () => {
    const b = st(0, 10);
    const armor = item('lea');
    const dv = mercDerived(b, 'roguehire', A1, { tors: armor, head: item('cap', [['fireresist', 200], ['maxhp', 20]]) }, lod.items, lod.treasure.gen);
    const cap = lod.items.base('cap')!;
    expect(dv.defense).toBeGreaterThanOrEqual(b.defense + armor.defense + cap.minAc);
    expect(dv.resist.fi).toBe(75);
    expect(dv.resist.co).toBe(b.resist);
    expect(dv.maxHp).toBe(b.maxHp + 20);
    expect(dv.dmg).toBeNull();
  });

  it('부서진 갑옷·요구치 미달 장비는 능력치를 주지 않는다', () => {
    const b = st(0, 3);
    const broken = item('lea');
    broken.durability = 0;
    const heavy = item('lsd', [['fireresist', 30]]); // 로그가 못 쓰는 종류여도 요구치 확인으로 빠진다
    const dv = mercDerived(b, 'roguehire', A1, { tors: broken, rarm: heavy }, lod.items, lod.treasure.gen);
    expect(dv.defense).toBe(b.defense);
    expect(dv.resist.fi).toBe(b.resist);
    expect(dv.active.length).toBe(0);
  });
});
