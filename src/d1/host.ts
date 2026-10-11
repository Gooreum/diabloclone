// 디아블로 1 실행 (메인 스레드): 640×480 무대에 워커가 보낸 프레임을 그리고, 마우스·키보드를 넘기고, 소리를 내고, 세이브를 브라우저에 보관한다.
// 게임 자체는 Devilution 웹 빌드 (src/d1/vendor, 워커 d1-worker.ts). 입력 값의 뜻은 글루의 _DApi_Mouse/_DApi_Key/_DApi_Char 그대로.
import { kvStore, MpqStore } from '../assets/local-mpq';
import { fitStage } from '../ui/stage';
import { D1Audio } from './audio';
import type { D1Event, D1MpqName, Frame, FromWorker, ToWorker } from './protocol';
import glueUrl from './vendor/Diablo.jscc?url';
import spawnGlueUrl from './vendor/DiabloSpawn.jscc?url';
import wasmUrl from './vendor/Diablo.wasm?url';
import spawnWasmUrl from './vendor/DiabloSpawn.wasm?url';

export const D1_WIDTH = 640, D1_HEIGHT = 480;
/** 반입한 diabloweb 빌드 버전 (게임이 메뉴 구석에 표시) — 출처: diabloweb package.json 1.0.39 */
export const D1_VERSION: [number, number, number] = [1, 0, 39];

/** 원작 데이터: 보관한 Blob 또는 URL. keep 이면 받은 뒤 브라우저에 보관 (다음부터 바로) */
export interface D1Source { name: D1MpqName; spawn: boolean; blob?: Blob; url?: string; keep?: boolean }

/** 무료 쉐어웨어 (Blizzard 배포본) — diabloweb 공개 호스팅. 파일이 없으면 처음 한 번 받아 보관한다 */
export const SPAWN_URL = 'https://d07riv.github.io/diabloweb/spawn.mpq';
/** 알려진 쉐어웨어 spawn.mpq 크기 (1.09 판본 둘) */
export const SPAWN_SIZES = [25830791, 50274091];
/** 파일 없이 하는 디아블로 1 */
export const SHAREWARE: D1Source = { name: 'spawn.mpq', spawn: true, url: SPAWN_URL, keep: true };

/** 세이브(single_N.sv / spawnN.sv)·config.ini — 원작 MPQ 보관과 다른 DB */
export const D1Store = kvStore<Uint8Array>('diabloclone-d1');

/** e2e·디버그용 상태 */
export interface D1Debug { ready: boolean; frames: number; errors: string[]; event: (fn: D1Event, ...args: number[]) => void }
declare global {
  interface Window { __d1?: D1Debug }
}

/** 브라우저 버튼 → 글루 버튼 (1 왼쪽, 2 오른쪽, 4 가운데) */
const MOUSE_BUTTON: Record<number, number> = { 0: 1, 1: 4, 2: 2 };
/** 수정 키 → 글루 mods (shift 1, ctrl 2, alt 4) */
const mods = (e: MouseEvent | KeyboardEvent): number => (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0);
/** 브라우저 기본 동작을 막을 키: Backspace·Tab·F1~F8 (도움말·뒤로 가기 대신 게임에) */
const BLOCK_KEYS = new Set([8, 9, 112, 113, 114, 115, 116, 117, 118, 119]);

const CSS = `
#d1-stage { position: relative; width: ${D1_WIDTH}px; height: ${D1_HEIGHT}px; background: #000; cursor: none; }
#d1-canvas { position: absolute; left: 0; top: 0; image-rendering: pixelated; }
#d1-keyboard { position: absolute; display: none; opacity: 0; font: 16px serif; }
#d1-status { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  color: #c7b377; font: 18px serif; text-align: center; padding: 32px; box-sizing: border-box; cursor: default; }
#d1-status .err { color: #d05040; white-space: pre-wrap; font-size: 14px; }
#d1-status button { background: #1a160c; color: #d8c690; border: 1px solid #6b5f3c; padding: 8px 16px; font: 15px serif; cursor: pointer; }
`;

