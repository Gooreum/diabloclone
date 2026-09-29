// 캐릭터 파생 스탯: 기본(Character) + 장착 아이템(+소켓 보석, 세트 보너스).
// 출처: Maxroll — Life & Mana Mechanics (아이템 활력·에너지도 클래스 계수로 생명·마나 증가, 최대 생명% 는 마지막에 곱)
//       Maxroll — Damage Calculation: 무기 기본 피해 × (1 + 무기 자체 ED%) + 최소/최대 추가, 다른 아이템 ED% 는 힘 보너스와 같은 합산
//       Maxroll — Defense: 아이템 방어 = 기본 × (1 + ED%) + 추가 방어, 캐릭터 방어 = 아이템 합 + 추가 방어 + 민첩/4
//       The Arreat Summit — Resistances: 최대 75% (+ 최대 저항 증가), Normal 난이도 저항 감소 없음
//       itemstatcost.txt 스탯 이름
import { isBroken } from './price';
import type { ItemBase, ItemDb } from './items';
import type { Character, ClassStats } from './player';
import type { ItemInstance } from './treasure';
import { statOf, type ItemGen } from './itemgen';
import { Rng } from './rng';

/** 무기 자체에만 적용되는 스탯 (다른 아이템에 있으면 캐릭터 전체에 적용) */
const WEAPON_LOCAL = new Set(['item_mindamage_percent', 'item_maxdamage_percent', 'mindamage', 'maxdamage']);
/** 방어구 자체에만 적용되는 스탯 */
const ARMOR_LOCAL = new Set(['item_armor_percent', 'armorclass']);

export interface Derived {
  str: number; dex: number; vit: number; ene: number;
  maxLife: number; maxMana: number; maxStamina: number;
  /** 장비 방어 합 + 추가 방어 + 민첩/4 (스킬 방어% 적용 전) */
  defense: number;
  /** 추가 명중 (tohit) · 명중% (item_tohit_percent) */
  toHit: number; toHitPct: number;
  /** 오른손 무기 실제 피해 (1H 기준, 무기 ED·추가 반영) · 무기 외 추가 최소/최대 · 무기 외 ED% */
  weaponMin: number; weaponMax: number; addMin: number; addMax: number; offWeaponEdPct: number;
  /** 방패 막기 + toblock */
  block: number;
  res: { fi: number; co: number; li: number; po: number; ma: number };
  /** 모든 장착 스탯 합 (param 0) — 공격 속도·이동 속도·생명 흡수 등 */
  stat: (name: string) => number;
}

export interface EquippedSet { items: ItemInstance[] }

/** 아이템이 캐릭터에 주는 스탯 (소켓 보석 포함, 세트 보너스는 따로) */
export function itemStats(item: ItemInstance): { stat: string; param: number; value: number }[] {
  return [...item.stats, ...item.socketed.flatMap((g) => g.stats)];
}

/**
 * 세트 보너스: 같은 세트 아이템 수에 따라 아이템별 부분 보너스(setitems aprop, add func 1 = 착용 수 2개부터 순서대로)와
 * 세트 부분(sets PCode2~5)·완성(FCode) 보너스.
 * 출처: D2MOO ITEMMODS_UpdateFullSetBoni / ITEMMODS_AssignProperty PROPMODE_SET
 * 근사(원작 미확인): add func 2 (특정 아이템 조합) 은 1 과 같이 착용 수 기준으로 처리
 */
export function setBonusStats(equipped: ItemInstance[], gen: ItemGen | null, items: ItemDb): { stat: string; param: number; value: number }[] {
  if (!gen) return [];
  const bySet = new Map<string, ItemInstance[]>();
  for (const it of equipped) {
    if (it.setIdx === undefined) continue;
    const def = gen.setItems[it.setIdx];
    if (!def) continue;
    const list = bySet.get(def.set) ?? [];
    list.push(it);
    bySet.set(def.set, list);
  }
  const out: { stat: string; param: number; value: number }[] = [];
  const tmp = (): ItemInstance => ({ id: 0, code: '', quality: 5, ilvl: 1, identified: true, quantity: 1, durability: 0, maxDurability: 0, defense: 0, invW: 1, invH: 1, levelReq: 0, prefixes: [], suffixes: [], sockets: 0, socketed: [], stats: [] });
  for (const [setName, list] of bySet) {
    const count = list.length;
    const scratch = tmp();
    const fakeBase = items.base(list[0]?.code ?? '') as ItemBase;
    for (const it of list) {
      const def = gen.setItems[it.setIdx as number];
      if (!def || !def.addFunc) continue;
      def.partial.forEach((mods, k) => {
        if (count >= k + 2) gen.assignMods(scratch, fakeBase, mods.map((m) => ({ ...m, max: m.min })), noRoll());
      });
    }
    const set = gen.sets.get(setName);
    if (set) {
      set.partial.forEach((mods, k) => {
        if (count >= k + 2) gen.assignMods(scratch, fakeBase, mods.map((m) => ({ ...m, max: m.min })), noRoll());
      });
      const total = gen.setItems.filter((s) => s.set === setName && s.rarity >= 0).length;
      if (count >= total && total > 0) gen.assignMods(scratch, fakeBase, set.full.map((m) => ({ ...m, max: m.min })), noRoll());
    }
    out.push(...scratch.stats);
  }
  return out;
}

