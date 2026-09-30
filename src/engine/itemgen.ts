// 아이템 품질 적용: 매직·레어 접사, 유니크·세트 선택, 상급·하급, 소켓, 지팡이 스킬, 속성 → 스탯.
// 출처: D2MOO (https://github.com/ThePhrozenKeep/D2MOO)
//   D2Game ITEMS/ItemMode.cpp sub_6FC4C5F0 (품질 분기와 실패 시 대체: 유니크 → 내구 ×3 → 레어 → 매직 → 상급 → 일반,
//     세트 → 내구 ×2 → 매직 → 상급 → 일반, 레어 → 매직, 매직 → 상급, 상급·하급 → 일반, 끝에 일반·상급만 소켓)
//   D2Game ITEMS/ItemsMagic.cpp ITEMS_RollMagicAffixesNew (rand(2) 로 접두 여부, alvl, 후보 필터, 가중치 = frequency (magic lvl 있으면 × level),
//     rand(합+1)), D2GAME_RollRareItem / RollRareAffix (레어 이름 균등, 접사 수 {3,4,4,5,5,5,6,6}[rand & 7], 한쪽 최대 3),
//     sub_6FC542C0 (세트), sub_6FC54690 (상급), sub_6FC549F0 (하급: 내구 1/3, 피해·방어 75%)
//   D2Game ITEMS/Items.cpp sub_6FC4D6B0 (소켓: rand%100 < 33, 개수 = 시작 시드 % 최대 + 1, 클래식 몸통 갑옷 제외, Normal 최대 3),
//     sub_6FC52650 (지팡이 스킬)
//   D2Common Items/ItemMods.cpp ITEMMODS_CanItemHaveMagicAffix (클래식은 겹치는·투척 아이템 불가, etype 제외 → itype 포함),
//     ITEMMODS_RollRandomValueInRange (min + rand(max − min + 1)), PropertyFunc01~24, sub_6FD92CF0 (방어% 가 있으면 기본 방어 = maxac + 1)
import type { TxtRow } from '../formats/txt';
import type { ItemBase, ItemDb } from './items';
import { QUALITY, type ItemInstance, type ItemStat, type Quality } from './treasure';
import { MaxRng, Rng } from './rng';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;
const CLASSIC = (version: string | undefined) => n(version) < 100;

export interface Mod { code: string; param: string; min: number; max: number }

export interface MagicAffix {
  /** 표 행 번호 (magicprefix / magicsuffix 각각) */
  idx: number;
  prefix: boolean;
  name: string;
  spawnable: boolean; rare: boolean;
  level: number; maxLevel: number; levelReq: number;
  classSpecific: string;
  frequency: number; group: number;
  /** 가격 (magicprefix/suffix add, multiply) */
  costAdd: number; costMult: number;
  mods: Mod[];
  itypes: string[]; etypes: string[];
}

export interface RareAffix { idx: number; name: string; itypes: string[]; etypes: string[] }
export interface UniqueDef { idx: number; name: string; costAdd: number; costMult: number; enabled: boolean; ladder: boolean; rarity: number; noLimit: boolean; lvl: number; lvlReq: number; code: string; mods: Mod[]; invFile: string }
export interface SetItemDef { idx: number; name: string; costAdd: number; costMult: number; set: string; code: string; rarity: number; lvl: number; lvlReq: number; mods: Mod[]; partial: Mod[][]; addFunc: number; invFile: string }
export interface SetDef { name: string; partial: Mod[][]; full: Mod[] }
interface QualityItemDef { mods: Mod[]; armor: boolean; weapon: boolean; shield: boolean; scepter: boolean; wand: boolean; staff: boolean; bow: boolean; boots: boolean; gloves: boolean; belt: boolean }
interface PropBlock { set: number; val: number; func: number; stat: string }

const mods = (r: TxtRow, code: string, param: string, min: string, max: string, count: number, start = 1): Mod[] => {
  const out: Mod[] = [];
  for (let i = start; i < start + count; i++) {
    const c = r[code.replace('#', String(i))];
    if (c) out.push({ code: c, param: r[param.replace('#', String(i))] ?? '', min: n(r[min.replace('#', String(i))]), max: n(r[max.replace('#', String(i))]) });
  }
  return out;
};

/** 보석 속성 (gems.txt: 무기 / 투구·갑옷 / 방패 별) */
export interface GemDef { code: string; weapon: Mod[]; helm: Mod[]; shield: Mod[] }

