// 개발용 프리셋 캐릭터 (99레벨, 클래식 5직업). 사양 → 기존 세이브 형식(CharacterSave).
// 모든 수치는 원작 표에서: charstats.txt (기본 스탯·블록), experience.txt (99레벨 = 레벨 98 행), skills.txt (클래스 스킬·선행·요구 레벨),
//   uniqueitems / setitems / magicprefix / magicsuffix / qualityitems (장비), levels.txt (웨이포인트).
// 포인트: 505 스탯 = 98 × 5 + Lam Esen 5 × 3 난이도, 110 스킬 = 98 + (Den 1 + Radament 1 + Izual 2) × 3 → Hell 까지 끝낸 캐릭터.
//   Golden Bird 생명 +20 도 난이도마다 (Act 3 퀘스트 보상, quests/act3.ts reward 'life' 20).
// 출처: The Arreat Summit — Quests (보상: Den of Evil 스킬 1, Radament 스킬 1, Lam Esen 스탯 5, Golden Bird 생명 20, Izual 스킬 2)
//       (https://classic.battle.net/diablo2exp/quests/)
import type { TxtRow } from '../formats/txt';
import type { GameData } from './game';
import type { ItemGen, MagicAffix } from './itemgen';
import type { ItemBase } from './items';
import { beltBoxes, requirements, type BodyLoc, type Placed } from './inventory';
import { addExperience, classStats, createCharacter, expTable, spendStat, type Character, type ClassName, type ClassStats } from './player';
import { computeDerived } from './charstats';
import { blockChance } from './combat';
import { learnSkill } from './skills/rules';
import { CLASS_CODE, type SkillRecord } from './skills/db';
import { MaxRng } from './rng';
import { QUALITY, type ItemInstance } from './treasure';
import { makeSave, type CharacterSave } from './save';
import { QFLAG, QUEST_WORDS } from './quests/record';

export type Opt = 'ed' | 'ias' | 'ar' | 'leech' | 'skills' | 'fcr' | 'res' | 'life' | 'frw';
export type Gear =
  | { unique: string }
  | { set: string }
  /** 상급(Superior): 붙을 수 있는 상급 행 중 옵션 최대값 합이 가장 큰 것 */
  | { superior: { type: string } }
  /** 최대 옵션 레어: 노멀 등급 중 가장 좋은 베이스 + 옵션마다 값이 가장 큰 클래식 레어 접사 */
  | { rare: { type: string; opts: Opt[] } };

export interface PresetSpec {
  /** 파일 이름 (src/presets/<id>.json), 개발 진입점 ?preset=<id> */
  id: string;
  /** 캐릭터 이름 (원작 규칙: 영문·하이픈) */
  name: string;
  cls: ClassName;
  build: string;
  /** 20까지 올리는 스킬 4개 (skills.txt skill 이름) */
  core: string[];
  /** 남은 4포인트 */
  bonus: string;
  /** 오른쪽 마우스 스킬 */
  right: string;
  gear: Partial<Record<BodyLoc, Gear>>;
  /** 팔라딘: 민첩을 방패 최대 블록 75% 까지 */
  block75?: boolean;
  /** 사양과 다르게 정한 것 (데이터·원작 규칙 때문에) */
  notes: string[];
}

