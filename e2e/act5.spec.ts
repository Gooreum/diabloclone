import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2exp.mpq') || !existsSync('game-data/lod/patch_d2.mpq'), '원작 확장팩 game-data 필요');
test.setTimeout(300_000);

// 확장팩 Act 5: Act 4 Tyrael 메뉴 (A4Q2 보상 받음) → Harrogath, 웨이포인트 창 5 탭, 야외 (Bloody Foothills) 몬스터,
// Worldstone Keep 2·왕좌가 원작 DRLG 로 그려지는지. 클래식 서버 (D2_EDITION=classic) 는 4 탭·Act 5 없음을 본다.

/** 레벨 가운데에서 가까운, 사방 3 서브타일이 트인 곳으로 (레벨 몬스터는 멈춘다 — 그림만 보는 테스트) */
async function visit(page: Page, key: string): Promise<void> {
  await page.evaluate((k) => {
    const g = window.__game!.game;
    g.changeLevel(k, 1, 1);
    const m = g.map;
    const cx = m.width / 2, cy = m.height / 2;
    let best = { x: cx, y: cy }, bd = Infinity;
    for (let y = 4; y < m.height - 4; y++)
      for (let x = 4; x < m.width - 4; x++) {
        let ok = true;
        for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
        const d = Math.hypot(x - cx, y - cy);
        if (ok && d < bd) { bd = d; best = { x, y }; }
      }
    g.changeLevel(k, best.x + 0.5, best.y + 0.5);
    for (const mo of g.monsters) mo.nextThink = 1e12;
  }, key);
  await page.waitForTimeout(900);
}

async function litRatio(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const c = await window.__game!.capture!();
    let lit = 0;
    for (let i = 0; i < c.data.length; i += 4) if ((c.data[i] ?? 0) + (c.data[i + 1] ?? 0) + (c.data[i + 2] ?? 0) > 30) lit++;
    return lit / (c.width * c.height);
  });
}

test('Act 5: Tyrael → Harrogath (NPC), 5 탭, Bloody Foothills 몬스터, Worldstone Keep 2·왕좌 그리기', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Hrg'));
  test.skip((await page.evaluate(() => window.__edition)) !== 'lod', '확장팩 서버에서만');
  expect(await page.evaluate(() => window.__game!.game.expansion)).toBe(true);
  expect(await page.evaluate(() => window.__game!.ui!.waypoint.tabs)).toBe(5);
  expect(await page.evaluate(() => window.__game!.ui!.quest.tabs)).toBe(5);

  // Act 4 (요새) → A4Q2 보상 받음 → Tyrael 메뉴 "Travel To Harrogath"
  await page.waitForFunction(() => window.__game!.game.changeAct(3), undefined, { timeout: 120_000, polling: 500 });
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.questRecord.set(26, 0);
    const t = g.npcs.find((n) => n.type.id === 'tyrael2')!;
    g.changeLevel(g.levelId, t.x + 2.5, t.y + 1.5);
    g.enqueue({ type: 'interact', unitId: t.id });
  });
  await page.waitForFunction(() => window.__game!.game.snapshot().interaction?.typeId === 'tyrael2', undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__game!.game.snapshot().interaction?.options)).toContain('goHarrogath');
  await page.evaluate(() => window.__game!.game.enqueue({ type: 'npcMenu', option: 'goHarrogath' }));
  await page.waitForFunction(() => window.__game!.game.levelId === 'harrogath', undefined, { timeout: 120_000 });
  await page.waitForFunction(() => window.__game!.game.npcs.some((n) => n.type.id === 'larzuk'), undefined, { timeout: 30_000 });
  const npcs = await page.evaluate(() => window.__game!.game.npcs.map((n) => n.type.id));
  for (const id of ['larzuk', 'malah', 'qual-kehk', 'cain6', 'nihlathak']) expect(npcs, id).toContain(id);
  await page.waitForTimeout(900);
  await page.locator('#game').screenshot({ path: 'test-results/act5-harrogath.png' });
  expect(await litRatio(page)).toBeGreaterThan(0.25);

  // Bloody Foothills: Act 5 몬스터가 놓인다
  await visit(page, 'bloodyfoothills');
  const mons = await page.evaluate(() => window.__game!.game.monsters.filter((m) => !m.npc).map((m) => m.type.id));
  expect(mons.length).toBeGreaterThan(0);
  await page.locator('#game').screenshot({ path: 'test-results/act5-bloodyfoothills.png' });
  expect(await litRatio(page)).toBeGreaterThan(0.25);

  // Worldstone Keep 2 · 왕좌
  for (const key of ['worldstonekeep2', 'throneofdestruction']) {
    await visit(page, key);
    expect(await page.evaluate(() => window.__game!.game.levelId)).toBe(key);
    await page.locator('#game').screenshot({ path: `test-results/act5-${key}.png` });
    expect(await litRatio(page), key).toBeGreaterThan(0.15);
  }
  expect(errors).toEqual([]);
});

test('클래식 서버: 웨이포인트·퀘스트 4 탭, Act 5 로 갈 수 없음', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Cls'));
  test.skip((await page.evaluate(() => window.__edition)) !== 'classic', '클래식 서버 (D2_EDITION=classic) 에서만');
  expect(await page.evaluate(() => window.__game!.game.expansion)).toBe(false);
  expect(await page.evaluate(() => window.__game!.ui!.waypoint.tabs)).toBe(4);
  expect(await page.evaluate(() => window.__game!.ui!.quest.tabs)).toBe(4);
  expect(await page.evaluate(() => window.__game!.game.changeAct(4))).toBe(false);
  expect(errors).toEqual([]);
});
