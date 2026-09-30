// Act 2~4 몬스터 AI·스킬·미사일 시뮬레이션 (원작 monstats AI / aip1~8 / Skill1~8 / MissA1 + D2MOO AiThink.cpp · SkillMonst.cpp 규칙)
// 기대값 출처: levels.txt (Id 40~108 mon/nmon/umon), monstats.txt (AI·aip·Skill·Miss·spawn 컬럼), skills.txt, missiles.txt,
//             D2MOO AiThink.cpp AI 표 (gpAiTable_6FD3F990) · 각 AITHINK_FnXXX, SkillMonst.cpp SrvSt/SrvDo
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import { CollisionMap } from '../../src/engine/collision';
import { Game, type GameData, type GameEvent } from '../../src/engine/game';
import { classStats, createCharacter, expTable } from '../../src/engine/player';
import { Rng } from '../../src/engine/rng';
import { chooseRegionMonsters, levelMonsterInfo } from '../../src/engine/spawn';
import { AI_TABLE, AI_TARGET_MODE, diabloChances, hasAi, randomArrayIndex, type MonsterUnit } from '../../src/engine/ai';

/** NPC·장식 AI (Phase 6 담당) — 이 테스트의 대상이 아니다 */
const NPC_AI = new Set(['Idle', 'Npc', 'Towner', 'Vendor', 'NpcStationary', 'Hireable', 'Buffy', 'NpcOutOfTown', 'Navi', 'TownRogue', 'JarJar', 'GoodNpcRanged']);

