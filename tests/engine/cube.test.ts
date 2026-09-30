// 호라드릭 큐브 (Phase 6 Step 3).
// 기대값 출처: cubemain.txt 클래식(version 0·enabled 1) 행 — "3 chipped rubies -> flawed ruby" (gcr,qty=3 → gfr),
//             "Staff of Kings + Viper amulet -> Horadric Staff" (msf + vip → hst, op 28), "3 health potions + 3 mana potions + 1 chipped gem -> rejuvenate potion"
//             (hpot,qty=3 + mpot,qty=3 + gem0 → rvs, numinputs 7), "3 small rejuvs -> one large", "Khalim Flail + … -> Super Khalim Flail" (qf1 qhr qey qbr → qf2),
//             "1 ring + 1 perfect ruby + 1 exploding potions -> garnet ring" (rin,mag,pre=372 lvl 30), 룬 행(version 100)은 클래식에서 쓰지 않는다,
//             inventory.txt "Transmogrify Box Page 1" 3×4,
//             D2MOO PlrTrade.cpp PLRTRADE_HandleCubeInteraction / PLRTRADE_CheckCubeInput / PLRTRADE_CreateCubeOutputs, HoradricCube.cpp 입력·결과 파서
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World } from '../../src/data/act1-world';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { QUALITY, type ItemInstance, type Quality } from '../../src/engine/treasure';
import { Rng } from '../../src/engine/rng';
import { transmute, type CubeDb } from '../../src/engine/cube';
import { makeSave, parseSave, serializeSave } from '../../src/engine/save';

const d = hasGameData ? describe : describe.skip;

let tables: GameTables;
let data: GameData;
let db: CubeDb;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
  db = data.cube!;
});

function item(code: string, quality: Quality = QUALITY.NORMAL, ilvl = 20): ItemInstance {
  const it = data.treasure.createItem(data.items.base(code)!, ilvl, new Rng(7), quality, quality > QUALITY.NORMAL);
  it.identified = true;
  return it;
}

const ctx = (lvl = 20) => ({ items: data.items, treasure: data.treasure, rng: new Rng(99), playerLevel: lvl, difficulty: 0, cls: 'pal' });

function makeGame(): Game {
  const cs = classStats(tables.table('charstats'), 'Paladin');
  const ch = createCharacter(cs);
  ch.level = 20;
  const w = buildAct1World(gameChain(), tables, data, 55);
  const g = new Game({
    map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), seed: 55, data,
    player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Paladin'),
  });
  g.tick();
  return g;
}

/** 인벤토리 → 큐브 칸으로 옮긴다 (moveItem: 커서 → cube) */
function toCube(g: Game, it: ItemInstance): void {
  const free = (() => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) if (g.store.cube.fits(it, x, y)) return { x, y };
    return null;
  })()!;
  g.store.inv.autoAdd(it);
  g.enqueue({ type: 'moveItem', itemId: it.id, to: { kind: 'cursor' } });
  g.enqueue({ type: 'moveItem', itemId: it.id, to: { kind: 'cube', ...free } });
  g.tick();
}

d('cubemain.txt 읽기', () => {
  it('클래식 조합: 입력·결과 파싱 (hpot,qty=3 · rin,mag,pre=372 · Stone of Jordan 이름 입력)', () => {
    const rejuv = db.recipes.find((r) => r.description.startsWith('3 health potions +  3 mana potions + 1 chipped gem'))!;
    expect(rejuv).toMatchObject({ enabled: true, version: 0, numInputs: 7 });
    expect(rejuv.inputs[0]).toMatchObject({ type: 'hpot', qty: 3 });
    expect(rejuv.inputs[2]).toMatchObject({ type: 'gem0', qty: 0 });
    expect(rejuv.outputs[0]).toMatchObject({ kind: 'code', code: 'rvs' });
    const garnet = db.recipes.find((r) => r.description.includes('garnet ring'))!;
    expect(garnet.inputs[0]).toMatchObject({ code: 'rin', quality: QUALITY.MAGIC });
    expect(garnet.outputs[0]).toMatchObject({ code: 'rin', quality: QUALITY.MAGIC, pre: [372], lvl: 30 });
    const soj = db.recipes.find((r) => r.description.startsWith('1 perfect skull + 1 rare item + soj'))!;
    expect(soj.inputs[2]).toMatchObject({ quality: QUALITY.UNIQUE });
    expect(soj.inputs[2]!.uniqueIdx).toBeGreaterThanOrEqual(0);
    // 룬 조합은 확장팩(version 100)
    expect(db.recipes.find((r) => r.description === '3 rune 01 -> rune 02')!.version).toBe(100);
  });
});

