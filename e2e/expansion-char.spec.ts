import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chooseDifficulty, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2exp.mpq') || !existsSync('game-data/lod/patch_d2.mpq'), '원작 확장팩 game-data 필요');

// 확장팩 캐릭터 (원작 LoD "Expansion Character"): 만들기 화면 체크(기본 켬) → 선택 화면 초록 표시 → 확장팩 데이터로 게임.
// 클래식 서버(D2_EDITION=classic)는 이 spec 의 판본 시나리오를 건너뛴다 (__edition 으로 확인).

async function create(page: Page, name: string, expansion: boolean): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.click('#btn-sorceress');
  await page.fill('#hero-name', name);
  await expect(page.locator('#chk-expansion')).toBeVisible();
  if (!expansion) await page.click('#chk-expansion');
  await page.screenshot({ path: `test-results/expansion-create-${expansion ? 'on' : 'off'}.png` });
  await page.click('#btn-ok');
  await chooseDifficulty(page);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1, undefined, { timeout: 30_000 });
}

async function saveExit(page: Page): Promise<void> {
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 60_000 });
}

test('확장팩 캐릭터: 체크 기본 켬 → 확장팩 데이터 → 선택 화면에 Expansion Character', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('Xp');
  await create(page, name, true);
  expect(await page.evaluate(() => window.__game!.game.expansion)).toBe(true);
  await saveExit(page);
  expect((await page.evaluate((n) => window.__heroStore!.load(n), name))?.expansion).toBe(true);
  // 선택 화면: 그 영웅 칸이 보이고, 초록 글자 줄이 그려진다 (스크린샷)
  await page.click('#btn-single');
  await expect(page.locator(`#hero-${name}`)).toHaveCount(1);
  await page.screenshot({ path: 'test-results/expansion-select.png' });
  expect(errors).toEqual([]);
});

test('체크를 끄면 클래식 캐릭터 (확장팩 판본에서도)', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('Cl');
  await create(page, name, false);
  expect(await page.evaluate(() => window.__game!.game.expansion)).toBe(false);
  await saveExit(page);
  expect((await page.evaluate((n) => window.__heroStore!.load(n), name))?.expansion).toBeUndefined();
  expect(errors).toEqual([]);
});

test('클래식 판본(D2_EDITION=classic 서버): 만들기 화면에 체크 상자가 없다', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  test.skip((await page.evaluate(() => window.__edition)) !== 'classic', '클래식 서버에서만 (D2_EDITION=classic)');
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.click('#btn-sorceress');
  await expect(page.locator('#chk-expansion')).toHaveCount(0);
});
