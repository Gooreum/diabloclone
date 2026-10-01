// 마을 NPC 기능: 메뉴, 상점(사기·팔기·수리·모두 수리), 도박, 감정, 용병 목록.
// 출처: D2MOO D2Game/src/UNIT/SUnitNpc.cpp — NPC_HandleDialogMessage (1 상점: Gheed Akara Charsi, 2 도박: Gheed),
//       sub_6FCC88B0 (사기 — 멀티바이·벨트·책 채우기), D2GAME_STORES_SellItem_6FCC7680 (팔기·되사기), D2GAME_NPC_Repair_6FCC95B0 (수리),
//       D2GAME_NPC_IdentifyAllItems_6FCC9C90 (Cain 감정), D2GAME_NPC_IdentifyBoughtItem_6FCCA990 (도박 감정),
//       sub_6FCC7FA0 (고용), D2GAME_NPC_BuildHirelingList_6FCC6FF0
// 출처: D2MOO D2Game/src/UNIT/SUnitProxy.cpp — SUNITPROXY_InitializeNpcControl (NPC 표: 막·상인 여부), SUNITPROXY_UpdateVendorInventory (재고 초기화)
// (https://github.com/ThePhrozenKeep/D2MOO)
import { questNameKey } from './quests/messages-acts';
import type { GameData, GameEvent } from './game';
import type { ItemStore } from './itemstore';
import type { ItemInstance } from './treasure';
import { QUALITY } from './treasure';
import { Rng } from './rng';
import { fillGamble, fillStore, placeInStore, repairFull, rollGambleItem, storePage, type StoreCtx, type StoreItem } from './shop';
import { gambleCost, isBroken, isRepairable, needsRepair, transactionCost, type PriceCtx } from './price';
import { buildHireList, hirelingInit, type HirelingInit, type MercEntry } from './hireling';

/** NPC 메뉴 항목 */
export type NpcOption =
  | 'talk' | 'trade' | 'tradeRepair' | 'gamble' | 'hire' | 'resurrect' | 'identify' | 'cancel' | 'imbue'
  /** 막 이동: Warriv go east (Act 1 → 2) / go west (Act 2 → 1), Meshif sail east (Act 2 → 3) / sail west (Act 3 → 2) */
  | 'goEast' | 'goWest' | 'sailEast' | 'sailWest'
  /** 확장팩: Tyrael (Act 4) → Harrogath */
  | 'goHarrogath'
  /** 확장팩: Larzuk 소켓 (A5Q1), Anya 이름 새기기 (A5Q4) */
  | 'socket' | 'personalize'
  | QuestTopic;
/** 메뉴의 퀘스트 항목: quest:<퀘스트 번호>:<원작 문자열 번호> (원작 QUESTS_InitScrollTextChain nMenu 2 대사) */
export type QuestTopic = `quest:${number}:${number}`;

export interface NpcDef {
  /** 원작 메뉴 (위에서 아래) */
  menu: NpcOption[];
  /** weapons/armor/misc.txt 상인 컬럼 (소문자) — 원작 표 철자 그대로 (Hratli 는 'hralti') */
  vendor?: string;
  /** npc.txt 행 (가격 배수). 없으면 vendor 와 같다 */
  price?: string;
  /** 막 (0 = Act 1) */
  act: number;
  repair?: boolean;
  gamble?: boolean;
  /** 말을 걸면 치료 (D2GAME_NPC_Heal) */
  heal?: boolean;
  hire?: boolean;
  /** 죽은 용병 부활 (D2GAME_NPC_ResurrectMerc: KASHYA·GREIZ·ASHEARA·TYRAEL2) */
  resurrect?: boolean;
  identify?: boolean;
  /** string.tbl 대사 키 접두사 (AkaraGossip1 …) */
  gossip: string;
}

/**
 * 마을 NPC (monstats Id) — Act 1~4 (클래식).
 * 출처: SUnitProxy.cpp SUNITPROXY_InitializeNpcControl (NPC 표: 막·상인 여부),
 *       SUnitNpc.cpp NPC_HandleDialogMessage (1 상점: GHEED AKARA CHARSI DROGNAN FARA ELZIX LYSANDER ASHEARA HRATLI ALKOR ORMUS HALBU JAMELLA,
 *       2 도박: GHEED ELZIX ALKOR JAMELLA, 3 고용 목록), D2GAME_NPC_Repair (CHARSI FARA HRATLI HALBU),
 *       D2GAME_NPC_Heal (AKARA ATMA FARA ORMUS JAMELLA), D2GAME_NPC_ResurrectMerc (KASHYA GREIZ ASHEARA TYRAEL2),
 *       D2GAME_NPC_BuildHirelingList (KASHYA GREIZ ASHEARA), D2GAME_NPC_IdentifyAllItems (CAIN2~6 — Act 1 마을은 CAIN5),
 *       막 이동 (WARRIV1 → Lut Gholein, WARRIV2 → Rogue Encampment, MESHIF1 → Kurast Docks, MESHIF2 → Lut Gholein)
 * 출처: misc.txt 등 상인 컬럼 — Hratli 는 원작 표 철자 "Hralti"
 * 근사(원작 미확인): 메뉴 순서·문구 선택은 D2Client 메뉴 표 대신 위 서버 함수가 받는 요청 종류로 구성.
 *   Halbu: 클래식 1.14d 데이터(npc.txt 행·Act 4 마을 DS1 프리셋·MonPreset)에 있고 D2MOO 배치 코드에 확장팩 검사가 없어 그대로 둔다 (대사 문자열 없음)
 */
