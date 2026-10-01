import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

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

// ---------------------------------------------------------------- Phase 12 Step 2: UI 차이 메우기 — test-results/ui12-*.png
const shot12 = (page: Page, name: string) => page.locator('#game').screenshot({ path: `${SHOTS}/ui12-${name}.png` });

/** 마을 보관함 곁으로 옮긴 뒤 클릭해 연다 (보관함 + 인벤토리) */
async function openBank(page: Page): Promise<void> {
  for (let tries = 0; ; tries++) {
    const bankId = await page.evaluate(() => {
      const g = window.__game!.game;
      const o = g.objects.find((x) => x.type.name === 'bank');
      if (!o) return null;
      const cand: [number, number][] = [];
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) >= 2) cand.push([dx, dy]);
      cand.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
      for (const [dx, dy] of cand) {
        const x = Math.floor(o.x) + dx, y = Math.floor(o.y) + dy;
        if (g.map.walkable(x, y)) {
          g.changeLevel('town', x + 0.5, y + 0.5);
          break;
        }
      }
      return o.id;
    });
    expect(bankId).not.toBeNull();
    await page.waitForTimeout(400);
    const bp = await page.evaluate((id) => {
      const b = window.__game!.input!.pickBoxes.find((x) => x.kind === 'object' && x.id === id);
      return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
    }, bankId);
    if (bp) await canvasAt(page, bp);
    const ok = await page.waitForFunction(() => window.__game!.ui!.stash.open, undefined, { timeout: 5_000 }).then(() => true, () => false);
    if (ok) return;
    if (tries >= 4) throw new Error('보관함 열기 실패');
  }
}

