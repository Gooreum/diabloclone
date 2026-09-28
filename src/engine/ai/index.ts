// 몬스터 AI (Blood Moor: Zombie, Fallen, QuillRat) + AI 전술.
// 출처: D2MOO — D2Game/src/AI/AiThink.cpp AITHINK_Fn003_Zombie / Fn006_Fallen / Fn014_QuillRat (분기·파라미터 그대로),
//       AiTactics.cpp AITACTICS_WalkCloseToUnit / D2GAME_AICORE_Escape / AITACTICS_Idle, AiTactics.cpp sub_6FCCF9D0
//       (대상 없음 시 거리별 대기 10~25 프레임), AiUtil.cpp sub_6FCF2110 (aidist 기본 35, 마을 플레이어 제외)
//       (https://github.com/ThePhrozenKeep/D2MOO)
// 근사(원작 미확인): 이동 완료/공격 종료 후 다음 판단까지 monstats aidel 프레임 대기, 경로는 엔진 A* 사용.
import type { MonsterStats, MonsterType } from '../monster';
import { aiDistance, isInMeleeRange } from '../monster';
import type { Pt } from '../geom';
import type { Rng } from '../rng';

export type MonMode = 'NU' | 'WL' | 'RN' | 'A1' | 'A2' | 'S2' | 'GH' | 'DT' | 'DD';

export interface MonsterUnit {
  id: number;
  type: MonsterType;
  stats: MonsterStats;
  x: number;
  y: number;
  hp: number;
  mode: MonMode;
  dir: number;
  path: Pt[];
  moveSpeed: number;
  /** 다음 AI 판단 프레임 */
  nextThink: number;
  modeStart: number;
  modeEnd: number;
  hitTick: number;
  hitDone: boolean;
  rng: Rng;
  /** 공격을 받았음 (AI state 19 — AiUtil sub_6FCF2E70) */
  aggro: boolean;
  /** Fallen: 동료 사망으로 도주 중 (dwAiParam[0]) */
  aiParam0: number;
  /** Fallen 리더 명령 (AI command param 1) */
  command: number;
  leaderId: number;
  deathFrame: number;
}

export interface AiTarget { x: number; y: number; size: number; dead: boolean; inTown: boolean }

/** AI 가 게임 월드에 요청하는 동작 (Game 이 구현) */
export interface AiWorld {
  frame: number;
  target: AiTarget;
  /** 주변 몬스터 (Fallen 동료 사망 감지, 리더 명령) */
  monsters: readonly MonsterUnit[];
  startMode(m: MonsterUnit, mode: MonMode): void;
  moveTo(m: MonsterUnit, x: number, y: number, run: boolean): boolean;
}

const PLAYER_SIZE = 2;

export function aiParam(m: MonsterUnit, i: number): number {
  return m.type.aiParams[i] ?? 0;
}
const rollPct = (m: MonsterUnit) => m.rng.pick(100);
const rollChance = (m: MonsterUnit, i: number) => rollPct(m) < aiParam(m, i);

// ---------------------------------------------------------------- tactics

export function idle(w: AiWorld, m: MonsterUnit, frames: number): void {
  if (m.mode !== 'NU') w.startMode(m, 'NU');
  m.path = [];
  m.nextThink = w.frame + Math.max(frames, 1);
}

/** 출처: AITACTICS_WalkCloseToUnit — 한 축은 maxDist 고정, 다른 축 rand(maxDist), 각 부호 랜덤 */
export function walkCloseToUnit(w: AiWorld, m: MonsterUnit, maxDist: number): void {
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
  if (!w.moveTo(m, m.x + ox, m.y + oy, false)) idle(w, m, m.type.aiDelay);
}

export function walkToTarget(w: AiWorld, m: MonsterUnit, run: boolean): boolean {
  const ok = w.moveTo(m, w.target.x, w.target.y, run);
  if (!ok) idle(w, m, m.type.aiDelay);
  return ok;
}

/** 출처: D2GAME_AICORE_Escape — 대상 반대 방향 부호 × maxDist 지점으로 이동 */
export function escape(w: AiWorld, m: MonsterUnit, maxDist: number): boolean {
  const sx = Math.sign(Math.floor(m.x) - Math.floor(w.target.x));
  const sy = Math.sign(Math.floor(m.y) - Math.floor(w.target.y));
  return w.moveTo(m, m.x + sx * maxDist, m.y + sy * maxDist, false);
}

function attack1Or2(w: AiWorld, m: MonsterUnit, paramIdx: number): void {
  w.startMode(m, rollChance(m, paramIdx) ? 'A1' : 'A2');
}

// ---------------------------------------------------------------- AI functions

