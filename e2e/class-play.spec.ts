import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(1_500_000);
test.describe.configure({ mode: 'parallel' });

// 7직업 전 스킬 실플레이 전수 검사: 스킬 버튼으로 고르고(진짜 클릭), Hell 필드에서 진짜 마우스 오른쪽 클릭으로 쓴다.
// 스킬마다 빈 땅 · 몬스터 위 · 시체 위 세 군데를 눌러 시전이 시작되는지, 효과(미사일·소환·상태·피해)가 나는지, 시전 뒤 이동 클릭이 먹히는지 본다.
// 결과표는 e2e-reports/class-play-<직업>.json (요약을 docs/fidelity-audit.md 에 옮긴다).

// 페이지 안 도우미 (엔진 내부를 만지므로 타입 검사 없는 JS 문자열)
const PAGE_HELPER = `(() => {
  const G = () => window.__game.game;
  const cp = {
    ev: [], seen: new Set(), anchor: null, z: null,
    init() {
      const g = G(); const orig = g.tick.bind(g);
      // 사건과, 그 사이 한 번이라도 떠 있던 미사일 이름을 모은다 (빨리 사라지는 미사일도 놓치지 않게)
      g.tick = () => { const e = orig(); cp.ev.push(...e); for (const m of g.missiles) cp.seen.add(m.def.name); return e; };
    },
    toField() {
      const g = G();
      g.changeLevel('coldplains', 1, 1);
      const m = g.map; let best = { x: m.width / 2, y: m.height / 2 }, bd = Infinity;
      for (let y = 10; y < m.height - 10; y += 2) for (let x = 10; x < m.width - 10; x += 2) {
        let ok = true;
        for (let dy = -9; dy <= 9 && ok; dy++) for (let dx = -9; dx <= 9; dx++) if (!m.walkable(x + dx, y + dy)) { ok = false; break; }
        const d = Math.hypot(x - m.width / 2, y - m.height / 2);
        if (ok && d < bd) { bd = d; best = { x, y }; }
      }
      g.changeLevel('coldplains', best.x + 0.5, best.y + 0.5);
      cp.anchor = { x: best.x + 0.5, y: best.y + 0.5 };
      for (const o of g.monsters) o.x += 500;
    },
    // 움직이지 않는 튼튼한 표적 (플레이어 오른쪽 5칸)
    dummy() {
      const g = G(), a = cp.anchor;
      if (!cp.z || !g.monsters.includes(cp.z) || cp.z.mode === 'DD' || cp.z.mode === 'DT') cp.z = g.spawnMonster('zombie2', a.x + 5, a.y);
      const z = cp.z;
      z.x = a.x + 5; z.y = a.y; z.path = []; z.hp = z.stats.maxHp = 1e9; z.nextThink = Infinity;
      for (const n of [...z.states.names()]) z.states.remove(n);
      return z.id;
    },
    // 쓸 수 있는 시체 (플레이어 아래쪽) — 없으면 새로 만든다
    corpse() {
      const g = G(), a = cp.anchor;
      let c = g.monsters.find((m) => m.mode === 'DD' && !m.corpseUsed && Math.hypot(m.x - (a.x - 3), m.y - (a.y + 5)) < 1.5);
      if (!c) {
        const pending = g.monsters.find((m) => m.mode === 'DT' && Math.hypot(m.x - (a.x - 3), m.y - (a.y + 5)) < 1.5);
        if (pending) return null;
        c = g.spawnMonster('zombie1', a.x - 3, a.y + 5); c.nextThink = Infinity; g.killMonster(c);
        return null;
      }
      return c.id;
    },
    reset() {
      const g = G(), p = g.player, c = g.character, a = cp.anchor;
      p.x = a.x; p.y = a.y; p.path = []; p.action = null; p.pending = null; p.moveGoal = null;
      c.mana = 1e6; c.life = 1e6;
      p.states.remove('skilldelay');
      // 앞 스킬의 소환물·함정은 치운다 (Death Sentry 가 시험용 시체를 터뜨리고, 소환수가 표적을 때려 결과를 흐린다)
      for (const pet of g.pets) if (pet.pet) pet.pet.expires = 0;
      cp.dummy();
      cp.ev = [];
      cp.seen = new Set();
    },
    form() { const n = G().player.states.names(); return n.includes('wolf') ? 'wolf' : n.includes('bear') ? 'bear' : null; },
    skills() {
      const g = G(); const code = { Amazon: 'ama', Sorceress: 'sor', Necromancer: 'nec', Paladin: 'pal', Barbarian: 'bar', Druid: 'dru', Assassin: 'ass' }[g.character.cls];
      return [...g.data.skills.byId.values()].filter((s) => s.charclass === code && !s.passive).map((s) => ({
        id: s.id, name: s.name, aura: !!s.aura, auraState: s.auraState, targetCorpse: !!s.targetCorpse, targetableOnly: !!s.targetableOnly,
        range: s.range, st: s.srvStFunc, restrict: s.restrict, needForm: s.restrict === 2 ? (s.states || []).filter(Boolean) : null,
      }));
    },
    equip(lo) {
      const g = G(), st = g.store;
      if (!cp.origEq) cp.origEq = { rarm: st.equipment.rarm, larm: st.equipment.larm };
      const mk = (code, q) => { const it = g.data.treasure.createItem(g.data.items.base(code), 30, g.rng, 2, false); if (q) it.quantity = q; it.identified = true; return it; };
      delete st.equipment.rarm; delete st.equipment.larm;
      if (lo === null) { if (cp.origEq.rarm) st.equipment.rarm = cp.origEq.rarm; if (cp.origEq.larm) st.equipment.larm = cp.origEq.larm; }
      else { if (lo.rarm) st.equipment.rarm = mk(lo.rarm[0], lo.rarm[1]); if (lo.larm) st.equipment.larm = mk(lo.larm[0], lo.larm[1]); }
      g.statsDirty = true;
    },
    metalItem() {
      const g = G(), a = cp.anchor;
      const it = g.data.treasure.createItem(g.data.items.base('axe'), 30, g.rng, 2, false);
      g.dropItem(it, a.x - 5, a.y - 1);
      return it.id;
    },
    snap() {
      const g = G(), s = g.snapshot();
      return {
        missiles: [...new Set([...s.missiles.map((m) => m.name), ...cp.seen])], pets: g.pets.length, pstates: [...s.player.states],
        zstates: cp.z ? [...cp.z.states.names()] : [], x: s.player.x, y: s.player.y, busy: !g.playerIdle,
      };
    },
  };
  window.__cp = cp;
})();`;

