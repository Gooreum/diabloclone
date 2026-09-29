import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);

/** 캔버스 좌표 클릭 (뷰포트 800×600 = 캔버스) */
async function clickCanvas(page: Page, p: { x: number; y: number }, button: 'left' | 'right' = 'left', shift = false): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(box.x + (p.x * box.width) / 800, box.y + (p.y * box.height) / 600, { button });
  if (shift) await page.keyboard.up('Shift');
}

async function moveMouse(page: Page, p: { x: number; y: number }): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.move(box.x + (p.x * box.width) / 800, box.y + (p.y * box.height) / 600);
}

/** NPC 곁(4 서브타일)으로 옮긴 뒤 그 NPC 의 클릭 상자를 눌러 걸어가 말 걸기 → 메뉴가 열릴 때까지 */
async function talkTo(page: Page, typeId: string): Promise<void> {
  await page.evaluate((id) => {
    const g = window.__game!.game;
    const n = g.npcs.find((x) => x.type.id === id)!;
    const m = g.map;
    for (let r = 4; r < 12; r++)
      for (let a = 0; a < 16; a++) {
        const x = Math.floor(n.x + Math.cos((a / 16) * Math.PI * 2) * r), y = Math.floor(n.y + Math.sin((a / 16) * Math.PI * 2) * r);
        if (m.walkable(x, y)) {
          g.changeLevel('town', x + 0.5, y + 0.5);
          return;
        }
      }
  }, typeId);
  const id = await page.evaluate((t) => window.__game!.game.npcs.find((x) => x.type.id === t)!.id, typeId);
  await page.waitForFunction((nid) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'npc' && b.id === nid), id, { timeout: 15_000 });
  const p = await page.evaluate((nid) => {
    const b = window.__game!.input!.pickBoxes.find((x) => x.kind === 'npc' && x.id === nid)!;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }, id);
  await clickCanvas(page, p);
  await page.waitForFunction((t) => window.__game!.game.snapshot().interaction?.typeId === t, typeId, { timeout: 15_000 });
  await page.waitForTimeout(200);
}

async function chooseMenu(page: Page, option: string): Promise<void> {
  const p = await page.evaluate((o) => window.__game!.ui!.npcMenu.optionCenter(o as never), option);
  expect(p).not.toBeNull();
  await clickCanvas(page, p!);
}

test('Charsi: 말 걸기 → 사기 → 팔기 → 모두 수리 (원작 buysell.dc6 상점 패널)', async ({ page }) => {
  await newHero(page, uniqueName('Trade'));
  await page.evaluate(() => {
    window.__game!.game.gold = 5000;
  });
  await talkTo(page, 'charsi');
  await page.screenshot({ path: 'test-results/npc-charsi-menu.png' });
  expect(await page.evaluate(() => window.__game!.game.snapshot().interaction!.options)).toEqual(['talk', 'tradeRepair', 'cancel']);
  await chooseMenu(page, 'tradeRepair');
  await page.waitForFunction(() => window.__game!.ui!.store.open && window.__game!.ui!.store.ready, undefined, { timeout: 15_000 });
  // 무기 탭 (페이지 1) → 첫 무기 사기
  const tab = await page.evaluate(() => window.__game!.ui!.store.tabCenter(1));
  await clickCanvas(page, tab);
  await page.waitForTimeout(200);
  const pick = await page.evaluate(() => {
    const g = window.__game!.game;
    const s = g.snapshot().interaction!.store.find((x) => x.page === 1)!;
    return { id: s.item.id, code: s.item.code, cost: g.priceOf(s.item, 'buy'), at: window.__game!.ui!.store.itemCenter(s.item.id)! };
  });
  await moveMouse(page, pick.at);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/npc-charsi-store.png' });
  await clickCanvas(page, pick.at);
  await page.waitForFunction((c) => window.__game!.game.gold === 5000 - c, pick.cost, { timeout: 5000 });
  const bought = await page.evaluate((code) => window.__game!.game.inventory.find((i) => i.code === code)!.id, pick.code);
  // 팔기: 인벤토리 아이템을 집어 상점 격자에 놓는다
  const sell = await page.evaluate((id) => {
    const g = window.__game!.game;
    const inv = window.__game!.ui!.inventory;
    const p = g.store.inv.items.find((x) => x.item.id === id)!;
    const L = inv.layout.grid;
    return { at: { x: L.l + (p.x + 0.5) * L.box, y: L.t + (p.y + 0.5) * L.box }, price: g.priceOf(p.item, 'sell'), gold: g.gold };
  }, bought);
  await clickCanvas(page, sell.at);
  await page.waitForFunction(() => !!window.__game!.game.store.cursor, undefined, { timeout: 5000 });
  await clickCanvas(page, { x: 250, y: 250 });
  await page.waitForFunction((v) => window.__game!.game.gold === v, sell.gold + sell.price, { timeout: 5000 });
  expect(await page.evaluate((id) => window.__game!.game.inventory.some((i) => i.id === id), bought)).toBe(false);
  // 수리: 장착 무기를 닳게 하고 모두 수리 버튼
  const rep = await page.evaluate(() => {
    const g = window.__game!.game;
    const w = g.equipment.rarm!;
    w.durability = 1;
    // 모두 수리 = 장착·인벤토리 중 닳은 아이템 수리비 합
    const all = [...g.inventory, ...Object.values(g.equipment)].filter((i) => i.maxDurability > 0 && i.durability < i.maxDurability);
    return { gold: g.gold, cost: all.reduce((a, i) => a + g.priceOf(i, 'repair'), 0) };
  });
  expect(rep.cost).toBeGreaterThan(0);
  const btn = await page.evaluate(() => window.__game!.ui!.store.buttonCenter(3));
  await clickCanvas(page, btn);
  await page.waitForFunction((v) => window.__game!.game.gold === v, rep.gold - rep.cost, { timeout: 5000 });
  expect(await page.evaluate(() => window.__game!.game.equipment.rarm!.durability === window.__game!.game.equipment.rarm!.maxDurability)).toBe(true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/npc-charsi-repaired.png' });
});

test('Gheed: 도박 → 산 반지는 감정된다', async ({ page }) => {
  await newHero(page, uniqueName('Gamble'));
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.character!.level = 20;
    g.gold = 200000;
  });
  await talkTo(page, 'gheed');
  expect(await page.evaluate(() => window.__game!.game.snapshot().interaction!.options)).toContain('gamble');
  await chooseMenu(page, 'gamble');
  await page.waitForFunction(() => window.__game!.ui!.store.open && window.__game!.ui!.store.gamble && window.__game!.ui!.store.ready, undefined, { timeout: 15_000 });
  const ring = await page.evaluate(() => {
    const s = window.__game!.game.snapshot().interaction!.store.find((x) => x.item.code === 'rin')!;
    return window.__game!.ui!.store.itemCenter(s.item.id)!;
  });
  await moveMouse(page, ring);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/npc-gheed-gamble.png' });
  await clickCanvas(page, ring);
  await page.waitForFunction(() => window.__game!.game.gold === 150000, undefined, { timeout: 5000 });
  expect(await page.evaluate(() => window.__game!.game.inventory.find((i) => i.code === 'rin')!.identified)).toBe(true);
});

