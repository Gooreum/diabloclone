// Act 3 퀘스트 6개 상태 기계 (Lam Esen's Tome · Khalim's Will · Blade of the Old Religion · The Golden Bird · The Blackened Temple · The Guardian).
// 출처: D2MOO D2Game/src/QUESTS/ACT3/A3Q1.cpp ~ A3Q6.cpp (콜백: NpcActivate / NpcDeactivate / ChangedLevel / MonsterKilled / ScrollMessage /
//       ItemPickedUp / ItemDropped / PlayerStartedGame, SeqCallback, ActiveFilter, StatusFilter, 오브젝트 Operate/Init 함수)
//       D2Game/src/QUESTS/Quests.cpp (QUESTS_SequenceCycler — 게임 시작 때 퀘스트 18(A3Q4) 의 SeqCallback, QUESTS_LevelWarpCheck — 증오의 억류지,
//       QUESTS_SetJadeFigurineBoss — Act 3 의 첫 보스가 옥 조각상을 떨어뜨린다, QUESTS_MonsterSpawn → ACT3Q5_SpawnCouncil)
//       D2Game/src/MONSTER/MonsterSpawn.cpp·MonsterUnique.cpp (퀘스트 연결: fetish11 → A3Q3, compellingorb·평의회 3명 → A3Q5, mephisto → A3Q6)
// (https://github.com/ThePhrozenKeep/D2MOO)
// 싱글플레이: 파티·다른 플레이어 GUID 목록은 "플레이어가 목록에 있음" 불리언 하나로 줄였다.
import { OBJMODE, type ObjectUnit } from '../objects';
import { QUALITY } from '../treasure';
import type { QuestSpeech } from './act1';
import { QFLAG } from './record';
import { ActQuestBase, QuestData, type ActsKill, type ActsQuestHost } from './acts-base';
import { QW } from './messages-acts';

/** Act 3 levels.txt 번호 (출처: LevelsIds.h) */
export const L3 = {
  KURASTDOCKS: 75, GREATMARSH: 77, FLAYERJUNGLE: 78, LOWERKURAST: 79, KURASTCAUSEWAY: 82, TRAVINCAL: 83,
  KURASTSEWERS1: 92, KURASTSEWERS2: 93, RUINEDFANE: 98, DURANCE1: 100, DURANCE2: 101, DURANCE3: 102, OUTERSTEPPES: 104,
} as const;

/** 출처: objects.txt — 193 Lam Esen 의 책, 251 기드빈 제단, 252 기드빈 미끼, 341 메피스토 다리, 342 지옥문, 366/367 하수도 계단·레버, 386 억류지 계단, 404 강요의 구슬 */
export const OBJ3 = { LAMTOME: 193, GIDBINN_ALTAR: 251, GIDBINN: 252, BRIDGE: 341, HELLGATE: 342, SEWER_STAIRS: 366, SEWER_LEVER: 367, DURANCE_STAIRS: 386, ORB: 404 } as const;

/** 출처: MonsterUnique.cpp — SUPERUNIQUE_ISMAIL_VILEHAND·GELEB_FLAMEFINGER·TOORC_ICEFIST (QUESTS_MonsterSpawn → ACT3Q5_SpawnCouncil) */
export const COUNCIL_SUPERUNIQUES = ['Ismail Vilehand', 'Geleb Flamefinger', 'Toorc Icefist'];

const { A3Q1, A3Q2, A3Q3, A3Q4, A3Q5, A3Q6 } = QW;
const TOWN = L3.KURASTDOCKS;
const KHALIM = ['qey', 'qhr', 'qbr', 'qf1'] as const;

/**
 * Act 3 퀘스트 제어.
 * 출처: Quests.cpp gpQuestInitTable — A3Q1 (InitNo 4, Seq 19), A3Q2 (0, Seq 15), A3Q3 (4, Seq 15), A3Q4 (0, Seq 16), A3Q5 (6, Seq 20), A3Q6 (6)
 */
export class Act3Quests extends ActQuestBase {
  readonly act = 2;
  // A3Q1 (D2Act3Quest1Strc)
  private q1 = { tomeActive: false, tomes: 0, canGetReward: true, tomeBrought: false };
  // A3Q2 (D2Act3Quest2Strc)
  private q2 = { talkedCain: false, stairsMode: 0 as number, stairs: null as ObjectUnit | null };
  // A3Q3 (D2Act3Quest3Strc)
  private q3 = {
    altarMode: 0 as number, hratliActivated: false, broughtToOrmus: false, decoy: null as { x: number; y: number } | null, decoyActivated: false,
    bossSpawned: false, bossSpawning: false, bossId: -1, gidbinnDropped: false, spawnTimer: false,
  };
  // A3Q4 (D2Act3Quest4Strc)
  private q4 = { canDrop: true, bossArmed: true, cainOnce: false, cainTwice: false, alkor: false, meshif: false, birdBrought: false, jadeDropped: false };
  // A3Q5 (D2Act3Quest5Strc)
  private q5 = { council: [] as number[], left: 0, spawned: false, orbSmashed: false, hits: 0, ormusActivated: false, flailDropped: false, cubeDropped: false, orbPlaced: false };
  // A3Q6 (D2Act3Quest6Strc)
  private q6 = { ormusActivated: false, hellgateMode: 0 as number, bridgeMode: 0 as number, soulstones: 0, timer: false };

  constructor(h: ActsQuestHost) {
    super(h);
    this.q[A3Q1] = new QuestData(A3Q1, 4);
    this.q[A3Q2] = new QuestData(A3Q2, 0);
    this.q[A3Q3] = new QuestData(A3Q3, 4);
    this.q[A3Q4] = new QuestData(A3Q4, 0);
    this.q[A3Q5] = new QuestData(A3Q5, 6);
    this.q[A3Q6] = new QuestData(A3Q6, 6);
    // 출처: ACT3Q2_InitQuestData fLastState 1
    this.Q(A3Q2).lastState = 1;
  }

  /** 강요의 구슬을 부쉈다 (ACT3Q5 bOrbSmashed — 증오의 억류지 입구가 열림) */
  get orbSmashed(): boolean {
    return this.q5.orbSmashed;
  }

  // ------------------------------------------------------------ 게임 시작

  startGame(): void {
    this.startCommon();
    this.startedQ6();
    this.startedQ5();
    this.startedQ4();
    this.startedQ3();
    this.startedQ2();
    this.startedQ1();
    // 출처: QUESTS_SequenceCycler — 퀘스트 18 (A3Q4) 의 SeqCallback
    this.seq(A3Q4);
  }

