// 확장팩 공통 규칙 (6단계): 악몽·지옥 몬스터 지역 레벨·클래식 보정 없음, 확장팩 챔피언 수식어, 저항 페널티, ItemRatio 행, 지역 레벨 표.
// 출처: D2MOO Monster.cpp (bExpansion && 난이도 > 0 && !NORATIO && !BOSS → DATATBLS_GetMonsterLevelInArea), Monsters.cpp MONSTERS_ApplyClassicScaling (!bExpansion),
//       LevelsTbls.cpp DATATBLS_GetMonsterLevelInArea (bExpansion → wMonLvlEx), MonsterUnique.cpp sub_6FC6EC10 · UMod36~39, SUnitDmg.cpp (ResistPenalty),
//       ItemsTbls.cpp DATATBLS_GetItemRatioTxtRecord
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData, withDifficulty } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import { rollMonsterStats } from '../../src/engine/monster';
import { Rng } from '../../src/engine/rng';
import { applyUModInit, UMOD, type UModTarget } from '../../src/engine/uniques';
import { difficultyRules } from '../../src/engine/difficulty';

let tables: GameTables;
let classic: GameData;
let lod: GameData;
const n = (v: string | undefined) => Number(v ?? 0) || 0;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  classic = buildGameData(gameChain(), tables);
  lod = buildGameData(gameChain(), tables, { expansion: true });
}, 120_000);

