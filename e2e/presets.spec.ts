import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');

// 99레벨 프리셋 (src/presets, scripts/gen-presets.ts): 처음 열면 캐릭터 목록에 7개 (배포판 포함, 어쌔신·드루이드는 확장팩 서버에서만 보임), ?preset=<직업> 은 메뉴 없이 Hell Act 1 마을에서 바로 시작

test('?preset=sorceress: 메뉴 없이 Hell 마을, 레벨 99, 사양 장비, 퀘스트 보상을 다시 받지 않는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?preset=sorceress');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1 && window.__game!.game.npcs.length > 0, undefined, { timeout: 30_000 });
  const info = await page.evaluate(() => {
    const g = window.__game!.game;
    const c = g.character!;
    const d = g.snapshot().player as unknown as { life: number; maxLife: number; mana: number; maxMana: number };
    return { full: d.life >= d.maxLife && d.mana >= d.maxMana, level: c.level, cls: c.cls, difficulty: g.difficulty, inTown: g.inTown, slots: Object.keys(g.equipment).sort(), statPoints: c.statPoints, skillPoints: c.skillPoints };
  });
  expect(info).toMatchObject({ full: true, level: 99, cls: 'Sorceress', difficulty: 2, inTown: true, statPoints: 0, skillPoints: 0 });
  expect(info.slots).toEqual(['belt', 'feet', 'glov', 'head', 'lrin', 'neck', 'rarm', 'rrin', 'tors']);
  // 몇 초 게임을 돌려도 퀘스트 보상(스킬·스탯 포인트)이 다시 들어오지 않는다
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => [window.__game!.game.character!.statPoints, window.__game!.game.character!.skillPoints])).toEqual([0, 0]);
  await page.keyboard.press('c');
  await page.keyboard.press('i');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/preset-sorceress.png' });
  expect(errors).toEqual([]);
});

const CLASSIC_NAMES = ['Preset-Amazon', 'Preset-Sorc', 'Preset-Necro', 'Preset-Pala', 'Preset-Barb'];
const LOD_NAMES = ['Preset-Assa', 'Preset-Druid'];
const PRESET_NAMES = [...CLASSIC_NAMES, ...LOD_NAMES];

/** 목록에 보이는 프리셋: 확장팩 서버는 7개, 클래식 서버는 확장팩 캐릭터를 숨겨 5개 */
async function expectListed(page: Page): Promise<void> {
  const lod = (await page.evaluate(() => window.__edition)) === 'lod';
  for (const n of CLASSIC_NAMES) await expect(page.locator(`#hero-${n}`)).toHaveCount(1);
  for (const n of LOD_NAMES) await expect(page.locator(`#hero-${n}`)).toHaveCount(lod ? 1 : 0);
}

test('?preset=all: 캐릭터 목록에 프리셋 7개 (클래식 서버는 5개)', async ({ page }) => {
  await page.goto('/?preset=all');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await expectListed(page);
});

test('?preset 없이 들어가면 원래 메뉴, 캐릭터 목록에 프리셋 7개가 기본으로', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  expect(await page.evaluate(() => window.__game?.ready ?? false)).toBe(false);
  await page.click('#btn-single');
  await expectListed(page);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('d2clone.presets.v3'))) ?? '[]').sort()).toEqual([...PRESET_NAMES].sort());
});

