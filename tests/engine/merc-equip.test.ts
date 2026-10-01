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
import { GAME_DATA, gameChain, hasGameData } from '../support/gamedata';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData } from '../../src/engine/game';
import { hirelingExp, mercStats, type MercSave } from '../../src/engine/hireling';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { makeSave, parseSave, serializeSave } from '../../src/engine/save';
import type { MonsterUnit } from '../../src/engine/ai/types';
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

const rogue = (level = 10): MercSave => ({ name: 'merc05', seed: 99, hirelingId: 0, level, experience: hirelingExp(level, 100), dead: false });

function game(opts: { data?: GameData; tables?: GameTables; merc?: MercSave; gold?: number; inTown?: boolean } = {}): Game {
  const t = opts.tables ?? tables, data = opts.data ?? lod;
  const cs = classStats(t.table('charstats'), 'Amazon');
  const ch = createCharacter(cs);
  ch.level = 30;
  const g = new Game({
    map: new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 7, data, character: ch, classStats: cs, expTable: expTable(t.table('experience'), 'Amazon'), inTown: opts.inTown ?? true,
    merc: opts.merc ?? rogue(), gold: opts.gold ?? 0,
  });
  g.tick();
  return g;
}

const events = (g: Game) => (g as unknown as { events: { type: string; [k: string]: unknown }[] }).events;
const give = (g: Game, it: ItemInstance, slot?: 'head' | 'tors' | 'rarm' | 'larm') => {
  g.store.cursor = it;
  g.enqueue({ type: 'mercItem', ...(slot ? { slot } : {}) });
  g.tick();
};

d('Phase 2: 엔진 흐름', () => {
  it('커서의 단궁을 로그에게: rarm 에 들어가고 피해·스냅샷이 바뀐다', () => {
    const g = game();
    const u = g.mercUnit()!;
    const before = { ...u.stats.a1 };
    const bow = item('sbw');
    give(g, bow);
    expect(g.merc!.items?.rarm?.id).toBe(bow.id);
    expect(g.store.cursor).toBeNull();
    expect(u.stats.a1.max).toBeGreaterThan(before.max);
    const snap = g.snapshot().merc!;
    expect(snap.items?.rarm?.id).toBe(bow.id);
    expect(snap.stats!.max).toBe(u.stats.a1.max);
  });

  it('찬 칸에 다른 활: 새 활 장착, 원래 활은 커서로 · 빈 커서로 빼기', () => {
    const g = game();
    const a = item('sbw'), b = item('sbw');
    give(g, a);
    give(g, b);
    expect(g.merc!.items?.rarm?.id).toBe(b.id);
    expect(g.store.cursor?.id).toBe(a.id);
    g.store.cursor = null;
    const base = mercStats(lod.hirelings!, 0, 10)!;
    g.enqueue({ type: 'mercItem', slot: 'rarm' });
    g.tick();
    expect((g.store.cursor as ItemInstance | null)?.id).toBe(b.id);
    expect(g.merc!.items?.rarm).toBeUndefined();
    expect(g.mercUnit()!.stats.a1).toMatchObject({ min: base.minDamage, max: base.maxDamage });
  });

  it('검·힘 부족 갑옷은 거절: 커서 그대로, mercEquipFailed', () => {
    const g = game({ merc: rogue(3) });
    const sword = item('ssd');
    give(g, sword);
    expect(g.store.cursor?.id).toBe(sword.id);
    expect(events(g).some((e) => e.type === 'mercEquipFailed' && e.reason === 'type')).toBe(true);
    const plate = item('plt'); // 판금 갑옷: 힘 65
    give(g, plate);
    expect(g.store.cursor?.id).toBe(plate.id);
    expect(g.merc!.items?.tors).toBeUndefined();
  });

  it('용병이 죽어도 장비는 남고, 부활하면 그대로 · 새로 고용하면 장비가 없어진다', () => {
    const g = game({ gold: 100000 });
    const armor = item('lea');
    give(g, armor);
    const def = g.mercUnit()!.stats.defense;
    const u = g.mercUnit()!;
    (g as unknown as { damagePet(p: MonsterUnit, d: Record<string, number>): void }).damagePet(u, { phys: 99999 * 256, fire: 0, ltng: 0, cold: 0, pois: 0, mag: 0, stunLen: 0, coldLen: 0, freezeLen: 0, poisLen: 0, hitClass: 0 });
    expect(g.merc!.dead).toBe(true);
    expect(g.merc!.items?.tors?.id).toBe(armor.id);
    expect(g.resurrectMerc()).toBe(true);
    expect(g.mercUnit()!.stats.defense).toBe(def);
    g.hireMerc('merc09', 5, 1, 10, hirelingExp(10, 100), 20, 20);
    expect(g.merc!.items ?? {}).toEqual({});
  });

  it('저장 왕복: 용병 장비가 그대로', () => {
    const g = game();
    const bow = item('sbw');
    give(g, bow);
    const save = makeSave('Hero', g.character!, 0, { inventory: [], equipment: {}, merc: g.mercSave() });
    const back = parseSave(serializeSave(save));
    expect(back.merc?.items?.rarm).toMatchObject({ id: bow.id, code: 'sbw' });
    const g2 = game({ merc: back.merc! });
    expect(g2.mercUnit()!.stats.a1.max).toBe(g.mercUnit()!.stats.a1.max);
  });

  it('치료 물약을 용병에게: 물약이 없어지고 용병 생명이 오른다', () => {
    const g = game();
    const u = g.mercUnit()!;
    u.hp = 5;
    const pot = item('hp3');
    g.store.inv.items.push({ item: pot, x: 0, y: 0 });
    g.enqueue({ type: 'mercPotion', itemId: pot.id });
    for (let i = 0; i < 30; i++) g.tick();
    expect(g.store.find(pot.id)).toBeNull();
    expect(u.hp).toBeGreaterThan(10);
  });
});

