// 드루이드 스킬 (원작 1.14d LoD): 원소·소환·변신.
// 확장팩 MPQ 체인 (game-data/lod/patch_d2 + d2exp) 이 있어야 실행된다.
// 출처: 확장팩 skills.txt / states.txt / missiles.txt / monstats.txt, D2MOO source/D2Game/src/SKILLS/SkillDruid.cpp · MISSILES/MissMode.cpp
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { buildGameData } from '../../src/data/gamedata';
import { GameTables } from '../../src/data/tables';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { GAME_DATA } from '../support/gamedata';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable, type ClassName } from '../../src/engine/player';
import { Rng } from '../../src/engine/rng';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';
import type { MonsterUnit } from '../../src/engine/ai/types';
import type { StateList } from '../../src/engine/states';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));

let tables: GameTables;
let lod: GameData;

beforeAll(() => {
  if (!hasLod) return;
  const chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
  tables = new GameTables(chain);
  lod = buildGameData(chain, tables, { expansion: true });
});

/** 게임 내부 (테스트용) */
interface Inner {
  player: { x: number; y: number; mode: string; states: StateList; cast: unknown };
  events: { type: string; [k: string]: unknown }[];
  monsters: MonsterUnit[];
  pets: MonsterUnit[];
  missiles: { def: { name: string }; owner: string; x: number; y: number }[];
}

const S = (name: string) => lod.skills!.byNameOf(name)!;
const item = (code: string, lvl = 30) => lod.treasure.createItem(lod.items.base(code)!, lvl, new Rng(2), QUALITY.NORMAL, false);

function game(opts: { cls?: ClassName; skills?: Record<string, number>; level?: number; equipment?: Record<string, ItemInstance>; inTown?: boolean } = {}): { g: Game; inner: Inner } {
  const cls = opts.cls ?? 'Druid';
  const cs = classStats(tables.table('charstats'), cls);
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 30;
  ch.maxMana = ch.mana = 1000;
  for (const [n, l] of Object.entries(opts.skills ?? {})) ch.skills[S(n).id] = l;
  const g = new Game({
    map: new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 7, data: lod, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls),
    equipment: opts.equipment ?? { rarm: item('clb') }, inTown: opts.inTown ?? false,
  });
  g.tick();
  return { g, inner: g as unknown as Inner };
}

/** 스킬 사용 후 ticks 프레임 동안 생긴 미사일 이름 */
function cast(g: Game, name: string, x: number, y: number, targetId?: number, ticks = 40): Set<string> {
  const inner = g as unknown as Inner;
  g.enqueue({ type: 'useSkill', skill: S(name).id, hand: 'right', x, y, ...(targetId !== undefined ? { targetId } : {}) });
  const seen = new Set<string>();
  const evs: string[] = [];
  for (let i = 0; i < ticks; i++) {
    g.tick();
    for (const m of inner.missiles) seen.add(m.def.name);
    for (const e of inner.events) evs.push(e.type + (e.reason ? ':' + e.reason : ''));
  }
  if (process.env.DBG) console.log('CAST', name, [...new Set(evs)].join(','), [...seen].join(','));
  return seen;
}

/** 움직이지 않는 튼튼한 몬스터 */
function dummy(g: Game, x = 22.5, y = 20.5, id = 'zombie1'): MonsterUnit {
  const m = g.spawnMonster(id, x, y) as unknown as MonsterUnit;
  m.hp = m.stats.maxHp = 100000;
  m.nextThink = Number.POSITIVE_INFINITY;
  m.hpRegen = false;
  return m;
}