export interface ItemTables {
  magicprefix: TxtRow[]; magicsuffix: TxtRow[]; rareprefix: TxtRow[]; raresuffix: TxtRow[];
  uniqueitems: TxtRow[]; setitems: TxtRow[]; sets: TxtRow[]; qualityitems: TxtRow[]; lowqualityitems: TxtRow[];
  properties: TxtRow[]; itemstatcost: TxtRow[]; skills: TxtRow[];
  gems?: TxtRow[];
}

/** 품질 적용에 쓰는 게임 상태 (유니크 한 번만 드롭 규칙) */
export interface GenContext {
  droppedUniques: Set<number>;
}

export class ItemGen {
  readonly items: ItemDb;
  readonly prefixes: MagicAffix[];
  readonly suffixes: MagicAffix[];
  readonly rarePrefixes: RareAffix[];
  readonly rareSuffixes: RareAffix[];
  readonly uniques: UniqueDef[];
  readonly setItems: SetItemDef[];
  readonly sets = new Map<string, SetDef>();
  private readonly qualityItems: QualityItemDef[];
  readonly lowQualityNames: string[];
  private readonly props = new Map<string, PropBlock[]>();
  /** 스탯 이름 → itemstatcost ValShift (값 저장 시 시프트 — maxhp 등은 1/256 로 저장) */
  readonly valShift = new Map<string, number>();
  /** 스탯 가격 (itemstatcost Add, Multiply, Encode) */
  readonly statCost = new Map<string, { add: number; mult: number; encode: number }>();
  /** 스킬 가격 (skills.txt cost add, cost mult) */
  readonly skillCost = new Map<number, { add: number; mult: number }>();
  /** 클래스 스킬 시작 Id (staffmods) */
  private readonly classFirstSkill = new Map<string, number>();
  private readonly skillRows: TxtRow[];
  readonly gems = new Map<string, GemDef>();

