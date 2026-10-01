// 아이템 전투 특수 속성 (원작 1.14d 서버 규칙 — 클래식·확장팩 공통).
// 출처: D2MOO D2StatList.cpp (op 2·4·5·6), SUnitDmg.cpp (흡수·얼지 않음·피격/막기 애니 속도), SkillItem.cpp (EventFunc06/10/13/17/18/28),
//       Items.cpp D2GAME_DropTC (금화 획득), ITEMS_CalculateTransactionCost (할인), ItemMode.cpp sub_6FC4A350 (자동 수리),
//       원작 ItemStatCost.txt itemevent / op 열
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { classStats, createCharacter, expTable, type ClassName } from '../../src/engine/player';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { emptyDamage, type DamagePacket } from '../../src/engine/skills/damage';
import type { MonsterUnit } from '../../src/engine/ai/types';

let tables: GameTables;
let lod: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  lod = buildGameData(gameChain(), tables, { expansion: true });
});

type Stat = { stat: string; param?: number; value: number };
/** 감정된 아이템 + 원하는 속성 */
const item = (code: string, stats: Stat[] = [], q: number = QUALITY.MAGIC): ItemInstance => {
  const it = lod.treasure.createItem(lod.items.base(code)!, 30, new Rng(3), QUALITY.NORMAL, false);
  it.quality = q as ItemInstance['quality'];
  it.identified = true;
  it.stats = stats.map((s) => ({ stat: s.stat, param: s.param ?? 0, value: s.value }));
  return it;
};

interface Internals {
  hitPlayer(atk: { min: number; max: number; toHit: number }, lvl: number, hitClass: number, missile: boolean, attacker?: MonsterUnit, elem?: DamagePacket, alwaysHit?: boolean): void;
  killMonster(m: MonsterUnit, source?: 'player' | 'pet' | 'other'): void;
  tradeHost(): { reducePct?: number };
  player: { mode: string; modeEnd: number; states: { has(s: string): boolean } };
  tickCount: number;
  events: GameEvent[];
}

function setup(equipment: Record<string, ItemInstance> = {}, opts: { cls?: ClassName; level?: number; dex?: number } = {}) {
  const cls = opts.cls ?? 'Barbarian';
  const cs = classStats(tables.table('charstats'), cls);
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 40;
  ch.life = ch.maxLife = 500;
  ch.mana = ch.maxMana = 200;
  if (opts.dex) ch.dex = opts.dex;
  const game = new Game({
    map: new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 9, data: lod, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls), equipment,
  });
  game.tick();
  return { game, ch, inner: game as unknown as Internals };
}

const fire = (v: number): DamagePacket => ({ ...emptyDamage(), fire: v * 256 });
const NO_ATK = { min: 0, max: 0, toHit: 0 };

describe.skipIf(!hasGameData)('1단계 — 스탯 계산 기반', () => {
  it('레벨당 생명 (item_hp_perlevel 8 = 레벨당 +1, op 2 param 3): 레벨 40 이면 최대 생명 +40', () => {
    const base = setup().game.derived()!.maxLife;
    const { game } = setup({ lrin: item('rin', [{ stat: 'item_hp_perlevel', value: 8 }]) });
    expect(game.derived()!.maxLife).toBe(base + 40);
  });

  it('레벨당 명중 (item_tohit_perlevel, op param 1): 값 2 × 레벨 10 >> 1 = +10', () => {
    const { game } = setup({ lrin: item('rin', [{ stat: 'item_tohit_perlevel', value: 2 }]) }, { level: 10 });
    expect(game.derived()!.toHit).toBe(10);
  });

  it('레벨당 방어 (item_armor_perlevel op 4): 방어구 자체 방어에 레벨 × v / 8', () => {
    const plain = item('qui', []);
    const d0 = setup({ tors: plain }).game.derived()!.defense;
    const perLvl = item('qui', [{ stat: 'item_armor_perlevel', value: 8 }]);
    perLvl.defense = plain.defense;
    expect(setup({ tors: perLvl }).game.derived()!.defense).toBe(d0 + 40);
  });

  it('param 이 있는 속성은 layered 목록으로 (스킬 발동 등)', () => {
    const { game } = setup({ lrin: item('rin', [{ stat: 'item_skillonhit', param: (66 << 6) | 3, value: 10 }]) });
    expect(game.derived()!.layered).toContainEqual({ stat: 'item_skillonhit', param: (66 << 6) | 3, value: 10 });
  });
});