d('트랜스뮤트 규칙', () => {
  it('3 chipped rubies → flawed ruby', () => {
    const r = transmute(db, ctx(), [item('gcr'), item('gcr'), item('gcr')])!;
    expect(r.recipe.description).toBe('3 chipped rubies -> flawed ruby');
    expect(r.outputs.map((o) => o.code)).toEqual(['gfr']);
    expect(r.consumed.length).toBe(3);
  });

  it('Horadric Staff: Staff of Kings + Viper Amulet → hst (유니크 퀘스트 아이템)', () => {
    const r = transmute(db, ctx(), [item('msf'), item('vip')])!;
    expect(r.outputs.map((o) => o.code)).toEqual(['hst']);
    expect(r.outputs[0]!.identified).toBe(true);
  });

  it("Khalim's Will: 도리깨 + 심장·눈·뇌 → qf2", () => {
    const r = transmute(db, ctx(), [item('qf1'), item('qhr'), item('qey'), item('qbr')])!;
    expect(r.outputs.map((o) => o.code)).toEqual(['qf2']);
  });

  it('물약 조합: 3 치료 + 3 마나 + 조각 보석 → rvs, 3 rvs → rvl', () => {
    const r = transmute(db, ctx(), [item('hp1'), item('hp2'), item('hp1'), item('mp1'), item('mp3'), item('mp1'), item('gcv')])!;
    expect(r.outputs.map((o) => o.code)).toEqual(['rvs']);
    const r2 = transmute(db, ctx(), [item('rvs'), item('rvs'), item('rvs')])!;
    expect(r2.outputs.map((o) => o.code)).toEqual(['rvl']);
  });

  it('Garnet ring: 매직 반지 + 완전한 루비 + 폭발 물약 → 강제 접사 372 매직 반지 (아이템 레벨 30)', () => {
    const r = transmute(db, ctx(), [item('rin', QUALITY.MAGIC), item('gpr'), item('opm')])!;
    const o = r.outputs[0]!;
    expect(o).toMatchObject({ code: 'rin', quality: QUALITY.MAGIC, ilvl: 30 });
    expect(o.prefixes).toEqual([372]);
    expect(o.stats.length).toBeGreaterThan(0);
  });

  // 출처: plvl 75 → 레벨 = 75 × 플레이어 레벨 / 100
  it('3 매직 반지 → 매직 목걸이 (아이템 레벨 = 플레이어 레벨 × 75%)', () => {
    const r = transmute(db, ctx(40), [item('rin', QUALITY.MAGIC), item('rin', QUALITY.MAGIC), item('rin', QUALITY.MAGIC)])!;
    expect(r.outputs[0]).toMatchObject({ code: 'amu', quality: QUALITY.MAGIC, ilvl: 30 });
  });

  it('틀린 조합은 아무 일도 없다: 조각 루비 2개, 조각 루비 + 조각 사파이어 + 조각 루비, 룬(확장팩)', () => {
    expect(transmute(db, ctx(), [item('gcr'), item('gcr')])).toBeNull();
    expect(transmute(db, ctx(), [item('gcr'), item('gcb'), item('gcr')])).toBeNull();
    expect(transmute(db, ctx(), [item('gcr'), item('gcr'), item('gcr'), item('gcr')])).toBeNull();
    expect(transmute(db, ctx(), [])).toBeNull();
  });

  it('2 화살통 → 볼트통 (쌓이는 아이템)', () => {
    const r = transmute(db, ctx(), [item('aqv'), item('aqv')])!;
    expect(r.outputs.map((o) => o.code)).toEqual(['cqv']);
  });
});

