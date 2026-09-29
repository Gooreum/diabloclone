// 왼쪽 위 용병 초상·생명 막대 (캔버스). 원작 DC6: data\global\ui\HIREABLES\rogueicon.dc6 (46×41, Act 1 Rogue)
// 근사(원작 미확인): 초상 위치(10, 10)·막대 크기와 색(생명 비율에 따라 초록 → 노랑 → 빨강), 이름 위치(글꼴은 원작 font16 금색)
import { parseDc6 } from '../formats/dc6';
import type { Palette } from '../formats/palette';
import { indexedToCanvas, type Drawable } from '../render/sprites';
import type { AsyncAssets } from '../render/units';
import type { MercSnapshot } from '../engine/game';
import { drawText } from './text';

export const MERC_BAR = { x: 10, y: 10, w: 46, h: 41, barH: 5 } as const;

export class MercBar {
  private icon: Drawable | null = null;

  constructor(assets: AsyncAssets, pal: Palette, file = 'rogueicon') {
    void assets.load(`data\\global\\ui\\HIREABLES\\${file}.dc6`).then((b) => {
      const f = b ? parseDc6(b).frames[0] : undefined;
      if (f) this.icon = indexedToCanvas(f.pixels, f.width, f.height, pal);
    });
  }

  get ready(): boolean {
    return !!this.icon;
  }

  draw(ctx: CanvasRenderingContext2D, m: MercSnapshot | null, name: string): void {
    if (!m || m.dead) return;
    const B = MERC_BAR;
    if (this.icon) ctx.drawImage(this.icon as CanvasImageSource, B.x, B.y);
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
