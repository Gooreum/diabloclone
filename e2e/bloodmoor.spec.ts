import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('마을 동쪽 출구로 가면 Blood Moor 로 넘어가 원작 타일·몬스터가 보인다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 90_000 });
  await page.waitForTimeout(800);
  await page.locator('#game').screenshot({ path: 'test-results/town-start.png' });
  // 동쪽 출구 근처로 순간 이동 후 출구로 걸어간다 (출구 판정은 엔진 규칙 그대로)
  await page.evaluate(() => {
    const g = window.__game!.game;
    const m = g.map;
    let y = 100;
    for (let yy = 30; yy < m.height - 30; yy++) if (m.walkable(m.width - 8, yy) && m.walkable(m.width - 2, yy)) { y = yy; break; }
    g.changeLevel('town', m.width - 8.5, y + 0.5);
    g.enqueue({ type: 'move', x: m.width - 1.5, y: y + 0.5, run: true });
  });
  await page.waitForFunction(() => window.__game!.game.levelId === 'bloodmoor', undefined, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.locator('#game').screenshot({ path: 'test-results/bloodmoor-entry.png' });
  const n = await page.evaluate(() => window.__game!.game.monsters.length);
  expect(n).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
