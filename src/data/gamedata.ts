// 원작 데이터에서 엔진용 GameData 조립 (DOM 비의존 — 브라우저/Node 공용)
import { AnimData } from '../formats/animdata';
import { ItemDb } from '../engine/items';
import { MonsterDb } from '../engine/monster';
import { TreasureDb } from '../engine/treasure';
import { parseMissiles } from '../engine/missiles';
import { SkillDb } from '../engine/skills/db';
import { SkillCalc } from '../engine/skills/formulas';
import { parseBookCharges, parseNpcPrices } from '../engine/price';
import { ItemGen } from '../engine/itemgen';
import { ObjectDb } from '../engine/objects';
import { UniqueDb } from '../engine/uniques';
import type { GameData } from '../engine/game';
import { GameTables, type AssetSource } from './tables';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export function buildGameData(src: AssetSource, tables = new GameTables(src)): GameData {
  const items = new ItemDb({ weapons: tables.table('weapons'), armor: tables.table('armor'), misc: tables.table('misc'), itemtypes: tables.table('ItemTypes') });
  const treasure = new TreasureDb(items, tables.table('TreasureClassEx'), tables.table('ItemRatio'));
  treasure.gen = new ItemGen(items, {
    magicprefix: tables.table('MagicPrefix'), magicsuffix: tables.table('MagicSuffix'), rareprefix: tables.table('RarePrefix'), raresuffix: tables.table('RareSuffix'),
    uniqueitems: tables.table('UniqueItems'), setitems: tables.table('SetItems'), sets: tables.table('Sets'),
    qualityitems: tables.table('QualityItems'), lowqualityitems: tables.table('LowQualityItems'),
    properties: tables.table('Properties'), itemstatcost: tables.table('ItemStatCost'), skills: tables.table('skills'), gems: tables.table('Gems'),
  });
  const monsters = new MonsterDb(tables.table('MonStats'), tables.table('MonStats2'), tables.table('MonLvl'), tables.table('MonSeq'));
  const animBytes = src.read('data\\global\\AnimData.d2');
  if (!animBytes) throw new Error('AnimData.d2 not found');
  const hitClassIndex = new Map<string, number>();
  tables.table('HitClass').forEach((r, i) => r.Code && hitClassIndex.set(r.Code, i));
  const missiles = parseMissiles(tables.table('Missiles'));
  const skills = new SkillDb(tables.table('skills'), tables.table('skilldesc'), (k) => tables.string(k));
  // 출처: DifficultyLevels.txt Normal 행 — MonsterColdDivisor / MonsterFreezeDivisor
  const normal = tables.table('DifficultyLevels').find((r) => r.Name === 'Normal');
  return {
    items, treasure, monsters, anim: AnimData.parse(animBytes), hitClassIndex, missiles,
    skills, skillCalc: new SkillCalc(skills), coldDivisor: n(normal?.MonsterColdDivisor) || 1, freezeDivisor: n(normal?.MonsterFreezeDivisor) || 1,
    difficultyRows: tables.table('DifficultyLevels'), npcPrices: parseNpcPrices(tables.table('npc')), bookCharge: parseBookCharges(tables.table('books')),
    objects: new ObjectDb({ objects: tables.table('Objects'), objGroup: tables.table('ObjGroup'), shrines: tables.table('shrines'), levels: tables.table('Levels') }),
    uniques: new UniqueDb(monsters, {
      monUMod: tables.table('MonUMod'), superUniques: tables.table('SuperUniques'), monPreset: tables.table('MonPreset'), monPlace: tables.table('MonPlace'),
      prefix: tables.table('UniquePrefix'), suffix: tables.table('UniqueSuffix'), appellation: tables.table('UniqueAppellation'),
    }),
  };
}
