import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 브라우저가 탭을 숨기거나 그래픽 메모리를 회수해 캔버스 내용을 버리면, 한 번 만든 UI 그림(조작판·커서)이 사라진 채 남았다.
// 모든 그림을 지운 뒤 약 1초 안에 원본에서 다시 그려지는지 본다.
test('그림 내용이 사라지면 다시 그려져 조작판이 돌아온다', async ({ page }) => {
  await newHero(page, uniqueName('Heal'));
  const hudBright = () =>
    page.evaluate(() => {
      const c = document.querySelector('#game') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 540, 800, 60).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 16) s += d[i]! + d[i + 1]! + d[i + 2]!;
      return s;
    });
  await page.waitForTimeout(1000);
  const before = await hudBright();
  expect(before).toBeGreaterThan(0);
  await page.evaluate(async () => {
    // 앱과 같은 모듈 인스턴스 (vite dev 가 같은 URL 로 제공)
    const url = '/src/render/sprites.ts';
    const m = (await import(/* @vite-ignore */ url)) as { wipeAllForTest: () => void };
    if (typeof m.wipeAllForTest !== "function") throw new Error("keys: " + Object.keys(m).join(","));
    m.wipeAllForTest();
  });
  await expect.poll(hudBright, { timeout: 5000 }).toBeGreaterThan(before * 0.8);
});
