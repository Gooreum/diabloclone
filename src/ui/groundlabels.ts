// 바닥 아이템 이름표: Alt(단축키 Show Items)를 누르고 있으면 화면의 모든 바닥 아이템 이름, 아니면 마우스를 올린 아이템 이름만.
// 원작: 반투명 검은 상자 + font16 이름(아이템 품질 색 — 흰색 보통, 파랑 매직, 노랑 레어, 금색 유니크, 초록 세트, 회색 하급·소켓),
//   가리킨 이름표는 파란 바탕, 이름표를 눌러도 줍는다. 이름표끼리 겹치면 위로 비켜 쌓는다.
// 근사(원작 미확인): 상자 여백(좌우 4, 위아래 1), 바탕 투명도, 가리킨 바탕 파랑 rgba(20,40,150), 이름표 위치(아이템 그림 위쪽 끝 바로 위), 비켜 쌓는 순서(화면 아래쪽 아이템 먼저)
import type { PickBox } from '../input/dom';
import { d2text, drawText } from './text';

export interface GroundLabel { id: number; text: string; color: string; x: number; y: number }
export interface LabelRect { id: number; x: number; y: number; w: number; h: number }

/** 이름표 자리 잡기 (겹치면 위로) */
export function layoutLabels(list: GroundLabel[], width: (t: string) => number, lh: number): LabelRect[] {
  const out: LabelRect[] = [];
  const sorted = [...list].sort((a, b) => b.y - a.y);
  for (const l of sorted) {
    const w = width(l.text) + 8, h = lh + 2;
    const r = { id: l.id, x: Math.round(l.x - w / 2), y: Math.round(l.y - h), w, h };
    for (let guard = 0; guard < 40; guard++) {
      const hit = out.find((o) => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);
      if (!hit) break;
      r.y = hit.y - h - 1;
    }
    out.push(r);
  }
  return out;
}

/** 이름표 그리기 → 마우스 아래 이름표 아이템 Id. picks 에 이름표 클릭 상자(아이템)를 더한다 */
export function drawGroundLabels(ctx: CanvasRenderingContext2D, list: GroundLabel[], mouse: { x: number; y: number } | null, picks: PickBox[]): number | null {
  const lh = d2text.lineHeight('font16');
  const rects = layoutLabels(list, (t) => d2text.width(t), lh);
  let hover: number | null = null;
  for (const r of rects) if (mouse && mouse.x >= r.x && mouse.y >= r.y && mouse.x < r.x + r.w && mouse.y < r.y + r.h) hover = r.id;
  for (const r of rects) {
    const l = list.find((q) => q.id === r.id);
    if (!l) continue;
    ctx.fillStyle = r.id === hover ? 'rgba(20,40,150,0.85)' : 'rgba(0,0,0,0.65)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    drawText(ctx, l.text, r.x + r.w / 2, r.y + 1, { align: 'center', color: l.color as `#${string}` });
    // 이름표 클릭 = 줍기 (뒤에 넣은 상자가 먼저 잡힌다)
    picks.push({ kind: 'item', id: r.id, x: r.x, y: r.y, w: r.w, h: r.h });
  }
  return hover;
}
