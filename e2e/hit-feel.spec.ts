import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2sfx.mpq'), '원작 사운드 MPQ 필요');
test.setTimeout(240_000);

// 타격감: 칼로 몬스터를 치면 맞는 소리(impact_*)가 나고 피(blood1·2)가 튄다. 피 그림이 실제로 화면에 그려지는지 스크린샷.
test('프리셋 바바리안이 필드에서 좀비를 치면 impact 소리와 피 그림', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?preset=barbarian');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  // 소리 잠금 해제 (사용자 입력)
  await page.mouse.click(400, 300);
  await page.waitForFunction(() => window.__audio?.unlocked === true, undefined, { timeout: 30_000 });
  const id = await page.evaluate(() => {
    const g = window.__game!.game;
    g.changeLevel('coldplains', 1, 1);
    const m = g.map;
    let best = { x: m.width / 2, y: m.height / 2 }, bd = Infinity;
    for (let y = 6; y < m.height - 6; y += 2)
      for (let x = 6; x < m.width - 6; x += 2) {
        let ok = true;
        for (let dy = -5; dy <= 5 && ok; dy++) for (let dx = -5; dx <= 5; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
        const d = Math.hypot(x - m.width / 2, y - m.height / 2);
        if (ok && d < bd) { bd = d; best = { x, y }; }
      }
    g.changeLevel('coldplains', best.x + 0.5, best.y + 0.5);
    // 다른 몬스터는 치우고 튼튼한 좀비 하나
    for (const o of g.monsters) o.hp = 0;
    const z = g.spawnMonster('zombie1', best.x + 2.5, best.y + 0.5);
    z.hp = z.stats.maxHp = 1e7;
    return z.id;
  });
  const hitAt = Date.now();
  let blood = false;
  for (let i = 0; i < 20 && !blood; i++) {
    await page.evaluate((t) => window.__game!.game.enqueue({ type: 'attack', targetId: t, standStill: true }), id);
    await page.waitForTimeout(250);
    blood = await page.evaluate(() => window.__game!.game.snapshot().missiles.some((m) => m.name === 'blood1' || m.name === 'blood2'));
  }
  expect(blood, '피 그림').toBe(true);
  await page.screenshot({ path: 'test-results/hit-feel-blood.png' });
  await page.waitForFunction(() => (window.__audio?.log ?? []).some((e) => e.name.startsWith('impact_') && e.state === 'playing'), undefined, { timeout: 15_000 });
  const impact = await page.evaluate(() => (window.__audio?.log ?? []).filter((e) => e.name.startsWith('impact_')).map((e) => e.name));
  expect(impact.some((n) => /impact_(blade|blunt)/.test(n)), impact.join(',')).toBe(true);
  expect(Date.now() - hitAt).toBeLessThan(200_000);
  expect(errors).toEqual([]);
});
