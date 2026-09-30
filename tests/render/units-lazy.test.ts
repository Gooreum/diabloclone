import { describe, expect, it } from 'vitest';
import type { DccHandle } from '../../src/assets/gfx-client';
import type { DccDirection } from '../../src/formats/dcc';
import { UnitGfx, type AsyncAssets, type CompositeSpec } from '../../src/render/units';
import type { IndexedImage, SpriteSink } from '../../src/render/sink';

// COF: 방향 4, 프레임 1, 레이어 1 (TR). 출처: Phrozen Keep COF 문서 — 헤더 28바이트, 레이어 9바이트, 프레임 이벤트, 우선순위 dirs×frames×layers
function cofBytes(): Uint8Array {
  const b = [1, 1, 4, ...new Array<number>(25).fill(0)];
  b.push(1, 0, 1, 0, 0, 104, 116, 104, 0); // 레이어 type 1(TR), shadow, selectable, transparent 0, effect 0, 무기 'hth'
  b.push(0); // 프레임 이벤트
  b.push(1, 1, 1, 1); // 우선순위 (방향 4 × 프레임 1)
  return new Uint8Array(b);
}

const dirOf = (v: number): DccDirection => ({ box: { left: 0, top: 0, width: 1, height: 1 }, frames: [{ box: { left: 0, top: 0, width: 1, height: 1 }, pixels: new Uint8Array([v]) }] });

function setup() {
  const requested: number[] = [];
  const resolvers: (() => void)[] = [];
  const handle: DccHandle = {
    directions: 4, framesPerDirection: 1,
    dir: (d) => (requested.push(d), new Promise((res) => resolvers.push(() => res(dirOf(d + 1))))),
  };
  const assets: AsyncAssets = { load: async () => cofBytes(), loadDcc: async () => handle };
  const drawn: IndexedImage[] = [];
  const sink: SpriteSink = { begin() {}, end() {}, setPalette() {}, draw: (img) => void drawn.push(img) };
  return { gfx: new UnitGfx(assets), requested, resolvers, drawn, sink };
}

const spec: CompositeSpec = { root: 'MONSTERS', token: 'ZM', mode: 'NU', wclass: 'HTH', equip: { TR: 'lit' } };
const flush = () => new Promise((r) => setTimeout(r, 5));

describe('UnitGfx 방향 지연 해석', () => {
  it('처음 그릴 방향만 해석을 요청하고, 끝나면 그 방향을 그린다', async () => {
    const { gfx, requested, resolvers, drawn, sink } = setup();
    expect(gfx.getFor('m1', spec, 0)).toBeNull();
    await flush();
    const c = gfx.get(spec)!;
    expect(c).toBeTruthy();
    expect(gfx.ready(c, 0)).toBe(false);
    expect(requested).toEqual([0]);
    resolvers.shift()!();
    await flush();
    const shown = gfx.getFor('m1', spec, 0)!;
    expect(shown.dir).toBe(0);
    gfx.draw(sink, shown.comp, shown.dir, 0, 10, 10);
    expect(drawn.map((d) => d.pixels[0])).toEqual([1]);
  });

  it('새 방향이 해석 중이면 직전 그림·방향을 대신 쓴다 (빈 프레임 없음)', async () => {
    const { gfx, resolvers } = setup();
    gfx.getFor('m1', spec, 0);
    await flush();
    gfx.get(spec);
    gfx.ready(gfx.get(spec)!, 0);
    resolvers.shift()!();
    await flush();
    expect(gfx.getFor('m1', spec, 0)!.dir).toBe(0);
    // 64방향 16 = 파일 방향 1 (4방향 DCC) — 아직 해석 전
    const fallback = gfx.getFor('m1', spec, 16)!;
    expect(fallback.dir).toBe(0);
  });

  it('DCC 방향 수 밖이면 요청 없이 없음으로 처리', async () => {
    const { gfx, requested } = setup();
    gfx.get(spec);
    await flush();
    const c = gfx.get(spec)!;
    // COF 는 4방향인데 레이어 DCC 가 1방향뿐인 경우: 범위 밖 방향은 요청하지 않고 없음으로 둔다
    const lg = [...c.layers.values()][0]!;
    (lg.h as { directions: number }).directions = 1;
    expect(gfx.ready(c, 16)).toBe(true);
    expect(requested).not.toContain(1);
  });
});
