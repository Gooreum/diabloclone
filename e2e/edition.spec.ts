import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chooseDifficulty, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2exp.mpq') || !existsSync('game-data/lod/patch_d2.mpq'), '원작 확장팩 game-data 필요 (game-data/d2exp.mpq, game-data/lod/)');

// 판본: 고른 파일에 d2exp.mpq 가 있으면 확장팩, 없으면 클래식. 확장팩 설치 폴더에는 클래식 파일도 함께 있다.
// dev 서버는 /d2x/ (확장팩) 가 기본, ?edition=classic 이면 /d2/ (클래식).

async function enterTown(page: Page, shot: string): Promise<void> {
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.click('#btn-sorceress');
  await page.fill('#hero-name', uniqueName('Ed'));
  await page.click('#btn-ok');
  await chooseDifficulty(page);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForTimeout(1500);
  const lit = await page.evaluate(async () => {
    const img = await window.__game!.capture!();
    let n = 0;
    for (let i = 0; i < 800 * 540 * 4; i += 4) if (img.data[i]! + img.data[i + 1]! + img.data[i + 2]! > 30) n++;
    return n / (800 * 540);
  });
  expect(lit).toBeGreaterThan(0.3);
  await page.locator('#game').screenshot({ path: `test-results/${shot}.png` });
}

for (const [q, edition] of [['/', 'lod'], ['/?edition=classic', 'classic']] as const) {
  test(`dev ${q} → ${edition} 판본으로 마을까지`, async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(q);
    await page.waitForFunction(() => window.__edition !== undefined, undefined, { timeout: 90_000 });
    expect(await page.evaluate(() => window.__edition)).toBe(edition);
    await enterTown(page, `edition-${edition}-town`);
    expect(errors).toEqual([]);
  });
}

test('배포판 흐름: 클래식 파일만 고르면 클래식, 확장팩 폴더를 고르면 확장팩으로 시작', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?local');
  await expect(page.locator('#mpq-setup')).toBeVisible();
  const pick = async (paths: string[]) => {
    await page.locator('#mpq-setup [data-input="files"]').setInputFiles(paths.map((p) => resolve('game-data', p)));
    await expect(page.locator('#mpq-setup .status')).not.toContainText('저장 중', { timeout: 120_000 });
  };

  await pick(['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq']);
  await expect(page.locator('#mpq-setup .edition')).toContainText('클래식으로 시작');
  await expect(page.locator('#mpq-setup [data-start]')).toBeEnabled();

  // 확장팩 설치 폴더의 파일 (patch_d2·d2char 는 확장팩판) — 같은 이름은 덮어쓴다
  await pick(['lod/patch_d2.mpq', 'lod/d2char.mpq', 'd2exp.mpq']);
  await expect(page.locator('#mpq-setup .edition')).toContainText('확장팩');
  await page.screenshot({ path: 'test-results/edition-setup-lod.png' });
  await page.click('#mpq-setup [data-start]');
  await page.waitForFunction(() => window.__edition !== undefined, undefined, { timeout: 90_000 });
  expect(await page.evaluate(() => window.__edition)).toBe('lod');
  await enterTown(page, 'edition-local-lod-town');
  expect(errors).toEqual([]);
});