/** 디아블로 1 을 host 에 띄운다. 게임에서 "Quit Diablo" 로 끝나면 resolve */
export async function runDiablo1(host: HTMLElement, src: D1Source): Promise<void> {
  const style = document.createElement('style');
  style.textContent = CSS;
  const stage = document.createElement('div');
  stage.id = 'd1-stage';
  const canvas = document.createElement('canvas');
  canvas.id = 'd1-canvas';
  canvas.width = D1_WIDTH;
  canvas.height = D1_HEIGHT;
  // 화면 키보드 (캐릭터 이름·금액): 게임이 알려준 칸 위에 투명하게 겹친다. 글자는 게임이 그린다
  const keyboard = document.createElement('input');
  keyboard.id = 'd1-keyboard';
  keyboard.type = 'text';
  keyboard.spellcheck = false;
  keyboard.autocomplete = 'off';
  const status = document.createElement('div');
  status.id = 'd1-status';
  status.textContent = `디아블로 1 ${src.spawn ? '(쉐어웨어)' : ''} 불러오는 중…`;
  stage.append(canvas, keyboard, status);
  host.replaceChildren(style, stage);
  const fit = (): void => fitStage(stage, D1_WIDTH, D1_HEIGHT);
  fit();
  addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, D1_WIDTH, D1_HEIGHT);

  const debug: D1Debug = { ready: false, frames: 0, errors: [], event: () => undefined };
  window.__d1 = debug;

  let mpq: ArrayBuffer;
  let files: Map<string, Uint8Array>;
  try {
    const mb = (n: number) => (n / 1048576).toFixed(1);
    mpq = src.blob ? await src.blob.arrayBuffer() : await download(src.url!, (got, total) => {
      status.textContent = src.keep ? `디아블로 1 받는 중… ${mb(got)} / ${mb(total)} MB (처음 한 번만)` : `디아블로 1 불러오는 중… ${mb(got)} MB`;
    });
    if (src.keep) {
      if (!SPAWN_SIZES.includes(mpq.byteLength)) throw new Error(`받은 파일 크기가 다릅니다 (${mpq.byteLength} bytes)`);
      // 워커로 넘기기 전에 사본을 보관 — 다음부터는 받지 않고 바로
      void MpqStore.put(src.name, new Blob([mpq.slice(0)])).catch(() => undefined);
    }
    status.textContent = '디아블로 1 시작하는 중…';
    files = await D1Store.all().catch(() => new Map<string, Uint8Array>());
  } catch (e) {
    showError(status, debug, (e as Error).message);
    return new Promise<void>(() => undefined);
  }

  const worker = new Worker(new URL('./d1-worker.ts', import.meta.url), { type: 'module' });
  const audio = new D1Audio();
  const send = (m: ToWorker, transfer: Transferable[] = []): void => worker.postMessage(m, transfer);
  const event = (fn: D1Event, ...args: number[]): void => send({ type: 'event', fn, args });
  debug.event = event;

  // ---- 입력
  /** 화면 키보드 최대 길이 (음수면 숫자 입력, 최대값 -max) */
  let kbMax = 0, kbOpen = false, kbNum = 0;
  const pos = (e: MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(D1_WIDTH - 1, Math.round(((e.clientX - r.left) / r.width) * D1_WIDTH))),
      y: Math.max(0, Math.min(D1_HEIGHT - 1, Math.round(((e.clientY - r.top) / r.height) * D1_HEIGHT))),
    };
  };
  const onMove = (e: MouseEvent): void => {
    const { x, y } = pos(e);
    event('DApi_Mouse', 0, 0, mods(e), x, y);
  };
  const onDown = (e: MouseEvent): void => {
    if (e.target === keyboard) return;
    audio.resume();
    const { x, y } = pos(e);
    event('DApi_Mouse', 1, MOUSE_BUTTON[e.button] ?? 1, mods(e), x, y);
    e.preventDefault();
  };
  const onUp = (e: MouseEvent): void => {
    const { x, y } = pos(e);
    event('DApi_Mouse', 2, MOUSE_BUTTON[e.button] ?? 1, mods(e), x, y);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    audio.resume();
    event('DApi_Key', 0, mods(e), e.keyCode);
    // 입력칸이 열려 있으면 글자는 입력칸이 받아 text 로 동기화한다
    if (!kbOpen && e.key.length === 1 && e.keyCode >= 32) event('DApi_Char', e.key.charCodeAt(0));
    else if (e.keyCode === 8 || e.keyCode === 13) event('DApi_Char', e.keyCode);
    if (!kbOpen && BLOCK_KEYS.has(e.keyCode)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent): void => event('DApi_Key', 1, mods(e), e.keyCode);
  const onMenu = (e: Event): void => e.preventDefault();
  /** 입력칸 글자를 게임 규칙(최대 길이·인쇄 가능 ASCII / 숫자)으로 걸러 보낸다 */
  const syncKeyboard = (flags: number): void => {
    if (!kbOpen) return;
    const text = keyboard.value;
    let valid: string;
    if (kbMax > 0) valid = (text.match(/[\x20-\x7E]/g) ?? []).join('').slice(0, kbMax);
    else {
      if (/^\d*$/.test(text)) kbNum = Math.min(text.length ? parseInt(text, 10) : 0, -kbMax);
      valid = kbNum ? String(kbNum) : '';
    }
    if (text !== valid) keyboard.value = valid;
    send({ type: 'text', text: valid, flags });
  };
  keyboard.addEventListener('input', () => syncKeyboard(0));
  keyboard.addEventListener('blur', () => syncKeyboard(1));
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('mouseup', onUp, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('contextmenu', onMenu, true);

  const cleanup = (): void => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mouseup', onUp, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('contextmenu', onMenu, true);
    removeEventListener('resize', fit);
    document.removeEventListener('fullscreenchange', fit);
    send({ type: 'stop' });
    worker.terminate();
    audio.stopAll();
  };

  const draw = (f: Frame): void => {
    for (const b of f.blits) ctx.putImageData(new ImageData(b.rgba as Uint8ClampedArray<ArrayBuffer>, b.w, b.h), b.x, b.y);
    if (f.texts.length) {
      ctx.save();
      if (f.clip) {
        ctx.beginPath();
        ctx.rect(f.clip.x0, f.clip.y0, f.clip.x1 - f.clip.x0, f.clip.y1 - f.clip.y0);
        ctx.clip();
      }
      // 근사(원작 미확인): 웹 빌드는 일부 글자(대화 상자 등)를 브라우저 글꼴로 그리라고 넘긴다 — 글루 호스트와 같은 글꼴·기준선
      ctx.font = 'bold 13px "Times New Roman", serif';
      for (const t of f.texts) {
        ctx.fillStyle = `rgb(${(t.color >> 16) & 255}, ${(t.color >> 8) & 255}, ${t.color & 255})`;
        ctx.fillText(t.text, t.x, t.y + 22);
      }
      ctx.restore();
    }
    debug.frames++;
  };

  return new Promise<void>((resolve) => {
    worker.onerror = (e) => {
      cleanup();
      showError(status, debug, e.message || '워커를 시작하지 못했습니다');
    };
    worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      switch (data.type) {
        case 'ready':
          status.remove();
          debug.ready = true;
          break;
        case 'frame':
          draw(data.frame);
          break;
        case 'audio':
          audio.apply(data.call);
          break;
        case 'file':
          if (data.op === 'put') void D1Store.put(data.name, data.data).catch(() => undefined);
          else void D1Store.remove(data.name).catch(() => undefined);
          break;
        case 'keyboard':
          if (data.rect) {
            const [x0, y0, x1, y1, max] = data.rect;
            kbMax = max;
            kbOpen = true;
            Object.assign(keyboard.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
            keyboard.focus();
          } else {
            kbOpen = false;
            keyboard.blur();
            keyboard.value = '';
            kbNum = 0;
            keyboard.style.display = 'none';
          }
          break;
        case 'cursor':
          // 게임이 커서를 옮겼다 (예: 인벤토리 열기) — 다음 이동을 그 자리 기준으로
          event('DApi_Mouse', 0, 0, 0, data.x, data.y);
          break;
        case 'save':
          break;
        case 'exit':
          cleanup();
          resolve();
          break;
        case 'error':
          cleanup();
          showError(status, debug, data.message);
          break;
      }
    };
    send({
      type: 'init',
      glueUrl: src.spawn ? spawnGlueUrl : glueUrl,
      wasmUrl: src.spawn ? spawnWasmUrl : wasmUrl,
      mpq,
      mpqName: src.name,
      files,
      version: D1_VERSION,
    }, [mpq]);
  });
}

