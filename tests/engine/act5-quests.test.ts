// 확장팩 Act 5 퀘스트 (A5Q1~A5Q6) — 원작 상태 기계·보상.
// 출처: D2MOO D2Game/src/QUESTS/ACT5/A5Intro.cpp · A5Q1.cpp ~ A5Q6.cpp, UNIT/SUnitNpc.cpp (Larzuk 소켓·Anya 이름 새기기),
//       확장팩 string.tbl / expansionstring.tbl (대사·로그 문자열), objects.txt (퀘스트 오브젝트)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { GAME_DATA } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { actLevels, buildActWorld } from '../../src/data/world';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { isPersonalizable } from '../../src/engine/sockets';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { nearestWalkable } from '../../src/engine/path';
import { QFLAG, QuestRecord } from '../../src/engine/quests/record';
import { QW, questLogKeyActs } from '../../src/engine/quests/messages-acts';
import { NPC_MESSAGES_ACT5 } from '../../src/engine/quests/messages-act5';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import type { MonsterUnit } from '../../src/engine/ai';
import { questResistDiffs, type Act5Quests } from '../../src/engine/quests/act5';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));
const T = 240_000;
const SEED = 909;

let chain: MpqChain, tables: GameTables, data: GameData;

function makeGame(act = 4, questFlags?: number[], level = 40): Game {
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const ch = createCharacter(cs);
  ch.level = level;
  ch.maxLife = ch.life = 100000;
  const w = buildActWorld(chain, tables, data, SEED, act);
  const g = new Game({
    map: w.byKey.get(w.townId)!.def.map, levels: w.levels.map((l) => l.def), act, seed: SEED, data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), gold: 100000,
    ...(questFlags ? { questFlags } : {}),
  });
  g.onActChange = (a) => actLevels(buildActWorld(chain, tables, data, SEED, a));
  g.tick();
  return g;
}

type Inner = {
  events: GameEvent[]; killMonster(m: MonsterUnit, s: string): void; spawnMonster(id: string, x: number, y: number): MonsterUnit;
  level: { monsters: MonsterUnit[] };
};
const inner = (g: Game) => g as unknown as Inner;
const npcOf = (g: Game, id: string) => g.npcs.find((n) => n.type.id === id) as MonsterUnit;
const a5 = (g: Game) => g.questControl.get(4) as unknown as Act5Quests;
const rec = (g: Game, w: number, f: number) => g.questRecord.get(w, f);
const speechKeys = (evs: GameEvent[]) => evs.filter((e) => e.type === 'questSpeech').map((e) => String(e.key));

