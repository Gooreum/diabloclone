import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { uniqueName } from './helpers';

// Phase 11 Step 1 (UI): 원작 DC6 UI 패널·원작 글꼴 — 화면마다 test-results/ui-*.png 를 남긴다 (사람이 원작 1.14d 클래식과 비교)
test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(300_000);

async function canvasAt(page: Page, p: { x: number; y: number }, button: 'left' | 'right' = 'left'): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.click(box.x + p.x, box.y + p.y, { button });
}
async function hover(page: Page, p: { x: number; y: number }): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.move(box.x + p.x, box.y + p.y);
}
// UI_SHOTS 로 저장 폴더를 바꿀 수 있다 (기본 test-results)
const SHOTS = process.env.UI_SHOTS ?? 'test-results';
const shot = (page: Page, name: string) => page.locator('#game').screenshot({ path: `${SHOTS}/ui-${name}.png` });

/** 그림 파일을 다 읽을 때까지 */
async function artReady(page: Page, paths: string[]): Promise<void> {
  await page.waitForFunction((ps) => ps.every((p) => !!window.__game!.ui!.art.frames(p)), paths, { timeout: 30_000 });
}

test('원작 프런트엔드: 타이틀 → 캐릭터 선택 → 캐릭터 만들기', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => window.__menuArtReady?.() === true, undefined, { timeout: 60_000 });
  await page.waitForTimeout(800);
  await shot(page, 'mainmenu');
  await page.click('#btn-single');
  // 메뉴 음악 (sounds.txt music_options → music\common\options.wav) — 클릭으로 오디오 잠금이 풀린 뒤 재생
  if (existsSync('game-data/d2music.mpq')) {
    await page.waitForFunction(() => (window.__audio?.log ?? []).some((e) => e.name === 'music_options' && e.state === 'playing'), undefined, { timeout: 60_000 });
    const m = await page.evaluate(() => (window.__audio?.log ?? []).find((e) => e.name === 'music_options' && e.state === 'playing')!.path.toLowerCase());
    expect(m).toBe('data\\global\\music\\common\\options.wav');
  }
  await page.waitForTimeout(400);
  await shot(page, 'charselect');
  await page.click('#btn-create');
  await page.waitForTimeout(600);
  await page.click('#btn-sorceress');
  // 앞으로 걸어 나오는 애니메이션 (원작 SOFW) 이 끝날 때까지
  await page.waitForTimeout(2600);
  await page.fill('#hero-name', 'Tyrael');
  await page.waitForTimeout(200);
  await shot(page, 'charcreate');
  await page.click('#btn-ok');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await expect(page.locator('#menu')).toBeHidden();
  // 저장하고 나가면 캐릭터 선택 목록에 나온다 → 골라서 OK
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true);
  await page.click('#btn-single');
  await expect(page.locator('#hero-Tyrael')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, 'charselect-hero');
  await page.click('#hero-Tyrael');
  await page.click('#btn-select-ok');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  expect(await page.evaluate(() => window.__game!.game.character!.cls)).toBe('Sorceress');
});

