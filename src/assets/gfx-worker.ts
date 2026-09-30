// 웹 워커: MPQ 블록 해제와 DCC 방향 해석을 메인(게임) 스레드 밖에서 한다.
// 새 몬스터·스킬이 처음 나올 때 압축 풀기·애니메이션 해석 동안 화면이 멈칫하던 것을 없앤다.
// DCC 는 필요한 방향만 해석한다: 해제한 원본을 워커가 기억해 두고(LRU), 방향 요청이 오면 그 방향만 푼다.
import { parseDccDirection, parseDccHeader, type DccDirection, type DccHeader } from '../formats/dcc';
import { decodeBlock, type MpqBlockEntry } from '../formats/mpq';

export interface RawBlock { raw: Uint8Array; block: MpqBlockEntry; sectorSize: number; path: string }
export type GfxRequest =
  | ({ id: number; kind: 'file' } & RawBlock)
  | ({ id: number; kind: 'dccHeader'; key: string } & RawBlock)
  | { id: number; kind: 'dccDir'; key: string; dir: number };
export type GfxResponse =
  | { id: number; ok: true; bytes?: Uint8Array; header?: { directions: number; framesPerDirection: number }; direction?: DccDirection }
  | { id: number; ok: false; error: string; missing?: boolean };

/** 해제한 DCC 원본 기억 (워커 안, 바이트 합 상한) */
export class DccStore {
  private readonly map = new Map<string, { buf: Uint8Array; h: DccHeader }>();
  private total = 0;
  private readonly budget: number;

  constructor(budgetBytes = 64_000_000) {
    this.budget = budgetBytes;
  }

  put(key: string, buf: Uint8Array, h: DccHeader): void {
    const old = this.map.get(key);
    if (old) this.total -= old.buf.length;
    this.map.delete(key);
    this.map.set(key, { buf, h });
    this.total += buf.length;
    for (const [k, v] of this.map) {
      if (this.total <= this.budget || k === key) break;
      this.map.delete(k);
      this.total -= v.buf.length;
    }
  }

  get(key: string): { buf: Uint8Array; h: DccHeader } | undefined {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  get bytes(): number {
    return this.total;
  }
}

/** 요청 하나 처리 (워커와, 워커를 못 쓸 때 메인 스레드가 같이 쓴다) */
export function handleGfx(req: GfxRequest, store: DccStore): GfxResponse {
  try {
    if (req.kind === 'file') return { id: req.id, ok: true, bytes: decodeBlock(req.raw, req.block, req.sectorSize, req.path) };
    if (req.kind === 'dccHeader') {
      const buf = decodeBlock(req.raw, req.block, req.sectorSize, req.path);
      const h = parseDccHeader(buf);
      store.put(req.key, buf, h);
      return { id: req.id, ok: true, header: { directions: h.directions, framesPerDirection: h.framesPerDirection } };
    }
    const hit = store.get(req.key);
    if (!hit) return { id: req.id, ok: false, error: `dcc not loaded: ${req.key}`, missing: true };
    if (req.dir < 0 || req.dir >= hit.h.directions) return { id: req.id, ok: false, error: `dcc dir ${req.dir} out of range` };
    return { id: req.id, ok: true, direction: parseDccDirection(hit.buf, hit.h, req.dir) };
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 응답의 픽셀 버퍼 (복사 없이 넘긴다) */
export function transferables(res: GfxResponse): ArrayBuffer[] {
  if (!res.ok) return [];
  if (res.bytes) return [res.bytes.buffer as ArrayBuffer];
  if (res.direction) return [...new Set(res.direction.frames.map((f) => f.pixels.buffer as ArrayBuffer))];
  return [];
}

// 워커 문맥에서만 메시지 처리 (메인 스레드에서 import 해도 부작용 없음)
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; postMessage?: (m: unknown, t: Transferable[]) => void; onmessage?: unknown };
if (typeof scope.WorkerGlobalScope !== 'undefined' && typeof scope.postMessage === 'function') {
  const post = scope.postMessage.bind(globalThis);
  const store = new DccStore();
  scope.onmessage = (ev: MessageEvent<GfxRequest>) => {
    const res = handleGfx(ev.data, store);
    post(res, transferables(res));
  };
}
