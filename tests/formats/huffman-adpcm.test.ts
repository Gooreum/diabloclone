import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decompressHuffman } from '../../src/formats/compress/huffman';
import { decompressAdpcm } from '../../src/formats/compress/adpcm';
import { decodeWav, parseWavInfo } from '../../src/formats/wav';
import { MpqFile } from '../support/mpqfile';

// 합성 기준값: StormLib(huff.cpp / adpcm.cpp) 을 그대로 컴파일해 만든 압축 스트림과 StormLib 해제 결과.
// (사인파+잡음 16비트 PCM 300 샘플 → CompressADPCM(level 4) → THuffmannTree::Compress(type 4 모노 / 7 스테레오))
const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const MONO = {
  huff: hex(
    '04d3bbf4bb0e2c1bbe15450cef3390aff02d7c67c4fae69baf899ebefb2ca8d6dee2216bd60364b28512244ad444c9259f7c32493b4a8ba952a4c5b4' +
    'd24a2b451a9f56daa9962a55eaa6e6a74cc174d24feb53351d32159a5e532d655331fd4fdfd3813f3ffdb4942ad21ad2dfa7fab4d2f1a545a448c1f4' +
    'd241dae9a44c3bfdf453a5627aa9d24f6be9a74cfbd34e95ce52a59d56fa69a59d3653a495ea97220d4f2b25523495a74a6b4ae5e997e9a4df7a5a29' +
    '4b3e972aa57f3aa9dcd7a5d3a556ea31ed311da69356fa29532f9db4d24f23fdf4d34fe169a54e2bfdb4d34a2bedb4d24e913e53a49f328d4fcbd34a' +
    'ed69a5bf4fede9a7bfa544da9ebea7dd2d65d349a769bdd24f9f8fb4c14febbbb4fbe934553a48afe9a4e7e9a79d2aad3401',
  ),
  adpcm: hex(
    '000304fd8101020106450606000504408106400646020140404404028141014004434080024241444401444340408047420244414202424242414704' +
    '424644004444450145020481410280404204440180020244050143014400810144024004400680050604020440420344074200054000044404428006' +
    '004202054141024380054680814640404444024344404200408146044644800044464240424646024142440400414706428105410144064442000344' +
    '064001028040010106428101020204020044810604804406060001008001004503450002460002800280424081450080424047404040410642454240' +
    '464242464246414002414081470442064245064240000445064040000081054606400646010000810180800142040340400204054605020442040100' +
    '4601048001448005430180430640464442',
  ),
  pcm: hex(
    '04fdac0142047d08c60b1207b10afa0d670ead121514a8137c19ba188b1d2a19021caa202620ae1f661e901f5421211b5421a42084221e1b491a491a' +
    'ba1d991a7a15c613391274160c157d0fdd0e4c0e4c0e40071603e006d0042eff0dfce5fe4ffcf6f9d3f754f480ee90f06fed74e9e7e75fe817e7ede5' +
    '0ae2e3e52fe1c5e32de5eddc82e182e1c0e04fdd2fdf7bdd23e223e27ce49fe675e558e931eda2e744ed64ebf5ebf1f59df2a8f7bef63df97bf84cfd' +
    '4cfd8e035f083f0a170da40e2c0e090c1611620f251790126513bb1bd11aa61bec1ddc1bbc1de41ae41a2d1e9a1ea91c6d1ef521761ef71ae81c5018' +
    '50187b1d8019801971128711b2106c0e5c0c7d0f17089805d604650105027401b0f9b6fc4cf6cdf3cdf37df49df2a2ee0cec94eb71e9b9e640e4dbe5' +
    '3be3c6e1fae0b2e1eae11fe022dd9bdf00dee2e410dee2e49ce26de78de5b5e239e355e945e7a6eb15ebbdef53f253f2e6f165f5e4f89cfbd8f90b00' +
    '7c039d065108e70a5f0b170aeb0f3112311251104c14eb1763183c1ca91ca91cd71f3120a91cb621741b241c451f4a1bce1b271e271e182018207d1e' +
    '331ef117a118a118c9154515390e640da20cf20b5006b10ad907280207ff76fed7fa7ef85bf6a3f3dff1a0ef00edb6ec0aeedfeba2eb96e415e74be3' +
    '1ce8fbe4b9de8ae369e0d8df5ce0c4e110ddafe037e0cadf2de087e01ae846e294e7e4e645eb4ae7f2eb76eceeec2ef52ef52ef500fc36f846fa6902' +
    '7f01aa0074048406660d1808ab0fd5131b16aa128a14a9193a1a9b16d61a3e1c3e1cbd1f931e931e1b220e1d2d222d22731bc1201120b01bfc196617',
  ),
};
const STEREO = {
  huff: hex(
    '07f90ba5f4771aed5b7ecbf2ff739a00ad9f798f94e7e7d5fde95f1e655d90dc781352fd1394b51ba0fe3dbc5d21a591531a2fd5d9355eaa6bb4b75f' +
    '4ee53f7a48dfb661ef39bf656bb073bf61e737dbd82eb935a64b2f7fdefa00a472ac04ebbbfa35dfdf351fa4f6a0427a23bdfa067c5c85975c5bd3ad' +
    'dcfa096583b4ff6fdffeb627c0fcf3db7bf76dec355c2a471be3edb7d718e5c8237fd2fbeb9ff7a7adbdda986bf7f30d97e095e3d377e5f52a8c7efc' +
    'ab4ffbe59dbbbfb9cdf76db0e717e09fe9415b7d82059f5953eaaad3d5d5e9',
  ),
  adpcm: hex(
    '000304fd6803810381810505004006040401800600024640000643444102438044004681414204404546440604404105400481410704044105800444' +
    '024104404046004040464440410647464440414246014402440040810546800440030102040202060603810101040200800204020044060146024540' +
    '454246064540440043444243040440814642400442034280420644054706440440014404410440444640444144460443454104444045014206454200' +
    '018006048101044002050380010501020604040605004402020280014602424645408146014646440244024246468146004600434044054105000243' +
    '014202420146064202800644464540044481464380470042444104468046054280400244000200070300010644030104020603040405064044040142' +
    '80400442044306414040474106454142',
  ),
  pcm: hex(
    '04fd6803be039c0f140cf3102a0b7c19a90dd01c7b14d01cc919ba1d3a1de6179a1ca8189520b40f081fa006612183f9612115f5c421b1ebf21a98e5' +
    '381d7ce4a5156ddd2613d7e36c1502e3390f58eb890e17ee750296fa7b0604ff80fbc70d80fba5122cf8071a18ef0d1e16eed51cace7f11dd7e6ef1c' +
    '89e1301ad9e0b0123ae531063fe1c301bbe0aff562de4bec3be2a3e85ee44fe5c1e44de417ede3dd17ed62e042ec3cea14f3c8ef5af5d3f4cbf83dfb' +
    '2cfd120627080d11cf0b2617eb0c2617f6112c1a8b16161b0c14ea20de1a9c1ba81e0914f81ddf0ad71ad003d21ebbf94e1e67f6c61e4ae97e1de8e1' +
    '7118eee5251ab6e461122adf5f1130e2ca0c1beea0081beed604a4f6c602d80263f93c0c0ff6e40f0df5e0194ef2341dceea3a20f9e97b1dabe4a61c' +
    '9be2d415bbe086106fe29207bedc7efe9ede78fb0dde63f1b5e2d7eb54e6bfe0fbe3f7e1d4e7f7e1d2eafde452f2bce77df1e6ebd3f9c0f5d3f9bcff' +
    'fd02b80908087c11c70a82149b10971e5d11431bce144e20ef174e200e1d7a1ae61fb016471c1d0fcf1b9b02a81f3ef7aa1cd0f29b1ecaee5f20b1e8' +
    '201eede0bf19efe1c415d9e20a0f04e2c40c5aea91066ff44107fbf91eff0f0389fa1a085ff65a1011f1c416a0edee1aa0ed3c20eceb6b1b3be6cb1a' +
    '1be8171992df5d1292dfff0694e04a00d5dd4ff554e0c6ec54e002e5e7e7f7dfe7e70ddfb1eb8edc61ec58e001edacea67f4e4ebe7fba8f368f9c500' +
    '3a0033050404970ef80c3f12fe0f731e68161c1de913c420bb1a381bbb1a361acb1ca115ab1ecc0aa622d1ff222299fe161b9df4ea2069e8181ab4e1',
  ),
};
const TEXT = 'Diablo II sound: the quick brown fox jumps over the lazy dog. aaaaaaaaaabbbbbbbbbbcccc';
const HUFF_SPARSE = hex(
  '0020f2340af3628badbf25903f494ccd05af436e3fd9a5633b5d8756974d1637763ce6ad61da72acdd79f06642e1e1af965f6d67b813b5b33b91e89b' +
    '44f7b5de284f6ff5cf5a2e92e5ffc83b80f0f72c76effad98d1a',
);
const HUFF_TEXT = hex(
  '02c5d665c16f5090f3877ba41287b4f4708187b2daa76f5fbfbca5843c37fd846ce290c25b5addf13f2befbdf7de7bef65b1582c168bc562b10000a0' +
    '5c',
);

