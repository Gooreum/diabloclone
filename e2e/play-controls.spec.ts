import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(600_000);

// 조작이 진짜 마우스로 먹히는지 (사용자 신고 재현 → 수정 뒤 회귀 방지):
//  1) 시체 위 우클릭이 스킬을 취소하지 않는다  2) 군중 속 우클릭이 전부 시전된다
//  3) 공격은 누르고 있는 동안만, 공격 중 이동 클릭으로 빠져나온다  4) 마을 NPC 를 돌아서 지나간다

async function toField(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.changeLevel('coldplains', 1, 1);
    const m = g.map;
    let best = { x: m.width / 2, y: m.height / 2 }, bd = Infinity;
    for (let y = 10; y < m.height - 10; y += 2)
      for (let x = 10; x < m.width - 10; x += 2) {
        let ok = true;
        for (let dy = -9; dy <= 9 && ok; dy++) for (let dx = -9; dx <= 9; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
        const d = Math.hypot(x - m.width / 2, y - m.height / 2);
        if (ok && d < bd) { bd = d; best = { x, y }; }
      }
    g.changeLevel('coldplains', best.x + 0.5, best.y + 0.5);
    for (const o of g.monsters) (o as unknown as { x: number }).x += 500;
    const w = window as unknown as { __ev: { type: string; skill?: number }[] };
    w.__ev = [];
    const orig = g.tick.bind(g);
    g.tick = () => {
      const e = orig();
      w.__ev.push(...(e as { type: string; skill?: number }[]));
      return e;
    };
  });
}

const starts = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ev: { type: string }[] };
  const n = w.__ev.filter((e) => e.type === 'skillStart').length;
  w.__ev = [];
  return n;
});

async function start(page: Page, preset: string): Promise<{ x: number; y: number }> {
  await page.goto(`/?preset=${preset}`);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForTimeout(800);
  const box = (await (await page.$('canvas'))!.boundingBox())!;
  return { x: box.x, y: box.y };
}

test('시체 위를 우클릭해도 스킬이 나간다 (소서리스 Fire Ball)', async ({ page }) => {
  const c = await start(page, 'sorceress');
  await toField(page);
  const id = await page.evaluate(() => {
    const g = window.__game!.game, p = g.snapshot().player;
    const z = g.spawnMonster('zombie1', p.x + 5, p.y - 2);
    (g as unknown as { killMonster(m: unknown): void }).killMonster(z);
    g.enqueue({ type: 'setSkill', hand: 'right', skill: g.data!.skills!.byNameOf('Fire Ball')!.id });
    return z.id;
  });
  await page.waitForTimeout(3500);
  const b = await page.evaluate((zid) => window.__game!.input!.pickBoxes.find((q) => q.id === zid), id);
  expect(b?.kind, '시체 클릭 상자').toBe('corpse');
  await starts(page);
  await page.mouse.move(c.x + b!.x + b!.w / 2, c.y + b!.y + b!.h / 2);
  await page.waitForTimeout(100);
  await page.mouse.click(c.x + b!.x + b!.w / 2, c.y + b!.y + b!.h / 2, { button: 'right' });
  await page.waitForTimeout(900);
  expect(await starts(page), '시체 위 우클릭 시전').toBe(1);
});

