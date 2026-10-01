// Act 2~4 마을 NPC·상점·치료·수리·감정·막 이동 (Phase 6 Step 1).
// 기대값 출처: MonPreset.txt Act 2~4 (마을 DS1 프리셋 → drognan·fara·elzix·lysander·greiz·geglash·atma·meshif1·warriv2·cain2 /
//             alkor·ormus·asheara·natalya·meshif2·cain3 / tyrael2·jamella·halbu·cain4),
//             objects.txt 121·122 jerhyn (InitFn 18·19), 378·379 (InitFn 49·50 Hratli), 267 bank (보관함), 156·237·398 웨이포인트,
//             D2MOO SUnitNpc.cpp NPC_HandleDialogMessage (상점·도박·막 이동 WARRIV1 A1Q6 / MESHIF1 A2Q6), D2GAME_NPC_Repair (FARA·HRATLI·HALBU),
//             D2GAME_NPC_Heal (ATMA·FARA·ORMUS·JAMELLA), D2GAME_NPC_IdentifyAllItems (CAIN2~4), SUnitProxy.cpp SUNITPROXY_InitializeNpcControl (bLevelRefresh),
//             sub_6FCC7FA0 / FillStoreInventory npcLevels {12, 20, 28, 36, 45} (보통 난이도 막별 상점 아이템 레벨 상한),
//             levels.txt Waypoint (Lut Gholein 9, Kurast Docks 18, Pandemonium Fortress 27)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { actLevels, buildActWorld } from '../../src/data/world';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { nearestWalkable } from '../../src/engine/path';
import { QFLAG } from '../../src/engine/quests/record';
import { LEVEL_REFRESH, NPC_DEFS, QUESTFLAG_A2Q0, QUESTFLAG_A2Q6, QUESTFLAG_A3Q0, QUESTFLAG_A3Q6, type NpcOption } from '../../src/engine/npc';
import type { MonsterUnit } from '../../src/engine/ai';
import { QUALITY } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';

const d = hasGameData ? describe : describe.skip;

let tables: GameTables;
let data: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
});

/** act 마을에서 시작하는 게임 (다른 막은 요청하면 원작 DRLG 로 만든다) */
function makeGame(act: number, opts: { level?: number; gold?: number; seed?: number } = {}): Game {
  const cs = classStats(tables.table('charstats'), 'Sorceress');
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 1;
  const seed = opts.seed ?? 606;
  const w = buildActWorld(gameChain(), tables, data, seed, act);
  const g = new Game({
    map: w.byKey.get(w.townId)!.def.map, levels: w.levels.map((l) => l.def), act, seed, data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Sorceress'), gold: opts.gold ?? 0,
  });
  g.onActChange = (a) => actLevels(buildActWorld(gameChain(), tables, data, seed, a));
  g.tick();
  return g;
}

const npcOf = (g: Game, id: string) => g.npcs.find((n) => n.type.id === id) as MonsterUnit;

function talkTo(g: Game, id: string): MonsterUnit {
  const n = npcOf(g, id);
  expect(n, id).toBeTruthy();
  const spot = nearestWalkable(g.map, { x: n.x + 2, y: n.y + 1 }, 8)!;
  g.changeLevel(g.levelId, spot.x + 0.5, spot.y + 0.5);
  g.enqueue({ type: 'interact', unitId: n.id });
  for (let i = 0; i < 300 && g.snapshot().interaction?.typeId !== id; i++) g.tick();
  expect(g.snapshot().interaction?.typeId).toBe(id);
  return n;
}

function choose(g: Game, option: NpcOption) {
  g.enqueue({ type: 'npcMenu', option });
  return g.tick();
}

const interactNpcs = (g: Game) => g.npcs.filter((n) => n.npc?.interact).map((n) => n.type.id).sort();