test('Phase 12 UI: 로딩·커서·금화 창·Alt 이름표·가리킨 유닛·벨트·메시지·옵션·스킬 툴팁·캐릭터 선택', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const hero = uniqueName('Ph');
  await page.goto('/');
  await page.waitForFunction(() => window.__menuReady === true, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => window.__menuArtReady?.() === true, undefined, { timeout: 60_000 });
  await page.click('#btn-single');
  await page.click('#btn-create');
  await page.click('#btn-barbarian');
  await page.fill('#hero-name', hero);
  await page.click('#btn-ok');
  // 게임 시작 로딩 화면 (원작 loadingscreen.dc6)
  await page.waitForFunction(() => window.__loading === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(450);
  await shot12(page, 'loading');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  await page.waitForFunction(() => (window.__game?.game.snapshot().tick ?? 0) > 1 && window.__game!.game.npcs.length > 0, undefined, { timeout: 30_000 });
  await page.evaluate(() => {
    const g = window.__game!.game;
    g.monsters.splice(0);
    g.gold = 5000;
  });
  const P = 'data\\global\\ui\\PANEL\\';
  await artReady(page, [`${P}ctrlpnl7.dc6`, `${P}invchar.dc6`, `${P}goldcoinbtn.dc6`, 'data\\global\\ui\\MENU\\dialogbackground.dc6', `${P}buysellbtn.dc6`, 'data\\global\\ui\\MENU\\textslid.dc6', 'data\\global\\ui\\CURSOR\\ohand.dc6']);

  // 가리킨 유닛을 밝게 (NPC — 돌아다니므로 따라가며 올린다)
  let lit = false;
  for (let i = 0; i < 30 && !lit; i++) {
    const b = await page.evaluate(() => {
      const x = window.__game!.input!.pickBoxes.find((q) => q.kind === 'npc' && q.y > 30 && q.y < 420);
      return x ? { x: x.x + x.w / 2, y: x.y + 20 } : null;
    });
    if (b) await hover(page, b);
    await page.waitForTimeout(80);
    lit = (await page.evaluate(() => window.__game!.ui!.hover()?.kind)) === 'npc';
  }
  expect(lit).toBe(true);
  await shot12(page, 'hover-highlight');
  // 커서: 보통 손 → 인벤토리 아이템 위 = 손 애니메이션 → 들면 아이템 그림
  // 아무 유닛·아이템 선택 상자에도 걸리지 않는 빈 땅 (마을 NPC 가 걸어 다니므로 자리를 고른다)
  const empty = await page.evaluate(() => {
    const boxes = window.__game!.input!.pickBoxes;
    for (let y = 120; y <= 420; y += 30)
      for (let x = 60; x <= 740; x += 40)
        if (!boxes.some((b) => x >= b.x - 10 && y >= b.y - 10 && x < b.x + b.w + 10 && y < b.y + b.h + 10)) return { x, y };
    return { x: 250, y: 300 };
  });
  await hover(page, empty);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__game!.ui!.cursor.state)).toBe('hand');
  await page.keyboard.press('i');
  const potAt = await page.evaluate(() => {
    const p = window.__game!.game.store.inv.items[0]!;
    return { x: 419 + (p.x + p.item.invW / 2) * 29, y: 315 + (p.y + p.item.invH / 2) * 29 };
  });
  await hover(page, potAt);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__game!.ui!.cursor.state)).toBe('hover');
  await shot12(page, 'cursor-hover');
  await canvasAt(page, potAt);
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.cursor.state)).toBe('item');
  await hover(page, { x: potAt.x - 60, y: potAt.y - 40 });
  await page.waitForTimeout(200);
  await shot12(page, 'cursor-item');
  // 제자리에 다시 놓기
  await canvasAt(page, potAt);
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor)).toBeNull();

  // 금화 창 (인벤토리 금화 단추 = 떨어뜨리기): 지우고 1200 입력 → 위 화살표 +1 → 확인
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.inventory.goldCenter()));
  await expect(page.locator('#gold-ok')).toBeVisible();
  expect(await page.evaluate(() => [window.__game!.ui!.gold.kind, window.__game!.ui!.gold.value])).toEqual(['drop', 5000]);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  for (const k of '1200') await page.keyboard.press(k);
  await page.click('#gold-up');
  expect(await page.evaluate(() => window.__game!.ui!.gold.value)).toBe(1201);
  await hover(page, { x: 600, y: 250 });
  await page.waitForTimeout(200);
  await shot12(page, 'gold-drop');
  await page.click('#gold-ok');
  await expect.poll(() => page.evaluate(() => window.__game!.game.gold)).toBe(5000 - 1201);
  expect(await page.evaluate(() => window.__game!.game.snapshot().items.some((i) => i.code === 'gld' && i.quantity === 1201))).toBe(true);
  // 취소는 아무 일 없음
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.inventory.goldCenter()));
  await page.click('#gold-cancel');
  await expect(page.locator('#gold-ok')).toBeHidden();
  expect(await page.evaluate(() => window.__game!.game.gold)).toBe(3799);
  await page.keyboard.press('i');

  // Alt: 바닥 아이템 이름 모두 (원작 이름표 상자·품질 색)
  await page.evaluate(() => {
    const g = window.__game!.game;
    const d = g.data!;
    const p = g.snapshot().player;
    const mk = (code: string, q: 2 | 4 | 6 | 7) => d.treasure.createItem(d.items.base(code)!, 10, g.rng, q);
    const a = mk('hax', 4), b = mk('cap', 2), c = mk('lsd', 6), e = mk('buc', 7);
    a.identified = b.identified = c.identified = e.identified = true;
    g.dropItem(a, p.x + 2, p.y);
    g.dropItem(b, p.x, p.y + 2);
    g.dropItem(c, p.x + 2, p.y + 2);
    g.dropItem(e, p.x - 2, p.y + 1);
  });
  await page.waitForTimeout(500);
  await hover(page, { x: 700, y: 120 });
  await page.keyboard.down('Alt');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.labels().length)).toBeGreaterThanOrEqual(5);
  // 이름표 위에 마우스 = 파란 바탕 (가리킨 아이템)
  const lab = await page.evaluate(() => {
    const l = window.__game!.ui!.labels().find((x) => x.text !== '')!;
    const b = [...window.__game!.input!.pickBoxes].reverse().find((q) => q.kind === 'item' && q.id === l.id)!;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2, id: l.id };
  });
  await hover(page, lab);
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.hover())).toEqual({ kind: 'item', id: lab.id });
  await page.waitForTimeout(200);
  await shot12(page, 'alt-labels');
  await page.keyboard.up('Alt');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.altHeld())).toBe(false);

  // 벨트 펼치기: 16칸 벨트(hbl) + 윗줄 물약 → ~ 키
  await page.evaluate(() => {
    const g = window.__game!.game;
    const d = g.data!;
    g.store.equipment.belt = d.treasure.createItem(d.items.base('hbl')!, 10, g.rng, 2);
    for (let i = 4; i < 16; i += 3) g.store.belt[i] = d.treasure.createItem(d.items.base(i % 2 ? 'mp1' : 'hp2')!, 1, g.rng, 2);
  });
  await page.keyboard.press('`');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.hud.beltOpen)).toBe(true);
  await hover(page, { x: 420, y: 470 });
  await page.waitForTimeout(250);
  await shot12(page, 'belt-expanded');
  // 윗줄 칸 클릭 = 집기
  const cell = await page.evaluate(() => window.__game!.ui!.hud.beltCell(7));
  await canvasAt(page, { x: cell.x + 15, y: cell.y + 15 });
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.cursor?.code ?? null)).toBe('mp1');
  await canvasAt(page, { x: cell.x + 15, y: cell.y + 15 });
  await expect.poll(() => page.evaluate(() => window.__game!.game.store.belt[7]?.code ?? null)).toBe('mp1');
  await page.keyboard.press('`');
  expect(await page.evaluate(() => window.__game!.ui!.hud.beltOpen)).toBe(false);

  // 메시지 (왼쪽 위, 흐려짐): 신전 사건 → 원작 문자열 ShrMsg
  await page.evaluate(() => {
    // 다음 틱 사건에 끼워 넣어 main 의 사건 처리 그대로 거친다
    const g = window.__game!.game as unknown as { tick: () => { type: string; [k: string]: unknown }[] };
    const orig = g.tick.bind(g);
    g.tick = () => {
      const ev = orig();
      // 같은 틱의 shrineWarp 는 shrine 메시지와 겹치지 않는다
      ev.push({ type: 'shrine', objectId: 0, code: 1, name: 'refresh', message: 'ShrMsg1' }, { type: 'shrineWarp', monsterId: 0 }, { type: 'questMessage', key: 'qstsa1q14', count: 3 });
      g.tick = orig;
      return ev;
    };
  });
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.messages.visible(performance.now()).length)).toBe(2);
  // 따로 온 신전 미사일 사건 (Exploding 신전) → 원작 ShrMsg21
  await page.evaluate(() => {
    const g = window.__game!.game as unknown as { tick: () => { type: string; [k: string]: unknown }[] };
    const orig = g.tick.bind(g);
    g.tick = () => {
      const ev = orig();
      ev.push({ type: 'shrineMissiles', objectId: 0, missile: 'explosivepotion', count: 6 });
      g.tick = orig;
      return ev;
    };
  });
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.messages.visible(performance.now()).map((l) => l.text))).toContain('A circle of flame...');
  // 스태미나 물약 상태 → 파란 스태미나 막대 (states.txt stambarblue)
  const blue = await page.evaluate(() => new Promise<number[]>((res) => {
    const g = window.__game!.game as unknown as { snapshot: () => { player: { states: string[] } } };
    const orig = g.snapshot.bind(g);
    g.snapshot = () => {
      const s = orig();
      return { ...s, player: { ...s.player, states: [...s.player.states, 'staminapot'] } };
    };
    setTimeout(() => {
      // 스태미나 칸 안쪽 (판본별 배치 — 확장팩 800 조작판은 위치가 다르다)
      const sb = window.__game!.ui!.hud.L.stamina;
      const d = (document.getElementById('game') as HTMLCanvasElement).getContext('2d')!.getImageData(sb.x + 6, sb.y + 9, 1, 1).data;
      g.snapshot = orig;
      res([d[0]!, d[1]!, d[2]!]);
    }, 200);
  }));
  expect(blue[2]).toBeGreaterThan(blue[0]! + 60);
  await page.waitForTimeout(200);
  await shot12(page, 'messages');

  // 보관함 금화: 넣기(인벤토리 금화 단추) → 빼기(보관함 금화 단추)
  await openBank(page);
  await artReady(page, [`${P}bank.dc6`]);
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.inventory.goldCenter()));
  expect(await page.evaluate(() => window.__game!.ui!.gold.kind)).toBe('deposit');
  await page.click('#gold-ok');
  await expect.poll(() => page.evaluate(() => [window.__game!.game.gold, window.__game!.game.stashGold])).toEqual([0, 3799]);
  await canvasAt(page, await page.evaluate(() => window.__game!.ui!.stash.goldCenter()));
  expect(await page.evaluate(() => [window.__game!.ui!.gold.kind, window.__game!.ui!.gold.value])).toEqual(['withdraw', 3799]);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  for (const k of '500') await page.keyboard.press(k);
  await page.click('#gold-down');
  await hover(page, { x: 600, y: 40 });
  await page.waitForTimeout(200);
  await shot12(page, 'gold-withdraw');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => [window.__game!.game.gold, window.__game!.game.stashGold])).toEqual([499, 3300]);
  await page.keyboard.press('Escape');

  // 스킬 툴팁: 현재·다음 레벨 줄 (skilldesc desc 줄 + SkillCalc), 시너지
  await page.evaluate(() => (window.__game!.game.character!.skillPoints = 2));
  await page.keyboard.press('t');
  await artReady(page, ['data\\global\\ui\\SPELLS\\skltree_b_back.dc6', 'data\\global\\ui\\SPELLS\\BaSkillicon.dc6']);
  await page.click('[data-learn="126"]');
  await expect.poll(() => page.evaluate(() => window.__game!.game.character!.skills[126] ?? 0)).toBe(1);
  const bash = await page.locator('#skill-126').boundingBox();
  await page.mouse.move(bash!.x + 24, bash!.y + 24);
  await page.waitForTimeout(300);
  const tip = await page.evaluate(() => window.__game!.ui!.skillTree.lastTip);
  expect(tip).toContain('Current Skill Level: 1');
  expect(tip).toContain('Next Level');
  expect(tip.filter((l) => l.startsWith('Mana Cost: ')).length).toBe(2);
  expect(tip.some((l) => /^Attack: \+20 percent$/.test(l))).toBe(true);
  expect(tip.some((l) => /Receives Bonuses From/.test(l))).toBe(true);
  await shot12(page, 'skilltip');
  // 배우지 않은 스킬: First Level
  const stun = await page.locator('[data-learn="139"]').boundingBox();
  await page.click('#skilltab-1');
  if (stun) {
    await page.mouse.move(stun.x + 24, stun.y + 24);
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('t');

  // 옵션: VIDEO / AUTOMAP / CONFIGURE CONTROLS (원작 font42 항목)
  await page.keyboard.press('Escape');
  await page.click('#btn-options');
  await expect(page.locator('#btn-video-options')).toBeVisible();
  await page.waitForTimeout(200);
  await shot12(page, 'options');
  await page.click('#btn-video-options');
  await expect(page.locator('#opt-lighting')).toBeVisible();
  await page.click('#opt-lighting');
  expect(await page.evaluate(() => window.__game!.ui!.gameMenu.options.lighting)).toBe('low');
  await page.click('#opt-perspective');
  expect(await page.evaluate(() => window.__game!.ui!.gameMenu.options.perspective)).toBe(false);
  await page.waitForTimeout(200);
  await shot12(page, 'options-video');
  await page.click('#btn-video-prev');
  await page.click('#btn-automap-options');
  await page.click('#opt-automap-size');
  await page.click('#opt-automap-fade');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('d2clone.options') ?? '{}'))).toMatchObject({ automapSize: 'mini', automapFade: true, lighting: 'low' });
  await page.waitForTimeout(200);
  await shot12(page, 'options-automap');
  await page.click('#btn-automap-prev');
  await page.click('#btn-configure-controls');
  await expect(page.locator('#key-inv')).toBeVisible();
  await page.click('#key-inv');
  await page.keyboard.press('k');
  expect(await page.evaluate(() => JSON.stringify(window.__game!.ui!.gameMenu.waitingKey))).toBe('null');
  await page.waitForTimeout(200);
  await shot12(page, 'options-controls');
  await page.click('#btn-controls-prev');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('d2clone.keys') ?? '{}').inv)).toBe('K');
  await page.click('#btn-options-prev');
  await page.click('#btn-return');
  await page.keyboard.press('k');
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.inventory.open)).toBe(true);
  await page.keyboard.press('k');
  // 자동 지도: 옵션 AUTOMAP SIZE = MINI MAP
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => window.__game!.ui!.automap())).toBe('mini');
  await page.keyboard.press('Tab');

  // 레벨 이동 로딩 화면 (던전 입구)
  const dungeon = await page.evaluate(() => {
    const g = window.__game!.game as unknown as { levels: Map<string, unknown> };
    return [...g.levels.keys()].find((k) => /den|cave|crypt|mausoleum|cellar/i.test(k)) ?? null;
  });
  expect(dungeon).not.toBeNull();
  {
    const flashed = await page.evaluate((k) => new Promise<boolean>((res) => {
      // 틱 안에서 레벨을 바꾼다 (실제 계단·입구와 같은 사건 흐름)
      const g = window.__game!.game as unknown as { tick: () => unknown[]; changeLevel: (k: string, x: number, y: number) => void };
      const orig = g.tick.bind(g);
      g.tick = () => {
        g.tick = orig;
        const ev = orig();
        g.changeLevel(k, 20, 20);
        return [...ev, { type: 'levelChanged', level: k }];
      };
      setTimeout(() => res(window.__game!.ui!.loading.active(performance.now())), 120);
    }), dungeon as string);
    expect(flashed).toBe(true);
  }

  // 캐릭터 선택: 저장 → 복제 9명 넣기 → 스크롤·영웅 그림·지우기 확인
  await page.evaluate(() => window.__game!.save!());
  await page.waitForFunction(() => window.__menuReady === true);
  await page.evaluate((name) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('diabloclone', 1);
    req.onsuccess = () => {
      const st = req.result.transaction('heroes', 'readwrite').objectStore('heroes');
      const get = st.get(name);
      get.onsuccess = () => {
        const base = JSON.parse(get.result as string) as { name: string; savedAt: number; equipment: object; character: { cls: string; level: number } };
        const classes = ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian'];
        for (let i = 0; i < 9; i++) {
          const n = `Clone${String.fromCharCode(97 + i)}`;
          st.put(JSON.stringify({ ...base, name: n, savedAt: base.savedAt - 1000 * (i + 1), equipment: i % 2 ? base.equipment : {}, character: { ...base.character, cls: classes[i % 5], level: i + 2 } }), n);
        }
        st.transaction.oncomplete = () => resolve();
      };
      get.onerror = () => reject(get.error);
    };
  }), hero);
  await page.click('#btn-single');
  await expect(page.locator('#hero-Clonea')).toBeVisible();
  await page.waitForTimeout(1500);
  await hover(page, { x: 700, y: 300 });
  await shot12(page, 'charselect-heroes');
  await page.click('#charsel-down');
  await expect.poll(() => page.evaluate(() => window.__menu!.scrollRow)).toBe(1);
  await expect(page.locator('#hero-Clonei')).toBeVisible();
  await expect(page.locator(`#hero-${hero}`)).toBeHidden();
  await page.waitForTimeout(300);
  await shot12(page, 'charselect-scroll');
  await page.click('#hero-Clonei');
  await page.click('#btn-delete');
  await expect(page.locator('#btn-delete-yes')).toBeVisible();
  await page.waitForTimeout(200);
  await shot12(page, 'delete-confirm');
  await page.click('#btn-delete-no');
  await expect(page.locator('#hero-Clonei')).toBeVisible();
  await page.click('#hero-Clonei');
  await page.click('#btn-delete');
  await page.click('#btn-delete-yes');
  await expect(page.locator('#hero-Clonei')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Phase 12 UI: 아이언 골렘 — 오른쪽 스킬로 바닥 금속 아이템 클릭 → targetItem', async ({ page }) => {
  await newHero(page, uniqueName('Ig'), 'necromancer');
  await walkToBloodMoor(page);
  const info = await page.evaluate(() => {
    const g = window.__game!.game;
    g.monsters.splice(0);
    const d = g.data!;
    const s = d.skills!.byNameOf('IronGolem')!;
    const ch = g.character!;
    ch.level = 24;
    ch.skills[s.id] = 1;
    ch.rightSkill = s.id;
    ch.mana = ch.maxMana = 200;
    const p = g.snapshot().player;
    const it = d.treasure.createItem(d.items.base('axe')!, 10, g.rng, 2);
    it.identified = true;
    g.dropItem(it, p.x + 3, p.y + 1);
    return { skill: s.id, item: it.id };
  });
  // 바닥 아이템 클릭 상자 (그림이 읽힐 때까지)
  await page.waitForFunction((id) => window.__game!.input!.pickBoxes.some((b) => b.kind === 'item' && b.id === id), info.item, { timeout: 15_000 });
  const box = await page.evaluate((id) => {
    const b = window.__game!.input!.pickBoxes.find((x) => x.kind === 'item' && x.id === id)!;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }, info.item);
  await hover(page, box);
  await expect.poll(() => page.evaluate(() => window.__game!.ui!.hover()?.kind)).toBe('item');
  await page.waitForTimeout(150);
  await shot12(page, 'irongolem-target');
  await canvasAt(page, box, 'right');
  // 아이템이 사라지고 골렘 소환수가 생긴다 (엔진 Iron Golem St20/Do057)
  await expect.poll(() => page.evaluate((id) => window.__game!.game.groundItemById(id) === undefined, info.item), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game!.game.pets.some((m) => /golem/i.test(m.type.id))), { timeout: 10_000 }).toBe(true);
});
