// 몬스터 정의·인스턴스 생성·거리/근접 판정.
// 출처: D2MOO — D2Game/src/MONSTER/Monster.cpp (레벨 = monstats Level[난이도], HP = min + rand(max−min+1), HP 재생 = maxHP×DamageRegen>>12)
//       D2Common/src/DataTbls/MonsterTbls.cpp DATATBLS_CalculateMonsterStatsByLevel (MonLvl 기준값 × monstats % / 100,
//       싱글플레이 = 비-L 컬럼), D2Common/src/Monsters/Monsters.cpp MONSTERS_ApplyClassicScaling (Normal 은 보정 없음)
//       D2Common/src/Units/Units.cpp UNITS_IsInMeleeRange / D2Common_10399 (근접 거리 테이블)
//       D2Game/src/AI/AiUtil.cpp AIUTIL_GetDistanceToCoordinates_NoUnitSize (https://github.com/ThePhrozenKeep/D2MOO)
// 난이도 (Phase 8): monstats (N)/(H) 칸·MonLvl (N)/(H) 칸을 읽는 난이도별 MonsterDb (forDifficulty), 클래식 Nightmare/Hell 보정.
//   출처: Monster.cpp MONSTER_InitializeStatsAndSkills (nLevel[난이도]·저항[난이도]·ToBlock[난이도], 용병은 Normal),
//         MonsterTbls.cpp DATATBLS_CalculateMonsterStatsByLevel (MonLvl dwHP[난이도 + (배틀넷 ? 3 : 0)] — 싱글플레이는 비-L 칸),
//         Monsters.cpp MONSTERS_ApplyClassicScaling (클래식 NM/H: 생명 ×1/2, 방어 ×10/12, 경험치 ×10/17·×10/26, 레벨 = 25×난이도 + Level),
//         MonsterMode.cpp (공격 시 피해·명중 = 현재 레벨로 다시 계산, 클래식 NM/H 는 피해 ×10/12·명중 ×10/15)
import type { TxtRow } from '../formats/txt';
import { diffColumn, type Difficulty } from './difficulty';
import type { AnimData } from '../formats/animdata';
import { actionFrame, animDurationFrames, frameToTick } from '../formats/animdata';
import type { Rng } from './rng';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export interface AttackDef { min: number; max: number; toHit: number }

/** monstats Skill1~8 / Sk1mode~ / Sk1lvl~ (mode = MonMode 토큰 또는 monseq.txt 시퀀스 이름) */
export interface MonSkillDef { name: string; mode: string; lvl: number }

/** monstats El1~3 (Mode/Type + 이 MonsterDb 난이도 칸의 Pct/MinD/MaxD/Dur) */
export interface MonElemDef { mode: string; type: string; pct: number; min: number; max: number; dur: number }

/** monseq.txt 한 프레임 (mode 의 frame 번째 그림, event 0 없음 / 1 공격 / 2 미사일·스킬 / 4 스킬 …) */
export interface MonSeqFrame { mode: string; frame: number; event: number }

