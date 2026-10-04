// 자체 한국어 번역(src/data/lang/kor-fallback.ts) 무결성: 원작에 있는 키만, 공식 한국어 표에 없는 키만, 자리 표시자·색 코드·대사 앞 숫자 보존.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { KOR_FALLBACK } from '../../src/data/lang/kor-fallback';
import { GameTables } from '../../src/data/tables';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { parseTbl } from '../../src/formats/tbl';
import { GAME_DATA } from '../support/gamedata';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));

const ph = (s: string) => (s.match(/%[+-]?\d*[dsiu%]/g) ?? []).sort().join(',');
const cc = (s: string) => (s.match(/ÿc./g) ?? []).sort().join(',');
const lead = (s: string) => /^(\d+)\n/.exec(s)?.[1] ?? '';

describe.skipIf(!hasLod)('자체 한국어 번역 (kor-fallback)', () => {
  const chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
  const tbl = (lang: string, file: string, enc: 'latin1' | 'utf-8') => { const b = chain.read(`data\\local\\lng\\${lang}\\${file}`); return b ? parseTbl(b, enc) : new Map<string, string>(); };
  const engBase = tbl('eng', 'string.tbl', 'latin1');
  const engExt = new Map([...tbl('eng', 'expansionstring.tbl', 'latin1'), ...tbl('eng', 'patchstring.tbl', 'latin1')]);
  const kor = new Map([...tbl('kor', 'string.tbl', 'utf-8'), ...tbl('kor', 'expansionstring.tbl', 'utf-8'), ...tbl('kor', 'patchstring.tbl', 'utf-8')]);
  const keys = Object.keys(KOR_FALLBACK);

  it('모든 키가 원작 영어 확장팩/패치 표에 있고, 공식 한국어 표에는 없다', () => {
    const notInEng = keys.filter((k) => !engExt.has(k) && !engBase.has(k));
    const inKor = keys.filter((k) => kor.has(k));
    expect(notInEng).toEqual([]);
    expect(inKor).toEqual([]);
  });

  it('한국어가 없는 확장팩 키를 하나도 빠짐없이 채운다', () => {
    const need = [...engExt.keys()].filter((k) => !engBase.has(k) && !kor.has(k));
    const missing = need.filter((k) => !(k in KOR_FALLBACK));
    expect(missing).toEqual([]);
    expect(keys.length).toBe(need.length);
  });

  it('자리 표시자·색 코드·대사 앞 숫자가 영어 원문과 같다', () => {
    const bad: string[] = [];
    for (const k of keys) {
      const e = engExt.get(k) ?? engBase.get(k)!, v = KOR_FALLBACK[k]!;
      if (ph(e) !== ph(v) || cc(e) !== cc(v) || lead(e) !== lead(v)) bad.push(k);
    }
    expect(bad).toEqual([]);
  });

  it('값 대부분에 한글이 있다 (기호·숫자·코드뿐인 항목 제외)', () => {
    const noHangul = keys.filter((k) => !/[가-힣]/.test(KOR_FALLBACK[k]!));
    expect(noHangul.length).toBeLessThan(keys.length * 0.05);
  });

  it('대표 키: 하로가스·라주크·엘드 룬·드루이드 스킬 이름', () => {
    expect(KOR_FALLBACK.Harrogath).toBe('하로가스');
    expect(KOR_FALLBACK.Larzuk).toBe('라주크');
    expect(KOR_FALLBACK.r02).toBe('엘드 룬');
    expect(KOR_FALLBACK.Skillname230).toBe('몰튼 볼더'); // 드루이드 스킬 (expansionstring Skillname222~)
    const t = new GameTables(chain, 'kor', KOR_FALLBACK);
    expect(t.string('Harrogath')).toBe('하로가스');
    expect(t.string('ssd')).toBe('숏소드');
  });
});
