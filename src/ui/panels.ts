// 게임 메뉴 (ESC): 원작처럼 화면 가운데에 큰 금색 글꼴(font42) 항목 — OPTIONS / SAVE AND EXIT GAME / RETURN TO GAME,
// 마우스를 올린 항목 양옆에 도는 오망성 (data\global\ui\CURSOR\pentspin.dc6, 8프레임).
// OPTIONS → SOUND OPTIONS → SOUND / MUSIC 음량 막대 (data\global\ui\WIDGETS\optbar.dc6 290×33 + optskull.dc6 해골 손잡이 28×28).
// 근사(원작 미확인): 항목 문구는 원작 D2Client 내장 문자열(string.tbl 에 없음)을 영어 그대로, 항목 세로 위치·간격, 오망성 회전 속도,
//   옵션은 SOUND OPTIONS 의 SOUND·MUSIC 막대만 (VIDEO·AUTOMAP·CONFIGURE CONTROLS·3D BIAS·NPC SPEECH 는 아직 없음)
import { UI, type UiArt } from './art';
import { HotLayer } from './hotspot';
import { d2text, drawText } from './text';

const PENT = `${UI}CURSOR\\pentspin.dc6`;
const BAR = `${UI}WIDGETS\\optbar.dc6`;
const SKULL = `${UI}WIDGETS\\optskull.dc6`;

/** 음량 (0~1) 읽기·쓰기 — 사운드 시스템에 연결 */
export interface VolumeControl {
  get(kind: 'sfx' | 'music'): number;
  set(kind: 'sfx' | 'music', v: number): void;
}

type Screen = 'main' | 'options' | 'sound';
interface Item { key: string; label: string; id: string; bar?: 'sfx' | 'music' }

const SCREENS: Record<Screen, Item[]> = {
  main: [
    { key: 'options', label: 'OPTIONS', id: 'btn-options' },
    { key: 'save', label: 'SAVE AND EXIT GAME', id: 'btn-save-exit' },
    { key: 'return', label: 'RETURN TO GAME', id: 'btn-return' },
  ],
  options: [
    { key: 'soundopts', label: 'SOUND OPTIONS', id: 'btn-sound-options' },
    { key: 'prev1', label: 'PREVIOUS MENU', id: 'btn-options-prev' },
  ],
  sound: [
    { key: 'sfx', label: 'SOUND', id: 'opt-sfx', bar: 'sfx' },
    { key: 'music', label: 'MUSIC', id: 'opt-music', bar: 'music' },
    { key: 'prev2', label: 'PREVIOUS MENU', id: 'btn-sound-prev' },
  ],
};
const TOP = 200, STEP = 60, ITEM_H = 44;
/** 음량 막대 줄: 이름 왼쪽, 막대 오른쪽 */
const BAR_ROW = { labelX: 110, barX: 400, w: 290, h: 33 } as const;

export class Panels {
  private readonly art: UiArt;
  private readonly layer: HotLayer;
  private readonly volume: VolumeControl | null;
  private screen: Screen = 'main';
  private selected = 1;

  constructor(stage: HTMLElement, art: UiArt, onSaveExit: () => void, volume: VolumeControl | null = null) {
    this.art = art;
    this.volume = volume;
    void art.preload([PENT, BAR, SKULL]);
    this.layer = new HotLayer(stage, 'gamemenu', { x: 0, y: 0, w: 800, h: 600 });
    for (const scr of Object.keys(SCREENS) as Screen[]) {
      SCREENS[scr].forEach((it, i) => {
        const el = this.layer.button(it.key, this.itemRect(scr, i), (e) => {
          if (it.key === 'save') onSaveExit();
          else if (it.key === 'return') this.toggleMenu(false);
          else if (it.key === 'options') this.go('options');
          else if (it.key === 'soundopts') this.go('sound');
          else if (it.key === 'prev1') this.go('main');
          else if (it.key === 'prev2') this.go('options');
          else if (it.bar && this.volume) {
            // 막대 위 클릭 위치 = 음량 (원작: 해골을 끌거나 막대를 누른다)
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            this.volume.set(it.bar, Math.max(0, Math.min(1, (e.clientX - r.left - 3 - 14) / (BAR_ROW.w - 6 - 28))));
          }
        }, { id: it.id }, it.label);
        el.addEventListener('mouseenter', () => this.screen === scr && (this.selected = i));
      });
    }
    this.go('main');
  }

