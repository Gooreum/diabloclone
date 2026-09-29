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

/** 마을의 Blood Moor 출구 안쪽 걷기 가능한 칸 근처로 옮긴 뒤 출구로 걸어가 Blood Moor 진입 (출구 판정은 엔진 규칙 그대로).
 *  마을 프리셋(TownN1/E1/S1/W1)은 원작처럼 Blood Moor 방향에 따라 바뀌므로 출구 위치는 레벨 정의에서 읽는다. */
export async function walkToBloodMoor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.changeLevel('town', g.snapshot().player.x, g.snapshot().player.y);
    const m = g.map;
    const e = g.exits.find((x) => x.to === 'bloodmoor')!;
    // 출구 사각형의 걷기 가능한 칸, 그 칸에서 레벨 안쪽으로 6 서브타일 떨어진 걷기 가능한 출발점
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const inward = { x: cx < 5 ? 1 : cx > m.width - 5 ? -1 : 0, y: cy < 5 ? 1 : cy > m.height - 5 ? -1 : 0 };
    for (let y = e.y; y < e.y + e.h; y++)
      for (let x = e.x; x < e.x + e.w; x++) {
        const sx = x + inward.x * 6, sy = y + inward.y * 6;
        if (!m.walkable(x, y) || !m.walkable(sx, sy)) continue;
        let ok = true;
        for (let k = 0; k <= 6; k++) if (!m.walkable(x + inward.x * k, y + inward.y * k)) ok = false;
        if (!ok) continue;
        g.changeLevel('town', sx + 0.5, sy + 0.5);
        g.enqueue({ type: 'move', x: x + 0.5, y: y + 0.5, run: true });
        return;
      }
  });
  await page.waitForFunction(() => window.__game!.game.levelId === 'bloodmoor', undefined, { timeout: 10_000 });
}

export const uniqueName = (prefix: string) => `${prefix}${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6)}`;
