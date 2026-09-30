// Act 2~4 퀘스트 NPC 대사 표·퀘스트 로그 문자열.
// 출처: D2MOO D2Game/src/QUESTS/ACT2/A2Q1.cpp~A2Q6.cpp, ACT3/A3Q1.cpp~A3Q6.cpp, ACT4/A4Q1.cpp~A4Q3.cpp —
//       gpAct{n}Q{m}NpcMessages (표 번호 = 상태별 대사 묶음, { NPC, 문자열 번호, 메뉴 }), Quests.cpp QUESTS_InitScrollTextChain (메뉴 1 → 0)
// 근사(원작 미확인): 문자열 번호 → string.tbl 키 연결은 D2Client 대사 표(미공개)에 있다. Act 1 과 같이 표의 NPC·상태와 string.tbl 키 이름
//   (A2Q1InitAtma, A2Q1AfterInit<NPC>, A2Q1EarlyReturn<NPC>, A2Q1Successful<NPC> …)을 맞춰 적었다. 이름 규칙이 다른 키는 표에 직접 적었다
//   (A2Q2 Cain 의 Scroll/Cap/Stave/Cube, A3Q2 Cain 의 Eye/Heart/Brain/Flail, A3Q4 Init1~3, A3Q5·A3Q6 의 …VA, A4Q3 HasStone/NoStone 등).
//   string.tbl 에 키가 없는 칸(A2Q1 Jerhyn 331)은 뺐다.
import type { NpcMessage } from './messages';

/** 퀘스트 기록 워드 (원작 D2QuestStateFlagIds). 출처: Quests.h */
export const QW = {
  A1COMPLETED: 7,
  A2Q0: 8, A2Q1: 9, A2Q2: 10, A2Q3: 11, A2Q4: 12, A2Q5: 13, A2Q6: 14, A2COMPLETED: 15,
  A3Q0: 16, A3Q1: 17, A3Q2: 18, A3Q3: 19, A3Q4: 20, A3Q5: 21, A3Q6: 22, A3COMPLETED: 23,
  A4Q0: 24, A4Q1: 25, A4Q2: 26, A4Q3: 27, A4COMPLETED: 28,
} as const;

/** 퀘스트 기록 워드 → (막, 막 안의 퀘스트 번호). Act 1 은 워드 = 번호 */
export function questOfWord(word: number): { act: number; quest: number } {
  if (word >= QW.A4Q0) return { act: 3, quest: word - QW.A4Q0 };
  if (word >= QW.A3Q0) return { act: 2, quest: word - QW.A3Q0 };
  if (word >= QW.A2Q0) return { act: 1, quest: word - QW.A2Q0 };
  return { act: 0, quest: word };
}

/** (막, 번호) → 기록 워드 */
export function wordOfQuest(act: number, quest: number): number {
  return [0, QW.A2Q0, QW.A3Q0, QW.A4Q0][act]! + quest;
}

/** 퀘스트 이름 string.tbl 키 (qstsa2q1 …) */
export function questNameKey(word: number): string {
  const { act, quest } = questOfWord(word);
  return `qstsa${act + 1}q${quest}`;
}

/** monstats Id → string.tbl 대사 키의 NPC 이름 */
const NAME: Record<string, string> = {
  atma: 'Atma', warriv2: 'WarrivAct2', greiz: 'Greiz', elzix: 'Elzix', drognan: 'Drognan', lysander: 'Lysander', cain2: 'Cain',
  meshif1: 'Meshif', geglash: 'Geglash', jerhyn: 'Jerhyn', fara: 'Fara',
  alkor: 'Alkor', ormus: 'Ormus', meshif2: 'MeshifAct3', asheara: 'Asheara', hratli: 'Hratli', cain3: 'CainAct3', natalya: 'Natalya',
  tyrael2: 'Tyrael', cain4: 'Cain', izualghost: 'Izual',
};

