import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { findViolations, scanDir } from './support/arch';

describe('엔진 순수성', () => {
  it('src/engine 은 DOM·렌더 식별자를 사용하지 않는다', () => {
    expect(scanDir(resolve(__dirname, '../src/engine'))).toEqual([]);
  });

  it('위반 소스를 검출한다', () => {
    const v = findViolations('fake.ts', 'const c = document.createElement("canvas");\nimport { x } from "../render/iso";');
    expect(v.map((x) => x.token)).toEqual(['document', 'import']);
  });

  it('주석·문자열 속 단어·속성 접근은 무시한다', () => {
    expect(findViolations('ok.ts', '// window 참조 금지\nconst s = state.window;\nconst t = "document";')).toEqual([]);
  });
});
