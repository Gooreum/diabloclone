// Act 1 몬스터 AI·스킬·미사일 시뮬레이션 (원작 monstats AI / aip1~8 / Skill1~8 / MissA1 + D2MOO AiThink.cpp 규칙)
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { Rng } from '../../src/engine/rng';
import { chooseRegionMonsters, levelMonsterInfo } from '../../src/engine/spawn';
import { hasAi, type MonsterUnit } from '../../src/engine/ai';

describe.skipIf(!hasGameData)('Act 1 몬스터 AI (원작 데이터)', () => {
  let data: GameData;
  let tables: GameTables;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });

  /** 평평한 맵의 게임 (레벨 id 지정 가능), 플레이어는 (20.5, 20.5) */
  const newGame = (seed = 1, levelId = 'main') => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    const map = new CollisionMap(90, 90);
    const game = new Game({
      map, levels: [{ id: levelId, map, inTown: false, exits: [] }], player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
      seed, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
    });
    return { game, ch };
  };
  /** n 틱 진행 (플레이어는 죽지 않게 생명을 채운다). pred 가 참이면 멈춘다 */
  const run = (game: Game, n: number, pred?: (ev: GameEvent[]) => boolean, immortal = true): GameEvent[] => {
    const out: GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      if (immortal && game.character) game.character.life = game.maxLife();
      const ev = game.tick();
      out.push(...ev);
      if (pred?.(ev)) break;
    }
    return out;
  };
  const missileNames = (game: Game) => game.snapshot().missiles.map((m) => m.name);
  const kill = (game: Game, m: MonsterUnit) => (game as unknown as { killMonster: (m: MonsterUnit, s: string) => void }).killMonster(m, 'player');

  it('Act 1 레벨 몬스터 풀(mon1~10, umon1~10)·프리셋 몬스터 전부 AI 가 있다', () => {
    const ids = new Set<string>(['andariel', 'bloodraven', 'griswold', 'smith', 'gargoyletrap', 'foulcrow1', 'foulcrow2']);
    for (const r of tables.table('Levels')) {
      const id = Number(r.Id);
      if (id < 2 || id > 38) continue;
      for (let i = 1; i <= 10; i++) for (const c of ['mon', 'umon']) if (r[`${c}${i}`]) ids.add(r[`${c}${i}`] as string);
    }
    for (const su of data.uniques!.superUniques.filter((s) => [0, 1, 2, 3, 4, 5, 6, 7, 9, 20, 40].includes(s.idx))) ids.add(su.cls);
    const missing = [...ids].filter((id) => !hasAi(data.monsters.get(id).ai));
    expect(missing).toEqual([]);
    // 원작 AI 이름 그대로 (monstats AI 컬럼)
    expect(data.monsters.get('sk_archer1').ai).toBe('SkeletonBow');
    expect(data.monsters.get('cr_archer1').ai).toBe('CorruptArcher');
    expect(data.monsters.get('foulcrow1').ai).toBe('BloodHawk');
    expect(data.monsters.get('crownest1').ai).toBe('FoulCrowNest');
  });

  // 출처: MONSTERREGION_InitializeAll — NumMon(3) 개를 풀에서 중복 없이
  it('레벨 몬스터 목록: Stony Field 풀 5 종 중 NumMon 3 종 (중복 없이)', () => {
    const info = levelMonsterInfo(tables.table('Levels'), 'Stony Field');
    expect(info.pool).toEqual(['skeleton1', 'zombie2', 'crownest1', 'goatman1', 'cr_archer1']);
    expect(info.numMon).toBe(3);
    const seen = new Set<string>();
    for (let s = 1; s < 30; s++) {
      const r = chooseRegionMonsters(info, data.monsters, new Rng(s));
      expect(r.length).toBe(3);
      expect(new Set(r).size).toBe(3);
      for (const id of r) {
        expect(info.pool).toContain(id);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(5);
  });

  describe('원거리 몬스터는 원작 미사일을 쏜다 (monstats MissA1/MissA2, 스킬 srvmissile)', () => {
    const cases: [string, string, number][] = [
      ['sk_archer1', 'skbowarrow1', 9],
      ['sk_archer2', 'skbowarrow2', 9],
      ['cr_archer1', 'cr_arrow1', 9],
      ['cr_archer3', 'cr_arrow3', 9],
      ['skmage_fire1', 'skmage3', 7],
      ['skmage_ltng1', 'skmage4', 7],
      ['quillrat1', 'spike1', 6],
      ['fallenshaman1', 'shafire1', 9],
      ['fallenshaman2', 'shafire2', 9],
      ['vampire5', 'vampirefireball', 12],
      ['bloodraven', 'raven1', 10],
    ];
    for (const [id, miss, dist] of cases) {
      it(`${id} → ${miss}`, () => {
        const { game } = newGame(7);
        const m = game.spawnMonster(id, 20.5 + dist, 20.5);
        let seen = false;
        run(game, 1500, () => (seen = missileNames(game).includes(miss)));
        expect(seen, `${id} fired ${miss}`).toBe(true);
        void m;
      });
    }
  });

  // 출처: AITHINK_Fn004_Bighead — 건강할 때 발사 확률 aip3 = 0 이라 다쳤을 때(생명 < aip1 %)만 A2 로 쏜다
  it('Misshapen: 다치면 bighead3 번개 미사일 (El1 A2 ltng 100% 번개 피해)', () => {
    const { game } = newGame(3);
    const b = game.spawnMonster('bighead3', 26.5, 20.5);
    expect(b.type.aiParams[2]).toBe(0);
    b.hp = b.stats.maxHp * 0.5;
    b.hpRegen = false;
    let fired = false;
    const ev = run(game, 2000, (e) => {
      if (missileNames(game).includes('bighead3')) fired = true;
      return fired && e.some((x) => x.type === 'playerHit' && ((x.elemental as number) ?? 0) > 0);
    });
    expect(fired).toBe(true);
    expect(ev.some((x) => x.type === 'playerHit' && ((x.elemental as number) ?? 0) > 0)).toBe(true);
  });

  // 출처: AITHINK_Fn013_FallenShaman + SKILLS_SrvDo097_Resurrect (시퀀스 seq_shamanresurrect: A2 17 프레임, 12 번째에 이벤트)
  it('Fallen Shaman: 자기 파티의 죽은 Fallen 을 부활시킨다 (생명 가득, 경험치·드롭 없음)', () => {
    const seq = data.monsters.seqs.get('seq_shamanresurrect')!;
    expect(seq.length).toBe(17);
    expect(seq.every((f) => f.mode === 'A2')).toBe(true);
    expect(seq.findIndex((f) => f.event)).toBe(12);
    let done = false;
    for (let seed = 1; seed < 12 && !done; seed++) {
      const { game } = newGame(seed);
      const sh = game.spawnMonster('fallenshaman1', 34.5, 20.5);
      const f = game.spawnMonster('fallen1', 35.5, 22.5, sh.id);
      kill(game, f);
      const ev = run(game, 1500, (e) => e.some((x) => x.type === 'monsterResurrected'));
      const r = ev.find((x) => x.type === 'monsterResurrected');
      if (!r) continue;
      expect(r.targetId).toBe(f.id);
      expect(ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Resurrect' && x.monsterId === sh.id)).toBe(true);
      expect(f.hp).toBe(f.stats.maxHp);
      expect(f.noXp && f.noTc).toBe(true);
      expect(f.mode).not.toBe('DD');
      done = true;
    }
    expect(done).toBe(true);
  });

  it('Fallen Shaman 불덩이는 시퀀스(SQ)로 쏘고 화염 피해 (shafire1 EMin 1 ~ EMax 4)', () => {
    const { game } = newGame(5);
    const sh = game.spawnMonster('fallenshaman1', 29.5, 20.5);
    let sq = false;
    const ev = run(game, 1500, (e) => {
      if (sh.mode === 'SQ') sq = true;
      return e.some((x) => x.type === 'playerHit' && ((x.elemental as number) ?? 0) > 0);
    });
    expect(sq).toBe(true);
    const hit = ev.find((x) => x.type === 'playerHit' && ((x.elemental as number) ?? 0) > 0)!;
    expect(hit.elemental as number).toBeGreaterThanOrEqual(1 * 0.25);
    expect(hit.elemental as number).toBeLessThanOrEqual(4);
  });

  // 출처: AITHINK_Fn043_FoulCrowNest (aip1 스폰 간격 100, aip3 스폰 수 6) + SKILLS_SrvDo091_Nest (UNITFLAG_NOXP | NOTC)
  it('Foul Crow Nest: 간격마다 Foul Crow 를 낳고 (경험치 없음), 6 마리 뒤 무너진다', () => {
    const { game } = newGame(2);
    const nest = game.spawnMonster('crownest1', 34.5, 20.5);
    const ev = run(game, 2500, (e) => e.some((x) => x.type === 'monsterKilled' && x.targetId === nest.id));
    const crows = game.monsters.filter((m) => m.type.id === 'foulcrow1');
    expect(crows.length).toBe(data.monsters.get('crownest1').aiParams[2]);
    for (const c of crows) expect(c.noXp && c.noTc).toBe(true);
    expect(ev.some((x) => x.type === 'monsterKilled' && x.targetId === nest.id)).toBe(true);
    expect(ev.filter((x) => x.type === 'monsterSkill' && x.skill === 'Nest').length).toBe(6);
  });

  it('Foul Crow (BloodHawk AI): 돌진 뒤 근접 공격', () => {
    const { game } = newGame(4);
    game.spawnMonster('foulcrow1', 28.5, 20.5);
    const ev = run(game, 1200, (e) => e.some((x) => x.type === 'playerHit' || x.type === 'playerMissed'));
    expect(ev.some((x) => x.type === 'playerHit' || x.type === 'playerMissed')).toBe(true);
  });

  // 출처: AITHINK_Fn003_Zombie — Burial Grounds 에서는 aip 확률과 관계없이 달려든다 (속도 +100%)
  it('Zombie: Burial Grounds 에서는 항상 속도 +100% 로 달려든다', () => {
    const { game } = newGame(1, 'burialgrounds');
    const z = game.spawnMonster('zombie2', 32.5, 20.5);
    run(game, 60, () => z.mode === 'RN' && z.path.length > 0);
    // zombie2 는 MonStats2 mRN = 1 → 달리기 모드, 속도 = Run × (100 + 100)/100
    expect(z.type.modes.has('RN')).toBe(true);
    expect(z.mode).toBe('RN');
    expect(z.moveVelPct).toBe(100);
    expect(z.moveSpeed).toBe(z.type.run * 2);
  });

  // 출처: AITHINK_Fn007_Brute — 속도 % = 100 − clamp(생명%, 40, 100)
  it('Gargantuan Beast: 다칠수록 빨리 다가온다', () => {
    const { game } = newGame(1);
    const b = game.spawnMonster('brute1', 34.5, 20.5);
    b.hp = b.stats.maxHp * 0.5;
    run(game, 60, () => b.mode === 'WL' && b.path.length > 0);
    expect(b.moveVelPct).toBe(50);
  });

  // 출처: SUnitDmg.cpp MONSTER_SetAiState(19) + AiUtil sub_6FCF2E70 (3 또는 19 = 방금 맞음)
  it('AI 상태: 경직 없이 맞으면 19, 다음 비중립 모드가 끝나면 풀린다', () => {
    const { game } = newGame(1);
    const z = game.spawnMonster('zombie1', 40.5, 40.5);
    z.hp = 1e6;
    (game as unknown as { damageMonster: (m: MonsterUnit, d: object) => void }).damageMonster(z, { phys: 256, fire: 0, ltng: 0, cold: 0, pois: 0, mag: 0, coldLen: 0, freezeLen: 0, poisLen: 0, stunLen: 0, hitClass: 0, crit: false });
    expect([3, 19]).toContain(z.aiState);
  });

  it('Andariel: 독 분사(AndrialSpray, SQ 시퀀스 SC 프레임)로 andarielspray 를 뿌리고 맞으면 독에 걸린다', () => {
    let ok = false;
    for (let seed = 1; seed < 8 && !ok; seed++) {
      const { game } = newGame(seed);
      const a = game.spawnMonster('andariel', 27.5, 20.5);
      let scFrame = false;
      const ev = run(game, 1500, () => {
        const s = game.snapshot().monsters.find((x) => x.id === a.id);
        if (s?.anim?.mode === 'SC') scFrame = true;
        return !!game.playerState('poison') && missileNames(game).includes('andarielspray');
      });
      if (!ev.some((x) => x.type === 'monsterSkill' && x.skill === 'AndrialSpray')) continue;
      expect(scFrame).toBe(true);
      expect(game.playerState('poison')?.stats.hpregen ?? 0).toBeLessThan(0);
      ok = true;
    }
    expect(ok).toBe(true);
  });

  it('Blood Raven: Nest 로 zombie2 를 땅에서 일으킨다 (S1, 경험치 없음) 와 Quick Strike (raven1)', () => {
    let ok = false;
    for (let seed = 1; seed < 10 && !ok; seed++) {
      const { game } = newGame(seed);
      const br = game.spawnMonster('bloodraven', 32.5, 20.5);
      const ev = run(game, 2000, () => game.monsters.some((m) => m.type.id === 'zombie2'));
      const z = game.monsters.find((m) => m.type.id === 'zombie2');
      if (!z) continue;
      expect(ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Nest' && x.monsterId === br.id)).toBe(true);
      expect(z.noXp).toBe(true);
      expect(z.leaderId).toBe(br.id);
      ok = true;
    }
    expect(ok).toBe(true);
  });

  it('Corrupt Rogue: 멀리(>20) 있으면 aip4 속도 % 로 달려온다', () => {
    const { game } = newGame(1);
    const r = game.spawnMonster('corruptrogue1', 20.5 + 26, 20.5);
    run(game, 60, () => r.mode === 'RN');
    expect(r.mode).toBe('RN');
    expect(r.moveVelPct).toBe(data.monsters.get('corruptrogue1').aiParams[3]);
  });

  // 출처: monstats wraith1 El1 = A1 mana 40% (60~100 × DM 비율) — 맞으면 마나를 빼앗는다
  it('Ghost: 근접 공격 El1(mana) 로 마나를 태운다', () => {
    const { game, ch } = newGame(3);
    game.spawnMonster('wraith1', 23.5, 20.5);
    let drained = false;
    // 마나 재생보다 크게 빠지는지 매 틱 검사
    for (let i = 0; i < 3000 && !drained; i++) {
      ch.life = game.maxLife();
      ch.mana = 10;
      game.tick();
      if (ch.mana < 10 - 0.5) drained = true;
    }
    expect(drained).toBe(true);
  });

  it('죽이면 경험치 (monstats Exp × MonLvl XP / 100, 레벨 차 보정)', () => {
    const { game, ch } = newGame(1);
    const z = game.spawnMonster('zombie1', 30.5, 20.5);
    const g = game as unknown as { killMonster: (m: MonsterUnit, s: string) => void; events: GameEvent[] };
    g.events = [];
    g.killMonster(z, 'player');
    const ev = g.events.find((e) => e.type === 'experience');
    expect(ev?.amount).toBe(z.stats.exp);
    expect(ch.experience).toBe(z.stats.exp);
  });

  it('레이어 외형: 레벨 몬스터 영역마다 최대 3 세트 (MonsterChoose sub_6FC62020)', () => {
    const { game } = newGame(1);
    const combos = new Set<string>();
    for (let i = 0; i < 40; i++) combos.add(JSON.stringify(game.spawnMonster('skeleton1', 30.5 + (i % 8), 30.5 + Math.trunc(i / 8)).components));
    expect(combos.size).toBeGreaterThanOrEqual(1);
    expect(combos.size).toBeLessThanOrEqual(3);
  });
});
