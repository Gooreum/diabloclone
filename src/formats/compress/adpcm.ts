// MPQ 압축 0x40(ADPCM 모노) / 0x80(ADPCM 스테레오) — Storm.dll 의 IMA 변형 ADPCM 해제.
// 출처: StormLib src/adpcm/adpcm.cpp (DecompressADPCM, NextStepTable, StepSizeTable,
//       DecodeSample, UpdatePredictedSample), adpcm.h (INITIAL_ADPCM_STEP_INDEX = 0x2C)
//       https://github.com/ladislav-zezula/StormLib

const NEXT_STEP: readonly number[] = [
  -1, 0, -1, 4, -1, 2, -1, 6,
  -1, 1, -1, 5, -1, 3, -1, 7,
  -1, 1, -1, 5, -1, 3, -1, 7,
  -1, 2, -1, 4, -1, 6, -1, 8,
];

const STEP_SIZE: readonly number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658,
  724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024,
  3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

const INITIAL_STEP_INDEX = 0x2c;

const NEXT_STEP_I = Int8Array.from(NEXT_STEP);
const STEP_SIZE_I = Int32Array.from(STEP_SIZE);

/** 출처: adpcm.cpp DecompressADPCM — 출력은 16비트 LE PCM 바이트열 */
export function decompressAdpcm(input: Uint8Array, outSize: number, channels: 1 | 2): Uint8Array {
  const out = new Uint8Array(outSize);
  const maxSamples = outSize >> 1;
  let n = 0; // 출력한 16비트 샘플 수
  const put = (s: number): void => {
    out[n * 2] = s & 0xff;
    out[n * 2 + 1] = (s >> 8) & 0xff;
    n++;
  };
  // 채널별 예측 샘플·스텝 인덱스
  let p0 = 0, p1 = 0;
  let s0 = INITIAL_STEP_INDEX, s1 = INITIAL_STEP_INDEX;
  // 첫 바이트는 0, 둘째 바이트가 비트 시프트(압축 레벨 - 1)
  if (input.length < 2) return out.subarray(0, 0);
  const shift = input[1]!;
  let ip = 2;
  for (let c = 0; c < channels; c++) {
    if (input.length - ip < 2 || n >= maxSamples) return out.subarray(0, n * 2);
    const s = ((input[ip]! | (input[ip + 1]! << 8)) << 16) >> 16;
    ip += 2;
    if (c === 0) p0 = s;
    else p1 = s;
    put(s);
  }
  let ch = channels - 1;
  const len = input.length;
  while (ip < len) {
    const enc = input[ip++]!;
    ch = channels === 2 ? ch ^ 1 : 0;
    if (enc === 0x80) {
      if (ch === 0) { if (s0 !== 0) s0--; } else if (s1 !== 0) s1--;
      if (n >= maxSamples) break;
      put(ch === 0 ? p0 : p1);
    } else if (enc === 0x81) {
      if (ch === 0) s0 = Math.min(s0 + 8, 0x58);
      else s1 = Math.min(s1 + 8, 0x58);
      // 다음 바이트도 같은 채널
      ch = channels === 2 ? ch ^ 1 : 0;
    } else {
      const si = ch === 0 ? s0 : s1;
      const step = STEP_SIZE_I[si]!;
      // 출처: adpcm.cpp DecodeSample / UpdatePredictedSample
      let diff = step >> shift;
      if (enc & 0x01) diff += step;
      if (enc & 0x02) diff += step >> 1;
      if (enc & 0x04) diff += step >> 2;
      if (enc & 0x08) diff += step >> 3;
      if (enc & 0x10) diff += step >> 4;
      if (enc & 0x20) diff += step >> 5;
      let p = ch === 0 ? p0 : p1;
      if (enc & 0x40) { p -= diff; if (p < -32768) p = -32768; } else { p += diff; if (p > 32767) p = 32767; }
      let ni = si + NEXT_STEP_I[enc & 0x1f]!;
      if (ni < 0) ni = 0; else if (ni > 88) ni = 88;
      if (ch === 0) { p0 = p; s0 = ni; } else { p1 = p; s1 = ni; }
      if (n >= maxSamples) break;
      put(p);
    }
  }
  return out.subarray(0, n * 2);
}

export const decompressAdpcmMono = (input: Uint8Array, outSize: number): Uint8Array => decompressAdpcm(input, outSize, 1);
export const decompressAdpcmStereo = (input: Uint8Array, outSize: number): Uint8Array => decompressAdpcm(input, outSize, 2);
