// 트레저 클래스(TC) 드롭 + 품질 롤 + 기본 아이템 생성.
// 출처: D2MOO — D2Game/src/ITEMS/Items.cpp D2GAME_DropTC_6FC51360 (TC 스택 순회, Picks/NoDrop, 품질 상속, 품질 롤, 클래식 투척무기 제한)
//       D2Common/src/DataTbls/MonsterTbls.cpp DATATBLS_GetTreasureClassExRecordFromIdAndLevel (group/level 업그레이드)
//       D2Game/src/ITEMS/Items.cpp D2GAME_InitItemStats_6FC4E520 (골드 수량, 내구도, 방어력) (https://github.com/ThePhrozenKeep/D2MOO)
// 출처: Phrozen Keep — TreasureClassEx.txt File Guide: 자동 TC(weap3, armo6 …)는 ItemTypes.txt TreasureClass=1 타입의
//       qlvl (N-3, N] 아이템, 가중치 = rarity (https://d2mods.info/forum/kb/viewarticle?a=368)
import type { TxtRow } from '../formats/txt';
import type { ItemBase, ItemDb } from './items';
import { Rng } from './rng';
import type { ItemGen } from './itemgen';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export const QUALITY = { INFERIOR: 1, NORMAL: 2, SUPERIOR: 3, MAGIC: 4, SET: 5, RARE: 6, UNIQUE: 7 } as const;
export type Quality = (typeof QUALITY)[keyof typeof QUALITY];

interface QualityMods { unique: number; set: number; rare: number; magic: number }

interface TcEntry { name: string; prob: number; isTc: boolean }
interface Tc { name: string; group: number; level: number; picks: number; noDrop: number; mods: QualityMods; entries: TcEntry[] }

/** 아이템이 주는 스탯 (itemstatcost.txt 이름, param = 레이어(스킬 Id 등), value) */
export interface ItemStat { stat: string; param: number; value: number }

export interface ItemInstance {
  id: number;
  code: string;
  quality: Quality;
  ilvl: number;
  identified: boolean;
  /** 골드 수량 또는 스택 수량 */
  quantity: number;
  durability: number;
  maxDurability: number;
  defense: number;
  /** 격자 크기 (invwidth × invheight) */
  invW: number;
  invH: number;
  /** 요구 레벨 (기본 levelreq 와 접사·유니크·세트 lvl req 중 최대) */
  levelReq: number;
  /** magicprefix/magicsuffix 행 번호 (매직·레어) */
  prefixes: number[];
  suffixes: number[];
  /** rareprefix/raresuffix 행 번호 (레어 이름) */
  rareName?: [number, number];
  /** uniqueitems / setitems 행 번호 */
  uniqueIdx?: number;
  setIdx?: number;
  /** qualityitems 행 (상급), lowqualityitems 행 (하급) */
  superiorIdx?: number;
  lowQualityIdx?: number;
  /** 소켓 수와 박힌 보석 */
  sockets: number;
  socketed: ItemInstance[];
  /** 굴린 속성 → 스탯 */
  stats: ItemStat[];
  /** 하급 무기: 피해 75% (출처: sub_6FC549F0) */
  inferiorDamage?: boolean;
  /** 방어% 접사로 기본 방어가 maxac + 1 로 올라감 */
  edDefenseBase?: boolean;
  /** 이더리얼 (확장팩): 기본 피해·방어 ×1.5, 최대 내구 max/2+1, 수리 불가 — 출처: D2MOO ITEMMODS_ApplyEthereality / ITEMS_MakeEthereal */
  ethereal?: boolean;
}

interface ItemRatio { unique: number; uniqueDiv: number; uniqueMin: number; rare: number; rareDiv: number; rareMin: number; set: number; setDiv: number; setMin: number; magic: number; magicDiv: number; magicMin: number; hiQ: number; hiQDiv: number; normal: number; normalDiv: number }

export class TreasureDb {
  private readonly tcs = new Map<string, Tc>();
  private readonly order: Tc[] = [];
  private readonly ratio: ItemRatio;
  private readonly items: ItemDb;
  private nextId = 1;
  /** 품질·접사 생성기 (없으면 기본 아이템만) */
  gen: ItemGen | null = null;
  /** 이번 게임에서 이미 나온 유니크 (nolimit 제외, 게임마다 초기화). 출처: pGame->dwUniqueFlags */
  readonly droppedUniques = new Set<number>();

  /** 확장팩 캐릭터용: 확장팩 기본템(version 100)·투척 무기도 떨어진다 */
  readonly expansion: boolean;