/** 사양 5개 (사용자 지정 + 데이터로 확인해 바꾼 무기) */
export const PRESETS: PresetSpec[] = [
  {
    id: 'amazon', name: 'Preset-Amazon', cls: 'Amazon', build: 'Lightning Javazon',
    core: ['Lightning Fury', 'Charged Strike', 'Lightning Strike', 'Power Strike'], bonus: 'Lightning Bolt', right: 'Lightning Fury',
    gear: {
      rarm: { superior: { type: 'jave' } }, larm: { unique: 'The Ward' }, head: { unique: 'Tarnhelm' }, tors: { unique: 'Goldskin' },
      glov: { rare: { type: 'glov', opts: ['ias', 'res'] } }, belt: { unique: 'Nightsmoke' }, feet: { rare: { type: 'boot', opts: ['frw', 'res'] } },
      rrin: { set: 'Angelic Halo' }, lrin: { unique: 'The Stone of Jordan' }, neck: { set: 'Angelic Wings' },
    },
    notes: ['레어 자벨린 → 상급 Throwing Spear: 클래식은 던지는 무기에 매직·레어 접사가 붙지 않고(ITEMMODS_CanItemHaveMagicAffix), 유니크·세트 자벨린도 없다'],
  },
  {
    id: 'sorceress', name: 'Preset-Sorc', cls: 'Sorceress', build: 'Cold (Blizzard)',
    core: ['Blizzard', 'Frozen Orb', 'Glacial Spike', 'Ice Blast'], bonus: 'Cold Mastery', right: 'Blizzard',
    gear: {
      rarm: { unique: 'The Iron Jang Bong' }, head: { unique: 'Tarnhelm' }, tors: { rare: { type: 'tors', opts: ['res', 'life'] } },
      glov: { unique: 'Magefist' }, belt: { rare: { type: 'belt', opts: ['res', 'life'] } }, feet: { rare: { type: 'boot', opts: ['frw', 'res'] } },
      rrin: { unique: 'The Stone of Jordan' }, lrin: { unique: 'The Stone of Jordan' }, neck: { unique: 'The Eye of Etlich' },
    },
    notes: ['레어 지팡이 → The Iron Jang Bong (사용자 선택), 방패 없음: 클래식 지팡이는 모두 양손이라 The Ward 를 함께 들 수 없다'],
  },
  {
    id: 'necromancer', name: 'Preset-Necro', cls: 'Necromancer', build: 'Skeleton Summoner',
    core: ['Raise Skeleton', 'Skeleton Mastery', 'Raise Skeletal Mage', 'Corpse Explosion'], bonus: 'Summon Resist', right: 'Raise Skeleton',
    gear: {
      rarm: { unique: 'Umes Lament' }, larm: { unique: 'The Ward' }, head: { unique: 'Tarnhelm' }, tors: { rare: { type: 'tors', opts: ['res', 'life'] } },
      glov: { unique: 'Magefist' }, belt: { rare: { type: 'belt', opts: ['res', 'life'] } }, feet: { rare: { type: 'boot', opts: ['frw', 'res'] } },
      rrin: { unique: 'The Stone of Jordan' }, lrin: { unique: 'The Stone of Jordan' }, neck: { unique: 'The Eye of Etlich' },
    },
    notes: ["레어 완드 → Ume's Lament (사용자: 레어보다 좋은 유니크로) — 네크로 +2·시전 20% 로 레어 최대치와 같고 Terror +3·Decrepify +2 가 더 있다"],
  },
  {
    id: 'paladin', name: 'Preset-Pala', cls: 'Paladin', build: 'Hammerdin',
    core: ['Blessed Hammer', 'Concentration', 'Blessed Aim', 'Vigor'], bonus: 'Holy Shield', right: 'Blessed Hammer',
    gear: {
      rarm: { rare: { type: 'scep', opts: ['skills', 'fcr'] } }, larm: { unique: 'The Ward' }, head: { unique: 'Tarnhelm' }, tors: { unique: 'Goldskin' },
      glov: { unique: 'Magefist' }, belt: { rare: { type: 'belt', opts: ['res', 'life'] } }, feet: { rare: { type: 'boot', opts: ['frw', 'res'] } },
      rrin: { unique: 'The Stone of Jordan' }, lrin: { unique: 'The Stone of Jordan' }, neck: { unique: 'The Eye of Etlich' },
    },
    block75: true,
    notes: ['레어 셉터 유지 — 클래식 유니크 셉터(Rusthandle +1, Stormeye, Knell Striker)는 +2 레어보다 못하다', '셉터 시전속도는 최대 10% (of the Apprentice): of the Magus 는 셉터 제외(etype scep), 옛 행은 frequency 0 이라 나오지 않는다'],
  },
  {
    id: 'barbarian', name: 'Preset-Barb', cls: 'Barbarian', build: 'Whirlwind',
    core: ['Whirlwind', 'Mace Mastery', 'Battle Orders', 'Battle Command'], bonus: 'Shout', right: 'Whirlwind',
    gear: {
      rarm: { unique: 'Steeldriver' }, head: { unique: 'Tarnhelm' }, tors: { unique: 'Goldskin' },
      glov: { rare: { type: 'glov', opts: ['ias', 'ar', 'res'] } }, belt: { unique: 'Nightsmoke' }, feet: { rare: { type: 'boot', opts: ['frw', 'res'] } },
      rrin: { set: 'Angelic Halo' }, lrin: { unique: 'The Stone of Jordan' }, neck: { set: 'Angelic Wings' },
    },
    notes: ['Bonesnap → Steeldriver: Bonesnap 은 확장팩 전용(클래식 uniqueitems 에 없음). 사용자: 레어보다 좋은 유니크로 (공속 40·대미지 +250%·요구치 −50%)'],
  },
];

