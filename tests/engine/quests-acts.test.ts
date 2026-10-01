// Act 2~4 퀘스트 15개 + 엔딩 (Phase 7).
// 기대값 출처: D2MOO D2Game/src/QUESTS/ACT2/A2Q1~A2Q6.cpp, ACT3/A3Q1~A3Q6.cpp, ACT4/A4Q1~A4Q3.cpp, Quests.cpp (QUESTS_LevelWarpCheck ·
//   QUESTS_ActChange_HirelingChangeAct · QUESTS_SequenceCycler), GAME/Clients.cpp CLIENTS_UpdateCharacterProgression (진행 값 = nAct + 난이도 × 4),
//   MONSTER/MonsterSpawn.cpp·MonsterUnique.cpp (퀘스트 연결 몬스터), string.tbl (대사·퀘스트 로그 문자열), objects.txt (퀘스트 오브젝트)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { actLevels, actTownKey, buildActWorld } from '../../src/data/world';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { nearestWalkable } from '../../src/engine/path';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { makeSave, parseSave, serializeSave } from '../../src/engine/save';
import { QFLAG, QuestRecord } from '../../src/engine/quests/record';
import { NPC_MESSAGES_ACTS, QUEST_LOG_ORDER_ACTS, QW, questLogKeyActs, questNameKey, questOfWord, wordOfQuest } from '../../src/engine/quests/messages-acts';
import { OBJMODE, type ObjectUnit } from '../../src/engine/objects';
import type { MonsterUnit } from '../../src/engine/ai';
import type { Act2Quests } from '../../src/engine/quests/act2';
import type { Act3Quests } from '../../src/engine/quests/act3';
import { ENDING_WARP_TICKS, HELLFORGE_GEMS, type Act4Quests } from '../../src/engine/quests/act4';
import { npcMenuKey } from '../../src/engine/npc';

const d = hasGameData ? describe : describe.skip;
const T = 240_000;

let tables: GameTables;
let data: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
});

const SEED = 606;

interface Opts { level?: number; questFlags?: number[]; cls?: 'Sorceress' | 'Barbarian' | 'Amazon'; difficulty?: 0 | 1 | 2 }

/** act 마을에서 시작하는 게임 (다른 막은 요청하면 원작 DRLG 로 만든다) */
function makeGame(act: number, opts: Opts = {}): Game {
  const cls = opts.cls ?? 'Sorceress';
  const cs = classStats(tables.table('charstats'), cls);
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 30;
  // 보스 곁에서 버티도록 생명을 크게 (퀘스트 상태 기계만 본다)
  ch.maxLife = ch.life = 100000;
  const w = buildActWorld(gameChain(), tables, data, SEED, act);
  const g = new Game({
    map: w.byKey.get(w.townId)!.def.map, levels: w.levels.map((l) => l.def), act, seed: SEED, data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls), gold: 0,
    ...(opts.questFlags ? { questFlags: opts.questFlags } : {}), ...(opts.difficulty ? { difficulty: opts.difficulty } : {}),
  });
  g.onActChange = (a) => actLevels(buildActWorld(gameChain(), tables, data, SEED, a));
  g.tick();
  return g;
}

type Internals = {
  events: GameEvent[]; killMonster(m: MonsterUnit, s: string): void; level: { ground: { item: ItemInstance }[]; objects: ObjectUnit[]; monsters: MonsterUnit[] };
  pickUp(gi: unknown): void; spawnMonster(id: string, x: number, y: number): MonsterUnit;
};
const inner = (g: Game) => g as unknown as Internals;
const kill = (g: Game, m: MonsterUnit) => inner(g).killMonster(m, 'player');
const run = (g: Game, n: number): GameEvent[] => {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...g.tick());
  return out;
};
const rec = (g: Game, w: number, f: number) => g.questRecord.get(w, f);
const hasCode = (g: Game, code: string) => g.store.allItems().some((it) => it.code === code);
const npcOf = (g: Game, id: string) => g.npcs.find((n) => n.type.id === id) as MonsterUnit;
const obj = (g: Game, cls: number) => inner(g).level.objects.find((o) => o.type.id === cls) as ObjectUnit;
const mon = (g: Game, id: string) => inner(g).level.monsters.find((m) => m.type.id === id && m.mode !== 'DT' && m.mode !== 'DD') as MonsterUnit;
const a2 = (g: Game) => g.questControl.get(1) as unknown as Act2Quests;
const a3 = (g: Game) => g.questControl.get(2) as unknown as Act3Quests;
const a4 = (g: Game) => g.questControl.get(3) as unknown as Act4Quests;

const COUNCIL = ['Toorc Icefist', 'Geleb Flamefinger', 'Ismail Vilehand'];
/** 퀘스트 몬스터 (방해 몬스터를 치울 때 남긴다) */
function questMonster(m: MonsterUnit): boolean {
  if (['radament', 'summoner', 'duriel', 'mephisto', 'izual', 'hephasto', 'diablo', 'compellingorb', 'fetish11'].includes(m.type.id)) return true;
  return m.superUnique !== undefined && COUNCIL.includes(data.uniques!.superUnique(m.superUnique)!.key);
}

/** 레벨로 순간 이동 (걷기 가능한 칸). 방해 몬스터는 치운다 (e2e 의 g.monsters.splice 와 같은 뜻) */
function goTo(g: Game, key: string, near?: { x: number; y: number }): void {
  const def = g.levelDef(key)!;
  expect(def, key).toBeTruthy();
  const at = near ?? def.portalSpot ?? { x: def.map.width / 2, y: def.map.height / 2 };
  const p = nearestWalkable(def.map, at, 400)!;
  g.changeLevel(key, p.x + 0.5, p.y + 0.5);
  // 도착 칸이 출구(포털 자리) 안이어도 넘어가지 않게 (원작도 도착 직후에는 다시 넘지 않는다)
  (g as unknown as { exitHold: boolean }).exitHold = true;
  g.tick();
  const ms = inner(g).level.monsters;
  for (let i = ms.length - 1; i >= 0; i--) if (!questMonster(ms[i]!) && !ms[i]!.pet) ms.splice(i, 1);
}

