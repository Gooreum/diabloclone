// 게임 메뉴 (ESC): 원작처럼 화면 가운데에 큰 금색 글꼴(font42) 항목 — OPTIONS / SAVE AND EXIT GAME / RETURN TO GAME,
// 마우스를 올린 항목 양옆에 도는 오망성 (data\global\ui\CURSOR\pentspin.dc6, 8프레임).
// OPTIONS → SOUND OPTIONS (SOUND / MUSIC 음량 막대: data\global\ui\WIDGETS\optbar.dc6 290×33 + optskull.dc6 해골 손잡이 28×28)
//         → VIDEO OPTIONS (LIGHTING QUALITY · BLENDED SHADOWS · PERSPECTIVE)
//         → AUTOMAP OPTIONS (AUTOMAP SIZE · FADE · CENTER WHEN CLEARED · SHOW PARTY · SHOW NAMES)
//         → CONFIGURE CONTROLS (기능별 단축키 목록, 줄을 누르고 키를 치면 바뀜 — 틀: data\global\ui\MENU\boxpieces.dc6 조각)
//         → PREVIOUS MENU (string.tbl strOptPrevious "Previous Menu")
// 출처(문자열): string.tbl strOptSound "Sound", strOptMusic "Music", strOptPrevious, cfgCtrl "Configure Controls", CfgFunction "Function", CfgPrimaryKey "Key/Button One",
//   CfgDefault "Default", KeysAssigned "Keys assigned."
// 근사(원작 미확인): 항목 문구는 원작 D2Client 내장 문자열(string.tbl 에 없음)을 영어 대문자로, 항목 세로 위치·간격, 오망성 회전 속도, 값 글자(HIGH/LOW, ON/OFF, YES/NO) 위치,
//   PERSPECTIVE 는 브라우저 2D 그리기라 지원하지 않음(회색·바꿀 수 없음), LIGHTING QUALITY·BLENDED SHADOWS 는 값만 저장(조명·그림자 그리기 없음),
//   CENTER WHEN CLEARED·SHOW PARTY 는 값만 저장(싱글 플레이, 지도는 늘 플레이어 가운데), SOUND OPTIONS 의 3D BIAS·NPC SPEECH 는 없음,
//   CONFIGURE CONTROLS 화면 배치(틀 100,64 600×420, 줄 간격 22)
import { UI, type UiArt } from './art';
import { HotLayer, type HRect } from './hotspot';
import { KEY_ACTIONS, KEY_LABEL, keyBindings, keyName, UNBINDABLE_KEYS, type KeyAction } from './keys';
import { d2text, drawText } from './text';

const PENT = `${UI}CURSOR\\pentspin.dc6`;
const BAR = `${UI}WIDGETS\\optbar.dc6`;
const SKULL = `${UI}WIDGETS\\optskull.dc6`;
const BOX = `${UI}MENU\\boxpieces.dc6`;

/** 음량 (0~1) 읽기·쓰기 — 사운드 시스템에 연결 */
export interface VolumeControl {
  get(kind: 'sfx' | 'music'): number;
  set(kind: 'sfx' | 'music', v: number): void;
}

/** 비디오·자동 지도 옵션 (localStorage 저장) */
export interface GameOptions {
  lighting: 'high' | 'low';
  shadows: boolean;
  perspective: boolean;
  automapSize: 'full' | 'mini';
  automapFade: boolean;
  automapCenter: boolean;
  automapParty: boolean;
  automapNames: boolean;
}
const DEFAULT_OPTIONS: GameOptions = { lighting: 'high', shadows: true, perspective: false, automapSize: 'full', automapFade: false, automapCenter: true, automapParty: true, automapNames: true };
const OPT_KEY = 'd2clone.options';

export function loadOptions(): GameOptions {
  try {
    const raw = globalThis.localStorage?.getItem(OPT_KEY);
    if (raw) return { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<GameOptions>), perspective: false };
  } catch {
    // 저장소를 못 쓰면 기본값
  }
  return { ...DEFAULT_OPTIONS };
}

function saveOptions(o: GameOptions): void {
  try {
    globalThis.localStorage?.setItem(OPT_KEY, JSON.stringify(o));
  } catch {
    // 이번 판에서만 유지
  }
}

