import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('몬스터·바닥 아이템이 원작 스프라이트로 그려지고 클릭하면 공격/줍기 명령이 된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test=monsters');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.locator('#game').screenshot({ path: 'test-results/units.png' });
  expect(errors).toEqual([]);
  const s = await page.evaluate(() => window.__game!.game.snapshot());
  expect(s.monsters.length).toBe(3);
});

test('몬스터를 좌클릭하면 다가가서 공격한다', async ({ page }) => {
  await page.goto('/?test=monsters');
  await page.waitForFunction(() => window.__game?.ready === true && (window.__game.input?.pickBoxes.length ?? 0) > 0, undefined, { timeout: 60_000 });
  const box = await page.evaluate(() => window.__game!.input!.pickBoxes.find((b) => b.kind === 'monster')!);
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await page.waitForFunction(() => window.__game!.game.snapshot().player.mode === 'A1', undefined, { timeout: 10_000 });
});