export interface MonsterType {
  id: string;
  /** monstats.txt 행 번호 (hcIdx) */
  hcIdx: number;
  nameStr: string;
  code: string;
  ai: string;
  baseW: string;
  /** 같은 계열의 첫 몬스터 (BaseId) · 다음 몬스터 (NextInClass) */
  baseId: string; nextInClass: string;
  /** 팔레트 변형 번호 (monstats TransLvl) */
  transLvl: number;
  monType: string;
  /** monstats Level (이 MonsterDb 난이도 칸: Level / Level(N) / Level(H)) — 능력치 계산 레벨 */
  level: number;
  /** monstats Level (Normal 칸). 출처: D2Common_11063·MONSTERS_ApplyClassicScaling 은 nLevel[0] 을 쓴다 */
  baseLevel: number;
  /** monstats Align (0 악, 1 선 — NPC·용병·소환수, 2 중립). 출처: MonsterTbls.h MONALIGN_* */
  align: number;
  minGrp: number; maxGrp: number;
  /** 파티(동반) 몬스터: minion1/2, PartyMin~PartyMax, SetBoss/BossXfer */
  minions: string[]; partyMin: number; partyMax: number; setBoss: boolean; bossXfer: boolean;
  /** 스폰 몬스터 (Nest 등): spawn / spawnx / spawny / spawnmode, placespawn */
  spawn: string; spawnX: number; spawnY: number; spawnMode: string; placeSpawn: boolean;
  rarity: number;
  sparsePopulate: number;
  /** 야드/초 (플레이어 WalkVelocity 와 같은 단위) */
  velocity: number; run: number;
  minHpPct: number; maxHpPct: number; acPct: number; expPct: number;
  a1: AttackDef; a2: AttackDef; s1: AttackDef;
  missA1: string; missA2: string; missS1: string; missC: string; missSQ: string;
  aiParams: number[];
  aiDelay: number;
  aiDist: number;
  toBlock: number;
  damageRegen: number;
  crit: number;
  /** TreasureClass1~4 (일반/챔피언/유니크/퀘스트) */
  treasure: string[];
  /** 퀘스트 드롭 (TCQuestId, TCQuestCP) */
  tcQuestId: number; tcQuestCP: number;
  skills: MonSkillDef[];
  elem: MonElemDef[];
  sizeX: number;
  /** monstats2 Small / Large (밀쳐내기 확률 128 / 32, 보통 64) */
  small?: boolean;
  large?: boolean;
  meleeRange: number;
  hitClass: number;
  resist: { dm: number; ma: number; fi: number; li: number; co: number; po: number };
  /** 냉기 효과 % (음수 = 감속, 0 이상 = 냉기 면역) — monstats coldeffect (Normal) */
  coldEffect: number;
  /** monstats noRatio: 생명·방어·피해·명중을 MonLvl 비율 없이 표 값 그대로 (소환수) */
  noRatio: boolean;
  modes: Set<string>;
  /** monstats2 레이어별 외형 변형 (예: TR → ['lit','med','hvy']) */
  layers: Record<string, string[]>;
  undead: boolean; demon: boolean;
  /** monstats 플래그 */
  isMelee: boolean; rangedType: boolean; noMultishot: boolean; flying: boolean; boss: boolean; primeEvil: boolean;
  npc: boolean; isSpawn: boolean; killable: boolean; inTown: boolean; neverCount: boolean;
  /** AI 를 바꿀 수 있다 (공포·전향 대상 — monstats switchai) */
  switchAi: boolean;
  /** monstats interact (말을 걸 수 있는 NPC) */
  interact: boolean;
  /** monstats2: 유니크 색 (Utrans, Normal), 유니크 색 바꿈 없음 (noUniqueShift), 부활 모드·스킬, 스폰 충돌, 움직이지 않음 (inert) */
  utrans: number; noUniqueShift: boolean; resurrectMode: string; resurrectSkill: string; spawnCol: number; inert: boolean;
  critter: boolean; corpseSel: boolean;
  /** monstats2 soft (Corpse Spitter 가 먹을 수 있는 무른 시체), InfernoLen / InfernoAnim / InfernoRollback (불길·번개 숨결 반복 프레임) */
  soft: boolean; infernoLen: number; infernoAnim: number; infernoRollback: number;
  /** monstats threat (원작 AITHINK_GetTargetScore: 1 이하 몬스터는 보스의 대상이 아니다) */
  threat: number;
  /** monstats deathDmg (죽을 때 터진다 — Undead Stygian Doll), SplEndDeath (1 = 시체가 minion1 로 바뀐다 — Fetish Shaman) */
  deathDmg: boolean; splEndDeath: number;
  /** monstats SplEndGeneric (모드가 끝나면 바로 AI — Vulture S1·Willowisp WL·Bat Demon S3/S4·Frog Demon SQ·Trapped Soul) */
  splEndGeneric: boolean;
}

export class MonsterDb {
  readonly types = new Map<string, MonsterType>();
  /** hcIdx 순서 (monpreset·superuniques 가 행 번호로 참조) */
  readonly list: MonsterType[] = [];
  /** monseq.txt 시퀀스 이름 → 프레임 */
  readonly seqs = new Map<string, MonSeqFrame[]>();
  private readonly monLvl: TxtRow[];
  /** 이 표가 읽은 난이도 칸 (0 Normal / 1 Nightmare / 2 Hell) */
  readonly difficulty: Difficulty;
  private readonly src: { monstats: TxtRow[]; monstats2: TxtRow[]; monLvl: TxtRow[]; monSeq: TxtRow[] };
  /** 난이도별 표 (같은 원본 행을 읽은 표끼리 나눠 쓴다) */
  private readonly byDiff: Map<Difficulty, MonsterDb>;

