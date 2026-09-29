// MPQ 압축 0x01 — 적응형(FGK) 허프만 해제. 사운드 MPQ(d2sfx/d2music/d2speech)의 WAV 섹터가 ADPCM 과 함께 사용.
// 출처: StormLib src/huffman/huff.cpp (THuffmannTree::BuildTree / IncWeightsAndRebalance /
//       InsertNewBranchAndRebalance / DecodeOneByte / Decompress), huff.h (HUFF_ITEM_COUNT=515)
//       https://github.com/ladislav-zezula/StormLib
// 원본의 QuickLinks(7비트 조회 캐시)는 속도 최적화일 뿐 결과에 영향이 없어 생략하고 매번 트리를 따라 내려간다.

// 출처: huff.cpp DataDistributions[0x09] — 데이터 종류별 바이트 가중치 (256바이트씩, 16진 문자열로 압축 표기)
const DISTRIBUTIONS_HEX: readonly string[] = [
  // DATA_TYPE_SPARSE
  '0a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002',
  // DATA_TYPE_BINARY
  '5416160d0c08060506050603040403050e0b141313090b0605040302030202020d070906060403020403030303030202090604040404030203020202020302040803040709050303030302020203020203020202020202020201010102010202060a0808060704030404020204020303040307070906040303020102020202020a0202030202010102020206030502030201010101010101010101020301010102010101010101020404040709080c02010101010101010101010101020101030401020405010101010101010201010104010101010102010101010101010101020101010101010103010101010101010201010101010102020101020202064b',
  // DATA_TYPE_TEXT
  '0000000000000000000327000023000000000000000000000000000000000000ff0101010101010102020101060e10040608050404030302020303010102010101040204020202010104010102030302030103060401010101010102010201010129071612400a0a112501031710262a100123232f10060702090101010101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  // DATA_TYPE_GENERAL
  'ff0b07050b020202060202010402010309010101030401010201010102010101050101010d0101010101010101010101020101030101010101010102010101010a0402010603020101010101030101010502030403030302010101020102030301030101020501010403050103010303020104030a06010101010101010101010202010a0205010102070217010501010e010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010106020104050101020101010102010101010101010101010101010101010101010101010101010101070101020101010102010101010101010201010101010111',
  // DATA_TYPE_ADPCM_4
  'fffb989a848563643e3e222213131817000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  // DATA_TYPE_ADPCM_6
  'fff19d9e9a9b9a9793938c8e868880827c7c7273696b5f6055564a4b404137372f2f272721211b1c1717131310100d0d0b0b0909080807070605050404041918000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  // DATA_TYPE_STEREO_3
  'c3cbf541ff7bf7210000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000bfccf240fd7cf72200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007a46000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  // DATA_TYPE_STEREO_4
  'c3d9ef3df97ce91efdabf12cfc5bfe17000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000bdd9ec3df57de81dfbaef02cfb5cff18000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000706c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  // DATA_TYPE_STEREO_5
  'bac5da33e36dd818e594da23df4ad110eeafe42cea5ade15f487e921f643fc120000000000000000000000000000000000000000000000000000000000000000b0c7d833e36bd618e795d823db49d011e9b2e22be85cdd15f187e720f744ff1300000000000000000000000000000000000000000000000000000000000000005f9e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',];

