// 비: levels.txt Rain = 1 인 레벨(Act 1 마을·야외·묘지·트리스트럼, Act 3 마을·정글·쿠라스트·트라빈칼)에서 가끔 온다.
// 출처: levels.txt Rain, sounds.txt scene_rain
// 근사(원작 미확인): 비가 오고 그치는 때와 빗줄기 모양은 클라이언트(D2Client) 몫이라 공개 소스가 없다.
//   - 비 옴/그침: 게임 시드로 정한 1~4분 간격으로 번갈아 (처음에는 그친 상태로 시작)
//   - 빗줄기: 비스듬히 떨어지는 짧은 선 DROPS 개 (파란 회색 반투명)

/** 빗줄기 수 */
export const DROPS = 150;
const MIN_MS = 60_000, MAX_MS = 240_000;

export class Rain {
  private state: number;
  private on = false;
  /** 다음 바뀜 시각 (ms, 0 = 아직 시작 안 함) */
  private next = 0;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** 0 이상 1 미만 난수 (xorshift32) */
  private rand(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }

  private span(): number {
    return MIN_MS + Math.floor(this.rand() * (MAX_MS - MIN_MS));
  }

  /** 지금 비가 오는지. 비 오는 레벨이 아니면 항상 false (시간은 계속 흐른다) */
  active(rainLevel: boolean, now: number): boolean {
    if (!this.next) this.next = now + this.span();
    while (now >= this.next) {
      this.on = !this.on;
      this.next += this.span();
    }
    return rainLevel && this.on;
  }

  /** 테스트·디버그: 비를 켜고 끈다 (다음 바뀜까지 유지) */
  force(on: boolean, now: number): void {
    this.on = on;
    this.next = now + this.span();
  }

  /** 빗줄기 (월드 위, UI 패널 아래 — 그리는 쪽이 순서를 정한다) */
  draw(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(150, 160, 190, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const t = now / 1000;
    for (let i = 0; i < DROPS; i++) {
      // 빗줄기마다 고정 시작점·속도 (정수 해시)
      const a = Math.imul(i + 1, 2654435761) >>> 0, b = Math.imul(i + 7, 40503) >>> 0;
      const speed = 520 + (b % 260);
      const y = ((a % h) + t * speed) % (h + 40) - 20;
      const x = (((b % w) - t * speed * 0.35) % w + w) % w;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + 14);
    }
    ctx.stroke();
    ctx.restore();
  }
}