type Row = [npc: string, index: number, menu: 0 | 1 | 2];
/** 표 한 줄: [NPC, 번호, 메뉴] (+ 키를 직접 적은 칸) */
function table(prefix: string, stage: string, rows: (Row | [...Row, string])[]): NpcMessage[] {
  return rows.map(([npc, index, menu, key]) => ({ npc, index, menu: menu === 2 ? 2 : 0, key: key ?? `${prefix}${stage}${NAME[npc] ?? npc}` }));
}

const A2_ALL = ['atma', 'warriv2', 'greiz', 'elzix', 'drognan', 'lysander', 'cain2', 'meshif1', 'geglash', 'jerhyn', 'fara'];
const A3_ALL = ['alkor', 'ormus', 'meshif2', 'asheara', 'hratli', 'cain3', 'natalya'];

/** 기록 워드 → 상태별 대사 묶음 */
export const NPC_MESSAGES_ACTS: Record<number, NpcMessage[][]> = {
  // 출처: A2Q1.cpp gpAct2Q1NpcMessages (Radament's Lair)
  [QW.A2Q1]: [
    table('A2Q1', 'Init', [['atma', 304, 0]]),
    table('A2Q1', 'AfterInit', [['atma', 310, 2], ['warriv2', 307, 2], ['greiz', 305, 2], ['elzix', 306, 2], ['drognan', 312, 2], ['lysander', 313, 2], ['cain2', 314, 2], ['meshif1', 311, 2], ['geglash', 308, 2], ['fara', 309, 2]]),
    table('A2Q1', 'EarlyReturn', [['atma', 317, 2], ['warriv2', 315, 2], ['greiz', 318, 2], ['elzix', 320, 2], ['drognan', 322, 2], ['lysander', 321, 2], ['cain2', 324, 2], ['meshif1', 316, 2], ['geglash', 319, 2], ['fara', 323, 2]]),
    table('A2Q1', 'Successful', [['atma', 334, 1], ['greiz', 325, 2], ['elzix', 330, 2], ['drognan', 326, 2], ['lysander', 327, 2], ['cain2', 333, 2], ['meshif1', 328, 2], ['geglash', 329, 2], ['fara', 332, 2]]),
    table('A2Q1', 'Successful', [['atma', 334, 2], ['greiz', 325, 2], ['elzix', 330, 2], ['drognan', 326, 2], ['cain2', 333, 2], ['meshif1', 328, 2], ['geglash', 329, 2], ['fara', 332, 2]]),
  ],
  // 출처: A2Q2.cpp gpAct2Q2NpcMessages (The Horadric Staff) — 표 0~4 = 두루마리·독사 부적·왕의 지팡이·큐브·호라드릭 지팡이, 5~9 = 메뉴로 다시 듣기
  [QW.A2Q2]: (() => {
    const k = [[335, 'A2Q2EarlyReturnScrollCain'], [336, 'A2Q2EarlyReturnCapCain'], [337, 'A2Q2EarlyReturnStaveCain'], [338, 'A2Q2EarlyReturnCubeCain'], [339, 'A2Q2SuccessfulStaffCain']] as const;
    const first = k.map(([i, key]) => table('', '', [['cain2', i, 0, key]]));
    return [...first, table('', '', [['cain2', 339, 2, k[4][1]]]), ...k.slice(0, 4).map(([i, key]) => table('', '', [['cain2', i, 2, key]]))];
  })(),
  // 출처: A2Q3.cpp gpAct2Q3NpcMessages (Tainted Sun)
  [QW.A2Q3]: (() => {
    const after: Row[] = [['atma', 344, 2], ['warriv2', 343, 2], ['greiz', 341, 2], ['elzix', 342, 2], ['drognan', 348, 1], ['lysander', 347, 2], ['cain2', 350, 2], ['meshif1', 349, 2], ['geglash', 345, 2], ['jerhyn', 340, 2], ['fara', 346, 2]];
    const succ: Row[] = [['atma', 368, 1], ['warriv2', 366, 1], ['greiz', 363, 1], ['elzix', 364, 1], ['drognan', 371, 1], ['lysander', 370, 1], ['cain2', 372, 1], ['meshif1', 367, 1], ['geglash', 365, 1], ['jerhyn', 362, 1]];
    return [
      table('A2Q3', 'AfterInit', after),
      table('A2Q3', 'AfterInit', after.map(([n, i]) => [n, i, 2] as Row)),
      table('A2Q3', 'EarlyReturn', [['atma', 361, 2], ['warriv2', 353, 2], ['greiz', 352, 2], ['elzix', 359, 2], ['drognan', 358, 2], ['lysander', 357, 2], ['cain2', 360, 2], ['meshif1', 355, 2], ['jerhyn', 351, 2], ['geglash', 354, 2], ['fara', 356, 2]]),
      table('A2Q3', 'Successful', succ),
      table('A2Q3', 'Successful', [...succ.map(([n, i]) => [n, i, 2] as Row).filter(([n]) => n !== 'cain2'), ['fara', 369, 2]]),
    ];
  })(),
  // 출처: A2Q4.cpp gpAct2Q4NpcMessages (Arcane Sanctuary). 6~10 = Kaelan(ACT2GUARD2) 185~189 → PalaceGuardGossip1~5
  [QW.A2Q4]: [
    table('A2Q4', 'Init', [['drognan', 373, 1]]),
    table('A2Q4', '', [['drognan', 373, 2, 'A2Q4InitDrognan'], ['jerhyn', 377, 1, 'A2Q4AfterInitJerhyn']]),
    table('A2Q4', 'AfterInit', [['atma', 380, 2], ['warriv2', 381, 2], ['greiz', 375, 2], ['elzix', 376, 2], ['drognan', 383, 2], ['lysander', 382, 2], ['cain2', 378, 2], ['jerhyn', 377, 2], ['meshif1', 384, 2], ['geglash', 379, 2], ['fara', 374, 2]]),
    table('A2Q4', 'EarlyReturn', [['atma', 393, 2], ['warriv2', 394, 2], ['greiz', 387, 2], ['elzix', 385, 2], ['drognan', 388, 2], ['jerhyn', 386, 2], ['lysander', 389, 2], ['cain2', 395, 2], ['meshif1', 392, 2], ['geglash', 391, 2], ['fara', 390, 2]]),
    table('A2Q4', 'Successful', [['atma', 406, 1], ['warriv2', 403, 1], ['greiz', 397, 1, 'A2Q4SuccessfulGriez'], ['elzix', 400, 1], ['jerhyn', 398, 1], ['drognan', 399, 1], ['lysander', 405, 1], ['cain2', 407, 1], ['meshif1', 402, 1], ['geglash', 401, 1], ['fara', 404, 1]]),
    table('A2Q4', 'Successful', [['warriv2', 403, 2], ['greiz', 397, 2, 'A2Q4SuccessfulGriez'], ['elzix', 400, 2], ['jerhyn', 398, 2], ['drognan', 399, 2], ['lysander', 405, 2], ['cain2', 407, 2], ['meshif1', 402, 2], ['geglash', 401, 2], ['fara', 404, 2]]),
    ...[185, 186, 187, 188, 189].map((i, n) => table('', '', [['act2guard2', i, 1, `PalaceGuardGossip${n + 1}`]])),
  ],
  // 출처: A2Q5.cpp gpAct2Q5NpcMessages (The Summoner)
  [QW.A2Q5]: (() => {
    const succ: Row[] = [['atma', 427, 1], ['warriv2', 424, 1], ['greiz', 419, 1], ['elzix', 423, 1], ['drognan', 422, 1], ['lysander', 426, 1], ['cain2', 429, 1], ['meshif1', 425, 1], ['jerhyn', 421, 1], ['geglash', 420, 1], ['fara', 428, 1]];
    return [
      table('A2Q5', 'EarlyReturn', [['atma', 414, 2], ['warriv2', 413, 2], ['greiz', 408, 2], ['elzix', 417, 2], ['drognan', 410, 2], ['lysander', 411, 2], ['cain2', 418, 2], ['meshif1', 412, 2], ['jerhyn', 409, 2], ['geglash', 415, 2], ['fara', 416, 2]]),
      table('A2Q5', 'Successful', succ),
      table('A2Q5', 'Successful', succ.map(([n, i]) => [n, i, 2] as Row)),
    ];
  })(),
  // 출처: A2Q6.cpp gpAct2Q6NpcMessages (The Seven Tombs). 302 = Tyrael(TYRAEL1) → TyraelGossip1
  [QW.A2Q6]: (() => {
    const succ = (menu: 0 | 1 | 2, jer: 0 | 1 | 2): (Row | [...Row, string])[] => [
      ['atma', 445, menu], ['warriv2', 446, menu], ['greiz', 451, menu], ['elzix', 443, menu], ['drognan', 449, menu], ['jerhyn', 442, jer],
      ['tyrael1', 302, 1, 'TyraelGossip1'], ['lysander', 444, menu], ['cain2', 452, menu], ['meshif1', 450, menu], ['geglash', 448, menu], ['fara', 447, menu],
    ];
    return [
      table('A2Q6', 'Init', [['jerhyn', 430, 1]]),
      table('A2Q6', 'AfterInit', [['atma', 434, 2], ['warriv2', 433, 2], ['greiz', 441, 2], ['elzix', 432, 2], ['jerhyn', 431, 2], ['drognan', 439, 2], ['lysander', 438, 2], ['cain2', 440, 2], ['meshif1', 436, 2], ['geglash', 435, 2], ['fara', 437, 2]]),
      table('', '', [['tyrael1', 302, 1, 'TyraelGossip1']]),
      table('A2Q6', 'Successful', succ(2, 1)),
      table('A2Q6', 'Successful', succ(2, 2).filter(([n]) => n !== 'meshif1')),
      table('A2Q6', 'Successful', [['meshif1', 450, 1]]),
      table('A2Q6', 'Successful', [['atma', 445, 1], ['warriv2', 446, 1], ['drognan', 449, 1], ['lysander', 444, 1], ['cain2', 452, 1], ['fara', 447, 1]]),
    ];
  })(),
  // 출처: A3Q1.cpp gpAct3Q1NpcMessages (Lam Esen's Tome)
  [QW.A3Q1]: [
    table('A3Q1', 'Init', [['alkor', 549, 1]]),
    table('A3Q1', 'AfterInit', A3_ALL.map((n, i) => [n, 550 + i, 2] as Row)),
    table('A3Q1', 'EarlyReturn', A3_ALL.map((n, i) => [n, 557 + i, 2] as Row)),
    table('A3Q1', 'Successful', A3_ALL.map((n, i) => [n, 564 + i, i === 0 ? 1 : 2] as Row)),
    table('A3Q1', 'Successful', [['cain3', 569, 2], ['natalya', 570, 2]]),
  ],
  // 출처: A3Q2.cpp gpAct3Q2NpcMessages (Khalim's Will) — 표 0 시작, 1 눈, 2 심장, 3 뇌, 4 도리깨, 5 칼림의 의지, 6~11 = 메뉴로 다시 듣기
  [QW.A3Q2]: (() => {
    const k: [number, string][] = [[543, 'A3Q2InitCain'], [545, 'A3Q2EarlyReturnEyeCain'], [544, 'A3Q2EarlyReturnHeartCain'], [546, 'A3Q2EarlyReturnBrainCain'], [547, 'A3Q2EarlyReturnFlailCain'], [548, 'A3Q2SuccessfulCain']];
    return [...k.map(([i, key]) => table('', '', [['cain3', i, 1, key]])), ...k.map(([i, key]) => table('', '', [['cain3', i, 2, key]]))];
  })(),
  // 출처: A3Q3.cpp gpAct3Q3NpcMessages (Blade of the Old Religion). 593 = Ormus 보상 반지 (A3Q3RewardOrmus)
  [QW.A3Q3]: [
    table('A3Q3', 'Init', [['hratli', 571, 1]]),
    table('A3Q3', 'AfterInit', A3_ALL.map((n, i) => [n, 572 + i, 2] as Row)),
    table('A3Q3', 'EarlyReturn', A3_ALL.map((n, i) => [n, 579 + i, 2] as Row)),
    table('A3Q3', 'Successful', [['alkor', 586, 2], ['ormus', 587, 1], ['meshif2', 588, 2], ['hratli', 590, 2], ['cain3', 591, 2], ['natalya', 592, 2]]),
    table('A3Q3', 'Successful', [['meshif2', 588, 2], ['alkor', 586, 2], ['cain3', 591, 2], ['natalya', 592, 2]]),
    table('A3Q3', 'Successful', [['meshif2', 588, 2], ['asheara', 589, 1], ['alkor', 586, 2], ['cain3', 591, 2], ['natalya', 592, 2]]),
    table('A3Q3', 'Reward', [['ormus', 593, 1]]),
  ],
  // 출처: A3Q4.cpp gpAct3Q4NpcMessages (The Golden Bird)
  [QW.A3Q4]: [
    table('', '', [['cain3', 527, 1, 'A3Q4Init1CainAct3'], ['asheara', 528, 2, 'A3Q4Init1Asheara']]),
    table('', '', [['meshif2', 529, 1, 'A3Q4Init2MeshifAct3']]),
    table('', '', [['cain3', 531, 2, 'A3Q4Init3CainAct3'], ['alkor', 534, 1, 'A3Q4AfterInitAlkor'], ['natalya', 530, 2, 'A3Q4Init2Natalya'], ['hratli', 532, 2, 'A3Q4Init3Hratli'], ['asheara', 533, 2, 'A3Q4Init3Asheara']]),
    table('', '', [['cain3', 531, 1, 'A3Q4Init3CainAct3'], ['hratli', 532, 2, 'A3Q4Init3Hratli'], ['asheara', 533, 2, 'A3Q4Init3Asheara']]),
    table('A3Q4', 'AfterInit', [['alkor', 534, 2], ['ormus', 535, 2], ['hratli', 536, 2], ['natalya', 537, 2]]),
    table('A3Q4', 'Successful', [['alkor', 538, 1], ['meshif2', 539, 2], ['cain3', 540, 2], ['ormus', 541, 2]]),
    table('A3Q4', 'Successful', [['alkor', 538, 2], ['meshif2', 539, 2], ['cain3', 540, 2], ['ormus', 541, 2], ['natalya', 542, 2]]),
    table('', '', [['cain3', 527, 2, 'A3Q4Init1CainAct3'], ['asheara', 528, 2, 'A3Q4Init1Asheara']]),
  ],
  // 출처: A3Q5.cpp gpAct3Q5NpcMessages (The Blackened Temple). 표 2·4 = …VA (Lam Esen 을 끝내지 않은 상태 3·5 의 대사)
  [QW.A3Q5]: [
    table('A3Q5', 'Init', [['ormus', 594, 1]]),
    table('A3Q5', 'AfterInit', A3_ALL.map((n, i) => [n, 595 + [0, 2, 4, 6, 8, 10, 12][i]!, 2] as Row)),
    table('A3Q5', 'AfterInit', A3_ALL.map((n, i) => [n, 596 + [0, 2, 4, 6, 8, 10, 12][i]!, 2, `A3Q5AfterInit${NAME[n]}VA`] as [...Row, string])),
    table('A3Q5', 'EarlyReturn', [['alkor', 609, 2], ['ormus', 611, 2], ['meshif2', 612, 2], ['asheara', 614, 2], ['hratli', 616, 2], ['cain3', 618, 2], ['natalya', 619, 2]]),
    table('A3Q5', 'EarlyReturn', ([['alkor', 610], ['meshif2', 613], ['asheara', 615], ['hratli', 617], ['natalya', 620]] as [string, number][]).map(([n, i]) => [n, i, 2, `A3Q5EarlyReturn${NAME[n]}VA`] as [...Row, string])),
    table('A3Q5', 'Successful', A3_ALL.map((n, i) => [n, 621 + i, n === 'cain3' ? 1 : 2] as Row)),
    table('A3Q5', 'Successful', A3_ALL.map((n, i) => [n, 621 + i, 2] as Row)),
  ],
  // 출처: A3Q6.cpp gpAct3Q6NpcMessages (The Guardian)
  [QW.A3Q6]: [
    table('A3Q6', 'Init', [['ormus', 628, 1]]),
    table('A3Q6', 'AfterInit', A3_ALL.map((n, i) => [n, 629 + 2 * i, 2] as Row)),
    table('A3Q6', 'AfterInit', ([['alkor', 630], ['ormus', 632], ['meshif2', 634], ['hratli', 638], ['cain3', 640], ['natalya', 642]] as [string, number][]).map(([n, i]) => [n, i, 2, `A3Q6AfterInit${NAME[n]}VA`] as [...Row, string])),
    table('A3Q6', 'EarlyReturn', A3_ALL.map((n, i) => [n, 643 + 2 * i, 2] as Row)),
    table('A3Q6', 'EarlyReturn', A3_ALL.map((n, i) => [n, 644 + 2 * i, 2, `A3Q6EarlyReturn${NAME[n]}VA`] as [...Row, string])),
    table('A3Q6', 'Successful', A3_ALL.map((n, i) => [n, 657 + i, 1] as Row)),
    table('A3Q6', 'Successful', A3_ALL.map((n, i) => [n, 657 + i, 2] as Row)),
  ],
  // 출처: A4Q1.cpp gpAct4Q1NpcMessages (The Fallen Angel)
  [QW.A4Q1]: [
    table('A4Q1', 'Init', [['tyrael2', 670, 1]]),
    table('A4Q1', 'AfterInit', [['tyrael2', 671, 2], ['cain4', 672, 2]]),
    table('A4Q1', 'EarlyReturn', [['tyrael2', 673, 2], ['cain4', 674, 2]]),
    table('A4Q1', 'Successful', [['tyrael2', 676, 1], ['cain4', 677, 2], ['izualghost', 675, 1]]),
    table('A4Q1', 'Successful', [['tyrael2', 676, 2], ['cain4', 677, 2]]),
  ],
  // 출처: A4Q2.cpp gpAct4Q2NpcMessages (Terror's End). 표 4·5 (20000·20001) 는 확장팩(Act 5 포털) 전용이라 뺐다
  [QW.A4Q2]: [
    table('A4Q2', 'Init', [['tyrael2', 681, 1]]),
    table('A4Q2', 'AfterInit', [['tyrael2', 683, 2], ['cain4', 682, 2]]),
    table('A4Q2', 'Successful', [['tyrael2', 684, 1], ['cain4', 685, 1]]),
    table('A4Q2', 'Successful', [['tyrael2', 684, 2], ['cain4', 685, 2]]),
  ],
  // 출처: A4Q3.cpp gpAct4Q3NpcMessages (Hell's Forge). 원작 표의 166~168 은 바이트가 잘린 값 — ScrollMessage 는 678~680 을 본다
  [QW.A4Q3]: [
    table('', '', [['cain4', 678, 1, 'A4Q3InitHasStoneCain']]),
    table('', '', [['cain4', 679, 1, 'A4Q3InitNoStoneCain']]),
    table('', '', [['cain4', 680, 1, 'A4Q3SuccessfulCain']]),
    table('', '', [['cain4', 680, 2, 'A4Q3SuccessfulCain']]),
  ],
};