  constructor(items: ItemDb, treasureClassEx: TxtRow[], itemRatio: TxtRow[], expansion = false) {
    this.items = items;
    this.expansion = expansion;
    for (const r of treasureClassEx) {
      const name = r['Treasure Class'];
      if (!name) continue;
      const entries: TcEntry[] = [];
      for (let i = 1; i <= 10; i++) {
        const it = r[`Item${i}`];
        const prob = n(r[`Prob${i}`]);
        if (it && prob > 0) entries.push({ name: it, prob, isTc: false });
      }
      const tc: Tc = {
        name, group: n(r.group), level: n(r.level), picks: n(r.Picks), noDrop: n(r.NoDrop),
        mods: { unique: n(r.Unique), set: n(r.Set), rare: n(r.Rare), magic: n(r.Magic) }, entries,
      };
      this.tcs.set(name, tc);
      this.order.push(tc);
    }
    this.buildAutoTcs();
    for (const tc of this.order) for (const e of tc.entries) e.isTc = this.tcs.has(e.name);
    // 출처: D2MOO DATATBLS_GetItemRatioTxtRecord — 드롭 경로는 wVersion=100 으로 호출 → Version 1 행, Uber 0, Class Specific 0
    const row = itemRatio.filter((x) => n(x.Uber) === 0 && n(x['Class Specific']) === 0).sort((a, b) => n(b.Version) - n(a.Version))[0];
    if (!row) throw new Error('itemratio: no base row');
    this.ratio = {
      unique: n(row.Unique), uniqueDiv: n(row.UniqueDivisor) || 1, uniqueMin: n(row.UniqueMin),
      rare: n(row.Rare), rareDiv: n(row.RareDivisor) || 1, rareMin: n(row.RareMin),
      set: n(row.Set), setDiv: n(row.SetDivisor) || 1, setMin: n(row.SetMin),
      magic: n(row.Magic), magicDiv: n(row.MagicDivisor) || 1, magicMin: n(row.MagicMin),
      hiQ: n(row.HiQuality), hiQDiv: n(row.HiQualityDivisor) || 1, normal: n(row.Normal), normalDiv: n(row.NormalDivisor) || 1,
    };
  }

  /** 자동 TC: TreasureClass=1 타입마다 <code>3, <code>6 … <code>99 (클래식: version < 100, spawnable, rarity > 0 — 확장팩은 version 무관) */
  private buildAutoTcs(): void {
    for (const t of this.items.types.values()) {
      if (!t.treasureClass) continue;
      for (let lvl = 3; lvl <= 99; lvl += 3) {
        const entries: TcEntry[] = [];
        for (const b of this.items.bases.values()) {
          if (!this.allowed(b) || !b.spawnable || b.rarity <= 0) continue;
          if (b.level <= lvl - 3 || b.level > lvl) continue;
          if (!this.items.isType(b, t.code)) continue;
          entries.push({ name: b.code, prob: b.rarity, isTc: false });
        }
        const name = `${t.code}${lvl}`;
        if (!this.tcs.has(name)) {
          const tc: Tc = { name, group: 0, level: 0, picks: 1, noDrop: 0, mods: { unique: 0, set: 0, rare: 0, magic: 0 }, entries };
          this.tcs.set(name, tc);
          this.order.push(tc);
        }
      }
    }
  }

  /** 불러온 아이템 id 와 겹치지 않도록 다음 id 를 올린다 */
  /** 새 아이템 Id (상점에서 산 아이템 복제 — 원작 ITEMS_Duplicate) */
  allocId(): number {
    return this.nextId++;
  }

  reserveIds(maxId: number): void {
    this.nextId = Math.max(this.nextId, maxId + 1);
  }

  get(name: string): Tc | undefined {
    return this.tcs.get(name);
  }

  /** group/level 업그레이드: 같은 group 의 다음 행들 중 level <= mlvl 인 마지막 TC */
  resolve(name: string, mlvl: number): Tc | undefined {
    const tc = this.tcs.get(name);
    if (!tc || mlvl <= 0 || !tc.group) return tc;
    let idx = this.order.indexOf(tc);
    let cur = tc;
    while (idx + 1 < this.order.length) {
      const next = this.order[idx + 1] as Tc;
      if (next.group !== tc.group || next.level > mlvl) break;
      cur = next;
      idx++;
    }
    return cur;
  }