  constructor(monstats: TxtRow[], monstats2: TxtRow[], monLvl: TxtRow[], monSeq: TxtRow[] = [], difficulty: Difficulty = 0, shared?: Map<Difficulty, MonsterDb>) {
    this.monLvl = monLvl;
    this.difficulty = difficulty;
    this.src = { monstats, monstats2, monLvl, monSeq };
    this.byDiff = shared ?? new Map();
    this.byDiff.set(difficulty, this);
    const d = difficulty;
    // 난이도 칸: Normal 은 이름 그대로, Nightmare/Hell 은 "(N)"/"(H)" (minHP/maxHP 는 MinHP(N)/MaxHP(N) 처럼 첫 글자가 대문자)
    const c = (r: TxtRow, key: string, diffKey = key) => (d === 0 ? r[key] : r[diffColumn(diffKey, d)]);
    const s2 = new Map(monstats2.map((r) => [r.Id, r]));
    for (const r of monstats) {
      if (!r.Id || r.Id === 'Expansion') continue;
      const r2 = s2.get(r.MonStatsEx || r.Id) ?? s2.get(r.Id) ?? {};
      const modes = new Set<string>();
      for (const m of ['DT', 'NU', 'WL', 'GH', 'A1', 'A2', 'BL', 'SC', 'S1', 'S2', 'S3', 'S4', 'DD', 'KB', 'SQ', 'RN']) if (n(r2[`m${m}`]) === 1) modes.add(m);
      const layers: Record<string, string[]> = {};
      for (const [col, name] of [['HD', 'HD'], ['TR', 'TR'], ['LG', 'LG'], ['RA', 'RA'], ['LA', 'LA'], ['RH', 'RH'], ['LH', 'LH'], ['SH', 'SH'], ['S1', 'S1'], ['S2', 'S2'], ['S3', 'S3'], ['S4', 'S4'], ['S5', 'S5'], ['S6', 'S6'], ['S7', 'S7'], ['S8', 'S8']] as const) {
        if (n(r2[col]) !== 1) continue;
        const vcol = col === 'RA' ? 'Rav' : col === 'LA' ? 'Lav' : `${col}v`;
        const v = (r2[vcol] ?? '').replace(/"/g, '').split(',').map((x) => x.trim()).filter(Boolean);
        layers[name] = v.length ? v : ['lit'];
      }
      const skills: MonSkillDef[] = [];
      for (let i = 1; i <= 8; i++) {
        const name = r[`Skill${i}`] ?? '';
        skills.push({ name, mode: r[`Sk${i}mode`] ?? '', lvl: n(r[`Sk${i}lvl`]) });
      }
      const elem: MonElemDef[] = [];
      for (let i = 1; i <= 3; i++) {
        elem.push({ mode: r[`El${i}Mode`] ?? '', type: r[`El${i}Type`] ?? '', pct: n(c(r, `El${i}Pct`)), min: n(c(r, `El${i}MinD`)), max: n(c(r, `El${i}MaxD`)), dur: n(c(r, `El${i}Dur`)) });
      }
      const coldEff = c(r, 'coldeffect');
      const t: MonsterType = {
        id: r.Id, hcIdx: n(r.hcIdx), nameStr: r.NameStr ?? r.Id, code: r.Code ?? '', ai: r.AI ?? '', baseW: (r2.BaseW ?? 'hth').toUpperCase(),
        baseId: r.BaseId || r.Id, nextInClass: r.NextInClass ?? '', transLvl: n(r.TransLvl), monType: r.MonType ?? '',
        level: n(c(r, 'Level')), baseLevel: n(r.Level), align: n(r.Align), minGrp: n(r.MinGrp), maxGrp: n(r.MaxGrp),
        minions: [r.minion1 ?? '', r.minion2 ?? ''].filter(Boolean), partyMin: n(r.PartyMin), partyMax: n(r.PartyMax),
        setBoss: n(r.SetBoss) === 1, bossXfer: n(r.BossXfer) === 1,
        spawn: r.spawn ?? '', spawnX: n(r.spawnx), spawnY: n(r.spawny), spawnMode: r.spawnmode ?? '', placeSpawn: n(r.placespawn) === 1,
        rarity: n(r.Rarity), sparsePopulate: n(r.sparsePopulate), velocity: n(r.Velocity), run: n(r.Run),
        minHpPct: n(c(r, 'minHP', 'MinHP')), maxHpPct: n(c(r, 'maxHP', 'MaxHP')), acPct: n(c(r, 'AC')), expPct: n(c(r, 'Exp')),
        a1: { min: n(c(r, 'A1MinD')), max: n(c(r, 'A1MaxD')), toHit: n(c(r, 'A1TH')) }, a2: { min: n(c(r, 'A2MinD')), max: n(c(r, 'A2MaxD')), toHit: n(c(r, 'A2TH')) },
        s1: { min: n(c(r, 'S1MinD')), max: n(c(r, 'S1MaxD')), toHit: n(c(r, 'S1TH')) },
        missA1: r.MissA1 ?? '', missA2: r.MissA2 ?? '', missS1: r.MissS1 ?? '', missC: r.MissC ?? '', missSQ: r.MissSQ ?? '',
        aiParams: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => n(c(r, `aip${i}`))),
        aiDelay: n(c(r, 'aidel')), aiDist: n(c(r, 'aidist')), toBlock: n(c(r, 'ToBlock')), damageRegen: n(r.DamageRegen), crit: n(r.Crit),
        treasure: [1, 2, 3, 4].map((i) => c(r, `TreasureClass${i}`) ?? ''),
        tcQuestId: n(r.TCQuestId), tcQuestCP: n(r.TCQuestCP), skills, elem,
        sizeX: n(r2.SizeX) || 1, small: n(r2.small) === 1, large: n(r2.large) === 1, meleeRange: n(r2.MeleeRng), hitClass: n(r2.HitClass),
        resist: { dm: n(c(r, 'ResDm')), ma: n(c(r, 'ResMa')), fi: n(c(r, 'ResFi')), li: n(c(r, 'ResLi')), co: n(c(r, 'ResCo')), po: n(c(r, 'ResPo')) },
        coldEffect: coldEff === undefined || coldEff === '' ? -50 : n(coldEff),
        noRatio: n(r.noRatio) === 1,
        modes, layers, undead: n(r.lUndead) === 1 || n(r.hUndead) === 1, demon: n(r.demon) === 1,
        isMelee: n(r.isMelee) === 1, rangedType: n(r.rangedtype) === 1, noMultishot: n(r.nomultishot) === 1, flying: n(r.flying) === 1,
        boss: n(r.boss) === 1, primeEvil: n(r.primeevil) === 1, npc: n(r.npc) === 1, isSpawn: n(r.isSpawn) === 1, killable: n(r.killable) === 1,
        inTown: n(r.inTown) === 1, neverCount: n(r.neverCount) === 1, switchAi: n(r.switchai) === 1, interact: n(r.interact) === 1,
        utrans: n(c(r2, 'Utrans')), noUniqueShift: n(r2.noUniqueShift) === 1, resurrectMode: r2.ResurrectMode ?? 'NU', resurrectSkill: r2.ResurrectSkill ?? '',
        spawnCol: n(r2.spawnCol), inert: n(r2.inert) === 1, critter: n(r2.critter) === 1, corpseSel: n(r2.corpseSel) === 1,
        soft: n(r2.soft) === 1, infernoLen: n(r2.InfernoLen), infernoAnim: n(r2.InfernoAnim), infernoRollback: n(r2.InfernoRollback), threat: n(r.threat),
        deathDmg: n(r.deathDmg) === 1, splEndDeath: n(r.SplEndDeath), splEndGeneric: n(r.SplEndGeneric) === 1,
      };
      this.types.set(r.Id, t);
      this.list.push(t);
    }
    for (const r of monSeq) {
      if (!r.sequence) continue;
      const list = this.seqs.get(r.sequence) ?? [];
      list.push({ mode: r.mode ?? 'NU', frame: n(r.frame), event: n(r.event) });
      this.seqs.set(r.sequence, list);
    }
  }