d('Act 2~4 마을 NPC 배치', () => {
  it('Lut Gholein: 원작 NPC 전부 (Jerhyn·Kaelan 은 퀘스트 오브젝트 자리)', () => {
    const g = makeGame(1);
    expect(interactNpcs(g)).toEqual(['act2guard2', 'atma', 'cain2', 'drognan', 'elzix', 'fara', 'geglash', 'greiz', 'jerhyn', 'lysander', 'meshif1', 'warriv2']);
    // 주민·노점상 (말을 걸 수 없음)
    expect(g.npcs.some((n) => n.type.id === 'act2male' && !n.npc?.interact)).toBe(true);
    expect(g.npcs.some((n) => n.type.id === 'act2vendor1')).toBe(true);
    // Act 1 프리셋(Akara·Andariel)이 섞이지 않는다
    expect(g.npcs.some((n) => n.type.id === 'akara')).toBe(false);
    expect(g.monsters.length).toBe(0);
  });

  it('Kurast Docks: Alkor·Ormus·Hratli·Asheara·Cain·Natalya·Meshif', () => {
    const g = makeGame(2);
    expect(interactNpcs(g)).toEqual(['alkor', 'asheara', 'cain3', 'hratli', 'meshif2', 'natalya', 'ormus']);
  });

  it('Pandemonium Fortress: Tyrael·Jamella·Halbu·Cain', () => {
    const g = makeGame(3);
    expect(interactNpcs(g)).toEqual(['cain4', 'halbu', 'jamella', 'tyrael2']);
  });

  it('모든 마을에 보관함(267 bank)과 웨이포인트', () => {
    for (const [act, wp] of [[1, 156], [2, 237], [3, 398]] as const) {
      const g = makeGame(act);
      const objs = g.objectsOf(g.levelId).map((o) => o.type.id);
      expect(objs, `act ${act + 1}`).toContain(267);
      expect(objs, `act ${act + 1}`).toContain(wp);
    }
  });

  it('Jerhyn 은 A2Q0 전엔 궁전 밖(121), 뒤엔 궁전 안(122) · Kaelan 은 A2Q6 전까지 궁전 문 (122 + 1)', () => {
    const g = makeGame(1);
    const objs = g.objectsOf(g.levelId);
    const start = objs.find((o) => o.type.id === 121)!, palace = objs.find((o) => o.type.id === 122)!;
    const j = npcOf(g, 'jerhyn');
    expect(Math.hypot(j.npc!.home.x - start.x, j.npc!.home.y - start.y)).toBeLessThan(3);
    const k = npcOf(g, 'act2guard2');
    expect(Math.hypot(k.npc!.home.x - (palace.x + 1), k.npc!.home.y - palace.y)).toBeLessThan(3);
    g.questRecord.set(QUESTFLAG_A2Q0, QFLAG.REWARDGRANTED);
    g.questRecord.set(QUESTFLAG_A2Q6, QFLAG.REWARDGRANTED);
    g.refreshTownQuestNpcs();
    const j2 = npcOf(g, 'jerhyn');
    expect(Math.hypot(j2.npc!.home.x - palace.x, j2.npc!.home.y - palace.y)).toBeLessThan(3);
    expect(g.npcs.some((n) => n.type.id === 'act2guard2')).toBe(false);
  });

  it('Hratli 는 A3Q0 전엔 시작 자리(378), 뒤엔 끝 자리(379)', () => {
    const g = makeGame(2);
    const objs = g.objectsOf(g.levelId);
    const a = objs.find((o) => o.type.id === 378)!, b = objs.find((o) => o.type.id === 379)!;
    const h = npcOf(g, 'hratli');
    expect(Math.hypot(h.npc!.home.x - a.x, h.npc!.home.y - a.y)).toBeLessThan(3);
    g.questRecord.set(QUESTFLAG_A3Q0, QFLAG.REWARDGRANTED);
    g.refreshTownQuestNpcs();
    const h2 = npcOf(g, 'hratli');
    expect(Math.hypot(h2.npc!.home.x - b.x, h2.npc!.home.y - b.y)).toBeLessThan(3);
  });
});