describe.skipIf(!hasGameData)('확장팩 공통 규칙', () => {
  const BLOOD_MOOR = 2;
  const levelRow = () => tables.table('Levels').find((r) => r.Id === String(BLOOD_MOOR))!;

  describe('몬스터 난이도', () => {
    it('확장팩 악몽: 레벨 = 지역 레벨 (levels.txt MonLvl2Ex), 클래식 보정 (생명 ½) 없음', () => {
      const d = withDifficulty(lod, 1);
      const area = d.objects!.levels.get(BLOOD_MOOR)!.monLvl;
      expect(area).toBe(n(levelRow().MonLvl2Ex));
      const t = d.monsters.get('zombie1');
      const s = rollMonsterStats(d.monsters, t, new Rng(5), undefined, area);
      expect(s.level).toBe(area);
      // 같은 레벨·난수로 계산한 생명과 같다 (½ 하지 않음)
      const plain = rollMonsterStats(d.monsters, t, new Rng(5), area);
      expect(s.maxHp).toBe(plain.maxHp);
    });

    it('클래식 악몽: 레벨 25 + Level, 생명 ½ 그대로 (회귀)', () => {
      const d = withDifficulty(classic, 1);
      const t = d.monsters.get('zombie1');
      const area = d.objects!.levels.get(BLOOD_MOOR)!.monLvl;
      expect(area).toBe(n(levelRow().MonLvl2));
      const s = rollMonsterStats(d.monsters, t, new Rng(5), undefined, area);
      expect(s.level).toBe(25 + t.baseLevel);
    });

    it('확장팩 악몽 보스 (monstats boss) 는 지역 레벨이 아니라 monstats Level(N)', () => {
      const d = withDifficulty(lod, 1);
      const t = d.monsters.get('andariel');
      const s = rollMonsterStats(d.monsters, t, new Rng(5), undefined, 3);
      expect(s.level).toBe(t.level);
    });

    it('확장팩 보통: 지역 레벨 표는 MonLvl1Ex, 몬스터 레벨은 monstats Level', () => {
      expect(lod.objects!.levels.get(BLOOD_MOOR)!.monLvl).toBe(n(levelRow().MonLvl1Ex));
      const t = lod.monsters.get('zombie1');
      expect(rollMonsterStats(lod.monsters, t, new Rng(5), undefined, 99).level).toBe(t.level);
    });
  });
  describe('확장팩 챔피언 수식어 (MonUMod version 100)', () => {
    const roll = (d: GameData) => {
      const t = d.monsters.get('zombie1');
      const rng = new Rng(17);
      const seen = new Set<number>();
      for (let i = 0; i < 3000; i++) {
        const r = d.uniques!.rollBossMods(t, rng, true);
        if (r.champion) seen.add(r.umods[r.umods.length - 1]!);
      }
      return seen;
    };
    it('확장팩 게임은 챔피언 굴림에서 Ghostly·Fanatic·Possessed·Berserk 가 나온다', () => {
      const seen = roll(lod);
      for (const u of [UMOD.CHAMPION, UMOD.GHOSTLY, UMOD.FANATIC, UMOD.POSSESSED, UMOD.BERSERK]) expect(seen.has(u), String(u)).toBe(true);
    });
    it('클래식 게임은 Champion 만 (version 100 행 막힘)', () => {
      expect([...roll(classic)]).toEqual([UMOD.CHAMPION]);
    });

    const target = (d: GameData): UModTarget => {
      const t = d.monsters.get('zombie1');
      const st = rollMonsterStats(d.monsters, t, new Rng(3));
      return {
        type: t, stats: { level: st.level, maxHp: st.maxHp, exp: st.exp, defense: st.defense }, hp: st.maxHp, rng: new Rng(4), flags: 0, nameSeed: 0,
        bonus: {}, resist: { dm: 0, ma: 0, fi: 0, li: 0, co: 0, po: 0 }, hpRegen: true, skillsAdded: [],
      } as unknown as UModTarget;
    };
    const ctx = () => ({ db: lod.uniques!, monsters: lod.monsters, difficulty: 0, championDmgBonus: 90 });
    it('효과: Ghostly 물리 저항 80·냉기 피해, Fanatic 방어 −70 %, Possessed 생명 ×2, Berserk 생명 −75 %·피해 +270 % (Normal 90×3)', () => {
      const g = target(lod);
      applyUModInit(ctx(), g, UMOD.GHOSTLY, true);
      expect(g.resist.dm).toBe(80);
      expect((g.bonus.coldmaxdam ?? 0) > 0 && g.bonus.coldlength === 150).toBe(true);
      expect(g.bonus.velocitypercent ?? 0).toBe(0);
      const f = target(lod), def = f.stats.defense;
      applyUModInit(ctx(), f, UMOD.FANATIC, true);
      expect(f.stats.defense).toBe(Math.trunc((def * 30) / 100));
      expect(f.bonus.velocitypercent ?? 0).toBeGreaterThanOrEqual(10);
      const p = target(lod), hp = p.stats.maxHp;
      applyUModInit(ctx(), p, UMOD.POSSESSED, true);
      expect(p.stats.maxHp).toBe(hp * 2);
      const b = target(lod), hpb = b.stats.maxHp, lvl = b.stats.level;
      applyUModInit(ctx(), b, UMOD.BERSERK, true);
      expect(b.stats.maxHp).toBeLessThan(hpb);
      expect(b.bonus.damagepercent).toBe(270);
      expect(b.stats.level).toBe(lvl);
    });
  });
  describe('플레이어·아이템 규칙', () => {
    it('저항 페널티: 확장팩은 DifficultyLevels ResistPenalty (0/−40/−100), 클래식은 0/−20/−50', () => {
      const rows = tables.table('DifficultyLevels');
      expect([0, 1, 2].map((d) => difficultyRules(rows, d as 0 | 1 | 2, true).playerResistPenalty)).toEqual([0, -40, -100]);
      expect([0, 1, 2].map((d) => difficultyRules(rows, d as 0 | 1 | 2, false).playerResistPenalty)).toEqual([0, -20, -50]);
    });
    it('Static Field 최소: 확장팩만 (악몽 33 · 지옥 50), 클래식 0', () => {
      const rows = tables.table('DifficultyLevels');
      expect(difficultyRules(rows, 2, true).staticFieldMin).toBe(n(rows[2]!.StaticFieldMin));
      expect(difficultyRules(rows, 2, true).staticFieldMin).toBeGreaterThan(0);
      expect(difficultyRules(rows, 2, false).staticFieldMin).toBe(0);
    });
    it('ItemRatio: 보통 무기는 기본 행, 고급·엘리트 무기는 Uber 행, 직업 전용 (아마존 활) 은 Class Specific 행', () => {
      const tr = lod.treasure;
      const base = tr.ratioFor(lod.items.base('axe')!);
      expect([base.unique, base.rare, base.magic]).toEqual([400, 100, 34]);
      const elite = [...lod.items.bases.values()].find((b) => b.type === 'axe' && b.ultraCode === b.code && b.code !== b.normCode)!;
      expect(elite, 'elite axe').toBeTruthy();
      const u = tr.ratioFor(elite);
      expect([u.unique, u.rare, u.magic]).toEqual([400, 100, 34]);
      const exc = [...lod.items.bases.values()].find((b) => b.type === 'axe' && b.uberCode === b.code && b.code !== b.normCode)!;
      expect(tr.ratioFor(exc)).toBe(u);
      const cls = tr.ratioFor(lod.items.base('am1')!);
      expect([cls.unique, cls.rare, cls.magic]).toEqual([240, 80, 17]);
    });
  });
});
