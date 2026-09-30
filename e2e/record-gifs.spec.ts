import { test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import { clickWarp, newHero, uniqueName, walkToBloodMoor } from './helpers';

// README 용 플레이 GIF 녹화 (docs/media/*.gif). 평소 e2e 에서는 건너뛴다: RECORD_GIF=1 npx playwright test e2e/record-gifs.spec.ts
test.skip(!process.env.RECORD_GIF || !existsSync('game-data/d2data.mpq'), 'RECORD_GIF=1 과 원작 game-data 필요');
test.setTimeout(300_000);
// 실제 그래픽카드로 그린다 (기본 헤드리스는 소프트웨어 GL 이라 느리다)
test.use({ launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } });

// gifenc 는 CommonJS — 기본 내보내기에서 꺼낸다
const { GIFEncoder, applyPalette, quantize } = gifenc;
const W = 480, H = 360, FPS = 12;

/** 합성 화면(WebGL 월드 + UI) 한 장을 W×H 로 줄여 RGBA 로 */
async function grab(page: Page): Promise<Uint8Array> {
  const b64 = await page.evaluate(async ([w, h]) => {
    const img = await window.__game!.capture!();
    const src = document.createElement('canvas');
    src.width = img.width;
    src.height = img.height;
    src.getContext('2d')!.putImageData(img, 0, 0);
    const dst = document.createElement('canvas');
    dst.width = w!;
    dst.height = h!;
    const c = dst.getContext('2d')!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, w!, h!);
    const d = c.getImageData(0, 0, w!, h!).data;
    let s = '';
    for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return btoa(s);
  }, [W, H]);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** seconds 동안 녹화 (act 는 녹화와 동시에 진행할 조작) → docs/media/<name>.gif */
async function record(page: Page, name: string, seconds: number, act?: () => Promise<void>): Promise<void> {
  const frames: { rgba: Uint8Array; at: number }[] = [];
  const stop = Date.now() + seconds * 1000;
  const acting = act?.();
  while (Date.now() < stop) {
    frames.push({ rgba: await grab(page), at: Date.now() });
    await page.waitForTimeout(Math.max(0, 1000 / FPS - 40));
  }
  await acting;
  const gif = GIFEncoder();
  frames.forEach((f, i) => {
    const palette = quantize(f.rgba, 256);
    const index = applyPalette(f.rgba, palette);
    const next = frames[i + 1];
    gif.writeFrame(index, W, H, { palette, delay: next ? next.at - f.at : 1000 / FPS });
  });
  gif.finish();
  mkdirSync('docs/media', { recursive: true });
  writeFileSync(`docs/media/${name}.gif`, gif.bytes());
}

/** 엔진에 이동 명령 (플레이어 기준 상대 위치, 달리기) */
const moveBy = (page: Page, dx: number, dy: number) =>
  page.evaluate(([dx, dy]) => {
    const g = window.__game!.game;
    const p = g.snapshot().player;
    g.enqueue({ type: 'move', x: p.x + dx!, y: p.y + dy!, run: true });
  }, [dx, dy]);

test('town.gif — 로그 야영지', async ({ page }) => {
  await newHero(page, uniqueName('Town'), 'amazon');
  await page.waitForTimeout(1500);
  await record(page, 'town', 7, async () => {
    for (const [dx, dy] of [[8, 0], [0, 8], [-8, 2], [-2, -8]] as const) {
      await moveBy(page, dx, dy);
      await page.waitForTimeout(1700);
    }
  });
});

test('combat.gif — Blood Moor 바바리안 Whirlwind 전투', async ({ page }) => {
  // (미사일 가산 혼합은 Act 2~4 브랜치에서 합쳐질 예정 — 지금은 근접 스킬로 녹화)
  await newHero(page, uniqueName('Barb'), 'barbarian');
  await walkToBloodMoor(page);
  await page.evaluate(() => {
    const g = window.__game!.game;
    const ch = g.character!;
    ch.level = 30;
    ch.life = ch.maxLife = 1e5;
    ch.mana = ch.maxMana = 1e5;
    const db = g.data!.skills!;
    ch.skills[db.byNameOf('Whirlwind')!.id] = 20;
    const p = g.snapshot().player;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, r = 4 + (i % 3) * 2;
      const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      if (g.map.walkable(Math.floor(x), Math.floor(y))) g.spawnMonster(['zombie1', 'fallen1', 'quillrat1'][i % 3]!, x, y);
    }
  });
  await page.waitForTimeout(1500);
  await record(page, 'combat', 8, async () => {
    for (let k = 0; k < 8; k++) {
      await page.evaluate((k) => {
        const g = window.__game!.game;
        const db = g.data!.skills!;
        const p = g.snapshot().player;
        g.character!.mana = g.character!.maxMana;
        const a = k * 2.3;
        g.enqueue({ type: 'useSkill', skill: db.byNameOf('Whirlwind')!.id, hand: 'right', x: p.x + Math.cos(a) * 7, y: p.y + Math.sin(a) * 7 });
      }, k);
      await page.waitForTimeout(1000);
    }
  });
});

test('dungeon.gif — Den of Evil', async ({ page }) => {
  await newHero(page, uniqueName('Barb'), 'barbarian');
  await page.evaluate(() => {
    const ch = window.__game!.game.character!;
    ch.level = 20;
    ch.life = ch.maxLife = 1e5;
  });
  await clickWarp(page, 'bloodmoor', 'denofevil');
  await page.waitForTimeout(800);
  await record(page, 'dungeon', 8, async () => {
    for (let k = 0; k < 8; k++) {
      await page.evaluate(() => {
        const g = window.__game!.game;
        const p = g.snapshot().player;
        const t = g.monsters.filter((m) => !m.npc && m.hp > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (t) g.enqueue({ type: 'attack', targetId: t.id, standStill: false });
      });
      await page.waitForTimeout(1000);
    }
  });
});

test('ui.gif — 인벤토리·스킬 트리·캐릭터 창·자동지도', async ({ page }) => {
  await newHero(page, uniqueName('Pala'), 'paladin');
  await page.waitForTimeout(1500);
  await record(page, 'ui', 8, async () => {
    for (const k of ['i', 't', 'c', 'Tab']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(1600);
      await page.keyboard.press(k === 'Tab' ? 'Tab' : k);
      await page.waitForTimeout(250);
    }
  });
});