(hasGameData ? describe : describe.skip)('Phase 2: 클래식', () => {
  it('클래식 데이터에서는 mercItem 이 아무것도 하지 않는다', () => {
    const ct = new GameTables(gameChain());
    const cd = buildGameData(gameChain(), ct);
    const g = game({ data: cd, tables: ct });
    const bow = cd.treasure.createItem(cd.items.base('sbw')!, 10, new Rng(2), QUALITY.NORMAL, false);
    give(g, bow);
    expect(g.store.cursor?.id).toBe(bow.id);
    expect(g.merc!.items).toBeUndefined();
  });
});

const S = (name: string) => lod.skills!.byNameOf(name)!;
const withLayered = (it: ItemInstance, stat: string, param: number, value: number) => {
  it.stats.push({ stat, param, value });
  return it;
};
interface Priv {
  damageMonster(m: MonsterUnit, d: Record<string, number>, source: string, attackerId?: number): void;
  startMonsterMode(m: MonsterUnit, mode: string): void;
  tickCount: number;
}
const pkt = (phys: number) => ({ phys: phys * 256, fire: 0, ltng: 0, cold: 0, pois: 0, mag: 0, stunLen: 0, coldLen: 0, freezeLen: 0, poisLen: 0, hitClass: 0 });

d('Phase 2: +스킬·흡수·공격 속도·아이템 오라', () => {
  it('+1 모든 스킬 투구: Act 2 용병이 켠 오라 레벨 = 배운 레벨 + 1', () => {
    const lvl = 20;
    const g = game({ merc: { name: 'merca201', seed: 3, hirelingId: 6, level: lvl, experience: hirelingExp(lvl, 0), dead: false }, inTown: false });
    const learned = mercStats(lod.hirelings!, 6, lvl)!.skills.find((x) => x.name === 'Prayer')!.level;
    give(g, item('cap', [['item_allskills', 1]]));
    const u = g.mercUnit()!;
    const z = g.spawnMonster('zombie1', u.x + 3, u.y) as unknown as MonsterUnit;
    z.hp = z.stats.maxHp = 1e6;
    let ev: { type: string; [k: string]: unknown } | undefined;
    for (let i = 0; i < 1500 && !ev; i++) {
      g.tick();
      ev = events(g).find((e) => e.type === 'mercAura');
    }
    expect(ev?.lvl).toBe(learned + 1);
  });

  it('생명 흡수 투구: 용병이 준 물리 피해의 % 만큼 회복, 흡수가 없으면 회복 없음', () => {
    for (const ll of [50, 0]) {
      const g = game({ inTown: false });
      if (ll) give(g, item('cap', [['lifedrainmindam', ll]]));
      const u = g.mercUnit()!;
      const m = g.spawnMonster('zombie1', u.x + 10, u.y) as unknown as MonsterUnit;
      m.hp = 1000;
      u.hp = 5;
      (g as unknown as Priv).damageMonster(m, pkt(40), 'pet', u.id);
      if (ll) expect(u.hp).toBeCloseTo(5 + (40 * ll) / 100, 3);
      else expect(u.hp).toBe(5);
    }
  });

  it('공격 속도 갑옷: 용병 A1 공격 시간이 짧아진다', () => {
    const len = (ias: number) => {
      const g = game({ inTown: false });
      if (ias) give(g, item('lea', [['item_fasterattackrate', ias]]));
      const u = g.mercUnit()!;
      const pr = g as unknown as Priv;
      pr.startMonsterMode(u, 'A1');
      return u.modeEnd - pr.tickCount;
    };
    expect(len(40)).toBeLessThan(len(0));
  });

  it('아이템 오라 (Meditation): 용병과 곁의 플레이어에게 오라 상태', () => {
    const g = game();
    const med = S('Meditation');
    give(g, withLayered(item('cap'), 'item_aura', med.id, 5));
    for (let i = 0; i < 30; i++) g.tick();
    expect(g.mercUnit()!.states.has(med.auraState)).toBe(true);
    expect((g as unknown as { player: { states: { has(s: string): boolean } } }).player.states.has(med.auraState)).toBe(true);
  });

  it('아이템 오라 (Conviction): 마을 밖 범위 안 몬스터에 auratargetstate', () => {
    const g = game({ inTown: false });
    const conv = S('Conviction');
    give(g, withLayered(item('lea'), 'item_aura', conv.id, 12));
    const u = g.mercUnit()!;
    const m = g.spawnMonster('zombie1', u.x + 2, u.y) as unknown as MonsterUnit;
    m.hp = m.stats.maxHp = 1e6;
    // 오라 주기 perdelay 50
    for (let i = 0; i < 60; i++) g.tick();
    expect(m.states.has(conv.auraTargetState)).toBe(true);
    expect(u.states.get(conv.auraState)?.stats.fireresist ?? 0).toBe(0);
  });
});
