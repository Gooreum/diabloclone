// 어쌔신 스킬 (원작 1.14d LoD): 시퀀스·버프·단발 스킬·무술 차지·피니셔·함정·그림자.
// 확장팩 MPQ 체인 (game-data/lod/patch_d2 + d2exp) 이 있어야 실행된다.
// 출처: 확장팩 skills.txt / states.txt / missiles.txt / monstats.txt, D2MOO source/D2Game/src/SKILLS/SkillAss.cpp · SkillSor.cpp SrvDo018
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { buildGameData } from '../../src/data/gamedata';
import { GameTables } from '../../src/data/tables';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { GAME_DATA } from '../support/gamedata';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable, type ClassName } from '../../src/engine/player';
import { PLAYER_SEQUENCES } from '../../src/engine/skills/sequences';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import type { MonsterUnit } from '../../src/engine/ai/types';
import type { StateList } from '../../src/engine/states';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));

let tables: GameTables;
let lod: GameData;

beforeAll(() => {
  if (!hasLod) return;
  const chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
  tables = new GameTables(chain);
  lod = buildGameData(chain, tables, { expansion: true });
});

/** 게임 내부 (테스트용) */
interface Inner {
  player: { x: number; y: number; mode: string; states: StateList; cast: unknown };
  events: { type: string; [k: string]: unknown }[];
  monsters: MonsterUnit[];
  pets: MonsterUnit[];
  missiles: { def: { name: string }; owner: string }[];
}

const S = (name: string) => lod.skills!.byNameOf(name)!;
const item = (code: string, lvl = 30) => lod.treasure.createItem(lod.items.base(code)!, lvl, new Rng(2), QUALITY.NORMAL, false);

function game(opts: { cls?: ClassName; skills?: Record<string, number>; level?: number; equipment?: Record<string, ItemInstance>; inTown?: boolean } = {}): { g: Game; inner: Inner } {
  const cls = opts.cls ?? 'Assassin';
  const cs = classStats(tables.table('charstats'), cls);
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 30;
  ch.maxMana = ch.mana = 1000;
  for (const [n, l] of Object.entries(opts.skills ?? {})) ch.skills[S(n).id] = l;
  const g = new Game({
    map: new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 7, data: lod, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls),
    equipment: opts.equipment ?? { rarm: item('ktr') }, inTown: opts.inTown ?? false,
  });
  g.tick();
  return { g, inner: g as unknown as Inner };
}

function cast(g: Game, name: string, x: number, y: number, targetId?: number, ticks = 40): void {
  g.enqueue({ type: 'useSkill', skill: S(name).id, hand: 'right', x, y, ...(targetId !== undefined ? { targetId } : {}) });
  const evs: string[] = [];
  for (let i = 0; i < ticks; i++) { g.tick(); for (const e of (g as unknown as Inner).events) evs.push(e.type + (e.reason ? ':' + e.reason : '')); }
  if (process.env.DBG) console.log('CAST', name, [...new Set(evs)].join(','));
}

/** 일반 공격 한 번 (attack 명령) */
function hit(g: Game, m: MonsterUnit, ticks = 30): void {
  g.enqueue({ type: 'attack', targetId: m.id, standStill: true });
  for (let i = 0; i < ticks; i++) g.tick();
}

/** 움직이지 않는 튼튼한 몬스터 */
function dummy(g: Game, x = 22.5, y = 20.5, id = 'zombie1'): MonsterUnit {
  const m = g.spawnMonster(id, x, y) as unknown as MonsterUnit;
  m.hp = m.stats.maxHp = 100000;
  m.nextThink = Number.POSITIVE_INFINITY;
  m.hpRegen = false;
  return m;
}

