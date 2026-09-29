// Act 1 퀘스트 (브라우저): Den of Evil → Akara 보상, Cairn Stones → 트리스트럼 → Cain 구출 → 마을 Cain 무료 감정, 퀘스트 로그 (Q).
// 테스트 안에서만 디버그 지름길(순간 이동·몬스터 처치·아이템 넣기)을 쓴다.
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(300_000);

async function clickCanvas(page: Page, p: { x: number; y: number }, button: 'left' | 'right' = 'left'): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + (p.x * box.width) / 800, box.y + (p.y * box.height) / 600, { button });
}

/** 레벨로 순간 이동 (디버그) — near 가까운 걷기 가능한 칸 */
async function teleport(page: Page, level: string, near?: { x: number; y: number }): Promise<void> {
  await page.evaluate(
    ([lv, n]) => {
      const g = window.__game!.game;
      const def = g.levelDef(lv as string)!;
      const at = (n as { x: number; y: number } | null) ?? def.portalSpot ?? { x: def.map.width / 2, y: def.map.height / 2 };
      const m = def.map;
      for (let r = 0; r < 400; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = Math.floor(at.x) + dx, y = Math.floor(at.y) + dy;
            if (m.walkable(x, y)) {
              g.changeLevel(lv as string, x + 0.5, y + 0.5);
              return;
            }
          }
    },
    [level, near ?? null] as const,
  );
  await page.waitForTimeout(300);
}

/** NPC 곁으로 옮긴 뒤 클릭 상자를 눌러 말 걸기 */
async function talkTo(page: Page, typeId: string): Promise<void> {
  await page.evaluate((id) => {
    const g = window.__game!.game;
    const n = g.npcs.find((x) => x.type.id === id)!;
    const m = g.map;
    for (let r = 4; r < 12; r++)
      for (let a = 0; a < 16; a++) {
        const x = Math.floor(n.x + Math.cos((a / 16) * Math.PI * 2) * r), y = Math.floor(n.y + Math.sin((a / 16) * Math.PI * 2) * r);
        if (m.walkable(x, y)) {
          g.changeLevel(g.levelId, x + 0.5, y + 0.5);
          return;
        }
      }
  }, typeId);
  const id = await page.evaluate((t) => window.__game!.game.npcs.find((x) => x.type.id === t)!.id, typeId);
  // NPC 는 돌아다니고 포털·웨이포인트와 겹칠 수 있어 대화가 열릴 때까지 위치를 다시 잡아 클릭
  for (let tries = 0; ; tries++) {
    await page.waitForFunction((nid) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'npc' && b.id === nid), id, { timeout: 15_000 });
    const p = await page.evaluate((nid) => {
      const b = window.__game!.input!.pickBoxes.find((x) => x.kind === 'npc' && x.id === nid)!;
      return { x: b.x + b.w / 2, y: b.y + b.h / 3 };
    }, id);
    await clickCanvas(page, p);
    const ok = await page
      .waitForFunction((t) => window.__game!.game.snapshot().interaction?.typeId === t, typeId, { timeout: 6_000 })
      .then(() => true, () => false);
    if (ok) break;
    if (tries >= 4) throw new Error(`${typeId} 와 대화 열기 실패`);
  }
  await page.waitForTimeout(300);
}

async function closeTalk(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game!.game.snapshot().interaction, undefined, { timeout: 5000 });
}

/** 오브젝트 조작 (걸어가서 여는 interact 명령) → 모드가 바뀔 때까지 */
async function operate(page: Page, level: string, classId: number): Promise<void> {
  const o = await page.evaluate(([lv, c]) => {
    const x = window.__game!.game.objectsOf(lv as string).find((o) => o.type.id === c)!;
    return { id: x.id, x: x.x, y: x.y, mode: x.mode };
  }, [level, classId] as const);
  await teleport(page, level, { x: o.x + 3, y: o.y + 3 });
  await page.evaluate((id) => window.__game!.game.enqueue({ type: 'interact', unitId: id }), o.id);
  await page.waitForFunction(([lv, id, m]) => window.__game!.game.objectsOf(lv as string).find((x) => x.id === id)!.mode !== m, [level, o.id, o.mode] as const, { timeout: 15_000 });
}

/** 디버그: 몬스터를 치운다 (방해 없이) */
async function clearMonsters(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.monsters.splice(0);
  });
}

