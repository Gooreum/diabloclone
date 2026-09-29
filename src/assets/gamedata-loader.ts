// 브라우저: GameData 에 필요한 원작 파일을 미리 불러온 뒤 조립
import { buildGameData } from '../data/gamedata';
import { GameTables } from '../data/tables';
import type { AssetLoader } from './loader';
import type { GameData } from '../engine/game';

export const EXCEL_TABLES = ['weapons', 'armor', 'misc', 'ItemTypes', 'TreasureClassEx', 'ItemRatio', 'MonStats', 'MonStats2', 'MonLvl', 'HitClass', 'Missiles', 'charstats', 'experience', 'Levels', 'skills', 'skilldesc', 'DifficultyLevels',
  'MagicPrefix', 'MagicSuffix', 'RarePrefix', 'RareSuffix', 'UniqueItems', 'SetItems', 'Sets', 'QualityItems', 'LowQualityItems', 'Properties', 'ItemStatCost', 'Gems', 'Inventory', 'Belts', 'npc', 'books'];

export async function loadGameData(assets: AssetLoader): Promise<{ data: GameData; tables: GameTables }> {
  await assets.preload([...EXCEL_TABLES.map((t) => `data\\global\\excel\\${t}.txt`), 'data\\global\\AnimData.d2']);
  const tables = new GameTables(assets);
  return { data: buildGameData(assets, tables), tables };
}
