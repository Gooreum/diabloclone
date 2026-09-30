// Act 2 사막 용병(Greiz)·Act 3 철늑대(Asheara) — Phase 6 Step 2.
// 기대값 출처: hireling.txt 클래식(Version 0) 행 — Desert Mercenary Id 6 Comb(Prayer)/7 Def(Defiance)/8 Off(Blessed Aim) Normal Level 9 Gold 350
//             (Nightmare Id 9 Thorns/10 Holy Freeze/11 Might, Hell Id 12~14), Class 338 act2hire, Seller 198 Greiz, merca201~merca221, HireDesc comb/def/off;
//             Eastern Sorceror Id 15 Fire(Inferno·Fire Ball)/16 Cold(Glacial Spike·Frozen Armor·Ice Blast)/17 Lightning(Charged Bolt·Lightning) Level 15 Gold 1000,
//             Class 359 act3hire, Seller 252 Asheara; Act 4 행 없음,
//             D2MOO AiThink.cpp AITHINK_Fn061_Hireable / sub_6FCE4610 / sub_6FCE4830 (오라 = D2GAME_AssignSkill), MonsterAI.cpp MONSTERAI_UpdateMercStatsAndSkills,
//             SUnitNpc.cpp D2GAME_NPC_ResurrectMerc (KASHYA·GREIZ·ASHEARA·TYRAEL2), skills.txt Prayer(hitpoints)·Defiance(skill_armor_percent)·Blessed Aim(item_tohit_percent)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { actLevels, buildActWorld } from '../../src/data/world';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { nearestWalkable } from '../../src/engine/path';
import { hirelingInit, mercStats, resurrectCost, type HirelingDb, type MercSave } from '../../src/engine/hireling';
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

function makeGame(act: number, opts: { level?: number; gold?: number; merc?: MercSave | null; seed?: number } = {}): Game {
  const cs = classStats(tables.table('charstats'), 'Paladin');
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 20;
  const seed = opts.seed ?? 4040;
  const w = buildActWorld(gameChain(), tables, data, seed, act);
  const g = new Game({
    map: w.byKey.get(w.townId)!.def.map, levels: w.levels.map((l) => l.def), act, seed, data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Paladin'), gold: opts.gold ?? 0, merc: opts.merc ?? null,
  });
  g.onActChange = (a) => actLevels(buildActWorld(gameChain(), tables, data, seed, a));
  g.tick();
  return g;
}

function talkTo(g: Game, id: string): MonsterUnit {
  const n = g.npcs.find((x) => x.type.id === id)!;
  const spot = nearestWalkable(g.map, { x: n.x + 2, y: n.y + 1 }, 8)!;
  g.changeLevel(g.levelId, spot.x + 0.5, spot.y + 0.5);
  g.enqueue({ type: 'interact', unitId: n.id });
  for (let i = 0; i < 300 && g.snapshot().interaction?.typeId !== id; i++) g.tick();
  expect(g.snapshot().interaction?.typeId).toBe(id);
  return n;
}

function hireFirst(g: Game, npc: string): void {
  talkTo(g, npc);
  g.enqueue({ type: 'npcMenu', option: 'hire' });
  g.tick();
  const c = g.snapshot().interaction!.hire[0]!;
  g.enqueue({ type: 'hire', index: c.index });
  g.tick();
}

/** 막 야외 레벨의 트인 곳으로 옮기고 몬스터를 치운 뒤, 가만히 있는 튼튼한 과녁 몬스터 하나 */
function toField(g: Game, levelId: string, target: string): MonsterUnit {
  const m = g.levelDef(levelId)!.map;
  let spot: { x: number; y: number } | null = null;
  for (let y = 20; y < m.height - 20 && !spot; y += 3)
    for (let x = 20; x < m.width - 20 && !spot; x += 3) {
      let ok = true;
      for (let dy = -7; dy <= 7 && ok; dy++) for (let dx = -7; dx <= 7 && ok; dx++) if (!m.walkable(x + dx, y + dy)) ok = false;
      if (ok) spot = { x, y };
    }
  g.changeLevel(levelId, spot!.x + 0.5, spot!.y + 0.5);
  g.tick();
  g.monsters.splice(0);
  const t = g.spawnMonster(target, spot!.x + 4.5, spot!.y + 0.5);
  t.stats = { ...t.stats, maxHp: 1e7 };
  t.hp = 1e7;
  t.nextThink = 1e9;
  return t;
}

