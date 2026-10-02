// 전체 흐름: 한 캐릭터로 Act 1 → 4 (퀘스트 기록을 직접 켜지 않고 보스 처치·NPC 대화로 막을 넘는다) → 디아블로 → Save and Exit → Nightmare
// 디버그 단축: 보스 곁으로 순간 이동해 엔진 killMonster, 생명 크게. 원작 조건(A1Q6·A2Q6 보상, A3Q6 지옥문)은 엔진이 본다.
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(900_000);

type G = {
  levelDef(k: string): { map: { width: number; height: number; walkable(x: number, y: number): boolean }; portalSpot?: { x: number; y: number } } | undefined;
  changeLevel(k: string, x: number, y: number): void;
  monsters: { type: { id: string }; x: number; y: number; mode: string; pet?: unknown }[];
  killMonster(m: unknown, s: string): void;
  spawnMonster(id: string, x: number, y: number): unknown;
  exitHold: boolean;
};

const BOSSES = ['andariel', 'duriel', 'mephisto', 'diablo'];

/** 레벨로 순간 이동 (가운데·포털 자리 근처 걷기 가능한 칸) + 보스가 아닌 몬스터를 치운다 */
async function goLevel(page: Page, key: string): Promise<void> {
  await page.evaluate((key) => {
    const g = window.__game!.game as unknown as G;
    const def = g.levelDef(key)!;
    const at = def.portalSpot ?? { x: def.map.width / 2, y: def.map.height / 2 };
    const m = def.map;
    for (let r = 0; r < 80; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.floor(at.x) + dx, y = Math.floor(at.y) + dy;
          if (x >= 0 && y >= 0 && x < m.width && y < m.height && m.walkable(x, y)) {
            g.changeLevel(key, x + 0.5, y + 0.5);
            g.exitHold = true;
            return;
          }
        }
  }, key);
  await page.waitForFunction((k) => window.__game!.game.levelId === k, key, { timeout: 30_000 });
  await page.evaluate((keep) => {
    const g = window.__game!.game as unknown as G;
    for (let i = g.monsters.length - 1; i >= 0; i--) if (!keep.includes(g.monsters[i]!.type.id) && !g.monsters[i]!.pet) g.monsters.splice(i, 1);
  }, BOSSES);
  await page.waitForTimeout(300);
}

/** 보스 곁으로 가서 죽인다 (없으면 소환 — 디아블로는 봉인을 건너뛴다) */
async function killBoss(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const g = window.__game!.game as unknown as G & { snapshot(): { player: { x: number; y: number } } };
    let m = g.monsters.find((x) => x.type.id === id && x.mode !== 'DT' && x.mode !== 'DD');
    if (!m) {
      const p = g.snapshot().player;
      g.spawnMonster(id, p.x + 3, p.y);
      m = g.monsters.find((x) => x.type.id === id)!;
    }
    g.changeLevel((window.__game!.game as unknown as { levelId: string }).levelId, m.x + 2, m.y + 2);
    g.killMonster(m, 'player');
  }, id);
  await page.waitForTimeout(500);
}

/** NPC 곁으로 가서 말 걸기 → 대화가 열릴 때까지 */
async function talk(page: Page, id: string): Promise<void> {
  await page.evaluate(() => window.__game!.game.enqueue({ type: 'closeNpc' }));
  await page.evaluate((id) => {
    const g = window.__game!.game;
    const n = g.npcs.find((x) => x.type.id === id)!;
    for (const [dx, dy] of [[2, 1], [1, 2], [-2, 1], [2, -1], [3, 0], [0, 3], [-3, 0], [0, -3]] as const)
      if (g.map.walkable(Math.floor(n.x) + dx, Math.floor(n.y) + dy)) {
        g.changeLevel(g.levelId, Math.floor(n.x) + dx + 0.5, Math.floor(n.y) + dy + 0.5);
        break;
      }
    g.enqueue({ type: 'interact', unitId: n.id });
  }, id);
  await page.waitForFunction((id) => window.__game!.game.snapshot().interaction?.typeId === id, id, { timeout: 20_000 });
  await page.waitForTimeout(300);
}

/** 말 걸고 메뉴의 퀘스트 대사를 모두 듣는다 (원작: 두루마리를 읽으면 ScrollMessage 콜백) */
async function hearQuests(page: Page, id: string): Promise<void> {
  await talk(page, id);
  const opts = await page.evaluate(() => window.__game!.game.snapshot().interaction!.options.filter((o) => o.startsWith('quest:')));
  for (const o of opts) {
    await page.evaluate((o) => window.__game!.game.enqueue({ type: 'npcMenu', option: o as never }), o);
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => window.__game!.game.enqueue({ type: 'closeNpc' }));
  await page.waitForTimeout(300);
}

