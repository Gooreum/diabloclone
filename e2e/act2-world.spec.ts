import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(300_000);

// 원작 DRLG 로 생성된 Act 2 레벨들이 Act 2 팔레트·원작 타일로 그려지는지.
// 레벨마다 볼 곳(마을 도착 위치 / 트인 곳 / 오브젝트 근처)으로 순간이동 후 스크린샷 (test-results/act2-*.png).
// 협곡·무덤·두리엘 방은 퀘스트 포털(Phase 7) 전이라 changeLevel 로 바로 간다.
test('Act 2: 루트 골레인·사막 야외·하수도·비전의 성역·탈 라샤 무덤·두리엘 방이 원작 DRLG 로 생성되어 렌더링된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Lut'));
  // 막 파일(DS1/DT1/팔레트)을 다 읽을 때까지 막 전환을 다시 시도 (원작: 막에 처음 들어갈 때 DRLG 할당)
  await page.waitForFunction(() => window.__game!.game.changeAct(1), undefined, { timeout: 150_000, polling: 500 });
  expect(await page.evaluate(() => window.__game!.game.levelId)).toBe('lutgholein');
  expect(await page.evaluate(() => window.__game!.game.act)).toBe(1);

  // 진짜 탈 라샤 무덤 = 오리피스(objects.txt 152)가 있는 무덤
  const realTomb = await page.evaluate(() => {
    const g = window.__game!.game;
    for (let i = 1; i <= 7; i++) if (g.levelDef(`taltomb${i}`)?.objects?.some((o) => o.classId === 152)) return `taltomb${i}`;
    return null;
  });
  expect(realTomb).not.toBeNull();

  // target: 'start' = 막 도착 위치, 'open' = 레벨 중앙에서 가까운 트인 곳, 'wp' = 웨이포인트 근처, 숫자 = 그 오브젝트(classId) 근처
  const visits: [string, 'start' | 'open' | 'wp' | number][] = [
    ['lutgholein', 'start'], ['rockywaste', 'open'], ['dryhills', 'wp'], ['faroasis', 'wp'], ['lostcity', 'wp'],
    ['sewers1', 'open'], ['arcane', 298], ['canyon', 402], [realTomb!, 152], ['durielslair', 'open'],
  ];
  for (const [key, target] of visits) {
    const where = await page.evaluate(([k, t]) => {
      const g = window.__game!.game;
      if (t === 'start') return { found: true, dist: 0 };
      g.changeLevel(k, 1, 1);
      const m = g.map;
      const def = g.levelDef(k)!;
      // 출처: objects.txt SubClass 64 (웨이포인트) 오브젝트 번호
      const WP = [119, 145, 156, 157, 237, 238, 288, 323, 324, 398, 402, 429, 494, 496, 511, 539];
      const o = typeof t === 'number' ? def.objects?.find((x) => x.classId === t) : t === 'wp' ? def.objects?.find((x) => WP.includes(x.classId)) : undefined;
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
      // 스크린샷은 타일 확인용: 첫 방문에 배치된 몬스터는 치운다 (Act 2 몬스터 AI 는 Phase 5)
      g.monsters.length = 0;
      return { found: !!o || t === 'open', dist: bd };
    }, [key, target] as const);
    expect(where.found, key).toBe(true);
    if (target !== 'open') expect(where.dist, key).toBeLessThan(30);
    await page.waitForTimeout(900);
    const lit = await page.evaluate(() => {
      const c = document.getElementById('game') as HTMLCanvasElement;
      const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 30) n++;
      return n / (c.width * c.height);
    });
    const shot = key.startsWith('taltomb') ? 'taltomb' : key;
    await page.locator('#game').screenshot({ path: `test-results/act2-${shot}.png` });
    expect(await page.evaluate(() => window.__game!.game.levelId)).toBe(key);
    expect(lit, key).toBeGreaterThan(0.2);
  }
  expect(errors).toEqual([]);
});

// 원작 규칙 그대로의 출구: 루트 골레인 가장자리로 걸어 나가면 Rocky Waste, 하수도 입구를 밟으면 하수도
test('Act 2: 마을 가장자리 → Rocky Waste, 하수도 입구 → 하수도 (출구로 걸어서)', async ({ page }) => {
  await newHero(page, uniqueName('Wst'));
  await page.waitForFunction(() => window.__game!.game.changeAct(1), undefined, { timeout: 150_000, polling: 500 });
  for (const to of ['rockywaste', 'sewers1']) {
    const ok = await page.evaluate((to) => {
      const g = window.__game!.game;
      g.changeLevel('lutgholein', g.snapshot().player.x, g.snapshot().player.y);
      const m = g.map;
      const e = g.exits.find((x) => x.to === to);
      if (!e) return false;
      for (let y = e.y; y < e.y + e.h; y++)
        for (let x = e.x; x < e.x + e.w; x++) {
          if (!m.walkable(x, y)) continue;
          g.changeLevel('lutgholein', x + 0.5, y + 0.5);
          return true;
        }
      return false;
    }, to);
    expect(ok, to).toBe(true);
    await page.waitForFunction((k) => window.__game!.game.levelId === k, to, { timeout: 10_000 });
    await page.waitForTimeout(600);
    await page.locator('#game').screenshot({ path: `test-results/act2-enter-${to}.png` });
  }
});