export const NPC_DEFS: Record<string, NpcDef> = {
  // ---- Act 1 (Rogue Encampment)
  akara: { menu: ['talk', 'trade', 'cancel'], vendor: 'akara', act: 0, heal: true, gossip: 'Akara' },
  charsi: { menu: ['talk', 'tradeRepair', 'cancel'], vendor: 'charsi', act: 0, repair: true, gossip: 'Charsi' },
  gheed: { menu: ['talk', 'trade', 'gamble', 'cancel'], vendor: 'gheed', act: 0, gamble: true, gossip: 'Gheed' },
  kashya: { menu: ['talk', 'hire', 'cancel'], act: 0, hire: true, resurrect: true, gossip: 'Kashya' },
  warriv1: { menu: ['talk', 'cancel'], act: 0, gossip: 'Warriv' },
  cain5: { menu: ['talk', 'identify', 'cancel'], act: 0, identify: true, gossip: 'Cain' },
  navi: { menu: ['talk', 'cancel'], act: 0, gossip: 'Navi' },
  // 트리스트럼 감옥에서 구한 Cain (MONSTER_CAIN1): 말만 건다
  cain1: { menu: ['talk', 'cancel'], act: 0, gossip: 'Cain' },
  // ---- Act 2 (Lut Gholein)
  atma: { menu: ['talk', 'cancel'], act: 1, heal: true, gossip: 'Atma' },
  drognan: { menu: ['talk', 'trade', 'cancel'], vendor: 'drognan', act: 1, gossip: 'Drognan' },
  fara: { menu: ['talk', 'tradeRepair', 'cancel'], vendor: 'fara', act: 1, repair: true, heal: true, gossip: 'Fara' },
  elzix: { menu: ['talk', 'trade', 'gamble', 'cancel'], vendor: 'elzix', act: 1, gamble: true, gossip: 'Elzix' },
  lysander: { menu: ['talk', 'trade', 'cancel'], vendor: 'lysander', act: 1, gossip: 'Lysander' },
  // string.tbl 대사 키는 원작 철자 "Griez"
  greiz: { menu: ['talk', 'hire', 'cancel'], act: 1, hire: true, resurrect: true, gossip: 'Griez' },
  geglash: { menu: ['talk', 'cancel'], act: 1, gossip: 'Geglash' },
  jerhyn: { menu: ['talk', 'cancel'], act: 1, gossip: 'Jerhyn' },
  meshif1: { menu: ['talk', 'cancel'], act: 1, gossip: 'Meshif' },
  // Kaelan (궁전 문지기). 근사(원작 미확인): 대사 접두사 PalaceGuard
  act2guard2: { menu: ['talk', 'cancel'], act: 1, gossip: 'PalaceGuard' },
  warriv2: { menu: ['talk', 'cancel'], act: 1, gossip: 'WarrivAct2' },
  cain2: { menu: ['talk', 'identify', 'cancel'], act: 1, identify: true, gossip: 'CainAct2' },
  // Phase 7: 두리엘 방의 Tyrael (MONSTER_TYRAEL1 — A2Q6 대사 302 TyraelGossip1 뒤 마을 포털)
  tyrael1: { menu: ['talk', 'cancel'], act: 1, gossip: 'Tyrael' },
  // ---- Act 3 (Kurast Docks)
  alkor: { menu: ['talk', 'trade', 'gamble', 'cancel'], vendor: 'alkor', act: 2, gamble: true, gossip: 'Alkor' },
  ormus: { menu: ['talk', 'trade', 'cancel'], vendor: 'ormus', act: 2, heal: true, gossip: 'Ormus' },
  hratli: { menu: ['talk', 'tradeRepair', 'cancel'], vendor: 'hralti', price: 'hratli', act: 2, repair: true, gossip: 'Hratli' },
  asheara: { menu: ['talk', 'trade', 'hire', 'cancel'], vendor: 'asheara', act: 2, hire: true, resurrect: true, gossip: 'Asheara' },
  cain3: { menu: ['talk', 'identify', 'cancel'], act: 2, identify: true, gossip: 'CainAct3' },
  natalya: { menu: ['talk', 'cancel'], act: 2, gossip: 'Natalya' },
  meshif2: { menu: ['talk', 'cancel'], act: 2, gossip: 'MeshifAct3' },
  // ---- Act 4 (Pandemonium Fortress)
  tyrael2: { menu: ['talk', 'cancel'], act: 3, resurrect: true, gossip: 'TyraelAct4' },
  jamella: { menu: ['talk', 'trade', 'gamble', 'cancel'], vendor: 'jamella', act: 3, gamble: true, heal: true, gossip: 'HellsAngel' },
  halbu: { menu: ['talk', 'tradeRepair', 'cancel'], vendor: 'halbu', act: 3, repair: true, gossip: 'Halbu' },
  cain4: { menu: ['talk', 'identify', 'cancel'], act: 3, identify: true, gossip: 'CainAct4' },
  // Phase 7: Izual 의 영혼 (MONSTER_IZUALGHOST — A4Q1 대사 675)
  izualghost: { menu: ['talk', 'cancel'], act: 3, gossip: 'Izual' },
  // ---- 확장팩 Act 5 (Harrogath). 출처: SUnitProxy.cpp NPC 표 (MALAH·DREHYA·LARZUK·NIHLATHAK 상인, QUAL_KEHK·TYRAEL3·CAIN6),
  //      SUnitNpc.cpp — 1 상점 LARZUK·DREHYA·MALAH, 2 도박 DREHYA·NIHLATHAK, 수리 LARZUK, 치료 MALAH, 고용·부활 QUAL_KEHK, 감정 CAIN6
  //      대사 키: string.tbl LarzukAct5IntroGossip1 · AnyaGossip1 · QualKehkGossip1 · CainAct5Gossip1 … (Drehya 의 대사 이름은 Anya)
  larzuk: { menu: ['talk', 'tradeRepair', 'cancel'], vendor: 'larzuk', act: 4, repair: true, gossip: 'Larzuk' },
  malah: { menu: ['talk', 'trade', 'cancel'], vendor: 'malah', act: 4, heal: true, gossip: 'Malah' },
  'qual-kehk': { menu: ['talk', 'hire', 'cancel'], act: 4, hire: true, resurrect: true, gossip: 'QualKehk' },
  drehya: { menu: ['talk', 'trade', 'gamble', 'cancel'], vendor: 'drehya', act: 4, gamble: true, gossip: 'Anya' },
  // 근사(원작 미확인): 마을 Nihlathak 의 상점 칸 — 원작 서버는 도박(2)만 받는다. 도박 가격 배수는 npc.txt nihlathak 행
  nihlathak: { menu: ['talk', 'gamble', 'cancel'], act: 4, price: 'nihlathak', gamble: true, gossip: 'Nihlathak' },
  cain6: { menu: ['talk', 'identify', 'cancel'], act: 4, identify: true, gossip: 'CainAct5' },
  // A5Q3 얼음 동굴의 Anya (MONSTER_DREHYAICED — monstats AI NpcOutOfTown)
  drehyaiced: { menu: ['talk', 'cancel'], act: 4, gossip: 'Anya' },
  tyrael3: { menu: ['talk', 'cancel'], act: 4, gossip: 'TyraelAct5' },
};

