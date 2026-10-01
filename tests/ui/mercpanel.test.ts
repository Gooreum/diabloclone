// 확장팩 용병 창 (NPCInv.dc6) 칸 판정과 고용 교체 확인 상자
import { describe, expect, it } from 'vitest';
import { ConfirmBox, MERC_PANEL, MercPanel } from '../../src/ui/mercpanel';
import type { UiArt } from '../../src/ui/art';
import type { ItemIcons } from '../../src/ui/invpanel';
import type { MercSnapshot } from '../../src/engine/game';
import type { ItemInstance } from '../../src/engine/treasure';

const art = { preload: async () => undefined } as unknown as UiArt;
const icons = {} as ItemIcons;

describe('용병 창 칸', () => {
  it('닫혀 있으면 아무것도 맞지 않고, 열리면 투구·갑옷·무기·방패 칸과 닫기', () => {
    const p = new MercPanel(art, icons);
    expect(p.hit(MERC_PANEL.x + 160, MERC_PANEL.y + 30)).toBeNull();
    p.open = true;
    for (const slot of ['head', 'tors', 'rarm', 'larm'] as const) {
      const c = p.slotCenter(slot);
      expect(p.hit(c.x, c.y)).toEqual({ kind: 'slot', slot });
    }
    expect(p.hit(MERC_PANEL.x + 288, MERC_PANEL.y + 400)).toEqual({ kind: 'close' });
    expect(p.hit(MERC_PANEL.x + 160, MERC_PANEL.y + 300)).toEqual({ kind: 'panel' });
    expect(p.hit(MERC_PANEL.x - 5, MERC_PANEL.y + 30)).toBeNull();
  });
  it('칸 위 아이템: 스냅샷 items 의 그 칸', () => {
    const p = new MercPanel(art, icons);
    p.open = true;
    const bow = { id: 9, code: 'sbw' } as ItemInstance;
    const m = { items: { rarm: bow } } as unknown as MercSnapshot;
    const c = p.slotCenter('rarm');
    expect(p.itemAt(m, c.x, c.y)).toBe(bow);
    const h = p.slotCenter('head');
    expect(p.itemAt(m, h.x, h.y)).toBeNull();
  });
});

describe('고용 교체 확인', () => {
  it('대기 중일 때만 클릭을 먹고, Hire 단추면 yes, 그 밖은 no', () => {
    const c = new ConfirmBox();
    expect(c.click(400, 300)).toBeNull();
    c.pending = 2;
    const y = c.center('yes'), n = c.center('no');
    expect(c.click(y.x, y.y)).toBe('yes');
    expect(c.click(n.x, n.y)).toBe('no');
    expect(c.click(5, 5)).toBe('no');
  });
});