  /**
   * 난이도 칸을 읽은 표 (같은 원본 행, 한 번 만들면 재사용).
   * 출처: 원작 D2MonStatsTxt 는 난이도 칸을 배열로 들고 pGame->nDifficulty 로 고른다 — 여기서는 난이도마다 표 하나
   */
  forDifficulty(d: Difficulty): MonsterDb {
    return this.byDiff.get(d) ?? new MonsterDb(this.src.monstats, this.src.monstats2, this.src.monLvl, this.src.monSeq, d, this.byDiff);
  }

  /** 같은 계열 안의 순번 (BaseId = 0). 출처: D2Common DATATBLS_GetMonsterChainInfo (BaseId 부터 NextInClass 를 따라간 위치) */
  chainIndex(t: MonsterType): number {
    let cur = this.types.get(t.baseId);
    for (let i = 0; cur && i < 16; i++) {
      if (cur.id === t.id) return i;
      cur = this.types.get(cur.nextInClass);
    }
    return 0;
  }

  /** 계열 길이. 출처: DATATBLS_GetMonsterChainInfo (nMonstersInChain) */
  chainLength(t: MonsterType): number {
    let cur = this.types.get(t.baseId), k = 0;
    while (cur && k < 16) {
      k++;
      cur = this.types.get(cur.nextInClass);
    }
    return k;
  }

