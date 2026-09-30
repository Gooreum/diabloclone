// 악몽·지옥 난이도 (Phase 8 Step 1) — 원작 표 수치로 검증.
// 기대값 출처:
//   monstats.txt zombie1: Level 1 / Level(N) 36 / Level(H) 67, minHP 101 maxHP 181 / MinHP(N)·(H) 105 MaxHP 150, AC 84 / AC(N)·(H) 80, Exp 111 / Exp(N)·(H) 105,
//     A1MinD 51 A1MaxD 151 A1TH 101 / (N)·(H) 60·140·105, TreasureClass1 "Act 1 H2H A" / "Act 1 (N) H2H A" / "Act 1 (H) H2H A"
//   MonLvl.txt Level 36: HP(N) 525 AC(N) 449 XP(N) 2568 · Level 26: DM(N) 23 TH(N) 558 · Level 67: HP(H) 3084 AC(H) 1134 XP(H) 26733 · Level 51: DM(H) 59 TH(H) 2116
//   levels.txt Blood Moor: MonLvl1/2/3 1/26/51, MonDen 520, MonUMin/Max 없음 / (N) 4·5 / (H) 7·9, mon1~3 = nmon1~3 = zombie1 fallen1 quillrat1
//   D2MOO MONSTERS_ApplyClassicScaling (생명 1/2, 방어 10/12, 경험치 10/17·10/26, 레벨 25×난이도+Level), MonsterMode.cpp (피해 10/12, 명중 10/15),
//     SUnitDmg.cpp (클래식 저항 −20/−50), Player.cpp PLAYER_ApplyDeathPenalty (DeathExpPenalty 5/10 %), PlrSave2.cpp (nTown[난이도])
//   experience.txt Barbarian: 29 → 4663553, 30 → 5493363
//   hireling.txt Act 1 Rogue: Difficulty 1/2/3 행 Level 3/25/49
import { beforeAll, describe, expect, it } from 'vitest';
import { gameChain, hasGameData } from '../support/gamedata';
import { GameTables } from '../../src/data/tables';
import { buildGameData, withDifficulty } from '../../src/data/gamedata';
import { Game, type GameData, type LevelDef } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import { classStats, createCharacter, expTable, type Character } from '../../src/engine/player';
import { rollMonsterStats } from '../../src/engine/monster';
import { chooseRegionMonsters, gridRooms, levelMonsterInfo, planLevel } from '../../src/engine/spawn';
import { Rng } from '../../src/engine/rng';
import { applyResistPenalty, CLASSIC_RESIST_PENALTY, diffColumn, difficultyRules, heroTitle } from '../../src/engine/difficulty';
import { makeSave, mergeDifficulty, parseSave, serializeSave, startActFor, summarize } from '../../src/engine/save';
import { hirelingInit } from '../../src/engine/hireling';
import { chestTcName } from '../../src/engine/objects';

const d = hasGameData ? describe : describe.skip;
let tables: GameTables;
let data: GameData;

beforeAll(() => {
  if (!hasGameData) return;
  tables = new GameTables(gameChain());
  data = buildGameData(gameChain(), tables);
});

