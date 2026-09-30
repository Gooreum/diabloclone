// 그림 워커 연결: 요청을 워커로 보내고 응답을 기다린다. 워커를 못 쓰면 메인 스레드에서 같은 처리를 한다.
import type { DccDirection } from '../formats/dcc';
import { DccStore, handleGfx, type GfxRequest, type GfxResponse } from './gfx-worker';

type Req = GfxRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/** 필요한 방향만 해석하는 DCC (워커가 원본을 기억) */
export interface DccHandle {
  directions: number;
  framesPerDirection: number;
  /** 방향 하나 해석 (없거나 실패하면 null) */
  dir(d: number): Promise<DccDirection | null>;
}

export class GfxClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, (r: GfxResponse) => void>();
  /** 워커를 못 쓸 때 메인 스레드 저장소 */
  private readonly local = new DccStore();

  constructor(useWorker = typeof Worker !== 'undefined') {
    if (!useWorker) return;
    try {
      this.worker = new Worker(new URL('./gfx-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<GfxResponse>) => {
        const cb = this.waiting.get(ev.data.id);
        this.waiting.delete(ev.data.id);
        cb?.(ev.data);
      };
      this.worker.onerror = () => {
        // 워커가 죽으면 메인 스레드로 (기다리던 요청은 실패 — 호출한 쪽이 다시 읽는다)
        this.worker = null;
        for (const [id, cb] of this.waiting) cb({ id, ok: false, error: 'worker failed', missing: true });
        this.waiting.clear();
      };
    } catch {
      this.worker = null;
    }
  }

  get usingWorker(): boolean {
    return this.worker !== null;
  }

  request(r: Req): Promise<GfxResponse> {
    // 원본이 더 큰 버퍼의 일부면 복사해서 넘긴다 (넘긴 버퍼는 이쪽에서 못 쓰게 되므로)
    const own = 'raw' in r && r.raw.byteLength !== r.raw.buffer.byteLength ? { raw: r.raw.slice() } : {};
    const req = { ...r, ...own, id: this.nextId++ } as GfxRequest;
    const w = this.worker;
    if (!w) return Promise.resolve(handleGfx(req, this.local));
    return new Promise((resolve) => {
      this.waiting.set(req.id, resolve);
      // 원본 바이트는 워커로 넘긴다 (복사 없음)
      w.postMessage(req, 'raw' in req ? [req.raw.buffer as ArrayBuffer] : []);
    });
  }
}
