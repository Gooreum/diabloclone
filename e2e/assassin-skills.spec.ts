import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 어쌔신 스킬 (원작 1.14d LoD): 무술 차지 → 피니셔, 센트리, 그림자 전사, Burst of Speed — 확장팩 서버에서 실제 게임 흐름으로.

interface Inner {
  data: { skills: { byNameOf(n: string): { id: number } } };
  pets: { id: number; type: { id: string }; mode: string }[];
  events: { type: string }[];
  chargeCount(s: string): number;
  player: { x: number; y: number; states: { has(n: string): boolean; stat(n: string): number } };
}

/** 스킬을 배우고 플레이어 곁에 튼튼한 몬스터 한 마리 */
async function setup(page: Page, skills: Record<string, number>): Promise<number> {
  return page.evaluate((sk) => {
    const g = window.__game!.game, inner = g as unknown as Inner & { spawnMonster(id: string, x: number, y: number): { id: number; hp: number; stats: { maxHp: number; defense: number; level: number }; nextThink: number; hpRegen: boolean } };
    const c = g.character!;
    c.level = 30;
    c.maxMana = c.mana = 1000;
    for (const [n, l] of Object.entries(sk)) c.skills[inner.data.skills.byNameOf(n).id] = l;
    // 발차기 피해는 장화에서 (SKILLS_CalculateKickDamage)
    const d = (g as unknown as { data: { treasure: { createItem: (b: unknown, l: number, r: unknown, q: number) => unknown }; items: { base: (c: string) => unknown } } }).data;
    (g.store.equipment as Record<string, unknown>).feet = d.treasure.createItem(d.items.base('hbt'), 20, (g as unknown as { rng: unknown }).rng, 2);
    (g as unknown as { statsDirty: boolean }).statsDirty = true;
    const p = inner.player;
    const m = inner.spawnMonster('zombie1', p.x + 1.5, p.y);
    m.hp = m.stats.maxHp = 100000;
    m.stats.defense = 0;
    m.stats.level = 1;
    m.nextThink = Number.POSITIVE_INFINITY;
    m.hpRegen = false;
    return m.id;
  }, skills);
}

async function use(page: Page, skill: string, targetId?: number, ticks = 40): Promise<void> {
  await page.evaluate(({ skill, targetId }) => {
    const g = window.__game!.game, inner = g as unknown as Inner;
    const id = inner.data.skills.byNameOf(skill).id;
    const t = targetId !== undefined ? g.snapshot().monsters.find((m) => m.id === targetId) : undefined;
    const p = inner.player;
    g.enqueue({ type: 'useSkill', skill: id, hand: 'right', x: t ? t.x : p.x + 3, y: t ? t.y : p.y, ...(targetId !== undefined ? { targetId } : {}) });
  }, { skill, targetId });
  await page.waitForTimeout((ticks * 1000) / 25);
}

const hpOf = (page: Page, id: number) => page.evaluate((id) => window.__game!.game.snapshot().monsters.find((m) => m.id === id)?.hp ?? 0, id);

test('어쌔신: Tiger Strike 3차지 → Dragon Talon, Lightning Sentry, Shadow Warrior, Burst of Speed', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 클래식 판본에는 어쌔신 단추가 없다 — 판본부터 본다
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  test.skip((await page.evaluate(() => window.__edition ?? 'classic')) !== 'lod', '확장팩 서버에서만');
  await newHero(page, uniqueName('As'), 'assassin');
  await walkToBloodMoor(page);
  const z = await setup(page, { 'Tiger Strike': 5, 'Dragon Talon': 5, 'Lightning Sentry': 5, 'Shadow Warrior': 5, Quickness: 5 });

  // 무술: Tiger Strike 세 번 → 차지 3, 오버레이 그림
  // 명중 상한 95 % (원작) — 빗나가면 한 번 더
  const charges = () => page.evaluate(() => (window.__game!.game as unknown as Inner).chargeCount('progressive_damage'));
  for (let i = 0; i < 8 && (await charges()) < 3; i++) await use(page, 'Tiger Strike', z);
  expect(await page.evaluate(() => (window.__game!.game as unknown as Inner).chargeCount('progressive_damage'))).toBe(3);
  await page.locator('#game').screenshot({ path: 'test-results/assassin-skills-tiger3.png' });
  const hp = await hpOf(page, z);
  await use(page, 'Dragon Talon', z, 60);
  expect(await page.evaluate(() => (window.__game!.game as unknown as Inner).chargeCount('progressive_damage'))).toBe(0);
  expect(await hpOf(page, z)).toBeLessThan(hp);

  // 센트리: 몬스터 쪽에 설치 → 번개
  const hp2 = await hpOf(page, z);
  await page.evaluate(() => {
    const g = window.__game!.game, inner = g as unknown as Inner;
    g.enqueue({ type: 'useSkill', skill: inner.data.skills.byNameOf('Lightning Sentry').id, hand: 'right', x: inner.player.x - 2, y: inner.player.y + 1 });
  });
  await expect.poll(() => page.evaluate(() => (window.__game!.game as unknown as Inner).pets.filter((p) => p.type.id === 'lightningsentry').length)).toBe(1);
  await expect.poll(() => hpOf(page, z), { timeout: 15_000 }).toBeLessThan(hp2);
  await page.locator('#game').screenshot({ path: 'test-results/assassin-skills-sentry.png' });

  // 그림자 전사: 주인 그림으로
  await use(page, 'Shadow Warrior', undefined, 40);
  const shadow = await page.evaluate(() => window.__game!.game.snapshot().monsters.find((m) => m.shadow)?.shadow?.cls);
  expect(shadow).toBe('Assassin');
  // 스크린샷용: 그림자를 플레이어 화면 왼쪽으로 떼어 놓는다
  await page.evaluate(() => {
    const inner = window.__game!.game as unknown as { pets: { pet?: { shadow?: unknown }; x: number; y: number; nextThink: number }[]; player: { x: number; y: number } };
    const sw = inner.pets.find((p) => p.pet?.shadow)!;
    sw.x = inner.player.x - 2.5;
    sw.y = inner.player.y + 2.5;
    sw.nextThink = Number.POSITIVE_INFINITY;
  });
  await page.waitForTimeout(1000);
  await page.locator('#game').screenshot({ path: 'test-results/assassin-skills-shadow.png' });

  // Burst of Speed
  await use(page, 'Quickness', undefined, 30);
  expect(await page.evaluate(() => {
    const st = (window.__game!.game as unknown as Inner).player.states;
    return st.has('quickness') && st.stat('velocitypercent') > 0;
  })).toBe(true);
  expect(errors).toEqual([]);
});