/** Horazon 의 일지를 읽을 때 뜨는 두루마리 (ACT2Q4 OBJECTS_OperateFunction42_SanctuaryTome → QUESTS_SendScrollMessage 396) */
export const HORAZON_JOURNAL_MESSAGE = { index: 396, key: 'A2Q4SuccessfulNarrator' } as const;

/** 모든 막의 NPC 전체 (검사용) */
export const ACT_TOWN_NPCS = { 1: A2_ALL, 2: A3_ALL, 3: ['tyrael2', 'cain4'] } as const;

/**
 * 퀘스트 패널 순서 (막 안의 번호).
 * 근사(원작 미확인): D2Client 퀘스트 패널 표 — 원작 화면 순서(Act 3: 황금새·기드빈·칼림·람 에센·검은 사원·수호자, Act 4: 타락 천사·지옥의 대장간·공포의 종말)
 */
export const QUEST_LOG_ORDER_ACTS: Record<number, readonly number[]> = { 1: [1, 2, 3, 4, 5, 6], 2: [4, 3, 2, 1, 5, 6], 3: [1, 3, 2] };

/**
 * 퀘스트 로그 설명 (상태 바이트 → string.tbl 키). 12 = 다른 곳에서 끝남(qstsother), 13 = 완료(qstsComplete), 그 밖은 퀘스트별 표.
 * 출처: string.tbl qstsa2q11 … qstsa4q34 (a/f 가 붙은 변형 포함)
 * 근사(원작 미확인): 상태 바이트 → 문자열 연결은 D2Client 퀘스트 패널 코드(미공개). 서버 상태 기계가 보내는 값(fLastState·StatusFilter)과
 *   문자열 뜻을 맞춰 적었다
 */
