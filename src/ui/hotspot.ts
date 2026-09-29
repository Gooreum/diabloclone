// 캔버스에 원작 그림으로 그린 패널 위에 겹치는 투명 DOM 클릭 영역 (접근성·e2e 용 id 유지).
// 그림은 캔버스가 그리고, 이 층은 보이지 않는 단추만 둔다 — 패널 영역 클릭은 여기서 삼켜 월드 이동이 되지 않는다(원작 동작).
export interface HRect { x: number; y: number; w: number; h: number }

const CSS = `
.d2hot{position:absolute;display:none;background:transparent;user-select:none;-webkit-user-select:none}
.d2hot button,.d2hot .hs{position:absolute;display:block;background:transparent;border:0;padding:0;margin:0;cursor:pointer;color:transparent;font-size:1px;outline:none}
`;

export function ensureHotspotCss(): void {
  if (typeof document === 'undefined' || document.getElementById('d2hot-css')) return;
  const st = document.createElement('style');
  st.id = 'd2hot-css';
  st.textContent = CSS;
  document.head.append(st);
}

export class HotLayer {
  readonly root: HTMLElement;
  private readonly items = new Map<string, HTMLElement>();
  private rect: HRect;

  constructor(stage: HTMLElement, id: string, rect: HRect) {
    ensureHotspotCss();
    this.rect = rect;
    this.root = document.createElement('div');
    this.root.className = 'd2hot';
    this.root.id = id;
    this.place(rect);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.append(this.root);
  }

  place(rect: HRect): void {
    this.rect = rect;
    Object.assign(this.root.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  }

  get visible(): boolean {
    return this.root.style.display === 'block';
  }

  set visible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
  }

  /**
   * 단추 하나 (화면 좌표 rect). key 가 같으면 위치만 갱신. attrs 는 data-* 등.
   * onClick(e) 는 한 번만 연결된다 — 상태는 호출 쪽이 클로저 대신 key 로 찾는다.
   */
  button(key: string, rect: HRect, onClick: (e: MouseEvent) => void, attrs: Record<string, string> = {}, label = ''): HTMLElement {
    let el = this.items.get(key);
    if (!el) {
      el = document.createElement('button');
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(e);
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      this.items.set(key, el);
      this.root.append(el);
    }
    for (const [k, v] of Object.entries(attrs)) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
    if (label && el.textContent !== label) el.textContent = label;
    Object.assign(el.style, { left: `${rect.x - this.rect.x}px`, top: `${rect.y - this.rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, display: 'block' });
    return el;
  }

  /** key 목록에 없는 단추 숨기기 */
  only(keys: Set<string>): void {
    for (const [k, el] of this.items) if (!keys.has(k)) el.style.display = 'none';
  }

  remove(key: string): void {
    this.items.get(key)?.remove();
    this.items.delete(key);
  }

  dispose(): void {
    this.root.remove();
    this.items.clear();
  }
}
