// 좌표계: 월드 좌표는 서브타일 단위 (1 타일 = 5×5 서브타일).
// 출처: Phrozen Keep KB — "Calculating Missile Distance": 서브타일 32×16px, 야드 48×24px, 타일 160×80px
//       → 1 야드 = 1.5 서브타일 (https://d2mods.info/forum/kb/viewarticle?a=463)

export interface Pt { x: number; y: number }

export const SUBTILES_PER_TILE = 5;
export const SUBTILES_PER_YARD = 1.5;

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 이동 벡터(월드 서브타일) → 64방향 인덱스. 0 = 화면 남쪽(아래), 시계 방향(남→남서→서→북서→북 …)으로 5.625°씩 증가.
 * 출처: OpenDiablo2 d2dcc/dcc_dir_lookup.go Dir64ToDcc — 64방향 테이블의 0번이 DCC 8방향 4(남), 이후 0(남서)·5(서)·1(북서)… 순서
 *       (https://github.com/OpenDiablo2/OpenDiablo2)
 */
export function dir64(dx: number, dy: number): number {
  const sx = (dx - dy) * 16; // 서브타일 → 화면 픽셀 (32×16 등각)
  const sy = (dx + dy) * 8;
  const a = Math.atan2(sy, sx) - Math.PI / 2; // 화면 아래 = 0
  const idx = Math.round(a / ((Math.PI * 2) / 64));
  return ((idx % 64) + 64) % 64;
}