describe('Huffman (MPQ 0x01) — StormLib 기준값', () => {
  it('ADPCM 4비트 표(type 4) 모노 스트림', () => {
    expect(decompressHuffman(MONO.huff, 2000)).toEqual(MONO.adpcm);
  });
  it('스테레오 4비트 표(type 7) 스트림', () => {
    expect(decompressHuffman(STEREO.huff, 2000)).toEqual(STEREO.adpcm);
  });
  it('희소(type 0 — 매 바이트 가중치 증가) 와 텍스트(type 2) 표', () => {
    const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
    expect(dec(decompressHuffman(HUFF_SPARSE, 400))).toBe(TEXT);
    expect(dec(decompressHuffman(HUFF_TEXT, 400))).toBe(TEXT);
  });
  it('출력 크기에서 멈춘다 / 입력이 모자라면 에러', () => {
    expect(decompressHuffman(MONO.huff, 10)).toEqual(MONO.adpcm.subarray(0, 10));
    expect(() => decompressHuffman(MONO.huff.subarray(0, 20), 2000)).toThrow(/overrun/);
  });
});

describe('IMA ADPCM (MPQ 0x40/0x80) — StormLib 기준값', () => {
  it('모노', () => {
    expect(decompressAdpcm(MONO.adpcm, 600, 1)).toEqual(MONO.pcm);
  });
  it('스테레오 (채널 교차)', () => {
    expect(decompressAdpcm(STEREO.adpcm, 600, 2)).toEqual(STEREO.pcm);
  });
  it('출력 버퍼가 작으면 거기서 멈춘다', () => {
    expect(decompressAdpcm(MONO.adpcm, 100, 1)).toEqual(MONO.pcm.subarray(0, 100));
    expect(decompressAdpcm(new Uint8Array(1), 100, 1).length).toBe(0);
  });
});

