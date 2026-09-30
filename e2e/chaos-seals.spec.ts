import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(600_000);

// 원작 A4Q2: 봉인 5 개를 열면 봉인 보스 3 (Grand Vizier·Lord De Seis·Infector) — 셋을 잡으면 디아블로.
// 맵은 게임마다 다르므로 여러 판에서 보스가 입구에서 걸어 갈 수 있는 곳에 생기는지 본다.
test('카오스 생추어리: 봉인을 열면 그 보스가 화면 안(걸어갈 수 있는 곳)에 나타나고, 셋을 잡으면 디아블로 (3판)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (let run = 0; run < 3; run++) {
    await newHero(page, uniqueName('Seal'), 'sorceress');
    await page.evaluate(() => {
      const c = window.__game!.game.character!;
      c.maxLife = c.life = 1e6;
    });
    await page.waitForFunction(() => window.__game!.game.travelAct(3, true), undefined, { timeout: 150_000, polling: 2000 });
    await page.evaluate(() => window.__game!.game.changeLevel('chaossanctuary', 1, 1));
    // 입구(강 쪽 출구)에서 걸어서 갈 수 있는 칸 (BFS) — 실제 플레이처럼 이 칸들로만 다닌다
    await page.evaluate(() => {
      const g = window.__game!.game;
      const m = g.map, d = g.levelDef('chaossanctuary')!;
      const ex = d.exits[0]!;
      const seen = new Uint8Array(m.width * m.height);
      const q: number[] = [];
      const cx = Math.floor(ex.x + ex.w / 2), cy = Math.floor(ex.y + ex.h / 2);
      for (let r = 0; r < 12 && !q.length; r++)
        for (let y = cy - r; y <= cy + r && !q.length; y++)
          for (let x = cx - r; x <= cx + r; x++) if (m.walkable(x, y)) { q.push(y * m.width + x); seen[y * m.width + x] = 1; break; }
      for (let h = 0; h < q.length; h++) {
        const i = q[h]!, x = i % m.width, y = Math.floor(i / m.width);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy, k = ny * m.width + nx;
          if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height || seen[k] || !m.walkable(nx, ny)) continue;
          seen[k] = 1;
          q.push(k);
        }
      }
      (window as unknown as { __reach: Uint8Array }).__reach = seen;
    });
    const seals = await page.evaluate(() => window.__game!.game.objects.filter((o) => o.type.id >= 392 && o.type.id <= 396).map((o) => ({ id: o.id, x: o.x, y: o.y })));
    expect(seals.length).toBe(5);
    // 봉인마다 곁으로 가서 클릭과 같은 interact 로 연다
    for (const s of seals) {
      await page.evaluate((s) => {
        const g = window.__game!.game;
        const seen = (window as unknown as { __reach: Uint8Array }).__reach;
        let best: [number, number] | null = null, bd = Infinity;
        for (let dy = -8; dy <= 8; dy++)
          for (let dx = -8; dx <= 8; dx++) {
            const x = Math.floor(s.x) + dx, y = Math.floor(s.y) + dy, d = Math.hypot(dx, dy);
            if (d >= 1.5 && d < bd && seen[y * g.map.width + x]) { bd = d; best = [x, y]; }
          }
        if (best) g.changeLevel(g.levelId, best[0] + 0.5, best[1] + 0.5);
        for (const m of g.monsters) m.nextThink = 1e12;
        g.enqueue({ type: 'interact', unitId: s.id });
      }, s);
      await page.waitForFunction((id) => (window.__game!.game.objects.find((o) => o.id === id)?.mode ?? 0) > 0, s.id, { timeout: 10_000 });
      // 보스 봉인(392·394·396)이면 그 보스가 곧 화면에 그려진다 (클릭 상자)
      const boss = await page.evaluate((id) => {
        const g = window.__game!.game;
        const o = g.objects.find((x) => x.id === id)!;
        const su = ({ 392: 36, 394: 37, 396: 38 } as Record<number, number>)[o.type.id];
        const b = su ? g.monsters.find((m) => m.superUnique === su) : undefined;
        const p = g.snapshot().player;
        return su ? { su, id: b?.id ?? -1, dist: b ? Math.hypot(b.x - p.x, b.y - p.y) : 999 } : null;
      }, s.id);
      if (boss) {
        expect(boss.dist, `boss ${boss.su}`).toBeLessThanOrEqual(15);
        await page.waitForFunction((id) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'monster' && b.id === id), boss.id, { timeout: 5000 });
      }
    }
    // 보스 3 마리가 입구에서 걸어서 갈 수 있는 곳에 있다
    const reach = await page.evaluate(() => {
      const g = window.__game!.game;
      const seen = (window as unknown as { __reach: Uint8Array }).__reach;
      return g.monsters.filter((b) => b.sealBoss).map((b) => ({ su: b.superUnique, ok: !!seen[Math.floor(b.y) * g.map.width + Math.floor(b.x)] }));
    });
    console.log(`[seal] run ${run}`, JSON.stringify(reach));
    if (!reach.every((r) => r.ok)) await page.locator('#game').screenshot({ path: `test-results/chaos-seals-fail-${run}.png` });
    expect(reach.map((r) => r.su).sort()).toEqual([36, 37, 38]);
    expect(reach.every((r) => r.ok)).toBe(true);
    // 셋을 잡으면 (디버그: 엔진 처치) 디아블로가 가운데에 나온다
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const g = window.__game!.game;
        const b = g.monsters.find((m) => m.sealBoss && m.mode !== 'DT' && m.mode !== 'DD');
        if (b) (g as unknown as { killMonster(m: unknown, s: string): void }).killMonster(b, 'player');
      });
      await page.waitForTimeout(200);
    }
    await page.waitForFunction(() => window.__game!.game.monsters.some((m) => m.type.id === 'diablo'), undefined, { timeout: 10_000 });
    if (run === 0) await page.locator('#game').screenshot({ path: 'test-results/chaos-seals.png' });
    await page.reload();
  }
  expect(errors).toEqual([]);
});
