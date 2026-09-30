// 왼쪽 위 용병 초상·생명 막대 (캔버스). 원작 DC6: data\global\ui\HIREABLES\rogueicon.dc6 (46×41, Act 1 Rogue),
// act2hireableicon.dc6 (Act 2 사막 용병), act3hireableicon.dc6 (Act 3 철늑대) — engine/hireling.ts MERC_ICONS
// 근사(원작 미확인): 초상 위치(10, 10)·막대 크기와 색(생명 비율에 따라 초록 → 노랑 → 빨강), 이름 위치(글꼴은 원작 font16 금색)
import { parseDc6 } from '../formats/dc6';
import type { Palette } from '../formats/palette';
import { indexedToCanvas, type Drawable } from '../render/sprites';
import type { AsyncAssets } from '../render/units';
import type { MercSnapshot } from '../engine/game';
import { MERC_ICONS } from '../engine/hireling';
import { drawText } from './text';

export const MERC_BAR = { x: 10, y: 10, w: 46, h: 41, barH: 5 } as const;

export class MercBar {
  /** 파일 이름 → 초상 (읽는 중이면 null) */
  private readonly icons = new Map<string, Drawable | null>();
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;
  private readonly fallback: string;

  constructor(assets: AsyncAssets, pal: Palette, file = 'rogueicon') {
    this.assets = assets;
    this.pal = pal;
    this.fallback = file;
    this.iconFor(file);
  }

  private iconFor(file: string): Drawable | null {
    if (this.icons.has(file)) return this.icons.get(file) ?? null;
    this.icons.set(file, null);
    void this.assets.load(`data\\global\\ui\\HIREABLES\\${file}.dc6`).then((b) => {
      const f = b ? parseDc6(b).frames[0] : undefined;
      if (f) this.icons.set(file, indexedToCanvas(f.pixels, f.width, f.height, this.pal));
    });
    return null;
  }

  get ready(): boolean {
    return !!this.icons.get(this.fallback);
  }

  /** 이 용병 종류의 초상이 읽혔는가 */
  readyFor(typeId: string): boolean {
    return !!this.icons.get(MERC_ICONS[typeId] ?? this.fallback);
  }

  draw(ctx: CanvasRenderingContext2D, m: MercSnapshot | null, name: string): void {
    if (!m || m.dead) return;
    const B = MERC_BAR;
    const icon = this.iconFor(MERC_ICONS[m.typeId ?? ''] ?? this.fallback);
    if (icon) ctx.drawImage(icon as CanvasImageSource, B.x, B.y);
    else {
      ctx.fillStyle = '#222';
      ctx.fillRect(B.x, B.y, B.w, B.h);
    }
    const frac = m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(B.x, B.y + B.h + 2, B.w, B.barH);
    ctx.fillStyle = frac > 0.5 ? '#18c018' : frac > 0.25 ? '#d0c018' : '#c01818';
    ctx.fillRect(B.x, B.y + B.h + 2, Math.round(B.w * frac), B.barH);
    drawText(ctx, name, B.x + B.w + 6, B.y + 4, { color: 'gold' });
  }
}
