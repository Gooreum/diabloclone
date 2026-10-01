// 판본: 클래식 / 확장팩(Lord of Destruction). 고른 MPQ 에 d2exp.mpq 가 있으면 확장팩.
// 확장팩 설치 폴더에는 클래식 파일(d2data·d2sfx …)도 함께 있고, patch_d2·d2char 는 확장팩판으로 바뀐다.
// 출처: 원작 1.14d 확장팩 설치 — d2exp.mpq 가 patch_d2 다음, d2char·d2data 보다 앞서 읽힌다
export type Edition = 'classic' | 'lod';

/** 확장팩 설치에만 있는 파일 (d2exp 만 있으면 확장팩으로 시작, 나머지는 음악·대사·영상) */
export const LOD_MPQS = ['d2exp.mpq', 'd2xmusic.mpq', 'd2xtalk.mpq', 'd2xvideo.mpq'] as const;

const CLASSIC_ORDER = ['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq'] as const;
const LOD_ORDER = ['patch_d2.mpq', 'd2exp.mpq', 'd2char.mpq', 'd2data.mpq'] as const;
const CLASSIC_SOUND = ['patch_d2.mpq', 'd2sfx.mpq', 'd2speech.mpq', 'd2music.mpq'] as const;
const LOD_SOUND = ['patch_d2.mpq', 'd2exp.mpq', 'd2xtalk.mpq', 'd2xmusic.mpq', 'd2sfx.mpq', 'd2speech.mpq', 'd2music.mpq'] as const;

/** 파일 이름들 (대소문자 무시) → 판본 */
export function editionOf(names: Iterable<string>): Edition {
  for (const n of names) if (n.split(/[\\/]/).pop()!.toLowerCase() === 'd2exp.mpq') return 'lod';
  return 'classic';
}

/** 그래픽·표 MPQ 우선순위 */
export function mpqOrder(e: Edition): readonly string[] {
  return e === 'lod' ? LOD_ORDER : CLASSIC_ORDER;
}

/** 소리 MPQ 우선순위 (없는 파일은 건너뛴다) */
export function soundMpqs(e: Edition): readonly string[] {
  return e === 'lod' ? LOD_SOUND : CLASSIC_SOUND;
}
