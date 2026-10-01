// 웨이포인트 목록 패널 (캔버스). 원작 DC6: data\global\ui\menu\waygatebackground.dc6 (256+64 × 256+176, 4조각),
// waygatetabs.dc6 (액트 I~IV 탭 — 프레임 쌍), waygateicons.dc6 (웨이포인트 아이콘).
// 출처: 원작 panel 배치 inventory.txt 800×600 왼쪽 패널 (x 80~401, y 60~) — 오른쪽 인벤토리(400~720)의 거울 위치
// 근사(원작 미확인): 탭 프레임 짝(선택/비선택)·아이콘 프레임(0 활성, 3 비활성) 의미, 줄 간격 36px·글자 위치, 글꼴 원작 font16
import { parseDc6, type Dc6 } from '../formats/dc6';
import type { Palette } from '../formats/palette';
import { indexedToCanvas, type Drawable } from '../render/sprites';
import type { AsyncAssets } from '../render/units';
import { drawText } from './text';

export interface WaypointRow { no: number; levelKey: string; name: string; active: boolean; current: boolean; levelNo?: number }

export const WP_PANEL = { x: 80, y: 60, w: 320, h: 432 } as const;
/** 줄(아이콘 칸) 위치: 배경 그림의 금테 칸 (x 15, y 57 + 36·i) */
const ROW = { iconX: 16, iconY: 58, step: 36, textX: 60 } as const;
/** 막 탭 칸. 출처(그림 측정): 클래식 waygatetabs.dc6 프레임 78×30 (4 탭), 확장팩 expwaygatetabs.dc6 프레임 63×31 (5 탭) */
const TAB4 = { x: 2, y: 3, w: 78, h: 30 } as const;
const TAB5 = { x: 2, y: 3, w: 63, h: 31 } as const;
const CLOSE = { x: 272, y: 384, w: 36, h: 36 } as const;

export class WaypointPanel {
  open = false;
  /** 고른 막 탭 (0 = Act I). 원작: 패널을 열면 지금 막 탭 */
  tab = 0;
  /** 막 탭별 줄 (월드가 없는 막은 빈 목록) */
  rowsByAct: WaypointRow[][] = [];
  /** 누를 수 있는 탭 (월드가 있는 막) */
  tabEnabled: boolean[];
  private readonly frames = new Map<string, Drawable[] | null>();
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;
  /** 막 탭 수 (클래식 4, 확장팩 5) */
  readonly tabs: number;
  private readonly tabFile: string;
  private readonly TAB: { x: number; y: number; w: number; h: number };

  constructor(assets: AsyncAssets, pal: Palette, tabs: 4 | 5 = 4) {
    this.assets = assets;
    this.pal = pal;
    this.tabs = tabs;
    this.tabFile = tabs === 5 ? 'expwaygatetabs' : 'waygatetabs';
    this.TAB = tabs === 5 ? TAB5 : TAB4;
    this.tabEnabled = Array.from({ length: tabs }, (_, i) => i === 0);
    for (const f of ['waygatebackground', this.tabFile, 'waygateicons']) this.load(f);
  }

  private load(name: string): void {
    this.frames.set(name, null);
    void this.assets.load(`data\\global\\ui\\menu\\${name}.dc6`).then((b) => {
      if (!b) return;
      const d: Dc6 = parseDc6(b);
      this.frames.set(name, d.frames.map((f) => indexedToCanvas(f.pixels, f.width, f.height, this.pal)));
    });
  }

  /** 지금 탭의 줄 */
  get rows(): WaypointRow[] {
    return this.rowsByAct[this.tab] ?? [];
  }
  set rows(v: WaypointRow[]) {
    this.rowsByAct[this.tab] = v;
  }

  get ready(): boolean {
    return ['waygatebackground', this.tabFile, 'waygateicons'].every((n) => !!this.frames.get(n));
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
    const tabs = this.frames.get(this.tabFile);
    const TAB = this.TAB;
    // 탭 프레임 짝: 선택 2a, 비선택 2a+1 (근사(원작 미확인))
    if (tabs) for (let a = 0; a < this.tabs; a++) {
      const f = tabs[a * 2 + (a === this.tab ? 0 : 1)];
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
    // 막 탭: 월드가 있는 막만 고를 수 있다
    const TAB = this.TAB;
    if (y >= P.y + TAB.y && y < P.y + TAB.y + TAB.h && x >= P.x + TAB.x && x < P.x + TAB.x + this.tabs * TAB.w) {
      const a = Math.floor((x - P.x - TAB.x) / TAB.w);
      if (this.tabEnabled[a]) this.tab = a;
      return 'panel';
    }
    const i = Math.floor((y - P.y - ROW.iconY) / ROW.step);
    const row = this.rows[i];
    if (row && x >= P.x + ROW.iconX && y >= P.y + ROW.iconY + i * ROW.step && y <= P.y + ROW.iconY + i * ROW.step + 32 && row.active && !row.current) return row.levelKey;
    return 'panel';
  }

  /** 막 탭 a 의 화면 중심 (테스트·자동화용) */
  tabCenter(a: number): { x: number; y: number } {
    const TAB = this.TAB;
    return { x: WP_PANEL.x + TAB.x + a * TAB.w + TAB.w / 2, y: WP_PANEL.y + TAB.y + TAB.h / 2 };
  }

  /** 줄 i 의 화면 중심 (테스트·자동화용) */
  rowCenter(i: number): { x: number; y: number } {
    return { x: WP_PANEL.x + ROW.textX + 40, y: WP_PANEL.y + ROW.iconY + i * ROW.step + 15 };
  }
}