/** 옵션 → 속성 코드 (magicprefix/suffix mod code). skills 는 클래스 코드 (ama/sor/nec/pal/bar) */
const OPT_CODES: Record<Exclude<Opt, 'skills'>, string[]> = {
  ed: ['dmg%'], ias: ['swing1', 'swing2', 'swing3'], ar: ['att'], leech: ['lifesteal'], fcr: ['cast1', 'cast2', 'cast3'],
  res: ['res-all', 'res-fire', 'res-cold', 'res-ltng', 'res-pois'], life: ['hp'], frw: ['move1', 'move2', 'move3'],
};
/** 레어 접사 수 한도 (출처: D2GAME_RollRareItem — 접두·접미 각 최대 3) */
const MAX_PREFIX = 3, MAX_SUFFIX = 3;
/** 99레벨 경험치 = experience.txt 레벨 98 행 (그 레벨 → 99 에 필요한 누적 경험치) */
export const PRESET_LEVEL = 99;
/** 세 난이도 퀘스트 보상 */
const QUEST_STAT = 5 * 3, QUEST_SKILL = (1 + 1 + 2) * 3, QUEST_LIFE = 20 * 3;
/** 클래식 퀘스트 워드: Act 1~4 퀘스트와 막 완료 (quests/messages-acts.ts QW: 0 … A4COMPLETED 28) */
const LAST_QUEST_WORD = 28;
/** 원작 진행 값: Hell 완료 = 12 */
const PROGRESSION_HELL_DONE = 12;

export interface PresetTables { charstats: TxtRow[]; experience: TxtRow[] }

export interface GearLine { slot: BodyLoc; name: string; base: string; quality: string; stats: string[] }
export interface PresetSummary {
  id: string; name: string; cls: ClassName; build: string;
  stats: { str: number; dex: number; vit: number; ene: number; invested: { str: number; dex: number; vit: number; ene: number } };
  derived: { life: number; mana: number; res: { fi: number; co: number; li: number; po: number }; block: number; blockChance: number };
  skills: { name: string; points: number }[];
  gear: GearLine[];
  notes: string[];
  /** 레어에 못 붙인 옵션 */
  unmet: string[];
}
export interface PresetResult { save: CharacterSave; summary: PresetSummary }

const isClassic = (version: number) => version < 100;

/** 노멀 등급 클래식 베이스 중 가장 좋은 것 (방어구: 최대 방어, 벨트: 칸 수 → 방어, 무기: 평균 피해 — 던지는 무기는 던지기 피해) */
export function bestBase(data: GameData, type: string): ItemBase {
  const { items } = data;
  const cands = [...items.bases.values()].filter((b) => items.isType(b, type) && isClassic(b.version) && b.code === b.normCode && b.spawnable && !b.quest);
  const score = (b: ItemBase): number[] => {
    if (items.isType(b, 'belt')) return [beltBoxes(items, { code: b.code } as ItemInstance), b.maxAc];
    if (items.isType(b, 'armo')) return [b.maxAc];
    const thrown = [...items.typeChain(b.type)].some((t) => items.types.get(t)?.throwable);
    if (thrown) return [b.throwMinDam + b.throwMaxDam];
    return [b.twoHanded ? b.twoHandMinDam + b.twoHandMaxDam : b.minDam + b.maxDam];
  };
  const cmp = (a: number[], b: number[]) => a.map((v, i) => v - (b[i] ?? 0)).find((d) => d !== 0) ?? 0;
  const best = cands.sort((a, b) => cmp(score(b), score(a)) || a.code.localeCompare(b.code))[0];
  if (!best) throw new Error(`no classic base for type ${type}`);
  return best;
}

