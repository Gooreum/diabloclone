import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 아이템 전투 특수 속성 (원작 1.14d): 충전 스킬을 스킬 목록 아이템 줄에서 골라 마우스로 쓰면 충전이 준다,
// 발동·오라·충전 설명 문구, 레벨당 생명 (클래식 데이터에도 있는 속성 — 클래식 서버에서도 실행).

async function canvasAt(page: Page, p: { x: number; y: number }, button: 'left' | 'right' = 'left'): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y, { button });
}

const FROZEN_ARMOR = 40;

test('충전 스킬: 스킬 목록 아이템 줄에서 Frozen Armor 를 고르고 쓰면 충전 7 → 6, 설명 문구', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Chg'));
  test.skip((await page.evaluate(() => window.__edition)) !== 'lod', '확장팩 서버에서만');

  // 오른손에 충전 지팡이 (Level 3 Frozen Armor 7/20) + 발동·오라 반지
  await page.evaluate((fa) => {
    const g = window.__game!.game;
    const d = (g as unknown as { data: { treasure: { createItem: (b: unknown, l: number, r: unknown, q: number) => Record<string, unknown> }; items: { base: (c: string) => unknown }; skills: { byNameOf: (n: string) => { id: number } } } }).data;
    const rng = (g as unknown as { rng: unknown }).rng;
    const make = (code: string, stats: { stat: string; param: number; value: number }[]) => Object.assign(d.treasure.createItem(d.items.base(code), 30, rng, 4), { identified: true, stats });
    const eq = g.store.equipment as Record<string, unknown>;
    eq.rarm = make('cst', [{ stat: 'item_charged_skill', param: (fa << 6) | 3, value: (20 << 8) | 7 }]);
    eq.lrin = make('rin', [
      { stat: 'item_skillonhit', param: (d.skills.byNameOf('Amplify Damage').id << 6) | 3, value: 5 },
      { stat: 'item_aura', param: d.skills.byNameOf('Might').id, value: 5 },
    ]);
  }, FROZEN_ARMOR);

  // 오른쪽 스킬 버튼 → 목록의 아이템 줄에 충전 스킬 → 클릭
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.hud.center('rskill')));
  await expect.poll(() => page.evaluate((id) => window.__game!.ui!.hud.menuCenter(id, true), FROZEN_ARMOR)).not.toBeNull();
  const at = (await page.evaluate((id) => window.__game!.ui!.hud.menuCenter(id, true), FROZEN_ARMOR))!;
  await page.mouse.move(0, 0);
  await page.locator('#game').screenshot({ path: 'test-results/item-procs-menu.png' });
  await canvasAt(page, at);
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.rightSkill)).toBe(FROZEN_ARMOR);
  expect(await page.evaluate((id) => window.__game!.game.character!.chargeSkills?.[id], FROZEN_ARMOR)).toBeGreaterThan(0);

  // 마우스 오른쪽으로 사용 → 충전 6, 마나 그대로, Frozen Armor 상태
  const mana = await page.evaluate(() => window.__game!.game.character!.mana);
  await canvasAt(page, { x: 470, y: 260 }, 'right');
  await expect.poll(() => page.evaluate(() => (window.__game!.game.store.equipment.rarm!.stats[0]!.value) & 0xff)).toBe(6);
  expect(await page.evaluate(() => window.__game!.game.character!.mana)).toBeGreaterThanOrEqual(mana);

  // 설명 문구 (원작 string.tbl)
  const lines = await page.evaluate(() => {
    const eq = window.__game!.game.store.equipment;
    const t = (it: unknown) => window.__game!.ui!.itemText.lines(it as never, { level: 1, str: 100, dex: 100, cls: 'Barbarian' }).map((l) => l.text);
    return { staff: t(eq.rarm), ring: t(eq.lrin) };
  });
  expect(lines.staff).toContain('Level 3 Frozen Armor (6/20 Charges)');
  expect(lines.ring).toContain('5% Chance to cast level 3 Amplify Damage on striking');
  expect(lines.ring).toContain('Level 5 Might Aura When Equipped');
  expect(errors).toEqual([]);
});

test('레벨당 생명 (item_hp_perlevel 8): 레벨 10 이면 최대 생명 +10 — 클래식·확장팩 공통', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Plv'));
  const [before, after] = await page.evaluate(() => {
    const g = window.__game!.game;
    g.character!.level = 10;
    const before = g.maxLife();
    const d = (g as unknown as { data: { treasure: { createItem: (b: unknown, l: number, r: unknown, q: number) => Record<string, unknown> }; items: { base: (c: string) => unknown } } }).data;
    const rng = (g as unknown as { rng: unknown }).rng;
    (g.store.equipment as Record<string, unknown>).lrin = Object.assign(d.treasure.createItem(d.items.base('rin'), 30, rng, 4), { identified: true, stats: [{ stat: 'item_hp_perlevel', param: 0, value: 8 }] });
    (g as unknown as { statsDirty: boolean }).statsDirty = true;
    return [before, g.maxLife()];
  });
  expect(after).toBe(before + 10);
  expect(errors).toEqual([]);
});
