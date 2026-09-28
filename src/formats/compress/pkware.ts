// PKWARE Data Compression Library "implode" 해제 (MPQ 압축 0x08 / MPQ_FILE_IMPLODE).
// 출처: Mark Adler — zlib contrib/blast/blast.c (https://github.com/madler/zlib/blob/master/contrib/blast/blast.c)
//       코드 길이 테이블(litlen/lenlen/distlen), base/extra 테이블, 반전 비트 허프만 디코딩을 그대로 옮김.

const MAXBITS = 13;

interface Huffman { count: Int16Array; symbol: Int16Array }

function construct(rep: readonly number[], n: number): Huffman {
  const length: number[] = [];
  for (const b of rep) {
    const left = (b >> 4) + 1;
    for (let i = 0; i < left; i++) length.push(b & 15);
  }
  if (length.length !== n) throw new Error(`pkware: bad code table (${length.length} != ${n})`);
  const count = new Int16Array(MAXBITS + 1);
  for (const len of length) count[len] = (count[len] ?? 0) + 1;
  const offs = new Int16Array(MAXBITS + 1);
  for (let len = 1; len < MAXBITS; len++) offs[len + 1] = (offs[len] ?? 0) + (count[len] ?? 0);
  const symbol = new Int16Array(n);
  length.forEach((len, sym) => {
    if (len === 0) return;
    const at = offs[len] ?? 0;
    symbol[at] = sym;
    offs[len] = at + 1;
  });
  return { count, symbol };
}

// 출처: blast.c — litlen[], lenlen[], distlen[], base[], extra[]
const LITLEN = [
  11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12, 11,
  7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12, 8, 12, 5, 38, 5,
  38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61,
  12, 45, 44, 173,
];
const LENLEN = [2, 35, 36, 53, 38, 23];
const DISTLEN = [2, 20, 53, 230, 247, 151, 248];
const BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

const litcode = construct(LITLEN, 256);
const lencode = construct(LENLEN, 16);
const distcode = construct(DISTLEN, 64);

class BitReader {
  private pos = 0;
  private buf = 0;
  private cnt = 0;
  private readonly input: Uint8Array;
  constructor(input: Uint8Array) {
    this.input = input;
  }
  bits(need: number): number {
    while (this.cnt < need) {
      if (this.pos >= this.input.length) throw new Error('pkware: unexpected end of input');
      this.buf |= (this.input[this.pos++] ?? 0) << this.cnt;
      this.cnt += 8;
    }
    const v = this.buf & ((1 << need) - 1);
    this.buf >>>= need;
    this.cnt -= need;
    return v;
  }
  /** 출처: blast.c decode() — 코드 비트는 반전되어 저장된다 (code |= (bitbuf & 1) ^ 1) */
  decode(h: Huffman): number {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= MAXBITS; len++) {
      code |= this.bits(1) ^ 1;
      const count = h.count[len] ?? 0;
      if (code - first < count) return h.symbol[index + (code - first)] ?? 0;
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('pkware: ran out of codes');
  }
}

export function explode(input: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let n = 0;
  const br = new BitReader(input);
  const lit = br.bits(8);
  if (lit > 1) throw new Error('pkware: bad literal flag');
  const dict = br.bits(8);
  if (dict < 4 || dict > 6) throw new Error('pkware: bad dictionary size');
  for (;;) {
    if (br.bits(1)) {
      const sym = br.decode(lencode);
      const len = (BASE[sym] ?? 0) + br.bits(EXTRA[sym] ?? 0);
      if (len === 519) break; // 종료 코드
      const s = len === 2 ? 2 : dict;
      const dist = ((br.decode(distcode) << s) + br.bits(s)) + 1;
      if (dist > n) throw new Error('pkware: distance too far back');
      for (let i = 0; i < len; i++) {
        if (n >= outSize) return out;
        out[n] = out[n - dist] ?? 0;
        n++;
      }
    } else {
      if (n >= outSize) return out;
      out[n++] = lit ? br.decode(litcode) : br.bits(8);
    }
  }
  return n === outSize ? out : out.subarray(0, n);
}
