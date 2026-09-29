import { describe, expect, it } from 'vitest';
import { addExperience, classStats, createCharacter, expTable, spendStat, CLASSIC_CLASSES } from '../../src/engine/player';
import { blockChance, hitChance, physicalDamageRange, playerAttackRating, playerDefense, rollDamage } from '../../src/engine/combat';
import { adjustedExperience, levelDiffFactor256 } from '../../src/engine/experience';
import { GameTables, num } from '../../src/data/tables';
import { Rng } from '../../src/engine/rng';
import { gameChain, hasGameData } from '../support/gamedata';

describe('전투 공식 (출처: Maxroll Hit Chance / Block / Damage Mechanics)', () => {
  it('AR=DEF, 동레벨 → 50%', () => expect(hitChance(100, 100, 10, 10)).toBe(50));
  it('명중 하한 5%, 상한 95%', () => {
    expect(hitChance(1, 1000, 1, 50)).toBe(5);
    expect(hitChance(10000, 1, 50, 1)).toBe(95);
  });
  // 출처: D2MOO SUNITDMG_IsHitSuccessful — 정수 연산: factor 50, 2 × 20 × 50 / 30 = 66
  it('레벨 보정: 공격자 레벨이 높으면 명중 상승 (정수: 2 × 20 × 50 / 30 = 66)', () => {
    expect(hitChance(100, 100, 20, 10)).toBe(66);
  });
  it('플레이어 AR = (Dex-7)×5 + ToHitFactor, 방어 = Dex/4', () => {
    expect(playerAttackRating(20, 20)).toBe(85);
    expect(playerDefense(20)).toBe(5);
  });
  it('블록: floor((방패+클래스)×(Dex-15)/(clvl×2)), 최대 75, 달리기 1/3', () => {
    expect(blockChance(25, 25, 20, 10)).toBe(12);
    expect(blockChance(25, 25, 20, 1)).toBe(75);
    expect(blockChance(25, 25, 20, 1, true)).toBe(25);
    expect(blockChance(0, 25, 100, 1)).toBe(0);
  });
  it('피해: 기본 × (1 + Str×StrBonus/100/100)', () => {
    expect(physicalDamageRange({ min: 3, max: 6, strBonus: 100, dexBonus: 0 }, 30, 20)).toEqual({ min: 3, max: 7 });
  });
  it('피해 롤은 [min, max] 범위', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 200; i++) {
      const d = rollDamage({ min: 3, max: 7 }, rng);
      expect(d).toBeGreaterThanOrEqual(3);
      expect(d).toBeLessThanOrEqual(7);
    }
  });
});

describe('경험치 레벨 차이 보정 (출처: Maxroll Experience Mechanics Tier 1/2 표)', () => {
  it('±5 이내는 100%', () => {
    expect(levelDiffFactor256(10, 15)).toBe(256);
    expect(levelDiffFactor256(10, 5)).toBe(256);
  });
  it('Tier1 몬스터가 높을 때: +6=225, +9=38, +10 이상=5', () => {
    expect(levelDiffFactor256(1, 7)).toBe(225);
    expect(levelDiffFactor256(1, 10)).toBe(38);
    expect(levelDiffFactor256(1, 11)).toBe(5);
  });
  it('몬스터가 낮을 때: -6=207, -9=61, -10 이하=13', () => {
    expect(levelDiffFactor256(20, 14)).toBe(207);
    expect(levelDiffFactor256(20, 11)).toBe(61);
    expect(levelDiffFactor256(20, 10)).toBe(13);
  });
  it('Tier2 (cLVL 25+) 높은 몬스터: × cLVL/mLVL', () => {
    expect(adjustedExperience(1000, 30, 40)).toBe(750);
  });
  it('Tier1 적용 예: 기본 256 × 225/256 = 225', () => {
    expect(adjustedExperience(256, 1, 7)).toBe(225);
  });
});

