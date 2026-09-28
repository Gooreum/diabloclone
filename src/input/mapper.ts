// 입력 → 명령 매핑 (순수 함수). DOM 이벤트 처리는 input/dom.ts 가 담당.
// 원작 조작: 좌클릭 = 이동/공격/줍기, Shift+좌클릭 = 제자리 공격, R = 달리기/걷기 전환
// 출처: Diablo II 게임 매뉴얼 — Controls (좌클릭 이동·공격, Shift 제자리 공격, R 달리기 토글)
import type { Command } from '../engine/command';

export type Hover = { kind: 'monster'; id: number } | { kind: 'item'; id: number } | null;

export interface PointerInput { worldX: number; worldY: number; shift: boolean; hover: Hover; run: boolean }

export function mapLeftClick(p: PointerInput): Command | null {
  if (p.hover?.kind === 'monster') return { type: 'attack', targetId: p.hover.id, standStill: p.shift };
  if (p.hover?.kind === 'item') return { type: 'pickup', itemId: p.hover.id };
  if (p.shift) return null;
  return { type: 'move', x: p.worldX, y: p.worldY, run: p.run };
}
