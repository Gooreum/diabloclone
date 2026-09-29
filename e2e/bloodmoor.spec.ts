import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('마을의 Blood Moor 출구로 가면 Blood Moor 로 넘어가 몬스터가 배치되어 있다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Moor'));
  await walkToBloodMoor(page);
  await page.waitForTimeout(1000);
  await page.locator('#game').screenshot({ path: 'test-results/bloodmoor-entry.png' });
  expect(await page.evaluate(() => window.__game!.game.monsters.length)).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
