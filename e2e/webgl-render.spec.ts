import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 월드는 아래 캔버스(#world)에 WebGL2 팔레트 텍스처로 그리고, UI 는 위 캔버스(#game)에 겹친다.

type GlStats = { pages: number; sprites: number; uploads: number; shiftUploads: number; drawCalls: number; lost: number; restored: number };
const stats = (page: Page) =>
  page.evaluate(async () => {
    const url = '/src/render/gl/glsink.ts';
    return { ...((await import(/* @vite-ignore */ url)) as { glStats: GlStats }).glStats };
  });

/** 합성 화면에서 어둡지 않은 픽셀 비율 (영역 지정 가능) */
const lit = (page: Page, y0 = 0, y1 = 600) =>
  page.evaluate(async ([a, b]) => {
    const img = await window.__game!.capture!();
    let n = 0, t = 0;
    for (let y = a!; y < b!; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        t++;
        if (img.data[i]! + img.data[i + 1]! + img.data[i + 2]! > 30) n++;
      }
    return n / t;
  }, [y0, y1]);

test('마을이 WebGL2 월드 캔버스에 그려지고 UI 가 위에 겹친다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Gl'));
  await page.waitForTimeout(800);
  const kinds = await page.evaluate(() => ({
    world: !!(document.getElementById('world') as HTMLCanvasElement).getContext('webgl2'),
    order: [...document.getElementById('stage')!.children].map((c) => c.id),
  }));
  expect(kinds.world).toBe(true);
  expect(kinds.order.indexOf('world')).toBeLessThan(kinds.order.indexOf('game'));
  expect(await lit(page, 0, 540)).toBeGreaterThan(0.3); // 월드
  expect(await lit(page, 560, 600)).toBeGreaterThan(0.2); // 조작판 (UI 캔버스)
  const s = await stats(page);
  expect(s.pages).toBeGreaterThanOrEqual(1);
  expect(s.drawCalls).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/webgl-town.png' });
  expect(errors).toEqual([]);
});

test('유니크 몬스터 색 바꿈은 셰이더 표로 그린다 (그림을 따로 만들지 않음)', async ({ page }) => {
  await newHero(page, uniqueName('GlU'));
  await walkToBloodMoor(page);
  const before = (await stats(page)).shiftUploads;
  await page.evaluate(() => {
    const g = window.__game!.game;
    const p = g.snapshot().player;
    const b = g.spawnBoss('fallenshaman1', p.x + 3, p.y + 2, false)!;
    for (const m of [b, ...g.minionsOf(b)]) m.nextThink = 1e9;
  });
  await expect.poll(async () => (await stats(page)).shiftUploads, { timeout: 10_000 }).toBeGreaterThan(before);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/webgl-unique.png' });
});

test('그래픽 컨텍스트를 잃었다 되찾으면 월드가 다시 그려진다', async ({ page }) => {
  await newHero(page, uniqueName('GlL'));
  await page.waitForTimeout(800);
  expect(await lit(page, 0, 540)).toBeGreaterThan(0.3);
  await page.evaluate(() => {
    const gl = (document.getElementById('world') as HTMLCanvasElement).getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 300);
  });
  await expect.poll(async () => (await stats(page)).restored, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => lit(page, 0, 540), { timeout: 5000 }).toBeGreaterThan(0.3);
  expect(await lit(page, 560, 600)).toBeGreaterThan(0.2);
});
