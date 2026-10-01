// Act 2~4 퀘스트 모듈의 공통 틀 (원작 D2QuestDataStrc·QUESTS_* 도우미).
// 출처: D2MOO D2Game/src/QUESTS/Quests.cpp — QUESTS_UnitIterate(fLastState 갱신 + 로그 패킷), QUESTS_StateDebug(fState 바꾸기),
//       QUESTS_CreateTimer/QuestUpdater(틱 타이머), QUESTS_InitScrollTextChain(표 → 대사 목록), QUESTS_RefreshStatus(로그 상태 바이트),
//       QUESTS_StatusCallback(fLastState 가 0 이면 보내지 않음), QUESTS_AddPlayerGUID/CheckPlayerGUID (싱글플레이: 불리언 하나)
// (https://github.com/ThePhrozenKeep/D2MOO)
import type { ObjectUnit } from '../objects';
import type { QuestHost, QuestLogEntry, QuestSpeech } from './act1';
import { QFLAG } from './record';
import { NPC_MESSAGES_ACTS, QUEST_LOG_ORDER_ACTS, wordOfQuest } from './messages-acts';

/** 퀘스트 킬 알림 (quests/index.ts QuestKill 과 같은 모양) */
export interface ActsKill {
  levelNo: number; typeId: string; superUnique?: string; x: number; y: number; byPlayer: boolean; playerNear: boolean;
  /** 챔피언·유니크·슈퍼 유니크 (MONSTERUNIQUE_CheckMonTypeFlag) */
  boss?: boolean;
  /** 몬스터 유닛 번호 */
  id?: number;
  /** monstats flying */
  flying?: boolean;
}

/** 카오스 생추어리 상태 (engine/chaos.ts 읽기 전용 요약) */
export interface ChaosView { sealsOpened: number; diabloSpawned: boolean; diabloKilled: boolean; cleared: boolean }

/** Act 2~4 퀘스트가 게임에 더 요청하는 것 (Game.questHost 가 구현) */
export interface ActsQuestHost extends QuestHost {
  /** STATLIST_AddUnitStat(STAT_STATPTS) */
  addStatPoints(n: number): void;
  /** 기본 최대 생명 영구 증가 (Potion of Life) */
  addLife(n: number): void;
  /** 손에 든 무기 코드 (INVENTORY_GetLeftHandWeapon) */
  weaponCode(): string | undefined;
  /** 레벨의 오브젝트 (objects.txt 번호). 레벨이 아직 없으면 undefined */
  findObject(levelNo: number, classId: number): ObjectUnit | undefined;
  /** 유닛 번호로 오브젝트 (SUNIT_GetServerUnit(UNIT_OBJECT)) — 그 레벨이 없으면 undefined */
  findObjectById?(levelNo: number, id: number): ObjectUnit | undefined;
  /** 오브젝트 만들기 (SUNIT_AllocUnitData(UNIT_OBJECT)) — 레벨 서브타일 */
  createObject(levelNo: number, classId: number, x: number, y: number, mode: number): ObjectUnit | null;
  /** 몬스터 만들기 (boss = 유니크 굴림, npc = 말을 걸 수 있는 NPC). 만든 유닛 번호 */
  spawnMonster(levelNo: number, typeId: string, x: number, y: number, opts?: { boss?: boolean; npc?: boolean }): number | null;
  /** 레벨의 살아 있는 몬스터 (퀘스트 연결 판단용) */
  levelMonsters(levelNo: number): { id: number; typeId: string; superUnique?: string; x: number; y: number }[];
  /** 레벨 포털 자리로 이동 (LEVEL_WarpUnit / 포털 오브젝트) */
  warpToLevel(levelNo: number): boolean;
  /** 막 이동 (D2GAME_PlayerChangeAct, 조건 없이) */
  travelAct(act: number): boolean;
  /** 마을 퀘스트 NPC 자리 다시 (Jerhyn·Kaelan·Hratli) */
  refreshTownNpcs(): void;
  /** 카오스 생추어리 요약 */
  chaos(): ChaosView;
  /** 난이도 완료 → 다음 난이도 해금 (저장의 difficultyUnlocked = min(난이도 + 1, 2)) */
  completeDifficulty(): void;
  /** 출처: CLIENTS_UpdateCharacterProgression(nAct, nDifficulty) — 진행 값 = max(진행 값, nAct + 난이도 × 4) (클래식, 칭호) */
  progress(nAct: number): void;
  /** 현재 난이도 (0 보통, 1 악몽, 2 지옥) */
  difficulty(): number;
  /** 지금 막 (0 = Act 1) */
  act(): number;
  /** 확장팩 게임 (원작 pGame->bExpansion) */
  expansion(): boolean;
  /** 지금 레벨의 NPC 자리 (UNITS_GetCoords(pQuestArg->pTarget)) — 없으면 null */
  npcPos(typeId: string): { x: number; y: number } | null;
  /** SuperUniques.txt 행 → 이름 키 (MONSTERUNIQUE_GetBossHcIdx 비교용) */
  superUniqueKey?(idx: number): string | undefined;
  /** 지금 레벨에 슈퍼유니크 (D2GAME_SpawnPresetMonster — SuperUniques.txt 이름 키). 만든 유닛 번호 */
  spawnSuperUnique?(key: string, x: number, y: number): number | null;
  /** 유닛 없애기 (SUNIT_RemoveUnit — 몬스터·NPC·오브젝트) */
  removeUnit?(levelNo: number, id: number): void;
  /** 플레이어 직업 (charstats class — 'Amazon' …) */
  playerClass?(): string | undefined;
  /** 퀘스트 경험치 (한 레벨 폭까지 — ACT5Q5_RewardPlayer). 실제로 준 양 */
  giveQuestExperience?(amount: number): number;
  /** 그 레벨에 있는 플레이어 마을 포털을 닫는다 */
  closeTownPortalIn?(levelNo: number): void;
  /** 그 레벨 웨이포인트를 켰다 (WAYPOINTS_IsActivated — 웨이포인트가 없는 레벨이면 true) */
  waypointActive?(levelNo: number): boolean;
}

