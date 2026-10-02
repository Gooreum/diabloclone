import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 조작판 벨트 오른쪽 (x 475~635): 원작 클래식엔 800 폭 조각이 없어 원작 조각으로 만든 돌 판. 검은 빈 칸이 없어야 한다.
test('조작판 벨트 오른쪽은 검은 칸 없는 돌 판', async ({ page }) => {
  await newHero(page, uniqueName('Plate'), 'sorceress');
  await page.waitForTimeout(800);
  const dark = await page.evaluate(async () => {
    const img = await window.__game!.capture!();
    let n = 0, all = 0;
    for (let y = 553; y < 593; y++)
      for (let x = 475; x < 635; x++) {
        const i = (y * img.width + x) * 4;
        if (img.data[i]! + img.data[i + 1]! + img.data[i + 2]! <= 15) n++;
        all++;
      }
    return n / all;
  });
  console.log('[plate] dark ratio', dark.toFixed(3));
  expect(dark).toBeLessThan(0.1);
  await page.screenshot({ path: 'test-results/hud-plate.png', clip: { x: 280, y: 490, width: 400, height: 110 } });
});

// 생명 구슬: 빈 부분은 보라가 아닌 반투명 회색 유리, 물약을 마시면 찰 곳까지 반투명 빨강
test('구슬 빈 부분은 회색 유리, 물약 회복 예정 구간이 보인다', async ({ page }) => {
  await newHero(page, uniqueName('Globe'), 'sorceress');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.character!.life = Math.round(g.snapshot().player.maxLife * 0.3);
  });
  await page.waitForTimeout(300);
  // 생명 구슬 왼쪽 위 80×80 (판본마다 배치가 달라 조작판에서 읽는다)
  const box = await page.evaluate(() => window.__game!.ui!.hud.L.lifeGlobe);
  const rows = async () => page.evaluate(async (b) => {
    const img = await window.__game!.capture!();
    // 구슬 가운데 세로줄 근처 (x 30~50) 각 행의 평균 색
    const out: number[][] = [];
    for (let y = 0; y < 80; y++) {
      let r = 0, g = 0, bl = 0;
      for (let x = 30; x < 50; x++) {
        const i = ((b.y + y) * img.width + b.x + x) * 4;
        r += img.data[i]!; g += img.data[i + 1]!; bl += img.data[i + 2]!;
      }
      out.push([r / 20, g / 20, bl / 20]);
    }
    return out;
  }, box);
  const before = await rows();
  // 빈 부분 (위쪽 10~40 행): 보라 아님 (빨강·파랑이 초록보다 크게 높지 않음), 완전 검정도 아님
  const empty = before.slice(10, 40);
  const purple = empty.filter(([r, g, b]) => r! - g! > 15 && b! - g! > 15).length;
  const black = empty.filter(([r, g, b]) => r! + g! + b! < 6).length;
  console.log('[globe] empty purple rows', purple, 'black rows', black, 'sample', empty[10]);
  expect(purple).toBeLessThan(3);
  expect(black).toBeLessThan(10);
  await page.screenshot({ path: 'test-results/hud-globes-empty.png', clip: { x: 0, y: 470, width: 800, height: 130 } });

  // 벨트 물약 마시기 → 지금 높이 바로 위 (생명 30% → 행 56 위) 가 빈 부분보다 붉어진다
  await page.keyboard.press('1');
  await expect.poll(() => page.evaluate(() => window.__game!.game.snapshot().player.lifePot)).toBeGreaterThan(0);
  const life = await page.evaluate(() => { const p = window.__game!.game.snapshot().player; return { f: p.life / p.maxLife, t: (p.life + p.lifePot) / p.maxLife }; });
  const after = await rows();
  const top = Math.round(80 * (1 - life.f)), predTop = Math.round(80 * (1 - Math.min(1, life.t)));
  console.log('[globe] life frac', life, 'rows', predTop, top);
  expect(top - predTop).toBeGreaterThan(3);
  const mid = Math.round((top + predTop) / 2);
  const [r1] = after[mid]!, [r0] = before[mid]!;
  console.log('[globe] preview row red', r0, '→', r1);
  expect(r1!).toBeGreaterThan(r0! + 20);
  await page.screenshot({ path: 'test-results/hud-globes-potion.png', clip: { x: 0, y: 470, width: 800, height: 130 } });
});
