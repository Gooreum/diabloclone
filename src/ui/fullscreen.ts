// 전체화면: 오른쪽 위 단추 · Alt(Option)+Enter (원작 단축키) · 전체화면 중 Esc 는 게임으로.
// 브라우저는 전체화면에서 Esc 를 누르면 전체화면을 푼다 — 게임 메뉴(Esc)를 쓸 수 있게 Keyboard Lock 으로 Esc 를 잡는다 (Chrome·Edge, 길게 누르면 풀림)

type KeyboardLock = { lock?(keys: string[]): Promise<void>; unlock?(): void };
const keyboard = (): KeyboardLock | undefined => (navigator as unknown as { keyboard?: KeyboardLock }).keyboard;

/** 마우스가 이만큼 멈추면 단추를 흐리게 (게임 화면을 가리지 않게) */
const IDLE_MS = 2000;

export async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    keyboard()?.unlock?.();
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  await document.documentElement.requestFullscreen?.().catch(() => undefined);
  if (document.fullscreenElement) await keyboard()?.lock?.(['Escape'])?.catch(() => undefined);
}

/** 글꼴마다 다르게 깨지는 문자 대신 SVG (네 모서리 바깥 화살 / 안쪽 화살) */
const ICON_ENTER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_EXIT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

const CSS = `
#btn-fullscreen { position: fixed; top: 8px; right: 8px; z-index: 1000; width: 36px; height: 36px; padding: 0;
  background: rgba(20, 16, 8, .75); color: #d8c690; border: 1px solid #6b5f3c; border-radius: 4px;
  display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: .9; transition: opacity .4s; }
#btn-fullscreen:hover { opacity: 1; border-color: #d8c690; }
#btn-fullscreen.idle { opacity: .15; }
`;

let installed = false;

declare global {
  interface Window { __toggleFullscreen?: () => Promise<void> }
}

/** 한 번만 설치: Alt+Enter 키와 오른쪽 위 단추 (#btn-fullscreen) */
export function installFullscreen(): void {
  if (installed) return;
  installed = true;
  // 디아블로 1 은 iframe 안에서 키를 받는다 — 그쪽 셸(public/d1x/play.html)이 Alt+Enter 를 여기로 넘긴다
  window.__toggleFullscreen = toggleFullscreen;
  addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.altKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void toggleFullscreen();
  }, true);

  const style = document.createElement('style');
  style.textContent = CSS;
  const b = document.createElement('button');
  b.id = 'btn-fullscreen';
  b.type = 'button';
  const label = (): void => {
    const on = !!document.fullscreenElement;
    b.innerHTML = on ? ICON_EXIT : ICON_ENTER;
    b.title = on ? '전체화면 끄기 (Alt+Enter)' : '전체화면 (Alt+Enter)';
    b.setAttribute('aria-label', b.title);
  };
  label();
  // 게임(문서 캡처 리스너)에 클릭이 가지 않게 단추에서 멈춘다
  for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup'] as const) b.addEventListener(ev, (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    b.blur();
    void toggleFullscreen();
  });
  document.addEventListener('fullscreenchange', label);
  let timer = 0;
  const wake = (): void => {
    b.classList.remove('idle');
    clearTimeout(timer);
    timer = window.setTimeout(() => b.classList.add('idle'), IDLE_MS);
  };
  addEventListener('mousemove', wake, true);
  wake();
  document.head.append(style);
  document.body.append(b);
}
