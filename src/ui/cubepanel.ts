// 호라드릭 큐브 창: 원작 data\global\ui\PANEL\supertransmogrifier.dc6 (256+64 × 256+176, 4조각 — 왼쪽 패널 자리 80,60),
// 3×4 격자 = inventory.txt "Transmogrify Box2" 행 (gridLeft 198, gridTop 199, 칸 29), 단추 buysellbtn.dc6.
// 출처(그림 측정): 트랜스뮤트 단추 칸 (145,260,32,32) · 닫기 칸 (275,385,32,32) — 패널 기준
// 출처(문자열): string.tbl strUiMenu2 "Transmute" (단추 설명)
// 근사(원작 미확인): 트랜스뮤트 단추 그림 = buysellbtn.dc6 8(보통)/9(누름) 프레임, 닫기 = 10
import type { ItemStore } from '../engine/itemstore';
import type { ItemInstance } from '../engine/treasure';
import { UI, type UiArt } from './art';
import { drawTooltip, type ItemIcons } from './invpanel';
import type { TextLine } from './itemtext';
import { drawText } from './text';

const CUBE = `${UI}PANEL\\supertransmogrifier.dc6`;
const BTN = `${UI}PANEL\\buysellbtn.dc6`;
export const CUBE_PANEL = { x: 80, y: 60, w: 320, h: 432 } as const;
export const CUBE_GRID = { l: 198, t: 199, box: 29, cols: 3, rows: 4 } as const;
const TRANSMUTE = { x: 145, y: 260, w: 32, h: 32 } as const;
const CLOSE = { x: 275, y: 385, w: 32, h: 32 } as const;

export type CubeHit = { kind: 'cell'; x: number; y: number } | { kind: 'transmute' } | { kind: 'close' } | { kind: 'panel' } | null;

export class CubePanel {
  open = false;
  /** 트랜스뮤트 단추를 누른 모양 (눌린 뒤 잠깐) */
  private pressedUntil = 0;
  private readonly art: UiArt;
  private readonly icons: ItemIcons;

  constructor(art: UiArt, icons: ItemIcons) {
    this.art = art;
    this.icons = icons;
    void art.preload([CUBE, BTN]);
  }

  get ready(): boolean {
    return this.art.ready([CUBE, BTN]);
  }

  hit(x: number, y: number): CubeHit {
    if (!this.open) return null;
    const P = CUBE_PANEL, G = CUBE_GRID;
    if (x < P.x || y < P.y || x >= P.x + P.w || y >= P.y + P.h) return null;
    const inBox = (b: { x: number; y: number; w: number; h: number }) => x >= P.x + b.x && y >= P.y + b.y && x < P.x + b.x + b.w && y < P.y + b.y + b.h;
    if (inBox(CLOSE)) return { kind: 'close' };
    if (inBox(TRANSMUTE)) return { kind: 'transmute' };
    if (x >= G.l && y >= G.t && x < G.l + G.cols * G.box && y < G.t + G.rows * G.box) return { kind: 'cell', x: Math.floor((x - G.l) / G.box), y: Math.floor((y - G.t) / G.box) };
    return { kind: 'panel' };
  }

  /** 커서 아이템을 놓을 왼쪽 위 칸 (아이템 가운데 = 커서) */
  placeAt(item: ItemInstance, mx: number, my: number): { x: number; y: number } {
    const G = CUBE_GRID;
    const x = Math.round((mx - G.l) / G.box - item.invW / 2), y = Math.round((my - G.t) / G.box - item.invH / 2);
    return { x: Math.max(0, Math.min(G.cols - item.invW, x)), y: Math.max(0, Math.min(G.rows - item.invH, y)) };
  }

  itemAt(store: ItemStore, x: number, y: number): ItemInstance | null {
    const h = this.hit(x, y);
    return h?.kind === 'cell' ? (store.cube.at(h.x, h.y)?.item ?? null) : null;
  }

  press(now: number): void {
    this.pressedUntil = now + 150;
  }

  /** e2e: 칸·단추 가운데 */
  cellCenter(cx: number, cy: number): { x: number; y: number } {
    return { x: CUBE_GRID.l + cx * CUBE_GRID.box + 14, y: CUBE_GRID.t + cy * CUBE_GRID.box + 14 };
  }
  transmuteCenter(): { x: number; y: number } {
    return { x: CUBE_PANEL.x + TRANSMUTE.x + 16, y: CUBE_PANEL.y + TRANSMUTE.y + 16 };
  }
  closeCenter(): { x: number; y: number } {
    return { x: CUBE_PANEL.x + CLOSE.x + 16, y: CUBE_PANEL.y + CLOSE.y + 16 };
  }

  draw(ctx: CanvasRenderingContext2D, store: ItemStore, str: (k: string) => string, mouse: { x: number; y: number } | null, tooltip: (it: ItemInstance) => TextLine[], now: number): void {
    if (!this.open) return;
    const P = CUBE_PANEL, G = CUBE_GRID;
    if (!this.art.drawPanel(ctx, CUBE, P.x, P.y, 0)) {
      ctx.fillStyle = 'rgba(12,10,8,0.94)';
      ctx.fillRect(P.x, P.y, P.w, P.h);
    }
    for (const p of store.cube.items) {
      ctx.fillStyle = 'rgba(20,40,120,0.3)';
      ctx.fillRect(G.l + p.x * G.box, G.t + p.y * G.box, p.item.invW * G.box - 1, p.item.invH * G.box - 1);
      const img = this.icons.get(p.item);
      if (img) ctx.drawImage(img as CanvasImageSource, Math.round(G.l + (p.x + p.item.invW / 2) * G.box - img.width / 2), Math.round(G.t + (p.y + p.item.invH / 2) * G.box - img.height / 2));
    }
    this.art.draw(ctx, BTN, now < this.pressedUntil ? 9 : 8, P.x + TRANSMUTE.x, P.y + TRANSMUTE.y);
    this.art.draw(ctx, BTN, 10, P.x + CLOSE.x, P.y + CLOSE.y);
    const h = mouse ? this.hit(mouse.x, mouse.y) : null;
    if (mouse && h?.kind === 'transmute') drawText(ctx, str('strUiMenu2'), P.x + TRANSMUTE.x + 16, P.y + TRANSMUTE.y - 18, { align: 'center', color: 'white' });
    if (mouse && !store.cursor) {
      const it = this.itemAt(store, mouse.x, mouse.y);
      if (it) drawTooltip(ctx, tooltip(it), mouse.x, mouse.y);
    }
  }
}
