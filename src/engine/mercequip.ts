// 확장팩 용병 장비: 용병 종류별 장착 가능 아이템, 장착 칸, 요구치, 장비를 더한 용병 능력치.
// 출처: D2MOO D2Game/src/PLAYER/PlrMsg.cpp — D2GAME_PACKETCALLBACK_Rcv0x61_DropPickupMercItem (종류 표 3920~3967),
//       D2GAME_MERCS_EquipItem_6FC88D10 (칸 = itemtypes BodyLoc1, Act 3 방패는 BodyLoc2)
// 출처: D2MOO D2Common/src/Items/Items.cpp — ITEMS_CheckRequirements (용병 자신의 레벨·힘·민첩, 직업 전용은 Act 5 용병의 바바리안 아이템만 예외)
// 출처: D2MOO D2Game/src/UNIT/SUnitDmg.cpp — SUNITDMG_ApplyDamageBonuses (양손 무기 = STAT_SECONDARY 피해(hireling + 무기 양손),
//       한손 무기 = STAT_MINDAMAGE(monstats A1 + 무기 한손), 피해 % = damagepercent + StrBonus·힘/100 + DexBonus·민첩/100, −90 하한,
//       그 위에 item_min/maxdamage_percent)
// 출처: D2MOO D2Game/src/ITEMS/ItemMode.cpp — 장비 스탯을 용병 스탯에 합침, 요구치를 못 맞춘 장비(IFLAG_NOEQUIP)는 스탯 없음
import { armorDefense, itemLocalOps, setBonusStats } from './charstats';
import type { MercStats } from './hireling';
import { isClaw, itemClassCode, requirements } from './inventory';
import type { ItemGen, StatOp } from './itemgen';
import type { ItemBase, ItemDb } from './items';
import type { AttackDef } from './monster';
import { isBroken } from './price';
import type { ItemInstance } from './treasure';

export type MercSlot = 'head' | 'tors' | 'rarm' | 'larm';
export const MERC_SLOTS: readonly MercSlot[] = ['head', 'tors', 'rarm', 'larm'];

const ACT5 = new Set(['act5hire1', 'act5hire2']);

/** 출처: PlrMsg.cpp:3920 — 갑옷(ITEMTYPE_ARMOR = tors)·투구(helm, 서클릿·바바리안 투구 포함)는 모든 용병, 무기·방패는 용병 종류별 */
export function mercAllows(items: ItemDb, monId: string, b: ItemBase): boolean {
  if (items.isType(b, 'tors') || items.isType(b, 'helm')) return true;
  const is = (t: string) => items.isType(b, t);
  switch (monId) {
    case 'roguehire':
      return is('bow');
    case 'act2hire':
      return is('spea') || is('pole');
    case 'act3hire':
      return is('shie') || (is('swor') && !b.twoHanded);
    case 'act5hire1':
      return (is('axe') && !b.twoHanded) || is('phlm');
    case 'act5hire2':
      return is('swor') || is('phlm');
    default:
      return false;
  }
}

/** 출처: D2GAME_MERCS_EquipItem — 칸은 아이템 종류의 BodyLoc1, Act 3 용병의 방패만 BodyLoc2 (왼손) */
export function mercSlotFor(items: ItemDb, monId: string, b: ItemBase): MercSlot | null {
  if (monId === 'act3hire' && items.isType(b, 'shie')) return 'larm';
  for (const t of [b.type, b.type2]) {
    if (!t) continue;
    for (const c of items.typeChain(t)) {
      const def = items.types.get(c);
      if (!def?.body) continue;
      return (MERC_SLOTS as readonly string[]).includes(def.bodyLoc1) ? (def.bodyLoc1 as MercSlot) : null;
    }
  }
  return null;
}

export type MercEquipError = 'type' | 'class' | 'level' | 'str' | 'dex';

