// 웨이포인트 목록 패널 (캔버스). 원작 DC6: data\global\ui\menu\waygatebackground.dc6 (256+64 × 256+176, 4조각),
// waygatetabs.dc6 (액트 I~IV 탭 — 프레임 쌍), waygateicons.dc6 (웨이포인트 아이콘).
// 출처: 원작 panel 배치 inventory.txt 800×600 왼쪽 패널 (x 80~401, y 60~) — 오른쪽 인벤토리(400~720)의 거울 위치
// 근사(원작 미확인): 탭 프레임 짝(선택/비선택)·아이콘 프레임(0 활성, 3 비활성) 의미, 줄 간격 36px·글자 위치, 글꼴 원작 font16
import { parseDc6, type Dc6 } from '../formats/dc6';
import type { Palette } from '../formats/palette';
import { indexedToCanvas, type Drawable } from '../render/sprites';
import type { AsyncAssets } from '../render/units';
import { drawText } from './text';

export interface WaypointRow { no: number; levelKey: string; name: string; active: boolean; current: boolean }

export const WP_PANEL = { x: 80, y: 60, w: 320, h: 432 } as const;
/** 줄(아이콘 칸) 위치: 배경 그림의 금테 칸 (x 15, y 57 + 36·i) */
const ROW = { iconX: 16, iconY: 58, step: 36, textX: 60 } as const;
const TAB = { x: 2, y: 3, w: 78, h: 30 } as const;
const CLOSE = { x: 272, y: 384, w: 36, h: 36 } as const;

export class WaypointPanel {
  open = false;
  rows: WaypointRow[] = [];
  private readonly frames = new Map<string, Drawable[] | null>();
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;

  constructor(assets: AsyncAssets, pal: Palette) {
    this.assets = assets;
    this.pal = pal;
    for (const f of ['waygatebackground', 'waygatetabs', 'waygateicons']) this.load(f);
  }

  private load(name: string): void {
    this.frames.set(name, null);
    void this.assets.load(`data\\global\\ui\\menu\\${name}.dc6`).then((b) => {
      if (!b) return;
      const d: Dc6 = parseDc6(b);
      this.frames.set(name, d.frames.map((f) => indexedToCanvas(f.pixels, f.width, f.height, this.pal)));
    });
  }

  get ready(): boolean {
    return ['waygatebackground', 'waygatetabs', 'waygateicons'].every((n) => !!this.frames.get(n));
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.open) return;
    const P = WP_PANEL;
    const bg = this.frames.get('waygatebackground');
    if (bg) {
      // 4조각: 256×256, 64×256, 256×176, 64×176
      const pos = [[0, 0], [256, 0], [0, 256], [256, 256]];
      bg.forEach((c, i) => ctx.drawImage(c as CanvasImageSource, P.x + (pos[i]?.[0] ?? 0), P.y + (pos[i]?.[1] ?? 0)));
    }
    const tabs = this.frames.get('waygatetabs');
    if (tabs) for (let a = 0; a < 4; a++) {
      const f = tabs[a * 2 + (a === 0 ? 0 : 1)];
      if (f) ctx.drawImage(f as CanvasImageSource, P.x + TAB.x + a * TAB.w, P.y + TAB.y);
    }
    const icons = this.frames.get('waygateicons');
    this.rows.forEach((r, i) => {
      const y = P.y + ROW.iconY + i * ROW.step;
      const ic = icons?.[r.active ? 0 : 3];
      if (ic) ctx.drawImage(ic as CanvasImageSource, P.x + ROW.iconX, y);
      drawText(ctx, r.name, P.x + ROW.textX, y + 8, { color: r.current ? 'blue' : r.active ? 'gold' : 'grey' });
    });
  }

  /** 클릭 → 이동할 레벨 키 / 'close' / 'panel'(패널 안 다른 곳) / null(패널 밖) */
  click(x: number, y: number): string | null {
    if (!this.open) return null;
    const P = WP_PANEL;
    if (x < P.x || y < P.y || x > P.x + P.w || y > P.y + P.h) return null;
    if (x >= P.x + CLOSE.x && x <= P.x + CLOSE.x + CLOSE.w && y >= P.y + CLOSE.y && y <= P.y + CLOSE.y + CLOSE.h) return 'close';
    const i = Math.floor((y - P.y - ROW.iconY) / ROW.step);
    const row = this.rows[i];
    if (row && x >= P.x + ROW.iconX && y >= P.y + ROW.iconY + i * ROW.step && y <= P.y + ROW.iconY + i * ROW.step + 32 && row.active && !row.current) return row.levelKey;
    return 'panel';
  }

  /** 줄 i 의 화면 중심 (테스트·자동화용) */
  rowCenter(i: number): { x: number; y: number } {
    return { x: WP_PANEL.x + ROW.textX + 40, y: WP_PANEL.y + ROW.iconY + i * ROW.step + 15 };
  }
}