  constructor(items: ItemDb, t: ItemTables) {
    this.items = items;
    const affix = (rows: TxtRow[], prefix: boolean): MagicAffix[] =>
      rows.map((r, idx) => ({
        idx, prefix, name: r.Name ?? '', spawnable: n(r.spawnable) === 1, rare: n(r.rare) === 1,
        level: n(r.level), maxLevel: n(r.maxlevel), levelReq: n(r.levelreq), classSpecific: r.classspecific ?? '',
        frequency: n(r.frequency), group: n(r.group), costAdd: n(r.add), costMult: n(r.multiply),
        mods: mods(r, 'mod#code', 'mod#param', 'mod#min', 'mod#max', 3),
        itypes: [1, 2, 3, 4, 5, 6, 7].map((i) => r[`itype${i}`] ?? '').filter(Boolean),
        etypes: [1, 2, 3, 4, 5].map((i) => r[`etype${i}`] ?? '').filter(Boolean),
        // 클래식 필터 (version >= 100 은 확장팩), 이름 없는 행(Expansion 구분선)은 제외
        ...(CLASSIC(r.version) && r.Name ? {} : { frequency: 0, spawnable: false }),
      }));
    this.prefixes = affix(t.magicprefix, true);
    this.suffixes = affix(t.magicsuffix, false);
    const rare = (rows: TxtRow[]): RareAffix[] =>
      rows.filter((r) => r.name && CLASSIC(r.version)).map((r, idx) => ({
        idx, name: r.name ?? '',
        itypes: [1, 2, 3, 4, 5, 6, 7].map((i) => r[`itype${i}`] ?? '').filter(Boolean),
        etypes: [1, 2, 3, 4].map((i) => r[`etype${i}`] ?? '').filter(Boolean),
      }));
    this.rarePrefixes = rare(t.rareprefix);
    this.rareSuffixes = rare(t.raresuffix);
    this.uniques = t.uniqueitems.map((r, idx) => ({
      idx, name: r.index ?? '', costAdd: n(r['cost add']), costMult: n(r['cost mult']), enabled: n(r.enabled) === 1 && CLASSIC(r.version), ladder: n(r.ladder) === 1, rarity: n(r.rarity),
      noLimit: n(r.nolimit) === 1, lvl: n(r.lvl), lvlReq: n(r['lvl req']), code: r.code ?? '',
      mods: mods(r, 'prop#', 'par#', 'min#', 'max#', 12), invFile: r.invfile ?? '',
    }));
    const setVersion = new Map(t.sets.map((r) => [r.index ?? '', r.version]));
    for (const r of t.sets) {
      if (!r.index) continue;
      const partial: Mod[][] = [];
      for (const k of [2, 3, 4, 5]) partial.push([...mods(r, `PCode${k}a`, `PParam${k}a`, `PMin${k}a`, `PMax${k}a`, 1), ...mods(r, `PCode${k}b`, `PParam${k}b`, `PMin${k}b`, `PMax${k}b`, 1)]);
      this.sets.set(r.index, { name: r.name ?? r.index, partial, full: mods(r, 'FCode#', 'FParam#', 'FMin#', 'FMax#', 8) });
    }
    this.setItems = t.setitems.map((r, idx) => ({
      idx, name: r.index ?? '', costAdd: n(r['cost add']), costMult: n(r['cost mult']), set: r.set ?? '', code: r.item ?? '', rarity: n(r.rarity), lvl: n(r.lvl), lvlReq: n(r['lvl req']),
      mods: mods(r, 'prop#', 'par#', 'min#', 'max#', 9), addFunc: n(r['add func']), invFile: r.invfile ?? '',
      partial: [1, 2, 3, 4, 5].map((k) => [...mods(r, `aprop${k}a`, `apar${k}a`, `amin${k}a`, `amax${k}a`, 1), ...mods(r, `aprop${k}b`, `apar${k}b`, `amin${k}b`, `amax${k}b`, 1)]),
      ...(CLASSIC(setVersion.get(r.set ?? '')) && r.item ? {} : { rarity: -1 }),
    }));
    this.qualityItems = t.qualityitems.map((r) => ({
      mods: mods(r, 'mod#code', 'mod#param', 'mod#min', 'mod#max', 2),
      armor: n(r.armor) === 1, weapon: n(r.weapon) === 1, shield: n(r.shield) === 1, scepter: n(r.scepter) === 1, wand: n(r.wand) === 1,
      staff: n(r.staff) === 1, bow: n(r.bow) === 1, boots: n(r.boots) === 1, gloves: n(r.gloves) === 1, belt: n(r.belt) === 1,
    }));
    this.lowQualityNames = t.lowqualityitems.map((r) => r.Name ?? '').filter(Boolean);
    for (const r of t.properties) {
      if (!r.code) continue;
      const blocks: PropBlock[] = [];
      for (let i = 1; i <= 7; i++) if (r[`func${i}`]) blocks.push({ set: n(r[`set${i}`]), val: n(r[`val${i}`]), func: n(r[`func${i}`]), stat: r[`stat${i}`] ?? '' });
      this.props.set(r.code, blocks);
    }
    for (const r of t.itemstatcost) {
      if (!r.Stat) continue;
      this.valShift.set(r.Stat, n(r.ValShift));
      this.statCost.set(r.Stat, { add: n(r.Add), mult: n(r.Multiply), encode: n(r.Encode) });
    }
    for (const r of t.skills) if (r.Id) this.skillCost.set(n(r.Id), { add: n(r['cost add']), mult: n(r['cost mult']) });
    this.skillRows = t.skills;
    for (const r of t.gems ?? []) {
      if (!r.code) continue;
      this.gems.set(r.code, {
        code: r.code,
        weapon: mods(r, 'weaponMod#Code', 'weaponMod#Param', 'weaponMod#Min', 'weaponMod#Max', 3),
        helm: mods(r, 'helmMod#Code', 'helmMod#Param', 'helmMod#Min', 'helmMod#Max', 3),
        shield: mods(r, 'shieldMod#Code', 'shieldMod#Param', 'shieldMod#Min', 'shieldMod#Max', 3),
      });
    }
    for (const r of t.skills) {
      const cls = r.charclass;
      if (cls && !this.classFirstSkill.has(cls)) this.classFirstSkill.set(cls, n(r.Id));
    }
  }

  private isType(base: ItemBase, type: string): boolean {
    return this.items.isType(base, type);
  }

  private stackOrThrow(base: ItemBase): boolean {
    return base.stackable || [...this.items.typeChain(base.type)].some((t) => this.items.types.get(t)?.throwable);
  }

  // ---------------------------------------------------------------- 품질 분기

