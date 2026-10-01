// 인벤토리 패널 (캔버스): 원작 data\\global\\ui\\PANEL\\invchar.dc6 프레임 4~7 (320×432, 오른쪽 패널 자리 400,60),
// 칸 좌표는 원작 inventory.txt 800×600 좌표(<클래스>2 행: 장착 칸·10×4 격자 419,315 칸 29), 아이템은 원작 DC6 인벤토리 그림.
// 출처(그림 측정): 금화 단추 goldcoinbtn.dc6 (20×18) 칸 (84,392), 금액 칸 (106,392,91,18), 닫기 칸 (18,385,32,32) — buysellbtn.dc6 프레임 10
// 출처(문자열): string.tbl GoldMax "Gold Max: %d"
// 근사(원작 미확인): 아이템 뒤 반투명 파랑(쓸 수 없으면 빨강) 바탕 색·투명도
// 조작(원작): 왼쪽 클릭 = 집기/놓기(겹치면 교환), 오른쪽 클릭 = 사용(물약), 커서에 든 채 바깥(월드) 클릭 = 땅에 떨어뜨리기
import type { TxtRow } from '../formats/txt';
import type { Palette } from '../formats/palette';
import { parseDc6 } from '../formats/dc6';
import { indexedToCanvas, type Drawable } from '../render/sprites';
import type { AsyncAssets } from '../render/units';
import type { ItemDb } from '../engine/items';
import type { ItemStore } from '../engine/itemstore';
import type { BodyLoc } from '../engine/inventory';
import { QUALITY, type ItemInstance } from '../engine/treasure';
import type { ItemText, TextLine } from './itemtext';
import { UI, type UiArt } from './art';
import { d2text, drawText } from './text';

const INVCHAR = `${UI}PANEL\\invchar.dc6`;
/** 확장팩 캐릭터 인벤토리 (d2exp — 무기 칸 위 I/II 탭이 있는 판). 프레임 구성은 invchar 와 같다 (256/64 × 256/176) */
const INVCHAR6 = `${UI}PANEL\\invchar6.dc6`;
const GOLDBTN = `${UI}PANEL\\goldcoinbtn.dc6`;
const CLOSEBTN = `${UI}PANEL\\buysellbtn.dc6`;
const GOLD = { btnX: 84, btnY: 392, x: 106, y: 392, w: 91, h: 18 } as const;
const CLOSE = { x: 18, y: 385, w: 32, h: 32 } as const;

export interface Rect { l: number; t: number; r: number; b: number }
export interface InvLayout {
  panel: Rect;
  grid: { l: number; t: number; cols: number; rows: number; box: number };
  slots: Record<BodyLoc, Rect>;
}

const n = (v: string | undefined) => Number(v ?? 0) || 0;

/** inventory.txt "<Class>2" 행 → 좌표. 출처: 원작 inventory.txt (800×600 레이아웃) */
export function parseInvLayout(rows: TxtRow[], cls: string): InvLayout {
  const r = rows.find((x) => x.class === `${cls}2`) ?? rows.find((x) => x.class === cls);
  if (!r) throw new Error(`inventory.txt: no row for ${cls}`);
  const rect = (p: string): Rect => ({ l: n(r[`${p}Left`]), t: n(r[`${p}Top`]), r: n(r[`${p}Right`]), b: n(r[`${p}Bottom`]) });
  return {
    panel: { l: n(r.invLeft), t: n(r.invTop), r: n(r.invRight), b: n(r.invBottom) },
    grid: { l: n(r.gridLeft), t: n(r.gridTop), cols: n(r.gridX), rows: n(r.gridY), box: n(r.gridBoxWidth) || 29 },
    slots: {
      rarm: rect('rArm'), tors: rect('torso'), larm: rect('lArm'), head: rect('head'), neck: rect('neck'),
      rrin: rect('rHand'), lrin: rect('lHand'), belt: rect('belt'), feet: rect('feet'), glov: rect('gloves'),
    },
  };
}

/** 인벤토리 아이템 그림 (invfile DC6 첫 프레임, 유니크·세트는 전용 그림) */
export class ItemIcons {
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;
  private readonly items: ItemDb;
  private readonly cache = new Map<string, Drawable | null | 'loading'>();

  constructor(assets: AsyncAssets, pal: Palette, items: ItemDb) {
    this.assets = assets;
    this.pal = pal;
    this.items = items;
  }

  get db(): ItemDb {
    return this.items;
  }

  fileOf(item: ItemInstance): string {
    const b = this.items.base(item.code);
    if (!b) return '';
    if (item.quality === QUALITY.UNIQUE && b.uniqueInvFile) return b.uniqueInvFile;
    if (item.quality === QUALITY.SET && b.setInvFile) return b.setInvFile;
    return b.invFile;
  }

