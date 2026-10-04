// 표시 언어 (원작 data\local\lng\<lang>\*.tbl). 고른 언어 표에 없는 파일·키는 영어를 쓰되,
// 한국어는 자체 번역(lang/kor-fallback.ts)으로 빈 키를 채운다 — 공식 표(있다면 kor\expansionstring.tbl 포함)가 항상 우선 (GameTables.string).
// 출처: 사용자 MPQ 직접 확인 — d2exp.mpq kor\string.tbl, patch_d2.mpq kor\patchstring.tbl (UTF-8), kor\expansionstring.tbl 없음
export type Lang = 'eng' | 'kor';
export const STRING_TABLES = ['string.tbl', 'expansionstring.tbl', 'patchstring.tbl'] as const;
/** 한국어 표가 있는지 볼 파일 (확장팩 MPQ 에만 있다) */
export const KOR_STRING = 'data\\local\\lng\\kor\\string.tbl';
const LANG_KEY = 'd2clone.lang';

export function loadLang(): Lang {
  try {
    return globalThis.localStorage?.getItem(LANG_KEY) === 'kor' ? 'kor' : 'eng';
  } catch {
    return 'eng';
  }
}

export function saveLang(l: Lang): void {
  try {
    globalThis.localStorage?.setItem(LANG_KEY, l);
  } catch {
    // 이번 판에서만 유지
  }
}

/** 읽는 언어 순서 (영어를 먼저 깔고 그 위에 고른 언어) */
export const langLayers = (lang: Lang): Lang[] => (lang === 'eng' ? ['eng'] : ['eng', lang]);

/** 읽을 문자열 표 경로 */
export const lngPaths = (lang: Lang): string[] => langLayers(lang).flatMap((l) => STRING_TABLES.map((f) => `data\\local\\lng\\${l}\\${f}`));
