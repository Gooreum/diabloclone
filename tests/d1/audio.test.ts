import { describe, expect, it } from 'vitest';
import { panValue, volumeGain } from '../../src/d1/audio';

// 출처: DirectSound 단위 — 1/100 dB. -2000 = -20 dB = 0.1 배
describe('디아블로 1 소리 단위 변환 (DirectSound → Web Audio)', () => {
  it('음량: 0 은 1배, -2000 은 0.1배', () => {
    expect(volumeGain(0)).toBe(1);
    expect(volumeGain(-2000)).toBeCloseTo(0.1, 9);
    expect(volumeGain(-4000)).toBeCloseTo(0.01, 9);
  });

  it('음량 범위 밖은 잠근다 (-10000 … 0)', () => {
    expect(volumeGain(-20000)).toBeCloseTo(volumeGain(-10000), 12);
    expect(volumeGain(-10000)).toBeCloseTo(0.00001, 9);
    expect(volumeGain(500)).toBe(1);
  });

  it('팬: 가운데 0, 끝은 ±1 에 가깝고 홀함수', () => {
    expect(panValue(0)).toBe(0);
    expect(panValue(-10000)).toBeCloseTo(-0.99999, 4);
    expect(panValue(10000)).toBeCloseTo(0.99999, 4);
    expect(panValue(-2000)).toBeCloseTo(-0.9, 9);
    for (const p of [1, 500, 2000, 6400, 10000]) expect(panValue(-p)).toBeCloseTo(-panValue(p), 12);
    // 범위 밖도 잠긴다
    expect(panValue(-30000)).toBe(panValue(-10000));
  });
});
