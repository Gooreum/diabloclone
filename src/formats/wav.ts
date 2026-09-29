// RIFF WAVE 파서 — PCM 8/16비트 + IMA ADPCM(format 0x11) WAV 를 Float32 채널 배열로 변환.
// 출처: Microsoft RIFF WAVE 명세 (fmt/data 청크), IMA ADPCM WAV 블록 구조(Multimedia Standards
//       Update 1992, "IMA Digital Audio Focus and Technical Working Groups" — 블록 헤더: 예측값 int16 + 스텝 인덱스)
// 원작 MPQ 의 WAV 는 MPQ 레벨에서 ADPCM(0x40/0x80) 으로 압축되어 있고, 해제하면 16비트 PCM WAV 가 된다.
// IMA ADPCM WAV 는 D2 MPQ 조사에서 발견되지 않았으나 명세상 지원한다.

export class WavError extends Error {}

export interface WavInfo {
  format: number; // 1 = PCM, 0x11 = IMA ADPCM
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  /** 채널당 샘플(프레임) 수 */
  frames: number;
}

export interface DecodedWav extends WavInfo {
  /** 채널별 [-1, 1] 샘플 */
  data: Float32Array[];
}

interface Chunks { info: WavInfo; dataOff: number; dataLen: number; samplesPerBlock: number }

function readChunks(bytes: Uint8Array): Chunks {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o] ?? 0, bytes[o + 1] ?? 0, bytes[o + 2] ?? 0, bytes[o + 3] ?? 0);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new WavError('not a RIFF WAVE');
  let pos = 12;
  let fmt: Omit<WavInfo, 'frames'> | null = null;
  let samplesPerBlock = 0;
  let dataOff = -1;
  let dataLen = 0;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const len = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: v.getUint16(body, true),
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        blockAlign: v.getUint16(body + 12, true),
        bitsPerSample: v.getUint16(body + 14, true),
      };
      if (fmt.format === 0x11 && len >= 20) samplesPerBlock = v.getUint16(body + 18, true);
    } else if (id === 'data') {
      dataOff = body;
      // 잘린 파일 방어: 실제 남은 바이트로 제한
      dataLen = Math.min(len, bytes.length - body);
      break;
    }
    pos = body + len + (len & 1);
  }
  if (!fmt) throw new WavError('missing fmt chunk');
  if (dataOff < 0) throw new WavError('missing data chunk');
  if (fmt.channels < 1 || fmt.channels > 2) throw new WavError(`unsupported channel count ${fmt.channels}`);
  let frames: number;
  if (fmt.format === 1) {
    if (fmt.bitsPerSample !== 8 && fmt.bitsPerSample !== 16) throw new WavError(`unsupported PCM bits ${fmt.bitsPerSample}`);
    frames = Math.floor(dataLen / ((fmt.bitsPerSample / 8) * fmt.channels));
  } else if (fmt.format === 0x11) {
    if (!samplesPerBlock) samplesPerBlock = ((fmt.blockAlign - 4 * fmt.channels) * 8) / (4 * fmt.channels) + 1;
    const blocks = Math.floor(dataLen / fmt.blockAlign);
    frames = blocks * samplesPerBlock;
  } else throw new WavError(`unsupported WAV format 0x${fmt.format.toString(16)}`);
  return { info: { ...fmt, frames }, dataOff, dataLen, samplesPerBlock };
}

/** 헤더만 읽기 (테스트·검사용) */
export function parseWavInfo(bytes: Uint8Array): WavInfo {
  return readChunks(bytes).info;
}

const IMA_INDEX: readonly number[] = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const IMA_STEP: readonly number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552,
  1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

export function decodeWav(bytes: Uint8Array): DecodedWav {
  const { info, dataOff, dataLen, samplesPerBlock } = readChunks(bytes);
  const { channels, frames } = info;
  const data = Array.from({ length: channels }, () => new Float32Array(frames));
  const v = new DataView(bytes.buffer, bytes.byteOffset + dataOff, dataLen);
  if (info.format === 1 && info.bitsPerSample === 16) {
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++) (data[c] as Float32Array)[f] = v.getInt16((f * channels + c) * 2, true) / 32768;
    }
  } else if (info.format === 1) {
    // 8비트 PCM 은 부호 없는 값 (128 = 0)
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++) (data[c] as Float32Array)[f] = (v.getUint8(f * channels + c) - 128) / 128;
    }
  } else {
    decodeImaAdpcm(v, info, samplesPerBlock, data);
  }
  return { ...info, data };
}

/** IMA ADPCM WAV: 블록마다 채널별 헤더(예측값 int16, 인덱스 u8, 예약 u8) 후 4바이트 단위로 채널 교차 니블 */
function decodeImaAdpcm(v: DataView, info: WavInfo, spb: number, data: Float32Array[]): void {
  const { channels, blockAlign } = info;
  const blocks = Math.floor(v.byteLength / blockAlign);
  for (let b = 0; b < blocks; b++) {
    const base = b * blockAlign;
    const pred: number[] = [];
    const idx: number[] = [];
    for (let c = 0; c < channels; c++) {
      pred[c] = v.getInt16(base + c * 4, true);
      idx[c] = Math.min(Math.max(v.getUint8(base + c * 4 + 2), 0), 88);
      (data[c] as Float32Array)[b * spb] = (pred[c] ?? 0) / 32768;
    }
    let p = base + channels * 4;
    let n = 1;
    while (n < spb && p < base + blockAlign) {
      for (let c = 0; c < channels; c++) {
        for (let k = 0; k < 4; k++) {
          const byte = v.getUint8(p + c * 4 + k);
          for (let h = 0; h < 2; h++) {
            const nib = h === 0 ? byte & 0x0f : byte >> 4;
            const step = IMA_STEP[idx[c] ?? 0] ?? 7;
            let diff = step >> 3;
            if (nib & 1) diff += step >> 2;
            if (nib & 2) diff += step >> 1;
            if (nib & 4) diff += step;
            let s = (pred[c] ?? 0) + (nib & 8 ? -diff : diff);
            s = Math.max(-32768, Math.min(32767, s));
            pred[c] = s;
            idx[c] = Math.max(0, Math.min(88, (idx[c] ?? 0) + (IMA_INDEX[nib] ?? 0)));
            const at = b * spb + n + k * 2 + h;
            if (n + k * 2 + h < spb) (data[c] as Float32Array)[at] = s / 32768;
          }
        }
      }
      p += channels * 4;
      n += 8;
    }
  }
}