  /**
   * 품질 적용. 실패하면 원작 대체 순서로 내려간다. itemRng = 원작 아이템 시드 (품질 관련 굴림), unitRng = 유닛 시드 (하급 내구).
   */
  applyQuality(item: ItemInstance, base: ItemBase, quality: Quality, itemRng: Rng, unitRng: Rng, ctx: GenContext): void {
    const startSeed = itemRng.low;
    const typeDef = this.items.types.get(base.type);
    let q = quality;
    if (typeDef?.magic) q = base.quest ? QUALITY.UNIQUE : q >= QUALITY.MAGIC ? q : QUALITY.MAGIC;
    if (!typeDef?.rare && q === QUALITY.RARE) q = QUALITY.MAGIC;
    if (base.unique) q = QUALITY.UNIQUE;
    if (typeDef?.normal) q = QUALITY.NORMAL;
    const reset = () => {
      item.prefixes = [];
      item.suffixes = [];
      item.rareName = undefined;
      item.stats = [];
    };
    for (;;) {
      reset();
      if (q === QUALITY.UNIQUE) {
        if (this.rollUnique(item, base, itemRng, ctx)) break;
        if (item.maxDurability > 0) {
          item.durability = Math.min(item.durability * 3, 255);
          item.maxDurability = Math.min(base.durability * 3, 255);
        }
        q = QUALITY.RARE;
        continue;
      }
      if (q === QUALITY.SET) {
        if (this.rollSet(item, base, itemRng)) break;
        if (item.maxDurability > 0) {
          item.durability = Math.min(item.durability * 2, 255);
          item.maxDurability = Math.min(base.durability * 2, 255);
        }
        q = QUALITY.MAGIC;
        continue;
      }
      if (q === QUALITY.RARE) {
        if (this.items.types.get(base.type)?.rare && this.rollRare(item, base, itemRng)) break;
        q = QUALITY.MAGIC;
        continue;
      }
      if (q === QUALITY.MAGIC) {
        if (this.rollMagic(item, base, itemRng)) break;
        q = QUALITY.SUPERIOR;
        continue;
      }
      if (q === QUALITY.SUPERIOR) {
        if (this.rollSuperior(item, base, itemRng)) break;
        q = QUALITY.NORMAL;
        continue;
      }
      if (q === QUALITY.INFERIOR) {
        if (this.rollInferior(item, base, itemRng, unitRng)) break;
        q = QUALITY.NORMAL;
        continue;
      }
      break;
    }
    item.quality = q;
    if (q === QUALITY.NORMAL || q === QUALITY.SUPERIOR) this.rollSockets(item, base, itemRng, startSeed);
    if (q === QUALITY.NORMAL) this.staffMods(item, base, itemRng);
    this.finishStats(item, base);
  }

  /**
   * 품질을 굴리지 않고 정해서 붙인다 (개발용 프리셋 캐릭터). 유니크·세트 행 또는 매직/레어 접사 행을 지정하고, 가변 옵션은 최대값.
   * 요구 레벨은 굴림과 같은 규칙 (유니크·세트 lvl req, 접사 levelreq 중 큰 값). 감정된 상태로 만든다.
   */
  makeFixed(item: ItemInstance, base: ItemBase, spec: { uniqueIdx?: number; setIdx?: number; prefixes?: number[]; suffixes?: number[]; rareName?: [number, number] }): void {
    const max = new MaxRng();
    item.stats = [];
    item.prefixes = [...(spec.prefixes ?? [])];
    item.suffixes = [...(spec.suffixes ?? [])];
    item.rareName = undefined;
    if (spec.uniqueIdx !== undefined) {
      const u = this.uniques[spec.uniqueIdx];
      if (!u) throw new Error(`unique row not found: ${spec.uniqueIdx}`);
      item.quality = QUALITY.UNIQUE;
      item.uniqueIdx = u.idx;
      item.levelReq = Math.max(item.levelReq, u.lvlReq);
      this.assignMods(item, base, u.mods, max);
    } else if (spec.setIdx !== undefined) {
      const s = this.setItems[spec.setIdx];
      if (!s) throw new Error(`set item row not found: ${spec.setIdx}`);
      item.quality = QUALITY.SET;
      item.setIdx = s.idx;
      item.levelReq = Math.max(item.levelReq, s.lvlReq);
      this.assignMods(item, base, s.mods, max);
    } else {
      item.quality = spec.rareName ? QUALITY.RARE : QUALITY.MAGIC;
      if (spec.rareName) item.rareName = spec.rareName;
      for (const i of item.prefixes) this.assignMods(item, base, this.prefixes[i]?.mods ?? [], max);
      for (const i of item.suffixes) this.assignMods(item, base, this.suffixes[i]?.mods ?? [], max);
    }
    item.identified = true;
    this.finishStats(item, base);
  }

  // ---------------------------------------------------------------- 매직

  /** alvl. 출처: ITEMS_ComputeCraftedMagicAffixLevel */
  affixLevel(ilvl: number, base: ItemBase): number {
    const q = base.level;
    const L = Math.max(ilvl, q);
    let alvl: number;
    if (base.magicLvl) alvl = L + base.magicLvl;
    else {
      const h = Math.trunc(q / 2);
      alvl = L >= 99 - h ? 2 * L - 99 : L - h;
    }
    return Math.max(1, Math.min(99, alvl));
  }

