// AI 전술 (이동·대기·공격 선택). AI 함수는 이 함수들과 AiWorld 로만 게임을 조작한다.
// 출처: D2MOO D2Game/src/AI/AiTactics.cpp (https://github.com/ThePhrozenKeep/D2MOO)
import { aiDistance } from '../monster';
import type { AiWorld, MonMode, MonsterUnit } from './types';

export function aiParam(m: MonsterUnit, i: number): number {
  return m.type.aiParams[i] ?? 0;
}
/** 출처: AiThink.cpp AI_RollPercentage (SEED_RollPercentage = rand % 100) */
export const rollPct = (m: MonsterUnit): number => m.rng.pick(100);
/** 출처: AIRollChanceParam — rand%100 < aip[i] */
export const rollChance = (m: MonsterUnit, i: number): boolean => rollPct(m) < aiParam(m, i);

/** 방금 맞았다 (원작 sub_6FCF2E70: AI 상태 3 또는 19) */
export const recentlyHit = (m: MonsterUnit): boolean => m.aiState === 3 || m.aiState === 19;

/** 출처: AITACTICS_IdleInNeutralMode — 중립 모드로 바꾸고 nFrames 뒤 다시 판단 */
export function idle(w: AiWorld, m: MonsterUnit, frames: number): void {
  if (m.mode !== 'NU') w.startMode(m, 'NU');
  m.path = [];
  m.nextThink = w.frame + Math.max(frames, 1);
}

/** 출처: AITACTICS_Idle — 모드는 두고 판단만 미룬다 */
export function wait(w: AiWorld, m: MonsterUnit, frames: number): void {
  m.nextThink = w.frame + Math.max(frames, 1);
}

/** 출처: AiTactics.cpp sub_6FCD0150 — 다음 판단을 늦어도 nFrames 뒤로 (이미 더 이른 판단이 잡혀 있으면 그대로) */
export function waitAtMost(w: AiWorld, m: MonsterUnit, frames: number): void {
  const at = w.frame + Math.max(frames, 1);
  if (m.nextThink <= w.frame || m.nextThink >= at) m.nextThink = at;
}

/** 출처: AITACTICS_SetVelocity — 다음 이동의 속도 % (STAT_VELOCITYPERCENT, −126~126) */
export function setVelocity(m: MonsterUnit, vel: number): void {
  if (vel) m.velPct = Math.max(-126, Math.min(126, vel));
}

/**
 * 출처: AITACTICS_MoveToTarget — 대상 유닛으로 이동. 실패 시 nFlags&2 이면 70% 거리 4 배회 / 30% 10 프레임 대기 (그리고 성공으로 친다)
 */
export function moveToTarget(w: AiWorld, m: MonsterUnit, run: boolean, steps = 1, flags = 0): boolean {
  if (w.moveTo(m, w.target.x, w.target.y, run, steps)) return true;
  if (flags & 2) {
    if (rollPct(m) >= 70) idle(w, m, 10);
    else walkCloseToUnit(w, m, 4);
    return true;
  }
  return false;
}

/** 대상에게 걷기/달리기 (실패하면 aidel 대기). 예전 AI 코드 호환 */
export function walkToTarget(w: AiWorld, m: MonsterUnit, run: boolean): boolean {
  const ok = w.moveTo(m, w.target.x, w.target.y, run, 1);
  if (!ok) idle(w, m, m.type.aiDelay);
  return ok;
}

/** 원작 무작위 방향 오프셋 (한 축은 maxDist 고정, 다른 축 rand(maxDist), 각 부호 랜덤) */
function randomOffset(m: MonsterUnit, maxDist: number): [number, number] {
  let ox: number, oy: number;
  if (Number(m.rng.next() & 1n)) {
    ox = maxDist;
    oy = m.rng.pick(maxDist);
  } else {
    ox = m.rng.pick(maxDist);
    oy = maxDist;
  }
  if (Number(m.rng.next() & 1n)) ox = -ox;
  if (Number(m.rng.next() & 1n)) oy = -oy;
  return [ox, oy];
}

/** 출처: AITACTICS_WalkCloseToUnit — 자기 주변 무작위 지점으로 걷기 */
export function walkCloseToUnit(w: AiWorld, m: MonsterUnit, maxDist: number): boolean {
  const [ox, oy] = randomOffset(m, maxDist);
  return w.moveTo(m, Math.floor(m.x) + ox, Math.floor(m.y) + oy, false, 1);
}

