import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chooseDifficulty, newHero, uniqueName } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 원작 Configure Controls 의 나머지 기능 (실제 키·마우스): Clear Screen (Space) · 이전/다음 스킬 (휠) · Skill 9~16 (확장팩만) · 휠 배정
// 출처: string.tbl CfgClearScreen·Cfgskillup·Cfgskilldown·KeyWheelUp/Down, expansionstring.tbl CfgSkill9~16

const FIRE_BOLT = 36, CHARGED_BOLT = 38, ICE_BOLT = 39;
const rightSkill = (page: Page) => page.evaluate(() => window.__game!.game.character!.rightSkill);

async function overWorld(page: Page): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.move(box.x + 400, box.y + 200);
}

async function openControls(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.click('#btn-options');
  await page.click('#btn-configure-controls');
}

async function closeControls(page: Page): Promise<void> {
  await page.click('#btn-controls-prev');
  await page.click('#btn-options-prev');
  await page.click('#btn-return');
}

test('Space (Clear Screen): 열린 창을 모두 닫고 게임 메뉴는 열지 않는다', async ({ page }) => {
  await newHero(page, uniqueName('Cs'), 'sorceress');
  await overWorld(page);
  await page.keyboard.press('i');
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => [window.__game!.ui!.inventory.open, window.__game!.ui!.charPanel.open])).toEqual([true, true]);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => [window.__game!.ui!.inventory.open, window.__game!.ui!.charPanel.open])).toEqual([false, false]);
  expect(await page.evaluate(() => window.__game!.ui!.gameMenu.menuOpen)).toBe(false);
  // 아무 창도 없을 때 Space 도 게임 메뉴를 열지 않는다
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__game!.ui!.gameMenu.menuOpen)).toBe(false);
});

test('마우스 휠: 단축키에 등록한 스킬을 차례로 바꿔 든다 (아래 = 다음, 위 = 이전, 끝에서 처음으로)', async ({ page }) => {
  await newHero(page, uniqueName('Wh'), 'sorceress');
  await page.evaluate(([a, b, c]) => {
    const g = window.__game!.game;
    for (const id of [a, b, c]) g.character!.skills[id!] = 1;
    g.enqueue({ type: 'setHotkey', slot: 0, hand: 'right', skill: a! });
    g.enqueue({ type: 'setHotkey', slot: 2, hand: 'right', skill: b! });
    g.enqueue({ type: 'setHotkey', slot: 5, hand: 'right', skill: c! });
  }, [FIRE_BOLT, CHARGED_BOLT, ICE_BOLT]);
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.hotkeys!.filter(Boolean).length)).toBe(3);
  await overWorld(page);
  // 지금 든 Attack 은 등록 안 됨 → 아래로 = 첫 칸
  await page.mouse.wheel(0, 100);
  await expect.poll(() => rightSkill(page)).toBe(FIRE_BOLT);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => rightSkill(page)).toBe(CHARGED_BOLT);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => rightSkill(page)).toBe(ICE_BOLT);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => rightSkill(page)).toBe(FIRE_BOLT);
  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => rightSkill(page)).toBe(ICE_BOLT);
});

test('확장팩: Configure Controls 에 Skill 16 까지 틀 안에, Skill 9 를 Z 로 등록·사용', async ({ page }) => {
  await newHero(page, uniqueName('Sk'), 'sorceress');
  await page.evaluate((id) => (window.__game!.game.character!.skills[id] = 1), FIRE_BOLT);
  await openControls(page);
  for (const id of ['#key-help', '#key-chat', '#key-clearscreen', '#key-skillup', '#key-skilldown', '#key-skill9', '#key-skill16', '#key-hireling']) {
    await expect(page.locator(id)).toBeVisible();
    const b = (await page.locator(id).boundingBox())!;
    expect(b.y + b.height, id).toBeLessThan(470);
  }
  await page.click('#key-skill9');
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await page.locator('#game').screenshot({ path: 'test-results/hotkeys-controls-lod.png' });
  await closeControls(page);
  // 오른쪽 스킬 목록에서 Fire Bolt 를 가리키고 Z → 9번 칸 (index 8)
  const box = (await page.locator('#game').boundingBox())!;
  const rs = await page.evaluate(() => window.__game!.ui!.hud.center('rskill'));
  await page.mouse.click(box.x + rs.x, box.y + rs.y);
  await expect.poll(() => page.evaluate((id) => window.__game!.ui!.hud.menuCenter(id), FIRE_BOLT)).not.toBeNull();
  const fb = (await page.evaluate((id) => window.__game!.ui!.hud.menuCenter(id), FIRE_BOLT))!;
  await page.mouse.move(box.x + fb.x, box.y + fb.y);
  await page.keyboard.press('z');
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.hotkeys![8])).toEqual({ skill: FIRE_BOLT, hand: 'right' });
  await page.keyboard.press('Escape');
  await overWorld(page);
  expect(await rightSkill(page)).toBe(0);
  await page.keyboard.press('z');
  await expect.poll(() => rightSkill(page)).toBe(FIRE_BOLT);
});

