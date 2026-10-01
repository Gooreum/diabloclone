// Act 4 퀘스트 3개 상태 기계 (The Fallen Angel · Terror's End · Hell's Forge) + 클래식 엔딩.
// 출처: D2MOO D2Game/src/QUESTS/ACT4/A4Q1.cpp ~ A4Q3.cpp (콜백: NpcActivate / NpcDeactivate / ChangedLevel / MonsterKilled / ScrollMessage /
//       ItemPickedUp / PlayerStartedGame, SeqCallback, ActiveFilter, 오브젝트 Operate/Init 함수, ACT4Q2_SpawnDiablo 타이머의 클래식 엔딩 분기)
//       D2Game/src/QUESTS/Quests.cpp (QUESTS_SequenceCycler — 게임 시작 때 퀘스트 22(A4Q1) 의 SeqCallback)
//       D2Game/src/MONSTER/MonsterSpawn.cpp (퀘스트 연결: izual → A4Q1, diablo → A4Q2, hephasto → A4Q3)
// (https://github.com/ThePhrozenKeep/D2MOO)
// 싱글플레이 분기를 옮겼다 (클래식 엔딩 + 확장팩: Tyrael 20000 → Harrogath 포털 566 · OperateFn73 LastLastPortal).
// 봉인·봉인 보스·디아블로 소환은 engine/chaos.ts (Phase 5) 가 맡는다.
import { OBJMODE, type ObjectUnit } from '../objects';
import { QUALITY } from '../treasure';
import type { QuestSpeech } from './act1';
import { QFLAG } from './record';
import { ActQuestBase, QuestData, type ActsKill, type ActsQuestHost } from './acts-base';
import { QW } from './messages-acts';

/** Act 4 levels.txt 번호 (출처: LevelsIds.h) */
export const L4 = { FORTRESS: 103, PLAINS: 105, RIVEROFFLAME: 107, CHAOS: 108 } as const;

/** 출처: objects.txt 376 Hellforge */
export const OBJ_HELLFORGE = 376;

/** 확장팩: Harrogath 로 가는 포털 (objects.txt 566 "Last Last Portal", InitFn 78 / OperateFn 73) */
export const OBJ_LASTLASTPORTAL = 566;

/** Harrogath 막 번호 (0 = Act 1) */
const ACT5 = 4;

const { A4Q1, A4Q2, A4Q3 } = QW;
const TOWN = L4.FORTRESS;

/**
 * 클래식 엔딩 시간 (틱, 25 틱 = 1 초). 출처: ACT4Q2_SpawnDiablo 의 클래식 분기 —
 *   디아블로가 죽은 뒤 75 초에 저장(sub_6FC37B10), 90 초에 PGD 인 플레이어를 판데모니움 요새로 (ACT4Q2_UnitIterate_WarpToTownEndGame), 95 초에 게임 끝
 * 근사(원작 미확인): 원작은 GetTickCount(실시간 ms) — 여기서는 게임 틱. 게임 끝(95 초)은 두지 않는다 (싱글플레이는 마을에서 계속)
 */
export const ENDING_WARP_TICKS = 90 * 25;

/**
 * 헬포지 보석 (ACT4Q3_CreateReward gemRewardCodes): 등급 4 = 완벽, 3·2 = 흠 없는, 1 = 보통 — 7종 (자수정·루비·사파이어·토파즈·에메랄드·다이아몬드·해골) 중 퀘스트 시드로.
 * 클래식은 룬이 없다 (bExpansion 분기)
 */
export const HELLFORGE_GEMS: readonly (readonly string[])[] = [
  ['gpv', 'gpr', 'gpb', 'gpy', 'gpg', 'gpw', 'skz'],
  ['gzv', 'glr', 'glb', 'gly', 'glg', 'glw', 'skl'],
  ['gsv', 'gsr', 'gsb', 'gsy', 'gsg', 'gsw', 'sku'],
];

/**
 * Act 4 퀘스트 제어.
 * 출처: Quests.cpp gpQuestInitTable — A4Q1 (InitNo 4, fState 1, Seq 24), A4Q2 (4), A4Q3 (4, Seq 23)
 */
export class Act4Quests extends ActQuestBase {
  readonly act = 3;
  // A4Q1 (D2Act4Quest1Strc)
  private q1 = { tyraelActivated: false, ghostSpawning: false, ghostAt: null as { x: number; y: number } | null, enteredArea: false };
  // A4Q2 (D2Act4Quest2Strc)
  private q2 = { talkedTyrael: false, diabloKilled: false, endingAt: -1, warped: false, portalSpawned: false, portalMode: 0 as number };
  // A4Q3 (D2Act4Quest3Strc)
  private q3 = { forgeMode: 0 as number, hits: 0, cainActivated: false, soulstoneAcquired: false, smashed: false, tier: 0 };

