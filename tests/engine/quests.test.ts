// Act 1 퀘스트 6개 — 기대값 출처: D2MOO D2Game/src/QUESTS/ACT1/A1Q1~A1Q6.cpp, Quests.cpp, SUnitNpc.cpp (담금질·무료 용병·무료 감정),
// D2Common D2QuestRecord.cpp (저장 복원 규칙), MonsterMode.cpp (퀘스트 드롭), ObjMode.cpp (Wirt), string.tbl (대사·퀘스트 로그 문자열),
// TreasureClassEx.txt (Countess = Countess Item + Countess Rune — 클래식에는 룬이 없다)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World } from '../../src/data/act1-world';
import { Game, imbueable, type GameData, type GameEvent } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { nearestWalkable } from '../../src/engine/path';
import { QUALITY, type ItemInstance, type Quality } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { makeSave, parseSave, serializeSave } from '../../src/engine/save';
import { QFLAG, QUEST, QuestRecord } from '../../src/engine/quests/record';
import { NPC_MESSAGES, questLogKey, TOWER_TOME_MESSAGE } from '../../src/engine/quests/messages';
import { OBJMODE, type ObjectUnit } from '../../src/engine/objects';
import type { MonsterUnit } from '../../src/engine/ai';

const d = hasGameData ? describe : describe.skip;

let tables: GameTables;
let data: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
});

interface Opts { level?: number; seed?: number; questFlags?: number[]; quests?: string[]; gold?: number }

function makeGame(opts: Opts = {}): Game {
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 1;
  const w = buildAct1World(gameChain(), tables, data, opts.seed ?? 4242);
  const g = new Game({
    map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), seed: opts.seed ?? 4242, data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), gold: opts.gold ?? 0,
    ...(opts.questFlags ? { questFlags: opts.questFlags } : {}), ...(opts.quests ? { quests: opts.quests } : {}),
  });
  g.tick();
  return g;
}

type Internals = { events: GameEvent[]; killMonster(m: MonsterUnit, s: string): void; level: { ground: { item: ItemInstance }[] }; pickUp(gi: unknown): void };
const inner = (g: Game) => g as unknown as Internals;

/** fn 을 실행하는 동안 생긴 이벤트 (틱 밖에서 부른 엔진 함수용) */
function eventsOf(g: Game, fn: () => void): GameEvent[] {
  inner(g).events = [];
  fn();
  return inner(g).events;
}

/** n 틱 동안의 이벤트 */
function run(g: Game, n: number): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...g.tick());
  return out;
}

const kill = (g: Game, m: MonsterUnit) => inner(g).killMonster(m, 'player');
const alive = (g: Game) => g.monsters.filter((m) => m.mode !== 'DT' && m.mode !== 'DD' && !m.pet);
const npcOf = (g: Game, id: string) => g.npcs.find((n) => n.type.id === id) as MonsterUnit;

/** 레벨로 순간 이동 (걷기 가능한 칸, 가까운 위치 우선) */
function goTo(g: Game, key: string, near?: { x: number; y: number }): void {
  const def = g.levelDef(key)!;
  const at = near ?? def.portalSpot ?? { x: def.map.width / 2, y: def.map.height / 2 };
  const p = nearestWalkable(def.map, at, 400)!;
  g.changeLevel(key, p.x + 0.5, p.y + 0.5);
  g.tick();
}

/** NPC 곁으로 옮겨 말을 걸고, 그 사이 이벤트를 돌려준다 */
function talkTo(g: Game, id: string): GameEvent[] {
  if (g.levelId !== 'town' && id !== 'cain1') goTo(g, 'town');
  const n = npcOf(g, id);
  expect(n, id).toBeTruthy();
  const spot = nearestWalkable(g.map, { x: n.x + 3, y: n.y + 1 }, 8)!;
  g.changeLevel(g.levelId, spot.x + 0.5, spot.y + 0.5);
  g.enqueue({ type: 'interact', unitId: n.id });
  const evs: GameEvent[] = [];
  for (let i = 0; i < 300 && !g.snapshot().interaction; i++) evs.push(...g.tick());
  expect(g.snapshot().interaction?.typeId).toBe(id);
  return evs;
}

function closeTalk(g: Game): GameEvent[] {
  g.enqueue({ type: 'closeNpc' });
  return g.tick();
}

