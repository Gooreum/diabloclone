// 오브젝트·신전·웨이포인트·마을 포털·자동 지도 — 기대값은 원작 excel(objects.txt / shrines.txt / levels.txt / TreasureClassEx.txt)과
// D2MOO D2Game/src/OBJECTS/ObjMode.cpp·Objects.cpp·ObjRgn.cpp, D2Common/src/D2Waypoints.cpp 규칙에서 유도.
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World, type Act1GameWorld } from '../../src/data/act1-world';
import { Game, type GameData, type LevelDef } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { findPath } from '../../src/engine/path';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { QUALITY } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { OBJMODE, SUBCLASS, chestTcName, wellAfterUse, wellRegen, type ObjectUnit } from '../../src/engine/objects';
import { WaypointFlags, waypointLevels } from '../../src/engine/waypoints';
import { AutomapReveal, AutomapTable } from '../../src/engine/automap';
import { makeSave, parseSave, serializeSave } from '../../src/engine/save';

const d = hasGameData ? describe : describe.skip;

let tables: GameTables;
let data: GameData;

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

function makeGame(levels: LevelDef[], seed = 7, start = { x: 20.5, y: 20.5 }, extra: Partial<ConstructorParameters<typeof Game>[0]> = {}): Game {
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  return new Game({
    map: levels[0]!.map, levels, seed, data, player: { x: start.x, y: start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), ...extra,
  });
}

/** 인벤토리 + 벨트 (두루마리는 줍거나 받을 때 벨트 먼저) */
const carried = (g: Game) => [...g.inventory, ...g.store.belt.filter((x): x is NonNullable<typeof x> => !!x)];

/** 오브젝트까지 걸어가서 조작 (interact 명령 → 틱) */
function interact(g: Game, o: ObjectUnit, ticks = 200): void {
  g.enqueue({ type: 'interact', unitId: o.id });
  for (let i = 0; i < ticks; i++) {
    g.tick();
    if (!g.snapshot().player.mode.match(/WL|RN/) && i > 2) break;
  }
}

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
});

