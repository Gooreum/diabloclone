import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 800×600 무대를 창 크기에 맞춰 키운다 (비율 유지, 가운데). 확대돼도 클릭은 게임 좌표 그대로 맞아야 한다.

const stageBox = (page: Page) => page.locator('#stage').boundingBox();

/** 게임 좌표(800×600) → 화면 좌표 */
async function toScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const b = (await stageBox(page))!;
  return { x: b.x + (x * b.width) / 800, y: b.y + (y * b.height) / 600 };
}

test.describe('창 1600×1200', () => {
  test.use({ viewport: { width: 1600, height: 1200 } });

  test('무대가 창을 꽉 채우고, 조작판 단추·월드 클릭이 정확하다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await newHero(page, uniqueName('Big'), 'sorceress');
    const b = (await stageBox(page))!;
    expect(Math.round(b.width)).toBe(1600);
    expect(Math.round(b.height)).toBe(1200);
    expect(Math.round(b.x)).toBe(0);

    // 조작판 미니 패널 단추 → 인벤토리 단추 (둘 다 캔버스 안 작은 칸이라 좌표가 조금만 틀려도 빗나간다)
    const menuBtn = await page.evaluate(() => window.__game!.ui!.hud.center('menuBtn'));
    let p = await toScreen(page, menuBtn.x, menuBtn.y);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => window.__game!.ui!.hud.miniOpen === true);
    const inv = await page.evaluate(() => window.__game!.ui!.hud.center('inv'));
    p = await toScreen(page, inv.x, inv.y);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => window.__game!.ui!.inventory.open === true);
    await page.keyboard.press('Escape');

    // 월드 클릭: 게임 좌표 (520, 360) = 플레이어 오른쪽 아래 → 그쪽으로 걷는다
    const before = await page.evaluate(() => window.__game!.game.snapshot().player);
    p = await toScreen(page, 520, 360);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => window.__game!.game.snapshot().player);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(2);
    expect(after.x - before.x).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/scale-1600.png' });
    expect(errors).toEqual([]);
  });
});

test.describe('가로로 긴 창 1920×800', () => {
  test.use({ viewport: { width: 1920, height: 800 } });

  test('높이에 맞추고 가로 가운데', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
    const b = (await stageBox(page))!;
    expect(Math.round(b.height)).toBe(800);
    expect(Math.round(b.width)).toBe(1067);
    expect(Math.abs(b.x - (1920 - b.width) / 2)).toBeLessThan(2);
    await page.screenshot({ path: 'test-results/scale-wide-menu.png' });
  });
});
