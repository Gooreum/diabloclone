// 챔피언·유니크·슈퍼유니크·미니언 (MonUMod.txt 수식어, SuperUniques.txt, 이름 표, MonPreset.txt).
// 출처: D2MOO — D2Game/src/MONSTER/MonsterUnique.cpp (https://github.com/ThePhrozenKeep/D2MOO)
//   sub_6FC6E940 (챔피언 확률 = MonUMod 0행 constants, cpick/upick 가중치 뽑기), sub_6FC6EE90 (upick 뽑기), sub_6FC6EC10 (허용 조건),
//   D2GAME_SpawnMinions_6FC6F440 (미니언 수, xfer 수식어 전달, 수식어 1~4 적용), D2GAME_SpawnSuperUnique_6FC6F690,
//   MONSTERUNIQUE_UMod*_ (수식어 초기화), MONSTERUNIQUE_CalculatePercentage
// 출처: D2MOO D2Common/src/DataTbls/MonsterTbls.cpp DATATBLS_MonPresetPlaceLinker (MonPreset Place → 슈퍼유니크·몬스터·monplace)
import type { TxtRow } from '../formats/txt';
import type { MonsterDb, MonsterType } from './monster';
import type { Rng } from './rng';
import { diffColumn, type Difficulty } from './difficulty';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

/** 원작 몬스터 종류 플래그 (MONTYPEFLAG_*). 출처: MonsterUnique.cpp nTypeFlag 사용처 */
export const MONFLAG = { OTHER: 1, SUPERUNIQUE: 2, CHAMPION: 4, UNIQUE: 8, MINION: 16 } as const;

/** MonUMod.txt 번호 (원작 MONUMOD_*) */
export const UMOD = {
  RNDNAME: 1, HPMULTIPLY: 2, LIGHT: 3, LEVELADD: 4, STRONG: 5, FAST: 6, CURSE: 7, RESIST: 8, FIRE: 9,
  CHAMPION: 16, LIGHTNING: 17, COLD: 18, QUESTCOMPLETE: 22, POISONHIT: 23, THIEF: 24, MANAHIT: 25, TELEPORT: 26,
  SPECTRALHIT: 27, STONESKIN: 28, MULTISHOT: 29, AURA: 30,
} as const;

export interface UModDef {
  id: number; name: string; enabled: boolean; version: number; xfer: boolean; champion: boolean; fPick: number;
  exclude: string[]; cpick: number; upick: number;
  /** constants 컬럼 (행 번호로 여러 수치를 담는다: 0 챔피언 확률, 1 미니언 HP%, 4 챔피언 HP%, 7 유니크 HP% …) */
  constant: number;
}

export interface SuperUniqueDef {
  /** SuperUniques.txt 행 번호 (= hcIdx) */
  idx: number;
  key: string;
  /** 이름 문자열 키 */
  name: string;
  cls: string;
  mods: number[];
  minGrp: number; maxGrp: number;
  autoPos: boolean; stacks: boolean;
  /** 이 표 난이도의 Utrans / Utrans(N) / Utrans(H) */
  utrans: number;
  /** 이 표 난이도의 TC / TC(N) / TC(H). 출처: MonsterMode.cpp sub_6FC631B0 — pSuperUniquesTxtRecord->dwTC[pGame->nDifficulty] */
  tc: string;
}

/** MonPreset.txt 한 행 (Act 1) → 종류. 출처: DATATBLS_MonPresetPlaceLinker (슈퍼유니크 2, monstats 1, monplace 0) */
export type PresetKind = { kind: 'super'; idx: number } | { kind: 'monster'; id: string } | { kind: 'place'; place: number; code: string } | { kind: 'none' };

/** UniqueDb 원본 표 */
export interface UniqueTables { monUMod: TxtRow[]; superUniques: TxtRow[]; monPreset: TxtRow[]; monPlace: TxtRow[]; prefix: TxtRow[]; suffix: TxtRow[]; appellation: TxtRow[] }

