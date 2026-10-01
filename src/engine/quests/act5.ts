// 확장팩 Act 5 퀘스트 상태 기계 (Siege on Harrogath · Rescue on Mount Arreat · Prison of Ice · Betrayal of Harrogath · Rite of Passage · Eve of Destruction).
// 출처: D2MOO D2Game/src/QUESTS/ACT5/A5Intro.cpp, A5Q1.cpp ~ A5Q6.cpp (콜백: NpcActivate / NpcDeactivate / ChangedLevel / MonsterKilled / ScrollMessage /
//       PlayerStartedGame, SeqCallback, ActiveFilter, StatusFilter, 오브젝트 Init/Operate 함수)
//       D2Game/src/QUESTS/Quests.cpp (gpQuestInitTable: A5Q1~A5Q6 InitNo 4, 차례 31 → 32 → … → 36)
//       D2Game/src/UNIT/SUnitNpc.cpp (Larzuk 소켓 보상)
// (https://github.com/ThePhrozenKeep/D2MOO)
import type { ObjectUnit } from '../objects';
import type { QuestSpeech } from './act1';
import { QFLAG } from './record';
import { ActQuestBase, QuestData, type ActsKill, type ActsQuestHost } from './acts-base';
import { QW } from './messages-acts';
import { NPC_MESSAGES_ACT5 } from './messages-act5';

/** Act 5 levels.txt 번호 (출처: LevelsIds.h) */
export const L5 = {
  HARROGATH: 109, BLOODYFOOTHILLS: 110, FRIGIDHIGHLANDS: 111, ARREATPLATEAU: 112, CRYSTALLINEPASSAGE: 113, FROZENRIVER: 114,
  NIHLATHAKSTEMPLE: 121, HALLSOFANGUISH: 122, HALLSOFPAIN: 123, HALLSOFVAUGHT: 124, ARREATSUMMIT: 120, WORLDSTONEKEEP1: 128,
  THRONEOFDESTRUCTION: 131, WORLDSTONECHAMBER: 132,
} as const;

/** objects.txt InitFn — 71 LarzukStandard */
export const ACT5_INIT_FNS = [71] as const;

const { A5Q1 } = QW;
const TOWN = L5.HARROGATH;

/**
 * Act 5 퀘스트 제어.
 * 출처: Quests.cpp gpQuestInitTable — A5Q1 (InitNo 4, Seq 32) …
 */
export class Act5Quests extends ActQuestBase {
  readonly act = 4;
  // A5Q1 (D2Act5Quest1Strc)
  private q1 = { larzukStart: false, larzukEnd: false, larzukSpawned: false };

  constructor(h: ActsQuestHost) {
    super(h);
    this.q[A5Q1] = new QuestData(A5Q1, 4);
  }

  /** 출처: QUESTS_InitScrollTextChain — Act 5 표 */
  protected override chain(w: number, table: number, npc: string, out: QuestSpeech[]): void {
    for (const msg of NPC_MESSAGES_ACT5[w]?.[table] ?? []) if (msg.npc === npc) out.push({ ...msg, quest: w });
  }

  // ------------------------------------------------------------ 게임 시작

  startGame(): void {
    this.startCommon();
    this.startedQ1();
  }

  /** 출처: ACT5Q1_Callback13_PlayerStartedGame */
  private startedQ1(): void {
    const d = this.Q(A5Q1);
    if (this.has(A5Q1, QFLAG.REWARDGRANTED) || this.has(A5Q1, QFLAG.COMPLETEDBEFORE) || this.has(A5Q1, QFLAG.REWARDPENDING)) d.lastState = 5;
    else if (this.has(A5Q1, QFLAG.ENTERAREA)) [d.lastState, d.state] = [2, 3];
    else if (this.has(A5Q1, QFLAG.LEAVETOWN)) [d.lastState, d.state] = [1, 3];
    else if (this.has(A5Q1, QFLAG.STARTED)) [d.lastState, d.state] = [1, 2];
  }

  /** 출처: ACT5Q1_UnitIterate_UpdateQuestStateFlags */
  private updateFlags(w: number): void {
    const d = this.Q(w);
    if (w === A5Q1) {
      if (this.done(A5Q1)) return;
      if (d.state === 2) this.set(A5Q1, QFLAG.STARTED);
      else if (d.state === 3) this.set(A5Q1, d.lastState === 2 ? QFLAG.ENTERAREA : QFLAG.LEAVETOWN);
    }
  }

