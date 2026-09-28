// 최소 패널 (DOM): 인벤토리 목록(I), 게임 메뉴(ESC: Save and Exit Game / Return to Game).
import type { ItemInstance } from '../engine/treasure';
import { QUALITY } from '../engine/treasure';

// 원작 아이템 이름 색 (일반 흰색, 매직 파랑, 세트 초록, 레어 노랑, 유니크 금색, 저품질 회색)
const COLOR: Record<number, string> = {
  [QUALITY.INFERIOR]: '#8c8c8c', [QUALITY.NORMAL]: '#ffffff', [QUALITY.SUPERIOR]: '#ffffff',
  [QUALITY.MAGIC]: '#6969ff', [QUALITY.SET]: '#00c400', [QUALITY.RARE]: '#ffff64', [QUALITY.UNIQUE]: '#c7b377',
};

const CSS = `
.d2panel{position:absolute;top:20px;right:20px;width:300px;max-height:440px;overflow:auto;background:rgba(10,8,6,.92);border:1px solid #6b5a3a;color:#c7b377;font:14px serif;padding:10px;display:none}
.d2panel h2{margin:0 0 8px;font-size:18px;color:#e8d8a8}
.d2gamemenu{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,.6)}
.d2gamemenu button{min-width:260px;padding:8px 16px;background:#1a1410;border:1px solid #6b5a3a;color:#c7b377;font:18px serif;cursor:pointer}
`;

export class Panels {
  readonly inventory: HTMLElement;
  readonly gameMenu: HTMLElement;
  private readonly nameOf: (code: string) => string;

  constructor(host: HTMLElement, nameOf: (code: string) => string, onSaveExit: () => void) {
    this.nameOf = nameOf;
    if (!document.getElementById('d2panel-css')) {
      const st = document.createElement('style');
      st.id = 'd2panel-css';
      st.textContent = CSS;
      document.head.append(st);
    }
    this.inventory = document.createElement('div');
    this.inventory.className = 'd2panel';
    this.inventory.id = 'inventory';
    this.gameMenu = document.createElement('div');
    this.gameMenu.className = 'd2gamemenu';
    this.gameMenu.id = 'gamemenu';
    const save = document.createElement('button');
    save.id = 'btn-save-exit';
    save.textContent = 'Save and Exit Game';
    save.onclick = onSaveExit;
    const ret = document.createElement('button');
    ret.textContent = 'Return to Game';
    ret.onclick = () => this.toggleMenu(false);
    this.gameMenu.append(save, ret);
    host.append(this.inventory, this.gameMenu);
  }

  get menuOpen(): boolean {
    return this.gameMenu.style.display === 'flex';
  }

  toggleMenu(open = !this.menuOpen): void {
    this.gameMenu.style.display = open ? 'flex' : 'none';
  }

  toggleInventory(): void {
    this.inventory.style.display = this.inventory.style.display === 'block' ? 'none' : 'block';
  }

  renderInventory(items: readonly ItemInstance[], equipment: Record<string, ItemInstance>, gold: number): void {
    if (this.inventory.style.display !== 'block') return;
    const row = (it: ItemInstance, prefix = '') =>
      `<div style="color:${COLOR[it.quality] ?? '#fff'}">${prefix}${this.nameOf(it.code)}${it.quantity > 1 ? ` (${it.quantity})` : ''}${it.affixesPending ? ' *' : ''}</div>`;
    this.inventory.innerHTML =
      `<h2>Inventory</h2>` +
      Object.entries(equipment).map(([slot, it]) => row(it, `[${slot}] `)).join('') +
      `<hr>` +
      (items.map((it) => row(it)).join('') || '<div>(empty)</div>') +
      `<hr><div>Gold: ${gold}</div>`;
  }

  dispose(): void {
    this.inventory.remove();
    this.gameMenu.remove();
  }
}
