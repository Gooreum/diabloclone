// DOM 입력 → mapper → Game.enqueue. 좌클릭 유지 시 커서 방향으로 계속 이동 (원작 동작).
import type { Command } from '../engine/command';
import { fromCanvas, type Camera } from '../render/iso';
import { mapLeftClick, type Hover } from './mapper';

export interface PickBox { kind: 'monster' | 'item'; id: number; x: number; y: number; w: number; h: number }

export class InputController {
  run = false;
  private mouse: { x: number; y: number } | null = null;
  private holding = false;
  private holdCommand: 'move' | null = null;
  private lastRepeat = 0;
  pickBoxes: PickBox[] = [];

  private readonly canvas: HTMLCanvasElement;
  private readonly camera: () => Camera;
  private readonly send: (c: Command) => void;
  private readonly off: (() => void)[] = [];
  enabled = true;

  constructor(canvas: HTMLCanvasElement, camera: () => Camera, send: (c: Command) => void) {
    this.canvas = canvas;
    this.camera = camera;
    this.send = send;
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      t.addEventListener(type, fn as EventListener);
      this.off.push(() => t.removeEventListener(type, fn as EventListener));
    };
    on(canvas, 'mousedown', (e) => this.enabled && this.onDown(e));
    on(window, 'mouseup', () => {
      this.holding = false;
      this.holdCommand = null;
    });
    on(canvas, 'mousemove', (e) => (this.mouse = this.local(e)));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => {
      if (this.enabled && (e.key === 'r' || e.key === 'R')) this.run = !this.run;
    });
  }

  dispose(): void {
    for (const f of this.off.splice(0)) f();
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * this.canvas.width) / r.width, y: ((e.clientY - r.top) * this.canvas.height) / r.height };
  }

  hoverAt(x: number, y: number): Hover {
    for (let i = this.pickBoxes.length - 1; i >= 0; i--) {
      const b = this.pickBoxes[i] as PickBox;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { kind: b.kind, id: b.id };
    }
    return null;
  }

  private onDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const p = this.local(e);
    this.mouse = p;
    const w = fromCanvas(this.camera(), p.x, p.y);
    const cmd = mapLeftClick({ worldX: w.x, worldY: w.y, shift: e.shiftKey, hover: this.hoverAt(p.x, p.y), run: this.run });
    if (!cmd) return;
    this.send(cmd);
    this.holding = true;
    this.holdCommand = cmd.type === 'move' ? 'move' : null;
    this.lastRepeat = performance.now();
  }

  /** 매 렌더 프레임 호출: 버튼을 누르고 있으면 약 200ms 마다 커서 위치로 이동 명령 재발행 */
  update(now: number): void {
    if (!this.holding || this.holdCommand !== 'move' || !this.mouse || now - this.lastRepeat < 200) return;
    this.lastRepeat = now;
    const w = fromCanvas(this.camera(), this.mouse.x, this.mouse.y);
    this.send({ type: 'move', x: w.x, y: w.y, run: this.run });
  }
}