const speechKeys = (evs: GameEvent[]) => evs.filter((e) => e.type === 'questSpeech').map((e) => String(e.key));
const rec = (g: Game, q: number, f: number) => g.questRecord.get(q, f);
const hasCode = (g: Game, code: string) => g.store.allItems().some((it) => it.code === code);

/** 땅에 떨어진 코드 아이템을 줍는다 (걷기 없이 원작 줍기 처리) */
function pickUpCode(g: Game, code: string): ItemInstance {
  const gi = inner(g).level.ground.find((x) => x.item.code === code);
  expect(gi, code).toBeTruthy();
  inner(g).pickUp(gi);
  return gi!.item;
}

function newItem(code: string, quality: Quality = QUALITY.NORMAL): ItemInstance {
  const it = data.treasure.createItem(data.items.base(code)!, 5, new Rng(9), quality);
  it.identified = true;
  return it;
}

/** Den of Evil 을 깨고 Akara 에게 보상까지 */
function finishDen(g: Game): void {
  talkTo(g, 'akara');
  closeTalk(g);
  goTo(g, 'denofevil');
  for (const m of alive(g)) kill(g, m);
  run(g, 10);
  talkTo(g, 'akara');
  closeTalk(g);
}

function finishBloodRaven(g: Game): void {
  talkTo(g, 'kashya');
  closeTalk(g);
  goTo(g, 'burialgrounds');
  const br = g.monsters.find((m) => m.type.id === 'bloodraven')!;
  goTo(g, 'burialgrounds', { x: br.x, y: br.y });
  kill(g, br);
  run(g, 20);
  talkTo(g, 'kashya');
  closeTalk(g);
}

d('퀘스트 기록 (D2QuestRecord)', () => {
  // 출처: QUESTRECORD_* — 퀘스트마다 16비트 워드, ResetIntermediate = STARTED~CUSTOM7, CopyBufferToRecord(bResetStates)
  it('비트 set/clear, 중간 상태 초기화, 게임 입장 복원 (PRIMARYGOALDONE·COMPLETEDNOW 지움, REWARDPENDING → COMPLETEDBEFORE)', () => {
    const r = new QuestRecord();
    r.set(1, QFLAG.STARTED);
    r.set(1, QFLAG.LEAVETOWN);
    r.set(1, QFLAG.REWARDGRANTED);
    expect(r.words[1]).toBe(0b1101);
    r.resetIntermediate(1);
    expect(r.words[1]).toBe(1);
    r.set(6, QFLAG.PRIMARYGOALDONE);
    r.set(6, QFLAG.REWARDPENDING);
    r.set(2, QFLAG.COMPLETEDNOW);
    const back = QuestRecord.load(r.toJSON(), true);
    expect(back.get(6, QFLAG.PRIMARYGOALDONE)).toBe(false);
    expect(back.get(6, QFLAG.REWARDPENDING)).toBe(true);
    expect(back.get(6, QFLAG.COMPLETEDBEFORE)).toBe(true);
    expect(back.get(2, QFLAG.COMPLETEDNOW)).toBe(false);
    expect(back.words.length).toBe(48);
  });
});

d('퀘스트 문자열 (string.tbl)', () => {
  it('모든 NPC 대사 키·퀘스트 이름·퀘스트 로그 설명이 원작 문자열 표에 있다', () => {
    const has = (k: string) => tables.string(k) !== k;
    for (const [, groups] of Object.entries(NPC_MESSAGES)) for (const g of groups) for (const m of g) expect(has(m.key), m.key).toBe(true);
    expect(has(TOWER_TOME_MESSAGE.key)).toBe(true);
    for (let q = 1; q <= 6; q++) expect(tables.string(`qstsa1q${q}`)).not.toBe(`qstsa1q${q}`);
    expect(tables.string('qstsa1q1')).toBe('Den of Evil');
    expect(tables.string('qstsa1q4')).toBe('The Search for Cain');
    for (const [q, st] of [[1, 1], [1, 4], [1, 5], [2, 3], [3, 10], [4, 3], [5, 3], [6, 3]] as const) expect(has(questLogKey(q, st)), `${q}/${st}`).toBe(true);
    expect(questLogKey(1, 13)).toBe('qstsComplete');
  });
});

