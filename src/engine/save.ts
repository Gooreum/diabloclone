// 캐릭터 저장/불러오기 (순수 직렬화). 저장소(IndexedDB)는 브라우저 쪽 어댑터가 담당.
// 원작 싱글플레이 동작: 저장 대상은 캐릭터(스탯·레벨·경험치·아이템·골드), 게임을 새로 시작할 때마다 맵이 새로 생성되고
// 캐릭터는 마을에서 시작한다. 저장 형식은 원작 .d2s 가 아닌 JSON (원작 .d2s 호환은 범위 밖).
// 버전 2: 인벤토리 격자 위치·창고·벨트를 저장 (버전 1 은 불러올 때 자동 배치)
import type { Character, ClassName } from './player';
import type { ItemInstance } from './treasure';
import type { Placed } from './inventory';

export const SAVE_VERSION = 2;

export interface CharacterSave {
  version: number;
  name: string;
  character: Character;
  gold: number;
  /** 인벤토리 격자 (x < 0 이면 불러올 때 빈 자리에 자동 배치 — 버전 1 호환) */
  inventory: Placed[];
  stash: Placed[];
  belt: (ItemInstance | null)[];
  equipment: Record<string, ItemInstance>;
  /** 창고 골드 */
  stashGold: number;
  savedAt: number;
}

export interface HeroSummary { name: string; cls: ClassName; level: number; savedAt: number }

export interface SaveItems {
  inventory: Placed[];
  stash?: Placed[];
  belt?: (ItemInstance | null)[];
  equipment: Record<string, ItemInstance>;
  stashGold?: number;
}

export function makeSave(name: string, character: Character, gold: number, items: SaveItems, now = Date.now()): CharacterSave {
  return {
    version: SAVE_VERSION,
    name,
    character: structuredClone(character),
    gold,
    inventory: structuredClone(items.inventory),
    stash: structuredClone(items.stash ?? []),
    belt: structuredClone(items.belt ?? []),
    equipment: structuredClone(items.equipment),
    stashGold: items.stashGold ?? 0,
    savedAt: now,
  };
}

export function serializeSave(s: CharacterSave): string {
  return JSON.stringify(s);
}

/** 예전 아이템(필드 없음)을 현재 형식으로 */
export function normalizeItem(it: ItemInstance): ItemInstance {
  const x = it as Partial<ItemInstance> & ItemInstance;
  x.invW ??= 1;
  x.invH ??= 1;
  x.levelReq ??= 0;
  x.prefixes ??= [];
  x.suffixes ??= [];
  x.sockets ??= 0;
  x.socketed ??= [];
  x.stats ??= [];
  delete (x as { affixesPending?: boolean }).affixesPending;
  return x;
}

export function parseSave(text: string): CharacterSave {
  const s = JSON.parse(text) as Partial<CharacterSave> & { inventory?: unknown };
  if (s.version !== 1 && s.version !== SAVE_VERSION) throw new Error(`save version mismatch: ${s.version}`);
  if (!s.name || !s.character || typeof s.gold !== 'number' || !Array.isArray(s.inventory) || !s.equipment) throw new Error('save corrupt');
  // 버전 1: 인벤토리는 아이템 목록 → 자동 배치 표시(x = −1)
  if (s.version === 1) {
    s.inventory = (s.inventory as unknown as ItemInstance[]).map((item) => ({ item, x: -1, y: -1 }));
    s.stash = [];
    s.belt = [];
    s.stashGold = 0;
    s.version = SAVE_VERSION;
  }
  // Phase 5 에 만든 저장(스킬 필드 없음) 호환
  s.character.skills ??= {};
  s.character.leftSkill ??= 0;
  s.character.rightSkill ??= 0;
  const inv = s.inventory as Placed[];
  for (const p of inv) normalizeItem(p.item);
  for (const p of s.stash ?? []) normalizeItem(p.item);
  for (const it of s.belt ?? []) if (it) normalizeItem(it);
  for (const it of Object.values(s.equipment)) normalizeItem(it);
  s.stash ??= [];
  s.belt ??= [];
  s.stashGold ??= 0;
  return s as CharacterSave;
}

export const summarize = (s: CharacterSave): HeroSummary => ({ name: s.name, cls: s.character.cls, level: s.character.level, savedAt: s.savedAt });

/** 캐릭터 이름 규칙 근사(원작 세부 규칙 미확인): 2~15자, 영문자와 _ - 만, 첫 글자는 영문자 */
export function validHeroName(name: string): boolean {
  return /^[A-Za-z][A-Za-z_-]{1,14}$/.test(name);
}
