import { expect, type Page } from '@playwright/test';

/** 메인메뉴 → Single Player → Create New → 클래스(이름) → 게임 시작 */
export async function newHero(page: Page, name: string, cls = 'barbarian'): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.fill('#hero-name', name);
  await page.click(`#btn-${cls}`);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  await expect(page.locator('#menu')).toBeHidden();
}

/** 마을 동쪽 출구 근처로 옮긴 뒤 출구로 걸어가 Blood Moor 진입 (출구 판정은 엔진 규칙 그대로) */
export async function walkToBloodMoor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__game!.game;
    const m = g.map;
    let y = 100;
    for (let yy = 30; yy < m.height - 30; yy++) if (m.walkable(m.width - 8, yy) && m.walkable(m.width - 2, yy)) { y = yy; break; }
    g.changeLevel('town', m.width - 8.5, y + 0.5);
    g.enqueue({ type: 'move', x: m.width - 1.5, y: y + 0.5, run: true });
  });
  await page.waitForFunction(() => window.__game!.game.levelId === 'bloodmoor', undefined, { timeout: 10_000 });
}

export const uniqueName = (prefix: string) => `${prefix}${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6)}`;
