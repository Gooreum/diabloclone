// D2 비트맵 글꼴 표 (data\local\font\latin\<글꼴>.tbl) — 글자 코드 → 너비·높이·DC6 프레임.
// 출처: 원작 파일 직접 확인 — 머리 12바이트 "Woo!" 01 00 00 00 00 01 <b10> <b11>, 이어서 글자마다 14바이트:
//       [0..1] 글자 코드 u16, [2] ?, [3] 너비(다음 글자까지 전진량), [4] 높이, [5] ?, [6..7] ?, [8..9] DC6 프레임 번호 u16, [10..13] ?
// 출처: OpenDiablo2 d2ui/font.go initGlyphs (같은 14바이트 배치: code, skip1, width, height, skip3, frame u16, skip4)

export interface FontGlyph { code: number; width: number; height: number; frame: number }
export interface FontTable {
  glyphs: Map<number, FontGlyph>;
  /** 머리 바이트 10·11 (의미 원작 미확인 — 참고용) */
  header: [number, number];
}

const HEADER = 12, ENTRY = 14;

export function parseFontTbl(buf: Uint8Array): FontTable {
  if (buf.length < HEADER || buf[0] !== 0x57 || buf[1] !== 0x6f || buf[2] !== 0x6f || buf[3] !== 0x21) throw new Error('font tbl: bad signature (Woo!)');
  const glyphs = new Map<number, FontGlyph>();
  for (let o = HEADER; o + ENTRY <= buf.length; o += ENTRY) {
    const code = (buf[o] ?? 0) | ((buf[o + 1] ?? 0) << 8);
    glyphs.set(code, { code, width: buf[o + 3] ?? 0, height: buf[o + 4] ?? 0, frame: (buf[o + 8] ?? 0) | ((buf[o + 9] ?? 0) << 8) });
  }
  return { glyphs, header: [buf[10] ?? 0, buf[11] ?? 0] };
}

/** 글자의 전진 너비 (표에 없는 글자는 0) */
export function glyphAdvance(t: FontTable, ch: string): number {
  return t.glyphs.get(ch.charCodeAt(0))?.width ?? 0;
}

/** 한 줄 너비 (픽셀) — 원작처럼 글자 너비 합 */
export function lineWidth(t: FontTable, text: string): number {
  let w = 0;
  for (const ch of text) w += glyphAdvance(t, ch);
  return w;
}

/** 여러 줄('\n') 중 가장 긴 줄 너비 */
export function textWidth(t: FontTable, text: string): number {
  return Math.max(0, ...text.split('\n').map((l) => lineWidth(t, l)));
}

/**
 * 너비 제한 줄바꿈 (공백 기준). width = 줄 너비 함수 (한글처럼 표에 없는 글자를 재려면 넘긴다). 원작 NPC 대사는 string.tbl 에 줄바꿈이 들어 있어 보통 필요 없다 — 툴팁·설명용.
 */
export function wrapText(t: FontTable, text: string, maxWidth: number, width: (s: string) => number = (s) => lineWidth(t, s)): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}
