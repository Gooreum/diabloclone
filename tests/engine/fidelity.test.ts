// Phase 12 Step 1 — 원작 규칙으로 메운 엔진 차이: 스태미나·상태 물약·레벨업 상점 갱신·상자 함정·신전 미사일·거미 점액·Holy Shield·Conversion·
// 면역 저항 감소 1/5·미사일 충돌. 기대값은 원작 excel(charstats / misc / skills / shrines / missiles / monstats)과 D2MOO 규칙에서 유도.
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World } from '../../src/data/act1-world';
import { Game, type GameData, type GameInit, type LevelDef } from '../../src/engine/game';
import { CollisionMap, footprintsOverlap } from '../../src/engine/collision';
import { classStats, createCharacter, expTable, type ClassName } from '../../src/engine/player';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { OBJMODE, type ObjectUnit } from '../../src/engine/objects';
import { nearestWalkable } from '../../src/engine/path';
import type { MonsterUnit } from '../../src/engine/ai/types';
import type { StateList } from '../../src/engine/states';

const d = hasGameData ? describe : describe.skip;

let tables: GameTables;
let data: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
});

/** 빈 방 (가장자리 막힘) */
function openMap(w = 160, h = 60): CollisionMap {
  const m = new CollisionMap(w, h);
  for (let x = 0; x < w; x++) {
    m.block(x, 0);
    m.block(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    m.block(0, y);
    m.block(w - 1, y);
  }
  return m;
}

function item(code: string): ItemInstance {
  const it = data.treasure.createItem(data.items.base(code)!, 5, new Rng(9), QUALITY.NORMAL);
  it.identified = true;
  it.durability = it.maxDurability;
  return it;
}

function makeGame(o: { cls?: ClassName; town?: boolean; levelNo?: number; objects?: LevelDef['objects']; start?: { x: number; y: number }; extra?: Partial<GameInit> } = {}): Game {
  const cls = o.cls ?? 'Barbarian';
  const cs = classStats(tables.table('charstats'), cls);
  const map = openMap();
  const lv: LevelDef = { id: o.town ? 'town' : 'bloodmoor', map, inTown: !!o.town, exits: [], levelNo: o.levelNo ?? (o.town ? 1 : 2), objects: o.objects ?? [] };
  const start = o.start ?? { x: 10.5, y: 30.5 };
  return new Game({
    map, levels: [lv], seed: 7, data, player: { x: start.x, y: start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), cls), ...o.extra,
  });
}

/** 테스트용: 엔진 내부 (private) 접근 */
interface Internals {
  player: { states: StateList; x: number; y: number; mode: string; running: boolean };
  gainExperience(n: number): void;
  playerDefenseValue(): number;
  holyShieldSmite(): { min: number; max: number } | undefined;
  convertLevel(m: MonsterUnit): void;
  monsterResists(m: MonsterUnit): { fi: number; co: number; li: number; po: number; ma: number; dm: number };
  dropSpiderGoo(m: MonsterUnit): void;
  launchMonsterMissile(m: MonsterUnit, name: string, tx: number, ty: number, o: { lvl: number; mode: string }): void;
  stepLength(): number;
}
const priv = (g: Game) => g as unknown as Internals;

const skillRow = (name: string) => tables.table('skills').find((r) => r.skill === name)!;
const num = (v: string | undefined) => Number(v ?? 0) || 0;