describe.skipIf(!hasGameData)('Act 2~4 몬스터 AI (원작 데이터)', () => {
  let data: GameData;
  let tables: GameTables;
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
  });

  /** 평평한 맵의 게임 (플레이어 (20.5, 20.5)), levelNo 지정 가능 */
  const newGame = (seed = 1, levelNo?: number) => {
    const cs = classStats(tables.table('charstats'), 'Barbarian');
    const ch = createCharacter(cs);
    const map = new CollisionMap(90, 90);
    const game = new Game({
      map, levels: [{ id: 'main', map, inTown: false, exits: [], ...(levelNo ? { levelNo } : {}) }], player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
      seed, data, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'),
    });
    return { game, ch };
  };
  const run = (game: Game, n: number, pred?: (ev: GameEvent[]) => boolean, immortal = true): GameEvent[] => {
    const out: GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      if (immortal && game.character) {
        game.character.life = game.maxLife();
        game.character.mana = game.maxMana();
      }
      const ev = game.tick();
      out.push(...ev);
      if (pred?.(ev)) break;
    }
    return out;
  };
  const missileNames = (game: Game) => game.snapshot().missiles.map((m) => m.name);
  const kill = (game: Game, m: MonsterUnit) => (game as unknown as { killMonster: (m: MonsterUnit, s: string) => void }).killMonster(m, 'player');
  const hitPlayer = (ev: GameEvent[]) => ev.some((x) => x.type === 'playerHit' || x.type === 'playerMissed' || x.type === 'playerBlocked' || x.type === 'playerAvoided');

  /** Act 2~4 (levels.txt Id 40~108) mon/nmon/umon + 스폰·미니언 + MonPreset + 슈퍼유니크 10~38 */
  const actMonsters = (): Set<string> => {
    const ms = new Map(tables.table('monstats').map((r) => [r.Id, r]));
    const ids = new Set<string>();
    for (const r of tables.table('Levels')) {
      const id = Number(r.Id);
      if (id < 40 || id > 108) continue;
      for (const c of ['mon', 'nmon', 'umon']) for (let i = 1; i <= 10; i++) if (r[`${c}${i}`]) ids.add(r[`${c}${i}`] as string);
    }
    for (const r of tables.table('MonPreset')) if (['2', '3', '4'].includes(r.Act ?? '') && ms.has(r.Place)) ids.add(r.Place as string);
    for (const su of data.uniques!.superUniques) if (su.idx >= 10 && su.idx <= 38 && su.idx !== 20) ids.add(su.cls);
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
    ids.add('hydra1');
    return ids;
  };

  it('Act 2~4 레벨 몬스터 풀·스폰·미니언·프리셋·슈퍼유니크 전부 AI 가 있다 (NPC 제외)', () => {
    const missing = [...actMonsters()].filter((id) => {
      const ai = data.monsters.get(id).ai;
      return !NPC_AI.has(ai) && !hasAi(ai);
    });
    expect(missing).toEqual([]);
    // 원작 AI 이름 그대로 (monstats AI 컬럼) · AI 표 대상 방식 (gpAiTable 첫 칸)
    expect(data.monsters.get('sandmaggot1').ai).toBe('SandMaggot');
    expect(data.monsters.get('cantor1').ai).toBe('ZakarumPriest');
    expect(data.monsters.get('doomknight3').ai).toBe('OblivionKnight');
    expect(AI_TARGET_MODE.SandMaggot).toBe(4);
    expect(AI_TARGET_MODE.FrogDemon).toBe(5);
    expect(AI_TARGET_MODE.Tentacle).toBe(2);
    expect(AI_TARGET_MODE.SandMaggotQueen).toBe(0);
    expect(Object.keys(AI_TABLE).length).toBeGreaterThanOrEqual(25 + 25 + 15 + 12);
  });

  it('모든 Act 2~4 몬스터가 1200 프레임 동안 오류 없이 행동한다 (플레이어 곁)', () => {
    const acted: string[] = [];
    const idle: string[] = [];
    for (const id of actMonsters()) {
      const t = data.monsters.get(id);
      if (NPC_AI.has(t.ai) || !hasAi(t.ai)) continue;
      const { game } = newGame(3);
      const m = game.spawnMonster(id, 26.5, 20.5);
      const x0 = m.x, y0 = m.y;
      let did = false;
      run(game, 1200, (e) => {
        if (hitPlayer(e) || e.some((x) => x.type === 'monsterSkill' && x.monsterId === m.id) || m.mode !== 'NU' || m.x !== x0 || m.y !== y0 || game.monsters.length > 1) did = true;
        return did;
      });
      (did ? acted : idle).push(id);
    }
    // 둥지·함정·장식은 대상 없이는 가만히 있을 수 있다 — 그 밖은 모두 움직이거나 공격한다
    expect(idle.filter((id) => !['trappedsoul1', 'trappedsoul2', 'trap-horzmissile', 'trap-vertmissile', 'mephistospirit', 'hellmeteor', 'maggotegg1', 'maggotegg2', 'maggotegg3', 'maggotegg4', 'maggotegg5', 'trap-melee'].includes(id))).toEqual([]);
    expect(acted.length).toBeGreaterThan(60);
  });

  /** 여러 시드 중 pred 가 참이 되는 게임 (확률 AI) */
  const trySeeds = (n: number, f: (seed: number) => boolean): boolean => {
    for (let seed = 1; seed <= n; seed++) if (f(seed)) return true;
    return false;
  };

  describe('Act 2', () => {
    // 출처: AITHINK_Fn008_SandRaider — aip5 프레임 충전 뒤 (dwAiParam[1] = 1) 근접이면 Fire Hit (SrvSt42: S1 공격 수치, El1 S1 fire)
    it('Sand Raider: 충전 뒤 Fire Hit 로 불 피해', () => {
      expect(trySeeds(10, (seed) => {
        const { game } = newGame(seed);
        const m = game.spawnMonster('sandraider1', 22.5, 20.5);
        const ev = run(game, 1500, (e) => e.some((x) => x.type === 'playerHit' && ((x.elemental as number) ?? 0) > 0));
        return ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Fire Hit' && x.monsterId === m.id) && ev.some((x) => x.type === 'playerHit' && ((x.elemental as number) ?? 0) > 0);
      })).toBe(true);
    });

    // 출처: AITHINK_Fn015_SandMaggot (MagottLay) + SkillMonst.cpp SrvDo087 (알 = monstats spawn maggotegg1, UNITFLAG_NOXP),
    //       AITHINK_Fn040_MaggotEgg + SrvDo084 (새끼 calc1 마리, 알은 죽는다)
    it('Sand Maggot: 알을 낳고 (경험치 없음) 알은 새끼(Rock Worm Young)로 깨어난다', () => {
      expect(trySeeds(12, (seed) => {
        const { game } = newGame(seed);
        game.spawnMonster('sandmaggot1', 30.5, 20.5);
        const ev = run(game, 4000, () => game.monsters.some((m) => m.type.id === 'maggotbaby1'));
        const egg = game.monsters.find((m) => m.type.id === 'maggotegg1');
        const baby = game.monsters.find((m) => m.type.id === 'maggotbaby1');
        if (!egg || !baby) return false;
        expect(egg.noXp).toBe(true);
        expect(baby.noXp).toBe(true);
        expect(ev.some((x) => x.type === 'monsterSkill' && x.skill === 'MagottLay')).toBe(true);
        expect(ev.some((x) => x.type === 'monsterSkill' && x.skill === 'MaggotEgg')).toBe(true);
        // 깨어난 알은 죽는다 (SrvDo084 SUNITDMG_KillMonster)
        expect(game.monsters.some((m) => m.type.id === 'maggotegg1' && (m.mode === 'DT' || m.mode === 'DD'))).toBe(true);
        return true;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn015_SandMaggot — 생명 25% 미만·거리 7 미만이면 20% 로 MagottDown (SrvSt45: 대상 불가), aip5 뒤 MagottUp
    it('Sand Maggot: 다치면 굴로 숨었다가 (대상 불가·그리지 않음) 다시 나온다', () => {
      expect(trySeeds(20, (seed) => {
        const { game } = newGame(seed);
        const m = game.spawnMonster('sandmaggot2', 24.5, 20.5);
        m.hp = m.stats.maxHp * 0.2;
        m.hpRegen = false;
        run(game, 3000, () => !!m.hidden);
        if (!m.hidden) return false;
        run(game, 60);
        expect(game.snapshot().monsters.some((s) => s.id === m.id && s.mode === 'NU')).toBe(false);
        run(game, 3000, () => !m.hidden);
        return !m.hidden;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn023_Vulture — 리더 없이 거리² > 144 이면 60% 로 이륙 (대상 불가, S1 비행), 다시 착륙 (S2)
    it('Vulture (Carrion Bird): 멀면 날아올라 (대상 불가) 대상 곁에 내려앉는다', () => {
      expect(trySeeds(20, (seed) => {
        const { game } = newGame(seed);
        const v = game.spawnMonster('vulture1', 36.5, 20.5);
        let flew = false, landed = false, s1 = false;
        const pl = (game as unknown as { player: { x: number; y: number } }).player;
        run(game, 4000, () => {
          // 플레이어가 새를 따라간다 (원작 대상 방식 1: aidist 35 밖이면 AI 가 쉬므로)
          if (Math.hypot(pl.x - v.x, pl.y - v.y) > 20) {
            pl.x = Math.min(85, Math.max(4, v.x + 6));
            pl.y = Math.min(85, Math.max(4, v.y + 6));
          }
          if (v.hidden) flew = true;
          if (v.mode === 'S1') s1 = true;
          if (flew && !v.hidden) landed = true;
          return landed;
        });
        return flew && landed && s1;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn022_GreaterMummy + TargetCallback_GreaterMummy (언데드 시체) + SrvDo097 Resurrect (Resurrect2)
    it('Greater Mummy (Unraveler): 죽은 언데드를 되살린다 (Resurrect2 시퀀스)', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        const mu = game.spawnMonster('unraveler1', 34.5, 20.5);
        const sk = game.spawnMonster('skeleton2', 36.5, 22.5, mu.id);
        kill(game, sk);
        run(game, 30);
        const ev = run(game, 3000, (e) => e.some((x) => x.type === 'monsterResurrected'));
        if (!ev.some((x) => x.type === 'monsterResurrected' && x.targetId === sk.id)) return false;
        expect(ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Resurrect2' && x.monsterId === mu.id)).toBe(true);
        expect(sk.hp).toBe(sk.stats.maxHp);
        return true;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn016_ClawViper (aip1 돌진, aip2 거리) + SrvDo067 Charge (SerpentCharge) — 대상까지 돌진해 한 번 친다
    it('Claw Viper: SerpentCharge 로 돌진해 친다', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        const c = game.spawnMonster('clawviper2', 25.5, 20.5);
        let dashed = false;
        const ev = run(game, 2000, (e) => {
          if (c.dash) dashed = true;
          return dashed && hitPlayer(e);
        });
        return dashed && ev.some((x) => x.type === 'monsterSkill' && x.skill === 'SerpentCharge') && hitPlayer(ev);
      })).toBe(true);
    });

    // 출처: AITHINK_Fn020_Scarab (aip4 Jab) + SkillAma.cpp SrvDo007_Jab (시퀀스 타격마다 피해 +calc1 %)
    it('Scarab (Dung Soldier): Jab 시퀀스로 여러 번 찌른다 (번개 El1)', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        const s = game.spawnMonster('scarab1', 22.5, 20.5);
        const ev = run(game, 2000, (e) => e.some((x) => x.type === 'monsterSkill' && x.skill === 'Jab' && x.monsterId === s.id));
        if (!ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Jab')) return false;
        const after = run(game, 80);
        return after.filter((x) => x.type === 'playerHit' || x.type === 'playerMissed' || x.type === 'playerBlocked').length >= 1;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn045_Sarcophagus (aip1 간격, aip3 수) + MONSTERS_GetMinionSpawnInfo (Mummy 계열을 (x, y+2) 에 NU), SrvDo091 Nest (NOXP|NOTC)
    it('Sarcophagus: 간격마다 미라를 내보내고 다 내보내면 무너진다', () => {
      const { game } = newGame(2);
      const sa = game.spawnMonster('sarcophagus', 30.5, 20.5);
      const ev = run(game, 6000, (e) => e.some((x) => x.type === 'monsterKilled' && x.targetId === sa.id));
      const mummies = game.monsters.filter((m) => m.type.baseId === 'mummy1');
      expect(mummies.length).toBe((data.monsters.get('sarcophagus').aiParams[2] ?? 0) + 1);
      for (const m of mummies) expect(m.noXp && m.noTc).toBe(true);
      expect(ev.some((x) => x.type === 'monsterKilled' && x.targetId === sa.id)).toBe(true);
    });

    // 출처: AITHINK_Fn066_SandMaggotQueen (대상 방식 0, aip1 최대 수) — (x+8, y) 에 계열 Sand Maggot (S1, 경험치 없음)
    it('Maggot Queen: 대상이 없어도 새끼 Sand Maggot 을 낳는다 (최대 aip1)', () => {
      const { game } = newGame(1);
      game.spawnMonster('maggotqueen1', 60.5, 60.5);
      run(game, 6000);
      const kids = game.monsters.filter((m) => m.type.id === 'sandmaggot1');
      expect(kids.length).toBe(data.monsters.get('maggotqueen1').aiParams[0] ?? 0);
      for (const k of kids) expect(k.noXp).toBe(true);
    });

    // 출처: AITHINK_Fn039_PinHead (aip5 Smite) + SkillPal.cpp SrvDo150_Smite (calc2 프레임 기절, 항상 명중)
    it('Blunderbore: Smite 로 플레이어를 기절시킨다', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        game.spawnMonster('blunderbore1', 22.5, 20.5);
        const ev = run(game, 2000, (e) => e.some((x) => x.type === 'playerStunned'));
        return ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Smite') && ev.some((x) => x.type === 'playerStunned');
      })).toBe(true);
    });

    // 출처: AITHINK_Fn017_SandLeaper (거리 < 5, aip1) + SrvSt47_Jump (대상 너머 2×대상 − 자신으로 뛰며 한 번)
    it('Sand Leaper: 대상 너머로 뛰어넘으며 친다', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        const l = game.spawnMonster('sandleaper1', 23.5, 20.5);
        const ev = run(game, 2000, (e) => e.some((x) => x.type === 'monsterSkill' && x.skill === 'Leap'));
        if (!ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Leap')) return false;
        run(game, 40);
        return l.x < 20.5;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn053_Summoner (ACT2Q5_OnSummonerActivated) — Frost Nova·Glacial Spike·Fire Ball·Fire Wall·Weaken
    it('The Summoner: 원소 주문을 쓰고 퀘스트 훅 bossActivated 를 알린다', () => {
      const { game } = newGame(1);
      game.spawnMonster('summoner', 30.5, 20.5);
      const seen = new Set<string>();
      const ev = run(game, 3000, (e) => {
        for (const x of e) if (x.type === 'monsterSkill') seen.add(x.skill as string);
        return seen.size >= 3;
      });
      expect(ev.some((x) => x.type === 'bossActivated' && x.typeId === 'summoner')).toBe(true);
      expect(seen.size).toBeGreaterThanOrEqual(3);
      for (const s of seen) expect(['Glacial Spike', 'Frost Nova', 'Fire Ball', 'VampireFirewall', 'Weaken']).toContain(s);
    });

    // 출처: AITHINK_Fn094_DesertTurret · Fn093_ArcaneTower (Arcane Sanctuary 함정) — desertfireball / lightningtowernova·arcanelightningbolt
    it('Fire Tower·Lightning Spire 함정이 원작 미사일을 쏜다', () => {
      for (const [id, miss] of [['firetower', 'desertfireball'], ['lightningspire', 'arcanelightningbolt']] as const) {
        const { game } = newGame(4);
        game.spawnMonster(id, 26.5, 20.5);
        let seen = false;
        run(game, 2000, () => (seen = missileNames(game).includes(miss)));
        expect(seen, `${id} → ${miss}`).toBe(true);
      }
    });

    it('원거리 몬스터는 원작 미사일을 쏜다 (monstats Miss*, 스킬 srvmissile)', () => {
      const cases: [string, string][] = [
        ['slinger1', 'pantherjav1'], ['slinger5', 'pantherpotorange'], ['sandmaggot1', 'goospit1'], ['unraveler1', 'mummy1'],
        ['fetishblow2', 'blowgun'], ['frogdemon1', 'frogfire'], ['willowisp1', 'willowisplightningbolt'], ['councilmember1', 'highpriestlightning'],
        ['doomknight2', 'undeadmissile'], ['fingermage1', 'fingermagespider'], ['megademon1', 'megademoninferno'],
        ['fetishshaman2', 'fetishinferno1'], ['cantor1', 'monsterlight'],
      ];
      const fail: string[] = [];
      for (const [id, miss] of cases) {
        const ok = trySeeds(6, (seed) => {
          const { game } = newGame(seed);
          const m = game.spawnMonster(id, 29.5, 20.5);
          if (id === 'cantor1') {
            m.hp = m.stats.maxHp;
          }
          let seen = false;
          run(game, 2500, (e) => (seen = e.some((x) => x.type === 'monsterMissile' && x.monsterId === m.id && (x.name as string).startsWith(miss))));
          return seen;
        });
        if (!ok) fail.push(`${id}→${miss}`);
      }
      expect(fail).toEqual([]);
    });
  });

  describe('Act 3', () => {
    // 출처: AITHINK_Fn065_FetishShaman (TargetCallback_FetishShaman: 죽은 Fetish, 부활 능력 aip2) + SrvDo097 (Resurrect2)
    it('Fetish Shaman: 불길(FetishInferno) 을 뿜고 죽은 부하 Fetish 를 되살린다', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        const sh = game.spawnMonster('fetishshaman2', 30.5, 20.5);
        const f = game.spawnMonster('fetish2', 32.5, 22.5, sh.id);
        kill(game, f);
        const ev = run(game, 3000, (e) => e.some((x) => x.type === 'monsterResurrected'));
        return ev.some((x) => x.type === 'monsterResurrected' && x.targetId === f.id) && ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Resurrect2');
      })).toBe(true);
    });

    // 출처: MonsterMode.cpp 죽음 모드 (monstats deathDmg, BaseId bonefetish1) — monstercorpseexplode, 반경 5, 생명 × MonsterCEDmgPercent % (최소 60 %) 의 절반 물리
    it('Undead Stygian Doll: 죽으면 터져 곁의 플레이어가 다친다', () => {
      const { game, ch } = newGame(1);
      const b = game.spawnMonster('bonefetish4', 22.5, 20.5);
      ch.life = game.maxLife();
      const before = ch.life;
      const g = game as unknown as { events: GameEvent[] };
      g.events = [];
      kill(game, b);
      const ex = g.events.find((x) => x.type === 'monsterExploded');
      expect(ex).toBeDefined();
      expect(ch.life).toBeLessThan(before);
    });

    // 출처: MonsterMode.cpp sub_6FC641D0 — SplEndDeath 1: 죽음이 끝나면 MONSTER_Reinitialize(minion1) (Flayer Shaman 시체 → Flayer 시체)
    it('Flayer Shaman: 죽음이 끝나면 시체가 Flayer 로 바뀐다 (다른 주술사가 되살릴 수 있다)', () => {
      const { game } = newGame(1);
      const sh = game.spawnMonster('fetishshaman2', 40.5, 40.5);
      kill(game, sh);
      const ev = run(game, 200, () => sh.mode === 'DD');
      run(game, 2);
      expect(sh.mode).toBe('DD');
      expect(sh.type.id).toBe('fetish2');
      expect(ev.some((x) => x.type === 'monsterReinitialized')).toBe(true);
    });

    // 출처: AITHINK_Fn052_FrogDemon (대상 방식 5) — 거리 12 넘으면 Submerge (대상 불가), aip8 안으로 오면 Emerge
    it('Frog Demon (Swamp Dweller): 멀면 물속에 숨고 가까이 오면 나온다', () => {
      const { game } = newGame(2);
      const fr = game.spawnMonster('frogdemon1', 40.5, 20.5);
      run(game, 400, () => !!fr.hidden);
      expect(fr.hidden).toBe(true);
      const pl = (game as unknown as { player: { x: number; y: number } }).player;
      pl.x = fr.x - 3;
      pl.y = fr.y;
      run(game, 400, () => !fr.hidden);
      expect(fr.hidden).toBe(false);
    });

    // 출처: AITHINK_Fn049_ZakarumPriest + TargetCallback_ZakarumPriest (Zealot·Cantor 생명 60% 이하) + SrvDo096 ZakarumHeal
    it('Zakarum Priest: 다친 Zealot 을 치료한다', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        const pr = game.spawnMonster('cantor1', 30.5, 20.5);
        const z = game.spawnMonster('zealot1', 32.5, 22.5);
        z.hp = z.stats.maxHp * 0.3;
        z.hpRegen = false;
        const hp0 = z.hp;
        const ev = run(game, 2500, (e) => e.some((x) => x.type === 'monsterHealed'));
        return ev.some((x) => x.type === 'monsterHealed' && x.monsterId === z.id && x.by === pr.id) && z.hp > hp0;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn085_HighPriest (Hydra 대각선 5) + SkillSor.cpp SrvDo144 (머리 3 개, 지속 par1 + (lvl−1) × par2) + Fn086_Hydra
    it('Council Member: 히드라 3 개를 불러 화염 볼트를 쏘고, 지속이 끝나면 사라진다', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        game.spawnMonster('councilmember1', 34.5, 20.5);
        const ev = run(game, 3000, () => game.monsters.filter((m) => m.type.id.startsWith('hydra')).length >= 3);
        const hydras = game.monsters.filter((m) => m.type.id.startsWith('hydra'));
        if (hydras.length < 3 || !ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Hydra')) return false;
        const h = hydras[0]!;
        expect(h.expires).toBeGreaterThan(game.frame);
        const shot = run(game, 400, (e) => e.some((x) => x.type === 'monsterMissile' && x.name === 'hydra'));
        expect(shot.some((x) => x.type === 'monsterMissile' && x.name === 'hydra')).toBe(true);
        run(game, (h.expires ?? 0) - game.frame + 60);
        expect(['DT', 'DD']).toContain(h.mode);
        return true;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn027_ThornHulk (aip4 광란) + SKILLS_RollMonFrenzyDamage (맞히면 monfrenzy: 속도·공속 +dm34)
    it('Thorned Hulk: MonFrenzy 로 맞히면 광란 상태 (속도·공격 속도 증가)', () => {
      expect(trySeeds(20, (seed) => {
        const { game } = newGame(seed);
        const h = game.spawnMonster('thornhulk1', 22.5, 20.5);
        run(game, 3000, () => h.states.has('monfrenzy'));
        if (!h.states.has('monfrenzy')) return false;
        expect(h.states.get('monfrenzy')!.stats.velocitypercent).toBeGreaterThan(0);
        return true;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn024_Mosquito + SrvSt55/SrvDo107 — 독·마나·스태미나 흡수, 물리 피해의 calc3 % 회복
    it('Sucker (Mosquito): 빨아서 마나·스태미나를 빼앗는다', () => {
      expect(trySeeds(15, (seed) => {
        const { game, ch } = newGame(seed);
        game.spawnMonster('mosquito1', 23.5, 20.5);
        let drained = false;
        for (let i = 0; i < 3000 && !drained; i++) {
          ch.life = game.maxLife();
          ch.mana = 30;
          const ev = game.tick();
          if (ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Mosquito')) {
            run(game, 40);
            drained = ch.mana < 30 - 0.5;
          }
        }
        return drained;
      })).toBe(true);
    });

    // 출처: D2GAME_SpawnPresetMonster_6FC66560 (place_tentacle) + monstats tentaclehead1 minion1 tentacle1 (4~6) + Fn056/057 (대상 방식 2)
    it('Water Watcher: 머리가 촉수를 거느리고 물속에 잠겼다 (대상 불가) 나와서 tentaclegoo 를 쏜다', () => {
      const { game } = newGame(1);
      const head = game.spawnMonster('tentaclehead1', 30.5, 20.5);
      const t = game.spawnMonster('tentacle1', 32.5, 22.5, head.id);
      run(game, 20);
      expect(head.hidden).toBe(true);
      expect(t.hidden).toBe(true);
      const ev = run(game, 4000, (e) => e.some((x) => x.type === 'monsterMissile' && x.name === 'tentaclegoo'));
      expect(ev.some((x) => x.type === 'monsterSkill' && x.skill === 'Emerge')).toBe(true);
      expect(ev.some((x) => x.type === 'monsterMissile' && x.name === 'tentaclegoo')).toBe(true);
      // 머리가 죽으면 촉수도 (40%) 죽는다
      kill(game, head);
      run(game, 600);
      expect(['DT', 'DD']).toContain(t.mode);
    });

    // 출처: AITHINK_Fn050_Mephisto — Normal 에서는 MephFrostNova(4)·Blizzard(5) 를 쓰지 않는다 (pGame->nDifficulty 검사 — "해자 속임수")
    it('Mephisto: Normal 에서는 번개·충전 볼트·독 노바·해골 미사일만 (Blizzard·Frost Nova 없음), 미사일 벽 너머에도', () => {
      const { game } = newGame(3);
      const map = game.map;
      for (let y = 0; y < 90; y++) map.block(26, y, 0x04 | 0x01);
      const me = game.spawnMonster('mephisto', 30.5, 20.5);
      const seen = new Set<string>();
      run(game, 4000, (e) => {
        for (const x of e) if (x.type === 'monsterSkill' && x.monsterId === me.id) seen.add(x.skill as string);
        return false;
      });
      expect(seen.has('Blizzard')).toBe(false);
      expect(seen.has('MephFrostNova')).toBe(false);
      expect([...seen].filter((x) => ['PrimeLightning', 'PrimeBolt', 'PrimePoisonNova', 'MephistoMissile'].includes(x)).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Act 4', () => {
    // 출처: AITHINK_Fn074_OblivionKnight (aip4 저주) + SrvDo112 MonCurseCast (여섯 저주 중 하나) / SrvDo030 Decrepify
    it('Oblivion Knight: 플레이어에게 저주를 건다', () => {
      expect(trySeeds(10, (seed) => {
        const { game } = newGame(seed);
        game.spawnMonster('doomknight3', 30.5, 20.5);
        const ev = run(game, 3000, (e) => e.some((x) => x.type === 'playerCursed'));
        const c = ev.find((x) => x.type === 'playerCursed');
        if (!c) return false;
        expect(['amplifydamage', 'weaken', 'ironmaiden', 'lifetap', 'decrepify', 'lowerresist']).toContain(c.curse);
        expect(game.snapshot().player.states).toContain(c.curse);
        return true;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn073_AbyssKnight (aip1 생명 %, aip2) + SrvDo018 MonBoneArmor (흡수 ln12 × 256)
    it('Abyss Knight: 다치면 뼈 갑옷으로 물리 피해를 흡수한다', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        const k = game.spawnMonster('doomknight2', 30.5, 20.5);
        k.hp = k.stats.maxHp * 0.3;
        k.hpRegen = false;
        run(game, 2000, () => k.states.has('bonearmor'));
        if (!k.states.has('bonearmor')) return false;
        const hp = k.hp;
        const absorb = k.states.get('bonearmor')!.stats.bonearmor ?? 0;
        (game as unknown as { damageMonster: (m: MonsterUnit, d: object, s: string) => void }).damageMonster(k, { phys: 256, fire: 0, ltng: 0, cold: 0, pois: 0, mag: 0, coldLen: 0, freezeLen: 0, poisLen: 0, stunLen: 0, hitClass: 0, crit: false }, 'player');
        expect(k.hp).toBe(hp);
        expect(k.states.get('bonearmor')?.stats.bonearmor ?? 0).toBe(absorb - 256);
        return true;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn070_FingerMage + SrvDo101 + MISSMODE_SrvHit19 (fingermagecurse: manarecovery −par3 × lvl)
    it('Storm Caster: 거미가 맞으면 마나 회복 저주 (fingermagecurse)', () => {
      expect(trySeeds(10, (seed) => {
        const { game } = newGame(seed);
        game.spawnMonster('fingermage1', 30.5, 20.5);
        run(game, 3000, () => !!game.playerState('fingermagecurse'));
        const st = game.playerState('fingermagecurse');
        if (!st) return false;
        expect(st.stats.manarecovery).toBeLessThan(0);
        return true;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn068_VileMother (aip1 최대, aip2 동시) + MONSTERS_GetMinionSpawnInfo (Vile Child 계열) + SrvDo091 Nest
    it('Flesh Spawner (Vile Mother): Flesh Beast 를 낳는다 (동시 최대 aip2)', () => {
      const { game } = newGame(4);
      game.spawnMonster('vilemother1', 30.5, 20.5);
      run(game, 3000);
      const kids = game.monsters.filter((m) => m.type.id === 'vilechild1');
      expect(kids.length).toBeGreaterThan(0);
      expect(kids.length).toBeLessThanOrEqual(data.monsters.get('vilemother1').aiParams[0] ?? 0);
      for (const k of kids) expect(k.noXp && k.noTc).toBe(true);
    });

    // 출처: AITHINK_Fn071_Regurgitator (무른 시체 찾기) + SrvDo108 RegurgitatorEat (시체 제거, 최대 생명의 calc1 % 회복) → A2 regurgitatorcorpse
    it('Corpse Spitter: 무른 시체를 먹고 시체 덩이를 뱉는다', () => {
      expect(trySeeds(15, (seed) => {
        const { game } = newGame(seed);
        const r = game.spawnMonster('regurgitator1', 30.5, 20.5);
        const z = game.spawnMonster('zombie1', 32.5, 22.5);
        kill(game, z);
        run(game, 20);
        const ev = run(game, 3000, (e) => e.some((x) => x.type === 'monsterMissile' && x.name === 'regurgitatorcorpse'));
        return ev.some((x) => x.type === 'corpseEaten' && x.monsterId === r.id && x.corpseId === z.id) && !game.monsters.includes(z)
          && ev.some((x) => x.type === 'monsterMissile' && x.name === 'regurgitatorcorpse');
      })).toBe(true);
    });

    // 출처: AITHINK_Fn055_Izual (ACT4Q1_OnIzualActivated, aip3 원거리 노바) — Frost Nova 64 방향
    it('Izual: Frost Nova 를 쓰고 bossActivated 를 알린다', () => {
      expect(trySeeds(10, (seed) => {
        const { game } = newGame(seed);
        game.spawnMonster('izual', 27.5, 20.5);
        const ev = run(game, 3000, (e) => e.some((x) => x.type === 'monsterSkill' && x.skill === 'Frost Nova'));
        ev.push(...run(game, 40));
        return ev.some((x) => x.type === 'bossActivated' && x.typeId === 'izual') && ev.filter((x) => x.type === 'monsterMissile' && x.name === 'frostnova').length === 64;
      })).toBe(true);
    });

    // 출처: AITHINK_Fn033_HellMeteor (aip3 범위) + SrvDo028 → hellmeteordown
    it('Hell Meteor 함정: 주변에 운석을 떨어뜨린다', () => {
      const { game } = newGame(1);
      game.spawnMonster('hellmeteor', 24.5, 20.5);
      const ev = run(game, 2000, (e) => e.some((x) => x.type === 'monsterMissile' && x.name === 'hellmeteordown'));
      expect(ev.some((x) => x.type === 'monsterMissile' && x.name === 'hellmeteordown')).toBe(true);
    });
  });

  describe('Diablo AI', () => {
    // 출처: AiBaal.cpp AI_GetRandomArrayIndex — 가중치 합 rand, 합 0 이면 기본값
    it('randomArrayIndex: 가중치 0 칸은 절대 뽑지 않고, 합 0 이면 기본값', () => {
      const { game } = newGame(1);
      const m = game.spawnMonster('diablo', 40.5, 40.5);
      const counts = new Array<number>(4).fill(0);
      for (let i = 0; i < 400; i++) counts[randomArrayIndex(m, [10, 0, 30, 60], 11)]!++;
      expect(counts[1]).toBe(0);
      expect(counts[3]!).toBeGreaterThan(counts[0]!);
      expect(randomArrayIndex(m, [0, 0], 11)).toBe(11);
    });

    // 출처: AITHINK_Fn051_Diablo 가중치 표 — 근접: A1 40, A2 70, 번개 40, 화염 노바 24(±10 저항), 냉기 40, 화염 폭풍 15 / 냉기 상태면 7·8 = 0
    it('diabloChances: 원작 표 (근접 / 원거리 / 미사일 벽)', () => {
      const base = { melee: false, colliding: false, targetLow: false, targetCold: false, fireRes: 0, lightRes: 0, closeToPortal: false, counter: 1, farAway: false, furtherAway: false, special: false, distFull: 10, score: 0, playerCountDiff: 0, canPrison: false, canPrisonPortal: false };
      const melee = diabloChances({ ...base, melee: true });
      expect(melee.slice(0, 10)).toEqual([0, 0, 40, 70, 0, 40, 24, 40, 15, 0]);
      expect(diabloChances({ ...base, melee: true, targetCold: true, fireRes: 50 })[6]).toBe(14);
      expect(diabloChances({ ...base, melee: true, targetCold: true })[7]).toBe(0);
      const ranged = diabloChances(base);
      // 대상 수 1 (< 2) 과 싱글플레이 → 뼈 감옥 0, 번개 25, 노바 25 − 10
      expect(ranged[5]).toBe(25);
      expect(ranged[6]).toBe(15);
      expect(ranged[9]).toBe(0);
      expect(ranged[12]).toBe(20);
      const walled = diabloChances({ ...base, colliding: true });
      expect(walled[1]).toBe(25);
      expect(walled[9]).toBe(0);
      expect(diabloChances({ ...base, furtherAway: true, farAway: true })[14]).toBe(60);
    });

    it('Diablo: 번개 숨결(DiabLight 연속)·화염 노바·냉기 손길 등 여러 기술을 쓴다', () => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 4; seed++) {
        const { game } = newGame(seed);
        const d = game.spawnMonster('diablo', 28.5, 20.5);
        run(game, 2500, (e) => {
          for (const x of e) if (x.type === 'monsterSkill' && x.monsterId === d.id) seen.add(x.skill as string);
          return false;
        });
      }
      expect([...seen].filter((s) => ['DiabLight', 'DiabFire', 'DiabCold', 'DiabWall', 'DiabRun', 'PrimeFirewall', 'DiabPrison'].includes(s)).length).toBeGreaterThanOrEqual(3);
    });
  });
});
