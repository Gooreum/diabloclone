// 퀘스트 기록 (플레이어별 퀘스트 플래그 비트 배열).
// 출처: D2MOO D2Common/src/D2QuestRecord.cpp — 퀘스트마다 16비트 워드 하나 (비트 = QFLAG_*), NUM_QUEST_WORDS = 48,
//       QUESTRECORD_ResetIntermediateStateFlags (STARTED ~ CUSTOM7 지우기), QUESTRECORD_CopyBufferToRecord (bResetStates: 게임 입장 때
//       PRIMARYGOALDONE·COMPLETEDNOW 지우고 REWARDPENDING 이면 COMPLETEDBEFORE)
// 출처: D2MOO D2CommonDefinitions/include/D2Constants.h — D2QuestFlags 순서, D2Game/include/QUESTS/Quests.h — D2Quests / D2QuestStateFlagIds
// (https://github.com/ThePhrozenKeep/D2MOO)

/** 출처: D2Constants.h D2QuestFlags (비트 번호) */
export const QFLAG = {
  REWARDGRANTED: 0, REWARDPENDING: 1, STARTED: 2, LEAVETOWN: 3, ENTERAREA: 4,
  CUSTOM1: 5, CUSTOM2: 6, CUSTOM3: 7, CUSTOM4: 8, CUSTOM5: 9, CUSTOM6: 10, CUSTOM7: 11,
  UPDATEQUESTLOG: 12, PRIMARYGOALDONE: 13, COMPLETEDNOW: 14, COMPLETEDBEFORE: 15,
} as const;

/** 출처: Quests.h D2Quests / D2QuestStateFlagIds (Act 1 은 두 번호가 같다) */
export const QUEST = { A1Q0: 0, DEN: 1, BLOODRAVEN: 2, MALUS: 3, CAIN: 4, COUNTESS: 5, ANDARIEL: 6, A1COMPLETED: 7 } as const;

/** 원작 NUM_QUEST_WORDS (워드 48개 = 96바이트, 실제 퀘스트 상태는 41개) */
export const QUEST_WORDS = 48;
/** 출처: Quests.h MAX_QUEST_STATUS */
export const MAX_QUEST_STATUS = 41;

export class QuestRecord {
  readonly words: number[];

  constructor(words?: readonly number[]) {
    this.words = Array.from({ length: QUEST_WORDS }, (_, i) => (Number(words?.[i]) & 0xffff) >>> 0);
  }

  /** 출처: QUESTRECORD_GetQuestState */
  get(quest: number, flag: number): boolean {
    return ((this.words[quest] ?? 0) & (1 << flag)) !== 0;
  }

  /** 출처: QUESTRECORD_SetQuestState */
  set(quest: number, flag: number): void {
    this.words[quest] = ((this.words[quest] ?? 0) | (1 << flag)) & 0xffff;
  }

  /** 출처: QUESTRECORD_ClearQuestState */
  clear(quest: number, flag: number): void {
    this.words[quest] = (this.words[quest] ?? 0) & ~(1 << flag) & 0xffff;
  }

  /** 출처: QUESTRECORD_ResetIntermediateStateFlags — QFLAG_STARTED ~ QFLAG_CUSTOM7 */
  resetIntermediate(quest: number): void {
    for (let f = QFLAG.STARTED; f <= QFLAG.CUSTOM7; f++) this.clear(quest, f);
  }

  /** 저장용 워드 배열 */
  toJSON(): number[] {
    return [...this.words];
  }

  /**
   * 저장된 워드 → 기록. 출처: QUESTRECORD_CopyBufferToRecord(bResetStates = 게임 입장) —
   *   41 개 퀘스트마다 PRIMARYGOALDONE·COMPLETEDNOW 를 지우고, REWARDPENDING 이면 COMPLETEDBEFORE 를 켠다
   */
  static load(words: readonly number[] | undefined, resetStates = true): QuestRecord {
    const r = new QuestRecord(words);
    if (resetStates) {
      for (let q = 0; q < MAX_QUEST_STATUS; q++) {
        r.clear(q, QFLAG.PRIMARYGOALDONE);
        r.clear(q, QFLAG.COMPLETEDNOW);
        if (r.get(q, QFLAG.REWARDPENDING)) r.set(q, QFLAG.COMPLETEDBEFORE);
      }
    }
    return r;
  }
}
