// 상인 판매 목록과 도박 목록 생성.
// 출처: D2MOO D2Game/src/UNIT/SUnitNpc.cpp — D2GAME_NPC_FillStoreInventory_6FCC7100, D2GAME_NPC_GenerateStoreItem_6FCC6A60,
//       D2GAME_STORES_FillGamble_6FCCA9F0, D2GAME_NPC_RepairItem_6FCC6970
// 출처: D2MOO D2Game/src/UNIT/SUnitProxy.cpp — SUNITPROXY_FillIGlobaltemCacheRecordForNpc (상인별 품목 캐시)
// 출처: D2MOO D2Common/src/DataTbls/ItemsTbls.cpp — DATATBLS_LoadGambleTxt (도박 선택 한도)
// (https://github.com/ThePhrozenKeep/D2MOO)
import type { TxtRow } from '../formats/txt';
import type { ItemBase, ItemDb } from './items';
import { QUALITY, type ItemInstance, type Quality, type TreasureDb } from './treasure';
import { Rng } from './rng';

/** storepage.txt 순서: 0 방어구, 1 무기, 2 마법, 3 잡화 */
export const STORE_PAGES = ['armo', 'weap', 'mag', 'misc'] as const;
/** 상인 인벤토리 격자 (inventory.txt Monster 행 gridX × gridY) */
export const STORE_GRID_W = 10;
export const STORE_GRID_H = 10;

export interface StoreItem { item: ItemInstance; page: number; x: number; y: number }

/** 출처: FillStoreInventory — 보통 난이도 상점 아이템 레벨 상한 (액트별) */
const NORMAL_ILVL_CAP = [12, 20, 28, 36, 45];

/** 상점 한 페이지 격자에 첫 빈자리로 배치. 근사(원작 미확인): D2GAME_PlaceItem 의 탐색 순서는 위→아래, 왼→오른쪽으로 가정 */
class StoreGrid {
  private readonly used = new Map<number, boolean[]>();
  private cells(page: number): boolean[] {
    let cells = this.used.get(page);
    if (!cells) this.used.set(page, (cells = new Array<boolean>(STORE_GRID_W * STORE_GRID_H).fill(false)));
    return cells;
  }
  mark(page: number, x: number, y: number, w: number, h: number): void {
    const cells = this.cells(page);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (x + dx < STORE_GRID_W && y + dy < STORE_GRID_H) cells[(y + dy) * STORE_GRID_W + x + dx] = true;
  }
  place(page: number, w: number, h: number): { x: number; y: number } | null {
    const cells = this.cells(page);
    for (let y = 0; y + h <= STORE_GRID_H; y++) {
      for (let x = 0; x + w <= STORE_GRID_W; x++) {
        let free = true;
        for (let dy = 0; dy < h && free; dy++) for (let dx = 0; dx < w && free; dx++) if (cells[(y + dy) * STORE_GRID_W + x + dx]) free = false;
        if (!free) continue;
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells[(y + dy) * STORE_GRID_W + x + dx] = true;
        return { x, y };
      }
    }
    return null;
  }
}

/**
 * 이미 있는 상점 목록에 아이템 하나를 첫 빈자리로 넣는다 (팔린 아이템 되사기 — 원작 D2GAME_STORES_SellItem 의 D2GAME_PlaceItem).
 * 무기 페이지(1)가 차면 페이지 2. 자리가 없으면 null
 */
export function placeInStore(list: StoreItem[], item: ItemInstance, page: number): StoreItem | null {
  const grid = new StoreGrid();
  for (const s of list) grid.mark(s.page, s.x, s.y, s.item.invW, s.item.invH);
  let pos = grid.place(page, item.invW, item.invH);
  let final = page;
  if (!pos && page === 1) {
    final = 2;
    pos = grid.place(2, item.invW, item.invH);
  }
  if (!pos) return null;
  const s = { item, page: final, x: pos.x, y: pos.y };
  list.push(s);
  return s;
}

/** 출처: ITEMS_GetStorePage — 첫 번째 타입의 itemtypes StorePage (없으면 0xFF = 팔지 않음) */
export function storePage(items: ItemDb, base: ItemBase): number {
  const code = items.types.get(base.type)?.storePage ?? '';
  return STORE_PAGES.indexOf(code as (typeof STORE_PAGES)[number]);
}

/** 출처: D2GAME_NPC_RepairItem — 투척 스택은 최대 수량, 내구도는 최대 */
export function repairFull(items: ItemDb, it: ItemInstance, base: ItemBase): void {
  const type = items.types.get(base.type);
  if (type?.throwable && base.stackable) it.quantity = base.maxStack;
  if (it.maxDurability > 0) it.durability = it.maxDurability;
}

