import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pngStats } from './png';

// 디아블로 1 = DevilutionX 웹 빌드 (public/d1x) 를 iframe 으로. 원작 데이터: 쉐어웨어 spawn.mpq (`npm run fetch-d1` → game-data/diablo1/)
const SPAWN = resolve('game-data/diablo1/spawn.mpq');
test.skip(!existsSync(SPAWN), 'game-data/diablo1/spawn.mpq 필요 (npm run fetch-d1)');
const SPAWN_URL = 'https://d07riv.github.io/diabloweb/spawn.mpq';

const look = async (page: Page) => pngStats(await page.screenshot());

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__d1?.ready === true || (window.__d1?.errors.length ?? 0) > 0, undefined, { timeout: 120_000 });
  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);
  await expect(page.locator('#d1-frame')).toBeVisible();
}

/** 화면이 바뀔 때까지 (메뉴 넘김·이동 확인) */
async function changedFrom(page: Page, hash: number, timeout = 20_000): Promise<void> {
  await expect.poll(async () => (await look(page)).hash, { timeout }).not.toBe(hash);
}

/** DevilutionX 세이브(IDBFS /libsdl/diasurgical) 경로들 */
async function savedFiles(page: Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((res) => {
    const q = indexedDB.open('/libsdl/diasurgical');
    q.onsuccess = () => {
      const db = q.result;
      if (!db.objectStoreNames.contains('FILE_DATA')) return res([]);
      const k = db.transaction('FILE_DATA').objectStore('FILE_DATA').getAllKeys();
      k.onsuccess = () => res(k.result.map(String));
      k.onerror = () => res([]);
    };
    q.onerror = () => res([]);
  }));
}

async function clearAll(page: Page): Promise<void> {
  await page.goto('/?local&files');
  await page.evaluate(() => Promise.all(['diabloclone-mpq', '/libsdl/diasurgical'].map((n) => new Promise((r) => {
    const q = indexedDB.deleteDatabase(n);
    q.onsuccess = q.onerror = q.onblocked = r;
  }))));
}

async function serveSpawn(page: Page): Promise<{ hits: number }> {
  const counter = { hits: 0 };
  const body = readFileSync(SPAWN);
  await page.route(SPAWN_URL, (r) => {
    counter.hits++;
    return r.fulfill({ status: 200, body, headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' } });
  });
  return counter;
}

test('?d1: 타이틀 → 메뉴 → 전사 만들기 → 트리스트럼에서 걷기, 새로고침해도 영웅이 남는다 (실제 키·마우스)', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await clearAll(page);
  await page.goto('/?d1');
  await waitReady(page);
  await page.waitForTimeout(6000);
  const title = await look(page);
  await page.screenshot({ path: 'test-results/diablo1-title.png' });
  expect(title.lit).toBeGreaterThan(0.05);
  // 타이틀 넘기기 → 메인 메뉴
  await page.mouse.click(400, 300);
  await changedFrom(page, title.hash);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/diablo1-menu.png' });
  // Single Player → 영웅이 없으면 직업 고르기 → Warrior → 이름 → 난이도 Normal → 마을
  for (const k of ['Enter', 'Enter', 'Enter']) {
    await page.keyboard.press(k);
    await page.waitForTimeout(1800);
  }
  await page.keyboard.type('Aidan');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await look(page)).lit, { timeout: 60_000 }).toBeGreaterThan(0.3);
  await page.waitForTimeout(3000);
  const town = await look(page);
  await page.screenshot({ path: 'test-results/diablo1-town.png' });
  // 클릭한 곳으로 걸어간다 (화면이 따라 움직인다)
  await page.mouse.click(560, 260);
  await changedFrom(page, town.hash, 10_000);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/diablo1-walk.png' });
  // 세이브가 브라우저에 (DevilutionX IDBFS)
  await expect.poll(() => savedFiles(page), { timeout: 60_000 }).toContainEqual(expect.stringMatching(/spawn_0\.sv$/));
  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe('브라우저 언어가 한국어여도', () => {
  test.use({ locale: 'ko-KR' });
  test('영어로 시작해 글꼴 파일(fonts.mpq) 없이 메뉴까지 간다', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/?d1');
    await waitReady(page);
    await page.waitForTimeout(6000);
    await page.mouse.click(400, 300);
    await page.waitForTimeout(3000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => window.__d1!.log.filter((l) => /fonts\.mpq/i.test(l)))).toEqual([]);
    await page.screenshot({ path: 'test-results/diablo1-ko-locale.png' });
  });
});

test('파일 없이 ?d1: 고르기 화면 없이 쉐어웨어를 받아 시작하고, 다음엔 받지 않는다', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const remote = await serveSpawn(page);
  await clearAll(page);
  await page.goto('/?local&d1');
  await expect(page.locator('#mpq-setup')).toHaveCount(0);
  await waitReady(page);
  expect(remote.hits).toBe(1);
  await page.reload();
  await waitReady(page);
  expect(remote.hits).toBe(1);
  await page.waitForTimeout(5000);
  expect((await look(page)).lit).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});

test('파일 없이 첫 화면: "디아블로 1 바로 하기" 단추 한 번으로 시작, 나가기로 돌아온다', async ({ page }) => {
  test.setTimeout(300_000);
  await serveSpawn(page);
  await clearAll(page);
  await page.goto('/?local');
  await page.click('#mpq-setup [data-play-d1]');
  await waitReady(page);
  await page.click('#btn-d1-exit');
  await expect(page.locator('#d1-frame')).toHaveCount(0);
  await expect(page.locator('#mpq-setup')).toBeVisible({ timeout: 30_000 });
});

test('배포판 파일 고르기: spawn.mpq 하나만 넣어도 디아블로 1 로 시작한다', async ({ page }) => {
  test.setTimeout(300_000);
  await clearAll(page);
  await page.goto('/?local');
  await page.locator('#mpq-setup [data-input="files"]').setInputFiles(SPAWN);
  await expect(page.locator('#mpq-setup .edition')).toHaveText('디아블로 1 (쉐어웨어) 으로 시작합니다', { timeout: 60_000 });
  await page.click('#mpq-setup [data-start]');
  await waitReady(page);
});

test('D2 타이틀의 "Diablo I" 단추로 디아블로 1 을 띄운다', async ({ page }) => {
  test.skip(!existsSync('game-data/d2data.mpq'), 'Diablo II game-data 필요');
  test.setTimeout(300_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 120_000 });
  await page.click('#btn-diablo1');
  await waitReady(page);
  await expect(page.locator('#menu')).toHaveCount(0);
});

test('받기 실패: 오류 글과 다시 시작 단추, 페이지 오류 없음', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(SPAWN_URL, (r) => r.fulfill({ status: 500, body: 'x' }));
  await clearAll(page);
  await page.goto('/?local&d1');
  await page.waitForFunction(() => (window.__d1?.errors.length ?? 0) > 0, undefined, { timeout: 60_000 });
  await expect(page.locator('#d1-status')).toContainText('받지 못했습니다');
  await expect(page.locator('#d1-status button')).toHaveText('다시 시작');
  expect(errors).toEqual([]);
});
