// 확장팩 Act 5 몬스터 AI (monstats AI 컬럼 이름 → AI 함수). aip1~8 은 aiParam(m, 0~7).
// 출처: D2MOO D2Game/src/AI/AiThink.cpp (https://github.com/ThePhrozenKeep/D2MOO)
//   AITHINK_Fn113_SiegeTower, Fn114_ReanimatedHorde, Fn115_SiegeBeast (+ TargetCallback_SiegeBeast), Fn116_Minion, Fn117_SuicideMinion,
//   Fn118_Succubus, Fn119_SuccubusWitch, Fn120_Overseer (+ TargetCallback_Overseer_Nihlathak), Fn121_MinionSpawner (+ TargetCallback_MinionSpawner),
//   Fn122_Imp (+ D2GAME_AI_Unk122 초기화, SpecialState16 탑승), Fn123_Catapult, Fn124_FrozenHorror, Fn125_BloodLord, Fn126_CatapultSpotter,
//   Fn127_NpcBarb, Fn129_GenericSpawner, Fn130_DeathMauler, Fn136_BaalTaunt, Fn137_PutridDefiler (+ TargetCallback_PutridDefiler),
//   Fn142_ClawViperEx, Fn076_EvilHole — 분기·파라미터·난수 호출 순서 그대로
// 근사(원작 미확인): 원작 "주변 방 유닛" 검색(sub_6FCF1E80 콜백 1)은 act2.ts neighbours (거리 40) 로 대신한다.
//   sub_6FCF14D0 (대상까지 직선이 벽에 막히지 않음) 은 AiWorld.missileBlocked 의 반대로 본다.
import { aiDistance } from '../monster';
import { MONFLAG } from '../uniques';
import type { AiFn } from './act1';
import { alive, evil, hasSkill, modeOnly, moveToPoint, neighbours, sqDist, tgt } from './act2';
import { aiParam, circle, escape, idle, moveToTarget, rollChance, rollPct, setVelocity, wait, walkCloseToUnit, walkInRadius } from './tactics';
import type { AiWorld, MonsterUnit } from './types';

/** 원작 nBaseId 비교 (monstats BaseId) */
const base = (o: MonsterUnit) => o.type.baseId || o.type.id;
/** 원작 sub_6FCF14D0 — 대상까지 직선이 트였다 */
const lineClear = (w: AiWorld, m: MonsterUnit) => !w.missileBlocked?.(m);
/** 대상으로 걷기 (AITACTICS_WalkToTargetUnitWithFlags(…, 0)) */
const walkTo = (w: AiWorld, m: MonsterUnit) => moveToTarget(w, m, false, 1, 0);

// =====================================================================================================
// 공성 (Siege Beast · 탑 · 임프 · 투석기)
// =====================================================================================================

/** 원작 AITHINK_TargetCallback_SiegeBeast: 같은 편, 주인 없는 임프 (탈 것을 기다리는 — dwAiParam[0] == -1), 거리² ≤ 최대 */
function freeImp(w: AiWorld, m: MonsterUnit, maxSq: number): MonsterUnit | undefined {
  return neighbours(w, m).find((o) => base(o) === 'imp1' && alive(o) && evil(o) && o.ai[0] === -1 && !o.states.has('attached') && sqDist(m.x, m.y, o.x, o.y) <= maxSq);
}

/** 임프에게 탈 것을 알린다 (임프 dwAiParam[0] = 가장 가까운 탈 것) */
function callImp(w: AiWorld, m: MonsterUnit, imp: MonsterUnit): void {
  const cur = w.unit?.(imp.ai[0]);
  if (!cur || sqDist(imp.x, imp.y, m.x, m.y) <= sqDist(imp.x, imp.y, cur.x, cur.y)) imp.ai[0] = m.id;
}

/** 출처: AITHINK_Fn113_SiegeTower — 탄 임프가 없으면 거리² 400 안의 임프를 부른다. 탑은 움직이지 않는다 (aip1 대기) */
const siegeTower: AiFn = (w, m) => {
  const rider = w.monsters.find((o) => o.leaderId === m.id && o.states.has('attached') && alive(o));
  if (!rider && !w.noTarget) {
    const imp = freeImp(w, m, 400);
    if (imp) callImp(w, m, imp);
  }
  idle(w, m, aiParam(m, 0));
};

/**
 * 출처: AITHINK_Fn115_SiegeBeast — 탄 임프가 없으면 거리² aip1² 안의 임프를 부르고,
 *   근접: aip3% Stomp (Skill1) / aip2% A1 / 아니면 aip4 대기. 멀면: Stomp 범위(skills.txt Param5) 안 aip5% Stomp, 직선이 트였으면 aip6% 돌진 속도 aip7, 대상 쪽 12 걷기
 */
