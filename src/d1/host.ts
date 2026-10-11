// 디아블로 1 실행: DevilutionX 웹 빌드(public/d1x, scripts/build-devilutionx.sh)를 같은 출처 iframe 으로 화면 가득 띄운다.
// 원작 MPQ 는 여기서 준비한다 (보관한 파일 또는 무료 쉐어웨어를 처음 한 번 받아 보관) → iframe 의 셸(d1x/play.html)이 가상 파일 시스템에 넣는다.
// 세이브·설정은 DevilutionX 가 브라우저(IndexedDB, /libsdl/diasurgical)에 스스로 보관한다.
import { MpqStore, type D1MpqName } from '../assets/local-mpq';
import { openKeymap, type D1Runtime } from './keymap';

/** 원작 데이터: 보관한 Blob 또는 URL. keep 이면 받은 뒤 브라우저에 보관 (다음부터 바로) */
export interface D1Source { name: D1MpqName; spawn: boolean; blob?: Blob; url?: string; keep?: boolean }

/** 무료 쉐어웨어 (Blizzard 배포본) — diabloweb 공개 호스팅(CORS 허용). 파일이 없으면 처음 한 번 받아 보관한다.
 *  웹용으로 다시 묶은 판이라 효과음이 .wav 이름의 MP3 — 엔진 패치가 내용으로 알아본다 (patches/devilutionx-web.patch) */
export const SPAWN_URL = 'https://d07riv.github.io/diabloweb/spawn.mpq';
/** 알려진 쉐어웨어 spawn.mpq 크기 (웹용 묶음 · 원본 1.09) */
export const SPAWN_SIZES = [25830791, 50274091];
/** 파일 없이 하는 디아블로 1 */
export const SHAREWARE: D1Source = { name: 'spawn.mpq', spawn: true, url: SPAWN_URL, keep: true };

/** e2e·디버그용 상태 (셸이 채운다) */
export interface D1Debug { ready: boolean; errors: string[]; log: string[] }
/** 셸에 넘기는 원작 파일 (+ 한국어면 한글 글꼴 MPQ) */
export interface D1Payload { name: D1MpqName; buffer: ArrayBuffer; fonts?: ArrayBuffer }

/** 한글 글꼴: DevilutionX fonts.mpq 의 한글 부분 (scripts/build-d1-fonts.ts, SIL OFL) */
export const FONTS_KO_PATH = 'd1x/fonts-ko.mpq';
export const FONTS_KO_SIZE = 16418824;
/** 파일 sha256 앞 12자리 — 주소에 붙여 옛 캐시를 피한다 */
export const FONTS_KO_VERSION = '2baee5ad59e6';

/** 브라우저 첫 언어가 한국어인가 */
export function wantsKorean(langs: readonly string[] = navigator.languages ?? [navigator.language]): boolean {
  return /^ko\b/i.test(langs[0] ?? '');
}
declare global {
  interface Window { __d1?: D1Debug; __d1Source?: D1Payload }
}

const CSS = `
#d1-frame { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #000; }
#d1-status { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  color: #c7b377; background: #000; font: 18px serif; text-align: center; padding: 32px; box-sizing: border-box; }
#d1-status .err { color: #d05040; white-space: pre-wrap; font-size: 14px; }
#d1-status button { background: #1a160c; color: #d8c690; border: 1px solid #6b5f3c; padding: 8px 16px; font: 15px serif; cursor: pointer; }
#d1-bar { position: fixed; top: 8px; left: 8px; z-index: 1000; display: flex; gap: 6px; opacity: .9; transition: opacity .4s; }
#d1-bar.idle { opacity: .15; }
#d1-bar:hover { opacity: 1; }
#d1-bar button { height: 36px; padding: 0 12px; background: rgba(20, 16, 8, .75); color: #d8c690;
  border: 1px solid #6b5f3c; border-radius: 4px; font: 14px serif; cursor: pointer; }
#d1-bar button:hover { border-color: #d8c690; }
`;