d('A1Q1 Den of Evil', () => {
  // 출처: A1Q1.cpp — Akara 64(Init) → fState 2, 대화 끝 → 상태 1, 굴 입장 → fState 3 · 상태 2, 몬스터가 5 이하로 남으면 상태 4(남은 수),
  //       다 죽이면 PRIMARYGOALDONE + REWARDPENDING, 8 틱 뒤 상태 5, Akara 76 → REWARDGRANTED + 스킬 포인트 1, 다음 퀘스트(A1Q2) fState 1
  it('시작 → 굴 → 남은 몬스터 메시지 → 완료 → Akara 보상 (스킬 포인트 +1)', () => {
    const g = makeGame();
    expect(g.quests.stateOf(1).state).toBe(1);
    expect(g.snapshot().monsters.find((m) => m.typeId === 'akara')?.quest).toBe(true);
    const e1 = talkTo(g, 'akara');
    expect(speechKeys(e1)).toEqual(['A1Q1InitAkara']);
    expect(g.quests.stateOf(1).state).toBe(2);
    expect(rec(g, 1, QFLAG.STARTED)).toBe(true);
    // 다시 들을 수 있는 메뉴 항목 (퀘스트 이름)
    const it0 = g.snapshot().interaction!;
    expect(it0.topics.map((t) => t.quest)).toContain(1);
    closeTalk(g);
    expect(g.snapshot().quests.find((q) => q.quest === 1)).toMatchObject({ status: 1, icon: 'active' });

    goTo(g, 'denofevil');
    expect(g.quests.stateOf(1).state).toBe(3);
    expect(g.quests.status(1)).toBe(2);
    const ms = alive(g);
    expect(ms.length).toBeGreaterThan(6);
    // 여섯 마리만 남긴다
    for (const m of ms.slice(0, ms.length - 6)) kill(g, m);
    expect(g.quests.status(1)).toBe(2);
    const rest = alive(g);
    const e5 = eventsOf(g, () => kill(g, rest[0]!));
    expect(e5.find((e) => e.type === 'questMessage')).toMatchObject({ quest: 1, key: 'qstsa1q14', count: 5 });
    expect(g.quests.status(1)).toBe(4);
    for (const m of rest.slice(1, 4)) kill(g, m);
    const e1left = eventsOf(g, () => kill(g, rest[4]!));
    expect(e1left.find((e) => e.type === 'questMessage')).toMatchObject({ key: 'qstsa1q140', count: 1 });
    const eDone = eventsOf(g, () => kill(g, rest[5]!));
    expect(eDone.some((e) => e.type === 'questCompleted' && e.quest === 1)).toBe(true);
    expect(eDone.some((e) => e.type === 'questFx' && e.fx === 0)).toBe(true);
    expect(rec(g, 1, QFLAG.PRIMARYGOALDONE) && rec(g, 1, QFLAG.REWARDPENDING)).toBe(true);
    run(g, 10);
    expect(g.quests.status(1)).toBe(5);

    const c = g.character!;
    const pts = c.skillPoints;
    c.life = 1;
    const e2 = talkTo(g, 'akara');
    expect(speechKeys(e2)).toContain('A1Q1SuccessfulAkara');
    expect(c.skillPoints).toBe(pts + 1);
    // 원작: Akara 에게 말을 걸면 치료 (D2GAME_NPC_HealPlayer)
    expect(c.life).toBe(g.maxLife());
    expect(rec(g, 1, QFLAG.REWARDGRANTED)).toBe(true);
    expect(rec(g, 1, QFLAG.REWARDPENDING)).toBe(false);
    // ResetIntermediateStateFlags
    expect(rec(g, 1, QFLAG.STARTED)).toBe(false);
    expect(g.quests.stateOf(1).state).toBe(5);
    expect(g.quests.stateOf(2).state).toBe(1);
    expect(g.snapshot().quests.find((q) => q.quest === 1)).toMatchObject({ status: 13, icon: 'done' });
    // 보상은 한 번
    closeTalk(g);
    talkTo(g, 'akara');
    expect(c.skillPoints).toBe(pts + 1);
  });

  it('다른 NPC 는 퀘스트 이야기를 메뉴 항목(퀘스트 이름)으로만 한다 (nMenu 2)', () => {
    const g = makeGame();
    talkTo(g, 'akara');
    closeTalk(g);
    const e = talkTo(g, 'charsi');
    expect(speechKeys(e)).toEqual([]);
    const it = g.snapshot().interaction!;
    const topic = it.topics.find((t) => t.quest === 1)!;
    expect(topic.key).toBe('A1Q1AfterInitCharsiMain');
    expect(it.options.indexOf(topic.option)).toBe(it.options.indexOf('talk') + 1);
    g.enqueue({ type: 'npcMenu', option: topic.option });
    expect(speechKeys(g.tick())).toEqual(['A1Q1AfterInitCharsiMain']);
  });
});

