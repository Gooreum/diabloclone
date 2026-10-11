#!/usr/bin/env bash
# 디아블로 1 엔진(DevilutionX)을 웹(WebAssembly)으로 빌드해 public/d1x/ 에 넣는다.
# 고정 커밋 + patches/devilutionx-web.patch (웹 빌드용 수정) — 결과 해시는 public/d1x/NOTICE.md 에 적힌다.
# 필요: git, cmake, ninja, Emscripten SDK (EMSDK 환경 또는 EMSDK_DIR=… 로 emsdk 폴더 지정)
set -euo pipefail

DVX_REPO=https://github.com/diasurgical/devilutionX.git
DVX_COMMIT=b569d8acfdbaf48a7a4e4c8e006f758b48956a0e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${DVX_WORK:-$ROOT/.dvx-build}"
OUT="$ROOT/public/d1x"

if ! command -v emcc >/dev/null 2>&1; then
  if [ -n "${EMSDK_DIR:-}" ]; then
    # shellcheck disable=SC1091
    source "$EMSDK_DIR/emsdk_env.sh" >/dev/null
  else
    echo "Emscripten(emcc)이 없습니다. emsdk 를 설치하고 EMSDK_DIR=<emsdk 폴더> 로 실행하세요." >&2
    exit 1
  fi
fi

if [ ! -d "$WORK/src/.git" ]; then
  mkdir -p "$WORK"
  git clone --filter=blob:none "$DVX_REPO" "$WORK/src"
fi
git -C "$WORK/src" fetch --depth 1 origin "$DVX_COMMIT" 2>/dev/null || true
git -C "$WORK/src" checkout -q --force "$DVX_COMMIT"
git -C "$WORK/src" clean -qfd -- CMake 3rdParty Source
git -C "$WORK/src" apply "$ROOT/patches/devilutionx-web.patch"

cd "$WORK/src"
emcmake cmake -S . -B build-em -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build build-em -j "$(getconf _NPROCESSORS_ONLN)"

mkdir -p "$OUT"
cp build-em/devilutionx.js build-em/devilutionx.wasm build-em/devilutionx.data "$OUT/"
cp LICENSE.md "$OUT/LICENSE.md"

# NOTICE.md 의 해시 표를 새 결과로 갱신
node "$ROOT/scripts/update-d1x-notice.mjs" "$OUT" "$DVX_COMMIT" "$(emcc --version | head -1)"
echo "완료: $OUT"
