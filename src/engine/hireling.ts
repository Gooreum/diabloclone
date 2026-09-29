// 용병(hireling): hireling.txt 표, 고용 목록, 고용 가격·레벨, 레벨별 스탯·스킬, 경험치, 부활 비용.
// 출처: D2MOO D2Common/src/DataTbls/MonsterTbls.cpp — DATATBLS_LoadHirelingTxt, DATATBLS_GetHirelingTxtRecordFromIdAndLevel,
//       DATATBLS_GetNextHirelingTxtRecordFromVendorIdAndDifficulty / FromActAndDifficulty / FromNameId
// 출처: D2MOO D2Common/src/Monsters/Monsters.cpp — MONSTERS_HirelingInit, MONSTERS_GetHirelingExpForNextLevel, MONSTERS_GetHirelingResurrectionCost
// 출처: D2MOO D2Game/src/UNIT/SUnitNpc.cpp — D2GAME_NPC_FirstFn_6FCC67D0 (고용 목록)
// 출처: D2MOO D2Game/src/MONSTER/MonsterAI.cpp — MONSTERAI_UpdateMercStatsAndSkills (레벨별 스탯)
// 출처: D2MOO D2Game/src/UNIT/SUnitDmg.cpp — SUNITDMG_AddExperienceForHireling / SUNITDMG_ComputeExperienceGain (용병 경험치 상한)
// (https://github.com/ThePhrozenKeep/D2MOO)
import type { TxtRow } from '../formats/txt';
import { Rng } from './rng';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

/** hireling.txt Skill1~6 / Mode / Chance / ChancePerLvl / Level / LvlPerLvl */
export interface HirelingSkill { name: string; mode: number; chance: number; chancePerLvl: number; level: number; lvlPerLvl: number }

export interface HirelingRow {
  version: number;
  /** 용병 종류 번호 (Act 1: 0 불 화살 / 1 얼음 화살) */
  id: number;
  /** monstats.txt 행 번호 (hcIdx) — 271 roguehire */
  cls: number;
  /** 1 부터 (Act 1 = 1) */
  act: number;
  /** 1 Normal / 2 Nightmare / 3 Hell */
  difficulty: number;
  level: number;
  /** 고용 NPC 의 monstats 행 번호 (150 Kashya) */
  seller: number;
  /** 이름 문자열 키 목록 (NameFirst ~ NameLast, 원작 tbl 번호 연속 구간) */
  names: string[];
  gold: number; expPerLvl: number;
  hp: number; hpPerLvl: number; defense: number; defPerLvl: number;
  str: number; strPerLvl: number; dex: number; dexPerLvl: number;
  ar: number; arPerLvl: number; share: number;
  dmgMin: number; dmgMax: number; dmgPerLvl: number;
  resist: number; resistPerLvl: number;
  /** hiredesc.txt 행 번호 (1 Fire Arrow, 2 Cold Arrow …) → 문자열 strhirespecial<번호> */
  hireDesc: number;
  defaultChance: number;
  skills: HirelingSkill[];
  head: number; torso: number; weapon: number; shield: number;
}

