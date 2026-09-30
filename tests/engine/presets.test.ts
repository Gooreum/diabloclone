import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameTables } from '../../src/data/tables';
import { buildGameData } from '../../src/data/gamedata';
import type { GameData } from '../../src/engine/game';
import type { ItemGen } from '../../src/engine/itemgen';
import { beltBoxes, canEquip, type BodyLoc } from '../../src/engine/inventory';
import { classStats, expTable } from '../../src/engine/player';
import { computeDerived } from '../../src/engine/charstats';
import { blockChance } from '../../src/engine/combat';
import { CLASS_CODE } from '../../src/engine/skills/db';
import { parseSave, type CharacterSave } from '../../src/engine/save';
import { PRESETS, PRESET_LEVEL, PRESET_STAT, buildPreset, classSkills } from '../../src/engine/presets';
import { QFLAG } from '../../src/engine/quests/record';
import { QUALITY } from '../../src/engine/treasure';
import { gameChain, hasGameData } from '../support/gamedata';

// 개발용 99레벨 프리셋 검증 (강화판: 네 스탯 1000, 스킬 30개 모두 20 — 원작 포인트 제한 밖, 사용자 요청): 스킬 요구 레벨·선행, 장비 요구치, 클래식 전용, 블록 75%, 소지품, 생성기 재현.
// 실패 메시지는 "[프리셋] <id>: <항목>" 으로 어느 직업·항목인지 보인다.
describe.skipIf(!hasGameData)('개발용 프리셋 캐릭터 (99레벨, 클래식)', () => {
  let data: GameData, gen: ItemGen, tables: GameTables;
  const saves = new Map<string, CharacterSave>();
  beforeAll(() => {
    tables = new GameTables(gameChain());
    data = buildGameData(gameChain(), tables);
    gen = data.treasure.gen as ItemGen;
    for (const p of PRESETS) saves.set(p.id, parseSave(readFileSync(resolve(__dirname, '../../src/presets', `${p.id}.json`), 'utf8')));
  });
  const version = (table: string, key: string, value: string) => Number(tables.row(table, key, value)?.version ?? 0) || 0;

  for (const p of PRESETS) {
    const tag = `[프리셋] ${p.id}`;

    it(`${p.id}: 레벨 99 · 경험치 = experience.txt 레벨 98 · 네 스탯 1000 · 생명 = 원작 공식 + 퀘스트 60`, () => {
      const s = saves.get(p.id)!;
      const ch = s.character;
      const cs = classStats(tables.table('charstats'), p.cls);
      expect(ch.cls, `${tag}: 직업`).toBe(p.cls);
      expect(ch.level, `${tag}: 레벨`).toBe(PRESET_LEVEL);
      expect(ch.experience, `${tag}: 경험치`).toBe(expTable(tables.table('experience'), p.cls).threshold(PRESET_LEVEL - 1));
      expect([ch.str, ch.dex, ch.vit, ch.ene], `${tag}: 네 스탯`).toEqual([PRESET_STAT, PRESET_STAT, PRESET_STAT, PRESET_STAT]);
      expect(ch.statPoints, `${tag}: 남은 스탯 포인트`).toBe(0);
      const life = cs.vit + cs.hpadd + (98 * cs.lifePerLevel) / 4 + ((ch.vit - cs.vit) * cs.lifePerVit) / 4 + 60;
      expect(ch.maxLife, `${tag}: 기본 최대 생명`).toBeCloseTo(life, 6);
    });

    it(`${p.id}: 스킬 30개 모두 20 (합 600), 요구 레벨·선행 스킬 충족`, () => {
      const ch = saves.get(p.id)!.character;
      const list = classSkills(data, p.cls);
      expect(list.length, `${tag}: 클래스 스킬 수`).toBe(30);
      expect(Object.values(ch.skills).reduce((a, b) => a + b, 0), `${tag}: 스킬 합`).toBe(600);
      expect(ch.skillPoints, `${tag}: 남은 스킬 포인트`).toBe(0);
      for (const s of list) {
        const pts = ch.skills[s.id] ?? 0;
        expect(pts, `${tag}: ${s.name} 포인트`).toBe(s.maxLvl || 20);
        expect(pts, `${tag}: ${s.name} 최대 ${s.maxLvl}`).toBeLessThanOrEqual(s.maxLvl || 20);
        expect(s.reqLevel, `${tag}: ${s.name} 요구 레벨`).toBeLessThanOrEqual(ch.level);
        for (const r of s.reqSkills) expect(ch.skills[data.skills!.byNameOf(r)!.id] ?? 0, `${tag}: ${s.name} 선행 ${r}`).toBeGreaterThan(0);
      }
      expect(Object.keys(ch.skills).every((id) => data.skills!.byId.get(Number(id))?.charclass === CLASS_CODE[p.cls]), `${tag}: 다른 직업 스킬 없음`).toBe(true);
    });

    it(`${p.id}: 장비마다 장착 가능 (다른 장비·세트 보너스로 본 힘·민첩) · 클래식 전용 · 직업 제한 없음`, () => {
      const s = saves.get(p.id)!;
      const ch = s.character;
      const cs = classStats(tables.table('charstats'), p.cls);
      expect(Object.keys(s.equipment).sort(), `${tag}: 장비 칸`).toEqual(Object.keys(p.gear).sort());
      for (const [slot, it] of Object.entries(s.equipment)) {
        const base = data.items.base(it.code)!;
        const rest = { ...s.equipment };
        delete rest[slot];
        const d = computeDerived(ch, cs, rest, data.items, gen);
        const err = canEquip({ items: data.items, cls: p.cls, level: ch.level, str: d.str, dex: d.dex, equipment: rest }, it, slot as BodyLoc);
        expect(err, `${tag}: ${slot} ${it.code} 장착`).toBeNull();
        expect(base.version, `${tag}: ${slot} 베이스 클래식`).toBeLessThan(100);
        // 무기·방어구는 노멀 등급 (익셉셔널·엘리트 아님). 반지·목걸이는 등급 칸이 비어 있다
        if (base.normCode) expect(base.code, `${tag}: ${slot} 노멀 등급 베이스`).toBe(base.normCode);
        const cls = [...data.items.typeChain(base.type)].map((t) => data.items.types.get(t)?.classCode).find(Boolean);
        expect(!cls || cls === CLASS_CODE[p.cls], `${tag}: ${slot} 직업 제한`).toBe(true);
        expect(it.identified, `${tag}: ${slot} 감정됨`).toBe(true);
        if (it.uniqueIdx !== undefined) {
          expect(version('UniqueItems', 'index', gen.uniques[it.uniqueIdx]!.name), `${tag}: ${slot} 유니크 클래식`).toBeLessThan(100);
          expect(gen.uniques[it.uniqueIdx]!.enabled, `${tag}: ${slot} 유니크 사용 가능`).toBe(true);
        }
        if (it.setIdx !== undefined) expect(version('Sets', 'index', gen.setItems[it.setIdx]!.set), `${tag}: ${slot} 세트 클래식`).toBeLessThan(100);
        if (it.quality === QUALITY.RARE) {
          expect(it.prefixes.length, `${tag}: ${slot} 접두 ≤ 3`).toBeLessThanOrEqual(3);
          expect(it.suffixes.length, `${tag}: ${slot} 접미 ≤ 3`).toBeLessThanOrEqual(3);
          const alvl = gen.affixLevel(it.ilvl, base);
          for (const a of [...it.prefixes.map((i) => gen.prefixes[i]!), ...it.suffixes.map((i) => gen.suffixes[i]!)]) {
            // 자기 자신을 뺀 나머지 접사 기준으로 group 겹침·타입·alvl·클래식(frequency > 0) 확인
            const others = { ...it, prefixes: it.prefixes.filter((i) => !(a.prefix && i === a.idx)), suffixes: it.suffixes.filter((i) => !(!a.prefix && i === a.idx)) };
            expect(gen.rareAffixAllowed(a, base, others, alvl), `${tag}: ${slot} 접사 ${a.name} 허용`).toBe(true);
          }
        }
      }
    });

    it(`${p.id}: 벨트 전부 풀 리쥬 · 인벤토리 TP·ID 책과 풀 리쥬 · Hell 까지 끝낸 기록`, () => {
      const s = saves.get(p.id)!;
      expect(s.belt.length, `${tag}: 벨트 칸`).toBe(beltBoxes(data.items, s.equipment.belt));
      expect(s.belt.every((b) => b?.code === 'rvl'), `${tag}: 벨트 풀 리쥬`).toBe(true);
      const codes = s.inventory.map((q) => q.item.code);
      expect(codes, `${tag}: 인벤토리`).toEqual(expect.arrayContaining(['tbk', 'ibk', 'rvl']));
      expect(s.difficultyUnlocked, `${tag}: Hell 열림`).toBe(2);
      expect(s.difficulty, `${tag}: Hell 에서 시작`).toBe(2);
      expect(s.progression, `${tag}: 진행 값`).toBe(12);
      for (const words of s.questFlagsByDiff) for (let q = 0; q <= 28; q++) expect(((words?.[q] ?? 0) >> QFLAG.REWARDGRANTED) & 1, `${tag}: 퀘스트 워드 ${q}`).toBe(1);
      const ids = [...Object.values(s.equipment), ...s.inventory.map((q) => q.item), ...s.belt].map((it) => it!.id);
      expect(new Set(ids).size, `${tag}: 아이템 번호 겹침 없음`).toBe(ids.length);
    });

    it(`${p.id}: 파일 = 생성기 결과 (표에서 다시 만든 값과 같다 — 가변 옵션 최대값)`, () => {
      const again = buildPreset(p, data, { charstats: tables.table('charstats'), experience: tables.table('experience') }).save;
      expect(JSON.parse(JSON.stringify(saves.get(p.id))), `${tag}: 재생성 일치`).toEqual(JSON.parse(JSON.stringify(parseSave(JSON.stringify(again)))));
    });
  }

  it('팔라딘: 민첩 1000 으로 막기 75% (원작 상한)', () => {
    const s = saves.get('paladin')!;
    const cs = classStats(tables.table('charstats'), 'Paladin');
    const d = computeDerived(s.character, cs, s.equipment, data.items, gen);
    expect(blockChance(d.block, cs.blockFactor, d.dex, 99)).toBe(75);
  });

  it('지정 유니크는 가변 옵션 최대값: The Ward 저항 50, Eye of Etlich 생명 흡수 7, Steeldriver 대미지 250%', () => {
    const stat = (id: string, slot: string, name: string) => saves.get(id)!.equipment[slot]!.stats.filter((x) => x.stat === name).reduce((a, x) => a + x.value, 0);
    expect(stat('paladin', 'larm', 'fireresist')).toBe(50);
    expect(stat('sorceress', 'neck', 'lifedrainmindam')).toBe(7);
    expect(stat('barbarian', 'rarm', 'item_maxdamage_percent')).toBe(250);
  });
});
