import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chooseDifficulty, loadHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2exp.mpq') || !existsSync('game-data/lod/patch_d2.mpq'), '원작 확장팩 game-data 필요');

// 확장팩 아이템 (원작 LoD): 룬을 커서로 하나씩 박아 룬워드 완성, 인벤토리 참 능력치, 이더리얼 툴팁, 저장 후 유지.
// 클래식 서버(D2_EDITION=classic)는 건너뛴다.

async function canvasAt(page: Page, p: { x: number; y: number }): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

/** 인벤토리 칸 (x, y) 가운데 화면 좌표 */
const cell = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const g = window.__game!.ui!.inventory.layout.grid;
    return { x: g.l + (x + 0.5) * g.box, y: g.t + (y + 0.5) * g.box };
  }, [x, y] as const);

test('룬워드·참·이더리얼: 마우스로 룬 박기 → Ancient\'s Pledge, 참 생명 +20, 저장 후 유지', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('Rw');
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  test.skip((await page.evaluate(() => window.__edition)) !== 'lod', '확장팩 서버에서만');
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.click('#btn-barbarian');
  await page.fill('#hero-name', name);
  await page.click('#btn-ok');
  await chooseDifficulty(page);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__game!.game.expansion)).toBe(true);

  // 시험 아이템을 인벤토리 빈 줄(맨 아래 줄 위)에 넣는다: 3소켓 큰 방패, Ral·Ort·Tal, +20 생명 작은 참, 이더리얼 장검
  const life0 = await page.evaluate(() => {
    const g = window.__game!.game;
    const d = (g as unknown as { data: { treasure: { createItem: (b: unknown, l: number, r: unknown, q: number) => Record<string, unknown> }; items: { base: (c: string) => unknown } } }).data;
    const rng = (g as unknown as { rng: unknown }).rng;
    const inv = g.store.inv;
    inv.items.length = 0;
    const put = (code: string, x: number, y: number, patch: Record<string, unknown> = {}) => {
      const it = d.treasure.createItem(d.items.base(code), 30, rng, 2);
      Object.assign(it, { identified: true }, patch);
      inv.items.push({ item: it as never, x, y });
      return it;
    };
    const life = g.maxLife();
    put('lrg', 0, 0, { sockets: 3, stats: [{ stat: 'item_numsockets', param: 0, value: 3 }] });
    put('r08', 2, 0);
    put('r09', 3, 0);
    put('r07', 4, 0);
    put('cm1', 5, 0, { quality: 4, prefixes: [], suffixes: [], stats: [{ stat: 'maxhp', param: 0, value: 20 }] });
    const sw = put('lsd', 6, 0);
    sw.ethereal = true;
    return life;
  });
  await expect.poll(() => page.evaluate(() => window.__game!.game.maxLife())).toBe(life0 + 20);

  // 인벤토리 열기 (I) → 룬 집기 → 방패 위에 클릭 (원작 소켓 넣기), 세 번
  await page.keyboard.press('i');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.inventory.open)).toBe(true);
  for (const x of [2, 3, 4]) {
    await canvasAt(page, await cell(page, x, 0));
    await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor?.code ?? null)).toMatch(/^r0\d$/);
    await canvasAt(page, await cell(page, 0, 1));
    await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor)).toBeNull();
  }
  const shield = await page.evaluate(() => {
    const p = window.__game!.game.store.inv.items.find((x) => x.item.code === 'lrg')!;
    const t = window.__game!.ui!.itemText.lines(p.item, { level: 1, str: 100, dex: 100, cls: 'Barbarian' });
    return { socketed: p.item.socketed.map((g) => g.code), runeword: p.item.runeword, first: t[0]?.text, runes: t[2]?.text };
  });
  expect(shield.socketed).toEqual(['r08', 'r09', 'r07']);
  expect(shield.runeword).toBeGreaterThanOrEqual(0);
  expect(shield.first).toBe("Ancients' Pledge"); // 원작 string.tbl Runeword1 표기
  expect(shield.runes).toBe("'RalOrtTal'");
  // 이더리얼·참 툴팁 줄
  const lines = await page.evaluate(() => {
    const items = window.__game!.game.store.inv.items;
    const t = (code: string) => window.__game!.ui!.itemText.lines(items.find((x) => x.item.code === code)!.item, { level: 1, str: 100, dex: 100, cls: 'Barbarian' }).map((l) => l.text);
    return { sword: t('lsd'), charm: t('cm1') };
  });
  expect(lines.sword.some((l) => l.startsWith('Ethereal (Cannot be Repaired)'))).toBe(true);
  expect(lines.charm).toContain('Keep in Inventory to Gain Bonus');
  await canvasAt(page, await cell(page, 7, 3));
  await page.locator('#game').screenshot({ path: 'test-results/lod-items-inventory.png' });

  // 저장 → 다시 불러오기: 룬워드·이더리얼·참 효과 유지
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 60_000 });
  await loadHero(page, name);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1, undefined, { timeout: 30_000 });
  const back = await page.evaluate(() => {
    const items = window.__game!.game.store.inv.items.map((x) => x.item);
    return { rw: items.find((x) => x.code === 'lrg')?.runeword, eth: items.find((x) => x.code === 'lsd')?.ethereal, life: window.__game!.game.maxLife() };
  });
  expect(back.rw).toBe(shield.runeword);
  expect(back.eth).toBe(true);
  expect(back.life).toBe(life0 + 20);
  expect(errors).toEqual([]);
});