/** 기본 아이템: 아이템 레벨 99, 기본 방어·내구·수량 최대 */
function baseItem(data: GameData, base: ItemBase): ItemInstance {
  const it = data.treasure.createItem(base, PRESET_LEVEL, new MaxRng(), QUALITY.NORMAL);
  it.durability = it.maxDurability;
  if (base.stackable) it.quantity = Math.max(base.maxStack, 1);
  it.identified = true;
  return it;
}

/** 접사가 주는 옵션 값 (res-all 은 원소 4개 몫) */
function affixValue(a: MagicAffix, codes: string[]): number {
  return a.mods.filter((m) => codes.includes(m.code)).reduce((s, m) => s + Math.max(m.min, m.max) * (m.code === 'res-all' ? 4 : 1), 0);
}

/** 최대 옵션 레어: 옵션 순서대로 값이 가장 큰 접사 하나씩, 저항은 남은 접두 칸을 원소별로 채운다 */
function makeRare(data: GameData, gen: ItemGen, cls: ClassName, base: ItemBase, opts: Opt[]): { item: ItemInstance; unmet: string[] } {
  const item = baseItem(data, base);
  const alvl = gen.affixLevel(PRESET_LEVEL, base);
  const unmet: string[] = [];
  const all = [...gen.prefixes, ...gen.suffixes];
  const room = (a: MagicAffix) => (a.prefix ? item.prefixes.length < MAX_PREFIX : item.suffixes.length < MAX_SUFFIX);
  const taken = () => new Set([...item.prefixes.map((i) => gen.prefixes[i]!), ...item.suffixes.map((i) => gen.suffixes[i]!)].flatMap((a) => a.mods.map((m) => m.code)));
  const add = (a: MagicAffix) => (a.prefix ? item.prefixes : item.suffixes).push(a.idx);
  const best = (codes: string[]): MagicAffix | undefined => {
    const used = taken();
    return all
      .filter((a) => room(a) && gen.rareAffixAllowed(a, base, item, alvl) && affixValue(a, codes) > 0 && !a.mods.some((m) => codes.includes(m.code) && used.has(m.code)))
      .sort((a, b) => affixValue(b, codes) - affixValue(a, codes) || a.levelReq - b.levelReq || Number(a.prefix) - Number(b.prefix) || a.idx - b.idx)[0];
  };
  for (const o of opts.filter((x) => x !== 'res')) {
    const a = best(o === 'skills' ? [CLASS_CODE[cls]] : OPT_CODES[o]);
    if (a) add(a);
    else unmet.push(o);
  }
  if (opts.includes('res')) {
    let n = 0;
    for (let a = best(OPT_CODES.res); a; a = best(OPT_CODES.res)) {
      add(a);
      n++;
    }
    if (!n) unmet.push('res');
  }
  // 레어 이름: 이 베이스에 붙을 수 있는 첫 레어 접두·접미 이름 (raresuffix/rareprefix itype·etype)
  const nameOk = (r: { itypes: string[]; etypes: string[] }) => r.itypes.some((t) => data.items.isType(base, t)) && !r.etypes.some((t) => data.items.isType(base, t));
  const rp = gen.rarePrefixes.find(nameOk)?.idx ?? 0, rs = gen.rareSuffixes.find(nameOk)?.idx ?? 0;
  gen.makeFixed(item, base, { prefixes: item.prefixes, suffixes: item.suffixes, rareName: [rp, rs] });
  return { item, unmet };
}