/** 출처: AITHINK_Fn003_Zombie — aip1 접근 확률, aip2 인지 거리, aip4 공격1/2 확률 */
function zombie(w: AiWorld, m: MonsterUnit, dist: number, combat: boolean): void {
  if (combat) {
    attack1Or2(w, m, 3);
    return;
  }
  if (m.aggro || (dist < aiParam(m, 1) && rollChance(m, 0))) {
    walkToTarget(w, m, true); // SetVelocity(0,100) + RunToTargetUnit
    return;
  }
  walkCloseToUnit(w, m, 3);
}

/** 출처: AITHINK_Fn006_Fallen — aip1 리더 공격 명령 확률, aip2 접근 거리, aip3 공격 확률, aip4 공격1/2 확률 */
function fallen(w: AiWorld, m: MonsterUnit, dist: number, combat: boolean): void {
  // 주변(15 이내)에서 막 죽은(DT 모드) 동료가 있으면 12 만큼 도주
  const corpse = w.monsters.find((o) => o !== m && o.mode === 'DT' && aiDistance(o.x, o.y, m.x, m.y) < 15);
  if (corpse) {
    m.aiParam0 = 1;
    m.command = 0;
    if (escape(w, m, 12)) return;
  }
  if (m.mode !== 'NU') {
    idle(w, m, 10);
    return;
  }
  if (m.command !== 1) {
    if (!combat && m.aggro) {
      walkToTarget(w, m, false);
      return;
    }
    const isLeader = m.leaderId === m.id;
    if (dist < 15 && isLeader && rollChance(m, 0)) {
      for (const o of w.monsters) if (o.leaderId === m.id && o !== m && o.mode !== 'DT' && o.mode !== 'DD') o.command = 1;
      m.command = 1;
      w.startMode(m, 'S2');
      return;
    }
    if (!combat) {
      if (dist <= aiParam(m, 1)) {
        walkToTarget(w, m, false);
        return;
      }
      if (rollPct(m) < 30) {
        walkCloseToUnit(w, m, 3);
        return;
      }
      idle(w, m, 10);
      return;
    }
    if (!m.aiParam0 && !rollChance(m, 2)) {
      if (rollPct(m) < 30) {
        w.startMode(m, 'S2');
        return;
      }
      idle(w, m, 10);
      return;
    }
    m.aiParam0 = 0;
    attack1Or2(w, m, 3);
    return;
  }
  // 리더 명령(공격) 수행 중
  if (combat) {
    if (!rollChance(m, 2)) {
      idle(w, m, 5);
      return;
    }
    attack1Or2(w, m, 3);
    return;
  }
  if (!walkToTarget(w, m, false)) m.command = 0;
}

/** 출처: AITHINK_Fn014_QuillRat — aip1 활성 거리, aip2 발사 확률, aip4 걷기 거리 */
function quillRat(w: AiWorld, m: MonsterUnit, dist: number, combat: boolean): void {
  if (combat) {
    w.startMode(m, 'A1');
    return;
  }
  if (m.aggro) {
    w.startMode(m, 'A2');
    return;
  }
  const walkDist = Math.max(aiParam(m, 3), 3);
  if (dist >= aiParam(m, 0)) {
    walkCloseToUnit(w, m, walkDist);
    return;
  }
  if (rollChance(m, 1)) {
    w.startMode(m, 'A2');
    return;
  }
  if (!escape(w, m, aiParam(m, 3))) {
    if (dist < 4) {
      w.startMode(m, 'A2');
      return;
    }
    walkCloseToUnit(w, m, walkDist);
  }
}

const AI_FNS: Record<string, (w: AiWorld, m: MonsterUnit, dist: number, combat: boolean) => void> = {
  Zombie: zombie,
  Fallen: fallen,
  QuillRat: quillRat,
};

export function hasAi(ai: string): boolean {
  return ai in AI_FNS;
}

/** 한 번의 AI 판단. 대상이 없거나 멀면 거리별 대기 (출처: sub_6FCCF9D0) */
export function think(w: AiWorld, m: MonsterUnit): void {
  const t = w.target;
  const maxDist = m.type.aiDist || 35;
  const dist = aiDistance(m.x, m.y, t.x, t.y);
  if (t.dead || t.inTown || dist >= maxDist) {
    if (m.aggro && !t.dead && !t.inTown) {
      walkCloseToUnit(w, m, 5);
      return;
    }
    idle(w, m, dist >= 35 ? 25 : dist >= 25 ? dist - 10 : 10);
    return;
  }
  const combat = isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, t.x, t.y, PLAYER_SIZE);
  const fn = AI_FNS[m.type.ai];
  if (fn) fn(w, m, dist, combat);
  else idle(w, m, 25);
}