describe.skipIf(!hasLod)('Phase 1 — 시퀀스·버프·지연', () => {
  it('seqnum 16·19·21·23 시퀀스: Dragon Claw HT1·HT2, Dragon Talon(KK), Dragon Flight, Blade Fury', () => {
    expect(PLAYER_SEQUENCES[16]?.HT1?.length).toBeGreaterThan(0);
    expect(PLAYER_SEQUENCES[16]?.HT2?.some((f) => f[0] === 'S4')).toBe(true);
    expect(PLAYER_SEQUENCES[19]?.HTH?.every((f) => f[0] === 'KK')).toBe(true);
    expect(PLAYER_SEQUENCES[21]?.HT1?.length).toBeGreaterThan(0);
    expect(PLAYER_SEQUENCES[23]?.HT1?.filter((f) => f[2] === 1)).toHaveLength(1);
  });

  it('클래식 seq 1~15 는 그대로 (Jab·Inferno 시퀀스)', () => {
    expect(Object.keys(PLAYER_SEQUENCES).map(Number).filter((n) => n < 16)).toHaveLength(15);
    expect(PLAYER_SEQUENCES[1]).toBeDefined();
  });

  it('Burst of Speed 뒤 Fade: 같은 states group(2) 이라 quickness 가 지워진다, Fade 는 저항·passivestat fade 를 단다', () => {
    const { g, inner } = game({ skills: { Quickness: 5, Fade: 5 } });
    cast(g, 'Quickness', 20.5, 20.5);
    expect(inner.player.states.has('quickness')).toBe(true);
    expect(inner.player.states.stat('velocitypercent')).toBeGreaterThan(0);
    cast(g, 'Fade', 20.5, 20.5);
    expect(inner.player.states.has('quickness')).toBe(false);
    expect(inner.player.states.has('fade')).toBe(true);
    expect(inner.player.states.stat('fireresist')).toBeGreaterThan(0);
    expect(inner.player.states.stat('fade')).toBe(2);
  });

  it('회귀: Frozen Armor 뒤 Shiver Armor — 아머는 하나만 (states group 1)', () => {
    const { g, inner } = game({ cls: 'Sorceress', skills: { 'Frozen Armor': 1, 'Shiver Armor': 1 }, equipment: {} });
    cast(g, 'Frozen Armor', 20.5, 20.5);
    cast(g, 'Shiver Armor', 20.5, 20.5);
    expect([inner.player.states.has('frozenarmor'), inner.player.states.has('shiverarmor')]).toEqual([false, true]);
  });

  it('Venom: 근접 명중에 독 (몬스터 poison 상태), Venom 이 없으면 독 없음', () => {
    const run = (venom: boolean) => {
      const { g, inner } = game({ skills: venom ? { Venom: 10 } : {} });
      if (venom) cast(g, 'Venom', 20.5, 20.5);
      expect(inner.player.states.has('venomclaws')).toBe(venom);
      const z = dummy(g, 21.5, 20.5);
      for (let k = 0; k < 10 && !z.states.has('poison'); k++) hit(g, z);
      return z.states.has('poison');
    };
    expect(run(true)).toBe(true);
    expect(run(false)).toBe(false);
  });

  it('스킬 지연: Blade Sentinel(delay 50) 직후 다시 쓸 수 없고 50 프레임 뒤엔 풀린다', () => {
    const { g, inner } = game({ skills: { 'Blade Sentinel': 1, 'Dragon Flight': 1 } });
    cast(g, 'Blade Sentinel', 25.5, 20.5, undefined, 1);
    expect(inner.player.states.has('skilldelay')).toBe(true);
    for (let i = 0; i < 30; i++) g.tick();
    inner.events.length = 0;
    cast(g, 'Blade Sentinel', 25.5, 20.5, undefined, 1);
    expect(inner.events.some((e) => e.type === 'skillUnusable' && e.reason === 'delay')).toBe(true);
    for (let i = 0; i < 60; i++) g.tick();
    expect(inner.player.states.has('skilldelay')).toBe(false);
  });
});

