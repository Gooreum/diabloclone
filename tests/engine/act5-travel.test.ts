// 확장팩 Act 4 → Act 5 이동과 Harrogath NPC (Phase 3 Step 1).
// 출처: D2MOO QUESTS/ACT4/A4Q2.cpp (확장팩: 디아블로 처치에 엔딩·난이도 해제 없음, Tyrael 20000 → 포털 566, OperateFn73 → A4COMPLETED·Harrogath),
//       UNIT/SUnitNpc.cpp NPC_HandleDialogMessage (TYRAEL2 "Travel To Harrogath": 확장팩 + A4Q2 REWARDGRANTED), sub_6FCC7FA0 (QUAL_KEHK 고용 = A5Q2 보상 뒤),
//       UNIT/SUnitProxy.cpp (Act 5 NPC 표)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { GAME_DATA, gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { actLevels, actTownKey, buildActWorld } from '../../src/data/world';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { nearestWalkable } from '../../src/engine/path';
import { QFLAG, QuestRecord } from '../../src/engine/quests/record';
import { QW } from '../../src/engine/quests/messages-acts';
import type { MonsterUnit } from '../../src/engine/ai';
import type { ObjectUnit } from '../../src/engine/objects';
import { NPC_DEFS } from '../../src/engine/npc';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));
const T = 240_000;
const SEED = 515;

interface Ctx { chain: MpqChain; tables: GameTables; data: GameData }
let lod: Ctx, classic: Ctx;

function makeGame(c: Ctx, act: number, questFlags?: number[]): Game {
  const cs = classStats(c.tables.table('charstats'), 'Barbarian');
  const ch = createCharacter(cs);
  ch.level = 40;
  ch.maxLife = ch.life = 100000;
  const w = buildActWorld(c.chain, c.tables, c.data, SEED, act);
  const g = new Game({
    map: w.byKey.get(w.townId)!.def.map, levels: w.levels.map((l) => l.def), act, seed: SEED, data: c.data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(c.tables.table('experience'), 'Barbarian'), gold: 100000,
    ...(questFlags ? { questFlags } : {}),
  });
  g.onActChange = (a) => actLevels(buildActWorld(c.chain, c.tables, c.data, SEED, a));
  g.tick();
  return g;
}

type Inner = { events: GameEvent[]; killMonster(m: MonsterUnit, s: string): void; spawnMonster(id: string, x: number, y: number): MonsterUnit; level: { objects: ObjectUnit[] } };
const inner = (g: Game) => g as unknown as Inner;
const npcOf = (g: Game, id: string) => g.npcs.find((n) => n.type.id === id) as MonsterUnit;