d('게임: 큐브 창·트랜스뮤트·저장', () => {
  it('큐브를 열고 칸에 넣어 트랜스뮤트 → 결과가 큐브에, 입력은 사라진다', () => {
    const g = makeGame();
    const box = item('box');
    g.store.inv.autoAdd(box);
    // 창을 열기 전엔 큐브 칸에 못 넣는다
    const early = item('gcr');
    g.store.inv.autoAdd(early);
    g.enqueue({ type: 'moveItem', itemId: early.id, to: { kind: 'cursor' } });
    g.enqueue({ type: 'moveItem', itemId: early.id, to: { kind: 'cube', x: 0, y: 0 } });
    g.tick();
    expect(g.store.cube.items.length).toBe(0);
    g.enqueue({ type: 'moveItem', itemId: early.id, to: { kind: 'inventory', x: 9, y: 3 } });
    g.enqueue({ type: 'useItem', itemId: box.id });
    const ev = g.tick();
    expect(ev.some((e) => e.type === 'cubeOpened')).toBe(true);
    expect(g.cubeOpen).toBe(true);
    // 큐브는 큐브 안에 못 넣는다
    g.enqueue({ type: 'moveItem', itemId: box.id, to: { kind: 'cursor' } });
    g.enqueue({ type: 'moveItem', itemId: box.id, to: { kind: 'cube', x: 0, y: 0 } });
    g.tick();
    expect(g.store.cube.items.length).toBe(0);
    g.enqueue({ type: 'moveItem', itemId: box.id, to: { kind: 'inventory', x: 0, y: 0 } });
    g.tick();
    g.store.consume(early.id);
    for (let i = 0; i < 3; i++) toCube(g, item('gcr'));
    expect(g.store.cube.items.length).toBe(3);
    g.enqueue({ type: 'transmute' });
    const ev2 = g.tick();
    expect(ev2.find((e) => e.type === 'transmuted')).toMatchObject({ outputs: ['gfr'] });
    expect(g.store.cube.items.map((p) => p.item.code)).toEqual(['gfr']);
  });

  it('틀린 조합: transmuteFailed, 큐브 그대로', () => {
    const g = makeGame();
    g.store.inv.autoAdd(item('box'));
    g.enqueue({ type: 'openCube' });
    g.tick();
    toCube(g, item('gcr'));
    toCube(g, item('gcb'));
    g.enqueue({ type: 'transmute' });
    const ev = g.tick();
    expect(ev.some((e) => e.type === 'transmuteFailed')).toBe(true);
    expect(g.store.cube.items.map((p) => p.item.code).sort()).toEqual(['gcb', 'gcr']);
  });

  it('Horadric Staff 트랜스뮤트는 퀘스트 이벤트 cubeQuestItem (Phase 7 A2Q2)', () => {
    const g = makeGame();
    g.store.inv.autoAdd(item('box'));
    g.enqueue({ type: 'openCube' });
    g.tick();
    toCube(g, item('msf'));
    toCube(g, item('vip'));
    g.enqueue({ type: 'transmute' });
    const ev = g.tick();
    expect(ev.find((e) => e.type === 'cubeQuestItem')).toMatchObject({ code: 'hst' });
  });

  it('큐브 칸은 저장된다 (예전 저장은 빈 칸)', () => {
    const it = item('gfr');
    const sv = parseSave(serializeSave(makeSave('c', createCharacter(classStats(tables.table('charstats'), 'Paladin')), 0, { inventory: [], equipment: {}, cube: [{ item: it, x: 1, y: 2 }] })));
    expect(sv.cube.map((p) => [p.item.code, p.x, p.y])).toEqual([['gfr', 1, 2]]);
    const old = JSON.parse(serializeSave(sv)) as Record<string, unknown>;
    delete old.cube;
    expect(parseSave(JSON.stringify(old)).cube).toEqual([]);
  });

  it('spawnCube 훅: 레벨 바닥에 큐브 (Phase 7 A2Q2 Halls of the Dead 상자)', () => {
    const g = makeGame();
    const it = g.spawnCube('town', g.snapshot().player.x + 1, g.snapshot().player.y);
    expect(it?.code).toBe('box');
    expect(g.groundItemById(it!.id)).toBeTruthy();
  });
});
