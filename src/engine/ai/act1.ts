// Act 1 몬스터 AI (monstats AI 컬럼 이름 → AI 함수). aip1~8 은 aiParam(m, 0~7).
// 출처: D2MOO D2Game/src/AI/AiThink.cpp (https://github.com/ThePhrozenKeep/D2MOO)
//   AITHINK_Fn002_Skeleton, Fn003_Zombie, Fn004_Bighead, Fn005_BloodHawk, Fn006_Fallen, Fn007_Brute, Fn009_Wraith,
//   Fn010_CorruptRogue, Fn012_019_Goatman_Swarm, Fn013_FallenShaman (+ TargetCallback_FallenShaman), Fn014_QuillRat,
//   Fn026_Arach, Fn028_Vampire, Fn030_Fetish, Fn034_Andariel, Fn035_CorruptArcher, Fn036_CorruptLancer, Fn037_SkeletonBow,
//   Fn043_FoulCrowNest, Fn059_BloodRaven, Fn063_GargoyleTrap, Fn064_SkeletonMage, Fn090_Griswold, Fn098_Smith,
//   D2GAME_AI_SpecialState13_6FCE5080 (The Countess) — 분기·파라미터·난수 호출 순서 그대로
// 근사(원작 미확인): 원작 AI 명령(AIGENERAL_*Command) 은 command 필드 하나로 단순화.
import { aiDistance } from '../monster';
import { MONFLAG } from '../uniques';
import {
  aiParam, attack1Or2, circle, escape, idle, moveToTarget, recentlyHit, rollChance, rollPct, runCloseToTarget, setVelocity, walkCloseToUnit, walkInRadius,
} from './tactics';
import type { AiWorld, MonsterUnit } from './types';

export type AiFn = (w: AiWorld, m: MonsterUnit, dist: number, combat: boolean) => void;

const tgt = (w: AiWorld) => ({ unitId: w.target.id, x: w.target.x, y: w.target.y });

/** 출처: AITHINK_Fn002_Skeleton — aip1 접근 확률, aip2 대기, aip3 공격 확률, aip4 공격1/2 */
const skeleton: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollChance(m, 2)) {
      attack1Or2(w, m, 3);
      return;
    }
  } else if (rollChance(m, 0)) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  idle(w, m, aiParam(m, 1));
};

/** 출처: AITHINK_Fn003_Zombie — aip1 접근 확률, aip2 인지 거리, aip4 공격1/2. Burial Grounds 에서는 항상 돌진 */
const zombie: AiFn = (w, m, dist, combat) => {
  if (combat) {
    attack1Or2(w, m, 3);
    return;
  }
  if (recentlyHit(m) || (dist < aiParam(m, 1) && rollChance(m, 0)) || w.levelId === 'burialgrounds') {
    setVelocity(m, 100);
    w.moveTo(m, w.target.x, w.target.y, true, 1);
    return;
  }
  walkCloseToUnit(w, m, 3);
};