test('원작 HUD·캐릭터·인벤토리·스킬 트리·보관함·NPC·게임 메뉴', async ({ page }) => {
  // 새 영웅 (바바리안)
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.click('#btn-barbarian');
  await page.fill('#hero-name', uniqueName('Ui'));
  await page.click('#btn-ok');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.monsters.splice(0);
    const ch = g.character!;
    ch.statPoints = 5;
    ch.skillPoints = 2;
    ch.experience = 300;
    ch.life = Math.floor(ch.maxLife * 0.6);
    ch.mana = Math.floor(ch.maxMana * 0.35);
    ch.stamina = Math.floor(ch.maxStamina * 0.7);
  });
  const P = 'data\\global\\ui\\PANEL\\';
  await artReady(page, [`${P}ctrlpnl7.dc6`, `${P}hlthmana.dc6`, `${P}overlap.dc6`, `${P}level.dc6`, `${P}runbutton.dc6`, `${P}menubutton.dc6`, 'data\\global\\ui\\SPELLS\\Skillicon.dc6']);

  // HUD: 미니 패널 열기 + 생명 구체 위 마우스 → "Life: n / m"
  const mb = await page.evaluate(() => window.__game!.ui!.hud.center('menuBtn'));
  await canvasAt(page, mb);
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.hud.miniOpen)).toBe(true);
  await hover(page, { x: 77, y: 539 });
  await page.waitForTimeout(400);
  await shot(page, 'hud');
  // 오른쪽 스킬 버튼 → 스킬 고르기 목록 (원작: 버튼 위로 아이콘이 늘어선다)
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.hud.center('rskill')));
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.hud.menuCenter(0))).not.toBeNull();
  await hover(page, (await page.evaluate(() => window.__game!.ui!.hud.menuCenter(0)))!);
  await page.waitForTimeout(300);
  await shot(page, 'skillselect');
  await canvasAt(page, (await page.evaluate(() => window.__game!.ui!.hud.menuCenter(0)))!);
  expect(await page.evaluate(() => window.__game!.ui!.hud.skillMenu)).toBeNull();
  // 달리기 버튼 → 걷기/달리기 바뀜
  const run0 = await page.evaluate(() => window.__game!.input!.run);
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.hud.center('run')));
  expect(await page.evaluate(() => window.__game!.input!.run)).toBe(!run0);
  // 미니 패널 캐릭터 단추 → 캐릭터 패널
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.hud.center('char')));
  await expect(page.locator('#charpanel')).toBeVisible();
  await artReady(page, [`${P}invchar.dc6`, `${P}skillpoints.dc6`, `${P}buysellbtn.dc6`]);
  await hover(page, { x: 250, y: 300 });
  await page.waitForTimeout(300);
  await shot(page, 'char');
  const str0 = await page.evaluate(() => window.__game!.game.character!.str);
  await page.click('#stat-str');
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.str)).toBe(str0 + 1);
  await page.keyboard.press('c');
  await expect(page.locator('#charpanel')).toBeHidden();

  // 인벤토리 (I): 투구를 넣고 마우스를 올려 툴팁
  await page.evaluate(() => {
    const g = window.__game!.game;
    const d = g.data!;
    const cap = d.treasure.createItem(d.items.base('cap')!, 5, g.rng, 4);
    g.store.store(cap);
    g.gold = 1234;
  });
  await page.keyboard.press('i');
  await artReady(page, [`${P}goldcoinbtn.dc6`]);
  const capAt = await page.evaluate(() => {
    const g = window.__game!.game;
    const p = g.store.inv.items.find((x) => x.item.code === 'cap')!;
    return { x: 419 + (p.x + p.item.invW / 2) * 29, y: 315 + (p.y + p.item.invH / 2) * 29 };
  });
  await hover(page, capAt);
  await page.waitForTimeout(400);
  await shot(page, 'inventory');
  await page.keyboard.press('i');

  // 스킬 트리 (T): 아이콘 위 툴팁
  await page.keyboard.press('t');
  await expect(page.locator('#skilltree')).toBeVisible();
  await artReady(page, ['data\\global\\ui\\SPELLS\\skltree_b_back.dc6', 'data\\global\\ui\\SPELLS\\BaSkillicon.dc6']);
  await page.click('[data-learn="126"]'); // Bash (1쪽 1행 2열)
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.skills[126] ?? 0)).toBe(1);
  const bash = await page.locator('#skill-126').boundingBox();
  await page.mouse.move(bash!.x + 24, bash!.y + 24);
  await page.waitForTimeout(400);
  await shot(page, 'skilltree');
  await page.keyboard.press('t');

  // 보관함: 마을 보관함 오브젝트 곁으로 옮긴 뒤 클릭 → 연다 (objects.txt bank, OperateFn 32)
  const nearBank = () => page.evaluate(() => {
    const g = window.__game!.game;
    const o = g.objects.find((x) => x.type.name === 'bank');
    if (!o) return null;
    const m = g.map;
    // 조작 거리 (OperateRange 2 + 1) 안의 걷기 가능한 칸, 가까운 순 — 걷지 않고 바로 연다
    const cand: [number, number][] = [];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) >= 2) cand.push([dx, dy]);
    cand.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
    for (const [dx, dy] of cand) {
      const x = Math.floor(o.x) + dx, y = Math.floor(o.y) + dy;
      if (m.walkable(x, y)) {
        g.changeLevel('town', x + 0.5, y + 0.5);
        break;
      }
    }
    return o.id;
  });
  // 화면이 새 위치로 다시 그려진 뒤의 클릭 상자를 쓴다 (돌아다니는 NPC 가 가리면 다시)
  for (let tries = 0; ; tries++) {
    const bankId = await nearBank();
    expect(bankId).not.toBeNull();
    await page.waitForTimeout(400);
    const bp = await page.evaluate((id) => {
      const b = window.__game!.input!.pickBoxes.find((x) => x.kind === 'object' && x.id === id);
      return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
    }, bankId);
    if (bp) await canvasAt(page, bp);
    const ok = await page.waitForFunction(() => window.__game!.ui!.stash.open, undefined, { timeout: 5_000 }).then(() => true, () => false);
    if (ok) break;
    if (tries >= 4) throw new Error('보관함 열기 실패');
  }
  await artReady(page, [`${P}bank.dc6`]);
  // 인벤토리의 두루마리를 보관함에 옮기기 (원작: 집기 → 칸에 놓기)
  const scroll = await page.evaluate(() => {
    const p = window.__game!.game.store.inv.items.find((x) => x.item.code === 'tsc')!;
    return { x: 419 + (p.x + 0.5) * 29, y: 315 + (p.y + 0.5) * 29 };
  });
  await canvasAt(page, scroll);
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor?.code ?? null)).toBe('tsc');
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.stash.cellCenter(0, 0)));
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.stash.items.map((p) => p.item.code))).toContain('tsc');
  await hover(page, await page.evaluate(() => window.__game!.ui!.stash.cellCenter(0, 0)));
  await page.waitForTimeout(300);
  await shot(page, 'stash');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.stash.open)).toBe(false);

  // NPC: Akara 에게 말 걸기 → 메뉴 → Talk → 흐르는 대사
  await page.evaluate(() => {
    const g = window.__game!.game;
    const n = g.npcs.find((x) => x.type.id === 'akara')!;
    const m = g.map;
    for (let r = 4; r < 12; r++)
      for (let a = 0; a < 16; a++) {
        const x = Math.floor(n.x + Math.cos((a / 16) * Math.PI * 2) * r), y = Math.floor(n.y + Math.sin((a / 16) * Math.PI * 2) * r);
        if (m.walkable(x, y)) {
          g.changeLevel('town', x + 0.5, y + 0.5);
          return;
        }
      }
  });
  const akara = await page.evaluate(() => window.__game!.game.npcs.find((x) => x.type.id === 'akara')!.id);
  await page.waitForFunction((nid) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'npc' && b.id === nid), akara, { timeout: 15_000 });
  const ap = await page.evaluate((nid) => {
    const b = window.__game!.input!.pickBoxes.find((x) => x.kind === 'npc' && x.id === nid)!;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }, akara);
  await canvasAt(page, ap);
  await page.waitForFunction(() => window.__game!.game.snapshot().interaction?.typeId === 'akara', undefined, { timeout: 15_000 });
  await page.waitForTimeout(300);
  await shot(page, 'npcmenu');
  const talk = await page.evaluate(() => window.__game!.ui!.npcMenu.optionCenter('talk' as never));
  await canvasAt(page, talk!);
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.talk.open)).toBe(true);
  await page.waitForTimeout(3500);
  await shot(page, 'npctalk');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__game!.game.snapshot().interaction)).toBeNull();

  // 게임 메뉴 (Esc)
  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-save-exit')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, 'escmenu');
  // OPTIONS → SOUND OPTIONS: 음악 막대 25% 지점 클릭 → 사운드 시스템 음량 (원작 optbar·optskull)
  await page.click('#btn-options');
  await page.click('#btn-sound-options');
  await expect(page.locator('#opt-music')).toBeVisible();
  const mp = await page.evaluate(() => window.__game!.ui!.gameMenu.barPoint('music', 0.25));
  await canvasAt(page, mp);
  await expect.poll(() => page.evaluate(() => window.__audio!.settings.music)).toBeCloseTo(0.25, 1);
  const sp = await page.evaluate(() => window.__game!.ui!.gameMenu.barPoint('sfx', 0.8));
  await canvasAt(page, sp);
  await expect.poll(() => page.evaluate(() => window.__audio!.settings.sfx)).toBeCloseTo(0.8, 1);
  await page.waitForTimeout(300);
  await shot(page, 'options');
  await page.keyboard.press('Escape'); // SOUND OPTIONS → OPTIONS
  await page.keyboard.press('Escape'); // OPTIONS → 게임 메뉴
  await expect(page.locator('#btn-return')).toBeVisible();
  await page.click('#btn-return');
  await expect(page.locator('#gamemenu')).toBeHidden();
});
