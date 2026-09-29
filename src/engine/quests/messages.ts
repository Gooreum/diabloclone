// Act 1 퀘스트 NPC 대사 표.
// 출처: D2MOO D2Game/src/QUESTS/ACT1/A1Q1.cpp~A1Q6.cpp — gpAct1QnNpcMessages (표 번호 = 상태별 대사 묶음, { NPC, 문자열 번호, 메뉴 })
//       Quests.cpp QUESTS_InitScrollTextChain — nMenu 1 은 0 으로 보낸다 (0 = 말을 걸면 바로 재생, 2 = NPC 메뉴의 퀘스트 항목)
// 근사(원작 미확인): 원작 문자열 번호(64 …) → string.tbl 키 연결은 D2Client 대사 표(미공개)에 있다. 여기서는 표의 NPC·상태와
//   string.tbl 키 이름(A1Q1InitAkara, A1Q1AfterInit<NPC>, A1Q1EarlyReturn<NPC>, A1Q1Successful<NPC> …)을 맞춰 적었다.
//   (번호 순서 = 같은 묶음 안에서 Akara·Kashya·Charsi·Gheed·Warriv 순으로 이어지는 규칙과 일치)

export interface NpcMessage {
  /** monstats Id (akara, kashya, charsi, gheed, warriv1, cain5, cain1) */
  npc: string;
  /** 원작 문자열 번호 (ScrollMessage 콜백이 보는 값) */
  index: number;
  /** string.tbl 키 */
  key: string;
  /** 0 = 바로 재생, 2 = 메뉴 항목 (원작 1 → 0) */
  menu: 0 | 2;
}

const m = (npc: string, index: number, key: string, menu: 0 | 1 | 2 = 2): NpcMessage => ({ npc, index, key, menu: menu === 2 ? 2 : 0 });

