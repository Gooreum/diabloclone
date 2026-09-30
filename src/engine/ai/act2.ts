// Act 2 몬스터 AI (monstats AI 컬럼 이름 → AI 함수). aip1~8 은 aiParam(m, 0~7).
// 출처: D2MOO D2Game/src/AI/AiThink.cpp (https://github.com/ThePhrozenKeep/D2MOO)
//   AITHINK_Fn008_SandRaider (+ TargetCallback_SandRaider), Fn011_Baboon, Fn015_SandMaggot, Fn016_ClawViper, Fn017_SandLeaper,
//   Fn018_PantherWoman (+ TargetCallback_Panther), Fn012_019_Goatman_Swarm, Fn020_Scarab, Fn021_Mummy, Fn022_GreaterMummy
//   (+ TargetCallback_GreaterMummy), Fn023_Vulture (+ sub_6FCD55D0, TargetCallback_Vulture), Fn029_BatDemon, Fn038_MaggotLarva,
//   Fn039_PinHead, Fn040_MaggotEgg, Fn044_Duriel, Fn045_Sarcophagus, Fn053_Summoner, Fn066_SandMaggotQueen, Fn078/079 TrapArrow,
//   Fn087_TrapMelee, Fn093_ArcaneTower, Fn094_DesertTurret, Fn095_PantherJavelin — 분기·파라미터·난수 호출 순서 그대로
// 근사(원작 미확인): 원작 "주변 방 유닛" 검색(sub_6FCF1E80 콜백 1)은 레벨 몬스터 목록에서 거리 40 안으로 대신한다.
import { aiDistance } from '../monster';
import { MONFLAG } from '../uniques';
import { ACT1_AI, type AiFn } from './act1';
import {
  aiParam, attack1Or2, circle, escape, idle, moveToTarget, recentlyHit, rollChance, rollPct, setVelocity, wait, waitAtMost, walkCloseToUnit, walkInRadius, wanderToPoint,
} from './tactics';
import type { AiWorld, MonMode, MonsterUnit } from './types';

/** 대상 스킬 인자 (원작 pAiTickParam->pTarget) */
export const tgt = (w: AiWorld) => ({ unitId: w.target.id, x: w.target.x, y: w.target.y });
/** monstats Skill 칸이 있는가 (원작 nSkill[i] >= 0) */
export const hasSkill = (m: MonsterUnit, i: number): boolean => !!m.type.skills[i]?.name;
/** 원작 AITHINK_GetSquaredDistance (서브타일 좌표 차의 제곱합) */
export const sqDist = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = Math.floor(ax) - Math.floor(bx), dy = Math.floor(ay) - Math.floor(by);
  return dx * dx + dy * dy;
};
/** 살아 있는 (죽는 중·시체가 아닌) 몬스터 */
export const alive = (o: MonsterUnit): boolean => o.mode !== 'DT' && o.mode !== 'DD';
/** 같은 편 몬스터 (원작 STATLIST_GetUnitAlignment == EVIL: 소환수·NPC·전향된 몬스터 제외) */
export const evil = (o: MonsterUnit): boolean => !o.pet && !o.npc && !o.states.has('conversion');
/** 근사(원작 미확인): 원작 sub_6FCF1E80(콜백 1) 의 "이웃 방" 범위 — 거리 40 */
export const neighbours = (w: AiWorld, m: MonsterUnit): MonsterUnit[] => w.monsters.filter((o) => o !== m && aiDistance(o.x, o.y, m.x, m.y) <= 40);
/** 원작 AITACTICS_ChangeModeAndTargetUnit — 모드 (AiWorld.modeOnly 가 없으면 startMode) */
export const modeOnly = (w: AiWorld, m: MonsterUnit, mode: MonMode): void => (w.modeOnly ? w.modeOnly(m, mode) : w.startMode(m, mode));
/** 원작 run/velocity 비율 (Baboon·Zealot·FingerMage): 100 × Run / Velocity − 100 (최대 120) */
export const runVel = (m: MonsterUnit, strict: boolean): number => {
  if (m.type.velocity <= 0) return 0;
  const r = Math.trunc((100 * m.type.run) / m.type.velocity);
  return (strict ? r > 100 : r >= 100) ? Math.min(r - 100, 120) : 0;
};
/** HP 재생 보너스 켜기 (원작 STAT_HPREGEN += hpregen × aip / 8). 재생이 없는 몬스터는 0 */
export const regenOn = (m: MonsterUnit, aip: number): number => (m.hpRegen && m.type.damageRegen > 0 ? aip : 0);

