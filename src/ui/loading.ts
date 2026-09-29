// 원작 로딩 화면: data\global\ui\Loading\loadingscreen.dc6 (10프레임 256×256, "LOADING..." 문 열리는 그림), 팔레트 data\global\palette\loading\pal.dat.
// 원작(싱글 플레이): 게임 시작 때, 그리고 계단·입구·웨이포인트·포털로 다른 레벨에 들어갈 때 잠깐 검은 화면 가운데에 보인다.
// 근사(원작 미확인): 프레임 진행 = 시간 기준 초당 20프레임(원작은 읽기 진행률), 마지막 프레임에서 멈춤, 레벨 이동 때 보이는 시간 350ms,
//   화면 가운데 배치 (272, 172)
import { UI, type UiArt } from './art';

export const LOADING = `${UI}Loading\\loadingscreen.dc6`;
const FPS = 20;

export class LoadingScreen {
  private readonly art: UiArt;
  private start = 0;
  private until = 0;

  constructor(art: UiArt) {
    this.art = art;
    void art.load(LOADING);
  }

  get ready(): boolean {
    return !!this.art.frames(LOADING);
  }

  /** 지금 보이는가 (레벨 이동 때 잠깐) */
  active(now: number): boolean {
    return now < this.until;
  }

  /** 레벨 이동: ms 동안 게임 위에 로딩 화면 */
  flash(now: number, ms = 350): void {
    this.start = now;
    this.until = now + ms;
  }

  /** 한 장 그리기 (검은 화면 + 가운데 그림). t = 시작 뒤 흐른 ms */
  drawAt(ctx: CanvasRenderingContext2D, t: number): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 800, 600);
    const n = this.art.frames(LOADING)?.length ?? 10;
    this.art.draw(ctx, LOADING, Math.min(n - 1, Math.floor((t * FPS) / 1000)), 272, 172);
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.active(now)) this.drawAt(ctx, now - this.start);
  }

  /**
   * 무거운 동기 작업 앞뒤로 로딩 화면: 그림을 읽고, 최소 minMs 동안 애니메이션을 돌린 뒤 화면을 한 번 그리고 work 를 부른다.
   * (월드 만들기는 동기라 도중에는 화면이 멈춘다 — 마지막 프레임이 남는다)
   */
  async around<T>(ctx: CanvasRenderingContext2D, work: () => T, minMs = 700): Promise<T> {
    await Promise.race([this.art.load(LOADING), new Promise((r) => setTimeout(r, 1500))]);
    const t0 = performance.now();
    window.__loading = true;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        this.drawAt(ctx, now - t0);
        if (now - t0 >= minMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // 마지막 그림이 화면에 올라간 뒤 무거운 작업
    await new Promise((r) => setTimeout(r, 0));
    try {
      return work();
    } finally {
      window.__loading = false;
    }
  }
}

declare global {
  interface Window {
    /** e2e: 게임 시작 로딩 화면이 떠 있는가 */
    __loading?: boolean;
  }
}