describe.skipIf(!hasGameData)('원작 charstats / experience / weapons', () => {
  const t = () => new GameTables(gameChain());
  // 출처: charstats.txt Barbarian 행 — str 30 dex 20 int 10 vit 25 stamina 92 hpadd 30
  it('바바리안 생성: 30/20/25/10, 생명 55(=vit+hpadd), 마나 10, 스태미나 92', () => {
    const ch = createCharacter(classStats(t().table('charstats'), 'Barbarian'));
    expect([ch.str, ch.dex, ch.vit, ch.ene]).toEqual([30, 20, 25, 10]);
    expect([ch.maxLife, ch.maxMana, ch.maxStamina]).toEqual([55, 10, 92]);
  });
  // 출처: experience.txt Level=1 행 = 500 / charstats LifePerLevel 8(=2), ManaPerLevel 4(=1), StaminaPerLevel 4(=1), StatPerLevel 5
  it('경험치 500 에서 레벨 2: 스탯 5, 스킬 1, 생명+2 마나+1 스태미나+1', () => {
    const cs = classStats(t().table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    const table = expTable(t().table('experience'), 'Barbarian');
    expect(addExperience(ch, cs, table, 499)).toBe(0);
    expect(addExperience(ch, cs, table, 1)).toBe(1);
    expect([ch.level, ch.statPoints, ch.skillPoints]).toEqual([2, 5, 1]);
    expect([ch.maxLife, ch.maxMana, ch.maxStamina]).toEqual([57, 11, 93]);
  });
  it('활력 1 투자: 생명 +4(LifePerVitality 16/4), 스태미나 +1', () => {
    const cs = classStats(t().table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    ch.statPoints = 1;
    expect(spendStat(ch, cs, 'vit')).toBe(true);
    expect([ch.vit, ch.maxLife, ch.maxStamina, ch.statPoints]).toEqual([26, 59, 93, 0]);
    expect(spendStat(ch, cs, 'vit')).toBe(false);
  });
  it('최대 레벨(99)을 넘지 않는다', () => {
    const cs = classStats(t().table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    const table = expTable(t().table('experience'), 'Barbarian');
    addExperience(ch, cs, table, 1e12);
    expect(ch.level).toBe(99);
    expect(table.maxLevel).toBe(99);
  });
  // 출처: Maxroll Block Mechanics — 클래스 보너스 Amazon/Barbarian 25, Paladin 30, Necromancer/Sorceress 20
  it('charstats BlockFactor = Maxroll 클래스 방패 보너스', () => {
    const cs = t().table('charstats');
    expect(CLASSIC_CLASSES.map((c) => classStats(cs, c).blockFactor)).toEqual([25, 20, 20, 30, 25]);
  });
  // 출처: Maxroll Hit Chance — 클래스 상수 Sorceress -15 ~ Barbarian/Paladin +20
  it('바바리안 시작 AR = (20-7)×5 + 20 = 85', () => {
    const cs = classStats(t().table('charstats'), 'Barbarian');
    expect(playerAttackRating(cs.dex, cs.toHitFactor)).toBe(85);
  });
  it('바바리안 시작 장비: 오른손 손도끼(hax), 왼손 버클러(buc), 체력 물약 4', () => {
    const cs = classStats(t().table('charstats'), 'Barbarian');
    expect(cs.startItems.slice(0, 3)).toEqual([
      { code: 'hax', loc: 'rarm', count: 1 },
      { code: 'buc', loc: 'larm', count: 1 },
      { code: 'hp1', loc: '', count: 4 },
    ]);
  });
  it('손도끼 피해: weapons.txt mindam/maxdam/StrBonus 로 계산', () => {
    const hax = t().row('weapons', 'code', 'hax');
    expect([num(hax?.mindam), num(hax?.maxdam), num(hax?.StrBonus)]).toEqual([3, 6, 100]);
  });
});
