// 캐릭터 저장/불러오기 (순수 직렬화). 저장소(IndexedDB)는 브라우저 쪽 어댑터가 담당.
// 원작 싱글플레이 동작: 저장 대상은 캐릭터(스탯·레벨·경험치·아이템·골드), 게임을 새로 시작할 때마다 맵이 새로 생성되고
// 캐릭터는 마을에서 시작한다. 저장 형식은 원작 .d2s 가 아닌 JSON (원작 .d2s 호환은 범위 밖).
import type { Character, ClassName } from './player';
import type { ItemInstance } from './treasure';

export const SAVE_VERSION = 1;

export interface CharacterSave {
  version: number;
  name: string;
  character: Character;
  gold: number;
  inventory: ItemInstance[];
  equipment: Record<string, ItemInstance>;
  savedAt: number;
}

export interface HeroSummary { name: string; cls: ClassName; level: number; savedAt: number }

export function makeSave(name: string, character: Character, gold: number, inventory: ItemInstance[], equipment: Record<string, ItemInstance>, now = Date.now()): CharacterSave {
  return {
    version: SAVE_VERSION,
    name,
    character: structuredClone(character),
    gold,
    inventory: structuredClone(inventory),
    equipment: structuredClone(equipment),
    savedAt: now,
  };
}

export function serializeSave(s: CharacterSave): string {
  return JSON.stringify(s);
}

export function parseSave(text: string): CharacterSave {
  const s = JSON.parse(text) as Partial<CharacterSave>;
  if (s.version !== SAVE_VERSION) throw new Error(`save version mismatch: ${s.version}`);
  if (!s.name || !s.character || typeof s.gold !== 'number' || !Array.isArray(s.inventory) || !s.equipment) throw new Error('save corrupt');
  // Phase 5 에 만든 저장(스킬 필드 없음) 호환
  s.character.skills ??= {};
  s.character.leftSkill ??= 0;
  s.character.rightSkill ??= 0;
  return s as CharacterSave;
}

export const summarize = (s: CharacterSave): HeroSummary => ({ name: s.name, cls: s.character.cls, level: s.character.level, savedAt: s.savedAt });

/** 캐릭터 이름 규칙 근사(원작 세부 규칙 미확인): 2~15자, 영문자와 _ - 만, 첫 글자는 영문자 */
export function validHeroName(name: string): boolean {
  return /^[A-Za-z][A-Za-z_-]{1,14}$/.test(name);
}