d('스태미나 (charstats RunDrain · EVENTS_StaminaRegen)', () => {
  // 출처: charstats.txt Barbarian stamina 92, RunDrain 20 → 달리는 프레임마다 2 × 20 = 40 (1/256) 소모 (PlrModes.cpp sub_6FC7F780)
  it('필드에서 달리면 프레임마다 2 × RunDrain / 256 씩 줄고, 달리는 동안은 회복하지 않는다', () => {
    const g = makeGame();
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    expect(cs.runDrain).toBe(20);
    const c = g.character!;
    expect(c.stamina).toBe(92);
    g.enqueue({ type: 'move', x: 150, y: 30, run: true });
    let frames = 0;
    for (let i = 0; i < 60; i++) {
      g.tick();
      if (g.snapshot().player.mode === 'RN') frames++;
    }
    expect(frames).toBe(60);
    expect(c.stamina * 256).toBe(92 * 256 - 60 * 40);
    expect(g.snapshot().player.stamina).toBeCloseTo(92 - (60 * 40) / 256, 6);
  });

  // 출처: EVENTS_StaminaRegen — 서 있음 max(1/256) >> 8, 걷기 >> 9
  it('서 있으면 최대 >> 8, 걸으면 최대 >> 9 (1/256) 씩 회복', () => {
    const g = makeGame();
    const c = g.character!;
    c.stamina = 50;
    g.tick();
    expect(c.stamina * 256).toBe(50 * 256 + ((92 * 256) >> 8));
    g.enqueue({ type: 'move', x: 150, y: 30, run: false });
    g.tick();
    const s0 = c.stamina * 256;
    g.tick();
    expect(g.snapshot().player.mode).toBe('WL');
    expect(c.stamina * 256 - s0).toBe((92 * 256) >> 9);
  });

  // 출처: sub_6FC7F780 — 몸 방어구 armor.txt speed (판금 plt = 10) → × (10 / 10 + 1)
  it('무거운 몸 방어구(speed 10)는 소모 × 2', () => {
    const g = makeGame({ extra: { equipment: { tors: item('plt') } } });
    const c = g.character!;
    g.enqueue({ type: 'move', x: 150, y: 30, run: true });
    for (let i = 0; i < 10; i++) g.tick();
    expect(c.stamina * 256).toBe(92 * 256 - 10 * 80);
  });

  // 출처: sub_6FC7F780 — 0 이 되면 걷기로 (sub_6FC7F600(PLRMODE_WALK)), 걷는 중 스태미나 1 미만이면 회복 없음, 0 이면 달리기 명령도 걷기
  it('스태미나가 0 이 되면 걷기로 바뀌고, 걷는 동안은 회복하지 않으며, 다시 달리려 해도 걷는다', () => {
    const g = makeGame();
    const c = g.character!;
    c.stamina = 60 / 256;
    g.enqueue({ type: 'move', x: 150, y: 30, run: true });
    const evs: string[] = [];
    for (let i = 0; i < 3; i++) for (const e of g.tick()) evs.push(e.type);
    expect(evs).toContain('staminaOut');
    expect(c.stamina).toBe(0);
    expect(g.snapshot().player.mode).toBe('WL');
    expect(g.snapshot().player.running).toBe(false);
    for (let i = 0; i < 20; i++) g.tick();
    expect(c.stamina).toBe(0);
    g.enqueue({ type: 'move', x: 150, y: 35, run: true });
    g.tick();
    expect(g.snapshot().player.mode).toBe('WL');
  });

  // 출처: sub_6FC7F780 — !DUNGEON_IsRoomInTown 일 때만 소모
  it('마을에서는 달려도 줄지 않는다', () => {
    const g = makeGame({ town: true });
    g.enqueue({ type: 'move', x: 150, y: 30, run: true });
    for (let i = 0; i < 40; i++) g.tick();
    expect(g.snapshot().player.mode).toBe('RN');
    expect(g.character!.stamina).toBe(92);
  });

  // 출처: skills.txt Increased Stamina passivestat1 skill_passive_staminapercent = ln12, itemstatcost op 1 → maxstamina %
  it('Increased Stamina (바바리안 패시브) 는 최대 스태미나 % 증가, 장비 maxstamina 도 더한다', () => {
    const r = skillRow('Increased Stamina');
    const pct = num(r.Param1) + 2 * num(r.Param2);
    const ring = item('rin');
    ring.stats.push({ stat: 'maxstamina', param: 0, value: 10 });
    const g = makeGame({ extra: { equipment: { rrin: ring } } });
    g.character!.skills[num(r.Id)] = 3;
    g.tick();
    expect(g.maxStamina()).toBeCloseTo(((92 + 10) * (100 + pct)) / 100, 6);
    expect(g.snapshot().player.maxStamina).toBeCloseTo(g.maxStamina(), 6);
  });
});

