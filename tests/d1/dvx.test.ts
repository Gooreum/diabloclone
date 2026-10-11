import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// 디아블로 1 엔진 = DevilutionX 웹 빌드 (public/d1x, scripts/build-devilutionx.sh). 라이선스 의무: 전문 동봉 + 수정 표시
const D1X = resolve(__dirname, '../../public/d1x');
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('DevilutionX 웹 빌드 반입본', () => {
  it('NOTICE.md 의 크기·sha256 이 실제 파일과 같다', () => {
    const notice = readFileSync(resolve(D1X, 'NOTICE.md'), 'utf8');
    const rows = [...notice.matchAll(/^\| `([^`]+)` \| (\d+) \| `([0-9a-f]{64})` \|$/gm)];
    expect(rows.map((r) => r[1])).toEqual(['devilutionx.js', 'devilutionx.wasm', 'devilutionx.data']);
    for (const [, name, size, hash] of rows) {
      const p = resolve(D1X, name!);
      expect(statSync(p).size, name).toBe(Number(size));
      expect(sha256(p), name).toBe(hash);
    }
  });

  it('라이선스 전문(Sustainable Use License)과 수정 표시가 함께 있다', () => {
    expect(readFileSync(resolve(D1X, 'LICENSE.md'), 'utf8')).toContain('Sustainable Use License');
    const notice = readFileSync(resolve(D1X, 'NOTICE.md'), 'utf8');
    expect(notice).toContain('This software has been modified');
    expect(notice).toContain('patches/devilutionx-web.patch');
    expect(notice).toMatch(/b569d8acfdbaf48a7a4e4c8e006f758b48956a0e/);
  });

  it('웹 빌드는 스레드를 쓰지 않는다 (GitHub Pages 에는 SharedArrayBuffer 가 없다)', () => {
    const js = readFileSync(resolve(D1X, 'devilutionx.js'), 'utf8');
    expect(js).not.toMatch(/new SharedArrayBuffer|ENVIRONMENT_IS_PTHREAD\s*=\s*true/);
  });

  it('패치는 5개 파일만 고친다', () => {
    const patch = readFileSync(resolve(__dirname, '../../patches/devilutionx-web.patch'), 'utf8');
    const files = [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
    expect(files).toEqual(['3rdParty/Lua/CMakeLists.txt', 'CMake/Dependencies.cmake', 'CMake/functions/devilutionx_library.cmake', 'Source/DiabloUI/diabloui.cpp', 'Source/engine/sound.cpp']);
  });
});

describe('DevilutionX 셸 (public/d1x/play.html)', () => {
  it('엔진 주소에 붙는 버전이 wasm 해시와 같다 (캐시 무효화)', () => {
    const shell = readFileSync(resolve(D1X, 'play.html'), 'utf8');
    const v = /var D1X_VERSION = '([0-9a-f]{12})'/.exec(shell)?.[1];
    expect(v).toBe(sha256(resolve(D1X, 'devilutionx.wasm')).slice(0, 12));
    expect(shell).toContain("'--lang', 'en'");
  });
});
