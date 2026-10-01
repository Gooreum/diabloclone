// 막별 퀘스트 상태 기계를 합친 퀘스트 제어 (원작 pGame->pQuestControl: 모든 막의 퀘스트를 한 번에 돌린다).
// 출처: D2MOO D2Game/src/QUESTS/Quests.cpp — gpQuestInitTable (A1Q0~A4Q3 이 한 표), QUESTS_SequenceCycler·QUESTS_QuestUpdater·
//       QUESTS_ChangeLevel·QUESTS_UnitIterate 는 막을 가리지 않고 모든 퀘스트 콜백을 부른다.
// Act 2~4 퀘스트는 Phase 7 이 ActQuestModule 을 구현해 ACT_QUESTS 에 더한다 (Act 1 파일은 건드리지 않는다).
import type { ObjectUnit } from '../objects';
import { Act1Quests, type QuestHost, type QuestLogEntry, type QuestSpeech } from './act1';
import type { ActsQuestHost } from './acts-base';
import { Act2Quests } from './act2';
import { Act3Quests } from './act3';
import { Act4Quests } from './act4';
import { Act5Quests } from './act5';

export type { QuestHost, QuestLogEntry, QuestSpeech } from './act1';
export type { ActsQuestHost, ChaosView } from './acts-base';

/** 몬스터 처치 알림 (QUESTS 콜백 MonsterKilled) */
export interface QuestKill {
  levelNo: number; typeId: string; superUnique?: string; x: number; y: number; byPlayer: boolean; playerNear: boolean;
  /** 유닛 번호 */
  id?: number;
  /** 유니크·슈퍼 유니크 (MONTYPEFLAG_UNIQUE | SUPERUNIQUE — 옥 조각상·기드빈 보스 판단) */
  boss?: boolean;
  /** monstats flying (QUESTS_SetJadeFigurineBoss 는 나는 몬스터를 뺀다) */
  flying?: boolean;
}

/**
 * 퀘스트 모듈이 보는 오브젝트 InitFn (Game.createObject 가 initObject 를 부르는 것).
 * 출처: objects.txt InitFn — Act 1: 4 TowerTome, 6 CairnStone, 7 CainGibbet, 9 InifussTree, 13 InvisibleObject, 15 MalusStand, 47 CountessChest /
 *       Act 2: 21 HoradricOrifice, 38 TyraelsDoor / Act 3: 25 Gidbinn, 39 GidbinnAltar, 41 SewerStairs, 42 SewerLever, 44 HellGate, 45 MephistoBridge,
 *       53 StairsR, 60 CompellingOrb / Act 4: 48 HellForge, 78 LastLastPortal (확장팩) / Act 5: 71 LarzukStandard, 62 CagedWussie
 */
export const QUEST_INIT_FNS: ReadonlySet<number> = new Set([4, 6, 7, 9, 13, 15, 47, 21, 38, 25, 39, 41, 42, 44, 45, 53, 60, 48, 78, 71, 62, 66, 67, 68, 74]);

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
  /** 퀘스트가 막는 레벨 출구 (QUESTS_LevelWarpCheck) */
  exitBlocked?(from: number, to: number): boolean;
  /** 게임 사건 (bossActivated·cubeQuestItem·sealOperated …) */
  gameEvent?(ev: { type: string; [k: string]: unknown }): void;
  /** 막 이동 (QUESTS_ActChange_HirelingChangeAct) */
  actChanged?(from: number, to: number): void;
  /** 퀘스트 아이템 사용 — 처리했으면 true */
  useItem?(code: string): boolean;
  /** 아이템을 땅에 떨어뜨림 (QUESTEVENT_ITEMDROPPED) */
  itemDropped?(code: string): void;
}

export type ActQuestFactory = (h: ActsQuestHost) => ActQuestModule;

/** 막 → 퀘스트 모듈 생성 */
export const ACT_QUESTS: Readonly<Record<number, ActQuestFactory>> = {
  0: (h) => new Act1Quests(h),
  1: (h) => new Act2Quests(h),
  2: (h) => new Act3Quests(h),
  3: (h) => new Act4Quests(h),
};

/** 확장팩: Act 5 (Harrogath) 퀘스트까지 (원작 gpQuestInitTable 의 nVersion — 확장팩 게임에서만 A5Q1~A5Q6) */
export const ACT_QUESTS_LOD: Readonly<Record<number, ActQuestFactory>> = { ...ACT_QUESTS, 4: (h) => new Act5Quests(h) };

/** 모든 막 퀘스트를 합친 제어 — 게임 사건을 모든 막 모듈에 차례로 알린다 (원작 콜백 순서: 퀘스트 번호 순) */
export class QuestControl {
  readonly acts: ActQuestModule[];

  constructor(h: ActsQuestHost, factories: Readonly<Record<number, ActQuestFactory>> = ACT_QUESTS) {
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
  /** 출처: QUESTS_LevelWarpCheck — 퀘스트가 막은 출구면 true */
  exitBlocked(from: number, to: number): boolean {
    return this.acts.some((m) => m.exitBlocked?.(from, to) ?? false);
  }
  /** 이번 틱의 게임 사건을 알린다 (알림 중 새로 생긴 사건은 다음 틱) */
  gameEvents(events: readonly { type: string; [k: string]: unknown }[]): void {
    const n = events.length;
    for (let i = 0; i < n; i++) {
      const ev = events[i] as { type: string; [k: string]: unknown };
      if (!QUEST_EVENT_TYPES.has(ev.type)) continue;
      for (const m of this.acts) m.gameEvent?.(ev);
    }
  }
  actChanged(from: number, to: number): void {
    for (const m of this.acts) m.actChanged?.(from, to);
  }
  useItem(code: string): boolean {
    return this.acts.some((m) => m.useItem?.(code) ?? false);
  }
  itemDropped(code: string): void {
    for (const m of this.acts) m.itemDropped?.(code);
  }
  /** Act 2 오염된 태양 (렌더러가 화면을 어둡게) */
  get taintedSun(): boolean {
    return (this.get(1) as Act2Quests | undefined)?.taintedSun ?? false;
  }
}

/** 퀘스트가 듣는 게임 사건 */
const QUEST_EVENT_TYPES = new Set(['bossActivated', 'cubeQuestItem', 'sealOperated', 'diabloSpawned', 'sealBossKilled', 'chaosCleared', 'npcTalk']);
