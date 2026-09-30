import { describe, expect, it } from 'vitest';
import { Canvas2dSink } from '../../src/render/sink';
import type { Drawable } from '../../src/render/sprites';

/** 호출을 기록하는 가짜 2D 컨텍스트 */
function fakeCtx() {
  const log: string[] = [];
  const ctx = {
    fillStyle: '', filter: 'none', globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillRect: (x: number, y: number, w: number, h: number) => log.push(`fill ${ctx.fillStyle} ${x},${y},${w},${h}`),
    save: () => log.push('save'),
    restore: () => log.push('restore'),
    drawImage: (_c: unknown, x: number, y: number) => log.push(`draw ${x},${y} a=${ctx.globalAlpha} op=${ctx.globalCompositeOperation} f=${ctx.filter}`),
  };
  return { ctx, log };
}

/** 키별로 한 번만 만드는 가짜 캐시 */
function fakeCache() {
  const m = new Map<string, Drawable>();
  return { m, get: (k: string, make: () => Drawable) => m.get(k) ?? (m.set(k, make()), m.get(k)!), clear: () => m.clear() };
}

const pal = new Uint8Array(1024);
const img = { id: 'u1:0:0', w: 2, h: 2, pixels: new Uint8Array([0, 1, 2, 3]) };

function setup() {
  const { ctx, log } = fakeCtx();
  const cache = fakeCache();
  const made: Uint8Array[] = [];
  const sink = new Canvas2dSink(ctx as unknown as CanvasRenderingContext2D, pal, cache, (px) => (made.push(px), {} as Drawable));
  return { sink, log, cache, made };
}

describe('Canvas2dSink', () => {
  it('같은 id 는 캔버스를 한 번만 만들고 좌표 그대로 그린다', () => {
    const { sink, log, made } = setup();
    sink.draw(img, 10, 20);
    sink.draw(img, 30, 40);
    expect(made.length).toBe(1);
    expect(log.filter((l) => l.startsWith('draw')).map((l) => l.split(' ')[1])).toEqual(['10,20', '30,40']);
  });

  it('색 바꿈 표를 픽셀에 적용하고 0(투명)은 그대로 둔다', () => {
    const { sink, made } = setup();
    const map = new Uint8Array(256).map((_, i) => (i + 10) & 255);
    sink.draw(img, 0, 0, { shift: { key: 'rt3', map } });
    expect([...made[0]!]).toEqual([0, 11, 12, 13]);
  });

  it('같은 그림이라도 색 바꿈 유무에 따라 캔버스가 따로다', () => {
    const { sink, cache } = setup();
    sink.draw(img, 0, 0);
    sink.draw(img, 0, 0, { shift: { key: 'rt3', map: new Uint8Array(256) } });
    sink.draw(img, 0, 0);
    expect([...cache.m.keys()]).toEqual(['u1:0:0', 'u1:0:0:rt3']);
  });

  it('blend 0/1/2 = 불투명도 75/50/25%, 그린 뒤 복원', () => {
    const { sink, log } = setup();
    for (const b of [0, 1, 2]) sink.draw(img, 0, 0, { blend: b });
    expect(log).toEqual([
      'save', 'draw 0,0 a=0.75 op=source-over f=none', 'restore',
      'save', 'draw 0,0 a=0.5 op=source-over f=none', 'restore',
      'save', 'draw 0,0 a=0.25 op=source-over f=none', 'restore',
    ]);
  });

  it('blend 3 = 더하기(lighter), 4 = 곱하기(multiply), bright = 밝게', () => {
    const { sink, log } = setup();
    sink.draw(img, 0, 0, { blend: 3 });
    sink.draw(img, 0, 0, { blend: 4, bright: true });
    const draws = log.filter((l) => l.startsWith('draw'));
    expect(draws[0]).toContain('op=lighter');
    expect(draws[1]).toContain('op=multiply');
    expect(draws[1]).toContain('f=brightness(1.6)');
  });

  it('불투명·보통 밝기는 save/restore 없이 그린다', () => {
    const { sink, log } = setup();
    sink.draw(img, 5, 6, { blend: -1 });
    expect(log).toEqual(['draw 5,6 a=1 op=source-over f=none']);
  });

  it('begin 은 화면을 검게 지운다', () => {
    const { sink, log } = setup();
    sink.begin(800, 600);
    expect(log).toEqual(['fill #000 0,0,800,600']);
  });
});