/** 출처: AITACTICS_WanderToTarget — 대상 주변 무작위 지점으로 걷기 */
export function wanderToTarget(w: AiWorld, m: MonsterUnit, maxDist: number): boolean {
  const [ox, oy] = randomOffset(m, maxDist);
  return w.moveTo(m, Math.floor(w.target.x) + ox, Math.floor(w.target.y) + oy, false, 1);
}

/** 출처: D2GAME_AICORE_WalkToOwner_6FCD0B60 / AITACTICS_WanderToTarget — 주어진 지점 주변 무작위 지점으로 걷기 */
export function wanderToPoint(w: AiWorld, m: MonsterUnit, x: number, y: number, maxDist: number): boolean {
  const [ox, oy] = randomOffset(m, maxDist);
  return w.moveTo(m, Math.floor(x) + ox, Math.floor(y) + oy, false, 1);
}

/** 출처: AITACTICS_RunCloseToTargetUnit — 대상 주변 무작위 지점으로 달리기 */
export function runCloseToTarget(w: AiWorld, m: MonsterUnit, maxDist: number): boolean {
  const [ox, oy] = randomOffset(m, maxDist);
  return w.moveTo(m, Math.floor(w.target.x) + ox, Math.floor(w.target.y) + oy, true, 1);
}

/** 출처: D2GAME_AICORE_Escape_6FCD0560 (걷기) / sub_6FCD06D0 (달리기) — 대상 반대 방향 부호 × maxDist 지점 */
export function escape(w: AiWorld, m: MonsterUnit, maxDist: number, run = false): boolean {
  const sx = Math.sign(Math.floor(m.x) - Math.floor(w.target.x));
  const sy = Math.sign(Math.floor(m.y) - Math.floor(w.target.y));
  if (!sx && !sy) return false;
  return w.moveTo(m, Math.floor(m.x) + sx * maxDist, Math.floor(m.y) + sy * maxDist, run, 1);
}

/**
 * 출처: sub_6FCD0E80 — rand(256) < 128 이면 경로 종류 5, 아니면 6 (대상 둘레 시계/반시계 이동), 거리 a4.
 * 근사(원작 미확인): 원작 원형 경로(PATHTYPE 5/6) 대신 대상 중심으로 현재 반지름을 유지하며 약 1/8 바퀴 도는 지점으로 걷는다.
 */
export function circle(w: AiWorld, m: MonsterUnit, a4: number): boolean {
  const cw = (m.rng.roll() & 0xff) < 128;
  const dx = m.x - w.target.x, dy = m.y - w.target.y;
  const r = Math.max(Math.hypot(dx, dy), 3);
  const step = Math.max(a4, 3) / r;
  const a = Math.atan2(dy, dx) + (cw ? step : -step);
  return w.moveTo(m, w.target.x + Math.cos(a) * r, w.target.y + Math.sin(a) * r, false, 1);
}

/**
 * 출처: AITACTICS_MoveInRadiusToTarget — 대상과의 거리를 a6 에 맞추도록 최대 a5 만큼 대상 쪽(또는 반대쪽)으로 이동
 */
export function walkInRadius(w: AiWorld, m: MonsterUnit, a5: number, a6: number): boolean {
  const dist = aiDistance(m.x, m.y, w.target.x, w.target.y);
  const sign = Math.sign(dist - a6);
  const diff = Math.min(Math.abs(dist - a6), a5);
  const tx = Math.floor(w.target.x), ty = Math.floor(w.target.y), x = Math.floor(m.x), y = Math.floor(m.y);
  const xd = Math.abs(tx - x), yd = Math.abs(ty - y);
  const sum = Math.max(xd + yd, diff);
  let ox = 0, oy = 0;
  if (sum > 0) {
    ox = Math.trunc((diff * xd) / sum);
    oy = Math.trunc((diff * yd) / sum);
    while (ox + oy < diff) {
      ox++;
      oy++;
    }
  }
  return w.moveTo(m, x + sign * ox * Math.sign(tx - x), y + sign * oy * Math.sign(ty - y), false, 1);
}

/** 출처: AITACTICS_ChangeModeAndTargetUnitToAttack1Or2 — aip[i]% 로 A1, 아니면 A2 */
export function attack1Or2(w: AiWorld, m: MonsterUnit, paramIdx: number): void {
  w.startMode(m, (rollChance(m, paramIdx) ? 'A1' : 'A2') as MonMode);
}
