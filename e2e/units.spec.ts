import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('Blood Moor 몬스터를 좌클릭하면 다가가서 공격한다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Unit'));
  await walkToBloodMoor(page);
  const id = await page.evaluate(() => {
    const g = window.__game!.game;
    const m = g.map;
    // 원작 DRLG 레벨은 나무·강·울타리가 많다 — 사방 8 서브타일이 트인, 다른 몬스터와 떨어진 곳으로 옮긴다
    const open = (x: number, y: number) => {
      for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (!m.walkable(x + dx, y + dy)) return false;
      return g.monsters.every((mo) => Math.hypot(mo.x - x, mo.y - y) > 25);
    };
    let spot = { x: g.snapshot().player.x, y: g.snapshot().player.y };
    search: for (let y = 10; y < m.height - 10; y += 3) for (let x = 10; x < m.width - 10; x += 3) if (open(x, y)) { spot = { x: x + 0.5, y: y + 0.5 }; break search; }
    g.changeLevel(g.levelId, spot.x, spot.y);
    return g.spawnMonster('fallen1', spot.x + 5, spot.y + 1).id;
  });
  await page.waitForFunction((mid) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'monster' && b.id === mid), id, { timeout: 10_000 });
  await page.waitForTimeout(700); // 원작 DCC 스프라이트 로딩 대기 (스크린샷용)
  await page.locator('#game').screenshot({ path: 'test-results/units.png' });
  const box = await page.evaluate((mid) => window.__game!.input!.pickBoxes.find((b) => b.kind === 'monster' && b.id === mid)!, id);
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await page.waitForFunction(() => window.__game!.game.snapshot().player.mode === 'A1', undefined, { timeout: 10_000 });
  expect(errors).toEqual([]);
});