d('A1Q2 Sisters\' Burial Grounds', () => {
  // 출처: A1Q2.cpp — Den 보상 뒤 fState 1 (SeqCallback), Kashya 81 → 2, Blood Raven 처치 → PRIMARYGOALDONE + REWARDPENDING, 15 틱 뒤 상태 3,
  //       Kashya 92 → REWARDGRANTED + D2GAME_NPC_AssignMercenary (클래식: 용병이 없으면 첫 번째 고용 가능 용병 공짜)
  it('Den 보상 전에는 시작하지 않고, Blood Raven 처치 → Kashya 보상 = 공짜 용병 + 고용 허용', () => {
    const g = makeGame();
    expect(g.quests.stateOf(2).state).toBe(0);
    expect(speechKeys(talkTo(g, 'kashya'))).toEqual([]);
    closeTalk(g);
    finishDen(g);
    expect(g.quests.stateOf(2).state).toBe(1);
    expect(speechKeys(talkTo(g, 'kashya'))).toEqual(['A1Q2InitKashya']);
    closeTalk(g);
    expect(g.quests.status(2)).toBe(1);
    goTo(g, 'burialgrounds');
    expect(g.quests.status(2)).toBe(2);
    const br = g.monsters.find((m) => m.type.id === 'bloodraven')!;
    expect(br).toBeTruthy();
    goTo(g, 'burialgrounds', { x: br.x, y: br.y });
    const ev = eventsOf(g, () => kill(g, br));
    expect(ev.some((e) => e.type === 'questCompleted' && e.quest === 2)).toBe(true);
    expect(rec(g, 2, QFLAG.REWARDPENDING)).toBe(true);
    run(g, 20);
    expect(g.quests.status(2)).toBe(3);
    expect(g.questDone('a1q2')).toBe(false);
    expect(g.merc).toBeNull();
    const e = talkTo(g, 'kashya');
    expect(speechKeys(e)).toContain('A1Q2SuccessfulKashya');
    expect(rec(g, 2, QFLAG.REWARDGRANTED)).toBe(true);
    expect(g.questDone('a1q2')).toBe(true);
    expect(g.merc?.dead).toBe(false);
    expect(g.mercUnit()).toBeTruthy();
    expect(e.some((x) => x.type === 'mercHired')).toBe(true);
    // 다음 퀘스트 (A1Q4 Cain) 활성
    expect(g.quests.stateOf(4).state).toBe(1);
  });
});

