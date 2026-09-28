import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 엔진은 렌더링/DOM 에 의존하지 않는 순수 모듈이어야 한다 (plan.md 아키텍처).
export const FORBIDDEN = [
  'window', 'document', 'navigator', 'localStorage', 'indexedDB', 'requestAnimationFrame',
  'HTMLElement', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'OffscreenCanvas',
  'ImageBitmap', 'ImageData', 'Image', 'AudioContext',
];
const FORBIDDEN_IMPORTS = [/from ['"][^'"]*\/(render|ui|input|audio)\//];

export interface Violation { file: string; line: number; token: string }

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
}

export function findViolations(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  stripComments(source).split('\n').forEach((text, i) => {
    for (const token of FORBIDDEN) {
      if (new RegExp(`(?<![\\w.$'"])${token}(?![\\w$])`).test(text)) out.push({ file, line: i + 1, token });
    }
    for (const re of FORBIDDEN_IMPORTS) if (re.test(text)) out.push({ file, line: i + 1, token: 'import' });
  });
  return out;
}

export function scanDir(dir: string): Violation[] {
  const out: Violation[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...scanDir(p));
    else if (p.endsWith('.ts')) out.push(...findViolations(p, readFileSync(p, 'utf8')));
  }
  return out;
}
