import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';

const hasData = existsSync('game-data/d2data.mpq');

test.skip(!hasData, '원작 game-data 필요');

test('Rogue Encampment 가 원작 타일로 렌더링된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
  const ratio = await page.evaluate(() => {
    const c = document.getElementById('game') as HTMLCanvasElement;
    const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 30) lit++;
    return lit / (c.width * c.height);
  });
  await page.locator('#game').screenshot({ path: 'test-results/town-render.png' });
  expect(errors).toEqual([]);
  expect(ratio).toBeGreaterThan(0.3);
});