  private affixAllowed(a: MagicAffix, base: ItemBase, item: ItemInstance, alvl: number, forRare: boolean): boolean {
    if (!a.spawnable || !a.frequency) return false;
    if (a.level > alvl || (a.maxLevel && alvl > a.maxLevel)) return false;
    if (forRare && !a.rare) return false;
    // 클래식: 겹치는·투척 아이템은 접사 불가, 소켓 속성 접사 제외
    if (this.stackOrThrow(base)) return false;
    if (a.mods[0] && this.props.get(a.mods[0].code)?.[0]?.stat === 'item_numsockets') return false;
    if (a.etypes.some((t) => this.isType(base, t))) return false;
    if (!a.itypes.some((t) => this.isType(base, t))) return false;
    if (a.classSpecific) {
      const cls = [...this.items.typeChain(base.type)].map((t) => this.items.types.get(t)?.classCode).find(Boolean);
      if (cls && cls !== a.classSpecific) return false;
    }
    const groups = [...item.prefixes.map((i) => this.prefixes[i]?.group), ...item.suffixes.map((i) => this.suffixes[i]?.group)];
    if (a.group && groups.includes(a.group)) return false;
    return true;
  }

  /** 출처: ITEMS_RollMagicAffixesNew — rand(2) 가 0 이고 강제가 아니면 없음, 가중치 뽑기 rand(합+1) (끝까지 못 가면 마지막 후보) */
  private rollAffix(item: ItemInstance, base: ItemBase, rng: Rng, prefix: boolean, force: boolean, forRare: boolean): MagicAffix | null {
    const odd = rng.pick(2);
    if (!odd && !force) return null;
    const alvl = this.affixLevel(item.ilvl, base);
    const list = (prefix ? this.prefixes : this.suffixes).filter((a) => this.affixAllowed(a, base, item, alvl, forRare)).slice(0, 511);
    if (!list.length) return null;
    const weight = (a: MagicAffix) => (base.magicLvl ? a.level * a.frequency : a.frequency);
    const total = list.reduce((s, a) => s + weight(a), 0);
    let r = rng.pick(total + 1);
    for (const a of list) {
      r -= weight(a);
      if (r < 0) return a;
    }
    return list[list.length - 1] ?? null;
  }

  private rollMagic(item: ItemInstance, base: ItemBase, rng: Rng): boolean {
    const p = this.rollAffix(item, base, rng, true, false, false);
    if (p) {
      item.prefixes = [p.idx];
      this.assignMods(item, base, p.mods, rng);
    }
    const s = this.rollAffix(item, base, rng, false, !p, false);
    if (s) {
      item.suffixes = [s.idx];
      this.assignMods(item, base, s.mods, rng);
    }
    if (!p && !s) return false;
    item.identified = false;
    this.staffMods(item, base, rng);
    return true;
  }

  // ---------------------------------------------------------------- 레어

  private rollRare(item: ItemInstance, base: ItemBase, rng: Rng): boolean {
    const pick = (list: RareAffix[]) => {
      const c = list.filter((a) => !this.stackOrThrow(base) && !a.etypes.some((t) => this.isType(base, t)) && a.itypes.some((t) => this.isType(base, t)));
      return c.length ? (c[rng.pick(c.length)] as RareAffix) : null;
    };
    const rp = pick(this.rarePrefixes), rs = pick(this.rareSuffixes);
    if (!rp || !rs) return false;
    item.rareName = [rp.idx, rs.idx];
    const count = [3, 4, 4, 5, 5, 5, 6, 6][Number(rng.next() & 7n) & 7] as number;
    let pDone = false, sDone = false;
    const chosen: { a: MagicAffix }[] = [];
    for (let i = 0; i < count && !(pDone && sDone); i++) {
      const suffix = !sDone && (pDone || (Number(rng.next() & 0xffffffffn) & 1) === 1);
      const a = this.rollAffix(item, base, rng, !suffix, true, true);
      if (!a) {
        if (suffix) sDone = true;
        else pDone = true;
        i--;
        continue;
      }
      if (suffix) {
        item.suffixes.push(a.idx);
        if (item.suffixes.length >= 3) sDone = true;
      } else {
        item.prefixes.push(a.idx);
        if (item.prefixes.length >= 3) pDone = true;
      }
      chosen.push({ a });
    }
    if (!item.prefixes.length && !item.suffixes.length) return false;
    item.identified = false;
    // 속성 굴림 순서: 접두0, 접미0, 접두1, 접미1 … (출처: D2GAME_RollRareItem)
    for (let k = 0; k < 3; k++) {
      const p = item.prefixes[k], s = item.suffixes[k];
      if (p !== undefined) this.assignMods(item, base, this.prefixes[p]?.mods ?? [], rng);
      if (s !== undefined) this.assignMods(item, base, this.suffixes[s]?.mods ?? [], rng);
    }
    this.staffMods(item, base, rng);
    return true;
  }

