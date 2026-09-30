// 마을 NPC AI (monstats AI = Npc / Navi / Idle).
// 출처: D2MOO D2Game/src/AI/AiThink.cpp — AITHINK_Fn032_Npc, sub_6FCE5EE0 (플레이어 쪽으로 다가가기·인사), sub_6FCE69A0 (명령 4 걷기·7 스킬),
//       AITHINK_ExecuteMapAiAction + sub_6FCE61E0 / sub_6FCE6270 / sub_6FCE6340 / sub_6FCE64D0 (DS1 경로 동작 1~5), AITHINK_Fn058_Navi
//       AiTactics.cpp sub_6FCCFD70 (거리 15 안 가장 가까운 플레이어),
//       AITHINK_Fn041_Towner (마을 주민: 명령 → 경로 동작 → 12 프레임), AITHINK_Fn042_Vendor (노점상: 20% S1),
//       AITHINK_Fn054_NpcStationary (Tyrael: 제자리, 인사 60 프레임), AITHINK_Fn081_JarJar (Kaelan: 문지기 자리) (https://github.com/ThePhrozenKeep/D2MOO)
import { aiDistance } from '../monster';
import { dir64 } from '../geom';
import { idle, rollPct, walkInRadius } from './tactics';
import type { AiWorld, MonMode, MonsterUnit } from './types';

/** DS1 경로 점 (action: 1·3 걷기, 2 걷기+머무름, 4 걷기 후 S1, 5 걷기 후 S2) */
export interface NpcPathNode { x: number; y: number; action: number }

export interface NpcState {
  /** 원위치 (AI 명령 10) */
  home: { x: number; y: number };
  /** monstats interact (말을 걸 수 있음) */
  interact: boolean;
  /** 플레이어와 대화 중 (MONSTERAI_HasInteractUnit) */
  talking: boolean;
  /** 인사 대기 (dwAiParam[1]: 0 이면 인사하고 60) */
  greet: number;
  /** 명령 4: 지점으로 걷기, 남은 판단 횟수, 도착 후 대기 프레임 */
  walk?: { x: number; y: number; left: number; idle: number };
  /** 명령 7: 지점에 가서 스킬 모드 (S1/S2), 남은 시도 */
  skill?: { mode: MonMode | null; x: number; y: number; tries: number };
  /** DS1 프리셋 경로 (원작 pMapAi) */
  path: NpcPathNode[];
  /** 인사 이벤트 (UI 소리 자리 — Phase 11) */
  greeted?: number;
}

/**
 * NPC 가 도착 후 바라보는 방향 (64 방향). 출처: sub_6FCE69A0 — Charsi 0x38, Warriv 0x34, Fara 4, Jamella S1 0x34 / S2 0x30
 *   (명령 7 도착 시 D2COMMON_10160_PathUpdateDirection)
 */
const FACE: Record<string, number> = { charsi: 0x38, warriv1: 0x34, fara: 4, jamella: 0x34 };
const faceFor = (id: string, mode: MonMode | null): number | undefined => (id === 'jamella' && mode === 'S2' ? 0x30 : FACE[id]);

const dirTo = (m: MonsterUnit, x: number, y: number): number => (x === m.x && y === m.y ? m.dir : dir64(x - m.x, y - m.y));

/** 출처: sub_6FCE5EE0 — 플레이어가 15 안에 있으면 다가가거나(원위치 16 안) 원위치로, 2 이내면 멈춰 인사 */
function approachPlayer(w: AiWorld, m: MonsterUnit, s: NpcState, playerBusy: boolean, face: (m: MonsterUnit) => void): boolean {
  const t = w.target;
  const dist = aiDistance(m.x, m.y, t.x, t.y);
  const near = !t.dead && dist <= 15;
  if (s.talking || (near && playerBusy)) {
    face(m);
    idle(w, m, 8);
    return true;
  }
  if (!near) return false;
  if (dist <= 2) {
    face(m);
    if (s.greet > 0) s.greet--;
    else {
      s.greet = 60;
      s.greeted = w.frame;
    }
    idle(w, m, 20);
    return true;
  }
  if (aiDistance(m.x, m.y, s.home.x, s.home.y) <= 16) {
    walkInRadius(w, m, dist < 5 ? dist - 2 : 3, 2);
    if (m.mode === 'NU') idle(w, m, 10);
    return true;
  }
  s.walk = { x: s.home.x, y: s.home.y, left: 12, idle: 10 };
  idle(w, m, 10);
  return true;
}

/** 출처: sub_6FCE69A0 — 명령 4 (지점으로 걸어가 머무르기), 명령 7 (지점에서 S1/S2) */
function runCommands(w: AiWorld, m: MonsterUnit, s: NpcState): boolean {
  const wk = s.walk;
  if (wk && wk.left > 0) {
    wk.left--;
    if (aiDistance(m.x, m.y, wk.x, wk.y) > 3) {
      if (!w.moveTo(m, wk.x, wk.y, false)) idle(w, m, wk.idle);
      return true;
    }
    idle(w, m, wk.idle);
    return true;
  }
  const sk = s.skill;
  if (!sk) return false;
  const d = aiDistance(m.x, m.y, sk.x, sk.y);
  if (d <= 0 || sk.tries <= 0) {
    if (d > 1) sk.mode = null;
    const f = faceFor(m.type.id, sk.mode);
    if (f !== undefined) m.dir = f;
    if (sk.mode) {
      if (m.mode === sk.mode) idle(w, m, 50);
      else {
        w.startMode(m, sk.mode);
        if (f !== undefined) m.dir = f;
        m.nextThink = w.frame + 1;
      }
      s.skill = undefined;
      return true;
    }
    s.skill = undefined;
    // 출처: sub_6FCE69A0 — Fara 는 66% 로 다시 망치질 (명령 7 을 모드 8(S1)로)
    if (m.type.id === 'fara' && rollPct(m) < 66 && m.type.modes.has('S1')) s.skill = { mode: 'S1', x: m.x, y: m.y, tries: 0 };
    return false;
  }
  sk.tries--;
  if (!w.moveTo(m, sk.x, sk.y, false)) idle(w, m, 25);
  return true;
}

