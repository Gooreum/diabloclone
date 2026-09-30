import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(300_000);

// Phase 6: Act 2~4 마을 NPC·막 이동·용병·호라드릭 큐브 (원작 메뉴·상점 buysell.dc6·큐브 supertransmogrifier.dc6).
// 퀘스트 조건(Andariel·Duriel·Mephisto)은 Phase 7 전이라 퀘스트 기록을 디버그로 켠다. 스크린샷: test-results/town-*.png

async function clickCanvas(page: Page, p: { x: number; y: number }, button: 'left' | 'right' = 'left'): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + (p.x * box.width) / 800, box.y + (p.y * box.height) / 600, { button });
}

async function moveMouse(page: Page, p: { x: number; y: number }): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.move(box.x + (p.x * box.width) / 800, box.y + (p.y * box.height) / 600);
}

/** NPC 곁으로 옮긴 뒤 그 NPC 의 클릭 상자를 눌러 걸어가 말 걸기 → 메뉴가 열릴 때까지 */
async function talkTo(page: Page, typeId: string): Promise<void> {
  // 대화·패널을 닫는다 (오른쪽 인벤토리 패널이 NPC 를 가리지 않게)
  await page.evaluate(() => {
    window.__game!.game.enqueue({ type: 'closeNpc' });
    window.__game!.ui!.inventory.open = false;
  });
  await page.evaluate((id) => {
    // NPC 자리에서 걸어서 닿는 칸 (너비 우선) 중 3~6 서브타일 떨어진 첫 칸 — 벽 너머 칸을 고르지 않게
    const g = window.__game!.game;
    const n = g.npcs.find((x) => x.type.id === id)!;
    const m = g.map;
    const sx = Math.floor(n.x), sy = Math.floor(n.y);
    const seen = new Set<number>([sy * m.width + sx]);
    const q: [number, number][] = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.shift()!;
      const d = Math.hypot(x - sx, y - sy);
      if (d >= 3 && d <= 6 && m.walkable(x, y)) {
        g.changeLevel(g.levelId, x + 0.5, y + 0.5);
        return;
      }
      if (d > 8) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy, k = ny * m.width + nx;
        if (seen.has(k) || nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
        seen.add(k);
        if (m.walkable(nx, ny) || (Math.abs(nx - sx) <= 1 && Math.abs(ny - sy) <= 1)) q.push([nx, ny]);
      }
    }
  }, typeId);
  const id = await page.evaluate((t) => window.__game!.game.npcs.find((x) => x.type.id === t)!.id, typeId);
  // NPC 는 돌아다녀 부하가 클 때 클릭이 빗나갈 수 있으므로 대화가 열릴 때까지 위치를 다시 잡아 누른다
  for (let tries = 0; tries < 4; tries++) {
  await page.waitForFunction((nid) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'npc' && b.id === nid), id, { timeout: 15_000 });
  // 클릭 상자 안에서 다른 유닛(용병 등) 상자에 가리지 않은 점
  const p = await page.evaluate((nid) => {
    const boxes = window.__game!.input!.pickBoxes;
    const b = boxes.find((x) => x.kind === 'npc' && x.id === nid)!;
    const others = boxes.filter((x) => x !== b && x.kind !== 'item');
    for (let fy = 0.5; fy > 0.05; fy -= 0.1)
      for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const x = b.x + b.w * fx, y = b.y + b.h * fy;
        if (!others.some((o) => x >= o.x && y >= o.y && x < o.x + o.w && y < o.y + o.h)) return { x, y };
      }
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }, id);
  await clickCanvas(page, p);
  const opened = await page
    .waitForFunction((t) => window.__game!.game.snapshot().interaction?.typeId === t, typeId, { timeout: 6_000 })
    .then(() => true, () => false);
  if (opened) break;
  }
  try {
    await page.waitForFunction((t) => window.__game!.game.snapshot().interaction?.typeId === t, typeId, { timeout: 2_000 });
  } catch (e) {
    await page.screenshot({ path: `test-results/debug-talk-${typeId}.png` });
    console.log(JSON.stringify(await page.evaluate((t) => {
      const g = window.__game!.game;
      const n = g.npcs.find((x) => x.type.id === t)!;
      const s = g.snapshot();
      return { p: [s.player.x, s.player.y, s.player.mode], n: [n.x, n.y, n.mode, n.npc], hover: window.__game!.ui!.hover(), inter: s.interaction?.typeId };
    }, typeId)));
    throw e;
  }
  await page.waitForTimeout(200);
}

