// 클릭 상자 고르기: 정확히 가리킨 상자가 먼저, 없으면 가까운 몬스터 (조준 보조)
// 원작과 다름(사용자 요청): 원작은 몬스터 상자를 정확히 가리켜야 공격 — 여기서는 상자 가장자리에서 ASSIST_PX 안이면 그 몬스터
import type { Hover } from './mapper';

export interface PickBox { kind: 'monster' | 'item' | 'corpse' | 'body' | 'object' | 'npc'; id: number; x: number; y: number; w: number; h: number }

/** 조준 보조 반경 (캔버스 px, 800×600 기준). 근사: 몬스터 상자 폭(40)과 같은 거리 */
export const ASSIST_PX = 40;

export function pickAt(boxes: readonly PickBox[], x: number, y: number): Hover {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i] as PickBox;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { kind: b.kind, id: b.id };
  }
  // 보조는 살아 있는 몬스터만 (NPC·아이템·오브젝트·시체는 정확히 가리켜야)
  let best: PickBox | null = null;
  let bestD = ASSIST_PX * ASSIST_PX;
  for (const b of boxes) {
    if (b.kind !== 'monster') continue;
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      best = b;
      bestD = d;
    }
  }
  return best ? { kind: 'monster', id: best.id } : null;
}
