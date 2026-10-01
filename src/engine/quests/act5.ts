// 확장팩 Act 5 퀘스트 상태 기계 (Siege on Harrogath · Rescue on Mount Arreat · Prison of Ice · Betrayal of Harrogath · Rite of Passage · Eve of Destruction).
// 출처: D2MOO D2Game/src/QUESTS/ACT5/A5Intro.cpp, A5Q1.cpp ~ A5Q6.cpp (콜백: NpcActivate / NpcDeactivate / ChangedLevel / MonsterKilled / ScrollMessage /
//       PlayerStartedGame, SeqCallback, ActiveFilter, StatusFilter, 오브젝트 Init/Operate 함수)
//       D2Game/src/QUESTS/Quests.cpp (gpQuestInitTable: A5Q1~A5Q6 InitNo 4, 차례 31 → 32 → … → 36)
//       D2Game/src/UNIT/SUnitNpc.cpp (Larzuk 소켓 보상)
// (https://github.com/ThePhrozenKeep/D2MOO)
import type { ObjectUnit } from '../objects';
import type { QuestSpeech } from './act1';
import { OBJMODE } from '../objects';
import { QUALITY } from '../treasure';
import { QFLAG } from './record';
import { ActQuestBase, QuestData, type ActsKill, type ActsQuestHost } from './acts-base';
import { QW } from './messages-acts';
import { NPC_MESSAGES_ACT5 } from './messages-act5';

/** Act 5 levels.txt 번호 (출처: LevelsIds.h) */
export const L5 = {
  HARROGATH: 109, BLOODYFOOTHILLS: 110, FRIGIDHIGHLANDS: 111, ARREATPLATEAU: 112, CRYSTALLINEPASSAGE: 113, FROZENRIVER: 114,
  ICYCELLAR: 119, NIHLATHAKSTEMPLE: 121, HALLSOFANGUISH: 122, HALLSOFPAIN: 123, HALLSOFVAUGHT: 124, ARREATSUMMIT: 120, WORLDSTONEKEEP1: 128,
  THRONEOFDESTRUCTION: 131, WORLDSTONECHAMBER: 132,
} as const;

/** objects.txt InitFn — 71 LarzukStandard, 62 CagedWussie, 66 DrehyaStartInTown, 67 DrehyaStartOutsideTown, 68 NihlathakStartInTown, 69 NihlathakStartOutsideTown, 74 FrozenAnya */
export const ACT5_INIT_FNS = [71, 62, 66, 67, 68, 69, 74] as const;

/** 출처: gdwAct5Q2RuneCodes — Tal · Ral · Ort (구출 15 명 3 개, 14 명 2 개, 그 밖 1 개) */
export const A5Q2_RUNES = ['r07', 'r08', 'r09'] as const;

/** 출처: OBJECT_CAINPORTAL (objects.txt 189) — 풀려난 포로가 들어가는 붉은 포털 */
const OBJ_CAINPORTAL = 189;
/** 출처: OBJECT_FROZEN_ANYA (objects.txt 558) */
const OBJ_FROZEN_ANYA = 558;

/**
 * A5Q3 Anya 보상 레어 (직업 순서: Amazon · Sorceress · Necromancer · Paladin · Barbarian · Druid · Assassin).
 * 출처: ACT5Q3_Callback11_ScrollMessage gdw{Normal,Exceptional,Elite}<직업>RewardCodes (4 글자 코드를 거꾸로 적은 값)
 */
export const A5Q3_REWARDS: Record<'normal' | 'exceptional' | 'elite', readonly (readonly string[])[]> = {
  normal: [
    ['am1', 'am2', 'am3', 'am4', 'am5'], ['ob1', 'ob2', 'ob3', 'ob4', 'ob5'], ['ne1', 'ne2', 'ne3', 'ne4', 'ne5'], ['pa1', 'pa2', 'pa3', 'pa4', 'pa5'],
    ['ba1', 'ba2', 'ba3', 'ba4', 'ba5'], ['dr1', 'dr2', 'dr3', 'dr4', 'dr5'], ['ktr', 'wrb', 'axf', 'ces', 'clw', 'btl', 'skr'],
  ],
  exceptional: [
    ['am6', 'am7', 'am8', 'am9', 'ama'], ['ob6', 'ob7', 'ob8', 'ob9', 'oba'], ['ne6', 'ne7', 'ne8', 'ne9', 'nea'], ['pa6', 'pa7', 'pa8', 'pa9', 'paa'],
    ['ba6', 'ba7', 'ba8', 'ba9', 'baa'], ['dr6', 'dr7', 'dr8', 'dr9', 'dra'], ['9ar', '9wb', '9xf', '9cs', '9lw', '9tw', '9qr'],
  ],
  elite: [
    ['amb', 'amc', 'amd', 'ame', 'amf'], ['obb', 'obc', 'obd', 'obe', 'obf'], ['neb', 'nec', 'ned', 'nee', 'nef'], ['pab', 'pac', 'pad', 'pae', 'paf'],
    ['bab', 'bac', 'bad', 'bae', 'baf'], ['drb', 'drc', 'drd', 'dre', 'drf'], ['7ar', '7wb', '7xf', '7cs', '7lw', '7tw', '7qr'],
  ],
};
/** 출처: D2Constants.h 직업 번호 (dwClassId) */
const CLASS_INDEX: Record<string, number> = { Amazon: 0, Sorceress: 1, Necromancer: 2, Paladin: 3, Barbarian: 4, Druid: 5, Assassin: 6 };

