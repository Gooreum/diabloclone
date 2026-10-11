/** 고정 크기 무대(D2 800×600, D1 640×480)를 창 크기에 맞춰 키운다 (비율 유지, 가운데). 게임 안 좌표는 그대로 — 입력은 화면 크기에서 환산 */
export function fitStage(stage: HTMLElement, w: number, h: number): void {
  const s = Math.min(innerWidth / w, innerHeight / h);
  Object.assign(stage.style, {
    position: 'absolute', transformOrigin: '0 0', transform: `scale(${s})`,
    left: `${Math.round((innerWidth - w * s) / 2)}px`, top: `${Math.round((innerHeight - h * s) / 2)}px`,
  });
}