const town = (g: Game) => actTownKey(g.act);

/** NPC 곁으로 옮겨 말을 건다 (자동 대사 이벤트를 돌려준다) */
function talkTo(g: Game, id: string): GameEvent[] {
  if (!g.npcs.some((n) => n.type.id === id)) goTo(g, town(g));
  const n = npcOf(g, id);
  expect(n, id).toBeTruthy();
  const spot = nearestWalkable(g.map, { x: n.x + 2, y: n.y + 1 }, 8)!;
  g.changeLevel(g.levelId, spot.x + 0.5, spot.y + 0.5);
  g.enqueue({ type: 'interact', unitId: n.id });
  const evs: GameEvent[] = [];
  for (let i = 0; i < 300 && g.snapshot().interaction?.typeId !== id; i++) evs.push(...g.tick());
  expect(g.snapshot().interaction?.typeId).toBe(id);
  return evs;
}
const closeTalk = (g: Game) => {
  g.enqueue({ type: 'closeNpc' });
  return g.tick();
};
/** 메뉴의 퀘스트 항목 (quest:<워드>:<번호>) 을 고른다 */
function topic(g: Game, word: number): GameEvent[] {
  const o = g.snapshot().interaction?.options.find((x) => x.startsWith(`quest:${word}:`));
  expect(o, `quest ${word} topic`).toBeTruthy();
  g.enqueue({ type: 'npcMenu', option: o! });
  return g.tick();
}
const speechKeys = (evs: GameEvent[]) => evs.filter((e) => e.type === 'questSpeech').map((e) => String(e.key));

/** 땅에 떨어진 코드 아이템을 줍는다 */
function pickUpCode(g: Game, code: string): ItemInstance {
  const gi = inner(g).level.ground.find((x) => x.item.code === code);
  expect(gi, code).toBeTruthy();
  inner(g).pickUp(gi);
  return gi!.item;
}
function newItem(code: string, quality: number = QUALITY.NORMAL): ItemInstance {
  const it = data.treasure.createItem(data.items.base(code)!, 30, new Rng(9), quality as ItemInstance['quality']);
  it.identified = true;
  return it;
}
function give(g: Game, code: string, quality: number = QUALITY.NORMAL): ItemInstance {
  const it = newItem(code, quality);
  expect(g.store.inv.autoAdd(it), code).toBe(true);
  return it;
}
/** 손에 든다 (오른손 무기 칸) */
function wield(g: Game, it: ItemInstance): void {
  g.store.consume(it.id);
  g.store.equipment.rarm = it;
}
/** 오브젝트가 있는 레벨 (levels.txt 번호 순) */
function levelWithObject(g: Game, cls: number): string {
  for (const key of [...(g as unknown as { levels: Map<string, unknown> }).levels.keys()]) if ((g.levelDef(key)?.objects ?? []).some((o) => o.classId === cls)) return key;
  throw new Error(`object ${cls} not found`);
}
function opNear(g: Game, key: string, cls: number): ObjectUnit {
  const def = g.levelDef(key)!;
  const p = def.objects!.find((o) => o.classId === cls)!;
  goTo(g, key, { x: p.x + 2, y: p.y + 2 });
  const o = obj(g, cls);
  expect(o, `object ${cls}`).toBeTruthy();
  return o;
}
function log(g: Game, act: number, n: number) {
  return g.questLog(act).find((e) => e.quest === n)!;
}
/** 같은 레벨 몬스터 곁으로 가서 죽인다 */
function killNear(g: Game, m: MonsterUnit): GameEvent[] {
  goTo(g, g.levelId, { x: m.x + 2, y: m.y + 2 });
  inner(g).events = [];
  kill(g, m);
  return inner(g).events;
}

d('Act 2~4 대사 표·퀘스트 로그 문자열 (string.tbl)', () => {
  it('모든 대사 키가 string.tbl 에 있다 (A2Q1~A4Q3)', () => {
    const missing: string[] = [];
    // 확장팩 대사 (문자열 번호 20000 이상 — A4Q2 Tyrael·Cain 의 Harrogath 대사) 는 클래식 string.tbl 에 없다 (act5-travel.test.ts 가 확장팩으로 본다)
    for (const [w, tabs] of Object.entries(NPC_MESSAGES_ACTS)) for (const t of tabs) for (const m of t) if (m.index < 20000 && tables.string(m.key) === m.key) missing.push(`${w}:${m.npc}:${m.index}:${m.key}`);
    expect(missing).toEqual([]);
  });

  it('퀘스트 이름·로그 설명 문자열 (qstsa2q1 … qstsa4q34) 이 모두 있다', () => {
    const missing: string[] = [];
    for (const act of [1, 2, 3]) for (const n of QUEST_LOG_ORDER_ACTS[act]!) {
      const w = wordOfQuest(act, n);
      if (tables.string(questNameKey(w)) === questNameKey(w)) missing.push(questNameKey(w));
      for (let s = 1; s <= 13; s++) {
        const k = questLogKeyActs(w, s);
        if (k && tables.string(k) === k) missing.push(k);
      }
    }
    expect(missing).toEqual([]);
    expect(tables.string('qstsa2q1')).toBe("Radament's Lair");
    expect(tables.string('qstsa4q3')).toBe("Hell's Forge");
    expect(questOfWord(QW.A3Q4)).toEqual({ act: 2, quest: 4 });
    // 메뉴 항목 이름: 퀘스트 번호 = 기록 워드
    expect(npcMenuKey(`quest:${QW.A2Q6}:430`)).toBe('qstsa2q6');
    expect(npcMenuKey('quest:1:64')).toBe('qstsa1q1');
  });

  it('원작 문자열 번호 → 키: A2Q2 Cain 조각별, A3Q2 칼림 조각별, A4Q3 영혼석', () => {
    const k = (w: number, i: number) => NPC_MESSAGES_ACTS[w]!.flat().find((m) => m.index === i)?.key;
    expect(k(QW.A2Q2, 335)).toBe('A2Q2EarlyReturnScrollCain');
    expect(k(QW.A2Q2, 339)).toBe('A2Q2SuccessfulStaffCain');
    expect(k(QW.A3Q2, 548)).toBe('A3Q2SuccessfulCain');
    expect(k(QW.A4Q3, 679)).toBe('A4Q3InitNoStoneCain');
    expect(k(QW.A2Q6, 302)).toBe('TyraelGossip1');
    expect(k(QW.A2Q4, 397)).toBe('A2Q4SuccessfulGriez');
  });
});

