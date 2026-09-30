// Act 1 퀘스트 6개 상태 기계 (Den of Evil · Sisters' Burial Grounds · Tools of the Trade · The Search for Cain · The Forgotten Tower · Sisters to the Slaughter).
// 출처: D2MOO D2Game/src/QUESTS/ACT1/A1Q1.cpp ~ A1Q6.cpp (콜백: NpcActivate / NpcDeactivate / ChangedLevel / MonsterKilled / ScrollMessage /
//       ItemPickedUp / PlayerStartedGame, SeqCallback, ActiveFilter, StatusFilter, 오브젝트 Operate/Init 함수)
//       D2Game/src/QUESTS/Quests.cpp (QUESTS_SequenceCycler, QUESTS_RefreshStatus, QUESTS_UnitIterate, QUESTS_CreateTimer/QuestUpdater,
//       QUESTS_GUIDUpdate, QUESTS_ObjectEvents — Wirt 시체 금화·Cain 감옥)
//       D2Game/src/OBJECTS/ObjMode.cpp (OBJECTS_OperateFunction33_WirtsBody, sub_6FC75EB0 탑 상자)
//       D2Game/src/MISSILES/MissMode.cpp (SrvDo17_CairnStones — 트리스트럼 포털, SrvDo18_TowerChestSpawner — Countess 금화)
// (https://github.com/ThePhrozenKeep/D2MOO)
// 싱글플레이: 파티·다른 플레이어 GUID 목록은 "플레이어가 목록에 있음" 불리언 하나로 줄였다.
import type { GameEvent } from '../game';
import { OBJMODE, type ObjectUnit } from '../objects';
import type { Rng } from '../rng';
import { LEVEL } from '../drlg/types';
import { QUALITY } from '../treasure';
import { QFLAG, QUEST, type QuestRecord } from './record';
import { NPC_MESSAGES, TOWER_TOME_MESSAGE, type NpcMessage } from './messages';

/** 퀘스트가 게임에 요청하는 것 (엔진 Game 이 구현) */
export interface QuestHost {
  /** 플레이어 퀘스트 기록 (현재 난이도) */
  readonly record: QuestRecord;
  /** 게임 전역 퀘스트 기록 (pQuestControl->pQuestFlags) */
  readonly global: QuestRecord;
  /** 원작 QUESTS_GetGlobalSeed */
  readonly seed: Rng;
  playerLevel(): number;
  /** 플레이어가 있는 레벨 번호 (levels.txt Id) */
  levelNo(): number;
  /** ITEMS_FindQuestItem (인벤토리·창고·커서) */
  hasItem(code: string): boolean;
  /** QUESTS_DeleteItem */
  deleteItem(code: string): boolean;
  /** QUESTS_CreateItem (플레이어에게: 인벤토리 → 자리가 없으면 발밑) */
  giveItem(code: string, ilvl: number, quality: number): boolean;
  /** D2GAME_DropItemAtUnit (오브젝트·몬스터 자리, 아이템 레벨 = 레벨 몬스터 레벨) */
  dropAt(code: string, x: number, y: number, quality?: number): boolean;
  /** 상자 TC 드롭 (OBJMODE_DropFromChestTCWithQuality) */
  dropChestTc(o: ObjectUnit, quality: number): void;
  addSkillPoints(n: number): void;
  /** D2GAME_NPC_AssignMercenary */
  assignMercenary(npc: string): void;
  /** 레벨의 살아 있는 몬스터 수 (원작 MonRegion dwMonSpawnCount − dwMonKillCount) */
  aliveMonsters(levelNo: number): number;
  /** 오브젝트 모드 바꾸기 (endAnim = 작동 애니메이션이 끝나면 열림) */
  setObjectMode(o: ObjectUnit, mode: number, endAnim?: boolean): void;
  /** Cain(cain1) 을 트리스트럼 감옥 옆에 */
  spawnCainTristram(x: number, y: number): boolean;
  /** 트리스트럼 Cain 을 없애고 마을에 Cain(cain5) */
  moveCainToTown(): void;
  /** 붉은 영구 포털 한 쌍 (오브젝트 60): 레벨 levelNo 의 (x, y) ↔ 도착 레벨 */
  openPortal(levelNo: number, x: number, y: number, toLevelNo: number): boolean;
  /** 플레이어 자리에 마을 포털 (Andariel 처치 뒤) */
  townPortalAtPlayer(): void;
  emit(ev: GameEvent): void;
}

/** 원작 D2QuestDataStrc 에서 쓰는 칸 */
class QuestData {
  notIntro = true;
  active = true;
  state = 0;
  lastState = 0;
  flags = 0;
  /** tPlayerGUIDs 에 플레이어가 있음 */
  guid = false;
  constructor(readonly no: number, readonly initNo: number) {}
}

interface Timer { quest: number; at: number; timeout: number; fn: () => boolean }

/** NPC 대사 한 줄 (NpcActivate 결과) */
export interface QuestSpeech extends NpcMessage { quest: number }

/** 퀘스트 로그 한 줄 */
export interface QuestLogEntry {
  quest: number;
  /** 상태 바이트 (QUESTS_RefreshStatus / StatusFilter) */
  status: number;
  icon: 'none' | 'active' | 'done';
  /** Den of Evil 남은 몬스터 */
  count: number;
  /** 이번 게임에서 끝남 (완료 애니메이션) */
  justDone: boolean;
}

/** 퀘스트 로그 순서 (원작 화면: 3개 × 2줄) */
export const QUEST_LOG_ORDER = [QUEST.DEN, QUEST.BLOODRAVEN, QUEST.CAIN, QUEST.COUNTESS, QUEST.MALUS, QUEST.ANDARIEL] as const;

const TOWN = LEVEL.ROGUEENCAMPMENT;
const STONES = [17, 18, 19, 20, 21] as const;
const STONE_LAMBDA = 21;
const SKILLS_CHIPPED = ['gcv', 'gcr', 'gcb', 'gcy', 'gcg', 'gcw', 'skc'];
const SKILLS_GEMS = ['gsv', 'gsr', 'gsb', 'gsy', 'gsg', 'gsw', 'sku'];

/**
 * Act 1 퀘스트 제어 (원작 pGame->pQuestControl 의 Act 1 부분).
 * 출처: Quests.cpp gpQuestInitTable — 1 Den(InitNo 4, Seq 2), 2 BloodRaven(4, 4), 3 Malus(5, 6), 4 Cain(6, 3), 5 Countess(4, 3), 6 Andariel(4, 37)
 */
export class Act1Quests {
  /** 막 번호 (quests/index.ts ActQuestModule) */
  readonly act = 0;
  private readonly q: Record<number, QuestData> = {
    1: new QuestData(1, 4), 2: new QuestData(2, 4), 3: new QuestData(3, 5), 4: new QuestData(4, 6), 5: new QuestData(5, 4), 6: new QuestData(6, 4),
  };
  private readonly timers: Timer[] = [];
  private tick = 0;
  // A1Q1 (D2Act1Quest1Strc)
  private q1 = { akaraActivated: false, timerActive: false, monstersLeft: 0, denGuid: false, killedOff: false };
  // A1Q2 (D2Act1Quest2Strc)
  private q2 = { kashyaActivated: false, killed: false };
  // A1Q3 (D2Act1Quest3Strc)
  private q3 = { malusInit: false, charsiIntro: false, charsiEnd: false, malusObj: null as ObjectUnit | null, malusObjMode: 0, malusItems: 0, startingHas: false, charsiGuid: false, levelOff: false };
  // A1Q4 (D2Act1Quest4Strc)
  private q4 = {
    order: [0, 0, 0, 0, 0], cur: 0, stoneObjs: [] as (ObjectUnit | undefined)[], invisible: null as ObjectUnit | null, interactions: 0,
    tree: null as ObjectUnit | null, gibbet: null as ObjectUnit | null, gibbetMode: 0 as number, alpha: null as ObjectUnit | null,
    openPortalTimer: false, portalOpened: false, treeInit: false, cageModeChanged: false, ordered: false, unk4C: false, activateCairn: false,
    deciphered: false, lastStone: false, unk50: false, cainInTown: false, unk52: false, akaraIntro: false, unk58: 0, cairnActive: [false, false, false, false, false],
    questCompleteBefore: false, akaraScroll: false, guidQuest: false, guidTp: false, scrollAcquired: false, scrolls: 0, wirtInit: false, wirtGold: 0,
    cainSpawned: false,
  };
  // A1Q5 (D2Act1Quest5Strc)
  private q5 = { tomeActivated: false, triggerSeq: false, countessKilled: false, unit1: false, unit2: false, chests: [] as ObjectUnit[], deathMissiles: false };
  // A1Q6 (D2Act1Quest6Strc)
  private q6 = { guid1: false, guid2: false, guid3: false, cainActivated: false, killed: false, timerInv: 0 };

