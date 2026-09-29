import { describe, expect, it } from 'vitest';
import { makeSave, parseSave, serializeSave, summarize, validHeroName } from '../../src/engine/save';
import type { Character } from '../../src/engine/player';
import { QUALITY, type ItemInstance } from '../../src/engine/treasure';

const ch: Character = { cls: 'Barbarian', level: 3, experience: 1600, str: 35, dex: 20, vit: 30, ene: 10, statPoints: 0, skillPoints: 2, maxLife: 79, maxMana: 12, maxStamina: 99, life: 40, mana: 5, stamina: 80, skills: { 126: 2 }, leftSkill: 126, rightSkill: 0 };
const item = (id: number, code: string): ItemInstance => ({ id, code, quality: QUALITY.NORMAL, ilvl: 1, identified: true, quantity: 1, durability: 20, maxDurability: 28, defense: 0, invW: 1, invH: 1, levelReq: 0, prefixes: [], suffixes: [], sockets: 0, socketed: [], stats: [] });

describe('저장/불러오기', () => {
  it('Phase 5 저장(스킬 필드 없음)도 불러오면 빈 스킬·Attack 으로 채운다', () => {
    const old = JSON.parse(serializeSave(makeSave('Old', ch, 0, { inventory: [], equipment: {} }, 1))) as { character: Record<string, unknown> };
    delete old.character.skills;
    delete old.character.leftSkill;
    delete old.character.rightSkill;
    const back = parseSave(JSON.stringify(old));
    expect([back.character.skills, back.character.leftSkill, back.character.rightSkill]).toEqual([{}, 0, 0]);
  });
  it('직렬화 왕복 후 스탯·레벨·경험치·골드·인벤토리·장착이 동일', () => {
    const s = makeSave('Conan', ch, 123, { inventory: [{ item: item(5, 'isc'), x: 3, y: 1 }], belt: [item(6, 'hp1')], stash: [{ item: item(7, 'cap'), x: 0, y: 0 }], equipment: { rarm: item(1, 'hax') }, stashGold: 50 }, 1000);
    const back = parseSave(serializeSave(s));
    expect(back).toEqual(s);
    expect(back.inventory[0]).toMatchObject({ x: 3, y: 1 });
    expect(summarize(back)).toEqual({ name: 'Conan', cls: 'Barbarian', level: 3, savedAt: 1000 });
  });
  it('저장 시점의 스냅샷이다 (원본 객체를 이후에 바꿔도 저장본은 그대로)', () => {
    const c = structuredClone(ch);
    const s = makeSave('Conan', c, 0, { inventory: [], equipment: {} });
    c.level = 50;
    expect(s.character.level).toBe(3);
  });
  it('버전 1 저장(인벤토리 목록, affixesPending)은 자동 배치 표시와 새 아이템 필드로 바뀐다', () => {
    const v1 = { version: 1, name: 'Old', character: ch, gold: 5, inventory: [{ id: 9, code: 'hp1', quality: 2, ilvl: 1, identified: true, quantity: 1, durability: 0, maxDurability: 0, defense: 0, affixesPending: false }], equipment: {}, savedAt: 1 };
    const back = parseSave(JSON.stringify(v1));
    expect(back.version).toBe(2);
    expect(back.inventory[0]).toMatchObject({ x: -1, y: -1, item: { id: 9, prefixes: [], stats: [], sockets: 0 } });
    expect('affixesPending' in back.inventory[0]!.item).toBe(false);
  });
  it('버전이 다르거나 손상된 저장은 거부', () => {
    expect(() => parseSave('{"version":99}')).toThrow(/version/);
    expect(() => parseSave('{"version":2,"name":"x"}')).toThrow(/corrupt/);
  });
  it('이름 규칙', () => {
    expect(validHeroName('Conan')).toBe(true);
    expect(validHeroName('a')).toBe(false);
    expect(validHeroName('1abc')).toBe(false);
    expect(validHeroName('Bad Name')).toBe(false);
  });
});
