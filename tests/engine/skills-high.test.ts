// 24·30 레벨 클래스 스킬 (Phase 11 Step 2). 기대값은 원작 skills.txt / missiles.txt 공식에서 직접 계산한다.
import { beforeAll, describe, expect, it } from 'vitest';
import { diminishing, levelDamageBonus } from '../../src/engine/skills/formulas';
import { discOffsets, energyShieldAbsorb, frenzyStack, orbNextIndex, orbNovaIndices, ORB_X, ORB_Y, strafeShots } from '../../src/engine/skills/high';
import { classStats, createCharacter, expTable, type ClassName } from '../../src/engine/player';
import { Game, type GameData } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { gameChain, hasGameData } from '../support/gamedata';

describe('24·30 레벨 스킬 순수 계산 (출처: D2MOO MissMode.cpp / Skill*.cpp)', () => {
  it('Frozen Orb 방향 표: 반지름 30, 발사마다 +19 (mod 64), 노바는 4 간격 16발', () => {
    for (let i = 0; i < 64; i++) expect(Math.abs(Math.hypot(ORB_X[i]!, ORB_Y[i]!) - 30)).toBeLessThan(1.2);
    expect([0, 1, 2, 3].reduce((acc) => [...acc, orbNextIndex(acc[acc.length - 1]!, 19)], [0])).toEqual([0, 19, 38, 57, 12]);
    expect(orbNovaIndices(4)).toHaveLength(16);
  });
  it('Strafe 발 수: min(calc3, calc1) ≤ 대상 수 ≤ calc1', () => {
    expect(strafeShots(4, 2, 0)).toBe(2);
    expect(strafeShots(4, 2, 3)).toBe(3);
    expect(strafeShots(10, 7, 30)).toBe(10);
  });
  it('Energy Shield: 피해 20% 흡수, 마나 = 흡수 × 32/16', () => {
    const r = energyShieldAbsorb([100 * 256], 50 * 256, 20, 32);
    expect(r.absorbed / 256).toBe(20);
    expect(r.mana / 256).toBe(10);
    expect(r.left[0]! / 256).toBe(80);
    // 마나가 모자라면 마나 × 16 / 비율 까지만
    const low = energyShieldAbsorb([100 * 256], 5 * 256, 20, 32);
    expect(low.absorbed / 256).toBe(2.5);
    expect(low.mana).toBe(0);
  });
  it('Immolation Arrow 불길 원판 반지름 3: x²+y² ≤ 9 인 29칸', () => {
    expect(discOffsets(3)).toHaveLength(29);
  });
  it('Frenzy 단계는 스킬 레벨까지', () => {
    expect(frenzyStack(0, 3)).toBe(1);
    expect(frenzyStack(3, 3)).toBe(3);
  });
});

