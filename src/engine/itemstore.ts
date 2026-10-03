// 캐릭터가 가진 아이템: 인벤토리 격자 · 창고 · 벨트 · 장착 · 커서(손에 든 아이템).
// 원작 조작: 아이템을 집으면 커서에 붙고, 빈 곳에 놓거나 한 아이템과 겹치면 그 아이템과 바꿔 든다.
// 출처: The Arreat Summit — Inventory / Belt: 물약은 주우면 벨트에 자리가 있으면 벨트로, 벨트는 아래 줄부터 채움
// 호라드릭 큐브 칸: 원작은 큐브 안 아이템도 플레이어 인벤토리의 INVPAGE_CUBE 쪽 (PLRTRADE_CheckCubeInput 이 플레이어 인벤토리에서 page 로 고른다) —
//   큐브 아이템 자체가 아니라 캐릭터에 딸린 3×4 칸
import type { ItemLocation } from './command';
import { BODY_LOCS, CUBE_H, CUBE_W, Grid, INV_H, INV_W, STASH_H, STASH_W, beltBoxes, beltable, canEquip, type BodyLoc, type EquipContext, type EquipError, type Placed } from './inventory';
import type { ItemDb } from './items';
import type { ItemInstance } from './treasure';

export const BELT_SLOTS = 16;

/** 벨트 열을 같이 쓰는 "같은 종류" 물약 묶음. 출처: D2MOO ITEMS_ComparePotionTypes (생명 hp1~5 · 마나 mp1~5 · 회복 rvl·rvs) */
const POTION_KINDS: readonly (readonly string[])[] = [['hp1', 'hp2', 'hp3', 'hp4', 'hp5'], ['mp1', 'mp2', 'mp3', 'mp4', 'mp5'], ['rvl', 'rvs']];

/** 같은 코드, 또는 둘 다 생명·마나·회복 물약이면 같은 종류. 출처: ITEMS_ComparePotionTypes */
export function samePotionKind(a: ItemInstance, b: ItemInstance): boolean {
  if (a.code === b.code) return true;
  return POTION_KINDS.some((g) => g.includes(a.code) && g.includes(b.code));
}

/** 두루마리·책 코드 → 그 두루마리를 담는 책 코드 (tsc·tbk → tbk, isc·ibk → ibk) */
function bookFor(code: string): string {
  if (code === 'tsc' || code === 'tbk') return 'tbk';
  if (code === 'isc' || code === 'ibk') return 'ibk';
  return '';
}

export type Where =
  | { kind: 'inventory'; x: number; y: number }
  | { kind: 'stash'; x: number; y: number }
  | { kind: 'cube'; x: number; y: number }
  | { kind: 'equip'; slot: BodyLoc }
  | { kind: 'belt'; slot: number }
  | { kind: 'cursor' };

export type MoveResult = { ok: true; swapped?: ItemInstance } | { ok: false; reason: EquipError | 'full' | 'occupied' | 'belt' | 'missing' };

export interface StoreInit {
  inventory?: Placed[];
  stash?: Placed[];
  /** 호라드릭 큐브 칸 */
  cube?: Placed[];
  belt?: (ItemInstance | null)[];
  equipment?: Partial<Record<string, ItemInstance>>;
  /** 쉬는 무기 세트 (확장팩 무기 바꾸기) */
  altWeapons?: Partial<Record<WeaponSlot, ItemInstance>>;
  weaponSet?: 0 | 1;
}

/** 무기 바꾸기로 바뀌는 칸 */
export type WeaponSlot = 'rarm' | 'larm';
export const WEAPON_SLOTS: readonly WeaponSlot[] = ['rarm', 'larm'];

export class ItemStore {
  readonly inv: Grid;
  readonly stash: Grid;
  /** 호라드릭 큐브 칸 (3×4) */
  readonly cube: Grid;
  readonly belt: (ItemInstance | null)[];
  readonly equipment: Partial<Record<BodyLoc, ItemInstance>>;
  cursor: ItemInstance | null = null;
  /**
   * 무기 바꾸기 (원작 확장팩 W · 인벤토리 I/II 탭): 쉬는 세트. 쓰는 세트는 equipment.rarm/larm 그대로라
   * 능력치·그림·공격 코드는 바뀌지 않는다. 쉬는 세트는 능력치에 들어가지 않는다 (원작과 같다)
   */
  readonly altWeapons: Partial<Record<WeaponSlot, ItemInstance>>;
  /** 지금 쓰는 세트 (0 = I, 1 = II) */
  weaponSet: 0 | 1;
  private readonly items: ItemDb | undefined;

