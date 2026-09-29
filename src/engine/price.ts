// 상점 가격: 사기(buy) · 팔기(sell) · 수리(repair).
// 출처: D2MOO D2Common/src/Items/Items.cpp — ITEMS_CalculateTransactionCost, ITEMS_CalculateAdditionalCostsForBonusStats,
//       ITEMS_CalculateAdditionalCostsForItemSkill, ITEMS_IsRepairable
// 주의: 원작 변수 이름은 NPC 기준 — nSellCost = NPC 가 파는 값(플레이어가 사는 값), nBuyCost = NPC 가 사는 값(플레이어가 파는 값).
// 원작은 32비트 정수 연산(곱셈 오버플로를 피하려고 65535 초과 시 곱셈 순서를 바꿈) — 여기서는 JS 정수로 같은 순서의 나눗셈 절단만 재현.
import type { ItemBase, ItemDb } from './items';
import type { ItemGen } from './itemgen';
import { QUALITY, type ItemInstance } from './treasure';
import type { TxtRow } from '../formats/txt';

export type Transaction = 'buy' | 'sell' | 'repair';

/** npc.txt 한 행 (배수는 1/1024) */
export interface NpcPrice {
  sellMult: number; buyMult: number; repMult: number;
  quest: { flag: number; sellMult: number; buyMult: number; repMult: number }[];
  /** 난이도별 최대 매입가 (max buy / (N) / (H)) */
  maxBuy: [number, number, number];
}

const n = (v: string | undefined) => Number(v ?? 0) || 0;

export function parseNpcPrices(rows: TxtRow[]): Map<string, NpcPrice> {
  const out = new Map<string, NpcPrice>();
  for (const r of rows) {
    if (!r.npc) continue;
    out.set(r.npc, {
      sellMult: n(r['sell mult']), buyMult: n(r['buy mult']), repMult: n(r['rep mult']),
      quest: ['A', 'B', 'C'].map((k) => ({ flag: n(r[`questflag ${k}`]), sellMult: n(r[`questsellmult ${k}`]), buyMult: n(r[`questbuymult ${k}`]), repMult: n(r[`questrepmult ${k}`]) })),
      maxBuy: [n(r['max buy']), n(r['max buy (N)']), n(r['max buy (H)'])],
    });
  }
  return out;
}

export interface PriceCtx {
  items: ItemDb;
  gen: ItemGen | null;
  npc: NpcPrice;
  difficulty: 0 | 1 | 2;
  /** books.txt: 책 코드 → CostPerCharge */
  bookCharge?: Map<string, number>;
  /** 퀘스트 보상을 받은(또는 대기) 퀘스트 플래그 */
  questDone?: (flag: number) => boolean;
  /** 가격 할인 % (item_reducedprices — 확장팩 스탯, 클래식은 0) */
  reducePct?: number;
}

export function parseBookCharges(rows: TxtRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (r.BookSpellCode) m.set(r.BookSpellCode, n(r.CostPerCharge));
  return m;
}

const hasDurability = (b: ItemBase, it: ItemInstance) => !b.noDurability && b.durability > 0 && it.maxDurability > 0;

/** 부서짐: 내구도가 있는 아이템의 내구 0 (출처: ITEMS_UpdateDurability — 내구 0 이면 IFLAG_BROKEN / 내구 0) */
export const isBroken = (it: ItemInstance) => it.maxDurability > 0 && it.durability <= 0;

/**
 * 수리 가능: 감정됨 + itemtypes Repair, 그리고 (투척 무기 스택 또는 내구도 있음).
 * 출처: ITEMS_IsRepairable (충전 스킬 조건은 충전 스킬 구현 시)
 */
export function isRepairable(items: ItemDb, it: ItemInstance): boolean {
  const b = items.base(it.code);
  if (!b || !it.identified) return false;
  const t = items.types.get(b.type);
  if (!t?.repair) return false;
  if (t.throwable && b.stackable) return true;
  return hasDurability(b, it);
}

/** 수리가 필요한가 (내구 부족 또는 투척 무기 수량 부족) */
export function needsRepair(items: ItemDb, it: ItemInstance): boolean {
  const b = items.base(it.code);
  if (!b || !isRepairable(items, it)) return false;
  if (hasDurability(b, it) && it.durability < it.maxDurability) return true;
  return b.stackable && it.quantity < Math.min(b.maxStack, 511);
}

