// 원작 스킬 공식 언어 (skills.txt calc1~4, auralencalc, passivecalc, ToHitCalc … 컬럼의 문자열).
// 출처: D2MOO source/Fog/src/Calc.cpp — 정수 연산(나눗셈 0 → 0, C 절삭), 연산자 우선순위 표 aASTOperatorPrecedence:
//   삼항 ?: < 비교(< > <= >= == !=) < 덧셈·뺄셈 < 곱셈·나눗셈 < 거듭제곱 ^ < 단항 -
//   거듭제곱: 지수 <= 0 → 1
// 출처: D2MOO source/D2Common/src/DataTbls/SkillsTbls.cpp DATATBLS_MapSkillsTxtKeywordToNumber — 함수 min, max, rand, skill, miss, stat, sklvl
// 출처: 원작 MPQ data/global/excel/skillcalc.txt — 파라미터 이름(ln12, dm12, par1, lvl, blvl …). 값은 호출자가 제공한다.

export type CalcNode =
  | { k: 'num'; v: number }
  | { k: 'param'; name: string }
  | { k: 'ref'; fn: string; target: string; param: string }
  | { k: 'call'; fn: string; args: CalcNode[] }
  | { k: 'neg'; a: CalcNode }
  | { k: 'bin'; op: string; a: CalcNode; b: CalcNode }
  | { k: 'tern'; c: CalcNode; a: CalcNode; b: CalcNode };

export interface CalcContext {
  /** 현재 스킬의 파라미터 (ln12, par1, lvl, blvl …) */
  param(name: string): number;
  /** skill('Bash'.blvl) 같은 다른 대상 참조 (fn = skill | miss | stat | sklvl) */
  ref(fn: string, target: string, param: string): number;
  /** rand(a, b) */
  rand?(min: number, max: number): number;
}

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'str'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j] as string)) j++;
      out.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j] as string)) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) throw new Error(`calc: unterminated string in ${src}`);
      out.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!='].includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^()<>?:,.'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`calc: unexpected '${c}' in ${src}`);
  }
  return out;
}

const PREC: Record<string, number> = { '<': 1, '>': 1, '<=': 1, '>=': 1, '==': 1, '!=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '^': 4 };

class Parser {
  private i = 0;
  private readonly toks: Tok[];
  private readonly src: string;
  constructor(toks: Tok[], src: string) {
    this.toks = toks;
    this.src = src;
  }

  parse(): CalcNode {
    const n = this.ternary();
    if (this.i !== this.toks.length) throw new Error(`calc: trailing tokens in ${this.src}`);
    return n;
  }
  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private eat(v: string): void {
    const t = this.toks[this.i];
    // 원작 데이터에 닫는 괄호가 빠진 공식이 있다 (Fire Wall EDmgSymPerCalc). 입력 끝의 누락된 ')' 는 닫힌 것으로 본다
    if (!t && v === ')') return;
    if (!t || t.t !== 'op' || t.v !== v) throw new Error(`calc: expected '${v}' in ${this.src}`);
    this.i++;
  }
  private ternary(): CalcNode {
    const c = this.binary(1);
    const t = this.peek();
    if (t?.t === 'op' && t.v === '?') {
      this.i++;
      const a = this.ternary();
      this.eat(':');
      const b = this.ternary();
      return { k: 'tern', c, a, b };
    }
    return c;
  }
  private binary(minPrec: number): CalcNode {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op') return left;
      const p = PREC[t.v];
      if (p === undefined || p < minPrec) return left;
      this.i++;
      // 거듭제곱 포함 모두 왼쪽 결합 (Calc.cpp: 같은 우선순위면 먼저 들어온 연산을 먼저 처리)
      const right = this.binary(p + 1);
      left = { k: 'bin', op: t.v, a: left, b: right };
    }
  }
  private unary(): CalcNode {
    const t = this.peek();
    if (t?.t === 'op' && t.v === '-') {
      this.i++;
      return { k: 'neg', a: this.unary() };
    }
    if (t?.t === 'op' && t.v === '+') {
      this.i++;
      return this.unary();
    }
    return this.primary();
  }
  private primary(): CalcNode {
    const t = this.toks[this.i++];
    if (!t) throw new Error(`calc: unexpected end in ${this.src}`);
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'op' && t.v === '(') {
      const n = this.ternary();
      this.eat(')');
      return n;
    }
    if (t.t === 'id') {
      const nx = this.peek();
      if (nx?.t === 'op' && nx.v === '(') {
        this.i++;
        const fn = t.v.toLowerCase();
        const first = this.peek();
        // skill('Name'.param) · miss('name'.param) · stat('name'.accr)
        if (first?.t === 'str') {
          this.i++;
          this.eat('.');
          const p = this.toks[this.i++];
          if (!p || p.t !== 'id') throw new Error(`calc: expected param after '.' in ${this.src}`);
          this.eat(')');
          return { k: 'ref', fn, target: first.v, param: p.v.toLowerCase() };
        }
        const args: CalcNode[] = [this.ternary()];
        while (this.peek()?.t === 'op' && (this.peek() as Tok).v === ',') {
          this.i++;
          args.push(this.ternary());
        }
        this.eat(')');
        return { k: 'call', fn, args };
      }
      return { k: 'param', name: t.v.toLowerCase() };
    }
    throw new Error(`calc: unexpected token in ${this.src}`);
  }
}

const cache = new Map<string, CalcNode | null>();

/** 공식 문자열 → 구문 트리 (빈 문자열 → null). 원작 파일의 따옴표 감싸기("min(24,ln12)")는 벗긴다 */
export function parseCalc(src: string | undefined): CalcNode | null {
  const s = (src ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
  if (!s) return null;
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  const node = new Parser(tokenize(s), s).parse();
  cache.set(s, node);
  return node;
}

/** C 정수 나눗셈 (0 쪽으로 절삭, 0 으로 나누면 0) */
const idiv = (a: number, b: number): number => (b === 0 ? 0 : Math.trunc(a / b));

export function evalCalc(node: CalcNode | null, ctx: CalcContext): number {
  if (!node) return 0;
  switch (node.k) {
    case 'num':
      return node.v;
    case 'param':
      return Math.trunc(ctx.param(node.name));
    case 'ref':
      return Math.trunc(ctx.ref(node.fn, node.target, node.param));
    case 'neg':
      return -evalCalc(node.a, ctx);
    case 'tern':
      return evalCalc(node.c, ctx) ? evalCalc(node.a, ctx) : evalCalc(node.b, ctx);
    case 'call': {
      const [a = 0, b = 0] = node.args.map((x) => evalCalc(x, ctx));
      if (node.fn === 'min') return Math.min(a, b);
      if (node.fn === 'max') return Math.max(a, b);
      if (node.fn === 'rand') return ctx.rand ? ctx.rand(a, b) : a;
      throw new Error(`calc: unknown function ${node.fn}`);
    }
    case 'bin': {
      const a = evalCalc(node.a, ctx), b = evalCalc(node.b, ctx);
      switch (node.op) {
        case '+': return (a + b) | 0;
        case '-': return (a - b) | 0;
        case '*': return Math.imul(a, b);
        case '/': return idiv(a, b);
        case '^': {
          if (b <= 0) return 1;
          let r = a;
          for (let e = 1; e < b; e++) r = Math.imul(r, a);
          return r;
        }
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
      }
      throw new Error(`calc: unknown operator ${node.op}`);
    }
  }
}