  /**
   * 레벨에 맞는 같은 계열 몬스터.
   * 출처: D2Common Monsters.cpp D2Common_11063 — 레벨 몬스터 풀(mon1~)에 같은 BaseId 가 있으면 그것,
   *       없으면 NextInClass 를 따라가며 몬스터 Level(Normal 칸 nLevel[0]) ≤ 레벨 MonLvlEx(Normal) + 1 인 마지막 것 — 난이도와 무관
   */
  forLevel(id: string, levelPool: readonly string[], monLvlEx: number): string {
    const t = this.types.get(id);
    if (!t || !levelPool.length) return id;
    const base = this.types.get(t.baseId);
    if (!base) return id;
    for (const p of levelPool) if (this.types.get(p)?.baseId === base.id) return p;
    let result = id, next = base.nextInClass;
    const count = this.chainLength(t);
    for (let i = 0; i < count; i++) {
      const nt = this.types.get(next);
      if (!nt || nt.baseLevel > monLvlEx + 1) return result;
      result = nt.id;
      next = nt.nextInClass;
    }
    return result;
  }

  get(id: string): MonsterType {
    const t = this.types.get(id);
    if (!t) throw new Error(`monstats: unknown monster ${id}`);
    return t;
  }

  /**
   * MonLvl.txt 기준값 (싱글플레이 = 비-L 칸, 이 표의 난이도 칸: HP / HP(N) / HP(H)).
   * 출처: DATATBLS_CalculateMonsterStatsByLevel — dwHP[nDifficulty + (nGameType ? 3 : 0)], 레벨이 표보다 크면 마지막 행
   */
  levelBase(level: number, col: 'AC' | 'TH' | 'HP' | 'DM' | 'XP'): number {
    const row = this.monLvl.find((r) => r.Level === String(level)) ?? this.monLvl[this.monLvl.length - 1];
    return n(row?.[this.difficulty === 0 ? col : diffColumn(col, this.difficulty)]);
  }
}

export interface MonsterStats {
  level: number;
  maxHp: number;
  defense: number;
  exp: number;
  a1: AttackDef;
  a2: AttackDef;
  s1: AttackDef;
  /** El1~3 원소 피해 (MonLvl DM 비율 적용) */
  elem: { min: number; max: number }[];
}

/** 클래식 Nightmare/Hell 보정 몬스터인가 (선한 몬스터 — NPC·용병·소환수 — 는 제외). 출처: MONSTERS_ApplyClassicScaling nAlign != MONALIGN_GOOD */
export function classicScaled(db: MonsterDb, t: MonsterType): boolean {
  return db.difficulty > 0 && t.align !== 1;
}

