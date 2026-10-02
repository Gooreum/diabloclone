// 지금 쓸 수 있는 스킬 판정 (원작 SKILLS_GetUseState — 아니면 아이콘이 빨갛다) · 맨손 공격 · 7직업 전 스킬 "쓸 수 있다는데 안 나감" 0개.
// 출처: D2MOO D2Skills.cpp SKILLS_GetUseState, D2Common_SKILLS_CheckShapeRestriction, sub_6FDB1130 (맨손)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { classStats, createCharacter, expTable, type ClassName } from '../../src/engine/player';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { CLASS_CODE } from '../../src/engine/skills/db';

let tables: GameTables;
let data: GameData;
beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables, { expansion: true });
});

const S = (n: string) => data.skills!.byNameOf(n)!;
const item = (code: string, qty?: number): ItemInstance => {
  const it = data.treasure.createItem(data.items.base(code)!, 30, new Rng(2), QUALITY.NORMAL, false);
  if (qty !== undefined) it.quantity = qty;
  return it;
};

/** 모든 클래스 스킬 20 레벨, 마나 넉넉 */
function setup(cls: ClassName, equipment: Record<string, ItemInstance> = {}) {
  const cs = classStats(tables.table('charstats'), cls);
  const ch = createCharacter(cs);
  ch.level = 99;
  ch.str = ch.dex = 500;
  ch.life = ch.maxLife = 1e5;
  ch.mana = ch.maxMana = 1e5;
  for (const s of data.skills!.byId.values()) if (s.charclass === CLASS_CODE[cls]) ch.skills[s.id] = 20;
  const game = new Game({
    map: new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 5, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls), equipment, inTown: false,
  });
  game.tick();
  return { game, ch };
}

function dummy(game: Game, id = 'zombie1', x = 22.5, y = 20.5) {
  const m = game.spawnMonster(id, x, y);
  m.hp = m.stats.maxHp = 1e6;
  m.nextThink = Number.POSITIVE_INFINITY;
  return m;
}

function use(game: Game, skill: number, x: number, y: number, targetId?: number, ticks = 60): GameEvent[] {
  game.enqueue({ type: 'useSkill', skill, hand: 'right', x, y, ...(targetId !== undefined ? { targetId } : {}) });
  const ev: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) ev.push(...game.tick());
  return ev;
}

describe.skipIf(!hasGameData)('맨손 공격 (원작 sub_6FDB1130)', () => {
  it('무기가 없어도 Attack 은 쓸 수 있고 실제로 좀비를 친다', () => {
    const { game } = setup('Barbarian');
    expect(game.skillUseState(0)).toBe('usable');
    const m = dummy(game);
    const ev: GameEvent[] = [];
    for (let i = 0; i < 100 && !ev.some((e) => e.type === 'monsterHit'); i++) {
      if (i % 25 === 0) game.enqueue({ type: 'attack', targetId: m.id, standStill: true });
      ev.push(...game.tick());
    }
    expect(ev.some((e) => e.type === 'monsterHit')).toBe(true);
  });
  it('무기가 필요한 스킬(Bash: itypea 가 mele 이 아님?)은 표 그대로 판정', () => {
    const { game } = setup('Barbarian');
    const bash = S('Bash');
    const unarmed = ['weap', 'mele', 'h2h'].includes(bash.itypeA[0] ?? '') && !bash.itypeB.length;
    expect(game.skillUseState(bash.id)).toBe(unarmed || !bash.itypeA.length ? 'usable' : 'weapon');
  });
});

describe.skipIf(!hasGameData)('드루이드 세 모습 (restrict / State1~3)', () => {
  function inForm(form: 'human' | 'wolf' | 'bear') {
    const r = setup('Druid');
    if (form !== 'human') use(r.game, S(form === 'wolf' ? 'Wearwolf' : 'Wearbear').id, 21, 21);
    return r;
  }
  it('사람: 변신 스킬은 shape, 원소 마법·소환은 usable', () => {
    const { game } = inForm('human');
    for (const n of ['Fury', 'Maul', 'Shock Wave', 'Feral Rage', 'Hunger']) expect(game.skillUseState(S(n).id), n).toBe('shape');
    for (const n of ['Tornado', 'Hurricane', 'Armageddon', 'Oak Sage', 'Raven']) expect(game.skillUseState(S(n).id), n).toBe('usable');
  });
  it('늑대: Fury·Feral Rage·Fire Claws 는 usable, Tornado·Maul 은 shape', () => {
    const { game } = inForm('wolf');
    for (const n of ['Fury', 'Feral Rage', 'Fire Claws', 'Rabies', 'Armageddon', 'Oak Sage']) expect(game.skillUseState(S(n).id), n).toBe('usable');
    for (const n of ['Tornado', 'Maul', 'Shock Wave', 'Hurricane']) expect(game.skillUseState(S(n).id), n).toBe('shape');
  });
  it('곰: Maul·Shock Wave·Hunger 는 usable, Fury·Tornado 는 shape', () => {
    const { game } = inForm('bear');
    for (const n of ['Maul', 'Shock Wave', 'Hunger', 'Fire Claws', 'Armageddon']) expect(game.skillUseState(S(n).id), n).toBe('usable');
    for (const n of ['Fury', 'Feral Rage', 'Tornado']) expect(game.skillUseState(S(n).id), n).toBe('shape');
  });
});

describe.skipIf(!hasGameData)('무기 · 수량 · 마나 · 지연', () => {
  it('아마존: 자벨린이면 Multiple Shot 은 weapon, 활+화살이면 usable, 활만 있고 화살 없으면 quantity', () => {
    expect(setup('Amazon', { rarm: item('jav', 50) }).game.skillUseState(S('Multiple Shot').id)).toBe('weapon');
    expect(setup('Amazon', { rarm: item('sbw'), larm: item('aqv', 100) }).game.skillUseState(S('Multiple Shot').id)).toBe('usable');
    expect(setup('Amazon', { rarm: item('sbw') }).game.skillUseState(S('Multiple Shot').id)).toBe('quantity');
  });
  it('마나 0: Fire Ball 은 mana, AttackNoMana 스킬은 usable', () => {
    const { game, ch } = setup('Sorceress');
    ch.mana = 0;
    expect(game.skillUseState(S('Fire Ball').id)).toBe('mana');
    const anm = [...data.skills!.byId.values()].find((s) => s.attackNoMana && s.charclass === 'bar')!;
    const b = setup('Barbarian', { rarm: item('axe') });
    b.ch.mana = 0;
    expect(b.game.skillUseState(anm.id), anm.name).toBe('usable');
  });
  it('Blizzard 를 쓴 직후는 delay, 지연이 지나면 usable', () => {
    const { game } = setup('Sorceress');
    use(game, S('Blizzard').id, 30.5, 20.5, undefined, 3);
    expect(game.skillUseState(S('Blizzard').id)).toBe('delay');
    for (let i = 0; i < 100; i++) game.tick();
    expect(game.skillUseState(S('Blizzard').id)).toBe('usable');
  });
});
