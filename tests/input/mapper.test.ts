import { describe, expect, it } from 'vitest';
import { mapLeftClick, mapRightClick } from '../../src/input/mapper';

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

// 출처: Diablo II 매뉴얼 Controls — 우클릭 = 오른쪽 스킬, Shift+좌클릭 = 왼쪽 스킬 제자리 사용
describe('우클릭·Shift 좌클릭 → 스킬', () => {
  it('우클릭: 몬스터 위면 대상 지정, 바닥이면 지점', () => {
    expect(mapRightClick({ worldX: 3, worldY: 4, shift: false, hover: { kind: 'monster', id: 9 }, run: false, rightSkill: 126 })).toEqual({ type: 'useSkill', skill: 126, hand: 'right', x: 3, y: 4, targetId: 9 });
    expect(mapRightClick({ worldX: 3, worldY: 4, shift: false, hover: null, run: false, rightSkill: 130 })).toEqual({ type: 'useSkill', skill: 130, hand: 'right', x: 3, y: 4 });
  });
  it('우클릭: 시체 위면 시체 대상 (Find Potion), 아이템 위면 아이템 (Telekinesis)', () => {
    expect(mapRightClick({ worldX: 0, worldY: 0, shift: false, hover: { kind: 'corpse', id: 5 }, run: false, rightSkill: 131 })).toMatchObject({ targetId: 5 });
    expect(mapRightClick({ worldX: 0, worldY: 0, shift: false, hover: { kind: 'item', id: 5 }, run: false, rightSkill: 43 })).toMatchObject({ targetItem: 5 });
    expect(mapRightClick({ worldX: 0, worldY: 0, shift: false, hover: { kind: 'item', id: 5 }, run: false, rightSkill: 43 })).not.toHaveProperty('targetId');
  });
  it('Shift + 바닥 좌클릭: 왼쪽 스킬이 Attack 이 아니면 그 지점에 사용', () => {
    expect(mapLeftClick({ worldX: 1, worldY: 2, shift: true, hover: null, run: false, leftSkill: 132 })).toEqual({ type: 'useSkill', skill: 132, hand: 'left', x: 1, y: 2, standStill: true });
  });
  it('오른쪽 클릭: Shift 없으면 근접 스킬이 대상에게 걸어가고(standStill 없음), Shift 면 제자리', () => {
    expect(mapRightClick({ worldX: 1, worldY: 2, shift: false, hover: { kind: 'monster', id: 7 }, run: false, rightSkill: 126 })).toEqual({ type: 'useSkill', skill: 126, hand: 'right', x: 1, y: 2, targetId: 7 });
    expect(mapRightClick({ worldX: 1, worldY: 2, shift: true, hover: { kind: 'monster', id: 7 }, run: false, rightSkill: 126 })).toEqual({ type: 'useSkill', skill: 126, hand: 'right', x: 1, y: 2, standStill: true, targetId: 7 });
  });
});
