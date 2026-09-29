// 다막·난이도 구조 (Phase 1): 막 전환·막 사이 웨이포인트·막별 마을 포털·부활, 저장 새 필드·예전 저장 호환, DifficultyLevels.txt 규칙.
// 기대값 출처: levels.txt (Act·Waypoint 칸 — Lut Gholein 40 은 Act 1(0부터)·웨이포인트 9, Rocky Waste 41 은 Act 1·웨이포인트 없음),
//             DifficultyLevels.txt (ResistPenalty 0/−40/−100, DeathExpPenalty 0/5/10, MonsterSkillBonus 0/3/7),
//             D2MOO DRLG_AllocDrlg (막 단위 DRLG), D2GAME_WAYPOINT_Unk_6FC79600 (다른 막 웨이포인트 → 막 전환)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { actTownKey, buildActWorld, levelKey } from '../../src/data/world';
import { ACT_DRLG, ACT_TOWNS, actAvailable } from '../../src/engine/drlg/acts';
import { Game, type ActLevels, type GameData, type LevelDef } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { QUALITY } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { SUBCLASS, type ObjectUnit } from '../../src/engine/objects';
import { difficultyRules } from '../../src/engine/difficulty';
import { makeSave, mergeDifficulty, parseSave, serializeSave } from '../../src/engine/save';
import { QuestControl } from '../../src/engine/quests/index';
import { AI_TABLE, hasAi } from '../../src/engine/ai/index';
import type { Character } from '../../src/engine/player';

const d = hasGameData ? describe : describe.skip;

let tables: GameTables;
let data: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
});

