// 몬스터 AI 진입점: 대상 거리·근접 판정 → AI 함수 (monstats AI 컬럼) 호출.
// 출처: D2MOO — D2Game/src/AI/AiTactics.cpp sub_6FCCF9D0 (대상 없음 시 거리별 대기 10~25 프레임),
//       AiUtil.cpp sub_6FCF2110 (aidist 기본 35, 마을 플레이어 제외) (https://github.com/ThePhrozenKeep/D2MOO)
// 근사(원작 미확인): 이동 완료/공격 종료 후 다음 판단까지 monstats aidel 프레임 대기, 경로는 엔진 A* 사용.
import { aiDistance, isInMeleeRange } from '../monster';
import { ACT1_AI, type AiFn } from './act1';
import { idle, walkCloseToUnit } from './tactics';
import type { AiWorld, MonsterUnit } from './types';

export type { AiTarget, AiWorld, MonCast, MonMode, MonsterUnit, PetInfo, SkillTarget } from './types';
export { MONMODE_INDEX } from './types';
export { thinkNpc, type NpcPathNode, type NpcState } from './npc';
export { aiParam, circle, escape, idle, moveToTarget, recentlyHit, rollChance, rollPct, setVelocity, wait, walkCloseToUnit, walkInRadius, walkToTarget } from './tactics';

const PLAYER_SIZE = 2;

/**
 * 막별 AI 표를 합친 것 (monstats AI 이름 → 함수). 원작 AI 표(gpMonsterAiTable)도 막 구분 없이 하나다.
 * Phase 5: ACT2_AI·ACT3_AI·ACT4_AI 를 여기에 더한다 (이름이 겹치면 앞 막 것이 이긴다 — 같은 AI 는 한 번만 정의)
 */
export const AI_TABLE: Readonly<Record<string, AiFn>> = { ...ACT1_AI };

export function aiName(m: MonsterUnit): string {
  return m.aiOverride ?? m.type.ai;
}

export function hasAi(ai: string): boolean {
  return ai in AI_TABLE;
}

/** 한 번의 AI 판단. 대상이 없거나 멀면 거리별 대기 (출처: sub_6FCCF9D0) */
export function think(w: AiWorld, m: MonsterUnit): void {
  const t = w.target;
  const maxDist = m.type.aiDist || 35;
  const dist = aiDistance(m.x, m.y, t.x, t.y);
  if (t.dead || t.inTown || dist >= maxDist) {
    // 출처: sub_6FCCF9D0 — 방금 맞았고 걸을 수 있으면 거리 5 배회
    if ((m.aiState === 3 || m.aiState === 19) && m.type.modes.has('WL') && !t.dead && !t.inTown) {
      walkCloseToUnit(w, m, 5);
      return;
    }
    idle(w, m, dist >= 35 ? 25 : dist >= 25 ? dist - 10 : 10);
    return;
  }
  const combat = isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, t.x, t.y, t.size || PLAYER_SIZE);
  const fn = AI_TABLE[aiName(m)];
  if (fn) fn(w, m, dist, combat);
  else idle(w, m, 25);
}
