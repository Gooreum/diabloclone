import { describe, expect, it } from 'vitest';
import { openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { AssetLoader } from '../../src/assets/loader';
import { GfxClient } from '../../src/assets/gfx-client';
import { DccStore, handleGfx } from '../../src/assets/gfx-worker';
import { parseDcc, parseDccDirection, parseDccHeader } from '../../src/formats/dcc';
import { GAME_DATA, hasGameData, mustRead } from '../support/gamedata';

const fakeRange = async (url: string, start: number, length: number) => {
  const fd = openSync(resolve(GAME_DATA, url.replace('/d2/', '')), 'r');
  try {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    return new Uint8Array(buf);
  } finally {
    closeSync(fd);
  }
};

describe('DccStore', () => {
  it('예산을 넘으면 가장 오래된 원본부터 버린다', () => {
    const st = new DccStore(100);
    const h = { directions: 1, framesPerDirection: 1, offsets: [0] };
    st.put('a', new Uint8Array(40), h);
    st.put('b', new Uint8Array(40), h);
    st.get('a'); // a 를 최근에 씀
    st.put('c', new Uint8Array(40), h);
    expect(st.get('b')).toBeUndefined();
    expect(st.get('a')).toBeDefined();
    expect(st.bytes).toBeLessThanOrEqual(100);
  });

  it('기억에 없는 DCC 의 방향 요청은 missing', () => {
    const r = handleGfx({ id: 1, kind: 'dccDir', key: 'nope', dir: 0 }, new DccStore());
    expect(r).toMatchObject({ ok: false, missing: true });
  });
});

const PATH = 'data\\global\\monsters\\FA\\TR\\FATRLITA1HTH.dcc';

describe.skipIf(!hasGameData)('DCC 방향별 해석 (원작 파일)', () => {
  it('방향 하나씩 해석한 결과가 전체 해석과 바이트 단위로 같다', () => {
    const buf = mustRead(PATH);
    const all = parseDcc(buf);
    const h = parseDccHeader(buf);
    expect(h.directions).toBe(all.directions.length);
    for (let d = h.directions - 1; d >= 0; d--) {
      const one = parseDccDirection(buf, h, d);
      expect(one.box).toEqual(all.directions[d]!.box);
      expect(one.frames.map((f) => [...f.pixels])).toEqual(all.directions[d]!.frames.map((f) => [...f.pixels]));
    }
  });

  it('AssetLoader: 워커 없이(메인 스레드) load 는 같은 바이트, loadDcc 방향은 parseDcc 와 같다', async () => {
    const loader = await AssetLoader.open('/d2/', fakeRange, new GfxClient(false));
    expect(await loader.load('data\\global\\excel\\monstats.txt')).toEqual(mustRead('data\\global\\excel\\monstats.txt'));
    const all = parseDcc(mustRead(PATH));
    const h = (await loader.loadDcc(PATH))!;
    expect(h.directions).toBe(all.directions.length);
    expect(h.framesPerDirection).toBe(all.framesPerDirection);
    const d3 = (await h.dir(3))!;
    expect(d3.frames.map((f) => [...f.pixels])).toEqual(all.directions[3]!.frames.map((f) => [...f.pixels]));
    expect(await h.dir(99)).toBeNull();
    expect(await loader.loadDcc('data\\global\\monsters\\XX\\none.dcc')).toBeNull();
  });
});
