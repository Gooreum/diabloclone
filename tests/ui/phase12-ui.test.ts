// Phase 12 Step 2 (UI): 단축키 설정·바닥 이름표 배치·메시지 흐려짐·스킬 툴팁 레벨별 줄 (원작 skilldesc + SkillCalc)
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, KeyBindings, keyName } from '../../src/ui/keys';
import { layoutLabels } from '../../src/ui/groundlabels';
import { MessageLog } from '../../src/ui/messages';
import { SkillTip } from '../../src/ui/skilltip';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { gameChain, hasGameData } from '../support/gamedata';

describe('단축키 설정 (CONFIGURE CONTROLS)', () => {
  it('기본 키: C·I·T·Q·Tab·R·1~4·~·Alt', () => {
    const k = new KeyBindings();
    expect(k.actionOf({ key: 'c' })).toBe('char');
    expect(k.actionOf({ key: 'Tab' })).toBe('automap');
    expect(k.actionOf({ key: '~' })).toBe('beltshow');
    expect(k.actionOf({ key: 'Alt' })).toBe('showitems');
    expect(k.is({ key: '3' }, 'belt3')).toBe(true);
  });
  it('같은 키를 다른 기능에 주면 원래 기능은 비고, 기본값으로 되돌릴 수 있다', () => {
    const k = new KeyBindings();
    k.set('inv', 'C');
    expect(k.actionOf({ key: 'c' })).toBe('inv');
    expect(k.map.char).toBe('');
    expect(k.label('', (s) => (s === 'KeyNone' ? 'None' : s))).toBe('None');
    k.reset();
    expect(k.map).toEqual(DEFAULT_KEYS);
  });
  it('localStorage 가 없거나 깨져도 기본 키 (예외 없음)', () => {
    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = { getItem: () => '{broken', setItem: () => { throw new Error('quota'); } };
    const k = new KeyBindings();
    expect(k.map.inv).toBe('I');
    expect(() => k.save()).not.toThrow();
    g.localStorage = prev;
  });
  it('키 이름: 글자는 대문자, ` 와 ~ 는 같은 키', () => {
    expect(keyName({ key: 'k' })).toBe('K');
    expect(keyName({ key: '~' })).toBe('`');
    expect(keyName({ key: 'Enter' })).toBe('Enter');
  });
});

describe('바닥 이름표 배치 (Alt)', () => {
  it('겹치는 이름표는 위로 비켜 쌓는다', () => {
    const r = layoutLabels([
      { id: 1, text: 'Hand Axe', color: '#fff', x: 400, y: 300 },
      { id: 2, text: 'Cap', color: '#fff', x: 405, y: 300 },
      { id: 3, text: 'Far', color: '#fff', x: 100, y: 300 },
    ], (t) => t.length * 8, 16);
    const a = r.find((x) => x.id === 1)!, b = r.find((x) => x.id === 2)!, c = r.find((x) => x.id === 3)!;
    expect(a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    expect(c.y).toBe(300 - 18);
  });
  it('이름표가 없으면 빈 목록', () => {
    expect(layoutLabels([], () => 0, 16)).toEqual([]);
  });
});

describe('메시지 (왼쪽 위, 흐려짐)', () => {
  it('7초 뒤 사라지고 최대 5줄', () => {
    const m = new MessageLog();
    for (let i = 0; i < 7; i++) m.push(`m${i}`, 0);
    expect(m.lines.length).toBe(5);
    expect(m.visible(6500).length).toBe(5);
    expect(m.visible(7100).length).toBe(0);
    m.push('', 0);
    expect(m.lines.length).toBe(5);
  });
});

describe.skipIf(!hasGameData)('스킬 툴팁 레벨별 줄 (원작 skilldesc.txt + skills.txt)', () => {
  let data: GameData;
  let tables: GameTables;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });
  // 그 스킬만 lvl 레벨 (시너지 스킬은 0)
  const tip = (lvl: number, id: number) => new SkillTip({ calc: data.skillCalc!, owner: () => ({ baseLevel: (x) => (x === id ? lvl : 0), skillLevel: (x) => (x === id ? lvl : 0), unitLevel: 10 }), str: (k) => tables.string(k) });
  const row = (name: string) => tables.table('skilldesc').find((r) => r.skilldesc === name);

  // 출처: The Arreat Summit — Fire Bolt 1레벨 화염 3-6, 마나 2.5
  it('Fire Bolt: 현재 레벨 "Fire Damage: 3-6" · "Mana Cost: 2.5", 다음 레벨, 시너지 머리줄', () => {
    const s = data.skills!.byNameOf('Fire Bolt')!;
    const t = tip(1, s.id).lines(s, row('fire bolt'), 1);
    const text = t.level.map((l) => l.text);
    expect(text[0]).toBe('Current Skill Level: 1');
    expect(text).toContain('Fire Damage: 3-6');
    expect(text).toContain('Mana Cost: 2.5');
    expect(text).toContain('Next Level');
    expect(t.dsc3[0]).toEqual({ text: 'Fire Bolt Receives Bonuses From:', color: 'green' });
    expect(t.dsc3.some((l) => /^Fire Ball: \+\d+% Fire Damage per Level$/.test(l.text))).toBe(true);
  });
  it('Bash: descline 2 = "Attack: +20 percent" (S1+C1S2), 배우지 않으면 First Level', () => {
    const s = data.skills!.byNameOf('Bash')!;
    const cur = tip(1, s.id).lines(s, row('bash'), 1).level.map((l) => l.text);
    expect(cur).toContain('Attack: +20 percent');
    expect(cur).toContain('Mana Cost: 2');
    const first = tip(0, s.id).lines(s, row('bash'), 0).level.map((l) => l.text);
    expect(first[0]).toBe('First Level');
    expect(first).not.toContain('Next Level');
  });
  it('skilldesc 행이 없으면 빈 줄', () => {
    const s = data.skills!.byNameOf('Bash')!;
    expect(tip(1, s.id).lines(s, undefined, 1)).toEqual({ dsc2: [], level: [], dsc3: [] });
  });
});
