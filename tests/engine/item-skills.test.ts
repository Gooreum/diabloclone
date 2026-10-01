// 아이템 +스킬 → 유효 스킬 레벨.
// 기대값 출처: itemstatcost.txt item_allskills / item_addclassskills(param 직업: Ama 0 Sor 1 Nec 2 Pal 3 Bar 4) / item_singleskill(param 스킬 Id),
//             UniqueItems.txt The Stone of Jordan·Tarnhelm·The Eye of Etlich (allskills 1), Magefist (fireskill 1 = item_elemskill param 1), The Iron Jang Bong (Sorceress 스킬 +2, Nova +2, Blaze +2, Frost Nova +3),
//             Ume's Lament (Necromancer 스킬 +2, Terror +3), D2MOO SKILLS_GetSkillLevel (하드 0 이어도 개별 스킬 아이템이면 쓸 수 있다)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World } from '../../src/data/act1-world';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, expTable, type ClassName } from '../../src/engine/player';
import { parseSave, type CharacterSave } from '../../src/engine/save';
import { itemSkillBonus, skillBonusOf } from '../../src/engine/charstats';
import { passiveStat, passiveStats } from '../../src/engine/skills/rules';
import type { ItemInstance } from '../../src/engine/treasure';

let tables: GameTables;
let data: GameData;
const preset = (id: string): CharacterSave => parseSave(readFileSync(resolve(__dirname, '../../src/presets', `${id}.json`), 'utf8'));

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
});

function makeGame(save: CharacterSave, equipment: Record<string, ItemInstance> = save.equipment): Game {
  const cls = save.character.cls as ClassName;
  const cs = classStats(tables.table('charstats'), cls);
  const w = buildAct1World(gameChain(), tables, data, 55);
  const g = new Game({
    map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), seed: 55, data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: save.character, classStats: cs, expTable: expTable(tables.table('experience'), cls), equipment,
  });
  g.tick();
  return g;
}
const id = (name: string) => data.skills!.byNameOf(name)!.id;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe.skipIf(!hasGameData)('아이템 +스킬 → 유효 스킬 레벨', () => {
  it('장비 합계: 소서리스 프리셋 = 모든 스킬 +4 (SoJ 2 · Tarnhelm · Eye of Etlich), 소서리스 +2, Nova·Blaze +2, Frost Nova +3, 불 스킬 +1 (Magefist)', () => {
    const b = itemSkillBonus(preset('sorceress').equipment, data.items, data.treasure.gen);
    expect(b.all).toBe(4);
    expect(b.elem.get(1)).toBe(1);
    expect(b.cls.get(1)).toBe(2);
    expect([b.single.get(id('Nova')), b.single.get(id('Blaze')), b.single.get(id('Frost Nova'))]).toEqual([2, 2, 3]);
    // 다른 직업 스킬에는 모든 스킬만
    expect(skillBonusOf(b, data.skills!.byId.get(id('Terror'))!, 'sor')).toEqual({ total: 4, single: 0, oskill: 0 });
  });

  it('소서리스 프리셋 (스킬 모두 20): Blizzard 26, Nova 28, Fire Bolt 27 (Magefist 불 +1), 마나 소모·피해도 26레벨 값', () => {
    const g = makeGame(preset('sorceress'));
    expect(g.effectiveSkillLevel(id('Blizzard'))).toBe(26);
    expect(g.effectiveSkillLevel(id('Nova'))).toBe(28);
    expect(g.effectiveSkillLevel(id('Fire Bolt'))).toBe(27);
    expect(g.skillOwner().skillLevel(id('Blizzard'))).toBe(26);
    const calc = data.skillCalc!, bz = data.skills!.byId.get(id('Blizzard'))!;
    expect(calc.manaCost256(bz, 26)).toBeGreaterThan(calc.manaCost256(bz, 20));
    expect(calc.maxElem256(bz, 26, g.skillOwner(), false)).toBeGreaterThan(calc.maxElem256(bz, 20, g.skillOwner(), false));
  });

  it('SoJ 하나를 벗기면 1 줄고, 미감정 SoJ 는 보너스가 없다', () => {
    const s = preset('sorceress');
    const without = { ...s.equipment };
    delete without.lrin;
    expect(makeGame(preset('sorceress'), without).effectiveSkillLevel(id('Blizzard'))).toBe(25);
    const unid = clone(s.equipment);
    unid.lrin!.identified = false;
    unid.rrin!.identified = false;
    expect(makeGame(preset('sorceress'), unid).effectiveSkillLevel(id('Blizzard'))).toBe(24);
  });

  it('네크로맨서 프리셋: Terror 20 + 모든 4 + 네크로 2 + 개별 3 = 29', () => {
    expect(makeGame(preset('necromancer')).effectiveSkillLevel(id('Terror'))).toBe(29);
  });

  it('바바리안 프리셋: Whirlwind 20 + Tarnhelm 1 + SoJ 1 = 22', () => {
    expect(makeGame(preset('barbarian')).effectiveSkillLevel(id('Whirlwind'))).toBe(22);
  });

  it('하드 0 인 스킬도 개별 스킬 아이템이 있으면 쓸 수 있다 (Blaze 0 → 9: 개별 2 + 모든 4 + 소서리스 2 + 불 1), 개별 보너스가 없으면 0 (Fire Bolt)', () => {
    const s = preset('sorceress');
    s.character.skills[id('Blaze')] = 0;
    s.character.skills[id('Fire Bolt')] = 0;
    const g = makeGame(s);
    expect(g.effectiveSkillLevel(id('Blaze'))).toBe(9);
    expect(g.canSelectSkill(data.skills!.byId.get(id('Blaze'))!, 'right')).toBe(true);
    expect(g.effectiveSkillLevel(id('Fire Bolt'))).toBe(0);
    expect(g.canSelectSkill(data.skills!.byId.get(id('Fire Bolt'))!, 'right')).toBe(false);
  });

  it('다른 직업 무기 (소서리스가 Ume\'s Lament): 네크로 +2·Terror +3 은 무시 → Blizzard 24', () => {
    const s = preset('sorceress');
    const eq = { ...s.equipment, rarm: preset('necromancer').equipment.rarm! };
    const g = makeGame(s, eq);
    expect(g.effectiveSkillLevel(id('Blizzard'))).toBe(24);
    expect(g.effectiveSkillLevel(id('Terror'))).toBe(0);
  });

  it('패시브도 유효 레벨: Cold Mastery 20 → 26 으로 passive_cold_pierce 가 커진다', () => {
    const s = preset('sorceress');
    const g = makeGame(s);
    const calc = data.skillCalc!, db = data.skills!;
    const hard = passiveStat(passiveStats(s.character, db, calc), 'passive_cold_pierce');
    const eff = passiveStat(passiveStats(s.character, db, calc, -1, g.skillOwner()), 'passive_cold_pierce');
    expect(g.effectiveSkillLevel(id('Cold Mastery'))).toBe(26);
    expect(eff).toBeGreaterThan(hard);
  });
});
