import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pngStats } from './png';

// 디아블로 1 단축키 (엔진 패치 + 게임 중 단축키 화면): 동시키(SHIFT+1), 브라우저 예약 키(F1~F12) 없음
const SPAWN = resolve('game-data/diablo1/spawn.mpq');
test.skip(!existsSync(SPAWN), 'game-data/diablo1/spawn.mpq 필요 (npm run fetch-d1)');
const SPAWN_URL = 'https://d07riv.github.io/diabloweb/spawn.mpq';

interface KeyAction { id: string; name: string; key: string }
type Rt = { Module: { ccall(n: string, r: string, t: string[], a: string[]): string | number } };

const look = async (page: Page) => pngStats(await page.screenshot());
/** 화면 왼쪽 절반 (캐릭터 창 자리) */
const leftHalf = async (page: Page) => pngStats(await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 420 } }));

async function keymap(page: Page): Promise<KeyAction[]> {
  const f = page.frame({ url: /d1x\/play\.html/ })!;
  return f.evaluate(() => JSON.parse((window as unknown as Rt).Module.ccall('dvx_keymap_json', 'string', [], []) as string) as KeyAction[]);
}
async function setKey(page: Page, id: string, key: string): Promise<number> {
  const f = page.frame({ url: /d1x\/play\.html/ })!;
  return f.evaluate(([i, k]) => (window as unknown as Rt).Module.ccall('dvx_keymap_set', 'number', ['string', 'string'], [i!, k!]) as number, [id, key]);
}

/** 깨끗한 상태에서 ?d1 → 전사 만들어 마을까지 */
async function startInTown(page: Page): Promise<void> {
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
  const title = await look(page);
  await page.mouse.click(400, 300);
  await expect.poll(async () => (await look(page)).hash, { timeout: 20_000 }).not.toBe(title.hash);
  await page.waitForTimeout(2000);
  for (const k of ['Enter', 'Enter', 'Enter']) {
    await page.keyboard.press(k);
    await page.waitForTimeout(1800);
  }
  await page.keyboard.type('Keys');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await look(page)).lit, { timeout: 60_000 }).toBeGreaterThan(0.3);
  await page.waitForTimeout(3000);
}

test('엔진: 기본값에 F키가 없고, SHIFT+1 을 배정하면 Shift+1 로 캐릭터 창이 열린다, F1 은 거부', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startInTown(page);

  const map = await keymap(page);
  const key = (id: string) => map.find((a) => a.id === id)?.key;
  expect(map.filter((a) => /^(.*\+)?F([1-9]|1[0-2])$/.test(a.key))).toEqual([]);
  expect([key('Help'), key('QuickSave'), key('QuickLoad'), key('QuickSpell1'), key('QuickSpell4'), key('Character')]).toEqual(['H', 'SHIFT+S', 'SHIFT+L', 'SHIFT+1', 'SHIFT+4', 'C']);

  // F1 은 받지 않는다 (브라우저 예약)
  expect(await setKey(page, 'Help', 'F1')).toBe(0);
  expect(await setKey(page, 'Help', 'SHIFT+F5')).toBe(0);
  expect((await keymap(page)).find((a) => a.id === 'Help')?.key).toBe('H');

  // 캐릭터 창 = SHIFT+1 (빠른 마법 1 은 비운다)
  expect(await setKey(page, 'QuickSpell1', '')).toBe(1);
  expect(await setKey(page, 'Character', 'SHIFT+1')).toBe(1);
  await page.mouse.click(400, 200);
  await page.waitForTimeout(800);
  // 1 만 누르면 (허리띠 1 — 비어 있음) 창이 안 열린다
  const before = await leftHalf(page);
  await page.keyboard.press('1');
  await page.waitForTimeout(800);
  expect(Math.abs((await leftHalf(page)).lit - before.lit)).toBeLessThan(0.05);
  await page.keyboard.down('Shift');
  await page.keyboard.press('1');
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await leftHalf(page)).hash, { timeout: 5000 }).not.toBe(before.hash);
  await page.screenshot({ path: 'test-results/diablo1-keys-shift1.png' });
  // C 는 이제 비어 있다 → 닫기는 다시 Shift+1
  await page.keyboard.down('Shift');
  await page.keyboard.press('1');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__d1!.errors)).toEqual([]);
  expect(errors).toEqual([]);
});

test('게임 중 "⌨ 단축키" 화면: Shift+1 배정 → 게임에서 바로, F1 거부, Alt 동시키·Ctrl 혼자, 새로고침해도 남는다', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startInTown(page);
  const row = (id: string) => page.locator(`#d1-keys .row[data-id="${id}"]`);

  await page.click('#btn-d1-keys');
  await expect(page.locator('#d1-keys')).toBeVisible();
  await expect(row('Character').locator('.key')).toHaveText('C');
  await expect(row('Help').locator('.key')).toHaveText('H');
  await page.screenshot({ path: 'test-results/diablo1-keys-panel.png' });

  // 캐릭터 = Shift+1 (같은 키였던 빠른 마법 1 은 비워진다)
  await row('Character').locator('.key').click();
  await expect(row('Character').locator('.key')).toHaveText('키를 누르세요…');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('Shift');
  await expect(row('Character').locator('.key')).toHaveText('SHIFT+1');
  await expect(row('QuickSpell1').locator('.key')).toHaveText('—');

  // F1 은 거부, 값은 그대로
  await row('Help').locator('.key').click();
  await page.keyboard.press('F1');
  await expect(page.locator('#d1-keys .msg')).toContainText('F1~F12');
  await page.keyboard.press('Escape');
  await expect(row('Help').locator('.key')).toHaveText('H');

  // Alt 누른 채 2 → ALT+2, Ctrl 혼자 눌렀다 떼기 → LCONTROL
  await row('Inventory').locator('.key').click();
  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit2');
  await page.keyboard.up('Alt');
  await expect(row('Inventory').locator('.key')).toHaveText('ALT+2');
  await row('QuickSpell2').locator('.key').click();
  await page.keyboard.down('Control');
  await page.keyboard.up('Control');
  await expect(row('QuickSpell2').locator('.key')).toHaveText('LCONTROL');
  await page.screenshot({ path: 'test-results/diablo1-keys-panel-changed.png' });

  // 닫기 → 게임으로 포커스, Shift+1 로 캐릭터 창
  await page.click('#d1-keys [data-close]');
  await expect(page.locator('#d1-keys')).toHaveCount(0);
  await page.waitForTimeout(800);
  const before = await leftHalf(page);
  await page.keyboard.down('Shift');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await leftHalf(page)).hash, { timeout: 5000 }).not.toBe(before.hash);
  await page.screenshot({ path: 'test-results/diablo1-keys-ingame.png' });

  // 새로고침해도 남는다 (브라우저 저장)
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => window.__d1?.ready === true, undefined, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const map = await keymap(page);
  expect(['Character', 'Inventory', 'QuickSpell2'].map((id) => map.find((a) => a.id === id)?.key)).toEqual(['SHIFT+1', 'ALT+2', 'LCONTROL']);
  expect(errors).toEqual([]);
});
