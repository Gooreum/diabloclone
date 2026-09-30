// Act 4 몬스터 AI (monstats AI 컬럼 이름 → AI 함수). aip1~8 은 aiParam(m, 0~7).
// 출처: D2MOO D2Game/src/AI/AiThink.cpp (https://github.com/ThePhrozenKeep/D2MOO)
//   AITHINK_Fn033_HellMeteor, Fn051_Diablo (+ AITHINK_GetTargetForBoss / GetTargetScore / CullPotentialTargetsForDiablo),
//   Fn055_Izual, Fn068_VileMother, Fn069_VileDog, Fn070_FingerMage, Fn071_Regurgitator (+ TargetCallback_Regurgitator),
//   Fn072_DoomKnight, Fn073_AbyssKnight, Fn074_OblivionKnight (+ TargetCallback_OblivionKnight), Fn089_Megademon, Fn099_TrappedSoul
//   AiBaal.cpp AI_GetRandomArrayIndex, AI_CheckSpecialSkillsOnPrimeEvil — 분기·파라미터·난수 호출 순서 그대로
import { aiDistance } from '../monster';
import type { AiFn } from './act1';
import { alive, dir8, evil, hasSkill, modeOnly, neighbours, runVel, sqDist, tgt } from './act2';
import {
  aiParam, circle, escape, idle, moveToTarget, recentlyHit, rollChance, rollPct, setVelocity, walkCloseToUnit, walkInRadius, wanderToPoint,
} from './tactics';
import type { MonsterUnit } from './types';

/** 출처: AITHINK_Fn033_HellMeteor (불꽃의 강 운석 함정) — aip1 발사, aip2 대기, aip3 범위 (자기 주변 무작위 지점) */
const hellMeteor: AiFn = (w, m) => {
  if (hasSkill(m, 0) && rollChance(m, 0)) {
    const r = aiParam(m, 2);
    const x = Math.floor(m.x) + m.rng.pick(2 * r) - r;
    const y = Math.floor(m.y) + m.rng.pick(2 * r) - r;
    w.useSkill(m, 0, { x, y, fixed: true });
    return;
  }
  idle(w, m, aiParam(m, 1));
};

// 근사(원작 미확인): D2Common_11055 (8 방향 순번 → 단위 오프셋) — Desert Turret 표와 같은 순서로 본다
const DIR8_OFF: readonly (readonly [number, number])[] = [[1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]];

/**
 * 출처: AITHINK_Fn068_VileMother (Hell Bovine 아님 — Flesh Spawner) — aip1 최대 생성, aip2 동시 최대, aip3 생성, aip4 공격, aip5 접근, aip6 선회, aip7 대기.
 * 새끼 = 같은 계열 순번의 Vile Child (거리 25 안 수를 센다), 대상 방향 표 [6,4,2,2,2,0,6,6] 에서 3 서브타일 떨어진 자리에 Nest
 */
const vileMother: AiFn = (w, m, _dist, combat) => {
  if (m.ai[0] < aiParam(m, 0) && evil(m) && rollChance(m, 2)) {
    const child = m.type.spawn;
    let count = 0;
    for (const o of w.monsters) if (o.type.id === child && alive(o) && aiDistance(o.x, o.y, m.x, m.y) <= 25) count++;
    if (count < aiParam(m, 1)) {
      let idx = dir8(m.x, m.y, w.target.x, w.target.y);
      const table = [6, 4, 2, 2, 2, 0, 6, 6];
      for (let i = 0; i < 8; i++) {
        idx %= 8;
        const off = DIR8_OFF[table[idx] ?? 0] ?? [0, 0];
        const x = 3 * off[0] + Math.floor(m.x), y = 3 * off[1] + Math.floor(m.y);
        if (hasSkill(m, 0) && (w.canSpawnAt?.(child, x, y) ?? true)) {
          w.useSkill(m, 0, { x, y, fixed: true });
          m.ai[0]++;
          return;
        }
        idx++;
      }
    }
  }
  if (combat) {
    if (rollChance(m, 3)) {
      w.startMode(m, 'A1');
      return;
    }
    idle(w, m, aiParam(m, 6));
    return;
  }
  if (m.ai[0] >= aiParam(m, 0) || rollChance(m, 4)) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (rollChance(m, 5)) {
    circle(w, m, 4);
    return;
  }
  idle(w, m, 15);
};

