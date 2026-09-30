// 인벤토리 격자·장착·벨트 규칙 (순수 로직).
// 출처: 원작 inventory.txt — 캐릭터 인벤토리 gridX 10 × gridY 4, 창고(Bank Page 1) 6 × 4
//       belts.txt — 벨트 칸 수 (default 4, sash/light belt 8, belt/heavy belt 12, girdle 16), armor.txt belt 컬럼 = belts.txt 행
//       itemtypes.txt — Body / BodyLoc1·BodyLoc2 (장착 위치), Beltable (벨트에 넣을 수 있음)
//       weapons.txt 2handed / 1or2handed (바바리안은 1or2handed 무기를 한 손으로)
// 출처: The Arreat Summit — Items: 요구 능력치(힘·민첩·레벨)를 채워야 장착, 바바리안만 양손에 무기 두 개
import type { ItemBase, ItemDb } from './items';
import type { ItemInstance } from './treasure';
import type { ClassName } from './player';
import { statOf } from './itemgen';

export const BODY_LOCS = ['head', 'neck', 'tors', 'rarm', 'larm', 'rrin', 'lrin', 'belt', 'feet', 'glov'] as const;
export type BodyLoc = (typeof BODY_LOCS)[number];

export const INV_W = 10, INV_H = 4;
export const STASH_W = 6, STASH_H = 4;
/** 호라드릭 큐브 격자 (출처: inventory.txt "Transmogrify Box Page 1" gridX 3 × gridY 4) */
export const CUBE_W = 3, CUBE_H = 4;
/** belts.txt numboxes (행 순서 = armor.txt belt 값) */
export const BELT_BOXES = [12, 8, 4, 16, 8, 12, 16];
const DEFAULT_BELT = 2;

export interface Placed { item: ItemInstance; x: number; y: number }

/** 격자 (인벤토리·창고) */
export class Grid {
  readonly w: number;
  readonly h: number;
  readonly items: Placed[];

  constructor(w: number, h: number, items: Placed[] = []) {
    this.w = w;
    this.h = h;
    this.items = items;
  }

  private occupied(ignore?: ItemInstance): Uint8Array {
    const occ = new Uint8Array(this.w * this.h);
    for (const p of this.items) {
      if (p.item === ignore) continue;
      const s = sizeOf(p.item);
      for (let y = p.y; y < p.y + s.h; y++) for (let x = p.x; x < p.x + s.w; x++) occ[y * this.w + x] = 1;
    }
    return occ;
  }

  fits(item: ItemInstance, x: number, y: number, ignore?: ItemInstance): boolean {
    const s = sizeOf(item);
    if (x < 0 || y < 0 || x + s.w > this.w || y + s.h > this.h) return false;
    const occ = this.occupied(ignore);
    for (let yy = y; yy < y + s.h; yy++) for (let xx = x; xx < x + s.w; xx++) if (occ[yy * this.w + xx]) return false;
    return true;
  }

  /** 원작처럼 위에서 아래, 왼쪽에서 오른쪽 (열 우선) 으로 첫 빈 자리 */
  findSpace(item: ItemInstance): { x: number; y: number } | null {
    for (let x = 0; x < this.w; x++) for (let y = 0; y < this.h; y++) if (this.fits(item, x, y)) return { x, y };
    return null;
  }

  add(item: ItemInstance, x: number, y: number): boolean {
    if (!this.fits(item, x, y)) return false;
    this.items.push({ item, x, y });
    return true;
  }

  autoAdd(item: ItemInstance): boolean {
    const s = this.findSpace(item);
    return !!s && this.add(item, s.x, s.y);
  }

