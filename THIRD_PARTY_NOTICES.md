# 제3자 코드·자료 표기 (Third-party notices)

이 프로젝트(diabloclone)는 GPL-3.0 으로 공개합니다 (`LICENSE`). Copyright (c) 2026 Gooreum.
아래 자료를 옮기거나 참고했습니다.

## D2MOO — MIT License
https://github.com/ThePhrozenKeep/D2MOO

Diablo II 1.10 재구성 소스입니다. 게임 규칙(월드 생성·몬스터 AI·스킬·아이템·퀘스트·조작 반응 등)을 TypeScript 로 옮겼습니다.
코드의 `// 출처: D2MOO …` 주석이 해당 위치입니다.

    MIT License

    Copyright (c) 2020-2025 The Phrozen Keep community

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

## OpenDiablo2 — GPL-3.0
https://github.com/OpenDiablo2/OpenDiablo2

DCC 디코딩(`src/formats/dcc.ts`), COF·DS1·PL2·글꼴 형식(`src/formats/`), 방향 표(`src/render/units.ts`, `src/engine/geom.ts`),
메뉴·스킬 트리 배치 값(`src/ui/menu.ts`, `src/ui/skillpanel.ts`)을 옮기거나 참고했습니다.
OpenDiablo2 는 GNU General Public License v3 로 공개되어 있으며, 이 프로젝트가 GPL-3.0 인 이유입니다. 전문은 `LICENSE` 에 있습니다.

## Devilution 웹 빌드 — d07RiV/devilution · diabloweb (비상업 조건)
https://github.com/d07RiV/devilution (빌드 소스, 커밋 798b512) · https://github.com/d07RiV/diabloweb (배포 바이너리, 커밋 c61ef19)

디아블로 1 모드(`src/d1/`)는 1996년 Diablo 를 역공학한 Devilution 을 Emscripten 으로 빌드한 WebAssembly 모듈을 **수정 없이** 씁니다:
`src/d1/vendor/Diablo.wasm`, `DiabloSpawn.wasm`, `Diablo.jscc`, `DiabloSpawn.jscc` (출처 커밋·sha256 은 `src/d1/vendor/NOTICE.md`).
브라우저 쪽 호스트(워커·입력·소리·세이브 보관, `src/d1/*.ts`)는 이 프로젝트가 직접 썼고 diabloweb 의 JavaScript 는 옮기지 않았습니다 (diabloweb 저장소에는 라이선스 표기가 없습니다).

라이선스 조건은 이 저장소의 GPL-3.0 과 **다릅니다**:
- `d07RiV/devilution` 의 `LICENSE` 파일은 Unlicense(퍼블릭 도메인)이지만, 같은 저장소 README 는 "소스 코드는 비상업 용도 전용이며, 이를 쓰거나 파생한 것으로 남에게 돈을 받을 수 없다"고 밝힙니다.
- 원조 `diasurgical/devilution` 은 현재 Sustainable Use License(비상업)로 공개되어 있습니다.
- 따라서 **디아블로 1 모듈은 비상업 용도로만** 쓰세요. 이 모듈을 빼면 나머지 프로젝트는 GPL-3.0 그대로입니다.
- Emscripten 런타임 글루(`.jscc` 안의 생성 코드)는 MIT / University of Illinois NCSA 라이선스입니다.

원작 데이터(DIABDAT.MPQ, 쉐어웨어 spawn.mpq)는 포함하지 않습니다. 쉐어웨어는 Blizzard 가 무료 배포한 것이지만 저장소에는 넣지 않고, 개발용 `npm run fetch-d1` 로 각자 받습니다.

## 문서
- The Phrozen Keep (https://d2mods.info/) — 데이터 표·파일 형식 문서
- Paul Siramy — DCC / DT1 / DS1 파일 형식 문서
- Ladislav Zezula (http://www.zezula.net/en/mpq/mpqformat.html) — MPQ 형식 문서

## 상표
Diablo® 와 Blizzard Entertainment® 는 Blizzard Entertainment, Inc. 의 상표입니다.
이 프로젝트는 Blizzard 와 관련이 없는 개인 팬 프로젝트이며, 원작 게임 파일(MPQ)을 포함하거나 배포하지 않습니다.
원작 게임 파일은 위 라이선스와 무관한 Blizzard 의 저작물입니다.
