import { expect, test } from '@playwright/test';
import { loadHero, newHero, uniqueName } from './helpers';

// Phase 7 Step 3: 죽음 → 부활 시 장착 아이템은 시체에 남고, 시체를 클릭하면 되찾는다. 골드 벌칙 (레벨 × %, 최대 20%)
// 출처: D2MOO PLAYER_ApplyDeathPenalty / D2GAME_CORPSE_Handler_6FC7FBD0
test('죽음: 시체에 장비가 남고, 시체를 클릭하면 다시 장착된다', async ({ page }) => {
  await newHero(page, uniqueName('Dead'));
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.gold = 1000;
    (g as unknown as { playerDie(): void }).playerDie();
  });
  await expect.poll(() => page.evaluate(() => window.__game!.game.isDead)).toBe(true);
  // 레벨 1: 1% 벌칙 → 10 잃고 990 은 땅에
  expect(await page.evaluate(() => window.__game!.game.gold)).toBe(0);
  expect(await page.evaluate(() => window.__game!.game.snapshot().items.filter((i) => i.code === 'gld').map((i) => i.quantity))).toEqual([990]);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game!.game.isDead)).toBe(false);
  expect(await page.evaluate(() => window.__game!.game.equipment.rarm?.code ?? null)).toBeNull();
  expect(await page.evaluate(() => window.__game!.game.snapshot().corpse?.items.map((i) => i.code).sort())).toEqual(['buc', 'hax']);
  // 시체 클릭 상자가 그려질 때까지 기다린 뒤 클릭
  const box = await expect
    .poll(() => page.evaluate(() => window.__game!.input!.pickBoxes.find((b) => b.kind === 'body') ?? null))
    .not.toBeNull()
    .then(() => page.evaluate(() => window.__game!.input!.pickBoxes.find((b) => b.kind === 'body')!));
  await page.screenshot({ path: 'test-results/death-corpse.png' });
  const canvas = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(canvas.x + box.x + box.w / 2, canvas.y + box.y + box.h / 2);
  await expect.poll(() => page.evaluate(() => window.__game!.game.equipment.rarm?.code ?? null), { timeout: 10_000 }).toBe('hax');
  expect(await page.evaluate(() => window.__game!.game.snapshot().corpse)).toBeNull();
});

// 원작 싱글: 죽은 채로 나갔다가 다시 들어오면 시체가 마을 시작 자리 옆에 있다 (시체 장비 그대로).
// 시체 그림은 맨손(HTH) COF 만 있으므로 무기(소서리스 지팡이 STF)를 든 채 죽어도 그려져야 한다.
test('투구·갑옷·지팡이를 입고 죽음 → 저장하고 나가기 → 다시 들어오면 마을에 시체가 그려져 있고, 주우면 장비가 돌아온다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('Body');
  await newHero(page, name, 'sorceress');
  // 원작 시체·죽기 그림은 몸통 기본 외형(lit) 한 장뿐 — 투구·갑옷을 입고 죽어도 그려져야 한다
  await page.evaluate(() => {
    const g = window.__game!.game as unknown as { data: { items: { base(c: string): unknown }; treasure: { createItem(b: unknown, l: number, r: unknown, q: number): unknown } }; rng: unknown; equipment: Record<string, unknown>; statsDirty: boolean };
    const mk = (c: string) => g.data.treasure.createItem(g.data.items.base(c), 10, g.rng, 2);
    g.equipment.head = mk('skp');
    g.equipment.tors = mk('ltp');
    g.statsDirty = true;
  });
  const weapon = await page.evaluate(() => window.__game!.game.equipment.rarm?.code ?? null);
  expect(weapon).not.toBeNull();
  await page.evaluate(() => (window.__game!.game as unknown as { playerDie(): void }).playerDie());
  await expect.poll(() => page.evaluate(() => window.__game!.game.isDead)).toBe(true);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game!.game.isDead)).toBe(false);
  // 게임 메뉴 → Save and Exit → 새로고침 → 다시 들어가기
  await page.keyboard.press('Escape');
  await page.click('#btn-save-exit');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 30_000 });
  await page.reload();
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await loadHero(page, name);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  expect(await page.evaluate(() => window.__game!.game.snapshot().corpse?.items.map((i) => i.code))).toContain(weapon);
  const box = await expect
    .poll(() => page.evaluate(() => window.__game!.input!.pickBoxes.find((b) => b.kind === 'body') ?? null), { timeout: 15_000 })
    .not.toBeNull()
    .then(() => page.evaluate(() => window.__game!.input!.pickBoxes.find((b) => b.kind === 'body')!));
  await page.waitForTimeout(1500);
  await page.locator('#game').screenshot({ path: 'test-results/death-corpse-rejoin.png' });
  // 실제로 그려졌는지: 시체를 잠깐 치운 화면과 시체 자리 픽셀을 비교한다
  const area = (b: { x: number; y: number; w: number; h: number }) =>
    page.evaluate(async (b) => {
      const img = await window.__game!.capture!();
      let s = 0, n = 0;
      for (let y = Math.max(0, b.y - 20); y < Math.min(540, b.y + b.h); y++)
        for (let x = Math.max(0, b.x); x < Math.min(800, b.x + b.w); x++) {
          const i = (y * img.width + x) * 4;
          s += img.data[i]! + img.data[i + 1]! + img.data[i + 2]!;
          n++;
        }
      return s / n;
    }, b);
  const withBody = await area(box);
  const saved = await page.evaluate(() => {
    const g = window.__game!.game as unknown as { corpse: unknown };
    const c = g.corpse;
    g.corpse = null;
    return !!c;
  });
  expect(saved).toBe(true);
  await page.waitForTimeout(400);
  const withoutBody = await area(box);
  // 시체를 되돌린다 (같은 객체를 다시 넣을 수 없으므로 새로고침 없이 저장값에서) — 저장에서 다시 읽는다
  await page.evaluate(async (n) => {
    const s = await window.__heroStore!.load(n);
    const g = window.__game!.game as unknown as { corpse: unknown; level: { def: { id: string } }; snapshot(): { player: { x: number; y: number } } };
    const p = g.snapshot().player;
    g.corpse = { levelId: g.level.def.id, x: p.x + 1, y: p.y + 1, dir: 0, items: { ...s!.corpse }, exp: 0 };
  }, name);
  console.log('[corpse] with', Math.round(withBody), 'without', Math.round(withoutBody));
  expect(Math.abs(withBody - withoutBody)).toBeGreaterThan(5);
  // 시체 클릭 → 지팡이가 돌아온다
  const b2 = await page.evaluate(() => window.__game!.input!.pickBoxes.find((b) => b.kind === 'body') ?? null);
  const at = b2 ?? box;
  const canvas = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(canvas.x + at.x + at.w / 2, canvas.y + at.y + at.h / 2);
  await expect.poll(() => page.evaluate(() => window.__game!.game.equipment.rarm?.code ?? null), { timeout: 10_000 }).toBe(weapon);
  expect(await page.evaluate(() => [window.__game!.game.equipment.head?.code, window.__game!.game.equipment.tors?.code])).toEqual(['skp', 'ltp']);
  expect(await page.evaluate(() => window.__game!.game.snapshot().corpse)).toBeNull();
  expect(errors).toEqual([]);
});