interface SkillInfo { id: number; name: string; aura: boolean; auraState: string; targetCorpse: boolean; targetableOnly: boolean; range: string; st: number; restrict: number; needForm: string[] | null }
interface Snap { missiles: string[]; pets: number; pstates: string[]; zstates: string[]; x: number; y: number; busy: boolean }
interface Shot { started: boolean; effects: string[]; events: string[] }
interface Row { skill: string; loadout: string; selected: boolean; usable: string; ground?: Shot; monster?: Shot; corpse?: Shot; item?: Shot; aura?: boolean; move?: boolean; fails: string[] }

/** 스킬이 요구하는 무기를 찾을 때 차례로 들려 보는 장비 (null = 프리셋 장비 그대로) */
const LOADOUTS: [string, { rarm?: [string, number?]; larm?: [string, number?] } | null][] = [
  ['프리셋 장비', null], ['검+방패', { rarm: ['ssd'], larm: ['buc'] }], ['활+화살', { rarm: ['sbw'], larm: ['aqv', 200] }], ['투창', { rarm: ['jav', 200] }],
  ['손톱 둘', { rarm: ['ktr'], larm: ['ktr'] }], ['던지는 도끼 둘', { rarm: ['tax', 200], larm: ['tax', 200] }], ['단검', { rarm: ['dgr'] }], ['맨손', {}],
];

/** 대상(몬스터)이 꼭 있어야 시작하는 시작 함수 (game.ts startCheck) */
const NEEDS_TARGET_ST = new Set([5, 6, 7, 32, 23, 24, 25, 27, 22]);

const cpEval = <T>(page: Page, expr: string): Promise<T> => page.evaluate(expr) as Promise<T>;

async function rightClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(60);
  await page.mouse.up({ button: 'right' });
}

async function waitIdle(page: Page, ms = 3500): Promise<void> {
  await page.waitForFunction(() => window.__game!.game.playerIdle, undefined, { timeout: ms }).catch(() => undefined);
}