/** 출처: AITHINK_Fn008_SandRaider — aip1 다친 %, aip2 선회, aip3 공격, aip4 접근, aip5 충전 시간, aip6 충전 색, aip7 공격2 */
const sandRaider: AiFn = (w, m, dist, combat) => {
  const color = aiParam(m, 5) === 1 ? 'blue' : 'red';
  if (!m.ai[0]) {
    m.states.remove('blue');
    m.states.remove('red');
    m.ai[1] = 0;
  }
  m.ai[0]++;
  const charge = aiParam(m, 4);
  if (m.ai[0] === charge) {
    // UNITS_SetOverlay (충전 번쩍임) 뒤 aidel + 1 쉼
    idle(w, m, m.type.aiDelay + 1);
    return;
  }
  if (m.ai[0] > charge) {
    m.states.set(color, Infinity);
    m.ai[1] = 1;
  }
  if (m.ai[2] < 7 && w.lifePct(m) < aiParam(m, 0)) {
    // 출처: AITHINK_TargetCallback_SandRaider — 가장 가까운 살아 있는 같은 편 몬스터 쪽으로
    let best: MonsterUnit | undefined, bd = Infinity;
    for (const o of neighbours(w, m)) {
      if (!evil(o) || !alive(o)) continue;
      const d = sqDist(m.x, m.y, o.x, o.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (best) {
      w.moveTo(m, best.x, best.y, false, 1);
      return;
    }
    m.ai[2]++;
  }
  if (dist > 4 && !m.ai[1] && rollChance(m, 1)) {
    circle(w, m, 0);
    return;
  }
  if (combat) {
    if (m.ai[1] === 1 && hasSkill(m, 0)) {
      w.useSkill(m, 0, tgt(w));
      m.ai[0] = 0;
      m.ai[1] = 0;
      return;
    }
    if (rollChance(m, 2)) {
      w.startMode(m, rollChance(m, 6) ? 'A2' : 'A1');
      return;
    }
  } else if (m.ai[1] || rollChance(m, 3)) {
    moveToTarget(w, m, false, 1, 0);
    return;
  }
  const limit = Math.max(24 - charge, 6);
  if (m.ai[0] > limit + charge) {
    m.ai[0] = 0;
    m.ai[1] = 0;
  }
  idle(w, m, 15);
};

/** 출처: AITHINK_Fn011_Baboon (Dune Beast·Jungle Hunter) — aip1 다친 %, aip2 선회, aip3 공격, aip4 공격1/2, aip5 재생 보너스 (/8) */
const baboon: AiFn = (w, m, dist, combat) => {
  const life = w.lifePct(m);
  const vel = runVel(m, false);
  if (m.ai[0]) {
    m.ai[1] = 0;
    m.ai[0]--;
    if (!m.ai[0] || life > 75) m.regenX8 = 0;
    if (combat) {
      if (rollPct(m) < 33) {
        attack1Or2(w, m, 3);
        return;
      }
    } else if (life > 75) {
      m.ai[0] = 0;
      setVelocity(m, vel);
      moveToTarget(w, m, false, 1, 7);
      return;
    }
    if (dist >= 24 && !recentlyHit(m)) {
      if (rollPct(m) < 33) circle(w, m, 4);
      idle(w, m, 20);
      return;
    }
    setVelocity(m, vel);
    if (!escape(w, m, 15)) {
      if (!combat) {
        walkCloseToUnit(w, m, 5);
        return;
      }
      attack1Or2(w, m, 3);
    }
    return;
  }
  if (!combat) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (recentlyHit(m)) {
    if (life < aiParam(m, 0) && rollPct(m) < 50) {
      m.ai[0] = (m.rng.roll() >>> 0) % 5 + 2;
      m.ai[2] = regenOn(m, aiParam(m, 4));
      m.regenX8 = m.ai[2];
      setVelocity(m, vel);
      escape(w, m, 15);
      return;
    }
    if (!m.ai[1]) {
      m.ai[1] = 1;
      attack1Or2(w, m, 3);
      return;
    }
    if (rollPct(m) < 20) {
      circle(w, m, 3);
      m.ai[1] = 0;
      return;
    }
  }
  if (!m.ai[1] || rollChance(m, 2)) {
    m.ai[1] = 1;
    attack1Or2(w, m, 3);
    return;
  }
  if (rollChance(m, 1)) {
    circle(w, m, 3);
    m.ai[1] = 0;
  }
  idle(w, m, 15);
};

/**
 * 출처: AITHINK_Fn015_SandMaggot — aip1 알 낳기, aip2 침 뱉기, aip3 알 수, aip4 근접, aip5 오르내리기 최소 시간.
 * dwAiParam[0]: 0 처음 / 1 땅 위 / 2 알 낳을 준비 / 3 굴 속. 스킬 0 MagottUp, 1 MagottDown, 2 MagottLay (시퀀스)
 */
const sandMaggot: AiFn = (w, m, dist, combat) => {
  const mt = w.missileTarget(m);
  const nd = mt?.dist ?? Infinity;
  const p = m.ai[0];
  if (p >= 3) {
    if (w.noTarget && (!mt || nd >= 16) && p === 3) {
      waitAtMost(w, m, 20);
      return;
    }
    if (p === 3) {
      if (w.frame > m.ai[1] && hasSkill(m, 0)) {
        w.useSkill(m, 0, tgt(w));
        waitAtMost(w, m, 25);
        m.ai[0] = 1;
        m.ai[1] = w.frame + aiParam(m, 4);
        return;
      }
      waitAtMost(w, m, 20);
      return;
    }
  } else if (w.noTarget && (!mt || nd > 10) && w.frame > m.ai[1] && hasSkill(m, 1)) {
    w.useSkill(m, 1, null);
    waitAtMost(w, m, 30);
    m.ai[0] = 3;
    m.ai[1] = w.frame + aiParam(m, 4);
    return;
  }
  if (w.lifePct(m) < 25 && hasSkill(m, 1) && nd < 7 && w.frame > m.ai[1] && rollPct(m) < 20) {
    w.useSkill(m, 1, tgt(w));
    waitAtMost(w, m, 30);
    m.ai[0] = 3;
    m.ai[1] = w.frame + aiParam(m, 4);
    return;
  }
  if (combat && rollChance(m, 3)) {
    w.startMode(m, 'A1');
    return;
  }
  if (mt && nd < 15 && rollChance(m, 1)) {
    w.startMode(m, 'A2');
    return;
  }
  if (rollPct(m) < 20) {
    circle(w, m, 6);
    return;
  }
  if (m.ai[2] >= aiParam(m, 2) || !rollChance(m, 0)) {
    waitAtMost(w, m, 12);
    return;
  }
  if (m.ai[0] === 2 && hasSkill(m, 2)) {
    m.ai[0] = 1;
    m.ai[2]++;
    w.useSkill(m, 2, tgt(w));
    waitAtMost(w, m, 20);
    return;
  }
  void dist;
  circle(w, m, 6);
  m.ai[0] = 2;
};

/** 출처: AITHINK_Fn016_ClawViper — aip1 돌진, aip2 돌진 거리, aip3 공격, aip4 공격1/2, aip5 대기, aip6 돌진 색 (시각 효과만 — 원작도 끔) */
const clawViper: AiFn = (w, m, dist, combat) => {
  if (combat) {
    if (rollChance(m, 2)) {
      attack1Or2(w, m, 3);
      return;
    }
    idle(w, m, aiParam(m, 4));
    return;
  }
  if (hasSkill(m, 0) && dist < aiParam(m, 1) && rollChance(m, 0) && w.canUseSkill(m, 0, tgt(w))) {
    w.useSkill(m, 0, tgt(w));
    m.ai[0] = 1;
    return;
  }
  if (rollPct(m) < 50) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  idle(w, m, aiParam(m, 4));
};

/** 출처: AITHINK_Fn017_SandLeaper — aip1 도약, aip2 공격(A2), aip3 접근, aip4 선회 */
const sandLeaper: AiFn = (w, m, dist, combat) => {
  if (hasSkill(m, 0) && dist < 5 && rollChance(m, 0) && w.canUseSkill(m, 0, tgt(w))) {
    w.useSkill(m, 0, tgt(w));
    return;
  }
  if (combat) {
    if (rollChance(m, 1)) {
      w.startMode(m, 'A2');
      return;
    }
  } else {
    if (dist > 10) {
      setVelocity(m, 75);
      wanderToPoint(w, m, w.target.x, w.target.y, 5);
      return;
    }
    if (rollChance(m, 2)) {
      moveToTarget(w, m, false, 1, 7);
      return;
    }
    if (rollChance(m, 3)) {
      circle(w, m, 4);
      return;
    }
  }
  idle(w, m, 10);
};

/** 출처: AITACTICS_WalkToTargetUnitWithFlags(다른 유닛, nFlags) — 실패하면 nFlags & 2 일 때 70% 거리 4 배회 / 30% 10 프레임 대기 */
export function moveToPoint(w: AiWorld, m: MonsterUnit, x: number, y: number, flags: number): boolean {
  if (w.moveTo(m, x, y, false, 1)) return true;
  if (flags & 2) {
    if (rollPct(m) >= 70) idle(w, m, 10);
    else walkCloseToUnit(w, m, 4);
    return true;
  }
  return false;
}

/** 출처: AITHINK_TargetCallback_Panther — 같은 계열(BaseId) 의 가장 가까운 살아 있는 몬스터 (거리²) */
function nearestKin(w: AiWorld, m: MonsterUnit): { o: MonsterUnit; d: number } | null {
  let best: MonsterUnit | undefined, bd = Infinity;
  for (const o of neighbours(w, m)) {
    if (o.type.baseId !== m.type.baseId || !alive(o)) continue;
    const d = sqDist(m.x, m.y, o.x, o.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best ? { o: best, d: bd } : null;
}

/** 출처: AITHINK_Fn018_PantherWoman (Huntress) — aip1 접근, aip2 공격, aip3 무리 거리, aip4 대기 */
const pantherWoman: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollChance(m, 1)) w.startMode(m, 'A1');
    else idle(w, m, aiParam(m, 3));
    return;
  }
  if (rollChance(m, 0)) {
    setVelocity(m, 75);
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  const k = nearestKin(w, m);
  const pd = aiParam(m, 2);
  if (k && k.d > pd * pd) {
    setVelocity(m, 75);
    moveToPoint(w, m, k.o.x, k.o.y, 7);
    return;
  }
  if (rollPct(m) >= 25) idle(w, m, aiParam(m, 3));
  else circle(w, m, 3);
};

/** 출처: AITHINK_Fn020_Scarab — aip1 공격, aip2 공격1/2, aip3 대기, aip4 Jab, aip5 리더 돌격 명령 (AI 명령 1) */
const scarab: AiFn = (w, m, dist, combat) => {
  if (m.command !== 1 && dist < 20 && m.leaderId === m.id && rollChance(m, 4)) {
    for (const o of w.monsters) if (o !== m && o.leaderId === m.id && alive(o)) o.command = 1;
    m.command = 1;
  }
  if (m.command === 1) {
    if (combat && hasSkill(m, 0)) {
      m.command = 0;
      w.useSkill(m, 0, tgt(w));
    } else {
      setVelocity(m, 100);
      if (!w.moveTo(m, w.target.x, w.target.y, false, 1)) m.command = 0;
    }
    return;
  }
  if (!combat) {
    if (m.ai[0]) {
      moveToTarget(w, m, false, 1, 7);
      if (rollPct(m) > 10) m.ai[0] = 0;
    } else {
      circle(w, m, 0);
      m.ai[0] = 1;
    }
    return;
  }
  if (rollChance(m, 0)) {
    if (hasSkill(m, 0) && rollChance(m, 3)) {
      w.useSkill(m, 0, tgt(w));
      return;
    }
    attack1Or2(w, m, 1);
    return;
  }
  idle(w, m, aiParam(m, 2));
};

/** 출처: AITHINK_Fn021_Mummy — aip1 깨어나는 거리, aip2 접근, aip3 공격, aip4 공격1/2, aip5 대기 */
const mummy: AiFn = (w, m, dist, combat) => {
  if (recentlyHit(m) && !combat) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (dist > aiParam(m, 0)) {
    if (rollChance(m, 1)) walkCloseToUnit(w, m, 3);
    else idle(w, m, aiParam(m, 4));
    return;
  }
  if (!combat) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (!rollChance(m, 2)) {
    idle(w, m, aiParam(m, 4));
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  attack1Or2(w, m, 3);
};

/**
 * 출처: AITHINK_Fn022_GreaterMummy (Unraveler·Horadrim Ancient·Radament) — aip1 근접·숨결, aip2 부활, aip3 치료, aip4 발사, aip5 부활 거리.
 * 대상 (TargetCallback_GreaterMummy): 같은 편 언데드 (Radament 는 hUndead 도), 유니크 제외 (Radament Normal 만 허용), 거리² ≤ aip5² (Radament (aip5+10)²)
 */
const greaterMummy: AiFn = (w, m, dist, combat) => {
  if (combat && rollChance(m, 0)) {
    w.startMode(m, 'A1');
    return;
  }
  if (dist < 5 && rollChance(m, 0)) {
    w.startMode(m, 'A2');
    return;
  }
  const radament = m.type.id === 'radament';
  const range = aiParam(m, 4) + (radament ? 10 : 0);
  const maxD = range * range;
  const normal = radament && w.difficulty === 0;
  if (radament && !m.ai[2]) {
    // 출처: ACT2Q1_OnRadamentActivated (퀘스트 훅 — 한 번만 알린다)
    m.ai[2] = 1;
    w.event?.({ type: 'bossActivated', monsterId: m.id, typeId: m.type.id });
  }
  let revive: MonsterUnit | undefined, heal: MonsterUnit | undefined, counter = 0;
  for (const o of neighbours(w, m)) {
    if (!evil(o) || o.hidden) continue;
    // 근사(원작 미확인): 원작은 일반 = monstats lUndead, Radament = MONSTERS_IsUndead(l/hUndead) — 여기서는 둘 다 언데드 플래그
    if (!o.type.undead) continue;
    if ((!normal && o.flags & MONFLAG.UNIQUE) || sqDist(m.x, m.y, o.x, o.y) > maxD) continue;
    counter++;
    if (o.mode === 'DD' && !o.corpseUsed) {
      revive = o;
      continue;
    }
    if (o.hp < o.stats.maxHp && o.mode !== 'DT' && o.mode !== 'DD') heal = o;
  }
  if (hasSkill(m, 1) && heal && rollChance(m, 2)) {
    w.useSkill(m, 1, { unitId: heal.id, x: heal.x, y: heal.y });
    return;
  }
  if (revive && rollChance(m, 1)) {
    const t = { unitId: revive.id, x: revive.x, y: revive.y };
    if (w.canUseSkill(m, 0, t)) {
      w.useSkill(m, 0, t);
      return;
    }
  }
  if (hasSkill(m, 2) && rollChance(m, 3)) {
    const mt = w.missileTarget(m);
    if (mt) {
      w.useSkill(m, 2, { unitId: mt.unitId, x: mt.x, y: mt.y });
      return;
    }
  }
  if (counter <= 0) {
    setVelocity(m, 50);
    w.moveTo(m, w.target.x, w.target.y, false, 3);
    return;
  }
  if (rollPct(m) < 50) {
    circle(w, m, 3);
    return;
  }
  idle(w, m, 6);
};

/** 근사(원작 미확인): 원작 "다른 방" (UNITS_GetRoom 비교) — 40×40 서브타일 칸이 다르면 다른 방 */
const otherRoom = (ax: number, ay: number, bx: number, by: number): boolean =>
  Math.floor(ax / 40) !== Math.floor(bx / 40) || Math.floor(ay / 40) !== Math.floor(by / 40);

/** 출처: sub_6FCD55D0 — 착륙: 대상 가능으로 되돌리고, 비행 중이었고 자리가 비었으면 성공 */
function vultureLand(w: AiWorld, m: MonsterUnit): boolean {
  const flying = !!m.hidden;
  // 자리 검사 (sub_6FCBDFE0) 는 자신이 아직 충돌이 없는 동안 (날고 있는 동안) 한다
  const free = !flying || !w.canSpawnAt || w.canSpawnAt(m.type.id, m.x, m.y);
  if (!flying) return false;
  if (!free) return false;
  m.hidden = false;
  wait(w, m, 12);
  return true;
}

/** 원작 AITACTICS_MoveInRadiusToTarget(…, nMode, a5, a6) 의 목표 지점 (walkInRadius 와 같은 계산) */
function radiusPoint(m: MonsterUnit, tx: number, ty: number, a5: number, a6: number): { x: number; y: number } {
  const dist = aiDistance(m.x, m.y, tx, ty);
  const sign = Math.sign(dist - a6);
  const diff = Math.min(Math.abs(dist - a6), a5);
  const x = Math.floor(m.x), y = Math.floor(m.y), fx = Math.floor(tx), fy = Math.floor(ty);
  const xd = Math.abs(fx - x), yd = Math.abs(fy - y);
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
  return { x: x + sign * ox * Math.sign(fx - x), y: y + sign * oy * Math.sign(fy - y) };
}

const flyTo = (w: AiWorld, m: MonsterUnit, x: number, y: number, mode: MonMode): boolean => (w.moveMode ? w.moveMode(m, x, y, mode) : w.moveTo(m, x, y, false, 1));

/**
 * 출처: AITHINK_Fn023_Vulture (Carrion Bird·Undead Scavenger) — aip1 공격, aip2 대기, aip3 약한 대상 %, aip4 선회, aip5 이동.
 * dwAiParam[0]: 0 땅 / >1 비행 남은 횟수 / 1 착륙 준비 / −1 막 착륙. 비행 중에는 대상이 될 수 없고 S1 모드로 난다, 착륙은 S2.
 */
const vulture: AiFn = (w, m, dist, combat) => {
  let n = m.ai[0];
  const t = w.target;
  if (w.noTarget) {
    if (m.ai[0] < 1) {
      wait(w, m, 12);
      return;
    }
    if (vultureLand(w, m)) {
      flyTo(w, m, m.x, m.y, 'S2');
      wait(w, m, 12);
      m.ai[0] = -1;
      return;
    }
  }
  const d2 = sqDist(m.x, m.y, t.x, t.y);
  if (!w.noTarget && otherRoom(m.x, m.y, t.x, t.y) && d2 > 144) {
    if (n < 1) {
      walkInRadius(w, m, 9, 0);
      return;
    }
    if (vultureLand(w, m)) {
      flyTo(w, m, m.x, m.y, 'S2');
      wait(w, m, 12);
      m.ai[0] = -1;
      return;
    }
  }
  if (!n && m.leaderId === m.id && !w.noTarget && d2 > 144 && rollPct(m) < 60) {
    // 이륙: 대상이 될 수 없게 (UNITFLAG_TARGETABLE 등 끔, 충돌 없음)
    m.hidden = true;
    wait(w, m, 12);
    m.ai[0] = ((m.rng.roll() >>> 0) & 7) + 24;
    const p = radiusPoint(m, t.x, t.y, 8, 8);
    flyTo(w, m, p.x, p.y, 'S1');
    wait(w, m, 12);
    return;
  }
  // 출처: AITHINK_TargetCallback_Vulture — 거리² ≤ 121 안에서 생명이 aip3 % 이하인 유닛 (플레이어 포함)
  const weakPct = aiParam(m, 2);
  let weak = false;
  if (!t.dead && d2 <= 121 && w.targetLifePct() <= weakPct) weak = true;
  for (const o of neighbours(w, m)) if (alive(o) && sqDist(m.x, m.y, o.x, o.y) <= 121 && o.hp <= (weakPct * o.stats.maxHp) / 100) weak = true;
  if (n > 1) {
    if (!weak && (dist >= 6 || rollPct(m) >= 15)) {
      m.hidden = true;
      wait(w, m, 12);
      if (m.ai[1] && m.ai[2] && aiDistance(m.x, m.y, m.ai[1], m.ai[2]) > 1) {
        m.ai[0]--;
        flyTo(w, m, m.ai[1], m.ai[2], 'S1');
        wait(w, m, 12);
        return;
      }
      let max = 2 * (n + 8);
      let x = Math.floor(t.x) + m.rng.pick(max) - (n + 8);
      let y = Math.floor(t.y) + m.rng.pick(max) - (n + 8);
      max = Math.min(36, Math.max(12, max));
      const cx = Math.floor(m.x), cy = Math.floor(m.y);
      for (let guard = 0; guard < 200 && aiDistance(cx, cy, x, y) < max; guard++) {
        if (x < cx) x--;
        else if (x > cx) x++;
        if (y < cy) y--;
        else if (y > cy) y++;
        if (x === cx && y === cy) {
          x++;
          y++;
        }
      }
      m.ai[1] = x;
      m.ai[2] = y;
      flyTo(w, m, x, y, 'S1');
      wait(w, m, 12);
      m.ai[0]--;
      return;
    }
    n = 1;
    m.ai[0] = 1;
    if (vultureLand(w, m)) {
      const p = radiusPoint(m, t.x, t.y, 2, 3);
      flyTo(w, m, p.x, p.y, 'S2');
      wait(w, m, 12);
      m.ai[0] = -1;
      return;
    }
    m.ai[0] = 8;
    wait(w, m, 12);
  } else if (n >= 1) {
    if (vultureLand(w, m)) {
      const p = radiusPoint(m, t.x, t.y, 2, 3);
      flyTo(w, m, p.x, p.y, 'S2');
      wait(w, m, 12);
      m.ai[0] = -1;
      return;
    }
    m.ai[0] = 8;
    wait(w, m, 12);
  }
  if (!combat) {
    if (n !== -1 && !rollChance(m, 4)) {
      wait(w, m, aiParam(m, 1));
      return;
    }
    if (rollChance(m, 3)) circle(w, m, 6);
    else walkInRadius(w, m, 9, 0);
    m.ai[0] = 0;
    wait(w, m, 12);
    return;
  }
  if (rollChance(m, 0)) w.startMode(m, 'A1');
  else wait(w, m, aiParam(m, 1));
};

/**
 * 출처: AITHINK_Fn029_BatDemon (Desert Wing·Gloombat) — aip1 다친 %, aip2 맞으면 이탈, aip3 공격, aip4 번개(A2)/A1, aip5 매달릴 때 재생 보너스.
 * dwAiParam[0]: 0 매달리기 시작(S3) / 1 매달려 있음(S4) / 2 이탈 / 3 교전 / 4 멀어짐
 */
const batDemon: AiFn = (w, m, dist, combat) => {
  const life = w.lifePct(m);
  const st = m.ai[0];
  if (st && st !== 4) {
    switch (st) {
      case 1:
        if (m.ai[1] > 1 && (combat || dist < 7 || recentlyHit(m) || (dist < 14 && life > 50))) {
          m.regenX8 = 0;
          modeOnly(w, m, 'S2');
          wait(w, m, 6);
          m.ai[0] = 3;
        } else {
          modeOnly(w, m, 'S4');
          wait(w, m, m.ai[1] ? 15 : 10);
          m.ai[1]++;
        }
        return;
      case 2:
        if (life < aiParam(m, 0) && escape(w, m, 15)) m.ai[0] = 4;
        else if (rollPct(m) >= 33) {
          if (rollPct(m) >= 15) idle(w, m, 10);
          else walkCloseToUnit(w, m, 6);
        } else {
          moveToTarget(w, m, false, 1, 0);
          m.ai[0] = 3;
        }
        return;
      case 3:
        if (life < aiParam(m, 0) && escape(w, m, 15)) m.ai[0] = 4;
        else if (combat) {
          if (m.ai[1] <= 0) {
            if (recentlyHit(m) && rollChance(m, 1) && escape(w, m, 12)) m.ai[0] = 2;
            else if (!rollChance(m, 2)) idle(w, m, 10);
            else w.startMode(m, rollChance(m, 3) ? 'A2' : 'A1');
          } else {
            w.startMode(m, 'A2');
            m.ai[1] = 0;
          }
        } else moveToTarget(w, m, false, 1, 0);
        return;
      default:
        if (dist >= 15) {
          m.ai[0] = 4;
          idle(w, m, 15);
        } else {
          moveToTarget(w, m, false, 1, 0);
          m.ai[0] = 3;
        }
        return;
    }
  }
  modeOnly(w, m, 'S3');
  wait(w, m, 8);
  m.ai[0] = 1;
  m.ai[1] = 0;
  m.ai[2] = regenOn(m, aiParam(m, 4));
  m.regenX8 = m.ai[2];
};

/** 출처: AITHINK_Fn038_MaggotLarva (Rock Worm 새끼) — aip1 공격, aip2 공격 뒤 쉼, aip3 접근, aip4 대기 */
const maggotLarva: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (m.ai[0] || !rollChance(m, 0)) {
      m.ai[0] = 0;
      idle(w, m, aiParam(m, 1));
    } else {
      m.ai[0] = 1;
      w.startMode(m, 'A1');
    }
    return;
  }
  m.ai[0] = 0;
  if (rollChance(m, 2)) {
    moveToTarget(w, m, false, 1, 1);
    return;
  }
  idle(w, m, aiParam(m, 3));
};

/** 출처: AITHINK_Fn039_PinHead (Blunderbore) — aip1 공격, aip2 공격 뒤 쉼, aip3 접근, aip4 대기, aip5 Smite, aip6 스킬2 */
const pinHead: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (m.ai[0] && !rollChance(m, 0)) {
      idle(w, m, aiParam(m, 1));
      return;
    }
    m.ai[0] = 1;
    if (hasSkill(m, 0) && rollChance(m, 4)) w.useSkill(m, 0, tgt(w));
    else if (hasSkill(m, 1) && rollChance(m, 5)) w.useSkill(m, 1, tgt(w));
    else w.startMode(m, 'A1');
    return;
  }
  m.ai[0] = 0;
  if (rollChance(m, 2)) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  idle(w, m, aiParam(m, 3));
};