  // ------------------------------------------------------------ NPC

  npcHasQuest(npc: string): boolean {
    // 출처: ACT5Q1_ActiveFilterCallback
    const d1 = this.Q(A5Q1);
    if (npc === 'larzuk') {
      if (this.has(A5Q1, QFLAG.REWARDPENDING) && !this.has(A5Q1, QFLAG.CUSTOM1)) return true;
      if (d1.notIntro && d1.state === 1 && !this.done(A5Q1)) return true;
    }
    return false;
  }

  npcActivate(npc: string): QuestSpeech[] {
    const out: QuestSpeech[] = [];
    this.activateQ1(npc, out);
    return out;
  }

  /** 출처: ACT5Q1_Callback00_NpcActivate */
  private activateQ1(npc: string, out: QuestSpeech[]): void {
    const d = this.Q(A5Q1);
    if (this.has(A5Q1, QFLAG.REWARDPENDING)) {
      if (!this.has(A5Q1, QFLAG.CUSTOM1)) this.chain(A5Q1, 3, npc, out);
      return;
    }
    if (!this.has(A5Q1, QFLAG.REWARDGRANTED) && (d.state < 4 || this.has(A5Q1, QFLAG.PRIMARYGOALDONE))) {
      if (!d.notIntro) return;
      const i = [-1, 0, 1, 2, 3, 4][d.state] ?? -1;
      if (i !== -1) this.chain(A5Q1, i, npc, out);
    }
  }

  scrollMessage(npc: string, index: number): void {
    // 출처: ACT5Q1_Callback11_ScrollMessage — 20077: Larzuk 이 시작, 20090: 보상 (Larzuk 에게 아이템을 주면 소켓 — CUSTOM1)
    if (npc === 'larzuk' && index === 20077) {
      this.q1.larzukStart = true;
      this.Q(A5Q1).state = 2;
      this.updateFlags(A5Q1);
    } else if (npc === 'larzuk' && index === 20090) {
      if (!this.has(A5Q1, QFLAG.REWARDPENDING)) return;
      const d = this.Q(A5Q1);
      this.q1.larzukEnd = true;
      this.h.record.resetIntermediate(A5Q1);
      this.set(A5Q1, QFLAG.CUSTOM1);
      if (this.has(A5Q1, QFLAG.PRIMARYGOALDONE) && d.state !== 5) {
        d.state = 5;
        this.iterate(A5Q1, 13, false);
      }
      d.guid = true;
    }
  }

  npcDeactivate(npc: string): void {
    // 출처: ACT5Q1_Callback02_NpcDeactivate
    if (npc !== 'larzuk') return;
    if (this.q1.larzukStart) {
      this.iterate(A5Q1, 1);
      this.q1.larzukStart = false;
    }
    if (this.q1.larzukEnd) {
      this.iterate(A5Q1, 4);
      this.q1.larzukEnd = false;
    }
  }

  /** 출처: A5Intro.cpp ACT5Intro_Callback11_ScrollMessage — Malah 의 첫 대사 (20037~20039) 가 A5Q1 을 시작 (fState 1) */
  override gameEvent(ev: { type: string; [k: string]: unknown }): void {
    if (ev.type === 'npcTalk' && ev.typeId === 'malah' && ev.intro) {
      const d = this.Q(A5Q1);
      if (!d.state && d.notIntro) d.state = 1;
    }
    // 출처: ACT5Q1_OnSiegeBossActivated (Overseer AI) — Shenk 를 처음 만나면 로그 2
    if (ev.type === 'bossActivated' && ev.typeId === 'overseer1' && this.isSiegeBoss(ev.superUnique)) {
      const d = this.Q(A5Q1);
      if (d.notIntro && d.lastState < 2) this.iterate(A5Q1, 2);
    }
  }

  private isSiegeBoss(su: unknown): boolean {
    return su !== undefined && this.h.superUniqueKey?.(Number(su)) === 'Siege Boss';
  }

  // ------------------------------------------------------------ 레벨 이동