const NOISE = /^(arrived|levelChanged|monsterNotice|ambient|npc|playerMissed|monsterMissed|experience|itemDropped|goldDropped)/;

async function shoot(page: Page, id: number, x: number, y: number, waitStart: number): Promise<Shot> {
  await cpEval(page, 'window.__cp.reset()');
  await page.waitForTimeout(120);
  const before = await cpEval<Snap>(page, 'window.__cp.snap()');
  await rightClick(page, x, y);
  await page.waitForFunction((sid) => (window as unknown as { __cp: { ev: { type: string; skill?: number }[] } }).__cp.ev.some((e) => e.type === 'skillStart' && e.skill === sid), id, { timeout: waitStart }).catch(() => undefined);
  await page.waitForTimeout(350);
  await waitIdle(page);
  await page.waitForTimeout(250);
  const after = await cpEval<Snap>(page, 'window.__cp.snap()');
  const evs = await cpEval<{ type: string; skill?: number; reason?: string; source?: string }[]>(page, 'window.__cp.ev.map((e) => ({ type: e.type, skill: e.skill, reason: e.reason, source: e.source }))');
  const started = evs.some((e) => e.type === 'skillStart' && e.skill === id);
  const types = [...new Set(evs.map((e) => e.type + (e.reason ? `:${e.reason}` : '')))].filter((t) => !NOISE.test(t));
  const effects: string[] = [];
  const newMis = after.missiles.filter((m) => !before.missiles.includes(m));
  if (newMis.length) effects.push(`미사일(${newMis.slice(0, 3).join(',')})`);
  if (after.pets > before.pets || types.includes('petSummoned')) effects.push('소환');
  const ps = after.pstates.filter((s) => !before.pstates.includes(s) && s !== 'skilldelay');
  if (ps.length) effects.push(`내 상태(${ps.join(',')})`);
  const lost = before.pstates.filter((s) => !after.pstates.includes(s) && s !== 'skilldelay');
  if (lost.length) effects.push(`상태 해제(${lost.join(',')})`);
  const zs = after.zstates.filter((s) => !before.zstates.includes(s));
  if (zs.length) effects.push(`적 상태(${zs.join(',')})`);
  // 소환수가 낸 피해는 세지 않는다 (플레이어의 타격·미사일만). 근접 공격이 빗나간 것(miss)도 판정이 난 것
  if (evs.some((e) => e.type === 'monsterHit' && e.source === 'player')) effects.push('피해');
  else if (types.includes('miss')) effects.push('빗맞음');
  if (Math.hypot(after.x - before.x, after.y - before.y) > 1) effects.push('이동');
  for (const t of ['shapeShift', 'teleported', 'playerHealed', 'chargeUp', 'itemPicked', 'corpseUsed']) if (types.includes(t)) effects.push(t);
  return { started, effects, events: types };
}

