import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 확장팩 용병 장비 (원작 1.14d LoD): O 키로 용병 창(NPCInv) → 인벤토리의 활을 집어 무기 칸에 → 용병 피해가 오른다.
// 클래식 서버는 O 키에 아무 창도 열리지 않는다.

async function canvasAt(page: Page, p: { x: number; y: number }, button: 'left' | 'right' = 'left'): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y, { button });
}

/** 인벤토리 칸 (x, y) 가운데 화면 좌표 */
const cell = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const g = window.__game!.ui!.inventory.layout.grid;
    return { x: g.l + (x + 0.5) * g.box, y: g.t + (y + 0.5) * g.box };
  }, [x, y] as const);

/** 로그(Id 0, 레벨 10)를 곁에 고용하고 인벤토리에 활·가죽 갑옷 */
async function setup(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__game!.game;
    const d = (g as unknown as { data: { treasure: { createItem: (b: unknown, l: number, r: unknown, q: number) => Record<string, unknown> }; items: { base: (c: string) => unknown } } }).data;
    const rng = (g as unknown as { rng: unknown }).rng;
    g.character!.level = 20;
    const s = g.snapshot().player;
    g.hireMerc('merc05', 99, 0, 10, 10 * 10 * 100 * 11, s.x + 1, s.y + 1);
    const inv = g.store.inv;
    inv.items.length = 0;
    const put = (code: string, x: number, y: number) => {
      const it = d.treasure.createItem(d.items.base(code), 10, rng, 2);
      Object.assign(it, { identified: true });
      inv.items.push({ item: it as never, x, y });
    };
    put('sbw', 0, 0);
    put('lea', 2, 0);
  });
}

test('용병 장비: O 키로 용병 창 → 활을 무기 칸에, 갑옷을 갑옷 칸에 → 피해·방어가 오른다', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  test.skip((await page.evaluate(() => window.__edition ?? 'classic')) !== 'lod', '확장팩 서버에서만');
  await newHero(page, uniqueName('Mq'), 'amazon');
  await setup(page);
  await expect.poll(() => page.evaluate(() => window.__game!.game.snapshot().merc?.stats?.max ?? 0)).toBeGreaterThan(0);
  const before = await page.evaluate(() => window.__game!.game.snapshot().merc!.stats!);

  // O = Hireling Screen
  await page.keyboard.press('o');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.merc.open)).toBe(true);
  await page.keyboard.press('i');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.inventory.open)).toBe(true);
  await page.waitForTimeout(500);
  await page.locator('#game').screenshot({ path: 'test-results/merc-equip-panel.png' });

  // 활 집기 → 무기 칸
  await canvasAt(page, await cell(page, 0, 0));
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor?.code ?? null)).toBe('sbw');
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.merc.slotCenter('rarm')));
  await expect.poll(() => page.evaluate(() => window.__game!.game.snapshot().merc?.items?.rarm?.code ?? null)).toBe('sbw');
  expect(await page.evaluate(() => window.__game!.game.store.cursor)).toBeNull();
  // 갑옷 집기 → 갑옷 칸
  await canvasAt(page, await cell(page, 2, 0));
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor?.code ?? null)).toBe('lea');
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.merc.slotCenter('tors')));
  await expect.poll(() => page.evaluate(() => window.__game!.game.snapshot().merc?.items?.tors?.code ?? null)).toBe('lea');

  const after = await page.evaluate(() => window.__game!.game.snapshot().merc!.stats!);
  expect(after.max).toBeGreaterThan(before.max);
  expect(after.defense).toBeGreaterThan(before.defense);
  await page.waitForTimeout(500);
  await page.locator('#game').screenshot({ path: 'test-results/merc-equip-equipped.png' });

  // 빈 손으로 무기 칸 = 활을 다시 든다
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.merc.slotCenter('rarm')));
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor?.code ?? null)).toBe('sbw');

  // O 다시 = 닫기
  await page.keyboard.press('o');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.merc.open)).toBe(false);
  expect(errors).toEqual([]);
});

test('클래식: O 키에 용병 창이 열리지 않는다', async ({ page }) => {
  test.setTimeout(200_000);
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  test.skip((await page.evaluate(() => window.__edition ?? 'classic')) !== 'classic', '클래식 서버에서만');
  await newHero(page, uniqueName('Mc'), 'amazon');
  await setup(page);
  await page.keyboard.press('o');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game!.ui!.merc.open)).toBe(false);
});