describe.skipIf(!hasLod)('Phase 1 — 단발 스킬', () => {
  it('Psychic Hammer: 대상 생명 감소 (명중 굴림 없음), 마을에서는 쓸 수 없다', () => {
    const { g } = game({ skills: { 'Psychic Hammer': 10 } });
    const z = dummy(g, 26.5, 20.5);
    const hp = z.hp;
    cast(g, 'Psychic Hammer', z.x, z.y, z.id);
    expect(z.hp).toBeLessThan(hp);
    const town = game({ skills: { 'Psychic Hammer': 10 }, inTown: true });
    const t = dummy(town.g, 26.5, 20.5);
    const mana = town.g.character!.mana;
    cast(town.g, 'Psychic Hammer', t.x, t.y, t.id);
    expect([t.hp, town.g.character!.mana]).toEqual([100000, mana]);
  });

  it('Cloak of Shadows: 자신 cloak_of_shadows, 반경 안 몬스터 cloaked (방어 −%), 걸린 동안 다시 쓰면 그대로', () => {
    const { g, inner } = game({ skills: { 'Cloak of Shadows': 5 } });
    const near = dummy(g, 24.5, 20.5), far = dummy(g, 70.5, 70.5);
    cast(g, 'Cloak of Shadows', 20.5, 20.5);
    expect(inner.player.states.has('cloak_of_shadows')).toBe(true);
    expect(near.states.has('cloaked')).toBe(true);
    expect(near.states.stat('skill_armor_percent')).toBeLessThan(0);
    expect(far.states.has('cloaked')).toBe(false);
    const until = inner.player.states.get('cloak_of_shadows')!.until;
    cast(g, 'Cloak of Shadows', 20.5, 20.5);
    expect(inner.player.states.get('cloak_of_shadows')!.until).toBe(until);
  });

  it('Mind Blast: 높은 레벨이면 Fallen 일부가 편(conversion), 유니크·switchai 0 몬스터는 전향되지 않는다', () => {
    const { g } = game({ skills: { 'Mind Blast': 20 } });
    const fallen = [0, 1, 2, 3, 4, 5].map((i) => dummy(g, 26.5 + (i % 3), 20.5 + Math.floor(i / 3), 'fallen1'));
    const uniq = dummy(g, 27.5, 22.5, 'fallen1');
    uniq.flags |= 8;
    for (let k = 0; k < 6; k++) cast(g, 'Mind Blast', 27.5, 21.5, undefined, 60);
    expect(fallen.some((m) => m.states.has('conversion'))).toBe(true);
    expect(uniq.states.has('conversion')).toBe(false);
    expect(uniq.hp).toBeLessThan(100000);
    expect(lod.monsters.get('fallen1').switchAi).toBe(true);
  });

  it('Blade Fury: 누르고 있는 동안 prgcalc1 프레임 간격으로 bladefragment1, 발사마다 마나', () => {
    const { g, inner } = game({ skills: { 'Blade Fury': 5 } });
    const bf = S('Blade Fury');
    const c = g.character!;
    const seen = new Set<unknown>();
    const cost = lod.skillCalc!.manaCost256(bf, 5) / 256;
    const fireTicks: number[] = [];
    for (let i = 0; i < 60; i++) {
      g.enqueue({ type: 'useSkill', skill: bf.id, hand: 'right', x: 40.5, y: 20.5 });
      const before = c.mana, n = seen.size;
      g.tick();
      for (const m of inner.missiles) if (m.def.name === 'bladefragment1') seen.add(m);
      // 발사한 프레임에만 마나 (재생 한 프레임 오차), 쏘지 않은 프레임은 줄지 않는다
      if (seen.size > n) {
        fireTicks.push(i);
        expect(before - c.mana).toBeGreaterThan(cost - 0.5);
      } else expect(c.mana).toBeGreaterThanOrEqual(before - 1e-9);
    }
    expect(seen.size).toBeGreaterThan(3);
    // 발사 간격 = prgcalc1 (par4 = 5) 프레임
    const gaps = fireTicks.slice(1).map((t, i) => t - (fireTicks[i] as number));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(4);
  });

  it('Blade Shield: bladeshield 상태, 곁의 몬스터가 주기마다 피해', () => {
    const { g, inner } = game({ skills: { 'Blade Shield': 10 } });
    const z = dummy(g, 22.5, 20.5);
    z.stats.defense = 0;
    cast(g, 'Blade Shield', 20.5, 20.5);
    expect(inner.player.states.has('bladeshield')).toBe(true);
    const hp = z.hp;
    for (let i = 0; i < 200; i++) g.tick();
    expect(z.hp).toBeLessThan(hp);
  });
});

