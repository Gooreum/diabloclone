// 조명: 레벨 주변광 + 광원(플레이어·몬스터·미사일·오브젝트)의 빛 반경 → 서브타일 밝기 0~31 (PL2 밝기 단계 표 줄 번호).
// 출처: levels.txt IsInside (실내 = 어둠), monstats2.txt Light (몬스터 빛 반경)·Shadow, missiles.txt Light, objects.txt Lit0~7 (모드별 빛),
//       ItemStatCost item_lightradius (아이템 빛 반경 보너스), Pal.PL2 밝기 단계 표 32줄 (0 = 가장 어둡게, 31 = 원래 색)
// 근사(원작 미확인): 원작 클라이언트(D2Client 조명)는 공개 소스가 없다.
//   - 플레이어 기본 빛 반경 PLAYER_LIGHT, 반경 안 밝기 곡선(직선 감쇠), 오브젝트 Lit 값 배율(½)
//   - 야외 밝기 매핑 (ambientOf)
import type { TxtRow } from '../formats/txt';

/** 밝기 단계 최댓값 (PL2 항등 줄) */
export const FULL_LIGHT = 31;
/** 근사(원작 미확인): 플레이어 기본 빛 반경 (서브타일) */
export const PLAYER_LIGHT = 13;
/** 근사(원작 미확인): objects.txt Lit 값 → 서브타일 반경 배율 (횃불 19 → 9.5) */
export const OBJECT_LIGHT_SCALE = 0.5;

export interface LightSource { x: number; y: number; r: number }

/**
 * 주변광: 실내(IsInside) = 0 (빛 밖은 검정), 야외·마을 = 낮·밤 밝기 (Environment.intensity 0~255).
 * 근사(원작 미확인): 클라이언트의 밝기 → 밝기 단계 매핑. 낮(128 이상) = 원래 밝기, 그 아래는 제곱근 곡선으로
 *   어두운 야외도 멀리까지 보이게 — 한밤(64) 22단계, 일식(32) 16단계, Act 4 불꽃의 강(16) 11단계
 */
export const ambientOf = (inside: boolean, intensity = 255): number =>
  inside ? 0 : Math.round(FULL_LIGHT * Math.sqrt(Math.min(1, Math.max(0, intensity) / 128)));

/** (x,y) 서브타일의 밝기 0~31: 가장 밝은 광원 기준 직선 감쇠, 주변광보다 어둡지 않다 */
export function lightAt(ambient: number, src: readonly LightSource[], x: number, y: number): number {
  let l = ambient;
  for (const s of src) {
    if (s.r <= 0) continue;
    const d = Math.hypot(x - s.x, y - s.y);
    if (d < s.r) l = Math.max(l, Math.round(FULL_LIGHT * (1 - d / s.r)));
  }
  return l;
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 원작 표에서 뽑은 빛 값 */
export class LightTables {
  private readonly inside = new Map<number, boolean>();
  private readonly monLight = new Map<string, number>();
  private readonly monShadow = new Map<string, boolean>();
  private readonly misLight = new Map<string, number>();
  private readonly objectLit = new Map<number, number[]>();

  constructor(t: { levels: readonly TxtRow[]; monStats: readonly TxtRow[]; monStats2: readonly TxtRow[]; missiles: readonly TxtRow[]; objects: readonly TxtRow[] }) {
    for (const r of t.levels) if (r.Id) this.inside.set(num(r.Id), num(r.IsInside) === 1);
    // monstats Id → MonStatsEx → monstats2 행
    const m2 = new Map<string, TxtRow>();
    for (const r of t.monStats2) if (r.Id) m2.set(r.Id.toLowerCase(), r);
    for (const r of t.monStats) {
      if (!r.Id) continue;
      const ex = m2.get((r.MonStatsEx || r.Id).toLowerCase());
      if (!ex) continue;
      const id = r.Id.toLowerCase();
      if (num(ex.Light) > 0) this.monLight.set(id, num(ex.Light));
      this.monShadow.set(id, num(ex.Shadow) === 1);
    }
    for (const r of t.missiles) if (r.Missile && num(r.Light) > 0) this.misLight.set(r.Missile.toLowerCase(), num(r.Light));
    for (const r of t.objects) {
      if (!r.Id) continue;
      const lit = Array.from({ length: 8 }, (_, i) => num(r[`Lit${i}`]));
      if (lit.some((v) => v > 0)) this.objectLit.set(num(r.Id), lit);
    }
  }

  /** levels.txt IsInside (없는 레벨 = 야외) */
  isInside(levelNo: number): boolean {
    return this.inside.get(levelNo) ?? false;
  }
  monsterLight(typeId: string): number {
    return this.monLight.get(typeId.toLowerCase()) ?? 0;
  }
  /** monstats2 Shadow (표에 없으면 그림자 있음) */
  monsterShadow(typeId: string): boolean {
    return this.monShadow.get(typeId.toLowerCase()) ?? true;
  }
  missileLight(name: string): number {
    return this.misLight.get(name.toLowerCase()) ?? 0;
  }
  /** objects.txt Lit<모드> × 배율 */
  objectLight(classId: number, mode: number): number {
    return (this.objectLit.get(classId)?.[mode] ?? 0) * OBJECT_LIGHT_SCALE;
  }
}

/** 스냅샷에서 필요한 부분 (엔진 WorldSnapshot 과 같은 모양) */
export interface LightScene {
  player: { x: number; y: number };
  monsters: readonly { typeId: string; x: number; y: number; mode: string }[];
  missiles: readonly { name: string; x: number; y: number }[];
  objects?: readonly { classId: number; mode: number; x: number; y: number }[];
}

/** 이번 프레임 광원 목록. playerRadius = PLAYER_LIGHT + 아이템 빛 반경 */
export function lightSources(s: LightScene, t: LightTables, playerRadius: number): LightSource[] {
  const out: LightSource[] = [{ x: s.player.x, y: s.player.y, r: Math.max(0, playerRadius) }];
  for (const m of s.monsters) {
    if (m.mode === 'DD') continue;
    const r = t.monsterLight(m.typeId);
    if (r > 0) out.push({ x: m.x, y: m.y, r });
  }
  for (const ms of s.missiles) {
    const r = t.missileLight(ms.name);
    if (r > 0) out.push({ x: ms.x, y: ms.y, r });
  }
  for (const o of s.objects ?? []) {
    const r = t.objectLight(o.classId, o.mode);
    if (r > 0) out.push({ x: o.x, y: o.y, r });
  }
  return out;
}
