// 벽 반투명: 벽 뒤에 서면 플레이어를 가리는 벽이 반투명으로 그려져 캐릭터가 보이고, 트인 곳에서는 모두 불투명 (원작)
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);

test('판데모니움 요새: 벽 뒤에 서면 그 벽이 반투명으로 그려지고, 트인 곳에서는 모두 불투명', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Wall'));
  await page.waitForFunction(() => window.__game!.game.changeAct(3), undefined, { timeout: 150_000, polling: 500 });
  await page.waitForFunction(() => window.__game!.game.levelId === 'pandemonium', undefined, { timeout: 10_000 });
  await page.waitForTimeout(400);
  // 티리엘 옆(요새 위쪽 홀): 앞쪽 큰 벽이 캐릭터를 가리던 자리 — 티리엘 반경 12 서브타일 안에서 가장 많이 가려지는 걷기 가능 칸
  const tyrael = await page.evaluate(() => {
    const g = window.__game!.game, ui = window.__game!.ui!, m = g.map;
    const t = g.npcs.find((n) => n.type.id === 'tyrael2');
    if (!t) return null;
    let best: { x: number; y: number; n: number } | null = null;
    for (let y = Math.floor(t.y) - 12; y <= t.y + 12; y++)
      for (let x = Math.floor(t.x) - 12; x <= t.x + 12; x++) {
        if (!m.walkable(x, y)) continue;
        const n = ui.cover.wallsFadedAt(x + 0.5, y + 0.5);
        if (n > 0 && (!best || n > best.n)) best = { x, y, n };
      }
    if (best) g.changeLevel('pandemonium', best.x + 0.5, best.y + 0.5);
    return best;
  });
  expect(tyrael).not.toBeNull();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__game!.ui!.cover.wallsFaded())).toBe(tyrael!.n);
  await page.locator('#game').screenshot({ path: 'test-results/wall-fade-tyrael.png' });

  // 벽 뒤 자리 = 걷기 가능 + 그 자리에 서면 반투명이 될 벽이 가장 많은 곳 / 트인 자리 = 그런 벽이 없는 곳
  const spots = await page.evaluate(() => {
    const g = window.__game!.game, ui = window.__game!.ui!, m = g.map;
    let behind: { x: number; y: number; n: number } | null = null, open: { x: number; y: number } | null = null;
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        if (!m.walkable(x, y)) continue;
        const n = ui.cover.wallsFadedAt(x + 0.5, y + 0.5);
        if (n > 0 && (!behind || n > behind.n)) behind = { x, y, n };
        if (n === 0 && !open) open = { x, y };
      }
    return { behind, open };
  });
  expect(spots.behind).not.toBeNull();
  expect(spots.open).not.toBeNull();

  await page.evaluate((s) => window.__game!.game.changeLevel('pandemonium', s.x + 0.5, s.y + 0.5), spots.behind!);
  await page.waitForTimeout(400);
  const faded = await page.evaluate(() => window.__game!.ui!.cover.wallsFaded());
  expect(faded).toBeGreaterThan(0);
  expect(faded).toBe(spots.behind!.n);
  await page.locator('#game').screenshot({ path: 'test-results/wall-fade-behind.png' });

  await page.evaluate((s) => window.__game!.game.changeLevel('pandemonium', s.x + 0.5, s.y + 0.5), spots.open!);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__game!.ui!.cover.wallsFaded())).toBe(0);
  await page.locator('#game').screenshot({ path: 'test-results/wall-fade-open.png' });
  expect(errors).toEqual([]);
});
