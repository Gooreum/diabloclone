// Act 2 퀘스트 6개 상태 기계 (Radament's Lair · The Horadric Staff · Tainted Sun · Arcane Sanctuary · The Summoner · The Seven Tombs).
// 출처: D2MOO D2Game/src/QUESTS/ACT2/A2Q1.cpp ~ A2Q6.cpp (콜백: NpcActivate / NpcDeactivate / ChangedLevel / MonsterKilled / ScrollMessage /
//       ItemPickedUp / ItemDropped / PlayerStartedGame, SeqCallback, ActiveFilter, StatusFilter, 오브젝트 Operate/Init 함수)
//       D2Game/src/QUESTS/Quests.cpp (QUESTS_SequenceCycler — 게임 시작 때 퀘스트 8(A2Q1) 의 SeqCallback, QUESTS_LevelWarpCheck — 두리엘 방,
//       QUESTS_ActChange_HirelingChangeAct — Warriv/Meshif 로 막 이동: A1COMPLETED·A2COMPLETED)
//       D2Game/src/MONSTER/MonsterSpawn.cpp (퀘스트 연결: radament → A2Q1, summoner → A2Q5, duriel → A2Q6)
// (https://github.com/ThePhrozenKeep/D2MOO)
// 싱글플레이: 파티·다른 플레이어 GUID 목록은 "플레이어가 목록에 있음" 불리언 하나로 줄였다.
import { OBJMODE, type ObjectUnit } from '../objects';
import { QUALITY } from '../treasure';
import type { QuestSpeech } from './act1';
import { QFLAG } from './record';
import { ActQuestBase, QuestData, type ActsKill, type ActsQuestHost } from './acts-base';
import { HORAZON_JOURNAL_MESSAGE, QW } from './messages-acts';

/** Act 2 levels.txt 번호 (출처: LevelsIds.h) */
export const L2 = {
  LUTGHOLEIN: 40, LOSTCITY: 44, VALLEYOFSNAKES: 45, CANYON: 46, SEWERS3: 49, HAREM1: 50, CLAWVIPER2: 61, TOMB1: 66, TOMB7: 72,
  DURIELSLAIR: 73, ARCANE: 74, KURASTDOCKS: 75,
} as const;

/** 출처: objects.txt — 100 Duriel's Lair 포털, 149 오염된 태양 제단, 152 오리피스, 153 Tyrael 의 문, 298 비전의 성역 포털, 357 Horazon 의 일지 */
export const OBJ2 = { DURIEL_PORTAL: 100, TAINTED_ALTAR: 149, ORIFICE: 152, TYRAEL_DOOR: 153, JOURNAL: 357 } as const;

const { A2Q1, A2Q2, A2Q3, A2Q4, A2Q5, A2Q6 } = QW;
const TOWN = L2.LUTGHOLEIN;

/**
 * 오리피스에 지팡이를 꽂은 뒤 두리엘 방 포털이 열리기까지 (ACT2Q6_DeleteAllHoradricItemsAndOpenTomb: 미사일 338 Range 로 계산한 틱).
 * 근사(원작 미확인): missiles.txt 338 의 Range 를 읽지 않고 원작 화면에서 본 길이(약 2초)로 둔다
 */
const ORIFICE_TICKS = 50;

/**
 * Act 2 퀘스트 제어 (원작 pGame->pQuestControl 의 Act 2 부분).
 * 출처: Quests.cpp gpQuestInitTable — A2Q1 (InitNo 4, Seq 13), A2Q2 (0, bNoSetState), A2Q3 (4, Seq 11), A2Q4 (5, Seq 13), A2Q5 (2), A2Q6 (4)
 */
export class Act2Quests extends ActQuestBase {
  readonly act = 1;
  // A2Q1 (D2Act2Quest1Strc)
  private q1 = { atmaActivated: false, rewardPending: false, iterated: false, timer: false };
  // A2Q2 (D2Act2Quest2Strc)
  private q2 = { staffCubed: false };
  // A2Q3 (D2Act2Quest3Strc)
  private q3 = { darkenTimer: false, dark: false, blackened: false, altarDestroyed: false, drognanActivated: false };
  // A2Q4 (D2Act2Quest4Strc)
  private q4 = { drognanActivated: false, palaceOpen: false, portalToCanyon: false };
  // A2Q5 (D2Act2Quest5Strc)
  private q5 = { killed: false, timer: 0 };
  // A2Q6 (D2Act2Quest6Strc)
  private q6 = {
    durielKilled: false, doorMode: 0 as number, portalToTown: false, tyraelActivated: false, initJerhyn: false, endJerhyn: false,
    lairPortalNeedsToOpen: false, objectsNeedUpdate: false, timerActive: false, tombOpen: false, staffItemsRemoved: false, rewardedBefore: false,
    orifice: null as ObjectUnit | null,
  };

  constructor(h: ActsQuestHost) {
    super(h);
    this.q[A2Q1] = new QuestData(A2Q1, 4);
    this.q[A2Q2] = new QuestData(A2Q2, 0, true);
    this.q[A2Q3] = new QuestData(A2Q3, 4);
    this.q[A2Q4] = new QuestData(A2Q4, 5);
    this.q[A2Q5] = new QuestData(A2Q5, 2);
    this.q[A2Q6] = new QuestData(A2Q6, 4);
    // 출처: ACT2Q1_InitQuestData fState 1, ACT2Q2_InitQuestData fLastState 13
    this.Q(A2Q1).state = 1;
    this.Q(A2Q2).lastState = 13;
  }

  /** 오염된 태양 (ENVIRONMENT_TaintedSunBegin ~ End): Act 2 가 어두워진 상태 */
  get taintedSun(): boolean {
    return this.q3.dark;
  }

  /** 궁전(하렘) 입구가 열렸는가 (Kaelan 이 비켜섬) */
  get palaceOpen(): boolean {
    return this.q4.palaceOpen;
  }

  /** 두리엘 방 포털이 열렸는가 */
  get tombOpen(): boolean {
    return this.q6.tombOpen;
  }

  // ------------------------------------------------------------ 게임 시작

  startGame(): void {
    // 근사(원작 미확인): 예전 저장(이 Phase 이전)으로 Act 2 이후에 서 있으면 Warriv 이동 때 켜졌어야 할 A1COMPLETED 를 켠다
    if (this.h.act() >= 1 && !this.has(QW.A1COMPLETED, QFLAG.REWARDGRANTED)) {
      this.set(QW.A1COMPLETED, QFLAG.REWARDGRANTED);
      this.set(QW.A1COMPLETED, QFLAG.PRIMARYGOALDONE);
    }
    if (this.h.act() >= 2 && !this.has(QW.A2COMPLETED, QFLAG.REWARDGRANTED)) {
      this.set(QW.A2COMPLETED, QFLAG.REWARDGRANTED);
      this.set(QW.A2COMPLETED, QFLAG.PRIMARYGOALDONE);
    }
    this.startCommon();
    this.startedQ6();
    this.startedQ5();
    this.startedQ4();
    this.startedQ3();
    this.startedQ2();
    this.startedQ1();
    // 출처: QUESTS_SequenceCycler — 퀘스트 8 (A2Q1) 의 SeqCallback
    this.seq(A2Q1);
  }

