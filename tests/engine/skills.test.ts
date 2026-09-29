import { beforeAll, describe, expect, it } from 'vitest';
import { evalCalc, parseCalc } from '../../src/engine/skills/calc';
import { diminishing, levelDamageBonus } from '../../src/engine/skills/formulas';
import { learnError, learnSkill } from '../../src/engine/skills/rules';
import { CLASSIC_CLASSES, classStats, createCharacter, expTable, type ClassName } from '../../src/engine/player';
import { Game, type GameData } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { gameChain, hasGameData } from '../support/gamedata';

const ctx = (params: Record<string, number> = {}) => ({ param: (n: string) => params[n] ?? 0, ref: () => 0 });
const ev = (src: string, params: Record<string, number> = {}) => evalCalc(parseCalc(src), ctx(params));

describe('스킬 공식 언어 (출처: D2MOO Fog/src/Calc.cpp)', () => {
  it('우선순위: 곱셈 > 덧셈 > 비교 > 삼항, 거듭제곱은 곱셈보다 먼저', () => {
    expect(ev('1+2*3')).toBe(7);
    expect(ev('2*3^2')).toBe(18);
    expect(ev('1+2<4?10:20')).toBe(10);
    expect(ev('-3+5')).toBe(2);
  });
  it('정수 나눗셈은 0 쪽으로 절삭, 0 으로 나누면 0', () => {
    expect(ev('7/2')).toBe(3);
    expect(ev('-7/2')).toBe(-3);
    expect(ev('5/0')).toBe(0);
  });
  it('min/max 와 파라미터 이름, 따옴표로 감싼 원작 공식', () => {
    expect(ev('"min(24,ln12)"', { ln12: 30 })).toBe(24);
    expect(ev('max(par1,3)', { par1: 1 })).toBe(3);
  });
  it('원작 데이터의 닫는 괄호 누락(Fire Wall EDmgSymPerCalc)도 끝에서 닫힌 것으로 처리', () => {
    expect(ev('(par8+par7', { par8: 2, par7: 3 })).toBe(5);
  });
});

describe('레벨 공식 (출처: D2MOO D2Common_11033, SKILLS_CalculateDamageBonusByLevel)', () => {
  it('dm: min + (max−min)×110×lvl/(lvl+6)/100, max 를 넘지 않음', () => {
    expect(diminishing(1, 5, 80)).toBe(16);
    expect(diminishing(100, 5, 80)).toBe(80);
  });
  it('레벨 구간 피해: 2~8 은 [0], 9~16 은 [1] …', () => {
    expect(levelDamageBonus(1, [1, 2, 3, 4, 5])).toBe(0);
    expect(levelDamageBonus(8, [1, 2, 3, 4, 5])).toBe(7);
    expect(levelDamageBonus(10, [1, 2, 3, 4, 5])).toBe(11);
    expect(levelDamageBonus(17, [1, 2, 3, 4, 5])).toBe(7 + 16 + 3);
  });
});