/**
 * 출처: MonsterTbls ApplyRatio = MonLvl × % / 100 (정수 나눗셈), Monster.cpp HP = min + rand(max − min + 1)
 *       DATATBLS_CalculateMonsterStatsByLevel — noRatio 몬스터(소환수)는 monstats 값을 그대로
 * 난이도 (db.difficulty > 0, 클래식):
 *   - 생명·방어·경험치는 monstats Level(N)/(H) 레벨의 MonLvl (N)/(H) 칸으로 계산한 뒤 MONSTERS_ApplyClassicScaling —
 *     생명 ×1/2 (원작 1/256 단위라 .5 가 남을 수 있다), 방어 ×10/12, 경험치 ×10/17 (NM)·×10/26 (Hell), 레벨 = 25 × 난이도 + Level(Normal)
 *   - 공격 피해·명중은 원작이 공격할 때 현재 레벨(보정 뒤 레벨)로 다시 계산하므로 그 레벨로, 그리고 피해 ×10/12·명중 ×10/15 (MonsterMode.cpp)
 *   - 원소 피해도 보정 뒤 레벨 (MonsterMode.cpp 0x40+i, 클래식 감소 없음)
 * level 인자를 주면 (소환수 등) 그 레벨로만 계산하고 클래식 보정은 하지 않는다.
 */
export function rollMonsterStats(db: MonsterDb, t: MonsterType, rng: Rng, level?: number): MonsterStats {
  const d = db.difficulty;
  const classic = level === undefined && classicScaled(db, t);
  const statLvl = level ?? t.level;
  const lvl = classic ? 25 * d + t.baseLevel : statLvl;
  const ratio = (at: number, col: 'AC' | 'TH' | 'HP' | 'DM' | 'XP', pct: number) => (t.noRatio ? pct : Math.trunc((db.levelBase(at, col) * pct) / 100));
  const minHp = ratio(statLvl, 'HP', t.minHpPct), maxHp = ratio(statLvl, 'HP', t.maxHpPct);
  let hp = Math.max(1, minHp + rng.pick(maxHp - minHp + 1));
  let defense = ratio(statLvl, 'AC', t.acPct), exp = ratio(statLvl, 'XP', t.expPct);
  if (classic) {
    // 출처: aClassicStatAdjustments {MAXHP 1/2, ARMORCLASS 10/12, EXPERIENCE 10/17 · 10/26} (DATATBLS_ApplyRatio = 값 × 곱 / 나눗수)
    hp = Math.trunc((hp * 256) / 2) / 256;
    defense = Math.trunc((defense * 10) / 12);
    exp = Math.trunc((exp * 10) / (d === 1 ? 17 : 26));
  }
  const atk = (a: AttackDef): AttackDef => {
    const r = { min: ratio(lvl, 'DM', a.min), max: ratio(lvl, 'DM', a.max), toHit: ratio(lvl, 'TH', a.toHit) };
    // 출처: MonsterMode.cpp — 클래식 NM/H (선하지 않은 몬스터): 피해 10×/12, 명중 10×/15
    return classic ? { min: Math.trunc((10 * r.min) / 12), max: Math.trunc((10 * r.max) / 12), toHit: Math.trunc((10 * r.toHit) / 15) } : r;
  };
  return {
    level: lvl,
    maxHp: hp,
    defense,
    exp,
    a1: atk(t.a1),
    a2: atk(t.a2),
    s1: atk(t.s1),
    // 출처: DATATBLS_CalculateMonsterStatsByLevel (nFlags 0x40+i) — 원소 피해도 MonLvl DM 비율
    elem: t.elem.map((e) => ({ min: ratio(lvl, 'DM', e.min), max: ratio(lvl, 'DM', e.max) })),
  };
}

/** 출처: AIUTIL_GetDistanceToCoordinates_NoUnitSize — (짧은축 + 2×긴축) / 2, 서브타일 정수 좌표 */
export function aiDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(Math.floor(ax) - Math.floor(bx)), dy = Math.abs(Math.floor(ay) - Math.floor(by));
  return Math.trunc(dx <= dy ? (dx + 2 * dy) / 2 : (dy + 2 * dx) / 2);
}

