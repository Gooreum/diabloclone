// 원작 데이터에서 엔진용 GameData 조립 (DOM 비의존 — 브라우저/Node 공용)
import { AnimData } from '../formats/animdata';
import { ItemDb } from '../engine/items';
import { MonsterDb } from '../engine/monster';
import { TreasureDb } from '../engine/treasure';
import type { GameData } from '../engine/game';
import { GameTables, type AssetSource } from './tables';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export function buildGameData(src: AssetSource, tables = new GameTables(src)): GameData {
  const items = new ItemDb({ weapons: tables.table('weapons'), armor: tables.table('armor'), misc: tables.table('misc'), itemtypes: tables.table('ItemTypes') });
  const treasure = new TreasureDb(items, tables.table('TreasureClassEx'), tables.table('ItemRatio'));
  const monsters = new MonsterDb(tables.table('MonStats'), tables.table('MonStats2'), tables.table('MonLvl'));
  const animBytes = src.read('data\\global\\AnimData.d2');
  if (!animBytes) throw new Error('AnimData.d2 not found');
  const hitClassIndex = new Map<string, number>();
  tables.table('HitClass').forEach((r, i) => r.Code && hitClassIndex.set(r.Code, i));
  const missiles = new Map<string, { vel: number; range: number; size: number; srcDamagePct: number; minDamage: number; maxDamage: number }>();
  for (const r of tables.table('Missiles')) {
    if (!r.Missile) continue;
    missiles.set(r.Missile, { vel: n(r.Vel), range: n(r.Range), size: n(r.Size), srcDamagePct: n(r.SrcDamage), minDamage: n(r.MinDamage), maxDamage: n(r.MaxDamage) });
  }
  return { items, treasure, monsters, anim: AnimData.parse(animBytes), hitClassIndex, missiles };
}
