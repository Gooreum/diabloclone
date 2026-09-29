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
  flippyFile: string;
  cost: number;
  durability: number;
  noDurability: boolean;
  minDam: number; maxDam: number;
  twoHandMinDam: number; twoHandMaxDam: number;
  /** 던지기 피해 (weapons.txt minmisdam/maxmisdam) */
  throwMinDam: number; throwMaxDam: number;
  /** 던지거나 쏠 때 생성할 미사일 (weapons.txt missiletype = missiles.txt Id) */
  missileType: number;
  twoHanded: boolean;
  /** 바바리안은 한 손으로 쥘 수 있는 양손 무기 (weapons.txt 1or2handed) */
  oneOrTwoHanded: boolean;
  /** belts.txt 행 (armor.txt belt) */
  beltType: number;
  /** 매직 레벨 (weapons/armor/misc.txt magic lvl — 접사 레벨 계산), 최대 소켓 (gemsockets), 보석 적용 (gemapplytype) */
  magicLvl: number; gemSockets: number; gemApplyType: number;
  /** 소켓에 넣을 수 있는 아이템 (hasinv) */
  hasInv: boolean;
  /** 유니크/세트 전용 인벤토리 그림 */
  uniqueInvFile: string; setInvFile: string;
  /** 상위 버전 (normcode/ubercode/ultracode), 상점 기본 가격 공식용 */
  normCode: string; uberCode: string; ultraCode: string;
  /** 방어도 최소/최대는 minAc/maxAc, 흡수(absorbs) · 속도(speed) */
  compactSave: boolean;
  /** 캐릭터 그래픽 코드 (alternategfx / alternateGfx) · 갑옷 부위별 무게 0 lit 1 med 2 hvy (armor.txt rArm lArm Torso Legs rSPad lSPad) */
  altGfx: string;
  armorGfx: { ra: number; la: number; tr: number; lg: number; s1: number; s2: number } | null;
  /** 사용 아이템 (misc.txt): pSpell 번호, 상태, 지속(len), stat1~3 과 calc1~3 */
  useable: boolean; pSpell: number; useState: string; useLen: number; useStats: { stat: string; calc: number }[];
  /** misc.txt BetterGem (한 단계 위 보석 코드, 'non' = 없음) */
  betterGem: string;
  strBonus: number; dexBonus: number;
  speed: number;
  minAc: number; maxAc: number;
  block: number;
  reqStr: number; reqDex: number;
  wclass: string;
  twoHandedWclass: string;
  hitClass: string;
  stackable: boolean;
  minStack: number; maxStack: number; spawnStack: number;
  quest: boolean;
  unique: boolean;
  /** 상인별 판매 수량 (weapons/armor/misc.txt <상인>Min/Max/MagicMin/MagicMax/MagicLvl), 상시 판매 (PermStoreItem) */
  vendors: Record<string, VendorStock>;
  permStore: boolean;
  /** bitfield1 & 1 이면 상점에서 매직으로도 판매 (출처: D2MOO ITEMS_CheckBitField1Flag1) */
  bitfield1: number;
  /** 악몽/지옥 상점 업그레이드 코드 (NightmareUpgrade / HellUpgrade, 'xxx' = 없음) */
  nightmareUpgrade: string; hellUpgrade: string;
  /** 반지·목걸이 도박 고정가 (gamble cost) */
  gambleCost: number;
}

export interface VendorStock { min: number; max: number; magicMin: number; magicMax: number; magicLvl: number }

/** weapons/armor/misc.txt 의 상인 컬럼 접두사 (Charsi Gheed Akara …) */
export const VENDOR_COLUMNS = ['Charsi', 'Gheed', 'Akara', 'Fara', 'Lysander', 'Drognan', 'Hratli', 'Alkor', 'Ormus', 'Elzix', 'Asheara', 'Cain', 'Halbu', 'Jamella', 'Larzuk', 'Malah', 'Drehya'];

export interface ItemTypeDef {
  code: string; name: string; equiv: string[]; normal: boolean; magic: boolean; rare: boolean; treasureClass: boolean; throwable: boolean;
  /** 이 타입이 쏘는 탄약 타입 (bow → bowq), 탄약 타입이 채우는 무기 타입 (bowq → bow) */
  shoots: string; quiver: string;
  /** 장착 가능 (Body) 과 위치 (BodyLoc1/2), 벨트에 넣을 수 있음 (Beltable) */
  body: boolean; bodyLoc1: string; bodyLoc2: string; beltable: boolean;
  /** 소켓 최대 수 (아이템 레벨 1~24 / 25~39 / 40+) */
  maxSock: [number, number, number];
  /** 이 타입의 클래스 전용 (ama/sor/…), 상점 페이지 */
  classCode: string; storePage: string;
  /** 지팡이 스킬 클래스 (itemtypes StaffMods: staf → sor, wand → nec, scep → pal) */
  staffMods: string;
  /** 수리 가능 (itemtypes Repair) */
  repair: boolean;
}

