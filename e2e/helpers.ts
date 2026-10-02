import { expect, type Page } from '@playwright/test';

/** 메인메뉴 → Single Player → Create New Character → 클래스 고르기 → 이름 → OK → 게임 시작 (원작 프런트엔드 순서) */
/** classic: 확장팩 서버에서도 클래식 캐릭터로 (만들기 화면의 Expansion Character 체크를 끈다 — 기본은 켜짐) */
export async function newHero(page: Page, name: string, cls = 'barbarian', opts: { classic?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.click(`#btn-${cls}`);
  await page.fill('#hero-name', name);
  if (opts.classic && (await page.locator('#chk-expansion').isVisible())) await page.click('#chk-expansion');
  await page.click('#btn-ok');
  await chooseDifficulty(page);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await expect(page.locator('#menu')).toBeHidden();
  // 첫 게임 틱이 돌아 마을 NPC·몬스터가 놓일 때까지
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1 && window.__game!.game.npcs.length > 0, undefined, { timeout: 30_000 });
}

/** 마을의 Blood Moor 출구 안쪽 걷기 가능한 칸 근처로 옮긴 뒤 출구로 걸어가 Blood Moor 진입 (출구 판정은 엔진 규칙 그대로).
 *  마을 프리셋(TownN1/E1/S1/W1)은 원작처럼 Blood Moor 방향에 따라 바뀌므로 출구 위치는 레벨 정의에서 읽는다. */
export async function walkToBloodMoor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.changeLevel('town', g.snapshot().player.x, g.snapshot().player.y);
    const m = g.map;
    const e = g.exits.find((x) => x.to === 'bloodmoor')!;
    // 출구 사각형의 걷기 가능한 칸, 그 칸에서 레벨 안쪽으로 6 서브타일 떨어진 걷기 가능한 출발점
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const inward = { x: cx < 5 ? 1 : cx > m.width - 5 ? -1 : 0, y: cy < 5 ? 1 : cy > m.height - 5 ? -1 : 0 };
    for (let y = e.y; y < e.y + e.h; y++)
      for (let x = e.x; x < e.x + e.w; x++) {
        const sx = x + inward.x * 6, sy = y + inward.y * 6;
        if (!m.walkable(x, y) || !m.walkable(sx, sy)) continue;
        let ok = true;
        for (let k = 0; k <= 6; k++) if (!m.walkable(x + inward.x * k, y + inward.y * k)) ok = false;
        if (!ok) continue;
        g.changeLevel('town', sx + 0.5, sy + 0.5);
        g.enqueue({ type: 'move', x: x + 0.5, y: y + 0.5, run: true });
        return;
      }
  });
  await page.waitForFunction(() => window.__game!.game.levelId === 'bloodmoor', undefined, { timeout: 10_000 });
}

export const uniqueName = (prefix: string) => `${prefix}${Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6)}`;

/**
 * 난이도 창이 떠 있으면 고른다 (원작 클래식: Nightmare 가 열린 캐릭터만 창이 뜬다 — 아니면 바로 Normal). 기본 Normal.
 */
export async function chooseDifficulty(page: Page, diff: 'normal' | 'nightmare' | 'hell' = 'normal'): Promise<void> {
  const open = await page.evaluate(() => window.__menu?.difficultyOpen ?? false);
  if (open) await page.click(`#btn-diff-${diff}`);
}

/** 캐릭터 선택 화면에서 영웅 고르기 → OK (원작: 칸 클릭 = 선택, OK/두 번 클릭 = 시작) → 난이도 창이면 diff (기본 Normal) */
export async function loadHero(page: Page, name: string, diff: 'normal' | 'nightmare' | 'hell' = 'normal'): Promise<void> {
  await page.click('#btn-single');
  await page.click(`#hero-${name}`);
  await page.click('#btn-select-ok');
  await chooseDifficulty(page, diff);
}

/**
 * 레벨 from 의 to 로 가는 이동 타일에서 걸어서 8 칸 떨어진 곳으로 옮긴 뒤, 입구 그림(LvlWarp Select 상자 중앙)을 클릭하는 move 명령.
 * 걷기 거리는 출구 사각형의 걷기 가능한 칸에서 시작하는 BFS 로 잰다 (절벽 너머 같은 닿지 않는 곳을 고르지 않도록).
 */
export async function clickWarp(page: Page, from: string, to: string): Promise<void> {
  const ok = await page.evaluate(
    ([from, to]) => {
      const g = window.__game!.game;
      if (g.levelId !== from) g.changeLevel(from!, 1, 1);
      const m = g.map;
      const e = g.exits.find((x) => x.to === to && x.warp);
      if (!e?.warp) return false;
      const dist = new Map<number, number>();
      const q: number[] = [];
      for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) if (m.walkable(x, y)) { dist.set(y * m.width + x, 0); q.push(y * m.width + x); }
      let pick: number | null = null;
      while (q.length && pick === null) {
        const k = q.shift()!;
        const d = dist.get(k)!;
        const x = k % m.width, y = Math.floor(k / m.width);
        const inExit = x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h;
        if (d >= 8 && !inExit) { pick = k; break; }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx!, ny = y + dy!, nk = ny * m.width + nx;
          if (m.walkable(nx, ny) && !dist.has(nk)) { dist.set(nk, d + 1); q.push(nk); }
        }
      }
      if (pick === null) return false;
      g.changeLevel(from!, (pick % m.width) + 0.5, Math.floor(pick / m.width) + 0.5);
      // 클릭 = Select 상자 중앙의 화면 좌표 → 서브타일 (render/iso.ts screenToWorld)
      const w = e.warp;
      const px = w.selectX + w.selectDX / 2, py = w.selectY + w.selectDY / 2;
      g.enqueue({ type: 'move', x: w.x + py / 16 + px / 32, y: w.y + py / 16 - px / 32, run: true });
      return true;
    },
    [from, to],
  );
  expect(ok, `${from} → ${to} 이동 타일`).toBe(true);
  await page.waitForFunction((k) => window.__game!.game.levelId === k, to, { timeout: 20_000 });
  // 로딩 화면은 그 레벨 그림이 준비될 때까지(최대 4초) 떠 있다
  await page.waitForFunction(() => !window.__game!.ui!.loading.active(performance.now()), undefined, { timeout: 6000 });
}
