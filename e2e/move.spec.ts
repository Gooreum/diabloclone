import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('캔버스 좌클릭 → 플레이어가 그 방향으로 이동', async ({ page }) => {
  await newHero(page, uniqueName('Move'));
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => window.__game!.game.snapshot().player);
  await page.mouse.click(400 + 120, 300 + 60);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__game!.game.snapshot().player);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(2);
  expect(after.x - before.x).toBeGreaterThan(0);
});