  constructor(items: ItemDb | undefined, init: StoreInit = {}) {
    this.items = items;
    this.inv = new Grid(INV_W, INV_H, init.inventory ? [...init.inventory] : []);
    this.stash = new Grid(STASH_W, STASH_H, init.stash ? [...init.stash] : []);
    this.cube = new Grid(CUBE_W, CUBE_H, init.cube ? [...init.cube] : []);
    this.belt = Array.from({ length: BELT_SLOTS }, (_, i) => init.belt?.[i] ?? null);
    this.equipment = { ...(init.equipment as Partial<Record<BodyLoc, ItemInstance>>) };
    this.altWeapons = { ...init.altWeapons };
    this.weaponSet = init.weaponSet === 1 ? 1 : 0;
  }

  /** 쓰는 무기 세트와 쉬는 세트를 맞바꾼다 */
  swapWeapons(): void {
    for (const s of WEAPON_SLOTS) {
      const on = this.equipment[s], off = this.altWeapons[s];
      if (off) this.equipment[s] = off;
      else delete this.equipment[s];
      if (on) this.altWeapons[s] = on;
      else delete this.altWeapons[s];
    }
    this.weaponSet = this.weaponSet ? 0 : 1;
  }

  /** 벨트 사용 가능 칸 수 (장착 벨트에 따라 4/8/12/16) */
  beltCapacity(): number {
    return this.items ? beltBoxes(this.items, this.equipment.belt) : 4;
  }

  /** 아이템 위치 찾기 */
  find(id: number): { item: ItemInstance; where: Where } | null {
    if (this.cursor?.id === id) return { item: this.cursor, where: { kind: 'cursor' } };
    for (const p of this.inv.items) if (p.item.id === id) return { item: p.item, where: { kind: 'inventory', x: p.x, y: p.y } };
    for (const p of this.stash.items) if (p.item.id === id) return { item: p.item, where: { kind: 'stash', x: p.x, y: p.y } };
    for (const p of this.cube.items) if (p.item.id === id) return { item: p.item, where: { kind: 'cube', x: p.x, y: p.y } };
    for (const [slot, it] of Object.entries(this.equipment)) if (it?.id === id) return { item: it, where: { kind: 'equip', slot: slot as BodyLoc } };
    const b = this.belt.findIndex((it) => it?.id === id);
    if (b >= 0) return { item: this.belt[b] as ItemInstance, where: { kind: 'belt', slot: b } };
    return null;
  }

  private detach(item: ItemInstance, where: Where): void {
    if (where.kind === 'cursor') this.cursor = null;
    else if (where.kind === 'inventory') this.inv.remove(item);
    else if (where.kind === 'stash') this.stash.remove(item);
    else if (where.kind === 'cube') this.cube.remove(item);
    else if (where.kind === 'equip') delete this.equipment[where.slot];
    else this.belt[where.slot] = null;
  }

  private attach(item: ItemInstance, where: Where): void {
    if (where.kind === 'cursor') this.cursor = item;
    else if (where.kind === 'inventory') this.inv.items.push({ item, x: where.x, y: where.y });
    else if (where.kind === 'stash') this.stash.items.push({ item, x: where.x, y: where.y });
    else if (where.kind === 'cube') this.cube.items.push({ item, x: where.x, y: where.y });
    else if (where.kind === 'equip') this.equipment[where.slot] = item;
    else this.belt[where.slot] = item;
  }

