// 용병 (Kashya, Rogue Scout) — 기대값 출처: hireling.txt Act 1 행 (Id 0 불 화살 Gold 100 · Id 1 얼음 화살 Gold 150, Level 3, HP 45 HP/Lvl 8,
// Defense 15 Def/Lvl 6, Str 35 Str/Lvl 10, Dex 45 Dex/Lvl 16, AR 10 AR/Lvl 10, Dmg 1-3 Dmg/Lvl 2, Resist 0 Resist/Lvl 8, Exp/Lvl 100, NameFirst merc01 ~ NameLast merc41),
// D2MOO Monsters.cpp MONSTERS_HirelingInit / MONSTERS_GetHirelingExpForNextLevel / MONSTERS_GetHirelingResurrectionCost,
// MonsterAI.cpp MONSTERAI_UpdateMercStatsAndSkills, SUnitNpc.cpp D2GAME_NPC_FirstFn / sub_6FCC7FA0 / D2GAME_NPC_ResurrectMerc, SUnitDmg.cpp 용병 경험치
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World } from '../../src/data/act1-world';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { nearestWalkable } from '../../src/engine/path';
import { Rng } from '../../src/engine/rng';
import { buildHireList, hirelingExp, hirelingInit, mercExpGain, mercStats, resurrectCost, type HirelingDb, type MercSave } from '../../src/engine/hireling';
import { makeSave, parseSave, serializeSave } from '../../src/engine/save';
import type { MonsterUnit } from '../../src/engine/ai';

const d = hasGameData ? describe : describe.skip;

let tables: GameTables;
let data: GameData;
let db: HirelingDb;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
  db = data.hirelings!;
});

function makeGame(opts: { level?: number; gold?: number; merc?: MercSave | null; seed?: number } = {}): Game {
  const cs = classStats(tables.table('charstats'), 'Amazon');
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 1;
  const seed = opts.seed ?? 777;
  const w = buildAct1World(gameChain(), tables, data, seed);
  const g = new Game({
    map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), seed, data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Amazon'), gold: opts.gold ?? 0, merc: opts.merc ?? null,
  });
  g.tick();
  return g;
}

function toKashya(g: Game): MonsterUnit {
  const n = g.npcs.find((x) => x.type.id === 'kashya')!;
  const spot = nearestWalkable(g.map, { x: n.x + 3, y: n.y + 1 }, 8)!;
  g.changeLevel('town', spot.x + 0.5, spot.y + 0.5);
  g.enqueue({ type: 'interact', unitId: n.id });
  for (let i = 0; i < 300 && !g.snapshot().interaction; i++) g.tick();
  return n;
}

/** Blood Moor 의 트인 곳 (주변 12×12 가 모두 걷기 가능 — 미사일이 나무·바위에 막히지 않게) 으로 옮기고 몬스터를 치운다 */
function toBloodMoor(g: Game): void {
  const lv = g.levelDef('bloodmoor')!;
  const m = lv.map;
  let spot: { x: number; y: number } | null = null;
  for (let y = 20; y < m.height - 20 && !spot; y += 3)
    for (let x = 20; x < m.width - 20 && !spot; x += 3) {
      let ok = true;
      for (let dy = -6; dy <= 6 && ok; dy++) for (let dx = -6; dx <= 6 && ok; dx++) if (!m.walkable(x + dx, y + dy)) ok = false;
      if (ok) spot = { x, y };
    }
  g.changeLevel('bloodmoor', spot!.x + 0.5, spot!.y + 0.5);
  g.tick();
  g.monsters.splice(0);
}

