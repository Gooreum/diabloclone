// 어쌔신 스킬 (원작 1.14d LoD): 시퀀스·버프·단발 스킬·무술 차지·피니셔·함정·그림자.
// 확장팩 MPQ 체인 (game-data/lod/patch_d2 + d2exp) 이 있어야 실행된다.
// 출처: 확장팩 skills.txt / states.txt / missiles.txt / monstats.txt, D2MOO source/D2Game/src/SKILLS/SkillAss.cpp · SkillSor.cpp SrvDo018
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
import { PLAYER_SEQUENCES } from '../../src/engine/skills/sequences';
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
  missiles: { def: { name: string }; owner: string }[];
}

const S = (name: string) => lod.skills!.byNameOf(name)!;
const item = (code: string, lvl = 30) => lod.treasure.createItem(lod.items.base(code)!, lvl, new Rng(2), QUALITY.NORMAL, false);

function game(opts: { cls?: ClassName; skills?: Record<string, number>; level?: number; equipment?: Record<string, ItemInstance>; inTown?: boolean } = {}): { g: Game; inner: Inner } {
  const cls = opts.cls ?? 'Assassin';
  const cs = classStats(tables.table('charstats'), cls);
  const ch = createCharacter(cs);
  ch.level = opts.level ?? 30;
  ch.mana = 1000;
  for (const [n, l] of Object.entries(opts.skills ?? {})) ch.skills[S(n).id] = l;
  const g = new Game({
    map: new CollisionMap(80, 80), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 7, data: lod, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls),
    equipment: opts.equipment ?? { rarm: item('ktr') }, inTown: opts.inTown ?? false,
  });
  g.tick();
  return { g, inner: g as unknown as Inner };
}

function cast(g: Game, name: string, x: number, y: number, targetId?: number, ticks = 40): void {
  g.enqueue({ type: 'useSkill', skill: S(name).id, hand: 'right', x, y, ...(targetId !== undefined ? { targetId } : {}) });
  for (let i = 0; i < ticks; i++) g.tick();
}

/** 일반 공격 한 번 (attack 명령) */
function hit(g: Game, m: MonsterUnit, ticks = 30): void {
  g.enqueue({ type: 'attack', targetId: m.id, standStill: true });
  for (let i = 0; i < ticks; i++) g.tick();
}

/** 움직이지 않는 튼튼한 몬스터 */
function dummy(g: Game, x = 22.5, y = 20.5, id = 'zombie1'): MonsterUnit {
  const m = g.spawnMonster(id, x, y) as unknown as MonsterUnit;
  m.hp = m.stats.maxHp = 100000;
  m.nextThink = Number.POSITIVE_INFINITY;
  return m;
}

describe.skipIf(!hasLod)('Phase 1 — 시퀀스·버프·지연', () => {
  it('seqnum 16·19·21·23 시퀀스: Dragon Claw HT1·HT2, Dragon Talon(KK), Dragon Flight, Blade Fury', () => {
    expect(PLAYER_SEQUENCES[16]?.HT1?.length).toBeGreaterThan(0);
    expect(PLAYER_SEQUENCES[16]?.HT2?.some((f) => f[0] === 'S4')).toBe(true);
    expect(PLAYER_SEQUENCES[19]?.HTH?.every((f) => f[0] === 'KK')).toBe(true);
    expect(PLAYER_SEQUENCES[21]?.HT1?.length).toBeGreaterThan(0);
    expect(PLAYER_SEQUENCES[23]?.HT1?.filter((f) => f[2] === 1)).toHaveLength(1);
  });

  it('클래식 seq 1~15 는 그대로 (Jab·Inferno 시퀀스)', () => {
    expect(Object.keys(PLAYER_SEQUENCES).map(Number).filter((n) => n < 16)).toHaveLength(15);
    expect(PLAYER_SEQUENCES[1]).toBeDefined();
  });

  it('Burst of Speed 뒤 Fade: 같은 states group(2) 이라 quickness 가 지워진다, Fade 는 저항·passivestat fade 를 단다', () => {
    const { g, inner } = game({ skills: { Quickness: 5, Fade: 5 } });
    cast(g, 'Quickness', 20.5, 20.5);
    expect(inner.player.states.has('quickness')).toBe(true);
    expect(inner.player.states.stat('velocitypercent')).toBeGreaterThan(0);
    cast(g, 'Fade', 20.5, 20.5);
    expect(inner.player.states.has('quickness')).toBe(false);
    expect(inner.player.states.has('fade')).toBe(true);
    expect(inner.player.states.stat('fireresist')).toBeGreaterThan(0);
    expect(inner.player.states.stat('fade')).toBe(2);
  });

  it('회귀: Frozen Armor 뒤 Shiver Armor — 아머는 하나만 (states group 1)', () => {
    const { g, inner } = game({ cls: 'Sorceress', skills: { 'Frozen Armor': 1, 'Shiver Armor': 1 }, equipment: {} });
    cast(g, 'Frozen Armor', 20.5, 20.5);
    cast(g, 'Shiver Armor', 20.5, 20.5);
    expect([inner.player.states.has('frozenarmor'), inner.player.states.has('shiverarmor')]).toEqual([false, true]);
  });

  it('Venom: 근접 명중에 독 (몬스터 poison 상태), Venom 이 없으면 독 없음', () => {
    const run = (venom: boolean) => {
      const { g, inner } = game({ skills: venom ? { Venom: 10 } : {} });
      if (venom) cast(g, 'Venom', 20.5, 20.5);
      expect(inner.player.states.has('venomclaws')).toBe(venom);
      const z = dummy(g, 21.5, 20.5);
      for (let k = 0; k < 10 && !z.states.has('poison'); k++) hit(g, z);
      return z.states.has('poison');
    };
    expect(run(true)).toBe(true);
    expect(run(false)).toBe(false);
  });

  it('스킬 지연: Blade Sentinel(delay 50) 직후 다시 쓸 수 없고 50 프레임 뒤엔 풀린다', () => {
    const { g, inner } = game({ skills: { 'Blade Sentinel': 1, 'Dragon Flight': 1 } });
    cast(g, 'Blade Sentinel', 25.5, 20.5, undefined, 1);
    expect(inner.player.states.has('skilldelay')).toBe(true);
    for (let i = 0; i < 30; i++) g.tick();
    inner.events.length = 0;
    cast(g, 'Blade Sentinel', 25.5, 20.5, undefined, 1);
    expect(inner.events.some((e) => e.type === 'skillUnusable' && e.reason === 'delay')).toBe(true);
    for (let i = 0; i < 60; i++) g.tick();
    expect(inner.player.states.has('skilldelay')).toBe(false);
  });
});