  private itemRect(scr: Screen, i: number): { x: number; y: number; w: number; h: number } {
    const it = SCREENS[scr][i];
    if (it?.bar) return { x: BAR_ROW.barX, y: TOP + i * STEP + (ITEM_H - BAR_ROW.h) / 2, w: BAR_ROW.w, h: BAR_ROW.h };
    const w = Math.max(200, d2text.width(it?.label ?? '', 'font42') + 20);
    return { x: 400 - w / 2, y: TOP + i * STEP, w, h: ITEM_H };
  }

  private go(scr: Screen): void {
    this.screen = scr;
    this.selected = scr === 'main' ? 1 : 0;
    this.layer.only(new Set(SCREENS[scr].map((it) => it.key)));
  }

  get menuOpen(): boolean {
    return this.layer.visible;
  }

  toggleMenu(open = !this.menuOpen): void {
    this.layer.visible = open;
    if (open) this.go('main');
  }

  /** Esc: 옵션 화면이면 한 단계 위로, 첫 화면이면 닫기 */
  back(): void {
    if (this.screen === 'sound') this.go('options');
    else if (this.screen === 'options') this.go('main');
    else this.toggleMenu(false);
  }

  /** 키보드 위·아래·Enter·왼쪽·오른쪽 (원작 메뉴 조작) */
  key(k: string): boolean {
    if (!this.menuOpen) return false;
    const items = SCREENS[this.screen];
    const cur = items[this.selected];
    if (k === 'ArrowUp') this.selected = (this.selected + items.length - 1) % items.length;
    else if (k === 'ArrowDown') this.selected = (this.selected + 1) % items.length;
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && cur?.bar && this.volume) this.volume.set(cur.bar, this.volume.get(cur.bar) + (k === 'ArrowLeft' ? -0.1 : 0.1));
    else if (k === 'Enter' && !cur?.bar) (document.getElementById(cur?.id ?? '') as HTMLButtonElement | null)?.click();
    else return false;
    return true;
  }

  /** e2e: 음량 막대 위 비율 v 지점 (화면 좌표) */
  barPoint(kind: 'sfx' | 'music', v: number): { x: number; y: number } {
    const i = SCREENS.sound.findIndex((it) => it.bar === kind);
    const r = this.itemRect('sound', i);
    return { x: r.x + 3 + 14 + v * (BAR_ROW.w - 6 - 28), y: r.y + r.h / 2 };
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.menuOpen) return;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, 800, 600);
    const items = SCREENS[this.screen];
    items.forEach((it, i) => {
      const r = this.itemRect(this.screen, i);
      // 폭이 글꼴 로드 뒤 바뀌므로 단추 위치를 맞춘다
      this.layer.button(it.key, r, () => undefined);
      if (it.bar) {
        drawText(ctx, it.label, BAR_ROW.labelX, TOP + i * STEP + 2, { font: 'font42' });
        this.art.drawTiles(ctx, BAR, 2, r.x, r.y, 0, 2);
        const v = this.volume?.get(it.bar) ?? 1;
        this.art.draw(ctx, SKULL, 0, r.x + 3 + v * (BAR_ROW.w - 6 - 28), r.y + 2);
      } else drawText(ctx, it.label, 400, r.y + 2, { font: 'font42', align: 'center' });
    });
    const sel = items[this.selected];
    if (!sel) return;
    const f = this.art.frame(PENT, Math.floor(now / 60) % 8);
    if (!f) return;
    const cy = TOP + this.selected * STEP + ITEM_H / 2 - f.h / 2;
    if (sel.bar) {
      ctx.drawImage(f.img as CanvasImageSource, Math.round(BAR_ROW.labelX - f.w - 10), Math.round(cy));
    } else {
      const tw = d2text.width(sel.label, 'font42');
      ctx.drawImage(f.img as CanvasImageSource, Math.round(400 - tw / 2 - f.w - 10), Math.round(cy));
      ctx.drawImage(f.img as CanvasImageSource, Math.round(400 + tw / 2 + 10), Math.round(cy));
    }
  }

  dispose(): void {
    this.layer.dispose();
  }
}
