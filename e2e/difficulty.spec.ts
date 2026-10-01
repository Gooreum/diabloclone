// 난이도 창·해금 (Phase 8 Step 2): 원작 클래식 — Nightmare 가 열린 캐릭터는 OK 뒤 난이도 창(PopUp_340x224), 열리지 않은 난이도는 못 누름.
// Nightmare 로 시작하면 Blood Moor 몬스터가 Nightmare 판 (클래식 레벨 25 + 1 = 26, 생명 표 레벨 36 의 절반).
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

test('Nightmare 해금 → 캐릭터 선택 → 난이도 창 → Nightmare Blood Moor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = uniqueName('Diff');
  await newHero(page, name);
  // 새 캐릭터는 Normal
  expect(await page.evaluate(() => window.__game!.game.difficulty)).toBe(0);
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true);

  // 디버그: 저장의 해금 필드를 Nightmare 로 (원작: Normal 디아블로 처치)
  await page.evaluate(async (n) => {
    const st = window.__heroStore!;
    const s = await st.load(n);
    if (!s) throw new Error('no save');
    s.difficultyUnlocked = 1;
    await st.save(s);
  }, name);

  await page.click('#btn-single');
  await page.click(`#hero-${name}`);
  await page.waitForTimeout(300);
  // 칭호: Normal 완료 바바리안 = Sir (캐릭터 선택 칸 이름 위)
  await page.screenshot({ path: 'test-results/diff-charselect.png' });
  await page.click('#btn-select-ok');
  expect(await page.evaluate(() => window.__menu!.difficultyOpen)).toBe(true);
  await expect(page.locator('#btn-diff-normal')).toBeEnabled();
  await expect(page.locator('#btn-diff-nightmare')).toBeEnabled();
  await expect(page.locator('#btn-diff-hell')).toBeDisabled();
  await expect(page.locator('#btn-create')).toBeHidden();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/diff-popup.png' });

  // 취소 → 캐릭터 선택으로, 다시 OK → 창
  await page.click('#btn-diff-cancel');
  expect(await page.evaluate(() => window.__menu!.difficultyOpen)).toBe(false);
  await expect(page.locator('#btn-create')).toBeVisible();
  await page.click('#btn-select-ok');
  expect(await page.evaluate(() => window.__menu!.difficultyOpen)).toBe(true);

  await page.click('#btn-diff-nightmare');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  expect(await page.evaluate(() => window.__game!.game.difficulty)).toBe(1);
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1 && window.__game!.game.npcs.length > 0, undefined, { timeout: 30_000 });
  // Nightmare 저항 페널티 (맨몸): 클래식 −20, 확장팩 캐릭터 (LoD 서버 기본) 는 DifficultyLevels ResistPenalty −40
  const expansion = await page.evaluate(() => window.__game!.game.expansion);
  expect(await page.evaluate(() => window.__game!.game.playerResist('fireresist'))).toBe(expansion ? -40 : -20);

  await walkToBloodMoor(page);
  await page.waitForTimeout(1000);
  const mons = await page.evaluate(() => window.__game!.game.monsters.filter((m) => !m.pet && !m.npc && m.levelKey === 'bloodmoor').map((m) => ({ id: m.type.id, level: m.stats.level, hp: m.stats.maxHp, flags: m.flags, tc: m.type.treasure[0] })));
  expect(mons.length).toBeGreaterThan(20);
  // 보통 몬스터 (수식어 없음): 레벨 클래식 26 (25 + Level) · 확장팩 36 (levels.txt MonLvl2Ex — 지역 레벨), 생명은 Normal 최대(좀비 12)보다 훨씬 크다, TC 는 (N)
  const plain = mons.filter((m) => m.flags === 0);
  expect(plain.length).toBeGreaterThan(10);
  for (const m of plain) {
    expect(m.level).toBe(expansion ? 36 : 26);
    expect(m.tc).toContain('(N)');
  }
  expect(plain.filter((m) => m.id === 'zombie1').every((m) => m.hp > 250)).toBe(true);
  // Nightmare Blood Moor 는 MonUMin(N) 4 — 챔피언·유니크가 있다
  expect(mons.some((m) => m.flags !== 0)).toBe(true);
  await page.locator('#game').screenshot({ path: 'test-results/diff-nightmare-bloodmoor.png' });

  // 저장: 마지막 난이도 = Nightmare, Nightmare 막 기록
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true);
  const saved = await page.evaluate((n) => window.__heroStore!.load(n), name);
  expect(saved?.difficulty).toBe(1);
  expect(saved?.actByDiff).toEqual([0, 0, 0]);
  expect(errors).toEqual([]);
});