describe.skipIf(!hasLod)('Phase 2 — 무술 차지', () => {
  /** 차지 스킬로 n번 명중시킨다 (방어 0 몬스터) */
  function charge(g: Game, name: string, m: MonsterUnit, n: number): void {
    for (let i = 0; i < n; i++) cast(g, name, m.x, m.y, m.id, 40);
  }
  const target = (g: Game) => {
    const z = dummy(g, 21.5, 20.5);
    z.stats.defense = 0;
    z.stats.level = 1;
    return z;
  };
  const chargesOf = (g: Game, state: string) => (g as unknown as { chargeCount(s: string): number }).chargeCount(state);
  const missilesNamed = (inner: Inner, name: string) => inner.missiles.filter((m) => m.def.name === name).length;

  it('Tiger Strike: 명중마다 차지 +1, 최대 3', () => {
    const { g } = game({ skills: { 'Tiger Strike': 5 } });
    const z = target(g);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      charge(g, 'Tiger Strike', z, 1);
      seen.push(chargesOf(g, 'progressive_damage'));
    }
    expect(seen).toEqual([1, 2, 3, 3]);
  });

  it('Tiger 3차지 뒤 일반 공격: 피해 % 가 3 × calc1 늘고 차지가 풀린다, 차지 없는 공격은 그대로', () => {
    const run = (n: number) => {
      const { g, inner } = game({ skills: { 'Tiger Strike': 5 } });
      const z = target(g);
      charge(g, 'Tiger Strike', z, n);
      const spec = (g as unknown as { withCharges(s: object): { enDmgPct: number } }).withCharges({ toHitPct: 0, enDmgPct: 0, flat256: 0, elem: null, hitClass: 0, srcDam: 128 });
      const evs: string[] = [];
      for (let k = 0; k < 5 && chargesOf(g, 'progressive_damage') > 0; k++) {
        g.enqueue({ type: 'attack', targetId: z.id, standStill: true });
        for (let i = 0; i < 30; i++) {
          g.tick();
          for (const e of inner.events) evs.push(e.type);
        }
      }
      return { pct: spec.enDmgPct, left: chargesOf(g, 'progressive_damage'), released: evs.includes('chargeRelease') };
    };
    const calc1 = lod.skillCalc!.calc(S('Tiger Strike'), 1, 5, { baseLevel: () => 5, skillLevel: () => 5, unitLevel: 30 });
    expect(run(3)).toEqual({ pct: 3 * calc1, left: 0, released: true });
    expect(run(0)).toEqual({ pct: 0, left: 0, released: false });
  });

  it('Cobra Strike: 1차지 생명 흡수만, 2차지 생명·마나 (par1 + (lvl−1)·par2)', () => {
    const { g } = game({ skills: { 'Cobra Strike': 3 } });
    const z = target(g);
    const leech = () => (g as unknown as { withCharges(s: object): { leech?: { life: number; mana: number } } }).withCharges({ toHitPct: 0, enDmgPct: 0, flat256: 0, elem: null, hitClass: 0, srcDam: 128 }).leech;
    const cb = S('Cobra Strike'), v = cb.params[0]! + 2 * cb.params[1]!;
    charge(g, 'Cobra Strike', z, 1);
    expect(leech()).toEqual({ life: v, mana: 0 });
    charge(g, 'Cobra Strike', z, 1);
    expect(leech()).toEqual({ life: v, mana: v });
  });

  it('Fists of Fire 3차지 풀기: prgstack 이라 2차지 범위 피해 + 3차지 불길 미사일', () => {
    const { g, inner } = game({ skills: { 'Fists of Fire': 5 } });
    const z = target(g);
    const other = dummy(g, 22.5, 21.5);
    charge(g, 'Fists of Fire', z, 3);
    expect(chargesOf(g, 'progressive_fire')).toBe(3);
    const hp = other.hp;
    g.enqueue({ type: 'attack', targetId: z.id, standStill: true });
    let walls = 0;
    for (let i = 0; i < 30; i++) {
      g.tick();
      walls = Math.max(walls, missilesNamed(inner, 'fistsoffirefirewall'));
    }
    expect(chargesOf(g, 'progressive_fire')).toBe(0);
    expect(walls).toBeGreaterThan(0);
    expect(other.hp).toBeLessThan(hp);
  });

  it('Claws of Thunder 2차지: 노바 미사일, Blades of Ice 3차지: 얼음 조각', () => {
    const release = (skill: string, state: string, n: number, missile: string) => {
      const { g, inner } = game({ skills: { [skill]: 5 } });
      const z = target(g);
      charge(g, skill, z, n);
      expect(chargesOf(g, state)).toBe(n);
      g.enqueue({ type: 'attack', targetId: z.id, standStill: true });
      let seen = 0;
      for (let i = 0; i < 30; i++) {
        g.tick();
        seen = Math.max(seen, missilesNamed(inner, missile));
      }
      return seen;
    };
    expect(release('Claws of Thunder', 'progressive_lightning', 2, 'clawsofthundernova')).toBeGreaterThan(0);
    expect(release('Blades of Ice', 'progressive_cold', 3, 'bladesoficecubes')).toBeGreaterThan(0);
  });

  it('Phoenix Strike: 1차지 운석 표적, 2차지 연쇄 번개, 3차지 얼음 조각 prgcalc3 개', () => {
    const release = (n: number) => {
      const { g, inner } = game({ skills: { 'Royal Strike': 5 } });
      const z = target(g);
      charge(g, 'Royal Strike', z, n);
      g.enqueue({ type: 'attack', targetId: z.id, standStill: true });
      const names = new Map<string, number>();
      for (let i = 0; i < 30; i++) {
        g.tick();
        for (const m of inner.missiles) names.set(m.def.name, Math.max(names.get(m.def.name) ?? 0, inner.missiles.filter((x) => x.def.name === m.def.name).length));
      }
      return names;
    };
    expect(release(1).has('royalstrikemeteorcenter')).toBe(true);
    expect(release(2).get('royalstrikechainlightning')).toBeGreaterThan(0);
    const rs = S('Royal Strike');
    expect(release(3).get('royalstrikechaosice')).toBe(lod.skillCalc!.eval(rs, rs.prgCalc[2]!, 5, { baseLevel: () => 5, skillLevel: () => 5, unitLevel: 30 }));
  });

  it('차지는 auralencalc 프레임(375) 뒤 사라진다', () => {
    const { g } = game({ skills: { 'Tiger Strike': 5 } });
    const z = target(g);
    charge(g, 'Tiger Strike', z, 2);
    for (let i = 0; i < 340; i++) g.tick();
    expect(chargesOf(g, 'progressive_damage')).toBe(2);
    for (let i = 0; i < 40; i++) g.tick();
    expect(chargesOf(g, 'progressive_damage')).toBe(0);
  });
});