/** 출처: AITHINK_Fn040_MaggotEgg — aip1 대기, aip2 부화 확률. 부화(스킬 MaggotEgg) 뒤 다음 판단에 알이 죽는다 (SUNITDMG_KillMonster) */
const maggotEgg: AiFn = (w, m) => {
  if (hasSkill(m, 0)) {
    if (m.ai[0] === 1) {
      w.dieQuietly(m);
      idle(w, m, aiParam(m, 0));
      return;
    }
    if (rollChance(m, 1)) {
      w.useSkill(m, 0, tgt(w));
      wait(w, m, aiParam(m, 0));
      m.ai[0] = 1;
      return;
    }
  }
  if (m.ai[0] === 1) w.dieQuietly(m);
  idle(w, m, aiParam(m, 0));
};

/**
 * 출처: AITHINK_Fn044_Duriel — aip1 Holy Freeze 레벨, aip2 Smite, aip3 Jab, aip4 공격2, aip5 돌진.
 * 스킬 4번 칸 Holy Freeze 는 오른쪽 스킬(오라)로 켜 둔다 (D2GAME_SetSkills + AssignSkill) — 오라 효과는 Game 이 매 프레임 처리
 */
const duriel: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (hasSkill(m, 2) && rollChance(m, 1)) w.useSkill(m, 2, tgt(w));
    else if (hasSkill(m, 1) && rollChance(m, 2)) w.useSkill(m, 1, tgt(w));
    else if (rollChance(m, 3)) w.startMode(m, 'A2');
    else w.startMode(m, 'A1');
    return;
  }
  if (hasSkill(m, 0) && rollChance(m, 4)) {
    w.useSkill(m, 0, tgt(w));
    return;
  }
  setVelocity(m, 0);
  moveToTarget(w, m, false, 1, 7);
};