d('hireling.txt Act 2·3 (클래식)', () => {
  it('Greiz(198) 는 사막 용병 (act2hire 338), Asheara(252) 는 철늑대 (act3hire 359), Act 4 는 없다', () => {
    const a2 = db.byVendor(data.monsters.get('greiz').hcIdx, 0)!;
    expect(a2).toMatchObject({ cls: 338, act: 2, level: 9, gold: 350 });
    expect(a2.names[0]).toBe('merca201');
    const a3 = db.byVendor(data.monsters.get('asheara').hcIdx, 0)!;
    expect(a3).toMatchObject({ cls: 359, act: 3, level: 15, gold: 1000 });
    expect(db.byAct(3, 0)).toBeUndefined();
  });

  // 출처: DATATBLS_GetNextHirelingTxtRecordFromActAndDifficulty — 막·난이도가 같은 첫 레벨 행들
  it('난이도별 종류: 보통 Prayer·Defiance·Blessed Aim / 악몽 Thorns·Holy Freeze·Might / 지옥 Prayer·Defiance·Blessed Aim', () => {
    const aurasOf = (diff: number) => {
      const out: string[] = [];
      for (let r = db.byAct(1, diff); r; r = db.byAct(1, diff, r)) out.push(r.skills[1]!.name);
      return out;
    };
    expect(aurasOf(0)).toEqual(['Prayer', 'Defiance', 'Blessed Aim']);
    expect(aurasOf(1)).toEqual(['Thorns', 'Holy Freeze', 'Might']);
    expect(aurasOf(2)).toEqual(['Prayer', 'Defiance', 'Blessed Aim']);
    const elems = (diff: number) => {
      const out: string[] = [];
      for (let r = db.byAct(2, diff); r; r = db.byAct(2, diff, r)) out.push(r.skills.map((s) => s.name).join('+'));
      return out;
    };
    expect(elems(0)).toEqual(['Inferno+Fire Ball', 'Glacial Spike+Frozen Armor+Ice Blast', 'Charged Bolt+Lightning']);
  });

  // 출처: MONSTERAI_UpdateMercStatsAndSkills — 스킬 레벨 = Level + (levelUps × LvlPerLvl >> 5), skills.txt reqlevel 이상
  it('레벨별 스킬: 사막 용병 9 레벨 Jab 3 · 오라 3, 철늑대 불 15 레벨 Inferno 6 · Fire Ball 4', () => {
    const req = (sk: string) => data.skills?.byNameOf(sk)?.reqLevel ?? 0;
    expect(mercStats(db, 6, 9, req)!.skills.map((s) => [s.name, s.level])).toEqual([['Jab', 3], ['Prayer', 3]]);
    expect(mercStats(db, 7, 9, req)!.skills.map((s) => [s.name, s.level])).toEqual([['Jab', 3], ['Defiance', 3]]);
    expect(mercStats(db, 15, 15, req)!.skills.map((s) => [s.name, s.level])).toEqual([['Inferno', 6], ['Fire Ball', 4]]);
  });

  // 출처: MONSTERS_HirelingInit — Gold × (15·levelUps + 100) / 100
  it('고용 가격', () => {
    for (let s = 1; s < 30; s++) {
      const hi = hirelingInit(db, s * 104729, 30, 1, 0)!;
      expect([6, 7, 8]).toContain(hi.id);
      expect(hi.gold).toBe(Math.trunc((350 * (15 * (hi.level - 9) + 100)) / 100));
    }
  });
});

