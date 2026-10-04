// 자체 한국어 번역: 원작 kor\string.tbl·kor\patchstring.tbl 에 없는 확장팩 문자열 (eng\expansionstring.tbl + patchstring 일부).
// 근사(원작 미확인): 원작 한국어 LoD 의 공식 번역이 아니라 이 저장소의 번역이다 — 사용자 MPQ 에 kor\expansionstring.tbl 이 있으면 그 값이 우선한다 (GameTables.string).
// 생성: node scripts/gen-kor-fallback.mjs <번역 JSON 폴더> (원작 키·자리 표시자 검증 뒤 이 파일을 다시 쓴다). 손으로 고쳐도 된다.
export const KOR_FALLBACK: Readonly<Record<string, string>> = {
};