/**
 * 메뉴 문자열 키 (string.tbl). 부활은 원작 표에 없음 → '' (UI 가 근사 문구).
 * imbue = Upgrade "imbue" (Charsi), goEast = WarrivMenu1b "go east", goWest = WarrivMenu1c "go west",
 * sailEast = MeshifMenuEast "sail east", sailWest = MeshifMenuWest "sail west", 퀘스트 항목은 퀘스트 이름 qstsa1q<번호>
 */
export const NPC_MENU_STRING: Record<Exclude<NpcOption, QuestTopic>, string> = {
  talk: 'TalkMenu', trade: 'NPCMenuTrade', tradeRepair: 'NPCMenuTradeRepair', gamble: 'gamble', hire: 'NPCMenuHire', resurrect: '', identify: 'NPCIdentify1', cancel: 'lowercasecancel',
  imbue: 'Upgrade', goEast: 'WarrivMenu1b', goWest: 'WarrivMenu1c', sailEast: 'MeshifMenuEast', sailWest: 'MeshifMenuWest',
  goHarrogath: 'Travel To Harrogath', socket: 'Addsocketsui', personalize: 'Personalizeui',
};

/** 메뉴 항목의 string.tbl 키 */
export function npcMenuKey(o: NpcOption): string {
  // 퀘스트 번호 = 기록 워드 (Act 1 은 1~6, Act 2~4 는 9~14 · 17~22 · 25~27) → qstsa<막>q<번호>
  if (o.startsWith('quest:')) return questNameKey(Number(o.split(':')[1]));
  return NPC_MENU_STRING[o as Exclude<NpcOption, QuestTopic>] ?? '';
}

/** 보통 난이도 상점 아이템 레벨 상한 (액트별). 출처: FillStoreInventory / sub_6FCC7FA0 npcLevels */
export const NPC_LEVEL_CAP = [12, 20, 28, 36, 45];

/** 퀘스트 플래그 (A1Q2 Blood Raven 보상 — Kashya 고용 허용) */
export const QUEST_A1Q2 = 'a1q2';

/** 퀘스트 플래그 (A5Q2 Rescue on Mount Arreat 보상 — Qual-Kehk 고용 허용) */
export const QUEST_A5Q2 = 'a5q2';