d('상태 물약 (misc.txt vps / yps / wms)', () => {
  function potionGame(code: string): { g: Game; pot: ItemInstance } {
    const pot = item(code);
    const g = makeGame({ extra: { inventory: [pot] } });
    g.tick();
    return { g, pot };
  }

  // 출처: misc.txt vps — pSpell 9, state staminapot, len 750, stat1 staminarecoverybonus calc1 5000 (SKILLITEM_pSpell09_StaminaPotion)
  it('스태미나 물약: staminapot 750 프레임, 회복 +5000 % → 달려도 줄지 않음', () => {
    const { g, pot } = potionGame('vps');
    const b = data.items.base('vps')!;
    expect(b).toMatchObject({ pSpell: 9, useState: 'staminapot', useLen: 750 });
    expect(b.useStats).toEqual([{ stat: 'staminarecoverybonus', calc: 5000 }]);
    const c = g.character!;
    c.stamina = 30;
    const t0 = g.frame;
    g.enqueue({ type: 'useItem', itemId: pot.id });
    g.tick();
    const st = g.playerState('staminapot')!;
    expect(st.stats).toEqual({ staminarecoverybonus: 5000 });
    expect(st.until).toBe(t0 + 750);
    expect(c.stamina).toBeGreaterThanOrEqual(92);
    g.enqueue({ type: 'move', x: 150, y: 30, run: true });
    for (let i = 0; i < 200; i++) g.tick();
    expect(g.snapshot().player.mode).toBe('RN');
    expect(c.stamina).toBeGreaterThanOrEqual(91.8);
  });

  // 출처: misc.txt yps — pSpell 6, cstate1 poison, state antidote, poisonresist 50, maxpoisonresist 10 (SKILLITEM_pSpell09_AntidoteThawingPotion)
  it('해독 물약: 중독을 풀고 독 저항 +50 (최대 +10), 750 프레임', () => {
    const { g, pot } = potionGame('yps');
    const b = data.items.base('yps')!;
    expect(b).toMatchObject({ pSpell: 6, useState: 'antidote', useLen: 750, cureStates: ['poison'] });
    priv(g).player.states.set('poison', g.frame + 500, { hpregen: -100 });
    g.enqueue({ type: 'useItem', itemId: pot.id });
    g.tick();
    expect(g.playerState('poison')).toBeUndefined();
    expect(g.playerState('antidote')!.stats).toEqual({ poisonresist: 50, maxpoisonresist: 10 });
    expect(g.playerResist('poisonresist')).toBe(50);
  });

  // 출처: misc.txt wms — pSpell 6, cstate1 freeze, cstate2 cold, state thawing, coldresist 50, maxcoldresist 10
  it('해동 물약: 빙결·냉기를 풀고 냉기 저항 +50 (최대 +10)', () => {
    const { g, pot } = potionGame('wms');
    expect(data.items.base('wms')!.cureStates).toEqual(['freeze', 'cold']);
    priv(g).player.states.set('cold', g.frame + 100, { velocitypercent: -50 });
    priv(g).player.states.set('freeze', g.frame + 100, {});
    g.enqueue({ type: 'useItem', itemId: pot.id });
    g.tick();
    expect(g.playerState('cold')).toBeUndefined();
    expect(g.playerState('freeze')).toBeUndefined();
    expect(g.playerState('thawing')!.stats).toEqual({ coldresist: 50, maxcoldresist: 10 });
    expect(g.playerResist('coldresist')).toBe(50);
  });

  it('같은 상태 물약을 또 마시면 남은 끝 프레임 + len', () => {
    const a = item('vps'), b = item('vps');
    const g = makeGame({ extra: { inventory: [a, b] } });
    g.tick();
    const t0 = g.frame;
    g.enqueue({ type: 'useItem', itemId: a.id });
    g.tick();
    g.enqueue({ type: 'useItem', itemId: b.id });
    g.tick();
    expect(g.playerState('staminapot')!.until).toBe(t0 + 1500);
  });
});