/** 저항 두루마리를 읽은 다른 난이도 수 (저장 questFlagsByDiff 의 A5Q3 CUSTOM3). 출처: ACT5Q3_ApplyResistanceReward — 세 난이도 기록을 모두 본다 */
export function questResistDiffs(byDiff: readonly (readonly number[] | null)[], difficulty: number): number {
  let n = 0;
  byDiff.forEach((w, d) => {
    if (d !== difficulty && w && ((w[QW.A5Q3] ?? 0) & (1 << QFLAG.CUSTOM3))) n++;
  });
  return n;
}

const { A5Q1, A5Q2, A5Q3, A5Q4 } = QW;
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

  // A5Q3 (D2Act5Quest3Strc): unk0x84 = anya (0 얼음 · 1 녹음 · 2 마을), unk0x88 = nihLeft (Nihlathak 이 마을을 떠남)
  private q3 = {
    malahIntro: false, malahActivated: false, potions: 0, rewarded: false, anya: 0, nihLeft: false,
    frozenSpawned: false, frozenId: -1, frozenLevel: 0, timerActive: false, timerStep: 0, anyaAt: { x: 0, y: 0 },
    icedId: -1, icedLevel: 0, portalOut: false,
    townObj: null as { x: number; y: number } | null, drehyaTownId: -1, nihTownId: -1, nihTempleSpawned: false,
  };

  // A5Q4 (D2Act5Quest4Strc)
  private q4 = { drehyaActivated: false, needsPortal: false, portalCreated: false, wpNotActivated: false, timerActive: false };

  constructor(h: ActsQuestHost) {
    super(h);
    this.q[A5Q4] = new QuestData(A5Q4, 4);
    this.q[A5Q1] = new QuestData(A5Q1, 4);
    this.q[A5Q2] = new QuestData(A5Q2, 4);
    this.q[A5Q3] = new QuestData(A5Q3, 5);
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
        return this.seq(A5Q3);
      case A5Q3:
        // 출처: ACT5Q3_SeqCallback (→ 34 A5Q4)
        if (d.state < 5 && d.notIntro) {
          if (!d.state) d.state = 1;
          return true;
        }
        return this.seq(A5Q4);
      case A5Q4:
        // 출처: ACT5Q4_SeqCallback (→ 35 A5Q5)
        if (d.state < 4 && d.notIntro) {
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
    this.startedQ4();
    this.startedQ3();
    this.startedQ2();
    this.startedQ1();
    // 출처: QUESTS_SequenceCycler — 퀘스트 31 (A5Q1) 의 SeqCallback
    this.seq(A5Q1);
  }

  /** 출처: ACT5Q4_Callback13_PlayerStartedGame — 끝낸 퀘스트면 fState 5, Halls of Death's Calling (123) 웨이포인트가 꺼져 있으면 Anya 가 포털을 다시 연다 */
  private startedQ4(): void {
    const d = this.Q(A5Q4), x = this.q4;
    if (!d.notIntro) {
      d.state = 5;
      if (!(this.h.waypointActive?.(L5.HALLSOFPAIN) ?? true)) x.wpNotActivated = true;
      return;
    }
    if (this.has(A5Q4, QFLAG.REWARDPENDING)) return;
    if (this.has(A5Q4, QFLAG.LEAVETOWN)) {
      x.needsPortal = true;
      this.iterate(A5Q4, 2);
      d.state = 3;
    } else if (this.has(A5Q4, QFLAG.STARTED)) {
      x.needsPortal = true;
      this.iterate(A5Q4, 1);
      d.state = 2;
    }
  }

  /** 출처: ACT5Q3_Callback13_PlayerStartedGame */
  private startedQ3(): void {
    const d = this.Q(A5Q3), x = this.q3;
    if (this.item('ice')) x.potions = 1;
    if (this.has(A5Q3, QFLAG.REWARDGRANTED) || this.has(A5Q3, QFLAG.COMPLETEDBEFORE)) {
      x.anya = 2;
      x.nihLeft = true;
      return;
    }
    if (!d.notIntro) return;
    if (this.has(A5Q3, QFLAG.LEAVETOWN)) d.state = 3;
    else if (!this.has(A5Q3, QFLAG.STARTED)) {
      if (x.potions) [d.state, d.lastState] = [3, 4];
      return;
    } else d.state = 2;
    d.lastState = 1;
    if (x.potions) [d.state, d.lastState] = [3, 4];
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
    if (w === A5Q4) {
      // 출처: ACT5Q4_UnitIterate_UpdateQuestStateFlags — A5Q3 을 끝낸 플레이어만
      if (!this.done(A5Q3) || this.done(A5Q4)) return;
      if (d.state === 2) this.set(A5Q4, QFLAG.STARTED);
      else if (d.state === 3) this.set(A5Q4, QFLAG.LEAVETOWN);
      return;
    }
    if (w === A5Q3) {
      // 출처: ACT5Q3_UnitIterate_UpdateQuestStateFlags (보상 받음 = 비트 0 또는 대기면 그대로)
      if (this.done(A5Q3)) return;
      if (d.state === 2) this.set(A5Q3, QFLAG.STARTED);
      else if (d.state === 3) this.set(A5Q3, QFLAG.LEAVETOWN);
      return;
    }
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
    // 출처: ACT5Q3_ActiveFilterCallback
    const d3 = this.Q(A5Q3);
    if (npc === 'malah') {
      if (this.has(A5Q3, QFLAG.REWARDPENDING) && !this.has(A5Q3, QFLAG.CUSTOM4)) return true;
      if (!this.done(A5Q3) && (d3.state === 1 || (d3.state === 4 && !this.q3.potions))) return true;
    }
    if (npc === 'drehyaiced' && d3.notIntro && d3.state < 5 && !this.item('ice')) return true;
    if (npc === 'drehya' && this.has(A5Q3, QFLAG.REWARDPENDING) && !this.has(A5Q3, QFLAG.CUSTOM5)) return true;
    // 출처: ACT5Q4_ActiveFilterCallback
    if (npc === 'drehya') {
      if (this.Q(A5Q4).state === 1) {
        if (this.done(A5Q3) && !this.has(A5Q4, QFLAG.REWARDGRANTED) && !this.has(A5Q4, QFLAG.REWARDPENDING)) return true;
      } else if (this.has(A5Q4, QFLAG.PRIMARYGOALDONE) && !this.has(A5Q4, QFLAG.ENTERAREA)) return true;
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
    this.activateQ3(npc, out);
    this.activateQ4(npc, out);
    return out;
  }

  /** 출처: ACT5Q4_Callback00_NpcActivate */
  private activateQ4(npc: string, out: QuestSpeech[]): void {
    const d = this.Q(A5Q4);
    if (!this.done(A5Q3)) return;
    if (npc === 'drehya' && d.state === 1) {
      if (!this.done(A5Q4)) this.chain(A5Q4, 0, npc, out);
      return;
    }
    if (this.has(A5Q4, QFLAG.REWARDPENDING)) return this.chain(A5Q4, this.has(A5Q4, QFLAG.ENTERAREA) ? 4 : 3, npc, out);
    if (d.guid) return this.chain(A5Q4, 4, npc, out);
    if (this.has(A5Q4, QFLAG.REWARDGRANTED) || !(d.state < 4 || this.has(A5Q4, QFLAG.PRIMARYGOALDONE)) || !d.notIntro) return;
    const i = [-1, 0, 1, 2, 3, 4][d.state] ?? -1;
    if (i !== -1) this.chain(A5Q4, i, npc, out);
  }

  /** 출처: ACT5Q3_Callback00_NpcActivate */
  private activateQ3(npc: string, out: QuestSpeech[]): void {
    const d = this.Q(A5Q3), x = this.q3;
    if (npc === 'drehyaiced') {
      // fState 6 (Nihlathak 의 신전에 먼저 감) 이면 얼음 Anya 는 사라진다 (MONMODE_DEAD)
      if (d.state === 6) this.removeIced();
      return;
    }
    if (npc === 'malah') {
      if (d.state === 4) {
        if (!this.item('ice') && !x.potions) this.chain(A5Q3, 3, npc, out);
        return;
      }
      if (this.lostScroll()) this.chain(A5Q3, 5, npc, out);
    }
    if (this.has(A5Q3, QFLAG.REWARDPENDING)) {
      if (npc === 'drehya' && this.has(A5Q3, QFLAG.CUSTOM5)) return;
      if (npc === 'malah' && this.has(A5Q3, QFLAG.CUSTOM4)) return;
      return this.chain(A5Q3, 5, npc, out);
    }
    if (d.guid) return this.chain(A5Q3, 6, npc, out);
    if (this.has(A5Q3, QFLAG.REWARDGRANTED) || (d.state >= 5 && !this.has(A5Q3, QFLAG.PRIMARYGOALDONE)) || !d.notIntro) return;
    const i = [-1, 0, 1, 2, 3, 4, 5][d.state] ?? -1;
    if (i !== -1) this.chain(A5Q3, i, npc, out);
  }

  /** 출처: ACT5Q3 Malah 20132 다시 주기 조건 — 끝냈고, 이번 게임에 안 줬고, CUSTOM4 인데 읽지 않았고 (CUSTOM3), 두루마리가 없다 */
  private lostScroll(): boolean {
    return (this.has(A5Q3, QFLAG.REWARDGRANTED) || this.has(A5Q3, QFLAG.COMPLETEDBEFORE)) && !this.q3.rewarded
      && this.has(A5Q3, QFLAG.CUSTOM4) && !this.has(A5Q3, QFLAG.CUSTOM3) && !this.item('tr2');
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
    this.scrollQ3(npc, index);
    this.scrollQ4(npc, index);
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

  /** 출처: ACT5Q3_Callback11_ScrollMessage */
  private scrollQ3(npc: string, index: number): void {
    const d = this.Q(A5Q3), x = this.q3;
    if (npc === 'malah' && index === 20116) {
      x.malahIntro = true;
      d.state = 2;
      this.updateFlags(A5Q3);
      return;
    }
    if (npc === 'malah' && index === 20127) {
      // 해동 물약 (Malah's Potion 'ice')
      if (!this.item('ice') && !x.potions && this.h.giveItem('ice', 0, QUALITY.NORMAL)) {
        x.potions++;
        x.malahActivated = true;
      }
      return;
    }
    if (npc === 'malah' && index === 20132) {
      if (!this.has(A5Q3, QFLAG.REWARDPENDING) || this.has(A5Q3, QFLAG.REWARDGRANTED)) {
        // 잃어버린 두루마리를 다시 (이번 게임에 한 번)
        if (this.lostScroll() && this.h.giveItem('tr2', 0, QUALITY.NORMAL)) x.rewarded = true;
        return;
      }
      if (!this.h.giveItem('tr2', 0, QUALITY.NORMAL)) return;
      this.set(A5Q3, QFLAG.CUSTOM4);
      if (this.has(A5Q3, QFLAG.CUSTOM5)) {
        this.clr(A5Q3, QFLAG.REWARDPENDING);
        this.set(A5Q3, QFLAG.REWARDGRANTED);
      } else if (d.notIntro && d.lastState < 6) this.iterate(A5Q3, 6);
      if (x.anya === 1) {
        // Anya 가 아직 얼음 동굴에 있으면 마을로
        this.removeIced();
        x.anya = 2;
        this.spawnDrehyaInTown();
      }
      this.h.emit({ type: 'questReward', quest: A5Q3, act: this.act, reward: 'resistScroll' });
      return;
    }
    if (index === 20131 && d.notIntro) {
      // 얼음 Anya 의 말 (물약 없이 건드림) — Malah 에게 물약을 받으러
      if (d.state <= 3) {
        d.state = 4;
        this.townNpcsLeave();
      }
      if (d.lastState < 3) this.iterate(A5Q3, 3);
      return;
    }
    if (npc !== 'drehya' || index !== 20136) return;
    if (!this.has(A5Q3, QFLAG.REWARDPENDING) || this.has(A5Q3, QFLAG.REWARDGRANTED) || this.has(A5Q3, QFLAG.CUSTOM6)) return;
    // 직업별 레어: 악몽 45 초과 → 고급, 지옥 65 초과 → 엘리트 (원작 nGameType 3 조건은 싱글에 없음)
    const lvl = Math.max(this.h.playerLevel(), 1), diff = this.h.difficulty();
    const tier = diff === 1 && lvl > 45 ? 'exceptional' : diff === 2 && lvl > 65 ? 'elite' : 'normal';
    const list = A5Q3_REWARDS[tier][CLASS_INDEX[this.h.playerClass?.() ?? ''] ?? 4] as readonly string[];
    const code = list[this.h.seed.pick(list.length)] as string;
    if (!this.h.giveItem(code, lvl, QUALITY.RARE)) return;
    this.set(A5Q3, QFLAG.CUSTOM5);
    if (this.has(A5Q3, QFLAG.CUSTOM4)) {
      this.clr(A5Q3, QFLAG.REWARDPENDING);
      this.set(A5Q3, QFLAG.REWARDGRANTED);
    }
    this.set(A5Q3, QFLAG.CUSTOM6);
    this.h.emit({ type: 'questReward', quest: A5Q3, act: this.act, reward: 'rare', code });
  }

  /** 출처: ACT5Q4_Callback11_ScrollMessage — Anya 20137: fState 2, 포털을 열 것, 20148: 로그 다시 + ENTERAREA (이름 새기기 안내), PGD 면 fState 5 */
  private scrollQ4(npc: string, index: number): void {
    if (npc !== 'drehya') return;
    const d = this.Q(A5Q4);
    if (index === 20137) {
      if (!d.notIntro) return;
      d.state = 2;
      this.q4.drehyaActivated = true;
      this.q4.needsPortal = true;
      this.updateFlags(A5Q4);
    } else if (index === 20148) {
      this.iterate(A5Q4, d.lastState);
      this.set(A5Q4, QFLAG.ENTERAREA);
      if (!this.has(A5Q4, QFLAG.PRIMARYGOALDONE) && (d.notIntro || !this.has(A5Q4, QFLAG.REWARDPENDING))) return;
      d.state = 5;
      this.seq(A5Q4);
    }
  }

  /** 출처: ACT5Q4_Callback02_NpcDeactivate — Anya 곁 (x+10, y+5) 에 Nihlathak 의 신전으로 가는 붉은 영구 포털 */
  private deactivateQ4(): void {
    const x = this.q4;
    if (x.drehyaActivated) {
      this.iterate(A5Q4, 1);
      x.drehyaActivated = false;
    }
    if (!x.needsPortal || x.portalCreated) return;
    const at = this.h.npcPos('drehya');
    if (at && this.h.openPortal(TOWN, at.x + 10, at.y + 5, L5.NIHLATHAKSTEMPLE)) {
      x.portalCreated = true;
      x.needsPortal = false;
    }
  }

  npcDeactivate(npc: string): void {
    if (npc === 'drehya') this.deactivateQ4();
    // 출처: ACT5Q3_Callback02_NpcDeactivate
    if (npc === 'malah') {
      const d3 = this.Q(A5Q3);
      if (this.q3.malahIntro) {
        this.iterate(A5Q3, 1);
        this.q3.malahIntro = false;
      }
      if (d3.notIntro && this.q3.malahActivated && d3.lastState < 4) {
        this.iterate(A5Q3, 4);
        this.q3.malahActivated = false;
      }
    }
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
    // 출처: ACT5Q4_OnNihlathakActivated (Nihlathak AI) — 로그 3
    if (ev.type === 'bossActivated' && ev.typeId === 'nihlathakboss') {
      const d = this.Q(A5Q4);
      if (d.notIntro && d.lastState < 3) this.iterate(A5Q4, 3);
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
    // 출처: ACT5Q4_Callback03_ChangedLevel
    const d4 = this.Q(A5Q4);
    if (oldNo === TOWN && d4.state === 2) {
      d4.state = 3;
      this.updateFlags(A5Q4);
    }
    if (newNo === L5.NIHLATHAKSTEMPLE && d4.lastState === 1) {
      this.iterate(A5Q4, 2);
      this.q4.drehyaActivated = false;
    }
    this.changeLevelQ3(oldNo, newNo);
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

  /** 출처: ACT5Q3_Callback03_ChangedLevel */
  private changeLevelQ3(oldNo: number, newNo: number): void {
    const d = this.Q(A5Q3), x = this.q3;
    if (newNo === L5.ARREATPLATEAU) {
      if (d.notIntro && !d.state) {
        d.state = 1;
        this.townNpcsLeave();
      }
    } else if ((newNo === L5.CRYSTALLINEPASSAGE || newNo === L5.ICYCELLAR) && d.notIntro) {
      if (d.state <= 2) d.state = 3;
      if (!d.lastState) this.iterate(A5Q3, 1);
      this.updateFlags(A5Q3);
      this.townNpcsLeave();
    }
    if (oldNo === TOWN) {
      d.guid = false;
      if (d.state === 2) {
        if (this.done(A5Q3)) return;
        d.state = 3;
        if (!d.lastState) this.iterate(A5Q3, 1);
        this.updateFlags(A5Q3);
      }
    }
    // Anya 를 구하기 전에 Nihlathak 의 신전으로: 퀘스트는 다른 곳에서 끝남 (COMPLETEDNOW), fState 6
    if (newNo < L5.NIHLATHAKSTEMPLE || newNo > L5.HALLSOFVAUGHT || !d.notIntro || d.state >= 5) return;
    if (!this.done(A5Q3) && !this.has(A5Q3, QFLAG.PRIMARYGOALDONE)) {
      this.set(A5Q3, QFLAG.COMPLETEDNOW);
      this.h.emit({ type: 'questUpdate', quest: A5Q3, act: this.act, status: this.status(A5Q3) });
    }
    d.state = 6;
    x.anya = 2;
    x.nihLeft = true;
  }

  /**
   * 출처: sub_6FCB4400 — 마을 Anya (녹기 전에 섰다면) 와 Nihlathak 을 없앤다 (Nihlathak 은 HP 0 · MONMODE_DEAD, 마을 오브젝트 QUESTFN 이
   *   ACT5Q3_RemoveNihlathakFromTown 을 다시 부름). unk0x88 = 1 (Nihlathak 이 떠남 — 신전 Nihlathak 이 선다)
   */
  private townNpcsLeave(): void {
    const x = this.q3;
    if (x.drehyaTownId >= 0 && x.anya !== 2) {
      this.h.removeUnit?.(TOWN, x.drehyaTownId);
      x.drehyaTownId = -1;
    }
    if (x.nihTownId >= 0) {
      this.h.removeUnit?.(TOWN, x.nihTownId);
      x.nihTownId = -1;
    }
    x.nihLeft = true;
  }

  /** Nihlathak 이 마을을 떠났다 (A5Q4 신전 Nihlathak — OBJECTS_InitFunction69 조건) */
  nihlathakLeft(): boolean {
    return this.q3.nihLeft;
  }

  /** 출처: ACT5Q3_RemoveDrehyaIced — 얼음 동굴의 Anya (DrehyaIced) 를 없앤다 */
  private removeIced(): void {
    const x = this.q3;
    if (x.icedId < 0) return;
    this.h.removeUnit?.(x.icedLevel, x.icedId);
    x.icedId = -1;
  }

  /**
   * 출처: ACT5Q3_SpawnDrehyaInTown (sub_6FCB53D0 → unk0x84 = 2) — 마을 Anya 자리 (오브젝트 459) 에 Anya (QUESTS_SpawnCriticalMonster)
   *   와 그 자리에 붉은 포털 (OBJECT_CAINPORTAL). 그 뒤 차례 (SeqCallback)
   */
  private spawnDrehyaInTown(): void {
    const x = this.q3, at = x.townObj;
    if (!at || x.drehyaTownId >= 0) return;
    const id = this.h.spawnMonster(TOWN, 'drehya', at.x, at.y, { npc: true });
    if (id === null) return;
    x.drehyaTownId = id;
    this.h.createObject(TOWN, OBJ_CAINPORTAL, Math.floor(at.x), Math.floor(at.y), 1);
    this.seq(A5Q3);
  }

  /**
   * 출처: AITHINK_Fn031_NpcOutOfTown (DrehyaIced) — 녹은 Anya 가 (x+3, y+3) 로 걸어가 붉은 포털 (ACT5Q3_SpawnDrehyaPortalOutsideTown) 을
   *   열고, 포털로 걸어가 사라진다 (sub_6FCB53D0 — 마을에 Anya·포털). AI 마다 sub_6FCB5430: fLastState < 2 면 로그 2
   * 근사(원작 미확인): 걷기 대신 제자리 — 포털은 25 프레임, 사라지는 것은 75 프레임 뒤 (원작 AI 대기 20 프레임 × 걸음 수 근사)
   */
  private icedLeaves(): void {
    const x = this.q3;
    let step = 0;
    this.timer(25, () => {
      if (x.icedId < 0) return true;
      const d = this.Q(A5Q3);
      if (d.notIntro && d.lastState < 2) this.iterate(A5Q3, 2);
      step++;
      if (step === 1 && !x.portalOut) {
        x.portalOut = !!this.h.createObject(x.icedLevel, OBJ_CAINPORTAL, Math.floor(x.anyaAt.x) + 3, Math.floor(x.anyaAt.y) + 3, 1);
        return false;
      }
      if (step < 3) return false;
      this.removeIced();
      x.anya = 2;
      this.spawnDrehyaInTown();
      return true;
    });
  }

  // ------------------------------------------------------------ 몬스터

  monsterKilled(k: ActsKill): void {
    if (k.superUnique === 'Siege Boss') this.killedShenk(k);
    if (k.typeId === 'prisondoor') this.killedPrisonDoor(k);
    if (k.superUnique === 'Nihlathak Boss') this.killedNihlathak(k);
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
   * 출처: ACT5Q4_Callback08_MonsterKilled — 같은 방·이웃 방에서 A5Q3 을 끝낸 플레이어: REWARDPENDING + PGD, 아니면 COMPLETEDNOW,
   *   PGD 면 소리 82, 전역 PGD, FX 17, fState 4, 8 틱 뒤 로그 4
   */
  private killedNihlathak(k: ActsKill): void {
    const d = this.Q(A5Q4), x = this.q4;
    if (!d.notIntro) return;
    if ((k.byPlayer || k.playerNear) && !this.has(A5Q4, QFLAG.COMPLETEDNOW) && this.done(A5Q3) && !this.done(A5Q4)) {
      this.set(A5Q4, QFLAG.REWARDPENDING);
      this.set(A5Q4, QFLAG.PRIMARYGOALDONE);
    }
    if (!this.done(A5Q4) && !this.has(A5Q4, QFLAG.PRIMARYGOALDONE)) {
      this.set(A5Q4, QFLAG.COMPLETEDNOW);
      this.h.emit({ type: 'questUpdate', quest: A5Q4, act: this.act, status: this.status(A5Q4) });
    }
    if (this.has(A5Q4, QFLAG.PRIMARYGOALDONE)) {
      this.h.emit({ type: 'questSound', sound: 82 });
      this.h.emit({ type: 'questCompleted', quest: A5Q4, act: this.act });
    }
    this.h.global.set(A5Q4, QFLAG.PRIMARYGOALDONE);
    this.h.emit({ type: 'questFx', fx: 17 });
    d.state = 4;
    if (x.timerActive) return;
    x.timerActive = true;
    this.timer(8, () => {
      if (d.lastState !== 4) this.iterate(A5Q4, 4);
      x.timerActive = false;
      return true;
    });
  }

  /** Anya 가 이름을 새겨 줄 수 있다 (SUnitNpc.cpp MONSTER_DREHYA: A5Q4 REWARDPENDING) */
  canPersonalize(): boolean {
    return this.has(A5Q4, QFLAG.REWARDPENDING);
  }

  /** 출처: ACT5Q4_SetRewardGranted */
  personalizeDone(): void {
    this.set(A5Q4, QFLAG.REWARDGRANTED);
    this.clr(A5Q4, QFLAG.REWARDPENDING);
    this.h.emit({ type: 'questReward', quest: A5Q4, act: this.act, reward: 'personalize' });
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
    if (o.type.initFn === 66) return this.initDrehyaTown(o);
    if (o.type.initFn === 67) return this.initDrehyaOutside(o);
    if (o.type.initFn === 68) return this.initNihlathakTown(o);
    if (o.type.initFn === 69) return this.initNihlathakTemple(o);
    if (o.type.initFn === 74) return this.initFrozenAnya(o);
    if (o.type.initFn !== 71 || this.q1.larzukSpawned) return;
    if (this.h.spawnMonster(TOWN, 'larzuk', o.x, o.y, { npc: true }) !== null) this.q1.larzukSpawned = true;
  }

  /** 출처: OBJECTS_InitFunction66_DrehyaStartInTown — 자리를 기억하고, 이미 녹았으면 (unk0x84 2) 마을 Anya 를 세운다 */
  private initDrehyaTown(o: ObjectUnit): void {
    const x = this.q3, x4 = this.q4;
    x.townObj = { x: o.x, y: o.y };
    // 출처: A5Q4 — 불러온 게임에서 포털을 다시 (12 프레임 뒤 QUESTFN: 자리 +10, +5), ACT5Q4_AnyaOpenPortal (끝냈는데 웨이포인트가 꺼져 있음)
    // 근사(원작 미확인): AnyaOpenPortal 은 원작에서 Anya AI 틱마다 — 여기서는 마을 Anya 자리 오브젝트가 생길 때 한 번
    if (x4.needsPortal || x4.wpNotActivated) {
      this.timer(12, () => {
        if (x4.portalCreated) return true;
        if (!this.h.openPortal(TOWN, Math.floor(o.x) + 10, Math.floor(o.y) + 5, L5.NIHLATHAKSTEMPLE)) return false;
        x4.portalCreated = true;
        x4.needsPortal = false;
        x4.wpNotActivated = false;
        return true;
      });
    }
    if (x.anya !== 2) return;
    this.seq(A5Q3);
    if (x.drehyaTownId >= 0) return;
    const id = this.h.spawnMonster(TOWN, 'drehya', o.x, o.y, { npc: true });
    if (id !== null) x.drehyaTownId = id;
  }

  /** 출처: OBJECTS_InitFunction67_DrehyaStartOutsideTown → 25 프레임 뒤 ACT5Q3_SpawnFrozenDrehya — 그 자리에 얼음 Anya 오브젝트 558 */
  private initDrehyaOutside(o: ObjectUnit): void {
    if (!this.Q(A5Q3).notIntro || this.q3.frozenSpawned) return;
    const level = this.h.levelNo();
    this.timer(25, () => {
      const x = this.q3;
      if (x.frozenSpawned || !this.Q(A5Q3).notIntro) return true;
      const f = this.h.createObject(level, OBJ_FROZEN_ANYA, Math.floor(o.x), Math.floor(o.y), 0);
      if (!f) return false;
      x.frozenSpawned = true;
      x.frozenId = f.id;
      x.frozenLevel = level;
      return true;
    });
  }

  /** 출처: OBJECTS_InitFunction68_NihlathakStartInTown — 아직 떠나지 않았으면 마을 Nihlathak */
  private initNihlathakTown(o: ObjectUnit): void {
    const x = this.q3;
    if (x.nihLeft || x.nihTownId >= 0) return;
    const id = this.h.spawnMonster(TOWN, 'nihlathak', o.x, o.y, { npc: true });
    if (id !== null) x.nihTownId = id;
  }

  /** 출처: OBJECTS_InitFunction69_NihlathakStartOutsideTown — Nihlathak 이 마을을 떠났으면 (unk0x88) 그 자리에 슈퍼유니크 Nihlathak (한 번) */
  private initNihlathakTemple(o: ObjectUnit): void {
    const x = this.q3;
    if (!x.nihLeft || x.nihTempleSpawned) return;
    if (this.h.spawnSuperUnique?.('Nihlathak Boss', Math.floor(o.x), Math.floor(o.y)) != null) x.nihTempleSpawned = true;
  }

  /** 출처: OBJECTS_InitFunction74_FrozenAnya — fLastState < 2 면 로그 2 ("Rescue Anya") */
  private initFrozenAnya(o: ObjectUnit): void {
    const d = this.Q(A5Q3);
    this.q3.frozenId = o.id;
    if (d.notIntro && d.lastState < 2) this.iterate(A5Q3, 2);
  }

  /**
   * 출처: OBJECTS_OperateFunction67_FrozenAnya — 물약이 있으면: 물약을 지우고 fState 5, unk0x84 = 1, PGD + REWARDPENDING, 로그 5, FX 16,
   *   타이머 (ACT5Q3_SpawnDrehyaIcedMonsterOutsideTown: 첫 번째 = 오브젝트 OPENED, 두 번째 = 그 자리에 DrehyaIced, 오브젝트 없앰).
   *   물약이 없으면 대사 20131, fLastState 1 이면 로그 3
   */
  private operateFrozenAnya(o: ObjectUnit): boolean {
    const d = this.Q(A5Q3), x = this.q3;
    if (!this.item('ice')) {
      this.h.emit({ type: 'questSpeech', npcId: o.id, typeId: 'drehyaiced', quest: A5Q3, index: 20131, key: 'A5Q3FoundAnyaAnya' });
      if (d.lastState === 1) this.iterate(A5Q3, 3);
      this.scrollQ3('drehyaiced', 20131);
      return true;
    }
    if (this.done(A5Q3)) return true;
    x.potions = Math.max(0, x.potions - 1);
    this.h.deleteItem('ice');
    d.state = 5;
    x.anya = 1;
    this.set(A5Q3, QFLAG.PRIMARYGOALDONE);
    this.set(A5Q3, QFLAG.REWARDPENDING);
    this.iterate(A5Q3, 5);
    this.h.emit({ type: 'questFx', fx: 16 });
    this.h.emit({ type: 'questCompleted', quest: A5Q3, act: this.act });
    if (x.timerActive) return true;
    x.timerActive = true;
    x.anyaAt = { x: o.x, y: o.y };
    const level = this.h.levelNo();
    this.timer(1, () => {
      if (x.timerStep === 0) {
        this.h.setObjectMode(o, OBJMODE.OPENED);
        x.timerStep = 1;
        return false;
      }
      x.timerStep = 2;
      const id = this.h.spawnMonster(level, 'drehyaiced', x.anyaAt.x, x.anyaAt.y, { npc: true });
      if (id === null) return false;
      this.h.removeUnit?.(level, o.id);
      x.icedId = id;
      x.icedLevel = level;
      this.seq(A5Q3);
      x.timerActive = false;
      this.icedLeaves();
      return true;
    });
    return true;
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

  operate(o: ObjectUnit): boolean {
    if (o.type.id === OBJ_FROZEN_ANYA) return this.operateFrozenAnya(o);
    return false;
  }

  /**
   * 저항 두루마리 (tr2). 출처: ItemMode.cpp (' 2rt') — CUSTOM4 이고 아직 안 읽었으면 CUSTOM3, ACT5Q3_ApplyResistanceReward (+10 저항,
   *   Game.questResist 가 기록에서 다시 계산), 로그 갱신, 두루마리 없앰. 아니면 쓰지 못함 (소리 19)
   */
  override useItem(code: string): boolean {
    if (code !== 'tr2' || !this.has(A5Q3, QFLAG.CUSTOM4) || this.has(A5Q3, QFLAG.CUSTOM3)) return false;
    this.set(A5Q3, QFLAG.CUSTOM3);
    this.h.emit({ type: 'questUpdate', quest: A5Q3, act: this.act, status: this.status(A5Q3) });
    this.h.emit({ type: 'questReward', quest: A5Q3, act: this.act, reward: 'resist', amount: 10 });
    return true;
  }

  itemPickedUp(_code: string): void {}

  // ------------------------------------------------------------ 퀘스트 로그

  /**
   * 출처: ACT5Q3_StatusFilterCallback — 보상 받음 0, 보상 대기·PGD: 두루마리만 받음 6 / 둘 다 아직 5 / 그 밖 13,
   *   물약을 가짐 4, COMPLETEDNOW 12, 진행 중이면 fLastState
   */
  /** 출처: ACT5Q4_StatusFilterCallback — 보상 받음 0, 대기·PGD 면 4 (Anya 와 이야기했으면 5), COMPLETEDNOW 12, 진행 중 fLastState */
  private statusQ4(): number {
    const d = this.Q(A5Q4);
    if (this.has(A5Q4, QFLAG.REWARDGRANTED)) return 0;
    if (this.has(A5Q4, QFLAG.REWARDPENDING) || this.has(A5Q4, QFLAG.PRIMARYGOALDONE)) return this.has(A5Q4, QFLAG.ENTERAREA) ? 5 : 4;
    if (!d.notIntro) return 0;
    if (this.has(A5Q4, QFLAG.COMPLETEDNOW)) return 12;
    return d.state < 4 ? d.lastState : 0;
  }

  private statusQ3(): number {
    const d = this.Q(A5Q3);
    if (this.has(A5Q3, QFLAG.REWARDGRANTED)) return 0;
    if (this.has(A5Q3, QFLAG.REWARDPENDING) || this.has(A5Q3, QFLAG.PRIMARYGOALDONE)) {
      if (this.has(A5Q3, QFLAG.CUSTOM4) && !this.has(A5Q3, QFLAG.CUSTOM5)) return 6;
      return this.has(A5Q3, QFLAG.CUSTOM4) ? 13 : 5;
    }
    if (!d.notIntro) return 0;
    if (this.item('ice')) return 4;
    if (this.has(A5Q3, QFLAG.COMPLETEDNOW)) return 12;
    return d.state < 5 ? d.lastState : 0;
  }

  protected override logCount(w: number): number {
    return w === A5Q2 ? this.barbsToRescue() : 0;
  }

  /** 출처: ACT5Q1_StatusFilterCallback — 보상 대기·PGD 면 3 (소켓 뚫으면 4), 진행 중이면 fLastState (COMPLETEDNOW 면 12) */
  protected override statusFilter(w: number): number | undefined {
    if (w === A5Q3) return this.statusQ3();
    if (w === A5Q4) return this.statusQ4();
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
