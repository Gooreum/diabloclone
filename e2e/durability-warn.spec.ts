import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 사용자 신고 재현 → 수정 뒤 회귀 방지: 내구도가 낮으면 화면 오른쪽 위에 원작 invwarn 아이콘(노랑), 0 이면 빨강.
// 인벤토리를 열면 부서진 아이템 칸은 빨간 바탕, 마우스를 올리면 이름이 빨강.
// 출처: Arreat Summit basics · Amazon Basin wiki Durability · 원작 PANEL\invwarn.DC6

/**
 * 화면 영역의 노랑·빨강 픽셀 수. 원작 invwarn 팔레트 색은 흐린 카키(128,128,96 · 160,128,96 …)와
 * 어두운 빨강(128,64,32 · 192,64,64 …)이라 밝기 대신 색 차이로 가른다. 바닥도 카키라 시작값과의 차이로 판정한다.
 */
async function countColors(page: Page, box: { x: number; y: number; w: number; h: number }): Promise<{ yellow: number; red: number }> {
  return page.evaluate(async (b) => {
    const img = await window.__game!.capture!();
    let yellow = 0, red = 0;
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) {
        const i = (y * img.width + x) * 4, r = img.data[i]!, g = img.data[i + 1]!, bl = img.data[i + 2]!;
        if (r > 110 && r > g + 50 && r > bl + 50) red++;
        else if (r > 90 && g > 80 && bl < g - 15 && r - g < 50) yellow++;
      }
    return { yellow, red };
  }, box);
}

// 첫 아이콘 (오른쪽 끝) · 둘째 아이콘 자리 — hud.drawWarnings: x = 800-8-40-i*44, y = 34, 40×41
const ICON1 = { x: 752, y: 34, w: 40, h: 41 };
const ICON2 = { x: 708, y: 34, w: 40, h: 41 };

test('내구도 경고: 낮으면 노란 아이콘, 0 이면 빨강, 인벤토리에선 빨간 바탕·빨간 이름', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Dura'));
  await page.waitForTimeout(500);

  // 시작: 경고 없음
  const none = await countColors(page, ICON1);
  console.log('[dura] start', none);
  expect(none.red).toBeLessThan(40);

  // 1) 오른손 무기 내구도 10% → 노란 아이콘
  const max = await page.evaluate(() => {
    const w = window.__game!.game.store.equipment.rarm!;
    w.durability = Math.max(1, Math.floor(w.maxDurability * 0.1));
    return w.maxDurability;
  });
  expect(max).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const lowc = await countColors(page, ICON1);
  console.log('[dura] low', lowc);
  expect(lowc.yellow - none.yellow).toBeGreaterThanOrEqual(120);
  await page.screenshot({ path: 'test-results/durability-warn-low.png', clip: { x: 600, y: 0, width: 200, height: 100 } });

  // 2) 내구도 0 → 빨간 아이콘, 노랑은 사라짐
  await page.evaluate(() => { window.__game!.game.store.equipment.rarm!.durability = 0; });
  await page.waitForTimeout(300);
  const broken = await countColors(page, ICON1);
  console.log('[dura] broken', broken);
  expect(broken.red - none.red).toBeGreaterThanOrEqual(150);
  expect(broken.yellow).toBeLessThan(lowc.yellow - 60);
  await page.screenshot({ path: 'test-results/durability-warn.png' });

  // 3) 인벤토리를 열어도 (창은 x 400~720 이라 오른쪽 끝 아이콘을 안 가린다) 아이콘은 그대로, 무기 칸 바탕은 빨강
  await page.keyboard.press('i');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.inventory.open)).toBe(true);
  await page.waitForTimeout(300);
  const covered = await countColors(page, ICON1);
  console.log('[dura] inventory open', covered);
  expect(covered.red - none.red).toBeGreaterThanOrEqual(150);
  const slot = await page.evaluate(() => window.__game!.ui!.inventory.layout.slots.rarm);
  // 칸 왼쪽 위 모서리 안쪽 (아이템 그림을 피해) 빨간 바탕인지
  const corner = await page.evaluate(async (r) => {
    const img = await window.__game!.capture!();
    let reddish = 0, all = 0;
    for (let y = r.t + 2; y < r.t + 8; y++)
      for (let x = r.l + 2; x < r.l + 8; x++) {
        const i = (y * img.width + x) * 4;
        if (img.data[i]! > img.data[i + 1]! + 30 && img.data[i]! > img.data[i + 2]! + 30) reddish++;
        all++;
      }
    return reddish / all;
  }, slot);
  console.log('[dura] slot corner reddish ratio', corner.toFixed(2));
  expect(corner).toBeGreaterThan(0.5);

  // 4) 진짜 마우스를 무기 칸에 올리면 툴팁 이름이 빨강
  const canvas = (await page.locator('#game').boundingBox())!;
  await page.mouse.move(canvas.x + (slot.l + slot.r) / 2, canvas.y + (slot.t + slot.b) / 2);
  await page.waitForTimeout(300);
  const tip = await page.evaluate(() => {
    const w = window.__game!, m = w.input!.mouse;
    if (!m) return null;
    const it = w.ui!.inventory.itemAt(w.game.store, m.x, m.y);
    const ch = w.game.character!;
    return it ? w.ui!.itemText.lines(it, { level: ch.level, str: ch.str, dex: ch.dex, cls: ch.cls })[0] : null;
  });
  console.log('[dura] tooltip first line', tip);
  expect(tip?.color).toBe('#ff5050');
  await page.screenshot({ path: 'test-results/durability-warn-tooltip.png' });

  // 5) 몸통 갑옷도 부서지면 아이콘 2개 (인벤토리 닫고 확인)
  await page.keyboard.press('i');
  await page.evaluate(() => {
    const g = window.__game!.game, d = g.data!;
    const a = d.treasure.createItem(d.items.base('qui')!, 1, g.rng, 2);
    a.durability = 0;
    g.store.equipment.tors = a;
  });
  await page.waitForTimeout(300);
  const two = await Promise.all([countColors(page, ICON1), countColors(page, ICON2)]);
  console.log('[dura] two icons', two);
  expect(two[0]!.red - none.red).toBeGreaterThanOrEqual(150);
  expect(two[1]!.red).toBeGreaterThanOrEqual(150);
  await page.screenshot({ path: 'test-results/durability-warn-two.png', clip: { x: 600, y: 0, width: 200, height: 100 } });
  expect(errors).toEqual([]);
});
