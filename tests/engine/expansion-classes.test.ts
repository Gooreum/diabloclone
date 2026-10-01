// 확장팩 직업 드루이드·어쌔신 (원작 LoD 1.14d): charstats 기본값·시작 템, 직업 표, 물약 배율, 확장팩 칭호, 직업 번호 문자열.
// 확장팩 MPQ 체인 (game-data/lod/patch_d2 + d2exp) 이 있어야 실행된다.
// 출처: 확장팩 charstats.txt (Expansion 구분 행 뒤 Druid·Assassin), D2MOO ITEMS_GetBonusLifeBasedOnClass / ManaBasedOnClass,
//       The Arreat Summit — Character Titles (확장팩 Slayer → Champion → Patriarch/Matriarch)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mpqOrder } from '../../src/assets/edition';
import { buildGameData } from '../../src/data/gamedata';
import { GameTables } from '../../src/data/tables';
import { MpqArchive, MpqChain } from '../../src/formats/mpq';
import { GAME_DATA } from '../support/gamedata';
import { CollisionMap } from '../../src/engine/collision';
import { Game, CLASS_TOKEN, type GameData } from '../../src/engine/game';
import { classStats, createCharacter, expTable, isExpansionClass, type ClassName } from '../../src/engine/player';
import { CLASS_CODE } from '../../src/engine/skills/db';
import { heroTitle } from '../../src/engine/difficulty';
import { ItemText } from '../../src/ui/itemtext';
import { Rng } from '../../src/engine/rng';
import { QUALITY } from '../../src/engine/treasure';

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

function game(cls: ClassName): Game {
  const cs = classStats(tables.table('charstats'), cls);
  const ch = createCharacter(cs);
  const g = new Game({
    map: new CollisionMap(60, 60), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
    seed: 3, data: lod, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), cls),
  });
  g.tick();
  return g;
}

describe.skipIf(!hasLod)('1단계 — 드루이드·어쌔신 직업 기반', () => {
  it('직업 표: 확장팩 직업, 그림 토큰 DZ·AI, 스킬 코드 dru·ass', () => {
    expect(isExpansionClass('Druid') && isExpansionClass('Assassin') && !isExpansionClass('Paladin')).toBe(true);
    expect([CLASS_TOKEN.Druid, CLASS_TOKEN.Assassin]).toEqual(['DZ', 'AI']);
    expect([CLASS_CODE.Druid, CLASS_CODE.Assassin]).toEqual(['dru', 'ass']);
  });

  it('드루이드 charstats: 15/20/20/25, 시작 템 곤봉(오른손)·버클러(왼손)·hp1×4, 스킬 트리 30개', () => {
    const cs = classStats(tables.table('charstats'), 'Druid');
    expect([cs.str, cs.dex, cs.ene, cs.vit]).toEqual([15, 20, 20, 25]);
    expect(cs.startItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'clb', loc: 'rarm' }), expect.objectContaining({ code: 'buc', loc: 'larm' }), expect.objectContaining({ code: 'hp1', count: 4 }),
    ]));
    expect(lod.skills!.classSkills('Druid')).toHaveLength(30);
  });

  it('어쌔신 charstats: 시작 템 카타르, BlockFactor 25, 스킬 트리 30개', () => {
    const cs = classStats(tables.table('charstats'), 'Assassin');
    expect(cs.startItems).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ktr', loc: 'rarm' })]));
    expect(cs.blockFactor).toBe(25);
    expect(lod.skills!.classSkills('Assassin')).toHaveLength(30);
  });

  it('물약: 어쌔신 생명 ×1.5, 드루이드 마나 ×2 (네크로맨서·바바리안과 비교)', () => {
    const drink = (cls: ClassName, code: string, stat: 'life' | 'mana') => {
      const g = game(cls), c = g.character!;
      const it = lod.treasure.createItem(lod.items.base(code)!, 1, new Rng(1), QUALITY.NORMAL, false);
      g.store.inv.items.push({ item: it, x: 0, y: 0 });
      c.life = 1;
      c.mana = 0;
      const before = c[stat];
      g.enqueue({ type: 'useItem', itemId: it.id });
      for (let i = 0; i < 400; i++) g.tick();
      return Math.round(c[stat] - before);
    };
    expect(drink('Assassin', 'hp1', 'life')).toBe(Math.round(drink('Necromancer', 'hp1', 'life') * 1.5));
    expect(drink('Druid', 'mp1', 'mana')).toBe(Math.round(drink('Barbarian', 'mp1', 'mana') * 2));
  });

  it('직업 번호: +스킬 문자열이 드루이드 5 · 어쌔신 6, 탭 스킬 문자열', () => {
    const t = new ItemText(lod.items, lod.treasure.gen!, (k) => tables.string(k), tables.table('ItemStatCost'), tables.table('charstats'), tables.table('skills'), tables.table('skilldesc'));
    expect(t.statLine('item_addclassskills', 1, 5)).toBe('+1 to Druid Skills');
    expect(t.statLine('item_addclassskills', 2, 6)).toBe('+2 to Assassin Skills');
    expect(t.statLine('item_addskill_tab', 2, 5 * 8)).toBe('+2 to Summoning Skills (Druid Only)');
    expect(t.statLine('item_addskill_tab', 1, 6 * 8)).toBe('+1 to Traps (Assassin Only)');
  });

  it('확장팩 칭호: 5막마다 Slayer → Champion → Matriarch/Patriarch', () => {
    expect(heroTitle(true, 4, false, true)).toBe('');
    expect(heroTitle(true, 5, false, true)).toBe('Slayer');
    expect(heroTitle(false, 10, false, true)).toBe('Champion');
    expect([heroTitle(true, 15, false, true), heroTitle(false, 15, false, true)]).toEqual(['Matriarch', 'Patriarch']);
    expect(heroTitle(true, 8)).toBe('Lady');
  });
});

