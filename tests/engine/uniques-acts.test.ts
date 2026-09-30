// Act 2~4 슈퍼유니크·보스 배치·TC·카오스 생추어리 봉인 → 봉인 보스 → 디아블로, Duriel·Mephisto·Diablo 처치 → 드롭
// 기대값 출처: SuperUniques.txt (행 10~41, Class, Mod1~3, MinGrp/MaxGrp, TC), MonPreset.txt (Act 2~4 Place), monstats.txt (duriel·mephisto·diablo
//             TreasureClass1/4, TCQuestId/TCQuestCP), objects.txt (392~396 OperateFn 54/52/55/52/56, 255 InitFn 55),
//             D2MOO MonsterUnique.cpp D2GAME_SpawnSuperUnique_6FC6F690 (Radament 스켈레톤), A4Q2.cpp (봉인·보스·디아블로), MonsterMode.cpp sub_6FC631B0 (TC)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildActWorld, type ActWorld } from '../../src/data/world';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { ChaosState, SEAL_BOSSES, SEAL_IDS } from '../../src/engine/chaos';
import { MONFLAG } from '../../src/engine/uniques';
import { nearestWalkable } from '../../src/engine/path';
import { QFLAG } from '../../src/engine/quests/record';
import type { MonsterUnit } from '../../src/engine/ai';