function goTo(g: Game, key: string): void {
  const def = g.levelDef(key)!;
  const p = nearestWalkable(def.map, def.portalSpot ?? { x: def.map.width / 2, y: def.map.height / 2 }, 400)!;
  g.changeLevel(key, p.x + 0.5, p.y + 0.5);
  (g as unknown as { exitHold: boolean }).exitHold = true;
  g.tick();
  inner(g).level.monsters.splice(0);
}
function talkTo(g: Game, id: string): GameEvent[] {
  if (!g.npcs.some((n) => n.type.id === id)) goTo(g, 'harrogath');
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
const menu = (g: Game, option: string) => {
  g.enqueue({ type: 'npcMenu', option } as never);
  return g.tick();
};
function newItem(code: string, quality: number = QUALITY.NORMAL, ilvl = 30): ItemInstance {
  const it = data.treasure.createItem(data.items.base(code)!, ilvl, new Rng(9), quality as ItemInstance['quality']);
  it.identified = true;
  return it;
}

describe.skipIf(!hasLod)('Act 5 퀘스트 (확장팩 원작 데이터)', () => {
  beforeAll(() => {
    chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
    tables = new GameTables(chain);
    data = buildGameData(chain, tables, { expansion: true });
  }, 180_000);

  it('대사 표 키가 모두 확장팩 string.tbl 에 있다', () => {
    const missing: string[] = [];
    for (const [w, tabs] of Object.entries(NPC_MESSAGES_ACT5)) for (const tb of tabs) for (const m of tb) if (tables.string(m.key) === m.key) missing.push(`${w}:${m.npc}:${m.key}`);
    expect(missing).toEqual([]);
  });

  describe('A5Q1', () => {
    it('Siege on Harrogath: Malah 첫 대화 → Larzuk 20077 시작 → Shenk 처치 → Larzuk 20090 → 소켓 (보통 아이템은 최대 소켓) → 보상 받음', () => {
      const g = makeGame();
      const W = QW.A5Q1;
      // Larzuk 은 마을 오브젝트 543 (InitFn 71) 이 세운다
      expect(npcOf(g, 'larzuk')).toBeTruthy();
      expect(g.questControl.npcHasQuest('larzuk')).toBe(false);
      talkTo(g, 'malah');
      g.enqueue({ type: 'npcMenu', option: 'talk' } as never);
      g.tick();
      closeTalk(g);
      expect(a5(g).stateOf(W).state).toBe(1);
      expect(g.questControl.npcHasQuest('larzuk')).toBe(true);
      expect(speechKeys(talkTo(g, 'larzuk'))).toEqual(['A5Q1InitLarzuk']);
      closeTalk(g);
      expect(rec(g, W, QFLAG.STARTED)).toBe(true);
      expect(questLogKeyActs(W, a5(g).status(W))).toBe('qsta5q11');
      // Shenk
      goTo(g, 'bloodyfoothills');
      const shenk = g.spawnSuperUnique(data.uniques!.superUnique('Siege Boss')!.idx, Math.floor(g.snapshot().player.x) + 4, Math.floor(g.snapshot().player.y))!;
      inner(g).events = [];
      inner(g).killMonster(shenk, 'player');
      expect(rec(g, W, QFLAG.REWARDPENDING) && rec(g, W, QFLAG.PRIMARYGOALDONE)).toBe(true);
      expect(inner(g).events.some((e) => e.type === 'questFx' && e.fx === 15)).toBe(true);
      expect(questLogKeyActs(W, a5(g).status(W))).toBe('qsta5q13');
      // Larzuk 보상 대사 → 소켓
      expect(speechKeys(talkTo(g, 'larzuk'))).toEqual(['A5Q1SuccessfulLarzuk']);
      expect(rec(g, W, QFLAG.CUSTOM1)).toBe(true);
      expect(g.snapshot().interaction?.options).toContain('socket');
      const sword = newItem('lsd', QUALITY.NORMAL, 30);
      g.store.inv.autoAdd(sword);
      menu(g, 'socket');
      expect(g.snapshot().interaction?.mode).toBe('socket');
      g.enqueue({ type: 'imbue', itemId: sword.id });
      const evs = g.tick();
      const done = evs.find((e) => e.type === 'socketed');
      expect(done?.sockets).toBe(Math.min(data.items.base('lsd')!.gemSockets, data.items.types.get(data.items.base('lsd')!.type)!.maxSock[1]));
      expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
      expect(rec(g, W, QFLAG.REWARDPENDING)).toBe(false);
      expect(g.snapshot().interaction?.options ?? []).not.toContain('socket');
    }, T);

    it('레어 아이템은 소켓 1 개, 소켓을 못 뚫는 아이템 (반지) 은 거절', () => {
      const r = new QuestRecord();
      r.set(QW.A5Q1, QFLAG.REWARDPENDING);
      const g = makeGame(4, r.toJSON());
      talkTo(g, 'larzuk');
      const ring = newItem('rin', QUALITY.MAGIC);
      g.store.inv.autoAdd(ring);
      menu(g, 'socket');
      g.enqueue({ type: 'imbue', itemId: ring.id });
      expect(g.tick().some((e) => e.type === 'socketFailed')).toBe(true);
      expect(rec(g, QW.A5Q1, QFLAG.REWARDPENDING)).toBe(true);
      const rare = newItem('lsd', QUALITY.RARE, 30);
      g.store.inv.autoAdd(rare);
      g.enqueue({ type: 'imbue', itemId: rare.id });
      expect(g.tick().find((e) => e.type === 'socketed')?.sockets).toBe(1);
    }, T);
  });

  describe('A5Q2', () => {
    /** 레벨로 가되 몬스터는 남긴다 (감옥 문) */
    const enter = (g: Game, key: string) => {
      const def = g.levelDef(key)!;
      const p = nearestWalkable(def.map, def.portalSpot ?? { x: def.map.width / 2, y: def.map.height / 2 }, 400)!;
      g.changeLevel(key, p.x + 0.5, p.y + 0.5);
      (g as unknown as { exitHold: boolean }).exitHold = true;
      g.tick();
    };

    it('Rescue on Mount Arreat: Qual-Kehk 20096 → 감옥 문 3 개를 부수면 포로 15 명 → 보상 대기 CUSTOM1 → Qual-Kehk 20110 룬 Tal·Ral·Ort → 고용 가능', () => {
      const r = new QuestRecord();
      r.set(QW.A5Q1, QFLAG.REWARDGRANTED);
      const g = makeGame(4, r.toJSON());
      const W = QW.A5Q2;
      expect(a5(g).stateOf(W).state).toBe(1);
      expect(g.questControl.npcHasQuest('qual-kehk')).toBe(true);
      expect(speechKeys(talkTo(g, 'qual-kehk'))).toEqual(['A5Q2InitQualKehk']);
      closeTalk(g);
      expect(rec(g, W, QFLAG.STARTED)).toBe(true);
      enter(g, 'frigidhighlands');
      const cages = (inner(g) as unknown as { level: { objects: { type: { id: number }; x: number; y: number }[] } }).level.objects.filter((o) => o.type.id === 473);
      expect(cages).toHaveLength(3);
      const pows = g.npcs.filter((n) => n.type.id === 'act5pow');
      expect(pows).toHaveLength(15);
      const doors = inner(g).level.monsters.filter((m) => m.type.id === 'prisondoor' && m.mode !== 'DD');
      expect(doors.length).toBeGreaterThanOrEqual(3);
      for (const door of doors) inner(g).killMonster(door, 'player');
      expect(rec(g, W, QFLAG.REWARDPENDING) && rec(g, W, QFLAG.PRIMARYGOALDONE)).toBe(true);
      expect(rec(g, W, QFLAG.CUSTOM1)).toBe(true);
      expect(a5(g).barbsToRescue()).toBe(0);
      for (let i = 0; i < 60; i++) g.tick();
      expect(g.npcs.filter((n) => n.type.id === 'act5pow')).toHaveLength(0);
      // Qual-Kehk 보상
      goTo(g, 'harrogath');
      expect(speechKeys(talkTo(g, 'qual-kehk'))).toContain('A5Q2SuccessfulQualKehk');
      closeTalk(g);
      expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
      const codes = g.store.allItems().map((it) => it.code);
      for (const c of ['r07', 'r08', 'r09']) expect(codes).toContain(c);
      expect(g.questDone('a5q2')).toBe(true);
    }, T);

    it('구출 14 명이면 룬 2 개 (CUSTOM2), 그 밖은 1 개 (CUSTOM3)', () => {
      for (const [flag, n] of [[QFLAG.CUSTOM2, 2], [QFLAG.CUSTOM3, 1]] as const) {
        const r = new QuestRecord();
        r.set(QW.A5Q1, QFLAG.REWARDGRANTED);
        r.set(QW.A5Q2, QFLAG.REWARDPENDING);
        r.set(QW.A5Q2, flag);
        const g = makeGame(4, r.toJSON());
        talkTo(g, 'qual-kehk');
        closeTalk(g);
        const runes = g.store.allItems().filter((it) => /^r0[789]$/.test(it.code)).map((it) => it.code);
        expect(runes).toEqual(['r07', 'r08', 'r09'].slice(0, n));
      }
    }, T);
  });
  describe('A5Q3', () => {
    type Obj = { id: number; type: { id: number }; x: number; y: number; mode: number };
    const objs = (g: Game) => (inner(g) as unknown as { level: { objects: Obj[] } }).level.objects;
    const prep = () => {
      const r = new QuestRecord();
      r.set(QW.A5Q1, QFLAG.REWARDGRANTED);
      r.set(QW.A5Q2, QFLAG.REWARDGRANTED);
      return r;
    };
    /** 얼음 강 (114) 에서 얼음 Anya 오브젝트 (558) — InitFn 67 자리에 25 프레임 뒤 */
    const frozenAnya = (g: Game): Obj => {
      goTo(g, 'frozenriver');
      for (let i = 0; i < 40 && !objs(g).some((o) => o.type.id === 558); i++) g.tick();
      const o = objs(g).find((x) => x.type.id === 558);
      expect(o, 'frozen anya').toBeTruthy();
      return o!;
    };

    it('Prison of Ice: Malah 20116 → 물약 없이 Anya (20131, Nihlathak 떠남) → Malah 물약 → 녹임 → 마을 Anya → 두루마리 저항 +10 → Anya 레어', () => {
      const g = makeGame(4, prep().toJSON());
      const W = QW.A5Q3;
      expect(a5(g).stateOf(W).state).toBe(1);
      expect(g.npcs.some((n) => n.type.id === 'nihlathak')).toBe(true);
      expect(g.npcs.some((n) => n.type.id === 'drehya')).toBe(false);
      expect(g.questControl.npcHasQuest('malah')).toBe(true);
      expect(speechKeys(talkTo(g, 'malah'))).toContain('A5Q3InitMalah');
      closeTalk(g);
      expect(rec(g, W, QFLAG.STARTED)).toBe(true);
      expect(a5(g).stateOf(W).lastState).toBe(1);
      // 물약 없이: 대사 20131, fState 4, 로그 3, Nihlathak 이 마을을 떠난다
      let anya = frozenAnya(g);
      expect(a5(g).stateOf(W).lastState).toBe(2);
      g.operateObject(anya as never);
      const evs = g.tick();
      expect(a5(g).stateOf(W).state).toBe(4);
      expect(a5(g).stateOf(W).lastState).toBe(3);
      expect(rec(g, W, QFLAG.PRIMARYGOALDONE)).toBe(false);
      expect(a5(g).nihlathakLeft()).toBe(true);
      void evs;
      goTo(g, 'harrogath');
      expect(g.npcs.some((n) => n.type.id === 'nihlathak')).toBe(false);
      // Malah: 해동 물약
      expect(g.questControl.npcHasQuest('malah')).toBe(true);
      expect(speechKeys(talkTo(g, 'malah'))).toContain('A5Q3FoundAnyaMalah');
      closeTalk(g);
      expect(g.store.allItems().some((it) => it.code === 'ice')).toBe(true);
      expect(g.questLog(4).find((e) => e.quest === 3)?.status).toBe(4);
      // 녹이기
      anya = frozenAnya(g);
      g.operateObject(anya as never);
      g.tick();
      expect(g.store.allItems().some((it) => it.code === 'ice')).toBe(false);
      expect(rec(g, W, QFLAG.PRIMARYGOALDONE) && rec(g, W, QFLAG.REWARDPENDING)).toBe(true);
      for (let i = 0; i < 10 && !g.npcs.some((n) => n.type.id === 'drehyaiced'); i++) g.tick();
      expect(g.npcs.some((n) => n.type.id === 'drehyaiced')).toBe(true);
      expect(objs(g).some((o) => o.type.id === 558)).toBe(false);
      for (let i = 0; i < 120; i++) g.tick();
      expect(g.npcs.some((n) => n.type.id === 'drehyaiced')).toBe(false);
      expect(objs(g).some((o) => o.type.id === 189)).toBe(true);
      // 마을: Anya 와 붉은 포털
      goTo(g, 'harrogath');
      expect(g.npcs.some((n) => n.type.id === 'drehya')).toBe(true);
      expect(objs(g).some((o) => o.type.id === 189)).toBe(true);
      // Malah 20132 → 저항 두루마리 (CUSTOM4)
      expect(speechKeys(talkTo(g, 'malah'))).toContain('A5Q3SuccessfulMalah');
      closeTalk(g);
      expect(rec(g, W, QFLAG.CUSTOM4)).toBe(true);
      expect(g.questLog(4).find((e) => e.quest === 3)?.status).toBe(6);
      const before = g.playerResist('fireresist'), beforeCold = g.playerResist('coldresist');
      const scroll = g.store.allItems().find((it) => it.code === 'tr2')!;
      expect(scroll).toBeTruthy();
      g.enqueue({ type: 'useItem', itemId: scroll.id });
      g.tick();
      expect(rec(g, W, QFLAG.CUSTOM3)).toBe(true);
      expect(g.store.allItems().some((it) => it.code === 'tr2')).toBe(false);
      expect(g.playerResist('fireresist')).toBe(before + 10);
      expect(g.playerResist('coldresist')).toBe(beforeCold + 10);
      // Anya 20136 → 직업 레어 (바바리안 보통: ba1~ba5)
      expect(g.questControl.npcHasQuest('drehya')).toBe(true);
      expect(speechKeys(talkTo(g, 'drehya'))).toContain('A5Q3SuccessfulAnya');
      closeTalk(g);
      const rare = g.store.allItems().find((it) => /^ba[1-5]$/.test(it.code));
      expect(rare?.quality).toBe(QUALITY.RARE);
      expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
      expect(rec(g, W, QFLAG.REWARDPENDING)).toBe(false);
      // 다시 불러와도 저항 +10 (기록에서 다시 계산), 다른 난이도 기록도 더한다
      const g2 = makeGame(4, g.questRecord.toJSON());
      const base = makeGame(4, prep().toJSON()).playerResist('fireresist');
      expect(g2.playerResist('fireresist')).toBe(base + 10);
      expect(g2.npcs.some((n) => n.type.id === 'drehya')).toBe(true);
      expect(g2.npcs.some((n) => n.type.id === 'nihlathak')).toBe(false);
    }, T);

    it('저항 두루마리: 난이도별 기록 합산 (questResistDiffs), 안 받은 두루마리는 못 읽음', () => {
      const w = new QuestRecord();
      w.set(QW.A5Q3, QFLAG.CUSTOM3);
      expect(questResistDiffs([w.toJSON(), w.toJSON(), null], 0)).toBe(1);
      expect(questResistDiffs([w.toJSON(), w.toJSON(), null], 2)).toBe(2);
      // CUSTOM4 없이 두루마리 사용 → 쓰지 못함
      expect(a5(makeGame(4, prep().toJSON())).useItem('tr2')).toBe(false);
    }, T);
  });
  describe('A5Q4', () => {
    type Obj = { id: number; type: { id: number }; portal?: { toLevel: string } };
    const objs = (g: Game) => (inner(g) as unknown as { level: { objects: Obj[] } }).level.objects;
    const prep = () => {
      const r = new QuestRecord();
      for (const w of [QW.A5Q1, QW.A5Q2, QW.A5Q3]) r.set(w, QFLAG.REWARDGRANTED);
      return r;
    };

    it('Betrayal of Harrogath: Anya 20137 → 신전 포털 → Nihlathak 처치 (FX 17) → Anya 20148 → 이름 새기기 (이름 앞에 붙음) → 끝', () => {
      const g = makeGame(4, prep().toJSON());
      Object.defineProperty(g, 'playerName', { value: 'Ruby' });
      const W = QW.A5Q4;
      expect(a5(g).stateOf(W).state).toBe(1);
      expect(g.questControl.npcHasQuest('drehya')).toBe(true);
      expect(speechKeys(talkTo(g, 'drehya'))).toEqual(['A5Q4InitAnya']);
      closeTalk(g);
      expect(rec(g, W, QFLAG.STARTED)).toBe(true);
      expect(a5(g).stateOf(W).lastState).toBe(1);
      const portal = objs(g).find((o) => o.type.id === 60 && o.portal?.toLevel === 'nihlathakstemple');
      expect(portal, 'temple portal').toBeTruthy();
      // 신전 → Halls of Vaught: Nihlathak (InitFn 69 오브젝트 자리)
      goTo(g, 'nihlathakstemple');
      expect(a5(g).stateOf(W).lastState).toBe(2);
      goTo(g, 'hallsofvaught');
      // goTo 는 몬스터를 비우므로 레벨을 다시 만들지 않고 Nihlathak 만 다시 (InitFn 69 가 이미 세웠으면 한 게임에 한 번 — 다시 못 만듦)
      expect(a5(g).nihlathakLeft()).toBe(true);
      expect((a5(g) as unknown as { q3: { nihTempleSpawned: boolean } }).q3.nihTempleSpawned).toBe(true);
      const suIdx = data.uniques!.superUnique('Nihlathak Boss')!.idx;
      (g as unknown as { bossFlags: Set<number> }).bossFlags.delete(suIdx);
      const nih = g.spawnSuperUnique(suIdx, Math.floor(g.snapshot().player.x) + 4, Math.floor(g.snapshot().player.y), undefined, true)!;
      expect(nih, 'nihlathak').toBeTruthy();
      inner(g).events = [];
      inner(g).killMonster(nih, 'player');
      expect(rec(g, W, QFLAG.REWARDPENDING) && rec(g, W, QFLAG.PRIMARYGOALDONE)).toBe(true);
      expect(inner(g).events.some((e) => e.type === 'questFx' && e.fx === 17)).toBe(true);
      for (let i = 0; i < 12; i++) g.tick();
      expect(questLogKeyActs(W, a5(g).status(W))).toBe('qstsa5q43');
      // Anya: 20148 → 이름 새기기
      expect(speechKeys(talkTo(g, 'drehya'))).toContain('A5Q4SuccessfulAnya');
      expect(rec(g, W, QFLAG.ENTERAREA)).toBe(true);
      expect(questLogKeyActs(W, a5(g).status(W))).toBe('qstsa5q43a');
      expect(g.snapshot().interaction?.options).toContain('personalize');
      const ring = newItem('rin', QUALITY.MAGIC);
      g.store.inv.autoAdd(ring);
      menu(g, 'personalize');
      expect(g.snapshot().interaction?.mode).toBe('personalize');
      // 반지 (misc nameable 아님) 는 거절
      g.enqueue({ type: 'imbue', itemId: ring.id });
      expect(g.tick().some((e) => e.type === 'personalizeFailed')).toBe(true);
      const cap = newItem('cap', QUALITY.NORMAL);
      g.store.inv.autoAdd(cap);
      g.enqueue({ type: 'imbue', itemId: cap.id });
      const done = g.tick().find((e) => e.type === 'personalized');
      expect(done?.name).toBe('Ruby');
      const named = g.store.allItems().find((it) => it.id === done?.itemId)!;
      expect(named.personalized).toBe('Ruby');
      expect(rec(g, W, QFLAG.REWARDGRANTED)).toBe(true);
      expect(g.snapshot().interaction?.options ?? []).not.toContain('personalize');
      // 이미 새긴 아이템은 다시 못 새김
      expect(isPersonalizable(data.items, named)).toBe(false);
      expect(isPersonalizable(data.items, newItem('cap', QUALITY.NORMAL))).toBe(true);
    }, T);
  });
  describe('A5Q5', () => {
    type Obj = { id: number; type: { id: number }; mode: number; x: number; y: number };
    const objs = (g: Game) => (inner(g) as unknown as { level: { objects: Obj[] } }).level.objects;
    const prep = () => {
      const r = new QuestRecord();
      for (const w of [QW.A5Q1, QW.A5Q2, QW.A5Q3, QW.A5Q4]) r.set(w, QFLAG.REWARDGRANTED);
      return r;
    };
    const ancients = (g: Game) => inner(g).level.monsters.filter((m) => /^ancientbarb[123]$/.test(m.type.id) && m.mode !== 'DD' && m.mode !== 'DT');
    /** Summit 으로 (몬스터는 남긴다 — 석상·고대인) */
    const enterSummit = (g: Game) => {
      const def = g.levelDef('arreatsummit')!;
      const p = nearestWalkable(def.map, def.portalSpot ?? { x: def.map.width / 2, y: def.map.height / 2 }, 400)!;
      g.changeLevel('arreatsummit', p.x + 0.5, p.y + 0.5);
      (g as unknown as { exitHold: boolean }).exitHold = true;
      g.tick();
    };
    const altarOn = (g: Game) => {
      const altar = objs(g).find((o) => o.type.id === 546)!;
      expect(altar, 'altar').toBeTruthy();
      g.operateObject(altar as never);
      for (let i = 0; i < 30 && ancients(g).length < 3; i++) g.tick();
    };

    it('Rite of Passage: Qual-Kehk 20153 → Summit (문이 닫힘) → 제단 20002 → 석상에서 고대인 3 명 → 모두 처치 → 경험치 (한 레벨 폭)·문 열림', () => {
      const g = makeGame(4, prep().toJSON(), 40);
      const W = QW.A5Q5;
      expect(a5(g).stateOf(W).state).toBe(1);
      expect(g.questControl.npcHasQuest('qual-kehk')).toBe(true);
      expect(speechKeys(talkTo(g, 'qual-kehk'))).toContain('A5Q5InitQualKehk');
      closeTalk(g);
      expect(rec(g, W, QFLAG.STARTED)).toBe(true);
      expect(questLogKeyActs(W, a5(g).status(W))).toBe('qstsa5q51');
      enterSummit(g);
      expect(a5(g).stateOf(W).lastState).toBe(2);
      expect(g.questControl.exitBlocked(120, 118)).toBe(true);
      expect(g.questControl.exitBlocked(120, 128)).toBe(true);
      expect(objs(g).filter((o) => [474, 475, 476].includes(o.type.id))).toHaveLength(3);
      // 제단
      altarOn(g);
      expect(a5(g).stateOf(W).lastState).toBe(3);
      expect(questLogKeyActs(W, a5(g).status(W))).toBe('qstsa5q53');
      const three = ancients(g);
      expect(three.map((m) => m.type.id).sort()).toEqual(['ancientbarb1', 'ancientbarb2', 'ancientbarb3']);
      expect(a5(g).ancientsActivatable()).toBe(true);
      const exp0 = g.character!.experience, lvl0 = g.character!.level;
      const span = (g as unknown as { expTable: { threshold(l: number): number } }).expTable;
      for (const m of three) inner(g).killMonster(m, 'player');
      expect(rec(g, W, QFLAG.REWARDGRANTED) && rec(g, W, QFLAG.PRIMARYGOALDONE)).toBe(true);
      expect(g.character!.experience - exp0).toBe(Math.min(1_400_000, span.threshold(lvl0 + 1) - span.threshold(lvl0)));
      expect(g.questControl.exitBlocked(120, 128)).toBe(false);
      expect(g.questControl.exitBlocked(120, 118)).toBe(false);
      expect(objs(g).some((o) => o.type.id === 561)).toBe(true);
      expect(questLogKeyActs(W, a5(g).status(W))).toBe('qstsComplete');
      // 마을 사람 끝 대사 (CUSTOM1)
      expect(speechKeys(talkTo(g, 'larzuk'))).toContain('A5Q5SuccessfulLarzuk');
      expect(rec(g, W, QFLAG.CUSTOM1)).toBe(true);
    }, T);

    it('Summit 에 마을 포털을 열면 고대인이 사라지고 다시 제단부터, 레벨 20 미만이면 보상 없이 끝남 (COMPLETEDNOW)', () => {
      const g = makeGame(4, prep().toJSON(), 15);
      enterSummit(g);
      altarOn(g);
      expect(ancients(g)).toHaveLength(3);
      // 마을 포털 (원작: 두루마리·스킬 명령 — 틱 안의 사건이 퀘스트로 간다). 여기서는 직접 열고 그 틱의 사건을 넘긴다
      const fire = (fn: () => void) => {
        inner(g).events = [];
        fn();
        g.questControl.gameEvents(inner(g).events);
      };
      fire(() => g.castTownPortal());
      expect(ancients(g)).toHaveLength(0);
      expect(a5(g).ancientsActivatable()).toBe(false);
      expect(objs(g).find((o) => o.type.id === 546)?.mode).toBe(0);
      // 포털을 닫고 (새 포털이 아니라 닫기만 — 근사: 마을에서 돌아와 포털을 쓰면 닫힘) 다시 제단
      fire(() => (g as unknown as { closeTownPortal(): void }).closeTownPortal());
      altarOn(g);
      expect(ancients(g)).toHaveLength(3);
      for (const m of ancients(g)) inner(g).killMonster(m, 'player');
      expect(rec(g, QW.A5Q5, QFLAG.REWARDGRANTED)).toBe(false);
      expect(rec(g, QW.A5Q5, QFLAG.COMPLETEDNOW)).toBe(true);
    }, T);
  });
  describe('A5Q6', () => {
    type Obj = { id: number; type: { id: number }; mode: number; x: number; y: number };
    const objs = (g: Game) => (inner(g) as unknown as { level: { objects: Obj[] } }).level.objects;
    const prep = () => {
      const r = new QuestRecord();
      for (const w of [QW.A5Q1, QW.A5Q2, QW.A5Q3, QW.A5Q4, QW.A5Q5]) r.set(w, QFLAG.REWARDGRANTED);
      return r;
    };
    const enter = (g: Game, key: string) => {
      const def = g.levelDef(key)!;
      const p = nearestWalkable(def.map, def.portalSpot ?? { x: def.map.width / 2, y: def.map.height / 2 }, 400)!;
      g.changeLevel(key, p.x + 0.5, p.y + 0.5);
      (g as unknown as { exitHold: boolean }).exitHold = true;
      g.tick();
    };

    it('Eve of Destruction: 왕좌 — 시체 폭발·250 프레임 → Baal Subject 1~5 무리 (처치마다 다음) → baalcrabstairs 가 포털로 가서 Chamber 가 열림', () => {
      const g = makeGame(4, prep().toJSON(), 90);
      const W = QW.A5Q6;
      expect(a5(g).stateOf(W).state).toBe(2);
      expect(questLogKeyActs(W, a5(g).status(W))).toBe('qstsa5q61a');
      enter(g, 'throneofdestruction');
      expect(a5(g).stateOf(W).lastState).toBe(2);
      expect(g.questControl.exitBlocked(131, 132)).toBe(true);
      const throne = inner(g).level.monsters.find((m) => m.type.id === 'baalthrone')!;
      expect(throne, 'baal throne').toBeTruthy();
      const portal = objs(g).find((o) => o.type.id === 563)!;
      expect(portal, 'chamber portal').toBeTruthy();
      // 플레이어를 왕좌 곁에
      const spot = nearestWalkable(g.map, { x: throne.x, y: throne.y + 6 }, 10)!;
      g.changeLevel(g.levelId, spot.x + 0.5, spot.y + 0.5);
      const subjects: string[] = [];
      for (let i = 0; i < 6000 && !a5(g).worldstoneChamberOpen(); i++) {
        g.character!.life = g.maxLife();
        g.tick();
        const wave = inner(g).level.monsters.filter((m) => m.waveOwner === throne.id && m.mode !== 'DD' && m.mode !== 'DT');
        if (wave.length) {
          const su = wave.find((m) => m.superUnique !== undefined);
          if (su) subjects.push(data.uniques!.superUnique(su.superUnique!)!.key);
          for (const m of wave) inner(g).killMonster(m, 'player');
        }
      }
      expect(subjects).toEqual(['Baal Subject 1', 'Baal Subject 2', 'Baal Subject 3', 'Baal Subject 4', 'Baal Subject 5']);
      expect(a5(g).worldstoneChamberOpen()).toBe(true);
      expect(a5(g).stateOf(W).lastState).toBe(3);
      expect(g.questControl.exitBlocked(131, 132)).toBe(false);
      expect(inner(g).level.monsters.some((m) => m.type.id === 'baalcrabstairs' || m.type.id === 'baalthrone')).toBe(false);
      // 포털 563 → Worldstone Chamber
      g.operateObject(portal as never);
      g.tick();
      expect(g.levelId).toBe('worldstonechamber');
    }, T);

    it('Baal 처치 (Chamber): 보상·진행 값 5·다음 난이도·금화·FX 19 → Tyrael3 → 대화 뒤 마지막 포털 → Harrogath·엔딩 (확장팩)', () => {
      const g = makeGame(4, prep().toJSON(), 90);
      const W = QW.A5Q6;
      // Chamber 를 연 뒤로 (왕좌 단계는 앞 테스트)
      (a5(g) as unknown as { q6: { wscOpen: boolean } }).q6.wscOpen = true;
      enter(g, 'worldstonechamber');
      const baal = inner(g).level.monsters.find((m) => m.type.id === 'baalcrab')!;
      expect(baal, 'baal').toBeTruthy();
      const gold0 = inner(g).events.length;
      void gold0;
      inner(g).events = [];
      inner(g).killMonster(baal, 'player');
      expect(rec(g, W, QFLAG.REWARDGRANTED) && rec(g, W, QFLAG.PRIMARYGOALDONE)).toBe(true);
      expect(inner(g).events.some((e) => e.type === 'questFx' && e.fx === 19)).toBe(true);
      expect(g.progression).toBe(5);
      expect(g.difficultyUnlocked).toBe(1);
      const gold = (inner(g) as unknown as { level: { ground: { item: { code: string; quantity: number } }[] } }).level.ground.filter((x) => x.item.code === 'gld');
      expect(gold.some((x) => x.item.quantity >= 1500 && x.item.quantity <= 3000)).toBe(true);
      expect(questLogKeyActs(W, a5(g).status(W))).toBe('qstsa5q63');
      for (let i = 0; i < 70 && !g.npcs.some((n) => n.type.id === 'tyrael3'); i++) g.tick();
      expect(g.npcs.some((n) => n.type.id === 'tyrael3')).toBe(true);
      // Tyrael 이야기 → 닫으면 마지막 포털 (565)
      expect(speechKeys(talkTo(g, 'tyrael3'))).toContain('A5Q6SuccessfulTyrael');
      closeTalk(g);
      const last = (inner(g) as unknown as { level: { objects: Obj[] } }).level.objects.find((o) => o.type.id === 565)!;
      expect(last, 'last portal').toBeTruthy();
      for (let i = 0; i < 30; i++) g.tick();
      inner(g).events = [];
      g.operateObject(last as never);
      const evs = [...inner(g).events];
      g.tick();
      expect(g.levelId).toBe('harrogath');
      expect(evs.some((e) => e.type === 'gameCompleted' && e.expansion === true)).toBe(true);
      expect(rec(g, W, QFLAG.CUSTOM6)).toBe(true);
      // 마을: Larzuk 끝 대사 (ENTERAREA), Cain 은 CUSTOM6 뒤 없음
      expect(speechKeys(talkTo(g, 'larzuk'))).toContain('A5Q6SuccessfulLarzuk');
      expect(rec(g, W, QFLAG.ENTERAREA)).toBe(true);
      expect(g.questControl.npcHasQuest('cain6')).toBe(false);
    }, T);
  });
});
