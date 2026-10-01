// 확장팩 Act 5 몬스터 AI·스킬 (원작 monstats AI / aip / Skill + D2MOO AiThink.cpp Fn113~142 · SkillDruid.cpp SrvDo128~136).
// 확장팩 MPQ 체인 (game-data/lod/patch_d2 + d2exp) 이 있어야 실행된다.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { GAME_DATA } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { AI_TARGET_MODE, hasAi, type MonsterUnit } from '../../src/engine/ai';
import type { SkillTarget } from '../../src/engine/ai/types';

const LOD = resolve(GAME_DATA, 'lod');
const path = (n: string) => [resolve(LOD, n), resolve(GAME_DATA, n)].find((p) => existsSync(p));
const hasLod = existsSync(resolve(LOD, 'patch_d2.mpq')) && mpqOrder('lod').every((n) => !!path(n));

/** NPC·장식 AI (NPC 단계 담당) — 이 테스트의 대상이 아니다 */
const NPC_AI = new Set(['Idle', 'Npc', 'Towner', 'Vendor', 'NpcStationary', 'Hireable', 'Buffy', 'NpcOutOfTown', 'Navi', 'TownRogue', 'JarJar', 'GoodNpcRanged', 'Hireable']);
/** 퀘스트 단계(5~7) 에서 만드는 AI */
const QUEST_AI = new Set(['Wussie', 'Nihlathak', 'AncientStatue', 'Ancient', 'BaalThrone', 'BaalToStairs', 'BaalCrab', 'BaalCrabClone', 'BaalTentacle', 'BaalMinion']);

type Inner = { monsterUseSkill(m: MonsterUnit, slot: number, t: SkillTarget | null): boolean; killMonster(m: MonsterUnit, s: string): void };

