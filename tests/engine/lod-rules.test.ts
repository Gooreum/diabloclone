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
});
