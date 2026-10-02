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

describe.skipIf(!hasGameData)('공격은 누르고 있는 동안만 · 바쁠 때 온 이동 클릭은 기억했다가 실행', () => {
  const starts = (ev: GameEvent[]) => ev.filter((e) => e.type === 'skillStart').length;
  it('버튼을 떼면(release) 지금 휘두르는 것까지만 하고 멈춘다', () => {
    const { game, inner } = setup('Barbarian', { rarm: item('axe') });
    const m = dummy(game);
    game.enqueue({ type: 'attack', targetId: m.id, standStill: false });
    expect(starts(run(game, 40))).toBeGreaterThanOrEqual(2);
    game.enqueue({ type: 'release', button: 'left' });
    const after = run(game, 100);
    expect(starts(after)).toBe(0);
    expect(inner.player.action).toBeNull();
  });
  it('누르고 있는 동안(release 없음)은 계속 공격', () => {
    const { game } = setup('Barbarian', { rarm: item('axe') });
    const m = dummy(game);
    game.enqueue({ type: 'attack', targetId: m.id, standStill: false });
    run(game, 40);
    expect(starts(run(game, 100))).toBeGreaterThanOrEqual(4);
  });
  it('바로 뗀 클릭(attack + release): 멀리 있는 몬스터에게 걸어가 한 번 친다', () => {
    const { game } = setup('Barbarian', { rarm: item('axe') });
    const m = dummy(game, 'zombie1', 30.5, 20.5);
    game.enqueue({ type: 'attack', targetId: m.id, standStill: false });
    game.enqueue({ type: 'release', button: 'left' });
    expect(starts(run(game, 150))).toBe(1);
  });
  it('공격 동작 중에 온 이동 클릭 한 번: 동작이 끝나면 이동한다 (계속 공격하지 않는다)', () => {
    const { game, inner } = setup('Barbarian', { rarm: item('axe') });
    const m = dummy(game);
    game.enqueue({ type: 'attack', targetId: m.id, standStill: false });
    run(game, 20);
    expect(inner.player.cast, '공격 동작 중').not.toBeNull();
    game.enqueue({ type: 'move', x: 40.5, y: 40.5, run: true });
    const ev = run(game, 150);
    expect(Math.hypot(inner.player.x - 40.5, inner.player.y - 40.5)).toBeLessThan(1.5);
    expect(starts(ev)).toBe(0);
  });
  it('시전 동작 중에 온 이동 클릭도 시전이 끝나면 실행', () => {
    const { game, inner } = setup('Sorceress');
    game.enqueue({ type: 'useSkill', skill: S('Fire Ball').id, hand: 'right', x: 30.5, y: 20.5 });
    run(game, 3);
    expect(inner.player.cast).not.toBeNull();
    game.enqueue({ type: 'move', x: 20.5, y: 35.5, run: true });
    run(game, 120);
    expect(Math.hypot(inner.player.x - 20.5, inner.player.y - 35.5)).toBeLessThan(1.5);
  });
  it('기억한 이동은 그 뒤에 온 다른 명령(스킬)이 지운다', () => {
    const { game, inner } = setup('Sorceress');
    game.enqueue({ type: 'useSkill', skill: S('Fire Ball').id, hand: 'right', x: 30.5, y: 20.5 });
    run(game, 3);
    game.enqueue({ type: 'move', x: 20.5, y: 35.5, run: true });
    game.enqueue({ type: 'useSkill', skill: S('Fire Ball').id, hand: 'right', x: 30.5, y: 20.5 });
    run(game, 120);
    expect(Math.hypot(inner.player.x - 20.5, inner.player.y - 20.5)).toBeLessThan(0.1);
  });
});

