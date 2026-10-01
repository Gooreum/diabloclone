// 확장팩 MPQ 체인 (patch_d2(확장팩판) > d2exp > d2char(확장팩판) > d2data) 으로 게임 데이터가 만들어지는지.
// game-data/lod/ (확장팩판 patch_d2·d2char) 와 game-data/d2exp.mpq 가 있어야 실행된다.
// 출처: 원작 1.14d 확장팩 charstats (7 직업: Druid·Assassin 추가), Levels (Act 5 Harrogath)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { buildGameData } from '../../src/data/gamedata';
import { GameTables } from '../../src/data/tables';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { GAME_DATA } from '../support/gamedata';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));

describe.skipIf(!hasLod)('확장팩 게임 데이터', () => {
  it('확장팩 체인으로 표를 읽고 GameData 를 만든다', () => {
    const chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
    const tables = new GameTables(chain);
    const classes = tables.table('charstats').map((r) => r.class).filter((c) => c && c !== 'Expansion');
    expect(classes).toEqual(['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian', 'Druid', 'Assassin']);
    expect(tables.table('Levels').some((r) => r.LevelName === 'Harrogath')).toBe(true);
    // 엔진은 아직 클래식 5 직업만 다룬다 — 확장팩 표로도 조립은 되어야 한다 (확장팩 내용은 다음 작업)
    const data = buildGameData(chain, tables);
    expect(data.skills!.byNameOf('Blizzard')).toBeTruthy();
  });
});