const siegeBeast: AiFn = (w, m, dist, combat) => {
  if (!alive(m)) return;
  const rider = w.monsters.find((o) => o.leaderId === m.id && o.states.has('attached') && alive(o));
  if (!rider && evil(m)) {
    const r = aiParam(m, 0);
    const imp = freeImp(w, m, r * r);
    if (imp) callImp(w, m, imp);
  }
  if (combat) {
    if (!hasSkill(m, 0) || !rollChance(m, 2)) {
      if (!rollChance(m, 1)) idle(w, m, aiParam(m, 3));
      else w.startMode(m, 'A1');
    } else w.useSkill(m, 0, null);
    return;
  }
  if (hasSkill(m, 0)) {
    const stompRange = w.skillParam?.(m.type.skills[0]?.name ?? '', 4) ?? 0;
    if (dist < stompRange && rollChance(m, 4)) {
      w.useSkill(m, 0, null);
      return;
    }
  }
  if (lineClear(w, m) && rollChance(m, 5)) setVelocity(m, Math.max(0, Math.min(127, aiParam(m, 6))));
  walkInRadius(w, m, 12, 0);
};

/** 출처: D2GAME_AI_Unk122 — 임프는 탈 것 없음 (dwAiParam[0] = -1) 으로 시작. 근사(원작 미확인): 원작은 AI 초기화, 여기서는 첫 판단 */
const impInit = (m: MonsterUnit) => {
  if (!m.ai[2]) {
    m.ai[0] = -1;
    m.ai[2] = 1;
  }
};

/** 임프 1~4 행 aip (원작은 imp1~imp4 monstats 행의 값을 쓴다) */
const impParam = (w: AiWorld, m: MonsterUnit, row: number, i: number) => w.monsterParam?.(`imp${row}`, i) ?? aiParam(m, i);

/**
 * 출처: D2GAME_AI_SpecialState16_6FCE1DC0 — 탑승한 임프: 탈 것이 죽거나 대상이 24 넘게 멀면 내린다 (Imp Teleport, imp1 aip2 범위).
 *   가까우면 imp2 aip3% (거리 < imp2 aip2) 로 고른 스킬 칸(2 또는 4 — SpecialState16_6FCE1D30) 을 쓰고, 아니면 50% S1
 */
function impMounted(w: AiWorld, m: MonsterUnit, dist: number): void {
  const owner = w.unit?.(m.leaderId);
  if (!m.ai[1]) {
    // 출처: SpecialState16_6FCE1D30 — 스킬 칸 2·4 중 가진 것 (무작위 순서)
    let idx = m.rng.roll() & 1;
    m.ai[1] = 0;
    for (let i = 0; i < 2; i++) {
      idx = (idx + 1) % 2;
      const slot = [2, 4][idx] as number;
      if (hasSkill(m, slot)) {
        m.ai[1] = slot;
        break;
      }
    }
  }
  if (dist > 24 || !owner || !alive(owner) || !evil(owner) || !m.ai[1]) {
    // AITACTICS_UseSkillInRange(imp1 aip2, Skill1 = Imp Teleport) — 탈 것에서 내려 주변으로
    w.useSkill(m, 0, null);
    m.ai[0] = -1;
    return;
  }
  if (dist >= impParam(w, m, 2, 1) || rollPct(m) >= impParam(w, m, 2, 2)) {
    if (rollPct(m) < 50) {
      modeOnly(w, m, 'S1');
      return;
    }
  } else if (hasSkill(m, m.ai[1])) {
    w.useSkill(m, m.ai[1], tgt(w));
    return;
  }
  idle(w, m, 20);
}

/**
 * 출처: AITHINK_Fn122_Imp — 부른 탈 것이 있으면 다가가서 (imp2 aip1 거리) Imp Teleport 로 올라탄다. 근접이면 생명 < imp1 aip1% 일 때 순간이동,
 *   imp3 aip2% 도망. imp1 aip3% 순간이동, imp3 aip1 거리 안이면 도망, 미사일 칸(4)을 거리별 확률 (imp3·imp4 aip3/aip4) 로, 33% 4 걸음 다가감, 20% 주변 8, 대기 10
 */
