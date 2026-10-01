import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 드루이드 스킬 (원작 1.14d LoD): 원소, 소환, 늑대 변신 — 확장팩 서버에서 실제 게임 흐름으로.

interface Inner {
  data: { skills: { byNameOf(n: string): { id: number } } };
  pets: { id: number; type: { id: string }; mode: string; pet?: { petType: string } }[];
  missiles: { def: { name: string } }[];
  player: { x: number; y: number; states: { has(n: string): boolean; get(n: string): { stats: Record<string, number> } | undefined } };
}

/** 스킬을 배우고 플레이어 곁에 튼튼한 몬스터 한 마리 */
async function setup(page: Page, skills: Record<string, number>): Promise<number> {
  return page.evaluate((sk) => {
    const g = window.__game!.game, inner = g as unknown as Inner & { spawnMonster(id: string, x: number, y: number): { id: number; hp: number; stats: { maxHp: number; defense: number; level: number }; nextThink: number; hpRegen: boolean } };
    const c = g.character!;
    c.level = 30;
    c.maxMana = c.mana = 1000;
    for (const [n, l] of Object.entries(sk)) c.skills[inner.data.skills.byNameOf(n).id] = l;
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

/** 스킬 사용 후 ticks 프레임 기다리며 본 미사일 이름 */
async function use(page: Page, skill: string, targetId?: number, ticks = 40): Promise<string[]> {
  await page.evaluate(({ skill, targetId }) => {
    const g = window.__game!.game, inner = g as unknown as Inner;
    const id = inner.data.skills.byNameOf(skill).id;
    const t = targetId !== undefined ? g.snapshot().monsters.find((m) => m.id === targetId) : undefined;
    const p = inner.player;
    (window as unknown as { __seen: Set<string> }).__seen = new Set();
    g.enqueue({ type: 'useSkill', skill: id, hand: 'right', x: t ? t.x : p.x + 3, y: t ? t.y : p.y, ...(targetId !== undefined ? { targetId } : {}) });
  }, { skill, targetId });
  const seen = new Set<string>();
  for (let i = 0; i < ticks / 5; i++) {
    await page.waitForTimeout(200);
    for (const n of await page.evaluate(() => (window.__game!.game as unknown as Inner).missiles.map((m) => m.def.name))) seen.add(n);
  }
  return [...seen];
}

const hpOf = (page: Page, id: number) => page.evaluate((id) => window.__game!.game.snapshot().monsters.find((m) => m.id === id)?.hp ?? 0, id);

test('드루이드: Firestorm·Tornado·Volcano, Spirit Wolf·Oak Sage, 늑대 변신 → Feral Rage → 사람으로', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  test.skip((await page.evaluate(() => window.__edition ?? 'classic')) !== 'lod', '확장팩 서버에서만');
  await newHero(page, uniqueName('Dz'), 'druid');
  await walkToBloodMoor(page);
  const z = await setup(page, { Firestorm: 5, Tornado: 5, Volcano: 5, 'Summon Spirit Wolf': 5, 'Oak Sage': 5, Wearwolf: 5, 'Feral Rage': 5 });

  // 원소
  let hp = await hpOf(page, z);
  expect(await use(page, 'Firestorm', z, 50)).toContain('firestorm');
  await page.locator('#game').screenshot({ path: 'test-results/druid-skills-firestorm.png' });
  expect(await use(page, 'Tornado', z, 40)).toContain('tornado');
  expect(await use(page, 'Volcano', z, 100)).toContain('volcano');
  await page.locator('#game').screenshot({ path: 'test-results/druid-skills-volcano.png' });
  await expect.poll(() => hpOf(page, z)).toBeLessThan(hp);

  // 소환
  await use(page, 'Summon Spirit Wolf', undefined, 30);
  await use(page, 'Oak Sage', undefined, 40);
  const types = await page.evaluate(() => (window.__game!.game as unknown as Inner).pets.map((p) => p.pet?.petType));
  expect(types).toEqual(expect.arrayContaining(['spiritwolf', 'totem']));
  expect(await page.evaluate(() => (window.__game!.game as unknown as Inner).player.states.has('oaksage'))).toBe(true);
  await page.locator('#game').screenshot({ path: 'test-results/druid-skills-summons.png' });

  // 늑대 변신 → Feral Rage
  await use(page, 'Wearwolf', undefined, 40);
  expect(await page.evaluate(() => window.__game!.game.snapshot().player.shape?.typeId)).toBe('wolf');
  // 스크린샷용: 소환수를 화면 밖으로 떼어 놓아 늑대가 된 플레이어만 보이게
  await page.evaluate(() => {
    const inner = window.__game!.game as unknown as { pets: { x: number; y: number; nextThink: number }[]; player: { x: number; y: number } };
    for (const p of inner.pets) {
      p.x = inner.player.x + 30;
      p.y = inner.player.y - 30;
      p.nextThink = Number.POSITIVE_INFINITY;
    }
  });
  await page.waitForTimeout(800);
  await page.locator('#game').screenshot({ path: 'test-results/druid-skills-wolf.png' });
  hp = await hpOf(page, z);
  const frenzy = () => page.evaluate(() => (window.__game!.game as unknown as Inner).player.states.get('feralrage')?.stats.skill_frenzy ?? 0);
  for (let i = 0; i < 8 && (await frenzy()) < 1; i++) await use(page, 'Feral Rage', z, 30);
  expect(await frenzy()).toBeGreaterThan(0);
  expect(await hpOf(page, z)).toBeLessThan(hp);
  await page.locator('#game').screenshot({ path: 'test-results/druid-skills-feralrage.png' });

  // 다시 Wearwolf → 사람으로 (Wearwolf delay 25 가 지나야 한다)
  await page.waitForTimeout(1500);
  await use(page, 'Wearwolf', undefined, 30);
  expect(await page.evaluate(() => window.__game!.game.snapshot().player.shape)).toBeUndefined();
  expect(errors).toEqual([]);
});