/** 출처: AITHINK_Fn004_Bighead — aip1 다친 %, aip2 선회, aip3 건강할 때 발사, aip4 다쳤을 때 발사 */
const bighead: AiFn = (w, m, dist, combat) => {
  if (!combat && recentlyHit(m)) {
    w.startMode(m, 'A2');
    return;
  }
  if (w.lifePct(m) >= aiParam(m, 0)) {
    if (combat) {
      w.startMode(m, 'A1');
      return;
    }
    if (dist < 15 && w.missileTarget(m) && rollChance(m, 2)) {
      w.startMode(m, 'A2');
      return;
    }
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (dist >= 3) {
    if (dist > 15) {
      w.moveTo(m, w.target.x, w.target.y, false, 6);
      return;
    }
    if (w.missileTarget(m) && rollChance(m, 3)) {
      w.startMode(m, 'A2');
      return;
    }
    if (rollChance(m, 1)) circle(w, m, 3);
    else idle(w, m, 10);
    return;
  }
  setVelocity(m, 50);
  if (!escape(w, m, 5)) w.startMode(m, 'A2');
};

/** 출처: AITHINK_Fn005_BloodHawk (Foul Crow) — aip1 돌진, aip2 배회, aip3 공격, aip4 달리기 속도, aip5 돌진 속도 */
const bloodHawk: AiFn = (w, m, dist, combat) => {
  if (m.ai[0] === 1 && combat) {
    m.ai[0] = 0;
    w.startMode(m, 'A1');
    return;
  }
  m.ai[0] = 0;
  if (combat) {
    if (!rollChance(m, 2)) {
      setVelocity(m, aiParam(m, 3));
      if (escape(w, m, 4)) return;
    }
    w.startMode(m, 'A1');
    return;
  }
  if (rollChance(m, 0)) {
    setVelocity(m, aiParam(m, 4));
    m.ai[0] = 1;
    w.moveTo(m, w.target.x, w.target.y, false, 1);
    return;
  }
  if (dist <= 3) {
    setVelocity(m, aiParam(m, 3));
    if (!escape(w, m, 4)) w.startMode(m, 'A1');
    return;
  }
  if (!rollChance(m, 1)) {
    walkCloseToUnit(w, m, 3);
  } else {
    setVelocity(m, -50);
    walkCloseToUnit(w, m, 4);
  }
};

/** 출처: AITHINK_Fn006_Fallen — aip1 리더 공격 명령, aip2 접근 거리, aip3 공격, aip4 공격1/2 */
const fallen: AiFn = (w, m, dist, combat) => {
  // 주변(15 이내)에서 막 죽은(DT 모드) 몬스터가 있으면 12 만큼 도주
  const corpse = w.monsters.find((o) => o !== m && !o.pet && o.mode === 'DT' && aiDistance(o.x, o.y, m.x, m.y) < 15);
  if (corpse) {
    m.aiParam0 = 1;
    m.command = 0;
    setVelocity(m, 50);
    if (escape(w, m, 12)) {
      m.rng.pick(20); // 비명 소리 굴림 (소리는 생략, 난수 순서 유지)
      return;
    }
  }
  if (m.mode !== 'NU') {
    idle(w, m, 10);
    return;
  }
  if (m.command !== 1) {
    if (!combat && recentlyHit(m)) {
      w.moveTo(m, w.target.x, w.target.y, false, 1);
      return;
    }
    if (dist < 15 && m.leaderId === m.id && rollChance(m, 0)) {
      for (const o of w.monsters) if (o.leaderId === m.id && o !== m && o.mode !== 'DT' && o.mode !== 'DD') o.command = 1;
      m.command = 1;
      w.startMode(m, 'S2');
      return;
    }
    if (!combat) {
      if (dist <= aiParam(m, 1)) {
        moveToTarget(w, m, false, 1, 7);
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
  if (!w.moveTo(m, w.target.x, w.target.y, false, 1)) m.command = 0;
};

/** 출처: AITHINK_Fn007_Brute — aip3 공격, aip4 공격1/2. 걸을 때 생명이 적을수록 빠르다 (100 − clamp(생명%, 40, 100)) */
const brute: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollChance(m, 2)) attack1Or2(w, m, 3);
    else if (rollChance(m, 2)) circle(w, m, 4);
    else idle(w, m, 15);
    return;
  }
  const malus = Math.min(100, Math.max(40, w.lifePct(m)));
  setVelocity(m, 100 - malus);
  moveToTarget(w, m, false, 1, 7);
};

/** 출처: AITHINK_Fn009_Wraith — aip1 접근, aip2 대기, aip3 공격 (접근은 반지름 12 로 다가간다) */
const wraith: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollChance(m, 2)) {
      w.startMode(m, 'A1');
      return;
    }
  } else if (rollChance(m, 0)) {
    walkInRadius(w, m, 12, 0);
    return;
  }
  idle(w, m, aiParam(m, 1));
};

/** 출처: AITHINK_Fn010_CorruptRogue — aip1 접근, aip2 대기, aip3 공격, aip4 달리기 속도, aip5 달리기 확률 (싱글 = 거리 ≤ 20 − 3×0) */
const corruptRogue: AiFn = (w, m, dist, combat) => {
  if (dist <= 20) {
    if (combat) {
      if (rollChance(m, 2)) w.startMode(m, 'A1');
      else idle(w, m, aiParam(m, 1));
      return;
    }
    if (!rollChance(m, 0)) {
      idle(w, m, aiParam(m, 1));
      return;
    }
    if (!rollChance(m, 4)) {
      moveToTarget(w, m, false, 1, 7);
      return;
    }
  }
  setVelocity(m, aiParam(m, 3));
  w.moveTo(m, w.target.x, w.target.y, true, 3);
};

/** 출처: AITHINK_Fn012_019_Goatman_Swarm — aip1 접근, aip2 대기, aip3 공격 */
const goatman: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollChance(m, 2)) {
      w.startMode(m, 'A1');
      return;
    }
  } else if (rollChance(m, 0)) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  idle(w, m, aiParam(m, 1));
};