/**
 * 출처: AITHINK_Fn045_Sarcophagus — aip1 생성 간격, aip3 생성 수 (Nest 로 미라). 다 만들면 드롭 없이 무너진다.
 * 출처: D2GAME_AI_Unk043_045_121_6FCD8E10 — 처음 dwAiParam[0] = 현재 프레임. 근사(원작 미확인): 원작은 AI 초기화 때, 여기서는 첫 판단 때
 */
const sarcophagus: AiFn = (w, m, dist) => {
  if (!m.aiParam0) {
    m.aiParam0 = 1;
    m.ai[0] = w.frame;
    m.ai[1] = 0;
  }
  if (dist > 25) {
    idle(w, m, 25);
    return;
  }
  if (m.ai[1] <= aiParam(m, 2)) {
    const diff = Math.abs(w.frame - m.ai[0]);
    if (hasSkill(m, 0) && diff >= aiParam(m, 0) && w.canUseSkill(m, 0, null)) {
      m.ai[0] = w.frame;
      m.ai[1]++;
      w.useSkill(m, 0, tgt(w));
      return;
    }
    idle(w, m, (m.rng.roll() >>> 0) % 10 + 20);
    return;
  }
  w.dieQuietly(m);
};

/**
 * 출처: AITHINK_Fn066_SandMaggotQueen (Coldworm) — aip1 최대 생성 수, aip2 지연 (초). 대상 방식 0 (대상 없이 판단).
 * S1 (알 낳기) 모드 뒤 계열 Sand Maggot 을 (x+8, y) 에 S1 모드로 (MONSTERS_GetMinionSpawnInfo MAGGOTQUEEN1), 경험치 없음
 */