export class UniqueDb {
  readonly umods: UModDef[] = [];
  readonly superUniques: SuperUniqueDef[] = [];
  /** 이름 문자열 키 (UniquePrefix / UniqueSuffix / UniqueAppellation Name) */
  readonly prefixes: string[];
  readonly suffixes: string[];
  readonly appellations: string[];
  /** MonPreset 막별 행 (act 1~5) */
  private readonly presets = new Map<number, string[]>();
  private readonly monPlace: string[];
  private readonly monsters: MonsterDb;
  /** 이 표가 읽은 난이도 칸 */
  readonly difficulty: Difficulty;
  private readonly src: UniqueTables;

  constructor(monsters: MonsterDb, t: UniqueTables, difficulty: Difficulty = 0) {
    this.monsters = monsters;
    this.difficulty = difficulty;
    this.src = t;
    const col = (r: TxtRow, key: string) => (difficulty === 0 ? r[key] : r[diffColumn(key, difficulty)]);
    for (const r of t.monUMod) {
      if (!r.uniquemod) continue;
      this.umods.push({
        id: n(r.id), name: r.uniquemod, enabled: n(r.enabled) === 1, version: n(r.version), xfer: n(r.xfer) === 1, champion: n(r.champion) === 1,
        fPick: n(r.fPick), exclude: [r.exclude1 ?? '', r.exclude2 ?? ''].filter(Boolean), cpick: n(r.cpick), upick: n(r.upick), constant: n(r.constants),
      });
    }
    t.superUniques.forEach((r, i) => {
      if (!r.Superunique) return;
      this.superUniques.push({
        idx: r.hcIdx === undefined || r.hcIdx === '' ? i : n(r.hcIdx), key: r.Superunique, name: r.Name ?? r.Superunique, cls: r.Class ?? '',
        mods: [n(r.Mod1), n(r.Mod2), n(r.Mod3)], minGrp: n(r.MinGrp), maxGrp: n(r.MaxGrp), autoPos: n(r.AutoPos) === 1, stacks: n(r.Stacks) === 1,
        utrans: n(col(r, 'Utrans')), tc: col(r, 'TC') ?? '',
      });
    });
    for (const r of t.monPreset) {
      const act = n(r.Act);
      if (!act) continue;
      const list = this.presets.get(act) ?? [];
      list.push(r.Place ?? '');
      this.presets.set(act, list);
    }
    this.monPlace = t.monPlace.map((r) => r.code ?? '');
    this.prefixes = t.prefix.map((r) => r.Name ?? '').filter(Boolean);
    this.suffixes = t.suffix.map((r) => r.Name ?? '').filter(Boolean);
    this.appellations = t.appellation.map((r) => r.Name ?? '').filter(Boolean);
  }

  /** 난이도 칸 (SuperUniques TC(N)/Utrans(N) …) 을 읽은 표. monsters = 같은 난이도의 몬스터 표 */
  forDifficulty(d: Difficulty, monsters: MonsterDb = this.monsters.forDifficulty(d)): UniqueDb {
    return d === this.difficulty && monsters === this.monsters ? this : new UniqueDb(monsters, this.src, d);
  }

  /** MonUMod 행 constants (원작 MONSTERUNIQUE_GetMonUModTxtRecord(i)->dwConstants) */
  constant(i: number): number {
    return this.umods[i]?.constant ?? 0;
  }

  superUnique(keyOrIdx: string | number): SuperUniqueDef | undefined {
    return typeof keyOrIdx === 'number' ? this.superUniques.find((s) => s.idx === keyOrIdx) : this.superUniques.find((s) => s.key === keyOrIdx);
  }