/**
 * 출처: AITHINK_Fn013_FallenShaman — aip1 부활·명령, aip2 발사, aip3 근접·선회, aip4 부활 거리, aip5 발사 거리.
 * 부활 대상: 일반 샤먼은 자기 미니언, 유니크 샤먼은 주변의 죽은 Fallen / Fallen Shaman (AITHINK_TargetCallback_FallenShaman)
 */
const fallenShaman: AiFn = (w, m, dist, combat) => {
  if (combat && rollChance(m, 2)) {
    w.startMode(m, 'A1');
    return;
  }
  const maxD2 = aiParam(m, 3) * aiParam(m, 3);
  const bossSearch = (m.flags & MONFLAG.UNIQUE) !== 0 && (m.flags & MONFLAG.CHAMPION) === 0;
  let target: MonsterUnit | undefined;
  let count = 0;
  for (const o of w.monsters) {
    if (o === m || o.pet || o.mode !== 'DD' || o.corpseUsed) continue;
    if (bossSearch) {
      const base = o.type.baseId;
      if (base !== 'fallen1' && base !== 'fallenshaman1') continue;
      if (o.flags & (MONFLAG.UNIQUE | MONFLAG.CHAMPION)) continue;
      const dx = Math.floor(o.x) - Math.floor(m.x), dy = Math.floor(o.y) - Math.floor(m.y);
      if (dx * dx + dy * dy > maxD2) continue;
    } else {
      if (o.leaderId !== m.id) continue;
      if (aiDistance(m.x, m.y, o.x, o.y) > maxD2) continue;
    }
    target = o;
    count++;
  }
  if (rollChance(m, 0)) {
    for (const o of w.monsters) if (o.leaderId === m.id && o !== m && o.mode !== 'DT' && o.mode !== 'DD') o.command = 1;
  }
  if (target && count && rollChance(m, 0)) {
    const st = { unitId: target.id, x: target.x, y: target.y };
    if (w.canUseSkill(m, 0, st)) {
      w.useSkill(m, 0, st);
      return;
    }
  }
  if (dist < aiParam(m, 4) && rollChance(m, 1)) {
    w.useSkill(m, 1, tgt(w));
    return;
  }
  const mt = w.missileTarget(m);
  if (mt && mt.dist < aiParam(m, 4) && rollChance(m, 1)) {
    w.useSkill(m, 1, { unitId: mt.unitId, x: mt.x, y: mt.y });
    return;
  }
  if (rollChance(m, 2)) {
    circle(w, m, 3);
    return;
  }
  idle(w, m, 10);
};