/** 빈 방 레벨 (서브타일 60×60, 가장자리 막힘) */
function openMap(w = 60, h = 60): CollisionMap {
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

/** Act 1 (합성): Cold Plains(웨이포인트 1) + 마을 */
function act1Levels(): LevelDef[] {
  return [
    { id: 'coldplains', map: openMap(), inTown: false, exits: [], levelNo: 3, objects: [{ classId: 119, x: 30, y: 30 }] },
    { id: 'town', map: openMap(), inTown: true, exits: [], levelNo: 1, objects: [{ classId: 119, x: 40, y: 20 }], portalSpot: { x: 40, y: 40 } },
  ];
}

/** 합성 Act 2 월드 (Phase 2 가 원작 DRLG 로 바꾸기 전 막 전환 시험용): Lut Gholein(40, 웨이포인트 9) + Rocky Waste(41) */
function stubAct2(): ActLevels {
  return {
    levels: [
      { id: 'lutgholein', map: openMap(), inTown: true, exits: [{ x: 57, y: 10, w: 2, h: 40, to: 'level41', toX: 4, toY: 20 }], levelNo: 40, objects: [{ classId: 119, x: 30, y: 45 }], portalSpot: { x: 25, y: 25 } },
      { id: 'level41', map: openMap(), inTown: false, exits: [], levelNo: 41 },
    ],
    start: { x: 20.5, y: 20.5 },
  };
}

function makeGame(extra: Partial<ConstructorParameters<typeof Game>[0]> = {}, levels = act1Levels(), start = { x: 20.5, y: 20.5 }): Game {
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  return new Game({
    map: levels[0]!.map, levels, seed: 21, data, player: { x: start.x, y: start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), ...extra,
  });
}

/** 오브젝트까지 걸어가서 조작 */
function interact(g: Game, o: ObjectUnit, ticks = 200): void {
  g.enqueue({ type: 'interact', unitId: o.id });
  for (let i = 0; i < ticks; i++) {
    g.tick();
    if (!g.snapshot().player.mode.match(/WL|RN/) && i > 2) break;
  }
}

d('막 전환 (Game.changeAct / onActChange)', () => {
  it('없는 막은 onActChange 로 요청해 만들고, 막마다 레벨 캐시를 따로 둔다', () => {
    const g = makeGame();
    const asked: number[] = [];
    g.onActChange = (act) => {
      asked.push(act);
      return act === 1 ? stubAct2() : null;
    };
    expect(g.act).toBe(0);
    expect(g.changeAct(2)).toBe(false); // 월드가 없는 막 (Act 3)
    expect(g.act).toBe(0);
    expect(g.changeAct(1)).toBe(true);
    g.tick();
    expect(g.act).toBe(1);
    expect(g.levelId).toBe('lutgholein');
    expect(g.inTown).toBe(true);
    // 도착 = 막 시작 위치 근처
    const p = g.snapshot().player;
    expect(Math.hypot(p.x - 20.5, p.y - 20.5)).toBeLessThan(2);
    // 이미 만든 막은 다시 요청하지 않는다 (막 캐시)
    g.changeLevel('town', 20.5, 20.5);
    expect(g.act).toBe(0);
    expect(g.changeAct(1)).toBe(true);
    expect(asked).toEqual([2, 1]);
    // 다른 막 레벨도 levelDef·levelKeyOf 로 찾는다
    expect(g.levelDef('coldplains')?.levelNo).toBe(3);
    expect(g.levelKeyOf(41)).toBe('level41');
    expect(g.townOf(0)).toBe('town');
    expect(g.townOf(1)).toBe('lutgholein');
  });

  it('새 막 안에서는 출구로 레벨을 옮겨도 막이 그대로', () => {
    const g = makeGame();
    g.onActChange = (act) => (act === 1 ? stubAct2() : null);
    g.changeAct(1);
    const evs: { type: string; act?: unknown }[] = [];
    g.enqueue({ type: 'move', x: 58, y: 20, run: true });
    for (let i = 0; i < 300 && g.levelId === 'lutgholein'; i++) evs.push(...g.tick());
    expect(g.levelId).toBe('level41');
    expect(g.act).toBe(1);
    expect(evs.some((e) => e.type === 'levelChanged')).toBe(true);
  });

  it('죽으면 지금 막 마을에서 부활 (respawnInTown)', () => {
    const g = makeGame();
    g.onActChange = (act) => (act === 1 ? stubAct2() : null);
    g.changeAct(1, { levelId: 'level41', x: 30.5, y: 30.5 });
    expect(g.levelId).toBe('level41');
    g.respawnInTown();
    expect(g.levelId).toBe('lutgholein');
    expect(g.act).toBe(1);
  });

  it('마을 포털은 지금 막 마을로 열린다', () => {
    const tsc = data.treasure.createItem(data.items.base('tsc')!, 1, new Rng(5), QUALITY.NORMAL);
    const g = makeGame({ inventory: [tsc] });
    g.onActChange = (act) => (act === 1 ? stubAct2() : null);
    g.changeAct(1, { levelId: 'level41', x: 20.5, y: 22.5 });
    g.tick();
    const scroll = [...g.inventory, ...g.store.belt].find((i) => i?.code === 'tsc')!;
    g.enqueue({ type: 'useItem', itemId: scroll.id });
    g.tick();
    expect(g.townPortal).toMatchObject({ fieldLevel: 'level41', townLevel: 'lutgholein' });
    const field = g.objects.find((o) => o.id === g.townPortal!.fieldId)!;
    for (let i = 0; i < 17; i++) g.tick();
    interact(g, field);
    expect(g.levelId).toBe('lutgholein');
    expect(g.objectsOf('town').some((o) => o.type.id === 59)).toBe(false);
  });
});

d('막 사이 웨이포인트 (levels.txt Waypoint 번호는 전역)', () => {
  it('levels.txt: Lut Gholein(40) = Act 2(1)·웨이포인트 9, 마을은 막마다 ACT_TOWNS', () => {
    expect(data.objects!.levels.get(40)).toMatchObject({ act: 1, waypoint: 9 });
    expect(data.objects!.levels.get(75)).toMatchObject({ act: 2, waypoint: 18 });
    expect(data.objects!.levels.get(103)).toMatchObject({ act: 3, waypoint: 27 });
    expect(ACT_TOWNS).toEqual([1, 40, 75, 103]);
    expect([actTownKey(0), actTownKey(1), levelKey(41)]).toEqual(['town', 'lutgholein', 'level41']);
  });

  it('Act 1 웨이포인트에서 Act 2 마을로: 번호로 가면 그 막 월드를 요청하고 막을 바꾼다, 돌아올 수도 있다', () => {
    const g = makeGame({ waypoints: [9] });
    let asked = 0;
    g.onActChange = (act) => {
      asked++;
      return act === 1 ? stubAct2() : null;
    };
    g.tick();
    const wp = g.objects.find((o) => o.type.subClass & SUBCLASS.WAYPOINT)!;
    interact(g, wp);
    expect(g.waypointOpen).not.toBeNull();
    const evs: string[] = [];
    g.enqueue({ type: 'waypoint', level: 40 });
    for (const e of g.tick()) evs.push(e.type);
    expect(asked).toBe(1);
    expect(g.act).toBe(1);
    expect(g.levelId).toBe('lutgholein');
    expect(evs).toEqual(expect.arrayContaining(['actChanged', 'levelChanged', 'waypointTravel']));
    // Act 2 웨이포인트 → Act 1 Cold Plains (레벨 키로도)
    const wp2 = g.objects.find((o) => o.type.subClass & SUBCLASS.WAYPOINT)!;
    interact(g, wp2);
    g.enqueue({ type: 'waypoint', level: 'coldplains' });
    g.tick();
    expect(g.act).toBe(0);
    expect(g.levelId).toBe('coldplains');
    expect(asked).toBe(1);
  });

  it('활성 안 된 다른 막 웨이포인트·월드가 없는 막으로는 못 간다', () => {
    const g = makeGame();
    g.onActChange = () => null;
    g.tick();
    const wp = g.objects.find((o) => o.type.subClass & SUBCLASS.WAYPOINT)!;
    interact(g, wp);
    g.enqueue({ type: 'waypoint', level: 40 });
    g.tick();
    expect(g.levelId).toBe('coldplains');
    g.waypoints.activate(9);
    interact(g, wp);
    g.enqueue({ type: 'waypoint', level: 40 });
    g.tick();
    expect(g.act).toBe(0);
    expect(g.levelId).toBe('coldplains');
  });
});

d('막 등록표 (drlg/acts.ts · world.ts)', () => {
  it('Act 1 만 만들 수 있고, 다른 막은 "아직 없음" 오류', () => {
    expect(actAvailable(0)).toBe(true);
    expect(ACT_DRLG[0]!.levels).toContain(38);
    for (const a of [1, 2, 3]) {
      expect(actAvailable(a)).toBe(false);
      expect(() => buildActWorld(gameChain(), tables, data, 1, a)).toThrow(/not implemented yet/);
    }
  });

  it('buildActWorld(0) 은 기존 Act 1 월드와 같다 (마을·시작 위치·레벨 수)', () => {
    const w = buildActWorld(gameChain(), tables, data, 1234, 0);
    expect(w.act).toBe(0);
    expect(w.townId).toBe('town');
    expect(w.byKey.get('town')?.def.inTown).toBe(true);
    expect(w.levels).toHaveLength(ACT_DRLG[0]!.levels.length);
    expect(w.byKey.get('town')!.def.map.walkable(Math.floor(w.start.x), Math.floor(w.start.y))).toBe(true);
    expect(w.tristram).not.toBeNull();
  });
});

d('난이도 규칙 (DifficultyLevels.txt)', () => {
  it('Normal / Nightmare / Hell: ResistPenalty 0/−40/−100, DeathExpPenalty 0/5/10, MonsterSkillBonus 0/3/7', () => {
    const rows = tables.table('DifficultyLevels');
    const r = [0, 1, 2].map((i) => difficultyRules(rows, i as 0 | 1 | 2));
    expect(r.map((x) => x.resistPenalty)).toEqual([0, -40, -100]);
    expect(r.map((x) => x.deathExpPenalty)).toEqual([0, 5, 10]);
    expect(r.map((x) => x.monsterSkillBonus)).toEqual([0, 3, 7]);
    expect(r.map((x) => x.monsterColdDivisor)).toEqual([1, 2, 4]);
    expect(r.map((x) => x.aiCurseDivisor)).toEqual([1, 2, 4]);
    expect(r.map((x) => x.lifeStealDivisor)).toEqual([1, 2, 3]);
    expect(r.map((x) => x.championDamageBonus)).toEqual([90, 75, 66]);
    expect(r.map((x) => x.monsterCEDamagePercent)).toEqual([50, 35, 20]);
  });

  it('행이 없으면 Normal 값, Game.rules 는 난이도 행', () => {
    expect(difficultyRules(undefined, 2)).toMatchObject({ resistPenalty: 0, deathExpPenalty: 0, aiCurseDivisor: 1, championDamageBonus: 90 });
    expect(makeGame({ difficulty: 2 }).rules.deathExpPenalty).toBe(10);
    expect(makeGame().rules.deathExpPenalty).toBe(0);
  });
});

describe('저장: 막·난이도 필드', () => {
  const ch: Character = { cls: 'Paladin', level: 30, experience: 1e6, str: 60, dex: 40, vit: 80, ene: 20, statPoints: 0, skillPoints: 0, maxLife: 400, maxMana: 80, maxStamina: 200, life: 400, mana: 80, stamina: 200, skills: {}, leftSkill: 0, rightSkill: 0 };

  it('왕복: act·difficulty·difficultyUnlocked·난이도별 웨이포인트/퀘스트', () => {
    const byDiff = mergeDifficulty({ waypointsByDiff: [[0, 1, 9], [0, 3]], questFlagsByDiff: [[1, 2, 3], null] }, 1, [0, 9, 10], [7, 0x1ffff]);
    const s = makeSave('Hero', ch, 5, { inventory: [], equipment: {}, act: 1, difficulty: 1, difficultyUnlocked: 1, ...byDiff }, 9);
    const back = parseSave(serializeSave(s));
    expect(back).toEqual(s);
    expect(back.act).toBe(1);
    expect(back.difficulty).toBe(1);
    expect(back.difficultyUnlocked).toBe(1);
    expect(back.waypointsByDiff).toEqual([[0, 1, 9], [0, 9, 10], [0]]);
    expect(back.questFlagsByDiff).toEqual([[1, 2, 3], [7, 0xffff], null]);
    // Normal 사본 (예전 코드가 읽는 칸)
    expect(back.waypoints).toEqual([0, 1, 9]);
    expect(back.questFlags).toEqual([1, 2, 3]);
  });

  it('예전 저장(새 필드 없음) → Normal·Act 1, Normal 칸 = waypoints/questFlags', () => {
    const old = JSON.parse(serializeSave(makeSave('Old', ch, 0, { inventory: [], equipment: {}, waypoints: [4, 1], questFlags: [0, 1] }, 1))) as Record<string, unknown>;
    for (const k of ['act', 'difficulty', 'difficultyUnlocked', 'waypointsByDiff', 'questFlagsByDiff']) delete old[k];
    const back = parseSave(JSON.stringify(old));
    expect(back.act).toBe(0);
    expect(back.difficulty).toBe(0);
    expect(back.difficultyUnlocked).toBe(0);
    expect(back.waypointsByDiff).toEqual([[0, 1, 4], [0], [0]]);
    expect(back.questFlagsByDiff).toEqual([[0, 1], null, null]);
    expect(back.waypoints).toEqual([0, 1, 4]);
  });

  it('잘못된 값은 버린다 (막 범위 밖·난이도 문자열·웨이포인트 숫자 아님)', () => {
    const s = JSON.parse(serializeSave(makeSave('Bad', ch, 0, { inventory: [], equipment: {} }, 1))) as Record<string, unknown>;
    Object.assign(s, { act: 7, difficulty: 'hell', difficultyUnlocked: 5, waypointsByDiff: [[0], ['x', 300, 12], 'no'], questFlagsByDiff: [null, [70000], [1]] });
    const back = parseSave(JSON.stringify(s));
    expect([back.act, back.difficulty, back.difficultyUnlocked]).toEqual([0, 0, 0]);
    expect(back.waypointsByDiff).toEqual([[0], [0, 12], [0]]);
    expect(back.questFlagsByDiff).toEqual([null, null, [1]]);
  });
});

describe('막별 퀘스트·AI 등록표', () => {
  it('QuestControl 은 Act 1 모듈로 시작하고, 없는 막 탭은 빈 목록', () => {
    const host = {} as ConstructorParameters<typeof QuestControl>[0];
    const qc = new QuestControl(host, { 0: () => ({ act: 0, startGame() {}, update() {}, changeLevel() {}, monsterKilled() {}, itemPickedUp() {}, initObject() {}, operate: () => false, npcHasQuest: () => false, npcActivate: () => [], npcDeactivate() {}, scrollMessage() {}, log: () => [{ quest: 1, status: 0, icon: 'none', count: 0, justDone: false }] }) });
    expect(qc.availableActs).toEqual([0]);
    expect(qc.log(0)).toHaveLength(1);
    expect(qc.log(1)).toEqual([]);
  });

  it('AI_TABLE 은 Act 1 AI 를 모두 담는다', () => {
    expect(hasAi('Zombie')).toBe(true);
    expect(Object.keys(AI_TABLE).length).toBeGreaterThan(20);
  });
});