/** 출처: AITHINK_Fn069_VileDog (Flesh Beast) — 처음 5 프레임 쉰 뒤 aip1 공격, aip2 대기, aip3 접근 */
const vileDog: AiFn = (w, m, _dist, combat) => {
  if (!m.ai[0]) {
    m.ai[0] = 1;
    idle(w, m, 5);
    return;
  }
  if (combat) {
    if (rollChance(m, 0)) {
      w.startMode(m, 'A1');
      return;
    }
    idle(w, m, aiParam(m, 1));
    return;
  }
  if (rollChance(m, 2)) {
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  idle(w, m, 10);
};

/**
 * 출처: AITHINK_Fn070_FingerMage (Storm Caster·Grand Vizier) — aip1 근접·선회, aip2 시전, aip3 건강 %, aip4 다친 %, aip5 시전 거리,
 * aip6 달아나기 횟수, aip7 사거리 밖, aip8 근접 대기. 스킬 0 FingerMageSpider (저주 fingermagecurse)
 */
const fingerMage: AiFn = (w, m, dist, combat) => {
  const life = w.lifePct(m);
  const vel = runVel(m, true);
  if (recentlyHit(m)) {
    m.ai[0] = 0;
    if (combat) {
      w.startMode(m, 'A1');
      return;
    }
    if (hasSkill(m, 0) && dist < aiParam(m, 4)) {
      w.useSkill(m, 0, tgt(w));
      return;
    }
  }
  if (m.ai[0] === 1) {
    m.ai[1]++;
    if (life > aiParam(m, 2) || rollPct(m) < 25 || m.ai[1] > aiParam(m, 5)) m.ai[0] = 0;
    else if (dist < 14) {
      setVelocity(m, vel);
      escape(w, m, 14);
      return;
    }
    idle(w, m, 15);
    return;
  }
  if (m.leaderId === m.id && life < aiParam(m, 3)) {
    m.ai[0] = 1;
    m.ai[1] = 0;
    escape(w, m, 9);
    return;
  }
  if (combat) {
    if (rollChance(m, 0)) {
      w.startMode(m, 'A1');
      return;
    }
    if (!hasSkill(m, 0) || !rollChance(m, 1)) {
      circle(w, m, 5);
      return;
    }
    w.useSkill(m, 0, tgt(w));
    return;
  }
  if (dist >= aiParam(m, 4)) {
    if (dist >= aiParam(m, 6)) {
      idle(w, m, 15);
      return;
    }
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (hasSkill(m, 0) && rollChance(m, 1)) {
    w.useSkill(m, 0, tgt(w));
    return;
  }
  if (w.targetInfo?.().states.includes('fingermagecurse')) w.moveTo(m, w.target.x, w.target.y, false, 1);
  else idle(w, m, aiParam(m, 7));
};

/**
 * 출처: AITHINK_Fn071_Regurgitator (Corpse Spitter) — aip1 공격, aip2 근접 중 먹기, aip3 접근, aip4 먹이 찾기, aip5 근접 중 먹이 찾기, aip6 냄새 거리.
 * dwAiParam[0]: 0 기본 / 1 먹이 찾기 / 2 시체로 걷기 / 3 먹기 / 4 먹은 뒤 / 5 뱉은 뒤. 먹이 = 무른(soft) 같은 편 시체 (TargetCallback_Regurgitator)
 */
const regurgitator: AiFn = (w, m, _dist, combat) => {
  const reset = () => {
    m.ai[0] = 0;
    m.ai[1] = 0;
    m.ai[2] = 0;
    walkCloseToUnit(w, m, 8);
  };
  switch (m.ai[0]) {
    case 2: {
      const c = w.unit?.(m.ai[1]);
      if (!c || c.mode !== 'DD') {
        reset();
        return;
      }
      if (sqDist(m.x, m.y, c.x, c.y) > 4) {
        if (m.ai[2] >= 6) {
          reset();
          return;
        }
        w.moveTo(m, c.x, c.y, false, 1);
        m.ai[2]++;
      }
      m.ai[0] = 3;
      if (m.mode === 'NU') idle(w, m, 8);
      return;
    }
    case 3: {
      const c = w.unit?.(m.ai[1]);
      if (hasSkill(m, 0) && c && c.mode === 'DD') {
        w.useSkill(m, 0, { unitId: c.id, x: c.x, y: c.y });
        m.ai[0] = 4;
        return;
      }
      reset();
      return;
    }
    case 4:
      if (combat) escape(w, m, 8);
      else {
        w.startMode(m, 'A2');
        m.ai[0] = 5;
      }
      return;
    case 5:
      escape(w, m, 16);
      m.ai[0] = 0;
      return;
    default:
      break;
  }
  const smell = aiParam(m, 5) * aiParam(m, 5);
  let food: MonsterUnit | undefined, fd = smell;
  for (const o of neighbours(w, m)) {
    if (o.pet || o.mode !== 'DD' || o.corpseUsed || !evil(o) || !o.type.soft) continue;
    const d = sqDist(m.x, m.y, o.x, o.y);
    if (d > fd) continue;
    food = o;
    fd = d;
  }
  if (m.ai[0] === 1) {
    if (!food) {
      if (rollPct(m) < 20) {
        m.ai[0] = 0;
        m.ai[1] = 0;
        m.ai[2] = 0;
        return;
      }
      walkCloseToUnit(w, m, 8);
      return;
    }
    m.ai[1] = food.id;
    if (sqDist(m.x, m.y, food.x, food.y) <= 2) {
      idle(w, m, 8);
      m.ai[0] = 3;
      m.ai[2] = 0;
    } else {
      w.moveTo(m, food.x, food.y, false, 1);
      m.ai[0] = 2;
      m.ai[2] = 0;
    }
    return;
  }
  if (food) {
    if ((sqDist(m.x, m.y, food.x, food.y) < 9 && rollChance(m, 1)) || rollChance(m, 4)) {
      w.moveTo(m, food.x, food.y, false, 1);
      m.ai[0] = 2;
      m.ai[1] = food.id;
      m.ai[2] = 0;
      return;
    }
  }
  if (combat) {
    if (rollChance(m, 0)) w.startMode(m, 'A1');
    else idle(w, m, 15);
    return;
  }
  if (rollChance(m, 2)) {
    moveToTarget(w, m, false, 1, 0);
    return;
  }
  if (!food || !rollChance(m, 3)) {
    idle(w, m, 8);
    return;
  }
  w.moveTo(m, food.x, food.y, false, 1);
  m.ai[0] = 2;
  m.ai[1] = food.id;
  m.ai[2] = 0;
};

/** 출처: AITHINK_Fn072_DoomKnight — aip1 공격, aip2 근접 대기, aip3 접근, aip4 대기 */
const doomKnight: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollChance(m, 0)) {
      w.startMode(m, 'A1');
      return;
    }
    idle(w, m, aiParam(m, 1));
    return;
  }
  if (rollChance(m, 2)) {
    setVelocity(m, 0);
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  idle(w, m, aiParam(m, 3));
};