d('A1Q4 The Search for Cain', () => {
  // 출처: A1Q4.cpp — Akara 97 → 2, 이니퍼스 나무 → bks (fState 4), Akara 112 → bks 지우고 bkd (fState 5), 돌 5개를 순서대로 → 트리스트럼 포털 (미사일 288 → 오브젝트 60),
  //       감옥 → PRIMARYGOALDONE + REWARDPENDING, 17 틱 뒤 cain1, Akara 118 → 매직 반지(아이템 레벨 7), Cain 무료 감정
  it('나무 → 해독 → Cairn Stone 순서 → 포털 → 트리스트럼 → Cain 구출 → 무료 감정 → Akara 반지', () => {
    const g = makeGame({ gold: 1000 });
    finishDen(g);
    finishBloodRaven(g);
    expect(speechKeys(talkTo(g, 'akara'))).toContain('A1Q4InitAkara');
    expect(g.quests.stateOf(4).state).toBe(2);
    closeTalk(g);
    expect(g.quests.status(4)).toBe(1);
    expect(rec(g, 4, QFLAG.STARTED)).toBe(true);

    // 이니퍼스 나무 (Dark Wood)
    goTo(g, 'darkwood');
    expect(g.quests.stateOf(4).state).toBe(3);
    const tree = g.objectsOf('darkwood').find((o) => o.type.id === 30)!;
    expect(tree).toBeTruthy();
    goTo(g, 'darkwood', { x: tree.x, y: tree.y + 4 });
    const et = eventsOf(g, () => g.operateObject(tree));
    expect(et.some((e) => e.type === 'itemDropped' && e.code === 'bks')).toBe(true);
    expect(tree.mode).toBe(OBJMODE.OPERATING);
    expect(g.quests.stateOf(4).state).toBe(4);
    pickUpCode(g, 'bks');
    expect(hasCode(g, 'bks')).toBe(true);
    // 두루마리를 가진 채로 다시 조작해도 두 번째는 없다
    const et2 = eventsOf(g, () => g.operateObject(tree));
    expect(et2.some((e) => e.type === 'itemDropped')).toBe(false);

    // Akara 해독 (112)
    expect(speechKeys(talkTo(g, 'akara'))).toContain('A1Q4InstructionsAkara');
    expect(hasCode(g, 'bks')).toBe(false);
    expect(hasCode(g, 'bkd')).toBe(true);
    expect(g.quests.stateOf(4).state).toBe(5);
    closeTalk(g);

    // Cairn Stones (Stony Field)
    goTo(g, 'stonyfield');
    const stones = g.objectsOf('stonyfield').filter((o) => o.type.operateFn === 9);
    expect(stones.map((o) => o.type.id).sort()).toEqual([17, 18, 19, 20, 21]);
    const order = g.quests.stoneOrder();
    expect([...order].sort()).toEqual([17, 18, 19, 20, 21]);
    const stone = (id: number) => stones.find((o) => o.type.id === id)!;
    goTo(g, 'stonyfield', { x: stone(order[0]!).x + 2, y: stone(order[0]!).y + 2 });
    // 순서가 틀린 돌은 아무 일도 없다
    g.operateObject(stone(order[1]!));
    expect(stone(order[1]!).mode).toBe(OBJMODE.NEUTRAL);
    for (let i = 0; i < 4; i++) {
      g.operateObject(stone(order[i]!));
      expect(stone(order[i]!).mode).toBe(OBJMODE.OPERATING);
      expect(g.objectsOf('stonyfield').some((o) => o.portal?.toLevel === 'tristram')).toBe(false);
    }
    const ep = eventsOf(g, () => g.operateObject(stone(order[4]!)));
    expect(ep.some((e) => e.type === 'questFx' && e.fx === 1)).toBe(true);
    const portal = g.objectsOf('stonyfield').find((o) => o.portal?.toLevel === 'tristram') as ObjectUnit;
    expect(portal).toBeTruthy();
    expect(portal.type.id).toBe(60);
    expect(hasCode(g, 'bkd')).toBe(false);
    expect(rec(g, 4, QFLAG.ENTERAREA)).toBe(true);
    expect(g.quests.status(4)).toBe(4);

    // 포털 → 트리스트럼
    run(g, 20);
    g.usePortal(portal);
    expect(g.levelId).toBe('tristram');
    const gib = g.objectsOf('tristram').find((o) => o.type.id === 26)!;
    goTo(g, 'tristram', { x: gib.x + 4, y: gib.y + 4 });
    g.operateObject(gib);
    expect(rec(g, 4, QFLAG.PRIMARYGOALDONE) && rec(g, 4, QFLAG.REWARDPENDING)).toBe(true);
    expect(g.questDone('cain')).toBe(true);
    const ec = run(g, 20);
    expect(ec.some((e) => e.type === 'questCompleted' && e.quest === 4)).toBe(true);
    expect(gib.mode).toBe(OBJMODE.SPECIAL1);
    expect(npcOf(g, 'cain1')).toBeTruthy();
    expect(g.quests.status(4)).toBe(6);
    expect(speechKeys(talkTo(g, 'cain1'))).toEqual(['A1Q4RescuedByHeroCain']);
    closeTalk(g);
    expect(npcOf(g, 'cain1')).toBeUndefined();

    // 마을 Cain: 무료 감정
    goTo(g, 'town');
    expect(npcOf(g, 'cain5')).toBeTruthy();
    const unid = newItem('cap', QUALITY.MAGIC);
    unid.identified = false;
    g.store.inv.autoAdd(unid);
    const gold = g.gold;
    const eCain = talkTo(g, 'cain5');
    expect(speechKeys(eCain)).toContain('A1Q4QuestSuccessfulCain');
    g.enqueue({ type: 'npcMenu', option: 'identify' });
    g.tick();
    expect(unid.identified).toBe(true);
    expect(g.gold).toBe(gold);
    closeTalk(g);

    // Akara 반지 (118)
    const eA = talkTo(g, 'akara');
    expect(speechKeys(eA)).toContain('A1Q4QuestSuccessfulAkara');
    const ring = g.store.inventoryItems.find((it) => it.code === 'rin')!;
    expect(ring).toBeTruthy();
    expect(ring.quality).toBe(QUALITY.MAGIC);
    expect(ring.ilvl).toBe(7);
    expect(ring.identified).toBe(true);
    expect(rec(g, 4, QFLAG.REWARDGRANTED)).toBe(true);
    // 다음: Tools of the Trade (A1Q3) 활성 (A1Q4 nSeqId 3)
    expect(g.quests.stateOf(3).state).toBe(1);
    expect(g.snapshot().quests.find((q) => q.quest === 4)?.icon).toBe('done');
  });

  // 출처: ObjMode.cpp OBJECTS_OperateFunction33_WirtsBody ('leg') + Quests.cpp QUESTS_ObjectEvents (금화 10 + rand(10) 무더기, 10 틱마다)
  it('Wirt 의 시체: 다리 + 금화 10~19 무더기', () => {
    const g = makeGame();
    goTo(g, 'tristram');
    const wirt = g.objectsOf('tristram').find((o) => o.type.id === 268)!;
    expect(wirt).toBeTruthy();
    const e0 = eventsOf(g, () => g.operateObject(wirt));
    expect(e0.filter((e) => e.type === 'itemDropped').map((e) => e.code)).toEqual(['leg']);
    const evs = run(g, 300);
    const golds = evs.filter((e) => e.type === 'itemDropped' && e.code === 'gld').length;
    expect(golds).toBeGreaterThanOrEqual(10);
    expect(golds).toBeLessThanOrEqual(19);
    // 두 번째 조작은 없음
    const e1 = eventsOf(g, () => g.operateObject(wirt));
    expect(e1.some((e) => e.type === 'itemDropped')).toBe(false);
  });
});

