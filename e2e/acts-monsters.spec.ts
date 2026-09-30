import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(300_000);

// Act 2~4 몬스터·보스가 원작 그래픽(DCC/COF)·막 팔레트·애니메이션으로 그려지는지 (Phase 5).
// 스크린샷: test-results/mon-act2.png · mon-act3.png · mon-act4.png · mon-duriel.png · mon-mephisto.png · mon-diablo.png · mon-sealboss.png

/** 막으로 옮긴다 (막 파일을 다 읽을 때까지 다시 시도 — act4-world.spec 와 같은 방식) */
async function toAct(page: Page, act: number): Promise<void> {
  await page.waitForFunction((a) => window.__game!.game.changeAct(a), act, { timeout: 150_000, polling: 500 });
  expect(await page.evaluate(() => window.__game!.game.act)).toBe(act);
}

/** 레벨로 옮기고, 목표 지점(없으면 가운데)에서 가장 가까운 사방 radius 트인 곳에 선다 */
async function openSpot(page: Page, level: string, near?: { x: number; y: number }, radius = 6, clear = true): Promise<{ x: number; y: number }> {
  return page.evaluate(([k, n, r, cl]) => {
    const g = window.__game!.game;
    g.changeLevel(k as string, 1, 1);
    const m = g.map;
    const d = g.levelDef(k as string)!;
    const R = r as number;
    const inExit = (x: number, y: number) => d.exits.some((e) => x >= e.x - 4 && y >= e.y - 4 && x < e.x + e.w + 4 && y < e.y + e.h + 4);
    const c = (n as { x: number; y: number } | undefined) ?? { x: m.width / 2, y: m.height / 2 };
    let best = { x: c.x, y: c.y }, bd = Infinity;
    for (let y = R + 1; y < m.height - R - 1; y++)
      for (let x = R + 1; x < m.width - R - 1; x++) {
        const dd = Math.hypot(x - c.x, y - c.y);
        if (dd >= bd || inExit(x, y)) continue;
        let ok = true;
        for (let dy = -R; dy <= R && ok; dy++) for (let dx = -R; dx <= R; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
        if (ok) { bd = dd; best = { x, y }; }
      }
    g.changeLevel(k as string, best.x + 0.5, best.y + 0.5);
    // 주변의 레벨 몬스터는 치운다 (보려는 몬스터만 남게)
    if (cl) {
      const list = g.monsters;
      for (let i = list.length - 1; i >= 0; i--) {
        const mo = list[i]!;
        if (Math.hypot(mo.x - best.x, mo.y - best.y) < 26) list.splice(i, 1);
      }
    }
    // 레벨 몬스터는 모두 멈춘다 (낮은 레벨 영웅이 죽지 않게 — 대기 애니메이션은 계속)
    for (const mo of g.monsters) mo.nextThink = 1e12;
    return { x: best.x + 0.5, y: best.y + 0.5 };
  }, [level, near, radius, clear] as const);
}

/** 몬스터를 둔다 (AI 는 멈춘다 — 스크린샷이 흔들리지 않게, 대기 애니메이션은 계속) */
async function place(page: Page, list: [string, number, number][], at: { x: number; y: number }): Promise<number[]> {
  return page.evaluate(([l, p]) => {
    const g = window.__game!.game;
    const ids: number[] = [];
    for (const [id, dx, dy] of l as [string, number, number][]) {
      const m = g.spawnMonster(id, (p as { x: number }).x + dx, (p as { y: number }).y + dy);
      m.nextThink = 1e12;
      ids.push(m.id);
    }
    return ids;
  }, [list, at] as const);
}

/** 캔버스 밝기 (검은 화면이 아닌지) */
async function lit(page: Page): Promise<number> {
  return page.evaluate(async () => {
    // 월드(WebGL)와 UI 를 합성한 화면
    const img = await window.__game!.capture!();
    const d = img.data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0) > 30) n++;
    return n / (img.width * img.height);
  });
}

/** 몬스터 그림이 다 읽혀 선택 상자가 생길 때까지 */
async function drawn(page: Page, ids: number[]): Promise<void> {
  await page.waitForFunction((list) => list.every((id) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'monster' && b.id === id)), ids, { timeout: 60_000 });
  await page.waitForTimeout(1200);
}