test('지운 프리셋은 다시 열어도 생기지 않고, 새 캐릭터는 프리셋보다 위', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await page.click('#hero-Preset-Barb');
  await page.click('#btn-delete');
  await page.click('#btn-delete-yes');
  await expect(page.locator('#hero-Preset-Barb')).toHaveCount(0);
  // 새 캐릭터 저장 (savedAt 이 지금이라 목록 맨 위)
  await page.evaluate(async () => {
    const all = await new Promise<string[]>((resolve, reject) => {
      const req = indexedDB.open('diabloclone', 1);
      req.onsuccess = () => {
        const g = req.result.transaction('heroes', 'readonly').objectStore('heroes').getAll();
        g.onsuccess = () => resolve(g.result as string[]);
        g.onerror = () => reject(g.error);
      };
    });
    const s = JSON.parse(all[0]!) as { name: string; savedAt: number };
    s.name = 'Newbie';
    s.savedAt = Date.now();
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('diabloclone', 1);
      req.onsuccess = () => {
        const t = req.result.transaction('heroes', 'readwrite');
        t.objectStore('heroes').put(JSON.stringify(s), s.name);
        t.oncomplete = () => resolve();
      };
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await expect(page.locator('#hero-Preset-Sorc')).toHaveCount(1);
  await expect(page.locator('#hero-Preset-Barb')).toHaveCount(0);
  const ids = await page.locator('[id^="hero-"]:not(#hero-name)').evaluateAll((els) => els.map((e) => e.id));
  expect(ids[0]).toBe('hero-Newbie');
});

for (const [id, cls, slots] of [['amazon', 'Amazon', 10], ['necromancer', 'Necromancer', 10], ['paladin', 'Paladin', 10], ['barbarian', 'Barbarian', 9]] as const) {
  test(`?preset=${id}: 오류 없이 시작, 레벨 99, 장비 ${slots}칸, 가득 찬 생명`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/?preset=${id}`);
    await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
    await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1, undefined, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const g = window.__game!.game, c = g.character!, p = g.snapshot().player;
      return { cls: c.cls, level: c.level, difficulty: g.difficulty, slots: Object.keys(g.equipment).length, full: p.life >= p.maxLife, points: c.statPoints + c.skillPoints };
    });
    expect(info).toEqual({ cls, level: 99, difficulty: 2, slots, full: true, points: 0 });
    expect(errors).toEqual([]);
  });
}

// 확장팩 프리셋: 확장팩 서버에서 바로 시작 — Act 5 까지 끝낸 확장팩 캐릭터, 룬워드 장착
for (const [id, cls] of [['assassin', 'Assassin'], ['druid', 'Druid']] as const) {
  test(`?preset=${id}: 확장팩 캐릭터로 Hell 마을, 레벨 99, 장비 10칸, 룬워드 2개`, async ({ page }) => {
    test.skip(!existsSync('game-data/d2exp.mpq'), '원작 확장팩 game-data 필요');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
    test.skip((await page.evaluate(() => window.__edition)) !== 'lod', '확장팩 서버에서만');
    await page.goto(`/?preset=${id}`);
    await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
    await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1, undefined, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const g = window.__game!.game, c = g.character!, p = g.snapshot().player;
      const rw = Object.values(g.equipment).filter((it) => it?.runeword !== undefined).length;
      return { cls: c.cls, level: c.level, difficulty: g.difficulty, expansion: g.expansion, inTown: g.inTown, slots: Object.keys(g.equipment).length, runewords: rw, full: p.life >= p.maxLife, points: c.statPoints + c.skillPoints };
    });
    expect(info).toEqual({ cls, level: 99, difficulty: 2, expansion: true, inTown: true, slots: 10, runewords: 2, full: true, points: 0 });
    await page.keyboard.press('i');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/preset-${id}.png` });
    expect(errors).toEqual([]);
  });
}

test('옛 버전(v1) 프리셋이 들어 있던 브라우저: 새 버전을 열면 스킬 20·스탯 1000 으로 교체', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  // 옛 상태 만들기: v2 기록을 지우고 v1 기록만, Preset-Necro 를 옛 값(스탯 25·스킬 1)으로
  await page.evaluate(async () => {
    localStorage.removeItem('d2clone.presets.v3');
    localStorage.setItem('d2clone.presets.installed', JSON.stringify(['Preset-Amazon', 'Preset-Sorc', 'Preset-Necro', 'Preset-Pala', 'Preset-Barb']));
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('diabloclone', 1);
      req.onsuccess = () => resolve(req.result);
    });
    const text = await new Promise<string>((resolve) => {
      const g = db.transaction('heroes', 'readonly').objectStore('heroes').get('Preset-Necro');
      g.onsuccess = () => resolve(g.result as string);
    });
    const s = JSON.parse(text) as { character: { str: number; skills: Record<string, number> } };
    s.character.str = 25;
    for (const k of Object.keys(s.character.skills)) s.character.skills[k] = 1;
    await new Promise<void>((resolve) => {
      const t = db.transaction('heroes', 'readwrite');
      t.objectStore('heroes').put(JSON.stringify(s), 'Preset-Necro');
      t.oncomplete = () => resolve();
    });
  });
  await page.goto('/?preset=none');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  const ch = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('diabloclone', 1);
      req.onsuccess = () => resolve(req.result);
    });
    const text = await new Promise<string>((resolve) => {
      const g = db.transaction('heroes', 'readonly').objectStore('heroes').get('Preset-Necro');
      g.onsuccess = () => resolve(g.result as string);
    });
    return (JSON.parse(text) as { character: { str: number; ene: number; skills: Record<string, number> } }).character;
  });
  expect([ch.str, ch.ene]).toEqual([1000, 1000]);
  expect(Object.values(ch.skills).every((v) => v === 20)).toBe(true);
});
