import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);

/** 오브젝트 id 의 클릭 상자 중앙 (화면에 그려진 뒤 input.pickBoxes 에 들어간다) */
async function objectBox(page: Page, id: number): Promise<{ x: number; y: number } | null> {
  await page.waitForFunction((oid) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'object' && b.id === oid), id, { timeout: 15_000 }).catch(() => undefined);
  return page.evaluate((oid) => {
    const b = window.__game!.input!.pickBoxes.find((x) => x.kind === 'object' && x.id === oid);
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
  }, id);
}

/** 캔버스 좌표 클릭 (뷰포트 800×600 = 캔버스) */
async function clickCanvas(page: Page, p: { x: number; y: number }, button: 'left' | 'right' = 'left'): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + (p.x * box.width) / 800, box.y + (p.y * box.height) / 600, { button });
}

/** 오브젝트에서 dist 서브타일쯤 떨어진 걷기 가능한 칸으로 옮긴다 */
async function standNear(page: Page, level: string, id: number, dist = 4): Promise<void> {
  await page.evaluate(
    ([level, id, dist]) => {
      const g = window.__game!.game;
      if (g.levelId !== level) g.changeLevel(level as string, 2, 2);
      const o = g.objects.find((x) => x.id === id)!;
      const m = g.map;
      for (let r = dist as number; r < 20; r++)
        for (let a = 0; a < 16; a++) {
          const x = Math.floor(o.x + Math.cos((a / 16) * Math.PI * 2) * r), y = Math.floor(o.y + Math.sin((a / 16) * Math.PI * 2) * r);
          if (m.walkable(x, y)) {
            g.changeLevel(level as string, x + 0.5, y + 0.5);
            return;
          }
        }
    },
    [level, id, dist] as const,
  );
  await page.waitForTimeout(300);
}

