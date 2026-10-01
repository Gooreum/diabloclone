// 아이템 이름·설명 줄 (툴팁). 문자열은 원작 string.tbl, 설명 방식은 itemstatcost.txt descfunc/descval/descstrpos/descpriority.
// 출처: Phrozen Keep — ItemStatCost.txt File Guide: descfunc (1 +값, 2 값%, 3 값, 4 +값%, 5 값×100/128%, 12 +값, 13 클래스 스킬, 20 −값%,
//       27 단일 스킬), descval (0 값 없음, 1 값 앞, 2 값 뒤), descpriority 가 클수록 위 (https://d2mods.info/forum/kb/viewarticle?a=380)
// 출처: 원작 아이템 이름 규칙 — 상급 "Superior <기본>", 하급 "<Crude…> <기본>", 매직 "<접두> <기본> <접미>", 레어·유니크·세트는 이름 + 둘째 줄 기본 이름
import type { TxtRow } from '../formats/txt';
import type { ItemDb } from '../engine/items';
import type { ItemGen } from '../engine/itemgen';
import { statOf } from '../engine/itemgen';
import { armorDefense, etherealBase, weaponDamage } from '../engine/charstats';
import { requirements } from '../engine/inventory';
import { QUALITY, type ItemInstance } from '../engine/treasure';
import type { RunewordDb } from '../engine/runewords';

export const QUALITY_COLOR: Record<number, string> = {
  [QUALITY.INFERIOR]: '#8c8c8c', [QUALITY.NORMAL]: '#ffffff', [QUALITY.SUPERIOR]: '#ffffff',
  [QUALITY.MAGIC]: '#6969ff', [QUALITY.SET]: '#00c400', [QUALITY.RARE]: '#ffff64', [QUALITY.UNIQUE]: '#c7b377',
  // 제작 (확장팩) — 원작 주황 (근사: 글꼴 색표 orange 값 미확인)
  [QUALITY.CRAFTED]: '#ffa800',
};

export interface TextLine { text: string; color: string }

const white0 = '#ffffff';

interface StatDesc { func: number; val: number; pos: string; neg: string; str2: string; priority: number }

export class ItemText {
  private readonly items: ItemDb;
  private readonly gen: ItemGen | null;
  private readonly str: (k: string) => string;
  private readonly desc = new Map<string, StatDesc>();
  private readonly classSkillsStr = new Map<number, string>();
  private readonly skillName = new Map<number, { name: string; cls: string }>();
  /** 룬워드 이름 (확장팩) — main 이 GameData.runewords 를 넣는다 */
  runewords?: RunewordDb;

  constructor(items: ItemDb, gen: ItemGen | null, str: (k: string) => string, itemstatcost: TxtRow[], charstats: TxtRow[], skills: TxtRow[], skilldesc: TxtRow[]) {
    this.items = items;
    this.gen = gen;
    this.str = str;
    for (const r of itemstatcost) {
      if (!r.Stat || !r.descfunc) continue;
      this.desc.set(r.Stat, { func: Number(r.descfunc), val: Number(r.descval || 0), pos: r.descstrpos ?? '', neg: r.descstrneg ?? '', str2: r.descstr2 ?? '', priority: Number(r.descpriority || 0) });
    }
    // 클래스 Id 순서 = charstats 행 순서 (Amazon 0 … Barbarian 4)
    charstats.forEach((r, i) => r.StrAllSkills && this.classSkillsStr.set(i, str(r.StrAllSkills)));
    const descs = new Map(skilldesc.map((d) => [d.skilldesc ?? '', d]));
    const clsName: Record<string, string> = { ama: 'Amazon', sor: 'Sorceress', nec: 'Necromancer', pal: 'Paladin', bar: 'Barbarian' };
    for (const r of skills) {
      const d = descs.get(r.skilldesc ?? '');
      this.skillName.set(Number(r.Id), { name: d?.['str name'] ? str(d['str name']) : (r.skill ?? ''), cls: clsName[r.charclass ?? ''] ?? '' });
    }
  }