d('hireling.txt · 공식', () => {
  it('Act 1 보통 행: Kashya(150) 가 파는 Rogue Scout (roguehire 271), 이름 merc01~merc41', () => {
    const r = db.byVendor(data.monsters.get('kashya').hcIdx, 0)!;
    expect(r).toMatchObject({ id: 0, cls: 271, act: 1, level: 3, gold: 100, hp: 45, hpPerLvl: 8, defense: 15, str: 35, dex: 45, ar: 10, dmgMin: 1, dmgMax: 3 });
    expect(r.names.length).toBe(41);
    expect(r.names[0]).toBe('merc01');
    expect(tables.string(r.names[0]!)).toBe('Aliza');
    // MONSTERS_HirelingInit 후보: Act 1 보통 레벨 3 행 두 개 (불 화살 Id 0, 얼음 화살 Id 1 Gold 150)
    const a = db.byAct(0, 0)!, b = db.byAct(0, 0, a)!;
    expect([a.id, b.id, b.gold]).toEqual([0, 1, 150]);
    expect(db.byAct(0, 0, b)).toBeUndefined();
  });

  // 출처: D2GAME_NPC_FirstFn — 이름마다 시드, 10 번 보이게 (한 바퀴 돌면 끝)
  it('고용 목록: 41 명 중 10 명이 보인다 (같은 시드 = 같은 목록)', () => {
    const r = db.byVendor(data.monsters.get('kashya').hcIdx, 0)!;
    const a = buildHireList(r, new Rng(123)), b = buildHireList(r, new Rng(123));
    expect(a.filter((e) => e.available).length).toBe(10);
    expect(a.map((e) => e.seed)).toEqual(b.map((e) => e.seed));
    expect(a.map((e) => e.available)).toEqual(b.map((e) => e.available));
  });

  // 출처: MONSTERS_HirelingInit — 레벨 = 3 + min(rand%5, 플레이어 레벨 − 3), 가격 = Gold × (15·levelUps + 100) / 100 (최소 Gold)
  it('고용 가격·레벨', () => {
    for (let s = 1; s < 60; s++) {
      const hi = hirelingInit(db, s * 7919, 30, 0, 0)!;
      const base = hi.id === 0 ? 100 : 150;
      const up = hi.level - 3;
      expect(up).toBeGreaterThanOrEqual(0);
      expect(up).toBeLessThanOrEqual(4);
      expect(hi.gold).toBe(Math.trunc((base * (15 * up + 100)) / 100));
      expect(hi.experience).toBe(hi.level * hi.level * (hi.id === 0 ? 100 : 105) * (hi.level + 1));
      // 플레이어 레벨 1: 레벨 1, 가격은 최소 Gold
      const lo = hirelingInit(db, s * 7919, 1, 0, 0)!;
      expect(lo.level).toBe(1);
      expect(lo.gold).toBe(lo.id === 0 ? 100 : 150);
    }
  });

  // 출처: MONSTERAI_UpdateMercStatsAndSkills
  it('레벨별 스탯: 3 레벨 / 10 레벨 (불 화살)', () => {
    const l3 = mercStats(db, 0, 3)!;
    expect(l3).toMatchObject({ maxHp: 45, defense: 15, str: 35, dex: 45, toHit: 10, minDamage: 1, maxDamage: 3, resist: 0 });
    expect(l3.skills.map((s) => [s.name, s.level])).toEqual([['Inner Sight', 1], ['Fire Arrow', 1]]);
    const l10 = mercStats(db, 0, 10)!;
    // levelUps 7: HP 45 + 56, 방어 15 + 42, Str 35 + 70/8, Dex 45 + 112/8, AR 10 + 70, 피해 +14/8, 저항 56/4, 스킬 1 + (7·10 >> 5)
    expect(l10).toMatchObject({ maxHp: 101, defense: 57, str: 43, dex: 59, toHit: 80, minDamage: 2, maxDamage: 4, resist: 14 });
    expect(l10.skills.find((s) => s.name === 'Fire Arrow')?.level).toBe(3);
    // 25 레벨부터는 25 레벨 행 (HP 221)
    expect(mercStats(db, 0, 25)!.maxHp).toBe(221);
    expect(l3.nextExp).toBe(hirelingExp(4, 100));
  });

  // 출처: MONSTERS_GetHirelingResurrectionCost — 15 × L × L / 2, 최대 50000
  it('부활 비용', () => {
    expect(resurrectCost(3)).toBe(67);
    expect(resurrectCost(10)).toBe(750);
    expect(resurrectCost(90)).toBe(50000);
  });

  // 출처: SUNITDMG_ComputeExperienceGain — 한 번에 (Exp(L+1) − Exp(L)) >> 6, 용병이 죽인 게 아니면 × 86 / 256
  it('용병 경험치 상한', () => {
    const r = db.byIdAndLevel(0, 3)!;
    expect(mercExpGain(1000, 3, r, true)).toBe((8000 - 3600) >>> 6);
    expect(mercExpGain(1000, 3, r, false)).toBe(Math.trunc((86 * ((8000 - 3600) >>> 6)) / 256));
    expect(mercExpGain(10, 3, r, true)).toBe(10);
  });
});