describe('WAV 파서', () => {
  const wav = (fmt: number, ch: number, bits: number, data: number[], extra: number[] = []) => {
    const block = fmt === 0x11 ? 36 * ch : (bits / 8) * ch;
    const fmtLen = 16 + extra.length;
    const b = new Uint8Array(12 + 8 + fmtLen + 8 + data.length);
    const v = new DataView(b.buffer);
    b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    v.setUint32(4, b.length - 8, true);
    b.set([...'WAVEfmt '].map((c) => c.charCodeAt(0)), 8);
    v.setUint32(16, fmtLen, true);
    v.setUint16(20, fmt, true);
    v.setUint16(22, ch, true);
    v.setUint32(24, 22050, true);
    v.setUint32(28, 22050 * block, true);
    v.setUint16(32, block, true);
    v.setUint16(34, bits, true);
    b.set(extra, 36);
    b.set([...'data'].map((c) => c.charCodeAt(0)), 36 + extra.length);
    v.setUint32(40 + extra.length, data.length, true);
    b.set(data, 44 + extra.length);
    return b;
  };
  it('16비트 스테레오 PCM → 채널별 [-1,1]', () => {
    const w = decodeWav(wav(1, 2, 16, [0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f, 0x00, 0x80]));
    expect(w.frames).toBe(2);
    expect(Array.from(w.data[0] ?? [])).toEqual([0.5, 32767 / 32768]);
    expect(Array.from(w.data[1] ?? [])).toEqual([-0.5, -1]);
  });
  it('8비트 PCM 은 128 이 0', () => {
    const w = decodeWav(wav(1, 1, 8, [128, 0, 255]));
    expect(Array.from(w.data[0] ?? [])).toEqual([0, -1, 127 / 128]);
  });
  it('IMA ADPCM WAV(0x11) 블록: 헤더 예측값이 첫 샘플, 니블로 나머지', () => {
    // 모노 블록 36바이트 = 헤더 4 + 32바이트(64 니블) → 65 샘플
    const data = [0x10, 0x00, 0x00, 0x00, ...new Array<number>(32).fill(0x77)];
    const w = decodeWav(wav(0x11, 1, 4, data, [2, 0, 65, 0]));
    expect(w.frames).toBe(65);
    expect(w.data[0]?.[0]).toBeCloseTo(16 / 32768);
    expect(w.data[0]?.[1] ?? 0).toBeGreaterThan(w.data[0]?.[0] ?? 0);
  });
  it('RIFF 가 아니면 에러', () => {
    expect(() => parseWavInfo(new Uint8Array(20))).toThrow(/RIFF/);
  });
});