for (const preset of ['amazon', 'sorceress', 'necromancer', 'paladin', 'barbarian', 'druid', 'assassin']) {
  test(`${preset}: 전 스킬 실제 클릭 검사`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/?preset=${preset}`);
    await page.waitForFunction(() => window.__game?.ready === true || window.__menuReady === true, undefined, { timeout: 150_000 });
    test.skip(!(await page.evaluate(() => window.__game?.ready === true)), '이 판본에서는 열 수 없는 프리셋 (확장팩 필요)');
    await page.addScriptTag({ content: PAGE_HELPER });
    await cpEval(page, 'window.__cp.init(); window.__cp.toField(); window.__cp.dummy(); window.__cp.corpse();');
    await page.waitForTimeout(2500);
    const canvas = (await (await page.$('canvas'))!.boundingBox())!;
    const hud = () => cpEval<{ r: { x: number; y: number } }>(page, '({ r: window.__game.ui.hud.center("rskill") })');
    const skills = await cpEval<SkillInfo[]>(page, 'window.__cp.skills()');
    const rows: Row[] = [];

    /** 화면에서 대상 상자 가운데 (없으면 null) */
    const boxOf = async (expr: string): Promise<{ x: number; y: number } | null> => {
      const b = await cpEval<{ x: number; y: number; w: number; h: number } | null>(page, `(() => { const id = ${expr}; const b = window.__game.input.pickBoxes.find((q) => q.id === id); return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null; })()`);
      return b ? { x: canvas.x + b.x + b.w / 2, y: canvas.y + b.y + b.h / 2 } : null;
    };
    /** 아무것도 없는 땅 (커서 아래 대상 없음) */
    const groundPoint = async (skip = 0): Promise<{ x: number; y: number }> => {
      const cands = [[230, 200], [180, 330], [560, 140], [300, 120], [620, 420]];
      for (const [x, y] of cands.slice(skip)) {
        await page.mouse.move(canvas.x + x!, canvas.y + y!);
        await page.waitForTimeout(100);
        if ((await cpEval<unknown>(page, 'window.__game.ui.hover()')) === null) return { x: canvas.x + x!, y: canvas.y + y! };
      }
      return { x: canvas.x + 230, y: canvas.y + 200 };
    };

    for (const s of skills) {
      const row: Row = { skill: s.name, loadout: '', selected: false, usable: '', fails: [] };
      rows.push(row);
      await cpEval(page, 'window.__cp.reset()');
      // 모습 맞추기: 변신 전용 스킬은 그 모습, 원소 마법(restrict 0)은 사람
      const want = s.needForm ? s.needForm[0]! : s.restrict === 0 ? null : undefined;
      if (want !== undefined) {
        const cur = await cpEval<string | null>(page, 'window.__cp.form()');
        if (cur !== want) {
          // 지금 모습을 풀고 (같은 스킬을 다시 쓰면 풀린다) 필요한 모습으로
          if (cur) {
            await cpEval(page, `(() => { const g = window.__game.game, p = g.player; p.states.remove('skilldelay'); g.enqueue({ type: 'useSkill', skill: g.data.skills.byNameOf('${cur === 'wolf' ? 'Wearwolf' : 'Wearbear'}').id, hand: 'right', x: p.x, y: p.y }); })()`);
            await page.waitForTimeout(1300);
          }
          if (want) {
            await cpEval(page, `(() => { const g = window.__game.game, p = g.player; p.states.remove('skilldelay'); g.enqueue({ type: 'useSkill', skill: g.data.skills.byNameOf('${want === 'wolf' ? 'Wearwolf' : 'Wearbear'}').id, hand: 'right', x: p.x, y: p.y }); })()`);
            await page.waitForTimeout(1300);
          }
          if ((await cpEval<string | null>(page, 'window.__cp.form()')) !== want) row.fails.push(`모습 맞추기 실패 (${want ?? '사람'})`);
        }
      }
      // 맞는 장비 찾기
      for (const [name, lo] of LOADOUTS) {
        await cpEval(page, `window.__cp.equip(${JSON.stringify(lo)})`);
        await page.waitForTimeout(60);
        row.usable = await cpEval<string>(page, `window.__game.game.skillUseState(${s.id})`);
        row.loadout = name;
        if (row.usable === 'usable') break;
      }
      if (row.usable !== 'usable') {
        row.fails.push(`어떤 장비로도 쓸 수 없음: ${row.usable}`);
        await cpEval(page, 'window.__cp.equip(null)');
        continue;
      }
      // 스킬 버튼으로 고르기 (진짜 클릭)
      const r = (await hud()).r;
      await page.mouse.click(canvas.x + r.x, canvas.y + r.y);
      await page.waitForTimeout(200);
      const mc = await cpEval<{ x: number; y: number } | null>(page, `window.__game.ui.hud.menuCenter(${s.id})`);
      if (!mc) {
        row.fails.push('스킬 고르기 목록에 없음');
        await page.mouse.click(canvas.x + r.x, canvas.y + r.y);
        await cpEval(page, 'window.__cp.equip(null)');
        continue;
      }
      await page.mouse.click(canvas.x + mc.x, canvas.y + mc.y);
      await page.waitForTimeout(250);
      row.selected = (await cpEval<number>(page, 'window.__game.game.character.rightSkill')) === s.id;
      if (!row.selected) {
        row.fails.push('목록에서 눌러도 오른쪽 스킬로 안 바뀜');
        await cpEval(page, 'window.__cp.equip(null)');
        continue;
      }
      if (s.aura) {
        // 오라: 오른쪽 스킬로 고르면 켜진다 (시전 없음)
        await page.waitForTimeout(1200);
        row.aura = await cpEval<boolean>(page, `window.__game.game.snapshot().player.states.includes(${JSON.stringify(s.auraState)})`);
        if (!row.aura) row.fails.push(`오라 상태(${s.auraState})가 안 켜짐`);
      } else {
        const needsTarget = (s.range === 'h2h' && s.targetableOnly) || NEEDS_TARGET_ST.has(s.st);
        const melee = s.range === 'h2h' || s.range === 'both';
        if (s.st === 20) {
          // Iron Golem: 바닥의 금속 아이템을 눌러야 한다
          const itemId = await cpEval<number>(page, 'window.__cp.metalItem()');
          await page.waitForTimeout(700);
          const ib = await boxOf(String(itemId));
          if (!ib) row.fails.push('바닥 아이템 상자를 못 찾음');
          else {
            row.item = await shoot(page, s.id, ib.x, ib.y, 2500);
            if (!row.item.started) row.fails.push('바닥 금속 아이템을 눌렀는데 시전 안 됨');
          }
        } else {
          // 몬스터 위
          if (!s.targetCorpse) {
            await cpEval(page, 'window.__cp.reset()');
            await page.waitForTimeout(150);
            const mb = await boxOf('window.__cp.z.id');
            if (!mb) row.fails.push('표적 몬스터 상자를 못 찾음');
            else {
              row.monster = await shoot(page, s.id, mb.x, mb.y, melee ? 4000 : 2500);
              if (!row.monster.started) row.fails.push(`몬스터를 눌렀는데 시전 안 됨 [${row.monster.events.join(',')}]`);
            }
          }
          // 시체 위 (방금 깐 함정·소환물을 먼저 치운다 — Death Sentry 는 근처 시체를 터뜨린다)
          await cpEval(page, 'window.__cp.reset()');
          await page.waitForTimeout(200);
          let corpseId: number | null = null;
          for (let i = 0; i < 12 && corpseId === null; i++) {
            corpseId = await cpEval<number | null>(page, 'window.__cp.corpse()');
            if (corpseId === null) await page.waitForTimeout(300);
          }
          await cpEval(page, 'window.__cp.reset()');
          await page.waitForTimeout(150);
          const cb = corpseId !== null ? await boxOf(String(corpseId)) : null;
          if (!cb) row.fails.push('시체 상자를 못 찾음');
          else {
            row.corpse = await shoot(page, s.id, cb.x, cb.y, 2500);
            if (!row.corpse.started && !needsTarget) row.fails.push(`시체 위를 눌렀는데 시전 안 됨 [${row.corpse.events.join(',')}]`);
          }
          // 빈 땅
          if (!s.targetCorpse) {
            await cpEval(page, 'window.__cp.reset()');
            const gp = await groundPoint();
            row.ground = await shoot(page, s.id, gp.x, gp.y, 2500);
            if (!row.ground.started && !needsTarget && s.range === 'none') row.fails.push(`빈 땅을 눌렀는데 시전 안 됨 [${row.ground.events.join(',')}]`);
          }
        }
        const shots = [row.monster, row.corpse, row.ground, row.item].filter((x): x is Shot => !!x && x.started);
        if (shots.length && !shots.some((x) => x.effects.length)) row.fails.push('시전은 되는데 눈에 보이는 효과(미사일·소환·상태·피해)가 없음');
      }
      // 시전 뒤 이동 클릭이 먹히는가 (왼쪽 클릭, 빈 땅)
      await cpEval(page, 'window.__cp.reset()');
      await waitIdle(page, 2000);
      const p0 = await cpEval<Snap>(page, 'window.__cp.snap()');
      const gp2 = await groundPoint(1);
      await page.mouse.click(gp2.x, gp2.y);
      await page.waitForTimeout(1300);
      const p1 = await cpEval<Snap>(page, 'window.__cp.snap()');
      row.move = Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1;
      if (!row.move) row.fails.push('이동 클릭이 안 먹힘');
      await cpEval(page, 'window.__cp.equip(null)');
    }

    // Playwright 가 test-results 를 실행마다 비우므로 따로 둔다
    mkdirSync('e2e-reports', { recursive: true });
    writeFileSync(`e2e-reports/class-play-${preset}.json`, JSON.stringify({ preset, skills: rows.length, errors, rows }, null, 1));
    const failed = rows.filter((r) => r.fails.length).map((r) => `${r.skill}: ${r.fails.join(' / ')}`);
    expect(failed, `${preset}: 실패한 스킬`).toEqual([]);
    expect(errors, `${preset}: 페이지 오류`).toEqual([]);
  });
}
