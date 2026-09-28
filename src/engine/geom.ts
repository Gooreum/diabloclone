// 좌표계: 월드 좌표는 서브타일 단위 (1 타일 = 5×5 서브타일).
// 출처: Phrozen Keep KB — "Calculating Missile Distance": 서브타일 32×16px, 야드 48×24px, 타일 160×80px
//       → 1 야드 = 1.5 서브타일 (https://d2mods.info/forum/kb/viewarticle?a=463)

export interface Pt { x: number; y: number }

export const SUBTILES_PER_TILE = 5;
export const SUBTILES_PER_YARD = 1.5;

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 이동 벡터 → 방향 인덱스. 화면(등각) 기준 각도로 계산한다.
 * 16방향 기준 0 = 남서(↙) 시작은 원작 COF 방향 순서가 확정되면 렌더 단계에서 매핑한다 (여기선 각도만 양자화).
 */
export function angleIndex(dx: number, dy: number, directions: number): number {
  const sx = (dx - dy) * 16; // 서브타일 → 화면 픽셀 (32×16 등각)
  const sy = (dx + dy) * 8;
  const a = Math.atan2(sy, sx); // 화면 기준 각도
  const step = (Math.PI * 2) / directions;
  return ((Math.round(a / step) % directions) + directions) % directions;
}
