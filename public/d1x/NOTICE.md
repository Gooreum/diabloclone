# DevilutionX 웹 빌드 (수정본)

디아블로 1 모드가 쓰는 게임 엔진입니다.

- 원본: DevilutionX — https://github.com/diasurgical/devilutionX (커밋 `b569d8acfdbaf48a7a4e4c8e006f758b48956a0e`)
- 라이선스: Sustainable Use License 1.0 — 이 폴더의 `LICENSE.md` (비상업 용도만)
- **이 빌드는 수정되었습니다 (This software has been modified).** 수정 내용은 저장소의 `patches/devilutionx-web.patch`:
  1. 웹 빌드에서 스레드(pthread) 사용 안 함 — SDL2·Lua·라이브러리 링크 (GitHub Pages 는 SharedArrayBuffer 를 못 씀)
  2. 소리 파일 이름이 .wav 여도 내용이 MP3 면 MP3 로 읽음 (웹용으로 다시 묶은 쉐어웨어 MPQ)
  3. 없는 소리는 게임을 멈추지 않고 짧은 무음으로
  4. 메뉴 오각별 그림(ui_art\\focus.pcx)이 없으면 작은 오각별(focus16)로
- 빌드: `scripts/build-devilutionx.sh` (emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.12 (5488e0871d46d19a3209988190fa6a653126256f))

| 파일 | 크기 | sha256 |
|------|------|--------|
| `devilutionx.js` | 220080 | `3d7435c7c1729c27cf29a0d3e46551393209c865c0effd6493f79129519a142c` |
| `devilutionx.wasm` | 6017141 | `aeb2082a75b78e0093e78429a83c5fabed0ce7a8a328507b31d5ad2c873f7209` |
| `devilutionx.data` | 12732968 | `e4cedda044a21cbe2efd7c926b9667c4267a986e692a309ac7df2c7ccf636ac6` |