const sandMaggotQueen: AiFn = (w, m) => {
  if (m.ai[2]) {
    idle(w, m, 25 * aiParam(m, 1));
    m.ai[2] = 0;
    return;
  }
  if (m.ai[1]) {
    const s = w.spawn?.(m, m.type.spawn || 'sandmaggot1', Math.floor(m.x) + 8, Math.floor(m.y), 'S1');
    if (s) m.ai[0]++;
    wait(w, m, aiParam(m, 1));
    m.ai[1] = 0;
    m.ai[2] = 1;
    return;
  }
  if (m.ai[0] < aiParam(m, 0)) {
    modeOnly(w, m, 'S1');
    wait(w, m, aiParam(m, 1));
    m.ai[1] = 1;
  }
};

/**
 * 출처: AITHINK_Fn053_Summoner — aip1 시전, aip2 Weaken, aip3 선호 원소, aip4 노바 간격, aip5 불벽 간격, aip6 물러서기, aip7 노바 거리, aip8 미사일 거리.
 * 스킬: 0 Glacial Spike, 1 Frost Nova, 2 Fire Ball, 3 Fire Wall(VampireFirewall), 4 Weaken
 */
const summoner: AiFn = (w, m, dist) => {
  if (!m.ai[0]) {
    // 출처: ACT2Q5_OnSummonerActivated (퀘스트 훅)
    w.event?.({ type: 'bossActivated', monsterId: m.id, typeId: m.type.id });
    m.ai[0] = 1;
  }
  if (dist < 5 && rollChance(m, 5)) escape(w, m, 6);
  const info = w.targetInfo?.();
  let cold = (info?.fireRes ?? 0) >= (info?.coldRes ?? 0);
  const t = tgt(w);
  if (rollChance(m, 0)) {
    if (hasSkill(m, 4) && rollChance(m, 1)) {
      w.useSkill(m, 4, t);
      return;
    }
    const mt = w.missileTarget(m);
    if (rollPct(m) > aiParam(m, 2)) cold = !cold;
    if (cold) {
      if (hasSkill(m, 1) && w.frame > m.ai[1] && dist < aiParam(m, 6)) {
        m.ai[1] = w.frame + aiParam(m, 3);
        w.useSkill(m, 1, t);
        return;
      }
      if (hasSkill(m, 0) && mt && dist < aiParam(m, 7)) {
        w.useSkill(m, 0, { unitId: mt.unitId, x: t.x, y: t.y });
        return;
      }
    }
    if (hasSkill(m, 3) && w.frame > m.ai[2]) {
      m.ai[2] = w.frame + aiParam(m, 4);
      w.useSkill(m, 3, t);
      return;
    }
    if (hasSkill(m, 2) && mt && dist < aiParam(m, 7)) {
      w.useSkill(m, 2, { unitId: mt.unitId, x: t.x, y: t.y });
      return;
    }
    if (!cold && hasSkill(m, 1) && w.frame > m.ai[1] && dist < aiParam(m, 6)) {
      m.ai[1] = w.frame + aiParam(m, 3);
      w.useSkill(m, 1, t);
      return;
    }
    if (hasSkill(m, 4)) {
      w.useSkill(m, 4, t);
      return;
    }
  }
  walkCloseToUnit(w, m, 4);
};

