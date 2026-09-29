import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { aiDistance, isInMeleeRange, rollGetHit, rollMonsterStats, unitDistance } from '../../src/engine/monster';
import { Rng } from '../../src/engine/rng';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { gridRooms, levelMonsterInfo, planSpawns } from '../../src/engine/spawn';
import { QUALITY } from '../../src/engine/treasure';

describe('거리·근접·피격 (출처: D2MOO AiUtil / Units.cpp / SUnitDmg.cpp)', () => {
  it('AI 거리 = (짧은축 + 2×긴축)/2', () => {
    expect(aiDistance(0, 0, 10, 0)).toBe(10);
    expect(aiDistance(0, 0, 4, 6)).toBe(8);
  });
  it('근접 거리 테이블: 크기 2끼리 dx≤3 이면 0, dx=4 이면 2', () => {
    expect(unitDistance(0, 0, 2, 3, 0, 2)).toBe(0);
    expect(unitDistance(0, 0, 2, 4, 0, 2)).toBe(2);
    expect(isInMeleeRange(0, 0, 2, 0, 3, 0, 2)).toBe(true);
    expect(isInMeleeRange(0, 0, 2, 0, 4, 0, 2)).toBe(false);
  });
  it('피격 경직: 피해 < 1 또는 < maxHP/16(기본 히트클래스) 이면 없음, maxHP/4 이상이면 항상', () => {
    const rng = new Rng(5);
    expect(rollGetHit(0.5, 100, 1, rng)).toBe(false);
    expect(rollGetHit(6, 100, 1, rng)).toBe(false);
    expect(rollGetHit(25, 100, 1, rng)).toBe(true);
  });
});

