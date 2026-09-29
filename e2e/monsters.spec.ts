import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);

/** 레벨에 들어간다 (출구 밖 가운데 근처 걷기 가능한 곳 — 모서리는 출구라 다른 레벨로 넘어간다) */
async function enter(page: Page, level: string): Promise<void> {
  await page.evaluate((k) => {
    const g = window.__game!.game;
    const d = g.levelDef(k)!;
    const m = d.map;
    const inExit = (x: number, y: number) => d.exits.some((e) => x >= e.x - 3 && y >= e.y - 3 && x < e.x + e.w + 3 && y < e.y + e.h + 3);
    for (let r = 0; r < Math.max(m.width, m.height); r++)
      for (let k2 = 0; k2 < 32; k2++) {
        const x = Math.floor(m.width / 2 + Math.cos((k2 / 32) * Math.PI * 2) * r), y = Math.floor(m.height / 2 + Math.sin((k2 / 32) * Math.PI * 2) * r);
        if (m.walkable(x, y) && !inExit(x, y)) {
          g.changeLevel(k, x + 0.5, y + 0.5);
          g.tick();
          return;
        }
      }
  }, level);
}

/** 레벨로 옮기고 사방 radius 가 트인 곳에 선다 (다른 몬스터와 떨어진 곳) */
async function openSpot(page: Page, level: string, radius = 7): Promise<{ x: number; y: number }> {
  await enter(page, level);
  return page.evaluate(([k, r]) => {
    const g = window.__game!.game;
    const m = g.map;
    const R = r as number;
    const open = (x: number, y: number) => {
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (!m.walkable(x + dx, y + dy)) return false;
      return g.monsters.every((mo) => Math.hypot(mo.x - x, mo.y - y) > 22);
    };
    let spot = { x: m.width / 2, y: m.height / 2 };
    search: for (let y = 12; y < m.height - 12; y += 3) for (let x = 12; x < m.width - 12; x += 3) if (open(x, y)) { spot = { x: x + 0.5, y: y + 0.5 }; break search; }
    g.changeLevel(k as string, spot.x, spot.y);
    return spot;
  }, [level, radius] as const);
}

/** 몬스터 AI 를 멈춘다 (스크린샷이 흔들리지 않게) */
async function freeze(page: Page, ids: number[]): Promise<void> {
  await page.evaluate((list) => {
    for (const m of window.__game!.game.monsters) if (list.includes(m.id)) m.nextThink = 1e12;
  }, ids);
}

/** 몬스터 위에 마우스를 올린다 (그려진 선택 상자 가운데) */
async function hover(page: Page, id: number): Promise<void> {
  await page.waitForFunction((mid) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'monster' && b.id === mid), id, { timeout: 15_000 });
  // 겹친 다른 몬스터 상자에 가리지 않는 지점 (그리기 순서상 나중 상자가 위)
  const pt = await page.evaluate((mid) => {
    const boxes = window.__game!.input!.pickBoxes;
    const b = boxes.find((x) => x.kind === 'monster' && x.id === mid)!;
    for (let yy = b.y + 4; yy < b.y + b.h - 4; yy += 3)
      for (let xx = b.x + 4; xx < b.x + b.w - 4; xx += 3) {
        const top = [...boxes].reverse().find((x) => xx >= x.x && yy >= x.y && xx < x.x + x.w && yy < x.y + x.h);
        if (top?.id === mid && top.kind === 'monster') return { x: xx, y: yy };
      }
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }, id);
  await page.mouse.move(pt.x, pt.y);
  await page.waitForFunction((mid) => window.__game!.ui!.hoverMonster()?.id === mid, id, { timeout: 10_000 });
}

test('챔피언 무리: 파란 이름 막대와 원작 그래픽', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Champ'));
  const spot = await openSpot(page, 'darkwood');
  const ids = await page.evaluate((p) => {
    const g = window.__game!.game;
    return g.spawnChampionPack('corruptrogue2', p.x + 4, p.y + 2).map((m) => m.id);
  }, spot);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  await freeze(page, ids);
  const flags = await page.evaluate((list) => window.__game!.game.monsters.filter((m) => list.includes(m.id)).map((m) => m.flags), ids);
  for (const f of flags) expect(f & 4).toBe(4);
  await hover(page, ids[0]!);
  await page.waitForTimeout(1500);
  const hm = await page.evaluate(() => window.__game!.ui!.hoverMonster());
  expect(hm?.name).toBe('Vile Hunter');
  await page.locator('#game').screenshot({ path: 'test-results/monsters-champion-pack.png' });
  expect(errors).toEqual([]);
});