/** 출처: AITHINK_Fn014_QuillRat — aip1 활성 거리, aip2 발사 확률, aip4 걷기 거리 */
const quillRat: AiFn = (w, m, dist, combat) => {
  if (combat) {
    w.startMode(m, 'A1');
    return;
  }
  if (recentlyHit(m)) {
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
};

/** 출처: AITHINK_Fn026_Arach — aip1 공격, aip2 근접 중 선회, aip3 교전, aip4 달아날 거리, aip5 다친 % (SpiderLay 는 다쳤을 때) */
const arach: AiFn = (w, m, dist, combat) => {
  const life = w.lifePct(m);
  if (m.ai[0] === 1) {
    m.ai[1] = 0;
    if (life > 75) {
      m.ai[0] = 0;
      if (!rollChance(m, 2)) {
        circle(w, m, 6);
        return;
      }
      m.ai[0] = 2;
      w.moveTo(m, w.target.x, w.target.y, false, 1);
      return;
    }
    if (!combat || aiParam(m, 0) <= 25 || rollPct(m) >= aiParam(m, 0) - 25) {
      if (dist < aiParam(m, 3) || recentlyHit(m)) escape(w, m, 4);
      else {
        m.ai[0] = 0;
        circle(w, m, 12);
      }
      return;
    }
    w.startMode(m, 'A1');
    return;
  }
  if (!combat) {
    if (recentlyHit(m) || m.ai[1] === 1) m.ai[1] = 1;
    else {
      m.ai[2]++;
      if (m.ai[2] > 20) m.ai[2] = 0;
      m.ai[1] = 0;
      if (m.ai[2] !== 1 || !rollChance(m, 2)) {
        if (rollPct(m) >= 20) idle(w, m, 15);
        else walkCloseToUnit(w, m, 6);
        return;
      }
      m.ai[1] = 1;
    }
    w.moveTo(m, w.target.x, w.target.y, false, 1);
    return;
  }
  m.ai[0] = 2;
  if (rollChance(m, 0)) {
    w.startMode(m, 'A1');
    return;
  }
  if (life >= aiParam(m, 4)) {
    if (!rollChance(m, 1)) idle(w, m, 15);
    else circle(w, m, 4);
    return;
  }
  m.ai[0] = 1;
  if (!m.type.skills[0]?.name || m.states.has('spiderlay')) escape(w, m, 8);
  else w.useSkill(m, 0, null);
};

/** 출처: AITHINK_Fn028_Vampire — aip1 근접, aip2 시전, aip3 활동 거리, aip4 상위 주문, aip5 주문 비트 (1 화염구, 2 불벽, 4 유성) */
const vampire: AiFn = (w, m, dist, combat) => {
  const flags = aiParam(m, 4);
  if (m.ai[2] > 0) m.ai[2]--;
  const mt = w.missileTarget(m);
  const mtd = mt?.dist ?? Infinity;
  const castAt = (slot: number) => w.useSkill(m, slot, mt ? { unitId: mt.unitId, x: mt.x, y: mt.y } : tgt(w));
  if (recentlyHit(m)) {
    if (!m.ai[0]) m.ai[0] = 1;
    if (dist < 30 && dist > m.ai[1]) m.ai[1] = dist;
    if (combat) {
      if (rollPct(m) <= 30 && flags & 1) {
        if (rollPct(m) < 50) w.useSkill(m, 0, tgt(w));
        else w.useSkill(m, 3, tgt(w));
        return;
      }
      w.startMode(m, 'A1');
      return;
    }
  }
  const life = w.lifePct(m);
  if (m.ai[0] === 2) {
    if (life >= 75) {
      m.ai[0] = 1;
      moveToTarget(w, m, false, 1, 7);
      return;
    }
    if (dist < 14 || dist <= m.ai[1]) {
      const run = m.type.velocity > 0 ? Math.min(120, Math.max(0, Math.trunc((100 * m.type.run) / m.type.velocity) - 100)) : 0;
      setVelocity(m, run);
      if (escape(w, m, 8)) return;
    }
    if (dist >= aiParam(m, 2)) {
      idle(w, m, 15);
      return;
    }
    if (!rollChance(m, 1)) {
      idle(w, m, 15);
      return;
    }
    if (flags & 2 && m.ai[2] <= 0 && rollChance(m, 3)) {
      w.useSkill(m, 1, tgt(w));
      m.ai[2] = 11;
      return;
    }
    if (flags & 4 && m.ai[2] <= 0 && rollChance(m, 3)) {
      w.useSkill(m, 2, tgt(w));
      m.ai[2] = 11;
      return;
    }
    if (flags & 1 && mt && mtd <= 20) {
      if (rollPct(m) < 50) castAt(0);
      else castAt(3);
      return;
    }
    circle(w, m, 4);
    return;
  }
  if (life < 33) {
    m.ai[0] = 2;
    if (escape(w, m, 8)) return;
  }
  if (combat) {
    m.ai[0] = 1;
    if (rollChance(m, 0)) {
      if (!(flags & 1) || !mt || rollPct(m) > 30) {
        w.startMode(m, 'A1');
        return;
      }
      if (mtd <= 20) {
        if (rollPct(m) < 50) castAt(0);
        else castAt(3);
        return;
      }
    }
    if (rollPct(m) < 33) circle(w, m, 4);
    else idle(w, m, 10);
    return;
  }
  if (dist >= aiParam(m, 2)) {
    if (m.ai[0] === 1) {
      moveToTarget(w, m, false, 1, 7);
      return;
    }
    idle(w, m, 15);
    return;
  }
  m.ai[0] = 1;
  if (rollChance(m, 1)) {
    if (flags & 2 && m.ai[2] <= 0 && rollChance(m, 3)) {
      w.useSkill(m, 1, tgt(w));
      m.ai[2] = 11;
      return;
    }
    if (flags & 4 && m.ai[2] <= 0 && rollChance(m, 3)) {
      w.useSkill(m, 2, tgt(w));
      m.ai[2] = 11;
      return;
    }
    if (!(flags & 1) || !mt || mtd > 20) {
      moveToTarget(w, m, false, 1, 7);
      return;
    }
    if (rollPct(m) >= 75) {
      circle(w, m, 4);
      return;
    }
    if (rollPct(m) < 50) castAt(0);
    else castAt(3);
    return;
  }
  if (dist > 20) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (dist < 9 && rollPct(m) < 50) {
    escape(w, m, 8);
    return;
  }
  // 근사(원작 미확인): 이하 분기(0x6FCD7080 이후)는 D2MOO 에서 원거리 선회/대기로 끝난다
  if (rollPct(m) < 33) circle(w, m, 4);
  else idle(w, m, 10);
};

/** 출처: AITHINK_Fn030_Fetish (Rat Man) — aip1 공격, aip2 대기, aip3 연속 공격 수, aip4 약함 % (대상 생명) */
const fetish: AiFn = (w, m, dist, combat) => {
  if (m.command === 1) {
    m.command = 0;
    m.ai[0] = 0;
    m.ai[1] = 0;
    setVelocity(m, 50);
    w.moveTo(m, w.target.x, w.target.y, false, 1);
    return;
  }
  const tl = w.targetLifePct();
  switch (m.ai[0]) {
    case 0:
      if (combat) {
        m.ai[0] = 1;
        m.ai[1] = 0;
        if (rollChance(m, 0)) w.startMode(m, 'A1');
        else idle(w, m, aiParam(m, 1));
        return;
      }
      setVelocity(m, 50);
      moveToTarget(w, m, false, 1, 7);
      return;
    case 1:
      m.ai[1]++;
      if (m.ai[1] > aiParam(m, 2) && tl > aiParam(m, 3)) {
        m.ai[0] = 2;
        m.ai[1] = 0;
        setVelocity(m, 50);
        escape(w, m, 14);
        return;
      }
      if (combat) {
        if (rollChance(m, 0)) w.startMode(m, 'A1');
        else idle(w, m, aiParam(m, 1));
        return;
      }
      setVelocity(m, 50);
      moveToTarget(w, m, false, 1, 7);
      return;
    case 2:
      if (dist <= 12) {
        setVelocity(m, 50);
        if (!escape(w, m, 14)) {
          m.ai[0] = 0;
          m.ai[1] = 0;
          idle(w, m, 10);
        }
        return;
      }
      m.ai[1]++;
      if (m.ai[1] > 1) {
        m.ai[0] = 0;
        m.ai[1] = 0;
      }
      if (rollPct(m) >= 20) idle(w, m, 10);
      else circle(w, m, 4);
      return;
    default:
      idle(w, m, 10);
  }
};

/** 출처: AITHINK_Fn034_Andariel — aip1 근접 중 분사, aip2 대기, aip3 원거리 공격·접근, aip4 원거리 분사 */
const andariel: AiFn = (w, m, _dist, combat) => {
  const hasSpray = !!m.type.skills[0]?.name, hasBolt = !!m.type.skills[1]?.name;
  if (combat) {
    if (hasSpray && rollChance(m, 0)) w.useSkill(m, 0, tgt(w));
    else w.startMode(m, 'A1');
    return;
  }
  if (rollChance(m, 1)) {
    idle(w, m, 5);
    return;
  }
  if (rollChance(m, 2)) {
    if (hasSpray && rollChance(m, 3)) {
      w.useSkill(m, 0, tgt(w));
      return;
    }
    if (hasBolt) {
      w.useSkill(m, 1, tgt(w));
      return;
    }
  }
  moveToTarget(w, m, false, 1, 7);
};

/**
 * 출처: AITHINK_Fn035_CorruptArcher (Dark Ranger) — aip1 접근, aip2 발사, aip3 대기, aip4 달아나기, aip5 항상 달리는 거리,
 *       aip6/7 스킬2/3 확률, aip8 접근 걸음 수
 */
const corruptArcher: AiFn = (w, m, _dist, combat) => {
  const mt = w.missileTarget(m);
  if (!mt) {
    if (rollPct(m) >= 50) idle(w, m, aiParam(m, 2));
    else circle(w, m, 3);
    return;
  }
  const t = { unitId: mt.unitId, x: mt.x, y: mt.y };
  if (!combat && recentlyHit(m)) {
    w.startMode(m, 'A1');
    return;
  }
  const d = mt.dist;
  if (d < 6 && rollChance(m, 3)) {
    setVelocity(m, 100);
    if (escape(w, m, 12, true)) return;
  }
  if (aiParam(m, 7) > 0 && d > aiParam(m, 7) && rollChance(m, 0)) {
    setVelocity(m, 10);
    w.moveTo(m, mt.x, mt.y, false, aiParam(m, 7));
    return;
  }
  if (d > aiParam(m, 4)) {
    setVelocity(m, 100);
    w.moveTo(m, mt.x, mt.y, true, aiParam(m, 4));
    return;
  }
  if (rollChance(m, 1)) {
    if (m.type.skills[1]?.name && rollChance(m, 5)) {
      w.useSkill(m, 1, t);
      return;
    }
    if (m.type.skills[2]?.name && rollChance(m, 6)) {
      w.useSkill(m, 2, t);
      return;
    }
    if (m.type.skills[0]?.name) {
      w.useSkill(m, 0, t);
      return;
    }
    w.startMode(m, 'A1');
    return;
  }
  idle(w, m, aiParam(m, 2));
};

/** 출처: AITHINK_Fn036_CorruptLancer — aip1 접근, aip2 공격, aip3 대기, aip4 달리기, aip5 항상 달리는 거리, aip6~8 스킬 확률 */
const corruptLancer: AiFn = (w, m, dist, combat) => {
  const steps = Math.max(m.type.meleeRange, 1);
  if (dist > aiParam(m, 4)) {
    setVelocity(m, 100);
    w.moveTo(m, w.target.x, w.target.y, true, steps);
    m.ai[0] = 1;
    return;
  }
  if (combat) {
    if (!m.ai[0] && !rollChance(m, 1)) {
      idle(w, m, aiParam(m, 2));
      return;
    }
    m.ai[0] = 0;
    if (m.type.skills[0]?.name && rollChance(m, 5)) w.useSkill(m, 0, tgt(w));
    else if (m.type.skills[1]?.name && rollChance(m, 6)) w.useSkill(m, 1, tgt(w));
    else if (m.type.skills[2]?.name && rollChance(m, 7)) w.useSkill(m, 2, tgt(w));
    else w.startMode(m, 'A1');
    return;
  }
  if (rollChance(m, 0)) {
    if (rollChance(m, 3)) {
      setVelocity(m, 100);
      w.moveTo(m, w.target.x, w.target.y, true, steps);
      return;
    }
    w.moveTo(m, w.target.x, w.target.y, false, 3);
    return;
  }
  idle(w, m, aiParam(m, 2));
};

/** 출처: AITHINK_Fn037_SkeletonBow — aip1 발사, aip2 대기, aip3 접근, aip4 걸음, aip5 목표 거리 */
const skeletonBow: AiFn = (w, m) => {
  if (recentlyHit(m)) {
    const t = w.missileTarget(m);
    if (t) {
      w.startMode(m, 'A1');
      return;
    }
  }
  const t = w.missileTarget(m);
  if (t && t.dist < 20) {
    if (rollChance(m, 0)) {
      w.startMode(m, 'A1');
      return;
    }
    if (rollPct(m) < 20) {
      circle(w, m, 3);
      return;
    }
    idle(w, m, aiParam(m, 1));
    return;
  }
  if (rollChance(m, 2)) {
    walkInRadius(w, m, aiParam(m, 3), aiParam(m, 4));
    return;
  }
  idle(w, m, 20);
};

/** 출처: AITHINK_Fn043_FoulCrowNest — aip1 스폰 간격, aip3 스폰 수 (다 낳으면 드롭 없이 무너진다) */
const foulCrowNest: AiFn = (w, m, dist) => {
  if (dist > 20) {
    idle(w, m, 25);
    return;
  }
  if (m.ai[1] < aiParam(m, 2)) {
    const diff = Math.abs(w.frame - m.ai[0]);
    if (!m.type.skills[0]?.name || diff < aiParam(m, 0)) {
      idle(w, m, (m.rng.roll() >>> 0) % 10 + 20);
      return;
    }
    m.ai[0] = w.frame;
    if (w.canUseSkill(m, 0, null)) {
      m.ai[1]++;
      w.useSkill(m, 0, tgt(w));
      return;
    }
    idle(w, m, (m.rng.roll() >>> 0) % 10 + 20);
    return;
  }
  w.dieQuietly(m);
};

/** 출처: AITHINK_Fn059_BloodRaven — 원위치 50 안에서 싸우고, Nest(좀비 소환)·Quick Strike(화살)·A1 활 */
const bloodRaven: AiFn = (w, m, dist, combat) => {
  let td = dist;
  if (!m.home) m.home = { x: Math.floor(m.x), y: Math.floor(m.y) };
  const home = m.home;
  const homeDist = aiDistance(w.target.x, w.target.y, home.x, home.y);
  if (td > 45) {
    idle(w, m, 5);
    return;
  }
  if (homeDist >= 50 || aiDistance(m.x, m.y, home.x, home.y) > 50) {
    m.ai[2] = 1;
    setVelocity(m, 100);
    if (w.moveTo(m, home.x, home.y, true, 1)) return;
  }
  if (m.ai[2] && aiDistance(m.x, m.y, home.x, home.y) > 5) {
    setVelocity(m, 100);
    if (w.moveTo(m, home.x, home.y, true, 1)) return;
  }
  m.ai[2] = 0;
  if (td > 20 && homeDist < 50) {
    td = Math.max(Math.trunc(td / 2), 12);
    setVelocity(m, 100);
    if (runCloseToTarget(w, m, td)) return;
  }
  m.ai[0] += 3;
  if (m.type.skills[0]?.name && !combat && m.ai[1] < 2 * w.difficulty + 8 && rollPct(m) < m.ai[0]) {
    const len = (m.rng.roll() >>> 0) % 15 + 5;
    let x: number, y: number;
    if ((m.rng.roll() >>> 0) & 1) {
      x = len;
      y = m.rng.pick(len);
    } else {
      x = m.rng.pick(len);
      y = len;
    }
    if ((m.rng.roll() >>> 0) & 1) x = -x;
    if ((m.rng.roll() >>> 0) & 1) y = -y;
    w.useSkill(m, 0, { x: Math.floor(w.target.x) + x, y: Math.floor(w.target.y) + y });
    m.ai[0] = 0;
    m.ai[1]++;
    return;
  }
  if (td > 5) {
    if (rollPct(m) < 5 && homeDist < 50) {
      setVelocity(m, 100);
      runCloseToTarget(w, m, 12);
      return;
    }
    const mt = w.missileTarget(m);
    if (mt && !recentlyHit(m) && rollPct(m) < 80) {
      if (m.type.skills[1]?.name && rollPct(m) < 10 * (w.difficulty + 4)) {
        w.useSkill(m, 1, { unitId: mt.unitId, x: mt.x, y: mt.y });
        return;
      }
      w.startMode(m, 'A1');
      return;
    }
    setVelocity(m, 50);
    if (circle(w, m, 4)) return;
  }
  if (rollPct(m) < 30 && td < 12) {
    setVelocity(m, 100);
    if (escape(w, m, 12 - td, true)) return;
  }
  w.startMode(m, 'A1');
};

/** 출처: AITHINK_Fn063_GargoyleTrap — aip1 발사 거리, aip2 발사 확률, aip3 발사 뒤 쉼, aip4 대기. 대상과 한 축이 6 미만일 때만 쏜다 */
const gargoyleTrap: AiFn = (w, m, dist) => {
  if (m.ai[0] > 0) {
    idle(w, m, m.ai[0]);
    m.ai[0] = 0;
    return;
  }
  const xd = Math.abs(Math.floor(w.target.x) - Math.floor(m.x)), yd = Math.abs(Math.floor(w.target.y) - Math.floor(m.y));
  if (xd < 6 || yd < 6) {
    if (m.type.skills[0]?.name && dist < aiParam(m, 0) && rollChance(m, 1)) {
      w.useSkill(m, 0, tgt(w));
      m.ai[0] = aiParam(m, 2);
      return;
    }
  }
  idle(w, m, aiParam(m, 3));
};

/** 출처: AITHINK_Fn064_SkeletonMage — aip1 발사, aip2 접근 거리, aip3 접근, aip4 너무 가까움, aip5 물러남, aip6 발사 거리, aip7 선회, aip8 대기 */
const skeletonMage: AiFn = (w, m, dist) => {
  const mt = w.missileTarget(m);
  let d = dist;
  if (mt) {
    d = mt.dist;
    if (d > aiParam(m, 1) && rollChance(m, 2)) {
      setVelocity(m, 10);
      w.moveTo(m, mt.x, mt.y, false, aiParam(m, 1));
      return;
    }
    if (d <= aiParam(m, 3) && rollChance(m, 4)) {
      setVelocity(m, 25);
      if (!escape(w, m, 5)) w.startMode(m, 'A1');
      return;
    }
    if (d < aiParam(m, 5) && rollChance(m, 0)) {
      w.startMode(m, 'A1');
      return;
    }
  }
  if (d <= aiParam(m, 1) || !rollChance(m, 2)) {
    if (!rollChance(m, 6)) idle(w, m, aiParam(m, 7));
    else circle(w, m, 4);
  } else {
    setVelocity(m, 10);
    w.moveTo(m, w.target.x, w.target.y, false, aiParam(m, 1));
  }
};

/** 출처: AITHINK_Fn090_Griswold — 근접이면 80% 공격, 아니면 50% 접근 */
const griswold: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollPct(m) < 80) {
      w.startMode(m, 'A1');
      return;
    }
  } else if (rollPct(m) < 50) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  idle(w, m, 10);
};

