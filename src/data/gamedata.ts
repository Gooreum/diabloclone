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
import { HirelingDb } from '../engine/hireling';
import { CubeDb } from '../engine/cube';
import { RunewordDb } from '../engine/runewords';
import { parseGamble } from '../engine/shop';
import { parseOverlays, parseStateGroups, parseStateInfo, parseStateOverlays } from '../engine/states';
import type { GameData } from '../engine/game';
import type { Difficulty } from '../engine/difficulty';
import { GameTables, type AssetSource } from './tables';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

/**
 * @param opts.expansion 확장팩 캐릭터용 (원작 wVersion 100). 1.14d 는 클래식 patch_d2 에도 확장팩 표가 다 있다 — 표는 같고 생성 규칙만 다르다
 */
export function buildGameData(src: AssetSource, tables = new GameTables(src), opts: { expansion?: boolean } = {}): GameData {
  const expansion = opts.expansion ?? false;
  const items = new ItemDb({ weapons: tables.table('weapons'), armor: tables.table('armor'), misc: tables.table('misc'), itemtypes: tables.table('ItemTypes') });
  const treasure = new TreasureDb(items, tables.table('TreasureClassEx'), tables.table('ItemRatio'), expansion);
  treasure.gen = new ItemGen(items, {
    magicprefix: tables.table('MagicPrefix'), magicsuffix: tables.table('MagicSuffix'), rareprefix: tables.table('RarePrefix'), raresuffix: tables.table('RareSuffix'),
    uniqueitems: tables.table('UniqueItems'), setitems: tables.table('SetItems'), sets: tables.table('Sets'),
    qualityitems: tables.table('QualityItems'), lowqualityitems: tables.table('LowQualityItems'),
    properties: tables.table('Properties'), itemstatcost: tables.table('ItemStatCost'), skills: tables.table('skills'), gems: tables.table('Gems'),
  }, expansion);
  const monsters = new MonsterDb(tables.table('MonStats'), tables.table('MonStats2'), tables.table('MonLvl'), tables.table('MonSeq'), 0, undefined, expansion);
  const animBytes = src.read('data\\global\\AnimData.d2');
  if (!animBytes) throw new Error('AnimData.d2 not found');
  const hitClassIndex = new Map<string, number>();
  tables.table('HitClass').forEach((r, i) => r.Code && hitClassIndex.set(r.Code, i));
  const missiles = parseMissiles(tables.table('Missiles'));
  const skills = new SkillDb(tables.table('skills'), tables.table('skilldesc'), (k) => tables.string(k));
  // 출처: DifficultyLevels.txt Normal 행 — MonsterColdDivisor / MonsterFreezeDivisor
  const normal = tables.table('DifficultyLevels').find((r) => r.Name === 'Normal');
  return {
    expansion, items, treasure, monsters, anim: AnimData.parse(animBytes), hitClassIndex, missiles,
    skills, skillCalc: new SkillCalc(skills), coldDivisor: n(normal?.MonsterColdDivisor) || 1, freezeDivisor: n(normal?.MonsterFreezeDivisor) || 1,
    difficultyRows: tables.table('DifficultyLevels'), npcPrices: parseNpcPrices(tables.table('npc')), bookCharge: parseBookCharges(tables.table('books')),
    objects: new ObjectDb({ objects: tables.table('Objects'), objGroup: tables.table('ObjGroup'), shrines: tables.table('shrines'), levels: tables.table('Levels') }, expansion),
    hirelings: new HirelingDb(tables.table('Hireling'), tables.table('HireDesc'), expansion),
    // 호라드릭 큐브 조합 (cubemain.txt — 유니크·세트 이름 입력은 uniqueitems / setitems index)
    cube: new CubeDb(tables.table('CubeMain'), items, treasure.gen.uniques.map((u) => u.name), treasure.gen.setItems.map((u) => u.name)),
    runewords: new RunewordDb(tables.table('Runes')),
    gamble: parseGamble(items, tables.table('gamble')),
    stateOverlays: parseStateOverlays(tables.table('States'), tables.table('Overlay')),
    stateGroups: parseStateGroups(tables.table('States')),
    stateInfo: parseStateInfo(tables.table('States')),
    overlays: parseOverlays(tables.table('Overlay')),
    monEquip: tables.table('MonEquip'),
    uniques: new UniqueDb(monsters, {
      monUMod: tables.table('MonUMod'), superUniques: tables.table('SuperUniques'), monPreset: tables.table('MonPreset'), monPlace: tables.table('MonPlace'),
      prefix: tables.table('UniquePrefix'), suffix: tables.table('UniqueSuffix'), appellation: tables.table('UniqueAppellation'),
    }),
  };
}

/**
 * 난이도 판 GameData: 몬스터 표(monstats (N)/(H)·MonLvl (N)/(H)), 슈퍼유니크 표(TC(N)·Utrans(N)), 오브젝트 레벨 표(MonLvl2/3·상자 TC) 만 바꾸고 나머지는 같은 객체.
 * 월드 만들기(buildActWorld — levels.txt MonDen·nmon 목록)와 Game 이 같은 사본을 쓴다.
 * 출처: 원작은 표 하나에 난이도 칸 배열을 들고 pGame->nDifficulty 로 고른다 — 여기서는 게임마다 그 난이도의 표 사본
 */
export function withDifficulty(data: GameData, difficulty: Difficulty): GameData {
  if (difficulty === (data.monsters.difficulty ?? 0)) return data;
  const monsters = data.monsters.forDifficulty(difficulty);
  return {
    ...data,
    monsters,
    ...(data.uniques ? { uniques: data.uniques.forDifficulty(difficulty, monsters) } : {}),
    ...(data.objects ? { objects: data.objects.forDifficulty(difficulty) } : {}),
  };
}