const imp: AiFn = (w, m, dist, combat) => {
  impInit(m);
  if (m.states.has('attached')) return impMounted(w, m, dist);
  if (m.ai[0] !== -1 && evil(m)) {
    const t = w.unit?.(m.ai[0]);
    if (!t || !alive(t) || !evil(t) || w.monsters.some((o) => o !== m && o.leaderId === t.id && o.states.has('attached'))) m.ai[0] = -1;
    else {
      const r = impParam(w, m, 2, 0);
      if (sqDist(m.x, m.y, t.x, t.y) > r * r) {
        moveToPoint(w, m, t.x, t.y, 0);
        return;
      }
      if (hasSkill(m, 0)) {
        w.useSkill(m, 0, { unitId: t.id, x: t.x, y: t.y });
        return;
      }
    }
  }
  if (combat) {
    if (hasSkill(m, 0) && w.lifePct(m) < impParam(w, m, 1, 0)) {
      w.useSkill(m, 0, null);
      return;
    }
    if (rollPct(m) < impParam(w, m, 3, 1) && escape(w, m, 5, false)) return;
  }
  if (hasSkill(m, 0) && rollPct(m) < impParam(w, m, 1, 2)) {
    w.useSkill(m, 0, null);
    return;
  }
  if (dist < impParam(w, m, 3, 0) && rollPct(m) < impParam(w, m, 3, 1)) {
    escape(w, m, 5, false);
    return;
  }
  if (hasSkill(m, 3)) {
    const t = w.missileTarget(m);
    if (t) {
      if (t.dist < impParam(w, m, 3, 2)) {
        if (rollPct(m) < impParam(w, m, 3, 3)) {
          w.useSkill(m, 3, { unitId: t.unitId, x: t.x, y: t.y });
          return;
        }
      } else if (t.dist < impParam(w, m, 4, 2) && rollPct(m) < impParam(w, m, 4, 3)) {
        w.useSkill(m, 3, { unitId: t.unitId, x: t.x, y: t.y });
        return;
      }
    }
  }
  if (rollPct(m) < 33) {
    w.moveTo(m, w.target.x, w.target.y, false, 4);
    return;
  }
  if (rollPct(m) < 20) {
    walkCloseToUnit(w, m, 8);
    return;
  }
  idle(w, m, 10);
};

/** 출처: AITHINK_Fn123_Catapult — aip1% A1 (대상 없이), 아니면 15 대기. 돌을 날리는 것은 짝 Spotter 의 스킬 */
const catapult: AiFn = (w, m) => {
  if (rollChance(m, 0)) {
    modeOnly(w, m, 'A1');
    return;
  }
  idle(w, m, 15);
};

/** 출처: nCatapultSkillIds — Spotter 가 고르는 다섯 스킬 */
export const CATAPULT_SKILLS = ['Catapult Charged Ball', 'Catapult Spike Ball', 'CatapultBlizzard', 'CatapultPlague', 'CatapultMeteor'] as const;

/**
 * 출처: AITHINK_Fn126_CatapultSpotter — 처음 판단 때 3% 로 짝 투석기(같은 계열 순번)가 근처에 없으면 죽는다. aip2 간격, aip1% 로
 *   대상 주변 ±aip4 칸에 스킬 (aip5 발마다 다섯 스킬 중 다시 고름). 근사(원작 미확인): 짝 투석기 확인은 방 대신 거리 60
 */
const catapultSpotter: AiFn = (w, m) => {
  if (!m.ai[2] && rollPct(m) < 3) {
    const pair = `catapult${String(m.type.id).replace(/\D+/g, '') || '1'}`;
    if (!w.monsters.some((o) => o.type.id === pair && alive(o) && aiDistance(o.x, o.y, m.x, m.y) <= 60)) {
      modeOnly(w, m, 'DT');
      return;
    }
  }
  if (!m.ai[2]) m.ai[2] = 1;
  const delay = aiParam(m, 1);
  if (m.ai[2] + delay <= w.frame && !w.noTarget && rollChance(m, 0)) {
    if (m.ai[1] > 0) --m.ai[1];
    else {
      m.ai[0] = (m.rng.roll() >>> 0) % 5;
      m.ai[1] = aiParam(m, 4);
    }
    const r = aiParam(m, 3);
    const x = Math.floor(w.target.x) + m.rng.pick(2 * r) - r, y = Math.floor(w.target.y) + m.rng.pick(2 * r) - r;
    if (w.useNamedSkill?.(m, CATAPULT_SKILLS[m.ai[0]] as string, 'A1', { x, y, fixed: true })) {
      m.ai[2] = w.frame;
      return;
    }
    idle(w, m, 15);
    return;
  }
  idle(w, m, delay);
};

// =====================================================================================================
// 하수인 (Minion · Suicide Minion · Overseer · Minion Spawner)
// =====================================================================================================

/**
 * 출처: AITHINK_Fn116_Minion — AI 명령(Cry Help: 대상·만료 프레임)이 있으면 그 대상을 반드시 친다.
 *   근접: aip1% (명령 중이면 항상) → aip2% A2 / A1 (원작 버그: A2 확률에 aip2 = 근접 대기 값을 쓴다), 아니면 aip2 대기. 멀면: aip3% (명령 중 항상) 걷기, 아니면 aip4 대기
 */
