// 호라드릭 큐브: cubemain.txt 조합표 읽기, 트랜스뮤트(입력 맞추기 → 결과 아이템 만들기).
// 출처: D2MOO D2Common/src/DataTbls/HoradricCube.cpp — DATATBLS_CubeMainInputParser / DATATBLS_CubeMainOutputParser / DATATBLS_LoadCubeMainTxt
// 출처: D2MOO D2Game/src/PLAYER/PlrTrade.cpp — PLRTRADE_HandleCubeInteraction (조합 고르기), PLRTRADE_CheckCubeInput (입력 맞추기),
//       PLRTRADE_CreateCubeOutputs (결과 만들기), PLRTRADE_RollRandomItemClassOfSameType (itemtype 결과)
// (https://github.com/ThePhrozenKeep/D2MOO)
import type { TxtRow } from '../formats/txt';
import type { ItemBase, ItemDb } from './items';
import { QUALITY, type ItemInstance, type Quality, type TreasureDb } from './treasure';
import type { Rng } from './rng';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

/** 입력 한 칸 (원작 D2CubeInputItem). code = 아이템 코드(USEANY + wItem), type = itemtypes 코드(ITEMCODE), any = 아무 아이템 */
export interface CubeInput {
  any: boolean;
  code?: string;
  type?: string;
  /** 0 = 품질 무관, 그 밖 = ITEMQUAL (low 1 · nor 2 · hiq 3 · mag 4 · set 5 · rar 6 · uni 7 · crf 8) */
  quality: number;
  qty: number;
  /** 유니크·세트 이름 입력 (CUBEFLAG_IN_SPECIAL) — uniqueitems / setitems 행 번호 */
  uniqueIdx?: number;
  setIdx?: number;
  nos: boolean; sock: boolean; noe: boolean; eth: boolean; upg: boolean; bas: boolean; exc: boolean; eli: boolean; nru: boolean;
}

export type CubeOutputKind = 'code' | 'type' | 'useitem' | 'usetype' | 'cow' | 'portal';

/** 결과 한 칸 (원작 D2CubeOutputItem) */
export interface CubeOutput {
  kind: CubeOutputKind;
  code?: string;
  type?: string;
  quality: number;
  qty: number;
  pre: number[];
  suf: number[];
  /** 유니크·세트 이름 결과 */
  uniqueIdx?: number;
  setIdx?: number;
  sock: boolean; eth: boolean; mod: boolean; uns: boolean; rem: boolean; reg: boolean; exc: boolean; eli: boolean; rep: boolean; rch: boolean;
  lvl: number; plvl: number; ilvl: number;
  /** 결과에 붙이는 속성 (cubemain mod 1~5 · b mod · c mod — 제작·소켓 조합). chance 0 = 늘 */
  mods: { code: string; chance: number; param: string; min: number; max: number }[];
}

export interface CubeRecipe {
  /** cubemain.txt 행 (0 부터, 머리 줄 제외) */
  row: number;
  description: string;
  enabled: boolean; ladder: boolean; minDiff: number; version: number;
  op: number; param: number; value: number;
  /** 캐릭터 클래스 제한 (없으면 '') */
  cls: string;
  numInputs: number;
  inputs: (CubeInput | null)[];
  outputs: (CubeOutput | null)[];
}

const QUAL: Record<string, number> = { low: 1, nor: 2, hiq: 3, mag: 4, set: 5, rar: 6, uni: 7, crf: 8, tmp: 9 };

