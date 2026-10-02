import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);

// 원작과 다름(사용자 요청): 몬스터 상자 근처(ASSIST_PX 안)를 클릭해도 그 몬스터를 공격·스킬 대상으로 (조준 보조)

type Cmd = { type: string; targetId?: number; standStill?: boolean };
const cmds = (page: Page) => page.evaluate(() => (window as unknown as { __cmds: Cmd[] }).__cmds.splice(0));

test('몬스터 상자 25px 바깥을 가리켜도 그 몬스터: 밝게·이름 막대·좌클릭 공격·Shift·우클릭 스킬, 먼 바닥은 이동', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Aim'), 'sorceress');
  // Blood Moor 트인 곳에 서고, 오른쪽에 좀비 하나 (움직이지 않게)
  const id = await page.evaluate(() => {
    const g = window.__game!.game;
    const k = 'bloodmoor';
    const m = g.levelDef(k)!.map;
    const open = (x: number, y: number) => {
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (!m.walkable(x + dx, y + dy)) return false;
      return true;
    };
    let spot = { x: m.width / 2, y: m.height / 2 };
    search: for (let y = 12; y < m.height - 12; y += 3) for (let x = 12; x < m.width - 12; x += 3) if (open(x, y)) { spot = { x: x + 0.5, y: y + 0.5 }; break search; }
    g.changeLevel(k, spot.x, spot.y);
    g.tick();
    for (const mo of [...g.monsters]) mo.nextThink = 1e12;
    g.monsters.splice(0, g.monsters.length);
    const z = g.spawnMonster('zombie1', spot.x + 3, spot.y);
    z.nextThink = 1e12;
    // 시험 중 죽지 않게
    z.stats = { ...z.stats, maxHp: 1e9 };
    z.hp = 1e9;
    g.character!.skills[36] = 1;
    g.character!.rightSkill = 36;
    const w = window as unknown as { __cmds: Cmd[] };
    w.__cmds = [];
    const orig = g.enqueue.bind(g);
    g.enqueue = (c) => {
      w.__cmds.push(c as Cmd);
      orig(c);
    };
    return z.id;
  });
  await page.waitForFunction((mid) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'monster' && b.id === mid), id, { timeout: 15_000 });
  const c = (await page.locator('#game').boundingBox())!;
  /** 지금 그려진 상자 오른쪽 dx px 바깥 (플레이어가 움직이면 화면이 따라가므로 매번 다시) */
  const beside = async (dx: number) => {
    const box = await page.evaluate((mid) => window.__game!.input!.pickBoxes.find((b) => b.kind === 'monster' && b.id === mid)!, id);
    return { x: c.x + box.x + box.w + dx, y: c.y + box.y + box.h / 2 };
  };
  const pt = await beside(25);
  // 먼 바닥 (상자에서 150px) — 몬스터가 죽어도 쓰게 미리
  const far = await beside(150);
  await page.mouse.move(pt.x, pt.y);
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.hover())).toEqual({ kind: 'monster', id });
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.hoverMonster()?.id)).toBe(id);
  await page.locator('#game').screenshot({ path: 'test-results/attack-assist-hover.png' });

  // 제자리 동작 먼저 (우클릭 스킬, Shift+좌클릭), 걸어가는 좌클릭은 마지막
  await cmds(page);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  expect((await cmds(page))[0]).toMatchObject({ type: 'useSkill', hand: 'right', targetId: id });
  let p = await beside(25);
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift');
  expect((await cmds(page))[0]).toMatchObject({ type: 'attack', targetId: id, standStill: true });
  p = await beside(25);
  await page.mouse.click(p.x, p.y);
  expect((await cmds(page))[0]).toMatchObject({ type: 'attack', targetId: id, standStill: false });

  // 먼 바닥 (상자에서 150px) 은 그대로 이동
  await page.mouse.click(far.x, far.y);
  expect((await cmds(page))[0]).toMatchObject({ type: 'move' });
  expect(errors).toEqual([]);
});
