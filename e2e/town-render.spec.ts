import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('새 캐릭터로 시작하면 Rogue Encampment 가 원작 타일로 렌더링된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Town'));
  await page.waitForTimeout(800);
  const ratio = await page.evaluate(async () => {
    // 월드(WebGL)와 UI 를 합성한 화면
    const img = await window.__game!.capture!();
    const d = img.data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 30) lit++;
    return lit / (img.width * img.height);
  });
  await page.locator('#game').screenshot({ path: 'test-results/town-render.png' });
  expect(errors).toEqual([]);
  expect(ratio).toBeGreaterThan(0.3);
  expect(await page.evaluate(() => window.__game!.game.levelId)).toBe('town');
});
