// 입력 → 명령 매핑 (순수 함수). DOM 이벤트 처리는 input/dom.ts 가 담당.
// 원작 조작: 좌클릭 = 이동/공격/줍기, Shift+좌클릭 = 제자리 공격(왼쪽 스킬), 우클릭 = 오른쪽 스킬, R = 달리기/걷기 전환
// 출처: Diablo II 게임 매뉴얼 — Controls (좌클릭 이동·공격, Shift 제자리 공격, 우클릭 스킬, R 달리기 토글)
import type { Command } from '../engine/command';

/** body = 플레이어 자신의 시체 */
/** object = 상자·문·신전·웨이포인트·포털 등 */
export type Hover = { kind: 'monster' | 'item' | 'corpse' | 'body' | 'object'; id: number } | null;

export interface PointerInput {
  worldX: number; worldY: number; shift: boolean; hover: Hover; run: boolean;
  /** 왼쪽 버튼 스킬 Id (0 = Attack) */
  leftSkill?: number;
}

export function mapLeftClick(p: PointerInput): Command | null {
  if (p.hover?.kind === 'monster') return { type: 'attack', targetId: p.hover.id, standStill: p.shift };
  if (p.hover?.kind === 'item') return { type: 'pickup', itemId: p.hover.id };
  // 원작: 자기 시체를 클릭하면 걸어가서 장비를 되찾는다
  if (p.hover?.kind === 'body') return { type: 'takeCorpse' };
  // 원작: 오브젝트를 클릭하면 걸어가서 조작 (상자 열기, 문 여닫기, 신전·우물·웨이포인트·포털)
  if (p.hover?.kind === 'object') return { type: 'interact', unitId: p.hover.id };
  // Shift + 바닥: 왼쪽 스킬을 그 지점에 (Attack 이면 아무 일 없음)
  if (p.shift) return p.leftSkill ? { type: 'useSkill', skill: p.leftSkill, hand: 'left', x: p.worldX, y: p.worldY } : null;
  return { type: 'move', x: p.worldX, y: p.worldY, run: p.run };
}

/** 우클릭 = 오른쪽 스킬을 커서 위치(몬스터·시체 위면 그 대상, 바닥 아이템 위면 아이템 — Telekinesis)에 */
export function mapRightClick(p: PointerInput & { rightSkill: number }): Command {
  const base = { type: 'useSkill' as const, skill: p.rightSkill, hand: 'right' as const, x: p.worldX, y: p.worldY };
  if (p.hover?.kind === 'item') return { ...base, targetItem: p.hover.id };
  return p.hover ? { ...base, targetId: p.hover.id } : base;
}