/** 출처: AITHINK_Fn098_Smith — 근접이면 공격, 아니면 생명이 적을수록 빠르게 접근 ((100 − 생명%) / 2) */
const smith: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    w.startMode(m, 'A1');
    return;
  }
  const life = Math.min(100, Math.max(0, w.lifePct(m)));
  setVelocity(m, (100 - life) >> 1);
  moveToTarget(w, m, false, 1, 7);
};

/**
 * 출처: D2GAME_AI_SpecialState13_6FCE5080 (The Countess) — 자기 방을 지키고, 지도 경로(DS1 path) 지점에 CountessFirewall,
 *       aip1 달리기, aip2 대기, aip3 공격(+10)
 * 근사(원작 미확인): 방 판정은 원위치에서 거리 30 이내로 대신한다 (원작 D2Common_10095 방 좌표 목록)
 */
const countess: AiFn = (w, m, dist, combat) => {
  if (!m.home) m.home = { x: Math.floor(m.x), y: Math.floor(m.y) };
  const home = m.home;
  const sameRoom = (x: number, y: number) => aiDistance(x, y, home.x, home.y) <= 30;
  if (!sameRoom(m.x, m.y)) {
    if (w.moveTo(m, home.x, home.y, true, 1)) return;
  }
  if (!sameRoom(w.target.x, w.target.y)) {
    if (Math.floor(m.x) === home.x && Math.floor(m.y) === home.y) {
      if (dist >= 25 || !countessWall(w, m)) idle(w, m, 10);
      return;
    }
    if (w.moveTo(m, home.x, home.y, true, 1)) return;
  }
  if (aiDistance(m.x, m.y, home.x, home.y) > 40) {
    if (w.moveTo(m, home.x, home.y, true, 1)) return;
  }
  if (countessWall(w, m)) return;
  if (combat) {
    if (rollPct(m) < aiParam(m, 2) + 10) {
      w.startMode(m, 'A1');
      return;
    }
  } else if (rollChance(m, 0)) {
    setVelocity(m, 100);
    w.moveTo(m, w.target.x, w.target.y, true, 1);
    return;
  }
  idle(w, m, aiParam(m, 1));
};

