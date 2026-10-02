import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chooseDifficulty, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2exp.mpq') || !existsSync('game-data/lod/patch_d2.mpq'), '원작 확장팩 game-data 필요');

// 확장팩 캐릭터 (원작 LoD "Expansion Character"): 만들기 화면 체크(기본 켬) → 선택 화면 초록 표시 → 확장팩 데이터로 게임.
// 클래식 서버(D2_EDITION=classic)는 이 spec 의 판본 시나리오를 건너뛴다 (__edition 으로 확인).

async function create(page: Page, name: string, expansion: boolean): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  test.skip((await page.evaluate(() => window.__edition)) !== 'lod', '확장팩 서버에서만 (클래식 서버는 체크 상자가 없다)');
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

test('Convert to Expansion: 클래식 캐릭터를 선택 화면에서 확장팩으로 (No 는 그대로) → 확장팩 게임', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('Cv');
  await create(page, name, false);
  expect(await page.evaluate(() => window.__game!.game.expansion)).toBe(false);
  await saveExit(page);
  const stored = () => page.evaluate((n) => window.__heroStore!.load(n).then((s) => s?.expansion ?? null), name);
  await page.click('#btn-single');
  await page.click(`#hero-${name}`);
  // No: 그대로 클래식
  await page.click('#btn-convert');
  await page.click('#btn-convert-no');
  expect(await stored()).toBeNull();
  // Yes: 확장팩 캐릭터로 저장
  await page.click(`#hero-${name}`);
  await page.click('#btn-convert');
  await page.screenshot({ path: 'test-results/convert-confirm.png' });
  await page.click('#btn-convert-yes');
  await expect.poll(stored).toBe(true);
  await page.click(`#hero-${name}`);
  await page.screenshot({ path: 'test-results/convert-after.png' });
  await page.click('#btn-select-ok');
  await chooseDifficulty(page);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  expect(await page.evaluate(() => window.__game!.game.expansion)).toBe(true);
  expect(errors).toEqual([]);
});

test('클래식 판본(D2_EDITION=classic 서버): 바꾸기 단추·만들기 화면 체크 상자가 없다', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  test.skip((await page.evaluate(() => window.__edition)) !== 'classic', '클래식 서버에서만 (D2_EDITION=classic)');
  await page.click('#btn-single');
  await expect(page.locator('#btn-convert')).toHaveCount(0);
  await page.click('#btn-create');
  await page.click('#btn-sorceress');
  await expect(page.locator('#chk-expansion')).toHaveCount(0);
});

test('확장팩 화면: 원작 800 조작판, 확장팩 캐릭터 인벤토리 (invchar6)', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await create(page, uniqueName('Ui'), true);
  await page.waitForTimeout(1500);
  // 벨트 오른쪽 (근사 돌 판이 있던 475~635) 이 원작 조각으로 채워져 있다 — 밝은 픽셀이 있다
  const lit = await page.evaluate(async () => {
    const img = await window.__game!.capture!();
    let n = 0, all = 0;
    for (let y = 548; y < 598; y++) for (let x = 480; x < 630; x++) {
      const i = (y * 800 + x) * 4;
      all++;
      if (img.data[i]! + img.data[i + 1]! + img.data[i + 2]! > 60) n++;
    }
    return n / all;
  });
  expect(lit).toBeGreaterThan(0.2);
  await page.locator('#game').screenshot({ path: 'test-results/expansion-hud.png' });
  await page.keyboard.press('i');
  await page.waitForTimeout(500);
  await page.locator('#game').screenshot({ path: 'test-results/expansion-inv.png' });
  expect(errors).toEqual([]);
});

test('무기 바꾸기: W 로 바꾸고 되돌리기, II 탭 클릭, 저장 후 다시 불러와도 유지 · 클래식 캐릭터는 안 바뀜', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('Sw');
  await create(page, name, true);
  const rarm = () => page.evaluate(() => window.__game!.game.equipment.rarm?.code ?? null);
  const set = () => page.evaluate(() => window.__game!.game.store.weaponSet);
  const staff = await rarm();
  expect(staff).not.toBeNull();
  // W: 빈 II 세트로 → 오른손 비고, 다시 W 로 지팡이
  await page.mouse.move(400, 250);
  await page.keyboard.press('w');
  await expect.poll(rarm).toBeNull();
  expect(await set()).toBe(1);
  expect(await page.evaluate(() => window.__game!.game.store.altWeapons.rarm?.code)).toBe(staff);
  await page.keyboard.press('w');
  await expect.poll(rarm).toBe(staff);
  // 인벤토리의 II 탭 (오른손 칸 위) 클릭 → II 세트
  await page.keyboard.press('i');
  const tab = await page.evaluate(() => {
    const P = window.__game!.ui!.inventory.layout.panel;
    return { x: P.l + 52 + 15, y: P.t + 23 + 10 };
  });
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + tab.x, box.y + tab.y);
  await expect.poll(set).toBe(1);
  await page.locator('#game').screenshot({ path: 'test-results/expansion-swap-tab2.png' });
  // 저장 → 다시 불러오기: II 세트·쉬는 지팡이 그대로
  await saveExit(page);
  await page.click('#btn-single');
  await page.click(`#hero-${name}`, { clickCount: 2 });
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  expect(await set()).toBe(1);
  expect(await page.evaluate(() => window.__game!.game.store.altWeapons.rarm?.code)).toBe(staff);
  expect(errors).toEqual([]);
});

test('클래식 캐릭터는 W 를 눌러도 무기가 그대로', async ({ page }) => {
  test.setTimeout(300_000);
  await create(page, uniqueName('Cw'), false);
  const before = await page.evaluate(() => window.__game!.game.equipment.rarm?.code);
  await page.keyboard.press('w');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game!.game.equipment.rarm?.code)).toBe(before);
  expect(await page.evaluate(() => window.__game!.game.store.weaponSet)).toBe(0);
});