  /** DS1 몬스터 유닛 번호 → 종류. 출처: DRLGPRESET_ParseDS1File (버전 > 4: MonPreset[act][id]) + MonPresetPlaceLinker */
  preset(act: number, id: number): PresetKind {
    const place = this.presets.get(act)?.[id];
    if (!place) return { kind: 'none' };
    const su = this.superUnique(place);
    if (su) return { kind: 'super', idx: su.idx };
    if (this.monsters.types.has(place)) return { kind: 'monster', id: place };
    const p = this.monPlace.indexOf(place);
    return p >= 0 ? { kind: 'place', place: p, code: place } : { kind: 'none' };
  }

  /**
   * 수식어가 이 몬스터에 붙을 수 있는가. 출처: sub_6FC6EC10 — enabled, 클래식은 version < 100, exclude MonType,
   * fPick 1 = A1 모드, 2 = 근접(isMelee)·nomultishot 이 아닌 몬스터, 3 = 걷기 모드
   * 근사(원작 미확인): exclude 는 MonType 중첩(MonType.txt) 대신 같은 MonType 만 비교 (Act 1 에 해당 몬스터 없음)
   */
  canPick(u: UModDef, t: MonsterType): boolean {
    if (!u.enabled || u.version >= 100) return false;
    if (u.exclude.includes(t.monType)) return false;
    if (u.fPick === 1) return t.modes.has('A1');
    if (u.fPick === 2) return !(t.isMelee || t.noMultishot);
    if (u.fPick === 3) return t.modes.has('WL');
    return true;
  }

  /** 출처: sub_6FC6EE90 — upick 가중치로 아직 없는 유니크 수식어 하나 (없으면 0) */
  pickUniqueMod(t: MonsterType, used: ReadonlySet<number>, rng: Rng, difficulty = 0): number {
    void difficulty;
    const picks: [number, number][] = [];
    let total = 0;
    this.umods.forEach((u, i) => {
      if (u.upick > 0 && !u.champion && this.canPick(u, t) && !used.has(i)) {
        picks.push([i, u.upick]);
        total += u.upick;
      }
    });
    let r = rng.pick(total);
    for (const [i, w] of picks) {
      if (r < w) return i;
      r -= w;
    }
    return 0;
  }

  /** 출처: sub_6FC6E940 (a3 = 챔피언 가능) 의 챔피언 수식어 뽑기 — cpick 가중치 (클래식 = 16 champion) */
  pickChampionMod(t: MonsterType, rng: Rng): number {
    const picks: [number, number][] = [];
    let total = 0;
    this.umods.forEach((u, i) => {
      if (u.cpick > 0 && u.champion && this.canPick(u, t)) {
        picks.push([i, u.cpick]);
        total += u.cpick;
      }
    });
    let r = rng.pick(total);
    for (const [i, w] of picks) {
      if (r < w) return i;
      r -= w;
    }
    return 0;
  }

  /**
   * 보스 수식어 굴림. 반환 { champion, umods }.
   * 출처: sub_6FC6E940 — champion 가능이면 rand%100 < MonUMod[0].constants(20) 일 때 챔피언 (cpick 1개),
   *       아니면 유니크: 개수 = 난이도 + rand(1) + 1 (Normal 1개), upick 로 겹치지 않게
   */
  rollBossMods(t: MonsterType, rng: Rng, allowChampion: boolean, existing: number[] = [], difficulty = 0): { champion: boolean; umods: number[] } {
    const umods = [...existing];
    if (umods.length >= 8) return { champion: false, umods };
    if (allowChampion && Number(rng.roll() >>> 0) % 100 < this.constant(0)) {
      umods.push(this.pickChampionMod(t, rng));
      return { champion: true, umods };
    }
    let count = difficulty + rng.pick(1) + 1;
    if (count + umods.length >= 9) count = 9 - umods.length;
    const used = new Set(umods);
    for (let i = 0; i < count; i++) {
      const u = this.pickUniqueMod(t, used, rng, difficulty);
      if (!u) break;
      umods.push(u);
      used.add(u);
    }
    return { champion: false, umods };
  }
}

/** 출처: MONSTERUNIQUE_CalculatePercentage — a1 × a2 / a3 (오버플로 분기는 결과가 같다) */
export function calcPercentage(a1: number, a2: number, a3: number): number {
  if (!a3) return 0;
  return Math.trunc((a2 * a1) / a3);
}