/** 대화 메뉴 고르기 (NPC 메뉴에 있어야 한다) */
async function choose(page: Page, option: string): Promise<void> {
  expect(await page.evaluate(() => window.__game!.game.snapshot().interaction!.options), option).toContain(option);
  await page.evaluate((o) => window.__game!.game.enqueue({ type: 'npcMenu', option: o as never }), option);
}

/** 막 이동 뒤 도착 마을이 준비될 때까지 */
async function arrive(page: Page, town: string, act: number): Promise<void> {
  await page.waitForFunction((t) => window.__game!.game.levelId === t, town, { timeout: 200_000 });
  await page.waitForFunction(() => window.__game!.game.npcs.length > 0, undefined, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__game!.game.act)).toBe(act);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `test-results/full-${town}.png` });
}

test('전체 흐름: Andariel → Warriv → Duriel → Jerhyn·Meshif → Mephisto → 지옥문 → Diablo → 저장 → Nightmare 시작', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('Full');
  // 클래식 캐릭터: 디아블로를 잡으면 다음 난이도가 열린다 (확장팩 캐릭터는 바알까지 — e2e/act5.spec.ts)
  await newHero(page, name, 'barbarian', { classic: true });
  await page.evaluate(() => {
    const c = window.__game!.game.character!;
    c.maxLife = c.life = 100000;
    c.level = 30;
  });

  // Act 1: 안다리엘 → 마을 Warriv 에게서 보상(A1Q6) → go east
  await goLevel(page, 'catacombs4');
  await killBoss(page, 'andariel');
  await page.waitForFunction(() => window.__game!.game.questRecord.get(6, 13), undefined, { timeout: 15_000 }); // A1Q6 PRIMARYGOALDONE
  await goLevel(page, 'town');
  await talk(page, 'warriv1');
  // 대화로 보상을 받은 뒤 메뉴에 go east 가 생긴다 (원작 NPC_HandleDialogMessage)
  await page.waitForFunction(() => window.__game!.game.questRecord.get(6, 0), undefined, { timeout: 15_000 }); // REWARDGRANTED
  await talk(page, 'warriv1');
  await choose(page, 'goEast');
  await arrive(page, 'lutgholein', 1);

  // Act 2: 두리엘 → Tyrael → 마을 Jerhyn(A2Q6 보상) → Meshif sail east
  await goLevel(page, 'durielslair');
  await killBoss(page, 'duriel');
  await talk(page, 'tyrael1');
  await page.waitForFunction(() => window.__game!.game.questRecord.get(14, 13), undefined, { timeout: 15_000 }); // A2Q6 PRIMARYGOALDONE
  await goLevel(page, 'lutgholein');
  // Jerhyn 대사(442) → Meshif 대사(450) 에서 보상 (출처: ACT2Q6_Callback11_ScrollMessage)
  await hearQuests(page, 'jerhyn');
  await hearQuests(page, 'meshif1');
  await page.waitForFunction(() => window.__game!.game.questRecord.get(14, 0), undefined, { timeout: 15_000 }); // A2Q6 REWARDGRANTED
  await talk(page, 'meshif1');
  await choose(page, 'sailEast');
  await arrive(page, 'kurastdocks', 2);

  // Act 3: 메피스토 → 지옥문 (클릭과 같은 interact 명령) → 판데모니움 요새
  await goLevel(page, 'durance3');
  await killBoss(page, 'mephisto');
  await page.waitForFunction(() => window.__game!.game.objects.find((o) => o.type.id === 342)?.mode === 2, undefined, { timeout: 15_000 });
  await page.evaluate(() => {
    const g = window.__game!.game;
    const o = g.objects.find((x) => x.type.id === 342)!;
    g.changeLevel(g.levelId, o.x + 2.5, o.y + 2.5);
    g.enqueue({ type: 'interact', unitId: o.id });
  });
  await arrive(page, 'pandemonium', 3);

  // Act 4: 디아블로 → Normal 완료 (Nightmare 해금)
  await goLevel(page, 'chaossanctuary');
  await killBoss(page, 'diablo');
  await page.waitForFunction(() => window.__game!.game.difficultyUnlocked === 1, undefined, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__game!.game.progression)).toBe(4);
  await page.screenshot({ path: 'test-results/full-diablo.png' });

  // Save and Exit → 캐릭터 고르기 → 난이도 창에서 Nightmare → Act 1 마을에서 시작
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true);
  await page.click('#btn-single');
  await page.click(`#hero-${name}`);
  await page.click('#btn-select-ok');
  await expect(page.locator('#btn-diff-nightmare')).toBeEnabled();
  await page.click('#btn-diff-nightmare');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => window.__game!.game.npcs.length > 0, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => [window.__game!.game.difficulty, window.__game!.game.act, window.__game!.game.levelId])).toEqual([1, 0, 'town']);
  expect(await page.evaluate(() => window.__game!.game.character!.level)).toBe(30);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/full-nightmare-town.png' });
  expect(errors).toEqual([]);
});
