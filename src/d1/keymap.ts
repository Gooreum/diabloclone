// 디아블로 1 게임 중 단축키 화면: DevilutionX(iframe)의 키 배정을 읽고 바꾼다 (엔진 패치의 dvx_keymap_json / dvx_keymap_set).
// 동시키(SHIFT+1 등)를 받고, 브라우저가 먼저 가져가는 키(F1~F12, Ctrl+W 등)는 받지 않는다.

/** 엔진이 알려 주는 동작 하나 (name 은 게임 언어로 번역된 이름, key 는 DevilutionX 키 이름 — 없으면 "") */
export interface KeyAction { id: string; name: string; key: string }

/** iframe 안 DevilutionX 런타임 (셸 play.html 의 전역) */
export interface D1Runtime {
  Module?: { ccall(name: string, ret: 'string' | 'number', types: string[], args: string[]): string | number };
  FS?: { syncfs(populate: boolean, done: (err?: unknown) => void): void };
}

/** 키 하나짜리 이름 (DevilutionX options.cpp 의 keyIDToKeyName 과 같은 이름) */
const CODE_NAMES: Record<string, string> = {
  Space: 'SPACE', Tab: 'TAB', Backspace: 'BACKSPACE', CapsLock: 'CAPSLOCK', ScrollLock: 'SCROLLLOCK',
  Insert: 'INSERT', Delete: 'DELETE', Home: 'HOME', End: 'END', PrintScreen: 'PRINT', Pause: 'PAUSE',
  Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/',
  NumpadDivide: 'KEYPAD /', NumpadMultiply: 'KEYPAD *', NumpadEnter: 'KEYPAD ENTER', NumpadDecimal: 'KEYPAD DECIMAL',
  AltLeft: 'LALT', AltRight: 'RALT', ControlLeft: 'LCONTROL', ControlRight: 'RCONTROL',
};
/** Ctrl 과 같이 누르면 브라우저가 가로채는 키 (탭 닫기·새 탭·새 창·종료·탭 이동) */
const CTRL_RESERVED = new Set(['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'Tab']);

/** 왜 못 쓰는지 (keyName 이 null 일 때 보일 글). 수정 키만 누른 동안은 null — 다음 키를 기다린다 */
export function rejectReason(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey'>): string | null {
  if (/^(Shift|Meta|OS|Alt|Control)/.test(e.code)) return null;
  if (/^F([1-9]|1[0-2])$/.test(e.code)) return 'F1~F12 는 브라우저가 먼저 쓰는 키라 쓸 수 없어요';
  if (e.metaKey) return '⌘(Cmd)·Windows 키 조합은 브라우저가 먼저 써서 쓸 수 없어요';
  if (e.ctrlKey && CTRL_RESERVED.has(e.code)) return '이 Ctrl 조합은 브라우저가 먼저 써서 쓸 수 없어요';
  return '이 키는 쓸 수 없어요';
}

/** 키보드 입력 → DevilutionX 키 이름 ("SHIFT+1", "CTRL+ALT+A", "KEYPADNUM 3"…). 쓸 수 없거나 수정 키만이면 null */
export function keyName(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (e.metaKey || /^F([1-9]|1[0-2])$/.test(e.code)) return null;
  if (e.ctrlKey && CTRL_RESERVED.has(e.code)) return null;
  // 수정 키만 누른 동안은 다음 키를 기다린다 (Alt·Ctrl 혼자는 뗄 때 loneModifier 로)
  if (/^(Shift|Alt|Control)/.test(e.code)) return null;
  let base: string | undefined;
  let m: RegExpExecArray | null;
  if ((m = /^Key([A-Z])$/.exec(e.code))) base = m[1];
  else if ((m = /^Digit(\d)$/.exec(e.code))) base = m[1];
  else if ((m = /^Numpad(\d)$/.exec(e.code))) base = `KEYPADNUM ${m[1]}`;
  else if ((m = /^F(1[3-9]|2[0-4])$/.exec(e.code))) base = `F${m[1]}`;
  else base = CODE_NAMES[e.code];
  if (!base) return null;
  return `${e.ctrlKey ? 'CTRL+' : ''}${e.altKey ? 'ALT+' : ''}${e.shiftKey ? 'SHIFT+' : ''}${base}`;
}

/** Alt·Ctrl 을 혼자 눌렀다 뗐을 때의 키 이름 (LALT·RCONTROL…, DevilutionX 가 혼자서도 받는 키). 아니면 null */
export function loneModifier(code: string): string | null {
  return /^(Alt|Control)(Left|Right)$/.test(code) ? CODE_NAMES[code]! : null;
}

/** 마우스 휠·가운데·옆 단추 → 이름 */
export function mouseName(e: { type: string; deltaY?: number; deltaX?: number; button?: number }): string | null {
  if (e.type === 'wheel') {
    if (e.deltaY) return e.deltaY < 0 ? 'SCROLLUPMOUSE' : 'SCROLLDOWNMOUSE';
    if (e.deltaX) return e.deltaX < 0 ? 'SCROLLLEFTMOUSE' : 'SCROLLRIGHTMOUSE';
    return null;
  }
  return ({ 1: 'MMOUSE', 3: 'X1MOUSE', 4: 'X2MOUSE' } as Record<number, string>)[e.button ?? -1] ?? null;
}

/** 엔진에서 지금 키 배정 */
export function readKeymap(rt: D1Runtime): KeyAction[] {
  const json = rt.Module?.ccall('dvx_keymap_json', 'string', [], []);
  return typeof json === 'string' ? (JSON.parse(json) as KeyAction[]) : [];
}

/** 엔진에 배정 ("" = 지우기) → 성공하면 브라우저 저장소(IDBFS)에 바로 저장 */
export function writeKey(rt: D1Runtime, id: string, key: string): boolean {
  const ok = rt.Module?.ccall('dvx_keymap_set', 'number', ['string', 'string'], [id, key]) === 1;
  if (ok) rt.FS?.syncfs(false, () => undefined);
  return ok;
}

const CSS = `
#d1-keys { position: fixed; inset: 0; z-index: 1001; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .7); }
#d1-keys .panel { width: min(560px, calc(100% - 32px)); max-height: calc(100% - 32px); display: flex; flex-direction: column; gap: 10px; box-sizing: border-box;
  padding: 18px 20px; background: #0b0905; border: 1px solid #6b5f3c; color: #c7b377; font: 15px serif; }
#d1-keys h2 { margin: 0; font-size: 20px; color: #d8c690; }
#d1-keys .hint { margin: 0; font-size: 13px; color: #8f8563; }
#d1-keys .msg { min-height: 18px; margin: 0; font-size: 13px; color: #d05040; }
#d1-keys .list { overflow-y: auto; border-top: 1px solid #2d2718; }
#d1-keys .row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 4px 2px; border-bottom: 1px solid #2d2718; }
#d1-keys button { background: #1a160c; color: #d8c690; border: 1px solid #6b5f3c; padding: 4px 10px; font: 14px serif; cursor: pointer; }
#d1-keys button:hover { border-color: #d8c690; }
#d1-keys .key { min-width: 120px; }
#d1-keys .key.wait { border-color: #e0c060; color: #fff; }
#d1-keys .foot { display: flex; justify-content: flex-end; }
`;

/** 단축키 화면을 띄운다. 닫으면 resolve (게임으로 포커스) */
export function openKeymap(host: HTMLElement, rt: D1Runtime): Promise<void> {
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.id = 'd1-keys';
  root.innerHTML = `<div class="panel" role="dialog" aria-label="단축키">
    <h2>단축키</h2>
    <p class="hint">바꿀 동작의 키 칸을 누르고 새 키를 누르세요. Shift·Ctrl·Alt 를 누른 채 누르면 동시키(예: SHIFT+1)가 됩니다. 마우스 휠·가운데 단추도 됩니다.</p>
    <p class="msg"></p>
    <div class="list"></div>
    <div class="foot"><button type="button" data-close>닫기</button></div>
  </div>`;
  host.append(style, root);
  const list = root.querySelector('.list') as HTMLElement;
  const msg = root.querySelector('.msg') as HTMLElement;
  let waiting: { id: string; button: HTMLButtonElement } | null = null;
  // Alt·Ctrl 을 누른 채 다른 키를 안 누르고 떼면 그 키 혼자 배정
  let lone: string | null = null;

  const render = (): void => {
    list.replaceChildren(...readKeymap(rt).map((a) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.id = a.id;
      const name = document.createElement('span');
      name.textContent = a.name;
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'key';
      key.textContent = a.key || '—';
      key.onclick = () => {
        waiting?.button.classList.remove('wait');
        waiting = { id: a.id, button: key };
        key.classList.add('wait');
        key.textContent = '키를 누르세요…';
        msg.textContent = '';
      };
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = '지우기';
      clear.onclick = () => {
        writeKey(rt, a.id, '');
        waiting = null;
        render();
      };
      row.append(name, key, clear);
      return row;
    }));
  };

  const assign = (name: string): void => {
    const w = waiting!;
    waiting = null;
    if (!writeKey(rt, w.id, name)) msg.textContent = `${name} 은(는) 쓸 수 없어요`;
    render();
  };

  return new Promise<void>((resolve) => {
    const close = (): void => {
      removeEventListener('keydown', onKey, true);
      removeEventListener('keyup', onKeyUp, true);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('mousedown', onMouse);
      style.remove();
      root.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!waiting) {
        if (e.key === 'Escape') close();
        return;
      }
      if (e.key === 'Escape') {
        waiting = null;
        render();
        return;
      }
      lone = loneModifier(e.code);
      if (lone) return;
      const name = keyName(e);
      if (name) assign(name);
      else {
        const why = rejectReason(e);
        if (why) msg.textContent = why;
      }
    };
    const onWheel = (e: WheelEvent): void => {
      if (!waiting) return;
      e.preventDefault();
      const name = mouseName(e);
      if (name) assign(name);
    };
    const onMouse = (e: MouseEvent): void => {
      if (!waiting || e.button === 0 || e.button === 2) return;
      e.preventDefault();
      const name = mouseName(e);
      if (name) assign(name);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (waiting && lone && loneModifier(e.code) === lone) assign(lone);
      lone = null;
    };
    addEventListener('keydown', onKey, true);
    addEventListener('keyup', onKeyUp, true);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('mousedown', onMouse);
    (root.querySelector('[data-close]') as HTMLButtonElement).onclick = close;
    render();
    (root.querySelector('[data-close]') as HTMLButtonElement).focus();
  });
}