const unquote = (s: string): string => s.replace(/"/g, '').trim();

/** 조합표 */
export class CubeDb {
  readonly recipes: CubeRecipe[] = [];

  /**
   * @param uniqueNames uniqueitems.txt index 이름 (행 순서) — 이름 입력·결과용
   * @param setNames setitems.txt index 이름 (행 순서)
   */
  constructor(rows: TxtRow[], private readonly items: ItemDb, uniqueNames: readonly string[] = [], setNames: readonly string[] = []) {
    const uIdx = new Map(uniqueNames.map((nm, i) => [nm, i]));
    const sIdx = new Map(setNames.map((nm, i) => [nm, i]));
    rows.forEach((r, row) => {
      if (!r.description && !r['input 1']) return;
      const inputs = [1, 2, 3, 4, 5, 6, 7].map((i) => this.parseInput(r[`input ${i}`] ?? '', uIdx, sIdx));
      const outputs = ['output', 'output b', 'output c'].map((k, oi) => {
        const pfx = ['', 'b ', 'c '][oi] as string;
        const out = this.parseOutput(r[k] ?? '', uIdx, sIdx, n(r[`${pfx}lvl`]), n(r[`${pfx}plvl`]), n(r[`${pfx}ilvl`]));
        if (out) {
          for (let m = 1; m <= 5; m++) {
            const code = r[`${pfx}mod ${m}`];
            if (code) out.mods.push({ code, chance: n(r[`${pfx}mod ${m} chance`]), param: r[`${pfx}mod ${m} param`] ?? '', min: n(r[`${pfx}mod ${m} min`]), max: n(r[`${pfx}mod ${m} max`]) });
          }
        }
        return out;
      });
      this.recipes.push({
        row, description: r.description ?? '', enabled: n(r.enabled) === 1, ladder: n(r.ladder) === 1, minDiff: n(r['min diff']), version: n(r.version),
        op: n(r.op), param: n(r.param), value: n(r.value), cls: r.class ?? '', numInputs: n(r.numinputs), inputs, outputs,
      });
    });
  }

  /** 출처: DATATBLS_CubeMainInputParser — "any" / itemtypes 코드(먼저) / 아이템 코드 / 유니크 이름 / 세트 이름, 뒤에 qty=·품질·nos·sock·noe·eth·upg·bas·exc·eli·nru */
  private parseInput(src: string, uIdx: Map<string, number>, sIdx: Map<string, number>): CubeInput | null {
    const s = unquote(src);
    if (!s) return null;
    const [head, ...mods] = s.split(',').map((x) => x.trim());
    const inp: CubeInput = { any: false, quality: 0, qty: 0, nos: false, sock: false, noe: false, eth: false, upg: false, bas: false, exc: false, eli: false, nru: false };
    const h = head ?? '';
    if (h.length <= 4 && h.toLowerCase() === 'any') inp.any = true;
    else if (h.length <= 4 && this.items.types.has(h)) inp.type = h;
    else if (h.length <= 4 && this.items.base(h)) inp.code = h;
    else if (uIdx.has(h)) {
      inp.uniqueIdx = uIdx.get(h);
      inp.quality = QUALITY.UNIQUE;
    } else if (sIdx.has(h)) {
      inp.setIdx = sIdx.get(h);
      inp.quality = QUALITY.SET;
    } else return null;
    for (const m of mods) {
      const [k, v] = m.split('=');
      if (k === 'qty') inp.qty = n(v);
      else if (k && QUAL[k] !== undefined) inp.quality = QUAL[k] as number;
      else if (k && k in inp && typeof (inp as unknown as Record<string, unknown>)[k] === 'boolean') (inp as unknown as Record<string, boolean>)[k] = true;
    }
    return inp;
  }

  /**
   * 출처: DATATBLS_CubeMainOutputParser — "Cow Portal" / usetype / useitem / 아이템 코드(먼저) / itemtypes 코드 / 유니크·세트 이름,
   *   뒤에 qty=·pre=·suf=·품질·eth·sock=·mod·uns·rem·reg·exc·eli·rep·rch
   */
  private parseOutput(src: string, uIdx: Map<string, number>, sIdx: Map<string, number>, lvl: number, plvl: number, ilvl: number): CubeOutput | null {
    const s = unquote(src);
    if (!s) return null;
    const [head, ...mods] = s.split(',').map((x) => x.trim());
    const out: CubeOutput = {
      kind: 'code', quality: 0, qty: 0, pre: [], suf: [], sock: false, eth: false, mod: false, uns: false, rem: false, reg: false, exc: false, eli: false, rep: false, rch: false,
      lvl, plvl, ilvl, mods: [],
    };
    const h = head ?? '';
    if (h.toLowerCase() === 'cow portal') out.kind = 'cow';
    else if (/^pandemonium/i.test(h)) out.kind = 'portal';
    else if (h === 'usetype') out.kind = 'usetype';
    else if (h === 'useitem') out.kind = 'useitem';
    else if (h.length <= 4 && this.items.base(h)) out.code = h;
    else if (h.length <= 4 && this.items.types.has(h)) {
      out.kind = 'type';
      out.type = h;
    } else if (uIdx.has(h)) {
      out.uniqueIdx = uIdx.get(h);
      out.quality = QUALITY.UNIQUE;
    } else if (sIdx.has(h)) {
      out.setIdx = sIdx.get(h);
      out.quality = QUALITY.SET;
    } else return null;
    for (const m of mods) {
      const [k, v] = m.split('=');
      if (k === 'qty') out.qty = n(v);
      else if (k === 'pre') out.pre.push(n(v));
      else if (k === 'suf') out.suf.push(n(v));
      else if (k === 'sock') {
        out.sock = true;
        out.qty = n(v);
      } else if (k === 'reg') {
        out.reg = true;
        out.kind = 'usetype';
      } else if (k && QUAL[k] !== undefined) out.quality = QUAL[k] as number;
      else if (k && k in out && typeof (out as unknown as Record<string, unknown>)[k] === 'boolean') (out as unknown as Record<string, boolean>)[k] = true;
    }
    return out;
  }
}

/** 트랜스뮤트가 게임에 요청하는 것 */
export interface CubeCtx {
  items: ItemDb;
  treasure: TreasureDb;
  /** 원작 pGame->pGameSeed (itemtype 결과 고르기·아이템 생성) */
  rng: Rng;
  playerLevel: number;
  difficulty: number;
  /** 캐릭터 클래스 (charstats Class) */
  cls: string;
  /** 확장팩이면 true (클래식은 version ≥ 100 행을 쓰지 않는다) */
  expansion?: boolean;
}

export interface TransmuteResult {
  recipe: CubeRecipe;
  /** 새로 만든 아이템 (큐브에 넣을 것) */
  outputs: ItemInstance[];
  /** 없앨 입력 (큐브 안 전부) */
  consumed: ItemInstance[];
  /** 특별 결과 (Cow Portal) — 게임이 처리 */
  special?: 'cow';
}

interface CubeItemRef { item: ItemInstance | null; ilvl: number; code: string | null }

/** 쌓이는 아이템 (ITEMS_CheckIfStackable: misc/weapons stackable) */
const stackable = (b: ItemBase): boolean => b.stackable;

/**
 * 입력 한 칸 맞추기. 출처: PLRTRADE_CheckCubeInput —
 *   아이템 코드(USEANY) 는 같은 코드(upg 면 normcode/ubercode/ultracode 사다리), itemtype 은 ITEMS_CheckItemTypeId,
 *   품질·유니크/세트 행·소켓(nos/sock)·에테리얼(noe/eth)·등급(bas/exc/eli)·룬워드(nru) 조건, 이미 다른 칸에 쓴 아이템은 건너뜀.
 *   첫 칸(0)은 결과 기준 아이템(아이템 레벨·코드 — usetype/useitem 결과)으로 기록. 개수: 쌓이는 아이템이 있으면 ≥ qty, 아니면 = qty
 * 근사(원작 미확인): op 28(퀘스트 아이템 난이도 stat 356)은 보지 않는다 — 클래식 아이템에 그 스탯이 없다
 */
function checkInput(ctx: CubeCtx, recipe: CubeRecipe, idx: number, list: ItemInstance[], used: boolean[], refs: CubeItemRef[]): boolean {
  const inp = recipe.inputs[idx];
  if (!inp) return true;
  const qty = inp.qty > 0 ? inp.qty : 1;
  const out0 = recipe.outputs[0];
  let count = 0, hasStack = false;
  list.forEach((it, k) => {
    const b = ctx.items.base(it.code);
    if (!b) return;
    if (inp.code) {
      if (inp.upg) {
        const want = inp.code;
        const ok = it.code === b.normCode ? want === b.normCode
          : it.code === b.uberCode ? want === b.normCode || want === b.uberCode
            : it.code === b.ultraCode ? want === b.normCode || want === b.uberCode || want === b.ultraCode : false;
        if (!ok) return;
      } else if (it.code !== inp.code) return;
    } else if (inp.type && !ctx.items.isType(b, inp.type)) return;
    if (inp.quality && it.quality !== inp.quality) return;
    if (inp.uniqueIdx !== undefined && it.uniqueIdx !== inp.uniqueIdx) return;
    if (inp.setIdx !== undefined && it.setIdx !== inp.setIdx) return;
    if (inp.nos ? it.sockets > 0 : inp.sock && it.sockets <= 0) return;
    // 룬워드 아이템은 nru 입력에 맞지 않는다
    if (inp.nru && it.runeword !== undefined) return;
    // 이더리얼 입력 조건 (출처: PLRTRADE_CheckCubeInput eth / noe)
    if (inp.eth && !it.ethereal) return;
    if (inp.noe && it.ethereal) return;
    if (inp.bas ? it.code !== b.normCode : inp.exc ? it.code !== b.uberCode : inp.eli && it.code !== b.ultraCode) return;
    // 결과가 소켓을 더하는 조합이면 첫 입력은 소켓을 가질 수 있어야 (ITEMS_GetMaxSockets)
    if (idx === 0 && out0 && (out0.kind === 'useitem' || out0.kind === 'usetype') && out0.sock && b.gemSockets <= 0) return;
    if (used[k]) return;
    used[k] = true;
    count++;
    if (stackable(b)) hasStack = true;
    if (idx === 0) {
      for (let i = 0; i < 3; i++) {
        const o = recipe.outputs[i];
        refs[i] = { item: it, ilvl: it.ilvl, code: o && o.kind === 'usetype' ? upgradeCode(ctx, b, o) : it.code };
      }
    }
  });
  return hasStack ? count >= qty : count === qty;
}

/** usetype 결과의 기본 코드: exc/eli 면 ubercode/ultracode (클래식은 version < 100 인 것만). 출처: PLRTRADE_CheckCubeInput 의 wItemFlags 0x80 / 0x100 */
function upgradeCode(ctx: CubeCtx, b: ItemBase, o: CubeOutput): string {
  const to = o.exc ? b.uberCode : o.eli ? b.ultraCode : '';
  const nb = to ? ctx.items.base(to) : undefined;
  return nb && (ctx.expansion || nb.version < 100) ? nb.code : b.code;
}

/** 최대 소켓 (출처: ITEMS_GetMaxSockets — itemtypes MaxSock1/25/40 · items gemsockets) */
function maxSockets(ctx: CubeCtx, b: ItemBase, ilvl: number): number {
  const def = [...ctx.items.typeChain(b.type)].map((x) => ctx.items.types.get(x)).find((dd) => dd && (dd.maxSock[0] || dd.maxSock[1] || dd.maxSock[2]));
  const tier = ilvl <= 25 ? 0 : ilvl <= 40 ? 1 : 2;
  return Math.min(b.gemSockets, def?.maxSock[tier] ?? 0);
}

/** 출처: PLRTRADE_RollRandomItemClassOfSameType — 무작위 시작 행부터 한 바퀴: 그 type·spawnable·클래식·레벨 ≤ nLevel, 최대 256 후보 중 하나 */
function randomOfType(ctx: CubeCtx, type: string, level: number): ItemBase | undefined {
  const all = [...ctx.items.bases.values()];
  if (!all.length) return undefined;
  let i = ctx.rng.pick(all.length);
  const stop = i - 1 < 0 ? all.length - 1 : i - 1;
  if (i === stop) return undefined;
  const cand: ItemBase[] = [];
  do {
    if (cand.length >= 256) break;
    const b = all[i] as ItemBase;
    if (ctx.items.isType(b, type) && b.spawnable && (b.version < 100 || ctx.expansion) && b.level <= level) cand.push(b);
    i++;
    if (i >= all.length) i = 0;
  } while (i !== stop);
  return cand.length ? cand[ctx.rng.pick(cand.length)] : undefined;
}

/**
 * 결과 만들기. 출처: PLRTRADE_CreateCubeOutputs —
 *   레벨 = lvl, 없으면 plvl × 플레이어 레벨 / 100 + ilvl × 첫 입력 아이템 레벨 / 100 (1 ~ 99),
 *   useitem = 첫 입력을 복제(속성 유지), usetype = 첫 입력과 같은 기본 아이템을 새로(quality), 아이템 코드·itemtype = 새 아이템,
 *   소켓(sock) 없으면 소켓 없이, sock=N 이면 결과에 min(최대 소켓, N) (매직 3·레어/유니크/세트 1 상한), rep = 내구·수량 채움,
 *   qty = 쌓이는 결과 수량, 결과는 감정된 채로 큐브에
 *   mod 1~5 = chance(0 이면 늘) 로 속성 추가 (출처: ITEMMODS_AddCraftPropertyList), 소켓 속성은 ITEMS_AddSockets 품질 상한
 *   (유니크·세트 1 · 레어 2 · 매직 4 · 제작 3, ITEMS_GetMaxSockets 이하), uns = 박힌 것을 없애고 룬워드도 없앤다
 * 근사(원작 미확인): pre=/suf= 강제 접사는 굴린 매직 접사를 그 접사로 바꾸고 속성을 다시 굴린다,
 *   rch(재충전)는 충전 스킬(2단계 나)과 함께
 */
function makeOutput(ctx: CubeCtx, o: CubeOutput, ref: CubeItemRef): ItemInstance | null {
  let level = o.lvl;
  if (!level) level = Math.trunc((o.plvl * ctx.playerLevel) / 100) + Math.trunc((o.ilvl * ref.ilvl) / 100);
  level = Math.max(1, Math.min(99, level));
  const t = ctx.treasure;
  let out: ItemInstance | null = null;
  if (o.kind === 'useitem') {
    if (!ref.item) return null;
    out = structuredClone(ref.item);
    const fix = (x: ItemInstance) => {
      x.id = t.allocId();
      x.socketed.forEach(fix);
    };
    fix(out);
    if (o.uns) {
      out.socketed = [];
      if (out.runeword !== undefined) {
        if (out.runewordBase) {
          out.stats = out.runewordBase.stats;
          out.defense = out.runewordBase.defense;
        }
        delete out.runeword;
        delete out.runewordBase;
      }
    }
  } else {
    let base: ItemBase | undefined;
    let quality = o.quality;
    if (o.kind === 'usetype') {
      base = ref.code ? ctx.items.base(ref.code) : undefined;
      if (o.reg && ref.item) {
        level = ref.item.ilvl;
        quality = ref.item.quality;
      }
    } else if (o.kind === 'code') base = o.code ? ctx.items.base(o.code) : undefined;
    else if (o.kind === 'type') base = o.type ? randomOfType(ctx, o.type, level) : undefined;
    if (!base) return null;
    // 큐브 결과는 eth 표시가 있을 때만 이더리얼 (출처: PLRTRADE_CreateCubeOutputs — ALWAYSETH / NEVERETH)
    out = t.createItem(base, level, ctx.rng, (quality || QUALITY.NORMAL) as Quality, true, o.eth ? 'always' : 'never');
    // 소켓: sock 이 없거나 수가 정해져 있으면 생성 때 소켓 없음 (ITEMDROPFLAG_NOSOCKETS)
    if (!o.sock || o.qty) {
      out.sockets = 0;
      out.stats = out.stats.filter((s) => s.stat !== 'item_numsockets');
    }
    // 강제 접사 (pre=/suf=)
    const gen = t.gen;
    if (gen && (o.pre.length || o.suf.length) && out.quality === QUALITY.MAGIC) {
      if (o.pre.length) out.prefixes = [...o.pre];
      if (o.suf.length) out.suffixes = [...o.suf];
      out.stats = out.stats.filter((s) => s.stat === 'item_numsockets');
      for (const i of out.prefixes) gen.assignMods(out, base, gen.prefixes[i]?.mods ?? [], ctx.rng);
      for (const i of out.suffixes) gen.assignMods(out, base, gen.suffixes[i]?.mods ?? [], ctx.rng);
      for (const i of out.prefixes) out.levelReq = Math.max(out.levelReq, gen.prefixes[i]?.levelReq ?? 0);
      for (const i of out.suffixes) out.levelReq = Math.max(out.levelReq, gen.suffixes[i]?.levelReq ?? 0);
    }
  }
  const b = ctx.items.base(out.code);
  if (!b) return null;
  if (o.mods.length && t.gen) {
    for (const m of o.mods) {
      if (m.chance && ctx.rng.pick(100) >= m.chance) continue;
      const before = out.sockets;
      t.gen.assignMods(out, b, [{ code: m.code, param: m.param, min: m.min, max: m.max }], ctx.rng);
      if (out.sockets !== before) {
        const q = out.quality;
        const qcap = q === QUALITY.UNIQUE || q === QUALITY.SET ? 1 : q === QUALITY.RARE ? 2 : q === QUALITY.MAGIC ? 4 : q === QUALITY.CRAFTED ? 3 : 6;
        const s = Math.max(before, Math.min(out.sockets, qcap, maxSockets(ctx, b, out.ilvl)));
        out.sockets = s;
        const st = out.stats.find((x) => x.stat === 'item_numsockets');
        if (st) st.value = s;
        if (s <= 0) out.stats = out.stats.filter((x) => x.stat !== 'item_numsockets');
      }
    }
  }
  if (o.rep) {
    if (b.stackable && o.qty) out.quantity = Math.min(b.maxStack, o.qty);
    if (out.maxDurability > 0) out.durability = out.maxDurability;
  }
  if (o.sock) {
    if (o.qty && out.sockets <= 0) {
      let max = Math.min(maxSockets(ctx, b, out.ilvl), o.qty);
      if (out.quality === QUALITY.MAGIC) max = Math.min(max, 3);
      else if (out.quality >= QUALITY.SET) max = Math.min(max, 1);
      if (max > 0) {
        out.sockets = max;
        out.stats.push({ stat: 'item_numsockets', param: 0, value: max });
      }
    }
  } else if (o.qty && b.stackable) out.quantity = Math.min(b.maxStack, o.qty);
  out.identified = true;
  return out;
}

/**
 * 트랜스뮤트. 큐브 안 아이템으로 맞는 첫 조합을 찾아 결과를 만든다 (없으면 null — 아무 일도 없다).
 * 출처: PLRTRADE_HandleCubeInteraction — 행 순서대로: enabled, 클래식이면 version < 100, ladder 행은 래더 게임만(싱글 = 아님),
 *   min diff ≤ 난이도, class 제한, numinputs = 큐브 안 아이템 수, op 조건(1~14 날짜·스탯 — 클래식 행에 없음) → 입력 7 칸을 차례로 맞추면 결과
 */
export function transmute(db: CubeDb, ctx: CubeCtx, cubeItems: readonly ItemInstance[]): TransmuteResult | null {
  const list = [...cubeItems];
  if (!list.length) return null;
  for (const r of db.recipes) {
    if (!r.enabled || (!ctx.expansion && r.version >= 100) || r.ladder || r.minDiff > ctx.difficulty) continue;
    if (r.cls && r.cls !== ctx.cls) continue;
    if (r.numInputs !== list.length) continue;
    // 근사(원작 미확인): op 1~14 (날짜·플레이어 스탯 조건)는 클래식 행에 없어 만족하지 않는 것으로
    if (r.op >= 1 && r.op <= 14) continue;
    const used = list.map(() => false);
    const refs: CubeItemRef[] = [0, 1, 2].map(() => ({ item: null, ilvl: 0, code: null }));
    let ok = true;
    for (let i = 0; i < 7 && ok; i++) ok = checkInput(ctx, r, i, list, used, refs);
    if (!ok) continue;
    const outputs: ItemInstance[] = [];
    let special: 'cow' | undefined;
    r.outputs.forEach((o, i) => {
      if (!o) return;
      if (o.kind === 'cow') {
        special = 'cow';
        return;
      }
      if (o.kind === 'portal') return;
      const it = makeOutput(ctx, o, refs[i] as CubeItemRef);
      if (it) outputs.push(it);
    });
    // 출처: bSuccess 가 없으면 아무 일도 없다 (입력이 남는다)
    if (!outputs.length && !special) return null;
    return { recipe: r, outputs, consumed: list, ...(special ? { special } : {}) };
  }
  return null;
}