type Screen = 'main' | 'options' | 'sound' | 'video' | 'automap' | 'controls';
type OptKey = 'lighting' | 'shadows' | 'perspective' | 'automapSize' | 'automapFade' | 'automapCenter' | 'automapParty' | 'automapNames';
interface Item { key: string; label: string; id: string; bar?: 'sfx' | 'music'; opt?: OptKey; go?: Screen }

const SCREENS: Record<Screen, Item[]> = {
  main: [
    { key: 'options', label: 'OPTIONS', id: 'btn-options', go: 'options' },
    { key: 'save', label: 'SAVE AND EXIT GAME', id: 'btn-save-exit' },
    { key: 'return', label: 'RETURN TO GAME', id: 'btn-return' },
  ],
  options: [
    { key: 'soundopts', label: 'SOUND OPTIONS', id: 'btn-sound-options', go: 'sound' },
    { key: 'videoopts', label: 'VIDEO OPTIONS', id: 'btn-video-options', go: 'video' },
    { key: 'automapopts', label: 'AUTOMAP OPTIONS', id: 'btn-automap-options', go: 'automap' },
    { key: 'controls', label: 'CONFIGURE CONTROLS', id: 'btn-configure-controls', go: 'controls' },
    { key: 'prev1', label: 'PREVIOUS MENU', id: 'btn-options-prev', go: 'main' },
  ],
  sound: [
    { key: 'sfx', label: 'SOUND', id: 'opt-sfx', bar: 'sfx' },
    { key: 'music', label: 'MUSIC', id: 'opt-music', bar: 'music' },
    { key: 'prev2', label: 'PREVIOUS MENU', id: 'btn-sound-prev', go: 'options' },
  ],
  video: [
    { key: 'lighting', label: 'LIGHTING QUALITY', id: 'opt-lighting', opt: 'lighting' },
    { key: 'shadows', label: 'BLENDED SHADOWS', id: 'opt-shadows', opt: 'shadows' },
    { key: 'perspective', label: 'PERSPECTIVE', id: 'opt-perspective', opt: 'perspective' },
    { key: 'prev3', label: 'PREVIOUS MENU', id: 'btn-video-prev', go: 'options' },
  ],
  automap: [
    { key: 'amsize', label: 'AUTOMAP SIZE', id: 'opt-automap-size', opt: 'automapSize' },
    { key: 'amfade', label: 'FADE', id: 'opt-automap-fade', opt: 'automapFade' },
    { key: 'amcenter', label: 'CENTER WHEN CLEARED', id: 'opt-automap-center', opt: 'automapCenter' },
    { key: 'amparty', label: 'SHOW PARTY', id: 'opt-automap-party', opt: 'automapParty' },
    { key: 'amnames', label: 'SHOW NAMES', id: 'opt-automap-names', opt: 'automapNames' },
    { key: 'prev4', label: 'PREVIOUS MENU', id: 'btn-automap-prev', go: 'options' },
  ],
  controls: [{ key: 'prev5', label: 'PREVIOUS MENU', id: 'btn-controls-prev', go: 'options' }],
};
const PARENT: Record<Screen, Screen | null> = { main: null, options: 'main', sound: 'options', video: 'options', automap: 'options', controls: 'options' };
const STEP = 60, ITEM_H = 44;
/** 음량 막대 줄: 이름 왼쪽, 막대 오른쪽 */
const BAR_ROW = { labelX: 110, barX: 400, w: 290, h: 33 } as const;
/** 켜고 끄는 항목: 이름 왼쪽, 값 오른쪽 */
const OPT_ROW = { labelX: 60, valueX: 740 } as const;
/** 단축키 목록 틀 */
const CTRL = { x: 100, y: 64, w: 600, h: 420, rowTop: 104, rowH: 22, keyDX: 160 } as const;
/** 두 줄로 나눈 한 줄 수 (항목 25 개 → 13) */
const KEY_ROWS = Math.ceil(KEY_ACTIONS.length / 2);