  baseName(item: ItemInstance): string {
    const b = this.items.base(item.code);
    return b ? this.str(b.namestr) : item.code;
  }

  /** 첫 줄 이름 (감정 전 매직 이상은 기본 이름) */
  name(item: ItemInstance): string {
    const base = this.baseName(item);
    const g = this.gen;
    if (item.code === 'gld') return `${item.quantity} ${this.str('gold')}`;
    if (!item.identified && item.quality >= QUALITY.MAGIC) return base;
    const rw = this.runewords?.get(item.runeword);
    if (rw) {
      const s = this.str(rw.key);
      return s && s !== rw.key ? s : rw.name;
    }
    switch (item.quality) {
      case QUALITY.INFERIOR: return `${this.str(g?.lowQualityNames[item.lowQualityIdx ?? 0] ?? '')} ${base}`;
      case QUALITY.SUPERIOR: return `${this.str('Hiquality')} ${base}`;
      case QUALITY.MAGIC: {
        const p = item.prefixes[0] !== undefined ? this.str(g?.prefixes[item.prefixes[0]]?.name ?? '') : '';
        const s = item.suffixes[0] !== undefined ? this.str(g?.suffixes[item.suffixes[0]]?.name ?? '') : '';
        return [p, base, s].filter(Boolean).join(' ');
      }
      case QUALITY.RARE:
      case QUALITY.CRAFTED: {
        const [a, b] = item.rareName ?? [0, 0];
        return `${this.str(g?.rarePrefixes[a]?.name ?? '')} ${this.str(g?.rareSuffixes[b]?.name ?? '')}`;
      }
      case QUALITY.UNIQUE: return this.str(g?.uniques[item.uniqueIdx ?? -1]?.name ?? base);
      case QUALITY.SET: return this.str(g?.setItems[item.setIdx ?? -1]?.name ?? base);
      default: return base;
    }
  }

  /** 스탯 한 줄 */
  statLine(stat: string, value: number, param: number, clvl = 1): string | null {
    const d = this.desc.get(stat);
    if (!d) return null;
    const txt = this.str(value < 0 && d.neg ? d.neg : d.pos);
    const sgn = (v: number) => (v >= 0 ? `+${v}` : `${v}`);
    const place = (v: string) => (d.val === 0 ? txt : d.val === 1 ? `${v} ${txt}` : `${txt} ${v}`);
    switch (d.func) {
      case 1: case 12: return place(sgn(value));
      case 2: return place(`${value}%`);
      case 3: return place(`${value}`);
      case 4: return place(`${sgn(value)}%`);
      case 5: return place(`${Math.trunc((value * 100) / 128)}%`);
      case 6: return `${place(sgn(Math.trunc((value * clvl) / 8)))} ${this.str(d.str2)}`;
      case 7: return `${place(`${Math.trunc((value * clvl) / 8)}%`)} ${this.str(d.str2)}`;
      case 8: return `${place(`${sgn(Math.trunc((value * clvl) / 8))}%`)} ${this.str(d.str2)}`;
      case 13: return `+${value} ${this.classSkillsStr.get(param) ?? txt}`;
      case 20: return place(`-${value}%`);
      case 27: case 28: {
        const sk = this.skillName.get(param);
        return sk ? `+${value} to ${sk.name}${d.func === 27 && sk.cls ? ` (${sk.cls} Only)` : ''}` : null;
      }
      default: return place(`${value}`);
    }
  }

