// 확장팩 용병 창 (Hireling Screen, 원작 기본 키 O · 초상화 오른쪽 클릭): 원작 data\global\ui\PANEL\NPCInv.dc6 (4 프레임 320×432, 왼쪽 패널 자리 80,60).
// 출처(그림 측정): NPCInv 프레임 0~3 을 이어 그린 픽셀 — 패널 기준 투구 칸 (131,2)-(191,62), 무기 칸 (16,45)-(76,161),
//   방패 칸 (247,45)-(307,162), 갑옷 칸 (131,73)-(191,162), 글자 칸: 1 줄 (5,199)-(157,217)·(162,199)-(315,217),
//   2 줄 (7,223)-(129,258)·(135,222)-(185,258)·(193,223)-(313,258), 능력치 4 줄 y 266·290·314·338 (높이 17, 이름 x 7~105·164~262, 값 ~157·~315),
//   닫기 칸 (272,385)-(304,417) — buysellbtn.dc6 프레임 10
// 출처(문자열): string.tbl strchrlvl·strchrexp·strchrnxtlvl·strchrstr·strchrdex·strchrdef·ItemStats1g·strchrfir·strchrcld·strchrlit·strchrpos,
//   확장팩 hireiconinfo1 "Drop Potion on Portrait to Heal" · hireiconinfo2 "Right-click to Open Inventory (%s)",
//   VerifyTransaction9 "This Mercenary will replace your current one." · VerifyTransaction6 "Hire" · CfgCancel "Cancel"
// 근사(원작 미확인 — D2Client 는 D2MOO 에 없다): 글자 칸에 넣는 항목·순서, 고용 교체 확인 상자 모양
import type { MercSnapshot } from '../engine/game';
import type { MercSlot } from '../engine/mercequip';
import type { ItemInstance } from '../engine/treasure';
import { UI, type UiArt } from './art';
import { drawTooltip, type ItemIcons, type Rect } from './invpanel';
import type { TextLine } from './itemtext';
import { HIRE_DESC_STRING } from './npcpanel';
import { drawText } from './text';

const NPCINV = `${UI}PANEL\\NPCInv.dc6`;
const CLOSEBTN = `${UI}PANEL\\buysellbtn.dc6`;
export const MERC_PANEL = { x: 80, y: 60, w: 320, h: 432 } as const;
const SLOTS: Record<MercSlot, Rect> = {
  head: { l: 131, t: 2, r: 191, b: 62 }, rarm: { l: 16, t: 45, r: 76, b: 161 }, larm: { l: 247, t: 45, r: 307, b: 162 }, tors: { l: 131, t: 73, r: 191, b: 162 },
};
const CLOSE = { x: 272, y: 385, w: 32, h: 32 } as const;
const ROWS = [266, 290, 314, 338] as const;

export type MercHit = { kind: 'slot'; slot: MercSlot } | { kind: 'close' } | { kind: 'panel' } | null;

export class MercPanel {
  open = false;
  private readonly art: UiArt;
  private readonly icons: ItemIcons;

  constructor(art: UiArt, icons: ItemIcons) {
    this.art = art;
    this.icons = icons;
    void art.preload([NPCINV, CLOSEBTN]);
  }

  hit(x: number, y: number): MercHit {
    if (!this.open) return null;
    const P = MERC_PANEL;
    if (x < P.x || y < P.y || x >= P.x + P.w || y >= P.y + P.h) return null;
    const lx = x - P.x, ly = y - P.y;
    if (lx >= CLOSE.x && ly >= CLOSE.y && lx < CLOSE.x + CLOSE.w && ly < CLOSE.y + CLOSE.h) return { kind: 'close' };
    for (const [slot, r] of Object.entries(SLOTS)) if (lx >= r.l && ly >= r.t && lx < r.r && ly < r.b) return { kind: 'slot', slot: slot as MercSlot };
    return { kind: 'panel' };
  }

  /** e2e: 칸 가운데 (화면 좌표) */
  slotCenter(slot: MercSlot): { x: number; y: number } {
    const r = SLOTS[slot];
    return { x: MERC_PANEL.x + (r.l + r.r) / 2, y: MERC_PANEL.y + (r.t + r.b) / 2 };
  }

  itemAt(m: MercSnapshot | null, x: number, y: number): ItemInstance | null {
    const h = this.hit(x, y);
    return h?.kind === 'slot' ? (m?.items?.[h.slot] ?? null) : null;
  }

