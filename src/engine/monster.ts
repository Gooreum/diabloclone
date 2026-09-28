// 몬스터 정의·인스턴스 생성·거리/근접 판정.
// 출처: D2MOO — D2Game/src/MONSTER/Monster.cpp (레벨 = monstats Level[난이도], HP = min + rand(max−min+1), HP 재생 = maxHP×DamageRegen>>12)
//       D2Common/src/DataTbls/MonsterTbls.cpp DATATBLS_CalculateMonsterStatsByLevel (MonLvl 기준값 × monstats % / 100,
//       싱글플레이 = 비-L 컬럼), D2Common/src/Monsters/Monsters.cpp MONSTERS_ApplyClassicScaling (Normal 은 보정 없음)
//       D2Common/src/Units/Units.cpp UNITS_IsInMeleeRange / D2Common_10399 (근접 거리 테이블)
//       D2Game/src/AI/AiUtil.cpp AIUTIL_GetDistanceToCoordinates_NoUnitSize (https://github.com/ThePhrozenKeep/D2MOO)
import type { TxtRow } from '../formats/txt';
import type { AnimData } from '../formats/animdata';
import { actionFrame, animDurationFrames, frameToTick } from '../formats/animdata';
import type { Rng } from './rng';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export interface AttackDef { min: number; max: number; toHit: number }

export interface MonsterType {
  id: string;
  nameStr: string;
  code: string;
  ai: string;
  baseW: string;
  level: number;
  minGrp: number; maxGrp: number;
  rarity: number;
  /** 야드/초 (플레이어 WalkVelocity 와 같은 단위) */
  velocity: number; run: number;
  minHpPct: number; maxHpPct: number; acPct: number; expPct: number;
  a1: AttackDef; a2: AttackDef;
  missA1: string; missA2: string;
  aiParams: number[];
  aiDelay: number;
  aiDist: number;
  toBlock: number;
  damageRegen: number;
  treasure: string[];
  sizeX: number;
  meleeRange: number;
  hitClass: number;
  resist: { dm: number; ma: number; fi: number; li: number; co: number; po: number };
  modes: Set<string>;
  /** monstats2 레이어별 외형 변형 (예: TR → ['lit','med','hvy']) */
  layers: Record<string, string[]>;
  undead: boolean; demon: boolean;
}

export class MonsterDb {
  readonly types = new Map<string, MonsterType>();
  private readonly monLvl: TxtRow[];

  constructor(monstats: TxtRow[], monstats2: TxtRow[], monLvl: TxtRow[]) {
    this.monLvl = monLvl;
    const s2 = new Map(monstats2.map((r) => [r.Id, r]));
    for (const r of monstats) {
      if (!r.Id || r.Id === 'Expansion') continue;
      const r2 = s2.get(r.Id) ?? {};
      const modes = new Set<string>();
      for (const m of ['DT', 'NU', 'WL', 'GH', 'A1', 'A2', 'BL', 'SC', 'S1', 'S2', 'S3', 'S4', 'DD', 'KB', 'SQ', 'RN']) if (n(r2[`m${m}`]) === 1) modes.add(m);
      const layers: Record<string, string[]> = {};
      for (const [col, name] of [['HD', 'HD'], ['TR', 'TR'], ['LG', 'LG'], ['RA', 'RA'], ['LA', 'LA'], ['RH', 'RH'], ['LH', 'LH'], ['SH', 'SH'], ['S1', 'S1'], ['S2', 'S2'], ['S3', 'S3'], ['S4', 'S4'], ['S5', 'S5'], ['S6', 'S6'], ['S7', 'S7'], ['S8', 'S8']] as const) {
        if (n(r2[col]) !== 1) continue;
        const vcol = col === 'RA' ? 'Rav' : col === 'LA' ? 'Lav' : `${col}v`;
        const v = (r2[vcol] ?? '').replace(/"/g, '').split(',').map((x) => x.trim()).filter(Boolean);
        layers[name] = v.length ? v : ['lit'];
      }
      this.types.set(r.Id, {
        id: r.Id, nameStr: r.NameStr ?? r.Id, code: r.Code ?? '', ai: r.AI ?? '', baseW: (r2.BaseW ?? 'hth').toUpperCase(),
        level: n(r.Level), minGrp: n(r.MinGrp), maxGrp: n(r.MaxGrp), rarity: n(r.Rarity), velocity: n(r.Velocity), run: n(r.Run),
        minHpPct: n(r.minHP), maxHpPct: n(r.maxHP), acPct: n(r.AC), expPct: n(r.Exp),
        a1: { min: n(r.A1MinD), max: n(r.A1MaxD), toHit: n(r.A1TH) }, a2: { min: n(r.A2MinD), max: n(r.A2MaxD), toHit: n(r.A2TH) },
        missA1: r.MissA1 ?? '', missA2: r.MissA2 ?? '',
        aiParams: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => n(r[`aip${i}`])),
        aiDelay: n(r.aidel), aiDist: n(r.aidist), toBlock: n(r.ToBlock), damageRegen: n(r.DamageRegen),
        treasure: [r.TreasureClass1 ?? '', r.TreasureClass2 ?? '', r.TreasureClass3 ?? '', r.TreasureClass4 ?? ''],
        sizeX: n(r2.SizeX) || 1, meleeRange: n(r2.MeleeRng), hitClass: n(r2.HitClass),
        resist: { dm: n(r.ResDm), ma: n(r.ResMa), fi: n(r.ResFi), li: n(r.ResLi), co: n(r.ResCo), po: n(r.ResPo) },
        modes, layers, undead: n(r.lUndead) === 1 || n(r.hUndead) === 1, demon: n(r.demon) === 1,
      });
    }
  }

  get(id: string): MonsterType {
    const t = this.types.get(id);
    if (!t) throw new Error(`monstats: unknown monster ${id}`);
    return t;
  }

  /** MonLvl.txt 기준값 (Normal = 비-L 첫 컬럼) */
  levelBase(level: number, col: 'AC' | 'TH' | 'HP' | 'DM' | 'XP'): number {
    const row = this.monLvl.find((r) => r.Level === String(level)) ?? this.monLvl[this.monLvl.length - 1];
    return n(row?.[col]);
  }
}

export interface MonsterStats {
  level: number;
  maxHp: number;
  defense: number;
  exp: number;
  a1: AttackDef;
  a2: AttackDef;
}

/** 출처: MonsterTbls ApplyRatio = MonLvl × % / 100 (정수 나눗셈), Monster.cpp HP = min + rand(max − min + 1) */
export function rollMonsterStats(db: MonsterDb, t: MonsterType, rng: Rng): MonsterStats {
  const lvl = t.level;
  const ratio = (col: 'AC' | 'TH' | 'HP' | 'DM' | 'XP', pct: number) => Math.trunc((db.levelBase(lvl, col) * pct) / 100);
  const minHp = ratio('HP', t.minHpPct), maxHp = ratio('HP', t.maxHpPct);
  const atk = (a: AttackDef): AttackDef => ({ min: ratio('DM', a.min), max: ratio('DM', a.max), toHit: ratio('TH', a.toHit) });
  return {
    level: lvl,
    maxHp: Math.max(1, minHp + rng.pick(maxHp - minHp + 1)),
    defense: ratio('AC', t.acPct),
    exp: ratio('XP', t.expPct),
    a1: atk(t.a1),
    a2: atk(t.a2),
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