d('레벨업 (PLAYERSTATS_LevelUp)', () => {
  it('레벨업하면 생명·마나·스태미나가 최대로 찬다', () => {
    const g = makeGame();
    const c = g.character!;
    c.life = 10;
    c.mana = 1;
    c.stamina = 5;
    priv(g).gainExperience(600);
    expect(c.level).toBe(2);
    expect(c.life).toBe(g.maxLife());
    expect(c.mana).toBe(g.maxMana());
    expect(c.stamina).toBe(g.maxStamina());
  });

  // 출처: SUnitProxy.cpp SUNITPROXY_InitializeNpcControl — bLevelRefresh: Charsi·Gheed = 1, Akara = 0. PLAYERSTATS_LevelUp → SUNITPROXY_InitializeNpcEventChain
  it('레벨업하면 Charsi·Gheed 재고가 새로 채워지고 Akara 는 그대로', () => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    const w = buildAct1World(gameChain(), tables, data, 4242);
    const g = new Game({
      map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), seed: 4242, data,
      player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
      character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
    });
    g.tick();
    const open = (id: string, option: 'trade' | 'tradeRepair') => {
      const n = g.npcs.find((x) => x.type.id === id)!;
      const spot = nearestWalkable(g.map, { x: n.x + 3, y: n.y + 1 }, 8)!;
      g.changeLevel(g.levelId, spot.x + 0.5, spot.y + 0.5);
      g.enqueue({ type: 'interact', unitId: n.id });
      for (let i = 0; i < 300 && !g.snapshot().interaction; i++) g.tick();
      g.enqueue({ type: 'npcMenu', option });
      g.tick();
      const ids = g.snapshot().interaction!.store.map((s) => s.item.id);
      g.enqueue({ type: 'closeNpc' });
      g.tick();
      return ids;
    };
    const charsi0 = open('charsi', 'tradeRepair'), gheed0 = open('gheed', 'trade'), akara0 = open('akara', 'trade');
    expect(charsi0.length).toBeGreaterThan(0);
    priv(g).gainExperience(600);
    g.tick();
    expect(g.character!.level).toBe(2);
    expect(open('charsi', 'tradeRepair')).not.toEqual(charsi0);
    expect(open('gheed', 'trade')).not.toEqual(gheed0);
    expect(open('akara', 'trade')).toEqual(akara0);
  });

  it('거래 창이 열린 채로 레벨업하면 창을 닫을 때 갱신', () => {
    const svc = new (makeGame().npc.constructor as new (seed: number) => Game['npc'])(1);
    svc.stores.set('charsi', []);
    svc.stores.set('akara', []);
    expect(svc.levelUp('charsi')).toEqual(['charsi']);
    expect(svc.stores.has('charsi')).toBe(true);
    svc.endTrade('charsi');
    expect(svc.stores.has('charsi')).toBe(false);
    expect(svc.stores.has('akara')).toBe(true);
  });
});