  /** 출처: ACT2Q1_Callback13_PlayerStartedGame */
  private startedQ1(): void {
    const d = this.Q(A2Q1);
    if (this.has(A2Q1, QFLAG.REWARDGRANTED)) {
      // 책(ass)을 쓰지 않고 잃어버렸으면 퀘스트를 다시 할 수 있다
      if (this.has(A2Q1, QFLAG.CUSTOM1) && !this.item('ass')) {
        for (const f of [QFLAG.REWARDGRANTED, QFLAG.REWARDPENDING, QFLAG.COMPLETEDBEFORE, QFLAG.CUSTOM1]) this.clr(A2Q1, f);
      }
      this.h.global.set(A2Q1, QFLAG.PRIMARYGOALDONE);
      d.notIntro = false;
      d.state = 0;
    } else if (this.has(A2Q1, QFLAG.COMPLETEDBEFORE)) {
      if (this.has(A2Q1, QFLAG.REWARDPENDING)) this.q1.rewardPending = true;
      d.state = 0;
      d.notIntro = false;
    } else if (this.has(A2Q1, QFLAG.ENTERAREA)) [d.lastState, d.state] = [2, 3];
    else if (this.has(A2Q1, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [3, 1];
    else if (this.has(A2Q1, QFLAG.STARTED)) [d.state, d.lastState] = [2, 1];
  }

  /** 출처: ACT2Q2_Callback13_PlayerStartedGame — 가진 조각이 없으면 Cain 에게 보여 준 표시를 지운다 */
  private startedQ2(): void {
    if (this.has(A2Q2, QFLAG.REWARDGRANTED)) return;
    if (!this.Q(A2Q6).notIntro || this.q6.tombOpen || this.item('hst')) return;
    const staff = this.item('msf'), box = this.item('box'), amulet = this.item('vip');
    if (staff) {
      if (!box) {
        this.clr(A2Q2, QFLAG.CUSTOM2);
        if (!amulet) this.clr(A2Q2, QFLAG.ENTERAREA);
        return;
      }
      if (amulet) return;
    } else this.clr(A2Q2, QFLAG.CUSTOM1);
    if (!box) this.clr(A2Q2, QFLAG.CUSTOM2);
    if (!amulet) this.clr(A2Q2, QFLAG.ENTERAREA);
  }

  /** 출처: ACT2Q3_Callback13_PlayerStartedGame */
  private startedQ3(): void {
    const d = this.Q(A2Q3);
    if (this.done(A2Q3)) {
      this.h.global.set(A2Q3, QFLAG.PRIMARYGOALDONE);
      return;
    }
    if (!this.has(A2Q3, QFLAG.STARTED)) return;
    this.iterate(A2Q3, 1);
    if (!d.state) d.state = 1;
    this.taintedSunBegin();
    if (this.has(A2Q3, QFLAG.ENTERAREA)) [d.lastState, d.state] = [2, 3];
    else if (this.has(A2Q3, QFLAG.LEAVETOWN)) [d.lastState, d.state] = [2, 2];
    else [d.lastState, d.state] = [1, 1];
  }

  /** 출처: ACT2Q4_Callback13_PlayerStartedGame */
  private startedQ4(): void {
    const d = this.Q(A2Q4), x = this.q4;
    if (this.has(A2Q3, QFLAG.REWARDGRANTED)) x.palaceOpen = true;
    if (this.done(A2Q4)) {
      this.h.global.set(A2Q4, QFLAG.PRIMARYGOALDONE);
      x.palaceOpen = true;
      return;
    }
    if (this.item('hst')) [d.lastState, d.state] = [1, 1];
    if (this.has(A2Q4, QFLAG.CUSTOM1)) [d.lastState, d.state] = [4, 4];
    else if (this.has(A2Q4, QFLAG.ENTERAREA)) [d.lastState, d.state] = [3, 4];
    else if (this.has(A2Q4, QFLAG.LEAVETOWN)) [d.lastState, d.state] = [3, 3];
    else if (this.has(A2Q4, QFLAG.STARTED)) [d.lastState, d.state] = [2, 2];
    else if (!this.has(A2Q2, QFLAG.REWARDGRANTED)) return;
    x.palaceOpen = true;
  }

  /** 출처: ACT2Q5_Callback13_PlayerStartedGame */
  private startedQ5(): void {
    const d = this.Q(A2Q5);
    if (this.has(A2Q5, QFLAG.REWARDGRANTED) || this.has(A2Q5, QFLAG.COMPLETEDBEFORE)) return;
    if (this.has(A2Q5, QFLAG.STARTED)) [d.lastState, d.state] = [2, 1];
  }

  /** 출처: ACT2Q6_Callback13_PlayerStartedGame */
  private startedQ6(): void {
    const d = this.Q(A2Q6), x = this.q6;
    this.clr(A2Q2, QFLAG.CUSTOM5);
    if (this.has(A2Q2, QFLAG.REWARDGRANTED)) {
      x.lairPortalNeedsToOpen = true;
      x.objectsNeedUpdate = true;
    }
    if (this.has(A2Q6, QFLAG.REWARDGRANTED) || this.has(A2Q6, QFLAG.COMPLETEDBEFORE)) x.rewardedBefore = true;
    else if (this.has(A2Q6, QFLAG.STARTED)) [d.lastState, d.state] = [1, 2];
    else if (this.has(A2Q6, QFLAG.LEAVETOWN)) [d.lastState, d.state] = [5, 5];
    else if (this.has(A2Q6, QFLAG.ENTERAREA)) [d.lastState, d.state] = [6, 5];
  }

  /**
   * 퀘스트 차례 (SeqCallback). 출처: ACT2Q1 (→ 13 A2Q6), ACT2Q6 (fState 1 → A2Q3), ACT2Q3 (끝나면 → A2Q4), ACT2Q4 (fState 1 → A2Q6)
   * 원작 코드는 pQuestData->pfSeqFilter(pQuest) — 다음 퀘스트의 SeqCallback 을 부르는 것으로 읽었다
   */
  private seq(w: number): boolean {
    const d = this.Q(w);
    switch (w) {
      case A2Q1:
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(A2Q6);
      case A2Q6:
        if (!d.state && d.notIntro) d.state = 1;
        return this.seq(A2Q3);
      case A2Q3:
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(A2Q4);
      case A2Q4:
        if (d.state || !d.notIntro) return true;
        d.state = 1;
        this.seq(A2Q6);
        return true;
    }
    return true;
  }

  // ------------------------------------------------------------ 상태 플래그

  /** 출처: ACT2Qn_UnitIterate_UpdateQuestStateFlags */
  private updateFlags(w: number): void {
    const d = this.Q(w);
    switch (w) {
      case A2Q1:
        if (this.done(A2Q1)) return;
        if (d.state === 2) this.set(A2Q1, QFLAG.STARTED);
        else if (d.state === 3) this.set(A2Q1, d.lastState === 1 ? QFLAG.LEAVETOWN : QFLAG.ENTERAREA);
        return;
      case A2Q3:
        if (this.done(A2Q3)) return;
        if (d.state >= 1) this.set(A2Q3, QFLAG.STARTED);
        if (d.state === 2) this.set(A2Q3, QFLAG.LEAVETOWN);
        else if (d.state === 3) this.set(A2Q3, QFLAG.ENTERAREA);
        return;
      case A2Q4:
        if (this.done(A2Q4)) return;
        if (d.state === 2) this.set(A2Q4, QFLAG.STARTED);
        else if (d.state === 3) this.set(A2Q4, QFLAG.LEAVETOWN);
        else if (d.state === 4) {
          if (d.lastState === 2 || d.lastState === 3) this.set(A2Q4, QFLAG.ENTERAREA);
          else if (d.lastState === 4) this.set(A2Q4, QFLAG.CUSTOM1);
        }
        return;
      case A2Q5:
        if (this.done(A2Q5)) return;
        if (d.state === 1) this.set(A2Q5, QFLAG.STARTED);
        return;
      case A2Q6:
        if (this.has(A2Q6, QFLAG.REWARDGRANTED)) return;
        if (d.state >= 2) this.set(A2Q6, QFLAG.STARTED);
        return;
    }
  }

  // ------------------------------------------------------------ NPC

  npcHasQuest(npc: string): boolean {
    return [A2Q6, A2Q5, A2Q4, A2Q3, A2Q2, A2Q1].some((w) => this.activeFilter(w, npc));
  }

  /** 출처: ACT2Qn_ActiveFilterCallback */
  private activeFilter(w: number, npc: string): boolean {
    const d = this.Q(w), G = QFLAG.REWARDGRANTED, P = QFLAG.REWARDPENDING;
    switch (w) {
      case A2Q1:
        if (npc !== 'atma' || this.has(A2Q1, G)) return false;
        return (d.notIntro && d.state === 1 && !this.has(A2Q1, QFLAG.COMPLETEDBEFORE)) || this.has(A2Q1, P);
      case A2Q2:
        return npc === 'cain2' && !this.has(A2Q2, P) && this.staffItems().ok;
      case A2Q3:
        if (this.has(A2Q3, G)) return false;
        if (this.has(A2Q3, P) && ['atma', 'warriv2', 'greiz', 'elzix', 'drognan', 'lysander', 'cain2', 'meshif1', 'geglash', 'jerhyn'].includes(npc)) return true;
        return npc === 'drognan' && d.state === 1;
      case A2Q4:
        if (this.has(A2Q4, G)) return false;
        if (npc === 'act2guard2') {
          if (this.has(A2Q4, P)) return false;
          // 근사(원작 미확인): 하렘 막이(오브젝트 318) 모드 대신 궁전이 열렸는지로 판단
          return this.q4.palaceOpen ? !this.has(A2Q4, QFLAG.CUSTOM4) : !this.has(A2Q4, QFLAG.CUSTOM3);
        }
        if (npc === 'drognan') return d.state === 1 && !this.has(A2Q4, P);
        if (npc === 'jerhyn') return d.state === 2 && !this.has(A2Q4, P);
        return false;
      case A2Q5:
        return ['atma', 'warriv2', 'elzix', 'drognan', 'lysander', 'cain2', 'meshif1', 'jerhyn', 'geglash', 'fara'].includes(npc) && this.has(A2Q5, P);
      case A2Q6: {
        if (npc === 'jerhyn') {
          if (this.has(A2Q6, G)) return false;
          return (d.state === 1 && !this.has(A2Q6, QFLAG.LEAVETOWN) && !this.has(A2Q6, QFLAG.ENTERAREA)) || this.has(A2Q6, QFLAG.LEAVETOWN);
        }
        if (npc === 'meshif1') return this.has(A2Q6, QFLAG.ENTERAREA);
        if (npc === 'tyrael1') return d.notIntro && this.q6.durielKilled && !this.q6.portalToTown;
        if (!this.has(A2Q6, QFLAG.PRIMARYGOALDONE)) return false;
        const f = A2Q6_TOWN_FLAG[npc];
        return f !== undefined && !this.has(A2Q6, f);
      }
    }
    return false;
  }

  npcActivate(npc: string): QuestSpeech[] {
    const out: QuestSpeech[] = [];
    for (const w of [A2Q6, A2Q5, A2Q4, A2Q3, A2Q2, A2Q1]) this.npcActivateOne(w, npc, out);
    return out;
  }

  private npcActivateOne(w: number, npc: string, out: QuestSpeech[]): void {
    const d = this.Q(w), G = QFLAG.REWARDGRANTED, P = QFLAG.REWARDPENDING, PGD = QFLAG.PRIMARYGOALDONE;
    switch (w) {
      case A2Q1: { // 출처: ACT2Q1_Callback00_NpcActivate
        if (this.has(A2Q1, P)) return this.chain(w, 3, npc, out);
        if (d.guid) return this.chain(w, 4, npc, out);
        if (this.has(A2Q1, G)) return;
        if (!d.state || (d.state >= 4 && !this.has(A2Q1, PGD))) return;
        const i = [-1, 0, 1, 2, 3, 4, 0][d.state] ?? -1;
        if (i !== -1) this.chain(w, i, npc, out);
        return;
      }
      case A2Q2: { // 출처: ACT2Q2_Callback00_NpcActivate
        if (npc !== 'cain2') return;
        if (this.has(A2Q2, P)) return this.chain(w, 4, npc, out);
        const r = this.staffItems();
        if (r.ok && r.data !== -1) return this.chain(w, r.data, npc, out);
        if (d.guid) return this.chain(w, 5, npc, out);
        // 원작 그대로: REWARDGRANTED 면 (PGD 와 상관없이) 끝
        if (this.has(A2Q2, G)) return;
        let t = r.data;
        if (t === -1) {
          if (!this.has(A2Q2, QFLAG.LEAVETOWN)) return;
          t = 6;
        }
        return this.chain(w, t, npc, out);
      }
      case A2Q3: { // 출처: ACT2Q3_Callback00_NpcActivate
        if (this.has(A2Q3, P)) return this.chain(w, 3, npc, out);
        if (this.has(A2Q3, QFLAG.COMPLETEDNOW)) return;
        if (d.guid) return this.chain(w, 4, npc, out);
        if (d.state && d.notIntro && !this.has(A2Q3, G) && d.state < 4) {
          const i = [-1, 0, 1, 2, 3, 0][d.state] ?? -1;
          if (i !== -1) this.chain(w, i, npc, out);
        }
        return;
      }
      case A2Q4: { // 출처: ACT2Q4_Callback00_NpcActivate
        if (npc === 'act2guard2') {
          // 궁전이 열렸으면 187~189 중 하나 (QUESTS_GetGlobalSeed), 아니면 186 "You may not pass."
          return this.chain(w, this.q4.palaceOpen ? (this.h.seed.roll() >>> 0) % 3 + 8 : 7, npc, out);
        }
        if (this.has(A2Q4, P)) return this.chain(w, 4, npc, out);
        if (d.guid) return this.chain(w, 5, npc, out);
        if (d.state && d.notIntro && !this.has(A2Q4, G) && (d.state < 5 || this.has(A2Q4, PGD))) {
          const i = [-1, 0, 1, 2, 3, 4, 0, 0][d.state] ?? -1;
          if (i !== -1) this.chain(w, i, npc, out);
        }
        return;
      }
      case A2Q5: { // 출처: ACT2Q5_Callback00_NpcActivate
        if (this.has(A2Q5, P)) return this.chain(w, 1, npc, out);
        if (d.guid) return this.chain(w, 2, npc, out);
        if (!d.notIntro || !d.state) return;
        if (this.has(A2Q5, G) && !this.has(A2Q5, PGD)) return;
        if (d.state >= 2 && !this.has(A2Q5, PGD)) return;
        const i = [-1, 0, 1, 2][d.state] ?? -1;
        if (i !== -1) this.chain(w, i, npc, out);
        return;
      }
      case A2Q6: { // 출처: ACT2Q6_Callback00_NpcActivate
        if (npc === 'tyrael1') {
          if (this.q6.doorMode === OBJMODE.OPENED) this.chain(w, 2, npc, out);
          return;
        }
        if (this.has(A2Q6, PGD)) {
          const f = A2Q6_TOWN_FLAG[npc];
          if (f !== undefined && !this.has(A2Q6, f)) return this.chain(w, 6, npc, out);
        }
        if (this.has(A2Q6, QFLAG.LEAVETOWN)) return this.chain(w, 3, npc, out);
        if (this.has(A2Q6, QFLAG.ENTERAREA)) return this.chain(w, npc === 'meshif1' ? 5 : 4, npc, out);
        if (d.guid) return this.chain(w, 4, npc, out);
        if (!d.state) return;
        if (this.has(A2Q6, G) && !this.has(A2Q6, PGD)) return;
        if (d.state >= 4 && !this.has(A2Q6, PGD)) return;
        const i = [-1, 0, 1, 2, 3, 4][d.state] ?? -1;
        if (i === 1 && npc === 'drognan') {
          if (!this.h.global.get(A2Q4, PGD)) this.chain(w, i, npc, out);
        } else if (i !== -1) this.chain(w, i, npc, out);
        return;
      }
    }
  }

  /**
   * 출처: ACT2Q2_CheckItemsAndState — 호라드릭 조각을 가지고 있고 Cain 에게 아직 보여 주지 않았으면 ok (data = 대사 표 번호).
   * 이미 보여 준 조각이면 data 5~9 (메뉴로 다시 듣기), 아무것도 없으면 −1
   */
  private staffItems(): { ok: boolean; data: number } {
    let data = -1;
    if (this.item('hst')) return this.has(A2Q2, QFLAG.CUSTOM6) ? { ok: false, data: 5 } : { ok: true, data: 4 };
    if (this.item('box')) {
      if (!this.has(A2Q2, QFLAG.CUSTOM2)) return { ok: true, data: 3 };
      data = 9;
    }
    if (this.item('tr1')) {
      if (!this.has(A2Q2, QFLAG.LEAVETOWN)) return { ok: true, data: 0 };
      data = 6;
    }
    if (this.item('vip')) {
      if (!this.has(A2Q2, QFLAG.ENTERAREA)) return { ok: true, data: 1 };
      data = 7;
    }
    if (this.item('msf')) {
      if (!this.has(A2Q2, QFLAG.CUSTOM1)) return { ok: true, data: 2 };
      data = 8;
    }
    return { ok: false, data };
  }

  scrollMessage(npc: string, index: number): void {
    const P = QFLAG.REWARDPENDING, G = QFLAG.REWARDGRANTED, PGD = QFLAG.PRIMARYGOALDONE;
    // A2Q1 (출처: ACT2Q1_Callback11_ScrollMessage)
    if (npc === 'atma') {
      const d = this.Q(A2Q1);
      if (index === 304) {
        this.q1.atmaActivated = true;
        d.state = 2;
        this.updateFlags(A2Q1);
      } else if (index === 334 && this.has(A2Q1, P)) {
        if (this.has(A2Q1, PGD)) {
          if (d.state !== 5) {
            this.iterate(A2Q1, 13);
            this.q1.atmaActivated = false;
            d.state = 5;
            this.seq(A2Q1);
          }
          if (!d.notIntro) this.h.global.set(A2Q1, PGD);
        } else if (this.q1.rewardPending) this.seq(A2Q6);
        this.set(A2Q1, G);
        this.clr(A2Q1, P);
        d.guid = true;
      }
    }
    // A2Q2 (출처: ACT2Q2_Callback11_ScrollMessage)
    if (npc === 'cain2') {
      if (index === 335) {
        this.h.deleteItem('tr1');
        this.set(A2Q2, QFLAG.LEAVETOWN);
      } else if (index === 336) {
        this.set(A2Q2, QFLAG.ENTERAREA);
        this.set(A2Q2, QFLAG.LEAVETOWN);
      } else if (index === 337) {
        this.set(A2Q2, QFLAG.CUSTOM1);
        this.set(A2Q2, QFLAG.LEAVETOWN);
      } else if (index === 338) {
        this.set(A2Q2, QFLAG.CUSTOM2);
        this.set(A2Q2, QFLAG.LEAVETOWN);
      } else if (index === 339) {
        this.clr(A2Q2, P);
        for (const f of [QFLAG.LEAVETOWN, QFLAG.CUSTOM6, QFLAG.ENTERAREA, QFLAG.CUSTOM2, QFLAG.CUSTOM1]) this.set(A2Q2, f);
        this.Q(A2Q2).guid = true;
      }
      if (index >= 335 && index <= 339) this.h.emit({ type: 'questUpdate', quest: A2Q2, act: this.act, status: this.status(A2Q2) });
    }
    // A2Q3 (출처: ACT2Q3_Callback11_ScrollMessage)
    const d3 = this.Q(A2Q3);
    if (index === 348 && npc === 'drognan' && d3.notIntro) {
      if (d3.lastState === 1) this.iterate(A2Q3, 2, false);
      if (d3.state === 1) {
        d3.state = 2;
        this.updateFlags(A2Q3);
      }
    } else if (index > 361 && index <= 372) {
      if (d3.state !== 5 && d3.notIntro && this.has(A2Q3, PGD)) {
        this.iterate(A2Q3, 13, false);
        d3.state = 5;
        this.seq(A2Q3);
      }
      if (this.has(A2Q3, P)) {
        this.set(A2Q3, G);
        this.clr(A2Q3, P);
        d3.guid = true;
        if (!d3.notIntro) this.h.global.set(A2Q3, PGD);
      }
    }
    // A2Q4 (출처: ACT2Q4_Callback11_ScrollMessage)
    const d4 = this.Q(A2Q4), x4 = this.q4;
    if (npc === 'act2guard2') {
      if (index === 186) this.set(A2Q4, QFLAG.CUSTOM3);
      else if (index > 186 && index <= 189) this.set(A2Q4, QFLAG.CUSTOM4);
    } else {
      if ([406, 403, 397, 400, 398, 399, 405, 407, 402, 401, 404].includes(index) && this.has(A2Q4, P)) {
        this.clr(A2Q4, P);
        d4.guid = true;
      }
      if (index === HORAZON_JOURNAL_MESSAGE.index) {
        if (d4.notIntro && d4.lastState < 5) this.iterate(A2Q4, 5, false);
        this.openCanyonPortal();
      }
      if (npc === 'drognan' && index === 373) {
        d4.state = 2;
        x4.drognanActivated = true;
        this.openPalace();
        this.updateFlags(A2Q4);
      } else if (npc === 'jerhyn' && index === 377) {
        d4.state = 3;
        this.iterate(A2Q4, 3);
        this.updateFlags(A2Q4);
      }
    }
    // A2Q5 (출처: ACT2Q5_Callback11_ScrollMessage)
    if (index >= 419 && index <= 429 && this.has(A2Q5, P)) {
      const d = this.Q(A2Q5);
      if (this.has(A2Q5, PGD)) {
        this.iterate(A2Q5, 13);
        this.h.global.set(A2Q5, PGD);
        d.state = 3;
      }
      d.guid = true;
      this.set(A2Q5, G);
      this.clr(A2Q5, P);
    }
    // A2Q6 (출처: ACT2Q6_Callback11_ScrollMessage)
    this.scrollQ6(npc, index);
  }

  /** 출처: ACT2Q6_Callback11_ScrollMessage */
  private scrollQ6(npc: string, index: number): void {
    const d = this.Q(A2Q6), x = this.q6, PGD = QFLAG.PRIMARYGOALDONE;
    if (npc === 'tyrael1') {
      if (d.notIntro && index === 302 && !x.portalToTown) {
        // 출처: D2GAME_CreatePortalObject(…, LEVEL_LUTGHOLEIN, OBJECT_TOWN_PORTAL) — 플레이어 자리에 마을 포털
        this.h.townPortalAtPlayer();
        d.state = 4;
        // 출처: ACT2Q6_UnitIterate_SetLeaveTownFlag — 두리엘 방에 있는 플레이어
        if (!this.has(A2Q6, PGD) && !this.has(A2Q6, QFLAG.LEAVETOWN) && !this.has(A2Q6, QFLAG.ENTERAREA) && this.h.levelNo() === L2.DURIELSLAIR) {
          this.set(A2Q6, PGD);
          this.set(A2Q6, QFLAG.LEAVETOWN);
          this.h.progress(2);
          this.h.emit({ type: 'questCompleted', quest: A2Q6, act: this.act });
        }
        if (!this.has(A2Q6, QFLAG.REWARDGRANTED) && !this.has(A2Q6, QFLAG.LEAVETOWN) && !this.has(A2Q6, QFLAG.ENTERAREA)) this.set(A2Q6, QFLAG.COMPLETEDNOW);
        x.portalToTown = true;
        x.tyraelActivated = true;
      }
      return;
    }
    if (npc === 'jerhyn') {
      if (index === 430) {
        d.state = 2;
        x.initJerhyn = true;
        this.seq(A2Q3);
      } else if (index === 442 && this.has(A2Q6, QFLAG.LEAVETOWN)) {
        if (this.has(A2Q6, PGD)) d.state = 5;
        x.endJerhyn = true;
        this.set(A2Q6, QFLAG.ENTERAREA);
        this.clr(A2Q6, QFLAG.LEAVETOWN);
      }
      return;
    }
    if (npc === 'meshif1') {
      if (index === 450 && this.has(A2Q6, QFLAG.ENTERAREA)) {
        if (this.has(A2Q2, QFLAG.REWARDGRANTED)) for (const c of ['hst', 'vip', 'msf']) this.h.deleteItem(c);
        if (this.has(A2Q6, PGD)) {
          this.h.global.set(A2Q6, PGD);
          d.state = 5;
          this.iterate(A2Q6, 13);
        }
        this.set(A2Q6, QFLAG.REWARDGRANTED);
        this.clr(A2Q6, QFLAG.ENTERAREA);
        d.guid = true;
        this.h.emit({ type: 'questReward', quest: A2Q6, act: this.act, reward: 'sailEast' });
        // Kaelan 이 사라지고 Jerhyn 이 궁전 자리로 (OBJECTS_InitFunction19_JerhynPositionEx: A2Q6 PRIMARYGOALDONE)
        this.h.refreshTownNpcs();
      }
      return;
    }
    const f = ({ 445: QFLAG.CUSTOM2, 446: QFLAG.CUSTOM3, 449: QFLAG.CUSTOM4, 444: QFLAG.CUSTOM5, 452: QFLAG.CUSTOM6, 447: QFLAG.CUSTOM7 } as Record<number, number>)[index];
    if (f !== undefined) this.set(A2Q6, f);
  }

  /** 출처: ACT2Q4 ScrollMessage 373 — 궁전 열림 (하렘 막이 OBJMODE_OPENED), ACT2Q2_UpdateHoradricItemCounts 의 !bNotIntro 분기 */
  private openPalace(): void {
    if (this.q4.palaceOpen) return;
    this.q4.palaceOpen = true;
    this.h.emit({ type: 'palaceOpened' });
  }

  /**
   * 출처: ACT2Q4 ScrollMessage 396 — 일지 방에 있는 플레이어 자리 근처에 마기의 협곡으로 가는 붉은 포털 (OBJECT_PERMANENT_TOWN_PORTAL), 전역 A2Q4 PGD
   * 근사(원작 미확인): "플레이어가 일지와 같은 방" 대신 비전의 성역에 있으면
   */
  private openCanyonPortal(): void {
    const x = this.q4;
    if (x.portalToCanyon || this.h.levelNo() !== L2.ARCANE) return;
    const j = this.h.findObject(L2.ARCANE, OBJ2.JOURNAL);
    if (!j) return;
    if (this.h.openPortal(L2.ARCANE, Math.floor(j.x) + 2, Math.floor(j.y) + 2, L2.CANYON)) {
      x.portalToCanyon = true;
      this.h.global.set(A2Q4, QFLAG.PRIMARYGOALDONE);
    }
  }

  npcDeactivate(npc: string): void {
    // 출처: ACT2Q1_Callback02_NpcDeactivate
    if (npc === 'atma' && this.q1.atmaActivated) {
      this.iterate(A2Q1, 1);
      this.q1.atmaActivated = false;
    }
    // 출처: ACT2Q4_Callback02_NpcDeactivate
    if (npc === 'drognan' && this.q4.drognanActivated) {
      this.iterate(A2Q4, 2);
      this.q4.drognanActivated = false;
      this.updateFlags(A2Q4);
    }
    // 출처: ACT2Q6_Callback02_NpcDeactivate
    const x = this.q6;
    if (npc === 'tyrael1' && x.tyraelActivated) {
      this.iterate(A2Q6, 4);
      x.tyraelActivated = false;
    } else if (npc === 'jerhyn') {
      if (x.initJerhyn) {
        this.iterate(A2Q6, 1);
        x.initJerhyn = false;
      } else if (x.endJerhyn) {
        this.iterate(A2Q6, 6);
        x.endJerhyn = false;
      } else return;
      this.updateFlags(A2Q6);
    }
  }

  // ------------------------------------------------------------ 레벨 이동

  changeLevel(oldNo: number, newNo: number): void {
    this.changeLevelQ1(oldNo);
    if (oldNo === TOWN) this.Q(A2Q2).guid = false;
    this.changeLevelQ3(oldNo, newNo);
    this.changeLevelQ4(oldNo, newNo);
    if (oldNo === TOWN) this.Q(A2Q5).guid = false;
    this.changeLevelQ6(oldNo, newNo);
  }

  /** 출처: ACT2Q1_Callback03_ChangedLevel */
  private changeLevelQ1(oldNo: number): void {
    const d = this.Q(A2Q1);
    if (oldNo !== TOWN) return;
    d.guid = false;
    if (d.state !== 2 || this.done(A2Q1)) return;
    d.state = 3;
    this.updateFlags(A2Q1);
  }

  /** 출처: ACT2Q3_Callback03_ChangedLevel */
  private changeLevelQ3(oldNo: number, newNo: number): void {
    const d = this.Q(A2Q3), x = this.q3;
    if ((newNo === L2.LOSTCITY || newNo === L2.VALLEYOFSNAKES) && !d.state && d.notIntro && !x.darkenTimer) {
      x.darkenTimer = true;
      this.timer((this.h.seed.roll() & 1) + 15, () => this.darken());
    }
    if (newNo === TOWN && x.blackened) {
      this.iterate(A2Q3, 1);
      if (!d.state) d.state = 1;
      this.taintedSunBegin();
      this.updateFlags(A2Q3);
      x.blackened = false;
    }
    if (oldNo === TOWN) {
      d.guid = false;
      if (d.state === 2) d.state = 3;
    }
  }

  /** 출처: ACT2Q3_DarkenEnvironment */
  private darken(): boolean {
    const d = this.Q(A2Q3), x = this.q3;
    x.darkenTimer = false;
    if (x.dark || x.altarDestroyed) return true;
    this.iterate(A2Q3, 1);
    if (!d.state) d.state = 1;
    this.taintedSunBegin();
    this.updateFlags(A2Q3);
    return true;
  }

  /**
   * 출처: ENVIRONMENT_TaintedSunBegin (Act 2 환경을 일식으로) + 패킷 0x53 (클라이언트 조명).
   * 일식 주기·밝기는 Game.updateEnvironment 가 이 상태(taintedSun)를 보고 Act 2 Environment 에 건다
   */
  private taintedSunBegin(): void {
    if (this.q3.dark) return;
    this.q3.dark = true;
    this.h.emit({ type: 'taintedSun', dark: true });
  }

  /** 출처: ACT2Q4_Callback03_ChangedLevel */
  private changeLevelQ4(oldNo: number, newNo: number): void {
    const d = this.Q(A2Q4);
    if (newNo === L2.ARCANE) {
      if (d.state < 4) d.state = 4;
      if (d.lastState < 4) this.iterate(A2Q4, 4);
      this.updateFlags(A2Q4);
      return;
    }
    if (newNo === L2.HAREM1) {
      this.set(A2Q4, QFLAG.CUSTOM4);
      this.set(A2Q4, QFLAG.CUSTOM3);
    }
    if (oldNo === TOWN) {
      d.guid = false;
      if (!this.done(A2Q4) && d.state === 3) {
        d.state = 4;
        this.updateFlags(A2Q4);
      }
    }
  }

  /** 출처: ACT2Q6_Callback03_ChangedLevel */
  private changeLevelQ6(oldNo: number, newNo: number): void {
    const d = this.Q(A2Q6), x = this.q6;
    if (newNo < TOWN || newNo >= L2.KURASTDOCKS) return;
    if (oldNo === TOWN) d.guid = false;
    if (!d.notIntro) return;
    const toState2 = (send: boolean): void => {
      d.state = 2;
      if (d.lastState <= 1) this.iterate(A2Q6, 2, send);
      this.updateFlags(A2Q6);
    };
    if (x.durielKilled) {
      if (newNo === L2.DURIELSLAIR && d.state <= 1) toState2(false);
      return;
    }
    const tomb = this.staffTomb();
    if (tomb && newNo === tomb) {
      if (d.state !== 2) toState2(false);
      return;
    }
    if (newNo === L2.CANYON) {
      if (!d.state) {
        d.state = 2;
        this.updateFlags(A2Q6);
      }
      if (!d.lastState) this.iterate(A2Q6, 1);
      return;
    }
    if (newNo === L2.DURIELSLAIR && d.state <= 1) toState2(false);
  }

  /** 진짜 탈 라샤 무덤 (오리피스가 있는 무덤, 원작 DUNGEON_GetHoradricStaffTombLevelId) */
  private staffTomb(): number {
    for (let n: number = L2.TOMB1; n <= L2.TOMB7; n++) if (this.h.findObject(n, OBJ2.ORIFICE)) return n;
    return 0;
  }

  // ------------------------------------------------------------ 몬스터

  monsterKilled(k: ActsKill): void {
    if (k.typeId === 'radament') this.killedRadament(k);
    if (k.typeId === 'summoner') this.killedSummoner(k);
    if (k.typeId === 'duriel') this.killedDuriel(k);
  }

  /** 출처: ACT2Q1_Callback08_MonsterKilled */
  private killedRadament(k: ActsKill): void {
    const d = this.Q(A2Q1), x = this.q1;
    if (!d.notIntro) return;
    d.state = 4;
    this.h.global.set(A2Q1, QFLAG.PRIMARYGOALDONE);
    // 출처: ACT2Q1_UnitIterate_SetPrimaryGoalDoneForPartyMembers — Radament 와 같은 방이나 이웃 방
    if (k.playerNear && !this.done(A2Q1)) {
      this.set(A2Q1, QFLAG.PRIMARYGOALDONE);
      this.set(A2Q1, QFLAG.REWARDPENDING);
      this.set(A2Q1, QFLAG.CUSTOM1);
    }
    if (!this.done(A2Q1)) this.set(A2Q1, QFLAG.COMPLETEDNOW);
    // 출처: ACT2Q1_UnitIterate_DetermineSkillBookDropCount — CUSTOM1 이고 책이 없으면 1권, PGD 면 소리 50
    const books = this.has(A2Q1, QFLAG.CUSTOM1) && !this.item('ass') ? 1 : 0;
    if (this.has(A2Q1, QFLAG.PRIMARYGOALDONE)) this.h.emit({ type: 'questCompleted', quest: A2Q1, act: this.act });
    if (!x.timer) {
      x.timer = true;
      this.timer(12, () => {
        if (d.state === 4) this.iterate(A2Q1, 3);
        x.timer = false;
        return true;
      });
    }
    for (let i = 0; i < books; i++) this.h.dropAt('ass', k.x, k.y, QUALITY.NORMAL);
  }

  /** 출처: ACT2Q5_Callback08_MonsterKilled */
  private killedSummoner(k: ActsKill): void {
    const d = this.Q(A2Q5), x = this.q5;
    if (d.notIntro) {
      d.state = 2;
      x.killed = true;
      x.timer = 0;
      // 출처: ACT2Q5_Timer_StatusCycler — 3 틱마다: 처음엔 완료 소리(51), 다음엔 로그 4
      this.timer(3, () => {
        if (x.timer) {
          this.iterate(A2Q5, 4);
          return true;
        }
        x.timer = 1;
        if (this.has(A2Q5, QFLAG.PRIMARYGOALDONE) && this.h.levelNo() === L2.ARCANE) this.h.emit({ type: 'questCompleted', quest: A2Q5, act: this.act });
        return false;
      });
      if (k.playerNear && !this.done(A2Q5)) {
        this.set(A2Q5, QFLAG.PRIMARYGOALDONE);
        this.set(A2Q5, QFLAG.REWARDPENDING);
      }
      // 출처: ACT2Q4_UnitIterate_SetPrimaryGoalDoneForPartyMembers — 비전의 성역에 있으면 A2Q4 도 끝
      if (this.h.levelNo() === L2.ARCANE) this.arcaneGoalDone();
      if (!this.done(A2Q5)) this.set(A2Q5, QFLAG.COMPLETEDNOW);
    }
    this.h.emit({ type: 'questFx', fx: 7 });
  }

  /** 출처: ACT2Q4_UnitIterate_SetPrimaryGoalDoneForPartyMembers */
  private arcaneGoalDone(): void {
    if (this.done(A2Q4)) return;
    for (const f of [QFLAG.PRIMARYGOALDONE, QFLAG.REWARDPENDING, QFLAG.REWARDGRANTED]) this.set(A2Q4, f);
    this.h.record.resetIntermediate(A2Q4);
    this.set(A2Q4, QFLAG.CUSTOM4);
    this.set(A2Q4, QFLAG.CUSTOM3);
  }

  /** 출처: ACT2Q6_Callback08_MonsterKilled — Tyrael 의 문이 열린다 */
  private killedDuriel(k: ActsKill): void {
    const d = this.Q(A2Q6), x = this.q6;
    if (d.notIntro) {
      d.state = 3;
      this.timer(8, () => {
        if (d.lastState !== 5 && d.lastState !== 4 && d.lastState !== 3) this.iterate(A2Q6, 3);
        return true;
      });
      const free = !this.has(A2Q6, QFLAG.REWARDGRANTED) && !this.has(A2Q6, QFLAG.LEAVETOWN) && !this.has(A2Q6, QFLAG.ENTERAREA) && !this.has(A2Q6, QFLAG.CUSTOM1);
      // 출처: 죽인 플레이어 + ACT2Q6_UnitIterate_SetCustom1FlagForPartyMembers (두리엘 방에 있는 플레이어)
      if (free && (k.byPlayer || this.h.levelNo() === L2.DURIELSLAIR)) this.set(A2Q6, QFLAG.CUSTOM1);
    }
    x.durielKilled = true;
    this.h.emit({ type: 'questFx', fx: 8 });
    const door = this.h.findObject(L2.DURIELSLAIR, OBJ2.TYRAEL_DOOR);
    if (door) this.h.setObjectMode(door, OBJMODE.OPERATING, true);
    x.doorMode = OBJMODE.OPENED;
  }

  /** 보스가 깨어남 (bossActivated): Radament (ACT2Q1_OnRadamentActivated), Summoner (ACT2Q5_OnSummonerActivated) */
  override gameEvent(ev: { type: string; [k: string]: unknown }): void {
    if (ev.type === 'bossActivated' && ev.typeId === 'radament') this.radamentActivated();
    else if (ev.type === 'bossActivated' && ev.typeId === 'summoner') this.summonerActivated();
    else if (ev.type === 'cubeQuestItem' && ev.code === 'hst') this.staffCubed();
  }

  /** 출처: ACT2Q1_OnRadamentActivated */
  private radamentActivated(): void {
    const d = this.Q(A2Q1), x = this.q1;
    if (!d.notIntro || (d.state >= 3 && d.lastState >= 2)) return;
    if (this.h.levelNo() !== L2.SEWERS3) return;
    x.atmaActivated = false;
    let ret = true;
    if (d.state < 3) {
      ret = false;
      d.state = 3;
    }
    if (d.lastState >= 2) {
      if (ret) return;
    } else {
      this.iterate(A2Q1, 2, !x.iterated);
      x.iterated = true;
    }
    this.updateFlags(A2Q1);
  }

  /** 출처: ACT2Q5_OnSummonerActivated */
  private summonerActivated(): void {
    const d = this.Q(A2Q5);
    if (!d.notIntro) return;
    if (!d.state) d.state = 1;
    if (d.lastState < 2) {
      this.iterate(A2Q5, 2);
      this.updateFlags(A2Q5);
    }
  }

  /** 출처: ACT2Q2_UpdateHoradricItemCounts (큐브로 호라드릭 지팡이를 만듦) */
  private staffCubed(): void {
    this.q2.staffCubed = true;
    this.set(A2Q2, QFLAG.CUSTOM7);
    this.h.emit({ type: 'questUpdate', quest: A2Q2, act: this.act, status: this.status(A2Q2) });
    const d4 = this.Q(A2Q4);
    if (d4.notIntro) {
      if (!d4.state) d4.state = 1;
      if (!d4.lastState) this.iterate(A2Q4, 1);
    } else {
      this.openPalace();
      this.updateFlags(A2Q4);
    }
  }

  /** 막 이동 (QUESTS_ActChange_HirelingChangeAct): Warriv → A1COMPLETED, Meshif → A2COMPLETED (A2Q2 보상 받음, 지팡이 조각 지움) */
  override actChanged(from: number, to: number): void {
    if (from === 0 && to === 1 && !this.has(QW.A1COMPLETED, QFLAG.REWARDGRANTED)) {
      this.set(QW.A1COMPLETED, QFLAG.REWARDGRANTED);
      this.set(QW.A1COMPLETED, QFLAG.PRIMARYGOALDONE);
    }
    if (from === 1 && to === 2 && !this.has(QW.A2COMPLETED, QFLAG.REWARDGRANTED)) {
      if (!this.has(A2Q2, QFLAG.REWARDGRANTED)) {
        this.set(A2Q2, QFLAG.REWARDGRANTED);
        this.set(A2Q2, QFLAG.PRIMARYGOALDONE);
        this.h.deleteItem('msf');
        this.h.deleteItem('vip');
      }
      this.set(QW.A2COMPLETED, QFLAG.REWARDGRANTED);
      this.set(QW.A2COMPLETED, QFLAG.PRIMARYGOALDONE);
    }
  }

  /**
   * Book of Skill (ass): 스킬 포인트 +1, A2Q1 CUSTOM1 지움 (다음 게임에 퀘스트가 되돌아가지 않게).
   * 근사(원작 미확인): 원작 사용 처리(D2Game 아이템 사용 코드)의 위치 미확인 — 결과(스킬 포인트 1)는 원작 동작
   */
  override useItem(code: string): boolean {
    if (code !== 'ass') return false;
    this.h.addSkillPoints(1);
    this.clr(A2Q1, QFLAG.CUSTOM1);
    this.h.emit({ type: 'questReward', quest: A2Q1, act: this.act, reward: 'skillPoint', amount: 1 });
    return true;
  }

  itemPickedUp(code: string): void {
    // 출처: ACT2Q2_Callback04_ItemPickedUp — 로그 상태 다시
    const d = this.Q(A2Q2);
    const shown = (): boolean => (!this.has(A2Q2, QFLAG.REWARDGRANTED) && !this.has(A2Q2, QFLAG.COMPLETEDBEFORE)) || this.has(A2Q2, QFLAG.PRIMARYGOALDONE) || this.has(A2Q2, QFLAG.COMPLETEDNOW);
    if (code === 'tr1' && !this.has(A2Q2, QFLAG.LEAVETOWN)) d.lastState = 1;
    else if (code === 'vip' || code === 'box' || code === 'msf') d.lastState = this.has(A2Q2, QFLAG.LEAVETOWN) ? 2 : 6;
    else return;
    if (shown()) this.h.emit({ type: 'questUpdate', quest: A2Q2, act: this.act, status: this.status(A2Q2) });
  }

  /** 출처: ACT2Q2_Callback05_ItemDropped */
  override itemDropped(code: string): void {
    if (code === 'vip') this.clr(A2Q2, QFLAG.ENTERAREA);
    if (code === 'box') this.clr(A2Q2, QFLAG.CUSTOM2);
    if (code === 'msf') this.clr(A2Q2, QFLAG.CUSTOM1);
  }

  // ------------------------------------------------------------ 오브젝트

  /** 출처: objects.txt InitFn 21 HoradricOrifice, 38 TyraelsDoor */
  initObject(o: ObjectUnit): void {
    const x = this.q6, d = this.Q(A2Q6);
    if (o.type.initFn === 21) {
      // 출처: OBJECTS_InitFunction21_HoradricOrifice
      x.orifice = o;
      if (x.lairPortalNeedsToOpen && !x.timerActive && !x.tombOpen) {
        this.timer(1, () => this.updateTombObjects());
        x.timerActive = true;
        this.h.setObjectMode(o, OBJMODE.OPENED);
      } else if (x.tombOpen) this.h.setObjectMode(o, OBJMODE.OPENED);
    } else if (o.type.initFn === 38) {
      // 출처: OBJECTS_InitFunction38_TyraelsDoor
      this.h.setObjectMode(o, d.notIntro ? x.doorMode : OBJMODE.OPENED);
    }
  }

  /**
   * 퀘스트 오브젝트 조작 (objects.txt OperateFn 24 TaintedSunAltar, 25 StaffOrifice, 39 HoradricCubeChest, 40 HoradricScrollChest,
   * 41 StaffOfKingsChest, 42 SanctuaryTome, 43 Duriel's Lair 포털). 처리했으면 true
   */
  operate(o: ObjectUnit): boolean {
    switch (o.type.operateFn) {
      case 24: this.opAltar(o); return true;
      case 25: this.opOrifice(o); return true;
      case 39: this.opQuestChest(o, 'box'); return true;
      case 40: this.opQuestChest(o, 'tr1'); return true;
      case 41: this.opQuestChest(o, 'msf'); return true;
      case 42: this.opJournal(o); return true;
      case 43: this.opLairPortal(o); return true;
    }
    return false;
  }

  /**
   * 출처: OBJECTS_OperateFunction39_HoradricCubeChest / 40_HoradricScrollChest / 41_StaffOfKingsChest —
   *   QUESTS_SetObjectSelection(상자 열기), 퀘스트 아이템 (큐브: 큐브가 없으면 / 두루마리: A2Q2 보상 전·Cain 에게 보이기 전 / 왕의 지팡이: 보상 전·조각이 없으면, 유니크·감정됨),
   *   상자 TC 매직 1번, 금화 5~9 무더기 (QUESTS_GetGlobalSeed)
   * 근사(원작 미확인): 두루마리 tr1 은 원작 ITEMQUAL_UNIQUE 로 떨어뜨리지만 UniqueItems 행이 없어 보통 품질로
   */
  private opQuestChest(o: ObjectUnit, code: 'box' | 'tr1' | 'msf'): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    let n = 0;
    if (code === 'box') n = this.item('box') ? 0 : 1;
    else if (code === 'tr1') n = this.has(A2Q2, QFLAG.REWARDGRANTED) || this.has(A2Q2, QFLAG.LEAVETOWN) ? 0 : 1;
    else n = this.has(A2Q2, QFLAG.REWARDGRANTED) || this.item('msf') || this.item('hst') ? 0 : 1;
    for (let i = 0; i < n; i++) this.h.dropAt(code, o.x, o.y, code === 'msf' ? QUALITY.UNIQUE : QUALITY.NORMAL);
    this.h.dropChestTc(o, QUALITY.MAGIC);
    this.dropGold(o);
  }

  /** 금화 5~9 무더기 (OBJMODE_DropItemWithCodeAndQuality('gld')) */
  private dropGold(o: ObjectUnit): void {
    const n = ((this.h.seed.roll() >>> 0) % 5) + 5;
    for (let i = 0; i < n; i++) this.h.dropAt('gld', o.x, o.y, QUALITY.NORMAL);
  }

  /** 출처: A2Q3.cpp OBJECTS_OperateFunction24_TaintedSunAltar */
  private opAltar(o: ObjectUnit): void {
    const d = this.Q(A2Q3), x = this.q3;
    if ((this.has(A2Q3, QFLAG.REWARDPENDING) || this.has(A2Q3, QFLAG.REWARDGRANTED)) &&
      (this.has(A2Q2, QFLAG.REWARDGRANTED) || this.item('vip') || this.item('hst'))) {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    x.altarDestroyed = true;
    // 출처: ACT2Q3_UnitIterate_DetermineViperAmuletDropCount — 부적·지팡이가 없고 A2Q2 보상 전이면 1
    const amulets = this.item('vip') || this.item('hst') || this.has(A2Q2, QFLAG.REWARDGRANTED) ? 0 : 1;
    if (d.notIntro) {
      // 출처: ENVIRONMENT_TaintedSunEnd
      if (x.dark) {
        x.dark = false;
        this.h.emit({ type: 'taintedSun', dark: false });
      }
      d.state = 4;
      this.h.emit({ type: 'questFx', fx: 6 });
      if (!this.has(A2Q3, QFLAG.REWARDGRANTED)) {
        this.set(A2Q3, QFLAG.REWARDPENDING);
        this.set(A2Q3, QFLAG.PRIMARYGOALDONE);
        this.clr(A2Q3, QFLAG.COMPLETEDNOW);
      }
      if (this.has(A2Q3, QFLAG.PRIMARYGOALDONE)) this.h.emit({ type: 'questCompleted', quest: A2Q3, act: this.act });
      this.h.global.set(A2Q3, QFLAG.PRIMARYGOALDONE);
    }
    for (let i = 0; i < amulets; i++) this.h.dropAt('vip', o.x, o.y, QUALITY.UNIQUE);
    this.h.dropChestTc(o, QUALITY.MAGIC);
    this.dropGold(o);
    if (!d.notIntro) return;
    if (!this.done(A2Q3)) this.set(A2Q3, QFLAG.COMPLETEDNOW);
    this.timer(10, () => {
      if (d.state === 4) this.iterate(A2Q3, 3);
      return true;
    });
  }

  /** 출처: A2Q4.cpp OBJECTS_OperateFunction42_SanctuaryTome */
  private opJournal(o: ObjectUnit): void {
    if (o.mode === OBJMODE.NEUTRAL) this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    const d = this.Q(A2Q4);
    // QUESTS_SendScrollMessage(…, 396) → 클라이언트가 두루마리를 띄우고 396 을 돌려보낸다
    this.h.emit({ type: 'questScroll', quest: A2Q4, act: this.act, key: HORAZON_JOURNAL_MESSAGE.key, objectId: o.id });
    this.scrollMessage('', HORAZON_JOURNAL_MESSAGE.index);
    if (!d.notIntro || d.state === 5) return;
    d.state = 5;
    // 출처: ACT2Q4_UnitIterate_SetPrimaryGoalDoneForPartyMembers (비전의 성역에 있는 플레이어)
    if (this.h.levelNo() === L2.ARCANE) this.arcaneGoalDone();
    if (!this.done(A2Q4)) this.set(A2Q4, QFLAG.COMPLETEDNOW);
  }

  /**
   * 출처: A2Q6.cpp OBJECTS_OperateFunction25_StaffOrifice → (클라이언트가 지팡이를 꽂는 창) → ACT2Q6_DeleteAllHoradricItemsAndOpenTomb
   * 근사(원작 미확인): 지팡이를 꽂는 창(패킷 0x58 → 아이템 놓기) 없이, 호라드릭 지팡이를 가지고 조작하면 바로 꽂는다
   */
  private opOrifice(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) {
      if (o.mode === OBJMODE.OPERATING) this.h.setObjectMode(o, OBJMODE.OPENED);
      return;
    }
    if (!this.item('hst')) {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    this.set(A2Q2, QFLAG.REWARDGRANTED);
    this.set(A2Q2, QFLAG.PRIMARYGOALDONE);
    for (const c of ['hst', 'vip', 'msf']) this.h.deleteItem(c);
    this.h.emit({ type: 'questFx', fx: 3 });
    this.h.emit({ type: 'staffPlaced', objectId: o.id });
    const x = this.q6;
    x.orifice = o;
    x.objectsNeedUpdate = true;
    x.staffItemsRemoved = true;
    if (!x.timerActive) {
      this.timer(ORIFICE_TICKS, () => this.updateTombObjects());
      x.timerActive = true;
    }
    this.h.setObjectMode(o, OBJMODE.OPERATING);
  }

  /** 출처: ACT2Q6_Timer_UpdateObjects — 오리피스 (−13, +3) 에 두리엘 방 포털 (오브젝트 100) */
  private updateTombObjects(): boolean {
    const x = this.q6;
    if (!x.objectsNeedUpdate) {
      x.timerActive = false;
      return true;
    }
    const o = x.orifice;
    if (!o) return false;
    const tomb = this.staffTomb() || this.h.levelNo();
    const portal = this.h.createObject(tomb, OBJ2.DURIEL_PORTAL, Math.floor(o.x) - 13, Math.floor(o.y) + 3, x.lairPortalNeedsToOpen ? OBJMODE.OPENED : OBJMODE.OPERATING);
    if (!portal) return false;
    if (!x.lairPortalNeedsToOpen) this.h.setObjectMode(portal, OBJMODE.OPERATING, true);
    x.tombOpen = true;
    x.objectsNeedUpdate = false;
    x.timerActive = false;
    this.h.emit({ type: 'tombOpened', objectId: portal.id });
    return true;
  }

  /** 두리엘 방 포털 (objects.txt 100, OperateFn 43): 두리엘 방으로. 출처: QUESTS_LevelWarpCheck(LEVEL_DURIELSLAIR) = ACT2Q6_IsDurielsLairClosed */
  private opLairPortal(o: ObjectUnit): void {
    if (o.type.id !== OBJ2.DURIEL_PORTAL) return;
    if (this.Q(A2Q6).notIntro && !this.q6.tombOpen) return;
    this.h.warpToLevel(L2.DURIELSLAIR);
  }

  /** 출처: QUESTS_LevelWarpCheck — 두리엘 방 (ACT2Q6_IsDurielsLairClosed) */
  override exitBlocked(_from: number, to: number): boolean {
    if (to === L2.DURIELSLAIR) return this.Q(A2Q6).notIntro && !this.q6.tombOpen;
    // 근사(원작 미확인): 원작은 하렘 막이(오브젝트 318)·Kaelan AI 가 길을 막는다 — 여기서는 궁전이 열리기 전 마을 → 하렘 1층 출구를 막는다
    if (_from === TOWN && to === L2.HAREM1) return !this.q4.palaceOpen;
    return false;
  }

  // ------------------------------------------------------------ 퀘스트 로그

  /** StatusFilter (A2Q2·A2Q6) */
  protected override statusFilter(w: number): number | undefined {
    if (w === A2Q2) return this.statusQ2();
    if (w === A2Q6) return this.statusQ6();
    return undefined;
  }

  /** 출처: ACT2Q2_StatusFilterCallback */
  private statusQ2(): number {
    const has = (f: number) => this.has(A2Q2, f);
    if (!this.has(QW.A1COMPLETED, QFLAG.REWARDGRANTED)) return 0;
    if (has(QFLAG.REWARDGRANTED) || has(QFLAG.REWARDPENDING)) {
      if (this.has(A2Q6, QFLAG.REWARDGRANTED)) return has(QFLAG.PRIMARYGOALDONE) ? 13 : 11;
      return has(QFLAG.CUSTOM6) ? 5 : 6;
    }
    const staff = this.item('msf'), box = this.item('box'), amulet = this.item('vip'), cubed = this.item('hst'), scroll = this.item('tr1');
    if (!staff || !box || !amulet) {
      if (cubed) return has(QFLAG.CUSTOM6) ? 5 : 6;
      if (scroll && !has(QFLAG.LEAVETOWN)) return 1;
      if (has(QFLAG.LEAVETOWN)) return 2;
      if (amulet || staff || box) return 4;
      return 0;
    }
    if (has(QFLAG.CUSTOM2)) return 3;
    return has(QFLAG.LEAVETOWN) ? 2 : 4;
  }

  /** 출처: ACT2Q6_StatusFilterCallback */
  private statusQ6(): number {
    const d = this.Q(A2Q6);
    if (!this.has(QW.A1COMPLETED, QFLAG.REWARDGRANTED)) return 0;
    if (this.has(A2Q6, QFLAG.REWARDGRANTED)) return 0;
    if (this.has(A2Q6, QFLAG.LEAVETOWN)) return 5;
    if (this.has(A2Q6, QFLAG.ENTERAREA)) return 6;
    if (!d.notIntro) return 0;
    if (this.has(A2Q6, QFLAG.CUSTOM1)) return d.lastState;
    if (d.state < 3) return d.lastState;
    return 12;
  }
}

/** A2Q6 이 끝난 뒤 마을 NPC 가 한 번 하는 말 (CUSTOM2~7). 출처: ACT2Q6_ActiveFilterCallback / NpcActivate */
const A2Q6_TOWN_FLAG: Record<string, number> = {
  atma: QFLAG.CUSTOM2, warriv2: QFLAG.CUSTOM3, drognan: QFLAG.CUSTOM4, lysander: QFLAG.CUSTOM5, cain2: QFLAG.CUSTOM6, fara: QFLAG.CUSTOM7,
};