async function chooseMenu(page: Page, option: string): Promise<void> {
  const p = await page.evaluate((o) => window.__game!.ui!.npcMenu.optionCenter(o as never), option);
  expect(p, option).not.toBeNull();
  await clickCanvas(page, p!);
}

/** 막 이동 메뉴 → 도착 마을 (막 파일을 아직 읽는 중이면 브라우저가 읽고 다시 보낸다) */
async function travel(page: Page, npc: string, option: string, town: string): Promise<void> {
  await talkTo(page, npc);
  expect(await page.evaluate(() => window.__game!.game.snapshot().interaction!.options)).toContain(option);
  await chooseMenu(page, option);
  await page.waitForFunction((t) => window.__game!.game.levelId === t, town, { timeout: 150_000 });
  // 마을 NPC 가 놓이고 첫 그림이 그려질 때까지
  await page.waitForFunction(() => window.__game!.game.npcs.length > 0, undefined, { timeout: 15_000 });
  await page.waitForTimeout(1500);
}

async function openStore(page: Page, npc: string, option: string, shot: string): Promise<void> {
  await talkTo(page, npc);
  await chooseMenu(page, option);
  await page.waitForFunction(() => window.__game!.ui!.store.open && window.__game!.ui!.store.ready, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => window.__game!.game.snapshot().interaction!.store.length > 0, undefined, { timeout: 5000 });
  // 아이템 하나에 마우스 (원작 툴팁·가격)
  const at = await page.evaluate(() => {
    const s = window.__game!.game.snapshot().interaction!.store;
    const first = s.find((x) => x.page === window.__game!.ui!.store.page) ?? s[0]!;
    window.__game!.ui!.store.page = first.page;
    return window.__game!.ui!.store.itemCenter(first.item.id);
  });
  if (at) await moveMouse(page, at);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `test-results/town-${shot}.png` });
}