  constructor(private readonly h: QuestHost) {
    // 출처: InitQuestData — A1Q1 은 처음부터 fState 1, 나머지 0
    (this.q[1] as QuestData).state = 1;
  }

  private Q(n: number): QuestData {
    return this.q[n] as QuestData;
  }
  private has(q: number, f: number): boolean {
    return this.h.record.get(q, f);
  }
  private set(q: number, f: number): void {
    this.h.record.set(q, f);
  }
  private clr(q: number, f: number): void {
    this.h.record.clear(q, f);
  }
  private done(q: number): boolean {
    return this.has(q, QFLAG.REWARDGRANTED) || this.has(q, QFLAG.REWARDPENDING);
  }

  /** QUESTS_UnitIterate: fLastState = 상태, bIterate 면 퀘스트 로그 갱신 (QUESTS_StatusCyclerEx → 패킷 0x5D) */
  private iterate(q: number, state: number, send = true): void {
    const d = this.Q(q);
    d.lastState = state;
    if (send) this.h.emit({ type: 'questUpdate', quest: q, status: this.status(q), ...(d.flags & 0x20 ? { show: true } : {}) });
  }

  private timer(q: number, ticks: number, fn: () => boolean): void {
    this.timers.push({ quest: q, at: this.tick + ticks, timeout: ticks, fn });
  }

  /** 출처: QUESTS_QuestUpdater — 틱마다, 시각이 지난 타이머 실행 (true 면 제거, 아니면 timeout 뒤 다시) */
  update(): void {
    this.tick++;
    for (const t of [...this.timers]) {
      if (t.at >= this.tick) continue;
      if (t.fn()) this.timers.splice(this.timers.indexOf(t), 1);
      else t.at = this.tick + t.timeout;
    }
  }

  // ------------------------------------------------------------ 게임 시작

