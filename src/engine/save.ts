// 캐릭터 저장/불러오기 (순수 직렬화). 저장소(IndexedDB)는 브라우저 쪽 어댑터가 담당.
// 원작 싱글플레이 동작: 저장 대상은 캐릭터(스탯·레벨·경험치·아이템·골드), 게임을 새로 시작할 때마다 맵이 새로 생성되고
// 캐릭터는 마을에서 시작한다. 저장 형식은 원작 .d2s 가 아닌 JSON (원작 .d2s 호환은 범위 밖).
// 버전 2: 인벤토리 격자 위치·창고·벨트를 저장 (버전 1 은 불러올 때 자동 배치)
// 다막·난이도 (Phase 1): act·difficulty·difficultyUnlocked, 난이도별 waypointsByDiff·questFlagsByDiff.
//   원작 .d2s 도 난이도마다 웨이포인트(D2WaypointDataStrc ×3)·퀘스트 기록(×3)을 따로 둔다.
//   예전 저장(필드 없음)은 Normal·Act 1 로 읽는다. waypoints/questFlags 는 Normal 값의 사본으로 남긴다 (예전 코드 호환).
import type { Character, ClassName } from './player';
import type { ItemInstance } from './treasure';
import type { Placed } from './inventory';
import type { MercSave } from './hireling';
import { toDifficulty, type Difficulty } from './difficulty';

/** 클래식 난이도 수 (Normal / Nightmare / Hell) */
export const DIFFICULTY_COUNT = 3;

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
  /** 예전(Phase 10 Step 1) 퀘스트 이름 목록. 새 저장은 questFlags 를 쓰고 이것은 [] */
  quests: string[];
  /**
   * 퀘스트 기록 워드 (원작 D2QuestRecord: 퀘스트마다 16비트, 48 워드 — 원작 .d2s "Woo!" 블록의 난이도별 퀘스트 데이터).
   * 예전 저장은 필드 없음 → undefined (게임이 quests 이름 목록에서 옮긴다)
   */
  questFlags?: number[];
  /** 마지막으로 있던 막 (0 = Act 1 … 3 = Act 4) — 다음 게임은 이 막 마을에서 시작. 예전 저장은 0 */
  act: number;
  /** 마지막으로 한 난이도. 예전 저장은 0 (Normal) */
  difficulty: Difficulty;
  /** 열린 가장 높은 난이도 (디아블로 처치로 다음 난이도). 예전 저장은 0 */
  difficultyUnlocked: Difficulty;
  /** 난이도별 활성 웨이포인트 [Normal, Nightmare, Hell] — 각각 0(Act 1 마을) 포함 */
  waypointsByDiff: number[][];
  /** 난이도별 퀘스트 기록 워드 (없는 난이도는 null) */
  questFlagsByDiff: (number[] | null)[];
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
  questFlags?: number[];
  act?: number;
  difficulty?: Difficulty;
  difficultyUnlocked?: Difficulty;
  /** 난이도별 웨이포인트 (Normal 칸은 waypoints 가 있으면 그것. 현재 난이도 칸만 바꾸려면 mergeDifficulty 사용) */
  waypointsByDiff?: number[][];
  questFlagsByDiff?: (number[] | null)[];
}

/** 웨이포인트 목록 정리: 0 포함, 정수 0~254, 중복 없이 정렬 */
function cleanWaypoints(v: unknown): number[] {
  const list = Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 255) : [];
  return [...new Set([0, ...list])].sort((a, b) => a - b);
}

/** 퀘스트 워드 배열 (모양이 맞지 않으면 null) */
function cleanQuestWords(v: unknown): number[] | null {
  return Array.isArray(v) && v.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? [...(v as number[])] : null;
}

/** 막 번호 (클래식 0~3, 그 밖은 0) */
function cleanAct(v: unknown): number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3 ? (v as number) : 0;
}

/**
 * 난이도 하나의 웨이포인트·퀘스트 기록을 난이도별 배열에 넣는다 (저장할 때: 이번 게임 난이도 칸만 바뀐다).
 */
export function mergeDifficulty(prev: Pick<CharacterSave, 'waypointsByDiff' | 'questFlagsByDiff'> | null, difficulty: Difficulty, waypoints: number[], questFlags: number[] | null): { waypointsByDiff: number[][]; questFlagsByDiff: (number[] | null)[] } {
  const wp = Array.from({ length: DIFFICULTY_COUNT }, (_, d) => cleanWaypoints(prev?.waypointsByDiff?.[d]));
  const qf = Array.from({ length: DIFFICULTY_COUNT }, (_, d) => cleanQuestWords(prev?.questFlagsByDiff?.[d]));
  wp[difficulty] = cleanWaypoints(waypoints);
  qf[difficulty] = questFlags ? cleanQuestWords(questFlags.map((w) => (Number(w) & 0xffff) >>> 0)) : null;
  return { waypointsByDiff: wp, questFlagsByDiff: qf };
}