// 출처: D2Common_10399 dword_6FDD3200 (x + 8·y 인덱스)
const MELEE_TABLE = [
  -1, -1, -1, 0, 2, 4, 6, 8,
  -1, -1, 0, 1, 2, 4, 6, 8,
  -1, 0, 0, 2, 3, 5, 7, 8,
  0, 1, 2, 2, 4, 5, 7, 8,
  2, 2, 3, 4, 5, 6, 7, 9,
  4, 4, 5, 5, 6, 7, 8, 9,
  6, 6, 7, 7, 7, 8, 10, 10,
  8, 8, 8, 8, 9, 9, 10, 11,
];

/** 출처: D2Common_10399 — 크기 보정 유닛 간 거리 (근접 판정용) */
export function unitDistance(ax: number, ay: number, aSize: number, bx: number, by: number, bSize: number): number {
  const dx = Math.abs(Math.floor(bx) - Math.floor(ax)), dy = Math.abs(Math.floor(by) - Math.floor(ay));
  if (dx >= 8 || dy >= 8 || aSize >= 4 || bSize >= 4) {
    const sd = Math.abs((bSize >> 1) + (aSize >> 1));
    const x = Math.max(0, dx - sd), y = Math.max(0, dy - sd);
    return x <= y ? x + 2 * y : y + 2 * x;
  }
  let d = MELEE_TABLE[dx + 8 * dy] ?? 0;
  if (d < 0) return 0;
  if (aSize === 3 || bSize === 3) d--;
  if (d < 0) d = 0;
  if (aSize <= 1 || bSize <= 1) d++;
  return d;
}

/** 출처: UNITS_IsInMeleeRange — 거리 ≤ 0 이면 참, 아니면 meleeRange + bonus + 1 ≥ 거리 */
export function isInMeleeRange(ax: number, ay: number, aSize: number, meleeRange: number, bx: number, by: number, bSize: number, bonus = 0): boolean {
  const d = unitDistance(ax, ay, aSize, bx, by, bSize);
  return d <= 0 || meleeRange + bonus + 1 >= d;
}

export interface ModeTiming { duration: number; hitTick: number }

/** 모드 애니메이션 길이/판정 틱 (AnimData "<코드><모드><무기클래스>") */
export function modeTiming(anim: AnimData, token: string, mode: string, wclass: string, speedPercent = 100, minusOne = false): ModeTiming {
  const r = anim.get(`${token}${mode}${wclass}`);
  if (!r) return { duration: 10, hitTick: 5 };
  const af = actionFrame(r);
  return {
    duration: animDurationFrames(r.frames, r.speed, speedPercent, minusOne),
    hitTick: af < 0 ? -1 : frameToTick(af, r.speed, speedPercent),
  };
}

/**
 * 피격 경직(GetHit) 여부. 반환 true = 경직 발생.
 * 출처: D2MOO SUnitDmg.cpp sub_6FCC1870 — 피해(1/256 단위) < 256 이면 없음, 히트클래스별 제수 8/16/32/64,
 *       maxHP/제수 미만 없음, maxHP/(제수/2) 미만 50%, maxHP/(제수/4) 미만 25% 로 없음
 */
export function rollGetHit(damage: number, maxHp: number, hitClass: number, rng: Rng, hasGetHitMode = true): boolean {
  const dmg256 = Math.floor(damage * 256), hp256 = Math.floor(maxHp * 256);
  if (dmg256 < 256) return false;
  const base = hitClass & 0x0f;
  let div = 16;
  if (base === 2 || base === 6 || base === 10 || base === 11) div = 8; // OneHandSwingVsSmall, OneHandThrust, Bow, Crossbow
  else if (base === 5) div = 64; // TwoHandSwingVsLarge
  else if (base === 4 || base === 8) div = 32; // TwoHandSwingVsSmall, Club
  if (dmg256 < hp256 / div) return false;
  if (dmg256 < hp256 / (div / 2) && !(rng.next() & 1n)) return false;
  if (dmg256 < hp256 / (div / 4) && !(rng.next() & 3n)) return false;
  return hasGetHitMode;
}
