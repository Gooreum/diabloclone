import { describe, expect, it } from 'vitest';
import { hasGameData, mustRead } from '../support/gamedata';
import { glyphAdvance, lineWidth, parseFontTbl, textWidth, wrapText } from '../../src/formats/font';
import { parsePl2Text, TEXT_COLOR } from '../../src/formats/pl2';
import { parseDc6 } from '../../src/formats/dc6';

/** 합성 .tbl: "Woo!" 머리 12바이트 + 글자마다 14바이트 (코드, ?, 너비, 높이, ?×3, 프레임, ?×4) */
function fakeTbl(glyphs: [string, number, number][]): Uint8Array {
  const b = new Uint8Array(12 + glyphs.length * 14);
  b.set([0x57, 0x6f, 0x6f, 0x21, 1, 0, 0, 0, 0, 1, 10, 20]);
  glyphs.forEach(([ch, w, frame], i) => {
    const o = 12 + i * 14, code = ch.charCodeAt(0);
    b[o] = code & 255;
    b[o + 1] = code >> 8;
    b[o + 3] = w;
    b[o + 4] = 16;
    b[o + 8] = frame & 255;
    b[o + 9] = frame >> 8;
  });
  return b;
}

describe('글꼴 표 (합성)', () => {
  const t = parseFontTbl(fakeTbl([['A', 12, 65], ['i', 4, 105], [' ', 5, 32]]));
  it('글자 코드 → 너비·프레임', () => {
    expect(t.glyphs.get(65)).toEqual({ code: 65, width: 12, height: 16, frame: 65 });
    expect(glyphAdvance(t, 'i')).toBe(4);
  });
  it('줄 너비 = 글자 너비 합, 없는 글자는 0', () => {
    expect(lineWidth(t, 'Ai A')).toBe(12 + 4 + 5 + 12);
    expect(lineWidth(t, 'Z')).toBe(0);
    expect(textWidth(t, 'A\nAiA')).toBe(28);
  });
  it('너비 제한 줄바꿈', () => {
    expect(wrapText(t, 'A A A', 30)).toEqual(['A A', 'A']);
  });
  it('시그니처가 다르면 에러', () => expect(() => parseFontTbl(new Uint8Array(12))).toThrow(/Woo/));
});

describe.skipIf(!hasGameData)('원작 글꼴 (data\\local\\font\\latin)', () => {
  const tbl = (n: string) => parseFontTbl(mustRead(`data\\local\\font\\latin\\${n}.tbl`));
  it('font16: 256 글자, A 너비 12, 프레임 번호가 DC6 프레임 수 안', () => {
    const t = tbl('font16');
    expect(t.glyphs.size).toBe(256);
    // 원작 파일 값: 'A' 너비 12 (0x0c), 프레임 = 글자 코드
    expect(t.glyphs.get(65)).toMatchObject({ width: 12, frame: 65 });
    const dc6 = parseDc6(mustRead('data\\local\\font\\latin\\font16.dc6'));
    expect(dc6.frames.length).toBe(256);
    for (const g of t.glyphs.values()) expect(g.frame).toBeLessThan(dc6.frames.length);
  });
  it('글꼴별 대문자 A 너비 (원작 .tbl): font8 8 · font16 12 · font30 22 · font42 30 · fontformal10 8 · fontexocet10 13', () => {
    const a = (n: string) => tbl(n).glyphs.get(65)?.width;
    expect([a('font8'), a('font16'), a('font30'), a('font42'), a('fontformal10'), a('fontexocet10')]).toEqual([8, 12, 22, 30, 8, 13]);
  });
  it('문장 너비 = 표의 글자 너비 합 ("Life: 50 / 50" font16)', () => {
    const t = tbl('font16');
    const sum = [...'Life: 50 / 50'].reduce((s, c) => s + (t.glyphs.get(c.charCodeAt(0))?.width ?? 0), 0);
    expect(lineWidth(t, 'Life: 50 / 50')).toBe(sum);
    expect(sum).toBeGreaterThan(60);
    expect(sum).toBeLessThan(140);
  });
  it('Pal.PL2 글자 색: 13색 (흰·빨강 255,77,77·초록·파랑 105,105,255·금색 199,179,119 …)', () => {
    const pl = parsePl2Text(mustRead('data\\global\\palette\\ACT1\\Pal.PL2'));
    expect(pl.colors.length).toBe(13);
    expect(pl.colors[TEXT_COLOR.white]).toEqual([255, 255, 255]);
    expect(pl.colors[TEXT_COLOR.red]).toEqual([255, 77, 77]);
    expect(pl.colors[TEXT_COLOR.blue]).toEqual([105, 105, 255]);
    expect(pl.colors[TEXT_COLOR.gold]).toEqual([199, 179, 119]);
    expect(pl.colors[TEXT_COLOR.yellow]).toEqual([255, 255, 100]);
    expect(pl.colors[TEXT_COLOR.green]).toEqual([0, 255, 0]);
    // 금색 표는 여러 인덱스로 바꾸고, 흰색 표는 비어 있다(원본 그대로 칠함)
    expect(new Set(pl.shifts[TEXT_COLOR.gold]).size).toBeGreaterThan(10);
    expect(new Set(pl.shifts[TEXT_COLOR.white]).size).toBe(1);
  });
});
