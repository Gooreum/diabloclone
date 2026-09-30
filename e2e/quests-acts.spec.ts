// Phase 7: Act 2~4 퀘스트 (원작 D2MOO A2Q1~A4Q3 상태 기계) — 브라우저에서 호라드릭 지팡이 큐브 조립, 소환사 → 협곡 포털,
// 오리피스 → 두리엘 → Tyrael 포털, 퀘스트 창 탭 II·III·IV (원작 a2q1~a4q3.dc6), 디아블로 처치 → 다음 난이도 해금 (난이도 창).
// 디버그 단축: 레벨 순간 이동(changeLevel), 방해 몬스터 치우기(monsters.splice), 보스 처치(killMonster). 스크린샷: test-results/quest-a*.png
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(600_000);

type AnyGame = Record<string, unknown> & {
  levelDef(k: string): { map: { width: number; height: number; walkable(x: number, y: number): boolean }; objects?: { classId: number; x: number; y: number }[]; portalSpot?: { x: number; y: number } } | undefined;
};

/** 레벨로 순간 이동 (목표 근처 걷기 가능한 칸) + 퀘스트 몬스터가 아닌 몬스터를 치운다 */
async function goLevel(page: Page, key: string, near?: { x: number; y: number } | number): Promise<void> {
  await page.evaluate(({ key, near }) => {
    const g = window.__game!.game as unknown as AnyGame & { changeLevel(k: string, x: number, y: number): void; monsters: { type: { id: string }; superUnique?: number; pet?: unknown }[]; exitHold: boolean };
    const def = g.levelDef(key)!;
    let at = def.portalSpot ?? { x: def.map.width / 2, y: def.map.height / 2 };
    if (typeof near === 'number') {
      const o = def.objects!.find((x) => x.classId === near)!;
      at = { x: o.x + 2, y: o.y + 2 };
    } else if (near) at = near;
    const m = def.map;
    let best: { x: number; y: number } | null = null;
    for (let r = 0; r < 60 && !best; r++)
      for (let dy = -r; dy <= r && !best; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.floor(at.x) + dx, y = Math.floor(at.y) + dy;
          if (x >= 0 && y >= 0 && x < m.width && y < m.height && m.walkable(x, y)) {
            best = { x, y };
            break;
          }
        }
    g.changeLevel(key, best!.x + 0.5, best!.y + 0.5);
    g.exitHold = true;
  }, { key, near });
  await page.waitForFunction((k) => window.__game!.game.levelId === k, key);
  await page.evaluate(() => {
    const g = window.__game!.game as unknown as { monsters: { type: { id: string }; superUnique?: number; pet?: unknown; npc?: unknown }[] };
    const keep = ['radament', 'summoner', 'duriel', 'mephisto', 'izual', 'hephasto', 'diablo'];
    for (let i = g.monsters.length - 1; i >= 0; i--) if (!keep.includes(g.monsters[i]!.type.id) && !g.monsters[i]!.pet) g.monsters.splice(i, 1);
  });
  await page.waitForTimeout(300);
}

/** 레벨의 퀘스트 오브젝트 조작 (Game.operateObject — 원작 OBJECTS_OperateHandler) */
async function operate(page: Page, cls: number): Promise<void> {
  await page.evaluate((cls) => {
    const g = window.__game!.game;
    const o = g.objects.find((x) => x.type.id === cls)!;
    g.operateObject(o as never);
  }, cls);
}

/** 땅의 코드 아이템을 줍기 명령으로 (걸어가서 줍는다) */
async function pick(page: Page, code: string): Promise<void> {
  await page.evaluate((code) => {
    const g = window.__game!.game;
    const it = g.snapshot().items.find((x) => x.code === code)!;
    g.enqueue({ type: 'pickup', itemId: it.id });
  }, code);
  await page.waitForFunction((code) => window.__game!.game.store.allItems().some((x) => x.code === code), code, { timeout: 20_000 });
}

/** 보스를 죽인다 (디버그: 엔진 killMonster — 원작 퀘스트 콜백 MonsterKilled) */
async function killBoss(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const g = window.__game!.game as unknown as { monsters: { type: { id: string }; x: number; y: number; mode: string }[]; killMonster(m: unknown, s: string): void; changeLevel(k: string, x: number, y: number): void; levelId: string };
    const m = g.monsters.find((x) => x.type.id === id && x.mode !== 'DT' && x.mode !== 'DD')!;
    g.changeLevel(g.levelId, m.x + 2, m.y + 2);
    g.killMonster(m, 'player');
    return { x: m.x, y: m.y };
  }, id);
}