d('막별 상점·메뉴', () => {
  // 출처: NPC_HandleDialogMessage — 상점(1)·도박(2), D2GAME_NPC_Repair (trade/repair 메뉴)
  it('메뉴: Fara trade/repair, Elzix·Alkor·Jamella gamble, Greiz·Asheara hire, Cain identify', () => {
    const g2 = makeGame(1);
    talkTo(g2, 'fara');
    expect(g2.snapshot().interaction!.options).toEqual(['talk', 'tradeRepair', 'cancel']);
    talkTo(g2, 'elzix');
    expect(g2.snapshot().interaction!.options).toEqual(['talk', 'trade', 'gamble', 'cancel']);
    talkTo(g2, 'greiz');
    expect(g2.snapshot().interaction!.options).toEqual(['talk', 'hire', 'cancel']);
    talkTo(g2, 'cain2');
    expect(g2.snapshot().interaction!.options).toEqual(['talk', 'identify', 'cancel']);
    const g3 = makeGame(2);
    talkTo(g3, 'alkor');
    expect(g3.snapshot().interaction!.options).toEqual(['talk', 'trade', 'gamble', 'cancel']);
    talkTo(g3, 'asheara');
    expect(g3.snapshot().interaction!.options).toEqual(['talk', 'trade', 'hire', 'cancel']);
    talkTo(g3, 'hratli');
    expect(g3.snapshot().interaction!.options).toEqual(['talk', 'tradeRepair', 'cancel']);
    const g4 = makeGame(3);
    talkTo(g4, 'jamella');
    expect(g4.snapshot().interaction!.options).toEqual(['talk', 'trade', 'gamble', 'cancel']);
    talkTo(g4, 'halbu');
    expect(g4.snapshot().interaction!.options).toEqual(['talk', 'tradeRepair', 'cancel']);
    talkTo(g4, 'tyrael2');
    // Phase 7: 첫 대화는 A4Q1 시작 대사(670)가 바로 나오고, 메뉴에 The Fallen Angel 항목(671, 기록 워드 25)이 남는다
    expect(g4.snapshot().interaction!.options).toEqual(['talk', 'quest:25:671', 'cancel']);
  });

  // 출처: FillStoreInventory — 보통 난이도: 아이템 레벨 = min(플레이어 레벨 + 5, npcLevels[막]) (Act 2 20, Act 3 28, Act 4 36)
  it('상점 재고: 막별 상인 컬럼·아이템 레벨 상한', () => {
    const cases: [number, string, number][] = [
      [1, 'drognan', 20], [1, 'fara', 20], [1, 'elzix', 20], [1, 'lysander', 20],
      [2, 'ormus', 28], [2, 'alkor', 28], [2, 'hratli', 28], [2, 'asheara', 28],
      [3, 'jamella', 36], [3, 'halbu', 36],
    ];
    const games = new Map<number, Game>();
    for (const [act, id, cap] of cases) {
      let g = games.get(act);
      if (!g) games.set(act, (g = makeGame(act, { level: 60 })));
      talkTo(g, id);
      choose(g, NPC_DEFS[id]!.repair ? 'tradeRepair' : 'trade');
      const store = g.snapshot().interaction!.store;
      expect(store.length, id).toBeGreaterThan(2);
      const col = NPC_DEFS[id]!.vendor!;
      for (const s of store) {
        expect(data.items.base(s.item.code)!.vendors[col], `${id} ${s.item.code}`).toBeTruthy();
        expect(s.item.ilvl, `${id} ${s.item.code}`).toBe(cap);
      }
      g.enqueue({ type: 'closeNpc' });
      g.tick();
    }
  });

  it('Lysander 는 물약 (상시 품목 hp1·mp1), Drognan 은 지팡이·완드 같은 마법 무기', () => {
    const g = makeGame(1, { level: 10 });
    talkTo(g, 'lysander');
    choose(g, 'trade');
    const codes = g.snapshot().interaction!.store.map((s) => s.item.code);
    expect(codes).toContain('hp1');
    expect(codes).toContain('mp1');
    talkTo(g, 'drognan');
    choose(g, 'trade');
    const types = g.snapshot().interaction!.store.map((s) => data.items.base(s.item.code)!.type);
    expect(types.some((t) => ['staf', 'wand', 'orb', 'scep'].includes(t))).toBe(true);
  });

  // 출처: npc.txt fara/hratli/halbu rep mult 128, D2GAME_NPC_Repair — 수리 NPC 만
  it('Fara·Hratli·Halbu 수리, Drognan 은 수리 못 함', () => {
    const g = makeGame(1, { gold: 100000 });
    const it = data.treasure.createItem(data.items.base('lsd')!, 5, new Rng(3), QUALITY.NORMAL);
    it.identified = true;
    it.durability = 1;
    expect(g.store.inv.autoAdd(it)).toBe(true);
    talkTo(g, 'drognan');
    choose(g, 'trade');
    g.enqueue({ type: 'repair', itemId: it.id });
    g.tick();
    expect(it.durability).toBe(1);
    talkTo(g, 'fara');
    choose(g, 'tradeRepair');
    g.enqueue({ type: 'repair', itemId: it.id });
    const ev = g.tick();
    expect(ev.some((e) => e.type === 'repaired')).toBe(true);
    expect(it.durability).toBe(it.maxDurability);
  });

  // 출처: D2GAME_NPC_Heal — ATMA·FARA·ORMUS·JAMELLA 는 말을 걸면 치료, Drognan 은 아니다
  it('Atma·Ormus·Jamella 치료', () => {
    for (const [act, id] of [[1, 'atma'], [2, 'ormus'], [3, 'jamella']] as const) {
      const g = makeGame(act);
      g.character!.life = 1;
      talkTo(g, id);
      expect(g.character!.life, id).toBe(g.maxLife());
    }
    const g = makeGame(1);
    g.character!.life = 1;
    talkTo(g, 'drognan');
    expect(g.character!.life).toBe(1);
  });

  // 출처: D2GAME_NPC_IdentifyAllItems — CAIN2~4, A1Q4 보상 전이면 개당 100 골드
  it('Act 2 Cain 감정 (구출 보상 전 = 100 골드)', () => {
    const g = makeGame(1, { gold: 1000 });
    const it = data.treasure.createItem(data.items.base('rin')!, 20, new Rng(5), QUALITY.MAGIC);
    it.identified = false;
    g.store.inv.autoAdd(it);
    talkTo(g, 'cain2');
    choose(g, 'identify');
    expect(it.identified).toBe(true);
    expect(g.gold).toBe(900);
  });

  it('레벨업 재고 갱신 상인: Charsi·Gheed·Fara·Hratli·Asheara·Halbu·Jamella', () => {
    expect([...LEVEL_REFRESH].sort()).toEqual(['asheara', 'charsi', 'fara', 'gheed', 'halbu', 'hratli', 'jamella', 'malah']);
  });
});