const minion: AiFn = (w, m, _dist, combat) => {
  let ordered = false;
  let to = { x: w.target.x, y: w.target.y };
  if (m.cmdTarget !== undefined && (m.cmdUntil ?? 0) > w.frame) {
    const t = w.unit?.(m.cmdTarget);
    if (t && alive(t)) {
      ordered = true;
      to = { x: t.x, y: t.y };
      combat = aiDistance(m.x, m.y, t.x, t.y) <= Math.max(1, m.type.meleeRange) + 1;
    } else m.cmdTarget = undefined;
  } else m.cmdTarget = undefined;
  if (combat) {
    if (ordered || rollChance(m, 0)) {
      w.startMode(m, rollChance(m, 1) ? 'A2' : 'A1');
      return;
    }
    idle(w, m, aiParam(m, 1));
    return;
  }
  if (ordered || rollChance(m, 2)) {
    moveToPoint(w, m, to.x, to.y, 0);
    return;
  }
  idle(w, m, aiParam(m, 3));
};

/** 출처: AITHINK_Fn117_SuicideMinion — 근접하면 aip5 프레임 뒤 터진다 (죽음 모드 → 죽음 미사일), 아니면 aip3% 걷기 */
const suicideMinion: AiFn = (w, m, _dist, combat) => {
  if (m.ai[0]) {
    if (w.frame > m.ai[0]) {
      modeOnly(w, m, 'DT');
      return;
    }
    idle(w, m, aiParam(m, 1));
    return;
  }
  if (combat) {
    m.ai[0] = w.frame + aiParam(m, 4);
    idle(w, m, aiParam(m, 1));
    return;
  }
  if (!rollChance(m, 2)) {
    idle(w, m, aiParam(m, 1));
    return;
  }
  walkTo(w, m);
};

/** 출처: AITHINK_TargetCallback_Overseer_Nihlathak — 살아 있는 minion 계열 (Bloodlust 아님): 수, 거리² ≤ 576 이고 생명 < 50% 인 첫 하수인, 거리² ≤ 400 인 유니크 아닌 첫 하수인 */
export function overseerScan(w: AiWorld, m: MonsterUnit): { count: number; hurt?: MonsterUnit; whip?: MonsterUnit } {
  const out: { count: number; hurt?: MonsterUnit; whip?: MonsterUnit } = { count: 0 };
  for (const o of neighbours(w, m)) {
    if (base(o) !== 'minion1' || !alive(o) || o.states.has('bloodlust')) continue;
    out.count++;
    const d = sqDist(m.x, m.y, o.x, o.y);
    if (!out.hurt && d <= 576 && w.lifePct(o) < 50) out.hurt = o;
    if (!out.whip && d <= 400 && !(o.flags & MONFLAG.UNIQUE)) out.whip = o;
  }
  return out;
}

/**
 * 출처: AITHINK_Fn120_Overseer — (ACT5Q1_OnSiegeBossActivated) 방금 맞았고 aip1 간격이 지났으면 하수인에게 Cry Help (Skill1),
 *   근접 aip6% → aip7% A2 / A1. 아니면 다친 하수인에게 aip2% Healing Vortex (Skill2), 하수인에게 aip3% Overseer Whip (Skill3),
 *   하수인이 있으면 대상과 aip4 ± aip5 거리 유지·50% 선회, 없으면 60% 다가감, 대기 10
 */
const overseer: AiFn = (w, m, dist, combat) => {
  if (m.superUnique !== undefined) w.event?.({ type: 'bossActivated', typeId: m.type.id, superUnique: m.superUnique });
  const minionTarget = neighbours(w, m).find((o) => base(o) === 'minion1' && alive(o) && evil(o));
  if (hasSkill(m, 0) && (m.aiState === 3 || m.aiState === 19) && w.frame > m.ai[0] && minionTarget) {
    w.useSkill(m, 0, tgt(w));
    m.ai[0] = w.frame + aiParam(m, 0);
    return;
  }
  if (combat && rollChance(m, 5)) {
    w.startMode(m, rollChance(m, 6) ? 'A2' : 'A1');
    return;
  }
  const s = overseerScan(w, m);
  if (hasSkill(m, 1) && s.hurt && rollChance(m, 1)) {
    w.useSkill(m, 1, { unitId: s.hurt.id, x: s.hurt.x, y: s.hurt.y });
    return;
  }
  if (hasSkill(m, 2) && s.whip && rollChance(m, 2) && evil(m)) {
    w.useSkill(m, 2, { unitId: s.whip.id, x: s.whip.x, y: s.whip.y });
    return;
  }
  if (s.count) {
    const comfort = aiParam(m, 3), zone = aiParam(m, 4);
    if (dist < comfort - zone) {
      escape(w, m, Math.max(1, comfort - dist), false);
      return;
    }
    if (dist > zone + comfort) {
      walkTo(w, m);
      return;
    }
    if (rollPct(m) < 50) {
      circle(w, m, 5);
      return;
    }
  } else if (rollPct(m) < 60) {
    walkTo(w, m);
    return;
  }
  idle(w, m, 10);
};