function makeGear(data: GameData, gen: ItemGen, cls: ClassName, g: Gear): { item: ItemInstance; unmet: string[] } {
  if ('unique' in g) {
    const u = gen.uniques.find((x) => x.name === g.unique);
    if (!u || !u.enabled) throw new Error(`classic unique not found: ${g.unique}`);
    const base = data.items.base(u.code)!;
    const item = baseItem(data, base);
    gen.makeFixed(item, base, { uniqueIdx: u.idx });
    return { item, unmet: [] };
  }
  if ('set' in g) {
    const s = gen.setItems.find((x) => x.name === g.set);
    if (!s || s.rarity < 0) throw new Error(`classic set item not found: ${g.set}`);
    const base = data.items.base(s.code)!;
    const item = baseItem(data, base);
    gen.makeFixed(item, base, { setIdx: s.idx });
    return { item, unmet: [] };
  }
  if ('superior' in g) {
    const base = bestBase(data, g.superior.type);
    const item = baseItem(data, base);
    const rows = gen.superiorRows(base);
    const sum = (r: { mods: { min: number; max: number }[] }) => r.mods.reduce((s, m) => s + Math.max(m.min, m.max), 0);
    const pick = [...rows].sort((a, b) => sum(b) - sum(a) || a.idx - b.idx)[0];
    if (!pick) throw new Error(`no superior row for ${base.code}`);
    gen.makeFixed(item, base, { superiorIdx: pick.idx });
    return { item, unmet: [] };
  }
  return makeRare(data, gen, cls, bestBase(data, g.rare.type), g.rare.opts);
}

/** 장비 하나를 뺀 나머지 장비(세트 보너스 포함)로 본 유효 힘·민첩 보너스 */
function bonusWithout(ch: Character, cs: ClassStats, eq: Record<string, ItemInstance>, data: GameData, gen: ItemGen, slot: string | null): { str: number; dex: number } {
  const rest = { ...eq };
  if (slot) delete rest[slot];
  const d = computeDerived(ch, cs, rest, data.items, gen);
  return { str: d.str - ch.str, dex: d.dex - ch.dex };
}

/** 모든 장비 요구치를 채우는 최소 기본 힘·민첩 (각 장비는 자기 보너스 없이 — 원작은 장착하기 전에 요구치를 본다) */
export function minStatsFor(ch: Character, cs: ClassStats, eq: Record<string, ItemInstance>, data: GameData, gen: ItemGen): { str: number; dex: number } {
  let str = cs.str, dex = cs.dex;
  for (const [slot, it] of Object.entries(eq)) {
    const r = requirements(data.items, it);
    const b = bonusWithout(ch, cs, eq, data, gen, slot);
    str = Math.max(str, r.str - b.str);
    dex = Math.max(dex, r.dex - b.dex);
  }
  return { str, dex };
}

/** 방패 블록 75% 에 필요한 최소 기본 민첩 (출처: combat.ts blockChance — 원작 공식) */
export function dexForMaxBlock(ch: Character, cs: ClassStats, eq: Record<string, ItemInstance>, data: GameData, gen: ItemGen): number {
  const d = computeDerived(ch, cs, eq, data.items, gen);
  const bonus = d.dex - ch.dex;
  for (let dex = cs.dex; dex < 2000; dex++) if (blockChance(d.block, cs.blockFactor, dex + bonus, PRESET_LEVEL) >= 75) return dex;
  throw new Error('75% block unreachable');
}

/** 클래스 스킬 30개 (skills.txt charclass) */
export function classSkills(data: GameData, cls: ClassName): SkillRecord[] {
  return [...data.skills!.byId.values()].filter((s) => s.charclass === CLASS_CODE[cls]);
}

function allocateSkills(ch: Character, data: GameData, spec: PresetSpec): void {
  const db = data.skills!;
  const list = classSkills(data, spec.cls);
  const learn = (s: SkillRecord) => {
    if (!learnSkill(ch, s, db)) throw new Error(`[프리셋] ${spec.cls}: ${s.name} 배우기 실패 (레벨 ${ch.level}, 남은 ${ch.skillPoints})`);
  };
  // 전부 1: 요구 레벨 순으로 돌며 선행 스킬이 채워진 것부터
  const left = [...list].sort((a, b) => a.reqLevel - b.reqLevel || a.id - b.id);
  while (left.length) {
    const i = left.findIndex((s) => s.reqSkills.every((r) => (ch.skills[db.byNameOf(r)?.id ?? -1] ?? 0) > 0));
    if (i < 0) throw new Error(`[프리셋] ${spec.cls}: 선행 스킬 순환`);
    learn(left.splice(i, 1)[0]!);
  }
  const byName = (n: string) => {
    const s = list.find((x) => x.name === n);
    if (!s) throw new Error(`[프리셋] ${spec.cls}: 스킬 없음 ${n}`);
    return s;
  };
  for (const n of spec.core) while ((ch.skills[byName(n).id] ?? 0) < (byName(n).maxLvl || 20)) learn(byName(n));
  while (ch.skillPoints > 0) learn(byName(spec.bonus));
}