/** 퀘스트 번호 → 상태별 대사 묶음 */
export const NPC_MESSAGES: Record<number, NpcMessage[][]> = {
  // 출처: A1Q1.cpp gpAct1Q1NpcMessages
  1: [
    [m('akara', 64, 'A1Q1InitAkara', 0)],
    [m('akara', 65, 'A1Q1AfterInitAkara'), m('warriv1', 70, 'A1Q1AfterInitWarriv'), m('gheed', 69, 'A1Q1AfterInitGheed'), m('kashya', 66, 'A1Q1AfterInitKashya'), m('charsi', 67, 'A1Q1AfterInitCharsiMain')],
    [m('kashya', 72, 'A1Q1EarlyReturnKashya'), m('warriv1', 75, 'A1Q1EarlyReturnWarriv'), m('charsi', 73, 'A1Q1EarlyReturnCharsi'), m('akara', 71, 'A1Q1EarlyReturnAkara'), m('gheed', 74, 'A1Q1EarlyReturnGheed')],
    [m('kashya', 77, 'A1Q1SuccessfulKashya'), m('warriv1', 80, 'A1Q1SuccessfulWarriv'), m('charsi', 78, 'A1Q1SuccessfulCharsi'), m('akara', 76, 'A1Q1SuccessfulAkara', 0), m('gheed', 79, 'A1Q1SuccessfulGheed')],
    [m('warriv1', 80, 'A1Q1SuccessfulWarriv'), m('charsi', 78, 'A1Q1SuccessfulCharsi'), m('gheed', 79, 'A1Q1SuccessfulGheed')],
  ],
  // 출처: A1Q2.cpp gpAct1Q2NpcMessages
  2: [
    [m('kashya', 81, 'A1Q2InitKashya', 1)],
    [m('kashya', 82, 'A1Q2AfterInitKashya'), m('warriv1', 86, 'A1Q2AfterInitWarriv'), m('charsi', 83, 'A1Q2AfterInitCharsi'), m('akara', 85, 'A1Q2AfterInitAkara'), m('gheed', 84, 'A1Q2AfterInitGheed')],
    [m('kashya', 87, 'A1Q2EarlyReturnKashya'), m('warriv1', 91, 'A1Q2EarlyReturnWarriv'), m('charsi', 89, 'A1Q2EarlyReturnCharsi'), m('akara', 88, 'A1Q2EarlyReturnAkara'), m('gheed', 90, 'A1Q2EarlyReturnGheed')],
    [m('kashya', 92, 'A1Q2SuccessfulKashya', 0), m('warriv1', 96, 'A1Q2SuccessfulWarriv'), m('charsi', 94, 'A1Q2SuccessfulCharsi'), m('akara', 93, 'A1Q2SuccessfulAkara'), m('gheed', 95, 'A1Q2SuccessfulGheed')],
    [m('warriv1', 96, 'A1Q2SuccessfulWarriv'), m('kashya', 92, 'A1Q2SuccessfulKashya'), m('akara', 93, 'A1Q2SuccessfulAkara'), m('gheed', 95, 'A1Q2SuccessfulGheed')],
  ],
  // 출처: A1Q3.cpp gpAct1Q3NpcMessages (Tools of the Trade)
  3: [
    [m('charsi', 146, 'A1Q3InitCharsi', 1)],
    [m('akara', 148, 'A1Q3AfterInitAkara'), m('kashya', 149, 'A1Q3AfterInitKashya'), m('cain5', 147, 'A1Q3AfterInitCain'), m('charsi', 150, 'A1Q3AfterInitCharsi', 0), m('gheed', 151, 'A1Q3AfterInitGheed'), m('warriv1', 153, 'A1Q3AfterInitWarriv')],
    [m('kashya', 156, 'A1Q3EarlyReturnKashya'), m('warriv1', 159, 'A1Q3EarlyReturnWarriv'), m('charsi', 157, 'A1Q3EarlyReturnCharsi'), m('cain5', 154, 'A1Q3EarlyReturnCain'), m('akara', 155, 'A1Q3EarlyReturnAkara'), m('gheed', 158, 'A1Q3EarlyReturnGheed')],
    [m('kashya', 162, 'A1Q3SuccessfulKashya'), m('warriv1', 165, 'A1Q3SuccessfulWarriv'), m('charsi', 163, 'A1Q3SuccessfulCharsi', 0), m('cain5', 160, 'A1Q3SuccessfulCain'), m('akara', 161, 'A1Q3SuccessfulAkara'), m('gheed', 164, 'A1Q3SuccessfulGheed')],
    [m('kashya', 162, 'A1Q3SuccessfulKashya'), m('warriv1', 165, 'A1Q3SuccessfulWarriv'), m('cain5', 160, 'A1Q3SuccessfulCain'), m('akara', 161, 'A1Q3SuccessfulAkara'), m('gheed', 164, 'A1Q3SuccessfulGheed')],
  ],
  // 출처: A1Q4.cpp gpAct1Q4NpcMessages (The Search for Cain)
  4: [
    [m('akara', 97, 'A1Q4InitAkara', 1)],
    [m('akara', 99, 'A1Q4AfterInitScrollAkara'), m('kashya', 98, 'A1Q4AfterInitScrollKashya'), m('charsi', 100, 'A1Q4AfterInitScrollCharsi'), m('gheed', 102, 'A1Q4AfterInitScrollGheed'), m('warriv1', 101, 'A1Q4AfterInitScrollWarriv')],
    [m('kashya', 105, 'A1Q4EarlyReturnSKashya'), m('warriv1', 107, 'A1Q4EarlyReturnSWarriv'), m('charsi', 103, 'A1Q4InstructionsCharsi'), m('akara', 104, 'A1Q4EarlyReturnSAkara'), m('gheed', 106, 'A1Q4EarlyReturnSGheed')],
    [m('kashya', 108, 'A1Q4SuccessfulScrollKashya'), m('warriv1', 111, 'A1Q4SuccessfulScrollWarriv'), m('charsi', 109, 'A1Q4SuccessfulScrollCharsi'), m('akara', 112, 'A1Q4InstructionsAkara', 0), m('gheed', 110, 'A1Q4SuccessfulScrollGheed')],
    [m('kashya', 113, 'A1Q4EarlyReturnKashya'), m('warriv1', 116, 'A1Q4EarlyReturnWarriv'), m('charsi', 114, 'A1Q4EarlyReturnCharsi'), m('akara', 117, 'A1Q4EarlyReturnAkara'), m('gheed', 115, 'A1Q4EarlyReturnGheed')],
    [m('kashya', 119, 'A1Q4QuestSuccessfulKashya'), m('warriv1', 122, 'A1Q4QuestSuccessfulWarriv'), m('charsi', 121, 'A1Q4QuestSuccessfulCharsi'), m('cain5', 123, 'A1Q4QuestSuccessfulCain', 1), m('akara', 118, 'A1Q4QuestSuccessfulAkara', 1), m('gheed', 120, 'A1Q4QuestSuccessfulGheed')],
    [m('cain5', 125, 'A1Q4TragedyOfTristramCain', 1)],
    [m('cain5', 123, 'A1Q4QuestSuccessfulCain'), m('akara', 118, 'A1Q4QuestSuccessfulAkara'), m('gheed', 120, 'A1Q4QuestSuccessfulGheed')],
    [m('cain5', 125, 'A1Q4TragedyOfTristramCain')],
    [m('cain1', 124, 'A1Q4RescuedByHeroCain', 1)],
  ],
  // 출처: A1Q5.cpp gpAct1Q5NpcMessages (The Forgotten Tower). 127 = 곰팡이 핀 책 (A1Q5InitQuestTome)
  5: [
    [m('cain5', 131, 'A1Q5AfterInitCain'), m('charsi', 129, 'A1Q5AfterInitCharsi'), m('akara', 130, 'A1Q5AfterInitAkara'), m('warriv1', 132, 'A1Q5AfterInitWarriv'), m('kashya', 133, 'A1Q5AfterInitKashya'), m('gheed', 128, 'A1Q5AfterInitGheed')],
    [m('kashya', 134, 'A1Q5EarlyReturnKashya'), m('warriv1', 136, 'A1Q5EarlyReturnWarriv'), m('charsi', 137, 'A1Q5EarlyReturnCharsi'), m('akara', 138, 'A1Q5EarlyReturnAkara'), m('cain5', 135, 'A1Q5EarlyReturnCain'), m('gheed', 139, 'A1Q5EarlyReturnGheed')],
    [m('kashya', 140, 'A1Q5SuccessfulKashya', 0), m('warriv1', 141, 'A1Q5SuccessfulWarriv', 0), m('cain5', 145, 'A1Q5SuccessfulCain', 0), m('charsi', 144, 'A1Q5SuccessfulCharsi', 0), m('akara', 143, 'A1Q5SuccessfulAkara', 0), m('gheed', 142, 'A1Q5SuccessfulGheed', 0)],
    [m('kashya', 140, 'A1Q5SuccessfulKashya'), m('warriv1', 141, 'A1Q5SuccessfulWarriv'), m('cain5', 145, 'A1Q5SuccessfulCain'), m('charsi', 144, 'A1Q5SuccessfulCharsi'), m('akara', 143, 'A1Q5SuccessfulAkara'), m('gheed', 142, 'A1Q5SuccessfulGheed')],
  ],
  // 출처: A1Q6.cpp gpAct1Q6NpcMessages (Sisters to the Slaughter). Kashya 178 = A1Q6EarlyReturn2Kashya (EarlyReturnKashya 키 없음)
  6: [
    [m('cain5', 166, 'A1Q6InitCain', 1)],
    [m('akara', 168, 'A1Q6AfterInitAkara'), m('kashya', 172, 'A1Q6AfterInitKashya'), m('charsi', 169, 'A1Q6AfterInitCharsi'), m('cain5', 167, 'A1Q6AfterInitCain'), m('gheed', 170, 'A1Q6AfterInitGheed'), m('warriv1', 171, 'A1Q6AfterInitWarriv')],
    [m('kashya', 178, 'A1Q6EarlyReturn2Kashya'), m('warriv1', 177, 'A1Q6EarlyReturnWarriv'), m('gheed', 175, 'A1Q6EarlyReturnGheed'), m('cain5', 173, 'A1Q6EarlyReturnCain'), m('charsi', 176, 'A1Q6EarlyReturnCharsi'), m('akara', 174, 'A1Q6EarlyReturnAkara')],
    [m('kashya', 181, 'A1Q6SuccessfulKashya', 0), m('cain5', 184, 'A1Q6SuccessfulCain', 0), m('charsi', 180, 'A1Q6SuccessfulCharsi'), m('gheed', 182, 'A1Q6SuccessfulGheed'), m('warriv1', 183, 'A1Q6SuccessfulWarriv', 0), m('akara', 179, 'A1Q6SuccessfulAkara', 0)],
    [m('kashya', 181, 'A1Q6SuccessfulKashya'), m('cain5', 184, 'A1Q6SuccessfulCain'), m('charsi', 180, 'A1Q6SuccessfulCharsi'), m('gheed', 182, 'A1Q6SuccessfulGheed'), m('warriv1', 183, 'A1Q6SuccessfulWarriv'), m('akara', 179, 'A1Q6SuccessfulAkara')],
  ],
};