export class Panels {
  private readonly art: UiArt;
  private readonly layer: HotLayer;
  private readonly volume: VolumeControl | null;
  private readonly str: (k: string) => string;
  readonly options: GameOptions;
  private screen: Screen = 'main';
  private selected = 1;
  /** 단축키 바꾸는 중인 기능 (키를 기다림) */
  waitingKey: KeyAction | null = null;
  private assignedAt = 0;
  /** 옵션이 바뀌면 (main 이 자동 지도 등에 반영) */
  onOptions: ((o: GameOptions) => void) | null = null;

  constructor(stage: HTMLElement, art: UiArt, onSaveExit: () => void, volume: VolumeControl | null = null, str: (k: string) => string = (k) => k) {
    this.art = art;
    this.volume = volume;
    this.str = str;
    this.options = loadOptions();
    void art.preload([PENT, BAR, SKULL, BOX]);
    this.layer = new HotLayer(stage, 'gamemenu', { x: 0, y: 0, w: 800, h: 600 });
    for (const scr of Object.keys(SCREENS) as Screen[]) {
      SCREENS[scr].forEach((it, i) => {
        const el = this.layer.button(it.key, this.itemRect(scr, i), (e) => {
          if (it.key === 'save') onSaveExit();
          else if (it.key === 'return') this.toggleMenu(false);
          else if (it.go) {
            if (scr === 'controls') keyBindings.save();
            this.go(it.go);
          } else if (it.opt) this.toggleOpt(it.opt);
          else if (it.bar && this.volume) {
            // 막대 위 클릭 위치 = 음량 (원작: 해골을 끌거나 막대를 누른다)
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            this.volume.set(it.bar, Math.max(0, Math.min(1, ((e.clientX - r.left) * (BAR_ROW.w / r.width) - 3 - 14) / (BAR_ROW.w - 6 - 28))));
          }
        }, { id: it.id }, it.label);
        el.addEventListener('mouseenter', () => this.screen === scr && (this.selected = i));
      });
    }
    // 단축키 목록 줄 (누르면 다음 키를 기다린다) · 기본값 단추
    KEY_ACTIONS.forEach((a, i) => this.layer.button(`key:${a}`, this.keyRow(i), () => (this.waitingKey = a), { id: `key-${a}` }, a));
    this.layer.button('keydefault', { x: CTRL.x + 20, y: CTRL.y + CTRL.h - 36, w: 120, h: 24 }, () => {
      keyBindings.reset();
      this.waitingKey = null;
    }, { id: 'btn-controls-default' }, 'Default');
    this.go('main');
  }

  private count(scr: Screen): number {
    return SCREENS[scr].length;
  }

  private top(scr: Screen): number {
    if (scr === 'controls') return 500;
    const n = this.count(scr);
    return n <= 4 ? 200 : Math.round(300 - (n * STEP) / 2);
  }

  private itemRect(scr: Screen, i: number): HRect {
    const it = SCREENS[scr][i];
    const y = this.top(scr) + i * STEP;
    if (it?.bar) return { x: BAR_ROW.barX, y: y + (ITEM_H - BAR_ROW.h) / 2, w: BAR_ROW.w, h: BAR_ROW.h };
    if (it?.opt) return { x: OPT_ROW.labelX, y, w: OPT_ROW.valueX - OPT_ROW.labelX, h: ITEM_H };
    const w = Math.max(200, d2text.width(it?.label ?? '', 'font42') + 20);
    return { x: 400 - w / 2, y, w, h: ITEM_H };
  }

  /** 단축키 줄: 기능이 23개라 두 칸 (왼쪽 12 · 오른쪽 11). 근사(원작 미확인): 원작은 한 줄 목록을 스크롤 */
  private keyRow(i: number): HRect {
    const col = i < KEY_ROWS ? 0 : 1, row = i % KEY_ROWS, w = (CTRL.w - 28) / 2;
    return { x: CTRL.x + 14 + col * w, y: CTRL.rowTop + row * CTRL.rowH, w, h: CTRL.rowH };
  }