/** 세트 보너스 값은 고정(min=max 로 넘겨 굴림이 일어나지 않는다) */
const noRoll = () => new Rng(1);

/** 무기 실제 피해 (정수, 1H 기준): 기본 × (100 + 무기 ED%)/100 + 무기 최소/최대 추가, 하급은 75%. 출처: Maxroll Damage Calculation */
export function weaponDamage(item: ItemInstance, base: ItemBase): { min: number; max: number } {
  let bmin = base.maxDam > 0 ? base.minDam : base.twoHandMinDam;
  let bmax = base.maxDam > 0 ? base.maxDam : base.twoHandMaxDam;
  if (item.inferiorDamage) {
    bmin = Math.max(Math.trunc((75 * bmin) / 100), 1);
    bmax = Math.max(Math.trunc((75 * bmax) / 100), 2);
  }
  const edMin = statOf(item, 'item_mindamage_percent'), edMax = statOf(item, 'item_maxdamage_percent');
  const min = Math.trunc((bmin * (100 + edMin)) / 100) + statOf(item, 'mindamage');
  const max = Math.trunc((bmax * (100 + edMax)) / 100) + statOf(item, 'maxdamage');
  return { min, max: Math.max(max, min + 1) };
}

/** 방어구 방어: 기본 × (100 + ED%)/100 + 추가 방어. 출처: Maxroll Defense */
export function armorDefense(item: ItemInstance): number {
  return Math.trunc((item.defense * (100 + statOf(item, 'item_armor_percent'))) / 100) + statOf(item, 'armorclass');
}

export function computeDerived(ch: Character, cs: ClassStats, equipment: Record<string, ItemInstance>, items: ItemDb, gen: ItemGen | null): Derived {
  const sums = new Map<string, number>();
  const add = (s: string, v: number) => sums.set(s, (sums.get(s) ?? 0) + v);
  const equipped = Object.values(equipment);
  let defense = 0;
  let weaponMin = 1, weaponMax = 2;
  let block = 0;
  for (const [slot, it] of Object.entries(equipment)) {
    const b = items.base(it.code);
    // 부서진 아이템(내구 0)은 아무 효과가 없다 (출처: D2MOO ITEMS_UpdateDurability → IFLAG_BROKEN, 스탯 목록 비활성)
    if (!b || isBroken(it)) continue;
    const isWeapon = items.isType(b, 'weap');
    const isArmor = items.isType(b, 'armo');
    if (isArmor) defense += armorDefense(it);
    if (items.isType(b, 'shld')) block += b.block;
    // 미감정 아이템은 기본 수치(방어·피해)만, 마법 속성은 감정 후 (근사: 원작 스탯 레이어 처리 미확인)
    for (const s of it.identified ? it.stats : []) {
      if (s.param !== 0) continue;
      if (isWeapon && WEAPON_LOCAL.has(s.stat)) continue;
      if (isArmor && ARMOR_LOCAL.has(s.stat)) continue;
      add(s.stat, s.value);
    }
    // 소켓 보석 속성은 캐릭터 전체에 (보석 방어·피해는 gems.txt 속성 그대로)
    for (const g of it.socketed) for (const s of g.stats) if (s.param === 0) add(s.stat, s.value);
    if (slot === 'rarm' && isWeapon) {
      const d = weaponDamage(it, b);
      weaponMin = d.min;
      weaponMax = d.max;
    }
  }
  for (const s of setBonusStats(equipped.filter((it) => !isBroken(it) && it.identified), gen, items)) if (s.param === 0) add(s.stat, s.value);
  const get = (s: string) => sums.get(s) ?? 0;
  const str = ch.str + get('strength'), dex = ch.dex + get('dexterity'), vit = ch.vit + get('vitality'), ene = ch.ene + get('energy');
  // itemstatcost maxhp/maxmana 는 ValShift 8 (1/256) 이지만 여기서는 속성 값(정수) 그대로 저장한다
  const lifeBase = ch.maxLife + ((vit - ch.vit) * cs.lifePerVit) / 4 + get('maxhp');
  const manaBase = ch.maxMana + ((ene - ch.ene) * cs.manaPerEne) / 4 + get('maxmana');
  const stamBase = ch.maxStamina + ((vit - ch.vit) * cs.staminaPerVit) / 4 + get('maxstamina');
  const cap = (base: number, maxStat: string) => Math.min(base, 75 + get(maxStat));
  return {
    str, dex, vit, ene,
    maxLife: Math.floor(lifeBase * (100 + get('item_maxhp_percent')) / 100),
    maxMana: Math.floor(manaBase * (100 + get('item_maxmana_percent')) / 100),
    maxStamina: stamBase,
    defense: defense + get('armorclass') + Math.floor(dex / 4),
    toHit: get('tohit'), toHitPct: get('item_tohit_percent'),
    weaponMin, weaponMax, addMin: get('mindamage'), addMax: get('maxdamage'),
    offWeaponEdPct: get('item_maxdamage_percent'),
    block: block + get('toblock'),
    res: {
      fi: cap(get('fireresist'), 'maxfireresist'), co: cap(get('coldresist'), 'maxcoldresist'), li: cap(get('lightresist'), 'maxlightresist'),
      po: cap(get('poisonresist'), 'maxpoisonresist'), ma: cap(get('magicresist'), 'maxmagicresist'),
    },
    stat: get,
  };
}