  /**
   * 아이템을 옮긴다. 대상 칸이 비었으면 놓고, 아이템 하나와 겹치면 그 아이템을 커서로 들어 올린다(교환).
   * 실패하면 원래 자리 그대로.
   */
  move(id: number, to: ItemLocation | { kind: 'stash' | 'cube'; x: number; y: number }, ctx?: Omit<EquipContext, 'items' | 'equipment'>): MoveResult {
    const found = this.find(id);
    if (!found) return { ok: false, reason: 'missing' };
    const { item, where } = found;
    this.detach(item, where);
    const fail = (reason: Exclude<MoveResult, { ok: true }>['reason']): MoveResult => {
      this.attach(item, where);
      return { ok: false, reason };
    };
    // 커서에 다른 아이템이 있으면(교환 결과가 갈 곳이 없으면) 집어 드는 것만 허용
    const cursorBusy = this.cursor !== null;
    switch (to.kind) {
      case 'cursor':
        if (cursorBusy) return fail('occupied');
        this.cursor = item;
        return { ok: true };
      case 'inventory':
      case 'stash':
      case 'cube': {
        // 원작: 큐브는 큐브 안에 넣을 수 없다 (클라이언트가 막는다)
        if (to.kind === 'cube' && item.code === 'box') return fail('slot');
        const g = to.kind === 'inventory' ? this.inv : to.kind === 'stash' ? this.stash : this.cube;
        const over = g.overlapping(item, to.x, to.y);
        const s = { w: item.invW, h: item.invH };
        if (to.x < 0 || to.y < 0 || to.x + s.w > g.w || to.y + s.h > g.h) return fail('full');
        if (over.length > 1 || (over.length === 1 && cursorBusy)) return fail('occupied');
        const swapped = over[0]?.item;
        if (swapped) {
          g.remove(swapped);
          this.cursor = swapped;
        }
        g.items.push({ item, x: to.x, y: to.y });
        return swapped ? { ok: true, swapped } : { ok: true };
      }
      case 'equip': {
        const slot = to.slot as BodyLoc;
        if (!(BODY_LOCS as readonly string[]).includes(slot)) return fail('slot');
        const cur = this.equipment[slot];
        if (cur && cursorBusy) return fail('occupied');
        if (this.items && ctx) {
          const eq = { ...this.equipment };
          delete eq[slot];
          const err = canEquip({ ...ctx, items: this.items, equipment: eq }, item, slot);
          if (err) return fail(err);
        }
        if (cur) this.cursor = cur;
        this.equipment[slot] = item;
        // 벨트를 바꿔 칸이 줄면 넘치는 물약은 인벤토리로 (자리가 없으면 커서로 — 근사)
        if (slot === 'belt') this.spillBelt();
        return cur ? { ok: true, swapped: cur } : { ok: true };
      }
      case 'belt': {
        if (!this.items || !beltable(this.items, item) || to.slot < 0 || to.slot >= this.beltCapacity()) return fail('belt');
        const cur = this.belt[to.slot];
        if (cur && cursorBusy) return fail('occupied');
        if (cur) this.cursor = cur;
        this.belt[to.slot] = item;
        return cur ? { ok: true, swapped: cur } : { ok: true };
      }
      case 'ground':
        // 땅에 떨어뜨리기는 Game 이 처리 (여기선 목록에서 빼기만)
        return { ok: true };
      case 'socket': {
        // 보석(소켓 아이템)을 빈 소켓이 있는 아이템에 영구히 박는다. 속성은 Game 이 대상 종류에 맞춰 넣는다
        const target = this.find(to.itemId);
        if (!target || target.item === item || !this.items) return fail('slot');
        const tb = this.items.base(target.item.code), gb = this.items.base(item.code);
        if (!tb || !gb || !this.items.isType(gb, 'sock') || target.item.socketed.length >= target.item.sockets) return fail('slot');
        target.item.socketed.push(item);
        return { ok: true };
      }
    }
  }

  private spillBelt(): void {
    const cap = this.beltCapacity();
    for (let i = cap; i < BELT_SLOTS; i++) {
      const it = this.belt[i];
      if (!it) continue;
      this.belt[i] = null;
      if (!this.inv.autoAdd(it) && !this.cursor) this.cursor = it;
    }
  }

  /**
   * 벨트 빈 칸 고르기. 출처: D2MOO INVENTORY_GetFreeBeltSlot —
   * 1×1 벨트용 아이템만. 아래 줄 4칸을 왼쪽부터 보며 그 칸 물약과 같은 종류면 그 열에서 위로 올라가며 첫 빈 칸.
   * 그런 열이 없거나 꽉 찼으면 items.txt autobelt 인 품목만 아래 줄 첫 빈 칸. 아니면 null
   */
  freeBeltSlot(item: ItemInstance): number | null {
    if (!this.items || !beltable(this.items, item) || item.invW !== 1 || item.invH !== 1) return null;
    const cap = this.beltCapacity();
    for (let col = 0; col < 4; col++) {
      const bottom = this.belt[col];
      if (!bottom || !samePotionKind(item, bottom)) continue;
      for (let s = col; s < cap; s += 4) if (!this.belt[s]) return s;
    }
    if (!this.items.base(item.code)?.autoBelt) return null;
    for (let s = 0; s < 4; s++) if (!this.belt[s]) return s;
    return null;
  }

  /**
   * 주울 때 벨트로 가는가. 출처: ITEMS_CheckIfAutoBeltable — autobelt 이거나,
   * (두루마리 isc·tsc 가 아니면서) 아래 줄에 같은 종류 물약이 있을 때 (INVENTORY_HasSimilarPotionInBelt)
   */
  autoBeltable(item: ItemInstance): boolean {
    if (!this.items) return false;
    if (this.items.base(item.code)?.autoBelt) return true;
    if (item.code === 'isc' || item.code === 'tsc') return false;
    return this.belt.slice(0, 4).some((b) => b && samePotionKind(item, b));
  }

  /** 두루마리(또는 책)를 채울 책 — 인벤토리 격자의 같은 종류 책 중 수량이 남은 첫 책. 출처: INVENTORY_FindFillableBook */
  fillableBook(code: string): ItemInstance | null {
    const book = bookFor(code);
    const max = book ? (this.items?.base(book)?.maxStack ?? 0) : 0;
    return this.inv.items.map((p) => p.item).find((x) => x.code === book && x.quantity < max) ?? null;
  }

