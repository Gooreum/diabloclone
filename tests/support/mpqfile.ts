// 큰 원작 MPQ(d2music 348MB 등)를 통째로 메모리에 올리지 않고, 헤더·테이블·필요한 블록만 파일에서 읽는다 (테스트용).
import { closeSync, openSync, readSync } from 'node:fs';
import { decodeBlock, MpqIndex, parseBlockTable, parseHashTable, parseHeader } from '../../src/formats/mpq';

export class MpqFile extends MpqIndex {
  private constructor(private readonly fd: number, index: MpqIndex) {
    super(index.header, index.hashTable, index.blockTable);
  }

  static open(path: string): MpqFile {
    const fd = openSync(path, 'r');
    const at = (pos: number, len: number) => {
      const b = new Uint8Array(len);
      readSync(fd, b, 0, len, pos);
      return b;
    };
    const h = parseHeader(at(0, 4096));
    return new MpqFile(fd, new MpqIndex(h, parseHashTable(at(h.base + h.hashOffset, h.hashCount * 16), h.hashCount), parseBlockTable(at(h.base + h.blockOffset, h.blockCount * 16), h.blockCount)));
  }

  read(path: string): Uint8Array | null {
    const block = this.findBlock(path);
    if (!block) return null;
    const raw = new Uint8Array(block.compressedSize);
    readSync(this.fd, raw, 0, raw.length, this.header.base + block.offset);
    return decodeBlock(raw, block, this.sectorSize, path);
  }

  close(): void {
    closeSync(this.fd);
  }
}
