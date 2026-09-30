import { describe, expect, it } from 'vitest';
import { LoadingScreen } from '../../src/ui/loading';
import type { UiArt } from '../../src/ui/art';
import { gfxBusy, UnitGfx } from '../../src/render/units';

const art = { load: async () => undefined, frames: () => null, draw: () => undefined } as unknown as UiArt;

describe('로딩 화면 유지', () => {
  it('준비 중이면 350ms 가 지나도 계속 보이고, 준비되면 닫힌다', () => {
    const ls = new LoadingScreen(art);
    let busy = true;
    ls.flash(1000, 350, () => busy);
    expect(ls.active(1200)).toBe(true);
    expect(ls.active(2000)).toBe(true);
    busy = false;
    expect(ls.active(2100)).toBe(false);
  });

  it('준비가 끝나지 않아도 최대 4초 뒤에는 닫힌다', () => {
    const ls = new LoadingScreen(art);
    ls.flash(0, 350, () => true);
    expect(ls.active(3999)).toBe(true);
    expect(ls.active(4000)).toBe(false);
  });

  it('유지 조건 없이 flash 하면 350ms 만 보인다', () => {
    const ls = new LoadingScreen(art);
    ls.flash(0);
    expect(ls.active(349)).toBe(true);
    expect(ls.active(350)).toBe(false);
  });
});

describe('유닛 그림 불러오는 중 표시', () => {
  it('불러오는 동안 gfxBusy=true, 끝나면 false', async () => {
    let release: (b: Uint8Array | null) => void = () => undefined;
    const gfx = new UnitGfx({ load: () => new Promise((r) => (release = r)) });
    expect(gfxBusy()).toBe(false);
    gfx.get({ root: 'MONSTERS', token: 'ZM', mode: 'NU', wclass: 'HTH', equip: {} });
    expect(gfxBusy()).toBe(true);
    release(null);
    await new Promise((r) => setTimeout(r, 5));
    expect(gfxBusy()).toBe(false);
  });
});
