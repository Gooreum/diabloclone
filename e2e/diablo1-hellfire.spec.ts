import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pngStats } from './png';

// 디아블로 1 헬파이어: 정식판 diabdat.mpq + 헬파이어 MPQ 4개 (GOG 설치 파일에서 꺼낸 것, game-data/diablo1-full/ — 저장소에 넣지 않음)
const FULL = resolve('game-data/diablo1-full');
const FILES = ['diabdat.mpq', 'hellfire.mpq', 'hfmonk.mpq', 'hfmusic.mpq', 'hfvoice.mpq'].map((n) => resolve(FULL, n));
test.skip(!FILES.every((f) => existsSync(f)), 'game-data/diablo1-full/ 에 diabdat.mpq + 헬파이어 MPQ 4개 필요');

const look = async (page: Page) => pngStats(await page.screenshot());
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/diablo1-hellfire-${name}.png` });

test('정식판 + 헬파이어 파일을 넣으면 Hellfire 를 골라 몽크로 마을에 들어간다 (실제 키·마우스)', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?local&files');
  await page.evaluate(() => Promise.all(['diabloclone-mpq', '/libsdl/diasurgical'].map((n) => new Promise((r) => {
    const q = indexedDB.deleteDatabase(n);
    q.onsuccess = q.onerror = q.onblocked = r;
  }))));
  await page.goto('/?local');
  await page.locator('#mpq-setup [data-input="files"]').setInputFiles(FILES);
  await expect(page.locator('#mpq-setup .edition')).toHaveText('디아블로 1 (정식판) 으로 시작합니다', { timeout: 120_000 });
  await expect(page.locator('#mpq-setup li.ok', { hasText: 'hellfire.mpq' })).toHaveCount(1);
  await page.click('#mpq-setup [data-start]');
  await page.waitForFunction(() => window.__d1?.ready === true || (window.__d1?.errors.length ?? 0) > 0, undefined, { timeout: 180_000 });
  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);

  // 엔진 파일 시스템에 헬파이어가 들어갔다
  const f = page.frame({ url: /d1x\/play\.html/ })!;
  const sizes = await f.evaluate(() => ['/diabdat.mpq', '/hellfire.mpq', '/hfmonk.mpq', '/hfmusic.mpq', '/hfvoice.mpq']
    .map((p) => (window as unknown as { FS: { stat(p: string): { size: number } } }).FS.stat(p).size));
  expect(sizes.every((s) => s > 30_000_000)).toBe(true);

  // DevilutionX 가 헬파이어를 찾고 묻는다: Enter Hellfire / Switch to Diablo
  await page.waitForTimeout(5000);
  await shot(page, '1-choose');
  await page.mouse.click(400, 300);
  await page.keyboard.press('Enter');
  // 헬파이어 로고·인트로 영상 넘기기 → 메인 메뉴
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(3000);
  await shot(page, '2-menu');
  // Single Player → 직업 고르기 (전사·도적·원소술사·몽크)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await shot(page, '3-classes');
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(400);
  }
  await shot(page, '4-monk');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await page.keyboard.type('Monk');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await look(page)).lit, { timeout: 90_000 }).toBeGreaterThan(0.3);
  await page.waitForTimeout(3000);
  await shot(page, '5-town');
  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);
  expect(errors).toEqual([]);
});
