import { expect, test, type Page } from '@playwright/test';
import { newHero, uniqueName } from './helpers';

test.setTimeout(300_000);

// 한국어 패치: 타이틀 언어 단추 → 다시 시작 → 원작 kor 문자열 (d2exp kor\string.tbl) 과 한글 글자 그리기.
// 한국어 표는 확장팩 MPQ 에만 있어 클래식 서버 (D2_EDITION=classic) 에는 단추가 없다.

async function title(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
}

test('언어 단추: 한국어로 바꾸면 원작 한국어 문자열과 한글이 그려지고, 다시 누르면 영어', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await title(page);
  test.skip((await page.evaluate(() => window.__edition)) !== 'lod', '확장팩 서버에서만');
  expect(await page.evaluate(() => window.__lang)).toBe('eng');
  await page.click('#btn-language');
  await page.waitForFunction(() => window.__menuReady === true && window.__lang === 'kor', undefined, { timeout: 90_000 });
  await page.waitForFunction(() => window.__menuArtReady?.() === true, undefined, { timeout: 30_000 });
  await page.locator('#game').screenshot({ path: 'test-results/korean-title.png' });
  expect(await page.evaluate(() => window.__str!('ssd'))).toBe('숏소드');
  expect(await page.evaluate(() => window.__d2text!.width('숏소드', 'font16'))).toBeGreaterThan(0);

  // 게임 속: 원작 한국어 문자열을 메시지로 띄워 그려지는지 (스크린샷으로 확인)
  await newHero(page, uniqueName('Kor'));
  expect(await page.evaluate(() => window.__lang)).toBe('kor');
  await page.evaluate(() => window.__game!.ui!.messages.push(window.__str!('Killdiablo1') + ' ' + window.__str!('ssd'), performance.now()));
  await page.waitForTimeout(600);
  await page.locator('#game').screenshot({ path: 'test-results/korean-game.png' });
  // NPC 대사 (원작 한국어 긴 문장 — 줄바꿈)
  await page.evaluate(() => {
    const g = window.__game!.game;
    const n = g.npcs.find((x) => x.type.id === 'akara') ?? g.npcs[0]!;
    g.changeLevel(g.levelId, n.x + 2.5, n.y + 1.5);
    g.enqueue({ type: 'interact', unitId: n.id });
  });
  await page.waitForFunction(() => !!window.__game!.game.snapshot().interaction, undefined, { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.locator('#game').screenshot({ path: 'test-results/korean-npc.png' });

  await title(page);
  expect(await page.evaluate(() => window.__lang)).toBe('kor');
  await page.click('#btn-language');
  await page.waitForFunction(() => window.__menuReady === true && window.__lang === 'eng', undefined, { timeout: 90_000 });
  expect(await page.evaluate(() => window.__str!('ssd'))).toBe('Short Sword');
  expect(errors).toEqual([]);
});

test('클래식 서버: 한국어 표가 없어 언어 단추가 없다', async ({ page }) => {
  await title(page);
  test.skip((await page.evaluate(() => window.__edition)) !== 'classic', '클래식 서버 (D2_EDITION=classic) 에서만');
  await expect(page.locator('#btn-language')).toHaveCount(0);
  expect(await page.evaluate(() => window.__lang)).toBe('eng');
});