/** 출처: AITHINK_Fn095_PantherJavelin (Huntress 투창·Saber Cat) — aip1 접근, aip2 던지기, aip3 무리 거리², aip4 물러서기, aip5 대기, aip6 던지는 거리 */
const pantherJavelin: AiFn = (w, m) => {
  // 출처: sub_6FCF2CC0 — 미사일 대상이 없으면 거리 INT_MAX
  const mt = w.missileTarget(m);
  const nd = mt ? mt.dist : Infinity;
  if (nd < 8 && rollChance(m, 3)) {
    escape(w, m, 16);
    return;
  }
  if (nd > aiParam(m, 5) - 6 && rollChance(m, 0)) {
    wanderToPoint(w, m, w.target.x, w.target.y, 4);
    return;
  }
  if (!mt || nd >= aiParam(m, 5)) {
    const k = nearestKin(w, m);
    if (k && k.d > aiParam(m, 2)) {
      moveToPoint(w, m, k.o.x, k.o.y, 7);
      return;
    }
    idle(w, m, aiParam(m, 4));
    return;
  }
  if (rollChance(m, 1)) {
    w.startMode(m, 'A1');
    return;
  }
  idle(w, m, aiParam(m, 4));
};

// 출처: AITHINK_Fn094_DesertTurret — 조준 순번 표 (현재 순번 + 8 × 대상 방향) 와 8 방향 오프셋
const TURRET_IDX = [
  0, 0, 1, 2, 5, 6, 7, 0, 1, 1, 1, 2, 3, 6, 7, 0, 1, 2, 2, 2, 3, 4, 7, 0, 1, 2, 3, 3, 3, 4, 5, 6,
  1, 2, 3, 4, 4, 4, 5, 6, 7, 2, 3, 4, 5, 5, 5, 6, 7, 0, 3, 4, 5, 6, 6, 6, 7, 0, 1, 4, 5, 6, 7, 7,
];
const TURRET_OFF: readonly (readonly [number, number])[] = [[1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]];