interface Triple { s: number; b: number; r: number }

/** 스탯 가격: add + v × x × multiply / 1024 (스킬 encode 1/2/3 은 skills cost add/mult, 파는 값은 /4096) */
function bonusStats(item: ItemInstance, gen: ItemGen, x: Triple, div: number): Triple {
  const acc = { s: 0, b: 0, r: 0 };
  for (const st of item.stats) {
    const v = st.value;
    if (!v) continue;
    const c = gen.statCost.get(st.stat);
    if (!c) continue;
    if (c.encode >= 1 && c.encode <= 3) {
      // encode 1: param = 스킬, 값 = 수치 / encode 2·3: param = 스킬, 값 = 스킬 레벨 (근사: 레벨 분리 없이 값 사용)
      const sk = gen.skillCost.get(st.param);
      if (!sk) continue;
      acc.s += sk.add + Math.trunc((v * x.s * sk.mult) / 1024);
      acc.b += sk.add + Math.trunc((v * sk.mult * x.b) / 4096);
      acc.r += sk.add + Math.trunc((v * sk.mult * x.r) / 1024);
      continue;
    }
    acc.s += c.add + Math.trunc((v * x.s * c.mult) / 1024);
    acc.b += c.add + Math.trunc((v * c.mult * x.b) / 1024);
    acc.r += c.add + Math.trunc((v * c.mult * x.r) / 1024);
  }
  return { s: x.s + Math.trunc(acc.s / div), b: x.b + Math.trunc(acc.b / div), r: x.r + Math.trunc(acc.r / div) };
}

/** 지팡이 스킬(item_singleskill): (2 × 레벨 − 1) × (cost add + x × cost mult / 1024), 파는 값은 /4096 */
function itemSkill(item: ItemInstance, ctx: PriceCtx, b: ItemBase, x: Triple, div: number): Triple {
  const gen = ctx.gen;
  if (!gen || !ctx.items.types.get(b.type)?.staffMods) return x;
  const acc = { s: 0, b: 0, r: 0 };
  for (const st of item.stats) {
    if (st.stat !== 'item_singleskill') continue;
    const sk = gen.skillCost.get(st.param);
    if (!sk) continue;
    const k = 2 * st.value - 1;
    acc.s += k * (sk.add + Math.trunc((sk.mult * x.s) / 1024));
    acc.b += k * (sk.add + Math.trunc((sk.mult * x.b) / 4096));
    acc.r += k * (sk.add + Math.trunc((sk.mult * x.r) / 1024));
  }
  return { s: x.s + Math.trunc(acc.s / div), b: x.b + Math.trunc(acc.b / div), r: x.r + Math.trunc(acc.r / div) };
}