/**
 * 출처: AITHINK_Fn121_MinionSpawner — aip1 마리까지, 대상이 aip4 안이고 aip3 간격이 지났으면 근처 하수인(minion1·suicideminion1) 이 aip2 보다 적을 때 스킬 (하수인 생성).
 *   (원작은 Unk043_045_121 초기화로 dwAiParam[0] = 현재 프레임 — 첫 판단 때)
 */
const minionSpawner: AiFn = (w, m, dist) => {
  if (!m.ai[2]) {
    m.ai[0] = w.frame;
    m.ai[2] = 1;
  }
  if (m.ai[1] >= aiParam(m, 0)) return;
  if (dist <= aiParam(m, 3) && w.frame >= m.ai[0]) {
    let n = 0;
    for (const o of neighbours(w, m)) if ((base(o) === 'minion1' || base(o) === 'suicideminion1') && alive(o) && evil(o)) n++;
    if (hasSkill(m, 0) && n < aiParam(m, 1)) {
      m.ai[0] = w.frame + aiParam(m, 2);
      ++m.ai[1];
      w.useSkill(m, 0, tgt(w));
      return;
    }
  }
  idle(w, m, aiParam(m, 1));
};

// =====================================================================================================
// 아군 (Harrogath 의 바바리안)
// =====================================================================================================

/**
 * 출처: AITHINK_Fn127_NpcBarb — 대상이 있으면 근접 A1 (aip1 쉼), aip3 안이면 aip2% 달려감 (속도 100).
 *   없으면 서쪽 40 부근 → 위/아래 30 부근 순서로 걷기, 다 실패하면 15 대기
 */
const npcBarb: AiFn = (w, m, dist, combat) => {
  if (!w.noTarget) {
    if (combat) {
      w.startMode(m, 'A1');
      wait(w, m, aiParam(m, 0));
      return;
    }
    if (dist < aiParam(m, 2) && rollChance(m, 1)) {
      setVelocity(m, 100);
      w.moveTo(m, w.target.x, w.target.y, true, 1);
      return;
    }
  }
  const x = Math.floor(m.x), y = Math.floor(m.y);
  const r = () => (m.rng.roll() >>> 0) % 20;
  if (w.moveTo(m, r() + x - 40, r() + y - 10, false, 1)) return;
  const flip = (m.rng.roll() & 1) !== 0;
  if (w.moveTo(m, r() + x - 10, r() - 30 * (flip ? 1 : -1) + y - 10, false, 1)) return;
  if (w.moveTo(m, r() + x - 10, r() - 30 * (flip ? -1 : 1) + y - 10, false, 1)) return;
  idle(w, m, 15);
};

// =====================================================================================================
// 나머지 Act 5 몬스터
// =====================================================================================================

/** 대상 정보 (원작 STATLIST_GetStatListFromUnitAndFlag(대상, 0x20) — 저주가 걸려 있음, 대상 종류, 최대 생명·마나) */
const targetUnit = (w: AiWorld) => w.targetUnit?.() ?? { cursed: false, player: true, lifeOverMana: true, neutral: false };

/**
 * 출처: AITHINK_Fn114_ReanimatedHorde — 근접 aip1% A1 / aip2 대기. 멀면 Skill2 (Charge) 를 직선이 트였고 5 < 거리 < aip3 일 때 aip4%,
 *   aip5% 걷기, aip6% 대상 쪽 4 걷기, aip7 대기
 */
const reanimatedHorde: AiFn = (w, m, dist, combat) => {
  if (combat) {
    if (rollChance(m, 0)) w.startMode(m, 'A1');
    else idle(w, m, aiParam(m, 1));
    return;
  }
  if (hasSkill(m, 1) && lineClear(w, m) && dist < aiParam(m, 2) && dist > 5 && rollChance(m, 3)) {
    w.useSkill(m, 1, tgt(w));
    return;
  }
  if (rollChance(m, 4)) {
    walkTo(w, m);
    return;
  }
  if (rollChance(m, 5)) {
    walkInRadius(w, m, 4, 0);
    return;
  }
  idle(w, m, aiParam(m, 6));
};

