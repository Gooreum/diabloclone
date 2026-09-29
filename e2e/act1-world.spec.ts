import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(120_000);

// 원작 DRLG 로 생성된 Act 1 야외 레벨들이 원작 타일로 그려지는지 (레벨마다 트인 곳으로 순간이동 후 스크린샷)
test('Act 1 오버월드: 야외 레벨들이 원작 DRLG 로 생성되어 원작 타일로 렌더링된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('World'));
  for (const key of ['bloodmoor', 'coldplains', 'stonyfield', 'darkwood', 'blackmarsh', 'tamoe', 'burialgrounds']) {
    await page.evaluate((k) => {
      const g = window.__game!.game;
      g.changeLevel(k, 1, 1);
      const m = g.map;
      // 레벨 중앙에서 가장 가까운, 사방 4 서브타일이 트인 곳
      let best = { x: m.width / 2, y: m.height / 2 }, bd = Infinity;
      for (let y = 6; y < m.height - 6; y += 2)
        for (let x = 6; x < m.width - 6; x += 2) {
          let ok = true;
          for (let dy = -4; dy <= 4 && ok; dy++) for (let dx = -4; dx <= 4; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
          const d = Math.hypot(x - m.width / 2, y - m.height / 2);
          if (ok && d < bd) { bd = d; best = { x, y }; }
        }
      g.changeLevel(k, best.x + 0.5, best.y + 0.5);
    }, key);
    await page.waitForTimeout(700);
    const ratio = await page.evaluate(() => {
      const c = document.getElementById('game') as HTMLCanvasElement;
      const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 30) lit++;
      return lit / (c.width * c.height);
    });
    await page.locator('#game').screenshot({ path: `test-results/act1-${key}.png` });
    expect(ratio, key).toBeGreaterThan(0.3);
    expect(await page.evaluate(() => window.__game!.game.levelId)).toBe(key);
  }
  expect(errors).toEqual([]);
});
