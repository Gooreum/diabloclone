# Devilution 웹 빌드 반입본

디아블로 1 모드가 쓰는 게임 엔진입니다. 수정 없이 그대로 가져왔습니다.

- 출처: https://github.com/d07RiV/diabloweb — 커밋 `c61ef19c54ea646aed328bd8cc82c8a5f1ebd81d` (2022-05-17), `src/api/`
- 빌드 소스: https://github.com/d07RiV/devilution — 커밋 `798b5122731ae4b5e0c91348e5c44cf79354a94e` (Emscripten `build.js`)
- 라이선스·조건: `THIRD_PARTY_NOTICES.md` 의 "Devilution 웹 빌드" 절

| 파일 | 용도 | 크기 | sha256 |
|------|------|------|--------|
| `Diablo.wasm` | 정식판 (DIABDAT.MPQ) | 1519717 | `c54252a5dce7da8117c2c78c30c73b8d00590fc7a36f8bb3abc74f544a14d94b` |
| `DiabloSpawn.wasm` | 쉐어웨어 (spawn.mpq) | 1381584 | `2ccc7727552ab05385da15335c19ae561f4e4d7d3796d90ab104cb498b7530ba` |
| `Diablo.jscc` | 정식판 Emscripten 글루 (UMD) | 95022 | `64de54602e7f9f15e5226306ed0ded04cc116d1672d71a231dd356eb3e73d473` |
| `DiabloSpawn.jscc` | 쉐어웨어 Emscripten 글루 (UMD) | 95082 | `30de836f98775a78430c8042159c70064c449bf9f2dc111a91e5ed07ab29dde1` |

`tests/d1/vendor.test.ts` 가 이 표와 실제 파일의 해시가 같은지 검사합니다.
