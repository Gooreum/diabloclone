// 플레이어 애니메이션 속도 공식 (D2MOO Units.cpp) — 널리 알려진 원작 프레임 표와 대조.
// 표 출처: The Arreat Summit / Amazon Basin 의 FCR·IAS·FHR breakpoint 표 (AnimData.d2 값으로 같은 식을 계산한 결과)
import { describe, expect, it } from 'vitest';
import { animSpeedOf, animTiming, attackRate, attackStartFrame, castRate, effectiveBonus, otherRate, wereformBaseSpeed } from '../../src/engine/animspeed';

describe('공격 rate', () => {
  it('기본: 100 − WSM + EIAS + 상태', () => {
    expect(attackRate({ gearIas: 0, stateAttackRate: 0, wsm: 0 })).toBe(100);
    expect(attackRate({ gearIas: 0, stateAttackRate: 0, wsm: -10 })).toBe(110);
    expect(attackRate({ gearIas: 40, stateAttackRate: 0, wsm: 10 })).toBe(90 + effectiveBonus(40));
    expect(effectiveBonus(40)).toBe(30);
    // 늑대인간 20 레벨 +69, 버스트 오브 스피드 +53 처럼 상태의 attackrate 가 더해진다
    expect(attackRate({ gearIas: 0, stateAttackRate: 53, wsm: 0 })).toBe(153);
  });
  it('15..175 로 자른다', () => {
    expect(attackRate({ gearIas: 200, stateAttackRate: 69, wsm: -30 })).toBe(175);
    expect(attackRate({ gearIas: 0, stateAttackRate: -150, wsm: 20 })).toBe(15);
  });
  it('양손 무기: 두 무기 WSM 평균 (C++ 정수 나눗셈)', () => {
    // R = +10 (WSM −10), L = +20 (WSM −20): (10 + 20)/2 = 15
    expect(attackRate({ gearIas: 0, stateAttackRate: 0, wsm: -10, wsmLeft: -20 })).toBe(115);
    // R = +10, L = −5: (10 − 5)/2 = 2 (0 쪽으로 버림)
    expect(attackRate({ gearIas: 0, stateAttackRate: 0, wsm: -10, wsmLeft: 5 })).toBe(102);
  });
  it('시퀀스 동작은 −30', () => {
    expect(attackRate({ gearIas: 0, stateAttackRate: 0, wsm: 0, sequence: true })).toBe(70);
  });
});

describe('시전·그 밖 rate', () => {
  it('시전: 100 + EFCR, 최대 175', () => {
    expect(castRate(0)).toBe(100);
    expect(castRate(105)).toBe(156);
    expect(castRate(1000)).toBe(175);
  });
  it('그 밖: 100 + 상태, 15..175', () => {
    expect(otherRate(0)).toBe(100);
    expect(otherRate(-50)).toBe(50);
    expect(otherRate(-200)).toBe(15);
  });
});

describe('동작 길이: 원작 프레임 표', () => {
  // 소서리스 시전 (SC 14 프레임, 속도 256): FCR 0/9/20/37/63/105/200 → 13/12/11/10/9/8/7
  it('소서리스 시전 FCR breakpoint', () => {
    const fpa = (fcr: number) => animTiming(14, 7, animSpeedOf(castRate(fcr), 256)).duration;
    expect([0, 9, 20, 37, 63, 105, 200].map(fpa)).toEqual([13, 12, 11, 10, 9, 8, 7]);
    expect(fpa(8)).toBe(13);
    expect(fpa(104)).toBe(9);
  });
  // 아마존 한손 휘두르기 (A1 16 프레임, 속도 256, 시작 프레임 2): WSM 0 · IAS 0 → 13
  it('아마존·소서리스 공격은 시작 프레임만큼 짧다', () => {
    expect(attackStartFrame('Amazon', 'A1', '1hs')).toBe(2);
    expect(attackStartFrame('Sorceress', 'A1', 'HTH')).toBe(1);
    expect(attackStartFrame('Amazon', 'A1', 'BOW')).toBe(0);
    expect(attackStartFrame('Barbarian', 'A1', '1HS')).toBe(0);
    expect(attackStartFrame('Amazon', 'TH', '1HT')).toBe(0);
    expect(animTiming(16, 9, animSpeedOf(attackRate({ gearIas: 0, stateAttackRate: 0, wsm: 0 }), 256), 2).duration).toBe(13);
    expect(animTiming(16, 9, animSpeedOf(attackRate({ gearIas: 0, stateAttackRate: 0, wsm: 0 }), 256), 0).duration).toBe(15);
  });
});

describe('변신 공격 속도 (wereform)', () => {
  it('무기 공격 속도 → 기본 속도: 드루이드 한손(19 프레임, 256) + WSM −10 → 17 → 늑대(서 있기 9 프레임) 135', () => {
    expect(wereformBaseSpeed(9, { frames: 19, speed: 256 }, { wsm: -10, ias: 0 })).toBe(135);
    // 무기가 없으면 공격 속도 19
    expect(wereformBaseSpeed(9, { frames: 19, speed: 256 }, null)).toBe(Math.trunc((9 * 256) / 19));
  });
  it('무기 IAS 는 기본 속도에, 그 밖의 IAS·늑대인간 스킬은 rate 에 들어간다', () => {
    const slow = wereformBaseSpeed(9, { frames: 19, speed: 256 }, { wsm: 0, ias: 0 });
    const fast = wereformBaseSpeed(9, { frames: 19, speed: 256 }, { wsm: 0, ias: 40 });
    expect(fast).toBeGreaterThan(slow);
    // 늑대 공격 13 프레임: rate 175 (상한) 에서 프레임 수
    const speed = animSpeedOf(attackRate({ gearIas: 0, stateAttackRate: 69, wsm: -10 }), wereformBaseSpeed(9, { frames: 19, speed: 256 }, { wsm: -10, ias: 0 }));
    expect(speed).toBe(Math.trunc((175 * 135) / 100));
    expect(animTiming(13, 7, speed).duration).toBe(Math.ceil((13 * 256) / speed) - 1);
  });
});
