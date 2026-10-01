// 확장팩 Act 5 퀘스트 상태 기계 (Siege on Harrogath · Rescue on Mount Arreat · Prison of Ice · Betrayal of Harrogath · Rite of Passage · Eve of Destruction).
// 출처: D2MOO D2Game/src/QUESTS/ACT5/A5Intro.cpp, A5Q1.cpp ~ A5Q6.cpp (콜백: NpcActivate / NpcDeactivate / ChangedLevel / MonsterKilled / ScrollMessage /
//       PlayerStartedGame, SeqCallback, ActiveFilter, StatusFilter, 오브젝트 Init/Operate 함수)
//       D2Game/src/QUESTS/Quests.cpp (gpQuestInitTable: A5Q1~A5Q6 InitNo 4, 차례 31 → 32 → … → 36)
//       D2Game/src/UNIT/SUnitNpc.cpp (Larzuk 소켓 보상)
// (https://github.com/ThePhrozenKeep/D2MOO)
import type { ObjectUnit } from '../objects';
import type { QuestSpeech } from './act1';
import { QUALITY } from '../treasure';
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

/** objects.txt InitFn — 71 LarzukStandard, 62 CagedWussie */
export const ACT5_INIT_FNS = [71, 62] as const;

/** 출처: gdwAct5Q2RuneCodes — Tal · Ral · Ort (구출 15 명 3 개, 14 명 2 개, 그 밖 1 개) */
export const A5Q2_RUNES = ['r07', 'r08', 'r09'] as const;

/** 출처: OBJECT_CAINPORTAL (objects.txt 189) — 풀려난 포로가 들어가는 붉은 포털 */
const OBJ_CAINPORTAL = 189;

const { A5Q1, A5Q2 } = QW;
const TOWN = L5.HARROGATH;

/**
 * Act 5 퀘스트 제어.
 * 출처: Quests.cpp gpQuestInitTable — A5Q1 (InitNo 4, Seq 32) …
 */
export class Act5Quests extends ActQuestBase {
  readonly act = 4;
  // A5Q1 (D2Act5Quest1Strc)
  private q1 = { larzukStart: false, larzukEnd: false, larzukSpawned: false };
  // A5Q2 (D2Act5Quest2Strc): 감옥 3 곳 (자리·포로 5 명·문을 부숨·포털), 풀려난·죽은 포로 수
  private q2 = {
    qualKehk: false, spawned: 0, freed: 0, killed: 0, freedIds: [] as number[],
    cages: [] as { x: number; y: number; level: number; pows: number[]; opened: boolean; portalAt: number }[],
  };

  constructor(h: ActsQuestHost) {
    super(h);
    this.q[A5Q1] = new QuestData(A5Q1, 4);
    this.q[A5Q2] = new QuestData(A5Q2, 4);
  }

  /** 퀘스트 차례 (SeqCallback). 출처: ACT5Q1 (끝나면 → 32 A5Q2), ACT5Q2 (fState 0 이면 1) */
  private seq(w: number): boolean {
    const d = this.Q(w);
    switch (w) {
      case A5Q1:
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(A5Q2);
      case A5Q2:
        if (d.state !== 5 && d.notIntro) {
          if (!d.state) d.state = 1;
          return true;
        }
        return true;
    }
    return true;
  }

  /** 출처: QUESTS_InitScrollTextChain — Act 5 표 */
  protected override chain(w: number, table: number, npc: string, out: QuestSpeech[]): void {
    for (const msg of NPC_MESSAGES_ACT5[w]?.[table] ?? []) if (msg.npc === npc) out.push({ ...msg, quest: w });
  }

  // ------------------------------------------------------------ 게임 시작

  startGame(): void {
    this.startCommon();
    this.startedQ2();
    this.startedQ1();
    // 출처: QUESTS_SequenceCycler — 퀘스트 31 (A5Q1) 의 SeqCallback
    this.seq(A5Q1);
  }

