// 최소 메뉴 UI (DOM 오버레이): 메인메뉴 → 캐릭터 선택/생성. 원작 DC6 화면은 Phase 11 에서 교체.
import type { HeroSummary } from '../engine/save';
import { validHeroName } from '../engine/save';

export type MenuResult = { kind: 'new'; name: string } | { kind: 'load'; name: string };

const CSS = `
.d2menu{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#000;color:#c7b377;font-family:serif}
.d2menu h1{font-size:40px;color:#a8141f;letter-spacing:6px;margin:0 0 20px}
.d2menu button{min-width:260px;padding:8px 16px;background:#1a1410;border:1px solid #6b5a3a;color:#c7b377;font:18px serif;cursor:pointer}
.d2menu button:hover{background:#2b2218}
.d2menu button:disabled{opacity:.4;cursor:default}
.d2menu input{padding:6px;background:#111;border:1px solid #6b5a3a;color:#c7b377;font:18px serif;width:240px}
.d2menu .err{color:#d33;min-height:1.2em}
.d2menu .hero{display:flex;gap:8px}
`;

export class Menu {
  private readonly root: HTMLElement;

  constructor(host: HTMLElement) {
    if (!document.getElementById('d2menu-css')) {
      const st = document.createElement('style');
      st.id = 'd2menu-css';
      st.textContent = CSS;
      document.head.append(st);
    }
    this.root = document.createElement('div');
    this.root.className = 'd2menu';
    this.root.id = 'menu';
    host.style.position = 'relative';
    host.append(this.root);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private show(): void {
    this.root.style.display = 'flex';
    this.root.replaceChildren();
  }

  private button(label: string, onClick: () => void, id?: string, disabled = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    if (id) b.id = id;
    b.disabled = disabled;
    b.onclick = onClick;
    this.root.append(b);
    return b;
  }

  /** 메인메뉴 → 선택 결과 */
  run(listHeroes: () => Promise<HeroSummary[]>): Promise<MenuResult> {
    return new Promise((resolve) => {
      const main = () => {
        this.show();
        const h = document.createElement('h1');
        h.textContent = 'DIABLO II';
        this.root.append(h);
        this.button('Single Player', () => void select(), 'btn-single');
      };
      const select = async () => {
        const heroes = await listHeroes();
        this.show();
        const h = document.createElement('h1');
        h.textContent = 'Select Hero';
        this.root.append(h);
        for (const hero of heroes) this.button(`${hero.name} — Level ${hero.level} ${hero.cls}`, () => resolve({ kind: 'load', name: hero.name }), `hero-${hero.name}`);
        this.button('Create New', create, 'btn-create');
        this.button('Cancel', main);
      };
      const create = () => {
        this.show();
        const h = document.createElement('h1');
        h.textContent = 'Select Hero Class';
        this.root.append(h);
        for (const cls of ['Amazon', 'Sorceress', 'Necromancer', 'Paladin']) this.button(cls, () => undefined, undefined, true);
        const input = document.createElement('input');
        input.id = 'hero-name';
        input.placeholder = 'Character Name';
        input.maxLength = 15;
        const err = document.createElement('div');
        err.className = 'err';
        this.button('Barbarian', () => {
          if (!validHeroName(input.value)) {
            err.textContent = '이름: 2~15자 영문(첫 글자 영문), _ - 허용';
            return;
          }
          resolve({ kind: 'new', name: input.value });
        }, 'btn-barbarian');
        this.root.append(input, err);
        this.button('Cancel', () => void select());
      };
      main();
    });
  }
}
