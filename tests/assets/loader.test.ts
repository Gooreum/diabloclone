import { describe, expect, it } from 'vitest';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { AssetLoader } from '../../src/assets/loader';
import { GAME_DATA, hasGameData, mustRead } from '../support/gamedata';

describe.skipIf(!hasGameData)('Range 요청 MPQ 로더', () => {
  let bytesFetched = 0;
  const fakeRange = async (url: string, start: number, length: number) => {
    const file = resolve(GAME_DATA, url.replace('/d2/', ''));
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, start);
      bytesFetched += length;
      return new Uint8Array(buf);
    } finally {
      closeSync(fd);
    }
  };

  it('필요한 부분만 읽어 동기 로더와 같은 내용을 반환', async () => {
    const loader = await AssetLoader.open('/d2/', fakeRange);
    const path = 'data\\global\\excel\\monstats.txt';
    await loader.preload([path, 'data\\global\\palette\\ACT1\\pal.dat']);
    expect(loader.read(path)).toEqual(mustRead(path));
    const total = ['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq'].reduce((s, f) => s + statSync(resolve(GAME_DATA, f)).size, 0);
    expect(bytesFetched).toBeLessThan(total / 50);
  });

  it('preload 하지 않은 파일의 동기 read 는 에러', async () => {
    const loader = await AssetLoader.open('/d2/', fakeRange);
    expect(() => loader.read('data\\global\\excel\\levels.txt')).toThrow(/not preloaded/);
  });
});