/** 출처: AITHINK_ExecuteMapAiAction — 66% 로 DS1 경로 점 하나를 골라 그 동작 */
function mapAction(w: AiWorld, m: MonsterUnit, s: NpcState): boolean {
  if (!s.path.length || rollPct(m) >= 66) return false;
  const p = s.path[m.rng.pick(s.path.length)] as NpcPathNode;
  if (p.action < 1 || p.action > 5) return false;
  const moved = aiDistance(m.x, m.y, p.x, p.y) > 0 && w.moveTo(m, p.x, p.y, false);
  s.walk = { x: p.x, y: p.y, left: 12, idle: 10 };
  if (p.action === 4 || p.action === 5) {
    const mode: MonMode = p.action === 4 ? 'S1' : 'S2';
    s.skill = { mode: m.type.modes.has(mode) ? mode : null, x: p.x, y: p.y, tries: 4 };
    // 원작: 명령 7 뒤에 명령 4 가 다시 쌓인다 — 스킬이 먼저 처리되도록 걷기 명령은 비운다 (근사)
    s.walk = undefined;
  }
  return moved || p.action === 4 || p.action === 5;
}

/**
 * 마을 NPC 한 번 판단 (Npc AI). 다가가기 → 명령 → 경로 동작 → 8 프레임 대기.
 * 근사(원작 미확인): AITACTICS_SetVelocity 의 NPC 속도 인자(1·5·7) 는 무시하고 monstats Velocity 로 걷는다
 */
export function thinkNpc(w: AiWorld, m: MonsterUnit, s: NpcState, playerBusy: boolean): void {
  const face = (u: MonsterUnit) => {
    u.dir = dirTo(u, w.target.x, w.target.y);
  };
  if (m.type.ai === 'Towner') {
    // 출처: AITHINK_Fn041_Towner — 명령(걷기·스킬) → DS1 경로 동작 → 12 프레임 대기
    if (runCommands(w, m, s) || mapAction(w, m, s)) return;
    idle(w, m, 12);
    return;
  }
  if (m.type.ai === 'Vendor') {
    // 출처: AITHINK_Fn042_Vendor — 20% 로 S1 (호객), 아니면 30 프레임 대기
    if (rollPct(m) < 20 && m.type.modes.has('S1')) w.startMode(m, 'S1');
    else idle(w, m, 30);
    return;
  }
  if (m.type.ai === 'Idle' || !s.interact) {
    // 장식 유닛 (Rogue 경비·닭·소): 제자리 (출처: AI Idle)
    idle(w, m, 25);
    return;
  }
  if (m.type.ai === 'NpcStationary') {
    // 출처: AITHINK_Fn054_NpcStationary — 움직이지 않는다. 대화 중·바쁜 플레이어면 10, 24 안에 들어오면 인사(60 프레임마다) 후 20
    const dist = aiDistance(m.x, m.y, w.target.x, w.target.y);
    if (s.talking || playerBusy) {
      idle(w, m, 10);
      return;
    }
    if (dist < 24) {
      if (s.greet > 0) s.greet--;
      else {
        s.greet = 60;
        s.greeted = w.frame;
      }
    }
    idle(w, m, 20);
    return;
  }
  if (m.type.ai === 'JarJar') {
    // 출처: AITHINK_Fn081_JarJar — 문지기 자리(원위치)에서 1 넘게 벗어나면 돌아가고, 자리에 있으면 플레이어에게 인사(sub_6FCE5EE0)
    // 근사(원작 미확인): ACT2Q4 가 정하는 경비 이동(궁전 문 열기)은 Phase 7 — 여기서는 원위치만
    if (aiDistance(m.x, m.y, s.home.x, s.home.y) > 1 && !s.talking) {
      if (!w.moveTo(m, s.home.x, s.home.y, false)) idle(w, m, 20);
      return;
    }
    const dist = aiDistance(m.x, m.y, w.target.x, w.target.y);
    if (s.talking || (dist <= 15 && !w.target.dead)) face(m);
    idle(w, m, 20);
    return;
  }
  if (m.type.ai === 'Navi') {
    // 출처: AITHINK_Fn058_Navi — 대화 중이면 대기, 가까운 플레이어(4 미만)에게 3분의 2 확률로 인사·대기
    // 근사(원작 미확인): 거리 25 안 몬스터에게 활 쏘기(ATTACK1)는 생략
    const dist = aiDistance(m.x, m.y, w.target.x, w.target.y);
    if (s.talking || (dist < 4 && !playerBusy && m.rng.roll() % 3)) face(m);
    idle(w, m, s.talking ? 10 : 20);
    return;
  }
  if (approachPlayer(w, m, s, playerBusy, face)) return;
  if (runCommands(w, m, s)) return;
  if (mapAction(w, m, s)) return;
  idle(w, m, 8);
}
