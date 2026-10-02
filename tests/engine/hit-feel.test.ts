// 타격감: 맞는 소리(HitClass → impact_*), 휘두름 타격 프레임, 피(MonStats2 Bleed), 미사일 폭발 그림, 상태 색, 시전 오버레이, 밀쳐내기, 얼어 죽음.
// 출처: 원작 HitClass.txt · sounds.txt · MonStats2.txt (Bleed: 0 없음, 1 blood1·2, 2 bigblood 포함 — Phrozen Keep MonStats2 가이드) · Missiles.txt
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { impactSounds } from '../../src/data/sounds';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { Rng } from '../../src/engine/rng';
import { QUALITY } from '../../src/engine/treasure';
import { classStats, createCharacter, expTable, type ClassName } from '../../src/engine/player';

describe('맞는 소리 표 (HitClass → impact_*)', () => {
  it('물리 하위 4비트: 둔기 club 8 → blunt, 1hss 2 → blade_swing, 1ht 6 → blade_thrust, bow 10 → arrow, claw 12 → claw', () => {
    expect(impactSounds(0x08)).toEqual(['impact_blunt_1']);
    expect(impactSounds(0x02)).toEqual(['impact_blade_swing_1']);
    expect(impactSounds(0x06)).toEqual(['impact_blade_thrust_1']);
    expect(impactSounds(0x0a)).toEqual(['impact_arrow_1']);
    expect(impactSounds(0x0c)).toEqual(['impact_claw_1']);
  });
  it('원소 상위 4비트는 겹소리: 0x22 = 칼 + 불, 0x30 = 냉기만', () => {
    expect(impactSounds(0x22)).toEqual(['impact_blade_swing_1', 'impact_fire_1']);
    expect(impactSounds(0x30)).toEqual(['impact_cold_1']);
  });
  it('None 0·overlay 13 은 소리 없음', () => {
    expect(impactSounds(0)).toEqual([]);
    expect(impactSounds(13)).toEqual([]);
  });
});

let tables: GameTables;
let data: GameData;
beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables, { expansion: true });
});

function setup(cls: ClassName = 'Barbarian') {
  const cs = classStats(tables.table('charstats'), cls);
  const ch = createCharacter(cs);
  ch.level = 40;
  ch.life = ch.maxLife = 5000;
  ch.str = 300;
  ch.dex = 300;
  const game = new Game({
    map: new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 9, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls), equipment: { rarm: data.treasure.createItem(data.items.base('ssd')!, 30, new Rng(2), QUALITY.NORMAL, false) }, inTown: false,
  });
  game.tick();
  return { game, ch };
}

/** 움직이지 않는 튼튼한 몬스터 */
function dummy(game: Game, id = 'zombie1', x = 22.5, y = 20.5) {
  const m = game.spawnMonster(id, x, y);
  m.hp = m.stats.maxHp = 100000;
  m.nextThink = Number.POSITIVE_INFINITY;
  return m;
}

/** 몬스터를 칼(Short Sword)로 칠 때까지 돌리며 사건을 모은다 */
function meleeUntilHit(game: Game, targetId: number, maxTicks = 200): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    if (i % 25 === 0) game.enqueue({ type: 'attack', targetId, standStill: false });
    all.push(...game.tick());
    if (all.some((e) => e.type === 'monsterHit')) return all;
  }
  if (process.env.DBG) console.log(all.filter((e) => e.type === 'skillUnusable').slice(0, 2), (game as unknown as { character: { leftSkill: number } }).character.leftSkill, (game as unknown as { player: unknown }).player);
  return all;
}

describe.skipIf(!hasGameData)('맞는 소리·휘두름 (원작 데이터)', () => {
  it('단검(1hss) 근접 타격: monsterHit 에 칼 hitClass 와 melee 표시 → blade_swing 소리', () => {
    const { game } = setup();
    const m = dummy(game);
    const hit = meleeUntilHit(game, m.id).find((e) => e.type === 'monsterHit');
    expect(hit, '근접 타격 사건').toBeDefined();
    // 1hss(2) 또는 큰 대상 1hsl(3) — 둘 다 칼 휘두름 소리
    expect([2, 3]).toContain(Number(hit!.hitClass) & 0x0f);
    expect(impactSounds(Number(hit!.hitClass))[0]).toBe('impact_blade_swing_1');
    expect(hit!.melee).toBe(true);
  });
  it('기본 공격 skillStart 에 첫 판정 프레임(hitTick > 0)', () => {
    const { game } = setup();
    const m = dummy(game);
    const st = meleeUntilHit(game, m.id).find((e) => e.type === 'skillStart' && e.skill === 0);
    expect(st, '기본 공격 시작').toBeDefined();
    expect(Number(st!.hitTick)).toBeGreaterThan(0);
  });
});
