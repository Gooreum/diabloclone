// 원작 마우스 커서 (data\global\ui\CURSOR\*.dc6): OS 커서를 숨기고 캔버스에 원작 손 그림을 그린다.
// 출처(그림): ohand.dc6 (8프레임 32×26, 오프셋 −1,24 → 손가락 끝이 기준점), protate.dc6 (8프레임, 누르고 있을 때 도는 손),
//   buysell.dc6 (10프레임 32×40: 1 = 망치(수리), 8 = 돋보기(감정) — 원작 파일 그림 확인)
// 커서 상태(원작): 보통 = 손, 누르는 동안 = 도는 손, 아이템을 들면 그 아이템 그림이 곧 커서(손은 그리지 않음), 감정 두루마리 = 돋보기, 수리 = 망치
// 근사(원작 미확인): 아이템·유닛 위에 올리면 손 애니메이션(ohand 8프레임)을 돌린다, 애니메이션 속도 초당 20프레임, 상점 사기/팔기 모드는 보통 손
import { UI, type UiArt } from './art';

export const CURSOR_DIR = `${UI}CURSOR\\`;
const OHAND = `${CURSOR_DIR}ohand.dc6`;
const PROTATE = `${CURSOR_DIR}protate.dc6`;
const BUYSELL = `${CURSOR_DIR}buysell.dc6`;
export const CURSOR_ART = [OHAND, PROTATE, BUYSELL];

export type CursorState = 'hand' | 'hover' | 'press' | 'item' | 'identify' | 'repair' | 'hidden';

const CSS = `#stage,#stage *{cursor:none!important}`;

/** 무대 위에서 OS 커서 숨기기 (원작처럼 게임이 그린 커서만 보인다) */
export function hideOsCursor(): void {
  if (typeof document === 'undefined' || document.getElementById('d2cursor-css')) return;
  const st = document.createElement('style');
  st.id = 'd2cursor-css';
  st.textContent = CSS;
  document.head.append(st);
}

export class GameCursor {
  /** 이번 프레임에 그린 상태 (e2e 확인용) */
  state: CursorState = 'hand';
  private down = false;
  private readonly off: (() => void)[] = [];

  constructor() {
    const dn = (e: MouseEvent) => (this.down = e.button === 0 || e.button === 2 ? true : this.down);
    const up = () => (this.down = false);
    window.addEventListener('mousedown', dn, true);
    window.addEventListener('mouseup', up, true);
    this.off.push(() => window.removeEventListener('mousedown', dn, true), () => window.removeEventListener('mouseup', up, true));
    hideOsCursor();
  }

  get pressed(): boolean {
    return this.down;
  }

  /** 상태 고르기: 들고 있는 아이템 > 감정/수리 > 누름 > 올림 > 보통 */
  pick(o: { holding: boolean; identify?: boolean; repair?: boolean; hover?: boolean }): CursorState {
    if (o.holding) return 'item';
    if (o.identify) return 'identify';
    if (o.repair) return 'repair';
    if (this.down) return 'press';
    return o.hover ? 'hover' : 'hand';
  }

  draw(ctx: CanvasRenderingContext2D, art: UiArt, mouse: { x: number; y: number } | null, state: CursorState, now: number): void {
    this.state = state;
    if (!mouse || state === 'item' || state === 'hidden') return;
    const f = Math.floor(now / 50) % 8;
    if (state === 'press') art.drawAnchored(ctx, PROTATE, f, mouse.x, mouse.y);
    else if (state === 'hover') art.drawAnchored(ctx, OHAND, f, mouse.x, mouse.y);
    else if (state === 'identify' || state === 'repair') {
      const fr = art.frame(BUYSELL, state === 'identify' ? 8 : 1);
      // 근사(원작 미확인): buysell 그림은 오프셋 0,0 — 왼쪽 위 끝을 기준점으로
      if (fr) ctx.drawImage(fr.img as CanvasImageSource, Math.round(mouse.x), Math.round(mouse.y));
    } else art.drawAnchored(ctx, OHAND, 0, mouse.x, mouse.y);
  }

  dispose(): void {
    for (const f of this.off.splice(0)) f();
  }
}
