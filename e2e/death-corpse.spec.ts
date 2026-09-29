import { expect, test } from '@playwright/test';
import { newHero, uniqueName } from './helpers';

// Phase 7 Step 3: 죽음 → 부활 시 장착 아이템은 시체에 남고, 시체를 클릭하면 되찾는다. 골드 벌칙 (레벨 × %, 최대 20%)
// 출처: D2MOO PLAYER_ApplyDeathPenalty / D2GAME_CORPSE_Handler_6FC7FBD0
test('죽음: 시체에 장비가 남고, 시체를 클릭하면 다시 장착된다', async ({ page }) => {
  await newHero(page, uniqueName('Dead'));
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.gold = 1000;
    (g as unknown as { playerDie(): void }).playerDie();
  });
  await expect.poll(() => page.evaluate(() => window.__game!.game.isDead)).toBe(true);
  // 레벨 1: 1% 벌칙 → 10 잃고 990 은 땅에
  expect(await page.evaluate(() => window.__game!.game.gold)).toBe(0);
  expect(await page.evaluate(() => window.__game!.game.snapshot().items.filter((i) => i.code === 'gld').map((i) => i.quantity))).toEqual([990]);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game!.game.isDead)).toBe(false);
  expect(await page.evaluate(() => window.__game!.game.equipment.rarm?.code ?? null)).toBeNull();
  expect(await page.evaluate(() => window.__game!.game.snapshot().corpse?.items.map((i) => i.code).sort())).toEqual(['buc', 'hax']);
  // 시체 클릭 상자가 그려질 때까지 기다린 뒤 클릭
  const box = await expect
    .poll(() => page.evaluate(() => window.__game!.input!.pickBoxes.find((b) => b.kind === 'body') ?? null))
    .not.toBeNull()
    .then(() => page.evaluate(() => window.__game!.input!.pickBoxes.find((b) => b.kind === 'body')!));
  await page.screenshot({ path: 'test-results/death-corpse.png' });
  const canvas = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(canvas.x + box.x + box.w / 2, canvas.y + box.y + box.h / 2);
  await expect.poll(() => page.evaluate(() => window.__game!.game.equipment.rarm?.code ?? null), { timeout: 10_000 }).toBe('hax');
  expect(await page.evaluate(() => window.__game!.game.snapshot().corpse)).toBeNull();
});
