// 사각형 모으기 (GL 없는 순수 계산): 같은 (페이지, 혼합) 이 이어지는 동안 정점을 모으고, 바뀌면 내보낸다.
// 그리는 순서는 넣은 순서 그대로 (깊이 정렬은 호출한 쪽이 이미 했다).

/** 정점 하나: x, y (화면 px), u, v (아틀라스 텍셀), row (색 바꿈 표 줄), bright, ax, ay (빛을 재는 화면 점 — NO_ANCHOR 면 픽셀마다) */
export const FLOATS_PER_VERTEX = 8;
/** 빛 기준점 없음 (바닥 타일: 픽셀마다 빛 지도를 읽는다) */
export const NO_ANCHOR = -1e5;
/** 그림자 혼합 번호 (검정 반투명) */
export const SHADOW_BLEND = 7;
/** 근사(원작 미확인): 그림자 모양 — 발밑 기준 높이 ½, 위쪽을 높이의 ½ 만큼 왼쪽으로 기울임 */
export const SHADOW_SCALE_Y = 0.5, SHADOW_SKEW = 0.5;
const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * 6;

export type FlushFn = (page: number, blend: number, data: Float32Array, vertices: number) => void;

export class QuadBatch {
  private data = new Float32Array(FLOATS_PER_QUAD * 1024);
  private n = 0;
  private page = -1;
  private blend = -1;
  private readonly onFlush: FlushFn;

  constructor(onFlush: FlushFn) {
    this.onFlush = onFlush;
  }

  /** 혼합 번호 정리: 없음·범위 밖 = −1 (불투명), 5·6 = 3 (더하기), 7 = 그림자 */
  static normBlend(b: number | undefined): number {
    if (b === SHADOW_BLEND) return SHADOW_BLEND;
    if (b === undefined || b < 0 || b > 6) return -1;
    return b === 5 || b === 6 ? 3 : b;
  }

  /**
   * 사각형 하나. anchor = 빛을 재는 화면 점 (없으면 픽셀마다).
   * shadowAt = 그림자 기준(발밑) 화면 점: 주면 사각형을 발밑 기준으로 납작하게(½) 눕히고 위쪽을 왼쪽으로 기울인다.
   */
  push(page: number, blend: number, x: number, y: number, w: number, h: number, u: number, v: number, row: number, bright: number, anchor?: { x: number; y: number } | null, shadowAt?: { x: number; y: number } | null): void {
    if (this.n > 0 && (page !== this.page || blend !== this.blend)) this.flush();
    this.page = page;
    this.blend = blend;
    if ((this.n + 1) * FLOATS_PER_QUAD > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    const d = this.data;
    let o = this.n * FLOATS_PER_QUAD;
    const ax = anchor ? anchor.x : NO_ANCHOR, ay = anchor ? anchor.y : NO_ANCHOR;
    const put = (px: number, py: number, pu: number, pv: number) => {
      if (shadowAt) {
        const up = shadowAt.y - py;
        px -= up * SHADOW_SKEW;
        py = shadowAt.y - up * SHADOW_SCALE_Y;
      }
      d[o++] = px; d[o++] = py; d[o++] = pu; d[o++] = pv; d[o++] = row; d[o++] = bright; d[o++] = ax; d[o++] = ay;
    };
    // 두 삼각형 (좌상·우상·좌하, 우상·우하·좌하)
    put(x, y, u, v);
    put(x + w, y, u + w, v);
    put(x, y + h, u, v + h);
    put(x + w, y, u + w, v);
    put(x + w, y + h, u + w, v + h);
    put(x, y + h, u, v + h);
    this.n++;
  }

  flush(): void {
    if (this.n === 0) return;
    this.onFlush(this.page, this.blend, this.data.subarray(0, this.n * FLOATS_PER_QUAD), this.n * 6);
    this.n = 0;
  }
}
