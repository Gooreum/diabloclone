import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPRESSION, hashString, MpqArchive, MpqChain, MpqError, registerDecompressor } from '../../src/formats/mpq';
import { buildMpq } from '../support/mpqbuilder';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
const big = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

describe('MPQ crypt/hash', () => {
  // 출처: Zezula MPQ format — 해시/블록 테이블 키 상수 (http://www.zezula.net/en/mpq/mpqformat.html)
  it('hashString("(hash table)", 3) = 0xC3AF3770', () => {
    expect(hashString('(hash table)', 3)).toBe(0xc3af3770);
  });
  it('hashString("(block table)", 3) = 0xEC83B3A3', () => {
    expect(hashString('(block table)', 3)).toBe(0xec83b3a3);
  });
  it('경로는 대소문자·슬래시 구분 없이 같은 해시', () => {
    expect(hashString('data/global/excel/monstats.txt', 0)).toBe(hashString('DATA\\GLOBAL\\EXCEL\\MONSTATS.TXT', 0));
  });
});

describe('MPQ 아카이브 (합성 테스트 아카이브)', () => {
  const long = big(3000); // 512바이트 섹터 6개 이상
  const mpq = MpqArchive.open(buildMpq([
    { name: 'data\\global\\excel\\monstats.txt', data: enc('Id\thcIdx\nskeleton1\t0\n') },
    { name: 'data\\plain_multi.bin', data: long },
    { name: 'data\\enc_multi.bin', data: long, encrypted: true },
    { name: 'data\\enc_fix.bin', data: long, encrypted: true, fixKey: true },
    { name: 'data\\single.bin', data: enc('single unit file!'), singleUnit: true, encrypted: true },
    { name: 'data\\packed_raw.bin', data: long, encrypted: true, compressed: { flag: 'compress' } },
    { name: 'data\\huff.wav', data: big(512), compressed: { flag: 'compress', sectors: [Uint8Array.from([COMPRESSION.BZIP2, 1, 2, 3])] } },
    { name: 'data\\imploded.bin', data: big(512), compressed: { flag: 'implode', sectors: [Uint8Array.from([9, 9, 9])] } },
    { name: '(listfile)', data: enc('data\\global\\excel\\monstats.txt\r\ndata\\single.bin\r\n') },
  ]));

  it('평문 파일 읽기', () => {
    expect(dec(mpq.read('data\\global\\excel\\monstats.txt'))?.split('\t')[0]).toBe('Id');
  });
  it('다중 섹터 평문/암호화/FIX_KEY 파일이 원본과 같다', () => {
    for (const n of ['data\\plain_multi.bin', 'data\\enc_multi.bin', 'data\\enc_fix.bin']) {
      expect(mpq.read(n)).toEqual(long);
    }
  });
  it('SINGLE_UNIT 암호화 파일', () => {
    expect(dec(mpq.read('data\\single.bin'))).toBe('single unit file!');
  });
  it('섹터 테이블이 있고 섹터가 비압축 저장된 파일', () => {
    expect(mpq.read('data\\packed_raw.bin')).toEqual(long);
  });
  it('없는 경로는 null', () => {
    expect(mpq.read('data\\nope.txt')).toBeNull();
    expect(mpq.has('data\\nope.txt')).toBe(false);
  });
  it('미지원 압축(bzip2 — D2 MPQ 미사용)은 명확한 에러', () => {
    expect(() => mpq.read('data\\huff.wav')).toThrow(/unsupported compression 0x10/);
  });
  it('등록된 압축 해제기가 호출되고 해제하면 원래대로 돌아간다 (bzip2 슬롯)', () => {
    const undo = registerDecompressor(COMPRESSION.BZIP2, (_in, size) => new Uint8Array(size).fill(7));
    try {
      expect(mpq.read('data\\huff.wav')).toEqual(new Uint8Array(512).fill(7));
    } finally {
      undo();
    }
    expect(() => mpq.read('data\\huff.wav')).toThrow(MpqError);
  });
  it('IMPLODE 플래그 파일은 PKWARE 해제기로 처리된다 (손상 데이터면 에러)', () => {
    expect(() => mpq.read('data\\imploded.bin')).toThrow(/pkware/);
  });
  it('(listfile) 목록', () => {
    expect(mpq.list()).toEqual(['data\\global\\excel\\monstats.txt', 'data\\single.bin']);
  });
  it("'MPQ\\x1B' 사용자 데이터 헤더를 따라간다", () => {
    const a = MpqArchive.open(buildMpq([{ name: 'a.txt', data: enc('hello') }], { userData: true }));
    expect(dec(a.read('a.txt'))).toBe('hello');
  });
  it('MPQ 가 아니면 에러', () => {
    expect(() => MpqArchive.open(new Uint8Array(64))).toThrow(/header not found/);
  });
});

describe('MpqChain', () => {
  it('앞선 아카이브(패치)를 우선 조회하고 없으면 다음 아카이브', () => {
    const patch = MpqArchive.open(buildMpq([{ name: 'x.txt', data: enc('patched') }]));
    const base = MpqArchive.open(buildMpq([{ name: 'x.txt', data: enc('base') }, { name: 'y.txt', data: enc('only-base') }]));
    const chain = new MpqChain([patch, base]);
    expect(dec(chain.read('x.txt'))).toBe('patched');
    expect(dec(chain.read('y.txt'))).toBe('only-base');
    expect(chain.read('z.txt')).toBeNull();
  });
});

// 실제 원작 MPQ 기반 테스트 — game-data/ 가 있어야 실행된다.
const GD = resolve(__dirname, '../../game-data');
const find = (n: string) => (existsSync(GD) ? readdirSync(GD).find((f) => f.toLowerCase() === n) : undefined);
const hasData = !!find('d2data.mpq') && !!find('patch_d2.mpq');

describe.skipIf(!hasData)('실제 원작 MPQ', () => {
  const open = (n: string) => MpqArchive.open(readFileSync(resolve(GD, find(n) as string)));
  it('patch_d2 > d2data 체인에서 excel monstats.txt 를 읽는다', () => {
    const chain = new MpqChain([open('patch_d2.mpq'), open('d2data.mpq')]);
    const text = dec(chain.read('data\\global\\excel\\monstats.txt'));
    expect(text?.split('\t')[0]).toBe('Id');
  });
});