export interface StoreCtx {
  items: ItemDb;
  treasure: TreasureDb;
  rng: Rng;
  /** 0 보통 1 악몽 2 지옥 */
  difficulty: number;
}

/** 출처: D2GAME_NPC_GenerateStoreItem — 난이도 업그레이드 → 생성(“Cracked” 하급은 5회까지 재시도) → 상점 페이지 배치 → 감정 */
function generateStoreItem(ctx: StoreCtx, grid: StoreGrid, out: StoreItem[], code: string, quality: Quality, ilvl: number, plvl: number): ItemInstance | null {
  let base = ctx.items.base(code);
  if (!base) return null;
  if (ctx.difficulty !== 0 && plvl > 25) {
    const roll = Number(ctx.rng.next() & 0xffffffffn) % 100000;
    const has = (c: string) => !!c && c.trim() !== '' && ctx.items.base(c);
    if (ctx.difficulty === 1) {
      if (roll < (ilvl << 6) + 4000 && has(base.uberCode)) base = ctx.items.base(base.uberCode)!;
      else if (base.nightmareUpgrade !== 'xxx' && has(base.nightmareUpgrade)) base = ctx.items.base(base.nightmareUpgrade)!;
    } else {
      // 클래식: 확장팩 전용 ultracode 분기는 건너뜀
      const orig = base;
      if (roll < (ilvl << 7) + 5000 && has(orig.uberCode)) base = ctx.items.base(orig.uberCode)!;
      if (orig.hellUpgrade !== 'xxx' && has(orig.hellUpgrade)) base = ctx.items.base(orig.hellUpgrade)!;
    }
  }
  let item: ItemInstance | null = null;
  for (let j = 0; j < 5 && !item; j++) {
    const it = ctx.treasure.createItem(base, ilvl, ctx.rng, quality, true);
    const cracked = it.quality === QUALITY.INFERIOR && ctx.treasure.gen?.lowQualityNames[it.lowQualityIdx ?? -1] === 'Cracked';
    if (!cracked) item = it;
  }
  if (!item) return null;
  const page = storePage(ctx.items, base);
  if (page < 0) return null;
  repairFull(ctx.items, item, base);
  let pos = grid.place(page, item.invW, item.invH);
  let finalPage = page;
  // 무기 페이지가 차면 두 번째 무기 페이지(2)로 넘어감
  if (!pos && page === 1) {
    finalPage = 2;
    pos = grid.place(2, item.invW, item.invH);
  }
  if (!pos) return null;
  item.identified = true;
  out.push({ item, page: finalPage, x: pos.x, y: pos.y });
  return item;
}

/**
 * 상인 판매 목록 생성.
 * 출처: D2GAME_NPC_FillStoreInventory_6FCC7100 / SUNITPROXY_FillIGlobaltemCacheRecordForNpc
 * @param vendor weapons/armor/misc.txt 상인 컬럼 이름 소문자 (charsi, akara, gheed …)
 * @param act 상인의 액트 (0 = Act 1)
 */
export function fillStore(ctx: StoreCtx, vendor: string, act: number, playerLevel: number): StoreItem[] {
  const placed: StoreItem[] = [];
  const grid = new StoreGrid();
  let ilvl = playerLevel + 5;
  const cap = NORMAL_ILVL_CAP[act];
  if (ctx.difficulty === 0 && cap !== undefined && ilvl > cap) ilvl = cap;

  const cache: ItemBase[] = [];
  const perms: ItemBase[] = [];
  for (const b of ctx.items.bases.values()) {
    // 클래식: 확장팩 전용(version ≥ 100) 은 제외 (출처: FillStoreInventory — wVersion < 100 || wItemFormat >= 100)
    if (!b.spawnable || !b.vendors[vendor] || b.version >= 100) continue;
    (b.permStore ? perms : cache).push(b);
  }

  let failed = 0;
  for (const b of cache) {
    if (b.level > ilvl) continue;
    const v = b.vendors[vendor]!;
    const normalCount = ilvl < 25 ? v.min + ctx.rng.pick(v.max - v.min + 1) : 0;
    for (let j = 0; j < normalCount; j++) {
      const q = ctx.rng.pick(100);
      let quality: Quality = QUALITY.NORMAL;
      if (ilvl >= 10) {
        if (q >= 75) quality = QUALITY.SUPERIOR;
      } else if (ilvl >= 5) {
        if (q > 85) quality = QUALITY.SUPERIOR;
      } else if (q > 90) quality = QUALITY.INFERIOR;
      if (!generateStoreItem(ctx, grid, placed, b.code, quality, ilvl, playerLevel)) failed++;
      if (failed > 32) return placed;
    }
    if ((b.bitfield1 & 1) === 1 && v.magicLvl <= ilvl) {
      const minItems = ilvl >= 25 ? (Number(ctx.rng.next() & 1n) + 2) : 1;
      const magicCount = v.magicMin + ctx.rng.pick(minItems + v.magicMax - v.magicMin);
      for (let j = 0; j < magicCount; j++) if (!generateStoreItem(ctx, grid, placed, b.code, QUALITY.MAGIC, ilvl, playerLevel)) failed++;
    }
  }
  for (const b of perms) {
    const it = generateStoreItem(ctx, grid, placed, b.code, QUALITY.NORMAL, ilvl, playerLevel);
    if (it) {
      // 출처: FillStoreInventory — 화살·볼트통은 최대 수량으로
      if (b.code === 'cqv' || b.code === 'aqv') it.quantity = b.maxStack;
    } else failed++;
    if (failed > 32) break;
  }
  return placed;
}