test('Blood Moor 상자를 클릭해 열면 아이템이 떨어진다', async ({ page }) => {
  await newHero(page, uniqueName('Chest'));
  await walkToBloodMoor(page);
  await page.waitForTimeout(300);
  // 닫힌 상자 목록 (OperateFn 4 Chest)
  const chests = await page.evaluate(() => window.__game!.game.objects.filter((o) => o.type.operateFn === 4 && o.mode === 0).map((o) => o.id));
  expect(chests.length).toBeGreaterThan(0);
  let dropped = 0;
  for (const id of chests.slice(0, 12)) {
    // 원작: 25% 는 빈 상자·잠긴 상자는 열쇠 필요 — 잠김 없는 상자로 (근사 없이 원작 규칙 그대로 열리지 않으면 다음 상자)
    await standNear(page, 'bloodmoor', id);
    const before = await page.evaluate(() => window.__game!.game.snapshot().items.length);
    const p = await objectBox(page, id);
    if (!p) continue;
    await clickCanvas(page, p);
    await page.waitForFunction((oid) => window.__game!.game.objects.find((o) => o.id === oid)!.mode !== 0 || window.__game!.game.snapshot().player.mode === 'NU', id, { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(700);
    const st = await page.evaluate((oid) => ({ mode: window.__game!.game.objects.find((o) => o.id === oid)!.mode, items: window.__game!.game.snapshot().items.length }), id);
    if (st.mode !== 0 && st.items > before) {
      dropped = st.items - before;
      break;
    }
  }
  expect(dropped).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/objects-chest-open.png' });
});

test('Cold Plains 웨이포인트 클릭으로 활성 → 목록에서 마을로 → 마을 웨이포인트로 Cold Plains 복귀', async ({ page }) => {
  await newHero(page, uniqueName('Wayp'));
  const wpId = await page.evaluate(() => {
    const g = window.__game!.game;
    g.changeLevel('coldplains', 2, 2);
    g.tick();
    return g.objects.find((o) => o.type.subClass & 0x40)!.id;
  });
  await standNear(page, 'coldplains', wpId, 6);
  // 웨이포인트 클릭 = 조작 → 활성 + 목록
  const p = await objectBox(page, wpId);
  expect(p).not.toBeNull();
  await clickCanvas(page, p!);
  await page.waitForFunction(() => window.__game!.ui!.waypoint.open, undefined, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__game!.game.waypoints.has(1))).toBe(true);
  await page.waitForFunction(() => window.__game!.ui!.waypoint.ready, undefined, { timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/waypoint-panel.png' });
  // 첫 줄 = Rogue Encampment (웨이포인트 0)
  const row0 = await page.evaluate(() => window.__game!.ui!.waypoint.rowCenter(0));
  await clickCanvas(page, row0);
  await page.waitForFunction(() => window.__game!.game.levelId === 'town', undefined, { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/waypoint-town.png' });
  // 마을 웨이포인트 클릭 → Cold Plains (줄 1)
  const townWp = await page.evaluate(() => window.__game!.game.objects.find((o) => o.type.subClass & 0x40)!.id);
  const q = await objectBox(page, townWp);
  expect(q).not.toBeNull();
  await clickCanvas(page, q!);
  await page.waitForFunction(() => window.__game!.ui!.waypoint.open, undefined, { timeout: 15_000 });
  const row1 = await page.evaluate(() => window.__game!.ui!.waypoint.rowCenter(1));
  await clickCanvas(page, row1);
  await page.waitForFunction(() => window.__game!.game.levelId === 'coldplains', undefined, { timeout: 10_000 });
});

test('마을 포털 두루마리 → 마을 → 포털로 같은 자리 복귀 (한 쌍 닫힘)', async ({ page }) => {
  await newHero(page, uniqueName('Portal'));
  await walkToBloodMoor(page);
  await page.waitForTimeout(500);
  const start = await page.evaluate(() => {
    const g = window.__game!.game;
    // 출구(마을 경계)에서 먼 레벨 가운데 쪽 걷기 가능한 칸으로 (걸어서 포털을 누르다 출구로 넘어가지 않게)
    const m = g.map;
    let pick = -1;
    for (let r = 0; r < 60 && pick < 0; r++)
      for (let a = 0; a < 16 && pick < 0; a++) {
        const x = Math.floor(m.width / 2 + Math.cos(a) * r), y = Math.floor(m.height / 2 + Math.sin(a) * r);
        if (m.walkable(x, y) && m.walkable(x + 1, y) && m.walkable(x, y + 1) && !g.exits.some((e) => x > e.x - 10 && x < e.x + e.w + 10 && y > e.y - 10 && y < e.y + e.h + 10)) pick = y * m.width + x;
      }
    g.changeLevel('bloodmoor', (pick % m.width) + 0.5, Math.floor(pick / m.width) + 0.5);
    const all = [...g.inventory, ...g.store.belt.filter((x) => !!x)];
    const tsc = all.find((i) => i!.code === 'tsc')!;
    g.enqueue({ type: 'useItem', itemId: tsc.id });
    return { x: g.snapshot().player.x, y: g.snapshot().player.y };
  });
  await page.waitForFunction(() => !!window.__game!.game.townPortal, undefined, { timeout: 5000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/portal-field.png' });
  const fieldId = await page.evaluate(() => window.__game!.game.townPortal!.fieldId);
  const p = await objectBox(page, fieldId);
  expect(p).not.toBeNull();
  await clickCanvas(page, p!);
  await page.waitForFunction(() => window.__game!.game.levelId === 'town', undefined, { timeout: 15_000 });
  // 포털로 왔으면 마을 포털 바로 옆
  const near = await page.evaluate(() => {
    const g = window.__game!.game, t = g.objects.find((o) => o.id === g.townPortal!.townId)!, p = g.snapshot().player;
    return Math.hypot(p.x - t.x, p.y - t.y);
  });
  expect(near).toBeLessThan(6);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/portal-town.png' });
  const townId = await page.evaluate(() => window.__game!.game.townPortal!.townId);
  const q = await objectBox(page, townId);
  expect(q).not.toBeNull();
  await clickCanvas(page, q!);
  await page.waitForFunction(() => window.__game!.game.levelId === 'bloodmoor', undefined, { timeout: 15_000 });
  const end = await page.evaluate(() => ({ x: window.__game!.game.snapshot().player.x, y: window.__game!.game.snapshot().player.y, tp: window.__game!.game.townPortal }));
  expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(6);
  expect(end.tp).toBeNull();
});

test('Tab 자동 지도 (전체·미니)', async ({ page }) => {
  await newHero(page, uniqueName('Amap'));
  await walkToBloodMoor(page);
  // Blood Moor 안쪽 여러 곳을 들러 탐험 (걷기 가능한 칸으로 옮겨 가며 틱마다 주변 타일이 드러난다)
  for (let k = 0; k < 8; k++) {
    await page.evaluate((k) => {
      const g = window.__game!.game;
      const m = g.map;
      const cx = m.width / 2 + Math.cos(k) * m.width * 0.12, cy = m.height / 2 + Math.sin(k) * m.height * 0.12 + (k - 4) * 6;
      for (let r = 0; r < 30; r++)
        for (let a = 0; a < 8; a++) {
          const x = Math.floor(cx + Math.cos(a) * r), y = Math.floor(cy + Math.sin(a) * r);
          if (m.walkable(x, y)) {
            g.changeLevel('bloodmoor', x + 0.5, y + 0.5);
            return;
          }
        }
    }, k);
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__game!.ui!.automap() === 'full' && window.__game!.ui!.automapReady(), undefined, { timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/automap-full.png' });
  const seen = await page.evaluate(() => window.__game!.game.automapOf('bloodmoor')!.count());
  expect(seen).toBeGreaterThan(200);
  expect(await page.evaluate(() => window.__game!.ui!.automapDrawn())).toBeGreaterThan(20);
  await page.keyboard.press('v');
  await page.waitForFunction(() => window.__game!.ui!.automap() === 'mini', undefined, { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/automap-mini.png' });
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__game!.ui!.automap())).toBe('off');
});
