import { describe, expect, it } from 'vitest';
import { actionsFor, KeyBindings, keyName, SKILL_SLOTS } from '../../src/ui/keys';

describe('단축키 설정 — 스킬 Skill 1~8', () => {
  it('기본 키는 원작처럼 F1~F8', () => {
    const k = new KeyBindings();
    expect(SKILL_SLOTS.map((a) => k.map[a])).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', '', '', '', '', '', '', '', '']);
    expect(k.actionOf({ key: 'F3' })).toBe('skill3');
  });
  it('F키가 없는 키보드: Skill 1 을 Z 로 바꾸면 Z 가 skill1, F1 은 아무것도 아님', () => {
    const k = new KeyBindings();
    k.set('skill1', 'Z');
    expect(k.actionOf({ key: 'z' })).toBe('skill1');
    expect(k.actionOf({ key: 'F1' })).toBeNull();
  });
  it('다른 기능이 쓰던 키를 주면 그 기능은 비워진다 (한 키 = 한 기능)', () => {
    const k = new KeyBindings();
    k.set('skill2', 'C');
    expect(k.map.char).toBe('');
    expect(k.actionOf({ key: 'c' })).toBe('skill2');
  });
});

describe('단축키 설정 — 확장팩 용병 창 (Hireling Screen)', () => {
  it('기본 키는 원작 확장팩처럼 O, 다른 키로 바꿀 수 있다', () => {
    const k = new KeyBindings();
    expect(k.map.hireling).toBe('O');
    expect(k.actionOf({ key: 'o' })).toBe('hireling');
    k.set('hireling', 'H');
    expect(k.actionOf({ key: 'h' })).toBe('hireling');
    expect(k.actionOf({ key: 'o' })).toBeNull();
  });
  it('Shift + 숫자 (! @ …)도 벨트 키로 읽는다 (Shift+벨트 = 용병에게 물약)', () => {
    const k = new KeyBindings();
    expect(k.actionOf({ key: '!', code: 'Digit1' })).toBe('belt1');
    expect(k.actionOf({ key: '$', code: 'Digit4' })).toBe('belt4');
  });
});

describe('원작 Configure Controls 의 나머지 기능 (도움말·채팅·화면 지우기·휠·Skill 9~16)', () => {
  it('원작 기본 키: H 도움말, Enter 채팅, Space 화면 지우기, 휠 위/아래 이전/다음 스킬, 9~16 은 없음', () => {
    const k = new KeyBindings();
    k.reset();
    expect([k.map.help, k.map.chat, k.map.clearscreen, k.map.skillup, k.map.skilldown]).toEqual(['H', 'Enter', ' ', 'WheelUp', 'WheelDown']);
    expect(k.actionOf({ key: 'h', code: 'KeyH' })).toBe('help');
    expect(k.actionOf({ key: 'Enter' })).toBe('chat');
    expect(k.actionOf({ key: ' ' })).toBe('clearscreen');
    expect(k.actionOf({ key: 'WheelDown' })).toBe('skilldown');
    expect(k.actionOf({ key: 'WheelUp' })).toBe('skillup');
    expect(k.map.skill9).toBe('');
  });

  it('휠도 조합·다른 기능에 배정할 수 있다', () => {
    const k = new KeyBindings();
    k.reset();
    expect(keyName({ key: 'WheelUp', shiftKey: true })).toBe('Shift+WheelUp');
    k.set('skill9', 'Shift+WheelUp');
    expect(k.actionOf({ key: 'WheelUp', shiftKey: true })).toBe('skill9');
    // 조합에 배정이 없으면 휠 하나로 (이전 스킬)
    expect(k.actionOf({ key: 'WheelUp', ctrlKey: true })).toBe('skillup');
    const str = (s: string) => ({ KeyWheelUp: 'Mouse Wheel Up', KeyShift: 'Shift', KeyF12: 'F12' })[s] ?? s;
    expect(k.label('WheelUp', str)).toBe('Mouse Wheel Up');
    expect(k.label('Shift+WheelUp', str)).toBe('Shift+Mouse Wheel Up');
    expect(k.label('F12', str)).toBe('F12');
  });

  it('클래식 판본 목록엔 확장팩 전용(Skill 9~16·Swap Weapons·Hireling Screen)이 없다 (원작 문자열이 expansionstring.tbl 에만)', () => {
    expect(actionsFor(false)).not.toContain('skill9');
    expect(actionsFor(false)).not.toContain('swap');
    expect(actionsFor(false)).toContain('skill8');
    expect(actionsFor(false)).toContain('help');
    expect(actionsFor(true)).toContain('skill16');
    expect(actionsFor(true).length).toBe(actionsFor(false).length + 10);
  });
});