/** 상점 기능이 게임에 요청하는 것 */
export interface TradeHost {
  readonly data: GameData;
  readonly store: ItemStore;
  gold: number;
  stashGold: number;
  readonly playerLevel: number;
  readonly difficulty: 0 | 1 | 2;
  /** 가격 할인 % (item_reducedprices — 구매·수리·도박, 판매가는 그대로). 출처: ITEMS_CalculateTransactionCost */
  readonly reducePct?: number;
  /** npc.txt questflag (퀘스트 할인) · 이름 있는 퀘스트 상태 */
  questDone(flag: number | string): boolean;
  emit(ev: GameEvent): void;
  /** 장착·인벤토리가 바뀜 (파생 스탯 다시 계산) */
  itemsChanged(): void;
}

/** 골드 지불: 인벤토리 골드 먼저, 모자라면 창고 골드. 출처: PLRTRADE_AddGold(STAT_GOLD, −gold) + (STAT_GOLDBANK, gold − cost) */
export function payGold(h: TradeHost, cost: number): boolean {
  if (cost > h.gold + h.stashGold) return false;
  if (cost > h.gold) {
    h.stashGold -= cost - h.gold;
    h.gold = 0;
  } else h.gold -= cost;
  return true;
}

/** 아이템 복제 (새 Id, 소켓 아이템도). 원작 ITEMS_Duplicate 근사: 같은 속성 그대로 */
function duplicate(h: TradeHost, it: ItemInstance): ItemInstance {
  const d = structuredClone(it);
  const fix = (x: ItemInstance) => {
    x.id = h.data.treasure.allocId();
    x.socketed.forEach(fix);
  };
  fix(d);
  return d;
}

/** 벨트 빈 칸에만 넣기 (원작 sub_6FC48940 — 자동 벨트) */
function putInBelt(h: TradeHost, it: ItemInstance): boolean {
  const st = h.store;
  const cap = st.beltCapacity();
  for (let i = 0; i < cap; i++) {
    if (!st.belt[i]) {
      st.belt[i] = it;
      return true;
    }
  }
  return false;
}

/** 두루마리를 채울 책 (tsc → tbk, isc → ibk) 중 수량이 남은 첫 책. 출처: sub_6FC4B430 */
function tomeFor(h: TradeHost, scroll: string): ItemInstance | undefined {
  const book = scroll === 'tsc' ? 'tbk' : scroll === 'isc' ? 'ibk' : '';
  const max = h.data.items.base(book)?.maxStack ?? 0;
  return h.store.inv.items.map((p) => p.item).find((x) => x.code === book && x.quantity < max);
}

export interface HireCandidate { index: number; name: string; init: HirelingInit }

/**
 * 마을 NPC 상태: 상인 재고, 도박 목록, 고용 목록, NPC 시드.
 * 출처: D2NpcControlStrc — pSeed (NPC 굴림 전용), 상인 기록마다 재고(bVendorInit), 플레이어별 도박 인벤토리, 고용 목록(pMercData)
 */
/**
 * 레벨업 때 재고를 새로 채우는 상인 (npcTrade.bLevelRefresh).
 * 출처: SUNITPROXY_InitializeNpcControl — Gheed·Charsi·Fara·Hratli·Asheara·Halbu·Jamella·Malah (Akara·Lysander·Drognan·Alkor·Ormus·Elzix·Drehya·Larzuk·Nihlathak 는 0)
 */
export const LEVEL_REFRESH: readonly string[] = ['charsi', 'gheed', 'fara', 'hratli', 'asheara', 'halbu', 'jamella', 'malah'];

/** 막 마을 엔진 레벨 키 (data/world-level.ts LEVEL_KEYS: 1 Rogue Encampment, 40 Lut Gholein, 75 Kurast Docks, 103 Pandemonium Fortress, 109 Harrogath) */
export const ACT_TOWN_KEYS: readonly string[] = ['town', 'lutgholein', 'kurastdocks', 'pandemonium', 'harrogath'];

/** 퀘스트 기록 번호 (출처: D2MOO Quests.h QUESTSTATEFLAG_A2Q6 = 14 Duriel, QUESTSTATEFLAG_A3Q6 = 22 Mephisto, A2Q0 = 8, A3Q0 = 16) */
export const QUESTFLAG_A2Q0 = 8;
export const QUESTFLAG_A2Q4 = 12;
export const QUESTFLAG_A2Q6 = 14;
export const QUESTFLAG_A3Q0 = 16;
export const QUESTFLAG_A3Q6 = 22;

/** 막 이동 메뉴 → 도착 막 (0 부터). 출처: NPC_HandleDialogMessage — D2GAME_PlayerChangeAct(LEVEL_LUTGHOLEIN / ROGUEENCAMPMENT / KURASTDOCKTOWN) */
export const TRAVEL: Partial<Record<NpcOption, { npc: string; to: number }>> = {
  goEast: { npc: 'warriv1', to: 1 },
  goWest: { npc: 'warriv2', to: 0 },
  sailEast: { npc: 'meshif1', to: 2 },
  sailWest: { npc: 'meshif2', to: 1 },
  // 출처: NPC_HandleDialogMessage (TYRAEL2) — 확장팩 + A4Q2 REWARDGRANTED → D2GAME_PlayerChangeAct(LEVEL_HARROGATH)
  goHarrogath: { npc: 'tyrael2', to: 4 },
};

