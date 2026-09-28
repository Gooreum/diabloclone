// 등각 좌표 변환. 월드 = 서브타일, 서브타일 = 32×16 픽셀 마름모, 타일 = 5×5 서브타일 = 160×80.
// 출처: Phrozen Keep KB a=463 — 서브타일 32×16px, 타일 160×80px

export const worldToScreen = (x: number, y: number): { x: number; y: number } => ({ x: (x - y) * 16, y: (x + y) * 8 });

export const screenToWorld = (sx: number, sy: number): { x: number; y: number } => ({ x: sy / 16 + sx / 32, y: sy / 16 - sx / 32 });

export interface Camera { x: number; y: number; width: number; height: number }

/** 월드 좌표 → 캔버스 좌표 (카메라 중심 = 화면 중앙) */
export function toCanvas(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  const s = worldToScreen(wx, wy), c = worldToScreen(cam.x, cam.y);
  return { x: Math.round(s.x - c.x + cam.width / 2), y: Math.round(s.y - c.y + cam.height / 2) };
}

export function fromCanvas(cam: Camera, cx: number, cy: number): { x: number; y: number } {
  const c = worldToScreen(cam.x, cam.y);
  return screenToWorld(cx - cam.width / 2 + c.x, cy - cam.height / 2 + c.y);
}