/** NameFirst~NameLast (merc01 ~ merc41) 사이 문자열 키. 원작은 tbl 번호 연속 구간 — 키 끝 숫자로 같은 구간을 만든다 */
function nameRange(first: string, last: string): string[] {
  const a = /^(.*?)(\d+)$/.exec(first), b = /^(.*?)(\d+)$/.exec(last);
  if (!a || !b || a[1] !== b[1]) return first ? [first] : [];
  const pad = (a[2] as string).length, from = Number(a[2]), to = Number(b[2]);
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${a[1]}${String(i).padStart(pad, '0')}`);
  return out;
}

export class HirelingDb {
  readonly rows: HirelingRow[] = [];
  private readonly version: number;

  /** @param expansion 확장팩이면 Version 100 행 (클래식은 0) */
  constructor(rows: TxtRow[], hireDesc: TxtRow[] = [], expansion = false) {
    this.version = expansion ? 100 : 0;
    const descIdx = new Map<string, number>();
    hireDesc.forEach((r, i) => r.Code && descIdx.set(r.Code, i));
    for (const r of rows) {
      if (!r.Hireling || r.Hireling === 'Expansion' || r.Id === undefined || r.Id === '') continue;
      const skills: HirelingSkill[] = [];
      for (let i = 1; i <= 6; i++) {
        const name = r[`Skill${i}`] ?? '';
        if (!name) continue;
        skills.push({ name, mode: n(r[`Mode${i}`]), chance: n(r[`Chance${i}`]), chancePerLvl: n(r[`ChancePerLvl${i}`]), level: n(r[`Level${i}`]), lvlPerLvl: n(r[`LvlPerLvl${i}`]) });
      }
      this.rows.push({
        version: n(r.Version), id: n(r.Id), cls: n(r.Class), act: n(r.Act), difficulty: n(r.Difficulty), level: n(r.Level), seller: n(r.Seller),
        names: nameRange(r.NameFirst ?? '', r.NameLast ?? ''), gold: n(r.Gold), expPerLvl: n(r['Exp/Lvl']),
        hp: n(r.HP), hpPerLvl: n(r['HP/Lvl']), defense: n(r.Defense), defPerLvl: n(r['Def/Lvl']),
        str: n(r.Str), strPerLvl: n(r['Str/Lvl']), dex: n(r.Dex), dexPerLvl: n(r['Dex/Lvl']),
        ar: n(r.AR), arPerLvl: n(r['AR/Lvl']), share: n(r.Share),
        dmgMin: n(r['Dmg-Min']), dmgMax: n(r['Dmg-Max']), dmgPerLvl: n(r['Dmg/Lvl']),
        resist: n(r.Resist), resistPerLvl: n(r['Resist/Lvl']),
        hireDesc: descIdx.get(r.HireDesc ?? '') ?? 0, defaultChance: n(r.DefaultChance), skills,
        head: n(r.Head), torso: n(r.Torso), weapon: n(r.Weapon), shield: n(r.Shield),
      });
    }
  }

  /** 출처: DATATBLS_GetNextHirelingTxtRecordFromVendorIdAndDifficulty — Seller 와 난이도(+1)·버전이 같은 다음 행 */
  byVendor(seller: number, difficulty: number, after?: HirelingRow): HirelingRow | undefined {
    const start = after ? this.rows.indexOf(after) + 1 : 0;
    return this.rows.slice(start).find((r) => r.seller === seller && r.difficulty === difficulty + 1 && r.version === this.version);
  }

  /**
   * 출처: DATATBLS_GetNextHirelingTxtRecordFromActAndDifficulty — 막(+1)·난이도(+1)·버전이 같고, 이전 행이 있으면 그 레벨과 같은 다음 행.
   * (Act 1 Normal = Id 0·1 의 레벨 3 행 두 개)
   */
  byAct(act0: number, difficulty: number, after?: HirelingRow): HirelingRow | undefined {
    const start = after ? this.rows.indexOf(after) + 1 : 0;
    const lvl = after?.level ?? 0;
    return this.rows.slice(start).find((r) => r.act === act0 + 1 && r.difficulty === difficulty + 1 && r.version === this.version && (!lvl || r.level === lvl));
  }

  /** 출처: DATATBLS_GetHirelingTxtRecordFromIdAndLevel — 같은 Id 중 레벨이 nLevel 이하인 마지막 행 (첫 행은 레벨과 무관하게 후보) */
  byIdAndLevel(id: number, level: number): HirelingRow | undefined {
    let best: HirelingRow | undefined;
    for (const r of this.rows) {
      if (r.version !== this.version) continue;
      if (r.id === id) {
        if (best && r.level > level) return best;
        best = r;
      } else if (r.id > id && best) return best;
    }
    return best;
  }

  /** 출처: DATATBLS_GetNextHirelingTxtRecordFromNameId — 이름이 NameFirst~NameLast 안에 드는 첫 행 */
  byName(nameKey: string): HirelingRow | undefined {
    return this.rows.find((r) => r.version === this.version && r.names.includes(nameKey));
  }
}

/** 캐릭터 저장에 넣는 용병 (원작 .d2s 용병 기록: 이름·시드·종류·경험치 + 사망 여부) */
export interface MercSave { name: string; seed: number; hirelingId: number; level: number; experience: number; dead: boolean }

/** 고용 목록 한 칸 (원작 D2MercDataStrc: 이름·시드·고용됨·목록에 보임) */
export interface MercEntry { name: string; seed: number; hired: boolean; available: boolean }

/**
 * 고용 목록 만들기. 출처: D2GAME_NPC_FirstFn_6FCC67D0 —
 *   이름마다 시드 = ITEMS_RollRandomNumber, 10 번: 무작위 시작 칸부터 아직 보이지 않은 첫 칸을 보이게 (한 바퀴 돌면 끝)
 */
export function buildHireList(row: HirelingRow, seed: Rng): MercEntry[] {
  const list: MercEntry[] = row.names.map((name) => ({ name, seed: seed.roll(), hired: false, available: false }));
  const count = list.length;
  for (let i = 0; i < 10; i++) {
    const startIdx = seed.pick(count);
    let k = startIdx;
    for (;;) {
      const e = list[k] as MercEntry;
      if (!e.available && !e.hired) {
        e.available = true;
        break;
      }
      k++;
      if (k >= count) k = 0;
      if (k === startIdx) return list;
    }
  }
  return list;
}

/** MONSTERS_HirelingInit 결과 (D2HirelingInitStrc) */
export interface HirelingInit {
  id: number; level: number; hp: number; str: number; dex: number; gold: number; experience: number;
  defense: number; minDamage: number; maxDamage: number; share: number; resist: number; hireDesc: number;
}

/**
 * 고용 후보의 종류·레벨·가격. 출처: MONSTERS_HirelingInit —
 *   시드(low) 로 막·난이도 행 중 하나 고르고, levelUps = min(rand%5, 플레이어 레벨 − 행 레벨) (음수 가능),
 *   레벨 = 행 레벨 + levelUps, 가격 = Gold × (15·levelUps + 100) / 100 (최소 Gold), 경험치 = L² × Exp/Lvl × (L + 1)
 */
export function hirelingInit(db: HirelingDb, seed: number, playerLevel: number, act0: number, difficulty: number): HirelingInit | null {
  const rng = new Rng(seed >>> 0);
  const recs: HirelingRow[] = [];
  let r = db.byAct(act0, difficulty);
  while (r && recs.length < 16) {
    recs.push(r);
    r = db.byAct(act0, difficulty, r);
  }
  if (!recs.length) return null;
  const rec = recs[rng.pick(recs.length)] as HirelingRow;
  // 원작 D2MOO 디컴파일: (int)SEED_RollRandomNumber % 5. 근사(원작 미확인): 부호 있는 나머지면 레벨이 행 레벨보다 낮아질 수 있어
  //   (게임에서 보이지 않는 결과) 부호 없는 나머지로 계산
  const rand = (rng.roll() >>> 0) % 5;
  const levelUps = rand >= playerLevel - rec.level ? playerLevel - rec.level : rand;
  const level = rec.level + levelUps;
  const gold = Math.max(Math.trunc((rec.gold * (15 * levelUps + 100)) / 100), rec.gold);
  return {
    id: rec.id, level,
    hp: Math.max(levelUps * rec.hpPerLvl + rec.hp, 40),
    str: Math.max(((levelUps * rec.strPerLvl) >> 3) + rec.str, 10),
    dex: Math.max(((levelUps * rec.dexPerLvl) >> 3) + rec.dex, 10),
    gold,
    experience: Math.max(level * level * rec.expPerLvl * (level + 1), 0),
    defense: Math.max(rec.defense + levelUps * rec.defPerLvl, 0),
    minDamage: Math.max(rec.dmgMin + ((levelUps * rec.dmgPerLvl) >> 3), 0),
    maxDamage: Math.max(rec.dmgMax + ((levelUps * rec.dmgPerLvl) >> 3), 1),
    share: Math.max(rec.share, 0), resist: Math.max(rec.resist, 0), hireDesc: rec.hireDesc,
  };
}

/** 출처: MONSTERS_GetHirelingExpForNextLevel — Exp/Lvl × L × L × (L + 1) */
export const hirelingExp = (level: number, expPerLvl: number): number => expPerLvl * level * level * (level + 1);

/** 출처: MONSTERS_GetHirelingResurrectionCost — 15 × L × L / 2, 최대 50000 */
export const resurrectCost = (level: number): number => Math.min(Math.trunc((15 * level * level) / 2), 50000);

/** 레벨별 용병 스탯 (MONSTERAI_UpdateMercStatsAndSkills). 생명은 정수 (원작 <<8 을 되돌린 값) */
export interface MercStats {
  level: number; row: HirelingRow;
  str: number; dex: number; maxHp: number; defense: number; minDamage: number; maxDamage: number; toHit: number; resist: number;
  /** 원작 STAT_HPREGEN (1/256 생명 단위) = 최대 생명(<<8) / 2000 */
  hpRegen: number;
  /** 이 레벨 시작 경험치 · 다음 레벨 경험치 */
  minExp: number; nextExp: number;
  skills: { name: string; level: number; mode: number; chance: number; chancePerLvl: number }[];
}

/**
 * 출처: MONSTERAI_UpdateMercStatsAndSkills — 행 = Id 의 레벨 이하 마지막 행, levelUps = 레벨 − 행 레벨,
 *   Str/Dex = 기본 + levelUps × /Lvl / 8 (최소 10), HP = (HP + levelUps × HP/Lvl) (최소 40), 방어 = Defense + levelUps × Def/Lvl,
 *   피해 = Dmg ± levelUps × Dmg/Lvl / 8, AR = AR + levelUps × AR/Lvl, 저항 = Resist + levelUps × Resist/Lvl / 4,
 *   스킬 레벨 = Level + (levelUps × LvlPerLvl >> 5) (0~32), skills.txt reqlevel 이상이면 배움
 * @param maxLevel 원작 DATATBLS_GetMaxLevel(0) (experience.txt MaxLvl, 99)
 */
export function mercStats(db: HirelingDb, id: number, level: number, reqLevel: (skill: string) => number = () => 0, maxLevel = 99): MercStats | null {
  const row = db.byIdAndLevel(id, level);
  if (!row) return null;
  const up = level - row.level;
  const hp256 = Math.max((row.hp << 8) + up * (row.hpPerLvl << 8), 40 << 8);
  const skills: MercStats['skills'] = [];
  for (const s of row.skills) {
    if (s.mode >= 16) break;
    if (level < reqLevel(s.name)) continue;
    const lvl = Math.max(0, Math.min(32, s.level + ((up * s.lvlPerLvl) >> 5)));
    if (lvl > 0) skills.push({ name: s.name, level: lvl, mode: s.mode, chance: s.chance, chancePerLvl: s.chancePerLvl });
  }
  return {
    level, row,
    str: Math.max(row.str + Math.trunc((up * row.strPerLvl) / 8), 10),
    dex: Math.max(row.dex + Math.trunc((up * row.dexPerLvl) / 8), 10),
    maxHp: hp256 / 256,
    defense: Math.max(row.defense + up * row.defPerLvl, 0),
    minDamage: Math.max(row.dmgMin + Math.trunc((up * row.dmgPerLvl) / 8), 0),
    maxDamage: Math.max(row.dmgMax + Math.trunc((up * row.dmgPerLvl) / 8), 1),
    toHit: Math.max(row.ar + up * row.arPerLvl, 0),
    resist: Math.max(row.resist + Math.trunc((up * row.resistPerLvl) / 4), 0),
    hpRegen: Math.max(Math.trunc(hp256 / 2000), 0),
    minExp: hirelingExp(level, row.expPerLvl),
    nextExp: level < maxLevel - 1 ? hirelingExp(level + 1, row.expPerLvl) : 0,
    skills,
  };
}

/**
 * 몬스터 처치 시 용병 경험치. 출처: SUNITDMG_ComputeExperienceGain (용병: 한 번에 (Exp(L+1) − Exp(L)) >> 6 까지),
 *   sub (UNITS 경험치 분배) — 용병이 직접 죽이지 않았으면 × 86 / 256, SUNITDMG_AddExperienceForHireling — 용병 레벨이 플레이어 레벨 이상이면 없음
 * @param gain 레벨 차이 보정을 거친 경험치 (용병 레벨 기준)
 */
export function mercExpGain(gain: number, mercLevel: number, row: HirelingRow, byMerc: boolean): number {
  const cap = (hirelingExp(mercLevel + 1, row.expPerLvl) - hirelingExp(mercLevel, row.expPerLvl)) >>> 6;
  let g = Math.min(gain, cap);
  if (!byMerc) g = Math.trunc((86 * g) / 256);
  return Math.max(0, g);
}

/** 경험치로 오른 레벨 (출처: SUNITDMG_AddExperienceForHireling — Exp(L+1) 이하인 동안 +1, 최대 레벨 − 1 까지) */
export function mercLevelFor(exp: number, level: number, row: HirelingRow, maxLevel = 99): number {
  let l = level;
  while (l < maxLevel - 1 && hirelingExp(l + 1, row.expPerLvl) <= exp) l++;
  return l;
}