/** 근사(원작 미확인): 원작 pMonsterData->nComponent[10] (S3 레이어 변형 순번) — 4 이상이면 미사일을 쏘지 않는 무기 */
const s3Variant = (m: MonsterUnit): number => m.components?.S3 ?? 0;

/**
 * 출처: AITHINK_Fn073_AbyssKnight — aip1 뼈 갑옷 생명 %, aip2 뼈 갑옷, aip3 공격, aip4 근접 대기, aip5 발사 안 하는 거리, aip6 발사 쉼, aip7 접근, aip8 활동 거리.
 * 스킬 0 DoomKnightMissile (S3 변형별 미사일), 1 MonBoneArmor
 */
const abyssKnight: AiFn = (w, m, dist, combat) => {
  if (hasSkill(m, 1) && !m.states.has('bonearmor') && w.lifePct(m) < aiParam(m, 0) && rollChance(m, 1)) {
    w.useSkill(m, 1, null);
    return;
  }
  if (combat) {
    if (rollChance(m, 2)) {
      w.startMode(m, 'A1');
      return;
    }
    idle(w, m, aiParam(m, 3));
    return;
  }
  if (dist < aiParam(m, 4) && m.ai[0] <= 0) m.ai[0] = aiParam(m, 5);
  if (hasSkill(m, 0) && !m.ai[0] && s3Variant(m) < 4) {
    w.useSkill(m, 0, tgt(w));
    m.ai[0] = aiParam(m, 5);
    return;
  }
  if (m.ai[0] > 0) m.ai[0]--;
  if (rollChance(m, 6)) {
    void ((m.rng.roll() >>> 0) & 1);
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (dist < aiParam(m, 7)) {
    circle(w, m, 3);
    return;
  }
  idle(w, m, 15);
};

/**
 * 출처: AITHINK_Fn074_OblivionKnight — aip1 달아나는 거리, aip2 교전 거리, aip3 저주 간격, aip4 저주, aip5 발사, aip6 Bone Spirit, aip7 접근, aip8 접근 거리.
 * 스킬 0 DoomKnightMissile, 1 MonBoneArmor, 2 MonBoneSpirit, 3 Decrepify, 4 Bestow, 5 MonCurseCast
 */
const oblivionKnight: AiFn = (w, m, dist) => {
  // 출처: AITHINK_TargetCallback_OblivionKnight — 거리² 2500 안 가장 가까운 Doom Knight 계열 (방패로)
  let knight: MonsterUnit | undefined, kd = Infinity;
  for (const o of neighbours(w, m)) {
    if (!alive(o) || o.hidden || o.type.baseId !== 'doomknight1' || !evil(o)) continue;
    const d = sqDist(m.x, m.y, o.x, o.y);
    if (d > 2500) continue;
    if (d < kd) {
      kd = d;
      knight = o;
    }
  }
  const t = w.target;
  if (dist < aiParam(m, 0)) {
    const curse = m.type.skills[3]?.name ? 'decrepify' : '';
    if (curse && !w.targetInfo?.().states.includes(curse)) {
      w.useSkill(m, 3, tgt(w));
      m.ai[0] = w.frame + aiParam(m, 2);
      return;
    }
    if (knight && sqDist(knight.x, knight.y, t.x, t.y) > dist * dist && w.moveTo(m, knight.x, knight.y, false, 1)) return;
    setVelocity(m, 50);
    if (escape(w, m, 10)) return;
    if (hasSkill(m, 2)) {
      w.useSkill(m, 2, tgt(w));
      return;
    }
  }
  const mt = w.missileTarget(m);
  if (mt && mt.dist < aiParam(m, 1)) {
    const mtt = { unitId: mt.unitId, x: mt.x, y: mt.y };
    if (hasSkill(m, 5) && w.frame > m.ai[0] && rollChance(m, 3)) {
      w.useSkill(m, 5, tgt(w));
      m.ai[0] = w.frame + aiParam(m, 2);
      return;
    }
    if (rollChance(m, 4)) {
      if (hasSkill(m, 2) && rollChance(m, 5)) {
        w.useSkill(m, 2, mtt);
        return;
      }
      if (hasSkill(m, 0) && s3Variant(m) < 4) {
        w.useSkill(m, 0, mtt);
        return;
      }
    }
  }
  if (dist > aiParam(m, 7) && rollChance(m, 6)) {
    wanderToPoint(w, m, t.x, t.y, 6);
    return;
  }
  if (rollPct(m) >= 70) idle(w, m, 10);
  else circle(w, m, 3);
};

/**
 * 출처: AITHINK_Fn089_Megademon (Venom Lord) — aip1 원거리 불길, aip2 근접 불길, aip3 근접 공격, aip4 접근, aip5 근접 선회, aip6 불길 간격.
 * 불길(MegademonInferno) 사거리 = 스킬 레벨
 */
const megademon: AiFn = (w, m, dist, combat) => {
  const lvl = Math.max(w.skillLevel?.(m, 0) ?? m.type.skills[0]?.lvl ?? 1, 1);
  const inferno = m.states.has('inferno');
  if (!hasSkill(m, 0) || combat || dist >= lvl) {
    if (inferno) m.states.remove('inferno');
  } else if (inferno) m.states.remove('inferno');
  else {
    if (w.frame > m.ai[0] && rollChance(m, 0)) {
      m.ai[0] = w.frame + aiParam(m, 5);
      w.useSkill(m, 0, tgt(w));
      return;
    }
    if (!rollChance(m, 3)) idle(w, m, 10);
    else moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (!combat) {
    if (!rollChance(m, 3)) idle(w, m, 10);
    else moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (!hasSkill(m, 0) || w.frame <= m.ai[0] || !rollChance(m, 1)) {
    if (!rollChance(m, 2)) {
      if (!rollChance(m, 4)) idle(w, m, 5);
      else circle(w, m, 3);
    } else w.startMode(m, 'A1');
  } else {
    m.ai[0] = w.frame + aiParam(m, 5);
    w.useSkill(m, 0, tgt(w));
  }
};

/**
 * 출처: AITHINK_Fn055_Izual — aip1 공격, aip2 교전, aip3 원거리 노바, aip4 근접 노바, aip5 노바 뒤 쉼, aip6 휘두르기 수. 스킬 0 Frost Nova
 */
const izual: AiFn = (w, m, dist, combat) => {
  const t = tgt(w);
  if (!m.aiParam0) {
    // 출처: ACT4Q1_OnIzualActivated (퀘스트 훅)
    m.aiParam0 = 1;
    w.event?.({ type: 'bossActivated', monsterId: m.id, typeId: m.type.id });
  }
  if (m.ai[1]) {
    idle(w, m, m.ai[1]);
    m.ai[1] = 0;
    return;
  }
  if (!combat) {
    if (hasSkill(m, 0) && dist < 10) {
      if (m.ai[2] > 0) {
        moveToTarget(w, m, false, 1, 7);
        return;
      }
      if (rollChance(m, 2)) {
        w.useSkill(m, 0, t);
        m.ai[1] = aiParam(m, 4);
        m.ai[2] = aiParam(m, 5);
        return;
      }
    }
    if (m.ai[2] <= 0 && !rollChance(m, 1)) {
      if (dist <= 10) idle(w, m, m.type.aiDelay);
      else walkInRadius(w, m, 6, 9);
      return;
    }
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (m.ai[2] <= 0 && !rollChance(m, 0)) {
    m.ai[2] = 0;
    if (!hasSkill(m, 0) || !rollChance(m, 3)) idle(w, m, m.type.aiDelay);
    else {
      w.useSkill(m, 0, t);
      m.ai[1] = aiParam(m, 4);
      m.ai[2] = aiParam(m, 5);
    }
    return;
  }
  if (m.ai[2] > 0) m.ai[2]--;
  w.startMode(m, 'A1');
};

/** 출처: AiBaal.cpp AI_GetRandomArrayIndex — 가중치 합에서 rand 로 한 칸 (합 0 이면 기본값) */
export function randomArrayIndex(m: MonsterUnit, arr: readonly number[], def: number): number {
  const sum = arr.reduce((a, b) => a + b, 0);
  const r = m.rng.pick(sum);
  let acc = 0;
  for (let i = 0; i < arr.length; i++) {
    acc += arr[i] ?? 0;
    if (r < acc) return i;
  }
  return def;
}

/**
 * 디아블로 기술 가중치 표 (17 칸: 1 걷기, 2 A1, 3 A2, 4 S4 포효, 5 번개 숨결, 6 화염 노바, 7 냉기 손길, 8 화염 폭풍, 9 뼈 감옥,
 * 10 돌진, 12 선회, 13 불벽, 14 제자리로, 15 포털 감옥, 16 비키기). 출처: AITHINK_Fn051_Diablo (대상이 있을 때)
 */
export function diabloChances(o: {
  melee: boolean; colliding: boolean; targetLow: boolean; targetCold: boolean; fireRes: number; lightRes: number; closeToPortal: boolean;
  counter: number; farAway: boolean; furtherAway: boolean; special: boolean; distFull: number; score: number; playerCountDiff: number; canPrison: boolean; canPrisonPortal: boolean;
}): number[] {
  const c = new Array<number>(17).fill(0);
  let inMelee = false;
  if (o.melee) {
    c[2] = 40; c[3] = 70; c[5] = 40; c[6] = 24; c[7] = 40; c[8] = 15;
    if (o.targetLow) c[2] = 50;
    if (o.targetCold) {
      c[7] = 0;
      c[8] = 0;
    }
    if (o.fireRes > o.lightRes) c[6]! -= 10;
    if (o.fireRes < o.lightRes) c[6]! += 10;
    if (o.colliding) {
      c[5] = 0;
      c[6] = 0;
    }
    if (o.closeToPortal) c[15] = 10;
    inMelee = true;
  }
  if (o.colliding) {
    if (!inMelee) {
      c.fill(0);
      c[4] = 5; c[6] = 25; c[8] = 25; c[9] = 40; c[12] = 25;
      if (o.counter < 2) {
        c[6] = 0;
        c[1] = 25;
        c[8]! -= 5;
        c[9] = 0;
      }
      if (o.special || o.farAway) {
        if (o.farAway) {
          c[13] = 25;
          c[1] = 0;
          c[12] = 15;
          if (!c[9]) c[9] = 20;
          if (o.counter < 2) c[9]! -= 5;
        } else c[13] = 15;
      }
      if (o.furtherAway) c[14] = 60;
      if (o.closeToPortal) c[15] = 20;
    }
  } else if (!inMelee) {
    c.fill(0);
    c[5] = 25; c[6] = 25; c[8] = 15; c[9] = 20; c[10] = 10; c[12] = 20;
    if (o.distFull > 25) {
      c[10] = 20;
      c[5] = 0;
      c[8]! -= 5;
    }
    if (o.fireRes > o.lightRes) {
      c[6]! -= 10;
      c[8]! -= 10;
    }
    if (o.fireRes < o.lightRes) {
      c[6]! += 10;
      c[8]! += 10;
    }
    if (o.counter < 2) c[6]! -= 10;
    if (o.counter > 3) c[6]! += 5;
    if (o.score > 60) c[9]! += 10;
    if (o.counter < 2 && o.playerCountDiff < 2) c[9] = 0;
    if (o.special) {
      if (o.farAway) {
        c[1] = 0;
        c[12] = 10;
        c[10] = 0;
        c[13] = 15;
        if (!c[9]) c[9] = 10;
      } else {
        c[10] = 30;
        c[13] = 15;
        c[6]! += 10;
      }
    } else if (o.farAway) {
      c[1] = 0;
      c[12] = 10;
      c[10] = 0;
      c[13] = 15;
      if (!c[9]) c[9] = 10;
    }
    if (o.furtherAway) {
      c[9] = 20;
      c[14] = 60;
    }
    if (o.closeToPortal) c[15] = 15;
  }
  if (o.canPrison) c[9] = 0;
  if (c[15] && !o.canPrisonPortal) c[15] = 0;
  return c;
}

/**
 * 출처: AITHINK_Fn051_Diablo — 원위치 (AI 명령 10) 기준 85/105 밖이면 돌아가고, 대상 점수·저항·거리로 기술 가중치 (diabloChances) 를 굴린다.
 * 스킬: 0 DiabLight(번개 숨결, 연속), 1 DiabCold, 2 DiabFire(화염 노바), 3 DiabWall(화염 폭풍), 4 DiabRun, 5 PrimeFirewall, 6 DiabPrison.
 * 근사(원작 미확인): 대상 점수(AITHINK_GetTargetScore)의 피해·스킬 항은 Game.targetInfo 의 score 로, 싱글플레이 대상 수 1
 */
const diablo: AiFn = (w, m, dist, combat) => {
  if (!m.home) m.home = { x: Math.floor(m.x), y: Math.floor(m.y) };
  const home = m.home;
  const t = w.target;
  let p = 0;
  if (m.ai[0]) p = m.ai[0];
  else if (w.noTarget || t.dead) p = m.rng.pick(1000) >= 1 ? 11 : 4;
  else {
    const info = w.targetInfo?.();
    const colliding = !!w.missileBlocked?.(m);
    const melee = combat;
    const hd = aiDistance(t.x, t.y, home.x, home.y);
    const portal = info?.portal;
    const closeToPortal = !!portal && aiDistance(portal.x, portal.y, home.x, home.y) < 85;
    const chances = diabloChances({
      melee, colliding, targetLow: (info?.lifePct ?? 100) < 20, targetCold: !!info?.cold, fireRes: info?.fireRes ?? 0, lightRes: info?.lightRes ?? 0,
      closeToPortal, counter: 1, farAway: hd > 85, furtherAway: hd > 105, special: !!info?.special, distFull: dist, score: info?.score ?? 0,
      playerCountDiff: 0, canPrison: !!w.canUseSkill(m, 6, tgt(w)), canPrisonPortal: !!portal && !!w.canUseSkill(m, 6, { x: portal.x, y: portal.y, fixed: true }),
    });
    p = randomArrayIndex(m, chances, 11);
  }
  const skillCase = (slot: number, target: { unitId?: number; x: number; y: number; fixed?: boolean } = tgt(w)) => {
    if (!hasSkill(m, slot)) idle(w, m, 2);
    else w.useSkill(m, slot, target);
    m.ai[0] = 0;
  };
  switch (p) {
    case 1:
      setVelocity(m, 20);
      w.moveTo(m, t.x, t.y, false, 1);
      m.ai[0] = 0;
      return;
    case 2:
      w.startMode(m, 'A1');
      m.ai[0] = 0;
      return;
    case 3:
      w.startMode(m, 'A2');
      m.ai[0] = 0;
      return;
    case 4:
      modeOnly(w, m, 'S4');
      m.ai[0] = 0;
      return;
    case 5:
      if (!hasSkill(m, 0)) {
        idle(w, m, 2);
        m.ai[0] = 0;
        return;
      }
      if (m.states.has('inferno')) {
        m.states.remove('inferno');
        idle(w, m, 2);
        m.ai[0] = 0;
        return;
      }
      w.useSkill(m, 0, tgt(w));
      m.ai[0] = 5;
      return;
    case 6: return skillCase(2);
    case 7: return skillCase(1);
    case 8: return skillCase(3);
    case 9: return skillCase(6);
    case 10: return skillCase(4);
    case 12:
      circle(w, m, 4);
      m.ai[0] = 0;
      return;
    case 13: return skillCase(5);
    case 14: {
      setVelocity(m, 50);
      if (w.moveTo(m, home.x, home.y, false, 1)) {
        m.ai[0] = 0;
        return;
      }
      const off = aiDistance(m.x, m.y, home.x, home.y);
      const sx = Math.sign(Math.floor(m.x) - home.x), sy = Math.sign(Math.floor(m.y) - home.y);
      if (!w.moveTo(m, home.x + sx * (off >> 1), home.y + sy * (off >> 1), false, 1)) idle(w, m, 2);
      m.ai[0] = 0;
      return;
    }
    case 15: {
      const portal = w.targetInfo?.().portal;
      if (!portal || t.id !== undefined) {
        idle(w, m, portal ? 2 : 3);
        m.ai[0] = 0;
        return;
      }
      return skillCase(6, { x: portal.x, y: portal.y, fixed: true });
    }
    case 16:
      setVelocity(m, 20);
      walkCloseToUnit(w, m, 5);
      m.ai[0] = 0;
      return;
    default:
      idle(w, m, w.difficulty === 0 ? 12 : w.difficulty === 1 ? 8 : 4);
      m.ai[0] = 0;
  }
};

/** 출처: AITHINK_Fn099_TrappedSoul (불꽃의 강 갇힌 영혼) — 5 안에 들어오면 S2 로 깨어나 방향에 따라 A1/A2/S1 */
const trappedSoul: AiFn = (w, m, dist, combat) => {
  m.noTc = true;
  if (!w.noTarget && dist < 5) {
    if (!m.ai[0]) {
      m.ai[0] = 1;
      m.ai[1] = w.frame;
      w.startMode(m, 'S2');
      return;
    }
    if (combat && w.frame > m.ai[1]) {
      const ux = Math.floor(m.x), uy = Math.floor(m.y), tx = Math.floor(w.target.x), ty = Math.floor(w.target.y);
      if (ux >= tx) {
        if (uy <= ty) {
          w.startMode(m, 'A1');
          m.ai[1] = w.frame + 35;
          return;
        }
        if (ux > tx) {
          w.startMode(m, 'S1');
          m.ai[1] = w.frame + 5;
          return;
        }
      }
      if (uy < ty) {
        w.startMode(m, 'S1');
        m.ai[1] = w.frame + 5;
      } else {
        w.startMode(m, 'A2');
        m.ai[1] = w.frame + 35;
      }
      return;
    }
    w.startMode(m, 'S1');
    return;
  }
  if (m.ai[0]) w.startMode(m, 'S1');
  else idle(w, m, 15);
};

export const ACT4_AI: Record<string, AiFn> = {
  HellMeteor: hellMeteor,
  VileMother: vileMother,
  VileDog: vileDog,
  FingerMage: fingerMage,
  Regurgitator: regurgitator,
  DoomKnight: doomKnight,
  AbyssKnight: abyssKnight,
  OblivionKnight: oblivionKnight,
  Megademon: megademon,
  Izual: izual,
  Diablo: diablo,
  TrappedSoul: trappedSoul,
};

