// 막별 퀘스트 상태 기계를 합친 퀘스트 제어 (원작 pGame->pQuestControl: 모든 막의 퀘스트를 한 번에 돌린다).
// 출처: D2MOO D2Game/src/QUESTS/Quests.cpp — gpQuestInitTable (A1Q0~A4Q3 이 한 표), QUESTS_SequenceCycler·QUESTS_QuestUpdater·
//       QUESTS_ChangeLevel·QUESTS_UnitIterate 는 막을 가리지 않고 모든 퀘스트 콜백을 부른다.
// Act 2~4 퀘스트는 Phase 7 이 ActQuestModule 을 구현해 ACT_QUESTS 에 더한다 (Act 1 파일은 건드리지 않는다).
import type { ObjectUnit } from '../objects';
import { Act1Quests, type QuestHost, type QuestLogEntry, type QuestSpeech } from './act1';

export type { QuestHost, QuestLogEntry, QuestSpeech } from './act1';

/** 몬스터 처치 알림 (QUESTS 콜백 MonsterKilled) */
export interface QuestKill { levelNo: number; typeId: string; superUnique?: string; x: number; y: number; byPlayer: boolean; playerNear: boolean }

/** 한 막의 퀘스트 모듈 (원작 막별 A{n}Q{m}.cpp 콜백 묶음) */
export interface ActQuestModule {
  /** 막 번호 (0 = Act 1) */
  readonly act: number;
  startGame(): void;
  update(): void;
  changeLevel(oldNo: number, newNo: number): void;
  monsterKilled(k: QuestKill): void;
  itemPickedUp(code: string): void;
  initObject(o: ObjectUnit): void;
  /** 퀘스트가 오브젝트 조작을 가로채면 true */
  operate(o: ObjectUnit): boolean;
  npcHasQuest(npc: string): boolean;
  npcActivate(npc: string): QuestSpeech[];
  npcDeactivate(npc: string): void;
  scrollMessage(npc: string, index: number): void;
  /** 퀘스트 패널 한 탭 (막) 의 줄 */
  log(): QuestLogEntry[];
}

export type ActQuestFactory = (h: QuestHost) => ActQuestModule;

/** 막 → 퀘스트 모듈 생성 (Phase 7: 1 → Act2Quests, 2 → Act3Quests, 3 → Act4Quests) */
export const ACT_QUESTS: Readonly<Record<number, ActQuestFactory>> = {
  0: (h) => new Act1Quests(h),
};

/** 모든 막 퀘스트를 합친 제어 — 게임 사건을 모든 막 모듈에 차례로 알린다 (원작 콜백 순서: 퀘스트 번호 순) */
export class QuestControl {
  readonly acts: ActQuestModule[];

  constructor(h: QuestHost, factories: Readonly<Record<number, ActQuestFactory>> = ACT_QUESTS) {
    this.acts = Object.keys(factories).map(Number).sort((a, b) => a - b).map((a) => (factories[a] as ActQuestFactory)(h));
  }

  /** 막 모듈 (없으면 undefined) */
  get(act: number): ActQuestModule | undefined {
    return this.acts.find((m) => m.act === act);
  }
  startGame(): void {
    for (const m of this.acts) m.startGame();
  }
  update(): void {
    for (const m of this.acts) m.update();
  }
  changeLevel(oldNo: number, newNo: number): void {
    for (const m of this.acts) m.changeLevel(oldNo, newNo);
  }
  monsterKilled(k: QuestKill): void {
    for (const m of this.acts) m.monsterKilled(k);
  }
  itemPickedUp(code: string): void {
    for (const m of this.acts) m.itemPickedUp(code);
  }
  initObject(o: ObjectUnit): void {
    for (const m of this.acts) m.initObject(o);
  }
  operate(o: ObjectUnit): boolean {
    for (const m of this.acts) if (m.operate(o)) return true;
    return false;
  }
  npcHasQuest(npc: string): boolean {
    return this.acts.some((m) => m.npcHasQuest(npc));
  }
  npcActivate(npc: string): QuestSpeech[] {
    return this.acts.flatMap((m) => m.npcActivate(npc));
  }
  npcDeactivate(npc: string): void {
    for (const m of this.acts) m.npcDeactivate(npc);
  }
  scrollMessage(npc: string, index: number): void {
    for (const m of this.acts) m.scrollMessage(npc, index);
  }
  /** 퀘스트 패널 탭 (막) 의 줄. 모듈이 없는 막은 빈 탭 */
  log(act: number): QuestLogEntry[] {
    return this.get(act)?.log() ?? [];
  }
  /** 퀘스트 모듈이 있는 막 */
  get availableActs(): number[] {
    return this.acts.map((m) => m.act);
  }
}
