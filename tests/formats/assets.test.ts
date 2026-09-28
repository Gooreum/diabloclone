import { describe, expect, it } from 'vitest';
import { hasGameData, mustRead } from '../support/gamedata';
import { parsePalette } from '../../src/formats/palette';
import { parseDc6 } from '../../src/formats/dc6';
import { parseDcc } from '../../src/formats/dcc';
import { parseCof } from '../../src/formats/cof';
import { parseTbl } from '../../src/formats/tbl';
import { parseTxt, classicRows } from '../../src/formats/txt';

describe('합성 입력', () => {
  it('팔레트는 BGR → RGBA, 인덱스 0 투명', () => {
    const b = new Uint8Array(768);
    b.set([1, 2, 3], 3); // 인덱스 1 = B1 G2 R3
    const p = parsePalette(b);
    expect(Array.from(p.subarray(4, 8))).toEqual([3, 2, 1, 255]);
    expect(p[3]).toBe(0);
  });
  it('짧은 팔레트는 에러', () => expect(() => parsePalette(new Uint8Array(10))).toThrow(/768/));
  it('손상된 DC6 는 에러', () => {
    const b = new Uint8Array(24);
    new DataView(b.buffer).setInt32(0, 6, true);
    new DataView(b.buffer).setUint32(16, 1, true);
    new DataView(b.buffer).setUint32(20, 1, true);
    expect(() => parseDc6(b)).toThrow(/dc6/);
  });
  it('DCC 시그니처가 아니면 에러', () => expect(() => parseDcc(new Uint8Array(32))).toThrow(/signature/));
  it('txt: 탭 구분 + Expansion 구분 행 이전만 클래식', () => {
    const rows = parseTxt('Name\tLevel\r\nA\t1\r\nExpansion\t\r\nB\t2\r\n');
    expect(rows.map((r) => r.Name)).toEqual(['A', 'Expansion', 'B']);
    expect(classicRows(rows, 'Name').map((r) => r.Name)).toEqual(['A']);
  });
});

describe.skipIf(!hasGameData)('실제 원작 파일', () => {
  it('act1 pal.dat 256색', () => {
    const p = parsePalette(mustRead('data\\global\\palette\\ACT1\\pal.dat'));
    expect(p.length).toBe(1024);
  });
  // 인벤토리 칸 = 28×28 픽셀 (출처: Phrozen Keep — inventory.txt gridBoxWidth/Height = 29 중 테두리 1 제외, inv DC6 크기 = 칸 수 × 28)
  it('양손검 인벤토리 그림 inv2hs.dc6 = 1×4 칸 (28×112)', () => {
    const d = parseDc6(mustRead('data\\global\\items\\inv2hs.DC6'));
    expect(d.frames.length).toBe(1);
    expect([d.frames[0]?.width, d.frames[0]?.height]).toEqual([28, 112]);
    expect(d.frames[0]?.pixels.some((v) => v !== 0)).toBe(true);
  });
  // 출처: Phrozen Keep — COF/DCC 문서 "player animations use 16 directions, most monsters 8"
  it('바바리안 몸통 대기 동작 DCC: 16방향, 방향별 8프레임, 픽셀 존재', () => {
    const dcc = parseDcc(mustRead('data\\global\\CHARS\\BA\\TR\\BATRLITNUHTH.dcc'));
    expect(dcc.directions.length).toBe(16);
    expect(dcc.framesPerDirection).toBe(8);
    for (const d of dcc.directions) {
      for (const f of d.frames) {
        expect(f.pixels.length).toBe(d.box.width * d.box.height);
        expect(f.pixels.some((v) => v !== 0)).toBe(true);
      }
    }
  });
  it('바바리안 대기 COF: 방향 수(16)·프레임 수가 DCC 와 일치, 우선순위 테이블 크기', () => {
    const cof = parseCof(mustRead('data\\global\\CHARS\\BA\\COF\\BANUHTH.COF'));
    expect(cof.directions).toBe(16);
    expect(cof.framesPerDirection).toBe(8);
    expect(cof.layers.map((l) => l.name)).toContain('TR');
    expect(cof.priority.length).toBe(16);
    expect(cof.priority[0]?.[0]?.length).toBe(cof.layers.length);
  });
  it('string.tbl 에 NPC 이름 Akara 가 있다', () => {
    const t = parseTbl(mustRead('data\\local\\lng\\eng\\string.tbl'));
    expect(t.size).toBeGreaterThan(1000);
    expect(t.get('Akara')).toBe('Akara');
  });
  // 출처: charstats.txt — 클래스 행 (클래식 5클래스)
  it('charstats.txt 클래식 5클래스', () => {
    const rows = classicRows(parseTxt(new TextDecoder('latin1').decode(mustRead('data\\global\\excel\\charstats.txt'))), 'class');
    expect(rows.map((r) => r.class)).toEqual(['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian']);
  });
});