describe.skipIf(!hasGameData)('원작 skills.txt 수치', () => {
  let tables: GameTables, data: GameData;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });
  const S = (name: string) => data.skills!.byNameOf(name)!;
  const none = { baseLevel: () => 0, skillLevel: () => 0, unitLevel: 1 };

  // 출처: The Arreat Summit — Sorceress Fire Bolt (레벨 1 화염 3-6, 마나 2.5), skills.txt EMin/EMax/HitShift/mana/manashift
  it('Fire Bolt 1레벨: 화염 3~6, 마나 2.5', () => {
    const c = data.skillCalc!, s = S('Fire Bolt');
    expect([c.minElem256(s, 1, none, false) / 256, c.maxElem256(s, 1, none, false) / 256]).toEqual([3, 6]);
    expect(c.manaCost256(s, 1) / 256).toBe(2.5);
  });
  // 출처: The Arreat Summit — Amazon Magic Arrow (마나 1.5, 레벨당 0.125 감소, 13레벨부터 0)
  it('Magic Arrow 마나: 1레벨 1.5, 2레벨 1.375, 13레벨 0', () => {
    const c = data.skillCalc!, s = S('Magic Arrow');
    expect([1, 2, 13].map((l) => c.manaCost256(s, l) / 256)).toEqual([1.5, 1.375, 0]);
  });
  // 출처: The Arreat Summit — Barbarian Bash (명중 +20%, 피해 +50%, +1 피해, 레벨당 +5% / +5% / +1), skills.txt ToHitCalc/calc1/calc2
  it('Bash 1·2레벨: 명중 20→25%, 피해 50→55%, 추가 피해 1→2', () => {
    const c = data.skillCalc!, s = S('Bash');
    expect([1, 2].map((l) => [c.toHit(s, l, none), c.calc(s, 1, l, none), c.calc(s, 2, l, none)])).toEqual([[20, 50, 1], [25, 55, 2]]);
  });
  // 출처: skills.txt Critical Strike passivecalc1 = dm12(5, 80), Dodge = dm12(10, 65) + D2MOO D2Common_11033
  it('Critical Strike 1레벨 16%, Dodge 1레벨 18%', () => {
    const c = data.skillCalc!;
    const cs = S('Critical Strike'), dg = S('Dodge');
    expect(c.eval(cs, cs.passiveStats[0]!.calc, 1, none)).toBe(16);
    expect(c.eval(dg, dg.passiveStats[0]!.calc, 1, none)).toBe(18);
  });
  // 출처: The Arreat Summit — Cold Arrow 1레벨 냉기 3-4, 지속 4초 (= 100 프레임)
  it('Cold Arrow 1레벨: 냉기 3~4, 지속 100프레임', () => {
    const c = data.skillCalc!, s = S('Cold Arrow');
    expect([Math.floor(c.minElem256(s, 1, none, false) / 256), Math.floor(c.maxElem256(s, 1, none, false) / 256), c.elemLength(s, 1, none)]).toEqual([3, 4, 100]);
  });
  // 출처: skills.txt Poison Javelin EMin 32 / EMax 48 (1/256 매 프레임), ELen 200 → 8초 동안 25~37
  it('Poison Javelin 1레벨: 8초(200프레임) 동안 독 25~37', () => {
    const c = data.skillCalc!, s = S('Poison Javelin');
    const len = c.elemLength(s, 1, none);
    expect(len).toBe(200);
    expect([Math.floor((c.minElem256(s, 1, none, false) * len) / 256), Math.floor((c.maxElem256(s, 1, none, false) * len) / 256)]).toEqual([25, 37]);
  });
  // 출처: skills.txt Shout — aurastatcalc1 ln12 (100, +10), auralencalc ln34 (500, +250) 프레임
  it('Shout 1레벨: 방어 +100%, 20초(500프레임)', () => {
    const c = data.skillCalc!, s = S('Shout');
    expect([c.eval(s, s.auraStats[0]!.calc, 1, none), c.eval(s, s.auraLenCalc, 1, none)]).toEqual([100, 500]);
  });
  it('클래스 스킬 트리: 클래스마다 30개, 탭 3개', () => {
    for (const cls of CLASSIC_CLASSES) {
      const list = data.skills!.classSkills(cls);
      expect(list.length).toBe(30);
      expect(new Set(list.map((s) => s.page))).toEqual(new Set([1, 2, 3]));
    }
  });

  // 출처: The Arreat Summit — 클래스별 시작 능력치 (https://classic.battle.net/diablo2exp/classes/) = charstats.txt str/dex/int/vit, 생명 = vit + hpadd
  it.each([
    ['Amazon', [20, 25, 20, 15], 50, 15],
    ['Sorceress', [10, 25, 10, 35], 40, 35],
    ['Necromancer', [15, 25, 15, 25], 45, 25],
    ['Paladin', [25, 20, 25, 15], 55, 15],
    ['Barbarian', [30, 20, 25, 10], 55, 10],
  ] as const)('%s 생성: 힘/민첩/활력/에너지, 생명, 마나', (cls, stats, life, mana) => {
    const ch = createCharacter(classStats(tables.table('charstats'), cls as ClassName));
    expect([ch.str, ch.dex, ch.vit, ch.ene]).toEqual(stats);
    expect([ch.maxLife, ch.maxMana]).toEqual([life, mana]);
    expect([ch.skills, ch.leftSkill, ch.rightSkill]).toEqual([{}, 0, 0]);
  });

  describe('스킬 포인트 투자 (출처: The Arreat Summit Skills — 요구 레벨·선행 스킬, 하드 포인트 20)', () => {
    const barb = () => {
      const ch = createCharacter(classStats(tables.table('charstats'), 'Barbarian'));
      ch.skillPoints = 30;
      return ch;
    };
    it('1레벨 바바리안: Bash 가능, Leap(6레벨) 불가', () => {
      const ch = barb();
      expect(learnError(ch, S('Bash'), data.skills!)).toBeNull();
      expect(learnError(ch, S('Leap'), data.skills!)).toBe('level');
    });
    it('선행 스킬 없으면 불가: Double Swing 은 Bash 필요', () => {
      const ch = barb();
      ch.level = 6;
      expect(learnError(ch, S('Double Swing'), data.skills!)).toBe('prereq');
      learnSkill(ch, S('Bash'), data.skills!);
      expect(learnError(ch, S('Double Swing'), data.skills!)).toBeNull();
    });
    it('다른 클래스 스킬·포인트 없음·20 초과는 불가', () => {
      const ch = barb();
      expect(learnError(ch, S('Jab'), data.skills!)).toBe('class');
      for (let i = 0; i < 20; i++) expect(learnSkill(ch, S('Bash'), data.skills!)).toBe(true);
      expect(learnError(ch, S('Bash'), data.skills!)).toBe('max');
      ch.skillPoints = 0;
      expect(learnError(ch, S('Howl'), data.skills!)).toBe('points');
    });
  });

  describe('게임 안에서 스킬 사용', () => {
    const item = (code: string, quantity?: number): ItemInstance => {
      const it = data.treasure.createItem(data.items.base(code)!, 1, new Rng(1), QUALITY.NORMAL);
      if (quantity !== undefined) it.quantity = quantity;
      return it;
    };
    const setup = (cls: ClassName, skills: Record<string, number>, equipment: Record<string, ItemInstance>, seed = 5) => {
      const cs = classStats(tables.table('charstats'), cls);
      const ch = createCharacter(cs);
      ch.level = 20;
      ch.mana = ch.maxMana = 200;
      for (const [name, lvl] of Object.entries(skills)) ch.skills[S(name).id] = lvl;
      const game = new Game({
        map: new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
        seed, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls), equipment,
      });
      return { game, ch };
    };
    // 생명을 최대치보다 크게 두면 재생(최대치 미만일 때만)이 피해를 가리지 않는다
    const tough = (game: Game, x: number, y: number) => {
      const z = game.spawnMonster('zombie1', x, y);
      z.hp = 100000;
      z.nextThink = 1e9;
      return z;
    };
    const run = (game: Game, n: number) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push(...game.tick());
      return out;
    };

    it('Bash: 마나 2 소모, 근접 판정 1회', () => {
      const { game, ch } = setup('Barbarian', { Bash: 1 }, { rarm: item('hax') });
      const z = tough(game, 22.5, 20.5);
      game.enqueue({ type: 'useSkill', skill: S('Bash').id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
      const ev = run(game, 1);
      expect(ev.find((e) => e.type === 'skillStart')?.skill).toBe(S('Bash').id);
      // 소모 2 − 한 프레임 마나 재생
      expect(200 - ch.mana).toBeGreaterThan(1.9);
      expect(200 - ch.mana).toBeLessThanOrEqual(2);
      ev.push(...run(game, 40));
      expect(ev.filter((e) => e.type === 'monsterHit' || e.type === 'miss').length).toBe(1);
    });

    it('마나 부족: Bash(AttackNoMana)는 일반 공격으로, Howl 은 실패', () => {
      const { game, ch } = setup('Barbarian', { Bash: 1, Howl: 1 }, { rarm: item('hax') });
      ch.mana = 0;
      const z = tough(game, 22.5, 20.5);
      game.enqueue({ type: 'useSkill', skill: S('Bash').id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
      const ev = run(game, 3);
      expect(ev.find((e) => e.type === 'skillStart')?.skill).toBe(0);
      run(game, 40);
      game.enqueue({ type: 'useSkill', skill: S('Howl').id, hand: 'right', x: 20, y: 20 });
      expect(run(game, 3).some((e) => e.type === 'noMana')).toBe(true);
    });

    // 출처: D2MOO SequenceTbls.cpp gPlayerSequenceJab_BOW (무기 클래스 1HT = 투창) — 근접 타격 이벤트 3번
    it('Jab(투창): 한 번 사용에 타격 3회', () => {
      const { game } = setup('Amazon', { Jab: 1 }, { rarm: item('jav', 30) });
      const z = tough(game, 22.5, 20.5);
      game.enqueue({ type: 'useSkill', skill: S('Jab').id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
      const ev = run(game, 80);
      expect(ev.filter((e) => e.type === 'monsterHit' || e.type === 'miss').length).toBe(3);
    });

    it('Magic Arrow: 화살 없이 미사일 발사 → 날아가 몬스터에 판정', () => {
      const { game, ch } = setup('Amazon', { 'Magic Arrow': 1 }, { rarm: item('sbw') });
      const z = tough(game, 30.5, 20.5);
      game.enqueue({ type: 'useSkill', skill: S('Magic Arrow').id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
      const ev = run(game, 1);
      expect(200 - ch.mana).toBeGreaterThan(1.4);
      ev.push(...run(game, 60));
      expect(ev.some((e) => (e.type === 'monsterHit' || e.type === 'miss') && e.targetId === z.id)).toBe(true);
    });

    it('활 Attack 은 화살통이 없으면 쓸 수 없고, 있으면 화살 1개 소모', () => {
      const { game } = setup('Amazon', {}, { rarm: item('sbw') });
      const z = tough(game, 30.5, 20.5);
      game.enqueue({ type: 'attack', targetId: z.id, standStill: true });
      expect(run(game, 5).some((e) => e.type === 'skillUnusable' && e.reason === 'ammo')).toBe(true);
      const q = item('aqv', 10);
      game.equipment.larm = q;
      game.enqueue({ type: 'attack', targetId: z.id, standStill: true });
      run(game, 3);
      game.enqueue({ type: 'move', x: 20.5, y: 20.5, run: false });
      run(game, 40);
      expect(q.quantity).toBeLessThan(10);
    });

    // 출처: monstats.txt zombie1 coldeffect -50, SUNITDMG_ApplyColdState (velocitypercent = coldeffect)
    it('Cold Arrow: 맞은 좀비는 냉기 상태(이동 속도 -50%)', () => {
      const { game } = setup('Amazon', { 'Cold Arrow': 1 }, { rarm: item('sbw'), larm: item('aqv', 50) });
      const z = tough(game, 26.5, 20.5);
      let cold = false;
      for (let k = 0; k < 10 && !cold; k++) {
        game.enqueue({ type: 'useSkill', skill: S('Cold Arrow').id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
        run(game, 40);
        cold = z.states.has('cold');
      }
      expect(cold).toBe(true);
      expect(z.states.stat('velocitypercent')).toBe(-50);
    });

    it('Poison Javelin: 맞으면 독 상태, 시간이 지나며 생명 감소', () => {
      const { game } = setup('Amazon', { 'Poison Javelin': 1 }, { rarm: item('jav', 30) });
      const z = tough(game, 26.5, 20.5);
      let poisoned = false;
      for (let k = 0; k < 10 && !poisoned; k++) {
        game.enqueue({ type: 'useSkill', skill: S('Poison Javelin').id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
        run(game, 30);
        poisoned = z.states.has('poison');
      }
      expect(poisoned).toBe(true);
      const hp = z.hp;
      run(game, 50);
      expect(z.hp).toBeLessThan(hp);
    });

    // 출처: MISSMODE_SrvHit17_Howl — 스킬레벨 + par2 + 캐릭터레벨 > 몬스터레벨이면 공포, 지속 par5 + (lvl-1)×par6 = 75 프레임
    it('Howl: 가까운 좀비가 공포 상태로 달아난다', () => {
      const { game } = setup('Barbarian', { Howl: 1 }, { rarm: item('hax') });
      const z = game.spawnMonster('zombie1', 23.5, 20.5);
      game.enqueue({ type: 'useSkill', skill: S('Howl').id, hand: 'right', x: 20.5, y: 20.5 });
      run(game, 20);
      expect(z.states.has('terror')).toBe(true);
      const d0 = Math.hypot(z.x - 20.5, z.y - 20.5);
      run(game, 40);
      expect(Math.hypot(z.x - 20.5, z.y - 20.5)).toBeGreaterThan(d0);
    });

    it('Taunt: 대상은 명중·피해 감소(-5%) 도발 상태', () => {
      const { game } = setup('Barbarian', { Howl: 1, Taunt: 1 }, { rarm: item('hax') });
      const z = tough(game, 26.5, 20.5);
      game.enqueue({ type: 'useSkill', skill: S('Taunt').id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
      run(game, 30);
      expect(z.states.has('taunt')).toBe(true);
      expect([z.states.stat('item_tohit_percent'), z.states.stat('damagepercent')]).toEqual([-5, -5]);
    });

    it('Shout: 자신에게 방어 +100% 상태 (500 프레임)', () => {
      const { game } = setup('Barbarian', { Howl: 1, Shout: 1 }, { rarm: item('hax') });
      game.enqueue({ type: 'useSkill', skill: S('Shout').id, hand: 'right', x: 20.5, y: 20.5 });
      run(game, 30);
      expect(game.snapshot().player.states).toContain('shout');
      run(game, 500);
      expect(game.snapshot().player.states).not.toContain('shout');
    });

    // 출처: SKILLS_SrvDo069_FindPotion — Act 1 Normal 물약 {hp2, mp2, rvs}, 시체당 한 번
    it('Find Potion: 시체에서 hp2/mp2/rvs 중 하나가 나오고, 같은 시체는 다시 못 뒤짐', () => {
      const { game } = setup('Barbarian', { 'Find Potion': 20 }, { rarm: item('hax') }, 9);
      const found: string[] = [];
      for (let k = 0; k < 12; k++) {
        const z = game.spawnMonster('zombie1', 22.5, 20.5 + (k % 3));
        z.mode = 'DD';
        game.enqueue({ type: 'useSkill', skill: S('Find Potion').id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
        for (const e of run(game, 40)) if (e.type === 'itemDropped') found.push(String(e.code));
        expect(z.corpseUsed).toBe(true);
      }
      expect(found.length).toBeGreaterThan(0);
      for (const c of found) expect(['hp2', 'mp2', 'rvs']).toContain(c);
    });

    it('Leap: 목표 방향으로 최대 거리(dm12 서브타일) 안에서 이동', () => {
      const { game } = setup('Barbarian', { Leap: 1 }, { rarm: item('hax') });
      const maxRange = data.skillCalc!.param(S('Leap'), 'dm12', 1, { baseLevel: () => 1, skillLevel: () => 1, unitLevel: 20 });
      game.enqueue({ type: 'useSkill', skill: S('Leap').id, hand: 'right', x: 60.5, y: 20.5 });
      run(game, 40);
      const p = game.snapshot().player;
      expect(p.x).toBeGreaterThan(22);
      expect(p.x - 20.5).toBeLessThanOrEqual(maxRange + 1);
    });

    // ---------------------------------------------------------------- 소서리스
    const cast = (game: Game, name: string, x: number, y: number, targetId?: number) =>
      game.enqueue({ type: 'useSkill', skill: S(name).id, hand: 'right', x, y, ...(targetId !== undefined ? { targetId } : {}) });

    it('Fire Bolt: 화염 미사일이 좀비에 명중해 피해', () => {
      const { game } = setup('Sorceress', { 'Fire Bolt': 1 }, { rarm: item('sst') });
      const z = tough(game, 28.5, 20.5);
      cast(game, 'Fire Bolt', z.x, z.y, z.id);
      const ev = run(game, 60);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id && Number(e.damage) >= 3)).toBe(true);
    });

    it('Ice Bolt: 맞은 좀비는 냉기(감속)', () => {
      const { game } = setup('Sorceress', { 'Ice Bolt': 1 }, { rarm: item('sst') });
      const z = tough(game, 26.5, 20.5);
      cast(game, 'Ice Bolt', z.x, z.y, z.id);
      run(game, 60);
      expect(z.states.has('cold')).toBe(true);
    });

    // 출처: skills.txt Charged Bolt calc1 = min(24, ln12), Param1 3 Param2 1 → 1레벨 3개
    it('Charged Bolt: 1레벨 볼트 3개', () => {
      const { game } = setup('Sorceress', { 'Charged Bolt': 1 }, { rarm: item('sst') });
      cast(game, 'Charged Bolt', 40, 20.5);
      run(game, 20);
      expect(game.snapshot().missiles.filter((m) => m.name === 'chargedbolt').length).toBe(3);
    });

    it('Frost Nova: 주변 좀비 전부 한 번씩 냉기 피해', () => {
      const { game } = setup('Sorceress', { 'Frost Nova': 1 }, { rarm: item('sst') });
      const zs = [tough(game, 23.5, 20.5), tough(game, 17.5, 20.5), tough(game, 20.5, 24.5)];
      cast(game, 'Frost Nova', 20.5, 20.5);
      const ev = run(game, 40);
      for (const z of zs) {
        expect(ev.filter((e) => e.type === 'monsterHit' && e.targetId === z.id).length).toBe(1);
        expect(z.states.has('cold')).toBe(true);
      }
    });

    // 출처: skills.txt Static Field calc1 = par4 = 25 (현재 생명의 25%)
    it('Static Field: 반경 안 좀비 현재 생명 25% 감소', () => {
      const { game } = setup('Sorceress', { 'Static Field': 1 }, { rarm: item('sst') });
      const z = tough(game, 22.5, 20.5);
      z.hp = 1000;
      cast(game, 'Static Field', 20.5, 20.5);
      run(game, 30);
      expect(z.hp).toBe(750);
    });

    it('Frozen Armor: 방어 +30% 상태, 근접으로 때린 좀비는 빙결', () => {
      const { game, ch } = setup('Sorceress', { 'Frozen Armor': 1 }, { rarm: item('sst') });
      ch.level = 1; // 레벨 차이가 크면 좀비가 거의 못 맞힌다 (명중 최저 5%)
      cast(game, 'Frozen Armor', 20.5, 20.5);
      run(game, 20);
      expect(game.snapshot().player.states).toContain('frozenarmor');
      const z = game.spawnMonster('zombie1', 22.5, 20.5);
      let frozen = false;
      for (let i = 0; i < 2000 && !frozen; i++) {
        game.tick();
        if (ch.life < 20) ch.life = ch.maxLife;
        frozen = z.states.has('freeze');
      }
      expect(frozen).toBe(true);
    });

    it('Inferno: 누르고 있는 동안 불꽃이 계속 나가고 마나를 소모', () => {
      const { game, ch } = setup('Sorceress', { Inferno: 1 }, { rarm: item('sst') });
      const z = tough(game, 23.5, 20.5);
      for (let i = 0; i < 12; i++) {
        cast(game, 'Inferno', z.x, z.y);
        run(game, 5);
      }
      expect(200 - ch.mana).toBeGreaterThan(3);
      expect(z.hp).toBeLessThan(100000);
    });

    it('Fire Wall: 불길 위에 선 좀비가 계속 화염 피해', () => {
      const { game } = setup('Sorceress', { 'Fire Wall': 1 }, { rarm: item('sst') });
      const z = tough(game, 28.5, 20.5);
      cast(game, 'Fire Wall', z.x, z.y);
      const ev = run(game, 60);
      expect(game.snapshot().missiles.some((m) => m.name === 'firewall')).toBe(true);
      expect(ev.filter((e) => e.type === 'monsterHit' && e.targetId === z.id).length).toBeGreaterThan(5);
    });

    it('Fire Ball: 폭발이 붙어 있는 두 좀비를 모두 맞힘', () => {
      const { game } = setup('Sorceress', { 'Fire Ball': 1 }, { rarm: item('sst') });
      const a = tough(game, 28.5, 20.5), b = tough(game, 29.5, 22.5);
      cast(game, 'Fire Ball', a.x, a.y, a.id);
      const ev = run(game, 60);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === a.id)).toBe(true);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === b.id)).toBe(true);
    });

    it('Chain Lightning: 여러 적에게 번개가 이어짐', () => {
      const { game } = setup('Sorceress', { 'Chain Lightning': 1 }, { rarm: item('sst') });
      const zs = [tough(game, 26.5, 20.5), tough(game, 30.5, 22.5), tough(game, 33.5, 19.5)];
      cast(game, 'Chain Lightning', zs[0]!.x, zs[0]!.y, zs[0]!.id);
      const ev = run(game, 80);
      const hitIds = new Set(ev.filter((e) => e.type === 'monsterHit').map((e) => e.targetId));
      expect(hitIds.size).toBeGreaterThanOrEqual(2);
    });

    it('Teleport: 목표 지점으로 즉시 이동', () => {
      const { game } = setup('Sorceress', { Teleport: 1 }, { rarm: item('sst') });
      cast(game, 'Teleport', 40.5, 30.5);
      run(game, 25);
      const p = game.snapshot().player;
      expect(Math.hypot(p.x - 40.5, p.y - 30.5)).toBeLessThan(2);
    });

    it('Ice Blast: 맞은 좀비는 빙결', () => {
      const { game } = setup('Sorceress', { 'Ice Blast': 1 }, { rarm: item('sst') });
      const z = tough(game, 26.5, 20.5);
      cast(game, 'Ice Blast', z.x, z.y, z.id);
      run(game, 40);
      expect(z.states.has('freeze')).toBe(true);
    });

    it('Telekinesis: 멀리 있는 물약을 줍는다', () => {
      const { game } = setup('Sorceress', { Telekinesis: 1 }, { rarm: item('sst') });
      const hp = item('hp1');
      game.dropItem(hp, 30, 20);
      game.enqueue({ type: 'useSkill', skill: S('Telekinesis').id, hand: 'right', x: 30, y: 20, targetItem: hp.id });
      run(game, 30);
      expect(game.store.find(hp.id)?.where.kind).toBe('belt');
    });

    it('Blaze: 움직이면 발밑에 불이 남는다', () => {
      const { game } = setup('Sorceress', { Blaze: 1 }, { rarm: item('sst') });
      cast(game, 'Blaze', 20.5, 20.5);
      run(game, 20);
      game.enqueue({ type: 'move', x: 30.5, y: 20.5, run: false });
      run(game, 40);
      expect(game.snapshot().missiles.filter((m) => m.name === 'blaze').length).toBeGreaterThan(3);
    });

    // 출처: skills.txt Warmth passivecalc1 ln12 = 30% (1레벨) → 마나 재생 × 1.3
    it('Warmth: 마나 재생 30% 증가', () => {
      const a = setup('Sorceress', {}, { rarm: item('sst') }), b = setup('Sorceress', { Warmth: 1 }, { rarm: item('sst') });
      a.ch.mana = b.ch.mana = 0;
      run(a.game, 100);
      run(b.game, 100);
      expect(b.ch.mana / a.ch.mana).toBeCloseTo(1.3, 5);
    });

    // ---------------------------------------------------------------- 팔라딘
    const setRight = (game: Game, name: string) => {
      game.enqueue({ type: 'setSkill', hand: 'right', skill: S(name).id });
      run(game, 1);
    };

    // 출처: skills.txt Might aurastatcalc1 = ln34 (40 + 10/레벨) → 1레벨 피해 +40%
    it('Might 오라: 오른쪽에 올리면 즉시 damagepercent +40, 내리면 해제', () => {
      const { game } = setup('Paladin', { Might: 1 }, { rarm: item('ssd'), larm: item('buc') });
      setRight(game, 'Might');
      run(game, 2);
      expect(game.snapshot().player.states).toContain('might');
      game.enqueue({ type: 'setSkill', hand: 'right', skill: 0 });
      run(game, 2);
      expect(game.snapshot().player.states).not.toContain('might');
    });

    it('Prayer 오라: 생명이 모자라면 주기마다 회복하고 마나 소모', () => {
      const { game, ch } = setup('Paladin', { Prayer: 5 }, { rarm: item('ssd'), larm: item('buc') });
      ch.life = 10;
      setRight(game, 'Prayer');
      run(game, 120);
      expect(ch.life).toBeGreaterThan(10);
      expect(ch.mana).toBeLessThan(200);
    });

    it('Holy Fire 오라: 범위 안 좀비가 주기마다 화염 피해', () => {
      const { game } = setup('Paladin', { Might: 1, 'Holy Fire': 1 }, { rarm: item('ssd'), larm: item('buc') });
      const z = tough(game, 24.5, 20.5);
      setRight(game, 'Holy Fire');
      const ev = run(game, 110);
      expect(ev.filter((e) => e.type === 'monsterHit' && e.targetId === z.id).length).toBeGreaterThanOrEqual(2);
    });

    it('Smite: 방패로 항상 명중, 기절', () => {
      const { game } = setup('Paladin', { Smite: 1 }, { rarm: item('ssd'), larm: item('buc') });
      const z = tough(game, 22.5, 20.5);
      cast(game, 'Smite', z.x, z.y, z.id);
      const ev = run(game, 20);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
      expect(ev.some((e) => e.type === 'miss')).toBe(false);
      expect(z.states.has('stunned')).toBe(true);
    });

    it('Smite: 방패가 없으면 쓸 수 없다', () => {
      const { game } = setup('Paladin', { Smite: 1 }, { rarm: item('ssd') });
      const z = tough(game, 22.5, 20.5);
      cast(game, 'Smite', z.x, z.y, z.id);
      expect(run(game, 3).some((e) => e.type === 'skillUnusable')).toBe(true);
    });

    // 출처: skills.txt Zeal calc1 = min(par5 + lvl − 1, par6) → 1레벨 2번, 4레벨 5번
    it('Zeal 4레벨: 한 번 사용에 5번 타격', () => {
      const { game } = setup('Paladin', { Sacrifice: 1, Zeal: 4 }, { rarm: item('ssd'), larm: item('buc') });
      const z = tough(game, 22.5, 20.5);
      cast(game, 'Zeal', z.x, z.y, z.id);
      const ev = run(game, 100);
      expect(ev.filter((e) => (e.type === 'monsterHit' || e.type === 'miss') && e.targetId === z.id).length).toBe(5);
    });

    it('Charge: 먼 대상까지 돌진해 한 번 친다', () => {
      const { game } = setup('Paladin', { Smite: 1, Charge: 1 }, { rarm: item('ssd'), larm: item('buc') });
      const z = tough(game, 32.5, 20.5);
      cast(game, 'Charge', z.x, z.y, z.id);
      const ev = run(game, 80);
      expect(game.snapshot().player.x).toBeGreaterThan(28);
      expect(ev.filter((e) => (e.type === 'monsterHit' || e.type === 'miss') && e.targetId === z.id).length).toBe(1);
    });

    it('Sacrifice: 명중하면 자신도 피해', () => {
      const { game, ch } = setup('Paladin', { Sacrifice: 10 }, { rarm: item('ssd'), larm: item('buc') });
      const z = tough(game, 22.5, 20.5);
      let hurt = false;
      for (let k = 0; k < 10 && !hurt; k++) {
        const life = ch.life;
        cast(game, 'Sacrifice', z.x, z.y, z.id);
        const ev = run(game, 30);
        if (ev.some((e) => e.type === 'monsterHit')) hurt = ch.life < life;
      }
      expect(hurt).toBe(true);
    });

    it('Vengeance: 화염·냉기·번개 피해를 더하고 냉기 상태', () => {
      const { game } = setup('Paladin', { Vengeance: 1 }, { rarm: item('ssd'), larm: item('buc') });
      const z = tough(game, 22.5, 20.5);
      let cold = false;
      for (let k = 0; k < 10 && !cold; k++) {
        cast(game, 'Vengeance', z.x, z.y, z.id);
        run(game, 30);
        cold = z.states.has('cold');
      }
      expect(cold).toBe(true);
    });

    it('Holy Bolt: 언데드(좀비)는 맞히고, 언데드가 아닌 폴른은 통과', () => {
      const { game } = setup('Paladin', { 'Holy Bolt': 1 }, { rarm: item('ssd'), larm: item('buc') });
      const f = tough(game, 24.5, 20.5);
      game.monsters.splice(game.monsters.indexOf(f), 1);
      const fallen = game.spawnMonster('fallen1', 24.5, 20.5);
      fallen.hp = 100000;
      fallen.nextThink = 1e9;
      const z = tough(game, 30.5, 20.5);
      cast(game, 'Holy Bolt', z.x, z.y, z.id);
      const ev = run(game, 60);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === fallen.id)).toBe(false);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
    });

    it('Blessed Hammer: 나선으로 돌며 주변 좀비를 맞힌다', () => {
      const { game } = setup('Paladin', { 'Blessed Hammer': 1 }, { rarm: item('ssd'), larm: item('buc') });
      const z = tough(game, 23.5, 22.5);
      cast(game, 'Blessed Hammer', 25, 20.5);
      const ev = run(game, 130);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === z.id)).toBe(true);
    });

    it('Thorns 오라: 근접으로 때린 좀비가 피해를 돌려받는다', () => {
      const { game, ch } = setup('Paladin', { Thorns: 5 }, { rarm: item('ssd'), larm: item('buc') });
      ch.level = 1;
      setRight(game, 'Thorns');
      const z = game.spawnMonster('zombie1', 22.5, 20.5);
      let back = false;
      for (let i = 0; i < 2000 && !back; i++) {
        for (const e of game.tick()) if (e.type === 'monsterHit' && e.targetId === z.id) back = true;
        if (ch.life < 20) ch.life = ch.maxLife;
      }
      expect(back).toBe(true);
    });

    // ---------------------------------------------------------------- 네크로맨서
    const corpse = (game: Game, x: number, y: number) => {
      const z = game.spawnMonster('zombie1', x, y);
      z.mode = 'DD';
      z.hp = 0;
      return z;
    };

    // 출처: skills.txt Amplify Damage aurastatcalc1 = −par5 = −100 (물리 저항 −100 → 물리 피해 2배)
    it('Amplify Damage: 범위 안 좀비 물리 저항 −100', () => {
      const { game } = setup('Necromancer', { 'Amplify Damage': 1 }, { rarm: item('wnd') });
      const z = tough(game, 28.5, 20.5);
      cast(game, 'Amplify Damage', z.x, z.y);
      run(game, 20);
      expect(z.states.has('amplifydamage')).toBe(true);
      expect(z.states.stat('damageresist')).toBe(-100);
    });

    it('저주는 하나만: Weaken 을 걸면 Amplify Damage 가 풀린다', () => {
      const { game } = setup('Necromancer', { 'Amplify Damage': 1, Weaken: 1 }, { rarm: item('wnd') });
      const z = tough(game, 28.5, 20.5);
      cast(game, 'Amplify Damage', z.x, z.y);
      run(game, 20);
      cast(game, 'Weaken', z.x, z.y);
      run(game, 20);
      expect([z.states.has('amplifydamage'), z.states.has('weaken'), z.states.stat('damagepercent')]).toEqual([false, true, -33]);
    });

    // 출처: skills.txt Teeth calc1 = min(ln12, 24), Param1 2 → 1레벨 2개
    it('Teeth: 1레벨 이빨 2개', () => {
      const { game } = setup('Necromancer', { Teeth: 1 }, { rarm: item('wnd') });
      cast(game, 'Teeth', 40.5, 20.5);
      run(game, 20);
      expect(game.snapshot().missiles.filter((m) => m.name === 'teeth').length).toBe(2);
    });

    // 출처: skills.txt Bone Armor aurastatcalc1 = ln12 × 256 → 1레벨 20 흡수
    it('Bone Armor: 근접 피해를 20 까지 흡수', () => {
      const { game, ch } = setup('Necromancer', { 'Bone Armor': 1 }, { rarm: item('wnd') });
      ch.level = 1;
      cast(game, 'Bone Armor', 20.5, 20.5);
      run(game, 20);
      expect(game.snapshot().player.states).toContain('bonearmor');
      const z = game.spawnMonster('zombie1', 22.5, 20.5);
      const life0 = ch.life;
      let hits = 0;
      for (let i = 0; i < 3000 && game.snapshot().player.states.includes('bonearmor'); i++) for (const e of game.tick()) if (e.type === 'playerHit') hits++;
      expect(hits).toBeGreaterThan(0);
      expect(ch.life).toBeGreaterThan(life0 - 5);
      void z;
    });

    it('Raise Skeleton: 시체 자리에 스켈레톤, 스켈레톤이 좀비를 공격해 잡으면 경험치', () => {
      const { game, ch } = setup('Necromancer', { 'Raise Skeleton': 5 }, { rarm: item('wnd') });
      ch.level = 5;
      const c = corpse(game, 22.5, 20.5);
      cast(game, 'Raise Skeleton', c.x, c.y, c.id);
      run(game, 25);
      expect(game.pets.length).toBe(1);
      expect(game.pets[0]!.type.id).toBe('necroskeleton');
      expect(game.monsters.includes(c)).toBe(false);
      const z = game.spawnMonster('zombie1', 26.5, 20.5);
      z.nextThink = 1e9;
      const exp0 = ch.experience;
      for (let i = 0; i < 1500 && z.mode !== 'DD'; i++) game.tick();
      expect(z.mode).toBe('DD');
      expect(ch.experience).toBeGreaterThan(exp0);
    });

    it('Clay Golem: 골렘은 하나만 (다시 부르면 교체)', () => {
      const { game } = setup('Necromancer', { 'Clay Golem': 1 }, { rarm: item('wnd') });
      cast(game, 'Clay Golem', 24.5, 20.5);
      run(game, 25);
      const first = game.pets[0]?.id;
      cast(game, 'Clay Golem', 24.5, 22.5);
      run(game, 25);
      expect(game.pets.length).toBe(1);
      expect(game.pets[0]!.type.id).toBe('claygolem');
      expect(game.pets[0]!.id).not.toBe(first);
    });

    it('몬스터는 가까운 소환수를 공격 대상으로 삼는다', () => {
      const { game } = setup('Necromancer', { 'Clay Golem': 1 }, { rarm: item('wnd') });
      cast(game, 'Clay Golem', 30.5, 20.5);
      run(game, 25);
      const golem = game.pets[0]!;
      golem.nextThink = 1e9;
      const z = game.spawnMonster('zombie1', golem.x + 2, golem.y);
      const hp = golem.hp;
      for (let i = 0; i < 800 && golem.hp === hp; i++) game.tick();
      expect(golem.hp).toBeLessThan(hp);
      void z;
    });

    it('Corpse Explosion: 시체 주변 좀비들이 피해', () => {
      const { game } = setup('Necromancer', { Teeth: 1, 'Corpse Explosion': 1 }, { rarm: item('wnd') });
      const c = corpse(game, 26.5, 20.5);
      const a = tough(game, 27.5, 21.5), b = tough(game, 25.5, 19.5);
      cast(game, 'Corpse Explosion', c.x, c.y, c.id);
      const ev = run(game, 25);
      expect(ev.some((e) => e.type === 'corpseExploded')).toBe(true);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === a.id)).toBe(true);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === b.id)).toBe(true);
    });

    it('Poison Dagger: 단검이 없으면 불가, 단검이면 독', () => {
      const none = setup('Necromancer', { 'Poison Dagger': 1 }, { rarm: item('wnd') });
      const z0 = tough(none.game, 22.5, 20.5);
      cast(none.game, 'Poison Dagger', z0.x, z0.y, z0.id);
      expect(run(none.game, 3).some((e) => e.type === 'skillUnusable')).toBe(true);
      const { game } = setup('Necromancer', { 'Poison Dagger': 1 }, { rarm: item('dgr') });
      const z = tough(game, 22.5, 20.5);
      let poisoned = false;
      for (let k = 0; k < 10 && !poisoned; k++) {
        cast(game, 'Poison Dagger', z.x, z.y, z.id);
        run(game, 25);
        poisoned = z.states.has('poison');
      }
      expect(poisoned).toBe(true);
    });

    it('Bone Spear: 일렬의 좀비를 관통', () => {
      const { game } = setup('Necromancer', { 'Bone Spear': 1 }, { rarm: item('wnd') });
      const a = tough(game, 25.5, 20.5), b = tough(game, 29.5, 20.5);
      cast(game, 'Bone Spear', 40.5, 20.5);
      const ev = run(game, 40);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === a.id)).toBe(true);
      expect(ev.some((e) => e.type === 'monsterHit' && e.targetId === b.id)).toBe(true);
    });

    it('Terror 저주: 좀비가 달아나고, 맞아도 공포가 풀리지 않는다', () => {
      const { game } = setup('Necromancer', { 'Amplify Damage': 1, Weaken: 1, Terror: 1 }, { rarm: item('wnd') });
      const z = game.spawnMonster('zombie1', 24.5, 20.5);
      z.hp = 100000;
      cast(game, 'Terror', z.x, z.y);
      run(game, 20);
      expect(z.states.has('terror')).toBe(true);
      const d0 = Math.hypot(z.x - 20.5, z.y - 20.5);
      run(game, 40);
      expect(Math.hypot(z.x - 20.5, z.y - 20.5)).toBeGreaterThan(d0);
    });

    it('Iron Maiden: 플레이어를 때린 좀비가 피해를 되받는다', () => {
      const { game, ch } = setup('Necromancer', { 'Amplify Damage': 1, 'Iron Maiden': 1 }, { rarm: item('wnd') });
      ch.level = 1;
      const z = game.spawnMonster('zombie1', 22.5, 20.5);
      z.hp = 1000;
      cast(game, 'Iron Maiden', z.x, z.y);
      run(game, 20);
      let back = false;
      for (let i = 0; i < 2000 && !back; i++) {
        for (const e of game.tick()) if (e.type === 'monsterHit' && e.targetId === z.id) back = true;
        if (ch.life < 20) ch.life = ch.maxLife;
      }
      expect(back).toBe(true);
    });

    it('Life Tap: 저주받은 좀비를 때리면 생명 회복', () => {
      const { game, ch } = setup('Necromancer', { Teeth: 5, 'Amplify Damage': 1, 'Iron Maiden': 1, 'Life Tap': 1 }, { rarm: item('wnd') });
      const z = tough(game, 26.5, 20.5);
      cast(game, 'Life Tap', z.x, z.y);
      run(game, 20);
      ch.life = 5;
      for (let k = 0; k < 5; k++) {
        cast(game, 'Teeth', z.x, z.y, z.id);
        run(game, 30);
      }
      expect(ch.life).toBeGreaterThan(5);
    });

    it('Confuse: 혼란에 빠진 좀비가 다른 좀비를 공격', () => {
      const { game } = setup('Necromancer', { 'Dim Vision': 1, Confuse: 1 }, { rarm: item('wnd') });
      const a = game.spawnMonster('zombie1', 30.5, 20.5), b = game.spawnMonster('zombie1', 32.5, 20.5);
      b.hp = 100000;
      b.nextThink = 1e9;
      cast(game, 'Confuse', a.x, a.y);
      const first = run(game, 20);
      expect(a.states.has('confuse')).toBe(true);
      let hit = first.some((e) => e.type === 'monsterHit' && e.targetId === b.id);
      for (let i = 0; i < 1000 && !hit; i++) for (const e of game.tick()) if (e.type === 'monsterHit' && e.targetId === b.id) hit = true;
      expect(hit).toBe(true);
    });

    it('Bone Wall: 뼈벽이 여러 개 세워지고 시간이 지나면 사라진다', () => {
      const { game } = setup('Necromancer', { 'Bone Armor': 1, 'Bone Wall': 1 }, { rarm: item('wnd') });
      cast(game, 'Bone Wall', 30.5, 20.5);
      run(game, 25);
      expect(game.pets.filter((p) => p.type.id === 'bonewall').length).toBeGreaterThan(2);
      run(game, 700);
      expect(game.pets.filter((p) => p.type.id === 'bonewall').length).toBe(0);
    });

    it('Raise Skeletal Mage: 원소 미사일을 쏘는 메이지', () => {
      const { game, ch } = setup('Necromancer', { 'Raise Skeleton': 1, 'Raise Skeletal Mage': 1 }, { rarm: item('wnd') });
      ch.level = 12;
      const c = corpse(game, 22.5, 20.5);
      cast(game, 'Raise Skeletal Mage', c.x, c.y, c.id);
      run(game, 25);
      const mage = game.pets.find((p) => p.type.id === 'necromage');
      expect(mage?.pet?.missile).toMatch(/^necromage[1-4]$/);
      const z = tough(game, 28.5, 20.5);
      let hit = false;
      for (let i = 0; i < 600 && !hit; i++) for (const e of game.tick()) if (e.type === 'monsterHit' && e.targetId === z.id) hit = true;
      expect(hit).toBe(true);
    });

    it('setSkill: 배운 스킬만 오른쪽에, leftskill 플래그 없는 함성은 왼쪽 불가', () => {
      const { game, ch } = setup('Barbarian', { Bash: 1, Howl: 1 }, { rarm: item('hax') });
      game.enqueue({ type: 'setSkill', hand: 'right', skill: S('Howl').id });
      game.enqueue({ type: 'setSkill', hand: 'left', skill: S('Howl').id });
      game.enqueue({ type: 'setSkill', hand: 'left', skill: S('Bash').id });
      game.enqueue({ type: 'setSkill', hand: 'right', skill: S('Leap').id });
      run(game, 1);
      expect([ch.rightSkill, ch.leftSkill]).toEqual([S('Howl').id, S('Bash').id]);
    });

    it('spendSkill / spendStat 명령', () => {
      const { game, ch } = setup('Barbarian', {}, { rarm: item('hax') });
      ch.skillPoints = 1;
      ch.statPoints = 1;
      game.enqueue({ type: 'spendSkill', skill: S('Bash').id });
      game.enqueue({ type: 'spendStat', stat: 'str' });
      run(game, 1);
      expect([ch.skills[S('Bash').id], ch.skillPoints, ch.str, ch.statPoints]).toEqual([1, 0, 31, 0]);
    });
  });
});
