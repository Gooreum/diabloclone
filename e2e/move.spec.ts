import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('캔버스 좌클릭 → 플레이어가 그 방향으로 이동', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.locator('#game').screenshot({ path: 'test-results/player-idle.png' });
  const before = await page.evaluate(() => window.__game!.game.snapshot().player);
  // 화면 중앙(플레이어)에서 오른쪽 아래 → 월드 +x 방향
  await page.mouse.click(400 + 120, 300 + 60);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__game!.game.snapshot().player);
  await page.locator('#game').screenshot({ path: 'test-results/player-moved.png' });
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(2);
  expect(after.x - before.x).toBeGreaterThan(0);
});