export class NpcServices {
  /** npc Id → 상점 재고 (원작 bVendorInit 인 동안 유지) */
  readonly stores = new Map<string, StoreItem[]>();
  /** 지금 열어 둔 도박 목록 (원작: 플레이어별 D2NpcGambleStrc) */
  gamble: StoreItem[] | null = null;
  /** npc Id → 고용 목록 */
  readonly hireLists = new Map<string, MercEntry[]>();
  /** 소개 대사를 이미 들음 (원작 퀘스트 기록의 NPC 소개 플래그 근사) */
  readonly introSeen = new Set<string>();
  readonly seed: Rng;

  /**
   * @param seed NPC 시드. 근사(원작 미확인): 원작 SEED_InitLowSeed(ITEMS_RollRandomNumber(pGameSeed)) 대신 게임 시드에서 고정 변환
   */
  constructor(seed: number) {
    this.seed = new Rng(seed >>> 0 || 1);
  }

  private storeCtx(h: TradeHost): StoreCtx {
    return { items: h.data.items, treasure: h.data.treasure, rng: this.seed, difficulty: h.difficulty, expansion: h.data.expansion ?? false };
  }

  priceCtx(h: TradeHost, npc: string): PriceCtx | null {
    const def = NPC_DEFS[npc];
    const row = def?.price ?? def?.vendor;
    const price = row ? h.data.npcPrices?.get(row) : undefined;
    if (!price) return null;
    return { items: h.data.items, gen: h.data.treasure.gen ?? null, npc: price, difficulty: h.difficulty, bookCharge: h.data.bookCharge, questDone: (f) => h.questDone(f), reducePct: h.reducePct ?? 0 };
  }

  /** 상점 재고 (없으면 채운다). 출처: D2GAME_STORES_CreateVendorCache_6FCCAE20 — bVendorInit 이 아니면 FillStoreInventory */
  storeOf(h: TradeHost, npc: string): StoreItem[] {
    let list = this.stores.get(npc);
    const def = NPC_DEFS[npc];
    if (!list && def?.vendor) {
      list = fillStore(this.storeCtx(h), def.vendor, def.act, h.playerLevel);
      this.stores.set(npc, list);
    }
    return list ?? [];
  }

  /** 도박 목록 열기 (연 동안 유지, 닫으면 버림 — 원작 SUNITPROXY_FreeNpcGamble). 출처: D2GAME_STORES_FillGamble_6FCCA9F0 */
  openGamble(h: TradeHost): StoreItem[] {
    const t = h.data.gamble;
    this.gamble = t ? fillGamble(this.storeCtx(h), t, h.data.difficultyRows?.[h.difficulty], h.playerLevel) : [];
    return this.gamble;
  }

  /** 레벨업 때 거래 중이라 미뤄 둔 재고 갱신 (거래 창을 닫으면 비운다) */
  private readonly pendingRefresh = new Set<string>();

  /**
   * 플레이어 레벨업 → 레벨 갱신 상인(bLevelRefresh)의 재고를 비워 다음 거래 때 새 레벨로 다시 채운다.
   * 출처: D2MOO PlayerStats.cpp PLAYERSTATS_LevelUp → SUNITPROXY_InitializeNpcEventChain (재고가 채워진 상인마다 이벤트),
   *       SUnitProxy.cpp SUNITPROXY_InitializeNpcControl — bLevelRefresh = 1 인 상인: Act 1 은 Charsi·Gheed (Akara 는 0)
   * 근사(원작 미확인): 이벤트를 처리하는 쪽(pEvent 소비 함수)은 D2MOO 에 복원돼 있지 않아 bLevelRefresh 상인만 비우고,
   *   지금 거래 창이 열려 있는 상인은 창을 닫을 때 비운다
   */
  levelUp(tradingNpc?: string): string[] {
    const out: string[] = [];
    for (const id of LEVEL_REFRESH) {
      if (!this.stores.has(id)) continue;
      if (id === tradingNpc) this.pendingRefresh.add(id);
      else this.stores.delete(id);
      out.push(id);
    }
    return out;
  }

  /** 거래를 마침: 미뤄 둔 레벨업 갱신 적용 */
  endTrade(npc: string): void {
    if (this.pendingRefresh.delete(npc)) this.stores.delete(npc);
  }

  /**
   * 마을을 떠나면(마을에 플레이어가 없으면) 상인 재고를 비운다 → 다음 거래 때 새로 채움.
   * 출처: SUNITPROXY_UpdateVendorInventory (bNoMorePlayersInLevel → SUNITPROXY_ClearNpcRecordData, bVendorInit = 0)
   */
  leaveTown(): void {
    this.stores.clear();
    this.gamble = null;
  }