describe.skipIf(!hasGameData)('1단계 — 받는 피해', () => {
  it('화염 % 흡수 50 → 40 상한: 100 피해 중 60 만 받고 흡수한 40 만큼 회복', () => {
    const { ch, inner } = setup({ lrin: item('rin', [{ stat: 'item_absorbfire_percent', value: 50 }]) });
    ch.life = 100;
    inner.hitPlayer(NO_ATK, 1, 0, true, undefined, fire(100), true);
    expect(ch.life).toBeCloseTo(100 + 40 - 60, 5);
  });

  it('고정 흡수는 % 흡수 다음: 100 피해, % 20 + 고정 10 → 받는 피해 70, 회복 30', () => {
    const { ch, inner } = setup({ lrin: item('rin', [{ stat: 'item_absorbfire_percent', value: 20 }, { stat: 'item_absorbfire', value: 10 }]) });
    ch.life = 100;
    inner.hitPlayer(NO_ATK, 1, 0, true, undefined, fire(100), true);
    expect(ch.life).toBeCloseTo(100 + 30 - 70, 5);
  });

  it('얼지 않음: 냉기 피해를 받아도 cold 상태가 걸리지 않는다 (없으면 걸린다)', () => {
    const cold = { ...emptyDamage(), cold: 10 * 256, coldLen: 100 };
    const a = setup();
    a.inner.hitPlayer(NO_ATK, 1, 0, true, undefined, cold, true);
    expect(a.inner.player.states.has('cold')).toBe(true);
    const b = setup({ lrin: item('rin', [{ stat: 'item_cannotbefrozen', value: 1 }]) });
    b.inner.hitPlayer(NO_ATK, 1, 0, true, undefined, cold, true);
    expect(b.inner.player.states.has('cold')).toBe(false);
  });

  it('피해를 마나로 50%: 화염 20 을 받으면 마나 +10', () => {
    const { ch, inner } = setup({ lrin: item('rin', [{ stat: 'item_damagetomana', value: 50 }]) });
    ch.mana = 50;
    inner.hitPlayer(NO_ATK, 1, 0, true, undefined, fire(20), true);
    expect(ch.mana).toBeCloseTo(60, 5);
  });

  it('공격자가 받는 피해 10: 근접으로 친 몬스터 생명 −10 (미사일이면 없음)', () => {
    const { game, inner } = setup({ tors: item('qui', [{ stat: 'item_attackertakesdamage', value: 10 }]) });
    const z = game.spawnMonster('zombie1', 22.5, 20.5);
    z.hp = 1000;
    inner.hitPlayer({ min: 1, max: 1, toHit: 1000 }, 1, 0, false, z, undefined, true);
    expect(z.hp).toBeCloseTo(990, 5);
    inner.hitPlayer({ min: 1, max: 1, toHit: 1000 }, 1, 0, true, z, undefined, true);
    expect(z.hp).toBeCloseTo(990, 5);
  });
});