const LOG_KEYS: Record<number, Record<number, string>> = {
  [QW.A2Q1]: { 1: 'qstsa2q11', 2: 'qstsa2q12', 3: 'qstsa2q13' },
  [QW.A2Q2]: { 1: 'qstsa2q21', 2: 'qstsa2q22', 3: 'qstsa2q23', 4: 'qstsa2q25', 5: 'qstsa2q24', 6: 'qstsa2q25', 8: 'qstsa2q22', 9: 'qstsa2q22' },
  [QW.A2Q3]: { 1: 'qstsa2q31', 2: 'qstsa2q32', 3: 'qstsa2q33', 4: 'qstsa2q31a' },
  [QW.A2Q4]: { 1: 'qstsa2q41a', 2: 'qstsa2q41', 3: 'qstsa2q41', 4: 'qstsa2q42', 5: 'qstsa2q43' },
  [QW.A2Q5]: { 1: 'qstsa2q51', 2: 'qstsa2q52', 4: 'qstsa2q53' },
  [QW.A2Q6]: { 1: 'qstsa2q61', 2: 'qstsa2q62', 3: 'qstsa2q63', 4: 'qstsa2q63a', 5: 'qstsa2q64', 6: 'qstsa2q65', 8: 'qstsa2q63f', 9: 'qstsa2q63f' },
  [QW.A3Q1]: { 1: 'qstsa3q11', 2: 'qstsa3q12', 8: 'qstsa3q11', 9: 'qstsa3q11' },
  [QW.A3Q2]: { 1: 'qstsa3q21', 2: 'qstsa3q22', 3: 'qstsa3q23', 4: 'qstsa3q24', 5: 'qstsa3q21a', 6: 'qstsa3q26', 7: 'qstsa3q25' },
  [QW.A3Q3]: { 1: 'qstsa3q31a', 2: 'qstsa3q31', 3: 'qstsa3q32', 4: 'qstsa3q33', 5: 'qstsa3q34', 6: 'qstsa3q35', 7: 'qstsa3q31', 8: 'qstsa3q31' },
  [QW.A3Q4]: { 1: 'qstsa3q41', 2: 'qstsa3q42', 3: 'qstsa3q43', 4: 'qstsa3q44', 5: 'qstsa3q45' },
  [QW.A3Q5]: { 1: 'qstsa3q51a', 2: 'qstsa3q51', 3: 'qstsa3q52', 4: 'qstsa3q53' },
  [QW.A3Q6]: { 1: 'qstsa3q61a', 2: 'qstsa3q61', 3: 'qstsa3q62', 4: 'qstsa3q63' },
  [QW.A4Q1]: { 1: 'qstsa4q11', 2: 'qstsa4q12', 3: 'qstsa4q13a', 4: 'qstsa4q13' },
  [QW.A4Q2]: { 1: 'qstsa4q21', 2: 'qstsa4q22', 3: 'qstsa4q23', 4: 'qstsa4q24' },
  [QW.A4Q3]: { 1: 'qstsa4q31', 2: 'qstsa4q32', 3: 'qstsa4q33', 4: 'qstsa4q31', 5: 'qstsa4q34' },
};

/** 퀘스트 로그 설명 키 (기록 워드·상태 바이트). 없으면 '' */
export function questLogKeyActs(word: number, status: number): string {
  if (status === 13 || status === 11) return 'qstsComplete';
  if (status === 12) return 'qstsother';
  return LOG_KEYS[word]?.[status] ?? '';
}