describe.skipIf(!hasGameData)('원작 데이터 기반 몬스터·드롭', () => {
  let data: GameData;
  let tables: GameTables;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });

  // 출처: MonLvl.txt Level 1 (HP 7, AC 6, TH 8, DM 2, XP 30) × monstats zombie1 (minHP 101, maxHP 181, AC 84, A1TH 101, A1 51~151, Exp 111) / 100
  it('좀비 능력치 = MonLvl × monstats% / 100', () => {
    const t = data.monsters.get('zombie1');
    const s = rollMonsterStats(data.monsters, t, new Rng(1));
    expect(s.level).toBe(1);
    expect(s.maxHp).toBeGreaterThanOrEqual(7);
    expect(s.maxHp).toBeLessThanOrEqual(12);
    expect([s.defense, s.exp, s.a1.min, s.a1.max, s.a1.toHit]).toEqual([5, 33, 1, 3, 8]);
  });

  it('AnimData: 좀비 공격 ZMA1HTH 에 공격 판정 프레임이 있다', () => {
    const r = data.anim.get('ZMA1HTH');
    expect(r?.frames).toBeGreaterThan(0);
    expect(r?.frameFlags.some((v) => v !== 0)).toBe(true);
  });

  it('Blood Moor 스폰은 levels.txt 몬스터 풀(zombie1, fallen1, quillrat1)만 사용', () => {
    const info = levelMonsterInfo(tables.table('Levels'), 'Blood Moor');
    expect(info.pool).toEqual(['zombie1', 'fallen1', 'quillrat1']);
    expect(info.monDen).toBe(520);
    const map = new CollisionMap(400, 400);
    const req = planSpawns(info, gridRooms(400, 400), map, data.monsters, new Rng(42));
    expect(req.length).toBeGreaterThan(0);
    expect(new Set(req.map((r) => r.typeId)).size).toBeGreaterThan(1);
    for (const r of req) expect(info.pool).toContain(r.typeId);
    // 셀 수 × 0.0052 ≈ 기대 그룹 수 (400×400 → 17689 셀 → 약 92 그룹)
    const groups = new Set(req.map((r) => r.leaderIndex)).size;
    expect(groups).toBeGreaterThan(50);
    expect(groups).toBeLessThan(150);
  });

  it('자동 TC weap3 에 손도끼(hax, level 3, rarity 3) 포함', () => {
    const tc = data.treasure.get('weap3');
    expect(tc?.entries.find((e) => e.name === 'hax')?.prob).toBe(3);
  });

  // 출처: TreasureClassEx "Act 1 H2H A" — NoDrop 100, 항목 확률 합 21+16+21+2 = 60 → NoDrop 비율 100/160 = 62.5%
  it('Act 1 H2H A 드롭: NoDrop 비율 ≈ 62.5%, 골드 수량 = rand(5·ilvl)+ilvl', () => {
    const rng = new Rng(7);
    let empty = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const drops = data.treasure.drop('Act 1 H2H A', 1, rng);
      if (drops.length === 0) empty++;
      for (const d of drops) if (d.code === 'gld') {
        expect(d.quantity).toBeGreaterThanOrEqual(1);
        expect(d.quantity).toBeLessThanOrEqual(5);
      }
    }
    expect(empty / N).toBeGreaterThan(0.58);
    expect(empty / N).toBeLessThan(0.67);
  });

  it('무기 드롭 품질은 원작 품질 범위 안이고, 동일 시드면 동일 결과', () => {
    const a = new Rng(99), b = new Rng(99);
    const ra = Array.from({ length: 300 }, () => data.treasure.drop('Act 1 Equip A', 1, a).map((x) => `${x.code}:${x.quality}`)).flat();
    const rb = Array.from({ length: 300 }, () => data.treasure.drop('Act 1 Equip A', 1, b).map((x) => `${x.code}:${x.quality}`)).flat();
    expect(ra).toEqual(rb);
    for (const s of ra) {
      const q = Number(s.split(':')[1]);
      expect(q).toBeGreaterThanOrEqual(QUALITY.INFERIOR);
      expect(q).toBeLessThanOrEqual(QUALITY.UNIQUE);
    }
  });

  const newGame = (seed = 3) => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    const hax = data.treasure.createItem(data.items.base('hax')!, 1, new Rng(1), QUALITY.NORMAL);
    const game = new Game({
      map: new CollisionMap(60, 60), player: { x: 10.5, y: 10.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
      seed, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), equipment: { rarm: hax },
    });
    return { game, ch };
  };

  it('좀비 AI: 가까운 플레이어에게 다가와 공격한다', () => {
    const { game } = newGame();
    const z = game.spawnMonster('zombie1', 16.5, 10.5);
    let attacked = false;
    for (let i = 0; i < 500 && !attacked; i++) {
      for (const e of game.tick()) if (e.type === 'playerHit' || e.type === 'playerMissed' || e.type === 'playerBlocked') attacked = true;
    }
    expect(attacked).toBe(true);
    expect(Math.abs(z.x - 10.5)).toBeLessThan(5);
  });

  it('처치: 경험치 33(동레벨, 100%) 지급, 드롭은 TC 결과대로 바닥에 생성', () => {
    const { game, ch } = newGame(11);
    const z = game.spawnMonster('zombie1', 30.5, 30.5);
    z.nextThink = 1e9; // 움직이지 않게
    game.enqueue({ type: 'attack', targetId: z.id, standStill: false });
    const events = [];
    for (let i = 0; i < 1500 && z.mode !== 'DD'; i++) events.push(...game.tick());
    expect(events.some((e) => e.type === 'monsterKilled')).toBe(true);
    expect(ch.experience).toBe(33);
    const dropped = events.filter((e) => e.type === 'itemDropped').length;
    expect(game.snapshot().items.length).toBe(dropped);
  });

  it('pickup 명령: 걸어가서 골드는 골드로, 물약은 벨트로', () => {
    const { game } = newGame();
    const gld = data.treasure.createItem(data.items.base('gld')!, 1, new Rng(2), QUALITY.NORMAL);
    const hp1 = data.treasure.createItem(data.items.base('hp1')!, 1, new Rng(2), QUALITY.NORMAL);
    game.dropItem(gld, 20, 10);
    game.dropItem(hp1, 25, 12);
    game.enqueue({ type: 'pickup', itemId: gld.id });
    for (let i = 0; i < 100; i++) game.tick();
    game.enqueue({ type: 'pickup', itemId: hp1.id });
    for (let i = 0; i < 100; i++) game.tick();
    const s = game.snapshot();
    expect(s.player.gold).toBe(gld.quantity);
    // 출처: The Arreat Summit — Belt: 주운 물약은 벨트에 빈 칸이 있으면 벨트로
    expect(game.store.belt[0]?.code).toBe('hp1');
    expect(s.inventory.length).toBe(0);
    expect(s.items.length).toBe(0);
  });
});
