// 원작 금화 창 (인벤토리 금화 단추 = 떨어뜨리기 / 보관함이 열려 있으면 넣기, 보관함 금화 단추 = 빼기):
// 그림 data\global\ui\MENU\dialogbackground.dc6 (210×158: 위 글 칸, 숫자 칸 x 29~197 · y 67~91, 네모 단추 칸 두 개 x 33·139 y 115, 원작 그림 측정),
// 확인 = PANEL\buysellbtn.dc6 프레임 16(눌림 17, 체크 표시), 취소 = 프레임 10(눌림 11, 금지 표시), 위·아래 화살표 = MENU\textslid.dc6 프레임 9·8(눌림 11·10) (원작 그림 확인)
// 출처(문자열): string.tbl strDropGoldHowMuch "How much Gold would you like to drop?", strBankGoldDeposit "…deposit?", strBankGoldWithdraw "…withdraw?"
// 조작(원작): 숫자 키로 입력, 화살표로 1씩, Enter = 확인, Esc = 취소
// 근사(원작 미확인): 창 위치(열린 패널 가운데, y 200), 처음 값 = 옮길 수 있는 최대, 화살표 위치(숫자 칸 오른쪽 끝에 위·아래로), 글꼴 font16 흰색
import { UI, type UiArt } from './art';
import { HotLayer, type HRect } from './hotspot';
import { d2text, drawText } from './text';

const BG = `${UI}MENU\\dialogbackground.dc6`;
const BTN = `${UI}PANEL\\buysellbtn.dc6`;
const ARROW = `${UI}MENU\\textslid.dc6`;
export const GOLD_ART = [BG, BTN, ARROW];

export type GoldKind = 'drop' | 'deposit' | 'withdraw';
const PROMPT: Record<GoldKind, string> = { drop: 'strDropGoldHowMuch', deposit: 'strBankGoldDeposit', withdraw: 'strBankGoldWithdraw' };
const L = {
  w: 210, h: 158,
  field: { x: 29, y: 67, w: 168, h: 25 },
  up: { x: 184, y: 67, w: 12, h: 13 }, down: { x: 184, y: 79, w: 12, h: 13 },
  ok: { x: 35, y: 116, w: 32, h: 32 }, cancel: { x: 141, y: 116, w: 32, h: 32 },
} as const;

export class GoldPopup {
  kind: GoldKind | null = null;
  value = 0;
  max = 0;
  private x = 0;
  private y = 200;
  private readonly art: UiArt;
  private readonly layer: HotLayer;
  private readonly str: (k: string) => string;
  private readonly onConfirm: (kind: GoldKind, amount: number) => void;
  private pressed: 'up' | 'down' | 'ok' | 'cancel' | null = null;

  constructor(stage: HTMLElement, art: UiArt, str: (k: string) => string, onConfirm: (kind: GoldKind, amount: number) => void) {
    this.art = art;
    this.str = str;
    this.onConfirm = onConfirm;
    void art.preload(GOLD_ART);
    this.layer = new HotLayer(stage, 'goldpopup', { x: 0, y: 0, w: 800, h: 600 });
    // 창 밖 클릭은 삼킨다 (원작: 창이 떠 있는 동안 다른 조작 없음)
    this.layer.root.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  get open(): boolean {
    return this.kind !== null;
  }

  /** 창 열기. panelX = 창을 띄울 패널 왼쪽 (인벤토리 400, 보관함 80) */
  show(kind: GoldKind, max: number, panelX: number): void {
    this.kind = kind;
    this.max = Math.max(0, Math.floor(max));
    this.value = this.max;
    this.x = panelX + Math.round((320 - L.w) / 2);
    this.layer.visible = true;
    const btn = (k: 'up' | 'down' | 'ok' | 'cancel', r: { x: number; y: number; w: number; h: number }, fn: () => void, label: string) => {
      const el = this.layer.button(k, this.abs(r), fn, { id: `gold-${k}` }, label);
      el.onmousedown = () => (this.pressed = k);
      el.onmouseup = el.onmouseleave = () => (this.pressed = null);
    };
    // 숫자 칸 (화살표 왼쪽까지)
    this.layer.button('field', this.abs({ ...L.field, w: L.up.x - L.field.x - 2 }), () => undefined, { id: 'gold-field' }, 'Gold');
    btn('up', L.up, () => this.set(this.value + 1), 'Up');
    btn('down', L.down, () => this.set(this.value - 1), 'Down');
    btn('ok', L.ok, () => this.confirm(), 'OK');
    btn('cancel', L.cancel, () => this.hide(), 'Cancel');
  }

  hide(): void {
    this.kind = null;
    this.pressed = null;
    this.layer.visible = false;
  }

  private abs(r: { x: number; y: number; w: number; h: number }): HRect {
    return { x: this.x + r.x, y: this.y + r.y, w: r.w, h: r.h };
  }

  set(v: number): void {
    this.value = Math.max(0, Math.min(this.max, Math.floor(v) || 0));
  }

  confirm(): void {
    const k = this.kind, v = this.value;
    this.hide();
    if (k && v > 0) this.onConfirm(k, v);
  }

  /** 키보드 (열려 있으면 모든 키를 먹는다) */
  key(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (e.key >= '0' && e.key <= '9') this.set(Number(`${this.value === 0 ? '' : this.value}${e.key}`));
    else if (e.key === 'Backspace') this.set(Math.floor(this.value / 10));
    else if (e.key === 'ArrowUp') this.set(this.value + 1);
    else if (e.key === 'ArrowDown') this.set(this.value - 1);
    else if (e.key === 'Enter') this.confirm();
    else if (e.key === 'Escape') this.hide();
    e.preventDefault();
    return true;
  }

  /** e2e: 단추 가운데 */
  center(k: 'up' | 'down' | 'ok' | 'cancel'): { x: number; y: number } {
    const r = this.abs(L[k]);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.kind) return;
    const a = this.art, x = this.x, y = this.y;
    if (!a.draw(ctx, BG, 0, x, y)) {
      ctx.fillStyle = 'rgba(10,10,10,0.95)';
      ctx.fillRect(x, y, L.w, L.h);
    }
    const lines = d2text.wrap(this.str(PROMPT[this.kind]), L.w - 24);
    const lh = d2text.lineHeight('font16');
    const top = y + 8 + Math.max(0, (56 - lines.length * lh) / 2);
    lines.forEach((l, i) => drawText(ctx, l, x + L.w / 2, top + i * lh, { align: 'center' }));
    drawText(ctx, String(this.value), x + L.field.x + (L.field.w - 16) / 2, y + L.field.y + 5, { align: 'center' });
    a.draw(ctx, ARROW, this.pressed === 'up' ? 11 : 9, x + L.up.x, y + L.up.y);
    a.draw(ctx, ARROW, this.pressed === 'down' ? 10 : 8, x + L.down.x, y + L.down.y);
    a.draw(ctx, BTN, this.pressed === 'ok' ? 17 : 16, x + L.ok.x, y + L.ok.y);
    a.draw(ctx, BTN, this.pressed === 'cancel' ? 11 : 10, x + L.cancel.x, y + L.cancel.y);
  }

  dispose(): void {
    this.layer.dispose();
  }
}