const DISTRIBUTIONS: Uint8Array[] = DISTRIBUTIONS_HEX.map((h) => {
  const a = new Uint8Array(256);
  for (let i = 0; i < 256; i++) a[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return a;
});

const HUFF_ITEM_COUNT = 515;
const DATA_TYPE_SPARSE = 0;
const NONE = -1;
const HEAD = HUFF_ITEM_COUNT; // ListHead 센티널 (pNext = 가장 무거운 항목, pPrev = 가장 가벼운 항목)
const INSERT_AFTER = 1;
const INSERT_BEFORE = 2;

class HuffmanError extends Error {}

/** 출처: huff.cpp TInputStream — LSB 우선 비트 스트림 */
class BitReader {
  private pos = 0;
  private buf = 0;
  private count = 0;
  constructor(private readonly data: Uint8Array) {}

  get1(): number {
    if (this.count === 0) {
      if (this.pos >= this.data.length) throw new HuffmanError('huffman: input overrun');
      this.buf = this.data[this.pos++]!;
      this.count = 8;
    }
    const v = this.buf & 1;
    this.buf >>>= 1;
    this.count--;
    return v;
  }

  get8(): number {
    if (this.count < 8) {
      if (this.pos >= this.data.length) throw new HuffmanError('huffman: input overrun');
      this.buf |= this.data[this.pos++]! << this.count;
      this.count += 8;
    }
    const v = this.buf & 0xff;
    this.buf >>>= 8;
    this.count -= 8;
    return v;
  }
}

/** 출처: huff.cpp THuffmannTree — 포인터 대신 인덱스 배열로 표현 */
class HuffmanTree {
  private readonly next = new Int32Array(HUFF_ITEM_COUNT + 1).fill(NONE);
  private readonly prev = new Int32Array(HUFF_ITEM_COUNT + 1).fill(NONE);
  private readonly parent = new Int32Array(HUFF_ITEM_COUNT + 1).fill(NONE);
  private readonly childLo = new Int32Array(HUFF_ITEM_COUNT + 1).fill(NONE);
  private readonly weight = new Uint32Array(HUFF_ITEM_COUNT + 1);
  private readonly value = new Uint32Array(HUFF_ITEM_COUNT + 1);
  readonly byByte = new Int32Array(0x102).fill(NONE);
  private used = 0;

  constructor() {
    this.next[HEAD] = HEAD;
    this.prev[HEAD] = HEAD;
  }

  /** 초기 트리는 데이터 종류별로 항상 같으므로 복제해 재사용 (섹터마다 BuildTree 반복 비용 제거) */
  copyFrom(o: HuffmanTree): void {
    this.next.set(o.next);
    this.prev.set(o.prev);
    this.parent.set(o.parent);
    this.childLo.set(o.childLo);
    this.weight.set(o.weight);
    this.value.set(o.value);
    this.byByte.set(o.byByte);
    this.used = o.used;
  }

  private removeItem(i: number): void {
    const n = this.next[i]!;
    if (n !== NONE) {
      const p = this.prev[i]!;
      this.next[p] = n;
      this.prev[n] = p;
      this.next[i] = NONE;
      this.prev[i] = NONE;
    }
  }

  /** LinkTwoItems: item2 를 item1 바로 뒤(가벼운 쪽)에 연결 */
  private link(i1: number, i2: number): void {
    const n1 = this.next[i1]!;
    this.next[i2] = n1;
    this.prev[i2] = this.prev[n1]!;
    this.prev[n1] = i2;
    this.next[i1] = i2;
  }

  private insert(item: number, where: number): void {
    this.removeItem(item);
    if (where === INSERT_AFTER) this.link(HEAD, item);
    else this.link(this.prev[HEAD]!, item);
  }

  private findHigherOrEqual(item: number, w: number): number {
    if (item !== NONE) {
      while (item !== HEAD) {
        if (this.weight[item]! >= w) return item;
        item = this.prev[item]!;
      }
    }
    return HEAD;
  }

  private createItem(value: number, w: number, where: number): number {
    if (this.used >= HUFF_ITEM_COUNT) throw new HuffmanError('huffman: item pool exhausted');
    const i = this.used++;
    this.insert(i, where);
    this.value[i] = value;
    this.weight[i] = w;
    this.parent[i] = NONE;
    this.childLo[i] = NONE;
    return i;
  }

  private fixupPos(item: number, maxWeight: number): number {
    const w = this.weight[item]!;
    if (w < maxWeight) {
      const higher = this.findHigherOrEqual(this.prev[HEAD]!, w);
      this.removeItem(item);
      this.link(higher, item);
      return maxWeight;
    }
    return w;
  }

  build(dataType: number): void {
    const table = DISTRIBUTIONS[dataType & 0x0f];
    if (!table) throw new HuffmanError(`huffman: bad data type ${dataType}`);
    let maxWeight = 0;
    for (let i = 0; i < 0x100; i++) {
      const w = table[i] ?? 0;
      if (w !== 0) {
        const item = this.createItem(i, w, INSERT_AFTER);
        this.byByte[i] = item;
        maxWeight = this.fixupPos(item, maxWeight);
      }
    }
    this.byByte[0x100] = this.createItem(0x100, 1, INSERT_BEFORE);
    this.byByte[0x101] = this.createItem(0x101, 1, INSERT_BEFORE);

    let lo = this.prev[HEAD]!;
    while (lo !== HEAD) {
      const hi = this.prev[lo]!;
      if (hi === HEAD) break;
      const p = this.createItem(0, this.weight[hi]! + this.weight[lo]!, INSERT_AFTER);
      this.parent[lo] = p;
      this.parent[hi] = p;
      this.childLo[p] = lo;
      maxWeight = this.fixupPos(p, maxWeight);
      lo = this.prev[hi]!;
    }
  }

  incWeights(item: number): void {
    for (; item !== NONE; item = this.parent[item]!) {
      this.weight[item] = this.weight[item]! + 1;
      const higher = this.findHigherOrEqual(this.prev[item]!, this.weight[item]!);
      const hi = this.next[higher]!;
      if (hi !== item) {
        this.removeItem(hi);
        this.link(item, hi);
        this.removeItem(item);
        this.link(higher, item);
        const hiParent = this.parent[hi]!;
        const lo = this.childLo[hiParent]!;
        let p = this.parent[item]!;
        if (this.childLo[p] === item) this.childLo[p] = hi;
        if (lo === hi) this.childLo[hiParent] = item;
        p = this.parent[item]!;
        this.parent[item] = this.parent[hi]!;
        this.parent[hi] = p;
      }
    }
  }

  insertNewBranch(value1: number, value2: number): void {
    const last = this.prev[HEAD]!;
    const hi = this.createItem(value1, this.weight[last]!, INSERT_BEFORE);
    this.parent[hi] = last;
    this.byByte[value1] = hi;
    const lo = this.createItem(value2, 0, INSERT_BEFORE);
    this.parent[lo] = last;
    this.childLo[last] = lo;
    this.byByte[value2] = lo;
    this.incWeights(lo);
  }

  lastValue(): number {
    return this.value[this.prev[HEAD]!] ?? 0;
  }

  decodeOne(bits: BitReader): number {
    let item = this.next[HEAD]!;
    if (item === HEAD) throw new HuffmanError('huffman: empty tree');
    while (this.childLo[item]! !== NONE) {
      const lo = this.childLo[item]!;
      item = bits.get1() ? this.prev[lo]! : lo;
    }
    return this.value[item]!;
  }
}

const templates = new Map<number, HuffmanTree>();

/** 출처: huff.cpp THuffmannTree::Decompress — 첫 8비트 = 데이터 종류, 0x100 = 끝, 0x101 = 새 바이트(NYT) */
export function decompressHuffman(input: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  if (outSize === 0) return out;
  const bits = new BitReader(input);
  const dataType = bits.get8();
  const sparse = dataType === DATA_TYPE_SPARSE;
  let template = templates.get(dataType);
  if (!template) {
    template = new HuffmanTree();
    template.build(dataType);
    templates.set(dataType, template);
  }
  const tree = new HuffmanTree();
  tree.copyFrom(template);
  let n = 0;
  for (;;) {
    let v = tree.decodeOne(bits);
    if (v === 0x100) break;
    if (v === 0x101) {
      v = bits.get8();
      tree.insertNewBranch(tree.lastValue(), v);
      if (!sparse) tree.incWeights(tree.byByte[v] ?? NONE);
    }
    if (n >= outSize) break;
    out[n++] = v;
    if (sparse) tree.incWeights(tree.byByte[v] ?? NONE);
  }
  return out.subarray(0, n);
}
