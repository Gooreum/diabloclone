// 아이템 베이스 데이터베이스 (weapons.txt / armor.txt / misc.txt / itemtypes.txt 원본).
// 출처: Phrozen Keep — Weapons.txt / Armor.txt / Misc.txt / ItemTypes.txt File Guides (https://d2mods.info/forum/kb/index?c=4)
import type { TxtRow } from '../formats/txt';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export type ItemCategory = 'weapon' | 'armor' | 'misc';

export interface ItemBase {
  code: string;
  name: string;
  namestr: string;
  category: ItemCategory;
  type: string;
  type2: string;
  level: number;
  levelReq: number;
  rarity: number;
  spawnable: boolean;
  /** weapons/armor/misc.txt version: 0 = 클래식, 100 = 확장팩 */
  version: number;
  invWidth: number;
  invHeight: number;
  invFile: string;
  cost: number;
  durability: number;
  noDurability: boolean;
  minDam: number; maxDam: number;
  twoHandMinDam: number; twoHandMaxDam: number;
  twoHanded: boolean;
  strBonus: number; dexBonus: number;
  speed: number;
  minAc: number; maxAc: number;
  block: number;
  reqStr: number; reqDex: number;
  wclass: string;
  twoHandedWclass: string;
  hitClass: string;
  stackable: boolean;
  minStack: number; maxStack: number;
  quest: boolean;
  unique: boolean;
}

export interface ItemTypeDef { code: string; name: string; equiv: string[]; normal: boolean; magic: boolean; rare: boolean; treasureClass: boolean; throwable: boolean }

export class ItemDb {
  readonly bases = new Map<string, ItemBase>();
  readonly types = new Map<string, ItemTypeDef>();

  constructor(tables: { weapons: TxtRow[]; armor: TxtRow[]; misc: TxtRow[]; itemtypes: TxtRow[] }) {
    for (const r of tables.itemtypes) {
      if (!r.Code) continue;
      this.types.set(r.Code, {
        code: r.Code, name: r.ItemType ?? '', equiv: [r.Equiv1, r.Equiv2].filter((x): x is string => !!x),
        normal: n(r.Normal) === 1, magic: n(r.Magic) === 1, rare: n(r.Rare) === 1,
        treasureClass: n(r.TreasureClass) === 1, throwable: n(r.Throwable) === 1,
      });
    }
    const add = (rows: TxtRow[], category: ItemCategory) => {
      for (const r of rows) {
        if (!r.code || r.code === 'Expansion') continue;
        this.bases.set(r.code, {
          code: r.code, name: r.name ?? r.code, namestr: r.namestr ?? r.code, category,
          type: r.type ?? '', type2: r.type2 ?? '', level: n(r.level), levelReq: n(r.levelreq), rarity: n(r.rarity),
          spawnable: n(r.spawnable) === 1, version: n(r.version),
          invWidth: n(r.invwidth) || 1, invHeight: n(r.invheight) || 1, invFile: r.invfile ?? '', cost: n(r.cost),
          durability: n(r.durability), noDurability: n(r.nodurability) === 1,
          minDam: n(r.mindam), maxDam: n(r.maxdam), twoHandMinDam: n(r['2handmindam']), twoHandMaxDam: n(r['2handmaxdam']),
          twoHanded: n(r['2handed']) === 1,
          strBonus: n(r.StrBonus), dexBonus: n(r.DexBonus), speed: n(r.speed),
          minAc: n(r.minac), maxAc: n(r.maxac), block: n(r.block),
          reqStr: n(r.reqstr), reqDex: n(r.reqdex),
          wclass: r.wclass ?? '', twoHandedWclass: r['2handedwclass'] ?? '', hitClass: r['hit class'] ?? '',
          stackable: n(r.stackable) === 1, minStack: n(r.minstack), maxStack: n(r.maxstack),
          quest: n(r.quest) > 0, unique: n(r.unique) === 1,
        });
      }
    };
    add(tables.weapons, 'weapon');
    add(tables.armor, 'armor');
    add(tables.misc, 'misc');
  }

  base(code: string): ItemBase | undefined {
    return this.bases.get(code);
  }

  /** 타입 체인 (itemtypes Equiv1/Equiv2 를 따라 올라감) */
  typeChain(type: string): Set<string> {
    const out = new Set<string>();
    const stack = [type];
    while (stack.length) {
      const t = stack.pop() as string;
      if (!t || out.has(t)) continue;
      out.add(t);
      for (const e of this.types.get(t)?.equiv ?? []) stack.push(e);
    }
    return out;
  }

  isType(base: ItemBase, type: string): boolean {
    return this.typeChain(base.type).has(type) || (!!base.type2 && this.typeChain(base.type2).has(type));
  }
}