d('오브젝트 데이터 (objects.txt / ObjGroup.txt / shrines.txt)', () => {

  // 출처: objects.txt 5 "chest" L1 — SizeX 1, SizeY 2, OperateFn 4 (Chest), SubClass 8 (chest), Lockable 1, InitFn 3
  it('objects.txt 행: 상자·문·웨이포인트·포털', () => {
    const db = data.objects!;
    expect(db.type(5)).toMatchObject({ token: 'L1', sizeX: 1, sizeY: 2, operateFn: 4, subClass: SUBCLASS.CHEST, lockable: true, initFn: 3 });
    expect(db.type(13)).toMatchObject({ token: 'D1', isDoor: true, operateFn: 8, sizeX: 1, sizeY: 3 });
    expect(db.type(13)!.hasCollision.slice(0, 3)).toEqual([true, true, false]);
    expect(db.type(119)).toMatchObject({ token: 'wp', operateFn: 23, subClass: SUBCLASS.WAYPOINT });
    expect(db.type(59)).toMatchObject({ token: 'TP', operateFn: 15, subClass: SUBCLASS.TOWNPORTAL });
  });

  // 출처: shrines.txt — Armor Boost 6 (Arg0 100, 2400 프레임, 5분), Combat 7 (200/200, 2400), Resist Fire 8 (75, 3600), Experience 15 (50, 3600)
  it('shrines.txt 행과 효과 분류 표 (ObjRgn OBJRGN_AllocObjectControl)', () => {
    const db = data.objects!;
    expect(db.shrine(6)).toMatchObject({ arg0: 100, duration: 2400, resetMinutes: 5 });
    expect(db.shrine(7)).toMatchObject({ arg0: 200, arg1: 200, duration: 2400 });
    expect(db.shrine(8)).toMatchObject({ arg0: 75, duration: 3600 });
    expect(db.shrine(15)).toMatchObject({ arg0: 50, duration: 3600, resetMinutes: 0 });
    // effectclass 2 (체력) = Health Boost 2, Health Exchange 4 / 3 (마나) = 3, 5
    expect(db.shrineClasses[2]).toEqual([2, 4]);
    expect(db.shrineClasses[3]).toEqual([3, 5]);
  });

  // 출처: OBJMODE_DropFromChestTCWithQuality — Act 1 범위 Blood Moor(MonLvl1 1) ~ Catacombs 4(12): 구간 (12−1+1)/3 = 4
  //       → 레벨 < 5 A, < 9 B, 그 외 C  ("Act 1 Chest A/B/C", DATATBLS_GetTreasureClassExRecordFromActAndDifficulty)
  it('상자 TC: 레벨 몬스터 레벨에 따라 Act 1 Chest A/B/C', () => {
    const db = data.objects!;
    expect(db.levels.get(2)!.monLvl).toBe(1);
    expect(db.levels.get(37)!.monLvl).toBe(12);
    expect(chestTcName(db, 2)).toBe('Act 1 Chest A'); // Blood Moor 1
    expect(chestTcName(db, 4)).toBe('Act 1 Chest A'); // Stony Field 4
    expect(chestTcName(db, 5)).toBe('Act 1 Chest B'); // Dark Wood 5
    expect(chestTcName(db, 7)).toBe('Act 1 Chest B'); // Tamoe Highland 8
    expect(chestTcName(db, 28)).toBe('Act 1 Chest C'); // Barracks 9
    expect(chestTcName(db, 29)).toBe('Act 1 Chest C'); // Jail 1 10
  });

  // 출처: ObjMode.cpp OBJECTS_OperateFunction22_Well / sub_6FC74B40 — 우물 30 zw: Parm2 = 1 → 처음 2회 (InitFn16 = 2×Parm2)
  it('우물 사용·재생: 남은 횟수와 모드 (0 가득 → 1 반 → 2 빔)', () => {
    const t = data.objects!.type(130)!;
    expect(t.parm[2]).toBe(1);
    expect(wellAfterUse(t, 2)).toEqual({ left: 1, mode: 1 });
    expect(wellAfterUse(t, 1)).toEqual({ left: 0, mode: 2 });
    expect(wellRegen(t, 0)).toEqual({ left: 1, mode: 1 });
    expect(wellRegen(t, 1)).toEqual({ left: 2, mode: 0 });
    expect(wellRegen(t, 2)).toEqual({ left: 2, mode: null });
  });
});

