import { describe, expect, it } from 'vitest';
import { KeyBindings, SKILL_SLOTS } from '../../src/ui/keys';

describe('단축키 설정 — 스킬 Skill 1~8', () => {
  it('기본 키는 원작처럼 F1~F8', () => {
    const k = new KeyBindings();
    expect(SKILL_SLOTS.map((a) => k.map[a])).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);
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
