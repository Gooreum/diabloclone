// 보관함 (마을 보관함 오브젝트 bank, objects.txt OperateFn 32): 원작 data\global\ui\PANEL\bank.dc6 (320×432, 왼쪽 패널 자리 80,60),
// 6×4 격자 = inventory.txt "Bank Page2" 행 (gridLeft 154, gridTop 333, 칸 29), 금화 단추 goldcoinbtn.dc6.
// 출처(그림 측정): 금화 단추 칸 (75,220,20,18) · 금액 칸 (97,220,152,18) · 아래 칸 (75,246,173,18) · 닫기 칸 (275,385,32,32)
// 출처(문자열): string.tbl strGoldInStash "Gold in Stash:", GoldMax "Gold Max: %d"
// 근사(원작 미확인): 보관함 금화 한도 = (레벨 ÷ 10 + 1) × 50000 (원작 클래식 규칙으로 알려진 값), 금화 넣기/빼기 창은 아직 없음
import type { ItemStore } from '../engine/itemstore';
import type { ItemInstance } from '../engine/treasure';
import { UI, type UiArt } from './art';
import { drawTooltip, type ItemIcons } from './invpanel';
import type { TextLine } from './itemtext';
import { drawText } from './text';

const BANK = `${UI}PANEL\\bank.dc6`;
const GOLDBTN = `${UI}PANEL\\goldcoinbtn.dc6`;
const CLOSEBTN = `${UI}PANEL\\buysellbtn.dc6`;
export const STASH_PANEL = { x: 80, y: 60, w: 320, h: 432 } as const;
export const STASH_GRID = { l: 154, t: 333, box: 29, cols: 6, rows: 4 } as const;
const CLOSE = { x: 275, y: 385, w: 32, h: 32 } as const;

export type StashHit = { kind: 'cell'; x: number; y: number } | { kind: 'close' } | { kind: 'panel' } | null;

export class StashPanel {
  open = false;
  private readonly art: UiArt;
  private readonly icons: ItemIcons;

  constructor(art: UiArt, icons: ItemIcons) {
    this.art = art;
    this.icons = icons;
    void art.preload([BANK, GOLDBTN, CLOSEBTN]);
  }

  hit(x: number, y: number): StashHit {
    if (!this.open) return null;
    const P = STASH_PANEL, G = STASH_GRID;
    if (x < P.x || y < P.y || x >= P.x + P.w || y >= P.y + P.h) return null;
    if (x >= P.x + CLOSE.x && y >= P.y + CLOSE.y && x < P.x + CLOSE.x + CLOSE.w && y < P.y + CLOSE.y + CLOSE.h) return { kind: 'close' };
    if (x >= G.l && y >= G.t && x < G.l + G.cols * G.box && y < G.t + G.rows * G.box) return { kind: 'cell', x: Math.floor((x - G.l) / G.box), y: Math.floor((y - G.t) / G.box) };
    return { kind: 'panel' };
  }

  /** 커서 아이템을 놓을 왼쪽 위 칸 (아이템 가운데 = 커서) */
  placeAt(item: ItemInstance, mx: number, my: number): { x: number; y: number } {
    const G = STASH_GRID;
    const x = Math.round((mx - G.l) / G.box - item.invW / 2), y = Math.round((my - G.t) / G.box - item.invH / 2);
    return { x: Math.max(0, Math.min(G.cols - item.invW, x)), y: Math.max(0, Math.min(G.rows - item.invH, y)) };
  }

  itemAt(store: ItemStore, x: number, y: number): ItemInstance | null {
    const h = this.hit(x, y);
    return h?.kind === 'cell' ? (store.stash.at(h.x, h.y)?.item ?? null) : null;
  }

  /** e2e: 칸 가운데 */
  cellCenter(cx: number, cy: number): { x: number; y: number } {
    return { x: STASH_GRID.l + cx * STASH_GRID.box + 14, y: STASH_GRID.t + cy * STASH_GRID.box + 14 };
  }

  draw(ctx: CanvasRenderingContext2D, store: ItemStore, stashGold: number, level: number, str: (k: string) => string, mouse: { x: number; y: number } | null, tooltip: (it: ItemInstance) => TextLine[]): void {
    if (!this.open) return;
    const P = STASH_PANEL, G = STASH_GRID;
    if (!this.art.drawPanel(ctx, BANK, P.x, P.y, 0)) {
      ctx.fillStyle = 'rgba(12,10,8,0.94)';
      ctx.fillRect(P.x, P.y, P.w, P.h);
    }
    for (const p of store.stash.items) {
      ctx.fillStyle = 'rgba(20,40,120,0.3)';
      ctx.fillRect(G.l + p.x * G.box, G.t + p.y * G.box, p.item.invW * G.box - 1, p.item.invH * G.box - 1);
      const img = this.icons.get(p.item);
      if (img) ctx.drawImage(img as CanvasImageSource, Math.round(G.l + (p.x + p.item.invW / 2) * G.box - img.width / 2), Math.round(G.t + (p.y + p.item.invH / 2) * G.box - img.height / 2));
    }
    this.art.draw(ctx, GOLDBTN, 0, P.x + 75, P.y + 220);
    drawText(ctx, `${str('strGoldInStash')} ${stashGold}`, P.x + 97 + 76, P.y + 221, { align: 'center' });
    drawText(ctx, str('GoldMax').replace('%d', String((Math.floor(level / 10) + 1) * 50000)), P.x + 75 + 86, P.y + 247, { align: 'center' });
    this.art.draw(ctx, CLOSEBTN, 10, P.x + CLOSE.x, P.y + CLOSE.y);
    if (mouse && !store.cursor) {
      const it = this.itemAt(store, mouse.x, mouse.y);
      if (it) drawTooltip(ctx, tooltip(it), mouse.x, mouse.y);
    }
  }
}
