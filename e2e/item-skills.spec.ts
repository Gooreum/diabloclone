import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 아이템 +스킬: 소서리스 프리셋 (SoJ 2 · Tarnhelm · Eye of Etlich 모든 스킬 +4, Iron Jang Bong 소서리스 +2) → Blizzard 20 이 26.
// 스킬 트리 툴팁 "Current Skill Level" 은 유효 레벨, 아이콘 숫자는 원작처럼 하드 포인트. 개별 스킬로만 얻은 스킬도 스킬 목록에 나온다.

const BLIZZARD = 59, BLAZE = 46;

async function canvasAt(page: Page, p: { x: number; y: number }): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

test('소서리스 프리셋: Blizzard 툴팁 26, 하드 0 Blaze 도 오른쪽 스킬 목록에', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?preset=sorceress');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1, undefined, { timeout: 30_000 });
  expect(await page.evaluate((id) => window.__game!.game.effectiveSkillLevel(id), BLIZZARD)).toBe(26);

  // 스킬 트리 → Blizzard 탭 → 아이콘 가리키기
  await page.keyboard.press('t');
  const pageNo = await page.evaluate((id) => window.__game!.game.data!.skills!.byId.get(id)!.page, BLIZZARD);
  await page.click(`#skilltab-${pageNo}`);
  const icon = (await page.locator(`#skill-${BLIZZARD}`).boundingBox())!;
  await page.mouse.move(icon.x + 24, icon.y + 24);
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.skillTree.lastTip)).toContain('Current Skill Level: 26');
  await page.screenshot({ path: 'test-results/item-skills-tooltip.png' });
  await page.keyboard.press('t');

  // Blaze 하드 포인트를 0 으로 → Jang Bong 개별 +2 로 쓸 수 있어 오른쪽 목록에 있다
  await page.evaluate((id) => (window.__game!.game.character!.skills[id] = 0), BLAZE);
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.hud.center('rskill')));
  await expect.poll(() => page.evaluate((id) => window.__game!.ui!.hud.menuCenter(id), BLAZE)).not.toBeNull();
  expect(await page.evaluate((id) => window.__game!.ui!.hud.menuCenter(id), BLIZZARD)).not.toBeNull();
  expect(errors).toEqual([]);
});