/** 근사(원작 미확인): D2Common_11053(UNITS_GetDirectionToCoords) — 대상 방향을 표의 8 방향 순번 (0 = +x+y 부터 시계 반대) 으로 */
export const dir8 = (fx: number, fy: number, tx: number, ty: number): number => {
  const a = Math.atan2(ty - fy, tx - fx);
  const k = Math.round((a - Math.PI / 4) / (Math.PI / 4));
  return ((k % 8) + 8) % 8;
};

/** 출처: AITHINK_Fn094_DesertTurret (Lightning Spire/Fire Tower 함정) — aip1 짧은 지연, aip2 발사 수, aip3 긴 지연, aip4 거리, aip5 퍼짐 */
const desertTurret: AiFn = (w, m, dist) => {
  if (hasSkill(m, 0) && !m.ai[0]) {
    w.useSkill(m, 0, null);
    m.ai[2] = 0;
    m.ai[0] = w.frame;
    return;
  }
  if (w.frame < m.ai[0]) {
    idle(w, m, 10);
    return;
  }
  if (dist > aiParam(m, 3)) {
    if (m.ai[1] > 0) m.ai[1]--;
    idle(w, m, 15);
    return;
  }
  const i1 = m.ai[2] % 8;
  const i2 = dir8(m.x, m.y, w.target.x, w.target.y) & 7;
  m.ai[2] = TURRET_IDX[i1 + 8 * i2] ?? 0;
  const off = TURRET_OFF[m.ai[2]] ?? [0, 0];
  const x = Math.floor(m.x) + aiParam(m, 4) * off[0], y = Math.floor(m.y) + aiParam(m, 4) * off[1];
  if (hasSkill(m, 0) && w.canUseSkill(m, 0, { x, y, fixed: true }) && w.canUseSkill(m, 0, tgt(w))) {
    w.useSkill(m, 0, { x, y, fixed: true });
    m.ai[1]++;
    if (m.ai[1] <= aiParam(m, 1)) m.ai[0] = w.frame + aiParam(m, 0);
    else {
      m.ai[0] = w.frame + aiParam(m, 2);
      m.ai[1] = 0;
    }
    return;
  }
  if (m.ai[1] > 0) m.ai[1]--;
  idle(w, m, 10);
};

