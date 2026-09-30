import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chooseDifficulty, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 배포판 흐름: 서버에 원작 MPQ 가 없으니 첫 접속 때 유저가 자기 MPQ 를 고르고, 브라우저(IndexedDB)에 보관해 다음부터 바로 시작.
// dev 서버에서는 ?local 로 같은 흐름을 탄다.

const mpq = (n: string) => resolve('game-data', n);
const ALL = ['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq', 'd2sfx.mpq', 'd2speech.mpq', 'd2music.mpq'];

async function pick(page: Page, names: string[]): Promise<void> {
  await page.locator('#mpq-setup [data-input="files"]').setInputFiles(names.map(mpq));
  await expect(page.locator('#mpq-setup .status')).not.toContainText('저장 중', { timeout: 120_000 });
}

test('MPQ 고르기 → 원작 그대로 플레이 → 새로고침하면 바로 시작', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?local');
  await expect(page.locator('#mpq-setup')).toBeVisible();
  await expect(page.locator('#mpq-setup [data-start]')).toBeDisabled();

  // 필수 d2data.mpq 가 빠지면 이름을 알려주고 시작할 수 없다
  await pick(page, ['patch_d2.mpq', 'd2char.mpq']);
  await expect(page.locator('#mpq-setup .status')).toContainText('d2data.mpq');
  await expect(page.locator('#mpq-setup [data-start]')).toBeDisabled();
  await page.screenshot({ path: 'test-results/local-mpq-setup.png' });

  // 나머지를 고르면 준비 완료 → 시작 → 메뉴
  await pick(page, ['d2data.mpq', 'd2sfx.mpq', 'd2speech.mpq', 'd2music.mpq']);
  await expect(page.locator('#mpq-setup .status')).toHaveText('준비 완료');
  await expect(page.locator('#mpq-setup li.ok')).toHaveCount(ALL.length);
  await page.click('#mpq-setup [data-start]');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });

  // 새 캐릭터 → 마을: 월드가 그려지고 원작 소리(마을 음악, d2music.mpq)가 난다
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.click('#btn-sorceress');
  await page.fill('#hero-name', uniqueName('Loc'));
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
  await page.mouse.click(400, 300);
  await page.waitForFunction(
    () => (window.__audio?.log ?? []).some((e) => e.channel === 'music' && e.name === 'music_town_1' && e.state === 'playing'),
    undefined,
    { timeout: 90_000 },
  );
  await page.locator('#game').screenshot({ path: 'test-results/local-mpq-town.png' });

  // 새로고침: 보관된 파일로 고르는 화면 없이 바로 메뉴
  await page.reload();
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await expect(page.locator('#mpq-setup')).toHaveCount(0);
  expect(errors).toEqual([]);
});
