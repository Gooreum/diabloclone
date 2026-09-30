// Act 3 몬스터 AI (monstats AI 컬럼 이름 → AI 함수). aip1~8 은 aiParam(m, 0~7).
// 출처: D2MOO D2Game/src/AI/AiThink.cpp (https://github.com/ThePhrozenKeep/D2MOO)
//   AITHINK_Fn024_Mosquito, Fn025_Willowisp (+ State_NotMoving / State_Moving / CheckConditionsForRitualOrBaptism), Fn027_ThornHulk,
//   Fn048_ZakarumZealot, Fn049_ZakarumPriest (+ TargetCallback_ZakarumPriest), Fn050_Mephisto (+ FindTargetForMephisto),
//   Fn052_FrogDemon, Fn056_Tentacle, Fn057_TentacleHead, Fn065_FetishShaman (+ TargetCallback_FetishShaman), Fn083_MosquitoNest,
//   Fn085_HighPriest (+ TargetCallback_HighPriest), Fn086_Hydra, Fn096_FetishBlowgun, Fn097_Spirit — 분기·파라미터·난수 호출 순서 그대로
import { MONFLAG } from '../uniques';
import type { AiFn } from './act1';
import { alive, evil, hasSkill, modeOnly, neighbours, runVel, sqDist, tgt } from './act2';
import {
  aiParam, circle, escape, idle, moveToTarget, recentlyHit, rollChance, rollPct, setVelocity, wait, walkCloseToUnit, walkInRadius, wanderToPoint,
} from './tactics';
import type { AiWorld, MonsterUnit } from './types';

/** 출처: AITHINK_Fn024_Mosquito (Sucker·Feeder) — aip3 공격, aip4 빨기/공격, aip5 배회 최대 횟수. dwAiParam[0]: 0 접근 / 1 배회 / 2 물러남 */
const mosquito: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollChance(m, 2) || !m.ai[1]) {
      m.ai[1]++;
      if (hasSkill(m, 0) && rollChance(m, 3)) w.useSkill(m, 0, tgt(w));
      else w.startMode(m, 'A1');
      return;
    }
    if (rollPct(m) > 20) {
      idle(w, m, 15);
      return;
    }
    m.ai[0] = 2;
    m.ai[1] = 0;
  }
  switch (m.ai[0]) {
    case 0:
      setVelocity(m, 100);
      w.moveTo(m, w.target.x, w.target.y, false, 1);
      return;
    case 1:
      setVelocity(m, 50);
      walkCloseToUnit(w, m, 4);
      m.ai[1]++;
      if (m.ai[1] > aiParam(m, 4)) {
        m.ai[0] = 0;
        m.ai[1] = 0;
      }
      return;
    case 2:
      setVelocity(m, 100);
      escape(w, m, 10);
      m.ai[0] = 1;
      m.ai[1] = 0;
      return;
    default:
      m.ai[0] = 0;
      m.ai[1] = 0;
      idle(w, m, 10);
  }
};

/**
 * 출처: AITHINK_Fn025_Willowisp (Gloam·Burning Soul) — aip1 시전(SC), aip2 근접, aip3 접근. 상태 0 대기 / 1 이동 / 2 시전 가능 / 3 근접 가능.
 * S1 = 사라졌다 나타나기. 근사(원작 미확인): 의식·세례 이스터에그 (상태 4 이상, 0.2~0.5%) 는 굴림만 하고 대기 상태로 돌아간다
 */
