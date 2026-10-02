// 타격감: 맞는 소리(HitClass → impact_*), 휘두름 타격 프레임, 피(MonStats2 Bleed), 미사일 폭발 그림, 상태 색, 시전 오버레이, 밀쳐내기, 얼어 죽음.
// 출처: 원작 HitClass.txt · sounds.txt · MonStats2.txt (Bleed: 0 없음, 1 blood1·2, 2 bigblood 포함 — Phrozen Keep MonStats2 가이드) · Missiles.txt
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { impactSounds } from '../../src/data/sounds';
import { parsePl2Hues } from '../../src/formats/pl2';
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

/** 지금 떠 있는 그림 미사일 이름 */
const visuals = (game: Game) => (game as unknown as { missiles: { def: { name: string }; visual?: boolean }[] }).missiles.filter((x) => x.visual).map((x) => x.def.name);

describe.skipIf(!hasGameData)('피 튀김 (MonStats2 Bleed)', () => {
  it('Bleed 1 몬스터(zombie1)를 치면 blood1·blood2 그림', () => {
    expect(data.monsters.types.get('zombie1')!.bleed).toBe(1);
    const { game } = setup();
    const m = dummy(game);
    meleeUntilHit(game, m.id);
    const v = visuals(game);
    expect(v.some((n) => n === 'blood1' || n === 'blood2'), v.join(',')).toBe(true);
    expect(v.some((n) => n.startsWith('bigblood'))).toBe(false);
  });
  it('Bleed 0 몬스터는 피 없음', () => {
    const id = [...data.monsters.types.values()].find((t) => t.bleed === 0 && t.modes.has('GH') && !t.npc && t.killable)!.id;
    const { game } = setup();
    const m = dummy(game, id);
    meleeUntilHit(game, m.id);
    expect(visuals(game).filter((n) => n.includes('blood'))).toEqual([]);
  });
  it('Bleed 2 몬스터는 big 까지 넷 중에서만', () => {
    const t = [...data.monsters.types.values()].find((x) => x.bleed === 2 && x.killable && !x.npc);
    expect(t, 'Bleed 2 몬스터').toBeDefined();
    const { game } = setup();
    const m = dummy(game, t!.id);
    for (let i = 0; i < 6; i++) meleeUntilHit(game, m.id, 60);
    expect(visuals(game).filter((n) => n.includes('blood')).every((n) => ['blood1', 'blood2', 'bigblood1', 'bigblood2'].includes(n))).toBe(true);
  });
});

describe.skipIf(!hasGameData)('미사일 폭발 그림 (ExplosionMissile · CltHitSubMissile)', () => {
  const fireBolt = () => data.skills!.byNameOf('Fire Bolt')!;
  function sorc() {
    const r = setup('Sorceress');
    r.ch.skills[fireBolt().id] = 1;
    r.ch.mana = r.ch.maxMana = 1000;
    return r;
  }
  function castAt(game: Game, x: number, y: number, targetId?: number, ticks = 60): string[] {
    const seen = new Set<string>();
    game.enqueue({ type: 'useSkill', skill: fireBolt().id, hand: 'right', x, y, ...(targetId !== undefined ? { targetId } : {}) });
    for (let i = 0; i < ticks; i++) {
      game.tick();
      for (const n of visuals(game)) seen.add(n);
    }
    return [...seen];
  }
  it('Fire Bolt 이 몬스터에 맞으면 fireexplode', () => {
    expect(data.missiles.get('firebolt')!.explosionMissile).toBe('fireexplode');
    const { game } = sorc();
    const m = dummy(game, 'zombie1', 26.5, 20.5);
    expect(castAt(game, m.x, m.y, m.id)).toContain('fireexplode');
  });
  it('아무것도 안 맞고 사거리가 끝나면 (AlwaysExplode 아님) 폭발 없음', () => {
    expect(data.missiles.get('firebolt')!.alwaysExplode).toBe(false);
    const { game } = sorc();
    expect(castAt(game, 40.5, 20.5)).not.toContain('fireexplode');
  });
  it('Fire Ball 은 CltHitSubMissile(fireexplosion2) 도 같이', () => {
    const fb = data.missiles.get('fireball')!;
    expect(fb.cltHitSub).toContain('fireexplosion2');
  });
});