/** NPC 에게 걸어가 말 걸기 (interact 명령) → 대화가 열릴 때까지 */
async function talk(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const g = window.__game!.game as unknown as { npcs: { id: number; type: { id: string }; x: number; y: number }[]; changeLevel(k: string, x: number, y: number): void; levelId: string; map: { walkable(x: number, y: number): boolean }; enqueue(c: unknown): void };
    const n = g.npcs.find((x) => x.type.id === id)!;
    for (const [dx, dy] of [[2, 1], [1, 2], [-2, 1], [2, -1], [3, 0], [0, 3], [-3, 0], [0, -3]]) {
      if (g.map.walkable(Math.floor(n.x) + dx!, Math.floor(n.y) + dy!)) {
        g.changeLevel(g.levelId, Math.floor(n.x) + dx! + 0.5, Math.floor(n.y) + dy! + 0.5);
        break;
      }
    }
    g.enqueue({ type: 'interact', unitId: n.id });
  }, id);
  await page.waitForFunction((id) => window.__game!.game.snapshot().interaction?.typeId === id, id, { timeout: 20_000 });
}

/** 막 이동 (퀘스트 기록으로 조건을 켠 뒤 travelAct — 막 파일을 읽는 동안 브라우저가 다시 보낸다) */
async function travel(page: Page, act: number, town: string): Promise<void> {
  await page.evaluate((act) => window.__game!.game.enqueue({ type: 'travelAct', act }), act);
  await page.waitForFunction((t) => window.__game!.game.levelId === t, town, { timeout: 200_000 });
  await page.waitForFunction(() => window.__game!.game.npcs.length > 0, undefined, { timeout: 20_000 });
  await page.waitForTimeout(1000);
}

async function heroSetup(page: Page, name: string): Promise<void> {
  await newHero(page, name, 'sorceress');
  // 디버그: 보스 곁에서 버티도록 생명을 크게
  await page.evaluate(() => {
    const c = window.__game!.game.character!;
    c.maxLife = c.life = 100000;
    c.level = 30;
  });
}

/** 퀘스트 창 (Q) 을 열고 탭 고르기 → 원작 DC6 이 다 읽힐 때까지 */
async function questPanel(page: Page, tab: number, shot: string): Promise<void> {
  if (!(await page.evaluate(() => window.__game!.ui!.quest.open))) await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.ui!.quest.open && window.__game!.ui!.quest.ready, undefined, { timeout: 20_000 });
  await page.evaluate((tab) => {
    window.__game!.ui!.quest.tab = tab;
  }, tab);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `test-results/${shot}.png` });
}