/** 출처: AITHINK_Fn093_ArcaneTower (Lightning Spire) — aip1 스킬1 수, aip2 스킬1 쉼, aip3 스킬1 긴 지연, aip4 A1 수, aip5 A1 쉼, aip6 A1 긴 지연 */
const arcaneTower: AiFn = (w, m) => {
  if (!m.ai[1]) m.ai[1] = aiParam(m, 0);
  if (w.frame < m.ai[2]) {
    idle(w, m, 10);
    return;
  }
  if (!hasSkill(m, 0) || m.ai[0]) {
    w.startMode(m, 'A1');
    m.ai[1]--;
    if (m.ai[1] > 0) m.ai[2] = w.frame + aiParam(m, 5);
    else {
      m.ai[0] = 0;
      m.ai[1] = aiParam(m, 0);
      m.ai[2] = w.frame + aiParam(m, 4);
    }
    return;
  }
  w.useSkill(m, 0, tgt(w));
  m.ai[1]--;
  if (m.ai[1] > 0) m.ai[2] = w.frame + aiParam(m, 1);
  else {
    m.ai[0] = 1;
    m.ai[1] = aiParam(m, 3);
    m.ai[2] = w.frame + aiParam(m, 2);
  }
};

/**
 * 출처: AITHINK_Fn078_TrapRightArrow / Fn079_TrapLeftArrow — aip1 최소 거리, aip2 최대 거리, aip3 지연. 가로(세로) 2 서브타일 안에 들어오면 쏜다.
 * 레벨마다 한 번 함정 종류 (원작 pMonsterRegion->unk0x2D4: Act 2 부터 rand % 3, 1 이면 스킬(독·저주 해골), 아니면 A1 가시)
 */
function trapArrow(axis: 'x' | 'y'): AiFn {
  return (w, m, dist) => {
    if (dist < aiParam(m, 0) || dist > aiParam(m, 1)) {
      idle(w, m, 40);
      return;
    }
    const diff = axis === 'x' ? Math.abs(Math.floor(m.x) - Math.floor(w.target.x)) : Math.abs(Math.floor(m.y) - Math.floor(w.target.y));
    if (diff > 2 || w.frame <= m.ai[0]) {
      idle(w, m, 30);
      return;
    }
    m.ai[0] = w.frame + aiParam(m, 2);
    const vars = w.levelVars;
    let kind = vars?.trapKind ?? -1;
    if (kind < 0) {
      kind = (w.levelNo ?? 0) >= 40 ? (m.rng.roll() >>> 0) % 3 : 0;
      if (vars) vars.trapKind = kind;
    }
    if (kind !== 1) {
      w.startMode(m, 'A1');
      return;
    }
    if (hasSkill(m, 0)) {
      m.ai[2] = w.frame + aiParam(m, 2);
      w.useSkill(m, 0, tgt(w));
      return;
    }
    idle(w, m, 30);
  };
}

/** 출처: AITHINK_Fn087_TrapMelee — aip1 공격, aip2 대기 */
const trapMelee: AiFn = (w, m, _dist, combat) => {
  if (!combat) {
    idle(w, m, 40);
    return;
  }
  if (rollChance(m, 0)) {
    w.startMode(m, 'A1');
    return;
  }
  idle(w, m, aiParam(m, 1));
};

export const ACT2_AI: Record<string, AiFn> = {
  SandRaider: sandRaider,
  Baboon: baboon,
  SandMaggot: sandMaggot,
  ClawViper: clawViper,
  SandLeaper: sandLeaper,
  PantherWoman: pantherWoman,
  Swarm: ACT1_AI.Goatman as AiFn,
  Scarab: scarab,
  Mummy: mummy,
  GreaterMummy: greaterMummy,
  Vulture: vulture,
  BatDemon: batDemon,
  MaggotLarva: maggotLarva,
  PinHead: pinHead,
  MaggotEgg: maggotEgg,
  Duriel: duriel,
  Sarcophagus: sarcophagus,
  SandMaggotQueen: sandMaggotQueen,
  Summoner: summoner,
  PantherJavelin: pantherJavelin,
  DesertTurret: desertTurret,
  ArcaneTower: arcaneTower,
  'Trap-RightArrow': trapArrow('x'),
  'Trap-LeftArrow': trapArrow('y'),
  'Trap-Melee': trapMelee,
};

/**
 * 원작 AI 표 대상 방식 (gpAiTable_6FD3F990 첫 칸): 0 대상 찾지 않음, 1 대상 필요 (없으면 거리별 대기 — sub_6FCCF9D0),
 * 2·5 대상 없어도 호출 (sub_6FCF2110·sub_6FCCFC00), 4 대상 필요 (없으면 20 프레임 — sub_6FCCFC00). 표에 없는 AI 는 1
 */
export const ACT2_TARGET_MODE: Record<string, 0 | 1 | 2 | 4 | 5> = {
  SandMaggot: 4,
  SandMaggotQueen: 0,
};