/**
 * 장착 가능 여부. 출처: Rcv0x61 (퀘스트·미감정·부서진 아이템은 거절, 종류 표) + ITEMS_CheckRequirements
 *   (직업 전용: Act 5 용병은 바바리안 아이템만 허용, 그 밖의 직업 전용은 모두 거절)
 */
export function mercCanEquip(items: ItemDb, monId: string, item: ItemInstance, st: { level: number; str: number; dex: number }): MercEquipError | null {
  const b = items.base(item.code);
  if (!b || b.quest || !item.identified || isBroken(item) || isClaw(items, b)) return 'type';
  if (!mercAllows(items, monId, b) || !mercSlotFor(items, monId, b)) return 'type';
  const cc = itemClassCode(items, b);
  if (cc && !(cc === 'bar' && ACT5.has(monId))) return 'class';
  const r = requirements(items, item);
  if (st.level < r.level) return 'level';
  if (st.str < r.str) return 'str';
  if (st.dex < r.dex) return 'dex';
  return null;
}

export interface MercDerived {
  str: number; dex: number; maxHp: number; defense: number; toHit: number;
  resist: { fi: number; co: number; li: number; po: number };
  /** 근접·미사일 기본 피해 (피해 % 적용 후). 무기가 없으면 null — 부르는 쪽이 hireling 피해를 쓴다 */
  dmg: { min: number; max: number } | null;
  /** 능력치를 주는 장비 (요구치를 못 맞춘 것 제외) */
  active: ItemInstance[];
  /** 장비 스탯 합 (param 0) */
  stat: (s: string) => number;
  /** param 이 있는 스탯 (item_aura · item_nonclassskill · 스킬 발동 …) */
  layered: { stat: string; param: number; value: number }[];
}

/** 무기 자체에만 적용되는 스탯 · 방어구 자체에만 적용되는 스탯 (charstats.ts 와 같다) */
const ARMOR_LOCAL = new Set(['item_armor_percent', 'armorclass']);

/**
 * 장비를 더한 용병 능력치.
 * @param base 레벨별 기본 능력치 (MONSTERAI_UpdateMercStatsAndSkills)
 * @param monA1 monstats A1 피해 (한손 무기의 기본 피해 — 용병 행은 비어 있다)
 * 근사(원작 미확인): 요구치는 다른 장비의 힘·민첩을 더해 한 번 더 확인 (원작 ITEMS_UpdateInventoryItems 의 순서 세부 미확인)
 */