function openMap(w = 60, h = 60): CollisionMap {
  const m = new CollisionMap(w, h);
  for (let x = 0; x < w; x++) {
    m.block(x, 0);
    m.block(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    m.block(0, y);
    m.block(w - 1, y);
  }
  return m;
}

function makeGame(difficulty: 0 | 1 | 2, extra: Partial<ConstructorParameters<typeof Game>[0]> = {}): Game {
  const cs = classStats(tables.table('charstats'), 'Barbarian');
  const levels: LevelDef[] = [
    { id: 'bloodmoor', map: openMap(), inTown: false, exits: [], levelNo: 2 },
    { id: 'town', map: openMap(), inTown: true, exits: [], levelNo: 1, portalSpot: { x: 40, y: 40 } },
  ];
  return new Game({
    map: levels[0]!.map, levels, seed: 5, data: withDifficulty(data, difficulty), difficulty,
    player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    character: createCharacter(cs), classStats: cs, expTable: expTable(tables.table('experience'), 'Barbarian'), ...extra,
  });
}

describe('난이도 표 칸 이름·저항 페널티·칭호 (순수)', () => {
  it('diffColumn: Normal 그대로, Nightmare "(N)", Hell "(H)"', () => {
    expect([0, 1, 2].map((x) => diffColumn('MonDen', x as 0 | 1 | 2))).toEqual(['MonDen', 'MonDen(N)', 'MonDen(H)']);
  });
  it('클래식 저항 페널티 0 / −20 / −50 (표 ResistPenalty −40/−100 은 확장팩 전용)', () => {
    expect(CLASSIC_RESIST_PENALTY).toEqual([0, -20, -50]);
    expect(difficultyRules(undefined, 2).playerResistPenalty).toBe(-50);
    // 양수면 상한, 음수면 −100 까지
    expect(applyResistPenalty(100, 75, -50)).toBe(50);
    expect(applyResistPenalty(40, 75, -20)).toBe(20);
    expect(applyResistPenalty(0, 75, -50)).toBe(-50);
    expect(applyResistPenalty(-80, 75, -50)).toBe(-100);
    expect(applyResistPenalty(90, 75, 0)).toBe(75);
  });
  it('칭호: 진행 4 Sir/Dame, 8 Lord/Lady, 12 Baron/Baroness', () => {
    expect([0, 4, 8, 12].map((p) => heroTitle(false, p))).toEqual(['', 'Sir', 'Lord', 'Baron']);
    expect([4, 8, 12].map((p) => heroTitle(true, p))).toEqual(['Dame', 'Lady', 'Baroness']);
  });
});

d('몬스터 수치 (monstats (N)/(H) + MonLvl (N)/(H) + 클래식 보정)', () => {
  it('Blood Moor 좀비 Normal: 레벨 1, HP 7~12, 방어 5, 경험치 33, A1 1~3 명중 8 (보정 없음)', () => {
    const db = withDifficulty(data, 0).monsters;
    const t = db.get('zombie1');
    for (let seed = 1; seed < 30; seed++) {
      const s = rollMonsterStats(db, t, new Rng(seed));
      expect(s.maxHp).toBeGreaterThanOrEqual(7);
      expect(s.maxHp).toBeLessThanOrEqual(12);
    }
    const s = rollMonsterStats(db, t, new Rng(1));
    expect([s.level, s.defense, s.exp, s.a1.min, s.a1.max, s.a1.toHit]).toEqual([1, 5, 33, 1, 3, 8]);
  });

  it('Blood Moor 좀비 Nightmare: 표 레벨 36 으로 생명·방어·경험치, 보정 뒤 레벨 26 으로 피해·명중', () => {
    const db = withDifficulty(data, 1).monsters;
    const t = db.get('zombie1');
    expect([t.level, t.baseLevel]).toEqual([36, 1]);
    // HP = 525×105/100 = 551 ~ 525×150/100 = 787, × 1/2
    for (let seed = 1; seed < 30; seed++) {
      const s = rollMonsterStats(db, t, new Rng(seed));
      expect(s.maxHp).toBeGreaterThanOrEqual(551 / 2);
      expect(s.maxHp).toBeLessThanOrEqual(787 / 2);
    }
    const s = rollMonsterStats(db, t, new Rng(1));
    // 방어 449×80/100 = 359 → ×10/12 = 299, 경험치 2568×105/100 = 2696 → ×10/17 = 1585
    // A1: DM(N)[26] 23 × 60/100 = 13 → 10, 23 × 140/100 = 32 → 26, TH(N)[26] 558 × 105/100 = 585 → ×10/15 = 390
    expect([s.level, s.defense, s.exp, s.a1.min, s.a1.max, s.a1.toHit]).toEqual([26, 299, 1585, 10, 26, 390]);
  });

  it('Blood Moor 좀비 Hell: 표 레벨 67, 보정 뒤 레벨 51', () => {
    const db = withDifficulty(data, 2).monsters;
    const t = db.get('zombie1');
    // HP 3084×105/100 = 3238 ~ 3084×150/100 = 4626, × 1/2
    for (let seed = 1; seed < 30; seed++) {
      const s = rollMonsterStats(db, t, new Rng(seed));
      expect(s.maxHp).toBeGreaterThanOrEqual(3238 / 2);
      expect(s.maxHp).toBeLessThanOrEqual(4626 / 2);
    }
    const s = rollMonsterStats(db, t, new Rng(1));
    // 방어 1134×80/100 = 907 → 755, 경험치 26733×105/100 = 28069 → ×10/26 = 10795
    // A1: DM(H)[51] 59 × 60/100 = 35 → 29, 59 × 140/100 = 82 → 68, TH(H)[51] 2116 × 105/100 = 2221 → 1480
    expect([s.level, s.defense, s.exp, s.a1.min, s.a1.max, s.a1.toHit]).toEqual([51, 755, 10795, 29, 68, 1480]);
  });

  it('저항·TC·AI 인자는 난이도 칸 (zombie1 ResPo 50/75/75, aip1 30/40)', () => {
    const [n, nm, h] = ([0, 1, 2] as const).map((x) => withDifficulty(data, x).monsters.get('zombie1'));
    expect([n!.resist.po, nm!.resist.po, h!.resist.po]).toEqual([50, 75, 75]);
    expect([n!.treasure[0], nm!.treasure[0], h!.treasure[0]]).toEqual(['Act 1 H2H A', 'Act 1 (N) H2H A', 'Act 1 (H) H2H A']);
    expect([n!.aiParams[0], nm!.aiParams[0]]).toEqual([30, 40]);
  });

  it('선한 몬스터(용병·소환수 Align 1)·레벨을 준 소환수는 클래식 보정 없음', () => {
    const db = withDifficulty(data, 2).monsters;
    const t = db.get('necroskeleton');
    expect(t.align).toBe(1);
    expect(rollMonsterStats(db, t, new Rng(1), 10).level).toBe(10);
    expect(rollMonsterStats(db, t, new Rng(1)).level).toBe(t.level);
  });

  it('Game: Nightmare 게임에서 스폰한 좀비는 레벨 26 (Normal 1)', () => {
    const gn = makeGame(0), g = makeGame(1);
    expect(gn.spawnMonster('zombie1', 30.5, 30.5).stats.level).toBe(1);
    const m = g.spawnMonster('zombie1', 30.5, 30.5);
    expect(m.stats.level).toBe(26);
    expect(m.hp).toBeGreaterThan(250);
  });
});

d('레벨 몬스터 (levels.txt 난이도 칸)', () => {
  it('Blood Moor 지역 레벨 1 / 26 / 51, MonDen 520, 보스 최소·최대 0·0 / 4·5 / 7·9', () => {
    const rows = tables.table('Levels');
    const info = ([0, 1, 2] as const).map((x) => levelMonsterInfo(rows, 'Blood Moor', x));
    expect(info.map((i) => i.monLvl)).toEqual([1, 26, 51]);
    expect(info.map((i) => i.monDen)).toEqual([520, 520, 520]);
    expect(info.map((i) => [i.bossMin, i.bossMax])).toEqual([[0, 0], [4, 5], [7, 9]]);
    expect(info[1]!.spawnPool).toEqual(['zombie1', 'fallen1', 'quillrat1']);
    // 오브젝트(상자) 레벨도 같은 칸, 상자 TC 는 "Act 1 (N) Chest A"
    expect(([0, 1, 2] as const).map((x) => withDifficulty(data, x).objects!.levels.get(2)!.monLvl)).toEqual([1, 26, 51]);
    expect(([0, 1, 2] as const).map((x) => chestTcName(withDifficulty(data, x).objects!, 2))).toEqual(['Act 1 Chest A', 'Act 1 (N) Chest A', 'Act 1 (H) Chest A']);
  });

  it('Nightmare/Hell 은 nmon 목록에서 레벨 몬스터를 고른다 (합성 행: mon=zombie1, nmon=skeleton1)', () => {
    const row = { Name: 'Test', LevelName: 'Test', Id: '999', MonDen: '1000', 'MonDen(N)': '2000', NumMon: '1', mon1: 'zombie1', nmon1: 'skeleton1', umon1: 'zombie1', MonLvl1: '1', MonLvl2: '26', MonLvl3: '51' };
    const n = levelMonsterInfo([row], 'Test', 0), nm = levelMonsterInfo([row], 'Test', 1);
    expect(chooseRegionMonsters(n, data.monsters, new Rng(1))).toEqual(['zombie1']);
    expect(chooseRegionMonsters(nm, data.monsters, new Rng(1))).toEqual(['skeleton1']);
    expect([n.monDen, nm.monDen]).toEqual([1000, 2000]);
    // 계열 선택(D2Common_11063)은 난이도와 무관하게 Normal 목록
    expect(nm.pool).toEqual(['zombie1']);
  });

  it('Nightmare 보스는 umon 이 아닌 레벨 몬스터 목록에서 (umon 이 없어도 나온다)', () => {
    const row = { Name: 'T2', LevelName: 'T2', Id: '998', MonDen: '8000', 'MonDen(N)': '8000', 'MonUMin(N)': '4', 'MonUMax(N)': '5', NumMon: '1', mon1: 'zombie1', nmon1: 'zombie1' };
    const nm = levelMonsterInfo([row], 'T2', 1), n = levelMonsterInfo([row], 'T2', 0);
    const map = new CollisionMap(200, 200);
    const nmPlan = planLevel(nm, gridRooms(200, 200), map, withDifficulty(data, 1).monsters, new Rng(3));
    const bosses = nmPlan.requests.filter((r) => r.boss);
    expect(bosses.length).toBeGreaterThanOrEqual(4);
    expect(bosses.every((b) => b.typeId === 'zombie1')).toBe(true);
    expect(planLevel(n, gridRooms(200, 200), map, data.monsters, new Rng(3)).requests.some((r) => r.boss)).toBe(false);
  });
});

d('TC (난이도별 TreasureClass / SuperUniques TC(N))', () => {
  it('Andariel TC: Andariel / Andariel (N) / Andariel (H), 퀘스트 TC Andarielq (N)…', () => {
    const t = ([0, 1, 2] as const).map((x) => withDifficulty(data, x).monsters.get('andariel').treasure);
    expect(t.map((x) => x[0])).toEqual(['Andariel', 'Andariel (N)', 'Andariel (H)']);
    expect(t.map((x) => x[3])).toEqual(['Andarielq', 'Andarielq (N)', 'Andarielq (H)']);
    for (const x of t) expect(data.treasure.get(x[0]!)).toBeTruthy();
    // 클래식 레벨 = 25 × 난이도 + 12 (TC 업그레이드·아이템 레벨)
    expect(([0, 1, 2] as const).map((x) => rollMonsterStats(withDifficulty(data, x).monsters, withDifficulty(data, x).monsters.get('andariel'), new Rng(1)).level)).toEqual([12, 37, 62]);
  });

  it('슈퍼 유니크 Bishibosh TC: Act 1 Super A / (N) / (H)', () => {
    expect(([0, 1, 2] as const).map((x) => withDifficulty(data, x).uniques!.superUnique('Bishibosh')!.tc)).toEqual(['Act 1 Super A', 'Act 1 (N) Super A', 'Act 1 (H) Super A']);
  });
});

d('플레이어 (저항 페널티·사망 경험치)', () => {
  it('맨몸 저항: Normal 0 / Nightmare −20 / Hell −50 (캐릭터 창·피해 계산 모두), 마법 저항은 페널티 없음', () => {
    const r = ([0, 1, 2] as const).map((x) => makeGame(x));
    expect(r.map((g) => g.playerResist('fireresist'))).toEqual([0, -20, -50]);
    expect(r.map((g) => g.derived()?.res.co)).toEqual([0, -20, -50]);
    expect(r[2]!.playerResist('magicresist')).toBe(0);
  });

  it('사망 경험치 벌칙: Nightmare 5 % / Hell 10 % (레벨 30 구간 829810), 레벨 아래로는 안 내려감', () => {
    const die = (g: Game) => (g as unknown as { playerDie(): void }).playerDie();
    const run = (diff: 0 | 1 | 2, exp: number) => {
      const g = makeGame(diff);
      const c = g.character as Character;
      c.level = 30;
      c.experience = exp;
      die(g);
      return c.experience;
    };
    expect(run(0, 5_000_000)).toBe(5_000_000);
    expect(run(1, 5_000_000)).toBe(5_000_000 - 41490);
    expect(run(2, 5_000_000)).toBe(5_000_000 - 82981);
    expect(run(2, 4_670_000)).toBe(4663553 + 1);
  });

  it('사망 골드 벌칙은 난이도와 무관 (레벨 20 이상 20 %)', () => {
    const g = makeGame(2, { gold: 1000, stashGold: 0 });
    (g.character as Character).level = 30;
    (g as unknown as { playerDie(): void }).playerDie();
    expect(g.gold).toBe(0);
  });

  it('흡수·냉기·저주 나눗수와 몬스터 스킬 보너스는 난이도 행', () => {
    const g = makeGame(2);
    expect([g.rules.lifeStealDivisor, g.rules.manaStealDivisor, g.rules.monsterColdDivisor, g.rules.monsterFreezeDivisor, g.rules.monsterSkillBonus, g.rules.hireableBossDamagePercent]).toEqual([3, 3, 4, 4, 7, 25]);
  });
});

d('난이도별 기록 (웨이포인트·퀘스트·시작 막)', () => {
  const ch: Character = { cls: 'Sorceress', level: 40, experience: 1e7, str: 30, dex: 30, vit: 80, ene: 60, statPoints: 0, skillPoints: 0, maxLife: 300, maxMana: 200, maxStamina: 200, life: 300, mana: 200, stamina: 200, skills: {}, leftSkill: 0, rightSkill: 0 };

  it('Nightmare 로 시작하면 Nightmare 웨이포인트, 저장하면 Nightmare 칸만 바뀐다', () => {
    const s0 = makeSave('Wp', ch, 0, { inventory: [], equipment: {}, act: 3, difficulty: 0, difficultyUnlocked: 1, waypointsByDiff: [[0, 1, 2, 9], [0, 5]], questFlagsByDiff: [[1], [2]] });
    const g = makeGame(1, { waypoints: s0.waypointsByDiff[1] });
    expect(g.waypoints.has(5)).toBe(true);
    expect(g.waypoints.has(1)).toBe(false);
    g.waypoints.activate(6);
    const byDiff = mergeDifficulty(s0, 1, g.waypoints.list(), null);
    const s1 = parseSave(serializeSave(makeSave('Wp', ch, 0, { inventory: [], equipment: {}, act: 0, difficulty: 1, difficultyUnlocked: 1, actByDiff: s0.actByDiff, ...byDiff })));
    expect(s1.waypointsByDiff[0]).toEqual([0, 1, 2, 9]);
    expect(s1.waypointsByDiff[1]).toEqual([0, 5, 6]);
    expect(s1.questFlagsByDiff[0]).toEqual([1]);
    // 시작 막: Normal 은 Act 4 (3), Nightmare 는 Act 1 (0) — 원작 nTown[난이도]
    expect(s1.actByDiff).toEqual([3, 0, 0]);
    expect([startActFor(s1, 0), startActFor(s1, 1), startActFor(s1, 2)]).toEqual([3, 0, 0]);
  });

  it('예전 저장 (actByDiff 없음): 마지막 난이도 칸만 act', () => {
    const s = makeSave('Old', ch, 0, { inventory: [], equipment: {}, act: 2, difficulty: 1, difficultyUnlocked: 1 });
    const raw = JSON.parse(serializeSave(s)) as Record<string, unknown>;
    delete raw.actByDiff;
    expect(parseSave(JSON.stringify(raw)).actByDiff).toEqual([0, 2, 0]);
  });

  it('캐릭터 선택 요약: 해금 난이도와 칭호 (Sorceress Normal 완료 = Dame)', () => {
    const s = makeSave('Sorc', ch, 0, { inventory: [], equipment: {}, difficultyUnlocked: 1 });
    expect(summarize(s)).toMatchObject({ difficultyUnlocked: 1, title: 'Dame' });
    expect(summarize(makeSave('Sorc', ch, 0, { inventory: [], equipment: {}, difficultyUnlocked: 2, progression: 12 }))).toMatchObject({ title: 'Baroness' });
  });
});

d('용병 (hireling.txt Difficulty 칸)', () => {
  it('Act 1 Rogue 행 레벨: Normal 3 / Nightmare 25 / Hell 49, 고용 후보 레벨은 행 레벨 ~ +4', () => {
    const db = data.hirelings!;
    expect(([0, 1, 2] as const).map((x) => db.byAct(0, x)?.level)).toEqual([3, 25, 49]);
    expect(([0, 1, 2] as const).map((x) => db.byAct(0, x)?.difficulty)).toEqual([1, 2, 3]);
    for (let seed = 1; seed < 20; seed++) {
      const nm = hirelingInit(db, seed, 45, 0, 1)!, h = hirelingInit(db, seed, 75, 0, 2)!;
      expect(nm.level).toBeGreaterThanOrEqual(25);
      expect(nm.level).toBeLessThanOrEqual(29);
      expect(h.level).toBeGreaterThanOrEqual(49);
      expect(h.level).toBeLessThanOrEqual(53);
    }
  });
});
