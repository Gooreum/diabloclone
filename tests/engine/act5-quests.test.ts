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
});
