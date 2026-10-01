// 캐릭터 저장/불러오기 (순수 직렬화). 저장소(IndexedDB)는 브라우저 쪽 어댑터가 담당.
// 원작 싱글플레이 동작: 저장 대상은 캐릭터(스탯·레벨·경험치·아이템·골드), 게임을 새로 시작할 때마다 맵이 새로 생성되고
// 캐릭터는 마을에서 시작한다. 저장 형식은 원작 .d2s 가 아닌 JSON (원작 .d2s 호환은 범위 밖).
// 버전 2: 인벤토리 격자 위치·창고·벨트를 저장 (버전 1 은 불러올 때 자동 배치)
// 다막·난이도 (Phase 1): act·difficulty·difficultyUnlocked, 난이도별 waypointsByDiff·questFlagsByDiff.
//   원작 .d2s 도 난이도마다 웨이포인트(D2WaypointDataStrc ×3)·퀘스트 기록(×3)을 따로 둔다.
//   예전 저장(필드 없음)은 Normal·Act 1 로 읽는다. waypoints/questFlags 는 Normal 값의 사본으로 남긴다 (예전 코드 호환).
// 난이도 (Phase 8): 난이도별 마지막 막 actByDiff (원작 .d2s 헤더 nTown[3] — 게임을 시작하면 그 난이도의 이 막 마을에서),
//   칭호용 진행 값 progression (원작 .d2s 진행 바이트). 출처: D2MOO PlrSave2.cpp (nTown[pGame->nDifficulty] & 0x7F = 시작 막)
import { HOTKEY_SLOTS, type Character, type ClassName } from './player';
import type { ItemInstance } from './treasure';
import type { Placed } from './inventory';
import type { MercSave } from './hireling';
import { heroTitle, toDifficulty, type Difficulty } from './difficulty';

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
  /** 호라드릭 큐브 칸 (원작: 캐릭터 인벤토리의 INVPAGE_CUBE 쪽). 예전 저장은 [] */
  cube: Placed[];
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
  /**
   * 난이도별 마지막 막 [Normal, Nightmare, Hell] (원작 .d2s nTown[3]). 게임을 시작하면 고른 난이도의 이 막 마을에서.
   * 예전 저장은 [마지막 난이도] 칸만 act, 나머지 0
   */
  actByDiff: number[];
  /**
   * 원작 .d2s 진행 값 (클래식: 막을 끝낼 때마다 +1, 4 = Normal 완료 … 12 = Hell 완료) — 칭호. 없으면 difficultyUnlocked × 4 로 본다.
   * Phase 7 (퀘스트) 이 막 완료 때 올린다. 예전 저장은 없음
   */
  progression?: number;
  /** 확장팩 캐릭터 (원작 "Expansion Character" — 확장팩 아이템·규칙·무기 바꾸기). 없으면 클래식 */
  expansion?: boolean;
  /** 무기 바꾸기 (확장팩): 쉬는 세트(rarm/larm), 지금 세트 0/1, 쉬는 세트에서 고른 스킬 */
  altWeapons?: Record<string, ItemInstance>;
  weaponSet?: 0 | 1;
  altSkills?: { left: number; right: number };
  savedAt: number;
}

export interface HeroSummary {
  name: string; cls: ClassName; level: number; savedAt: number;
  /** 열린 가장 높은 난이도 (캐릭터 선택 후 난이도 창을 띄울지) */
  difficultyUnlocked: Difficulty;
  /** 클래식 칭호 (Sir/Dame, Lord/Lady, Baron/Baroness — 없으면 '') */
  title: string;
  /** 확장팩 캐릭터 */
  expansion: boolean;
}

