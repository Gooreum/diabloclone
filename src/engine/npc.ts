// 마을 NPC 기능: 메뉴, 상점(사기·팔기·수리·모두 수리), 도박, 감정, 용병 목록.
// 출처: D2MOO D2Game/src/UNIT/SUnitNpc.cpp — NPC_HandleDialogMessage (1 상점: Gheed Akara Charsi, 2 도박: Gheed),
//       sub_6FCC88B0 (사기 — 멀티바이·벨트·책 채우기), D2GAME_STORES_SellItem_6FCC7680 (팔기·되사기), D2GAME_NPC_Repair_6FCC95B0 (수리),
//       D2GAME_NPC_IdentifyAllItems_6FCC9C90 (Cain 감정), D2GAME_NPC_IdentifyBoughtItem_6FCCA990 (도박 감정),
//       sub_6FCC7FA0 (고용), D2GAME_NPC_BuildHirelingList_6FCC6FF0
// 출처: D2MOO D2Game/src/UNIT/SUnitProxy.cpp — SUNITPROXY_InitializeNpcControl (NPC 표: 막·상인 여부), SUNITPROXY_UpdateVendorInventory (재고 초기화)
// (https://github.com/ThePhrozenKeep/D2MOO)
import type { GameData, GameEvent } from './game';
import type { ItemStore } from './itemstore';
import type { ItemInstance } from './treasure';
import { QUALITY } from './treasure';
import { Rng } from './rng';
import { fillGamble, fillStore, placeInStore, repairFull, rollGambleItem, storePage, type StoreCtx, type StoreItem } from './shop';
import { gambleCost, isBroken, isRepairable, needsRepair, transactionCost, type PriceCtx } from './price';
import { buildHireList, hirelingInit, type HirelingInit, type MercEntry } from './hireling';

/** NPC 메뉴 항목 */
export type NpcOption = 'talk' | 'trade' | 'tradeRepair' | 'gamble' | 'hire' | 'resurrect' | 'identify' | 'cancel' | 'imbue' | 'goEast' | QuestTopic;
/** 메뉴의 퀘스트 항목: quest:<퀘스트 번호>:<원작 문자열 번호> (원작 QUESTS_InitScrollTextChain nMenu 2 대사) */
export type QuestTopic = `quest:${number}:${number}`;

export interface NpcDef {
  /** 원작 메뉴 (위에서 아래) */
  menu: NpcOption[];
  /** npc.txt 행 · weapons/armor/misc.txt 상인 컬럼 (소문자) */
  vendor?: string;
  /** 막 (0 = Act 1) */
  act: number;
  repair?: boolean;
  gamble?: boolean;
  /** 말을 걸면 치료 (D2GAME_NPC_Heal) */
  heal?: boolean;
  hire?: boolean;
  identify?: boolean;
  /** string.tbl 대사 키 접두사 (AkaraGossip1 …) */
  gossip: string;
}

/**
 * Act 1 NPC (monstats Id).
 * 출처: SUNITPROXY_InitializeNpcControl (AKARA·CHARSI·GHEED 상인), NPC_HandleDialogMessage (상점·도박), D2GAME_NPC_Repair (CHARSI),
 *       D2GAME_NPC_Heal (AKARA), D2GAME_NPC_ResurrectMerc / BuildHirelingList (KASHYA), D2GAME_NPC_IdentifyAllItems (CAIN2~6 — Act 1 마을은 CAIN5)
 * 근사(원작 미확인): 메뉴 순서·문구 선택은 D2Client 메뉴 표 대신 위 서버 함수가 받는 요청 종류로 구성
 */
export const NPC_DEFS: Record<string, NpcDef> = {
  akara: { menu: ['talk', 'trade', 'cancel'], vendor: 'akara', act: 0, heal: true, gossip: 'Akara' },
  charsi: { menu: ['talk', 'tradeRepair', 'cancel'], vendor: 'charsi', act: 0, repair: true, gossip: 'Charsi' },
  gheed: { menu: ['talk', 'trade', 'gamble', 'cancel'], vendor: 'gheed', act: 0, gamble: true, gossip: 'Gheed' },
  kashya: { menu: ['talk', 'hire', 'cancel'], act: 0, hire: true, gossip: 'Kashya' },
  warriv1: { menu: ['talk', 'cancel'], act: 0, gossip: 'Warriv' },
  cain5: { menu: ['talk', 'identify', 'cancel'], act: 0, identify: true, gossip: 'Cain' },
  navi: { menu: ['talk', 'cancel'], act: 0, gossip: 'Navi' },
  // 트리스트럼 감옥에서 구한 Cain (MONSTER_CAIN1): 말만 건다
  cain1: { menu: ['talk', 'cancel'], act: 0, gossip: 'Cain' },
};

/**
 * 메뉴 문자열 키 (string.tbl). 부활은 원작 표에 없음 → '' (UI 가 근사 문구).
 * imbue = Upgrade "imbue" (Charsi), goEast = WarrivMenu1b "go east", 퀘스트 항목은 퀘스트 이름 qstsa1q<번호>
 */
export const NPC_MENU_STRING: Record<Exclude<NpcOption, QuestTopic>, string> = {
  talk: 'TalkMenu', trade: 'NPCMenuTrade', tradeRepair: 'NPCMenuTradeRepair', gamble: 'gamble', hire: 'NPCMenuHire', resurrect: '', identify: 'NPCIdentify1', cancel: 'lowercasecancel',
  imbue: 'Upgrade', goEast: 'WarrivMenu1b',
};

/** 메뉴 항목의 string.tbl 키 */
export function npcMenuKey(o: NpcOption): string {
  if (o.startsWith('quest:')) return `qstsa1q${o.split(':')[1]}`;
  return NPC_MENU_STRING[o as Exclude<NpcOption, QuestTopic>] ?? '';
}

/** 보통 난이도 상점 아이템 레벨 상한 (액트별). 출처: FillStoreInventory / sub_6FCC7FA0 npcLevels */
export const NPC_LEVEL_CAP = [12, 20, 28, 36, 45];

/** 퀘스트 플래그 (A1Q2 Blood Raven 보상 — Kashya 고용 허용) */
export const QUEST_A1Q2 = 'a1q2';

/** 상점 기능이 게임에 요청하는 것 */
export interface TradeHost {
  readonly data: GameData;
  readonly store: ItemStore;
  gold: number;
  stashGold: number;
  readonly playerLevel: number;
  readonly difficulty: 0 | 1 | 2;
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
/** 레벨업 때 재고를 새로 채우는 상인 (npcTrade.bLevelRefresh). 출처: SUNITPROXY_InitializeNpcControl — Act 1 은 Gheed·Charsi */
export const LEVEL_REFRESH: readonly string[] = ['charsi', 'gheed'];

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
    return { items: h.data.items, treasure: h.data.treasure, rng: this.seed, difficulty: h.difficulty };
  }

  priceCtx(h: TradeHost, npc: string): PriceCtx | null {
    const def = NPC_DEFS[npc];
    const price = def?.vendor ? h.data.npcPrices?.get(def.vendor) : undefined;
    if (!price) return null;
    return { items: h.data.items, gen: h.data.treasure.gen ?? null, npc: price, difficulty: h.difficulty, bookCharge: h.data.bookCharge, questDone: (f) => h.questDone(f) };
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
    if (kind === 'buy' && this.gamble?.some((s) => s.item === item)) return gambleCost(h.data.items, item.code, h.playerLevel);
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
    if (!f || !b || f.where.kind === 'stash' || f.where.kind === 'equip') return false;
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
    if (isBroken(it) || it.socketed.length > 0) resell = false;
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