  // ---------------------------------------------------------------- 유니크 · 세트

  private rollUnique(item: ItemInstance, base: ItemBase, rng: Rng, ctx: GenContext): boolean {
    const cands = this.uniques.filter((u) => u.enabled && u.code === base.code && !u.ladder && u.lvl <= item.ilvl);
    if (!cands.length) return base.unique;
    const total = cands.reduce((s, u) => s + Math.max(u.rarity, 1), 0);
    let r = rng.pick(total);
    let pick = cands[cands.length - 1] as UniqueDef;
    for (const u of cands) {
      if (r < Math.max(u.rarity, 1)) {
        pick = u;
        break;
      }
      r -= Math.max(u.rarity, 1);
    }
    if (ctx.droppedUniques.has(pick.idx) && !base.quest) return false;
    if (!pick.noLimit) ctx.droppedUniques.add(pick.idx);
    item.uniqueIdx = pick.idx;
    item.identified = false;
    item.levelReq = Math.max(item.levelReq, pick.lvlReq);
    this.assignMods(item, base, pick.mods, rng);
    return true;
  }

  private rollSet(item: ItemInstance, base: ItemBase, rng: Rng): boolean {
    const cands = this.setItems.filter((s) => s.rarity >= 0 && s.code === base.code && s.lvl <= item.ilvl);
    if (!cands.length) return false;
    const w = (s: SetItemDef) => s.rarity || 1;
    let r = rng.pick(cands.reduce((a, s) => a + w(s), 0));
    let pick = cands[cands.length - 1] as SetItemDef;
    for (const s of cands) {
      if (r < w(s)) {
        pick = s;
        break;
      }
      r -= w(s);
    }
    item.setIdx = pick.idx;
    item.identified = false;
    item.levelReq = Math.max(item.levelReq, pick.lvlReq);
    this.assignMods(item, base, pick.mods, rng);
    return true;
  }

  // ---------------------------------------------------------------- 상급 · 하급

  private canBeSuperior(q: QualityItemDef, base: ItemBase): boolean {
    const t = (c: string) => this.isType(base, c);
    const special = t('staf') || t('bow') || t('xbow') || t('scep') || t('wand');
    if (q.weapon && t('weap') && !special) return true;
    const armorSpecial = t('shie') || t('boot') || t('glov') || t('belt');
    if (q.armor && t('armo') && !armorSpecial) return true;
    const checks: [boolean, string][] = [[q.shield, 'shie'], [q.scepter, 'scep'], [q.wand, 'wand'], [q.staff, 'staf'], [q.bow, 'bow'], [q.bow, 'xbow'], [q.boots, 'boot'], [q.gloves, 'glov'], [q.belt, 'belt']];
    return checks.some(([f, c]) => f && t(c));
  }

  private rollSuperior(item: ItemInstance, base: ItemBase, rng: Rng): boolean {
    let count = this.qualityItems.length;
    if (this.stackOrThrow(base) || base.noDurability) count = Math.min(count, 4);
    const tried = new Set<number>();
    while (tried.size < count) {
      let idx = rng.pick(count);
      while (tried.has(idx)) idx = rng.pick(count);
      const q = this.qualityItems[idx] as QualityItemDef;
      if (this.canBeSuperior(q, base)) {
        item.superiorIdx = idx;
        this.assignMods(item, base, q.mods, rng, true);
        this.staffMods(item, base, rng);
        return true;
      }
      tried.add(idx);
    }
    return false;
  }

  /** 하급: 이름 무작위, 내구 = 기본/3 굴림(유닛 시드), 무기 피해·방어 75%. 출처: sub_6FC549F0 */
  private rollInferior(item: ItemInstance, base: ItemBase, rng: Rng, unitRng: Rng): boolean {
    const isWeapon = this.isType(base, 'weap'), isArmor = this.isType(base, 'armo');
    if (!isWeapon && !isArmor) return false;
    item.lowQualityIdx = rng.pick(Math.max(1, this.lowQualityNames.length));
    if (item.maxDurability > 0) {
      const md = Math.max(Math.trunc(base.durability / 3), 1);
      item.maxDurability = md;
      item.durability = Math.max(unitRng.pick(Math.trunc(md / 2)) + Math.trunc(md / 2), 1);
    }
    if (isArmor) item.defense = Math.max(Math.trunc((75 * item.defense) / 100), 1);
    if (isWeapon) item.inferiorDamage = true;
    this.staffMods(item, base, rng, 4);
    return true;
  }

