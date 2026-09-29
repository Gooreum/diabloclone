// 챔피언·유니크·슈퍼유니크·Andariel (원작 MonUMod.txt / SuperUniques.txt / MonPreset.txt + D2MOO MonsterUnique.cpp 규칙)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { buildAct1World, type Act1GameWorld } from '../../src/data/act1-world';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { rollMonsterStats, type MonsterStats } from '../../src/engine/monster';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { Rng } from '../../src/engine/rng';
import { applyUModInit, calcPercentage, MONFLAG, UMOD, uniqueNameKeys, type UModTarget } from '../../src/engine/uniques';
import type { MonsterUnit } from '../../src/engine/ai';

describe.skipIf(!hasGameData)('챔피언·유니크·슈퍼유니크 (원작 데이터)', () => {
  let data: GameData;
  let tables: GameTables;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });

  const newGame = (seed = 3, size = 90) => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    return new Game({
      map: new CollisionMap(size, size), player: { x: 10.5, y: 10.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity }, seed, data,
      character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
    });
  };
  /** 다음 spawnMonster 가 굴릴 기본 능력치 (Game.spawnMonster: 유닛 시드 = 게임 난수 한 번, 그 시드로 rollMonsterStats) */
  const nextBase = (game: Game, id: string): MonsterStats => {
    const r = new Rng(game.rng.low, game.rng.high);
    return rollMonsterStats(data.monsters, data.monsters.get(id), new Rng(Number(r.next() & 0xffffffffn) || 1));
  };
  /** 몬스터를 죽이고 그때 생긴 이벤트 (드롭 TC 포함) */
  const kill = (game: Game, m: MonsterUnit, source: 'player' | 'other' = 'player'): GameEvent[] => {
    const g = game as unknown as { killMonster: (m: MonsterUnit, s: string) => void; events: GameEvent[] };
    g.events = [];
    g.killMonster(m, source);
    return g.events;
  };

  // 출처: MonUMod.txt constants 컬럼 (행 0 champion chance 20, 1 minion +hp% 100, 4 champion +hp% 200, 7 unique +hp% 300,
  //       10 champion +tohit% 75, 11 champion +dmg% 100, 13 unique +tohit% 100, 15 unique +dmg% (strong) 150)
  it('MonUMod 상수: 챔피언 확률 20, 생명 +100/+200/+300%, 챔피언 피해 100%·명중 75%', () => {
    const u = data.uniques!;
    expect([0, 1, 4, 7, 10, 11, 13, 15].map((i) => u.constant(i))).toEqual([20, 100, 200, 300, 75, 100, 100, 150]);
    // 클래식에서 뽑을 수 있는 챔피언 수식어 = 16 champion 하나 (cpick 1, version 0), 확장 수식어(36~39)는 version 100 이라 제외
    expect(u.umods.filter((m) => m.cpick > 0 && m.champion && m.version < 100).map((m) => m.id)).toEqual([16]);
  });

  // 출처: MONSTERUNIQUE_UMod2_HealthBonus (+300%), UMod4_LevelBonus (레벨 +3, 경험치 ×5), D2GAME_SpawnMinions (Normal 3~6 미니언)
  it('유니크: 생명 ×4, 레벨 +3, 경험치 ×5, 미니언 3~6 (monstats minion1 = Fallen), HP 재생 없음', () => {
    const game = newGame(11);
    const base = nextBase(game, 'fallenshaman1');
    const b = game.spawnBoss('fallenshaman1', 40.5, 40.5, false)!;
    expect(b.flags & (MONFLAG.UNIQUE | MONFLAG.CHAMPION)).toBe(MONFLAG.UNIQUE);
    expect(b.stats.maxHp).toBe(base.maxHp * 4);
    expect(b.hp).toBe(b.stats.maxHp);
    expect(b.stats.level).toBe(base.level + 3);
    expect(b.stats.exp).toBe(base.exp * 5);
    expect(b.hpRegen).toBe(false);
    // Normal 유니크 수식어 = 1 개 (난이도 0 + rand(1) + 1) — 1~4 는 공통으로 적용하고 목록에는 굴린 것만
    expect(b.umods.length).toBe(1);
    const minions = game.minionsOf(b);
    expect(minions.length).toBeGreaterThanOrEqual(3);
    expect(minions.length).toBeLessThanOrEqual(6);
    for (const mn of minions) {
      expect(mn.type.id).toBe('fallen1');
      expect(mn.flags & MONFLAG.MINION).toBe(MONFLAG.MINION);
      expect(mn.leaderId).toBe(b.id);
      expect(mn.stats.level).toBe(data.monsters.get('fallen1').level + 3);
    }
  });

  it('유니크 수식어는 xfer 1 이면 미니언에게도 붙고 미니언 수치로 적용 (Fire Enchanted: 미니언 = MonLvl DM × constants[16]/[19])', () => {
    // 여러 시드로 불 인챈트 유니크를 찾는다
    for (let seed = 1; seed < 400; seed++) {
      const game = newGame(seed);
      const b = game.spawnBoss('corruptrogue2', 40.5, 40.5, false)!;
      if (!b.umods.includes(UMOD.FIRE)) continue;
      const u = data.uniques!;
      // 출처: MONSTERUNIQUE_UMod9_FireEnchanted — 유니크 = DM × constants[28]/[31] (66/100), 화염 저항 +75
      const dm = data.monsters.levelBase(b.stats.level, 'DM');
      expect([b.bonus.firemindam, b.bonus.firemaxdam]).toEqual([Math.trunc((dm * u.constant(28)) / 100), Math.trunc((dm * u.constant(31)) / 100)]);
      expect(b.resist.fi).toBe(data.monsters.get('corruptrogue2').resist.fi + 75);
      for (const mn of game.minionsOf(b)) {
        expect(mn.umods).toContain(UMOD.FIRE);
        const mdm = data.monsters.levelBase(mn.stats.level, 'DM');
        expect(mn.bonus.firemaxdam).toBe(Math.trunc((mdm * u.constant(19)) / 100));
        // 미니언은 저항 수식어가 적용되지 않는다 (UMod8_Resistant: bUnique 만)
        expect(mn.resist.fi).toBe(data.monsters.get('corruptrogue2').resist.fi);
      }
      return;
    }
    throw new Error('fire enchanted unique not rolled');
  });

  // 출처: MONSTERUNIQUE_UMod16_Champion (레벨 −1, 경험치 −2/5, 피해 constants[11] × ChampionDamageBonus(90)/100, 명중 [10] × 90/100, 속도 +20%)
  it('챔피언: 생명 ×3, 레벨 +2, 경험치 ×3, 피해 +90%, 명중 +67%, 속도 +20%, 무리 2~4 마리', () => {
    const game = newGame(21);
    const base = nextBase(game, 'corruptrogue2');
    const pack = game.spawnChampionPack('corruptrogue2', 40.5, 40.5);
    const c = pack[0]!;
    expect(c.flags & MONFLAG.CHAMPION).toBe(MONFLAG.CHAMPION);
    expect(c.umods).toEqual([UMOD.CHAMPION]);
    expect(c.stats.maxHp).toBe(base.maxHp * 3);
    expect(c.stats.level).toBe(base.level + 2);
    expect(c.stats.exp).toBe(base.exp * 5 - Math.trunc((2 * base.exp * 5) / 5));
    expect(c.bonus.damagepercent).toBe(90);
    expect(c.bonus.item_tohit_percent).toBe(67);
    expect(c.bonus.velocitypercent).toBe(20);
    expect(pack.length).toBeGreaterThanOrEqual(2);
    expect(pack.length).toBeLessThanOrEqual(4);
    for (const m of pack) expect(m.flags & MONFLAG.CHAMPION).toBe(MONFLAG.CHAMPION);
    // 챔피언은 미니언이 없다 (D2GAME_SpawnMinions: nTypeFlag & 4)
    expect(game.minionsOf(c).length).toBe(0);
  });

  it('챔피언 확률: 보스 굴림 중 약 20% 가 챔피언 (MonUMod constants[0])', () => {
    let champ = 0;
    const N = 600;
    const game = newGame(5, 200);
    for (let i = 0; i < N; i++) {
      const r = data.uniques!.rollBossMods(data.monsters.get('fallen1'), new Rng(1000 + i * 7919), true);
      if (r.champion) champ++;
    }
    expect(champ / N).toBeGreaterThan(0.15);
    expect(champ / N).toBeLessThan(0.25);
    void game;
  });

  it('수식어 규칙 (순수 함수): 미니언 생명 ×2, Magic Resistant 는 면역 2개 미만일 때 냉기·화염·번개 +40', () => {
    const t = data.monsters.get('skeleton1');
    const target = (): UModTarget => ({
      type: t, stats: { level: 5, maxHp: 50, exp: 100, defense: 30 }, hp: 50, rng: new Rng(1), flags: MONFLAG.UNIQUE, nameSeed: 0, bonus: {},
      resist: { ...t.resist }, hpRegen: true, skillsAdded: [],
    });
    const ctx = { db: data.uniques!, monsters: data.monsters, difficulty: 0, championDmgBonus: 90 };
    const mn = target();
    applyUModInit(ctx, mn, UMOD.HPMULTIPLY, false);
    expect(mn.stats.maxHp).toBe(100);
    const mr = target();
    applyUModInit(ctx, mr, UMOD.RESIST, true);
    expect([mr.resist.co, mr.resist.fi, mr.resist.li]).toEqual([t.resist.co + 40, t.resist.fi + 40, t.resist.li + 40]);
    expect(calcPercentage(37, 300, 100)).toBe(111);
  });

  it('유니크 이름: 이름 시드로 UniquePrefix / UniqueSuffix / UniqueAppellation 문자열', () => {
    const keys = uniqueNameKeys(data.uniques!, 12345, (s) => new Rng(s));
    expect(data.uniques!.prefixes).toContain(keys[0]);
    expect(data.uniques!.suffixes).toContain(keys[1]);
    expect(data.uniques!.appellations).toContain(keys[2]);
    expect(tables.string(keys[2])).toMatch(/^the /);
  });

  // 출처: MonsterMode.cpp sub_6FC631B0 — 유니크 = TreasureClass3, 챔피언 = TreasureClass2; TreasureClassEx group/level 업그레이드
  it('드롭 TC: 유니크 Fallen Shaman(레벨 5) 은 "Act 1 Unique A" → 레벨 업그레이드로 "Act 1 Unique B", 챔피언은 TreasureClass2', () => {
    const game = newGame(31);
    const u = game.spawnBoss('fallenshaman1', 40.5, 40.5, false)!;
    expect(game.monsterTc(u)).toBe('Act 1 Unique A');
    expect(data.treasure.resolve('Act 1 Unique A', u.stats.level)?.name).toBe('Act 1 Unique B');
    const c = game.spawnChampionPack('corruptrogue2', 60.5, 60.5)[0]!;
    expect(game.monsterTc(c)).toBe('Act 1 Champ B');
    const n = game.spawnMonster('corruptrogue2', 70.5, 70.5);
    expect(game.monsterTc(n)).toBe('Act 1 H2H B');
    // 드롭 이벤트는 고른 TC 를 알린다
    for (const e of kill(game, u).filter((x) => x.type === 'itemDropped')) expect(e.tc).toBe('Act 1 Unique A');
  });

  describe('슈퍼유니크 (DS1 프리셋 → MonPreset → SuperUniques)', () => {
    const worlds: Act1GameWorld[] = [];
    beforeAll(() => {
      for (const seed of [101, 20202]) worlds.push(buildAct1World(gameChain(), tables, data, seed));
    });
    // 출처: SuperUniques.txt (Class, Mod1~3, MinGrp, TC) · 원작 배치 레벨
    const EXPECT: [string, number, string, string, number[], string][] = [
      ['coldplains', 0, 'Bishibosh', 'fallenshaman1', [8, 9], 'Act 1 Super A'],
      ['crypt', 1, 'Bonebreak', 'skeleton1', [5, 8], 'Act 1 Super A'],
      ['cave1', 2, 'Coldcrow', 'cr_archer1', [18], 'Act 1 Super A'],
      ['stonyfield', 3, 'Rakanishu', 'fallen2', [17, 6], 'Act 1 Super B'],
      ['darkwood', 4, 'Treehead WoodFist', 'brute2', [5, 6], 'Act 1 Super B'],
      ['tristram', 5, 'Griswold', 'griswold', [7], 'Griswold'],
      ['towercellar5', 6, 'The Countess', 'corruptrogue3', [9], 'Countess'],
      ['jail2', 7, 'Pitspawn Fouldog', 'bighead2', [7, 18], 'Act 1 Super B'],
      ['cathedral', 9, 'Boneash', 'skmage_pois3', [8, 5, 18], 'Act 1 Super C'],
      ['barracks', 20, 'The Smith', 'smith', [5], 'Smith'],
      ['denofevil', 40, 'Corpsefire', 'zombie1', [27], 'Act 1 Super A'],
    ];
    it('각 슈퍼유니크가 원래 레벨에 한 번, 원작 몬스터·수식어·TC 로 나온다', () => {
      for (const w of worlds) {
        const cs = classStats(tables.table('charstats'), 'Barbarian');
        const game = new Game({
          map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
          seed: 9, data, character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
        });
        for (const [lvl, idx, key, cls, mods, tc] of EXPECT) {
          game.changeLevel(lvl, 5.5, 5.5);
          game.tick();
          const list = game.monsters.filter((m) => m.superUnique === idx);
          expect(list.length, `${key} in ${lvl}`).toBe(1);
          const m = list[0]!;
          expect(m.type.id).toBe(cls);
          expect(m.flags & (MONFLAG.SUPERUNIQUE | MONFLAG.UNIQUE)).toBe(MONFLAG.SUPERUNIQUE | MONFLAG.UNIQUE);
          expect(m.umods.slice(0, mods.length)).toEqual(mods);
          expect(game.monsterTc(m)).toBe(tc);
          // 미니언: SuperUniques MinGrp (Griswold/Boneash/Smith 0)
          const su = data.uniques!.superUnique(idx)!;
          if (su.minGrp) expect(game.minionsOf(m).length).toBe(su.minGrp);
          // 프리셋 자리 방 안에 있다 (AutoPos 면 방 안 무작위, 아니면 프리셋 좌표)
          const pre = game.levelDef(lvl)!.presetMonsters!.find((p) => data.uniques!.preset(1, p.id).kind === 'super' && (data.uniques!.preset(1, p.id) as { idx: number }).idx === idx)!;
          expect(Math.hypot(m.x - pre.x, m.y - pre.y)).toBeLessThan(60);
        }
        // Blood Raven (monplace place_bloodraven): Burial Grounds, TC "Blood Raven", 좀비 파티
        game.changeLevel('burialgrounds', 5.5, 5.5);
        game.tick();
        const br = game.monsters.find((m) => m.type.id === 'bloodraven')!;
        expect(br).toBeTruthy();
        expect(game.monsterTc(br)).toBe('Blood Raven');
      }
    });

    it('Countess 는 특수 AI (AISPECIALSTATE_COUNTESS), Rakanishu 는 프리셋 좌표 그대로 (AutoPos 0)', () => {
      const w = worlds[0]!;
      const cs = classStats(tables.table('charstats'), 'Barbarian');
      const game = new Game({
        map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
        seed: 9, data, character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
      });
      game.changeLevel('towercellar5', 5.5, 5.5);
      game.tick();
      expect(game.monsters.find((m) => m.superUnique === 6)?.aiOverride).toBe('Countess');
      game.changeLevel('stonyfield', 5.5, 5.5);
      game.tick();
      const r = game.monsters.find((m) => m.superUnique === 3)!;
      const pre = game.levelDef('stonyfield')!.presetMonsters!.find((p) => p.id === 37)!;
      expect([Math.floor(r.x), Math.floor(r.y)]).toEqual([pre.x, pre.y]);
    });
  });

  // 출처: D2GAME_AI_SpecialState13_6FCE5080 + sub_6FCE5520 — DS1 경로 지점마다 CountessFirewall (A1)
  it('The Countess: DS1 경로 지점에 CountessFirewall 로 지면 불을 깐다', () => {
    const game = newGame(13, 120);
    const path = [{ x: 16, y: 24 }, { x: 20, y: 26 }];
    const c = game.spawnSuperUnique(6, 22, 20, path)!;
    expect(c.aiOverride).toBe('Countess');
    expect(c.mapPath?.length).toBe(2);
    let fire = false;
    for (let i = 0; i < 800 && !fire; i++) {
      game.character!.life = game.maxLife();
      game.tick();
      fire = game.snapshot().missiles.some((m) => m.name === 'countessfirewall');
    }
    expect(fire).toBe(true);
  });

  describe('Andariel', () => {
    it('Catacombs 4 프리셋 (MonPreset "andariel") 에 한 마리, 보스 (monstats boss 1)', () => {
      const w = buildAct1World(gameChain(), tables, data, 555);
      const cs = classStats(tables.table('charstats'), 'Barbarian');
      const game = new Game({
        map: w.byKey.get('town')!.def.map, levels: w.levels.map((l) => l.def), player: { x: w.start.x, y: w.start.y, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
        seed: 9, data, character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
      });
      game.changeLevel('catacombs4', 5.5, 5.5);
      game.tick();
      const a = game.monsters.filter((m) => m.type.id === 'andariel');
      expect(a.length).toBe(1);
      expect(a[0]!.type.boss).toBe(true);
      // 출처: monstats andariel (Normal) — 레벨 12, 생명 = MonLvl 12 HP 40 × 2562 / 100 = 1024
      expect(a[0]!.stats.level).toBe(12);
      expect(a[0]!.stats.maxHp).toBe(Math.trunc((40 * 2562) / 100));
    });

    // 출처: MonsterMode.cpp sub_6FC631B0 — TCQuestId(6) 퀘스트를 끝내지 않았으면 TreasureClass4 (Andarielq), 그 뒤로는 TreasureClass1 (Andariel)
    it('처치 → 첫 번째는 퀘스트 드롭 Andarielq, 퀘스트를 끝낸 뒤에는 Andariel', () => {
      const game = newGame(77, 120);
      const a = game.spawnMonster('andariel', 40.5, 40.5);
      expect(game.monsterTc(a)).toBe('Andarielq');
      const evs = kill(game, a);
      const drops = evs.filter((e) => e.type === 'itemDropped' && e.source !== 'quest');
      expect(drops.length).toBeGreaterThan(0);
      for (const d of drops) expect(d.tc).toBe('Andarielq');
      // 출처: ACT1Q6_Callback08_MonsterKilled — 퀘스트 보석: 깨진 보석 2 + 보석 1
      const gems = evs.filter((e) => e.type === 'itemDropped' && e.source === 'quest').map((e) => String(e.code));
      expect(gems.length).toBe(3);
      expect(gems.filter((c) => /^(gc[vrbygw]|skc)$/.test(c)).length).toBe(2);
      expect(gems.filter((c) => /^(gs[vrbygw]|sku)$/.test(c)).length).toBe(1);
      // 출처: ACT1Q6_Callback08_MonsterKilled — 죽인 플레이어에게 PRIMARYGOALDONE + REWARDPENDING (TCQuestCP 1 = REWARDPENDING)
      expect(game.questRecord.get(6, 1)).toBe(true);
      const b = game.spawnMonster('andariel', 60.5, 60.5);
      expect(game.monsterTc(b)).toBe('Andariel');
      const d2 = kill(game, b).filter((e) => e.type === 'itemDropped' && e.source !== 'quest');
      expect(d2.length).toBeGreaterThan(0);
      for (const d of d2) expect(d.tc).toBe('Andariel');
    });
  });
});
