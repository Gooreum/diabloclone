import { describe, expect, it } from 'vitest';
import { ASSIST_PX, pickAt, type PickBox } from '../../src/input/pick';

const mon = (id: number, x: number, y: number): PickBox => ({ kind: 'monster', id, x, y, w: 40, h: 75 });

// 원작과 다름(사용자 요청): 몬스터 상자 근처를 가리켜도 그 몬스터 (조준 보조)
describe('pickAt — 정확히 가리킨 상자, 없으면 가까운 몬스터', () => {
  it('상자 안이면 그 상자, 겹치면 나중(위) 상자', () => {
    expect(pickAt([mon(1, 100, 100)], 120, 140)).toEqual({ kind: 'monster', id: 1 });
    expect(pickAt([mon(1, 100, 100), mon(2, 110, 100)], 120, 140)).toEqual({ kind: 'monster', id: 2 });
  });
  it('상자 밖 30px 이면 그 몬스터, ASSIST_PX 를 넘으면 없음', () => {
    expect(pickAt([mon(1, 100, 100)], 170, 140)).toEqual({ kind: 'monster', id: 1 });
    expect(pickAt([mon(1, 100, 100)], 140 + ASSIST_PX + 1, 140)).toBeNull();
    expect(pickAt([mon(1, 100, 100)], 120, 100 - ASSIST_PX - 1)).toBeNull();
  });
  it('두 몬스터 사이면 더 가까운 쪽', () => {
    const boxes = [mon(1, 100, 100), mon(2, 200, 100)];
    expect(pickAt(boxes, 150, 140)).toEqual({ kind: 'monster', id: 1 });
    expect(pickAt(boxes, 185, 140)).toEqual({ kind: 'monster', id: 2 });
  });
  it('아이템·NPC·오브젝트·시체는 정확히 가리켜야 (근처는 없음)', () => {
    for (const kind of ['item', 'npc', 'object', 'corpse', 'body'] as const) {
      expect(pickAt([{ kind, id: 5, x: 100, y: 100, w: 40, h: 20 }], 160, 110)).toBeNull();
    }
  });
  it('아이템 상자 안이면 가까운 몬스터보다 아이템', () => {
    const boxes = [mon(1, 100, 100), { kind: 'item' as const, id: 9, x: 150, y: 130, w: 60, h: 16 }];
    expect(pickAt(boxes, 160, 135)).toEqual({ kind: 'item', id: 9 });
  });
});
