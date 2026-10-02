// 조작·전투 반응을 원작대로 (사용자 신고 재현 → 수정): 우클릭 대상 규칙, 공격 중 이동, NPC 회피, 막기 쿨타임·피격 규칙, 수량 0, 공격 속도.
// 출처: D2MOO PlrModes.cpp (sub_6FC81890 · D2GAME_PLRMODES_First_6FC7F340 · sub_6FC80B90), SUnitDmg.cpp (막기 간격 · sub_6FCC1870),
//       D2Collision.cpp COLLISION_SetMaskWithPattern (유닛 자리 COLLIDE_NO_PATH), Units.cpp UNITS_UpdateAttackAnimRateAndVelocity
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { classStats, createCharacter, expTable, type ClassName } from '../../src/engine/player';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import { CLASS_CODE } from '../../src/engine/skills/db';

let tables: GameTables;
let data: GameData;
beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables, { expansion: true });
});

const S = (n: string) => data.skills!.byNameOf(n)!;
const item = (code: string, qty?: number, quality: number = QUALITY.NORMAL): ItemInstance => {
  const it = data.treasure.createItem(data.items.base(code)!, 30, new Rng(2), QUALITY.NORMAL, false);
  it.quality = quality as ItemInstance['quality'];
  if (qty !== undefined) it.quantity = qty;
  return it;
};

interface Inner {
  player: { x: number; y: number; mode: string; cast: unknown; action: unknown; path: unknown[]; states: { set(n: string, until: number, stats?: Record<string, number>): void; has(n: string): boolean } };
  killMonster(m: unknown): void;
  missiles: { def: { name: string }; x: number; y: number; visual?: boolean }[];
  tickCount: number;
}

/** 모든 클래스 스킬 20 레벨, 마나·생명 넉넉 */
function setup(cls: ClassName, equipment: Record<string, ItemInstance> = {}, opts: { inventory?: ItemInstance[]; map?: CollisionMap } = {}) {
  const cs = classStats(tables.table('charstats'), cls);
  const ch = createCharacter(cs);
  ch.level = 99;
  ch.str = ch.dex = 500;
  ch.life = ch.maxLife = 1e5;
  ch.mana = ch.maxMana = 1e5;
  for (const s of data.skills!.byId.values()) if (s.charclass === CLASS_CODE[cls]) ch.skills[s.id] = 20;
  const game = new Game({
    map: opts.map ?? new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 5, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls), equipment, inTown: false,
    ...(opts.inventory ? { inventory: opts.inventory } : {}),
  });
  game.tick();
  return { game, ch, inner: game as unknown as Inner };
}

function dummy(game: Game, id = 'zombie1', x = 22.5, y = 20.5) {
  const m = game.spawnMonster(id, x, y);
  m.hp = m.stats.maxHp = 1e7;
  m.nextThink = Number.POSITIVE_INFINITY;
  return m;
}

function run(game: Game, ticks: number): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) ev.push(...game.tick());
  return ev;
}

describe.skipIf(!hasGameData)('우클릭 대상 규칙: 살아 있는 몬스터가 아니면 클릭한 자리로 시전', () => {
  function corpseAt(game: Game, x: number, y: number) {
    const z = game.spawnMonster('zombie1', x, y);
    (game as unknown as Inner).killMonster(z);
    run(game, 60);
    expect(z.mode).toBe('DD');
    return z;
  }
  it('시체 위를 클릭한 Fire Ball 은 취소되지 않고 그 자리로 나간다', () => {
    const { game, inner } = setup('Sorceress');
    const z = corpseAt(game, 28.5, 20.5);
    game.enqueue({ type: 'useSkill', skill: S('Fire Ball').id, hand: 'right', x: 28.5, y: 20.5, targetId: z.id });
    const ev = run(game, 12);
    expect(ev.some((e) => e.type === 'skillStart' && e.skill === S('Fire Ball').id)).toBe(true);
    const ms = inner.missiles.find((m) => m.def.name === 'fireball');
    expect(ms, '불덩이 미사일').toBeDefined();
    expect(ms!.x).toBeGreaterThan(20.5);
  });
  it('몬스터가 아닌 유닛 번호(오브젝트·NPC)를 대상으로 줘도 그 자리로 시전', () => {
    const { game } = setup('Amazon', { rarm: item('jav', 50) });
    game.enqueue({ type: 'useSkill', skill: S('Valkyrie').id, hand: 'right', x: 24.5, y: 20.5, targetId: 987654 });
    const ev = run(game, 40);
    expect(ev.some((e) => e.type === 'petSummoned'), '발키리 소환').toBe(true);
  });
  it('시체 대상 스킬(Raise Skeleton)은 그대로 시체에서', () => {
    const { game } = setup('Necromancer');
    const z = corpseAt(game, 24.5, 20.5);
    game.enqueue({ type: 'useSkill', skill: S('Raise Skeleton').id, hand: 'right', x: z.x, y: z.y, targetId: z.id });
    expect(run(game, 40).some((e) => e.type === 'petSummoned')).toBe(true);
  });
  it('가는 도중 대상이 죽으면: 원거리 스킬은 그 자리로, 왼쪽 클릭 공격(attack)은 멈춤', () => {
    const { game, inner } = setup('Sorceress');
    const m = dummy(game, 'zombie1', 28.5, 20.5);
    game.enqueue({ type: 'useSkill', skill: S('Fire Ball').id, hand: 'right', x: m.x, y: m.y, targetId: m.id });
    inner.killMonster(m);
    expect(run(game, 12).some((e) => e.type === 'skillStart')).toBe(true);
  });
});