test('Act 2: 호라드릭 지팡이 큐브 조립 → 소환사·일지 → 마기의 협곡 포털 → 오리피스 → 두리엘 방 → Tyrael 포털, 퀘스트 창 탭 II', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await heroSetup(page, uniqueName('Staff'));
  // Act 1 → 2 (디버그: A1Q6 보상 받음 = Warriv 동쪽으로)
  await page.evaluate(() => window.__game!.game.questRecord.set(6, 0));
  await travel(page, 1, 'lutgholein');

  // 오염된 태양: 잃어버린 도시에 들어가면 15~16 틱 뒤 해가 가려진다 (A2Q3)
  await goLevel(page, 'lostcity');
  await page.waitForFunction(() => window.__game!.game.taintedSun, undefined, { timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/quest-a2-tainted-sun.png' });
  // 큐브 (죽은 자의 전당 3층 상자 354), 왕의 지팡이 (구더기 굴 3층 상자 356), 독사 부적 (발톱 독사 사원 2층 제단 149)
  for (const [level, cls, code] of [['hallsofdead3', 354, 'box'], ['maggotlair3', 356, 'msf'], ['clawviper2', 149, 'vip']] as const) {
    await goLevel(page, level, cls);
    await operate(page, cls);
    await page.waitForFunction((c) => window.__game!.game.snapshot().items.some((x) => x.code === c), code, { timeout: 10_000 });
    await pick(page, code);
  }
  // 제단을 부쉈으니 해가 돌아온다
  expect(await page.evaluate(() => window.__game!.game.taintedSun)).toBe(false);
  // 큐브 창: 조각 두 개를 큐브 칸으로 → 트랜스뮤트
  await goLevel(page, 'lutgholein');
  await page.evaluate(() => {
    const g = window.__game!.game;
    const ids = g.store.allItems().filter((x) => x.code === 'msf' || x.code === 'vip').map((x) => x.id);
    g.enqueue({ type: 'openCube' });
    g.enqueue({ type: 'moveItem', itemId: ids[0]!, to: { kind: 'cube', x: 0, y: 0 } });
    g.enqueue({ type: 'moveItem', itemId: ids[1]!, to: { kind: 'cube', x: 2, y: 0 } });
  });
  await page.waitForFunction(() => window.__game!.game.store.cube.items.length === 2 && window.__game!.ui!.cube.open, undefined, { timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/quest-a2-cube-before.png' });
  await page.evaluate(() => window.__game!.game.enqueue({ type: 'transmute' }));
  await page.waitForFunction(() => window.__game!.game.store.cube.items.some((p) => p.item.code === 'hst'), undefined, { timeout: 10_000 });
  // 큐브 퀘스트 아이템 → A2Q2 CUSTOM7 (워드 10 비트 11)
  await page.waitForFunction(() => window.__game!.game.questRecord.get(10, 11), undefined, { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/quest-a2-cube.png' });
  await page.evaluate(() => {
    window.__game!.game.enqueue({ type: 'closeCube' });
    window.__game!.ui!.cube.open = false;
    window.__game!.ui!.inventory.open = false;
  });

  // 소환사 → 일지 → 붉은 포털 (마기의 협곡)
  await goLevel(page, 'arcane');
  await killBoss(page, 'summoner');
  await goLevel(page, 'arcane', 357);
  await operate(page, 357);
  await page.waitForFunction(() => window.__game!.game.objects.some((o) => o.portal?.toLevel === 'canyon'), undefined, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__game!.game.questRecord.get(13, 1))).toBe(true); // A2Q5 REWARDPENDING
  expect(await page.evaluate(() => window.__game!.game.questRecord.get(12, 0))).toBe(true); // A2Q4 REWARDGRANTED
  await page.waitForTimeout(1500);
  await page.locator('#game').screenshot({ path: 'test-results/quest-a2-canyon-portal.png' });
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.usePortal(g.objects.find((o) => o.portal?.toLevel === 'canyon') as never);
  });
  await page.waitForFunction(() => window.__game!.game.levelId === 'canyon');

  // 오리피스 (진짜 무덤) → 두리엘 방 포털
  const tomb = await page.evaluate(() => {
    const g = window.__game!.game as unknown as AnyGame;
    for (let n = 66; n <= 72; n++) {
      const k = `taltomb${n - 65}`;
      if (g.levelDef(k)?.objects?.some((o) => o.classId === 152)) return k;
    }
    return '';
  });
  expect(tomb).not.toBe('');
  await goLevel(page, tomb, 152);
  await operate(page, 152);
  expect(await page.evaluate(() => window.__game!.game.questRecord.get(10, 0))).toBe(true); // A2Q2 보상 받음
  await page.waitForFunction(() => window.__game!.game.objects.some((o) => o.type.id === 100), undefined, { timeout: 15_000 });
  // 포털 곁에서 (오리피스 −13, +3)
  const lair = await page.evaluate(() => {
    const o = window.__game!.game.objects.find((x) => x.type.id === 100)!;
    return { x: o.x, y: o.y, mode: o.mode };
  });
  await goLevel(page, tomb, { x: lair.x + 3, y: lair.y + 3 });
  await page.waitForTimeout(2000);
  await page.locator('#game').screenshot({ path: 'test-results/quest-a2-orifice.png' });
  await operate(page, 100);
  await page.waitForFunction(() => window.__game!.game.levelId === 'durielslair', undefined, { timeout: 10_000 });
  await goLevel(page, 'durielslair');
  await killBoss(page, 'duriel');
  await page.waitForFunction(() => window.__game!.game.objects.find((o) => o.type.id === 153)?.mode === 2, undefined, { timeout: 15_000 });
  await talk(page, 'tyrael1');
  await page.waitForFunction(() => window.__game!.game.objects.some((o) => o.portal && o.type.id === 59), undefined, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__game!.game.questRecord.get(14, 13))).toBe(true); // A2Q6 PGD
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/quest-a2-tyrael.png' });
  await page.evaluate(() => window.__game!.game.enqueue({ type: 'closeNpc' }));

  // 퀘스트 창 탭 II
  await questPanel(page, 1, 'quest-a2-panel');
  const log = await page.evaluate(() => window.__game!.game.questLog(1).map((e) => `${e.quest}:${e.icon}`));
  // A2Q4: 일지로 보상 받음·보상 대기 둘 다 (마을 사람과 이야기하기 전까지 진행 중)
  expect(log).toEqual(['1:none', '2:done', '3:active', '4:active', '5:active', '6:active']);
  expect(errors).toEqual([]);
});

test('Act 3·4: 퀘스트 창 탭 III·IV, 메피스토 → 지옥문 → Act 4, 디아블로 처치 → Save and Exit → 난이도 창에 Nightmare', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('End');
  await heroSetup(page, name);
  await page.evaluate(() => window.__game!.game.questRecord.set(6, 0));
  await travel(page, 1, 'lutgholein');
  await page.evaluate(() => window.__game!.game.questRecord.set(14, 0));
  await travel(page, 2, 'kurastdocks');
  // 퀘스트 창 탭 III (Act 3 퀘스트가 시작 전 — 원작 순서: 황금새·기드빈·칼림·람 에센·검은 사원·수호자)
  await questPanel(page, 2, 'quest-a3-panel');
  expect(await page.evaluate(() => window.__game!.game.questLog(2).map((e) => e.quest))).toEqual([4, 3, 2, 1, 5, 6]);
  await page.evaluate(() => {
    window.__game!.ui!.quest.open = false;
  });
  // 메피스토 → 지옥문 열림 → 지옥문으로 Act 4
  await goLevel(page, 'durance3');
  await killBoss(page, 'mephisto');
  await page.waitForFunction(() => window.__game!.game.objects.find((o) => o.type.id === 342)?.mode === 2, undefined, { timeout: 15_000 });
  await goLevel(page, 'durance3', 342);
  await page.waitForTimeout(1500);
  await page.locator('#game').screenshot({ path: 'test-results/quest-a3-hellgate.png' });
  // 실제 조작처럼 명령으로 (게임 틱 안에서 처리 → Act 4 파일을 아직 읽는 중이면 브라우저가 읽고 다시 보낸다)
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.enqueue({ type: 'interact', unitId: g.objects.find((x) => x.type.id === 342)!.id });
  });
  await page.waitForFunction(() => window.__game!.game.levelId === 'pandemonium', undefined, { timeout: 200_000 });
  await page.waitForFunction(() => window.__game!.game.npcs.length > 0, undefined, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__game!.game.progression)).toBe(3);

  // 디아블로 (카오스 생추어리): 디버그로 소환해 죽인다
  await goLevel(page, 'chaossanctuary');
  await page.evaluate(() => {
    const g = window.__game!.game as unknown as { spawnMonster(id: string, x: number, y: number): unknown; snapshot(): { player: { x: number; y: number } } };
    const p = g.snapshot().player;
    g.spawnMonster('diablo', p.x + 3, p.y);
  });
  await killBoss(page, 'diablo');
  expect(await page.evaluate(() => window.__game!.game.difficultyUnlocked)).toBe(1);
  expect(await page.evaluate(() => window.__game!.game.progression)).toBe(4);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/quest-a4-diablo.png' });
  await questPanel(page, 3, 'quest-a4-panel');
  expect(await page.evaluate(() => window.__game!.game.questLog(3).map((e) => `${e.quest}:${e.icon}`))).toEqual(['1:none', '3:none', '2:done']);

  // Save and Exit → 불러오기 → 난이도 창 (Nightmare 열림)
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true);
  const saved = await page.evaluate((n) => window.__heroStore!.load(n), name);
  expect(saved?.difficultyUnlocked).toBe(1);
  expect(saved?.progression).toBe(4);
  await page.click('#btn-single');
  await page.click(`#hero-${name}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/quest-a4-charselect.png' });
  await page.click('#btn-select-ok');
  expect(await page.evaluate(() => window.__menu!.difficultyOpen)).toBe(true);
  await expect(page.locator('#btn-diff-nightmare')).toBeEnabled();
  await expect(page.locator('#btn-diff-hell')).toBeDisabled();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/quest-a4-unlock.png' });
  expect(errors).toEqual([]);
});