  /**
   * 출처: QUESTS_SequenceCycler(bGameEnter = 0) — 싱글플레이(byte_6FD31270): 보상을 받았거나 전에 끝낸 퀘스트는 bNotIntro·bActive = 0,
   *       PLAYERSTARTEDGAME 콜백으로 진행 상태 복원, A1Q1 SeqCallback 으로 다음 퀘스트 활성
   */
  startGame(): void {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      if (this.has(n, QFLAG.REWARDGRANTED) || this.has(n, QFLAG.COMPLETEDBEFORE)) {
        const d = this.Q(n);
        d.notIntro = false;
        d.active = false;
        d.lastState = 0;
        this.h.global.set(n, QFLAG.COMPLETEDBEFORE);
      }
    }
    for (const n of [6, 5, 4, 3, 2, 1]) this.startedGame(n);
    this.seq(1);
  }

  /** 출처: ACT1Qn_Callback13_PlayerStartedGame */
  private startedGame(n: number): void {
    const d = this.Q(n);
    if (n === 3 && this.h.hasItem('hdm')) {
      this.q3.startingHas = true;
      this.q3.malusItems++;
    }
    if (n === 4) return this.startedGameQ4();
    if (this.has(n, QFLAG.REWARDGRANTED) || this.has(n, QFLAG.COMPLETEDBEFORE)) return;
    if (n === 3) {
      if (this.has(n, QFLAG.STARTED)) [d.state, d.lastState] = [2, 1];
      else if (this.has(n, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [3, 1];
      return;
    }
    if (n === 5) {
      if (this.has(n, QFLAG.ENTERAREA)) [d.state, d.lastState] = [3, 1];
      else if (this.has(n, QFLAG.CUSTOM2)) [d.state, d.lastState] = [3, 4];
      else if (this.has(n, QFLAG.CUSTOM1)) [d.state, d.lastState] = [2, 3];
      else if (this.has(n, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [3, 1];
      else if (this.has(n, QFLAG.STARTED)) [d.state, d.lastState] = [2, 1];
      return;
    }
    if (this.has(n, QFLAG.ENTERAREA)) [d.state, d.lastState] = [3, 2];
    else if (this.has(n, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [3, 1];
    else if (this.has(n, QFLAG.STARTED)) [d.state, d.lastState] = [2, 1];
  }

  /** 출처: ACT1Q4_Callback13_PlayerStartedGame */
  private startedGameQ4(): void {
    const d = this.Q(4), x = this.q4;
    if (this.has(4, QFLAG.REWARDGRANTED)) {
      x.unk52 = true;
      this.h.global.set(4, QFLAG.PRIMARYGOALDONE);
      x.gibbetMode = OBJMODE.SPECIAL1;
      x.unk4C = true;
      x.activateCairn = true;
    } else if (this.has(4, QFLAG.COMPLETEDBEFORE)) {
      x.unk52 = true;
      x.questCompleteBefore = true;
      x.gibbetMode = OBJMODE.SPECIAL1;
      x.unk4C = true;
      x.activateCairn = true;
    } else if (this.has(4, QFLAG.ENTERAREA)) {
      [d.lastState, d.state] = [4, 5];
      x.unk4C = true;
      x.deciphered = true;
      x.activateCairn = true;
      x.scrollAcquired = true;
      x.unk58 = 1;
    } else if (this.has(4, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [3, 1];
    else if (this.has(4, QFLAG.STARTED)) [d.state, d.lastState] = [2, 1];
    const bkd = this.h.hasItem('bkd'), bks = this.h.hasItem('bks');
    if (bkd) x.scrolls++;
    if (bks) x.scrolls++;
    if (bkd) {
      [d.state, d.lastState] = [5, 3];
      x.deciphered = true;
      x.scrollAcquired = true;
      x.unk58 = 1;
    } else if (bks) {
      x.scrollAcquired = true;
      [d.state, d.lastState] = [4, 2];
      x.unk58 = 1;
    }
  }

  /**
   * 퀘스트 차례 (SeqCallback): 1 Den → 2 Blood Raven → 4 Cain → 3 Malus → 6 Andariel (→ 37 Act 2 소개: 범위 밖).
   * 5 Countess 는 책으로 시작하고, 끝나면 3 Malus 의 차례 함수를 부른다.
   */
  private seq(n: number): boolean {
    const d = this.Q(n);
    switch (n) {
      case 1:
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(2);
      case 2:
        if (!d.state && d.notIntro) {
          d.state = 1;
          return true;
        }
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(4);
      case 4:
        if (!d.state && d.notIntro) {
          d.state = 1;
          return true;
        }
        if (d.state !== 6 && d.notIntro) return true;
        return this.seq(3);
      case 3:
        if (!d.state && d.notIntro) {
          d.state = 1;
          return true;
        }
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(6);
      case 5:
        if (d.state < 2 && d.notIntro) return true;
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(3);
      case 6:
        // 출처: ACT1Q6_SeqCallback → 20 틱 뒤 ACT1Q6_Timer_StateDebug (fState 1)
        if (!d.state && d.notIntro) this.timer(6, 20, () => {
          if (!d.state) d.state = 1;
          return true;
        });
        // TODO(Act 2 범위 밖): 원작 nSeqId 37 = Act 2 소개 퀘스트
        return true;
    }
    return false;
  }

  // ------------------------------------------------------------ 상태 플래그

  /** 출처: ACT1Qn_UnitIterate_UpdateQuestStateFlags */
  private updateFlags(n: number): void {
    if (this.done(n)) return;
    const d = this.Q(n);
    if (n === 3) {
      if (d.state === 2) this.set(3, QFLAG.STARTED);
      else if (d.state === 3 || d.state === 4) this.set(3, QFLAG.LEAVETOWN);
      return;
    }
    if (n === 4) {
      if (d.state === 2) this.set(4, QFLAG.STARTED);
      else if (d.state >= 3 && d.state <= 5) this.set(4, QFLAG.LEAVETOWN);
      return;
    }
    if (n === 5) {
      if (d.state === 2) this.set(5, QFLAG.STARTED);
      else if (d.state === 3) {
        const f = ({ 1: QFLAG.LEAVETOWN, 2: QFLAG.ENTERAREA, 3: QFLAG.CUSTOM1, 4: QFLAG.CUSTOM2 } as Record<number, number>)[d.lastState];
        if (f !== undefined) this.set(5, f);
      }
      return;
    }
    if (d.state === 2) this.set(n, QFLAG.STARTED);
    else if (d.state === 3) this.set(n, d.lastState === 1 ? QFLAG.LEAVETOWN : QFLAG.ENTERAREA);
  }

  // ------------------------------------------------------------ NPC

  /** NPC 머리 위 퀘스트 표시 (QUESTS_ActiveCycler → pfActiveFilter) */
  npcHasQuest(npc: string): boolean {
    for (const n of [6, 5, 4, 3, 2, 1]) if (this.activeFilter(n, npc)) return true;
    return false;
  }

  private activeFilter(n: number, npc: string): boolean {
    const d = this.Q(n), G = QFLAG.REWARDGRANTED, P = QFLAG.REWARDPENDING;
    switch (n) {
      case 1:
        if (npc !== 'akara' || this.has(1, G)) return false;
        return (d.notIntro && d.state === 1 && !this.has(1, P)) || this.has(1, P);
      case 2:
        if (npc !== 'kashya' || this.has(2, G)) return false;
        return (d.state === 1 && !this.has(2, P)) || this.has(2, P);
      case 3:
        if (npc !== 'charsi' || this.has(3, G)) return false;
        return (d.state === 1 && !this.has(3, P)) || (this.h.playerLevel() >= 8 && this.h.hasItem('hdm'));
      case 4:
        if (npc === 'akara') {
          const free = !this.has(4, G) && !this.has(4, P);
          return (d.state === 4 && free && this.h.hasItem('bks')) || (d.state === 1 && free) ||
            (d.state === 6 && this.has(4, QFLAG.PRIMARYGOALDONE) && !this.has(4, G)) || this.has(4, P);
        }
        if (npc === 'cain5') return !this.q4.guidQuest && !this.q4.guidTp && this.has(4, QFLAG.PRIMARYGOALDONE);
        return false;
      case 5:
        return this.q5.unit2 && npc !== 'warriv1' && npc !== 'gheed';
      case 6:
        if (npc === 'cain5') return this.q6.guid1 || (!this.has(6, G) && d.state === 1 && !this.has(6, P));
        if (npc === 'warriv1') return !this.has(6, G) && this.has(6, P);
        if (npc === 'akara') return this.q6.guid2;
        if (npc === 'kashya') return this.q6.guid3;
        return false;
    }
    return false;
  }

  private chain(n: number, table: number, npc: string, out: QuestSpeech[]): void {
    for (const msg of NPC_MESSAGES[n]?.[table] ?? []) if (msg.npc === npc) out.push({ ...msg, quest: n });
  }

  /**
   * NPC 에게 말을 걸면 퀘스트 대사 목록 (QUESTS_NPCActivate → 퀘스트마다 Callback00_NpcActivate → QUESTS_InitScrollTextChain).
   * 근사(원작 미확인): 목록 순서 — 원작은 pLastQuest 부터 거꾸로(6 → 1) 도는 연결 목록, TEXT_AddNodeToTextList 가 넣는 위치 미확인
   */
  npcActivate(npc: string): QuestSpeech[] {
    const out: QuestSpeech[] = [];
    for (const n of [6, 5, 4, 3, 2, 1]) this.npcActivateOne(n, npc, out);
    return out;
  }

  private npcActivateOne(n: number, npc: string, out: QuestSpeech[]): void {
    const d = this.Q(n), G = QFLAG.REWARDGRANTED, P = QFLAG.REWARDPENDING, PGD = QFLAG.PRIMARYGOALDONE;
    const idx = [-1, 0, 1, 2, 3, 4, 5, 6];
    switch (n) {
      case 1: // 출처: ACT1Q1_Callback00_NpcActivate
        if (this.has(1, P)) return this.chain(1, 3, npc, out);
        if (d.guid) return this.chain(1, 4, npc, out);
        if (!this.has(1, G) && (d.state < 4 || this.has(1, PGD))) {
          if (!d.notIntro) return;
          const i = idx[d.state] ?? -1;
          if (i !== -1 && d.state <= 5) this.chain(1, i, npc, out);
        }
        return;
      case 2: // 출처: ACT1Q2_Callback00_NpcActivate
        if (this.has(2, P)) return this.chain(2, 3, npc, out);
        if (d.guid) return this.chain(2, 4, npc, out);
        if (d.state && !this.has(2, G) && d.state < 4) {
          const i = idx[d.state] ?? -1;
          if (i !== -1) this.chain(2, i, npc, out);
        }
        return;
      case 3: // 출처: ACT1Q3_Callback00_NpcActivate
        if (this.has(3, G) && !this.has(3, PGD)) return;
        if (this.h.hasItem('hdm')) {
          if (this.h.playerLevel() >= 8 && !this.has(3, G)) this.chain(3, 3, npc, out);
        } else if (!this.has(3, G)) {
          if (!d.state || d.state === 4) return;
          const i = idx[d.state] ?? -1;
          if (i !== -1 && d.state <= 5) this.chain(3, i, npc, out);
        }
        return;
      case 4:
        return this.npcActivateQ4(npc, out);
      case 5: { // 출처: ACT1Q5_Callback00_NpcActivate
        if (!d.notIntro) return;
        if (this.has(5, G) && !this.has(5, PGD)) return;
        const x = this.q5;
        if (d.state >= 4 && !x.unit2 && !x.unit1) return;
        if (x.unit2) return this.chain(5, 2, npc, out);
        if (!this.has(5, G) || !this.has(5, PGD)) {
          const i = [-1, -1, 0, 1, 2, 3][d.state] ?? -1;
          if (i !== -1) this.chain(5, i, npc, out);
        } else if (x.unit1) this.chain(5, 3, npc, out);
        return;
      }
      case 6: { // 출처: ACT1Q6_Callback00_NpcActivate
        const x = this.q6;
        if (npc === 'akara' && x.guid2) return this.chain(6, 3, 'akara', out);
        if (npc === 'kashya' && x.guid3) return this.chain(6, 3, 'kashya', out);
        if (npc === 'cain5' && x.guid1) return this.chain(6, 3, 'cain5', out);
        if (this.has(6, P)) return this.chain(6, npc === 'cain5' || npc === 'akara' || npc === 'kashya' ? 4 : 3, npc, out);
        if (d.guid) return this.chain(6, 4, npc, out);
        if (d.state !== 1 || npc !== 'cain5' || this.has(6, G)) {
          if (!d.state || (this.has(6, G) && !this.has(6, PGD))) return;
          if (d.state >= 4 && !this.has(6, PGD)) return;
          if (this.has(6, G) && this.has(6, PGD)) return;
          const i = idx[d.state] ?? -1;
          if (i !== -1 && d.state <= 5) this.chain(6, i, npc, out);
        } else this.chain(6, 0, 'cain5', out);
        return;
      }
    }
  }

  /** 출처: ACT1Q4_Callback00_NpcActivate */
  private npcActivateQ4(npc: string, out: QuestSpeech[]): void {
    const d = this.Q(4), x = this.q4, P = QFLAG.REWARDPENDING, PGD = QFLAG.PRIMARYGOALDONE;
    if (npc === 'cain1') this.chain(4, 9, 'cain1', out);
    if (x.lastStone && this.h.hasItem('bkd')) {
      this.h.deleteItem('bkd');
      x.scrolls--;
    }
    if (npc === 'cain5' && !x.guidTp && this.has(4, PGD)) return this.chain(4, 5, 'cain5', out);
    if (this.has(4, P)) {
      if (npc !== 'cain5') return this.chain(4, 5, npc, out);
      return this.chain(4, x.guidTp ? 7 : 5, 'cain5', out);
    }
    if (x.guidQuest) return this.chain(4, 6, npc, out);
    if (d.guid && npc === 'cain5' && !x.guidTp) return this.chain(4, 5, 'cain5', out);
    if (d.guid) {
      if (this.has(4, QFLAG.COMPLETEDNOW)) this.chain(4, 8, npc, out);
      else if (this.has(4, QFLAG.REWARDGRANTED)) this.chain(4, 7, npc, out);
      return;
    }
    if (this.has(4, QFLAG.COMPLETEDNOW) || !d.state || this.has(4, QFLAG.REWARDGRANTED) || this.has(4, QFLAG.COMPLETEDBEFORE)) return;
    if (this.h.hasItem('bks')) return this.chain(4, 3, npc, out);
    if (d.state === 4) this.chain(4, 2, npc, out);
    else if (d.state < 6) {
      const i = [-1, 0, 1, 2, 3, 4, 5, 6][d.state] ?? -1;
      if (i !== -1) this.chain(4, i, npc, out);
    }
  }

  /**
   * 대사가 재생됨 (클라이언트 → QUESTS_NPCMessage → Callback11_ScrollMessage). npc = monstats Id ('' = 오브젝트)
   */
  scrollMessage(npc: string, index: number): void {
    const P = QFLAG.REWARDPENDING, G = QFLAG.REWARDGRANTED, PGD = QFLAG.PRIMARYGOALDONE;
    const r = this.h.record;
    // A1Q1 (출처: ACT1Q1_Callback11_ScrollMessage)
    if (npc === 'akara' && index === 64) {
      this.q1.akaraActivated = true;
      this.Q(1).state = 2;
      this.updateFlags(1);
    } else if (npc === 'akara' && index === 76 && this.has(1, P)) {
      const d = this.Q(1);
      if (this.has(1, PGD) && d.state !== 5) {
        d.state = 5;
        this.seq(1);
        this.iterate(1, 13, false);
      }
      this.set(1, G);
      this.clr(1, P);
      r.resetIntermediate(1);
      this.h.addSkillPoints(1);
      d.guid = true;
      this.h.emit({ type: 'questReward', quest: 1, reward: 'skillPoint', amount: 1 });
    }
    // A1Q2 (출처: ACT1Q2_Callback11_ScrollMessage)
    if (npc === 'kashya' && index === 81) {
      this.q2.kashyaActivated = true;
      this.Q(2).state = 2;
      this.updateFlags(2);
    } else if (npc === 'kashya' && index === 92 && this.has(2, P)) {
      const d = this.Q(2);
      if (this.has(2, PGD) && d.state !== 5) {
        this.iterate(2, 13, false);
        d.state = 5;
        this.seq(2);
      }
      this.set(2, G);
      this.clr(2, P);
      d.guid = true;
      this.h.assignMercenary('kashya');
      this.h.emit({ type: 'questReward', quest: 2, reward: 'mercenary' });
    }
    // A1Q3 (출처: ACT1Q3_Callback11_ScrollMessage)
    if (npc === 'charsi' && index === 163 && !this.has(3, G)) {
      const d = this.Q(3), x = this.q3;
      x.charsiGuid = true;
      if (this.h.hasItem('hdm')) {
        this.set(3, PGD);
        this.set(3, P);
        this.h.deleteItem('hdm');
        x.malusItems--;
        this.h.emit({ type: 'questCompleted', quest: 3 });
        if (d.notIntro) {
          if (d.state === 4) {
            d.state = 5;
            x.charsiEnd = true;
            this.h.global.set(3, PGD);
            this.seq(3);
          } else if (x.startingHas) this.seq(6);
        }
      }
    } else if (npc === 'charsi' && index === 146) {
      this.Q(3).state = 2;
      this.q3.charsiIntro = true;
    }
    // A1Q4 (출처: ACT1Q4_Callback11_ScrollMessage)
    if (npc === 'akara') {
      const d = this.Q(4), x = this.q4;
      if (index === 97) {
        x.akaraIntro = true;
        d.state = 2;
      } else if (index === 112 && this.h.hasItem('bks')) {
        this.h.deleteItem('bks');
        if (this.h.giveItem('bkd', 0, QUALITY.NORMAL)) {
          x.akaraScroll = true;
          x.deciphered = true;
          d.state = 5;
          this.iterate(4, 3, false);
          this.h.emit({ type: 'questItemGiven', quest: 4, code: 'bkd' });
        } else x.scrolls--;
      } else if (index === 118 && this.has(4, P)) {
        this.set(4, G);
        this.clr(4, P);
        d.guid = true;
        // 출처: ACT1Q4 118 — 보통: 아이템 레벨 7 매직 반지, 악몽 30 레어, 지옥 60 레어 (QUESTS_CreateItem 'rin')
        this.h.giveItem('rin', 7, QUALITY.MAGIC);
        this.h.emit({ type: 'questReward', quest: 4, reward: 'ring' });
        if (this.has(4, PGD)) {
          d.lastState = 13;
          if (d.state !== 6) d.state = 6;
          if (!this.h.global.get(4, PGD)) {
            this.h.global.set(4, PGD);
            this.seq(4);
          }
        }
        if (x.questCompleteBefore) this.h.global.set(4, PGD);
        this.iterate(4, d.lastState);
      }
    } else if (npc === 'cain5') {
      if (index === 125) {
        this.Q(4).guid = true;
        this.q4.guidQuest = false;
      } else if (index === 126 || index === 123) this.q4.guidTp = true;
    }
    // A1Q5 (출처: ACT1Q5_Callback11_ScrollMessage)
    const d5 = this.Q(5), x5 = this.q5;
    if (index === TOWER_TOME_MESSAGE.index && d5.notIntro) {
      let v6 = false;
      if (x5.tomeActivated) {
        if (d5.lastState < 1) {
          v6 = true;
          this.iterate(5, 1);
        }
        if (d5.lastState === 3) {
          v6 = true;
          this.iterate(5, 2);
          if (d5.state < 3) d5.state = 3;
        }
      }
      if (d5.state < 2) {
        d5.state = 2;
        this.updateFlags(5);
      } else if (v6) this.updateFlags(5);
    }
    if (['charsi', 'kashya', 'cain5', 'warriv1', 'akara', 'gheed'].includes(npc) && index >= 140 && index <= 145) {
      if (this.has(5, PGD) && x5.triggerSeq) {
        x5.triggerSeq = false;
        d5.state = 5;
        this.seq(5);
      }
      if (x5.unit2) {
        x5.unit2 = false;
        x5.unit1 = true;
      }
    }
    // A1Q6 (출처: ACT1Q6_Callback11_ScrollMessage)
    const d6 = this.Q(6), x6 = this.q6;
    if (npc === 'cain5' && index === 166) {
      d6.state = 2;
      x6.cainActivated = true;
      this.updateFlags(6);
    } else if (npc === 'cain5' && index === 184) x6.guid1 = false;
    else if (npc === 'warriv1' && index === 183 && this.has(6, P)) {
      if (this.has(6, PGD)) {
        this.iterate(6, 13, false);
        d6.state = 5;
        this.h.global.set(6, PGD);
      }
      this.clr(6, P);
      this.set(6, G);
      d6.guid = true;
      this.h.emit({ type: 'questReward', quest: 6, reward: 'caravan' });
    } else if (npc === 'akara' && index === 179) x6.guid2 = false;
    else if (npc === 'kashya' && index === 181) x6.guid3 = false;
  }

  /** 대화 끝 (QUESTS_NPCDeactivate → Callback02_NpcDeactivate) */
  npcDeactivate(npc: string): void {
    if (npc === 'akara' && this.q1.akaraActivated) {
      this.Q(1).flags &= ~0xff;
      this.iterate(1, 1);
      this.q1.akaraActivated = false;
    }
    if (npc === 'kashya' && this.q2.kashyaActivated) {
      this.Q(2).flags &= ~0xff;
      this.iterate(2, 1);
      this.q2.kashyaActivated = false;
      this.updateFlags(2);
    }
    if (npc === 'charsi') {
      if (this.q3.charsiIntro) {
        this.updateFlags(3);
        this.iterate(3, 1);
        this.q3.charsiIntro = false;
      } else if (this.q3.charsiEnd) {
        this.iterate(3, 13);
        this.q3.charsiEnd = false;
      }
    }
    if (npc === 'akara') {
      const x = this.q4;
      if (x.akaraIntro) {
        this.iterate(4, 1);
        x.akaraIntro = false;
        this.updateFlags(4);
      }
      if (x.akaraScroll) {
        this.iterate(4, 3);
        this.updateFlags(4);
        x.akaraScroll = false;
      }
    }
    if (npc === 'cain1' && !this.q4.cainInTown) {
      // 근사(원작 미확인): 원작은 bCainInTristramDeactivated 뒤 Cain 포털(OBJECT_CAINPORTAL) 연출 → 마을 Cain 시작 자리(InitFunction54) 에 cain5.
      //   여기서는 대화를 닫는 즉시 트리스트럼 Cain 이 사라지고 마을에 Cain 이 선다
      this.q4.unk52 = true;
      this.q4.cainInTown = true;
      this.h.moveCainToTown();
    }
    if (npc === 'cain5' && this.q6.cainActivated) {
      this.iterate(6, 1);
      this.q6.cainActivated = false;
    }
  }

  /** Charsi 담금질 가능 (NPC_HandleDialogMessage — A1Q3 REWARDPENDING) */
  canImbue(): boolean {
    return this.has(3, QFLAG.REWARDPENDING);
  }

  /** 출처: ACT1Q3_SetRewardGranted (담금질 뒤) */
  imbueDone(): void {
    this.set(3, QFLAG.REWARDGRANTED);
    this.clr(3, QFLAG.REWARDPENDING);
    this.h.emit({ type: 'questReward', quest: 3, reward: 'imbue' });
    if (this.has(3, QFLAG.COMPLETEDBEFORE)) return;
    this.Q(3).active = false;
  }

  /** Warriv "Go East" 가능 (NPC_HandleDialogMessage WARRIV1 — A1Q6 REWARDGRANTED) */
  canGoEast(): boolean {
    return this.has(6, QFLAG.REWARDGRANTED);
  }

  /** 디버그·예전 저장: Cain 을 마을에 세운다 */
  forceCainInTown(): void {
    this.q4.unk52 = true;
  }

  /** 마을에 Cain (cain5) 이 서 있어야 함 */
  cainInTown(): boolean {
    return this.q4.unk52 || this.q4.cainInTown;
  }

  // ------------------------------------------------------------ 레벨 이동

  /** 출처: QUESTS_ChangeLevel → ACT1Qn_Callback03_ChangedLevel */
  changeLevel(oldNo: number, newNo: number): void {
    this.changeLevelQ1(oldNo, newNo);
    this.changeLevelQ2(oldNo, newNo);
    this.changeLevelQ3(oldNo);
    this.changeLevelQ4(oldNo, newNo);
    this.changeLevelQ5(oldNo, newNo);
    this.changeLevelQ6(oldNo, newNo);
  }

  private changeLevelQ1(oldNo: number, newNo: number): void {
    const d = this.Q(1);
    if (newNo === LEVEL.DENOFEVIL) {
      if (!d.notIntro) return;
      if (d.state === 1 || d.state === 2) d.state = 3;
      if (d.lastState >= 2) {
        // 원작 그대로: 위에서 fState 를 3 으로 바꾼 뒤라 여기서는 항상 빠져나간다
        if (d.state !== 1 && d.state !== 2) return;
      } else {
        d.flags &= ~0xff;
        this.iterate(1, 2);
      }
      this.updateFlags(1);
    } else if (oldNo === TOWN) {
      d.guid = false;
      if (d.state !== 2 || this.done(1)) return;
      d.state = 3;
      this.updateFlags(1);
      if (d.lastState === 1) return;
      d.flags &= ~0xff;
      this.iterate(1, 1);
    }
  }

  private changeLevelQ2(oldNo: number, newNo: number): void {
    const d = this.Q(2);
    if (newNo === LEVEL.BURIALGROUNDS && d.notIntro) {
      const upd = d.state < 3;
      if (upd) {
        d.state = 3;
        d.flags &= ~0xff;
      }
      if (d.lastState === 1 || !d.lastState) {
        this.iterate(2, 2);
        this.updateFlags(2);
        return;
      }
      if (upd) {
        this.updateFlags(2);
        return;
      }
    }
    if (oldNo === TOWN) {
      d.guid = false;
      if (d.state !== 2 || this.done(2)) return;
      d.state = 3;
      this.updateFlags(2);
    }
  }

  private changeLevelQ3(oldNo: number): void {
    const d = this.Q(3), x = this.q3;
    if (x.levelOff) return;
    if (!d.notIntro) {
      x.levelOff = true;
      return;
    }
    if (oldNo !== TOWN || d.state !== 2 || this.done(3)) return;
    if (d.lastState !== 1) this.iterate(3, 1);
    d.state = 3;
    this.updateFlags(3);
    x.levelOff = true;
  }

  private changeLevelQ4(oldNo: number, newNo: number): void {
    const d = this.Q(4), x = this.q4;
    if (newNo === LEVEL.TRISTRAM && !x.cainInTown && !x.unk50 && d.state >= 6) {
      d.state = 5;
      this.iterate(4, 4, false);
      this.updateFlags(4);
    }
    if (oldNo === TOWN) {
      d.guid = false;
      x.guidQuest = false;
      if (this.done(4)) return;
      if (d.state === 2) d.state = 3;
    }
  }

  private changeLevelQ5(oldNo: number, newNo: number): void {
    const d = this.Q(5), x = this.q5;
    if (!d.notIntro) return;
    if (newNo !== LEVEL.FORGOTTENTOWER) {
      if (newNo === LEVEL.TOWERCELLARLEV5) {
        if (d.state < 4 && d.lastState !== 2) {
          if (d.state !== 3) d.state = 3;
          d.flags &= ~0xff;
          this.iterate(5, 2);
          this.updateFlags(5);
        }
      } else if (oldNo === TOWN) {
        if (d.state === 2) {
          if (!this.has(5, QFLAG.REWARDGRANTED)) d.state = 3;
        } else if (d.state === 5) {
          if (x.unit1) x.unit1 = false;
          if (!x.unit1 && !x.unit2) d.active = false;
        }
      }
    } else if (!d.state) {
      d.state = 2;
      d.flags &= ~0xff;
      this.iterate(5, 3);
      this.updateFlags(5);
    } else if (d.state <= 3 && d.lastState === 1) {
      d.flags &= ~0xff;
      this.iterate(5, 4);
      this.updateFlags(5);
    }
  }

  private changeLevelQ6(oldNo: number, newNo: number): void {
    const d = this.Q(6);
    if (newNo >= LEVEL.CATACOMBSLEV1 && newNo <= LEVEL.CATACOMBSLEV4 && d.notIntro) {
      if (d.state < 3) d.state = 3;
      if (newNo === LEVEL.CATACOMBSLEV4) {
        if (d.lastState < 2) {
          d.flags &= ~0xff;
          this.iterate(6, 2);
          this.updateFlags(6);
          return;
        }
      } else if (!d.lastState) {
        d.flags &= ~0xff;
        this.iterate(6, 1, false);
        this.updateFlags(6);
        return;
      }
      // 원작 그대로: 바로 위에서 fState >= 3 이므로 여기서 끝난다
      return;
    }
    if (oldNo !== TOWN) return;
    d.guid = false;
    if (d.state !== 2 || this.done(6)) return;
    d.state = 3;
    this.updateFlags(6);
  }

  // ------------------------------------------------------------ 몬스터 처치

  /**
   * 퀘스트 몬스터가 죽음 (QUESTS_ParseKill → 몬스터의 퀘스트 연결 목록).
   * 연결: Den of Evil 레벨의 모든 몬스터 → A1Q1 (levels.txt Quest = 1, QUESTS_AttachLevelChainRecord),
   *       bloodraven → A1Q2, andariel → A1Q6 (MonsterSpawn.cpp), The Countess → A1Q5 (MonsterUnique.cpp)
   * @param byPlayer 플레이어(또는 소환수·용병)가 죽임 (pQuestArg->pPlayer)
   */
  monsterKilled(k: { levelNo: number; typeId: string; superUnique?: string; x: number; y: number; byPlayer: boolean; playerNear: boolean }): void {
    if (k.levelNo === LEVEL.DENOFEVIL) this.killedInDen(k.byPlayer);
    if (k.typeId === 'bloodraven') this.killedBloodRaven(k.playerNear);
    if (k.superUnique === 'The Countess') this.killedCountess();
    if (k.typeId === 'andariel') this.killedAndariel(k.byPlayer, k.x, k.y);
  }

  /** 출처: ACT1Q1_Callback08_MonsterKilled */
  private killedInDen(byPlayer: boolean): void {
    const d = this.Q(1), x = this.q1;
    if (!d.notIntro || x.killedOff) return;
    x.monstersLeft = this.h.aliveMonsters(LEVEL.DENOFEVIL);
    if (byPlayer) x.denGuid = true;
    // 근사(원작 미확인): 원작은 "레벨의 채워진 방 수 > 영역 기록" 도 본다 — 여기서는 레벨에 들어갈 때 모든 방을 한꺼번에 채운다
    if (x.monstersLeft !== 0) {
      if (x.monstersLeft > 5) {
        if (d.lastState === 4) {
          d.flags = 0x20;
          this.iterate(1, 4);
          this.h.emit({ type: 'questMessage', quest: 1, key: 'qstsa1q14', count: x.monstersLeft });
        }
      } else {
        d.flags = 0x20;
        this.iterate(1, 4);
        this.h.emit({ type: 'questMessage', quest: 1, key: x.monstersLeft === 1 ? 'qstsa1q140' : 'qstsa1q14', count: x.monstersLeft });
      }
      return;
    }
    x.killedOff = true;
    d.state = 4;
    this.h.global.set(1, QFLAG.PRIMARYGOALDONE);
    // 출처: QUESTS_GUIDUpdate — 굴에서 몬스터를 죽인 플레이어(pQuestGUID) 에게 PRIMARYGOALDONE + REWARDPENDING
    if (x.denGuid && !this.done(1)) {
      this.set(1, QFLAG.PRIMARYGOALDONE);
      this.set(1, QFLAG.REWARDPENDING);
    }
    // 출처: ACT1Q1_UnitIterate_SetCompletionFlag
    if (!this.done(1)) this.set(1, QFLAG.COMPLETEDNOW);
    // 출처: ACT1Q1_UnitIterate_AttachCompletionSound (소리 35), QUESTS_TriggerFX(0)
    if (this.has(1, QFLAG.PRIMARYGOALDONE)) this.h.emit({ type: 'questCompleted', quest: 1 });
    this.h.emit({ type: 'questFx', fx: 0 });
    if (!x.timerActive) {
      x.timerActive = true;
      this.timer(1, 8, () => {
        if (d.state === 4) {
          d.flags &= ~0xff;
          this.iterate(1, 5);
        }
        x.timerActive = false;
        return true;
      });
    }
  }

  /** 출처: ACT1Q2_Callback08_MonsterKilled */
  private killedBloodRaven(playerNear: boolean): void {
    const d = this.Q(2);
    if (!d.notIntro) return;
    d.state = 4;
    this.q2.killed = true;
    // 출처: ACT1Q2_UnitIterate_SetRewardPending — Blood Raven 과 같은 방이나 이웃 방에 있는 플레이어
    if (playerNear && !this.done(2)) {
      this.set(2, QFLAG.PRIMARYGOALDONE);
      this.set(2, QFLAG.REWARDPENDING);
    }
    if (!this.done(2)) this.set(2, QFLAG.COMPLETEDNOW);
    if (this.has(2, QFLAG.PRIMARYGOALDONE)) this.h.emit({ type: 'questCompleted', quest: 2 });
    this.timer(2, 15, () => {
      d.flags &= ~0xff;
      this.iterate(2, 3);
      return true;
    });
    this.h.global.set(2, QFLAG.PRIMARYGOALDONE);
  }

  /** 출처: ACT1Q5_Callback08_MonsterKilled (+ SpawnTowerChestMissiles) */
  private killedCountess(): void {
    const d = this.Q(5), x = this.q5;
    if (d.notIntro && !x.countessKilled) {
      d.state = 5;
      x.triggerSeq = true;
      // 출처: ACT1Q5_UnitIterate_AttachCompletionSound — 탑 지하 5층에 있으면 바로 보상(REWARDGRANTED), 아니면 COMPLETEDNOW
      if (!this.has(5, QFLAG.REWARDGRANTED)) {
        if (this.h.levelNo() !== LEVEL.TOWERCELLARLEV5) this.set(5, QFLAG.COMPLETEDNOW);
        else {
          this.set(5, QFLAG.PRIMARYGOALDONE);
          this.set(5, QFLAG.REWARDGRANTED);
          this.clr(5, QFLAG.REWARDPENDING);
          x.unit2 = true;
          this.h.emit({ type: 'questCompleted', quest: 5 });
        }
      }
      this.h.global.set(5, QFLAG.PRIMARYGOALDONE);
      if (!x.unit2) d.active = false;
      x.countessKilled = true;
      this.timer(5, 7, () => {
        if (d.state === 5) {
          d.flags &= ~0xff;
          this.iterate(5, 13);
        }
        return true;
      });
    }
    x.countessKilled = true;
    this.spawnTowerChestMissiles();
  }

  /**
   * 탑 상자 (objects 371, InitFunction47_CountessChest 가 기록): Countess 가 죽으면 towerchestspawner 미사일이
   * 250 틱 뒤 상자를 연다 — 상자 TC 매직 3번 + 생명 물약 2 + 마나 물약 2 (sub_6FC75EB0), 그 뒤 400 틱까지 8 틱마다 금화 한 무더기.
   * 출처: MissMode.cpp SrvDo18_TowerChestSpawner (missiles.txt 332: Range 400, Param1 150, Param2 2, Param3 5)
   */
  private spawnTowerChestMissiles(): void {
    const x = this.q5;
    if (!x.countessKilled || x.deathMissiles) return;
    for (const o of x.chests) {
      x.deathMissiles = true;
      const start = this.tick;
      let opened = false;
      this.timer(5, 1, () => {
        const f = this.tick - start;
        if (f >= 400 - 150 && !opened) {
          opened = true;
          if (o.mode === OBJMODE.NEUTRAL) {
            for (let i = 0; i < 3; i++) this.h.dropChestTc(o, QUALITY.MAGIC);
            // 출처: ITEMS_GetHealthPotionDropCode / GetManaPotionDropCode — Act 1 보통 = hp1 / mp1
            for (const c of ['hp1', 'hp1', 'mp1', 'mp1']) this.h.dropAt(c, o.x, o.y);
            this.h.setObjectMode(o, OBJMODE.OPERATING, true);
          }
        }
        if (opened && f % Math.max(4 * 2, 1) === 0) {
          const rx = o.x + (this.h.seed.pick(2 * 5 + 1) - 5), ry = o.y + (this.h.seed.pick(2 * 5 + 1) - 5);
          this.h.dropAt('gld', rx, ry);
        }
        return f >= 400;
      });
    }
  }

  /** 출처: ACT1Q6_Callback08_MonsterKilled */
  private killedAndariel(byPlayer: boolean, ax: number, ay: number): void {
    const d = this.Q(6), x = this.q6;
    if (x.killed) return;
    if (d.notIntro) {
      if (byPlayer && !this.done(6)) {
        this.set(6, QFLAG.PRIMARYGOALDONE);
        this.set(6, QFLAG.REWARDPENDING);
        // 출처: 깨진 보석 2개 + 보석 1개 (dwChippedGemCodes / dwNormalGemCodes, 퀘스트 시드)
        for (let i = 0; i < 2; i++) this.h.dropAt(SKILLS_CHIPPED[this.h.seed.roll() % SKILLS_CHIPPED.length] as string, ax, ay, QUALITY.NORMAL);
        this.h.dropAt(SKILLS_GEMS[this.h.seed.roll() % SKILLS_GEMS.length] as string, ax, ay, QUALITY.NORMAL);
      }
      // 출처: ACT1Q6_UnitIterate_SetRewardPending — Catacombs 4 에 있는 플레이어
      if (!this.has(6, QFLAG.REWARDGRANTED) && !this.has(6, QFLAG.COMPLETEDBEFORE) && this.h.levelNo() === LEVEL.CATACOMBSLEV4) {
        x.guid1 = x.guid2 = x.guid3 = true;
        this.set(6, QFLAG.PRIMARYGOALDONE);
        this.set(6, QFLAG.REWARDPENDING);
      }
      if (!this.done(6)) this.set(6, QFLAG.COMPLETEDNOW);
    }
    x.timerInv = 1;
    if (d.notIntro) {
      this.timer(6, 1, () => {
        x.timerInv++;
        if (x.timerInv === 10) {
          if (this.h.levelNo() === LEVEL.CATACOMBSLEV4) this.h.townPortalAtPlayer();
          return false;
        }
        if (x.timerInv !== 12) return false;
        if (d.lastState !== 3 && d.lastState !== 13) {
          d.flags &= ~0xff;
          this.iterate(6, 3);
        }
        return true;
      });
      if (this.has(6, QFLAG.REWARDPENDING) && this.has(6, QFLAG.PRIMARYGOALDONE)) this.h.emit({ type: 'questCompleted', quest: 6 });
    }
    x.killed = true;
    d.state = 4;
  }

  /** 아이템을 주움 (QUESTS_ItemPickedUp → 아이템의 퀘스트 연결: hdm → A1Q3, bks/bkd → A1Q4) */
  itemPickedUp(code: string): void {
    if (code === 'hdm') {
      // 출처: ACT1Q3_Callback04_ItemPickedUp — 처음 주우면 CUSTOM2 + 소리 36, 상태 2 (Charsi 에게 돌려주기)
      if (!this.has(3, QFLAG.CUSTOM2)) {
        this.set(3, QFLAG.CUSTOM2);
        this.h.emit({ type: 'questItem', quest: 3, code });
      }
      this.Q(3).flags &= ~0xff;
      this.iterate(3, 2);
    } else if (code === 'bks' || code === 'bkd') {
      // 출처: ACT1Q4_Callback04_ItemPickedUp
      if (this.Q(4).notIntro) this.updateFlags(4);
    }
  }

  // ------------------------------------------------------------ 오브젝트

  /** 오브젝트가 생길 때 (objects.txt InitFn: 4 TowerTome, 6 CairnStone, 7 CainGibbet, 9 InifussTree, 13 InvisibleObject, 15 MalusStand, 47 CountessChest) */
  initObject(o: ObjectUnit): void {
    const x4 = this.q4;
    switch (o.type.initFn) {
      case 4: // 출처: OBJECTS_InitFunction04_TowerTome
        if (!this.Q(5).notIntro) this.h.setObjectMode(o, OBJMODE.SPECIAL1);
        return;
      case 6: { // 출처: OBJECTS_InitFunction06_CairnStone
        const d = this.Q(4), cls = o.type.id;
        if (!d.notIntro || x4.unk4C) {
          x4.unk4C = false;
          if (!x4.portalOpened && cls === STONES[0]) {
            x4.alpha = o;
            if (!x4.openPortalTimer) {
              x4.openPortalTimer = true;
              this.timer(4, 1, () => this.openPortalToTristram());
            }
          }
          this.h.setObjectMode(o, OBJMODE.OPENED);
        } else if (x4.activateCairn || x4.unk50) this.h.setObjectMode(o, OBJMODE.OPENED);
        else if (x4.cairnActive[cls - 17]) {
          x4.cairnActive[cls - 17] = false;
          this.h.setObjectMode(o, OBJMODE.NEUTRAL);
        }
        return;
      }
      case 7: // 출처: OBJECTS_InitFunction07_CainGibbet
        this.h.setObjectMode(o, x4.gibbetMode);
        x4.cageModeChanged = true;
        x4.gibbet = o;
        return;
      case 9: { // 출처: OBJECTS_InitFunction09_InifussTree
        x4.treeInit = true;
        x4.tree = o;
        if (!this.Q(4).notIntro || x4.unk50) x4.unk58 = OBJMODE.OPERATING;
        this.h.setObjectMode(o, x4.unk58);
        return;
      }
      case 13: // 출처: OBJECTS_InitFunction13_InvisibleObject → QUESTS_CreateChainRecord (A1Q4)
        x4.invisible = o;
        return;
      case 15: { // 출처: OBJECTS_InitFunction15_MalusStand
        const x3 = this.q3;
        x3.malusInit = true;
        x3.malusObj = o;
        if (!this.Q(3).notIntro) x3.malusObjMode = OBJMODE.OPENED;
        this.h.setObjectMode(o, x3.malusObjMode);
        return;
      }
      case 47: // 출처: OBJECTS_InitFunction47_CountessChest
        if (!this.q5.chests.includes(o) && this.q5.chests.length < 8) this.q5.chests.push(o);
        this.spawnTowerChestMissiles();
        return;
    }
  }

  /** 출처: ACT1Q4_OpenPortalToTristram — StoneAlpha +4,+4 에 붉은 포털 (오브젝트 60) */
  private openPortalToTristram(): boolean {
    const x = this.q4, a = x.alpha;
    if (!a) {
      x.openPortalTimer = false;
      return true;
    }
    if (this.h.openPortal(LEVEL.STONYFIELD, a.x + 4, a.y + 4, LEVEL.TRISTRAM)) {
      x.portalOpened = true;
      x.openPortalTimer = false;
      return true;
    }
    return false;
  }

  /** 퀘스트 오브젝트 조작 (objects.txt OperateFn 6 TowerTome, 9 Monolith, 10 CainGibbet, 12 InifussTree, 21 Malus, 33 WirtsBody). 처리했으면 true */
  operate(o: ObjectUnit): boolean {
    switch (o.type.operateFn) {
      case 6: this.opTowerTome(o); return true;
      case 9: this.opMonolith(o); return true;
      case 10: this.opGibbet(o); return true;
      case 12: this.opInifussTree(o); return true;
      case 21: this.opMalus(o); return true;
      case 33: this.opWirt(o); return true;
    }
    return false;
  }

  /** 출처: A1Q5.cpp OBJECTS_OperateFunction06_TowerTome */
  private opTowerTome(o: ObjectUnit): void {
    if (o.mode === OBJMODE.NEUTRAL) this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    const d = this.Q(5);
    if (!d.notIntro) return;
    // QUESTS_SendScrollMessage(…, 127) → 클라이언트가 두루마리를 띄우고 127 을 돌려보낸다
    this.h.emit({ type: 'questScroll', quest: 5, key: TOWER_TOME_MESSAGE.key, objectId: o.id });
    if (d.state <= 1) {
      d.state = 2;
      if (d.lastState < 1) this.q5.tomeActivated = true;
    }
    this.scrollMessage('', TOWER_TOME_MESSAGE.index);
  }

  /** 출처: ACT1Q4_SetMonolithOrder — 퀘스트 시드로 5개 돌(17~21)의 순서 */
  private setMonolithOrder(): void {
    const x = this.q4;
    x.order = [0, 0, 0, 0, 0];
    x.cur = 0;
    for (let i = 0; i < 5;) {
      const r = (this.h.seed.roll() >>> 0) % 5;
      if (!x.order[r]) {
        x.order[r] = STONES[i] as number;
        i++;
      }
    }
  }

  /** Cairn Stone 순서 (objects.txt 번호 17~21; 원작 ACT1Q4_SendStoneOrderToClient — 해독된 두루마리가 보여 주는 순서) */
  stoneOrder(): number[] {
    const x = this.q4;
    if (!x.ordered) {
      x.ordered = true;
      this.setMonolithOrder();
    }
    return [...x.order];
  }

  /** 출처: ACT1Q4 OBJECTS_OperateFunction09_Monolith */
  private opMonolith(o: ObjectUnit): void {
    const d = this.Q(4), x = this.q4;
    this.stoneOrder();
    if (this.done(4)) {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    if (!this.h.hasItem('bkd')) {
      if (!(x.interactions % 64) && !this.has(4, QFLAG.LEAVETOWN) && !this.has(4, QFLAG.ENTERAREA)) this.h.emit({ type: 'questSound', sound: 39 });
      x.interactions++;
      return;
    }
    if (!d.notIntro || d.state >= 6) return;
    if (x.invisible && !x.deciphered && !d.state && d.notIntro) d.state = 1;
    if (x.lastStone) return;
    if (d.state !== 5) {
      if (!d.state && d.notIntro) d.state = 1;
      d.state = 5;
    }
    if (o.type.id !== x.order[x.cur]) return;
    x.stoneObjs[x.cur] = o;
    x.cur++;
    if (o.mode !== OBJMODE.NEUTRAL) return;
    if (x.cur <= 4) {
      this.h.setObjectMode(o, OBJMODE.OPERATING, true);
      if (x.invisible) this.h.setObjectMode(x.invisible, x.cur + 1);
      this.h.emit({ type: 'cairnStone', objectId: o.id, count: x.cur });
      return;
    }
    if (x.cur !== 5) return;
    this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    if (x.invisible) this.h.setObjectMode(x.invisible, OBJMODE.SPECIAL4);
    this.h.emit({ type: 'cairnStone', objectId: o.id, count: x.cur });
    x.lastStone = true;
    this.h.deleteItem('bkd');
    x.scrolls--;
    let lambda: ObjectUnit | undefined;
    for (let i = 0; i < 5; i++) if (x.order[i] === STONE_LAMBDA && x.stoneObjs[i]?.type.id === STONE_LAMBDA) lambda = x.stoneObjs[i];
    // 출처: 미사일 288 cairnstones (Lambda 돌 +6, −3) — SrvDo17: Param3(38 = Tristram) 로 가는 영구 포털 (오브젝트 60)
    // 근사(원작 미확인): 원작은 미사일이 날아간 자리에서 포털이 생긴다 — 여기서는 미사일 첫 프레임에 그 자리
    if (lambda) this.h.openPortal(LEVEL.STONYFIELD, lambda.x + 6, lambda.y - 3, LEVEL.TRISTRAM);
    x.portalOpened = true;
    if (d.lastState < 4) {
      d.flags &= ~0xff;
      this.iterate(4, 4);
      this.set(4, QFLAG.ENTERAREA);
    }
    this.h.emit({ type: 'questFx', fx: 1 });
  }

  /** 출처: ACT1Q4 OBJECTS_OperateFunction12_InifussTree */
  private opInifussTree(o: ObjectUnit): void {
    const d = this.Q(4), x = this.q4;
    if (!d.notIntro) {
      this.h.setObjectMode(o, OBJMODE.OPERATING);
      return;
    }
    if (d.state >= 6 || o.mode !== OBJMODE.NEUTRAL || this.done(4)) return;
    if (this.h.hasItem('bkd') || this.h.hasItem('bks')) {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    this.h.emit({ type: 'questSound', sound: 45 });
    d.state = 4;
    if (this.h.dropAt('bks', o.x, o.y, QUALITY.NORMAL)) {
      d.flags &= ~0xff;
      this.iterate(4, 2);
      x.unk58 = 1;
      x.scrollAcquired = true;
      x.scrolls++;
      this.h.setObjectMode(o, OBJMODE.OPERATING);
    }
    x.treeInit = true;
    x.tree = o;
  }

  /** 출처: ACT1Q4 OBJECTS_OperateFunction10_CainGibbet */
  private opGibbet(o: ObjectUnit): void {
    const d = this.Q(4), x = this.q4;
    if (!d.notIntro || x.unk50 || d.state >= 6) return;
    if (this.done(4)) {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    x.gibbetMode = OBJMODE.SPECIAL1;
    // 출처: EVENTTYPE_MONUMOD +17 틱 → QUESTS_ObjectEvents(OBJECT_CAINGIBBET) → ACT1Q4_SpawnCainInTristram
    this.timer(4, 17, () => {
      this.spawnCainInTristram(o);
      return true;
    });
    this.set(4, QFLAG.PRIMARYGOALDONE);
    this.set(4, QFLAG.REWARDPENDING);
  }

  /** 출처: ACT1Q4_SpawnCainInTristram */
  private spawnCainInTristram(o: ObjectUnit): void {
    const d = this.Q(4), x = this.q4;
    if (!d.notIntro || x.unk50 || x.cainSpawned) return;
    x.gibbetMode = OBJMODE.SPECIAL1;
    this.h.setObjectMode(o, OBJMODE.SPECIAL1);
    x.cainSpawned = this.h.spawnCainTristram(o.x + 3, o.y + 3);
    if (!x.cainSpawned) {
      // 원작: Cain 을 만들지 못하면 마을로 가는 포털 + 마을 Cain
      x.unk52 = true;
      this.h.moveCainToTown();
    } else this.h.emit({ type: 'questCompleted', quest: 4 });
    // 출처: SetPrimaryGoalDoneForPartyMembers (트리스트럼에 있는 플레이어), SetCompletionFlag
    if (!this.done(4) && this.h.levelNo() === LEVEL.TRISTRAM) {
      this.set(4, QFLAG.PRIMARYGOALDONE);
      this.set(4, QFLAG.REWARDPENDING);
    }
    if (!this.done(4)) this.set(4, QFLAG.COMPLETEDNOW);
    d.flags &= ~0xff;
    this.iterate(4, 6);
  }

  /** 출처: A1Q3.cpp OBJECTS_OperateFunction21_HoradrimMalus */
  private opMalus(o: ObjectUnit): void {
    const d = this.Q(3), x = this.q3;
    if (!d.notIntro) {
      this.h.setObjectMode(o, OBJMODE.OPENED);
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    if (o.mode !== OBJMODE.NEUTRAL || this.done(3)) return;
    if (this.h.playerLevel() < 8) {
      // 레벨 8 미만은 Malus 를 받을 수 없다 (string.tbl Qstsyouarenot8)
      this.h.emit({ type: 'questSound', sound: 19, reason: 'level8' });
      return;
    }
    if (!this.h.dropAt('hdm', o.x, o.y, QUALITY.NORMAL)) return;
    this.h.setObjectMode(o, OBJMODE.OPENED);
    x.malusInit = true;
    x.malusObjMode = OBJMODE.OPENED;
    x.malusObj = o;
    x.malusItems++;
    if (d.state !== 4) {
      d.state = 4;
      this.updateFlags(3);
    }
    if (d.lastState !== 1) this.iterate(3, 1, false);
  }

  /** 출처: ObjMode.cpp OBJECTS_OperateFunction33_WirtsBody (다리 'leg') + Quests.cpp QUESTS_ObjectEvents(OBJECT_WIRTSBODY) 금화 10~19 무더기 */
  private opWirt(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    if (!this.h.dropAt('leg', o.x, o.y, QUALITY.NORMAL)) return;
    this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    const x = this.q4;
    const drop = (): boolean => {
      if (!x.wirtInit) {
        x.wirtInit = true;
        x.wirtGold = ((this.h.seed.roll() >>> 0) % 10) + 10;
      }
      if (x.wirtGold && this.h.dropAt('gld', o.x, o.y, QUALITY.NORMAL)) {
        x.wirtGold--;
        return x.wirtGold <= 0;
      }
      return true;
    };
    this.timer(4, 10, drop);
  }

  // ------------------------------------------------------------ 퀘스트 로그

  /**
   * 퀘스트 로그 상태 바이트.
   * 출처: QUESTS_RefreshStatus (A1Q3 은 ACT1Q3_StatusFilterCallback) — QUESTS_StatusCallback 은 fLastState 가 0 이면 보내지 않는다
   */
  status(n: number): number {
    const d = this.Q(n);
    if (n === 3) return this.statusQ3();
    if (!d.lastState) return 0;
    const now = this.has(n, QFLAG.COMPLETEDNOW), pgd = this.has(n, QFLAG.PRIMARYGOALDONE);
    if (d.state < d.initNo) {
      if (!now) {
        if (n !== 4 || d.lastState !== 6) return d.lastState;
        return pgd ? d.lastState : 12;
      }
      return 12;
    }
    if (!pgd) {
      if (n === 4 && now) return d.state === 6 ? 12 : d.lastState;
      return 12;
    }
    return d.lastState;
  }

  /** 출처: ACT1Q3_StatusFilterCallback */
  private statusQ3(): number {
    const d = this.Q(3);
    if (this.has(3, QFLAG.REWARDPENDING)) return 10;
    if (this.h.hasItem('hdm')) return this.has(3, QFLAG.REWARDGRANTED) ? 0 : 2;
    if (!d.notIntro) return 0;
    if (this.has(3, QFLAG.PRIMARYGOALDONE)) return this.has(3, QFLAG.REWARDPENDING) ? 10 : 13;
    if (this.has(3, QFLAG.COMPLETEDNOW)) return 12;
    if (d.state < 5) return d.lastState;
    if (this.h.global.get(3, QFLAG.PRIMARYGOALDONE)) return this.h.playerLevel() >= 8 ? 12 : 4;
    return 0;
  }

  /**
   * 퀘스트 로그 (원작 퀘스트 패널: 아이콘 = 시작 전 / 진행 중 / 완료).
   * 근사(원작 미확인): 아이콘 판정 — 상태 13 이거나 REWARDGRANTED 면 완료, 상태가 있거나 REWARDPENDING 이면 진행 중
   */
  log(): QuestLogEntry[] {
    return QUEST_LOG_ORDER.map((n) => {
      const status = this.status(n);
      const granted = this.has(n, QFLAG.REWARDGRANTED);
      const done = status === 13 || (granted && status !== 10);
      const icon: QuestLogEntry['icon'] = done ? 'done' : status || this.has(n, QFLAG.REWARDPENDING) || this.has(n, QFLAG.COMPLETEDBEFORE) ? 'active' : 'none';
      return { quest: n, status, icon, count: n === 1 ? this.q1.monstersLeft : 0, justDone: done && this.Q(n).notIntro };
    });
  }

  /** 디버그·테스트: 원작 fState */
  stateOf(n: number): { state: number; lastState: number; notIntro: boolean; active: boolean } {
    const d = this.Q(n);
    return { state: d.state, lastState: d.lastState, notIntro: d.notIntro, active: d.active };
  }
}
