// 캐릭터 저장/불러오기 (순수 직렬화). 저장소(IndexedDB)는 브라우저 쪽 어댑터가 담당.
// 원작 싱글플레이 동작: 저장 대상은 캐릭터(스탯·레벨·경험치·아이템·골드), 게임을 새로 시작할 때마다 맵이 새로 생성되고
// 캐릭터는 마을에서 시작한다. 저장 형식은 원작 .d2s 가 아닌 JSON (원작 .d2s 호환은 범위 밖).
// 버전 2: 인벤토리 격자 위치·창고·벨트를 저장 (버전 1 은 불러올 때 자동 배치)
import type { Character, ClassName } from './player';
import type { ItemInstance } from './treasure';
import type { Placed } from './inventory';
import type { MercSave } from './hireling';

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
  /** 줍지 않은 시체의 아이템 (다음 게임 시작 위치 옆에 시체로) */
  corpse: Record<string, ItemInstance>;
  /** 활성 웨이포인트 번호 (levels.txt Waypoint). 원작도 캐릭터마다 저장 (D2WaypointDataStrc). 예전 저장은 [0] (마을만) */
  waypoints: number[];
  /** 용병 (없으면 null). 예전 저장은 필드 없음 → null */
  merc: MercSave | null;
  /** 끝낸 퀘스트 상태 (Game.quests). 예전 저장은 [] */
  quests: string[];
  savedAt: number;
}

export interface HeroSummary { name: string; cls: ClassName; level: number; savedAt: number }

export interface SaveItems {
  inventory: Placed[];
  stash?: Placed[];
  belt?: (ItemInstance | null)[];
  equipment: Record<string, ItemInstance>;
  stashGold?: number;
  corpse?: Record<string, ItemInstance>;
  waypoints?: number[];
  merc?: MercSave | null;
  quests?: string[];
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
    corpse: structuredClone(items.corpse ?? {}),
    waypoints: [...new Set([0, ...(items.waypoints ?? [])])].sort((a, b) => a - b),
    merc: items.merc ? { ...items.merc } : null,
    quests: [...(items.quests ?? [])],
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
  s.corpse ??= {};
  // 웨이포인트 필드가 없던 저장 호환: 마을(0)만 활성. 숫자가 아닌 값은 버린다
  s.waypoints = [...new Set([0, ...(Array.isArray(s.waypoints) ? s.waypoints.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 255) : [])])].sort((a, b) => a - b);
  for (const it of Object.values(s.corpse)) normalizeItem(it);
  // 용병·퀘스트 필드가 없던 저장 호환. 모양이 맞지 않는 용병 기록은 버린다
  const m = s.merc as Partial<MercSave> | null | undefined;
  s.merc = m && typeof m.name === 'string' && Number.isInteger(m.seed) && Number.isInteger(m.hirelingId) && Number.isInteger(m.level) && typeof m.experience === 'number'
    ? { name: m.name, seed: m.seed as number, hirelingId: m.hirelingId as number, level: m.level as number, experience: m.experience, dead: !!m.dead }
    : null;
  s.quests = Array.isArray(s.quests) ? s.quests.filter((q): q is string => typeof q === 'string') : [];
  return s as CharacterSave;
}

export const summarize = (s: CharacterSave): HeroSummary => ({ name: s.name, cls: s.character.cls, level: s.character.level, savedAt: s.savedAt });

/** 캐릭터 이름 규칙 근사(원작 세부 규칙 미확인): 2~15자, 영문자와 _ - 만, 첫 글자는 영문자 */
export function validHeroName(name: string): boolean {
  return /^[A-Za-z][A-Za-z_-]{1,14}$/.test(name);
}