  // ---------------------------------------------------------------- 소켓 · 지팡이 스킬

  private rollSockets(item: ItemInstance, base: ItemBase, rng: Rng, startSeed: number): void {
    if (!base.hasInv || base.stackable) return;
    const def = [...this.items.typeChain(base.type)].map((t) => this.items.types.get(t)).find((d) => d && (d.maxSock[0] || d.maxSock[1] || d.maxSock[2]));
    const tierIdx = item.ilvl <= 25 ? 0 : item.ilvl <= 40 ? 1 : 2;
    let maxS = Math.min(base.gemSockets, def?.maxSock[tierIdx] ?? 0);
    maxS = Math.min(maxS, 3); // Normal 난이도 최대 3
    if (maxS <= 0) return;
    // 클래식: 몸통 갑옷은 소켓 굴림 자체가 없다
    if (this.isType(base, 'tors')) return;
    if (Number(rng.next() & 0xffffffffn) % 100 >= 33) return;
    const cap = Math.min(6, base.invWidth * base.invHeight, maxS);
    item.sockets = Math.max(1, Math.min(cap, (startSeed >>> 0) % maxS + 1));
    item.stats.push({ stat: 'item_numsockets', param: 0, value: item.sockets });
  }

  /**
   * 지팡이 스킬 (staffmods): itemtypes StaffMods 클래스의 스킬 +1~3 을 0~3 개.
   * 출처: sub_6FC52650 — 개수 rand%100 > 90: 3, > 70: 2, > 30: 1 / 등급 ilvl > 24: 4, > 18: 3, > 11: 2, 그 외 1
   */
  private staffMods(item: ItemInstance, base: ItemBase, rng: Rng, capTier = 99): void {
    const cls = [...this.items.typeChain(base.type)].map((t) => this.items.types.get(t)?.staffMods).find(Boolean);
    const first = cls ? this.classFirstSkill.get(cls) : undefined;
    if (first === undefined) return;
    if (item.stats.some((s) => s.stat === 'item_singleskill')) return;
    const r = Number(rng.next() & 0xffffffffn) % 100;
    const count = r > 90 ? 3 : r > 70 ? 2 : r > 30 ? 1 : 0;
    const baseTier = item.ilvl > 24 ? 4 : item.ilvl > 18 ? 3 : item.ilvl > 11 ? 2 : 1;
    const used = new Set<number>();
    for (let k = 0; k < count; k++) {
      const t = Number(rng.next() & 0xffffffffn) % 100;
      let tier = t > 80 ? baseTier + 1 : t > 30 ? baseTier : t > 10 ? baseTier - 1 : baseTier - 2;
      tier = Math.max(1, Math.min(tier, capTier));
      let skill = first;
      for (let tryN = 0; tryN < 6; tryN++) {
        skill = first + 5 * (tier - 1) + (Number(rng.next() & 0xffffffffn) % 5);
        const row = this.skillRows.find((x) => n(x.Id) === skill);
        const itypeOk = !row?.itypea1 || this.isType(base, row.itypea1);
        if (itypeOk && !used.has(skill)) break;
      }
      used.add(skill);
      const v = Number(rng.next() & 0xffffffffn) % 100;
      item.stats.push({ stat: 'item_singleskill', param: skill, value: v >= 90 ? 3 : v >= 60 ? 2 : 1 });
    }
  }

  // ---------------------------------------------------------------- 속성 → 스탯

  /** 값 굴림. 출처: ITEMMODS_RollRandomValueInRange */
  private rollValue(min: number, max: number, rng: Rng): number {
    if (min === max) return min;
    const lo = Math.min(min, max), hi = Math.max(min, max);
    return lo + rng.pick(hi - lo + 1);
  }

