// 원작 D2 비트맵 글꼴로 글자 그리기 (DC6 글자 그림 + .tbl 너비 + Pal.PL2 글자 색 인덱스 바꾸기).
// 출처: data\local\font\latin\<글꼴>.dc6 / .tbl (src/formats/font.ts), data\global\palette\<act>\Pal.PL2 TextColorShifts (src/formats/pl2.ts)
// 쓰임(원작): font16 = 툴팁·패널·NPC 대사·HUD 글자, font8 = 작은 숫자, font30/font42 = 큰 금색 제목·게임 메뉴, fontexocet10 = 프런트엔드 버튼,
//             fontformal10 = 캐릭터 선택 목록. 흰색(0)은 원본 인덱스 그대로, 검정(6)은 모두 인덱스 0(검정) — PL2 표가 0 으로 채워져 있음(원작 파일 확인)
// 근사(원작 미확인): 한글 등 원작 비트맵 글꼴(latin)에 없는 글자는 브라우저 글꼴로 그린다 — 원작 한국어판 글꼴이 사용자 MPQ 에 없다.
//   크기(CJK_PX)·세로 위치(줄 가운데)·글꼴 이름은 근사
// 근사(원작 미확인): 16진 색 문자열은 PL2 TextColors 13 색 중 가장 가까운 색으로 바꿔 칠한다
import { parseDc6, type Dc6Frame } from '../formats/dc6';
import { parseFontTbl, wrapText, type FontTable } from '../formats/font';
import { parsePl2Text, TEXT_COLOR, type Pl2Text, type TextColorName } from '../formats/pl2';
import type { Palette } from '../formats/palette';
import { indexedToCanvas, type Drawable } from '../render/sprites';
import type { AsyncAssets } from '../render/units';

export const FONT_NAMES = ['font6', 'font8', 'font16', 'font24', 'font30', 'font42', 'fontformal10', 'fontformal12', 'fontexocet10', 'fontexocet8'] as const;
export type FontName = (typeof FONT_NAMES)[number];
/** 'native' = 색 바꾸기 없이 원본 (금색 font30/font42 제목) */
export type TextColor = TextColorName | 'native' | `#${string}`;
export type Align = 'left' | 'center' | 'right';

export interface TextOpts { font?: FontName; color?: TextColor; align?: Align; /** 줄 간격 (기본 = 글꼴 줄 높이) */ lineHeight?: number }

const FONT_DIR = 'data\\local\\font\\latin\\';
export const fontPaths = (n: FontName) => [`${FONT_DIR}${n}.tbl`, `${FONT_DIR}${n}.dc6`];

interface CanvasGlyph { img: Drawable; w: number }
interface LoadedFont { table: FontTable; frames: Dc6Frame[]; lineHeight: number; glyphs: Map<string, Drawable | null>; wide: Map<string, CanvasGlyph | null> }

// 캔버스 대체 글꼴 (원작 글꼴을 못 읽었을 때)
const FALLBACK_PX: Record<FontName, number> = { font6: 9, font8: 11, font16: 13, font24: 20, font30: 24, font42: 32, fontformal10: 12, fontformal12: 14, fontexocet10: 12, fontexocet8: 10 };

// 브라우저 글꼴로 그리는 글자 (한글 등) 크기·글꼴
const CJK_PX: Record<FontName, number> = { font6: 8, font8: 10, font16: 14, font24: 20, font30: 24, font42: 34, fontformal10: 12, fontformal12: 13, fontexocet10: 12, fontexocet8: 10 };
const CJK_FAMILY = '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';

/** 원작 비트맵 글꼴에 없는 글자 (한글 등) → 브라우저 글꼴로 그린다. 0xFF 이하 라틴 글자는 원작처럼 건너뜀 */
export const needsCanvasGlyph = (t: FontTable, code: number): boolean => code > 0xff && !t.glyphs.has(code);

export class D2Text {
  private readonly fonts = new Map<FontName, LoadedFont>();
  private pal: Palette | null = null;
  private pl2: Pl2Text | null = null;
  /** 가장 어두운 불투명 인덱스 (검정 글자용 — 인덱스 0 은 투명 취급) */
  private blackIndex = 1;

