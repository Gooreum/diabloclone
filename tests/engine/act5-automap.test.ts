// Act 5 자동 지도: AutoMap.txt LevelName 은 LvlTypes Id 를 인덱스로 하는 고정 표 (D2MOO LevelsTbls.cpp gszAutomapLevelNames).
// "Act 5 - Ice Caves"(Id 33) → "5 Ice" 가 안 맞아 얼음 동굴 지역 지도가 비어 있던 버그의 회귀 테스트.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { GAME_DATA } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { makeDrlgData } from '../../src/data/drlg-data';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { AUTOMAP_LEVEL_NAMES, AUTOMAP_TILE, AutomapTable } from '../../src/engine/automap';
import { LVLTYPE5 } from '../../src/engine/drlg/act5-ids';
import type { DrlgData } from '../../src/engine/drlg/types';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));
const d = hasLod ? describe : describe.skip;

d('Act 5 자동 지도 (AutoMap.txt LevelName = D2MOO gszAutomapLevelNames, 인덱스 = LvlTypes Id)', () => {
  let tables: GameTables;
  let data: DrlgData;
  beforeAll(() => {
    const chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
    tables = new GameTables(chain);
    data = makeDrlgData(chain, tables);
  }, 180_000);

  it('고정 표: 36 칸, LvlTypes.txt 의 Id 마다 "Act N - …" 의 액트 숫자와 같은 접두', () => {
    expect(AUTOMAP_LEVEL_NAMES).toHaveLength(36);
    let checked = 0;
    for (const r of tables.table('LvlTypes')) {
      if (r.Id === undefined || r.Id === '' || r.Name === 'Expansion') continue;
      const m = /^Act (\d) - /.exec(r.Name ?? '');
      if (!m) continue;
      expect(AUTOMAP_LEVEL_NAMES[Number(r.Id)]?.startsWith(`${m[1]} `), `${r.Id} ${r.Name}`).toBe(true);
      checked++;
    }
    expect(checked).toBe(35);
    expect(AutomapTable.levelName(LVLTYPE5.ICE_CAVES)).toBe('5 Ice');
    expect(AutomapTable.levelName(LVLTYPE5.TOWN)).toBe('5 Town');
    expect(AutomapTable.levelName(LVLTYPE5.BAAL)).toBe('5 Baal');
    expect(AutomapTable.levelName(99)).toBe('');
  });

  it('타일 약어 표: AutoMap.txt 의 모든 TileName 이 표에 있고 fl=0 … tr=14 … fi=19', () => {
    expect(AUTOMAP_TILE.fl).toBe(0);
    expect(AUTOMAP_TILE.co).toBe(12);
    expect(AUTOMAP_TILE.tr).toBe(14);
    expect(AUTOMAP_TILE.fi).toBe(19);
    for (const r of tables.table('AutoMap')) if (r.TileName) expect(AUTOMAP_TILE[r.TileName], r.TileName).toBeDefined();
  });

  it('"5 Ice" 에는 자동 지도 셀이 있고, 예전 이름 "5 Ice Caves" 와 하로가스 "5 Town" 에는 없다', () => {
    const t = new AutomapTable(tables.table('AutoMap'));
    // AutoMap.txt "5 Ice": fl 스타일 1 시퀀스 1 = 1349~1351, wl 스타일 0 (시퀀스 전부) = 1340
    expect(t.cels('5 Ice', 0, 1, 1)).toEqual([1349, 1350, 1351]);
    expect(t.cels('5 Ice', 1, 0, 5)).toEqual([1340]);
    expect(t.cels('5 Ice Caves', 0, 1, 1)).toEqual([]); // 버그 재현: 가공한 이름은 행 없음
    expect(t.cels('5 Town', 0, 1, 1)).toEqual([]); // 원작도 하로가스 행 없음 → 빈 지도
  });

  it('Levels.txt LevelType → automapName: 얼음 동굴 6곳 "5 Ice", 하로가스·Bloody Foothills·Frigid Highlands·Worldstone Keep', () => {
    const name = (levelId: number) => AutomapTable.levelName(data.level(levelId).levelType);
    // 113 crystallinepassage, 114 frozenriver, 115 glacialtrail, 116 driftercavern, 118 ancientsway, 119 icycellar
    for (const id of [113, 114, 115, 116, 118, 119]) expect(name(id), data.level(id).levelName).toBe('5 Ice');
    expect(name(109)).toBe('5 Town'); // Harrogath
    expect(name(110)).toBe('5 Siege'); // Bloody Foothills
    expect(name(111)).toBe('5 Barricade'); // Frigid Highlands
    expect(name(128)).toBe('5 Baal'); // Worldstone Keep 1
  });
});