/** 원작 D2QuestDataStrc 에서 쓰는 칸 */
export class QuestData {
  notIntro = true;
  active = true;
  state = 0;
  lastState = 0;
  flags = 0;
  /** tPlayerGUIDs 에 플레이어가 있음 */
  guid = false;
  /**
   * @param word 퀘스트 기록 워드 (nQuestFilter)
   * @param initNo nInitNo (QUESTS_RefreshStatus)
   * @param noSetState gpQuestInitTable bNoSetState — 끝낸 퀘스트여도 새 게임에서 bNotIntro 를 끄지 않는다
   */
  constructor(readonly word: number, readonly initNo: number, readonly noSetState = false) {}
}

interface Timer { at: number; timeout: number; fn: () => boolean }

/** 막 퀘스트 모듈의 공통 부분 (원작 Quests.cpp 도우미) */
export abstract class ActQuestBase {
  abstract readonly act: number;
  protected readonly q: Record<number, QuestData> = {};
  private readonly timers: Timer[] = [];
  protected tick = 0;

  constructor(protected readonly h: ActsQuestHost) {}

  protected Q(word: number): QuestData {
    return this.q[word] as QuestData;
  }
  protected has(w: number, f: number): boolean {
    return this.h.record.get(w, f);
  }
  protected set(w: number, f: number): void {
    this.h.record.set(w, f);
  }
  protected clr(w: number, f: number): void {
    this.h.record.clear(w, f);
  }
  /** 보상 받음 또는 보상 대기 */
  protected done(w: number): boolean {
    return this.has(w, QFLAG.REWARDGRANTED) || this.has(w, QFLAG.REWARDPENDING);
  }
  protected item(code: string): boolean {
    return this.h.hasItem(code);
  }

  /** QUESTS_UnitIterate: fLastState = 상태, send 면 로그 갱신 알림 (QUESTS_StatusCyclerEx → 패킷 0x5D) */
  protected iterate(w: number, state: number, send = true): void {
    const d = this.Q(w);
    d.flags &= ~0xff;
    d.lastState = state;
    if (send) this.h.emit({ type: 'questUpdate', quest: w, act: this.act, status: this.status(w) });
  }

  /** QUESTS_CreateTimer: ticks 틱 뒤 fn (true 면 끝, 아니면 ticks 뒤 다시) */
  protected timer(ticks: number, fn: () => boolean): void {
    this.timers.push({ at: this.tick + ticks, timeout: ticks, fn });
  }

  /** 출처: QUESTS_QuestUpdater */
  update(): void {
    this.tick++;
    for (const t of [...this.timers]) {
      if (t.at >= this.tick) continue;
      if (t.fn()) this.timers.splice(this.timers.indexOf(t), 1);
      else t.at = this.tick + t.timeout;
    }
  }

