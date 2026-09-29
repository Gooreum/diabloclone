import { expect, test } from '@playwright/test';
import { loadHero, newHero, uniqueName } from './helpers';

// Phase 7: 인벤토리 패널(I) — 원작 inventory.txt 좌표, 원작 아이템 그림, 집기/놓기/장착, 벨트 1~4, 저장 후 위치 유지
test('인벤토리: 투구를 집어 머리 칸에 장착, 벨트 물약 사용, 저장 후 위치 유지', async ({ page }) => {
  const name = uniqueName('Inv');
  await newHero(page, name);
  // 시작 장비: 오른손 hax, 왼손 buc, 벨트 hp1 ×4 (출처: charstats.txt 바바리안 시작 장비)
  const start = await page.evaluate(() => {
    const st = window.__game!.game.store;
    return { rarm: st.equipment.rarm?.code, larm: st.equipment.larm?.code, belt: st.belt.slice(0, 4).map((i) => i?.code ?? null), inv: st.inv.items.map((p) => p.item.code).sort() };
  });
  expect(start.rarm).toBe('hax');
  expect(start.larm).toBe('buc');
  expect(start.belt).toEqual(['hp1', 'hp1', 'hp1', 'hp1']);
  expect(start.inv).toEqual(['isc', 'tsc']);

  // 투구 하나를 인벤토리에 넣고 패널 열기
  await page.evaluate(() => {
    const g = window.__game!.game;
    const d = g.data!;
    const cap = d.treasure.createItem(d.items.base('cap')!, 1, g.rng, 2);
    g.store.store(cap);
    (window as unknown as { __capId: number }).__capId = cap.id;
  });
  await page.keyboard.press('i');
  const canvas = (await page.locator('#game').boundingBox())!;
  const pos = await page.evaluate(() => {
    const g = window.__game!.game;
    const p = g.store.inv.items.find((x) => x.item.id === (window as unknown as { __capId: number }).__capId)!;
    return { x: 419 + (p.x + p.item.invW / 2) * 29, y: 315 + (p.y + p.item.invH / 2) * 29 };
  });
  await page.mouse.click(canvas.x + pos.x, canvas.y + pos.y);
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor?.code ?? null)).toBe('cap');
  // 머리 칸 (inventory.txt Barbarian2 headLeft..headRight / headTop..headBottom 의 가운데)
  await page.mouse.click(canvas.x + 552, canvas.y + 85);
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.equipment.head?.code ?? null)).toBe('cap');
  await page.mouse.move(canvas.x + 552, canvas.y + 85);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/inventory-panel.png' });

  // 벨트 1번 물약: 생명이 줄어 있으면 마시기 (healthpot 상태)
  await page.evaluate(() => (window.__game!.game.character!.life = 10));
  await page.keyboard.press('1');
  await expect.poll(() => page.evaluate(() => window.__game!.game.snapshot().player.states.includes('healthpot'))).toBe(true);
  expect(await page.evaluate(() => window.__game!.game.store.belt.slice(0, 4).filter(Boolean).length)).toBe(3);

  // 저장 → 새로고침 → 불러오기: 투구 장착·스크롤 위치 유지
  const before = await page.evaluate(() => window.__game!.game.store.inv.items.map((p) => `${p.item.code}@${p.x},${p.y}`).sort());
  await page.keyboard.press('i');
  await page.keyboard.press('Escape');
  await page.click('#btn-save-exit');
  await page.waitForFunction(() => window.__menuReady === true);
  await page.reload();
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await loadHero(page, name);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  const after = await page.evaluate(() => ({
    head: window.__game!.game.store.equipment.head?.code,
    inv: window.__game!.game.store.inv.items.map((p) => `${p.item.code}@${p.x},${p.y}`).sort(),
    belt: window.__game!.game.store.belt.slice(0, 4).filter(Boolean).length,
  }));
  expect(after).toEqual({ head: 'cap', inv: before, belt: 3 });
});
