import { expect, test, type Page } from '@playwright/test';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

// Phase 11 Step 2: 24·30 레벨 스킬을 Blood Moor 에서 실제로 써 보고 원작 그래픽 스크린샷을 남긴다 (test-results/skill-*.png)

/** Blood Moor 에서 몬스터를 치우고 스킬을 배워 오른쪽에 지정, 앞쪽에 맞을 좀비들을 세운다 */
async function prepare(page: Page, skills: Record<string, number>, right: string, zombies: [number, number][]): Promise<number[]> {
  await walkToBloodMoor(page);
  return page.evaluate(({ skills, right, zombies }) => {
    const g = window.__game!.game;
    // 벽·나무에 막히지 않게 사방 16 서브타일이 모두 걷기 가능한 빈터로 옮긴다
    const m = g.map;
    const open = (cx: number, cy: number) => {
      for (let y = cy - 16; y <= cy + 16; y++) for (let x = cx - 16; x <= cx + 16; x++) if (!m.walkable(x, y)) return false;
      return true;
    };
    const p0 = g.snapshot().player;
    let best: [number, number] | null = null, bd = Infinity;
    for (let y = 20; y < m.height - 20; y += 4)
      for (let x = 20; x < m.width - 20; x += 4) {
        const d = Math.hypot(x - p0.x, y - p0.y);
        if (d < bd && open(x, y)) {
          bd = d;
          best = [x, y];
        }
      }
    if (best) g.changeLevel(g.levelId, best[0] + 0.5, best[1] + 0.5);
    g.monsters.splice(0); // 주변 몬스터 제거 (AI 가 끼어들지 않게)
    const ch = g.character!;
    ch.level = 30;
    ch.mana = ch.maxMana = 800;
    const db = g.data!.skills!;
    for (const [name, lvl] of Object.entries(skills)) ch.skills[db.byNameOf(name)!.id] = lvl;
    ch.rightSkill = db.byNameOf(right)!.id;
    // 매 틱의 이벤트와 보인 미사일 이름을 모아 둔다 (빠른 화살도 놓치지 않게)
    const rec = { ev: [] as { type: string; targetId?: unknown }[], seen: {} as Record<string, number> };
    (window as unknown as { __rec: typeof rec }).__rec = rec;
    const tick = g.tick.bind(g);
    g.tick = () => {
      // 스크린샷용 일시 정지: 지정한 미사일이 보이면 게임을 멈춘다
      const w = window as unknown as { __freeze?: string };
      if (w.__freeze && g.snapshot().missiles.some((m) => m.name === w.__freeze)) return [];
      const ev = tick();
      rec.ev.push(...ev);
      const counts: Record<string, number> = {};
      for (const m of g.snapshot().missiles) counts[m.name] = (counts[m.name] ?? 0) + 1;
      for (const [k, v] of Object.entries(counts)) rec.seen[k] = Math.max(rec.seen[k] ?? 0, v);
      return ev;
    };
    const p = g.snapshot().player;
    return zombies.map(([dx, dy]) => {
      const z = g.spawnMonster('zombie1', p.x + dx, p.y + dy);
      z.hp = z.stats.maxHp = 100000;
      z.nextThink = 1e9;
      return z.id;
    });
  }, { skills, right, zombies });
}