  get(item: ItemInstance): Drawable | null {
    const f = this.fileOf(item);
    if (!f) return null;
    const hit = this.cache.get(f);
    if (hit === undefined) {
      this.cache.set(f, 'loading');
      this.assets
        .load(`data\\global\\items\\${f}.dc6`)
        .then((b) => {
          const fr = b ? parseDc6(b).frames[0] : undefined;
          this.cache.set(f, fr ? indexedToCanvas(fr.pixels, fr.width, fr.height, this.pal) : null);
        })
        .catch(() => this.cache.set(f, null));
      return null;
    }
    return hit === 'loading' ? null : hit;
  }
}

export type PanelHit = { kind: 'inventory'; x: number; y: number } | { kind: 'equip'; slot: BodyLoc } | { kind: 'close' } | { kind: 'gold' } | { kind: 'panel' } | null;

export class InventoryPanel {
  readonly layout: InvLayout;
  private readonly icons: ItemIcons;
  private readonly text: ItemText;
  private readonly art: UiArt | null;
  open = false;
  /** 쓸 수 있는 아이템인가 (요구치) — 아니면 빨간 바탕 */
  usable: ((it: ItemInstance) => boolean) | null = null;

  /** 확장팩 캐릭터 (invchar6 — 무기 바꾸기 탭) */
  readonly expansion: boolean;

  constructor(layout: InvLayout, icons: ItemIcons, text: ItemText, art: UiArt | null = null, expansion = false) {
    this.layout = layout;
    this.icons = icons;
    this.text = text;
    this.art = art;
    this.expansion = expansion;
    void art?.preload([expansion ? INVCHAR6 : INVCHAR, GOLDBTN, CLOSEBTN]);
  }

  hit(x: number, y: number): PanelHit {
    if (!this.open) return null;
    const L = this.layout;
    const inR = (r: Rect) => x >= r.l && x < r.r && y >= r.t && y < r.b;
    if (!inR(L.panel)) return null;
    if (inR({ l: L.panel.l + CLOSE.x, t: L.panel.t + CLOSE.y, r: L.panel.l + CLOSE.x + CLOSE.w, b: L.panel.t + CLOSE.y + CLOSE.h })) return { kind: 'close' };
    // 금화 단추 (원작: 누르면 금화 창 — 떨어뜨리기, 보관함이 열려 있으면 넣기)
    if (inR({ l: L.panel.l + GOLD.btnX, t: L.panel.t + GOLD.btnY, r: L.panel.l + GOLD.btnX + 20, b: L.panel.t + GOLD.btnY + 18 })) return { kind: 'gold' };
    const g = L.grid;
    if (x >= g.l && y >= g.t && x < g.l + g.cols * g.box && y < g.t + g.rows * g.box) {
      return { kind: 'inventory', x: Math.floor((x - g.l) / g.box), y: Math.floor((y - g.t) / g.box) };
    }
    for (const [slot, r] of Object.entries(L.slots)) if (inR(r)) return { kind: 'equip', slot: slot as BodyLoc };
    return { kind: 'panel' };
  }

  /** 커서 아이템을 (x, y) 칸에 놓을 때 왼쪽 위 칸 (원작: 아이템 가운데가 커서) */
  placeAt(item: ItemInstance, mx: number, my: number): { x: number; y: number } {
    const g = this.layout.grid;
    const x = Math.round((mx - g.l) / g.box - item.invW / 2);
    const y = Math.round((my - g.t) / g.box - item.invH / 2);
    return { x: Math.max(0, Math.min(g.cols - item.invW, x)), y: Math.max(0, Math.min(g.rows - item.invH, y)) };
  }

  /** e2e: 금화 단추 가운데 */
  goldCenter(): { x: number; y: number } {
    return { x: this.layout.panel.l + GOLD.btnX + 10, y: this.layout.panel.t + GOLD.btnY + 9 };
  }

  /** 마우스 아래 아이템 */
  itemAt(store: ItemStore, x: number, y: number): ItemInstance | null {
    const h = this.hit(x, y);
    if (!h) return null;
    if (h.kind === 'inventory') return store.inv.at(h.x, h.y)?.item ?? null;
    if (h.kind === 'equip') return store.equipment[h.slot] ?? null;
    return null;
  }

  /** 툴팁 아래에 붙일 줄 (상점: 팔 값·수리비) */
  priceLine: ((it: ItemInstance) => TextLine | null) | null = null;

