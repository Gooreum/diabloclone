// 게임 속 메시지 (왼쪽 위): 신전 문구(string.tbl ShrMsg*), 퀘스트 알림(qstsa1q14 "Monsters remaining: " …), 잠긴 상자 등.
// 원작: 아이템 줍기는 글로 나오지 않는다. 새 메시지는 아래에 쌓이고 잠시 뒤 흐려지며 사라진다. 원작 글꼴 font16.
// 근사(원작 미확인): 위치(10,10 — 용병 초상이 있으면 그 오른쪽), 보이는 시간 6초 + 흐려지는 1초, 최대 5줄, 기본 색 흰색(퀘스트 = 금색)
import type { TextColor } from './text';
import { d2text, drawText } from './text';

export interface LogLine { text: string; color: TextColor; at: number }

const SHOW_MS = 6000, FADE_MS = 1000, MAX = 5;

export class MessageLog {
  lines: LogLine[] = [];

  push(text: string, now: number, color: TextColor = 'white'): void {
    if (!text) return;
    for (const t of text.split('\n')) if (t.trim()) this.lines.push({ text: t, color, at: now });
    while (this.lines.length > MAX) this.lines.shift();
  }

  clear(): void {
    this.lines = [];
  }

  /** 지금 보이는 줄 (e2e) */
  visible(now: number): LogLine[] {
    return this.lines.filter((l) => now - l.at < SHOW_MS + FADE_MS);
  }

  draw(ctx: CanvasRenderingContext2D, now: number, x = 10, y = 10): void {
    this.lines = this.visible(now);
    const lh = d2text.lineHeight('font16');
    this.lines.forEach((l, i) => {
      const age = now - l.at;
      const alpha = age < SHOW_MS ? 1 : Math.max(0, 1 - (age - SHOW_MS) / FADE_MS);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawText(ctx, l.text, x, y + i * lh, { color: l.color });
      ctx.restore();
    });
  }
}