function talkTo(g: Game, id: string): GameEvent[] {
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
const speechKeys = (evs: GameEvent[]) => evs.filter((e) => e.type === 'questSpeech').map((e) => String(e.key));
const granted = () => {
  const r = new QuestRecord();
  for (const w of [QW.A4Q1, QW.A4Q2, QW.A4Q3]) r.set(w, QFLAG.REWARDGRANTED);
  return r.toJSON();
};

describe.skipIf(!hasLod || !hasGameData)('확장팩 Act 4 → Act 5 이동', () => {
  beforeAll(() => {
    const chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
    const tables = new GameTables(chain);
    lod = { chain, tables, data: buildGameData(chain, tables, { expansion: true }) };
    const cc = gameChain() as MpqChain;
    const ct = new GameTables(cc);
    classic = { chain: cc, tables: ct, data: buildGameData(cc, ct) };
  }, 180_000);

  it('확장팩: 디아블로 처치 → 보상 받음, 엔딩·난이도 해제·진행 값 없음 (바알에서 끝난다)', () => {
    const g = makeGame(lod, 3);
    const def = g.levelDef('chaossanctuary')!;
    const p = nearestWalkable(def.map, { x: def.map.width / 2, y: def.map.height / 2 }, 400)!;
    g.changeLevel('chaossanctuary', p.x + 0.5, p.y + 0.5);
    g.tick();
    const dia = inner(g).spawnMonster('diablo', g.snapshot().player.x + 3, g.snapshot().player.y);
    inner(g).events = [];
    inner(g).killMonster(dia, 'player');
    const evs = inner(g).events;
    expect(g.questRecord.get(QW.A4Q2, QFLAG.REWARDGRANTED)).toBe(true);
    expect(g.questRecord.get(QW.A4Q2, QFLAG.CUSTOM2) || g.questRecord.get(QW.A4Q2, QFLAG.CUSTOM3)).toBe(false);
    expect(evs.some((e) => e.type === 'gameCompleted')).toBe(false);
    expect(g.difficultyUnlocked).toBe(0);
    expect(g.progression).toBe(0);
    // 90 초가 지나도 마을로 옮기지 않는다
    for (let i = 0; i < 90 * 25 + 50; i++) g.tick();
    expect(g.levelId).toBe('chaossanctuary');
  }, T);

  it('확장팩: Tyrael 대사 20000 → 오른쪽에 Harrogath 포털 566 → 포털 → A4COMPLETED·Harrogath·웨이포인트', () => {
    const g = makeGame(lod, 3, granted());
    expect(g.questControl.npcHasQuest('tyrael2')).toBe(true);
    expect(speechKeys(talkTo(g, 'tyrael2'))).toContain('A4Q2ExpansionSuccessTyrael');
    expect(g.questRecord.get(QW.A4Q2, QFLAG.CUSTOM5)).toBe(true);
    closeTalk(g);
    const portal = inner(g).level.objects.find((o) => o.type.id === 566)!;
    expect(portal).toBeTruthy();
    const ty = npcOf(g, 'tyrael2');
    expect(Math.abs(portal.x - (Math.floor(ty.x) + 5))).toBeLessThanOrEqual(8);
    // 메뉴에도 "travel to harrogath"
    talkTo(g, 'tyrael2');
    expect(g.snapshot().interaction?.options).toContain('goHarrogath');
    closeTalk(g);
    g.operateObject(portal);
    for (let i = 0; i < 5; i++) g.tick();
    expect(g.act).toBe(4);
    expect(g.levelId).toBe('harrogath');
    expect(g.questRecord.get(QW.A4COMPLETED, QFLAG.REWARDGRANTED)).toBe(true);
    // levels.txt Harrogath Waypoint 30
    expect(g.waypoints.has(30)).toBe(true);
  }, T);

  it('Harrogath NPC: Malah·Qual-Kehk·Nihlathak·Cain 이 서 있고 원작 메뉴, Qual-Kehk 는 A5Q2 보상 전 고용 거절', () => {
    const g = makeGame(lod, 4, granted());
    expect(actTownKey(4)).toBe('harrogath');
    expect(g.levelId).toBe('harrogath');
    const ids = new Set(g.npcs.map((n) => n.type.id));
    // Larzuk 은 마을 DS1 의 오브젝트 543 (InitFn 71) 에서 A5Q1 이 세운다 (Phase 5), Anya 는 A5Q3 구출 뒤 (오브젝트 459)
    for (const id of ['malah', 'qual-kehk', 'cain6', 'nihlathak']) expect(ids.has(id), id).toBe(true);
    expect(inner(g).level.objects.some((o) => o.type.id === 543)).toBe(true);
    talkTo(g, 'malah');
    expect(g.snapshot().interaction?.options).toEqual(expect.arrayContaining(['talk', 'trade']));
    closeTalk(g);
    talkTo(g, 'qual-kehk');
    expect(g.snapshot().interaction?.options).toContain('hire');
    inner(g).events = [];
    g.enqueue({ type: 'hire', index: 0 } as never);
    g.tick();
    expect(g.merc).toBeNull();
    closeTalk(g);
    expect(NPC_DEFS['drehya']?.gamble && NPC_DEFS['nihlathak']?.gamble).toBe(true);
  }, T);

  it('클래식: 같은 기록이어도 Act 5 로 갈 수 없다 (Tyrael 메뉴 없음, 대사 20000 없음)', () => {
    const g = makeGame(classic, 3, granted());
    expect(g.canTravelAct(4)).toBe(false);
    talkTo(g, 'tyrael2');
    expect(g.snapshot().interaction?.options).not.toContain('goHarrogath');
    closeTalk(g);
    expect(inner(g).level.objects.some((o) => o.type.id === 566)).toBe(false);
  }, T);
});
