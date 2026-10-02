// DOM 입력 → mapper → Game.enqueue. 좌클릭 유지 시 커서 방향으로 계속 이동 (원작 동작).
import type { Command } from '../engine/command';
import { fromCanvas, type Camera } from '../render/iso';
import { mapLeftClick, mapRightClick, type Hover } from './mapper';
import { keyBindings } from '../ui/keys';
import { pickAt, type PickBox } from './pick';

export type { PickBox } from './pick';

/** 현재 버튼 스킬 (Game 캐릭터에서 읽음) */
export interface SkillButtons { left: number; right: number }

export class InputController {
  run = false;
  /** 캔버스 좌표 마우스 위치 */
  mouse: { x: number; y: number } | null = null;
  /** UI(인벤토리 패널·커서 아이템)가 먼저 클릭을 처리하면 true (월드 명령을 보내지 않음) */
  intercept: ((x: number, y: number, button: number, shift: boolean) => boolean) | null = null;
  private holding = false;
  private holdCommand: 'move' | 'skill' | 'attack' | null = null;
  /** 누르고 있는 버튼 (0 왼쪽 · 2 오른쪽) */
  private holdButton = 0;
  private holdShift = false;
  /** 플레이어가 아무 행동도 하지 않는 중인가 (왼쪽 버튼을 누른 채 대상이 죽으면 커서 아래를 다시 본다) */
  idle: (() => boolean) | null = null;
  private lastRepeat = 0;
  pickBoxes: PickBox[] = [];

  private readonly canvas: HTMLCanvasElement;
  private readonly camera: () => Camera;
  private readonly send: (c: Command) => void;
  private readonly skills: () => SkillButtons;
  private readonly off: (() => void)[] = [];
  enabled = true;

  constructor(canvas: HTMLCanvasElement, camera: () => Camera, send: (c: Command) => void, skills: () => SkillButtons = () => ({ left: 0, right: 0 })) {
    this.canvas = canvas;
    this.camera = camera;
    this.send = send;
    this.skills = skills;
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      t.addEventListener(type, fn as EventListener);
      this.off.push(() => t.removeEventListener(type, fn as EventListener));
    };
    on(canvas, 'mousedown', (e) => this.enabled && this.onDown(e));
    on(window, 'mouseup', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      if (e.button === this.holdButton) {
        this.holding = false;
        this.holdCommand = null;
      }
      // 원작: 버튼을 누르고 있는 동안만 공격을 되풀이한다 — 뗐다고 엔진에 알린다
      if (this.enabled) this.send({ type: 'release', button: e.button === 2 ? 'right' : 'left' });
    });
    // 캔버스 위에 겹친 투명 UI 단추 위에서도 마우스 위치를 알도록 창 전체에서 받는다
    on(window, 'mousemove', (e) => (this.mouse = this.local(e)));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => {
      // 달리기/걷기 (단축키 설정의 Toggle Run/Walk, 기본 R)
      if (this.enabled && keyBindings.is(e, 'run')) this.run = !this.run;
    });
  }

  dispose(): void {
    for (const f of this.off.splice(0)) f();
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * this.canvas.width) / r.width, y: ((e.clientY - r.top) * this.canvas.height) / r.height };
  }

  /** 가리킨 유닛 (정확히 가리킨 상자, 없으면 가까운 몬스터 — 조준 보조) */
  hoverAt(x: number, y: number): Hover {
    return pickAt(this.pickBoxes, x, y);
  }

  private onDown(e: MouseEvent): void {
    if (e.button !== 0 && e.button !== 2) return;
    const p = this.local(e);
    this.mouse = p;
    if (this.intercept?.(p.x, p.y, e.button, e.shiftKey)) return;
    const cmd = this.commandAt(p, e.button === 2, e.shiftKey);
    if (!cmd) return;
    this.send(cmd);
    this.holding = true;
    this.holdButton = e.button;
    this.holdShift = e.shiftKey;
    this.holdCommand = cmd.type === 'move' ? 'move' : e.button === 2 ? 'skill' : cmd.type === 'attack' ? 'attack' : null;
    this.lastRepeat = performance.now();
  }

  private commandAt(p: { x: number; y: number }, right: boolean, shift: boolean): Command | null {
    const w = fromCanvas(this.camera(), p.x, p.y);
    const base = { worldX: w.x, worldY: w.y, shift, hover: this.hoverAt(p.x, p.y), run: this.run };
    const sk = this.skills();
    return right ? mapRightClick({ ...base, rightSkill: sk.right }) : mapLeftClick({ ...base, leftSkill: sk.left });
  }

  /** 매 렌더 프레임 호출: 버튼을 누르고 있으면 약 200ms 마다 커서 위치로 이동/오른쪽 스킬 명령 재발행 */
  update(now: number): void {
    if (!this.holding || !this.mouse || now - this.lastRepeat < 200) return;
    if (!this.holdCommand) return;
    if (this.holdCommand === 'attack') {
      // 왼쪽 버튼을 누른 채 대상이 죽었다: 커서 아래를 다시 보고 다음 몬스터를 치거나 그쪽으로 이동 (줍기·말 걸기는 새로 눌러야)
      if (!this.idle?.()) return;
      this.lastRepeat = now;
      const cmd = this.commandAt(this.mouse, false, this.holdShift);
      if (cmd?.type !== 'attack' && cmd?.type !== 'move') return;
      this.send(cmd);
      if (cmd.type === 'move') this.holdCommand = 'move';
      return;
    }
    this.lastRepeat = now;
    const w = fromCanvas(this.camera(), this.mouse.x, this.mouse.y);
    if (this.holdCommand === 'move') this.send({ type: 'move', x: w.x, y: w.y, run: this.run });
    else {
      const cmd = this.commandAt(this.mouse, true, false);
      if (cmd) this.send(cmd);
    }
  }
}