d('Act 2 퀘스트', () => {
  it('Radament: Atma 시작(304) → 하수도 → Radament 처치 = 기술서(ass) → 읽으면 스킬 포인트 +1, Atma 334 보상 받음', () => {
    const g = makeGame(1);
    const W = QW.A2Q1;
    expect(g.questControl.npcHasQuest('atma')).toBe(true);
    expect(speechKeys(talkTo(g, 'atma'))).toEqual(['A2Q1InitAtma']);
    expect(a2(g).stateOf(W).state).toBe(2);
    closeTalk(g);
    expect(log(g, 1, 1).status).toBe(1);
    goTo(g, 'sewers3');
    expect(rec(g, W, QFLAG.LEAVETOWN)).toBe(true);
    const rad = mon(g, 'radament');
    expect(rad).toBeTruthy();
    const evs = killNear(g, rad);
    expect(rec(g, W, QFLAG.PRIMARYGOALDONE) && rec(g, W, QFLAG.REWARDPENDING) && rec(g, W, QFLAG.CUSTOM1)).toBe(true);
    expect(evs.some((e) => e.type === 'questCompleted' && e.quest === W)).toBe(true);
    run(g, 20);
    expect(log(g, 1, 1).status).toBe(3);
    const book = pickUpCode(g, 'ass');
    const sp = g.character!.skillPoints;
    g.enqueue({ type: 'useItem', itemId: book.id });
    g.tick();
    expect(g.character!.skillPoints).toBe(sp + 1);
    expect(hasCode(g, 'ass')).toBe(false);
    expect(rec(g, W, QFLAG.CUSTOM1)).toBe(false);
    expect(speechKeys(talkTo(g, 'atma'))).toEqual(['A2Q1SuccessfulAtma']);
    expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
    expect(rec(g, W, QFLAG.REWARDPENDING)).toBe(false);
    closeTalk(g);
    expect(log(g, 1, 1).icon).toBe('done');
  }, T);

  it('호라드릭 지팡이: 상자 3개(큐브·두루마리·왕의 지팡이)·제단(독사 부적) → Cain 에게 보이기 → 큐브 조립 → 오리피스 → 두리엘 방 포털 → 두리엘 → Tyrael 포털 → Jerhyn → Meshif', () => {
    const g = makeGame(1);
    // 두루마리 (하수도 3층 상자 355, OperateFn 40) — Cain 에게 먼저 보인다 (큐브를 보이면 LEAVETOWN 이 켜져 두루마리 대사는 지나간 것으로 친다)
    g.operateObject(opNear(g, 'sewers3', 355));
    pickUpCode(g, 'tr1');
    expect(speechKeys(talkTo(g, 'cain2'))).toEqual(['A2Q2EarlyReturnScrollCain']);
    closeTalk(g);
    expect(hasCode(g, 'tr1')).toBe(false);
    expect(log(g, 1, 2).status).toBe(2);
    // 큐브 (Halls of the Dead 3 상자 354, OperateFn 39)
    g.operateObject(opNear(g, 'hallsofdead3', 354));
    expect(inner(g).level.ground.some((x) => x.item.code === 'box')).toBe(true);
    pickUpCode(g, 'box');
    // 왕의 지팡이 (구더기 굴 3층 상자 356, 유니크)
    g.operateObject(opNear(g, 'maggotlair3', 356));
    const staff = pickUpCode(g, 'msf');
    expect(staff.quality).toBe(QUALITY.UNIQUE);
    // 독사 부적 (발톱 독사 사원 2층 제단 149 — 오염된 태양도 끝)
    g.operateObject(opNear(g, 'clawviper2', 149));
    const amu = pickUpCode(g, 'vip');
    expect(amu.quality).toBe(QUALITY.UNIQUE);
    expect(rec(g, QW.A2Q3, QFLAG.REWARDPENDING)).toBe(true);
    // Cain 에게 차례로 (메뉴 0 = 말을 걸면 바로)
    const heard: string[] = [];
    for (let i = 0; i < 6; i++) {
      heard.push(...speechKeys(talkTo(g, 'cain2')).filter((k) => k.startsWith('A2Q2')));
      closeTalk(g);
    }
    expect(heard).toEqual(['A2Q2EarlyReturnCubeCain', 'A2Q2EarlyReturnCapCain', 'A2Q2EarlyReturnStaveCain']);
    // 큐브 조립: 왕의 지팡이 + 독사 부적 → 호라드릭 지팡이 (cubeQuestItem → A2Q2 CUSTOM7, A2Q4 시작)
    const box = g.store.allItems().find((x) => x.code === 'box')!;
    for (const it of [staff, amu]) {
      g.store.consume(it.id);
      expect(g.store.cube.autoAdd(it)).toBe(true);
    }
    expect(g.openCube(box.id)).toBe(true);
    g.enqueue({ type: 'transmute' });
    g.tick();
    expect(hasCode(g, 'hst')).toBe(true);
    expect(rec(g, QW.A2Q2, QFLAG.CUSTOM7)).toBe(true);
    expect(a2(g).stateOf(QW.A2Q4).state).toBeGreaterThanOrEqual(1);
    expect(speechKeys(talkTo(g, 'cain2'))).toEqual(['A2Q2SuccessfulStaffCain']);
    closeTalk(g);
    // 진짜 무덤의 오리피스 (152)
    const tomb = levelWithObject(g, 152);
    const orifice = opNear(g, tomb, 152);
    // 지팡이 없이 조작하면 소리 19 (여기서는 지팡이를 가지고)
    g.operateObject(orifice);
    expect(rec(g, QW.A2Q2, QFLAG.REWARDGRANTED)).toBe(true);
    expect(hasCode(g, 'hst')).toBe(false);
    expect(a2(g).tombOpen).toBe(false);
    run(g, 60);
    expect(a2(g).tombOpen).toBe(true);
    const portal = obj(g, 100);
    expect(portal).toBeTruthy();
    // 두리엘 방 포털 → 두리엘 방
    g.operateObject(portal);
    expect(g.levelId).toBe('durielslair');
    const duriel = mon(g, 'duriel');
    killNear(g, duriel);
    run(g, 40);
    expect(obj(g, 153).mode).toBe(OBJMODE.OPENED);
    expect(rec(g, QW.A2Q6, QFLAG.CUSTOM1)).toBe(true);
    expect(g.questControl.npcHasQuest('tyrael1')).toBe(true);
    // Tyrael 302 → 마을 포털 + A2Q6 PGD·LEAVETOWN, 진행 값 2
    const evs = talkTo(g, 'tyrael1');
    expect(speechKeys(evs)).toEqual(['TyraelGossip1']);
    expect(evs.some((e) => e.type === 'portalOpened')).toBe(true);
    expect(rec(g, QW.A2Q6, QFLAG.PRIMARYGOALDONE) && rec(g, QW.A2Q6, QFLAG.LEAVETOWN)).toBe(true);
    expect(g.progression).toBe(2);
    closeTalk(g);
    expect(log(g, 1, 6).status).toBe(5);
    // Jerhyn 442 → ENTERAREA, Meshif 450 → REWARDGRANTED (동쪽으로 항해)
    expect(g.canTravelAct(2)).toBe(false);
    expect(speechKeys(talkTo(g, 'jerhyn'))).toContain('A2Q6SuccessfulJerhyn');
    closeTalk(g);
    expect(rec(g, QW.A2Q6, QFLAG.ENTERAREA)).toBe(true);
    expect(speechKeys(talkTo(g, 'meshif1'))).toEqual(['A2Q6SuccessfulMeshif']);
    closeTalk(g);
    expect(rec(g, QW.A2Q6, QFLAG.REWARDGRANTED)).toBe(true);
    expect(g.canTravelAct(2)).toBe(true);
    // Kaelan 이 사라진다
    expect(g.npcs.some((n) => n.type.id === 'act2guard2')).toBe(false);
  }, T);

  it('오염된 태양: 잃어버린 도시에 들어가면 15~16 틱 뒤 어두워짐 → Drognan 348 → 제단을 부수면 밝아짐 → 마을 사람과 이야기하면 보상 받음', () => {
    const g = makeGame(1);
    const W = QW.A2Q3;
    goTo(g, 'lostcity');
    expect(g.taintedSun).toBe(false);
    const evs = run(g, 20);
    expect(g.taintedSun).toBe(true);
    expect(evs.some((e) => e.type === 'taintedSun' && e.dark)).toBe(true);
    expect(rec(g, W, QFLAG.STARTED)).toBe(true);
    expect(log(g, 1, 3).status).toBe(1);
    expect(g.questControl.npcHasQuest('drognan')).toBe(true);
    expect(speechKeys(talkTo(g, 'drognan'))).toEqual(['A2Q3AfterInitDrognan']);
    closeTalk(g);
    expect(a2(g).stateOf(W).state).toBe(2);
    g.operateObject(opNear(g, 'clawviper2', 149));
    expect(g.taintedSun).toBe(false);
    expect(rec(g, W, QFLAG.REWARDPENDING) && rec(g, W, QFLAG.PRIMARYGOALDONE)).toBe(true);
    run(g, 15);
    expect(log(g, 1, 3).status).toBe(3);
    // 두 번째 조작은 소리 19 (부적을 가졌거나 보상 대기)
    pickUpCode(g, 'vip');
    const again = (() => {
      inner(g).events = [];
      g.operateObject(obj(g, 149));
      return inner(g).events;
    })();
    expect(again.some((e) => e.type === 'questSound' && e.sound === 19)).toBe(true);
    expect(speechKeys(talkTo(g, 'greiz'))).toEqual(['A2Q3SuccessfulGreiz']);
    closeTalk(g);
    expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
    expect(log(g, 1, 3).icon).toBe('done');
  }, T);

  it('비전의 성역·소환사: Drognan 373 → 궁전 열림 (전에는 하렘 출구가 막힘) → 일지(396) = 협곡 포털 + A2Q4 완료, 소환사 처치 → 마을에서 보상', () => {
    const g = makeGame(1);
    // 궁전이 닫혀 있으면 마을 → 하렘 1층 출구가 막힌다 (QUESTS_LevelWarpCheck 근사)
    expect(g.questControl.exitBlocked(40, 50)).toBe(true);
    const h = g.exits.find((e) => e.to === 'harem1')!;
    g.changeLevel(g.levelId, h.x + 0.5, h.y + 0.5);
    const blocked = run(g, 2);
    expect(g.levelId).toBe('lutgholein');
    expect(blocked.some((e) => e.type === 'exitBlocked')).toBe(true);
    // A2Q4 는 A2Q3 이 끝나야 차례 (또는 지팡이를 만들면) — 여기서는 시퀀스를 직접: 호라드릭 지팡이를 큐브로
    const box = give(g, 'box');
    const staff = newItem('msf', QUALITY.UNIQUE), amu = newItem('vip', QUALITY.UNIQUE);
    for (const it of [staff, amu]) expect(g.store.cube.autoAdd(it)).toBe(true);
    g.openCube(box.id);
    g.enqueue({ type: 'transmute' });
    g.tick();
    expect(a2(g).stateOf(QW.A2Q4).state).toBe(1);
    expect(g.questControl.npcHasQuest('drognan')).toBe(true);
    expect(speechKeys(talkTo(g, 'drognan'))).toContain('A2Q4InitDrognan');
    closeTalk(g);
    expect(a2(g).palaceOpen).toBe(true);
    expect(g.questControl.exitBlocked(40, 50)).toBe(false);
    expect(log(g, 1, 4).status).toBe(2);
    // 비전의 성역: 일지를 읽으면 마기의 협곡으로 가는 붉은 포털
    goTo(g, 'arcane');
    expect(log(g, 1, 4).status).toBe(4);
    const j = opNear(g, 'arcane', 357);
    inner(g).events = [];
    g.operateObject(j);
    const evs = inner(g).events;
    expect(evs.some((e) => e.type === 'questScroll' && e.key === 'A2Q4SuccessfulNarrator')).toBe(true);
    expect(evs.some((e) => e.type === 'portalOpened' && e.to === 'canyon')).toBe(true);
    expect(rec(g, QW.A2Q4, QFLAG.REWARDGRANTED) && rec(g, QW.A2Q4, QFLAG.PRIMARYGOALDONE)).toBe(true);
    const red = inner(g).level.objects.find((o) => o.portal?.toLevel === 'canyon')!;
    run(g, 30);
    g.usePortal(red);
    expect(g.levelId).toBe('canyon');
    expect(a2(g).stateOf(QW.A2Q6).lastState).toBe(1);
    // 소환사
    goTo(g, 'arcane');
    const sm = mon(g, 'summoner');
    expect(sm, inner(g).level.monsters.map((m) => m.type.id).join(',')).toBeTruthy();
    killNear(g, sm);
    expect(rec(g, QW.A2Q5, QFLAG.REWARDPENDING)).toBe(true);
    run(g, 10);
    expect(log(g, 1, 5).status).toBe(4);
    expect(g.questControl.npcHasQuest('fara')).toBe(true);
    expect(speechKeys(talkTo(g, 'fara'))).toEqual(['A2Q5SuccessfulFara']);
    closeTalk(g);
    expect(rec(g, QW.A2Q5, QFLAG.REWARDGRANTED)).toBe(true);
  }, T);
});