  /** 글꼴·글자 색 표 읽기 (없는 파일은 건너뜀 → 캔버스 글자로 대체) */
  async load(assets: AsyncAssets, pal: Palette, pl2Path = 'data\\global\\palette\\ACT1\\Pal.PL2', names: readonly FontName[] = FONT_NAMES): Promise<void> {
    this.pal = pal;
    let best = Infinity;
    for (let i = 1; i < 256; i++) {
      const l = (pal[i * 4] ?? 0) + (pal[i * 4 + 1] ?? 0) + (pal[i * 4 + 2] ?? 0);
      if (l < best) {
        best = l;
        this.blackIndex = i;
      }
    }
    const pl2 = await assets.load(pl2Path);
    if (pl2) this.pl2 = parsePl2Text(pl2);
    await Promise.all(names.map(async (n) => {
      const [tp, dp] = fontPaths(n) as [string, string];
      const [tb, db] = await Promise.all([assets.load(tp), assets.load(dp)]);
      if (!tb || !db) return;
      const table = parseFontTbl(tb);
      const frames = parseDc6(db).frames;
      // 줄 높이 = 대문자·숫자 글자 그림 높이 중 최대 (원작 줄 간격과 같은 값 — font16 16, font30 30 …)
      let lh = 0;
      for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
        const g = table.glyphs.get(ch.charCodeAt(0));
        const f = g ? frames[g.frame] : undefined;
        if (f) lh = Math.max(lh, f.height);
      }
      this.fonts.set(n, { table, frames, lineHeight: lh || FALLBACK_PX[n] + 3, glyphs: new Map(), wide: new Map() });
    }));
  }

  ready(font: FontName = 'font16'): boolean {
    return this.fonts.has(font);
  }

  table(font: FontName): FontTable | null {
    return this.fonts.get(font)?.table ?? null;
  }

  lineHeight(font: FontName = 'font16'): number {
    return this.fonts.get(font)?.lineHeight ?? FALLBACK_PX[font] + 3;
  }

  /** 한 줄 너비 (여러 줄이면 가장 긴 줄) */
  width(text: string, font: FontName = 'font16'): number {
    const f = this.fonts.get(font);
    const lines = text.split('\n');
    if (f) return Math.max(0, ...lines.map((l) => this.measure(f, font, l)));
    return Math.max(0, ...lines.map((l) => Math.ceil(l.length * FALLBACK_PX[font] * 0.55)));
  }

  wrap(text: string, maxWidth: number, font: FontName = 'font16'): string[] {
    const f = this.fonts.get(font);
    return f ? wrapText(f.table, text, maxWidth, (s) => this.measure(f, font, s)) : text.split('\n');
  }

  /** 16진 색 → 원작 13색 중 가장 가까운 번호 */
  colorIndex(color: TextColor): number {
    if (color === 'native') return -1;
    if (!color.startsWith('#')) return TEXT_COLOR[color as TextColorName] ?? 0;
    const v = parseInt(color.slice(1, 7), 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    const table = this.pl2?.colors ?? DEFAULT_COLORS;
    let best = 0, bd = Infinity;
    table.forEach(([cr, cg, cb], i) => {
      const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** 글자 전진 너비: 원작 표 너비, 표에 없는 한글 등은 브라우저 글꼴 너비 */
  private advance(f: LoadedFont, font: FontName, ch: string): number {
    const code = ch.codePointAt(0) ?? 0;
    const g = f.table.glyphs.get(code);
    if (g) return g.width;
    return needsCanvasGlyph(f.table, code) ? (this.canvasGlyph(f, font, code, 0)?.w ?? 0) : 0;
  }

  private measure(f: LoadedFont, font: FontName, line: string): number {
    let w = 0;
    for (const ch of line) w += this.advance(f, font, ch);
    return w;
  }

  private rgb(color: number): string {
    if (color < 0) return '#c7b377';
    // 검정 글자: 비트맵 글자처럼 가장 어두운 색 (PL2 표의 검정 칸은 색 바꾸기 표라 색 값이 아니다)
    if (color === TEXT_COLOR.black) return '#000';
    const [r, g, b] = this.pl2?.colors[color] ?? DEFAULT_COLORS[color] ?? [255, 255, 255];
    return `rgb(${r},${g},${b})`;
  }

  /** 브라우저 글꼴 글자 한 개를 작은 캔버스에 (색마다 캐시). document 가 없으면 (테스트) null */
  private canvasGlyph(f: LoadedFont, font: FontName, code: number, color: number): CanvasGlyph | null {
    const key = `${color}:${code}`;
    const hit = f.wide.get(key);
    if (hit !== undefined) return hit;
    let out: CanvasGlyph | null = null;
    const c = typeof document === 'undefined' ? null : document.createElement('canvas');
    const g = c?.getContext('2d');
    if (c && g) {
      const css = `${CJK_PX[font]}px ${CJK_FAMILY}`, ch = String.fromCodePoint(code);
      g.font = css;
      const w = Math.ceil(g.measureText(ch).width);
      c.width = w + 1;
      c.height = f.lineHeight;
      g.font = css;
      g.textBaseline = 'middle';
      g.fillStyle = this.rgb(color);
      g.fillText(ch, 0, Math.round(f.lineHeight / 2));
      out = { img: c, w };
    }
    f.wide.set(key, out);
    return out;
  }

  private glyph(f: LoadedFont, code: number, color: number): Drawable | null {
    const key = `${color}:${code}`;
    const hit = f.glyphs.get(key);
    if (hit !== undefined) return hit;
    const g = f.table.glyphs.get(code);
    const fr = g ? f.frames[g.frame] : undefined;
    let img: Drawable | null = null;
    if (fr && fr.width > 0 && fr.height > 0 && this.pal) {
      let px = fr.pixels;
      const shift = color > 0 ? this.pl2?.shifts[color] : undefined;
      if (shift) {
        // 원작: 투명(0) 은 그대로, 나머지는 색 표로 바꾼 인덱스. 검정 표(모두 0)는 인덱스 0 = 검정으로 칠한다
        px = new Uint8Array(fr.pixels.length);
        const black = color === TEXT_COLOR.black;
        for (let i = 0; i < px.length; i++) {
          const v = fr.pixels[i] ?? 0;
          if (v) px[i] = black ? this.blackIndex : (shift[v] ?? v) || v;
        }
      }
      img = indexedToCanvas(px, fr.width, fr.height, this.pal);
    }
    f.glyphs.set(key, img);
    return img;
  }

  /** 글자 그리기. y = 첫 줄 위쪽 */
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: TextOpts = {}): void {
    const font = opts.font ?? 'font16', align = opts.align ?? 'left';
    const f = this.fonts.get(font);
    const lines = text.split('\n');
    const lh = opts.lineHeight ?? this.lineHeight(font);
    if (!f) {
      ctx.save();
      ctx.font = `${FALLBACK_PX[font]}px serif`;
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      ctx.fillStyle = cssColor(opts.color ?? 'white');
      lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
      ctx.restore();
      return;
    }
    const color = this.colorIndex(opts.color ?? (font === 'font30' || font === 'font42' ? 'native' : 'white'));
    lines.forEach((line, i) => {
      const w = this.measure(f, font, line);
      let cx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
      const cy = Math.round(y + i * lh);
      for (const ch of line) {
        const code = ch.codePointAt(0) ?? 0;
        const g = f.table.glyphs.get(code);
        if (!g) {
          const c = needsCanvasGlyph(f.table, code) ? this.canvasGlyph(f, font, code, color) : null;
          if (c) {
            ctx.drawImage(c.img as CanvasImageSource, cx, cy);
            cx += c.w;
          }
          continue;
        }
        const img = this.glyph(f, code, color);
        if (img) ctx.drawImage(img as CanvasImageSource, cx, cy);
        cx += g.width;
      }
    });
  }
}

const DEFAULT_COLORS: [number, number, number][] = [
  [255, 255, 255], [255, 77, 77], [0, 255, 0], [105, 105, 255], [199, 179, 119], [105, 105, 105], [0, 0, 0], [208, 194, 125], [255, 168, 0], [255, 255, 100], [0, 128, 0], [174, 0, 255], [0, 200, 0],
];

function cssColor(c: TextColor): string {
  if (c.startsWith('#')) return c;
  if (c === 'native') return '#c7b377';
  const [r, g, b] = DEFAULT_COLORS[TEXT_COLOR[c as TextColorName] ?? 0] ?? [255, 255, 255];
  return `rgb(${r},${g},${b})`;
}

/** 게임 전체가 쓰는 글꼴 묶음 (부팅 때 load) */
export const d2text = new D2Text();

/** 줄임: 원작 글꼴로 글자 그리기 */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: TextOpts = {}): void {
  d2text.draw(ctx, text, x, y, opts);
}
