// 캐릭터 생성·스탯·레벨업. 모든 수치는 charstats.txt / experience.txt 에서 읽는다.
// 출처: Phrozen Keep — CharStats.txt File Guide (https://d2mods.info/forum/kb/viewarticle?a=223)
//       charstats.txt 원본 주석 "The following are in fourths" → LifePerLevel 등은 1/4 단위
// 출처: Maxroll — Life & Mana Mechanics: 클래스별 기본 생명/마나 + 레벨당 + 스탯당 (https://maxroll.gg/d2/resources/life-mana-mechanics)
import type { TxtRow } from '../formats/txt';

export const CLASSIC_CLASSES = ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian'] as const;
export type ClassName = (typeof CLASSIC_CLASSES)[number];
export type StatName = 'str' | 'dex' | 'vit' | 'ene';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export interface ClassStats {
  cls: ClassName;
  str: number; dex: number; ene: number; vit: number;
  stamina: number; hpadd: number;
  /** 1/4 단위 */
  lifePerLevel: number; staminaPerLevel: number; manaPerLevel: number;
  lifePerVit: number; staminaPerVit: number; manaPerEne: number;
  statPerLevel: number;
  toHitFactor: number; blockFactor: number;
  walkVelocity: number; runVelocity: number;
  /** 달리기 스태미나 소모 (charstats RunDrain, 1/256 단위 × 2 가 한 프레임 소모) */
  runDrain: number;
  startItems: { code: string; loc: string; count: number }[];
}

export function classStats(charstats: TxtRow[], cls: ClassName): ClassStats {
  const r = charstats.find((x) => x.class === cls);
  if (!r) throw new Error(`charstats: class not found ${cls}`);
  const startItems = [];
  for (let i = 1; i <= 10; i++) {
    const code = r[`item${i}`] ?? '0';
    if (code && code !== '0') startItems.push({ code, loc: r[`item${i}loc`] ?? '', count: n(r[`item${i}count`]) });
  }
  return {
    cls, str: n(r.str), dex: n(r.dex), ene: n(r.int), vit: n(r.vit), stamina: n(r.stamina), hpadd: n(r.hpadd),
    lifePerLevel: n(r.LifePerLevel), staminaPerLevel: n(r.StaminaPerLevel), manaPerLevel: n(r.ManaPerLevel),
    lifePerVit: n(r.LifePerVitality), staminaPerVit: n(r.StaminaPerVitality), manaPerEne: n(r.ManaPerMagic),
    statPerLevel: n(r.StatPerLevel), toHitFactor: n(r.ToHitFactor), blockFactor: n(r.BlockFactor),
    walkVelocity: n(r.WalkVelocity), runVelocity: n(r.RunVelocity), runDrain: n(r.RunDrain), startItems,
  };
}

export interface Character {
  cls: ClassName;
  level: number;
  experience: number;
  str: number; dex: number; vit: number; ene: number;
  statPoints: number;
  skillPoints: number;
  /** 기본 최대치 (장비 보너스 제외). 소수 허용, 표시 시 내림 */
  maxLife: number; maxMana: number; maxStamina: number;
  life: number; mana: number; stamina: number;
  /** 스킬 Id → 하드 포인트 (배운 클래스 스킬만) */
  skills: Record<number, number>;
  /** 마우스 왼쪽/오른쪽 버튼 스킬 Id (0 = Attack) */
  leftSkill: number;
  rightSkill: number;
  /** 스킬 단축키 Skill 1~8 칸 (원작: 스킬 고르기 목록에서 아이콘을 가리키고 단축키 → 그 손에 등록). 키는 옵션에서 바꾼다 */
  hotkeys?: (SkillHotkey | null)[];
  /** 충전 스킬로 고른 스킬 → 충전 아이템 Id (원작: 스킬을 (스킬, 아이템 GUID) 로 고른다 — D2GAME_AssignSkill_6FD13800) */
  chargeSkills?: Record<number, number>;
}