/** 디아블로 1 을 화면 가득 띄운다. 왼쪽 위 "나가기" 를 누르면 resolve */
export async function runDiablo1(host: HTMLElement, src: D1Source): Promise<void> {
  const style = document.createElement('style');
  style.textContent = CSS;
  const status = document.createElement('div');
  status.id = 'd1-status';
  status.textContent = `디아블로 1 ${src.spawn ? '(쉐어웨어)' : ''} 불러오는 중…`;
  host.replaceChildren(style, status);
  const debug: D1Debug = { ready: false, errors: [], log: [] };
  window.__d1 = debug;

  let mpq: ArrayBuffer;
  try {
    const mb = (n: number) => (n / 1048576).toFixed(1);
    mpq = src.blob ? await src.blob.arrayBuffer() : await download(src.url!, (got, total) => {
      status.textContent = src.keep ? `디아블로 1 받는 중… ${mb(got)} / ${mb(total)} MB (처음 한 번만)` : `디아블로 1 불러오는 중… ${mb(got)} MB`;
    });
    if (src.keep) {
      if (!SPAWN_SIZES.includes(mpq.byteLength)) throw new Error(`받은 파일 크기가 다릅니다 (${mpq.byteLength} bytes)`);
      // 다음부터는 받지 않고 바로
      await MpqStore.put(src.name, new Blob([mpq])).catch(() => undefined);
    }
  } catch (e) {
    showError(status, debug, (e as Error).message);
    return new Promise<void>(() => undefined);
  }
  // 한국어 브라우저면 한글 글꼴도 (받지 못하면 영어로 시작)
  let fonts: ArrayBuffer | undefined;
  if (wantsKorean()) {
    fonts = await download(`${import.meta.env.BASE_URL}${FONTS_KO_PATH}?v=${FONTS_KO_VERSION}`, (got, total) => {
      status.textContent = `한글 글꼴 받는 중… ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
    }, FONTS_KO_SIZE).catch(() => undefined);
    if (fonts && fonts.byteLength !== FONTS_KO_SIZE) fonts = undefined;
  }
  window.__d1Source = { name: src.name, buffer: mpq, fonts };

  const frame = document.createElement('iframe');
  frame.id = 'd1-frame';
  frame.title = 'Diablo';
  frame.allow = 'fullscreen; autoplay; gamepad';
  // 셸은 작아서 매번 새로 받는다 (Pages 가 10분 캐시 — 엔진을 고친 뒤 옛 셸이 남지 않게). 엔진 파일은 셸이 버전을 붙여 받는다
  frame.src = `${import.meta.env.BASE_URL}d1x/play.html?t=${Date.now()}`;
  // 키보드가 바로 게임으로 가게
  frame.addEventListener('load', () => frame.contentWindow?.focus());
  const exit = document.createElement('button');
  exit.id = 'btn-d1-exit';
  exit.type = 'button';
  exit.textContent = '← 나가기';
  exit.title = '디아블로 1 끝내기 (세이브는 브라우저에 남습니다)';
  // 게임 중 단축키 바꾸기 (엔진 키 배정을 바로 바꾸고 브라우저에 저장). 여는 동안 게임은 멈춘다 (창 포커스를 잃으면 멈춤)
  const keys = document.createElement('button');
  keys.id = 'btn-d1-keys';
  keys.type = 'button';
  keys.textContent = '⌨ 단축키';
  keys.title = '단축키 바꾸기 (Shift·Ctrl·Alt 동시키 가능)';
  keys.addEventListener('click', () => {
    const rt = frame.contentWindow as (Window & D1Runtime) | null;
    if (!rt?.Module || document.getElementById('d1-keys')) return;
    void openKeymap(host, rt).then(() => frame.contentWindow?.focus());
  });
  const bar = document.createElement('div');
  bar.id = 'd1-bar';
  bar.append(exit, keys);
  host.replaceChildren(style, frame, bar);
  // 마우스가 멈추면 흐리게 (전체화면 단추와 같은 규칙) — iframe 안 움직임은 부모에 안 오므로 단추 위에서만 다시 밝게
  let timer = 0;
  const wake = (): void => {
    bar.classList.remove('idle');
    clearTimeout(timer);
    timer = window.setTimeout(() => bar.classList.add('idle'), 2000);
  };
  bar.addEventListener('mouseenter', wake);
  wake();

  return new Promise<void>((resolve) => {
    exit.addEventListener('click', () => {
      clearTimeout(timer);
      frame.remove();
      delete window.__d1Source;
      resolve();
    });
  });
}

/** 진행률을 알리며 통째로 받는다 */
async function download(url: string, onProgress: (got: number, total: number) => void, size = SPAWN_SIZES[0]!): Promise<ArrayBuffer> {
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    throw new Error('디아블로 1 파일을 받지 못했습니다. 인터넷 연결을 확인하고 다시 시작해 주세요.');
  }
  if (!r.ok || !r.body) throw new Error(`디아블로 1 파일을 받지 못했습니다 (HTTP ${r.status}). 잠시 뒤 다시 시작해 주세요.`);
  const total = Number(r.headers.get('content-length')) || size;
  const parts: Uint8Array[] = [];
  let got = 0, last = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    if (got - last > 262144) {
      last = got;
      onProgress(got, total);
    }
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.byteLength;
  }
  return all.buffer;
}

/** 오류 글과 다시 시작 단추 */
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
}