describe.skipIf(!hasGameData)('Act 2~4 슈퍼유니크·보스 (원작 데이터)', () => {
  let data: GameData;
  let tables: GameTables;
  const worlds = new Map<number, ActWorld>();
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });
  const world = (act: number): ActWorld => {
    let w = worlds.get(act);
    if (!w) {
      w = buildActWorld(gameChain(), tables, data, 12345, act);
      worlds.set(act, w);
    }
    return w;
  };
  const actGame = (act: number, seed = 9): Game => {
    const w = world(act);
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    return new Game({
      map: w.byKey.get(w.townId)!.def.map, levels: w.levels.map((l) => l.def), act, player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
      seed, data, character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
    });
  };
  const flatGame = (seed = 5): Game => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    return new Game({
      map: new CollisionMap(120, 120), player: { x: 10.5, y: 10.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity }, seed, data,
      character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
    });
  };
  const kill = (game: Game, m: MonsterUnit): GameEvent[] => {
    const g = game as unknown as { killMonster: (m: MonsterUnit, s: string) => void; events: GameEvent[] };
    g.events = [];
    g.killMonster(m, 'player');
    return g.events;
  };
  /** 레벨에 들어간다 (몬스터 배치). 출구 위에 서서 다른 레벨로 넘어가지 않게 틱은 돌리지 않는다 */
  const enter = (game: Game, key: string): void => {
    const def = game.levelDef(key)!;
    const p = nearestWalkable(def.map, { x: Math.trunc(def.map.width / 2), y: Math.trunc(def.map.height / 2) }, 200)!;
    game.changeLevel(key, p.x + 0.5, p.y + 0.5);
    expect(game.levelId).toBe(key);
  };

  // 출처: MonPreset.txt Act 2~4 + DS1 프리셋 유닛 (DRLGPRESET_ParseDS1File) — 원작 자리 (레벨)
  const SU_LEVEL: [number, string, string][] = [
    [10, 'sewers3', 'Radament'], [11, 'hallsofdead3', 'Bloodwitch the Wild'], [12, 'clawviper2', 'Fangskin'], [13, 'faroasis', 'Beetleburst'],
    [14, 'stonytomb2', 'Leatherarm'], [15, 'maggotlair3', 'Coldworm the Burrower'], [16, 'palacecellar3', 'Fire Eye'], [17, 'lostcity', 'Dark Elder'],
    [21, 'spidercavern', 'Web Mage the Burning'], [22, 'flayerdungeon3', 'Witch Doctor Endugu'], [23, 'flayerjungle', 'Stormtree'],
    [24, 'ruinedtemple', 'Sarina the Battlemaid'], [25, 'kurastsewers1', 'Icehawk Riftwing'], [26, 'travincal', 'Ismail Vilehand'],
    [27, 'travincal', 'Geleb Flamefinger'], [29, 'travincal', 'Toorc Icefist'], [28, 'durance3', 'Bremm Sparkfist'], [30, 'durance3', 'Wyand Voidfinger'],
    [31, 'durance3', 'Maffer Dragonhand'], [41, 'riverofflame', 'The Feature Creep'],
  ];

  it('슈퍼유니크가 원작 DS1 프리셋 자리에 나온다 (슈퍼유니크 플래그·TC·미니언 수)', () => {
    const byAct = new Map<number, [number, string, string][]>();
    for (const row of SU_LEVEL) {
      const act = world(1).byKey.has(row[1]) ? 1 : world(2).byKey.has(row[1]) ? 2 : 3;
      byAct.set(act, [...(byAct.get(act) ?? []), row]);
    }
    for (const [act, rows] of byAct) {
      const game = actGame(act);
      for (const [idx, key, name] of rows) {
        enter(game, key);
        const su = data.uniques!.superUnique(idx)!;
        expect(su.key).toBe(name);
        const m = game.monsters.find((x) => x.superUnique === idx);
        expect(m, `${name} in ${key}`).toBeDefined();
        expect(m!.type.id).toBe(su.cls);
        expect(m!.flags & (MONFLAG.SUPERUNIQUE | MONFLAG.UNIQUE)).toBe(MONFLAG.SUPERUNIQUE | MONFLAG.UNIQUE);
        // 출처: sub_6FC631B0 — 슈퍼유니크는 SuperUniques.txt TC
        expect(game.monsterTc(m!)).toBe(su.tc);
        // 출처: D2GAME_SpawnSuperUnique — Mod1~3 (Thief 제외) + 퀘스트 수식어 22
        for (const u of su.mods.filter((x) => x && x !== 24)) expect(m!.umods).toContain(u);
        if (idx !== 10 && su.minGrp) {
          const mins = game.minionsOf(m!).length;
          expect(mins, `${name} minions`).toBeGreaterThanOrEqual(1);
          expect(mins).toBeLessThanOrEqual(su.maxGrp);
        }
      }
    }
  });

  // 출처: D2GAME_SpawnSuperUnique_6FC6F690 (SUPERUNIQUE_RADAMENT) — skeleton5 × (rand % 5 + 2) + 원소 스켈레톤 메이지 4
  it('Radament: 하수도 3 에 스켈레톤 2~6 + 원소 스켈레톤 메이지 4 와 함께, TC Radament', () => {
    const game = actGame(1);
    enter(game, 'sewers3');
    const r = game.monsters.find((m) => m.type.id === 'radament')!;
    expect(r.superUnique).toBe(10);
    expect(game.monsterTc(r)).toBe('Radament');
    const own = game.monsters.filter((m) => m.leaderId === r.id && m !== r);
    const mages = own.filter((m) => m.type.baseId.startsWith('skmage'));
    expect(mages.map((m) => m.type.id).sort()).toEqual(['skmage_cold4', 'skmage_fire3', 'skmage_ltng3', 'skmage_pois3']);
    const skel = own.filter((m) => m.type.id === 'skeleton5').length;
    expect(skel).toBeGreaterThanOrEqual(2);
    expect(skel).toBeLessThanOrEqual(6);
  });

  it('보스 자리: Summoner (비전의 성역), Duriel (두리엘의 굴), Mephisto (증오의 억류지 3), Izual (절망의 평원)', () => {
    for (const [act, key, id] of [[1, 'arcane', 'summoner'], [1, 'durielslair', 'duriel'], [2, 'durance3', 'mephisto'], [3, 'plainsofdespair', 'izual']] as const) {
      const game = actGame(act);
      enter(game, key);
      const b = game.monsters.filter((m) => m.type.id === id);
      expect(b.length, `${id} in ${key}`).toBe(1);
      if (id !== 'summoner') expect(b[0]!.type.boss).toBe(true);
    }
  });

  it('Council: Travincal 의 의원 셋 (슈퍼유니크 26·27·29, TC Council)', () => {
    const game = actGame(2);
    enter(game, 'travincal');
    const council = game.monsters.filter((m) => m.type.baseId === 'councilmember1' && m.superUnique !== undefined);
    expect(council.length).toBe(3);
    for (const c of council) expect(game.monsterTc(c)).toBe('Council');
  });

  // 출처: A4Q2.cpp — 봉인 392/394/396 이 보스 36/37/38 을 부르고, 봉인 5 개 + 보스 3 처치 → 생추어리 정리 + 디아블로 (타이머 10)
  describe('카오스 생추어리 봉인', () => {
    it('ChaosState: 봉인 순서·보스 수와 무관하게 5 + 3 이 모이면 한 번 정리하고 디아블로 타이머', () => {
      const c = new ChaosState();
      expect(c.operateSeal(393)).toEqual([]);
      expect(c.operateSeal(392)).toEqual([{ kind: 'spawnBoss', ...SEAL_BOSSES[392] }]);
      expect(c.operateSeal(392)).toEqual([]);
      expect(c.bossKilled()).toEqual([]);
      expect(c.bossKilled()).toEqual([]);
      expect(c.bossKilled()).toEqual([]);
      c.operateSeal(394);
      c.operateSeal(395);
      expect(c.operateSeal(396).map((a) => a.kind)).toEqual(['spawnBoss', 'clear', 'startDiabloTimer']);
      for (let i = 0; i < 9; i++) expect(c.tick()).toBe(false);
      expect(c.tick()).toBe(true);
    });

    it('봉인을 열면 보스가 나오고, 셋 다 죽이면 생추어리가 정리되고 디아블로가 시작 자리에 나온다', () => {
      const game = actGame(3, 21);
      enter(game, 'chaossanctuary');
      const seals = game.objects.filter((o) => SEAL_IDS.includes(o.type.id));
      expect(seals.map((o) => o.type.id).sort()).toEqual([392, 393, 394, 395, 396]);
      expect(seals.map((o) => o.type.operateFn).sort()).toEqual([52, 52, 54, 55, 56]);
      const start = game.objects.find((o) => o.type.id === 255)!;
      expect(start).toBeDefined();
      const bosses: MonsterUnit[] = [];
      for (const o of seals) {
        const g = game as unknown as { events: GameEvent[] };
        g.events = [];
        game.operateObject(o);
        const ev = g.events;
        expect(ev.some((e) => e.type === 'sealOperated' && e.classId === o.type.id)).toBe(true);
        const b = SEAL_BOSSES[o.type.id];
        if (b) {
          const sp = ev.find((e) => e.type === 'sealBossSpawned');
          expect(sp, `seal ${o.type.id}`).toBeDefined();
          expect(sp!.superUnique).toBe(b.superUnique);
          const m = game.monsters.find((x) => x.id === sp!.monsterId)!;
          expect(m.superUnique).toBe(b.superUnique);
          // 원작 자리 = 봉인 + 오프셋 이 있는 방 (QUESTS_SpawnMonster → SpawnSuperUnique: AutoPos 1 이면 그 방 안 무작위 자리)
          expect(Math.hypot(m.x - (Math.floor(o.x) + b.dx), m.y - (Math.floor(o.y) + b.dy))).toBeLessThan(45);
          bosses.push(m);
        } else expect(ev.some((e) => e.type === 'sealBossSpawned')).toBe(false);
      }
      expect(bosses.map((b) => b.superUnique).sort()).toEqual([36, 37, 38]);
      expect(game.chaosState.allSeals).toBe(true);
      expect(game.monsters.some((m) => m.type.id === 'diablo')).toBe(false);
      const evs: GameEvent[] = [];
      for (const b of bosses) evs.push(...kill(game, b));
      expect(evs.filter((e) => e.type === 'sealBossKilled').length).toBe(3);
      expect(evs.some((e) => e.type === 'chaosCleared')).toBe(true);
      // 생추어리의 다른 악 몬스터는 모두 죽음 모드
      expect(game.monsters.filter((m) => !m.pet && !m.npc && m.mode !== 'DT' && m.mode !== 'DD').length).toBe(0);
      const more: GameEvent[] = [];
      for (let i = 0; i < 12; i++) more.push(...game.tick());
      const ds = more.find((e) => e.type === 'diabloSpawned');
      expect(ds).toBeDefined();
      const d = game.monsters.find((m) => m.type.id === 'diablo')!;
      expect(Math.hypot(d.x - start.x, d.y - start.y)).toBeLessThan(12);
    });
  });

  // 출처: monstats duriel/mephisto/diablo TreasureClass1·4 + TCQuestId (14/22/26) · TCQuestCP (5/0/0), MonsterMode.cpp sub_6FC631B0
  describe('Duriel·Mephisto·Diablo 처치 → 드롭', () => {
    for (const [id, tcq, tc, quest, cp] of [['duriel', 'Durielq', 'Duriel', 14, 5], ['mephisto', 'Mephistoq', 'Mephisto', 22, 0], ['diablo', 'Diabloq', 'Diablo', 26, 0]] as const) {
      it(`${id}: 퀘스트 전 첫 처치는 ${tcq}, 퀘스트를 끝냈으면 ${tc}`, () => {
        const t = data.monsters.get(id);
        expect(t.boss).toBe(true);
        expect([t.treasure[0], t.treasure[3], t.tcQuestId, t.tcQuestCP]).toEqual([tc, tcq, quest, cp]);
        const game = flatGame(31);
        const b = game.spawnMonster(id, 60.5, 60.5);
        expect(game.monsterTc(b)).toBe(tcq);
        const ev = kill(game, b);
        expect(ev.some((e) => e.type === 'monsterKilled' && e.typeId === id)).toBe(true);
        const drops = ev.filter((e) => e.type === 'itemDropped' && e.source !== 'quest');
        expect(drops.length).toBeGreaterThan(0);
        for (const d of drops) expect(d.tc).toBe(tcq);
        if (id === 'diablo') expect(ev.some((e) => e.type === 'diabloKilled')).toBe(true);
        // 퀘스트 기록 (Phase 7 이 켠다) — COMPLETEDBEFORE 면 일반 TC
        game.questRecord.set(quest, QFLAG.COMPLETEDBEFORE);
        const b2 = game.spawnMonster(id, 80.5, 80.5);
        expect(game.monsterTc(b2)).toBe(tc);
        const d2 = kill(game, b2).filter((e) => e.type === 'itemDropped' && e.source !== 'quest');
        for (const d of d2) expect(d.tc).toBe(tc);
      });
    }

    // 출처: AITHINK_Fn044_Duriel (aip1 = Holy Freeze 레벨) + SrvDo081 Holy Freeze (범위 ln12 안 holywindcold: 속도 −dm34, 냉기 피해)
    it('Duriel: Holy Freeze 오라가 곁의 플레이어를 느리게 하고 냉기 피해, Charge 로 돌진', () => {
      const game = flatGame(2);
      const d = game.spawnMonster('duriel', 16.5, 10.5);
      const seen = new Set<string>();
      let slowed = false, hitCold = false;
      for (let i = 0; i < 1500; i++) {
        game.character!.life = game.maxLife();
        const ev = game.tick();
        const st = game.playerState('holywindcold');
        if (st && (st.stats.velocitypercent ?? 0) < 0) slowed = true;
        for (const e of ev) {
          if (e.type === 'monsterSkill' && e.monsterId === d.id) seen.add(e.skill as string);
          if (e.type === 'playerHit' && ((e.elemental as number) ?? 0) > 0) hitCold = true;
        }
      }
      expect(slowed).toBe(true);
      expect(hitCold).toBe(true);
      expect(d.states.has('holywind')).toBe(true);
      expect([...seen].some((s) => ['Charge', 'Jab', 'Smite'].includes(s))).toBe(true);
    });
  });
});
