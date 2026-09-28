// 게임 시뮬레이션: 명령 큐 → 고정 25fps 틱 → 이벤트 + 읽기 전용 스냅샷.
import type { Command } from './command';
import { CollisionMap } from './collision';
import { angleIndex, SUBTILES_PER_YARD, type Pt } from './geom';
import { ENGINE_FPS } from './index';
import { findPath, nearestWalkable } from './path';
import { Rng } from './rng';

/** 원작 애니메이션 모드 토큰 (COF 파일명에 쓰이는 2글자): NU 대기, WL 걷기, RN 달리기 */
export type PlayerMode = 'NU' | 'WL' | 'RN' | 'TN';

export interface PlayerInit {
  x: number;
  y: number;
  /** charstats.txt WalkVelocity / RunVelocity (단위: 야드/초) */
  walkVelocity: number;
  runVelocity: number;
}

export interface GameEvent { type: string; [k: string]: unknown }

export interface PlayerSnapshot { id: number; x: number; y: number; mode: PlayerMode; dir16: number }
export interface WorldSnapshot { tick: number; player: PlayerSnapshot }

interface PlayerState extends PlayerSnapshot {
  path: Pt[];
  running: boolean;
  walkVelocity: number;
  runVelocity: number;
}

export class Game {
  readonly map: CollisionMap;
  readonly rng: Rng;
  private tickCount = 0;
  private readonly queue: Command[] = [];
  private readonly player: PlayerState;

  constructor(map: CollisionMap, player: PlayerInit, seed: number) {
    this.map = map;
    this.rng = new Rng(seed);
    this.player = {
      id: 1, x: player.x, y: player.y, mode: 'NU', dir16: 0, path: [], running: false,
      walkVelocity: player.walkVelocity, runVelocity: player.runVelocity,
    };
  }

  enqueue(cmd: Command): void {
    this.queue.push(cmd);
  }

  tick(): GameEvent[] {
    const events: GameEvent[] = [];
    for (const cmd of this.queue.splice(0)) this.apply(cmd, events);
    this.movePlayer(events);
    this.tickCount++;
    return events;
  }

  snapshot(): Readonly<WorldSnapshot> {
    const p = this.player;
    return { tick: this.tickCount, player: { id: p.id, x: p.x, y: p.y, mode: p.mode, dir16: p.dir16 } };
  }

  private apply(cmd: Command, events: GameEvent[]): void {
    switch (cmd.type) {
      case 'move': {
        const target = nearestWalkable(this.map, cmd);
        const path = target ? findPath(this.map, this.player, { x: target.x + 0.5, y: target.y + 0.5 }) : null;
        if (!path) {
          events.push({ type: 'moveBlocked' });
          return;
        }
        this.player.path = path;
        this.player.running = cmd.run;
        return;
      }
      default:
        events.push({ type: 'unhandledCommand', command: cmd.type });
    }
  }

  /** 1프레임 이동량 (서브타일) = 속도(야드/초) × 1.5 / 25 */
  private stepLength(): number {
    const v = this.player.running ? this.player.runVelocity : this.player.walkVelocity;
    return (v * SUBTILES_PER_YARD) / ENGINE_FPS;
  }

  private movePlayer(events: GameEvent[]): void {
    const p = this.player;
    let budget = this.stepLength();
    if (p.path.length === 0) {
      if (p.mode !== 'NU') {
        p.mode = 'NU';
        events.push({ type: 'arrived', x: p.x, y: p.y });
      }
      return;
    }
    p.mode = p.running ? 'RN' : 'WL';
    while (budget > 0 && p.path.length > 0) {
      const next = p.path[0] as Pt;
      const dx = next.x - p.x, dy = next.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-9) p.dir16 = angleIndex(dx, dy, 16);
      if (d <= budget) {
        p.x = next.x;
        p.y = next.y;
        budget -= d;
        p.path.shift();
      } else {
        p.x += (dx / d) * budget;
        p.y += (dy / d) * budget;
        budget = 0;
      }
    }
  }
}
