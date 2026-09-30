// 입력은 오직 명령(Command) 객체로 엔진에 전달된다 (DOM 이벤트 → input/mapper.ts → Command).
import type { NpcOption } from './npc';

export type ItemLocation =
  | { kind: 'inventory'; x: number; y: number }
  | { kind: 'stash'; x: number; y: number }
  /** 호라드릭 큐브 칸 (3×4) */
  | { kind: 'cube'; x: number; y: number }
  | { kind: 'equip'; slot: string }
  | { kind: 'belt'; slot: number }
  | { kind: 'ground' }
  | { kind: 'cursor' }
  /** 소켓 아이템에 보석 박기 (대상 아이템 Id) */
  | { kind: 'socket'; itemId: number };

export type Command =
  | { type: 'move'; x: number; y: number; run: boolean }
  | { type: 'attack'; targetId: number; standStill: boolean }
  | { type: 'useSkill'; skill: number; hand: 'left' | 'right'; x: number; y: number; targetId?: number; targetItem?: number }
  | { type: 'pickup'; itemId: number }
  /** 오브젝트 조작 (걸어가서 연다: 상자·문·신전·우물·웨이포인트·포털) */
  | { type: 'interact'; unitId: number }
  /** 웨이포인트 목록에서 레벨 고르기 (열어 둔 웨이포인트에서 그 레벨 웨이포인트로 이동) */
  | { type: 'waypoint'; level: string | number }
  | { type: 'useBelt'; slot: number }
  | { type: 'moveItem'; itemId: number; to: ItemLocation }
  /** 인벤토리·벨트 아이템 사용 (물약 마시기, 두루마리 읽기 — 원작 우클릭) */
  | { type: 'useItem'; itemId: number; targetId?: number }
  | { type: 'spendStat'; stat: 'str' | 'dex' | 'vit' | 'ene' }
  | { type: 'spendSkill'; skill: number }
  | { type: 'setSkill'; hand: 'left' | 'right'; skill: number }
  /** 자기 시체 줍기 (걸어가서 장비를 되찾음) */
  | { type: 'takeCorpse' }
  /** NPC 메뉴 고르기 (talk/trade/tradeRepair/gamble/hire/resurrect/identify/imbue/goEast/cancel, 퀘스트 항목 quest:<퀘스트>:<문자열 번호>) */
  | { type: 'npcMenu'; option: NpcOption }
  /** Charsi 담금질: 커서(또는 인벤토리) 아이템을 레어로 (A1Q3 보상) */
  | { type: 'imbue'; itemId: number }
  /** 상점·도박 아이템 사기 (multi = Shift+우클릭 멀티바이, toInventory = 우클릭: 벨트 대신 인벤토리) */
  | { type: 'buy'; itemId: number; multi?: boolean; toInventory?: boolean }
  /** 아이템 팔기 (인벤토리·벨트·커서) */
  | { type: 'sell'; itemId: number }
  /** 수리 (itemId 없으면 모두 수리) */
  | { type: 'repair'; itemId?: number }
  /** 고용 목록에서 용병 고르기 (목록 칸 번호) */
  | { type: 'hire'; index: number }
  /** NPC 대화·상점 닫기 */
  | { type: 'closeNpc' }
  /** 호라드릭 큐브: 열기(인벤토리·보관함의 큐브 오른쪽 클릭과 같음) · 트랜스뮤트 단추 · 닫기 */
  | { type: 'openCube' }
  | { type: 'transmute' }
  | { type: 'closeCube' }
  /** 막 이동 다시 시도 (막 월드를 읽는 동안 미뤄 둔 Warriv·Meshif·포털 이동 — 조건은 엔진이 다시 본다) */
  | { type: 'travelAct'; act: number }
  // ---- [UI Phase 12 Step 2] 골드 옮기기 (원작 금화 창: 보관함 넣기·빼기, 인벤토리에서 떨어뜨리기)
  | { type: 'goldTransfer'; to: 'stash' | 'inventory' | 'ground'; amount: number }
  // ---- [UI Phase 12 Step 2] 끝
  | { type: 'saveAndExit' };