test('Den of Evil: Akara 퀘스트 → 굴 몬스터 전부 처치 → Akara 보상 (스킬 포인트 +1)', async ({ page }) => {
  await newHero(page, uniqueName('Den'));
  await talkTo(page, 'akara');
  // 원작: Akara 의 Den of Evil 소개(A1Q1InitAkara)가 바로 재생되고, 메뉴에 퀘스트 이름 항목
  expect(await page.evaluate(() => window.__game!.ui!.talk.open)).toBe(true);
  const opts = await page.evaluate(() => window.__game!.game.snapshot().interaction!.options);
  // 소개(64)를 들은 뒤 목록을 다시 만들면 fState 2 → Akara 65 (A1Q1AfterInitAkara) 항목 (QUESTS_NPCActivateSpeeches)
  expect(opts).toEqual(['talk', 'quest:1:65', 'trade', 'cancel']);
  await page.screenshot({ path: 'test-results/quest-akara-intro.png' });
  await closeTalk(page);
  await teleport(page, 'denofevil');
  // 디버그 처치: 굴의 모든 몬스터 (원작 규칙대로 남은 수 메시지 → 완료)
  const msgs = await page.evaluate(() => {
    const g = window.__game!.game as unknown as { monsters: { mode: string; pet?: unknown }[]; killMonster(m: unknown, s: string): void; events: { type: string; count?: number }[] };
    const out: number[] = [];
    for (const m of [...g.monsters]) {
      if (m.mode === 'DT' || m.mode === 'DD' || m.pet) continue;
      g.events = [];
      g.killMonster(m, 'player');
      for (const e of g.events) if (e.type === 'questMessage') out.push(e.count ?? -1);
    }
    return out;
  });
  expect(msgs.slice(-5)).toEqual([5, 4, 3, 2, 1]);
  await page.waitForFunction(() => window.__game!.game.quests.status(1) === 5, undefined, { timeout: 10_000 });
  await teleport(page, 'town');
  const before = await page.evaluate(() => window.__game!.game.character!.skillPoints);
  await talkTo(page, 'akara');
  await page.waitForFunction((b) => window.__game!.game.character!.skillPoints === b + 1, before, { timeout: 5000 });
  expect(await page.evaluate(() => window.__game!.game.questRecord.get(1, 0))).toBe(true);
  await page.screenshot({ path: 'test-results/quest-den-reward.png' });
  await closeTalk(page);
  // 퀘스트 로그 (Q): Den of Evil 완료, Sisters' Burial Grounds 진행 대기
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.ui!.quest.open && window.__game!.ui!.quest.ready, undefined, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  const log = await page.evaluate(() => window.__game!.game.snapshot().quests.map((q) => `${q.quest}:${q.icon}`));
  expect(log[0]).toBe('1:done');
  await page.screenshot({ path: 'test-results/quest-log-den-done.png' });
});

test('Cairn Stones → 붉은 포털 → 트리스트럼 → Cain 구출 → 마을 Cain 무료 감정', async ({ page }) => {
  await newHero(page, uniqueName('Cain'));
  // 디버그: 해독된 Inifuss 두루마리(bkd) 를 넣는다 (나무·Akara 해독은 엔진 테스트에서 검증)
  await page.evaluate(() => {
    const g = window.__game!.game;
    const d = g.data!;
    const it = d.treasure.createItem(d.items.base('bkd')!, 1, g.rng, 2);
    it.identified = true;
    g.store.inv.autoAdd(it);
    g.gold = 3000;
  });
  await teleport(page, 'stonyfield');
  await clearMonsters(page);
  const order = await page.evaluate(() => window.__game!.game.quests.stoneOrder());
  for (const id of order) await operate(page, 'stonyfield', id);
  await page.waitForFunction(() => window.__game!.game.objectsOf('stonyfield').some((o) => o.portal?.toLevel === 'tristram'), undefined, { timeout: 10_000 });
  // 포털 앞에서 화면
  const portal = await page.evaluate(() => {
    const o = window.__game!.game.objectsOf('stonyfield').find((x) => x.portal?.toLevel === 'tristram')!;
    return { id: o.id, x: o.x, y: o.y };
  });
  await teleport(page, 'stonyfield', { x: portal.x + 2, y: portal.y + 3 });
  await clearMonsters(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/quest-cairn-portal.png' });
  // 포털 들어가기 (interact)
  await page.evaluate((id) => window.__game!.game.enqueue({ type: 'interact', unitId: id }), portal.id);
  await page.waitForFunction(() => window.__game!.game.levelId === 'tristram', undefined, { timeout: 15_000 });
  await clearMonsters(page);
  await operate(page, 'tristram', 26);
  await page.waitForFunction(() => window.__game!.game.npcs.some((n) => n.type.id === 'cain1'), undefined, { timeout: 10_000 });
  await clearMonsters(page);
  await talkTo(page, 'cain1');
  await page.screenshot({ path: 'test-results/quest-tristram-cain.png' });
  await closeTalk(page);
  await teleport(page, 'town');
  await page.waitForFunction(() => window.__game!.game.npcs.some((n) => n.type.id === 'cain5'), undefined, { timeout: 10_000 });
  // 미감정 매직 아이템 → Cain 무료 감정
  await page.evaluate(() => {
    const g = window.__game!.game;
    const d = g.data!;
    const it = d.treasure.createItem(d.items.base('cap')!, 5, g.rng, 4, true);
    it.identified = false;
    g.store.inv.autoAdd(it);
  });
  await talkTo(page, 'cain5');
  const gold = await page.evaluate(() => window.__game!.game.gold);
  const p = await page.evaluate(() => window.__game!.ui!.npcMenu.optionCenter('identify'));
  expect(p).not.toBeNull();
  await clickCanvas(page, p!);
  await page.waitForFunction(() => window.__game!.game.store.allItems().every((i) => i.identified), undefined, { timeout: 5000 });
  expect(await page.evaluate(() => window.__game!.game.gold)).toBe(gold);
  await page.screenshot({ path: 'test-results/quest-cain-town.png' });
});

test('퀘스트 로그 (Q): 원작 questbackground·a1q 아이콘 — 진행 중 / 시작 전', async ({ page }) => {
  await newHero(page, uniqueName('Log'));
  await talkTo(page, 'akara');
  await closeTalk(page);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.ui!.quest.open && window.__game!.ui!.quest.ready, undefined, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const log = await page.evaluate(() => window.__game!.game.snapshot().quests.map((q) => `${q.quest}:${q.icon}:${q.status}`));
  expect(log).toEqual(['1:active:1', '2:none:0', '4:none:0', '5:none:0', '3:none:0', '6:none:0']);
  await page.screenshot({ path: 'test-results/quest-log.png' });
  // 다시 Q = 닫기
  await page.keyboard.press('q');
  expect(await page.evaluate(() => window.__game!.ui!.quest.open)).toBe(false);
});