d('막 이동 (Warriv·Meshif·포털)', () => {
  // 출처: NPC_HandleDialogMessage WARRIV1 — A1Q6 REWARDGRANTED 면 Lut Gholein, 웨이포인트 9 활성
  it('Warriv go east: Andariel 보상 전엔 없음, 뒤엔 Lut Gholein 으로 (웨이포인트 9, 용병 따라옴)', () => {
    const g = makeGame(0, { gold: 5000, level: 10 });
    talkTo(g, 'warriv1');
    expect(g.snapshot().interaction!.options).not.toContain('goEast');
    g.questRecord.set(6, QFLAG.REWARDGRANTED);
    g.enqueue({ type: 'closeNpc' });
    g.tick();
    // 용병 (Kashya) — 막을 넘어 따라온다
    g.questRecord.set(2, QFLAG.REWARDGRANTED);
    talkTo(g, 'kashya');
    choose(g, 'hire');
    g.enqueue({ type: 'hire', index: g.snapshot().interaction!.hire[0]!.index });
    g.tick();
    expect(g.mercUnit()).toBeTruthy();
    talkTo(g, 'warriv1');
    expect(g.snapshot().interaction!.options).toContain('goEast');
    const ev = choose(g, 'goEast');
    expect(ev.find((e) => e.type === 'actChange')).toMatchObject({ act: 1, available: true });
    expect(g.act).toBe(1);
    expect(g.levelId).toBe('lutgholein');
    expect(g.waypoints.has(9)).toBe(true);
    const m = g.mercUnit()!;
    expect(m).toBeTruthy();
    expect(m.levelKey ?? g.levelId).toBe(g.levelId);
    expect(Math.hypot(m.x - g.snapshot().player.x, m.y - g.snapshot().player.y)).toBeLessThan(12);
  });

  // 출처: WARRIV2 → D2GAME_PlayerChangeAct(LEVEL_ROGUEENCAMPMENT, 5) (조건 없음)
  it('Warriv (Act 2) go west: 조건 없이 Rogue Encampment 의 Warriv 곁으로', () => {
    const g = makeGame(1);
    talkTo(g, 'warriv2');
    expect(g.snapshot().interaction!.options).toEqual(['talk', 'goWest', 'cancel']);
    choose(g, 'goWest');
    expect(g.act).toBe(0);
    expect(g.levelId).toBe('town');
    const w = npcOf(g, 'warriv1');
    expect(Math.hypot(w.x - g.snapshot().player.x, w.y - g.snapshot().player.y)).toBeLessThan(10);
  });

  // 출처: MESHIF1 — A2Q6 REWARDGRANTED 면 Kurast Docks (웨이포인트 18), MESHIF2 → Lut Gholein
  it('Meshif sail east: Duriel·Jerhyn 보상 전엔 없음 → Kurast Docks, sail west 로 돌아옴', () => {
    const g = makeGame(1);
    talkTo(g, 'meshif1');
    expect(g.snapshot().interaction!.options).not.toContain('sailEast');
    g.questRecord.set(QUESTFLAG_A2Q6, QFLAG.REWARDGRANTED);
    g.enqueue({ type: 'closeNpc' });
    g.tick();
    talkTo(g, 'meshif1');
    expect(g.snapshot().interaction!.options).toContain('sailEast');
    choose(g, 'sailEast');
    expect(g.act).toBe(2);
    expect(g.levelId).toBe('kurastdocks');
    expect(g.waypoints.has(18)).toBe(true);
    talkTo(g, 'meshif2');
    choose(g, 'sailWest');
    expect(g.act).toBe(1);
    expect(g.levelId).toBe('lutgholein');
  });

  // 출처: A3Q6 — 증오의 억류지 포털(메피스토 처치 후)로 Pandemonium Fortress (Phase 7 이 포털에 연결)
  it('Act 3 → 4: Mephisto 전엔 안 되고, 뒤엔 travelAct(3) (웨이포인트 27)', () => {
    const g = makeGame(2);
    expect(g.canTravelAct(3)).toBe(false);
    expect(g.travelAct(3)).toBe(false);
    expect(g.act).toBe(2);
    g.questRecord.set(QUESTFLAG_A3Q6, QFLAG.PRIMARYGOALDONE);
    expect(g.travelAct(3)).toBe(true);
    expect(g.levelId).toBe('pandemonium');
    expect(g.waypoints.has(27)).toBe(true);
  });

  it('막 월드가 아직 없으면 actChange available:false 뒤 travelAct 명령으로 다시', () => {
    const g = makeGame(1);
    const build = g.onActChange!;
    let ready = false;
    g.onActChange = (a) => (ready ? build(a) : null);
    talkTo(g, 'warriv2');
    const ev = choose(g, 'goWest');
    expect(ev.find((e) => e.type === 'actChange')).toMatchObject({ act: 0, available: false });
    expect(g.act).toBe(1);
    ready = true;
    g.enqueue({ type: 'travelAct', act: 0 });
    g.tick();
    expect(g.act).toBe(0);
  });
});
