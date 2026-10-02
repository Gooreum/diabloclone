import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 지금 쓸 수 없는 스킬은 스킬 버튼이 빨갛다 (원작 SKILLS_GetUseState): 프리셋 소서리스 마나 0 → Blizzard 버튼 붉게, 마나를 채우면 원래대로
test('마나가 모자라면 오른쪽 스킬 버튼이 빨갛고, 채우면 돌아온다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?preset=sorceress');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1, undefined, { timeout: 30_000 });
  // 마을에선 쓸 수 없는 스킬 판정과 무관 (마을 제한은 원작 GetUseState 에 없음) — 그대로 마을에서 본다
  const box = await page.evaluate(() => (window.__game!.ui!.hud as unknown as { L: { rskill: { x: number; y: number } } }).L.rskill);
  /** 버튼 48×48 평균 색 (월드 + UI 합성) */
  const avg = () => page.evaluate(async (b) => {
    const img = await window.__game!.capture!();
    let r = 0, g = 0, bl = 0, n = 0;
    for (let y = b.y + 4; y < b.y + 44; y++) for (let x = b.x + 4; x < b.x + 44; x++) {
      const i = (y * img.width + x) * 4;
      r += img.data[i]!; g += img.data[i + 1]!; bl += img.data[i + 2]!; n++;
    }
    return { r: r / n, g: g / n, b: bl / n };
  }, box);
  await page.waitForTimeout(800);
  const normal = await avg();
  const keep = setInterval(() => void page.evaluate(() => { window.__game!.game.character!.mana = 0; }).catch(() => undefined), 50);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__game!.game.skillUseState(window.__game!.game.character!.rightSkill))).toBe('mana');
  const red = await avg();
  clearInterval(keep);
  await page.screenshot({ path: 'test-results/skill-unusable-red.png' });
  // 붉게: 초록·파랑이 크게 줄고 빨강이 그보다 크다
  expect(red.r).toBeGreaterThan(red.g * 1.5);
  expect(red.g).toBeLessThan(normal.g * 0.6);
  await page.evaluate(() => { const c = window.__game!.game.character!; c.mana = c.maxMana; });
  await page.waitForTimeout(600);
  const back = await avg();
  expect(Math.abs(back.g - normal.g)).toBeLessThan(10);
  expect(errors).toEqual([]);
});