  /**
   * src 를 dst 위에 놓으면 합쳐지는 종류인가 (수량은 보지 않는다).
   * 두루마리 → 같은 종류 책, 또는 같은 코드·같은 등급·소켓 없음·이더리얼 같음인 묶음 아이템.
   * 출처: ITEMS_AreStackablesEqual, sub_6FC49AE0 (ScrollToBook)
   */
  stackable(src: ItemInstance, dst: ItemInstance): boolean {
    if (src === dst || !this.items) return false;
    if ((src.code === 'tsc' || src.code === 'isc') && dst.code === bookFor(src.code)) return true;
    const db = this.items.base(dst.code);
    if (!db?.stackable || src.code !== dst.code || src.quality !== dst.quality) return false;
    if (src.sockets || dst.sockets || !!src.ethereal !== !!dst.ethereal) return false;
    return true;
  }

  /**
   * src(커서 등)를 dst 묶음·책에 합친다. 반환: 옮긴 수량 (0 = 못 합침).
   * 두루마리 → 책: 책 +1, 두루마리 삭제 (sub_6FC49AE0). 책이 꽉 찼으면 아무 일도 없음.
   * 같은 묶음: 합이 maxstack 이하면 dst = 합·src 삭제, 넘치면 dst = maxstack·src 는 나머지 (sub_6FC484E0)
   */
  stackInto(srcId: number, dstId: number): number {
    const src = this.find(srcId), dst = this.find(dstId);
    if (!src || !dst || dst.where.kind === 'cursor' || !this.stackable(src.item, dst.item) || !this.items) return 0;
    const s = src.item, d = dst.item;
    const max = this.items.base(d.code)?.maxStack ?? 0;
    if (s.code !== d.code) {
      if (d.quantity >= max) return 0;
      d.quantity++;
      this.detach(s, src.where);
      return 1;
    }
    const total = s.quantity + d.quantity;
    if (total <= max) {
      const moved = s.quantity;
      d.quantity = total;
      this.detach(s, src.where);
      return moved;
    }
    const moved = max - d.quantity;
    if (moved <= 0) return 0;
    d.quantity = max;
    s.quantity = total - max;
    return moved;
  }

  /**
   * 주운 아이템 넣기: 원작 자동 벨트 조건(autoBeltable)이 맞으면 벨트 칸 규칙(freeBeltSlot)대로, 아니면 인벤토리 빈 자리.
   * 출처: D2MOO ItemMode.cpp 줍기 — ITEMS_CheckIfBeltable && ITEMS_CheckIfAutoBeltable && INVENTORY_PlaceItemInFreeBeltSlot
   * 반환 false = 자리 없음
   */
  store(item: ItemInstance, preferBelt = true): boolean {
    if (preferBelt && this.autoBeltable(item)) {
      const s = this.freeBeltSlot(item);
      if (s !== null) {
        this.belt[s] = item;
        return true;
      }
    }
    return this.inv.autoAdd(item);
  }

  /**
   * 벨트 칸의 아이템을 쓰면 같은 열 위 칸들이 한 칸씩 내려온다.
   * 출처: The Arreat Summit — Belt: 열마다 아래 칸부터 사용, 위 칸이 내려와 채움 (4열 × 최대 4줄)
   */
  takeFromBelt(slot: number): ItemInstance | null {
    const it = this.belt[slot];
    if (!it) return null;
    this.belt[slot] = null;
    const col = slot % 4;
    for (let row = Math.floor(slot / 4); row < 3; row++) {
      const above = this.belt[(row + 1) * 4 + col] ?? null;
      this.belt[row * 4 + col] = above;
      this.belt[(row + 1) * 4 + col] = null;
    }
    return it;
  }

  /** 소모(물약 마시기 등)로 아이템 제거 */
  consume(id: number): ItemInstance | null {
    const f = this.find(id);
    if (!f) return null;
    if (f.where.kind === 'belt') return this.takeFromBelt(f.where.slot);
    this.detach(f.item, f.where);
    return f.item;
  }

  /** 인벤토리 아이템 목록 (예전 API 호환) */
  get inventoryItems(): ItemInstance[] {
    return this.inv.items.map((p) => p.item);
  }

  allItems(): ItemInstance[] {
    return [
      ...this.inventoryItems, ...this.stash.items.map((p) => p.item), ...this.cube.items.map((p) => p.item), ...this.belt.filter((x): x is ItemInstance => !!x),
      ...Object.values(this.equipment).filter((x): x is ItemInstance => !!x), ...(this.cursor ? [this.cursor] : []),
    ];
  }
}