d('상자 함정 (D2GAME_SetTrapCallback · sub_6FC74DF0)', () => {
  function chestGame(trap: number, levelNo = 2): { g: Game; chest: ObjectUnit } {
    const g = makeGame({ levelNo, objects: [{ classId: 5, x: 20, y: 30 }], start: { x: 18.5, y: 30.5 } });
    g.tick();
    const chest = g.objects.find((o) => o.type.id === 5)!;
    chest.interact = trap;
    return { g, chest };
  }

  // 출처: D2GAME_SetTrapCallback — 35 프레임 뒤 EVENTTYPE_TRAP, 2 = trap-firebolt (MissA1 trapfirebolt, 화염 lvl>>1 ~ 3·lvl>>1)
  it('화염탄 함정(2): 연 뒤 35 프레임에 trapfirebolt 를 쏘고 플레이어가 화염 피해를 받는다', () => {
    const { g, chest } = chestGame(2);
    const t0 = g.frame;
    g.operateObject(chest);
    expect(chest.trapAt).toBe(t0 + 35);
    const evs: { type: string; [k: string]: unknown }[] = [];
    let shotAt = -1;
    for (let i = 0; i < 80; i++) {
      for (const e of g.tick()) {
        evs.push(e);
        if (e.type === 'trapShot') shotAt = g.frame - 1;
      }
      if (shotAt >= 0 && g.snapshot().missiles.some((m) => m.name === 'trapfirebolt')) break;
    }
    expect(shotAt).toBe(t0 + 35);
    expect(evs.find((e) => e.type === 'trapShot')).toMatchObject({ monster: 'trap-firebolt', missile: 'trapfirebolt' });
    for (let i = 0; i < 40; i++) evs.push(...g.tick());
    const hit = evs.find((e) => e.type === 'playerHit');
    expect(hit).toBeDefined();
    expect(Number(hit!.elemental)).toBeGreaterThan(0);
  });

  // 출처: sub_6FC74DF0 — Act 1 (레벨 < 40) 에서 번개(1)·노바(4)·독구름(3, 25 제외) 은 화염탄으로
  it('Act 1 의 번개·노바·독구름 함정은 화염탄이 된다 (탑 지하 5층의 독구름은 그대로)', () => {
    for (const t of [1, 3, 4]) {
      const { g, chest } = chestGame(t);
      g.operateObject(chest);
      const evs: { type: string; [k: string]: unknown }[] = [];
      for (let i = 0; i < 40; i++) evs.push(...g.tick());
      expect(evs.find((e) => e.type === 'trapFired')).toMatchObject({ trap: 2 });
    }
    const { g, chest } = chestGame(3, 25);
    g.operateObject(chest);
    const evs: { type: string; [k: string]: unknown }[] = [];
    for (let i = 0; i < 40; i++) evs.push(...g.tick());
    expect(evs.find((e) => e.type === 'trapFired')).toMatchObject({ trap: 3 });
    expect(evs.find((e) => e.type === 'trapShot')).toMatchObject({ monster: 'trap-poisoncloud' });
  });

  // 출처: D2GAME_OBJECTS_TrapHandler5_7 — 큰 불 162 제자리 + 작은 불 160 (x + 1), 불은 거리 Parm0 + 1 안 플레이어에게 화염 함정 피해
  it('불 함정(5): 큰 불·작은 불 오브젝트가 생기고 곁에 선 플레이어를 태운다', () => {
    const { g, chest } = chestGame(5);
    g.operateObject(chest);
    const evs: { type: string; [k: string]: unknown }[] = [];
    for (let i = 0; i < 36; i++) evs.push(...g.tick());
    expect(g.objects.some((o) => o.type.id === 162)).toBe(true);
    expect(g.objects.some((o) => o.type.id === 160)).toBe(true);
    const big = g.objects.find((o) => o.type.id === 162)!;
    expect(big.mode).toBe(OBJMODE.OPENED);
    g.changeLevel(g.levelId, big.x, big.y + 1);
    for (let i = 0; i < 200; i++) evs.push(...g.tick());
    expect(evs.some((e) => e.type === 'playerHit' && e.source === 'trap' && e.element === 'fire')).toBe(true);
  });

  it('함정 없는 상자(0)는 아무 일도 없다', () => {
    const { g, chest } = chestGame(0);
    g.operateObject(chest);
    const evs: string[] = [];
    for (let i = 0; i < 60; i++) for (const e of g.tick()) evs.push(e.type);
    expect(chest.trapAt).toBeUndefined();
    expect(evs).not.toContain('trapFired');
  });
});

d('신전 미사일·효과 (ObjMode.cpp D2GAME_SHRINES_*)', () => {
  function shrineGame(code: number): { g: Game; s: ObjectUnit } {
    const g = makeGame({ objects: [{ classId: 2, x: 60, y: 30 }], start: { x: 58.5, y: 30.5 } });
    g.tick();
    const s = g.objects.find((o) => o.type.id === 2)!;
    s.interact = code;
    return { g, s };
  }

  // 출처: D2GAME_SHRINES_Stamina — 스태미나 최대, 스탯 162 skill_staminapercent = Arg0 (200), staminarecoverybonus 1000, 4800 프레임
  it('스태미나 신전: 최대 스태미나 +200 %, 회복 +1000 % → 무한 스태미나', () => {
    const { g, s } = shrineGame(14);
    const c = g.character!;
    c.stamina = 10;
    g.operateObject(s);
    const st = g.playerState('shrine_stamina')!;
    expect(st.stats).toEqual({ skill_staminapercent: 200, staminarecoverybonus: 1000 });
    expect(g.maxStamina()).toBe(92 * 3);
    g.enqueue({ type: 'move', x: 150, y: 30, run: true });
    for (let i = 0; i < 150; i++) g.tick();
    expect(g.snapshot().player.mode).toBe('RN');
    expect(c.stamina).toBeGreaterThan(92 * 2);
  });

  // 출처: D2GAME_SHRINES_Storm — 신전에서 파이어볼(62) 16발 (x·y 1..4 → ±5x, ±5y)
  it('폭풍 신전: 신전에서 파이어볼 16발, 주변 몬스터에 맞는다', () => {
    const { g, s } = shrineGame(19);
    const m = g.spawnMonster('zombie1', s.x + 5, s.y + 5);
    g.operateObject(s);
    expect(g.snapshot().missiles.filter((x) => x.name === 'fireball')).toHaveLength(16);
    const hp0 = m.hp;
    for (let i = 0; i < 40; i++) g.tick();
    expect(m.hp).toBeLessThan(hp0);
  });

  // 출처: D2GAME_SHRINES_Exploding / Poison — 물약 Arg0 ~ Arg1 개 + 미사일 45/48 6발
  it('폭발·독 신전: 투척 물약을 떨어뜨리고 신전에서 물약 미사일 6발', () => {
    for (const [code, pot, miss] of [[21, 'opm', 'explosivepotion'], [22, 'gpm', 'chokinggaspoition']] as const) {
      const { g, s } = shrineGame(code);
      g.operateObject(s);
      const snap = g.snapshot();
      expect(snap.missiles.filter((x) => x.name === miss)).toHaveLength(6);
      const n = snap.items.filter((i) => i.code === pot).length;
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(10);
    }
  });

  // 출처: D2GAME_SHRINES_Monster — 가장 가까운 일반 몬스터를 유니크로 (MONFLAG OTHER | UNIQUE)
  it('변환 신전: 가장 가까운 일반 몬스터가 유니크가 된다', () => {
    const { g, s } = shrineGame(20);
    const near = g.spawnMonster('zombie1', 62.5, 30.5);
    const far = g.spawnMonster('zombie1', 90.5, 30.5);
    g.operateObject(s);
    expect(near.flags & 8).toBe(8);
    expect(far.flags & 8).toBe(0);
    expect(near.umods.length).toBeGreaterThan(0);
  });
});

