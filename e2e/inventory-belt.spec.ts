import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 사용자 신고 재현 → 수정 뒤 회귀 방지 (진짜 마우스):
//  1) 인벤토리 물약 Shift+클릭 → 벨트  2) 커서의 두루마리를 책 위에 클릭 → 책 +1
//  3) 땅의 두루마리를 주우면 책으로  4) 커서에 아이템을 든 채 Shift+클릭은 거부
// 출처: D2MOO Rcv0x63_ShiftLeftClickItemToBelt · Rcv0x29_ScrollToBook · ItemMode.cpp:1173

/** 인벤토리 격자 아이템의 화면 가운데 (inventory.txt Barbarian2: 격자 419,315 칸 29) */
async function cellOf(page: Page, code: string): Promise<{ x: number; y: number }> {
  return page.evaluate((code) => {
    const p = window.__game!.game.store.inv.items.find((x) => x.item.code === code)!;
    return { x: 419 + (p.x + p.item.invW / 2) * 29, y: 315 + (p.y + p.item.invH / 2) * 29 };
  }, code);
}

const codes = (page: Page) => page.evaluate(() => {
  const st = window.__game!.game.store;
  return { belt: st.belt.slice(0, 4).map((i) => i?.code ?? null), inv: st.inv.items.map((p) => `${p.item.code}:${p.item.quantity}`).sort(), cursor: st.cursor?.code ?? null };
});

test('인벤토리: Shift+클릭으로 벨트 적재, 두루마리를 책 위에 놓기·주우면 책으로, 커서 든 채 Shift 는 거부', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Belt'));
  const canvas = (await page.locator('#game').boundingBox())!;
  const at = (p: { x: number; y: number }) => ({ x: canvas.x + p.x, y: canvas.y + p.y });

  // 시작: 벨트 hp1 ×4, 인벤토리 isc·tsc. 1번 물약을 마셔 빈칸을 만들고 인벤토리에 hp1 을 격자에 둔다
  await page.evaluate(() => (window.__game!.game.character!.life = 10));
  await page.keyboard.press('1');
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.belt.slice(0, 4).filter(Boolean).length)).toBe(3);
  await page.evaluate(() => {
    const g = window.__game!.game, d = g.data!;
    const mk = (code: string, qty?: number) => {
      const it = d.treasure.createItem(d.items.base(code)!, 1, g.rng, 2);
      if (qty !== undefined) it.quantity = qty;
      g.store.inv.autoAdd(it);
      return it;
    };
    mk('hp1');
    mk('tbk', 3);
  });
  await page.keyboard.press('i');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.inventory.open)).toBe(true);

  // 1) Shift+클릭 → 벨트 (생명 물약 열 규칙: 아래 줄 빈칸으로)
  const hp = at(await cellOf(page, 'hp1'));
  await page.mouse.move(hp.x, hp.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(hp.x, hp.y);
  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.belt.slice(0, 4).filter((i) => i?.code === 'hp1').length)).toBe(4);
  let s = await codes(page);
  expect(s.inv.filter((c) => c.startsWith('hp1'))).toEqual([]);
  expect(s.cursor).toBeNull();

  // 2) tsc 를 집어 tbk 위에 클릭 → 책 4, 커서 비움
  const tsc = at(await cellOf(page, 'tsc'));
  await page.mouse.click(tsc.x, tsc.y);
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor?.code ?? null)).toBe('tsc');
  const tbk = at(await cellOf(page, 'tbk'));
  await page.mouse.click(tbk.x, tbk.y);
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.inv.items.find((p) => p.item.code === 'tbk')?.item.quantity)).toBe(4);
  s = await codes(page);
  expect(s.cursor).toBeNull();
  expect(s.inv.filter((c) => c.startsWith('tsc'))).toEqual([]);
  await page.screenshot({ path: 'test-results/inventory-belt-tome.png' });

  // 3) 땅의 tsc 를 진짜 클릭으로 주우면 책으로 (패널을 닫고 바닥 아이템을 클릭)
  await page.keyboard.press('i');
  const groundId = await page.evaluate(() => {
    const g = window.__game!.game, d = g.data!, p = g.snapshot().player;
    const it = d.treasure.createItem(d.items.base('tsc')!, 1, g.rng, 2);
    g.dropItem(it, p.x + 2, p.y + 1);
    return it.id;
  });
  await page.waitForFunction((id) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'item' && b.id === id), groundId, { timeout: 10_000 });
  const box = (await page.evaluate((id) => window.__game!.input!.pickBoxes.find((b) => b.kind === 'item' && b.id === id), groundId))!;
  await page.mouse.move(canvas.x + box.x + box.w / 2, canvas.y + box.y + box.h / 2);
  await page.waitForTimeout(100);
  await page.mouse.click(canvas.x + box.x + box.w / 2, canvas.y + box.y + box.h / 2);
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.inv.items.find((p) => p.item.code === 'tbk')?.item.quantity), { timeout: 15_000 }).toBe(5);
  s = await codes(page);
  expect(s.inv.filter((c) => c.startsWith('tsc'))).toEqual([]);
  expect(await page.evaluate((id) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'item' && b.id === id), groundId)).toBe(false);

  // 4) 커서에 아이템을 든 채 Shift+클릭 → 거부 (원작 "할 수 없다"), 아무것도 바뀌지 않음
  await page.evaluate(() => {
    const g = window.__game!.game, d = g.data!;
    const hp = d.treasure.createItem(d.items.base('hp1')!, 1, g.rng, 2);
    g.store.inv.autoAdd(hp);
    g.store.cursor = d.treasure.createItem(d.items.base('cap')!, 1, g.rng, 2);
    // 벨트 한 칸을 비워 둔다 (빈칸이 있어도 거부되는지)
    g.store.belt[3] = null;
    const w = window as unknown as { __ev: { type: string }[] };
    w.__ev = [];
    const orig = g.tick.bind(g);
    g.tick = () => {
      const e = orig();
      w.__ev.push(...(e as { type: string }[]));
      return e;
    };
  });
  await page.keyboard.press('i');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.inventory.open)).toBe(true);
  const before = await codes(page);
  const hp2 = at(await cellOf(page, 'hp1'));
  await page.mouse.move(hp2.x, hp2.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(hp2.x, hp2.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
  const after = await codes(page);
  expect(after).toEqual(before);
  expect(after.cursor).toBe('cap');
  expect(await page.evaluate(() => (window as unknown as { __ev: { type: string }[] }).__ev.some((e) => e.type === 'itemMoveFailed'))).toBe(true);
  expect(errors).toEqual([]);
});
