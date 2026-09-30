import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);

// 원작 DRLG 로 생성된 Act 4 레벨들이 Act 4 팔레트·원작 타일로 그려지는지.
// 레벨마다 볼 곳(요새 도착 위치 / 트인 곳 / 도시 웨이포인트 / 헬포지 / 디아블로 자리)으로 순간이동 후 스크린샷.
test('Act 4: 요새·초원·절망의 평원·저주받은 도시·불꽃의 강(헬포지)·카오스 생추어리가 원작 DRLG 로 생성되어 렌더링된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Hell'));
  // 막 파일(DS1/DT1/팔레트)을 다 읽을 때까지 막 전환을 다시 시도 (원작: 막에 처음 들어갈 때 DRLG 할당)
  await page.waitForFunction(() => window.__game!.game.changeAct(3), undefined, { timeout: 120_000, polling: 500 });
  expect(await page.evaluate(() => window.__game!.game.levelId)).toBe('pandemonium');
  expect(await page.evaluate(() => window.__game!.game.act)).toBe(3);

  // target: 'start' = 막 도착 위치, 'open' = 레벨 중앙에서 가까운 트인 곳, 숫자 = 그 오브젝트(classId) 근처
  const visits: [string, 'start' | 'open' | number][] = [
    ['pandemonium', 'start'], ['outersteppes', 'open'], ['plainsofdespair', 'open'], ['cityofthedamned', 238], ['riverofflame', 376], ['chaossanctuary', 255],
  ];
  for (const [key, target] of visits) {
    const where = await page.evaluate(([k, t]) => {
      const g = window.__game!.game;
      if (t !== 'start') {
        g.changeLevel(k, 1, 1);
        const m = g.map;
        const def = g.levelDef(k)!;
        const o = typeof t === 'number' ? def.objects?.find((x) => x.classId === t) : undefined;
        const cx = o ? o.x : m.width / 2, cy = o ? o.y : m.height / 2;
        // 목표에서 가장 가까운, 사방 3 서브타일이 트인 곳
        let best = { x: cx, y: cy }, bd = Infinity;
        for (let y = 4; y < m.height - 4; y++)
          for (let x = 4; x < m.width - 4; x++) {
            let ok = true;
            for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
            const d = Math.hypot(x - cx, y - cy);
            if (ok && d < bd) { bd = d; best = { x, y }; }
          }
        g.changeLevel(k, best.x + 0.5, best.y + 0.5);
        // Phase 5 부터 몬스터가 원작 AI 로 싸운다 — 레벨 그림만 보는 테스트라 레벨 몬스터를 멈춘다 (1 레벨 영웅이 죽지 않게)
        for (const mo of g.monsters) mo.nextThink = 1e12;
        return { found: !!o || typeof t !== 'number', dist: bd };
      }
      return { found: true, dist: 0 };
    }, [key, target] as const);
    expect(where.found, key).toBe(true);
    if (typeof target === 'number') expect(where.dist, key).toBeLessThan(20);
    await page.waitForTimeout(900);
    const stats = await page.evaluate(async () => {
      // 월드(WebGL)와 UI 를 합성한 화면
      const c = await window.__game!.capture!();
      const d = c.data;
      let lit = 0, red = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] ?? 0, gg = d[i + 1] ?? 0, b = d[i + 2] ?? 0;
        if (r + gg + b > 30) lit++;
        if (r > 120 && r > gg * 1.6 && r > b * 1.6) red++;
      }
      return { lit: lit / (c.width * c.height), red: red / (c.width * c.height) };
    });
    await page.locator('#game').screenshot({ path: `test-results/act4-${key}.png` });
    expect(await page.evaluate(() => window.__game!.game.levelId)).toBe(key);
    expect(stats.lit, key).toBeGreaterThan(0.25);
    // 불꽃의 강·카오스 생추어리: 용암(붉은 칸)이 보인다
    if (key === 'riverofflame' || key === 'chaossanctuary') expect(stats.red, key).toBeGreaterThan(0.01);
  }
  expect(errors).toEqual([]);
});
