// 판본 판정·MPQ 순서. 출처: 원작 1.14d 확장팩 설치 폴더 (d2exp·d2xmusic·d2xtalk·d2xvideo 가 더해지고 patch_d2·d2char 가 확장팩판)
import { describe, expect, it } from 'vitest';
import { editionOf, LOD_MPQS, mpqOrder, soundMpqs } from '../../src/assets/edition';
import { MPQ_ORDER } from '../../src/assets/loader';
import { ALL_MPQS, canonicalName } from '../../src/assets/local-mpq';

const CLASSIC = ['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq', 'd2sfx.mpq', 'd2speech.mpq', 'd2music.mpq'];

describe('판본', () => {
  it('d2exp.mpq 가 있으면 확장팩, 없으면 클래식', () => {
    expect(editionOf([...CLASSIC, 'd2exp.mpq'])).toBe('lod');
    expect(editionOf(CLASSIC)).toBe('classic');
    expect(editionOf([])).toBe('classic');
    // 음악·대사만으로는 확장팩이 아니다 (d2exp 가 표·그림)
    expect(editionOf([...CLASSIC, 'd2xmusic.mpq', 'd2xtalk.mpq'])).toBe('classic');
  });

  it('이름은 대소문자·경로를 가리지 않는다', () => {
    expect(editionOf(['C:\\Diablo II\\D2EXP.MPQ'])).toBe('lod');
    expect(canonicalName('D2EXP.MPQ')).toBe('d2exp.mpq');
    expect(canonicalName('d2xvideo.mpq')).toBe('d2xvideo.mpq');
    for (const n of LOD_MPQS) expect(ALL_MPQS).toContain(n);
  });

  it('MPQ 순서: 클래식은 지금 그대로, 확장팩은 patch_d2 > d2exp > d2char > d2data', () => {
    expect(mpqOrder('classic')).toEqual([...MPQ_ORDER]);
    expect(mpqOrder('lod')).toEqual(['patch_d2.mpq', 'd2exp.mpq', 'd2char.mpq', 'd2data.mpq']);
  });

  it('소리: 클래식 4개, 확장팩은 d2exp·d2xtalk·d2xmusic 을 클래식 파일보다 먼저', () => {
    expect(soundMpqs('classic')).toEqual(['patch_d2.mpq', 'd2sfx.mpq', 'd2speech.mpq', 'd2music.mpq']);
    const lod = soundMpqs('lod');
    for (const n of soundMpqs('classic')) expect(lod).toContain(n);
    expect(lod.indexOf('d2xmusic.mpq')).toBeLessThan(lod.indexOf('d2music.mpq'));
    expect(lod.indexOf('d2xtalk.mpq')).toBeLessThan(lod.indexOf('d2speech.mpq'));
  });
});