/** 서큐버스 저주 고르기 (Fn118/119 공통): 대상 생명 ≥ aip7% 이면 Skill1, 자기 생명 ≤ aip8% 이면 Skill2, 대상 생명 > 마나면 Skill3, 플레이어면 Skill4 */
function succubusCurse(w: AiWorld, m: MonsterUnit, hpParam: number, selfParam: number): boolean {
  const t = targetUnit(w);
  if (hasSkill(m, 0) && w.targetLifePct() >= aiParam(m, hpParam)) return w.useSkill(m, 0, tgt(w)), true;
  if (hasSkill(m, 1) && w.lifePct(m) <= aiParam(m, selfParam)) return w.useSkill(m, 1, tgt(w)), true;
  if (hasSkill(m, 2) && (t.lifeOverMana || !t.player)) return w.useSkill(m, 2, tgt(w)), true;
  if (hasSkill(m, 3) && t.player) return w.useSkill(m, 3, tgt(w)), true;
  return false;
}

/**
 * 출처: AITHINK_Fn118_Succubus — 대상이 저주가 없고 aip4 안이면 aip3% 저주. 근접 aip1% A1 / aip5 대기,
 *   멀면 SuccubusBolt (Skill5) 를 aip8% (aip8 > 0), aip2% 걷기, aip6 대기
 */
const succubus: AiFn = (w, m, dist, combat) => {
  if (!targetUnit(w).cursed && dist < aiParam(m, 3) && rollChance(m, 2) && succubusCurse(w, m, 6, 7)) return;
  if (combat) {
    if (rollChance(m, 0)) w.startMode(m, 'A1');
    else idle(w, m, aiParam(m, 4));
    return;
  }
  if (hasSkill(m, 4) && aiParam(m, 7) > 0) {
    const t = w.missileTarget(m);
    if (t && rollChance(m, 7)) {
      w.useSkill(m, 4, { unitId: t.unitId, x: t.x, y: t.y });
      return;
    }
  }
  if (rollChance(m, 1)) {
    walkTo(w, m);
    return;
  }
  idle(w, m, aiParam(m, 5));
};

/**
 * 출처: AITHINK_Fn119_SuccubusWitch — 대상이 저주가 없고 aip4 (편안 거리) 안이면 aip3% 저주. 근접: aip3% aip4 만큼 도망, 아니면 aip1% A1 / aip6 대기.
 *   멀면 aip5% → aip8% SuccubusBolt, 편안 거리 안이면 aip3% 도망, (볼트 칸이 없으면 aip5% S2), aip2% 걷기, 50% 선회, aip6 대기
 */
const succubusWitch: AiFn = (w, m, dist, combat) => {
  const comfort = aiParam(m, 3);
  if (!w.noTarget && !targetUnit(w).cursed && dist < comfort && rollChance(m, 2) && succubusCurse(w, m, 6, 7)) return;
  if (combat) {
    if (!rollChance(m, 2) || !escape(w, m, comfort, true)) {
      if (rollChance(m, 0)) w.startMode(m, 'A1');
      else idle(w, m, aiParam(m, 5));
    }
    return;
  }
  if (hasSkill(m, 4) && aiParam(m, 7) > 0 && rollChance(m, 4)) {
    const t = w.missileTarget(m);
    if (t && rollChance(m, 7)) {
      w.useSkill(m, 4, { unitId: t.unitId, x: t.x, y: t.y });
      return;
    }
  }
  if (dist >= comfort || !rollChance(m, 2) || !escape(w, m, comfort, true)) {
    if (!hasSkill(m, 4)) {
      const t = w.missileTarget(m);
      if (t && rollChance(m, 4)) {
        modeOnly(w, m, 'S2');
        return;
      }
    }
    if (rollChance(m, 1)) walkTo(w, m);
    else if (rollPct(m) >= 50 || !circle(w, m, 6)) idle(w, m, aiParam(m, 5));
  }
};

/** 출처: AITHINK_Fn124_FrozenHorror — 거리 < Skill1 레벨 이고 aip3% 면 Arctic Blast (Inferno 상태가 아닐 때), 근접 aip1% A1, 멀면 aip2% 걷기, aip4 대기 */
const frozenHorror: AiFn = (w, m, dist, combat) => {
  const lvl = hasSkill(m, 0) ? Math.max(0, w.skillLevel?.(m, 0) ?? m.type.skills[0]?.lvl ?? 0) : 0;
  if (hasSkill(m, 0) && dist < lvl && rollChance(m, 2) && !m.states.has('inferno')) {
    w.useSkill(m, 0, tgt(w));
    return;
  }
  m.states.remove('inferno');
  if (combat) {
    if (rollChance(m, 0)) {
      w.startMode(m, 'A1');
      return;
    }
  } else if (rollChance(m, 1)) {
    w.moveTo(m, w.target.x, w.target.y, false, 1);
    return;
  }
  idle(w, m, aiParam(m, 3));
};

