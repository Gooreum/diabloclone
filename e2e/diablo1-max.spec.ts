import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hero } from './d1-hero';
import { pngStats } from './png';

// 디아블로 1 "★ 최강": 지금 영웅을 최대 레벨·스탯·주문 15·직업별 최고 장비로 (엔진 dvx_max_hero)
const SPAWN = resolve('game-data/diablo1/spawn.mpq');
test.skip(!existsSync(SPAWN), 'game-data/diablo1/spawn.mpq 필요 (npm run fetch-d1)');
const SPAWN_URL = 'https://d07riv.github.io/diabloweb/spawn.mpq';

type Rt = { Module: { ccall(n: string, r: string, t: string[], a: string[]): string | number } };

const look = async (page: Page) => pngStats(await page.screenshot());

test('★ 최강: 메뉴에선 아무것도 안 하고, 마을의 전사는 레벨 50·최대 스탯·주문 15·장비 7칸이 된다', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?local&files');
  await page.evaluate(() => Promise.all(['diabloclone-mpq', '/libsdl/diasurgical'].map((n) => new Promise((r) => {
    const q = indexedDB.deleteDatabase(n);
    q.onsuccess = q.onerror = q.onblocked = r;
  }))));
  const body = readFileSync(SPAWN);
  await page.route(SPAWN_URL, (r) => r.fulfill({ status: 200, body, headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' } }));
  await page.goto('/?d1');
  await page.waitForFunction(() => window.__d1?.ready === true || (window.__d1?.errors.length ?? 0) > 0, undefined, { timeout: 120_000 });
  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);
  await page.waitForTimeout(6000);

  // 게임 밖(타이틀)에서는 0 — 단추도 "게임 안에서 눌러요"
  const f = page.frame({ url: /d1x\/play\.html/ })!;
  expect(await f.evaluate(() => (window as unknown as Rt).Module.ccall('dvx_max_hero', 'number', [], []))).toBe(0);
  await page.click('#btn-d1-max');
  await expect(page.locator('#btn-d1-max')).toHaveText('게임 안에서 눌러요');

  const title = await look(page);
  await page.mouse.click(400, 300);
  await expect.poll(async () => (await look(page)).hash, { timeout: 20_000 }).not.toBe(title.hash);
  await page.waitForTimeout(2000);
  for (const k of ['Enter', 'Enter', 'Enter']) {
    await page.keyboard.press(k);
    await page.waitForTimeout(1800);
  }
  await page.keyboard.type('Max');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await look(page)).lit, { timeout: 60_000 }).toBeGreaterThan(0.3);
  await page.waitForTimeout(3000);

  const before = (await hero(page))!;
  expect(before.level).toBe(1);
  await page.click('#btn-d1-max');
  await expect(page.locator('#btn-d1-max')).toHaveText('★ 완료', { timeout: 30_000 });
  const h = (await hero(page))!;
  console.log(JSON.stringify(h));
  expect([h.level, h.str, h.dex]).toEqual([50, 250, 60]);
  expect(h.mag).toBeGreaterThan(before.mag);
  expect(h.spell15).toBeGreaterThan(0);
  // 투구·반지 2·목걸이·무기·방패·갑옷 (loc: 1 한손, 3 갑옷, 4 투구, 5 반지, 6 목걸이)
  expect(h.equip.map((e) => e.loc).sort()).toEqual([1, 1, 3, 4, 5, 5, 6]);
  expect(h.equip.every((e) => e.name.length > 0)).toBe(true);

  await page.locator('#d1-frame').focus();
  await page.keyboard.press('i');
  await page.waitForTimeout(800);
  await page.keyboard.press('c');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/diablo1-max-warrior.png' });
  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);
  expect(errors).toEqual([]);
});
