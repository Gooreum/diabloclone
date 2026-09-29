// 캐릭터가 가진 아이템: 인벤토리 격자 · 창고 · 벨트 · 장착 · 커서(손에 든 아이템).
// 원작 조작: 아이템을 집으면 커서에 붙고, 빈 곳에 놓거나 한 아이템과 겹치면 그 아이템과 바꿔 든다.
// 출처: The Arreat Summit — Inventory / Belt: 물약은 주우면 벨트에 자리가 있으면 벨트로, 벨트는 아래 줄부터 채움
import type { ItemLocation } from './command';
import { BODY_LOCS, Grid, INV_H, INV_W, STASH_H, STASH_W, beltBoxes, beltable, canEquip, type BodyLoc, type EquipContext, type EquipError, type Placed } from './inventory';
import type { ItemDb } from './items';
import type { ItemInstance } from './treasure';

export const BELT_SLOTS = 16;

export type Where =
  | { kind: 'inventory'; x: number; y: number }
  | { kind: 'stash'; x: number; y: number }
  | { kind: 'equip'; slot: BodyLoc }
  | { kind: 'belt'; slot: number }
  | { kind: 'cursor' };

export type MoveResult = { ok: true; swapped?: ItemInstance } | { ok: false; reason: EquipError | 'full' | 'occupied' | 'belt' | 'missing' };

export interface StoreInit {
  inventory?: Placed[];
  stash?: Placed[];
  belt?: (ItemInstance | null)[];
  equipment?: Partial<Record<string, ItemInstance>>;
}

export class ItemStore {
  readonly inv: Grid;
  readonly stash: Grid;
  readonly belt: (ItemInstance | null)[];
  readonly equipment: Partial<Record<BodyLoc, ItemInstance>>;
  cursor: ItemInstance | null = null;
  private readonly items: ItemDb | undefined;

  constructor(items: ItemDb | undefined, init: StoreInit = {}) {
    this.items = items;
    this.inv = new Grid(INV_W, INV_H, init.inventory ? [...init.inventory] : []);
    this.stash = new Grid(STASH_W, STASH_H, init.stash ? [...init.stash] : []);
    this.belt = Array.from({ length: BELT_SLOTS }, (_, i) => init.belt?.[i] ?? null);
    this.equipment = { ...(init.equipment as Partial<Record<BodyLoc, ItemInstance>>) };
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
    for (const [slot, it] of Object.entries(this.equipment)) if (it?.id === id) return { item: it, where: { kind: 'equip', slot: slot as BodyLoc } };
    const b = this.belt.findIndex((it) => it?.id === id);
    if (b >= 0) return { item: this.belt[b] as ItemInstance, where: { kind: 'belt', slot: b } };
    return null;
  }

  private detach(item: ItemInstance, where: Where): void {
    if (where.kind === 'cursor') this.cursor = null;
    else if (where.kind === 'inventory') this.inv.remove(item);
    else if (where.kind === 'stash') this.stash.remove(item);
    else if (where.kind === 'equip') delete this.equipment[where.slot];
    else this.belt[where.slot] = null;
  }

  private attach(item: ItemInstance, where: Where): void {
    if (where.kind === 'cursor') this.cursor = item;
    else if (where.kind === 'inventory') this.inv.items.push({ item, x: where.x, y: where.y });
    else if (where.kind === 'stash') this.stash.items.push({ item, x: where.x, y: where.y });
    else if (where.kind === 'equip') this.equipment[where.slot] = item;
    else this.belt[where.slot] = item;
  }

  /**
   * 아이템을 옮긴다. 대상 칸이 비었으면 놓고, 아이템 하나와 겹치면 그 아이템을 커서로 들어 올린다(교환).
   * 실패하면 원래 자리 그대로.
   */
  move(id: number, to: ItemLocation | { kind: 'stash'; x: number; y: number }, ctx?: Omit<EquipContext, 'items' | 'equipment'>): MoveResult {
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
      case 'stash': {
        const g = to.kind === 'inventory' ? this.inv : this.stash;
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
   * 주운 아이템 넣기: 벨트에 넣을 수 있는 물약·두루마리는 벨트 빈 칸(아래 줄 왼쪽부터) 먼저, 아니면 인벤토리 빈 자리.
   * 반환 false = 자리 없음
   */
  store(item: ItemInstance, preferBelt = true): boolean {
    if (preferBelt && this.items && beltable(this.items, item)) {
      const cap = this.beltCapacity();
      for (let i = 0; i < cap; i++) {
        if (!this.belt[i]) {
          this.belt[i] = item;
          return true;
        }
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
      ...this.inventoryItems, ...this.stash.items.map((p) => p.item), ...this.belt.filter((x): x is ItemInstance => !!x),
      ...Object.values(this.equipment).filter((x): x is ItemInstance => !!x), ...(this.cursor ? [this.cursor] : []),
    ];
  }
}