/** 도박 선택표: gamble.txt 코드를 아이템 레벨 오름차순 정렬 + 레벨별 선택 한도 (출처: DATATBLS_LoadGambleTxt) */
export interface GambleTable { selection: string[]; chooseLimit: number[] }

export function parseGamble(items: ItemDb, rows: TxtRow[]): GambleTable {
  const recs = rows
    .map((r) => r.code ?? '')
    .filter((c) => items.base(c))
    .map((c) => ({ code: c, level: items.base(c)!.level }));
  // qsort 는 안정 정렬이 아님 — 같은 레벨 순서는 근사(원작 미확인): 원래 순서 유지
  recs.sort((a, b) => a.level - b.level);
  const chooseLimit = new Array<number>(100).fill(recs.length);
  chooseLimit[0] = 2;
  for (let i = 1; i < 100; i++) {
    let c = 0;
    while (c < recs.length && i >= recs[c]!.level) c++;
    if (c < recs.length) chooseLimit[i] = c;
  }
  return { selection: recs.map((r) => r.code), chooseLimit };
}

/**
 * 도박 목록 14개 (첫 2개는 반지·목걸이, 미감정).
 * 출처: D2GAME_STORES_FillGamble_6FCCA9F0 — 품질: rand%100000 < GambleUnique → 유니크, < +GambleSet → 세트, < +GambleRare → 레어, 그 외 매직
 */
export function fillGamble(ctx: StoreCtx, table: GambleTable, difficultyRow: TxtRow | undefined, playerLevel: number): StoreItem[] {
  const placed: StoreItem[] = [];
  const grid = new StoreGrid();
  let counter = 0;
  do {
    let ilvl = playerLevel + (Number(ctx.rng.next() & 0xffffffffn) % 10) - 5;
    ilvl = Math.max(5, Math.min(99, ilvl));
    let code = table.selection[ctx.rng.pick(table.chooseLimit[ilvl] ?? table.selection.length)] ?? '';
    const base = ctx.items.base(code);
    if (!base) return placed;
    if (base.version >= 100) continue;
    if (counter < 2) code = counter ? 'amu' : 'rin';
    counter++;
    const it = rollGambleItem(ctx, code, ilvl, difficultyRow);
    if (!it) return placed;
    // 도박 인벤토리는 페이지 0 하나
    const pos = grid.place(0, it.invW, it.invH);
    if (!pos) return placed;
    placed.push({ item: it, page: 0, x: pos.x, y: pos.y });
  } while (counter < 14);
  return placed;
}

/**
 * 도박 아이템 하나: 품질 굴림(rand%100000 < GambleUnique → 유니크, < +GambleSet → 세트, < +GambleRare → 레어, 그 외 매직) → 생성 → 수리 → 미감정.
 * 출처: D2GAME_STORES_FillGamble_6FCCA9F0 (한 칸 분량)
 */
export function rollGambleItem(ctx: StoreCtx, code: string, ilvl: number, difficultyRow: TxtRow | undefined): ItemInstance | null {
  const b = ctx.items.base(code);
  if (!b) return null;
  const uniq = Number(difficultyRow?.GambleUnique ?? 0) || 0;
  const set = Number(difficultyRow?.GambleSet ?? 0) || 0;
  const rare = Number(difficultyRow?.GambleRare ?? 0) || 0;
  const hq = uniq + set + rare;
  let quality: Quality = QUALITY.MAGIC;
  if (hq > 0) {
    const q = Number(ctx.rng.next() & 0xffffffffn) % 100000;
    if (q < hq) quality = q >= uniq ? (q >= uniq + set ? QUALITY.RARE : QUALITY.SET) : QUALITY.UNIQUE;
  }
  const it = ctx.treasure.createItem(b, ilvl, ctx.rng, quality, true);
  repairFull(ctx.items, it, b);
  it.identified = false;
  return it;
}
