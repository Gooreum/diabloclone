// 브라우저용 MPQ: HTTP Range 요청으로 필요한 부분만 읽는다 (원작 MPQ 전체를 메모리에 올리지 않음).
import { decodeBlock, MpqIndex, parseBlockTable, parseHashTable, parseHeader } from '../formats/mpq';

export type RangeFetcher = (url: string, start: number, length: number) => Promise<Uint8Array>;

export const httpRange: RangeFetcher = async (url, start, length) => {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`range fetch failed ${res.status}: ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return res.status === 200 ? buf.subarray(start, start + length) : buf;
};

export class MpqRemote extends MpqIndex {
  readonly url: string;
  private readonly fetchRange: RangeFetcher;

  private constructor(url: string, fetchRange: RangeFetcher, index: MpqIndex) {
    super(index.header, index.hashTable, index.blockTable);
    this.url = url;
    this.fetchRange = fetchRange;
  }

  static async open(url: string, fetchRange: RangeFetcher = httpRange): Promise<MpqRemote> {
    const head = await fetchRange(url, 0, 4096);
    const h = parseHeader(head);
    const [ht, bt] = await Promise.all([
      fetchRange(url, h.base + h.hashOffset, h.hashCount * 16),
      fetchRange(url, h.base + h.blockOffset, h.blockCount * 16),
    ]);
    return new MpqRemote(url, fetchRange, new MpqIndex(h, parseHashTable(ht, h.hashCount), parseBlockTable(bt, h.blockCount)));
  }

  async read(path: string): Promise<Uint8Array | null> {
    const block = this.findBlock(path);
    if (!block) return null;
    const raw = await this.fetchRange(this.url, this.header.base + block.offset, block.compressedSize);
    return decodeBlock(raw, block, this.sectorSize, path);
  }
}