/** 수식어 초기화가 바꾸는 몬스터 값 (MonsterUnit 가 구현) */
export interface UModTarget {
  type: MonsterType;
  stats: { level: number; maxHp: number; exp: number; defense: number };
  hp: number;
  rng: Rng;
  flags: number;
  nameSeed: number;
  /** 추가 스탯 (damagepercent, item_tohit_percent, velocitypercent, firemindam … coldlength, poisonlength, manadrainmindam) */
  bonus: Record<string, number>;
  resist: { dm: number; ma: number; fi: number; li: number; co: number; po: number };
  hpRegen: boolean;
  skillsAdded: string[];
}

export interface UModContext {
  db: UniqueDb;
  monsters: MonsterDb;
  difficulty: number;
  /** DifficultyLevels.txt ChampionDamageBonus (Normal 90) */
  championDmgBonus: number;
}

const addBonus = (m: UModTarget, stat: string, v: number) => {
  m.bonus[stat] = (m.bonus[stat] ?? 0) + v;
};

/** 출처: MONSTERUNIQUE_UMod8_Resistant — 면역 2개 미만일 때만 저항 추가 (bUnique 일 때만) */
function umodResistant(m: UModTarget, umod: number, bUnique: boolean): void {
  if (!bUnique) return;
  const r = m.resist;
  if (umod === UMOD.STONESKIN) m.stats.defense *= 2;
  let imm = [r.fi, r.li, r.co, r.po, r.dm, r.ma].filter((v) => v >= 100).length;
  if (imm >= 2) return;
  switch (umod) {
    case UMOD.RESIST:
      if (r.co < 100) {
        r.co += 40;
        if (r.co >= 100) imm++;
      }
      if (imm < 2) {
        if (r.fi < 100) {
          r.fi += 40;
          if (r.fi >= 100) imm++;
        }
        if (imm < 2 && r.li < 100) r.li += 40;
      }
      break;
    case UMOD.FIRE: r.fi += 75; break;
    case UMOD.COLD: r.co += 75; break;
    case UMOD.LIGHTNING: r.li += 75; break;
    case UMOD.POISONHIT: r.po += 75; break;
    case UMOD.MANAHIT: r.ma += 20; break;
    case UMOD.SPECTRALHIT:
      if (r.co < 75) {
        r.co += 20;
        if (r.co >= 100) imm++;
      }
      if (imm < 2) {
        if (r.fi < 75) {
          r.fi += 20;
          if (r.fi >= 100) imm++;
        }
        if (imm < 2 && r.li < 75) r.li += 20;
      }
      break;
    case UMOD.STONESKIN: r.dm += 50; break;
    default: break;
  }
}

/** 출처: MONSTERUNIQUE_UMod9/17/18/23/25 — 원소 피해 = MonLvl DM × MonUMod constants(유니크 28/31, 미니언 16/19) / 100 */
function umodElemental(ctx: UModContext, m: UModTarget, umod: number, bUnique: boolean, minStat: string, maxStat: string, shift = 0): void {
  const lvl = Math.max(1, m.stats.level);
  const dm = ctx.monsters.levelBase(lvl, 'DM');
  const d = ctx.difficulty;
  const minPct = ctx.db.constant(bUnique ? d + 28 : d + 16), maxPct = ctx.db.constant(bUnique ? d + 31 : d + 19);
  addBonus(m, minStat, Math.trunc((dm * minPct) / 100) << shift);
  addBonus(m, maxStat, Math.trunc((dm * maxPct) / 100) << shift);
}

/**
 * 수식어 초기화 (원작 sub_6FC6F670 표: 1 이름, 2 생명, 4 레벨, 5 강함, 6 빠름, 8 마법 저항, 9 화염, 16 챔피언, 17 번개, 18 냉기,
 * 23 독, 25 마나 번, 26 순간이동, 27 영체 타격(저항), 28 돌 피부(저항), 30 오라). bUnique = 보스 자신, false = 미니언.
 */
