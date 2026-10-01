// 확장팩 Act 5 퀘스트 NPC 대사 표 (A5Intro · A5Q1~A5Q6).
// 출처: D2MOO D2Game/src/QUESTS/ACT5/A5Intro.cpp · A5Q1.cpp ~ A5Q6.cpp — gpAct5Q{n}NpcMessages / gpAct5IntroNpcMessages
//       (표 번호 = 상태별 대사 묶음, { NPC, 문자열 번호, 메뉴 }). 문자열 번호 → string.tbl 키는 확장팩 expansionstring.tbl 의
//       색인 배열 (번호 − 20000 번째 항목) 로 정확히 대응시켰다 (예: 20077 = A5Q1InitLarzuk, 20090 = A5Q1SuccessfulLarzuk).
// 이 파일은 원작 표를 그대로 옮긴 것이다 — 칸을 고치지 말고 원작과 대조할 것.
import type { NpcMessage } from './messages';
import { QW } from './messages-acts';

type Row = readonly [npc: string, index: number, menu: number, key: string];
const t = (rows: readonly Row[]): NpcMessage[] => rows.map(([npc, index, menu, key]) => ({ npc, index, menu: menu === 2 ? 2 : 0, key }));

/** Act 5 인트로 (A5Intro — 첫 대화: Malah 20037~20039 가 A5Q1 을 시작) */
export const ACT5_INTRO_MESSAGES: NpcMessage[][] = [
  t([['drehya', 20014, 0, 'AnyaAct5IntroGossip1'], ['malah', 20037, 0, 'MalahAct5IntroGossip1'], ['nihlathak', 20053, 0, 'NihlathakAct5IntroGossip1'], ['qual-kehk', 20065, 0, 'QualKehkAct5IntroGossip1'], ['cain6', 20003, 0, 'CainAct5IntroGossip1']]),
  t([['drehya', 20014, 0, 'AnyaAct5IntroGossip1'], ['malah', 20039, 0, 'MalahAct5IntroBarGossip1'], ['nihlathak', 20054, 0, 'NihlathakAct5IntroAssGossip1'], ['qual-kehk', 20067, 0, 'QualKehkAct5IntroDruGossip1'], ['cain6', 20003, 0, 'CainAct5IntroGossip1']]),
  t([['drehya', 20014, 0, 'AnyaAct5IntroGossip1'], ['malah', 20038, 0, 'MalahAct5IntroSorGossip1'], ['nihlathak', 20055, 0, 'NihlathakAct5IntroNecGossip1'], ['qual-kehk', 20066, 0, 'QualKehkAct5IntroPalGossip1'], ['cain6', 20003, 0, 'CainAct5IntroGossip1']]),
];

