import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { clickWarp, newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(180_000);

/** 캔버스에서 어둡지 않은 픽셀 비율 */
async function litRatio(page: Page): Promise<number> {
  return page.evaluate(async () => {
    // 월드(WebGL)와 UI 를 합성한 화면
    const img = await window.__game!.capture!();
    const d = img.data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 30) lit++;
    return lit / (img.width * img.height);
  });
}

// 원작 미로 DRLG 로 생성된 Act 1 던전: 입구를 클릭해 들어가고, 원작 타일(벽·바닥)로 그려지며, 출구로 나오면 입구 옆
test('Act 1 던전: Den of Evil·Crypt 입구를 클릭해 들어가고 원작 타일로 렌더링된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Dun'));

  await clickWarp(page, 'bloodmoor', 'denofevil');
  await page.waitForTimeout(800);
  await page.locator('#game').screenshot({ path: 'test-results/act1-dungeon-denofevil.png' });
  expect(await litRatio(page)).toBeGreaterThan(0.2);

  // 던전 안쪽 트인 곳 (벽과 바닥이 함께 보이는 곳)
  await page.evaluate(() => {
    const g = window.__game!.game;
    const m = g.map;
    const p = g.snapshot().player;
    let best = { x: p.x, y: p.y }, bd = Infinity;
    for (let y = 4; y < m.height - 4; y += 2)
      for (let x = 4; x < m.width - 4; x += 2) {
        let ok = true;
        for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
        const d = Math.hypot(x - m.width / 2, y - m.height / 2);
        if (ok && d < bd) { bd = d; best = { x, y }; }
      }
    g.changeLevel('denofevil', best.x + 0.5, best.y + 0.5);
  });
  await page.waitForTimeout(800);
  await page.locator('#game').screenshot({ path: 'test-results/act1-dungeon-denofevil-inside.png' });
  expect(await litRatio(page)).toBeGreaterThan(0.2);

  // 계단(출구)을 클릭해 나오면 Blood Moor 의 입구 옆
  await clickWarp(page, 'denofevil', 'bloodmoor');
  const near = await page.evaluate(() => {
    const g = window.__game!.game;
    const e = g.exits.find((x) => x.to === 'denofevil')!;
    const p = g.snapshot().player;
    return Math.hypot(p.x - e.warp!.x, p.y - e.warp!.y);
  });
  expect(near).toBeLessThan(12);

  await clickWarp(page, 'burialgrounds', 'crypt');
  await page.waitForTimeout(800);
  await page.locator('#game').screenshot({ path: 'test-results/act1-dungeon-crypt.png' });
  expect(await litRatio(page)).toBeGreaterThan(0.2);

  // 수도원 안쪽 (감옥·카타콤) 과 트리스트럼(디버그 경로) 도 원작 타일로
  for (const key of ['jail1', 'catacombs2', 'tristram']) {
    await page.evaluate((k) => {
      const g = window.__game!.game;
      g.changeLevel(k, 1, 1);
      const m = g.map;
      let best = { x: m.width / 2, y: m.height / 2 }, bd = Infinity;
      for (let y = 4; y < m.height - 4; y += 2)
        for (let x = 4; x < m.width - 4; x += 2) {
          let ok = true;
          for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
          const d = Math.hypot(x - m.width / 2, y - m.height / 2);
          if (ok && d < bd) { bd = d; best = { x, y }; }
        }
      g.changeLevel(k, best.x + 0.5, best.y + 0.5);
    }, key);
    await page.waitForTimeout(800);
    await page.locator('#game').screenshot({ path: `test-results/act1-dungeon-${key}.png` });
    expect(await litRatio(page), key).toBeGreaterThan(0.2);
  }
  expect(errors).toEqual([]);
});