  /** 출처: ACT3Q1_Callback13_PlayerStartedGame */
  private startedQ1(): void {
    const d = this.Q(A3Q1);
    if (this.has(A3Q1, QFLAG.REWARDGRANTED)) {
      this.h.global.set(A3Q1, QFLAG.PRIMARYGOALDONE);
      return;
    }
    if (this.item('bbb')) {
      [d.state, d.lastState] = [4, 2];
      this.q1.tomeActive = true;
      this.q1.tomes++;
    } else if (this.has(A3Q1, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [3, 1];
    else if (this.has(A3Q1, QFLAG.STARTED)) [d.state, d.lastState] = [2, 1];
  }

  /** 출처: ACT3Q2_Callback13_PlayerStartedGame */
  private startedQ2(): void {
    const d = this.Q(A3Q2);
    if (this.has(A3Q2, QFLAG.REWARDGRANTED)) return;
    if (this.has(A3Q2, QFLAG.CUSTOM3) || this.has(A3Q2, QFLAG.STARTED)) [d.state, d.lastState] = [2, 7];
  }

  /** 출처: ACT3Q3_Callback13_PlayerStartedGame */
  private startedQ3(): void {
    const d = this.Q(A3Q3), x = this.q3;
    if (this.has(A3Q3, QFLAG.REWARDGRANTED)) x.altarMode = OBJMODE.OPENED;
    else if (this.item('g33')) {
      [d.lastState, d.state] = [4, 4];
      this.updateFlagsQ3();
    } else if (this.has(A3Q3, QFLAG.CUSTOM2)) {
      x.altarMode = OBJMODE.OPENED;
      d.state = 5;
      if (this.has(A3Q3, QFLAG.CUSTOM3)) {
        if (this.has(A3Q3, QFLAG.CUSTOM4)) {
          this.set(A3Q3, QFLAG.REWARDGRANTED);
          d.notIntro = false;
        } else d.lastState = 6;
      } else d.lastState = 5;
    } else {
      if (this.has(A3Q3, QFLAG.CUSTOM1)) [d.state, d.lastState] = [3, 2];
      if (this.has(A3Q3, QFLAG.ENTERAREA) || this.has(A3Q3, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [2, 2];
      else if (this.has(A3Q3, QFLAG.STARTED)) [d.state, d.lastState] = [3, 1];
    }
  }

  /** 출처: ACT3Q4_Callback13_PlayerStartedGame */
  private startedQ4(): void {
    const d = this.Q(A3Q4), x = this.q4;
    if (this.done(A3Q4)) {
      d.notIntro = false;
      x.bossArmed = false;
      x.canDrop = false;
      return;
    }
    if (this.item('g34')) {
      x.bossArmed = x.canDrop = false;
      [d.state, d.lastState] = [3, this.has(A3Q4, QFLAG.ENTERAREA) ? 4 : 3];
    } else if (this.item('j34')) {
      x.bossArmed = x.canDrop = false;
      [d.state, d.lastState] = this.has(A3Q4, QFLAG.STARTED) ? [2, 2] : [1, 1];
    }
  }

  /** 출처: ACT3Q5_Callback13_PlayerStartedGame */
  private startedQ5(): void {
    const d = this.Q(A3Q5), x = this.q5;
    if (this.has(A3Q2, QFLAG.REWARDGRANTED)) x.orbSmashed = true;
    if (this.has(A3Q5, QFLAG.REWARDGRANTED) || this.has(A3Q5, QFLAG.ENTERAREA)) {
      this.h.global.set(A3Q5, QFLAG.PRIMARYGOALDONE);
      d.notIntro = false;
      return;
    }
    const tome = this.has(A3Q1, QFLAG.REWARDGRANTED);
    if (this.has(A3Q5, QFLAG.STARTED)) {
      if (this.has(A3Q5, QFLAG.LEAVETOWN)) [d.lastState, d.state] = [3, tome ? 4 : 5];
      else [d.lastState, d.state] = [2, tome ? 2 : 3];
    } else if (this.has(A3Q5, QFLAG.LEAVETOWN)) [d.lastState, d.state] = [3, tome ? 4 : 5];
  }

  /** 출처: ACT3Q6_Callback13_PlayerStartedGame */
  private startedQ6(): void {
    const d = this.Q(A3Q6), x = this.q6;
    if (this.has(A3Q6, QFLAG.REWARDGRANTED) || this.has(A3Q6, QFLAG.CUSTOM7) || this.has(QW.A3COMPLETED, QFLAG.REWARDGRANTED)) {
      this.h.global.set(A3Q6, QFLAG.PRIMARYGOALDONE);
      x.hellgateMode = OBJMODE.OPENED;
      // 근사(원작 미확인): 원작은 ACT3Q6_SetObjectModes 로 다리도 올린다 — 호출 위치 미확인, 여기서는 지옥문과 함께
      x.bridgeMode = OBJMODE.OPENED;
      return;
    }
    const table: [number, number, number][] = [[QFLAG.CUSTOM5, 5, 4], [QFLAG.CUSTOM4, 5, 3], [QFLAG.CUSTOM3, 5, 2], [QFLAG.CUSTOM2, 4, 4], [QFLAG.CUSTOM1, 4, 3],
      [QFLAG.ENTERAREA, 4, 2], [QFLAG.LEAVETOWN, 2, 2], [QFLAG.STARTED, 3, 2]];
    for (const [f, s, l] of table) {
      if (this.has(A3Q6, f)) {
        [d.state, d.lastState] = [s, l];
        return;
      }
    }
  }

  /**
   * 퀘스트 차례 (SeqCallback). 출처: ACT3Q4 (→ 16 A3Q2 와 A3Q3), ACT3Q2·ACT3Q3 (fState 0 → 1, 끝나면 → 15 A3Q1), ACT3Q1 (→ 19 A3Q5), ACT3Q5 (→ 20 A3Q6), ACT3Q6 (fState 1)
   */
  private seq(w: number): boolean {
    const d = this.Q(w);
    switch (w) {
      case A3Q4: {
        if (d.state !== 5 && d.notIntro) return true;
        const r = this.seq(A3Q2);
        return this.seq(A3Q3) || r;
      }
      case A3Q2:
      case A3Q3:
        if (d.state !== 5 && d.notIntro) {
          if (!d.state) d.state = 1;
          return true;
        }
        return this.seq(A3Q1);
      case A3Q1:
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(A3Q5);
      case A3Q5:
        if (d.state !== 7 && d.notIntro) return true;
        return this.seq(A3Q6);
      case A3Q6:
        if (!d.state && d.notIntro) d.state = 1;
        return true;
    }
    return true;
  }

  // ------------------------------------------------------------ 상태 플래그

  private updateFlagsQ3(): void {
    // 출처: ACT3Q3_UnitIterate_UpdateQuestStateFlags
    if (this.has(A3Q3, QFLAG.REWARDGRANTED) || this.has(A3Q3, QFLAG.CUSTOM2)) return;
    if (this.item('g33')) {
      this.set(A3Q3, QFLAG.CUSTOM1);
      return;
    }
    if (this.q3.gidbinnDropped) {
      this.set(A3Q3, QFLAG.ENTERAREA);
      if (!this.has(A3Q3, QFLAG.LEAVETOWN)) this.set(A3Q3, QFLAG.STARTED);
    } else if (this.Q(A3Q3).state === 2) this.set(A3Q3, QFLAG.LEAVETOWN);
  }

  /** 출처: ACT3Q1/Q5/Q6_UnitIterate_UpdateQuestStateFlags */
  private updateFlags(w: number): void {
    const d = this.Q(w);
    if (w === A3Q1) {
      if (this.done(A3Q1)) return;
      if (d.state === 2 || d.state === 3) this.set(A3Q1, QFLAG.STARTED);
    } else if (w === A3Q5) {
      if (this.has(A3Q5, QFLAG.REWARDGRANTED)) return;
      if (d.state >= 2 && d.state <= 3) this.set(A3Q5, QFLAG.STARTED);
      if (this.q5.spawned) this.set(A3Q5, QFLAG.LEAVETOWN);
    } else if (w === A3Q6) {
      if (this.has(A3Q6, QFLAG.REWARDGRANTED) || this.has(A3Q6, QFLAG.CUSTOM7)) return;
      if (d.state === 2) this.set(A3Q6, QFLAG.STARTED);
      else if (d.state === 3) this.set(A3Q6, QFLAG.LEAVETOWN);
      else if (d.state === 4) {
        const f = ({ 2: QFLAG.ENTERAREA, 3: QFLAG.CUSTOM1, 4: QFLAG.CUSTOM2 } as Record<number, number>)[d.lastState];
        if (f !== undefined) this.set(A3Q6, f);
      } else if (d.state === 5) {
        const f = ({ 2: QFLAG.CUSTOM3, 3: QFLAG.CUSTOM4, 4: QFLAG.CUSTOM5 } as Record<number, number>)[d.lastState];
        if (f !== undefined) this.set(A3Q6, f);
      }
    }
  }

  // ------------------------------------------------------------ NPC

  npcHasQuest(npc: string): boolean {
    return [A3Q6, A3Q5, A3Q4, A3Q3, A3Q2, A3Q1].some((w) => this.activeFilter(w, npc));
  }

  /** 출처: ACT3Qn_ActiveFilterCallback */
  private activeFilter(w: number, npc: string): boolean {
    const d = this.Q(w), G = QFLAG.REWARDGRANTED;
    switch (w) {
      case A3Q1:
        if (npc !== 'alkor') return false;
        return (d.state === 1 && !this.has(A3Q1, G) && !this.has(A3Q1, QFLAG.COMPLETEDBEFORE)) || this.item('bbb');
      case A3Q2: {
        if (npc !== 'cain3') return false;
        if (d.state >= 1 && !this.has(A3Q2, QFLAG.STARTED)) return true;
        let parts = 0;
        const part = (code: string, f: number): boolean => {
          if (!this.item(code)) return false;
          parts++;
          return !this.has(A3Q2, f);
        };
        if (part('qf1', QFLAG.CUSTOM1)) return true;
        if (part('qey', QFLAG.LEAVETOWN)) return true;
        if (part('qhr', QFLAG.CUSTOM2)) return true;
        if (part('qbr', QFLAG.ENTERAREA)) return true;
        if (this.item('qf2') && !this.has(A3Q2, QFLAG.CUSTOM3) && !this.q5.orbSmashed) return true;
        return parts === 4 && !this.has(A3Q2, QFLAG.CUSTOM1);
      }
      case A3Q3:
        if (this.has(A3Q3, G)) return false;
        if (npc === 'hratli') return !this.item('g33') && d.state === 1;
        if (npc === 'ormus') return this.item('g33') || (this.has(A3Q3, QFLAG.CUSTOM2) && !this.has(A3Q3, QFLAG.CUSTOM4));
        if (npc === 'asheara') return this.has(A3Q3, QFLAG.CUSTOM2) && !this.has(A3Q3, QFLAG.CUSTOM3);
        return false;
      case A3Q4:
        if (this.done(A3Q4)) return false;
        if (npc === 'alkor') return this.item('g34');
        if (npc === 'meshif2') return this.item('j34');
        if (npc === 'cain3') return (this.item('j34') && !this.has(A3Q4, QFLAG.STARTED)) || (this.item('g34') && !this.has(A3Q4, QFLAG.ENTERAREA));
        return false;
      case A3Q5:
        if (this.has(A3Q5, G)) return false;
        if (npc === 'ormus') return d.state === 1;
        if (npc === 'cain3') return this.has(A3Q5, QFLAG.ENTERAREA) && !this.q5.orbSmashed;
        return false;
      case A3Q6:
        if (this.has(A3Q6, G) || npc !== 'ormus' || d.state !== 1) return this.has(A3Q6, QFLAG.CUSTOM7);
        return true;
    }
    return false;
  }

  npcActivate(npc: string): QuestSpeech[] {
    const out: QuestSpeech[] = [];
    for (const w of [A3Q6, A3Q5, A3Q4, A3Q3, A3Q2, A3Q1]) this.npcActivateOne(w, npc, out);
    return out;
  }

  private npcActivateOne(w: number, npc: string, out: QuestSpeech[]): void {
    const d = this.Q(w), G = QFLAG.REWARDGRANTED, PGD = QFLAG.PRIMARYGOALDONE;
    switch (w) {
      case A3Q1: { // 출처: ACT3Q1_Callback00_NpcActivate
        if (this.has(A3Q1, G) && !this.has(A3Q1, PGD)) return;
        if (this.item('bbb')) return this.chain(w, 3, npc, out);
        if (this.has(A3Q1, G)) {
          if (d.guid) this.chain(w, 4, npc, out);
          return;
        }
        if (d.notIntro && d.state < 4) {
          const i = [-1, 0, 1, 2, 3, 4][d.state] ?? -1;
          if (i !== -1) this.chain(w, i, npc, out);
        }
        return;
      }
      case A3Q2: { // 출처: ACT3Q2_Callback00_NpcActivate
        if (npc !== 'cain3') return;
        if (d.state >= 1 && !this.has(A3Q2, QFLAG.STARTED)) return this.chain(w, 0, npc, out);
        const cubed = this.item('qf2');
        if (cubed && !this.has(A3Q2, QFLAG.CUSTOM3) && !this.q5.orbSmashed) return this.chain(w, 5, npc, out);
        const base = this.item('qf1'), eye = this.item('qey'), heart = this.item('qhr'), brain = this.item('qbr');
        if (base && !this.has(A3Q2, QFLAG.CUSTOM1)) return this.chain(w, 4, npc, out);
        if (eye && !this.has(A3Q2, QFLAG.LEAVETOWN)) return this.chain(w, 1, npc, out);
        if (heart && !this.has(A3Q2, QFLAG.CUSTOM2)) return this.chain(w, 2, npc, out);
        if (brain && !this.has(A3Q2, QFLAG.ENTERAREA)) return this.chain(w, 3, npc, out);
        if (!base && !eye && !heart && !brain) {
          if (cubed) this.chain(w, 11, npc, out);
          else if (this.has(A3Q2, QFLAG.STARTED)) this.chain(w, 6, npc, out);
          return;
        }
        if (base) return this.chain(w, 10, npc, out);
        if (heart) return this.chain(w, 8, npc, out);
        if (eye) return this.chain(w, 7, npc, out);
        return this.chain(w, brain ? 9 : 6, npc, out);
      }
      case A3Q3: { // 출처: ACT3Q3_Callback00_NpcActivate
        if (this.has(A3Q3, G)) {
          if (d.guid) this.chain(w, 4, npc, out);
          return;
        }
        if (this.item('g33') && this.has(A3Q3, QFLAG.CUSTOM1) && !this.has(A3Q3, QFLAG.CUSTOM4)) return this.chain(w, 3, npc, out);
        if (this.has(A3Q3, QFLAG.CUSTOM2)) {
          if (npc === 'asheara') {
            if (!this.has(A3Q3, QFLAG.CUSTOM3)) return this.chain(w, 5, npc, out);
          } else {
            if (npc === 'ormus' && !this.has(A3Q3, QFLAG.CUSTOM4)) return this.chain(w, 6, npc, out);
            if (!this.has(A3Q3, QFLAG.CUSTOM3)) return this.chain(w, 5, npc, out);
          }
          if (!this.has(A3Q3, QFLAG.CUSTOM4)) this.chain(w, 6, npc, out);
          return;
        }
        if (this.has(A3Q3, QFLAG.CUSTOM1)) return this.chain(w, 4, npc, out);
        if (d.state < 4 && !this.item('g33')) {
          const i = [-1, 0, 1, 2, 3, 4][d.state] ?? -1;
          if (i !== -1) this.chain(w, i, npc, out);
        }
        return;
      }
      case A3Q4: { // 출처: ACT3Q4_Callback00_NpcActivate
        const x = this.q4;
        if (this.has(A3Q4, G)) {
          if (d.guid) this.chain(w, 6, npc, out);
          return;
        }
        if (npc === 'alkor' && x.birdBrought) return;
        if (this.has(A3Q4, QFLAG.REWARDPENDING)) return this.chain(w, 5, npc, out);
        if (!this.item('g34')) {
          if (!this.item('j34')) return;
          if (npc === 'cain3' || npc === 'asheara') return this.chain(w, this.has(A3Q4, QFLAG.STARTED) ? 7 : 0, npc, out);
          return this.chain(w, 1, npc, out);
        }
        if (npc === 'cain3') return this.chain(w, this.has(A3Q4, QFLAG.ENTERAREA) ? 2 : 3, npc, out);
        return this.chain(w, 2, npc, out);
      }
      case A3Q5: { // 출처: ACT3Q5_Callback00_NpcActivate
        if (this.has(A3Q5, QFLAG.ENTERAREA)) {
          if (!this.q5.orbSmashed) this.chain(w, 5, npc, out);
          return;
        }
        if (!this.has(A3Q5, G) || d.guid) {
          if (d.state < 6) {
            if (d.notIntro) {
              const i = [-1, 0, 1, 2, 3, 4, 5, 6][d.state] ?? -1;
              if (i !== -1) this.chain(w, i, npc, out);
            }
          } else if (this.has(A3Q5, PGD)) this.chain(w, 6, npc, out);
        }
        return;
      }
      case A3Q6: { // 출처: ACT3Q6_Callback00_NpcActivate
        if (this.has(A3Q6, QFLAG.CUSTOM7)) return this.chain(w, 5, npc, out);
        if (this.has(A3Q6, G)) {
          if (d.guid) this.chain(w, 6, npc, out);
        } else if (d.state < 6) {
          const i = [-1, 0, 1, 2, 3, 4, 5, 6][d.state] ?? -1;
          if (i !== -1) this.chain(w, i, npc, out);
        } else if (this.has(A3Q6, PGD)) this.chain(w, 6, npc, out);
        return;
      }
    }
  }

  scrollMessage(npc: string, index: number): void {
    this.scrollQ1(npc, index);
    this.scrollQ2(npc, index);
    this.scrollQ3(npc, index);
    this.scrollQ4(npc, index);
    this.scrollQ5(npc, index);
    this.scrollQ6(npc, index);
  }

  /** 출처: ACT3Q1_Callback11_ScrollMessage — 564: Lam Esen 의 책을 Alkor 에게 → 스탯 포인트 5 */
  private scrollQ1(npc: string, index: number): void {
    const d = this.Q(A3Q1), x = this.q1;
    if (this.has(A3Q1, QFLAG.REWARDGRANTED) || npc !== 'alkor') return;
    if (index === 549) {
      d.state = 2;
      this.iterate(A3Q1, 1);
      this.updateFlags(A3Q1);
    } else if (index === 564) {
      if (this.item('bbb')) {
        this.h.deleteItem('bbb');
        x.tomeBrought = true;
      }
      if (x.canGetReward) {
        // 출처: ACT3Q1_UnitIterate_SetPrimaryGoalDone (Act 3 에 있는 플레이어) → AddStatPointReward (REWARDPENDING 이면 STAT_STATPTS +5)
        if (!this.done(A3Q1)) {
          this.set(A3Q1, QFLAG.PRIMARYGOALDONE);
          this.set(A3Q1, QFLAG.REWARDGRANTED);
          this.set(A3Q1, QFLAG.REWARDPENDING);
        }
        x.canGetReward = false;
        if (this.has(A3Q1, QFLAG.REWARDPENDING)) {
          this.h.addStatPoints(5);
          this.clr(A3Q1, QFLAG.REWARDPENDING);
          this.h.emit({ type: 'questReward', quest: A3Q1, act: this.act, reward: 'statPoints', amount: 5 });
        }
      }
      this.iterate(A3Q1, 13, false);
      d.guid = true;
      if (!this.has(A3Q1, QFLAG.PRIMARYGOALDONE) || !d.notIntro) return;
      this.h.global.set(A3Q1, QFLAG.PRIMARYGOALDONE);
      if (d.state === 5) return;
      d.state = 5;
      this.seq(A3Q1);
    }
  }

  /** 출처: ACT3Q2_Callback11_ScrollMessage — Cain 이 조각마다 알려 준 표시 */
  private scrollQ2(npc: string, index: number): void {
    if (npc !== 'cain3') return;
    const f = ({ 545: QFLAG.LEAVETOWN, 544: QFLAG.CUSTOM2, 546: QFLAG.ENTERAREA, 547: QFLAG.CUSTOM1, 548: QFLAG.CUSTOM3 } as Record<number, number>)[index];
    if (index === 543) {
      this.Q(A3Q2).state = 2;
      this.set(A3Q2, QFLAG.STARTED);
      this.q2.talkedCain = true;
    } else if (f !== undefined) this.set(A3Q2, f);
  }

  /** 출처: ACT3Q3_Callback11_ScrollMessage — Ormus 587 기드빈 돌려줌 / 593 반지, Asheara 589 무료 용병, Hratli 571 시작 */
  private scrollQ3(npc: string, index: number): void {
    const d = this.Q(A3Q3), x = this.q3;
    if (this.has(A3Q3, QFLAG.REWARDGRANTED)) return;
    if (npc === 'ormus') {
      if (index === 587) {
        if (this.item('g33') && this.has(A3Q3, QFLAG.CUSTOM1) && !this.has(A3Q3, QFLAG.CUSTOM4)) {
          x.broughtToOrmus = true;
          this.h.deleteItem('g33');
          this.set(A3Q3, QFLAG.CUSTOM2);
        }
        if (d.notIntro) this.h.global.set(A3Q3, QFLAG.PRIMARYGOALDONE);
        this.iterate(A3Q3, 13, false);
        if (!d.notIntro || d.state === 5) return;
        d.state = 5;
        this.seq(A3Q3);
      } else if (index === 593 && this.has(A3Q3, QFLAG.CUSTOM2) && !this.has(A3Q3, QFLAG.CUSTOM4)) {
        this.set(A3Q3, QFLAG.CUSTOM4);
        // 출처: QUESTS_CreateItem('rin', 21 / 악몽 35 / 지옥 75, ITEMQUAL_RARE)
        this.h.giveItem('rin', [21, 35, 75][this.h.difficulty()] ?? 21, QUALITY.RARE);
        this.h.emit({ type: 'questReward', quest: A3Q3, act: this.act, reward: 'ring' });
        if (!this.has(A3Q3, QFLAG.CUSTOM3)) return;
        this.set(A3Q3, QFLAG.PRIMARYGOALDONE);
        this.set(A3Q3, QFLAG.REWARDGRANTED);
        d.guid = true;
      }
    } else if (npc === 'hratli' && index === 571) {
      d.state = 2;
      x.hratliActivated = true;
    } else if (npc === 'asheara' && index === 589 && !this.has(A3Q3, QFLAG.CUSTOM3)) {
      this.set(A3Q3, QFLAG.CUSTOM3);
      this.h.assignMercenary('asheara');
      this.h.emit({ type: 'questReward', quest: A3Q3, act: this.act, reward: 'mercenary' });
      if (!this.has(A3Q3, QFLAG.CUSTOM4)) return;
      this.set(A3Q3, QFLAG.PRIMARYGOALDONE);
      this.set(A3Q3, QFLAG.REWARDGRANTED);
      d.guid = true;
    }
  }

  /** 출처: ACT3Q4_Callback11_ScrollMessage — Meshif 529 옥 조각상 → 황금새, Alkor 534 황금새 받음 / 538 생명의 물약 */
  private scrollQ4(npc: string, index: number): void {
    const d = this.Q(A3Q4), x = this.q4;
    if (this.has(A3Q4, QFLAG.REWARDGRANTED)) return;
    if (npc === 'cain3') {
      if (index === 527) {
        this.set(A3Q4, QFLAG.STARTED);
        if (d.state === 1) {
          d.state = 2;
          x.cainOnce = true;
        }
      } else if (index === 531) {
        this.set(A3Q4, QFLAG.ENTERAREA);
        x.cainTwice = true;
      }
    } else if (npc === 'alkor') {
      if (index === 534 && this.item('g34') && !this.done(A3Q4)) {
        this.h.deleteItem('g34');
        if (d.notIntro && d.state !== 4) d.state = 4;
        this.set(A3Q4, QFLAG.REWARDPENDING);
        x.alkor = true;
      } else if (index === 538 && this.has(A3Q4, QFLAG.REWARDPENDING)) {
        this.clr(A3Q4, QFLAG.REWARDPENDING);
        this.set(A3Q4, QFLAG.REWARDGRANTED);
        this.set(A3Q4, QFLAG.PRIMARYGOALDONE);
        this.h.record.resetIntermediate(A3Q4);
        this.set(A3Q4, QFLAG.CUSTOM1);
        if (d.notIntro) d.state = 5;
        // 출처: QUESTS_CreateItem('xyz', 0, ITEMQUAL_NORMAL) — Potion of Life
        this.h.giveItem('xyz', 0, QUALITY.NORMAL);
        this.h.emit({ type: 'questReward', quest: A3Q4, act: this.act, reward: 'potionOfLife' });
        d.guid = true;
        if (this.has(A3Q4, QFLAG.PRIMARYGOALDONE)) {
          this.h.global.set(A3Q4, QFLAG.PRIMARYGOALDONE);
          this.seq(A3Q4);
        }
      }
    } else if (npc === 'meshif2' && index === 529 && this.item('j34')) {
      this.h.deleteItem('j34');
      if (this.h.giveItem('g34', 0, QUALITY.NORMAL)) {
        d.state = 3;
        x.meshif = true;
      }
    }
  }

  /** 출처: ACT3Q5_Callback11_ScrollMessage — Ormus 594 시작, Cain 626 보상 */
  private scrollQ5(npc: string, index: number): void {
    const d = this.Q(A3Q5);
    if (this.has(A3Q5, QFLAG.REWARDGRANTED)) return;
    if (npc === 'ormus' && index === 594) {
      d.state = this.h.global.get(A3Q1, QFLAG.PRIMARYGOALDONE) ? 2 : 3;
      this.q5.ormusActivated = true;
    } else if (npc === 'cain3' && index === 626 && this.has(A3Q5, QFLAG.ENTERAREA)) {
      if (this.has(A3Q2, QFLAG.REWARDGRANTED)) for (const c of [...KHALIM, 'qf2']) this.h.deleteItem(c);
      if (this.has(A3Q5, QFLAG.PRIMARYGOALDONE) && d.state !== 7) {
        this.h.global.set(A3Q5, QFLAG.PRIMARYGOALDONE);
        this.iterate(A3Q5, 13, false);
        d.state = 7;
      }
      this.seq(A3Q5);
      this.set(A3Q5, QFLAG.REWARDGRANTED);
      this.clr(A3Q5, QFLAG.ENTERAREA);
      d.guid = true;
    }
  }

  /** 출처: ACT3Q6_Callback11_ScrollMessage — Ormus 628 시작, 657~663 메피스토 처치 뒤 마을 대사 */
  private scrollQ6(npc: string, index: number): void {
    const d = this.Q(A3Q6);
    if (!this.has(A3Q6, QFLAG.CUSTOM7) && this.has(A3Q6, QFLAG.REWARDGRANTED)) return;
    if (npc === 'ormus' && index === 628) {
      d.state = this.h.global.get(A3Q1, QFLAG.PRIMARYGOALDONE) ? 2 : 3;
      this.q6.ormusActivated = true;
    } else if (index >= 657 && index <= 663 && this.has(A3Q6, QFLAG.CUSTOM7)) {
      if (this.has(A3Q6, QFLAG.PRIMARYGOALDONE)) {
        this.iterate(A3Q6, 13, false);
        d.state = 7;
      }
      this.clr(A3Q6, QFLAG.CUSTOM7);
      d.guid = true;
    }
  }

  npcDeactivate(npc: string): void {
    // 출처: ACT3Q1_Callback02_NpcDeactivate (소리 67), ACT3Q3, ACT3Q4, ACT3Q5, ACT3Q6, ACT3Q2
    if (npc === 'alkor' && this.q1.tomeBrought) {
      this.q1.tomeBrought = false;
      this.h.emit({ type: 'questCompleted', quest: A3Q1, act: this.act });
    }
    if (npc === 'cain3' && this.q2.talkedCain) {
      this.iterate(A3Q2, 1);
      this.q2.talkedCain = false;
    }
    const x3 = this.q3;
    if (npc === 'hratli' && x3.hratliActivated) {
      this.iterate(A3Q3, 2);
      x3.hratliActivated = false;
      this.updateFlagsQ3();
    } else if (npc === 'ormus' && x3.broughtToOrmus) {
      x3.broughtToOrmus = false;
      // 출처: ACT3Q3_SetAltarMode — Ormus 가 제단에 기드빈을 놓는다 (제단 작동 → 열림)
      // 근사(원작 미확인): 원작은 Ormus AI 가 제단까지 걸어간 뒤 — 여기서는 대화를 닫는 즉시
      const altar = this.h.findObject(TOWN, OBJ3.GIDBINN_ALTAR);
      if (altar) this.h.setObjectMode(altar, OBJMODE.OPERATING, true);
      x3.altarMode = OBJMODE.OPENED;
    }
    const x4 = this.q4;
    if (npc === 'alkor' && x4.alkor) {
      this.iterate(A3Q4, 5);
      x4.alkor = false;
      x4.birdBrought = true;
    } else if (npc === 'cain3') {
      if (x4.cainOnce) {
        this.iterate(A3Q4, 2);
        x4.cainOnce = false;
      }
      if (x4.cainTwice) {
        this.iterate(A3Q4, 4);
        x4.cainTwice = false;
      }
    } else if (npc === 'meshif2' && x4.meshif) {
      this.iterate(A3Q4, 3);
      x4.meshif = false;
    }
    if (npc === 'ormus' && this.q5.ormusActivated) {
      this.iterate(A3Q5, 2);
      this.q5.ormusActivated = false;
      this.updateFlags(A3Q5);
    }
    if (npc === 'ormus' && this.q6.ormusActivated) {
      this.iterate(A3Q6, 2);
      this.q6.ormusActivated = false;
    }
  }

  // ------------------------------------------------------------ 레벨 이동

  changeLevel(oldNo: number, newNo: number): void {
    const G = QFLAG.REWARDGRANTED;
    // 출처: ACT3Q1_Callback03_ChangedLevel
    const d1 = this.Q(A3Q1);
    if (newNo === L3.LOWERKURAST && d1.notIntro && d1.state < 1) d1.state = 1;
    if (oldNo === TOWN) {
      d1.guid = false;
      if (d1.state === 2 && !this.has(A3Q1, G)) {
        if (d1.lastState !== 1) this.iterate(A3Q1, 1);
        d1.state = 3;
        this.updateFlags(A3Q1);
      }
    }
    // 출처: ACT3Q2_Callback03_ChangedLevel
    const d2 = this.Q(A3Q2);
    if (newNo === L3.GREATMARSH && d2.notIntro && d2.state < 3) d2.state = 1;
    // 출처: ACT3Q3_Callback03_ChangedLevel
    const d3 = this.Q(A3Q3);
    if (newNo === L3.FLAYERJUNGLE && d3.notIntro && !d3.state) d3.state = 1;
    if (oldNo === TOWN) {
      d3.guid = false;
      if (d3.state === 2) {
        if (!this.has(A3Q3, G) && !this.has(A3Q3, QFLAG.COMPLETEDBEFORE)) {
          d3.state = 3;
          this.updateFlagsQ3();
        }
      } else if (d3.state === 5) d3.active = false;
    }
    // 출처: ACT3Q4_Callback03_ChangedLevel (+ ACT3Q4_ResetAlkor — 근사(원작 미확인): 마을을 떠나면 Alkor 가 다시 말한다)
    if (oldNo === TOWN) {
      this.Q(A3Q4).guid = false;
      this.q4.birdBrought = false;
    }
    this.changeLevelQ5(oldNo, newNo);
    this.changeLevelQ6(oldNo, newNo);
  }

  /** 출처: ACT3Q5_Callback03_ChangedLevel (+ 평의회 등록: 트라빈칼에 들어가면 이미 배치된 평의회 3명 — QUESTS_MonsterSpawn) */
  private changeLevelQ5(oldNo: number, newNo: number): void {
    const d = this.Q(A3Q5);
    if (newNo === L3.KURASTCAUSEWAY && d.notIntro && !d.state) d.state = 1;
    if (newNo === L3.TRAVINCAL) {
      for (const m of this.h.levelMonsters(L3.TRAVINCAL)) if (m.superUnique && COUNCIL_SUPERUNIQUES.includes(m.superUnique)) this.spawnCouncil(m.id);
      this.placeOrb();
    }
    if (oldNo !== TOWN) return;
    d.guid = false;
    if (d.state <= 1 || d.state > 3) return;
    if (this.has(A3Q5, QFLAG.REWARDGRANTED) || this.has(A3Q5, QFLAG.ENTERAREA)) return;
    if (d.lastState < 3) this.iterate(A3Q5, 2, false);
    d.state = this.h.global.get(A3Q1, QFLAG.PRIMARYGOALDONE) ? 4 : 5;
    this.updateFlags(A3Q5);
  }

  /**
   * 강요의 구슬 오브젝트 (objects.txt 404, InitFn 60 — 원작은 이 오브젝트가 같은 자리에 구슬 몬스터(compellingorb)를 만든다).
   * 근사(원작 미확인): 이 월드 변환에서는 DS1 프리셋이 몬스터 쪽으로 들어온다 — 구슬 몬스터 자리에 오브젝트를 만든다 (없으면 억류지 계단 옆)
   */
  private placeOrb(): void {
    const x = this.q5;
    if (x.orbPlaced) return;
    if (this.h.findObject(L3.TRAVINCAL, OBJ3.ORB)) {
      x.orbPlaced = true;
      return;
    }
    const orb = this.h.levelMonsters(L3.TRAVINCAL).find((m) => m.typeId === 'compellingorb');
    const stairs = this.h.findObject(L3.TRAVINCAL, OBJ3.DURANCE_STAIRS);
    const at = orb ? { x: orb.x, y: orb.y } : stairs ? { x: stairs.x - 4, y: stairs.y + 4 } : null;
    if (!at) return;
    const o = this.h.createObject(L3.TRAVINCAL, OBJ3.ORB, Math.floor(at.x), Math.floor(at.y), x.orbSmashed ? OBJMODE.OPENED : OBJMODE.NEUTRAL);
    if (o) x.orbPlaced = true;
  }

  /** 출처: ACT3Q6_Callback03_ChangedLevel */
  private changeLevelQ6(oldNo: number, newNo: number): void {
    const d = this.Q(A3Q6);
    const tome = this.h.global.get(A3Q1, QFLAG.PRIMARYGOALDONE);
    if (oldNo === TOWN) {
      d.guid = false;
      if (d.state > 1 && d.state <= 3 && !this.has(A3Q6, QFLAG.REWARDGRANTED) && !this.has(A3Q6, QFLAG.CUSTOM7)) {
        if (d.lastState < 3) this.iterate(A3Q6, 2, false);
        d.state = tome ? 4 : 5;
        this.updateFlags(A3Q6);
      }
    }
    if (newNo >= L3.RUINEDFANE && newNo <= L3.DURANCE3 && d.notIntro && !d.state) d.state = 1;
    if (newNo === L3.DURANCE1) {
      if (d.lastState === 2 || !d.lastState) this.iterate(A3Q6, 3);
      if (d.state !== 1) {
        if (d.lastState === 2 || !d.lastState) this.updateFlags(A3Q6);
      } else {
        d.state = tome ? 4 : 5;
        this.updateFlags(A3Q6);
      }
    } else if (newNo === L3.DURANCE3) {
      if (d.lastState !== 4) this.iterate(A3Q6, 4);
      if (d.state !== 4 && d.state !== 5) d.state = tome ? 4 : 5;
      this.updateFlags(A3Q6);
    }
  }

  // ------------------------------------------------------------ 몬스터

  /** 출처: ACT3Q5_SpawnCouncil (QUESTS_MonsterSpawn — 평의회 슈퍼 유니크가 생길 때, 최대 6) */
  private spawnCouncil(id: number): void {
    const d = this.Q(A3Q5), x = this.q5;
    if (!d.notIntro) return;
    x.spawned = true;
    if (x.council.length >= 6 || x.council.includes(id)) return;
    x.council.push(id);
    x.left = x.council.length;
    if (d.state <= 1) {
      if (d.lastState !== 1) this.iterate(A3Q5, 1);
    } else if (d.lastState !== 3) this.iterate(A3Q5, 3);
    d.state = this.h.global.get(A3Q1, QFLAG.PRIMARYGOALDONE) ? 4 : 5;
    this.updateFlags(A3Q5);
  }

  monsterKilled(k: ActsKill): void {
    if (k.typeId === 'fetish11' || (k.id !== undefined && k.id === this.q3.bossId)) this.killedGidbinnBoss(k);
    if (k.boss && !k.flying && k.typeId !== 'fetish11' && k.levelNo >= TOWN && k.levelNo <= L3.DURANCE3) this.killedJadeBoss(k);
    if (k.superUnique && COUNCIL_SUPERUNIQUES.includes(k.superUnique)) this.killedCouncil(k);
    if (k.typeId === 'mephisto') this.killedMephisto(k);
  }

  /** 출처: ACT3Q3_Callback08_MonsterKilled — 기드빈 보스(fetish11 유니크)가 기드빈(g33)을 떨어뜨린다 */
  private killedGidbinnBoss(k: ActsKill): void {
    const x = this.q3;
    if (!x.bossSpawned || !this.Q(A3Q3).notIntro || !k.boss) return;
    if (this.h.dropAt('g33', k.x, k.y, QUALITY.NORMAL)) {
      x.gidbinnDropped = true;
      x.bossId = -1;
      this.updateFlagsQ3();
    } else x.bossSpawned = false;
  }

  /**
   * 출처: QUESTS_SetJadeFigurineBoss → ACT3Q4_UnitIterate_SetGoldenBirdBoss / ACT3Q4_Callback08_MonsterKilled — Act 3 의 (날지 않는) 첫 보스가 옥 조각상(j34)
   * 근사(원작 미확인): 원작은 보스가 생길 때 연결한다 — 여기서는 Act 3 에서 처음 죽은 보스(슈퍼 유니크·유니크)
   */
  private killedJadeBoss(k: ActsKill): void {
    const d = this.Q(A3Q4), x = this.q4;
    if (!d.notIntro || !x.canDrop || !x.bossArmed || this.q3.bossSpawning) return;
    if (this.has(A3Q4, QFLAG.REWARDGRANTED)) return;
    if (this.h.dropAt('j34', k.x, k.y, QUALITY.NORMAL)) {
      x.canDrop = false;
      x.jadeDropped = true;
      if (d.state < 1) d.state = 1;
      if (!d.lastState) this.iterate(A3Q4, 1);
    }
  }

  /** 출처: ACT3Q5_Callback08_MonsterKilled — 첫 평의회가 칼림의 도리깨(qf1, 유니크), 다음은 큐브(없으면), 모두 죽으면 완료 */
  private killedCouncil(k: ActsKill): void {
    const d = this.Q(A3Q5), x = this.q5;
    if (x.flailDropped) {
      if (!x.cubeDropped) {
        x.cubeDropped = true;
        if (!this.item('box')) this.h.dropAt('box', k.x, k.y, QUALITY.NORMAL);
      }
    } else {
      const missing = !this.has(A3Q2, QFLAG.REWARDGRANTED) && !this.item('qf1') && !this.item('qf2') ? 1 : 0;
      if (missing && this.h.dropAt('qf1', k.x, k.y, QUALITY.UNIQUE)) x.flailDropped = true;
    }
    if (!d.notIntro || x.left <= 0) return;
    x.left--;
    if (x.left) return;
    if (x.orbSmashed) {
      d.state = 7;
      this.iterate(A3Q5, 13);
    } else {
      d.state = 6;
      this.iterate(A3Q5, 4);
    }
    // 출처: ACT3Q5_UnitIterate_UpdateQuestStateAfterMonsterKill (마지막으로 죽은 평의회와 같은 방·이웃 방)
    if (k.playerNear && !this.has(A3Q5, QFLAG.REWARDGRANTED) && !this.has(A3Q5, QFLAG.ENTERAREA)) {
      this.set(A3Q5, this.has(A3Q2, QFLAG.REWARDGRANTED) ? QFLAG.REWARDGRANTED : QFLAG.ENTERAREA);
      this.set(A3Q5, QFLAG.PRIMARYGOALDONE);
    }
    if (!this.has(A3Q5, QFLAG.REWARDGRANTED) && !this.has(A3Q5, QFLAG.ENTERAREA)) this.set(A3Q5, QFLAG.COMPLETEDNOW);
    if (this.has(A3Q5, QFLAG.PRIMARYGOALDONE)) this.h.emit({ type: 'questCompleted', quest: A3Q5, act: this.act });
    this.h.global.set(A3Q5, QFLAG.PRIMARYGOALDONE);
  }

  /** 출처: ACT3Q6_Callback08_MonsterKilled — 지옥문 열림, 메피스토의 영혼석(mss) */
  private killedMephisto(k: ActsKill): void {
    const d = this.Q(A3Q6), x = this.q6;
    d.state = 6;
    if (d.notIntro) {
      if ((k.byPlayer || this.h.levelNo() === L3.DURANCE3) && !this.has(A3Q6, QFLAG.REWARDGRANTED)) {
        if (!this.has(A3Q6, QFLAG.CUSTOM7)) x.soulstones++;
        this.set(A3Q6, QFLAG.PRIMARYGOALDONE);
        this.set(A3Q6, QFLAG.REWARDGRANTED);
        this.set(A3Q6, QFLAG.CUSTOM7);
        // 출처: CLIENTS_UpdateCharacterProgression(…, 3, nDifficulty)
        this.h.progress(3);
      }
      if (this.has(A3Q6, QFLAG.PRIMARYGOALDONE)) this.h.emit({ type: 'questCompleted', quest: A3Q6, act: this.act });
      if (!x.timer) {
        x.timer = true;
        this.timer(12, () => {
          if (d.lastState !== 4) this.iterate(A3Q6, 4);
          x.timer = false;
          return true;
        });
      }
    }
    this.h.global.set(A3Q6, QFLAG.PRIMARYGOALDONE);
    const gate = this.h.findObject(L3.DURANCE3, OBJ3.HELLGATE);
    if (gate) this.h.setObjectMode(gate, OBJMODE.OPERATING, true);
    x.hellgateMode = OBJMODE.OPENED;
    // 근사(원작 미확인): ACT3Q6_SetObjectModes (다리) 의 호출 위치 미확인 — 메피스토가 죽을 때 함께 올린다
    const bridge = this.h.findObject(L3.DURANCE3, OBJ3.BRIDGE);
    if (bridge) this.h.setObjectMode(bridge, OBJMODE.OPENED);
    x.bridgeMode = OBJMODE.OPENED;
    for (let i = 0; i < x.soulstones; i++) this.h.dropAt('mss', k.x, k.y, QUALITY.NORMAL);
    x.soulstones = 0;
    this.h.emit({ type: 'questFx', fx: 11 });
  }

  override gameEvent(ev: { type: string; [k: string]: unknown }): void {
    if (ev.type === 'cubeQuestItem' && ev.code === 'qf2') this.h.emit({ type: 'questUpdate', quest: A3Q2, act: this.act, status: this.status(A3Q2) });
  }

  itemPickedUp(code: string): void {
    const d1 = this.Q(A3Q1);
    // 출처: ACT3Q1_Callback04_ItemPickedUp
    if (code === 'bbb' && d1.notIntro) {
      this.iterate(A3Q1, 2);
      d1.state = 4;
    }
    // 출처: ACT3Q2_Callback04_ItemPickedUp (로그 상태 알림)
    if (([...KHALIM, 'qf2'] as string[]).includes(code) && this.has(QW.A2COMPLETED, QFLAG.REWARDGRANTED) && !this.has(A3Q2, QFLAG.REWARDGRANTED)) {
      this.h.emit({ type: 'questUpdate', quest: A3Q2, act: this.act, status: this.status(A3Q2) });
    }
    // 출처: ACT3Q3_Callback04_ItemPickedUp
    const d3 = this.Q(A3Q3);
    if (code === 'g33' && d3.notIntro) {
      this.iterate(A3Q3, 4);
      if (!this.has(A3Q3, QFLAG.CUSTOM5)) {
        this.set(A3Q3, QFLAG.CUSTOM5);
        this.h.emit({ type: 'questItem', quest: A3Q3, act: this.act, code, sound: 65 });
      }
      d3.state = 4;
      this.iterate(A3Q3, 3);
      this.updateFlagsQ3();
    }
    // 출처: ACT3Q4_Callback04_ItemPickedUp
    const d4 = this.Q(A3Q4);
    if (!this.done(A3Q4)) {
      if (code === 'g34') {
        d4.state = 3;
        this.iterate(A3Q4, 3);
      } else if (code === 'j34') {
        this.iterate(A3Q4, 1);
        d4.state = 1;
        if (!this.has(A3Q4, QFLAG.CUSTOM2)) {
          this.set(A3Q4, QFLAG.CUSTOM2);
          this.h.emit({ type: 'questItem', quest: A3Q4, act: this.act, code, sound: 72 });
        }
      }
    }
  }

  /** 출처: ACT3Q1_Callback05_ItemDropped */
  override itemDropped(code: string): void {
    const d = this.Q(A3Q1);
    if (code === 'bbb' && d.notIntro) {
      d.state = 3;
      this.iterate(A3Q1, 1);
    }
  }

  /**
   * Potion of Life (xyz): 기본 최대 생명 +20.
   * 근사(원작 미확인): 원작 사용 처리(D2Game 아이템 사용 코드)의 위치 미확인 — 결과(생명 +20)는 원작 동작
   */
  override useItem(code: string): boolean {
    if (code !== 'xyz') return false;
    this.h.addLife(20);
    this.h.emit({ type: 'questReward', quest: A3Q4, act: this.act, reward: 'life', amount: 20 });
    return true;
  }

  // ------------------------------------------------------------ 오브젝트

  /** objects.txt InitFn 25 Gidbinn, 39 GidbinnAltar, 41 SewerStairs, 42 SewerLever, 44 HellGate, 45 MephistoBridge, 53 StairsR, 60 CompellingOrb */
  initObject(o: ObjectUnit): void {
    switch (o.type.initFn) {
      case 25: // 출처: OBJECTS_InitFunction25_Gidbinn
        if (!this.Q(A3Q3).notIntro) this.h.setObjectMode(o, OBJMODE.OPENED);
        else this.q3.decoy = { x: o.x, y: o.y };
        return;
      case 39: // 출처: OBJECTS_InitFunction39_GidbinnAltar
        this.h.setObjectMode(o, this.q3.altarMode);
        return;
      case 41: // 출처: OBJECTS_InitFunction41_SewerStairs
        this.q2.stairs = o;
        this.h.setObjectMode(o, this.Q(A3Q2).notIntro ? this.q2.stairsMode : OBJMODE.OPENED);
        return;
      case 42: // 출처: OBJECTS_InitFunction42_SewerLever
        if (!this.Q(A3Q2).notIntro) this.h.setObjectMode(o, OBJMODE.OPENED);
        return;
      case 44: { // 출처: OBJECTS_InitFunction44_HellGatePortal
        // 게임이 오브젝트를 만들 때 levelNo() 는 그 오브젝트의 레벨
        this.h.setObjectMode(o, this.h.levelNo() === L3.OUTERSTEPPES ? OBJMODE.OPENED : this.q6.hellgateMode);
        return;
      }
      case 45: // 출처: OBJECTS_InitFunction45_MephistoBridge
        this.h.setObjectMode(o, this.q6.bridgeMode);
        return;
      case 53: // 출처: OBJECTS_InitFunction53_StairsR
        if (this.q5.orbSmashed) this.h.setObjectMode(o, OBJMODE.OPENED);
        return;
      case 60: // 출처: OBJECTS_InitFunction60_CompellingOrb
        if (this.q5.orbSmashed) this.h.setObjectMode(o, OBJMODE.OPENED);
        return;
    }
  }

  /**
   * 퀘스트 오브젝트 조작 (objects.txt OperateFn 28 LamEsenTome, 31 GidbinnDecoy, 44 SewerStairs, 45 SewerLever, 46 HellGate, 53 CompellingOrb,
   * 57·58·59 KhalimChest). 처리했으면 true
   */
  operate(o: ObjectUnit): boolean {
    switch (o.type.operateFn) {
      case 28: this.opTome(o); return true;
      case 31: this.opDecoy(o); return true;
      case 44: return true;
      case 45: this.opLever(o); return true;
      case 46: this.opHellgate(o); return true;
      case 53: this.opOrb(o); return true;
      case 57: this.opKhalimChest(o, 'qhr'); return true;
      case 58: this.opKhalimChest(o, 'qey'); return true;
      case 59: this.opKhalimChest(o, 'qbr'); return true;
    }
    return false;
  }

  /** 출처: A3Q1.cpp OBJECTS_OperateFunction28_LamEsenTome */
  private opTome(o: ObjectUnit): void {
    const d = this.Q(A3Q1), x = this.q1;
    if (!d.notIntro || o.mode !== OBJMODE.NEUTRAL) return;
    if (this.has(A3Q1, QFLAG.REWARDGRANTED)) {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    if (!this.h.dropAt('bbb', o.x, o.y, QUALITY.NORMAL)) return;
    this.h.setObjectMode(o, OBJMODE.OPENED);
    x.tomeActive = true;
    x.tomes++;
    if (d.state !== 3) d.state = 3;
    if (d.lastState !== 1) this.iterate(A3Q1, 1, false);
  }

  /** 출처: A3Q3.cpp OBJECTS_OperateFunction31_GidbinnDecoy → 7 틱 뒤 ACT3Q3_SpawnGidbinnBoss (fetish11 보스) */
  private opDecoy(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    if (this.has(A3Q3, QFLAG.REWARDGRANTED) || this.has(A3Q3, QFLAG.CUSTOM3) || this.has(A3Q3, QFLAG.CUSTOM4)) {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    const d = this.Q(A3Q3), x = this.q3;
    if (!d.notIntro) return;
    if (!d.state) d.state = 1;
    this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    x.decoy = { x: o.x, y: o.y };
    x.decoyActivated = true;
    if (x.spawnTimer) return;
    x.spawnTimer = true;
    this.timer(7, () => {
      x.spawnTimer = false;
      const at = x.decoy;
      if (!x.decoyActivated || x.bossSpawned || !at) return true;
      x.bossSpawning = true;
      const id = this.h.spawnMonster(L3.FLAYERJUNGLE, 'fetish11', Math.floor(at.x) + 3, Math.floor(at.y) + 3, { boss: true });
      if (id !== null) {
        x.decoyActivated = false;
        x.bossSpawned = true;
        x.bossId = id;
      }
      x.bossSpawning = false;
      return true;
    });
  }

  /** 출처: A3Q2.cpp OBJECTS_OperateFunction45_SewerLever — 30 틱 뒤 계단이 열린다 */
  private opLever(o: ObjectUnit): void {
    const x = this.q2;
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    x.stairsMode = OBJMODE.OPENED;
    this.h.emit({ type: 'questFx', fx: 9 });
    this.timer(30, () => {
      const s = x.stairs ?? this.h.findObject(L3.KURASTSEWERS1, OBJ3.SEWER_STAIRS);
      if (s) this.h.setObjectMode(s, OBJMODE.OPENED);
      return true;
    });
  }

  /**
   * 지옥문 (objects.txt 342, OperateFn 46): 열려 있으면 Act 4 (판데모니움 요새) 로. A3COMPLETED 기록.
   * 근사(원작 미확인): OperateFn 46 은 D2MOO 퀘스트 파일 밖(ObjMode.cpp) — 막 이동(D2GAME_PlayerChangeAct)과 A3COMPLETED 기록으로 둔다
   */
  private opHellgate(o: ObjectUnit): void {
    if (o.mode !== OBJMODE.OPENED && this.q6.hellgateMode !== OBJMODE.OPENED) return;
    if (this.h.levelNo() === L3.OUTERSTEPPES) {
      this.h.travelAct(2);
      return;
    }
    if (!this.has(QW.A3COMPLETED, QFLAG.REWARDGRANTED)) {
      this.set(QW.A3COMPLETED, QFLAG.REWARDGRANTED);
      this.set(QW.A3COMPLETED, QFLAG.PRIMARYGOALDONE);
    }
    this.h.travelAct(3);
  }

  /** 출처: A3Q5.cpp OBJECTS_OperateFunction53_CompellingOrb — 칼림의 의지(qf2)를 들고 두 번 치면 부서진다 */
  private opOrb(o: ObjectUnit): void {
    const x = this.q5;
    if (o.mode !== OBJMODE.NEUTRAL) return;
    if (this.h.weaponCode() !== 'qf2') {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    x.hits++;
    if (x.hits < 2) return;
    this.set(A3Q2, QFLAG.REWARDGRANTED);
    this.set(A3Q2, QFLAG.PRIMARYGOALDONE);
    this.h.deleteItem('qf2');
    if (this.has(A3Q5, QFLAG.ENTERAREA) && !this.has(A3Q5, QFLAG.REWARDGRANTED)) this.set(A3Q5, QFLAG.REWARDGRANTED);
    this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    x.orbSmashed = true;
    this.h.emit({ type: 'questFx', fx: 10 });
    this.h.emit({ type: 'orbSmashed', objectId: o.id });
    this.seq(A3Q5);
    // 출처: ACT3Q5_UnitIterate_DeleteKhalimItems
    for (const c of KHALIM) this.h.deleteItem(c);
    const stairs = this.h.findObject(L3.TRAVINCAL, OBJ3.DURANCE_STAIRS);
    if (stairs) this.h.setObjectMode(stairs, OBJMODE.OPENED);
  }

  /** 출처: A3Q2.cpp OBJECTS_OperateFunction57/58/59_KhalimChest — 금화 5~9, 칼림 조각 (없으면), 상자 TC 매직 */
  private opKhalimChest(o: ObjectUnit, code: 'qhr' | 'qey' | 'qbr'): void {
    if (o.mode !== OBJMODE.NEUTRAL) return;
    this.h.setObjectMode(o, OBJMODE.OPERATING, true);
    const n = ((this.h.seed.roll() >>> 0) % 5) + 5;
    for (let i = 0; i < n; i++) this.h.dropAt('gld', o.x, o.y, QUALITY.NORMAL);
    if (!this.item(code) && !this.item('qf2')) this.h.dropAt(code, o.x, o.y, QUALITY.NORMAL);
    this.h.dropChestTc(o, QUALITY.MAGIC);
  }

  /** 출처: QUESTS_LevelWarpCheck — 증오의 억류지 1층 (ACT3Q5_IsDuranceOfHateClosed: 2층에서 올라오면 열림), 하수도 계단 (레버) */
  override exitBlocked(from: number, to: number): boolean {
    if (to === L3.DURANCE1) return from !== L3.DURANCE2 && !this.q5.orbSmashed;
    // 근사(원작 미확인): 원작은 계단 오브젝트(366)를 조작해 내려간다 — 여기서는 레버를 당기기 전 1층 → 2층 출구를 막는다
    if (from === L3.KURASTSEWERS1 && to === L3.KURASTSEWERS2) return this.Q(A3Q2).notIntro && this.q2.stairsMode !== OBJMODE.OPENED;
    return false;
  }

  // ------------------------------------------------------------ 퀘스트 로그

  protected override statusFilter(w: number): number | undefined {
    if (w === A3Q1) return this.statusQ1();
    if (w === A3Q2) return this.statusQ2();
    if (w === A3Q3) return this.statusQ3();
    if (w === A3Q4) return this.statusQ4();
    return undefined;
  }

  /** 출처: ACT3Q1_StatusFilterCallback */
  private statusQ1(): number {
    const d = this.Q(A3Q1), x = this.q1;
    if (!this.has(QW.A2COMPLETED, QFLAG.REWARDGRANTED)) return 0;
    if (this.has(A3Q1, QFLAG.REWARDGRANTED)) return this.has(A3Q1, QFLAG.PRIMARYGOALDONE) ? 13 : 11;
    if (this.item('bbb')) return 2;
    if (!d.notIntro) return 0;
    if (d.state > 3) return x.tomes ? 1 : 12;
    if (x.tomeActive && !x.tomes) return 9;
    return 1;
  }

  /** 출처: ACT3Q2_StatusFilterCallback */
  private statusQ2(): number {
    const d = this.Q(A3Q2);
    if (!this.has(QW.A2COMPLETED, QFLAG.REWARDGRANTED)) return 0;
    let s = this.has(A3Q2, QFLAG.STARTED) || (d.notIntro && d.state >= 2) ? 1 : 0;
    if (this.item('qf2')) return this.q5.orbSmashed ? 12 : 6;
    const base = this.item('qf1'), eye = this.item('qey'), heart = this.item('qhr'), brain = this.item('qbr');
    const parts = [base, eye, heart, brain].filter(Boolean).length;
    if (parts === 4) return this.has(A3Q2, QFLAG.CUSTOM1) ? 5 : 7;
    if (!parts) {
      if (this.has(A3Q2, QFLAG.STARTED)) return 1;
      s = d.state > 1 ? 1 : 0;
      return s;
    }
    if (!eye) return 1;
    if (!brain) return 2;
    if (!heart) return 4;
    return base ? 7 : 3;
  }

  /** 출처: ACT3Q3_StatusFilterCallback */
  private statusQ3(): number {
    if (!this.has(QW.A2COMPLETED, QFLAG.REWARDGRANTED)) return 0;
    if (this.has(A3Q3, QFLAG.REWARDGRANTED)) return this.has(A3Q3, QFLAG.PRIMARYGOALDONE) ? 13 : 11;
    if (this.item('g33')) return 4;
    let s = 0;
    if (this.has(A3Q3, QFLAG.CUSTOM2)) {
      if (!this.has(A3Q3, QFLAG.CUSTOM4)) s = 6;
      if (!this.has(A3Q3, QFLAG.CUSTOM3)) s = 5;
    } else if (this.has(A3Q3, QFLAG.ENTERAREA)) s = this.q3.gidbinnDropped ? 3 : 2;
    else if (this.has(A3Q3, QFLAG.LEAVETOWN)) s = 2;
    else if (this.has(A3Q3, QFLAG.STARTED)) s = 1;
    return s;
  }

  /** 출처: ACT3Q4_StatusFilterCallback */
  private statusQ4(): number {
    const d = this.Q(A3Q4);
    if (!this.has(QW.A2COMPLETED, QFLAG.REWARDGRANTED)) return 0;
    if (this.has(A3Q4, QFLAG.REWARDPENDING)) return 5;
    if (this.has(A3Q4, QFLAG.REWARDGRANTED)) return this.has(A3Q4, QFLAG.PRIMARYGOALDONE) ? 13 : 11;
    if (this.item('g34')) return this.has(A3Q4, QFLAG.ENTERAREA) ? 4 : 3;
    if (this.item('j34')) return this.has(A3Q4, QFLAG.STARTED) ? 2 : 1;
    if (!d.notIntro) return 0;
    return d.lastState >= 6 ? 7 : d.lastState;
  }
}