d('Act 3 퀘스트', () => {
  it("Lam Esen's Tome: Alkor 549 → 사원의 책(bbb) → Alkor 564 = 스탯 포인트 +5", () => {
    const g = makeGame(2);
    const W = QW.A3Q1;
    goTo(g, 'lowerkurast');
    expect(g.questControl.npcHasQuest('alkor')).toBe(true);
    expect(speechKeys(talkTo(g, 'alkor'))).toEqual(['A3Q1InitAlkor']);
    closeTalk(g);
    const lv = levelWithObject(g, 193);
    g.operateObject(opNear(g, lv, 193));
    pickUpCode(g, 'bbb');
    expect(log(g, 2, 1).status).toBe(2);
    const sp = g.character!.statPoints;
    expect(speechKeys(talkTo(g, 'alkor'))).toEqual(['A3Q1SuccessfulAlkor']);
    expect(g.character!.statPoints).toBe(sp + 5);
    expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
    expect(rec(g, W, QFLAG.REWARDPENDING)).toBe(false);
    expect(hasCode(g, 'bbb')).toBe(false);
    closeTalk(g);
    expect(log(g, 2, 1).icon).toBe('done');
  }, T);

  it("Khalim's Will: 상자 3개(눈·뇌·심장)·평의회(도리깨) → 큐브 = 칼림의 의지 → 구슬을 두 번 쳐야 증오의 억류지가 열린다", () => {
    const g = makeGame(2);
    goTo(g, 'greatmarsh');
    expect(speechKeys(talkTo(g, 'cain3'))).toEqual(['A3Q2InitCain']);
    closeTalk(g);
    expect(rec(g, QW.A3Q2, QFLAG.STARTED)).toBe(true);
    for (const [key, cls, code] of [['spidercavern', 407, 'qey'], ['flayerdungeon3', 406, 'qbr'], ['kurastsewers2', 405, 'qhr']] as const) {
      g.operateObject(opNear(g, key, cls));
      pickUpCode(g, code);
    }
    // 평의회 (트라빈칼 슈퍼 유니크 3명): 첫 처치 = 칼림의 도리깨 (유니크)
    goTo(g, 'travincal');
    const council = inner(g).level.monsters.filter((m) => m.superUnique !== undefined && ['Toorc Icefist', 'Geleb Flamefinger', 'Ismail Vilehand'].includes(data.uniques!.superUnique(m.superUnique)!.key));
    expect(council.length).toBe(3);
    killNear(g, council[0]!);
    const flail = pickUpCode(g, 'qf1');
    expect(flail.quality).toBe(QUALITY.UNIQUE);
    // 억류지 입구는 닫혀 있다
    expect(g.questControl.exitBlocked(83, 100)).toBe(true);
    // Cain 에게 조각 (눈 545 → …)
    const heard: string[] = [];
    for (let i = 0; i < 5; i++) {
      heard.push(...speechKeys(talkTo(g, 'cain3')));
      closeTalk(g);
    }
    expect(heard.slice(0, 4).sort()).toEqual(['A3Q2EarlyReturnBrainCain', 'A3Q2EarlyReturnEyeCain', 'A3Q2EarlyReturnFlailCain', 'A3Q2EarlyReturnHeartCain'].sort());
    // 큐브 조립
    const box = give(g, 'box');
    for (const code of ['qf1', 'qey', 'qbr', 'qhr']) {
      const it = g.store.allItems().find((x) => x.code === code)!;
      g.store.consume(it.id);
      expect(g.store.cube.autoAdd(it), code).toBe(true);
    }
    g.openCube(box.id);
    const tr = (g.enqueue({ type: 'transmute' }), g.tick());
    expect(tr.some((e) => e.type === 'cubeQuestItem' && e.code === 'qf2')).toBe(true);
    const will = g.store.allItems().find((x) => x.code === 'qf2')!;
    expect(will).toBeTruthy();
    expect(log(g, 2, 2).status).toBe(6);
    // 구슬: 칼림의 의지를 손에 들고 두 번
    goTo(g, 'travincal');
    const orb = obj(g, 404);
    expect(orb, 'compelling orb').toBeTruthy();
    goTo(g, 'travincal', { x: orb.x + 2, y: orb.y + 2 });
    inner(g).events = [];
    g.operateObject(orb);
    expect(inner(g).events.some((e) => e.type === 'questSound' && e.sound === 19)).toBe(true);
    g.store.consume(will.id);
    g.store.equipment.rarm = will;
    g.operateObject(orb);
    expect(a3(g).orbSmashed).toBe(false);
    g.operateObject(orb);
    expect(a3(g).orbSmashed).toBe(true);
    expect(rec(g, QW.A3Q2, QFLAG.REWARDGRANTED)).toBe(true);
    expect(hasCode(g, 'qf2')).toBe(false);
    expect(g.questControl.exitBlocked(83, 100)).toBe(false);
    // 억류지 입구로 걸어 들어갈 수 있다
    const ex = g.exits.find((e) => e.to === 'durance1')!;
    g.changeLevel(g.levelId, ex.x + 0.5, ex.y + 0.5);
    run(g, 2);
    expect(g.levelId).toBe('durance1');
  }, T);

  it('Blade of the Old Religion: Hratli 571 → 미끼를 조작하면 7 틱 뒤 fetish11 보스 → 기드빈 → Ormus 587·593(레어 반지) + Asheara 589 (무료 용병) = 보상 받음', () => {
    const g = makeGame(2);
    const W = QW.A3Q3;
    goTo(g, 'flayerjungle');
    expect(g.questControl.npcHasQuest('hratli')).toBe(true);
    expect(speechKeys(talkTo(g, 'hratli'))).toEqual(['A3Q3InitHratli']);
    closeTalk(g);
    const decoy = opNear(g, 'flayerjungle', 252);
    g.operateObject(decoy);
    run(g, 10);
    const boss = mon(g, 'fetish11');
    expect(boss).toBeTruthy();
    killNear(g, boss);
    pickUpCode(g, 'g33');
    expect(log(g, 2, 3).status).toBe(4);
    const evs = talkTo(g, 'ormus');
    expect(speechKeys(evs)).toEqual(['A3Q3SuccessfulOrmus']);
    expect(rec(g, W, QFLAG.CUSTOM2)).toBe(true);
    expect(hasCode(g, 'g33')).toBe(false);
    closeTalk(g);
    expect(speechKeys(talkTo(g, 'ormus'))).toEqual(['A3Q3RewardOrmus']);
    closeTalk(g);
    const ring = g.store.allItems().find((x) => x.code === 'rin')!;
    expect(ring.quality).toBe(QUALITY.RARE);
    expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(false);
    expect(speechKeys(talkTo(g, 'asheara'))).toEqual(['A3Q3SuccessfulAsheara']);
    closeTalk(g);
    expect(g.merc).not.toBeNull();
    expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
    expect(log(g, 2, 3).icon).toBe('done');
  }, T);

  it('The Golden Bird: Act 3 첫 보스가 옥 조각상 → Cain 527 → Meshif 529 (황금새) → Cain 531 → Alkor 534 → 마을을 떠났다 오면 538 = 생명의 물약 (+20 생명)', () => {
    const g = makeGame(2);
    const W = QW.A3Q4;
    goTo(g, 'spiderforest');
    const boss = inner(g).level.monsters.find((m) => (m.flags & 10) !== 0 && !m.type.flying && m.mode !== 'DT') ?? inner(g).spawnMonster('fetish1', g.snapshot().player.x + 2, g.snapshot().player.y);
    if (!((boss.flags & 10) !== 0)) boss.flags |= 8;
    killNear(g, boss);
    pickUpCode(g, 'j34');
    expect(log(g, 2, 4).status).toBe(1);
    expect(speechKeys(talkTo(g, 'cain3'))).toEqual(['A3Q4Init1CainAct3']);
    closeTalk(g);
    expect(speechKeys(talkTo(g, 'meshif2'))).toEqual(['A3Q4Init2MeshifAct3']);
    closeTalk(g);
    expect(hasCode(g, 'g34') && !hasCode(g, 'j34')).toBe(true);
    expect(speechKeys(talkTo(g, 'cain3'))).toEqual(['A3Q4Init3CainAct3']);
    closeTalk(g);
    expect(speechKeys(talkTo(g, 'alkor'))).toContain('A3Q4AfterInitAlkor');
    closeTalk(g);
    expect(rec(g, W, QFLAG.REWARDPENDING)).toBe(true);
    // 바로 다시 말을 걸면 아무 말 없음 (bGoldenBirdBroughtToAlkor)
    expect(speechKeys(talkTo(g, 'alkor'))).toEqual([]);
    closeTalk(g);
    goTo(g, 'spiderforest');
    expect(speechKeys(talkTo(g, 'alkor'))).toEqual(['A3Q4SuccessfulAlkor']);
    closeTalk(g);
    expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
    const pot = g.store.allItems().find((x) => x.code === 'xyz')!;
    const life = g.character!.maxLife;
    g.enqueue({ type: 'useItem', itemId: pot.id });
    g.tick();
    expect(g.character!.maxLife).toBe(life + 20);
    expect(hasCode(g, 'xyz')).toBe(false);
  }, T);

  it('The Blackened Temple · The Guardian: 평의회 3명 → Cain 626, 메피스토 처치 = 영혼석·지옥문 → 지옥문으로 Act 4 (진행 값 3)', () => {
    const g = makeGame(2);
    goTo(g, 'kurastcauseway');
    expect(speechKeys(talkTo(g, 'ormus'))).toContain('A3Q5InitOrmus');
    closeTalk(g);
    goTo(g, 'travincal');
    const council = () => inner(g).level.monsters.filter((m) => m.superUnique !== undefined && m.mode !== 'DT' && m.mode !== 'DD' &&
      ['Toorc Icefist', 'Geleb Flamefinger', 'Ismail Vilehand'].includes(data.uniques!.superUnique(m.superUnique)!.key));
    for (const m of council()) killNear(g, m);
    expect(rec(g, QW.A3Q5, QFLAG.PRIMARYGOALDONE)).toBe(true);
    // 칼림의 의지 전: ENTERAREA (Cain 에게 도움)
    expect(rec(g, QW.A3Q5, QFLAG.ENTERAREA)).toBe(true);
    expect(log(g, 2, 5).status).toBe(4);
    expect(speechKeys(talkTo(g, 'cain3'))).toContain('A3Q5SuccessfulCainAct3');
    closeTalk(g);
    expect(rec(g, QW.A3Q5, QFLAG.REWARDGRANTED)).toBe(true);
    // 메피스토 (증오의 억류지 3층)
    goTo(g, 'durance3');
    const meph = mon(g, 'mephisto');
    expect(obj(g, 342).mode).toBe(OBJMODE.NEUTRAL);
    killNear(g, meph);
    run(g, 60);
    expect(rec(g, QW.A3Q6, QFLAG.REWARDGRANTED) && rec(g, QW.A3Q6, QFLAG.CUSTOM7)).toBe(true);
    expect(g.progression).toBe(3);
    expect(obj(g, 342).mode).toBe(OBJMODE.OPENED);
    expect(obj(g, 341).mode).toBe(OBJMODE.OPENED);
    pickUpCode(g, 'mss');
    g.operateObject(obj(g, 342));
    expect(g.act).toBe(3);
    expect(rec(g, QW.A3COMPLETED, QFLAG.REWARDGRANTED)).toBe(true);
  }, T);
});