for (const [preset, skill] of [['sorceress', 'Fire Ball'], ['amazon', 'Lightning Fury'], ['paladin', 'Blessed Hammer'], ['necromancer', 'Bone Spear']] as const) {
  test(`${preset}: 군중 속 우클릭 40번이 전부 시전된다 (${skill})`, async ({ page }) => {
    const c = await start(page, preset);
    await toField(page);
    await page.evaluate((skill) => {
      const g = window.__game!.game;
      g.enqueue({ type: 'setSkill', hand: 'right', skill: g.data!.skills!.byNameOf(skill)!.id });
    }, skill);
    await page.waitForTimeout(1500);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const failed: string[] = [];
    for (let i = 0; i < 40; i++) {
      // 주변에 살아 있는 몬스터 8마리를 유지 (죽으면 시체가 쌓인다), 생명·마나·수량은 채워 둔다
      await page.evaluate(() => {
        const g = window.__game!.game, p = g.snapshot().player, ch = g.character!;
        const alive = g.monsters.filter((o) => o.mode !== 'DD' && o.mode !== 'DT' && Math.hypot(o.x - p.x, o.y - p.y) < 14).length;
        for (let k = alive; k < 8; k++) {
          const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 6;
          g.spawnMonster(k % 2 ? 'fallen2' : 'zombie2', p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
        }
        ch.life = 1e5;
        ch.mana = ch.maxMana;
        const w = g.equipment.rarm;
        if (w && w.quantity > 0) w.quantity = 80;
      });
      const x = 150 + rnd() * 500, y = 80 + rnd() * 380;
      await page.mouse.move(c.x + x, c.y + y);
      await page.waitForTimeout(100);
      // 동작(시전·피격·막기)이 끝난 뒤에 누른다 — 동작 중 클릭은 원작도 다음 동작으로 이어질 뿐이라 따로 잰다
      await page.waitForFunction(() => window.__game!.game.playerIdle, undefined, { timeout: 5000 }).catch(() => undefined);
      await starts(page);
      const hover = await page.evaluate(() => window.__game!.ui!.hover()?.kind ?? 'none');
      await page.mouse.down({ button: 'right' });
      await page.waitForTimeout(50);
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(700);
      if ((await starts(page)) < 1) failed.push(`#${i} hover=${hover} dead=${await page.evaluate(() => window.__game!.game.isDead)}`);
    }
    expect(failed, '시전되지 않은 클릭').toEqual([]);
  });
}

test('공격은 누르는 동안만 하고, 공격 중 빈 땅을 한 번 누르면 이동한다 (바바리안)', async ({ page }) => {
  const c = await start(page, 'barbarian');
  await toField(page);
  const zid = await page.evaluate(() => {
    const g = window.__game!.game, p = g.snapshot().player;
    const z = g.spawnMonster('zombie2', p.x + 3, p.y);
    z.hp = z.stats.maxHp = 1e9;
    z.nextThink = Number.POSITIVE_INFINITY;
    return z.id;
  });
  await page.waitForTimeout(2500);
  const zb = (await page.evaluate((id) => window.__game!.input!.pickBoxes.find((q) => q.id === id), zid))!;
  const pos = () => page.evaluate(() => { const p = window.__game!.game.snapshot().player; return [p.x, p.y] as const; });
  await page.mouse.move(c.x + zb.x + zb.w / 2, c.y + zb.y + zb.h / 2);
  await starts(page);
  await page.mouse.down();
  await page.waitForTimeout(2000);
  expect(await starts(page), '누르고 있는 2초 동안 공격').toBeGreaterThanOrEqual(2);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await starts(page);
  await page.waitForTimeout(2000);
  expect(await starts(page), '버튼을 뗀 뒤 공격').toBe(0);
  // 다시 공격하다가 빈 땅을 한 번 클릭
  await page.mouse.down();
  await page.waitForTimeout(700);
  const p0 = await pos();
  await page.mouse.up();
  await page.mouse.click(c.x + 150, c.y + 420);
  await page.waitForTimeout(2500);
  const p1 = await pos();
  expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), '공격 중 이동 클릭으로 움직인 거리').toBeGreaterThan(5);
});

test('마을: NPC 를 사이에 두고 이동해도 멈추지 않고 도착한다', async ({ page }) => {
  await start(page, 'barbarian');
  await page.waitForTimeout(800);
  const res = await page.evaluate(async () => {
    const g = window.__game!.game, m = g.map;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const player = (g as unknown as { player: { x: number; y: number; path: unknown[] } }).player;
    const out: string[] = [];
    const npcs = g.npcs.filter((n) => n.npc?.interact);
    for (let k = 0; k < 12; k++) {
      const n = npcs[k % npcs.length]!;
      let pair: [{ x: number; y: number }, { x: number; y: number }] | null = null;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
        const a = { x: Math.floor(n.x - dx * 4) + 0.5, y: Math.floor(n.y - dy * 4) + 0.5 }, c = { x: Math.floor(n.x + dx * 4) + 0.5, y: Math.floor(n.y + dy * 4) + 0.5 };
        if (m.walkable(Math.floor(a.x), Math.floor(a.y)) && m.walkable(Math.floor(c.x), Math.floor(c.y))) { pair = [a, c]; break; }
      }
      if (!pair) continue;
      const [a, c] = pair;
      player.x = a.x;
      player.y = a.y;
      player.path = [];
      g.enqueue({ type: 'move', x: c.x, y: c.y, run: true });
      await sleep(4000);
      const d = Math.hypot(player.x - c.x, player.y - c.y);
      if (d >= 1.5) out.push(`${n.type.id}: 남은 거리 ${d.toFixed(1)}`);
    }
    return out;
  });
  expect(res, '도착하지 못한 이동').toEqual([]);
});