const willowisp: AiFn = (w, m, _dist, combat) => {
  const t = w.target;
  if (!w.noTarget && w.frame > m.ai[2] && sqDist(m.x, m.y, t.x, t.y) < 32 * 32 && m.ai[0] < 4 && (m.rng.roll() >>> 0) % 1000 <= w.difficulty + 2) {
    m.ai[0] = 4;
  }
  const st = m.ai[0];
  if (st >= 4) {
    // 근사(원작 미확인): 의식 대신 1800 프레임 재사용 대기만 적용
    m.ai[0] = 0;
    m.ai[2] = w.frame + 1800;
    idle(w, m, 10);
    return;
  }
  if (st === 1) {
    const finished = m.ai[1] <= 0;
    if (finished && combat) {
      modeOnly(w, m, 'S1');
      m.ai[0] = 3;
    } else if (finished && rollChance(m, 0)) {
      modeOnly(w, m, 'S1');
      m.ai[0] = 2;
    } else {
      m.ai[1]--;
      m.ai[0] = 1;
      if (rollChance(m, 2)) w.moveTo(m, t.x, t.y, false, 1);
      else walkCloseToUnit(w, m, 6);
    }
    return;
  }
  if (combat) {
    if (st === 3 || rollChance(m, 1)) {
      w.startMode(m, 'A1');
      m.ai[0] = 0;
      return;
    }
  } else if (st === 2 || rollChance(m, 0)) {
    w.startMode(m, 'SC');
    m.ai[0] = 0;
    return;
  }
  m.ai[0] = 1;
  m.ai[1] = 3;
  if (rollChance(m, 2)) w.moveTo(m, t.x, t.y, false, 1);
  else walkCloseToUnit(w, m, 4);
};