  changeLevel(oldNo: number, newNo: number): void {
    // 출처: ACT5Q1_Callback03_ChangedLevel
    const d1 = this.Q(A5Q1);
    if (newNo < L5.BLOODYFOOTHILLS || newNo > L5.ARREATPLATEAU) {
      if (oldNo !== TOWN) return;
      d1.guid = false;
      if (d1.state !== 2 || this.done(A5Q1)) return;
      d1.state = 3;
      if (!d1.lastState) this.iterate(A5Q1, 1, false);
      this.updateFlags(A5Q1);
    } else if (d1.notIntro && (d1.state === 1 || d1.state === 2)) {
      d1.state = 3;
      this.updateFlags(A5Q1);
    }
  }

  // ------------------------------------------------------------ 몬스터

  monsterKilled(k: ActsKill): void {
    if (k.superUnique === 'Siege Boss') this.killedShenk(k);
  }

  /**
   * 출처: ACT5Q1_Callback08_MonsterKilled — Shenk 와 같은 방·이웃 방 플레이어: REWARDPENDING + PGD (UnitIterate_SetRewardPending),
   *   아니면 COMPLETEDNOW. 전역 PGD, FX 15, 완료 소리 80, 로그 3
   */
  private killedShenk(k: ActsKill): void {
    const d = this.Q(A5Q1);
    if (!d.notIntro) return;
    if ((k.byPlayer || k.playerNear) && !this.has(A5Q1, QFLAG.REWARDGRANTED)) {
      this.set(A5Q1, QFLAG.REWARDPENDING);
      this.set(A5Q1, QFLAG.PRIMARYGOALDONE);
    }
    if (!this.done(A5Q1) && !this.has(A5Q1, QFLAG.PRIMARYGOALDONE)) this.set(A5Q1, QFLAG.COMPLETEDNOW);
    if (this.has(A5Q1, QFLAG.PRIMARYGOALDONE)) {
      this.h.emit({ type: 'questSound', sound: 80 });
      this.h.emit({ type: 'questCompleted', quest: A5Q1, act: this.act });
    }
    this.h.global.set(A5Q1, QFLAG.PRIMARYGOALDONE);
    this.h.emit({ type: 'questFx', fx: 15 });
    if (d.lastState < 3) this.iterate(A5Q1, 3);
  }

  /** Larzuk 이 소켓을 뚫어 줄 수 있다 (SUnitNpc.cpp MONSTER_LARZUK: A5Q1 REWARDPENDING) */
  canSocket(): boolean {
    return this.has(A5Q1, QFLAG.REWARDPENDING);
  }

  /** 출처: ACT5Q1_SetRewardGranted */
  socketDone(): void {
    this.set(A5Q1, QFLAG.REWARDGRANTED);
    this.clr(A5Q1, QFLAG.REWARDPENDING);
  }

  // ------------------------------------------------------------ 오브젝트

  /** 출처: OBJECTS_InitFunction71_LarzukStandard — 마을 DS1 의 Larzuk 자리 오브젝트 (543) 에 Larzuk 을 한 번 세운다 */
  initObject(o: ObjectUnit): void {
    if (o.type.initFn !== 71 || this.q1.larzukSpawned) return;
    if (this.h.spawnMonster(TOWN, 'larzuk', o.x, o.y, { npc: true }) !== null) this.q1.larzukSpawned = true;
  }

  operate(_o: ObjectUnit): boolean {
    return false;
  }

  itemPickedUp(_code: string): void {}

  // ------------------------------------------------------------ 퀘스트 로그

  /** 출처: ACT5Q1_StatusFilterCallback — 보상 대기·PGD 면 3 (소켓 뚫으면 4), 진행 중이면 fLastState (COMPLETEDNOW 면 12) */
  protected override statusFilter(w: number): number | undefined {
    if (w !== A5Q1) return undefined;
    const d = this.Q(w);
    if (this.has(A5Q1, QFLAG.REWARDPENDING) || this.has(A5Q1, QFLAG.PRIMARYGOALDONE)) return this.has(A5Q1, QFLAG.CUSTOM1) ? 4 : 3;
    if (d.notIntro && !this.has(A5Q1, QFLAG.REWARDGRANTED)) {
      if (this.has(A5Q1, QFLAG.COMPLETEDNOW)) return 12;
      if (d.state < 5) return d.lastState;
    }
    return 0;
  }
}