describe.skipIf(!hasGameData)('상태 색 · 시전 섬광', () => {
  it('냉기(cold) 걸린 몬스터 스냅샷에 colorshift 108, 독은 104, 아무 상태 없으면 없음', () => {
    const { game } = setup();
    const m = dummy(game);
    const snap = () => game.snapshot().monsters.find((x) => x.id === m.id)!;
    expect(snap().stateShift).toBeUndefined();
    m.states.set('poison', game.snapshot().tick + 100, { hpregen: -1 });
    expect(snap().stateShift).toBe(104);
    // 냉기(colorpri 100) 가 독(95) 보다 앞선다
    m.states.set('cold', game.snapshot().tick + 100, {});
    expect(snap().stateShift).toBe(108);
  });
  it('Fire Bolt 시전: castoverlay fire_cast_1 이 시전자 자리에 잠깐', () => {
    const { game, ch } = setup('Sorceress');
    const fb = data.skills!.byNameOf('Fire Bolt')!;
    expect(fb.castOverlay).toBe('fire_cast_1');
    ch.skills[fb.id] = 1;
    ch.mana = ch.maxMana = 1000;
    game.enqueue({ type: 'useSkill', skill: fb.id, hand: 'right', x: 30.5, y: 20.5 });
    let seen = false;
    for (let i = 0; i < 10; i++) {
      game.tick();
      if (game.snapshot().missiles.some((x) => x.name === 'overlay:fire_cast_1')) seen = true;
    }
    expect(seen).toBe(true);
    for (let i = 0; i < 60; i++) game.tick();
    expect(game.snapshot().missiles.some((x) => x.name === 'overlay:fire_cast_1')).toBe(false);
  });
});

describe.skipIf(!hasGameData)('Pal.PL2 색 바꾸기 표 (상태 색)', () => {
  it('ACT1 Pal.PL2 의 108 번 표는 파란 쪽, 104 번은 초록 쪽으로 바꾼다', () => {
    const b = gameChain().read('data\\global\\palette\\ACT1\\Pal.pl2')!;
    const hues = parsePl2Hues(b);
    expect(hues.length).toBe(111 * 256);
    const avg = (t: number) => {
      const s: [number, number, number] = [0, 0, 0];
      for (let i = 1; i < 255; i++) for (let k = 0; k < 3; k++) s[k]! += b[hues[t * 256 + i]! * 4 + k]!;
      return s;
    };
    const [r1, g1, b1] = avg(108), [r2, g2, b2] = avg(104);
    expect(b1).toBeGreaterThan(r1);
    expect(b1).toBeGreaterThan(g1);
    expect(g2).toBeGreaterThan(r2);
    expect(g2).toBeGreaterThan(b2);
  });
});

interface KillInner { killMonster(m: unknown, source?: string): void; knockBack(m: unknown, from?: { x: number; y: number }): void }

describe.skipIf(!hasGameData)('몬스터 반응 — 밀쳐내기 방향 · 얼어 죽음', () => {
  it('밀쳐내기는 때린 쪽 반대로: 오른쪽(x 30)에서 때리면 왼쪽(x 감소)으로', () => {
    const { game } = setup();
    const m = dummy(game, 'zombie1', 26.5, 20.5);
    (game as unknown as KillInner).knockBack(m, { x: 30.5, y: 20.5 });
    expect(m.x).toBeLessThan(26.5);
  });
  it('기본값(때린 쪽 모름)은 플레이어 반대: 플레이어 x 20.5 → 몬스터는 오른쪽으로', () => {
    const { game } = setup();
    const m = dummy(game, 'zombie1', 26.5, 20.5);
    (game as unknown as KillInner).knockBack(m);
    expect(m.x).toBeGreaterThan(26.5);
  });
  it('빙결(freeze) 상태로 죽으면 부서진다: 시체 없음 · icebreak 그림 · monsterShattered', () => {
    const { game } = setup();
    const m = dummy(game);
    m.states.set('freeze', game.snapshot().tick + 100, {});
    (game as unknown as KillInner).killMonster(m);
    const evs = game.tick();
    expect(m.shattered).toBe(true);
    expect(m.corpseUsed).toBe(true);
    expect(game.snapshot().monsters.some((x) => x.id === m.id)).toBe(false);
    expect(visuals(game).some((n) => n.startsWith('icebreak'))).toBe(true);
    void evs;
  });
  it('빙결 아니면 시체가 남는다', () => {
    const { game } = setup();
    const m = dummy(game);
    (game as unknown as KillInner).killMonster(m);
    for (let i = 0; i < 80; i++) game.tick();
    expect(m.shattered).toBeUndefined();
    expect(game.snapshot().monsters.find((x) => x.id === m.id)?.mode).toBe('DD');
  });
});