d('Act 4 퀘스트·엔딩', () => {
  it('The Fallen Angel: Tyrael 670 → Izual 처치 → 영혼(izualghost) 675 → Tyrael 676 = 스킬 포인트 +2', () => {
    const g = makeGame(3);
    const W = QW.A4Q1;
    expect(g.questControl.npcHasQuest('tyrael2')).toBe(true);
    expect(speechKeys(talkTo(g, 'tyrael2'))).toEqual(['A4Q1InitTyrael']);
    closeTalk(g);
    goTo(g, 'plainsofdespair');
    expect(rec(g, W, QFLAG.LEAVETOWN)).toBe(true);
    const iz = mon(g, 'izual');
    killNear(g, iz);
    expect(rec(g, W, QFLAG.REWARDPENDING)).toBe(true);
    run(g, 6);
    expect(log(g, 3, 1).status).toBe(3);
    const ghost = g.npcs.find((n) => n.type.id === 'izualghost');
    expect(ghost).toBeTruthy();
    expect(speechKeys(talkTo(g, 'izualghost'))).toEqual(['A4Q1SuccessfulIzual']);
    closeTalk(g);
    expect(log(g, 3, 1).status).toBe(4);
    const sp = g.character!.skillPoints;
    expect(speechKeys(talkTo(g, 'tyrael2'))).toContain('A4Q1SuccessfulTyrael');
    closeTalk(g);
    expect(g.character!.skillPoints).toBe(sp + 2);
    expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
  }, T);

  it("Hell's Forge: Cain 679 (영혼석) → 헬포지에 영혼석 → Hephasto 의 망치를 들고 세 번 → 보석 4개 (완벽 1·흠 없는 2·보통 1) → Cain 680", () => {
    const g = makeGame(3);
    const W = QW.A4Q3;
    // A4Q1 을 끝낸 차례 (A4Q3 fState 1) — 기록으로
    const r = new QuestRecord();
    r.set(QW.A4Q1, QFLAG.REWARDGRANTED);
    const g2 = makeGame(3, { questFlags: r.toJSON() });
    expect(g2.questControl.npcHasQuest('cain4')).toBe(true);
    expect(speechKeys(talkTo(g2, 'cain4'))).toEqual(['A4Q3InitNoStoneCain']);
    closeTalk(g2);
    expect(hasCode(g2, 'mss')).toBe(true);
    void g;
    const forge = opNear(g2, 'riverofflame', 376);
    expect(forge.mode).toBe(OBJMODE.NEUTRAL);
    g2.operateObject(forge);
    run(g2, 30);
    expect(forge.mode).toBe(OBJMODE.OPENED);
    expect(hasCode(g2, 'mss')).toBe(false);
    const heph = mon(g2, 'hephasto');
    killNear(g2, heph);
    const hammer = pickUpCode(g2, 'hfh');
    expect(hammer.quality).toBe(QUALITY.UNIQUE);
    // 망치를 손에 들지 않으면 소리 19
    inner(g2).events = [];
    g2.operateObject(forge);
    expect(inner(g2).events.some((e) => e.type === 'questSound' && e.sound === 19)).toBe(true);
    wield(g2, hammer);
    goTo(g2, 'riverofflame', { x: forge.x + 2, y: forge.y + 2 });
    for (let i = 0; i < 3; i++) g2.operateObject(forge);
    expect(rec(g2, W, QFLAG.REWARDPENDING) && rec(g2, W, QFLAG.PRIMARYGOALDONE)).toBe(true);
    expect(hasCode(g2, 'hfh')).toBe(false);
    const before = new Set(inner(g2).level.ground.map((x) => x.item.id));
    run(g2, 120);
    const gems = inner(g2).level.ground.filter((x) => !before.has(x.item.id)).map((x) => x.item.code);
    expect(gems.length).toBe(4);
    expect(gems.filter((c) => HELLFORGE_GEMS[0]!.includes(c)).length).toBe(1);
    expect(gems.filter((c) => HELLFORGE_GEMS[1]!.includes(c)).length).toBe(2);
    expect(gems.filter((c) => HELLFORGE_GEMS[2]!.includes(c)).length).toBe(1);
    expect(speechKeys(talkTo(g2, 'cain4'))).toEqual(['A4Q3SuccessfulCain']);
    closeTalk(g2);
    expect(rec(g2, W, QFLAG.REWARDGRANTED)).toBe(true);
  }, T);

  it("Terror's End: 디아블로 처치 → A4Q2 보상 받음·진행 값 4·다음 난이도 해금 → 90 초 뒤 판데모니움 요새 (지옥 완료는 Hell 에 머문다)", () => {
    const g = makeGame(3);
    const W = QW.A4Q2;
    goTo(g, 'chaossanctuary');
    const dia = inner(g).spawnMonster('diablo', g.snapshot().player.x + 3, g.snapshot().player.y);
    inner(g).events = [];
    kill(g, dia);
    const evs = inner(g).events;
    expect(rec(g, W, QFLAG.REWARDGRANTED) && rec(g, W, QFLAG.PRIMARYGOALDONE)).toBe(true);
    expect(rec(g, W, QFLAG.CUSTOM2) && rec(g, W, QFLAG.CUSTOM3)).toBe(true);
    expect(g.difficultyUnlocked).toBe(1);
    expect(g.progression).toBe(4);
    expect(evs.some((e) => e.type === 'gameCompleted')).toBe(true);
    expect(a4(g).diabloKilled).toBe(true);
    // 엔딩 이동 (90 초)
    run(g, ENDING_WARP_TICKS - 100);
    expect(g.levelId).toBe('chaossanctuary');
    const end = run(g, 110);
    expect(g.levelId).toBe('pandemonium');
    expect(end.some((e) => e.type === 'questEnding')).toBe(true);
    // 끝낸 뒤 Tyrael·Cain 은 한 번씩 대사 (클래식 CUSTOM3·CUSTOM2)
    expect(speechKeys(talkTo(g, 'tyrael2'))).toContain('A4Q2SuccessfulTyrael');
    closeTalk(g);
    expect(rec(g, W, QFLAG.CUSTOM3)).toBe(false);
    // 지옥 난이도에서 끝내도 해금은 Hell 까지
    const h = makeGame(3, { difficulty: 2 });
    goTo(h, 'chaossanctuary');
    kill(h, inner(h).spawnMonster('diablo', h.snapshot().player.x + 3, h.snapshot().player.y));
    expect(h.difficultyUnlocked).toBe(2);
    expect(h.progression).toBe(12);
  }, T);
});