d('Act 2·3 용병 고용·오라·스킬·저장', () => {
  it('Greiz 고용 → act2hire (근접), 싸우면 오라를 켜고 플레이어도 오라를 받는다', () => {
    const g = makeGame(1, { gold: 50000 });
    hireFirst(g, 'greiz');
    const u = g.mercUnit()!;
    expect(u.type.id).toBe('act2hire');
    expect(g.snapshot().merc).toMatchObject({ typeId: 'act2hire' });
    expect(g.gold).toBeLessThan(50000);
    const id = g.merc!.hirelingId;
    const state = ({ 6: 'prayer', 7: 'defiance', 8: 'blessedaim' } as Record<number, string>)[id]!;
    toField(g, 'rockywaste', 'sandraider1');
    let aura = false, hit = false;
    for (let i = 0; i < 3000 && !(aura && hit); i++) {
      for (const e of g.tick()) {
        if (e.type === 'mercAura') aura = true;
        if (e.type === 'mercHit' || e.type === 'mercMiss' || e.type === 'mercSkill') hit = true;
      }
      // 과녁 곁에 붙어 있게: 플레이어는 가만히
    }
    expect(hit).toBe(true);
    expect(aura).toBe(true);
    for (let i = 0; i < 60; i++) g.tick();
    expect(g.mercUnit()!.states.has(state)).toBe(true);
    expect(g.playerState(state)).toBeTruthy();
  });

  it('Asheara 고용 → act3hire, 원소 주문을 쏜다 (주문은 무기 피해 없음)', () => {
    const g = makeGame(2, { gold: 50000 });
    hireFirst(g, 'asheara');
    const u = g.mercUnit()!;
    expect(u.type.id).toBe('act3hire');
    const names = g.mercSave() ? (mercStats(db, g.merc!.hirelingId, g.merc!.level)!.skills.map((s) => s.name)) : [];
    toField(g, 'spiderforest', 'fetish1');
    const cast = new Set<string>();
    for (let i = 0; i < 3000 && cast.size === 0; i++) {
      for (const e of g.tick()) if (e.type === 'mercShot' || e.type === 'mercSkill') cast.add(String(e.skill));
    }
    expect(cast.size).toBeGreaterThan(0);
    for (const s of cast) expect(names).toContain(s);
  });

  it('용병은 막을 넘어 따라오고, 저장 → 불러오기 뒤에도 같은 종류·레벨', () => {
    const g = makeGame(1, { gold: 50000 });
    hireFirst(g, 'greiz');
    const lvl = g.merc!.level;
    talkTo(g, 'warriv2');
    g.enqueue({ type: 'npcMenu', option: 'goWest' });
    g.tick();
    expect(g.act).toBe(0);
    expect(g.mercUnit()?.type.id).toBe('act2hire');
    const sv = parseSave(serializeSave(makeSave('x', g.character!, g.gold, { inventory: [], equipment: {}, merc: g.mercSave() })))!;
    expect(sv.merc).toMatchObject({ hirelingId: g.merc!.hirelingId, level: lvl, dead: false });
    const g2 = makeGame(2, { merc: sv.merc });
    expect(g2.mercUnit()?.type.id).toBe('act2hire');
    expect(g2.merc!.level).toBe(lvl);
  });

  // 출처: D2GAME_NPC_ResurrectMerc — GREIZ·ASHEARA·TYRAEL2 도 부활
  it('죽은 용병: Greiz·Tyrael 메뉴에 부활', () => {
    const g = makeGame(1, { gold: 50000 });
    hireFirst(g, 'greiz');
    const u = g.mercUnit()!;
    (g as unknown as { damagePet(p: MonsterUnit, d: Record<string, number>): void }).damagePet(u, { phys: 99999 * 256, fire: 0, ltng: 0, cold: 0, pois: 0, mag: 0, stunLen: 0, coldLen: 0, freezeLen: 0, poisLen: 0, hitClass: 0 });
    expect(g.merc!.dead).toBe(true);
    for (let i = 0; i < 60; i++) g.tick();
    talkTo(g, 'greiz');
    expect(g.snapshot().interaction!.options).toEqual(['talk', 'hire', 'resurrect', 'cancel']);
    const gold = g.gold;
    g.enqueue({ type: 'npcMenu', option: 'resurrect' });
    g.tick();
    expect(g.gold).toBe(gold - resurrectCost(g.merc!.level));
    expect(g.mercUnit()?.type.id).toBe('act2hire');
    // Act 4 Tyrael
    const g4 = makeGame(3, { gold: 50000, merc: { ...g.mercSave()!, dead: true } });
    talkTo(g4, 'tyrael2');
    expect(g4.snapshot().interaction!.options).toEqual(['talk', 'resurrect', 'cancel']);
    g4.enqueue({ type: 'npcMenu', option: 'resurrect' });
    g4.tick();
    expect(g4.mercUnit()?.type.id).toBe('act2hire');
  });
});