d('고용·따라오기·공격·저장', () => {
  // 출처: sub_6FCC7FA0 — Kashya: 플레이어 레벨 8 미만이고 A1Q2 보상 전이면 거절
  it('레벨 1 은 Blood Raven 퀘스트 전 고용 불가', () => {
    const g = makeGame({ level: 1, gold: 5000 });
    toKashya(g);
    g.enqueue({ type: 'npcMenu', option: 'hire' });
    g.tick();
    const c = g.snapshot().interaction!.hire[0]!;
    g.enqueue({ type: 'hire', index: c.index });
    const ev = g.tick();
    expect(ev.some((e) => e.type === 'hireFailed' && e.reason === 'locked')).toBe(true);
    expect(g.merc).toBeNull();
    expect(g.gold).toBe(5000);
  });

  it('고용: 목록 가격만큼 골드가 줄고 Kashya 곁에 용병, 목록에서 빠진다', () => {
    const g = makeGame({ level: 9, gold: 5000 });
    const k = toKashya(g);
    g.enqueue({ type: 'npcMenu', option: 'hire' });
    g.tick();
    const list = g.snapshot().interaction!.hire;
    expect(list.length).toBe(10);
    const c = list[0]!;
    g.enqueue({ type: 'hire', index: c.index });
    g.tick();
    expect(g.gold).toBe(5000 - c.init.gold);
    const u = g.mercUnit()!;
    expect(u.type.id).toBe('roguehire');
    expect(Math.hypot(u.x - k.x, u.y - k.y)).toBeLessThan(8);
    expect(g.snapshot().merc).toMatchObject({ name: c.name, level: c.init.level, dead: false });
    expect(u.stats.maxHp).toBe(mercStats(db, c.init.id, c.init.level)!.maxHp);
    expect(g.snapshot().interaction!.hire.some((h) => h.index === c.index)).toBe(false);
  });

  it('용병은 레벨을 옮겨도 따라오고, 멀어지면 달려서 쫓아온다', () => {
    const g = makeGame({ level: 9, gold: 5000 });
    g.hireMerc('merc05', 99, 0, 5, hirelingExp(5, 100), g.snapshot().player.x, g.snapshot().player.y);
    toBloodMoor(g);
    const u = g.mercUnit()!;
    const p = g.snapshot().player;
    expect(Math.hypot(u.x - p.x, u.y - p.y)).toBeLessThan(4);
    // 플레이어가 멀리 걸어가면 (최소 거리 16 을 넘으면) 따라온다
    const lv = g.levelDef('bloodmoor')!;
    const far = nearestWalkable(lv.map, { x: p.x + 40, y: p.y + 10 }, 20)!;
    g.enqueue({ type: 'move', x: far.x + 0.5, y: far.y + 0.5, run: true });
    let maxGap = 0;
    for (let i = 0; i < 500; i++) {
      g.tick();
      const q = g.snapshot().player;
      maxGap = Math.max(maxGap, Math.hypot(u.x - q.x, u.y - q.y));
    }
    const q = g.snapshot().player;
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeGreaterThan(20);
    expect(Math.hypot(u.x - q.x, u.y - q.y)).toBeLessThan(16);
    expect(maxGap).toBeLessThan(40);
  });

  it('용병은 Blood Moor 몬스터에게 화살을 쏘아 피해를 준다 (경험치도 받는다)', () => {
    const g = makeGame({ level: 9, gold: 5000 });
    g.hireMerc('merc05', 99, 0, 5, hirelingExp(5, 100), g.snapshot().player.x, g.snapshot().player.y);
    toBloodMoor(g);
    const p = g.snapshot().player;
    const m = g.spawnMonster('zombie1', p.x + 5, p.y + 4);
    const hp0 = m.hp;
    const shots: string[] = [];
    let hurt = false;
    for (let i = 0; i < 600 && m.mode !== 'DD'; i++) {
      for (const e of g.tick()) {
        if (e.type === 'mercShot') shots.push(String(e.missile));
        if (e.type === 'monsterHit' && e.targetId === m.id) hurt = true;
      }
      // 플레이어는 가만히 있고 몬스터가 플레이어를 때리지 않게 (용병만 공격)
      g.character!.life = g.maxLife();
    }
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((s) => ['rogue1', 'firearrow'].includes(s))).toBe(true);
    expect(hurt || m.hp < hp0).toBe(true);
    if (m.mode === 'DD' || m.mode === 'DT') expect(g.merc!.experience).toBeGreaterThan(hirelingExp(5, 100));
  });

  it('저장 왕복: 이름·시드·종류·레벨·경험치·사망 여부, 예전 저장은 용병 없음', () => {
    const g = makeGame({ level: 9 });
    g.hireMerc('merc07', 4242, 1, 6, hirelingExp(6, 105) + 17, g.snapshot().player.x, g.snapshot().player.y);
    const save = makeSave('Hero', g.character!, 0, { inventory: [], equipment: {}, merc: g.mercSave(), quests: ['a1q2'] });
    const back = parseSave(serializeSave(save));
    expect(back.merc).toEqual({ name: 'merc07', seed: 4242, hirelingId: 1, level: 6, experience: hirelingExp(6, 105) + 17, dead: false });
    expect(back.quests).toEqual(['a1q2']);
    const old = JSON.parse(serializeSave(save)) as Record<string, unknown>;
    delete old.merc;
    delete old.quests;
    const legacy = parseSave(JSON.stringify(old));
    expect(legacy.merc).toBeNull();
    expect(legacy.quests).toEqual([]);
    // 불러온 게임: 같은 레벨 스탯의 용병이 플레이어 곁에
    const g2 = makeGame({ level: 9, merc: back.merc });
    const u = g2.mercUnit()!;
    expect(u.stats.level).toBe(6);
    expect(u.stats.maxHp).toBe(mercStats(db, 1, 6)!.maxHp);
  });

  // 출처: D2GAME_NPC_ResurrectMerc — 죽은 용병만, 비용 15·L²/2, 생명 최대로
  it('죽은 용병은 Kashya 메뉴에 부활이 생기고, 부활 비용을 낸다', () => {
    const g = makeGame({ level: 9, gold: 5000 });
    g.hireMerc('merc05', 99, 0, 7, hirelingExp(7, 100), g.snapshot().player.x, g.snapshot().player.y);
    const u = g.mercUnit()!;
    (g as unknown as { damagePet(p: MonsterUnit, d: Record<string, number>): void }).damagePet(u, { phys: 99999 * 256, fire: 0, ltng: 0, cold: 0, pois: 0, mag: 0, stunLen: 0, coldLen: 0, freezeLen: 0, poisLen: 0, hitClass: 0 });
    expect(g.merc!.dead).toBe(true);
    for (let i = 0; i < 60; i++) g.tick();
    expect(g.mercUnit()).toBeUndefined();
    toKashya(g);
    expect(g.snapshot().interaction!.options).toContain('resurrect');
    g.enqueue({ type: 'npcMenu', option: 'resurrect' });
    g.tick();
    expect(g.gold).toBe(5000 - resurrectCost(7));
    expect(g.merc!.dead).toBe(false);
    const r = g.mercUnit()!;
    expect(r.hp).toBe(r.stats.maxHp);
  });
});