describe.skipIf(!hasLod)('Act 5 몬스터 (확장팩 원작 데이터)', () => {
  let data: GameData;
  let tables: GameTables;
  beforeAll(() => {
    const chain = new MpqChain(mpqOrder('lod').map((n) => MpqArchive.open(readFileSync(path(n)!))));
    tables = new GameTables(chain);
    data = buildGameData(chain, tables, { expansion: true });
  }, 120_000);

  const newGame = (seed = 1, levelNo = 111) => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    const map = new CollisionMap(90, 90);
    const game = new Game({
      map, levels: [{ id: 'main', map, inTown: false, exits: [], levelNo }], player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
      seed, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
    });
    return game;
  };
  const run = (game: Game, n: number, pred?: (ev: GameEvent[]) => boolean): GameEvent[] => {
    const out: GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      if (game.character) game.character.life = game.maxLife();
      const ev = game.tick();
      out.push(...ev);
      if (pred?.(ev)) break;
    }
    return out;
  };
  const inner = (g: Game) => g as unknown as Inner;

  /** Act 5 (levels.txt 109~132) mon/nmon/umon + 스폰·미니언 + 슈퍼유니크 */
  const act5Monsters = (): Set<string> => {
    const ms = new Map(tables.table('monstats').map((r) => [r.Id, r]));
    const ids = new Set<string>();
    for (const r of tables.table('Levels')) {
      const id = Number(r.Id);
      if (id < 109 || id > 132) continue;
      for (const c of ['mon', 'nmon', 'umon']) for (let i = 1; i <= 10; i++) if (r[`${c}${i}`]) ids.add(r[`${c}${i}`] as string);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...ids]) {
        const r = ms.get(id);
        for (const k of [r?.spawn, r?.minion1, r?.minion2]) if (k && ms.has(k) && !ids.has(k)) {
          ids.add(k);
          changed = true;
        }
      }
    }
    return ids;
  };

  describe('공성', () => {
    it('Overseer 채찍: minion 을 Suicide Minion 으로 바꾸거나 Bloodlust 를 건다', () => {
      const game = newGame();
      const ov = game.spawnMonster('overseer1', 30.5, 20.5);
      const minions = Array.from({ length: 8 }, (_, i) => game.spawnMonster('minion1', 32.5 + (i % 4), 22.5 + Math.floor(i / 4)));
      const whipSlot = ov.type.skills.findIndex((s) => s?.name === 'Overseer Whip');
      expect(whipSlot).toBeGreaterThanOrEqual(0);
      for (const mn of minions) {
        inner(game).monsterUseSkill(ov, whipSlot, { unitId: mn.id, x: mn.x, y: mn.y });
        run(game, 60, () => ov.mode === 'NU' && !ov.cast);
      }
      const changed = minions.filter((x) => x.type.baseId === 'suicideminion1' || x.type.id.startsWith('suicideminion'));
      const lusted = minions.filter((x) => x.states.has('bloodlust'));
      expect(changed.length + lusted.length).toBeGreaterThan(0);
      expect(changed.every((x) => x.aiOverride === 'Whipped')).toBe(true);
    });

    it('Catapult Spotter: 대상 주변 자유 좌표로 투석기 스킬 (미사일이 떨어진다)', () => {
      const game = newGame(3);
      game.spawnMonster('catapult1', 45.5, 20.5);
      const sp = game.spawnMonster('catapultspotter1', 40.5, 20.5);
      const ev = run(game, 1500, (e) => e.some((x) => x.type === 'monsterSkill' && x.monsterId === sp.id));
      const used = ev.find((x) => x.type === 'monsterSkill' && x.monsterId === sp.id);
      expect(used, 'spotter skill').toBeTruthy();
      expect(['Catapult Charged Ball', 'Catapult Spike Ball', 'CatapultBlizzard', 'CatapultPlague', 'CatapultMeteor']).toContain(String(used!.skill));
      const shot = run(game, 120, (e) => e.some((x) => x.type === 'monsterMissile'));
      expect(shot.some((x) => x.type === 'monsterMissile')).toBe(true);
    });

    it('Imp 이 Siege Beast 를 불러 올라탄다 (attached), 탈 것이 죽으면 내린다', () => {
      const game = newGame(5);
      // 원작: AI 는 대상이 aidist 안에 있을 때만 돈다 — 플레이어 가까이
      const beast = game.spawnMonster('siegebeast1', 34.5, 20.5);
      const imp = game.spawnMonster('imp1', 37.5, 21.5);
      run(game, 1500, () => imp.states.has('attached'));
      expect(imp.states.has('attached')).toBe(true);
      expect(imp.leaderId).toBe(beast.id);
      expect(imp.hidden).toBe(true);
      inner(game).killMonster(beast, 'player');
      run(game, 2);
      expect(imp.states.has('attached')).toBe(false);
      expect(imp.hidden).toBe(false);
    });

    it('Minion: 대상이 없으면 제자리에서 기다린다 (예외 없음)', () => {
      const game = newGame(7);
      game.character!.life = 0;
      const mn = game.spawnMonster('minion1', 70.5, 70.5);
      const x0 = mn.x;
      expect(() => run(game, 200)).not.toThrow();
      expect(Math.abs(mn.x - x0)).toBeLessThan(10);
    });

    it('Act 5 AI 이름: 원작 monstats AI 컬럼, NpcBarb 대상 방식 2', () => {
      expect(data.monsters.get('overseer1').ai).toBe('Overseer');
      expect(data.monsters.get('catapultspotter1').ai).toBe('CatapultSpotter');
      expect(data.monsters.get('imp1').ai).toBe('Imp');
      expect(AI_TARGET_MODE.NpcBarb).toBe(2);
      for (const ai of ['SiegeTower', 'SiegeBeast', 'Imp', 'Catapult', 'CatapultSpotter', 'Minion', 'SuicideMinion', 'Overseer', 'MinionSpawner', 'NpcBarb']) expect(hasAi(ai), ai).toBe(true);
    });
  });

  describe('나머지', () => {
    it('Frozen Horror: 가까우면 Horror Arctic Blast (냉기 숨결 미사일)', () => {
      const game = newGame(11);
      const fh = game.spawnMonster('frozenhorror1', 22.5, 20.5);
      const ev = run(game, 1500, (e) => e.some((x) => x.type === 'monsterSkill' && x.monsterId === fh.id && x.skill === 'Horror Arctic Blast'));
      expect(ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Horror Arctic Blast')).toBe(true);
      const after = run(game, 80, (e) => e.some((x) => x.type === 'monsterMissile' && String(x.name).startsWith('frozenhorror')));
      expect(after.some((x) => x.type === 'monsterMissile' && String(x.name).startsWith('frozenhorror'))).toBe(true);
    });

    it('Death Mauler: DeathMaul 은 땅속으로 대상까지 가는 미사일 (death mauler)', () => {
      const game = newGame(13);
      const dm = game.spawnMonster('deathmauler1', 30.5, 20.5);
      expect(inner(game).monsterUseSkill(dm, 0, { x: 20.5, y: 20.5 })).toBe(true);
      const ev = run(game, 120, (e) => e.some((x) => x.type === 'monsterMissile' && x.monsterId === dm.id));
      expect(ev.some((x) => x.type === 'monsterMissile' && x.name === 'death mauler')).toBe(true);
    });

    it('Putrid Defiler: 같은 편에 알을 낳고 (pregnant), 그 몬스터가 죽으면 Pain Worm 이 나온다', () => {
      const game = newGame(17);
      const pd = game.spawnMonster('putriddefiler1', 34.5, 20.5);
      const host = game.spawnMonster('minion1', 36.5, 20.5);
      run(game, 2000, () => host.states.has('pregnant'));
      expect(host.states.has('pregnant')).toBe(true);
      void pd;
      inner(game).killMonster(host, 'player');
      expect(game.monsters.some((x) => x.type.baseId === 'painworm1' || x.type.id.startsWith('painworm'))).toBe(true);
    });

    it('Succubus Witch: Amplify Damage (Skill1) 로 플레이어에게 저주', () => {
      const game = newGame(19);
      const sw = game.spawnMonster('succubuswitch1', 24.5, 20.5);
      expect(inner(game).monsterUseSkill(sw, 0, { x: 20.5, y: 20.5 })).toBe(true);
      const ev = run(game, 120, (e) => e.some((x) => x.type === 'playerCursed' && x.by === sw.id));
      expect(ev.find((x) => x.type === 'playerCursed')?.curse).toBe('amplifydamage');
    });
  });

  it('Act 5 레벨 몬스터 풀·스폰·미니언 전부 AI 가 있다 (NPC·퀘스트 단계 AI 제외)', () => {
    const missing = [...act5Monsters()].filter((id) => {
      const ai = data.monsters.get(id).ai;
      return !NPC_AI.has(ai) && !QUEST_AI.has(ai) && !hasAi(ai);
    });
    expect(missing).toEqual([]);
  });
});