function vendorStock(r: TxtRow): Record<string, VendorStock> {
  const out: Record<string, VendorStock> = {};
  for (const v of VENDOR_COLUMNS) {
    const s = { min: n(r[`${v}Min`]), max: n(r[`${v}Max`]), magicMin: n(r[`${v}MagicMin`]), magicMax: n(r[`${v}MagicMax`]), magicLvl: n(r[`${v}MagicLvl`]) };
    if (s.max || s.magicMax) out[v.toLowerCase()] = s;
  }
  return out;
}

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
        shoots: r.Shoots ?? '', quiver: r.Quiver ?? '', repair: r.Repair === '1',
        body: n(r.Body) === 1, bodyLoc1: r.BodyLoc1 ?? '', bodyLoc2: r.BodyLoc2 ?? '', beltable: n(r.Beltable) === 1,
        maxSock: [n(r.MaxSock1), n(r.MaxSock25), n(r.MaxSock40)],
        classCode: r.Class ?? '', storePage: r.StorePage ?? '', staffMods: r.StaffMods ?? '',
      });
    }
    const add = (rows: TxtRow[], category: ItemCategory) => {
      for (const r of rows) {
        if (!r.code || r.code === 'Expansion') continue;
        this.bases.set(r.code, {
          code: r.code, name: r.name ?? r.code, namestr: r.namestr ?? r.code, category,
          type: r.type ?? '', type2: r.type2 ?? '', level: n(r.level), levelReq: n(r.levelreq), rarity: n(r.rarity),
          spawnable: n(r.spawnable) === 1, version: n(r.version),
          invWidth: n(r.invwidth) || 1, invHeight: n(r.invheight) || 1, invFile: r.invfile ?? '', flippyFile: r.flippyfile ?? '', cost: n(r.cost),
          durability: n(r.durability), noDurability: n(r.nodurability) === 1,
          minDam: n(r.mindam), maxDam: n(r.maxdam), twoHandMinDam: n(r['2handmindam']), twoHandMaxDam: n(r['2handmaxdam']),
          throwMinDam: n(r.minmisdam), throwMaxDam: n(r.maxmisdam), missileType: n(r.missiletype),
          twoHanded: n(r['2handed']) === 1, oneOrTwoHanded: n(r['1or2handed']) === 1, beltType: n(r.belt),
          magicLvl: n(r['magic lvl']), gemSockets: n(r.gemsockets), gemApplyType: n(r.gemapplytype), hasInv: n(r.hasinv) === 1,
          uniqueInvFile: r.uniqueinvfile ?? '', setInvFile: r.setinvfile ?? '',
          normCode: r.normcode ?? '', uberCode: r.ubercode ?? '', ultraCode: r.ultracode ?? '', compactSave: n(r.compactsave) === 1,
          altGfx: r.alternategfx || r.alternateGfx || r.code,
          armorGfx: r.Torso !== undefined && r.Torso !== '' ? { ra: n(r.rArm), la: n(r.lArm), tr: n(r.Torso), lg: n(r.Legs), s1: n(r.rSPad), s2: n(r.lSPad) } : null,
          useable: n(r.useable) === 1, pSpell: n(r.pSpell), useState: r.state ?? '', useLen: n(r.len),
          useStats: [1, 2, 3].map((i) => ({ stat: r[`stat${i}`] ?? '', calc: n(r[`calc${i}`]) })).filter((x) => x.stat),
          betterGem: r.BetterGem ?? '',
          strBonus: n(r.StrBonus), dexBonus: n(r.DexBonus), speed: n(r.speed),
          minAc: n(r.minac), maxAc: n(r.maxac), block: n(r.block),
          reqStr: n(r.reqstr), reqDex: n(r.reqdex),
          wclass: r.wclass ?? '', twoHandedWclass: r['2handedwclass'] ?? '', hitClass: r['hit class'] ?? '',
          stackable: n(r.stackable) === 1, minStack: n(r.minstack), maxStack: n(r.maxstack), spawnStack: n(r.spawnstack),
          quest: n(r.quest) > 0, unique: n(r.unique) === 1,
          vendors: vendorStock(r), permStore: n(r.PermStoreItem) === 1, bitfield1: n(r.bitfield1),
          nightmareUpgrade: r.NightmareUpgrade ?? 'xxx', hellUpgrade: r.HellUpgrade ?? 'xxx', gambleCost: n(r['gamble cost']),
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