// 실제 원작 사운드 MPQ — game-data/ 가 있어야 실행된다.
// 기준 해시: 같은 파일의 모든 섹터를 StormLib 해제 결과와 바이트 단위로 대조해 일치를 확인한 뒤 기록한 FNV-1a.
const GD = resolve(__dirname, '../../game-data');
const find = (n: string) => (existsSync(GD) ? readdirSync(GD).find((f) => f.toLowerCase() === n) : undefined);
const fnv = (b: Uint8Array) => {
  let h = 0x811c9dc5;
  for (const x of b) h = Math.imul(h ^ x, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
};

describe.skipIf(!find('d2sfx.mpq') || !find('d2speech.mpq') || !find('d2music.mpq'))('실제 원작 사운드 MPQ', () => {
  const open = (n: string) => MpqFile.open(resolve(GD, find(n) as string));
  const cases: [string, string, number, number, number, string][] = [
    // [mpq, 경로, 채널, 비트, 샘플(프레임) 수, 해시]
    ['d2sfx.mpq', 'data\\global\\sfx\\combat\\player\\barbarian\\soft1.wav', 1, 16, 9716, 'bcd9640f'],
    ['d2sfx.mpq', 'data\\global\\sfx\\cursor\\intro\\barbarian deselect.wav', 2, 16, 24191, '28badf7c'],
    ['d2sfx.mpq', 'data\\global\\sfx\\ambient\\event\\loon1.wav', 1, 8, 31361, 'bafbdca6'],
    ['d2speech.mpq', 'data\\local\\sfx\\Act1\\Akara\\Aka_hello.wav', 1, 16, 12604, '88ee6742'],
    ['d2music.mpq', 'data\\global\\music\\Act4\\izualaction.wav', 2, 16, 285183, 'c186a5f8'],
  ];
  const archives = new Map<string, MpqFile>();
  for (const [mpq, path, ch, bits, frames, hash] of cases) {
    it(`${path.split('\\').pop()}: huffman+ADPCM 해제, PCM 샘플 수 = WAV 헤더 값`, () => {
      let a = archives.get(mpq);
      if (!a) archives.set(mpq, (a = open(mpq)));
      const bytes = a.read(path);
      expect(bytes).not.toBeNull();
      const b = bytes as Uint8Array;
      expect(b.length).toBe(a.findBlock(path)?.fileSize);
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      // RIFF 크기 + 8 = 파일 크기, data 청크 크기 / blockAlign = 샘플 수
      expect(v.getUint32(4, true) + 8).toBe(b.length);
      const info = parseWavInfo(b);
      expect([info.channels, info.bitsPerSample, info.frames]).toEqual([ch, bits, frames]);
      const w = decodeWav(b);
      expect(w.data.length).toBe(ch);
      expect(w.data[0]?.length).toBe(frames);
      expect(fnv(b)).toBe(hash);
    });
  }
});