describe.skipIf(!hasGameData)('1단계 — 처치·금화·할인·자동 수리', () => {
  it('처치 후 생명 +5 · 마나 +3 (플레이어가 죽였을 때만)', () => {
    const { game, ch, inner } = setup({ lrin: item('rin', [{ stat: 'item_healafterkill', value: 5 }, { stat: 'item_manaafterkill', value: 3 }]) });
    ch.life = 100;
    ch.mana = 10;
    inner.killMonster(game.spawnMonster('zombie1', 24.5, 20.5), 'player');
    expect([ch.life, ch.mana]).toEqual([105, 13]);
    inner.killMonster(game.spawnMonster('zombie1', 26.5, 20.5), 'other');
    expect([ch.life, ch.mana]).toEqual([105, 13]);
  });

  it('금화 획득 100%: 같은 시드의 금화 양이 2배', () => {
    let found = 0;
    for (let seed = 1; seed < 400 && found < 3; seed++) {
      const a = lod.treasure.drop('Gold', 10, new Rng(seed), 0, { exact: true }).find((x) => x.code === 'gld');
      if (!a) continue;
      const b = lod.treasure.drop('Gold', 10, new Rng(seed), 0, { exact: true, goldFind: 100 }).find((x) => x.code === 'gld')!;
      expect(b.quantity).toBe(a.quantity * 2);
      found++;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('할인 20%: 상점 거래 값에 item_reducedprices 가 들어간다', () => {
    const { inner } = setup({ lrin: item('rin', [{ stat: 'item_reducedprices', value: 20 }]) });
    expect(inner.tradeHost().reducePct).toBe(20);
  });

  it('자동 수리 4 (= 100/4 초에 1): 2500/4+1 프레임 뒤 내구 +1, 그 뒤 125 프레임마다', () => {
    const w = item('axe', [{ stat: 'item_replenish_durability', value: 4 }]);
    w.durability = w.maxDurability - 5;
    const { game } = setup({ rarm: w });
    const d0 = w.durability;
    for (let i = 0; i < 626; i++) game.tick();
    expect(w.durability).toBe(d0 + 1);
    for (let i = 0; i < 626; i++) game.tick();
    expect(w.durability).toBe(d0 + 2);
  });
});

describe.skipIf(!hasGameData)('1단계 — 피격·막기 애니 속도', () => {
  it('바바리안 맨손 피격: FHR 0 = 9 프레임, FHR 200 = 3 프레임 (원작 breakpoint)', () => {
    const len = (fhr: number) => {
      const { inner } = setup(fhr ? { lrin: item('rin', [{ stat: 'item_fastergethitrate', value: fhr }]) } : {});
      inner.hitPlayer(NO_ATK, 1, 0, true, undefined, fire(200), true);
      expect(inner.player.mode).toBe('GH');
      return inner.player.modeEnd - inner.tickCount;
    };
    expect(len(0)).toBe(9);
    expect(len(200)).toBe(3);
  });

  it('막으면 막기(BL) 모드가 된다', () => {
    const { game, inner } = setup({ larm: item('lrg', [{ stat: 'toblock', value: 75 }], QUALITY.NORMAL) }, { level: 1, dex: 300 });
    const z = game.spawnMonster('zombie1', 22.5, 20.5);
    let blocked = false;
    for (let i = 0; i < 40 && !blocked; i++) {
      inner.events.length = 0;
      inner.hitPlayer({ min: 1, max: 1, toHit: 100000 }, 1, 0, false, z);
      blocked = inner.events.some((e) => e.type === 'playerBlocked');
      if (!blocked) for (let k = 0; k < 20; k++) game.tick();
    }
    expect(blocked).toBe(true);
    expect(inner.player.mode).toBe('BL');
  });
});

interface Offense {
  damageMonster(m: MonsterUnit, raw: DamagePacket, source?: 'player' | 'pet' | 'other', attackerId?: number, proc?: 'melee' | 'missile'): void;
  targetDefense(m: MonsterUnit, missile: boolean): number;
  vsTypeDamagePct(m: MonsterUnit, w: unknown): number;
  killMonster(m: MonsterUnit, source?: 'player' | 'pet' | 'other'): void;
  startCheck(s: unknown, targetId: number | undefined): boolean;
  pets: MonsterUnit[];
}

describe.skipIf(!hasGameData)('2단계 — 공격 쪽 아이템 사건', () => {
  const off = (g: Game) => g as unknown as Offense;
  const tough = (g: Game, id = 'zombie1', x = 22.5) => {
    const z = g.spawnMonster(id, x, 20.5);
    z.hp = 1000;
    z.stats.maxHp = 2000;
    z.nextThink = 1e9;
    return z;
  };
  const hit = (g: Game, z: MonsterUnit, proc: 'melee' | 'missile' = 'melee') => off(g).damageMonster(z, emptyDamage(), 'player', undefined, proc);

  it('강타 100%: 일반 몬스터 현재 생명 1/4, 슈퍼유니크 1/8, 원거리는 나눗수 ×2', () => {
    const { game } = setup({ rarm: item('axe', [{ stat: 'item_crushingblow', value: 100 }]) });
    const a = tough(game);
    hit(game, a);
    expect(a.hp).toBeCloseTo(750, 5);
    const b = tough(game, 'zombie1', 24.5);
    b.flags |= 2;
    hit(game, b);
    expect(b.hp).toBeCloseTo(875, 5);
    const c = tough(game, 'zombie1', 26.5);
    hit(game, c, 'missile');
    expect(c.hp).toBeCloseTo(875, 5);
  });

  it('치명타(DS) 는 마스터리·패시브 치명 다음에 한 번만 판정 (100% 면 늘 성공)', async () => {
    const { rollCritical } = await import('../../src/engine/skills/player-damage');
    expect(rollCritical(0, 0, new Rng(1), 100)).toBe(true);
    expect(rollCritical(0, 0, new Rng(1), 0)).toBe(false);
  });

  it('상처 악화 100%: openwounds 상태, hpregen −(f(40) + 40) = −706, 챔피언은 절반', () => {
    const { game } = setup({ rarm: item('axe', [{ stat: 'item_openwounds', value: 100 }]) });
    const a = tough(game);
    hit(game, a);
    expect(a.states.get('openwounds')?.stats.hpregen).toBe(-706);
    const b = tough(game, 'zombie1', 24.5);
    b.flags |= 4;
    hit(game, b);
    expect(b.states.get('openwounds')?.stats.hpregen).toBe(-353);
  });

  it('방어 무시: 일반 몬스터 방어 0, 유니크는 그대로 · 방어 감소 30%: 보스 계열은 절반(15%)', () => {
    const ign = setup({ rarm: item('axe', [{ stat: 'item_ignoretargetac', value: 1 }]) }).game;
    const z = tough(ign);
    z.stats.defense = 400;
    expect(off(ign).targetDefense(z, false)).toBe(0);
    z.flags |= 8;
    expect(off(ign).targetDefense(z, false)).toBe(400);
    const fr = setup({ rarm: item('axe', [{ stat: 'item_fractionaltargetac', value: 30 }]) }).game;
    const y = tough(fr);
    y.stats.defense = 400;
    expect(off(fr).targetDefense(y, false)).toBe(280);
    y.flags |= 2;
    expect(off(fr).targetDefense(y, false)).toBe(340);
  });

  it('악마 피해 100%: 악마(Fallen)에게만, 언데드에게 둔기 +50', () => {
    const { game } = setup({ lrin: item('rin', [{ stat: 'item_demondamage_percent', value: 100 }]) });
    const fallen = tough(game, 'fallen1'), zombie = tough(game, 'zombie1', 24.5);
    expect(off(game).vsTypeDamagePct(fallen, undefined)).toBe(100);
    expect(off(game).vsTypeDamagePct(zombie, undefined)).toBe(0);
    expect(off(game).vsTypeDamagePct(zombie, lod.items.base('mac'))).toBe(50);
  });

  it('감속 100: 일반 몬스터 90, 챔피언 50 상한', () => {
    const { game } = setup({ rarm: item('axe', [{ stat: 'item_slow', value: 100 }]) });
    const a = tough(game);
    hit(game, a);
    expect(a.states.get('slowed')?.stats.velocitypercent).toBe(-90);
    const b = tough(game, 'zombie1', 24.5);
    b.flags |= 4;
    hit(game, b);
    expect(b.states.get('slowed')?.stats.velocitypercent).toBe(-50);
  });

  it('회복 불가: 몬스터 재생이 멈추고 독은 계속 들어간다', () => {
    const { game } = setup({ rarm: item('axe', [{ stat: 'item_preventheal', value: 1 }]) });
    const z = tough(game);
    (game as unknown as { onPlayerHitMonster(m: MonsterUnit): void }).onPlayerHitMonster(z);
    expect(z.states.has('preventheal')).toBe(true);
    z.hp = 500;
    for (let i = 0; i < 50; i++) game.tick();
    expect(z.hp).toBe(500);
    z.states.set('poison', 1e9, { hpregen: -256 });
    for (let i = 0; i < 10; i++) game.tick();
    expect(z.hp).toBeLessThan(500);
  });

  it('밀쳐내기: 작은 몬스터는 늘 밀려난다 (확률 128/128)', () => {
    const { game } = setup({ rarm: item('axe', [{ stat: 'item_knockback', value: 1 }]) });
    const z = tough(game);
    z.type = { ...z.type, small: true, large: false };
    const x0 = z.x;
    hit(game, z);
    expect(z.x).toBeGreaterThan(x0);
  });

  it('편히 쉬어라: 처치한 몬스터 시체를 쓸 수 없다', () => {
    const { game } = setup({ rarm: item('axe', [{ stat: 'item_restinpeace', value: 1 }]) });
    const z = tough(game);
    off(game).killMonster(z, 'player');
    expect(z.corpseUsed).toBe(true);
  });

  it('되살리기 100% (param = MonStats 번호): 처치하면 그 몬스터가 소환수로 생긴다', () => {
    const z0 = lod.monsters.get('zombie1');
    const { game } = setup({ rarm: item('axe', [{ stat: 'item_reanimate', param: z0.hcIdx, value: 100 }]) });
    const z = tough(game);
    const before = off(game).pets.length;
    off(game).killMonster(z, 'player');
    expect(off(game).pets.length).toBe(before + 1);
    expect(off(game).pets.at(-1)?.type.id).toBe('zombie1');
  });

  it('마법 화살: 활 기본 공격이 화살 없이도 시작된다 (폭발 화살은 화살 필요)', () => {
    const bow = item('sbw', [], QUALITY.NORMAL);
    const a = setup({ rarm: item('sbw', [{ stat: 'item_magicarrow', value: 5 }]) });
    expect(off(a.game).startCheck(lod.skills!.byId.get(0), undefined)).toBe(true);
    const b = setup({ rarm: bow });
    expect(off(b.game).startCheck(lod.skills!.byId.get(0), undefined)).toBe(false);
  });
});
