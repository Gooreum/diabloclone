import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(180_000);

/**
 * 레벨 from 의 to 로 가는 이동 타일에서 걸어서 8 칸 떨어진 곳으로 옮긴 뒤, 입구 그림(LvlWarp Select 상자 중앙)을 클릭하는 move 명령.
 * 걷기 거리는 출구 사각형의 걷기 가능한 칸에서 시작하는 BFS 로 잰다 (절벽 너머 같은 닿지 않는 곳을 고르지 않도록).
 */
async function clickWarp(page: Page, from: string, to: string): Promise<void> {
  const ok = await page.evaluate(
    ([from, to]) => {
      const g = window.__game!.game;
      if (g.levelId !== from) g.changeLevel(from!, 1, 1);
      const m = g.map;
      const e = g.exits.find((x) => x.to === to && x.warp);
      if (!e?.warp) return false;
      const dist = new Map<number, number>();
      const q: number[] = [];
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (m.walkable(x, y)) { dist.set(y * m.width + x, 0); q.push(y * m.width + x); }
      let pick: number | null = null;
      while (q.length && pick === null) {
        const k = q.shift()!;
        const d = dist.get(k)!;
        const x = k % m.width, y = Math.floor(k / m.width);
        const inExit = x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h;
        if (d >= 8 && !inExit) { pick = k; break; }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx!, ny = y + dy!, nk = ny * m.width + nx;
          if (m.walkable(nx, ny) && !dist.has(nk)) { dist.set(nk, d + 1); q.push(nk); }
        }
      }
      if (pick === null) return false;
      g.changeLevel(from!, (pick % m.width) + 0.5, Math.floor(pick / m.width) + 0.5);
      // 클릭 = Select 상자 중앙의 화면 좌표 → 서브타일 (render/iso.ts screenToWorld)
      const w = e.warp;
      const px = w.selectX + w.selectDX / 2, py = w.selectY + w.selectDY / 2;
      g.enqueue({ type: 'move', x: w.x + py / 16 + px / 32, y: w.y + py / 16 - px / 32, run: true });
      return true;
    },
    [from, to],
  );
  expect(ok, `${from} → ${to} 이동 타일`).toBe(true);
  await page.waitForFunction((k) => window.__game!.game.levelId === k, to, { timeout: 20_000 });
}

/** 캔버스에서 어둡지 않은 픽셀 비율 */
async function litRatio(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.getElementById('game') as HTMLCanvasElement;
    const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 30) lit++;
    return lit / (c.width * c.height);
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
