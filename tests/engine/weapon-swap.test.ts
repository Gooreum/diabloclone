// 무기 바꾸기 (원작 확장팩 W · 인벤토리 I/II 탭): 쉬는 세트와 맞바꾸고, 세트마다 고른 스킬을 따로 기억. 클래식 캐릭터는 안 된다.
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World } from '../../src/data/act1-world';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { makeSave, parseSave, serializeSave } from '../../src/engine/save';

let tables: GameTables;
let classic: GameData;
let lod: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  classic = buildGameData(gameChain(), tables);
  lod = buildGameData(gameChain(), tables, { expansion: true });
});

const item = (d: GameData, code: string): ItemInstance => d.treasure.createItem(d.items.base(code)!, 20, new Rng(5), QUALITY.NORMAL, false);

function makeGame(d: GameData, extra: Partial<ConstructorParameters<typeof Game>[0]> = {}): Game {
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const ch = createCharacter(cs);
  ch.level = 30;
  ch.str = 200;
  ch.dex = 200;
  const w = buildAct1World(gameChain(), tables, d, 55);
  const g = new Game({
    map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), seed: 55, data: d,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
    equipment: { rarm: item(d, 'axe') }, altWeapons: { rarm: item(d, 'gsd') }, ...extra,
  });
  g.tick();
  return g;
}

describe.skipIf(!hasGameData)('무기 바꾸기', () => {
  it('확장팩 캐릭터: W 로 오른손 무기가 쉬는 세트와 바뀌고 피해가 달라진다, 다시 누르면 돌아온다', () => {
    const g = makeGame(lod);
    const dmg = () => { const d = g.derived()!; return [d.weaponMin, d.weaponMax]; };
    const before = dmg();
    expect(g.equipment.rarm?.code).toBe('axe');
    expect(g.swapWeapons()).toBe(true);
    expect(g.equipment.rarm?.code).toBe('gsd');
    expect(g.store.altWeapons.rarm?.code).toBe('axe');
    expect(g.store.weaponSet).toBe(1);
    expect(dmg()).not.toEqual(before);
    g.swapWeapons();
    expect(g.equipment.rarm?.code).toBe('axe');
    expect(g.store.weaponSet).toBe(0);
    expect(dmg()).toEqual(before);
  });

  it('세트마다 고른 스킬을 따로 기억한다', () => {
    const g = makeGame(lod, { altSkills: { left: 0, right: 0 } });
    const c = g.character!;
    c.leftSkill = 0;
    c.rightSkill = 149; // Battle Orders
    g.swapWeapons();
    expect([c.leftSkill, c.rightSkill]).toEqual([0, 0]);
    c.rightSkill = 138; // Shout
    g.swapWeapons();
    expect([c.leftSkill, c.rightSkill]).toEqual([0, 149]);
    g.swapWeapons();
    expect(c.rightSkill).toBe(138);
  });

  it('클래식 캐릭터는 바뀌지 않는다', () => {
    const g = makeGame(classic);
    expect(g.swapWeapons()).toBe(false);
    expect(g.equipment.rarm?.code).toBe('axe');
    expect(g.store.weaponSet).toBe(0);
  });

  it('저장·불러오기: 쉬는 세트·지금 세트·세트별 스킬이 그대로', () => {
    const g = makeGame(lod);
    g.swapWeapons();
    const s = parseSave(serializeSave(makeSave('Swap', g.character!, 0, {
      inventory: [], equipment: g.equipment as Record<string, ItemInstance>, expansion: true,
      altWeapons: g.store.altWeapons as Record<string, ItemInstance>, weaponSet: g.store.weaponSet, altSkills: g.altSkills,
    })));
    expect(s.weaponSet).toBe(1);
    expect(s.altWeapons?.rarm?.code).toBe('axe');
    expect(s.equipment.rarm?.code).toBe('gsd');
    const back = makeGame(lod, { equipment: s.equipment, altWeapons: s.altWeapons, weaponSet: s.weaponSet, altSkills: s.altSkills });
    back.swapWeapons();
    expect(back.equipment.rarm?.code).toBe('axe');
    expect(back.store.weaponSet).toBe(0);
  });
});
