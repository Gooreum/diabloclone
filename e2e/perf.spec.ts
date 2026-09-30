import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { newHero, uniqueName, walkToBloodMoor } from './helpers';

test.skip(!existsSync('game-data/d2data.mpq'), '원작 game-data 필요');
test.setTimeout(240_000);
// 실제 그래픽카드로 그리게 한다 (기본 헤드리스는 소프트웨어 GL)
test.use({ launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] } });

// 성능 측정: Blood Moor 에 몬스터 100마리 + Frozen Orb·Blizzard 를 20초 동안 계속 쓰며 프레임 시간·메모리를 잰다.
// 변경 전(main)과 같은 스펙을 돌려 비교한다 (게임 공통 API 만 사용). 결과: test-results/perf-<라벨>.json
// 주의: 헤드리스 크롬은 GPU 없이 소프트웨어로 그리므로 절대값은 실제 크롬보다 느리다 — 같은 조건끼리 비교용.
const TYPES = ['zombie1', 'fallen1', 'quillrat1', 'fallenshaman1', 'skeleton1', 'brute1', 'wraith1', 'corruptrogue1', 'sandraider1', 'goatman1'];

test('성능: 몬스터 100마리 + 광역 스킬 20초', async ({ page }) => {
  await newHero(page, uniqueName('Perf'), 'sorceress');
  await walkToBloodMoor(page);
  const spawned = await page.evaluate((types) => {
    const g = window.__game!.game;
    const ch = g.character!;
    ch.level = 60;
    ch.life = ch.maxLife = 1e6;
    ch.mana = ch.maxMana = 1e6;
    const db = g.data!.skills!;
    for (const n of ['Frozen Orb', 'Blizzard']) ch.skills[db.byNameOf(n)!.id] = 20;
    const p = g.snapshot().player;
    let n = 0;
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2 * 3, r = 5 + (i % 10) * 1.5;
      const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      if (!g.map.walkable(Math.floor(x), Math.floor(y))) continue;
      try {
        const m = g.spawnMonster(types[i % types.length]!, x, y);
        m.hp = m.stats.maxHp = 1e7;
        n++;
      } catch {
        // 이 판에 없는 종류는 건너뛴다
      }
    }
    return n;
  }, TYPES);
  expect(spawned).toBeGreaterThan(50);
  const result = await page.evaluate(async () => {
    const g = window.__game!.game;
    const db = g.data!.skills!;
    const orb = db.byNameOf('Frozen Orb')!.id, bliz = db.byNameOf('Blizzard')!.id;
    const frames: number[] = [];
    let last = performance.now();
    let running = true;
    const loop = (now: number) => {
      frames.push(now - last);
      last = now;
      if (running) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const mem = () => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6;
    const heap0 = mem();
    let k = 0;
    const cast = setInterval(() => {
      const p = g.snapshot().player;
      const a = k++ * 0.9;
      g.character!.mana = g.character!.maxMana;
      g.enqueue({ type: 'useSkill', skill: k % 2 ? orb : bliz, hand: 'right', x: p.x + Math.cos(a) * 8, y: p.y + Math.sin(a) * 8 });
    }, 400);
    await new Promise((r) => setTimeout(r, 20_000));
    running = false;
    clearInterval(cast);
    const sorted = [...frames].sort((a, b) => a - b);
    const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'none',
      frames: frames.length,
      fps: Math.round((frames.length / 20) * 10) / 10,
      avgMs: Math.round((frames.reduce((a, b) => a + b, 0) / frames.length) * 10) / 10,
      p95Ms: Math.round(pct(0.95) * 10) / 10,
      maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
      over50ms: frames.filter((f) => f > 50).length,
      heapStartMb: Math.round(heap0),
      heapEndMb: Math.round(mem()),
    };
  });
  const label = process.env.PERF_LABEL ?? 'current';
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/perf-${label}.json`, JSON.stringify({ label, spawned, ...result }, null, 2));
  console.log(`[perf ${label}] ${JSON.stringify({ spawned, ...result })}`);
  expect(result.frames).toBeGreaterThan(0);
});
