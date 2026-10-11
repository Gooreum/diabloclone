import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

// 전체화면: 오른쪽 위 단추 · Alt+Enter (D2·D1 공통, src/ui/fullscreen.ts)

const isFull = (page: Page) => page.evaluate(() => !!document.fullscreenElement);
/** 무대가 화면에 그려진 크기 */
const box = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())!;

test('D1: 단추로 전체화면 켜고 끄기, 무대가 커지고 게임 입력으로 새지 않는다', async ({ page }) => {
  test.skip(!existsSync('game-data/diablo1/spawn.mpq'), 'game-data/diablo1/spawn.mpq 필요');
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?d1');
  await page.waitForFunction(() => window.__d1?.ready === true, undefined, { timeout: 120_000 });
  await expect(page.locator('#btn-fullscreen')).toBeVisible();
  const before = await box(page, '#d1-canvas');
  await page.click('#btn-fullscreen');
  await expect.poll(() => isFull(page)).toBe(true);
  await page.waitForTimeout(500);
  const after = await box(page, '#d1-canvas');
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  // 4:3 비율 유지로 화면 높이(또는 너비)를 꽉 채운다
  expect(Math.max(after.width / vp.w, after.height / vp.h)).toBeGreaterThan(0.99);
  expect(after.width / after.height).toBeCloseTo(4 / 3, 2);
  expect(after.width).toBeGreaterThanOrEqual(before.width);
  await page.locator('#d1-canvas').screenshot({ path: 'test-results/fullscreen-d1.png' });
  await page.click('#btn-fullscreen');
  await expect.poll(() => isFull(page)).toBe(false);
  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);
  expect(errors).toEqual([]);
});

test('D1: Alt+Enter 로 전체화면 켜고 끄기', async ({ page }) => {
  test.skip(!existsSync('game-data/diablo1/spawn.mpq'), 'game-data/diablo1/spawn.mpq 필요');
  test.setTimeout(180_000);
  await page.goto('/?d1');
  await page.waitForFunction(() => window.__d1?.ready === true, undefined, { timeout: 120_000 });
  await page.keyboard.press('Alt+Enter');
  await expect.poll(() => isFull(page)).toBe(true);
  await page.keyboard.press('Alt+Enter');
  await expect.poll(() => isFull(page)).toBe(false);
});

test('D2 타이틀: 단추로 전체화면, 무대 4:3 유지', async ({ page }) => {
  test.skip(!existsSync('game-data/d2data.mpq'), 'Diablo II game-data 필요');
  test.setTimeout(180_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 120_000 });
  await page.click('#btn-fullscreen');
  await expect.poll(() => isFull(page)).toBe(true);
  await page.waitForTimeout(500);
  const b = await box(page, '#stage');
  expect(b.width / b.height).toBeCloseTo(4 / 3, 2);
  await page.screenshot({ path: 'test-results/fullscreen-d2.png' });
  await page.click('#btn-fullscreen');
  await expect.poll(() => isFull(page)).toBe(false);
});

test('마우스가 멈추면 단추가 흐려지고, 움직이면 다시 보인다', async ({ page }) => {
  await page.goto('/?local');
  await expect(page.locator('#btn-fullscreen')).toBeVisible();
  await page.mouse.move(200, 200);
  await expect(page.locator('#btn-fullscreen')).toHaveClass(/idle/, { timeout: 5000 });
  await page.mouse.move(300, 300);
  await expect(page.locator('#btn-fullscreen')).not.toHaveClass(/idle/);
});
