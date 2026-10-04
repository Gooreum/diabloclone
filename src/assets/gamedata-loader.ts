// 브라우저: GameData 에 필요한 원작 파일을 미리 불러온 뒤 조립
import { buildGameData } from '../data/gamedata';
import { GameTables } from '../data/tables';
import type { Lang } from '../data/lang';
import type { AssetLoader } from './loader';
import type { GameData } from '../engine/game';

export const EXCEL_TABLES = ['weapons', 'armor', 'misc', 'ItemTypes', 'TreasureClassEx', 'ItemRatio', 'MonStats', 'MonStats2', 'MonLvl', 'HitClass', 'Missiles', 'charstats', 'experience', 'Levels', 'skills', 'skilldesc', 'DifficultyLevels',
  'MagicPrefix', 'MagicSuffix', 'RarePrefix', 'RareSuffix', 'UniqueItems', 'SetItems', 'Sets', 'QualityItems', 'LowQualityItems', 'Properties', 'ItemStatCost', 'Gems', 'Inventory', 'Belts', 'npc', 'books',
  'Objects', 'ObjGroup', 'shrines', 'AutoMap', 'LvlTypes', 'states', 'Overlay',
  'MonSeq', 'MonUMod', 'SuperUniques', 'MonPreset', 'MonPlace', 'UniquePrefix', 'UniqueSuffix', 'UniqueAppellation',
  'Hireling', 'HireDesc', 'gamble', 'CubeMain', 'Runes', 'MonEquip'];

export async function loadGameData(assets: AssetLoader, lang: Lang = 'eng'): Promise<{ data: GameData; tables: GameTables }> {
  await assets.preload([...EXCEL_TABLES.map((t) => `data\\global\\excel\\${t}.txt`), 'data\\global\\AnimData.d2']);
  // 자체 번역은 그 언어를 골랐을 때만 읽는다 (별도 청크) — 공식 표에 없는 키만 채운다 (GameTables.string)
  const fallback = lang === 'kor' ? (await import('../data/lang/kor-fallback')).KOR_FALLBACK : null;
  const tables = new GameTables(assets, lang, fallback);
  return { data: buildGameData(assets, tables), tables };
}
