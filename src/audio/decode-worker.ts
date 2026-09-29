// 웹 워커: MPQ 블록(huffman + ADPCM) 해제 → WAV → 채널별 Float32. 음악(20MB 이상 WAV)도 메인 스레드를 멈추지 않게 한다.
import { decodeBlock, type MpqBlockEntry } from '../formats/mpq';
import { decodeWav } from '../formats/wav';

export interface DecodeRequest { id: number; raw: Uint8Array; block: MpqBlockEntry; sectorSize: number; path: string }
export type DecodeResponse =
  | { id: number; ok: true; sampleRate: number; channels: Float32Array[]; frames: number }
  | { id: number; ok: false; error: string };

export function decodeRequest(req: DecodeRequest): DecodeResponse {
  try {
    const wav = decodeWav(decodeBlock(req.raw, req.block, req.sectorSize, req.path));
    return { id: req.id, ok: true, sampleRate: wav.sampleRate, channels: wav.data, frames: wav.frames };
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// 워커 문맥에서만 메시지 처리 (메인 스레드에서 import 해도 부작용 없음)
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; postMessage?: (m: unknown, t: Transferable[]) => void; onmessage?: unknown };
if (typeof scope.WorkerGlobalScope !== 'undefined' && typeof scope.postMessage === 'function') {
  const post = scope.postMessage.bind(globalThis);
  scope.onmessage = (ev: MessageEvent<DecodeRequest>) => {
    const res = decodeRequest(ev.data);
    post(res, res.ok ? res.channels.map((c) => c.buffer as ArrayBuffer) : []);
  };
}