test('Act 2~4 몬스터 무리와 보스가 원작 그래픽·막 팔레트로 그려진다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Mons'));
  // 디버그: Act 4 몬스터 곁에서 죽지 않게 (죽으면 봉인을 조작할 수 없다 — Game.operateObject 는 죽은 동안 무시)
  await page.evaluate(() => {
    const c = window.__game!.game.character!;
    c.maxLife = c.life = 1e6;
  });

  // ---- Act 2: 바위 황무지 — Sand Raider · Dung Soldier · Huntress · Mummy · Carrion Bird ----
  await toAct(page, 1);
  let at = await openSpot(page, 'rockywaste');
  let ids = await place(page, [['sandraider2', 4, -3], ['scarab2', 5, 1], ['pantherwoman1', 1, 5], ['mummy2', -3, 4], ['vulture1', -4, -2], ['sandmaggot1', 6, 5]], at);
  await drawn(page, ids);
  expect(await lit(page)).toBeGreaterThan(0.25);
  await page.locator('#game').screenshot({ path: 'test-results/mon-act2.png' });

  // ---- Duriel: 두리엘의 굴 (프리셋 자리) ----
  const dur = await page.evaluate(() => {
    const g = window.__game!.game;
    g.changeLevel('durielslair', 1, 1);
    const m = g.monsters.find((x) => x.type.id === 'duriel')!;
    return { x: m.x, y: m.y, id: m.id };
  });
  at = await openSpot(page, 'durielslair', { x: dur.x + 5, y: dur.y + 5 }, 2, false);
  await page.evaluate((id) => {
    const m = window.__game!.game.monsters.find((x) => x.id === id);
    if (m) m.nextThink = 1e12;
  }, dur.id);
  const durIds = await page.evaluate((p) => {
    const g = window.__game!.game;
    let m = g.monsters.find((x) => x.type.id === 'duriel');
    if (!m) m = g.spawnMonster('duriel', p.x + 3, p.y - 3);
    m.nextThink = 1e12;
    return [m.id];
  }, at);
  await drawn(page, durIds);
  expect(await lit(page)).toBeGreaterThan(0.1);
  await page.locator('#game').screenshot({ path: 'test-results/mon-duriel.png' });

  // ---- Act 3: 거미 숲 — Flayer · Flayer Shaman · Thorned Hulk · Swamp Dweller · Zealot · Gloam ----
  await toAct(page, 2);
  at = await openSpot(page, 'spiderforest');
  ids = await place(page, [['fetish2', 4, -2], ['fetishshaman2', 5, 2], ['thornhulk1', 0, 5], ['frogdemon1', -4, 3], ['zealot1', -4, -3], ['willowisp1', 2, -5]], at);
  await drawn(page, ids);
  expect(await lit(page)).toBeGreaterThan(0.2);
  await page.locator('#game').screenshot({ path: 'test-results/mon-act3.png' });

  // ---- Mephisto: 증오의 억류지 3 ----
  const meph = await page.evaluate(() => {
    const g = window.__game!.game;
    g.changeLevel('durance3', 1, 1);
    const m = g.monsters.find((x) => x.type.id === 'mephisto')!;
    return { x: m.x, y: m.y };
  });
  at = await openSpot(page, 'durance3', { x: meph.x + 5, y: meph.y + 5 }, 2, false);
  const mephIds = await page.evaluate((p) => {
    const g = window.__game!.game;
    let m = g.monsters.find((x) => x.type.id === 'mephisto');
    if (!m || Math.hypot(m.x - p.x, m.y - p.y) > 14) m = g.spawnMonster('mephisto', p.x + 3, p.y - 3);
    m.nextThink = 1e12;
    return [m.id];
  }, at);
  await drawn(page, mephIds);
  await page.locator('#game').screenshot({ path: 'test-results/mon-mephisto.png' });

  // ---- Act 4: 외부 초원 — Doom Knight · Oblivion Knight · Venom Lord · Storm Caster · Flesh Spawner · Corpse Spitter ----
  await toAct(page, 3);
  at = await openSpot(page, 'outersteppes');
  ids = await place(page, [['doomknight1', 4, -3], ['doomknight3', 5, 2], ['megademon1', 0, 6], ['fingermage1', -4, 3], ['vilemother1', -4, -3], ['regurgitator1', 2, -6]], at);
  await drawn(page, ids);
  expect(await lit(page)).toBeGreaterThan(0.2);
  await page.locator('#game').screenshot({ path: 'test-results/mon-act4.png' });

  // ---- 카오스 생추어리: 봉인을 열면 봉인 보스 (Infector of Souls) ----
  const seal = await page.evaluate(() => {
    const g = window.__game!.game;
    g.changeLevel('chaossanctuary', 1, 1);
    const o = g.objects.find((x) => x.type.id === 392)!;
    return { x: o.x, y: o.y, id: o.id };
  });
  at = await openSpot(page, 'chaossanctuary', { x: seal.x + 2, y: seal.y + 4 }, 2);
  const boss = await page.evaluate(([sid, p]) => {
    const g = window.__game!.game;
    const o = g.objects.find((x) => x.id === sid)!;
    g.operateObject(o);
    const b = g.monsters.find((m) => m.superUnique === 36)!;
    // 봉인 곁 (플레이어 앞) 으로 보스와 미니언을 모은다 (봉인은 조작 모드로 바뀐다)
    const m = g.map;
    const spots: { x: number; y: number }[] = [];
    for (let r = 5; r < 11 && spots.length < 16; r++) for (let a = 0; a < 16; a++) {
      const x = Math.floor((p as { x: number }).x + Math.cos((a / 16) * Math.PI * 2) * r), y = Math.floor((p as { y: number }).y + Math.sin((a / 16) * Math.PI * 2) * r);
      if (m.walkable(x, y) && !spots.some((s) => Math.hypot(s.x - x, s.y - y) < 2.5)) spots.push({ x, y });
    }
    // 보스는 플레이어 바로 앞 (화면 아래쪽 = +x +y), 미니언은 뒤쪽 둘레
    const px = Math.floor((p as { x: number }).x), py = Math.floor((p as { y: number }).y);
    const front = [[3, 3], [2, 3], [3, 2], [4, 2], [2, 4]].map(([dx, dy]) => ({ x: px + dx!, y: py + dy! })).find((q) => m.walkable(q.x, q.y));
    if (front) {
      b.x = front.x + 0.5;
      b.y = front.y + 0.5;
    }
    b.nextThink = 1e12;
    b.path = [];
    const back = spots.filter((q) => q.x + q.y < px + py - 2);
    g.minionsOf(b).forEach((u, i) => {
      const q = back[i % Math.max(1, back.length)];
      if (q) {
        u.x = q.x + 0.5;
        u.y = q.y + 0.5;
      }
      u.nextThink = 1e12;
      u.path = [];
    });
    return { id: b.id, sealMode: o.mode };
  }, [seal.id, at] as const);
  expect(boss.sealMode).toBeGreaterThan(0);
  const bossIds = [boss.id];
  await drawn(page, bossIds);
  await page.locator('#game').screenshot({ path: 'test-results/mon-sealboss.png' });

  // ---- Diablo: 카오스 생추어리 중앙 (시작 자리 오브젝트 255) ----
  const start = await page.evaluate(() => {
    const d = window.__game!.game.levelDef('chaossanctuary')!;
    const o = d.objects!.find((x) => x.classId === 255)!;
    return { x: o.x, y: o.y };
  });
  at = await openSpot(page, 'chaossanctuary', { x: start.x + 6, y: start.y + 6 }, 2);
  const diaIds = await page.evaluate((p) => {
    const g = window.__game!.game;
    for (const m of g.monsters) if (Math.hypot(m.x - p.x, m.y - p.y) < 20) m.nextThink = 1e12;
    const d = g.spawnMonster('diablo', p.x + 3, p.y - 3);
    d.nextThink = 1e12;
    return [d.id];
  }, at);
  await drawn(page, diaIds);
  expect(await lit(page)).toBeGreaterThan(0.1);
  await page.locator('#game').screenshot({ path: 'test-results/mon-diablo.png' });

  expect(errors).toEqual([]);
});