describe.skipIf(!hasLod)('Phase 1 — 원소', () => {
  it('Firestorm: firestormmaker ln12 개가 지나간 자리에 firestorm 불, 몬스터 화염 피해', () => {
    const { g, inner } = game({ skills: { Firestorm: 5 } });
    const z = dummy(g, 26.5, 20.5);
    g.enqueue({ type: 'useSkill', skill: S('Firestorm').id, hand: 'right', x: 26.5, y: 20.5, targetId: z.id });
    let makers = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      g.tick();
      makers = Math.max(makers, inner.missiles.filter((m) => m.def.name === 'firestormmaker').length);
      for (const m of inner.missiles) seen.add(m.def.name);
    }
    expect(makers).toBe(lod.skillCalc!.calc(S('Firestorm'), 1, 5, { baseLevel: () => 5, skillLevel: () => 5, unitLevel: 30 }));
    expect(seen.has('firestorm')).toBe(true);
    expect(z.hp).toBeLessThan(100000);
  });

  it('Twister: 미사일 calc1(3) 발, 맞은 몬스터는 기절', () => {
    const { g, inner } = game({ skills: { Twister: 5 } });
    const z = dummy(g, 24.5, 20.5);
    g.enqueue({ type: 'useSkill', skill: S('Twister').id, hand: 'right', x: 24.5, y: 20.5, targetId: z.id });
    let n = 0, stunned = false;
    for (let i = 0; i < 40; i++) {
      g.tick();
      n = Math.max(n, inner.missiles.filter((m) => m.def.name === 'twister').length);
      stunned ||= z.states.has('stunned');
    }
    expect(n).toBe(3);
    expect(stunned).toBe(true);
    expect(z.hp).toBeLessThan(100000);
  });

  it('Tornado: 주기마다 반경 안 몬스터 둘 다 피해', () => {
    const { g } = game({ skills: { Tornado: 5 } });
    const a = dummy(g, 25.5, 20.5), b = dummy(g, 25.5, 22.5);
    const seen = cast(g, 'Tornado', 25.5, 21.5, a.id, 60);
    expect(seen.has('tornado')).toBe(true);
    expect(a.hp).toBeLessThan(100000);
    expect(b.hp).toBeLessThan(100000);
  });

  it('Molten Boulder: emerge → 굴러가는 moltenboulder 가 불 자취를 남기고 몬스터를 밀어낸다', () => {
    const { g } = game({ skills: { 'Molten Boulder': 5 } });
    // 작은 몬스터 (monstats2 Small): dParam1 1 → 2 × dParam2(50) = 100% 넉백
    const z = dummy(g, 26.5, 20.5, 'fallen1');
    expect(lod.monsters.get('fallen1').small).toBe(true);
    const x0 = z.x;
    let maxX = x0;
    g.enqueue({ type: 'useSkill', skill: S('Molten Boulder').id, hand: 'right', x: 30.5, y: 20.5 });
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      g.tick();
      for (const m of (g as unknown as Inner).missiles) seen.add(m.def.name);
      maxX = Math.max(maxX, z.x);
    }
    expect(seen.has('moltenboulderemerge')).toBe(true);
    expect(seen.has('moltenboulder')).toBe(true);
    expect(seen.has('moltenboulderfirepath')).toBe(true);
    expect(z.hp).toBeLessThan(100000);
    expect(maxX).toBeGreaterThan(x0);
  });

  it('Fissure(Eruption): erruption center 가 crack 을 여러 개 만든다 (Blizzard 아님)', () => {
    const { g, inner } = game({ skills: { Eruption: 5 } });
    const z = dummy(g, 26.5, 20.5);
    g.enqueue({ type: 'useSkill', skill: S('Eruption').id, hand: 'right', x: 26.5, y: 20.5 });
    const seen = new Set<string>();
    let cracks = 0;
    for (let i = 0; i < 80; i++) {
      g.tick();
      for (const m of inner.missiles) {
        if (!seen.has(`${m.def.name}`) && m.def.name.startsWith('erruption crack')) cracks++;
        seen.add(m.def.name);
      }
    }
    expect(seen.has('erruption center')).toBe(true);
    expect([...seen].some((n) => n.startsWith('erruption crack'))).toBe(true);
    expect(seen.has('blizzard center')).toBe(false);
    expect(z.hp).toBeLessThan(100000);
    expect(cracks).toBeGreaterThan(0);
  });

  it('회귀: Blizzard·Meteor 는 그대로 (소서리스)', () => {
    const { g } = game({ cls: 'Sorceress', skills: { Blizzard: 1, Meteor: 1 }, equipment: {} });
    expect([...cast(g, 'Blizzard', 26.5, 20.5)].some((n) => n.startsWith('blizzard'))).toBe(true);
    for (let i = 0; i < 60; i++) g.tick();
    expect([...cast(g, 'Meteor', 26.5, 22.5, undefined, 80)].some((n) => n.startsWith('meteor'))).toBe(true);
  });

  it('Arctic Blast: arcticblast1 냉기 미사일 (Inferno 경로), 몬스터 냉기 피해', () => {
    const { g } = game({ skills: { 'Arctic Blast': 5 } });
    const z = dummy(g, 22.5, 20.5);
    const seen = cast(g, 'Arctic Blast', 22.5, 20.5, z.id, 30);
    expect(seen.has('arcticblast1')).toBe(true);
    expect(z.hp).toBeLessThan(100000);
    expect(z.states.has('cold')).toBe(true);
  });

  it('Cyclone Armor: 화염은 흡수량만큼 흡수, 물리는 흡수하지 않음, 다 쓰면 풀림', () => {
    const { g, inner } = game({ skills: { 'Cyclone Armor': 5 } });
    cast(g, 'Cyclone Armor', 20.5, 20.5);
    const st = inner.player.states.get('cyclonearmor')!;
    expect(st).toBeDefined();
    const full = st.stats.bonearmor ?? 0;
    expect(full).toBeGreaterThan(0);
    const hp = (g as unknown as { hitPlayer(a: { min: number; max: number; toHit: number }, l: number, h: number, m: boolean, at?: unknown, e?: unknown, always?: boolean): void }).hitPlayer.bind(g);
    const c = g.character!;
    const fire = (amt: number) => ({ phys: 0, fire: amt * 256, ltng: 0, cold: 0, mag: 0, pois: 0, coldLen: 0, poisLen: 0, freezeLen: 0, stunLen: 0, hitClass: 0, crit: false });
    c.life = 500;
    hp({ min: 0, max: 0, toHit: 0 }, 1, 0, true, undefined, fire(10), true);
    expect(c.life).toBe(500);
    expect(inner.player.states.get('cyclonearmor')!.stats.bonearmor).toBe(full - 10 * 256);
    hp({ min: 20, max: 20, toHit: 100000 }, 1, 0, true, undefined, undefined, true);
    expect(c.life).toBeLessThan(500);
    expect(inner.player.states.get('cyclonearmor')!.stats.bonearmor).toBe(full - 10 * 256);
    const before = c.life;
    hp({ min: 0, max: 0, toHit: 0 }, 1, 0, true, undefined, fire(full / 256), true);
    expect(inner.player.states.has('cyclonearmor')).toBe(false);
    expect(c.life).toBeLessThan(before);
  });

  it('Volcano: 화산이 돌덩이를 던지고 작은 불이 생긴다, 몬스터 피해', () => {
    const { g } = game({ skills: { Volcano: 5 } });
    const z = dummy(g, 26.5, 20.5);
    const seen = cast(g, 'Volcano', 26.5, 20.5, undefined, 150);
    expect(seen.has('volcano')).toBe(true);
    expect(seen.has('volcano debris 2')).toBe(true);
    expect(seen.has('volcano small fire')).toBe(true);
    expect(z.hp).toBeLessThan(100000);
  });

  it('Armageddon: 상태 동안 주기마다 불덩이가 떨어져 armageddonfire, 근처 몬스터 화염 피해', () => {
    const { g, inner } = game({ skills: { Armageddon: 5 } });
    const ms = [dummy(g, 22.5, 20.5), dummy(g, 20.5, 22.5), dummy(g, 18.5, 20.5), dummy(g, 20.5, 18.5)];
    const seen = cast(g, 'Armageddon', 20.5, 20.5, undefined, 200);
    expect(inner.player.states.has('armageddon')).toBe(true);
    expect(seen.has('armageddoncontrol')).toBe(true);
    expect(seen.has('armageddonfire')).toBe(true);
    expect(ms.some((m) => m.hp < 100000)).toBe(true);
  });

  it('Hurricane: 반경 안 몬스터 냉기 피해, 마을에서는 상태가 풀린다', () => {
    const { g, inner } = game({ skills: { Hurricane: 5 } });
    const z = dummy(g, 24.5, 20.5);
    cast(g, 'Hurricane', 20.5, 20.5, undefined, 60);
    expect(inner.player.states.has('hurricane')).toBe(true);
    expect(z.hp).toBeLessThan(100000);
    expect(z.states.has('cold')).toBe(true);
    const town = game({ skills: { Hurricane: 5 }, inTown: true });
    cast(town.g, 'Hurricane', 20.5, 20.5, undefined, 30);
    expect(town.inner.player.states.has('hurricane')).toBe(false);
  });
});
