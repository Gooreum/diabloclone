import { describe, expect, it } from 'vitest';
import { mapLeftClick } from '../../src/input/mapper';

// 출처: Diablo II 매뉴얼 Controls — 좌클릭 이동/공격/줍기, Shift+좌클릭 제자리 공격
describe('좌클릭 → 명령', () => {
  it('빈 바닥 클릭 → move (달리기 토글 반영)', () => {
    expect(mapLeftClick({ worldX: 10, worldY: 12, shift: false, hover: null, run: true })).toEqual({ type: 'move', x: 10, y: 12, run: true });
  });
  it('몬스터 클릭 → attack, Shift 면 standStill', () => {
    expect(mapLeftClick({ worldX: 0, worldY: 0, shift: false, hover: { kind: 'monster', id: 7 }, run: false })).toEqual({ type: 'attack', targetId: 7, standStill: false });
    expect(mapLeftClick({ worldX: 0, worldY: 0, shift: true, hover: { kind: 'monster', id: 7 }, run: false })).toEqual({ type: 'attack', targetId: 7, standStill: true });
  });
  it('아이템 클릭 → pickup', () => {
    expect(mapLeftClick({ worldX: 0, worldY: 0, shift: false, hover: { kind: 'item', id: 3 }, run: false })).toEqual({ type: 'pickup', itemId: 3 });
  });
  it('Shift + 빈 바닥 → 명령 없음 (이동하지 않음)', () => {
    expect(mapLeftClick({ worldX: 1, worldY: 1, shift: true, hover: null, run: false })).toBeNull();
  });
});
