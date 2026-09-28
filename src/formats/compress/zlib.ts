// MPQ 압축 0x02 (zlib deflate 스트림).
// 출처: StormLib SCompDecompress — Decompress_ZLIB (https://github.com/ladislav-zezula/StormLib)
import { inflate } from 'pako';

export function inflateZlib(input: Uint8Array, outSize: number): Uint8Array {
  const out = inflate(input);
  return out.length > outSize ? out.subarray(0, outSize) : out;
}
