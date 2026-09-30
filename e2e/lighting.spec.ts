import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { clickWarp, newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 원작 조명: 실내(levels.txt IsInside) 던전은 빛 반경 밖이 어둡고, 마을·야외는 낮 밝기. 유닛 발밑에 그림자 (monstats2 Shadow).

const shadows = (page: Page) =>
  page.evaluate(async () => {
    const url = '/src/render/gl/glsink.ts';
    return ((await import(/* @vite-ignore */ url)) as { glStats: { shadows: number } }).glStats.shadows;
  });

/** 합성 화면 영역의 평균 밝기 (R+G+B) */
const lum = (page: Page, x0: number, y0: number, x1: number, y1: number) =>
  page.evaluate(async ([a, b, c, d]) => {
    const img = await window.__game!.capture!();
    let s = 0, n = 0;
    for (let y = b!; y < d!; y++)
      for (let x = a!; x < c!; x++) {
        const i = (y * img.width + x) * 4;
        s += img.data[i]! + img.data[i + 1]! + img.data[i + 2]!;
        n++;
      }
    return s / n;
  }, [x0, y0, x1, y1]);

/** 밝은 픽셀 비율 (조작판 위 월드 영역) */
const litRatio = (page: Page) =>
  page.evaluate(async () => {
    const img = await window.__game!.capture!();
    let n = 0;
    for (let i = 0; i < 800 * 540 * 4; i += 4) if (img.data[i]! + img.data[i + 1]! + img.data[i + 2]! > 30) n++;
    return n / (800 * 540);
  });

test('조명: 마을은 밝고 그림자가 있다, Den of Evil 안은 플레이어 둘레만 밝다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Lit'), 'sorceress');
  await page.waitForTimeout(1500);
  // 마을 (야외): 예전처럼 밝다
  expect(await litRatio(page)).toBeGreaterThan(0.3);
  // 그림자: 플레이어·NPC 그림자가 그려진다
  const s0 = await shadows(page);
  await page.waitForTimeout(500);
  expect(await shadows(page)).toBeGreaterThan(s0);
  await page.locator('#game').screenshot({ path: 'test-results/light-town.png' });
  // 플레이어 발밑 확대 (그림자 눈으로 확인용)
  await page.screenshot({ path: 'test-results/light-shadow.png', clip: { x: 330, y: 220, width: 140, height: 110 } });

  // Den of Evil (실내): 가운데(플레이어 둘레)가 네 귀퉁이보다 훨씬 밝다
  await clickWarp(page, 'bloodmoor', 'denofevil');
  await page.evaluate(() => {
    // 광원 몬스터가 섞이지 않게 몬스터를 치운다
    window.__game!.game.monsters.length = 0;
  });
  await page.waitForTimeout(1200);
  const center = await lum(page, 360, 230, 440, 310);
  const corners = [await lum(page, 0, 0, 80, 60), await lum(page, 720, 0, 800, 60), await lum(page, 0, 470, 80, 530), await lum(page, 720, 470, 800, 530)];
  const cornerAvg = corners.reduce((a, b) => a + b, 0) / 4;
  console.log('[light] center', Math.round(center), 'corners', corners.map(Math.round));
  expect(center).toBeGreaterThan(cornerAvg * 3);
  expect(center).toBeGreaterThan(60);
  await page.locator('#game').screenshot({ path: 'test-results/light-denofevil.png' });
  expect(errors).toEqual([]);
});