/** 곰팡이 핀 책을 읽을 때 뜨는 두루마리 (QUESTS_SendScrollMessage(…, 127)) */
export const TOWER_TOME_MESSAGE = { index: 127, key: 'A1Q5InitQuestTome' } as const;

/**
 * 퀘스트 로그 설명 문자열 (상태 바이트 → string.tbl 키).
 * 출처: string.tbl qstsa1q<퀘스트><상태> (qstsa1q11 … qstsa1q15, qstsa1q140 "One monster left." …), qstsComplete, qstsother
 * 근사(원작 미확인): 상태 바이트 → 문자열 연결은 D2Client 퀘스트 패널 코드(미공개). 상태 1~9 = qstsa1q<퀘스트><상태>,
 *   12 = 다른 곳에서 끝남(qstsother), 13 = 완료(qstsComplete), A1Q3 10 = qstsa1q32b, A1Q5 3·4 = qstsa1q51a·51b
 */
export function questLogKey(quest: number, status: number): string {
  if (status === 13) return 'qstsComplete';
  if (status === 12) return 'qstsother';
  if (quest === 3 && status === 10) return 'qstsa1q32b';
  if (quest === 5 && status === 3) return 'qstsa1q51a';
  if (quest === 5 && status === 4) return 'qstsa1q51b';
  if (status > 0 && status < 10) return `qstsa1q${quest}${status}`;
  return '';
}