  /** 가격 (UI 툴팁). kind buy = 상점·도박 아이템, sell/repair = 플레이어 아이템 */
  priceOf(h: TradeHost, npc: string, item: ItemInstance, kind: 'buy' | 'sell' | 'repair'): number {
    if (kind === 'buy' && this.gamble?.some((s) => s.item === item)) return gambleCost(h.data.items, item.code, h.playerLevel, h.reducePct ?? 0);
    const ctx = this.priceCtx(h, npc);
    return ctx ? transactionCost(item, kind, ctx) : 0;
  }

  /**
   * 사기. 출처: sub_6FCC88B0 —
   *   커서에 아이템이 있으면 실패, 가격 > 골드 + 창고 골드면 실패(12),
   *   멀티바이는 상시 품목만 (악몽 이상 hp4/hp5/mp4/mp5 제외), 두루마리는 같은 책에 (멀티바이면 골드와 책 빈 칸만큼),
   *   자동 벨트 물약은 벨트 먼저 (멀티바이면 벨트가 찰 때까지 반복), 아니면 인벤토리, 상시 품목이 아니면 상점에서 빠진다(sub_6FCC7E20)
   *   도박으로 산 아이템은 감정된다 (D2GAME_NPC_IdentifyBoughtItem)
   * 근사(원작 미확인): 화살통 자동 장착(sub_6FC4A9B0) 생략, 멀티바이는 misc.txt multibuy 가 있는 품목만,
   *   도박 칸은 산 뒤에도 남고 살 때마다 같은 종류·레벨로 새로 굴린 아이템을 받는다 (원작 복제·되돌림 세부 미확인)
   */
  buy(h: TradeHost, npc: string, itemId: number, opts: { multi?: boolean; toInventory?: boolean } = {}): boolean {
    const gambling = !!this.gamble?.some((s) => s.item.id === itemId);
    const list = gambling ? (this.gamble as StoreItem[]) : this.stores.get(npc);
    const si = list?.find((s) => s.item.id === itemId);
    const items = h.data.items;
    const b = si ? items.base(si.item.code) : undefined;
    if (!si || !b || !list) return false;
    if (h.store.cursor) {
      h.emit({ type: 'buyFailed', reason: 'cursor' });
      return false;
    }
    const cost = this.priceOf(h, npc, si.item, 'buy');
    const affordable = () => cost <= h.gold + h.stashGold;
    if (!affordable()) {
      h.emit({ type: 'buyFailed', reason: 'gold', cost });
      return false;
    }
    const perm = !gambling && b.permStore && !(h.difficulty !== 0 && ['hp4', 'hp5', 'mp4', 'mp5'].includes(b.code));
    let multi = !!opts.multi && perm && b.multibuy;
    // 두루마리 → 책
    if (!gambling && items.isType(b, 'scro')) {
      const tome = tomeFor(h, b.code);
      if (tome) {
        const max = items.base(tome.code)?.maxStack ?? 0;
        const room = max - tome.quantity;
        const count = multi ? Math.min(Math.trunc((h.gold + h.stashGold) / cost), room) : 1;
        if (count < 1 || !payGold(h, cost * count)) return false;
        tome.quantity += count;
        h.emit({ type: 'itemBought', itemId: tome.id, code: b.code, cost: cost * count, count });
        return true;
      }
    }
    // 출처: ITEMS_CheckIfAutoBeltable — 자동 벨트가 아니면 멀티바이 없음
    if (!b.autoBelt || opts.toInventory) multi = false;
    let bought = 0;
    for (;;) {
      if (bought && !multi) break;
      if (!affordable()) {
        if (!bought) h.emit({ type: 'buyFailed', reason: 'gold', cost });
        break;
      }
      let it: ItemInstance;
      if (gambling) {
        const fresh = rollGambleItem(this.storeCtx(h), si.item.code, si.item.ilvl, h.data.difficultyRows?.[h.difficulty]);
        if (!fresh) break;
        it = fresh;
        it.identified = true;
      } else it = duplicate(h, si.item);
      let placed = false;
      if (b.autoBelt && !opts.toInventory) placed = putInBelt(h, it);
      if (!placed) {
        multi = false;
        if (bought) break;
        placed = h.store.inv.autoAdd(it);
        if (!placed) {
          h.emit({ type: 'buyFailed', reason: 'room' });
          break;
        }
      }
      payGold(h, cost);
      bought++;
      h.emit({ type: 'itemBought', itemId: it.id, code: it.code, cost, gamble: gambling });
      if (!perm && !gambling) {
        list.splice(list.indexOf(si), 1);
        break;
      }
    }
    if (bought) h.itemsChanged();
    return bought > 0;
  }

