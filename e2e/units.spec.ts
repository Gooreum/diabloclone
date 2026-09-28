import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('Blood Moor 몬스터를 좌클릭하면 다가가서 공격한다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Unit'));
  await walkToBloodMoor(page);
  const id = await page.evaluate(() => {
    const g = window.__game!.game;
    const p = g.snapshot().player;
    return g.spawnMonster('fallen1', p.x + 6, p.y + 1).id;
  });
  await page.waitForFunction((mid) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'monster' && b.id === mid), id, { timeout: 10_000 });
  await page.waitForTimeout(700); // 원작 DCC 스프라이트 로딩 대기 (스크린샷용)
  await page.locator('#game').screenshot({ path: 'test-results/units.png' });
  const box = await page.evaluate((mid) => window.__game!.input!.pickBoxes.find((b) => b.kind === 'monster' && b.id === mid)!, id);
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await page.waitForFunction(() => window.__game!.game.snapshot().player.mode === 'A1', undefined, { timeout: 10_000 });
  expect(errors).toEqual([]);
});
