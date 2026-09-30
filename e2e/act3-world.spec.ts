import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);

// 원작 DRLG 로 생성된 Act 3 레벨들이 Act 3 팔레트·원작 타일로 그려지는지.
// 레벨마다 볼 곳(부두 도착 위치 / 레벨 중앙에서 가까운 트인 곳)으로 순간이동 후 스크린샷 (test-results/act3-*.png).
test('Act 3: 부두·정글 3 개·쿠라스트·트라빈칼·사원·억류지 3층·꽃불 던전이 원작 DRLG 로 생성되어 렌더링된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Kurast'));
  // 막 파일(DS1/DT1/팔레트)을 다 읽을 때까지 막 전환을 다시 시도 (원작: 막에 처음 들어갈 때 DRLG 할당)
  await page.waitForFunction(() => window.__game!.game.changeAct(2), undefined, { timeout: 120_000, polling: 500 });
  expect(await page.evaluate(() => window.__game!.game.levelId)).toBe('kurastdocks');
  expect(await page.evaluate(() => window.__game!.game.act)).toBe(2);

  const visits: [string, 'start' | 'open'][] = [
    ['kurastdocks', 'start'], ['spiderforest', 'open'], ['greatmarsh', 'open'], ['flayerjungle', 'open'], ['lowerkurast', 'open'],
    ['travincal', 'open'], ['ruinedtemple', 'open'], ['durance3', 'open'], ['flayerdungeon1', 'open'],
  ];
  for (const [key, target] of visits) {
    const where = await page.evaluate(([k, t]) => {
      const g = window.__game!.game;
      if (t === 'start') return { dist: 0 };
      g.changeLevel(k, 1, 1);
      const m = g.map;
      const cx = m.width / 2, cy = m.height / 2;
      // 레벨 중앙에서 가장 가까운, 사방 3 서브타일이 트인 곳
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
      return { dist: bd };
    }, [key, target] as const);
    expect(where.dist, key).toBeLessThan(Infinity);
    await page.waitForTimeout(900);
    const lit = await page.evaluate(async () => {
      // 월드(WebGL)와 UI 를 합성한 화면
      const img = await window.__game!.capture!();
      const d = img.data;
      // 실내 레벨은 빛 반경 밖이 어둡다 (원작 조명) — 플레이어 둘레 가운데 영역만 잰다
      let n = 0, t = 0;
      for (let y = 150; y < 450; y++)
        for (let x = 250; x < 550; x++) {
          const i = (y * img.width + x) * 4;
          t++;
          if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 30) n++;
        }
      return n / t;
    });
    await page.locator('#game').screenshot({ path: `test-results/act3-${key}.png` });
    expect(await page.evaluate(() => window.__game!.game.levelId)).toBe(key);
    expect(lit, key).toBeGreaterThan(0.2);
  }
  expect(errors).toEqual([]);
});
