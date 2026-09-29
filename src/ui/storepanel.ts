// 상점(NPC 거래) 패널 (캔버스). 원작 DC6: data\global\ui\PANEL\buysell.dc6 (256+64 × 256+176, 4조각),
// buyselltabs.dc6 (페이지 탭 79×31 — 4 칸 × 2 상태), buysellbtn.dc6 (32×32 버튼: 2/3 사기, 4/5 팔기, 6/7 수리, 18/19 모두 수리, 0 빈 칸).
// 출처: inventory.txt "Monster2" 행 — 패널 (80,60)~(401,502), 격자 10×10 (96,123) 칸 29
// 출처: string.tbl strBSArmor / strBSWeapons / strBSMagic / strBSMisc (탭), cost "Cost: ", Sell "Sell value: ", Repair "Repair cost: "
// 근사(원작 미확인): 탭 프레임 짝(0~3 선택 / 4~7 비선택)·버튼 칸 위치(패널 기준 x 114/166/218/270, y 383)·골드 칸 글자, 글꼴 원작 font16
import { parseDc6, type Dc6 } from '../formats/dc6';
import type { Palette } from '../formats/palette';
import { indexedToCanvas, type Drawable } from '../render/sprites';
import type { AsyncAssets } from '../render/units';
import type { StoreItem } from '../engine/shop';
import type { ItemInstance } from '../engine/treasure';
import type { ItemIcons } from './invpanel';
import { drawTooltip } from './invpanel';
import type { TextLine } from './itemtext';
import { drawText } from './text';

export const STORE_PANEL = { x: 80, y: 60, w: 321, h: 442 } as const;
const GRID = { l: 96, t: 123, box: 29, cols: 10, rows: 10 } as const;
const TAB = { x: 2, y: 2, w: 79, h: 31 } as const;
const BTN = { xs: [114, 166, 218, 270], y: 383, size: 32 } as const;
const GOLD = { x: 14, y: 357, w: 188, h: 20 } as const;

export type StoreMode = 'buy' | 'sell' | 'repair';
export type StoreClick =
  | { kind: 'buy'; itemId: number }
  | { kind: 'tab'; page: number }
  | { kind: 'mode'; mode: StoreMode }
  | { kind: 'repairAll' }
  | { kind: 'drop' }
  | { kind: 'panel' }
  | null;

export class StorePanel {
  open = false;
  gamble = false;
  repair = false;
  page = 0;
  mode: StoreMode = 'buy';
  items: readonly StoreItem[] = [];
  private readonly frames = new Map<string, Drawable[] | null>();
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;
  private readonly icons: ItemIcons;

  constructor(assets: AsyncAssets, pal: Palette, icons: ItemIcons) {
    this.assets = assets;
    this.pal = pal;
    this.icons = icons;
    for (const f of ['buysell', 'buyselltabs', 'buysellbtn']) this.load(f);
  }

  private load(name: string): void {
    this.frames.set(name, null);
    void this.assets.load(`data\\global\\ui\\PANEL\\${name}.dc6`).then((b) => {
      if (!b) return;
      const d: Dc6 = parseDc6(b);
      this.frames.set(name, d.frames.map((f) => indexedToCanvas(f.pixels, f.width, f.height, this.pal)));
    });
  }

  get ready(): boolean {
    return ['buysell', 'buyselltabs', 'buysellbtn'].every((n) => !!this.frames.get(n));
  }

  /** 아이템이 있는 페이지 (도박은 0 하나) */
  pages(): number[] {
    if (this.gamble) return [0];
    const set = new Set(this.items.map((s) => s.page));
    return [0, 1, 2, 3].filter((p) => set.has(p));
  }

  /** 상점 열기: 첫 페이지는 아이템이 있는 첫 탭 */
  show(items: readonly StoreItem[], gamble: boolean, repair: boolean): void {
    const wasOpen = this.open && this.gamble === gamble;
    this.items = items;
    this.gamble = gamble;
    this.repair = repair;
    this.open = true;
    if (!wasOpen) {
      this.mode = 'buy';
      this.page = this.pages()[0] ?? 0;
    }
  }

  hide(): void {
    this.open = false;
  }

  private itemAtCell(cx: number, cy: number): StoreItem | undefined {
    return this.items.find((s) => s.page === this.page && cx >= s.x && cy >= s.y && cx < s.x + s.item.invW && cy < s.y + s.item.invH);
  }

  itemAt(x: number, y: number): ItemInstance | null {
    if (!this.open) return null;
    if (x < GRID.l || y < GRID.t || x >= GRID.l + GRID.cols * GRID.box || y >= GRID.t + GRID.rows * GRID.box) return null;
    return this.itemAtCell(Math.floor((x - GRID.l) / GRID.box), Math.floor((y - GRID.t) / GRID.box))?.item ?? null;
  }

  /** 아이템 칸 가운데 (e2e) */
  itemCenter(id: number): { x: number; y: number } | null {
    const s = this.items.find((i) => i.item.id === id);
    if (!s) return null;
    return { x: GRID.l + (s.x + s.item.invW / 2) * GRID.box, y: GRID.t + (s.y + s.item.invH / 2) * GRID.box };
  }