/** 진행률을 알리며 통째로 받는다 */
async function download(url: string, onProgress: (got: number, total: number) => void): Promise<ArrayBuffer> {
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    throw new Error('디아블로 1 파일을 받지 못했습니다. 인터넷 연결을 확인하고 다시 시작해 주세요.');
  }
  if (!r.ok || !r.body) throw new Error(`디아블로 1 파일을 받지 못했습니다 (HTTP ${r.status}). 잠시 뒤 다시 시작해 주세요.`);
  const total = Number(r.headers.get('content-length')) || SPAWN_SIZES[0]!;
  const out = new Uint8Array(total);
  const parts: Uint8Array[] = [];
  let got = 0, last = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.byteLength <= out.byteLength) out.set(value, got);
    parts.push(value);
    got += value.byteLength;
    if (got - last > 262144) {
      last = got;
      onProgress(got, total);
    }
  }
  if (got === out.byteLength) return out.buffer;
  // 길이 헤더가 없거나 틀렸으면 조각을 이어 붙인다
  const all = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.byteLength;
  }
  return all.buffer;
}

/** 오류 글과 다시 시작 단추 (게임은 멈춘 상태) */
function showError(status: HTMLElement, debug: D1Debug, message: string): void {
  debug.errors.push(message);
  status.replaceChildren();
  const h = document.createElement('p');
  h.textContent = '디아블로 1 실행 중 오류가 났습니다';
  const p = document.createElement('p');
  p.className = 'err';
  p.textContent = message;
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = '다시 시작';
  b.onclick = () => location.reload();
  status.append(h, p, b);
  status.parentElement?.style.setProperty('cursor', 'default');
  if (!status.isConnected) document.getElementById('d1-stage')?.append(status);
}