  private go(scr: Screen): void {
    this.screen = scr;
    this.waitingKey = null;
    this.selected = scr === 'main' ? 1 : 0;
    const keys = new Set(SCREENS[scr].map((it) => it.key));
    if (scr === 'controls') {
      for (const a of KEY_ACTIONS) keys.add(`key:${a}`);
      keys.add('keydefault');
    }
    this.layer.only(keys);
    // 숨겼던 단추를 다시 보이게 (only 는 숨기기만 한다)
    SCREENS[scr].forEach((it, i) => this.layer.button(it.key, this.itemRect(scr, i), () => undefined));
    if (scr === 'controls') {
      KEY_ACTIONS.forEach((a, i) => this.layer.button(`key:${a}`, this.keyRow(i), () => undefined));
      this.layer.button('keydefault', { x: CTRL.x + 20, y: CTRL.y + CTRL.h - 36, w: 120, h: 24 }, () => undefined);
    }
  }

  get current(): Screen {
    return this.screen;
  }

  get menuOpen(): boolean {
    return this.layer.visible;
  }

  toggleMenu(open = !this.menuOpen): void {
    this.layer.visible = open;
    if (open) this.go('main');
  }

  private toggleOpt(k: OptKey): void {
    const o = this.options;
    if (k === 'perspective') return; // 지원하지 않음
    if (k === 'lighting') o.lighting = o.lighting === 'high' ? 'low' : 'high';
    else if (k === 'automapSize') o.automapSize = o.automapSize === 'full' ? 'mini' : 'full';
    else o[k] = !o[k];
    saveOptions(o);
    this.onOptions?.(o);
  }

  private value(k: OptKey): string {
    const o = this.options;
    if (k === 'lighting') return o.lighting === 'high' ? 'HIGH' : 'LOW';
    if (k === 'automapSize') return o.automapSize === 'full' ? 'FULL SCREEN' : 'MINI MAP';
    if (k === 'shadows' || k === 'perspective') return o[k] ? 'ON' : 'OFF';
    return o[k] ? 'YES' : 'NO';
  }

  /** Esc: 옵션 화면이면 한 단계 위로, 첫 화면이면 닫기 */
  back(): void {
    if (this.waitingKey) {
      this.waitingKey = null;
      return;
    }
    const p = PARENT[this.screen];
    if (this.screen === 'controls') keyBindings.save();
    if (p) this.go(p);
    else this.toggleMenu(false);
  }

  /** 키보드 위·아래·Enter·왼쪽·오른쪽 (원작 메뉴 조작). 단축키 기다리는 중이면 그 키를 배정 */
  key(k: string): boolean {
    if (!this.menuOpen) return false;
    if (this.waitingKey && k !== 'Escape') {
      // fn+F1 처럼 누르면 fn 이 먼저 온다 — 다음 키 (F1) 를 기다린다
      if (UNBINDABLE_KEYS.has(k)) return true;
      keyBindings.set(this.waitingKey, keyName({ key: k }));
      this.waitingKey = null;
      this.assignedAt = performance.now();
      return true;
    }
    const items = SCREENS[this.screen];
    const cur = items[this.selected];
    if (k === 'ArrowUp') this.selected = (this.selected + items.length - 1) % items.length;
    else if (k === 'ArrowDown') this.selected = (this.selected + 1) % items.length;
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && cur?.bar && this.volume) this.volume.set(cur.bar, this.volume.get(cur.bar) + (k === 'ArrowLeft' ? -0.1 : 0.1));
    else if ((k === 'ArrowLeft' || k === 'ArrowRight') && cur?.opt) this.toggleOpt(cur.opt);
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