const QUALITY_NAME: Record<number, string> = { 1: 'Inferior', 2: 'Normal', 3: 'Superior', 4: 'Magic', 5: 'Set', 6: 'Rare', 7: 'Unique' };

function itemName(gen: ItemGen, base: ItemBase, it: ItemInstance): string {
  if (it.uniqueIdx !== undefined) return gen.uniques[it.uniqueIdx]?.name ?? '';
  if (it.setIdx !== undefined) return gen.setItems[it.setIdx]?.name ?? '';
  if (it.rareName) return `${gen.rarePrefixes[it.rareName[0]]?.name ?? ''} ${gen.rareSuffixes[it.rareName[1]]?.name ?? ''}`;
  return base.name;
}

export function buildPreset(spec: PresetSpec, data: GameData, tables: PresetTables): PresetResult {
  const gen = data.treasure.gen as ItemGen;
  const cs = classStats(tables.charstats, spec.cls);
  const ch = createCharacter(cs);
  const exp = expTable(tables.experience, spec.cls);
  addExperience(ch, cs, exp, exp.threshold(PRESET_LEVEL - 1));
  if (ch.level !== PRESET_LEVEL) throw new Error(`[프리셋] ${spec.cls}: 레벨 ${ch.level}`);
  // 세 난이도 퀘스트 보상
  ch.statPoints += QUEST_STAT;
  ch.skillPoints += QUEST_SKILL;
  ch.maxLife += QUEST_LIFE;
  ch.life += QUEST_LIFE;

  // 장비 (아이템 번호는 1 부터 순서대로 — 불러올 때 TreasureDb 가 다음 번호를 그 위로 맞춘다)
  let nextId = 1;
  const equipment: Record<string, ItemInstance> = {};
  const unmet: string[] = [];
  for (const [slot, g] of Object.entries(spec.gear) as [BodyLoc, Gear][]) {
    const r = makeGear(data, gen, spec.cls, g);
    r.item.id = nextId++;
    equipment[slot] = r.item;
    for (const u of r.unmet) unmet.push(`${slot}: ${u}`);
  }

  // 스탯: 힘·민첩 = 요구치 최소 (팔라딘 민첩 = 블록 75%), 나머지 활력, 에너지 0
  const need = minStatsFor(ch, cs, equipment, data, gen);
  const dexNeed = spec.block75 ? Math.max(need.dex, dexForMaxBlock(ch, cs, equipment, data, gen)) : need.dex;
  const spend = (stat: 'str' | 'dex' | 'vit', target: number) => {
    while (ch[stat] < target) if (!spendStat(ch, cs, stat)) throw new Error(`[프리셋] ${spec.cls}: 스탯 포인트 부족 (${stat} ${ch[stat]} → ${target})`);
  };
  spend('str', need.str);
  spend('dex', dexNeed);
  while (ch.statPoints > 0) spendStat(ch, cs, 'vit');

  allocateSkills(ch, data, spec);
  const right = classSkills(data, spec.cls).find((s) => s.name === spec.right);
  ch.rightSkill = right?.id ?? 0;
  ch.leftSkill = 0;

  // 소지품: 벨트 전부 풀 리쥬, 인벤토리 TP·ID 책 + 맨 아랫줄 풀 리쥬
  const make = (code: string) => {
    const it = baseItem(data, data.items.base(code)!);
    it.id = nextId++;
    return it;
  };
  const belt = Array.from({ length: beltBoxes(data.items, equipment.belt) }, () => make('rvl'));
  const inventory: Placed[] = [{ item: make('tbk'), x: 0, y: 0 }, { item: make('ibk'), x: 1, y: 0 }];
  for (let x = 0; x < 10; x++) inventory.push({ item: make('rvl'), x, y: 3 });

  // Hell 까지 끝냄: 세 난이도 모든 웨이포인트·퀘스트 보상
  const waypoints = [...new Set([...data.objects!.levels.values()].filter((l) => l.act <= 3 && l.waypoint < 255).map((l) => l.waypoint))].sort((a, b) => a - b);
  const words = Array.from({ length: QUEST_WORDS }, (_, q) => (q <= LAST_QUEST_WORD ? 1 << QFLAG.REWARDGRANTED : 0));
  const save = makeSave(spec.name, ch, 0, {
    inventory, equipment, belt, stash: [], cube: [], stashGold: 0, corpse: {}, merc: null, quests: [],
    act: 0, difficulty: 2, difficultyUnlocked: 2, actByDiff: [0, 0, 0], progression: PROGRESSION_HELL_DONE,
    waypointsByDiff: [waypoints, waypoints, waypoints], questFlagsByDiff: [words, words, words],
  }, 0);

  const d = computeDerived(ch, cs, equipment, data.items, gen);
  const summary: PresetSummary = {
    id: spec.id, name: spec.name, cls: spec.cls, build: spec.build,
    stats: { str: ch.str, dex: ch.dex, vit: ch.vit, ene: ch.ene, invested: { str: ch.str - cs.str, dex: ch.dex - cs.dex, vit: ch.vit - cs.vit, ene: ch.ene - cs.ene } },
    derived: {
      life: Math.floor(d.maxLife), mana: Math.floor(d.maxMana), res: { fi: d.res.fi, co: d.res.co, li: d.res.li, po: d.res.po },
      block: d.block, blockChance: equipment.larm && data.items.isType(data.items.base(equipment.larm.code)!, 'shld') ? blockChance(d.block, cs.blockFactor, d.dex, ch.level) : 0,
    },
    skills: classSkills(data, spec.cls).map((s) => ({ name: s.name, points: ch.skills[s.id] ?? 0 })),
    gear: Object.entries(equipment).map(([slot, it]) => {
      const base = data.items.base(it.code)!;
      return { slot: slot as BodyLoc, name: itemName(gen, base, it), base: base.name, quality: QUALITY_NAME[it.quality] ?? '', stats: it.stats.map((s) => `${s.stat}${s.param ? `(${s.param})` : ''} ${s.value}`) };
    }),
    notes: spec.notes,
    unmet,
  };
  return { save, summary };
}

