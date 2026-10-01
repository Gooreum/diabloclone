import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chooseDifficulty, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 확장팩 직업 드루이드·어쌔신 (원작 LoD): 확장팩 판본 만들기 화면에 7직업, 확장팩 직업은 늘 확장팩 캐릭터.
// 클래식 판본(D2_EDITION=classic)은 두 직업 단추가 없다.

async function openCreate(page: Page): Promise<string> {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  const edition = await page.evaluate(() => window.__edition ?? 'classic');
  await page.click('#btn-single');
  await page.click('#btn-create');
  return edition;
}

async function create(page: Page, cls: 'druid' | 'assassin', name: string): Promise<void> {
  await page.click(`#btn-${cls}`);
  await page.fill('#hero-name', name);
  // 체크를 끄려 해도 확장팩 직업은 켜진 채 (원작 LoD)
  await page.click('#chk-expansion');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `test-results/expansion-classes-create-${cls}.png` });
  await page.click('#btn-ok');
  await chooseDifficulty(page);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1, undefined, { timeout: 30_000 });
}

test('확장팩 판본: 만들기 화면에 드루이드·어쌔신, 어쌔신은 확장팩 캐릭터로 시작', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip((await openCreate(page)) !== 'lod', '확장팩 서버에서만');
  for (const c of ['amazon', 'sorceress', 'necromancer', 'paladin', 'barbarian', 'druid', 'assassin']) await expect(page.locator(`#btn-${c}`)).toHaveCount(1);
  await create(page, 'assassin', uniqueName('As'));
  expect(await page.evaluate(() => [window.__game!.game.character!.cls, window.__game!.game.expansion])).toEqual(['Assassin', true]);
  expect(errors).toEqual([]);
});

test('클래식 판본: 드루이드·어쌔신 단추가 없다', async ({ page }) => {
  test.skip((await openCreate(page)) !== 'classic', '클래식 서버에서만');
  await expect(page.locator('#btn-barbarian')).toHaveCount(1);
  await expect(page.locator('#btn-druid')).toHaveCount(0);
  await expect(page.locator('#btn-assassin')).toHaveCount(0);
});
