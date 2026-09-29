// 인벤토리 패널 (캔버스): 원작 inventory.txt 800×600 좌표(<클래스>2 행)에 장착 칸·10×4 격자, 아이템은 원작 DC6 인벤토리 그림.
// 원작 패널 배경(DC6 invchar6)은 Phase 11 에서 입힌다 — 지금은 칸 윤곽만.
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

export type PanelHit = { kind: 'inventory'; x: number; y: number } | { kind: 'equip'; slot: BodyLoc } | { kind: 'panel' } | null;

export class InventoryPanel {
  readonly layout: InvLayout;
  private readonly icons: ItemIcons;
  private readonly text: ItemText;
  open = false;

  constructor(layout: InvLayout, icons: ItemIcons, text: ItemText) {
    this.layout = layout;
    this.icons = icons;
    this.text = text;
  }

  hit(x: number, y: number): PanelHit {
    if (!this.open) return null;
    const L = this.layout;
    const inR = (r: Rect) => x >= r.l && x < r.r && y >= r.t && y < r.b;
    if (!inR(L.panel)) return null;
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

  draw(ctx: CanvasRenderingContext2D, store: ItemStore, gold: number, goldMax: number, mouse: { x: number; y: number } | null, reqCtx: { level: number; str: number; dex: number; cls: string }): void {
    if (!this.open) return;
    const L = this.layout, g = L.grid;
    ctx.save();
    ctx.fillStyle = 'rgba(12,10,8,0.94)';
    ctx.fillRect(L.panel.l, L.panel.t, L.panel.r - L.panel.l, L.panel.b - L.panel.t);
    ctx.strokeStyle = '#6b5a3a';
    ctx.strokeRect(L.panel.l + 0.5, L.panel.t + 0.5, L.panel.r - L.panel.l - 1, L.panel.b - L.panel.t - 1);
    // 장착 칸
    for (const [slot, r] of Object.entries(L.slots)) {
      ctx.fillStyle = '#1a1510';
      ctx.fillRect(r.l, r.t, r.r - r.l, r.b - r.t);
      ctx.strokeStyle = '#4a3f2c';
      ctx.strokeRect(r.l + 0.5, r.t + 0.5, r.r - r.l - 1, r.b - r.t - 1);
      const it = store.equipment[slot as BodyLoc];
      if (it) this.drawItem(ctx, it, (r.l + r.r) / 2, (r.t + r.b) / 2, true);
    }
    // 격자
    for (let y = 0; y < g.rows; y++)
      for (let x = 0; x < g.cols; x++) {
        ctx.fillStyle = '#15110c';
        ctx.fillRect(g.l + x * g.box, g.t + y * g.box, g.box - 1, g.box - 1);
      }
    for (const p of store.inv.items) {
      ctx.fillStyle = p.item.quality === QUALITY.UNIQUE ? 'rgba(90,70,30,0.5)' : p.item.quality === QUALITY.SET ? 'rgba(20,80,20,0.5)' : 'rgba(40,40,70,0.35)';
      ctx.fillRect(g.l + p.x * g.box, g.t + p.y * g.box, p.item.invW * g.box - 1, p.item.invH * g.box - 1);
      this.drawItem(ctx, p.item, g.l + (p.x + p.item.invW / 2) * g.box, g.t + (p.y + p.item.invH / 2) * g.box, false);
    }
    ctx.fillStyle = '#c7b377';
    ctx.font = '13px serif';
    ctx.fillText(`Gold: ${gold} / ${goldMax}`, g.l, g.t + g.rows * g.box + 18);
    ctx.restore();
    // 툴팁
    if (mouse && !store.cursor) {
      const it = this.itemAt(store, mouse.x, mouse.y);
      if (it) {
        const extra = this.priceLine?.(it);
        drawTooltip(ctx, extra ? [...this.text.lines(it, reqCtx), extra] : this.text.lines(it, reqCtx), mouse.x, mouse.y);
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

export function drawTooltip(ctx: CanvasRenderingContext2D, lines: TextLine[], x: number, y: number): void {
  ctx.save();
  ctx.font = '14px serif';
  const w = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 16;
  const h = lines.length * 16 + 8;
  let bx = Math.round(x - w / 2), by = Math.round(y - h - 12);
  bx = Math.max(2, Math.min(ctx.canvas.width - w - 2, bx));
  if (by < 2) by = y + 20;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(bx, by, w, h);
  ctx.textAlign = 'center';
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, bx + w / 2, by + 18 + i * 16);
  });
  ctx.restore();
}