/** SUMMARY.md 한 직업 부분 */
export function summaryMarkdown(s: PresetSummary): string {
  const skills = s.skills.filter((k) => k.points > 1).map((k) => `${k.name} ${k.points}`).join(', ');
  const ones = s.skills.filter((k) => k.points === 1).map((k) => k.name).join(', ');
  return [
    `## ${s.cls} — ${s.build} (\`?preset=${s.id}\`, ${s.name})`,
    '',
    `- 스탯: 힘 ${s.stats.str} · 민첩 ${s.stats.dex} · 활력 ${s.stats.vit} · 에너지 ${s.stats.ene} (투자: 힘 +${s.stats.invested.str}, 민첩 +${s.stats.invested.dex}, 활력 +${s.stats.invested.vit})`,
    `- 장비 포함: 생명 ${s.derived.life} · 마나 ${s.derived.mana} · 저항 불/냉/번/독 ${s.derived.res.fi}/${s.derived.res.co}/${s.derived.res.li}/${s.derived.res.po} (Normal 기준)${s.derived.blockChance ? ` · 막기 ${s.derived.blockChance}%` : ''}`,
    `- 스킬: ${skills}; 나머지 1씩: ${ones}`,
    '- 장비:',
    ...s.gear.map((g) => `  - ${g.slot}: **${g.name}** (${g.quality} ${g.base}) — ${g.stats.join(', ')}`),
    ...(s.notes.length ? ['- 사양과 다른 점:', ...s.notes.map((n) => `  - ${n}`)] : []),
    ...(s.unmet.length ? [`- 레어에 못 붙인 옵션: ${s.unmet.join(', ')}`] : []),
    '',
  ].join('\n');
}
