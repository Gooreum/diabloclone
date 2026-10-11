// 디아블로 1 워커: Devilution 웹 빌드(WASM)를 여기서 돌린다. 글루가 전역 self.DApi 를 부르고, 우리는 메인 스레드에 메시지로 넘긴다.
// 출처: src/d1/vendor/Diablo.jscc — _api_*(…) → self.DApi.*(…), export _DApi_Init/_DApi_Render/_DApi_Mouse/_DApi_Key/_DApi_Char/_DApi_SyncText
import type { D1Event, FromWorker, Frame, ToWorker } from './protocol';

/** Emscripten 모듈에서 쓰는 것만 */
interface Wasm {
  HEAPU8: Uint8Array;
  _DApi_Init(now: number, offscreen: number, major: number, minor: number, patch: number): void;
  _DApi_Render(now: number): void;
  _DApi_Mouse(action: number, button: number, mods: number, x: number, y: number): void;
  _DApi_Key(action: number, mods: number, vk: number): void;
  _DApi_Char(code: number): void;
  _DApi_SyncTextPtr(): number;
  _DApi_SyncText(flags: number): void;
  _SNet_WebsocketStatus(code: number): void;
}
type Factory = (opts: { wasmBinary: ArrayBuffer }) => { ready: Promise<Wasm> };

/** 원작 틱: 50ms (20fps) 마다 한 프레임 */
const TICK_MS = 50;
/** 멀티플레이 미지원 — 웹소켓이 바로 닫힌 것(1006, abnormal closure)으로 알린다 */
const WS_CLOSED = 1006;

// 워커 전역 (tsconfig lib 은 DOM 이라 webworker 타입을 섞지 않는다 — 섞으면 전역 Event 타입이 바뀐다)
const scope = self as unknown as { postMessage(m: unknown, t: Transferable[]): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null; close(): void };
const post = (m: FromWorker, transfer: Transferable[] = []): void => scope.postMessage(m, transfer);

let files = new Map<string, Uint8Array>();
let wasm: Wasm | null = null;
let spawn = false;
let frame: Frame | null = null;
let timer = 0;

const saveName = (id: number): string | null => (id < 0 ? null : spawn ? `spawn${id}.sv` : `single_${id}.sv`);

function fail(e: unknown): void {
  clearInterval(timer);
  const err = e instanceof Error ? e : new Error(String(e));
  post({ type: 'error', message: err.message, stack: err.stack });
}

function guarded(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    fail(e);
  }
}

/** 글루(C 쪽)가 부르는 전역 DApi */
const DApi = {
  exit_error(message: string): void {
    throw new Error(message);
  },
  exit_game(): void {
    clearInterval(timer);
    post({ type: 'exit' });
  },
  current_save_id(id: number): void {
    post({ type: 'save', name: saveName(id) });
  },

  // ---- 파일 (MPQ 는 통째로 메모리에, 세이브·설정은 메인이 IndexedDB 에 보관)
  get_file_size(path: string): number {
    return files.get(path.toLowerCase())?.byteLength ?? 0;
  },
  get_file_contents(path: string, out: Uint8Array, offset: number): void {
    const d = files.get(path.toLowerCase());
    if (d) out.set(d.subarray(offset, offset + out.byteLength));
  },
  put_file_contents(path: string, data: Uint8Array): void {
    const name = path.toLowerCase();
    files.set(name, data);
    const copy = data.slice();
    post({ type: 'file', op: 'put', name, data: copy }, [copy.buffer]);
  },
  remove_file(path: string): void {
    const name = path.toLowerCase();
    files.delete(name);
    post({ type: 'file', op: 'remove', name });
  },

  // ---- 커서·키보드
  set_cursor(x: number, y: number): void {
    post({ type: 'cursor', x, y });
  },
  open_keyboard(x0: number, y0: number, x1: number, y1: number, max: number): void {
    post({ type: 'keyboard', rect: [x0, y0, x1, y1, max] });
  },
  close_keyboard(): void {
    post({ type: 'keyboard', rect: null });
  },

  // ---- 네트워크 (미지원)
  use_websocket(on: number): void {
    if (on) wasm?._SNet_WebsocketStatus(WS_CLOSED);
  },
  websocket_closed(): boolean {
    return true;
  },
  websocket_send(): void {},

  // ---- 그리기: 한 프레임의 blit 들을 모아 한 번에 보낸다 (HEAP 조각은 복사해서 transfer)
  draw_begin(): void {
    frame = { blits: [], texts: [], clip: null };
  },
  draw_blit(x: number, y: number, w: number, h: number, rgba: Uint8Array): void {
    frame?.blits.push({ x, y, w, h, rgba: new Uint8ClampedArray(rgba) });
  },
  draw_clip_text(x0: number, y0: number, x1: number, y1: number): void {
    if (frame) frame.clip = { x0, y0, x1, y1 };
  },
  draw_text(x: number, y: number, text: string, color: number): void {
    frame?.texts.push({ x, y, text, color });
  },
  draw_belt(): void {},
  draw_end(): void {
    if (frame) post({ type: 'frame', frame }, frame.blits.map((b) => b.rgba.buffer));
    frame = null;
  },

  // ---- 소리
  create_sound_raw(id: number, data: Float32Array, samples: number, channels: number, rate: number): void {
    post({ type: 'audio', call: { fn: 'create_sound_raw', id, data, samples, channels, rate } }, [data.buffer]);
  },
  create_sound(id: number, data: Uint8Array): void {
    post({ type: 'audio', call: { fn: 'create_sound', id, data } }, [data.buffer]);
  },
  duplicate_sound(id: number, src: number): void {
    post({ type: 'audio', call: { fn: 'duplicate_sound', id, src } });
  },
  play_sound(id: number, volume: number, pan: number, loop: number): void {
    post({ type: 'audio', call: { fn: 'play_sound', id, volume, pan, loop: !!loop } });
  },
  set_volume(id: number, volume: number): void {
    post({ type: 'audio', call: { fn: 'set_volume', id, volume } });
  },
  stop_sound(id: number): void {
    post({ type: 'audio', call: { fn: 'stop_sound', id } });
  },
  delete_sound(id: number): void {
    post({ type: 'audio', call: { fn: 'delete_sound', id } });
  },
};
// 글루는 self.DApi.* 와 (드물게) self.alert 를 부른다
Object.assign(self, { DApi, alert: (text: string) => post({ type: 'error', message: text }) });

