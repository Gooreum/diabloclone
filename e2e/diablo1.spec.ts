import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 디아블로 1 (Devilution 웹 빌드). 원작 데이터는 쉐어웨어 spawn.mpq — `npm run fetch-d1` 로 game-data/diablo1/ 에 받는다
const SPAWN = resolve('game-data/diablo1/spawn.mpq');
test.skip(!existsSync(SPAWN), 'game-data/diablo1/spawn.mpq 필요 (npm run fetch-d1)');

/** 캔버스에서 밝은 픽셀 비율과 간단한 해시 */
async function look(page: Page): Promise<{ lit: number; hash: number }> {
  return page.evaluate(() => {
    const c = document.getElementById('d1-canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let lit = 0, hash = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! + d[i + 1]! + d[i + 2]! > 60) lit++;
      hash = (hash * 31 + d[i]! + d[i + 1]! * 7 + d[i + 2]! * 13) | 0;
    }
    return { lit: lit / (c.width * c.height), hash };
  });
}

/** 640×480 게임 좌표 → 페이지 좌표 (800×600 창에서 무대가 1.25 배) */
async function at(page: Page, x: number, y: number): Promise<[number, number]> {
  const r = (await page.locator('#d1-canvas').boundingBox())!;
  return [r.x + (x / 640) * r.width, r.y + (y / 480) * r.height];
}

/** 브라우저에 보관된 디아블로 1 파일 이름 (IndexedDB diabloclone-d1) */
async function storedD1(page: Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((res, rej) => {
    const req = indexedDB.open('diabloclone-d1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => {
      const k = req.result.transaction('files', 'readonly').objectStore('files').getAllKeys();
      k.onsuccess = () => res(k.result.map(String));
      k.onerror = () => rej(k.error);
    };
    req.onerror = () => rej(req.error);
  }));
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__d1?.ready === true || (window.__d1?.errors.length ?? 0) > 0, undefined, { timeout: 120_000 });
  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);
}

test('?d1 로 바로 시작: 타이틀 → 메뉴 → 전사 만들기 → 트리스트럼에서 걷기 (실제 마우스·키보드)', async ({ page }) => {
  test.setTimeout(300_000);
  // 새 캐릭터가 spawn0.sv 로 저장되는지 보려고 이전 실행의 세이브를 비운다
  await page.goto('/?d1');
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('diabloclone-d1'); q.onsuccess = q.onerror = q.onblocked = r; }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?d1');
  await waitReady(page);
  // 원작 인트로 영상(.smk)은 웹 빌드가 건너뛰고 타이틀/로고로 — 몇 프레임 그려질 때까지
  await page.waitForFunction(() => (window.__d1?.frames ?? 0) >= 10, undefined, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const title = await look(page);
  await page.locator('#d1-canvas').screenshot({ path: 'test-results/diablo1-title.png' });
  expect(title.lit).toBeGreaterThan(0.05);
  // 아무 키 → 타이틀에서 메인 메뉴로 (화면이 바뀐다)
  await page.keyboard.press('Escape');
  await page.mouse.click(320, 240);
  await expect.poll(async () => (await look(page)).hash, { timeout: 20_000 }).not.toBe(title.hash);
  await page.waitForTimeout(2500);
  await page.locator('#d1-canvas').screenshot({ path: 'test-results/diablo1-menu.png' });

  // 실제 마우스로: Single Player (원작 메뉴 목록은 더블클릭으로 연다) → Warrior → 이름 입력 → 트리스트럼
  const before = await look(page);
  await page.mouse.dblclick(...(await at(page, 320, 215)));
  await expect.poll(async () => (await look(page)).hash, { timeout: 20_000 }).not.toBe(before.hash);
  await page.waitForTimeout(2500);
  await page.mouse.dblclick(...(await at(page, 423, 299)));
  // 이름 칸이 열리면 화면 키보드(숨긴 입력칸)가 뜨고 초점을 받는다
  await expect(page.locator('#d1-keyboard')).toBeFocused({ timeout: 20_000 });
  await page.keyboard.type('Aidan');
  await page.keyboard.press('Enter');
  // 마을에 들어가면 게임이 캐릭터를 저장한다 (spawn0.sv → IndexedDB)
  await expect.poll(() => storedD1(page), { timeout: 60_000 }).toContain('spawn0.sv');
  await page.waitForTimeout(3000);
  const town = await look(page);
  await page.locator('#d1-canvas').screenshot({ path: 'test-results/diablo1-town.png' });
  expect(town.lit).toBeGreaterThan(0.3);
  // 클릭한 곳으로 걸어간다 (화면이 따라 움직인다)
  await page.mouse.click(...(await at(page, 420, 260)));
  await expect.poll(async () => (await look(page)).hash, { timeout: 10_000 }).not.toBe(town.hash);
  await page.waitForTimeout(2000);
  await page.locator('#d1-canvas').screenshot({ path: 'test-results/diablo1-walk.png' });

  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);
  expect(errors).toEqual([]);
});

test('D2 타이틀의 "Diablo I" 단추로 디아블로 1 을 띄운다', async ({ page }) => {
  test.skip(!existsSync('game-data/d2data.mpq'), 'Diablo II game-data 필요');
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => window.__menuArtReady?.() === true, undefined, { timeout: 60_000 });
  await expect(page.locator('#btn-diablo1')).toBeVisible();
  await page.locator('#game').screenshot({ path: 'test-results/diablo1-d2-title.png' });
  await page.click('#btn-diablo1');
  await waitReady(page);
  await expect(page.locator('#menu')).toHaveCount(0);
  await page.waitForFunction(() => (window.__d1?.frames ?? 0) >= 10, undefined, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('배포판 파일 고르기: spawn.mpq 하나만 넣어도 디아블로 1 로 시작한다', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?local');
  // 이전 실행이 보관한 파일을 지우고 처음 상태로
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('diabloclone-mpq'); q.onsuccess = q.onerror = q.onblocked = r; }));
  await page.goto('/?local');
  await expect(page.locator('#mpq-setup')).toBeVisible();
  await expect(page.locator('#mpq-setup [data-start]')).toBeDisabled();
  await page.locator('#mpq-setup [data-input="files"]').setInputFiles(SPAWN);
  await expect(page.locator('#mpq-setup .edition')).toHaveText('디아블로 1 (쉐어웨어) 으로 시작합니다', { timeout: 60_000 });
  await expect(page.locator('#mpq-setup .status')).toContainText('디아블로 1 만');
  await expect(page.locator('#mpq-setup li.ok')).toHaveText(['spawn.mpq (디아블로 1)']);
  await expect(page.locator('#mpq-setup [data-start]')).toBeEnabled();
  await page.screenshot({ path: 'test-results/diablo1-setup.png' });
  await page.click('#mpq-setup [data-start]');
  await waitReady(page);
  await expect(page.locator('#mpq-setup')).toHaveCount(0);
  // 새로고침해도 보관된 파일로 고르기 화면 없이 바로
  await page.reload();
  await waitReady(page);
  await expect(page.locator('#mpq-setup')).toHaveCount(0);
  expect(errors).toEqual([]);
});