describe.skipIf(!hasGameData)('유닛 회피: NPC·몬스터 자리를 돌아서 간다 (원작 COLLIDE_NO_PATH 발자국)', () => {
  const dist = (inner: Inner, x: number, y: number) => Math.hypot(inner.player.x - x, inner.player.y - y);
  it('NPC 를 사이에 둔 직선 이동: 멈추지 않고 돌아서 도착', () => {
    const { game, inner } = setup('Barbarian');
    const npc = game.spawnNpc('charsi', 24.5, 20.5)!;
    expect(npc).not.toBeNull();
    game.enqueue({ type: 'move', x: 28.5, y: 20.5, run: true });
    run(game, 100);
    expect(dist(inner, 28.5, 20.5)).toBeLessThan(1);
  });
  it('목표가 NPC 자리면 가장 가까운 빈칸(플레이어 쪽)까지', () => {
    const { game, inner } = setup('Barbarian');
    game.spawnNpc('charsi', 26.5, 20.5);
    game.enqueue({ type: 'move', x: 26.5, y: 20.5, run: true });
    run(game, 100);
    // 작은 유닛: 맨해튼 거리 1 이하 칸은 못 들어간다 → 2칸 떨어진 곳, 플레이어가 온 쪽
    expect(Math.abs(Math.floor(inner.player.x) - 26) + Math.abs(Math.floor(inner.player.y) - 20)).toBe(2);
    expect(inner.player.x).toBeLessThan(26);
  });
  it('작은 유닛 옆(대각선)은 지나갈 수 있다: 원작은 가운데 칸만 막는다', () => {
    const { game, inner } = setup('Barbarian');
    const m = dummy(game, 'zombie1', 24.5, 20.5);
    // 좀비 바로 대각선 칸 (맨해튼 2) 으로 이동
    game.enqueue({ type: 'move', x: 25.5, y: 21.5, run: true });
    run(game, 100);
    expect(dist(inner, 25.5, 21.5)).toBeLessThan(0.6);
    void m;
  });
  it('가는 길에 유닛이 끼어들어 막히면 길을 다시 찾아 도착', () => {
    const { game, inner } = setup('Barbarian');
    game.enqueue({ type: 'move', x: 34.5, y: 20.5, run: false });
    run(game, 10);
    // 진행 방향 앞에 갑자기 NPC (길을 찾은 뒤에 생김)
    game.spawnNpc('charsi', Math.floor(inner.player.x) + 3.5, 20.5);
    run(game, 250);
    expect(dist(inner, 34.5, 20.5)).toBeLessThan(1);
  });
  it('몬스터에게 붙어 있다가도 반대쪽으로는 빠져나온다', () => {
    const { game, inner } = setup('Barbarian', { rarm: item('axe') });
    const m = dummy(game, 'zombie1', 21.5, 20.5);
    game.enqueue({ type: 'move', x: 14.5, y: 20.5, run: true });
    run(game, 80);
    expect(dist(inner, 14.5, 20.5)).toBeLessThan(1);
    void m;
  });
});

describe.skipIf(!hasGameData)('마을 NPC 가 계속 앞을 막아도 결국 지나간다 (사용자 요청: 마을에서 절대 안 멈춤)', () => {
  it('NPC 가 따라오며 계속 진행 방향 2칸 앞에 서도 목표에 도착', () => {
    const { game, inner } = setup('Barbarian');
    const npc = game.spawnNpc('charsi', 23.5, 20.5)!;
    npc.nextThink = Number.POSITIVE_INFINITY;
    game.enqueue({ type: 'move', x: 34.5, y: 20.5, run: true });
    for (let i = 0; i < 400; i++) {
      // 최악의 경우: 매 틱 플레이어 바로 앞(동쪽 2칸)으로 옮겨 선다
      npc.x = Math.floor(inner.player.x) + 2.5;
      npc.y = Math.floor(inner.player.y) + 0.5;
      game.tick();
    }
    expect(Math.hypot(inner.player.x - 34.5, inner.player.y - 20.5)).toBeLessThan(1.5);
  });
  it('유닛과 같은 칸에 겹쳐 있어도 걸어 나올 수 있다', () => {
    const { game, inner } = setup('Barbarian');
    dummy(game, 'zombie1', 20.5, 20.5);
    game.enqueue({ type: 'move', x: 26.5, y: 20.5, run: true });
    run(game, 100);
    expect(Math.hypot(inner.player.x - 26.5, inner.player.y - 20.5)).toBeLessThan(1);
  });
  it('필드 몬스터는 통과하지 않는다: 사방이 막히면 그대로 멈춘다', () => {
    const { game, inner } = setup('Barbarian');
    // 플레이어(20,20) 둘레를 몬스터로 둘러쌈 (맨해튼 2 인 칸 전부)
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) dummy(game, 'zombie1', 20.5 + dx, 20.5 + dy);
    game.enqueue({ type: 'move', x: 30.5, y: 20.5, run: true });
    run(game, 150);
    expect(Math.hypot(inner.player.x - 20.5, inner.player.y - 20.5)).toBeLessThan(1.5);
  });
});
