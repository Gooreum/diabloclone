import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);

test('수직 슬라이스: 생성 → 캠프 → Blood Moor → 처치 → 줍기 → Save and Exit → 새로고침 → 불러오기 복원', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('Slice');
  await newHero(page, name);
  const startInv = await page.evaluate(() => window.__game!.game.snapshot().inventory.length);
  await walkToBloodMoor(page);

  // 가장 가까운 몬스터들을 공격해 경험치를 얻고 드롭이 생길 때까지 반복 (원작 규칙으로 판정)
  await page.waitForFunction(
    () => {
      const g = window.__game!.game;
      const s = g.snapshot();
      if (s.player.life < s.player.maxLife * 0.4) g.character!.life = g.character!.maxLife; // 테스트 진행용 회복
      const alive = s.monsters.filter((m) => m.mode !== 'DT' && m.mode !== 'DD');
      alive.sort((a, b) => Math.hypot(a.x - s.player.x, a.y - s.player.y) - Math.hypot(b.x - s.player.x, b.y - s.player.y));
      const t = alive[0];
      if (t && s.player.mode !== 'A1') {
        if (Math.hypot(t.x - s.player.x, t.y - s.player.y) > 12) {
          // 원작 DRLG 지형(나무·강)이 있으므로 대상 옆의 걷기 가능한 칸으로 순간이동
          const m = g.map;
          let p = { x: t.x, y: t.y };
          for (let r = 2; r <= 5 && p.x === t.x; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) if (m.walkable(Math.floor(t.x + dx), Math.floor(t.y + dy))) { p = { x: t.x + dx, y: t.y + dy }; break; }
          g.changeLevel(g.levelId, p.x, p.y);
        }
        g.enqueue({ type: 'attack', targetId: t.id, standStill: false });
      }
      return s.player.experience > 0 && s.items.length > 0;
    },
    undefined,
    { timeout: 180_000, polling: 300 },
  );
  // 드롭 줍기
  await page.waitForFunction(
    (inv0) => {
      const g = window.__game!.game;
      const s = g.snapshot();
      const it = s.items[0];
      if (it && s.player.mode !== 'A1') {
        if (Math.hypot(it.x - s.player.x, it.y - s.player.y) > 10) g.changeLevel(g.levelId, it.x, it.y); // 드롭 위치는 걷기 가능한 칸
        g.enqueue({ type: 'pickup', itemId: it.id });
      }
      return s.player.gold > 0 || s.inventory.length > inv0; // 골드 획득 또는 시작 인벤토리보다 아이템 증가
    },
    startInv,
    { timeout: 60_000, polling: 300 },
  );
  const before = await page.evaluate(() => {
    const s = window.__game!.game.snapshot();
    return { level: s.player.level, exp: s.player.experience, gold: s.player.gold, inv: s.inventory.map((i) => i.code).sort() };
  });
  await page.locator('#game').screenshot({ path: 'test-results/slice-before-save.png' });

  // ESC → Save and Exit Game
  await page.keyboard.press('Escape');
  await page.click('#btn-save-exit');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 30_000 });

  // 새로고침 → Single Player → 캐릭터 선택 → 불러오기
  await page.reload();
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await page.click(`#hero-${name}`);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 60_000 });
  const after = await page.evaluate(() => {
    const g = window.__game!.game;
    const s = g.snapshot();
    return { level: s.player.level, exp: s.player.experience, gold: s.player.gold, inv: s.inventory.map((i) => i.code).sort(), levelId: g.levelId };
  });
  expect(after.levelId).toBe('town');
  expect({ ...after, levelId: undefined }).toEqual({ ...before, levelId: undefined });
  expect(errors).toEqual([]);
});
