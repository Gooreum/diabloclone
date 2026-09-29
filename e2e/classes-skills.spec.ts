import { expect, test } from '@playwright/test';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

// Phase 6: 5클래스 생성 + 스킬 트리(T)·캐릭터(C) 패널 + 우클릭 스킬 사용
test('아마존 생성 → Jab 배우고 오른쪽 버튼에 지정 → 우클릭으로 몬스터에 사용', async ({ page }) => {
  await newHero(page, uniqueName('Ama'), 'amazon');
  const info = await page.evaluate(() => {
    const g = window.__game!.game;
    return { cls: g.character!.cls, rarm: g.equipment.rarm?.code, qty: g.equipment.rarm?.quantity ?? 0 };
  });
  // 출처: charstats.txt Amazon 시작 장비 jav(오른손) + buc(왼손)
  expect(info.cls).toBe('Amazon');
  expect(info.rarm).toBe('jav');
  expect(info.qty).toBeGreaterThan(0);

  await page.evaluate(() => (window.__game!.game.character!.skillPoints = 1));
  await page.keyboard.press('t');
  await expect(page.locator('#skilltree')).toBeVisible();
  await expect(page.locator('#skilltree [data-skill]')).toHaveCount(32); // 클래스 30 + Attack, Throw
  await page.click('[data-learn="10"]'); // Jab
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.skills[10] ?? 0)).toBe(1);
  await page.click('#skill-10');
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.rightSkill)).toBe(10);
  await page.keyboard.press('t');
  await expect(page.locator('#skilltree')).toBeHidden();

  await walkToBloodMoor(page);
  await page.evaluate(() => {
    const g = window.__game!.game;
    for (const m of g.monsters) m.nextThink = 1e9;
    const p = g.snapshot().player;
    const z = g.spawnMonster('zombie1', p.x + 2.5, p.y);
    z.hp = z.stats.maxHp = 10000;
    z.nextThink = 1e9;
    (window as unknown as { __zid: number }).__zid = z.id;
  });
  // 렌더 후 픽 상자 위치를 우클릭
  await expect.poll(() => page.evaluate(() => window.__game!.input!.pickBoxes.some((b) => b.id === (window as unknown as { __zid: number }).__zid))).toBe(true);
  const box = await page.evaluate(() => window.__game!.input!.pickBoxes.find((b) => b.id === (window as unknown as { __zid: number }).__zid)!);
  const canvas = await page.locator('#game').boundingBox();
  const mana0 = await page.evaluate(() => window.__game!.game.character!.mana);
  await page.mouse.click(canvas!.x + box.x + box.w / 2, canvas!.y + box.y + box.h / 2, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__game!.game.snapshot().player.mode), { timeout: 3000 }).toBe('SQ');
  expect(await page.evaluate(() => window.__game!.game.character!.mana)).toBeLessThan(mana0);
  await page.screenshot({ path: 'test-results/amazon-jab.png' });
});

test('소서리스·네크로맨서·팔라딘도 생성되고 시작 무기를 든다', async ({ page }) => {
  // 출처: charstats.txt 시작 장비 — 소서리스 sst, 네크로맨서 wnd, 팔라딘 ssd
  for (const [cls, weapon] of [['sorceress', 'sst'], ['necromancer', 'wnd'], ['paladin', 'ssd']] as const) {
    await newHero(page, uniqueName(cls.slice(0, 3)), cls);
    const r = await page.evaluate(() => ({ cls: window.__game!.game.character!.cls, rarm: window.__game!.game.equipment.rarm?.code }));
    expect(r.cls.toLowerCase()).toBe(cls);
    expect(r.rarm).toBe(weapon);
    await page.evaluate(() => window.__game!.save!());
    await page.waitForFunction(() => window.__menuReady === true);
  }
});

test('캐릭터 패널(C): 스탯 포인트로 힘 +1', async ({ page }) => {
  await newHero(page, uniqueName('Bar'));
  await page.evaluate(() => (window.__game!.game.character!.statPoints = 1));
  await page.keyboard.press('c');
  await expect(page.locator('#charpanel')).toBeVisible();
  const str0 = await page.evaluate(() => window.__game!.game.character!.str);
  await page.click('#stat-str');
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.str)).toBe(str0 + 1);
});

test('소서리스 Fire Bolt 미사일과 네크로맨서 스켈레톤이 원작 그래픽으로 보인다', async ({ page }) => {
  await newHero(page, uniqueName('Sor'), 'sorceress');
  await walkToBloodMoor(page);
  await page.evaluate(() => {
    const g = window.__game!.game;
    for (const m of g.monsters) m.nextThink = 1e9;
    const ch = g.character!;
    ch.skills[36] = 1; // Fire Bolt
    ch.rightSkill = 36;
    const p = g.snapshot().player;
    g.enqueue({ type: 'useSkill', skill: 36, hand: 'right', x: p.x + 10, y: p.y });
  });
  await expect.poll(() => page.evaluate(() => window.__game!.game.snapshot().missiles.some((m) => m.name === 'firebolt'))).toBe(true);
  await page.screenshot({ path: 'test-results/sorceress-firebolt.png' });
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true);

  await newHero(page, uniqueName('Nec'), 'necromancer');
  await walkToBloodMoor(page);
  const petType = await page.evaluate(() => {
    const g = window.__game!.game;
    for (const m of g.monsters) m.nextThink = 1e9;
    const ch = g.character!;
    ch.skills[70] = 1; // Raise Skeleton
    const p = g.snapshot().player;
    const c = g.spawnMonster('zombie1', p.x + 2.5, p.y);
    c.mode = 'DD';
    g.enqueue({ type: 'useSkill', skill: 70, hand: 'right', x: c.x, y: c.y, targetId: c.id });
    return c.id;
  });
  void petType;
  await expect.poll(() => page.evaluate(() => window.__game!.game.pets.map((p) => p.type.id).join(','))).toBe('necroskeleton');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/necro-skeleton.png' });
});