d('거미 점액 (SpiderLay · MISSMODE_SrvHit15/16)', () => {
  // 출처: skills.txt SpiderLay auratargetstate slowed, aurastat1 velocitypercent −100, calc4 20 / 속도 하한 25 % (UNITS_UpdateRunWalkAnimRateAndVelocity)
  it('점액을 밟으면 slowed (velocitypercent −100, 20 프레임) → 걷기 속도의 25 %', () => {
    const g = makeGame();
    g.tick();
    const walk = priv(g).stepLength();
    const m = g.spawnMonster('arach1', 10.5, 30.5);
    priv(g).dropSpiderGoo(m);
    g.monsters.splice(0);
    const lay = data.missiles.get('spidergoolay')!;
    for (let i = 0; i <= lay.range; i++) g.tick();
    expect(g.snapshot().missiles.some((x) => x.name === 'spidergoo')).toBe(true);
    g.tick();
    const st = g.playerState('slowed')!;
    expect(st.stats).toEqual({ velocitypercent: -100 });
    expect(st.until - g.frame).toBeLessThanOrEqual(20);
    expect(priv(g).stepLength()).toBeCloseTo(walk * 0.25, 6);
  });
});

d('Holy Shield · Smite', () => {
  // 출처: D2MOO Units.cpp UNITS_GetDefense — holyshield 상태 + 방패 → 방어 % += calc1 (ln34 + Defiance 시너지)
  //       SkillPal.cpp SKILLS_SrvDo150_Smite — 방패 피해 + Holy Shield MinDam/MaxDam (+ 레벨당)
  it('방어 % 증가와 Smite 추가 피해', () => {
    const g = makeGame({ cls: 'Paladin', extra: { equipment: { larm: item('kit') } } });
    g.tick();
    const r = skillRow('Holy Shield');
    const lvl = 5;
    const def0 = priv(g).playerDefenseValue();
    priv(g).player.states.set('holyshield', Infinity, { toblock: 20 }, { id: num(r.Id), lvl });
    const pct = num(r.Param3) + (lvl - 1) * num(r.Param4);
    expect(pct).toBeGreaterThan(0);
    const base = g.derived()!.defense;
    expect(priv(g).playerDefenseValue()).toBe(Math.trunc((base * (100 + pct)) / 100));
    expect(priv(g).playerDefenseValue()).toBeGreaterThan(def0);
    // MinDam 3 + 4 × MinLevDam1 2 = 11, MaxDam 6 + 4 × 2 = 14 (HitShift 8 → × 256)
    const add = (lv: number, base0: number, per: number) => (base0 + (lv - 1) * per) * 256;
    expect(priv(g).holyShieldSmite()).toEqual({ min: add(lvl, num(r.MinDam), num(r.MinLevDam1)), max: add(lvl, num(r.MaxDam), num(r.MaxLevDam1)) });
    // 방패가 없으면 방어 보너스 없음
    const g2 = makeGame({ cls: 'Paladin' });
    g2.tick();
    const d0 = priv(g2).playerDefenseValue();
    priv(g2).player.states.set('holyshield', Infinity, {}, { id: num(r.Id), lvl });
    expect(priv(g2).playerDefenseValue()).toBe(d0);
  });
});

