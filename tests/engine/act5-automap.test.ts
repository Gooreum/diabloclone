// Act 5 자동 지도: AutoMap.txt LevelName 은 LvlTypes Id 를 인덱스로 하는 고정 표 (D2MOO LevelsTbls.cpp gszAutomapLevelNames).
// "Act 5 - Ice Caves"(Id 33) → "5 Ice" 가 안 맞아 얼음 동굴 지역 지도가 비어 있던 버그의 회귀 테스트.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { GAME_DATA } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { makeDrlgData } from '../../src/data/drlg-data';
import { buildGameData } from '../../src/data/gamedata';
import { buildActWorld } from '../../src/data/world';
import { ACT2MAP_PLACEHOLDERS } from '../../src/data/world-level';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { parseDc6 } from '../../src/formats/dc6';
import { AUTOMAP_LEVEL_NAMES, AUTOMAP_TILE, AutomapTable } from '../../src/engine/automap';
import { generateAct2World } from '../../src/engine/drlg/act2';
import { LVLTYPE5 } from '../../src/engine/drlg/act5-ids';
import type { DrlgData } from '../../src/engine/drlg/types';
import type { GameData } from '../../src/engine/game';

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

// 마을 자동 지도: LvlPrest AutoMap=1 → 전부 드러냄, 2·4·5막 마을은 그림 (출처: D2MOO DrlgPreset.cpp pfAutomap/pfTownAutomap)
d('마을 자동 지도 (LvlPrest AutoMap, 마을 그림 DC6)', () => {
  let chain: MpqChain;
  let tables: GameTables;
  let gameData: GameData;
  beforeAll(() => {
    chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
    tables = new GameTables(chain);
    gameData = buildGameData(chain, tables, { expansion: true });
  }, 180_000);

  it('LvlPrest AutoMap=1 인 LevelId = 마을 5곳 (1, 40, 75, 103, 109)', () => {
    const ids = tables.table('LvlPrest').filter((r) => Number(r.AutoMap) === 1).map((r) => Number(r.LevelId)).sort((a, b) => a - b);
    expect(ids).toEqual([1, 40, 75, 103, 109]);
  });

  it('하로가스: automapAll + ExTnMap 3×2, Bloody Foothills 는 없음', () => {
    const w = buildActWorld(chain, tables, gameData, 1234, 4);
    const h = w.byKey.get('harrogath')!;
    expect(h.def.automapAll).toBe(true);
    expect(h.townMap).toEqual({ file: 'ExTnMap', cols: 3, rows: 2, variant: 0 });
    const b = w.byKey.get('bloodyfoothills')!;
    expect(b.def.automapAll).toBeUndefined();
    expect(b.townMap).toBeNull();
  });

  it('루트 골레인: Act2Map 5×4, 묶음 = Act 2 DRLG 가 고른 마을 파일 (LutW 0 / LutN 1)', () => {
    const w = buildActWorld(chain, tables, gameData, 777, 1);
    const l = w.byKey.get('lutgholein')!;
    expect(l.def.automapAll).toBe(true);
    expect(l.townMap?.file).toBe('Act2Map');
    expect([l.townMap?.cols, l.townMap?.rows]).toEqual([5, 4]);
    expect([0, 1]).toContain(l.townMap?.variant);
    // LvlPrest 301: File1 비어 있음, File2 LutW, File3 LutN → townFile 1 = LutW(묶음 0), 2 = LutN(묶음 1)
    const dd = makeDrlgData(chain, tables);
    const picked = generateAct2World(dd, 777).townFile;
    expect([1, 2]).toContain(picked);
    expect(l.townMap?.variant).toBe(/LutN/i.test(dd.lvlPrestByLevel(40)!.file[picked]!) ? 1 : 0);
  });

  it('판데모니움 요새: Act4Map 2×2, 로그 야영지·쿠라스트 부두는 그림 없이 전부 드러냄', () => {
    const w4 = buildActWorld(chain, tables, gameData, 1234, 3);
    const p = w4.byKey.get('pandemonium')!;
    expect(p.def.automapAll).toBe(true);
    expect(p.townMap).toEqual({ file: 'Act4Map', cols: 2, rows: 2, variant: 0 });
    const w3 = buildActWorld(chain, tables, gameData, 1234, 2);
    const k = w3.byKey.get('kurastdocks')!;
    expect(k.def.automapAll).toBe(true);
    expect(k.townMap).toBeNull();
  });

  it('마을 그림 DC6: 프레임 수·크기 (전체 지도 / 미니맵 S 판)', () => {
    const expectDc6 = (name: string, frames: number, w: number, h: number) => {
      const b = chain.read(`data\\global\\ui\\automap\\${name}.dc6`);
      expect(b, name).toBeTruthy();
      const dc6 = parseDc6(b!);
      expect(dc6.frames.length, name).toBe(frames);
      for (const f of dc6.frames) expect([f.width, f.height], name).toEqual([w, h]);
    };
    expectDc6('Act2Map', 40, 160, 100);
    expectDc6('Act2MapS', 40, 80, 50);
    expectDc6('Act4Map', 4, 136, 90);
    expectDc6('Act4MapS', 4, 68, 45);
    expectDc6('ExTnMap', 6, 180, 170);
    expectDc6('ExTnMapS', 6, 90, 85);
  });

  it('Act2Map 의 X 자리 표시 조각: 팔레트 98·155·91·102 만 쓰고, 다른 조각은 그 색을 안 쓴다', () => {
    const dc6 = parseDc6(chain.read('data\\global\\ui\\automap\\Act2Map.dc6')!);
    const X = new Set([98, 155, 91, 102]);
    dc6.frames.forEach((f, i) => {
      let x = 0, other = 0;
      for (const p of f.pixels) if (p) X.has(p) ? x++ : other++;
      if (ACT2MAP_PLACEHOLDERS.includes(i)) expect([x > 1000, other], `frame ${i}`).toEqual([true, 0]);
      else expect(x <= 2, `frame ${i}`).toBe(true);
    });
    const w = buildActWorld(chain, tables, gameData, 777, 1);
    expect(w.byKey.get('lutgholein')!.townMap?.skip).toBe(ACT2MAP_PLACEHOLDERS);
  });
});
