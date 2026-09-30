import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 개발용 99레벨 프리셋 (src/presets, scripts/gen-presets.ts): ?preset=<직업> 은 메뉴 없이 Hell Act 1 마을에서 바로 시작

test('?preset=sorceress: 메뉴 없이 Hell 마을, 레벨 99, 사양 장비, 퀘스트 보상을 다시 받지 않는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?preset=sorceress');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1 && window.__game!.game.npcs.length > 0, undefined, { timeout: 30_000 });
  const info = await page.evaluate(() => {
    const g = window.__game!.game;
    const c = g.character!;
    const d = g.snapshot().player as unknown as { life: number; maxLife: number; mana: number; maxMana: number };
    return { full: d.life >= d.maxLife && d.mana >= d.maxMana, level: c.level, cls: c.cls, difficulty: g.difficulty, inTown: g.inTown, slots: Object.keys(g.equipment).sort(), statPoints: c.statPoints, skillPoints: c.skillPoints };
  });
  expect(info).toMatchObject({ full: true, level: 99, cls: 'Sorceress', difficulty: 2, inTown: true, statPoints: 0, skillPoints: 0 });
  expect(info.slots).toEqual(['belt', 'feet', 'glov', 'head', 'lrin', 'neck', 'rarm', 'rrin', 'tors']);
  // 몇 초 게임을 돌려도 퀘스트 보상(스킬·스탯 포인트)이 다시 들어오지 않는다
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => [window.__game!.game.character!.statPoints, window.__game!.game.character!.skillPoints])).toEqual([0, 0]);
  await page.keyboard.press('c');
  await page.keyboard.press('i');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/preset-sorceress.png' });
  expect(errors).toEqual([]);
});

test('?preset=all: 캐릭터 목록에 프리셋 5개', async ({ page }) => {
  await page.goto('/?preset=all');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  for (const n of ['Preset-Amazon', 'Preset-Sorc', 'Preset-Necro', 'Preset-Pala', 'Preset-Barb']) await expect(page.locator(`#hero-${n}`)).toHaveCount(1);
});

test('?preset 없이 들어가면 원래 메뉴', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  expect(await page.evaluate(() => window.__game?.ready ?? false)).toBe(false);
});

for (const [id, cls, slots] of [['amazon', 'Amazon', 10], ['necromancer', 'Necromancer', 10], ['paladin', 'Paladin', 10], ['barbarian', 'Barbarian', 9]] as const) {
  test(`?preset=${id}: 오류 없이 시작, 레벨 99, 장비 ${slots}칸, 가득 찬 생명`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/?preset=${id}`);
    await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
    await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1, undefined, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const g = window.__game!.game, c = g.character!, p = g.snapshot().player;
      return { cls: c.cls, level: c.level, difficulty: g.difficulty, slots: Object.keys(g.equipment).length, full: p.life >= p.maxLife, points: c.statPoints + c.skillPoints };
    });
    expect(info).toEqual({ cls, level: 99, difficulty: 2, slots, full: true, points: 0 });
    expect(errors).toEqual([]);
  });
}
