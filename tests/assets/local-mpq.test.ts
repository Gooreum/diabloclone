import { describe, expect, it } from 'vitest';
import { openAsBlob, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blobRange, canonicalName, isMpq, MpqStore } from '../../src/assets/local-mpq';
import { MpqRemote } from '../../src/assets/remote';
import { GAME_DATA, hasGameData } from '../support/gamedata';

describe('유저가 고른 MPQ (브라우저 보관)', () => {
  it('파일 이름은 대소문자 무시, 폴더 경로 무시, 모르는 파일은 null', () => {
    expect(canonicalName('D2DATA.MPQ')).toBe('d2data.mpq');
    expect(canonicalName('Diablo II/d2Music.mpq')).toBe('d2music.mpq');
    expect(canonicalName('foo.mpq')).toBeNull();
    // 확장팩 파일도 받는다 (d2exp 가 있으면 확장팩으로 — edition.ts)
    expect(canonicalName('d2exp.mpq')).toBe('d2exp.mpq');
  });

  it('MPQ 헤더가 아니면 거절', async () => {
    expect(await isMpq(new Blob([new Uint8Array(64).fill(1)]))).toBe(false);
    expect(await isMpq(new Blob([new Uint8Array([0x4d, 0x50, 0x51, 0x1a])]))).toBe(false);
    const ok = new Uint8Array(64);
    ok.set([0x4d, 0x50, 0x51, 0x1a]);
    expect(await isMpq(new Blob([ok]))).toBe(true);
  });

  it('필수 3개 중 빠진 것만 알려준다', () => {
    const have = new Map([['patch_d2.mpq', new Blob()], ['d2char.mpq', new Blob()], ['d2sfx.mpq', new Blob()]]);
    expect(MpqStore.missing(have)).toEqual(['d2data.mpq']);
    expect(MpqStore.missing(new Map())).toEqual(['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq']);
  });

  it('보관 안 된 파일을 읽으면 에러', async () => {
    await expect(blobRange(new Map())('local/d2data.mpq', 0, 4)).rejects.toThrow(/not loaded/);
  });

  it.skipIf(!hasGameData)('실제 patch_d2.mpq Blob 에서 읽은 파일이 원본 조각과 같다', async () => {
    const file = resolve(GAME_DATA, 'patch_d2.mpq');
    const files = new Map([['patch_d2.mpq', await openAsBlob(file)]]);
    const whole = readFileSync(file);
    const fromDisk = async (_u: string, s: number, l: number) => new Uint8Array(whole.subarray(s, s + l));
    const a = await MpqRemote.open('local/patch_d2.mpq', blobRange(files));
    const b = await MpqRemote.open('local/patch_d2.mpq', fromDisk);
    const path = 'data\\global\\excel\\monstats.txt';
    const got = await a.read(path);
    expect(got).not.toBeNull();
    expect(got!.length).toBeGreaterThan(1000);
    expect(got).toEqual(await b.read(path));
  });
});
