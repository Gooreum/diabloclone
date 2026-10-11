// 원작 채팅 (Configure Controls "Chat", 기본 Enter — string.tbl StrHelp7 "Hit <Enter> to go into chat mode").
// 입력 줄에 쓰고 Enter 로 보내면 왼쪽 위 메시지(이름: 글)와 캐릭터 머리 위에 글이 뜬다. Esc 는 취소.
// 근사(원작 미확인): 입력 줄 위치(왼쪽 아래 조작판 위), 머리 위 글 위치·보이는 시간(5초), 최대 글자 수
// 원작과 다름: 채팅 명령(/players 등)은 아직 없다 — 글로만 보낸다
import { drawText } from './text';

const MAX_LEN = 90, OVERHEAD_MS = 5000;

export class ChatInput {
  private readonly input: HTMLInputElement;
  private overheadText = '';
  private overheadAt = -Infinity;
  /** 보내면 (main 이 메시지 로그에) */
  onSend: ((text: string) => void) | null = null;

  constructor(stage: HTMLElement) {
    const el = document.createElement('input');
    el.id = 'chat-input';
    el.maxLength = MAX_LEN;
    el.autocomplete = 'off';
    el.spellcheck = false;
    // 글자는 캔버스에 원작 글꼴로, 입력칸은 투명 (한글 입력을 받으려고 실제 입력칸을 쓴다)
    Object.assign(el.style, { position: 'absolute', left: '20px', top: '492px', width: '560px', height: '20px', background: 'transparent', border: '0', outline: 'none', color: 'transparent', caretColor: 'transparent', font: '14px serif', display: 'none', zIndex: '5' });
    // 채팅 중 키는 게임으로 보내지 않는다 (I 를 쳐도 인벤토리가 열리지 않게)
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.altKey) {
        e.preventDefault();
        const t = el.value.trim();
        this.close();
        if (t) this.send(t);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    el.addEventListener('blur', () => this.close());
    stage.append(el);
    this.input = el;
  }

  get open(): boolean {
    return this.input.style.display !== 'none';
  }

  get text(): string {
    return this.input.value;
  }

  start(): void {
    this.input.value = '';
    this.input.style.display = 'block';
    this.input.focus();
  }

  close(): void {
    if (!this.open) return;
    this.input.style.display = 'none';
    this.input.value = '';
    this.input.blur();
  }

  private send(text: string): void {
    this.overheadText = text;
    this.overheadAt = performance.now();
    this.onSend?.(text);
  }

  /** 입력 줄 (열려 있을 때) */
  draw(ctx: CanvasRenderingContext2D, now: number, name: string): void {
    if (!this.open) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(14, 490, 572, 22);
    const caret = Math.floor(now / 400) % 2 ? '_' : '';
    drawText(ctx, `${name}: ${this.input.value}${caret}`, 20, 494, { color: 'white' });
    ctx.restore();
  }

  /** 머리 위 글 (보낸 뒤 잠시). 근사: 플레이어는 화면 가운데 — 그 위 */
  drawOverhead(ctx: CanvasRenderingContext2D, now: number, x = 400, y = 212): void {
    if (now - this.overheadAt > OVERHEAD_MS || !this.overheadText) return;
    drawText(ctx, this.overheadText, x, y, { align: 'center', color: 'white' });
  }

  dispose(): void {
    this.input.remove();
  }
}