test('Configure Controls: Select Next Skill 에 휠 배정이 보이고, Shift+X 로 바꾸면 그 키로 동작', async ({ page }) => {
  await newHero(page, uniqueName('Wk'), 'sorceress');
  await page.evaluate(() => localStorage.removeItem('d2clone.keys'));
  await openControls(page);
  await page.click('#key-skilldown');
  // 기다리는 중 휠 위 → Mouse Wheel Up 으로 바뀐다
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__game!.ui!.gameMenu.waitingKey)).toBeNull();
  await page.click('#btn-controls-prev');
  await page.click('#btn-configure-controls');
  await page.click('#key-skilldown');
  await page.keyboard.press('Shift+X');
  await page.waitForTimeout(200);
  await page.locator('#game').screenshot({ path: 'test-results/hotkeys-controls-wheel.png' });
  await closeControls(page);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('d2clone.keys') ?? '{}').skilldown)).toBe('Shift+X');
  await page.evaluate((id) => {
    const g = window.__game!.game;
    g.character!.skills[id] = 1;
    g.enqueue({ type: 'setHotkey', slot: 0, hand: 'right', skill: id });
  }, FIRE_BOLT);
  await expect.poll(() => page.evaluate(() => !!window.__game!.game.character!.hotkeys![0])).toBe(true);
  await overWorld(page);
  await page.keyboard.press('Shift+X');
  await expect.poll(() => rightSkill(page)).toBe(FIRE_BOLT);
  await page.evaluate(() => localStorage.removeItem('d2clone.keys'));
});

test('클래식 설치: Configure Controls 에 Skill 9~16 이 없다', async ({ page }) => {
  await page.goto('/?edition=classic');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.click('#btn-sorceress');
  await page.fill('#hero-name', uniqueName('Cl'));
  await page.click('#btn-ok');
  await chooseDifficulty(page);
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await openControls(page);
  await expect(page.locator('#key-skill8')).toBeVisible();
  await expect(page.locator('#key-help')).toBeVisible();
  await expect(page.locator('#key-skill9')).toBeHidden();
  await expect(page.locator('#key-swap')).toBeHidden();
  await page.locator('#game').screenshot({ path: 'test-results/hotkeys-controls-classic.png' });
});

test('H (도움말): 원작 문구를 화면 위에 겹쳐 보이고, H·Esc 로 닫힌다 (Esc 는 게임 메뉴를 열지 않음)', async ({ page }) => {
  await newHero(page, uniqueName('Hp'), 'sorceress');
  await overWorld(page);
  const shot = async () => page.evaluate(async () => {
    const img = await window.__game!.capture!();
    let sum = 0;
    for (let i = 0; i < img.data.length; i += 16) sum += img.data[i]!;
    return sum;
  });
  await page.keyboard.press('h');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.help.open)).toBe(true);
  await page.waitForTimeout(300);
  await page.locator('#game').screenshot({ path: 'test-results/hotkeys-help.png' });
  await page.keyboard.press('h');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.help.open)).toBe(false);
  await page.keyboard.press('h');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.help.open)).toBe(false);
  expect(await page.evaluate(() => window.__game!.ui!.gameMenu.menuOpen)).toBe(false);
  expect(await shot()).toBeGreaterThan(0);
});

test('Enter (채팅): 쓴 글이 메시지에 이름과 함께 뜨고, 채팅 중 I 는 인벤토리를 열지 않으며, Esc 는 보내지 않고 닫는다', async ({ page }) => {
  const name = uniqueName('Ch');
  await newHero(page, name, 'sorceress');
  await overWorld(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#chat-input')).toBeFocused();
  await page.keyboard.type('hi there');
  expect(await page.evaluate(() => window.__game!.ui!.inventory.open)).toBe(false);
  await page.waitForTimeout(200);
  await page.locator('#game').screenshot({ path: 'test-results/hotkeys-chat-typing.png' });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.messages.visible(performance.now()).map((l) => l.text))).toContain(`${name}: hi there`);
  expect(await page.evaluate(() => window.__game!.ui!.chat.open)).toBe(false);
  await page.waitForTimeout(200);
  await page.locator('#game').screenshot({ path: 'test-results/hotkeys-chat-sent.png' });
  // Esc: 보내지 않고 닫는다, 게임 메뉴도 열지 않는다
  await page.keyboard.press('Enter');
  await page.keyboard.type('nope');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__game!.ui!.chat.open)).toBe(false);
  expect(await page.evaluate(() => window.__game!.ui!.messages.visible(performance.now()).some((l) => l.text.includes('nope')))).toBe(false);
  expect(await page.evaluate(() => window.__game!.ui!.gameMenu.menuOpen)).toBe(false);
});
