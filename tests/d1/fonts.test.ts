import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONTS_KO_SIZE, FONTS_KO_VERSION, wantsKorean } from '../../src/d1/host';
import { MpqArchive } from '../../src/formats/mpq';

// 디아블로 1 한글 글꼴: DevilutionX fonts.mpq 의 한글 부분만 (scripts/build-d1-fonts.ts)
const KO = 'public/d1x/fonts-ko.mpq';
// 원본 fonts.mpq (있을 때만 내용 비교) — FONTS_SRC=… 또는 game-data/diablo1/fonts.mpq
const SRC = process.env.FONTS_SRC ?? 'game-data/diablo1/fonts.mpq';

describe('fonts-ko.mpq', () => {
  const raw = readFileSync(KO);
  const ko = MpqArchive.open(raw);

  it('크기·해시가 host.ts 상수와 같다 (주소 버전)', () => {
    expect(raw.length).toBe(FONTS_KO_SIZE);
    expect(createHash('sha256').update(raw).digest('hex').slice(0, 12)).toBe(FONTS_KO_VERSION);
  });

  it('버전 표시와 다섯 크기의 한글 음절 블록이 다 있다', () => {
    expect(ko.has('fonts\\VERSION')).toBe(true);
    for (const size of [12, 24, 30, 42, 46]) {
      for (const b of ['ac', 'c7', 'd7']) expect(ko.has(`fonts\\${size}-${b}.clx`), `${size}-${b}`).toBe(true);
    }
    expect(new TextDecoder().decode(ko.read('fonts\\VERSION')!).trim()).toBe('1');
  });

  it('한글이 아닌 블록(한자·가나)은 없다', () => {
    for (const n of ['fonts\\12-4e.clx', 'fonts\\12-30.clx', 'fonts\\24-ab.clx', 'fonts\\24-d8.clx']) expect(ko.has(n), n).toBe(false);
  });

  // 글꼴은 bzip2 로 압축돼 있다 (우리 읽기 코드에 bzip2 가 없어) — 압축된 블록 그대로 비교한다
  const rawBlock = (bytes: Uint8Array, a: MpqArchive, n: string) => {
    const b = a.findBlock(n)!;
    return Buffer.from(bytes.subarray(a.header.base + b.offset, a.header.base + b.offset + b.compressedSize));
  };

  it.skipIf(!existsSync(SRC))('압축된 블록이 원본 fonts.mpq 와 바이트까지 같다', () => {
    const srcRaw = readFileSync(SRC);
    const src = MpqArchive.open(srcRaw);
    for (const n of ['fonts\\VERSION', 'fonts\\12-ac.clx', 'fonts\\30-c7.clx', 'fonts\\46-d7.clx']) {
      expect(rawBlock(raw, ko, n).equals(rawBlock(srcRaw, src, n)), n).toBe(true);
      expect(ko.findBlock(n)!.fileSize).toBe(src.findBlock(n)!.fileSize);
    }
  });
});

describe('wantsKorean', () => {
  it('첫 언어가 한국어일 때만', () => {
    expect(wantsKorean(['ko-KR', 'en-US'])).toBe(true);
    expect(wantsKorean(['ko'])).toBe(true);
    expect(wantsKorean(['en-US', 'ko-KR'])).toBe(false);
    expect(wantsKorean(['kok'])).toBe(false);
    expect(wantsKorean([])).toBe(false);
  });
});
