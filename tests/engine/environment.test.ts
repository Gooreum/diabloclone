import { describe, expect, it } from 'vitest';
import { Environment, PERIOD, TIME_RATES } from '../../src/engine/environment';

const run = (e: Environment, n: number, level = 2, act = 0) => {
  for (let i = 0; i < n; i++) e.update(level, act);
};

describe('낮·밤 주기 (D2Environment.cpp)', () => {
  it('새 게임은 정오: 시기 낮, 밝기 128', () => {
    const e = new Environment();
    expect([e.cycle, e.period, e.intensity, e.ticks]).toEqual([2, PERIOD.DAY, 128, 0]);
  });
  it('90° 무렵 가장 밝고(255), 180° 에 128, 밤(270°) 최저 64', () => {
    const e = new Environment();
    run(e, 90 * 128);
    expect(e.intensity).toBe(255);
    const f = new Environment();
    f.ticks = 270 * 128 - 1;
    f.cycle = 5;
    f.period = PERIOD.NIGHT;
    f.update(2, 0);
    expect(f.intensity).toBe(64);
  });
  it('시기 바뀜: 오후(160°) 넘으면 황혼, 밤(200°) 넘으면 밤, 한 바퀴 뒤 다시 낮', () => {
    const e = new Environment();
    run(e, 160 * 128 + 1);
    expect([e.cycle, e.period]).toEqual([3, PERIOD.DUSK]);
    run(e, 40 * 128 + 4);
    expect([e.cycle, e.period]).toEqual([5, PERIOD.NIGHT]);
    for (let i = 0; i < 400_000 && e.period !== PERIOD.DAY; i++) e.update(2, 0);
    expect([e.cycle, e.period]).toEqual([2, PERIOD.DAY]);
  });
  it('밤은 틱이 2배, Act 3 밤은 11배, Act 4 는 16배 빠르다', () => {
    const night = () => {
      const e = new Environment();
      e.cycle = 5; e.period = PERIOD.NIGHT; e.ticks = 210 * 128;
      return e;
    };
    const a = night(); a.tick(0);
    const b = night(); b.tick(2);
    expect([a.ticks - 210 * 128, b.ticks - 210 * 128]).toEqual([2, 11]);
    const c = new Environment(); c.tick(3);
    expect(c.ticks).toBe(16);
  });
  it('Act 4: 레벨 목표 밝기로 한 칸씩 (판데모니움 128, 강 16)', () => {
    const e = new Environment();
    e.intensity = 100;
    e.update(103, 3);
    expect(e.intensity).toBe(101);
    run(e, 200, 103, 3);
    expect(e.intensity).toBe(128);
    run(e, 200, 107, 3);
    expect(e.intensity).toBe(16);
  });
  it('오염된 태양: 일식이면 밝기 32 까지 내려가고, 끝나면 정오·시간 비율 128', () => {
    const e = new Environment();
    run(e, 90 * 128);
    e.taintedSunBegin();
    expect([e.eclipse, e.rate]).toEqual([true, TIME_RATES[1]]);
    run(e, 40, 40, 1);
    expect(e.intensity).toBe(32);
    e.taintedSunEnd();
    // 원작 그대로: InitializeEnvironment 는 일식 표시를 끄기 전에 밝기를 계산해 다음 틱까지 32 로 남는다
    expect([e.eclipse, e.rate, e.cycle, e.period, e.intensity]).toEqual([false, 128, 2, PERIOD.DAY, 32]);
    e.update(40, 1);
    expect(e.intensity).toBe(128);
  });
});
