# DevilutionX 웹 빌드 (수정본)

디아블로 1 모드가 쓰는 게임 엔진입니다.

- 원본: DevilutionX — https://github.com/diasurgical/devilutionX (커밋 `b569d8acfdbaf48a7a4e4c8e006f758b48956a0e`)
- 라이선스: Sustainable Use License 1.0 — 이 폴더의 `LICENSE.md` (비상업 용도만)
- **이 빌드는 수정되었습니다 (This software has been modified).** 수정 내용은 저장소의 `patches/devilutionx-web.patch`:
  1. 웹 빌드에서 스레드(pthread) 사용 안 함 — SDL2·Lua·라이브러리 링크 (GitHub Pages 는 SharedArrayBuffer 를 못 씀)
  2. 소리 파일 이름이 .wav 여도 내용이 MP3 면 MP3 로 읽음 (웹용으로 다시 묶은 쉐어웨어 MPQ)
  3. 없는 소리는 게임을 멈추지 않고 짧은 무음으로
  4. 메뉴 오각별 그림(ui_art\\focus.pcx)이 없으면 작은 오각별(focus16)로
  5. 단축키에 동시키(SHIFT+1·CTRL+ALT+A 등) — 조합 배정이 있으면 먼저, 없으면 원래처럼 키 하나
  6. 브라우저가 먼저 쓰는 F1~F12 는 배정하지 않음 — 기본값을 H·SHIFT+S·SHIFT+L·SHIFT+1~4 로, 예전 설정의 F키는 기본값으로
  7. 웹 페이지의 게임 중 단축키 화면이 키 배정을 읽고 바꾸는 함수 (dvx_keymap_json, dvx_keymap_set)
  8. 웹 페이지의 "★ 최강" 단추 — 지금 영웅을 최대 레벨·능력치·주문 15·직업별 최고 장비로 바꾸고 저장 (dvx_max_hero, 확인용 dvx_hero_json)
- 빌드: `scripts/build-devilutionx.sh` (emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.12 (5488e0871d46d19a3209988190fa6a653126256f))
- 한글 글꼴 `fonts-ko.mpq`: DevilutionX 글꼴 모음 fonts.mpq (https://github.com/diasurgical/devilutionx-assets 릴리스 v5) 에서
  한글 음절 블록만 골라 다시 묶은 것 (`scripts/build-d1-fonts.ts`). 글꼴은 Noto CJK·Unifont, SIL Open Font License 1.1 — 이 폴더의 `LICENSE-SIL.txt`

| 파일 | 크기 | sha256 |
|------|------|--------|
| `devilutionx.js` | 221638 | `fb4526159cacbdbd2e08a1f7ba02e6444874a8a558107dc9ba672778decd97b7` |
| `devilutionx.wasm` | 6036448 | `e93dc5970b6be8407bbb7d0793a24b74d99af116f4c207810d1b871f2c65d33c` |
| `devilutionx.data` | 12732968 | `e4cedda044a21cbe2efd7c926b9667c4267a986e692a309ac7df2c7ccf636ac6` |
| `fonts-ko.mpq` | 16418824 | `2baee5ad59e672ca871feeee1874c562194129e9275a8aca5f4ce547cde92cc8` |
