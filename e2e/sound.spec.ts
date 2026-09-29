import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2sfx.mpq') || !existsSync('game-data/d2music.mpq'), '원작 사운드 MPQ 필요');
test.setTimeout(240_000);

type Log = { channel: string; name: string; path: string; state: string }[];
const audioLog = () => (window.__audio?.log ?? []) as unknown as Log;

test('클릭 후 마을 음악(town1.wav)이 반복 재생되고, 물약을 마시면 원작 물약 소리가 난다', async ({ page }) => {
  // 메뉴 단추 클릭 = 사용자 입력 → AudioContext 잠금 해제
  await newHero(page, uniqueName('Snd'));
  await page.mouse.click(400, 300);
  await page.waitForFunction(() => window.__audio?.unlocked === true, undefined, { timeout: 30_000 });

  // 로그 야영지 음악: levels.txt SoundEnv 1 → SoundEnviron Song 4673 → music\Act1\town1.wav (d2music.mpq, huffman+ADPCM 스테레오 해제)
  await page.waitForFunction(
    () => (window.__audio?.log ?? []).some((e) => e.channel === 'music' && e.name === 'music_town_1' && e.state === 'playing'),
    undefined,
    { timeout: 90_000 },
  );
  // 메뉴 음악(music_options)이 먼저 기록되므로 마을 음악 항목을 고른다
  const music = await page.evaluate(() => (window.__audio?.log ?? []).find((e) => e.channel === 'music' && e.name === 'music_town_1' && e.state === 'playing'));
  expect(music?.path.toLowerCase()).toBe('data\\global\\music\\act1\\town1.wav');
  // 배경음 (SoundEnviron Day Ambience)
  const amb = await page.evaluate(audioLog);
  expect(amb.some((e) => e.channel === 'ambient' && e.name === 'scene_wilderness_day')).toBe(true);

  // 물약 마시기 → misc.txt usesound item_potion_drink → sfx\item\potiondrink.wav
  const used = await page.evaluate(() => {
    const g = window.__game!.game;
    const st = g.store;
    const pot = [...st.belt, ...st.inv.items.map((p) => p.item)].find((it) => it && /^(hp|mp|rv)/.test(it.code));
    if (!pot) return null;
    g.enqueue({ type: 'useItem', itemId: pot.id });
    return pot.code;
  });
  expect(used).not.toBeNull();
  await page.waitForFunction(
    () => (window.__audio?.log ?? []).some((e) => e.name === 'item_potion_drink' && e.state === 'playing'),
    undefined,
    { timeout: 20_000 },
  );
  const drink = await page.evaluate(() => (window.__audio?.log ?? []).find((e) => e.name === 'item_potion_drink'));
  expect(drink?.path.toLowerCase()).toBe('data\\global\\sfx\\item\\potiondrink.wav');

  // 음량 설정은 localStorage 에 남는다
  await page.evaluate(() => window.__audio!.setVolume('music', 0.25));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('d2clone.audio') ?? '{}') as { music?: number });
  expect(saved.music).toBe(0.25);
});

test('레벨이 바뀌면 음악이 바뀐다 (Blood Moor = wild.wav)', async ({ page }) => {
  await newHero(page, uniqueName('Snd'));
  await page.mouse.click(400, 300);
  await page.waitForFunction(() => (window.__audio?.log ?? []).some((e) => e.name === 'music_town_1' && e.state === 'playing'), undefined, { timeout: 90_000 });
  await walkToBloodMoor(page);
  await page.waitForFunction(
    () => (window.__audio?.log ?? []).some((e) => e.channel === 'music' && e.name === 'music_wilderness' && e.state === 'playing'),
    undefined,
    { timeout: 90_000 },
  );
  const log = await page.evaluate(audioLog);
  expect(log.some((e) => e.channel === 'music' && e.name === 'music_town_1' && e.state === 'stopped')).toBe(true);
});