/** 출처: AITHINK_Fn027_ThornHulk (Thorned Hulk·Bramble Hulk) — aip1 공격, aip2 공격2/1, aip3 선회, aip4 광란(MonFrenzy), aip5 광란 속도, aip6 연속 공격2 */
const thornHulk: AiFn = (w, m, _dist, combat) => {
  if (!combat || w.noTarget) {
    m.ai[0] = 0;
    setVelocity(m, 0);
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (m.ai[0] > 0) {
    if (w.useSkill(m, 0, tgt(w))) m.nextAfterMode = aiParam(m, 4);
    m.ai[0]--;
    if (m.ai[0] <= 0) m.ai[1] = 3;
    return;
  }
  if (rollChance(m, 0)) {
    if (m.ai[1] > 0 || !rollChance(m, 3)) {
      m.ai[1]--;
      w.startMode(m, rollChance(m, 1) ? 'A2' : 'A1');
    } else {
      if (w.useSkill(m, 0, tgt(w))) m.nextAfterMode = aiParam(m, 4);
      m.ai[0] = aiParam(m, 5);
    }
    return;
  }
  if (rollChance(m, 2)) {
    circle(w, m, 4);
    return;
  }
  idle(w, m, 15);
};

/**
 * 출처: AITHINK_Fn065_FetishShaman (Flayer Shaman·Soul Killer Shaman) — aip1 부활, aip2 부활 능력, aip3 부활 거리², aip4 선회, aip5 찾는 거리.
 * 스킬 0 FetishInferno (사거리 = 스킬 레벨), 2 Resurrect2. 불길 중이 아니고 대상이 사거리 안이면 부하에게 공격 명령(1) + Inferno
 */
const fetishShaman: AiFn = (w, m, dist) => {
  const lvl = Math.max(w.skillLevel?.(m, 0) ?? m.type.skills[0]?.lvl ?? 1, 1);
  const inferno = m.states.has('inferno');
  if (!hasSkill(m, 0) || dist >= lvl || inferno) {
    if (inferno) m.states.remove('inferno');
    const cap = aiParam(m, 1);
    const maxD = aiParam(m, 4) * aiParam(m, 4);
    let dead: MonsterUnit | undefined, dd = Infinity;
    for (const o of neighbours(w, m)) {
      if (o.hidden || (!cap && o.leaderId !== m.id)) continue;
      const base = o.type.baseId;
      if (!(base === 'fetish1' || (base === 'fetishblow1' && cap !== 1))) continue;
      if (!evil(o) || (cap < 3 && o.flags & (MONFLAG.UNIQUE | MONFLAG.CHAMPION))) continue;
      const d = sqDist(m.x, m.y, o.x, o.y);
      if (d > maxD) continue;
      if (o.mode === 'DD' && !o.corpseUsed && d < dd) {
        dead = o;
        dd = d;
      }
    }
    if (dead && rollChance(m, 0) && w.canUseSkill(m, 2, { unitId: dead.id, x: dead.x, y: dead.y })) {
      // AI 명령 14 (부활 자리로) 를 부하에게
      for (const o of w.monsters) {
        if (o !== m && o.leaderId === m.id && alive(o)) {
          o.command = 14;
          o.cmdTarget = dead.id;
        }
      }
      if (dd <= aiParam(m, 2)) w.useSkill(m, 2, { unitId: dead.id, x: dead.x, y: dead.y });
      else wanderToPoint(w, m, dead.x, dead.y, 10);
      return;
    }
    if (!rollChance(m, 3)) idle(w, m, 10);
    else circle(w, m, 4);
    return;
  }
  for (const o of w.monsters) {
    if (o !== m && o.leaderId === m.id && alive(o)) {
      o.command = 1;
      o.cmdTarget = w.target.id ?? -1;
    }
  }
  w.useSkill(m, 0, tgt(w));
};

/** 출처: AITHINK_Fn096_FetishBlowgun (Flayer 취관) — aip1 사거리, aip2 달아나기. dwAiParam[0]: 0 발사 / 1 선회 / 2 달아나기 */
const fetishBlowgun: AiFn = (w, m, dist, combat) => {
  if (m.command === 1 || m.command === 14) {
    const cmd = m.command;
    m.command = 0;
    const u = m.cmdTarget !== undefined && m.cmdTarget >= 0 ? w.unit?.(m.cmdTarget) : undefined;
    const target = cmd === 1 ? (u ?? (m.cmdTarget === -1 ? undefined : w.target)) : u;
    if (target) {
      m.ai[0] = 0;
      m.ai[1] = 0;
      if (cmd === 1) w.startMode(m, 'A1');
      else {
        setVelocity(m, 50);
        w.moveTo(m, target.x, target.y, false, 1);
      }
      return;
    }
  } else if (m.command) m.command = 0;
  if (combat) {
    if (rollChance(m, 1)) m.ai[0] = 2;
  } else {
    if (dist > aiParam(m, 0)) {
      setVelocity(m, 50);
      wanderToPoint(w, m, w.target.x, w.target.y, 6);
      return;
    }
    if (dist < 6 && rollChance(m, 1)) m.ai[0] = 2;
  }
  const mt = w.missileTarget(m);
  switch (m.ai[0]) {
    case 0:
      m.ai[1]++;
      if (m.ai[1] > (m.rng.roll() >>> 0) % 3 + 3) {
        m.ai[0] = 1;
        m.ai[1] = 0;
      }
      if (mt) w.startMode(m, 'A1');
      else circle(w, m, 4);
      return;
    case 1:
      m.ai[0] = 0;
      m.ai[1] = 0;
      setVelocity(m, 50);
      if (!circle(w, m, 6)) idle(w, m, 10);
      return;
    case 2:
      if (dist <= 12) {
        setVelocity(m, 50);
        if (!escape(w, m, 14)) {
          w.startMode(m, 'A1');
          m.ai[0] = 0;
          m.ai[1] = 0;
        }
      } else if (rollPct(m) >= 20 || !circle(w, m, 4)) {
        m.ai[0] = 0;
        m.ai[1] = 0;
        idle(w, m, 10);
      }
      return;
    default:
      idle(w, m, 10);
  }
};

/**
 * 출처: AITHINK_Fn052_FrogDemon (Swamp Dweller·Bog Creature) — aip1 근접 공격, aip2 근접 중 발사, aip3 근접 선회, aip4 원거리 선회, aip5 발사,
 * aip6 발사 거리, aip7 대기, aip8 떠오르는 거리. dwAiParam[2]: 0 처음 / 1 물속 / 2 물 밖. 대상 방식 5 (대상 없어도 호출)
 */
const frogDemon: AiFn = (w, m, dist, combat) => {
  switch (m.ai[2]) {
    case 0:
      if (hasSkill(m, 0) && dist > 12 && !w.noTarget) {
        w.useSkill(m, 0, tgt(w));
        wait(w, m, 8);
        m.ai[2] = 1;
        m.hidden = true;
        wait(w, m, 12);
        return;
      }
      if (hasSkill(m, 1)) {
        m.hidden = false;
        w.useSkill(m, 1, null);
        m.ai[2] = 2;
        return;
      }
      m.ai[2] = 2;
      idle(w, m, 12);
      return;
    case 1:
      if (hasSkill(m, 1) && !w.noTarget) {
        if (dist < aiParam(m, 7) || (dist < 20 && m.ai[1] > 64)) {
          m.hidden = false;
          w.useSkill(m, 1, null);
          m.ai[2] = 2;
          return;
        }
      }
      m.hidden = true;
      wait(w, m, 24);
      m.ai[2] = 1;
      m.ai[1]++;
      return;
    default:
      if (w.noTarget) {
        wait(w, m, 32);
        return;
      }
      if (combat) {
        if (!rollChance(m, 1)) {
          if (rollChance(m, 0)) {
            w.startMode(m, 'A1');
            return;
          }
          if (!rollChance(m, 2)) {
            wait(w, m, aiParam(m, 6));
            return;
          }
          circle(w, m, 3);
          return;
        }
      } else {
        if (dist >= aiParam(m, 5)) {
          if (!rollChance(m, 3)) {
            w.moveTo(m, w.target.x, w.target.y, false, 4);
            return;
          }
          circle(w, m, 3);
          return;
        }
        if (!rollChance(m, 4)) {
          if (rollChance(m, 3)) {
            circle(w, m, 4);
            return;
          }
          wait(w, m, aiParam(m, 6));
          return;
        }
      }
      w.startMode(m, 'A2');
  }
};

/** 출처: AITHINK_Fn048_ZakarumZealot — aip1 공격, aip2 공격2, aip3 다친 %, aip4 달리기. Act 3 에서 A3Q5 (Travincal) 를 끝낸 플레이어에게서는 달아난다 */
const zealot: AiFn = (w, m, _dist, combat) => {
  const vel = runVel(m, true);
  const life = w.lifePct(m);
  if (!w.noTarget && w.target.id === undefined && w.questState?.(21, 0) && (w.levelNo ?? 0) >= 75 && (w.levelNo ?? 0) <= 102) {
    setVelocity(m, vel);
    if (!escape(w, m, 8, true)) walkCloseToUnit(w, m, 6);
    return;
  }
  if (recentlyHit(m)) {
    if (!m.ai[1] && life < aiParam(m, 2)) {
      m.ai[0] = 0;
      setVelocity(m, vel);
      if (escape(w, m, 8, true)) return;
      m.ai[1] = 5;
    }
    // 근사(원작 미확인): 발밑 미사일 충돌 (COLLIDE_MISSILE 칸 위) 검사는 생략
  }
  if (m.ai[1]) m.ai[1]--;
  if (!combat) {
    m.ai[0] = 0;
    if (rollChance(m, 3)) {
      setVelocity(m, vel);
      w.moveTo(m, w.target.x, w.target.y, true, 1);
      return;
    }
    moveToTarget(w, m, false, 1, 7);
    return;
  }
  if (m.ai[0] && !rollChance(m, 0)) {
    m.ai[0] = 0;
    if (rollPct(m) >= 80) circle(w, m, 4);
    else idle(w, m, 10);
    return;
  }
  m.ai[0] = 1;
  w.startMode(m, rollChance(m, 1) ? 'A2' : 'A1');
};

/**
 * 출처: AITHINK_Fn049_ZakarumPriest (Heirophant) — aip1 공격, aip2 Blizzard, aip3 번개, aip4 시전, aip5 주문 간격, aip6 치료 거리.
 * 스킬 0 ZakarumHeal, 1 ZakarumLightning, 2 MonTeleport, 3 MonBlizzard
 */
const zakarumPriest: AiFn = (w, m, _dist, combat) => {
  const life = w.lifePct(m);
  const t = w.target;
  if (combat || recentlyHit(m)) {
    if (hasSkill(m, 2) && life < 33 && w.frame > m.ai[0]) {
      m.ai[0] = w.frame + 4 * aiParam(m, 4);
      const sh = combat ? 2 : 0;
      const x = ((Math.floor(t.x) - Math.floor(m.x)) << sh) + Math.floor(t.x);
      const y = ((Math.floor(t.y) - Math.floor(m.y)) << sh) + Math.floor(t.y);
      if (w.canUseSkill(m, 2, { x, y, fixed: true })) {
        w.useSkill(m, 2, { x, y, fixed: true });
        return;
      }
    }
    if (combat && rollChance(m, 0)) {
      w.startMode(m, 'A1');
      return;
    }
  }
  // 출처: AITHINK_TargetCallback_ZakarumPriest — 치료 거리² 안의 Zealot·Cantor 중 생명 60 % 이하에서 가장 낮은 것
  const maxD = aiParam(m, 5) * aiParam(m, 5);
  let heal: MonsterUnit | undefined, low = Infinity;
  for (const o of neighbours(w, m)) {
    if (!evil(o) || !alive(o)) continue;
    if ((o.type.baseId !== 'zealot1' && o.type.baseId !== 'cantor1') || sqDist(m.x, m.y, o.x, o.y) > maxD) continue;
    const lp = w.lifePct(o);
    if (lp > 60) continue;
    if (lp < low) {
      low = lp;
      heal = o;
    }
  }
  if (hasSkill(m, 0) && heal && rollPct(m) < 25) {
    w.useSkill(m, 0, { unitId: heal.id, x: heal.x, y: heal.y });
    return;
  }
  if (w.missileBlocked?.(m)) {
    if (rollChance(m, 0) && hasSkill(m, 3) && w.frame > m.ai[1] && rollChance(m, 1)) {
      w.useSkill(m, 3, tgt(w));
      m.ai[1] = w.frame + aiParam(m, 4);
      return;
    }
  } else if (rollChance(m, 3)) {
    if (hasSkill(m, 3) && w.frame > m.ai[1] && rollChance(m, 1)) {
      w.useSkill(m, 3, tgt(w));
      m.ai[1] = w.frame + aiParam(m, 4);
      return;
    }
    if (hasSkill(m, 1) && w.frame > m.ai[2] && rollChance(m, 2)) {
      w.useSkill(m, 1, tgt(w));
      m.ai[2] = w.frame + 20;
      return;
    }
  }
  if (rollPct(m) >= 30) idle(w, m, 20);
  else circle(w, m, 4);
};

// 출처: AITHINK_Fn085_HighPriest — Hydra 자리 (대상 기준 네 대각선 5)
const HYDRA_OFF: readonly (readonly [number, number])[] = [[-5, -5], [5, -5], [5, 5], [-5, 5]];

/**
 * 출처: AITHINK_Fn085_HighPriest (Council Member) — aip1 교전, aip2 원거리 치료, aip3 치료·히드라 간격, aip4 원거리 히드라, aip5 원거리 번개(S1),
 * aip6 이탈, aip7 교전 중 번개, aip8 사거리. 스킬 0 Hydra, 1 ZakarumHeal
 */
const highPriest: AiFn = (w, m, dist, combat) => {
  if (!m.ai[0]) {
    if (combat) {
      if (!rollChance(m, 0)) escape(w, m, 6);
      else {
        m.ai[0] = 1;
        w.startMode(m, 'A1');
      }
      return;
    }
    if (hasSkill(m, 1) && w.frame > m.ai[1] && rollChance(m, 1)) {
      // 출처: AITHINK_TargetCallback_HighPriest — 거리² 2500 안에서 생명 75 % 미만 중 가장 낮은 같은 편
      let heal: MonsterUnit | undefined, low = 75;
      for (const o of neighbours(w, m).concat([m])) {
        if (!evil(o) || !alive(o) || sqDist(m.x, m.y, o.x, o.y) > 2500) continue;
        const lp = w.lifePct(o);
        if (lp > 75 || lp >= low) continue;
        low = lp;
        heal = o;
      }
      if (heal) {
        m.ai[1] = w.frame + aiParam(m, 2);
        w.useSkill(m, 1, { unitId: heal.id, x: heal.x, y: heal.y });
        return;
      }
    }
    if (!hasSkill(m, 0) || w.frame <= m.ai[1] || dist >= aiParam(m, 7) || !rollChance(m, 3)) {
      if (aiParam(m, 4) > 0) {
        const range = (m.type.missS1 && w.missileRange?.(m.type.missS1)) || 15;
        if (dist < range - 2 && rollChance(m, 4)) {
          w.startMode(m, 'S1');
          return;
        }
      }
      if (rollPct(m) < 80) {
        if (dist <= aiParam(m, 7)) circle(w, m, 3);
        else w.moveTo(m, w.target.x, w.target.y, false, 6);
        return;
      }
    } else {
      const off = HYDRA_OFF[(m.rng.roll() >>> 0) & 3] ?? [0, 0];
      w.useSkill(m, 0, { x: Math.floor(w.target.x) + off[0], y: Math.floor(w.target.y) + off[1], fixed: true });
      m.ai[1] = w.frame + 100;
      return;
    }
  }
  m.ai[0] = 1;
  if (combat) {
    if (!rollChance(m, 6)) {
      if (!rollChance(m, 5)) {
        if (rollPct(m) >= 90) idle(w, m, 10);
        else w.startMode(m, 'A1');
      } else {
        escape(w, m, 6);
        m.ai[0] = 0;
      }
    } else w.startMode(m, 'S1');
    return;
  }
  if (dist >= 6 || !rollChance(m, 6)) {
    if (!rollChance(m, 5)) {
      if (rollPct(m) >= 70) walkCloseToUnit(w, m, 12);
      else moveToTarget(w, m, false, 1, 7);
    } else {
      m.ai[0] = 0;
      idle(w, m, 10);
    }
    return;
  }
  w.startMode(m, 'S1');
};

/**
 * 출처: AITHINK_Fn056_Tentacle (Water Watcher Limb) — aip1 공격, aip2 잠수, aip3 잠수 시간(초), aip4 나오는 시간(초), aip5 대기, aip6 활동 거리.
 * 주인(머리)이 없으면 죽고, 머리가 죽으면 40% 로 죽는다. dwAiParam[2]: 0 처음 / 1 물속 / 2 물 밖. 대상 방식 2
 */
const tentacle: AiFn = (w, m, dist, combat) => {
  const owner = m.leaderId !== m.id ? w.unit?.(m.leaderId) : undefined;
  if (!owner) {
    w.dieQuietly(m);
    return;
  }
  if (owner.mode === 'DD' && rollPct(m) < 40) {
    w.dieQuietly(m);
    return;
  }
  if (hasSkill(m, 0)) {
    if (!m.ai[2]) {
      w.useSkill(m, 0, null);
      wait(w, m, 8);
      m.ai[1] = w.frame + 25 * aiParam(m, 2);
      m.ai[2] = 1;
      return;
    }
    if (m.ai[2] === 2 && w.frame > m.ai[1]) {
      if (dist > aiParam(m, 5) || (!combat && rollChance(m, 1)) || (owner.mode === 'SQ' && rollPct(m) < 50)) {
        w.useSkill(m, 0, null);
        wait(w, m, 8);
        m.ai[1] = w.frame + 25 * aiParam(m, 2);
        m.ai[2] = 1;
        return;
      }
    }
  }
  if (hasSkill(m, 1)) {
    if (m.ai[2] !== 1) {
      if (combat && rollChance(m, 0)) w.startMode(m, 'A1');
      else idle(w, m, aiParam(m, 4));
      return;
    }
    if (w.frame > m.ai[1]) {
      if (combat || dist < aiParam(m, 5) || (owner.mode !== 'SQ' && rollPct(m) < 5)) {
        w.useSkill(m, 1, null);
        m.ai[1] = w.frame + 25 * aiParam(m, 3);
        m.ai[2] = 2;
        return;
      }
    }
  }
  if (m.ai[2] === 1) {
    wait(w, m, aiParam(m, 4));
    return;
  }
  if (combat && rollChance(m, 0)) {
    w.startMode(m, 'A1');
    return;
  }
  idle(w, m, aiParam(m, 4));
};

/** 출처: AITHINK_Fn057_TentacleHead (Water Watcher Head) — Tentacle 과 같은 인자, A1 = tentaclegoo 발사. 대상 방식 2 */
const tentacleHead: AiFn = (w, m, dist, combat) => {
  if (hasSkill(m, 0)) {
    if (!m.ai[2]) {
      w.useSkill(m, 0, null);
      wait(w, m, 8);
      m.ai[2] = 1;
      m.ai[1] = w.frame + 25 * aiParam(m, 2);
      return;
    }
    if (m.ai[2] === 2 && w.frame > m.ai[1]) {
      if (dist > aiParam(m, 5) || (!combat && rollChance(m, 1))) {
        w.useSkill(m, 0, null);
        wait(w, m, 20);
        m.ai[2] = 1;
        m.ai[1] = w.frame + 25 * aiParam(m, 2);
        return;
      }
    }
  }
  if (hasSkill(m, 1) && m.ai[2] === 1 && w.frame > m.ai[1] && (combat || dist < aiParam(m, 5))) {
    w.useSkill(m, 1, null);
    m.ai[2] = 2;
    m.ai[1] = w.frame + 25 * aiParam(m, 3);
    return;
  }
  if (m.ai[2] !== 1) {
    const mt = w.missileTarget(m);
    if (rollChance(m, 0)) {
      if (mt || !w.noTarget) {
        w.startMode(m, 'A1');
        return;
      }
    }
  }
  wait(w, m, aiParam(m, 4));
};

/** 출처: AITHINK_Fn083_MosquitoNest — aip1 최대 생성 수, aip2 활동 거리, aip3 생성 간격. 다 만들면 드롭 없이 무너진다. 대상 방식 0 */
const mosquitoNest: AiFn = (w, m, dist) => {
  if (dist > aiParam(m, 1)) {
    idle(w, m, 25);
    return;
  }
  if (m.ai[1] <= aiParam(m, 0)) {
    if (hasSkill(m, 0) && w.frame > m.ai[0] && w.canUseSkill(m, 0, null)) {
      m.ai[0] = w.frame + aiParam(m, 2);
      m.ai[1]++;
      w.useSkill(m, 0, tgt(w));
      return;
    }
    idle(w, m, 25);
    return;
  }
  w.dieQuietly(m);
};

/** 출처: AITHINK_FindTargetForMephisto — 거리² 1024 안에서 생명이 가장 적은 대상 (aip2 % 로 그쪽을 노린다) */
function mephistoTarget(w: AiWorld, m: MonsterUnit): { unitId?: number; x: number; y: number } {
  const cand: { unitId?: number; x: number; y: number; life: number }[] = [];
  const t = w.target;
  if (!t.dead && sqDist(m.x, m.y, t.x, t.y) <= 1024) cand.push({ ...(t.id !== undefined ? { unitId: t.id } : {}), x: t.x, y: t.y, life: w.targetLifePct() });
  let low: (typeof cand)[number] | undefined;
  for (const c of cand) if (!low || c.life < low.life) low = c;
  if (low && rollPct(m) < aiParam(m, 1)) return low;
  return tgt(w);
}

/**
 * 출처: AITHINK_Fn050_Mephisto — aip1 상태 2/3, aip2·aip3 대상 고르기. dwAiParam[0] 시전 남은 횟수, [1] 선회 간격, [2] 상태 (0 쉼 / 1 달아남 / 2 시전 / 3 근접 / 4 접근).
 * 스킬: 0 PrimeLightning, 1 PrimeBolt, 2 PrimePoisonNova, 3 MephistoMissile, 4 MephFrostNova, 5 Blizzard (4·5 는 Nightmare 부터).
 * "해자 속임수": Normal 에서는 미사일 벽 너머 대상에게도 Blizzard 를 쓰지 않는다 (원작 pGame->nDifficulty 검사)
 */
const mephisto: AiFn = (w, m, dist, combat) => {
  const life = w.lifePct(m);
  const lc = Math.max(Math.trunc((100 - life) / 5), 0);
  let st = m.ai[2];
  if (combat) {
    if (rollPct(m) <= aiParam(m, 0)) {
      st = 2;
      m.ai[0] = (m.rng.roll() >>> 0) % 3 + 3;
    } else st = 3;
  } else if (dist <= 20) {
    if (!m.ai[2]) {
      if (life <= 20 && dist < 5 && rollPct(m) < 40) st = 1;
      else if (rollPct(m) >= lc + 50) {
        if (rollPct(m) >= 65) idle(w, m, 10);
        else if (rollPct(m) < 65 || dist > 5) circle(w, m, 4);
        else {
          setVelocity(m, 0);
          moveToTarget(w, m, false, 1, 7);
        }
        m.ai[2] = 0;
        return;
      } else {
        st = 2;
        m.ai[0] = (m.rng.roll() >>> 0) % 3 + 3;
      }
    }
  } else st = 4;
  switch (st) {
    case 0:
      idle(w, m, 5);
      m.ai[2] = 4;
      return;
    case 1:
      setVelocity(m, 50);
      if (escape(w, m, 8)) {
        m.ai[2] = 0;
        return;
      }
      if (combat) {
        w.useSkill(m, 2, tgt(w));
        m.ai[2] = 0;
        return;
      }
      st = 0;
      break;
    case 2:
      break;
    case 3:
      if (rollPct(m) >= lc + 80) {
        setVelocity(m, 50);
        if (!circle(w, m, 3)) walkCloseToUnit(w, m, 12);
      } else if (rollPct(m) >= 80 - lc) w.useSkill(m, 2, tgt(w));
      else w.startMode(m, 'A1');
      m.ai[2] = 0;
      return;
    case 4:
      setVelocity(m, 50);
      if (!wanderToPoint(w, m, w.target.x, w.target.y, 6)) {
        if (!walkInRadius(w, m, 12, 6)) walkCloseToUnit(w, m, 12);
      }
      m.ai[2] = 0;
      return;
    default:
      if (rollPct(m) >= 65) idle(w, m, 10);
      else if (rollPct(m) < 65 || dist > 5) circle(w, m, 4);
      else {
        setVelocity(m, 0);
        moveToTarget(w, m, false, 1, 7);
      }
      m.ai[2] = 0;
      return;
  }
  m.ai[0]--;
  if (!m.ai[0]) st = 0;
  if (!m.ai[1]) {
    m.ai[1] = 2;
    if (!circle(w, m, 3)) walkCloseToUnit(w, m, 12);
    m.ai[2] = st;
    return;
  }
  m.ai[1]++;
  const target = mephistoTarget(w, m);
  let valid = 0;
  while (valid < 8 && hasSkill(m, valid)) valid++;
  if (valid <= 0) walkCloseToUnit(w, m, 6);
  else {
    const chance = Math.trunc(100 / valid);
    const r = rollPct(m);
    const blocked = w.difficulty > 0 && !!w.missileBlocked?.(m);
    if (w.difficulty && (blocked || dist > 30)) w.useSkill(m, 5, target);
    else if (dist < 15 && r < chance && w.difficulty) w.useSkill(m, 4, target);
    else if (r < 2 * chance) w.useSkill(m, 3, target);
    else if (r < 3 * chance) w.useSkill(m, 1, target);
    else w.useSkill(m, 0, target);
  }
  if (rollPct(m) < 50 - lc) m.ai[1] = 0;
  m.ai[2] = st;
};

/** 출처: AITHINK_Fn097_Spirit (Mephisto 의 영혼 장식) — 근접이면 한 번 A1, 그 뒤 50 프레임씩 쉰다 */
const spirit: AiFn = (w, m, _dist, combat) => {
  if (m.ai[0]) {
    idle(w, m, 50);
    return;
  }
  if (combat) {
    m.ai[0] = 1;
    w.startMode(m, 'A1');
    return;
  }
  idle(w, m, 10);
};

/** 출처: AITHINK_Fn086_Hydra (Council Member 의 히드라) — 만료 프레임이 지나면 죽음 모드, 대상이 25 안이면 60% 로 HydraMissile. 대상 방식 2 */
const hydra: AiFn = (w, m, dist) => {
  if ((m.expires ?? Infinity) < w.frame) {
    w.dieQuietly(m);
    return;
  }
  if (!w.noTarget && dist < 25 && rollPct(m) < 60) {
    w.useSkill(m, 0, tgt(w));
    return;
  }
  idle(w, m, 10);
};

export const ACT3_AI: Record<string, AiFn> = {
  Mosquito: mosquito,
  WillOWisp: willowisp,
  ThornHulk: thornHulk,
  FetishShaman: fetishShaman,
  FetishBlowgun: fetishBlowgun,
  FrogDemon: frogDemon,
  ZakarumZealot: zealot,
  ZakarumPriest: zakarumPriest,
  HighPriest: highPriest,
  Tentacle: tentacle,
  TentacleHead: tentacleHead,
  MosquitoNest: mosquitoNest,
  Mephisto: mephisto,
  Spirit: spirit,
  Hydra: hydra,
};

/** 원작 AI 표 대상 방식 (act2.ts ACT2_TARGET_MODE 설명 참고) */
export const ACT3_TARGET_MODE: Record<string, 0 | 1 | 2 | 4 | 5> = {
  FrogDemon: 5,
  Tentacle: 2,
  TentacleHead: 2,
  MosquitoNest: 0,
  Hydra: 2,
};