  /**
   * 팔기. 출처: D2GAME_STORES_SellItem_6FCC7680 —
   *   퀘스트 아이템은 못 판다, 값 = TRANSACTIONTYPE_SELL, 되팔 수 없는 것: Cracked 하급·부서진·개인화·에테리얼·보석이 박힌·도박 중,
   *   되팔 수 있으면 상점 페이지(무기가 차면 2)에 감정·내구 최대·수량 최대로 복제 (상시 품목·악몽 이상 hp4/5 mp4/5 는 복제 안 함)
   * 근사(원작 미확인): ITEMS_HandleGoldTransaction 의 소지 한도 처리 — 레벨 × 10000 까지만 받는다
   */
  sell(h: TradeHost, npc: string, itemId: number): boolean {
    const f = h.store.find(itemId);
    const items = h.data.items;
    const b = f ? items.base(f.item.code) : undefined;
    if (!f || !b || f.where.kind === 'stash' || f.where.kind === 'cube' || f.where.kind === 'equip') return false;
    if (b.quest) {
      h.emit({ type: 'sellFailed', reason: 'quest' });
      return false;
    }
    const ctx = this.priceCtx(h, npc);
    if (!ctx) return false;
    const it = f.item;
    const price = transactionCost(it, 'sell', ctx);
    let resell = !this.gamble;
    if (it.quality === QUALITY.INFERIOR && h.data.treasure.gen?.lowQualityNames[it.lowQualityIdx ?? -1] === 'Cracked') resell = false;
    // 이더리얼은 되사기 목록에 오르지 않는다 (출처: D2MOO SUnitNpc.cpp)
    if (isBroken(it) || it.socketed.length > 0 || it.ethereal) resell = false;
    const perm = b.permStore && !!b.vendors[NPC_DEFS[npc]?.vendor ?? ''];
    if (h.difficulty !== 0 && ['hp4', 'hp5', 'mp4', 'mp5'].includes(b.code)) resell = false;
    if (resell && !perm) {
      const page = storePage(items, b);
      if (page >= 0) {
        const d = duplicate(h, it);
        d.identified = true;
        repairFull(items, d, b);
        if (b.stackable) d.quantity = Math.min(b.maxStack, 511);
        placeInStore(this.storeOf(h, npc), d, page);
      }
    }
    h.store.consume(itemId);
    h.gold = Math.min(h.gold + price, h.playerLevel * 10000);
    h.itemsChanged();
    h.emit({ type: 'itemSold', itemId, code: it.code, price });
    return true;
  }

  /**
   * 수리 (itemId 없으면 모두 수리). 출처: D2GAME_NPC_Repair_6FCC95B0 —
   *   Charsi 만, 모두 수리 = ITEMS_GetAllRepairCosts 합(골드 + 창고 골드가 모자라면 실패),
   *   한 개: 수리할 것이 없으면 실패, 모자라면 인벤토리 골드로 되는 만큼만 (divisor = (값 << 10) / 잃은 내구, 회복 = (골드 << 10) / divisor)
   * 근사(원작 미확인): 모두 수리 대상 = 장착 + 인벤토리 (원작 인벤토리 전체 순회 세부 미확인)
   */
  repair(h: TradeHost, npc: string, itemId?: number): boolean {
    if (!NPC_DEFS[npc]?.repair) return false;
    const ctx = this.priceCtx(h, npc);
    if (!ctx) return false;
    const items = h.data.items;
    const st = h.store;
    const fix = (it: ItemInstance) => {
      const b = items.base(it.code);
      if (b) repairFull(items, it, b);
    };
    if (itemId === undefined) {
      const all = [...st.inventoryItems, ...Object.values(st.equipment)].filter((x): x is ItemInstance => !!x && needsRepair(items, x));
      const total = all.reduce((a, it) => a + transactionCost(it, 'repair', ctx), 0);
      if (total > 0) {
        if (!payGold(h, total)) {
          h.emit({ type: 'repairFailed', reason: 'gold', cost: total });
          return false;
        }
        all.forEach(fix);
        h.itemsChanged();
      }
      h.emit({ type: 'repaired', cost: total, count: all.length });
      return true;
    }
    const f = st.find(itemId);
    if (!f || f.where.kind === 'stash') return false;
    const it = f.item;
    if (!isRepairable(items, it) || !needsRepair(items, it)) {
      h.emit({ type: 'repairFailed', reason: 'none' });
      return false;
    }
    const cost = transactionCost(it, 'repair', ctx);
    if (payGold(h, cost)) {
      fix(it);
      h.itemsChanged();
      h.emit({ type: 'repaired', cost, count: 1, itemId });
      return true;
    }
    if (it.durability < it.maxDurability) {
      const divisor = Math.trunc((cost * 1024) / (it.maxDurability - it.durability));
      const gold = h.gold;
      if (gold > 0 && divisor < gold * 1024 && divisor > 0 && !isBroken(it)) {
        const rep = Math.trunc((gold * 1024) / divisor);
        h.gold = 0;
        it.durability = Math.min(it.maxDurability, it.durability + rep);
        h.itemsChanged();
        h.emit({ type: 'repaired', cost: gold, count: 1, itemId, partial: true });
        return true;
      }
    }
    h.emit({ type: 'repairFailed', reason: 'gold', cost });
    return false;
  }