  /** 출처: QUESTS_InitScrollTextChain — 표의 그 NPC 줄 */
  protected chain(w: number, table: number, npc: string, out: QuestSpeech[]): void {
    for (const msg of NPC_MESSAGES_ACTS[w]?.[table] ?? []) if (msg.npc === npc) out.push({ ...msg, quest: w });
  }

  /**
   * 게임 시작 (QUESTS_SequenceCycler bGameEnter = 0): 끝냈던 퀘스트(bNoSetState 가 아닌)는 bNotIntro·bActive = 0, fLastState = 0,
   * 전역 기록 COMPLETEDBEFORE. 그 뒤 PLAYERSTARTEDGAME 콜백 (퀘스트 번호 역순)
   */
  protected startCommon(): void {
    for (const d of Object.values(this.q)) {
      if (d.noSetState) continue;
      if (this.has(d.word, QFLAG.REWARDGRANTED) || this.has(d.word, QFLAG.COMPLETEDBEFORE)) {
        d.notIntro = false;
        d.active = false;
        d.lastState = 0;
        this.h.global.set(d.word, QFLAG.COMPLETEDBEFORE);
      }
    }
  }

  /**
   * 퀘스트 로그 상태 바이트. 출처: QUESTS_StatusCallback — fLastState 가 0 이면 0, StatusFilter 가 있으면 그 값, 없으면 QUESTS_RefreshStatus
   */
  status(w: number): number {
    const d = this.Q(w);
    if (!d || !d.lastState) return 0;
    const f = this.statusFilter(w);
    if (f !== undefined) return f;
    return this.refreshStatus(w);
  }

  /** 퀘스트별 StatusFilter (없으면 undefined) */
  protected statusFilter(_w: number): number | undefined {
    return undefined;
  }

  /** 출처: QUESTS_RefreshStatus */
  protected refreshStatus(w: number): number {
    const d = this.Q(w);
    const now = this.has(w, QFLAG.COMPLETEDNOW);
    if (d.state < d.initNo) return now ? 12 : d.lastState;
    if (!this.has(w, QFLAG.PRIMARYGOALDONE)) {
      // 출처: nQuestNo == 10 (A2Q3) 은 fLastState 4 면 4
      if (w === wordOfQuest(1, 3)) return d.lastState === 4 ? 4 : 12;
      return 12;
    }
    return d.lastState;
  }

  /** 로그 줄의 추가 수 (A4Q2 남은 봉인 등) */
  protected logCount(_w: number): number {
    return 0;
  }

  /**
   * 퀘스트 로그 (quest = 막 안의 번호 1~6).
   * 근사(원작 미확인): 아이콘 판정 — Act 1 과 같다 (상태 13 이거나 보상 받음이면 완료, 상태가 있거나 보상 대기면 진행 중)
   */
  log(): QuestLogEntry[] {
    return (QUEST_LOG_ORDER_ACTS[this.act] ?? []).map((n) => {
      const w = wordOfQuest(this.act, n);
      const status = this.status(w);
      const granted = this.has(w, QFLAG.REWARDGRANTED), pending = this.has(w, QFLAG.REWARDPENDING);
      const done = status === 13 || status === 11 || (granted && !pending);
      const icon: QuestLogEntry['icon'] = done ? 'done' : status || pending ? 'active' : 'none';
      return { quest: n, status, icon, count: this.logCount(w), justDone: done && (this.Q(w)?.notIntro ?? false) };
    });
  }

  /** 디버그·테스트: 원작 fState */
  stateOf(w: number): { state: number; lastState: number; notIntro: boolean; active: boolean } {
    const d = this.Q(w);
    return { state: d.state, lastState: d.lastState, notIntro: d.notIntro, active: d.active };
  }

  /** 퀘스트가 막는 레벨 출구 (from → to, levels.txt 번호). 기본: 없음 */
  exitBlocked(_from: number, _to: number): boolean {
    return false;
  }

  /** 게임 사건 (bossActivated·cubeQuestItem·sealOperated … — 틱 끝에 모아 알림) */
  gameEvent(_ev: { type: string; [k: string]: unknown }): void {}

  /** 막 이동 (QUESTS_ActChange_HirelingChangeAct) */
  actChanged(_from: number, _to: number): void {}

  /** 퀘스트 아이템 사용 (Book of Skill·Potion of Life). 처리했으면 true */
  useItem(_code: string): boolean {
    return false;
  }

  /** 아이템을 땅에 떨어뜨림 (QUESTEVENT_ITEMDROPPED) */
  itemDropped(_code: string): void {}
}
