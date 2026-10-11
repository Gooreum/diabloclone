#!/usr/bin/env node
// public/d1x/NOTICE.md 를 만든다: DevilutionX 출처·수정 사실(라이선스 의무)·파일 해시
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, commit, emcc] = process.argv.slice(2);
const files = ['devilutionx.js', 'devilutionx.wasm', 'devilutionx.data'];
const rows = files.map((f) => {
  const p = join(out, f);
  return `| \`${f}\` | ${statSync(p).size} | \`${createHash('sha256').update(readFileSync(p)).digest('hex')}\` |`;
});
writeFileSync(join(out, 'NOTICE.md'), `# DevilutionX 웹 빌드 (수정본)

디아블로 1 모드가 쓰는 게임 엔진입니다.

- 원본: DevilutionX — https://github.com/diasurgical/devilutionX (커밋 \`${commit}\`)
- 라이선스: Sustainable Use License 1.0 — 이 폴더의 \`LICENSE.md\` (비상업 용도만)
- **이 빌드는 수정되었습니다 (This software has been modified).** 수정 내용은 저장소의 \`patches/devilutionx-web.patch\`:
  1. 웹 빌드에서 스레드(pthread) 사용 안 함 — SDL2·Lua·라이브러리 링크 (GitHub Pages 는 SharedArrayBuffer 를 못 씀)
  2. 소리 파일 이름이 .wav 여도 내용이 MP3 면 MP3 로 읽음 (웹용으로 다시 묶은 쉐어웨어 MPQ)
  3. 없는 소리는 게임을 멈추지 않고 짧은 무음으로
  4. 메뉴 오각별 그림(ui_art\\\\focus.pcx)이 없으면 작은 오각별(focus16)로
  5. 단축키에 동시키(SHIFT+1·CTRL+ALT+A 등) — 조합 배정이 있으면 먼저, 없으면 원래처럼 키 하나
  6. 브라우저가 먼저 쓰는 F1~F12 는 배정하지 않음 — 기본값을 H·SHIFT+S·SHIFT+L·SHIFT+1~4 로, 예전 설정의 F키는 기본값으로
  7. 웹 페이지의 게임 중 단축키 화면이 키 배정을 읽고 바꾸는 함수 (dvx_keymap_json, dvx_keymap_set)
- 빌드: \`scripts/build-devilutionx.sh\` (${emcc})

| 파일 | 크기 | sha256 |
|------|------|--------|
${rows.join('\n')}
`);
// 셸의 엔진 버전 (캐시 무효화) = wasm 해시 앞 12자리
const wasmHash = createHash('sha256').update(readFileSync(join(out, 'devilutionx.wasm'))).digest('hex').slice(0, 12);
const shell = join(out, 'play.html');
writeFileSync(shell, readFileSync(shell, 'utf8').replace(/var D1X_VERSION = '[0-9a-f]*';/, `var D1X_VERSION = '${wasmHash}';`));
console.log('NOTICE.md·play.html 버전 갱신', wasmHash);