  remove(item: ItemInstance): boolean {
    const i = this.items.findIndex((p) => p.item === item);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  /** (x, y) 칸을 덮는 아이템 */
  at(x: number, y: number): Placed | undefined {
    return this.items.find((p) => {
      const s = sizeOf(p.item);
      return x >= p.x && x < p.x + s.w && y >= p.y && y < p.y + s.h;
    });
  }

  /** (x, y)에 놓을 때 겹치는 아이템들 (원작: 하나만 겹치면 그 아이템과 바꿔 든다) */
  overlapping(item: ItemInstance, x: number, y: number): Placed[] {
    const s = sizeOf(item);
    return this.items.filter((p) => {
      const t = sizeOf(p.item);
      return p.x < x + s.w && x < p.x + t.w && p.y < y + s.h && y < p.y + t.h;
    });
  }
}

/** 아이템 격자 크기. ItemDb 가 없는 곳에서도 쓰도록 인스턴스에 기록된 크기를 쓴다 */
export const sizeOf = (item: ItemInstance): { w: number; h: number } => ({ w: item.invW ?? 1, h: item.invH ?? 1 });

/** 아이템 타입 체인에서 장착 가능한 위치 */
export function bodyLocsOf(items: ItemDb, base: ItemBase): BodyLoc[] {
  for (const t of [base.type, base.type2]) {
    if (!t) continue;
    for (const c of items.typeChain(t)) {
      const def = items.types.get(c);
      if (def?.body) return [...new Set([def.bodyLoc1, def.bodyLoc2].filter((l): l is BodyLoc => (BODY_LOCS as readonly string[]).includes(l)))];
    }
  }
  return [];
}

export interface EquipContext {
  items: ItemDb;
  cls: ClassName;
  level: number;
  str: number;
  dex: number;
  equipment: Partial<Record<BodyLoc, ItemInstance>>;
}

export type EquipError = 'slot' | 'level' | 'str' | 'dex' | 'twohand' | 'dualwield' | 'class';

/**
 * 아이템 요구치 (weapons/armor/misc.txt levelreq/reqstr/reqdex + 매직 접사·유니크 lvl req 중 큰 값).
 * 요구치 감소(properties ease → itemstatcost item_req_percent, 예: Steeldriver −50%)는 힘·민첩 요구치에만 곱한다.
 * 근사(원작 미확인): 감정된 아이템에만 적용 (미감정 아이템은 마법 속성이 없는 것으로 보는 computeDerived 와 같게)
 */
export function requirements(items: ItemDb, item: ItemInstance): { level: number; str: number; dex: number } {
  const b = items.base(item.code);
  const pct = item.identified ? statOf(item, 'item_req_percent') : 0;
  const req = (v: number) => Math.max(0, Math.trunc((v * (100 + pct)) / 100));
  return {
    level: Math.max(b?.levelReq ?? 0, item.levelReq ?? 0),
    str: req(b?.reqStr ?? 0),
    dex: req(b?.reqDex ?? 0),
  };
}

const isShield = (items: ItemDb, b: ItemBase) => items.isType(b, 'shld');
const isWeapon = (items: ItemDb, b: ItemBase) => items.isType(b, 'weap');
const isQuiver = (items: ItemDb, b: ItemBase) => items.isType(b, 'misl');
/** 한 손으로 쥘 수 있는가: 2handed 가 아니거나, 바바리안이 1or2handed 무기를 */
export const oneHanded = (b: ItemBase, cls: ClassName): boolean => !b.twoHanded || (cls === 'Barbarian' && b.oneOrTwoHanded);

/** 장착 가능 여부. 원작 규칙: 위치 · 요구치 · 양손 무기와 반대 손(방패/무기, 활은 화살통만) · 무기 두 개는 바바리안만 */
export function canEquip(ctx: EquipContext, item: ItemInstance, loc: BodyLoc): EquipError | null {
  const { items } = ctx;
  const b = items.base(item.code);
  if (!b || !bodyLocsOf(items, b).includes(loc)) return 'slot';
  const r = requirements(items, item);
  if (ctx.level < r.level) return 'level';
  if (ctx.str < r.str) return 'str';
  if (ctx.dex < r.dex) return 'dex';
  if (loc === 'rarm' || loc === 'larm') {
    const other = ctx.equipment[loc === 'rarm' ? 'larm' : 'rarm'];
    const ob = other ? items.base(other.code) : undefined;
    if (ob) {
      const bothWeapons = isWeapon(items, b) && isWeapon(items, ob);
      if (bothWeapons && ctx.cls !== 'Barbarian') return 'dualwield';
      if (isShield(items, b) && isShield(items, ob)) return 'slot';
      // 양손 무기 + 반대 손: 활·석궁과 화살통만 허용
      const bow = (w: ItemBase, q: ItemBase) => (items.isType(w, 'bow') || items.isType(w, 'xbow')) && isQuiver(items, q);
      if (isWeapon(items, b) && !oneHanded(b, ctx.cls) && !bow(b, ob)) return 'twohand';
      if (isWeapon(items, ob) && !oneHanded(ob, ctx.cls) && !bow(ob, b)) return 'twohand';
      if (bothWeapons && (!oneHanded(b, ctx.cls) || !oneHanded(ob, ctx.cls))) return 'twohand';
    }
  }
  return null;
}

/** 벨트 칸 수: 장착한 벨트의 belts.txt numboxes, 없으면 default 4 */
export function beltBoxes(items: ItemDb, belt: ItemInstance | undefined): number {
  const b = belt ? items.base(belt.code) : undefined;
  return BELT_BOXES[b ? b.beltType : DEFAULT_BELT] ?? 4;
}

export function beltable(items: ItemDb, item: ItemInstance): boolean {
  const b = items.base(item.code);
  if (!b) return false;
  for (const c of items.typeChain(b.type)) if (items.types.get(c)?.beltable) return true;
  return false;
}