describe.skipIf(!hasLod)('3단계 — 손톱·직업 전용 장착·무기 막기', () => {
  const item = (code: string) => lod.treasure.createItem(lod.items.base(code)!, 30, new Rng(2), QUALITY.NORMAL, false);
  const ctx = (cls: ClassName, equipment: Record<string, ReturnType<typeof item>> = {}) => ({ items: lod.items, cls, level: 99, str: 500, dex: 500, equipment });

  it('어쌔신: 손톱 두 개 장착 가능, 무기 클래스 HT2 · 손톱 하나 HT1 · 손톱 + 검은 쌍수 금지', async () => {
    const { canEquip, playerWclass } = await import('../../src/engine/inventory');
    const a = item('ktr'), b = item('wrb'), sword = item('ssd');
    expect(canEquip(ctx('Assassin', { rarm: a }), b, 'larm')).toBeNull();
    expect(playerWclass(lod.items, { rarm: a, larm: b })).toBe('HT2');
    expect(playerWclass(lod.items, { rarm: a })).toBe('HT1');
    expect(canEquip(ctx('Assassin', { rarm: a }), sword, 'larm')).toBe('dualwield');
  });

  it('직업 전용: 바바리안은 손톱, 소서리스는 드루이드 가죽 투구를 낄 수 없다 (드루이드는 된다)', async () => {
    const { canEquip } = await import('../../src/engine/inventory');
    expect(canEquip(ctx('Barbarian'), item('ktr'), 'rarm')).toBe('class');
    expect(canEquip(ctx('Sorceress'), item('dr1'), 'head')).toBe('class');
    expect(canEquip(ctx('Druid'), item('dr1'), 'head')).toBeNull();
  });

  it('Weapon Block: 손톱 두 개 + 스킬이면 근접 공격을 막고 BL, 손톱 하나면 막지 못한다', () => {
    const wb = lod.skills!.byNameOf('Weapon Block')!;
    const run = (two: boolean) => {
      const cs = classStats(tables.table('charstats'), 'Assassin');
      const ch = createCharacter(cs);
      ch.level = 30;
      ch.skills[wb.id] = 20;
      const g = new Game({
        map: new CollisionMap(60, 60), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
        seed: 3, data: lod, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Assassin'),
        equipment: two ? { rarm: item('ktr'), larm: item('wrb') } : { rarm: item('ktr') },
      });
      g.tick();
      const inner = g as unknown as { hitPlayer(a: { min: number; max: number; toHit: number }, l: number, h: number, m: boolean, at?: unknown): void; events: { type: string; weapon?: boolean }[]; player: { mode: string } };
      const z = g.spawnMonster('zombie1', 22.5, 20.5);
      let blocked = 0;
      for (let i = 0; i < 40; i++) {
        inner.events.length = 0;
        inner.hitPlayer({ min: 1, max: 1, toHit: 100000 }, 99, 0, false, z);
        if (inner.events.some((e) => e.type === 'playerBlocked' && e.weapon)) {
          blocked++;
          expect(inner.player.mode).toBe('BL');
        }
        for (let k = 0; k < 15; k++) g.tick();
      }
      return blocked;
    };
    expect(run(true)).toBeGreaterThan(5);
    expect(run(false)).toBe(0);
  });

  it('Claw Mastery: 손톱 마스터리 패시브 (passiveitype h2h) 가 걸린다', () => {
    const cm = lod.skills!.byNameOf('Claw Mastery')!;
    const cs = classStats(tables.table('charstats'), 'Assassin');
    const ch = createCharacter(cs);
    ch.skills[cm.id] = 5;
    const g = new Game({
      map: new CollisionMap(60, 60), player: { x: 20.5, y: 20.5, walkVelocity: cs.walkVelocity, runVelocity: cs.runVelocity },
      seed: 3, data: lod, character: ch, classStats: cs, expTable: expTable(tables.table('experience'), 'Assassin'), equipment: { rarm: item('ktr') },
    });
    const ps = (g as unknown as { passives(): { stat: string; itype?: string; value: number }[] }).passives();
    expect(ps.some((p) => p.stat === 'passive_mastery_melee_dmg' && p.itype === 'h2h' && p.value > 0)).toBe(true);
  });
});

describe.skipIf(!hasLod)('3단계 — 마스터리 스킬 설명 수치 (skillcalc math·madm·macr)', () => {
  it('Claw Mastery 1레벨: 명중 +30%, 피해 +35%, 치명 값 = passivecalc 와 같다', () => {
    const s = lod.skills!.byNameOf('Claw Mastery')!, calc = lod.skillCalc!;
    const o = { baseLevel: () => 1, skillLevel: () => 1, unitLevel: 1 };
    const p = (name: string) => calc.eval(s, { k: 'param', name } as never, 1, o);
    expect([p('math'), p('madm')]).toEqual([30, 35]);
    expect(p('macr')).toBe(calc.eval(s, s.passiveStats[2]!.calc, 1, o));
  });
});