  /** 출처: ACT5Q2_Callback13_PlayerStartedGame — ENTERAREA 는 지운다 */
  private startedQ2(): void {
    const d = this.Q(A5Q2);
    this.clr(A5Q2, QFLAG.ENTERAREA);
    if (this.has(A5Q2, QFLAG.REWARDGRANTED) || this.has(A5Q2, QFLAG.COMPLETEDBEFORE) || this.has(A5Q2, QFLAG.REWARDPENDING)) return;
    if (this.has(A5Q2, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [3, 1];
    else if (this.has(A5Q2, QFLAG.STARTED)) [d.state, d.lastState] = [2, 1];
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
    if (w === A5Q2) {
      // 출처: ACT5Q2_UnitIterate_UpdateQuestStateFlags
      if (this.done(A5Q2)) return;
      if (d.state === 2) this.set(A5Q2, QFLAG.STARTED);
      else if (d.state === 3) this.set(A5Q2, QFLAG.LEAVETOWN);
      return;
    }
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
    // 출처: ACT5Q2_ActiveFilterCallback
    if (npc === 'qual-kehk') {
      const d2 = this.Q(A5Q2);
      if (d2.state !== 1) return this.has(A5Q2, QFLAG.REWARDPENDING);
      return !this.done(A5Q2);
    }
    return false;
  }

  npcActivate(npc: string): QuestSpeech[] {
    const out: QuestSpeech[] = [];
    this.activateQ1(npc, out);
    this.activateQ2(npc, out);
    return out;
  }

  /** 출처: ACT5Q2_Callback00_NpcActivate */
  private activateQ2(npc: string, out: QuestSpeech[]): void {
    const d = this.Q(A5Q2);
    if (this.has(A5Q2, QFLAG.REWARDPENDING)) return this.chain(A5Q2, 3, npc, out);
    if (d.guid) return this.chain(A5Q2, 4, npc, out);
    if (this.has(A5Q2, QFLAG.REWARDGRANTED) || (d.state >= 4 && !this.has(A5Q2, QFLAG.PRIMARYGOALDONE)) || !d.notIntro) return;
    const i = [-1, 0, 1, 2, 3, 4][d.state] ?? -1;
    if (i === 2 && npc === 'qual-kehk') this.chain(A5Q2, this.has(A5Q2, QFLAG.ENTERAREA) ? 5 : i, npc, out);
    else if (i !== -1) this.chain(A5Q2, i, npc, out);
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
      this.seq(A5Q1);
    }
    // 출처: ACT5Q2_Callback11_ScrollMessage — 20096: Qual-Kehk 시작, 20110: 보상 (룬 Tal·Ral·Ort 중 앞에서부터 CUSTOM2 2 개 / CUSTOM3 1 개 / 그 밖 3 개)
    if (npc === 'qual-kehk' && index === 20096) {
      this.q2.qualKehk = true;
      this.Q(A5Q2).state = 2;
      this.updateFlags(A5Q2);
    } else if (npc === 'qual-kehk' && index === 20110 && this.has(A5Q2, QFLAG.REWARDPENDING)) {
      const d = this.Q(A5Q2);
      if (this.has(A5Q2, QFLAG.PRIMARYGOALDONE) && d.state !== 5) {
        d.state = 5;
        this.seq(A5Q2);
        this.iterate(A5Q2, 13, false);
      }
      const n = this.has(A5Q2, QFLAG.CUSTOM2) ? 2 : this.has(A5Q2, QFLAG.CUSTOM3) ? 1 : 3;
      let given = false;
      for (let i = 0; i < n; i++) if (this.h.giveItem(A5Q2_RUNES[i] as string, 0, QUALITY.NORMAL)) given = true;
      if (given) {
        this.set(A5Q2, QFLAG.REWARDGRANTED);
        this.clr(A5Q2, QFLAG.REWARDPENDING);
        this.h.record.resetIntermediate(A5Q2);
        d.guid = true;
        this.h.emit({ type: 'questReward', quest: A5Q2, act: this.act, reward: 'runes', amount: n });
      }
    }
  }

  npcDeactivate(npc: string): void {
    // 출처: ACT5Q2_Callback02_NpcDeactivate
    if (npc === 'qual-kehk' && this.q2.qualKehk && this.q2.killed < 5) {
      this.iterate(A5Q2, 1);
      this.q2.qualKehk = false;
    }
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
    // 출처: ACT5Q2_Callback03_ChangedLevel
    const d2 = this.Q(A5Q2);
    if (newNo >= L5.FRIGIDHIGHLANDS && newNo <= L5.ARREATPLATEAU && d2.notIntro && this.q2.killed < 5) {
      if (d2.state === 1 || d2.state === 2) d2.state = 3;
      if (d2.lastState) {
        if (d2.state !== 1 && d2.state !== 2 && d2.state !== 3) return;
      } else this.iterate(A5Q2, 1);
      this.updateFlags(A5Q2);
    } else if (oldNo === TOWN) {
      d2.guid = false;
      if (d2.state !== 2 || this.done(A5Q2)) return;
      d2.state = 3;
      this.updateFlags(A5Q2);
      if (d2.lastState || !d2.notIntro || this.q2.killed >= 5) return;
      this.iterate(A5Q2, 1);
    }
  }

  // ------------------------------------------------------------ 몬스터

  monsterKilled(k: ActsKill): void {
    if (k.superUnique === 'Siege Boss') this.killedShenk(k);
    if (k.typeId === 'prisondoor') this.killedPrisonDoor(k);
  }

  /**
   * 출처: ACT5Q2_Callback08_MonsterKilled (감옥 문) + AITHINK_Fn131_Wussie → ACT5Q2_UpdateQuestState — 문 15 안의 포로가 풀려나고,
   *   문 자리 +2 에 붉은 포털 (OBJECT_CAINPORTAL). 세 감옥을 다 열면: 풀려난 수 ≤ 11 이면 COMPLETEDNOW, 아니면 PGD·REWARDPENDING
   *   + CUSTOM1 (15) / CUSTOM2 (14) / CUSTOM3, 완료 소리 81, 로그 3. 아직이면 ENTERAREA·로그 2 ("Rescue %d more")
   * 근사(원작 미확인): 원작 포로는 같은 편 몬스터 (Wussie AI) 라 적에게 죽을 수 있다 — 여기서는 공격할 수 없는 NPC 로 두고,
   *   포털이 열린 뒤 50 프레임에 걸어 들어간 것으로 본다 (포로 사망·실패 경로는 원작 수식 그대로 남기되 일어나지 않는다)
   */
  private killedPrisonDoor(k: ActsKill): void {
    const d = this.Q(A5Q2), x = this.q2;
    if (!d.notIntro) return;
    const cage = x.cages.find((c) => c.level === k.levelNo && !c.opened && Math.hypot(c.x - k.x, c.y - k.y) < 15);
    if (!cage) return;
    cage.opened = true;
    x.freed += cage.pows.length;
    x.freedIds.push(...cage.pows);
    this.h.createObject(k.levelNo, OBJ_CAINPORTAL, Math.floor(k.x) + 2, Math.floor(k.y), 1);
    cage.portalAt = this.tick;
    this.timer(50, () => {
      for (const id of cage.pows) this.h.removeUnit?.(cage.level, id);
      return true;
    });
    if (x.cages.length === 3 && x.cages.every((c) => c.opened) && x.spawned === x.freed + x.killed) {
      if (x.freed <= 11) {
        if (!this.done(A5Q2) && !this.has(A5Q2, QFLAG.PRIMARYGOALDONE)) this.set(A5Q2, QFLAG.COMPLETEDNOW);
        return;
      }
      this.iterate(A5Q2, 3);
      if (!this.done(A5Q2)) {
        this.set(A5Q2, QFLAG.PRIMARYGOALDONE);
        this.set(A5Q2, QFLAG.REWARDPENDING);
        this.set(A5Q2, x.freed === 15 ? QFLAG.CUSTOM1 : x.freed === 14 ? QFLAG.CUSTOM2 : QFLAG.CUSTOM3);
      }
      this.h.emit({ type: 'questSound', sound: 81 });
      this.h.emit({ type: 'questCompleted', quest: A5Q2, act: this.act });
      return;
    }
    this.set(A5Q2, QFLAG.ENTERAREA);
    if (x.killed < 5) this.iterate(A5Q2, 2);
    x.qualKehk = false;
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
    if (o.type.initFn === 62) return this.initCage(o);
    if (o.type.initFn !== 71 || this.q1.larzukSpawned) return;
    if (this.h.spawnMonster(TOWN, 'larzuk', o.x, o.y, { npc: true }) !== null) this.q1.larzukSpawned = true;
  }

  /**
   * 출처: OBJECTS_InitFunction62_CagedWussie → ACT5Q2_SpawnCagedWussies — 감옥마다 (같은 자리면 한 번) 포로 5 명, 로그 1, fState 2
   */
  private initCage(o: ObjectUnit): void {
    const d = this.Q(A5Q2), x = this.q2;
    if (!d.notIntro) return;
    if (d.state < 2) d.state = 2;
    if (!d.lastState && x.killed < 5) this.iterate(A5Q2, 1);
    if (x.cages.length >= 3 || x.cages.some((c) => c.x === o.x && c.y === o.y)) return;
    const level = this.h.levelNo();
    const cage = { x: o.x, y: o.y, level, pows: [] as number[], opened: false, portalAt: -1 };
    for (let i = 0; i < 25 && cage.pows.length < 5; i++) {
      const id = this.h.spawnMonster(level, 'act5pow', o.x, o.y, { npc: true });
      if (id !== null) cage.pows.push(id);
    }
    x.spawned += cage.pows.length;
    x.cages.push(cage);
  }

  /** 출처: ACT5Q2_GetBarbsToBeRescued — 아직 구할 포로 (못 본 감옥은 5 명씩) */
  barbsToRescue(): number {
    const x = this.q2;
    const unseen = 5 * (3 - x.cages.length);
    return Math.max(0, x.spawned - x.freed - x.killed + unseen);
  }

  operate(_o: ObjectUnit): boolean {
    return false;
  }

  itemPickedUp(_code: string): void {}

  // ------------------------------------------------------------ 퀘스트 로그

  protected override logCount(w: number): number {
    return w === A5Q2 ? this.barbsToRescue() : 0;
  }

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