/** 가격. 수리할 수 없는 아이템의 수리비는 0, 결과는 최소 1 */
export function transactionCost(item: ItemInstance, kind: Transaction, ctx: PriceCtx): number {
  const { items, gen, npc } = ctx;
  const b = items.base(item.code);
  if (!b) return 0x7fffffff;
  if (kind === 'repair' && !isRepairable(items, item)) return 0;
  const qty = item.quantity > 0 ? item.quantity : 1;
  const type = items.types.get(b.type);
  const isBook = items.isType(b, 'book');
  const isQuiver = !!type?.quiver;
  let x: Triple;
  let div = 1;
  if (isBook) {
    const c = b.cost + qty * (ctx.bookCharge?.get(b.code) ?? 0);
    x = { s: c, b: c, r: 0 };
  } else if (isQuiver) {
    const c = Math.trunc((qty * b.cost) / 1024);
    x = { s: c, b: c, r: Math.trunc((Math.min(b.maxStack, 511) * b.cost) / 1024) };
  } else {
    x = { s: b.cost, b: b.cost, r: b.cost };
    if (b.stackable) div = Math.max(1, Math.min(b.maxStack, 511));
  }
  // 방어구: 기본 방어도 / 최대 방어도 비율 (출처: dwMaxAc − dwMinAc != −1 && dwMaxAc)
  if (items.isType(b, 'armo') && b.maxAc - b.minAc !== -1 && b.maxAc) {
    const c = Math.trunc((item.defense * b.cost) / b.maxAc);
    x = { s: c, b: c, r: c };
  }
  const q = item.quality;
  const magicLike = q >= QUALITY.MAGIC;
  if (!magicLike) x = itemSkill(item, ctx, b, x, div);
  if (item.identified && gen) {
    const acc = { s: 0, b: 0, r: 0 };
    const affix = (add: number, mult: number) => {
      acc.s += add + Math.trunc((x.s * mult) / 1024);
      acc.b += add + Math.trunc((x.b * mult) / 1024);
      acc.r += add + Math.trunc((x.r * mult) / 1024);
    };
    let bonus = false;
    switch (q) {
      case QUALITY.RARE:
        for (const i of item.prefixes) { const a = gen.prefixes[i]; if (a) affix(a.costAdd, a.costMult); }
        for (const i of item.suffixes) { const a = gen.suffixes[i]; if (a) affix(a.costAdd, a.costMult); }
        bonus = true;
        break;
      case QUALITY.UNIQUE: {
        const u = gen.uniques[item.uniqueIdx ?? -1];
        if (u) affix(u.costAdd, u.costMult);
        break;
      }
      case QUALITY.MAGIC: {
        const p = gen.prefixes[item.prefixes[0] ?? -1], s = gen.suffixes[item.suffixes[0] ?? -1];
        if (p) affix(p.costAdd, p.costMult);
        if (s) affix(s.costAdd, s.costMult);
        bonus = true;
        break;
      }
      case QUALITY.SUPERIOR:
        bonus = true;
        break;
      case QUALITY.SET: {
        const si = gen.setItems[item.setIdx ?? -1];
        if (si) affix(si.costAdd, si.costMult);
        break;
      }
      case QUALITY.INFERIOR:
        acc.s = Math.trunc(x.s / -2);
        acc.b = Math.trunc(x.b / -2);
        acc.r = Math.trunc(x.r / -2);
        break;
    }
    // 원작 순서: 접사 합은 BonusStats 가 x 를 바꾼 뒤에 더해진다 (BonusStats 는 switch 안에서 먼저 x 에 반영)
    if (bonus) x = bonusStats(item, gen, x, div);
    x = { s: x.s + Math.trunc(acc.s / div), b: x.b + Math.trunc(acc.b / div), r: x.r + Math.trunc(acc.r / div) };
    if (magicLike) x = itemSkill(item, ctx, b, x, div);
  }
  // 소켓에 박힌 아이템: 각 cost / 2
  for (const g of item.socketed) {
    const gc = Math.trunc((items.base(g.code)?.cost ?? 0) / 2);
    x = { s: x.s + gc, b: x.b + gc, r: x.r + gc };
  }
  if (kind === 'repair' && !(isQuiver && type?.throwable)) {
    if (hasDurability(b, item)) {
      // 원작 코드는 R *= (max − dur) / max (정수 나눗셈 먼저면 항상 0) — 의도된 비율로 계산 (근사: 원작 연산 순서 미확인)
      x.r = item.durability < item.maxDurability ? Math.trunc((x.r * (item.maxDurability - item.durability)) / item.maxDurability) : 0;
    }
  }
  x = { s: Math.trunc((x.s * npc.sellMult) / 1024), b: Math.trunc((x.b * npc.buyMult) / 1024), r: Math.trunc((x.r * npc.repMult) / 1024) };
  for (const qf of npc.quest) {
    if (!qf.flag || !ctx.questDone?.(qf.flag)) continue;
    x = { s: Math.trunc((x.s * qf.sellMult) / 1024), b: Math.trunc((x.b * qf.buyMult) / 1024), r: Math.trunc((x.r * qf.repMult) / 1024) };
  }
  if (!isBook && !isQuiver) {
    x.s *= qty;
    if (b.stackable && isRepairable(items, item)) {
      const max = Math.min(b.maxStack, 511);
      x.r = qty < max ? x.r * (max - qty) : 0;
      // 원작 디컴파일은 B *= (max − R) — 오기로 보고 수량 배수 적용 (근사)
      x.b *= qty;
    } else x.b *= qty;
  }
  let cost = Math.min(x.b, npc.maxBuy[ctx.difficulty]);
  const reduce = Math.min(ctx.reducePct ?? 0, 99);
  if (kind === 'repair') cost = x.r - Math.trunc((x.r * reduce) / 100);
  else if (kind === 'buy') cost = x.s - Math.trunc((x.s * reduce) / 100);
  return Math.max(1, cost);
}