  constructor(h: ActsQuestHost) {
    super(h);
    this.q[A4Q1] = new QuestData(A4Q1, 4);
    this.q[A4Q2] = new QuestData(A4Q2, 4);
    this.q[A4Q3] = new QuestData(A4Q3, 4);
    this.Q(A4Q1).state = 1;
  }

  /** 디아블로를 이번 게임에서 죽였다 (ACT4Q2_HasDiabloBeenKilled) */
  get diabloKilled(): boolean {
    return this.q2.diabloKilled;
  }

  // ------------------------------------------------------------ 게임 시작

  startGame(): void {
    this.startCommon();
    this.startedQ3();
    this.startedQ2();
    this.startedQ1();
    // 출처: QUESTS_SequenceCycler — 퀘스트 22 (A4Q1) 의 SeqCallback
    this.seq(A4Q1);
  }

  /** 출처: ACT4Q1_Callback13_PlayerStartedGame */
  private startedQ1(): void {
    const d = this.Q(A4Q1);
    if (this.has(A4Q1, QFLAG.REWARDGRANTED) || this.has(A4Q1, QFLAG.COMPLETEDBEFORE)) return;
    if (this.has(A4Q1, QFLAG.ENTERAREA)) {
      this.q1.enteredArea = true;
      [d.lastState, d.state] = [2, 3];
    } else if (this.has(A4Q1, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [3, 1];
    else if (this.has(A4Q1, QFLAG.STARTED)) [d.state, d.lastState] = [2, 1];
  }

  /** 출처: ACT4Q2_Callback13_PlayerStartedGame */
  private startedQ2(): void {
    const d = this.Q(A4Q2);
    // 확장팩: Act 5 로 넘어가기 전이면 Tyrael 의 포털 대사(CUSTOM5)를 다시
    if (this.h.expansion() && this.has(A4Q2, QFLAG.CUSTOM5) && !this.has(QW.A4COMPLETED, QFLAG.REWARDGRANTED)) this.clr(A4Q2, QFLAG.CUSTOM5);
    if (this.has(A4Q2, QFLAG.REWARDGRANTED) || this.has(A4Q2, QFLAG.COMPLETEDBEFORE)) return;
    if (this.has(A4Q2, QFLAG.ENTERAREA)) [d.lastState, d.state] = [2, 3];
    else if (this.has(A4Q2, QFLAG.LEAVETOWN)) [d.state, d.lastState] = [3, 1];
    else if (this.has(A4Q2, QFLAG.STARTED)) [d.state, d.lastState] = [2, 1];
  }

  /** 출처: ACT4Q3_Callback13_PlayerStartedGame */
  private startedQ3(): void {
    const d = this.Q(A4Q3);
    if (this.has(A4Q3, QFLAG.REWARDGRANTED) || this.has(A4Q3, QFLAG.COMPLETEDBEFORE)) return;
    if (!this.item('mss')) d.state = 1;
    else if (this.has(A4Q3, QFLAG.CUSTOM1)) {
      this.q3.soulstoneAcquired = true;
      [d.lastState, d.state] = [4, 2];
    } else if (this.has(A4Q3, QFLAG.LEAVETOWN)) [d.lastState, d.state] = [1, 3];
    else if (this.has(A4Q3, QFLAG.STARTED)) [d.lastState, d.state] = [1, 2];
  }

  /** 퀘스트 차례. 출처: ACT4Q1 (끝나면 → 24 A4Q3), ACT4Q3 (fState 1, 끝나면 → 23 A4Q2), ACT4Q2 (fState 1) */
  private seq(w: number): boolean {
    const d = this.Q(w);
    switch (w) {
      case A4Q1:
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(A4Q3);
      case A4Q3:
        if (!d.state && d.notIntro) {
          d.state = 1;
          return true;
        }
        if (d.state !== 5 && d.notIntro) return true;
        return this.seq(A4Q2);
      case A4Q2:
        if (!d.state && d.notIntro) d.state = 1;
        return true;
    }
    return true;
  }

  /** 출처: ACT4Qn_UnitIterate_UpdateQuestStateFlags */
  private updateFlags(w: number): void {
    const d = this.Q(w);
    if (w === A4Q1) {
      if (this.has(A4Q1, QFLAG.REWARDGRANTED)) return;
      if (d.state === 2) this.set(A4Q1, QFLAG.STARTED);
      else if (d.state === 3) this.set(A4Q1, this.q1.enteredArea ? QFLAG.ENTERAREA : QFLAG.LEAVETOWN);
    } else if (w === A4Q2) {
      if (this.has(A4Q2, QFLAG.REWARDGRANTED)) return;
      if (d.state === 2) this.set(A4Q2, QFLAG.STARTED);
      else if (d.state === 3) this.set(A4Q2, d.lastState === 1 ? QFLAG.LEAVETOWN : QFLAG.ENTERAREA);
    } else if (w === A4Q3) {
      if (this.done(A4Q3)) return;
      if (d.state === 2) this.set(A4Q3, this.q3.soulstoneAcquired ? QFLAG.CUSTOM1 : QFLAG.STARTED);
      else if (d.state === 3) this.set(A4Q3, QFLAG.LEAVETOWN);
    }
  }

  // ------------------------------------------------------------ NPC

  npcHasQuest(npc: string): boolean {
    const G = QFLAG.REWARDGRANTED;
    // 출처: ACT4Q1_ActiveFilterCallback
    const d1 = this.Q(A4Q1);
    if (d1.notIntro && !this.has(A4Q1, G)) {
      if (npc === 'tyrael2' && (this.has(A4Q1, QFLAG.REWARDPENDING) || d1.state === 1)) return true;
      if (npc === 'izualghost' && !this.has(A4Q1, QFLAG.CUSTOM1)) return true;
    }
    // 출처: ACT4Q2_ActiveFilterCallback (클래식 CUSTOM2·3, 확장팩 CUSTOM4·5)
    const d2 = this.Q(A4Q2), exp = this.h.expansion();
    if (npc === 'tyrael2' && ((!this.has(A4Q2, G) && !this.has(A4Q2, QFLAG.COMPLETEDBEFORE) && d2.state === 1) || (!exp && this.has(A4Q2, G) && this.has(A4Q2, QFLAG.CUSTOM3)))) return true;
    if (npc === 'tyrael2' && exp && this.has(A4Q2, G) && !this.has(A4Q2, QFLAG.CUSTOM5)) return true;
    if (npc === 'cain4' && !exp && this.has(A4Q2, G) && this.has(A4Q2, QFLAG.CUSTOM2)) return true;
    if (npc === 'cain4' && exp && this.has(A4Q2, G) && !this.has(A4Q2, QFLAG.CUSTOM4)) return true;
    // 출처: ACT4Q3_ActiveFilterCallback
    const d3 = this.Q(A4Q3);
    return npc === 'cain4' && !this.done(A4Q3) && d3.notIntro && d3.state === 1 && !this.q3.soulstoneAcquired;
  }

  npcActivate(npc: string): QuestSpeech[] {
    const out: QuestSpeech[] = [];
    this.activateQ3(npc, out);
    this.activateQ2(npc, out);
    this.activateQ1(npc, out);
    return out;
  }

  /** 출처: ACT4Q1_Callback00_NpcActivate */
  private activateQ1(npc: string, out: QuestSpeech[]): void {
    const d = this.Q(A4Q1);
    if (npc === 'izualghost' && !this.has(A4Q1, QFLAG.CUSTOM1)) return this.chain(A4Q1, 3, npc, out);
    if (this.has(A4Q1, QFLAG.REWARDPENDING)) return this.chain(A4Q1, 3, npc, out);
    if (d.guid) return this.chain(A4Q1, 4, npc, out);
    if (!this.has(A4Q1, QFLAG.REWARDGRANTED) && (d.state < 4 || this.has(A4Q1, QFLAG.PRIMARYGOALDONE)) && d.notIntro) {
      const i = [-1, 0, 1, 2, 3, 4][d.state] ?? -1;
      if (i !== -1) this.chain(A4Q1, i, npc, out);
    }
  }

  /**
   * 출처: ACT4Q2_Callback00_NpcActivate (클래식 분기).
   * 근사(원작 미확인): 원작 디컴파일은 클래식이면 CUSTOM2·3 분기 뒤 항상 돌아가 시작 대사(681)가 나오지 않는다 — CUSTOM2·3 이 있을 때만 돌아가게 읽었다
   */
  private activateQ2(npc: string, out: QuestSpeech[]): void {
    const d = this.Q(A4Q2);
    // 확장팩 (출처: 같은 함수 — 보상 받은 뒤 표 4 Tyrael 20000 · 표 5 Cain 20001)
    if (this.h.expansion()) {
      if (this.has(A4Q2, QFLAG.REWARDGRANTED)) {
        if (!this.has(A4Q2, QFLAG.CUSTOM5)) {
          if (npc === 'tyrael2') this.chain(A4Q2, 4, npc, out);
          else if (npc === 'cain4') this.chain(A4Q2, 5, npc, out);
        }
        if (!this.has(A4Q2, QFLAG.CUSTOM4)) {
          if (npc === 'cain4') this.chain(A4Q2, 4, npc, out);
          else if (npc === 'tyrael2') this.chain(A4Q2, 5, npc, out);
        }
        return;
      }
      if ((d.state < 4 || this.has(A4Q2, QFLAG.PRIMARYGOALDONE)) && d.notIntro && d.state) {
        const i = [-1, 0, 1, -1, -1][d.state] ?? -1;
        if (i !== -1) this.chain(A4Q2, i, npc, out);
      }
      return;
    }
    const c2 = this.has(A4Q2, QFLAG.CUSTOM2), c3 = this.has(A4Q2, QFLAG.CUSTOM3);
    if (c2 || c3) {
      if (c3 && npc === 'tyrael2') this.chain(A4Q2, 2, npc, out);
      else if (c2 && npc === 'cain4') this.chain(A4Q2, 2, npc, out);
      else if (c3 && npc === 'cain4') this.chain(A4Q2, 3, npc, out);
      else if (c2 && npc === 'tyrael2') this.chain(A4Q2, 3, npc, out);
      return;
    }
    if (this.has(A4Q2, QFLAG.REWARDGRANTED)) return;
    if ((d.state < 4 || this.has(A4Q2, QFLAG.PRIMARYGOALDONE)) && d.notIntro && d.state) {
      const i = [-1, 0, 1, -1, -1][d.state] ?? -1;
      if (i !== -1) this.chain(A4Q2, i, npc, out);
    }
  }

  /** 출처: ACT4Q3_Callback00_NpcActivate */
  private activateQ3(npc: string, out: QuestSpeech[]): void {
    const d = this.Q(A4Q3), x = this.q3;
    if (this.has(A4Q3, QFLAG.REWARDPENDING)) return this.chain(A4Q3, 2, npc, out);
    if (d.guid) return this.chain(A4Q3, 3, npc, out);
    if (!d.state || this.has(A4Q3, QFLAG.REWARDGRANTED) || !(d.state < 4 || this.has(A4Q3, QFLAG.PRIMARYGOALDONE)) || !d.notIntro) return;
    if (d.state === 1) {
      if (this.item('mss')) this.chain(A4Q3, 0, npc, out);
      else if (!x.soulstoneAcquired && d.lastState < 3) this.chain(A4Q3, 1, npc, out);
    } else if (!this.item('mss') && d.lastState < 3 && !x.soulstoneAcquired) this.chain(A4Q3, 1, npc, out);
  }

  scrollMessage(npc: string, index: number): void {
    // A4Q1 (출처: ACT4Q1_Callback11_ScrollMessage) — 676: Tyrael 보상 스킬 포인트 2
    const d1 = this.Q(A4Q1);
    if (npc === 'tyrael2' && index === 670) {
      this.q1.tyraelActivated = true;
      d1.state = 2;
      this.updateFlags(A4Q1);
    } else if (npc === 'tyrael2' && index === 676 && this.has(A4Q1, QFLAG.REWARDPENDING)) {
      if (this.has(A4Q1, QFLAG.PRIMARYGOALDONE)) {
        if (d1.state !== 5) {
          d1.state = 5;
          this.seq(A4Q1);
          this.iterate(A4Q1, 13, false);
        }
        this.q1.tyraelActivated = false;
        this.h.global.set(A4Q1, QFLAG.PRIMARYGOALDONE);
      }
      this.set(A4Q1, QFLAG.REWARDGRANTED);
      this.clr(A4Q1, QFLAG.REWARDPENDING);
      this.h.record.resetIntermediate(A4Q1);
      this.h.addSkillPoints(2);
      this.h.emit({ type: 'questReward', quest: A4Q1, act: this.act, reward: 'skillPoint', amount: 2 });
      d1.guid = true;
    } else if (npc === 'izualghost' && index === 675) {
      this.set(A4Q1, QFLAG.CUSTOM1);
      if (d1.lastState !== 4) this.iterate(A4Q1, 4);
    }
    // A4Q2 (출처: ACT4Q2_Callback11_ScrollMessage, 클래식)
    if (npc === 'tyrael2' && index === 681) {
      this.q2.talkedTyrael = true;
      this.Q(A4Q2).state = 2;
      this.updateFlags(A4Q2);
    } else if (npc === 'tyrael2' && index === 684) this.clr(A4Q2, QFLAG.CUSTOM3);
    else if (npc === 'cain4' && index === 685) this.clr(A4Q2, QFLAG.CUSTOM2);
    else if (npc === 'tyrael2' && index === 20000 && this.h.expansion()) {
      // 확장팩: Tyrael 오른쪽 5 칸에 Harrogath 포털 (QUESTS_GetFreePosition → 빈 칸)
      this.set(A4Q2, QFLAG.CUSTOM5);
      this.spawnAct5Portal();
    } else if (npc === 'cain4' && index === 20001) this.set(A4Q2, QFLAG.CUSTOM4);
    // A4Q3 (출처: ACT4Q3_Callback11_ScrollMessage) — 679: Cain 이 영혼석을 준다, 680: 보상 받음
    const d3 = this.Q(A4Q3), x3 = this.q3;
    if (npc !== 'cain4') return;
    if (index === 678) {
      x3.cainActivated = true;
      d3.state = 2;
    } else if (index === 679) {
      if (this.h.giveItem('mss', 0, QUALITY.NORMAL)) {
        x3.cainActivated = true;
        if (d3.state < 2) d3.state = 2;
        x3.soulstoneAcquired = true;
      }
    } else if (index === 680 && this.has(A4Q3, QFLAG.REWARDPENDING)) {
      if (this.has(A4Q3, QFLAG.PRIMARYGOALDONE) && d3.state !== 5) {
        this.iterate(A4Q3, 13, false);
        d3.state = 5;
        this.seq(A4Q3);
      }
      this.set(A4Q3, QFLAG.REWARDGRANTED);
      this.clr(A4Q3, QFLAG.REWARDPENDING);
      d3.guid = true;
    }
  }

  /** 출처: ACT4Q2_Callback11_ScrollMessage (20000) — SUNIT_AllocUnitData(UNIT_OBJECT, 566, Tyrael x + 5, OBJMODE_OPERATING) */
  private spawnAct5Portal(): void {
    if (this.q2.portalSpawned) return;
    const at = this.h.npcPos('tyrael2');
    if (!at) return;
    if (this.h.createObject(TOWN, OBJ_LASTLASTPORTAL, at.x + 5, at.y, OBJMODE.OPERATING)) this.q2.portalSpawned = true;
  }

  npcDeactivate(npc: string): void {
    if (npc === 'tyrael2' && this.q1.tyraelActivated) {
      this.iterate(A4Q1, 1);
      this.q1.tyraelActivated = false;
    }
    if (npc === 'tyrael2' && this.q2.talkedTyrael) {
      this.iterate(A4Q2, 1);
      this.q2.talkedTyrael = false;
    }
    if (npc === 'cain4' && this.q3.cainActivated) {
      this.iterate(A4Q3, this.q3.soulstoneAcquired ? 4 : 1);
      this.q3.cainActivated = false;
      this.updateFlags(A4Q3);
    }
  }

  // ------------------------------------------------------------ 레벨 이동

  changeLevel(oldNo: number, newNo: number): void {
    // 출처: ACT4Q1_Callback03_ChangedLevel
    const d1 = this.Q(A4Q1);
    if (oldNo === TOWN) {
      d1.guid = false;
      if (d1.state === 2 && !this.has(A4Q1, QFLAG.REWARDGRANTED)) {
        d1.state = 3;
        this.updateFlags(A4Q1);
        if (!d1.lastState) this.iterate(A4Q1, 1, false);
      }
    }
    // 출처: ACT4Q2_Callback03_ChangedLevel
    const d2 = this.Q(A4Q2);
    if (oldNo === TOWN && d2.state === 2 && !this.has(A4Q2, QFLAG.REWARDGRANTED)) {
      d2.state = 3;
      if (d2.lastState < 1) this.iterate(A4Q2, 1, false);
      this.updateFlags(A4Q2);
    }
    if (newNo === L4.CHAOS && d2.notIntro) {
      if (d2.state < 3) d2.state = 3;
      if (d2.lastState < 1) this.iterate(A4Q2, 1);
      this.updateFlags(A4Q2);
    }
    // 출처: ACT4Q3_Callback03_ChangedLevel
    const d3 = this.Q(A4Q3);
    if (oldNo === TOWN) {
      d3.guid = false;
      if (d3.state === 2 && !this.done(A4Q3)) {
        d3.state = 3;
        this.updateFlags(A4Q3);
      }
    }
  }

  // ------------------------------------------------------------ 몬스터

  monsterKilled(k: ActsKill): void {
    if (k.typeId === 'izual') this.killedIzual(k);
    if (k.typeId === 'diablo') this.killedDiablo(k);
    if (k.typeId === 'hephasto') this.killedHephasto(k);
  }

  /** 출처: ACT4Q1_Callback08_MonsterKilled → 3 틱 뒤 ACT4Q1_SpawnIzualGhost */
  private killedIzual(k: ActsKill): void {
    const d = this.Q(A4Q1), x = this.q1;
    d.state = 4;
    if (d.notIntro) {
      // 출처: 죽인 플레이어 + ACT4Q1_UnitIterate_SetRewardPending (Izual 과 같은 방·이웃 방)
      if ((k.byPlayer || k.playerNear) && !this.done(A4Q1)) {
        this.set(A4Q1, QFLAG.PRIMARYGOALDONE);
        this.set(A4Q1, QFLAG.REWARDPENDING);
        this.h.record.resetIntermediate(A4Q1);
      }
      if (!this.done(A4Q1)) this.set(A4Q1, QFLAG.COMPLETEDNOW);
      if (this.has(A4Q1, QFLAG.PRIMARYGOALDONE)) this.h.emit({ type: 'questCompleted', quest: A4Q1, act: this.act });
      x.ghostAt = { x: k.x, y: k.y };
    }
    if (x.ghostSpawning) return;
    x.ghostSpawning = true;
    this.timer(3, () => {
      if (d.state === 4 && d.lastState !== 4 && d.lastState !== 13) this.iterate(A4Q1, 3);
      const at = x.ghostAt;
      x.ghostAt = null;
      if (at) this.h.spawnMonster(k.levelNo, 'izualghost', Math.floor(at.x), Math.floor(at.y), { npc: true });
      x.ghostSpawning = false;
      return true;
    });
  }

  /**
   * 출처: ACT4Q2_Callback08_MonsterKilled (클래식: QUESTS_TriggerFX(13)) + ACT4Q2_UnitIterate_UpdatePlayerState (디아블로와 같은 방·이웃 방:
   *   PGD·REWARDGRANTED, 클래식 CUSTOM2·CUSTOM3, CLIENTS_UpdateCharacterProgression(4, 난이도)) + SetCompletionFlag + 완료 소리 75
   * 근사(원작 미확인): UpdatePlayerState 는 원작 디컴파일에서 호출 위치가 보이지 않는다 — 디아블로를 죽인 플레이어(또는 가까이 있던 플레이어)에게 적용
   */
  private killedDiablo(k: ActsKill): void {
    const d = this.Q(A4Q2), x = this.q2;
    if (x.diabloKilled) return;
    if (this.h.expansion()) return this.killedDiabloExpansion(k);
    this.h.emit({ type: 'questFx', fx: 13 });
    x.diabloKilled = true;
    if (k.byPlayer || k.playerNear) {
      if (x.endingAt < 0) x.endingAt = this.tick + ENDING_WARP_TICKS;
      this.timer(1, () => this.endingTimer());
    }
    if (!d.notIntro && this.has(A4Q2, QFLAG.REWARDGRANTED)) {
      // 이미 끝낸 난이도: 기록은 그대로, 엔딩(마을로)만
      this.h.completeDifficulty();
      this.h.emit({ type: 'gameCompleted', difficulty: this.h.difficulty() });
      return;
    }
    this.iterate(A4Q2, 13);
    if ((k.byPlayer || k.playerNear) && !this.done(A4Q2)) {
      this.set(A4Q2, QFLAG.PRIMARYGOALDONE);
      this.set(A4Q2, QFLAG.REWARDGRANTED);
      this.h.record.resetIntermediate(A4Q2);
      this.set(A4Q2, QFLAG.CUSTOM2);
      this.set(A4Q2, QFLAG.CUSTOM3);
    }
    if (!this.has(A4Q2, QFLAG.REWARDGRANTED)) this.set(A4Q2, QFLAG.COMPLETEDNOW);
    if (this.has(A4Q2, QFLAG.PRIMARYGOALDONE)) {
      this.h.emit({ type: 'questCompleted', quest: A4Q2, act: this.act });
      // 출처: CLIENTS_UpdateCharacterProgression(…, 4, nDifficulty) — 캐릭터 진행 값(칭호)·다음 난이도
      this.h.progress(4);
      this.h.completeDifficulty();
      this.h.emit({ type: 'gameCompleted', difficulty: this.h.difficulty() });
    }
  }

  /**
   * 확장팩 (출처: ACT4Q2_Callback08_MonsterKilled · UnitIterate_SetPrimaryGoalDone 의 bExpansion 분기) — FX 13·CUSTOM2/3·진행 값·
   *   엔딩(마을 이동·게임 끝)이 없다. 난이도는 바알(A5Q6)에서 끝난다. Tyrael 이 Harrogath 포털을 연다 (대사 20000)
   */
  private killedDiabloExpansion(k: ActsKill): void {
    const d = this.Q(A4Q2);
    this.q2.diabloKilled = true;
    if (!d.notIntro) return;
    this.iterate(A4Q2, 13);
    if ((k.byPlayer || k.playerNear) && !this.done(A4Q2)) {
      this.set(A4Q2, QFLAG.PRIMARYGOALDONE);
      this.set(A4Q2, QFLAG.REWARDGRANTED);
      this.h.record.resetIntermediate(A4Q2);
    }
    if (!this.has(A4Q2, QFLAG.REWARDGRANTED)) this.set(A4Q2, QFLAG.COMPLETEDNOW);
    if (this.has(A4Q2, QFLAG.PRIMARYGOALDONE)) this.h.emit({ type: 'questCompleted', quest: A4Q2, act: this.act });
  }

  /** 출처: ACT4Q2_SpawnDiablo 클래식 분기 — 90 초 뒤 PGD 인 플레이어를 판데모니움 요새로 (엔딩 영상은 근사: 생략) */
  private endingTimer(): boolean {
    const x = this.q2;
    if (x.warped || this.tick < x.endingAt) return false;
    x.warped = true;
    if (this.has(A4Q2, QFLAG.PRIMARYGOALDONE) || this.has(A4Q2, QFLAG.REWARDGRANTED)) {
      if (this.h.levelNo() !== TOWN) this.h.warpToLevel(TOWN);
      this.h.emit({ type: 'questEnding', difficulty: this.h.difficulty() });
    }
    return true;
  }

  /** 디버그·테스트: 엔딩 타이머를 바로 끝낸다 */
  skipEnding(): void {
    if (this.q2.endingAt >= 0) this.q2.endingAt = this.tick;
  }

  /** 출처: ACT4Q3_Callback08_MonsterKilled — Hephasto 가 헬포지 망치(hfh, 유니크) */
  private killedHephasto(k: ActsKill): void {
    if (!this.Q(A4Q3).notIntro) return;
    this.h.dropAt('hfh', k.x, k.y, QUALITY.UNIQUE);
  }

  /** 보스가 깨어남: Izual (ACT4Q1_OnIzualActivated), 봉인 (로그 갱신) */
  override gameEvent(ev: { type: string; [k: string]: unknown }): void {
    const d = this.Q(A4Q1);
    if (ev.type === 'bossActivated' && ev.typeId === 'izual' && d.notIntro && d.lastState < 2) this.iterate(A4Q1, 2);
    if ((ev.type === 'sealOperated' || ev.type === 'diabloSpawned') && this.Q(A4Q2).lastState) {
      this.h.emit({ type: 'questUpdate', quest: A4Q2, act: this.act, status: this.status(A4Q2) });
    }
  }

  /** 출처: ACT4Q3_Callback04_ItemPickedUp (영혼석·망치) */
  itemPickedUp(code: string): void {
    if (code !== 'mss' && code !== 'hfh') return;
    const d = this.Q(A4Q3);
    if (this.has(A4Q3, QFLAG.REWARDGRANTED) || this.has(A4Q3, QFLAG.PRIMARYGOALDONE) || this.has(A4Q3, QFLAG.REWARDPENDING) || !d.notIntro || d.lastState === 13) return;
    if (!d.state) d.state = 1;
  }

  // ------------------------------------------------------------ 오브젝트

  /** 출처: OBJECTS_InitFunction48_HellForge, OBJECTS_InitFunction78_LastLastPortal (처음은 열리는 중, 다시 만들면 열림) */
  initObject(o: ObjectUnit): void {
    if (o.type.initFn === 78) {
      if (this.q2.portalMode === OBJMODE.OPENED) this.h.setObjectMode(o, OBJMODE.OPENED);
      else {
        this.q2.portalMode = OBJMODE.OPENED;
        this.h.setObjectMode(o, OBJMODE.OPERATING, true);
      }
      return;
    }
    if (o.type.initFn !== 48) return;
    const d = this.Q(A4Q3);
    if (!d.notIntro) {
      this.h.setObjectMode(o, OBJMODE.SPECIAL1);
      return;
    }
    this.h.setObjectMode(o, this.q3.forgeMode);
    if (d.lastState !== 13 && d.lastState !== 2 && d.lastState !== 3) this.iterate(A4Q3, 2);
  }

  /** objects.txt OperateFn 49 HellForge, 73 LastLastPortal */
  operate(o: ObjectUnit): boolean {
    if (o.type.operateFn === 73) {
      this.opLastLastPortal();
      return true;
    }
    if (o.type.operateFn !== 49) return false;
    this.opForge(o);
    return true;
  }

  /**
   * 출처: A4Q3.cpp OBJECTS_OperateFunction49_HellForge — 영혼석(mss)을 놓으면 열림, 손에 헬포지 망치(hfh)를 들고 세 번 치면 영혼석이 부서진다
   *   (SPECIAL1 → 망치·PGD·REWARDPENDING, S1 애니메이션 뒤 ACT4Q3_CreateReward: SPECIAL2 + 보석 4개 20 틱 간격)
   */
  private opForge(o: ObjectUnit): void {
    const d = this.Q(A4Q3), x = this.q3;
    if (this.done(A4Q3)) {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    if (o.mode === OBJMODE.NEUTRAL) {
      if (this.item('mss')) {
        this.h.setObjectMode(o, OBJMODE.OPERATING, true);
        x.forgeMode = OBJMODE.OPENED;
        this.iterate(A4Q3, 3);
        this.h.deleteItem('mss');
        return;
      }
      this.h.emit({ type: 'questSound', sound: 19 });
      if (d.notIntro && !d.state) d.state = 1;
      return;
    }
    if (o.mode !== OBJMODE.OPENED) return;
    if (!this.item('hfh') || this.h.weaponCode() !== 'hfh') {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    x.hits++;
    this.h.emit({ type: 'hellforgeHit', hits: x.hits });
    if (x.hits <= 2) return;
    this.h.setObjectMode(o, OBJMODE.SPECIAL1);
    x.forgeMode = OBJMODE.SPECIAL1;
    this.h.deleteItem('hfh');
    this.set(A4Q3, QFLAG.PRIMARYGOALDONE);
    this.set(A4Q3, QFLAG.REWARDPENDING);
    this.h.record.resetIntermediate(A4Q3);
    x.smashed = true;
    x.tier = 4;
    d.state = 4;
    this.iterate(A4Q3, 13);
    this.h.emit({ type: 'questFx', fx: 14 });
    this.h.emit({ type: 'questCompleted', quest: A4Q3, act: this.act });
    // 출처: EVENTTYPE_QUESTFN (S1 애니메이션 프레임 뒤) → ACT4Q3_CreateReward
    // 근사(원작 미확인): objects.txt FrameCnt3 대신 1초
    this.timer(25, () => this.forgeReward(o));
  }

  /**
   * 출처: OBJECTS_OperateFunction73_LastLastPortal — 확장팩만. Terror's End 를 끝냈으면 A4COMPLETED (GRANTED·PGD) 후 Harrogath 로 (웨이포인트 켜짐).
   * 근사(원작 미확인): 원작은 도착 칸 nTileInfo 5 와 Act 4 끝 영상(0x61 5) — 여기서는 마을 시작 자리, 영상 없이 actChange 만
   */
  private opLastLastPortal(): void {
    if (!this.h.expansion()) return;
    if (!this.has(A4Q2, QFLAG.REWARDGRANTED) && !this.has(A4Q2, QFLAG.PRIMARYGOALDONE)) {
      this.h.emit({ type: 'questSound', sound: 19 });
      return;
    }
    if (this.h.act() !== this.act) return;
    if (!this.has(QW.A4COMPLETED, QFLAG.REWARDGRANTED)) {
      this.set(QW.A4COMPLETED, QFLAG.REWARDGRANTED);
      this.set(QW.A4COMPLETED, QFLAG.PRIMARYGOALDONE);
    }
    this.h.travelAct(ACT5);
  }

  /** 출처: ACT4Q3_CreateReward — 등급 4 (완벽) → 3·2 (흠 없는) → 1 (보통), 20 틱마다 한 개, 아이템 레벨 50 */
  private forgeReward(o: ObjectUnit): boolean {
    const x = this.q3;
    if (x.smashed && o.mode !== OBJMODE.SPECIAL2) this.h.setObjectMode(o, OBJMODE.SPECIAL2);
    const row = x.tier === 4 ? 0 : x.tier === 3 || x.tier === 2 ? 1 : x.tier === 1 ? 2 : -1;
    if (row < 0) return true;
    const codes = HELLFORGE_GEMS[row] as readonly string[];
    const code = codes[(this.h.seed.roll() >>> 0) % codes.length] as string;
    if (this.h.dropAt(code, o.x, o.y, QUALITY.NORMAL)) x.tier--;
    if (x.tier <= 0) return true;
    this.timer(20, () => this.forgeReward(o));
    return true;
  }

  // ------------------------------------------------------------ 퀘스트 로그

  /**
   * A4Q2 로그: 카오스 생추어리 진행 (qstsa4q21 찾기 → qstsa4q23 "남은 봉인 %d" → qstsa4q24 "마지막 봉인" → qstsa4q22 "디아블로 처치").
   * 근사(원작 미확인): 원작 클라이언트가 봉인 수를 받아 고르는 방식 미확인 — 엔진 카오스 상태로 고른다
   */
  override status(w: number): number {
    const s = super.status(w);
    if (w !== A4Q2 || s !== 1 || this.has(A4Q2, QFLAG.REWARDGRANTED)) return s;
    const c = this.h.chaos();
    if (c.diabloSpawned && !c.diabloKilled) return 2;
    if (c.sealsOpened >= 4 && c.sealsOpened < 5) return 4;
    if (c.sealsOpened >= 1) return 3;
    return s;
  }

  protected override logCount(w: number): number {
    return w === A4Q2 ? Math.max(0, 5 - this.h.chaos().sealsOpened) : 0;
  }
}
