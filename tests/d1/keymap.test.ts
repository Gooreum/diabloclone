import { describe, expect, it } from 'vitest';
import { keyName, loneModifier, mouseName, rejectReason } from '../../src/d1/keymap';

// 디아블로 1 게임 중 단축키 화면: 브라우저 키 → DevilutionX 키 이름
const k = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe('keyName', () => {
  it('글자·숫자·키패드·기호 → DevilutionX 이름', () => {
    expect(keyName(k('KeyA'))).toBe('A');
    expect(keyName(k('Digit7'))).toBe('7');
    expect(keyName(k('Numpad3'))).toBe('KEYPADNUM 3');
    expect(keyName(k('NumpadEnter'))).toBe('KEYPAD ENTER');
    expect(keyName(k('Space'))).toBe('SPACE');
    expect(keyName(k('Backquote'))).toBe('`');
    expect(keyName(k('F13'))).toBe('F13');
  });

  it('동시키: CTRL+ALT+SHIFT 순서로 붙는다', () => {
    expect(keyName(k('Digit1', { shiftKey: true }))).toBe('SHIFT+1');
    expect(keyName(k('KeyA', { ctrlKey: true, altKey: true }))).toBe('CTRL+ALT+A');
    expect(keyName(k('KeyQ', { altKey: true, shiftKey: true }))).toBe('ALT+SHIFT+Q');
  });

  it('브라우저가 먼저 쓰는 키와 수정 키만은 null', () => {
    for (const e of [k('F1'), k('F5', { shiftKey: true }), k('F12'), k('KeyW', { ctrlKey: true }), k('Tab', { ctrlKey: true }), k('KeyK', { metaKey: true }),
      k('ShiftLeft', { shiftKey: true }), k('AltLeft', { altKey: true }), k('ControlRight', { ctrlKey: true }), k('ArrowUp')]) {
      expect(keyName(e), e.code).toBeNull();
    }
  });
});

describe('rejectReason', () => {
  it('F키·Cmd·Ctrl 예약 키는 이유를, 수정 키만이면 null (기다림)', () => {
    expect(rejectReason(k('F1'))).toMatch(/F1~F12/);
    expect(rejectReason(k('KeyK', { metaKey: true }))).toMatch(/Cmd/);
    expect(rejectReason(k('KeyW', { ctrlKey: true }))).toMatch(/Ctrl/);
    expect(rejectReason(k('ShiftLeft'))).toBeNull();
    expect(rejectReason(k('AltRight'))).toBeNull();
  });
});

describe('loneModifier · mouseName', () => {
  it('Alt·Ctrl 혼자 → LALT·RCONTROL, Shift 는 아님', () => {
    expect(loneModifier('AltLeft')).toBe('LALT');
    expect(loneModifier('ControlRight')).toBe('RCONTROL');
    expect(loneModifier('ShiftLeft')).toBeNull();
  });
  it('휠·가운데·옆 단추', () => {
    expect(mouseName({ type: 'wheel', deltaY: -3 })).toBe('SCROLLUPMOUSE');
    expect(mouseName({ type: 'wheel', deltaY: 3 })).toBe('SCROLLDOWNMOUSE');
    expect(mouseName({ type: 'mousedown', button: 1 })).toBe('MMOUSE');
    expect(mouseName({ type: 'mousedown', button: 4 })).toBe('X2MOUSE');
    expect(mouseName({ type: 'mousedown', button: 0 })).toBeNull();
  });
});