export function makeSave(name: string, character: Character, gold: number, items: SaveItems, now = Date.now()): CharacterSave {
  // 난이도별 기록: Normal 칸은 waypoints/questFlags 가 있으면 그것 (예전 호출 호환), 없으면 waypointsByDiff[0]
  const byDiff = mergeDifficulty({ waypointsByDiff: items.waypointsByDiff ?? [], questFlagsByDiff: items.questFlagsByDiff ?? [] }, 0,
    items.waypoints ?? items.waypointsByDiff?.[0] ?? [], items.questFlags ?? items.questFlagsByDiff?.[0] ?? null);
  const normalQuest = byDiff.questFlagsByDiff[0];
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
    waypoints: [...(byDiff.waypointsByDiff[0] as number[])],
    merc: items.merc ? { ...items.merc } : null,
    quests: [...(items.quests ?? [])],
    ...(normalQuest ? { questFlags: [...normalQuest] } : {}),
    act: cleanAct(items.act),
    difficulty: toDifficulty(items.difficulty),
    difficultyUnlocked: toDifficulty(Math.max(toDifficulty(items.difficultyUnlocked), toDifficulty(items.difficulty)) as Difficulty),
    waypointsByDiff: byDiff.waypointsByDiff,
    questFlagsByDiff: byDiff.questFlagsByDiff,
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
  s.waypoints = cleanWaypoints(s.waypoints);
  for (const it of Object.values(s.corpse)) normalizeItem(it);
  // 용병·퀘스트 필드가 없던 저장 호환. 모양이 맞지 않는 용병 기록은 버린다
  const m = s.merc as Partial<MercSave> | null | undefined;
  s.merc = m && typeof m.name === 'string' && Number.isInteger(m.seed) && Number.isInteger(m.hirelingId) && Number.isInteger(m.level) && typeof m.experience === 'number'
    ? { name: m.name, seed: m.seed as number, hirelingId: m.hirelingId as number, level: m.level as number, experience: m.experience, dead: !!m.dead }
    : null;
  s.quests = Array.isArray(s.quests) ? s.quests.filter((q): q is string => typeof q === 'string') : [];
  // 퀘스트 기록: 숫자 워드 배열만 (모양이 맞지 않으면 버린다 → 예전 저장처럼 quests 이름으로)
  const qf = cleanQuestWords(s.questFlags);
  if (qf) s.questFlags = qf;
  else delete s.questFlags;
  // 다막·난이도 필드가 없던 저장 호환: Act 1, Normal, 난이도별 기록의 Normal 칸 = waypoints/questFlags
  s.act = cleanAct(s.act);
  s.difficulty = toDifficulty(s.difficulty);
  s.difficultyUnlocked = toDifficulty(Math.max(toDifficulty(s.difficultyUnlocked), s.difficulty) as Difficulty);
  // Normal 칸은 waypoints/questFlags 가 기준 (예전 저장·예전 코드가 쓰는 칸), Nightmare·Hell 은 난이도별 배열
  const merged = mergeDifficulty({ waypointsByDiff: Array.isArray(s.waypointsByDiff) ? s.waypointsByDiff : [], questFlagsByDiff: Array.isArray(s.questFlagsByDiff) ? s.questFlagsByDiff : [] },
    0, s.waypoints, s.questFlags ?? null);
  s.waypointsByDiff = merged.waypointsByDiff;
  s.questFlagsByDiff = merged.questFlagsByDiff;
  // Normal 사본을 난이도별 배열과 맞춘다
  s.waypoints = [...(merged.waypointsByDiff[0] as number[])];
  const nq = merged.questFlagsByDiff[0];
  if (nq) s.questFlags = [...nq];
  else delete s.questFlags;
  return s as CharacterSave;
}

export const summarize = (s: CharacterSave): HeroSummary => ({ name: s.name, cls: s.character.cls, level: s.character.level, savedAt: s.savedAt });

/** 캐릭터 이름 규칙 근사(원작 세부 규칙 미확인): 2~15자, 영문자와 _ - 만, 첫 글자는 영문자 */
export function validHeroName(name: string): boolean {
  return /^[A-Za-z][A-Za-z_-]{1,14}$/.test(name);
}