  /** 툴팁 전체 줄 */
  lines(item: ItemInstance, ctx: { level: number; str: number; dex: number; cls: string }): TextLine[] {
    const b = this.items.base(item.code);
    const rw = this.runewords?.get(item.runeword);
    const gold = QUALITY_COLOR[QUALITY.UNIQUE] as string, grey = '#8c8c8c';
    // 룬워드: 이름 금색, 기본 이름 회색, 룬 글자 'TalEth' 금색 (원작 툴팁 — 근사: 회색 값은 글꼴 색표 미확인)
    const color = rw ? gold : (QUALITY_COLOR[item.quality] ?? '#fff');
    const out: TextLine[] = [{ text: this.name(item), color }];
    if (!b) return out;
    if (rw) {
      out.push({ text: this.baseName(item), color: grey });
      out.push({ text: `'${item.socketed.map((g) => this.gen?.gems.get(g.code)?.letter ?? '').join('')}'`, color: gold });
    } else if (item.identified && ([QUALITY.RARE, QUALITY.UNIQUE, QUALITY.SET, QUALITY.CRAFTED] as number[]).includes(item.quality)) out.push({ text: this.baseName(item), color });
    // 참·주얼·룬 안내 줄 (string.tbl Charmdes · ExInsertSockets) — 근사(원작 미확인): 줄 위치는 이름 바로 아래
    if (this.items.isType(b, 'char')) out.push({ text: this.str('Charmdes'), color: white0 });
    else if (this.items.isType(b, 'jewl') || this.items.isType(b, 'rune')) out.push({ text: this.str('ExInsertSockets'), color: white0 });
    const white = '#ffffff', red = '#ff5050', blue = '#6969ff';
    if (b.category === 'armor' && item.defense) out.push({ text: `${this.str('ItemStats1h')} ${armorDefense(item)}`, color: statOf(item, 'item_armor_percent') || statOf(item, 'armorclass') ? blue : white });
    if (this.items.isType(b, 'weap')) {
      const d = weaponDamage(item, b);
      const two = b.maxDam === 0 && b.twoHandMaxDam > 0;
      out.push({ text: `${this.str(two ? 'ItemStats1m' : 'ItemStats1l')} ${d.min} ${this.str('ItemStast1k')} ${d.max}`, color: white });
      if (b.throwMaxDam) out.push({ text: `${this.str('ItemStats1n')} ${etherealBase(item, b.throwMinDam)} ${this.str('ItemStast1k')} ${etherealBase(item, b.throwMaxDam)}`, color: white });
    }
    if (b.stackable && item.quantity > 0) out.push({ text: `${this.str('ItemStats1i')} ${item.quantity}`, color: white });
    if (item.maxDurability > 0) out.push({ text: `${this.str('ItemStats1d')} ${item.durability} ${this.str('ItemStats1j')} ${item.maxDurability}`, color: white });
    const req = requirements(this.items, item);
    if (req.str) out.push({ text: `${this.str('ItemStats1e')} ${req.str}`, color: ctx.str >= req.str ? white : red });
    if (req.dex) out.push({ text: `${this.str('ItemStats1f')} ${req.dex}`, color: ctx.dex >= req.dex ? white : red });
    if (req.level > 1) out.push({ text: `${this.str('ItemStats1p')} ${req.level}`, color: ctx.level >= req.level ? white : red });
    if (!item.identified) {
      out.push({ text: this.str('ItemStats1b'), color: red });
      return out;
    }
    const stats = [...item.stats, ...item.socketed.flatMap((g) => g.stats)].filter((s) => s.stat !== 'item_numsockets');
    stats.sort((a, c) => (this.desc.get(c.stat)?.priority ?? 0) - (this.desc.get(a.stat)?.priority ?? 0));
    for (const s of stats) {
      const t = this.statLine(s.stat, s.value, s.param, ctx.level);
      if (t) out.push({ text: t, color: blue });
    }
    // 이더리얼·소켓 줄: 원작 "Ethereal (Cannot be Repaired), Socketed (n)"
    // 근사(원작 미확인): "Ethereal (Cannot be Repaired)" 는 string.tbl 키를 찾지 못해 영문 고정
    const eth = item.ethereal ? 'Ethereal (Cannot be Repaired)' : '';
    const sock = item.sockets ? `${this.str('Socketable')} (${item.sockets})` : '';
    if (eth || sock) out.push({ text: [eth, sock].filter(Boolean).join(', '), color: blue });
    return out;
  }
}