d('퀘스트 패널·저장 왕복', () => {
  it('퀘스트 창 탭 II~IV: 6·6·3 줄, 원작 순서 (Act 3: 황금새·기드빈·칼림·람 에센·검은 사원·수호자)', () => {
    const g = makeGame(1);
    expect(g.questLog(1).map((e) => e.quest)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(g.questLog(2).map((e) => e.quest)).toEqual([4, 3, 2, 1, 5, 6]);
    expect(g.questLog(3).map((e) => e.quest)).toEqual([1, 3, 2]);
    expect(g.questControl.availableActs).toEqual([0, 1, 2, 3]);
  }, T);

  it('저장 왕복: 기록 워드 → 새 게임에서 상태 복원 (궁전 열림·두리엘 방 포털·구슬·지옥문), 난이도 해금·진행 값', () => {
    const r = new QuestRecord();
    for (const w of [QW.A2Q2, QW.A2Q3, QW.A2Q6, QW.A3Q2, QW.A3Q6, QW.A4Q2]) {
      r.set(w, QFLAG.REWARDGRANTED);
      r.set(w, QFLAG.PRIMARYGOALDONE);
    }
    r.set(QW.A1COMPLETED, QFLAG.REWARDGRANTED);
    r.set(QW.A2Q1, QFLAG.REWARDPENDING);
    const ch = createCharacter(classStats(tables.table('charstats'), 'Sorceress'));
    const save = makeSave('Hero', ch, 0, { inventory: [], equipment: {}, questFlags: r.toJSON(), act: 1, difficultyUnlocked: 1, progression: 4 });
    const back = parseSave(serializeSave(save));
    expect(back.questFlags).toEqual(r.toJSON());
    expect(back.difficultyUnlocked).toBe(1);
    expect(back.progression).toBe(4);
    const g = makeGame(1, { questFlags: back.questFlags });
    // QUESTRECORD_CopyBufferToRecord: REWARDPENDING → COMPLETEDBEFORE, PGD 지움
    expect(rec(g, QW.A2Q1, QFLAG.COMPLETEDBEFORE)).toBe(true);
    expect(rec(g, QW.A2Q6, QFLAG.PRIMARYGOALDONE)).toBe(false);
    expect(a2(g).palaceOpen).toBe(true);
    expect(g.questControl.exitBlocked(40, 50)).toBe(false);
    expect(g.canTravelAct(2)).toBe(true);
    // 두리엘 방 포털은 오리피스가 생길 때 바로 열린다 (bDurielLairPortalNeedsToOpen)
    const tomb = levelWithObject(g, 152);
    opNear(g, tomb, 152);
    run(g, 3);
    expect(a2(g).tombOpen).toBe(true);
    expect(obj(g, 100)?.mode).toBe(OBJMODE.OPENED);
    // Act 3: 구슬 (A3Q2 보상 받음 → 억류지 열림), 지옥문 열림
    const g3 = makeGame(2, { questFlags: back.questFlags });
    expect(a3(g3).orbSmashed).toBe(true);
    expect(g3.questControl.exitBlocked(83, 100)).toBe(false);
    goTo(g3, 'durance3');
    expect(obj(g3, 342).mode).toBe(OBJMODE.OPENED);
    expect(g3.questLog(1).find((e) => e.quest === 6)!.icon).toBe('done');
  }, T);
});