export interface SaveItems {
  inventory: Placed[];
  stash?: Placed[];
  cube?: Placed[];
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
  /** 난이도별 마지막 막 (이번 게임 난이도 칸은 act 로 덮는다) */
  actByDiff?: number[];
  progression?: number;
  expansion?: boolean;
  altWeapons?: Record<string, ItemInstance>;
  weaponSet?: 0 | 1;
  altSkills?: { left: number; right: number };
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

/** 난이도별 마지막 막 정리 (길이 3, 0~3). 배열이 아니면 [difficulty] 칸만 act (예전 저장) */
function cleanActByDiff(v: unknown, act: number, difficulty: Difficulty): number[] {
  const out = Array.from({ length: DIFFICULTY_COUNT }, (_, d) => cleanAct(Array.isArray(v) ? v[d] : 0));
  if (!Array.isArray(v)) out[difficulty] = cleanAct(act);
  return out;
}

/** 진행 값 정리 (정수 0~15, 아니면 없음) */
function cleanProgression(v: unknown): number | undefined {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 15 ? (v as number) : undefined;
}

/**
 * 게임을 시작할 막: 고른 난이도의 마지막 막 (그 난이도를 처음 하면 Act 1).
 * 출처: PlrSave2.cpp — nAct = nTown[pGame->nDifficulty] & 0x7F (NUM_ACTS 이상이면 Act I)
 */
export function startActFor(save: Pick<CharacterSave, 'actByDiff'> | null, difficulty: Difficulty): number {
  return cleanAct(save?.actByDiff?.[difficulty]);
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

/** 스킬 단축키 8칸 (없거나 모자라면 빈 칸) */
function normalHotkeys(hk: Character['hotkeys']): NonNullable<Character['hotkeys']> {
  const a = Array.isArray(hk) ? hk : [];
  return Array.from({ length: HOTKEY_SLOTS }, (_, i) => (a[i] ? { ...a[i] } : null));
}

export function makeSave(name: string, character: Character, gold: number, items: SaveItems, now = Date.now()): CharacterSave {
  // 난이도별 기록: Normal 칸은 waypoints/questFlags 가 있으면 그것 (예전 호출 호환), 없으면 waypointsByDiff[0]
  const byDiff = mergeDifficulty({ waypointsByDiff: items.waypointsByDiff ?? [], questFlagsByDiff: items.questFlagsByDiff ?? [] }, 0,
    items.waypoints ?? items.waypointsByDiff?.[0] ?? [], items.questFlags ?? items.questFlagsByDiff?.[0] ?? null);
  const normalQuest = byDiff.questFlagsByDiff[0];
  const difficulty = toDifficulty(items.difficulty);
  // 이번 게임 난이도 칸 = 지금 막 (원작 saveHeader.nTown[pGame->nDifficulty] = 현재 막 | 0x80)
  const actByDiff = cleanActByDiff(items.actByDiff ?? [], 0, difficulty);
  actByDiff[difficulty] = cleanAct(items.act);
  const progression = cleanProgression(items.progression);
  return {
    version: SAVE_VERSION,
    name,
    character: { ...structuredClone(character), hotkeys: normalHotkeys(character.hotkeys) },
    gold,
    inventory: structuredClone(items.inventory),
    stash: structuredClone(items.stash ?? []),
    cube: structuredClone(items.cube ?? []),
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
    actByDiff,
    ...(progression !== undefined ? { progression } : {}),
    ...(items.expansion ? { expansion: true } : {}),
    ...(items.altWeapons && Object.keys(items.altWeapons).length ? { altWeapons: structuredClone(items.altWeapons) } : {}),
    ...(items.weaponSet === 1 ? { weaponSet: 1 as const } : {}),
    ...(items.altSkills ? { altSkills: { left: items.altSkills.left, right: items.altSkills.right } } : {}),
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
  if (x.ethereal !== true) delete x.ethereal;
  if (typeof x.runeword !== 'number') {
    delete x.runeword;
    delete x.runewordBase;
  }
  if (typeof x.gfx !== 'number') delete x.gfx;
  x.socketed.forEach(normalizeItem);
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
  // 스킬 단축키가 없던 저장 호환 (빈 8칸)
  s.character.hotkeys = normalHotkeys(s.character.hotkeys);
  const inv = s.inventory as Placed[];
  for (const p of inv) normalizeItem(p.item);
  for (const p of s.stash ?? []) normalizeItem(p.item);
  // 큐브 칸이 없던 저장 호환 (모양이 맞지 않으면 버린다)
  s.cube = Array.isArray(s.cube) ? s.cube.filter((p) => p && typeof p === 'object' && p.item && Number.isInteger(p.x) && Number.isInteger(p.y)) : [];
  for (const p of s.cube) normalizeItem(p.item);
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
  // 난이도별 마지막 막이 없던 저장: 마지막 난이도 칸만 act
  s.actByDiff = cleanActByDiff(s.actByDiff, s.act, s.difficulty);
  const prog = cleanProgression(s.progression);
  if (prog !== undefined) s.progression = prog;
  else delete s.progression;
  if (s.expansion === true) s.expansion = true;
  else delete s.expansion;
  // 무기 바꾸기: rarm/larm 만, 세트 0/1, 스킬은 정수
  if (s.altWeapons && typeof s.altWeapons === 'object') {
    const alt: Record<string, ItemInstance> = {};
    for (const k of ['rarm', 'larm']) if (s.altWeapons[k]) alt[k] = s.altWeapons[k];
    for (const it of Object.values(alt)) normalizeItem(it);
    if (Object.keys(alt).length) s.altWeapons = alt;
    else delete s.altWeapons;
  } else delete s.altWeapons;
  if (s.weaponSet !== 1) delete s.weaponSet;
  if (!s.altSkills || !Number.isInteger(s.altSkills.left) || !Number.isInteger(s.altSkills.right)) delete s.altSkills;
  return s as CharacterSave;
}

/** 여성 클래스 (칭호 Dame/Lady/Baroness) */
const FEMALE: readonly ClassName[] = ['Amazon', 'Sorceress'];

export const summarize = (s: CharacterSave): HeroSummary => ({
  name: s.name, cls: s.character.cls, level: s.character.level, savedAt: s.savedAt,
  difficultyUnlocked: toDifficulty(s.difficultyUnlocked),
  title: heroTitle(FEMALE.includes(s.character.cls), s.progression ?? toDifficulty(s.difficultyUnlocked) * 4),
  expansion: s.expansion === true,
});

/** 캐릭터 이름 규칙 근사(원작 세부 규칙 미확인): 2~15자, 영문자와 _ - 만, 첫 글자는 영문자 */
export function validHeroName(name: string): boolean {
  return /^[A-Za-z][A-Za-z_-]{1,14}$/.test(name);
}
