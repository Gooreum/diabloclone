// 표시 언어: 한국어는 영어 표 위에 원작 kor 표 (d2exp kor\string.tbl, patch_d2 kor\patchstring.tbl) 를 덮는다.
// kor\expansionstring.tbl 이 없어 확장팩 전용 문자열은 영어. 확장팩 MPQ (game-data/lod, d2exp.mpq) 가 있어야 실행된다.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { loadLang, lngPaths, saveLang } from '../../src/data/lang';
import { GameTables } from '../../src/data/tables';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { parseTbl } from '../../src/formats/tbl';
import { GAME_DATA } from '../support/gamedata';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));

describe('언어 설정', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('표 경로: 영어 3개, 한국어는 영어 3개 + 한국어 3개', () => {
    expect(lngPaths('eng')).toEqual(['data\\local\\lng\\eng\\string.tbl', 'data\\local\\lng\\eng\\expansionstring.tbl', 'data\\local\\lng\\eng\\patchstring.tbl']);
    expect(lngPaths('kor')).toHaveLength(6);
    expect(lngPaths('kor')[3]).toBe('data\\local\\lng\\kor\\string.tbl');
  });
  it('저장소가 없거나 이상한 값이면 영어, 저장한 값은 다시 읽힌다', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadLang()).toBe('eng');
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) });
    mem.set('d2clone.lang', 'xx');
    expect(loadLang()).toBe('eng');
    saveLang('kor');
    expect(loadLang()).toBe('kor');
  });
});

describe.skipIf(!hasLod)('한국어 문자열 (원작 kor 표)', () => {
  const chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
  it('한국어: 아이템·몬스터 이름이 원작 한국어', () => {
    const t = new GameTables(chain, 'kor');
    expect(t.string('ssd')).toBe('숏소드');
    expect(t.string('Andariel')).toMatch(/[가-힣]/);
  });
  it('한국어 표에 없는 확장팩 전용 문자열: 자체 번역이 없으면 영어, 있으면 그 번역', () => {
    const exp = parseTbl(chain.read('data\\local\\lng\\eng\\expansionstring.tbl')!);
    const kor = new Map([...parseTbl(chain.read('data\\local\\lng\\kor\\string.tbl')!, 'utf-8'), ...parseTbl(chain.read('data\\local\\lng\\kor\\patchstring.tbl')!, 'utf-8')]);
    expect(kor.has('Harrogath')).toBe(false);
    expect(exp.get('Harrogath')).toBe('Harrogath');
    expect(new GameTables(chain, 'kor').string('Harrogath')).toBe('Harrogath');
    expect(new GameTables(chain, 'kor', { Harrogath: '하로가스' }).string('Harrogath')).toBe('하로가스');
  });
  it('공식 한국어 표에 있는 키는 자체 번역이 있어도 공식 값', () => {
    expect(new GameTables(chain, 'kor', { ssd: '우리번역' }).string('ssd')).toBe('숏소드');
  });
  it('영어 (기본) 는 지금과 같고 자체 번역을 무시한다', () => {
    expect(new GameTables(chain).string('ssd')).toBe('Short Sword');
    expect(new GameTables(chain, 'eng', { ssd: '우리번역', Harrogath: '하로가스' }).string('Harrogath')).toBe('Harrogath');
  });
  it('사용자 MPQ 에 공식 kor\\expansionstring.tbl 이 있으면 그 값이 자체 번역보다 우선, 거기에도 없는 키만 채운다', () => {
    // 가짜 소스: kor\expansionstring.tbl 요청에 영어 expansionstring 바이트를 준다 (ASCII 라 UTF-8 로 그대로 읽힘)
    const fake = { read: (p: string) => chain.read(/kor\\expansionstring\.tbl$/i.test(p) ? 'data\\local\\lng\\eng\\expansionstring.tbl' : p) };
    const t = new GameTables(fake, 'kor', { Harrogath: '하로가스', GemXp1: '테스트' });
    expect(t.string('Harrogath')).toBe('Harrogath'); // "공식" 파일 값
    expect(t.string('ssd')).toBe('숏소드');
    expect(t.string('GemXp1')).toBe('테스트'); // eng patchstring 에만 있고 kor 표 어디에도 없는 키
  });
});
