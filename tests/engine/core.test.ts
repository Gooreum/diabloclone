import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/engine/rng';
import { CollisionMap } from '../../src/engine/collision';
import { findPath } from '../../src/engine/path';
import { Game } from '../../src/engine/game';
import { GameTables, num } from '../../src/data/tables';
import { gameChain, hasGameData } from '../support/gamedata';

describe('RNG (출처: libd2 rng.zig — state64 = low * 0x6AC690C5 + high)', () => {
  it('low=1, high=666 에서 한 단계 → low = 0x6AC690C5 + 666', () => {
    const r = new Rng(1, 666);
    r.next();
    expect(r.low).toBe((0x6ac690c5 + 666) >>> 0);
    expect(r.high).toBe(0);
  });
  it('64비트 곱의 상위 워드가 high 로 넘어간다', () => {
    const r = new Rng(0xffffffff, 0);
    r.next();
    const state = 0xffffffffn * 0x6ac690c5n;
    expect(r.low).toBe(Number(state & 0xffffffffn));
    expect(r.high).toBe(Number(state >> 32n));
  });
  it('같은 시드 = 같은 수열 (결정성)', () => {
    const a = new Rng(12345), b = new Rng(12345);
    expect(Array.from({ length: 20 }, () => a.pick(100))).toEqual(Array.from({ length: 20 }, () => b.pick(100)));
  });
  it('pick: 2의 거듭제곱은 마스크, modulo<1 은 0', () => {
    const r = new Rng(7);
    for (let i = 0; i < 100; i++) expect(r.pick(8)).toBeLessThan(8);
    expect(r.pick(0)).toBe(0);
  });
});

describe('경로 탐색', () => {
  const map = CollisionMap.fromRows([
    '..........',
    '.########.',
    '..........',
  ]);
  it('벽을 돌아가는 경로', () => {
    const path = findPath(map, { x: 0.5, y: 0.5 }, { x: 5.5, y: 2.5 });
    expect(path).not.toBeNull();
    expect(path?.at(-1)).toEqual({ x: 5.5, y: 2.5 });
    for (const p of path ?? []) expect(map.walkable(Math.floor(p.x), Math.floor(p.y))).toBe(true);
  });
  it('막힌 목표는 null', () => {
    expect(findPath(map, { x: 0.5, y: 0.5 }, { x: 3.5, y: 1.5 })).toBeNull();
  });
});

describe('Game: move 명령 → 이동 시뮬레이션', () => {
  const open = () => new CollisionMap(40, 40);
  // 출처: Maxroll — Run/Walk Mechanics "Walking: 6 yards / s", "Running: 9 yards / s"
  //       Phrozen Keep KB a=463 — 1 야드 = 1.5 서브타일, 1 프레임 = 1/25 초
  //       → 걷기 9 서브타일/초 = 0.36/프레임, 달리기 13.5 서브타일/초 = 0.54/프레임
  it('걷기: 9 서브타일 직선 이동에 25 프레임(1초)', () => {
    const g = new Game({ map: open(), player: { x: 5.5, y: 5.5, walkVelocity: 6, runVelocity: 9 }, seed: 1 });
    g.enqueue({ type: 'move', x: 14.5, y: 5.5, run: false });
    for (let i = 0; i < 24; i++) g.tick();
    expect(g.snapshot().player.x).toBeLessThan(14.5);
    expect(g.snapshot().player.mode).toBe('WL');
    g.tick();
    expect(g.snapshot().player.x).toBeCloseTo(14.5, 5);
  });
  it('달리기: 13.5 서브타일에 25 프레임', () => {
    const g = new Game({ map: open(), player: { x: 5.5, y: 5.5, walkVelocity: 6, runVelocity: 9 }, seed: 1 });
    g.enqueue({ type: 'move', x: 19, y: 5.5, run: true });
    for (let i = 0; i < 25; i++) g.tick();
    expect(g.snapshot().player.x).toBeCloseTo(19, 5);
  });
  it('도착 후 대기(NU) 모드와 arrived 이벤트', () => {
    const g = new Game({ map: open(), player: { x: 5.5, y: 5.5, walkVelocity: 6, runVelocity: 9 }, seed: 1 });
    g.enqueue({ type: 'move', x: 7.5, y: 5.5, run: false });
    const events = Array.from({ length: 30 }, () => g.tick()).flat();
    expect(g.snapshot().player.mode).toBe('NU');
    expect(events.some((e) => e.type === 'arrived')).toBe(true);
  });
  it('벽 안 좌표로 move 하면 가장 가까운 이동 가능 지점으로 간다', () => {
    const map = open();
    for (let y = 0; y < 40; y++) map.block(20, y);
    const g = new Game({ map: map, player: { x: 5.5, y: 5.5, walkVelocity: 6, runVelocity: 9 }, seed: 1 });
    g.enqueue({ type: 'move', x: 20.5, y: 5.5, run: true });
    for (let i = 0; i < 100; i++) g.tick();
    const p = g.snapshot().player;
    expect(map.walkable(Math.floor(p.x), Math.floor(p.y))).toBe(true);
    expect(Math.abs(p.x - 20.5)).toBeLessThanOrEqual(1.01);
  });
  it('완전히 갇힌 곳으로 move 하면 이동 없이 moveBlocked', () => {
    const map = open();
    for (let i = 25; i <= 35; i++) { map.block(i, 25); map.block(i, 35); map.block(25, i); map.block(35, i); }
    const g = new Game({ map: map, player: { x: 5.5, y: 5.5, walkVelocity: 6, runVelocity: 9 }, seed: 1 });
    g.enqueue({ type: 'move', x: 30.5, y: 30.5, run: false });
    const ev = g.tick();
    expect(ev.some((e) => e.type === 'moveBlocked')).toBe(true);
    expect(g.snapshot().player.x).toBe(5.5);
  });
});

describe.skipIf(!hasGameData)('원작 charstats.txt 속도 값', () => {
  // 출처: charstats.txt WalkVelocity/RunVelocity 컬럼 = Maxroll 기재 6/9 야드/초와 일치해야 한다
  it('5클래스 모두 WalkVelocity 6, RunVelocity 9', () => {
    const t = new GameTables(gameChain());
    for (const cls of ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian']) {
      const r = t.row('charstats', 'class', cls);
      expect([num(r?.WalkVelocity), num(r?.RunVelocity)]).toEqual([6, 9]);
    }
  });
});
