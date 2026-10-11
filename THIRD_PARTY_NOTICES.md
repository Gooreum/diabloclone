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

## DevilutionX — Sustainable Use License 1.0 (비상업 조건)
https://github.com/diasurgical/devilutionX (커밋 b569d8a, 2026-10-11)

디아블로 1 모드는 DevilutionX(1996년 Diablo 를 역공학한 Devilution 을 현대화한 포트)를 Emscripten 으로 빌드한 WebAssembly 를 씁니다:
`public/d1x/devilutionx.js`, `devilutionx.wasm`, `devilutionx.data` (해시·빌드 정보는 `public/d1x/NOTICE.md`, 라이선스 전문은 `public/d1x/LICENSE.md`).
- **수정했습니다.** 웹 빌드용 수정 5파일 36줄이 `patches/devilutionx-web.patch` 에 있고, `scripts/build-devilutionx.sh` 로 그대로 재현합니다:
  스레드 사용 안 함(GitHub Pages), .wav 이름의 MP3 소리 인식, 없는 소리는 무음, 메뉴 오각별 그림 대체.
- 셸(`public/d1x/play.html`)과 사이트 연결(`src/d1/host.ts`)은 이 프로젝트가 직접 썼습니다.
- 조건이 이 저장소의 GPL-3.0 과 **다릅니다**: 비상업·개인 용도로만 쓰고, 배포할 때는 무료로, 라이선스·저작권 표시를 지우지 말 것. 이 모듈을 빼면 나머지는 GPL-3.0 그대로입니다.
- 원작 데이터(DIABDAT.MPQ, 쉐어웨어 spawn.mpq)는 포함하지 않습니다. 파일이 없으면 공개 호스팅된 쉐어웨어(https://d07riv.github.io/diabloweb/spawn.mpq)를 사용자 브라우저가 받습니다.

## 문서
- The Phrozen Keep (https://d2mods.info/) — 데이터 표·파일 형식 문서
- Paul Siramy — DCC / DT1 / DS1 파일 형식 문서
- Ladislav Zezula (http://www.zezula.net/en/mpq/mpqformat.html) — MPQ 형식 문서

## 상표
Diablo® 와 Blizzard Entertainment® 는 Blizzard Entertainment, Inc. 의 상표입니다.
이 프로젝트는 Blizzard 와 관련이 없는 개인 팬 프로젝트이며, 원작 게임 파일(MPQ)을 포함하거나 배포하지 않습니다.
원작 게임 파일은 위 라이선스와 무관한 Blizzard 의 저작물입니다.