export interface SkillHotkey { skill: number; hand: 'left' | 'right'; charge?: boolean }
export const HOTKEY_SLOTS = 8;

/** 시작 생명 = vit + hpadd, 마나 = 에너지, 스태미나 = stamina 컬럼 (예: 바바리안 55/10/92) */
export function createCharacter(cs: ClassStats): Character {
  const maxLife = cs.vit + cs.hpadd, maxMana = cs.ene, maxStamina = cs.stamina;
  return {
    cls: cs.cls, level: 1, experience: 0,
    str: cs.str, dex: cs.dex, vit: cs.vit, ene: cs.ene, statPoints: 0, skillPoints: 0,
    maxLife, maxMana, maxStamina, life: maxLife, mana: maxMana, stamina: maxStamina,
    skills: {}, leftSkill: 0, rightSkill: 0, hotkeys: Array<SkillHotkey | null>(HOTKEY_SLOTS).fill(null),
  };
}

/** 스탯 포인트 1 투자. 활력 → 생명·스태미나, 에너지 → 마나 (1/4 단위 값 적용) */
export function spendStat(ch: Character, cs: ClassStats, stat: StatName): boolean {
  if (ch.statPoints <= 0) return false;
  ch.statPoints--;
  ch[stat]++;
  if (stat === 'vit') {
    ch.maxLife += cs.lifePerVit / 4;
    ch.life += cs.lifePerVit / 4;
    ch.maxStamina += cs.staminaPerVit / 4;
    ch.stamina += cs.staminaPerVit / 4;
  } else if (stat === 'ene') {
    ch.maxMana += cs.manaPerEne / 4;
    ch.mana += cs.manaPerEne / 4;
  }
  return true;
}

/** experience.txt: 'Level' 행 N 의 값 = 레벨 N → N+1 에 필요한 누적 경험치. 'MaxLvl' 행 = 최대 레벨 */
export interface ExpTable { maxLevel: number; threshold: (level: number) => number }

export function expTable(rows: TxtRow[], cls: ClassName): ExpTable {
  const max = n(rows.find((r) => r.Level === 'MaxLvl')?.[cls]);
  const byLevel = new Map<number, number>();
  for (const r of rows) if (/^\d+$/.test(r.Level ?? '')) byLevel.set(Number(r.Level), n(r[cls]));
  return { maxLevel: max, threshold: (lvl) => byLevel.get(lvl) ?? Infinity };
}

/**
 * 경험치 획득 → 레벨업 처리. 레벨당: 스탯 StatPerLevel, 스킬 1, 생명/마나/스태미나 PerLevel/4.
 * 출처(스킬 1): Phrozen Keep — "Increasing Skill Points Gained Per Level" (레벨당 1, 하드코딩) (https://d2mods.info/forum/viewtopic.php?t=57248)
 * 레벨업 시 생명(살아 있으면)·마나·스태미나 전부 회복은 Game 쪽에서 (장비 포함 최대치). 출처: D2MOO PlayerStats.cpp PLAYERSTATS_LevelUp
 * 최대 레벨에서는 경험치가 최대 레벨 임계치를 넘지 않는다.
 */
export function addExperience(ch: Character, cs: ClassStats, table: ExpTable, amount: number): number {
  const cap = table.threshold(table.maxLevel - 1);
  ch.experience = Math.min(ch.experience + Math.max(0, Math.floor(amount)), cap);
  let gained = 0;
  while (ch.level < table.maxLevel && ch.experience >= table.threshold(ch.level)) {
    ch.level++;
    gained++;
    ch.statPoints += cs.statPerLevel;
    ch.skillPoints += 1;
    ch.maxLife += cs.lifePerLevel / 4;
    ch.life += cs.lifePerLevel / 4;
    ch.maxMana += cs.manaPerLevel / 4;
    ch.mana += cs.manaPerLevel / 4;
    ch.maxStamina += cs.staminaPerLevel / 4;
    ch.stamina += cs.staminaPerLevel / 4;
  }
  return gained;
}