/** 출처: sub_6FCE5520 — 지도 경로 지점마다 Skill1 (CountessFirewall) 을 A1 모드로, 다 쓰면 700 프레임 뒤 다시 */
function countessWall(w: AiWorld, m: MonsterUnit): boolean {
  const path = m.mapPath ?? [];
  if (path.length && m.ai[0] < path.length) {
    const p = path[m.ai[0]];
    if (p && m.type.skills[0]?.name) {
      w.useSkill(m, 0, { x: p.x, y: p.y });
      m.ai[0]++;
      m.ai[1] = w.frame;
      return true;
    }
  } else if (Math.abs(w.frame - m.ai[1]) > 700) m.ai[0] = 0;
  return false;
}

export const ACT1_AI: Record<string, AiFn> = {
  Skeleton: skeleton,
  Zombie: zombie,
  Bighead: bighead,
  BloodHawk: bloodHawk,
  Fallen: fallen,
  Brute: brute,
  Wraith: wraith,
  CorruptRogue: corruptRogue,
  Goatman: goatman,
  FallenShaman: fallenShaman,
  QuillRat: quillRat,
  Arach: arach,
  Vampire: vampire,
  Fetish: fetish,
  Andariel: andariel,
  CorruptArcher: corruptArcher,
  CorruptLancer: corruptLancer,
  SkeletonBow: skeletonBow,
  FoulCrowNest: foulCrowNest,
  BloodRaven: bloodRaven,
  GargoyleTrap: gargoyleTrap,
  SkeletonMage: skeletonMage,
  Griswold: griswold,
  Smith: smith,
  Countess: countess,
};