test('Kashya: 용병 고용 → Blood Moor 까지 따라와 화살을 쏜다', async ({ page }) => {
  await newHero(page, uniqueName('Merc'), 'amazon');
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.character!.level = 9;
    g.gold = 5000;
  });
  await talkTo(page, 'kashya');
  await chooseMenu(page, 'hire');
  await page.waitForFunction(() => window.__game!.game.snapshot().interaction?.mode === 'hire', undefined, { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/npc-kashya-hire.png' });
  const row = await page.evaluate(() => window.__game!.ui!.hire.rowCenter(0));
  expect(row).not.toBeNull();
  await clickCanvas(page, row!);
  await page.waitForFunction(() => !!window.__game!.game.mercUnit(), undefined, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game!.ui!.mercBar.ready, undefined, { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/npc-merc-hired.png' });
  await walkToBloodMoor(page);
  await page.waitForTimeout(500);
  // 용병이 Blood Moor 로 따라왔다
  const near = await page.evaluate(() => {
    const g = window.__game!.game;
    const u = g.mercUnit()!;
    const p = g.snapshot().player;
    return { d: Math.hypot(u.x - p.x, u.y - p.y), inLevel: g.snapshot().monsters.some((m) => m.merc) };
  });
  expect(near.inLevel).toBe(true);
  expect(near.d).toBeLessThan(10);
  // 트인 곳(주변 12×12 걷기 가능)으로 옮겨 몬스터 하나만 (다른 몬스터는 치운다)
  const mid = await page.evaluate(() => {
    const g = window.__game!.game;
    const m0 = g.map;
    let spot: { x: number; y: number } | null = null;
    for (let y = 20; y < m0.height - 20 && !spot; y += 3)
      for (let x = 20; x < m0.width - 20 && !spot; x += 3) {
        let ok = true;
        for (let dy = -6; dy <= 6 && ok; dy++) for (let dx = -6; dx <= 6 && ok; dx++) if (!m0.walkable(x + dx, y + dy)) ok = false;
        if (ok) spot = { x, y };
      }
    g.changeLevel('bloodmoor', spot!.x + 0.5, spot!.y + 0.5);
    g.monsters.splice(0);
    const p = g.snapshot().player;
    const m = g.spawnMonster('zombie1', p.x + 8, p.y - 2);
    return m.id;
  });
  await page.waitForFunction(
    (id) => {
      const g = window.__game!.game;
      g.character!.life = g.maxLife();
      const s = g.snapshot();
      const m = s.monsters.find((x) => x.id === id);
      return s.missiles.some((x) => x.name === 'rogue1' || x.name === 'firearrow') || !m;
    },
    mid,
    { timeout: 30_000, polling: 50 },
  );
  await page.screenshot({ path: 'test-results/npc-merc-shooting.png' });
  await page.waitForFunction(
    (id) => {
      const g = window.__game!.game;
      g.character!.life = g.maxLife();
      const m = g.snapshot().monsters.find((x) => x.id === id);
      return !m || m.hp < m.maxHp;
    },
    mid,
    { timeout: 30_000 },
  );
});