d('A1Q3 Tools of the Trade', () => {
  // 출처: A1Q3.cpp — Malus 받침대(OperateFunction21): 레벨 8 미만이면 거절, 아니면 hdm 을 떨어뜨림 (fState 4), 주우면 상태 2,
  //       Charsi 163 → hdm 지우고 REWARDPENDING; SUnitNpc.cpp CHARSI — 레어 (아이템 레벨 = 플레이어 레벨 +4 (5 초과)), 내구 최대, ACT1Q3_SetRewardGranted
  it('Malus → Charsi → 담금질 = 같은 아이템의 레어', () => {
    const low = makeGame({ level: 7 });
    goTo(low, 'barracks');
    const stand0 = low.objectsOf('barracks').find((o) => o.type.id === 108)!;
    expect(stand0).toBeTruthy();
    const eLow = eventsOf(low, () => low.operateObject(stand0));
    expect(eLow.some((e) => e.type === 'itemDropped')).toBe(false);
    expect(eLow.some((e) => e.type === 'questSound' && e.reason === 'level8')).toBe(true);

    const g = makeGame({ level: 8 });
    goTo(g, 'barracks');
    const stand = g.objectsOf('barracks').find((o) => o.type.id === 108)!;
    goTo(g, 'barracks', { x: stand.x + 2, y: stand.y + 2 });
    const e = eventsOf(g, () => g.operateObject(stand));
    expect(e.some((x) => x.type === 'itemDropped' && x.code === 'hdm')).toBe(true);
    expect(stand.mode).toBe(OBJMODE.OPENED);
    expect(g.quests.stateOf(3).state).toBe(4);
    pickUpCode(g, 'hdm');
    expect(g.quests.status(3)).toBe(2);
    expect(rec(g, 3, QFLAG.CUSTOM2)).toBe(true);

    const ec = talkTo(g, 'charsi');
    expect(speechKeys(ec)).toContain('A1Q3SuccessfulCharsi');
    expect(hasCode(g, 'hdm')).toBe(false);
    expect(rec(g, 3, QFLAG.REWARDPENDING)).toBe(true);
    expect(g.quests.status(3)).toBe(10);
    const opts = g.snapshot().interaction!.options;
    expect(opts).toContain('imbue');
    g.enqueue({ type: 'npcMenu', option: 'imbue' });
    g.tick();
    expect(g.snapshot().interaction?.mode).toBe('imbue');
    // 매직 아이템은 담금질할 수 없다
    const magic = newItem('cap', QUALITY.MAGIC);
    g.store.inv.autoAdd(magic);
    g.enqueue({ type: 'imbue', itemId: magic.id });
    expect(g.tick().some((x) => x.type === 'imbueFailed')).toBe(true);
    expect(rec(g, 3, QFLAG.REWARDPENDING)).toBe(true);
    // 보통 도끼 → 레어 도끼
    const axe = newItem('hax');
    axe.durability = 3;
    g.store.inv.autoAdd(axe);
    expect(imbueable(data.items, axe)).toBe(true);
    g.enqueue({ type: 'imbue', itemId: axe.id });
    const ei = g.tick();
    const done = ei.find((x) => x.type === 'imbued')!;
    expect(done).toMatchObject({ code: 'hax', quality: QUALITY.RARE, ilvl: 12 });
    const out = g.store.inventoryItems.find((it) => it.id === done.itemId)!;
    expect(out.quality).toBe(QUALITY.RARE);
    expect(out.durability).toBe(out.maxDurability);
    expect(out.identified).toBe(true);
    expect(g.store.find(axe.id)).toBeNull();
    expect(rec(g, 3, QFLAG.REWARDGRANTED)).toBe(true);
    expect(rec(g, 3, QFLAG.REWARDPENDING)).toBe(false);
    expect(g.snapshot().interaction?.options ?? []).not.toContain('imbue');
  });
});

