// 몬스터 AI 진입점: 대상 거리·근접 판정 → AI 함수 (monstats AI 컬럼) 호출.
// 출처: D2MOO — D2Game/src/AI/AiTactics.cpp sub_6FCCF9D0 (대상 없음 시 거리별 대기 10~25 프레임),
//       AiUtil.cpp sub_6FCF2110 (aidist 기본 35, 마을 플레이어 제외) (https://github.com/ThePhrozenKeep/D2MOO)
// 근사(원작 미확인): 이동 완료/공격 종료 후 다음 판단까지 monstats aidel 프레임 대기, 경로는 엔진 A* 사용.
import { aiDistance, isInMeleeRange } from '../monster';
import { ACT1_AI, type AiFn } from './act1';
import { ACT2_AI, ACT2_TARGET_MODE } from './act2';
import { ACT3_AI, ACT3_TARGET_MODE } from './act3';
import { ACT4_AI } from './act4';
import { idle, wait, walkCloseToUnit } from './tactics';
import type { AiWorld, MonsterUnit } from './types';

export type { AiTarget, AiWorld, MonCast, MonMode, MonsterUnit, PetInfo, SkillTarget } from './types';
export { MONMODE_INDEX } from './types';
export { thinkNpc, type NpcPathNode, type NpcState } from './npc';
export { aiParam, circle, escape, idle, moveToTarget, recentlyHit, rollChance, rollPct, setVelocity, wait, waitAtMost, walkCloseToUnit, walkInRadius, walkToTarget } from './tactics';
export { diabloChances, randomArrayIndex } from './act4';

const PLAYER_SIZE = 2;

/**
 * 막별 AI 표를 합친 것 (monstats AI 이름 → 함수). 원작 AI 표(gpMonsterAiTable)도 막 구분 없이 하나다.
 * 이름이 겹치면 앞 막 것이 이긴다 (같은 AI 는 한 번만 정의)
 */
export const AI_TABLE: Readonly<Record<string, AiFn>> = { ...ACT4_AI, ...ACT3_AI, ...ACT2_AI, ...ACT1_AI };

/**
 * 원작 AI 표 대상 방식 (AiThink.cpp gpAiTable_6FD3F990 첫 칸, D2GAME_MONSTERS_AiFunction03_6FCF0A70 의 switch):
 * 0 대상을 찾지 않음, 1 대상 필요 (없으면 sub_6FCCF9D0 거리별 대기), 2·5 대상 없어도 AI 함수 호출, 4 대상 필요 (없으면 20 프레임).
 * 표에 없는 AI 는 1
 */
export const AI_TARGET_MODE: Readonly<Record<string, 0 | 1 | 2 | 4 | 5>> = { ...ACT3_TARGET_MODE, ...ACT2_TARGET_MODE };

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
  const name = aiName(m);
  const mode = AI_TARGET_MODE[name] ?? 1;
  const none = t.dead || t.inTown || dist >= maxDist;
  if (mode === 0 || (none && (mode === 2 || mode === 5))) {
    // 출처: D2GAME_MONSTERS_AiFunction03 — 대상 방식 0 은 대상을 찾지 않고, 2·5 는 대상이 없어도 AI 함수를 부른다 (pTarget = nullptr)
    // 근사(원작 미확인): 방식 0 에도 거리는 넘긴다 (원작은 0 — 대신 플레이어 주변 활성 방에서만 AI 가 돈다)
    const fn = AI_TABLE[name];
    const combat = !none && isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, t.x, t.y, t.size || PLAYER_SIZE);
    w.noTarget = none;
    try {
      if (fn) fn(w, m, none && mode !== 0 ? Infinity : dist, combat);
      else idle(w, m, 25);
    } finally {
      w.noTarget = false;
    }
    return;
  }
  if (none && mode === 4) {
    // 출처: sub_6FCCFC00 — 대상이 없으면 20 프레임 뒤 다시 (모드는 그대로)
    wait(w, m, 20);
    return;
  }
  if (none) {
    // 출처: sub_6FCCF9D0 — 방금 맞았고 걸을 수 있으면 거리 5 배회
    if ((m.aiState === 3 || m.aiState === 19) && m.type.modes.has('WL') && !t.dead && !t.inTown) {
      walkCloseToUnit(w, m, 5);
      return;
    }
    idle(w, m, dist >= 35 ? 25 : dist >= 25 ? dist - 10 : 10);
    return;
  }
  const combat = isInMeleeRange(m.x, m.y, m.type.sizeX, m.type.meleeRange, t.x, t.y, t.size || PLAYER_SIZE);
  const fn = AI_TABLE[name];
  if (fn) fn(w, m, dist, combat);
  else idle(w, m, 25);
}