d('상자 드롭 (OperateFunction04_Chest + "Act 1 Chest A")', () => {
  it('Blood Moor 상자를 열면 Act 1 Chest A 로 굴리고 열린 모드가 된다', () => {
    const map = openMap();
    const g = makeGame([{ id: 'bloodmoor', map, inTown: false, exits: [], levelNo: 2, objects: [{ classId: 5, x: 30, y: 30 }] }]);
    g.tick();
    const chest = g.objects.find((o) => o.type.id === 5)!;
    chest.interact = 0; // 잠김·함정 없음
    const evs: string[] = [];
    g.enqueue({ type: 'interact', unitId: chest.id });
    for (let i = 0; i < 200 && chest.mode === OBJMODE.NEUTRAL; i++) for (const e of g.tick()) if (e.type === 'chestDrop') evs.push(String(e.tc));
    // 상자 5 는 Mode1 = 0 → 바로 열림(OBJMODE_OPENED), 충돌은 HasCollision2 그대로
    expect(chest.mode).toBe(OBJMODE.OPENED);
    // 75% 는 TC 굴림 (25% 는 빈 상자)
    expect(evs.every((t) => t === 'Act 1 Chest A')).toBe(true);
  });

  // 기대값: 빈 상자 25% + 굴렸지만 4 픽 모두 NoDrop = (100/142)^4 ≈ 0.246 → 아무것도 안 나올 확률 0.25 + 0.75×0.246 ≈ 0.434
  it('Act 1 Chest A: 빈 상자 비율이 원작 규칙(25% + NoDrop 100/142 의 4픽)과 맞는다', () => {
    let empty = 0;
    const N = 400;
    const map = openMap();
    const objs = Array.from({ length: N }, (_, i) => ({ classId: 5, x: 4 + (i % 25) * 2, y: 4 + Math.floor(i / 25) * 3 }));
    const g = makeGame([{ id: 'bloodmoor', map, inTown: false, exits: [], levelNo: 2, objects: objs }], 99);
    g.tick();
    for (const o of g.objects.filter((x) => x.type.id === 5)) {
      o.interact = 0;
      const before = g.snapshot().items.length;
      g.operateObject(o);
      if (g.snapshot().items.length === before) empty++;
    }
    const n = g.objects.filter((x) => x.type.id === 5).length;
    expect(n).toBeGreaterThan(300);
    expect(empty / n).toBeGreaterThan(0.37);
    expect(empty / n).toBeLessThan(0.5);
  });

  // 출처: OperateFunction04_Chest — 잠긴 상자(InteractType & 0x80)는 열쇠가 없으면 열리지 않고, 있으면 열쇠 1 소모 후 2번 굴림
  it('잠긴 상자는 열쇠가 필요하고 열쇠 수량이 줄어든다', () => {
    const map = openMap();
    const key = data.treasure.createItem(data.items.base('key')!, 1, new Rng(3), QUALITY.NORMAL);
    key.quantity = 2;
    const lv: LevelDef = { id: 'bloodmoor', map, inTown: false, exits: [], levelNo: 2, objects: [{ classId: 5, x: 30, y: 30 }] };
    const g0 = makeGame([lv]);
    g0.tick();
    const c0 = g0.objects.find((o) => o.type.id === 5)!;
    c0.interact = 0x80;
    g0.operateObject(c0);
    expect(c0.mode).toBe(OBJMODE.NEUTRAL);
    const map2 = openMap();
    const g = makeGame([{ ...lv, map: map2 }], 7, undefined, { inventory: [key] });
    g.tick();
    const c = g.objects.find((o) => o.type.id === 5)!;
    c.interact = 0x80;
    g.operateObject(c);
    expect(c.mode).toBe(OBJMODE.OPENED);
    expect(g.inventory.find((i) => i.code === 'key')!.quantity).toBe(1);
  });
});

d('문 (OperateFunction08_Door)', () => {
  it('닫힌 문은 길을 막고, 열면 지나가며, 다시 닫으면 막는다', () => {
    // 가운데 세로 벽(x = 30)에 구멍 3칸 (y 29~31), 문 D1(13): 1×3, HasCollision0 = 1 (닫힘), HasCollision2 = 0 (열림)
    const map = openMap();
    for (let y = 1; y < 59; y++) if (y < 29 || y > 31) map.block(30, y);
    const g = makeGame([{ id: 'jail1', map, inTown: false, exits: [], levelNo: 29, objects: [{ classId: 13, x: 30, y: 30 }] }], 7, { x: 25.5, y: 30.5 });
    g.tick();
    const door = g.objects.find((o) => o.type.isDoor)!;
    expect(door.mode).toBe(OBJMODE.NEUTRAL);
    expect(map.walkable(30, 30)).toBe(false);
    expect(findPath(map, { x: 25.5, y: 30.5 }, { x: 35.5, y: 30.5 })).toBeNull();
    interact(g, door);
    expect(door.mode).toBe(OBJMODE.OPENED);
    expect(map.walkable(30, 29) && map.walkable(30, 30) && map.walkable(30, 31)).toBe(true);
    expect(findPath(map, { x: 25.5, y: 30.5 }, { x: 35.5, y: 30.5 })).not.toBeNull();
    // 0.5초(13틱) 안에는 다시 조작해도 무시
    g.operateObject(door);
    expect(door.mode).toBe(OBJMODE.OPENED);
    for (let i = 0; i < 14; i++) g.tick();
    g.operateObject(door);
    expect(door.mode).toBe(OBJMODE.NEUTRAL);
    expect(map.walkable(30, 30)).toBe(false);
  });
});