/** 기록 워드 → 상태별 대사 묶음 */
export const NPC_MESSAGES_ACT5: Record<number, NpcMessage[][]> = {
  // 출처: A5Q1.cpp gpAct5Q1NpcMessages
  [QW.A5Q1]: [
    t([['larzuk', 20077, 0, 'A5Q1InitLarzuk']]),
    t([['larzuk', 20078, 2, 'A5Q1AfterInitLarzuk'], ['cain6', 20079, 2, 'A5Q1AfterInitCain'], ['drehya', 20080, 2, 'A5Q1AfterInitAnya'], ['malah', 20081, 2, 'A5Q1AfterInitMalah'], ['nihlathak', 20082, 2, 'A5Q1AfterInitNihlathak'], ['qual-kehk', 20083, 2, 'A5Q1AfterInitQualKehk']]),
    t([['larzuk', 20084, 2, 'A5Q1EarlyReturnLarzuk'], ['cain6', 20085, 2, 'A5Q1EarlyReturnCain'], ['drehya', 20086, 2, 'A5Q1EarlyReturnAnya'], ['malah', 20087, 2, 'A5Q1EarlyReturnMalah'], ['nihlathak', 20088, 2, 'A5Q1EarlyReturnNihlathak'], ['qual-kehk', 20089, 2, 'A5Q1EarlyReturnQualKehk']]),
    t([['larzuk', 20090, 0, 'A5Q1SuccessfulLarzuk'], ['cain6', 20091, 2, 'A5Q1SuccessfulCain'], ['drehya', 20092, 2, 'A5Q1SuccessfulAnya'], ['malah', 20093, 2, 'A5Q1SuccessfulMalah'], ['nihlathak', 20094, 2, 'A5Q1SuccessfulNihlathak'], ['qual-kehk', 20095, 2, 'A5Q1SuccessfulQualKehk']]),
    t([['larzuk', 20090, 2, 'A5Q1SuccessfulLarzuk'], ['cain6', 20091, 2, 'A5Q1SuccessfulCain'], ['drehya', 20092, 2, 'A5Q1SuccessfulAnya'], ['malah', 20093, 2, 'A5Q1SuccessfulMalah'], ['nihlathak', 20094, 2, 'A5Q1SuccessfulNihlathak'], ['qual-kehk', 20095, 2, 'A5Q1SuccessfulQualKehk']]),
  ],
  // 출처: A5Q2.cpp gpAct5Q2NpcMessages
  [QW.A5Q2]: [
    t([['qual-kehk', 20096, 0, 'A5Q2InitQualKehk']]),
    t([['larzuk', 20100, 2, 'A5Q2AfterInitLarzuk'], ['cain6', 20098, 2, 'A5Q2AfterInitCain'], ['drehya', 20099, 2, 'A5Q2AfterInitAnya'], ['malah', 20101, 2, 'A5Q2AfterInitMalah'], ['nihlathak', 20102, 2, 'A5Q2AfterInitNihlathak'], ['qual-kehk', 20097, 2, 'A5Q2AfterInitQualKehk']]),
    t([['larzuk', 20107, 2, 'A5Q2EarlyReturnLarzuk'], ['cain6', 20105, 2, 'A5Q2EarlyReturnCain'], ['drehya', 20106, 2, 'A5Q2EarlyReturnAnya'], ['malah', 20108, 2, 'A5Q2EarlyReturnMalah'], ['nihlathak', 20109, 2, 'A5Q2EarlyReturnNihlathak'], ['qual-kehk', 20103, 2, 'A5Q2EarlyReturnQualKehk']]),
    t([['larzuk', 20113, 2, 'A5Q2SuccessfulLarzuk'], ['cain6', 20111, 2, 'A5Q2SuccessfulCain'], ['drehya', 20112, 2, 'A5Q2SuccessfulAnya'], ['malah', 20114, 2, 'A5Q2SuccessfulMalah'], ['nihlathak', 20115, 2, 'A5Q2SuccessfulNihlathak'], ['qual-kehk', 20110, 0, 'A5Q2SuccessfulQualKehk']]),
    t([['larzuk', 20113, 2, 'A5Q2SuccessfulLarzuk'], ['cain6', 20111, 2, 'A5Q2SuccessfulCain'], ['drehya', 20112, 2, 'A5Q2SuccessfulAnya'], ['malah', 20114, 2, 'A5Q2SuccessfulMalah'], ['nihlathak', 20115, 2, 'A5Q2SuccessfulNihlathak'], ['qual-kehk', 20110, 2, 'A5Q2SuccessfulQualKehk']]),
    t([['qual-kehk', 20104, 2, 'A5Q2EarlyReturnQualKehkMan']]),
  ],
  // 출처: A5Q3.cpp gpAct5Q3NpcMessages
  [QW.A5Q3]: [
    t([['malah', 20116, 0, 'A5Q3InitMalah']]),
    t([['larzuk', 20119, 2, 'A5Q3AfterInitLarzuk'], ['cain6', 20118, 2, 'A5Q3AfterInitCain'], ['malah', 20117, 2, 'A5Q3AfterInitMalah'], ['nihlathak', 20120, 2, 'A5Q3AfterInitNihlathak'], ['qual-kehk', 20121, 2, 'A5Q3AfterInitQualKehk']]),
    t([['larzuk', 20124, 2, 'A5Q3EarlyReturnLarzuk'], ['cain6', 20123, 2, 'A5Q3EarlyReturnCain'], ['malah', 20122, 2, 'A5Q3EarlyReturnMalah'], ['nihlathak', 20125, 2, 'A5Q3EarlyReturnNihlathak'], ['qual-kehk', 20126, 2, 'A5Q3EarlyReturnQualKehk']]),
    t([['larzuk', 20129, 2, 'A5Q3FoundAnyaLarzuk'], ['cain6', 20128, 2, 'A5Q3FoundAnyaCain'], ['drehyaiced', 20131, 0, 'A5Q3FoundAnyaAnya'], ['malah', 20127, 0, 'A5Q3FoundAnyaMalah'], ['qual-kehk', 20130, 2, 'A5Q3FoundAnyaQualKehk']]),
    t([['larzuk', 20129, 2, 'A5Q3FoundAnyaLarzuk'], ['cain6', 20128, 2, 'A5Q3FoundAnyaCain'], ['qual-kehk', 20130, 2, 'A5Q3FoundAnyaQualKehk']]),
    t([['larzuk', 20134, 2, 'A5Q3SuccessfulLarzuk'], ['cain6', 20133, 2, 'A5Q3SuccessfulCain'], ['drehya', 20136, 0, 'A5Q3SuccessfulAnya'], ['malah', 20132, 0, 'A5Q3SuccessfulMalah'], ['qual-kehk', 20135, 2, 'A5Q3SuccessfulQualKehk']]),
    t([['larzuk', 20134, 2, 'A5Q3SuccessfulLarzuk'], ['cain6', 20133, 2, 'A5Q3SuccessfulCain'], ['drehya', 20136, 2, 'A5Q3SuccessfulAnya'], ['malah', 20132, 2, 'A5Q3SuccessfulMalah'], ['qual-kehk', 20135, 2, 'A5Q3SuccessfulQualKehk']]),
  ],
  // 출처: A5Q4.cpp gpAct5Q4NpcMessages
  // 표 2·3·4 의 20143 · 20148 은 D2MOO 표에 MONSTER_NIHLATHAK 로 적혀 있으나 문자열 키 (A5Q4EarlyReturnAnya · A5Q4SuccessfulAnya) 와
  // ACT5Q4_Callback11_ScrollMessage (nNPCNo == MONSTER_DREHYA 일 때만 20148) 가 Anya 의 말임을 보여 준다 — drehya 로 적는다
  [QW.A5Q4]: [
    t([['drehya', 20137, 0, 'A5Q4InitAnya']]),
    t([['larzuk', 20141, 2, 'A5Q4AfterInitLarzuk'], ['cain6', 20139, 2, 'A5Q4AfterInitCain'], ['malah', 20140, 2, 'A5Q4AfterInitMalah'], ['qual-kehk', 20142, 2, 'A5Q4AfterInitQualKehk']]),
    t([['larzuk', 20145, 2, 'A5Q4EarlyReturnLarzuk'], ['cain6', 20144, 2, 'A5Q4EarlyReturnCain'], ['drehya', 20143, 2, 'A5Q4EarlyReturnAnya'], ['malah', 20146, 2, 'A5Q4EarlyReturnMalah'], ['qual-kehk', 20147, 2, 'A5Q4EarlyReturnQualKehk']]),
    t([['larzuk', 20150, 2, 'A5Q4SuccessfulLarzuk'], ['cain6', 20149, 2, 'A5Q4SuccessfulCain'], ['drehya', 20148, 0, 'A5Q4SuccessfulAnya'], ['malah', 20151, 2, 'A5Q4SuccessfulMalah'], ['qual-kehk', 20152, 2, 'A5Q4SuccessfulQualKehk']]),
    t([['larzuk', 20150, 2, 'A5Q4SuccessfulLarzuk'], ['cain6', 20149, 2, 'A5Q4SuccessfulCain'], ['drehya', 20148, 2, 'A5Q4SuccessfulAnya'], ['malah', 20151, 2, 'A5Q4SuccessfulMalah'], ['qual-kehk', 20152, 2, 'A5Q4SuccessfulQualKehk']]),
  ],
  // 출처: A5Q5.cpp gpAct5Q5NpcMessages (표 1~3 의 20156 · 20161 · 20166 도 A5Q4 와 같이 문자열 키가 Anya — drehya 로 적는다)
  [QW.A5Q5]: [
    t([['qual-kehk', 20153, 0, 'A5Q5InitQualKehk']]),
    t([['larzuk', 20157, 2, 'A5Q5AfterInitLarzuk'], ['cain6', 20155, 2, 'A5Q5AfterInitCain'], ['malah', 20158, 2, 'A5Q5AfterInitMalah'], ['qual-kehk', 20154, 2, 'A5Q5AfterInitQualKehk'], ['drehya', 20156, 2, 'A5Q5AfterInitAnya']]),
    t([['larzuk', 20162, 2, 'A5Q5EarlyReturnLarzuk'], ['cain6', 20160, 2, 'A5Q5EarlyReturnCain'], ['drehya', 20161, 2, 'A5Q5EarlyReturnAnya'], ['malah', 20163, 2, 'A5Q5EarlyReturnMalah'], ['qual-kehk', 20159, 2, 'A5Q5EarlyReturnQualKehk']]),
    t([['larzuk', 20167, 2, 'A5Q5SuccessfulLarzuk'], ['cain6', 20165, 2, 'A5Q5SuccessfulCain'], ['drehya', 20166, 2, 'A5Q5SuccessfulAnya'], ['malah', 20168, 2, 'A5Q5SuccessfulMalah'], ['qual-kehk', 20164, 2, 'A5Q5SuccessfulQualKehk']]),
    t([['ancientstatue1', 20002, 0, 'AncientsAct5IntroGossip1'], ['ancientstatue2', 20002, 0, 'AncientsAct5IntroGossip1'], ['ancientstatue3', 20002, 0, 'AncientsAct5IntroGossip1']]),
    t([['larzuk', 20167, 0, 'A5Q5SuccessfulLarzuk'], ['cain6', 20165, 0, 'A5Q5SuccessfulCain'], ['drehya', 20166, 0, 'A5Q5SuccessfulAnya'], ['malah', 20168, 0, 'A5Q5SuccessfulMalah'], ['qual-kehk', 20164, 0, 'A5Q5SuccessfulQualKehk']]),
  ],
  // 출처: A5Q6.cpp gpAct5Q6NpcMessages
  [QW.A5Q6]: [
    t([['larzuk', 20171, 2, 'A5Q6EarlyReturnLarzuk'], ['cain6', 20170, 2, 'A5Q6EarlyReturnCain'], ['malah', 20172, 2, 'A5Q6EarlyReturnMalah'], ['qual-kehk', 20174, 2, 'A5Q6EarlyReturnQualKehk'], ['nihlathak', 20173, 2, 'A5Q6EarlyReturnAnya']]),
    t([['larzuk', 20178, 0, 'A5Q6SuccessfulLarzuk'], ['cain6', 20177, 0, 'A5Q6SuccessfulCain'], ['malah', 20179, 0, 'A5Q6SuccessfulMalah'], ['tyrael3', 20175, 0, 'A5Q6SuccessfulTyrael'], ['qual-kehk', 20180, 0, 'A5Q6SuccessfulQualKehk'], ['drehya', 20176, 0, 'A5Q6SuccessfulAnya']]),
    t([['larzuk', 20178, 0, 'A5Q6SuccessfulLarzuk'], ['malah', 20179, 0, 'A5Q6SuccessfulMalah'], ['tyrael3', 20175, 0, 'A5Q6SuccessfulTyrael'], ['qual-kehk', 20180, 0, 'A5Q6SuccessfulQualKehk'], ['drehya', 20176, 0, 'A5Q6SuccessfulAnya']]),
    t([['larzuk', 20178, 2, 'A5Q6SuccessfulLarzuk'], ['malah', 20179, 2, 'A5Q6SuccessfulMalah'], ['tyrael3', 20175, 2, 'A5Q6SuccessfulTyrael'], ['qual-kehk', 20180, 2, 'A5Q6SuccessfulQualKehk'], ['nihlathak', 20176, 2, 'A5Q6SuccessfulAnya']]),
    t([['cain6', 20177, 0, 'A5Q6SuccessfulCain']]),
    t([['cain6', 20177, 2, 'A5Q6SuccessfulCain']]),
  ],
};
