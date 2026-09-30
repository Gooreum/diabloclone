import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq') || !existsSync('game-data/d2sfx.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);

// 원작 낮·밤 (D2Environment.cpp): 새 게임은 정오 — 밤으로 돌리면 야외가 어두워지고 밤 배경음(Night Ambience)이 난다.

/** 월드 영역(조작판 위) 평균 밝기 (R+G+B) */
const lum = (page: Page) =>
  page.evaluate(async () => {
    const img = await window.__game!.capture!();
    let s = 0;
    for (let i = 0; i < 800 * 540 * 4; i += 4) s += img.data[i]! + img.data[i + 1]! + img.data[i + 2]!;
    return s / (800 * 540);
  });

/** 지금 막 환경을 밤 한가운데(270°)로 */
const toNight = (page: Page) =>
  page.evaluate(() => {
    const e = window.__game!.game.envOf();
    e.cycle = 5;
    e.period = 2;
    e.ticks = 270 * e.rate - 5;
  });

test('낮·밤: 정오로 시작, 밤이면 마을이 어두워지고 밤 배경음이 난다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Night'), 'sorceress');
  await page.mouse.click(400, 300);
  await page.waitForFunction(() => window.__audio?.unlocked === true, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => (window.__audio?.log ?? []).some((e) => e.channel === 'ambient' && e.name === 'scene_wilderness_day'), undefined, { timeout: 60_000 });
  expect(await page.evaluate(() => window.__game!.game.environment())).toEqual({ intensity: expect.any(Number), period: 0 });
  await page.waitForTimeout(800);
  const day = await lum(page);
  await page.locator('#game').screenshot({ path: 'test-results/daynight-day.png' });

  await toNight(page);
  await page.waitForFunction(() => window.__game!.game.environment().intensity <= 70, undefined, { timeout: 5000 });
  await page.waitForFunction(() => (window.__audio?.log ?? []).some((e) => e.channel === 'ambient' && e.name === 'scene_wilderness_night'), undefined, { timeout: 30_000 });
  await page.waitForTimeout(800);
  const night = await lum(page);
  console.log('[daynight] day', Math.round(day), 'night', Math.round(night));
  expect(night).toBeLessThan(day * 0.75);
  expect(night).toBeGreaterThan(day * 0.2);
  await page.locator('#game').screenshot({ path: 'test-results/daynight-night.png' });
  expect(errors).toEqual([]);
});