test('유니크 몬스터: 이름 막대 (접두·접미·칭호 + 수식어) 와 색 바뀐 그래픽', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Uniq'));
  const spot = await openSpot(page, 'coldplains');
  const info = await page.evaluate((p) => {
    const g = window.__game!.game;
    const b = g.spawnBoss('fallenshaman1', p.x + 4, p.y + 2, false)!;
    return { id: b.id, flags: b.flags, minions: g.minionsOf(b).map((m) => m.id), hp: b.stats.maxHp };
  }, spot);
  expect(info.flags & 8).toBe(8);
  expect(info.minions.length).toBeGreaterThanOrEqual(3);
  await freeze(page, [info.id, ...info.minions]);
  await hover(page, info.id);
  await page.waitForTimeout(1500);
  const hm = await page.evaluate(() => window.__game!.ui!.hoverMonster());
  expect(hm?.name.split(' ').length).toBeGreaterThanOrEqual(2);
  expect(hm!.box.y).toBeLessThan(40);
  await page.locator('#game').screenshot({ path: 'test-results/monsters-unique.png' });
  expect(errors).toEqual([]);
});

test('Bishibosh: Cold Plains 원래 자리의 슈퍼유니크', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Bishi'));
  await enter(page, 'coldplains');
  const b = await page.evaluate(() => {
    const g = window.__game!.game;
    const m = g.monsters.find((x) => x.superUnique === 0)!;
    return { id: m.id, x: m.x, y: m.y, umods: m.umods, minions: g.minionsOf(m).map((x) => x.id) };
  });
  expect(b.umods).toContain(9);
  const near = await page.evaluate((p) => {
    const g = window.__game!.game;
    const m = g.map;
    for (let r = 4; r < 12; r++) for (let a = 0; a < 16; a++) {
      const x = Math.floor(p.x + Math.cos((a / 16) * Math.PI * 2) * r), y = Math.floor(p.y + Math.sin((a / 16) * Math.PI * 2) * r);
      if (m.walkable(x, y)) {
        g.changeLevel('coldplains', x + 0.5, y + 0.5);
        return true;
      }
    }
    return false;
  }, b);
  expect(near).toBe(true);
  const around = await page.evaluate((p) => window.__game!.game.monsters.filter((m) => Math.hypot(m.x - p.x, m.y - p.y) < 25).map((m) => m.id), b);
  await freeze(page, around);
  await hover(page, b.id);
  await page.waitForTimeout(1500);
  const hm = await page.evaluate(() => window.__game!.ui!.hoverMonster());
  expect(hm?.name).toBe('Bishibosh');
  await page.locator('#game').screenshot({ path: 'test-results/monsters-bishibosh.png' });
  expect(errors).toEqual([]);
});

test('Andariel: Catacombs 4 에서 독 분사', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Andy'));
  await enter(page, 'catacombs4');
  const a = await page.evaluate(() => {
    const g = window.__game!.game;
    const m = g.monsters.find((x) => x.type.id === 'andariel')!;
    // 주변 몬스터는 치운다 (스크린샷용)
    for (const o of g.monsters) if (o !== m && Math.hypot(o.x - m.x, o.y - m.y) < 30) o.hp = -1, (o.mode = 'DD');
    const map = g.map;
    for (let r = 6; r < 12; r++) for (let k = 0; k < 16; k++) {
      const x = Math.floor(m.x + Math.cos((k / 16) * Math.PI * 2) * r), y = Math.floor(m.y + Math.sin((k / 16) * Math.PI * 2) * r);
      if (map.walkable(x, y)) {
        g.changeLevel('catacombs4', x + 0.5, y + 0.5);
        return { id: m.id, ok: true };
      }
    }
    return { id: m.id, ok: false };
  });
  expect(a.ok).toBe(true);
  // 독 분사(AndrialSpray, 시퀀스 SC) 를 쓰게 하고 분사 중에 찍는다
  await page.evaluate((id) => {
    const g = window.__game!.game;
    const c = g.character!;
    c.life = 1e6;
    const m = g.monsters.find((x) => x.id === id)!;
    m.nextThink = 1e12;
    (g as unknown as { monsterUseSkill: (m: unknown, s: number, t: unknown) => boolean }).monsterUseSkill(m, 0, null);
  }, a.id);
  const mode = await page.waitForFunction((id) => {
    const s = window.__game!.game.snapshot();
    return s.missiles.filter((x) => x.name === 'andarielspray').length >= 3 && s.monsters.find((x) => x.id === id)?.anim?.mode;
  }, a.id, { timeout: 10_000 });
  expect(await mode.jsonValue()).toBe('SC');
  await page.locator('#game').screenshot({ path: 'test-results/monsters-andariel.png' });
  expect(errors).toEqual([]);
});