test('Act 1 → 2 (Warriv) → Fara 거래 → Greiz 용병 → Meshif → Act 3 Ormus → Act 4 Jamella', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Acts'), 'sorceress');
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.character!.level = 24;
    g.gold = 200000;
    // 디버그: A1Q6 (Andariel) 보상 받음 → Warriv go east
    g.questRecord.set(6, 0);
  });
  // Warriv: go east → Lut Gholein (웨이포인트 9)
  await travel(page, 'warriv1', 'goEast', 'lutgholein');
  expect(await page.evaluate(() => [window.__game!.game.act, window.__game!.game.waypoints.has(9)])).toEqual([1, true]);
  await page.screenshot({ path: 'test-results/town-lutgholein.png' });

  // Fara: trade/repair → 사기
  await openStore(page, 'fara', 'tradeRepair', 'fara-store');
  const buy = await page.evaluate(() => {
    const g = window.__game!.game;
    const s = g.snapshot().interaction!.store.find((x) => x.page === window.__game!.ui!.store.page)!;
    return { id: s.item.id, cost: g.priceOf(s.item, 'buy'), gold: g.gold, at: window.__game!.ui!.store.itemCenter(s.item.id)! };
  });
  await clickCanvas(page, buy.at);
  await page.waitForFunction((v) => window.__game!.game.gold === v, buy.gold - buy.cost, { timeout: 5000 });

  // Greiz: 사막 용병 고용 (hireling.txt Act 2 — act2hire)
  await talkTo(page, 'greiz');
  await chooseMenu(page, 'hire');
  await page.waitForFunction(() => window.__game!.game.snapshot().interaction?.mode === 'hire', undefined, { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/town-greiz-hire.png' });
  const row = await page.evaluate(() => window.__game!.ui!.hire.rowCenter(0));
  await clickCanvas(page, row!);
  await page.waitForFunction(() => window.__game!.game.snapshot().merc?.typeId === 'act2hire', undefined, { timeout: 5000 });
  await page.evaluate(() => window.__game!.game.enqueue({ type: 'closeNpc' }));
  await page.waitForFunction(() => window.__game!.ui!.mercBar.readyFor('act2hire'), undefined, { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/town-greiz-merc.png' });

  // Meshif: sail east (디버그: A2Q6 보상 받음) → Kurast Docks, 용병이 따라온다
  await page.evaluate(() => window.__game!.game.questRecord.set(14, 0));
  await travel(page, 'meshif1', 'sailEast', 'kurastdocks');
  expect(await page.evaluate(() => [window.__game!.game.act, window.__game!.game.mercUnit()?.type.id])).toEqual([2, 'act2hire']);
  await page.screenshot({ path: 'test-results/town-kurastdocks.png' });
  await openStore(page, 'ormus', 'trade', 'ormus-store');

  // Act 3 → 4: 증오의 억류지 포털 (Phase 7) 대신 엔진 막 이동 (디버그: A3Q6 주 목표 완료)
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.enqueue({ type: 'closeNpc' });
    g.questRecord.set(22, 13);
    g.enqueue({ type: 'travelAct', act: 3 });
  });
  await page.waitForFunction(() => window.__game!.game.levelId === 'pandemonium', undefined, { timeout: 150_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/town-pandemonium.png' });
  await talkTo(page, 'jamella');
  expect(await page.evaluate(() => window.__game!.game.snapshot().interaction!.options)).toEqual(['talk', 'trade', 'gamble', 'cancel']);
  await page.screenshot({ path: 'test-results/town-jamella-menu.png' });
  await openStore(page, 'jamella', 'trade', 'jamella-store');
  expect(errors).toEqual([]);
});

test('호라드릭 큐브: 오른쪽 클릭으로 열고 조각 보석 3개 → 트랜스뮤트 → 흠 있는 보석', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Cube'), 'paladin');
  // 큐브 (Phase 7 이 Halls of the Dead 상자에 놓는다)와 조각 자수정 3개를 인벤토리에
  await page.evaluate(() => {
    const g = window.__game!.game;
    const it = g.spawnCube(g.levelId, g.snapshot().player.x, g.snapshot().player.y)!;
    g.enqueue({ type: 'pickup', itemId: it.id });
  });
  await page.waitForFunction(() => window.__game!.game.inventory.some((i) => i.code === 'box'), undefined, { timeout: 10_000 });
  const gemIds = await page.evaluate(() => {
    const g = window.__game!.game;
    const d = g.data!;
    // 보석은 굴림이 없다 (misc, 내구·스택 없음) — 생성 굴림기는 쓰이지 않는다
    const rng = { next: () => 1n, pick: () => 0, roll: () => 1 } as never;
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const it = d.treasure.createItem(d.items.base('gcv')!, 5, rng, 2, false);
      it.identified = true;
      g.store.inv.autoAdd(it);
      ids.push(it.id);
    }
    return ids;
  });
  // 인벤토리 열기 → 큐브 오른쪽 클릭
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  const cellOf = (id: number) => page.evaluate((iid) => {
    const g = window.__game!.game;
    const p = g.store.inv.items.find((x) => x.item.id === iid)!;
    const L = window.__game!.ui!.inventory.layout.grid;
    return { x: L.l + (p.x + p.item.invW / 2) * L.box, y: L.t + (p.y + p.item.invH / 2) * L.box };
  }, id);
  const boxId = await page.evaluate(() => window.__game!.game.inventory.find((i) => i.code === 'box')!.id);
  await clickCanvas(page, await cellOf(boxId), 'right');
  await page.waitForFunction(() => window.__game!.ui!.cube.open && window.__game!.game.cubeOpen, undefined, { timeout: 5000 });
  await page.waitForFunction(() => window.__game!.ui!.cube.ready, undefined, { timeout: 10_000 });
  // 보석을 집어 큐브 칸에 놓는다 (원작: 왼쪽 클릭 = 집기/놓기)
  for (let i = 0; i < 3; i++) {
    await clickCanvas(page, await cellOf(gemIds[i]!));
    await page.waitForFunction(() => !!window.__game!.game.store.cursor, undefined, { timeout: 5000 });
    const cell = await page.evaluate((k) => window.__game!.ui!.cube.cellCenter(k, 0), i);
    await clickCanvas(page, cell);
    await page.waitForFunction((n) => window.__game!.game.store.cube.items.length === n, i + 1, { timeout: 5000 });
  }
  await moveMouse(page, await page.evaluate(() => window.__game!.ui!.cube.transmuteCenter()));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/town-cube-before.png' });
  await clickCanvas(page, await page.evaluate(() => window.__game!.ui!.cube.transmuteCenter()));
  await page.waitForFunction(() => window.__game!.game.store.cube.items.map((p) => p.item.code).join() === 'gfv', undefined, { timeout: 5000 });
  await moveMouse(page, await page.evaluate(() => window.__game!.ui!.cube.cellCenter(0, 0)));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/town-cube-transmute.png' });
  // 닫기 단추
  await clickCanvas(page, await page.evaluate(() => window.__game!.ui!.cube.closeCenter()));
  await page.waitForFunction(() => !window.__game!.ui!.cube.open && !window.__game!.game.cubeOpen, undefined, { timeout: 5000 });
  expect(errors).toEqual([]);
});