  draw(ctx: CanvasRenderingContext2D, store: ItemStore, gold: number, goldMax: number, mouse: { x: number; y: number } | null, reqCtx: { level: number; str: number; dex: number; cls: string }, str: (k: string) => string = (k) => k): void {
    if (!this.open) return;
    const L = this.layout, g = L.grid, P = L.panel;
    ctx.save();
    if (!this.art?.drawPanel(ctx, this.expansion ? INVCHAR6 : INVCHAR, P.l, P.t, 4)) {
      ctx.fillStyle = 'rgba(12,10,8,0.94)';
      ctx.fillRect(P.l, P.t, P.r - P.l, P.b - P.t);
    }
    const back = (it: ItemInstance, x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = this.usable && !this.usable(it) ? 'rgba(160,20,20,0.35)' : 'rgba(20,40,120,0.3)';
      ctx.fillRect(x, y, w, h);
    };
    // 장착 칸
    for (const [slot, r] of Object.entries(L.slots)) {
      const it = store.equipment[slot as BodyLoc];
      if (!it) continue;
      back(it, r.l, r.t, r.r - r.l, r.b - r.t);
      this.drawItem(ctx, it, (r.l + r.r) / 2, (r.t + r.b) / 2, true);
    }
    // 격자
    for (const p of store.inv.items) {
      back(p.item, g.l + p.x * g.box, g.t + p.y * g.box, p.item.invW * g.box - 1, p.item.invH * g.box - 1);
      this.drawItem(ctx, p.item, g.l + (p.x + p.item.invW / 2) * g.box, g.t + (p.y + p.item.invH / 2) * g.box, false);
    }
    // 금화 단추·금액, 닫기 단추
    this.art?.draw(ctx, GOLDBTN, 0, P.l + GOLD.btnX, P.t + GOLD.btnY);
    drawText(ctx, String(gold), P.l + GOLD.x + GOLD.w / 2, P.t + GOLD.y + 2, { align: 'center' });
    this.art?.draw(ctx, CLOSEBTN, 10, P.l + CLOSE.x, P.t + CLOSE.y);
    ctx.restore();
    // 툴팁
    if (mouse && !store.cursor) {
      const it = this.itemAt(store, mouse.x, mouse.y);
      if (it) {
        const extra = this.priceLine?.(it);
        drawTooltip(ctx, extra ? [...this.text.lines(it, reqCtx), extra] : this.text.lines(it, reqCtx), mouse.x, mouse.y);
      } else if (mouse.x >= P.l + GOLD.x && mouse.y >= P.t + GOLD.y && mouse.x < P.l + GOLD.x + GOLD.w && mouse.y < P.t + GOLD.y + GOLD.h) {
        drawTooltip(ctx, [{ text: str('GoldMax').replace('%d', String(goldMax)), color: '#ffffff' }], mouse.x, mouse.y);
      }
    }
  }

  private drawItem(ctx: CanvasRenderingContext2D, it: ItemInstance, cx: number, cy: number, _equipped: boolean): void {
    const img = this.icons.get(it);
    if (img) ctx.drawImage(img as CanvasImageSource, Math.round(cx - img.width / 2), Math.round(cy - img.height / 2));
  }

  /** 커서에 든 아이템 */
  drawCursor(ctx: CanvasRenderingContext2D, store: ItemStore, mouse: { x: number; y: number } | null): void {
    if (!store.cursor || !mouse) return;
    const img = this.icons.get(store.cursor);
    if (img) ctx.drawImage(img as CanvasImageSource, Math.round(mouse.x - img.width / 2), Math.round(mouse.y - img.height / 2));
  }
}

/**
 * 아이템 툴팁 (원작: 반투명 검은 상자, font16 가운데 맞춤, 줄마다 원작 글자 색). 상자는 마우스 위쪽, 화면 밖이면 아래로.
 * 근사(원작 미확인): 상자 여백·투명도
 */
export function drawTooltip(ctx: CanvasRenderingContext2D, lines: TextLine[], x: number, y: number): void {
  if (!lines.length) return;
  const lh = d2text.lineHeight('font16');
  const w = Math.max(...lines.map((l) => d2text.width(l.text))) + 14;
  const h = lines.length * lh + 6;
  let bx = Math.round(x - w / 2), by = Math.round(y - h - 20);
  bx = Math.max(2, Math.min(ctx.canvas.width - w - 2, bx));
  if (by < 2) by = Math.min(ctx.canvas.height - h - 2, y + 24);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(bx, by, w, h);
  ctx.restore();
  lines.forEach((l, i) => drawText(ctx, l.text, bx + w / 2, by + 3 + i * lh, { align: 'center', color: l.color as `#${string}` }));
}