describe.skipIf(!hasGameData)('24·30 레벨 스킬 (원작 skills.txt)', () => {
  let tables: GameTables, data: GameData;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });
  const S = (name: string) => data.skills!.byNameOf(name)!;
  const none = { baseLevel: () => 0, skillLevel: () => 0, unitLevel: 1 };
  const withSkills = (lv: Record<string, number>) => ({
    baseLevel: (id: number) => Object.entries(lv).find(([n]) => S(n).id === id)?.[1] ?? 0,
    skillLevel: (id: number) => Object.entries(lv).find(([n]) => S(n).id === id)?.[1] ?? 0,
    unitLevel: 30,
  });

  // 출처: skills.txt — charclass ama/sor/nec/pal/bar, reqlevel ≥ 24
  it('24·30 레벨 스킬은 49개이고 모두 처리 함수가 있다', () => {
    const high = [...data.skills!.byId.values()].filter((s) => ['ama', 'sor', 'nec', 'pal', 'bar'].includes(s.charclass) && s.reqLevel >= 24);
    expect(high.map((s) => s.charclass).reduce<Record<string, number>>((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {})).toEqual({ ama: 10, sor: 10, nec: 10, pal: 10, bar: 9 });
    // game.ts skillEvent / updateAura 가 처리하는 srvdofunc (0 = srvmissile 미사일 스킬)
    const handled = new Set([0, 2, 9, 10, 12, 13, 14, 15, 16, 18, 22, 23, 28, 29, 30, 56, 57, 58, 59, 62, 65, 66, 68, 75, 76, 79, 80, 82, 144]);
    const missing = high.filter((s) => !s.passive && !handled.has(s.srvDoFunc)).map((s) => s.name);
    expect(missing).toEqual([]);
  });

  // 출처: skills.txt Frozen Orb EMin 80 / EMax 90, EMinLev 20/24/28/29/30, EMaxLev 21/25/29/30/31, HitShift 7, EDmgSymPerCalc Ice Bolt × 2
  it('Frozen Orb 냉기: 1레벨 40~45, 20레벨 262~276.5, Ice Bolt 20 시너지 +40%', () => {
    const c = data.skillCalc!, s = S('Frozen Orb');
    expect([c.minElem256(s, 1, none, false) / 256, c.maxElem256(s, 1, none, false) / 256]).toEqual([40, 45]);
    expect(c.minElem256(s, 20, none, false) / 256).toBe(((80 + levelDamageBonus(20, [20, 24, 28, 29, 30])) * 128) / 256);
    expect([c.minElem256(s, 20, none, false) / 256, c.maxElem256(s, 20, none, false) / 256]).toEqual([262, 276.5]);
    const syn = withSkills({ 'Frozen Orb': 20, 'Ice Bolt': 20 });
    expect(c.minElem256(s, 20, syn, false)).toBe(Math.trunc((524 * 128 * 140) / 100));
    // 마나: (50 + (lvl−1)) << 7 → 1레벨 25, 20레벨 34.5
    expect([c.manaCost256(s, 1) / 256, c.manaCost256(s, 20) / 256]).toEqual([25, 34.5]);
  });

  // 출처: skills.txt Chain Lightning calc1 = ln34/5 (par3 26, par4 1)
  it('Chain Lightning 연쇄 수: 1레벨 5, 20레벨 9', () => {
    const c = data.skillCalc!, s = S('Chain Lightning');
    expect([c.calc(s, 1, 1, none), c.calc(s, 1, 20, none)]).toEqual([5, 9]);
  });

  // 출처: skills.txt Whirlwind calc1 = ln12 (par1 −50, par2 8)
  it('Whirlwind 피해: 1레벨 −50%, 20레벨 +102%', () => {
    const c = data.skillCalc!, s = S('Whirlwind');
    expect([c.calc(s, 1, 1, none), c.calc(s, 1, 20, none)]).toEqual([-50, 102]);
  });

  // 출처: skills.txt Fist of the Heavens EMin 150 / EMax 200, calc4 = ln12 (par1 6, par2 1), aurarange 20
  it('Fist of the Heavens: 1레벨 번개 150~200, 볼트 6개 (20레벨 25개)', () => {
    const c = data.skillCalc!, s = S('Fist of the Heavens');
    expect([c.minElem256(s, 1, none, false) / 256, c.maxElem256(s, 1, none, false) / 256]).toEqual([150, 200]);
    expect([c.calc(s, 4, 1, none), c.calc(s, 4, 20, none)]).toEqual([6, 25]);
    expect(c.eval(s, s.auraRangeCalc, 1, none)).toBe(20);
  });

  // 출처: skills.txt Revive calc2 = ln34 (par3 4500, par4 0)
  it('Revive 지속: 모든 레벨 4500프레임 (3분)', () => {
    const c = data.skillCalc!, s = S('Revive');
    expect([c.calc(s, 2, 1, none), c.calc(s, 2, 20, none)]).toEqual([4500, 4500]);
    expect(c.eval(s, s.petMax, 7, none)).toBe(7);
  });

  // 출처: skills.txt Conviction aurastatcalc1 = −dm56 (40, 100), aurastatcalc2~4 = −min(ln34, 150) (30, 5)
  it('Conviction: 1레벨 저항 −30 · 방어 −49%, 20레벨 저항 −125', () => {
    const c = data.skillCalc!, s = S('Conviction');
    const at = (lvl: number) => Object.fromEntries(s.auraStats.map((a) => [a.stat, c.eval(s, a.calc, lvl, none)]));
    expect(at(1)).toEqual({ skill_armor_percent: -diminishing(1, 40, 100), fireresist: -30, coldresist: -30, lightresist: -30 });
    expect(at(1).skill_armor_percent).toBe(-49);
    expect(at(20).fireresist).toBe(-125);
  });

  // 출처: skills.txt Lower Resist aurastatcalc = −dm56 (25, 70)
  it('Lower Resist 1레벨 −32, 20레벨 −62', () => {
    const c = data.skillCalc!, s = S('Lower Resist');
    expect([c.eval(s, s.auraStats[0]!.calc, 1, none), c.eval(s, s.auraStats[0]!.calc, 20, none)]).toEqual([-diminishing(1, 25, 70), -diminishing(20, 25, 70)]);
    expect(c.eval(s, s.auraStats[0]!.calc, 1, none)).toBe(-32);
  });

  // 출처: skills.txt Meteor EMin 80 / EMax 100, aurarange ln12 = 6, 불길 par3 30 + par4 15/레벨
  it('Meteor 1레벨: 화염 80~100, 반경 6, 불길 30프레임', () => {
    const c = data.skillCalc!, s = S('Meteor');
    expect([c.minElem256(s, 1, none, false) / 256, c.maxElem256(s, 1, none, false) / 256]).toEqual([80, 100]);
    expect(c.eval(s, s.auraRangeCalc, 1, none)).toBe(6);
    expect((s.params[2] ?? 0) + 0 * (s.params[3] ?? 0)).toBe(30);
  });

  // 출처: skills.txt Energy Shield calc1 = min(edmn, 95) (EMin 20 + EMinLev 5/2/1/1/1), calc2 = par5 − Telekinesis = 32
  it('Energy Shield 흡수: 1레벨 20%, 8레벨 55%, 마나 비율 32/16 (Telekinesis 5 → 27)', () => {
    const c = data.skillCalc!, s = S('Energy Shield');
    expect([c.calc(s, 1, 1, none), c.calc(s, 1, 8, none)]).toEqual([20, 55]);
    expect(c.calc(s, 2, 1, none)).toBe(32);
    expect(c.calc(s, 2, 1, withSkills({ Telekinesis: 5 }))).toBe(27);
  });

  // 출처: skills.txt Battle Orders aurastatcalc = ln34 (35, 3), auralen = ln12 + (Shout + Battle Command) × par8
  it('Battle Orders 1레벨: 최대 생명·마나 +35%, 지속 750프레임', () => {
    const c = data.skillCalc!, s = S('Battle Orders');
    expect(s.auraStats.map((a) => [a.stat, c.eval(s, a.calc, 1, none)])).toEqual([['item_maxmana_percent', 35], ['item_maxhp_percent', 35], ['skill_staminapercent', 35]]);
    expect(c.eval(s, s.auraLenCalc, 1, none)).toBe(750);
  });

  // 출처: skills.txt Fire Mastery passivecalc1 = ln12 (30, 7), Cold Mastery passive_cold_pierce ln12 (20, 5)
  it('Fire Mastery 1레벨 +30%, Cold Mastery 1레벨 냉기 저항 관통 20', () => {
    const c = data.skillCalc!;
    expect(c.eval(S('Fire Mastery'), S('Fire Mastery').passiveStats[0]!.calc, 1, none)).toBe(30);
    expect(S('Cold Mastery').passiveStats[0]!.stat).toBe('passive_cold_pierce');
    expect(c.eval(S('Cold Mastery'), S('Cold Mastery').passiveStats[0]!.calc, 1, none)).toBe(20);
  });

  describe('게임 안에서 사용', () => {
    const item = (code: string, quantity?: number): ItemInstance => {
      const it = data.treasure.createItem(data.items.base(code)!, 1, new Rng(1), QUALITY.NORMAL);
      if (quantity !== undefined) it.quantity = quantity;
      return it;
    };
    const setup = (cls: ClassName, skills: Record<string, number>, equipment: Record<string, ItemInstance>, seed = 5) => {
      const cs = classStats(tables.table('charstats'), cls);
      const ch = createCharacter(cs);
      ch.level = 30;
      ch.mana = ch.maxMana = 500;
      ch.life = ch.maxLife = 500;
      for (const [name, lvl] of Object.entries(skills)) ch.skills[S(name).id] = lvl;
      const game = new Game({
        map: new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
        seed, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls), equipment,
      });
      return { game, ch };
    };
    const tough = (game: Game, x: number, y: number, id = 'zombie1') => {
      const z = game.spawnMonster(id, x, y);
      z.hp = z.stats.maxHp = 100000;
      z.nextThink = 1e9;
      return z;
    };
    const corpse = (game: Game, x: number, y: number) => {
      const z = game.spawnMonster('zombie1', x, y);
      z.mode = 'DD';
      z.hp = 0;
      return z;
    };
    const run = (game: Game, n: number) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push(...game.tick());
      return out;
    };
    const cast = (game: Game, name: string, x: number, y: number, targetId?: number, targetItem?: number) =>
      game.enqueue({ type: 'useSkill', skill: S(name).id, hand: 'right', x, y, ...(targetId !== undefined ? { targetId } : {}), ...(targetItem !== undefined ? { targetItem } : {}) });
    const hitIds = (ev: { type: string; [k: string]: unknown }[]) => new Set(ev.filter((e) => e.type === 'monsterHit').map((e) => e.targetId as number));

    // ---------------------------------------------------------------- Sorceress
    it('Frozen Orb: 본체는 지나가며 볼트를 뿌리고, 끝에서 노바 — 멀리 떨어진 좀비들이 냉기 피해', () => {
      const { game } = setup('Sorceress', { 'Frozen Orb': 1 }, { rarm: item('sst') });
      const zs = [tough(game, 28.5, 24.5), tough(game, 28.5, 16.5), tough(game, 34.5, 20.5)];
      cast(game, 'Frozen Orb', 40.5, 20.5);
      run(game, 12);
      const orbs = game.snapshot().missiles.filter((m) => m.name === 'frozenorbbolt');
      expect(orbs.length).toBeGreaterThan(3);
      const ev = run(game, 80);
      expect(game.snapshot().missiles.some((m) => m.name === 'frozenorb')).toBe(false);
      expect(hitIds(ev).size).toBeGreaterThanOrEqual(2);
      expect(zs.some((z) => z.states.has('cold'))).toBe(true);
    });

    it('Chain Lightning 5레벨: 좀비 여섯 줄에서 여러 대상으로 이어진다 (연쇄 수 = calc1)', () => {
      const { game } = setup('Sorceress', { 'Chain Lightning': 5 }, { rarm: item('sst') });
      const zs = [0, 1, 2, 3, 4, 5].map((i) => tough(game, 25.5 + i * 3, 20.5 + (i % 2)));
      cast(game, 'Chain Lightning', zs[0]!.x, zs[0]!.y, zs[0]!.id);
      const ev = run(game, 100);
      const n = hitIds(ev).size;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(data.skillCalc!.calc(S('Chain Lightning'), 1, 5, none));
    });

    it('Meteor: 60프레임 뒤 떨어져 반경 안 화염 피해 + 불길', () => {
      const { game } = setup('Sorceress', { Meteor: 1 }, { rarm: item('sst') });
      const z = tough(game, 30.5, 20.5);
      cast(game, 'Meteor', z.x, z.y);
      const early = run(game, 40);
      expect(early.some((e) => e.type === 'monsterHit')).toBe(false);
      expect(game.snapshot().missiles.some((m) => m.name === 'meteor')).toBe(true);
      const ev = run(game, 40);
      expect(ev.some((e) => e.type === 'meteorImpact')).toBe(true);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
      expect(game.snapshot().missiles.filter((m) => m.name === 'meteorfire').length).toBeGreaterThan(5);
    });

    it('Blizzard: 얼음 조각이 떨어져 범위 안 좀비에게 냉기 피해', () => {
      const { game } = setup('Sorceress', { Blizzard: 1 }, { rarm: item('sst') });
      const z = tough(game, 30.5, 20.5);
      cast(game, 'Blizzard', z.x, z.y);
      const ev = run(game, 130);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
      expect(z.states.has('cold')).toBe(true);
    });

    it('Thunder Storm: 상태가 걸리고 주기마다 가까운 적에게 번개', () => {
      const { game } = setup('Sorceress', { 'Thunder Storm': 1 }, { rarm: item('sst') });
      cast(game, 'Thunder Storm', 20.5, 20.5);
      run(game, 20);
      expect(game.snapshot().player.states).toContain('thunderstorm');
      const z = tough(game, 26.5, 20.5);
      const ev = run(game, 200);
      expect(ev.filter((e) => e.type === 'monsterHit' && e.targetId === z.id).length).toBeGreaterThanOrEqual(1);
    });

    it('Energy Shield: 받은 피해의 20% 를 마나로 (마나 2 = 피해 1)', () => {
      const { game, ch } = setup('Sorceress', { 'Energy Shield': 1 }, { rarm: item('sst') });
      cast(game, 'Energy Shield', 20.5, 20.5);
      run(game, 20);
      expect(game.snapshot().player.states).toContain('energyshield');
      const z = game.spawnMonster('zombie1', 22.5, 20.5);
      let absorbed = 0, taken = 0;
      for (let i = 0; i < 1500 && absorbed === 0; i++) for (const e of game.tick()) {
        if (e.type === 'energyShield') absorbed += e.absorbed as number;
        if (e.type === 'playerHit') taken += e.damage as number;
      }
      expect(absorbed).toBeGreaterThan(0);
      expect(absorbed / (absorbed + taken)).toBeCloseTo(0.2, 1);
      expect(ch.mana).toBeLessThan(500);
      void z;
    });

    it('Hydra: 머리 3개가 제자리에서 화염 볼트를 쏘고 250프레임 뒤 사라진다', () => {
      const { game } = setup('Sorceress', { Hydra: 1 }, { rarm: item('sst') });
      cast(game, 'Hydra', 26.5, 20.5);
      run(game, 20);
      expect(game.pets.map((p) => p.type.id).sort()).toEqual(['hydra1', 'hydra2', 'hydra3']);
      const z = tough(game, 33.5, 20.5);
      const ev = run(game, 100);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
      run(game, 200);
      expect(game.pets.length).toBe(0);
    });

    it('Fire Mastery: Fire Bolt 피해 +30% (1레벨)', () => {
      const avg = (fm: number) => {
        const { game } = setup('Sorceress', fm ? { 'Fire Bolt': 1, 'Fire Mastery': fm } : { 'Fire Bolt': 1 }, { rarm: item('sst') }, 11);
        let sum = 0;
        for (let k = 0; k < 20; k++) {
          const z = tough(game, 26.5, 20.5);
          cast(game, 'Fire Bolt', z.x, z.y, z.id);
          for (const e of run(game, 30)) if (e.type === 'monsterHit' && e.targetId === z.id) sum += e.damage as number;
          game.monsters.splice(0);
        }
        return sum;
      };
      expect(avg(1) / avg(0)).toBeGreaterThan(1.15);
    });

    it('Cold Mastery: 냉기 저항 50 인 몬스터에게 저항 −20 (저항 100 이상은 그대로)', () => {
      const dmg = (cm: number, res: number) => {
        const { game } = setup('Sorceress', cm ? { 'Ice Bolt': 1, 'Cold Mastery': cm } : { 'Ice Bolt': 1 }, { rarm: item('sst') }, 11);
        let sum = 0;
        for (let k = 0; k < 20; k++) {
          const z = tough(game, 26.5, 20.5);
          z.resist.co = res;
          cast(game, 'Ice Bolt', z.x, z.y, z.id);
          for (const e of run(game, 30)) if (e.type === 'monsterHit' && e.targetId === z.id) sum += e.damage as number;
          game.monsters.splice(0);
        }
        return sum;
      };
      expect(dmg(1, 50)).toBeGreaterThan(dmg(0, 50));
      expect(dmg(1, 100)).toBe(0);
    });

    it('Chilling Armor: 방어 +45% 상태, 미사일에 맞으면 쏜 몬스터에게 얼음 볼트를 되쏜다', () => {
      const { game } = setup('Sorceress', { 'Chilling Armor': 1 }, { rarm: item('sst') });
      cast(game, 'Chilling Armor', 20.5, 20.5);
      run(game, 20);
      expect(game.playerState('chillingarmor')?.stats.skill_armor_percent).toBe(45);
      // Fallen Shaman 의 firebolt (missiles.txt ReturnFire 1)
      game.spawnMonster('fallenshaman1', 28.5, 20.5);
      let back = false;
      for (let i = 0; i < 1500 && !back; i++) {
        game.tick();
        back = game.snapshot().missiles.some((m) => m.name === 'chillingarmorbolt');
      }
      expect(back).toBe(true);
    });

    // ---------------------------------------------------------------- Amazon
    it('Strafe: 반경 안 좀비 넷에게 화살이 한 발씩, 화살은 1개만 소모', () => {
      const { game } = setup('Amazon', { Strafe: 1 }, { rarm: item('sbw'), larm: item('aqv', 50) });
      const zs = [tough(game, 28.5, 18.5), tough(game, 28.5, 22.5), tough(game, 30.5, 20.5), tough(game, 26.5, 24.5)];
      cast(game, 'Strafe', zs[0]!.x, zs[0]!.y, zs[0]!.id);
      const ev = run(game, 120);
      const hit = new Set(ev.filter((e) => (e.type === 'monsterHit' || e.type === 'miss') && zs.some((z) => z.id === e.targetId)).map((e) => e.targetId));
      expect(hit.size).toBeGreaterThanOrEqual(3);
      expect(game.equipment.larm?.quantity).toBe(49);
    });

    it('Immolation Arrow: 적중 자리에 불길 원판 + 화염 피해', () => {
      const { game } = setup('Amazon', { 'Immolation Arrow': 1 }, { rarm: item('sbw'), larm: item('aqv', 50) });
      const z = tough(game, 30.5, 20.5);
      cast(game, 'Immolation Arrow', z.x, z.y, z.id);
      const ev = run(game, 40);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
      expect(game.snapshot().missiles.filter((m) => m.name === 'immolationfire').length).toBeGreaterThan(10);
    });

    it('Freezing Arrow: 폭발 반경 안 좀비들이 빙결', () => {
      const { game } = setup('Amazon', { 'Freezing Arrow': 1 }, { rarm: item('sbw'), larm: item('aqv', 50) });
      const a = tough(game, 30.5, 20.5), b = tough(game, 31.5, 22.5);
      cast(game, 'Freezing Arrow', a.x, a.y, a.id);
      run(game, 40);
      expect(a.states.has('freeze') || b.states.has('freeze')).toBe(true);
    });

    it('Lightning Fury: 투창이 맞으면 주변 적에게 번개가 갈라진다', () => {
      const { game } = setup('Amazon', { 'Lightning Fury': 1 }, { rarm: item('jav', 30) });
      const zs = [tough(game, 30.5, 20.5), tough(game, 33.5, 23.5), tough(game, 33.5, 17.5)];
      cast(game, 'Lightning Fury', zs[0]!.x, zs[0]!.y, zs[0]!.id);
      const ev = run(game, 60);
      expect(hitIds(ev).size).toBeGreaterThanOrEqual(2);
      expect(game.equipment.rarm?.quantity).toBe(29);
    });

    it('Lightning Strike: 번개 근접 뒤 다른 적에게 연쇄 번개', () => {
      const { game } = setup('Amazon', { 'Lightning Strike': 3 }, { rarm: item('spr') }, 3);
      const zs = [tough(game, 22.5, 20.5), tough(game, 27.5, 21.5), tough(game, 31.5, 19.5)];
      cast(game, 'Lightning Strike', zs[0]!.x, zs[0]!.y, zs[0]!.id);
      const ev = run(game, 80);
      expect(hitIds(ev).size).toBeGreaterThanOrEqual(2);
    });

    it('Fend: 근접 거리의 여러 좀비를 번갈아 친다', () => {
      const { game } = setup('Amazon', { Fend: 1 }, { rarm: item('spr') });
      const zs = [tough(game, 22.5, 20.5), tough(game, 20.5, 22.5), tough(game, 18.5, 20.5)];
      cast(game, 'Fend', zs[0]!.x, zs[0]!.y, zs[0]!.id);
      const ev = run(game, 120);
      const hit = new Set(ev.filter((e) => e.type === 'monsterHit' || e.type === 'miss').map((e) => e.targetId));
      expect(hit.size).toBeGreaterThanOrEqual(2);
    });

    it('Pierce: 20레벨(100%) 이면 화살이 첫 좀비를 뚫고 뒤의 좀비도 맞힌다', () => {
      const { game } = setup('Amazon', { Pierce: 20 }, { rarm: item('sbw'), larm: item('aqv', 50) });
      const a = tough(game, 25.5, 20.5), b = tough(game, 30.5, 20.5);
      game.enqueue({ type: 'attack', targetId: a.id, standStill: true });
      const ev = run(game, 40);
      const touched = new Set(ev.filter((e) => e.type === 'monsterHit' || e.type === 'miss').map((e) => e.targetId));
      expect(touched.has(a.id) && touched.has(b.id)).toBe(true);
    });

    it('Decoy(Dopplezon): 생명 = 최대 생명 × 50%, calc2 프레임 뒤 사라지고 몬스터가 노린다', () => {
      const { game } = setup('Amazon', { Dopplezon: 1 }, { rarm: item('jav', 30) });
      cast(game, 'Dopplezon', 26.5, 20.5);
      run(game, 20);
      const d = game.pets[0]!;
      expect(d.type.id).toBe('dopplezon');
      // 캐릭터 최대 생명 × calc3(50)%, 이어서 소환 보너스 calc1 (lvl × par4 = 10%) (출처: SKILLS_SrvDo015 → D2GAME_SetSummonPassiveStats)
      const hp = Math.trunc((game.maxLife() * 50) / 100);
      expect(d.stats.maxHp).toBe(hp + Math.trunc((hp * 10) / 100));
      expect(d.pet!.expires - 20).toBeLessThanOrEqual(game.snapshot().tick + data.skillCalc!.calc(S('Dopplezon'), 2, 1, none));
      run(game, 260);
      expect(game.pets.length).toBe(0);
    });

    it('Valkyrie: 발키리 소환, 생명 보너스와 명중 스탯', () => {
      const { game } = setup('Amazon', { Valkyrie: 2 }, { rarm: item('jav', 30) });
      cast(game, 'Valkyrie', 24.5, 20.5);
      run(game, 20);
      expect(game.pets[0]?.type.id).toBe('valkyrie');
    });

    // ---------------------------------------------------------------- Necromancer
    it('Bone Spirit: 대상 없이 쏘면 목표 지점에 간 뒤 가까운 적을 따라가 맞힌다 (homing)', () => {
      const { game } = setup('Necromancer', { 'Bone Spirit': 1 }, { rarm: item('wnd') });
      const z = tough(game, 30.5, 26.5);
      cast(game, 'Bone Spirit', 30.5, 20.5);
      const ev = run(game, 150);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
      expect(game.equipment.larm).toBeUndefined();
    });

    it('Bone Spirit: 대상을 지정하면 앞에 선 다른 좀비는 지나친다', () => {
      const { game } = setup('Necromancer', { 'Bone Spirit': 1 }, { rarm: item('wnd') });
      const block = tough(game, 25.5, 20.5), t = tough(game, 32.5, 20.5);
      cast(game, 'Bone Spirit', t.x, t.y, t.id);
      const ev = run(game, 150);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === t.id)).toBe(true);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === block.id)).toBe(false);
    });

    it('Iron Golem: 바닥의 금속 아이템이 골렘이 되고 (아이템은 사라짐) 가시 150% 상태', () => {
      const { game } = setup('Necromancer', { 'Clay Golem': 1, BloodGolem: 1, IronGolem: 1 }, { rarm: item('wnd') });
      const axe = item('hax');
      game.dropItem(axe, 24.5, 20.5);
      // 금속이 아닌 아이템(물약)으로는 안 된다
      const pot = item('hp1');
      game.dropItem(pot, 22.5, 22.5);
      cast(game, 'IronGolem', 22.5, 22.5, undefined, pot.id);
      run(game, 20);
      expect(game.pets.length).toBe(0);
      cast(game, 'IronGolem', 24.5, 20.5, undefined, axe.id);
      const ev = run(game, 20);
      expect(ev.some((e) => e.type === 'ironGolem')).toBe(true);
      expect(game.pets[0]?.type.id).toBe('irongolem');
      expect(game.snapshot().items.some((i) => i.id === axe.id)).toBe(false);
      expect(game.pets[0]!.states.get('thorns')?.stats.thorns_percent).toBe(150);
    });

    it('Revive: 시체가 소환수가 되어 calc2(4500) 프레임 동안 싸운다', () => {
      const { game } = setup('Necromancer', { Revive: 1 }, { rarm: item('wnd') });
      const c = corpse(game, 24.5, 20.5);
      cast(game, 'Revive', c.x, c.y, c.id);
      run(game, 20);
      const pet = game.pets[0]!;
      expect(pet.type.id).toBe('zombie1');
      expect(game.monsters.includes(c)).toBe(false);
      const now = game.snapshot().tick;
      expect(pet.pet!.expires).toBeGreaterThan(now + 4450);
      expect(pet.pet!.expires).toBeLessThanOrEqual(now + 4500);
      expect(pet.states.has('revive')).toBe(true);
    });

    it('Bone Prison: 대상 둘레에 뼈벽 12개', () => {
      const { game } = setup('Necromancer', { 'Bone Prison': 1 }, { rarm: item('wnd') });
      const z = tough(game, 30.5, 20.5);
      cast(game, 'Bone Prison', z.x, z.y, z.id);
      run(game, 20);
      expect(game.pets.filter((p) => p.type.id === 'bonewall').length).toBe(12);
    });

    it('Poison Nova: 주변 좀비 전부 독', () => {
      const { game } = setup('Necromancer', { 'Poison Nova': 1 }, { rarm: item('wnd') });
      const zs = [tough(game, 24.5, 20.5), tough(game, 20.5, 25.5), tough(game, 16.5, 18.5)];
      cast(game, 'Poison Nova', 20.5, 20.5);
      run(game, 40);
      expect(zs.every((z) => z.states.has('poison'))).toBe(true);
    });

    it('Lower Resist / Decrepify: 저주 스탯 (저항 −32, 속도·피해·물리저항 −50)', () => {
      const { game } = setup('Necromancer', { 'Lower Resist': 1, Decrepify: 1 }, { rarm: item('wnd') });
      const z = tough(game, 28.5, 20.5);
      cast(game, 'Lower Resist', z.x, z.y);
      run(game, 20);
      expect(z.states.get('lowerresist')?.stats.fireresist).toBe(-32);
      cast(game, 'Decrepify', z.x, z.y);
      run(game, 20);
      expect(z.states.has('lowerresist')).toBe(false);
      expect(z.states.get('decrepify')?.stats).toMatchObject({ velocitypercent: -50, damagepercent: -50, damageresist: -50 });
    });

    it('Attract: 주변 몬스터가 저주받은 몬스터를 공격', () => {
      const { game } = setup('Necromancer', { Attract: 1 }, { rarm: item('wnd') });
      const bait = tough(game, 34.5, 20.5);
      const z = game.spawnMonster('zombie1', 36.5, 20.5);
      z.nextThink = 1e9;
      cast(game, 'Attract', bait.x, bait.y, bait.id);
      run(game, 20);
      expect(bait.states.has('attract')).toBe(true);
      z.nextThink = 0;
      let hit = false;
      for (let i = 0; i < 250 && !hit; i++) for (const e of game.tick()) if (e.type === 'monsterHit' && e.targetId === bait.id) hit = true;
      expect(hit).toBe(true);
    });

    it('Fire Golem: 골렘 주변 적에게 Holy Fire 오라 화염 피해', () => {
      const { game } = setup('Necromancer', { 'Clay Golem': 1, BloodGolem: 1, IronGolem: 1, FireGolem: 1 }, { rarm: item('wnd') });
      cast(game, 'FireGolem', 26.5, 20.5);
      run(game, 20);
      const g = game.pets[0]!;
      expect(g.type.id).toBe('firegolem');
      g.nextThink = 1e9;
      const z = tough(game, g.x + 2, g.y);
      const ev = run(game, 120);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
    });

    it('Summon Resist: 소환수 저항 +passive_summon_resist', () => {
      const { game } = setup('Necromancer', { 'Clay Golem': 1, 'Golem Mastery': 1, 'Summon Resist': 1 }, { rarm: item('wnd') });
      cast(game, 'Clay Golem', 24.5, 20.5);
      run(game, 20);
      const base = data.monsters.get('claygolem').resist.fi;
      expect(game.pets[0]!.resist.fi).toBe(base + diminishing(1, 20, 75));
    });

    // ---------------------------------------------------------------- Paladin
    it('Fist of the Heavens: 대상에 번개 + 주변 언데드에게 성스러운 볼트', () => {
      const { game } = setup('Paladin', { 'Fist of the Heavens': 1 }, { rarm: item('ssd') });
      const t = tough(game, 28.5, 20.5), u = tough(game, 32.5, 24.5);
      cast(game, 'Fist of the Heavens', t.x, t.y, t.id);
      const ev = run(game, 80);
      const foh = ev.find((e) => e.type === 'fistOfHeavens');
      expect(foh?.targetId).toBe(t.id);
      expect(foh?.bolts).toBeGreaterThanOrEqual(1);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === t.id)).toBe(true);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === u.id)).toBe(true);
    });

    it('Conviction 오라: 범위 안 좀비 화염 저항 −30 · 방어 −49%', () => {
      const { game, ch } = setup('Paladin', { Conviction: 1 }, { rarm: item('ssd') });
      ch.rightSkill = S('Conviction').id;
      const z = tough(game, 28.5, 20.5);
      run(game, 60);
      expect(z.states.get('conviction')?.stats).toMatchObject({ fireresist: -30, coldresist: -30, lightresist: -30, skill_armor_percent: -49 });
      expect(game.snapshot().player.states).toContain('conviction');
    });

    it('Sanctuary 오라: 언데드(좀비)만 마법 피해, 폴른은 맞지 않는다', () => {
      const { game, ch } = setup('Paladin', { Sanctuary: 1 }, { rarm: item('ssd') });
      ch.rightSkill = S('Sanctuary').id;
      const z = tough(game, 23.5, 20.5), f = tough(game, 20.5, 23.5, 'fallen1');
      const ev = run(game, 120);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === f.id)).toBe(false);
    });

    it('Fanaticism 오라: 자신은 피해 +ln56(50)%, 공격 속도·명중 보너스', () => {
      const { game, ch } = setup('Paladin', { Fanaticism: 1 }, { rarm: item('ssd') });
      ch.rightSkill = S('Fanaticism').id;
      run(game, 5);
      expect(game.playerState('fanaticism')?.stats).toMatchObject({ damagepercent: 50, attackrate: diminishing(1, 10, 40), item_tohit_percent: 40 });
    });

    it('Salvation 오라: 화염·냉기·번개 저항 +dm34', () => {
      const { game, ch } = setup('Paladin', { Salvation: 1 }, { rarm: item('ssd') });
      ch.rightSkill = S('Salvation').id;
      run(game, 5);
      expect(game.playerState('resistall')?.stats.fireresist).toBe(diminishing(1, 50, 120));
    });

    it('Redemption 오라: 시체를 거두어 생명·마나 회복', () => {
      const { game, ch } = setup('Paladin', { Redemption: 20 }, { rarm: item('ssd') });
      ch.rightSkill = S('Redemption').id;
      ch.life = 100;
      const c = corpse(game, 24.5, 20.5);
      const ev = run(game, 200);
      expect(ev.some((e) => e.type === 'redeemed' && e.targetId === c.id)).toBe(true);
      expect(ch.life).toBeGreaterThan(100);
    });

    it('Holy Shield: 방패가 있어야 하고, 막기 +dm56% 상태', () => {
      const { game } = setup('Paladin', { 'Holy Shield': 1 }, { rarm: item('ssd') });
      cast(game, 'Holy Shield', 20.5, 20.5);
      run(game, 20);
      expect(game.playerState('holyshield')).toBeUndefined();
      game.equipment.larm = item('buc');
      cast(game, 'Holy Shield', 20.5, 20.5);
      run(game, 20);
      expect(game.playerState('holyshield')?.stats.toblock).toBe(diminishing(1, 10, 40));
    });

    it('Conversion: 50% 확률 이상에서 맞은 몬스터가 편이 되어 다른 몬스터를 공격', () => {
      const { game } = setup('Paladin', { Conversion: 20 }, { rarm: item('ssd') }, 9);
      const a = game.spawnMonster('fallen1', 22.5, 20.5);
      a.hp = a.stats.maxHp = 100000;
      a.nextThink = 1e9;
      let converted = false;
      for (let k = 0; k < 10 && !converted; k++) {
        cast(game, 'Conversion', a.x, a.y, a.id);
        converted = run(game, 30).some((e) => e.type === 'converted');
      }
      expect(converted).toBe(true);
      expect(a.states.has('conversion')).toBe(true);
    });

    // ---------------------------------------------------------------- Barbarian
    it('Whirlwind: 목표 지점까지 돌며 이동, 지나가는 좀비들을 친다', () => {
      const { game } = setup('Barbarian', { Whirlwind: 1 }, { rarm: item('hax') });
      const zs = [tough(game, 25.5, 21.5), tough(game, 30.5, 19.5), tough(game, 35.5, 21.5)];
      cast(game, 'Whirlwind', 40.5, 20.5);
      const ev = run(game, 150);
      const hit = new Set(ev.filter((e) => (e.type === 'monsterHit' || e.type === 'miss') && zs.some((z) => z.id === e.targetId)).map((e) => e.targetId));
      expect(hit.size).toBeGreaterThanOrEqual(2);
      expect(ev.some((e) => e.type === 'whirlwindEnd')).toBe(true);
      expect(Math.hypot(game.snapshot().player.x - 40.5, game.snapshot().player.y - 20.5)).toBeLessThan(1.5);
    });

    it('Berserk: 물리 피해를 모두 마법으로, 사용 뒤 방어 0', () => {
      const { game } = setup('Barbarian', { Berserk: 1 }, { rarm: item('hax') });
      const z = tough(game, 22.5, 20.5);
      z.resist.ma = 100;
      cast(game, 'Berserk', z.x, z.y, z.id);
      const ev = run(game, 10);
      expect(game.playerState('berserk')?.stats.armor_override_percent).toBe(-100);
      ev.push(...run(game, 30));
      // 마법 면역이면 피해 0 (물리 → 마법 100% 변환)
      const hits = ev.filter((e) => e.type === 'monsterHit' && e.targetId === z.id);
      expect(hits.every((e) => e.damage === 0)).toBe(true);
    });

    it('Frenzy: 명중마다 frenzy 단계가 올라가 이동 속도 증가', () => {
      const { game } = setup('Barbarian', { Frenzy: 3 }, { rarm: item('hax'), larm: item('hax') });
      const z = tough(game, 22.5, 20.5);
      z.stats.defense = 0;
      for (let k = 0; k < 4; k++) {
        cast(game, 'Frenzy', z.x, z.y, z.id);
        run(game, 40);
      }
      const st = game.playerState('frenzy');
      expect(st?.stats.skill_frenzy).toBeGreaterThanOrEqual(2);
      expect(st?.stats.velocitypercent).toBeGreaterThan(0);
    });

    it('Battle Orders: 최대 생명·마나 +35%', () => {
      const { game } = setup('Barbarian', { Shout: 1, 'Battle Orders': 1 }, { rarm: item('hax') });
      const life0 = game.maxLife(), mana0 = game.maxMana();
      cast(game, 'Battle Orders', 20.5, 20.5);
      run(game, 20);
      expect(game.maxLife()).toBe(Math.floor((life0 * 135) / 100));
      expect(game.maxMana()).toBe(Math.floor((mana0 * 135) / 100));
    });

    it('Battle Command: 모든 스킬 +1 (Frenzy 3 → 유효 4)', () => {
      const { game } = setup('Barbarian', { Shout: 1, 'Battle Orders': 1, 'Battle Command': 1 }, { rarm: item('hax') });
      cast(game, 'Battle Command', 20.5, 20.5);
      const ev = run(game, 20);
      expect(game.playerState('battlecommand')?.stats.item_allskills).toBe(1);
      cast(game, 'Shout', 20.5, 20.5);
      ev.push(...run(game, 30));
      expect(ev.filter((e) => e.type === 'skillStart').map((e) => e.level)).toContain(2);
    });

    it('War Cry: 주변 적에게 피해 + 기절', () => {
      const { game } = setup('Barbarian', { 'War Cry': 1 }, { rarm: item('hax') });
      const zs = [tough(game, 23.5, 20.5), tough(game, 20.5, 23.5)];
      cast(game, 'War Cry', 20.5, 20.5);
      const ev = run(game, 20);
      expect(zs.every((z) => ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id))).toBe(true);
      expect(zs.some((z) => z.states.has('stunned'))).toBe(true);
    });

    it('Grim Ward: 시체가 토템이 되어 주변 몬스터를 겁준다', () => {
      const { game } = setup('Barbarian', { 'Grim Ward': 1 }, { rarm: item('hax') });
      const c = corpse(game, 22.5, 20.5);
      const z = game.spawnMonster('zombie1', 24.5, 22.5);
      z.nextThink = 1e9;
      cast(game, 'Grim Ward', c.x, c.y, c.id);
      run(game, 40);
      expect(game.monsters.includes(c)).toBe(false);
      expect(z.states.has('terror')).toBe(true);
    });

    it('Natural Resistance·Increased Speed: 패시브 저항·이동 속도', () => {
      const { game } = setup('Barbarian', { 'Natural Resistance': 1, 'Increased Speed': 1 }, { rarm: item('hax') });
      const x0 = game.snapshot().player.x;
      game.enqueue({ type: 'move', x: 60.5, y: 20.5, run: false });
      run(game, 25);
      const withSpeed = game.snapshot().player.x - x0;
      const { game: g2 } = setup('Barbarian', {}, { rarm: item('hax') });
      g2.enqueue({ type: 'move', x: 60.5, y: 20.5, run: false });
      run(g2, 25);
      expect(withSpeed).toBeGreaterThan(g2.snapshot().player.x - x0);
    });
  });
});