  /** boxpieces.dc6 조각 틀 (조각 14×15, 안쪽 12 픽셀 간격: 0 왼쪽 위, 1 오른쪽 위, 2 위, 8 왼쪽 아래, 9 오른쪽 아래, 10 세로, 16 아래 — 원작 그림 확인) */
  private box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(x, y, w, h);
    const a = this.art;
    for (let cx = x + 11; cx < x + w - 13; cx += 12) {
      a.draw(ctx, BOX, 2, cx, y - 1);
      a.draw(ctx, BOX, 16, cx, y + h - 13 + 9);
    }
    for (let cy = y + 11; cy < y + h - 13; cy += 12) {
      a.draw(ctx, BOX, 10, x - 5, cy);
      a.draw(ctx, BOX, 10, x + w - 13 + 4, cy);
    }
    a.draw(ctx, BOX, 0, x - 1, y - 1);
    a.draw(ctx, BOX, 1, x + w - 13, y - 1);
    a.draw(ctx, BOX, 8, x - 1, y + h - 13);
    a.draw(ctx, BOX, 9, x + w - 13, y + h - 13);
  }

  private drawControls(ctx: CanvasRenderingContext2D, now: number): void {
    const s = this.str;
    drawText(ctx, s('cfgCtrl').toUpperCase(), 400, 20, { font: 'font30', align: 'center' });
    this.box(ctx, CTRL.x, CTRL.y, CTRL.w, CTRL.h);
    for (const i of [0, KEY_ROWS]) {
      const r = this.keyRow(i);
      drawText(ctx, s('CfgFunction'), r.x + 10, CTRL.y + 14, { color: 'gold' });
      drawText(ctx, s('CfgPrimaryKey'), r.x + CTRL.keyDX, CTRL.y + 14, { color: 'gold' });
    }
    KEY_ACTIONS.forEach((a, i) => {
      const r = this.keyRow(i);
      const waiting = this.waitingKey === a;
      if (waiting) {
        ctx.fillStyle = 'rgba(80,60,20,0.6)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      drawText(ctx, s(KEY_LABEL[a]), r.x + 10, r.y + 3, { color: 'white' });
      const key = keyBindings.map[a];
      // 기다리는 동안 깜빡이는 빈 칸 (근사)
      const label = waiting ? (Math.floor(now / 300) % 2 ? '_' : '') : keyBindings.label(key, s);
      drawText(ctx, label, r.x + CTRL.keyDX, r.y + 3, { color: key ? 'white' : 'grey' });
    });
    drawText(ctx, s('CfgDefault'), CTRL.x + 80, CTRL.y + CTRL.h - 32, { align: 'center', color: 'gold' });
    if (now - this.assignedAt < 1500) drawText(ctx, s('KeysAssigned'), CTRL.x + CTRL.w - 24, CTRL.y + CTRL.h - 32, { align: 'right' });
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.menuOpen) return;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, 800, 600);
    if (this.screen === 'controls') this.drawControls(ctx, now);
    const items = SCREENS[this.screen];
    const top = this.top(this.screen);
    items.forEach((it, i) => {
      const r = this.itemRect(this.screen, i);
      // 폭이 글꼴 로드 뒤 바뀌므로 단추 위치를 맞춘다
      this.layer.button(it.key, r, () => undefined);
      if (it.bar) {
        drawText(ctx, it.label, BAR_ROW.labelX, top + i * STEP + 2, { font: 'font42' });
        this.art.drawTiles(ctx, BAR, 2, r.x, r.y, 0, 2);
        const v = this.volume?.get(it.bar) ?? 1;
        this.art.draw(ctx, SKULL, 0, r.x + 3 + v * (BAR_ROW.w - 6 - 28), r.y + 2);
      } else if (it.opt) {
        // 지원하지 않는 항목은 회색 (근사)
        const color = it.opt === 'perspective' ? 'grey' : 'native';
        drawText(ctx, it.label, OPT_ROW.labelX, r.y + 2, { font: 'font42', color });
        drawText(ctx, this.value(it.opt), OPT_ROW.valueX, r.y + 2, { font: 'font42', align: 'right', color });
      } else drawText(ctx, it.label, 400, r.y + 2, { font: 'font42', align: 'center' });
    });
    const sel = items[this.selected];
    if (!sel) return;
    const f = this.art.frame(PENT, Math.floor(now / 60) % 8);
    if (!f) return;
    const cy = top + this.selected * STEP + ITEM_H / 2 - f.h / 2;
    if (sel.bar) {
      ctx.drawImage(f.img as CanvasImageSource, Math.round(BAR_ROW.labelX - f.w - 10), Math.round(cy));
    } else if (sel.opt) {
      ctx.drawImage(f.img as CanvasImageSource, Math.round(OPT_ROW.labelX - f.w - 4), Math.round(cy));
      ctx.drawImage(f.img as CanvasImageSource, Math.round(OPT_ROW.valueX + 4), Math.round(cy));
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
