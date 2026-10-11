import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkSpawn, SPAWN_SIZES } from '../../scripts/fetch-d1-spawn.mjs';

const VENDOR = resolve(__dirname, '../../src/d1/vendor');
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('디아블로 1 반입본 (Devilution 웹 빌드)', () => {
  it('NOTICE.md 표의 sha256·크기와 실제 파일이 같다', () => {
    const notice = readFileSync(resolve(VENDOR, 'NOTICE.md'), 'utf8');
    const rows = [...notice.matchAll(/^\| `([^`]+)` \| [^|]+ \| (\d+) \| `([0-9a-f]{64})` \|$/gm)];
    expect(rows.map((r) => r[1])).toEqual(['Diablo.wasm', 'DiabloSpawn.wasm', 'Diablo.jscc', 'DiabloSpawn.jscc']);
    for (const [, name, size, hash] of rows) {
      const p = resolve(VENDOR, name!);
      expect(statSync(p).size, name).toBe(Number(size));
      expect(sha256(p), name).toBe(hash);
    }
  });

  it('글루는 UMD (module.exports = Diablo) 이고 전역 DApi 를 부른다', () => {
    for (const name of ['Diablo.jscc', 'DiabloSpawn.jscc']) {
      const src = readFileSync(resolve(VENDOR, name), 'utf8');
      expect(src).toContain('module.exports = Diablo');
      expect(src).toContain('self.DApi.draw_blit(');
      expect(src).toContain('Module["_DApi_Render"]');
    }
  });

  it('쉐어웨어 spawn.mpq 검사: 크기가 다르거나 헤더가 아니면 거절', () => {
    expect(() => checkSpawn(new Uint8Array(10))).toThrow(/크기/);
    const wrong = new Uint8Array(SPAWN_SIZES[1]!);
    expect(() => checkSpawn(wrong)).toThrow(/헤더/);
    wrong.set([0x4d, 0x50, 0x51, 0x1a]);
    expect(checkSpawn(wrong)).toBe(true);
  });

  it('THIRD_PARTY_NOTICES 에 Devilution 절이 있고 기존 절은 그대로다', () => {
    const notices = readFileSync(resolve(__dirname, '../../THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('## D2MOO');
    expect(notices).toContain('## OpenDiablo2');
    expect(notices).toContain('## Devilution 웹 빌드');
    expect(notices).toMatch(/비상업/);
  });
});