  tabCenter(page: number): { x: number; y: number } {
    return { x: STORE_PANEL.x + TAB.x + page * TAB.w + TAB.w / 2, y: STORE_PANEL.y + TAB.y + TAB.h / 2 };
  }

  buttonCenter(i: number): { x: number; y: number } {
    return { x: STORE_PANEL.x + (BTN.xs[i] ?? 0) + BTN.size / 2, y: STORE_PANEL.y + BTN.y + BTN.size / 2 };
  }

  /** 버튼 칸 → [기능, 프레임] (수리 NPC 만 수리·모두 수리) */
  private buttons(): ([StoreMode | 'repairAll' | null, number])[] {
    return [
      ['buy', 2], ['sell', 4],
      this.repair && !this.gamble ? ['repair', 6] : [null, 0],
      this.repair && !this.gamble ? ['repairAll', 18] : [null, 0],
    ];
  }

  click(x: number, y: number, holding: boolean): StoreClick {
    if (!this.open) return null;
    const P = STORE_PANEL;
    if (x < P.x || y < P.y || x >= P.x + P.w || y >= P.y + P.h) return null;
    const lx = x - P.x, ly = y - P.y;
    if (ly >= TAB.y && ly < TAB.y + TAB.h) {
      const i = Math.floor((lx - TAB.x) / TAB.w);
      if (this.pages().includes(i)) return { kind: 'tab', page: i };
      return { kind: 'panel' };
    }
    for (let i = 0; i < 4; i++) {
      const bx = BTN.xs[i] ?? 0;
      if (lx >= bx && lx < bx + BTN.size && ly >= BTN.y && ly < BTN.y + BTN.size) {
        const [fn] = this.buttons()[i] ?? [null, 0];
        if (fn === 'repairAll') return { kind: 'repairAll' };
        if (fn) return { kind: 'mode', mode: fn };
        return { kind: 'panel' };
      }
    }
    if (x >= GRID.l && y >= GRID.t && x < GRID.l + GRID.cols * GRID.box && y < GRID.t + GRID.rows * GRID.box) {
      // 원작: 아이템을 들고 상점에 놓으면 판다
      if (holding) return { kind: 'drop' };
      const it = this.itemAt(x, y);
      if (it) return { kind: 'buy', itemId: it.id };
    }
    return { kind: 'panel' };
  }

  draw(ctx: CanvasRenderingContext2D, gold: number, str: (k: string) => string, mouse: { x: number; y: number } | null, tooltip: (it: ItemInstance) => TextLine[], price: (it: ItemInstance) => number): void {
    if (!this.open) return;
    const P = STORE_PANEL;
    const bg = this.frames.get('buysell');
    if (bg) {
      const pos = [[0, 0], [256, 0], [0, 256], [256, 256]];
      bg.forEach((c, i) => ctx.drawImage(c as CanvasImageSource, P.x + (pos[i]?.[0] ?? 0), P.y + (pos[i]?.[1] ?? 0)));
    } else {
      ctx.fillStyle = 'rgba(12,10,8,0.94)';
      ctx.fillRect(P.x, P.y, P.w, P.h);
    }
    // 탭
    const tabs = this.frames.get('buyselltabs');
    const labels = this.gamble ? [str('gamble')] : [str('strBSArmor'), str('strBSWeapons'), str('strBSMagic'), str('strBSMisc')];
    ctx.save();
    for (const pg of this.pages()) {
      const f = tabs?.[pg === this.page ? pg : pg + 4];
      const tx = P.x + TAB.x + pg * TAB.w, ty = P.y + TAB.y;
      if (f) ctx.drawImage(f as CanvasImageSource, tx, ty);
      drawText(ctx, labels[pg] ?? '', tx + TAB.w / 2, ty + TAB.h / 2 - 7, { align: 'center', color: pg === this.page ? 'white' : 'grey' });
    }
    // 아이템
    for (const s of this.items) {
      if (s.page !== this.page) continue;
      const img = this.icons.get(s.item);
      const cx = GRID.l + (s.x + s.item.invW / 2) * GRID.box, cy = GRID.t + (s.y + s.item.invH / 2) * GRID.box;
      if (img) ctx.drawImage(img as CanvasImageSource, Math.round(cx - img.width / 2), Math.round(cy - img.height / 2));
    }
    // 버튼 (선택된 모드는 눌린 프레임)
    const btn = this.frames.get('buysellbtn');
    this.buttons().forEach(([fn, frame], i) => {
      const pressed = fn !== null && fn === this.mode;
      const f = btn?.[frame + (pressed ? 1 : 0)];
      if (f) ctx.drawImage(f as CanvasImageSource, P.x + (BTN.xs[i] ?? 0), P.y + BTN.y);
    });
    // 골드
    drawText(ctx, `${str('strGoldLabel')}: ${gold}`, P.x + GOLD.x + 6, P.y + GOLD.y + GOLD.h / 2 - 7, { color: 'gold' });
    ctx.restore();
    // 툴팁 + 가격 (원작 "Cost: N")
    if (mouse) {
      const it = this.itemAt(mouse.x, mouse.y);
      if (it) drawTooltip(ctx, [...tooltip(it), { text: `${str('cost')}${price(it)}`, color: '#ffffff' }], mouse.x, mouse.y);
    }
  }
}
