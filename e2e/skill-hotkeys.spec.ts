import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 원작 스킬 단축키: 스킬 고르기 목록에서 아이콘을 가리키고 단축키 → 그 손에 등록, 목록 밖에서 누르면 그 스킬로.
// 키는 옵션 CONFIGURE CONTROLS 의 Skill 1~8 (기본 F1~F8) 에서 바꾼다 — F키 없는 키보드도 쓸 수 있게.

const FIRE_BOLT = 36;

async function hover(page: Page, p: { x: number; y: number }): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.move(box.x + p.x, box.y + p.y);
}
async function canvasAt(page: Page, p: { x: number; y: number }): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y);
}
const rightSkill = (page: Page) => page.evaluate(() => window.__game!.game.character!.rightSkill);
const hotkeys = (page: Page) => page.evaluate(() => window.__game!.game.character!.hotkeys);

test('Skill 1 을 Z 로 바꿔 등록·전환, 기본 F2 도 되고 F키로 새로고침되지 않는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newHero(page, uniqueName('Hk'), 'sorceress');
  await page.evaluate((id) => (window.__game!.game.character!.skills[id] = 1), FIRE_BOLT);

  // 옵션 → CONFIGURE CONTROLS: Skill 1 = Z (23개 항목이 모두 화면 안)
  await page.keyboard.press('Escape');
  await page.click('#btn-options');
  await page.click('#btn-configure-controls');
  await expect(page.locator('#key-skill8')).toBeVisible();
  for (const id of ['#key-char', '#key-clearmsg', '#key-skill1', '#key-skill8']) {
    const b = (await page.locator(id).boundingBox())!;
    expect(b.y + b.height).toBeLessThan(470);
  }
  await page.click('#key-skill1');
  await page.keyboard.press('z');
  await page.waitForTimeout(200);
  await page.locator('#game').screenshot({ path: 'test-results/skill-hotkeys-controls.png' });
  await page.click('#btn-controls-prev');
  await page.click('#btn-options-prev');
  await page.click('#btn-return');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('d2clone.keys') ?? '{}').skill1)).toBe('Z');

  // 오른쪽 스킬 목록 → Fire Bolt 가리키고 Z → 칸 0 에 등록, 아이콘에 Z
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.hud.center('rskill')));
  await expect.poll(() => page.evaluate((id) => window.__game!.ui!.hud.menuCenter(id), FIRE_BOLT)).not.toBeNull();
  const fb = (await page.evaluate((id) => window.__game!.ui!.hud.menuCenter(id), FIRE_BOLT))!;
  await hover(page, fb);
  await page.keyboard.press('z');
  await expect.poll(async () => (await hotkeys(page))?.[0]).toEqual({ skill: FIRE_BOLT, hand: 'right' });
  await page.mouse.move(400, 100);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/skill-hotkeys-menu.png', clip: { x: 480, y: 480, width: 200, height: 80 } });
  await page.keyboard.press('Escape');

  // 목록 닫고 오른쪽 = Attack 인 상태에서 Z → Fire Bolt
  expect(await rightSkill(page)).toBe(0);
  await page.mouse.move(400, 100);
  await page.keyboard.press('z');
  await expect.poll(() => rightSkill(page)).toBe(FIRE_BOLT);

  // 기본 F2: Attack 을 F2 에 등록 → F2 로 되돌린다. F키가 브라우저 동작(새로고침 등)을 하지 않는다
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.hud.center('rskill')));
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.hud.menuCenter(0))).not.toBeNull();
  await hover(page, (await page.evaluate(() => window.__game!.ui!.hud.menuCenter(0)))!);
  await page.keyboard.press('F2');
  await expect.poll(async () => (await hotkeys(page))?.[1]).toEqual({ skill: 0, hand: 'right' });
  await page.keyboard.press('Escape');
  await page.mouse.move(400, 100);
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 7));
  await page.keyboard.press('F2');
  await expect.poll(() => rightSkill(page)).toBe(0);
  await page.keyboard.press('F5');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(7);

  // Skill 1 을 Z 로 바꿔 F1 은 단축키가 없어도 브라우저 동작(도움말 등)을 막는다. F3(찾기)도. F12(개발자 도구)는 그대로
  await page.evaluate(() => {
    const w = window as unknown as { __keys: [string, boolean][] };
    w.__keys = [];
    addEventListener('keydown', (e) => w.__keys.push([e.key, e.defaultPrevented]));
  });
  for (const k of ['F1', 'F3', 'F12']) await page.keyboard.press(k);
  expect(await page.evaluate(() => (window as unknown as { __keys: [string, boolean][] }).__keys)).toEqual([['F1', true], ['F3', true], ['F12', false]]);

  // 맥: fn+F3 으로 바꾸면 fn 이 먼저 온다 — fn 은 무시하고 F3 을 배정
  await page.keyboard.press('Escape');
  await page.click('#btn-options');
  await page.click('#btn-configure-controls');
  await page.click('#key-skill2');
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'Fn' })));
  await page.waitForTimeout(100);
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'Fn' })));
  await page.keyboard.press('F3');
  await page.keyboard.press('Escape');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('d2clone.keys') ?? '{}') as Record<string, string>);
  expect(saved.skill2).toBe('F3');
  expect(Object.values(saved)).not.toContain('Fn');

  // 조합 단축키 (원작과 다름, 사용자 요청): Shift 누른 채 F4 → 'Shift+F4', Shift 누른 채 fn → 'Shift+Fn'
  await page.click('#btn-configure-controls');
  await page.click('#key-skill3');
  await page.keyboard.down('Shift');
  await page.keyboard.press('F4');
  await page.keyboard.up('Shift');
  await page.click('#key-skill4');
  await page.keyboard.down('Shift');
  await page.evaluate(() => {
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Fn', shiftKey: true }));
    dispatchEvent(new KeyboardEvent('keyup', { key: 'Fn', shiftKey: true }));
  });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  await page.locator('#game').screenshot({ path: 'test-results/combo-keys-controls.png' });
  await page.keyboard.press('Escape');
  const combo = await page.evaluate(() => JSON.parse(localStorage.getItem('d2clone.keys') ?? '{}') as Record<string, string>);
  expect([combo.skill3, combo.skill4]).toEqual(['Shift+F4', 'Shift+Fn']);
  // 메뉴 닫고 게임에서: Shift+F4 → Fire Bolt, Shift+Fn → Attack
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.gameMenu.menuOpen)).toBe(false);
  await page.evaluate((id) => {
    const hk = window.__game!.game.character!.hotkeys!;
    hk[2] = { skill: id, hand: 'right' };
    hk[3] = { skill: 0, hand: 'right' };
  }, FIRE_BOLT);
  await page.mouse.move(400, 100);
  await page.keyboard.down('Shift');
  await page.keyboard.press('F4');
  await page.keyboard.up('Shift');
  await expect.poll(() => rightSkill(page)).toBe(FIRE_BOLT);
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'Fn', shiftKey: true })));
  await expect.poll(() => rightSkill(page)).toBe(0);
  // 스킬 고르기 목록 아이콘 구석에 짧은 이름 (S+F4)
  await page.evaluate(() => (window.__game!.ui!.hud.skillMenu = 'right'));
  await page.waitForTimeout(300);
  await page.locator('#game').screenshot({ path: 'test-results/combo-keys-hud.png' });
  await page.evaluate(() => (window.__game!.ui!.hud.skillMenu = null));
  expect(errors).toEqual([]);
});
