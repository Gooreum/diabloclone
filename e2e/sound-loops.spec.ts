import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2sfx.mpq'), '원작 사운드 MPQ 필요');
test.setTimeout(300_000);

// 남는 반복 소리 0개: 직업의 모든 스킬을 쓴 뒤 미사일이 다 사라지면 반복 재생 중인 효과음이 없어야 하고, 마을로 가도 없어야 한다.
// (재현된 버그: 어쌔신 Wake of Inferno 의 맞는 소리 sorceress_inferno 가 반복 소리라 9개가 마을에서도 영원히 남았다)

const CODE: Record<string, string> = { Amazon: 'ama', Sorceress: 'sor', Necromancer: 'nec', Paladin: 'pal', Barbarian: 'bar', Druid: 'dru', Assassin: 'ass' };

async function toField(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.changeLevel('coldplains', 1, 1);
    const m = g.map;
    let best = { x: m.width / 2, y: m.height / 2 }, bd = Infinity;
    for (let y = 6; y < m.height - 6; y += 2)
      for (let x = 6; x < m.width - 6; x += 2) {
        let ok = true;
        for (let dy = -8; dy <= 8 && ok; dy++) for (let dx = -8; dx <= 8; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
        const d = Math.hypot(x - m.width / 2, y - m.height / 2);
        if (ok && d < bd) { bd = d; best = { x, y }; }
      }
    g.changeLevel('coldplains', best.x + 0.5, best.y + 0.5);
  });
}

const loops = (page: Page) => page.evaluate(() => (window.__audio as unknown as { voices: { name: string; channel: string; src: { loop: boolean } }[] }).voices.filter((v) => v.channel === 'sfx' && v.src.loop).map((v) => v.name));

for (const id of ['assassin', 'sorceress', 'druid']) {
  test(`${id}: 전 스킬을 쓴 뒤 남는 반복 소리가 없고 마을에서도 없다`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/?preset=${id}`);
    await page.waitForFunction(() => window.__game?.ready === true || window.__menuReady === true, undefined, { timeout: 150_000 });
    test.skip(!(await page.evaluate(() => window.__game?.ready === true)), '이 판본에서는 열 수 없는 프리셋 (확장팩 필요)');
    await page.mouse.click(400, 300);
    await page.waitForFunction(() => window.__audio?.unlocked === true, undefined, { timeout: 30_000 });
    const town = await page.evaluate(() => window.__game!.game.levelId);
    await toField(page);
    const names = await page.evaluate((code) => {
      const g = window.__game!.game;
      const p = g.snapshot().player;
      for (const o of g.monsters) (o as unknown as { x: number }).x += 400;
      const z = g.spawnMonster('zombie2', p.x + 5, p.y);
      z.hp = z.stats.maxHp = 1e8;
      z.nextThink = Number.POSITIVE_INFINITY;
      (window as unknown as { __z: number }).__z = z.id;
      return [...g.data!.skills!.byId.values()].filter((s) => s.charclass === code[g.character!.cls] && !s.passive).map((s) => s.name);
    }, CODE);
    await page.waitForTimeout(800);
    for (const n of names) {
      await page.evaluate((n) => {
        const g = window.__game!.game, c = g.character!;
        c.mana = c.maxMana;
        c.life = 1e5;
        const s = g.data!.skills!.byNameOf(n)!;
        const z = g.monsters.find((m) => m.id === (window as unknown as { __z: number }).__z)!;
        g.enqueue({ type: 'useSkill', skill: s.id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
      }, n);
      await page.waitForTimeout(900);
    }
    // 지속 상태(허리케인·아마게돈 등)의 미사일은 주인이 살아 있는 동안 반복 소리가 정상 — 미사일 없는 반복 소리만 본다
    await page.waitForTimeout(12_000);
    const field = await page.evaluate(() => {
      const g = window.__game!.game;
      const live = g.snapshot().missiles.length;
      const v = (window.__audio as unknown as { voices: { name: string; channel: string; src: { loop: boolean } }[] }).voices.filter((x) => x.channel === 'sfx' && x.src.loop).map((x) => x.name);
      return { live, v };
    });
    if (field.live === 0) expect(field.v, '필드: 미사일이 없는데 남은 반복 소리').toEqual([]);
    // 마을로
    await page.evaluate((t) => {
      const g = window.__game!.game;
      g.changeLevel(t, 1, 1);
      const m = g.map;
      for (let y = 10; y < m.height; y++) for (let x = 10; x < m.width; x++) if (m.walkable(x, y)) { g.changeLevel(t, x + 0.5, y + 0.5); return; }
    }, town);
    await page.waitForTimeout(3000);
    expect(await loops(page), '마을: 남은 반복 소리').toEqual([]);
    expect(errors).toEqual([]);
  });
}