/** 오른쪽 스킬 사용 명령 (대상 좀비 또는 플레이어 기준 지점) */
async function castRight(page: Page, name: string, at: { dx: number; dy: number } | { id: number }): Promise<void> {
  await page.evaluate(({ name, at }) => {
    const g = window.__game!.game;
    const s = g.data!.skills!.byNameOf(name)!;
    const p = g.snapshot().player;
    if ('id' in at) {
      const z = g.monsters.find((m) => m.id === at.id)!;
      g.enqueue({ type: 'useSkill', skill: s.id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
    } else g.enqueue({ type: 'useSkill', skill: s.id, hand: 'right', x: p.x + at.dx, y: p.y + at.dy });
  }, { name, at });
}

const missileCount = (page: Page, name: string) => page.evaluate((n) => window.__game!.game.snapshot().missiles.filter((m) => m.name === n).length, name);
/** name 미사일이 보이는 순간 멈춘 뒤 스크린샷, 다시 진행 */
async function shotWhen(page: Page, name: string, path: string): Promise<void> {
  await page.evaluate((n) => ((window as unknown as { __freeze?: string }).__freeze = n), name);
  await expect.poll(() => missileCount(page, name), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  await page.screenshot({ path });
  await page.evaluate(() => delete (window as unknown as { __freeze?: string }).__freeze);
}

/** 지금까지 한 틱에 동시에 보인 미사일 최대 수 */
const maxSeen = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { __rec: { seen: Record<string, number> } }).__rec.seen[n] ?? 0, name);
/** 지금까지 맞은(monsterHit) 대상 수 */
const hitTargets = (page: Page, ids: number[]) =>
  page.evaluate((ids) => new Set((window as unknown as { __rec: { ev: { type: string; targetId?: unknown }[] } }).__rec.ev.filter((e) => e.type === 'monsterHit' && ids.includes(e.targetId as number)).map((e) => e.targetId)).size, ids);

test('소서리스 Frozen Orb: 얼음 구가 볼트를 뿌리며 지나간다', async ({ page }) => {
  await newHero(page, uniqueName('Sor'), 'sorceress');
  await prepare(page, { 'Frozen Orb': 10 }, 'Frozen Orb', [[6, 3], [8, -3], [10, 0]]);
  await castRight(page, 'Frozen Orb', { dx: 14, dy: 0 });
  await expect.poll(() => missileCount(page, 'frozenorbbolt')).toBeGreaterThan(4);
  await page.screenshot({ path: 'test-results/skill-frozen-orb.png' });
  await expect.poll(() => page.evaluate(() => window.__game!.game.monsters.some((m) => m.states.has('cold')))).toBe(true);
});

test('바바리안 Whirlwind: 회전하며 좀비 사이를 지나간다', async ({ page }) => {
  await newHero(page, uniqueName('Bar'), 'barbarian');
  const ids = await prepare(page, { Whirlwind: 10 }, 'Whirlwind', [[3, 0.5], [6, -0.5], [9, 0.5]]);
  await castRight(page, 'Whirlwind', { dx: 12, dy: 0 });
  await expect.poll(() => page.evaluate(() => window.__game!.game.snapshot().player.states.includes('whirlwind'))).toBe(true);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/skill-whirlwind.png' });
  await expect.poll(() => hitTargets(page, ids), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
});

test('팔라딘 Fist of the Heavens: 대상에 번개가 떨어지고 성스러운 볼트가 퍼진다', async ({ page }) => {
  await newHero(page, uniqueName('Pal'), 'paladin');
  const ids = await prepare(page, { 'Fist of the Heavens': 10 }, 'Fist of the Heavens', [[6, 0], [9, 3], [9, -3], [12, 0]]);
  // 번개(handofgod)가 보이는 순간 멈춰 찍고, 이어서 볼트가 퍼지는 순간을 찍는다 (짧게 사라져 폴링으로 놓치지 않게)
  await page.evaluate(() => ((window as unknown as { __freeze?: string }).__freeze = 'handofgod'));
  await castRight(page, 'Fist of the Heavens', { id: ids[0]! });
  await expect.poll(() => missileCount(page, 'handofgod'), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/skill-fist-of-heavens.png' });
  await shotWhen(page, 'fistoftheheavensbolt', 'test-results/skill-fist-of-heavens-bolts.png');
  await expect.poll(() => hitTargets(page, ids)).toBeGreaterThanOrEqual(2);
});

test('네크로맨서 Bone Spirit: 뼈 영혼이 좀비를 따라가 맞힌다', async ({ page }) => {
  await newHero(page, uniqueName('Nec'), 'necromancer');
  const ids = await prepare(page, { 'Bone Spirit': 10 }, 'Bone Spirit', [[8, 5]]);
  const hp0 = await page.evaluate((id) => window.__game!.game.monsters.find((m) => m.id === id)!.hp, ids[0]!);
  // 대상 없이 오른쪽으로 쏘면 목표 지점에서 좀비를 찾아 방향을 튼다
  await castRight(page, 'Bone Spirit', { dx: 8, dy: 0 });
  await expect.poll(() => missileCount(page, 'bonespirit')).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/skill-bone-spirit.png' });
  await expect.poll(() => hitTargets(page, ids), { timeout: 10_000 }).toBe(1);
  void hp0;
});

test('아마존 Strafe: 활로 여러 좀비에게 화살을 나눠 쏜다', async ({ page }) => {
  await newHero(page, uniqueName('Ama'), 'amazon');
  await page.evaluate(() => {
    const g = window.__game!.game;
    const items = g.data!.items, tr = g.data!.treasure;
    const bow = tr.createItem(items.base('sbw')!, 1, g.rng, 2);
    const quiver = tr.createItem(items.base('aqv')!, 1, g.rng, 2);
    quiver.quantity = 100;
    g.equipment.rarm = bow;
    g.equipment.larm = quiver;
  });
  const ids = await prepare(page, { Strafe: 10 }, 'Strafe', [[12, 5], [13, -5], [15, 0], [11, 9]]);
  await page.evaluate(() => ((window as unknown as { __freeze?: string }).__freeze = 'strafearrow'));
  await castRight(page, 'Strafe', { id: ids[0]! });
  await shotWhen(page, 'strafearrow', 'test-results/skill-strafe.png');
  await expect.poll(() => maxSeen(page, 'strafearrow')).toBeGreaterThan(1);
  await expect.poll(() => hitTargets(page, ids), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.__game!.game.equipment.larm?.quantity)).toBe(99);
});