export function mercDerived(base: MercStats, monId: string, monA1: AttackDef, eq: Partial<Record<MercSlot, ItemInstance>>, items: ItemDb, gen: ItemGen | null): MercDerived {
  const ops = gen?.statOps ?? new Map<string, StatOp>();
  const all = MERC_SLOTS.map((s) => eq[s]).filter((it): it is ItemInstance => !!it && !!items.base(it.code) && !isBroken(it) && it.identified);
  const ownStats = (it: ItemInstance) => [...it.stats, ...it.socketed.flatMap((g) => g.stats)];
  const bonus = (list: ItemInstance[], stat: string, skip?: ItemInstance) => list.reduce((a, it) => (it === skip ? a : a + ownStats(it).filter((s) => s.stat === stat && !s.param).reduce((x, s) => x + s.value, 0)), 0);
  let active = all;
  for (let pass = 0; pass < 2; pass++) {
    const prev = active;
    active = all.filter((it) => !mercCanEquip(items, monId, it, { level: base.level, str: base.str + bonus(prev, 'strength', it), dex: base.dex + bonus(prev, 'dexterity', it) }));
  }
  const sums = new Map<string, number>();
  const add = (s: string, v: number) => sums.set(s, (sums.get(s) ?? 0) + v);
  const layered: MercDerived['layered'] = [];
  let armor = 0;
  let weapon: { it: ItemInstance; b: ItemBase; maxBonus: number; maxPct: number } | null = null;
  for (const it of active) {
    const b = items.base(it.code) as ItemBase;
    const isWeapon = items.isType(b, 'weap'), isArmor = items.isType(b, 'armo');
    const own = ownStats(it);
    const local = itemLocalOps(own, ops, base.level, isArmor, isWeapon, add);
    if (isArmor) armor += armorDefense(it, local);
    if (isWeapon) weapon = { it, b, maxBonus: local.max, maxPct: local.maxPct };
    for (const s of own) {
      if (s.param !== 0) {
        layered.push(s);
        continue;
      }
      if (isArmor && ARMOR_LOCAL.has(s.stat)) continue;
      add(s.stat, s.value);
    }
  }
  const extra = setBonusStats(active, gen, items);
  itemLocalOps(extra, ops, base.level, false, false, add);
  for (const s of extra) {
    if (s.param === 0) add(s.stat, s.value);
    else layered.push(s);
  }
  // 레벨당 (op 2): 용병 레벨로 (출처: D2StatList.cpp case 2)
  for (const [stat, v] of [...sums]) {
    const op = ops.get(stat);
    if (op?.op === 2 && op.base === 'level' && v) for (const t of op.targets) add(t, (base.level * v) >> op.param);
  }
  const get = (s: string) => sums.get(s) ?? 0;
  const str = base.str + get('strength'), dex = base.dex + get('dexterity');
  const cap = (v: number, maxStat: string) => Math.min(v, Math.min(95, 75 + get(maxStat)));
  let dmg: MercDerived['dmg'] = null;
  if (weapon) {
    const { it, b } = weapon;
    const eth = (v: number) => (it.ethereal ? Math.trunc((3 * v) / 2) : v);
    const low = (v: number, floor: number) => (it.inferiorDamage ? Math.max(Math.trunc((75 * v) / 100), floor) : v);
    // 양손(INVENTORY_GetWieldType 2 = 2handed 무기): STAT_SECONDARY = hireling 피해 + 무기 양손 피해. 한손: STAT_MINDAMAGE = monstats A1 + 무기 한손 피해
    const two = b.twoHanded;
    let min = (two ? base.minDamage : monA1.min) + low(eth(two ? b.twoHandMinDam : b.minDam), 1) + get('mindamage');
    let max = (two ? base.maxDamage : monA1.max) + low(eth(two ? b.twoHandMaxDam : b.maxDam), 2) + get('maxdamage') + weapon.maxBonus;
    const pct = Math.max(get('damagepercent') + Math.trunc((b.strBonus * str) / 100) + Math.trunc((b.dexBonus * dex) / 100), -90);
    min += Math.trunc((min * (pct + get('item_mindamage_percent'))) / 100);
    max += Math.trunc((max * (pct + get('item_maxdamage_percent') + weapon.maxPct)) / 100);
    dmg = { min: Math.max(1, min), max: Math.max(min + 1, max) };
  }
  return {
    str, dex,
    maxHp: Math.floor(((base.maxHp + get('maxhp')) * (100 + get('item_maxhp_percent'))) / 100),
    defense: Math.max(0, base.defense + armor + get('armorclass')),
    toHit: base.toHit + get('tohit'),
    resist: {
      fi: cap(base.resist + get('fireresist'), 'maxfireresist'), co: cap(base.resist + get('coldresist'), 'maxcoldresist'),
      li: cap(base.resist + get('lightresist'), 'maxlightresist'), po: cap(base.resist + get('poisonresist'), 'maxpoisonresist'),
    },
    dmg, active, stat: get, layered,
  };
}

/** 용병이 그 스킬에 받는 아이템 보너스: +모든 스킬, oskill(가진 스킬이면 최대 3). 출처: SKILLS_GetBonusSkillLevel (D2Skills.cpp:1925 — 직업·탭 보너스는 플레이어만) */
export function mercSkillBonus(d: MercDerived | null, skillId: number): number {
  if (!d) return 0;
  const osk = d.layered.filter((l) => l.stat === 'item_nonclassskill' && l.param === skillId).reduce((a, l) => a + l.value, 0);
  return d.stat('item_allskills') + Math.min(osk, 3);
}

