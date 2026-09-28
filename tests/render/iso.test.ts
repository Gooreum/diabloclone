import { describe, expect, it } from 'vitest';
import { fromCanvas, screenToWorld, toCanvas, worldToScreen } from '../../src/render/iso';
import { dir64 } from '../../src/engine/geom';

// 출처: Phrozen Keep KB a=463 — 서브타일 32×16px, 타일 160×80px
describe('등각 좌표', () => {
  it('서브타일 (1,0) → 화면 (+16,+8), (0,1) → (−16,+8)', () => {
    expect(worldToScreen(1, 0)).toEqual({ x: 16, y: 8 });
    expect(worldToScreen(0, 1)).toEqual({ x: -16, y: 8 });
  });
  it('타일 1칸(5서브타일) → (+80,+40)', () => {
    expect(worldToScreen(5, 0)).toEqual({ x: 80, y: 40 });
  });
  it('화면 ↔ 월드 왕복', () => {
    const w = screenToWorld(worldToScreen(12.5, 7.25).x, worldToScreen(12.5, 7.25).y);
    expect(w.x).toBeCloseTo(12.5);
    expect(w.y).toBeCloseTo(7.25);
    const cam = { x: 50, y: 60, width: 800, height: 600 };
    const c = toCanvas(cam, 50, 60);
    expect(c).toEqual({ x: 400, y: 300 });
    const back = fromCanvas(cam, 400, 300);
    expect(back.x).toBeCloseTo(50);
    expect(back.y).toBeCloseTo(60);
  });
});

// 출처: OpenDiablo2 dcc_dir_lookup.go — 64방향 0 = 남(화면 아래), 시계 방향
describe('64방향', () => {
  it('화면 아래(월드 +x+y) = 0, 화면 왼쪽(월드 −x+y) = 16, 위 = 32, 오른쪽 = 48', () => {
    expect(dir64(1, 1)).toBe(0);
    expect(dir64(-1, 1)).toBe(16);
    expect(dir64(-1, -1)).toBe(32);
    expect(dir64(1, -1)).toBe(48);
  });
});