d('신전 (OperateFunction02_Shrine + shrines.txt)', () => {
  function shrineGame(code: number): { g: Game; s: ObjectUnit } {
    const map = openMap();
    const g = makeGame([{ id: 'bloodmoor', map, inTown: false, exits: [], levelNo: 2, objects: [{ classId: 2, x: 30, y: 30 }] }]);
    g.tick();
    const s = g.objects.find((o) => o.type.id === 2)!;
    s.interact = code;
    return { g, s };
  }

  it('Armor Boost: shrine_armor 상태 skill_armor_percent 100, 2400 프레임, 5분(6000 프레임) 뒤 다시 사용 가능', () => {
    const { g, s } = shrineGame(6);
    const t0 = g.frame;
    const evs: { type: string; [k: string]: unknown }[] = [];
    g.operateObject(s);
    evs.push(...g.tick());
    const st = g.playerState('shrine_armor')!;
    expect(st.stats).toEqual({ skill_armor_percent: 100 });
    expect(st.until).toBe(t0 + 2400);
    expect(s.operated).toBe(true);
    // 다시 조작해도 효과 없음
    g.operateObject(s);
    expect(s.resetAt).toBe(t0 + 1200 * 5 + 1);
    for (let i = 0; i < 2400; i++) g.tick();
    expect(g.playerState('shrine_armor')).toBeUndefined();
    for (let i = 0; i < 3602; i++) g.tick();
    expect(s.operated).toBe(false);
    expect(s.mode).toBe(OBJMODE.NEUTRAL);
  });

  it('Combat Boost: damagepercent 200, tohit = 200% × AR, 2400 프레임', () => {
    const { g, s } = shrineGame(7);
    g.operateObject(s);
    const st = g.playerState('shrine_combat')!;
    expect(st.stats.damagepercent).toBe(200);
    expect(st.stats.tohit).toBeGreaterThan(0);
    expect(st.until - g.frame).toBe(2400);
  });

  it('저항 신전 75 (3600 프레임), 마나 재생 400, 경험 50', () => {
    const cases: [number, string, string, number, number][] = [
      [8, 'shrine_resist_fire', 'fireresist', 75, 3600],
      [9, 'shrine_resist_cold', 'coldresist', 75, 3600],
      [10, 'shrine_resist_lightning', 'lightresist', 75, 3600],
      [11, 'shrine_resist_poison', 'poisonresist', 75, 3600],
      [13, 'shrine_mana_regen', 'manarecoverybonus', 400, 2400],
      [15, 'shrine_experience', 'item_addexperience', 50, 3600],
    ];
    for (const [code, state, stat, v, dur] of cases) {
      const { g, s } = shrineGame(code);
      g.operateObject(s);
      const st = g.playerState(state)!;
      expect(st.stats[stat], state).toBe(v);
      expect(st.until - g.frame, state).toBe(dur);
    }
  });

  it('Refill / Health / Mana: 생명·마나를 최대치로, 메시지 ShrMsg<code> 이벤트', () => {
    const { g, s } = shrineGame(1);
    g.character!.life = 1;
    g.character!.mana = 0;
    g.operateObject(s);
    const ev = g.tick();
    expect(g.character!.life).toBeCloseTo(g.maxLife(), 0);
    expect(g.character!.mana).toBeCloseTo(g.maxMana(), 0);
    void ev;
    const { g: g2, s: s2 } = shrineGame(2);
    g2.character!.life = 1;
    g2.character!.mana = 0;
    const got: string[] = [];
    g2.enqueue({ type: 'interact', unitId: s2.id });
    for (let i = 0; i < 200 && !got.length; i++) for (const e of g2.tick()) if (e.type === 'shrine') got.push(String(e.message));
    expect(got).toEqual(['ShrMsg2']);
    expect(tables.string('ShrMsg2')).toBe('You feel healthy.');
    expect(g2.character!.life).toBeCloseTo(g2.maxLife(), 0);
    expect(g2.character!.mana).toBeLessThan(1);
  });
});