  /**
   * 속성 목록을 아이템 스탯으로 (properties.txt func).
   * func 1·2·4 굴림 → stat, 3 앞 값 재사용, 5·6 최소/최대 피해 더하기, 7 피해% (min%·max% 둘 다), 8 속도,
   * 13 내구%, 14 소켓, 15 min 만, 16 max 만, 17 param 을 값(지속), 21 클래스 스킬(val = 클래스), 22 단일 스킬(param = 스킬),
   * 10·11·12·19·24 (스킬 탭·발동·충전) 은 스탯만 기록
   */
  assignMods(item: ItemInstance, base: ItemBase, list: Mod[], rng: Rng, quality = false): void {
    for (const m of list) {
      const blocks = this.props.get(m.code);
      if (!blocks) continue;
      let prev = 0;
      const param = Number(m.param) || 0;
      for (const b of blocks) {
        let v = 0;
        switch (b.func) {
          case 1: case 2: case 4: case 8: case 13: case 14:
            v = this.rollValue(m.min, m.max, rng);
            break;
          case 3:
            v = prev || this.rollValue(m.min, m.max, rng);
            break;
          case 5: case 6: case 7:
            v = prev || this.rollValue(m.min, m.max, rng);
            break;
          case 15: v = m.min; break;
          case 16: v = m.max; break;
          case 17: v = param || this.rollValue(m.min, m.max, rng); break;
          case 21: v = this.rollValue(m.min, m.max, rng); break;
          default: v = this.rollValue(m.min, m.max, rng);
        }
        prev = v;
        if (!v) continue;
        switch (b.func) {
          case 5: this.add(item, 'mindamage', 0, v); break;
          case 6: this.add(item, 'maxdamage', 0, v); break;
          case 7:
            this.add(item, 'item_mindamage_percent', 0, v);
            this.add(item, 'item_maxdamage_percent', 0, v);
            break;
          case 13: this.add(item, 'item_maxdurability_percent', 0, v); break;
          case 14:
            item.sockets = Math.max(item.sockets, v);
            this.add(item, 'item_numsockets', 0, v);
            break;
          case 21: this.add(item, b.stat, b.val, v); break;
          case 22: case 11: case 12: case 19: case 24: this.add(item, b.stat, param, v); break;
          default: if (b.stat) this.add(item, b.stat, param, v);
        }
        // 방어% 또는 (상급의) 방어 → 기본 방어 = maxac + 1 (출처: sub_6FD92CF0)
        if ((b.func === 2 || (quality && b.stat === 'armorclass')) && (b.stat === 'item_armor_percent' || b.stat === 'armorclass') && this.isType(base, 'armo') && base.maxAc) {
          item.defense = Math.max(item.defense + 1, base.maxAc + 1);
          item.edDefenseBase = true;
        }
      }
    }
  }

  private add(item: ItemInstance, stat: string, param: number, value: number): void {
    const cur = item.stats.find((s) => s.stat === stat && s.param === param);
    if (cur) cur.value += value;
    else item.stats.push({ stat, param, value });
  }

  /** 아이템 자체에 반영되는 값: 내구% (최대 내구), 요구 레벨(접사) */
  private finishStats(item: ItemInstance, base: ItemBase): void {
    const dur = statOf(item, 'item_maxdurability_percent'), flat = statOf(item, 'maxdurability');
    if (item.maxDurability > 0 && (dur || flat)) {
      const md = Math.min(255, item.maxDurability + Math.trunc((item.maxDurability * dur) / 100) + flat);
      item.durability += md - item.maxDurability;
      item.maxDurability = md;
    }
    for (const i of item.prefixes) item.levelReq = Math.max(item.levelReq, this.prefixes[i]?.levelReq ?? 0);
    for (const i of item.suffixes) item.levelReq = Math.max(item.levelReq, this.suffixes[i]?.levelReq ?? 0);
    void base;
  }
}

/**
 * 소켓에 박힌 보석의 속성: 무기면 weaponMod, 방패면 shieldMod, 그 외(투구·몸통 갑옷)는 helmMod.
 * 출처: gems.txt 컬럼, D2MOO ITEMMODS_AssignProperty PROPMODE_GEM (gemapplytype)
 */
export function gemStats(gen: ItemGen, gem: ItemInstance, target: ItemBase): ItemStat[] {
  const g = gen.gems.get(gem.code);
  if (!g) return [];
  const list = gen.items.isType(target, 'weap') ? g.weapon : gen.items.isType(target, 'shld') ? g.shield : g.helm;
  const tmp: ItemInstance = { ...gem, stats: [], socketed: [] };
  gen.assignMods(tmp, target, list, new Rng(1));
  return tmp.stats;
}

export const statOf = (item: ItemInstance, stat: string, param = 0): number => {
  let v = 0;
  for (const s of item.stats) if (s.stat === stat && s.param === param) v += s.value;
  return v;
};

export type { ItemStat };