export function applyUModInit(ctx: UModContext, m: UModTarget, umod: number, bUnique: boolean): void {
  const d = ctx.difficulty;
  switch (umod) {
    case UMOD.RNDNAME:
      // 출처: MONSTERUNIQUE_UMod1_RandomName — wNameSeed = ITEMS_RollRandomNumber (16비트 필드)
      if (bUnique) m.nameSeed = m.rng.roll() & 0xffff;
      break;
    case UMOD.HPMULTIPLY: {
      // 출처: MONSTERUNIQUE_UMod2_HealthBonus — 챔피언 +constants[4+d]%, 유니크 +constants[7+d]% (HP 재생 0), 미니언 +constants[1+d]%
      const pct = bUnique ? ctx.db.constant((m.flags & MONFLAG.CHAMPION ? 4 : 7) + d) : ctx.db.constant(1 + d);
      const hp = m.stats.maxHp + calcPercentage(m.stats.maxHp, pct, 100);
      m.stats.maxHp = hp;
      m.hp = hp;
      if (bUnique) m.hpRegen = false;
      break;
    }
    case UMOD.LEVELADD:
      // 출처: MONSTERUNIQUE_UMod4_LevelBonus — 레벨 +3, 경험치 ×5
      m.stats.level += 3;
      m.stats.exp *= 5;
      break;
    case UMOD.STRONG: {
      // 출처: MONSTERUNIQUE_UMod5_Strong — 유니크 피해 constants[15]%·명중 constants[13]%, 미니언 [14]·[12], × ChampionDmgBonus / 100
      const dmg = ctx.db.constant(bUnique ? 15 : 14), th = ctx.db.constant(bUnique ? 13 : 12);
      addBonus(m, 'damagepercent', Math.trunc((dmg * ctx.championDmgBonus) / 100));
      addBonus(m, 'item_tohit_percent', Math.trunc((th * ctx.championDmgBonus) / 100));
      break;
    }
    case UMOD.FAST:
      // 출처: MONSTERUNIQUE_UMod6_Fast — 속도 % = clamp(2048 / Velocity − 128, 10, 100)
      if (m.type.velocity > 0) addBonus(m, 'velocitypercent', Math.min(100, Math.max(10, Math.trunc(2048 / m.type.velocity) - 128)));
      break;
    case UMOD.RESIST:
    case UMOD.SPECTRALHIT:
    case UMOD.STONESKIN:
      umodResistant(m, umod, bUnique);
      break;
    case UMOD.FIRE:
      umodElemental(ctx, m, umod, bUnique, 'firemindam', 'firemaxdam');
      umodResistant(m, umod, bUnique);
      break;
    case UMOD.LIGHTNING:
      umodElemental(ctx, m, umod, bUnique, 'lightmindam', 'lightmaxdam');
      umodResistant(m, umod, bUnique);
      break;
    case UMOD.COLD:
      umodElemental(ctx, m, umod, bUnique, 'coldmindam', 'coldmaxdam');
      addBonus(m, 'coldlength', 5 * Math.max(1, m.stats.level) + 100);
      umodResistant(m, umod, bUnique);
      break;
    case UMOD.POISONHIT:
      umodElemental(ctx, m, umod, bUnique, 'poisonmindam', 'poisonmaxdam');
      addBonus(m, 'poisonlength', 2 * (5 * Math.max(1, m.stats.level) + 150));
      umodResistant(m, umod, bUnique);
      break;
    case UMOD.MANAHIT:
      umodElemental(ctx, m, umod, bUnique, 'manadrainmindam', 'manadrainmaxdam', 8);
      umodResistant(m, umod, bUnique);
      break;
    case UMOD.TELEPORT:
      // 출처: MONSTERUNIQUE_UMod26_Teleport — MonTeleport 스킬 부여
      if (bUnique) m.skillsAdded.push('MonTeleport');
      break;
    case UMOD.CHAMPION: {
      // 출처: MONSTERUNIQUE_UMod16_Champion — 레벨 −1, 경험치 − 2/5, 피해 constants[11]%·명중 constants[10]% × ChampionDmgBonus/100, 속도 +20%
      if (!bUnique) break;
      m.stats.level -= 1;
      m.stats.exp -= Math.trunc((2 * m.stats.exp) / 5);
      addBonus(m, 'damagepercent', Math.trunc((ctx.db.constant(11) * ctx.championDmgBonus) / 100));
      addBonus(m, 'item_tohit_percent', Math.trunc((ctx.db.constant(10) * ctx.championDmgBonus) / 100));
      if (m.type.velocity > 0) addBonus(m, 'velocitypercent', 20);
      break;
    }
    case UMOD.AURA:
      // 근사(원작 미확인): 오라 인챈트(MONSTERUNIQUE_UMod30) 는 팔라딘 오라 스킬을 몬스터에 붙인다 — 여기서는 기록만 (효과는 game.ts 에서 근사)
      if (bUnique) m.skillsAdded.push('aura');
      break;
    default:
      break;
  }
}

