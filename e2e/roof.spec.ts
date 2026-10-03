// 지붕 숨김: 건물 안에 서면 그 건물 지붕이 사라지고(캐릭터가 보인다), 밖으로 나오면 다시 그린다 (원작)
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('루트 골레인: 집 안에 서면 그 건물 지붕이 사라지고, 밖으로 나오면 다시 그린다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Roof'));
  await page.waitForFunction(() => window.__game!.game.changeAct(1), undefined, { timeout: 150_000, polling: 500 });
  await page.waitForFunction(() => window.__game!.game.levelId === 'lutgholein', undefined, { timeout: 10_000 });
  await page.waitForTimeout(400);
  // 시작 위치(광장)는 지붕 밖
  expect(await page.evaluate(() => window.__game!.ui!.cover.groupAt(window.__game!.game.snapshot().player.x, window.__game!.game.snapshot().player.y))).toBe(0);
  expect(await page.evaluate(() => window.__game!.ui!.cover.roofsHidden())).toBe(0);
  await page.locator('#game').screenshot({ path: 'test-results/roof-outside.png' });

  // 지붕 아래의 걷기 가능한 서브타일로 옮긴다 (레벨 안 첫 번째 건물)
  const inside = await page.evaluate(() => {
    const g = window.__game!.game, ui = window.__game!.ui!, m = g.map;
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++)
        if (m.walkable(x, y) && ui.cover.groupAt(x, y) > 0) {
          g.changeLevel('lutgholein', x + 0.5, y + 0.5);
          return { x, y, group: ui.cover.groupAt(x, y) };
        }
    return null;
  });
  expect(inside).not.toBeNull();
  await page.waitForTimeout(400);
  const hidden = await page.evaluate(() => window.__game!.ui!.cover.roofsHidden());
  expect(hidden).toBeGreaterThan(0);
  // 다른 건물 지붕은 그대로 (루트 골레인 지붕 189장 중 일부만 숨긴다)
  expect(hidden).toBeLessThan(189);
  await page.locator('#game').screenshot({ path: 'test-results/roof-inside.png' });

  // 다시 밖으로: 지붕 없는 걷기 가능한 칸
  const outside = await page.evaluate(() => {
    const g = window.__game!.game, ui = window.__game!.ui!, m = g.map;
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++)
        if (m.walkable(x, y) && ui.cover.groupAt(x, y) === 0) {
          g.changeLevel('lutgholein', x + 0.5, y + 0.5);
          return true;
        }
    return false;
  });
  expect(outside).toBe(true);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__game!.ui!.cover.roofsHidden())).toBe(0);
  expect(errors).toEqual([]);
});