d('웨이포인트 (D2Waypoints.cpp + OperateFunction23_Waypoint)', () => {
  // 출처: levels.txt Waypoint — Act 1: 0 마을, 1 Cold Plains, 2 Stony Field, 3 Dark Wood, 4 Black Marsh, 5 Outer Cloister, 6 Jail 1, 7 Inner Cloister, 8 Catacombs 2
  it('Act 1 웨이포인트 9개 순서', () => {
    const list = waypointLevels([...data.objects!.levels.values()]).filter((w) => w.act === 0);
    expect(list.map((w) => w.levelNo)).toEqual([1, 3, 4, 5, 6, 27, 29, 32, 35]);
    expect(list.map((w) => w.no)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('마을(0)은 처음부터 활성 (WAYPOINTS_AllocWaypointData nFlags[1] |= 1)', () => {
    expect(new WaypointFlags().list()).toEqual([0]);
  });

  function wpGame(): Game {
    const town = openMap(), cold = openMap(), stony = openMap();
    return makeGame([
      { id: 'coldplains', map: cold, inTown: false, exits: [], levelNo: 3, objects: [{ classId: 119, x: 30, y: 30 }] },
      { id: 'town', map: town, inTown: true, exits: [], levelNo: 1, objects: [{ classId: 119, x: 40, y: 20 }] },
      { id: 'stonyfield', map: stony, inTown: false, exits: [], levelNo: 4, objects: [{ classId: 119, x: 25, y: 35 }] },
    ], 11, { x: 20.5, y: 20.5 });
  }

  // 출처: OBJECTS_OperateFunction23_Waypoint — 조작(클릭)해야 WAYPOINTS_ActivateWaypoint
  it('웨이포인트는 지나가기만 해선 꺼져 있고, 조작하면 활성+목록 → 마을로 이동, 마을에서 다시 Cold Plains 로', () => {
    const g = wpGame();
    g.tick();
    expect(g.waypoints.has(1)).toBe(false);
    const wp = g.objects.find((o) => o.type.subClass & SUBCLASS.WAYPOINT)!;
    // 걸어서 옆을 지나가도 활성되지 않음
    g.enqueue({ type: 'move', x: wp.x, y: wp.y + 3, run: true });
    for (let i = 0; i < 200; i++) g.tick();
    expect(g.waypoints.has(1)).toBe(false);
    // 조작하면 활성
    interact(g, wp);
    expect(g.waypoints.has(1)).toBe(true);
    // 활성 안 된 Stony Field 로는 못 간다
    expect(g.waypointOpen).not.toBeNull();
    g.enqueue({ type: 'waypoint', level: 'stonyfield' });
    g.tick();
    expect(g.levelId).toBe('coldplains');
    g.enqueue({ type: 'waypoint', level: 'town' });
    g.tick();
    expect(g.levelId).toBe('town');
    const twp = g.objects.find((o) => o.type.subClass & SUBCLASS.WAYPOINT)!;
    const p = g.snapshot().player;
    expect(Math.hypot(p.x - twp.x, p.y - twp.y)).toBeLessThan(8);
    // 마을 웨이포인트는 열린 상태로 시작 (ObjRgn.cpp InitFunction17: 마을이면 OBJMODE_OPENED)
    expect(twp.mode).toBe(OBJMODE.OPENED);
    interact(g, twp);
    g.enqueue({ type: 'waypoint', level: 'coldplains' });
    g.tick();
    expect(g.levelId).toBe('coldplains');
  });

  it('웨이포인트 패널 없이(조작하지 않고) 이동 명령은 무시', () => {
    const g = wpGame();
    g.waypoints.activate(0);
    g.tick();
    g.enqueue({ type: 'waypoint', level: 'town' });
    g.tick();
    expect(g.levelId).toBe('coldplains');
  });
});

d('마을 포털 (SKILLITEM_pSpell02_CastPortal + OperateFunction15_Portal)', () => {
  function tpGame(): Game {
    const town = openMap(), field = openMap();
    const tsc = () => data.treasure.createItem(data.items.base('tsc')!, 1, new Rng(5), QUALITY.NORMAL);
    return makeGame([
      { id: 'bloodmoor', map: field, inTown: false, exits: [], levelNo: 2 },
      { id: 'town', map: town, inTown: true, exits: [], levelNo: 1, portalSpot: { x: 40, y: 40 } },
    ], 13, { x: 20.5, y: 22.5 }, { inventory: [tsc(), tsc()] });
  }

  it('두루마리 → 양쪽 포털, 들어가면 마을, 마을 포털로 돌아오면 같은 자리 + 포털 닫힘', () => {
    const g = tpGame();
    g.tick();
    const scroll = carried(g).find((i) => i.code === 'tsc')!;
    g.enqueue({ type: 'useItem', itemId: scroll.id });
    g.tick();
    expect(carried(g).filter((i) => i.code === 'tsc')).toHaveLength(1);
    const tp = g.townPortal!;
    expect(tp).toMatchObject({ fieldLevel: 'bloodmoor', townLevel: 'town' });
    const field = g.objects.find((o) => o.id === tp.fieldId)!;
    expect(field.type.id).toBe(59);
    // 오브젝트 59 모드 1(OP) 로 생성, FrameCnt1 (15) + 1 프레임 뒤 열림(ON)
    expect(field.mode).toBe(OBJMODE.OPERATING);
    for (let i = 0; i < 17; i++) g.tick();
    expect(field.mode).toBe(OBJMODE.OPENED);
    const where = { x: field.x, y: field.y };
    interact(g, field);
    expect(g.levelId).toBe('town');
    const town = g.objects.find((o) => o.id === tp.townId)!;
    expect(Math.hypot(town.x - 40.5, town.y - 40.5)).toBeLessThan(4);
    interact(g, town);
    expect(g.levelId).toBe('bloodmoor');
    const p = g.snapshot().player;
    expect(Math.hypot(p.x - where.x, p.y - where.y)).toBeLessThan(5);
    expect(g.townPortal).toBeNull();
    expect(g.objects.some((o) => o.type.id === 59)).toBe(false);
    expect(g.objectsOf('town').some((o) => o.type.id === 59)).toBe(false);
  });

  it('포털은 한 사람당 한 쌍: 다시 열면 이전 포털이 닫힌다. 마을에서는 열리지 않는다', () => {
    const g = tpGame();
    g.tick();
    const [a, b] = carried(g).filter((i) => i.code === 'tsc');
    g.enqueue({ type: 'useItem', itemId: a!.id });
    g.tick();
    const first = g.townPortal!;
    g.changeLevel('bloodmoor', 45.5, 45.5);
    g.enqueue({ type: 'useItem', itemId: b!.id });
    g.tick();
    expect(g.townPortal!.fieldId).not.toBe(first.fieldId);
    expect(g.objects.filter((o) => o.type.id === 59)).toHaveLength(1);
    expect(g.objectsOf('town').filter((o) => o.type.id === 59)).toHaveLength(1);
    // 마을에서는 실패 (두루마리도 남는다)
    const g2 = tpGame();
    g2.changeLevel('town', 20.5, 20.5);
    g2.tick();
    const s = carried(g2).find((i) => i.code === 'tsc')!;
    const evs: string[] = [];
    g2.enqueue({ type: 'useItem', itemId: s.id });
    for (const e of g2.tick()) evs.push(e.type);
    expect(evs).toContain('portalFailed');
    expect(carried(g2).filter((i) => i.code === 'tsc')).toHaveLength(2);
  });
});

describe('웨이포인트 저장 (CharacterSave.waypoints)', () => {
  const ch = { cls: 'Barbarian' as const, level: 3, experience: 1600, str: 35, dex: 20, vit: 30, ene: 10, statPoints: 0, skillPoints: 2, maxLife: 79, maxMana: 12, maxStamina: 99, life: 40, mana: 5, stamina: 80, skills: {}, leftSkill: 0, rightSkill: 0 };
  it('왕복: 활성 번호 목록이 그대로 (마을 0 포함)', () => {
    const s = makeSave('Wp', ch, 0, { inventory: [], equipment: {}, waypoints: [5, 1] }, 1);
    expect(s.waypoints).toEqual([0, 1, 5]);
    expect(parseSave(serializeSave(s)).waypoints).toEqual([0, 1, 5]);
  });
  it('예전 저장(필드 없음)은 마을만, 잘못된 값은 버린다', () => {
    const old = JSON.parse(serializeSave(makeSave('Old', ch, 0, { inventory: [], equipment: {} }, 1))) as Record<string, unknown>;
    delete old.waypoints;
    expect(parseSave(JSON.stringify(old)).waypoints).toEqual([0]);
    old.waypoints = [3, 'x', -1, 999, 3];
    expect(parseSave(JSON.stringify(old)).waypoints).toEqual([0, 3]);
  });
});

describe('자동 지도 탐험 (AutomapReveal)', () => {
  it('플레이어 주변 반경 N 타일 원을 드러내고, 같은 타일이면 다시 계산하지 않는다', () => {
    const r = new AutomapReveal(40, 40);
    const added = r.revealAround(100, 100, 6); // 타일 (20, 20)
    // 반경 6 원 안의 격자점 수 (x² + y² ≤ 36) = 113
    expect(added).toBe(113);
    expect(r.isSeen(20, 20) && r.isSeen(26, 20) && r.isSeen(20, 14)).toBe(true);
    expect(r.isSeen(27, 20) || r.isSeen(25, 25)).toBe(false);
    expect(r.revealAround(101, 102, 6)).toBe(0);
    expect(r.revealAround(130, 100, 6)).toBeGreaterThan(0);
    expect(r.count()).toBeGreaterThan(113);
  });

  it('AutoMap.txt: Act 1 황야 바닥(스타일 0, 1~47) = 셀 0~3, 웨이포인트 바닥(54) = 셀 307', () => {
    if (!hasGameData) return;
    const t = new AutomapTable(new GameTables(gameChain()).table('AutoMap'));
    expect(AutomapTable.levelName(2)).toBe('1 Wilderness'); // LvlTypes Id 2 = Act 1 - Wilderness
    expect(t.cels('1 Wilderness', 0, 0, 10)).toEqual([0, 1, 2, 3]);
    expect(t.cels('1 Wilderness', 0, 0, 54)).toEqual([307]);
    // 오른쪽 벽(wr) 스타일 0 시퀀스 0~3 = "WR A" 20
    expect(t.cels('1 Wilderness', 2, 0, 2)).toEqual([20]);
  });

  it('게임 틱마다 현재 레벨 탐험 기록이 늘어난다', () => {
    if (!hasGameData) return;
    const map = openMap(100, 100);
    const g = makeGame([{ id: 'bloodmoor', map, inTown: false, exits: [], levelNo: 2 }], 3, { x: 20.5, y: 20.5 });
    g.tick();
    const a = g.automapOf('bloodmoor')!;
    const n0 = a.count();
    expect(n0).toBeGreaterThan(0);
    expect(a.isSeen(19, 19)).toBe(false);
    g.enqueue({ type: 'move', x: 80.5, y: 80.5, run: true });
    for (let i = 0; i < 300; i++) g.tick();
    expect(a.count()).toBeGreaterThan(n0);
    expect(a.isSeen(16, 16)).toBe(true);
  });
});

d('Act 1 월드 오브젝트 배치 (프리셋 + ObjGroup)', () => {
  let world: Act1GameWorld;
  beforeAll(() => {
    world = buildAct1World(gameChain(), tables, data, 1234);
  });
  it('Cold Plains 에 웨이포인트(DS1 프리셋), Blood Moor 에 상자(ObjGroup 33/34: 139·140·141·144)', () => {
    const g = new Game({ map: world.byKey.get('town')!.def.map, levels: world.levels.map((l) => l.def), player: { x: world.start.x, y: world.start.y, walkVelocity: 4, runVelocity: 6 }, seed: 1234, data });
    g.changeLevel('coldplains', 10, 10);
    g.tick();
    expect(g.objects.some((o) => o.type.subClass & SUBCLASS.WAYPOINT)).toBe(true);
    g.changeLevel('bloodmoor', 10, 10);
    g.tick();
    expect(g.objects.some((o) => [139, 140, 141, 144].includes(o.type.id))).toBe(true);
    // 오브젝트 충돌: 닫힌 상자 자리는 걷기 불가
    const chest = g.objects.find((o) => o.type.operateFn === 4 && o.type.hasCollision[0])!;
    expect(g.map.walkable(Math.floor(chest.x), Math.floor(chest.y))).toBe(false);
  });
});