/** 미니언 수 굴림. 출처: D2GAME_SpawnMinions_6FC6F440 — nMin + rand(nMax − nMin + 1) */
export function rollMinionCount(rng: Rng, min: number, max: number): number {
  return min + rng.pick(max - min + 1);
}

/** 보스 수식어 중 미니언에게 전달되는 것 (MonUMod xfer). 출처: D2GAME_SpawnMinions_6FC6F440 */
export function xferMods(db: UniqueDb, umods: readonly number[]): number[] {
  return umods.filter((u) => db.umods[u]?.xfer);
}

/**
 * 유니크 이름 (접두·접미·칭호 문자열 키). 이름 시드로 굴린다.
 * 출처: D2Common MonsterTbls.cpp DATATBLS_RollRandomUniquePrefixString / SuffixString / AppellationString (각 표 행 수로 나머지·마스크)
 * 근사(원작 미확인): 클라이언트가 이름 시드로 시드를 초기화하는 순서(접두 → 접미 → 칭호)와 "접두 접미 칭호" 조합
 */
export function uniqueNameKeys(db: UniqueDb, nameSeed: number, makeRng: (seed: number) => Rng): [string, string, string] {
  const rng = makeRng(nameSeed);
  const roll = (count: number) => {
    const v = rng.roll() >>> 0;
    return (count & (count - 1)) !== 0 ? v % count : v & (count - 1);
  };
  return [db.prefixes[roll(db.prefixes.length)] ?? '', db.suffixes[roll(db.suffixes.length)] ?? '', db.appellations[roll(db.appellations.length)] ?? ''];
}

/** 수식어 → 원작 문자열 키 (이름 막대 둘째 줄). 출처: string.tbl uniquextrastrong / monsteruniqueprop1~9 … */
export const UMOD_STRING: Record<number, string> = {
  [UMOD.STRONG]: 'uniquextrastrong', [UMOD.FAST]: 'uniqueextrafast', [UMOD.CURSE]: 'uniquecursed', [UMOD.RESIST]: 'uniquemagicresistance',
  [UMOD.FIRE]: 'uniquefireenchanted', [UMOD.COLD]: 'monsteruniqueprop1', [UMOD.LIGHTNING]: 'monsteruniqueprop2', [UMOD.MANAHIT]: 'monsteruniqueprop3',
  [UMOD.SPECTRALHIT]: 'monsteruniqueprop4', [UMOD.TELEPORT]: 'monsteruniqueprop5', [UMOD.STONESKIN]: 'monsteruniqueprop6', [UMOD.MULTISHOT]: 'monsteruniqueprop7',
  [UMOD.THIEF]: 'monsteruniqueprop8', [UMOD.AURA]: 'monsteruniqueprop9', [UMOD.CHAMPION]: 'Champion',
};