/** 출처: AITHINK_Fn125_BloodLord — 근접 aip1% → aip3% BloodLordFrenzy (A2) / A1, 멀면 aip2% 걷기, aip4 대기 */
const bloodLord: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollChance(m, 0)) {
      if (rollChance(m, 2) && hasSkill(m, 0)) {
        w.useSkill(m, 0, tgt(w));
        return;
      }
      w.startMode(m, 'A1');
      return;
    }
  } else if (rollChance(m, 1)) {
    w.moveTo(m, w.target.x, w.target.y, false, 1);
    return;
  }
  idle(w, m, aiParam(m, 3));
};

/** 출처: AITHINK_Fn130_DeathMauler — 근접 aip1% A1. 멀면 aip3 안에서 aip4% DeathMaul, aip2% 걷기, 15 대기 */
const deathMauler: AiFn = (w, m, dist, combat) => {
  if (combat) {
    if (rollChance(m, 0)) {
      w.startMode(m, 'A1');
      return;
    }
  } else {
    if (hasSkill(m, 0) && dist < aiParam(m, 2) && rollChance(m, 3)) {
      w.useSkill(m, 0, tgt(w));
      return;
    }
    if (rollChance(m, 1)) {
      walkTo(w, m);
      return;
    }
  }
  idle(w, m, 15);
};

/**
 * 출처: AITHINK_Fn137_PutridDefiler — 근접이면 A1. 거리 25 안의 알 낳을 몬스터 (Putrid Defiler·Pain Worm·임신 상태가 아닌 같은 편) 가 있으면
 *   근접 Impregnate (S1) / 다가감. 대상이 aip1 보다 가까우면 aip2 만큼 도망, 아니면 25 대기
 */
const putridDefiler: AiFn = (w, m, dist, combat) => {
  if (!w.noTarget && combat) {
    w.startMode(m, 'A1');
    return;
  }
  const host = neighbours(w, m).find((o) => alive(o) && evil(o) && !['putriddefiler1', 'painworm1'].includes(base(o)) && !o.states.has('pregnant') && aiDistance(o.x, o.y, m.x, m.y) <= 25);
  if (host) {
    if (aiDistance(host.x, host.y, m.x, m.y) <= Math.max(1, m.type.meleeRange) + 1) w.useNamedSkill?.(m, 'Impregnate', 'S1', { unitId: host.id, x: host.x, y: host.y });
    else moveToPoint(w, m, host.x, host.y, 0);
    return;
  }
  if (dist < aiParam(m, 0)) {
    escape(w, m, aiParam(m, 1), false);
    return;
  }
  idle(w, m, 25);
};

/**
 * 출처: AITHINK_Fn142_ClawViperEx — 돌진 중이었으면 색 상태를 끈다. 근접 aip3% A2 / aip5 대기. aip7 안이면 aip4% 로 aip8 간격마다 A1 (뼈창), 아니면 aip5 대기.
 *   Skill1 (SerpentCharge) 을 aip2 안 aip1% (쓸 수 있으면) — 색 상태를 켜고, 아니면 50% aip5 대기 / 다가감 (flags 7)
 */
const clawViperEx: AiFn = (w, m, dist, combat) => {
  const color = aiParam(m, 5);
  const st = color === 2 ? 'red' : 'blue';
  if (m.ai[0] && color) m.states.remove(st);
  if (combat) {
    if (rollChance(m, 2)) w.startMode(m, 'A2');
    else idle(w, m, aiParam(m, 4));
    return;
  }
  if (dist < aiParam(m, 6) && rollChance(m, 3)) {
    if (m.ai[1] < w.frame) {
      w.startMode(m, 'A1');
      m.ai[1] = w.frame + aiParam(m, 7);
      return;
    }
    idle(w, m, aiParam(m, 4));
    return;
  }
  if (hasSkill(m, 0) && dist < aiParam(m, 1) && rollChance(m, 0) && w.canUseSkill(m, 0, tgt(w))) {
    w.useSkill(m, 0, tgt(w));
    if (color) m.states.set(st, Infinity);
    m.ai[0] = 1;
    return;
  }
  if (rollPct(m) >= 50) idle(w, m, aiParam(m, 4));
  else moveToTarget(w, m, false, 1, 7);
};

/**
 * 출처: AITHINK_Fn129_GenericSpawner (Evil Hut) — 처음에 레벨 몬스터 풀에서 하나 (genericSpawn 이면 그것, 아니면 풀의 첫 genericSpawn, 없으면 imp5).
 *   대상이 20 안이면 aip1 간격으로 aip3 번까지 Nest (스폰 자리가 비었을 때)
 */
