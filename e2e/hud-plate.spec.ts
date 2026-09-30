import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 조작판 벨트 오른쪽 (x 475~635): 원작 클래식엔 800 폭 조각이 없어 원작 조각으로 만든 돌 판. 검은 빈 칸이 없어야 한다.
test('조작판 벨트 오른쪽은 검은 칸 없는 돌 판', async ({ page }) => {
  await newHero(page, uniqueName('Plate'), 'sorceress');
  await page.waitForTimeout(800);
  const dark = await page.evaluate(async () => {
    const img = await window.__game!.capture!();
    let n = 0, all = 0;
    for (let y = 553; y < 593; y++)
      for (let x = 475; x < 635; x++) {
        const i = (y * img.width + x) * 4;
        if (img.data[i]! + img.data[i + 1]! + img.data[i + 2]! <= 15) n++;
        all++;
      }
    return n / all;
  });
  console.log('[plate] dark ratio', dark.toFixed(3));
  expect(dark).toBeLessThan(0.1);
  await page.screenshot({ path: 'test-results/hud-plate.png', clip: { x: 280, y: 490, width: 400, height: 110 } });
});
