import { describe, expect, it } from 'vitest';
import { DROPS, Rain } from '../../src/render/weather';

/** 0~10분을 1초 간격으로 보며 비가 켜지고 꺼진 시각 */
const flips = (r: Rain, rainLevel = true) => {
  const out: number[] = [];
  let prev = false;
  for (let t = 0; t <= 600_000; t += 1000) {
    const on = r.active(rainLevel, t);
    if (on !== prev) out.push(t);
    prev = on;
  }
  return out;
};

describe('비', () => {
  it('처음에는 그친 상태, 1~4분 간격으로 번갈아 온다', () => {
    const f = flips(new Rain(1234));
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f[0]).toBeGreaterThanOrEqual(60_000);
    for (let i = 1; i < f.length; i++) {
      expect(f[i]! - f[i - 1]!).toBeGreaterThanOrEqual(59_000);
      expect(f[i]! - f[i - 1]!).toBeLessThanOrEqual(241_000);
    }
  });
  it('같은 시드면 같은 날씨, 다른 시드면 다르다', () => {
    expect(flips(new Rain(7))).toEqual(flips(new Rain(7)));
    expect(flips(new Rain(7))).not.toEqual(flips(new Rain(8)));
  });
  it('비 오는 레벨이 아니면 오지 않는다 (시드 0 도 안전)', () => {
    expect(flips(new Rain(1234), false)).toEqual([]);
    expect(() => flips(new Rain(0))).not.toThrow();
  });
  it('force 로 켜면 바로 비, 빗줄기는 DROPS 개 선', () => {
    const r = new Rain(5);
    r.force(true, 1000);
    expect(r.active(true, 1000)).toBe(true);
    let lines = 0;
    const ctx = { save() {}, restore() {}, beginPath() {}, stroke() {}, moveTo() { lines++; }, lineTo() {}, strokeStyle: '', lineWidth: 0 } as unknown as CanvasRenderingContext2D;
    r.draw(ctx, 1000, 800, 553);
    expect(lines).toBe(DROPS);
  });
});