d('A1Q5 The Forgotten Tower', () => {
  // 출처: A1Q5.cpp — 곰팡이 핀 책(TowerTome, 원작 위치 = Stony Field: DrlgOutWild.cpp LVLPREST_ACT1_TOWER_TOME) → 두루마리 127, fState 2, 상태 1;
  //       Countess 처치 (탑 지하 5층) → 바로 REWARDGRANTED (NPC 보상 없음), 드롭 = TC "Countess" (Countess Item + Countess Rune — 클래식 룬 없음),
  //       탑 상자: towerchestspawner 가 상자 TC 매직 3 + 물약 4, 금화 소나기
  it('책 → 탑 → Countess 처치 = 완료, 룬 없는 드롭, 상자 금화', () => {
    const g = makeGame();
    goTo(g, 'stonyfield');
    const tome = g.objectsOf('stonyfield').find((o) => o.type.id === 8)!;
    expect(tome).toBeTruthy();
    const e = eventsOf(g, () => g.operateObject(tome));
    expect(e.find((x) => x.type === 'questScroll')).toMatchObject({ key: 'A1Q5InitQuestTome' });
    expect(g.quests.stateOf(5).state).toBe(2);
    expect(g.quests.status(5)).toBe(1);
    goTo(g, 'tower');
    goTo(g, 'towercellar5');
    expect(g.quests.status(5)).toBe(2);
    const countess = g.monsters.find((m) => m.superUnique !== undefined && data.uniques?.superUnique(m.superUnique)?.key === 'The Countess')!;
    expect(countess).toBeTruthy();
    expect(g.monsterTc(countess)).toBe('Countess');
    // 다른 몬스터는 치운다 (테스트가 기다리는 동안 플레이어가 죽지 않게)
    g.monsters.splice(0, g.monsters.length, countess);
    const ek = eventsOf(g, () => kill(g, countess));
    expect(ek.some((x) => x.type === 'questCompleted' && x.quest === 5)).toBe(true);
    const drops = ek.filter((x) => x.type === 'itemDropped' && x.tc === 'Countess').map((x) => String(x.code));
    expect(drops.length).toBeGreaterThan(0);
    for (const c of drops) expect(/^r\d\d$/.test(c), c).toBe(false);
    expect(rec(g, 5, QFLAG.REWARDGRANTED)).toBe(true);
    expect(rec(g, 5, QFLAG.REWARDPENDING)).toBe(false);
    const evs = run(g, 420);
    expect(evs.some((x) => x.type === 'chestDrop')).toBe(true);
    expect(evs.filter((x) => x.type === 'itemDropped' && x.code === 'gld').length).toBeGreaterThan(5);
    expect(g.quests.status(5)).toBe(13);
    // 다음 대화: 성공 대사 (fState 5 목록 2, 바로 재생)
    expect(speechKeys(talkTo(g, 'akara'))).toContain('A1Q5SuccessfulAkara');
  });
});

