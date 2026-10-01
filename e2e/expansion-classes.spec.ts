import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chooseDifficulty, loadHero, uniqueName } from './helpers';

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

test('어쌔신 게임 안: 카타르(HT1) → 손톱 두 개 HT2, 스킬 트리 skltree_i 에서 Claw Mastery 배우기, 저장 후 다시 불러오기', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip((await openCreate(page)) !== 'lod', '확장팩 서버에서만');
  const name = uniqueName('Ai');
  await create(page, 'assassin', name);
  const wclass = () => page.evaluate(() => (window.__game!.game as unknown as { weaponWclass(): string }).weaponWclass());
  expect(await page.evaluate(() => window.__game!.game.equipment.rarm?.code)).toBe('ktr');
  expect(await wclass()).toBe('HT1');
  await page.waitForTimeout(1500);
  await page.locator('#game').screenshot({ path: 'test-results/expansion-classes-assassin-ht1.png' });
  // 왼손 버클러 대신 손톱 → HT2 (원작 AI COF LH:ht2)
  await page.evaluate(() => {
    const g = window.__game!.game;
    const d = (g as unknown as { data: { treasure: { createItem: (b: unknown, l: number, r: unknown, q: number) => unknown }; items: { base: (c: string) => unknown } } }).data;
    (g.store.equipment as Record<string, unknown>).larm = d.treasure.createItem(d.items.base('wrb'), 5, (g as unknown as { rng: unknown }).rng, 2);
  });
  expect(await wclass()).toBe('HT2');
  await page.waitForTimeout(1500);
  await page.locator('#game').screenshot({ path: 'test-results/expansion-classes-assassin-ht2.png' });

  // 스킬 트리: Shadow Disciplines 탭(2쪽)에서 Claw Mastery(252) 배우기
  await page.evaluate(() => (window.__game!.game.character!.skillPoints = 1));
  await page.keyboard.press('t');
  await expect(page.locator('#skilltree')).toBeVisible();
  await page.click('#skilltab-2');
  await page.click('[data-learn="252"]');
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.skills[252] ?? 0)).toBe(1);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/expansion-classes-assassin-tree.png' });
  await page.keyboard.press('t');

  // 저장 → 다시 불러오기: 어쌔신·확장팩·스킬 유지
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 60_000 });
  await loadHero(page, name);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  expect(await page.evaluate(() => [window.__game!.game.character!.cls, window.__game!.game.expansion, window.__game!.game.character!.skills[252]])).toEqual(['Assassin', true, 1]);
  expect(errors).toEqual([]);
});

test('드루이드 게임 안: 곤봉·버클러로 시작, 스킬 트리 skltree_d (Summoning 탭)', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  test.skip((await openCreate(page)) !== 'lod', '확장팩 서버에서만');
  await create(page, 'druid', uniqueName('Dz'));
  expect(await page.evaluate(() => [window.__game!.game.equipment.rarm?.code, window.__game!.game.equipment.larm?.code, window.__game!.game.expansion])).toEqual(['clb', 'buc', true]);
  await page.waitForTimeout(1500);
  await page.locator('#game').screenshot({ path: 'test-results/expansion-classes-druid.png' });
  await page.keyboard.press('t');
  await expect(page.locator('#skilltree')).toBeVisible();
  await expect(page.locator('[data-learn="221"]')).toHaveCount(1); // Raven
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/expansion-classes-druid-tree.png' });
  expect(errors).toEqual([]);
});