  /**
   * Cain 감정. 출처: D2GAME_NPC_IdentifyAllItems_6FCC9C90 — 미감정이 없으면 실패, A1Q4(Cain) 보상 전이면 개당 100 골드,
   *   인벤토리·장착 아이템 감정
   */
  identifyAll(h: TradeHost, free: boolean): number {
    const st = h.store;
    const list = [...st.inventoryItems, ...Object.values(st.equipment)].filter((x): x is ItemInstance => !!x && !x.identified);
    if (!list.length) {
      h.emit({ type: 'identifyFailed', reason: 'none' });
      return 0;
    }
    const cost = free ? 0 : 100 * list.length;
    if (!payGold(h, cost)) {
      h.emit({ type: 'identifyFailed', reason: 'gold', cost });
      return 0;
    }
    for (const it of list) it.identified = true;
    h.itemsChanged();
    h.emit({ type: 'identifiedAll', count: list.length, cost });
    return list.length;
  }

  /** 고용 목록 (없으면 만든다). 출처: D2GAME_NPC_BuildHirelingList_6FCC6FF0 → D2GAME_NPC_FirstFn (행 = Seller·Normal) */
  hireList(h: TradeHost, npc: string): MercEntry[] {
    let list = this.hireLists.get(npc);
    if (!list) {
      const db = h.data.hirelings, seller = h.data.monsters.types.get(npc)?.hcIdx;
      const row = db && seller !== undefined ? db.byVendor(seller, 0) : undefined;
      list = row ? buildHireList(row, this.seed) : [];
      this.hireLists.set(npc, list);
    }
    return list;
  }

  /** 목록에 보이는 후보 (가격·레벨: MONSTERS_HirelingInit) */
  candidates(h: TradeHost, npc: string): HireCandidate[] {
    const db = h.data.hirelings;
    if (!db) return [];
    const act = NPC_DEFS[npc]?.act ?? 0;
    const out: HireCandidate[] = [];
    this.hireList(h, npc).forEach((e, index) => {
      if (!e.available || e.hired) return;
      const init = hirelingInit(db, e.seed, h.playerLevel, act, h.difficulty);
      if (init) out.push({ index, name: e.name, init });
    });
    return out;
  }

  /**
   * 고용 가능 확인·지불. 출처: sub_6FCC7FA0 — Kashya 는 (보통 난이도 상한을 적용한) 플레이어 레벨 < 8 이고 A1Q2 보상 전이면 거절,
   *   이미 고용된 칸이면 거절, 가격 > 골드 + 창고면 거절, 지불 후 bHired, 목록이 다 고용되면 새 목록 (FirstFn)
   */
  hire(h: TradeHost, npc: string, index: number): { entry: MercEntry; init: HirelingInit } | null {
    const def = NPC_DEFS[npc];
    const db = h.data.hirelings;
    if (!def?.hire || !db) return null;
    let lvl = h.playerLevel;
    if (h.difficulty === 0) lvl = Math.min(lvl, NPC_LEVEL_CAP[def.act] ?? lvl);
    if (npc === 'kashya' && lvl < 8 && !h.questDone(QUEST_A1Q2)) {
      h.emit({ type: 'hireFailed', reason: 'locked' });
      return null;
    }
    // 출처: sub_6FCC7FA0 — QUAL_KEHK 는 QUESTRECORD_GetQuestState(…, QUEST_A5Q6_BAAL(36) = 기록 워드 A5Q2, REWARDGRANTED) 이 없으면 거절
    if (npc === 'qual-kehk' && !h.questDone(QUEST_A5Q2)) {
      h.emit({ type: 'hireFailed', reason: 'locked' });
      return null;
    }
    const list = this.hireList(h, npc);
    const entry = list[index];
    if (!entry || entry.hired || !entry.available) return null;
    const init = hirelingInit(db, entry.seed, h.playerLevel, def.act, h.difficulty);
    if (!init) return null;
    if (!payGold(h, init.gold)) {
      h.emit({ type: 'hireFailed', reason: 'gold', cost: init.gold });
      return null;
    }
    entry.hired = true;
    if (!list.some((e) => e.available && !e.hired)) this.hireLists.delete(npc);
    return { entry, init };
  }

  /**
   * A1Q2 보상: 목록의 첫 번째 고용 가능 용병을 공짜로. 출처: D2GAME_NPC_AssignMercenary_6FCCB520 —
   *   클래식은 이미 용병이 있으면 주지 않는다 (sub_6FC7E8B0(…, 7, 0)), 목록이 다 고용되면 새 목록 (FirstFn)
   */
  assignFree(h: TradeHost, npc: string, hasMerc: boolean): { entry: MercEntry; init: HirelingInit } | null {
    const db = h.data.hirelings;
    if (hasMerc || !db) return null;
    const list = this.hireList(h, npc);
    const entry = list.find((e) => !e.hired && e.available);
    if (!entry) return null;
    const init = hirelingInit(db, entry.seed, h.playerLevel, NPC_DEFS[npc]?.act ?? 0, h.difficulty);
    if (!init) return null;
    entry.hired = true;
    if (!list.some((e) => e.available && !e.hired)) this.hireLists.delete(npc);
    return { entry, init };
  }
}