  /** TC 에서 드롭 목록 생성 (싱글플레이 = 플레이어 1명, NoDrop 보정 없음) */
  /**
   * @param opts.exact 루트 TC 를 group/level 로 올리지 않는다 (상자 TC: D2GAME_DropTC 에 레코드를 직접 넘김)
   * @param opts.quality 최소 품질 (원작 DropTC nQuality — 스파크 상자 매직/레어). 근사(원작 미확인): 굴린 품질이 낮으면 이 품질로 올림
   */
  drop(tcName: string, mlvl: number, rng: Rng, magicFind = 0, opts: { exact?: boolean; quality?: number } = {}): ItemInstance[] {
    const root = opts.exact ? this.tcs.get(tcName) : this.resolve(tcName, mlvl);
    if (!root) return [];
    const out: ItemInstance[] = [];
    let throwables = 0;
    const stack: { tc: Tc; picks: number; mods: QualityMods }[] = [{ tc: root, picks: Math.max(Math.abs(root.picks), 1), mods: { ...root.mods } }];
    while (stack.length && out.length < 6) {
      const frame = stack[stack.length - 1] as { tc: Tc; picks: number; mods: QualityMods };
      const { tc } = frame;
      const total = tc.entries.reduce((s, e) => s + (this.usable(e) ? e.prob : 0), 0);
      if (!total || frame.picks <= 0) {
        stack.pop();
        continue;
      }
      let entry: TcEntry | undefined;
      if (tc.picks < 0) {
        // 음수 picks: Prob 값이 순서대로 개수를 뜻한다
        let r = -tc.picks - frame.picks;
        frame.picks--;
        for (const e of tc.entries) {
          if (!this.usable(e)) continue;
          if (r < e.prob) { entry = e; break; }
          r -= e.prob;
        }
        if (!entry) { stack.pop(); continue; }
      } else {
        let r = rng.pick(total + tc.noDrop);
        frame.picks--;
        if (r < tc.noDrop) continue;
        r -= tc.noDrop;
        for (const e of tc.entries) {
          if (!this.usable(e)) continue;
          if (r < e.prob) { entry = e; break; }
          r -= e.prob;
        }
      }
      if (!entry) continue;
      if (entry.isTc) {
        const child = this.resolve(entry.name, mlvl) as Tc;
        const mods: QualityMods = {
          unique: Math.max(frame.mods.unique, child.mods.unique), set: Math.max(frame.mods.set, child.mods.set),
          rare: Math.max(frame.mods.rare, child.mods.rare), magic: Math.max(frame.mods.magic, child.mods.magic),
        };
        stack.push({ tc: child, picks: Math.max(Math.abs(child.picks), 1), mods });
        continue;
      }
      const base = this.items.base(entry.name);
      if (!base || !this.allowed(base)) continue;
      // 출처: D2MOO D2GAME_DropTC — 클래식은 투척 무기가 뽑히면 10번까지 픽을 되돌리고, 넘으면 Long Sword('lsd')로 바꾼다 (확장팩은 그대로 떨어진다)
      let dropBase = base;
      if (!this.expansion && [...this.items.typeChain(base.type)].some((t) => this.items.types.get(t)?.throwable)) {
        if (++throwables <= 10) { frame.picks++; continue; }
        dropBase = this.items.base('lsd') ?? base;
      }
      let q = this.rollQuality(dropBase, mlvl, frame.mods, rng, magicFind);
      if (opts.quality && q < opts.quality && !this.items.types.get(dropBase.type)?.normal && dropBase.category !== 'misc') q = opts.quality as Quality;
      out.push(this.createItem(dropBase, mlvl, rng, q, true, 'roll'));
    }
    return out;
  }

  /** 이 판본에서 떨어질 수 있는 기본템 (클래식: version < 100) */
  private allowed(b: ItemBase): boolean {
    return this.expansion || b.version < 100;
  }

  /** TC 항목을 고를 수 있나 (모르는 이름은 원래대로 둔다 — 고른 뒤 base 가 없어 건너뛴다) */
  private usable(e: TcEntry): boolean {
    if (e.isTc) return true;
    const b = this.items.base(e.name);
    return !b || this.allowed(b);
  }