d('Conversion (SKILLS_SrvDo079_Conversion)', () => {
  it('대상 레벨이 높으면 플레이어 레벨로 낮추고 생명 비례 축소, 풀리면 되돌린다', () => {
    const g = makeGame({ cls: 'Paladin' });
    g.tick();
    const m = g.spawnMonster('zombie1', 30.5, 30.5);
    m.stats = { ...m.stats, level: 10, maxHp: 100 };
    m.hp = 80;
    m.states.set('weaken', g.frame + 500, { damagepercent: -33 });
    m.states.set('conversion', g.frame + 5, {});
    priv(g).convertLevel(m);
    expect(m.stats.level).toBe(1);
    expect(m.stats.maxHp).toBe(10);
    expect(m.hp).toBe(8);
    expect(m.states.has('weaken')).toBe(false);
    m.hp = 5;
    for (let i = 0; i < 6; i++) g.tick();
    expect(m.states.has('conversion')).toBe(false);
    expect(m.stats.level).toBe(10);
    expect(m.stats.maxHp).toBe(100);
    // 생명 = 원래 최대 100 × 지금 생명 5 / 지금 최대 10 (그 뒤 한 프레임 재생)
    expect(Math.floor(m.hp)).toBe(50);
  });
});

d('면역 몬스터의 저항 감소 (SkillNec.cpp sub_6FD0B450 / sub_6FD0B3D0)', () => {
  it('기본 저항 100 이상이면 Lower Resist·Conviction 감소는 1/5 만', () => {
    const g = makeGame();
    const m = g.spawnMonster('zombie1', 30.5, 30.5);
    m.resist.fi = 100;
    m.resist.co = 50;
    m.states.set('lowerresist', g.frame + 100, { fireresist: -50, coldresist: -50 });
    m.states.set('conviction', g.frame + 100, { fireresist: -26 });
    const r = priv(g).monsterResists(m);
    expect(r.fi).toBe(100 - 10 - 5);
    expect(r.co).toBe(0);
  });
});

d('미사일 충돌 (D2Collision.cpp 크기 패턴)', () => {
  // 크기 1 = 한 칸, 2 = 십자, 3 = 3×3
  it('유닛 크기 패턴이 겹칠 때만 충돌', () => {
    expect(footprintsOverlap(5.5, 5.5, 1, 5.9, 5.1, 1)).toBe(true);
    expect(footprintsOverlap(5.5, 5.5, 1, 6.5, 5.5, 1)).toBe(false);
    expect(footprintsOverlap(5.5, 5.5, 1, 6.5, 5.5, 2)).toBe(true);
    expect(footprintsOverlap(5.5, 5.5, 1, 6.5, 6.5, 2)).toBe(false);
    expect(footprintsOverlap(5.5, 5.5, 1, 6.5, 6.5, 3)).toBe(true);
    expect(footprintsOverlap(5.5, 5.5, 2, 7.5, 5.5, 2)).toBe(true);
    expect(footprintsOverlap(5.5, 5.5, 2, 7.5, 6.5, 2)).toBe(false);
  });

  it('전향된 몬스터의 미사일은 다른 몬스터를 맞히고 플레이어는 맞히지 않는다', () => {
    const g = makeGame({ start: { x: 40.5, y: 20.5 } });
    g.tick();
    const archer = g.spawnMonster('cr_archer1', 20.5, 30.5);
    const target = g.spawnMonster('zombie1', 30.5, 30.5);
    archer.states.set('conversion', Infinity, {});
    const hp0 = target.hp;
    const evs: string[] = [];
    priv(g).launchMonsterMissile(archer, 'cr_arrow1', target.x, target.y, { lvl: 1, mode: 'A1' });
    for (let i = 0; i < 40; i++) for (const e of g.tick()) evs.push(e.type);
    expect(evs).toContain('monsterMissileHitMonster');
    expect(target.hp).toBeLessThan(hp0);
    expect(evs).not.toContain('playerHit');
  });
});