/** UMD 글루(.jscc)를 받아서 실행 — module.exports = Diablo (모듈 팩토리) */
async function loadGlue(url: string): Promise<Factory> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`글루를 못 받음: ${url} (${res.status})`);
  const src = await res.text();
  const mod: { exports: unknown } = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  if (typeof mod.exports !== 'function') throw new Error('글루가 모듈 팩토리를 내보내지 않음');
  return mod.exports as Factory;
}

async function init(m: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  files = m.files;
  spawn = m.mpqName === 'spawn.mpq';
  files.set(m.mpqName, new Uint8Array(m.mpq));
  const [factory, wasmBinary] = await Promise.all([
    loadGlue(m.glueUrl),
    fetch(m.wasmUrl).then((r) => {
      if (!r.ok) throw new Error(`WASM 을 못 받음: ${m.wasmUrl} (${r.status})`);
      return r.arrayBuffer();
    }),
  ]);
  wasm = await factory({ wasmBinary }).ready;
  wasm._DApi_Init(Math.floor(performance.now()), 0, ...m.version);
  timer = setInterval(() => guarded(() => wasm!._DApi_Render(Math.floor(performance.now()))), TICK_MS) as unknown as number;
  post({ type: 'ready' });
}

function event(fn: D1Event, args: number[]): void {
  const w = wasm;
  if (!w) return;
  if (fn === 'DApi_Mouse') w._DApi_Mouse(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!);
  else if (fn === 'DApi_Key') w._DApi_Key(args[0]!, args[1]!, args[2]!);
  else w._DApi_Char(args[0]!);
}

/** 화면 키보드 글자를 글루의 고정 버퍼(255자)에 쓰고 알린다 */
function syncText(text: string, flags: number): void {
  const w = wasm;
  if (!w) return;
  const p = w._DApi_SyncTextPtr();
  const n = Math.min(text.length, 255);
  for (let i = 0; i < n; i++) w.HEAPU8[p + i] = text.charCodeAt(i) & 0xff;
  w.HEAPU8[p + n] = 0;
  w._DApi_SyncText(flags);
}

scope.onmessage = ({ data }: MessageEvent<ToWorker>): void => {
  switch (data.type) {
    case 'init':
      void init(data).catch(fail);
      break;
    case 'event':
      guarded(() => event(data.fn, data.args));
      break;
    case 'text':
      guarded(() => syncText(data.text, data.flags));
      break;
    case 'stop':
      clearInterval(timer);
      scope.close();
      break;
  }
};