  /** 출처: D2MOO DropTC 품질 롤 — (ratio − (ilvl − qlvl)/divisor) << 7, MF 보정, TC 품질 보정, rand(chance) < 128 */
  rollQuality(base: ItemBase, ilvl: number, mods: QualityMods, rng: Rng, mf = 0): Quality {
    const typeDef = this.items.types.get(base.type);
    if (typeDef?.normal) return QUALITY.NORMAL;
    if (base.unique || (typeDef?.magic && base.quest)) return QUALITY.UNIQUE;
    const R = this.ratio;
    const diff = ilvl - base.level;
    const roll = (chance: number) => chance <= 0 || rng.pick(chance) < 128;
    const withMf = (ratio: number, div: number, min: number, factor: (d: number) => number, mod: number): number => {
      let b = (ratio - Math.trunc(diff / div)) << 7;
      if (mf !== 0) {
        const d = factor(mf + 100);
        if (d) b = Math.trunc((12800 * (ratio - Math.trunc(diff / div))) / d);
      }
      b = Math.max(b, min);
      return b - Math.trunc((b * mod) / 1024);
    };
    if (mf === 0 || mf > -100) {
      const uniq = withMf(R.unique, R.uniqueDiv, R.uniqueMin, (m) => (m > 110 ? Math.trunc((50 * (5 * m - 500)) / (m + 150)) + 100 : m), mods.unique);
      if (roll(uniq)) return QUALITY.UNIQUE;
      const set = withMf(R.set, R.setDiv, R.setMin, (m) => (m > 110 ? Math.trunc((100 * (5 * m - 500)) / (m + 400)) + 100 : m), mods.set);
      if (roll(set)) return QUALITY.SET;
      if (typeDef?.rare) {
        const rare = withMf(R.rare, R.rareDiv, R.rareMin, (m) => (m > 110 ? Math.trunc((200 * (3 * m - 300)) / (m + 500)) + 100 : m), mods.rare);
        if (roll(rare)) return QUALITY.RARE;
      }
      if (typeDef?.magic) return QUALITY.MAGIC;
      const magic = withMf(R.magic, R.magicDiv, R.magicMin, (m) => m, mods.magic);
      if (roll(magic)) return QUALITY.MAGIC;
    }
    if (roll((R.hiQ - Math.trunc(diff / R.hiQDiv)) << 7)) return QUALITY.SUPERIOR;
    if (roll((R.normal - Math.trunc(diff / R.normalDiv)) << 7)) return QUALITY.NORMAL;
    return QUALITY.INFERIOR;
  }

  /** 출처: D2MOO D2GAME_InitItemStats — 골드 = max(rand(5×ilvl) + ilvl, 1), 내구도 = dur/2 + rand(dur/2), 방어 = minac + rand(maxac−minac+1) */
  /** generate = true 면 품질·접사·소켓 생성 (몬스터 드롭 등). 시작 장비처럼 기본 아이템만 필요하면 false */
  /**
   * eth: 이더리얼 — 'roll' 몬스터·물체 드롭 (5%), 'always' 큐브 eth 결과, 'never' 그 밖
   * 근사(원작 미확인): 상점·도박·퀘스트 보상은 이더리얼이 되지 않는다 (원작 ITEMDROPFLAG_NEVERETH 경로 미확인)
   */
  createItem(base: ItemBase, ilvl: number, rng: Rng, quality: Quality, generate = false, eth: 'roll' | 'always' | 'never' = 'never'): ItemInstance {
    const item: ItemInstance = {
      id: this.nextId++, code: base.code, quality, ilvl, identified: quality <= QUALITY.SUPERIOR,
      quantity: 1, durability: 0, maxDurability: 0, defense: 0, invW: base.invWidth, invH: base.invHeight, levelReq: base.levelReq,
      prefixes: [], suffixes: [], sockets: 0, socketed: [], stats: [],
    };
    if (base.code === 'gld') {
      item.quantity = Math.max(rng.pick(5 * ilvl) + ilvl, 1);
      return item;
    }
    if (base.category !== 'misc' && !base.noDurability && base.durability > 0) {
      const half = base.durability >> 1;
      item.maxDurability = Math.min(base.durability, 255);
      item.durability = Math.min(rng.pick(half) + half, 255);
    }
    if (base.category === 'armor') item.defense = base.minAc + rng.pick(base.maxAc - base.minAc + 1);
    // 출처: D2MOO D2GAME_InitItemStats — 매직 이상은 스택 수량 1
    if (generate && this.gen && base.code !== 'gld') {
      // 원작은 아이템 시드(품질·접사)와 유닛 시드(기본 능력치)를 따로 쓴다
      const itemRng = new Rng(Number(rng.next() & 0xffffffffn) || 1);
      this.gen.applyQuality(item, base, quality, itemRng, rng, { droppedUniques: this.droppedUniques, ethereal: eth });
    }
    // 출처: D2MOO D2Game ITEMS/Items.cpp — 수량 = rand(spawnstack − minstack) + minstack (spawnstack 이 없거나 작으면 max(minstack, maxstack))
    if (base.stackable) {
      const spawn = base.spawnStack < base.minStack || !base.spawnStack ? Math.max(base.minStack, base.maxStack) : base.spawnStack;
      item.quantity = Math.max(base.minStack + rng.pick(spawn - base.minStack), 1);
    }
    return item;
  }
}