  draw(ctx: CanvasRenderingContext2D, m: MercSnapshot | null, str: (k: string) => string, mouse: { x: number; y: number } | null, cursorBusy: boolean,
    tooltip: (it: ItemInstance) => TextLine[]): void {
    if (!this.open || !m) return;
    const P = MERC_PANEL;
    if (!this.art.drawPanel(ctx, NPCINV, P.x, P.y, 0)) {
      ctx.fillStyle = 'rgba(12,10,8,0.94)';
      ctx.fillRect(P.x, P.y, P.w, P.h);
    }
    for (const [slot, r] of Object.entries(SLOTS)) {
      const it = m.items?.[slot as MercSlot];
      if (!it) continue;
      ctx.fillStyle = 'rgba(20,40,120,0.3)';
      ctx.fillRect(P.x + r.l, P.y + r.t, r.r - r.l, r.b - r.t);
      const img = this.icons.get(it);
      if (img) ctx.drawImage(img as CanvasImageSource, Math.round(P.x + (r.l + r.r) / 2 - img.width / 2), Math.round(P.y + (r.t + r.b) / 2 - img.height / 2));
    }
    const s = m.stats;
    const one = (k: string) => str(k).replace(/\n/g, ' ');
    const text = (t: string, x: number, y: number, opts: Parameters<typeof drawText>[4] = {}) => drawText(ctx, t, P.x + x, P.y + y, opts);
    text(str(m.name), 81, 200, { align: 'center', color: 'gold' });
    if (s) text(str(HIRE_DESC_STRING[s.hireDesc] ?? `strhirespecial${s.hireDesc}`), 238, 200, { align: 'center' });
    text(one('strchrexp'), 68, 225, { align: 'center', font: 'font8' });
    text(String(Math.floor(m.experience)), 68, 240, { align: 'center' });
    text(one('strchrlvl'), 160, 225, { align: 'center', font: 'font8' });
    text(String(m.level), 160, 240, { align: 'center' });
    text(one('strchrnxtlvl'), 253, 225, { align: 'center', font: 'font8' });
    text(String(m.nextExp), 253, 240, { align: 'center' });
    if (!s) return;
    const left: [string, string][] = [
      [one('strchrstr'), String(s.str)], [one('strchrdex'), String(s.dex)],
      [one('ItemStats1g').replace(/:\s*$/, ''), `${s.min}-${s.max}`], [one('strchrdef'), String(s.defense)],
    ];
    const right: [string, string][] = [
      [one('strchrfir'), `${s.resist.fi}%`], [one('strchrcld'), `${s.resist.co}%`], [one('strchrlit'), `${s.resist.li}%`], [one('strchrpos'), `${s.resist.po}%`],
    ];
    ROWS.forEach((y, i) => {
      const l = left[i], r = right[i];
      if (l) {
        text(l[0], 56, y + 4, { align: 'center', font: 'font8' });
        text(l[1], 131, y + 1, { align: 'center' });
      }
      if (r) {
        text(r[0], 213, y + 4, { align: 'center', font: 'font8' });
        text(r[1], 289, y + 1, { align: 'center' });
      }
    });
    this.art.draw(ctx, CLOSEBTN, 10, P.x + CLOSE.x, P.y + CLOSE.y);
    if (mouse && !cursorBusy) {
      const it = this.itemAt(m, mouse.x, mouse.y);
      if (it) drawTooltip(ctx, tooltip(it), mouse.x, mouse.y);
    }
  }
}

/**
 * 고용 교체 확인 (원작 VerifyTransaction9). 근사(원작 미확인): 상자 모양·단추 배치 — 가운데 검은 상자, 왼쪽 Hire · 오른쪽 Cancel
 */
export class ConfirmBox {
  pending: number | null = null;
  private readonly box = { x: 250, y: 230, w: 300, h: 90 } as const;

  private buttons(): { yes: Rect; no: Rect } {
    const B = this.box;
    return { yes: { l: B.x + 30, t: B.y + 52, r: B.x + 130, b: B.y + 76 }, no: { l: B.x + 170, t: B.y + 52, r: B.x + 270, b: B.y + 76 } };
  }

  /** e2e: 단추 가운데 */
  center(which: 'yes' | 'no'): { x: number; y: number } {
    const r = this.buttons()[which];
    return { x: (r.l + r.r) / 2, y: (r.t + r.b) / 2 };
  }

  /** 열려 있으면 클릭을 먹는다: Hire 단추 'yes', 그 밖(Cancel·바깥) 'no' */
  click(x: number, y: number): 'yes' | 'no' | null {
    if (this.pending === null) return null;
    const { yes } = this.buttons();
    return x >= yes.l && x < yes.r && y >= yes.t && y < yes.b ? 'yes' : 'no';
  }

  draw(ctx: CanvasRenderingContext2D, str: (k: string) => string): void {
    if (this.pending === null) return;
    const B = this.box, { yes, no } = this.buttons();
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(B.x, B.y, B.w, B.h);
    ctx.strokeStyle = '#7a6a48';
    ctx.strokeRect(B.x + 0.5, B.y + 0.5, B.w - 1, B.h - 1);
    for (const r of [yes, no]) ctx.strokeRect(r.l + 0.5, r.t + 0.5, r.r - r.l - 1, r.b - r.t - 1);
    ctx.restore();
    drawText(ctx, str('VerifyTransaction9'), B.x + B.w / 2, B.y + 16, { align: 'center' });
    drawText(ctx, str('VerifyTransaction6'), (yes.l + yes.r) / 2, yes.t + 4, { align: 'center' });
    drawText(ctx, str('CfgCancel'), (no.l + no.r) / 2, no.t + 4, { align: 'center' });
  }
}