d('A1Q6 Sisters to the Slaughter', () => {
  // 출처: A1Q6.cpp — Andariel 처치 → PRIMARYGOALDONE + REWARDPENDING, Warriv 183 → REWARDGRANTED; SUnitNpc.cpp WARRIV1 go east (Act 2 범위 밖)
  it('Andariel 처치 → Warriv 대화 = 완료, go east 는 Act 2 없음 이벤트', () => {
    const g = makeGame();
    goTo(g, 'catacombs4');
    const a = g.monsters.find((m) => m.type.id === 'andariel')!;
    expect(a).toBeTruthy();
    const ek = eventsOf(g, () => kill(g, a));
    expect(ek.some((x) => x.type === 'questCompleted' && x.quest === 6)).toBe(true);
    expect(rec(g, 6, QFLAG.REWARDPENDING)).toBe(true);
    // 10 번째 타이머 호출에 플레이어 자리 마을 포털
    const ev = run(g, 30);
    expect(ev.some((x) => x.type === 'portalOpened')).toBe(true);
    expect(g.quests.status(6)).toBe(3);
    expect(g.snapshot().monsters.find((m) => m.typeId === 'warriv1')).toBeUndefined();
    const ew = talkTo(g, 'warriv1');
    expect(speechKeys(ew)).toContain('A1Q6SuccessfulWarriv');
    expect(rec(g, 6, QFLAG.REWARDGRANTED)).toBe(true);
    expect(g.quests.status(6)).toBe(13);
    const opts = g.snapshot().interaction!.options;
    expect(opts).toContain('goEast');
    g.enqueue({ type: 'npcMenu', option: 'goEast' });
    expect(g.tick().find((x) => x.type === 'actChange')).toMatchObject({ to: 'lutgholein', available: false });
  });
});

d('퀘스트 저장', () => {
  // 출처: QUESTRECORD_CopyBufferToRecord — 저장된 워드를 그대로, 보상 대기(REWARDPENDING)는 COMPLETEDBEFORE 로 표시되어도 다음 게임에서 받을 수 있다
  it('기록 저장 왕복: 끝낸 퀘스트는 다음 게임에서도 완료, 받지 않은 보상은 다음 게임 Akara 에게', () => {
    const g = makeGame();
    finishDen(g);
    finishBloodRaven(g);
    // Den 보상 대기 상태를 흉내: 다른 게임에서 굴을 깬 뒤 저장
    const g2 = makeGame({ seed: 777 });
    talkTo(g2, 'akara');
    closeTalk(g2);
    goTo(g2, 'denofevil');
    for (const m of alive(g2)) kill(g2, m);
    expect(rec(g2, 1, QFLAG.REWARDPENDING)).toBe(true);

    for (const [src, expectDen] of [[g, 'granted'], [g2, 'pending']] as const) {
      const save = makeSave('Hero', src.character!, src.gold, { inventory: [], equipment: {}, questFlags: src.questRecord.toJSON() });
      const back = parseSave(serializeSave(save));
      expect(back.questFlags).toEqual(src.questRecord.toJSON());
      const n = makeGame({ questFlags: back.questFlags, seed: 991 });
      if (expectDen === 'granted') {
        expect(rec(n, 1, QFLAG.REWARDGRANTED)).toBe(true);
        expect(rec(n, 2, QFLAG.REWARDGRANTED)).toBe(true);
        expect(n.quests.stateOf(1).notIntro).toBe(false);
        expect(n.quests.stateOf(4).state).toBe(1);
        expect(n.questDone('a1q2')).toBe(true);
        expect(n.snapshot().quests.find((q) => q.quest === 2)?.icon).toBe('done');
      } else {
        expect(rec(n, 1, QFLAG.REWARDPENDING)).toBe(true);
        expect(rec(n, 1, QFLAG.COMPLETEDBEFORE)).toBe(true);
        const pts = n.character!.skillPoints;
        expect(speechKeys(talkTo(n, 'akara'))).toContain('A1Q1SuccessfulAkara');
        expect(n.character!.skillPoints).toBe(pts + 1);
        expect(rec(n, 1, QFLAG.REWARDGRANTED)).toBe(true);
      }
    }
  });

  it('예전 저장 호환: questFlags 가 없으면 quests 이름 목록에서 옮긴다, 잘못된 기록은 버린다', () => {
    const save = makeSave('Old', createCharacter(classStats(tables.table('charstats'), 'Barbarian')), 0, { inventory: [], equipment: {}, quests: ['a1q2', 'cain'] });
    const back = parseSave(serializeSave(save));
    expect(back.questFlags).toBeUndefined();
    const g = makeGame({ quests: back.quests });
    expect(g.questDone('a1q2')).toBe(true);
    expect(g.questDone('cain')).toBe(true);
    expect(g.npcs.some((n) => n.type.id === 'cain5')).toBe(true);
    const bad = JSON.parse(serializeSave(save)) as Record<string, unknown>;
    bad.questFlags = ['x', 70000];
    expect(parseSave(JSON.stringify(bad)).questFlags).toBeUndefined();
  });
});
