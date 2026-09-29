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
    const tough = (game: Game, x: number, y: number) => {
      const z = game.spawnMonster('zombie1', x, y);
      z.hp = z.stats.maxHp = 100000;
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
