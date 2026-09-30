import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { clickWarp, newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

type Stats = { loads: number; cached: number };
const unitLoads = (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    const url = '/src/render/units.ts';
    return ((await import(/* @vite-ignore */ url)) as { unitGfxStats: Stats }).unitGfxStats.loads;
  });

// 던전에 들어가면 로딩 화면 동안 가까운 몬스터 그림을 미리 불러 둔다 → 들어가자마자 싸워도 새로 읽는 그림이 거의 없다
test('Den of Evil 진입: 로딩 화면이 몬스터 그림 준비를 기다리고, 첫 전투에서 새로 읽는 그림이 거의 없다', async ({ page }) => {
  await newHero(page, uniqueName('Pre'));
  // Blood Moor 의 Den of Evil 입구를 클릭해 실제로 들어간다 (레벨 이동 사건 → 로딩 화면, clickWarp 가 닫힐 때까지 기다림 — 최대 4초는 단위 테스트)
  await clickWarp(page, 'bloodmoor', 'denofevil');
  const before = await unitLoads(page);
  await page.evaluate(() => {
    const g = window.__game!.game;
    const p = g.snapshot().player;
    const near = g.monsters.filter((x) => !x.npc).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]!;
    g.character!.life = g.character!.maxLife = 5000;
    g.enqueue({ type: 'attack', targetId: near.id, standStill: false });
  });
  await page.waitForTimeout(3000);
  const after = await unitLoads(page);
  await page.screenshot({ path: 'test-results/preload-den.png' });
  // 미리 불러 두지 않는 죽기(DT)·시체(DD)·새로 다가온 몬스터 몇 개만 허용
  console.log(`[preload] 첫 전투 새 그림 ${after - before}개`);
  expect(after - before).toBeLessThanOrEqual(12);
});