const genericSpawner: AiFn = (w, m, dist) => {
  if (w.noTarget) {
    idle(w, m, 20);
    return;
  }
  if (!m.spawnType) {
    const pool = w.levelPool?.() ?? [];
    const pick = pool.length ? (pool[m.rng.pick(pool.length)] as string) : '';
    m.spawnType = pick && w.isGenericSpawn?.(pick) ? pick : pool.find((id) => w.isGenericSpawn?.(id)) ?? 'imp5';
  }
  if (dist > 20) {
    idle(w, m, 20);
    return;
  }
  if (m.ai[1] < aiParam(m, 2) && Math.abs(w.frame - m.ai[0]) >= aiParam(m, 0)) {
    m.ai[0] = w.frame;
    if (hasSkill(m, 0) && (w.canSpawnAt?.(m.spawnType, m.x + 2, m.y + 4) ?? true)) {
      ++m.ai[1];
      w.useSkill(m, 0, tgt(w));
      return;
    }
  }
  idle(w, m, 20);
};

/**
 * 출처: AITHINK_Fn076_EvilHole — NU 이면 대상이 5 안에 오기를 기다렸다 S3 (열림), S3 다음 S4, S4 에서 aip2 간격으로 aip1 마리까지 하수인 (Nest)
 */
const evilHole: AiFn = (w, m, dist) => {
  if (m.ai[0] <= 0) {
    m.ai[0] = w.frame + aiParam(m, 1);
    m.ai[1] = aiParam(m, 0);
  }
  if (m.mode === 'NU') {
    if (dist > 5) {
      idle(w, m, 5);
      return;
    }
    modeOnly(w, m, 'S3');
    wait(w, m, 20);
    return;
  }
  if (m.mode === 'S3') {
    modeOnly(w, m, 'S4');
    wait(w, m, 20);
    return;
  }
  if (m.mode === 'S4' && m.ai[1] > 0) {
    if (w.frame <= m.ai[0]) {
      wait(w, m, aiParam(m, 1));
      return;
    }
    m.ai[0] = w.frame + aiParam(m, 1);
    if (hasSkill(m, 0) && w.useSkill(m, 0, tgt(w))) --m.ai[1];
    wait(w, m, aiParam(m, 1));
    return;
  }
  modeOnly(w, m, 'NU');
};

/** 출처: AITHINK_Fn136_BaalTaunt — 대상이 가만히 (NU) aip2 프레임 넘게 있으면 Baal Taunt, 대상이 aip3 넘게 멀거나 aip1 안이면 25 대기, 아니면 다가감 */
const baalTaunt: AiFn = (w, m, dist) => {
  if (w.noTarget) {
    idle(w, m, 25);
    return;
  }
  if (!targetUnit(w).neutral) m.ai[0] = 0;
  else if (++m.ai[0] > aiParam(m, 1)) {
    m.ai[0] = 0;
    w.useNamedSkill?.(m, 'Baal Taunt', 'A1', tgt(w));
    return;
  }
  if (dist > aiParam(m, 2) || dist <= aiParam(m, 0)) idle(w, m, 25);
  else w.moveTo(m, w.target.x, w.target.y, false, 1);
};

/** 출처: D2GAME_AI_SpecialState14_6FCE1480 — 채찍 맞은 하수인 (Suicide Minion 으로 바뀜): 근접 95% A2, 멀면 89% 다가감, 아니면 10 대기 */
const whipped: AiFn = (w, m, _dist, combat) => {
  if (combat) {
    if (rollPct(m) < 95) {
      w.startMode(m, 'A2');
      return;
    }
  } else if (rollPct(m) < 89) {
    walkTo(w, m);
    return;
  }
  idle(w, m, 10);
};

export const ACT5_AI: Readonly<Record<string, AiFn>> = {
  Whipped: whipped, ReanimatedHorde: reanimatedHorde, Succubus: succubus, SuccubusWitch: succubusWitch, FrozenHorror: frozenHorror, BloodLord: bloodLord,
  DeathMauler: deathMauler, PutridDefiler: putridDefiler, ClawViperEx: clawViperEx, GenericSpawner: genericSpawner, EvilHole: evilHole, BaalTaunt: baalTaunt,
  SiegeTower: siegeTower, SiegeBeast: siegeBeast, Imp: imp, Catapult: catapult, CatapultSpotter: catapultSpotter,
  Minion: minion, SuicideMinion: suicideMinion, Overseer: overseer, MinionSpawner: minionSpawner, NpcBarb: npcBarb,
};

/** 원작 AI 표 대상 방식 (gpAiTable_6FD3F990 첫 칸). 표에 없으면 1 */
export const ACT5_TARGET_MODE: Readonly<Record<string, 0 | 1 | 2 | 4 | 5>> = { NpcBarb: 2 };
