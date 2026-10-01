// 유닛 상태 (원작 states.txt 의 상태 + 그 상태가 붙인 스탯 목록). 버프·저주·냉기·독·기절 등.
// 출처: D2MOO D2Common STATLIST_AllocStatList(만료 프레임) / STATES_ToggleState, D2Game SUNITDMG_ApplyColdState·ApplyPoisonDamage
//       (같은 상태가 다시 걸리면 새 스탯 목록을 만들지 않고 만료 프레임·값을 갱신)

export interface UnitState {
  /** states.txt 상태 이름 (cold, poison, freeze, stunned, shout, taunt …) */
  name: string;
  /** 만료 프레임 (Infinity = 해제 전까지) */
  until: number;
  /** 스탯 이름(itemstatcost.txt) → 값 */
  stats: Record<string, number>;
  /** 상태를 건 스킬 (Frozen Armor 이벤트 등에서 스킬 수치를 다시 계산할 때) */
  skill?: { id: number; lvl: number };
}

export class StateList {
  private readonly list: UnitState[] = [];

  /** 상태 부여. 이미 있으면 스탯을 교체하고 만료 프레임은 더 늦은 쪽으로 */
  set(name: string, until: number, stats: Record<string, number> = {}, skill?: { id: number; lvl: number }): void {
    const cur = this.list.find((s) => s.name === name);
    if (cur) {
      cur.until = Math.max(cur.until, until);
      cur.stats = stats;
      if (skill) cur.skill = skill;
      return;
    }
    this.list.push({ name, until, stats, ...(skill ? { skill } : {}) });
  }

  get(name: string): UnitState | undefined {
    return this.list.find((s) => s.name === name);
  }

  has(name: string): boolean {
    return this.list.some((s) => s.name === name);
  }

  remove(name: string): void {
    const i = this.list.findIndex((s) => s.name === name);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** 모든 상태의 스탯 합 */
  stat(stat: string): number {
    let v = 0;
    for (const s of this.list) v += s.stats[stat] ?? 0;
    return v;
  }

  /** 상태마다 값을 바꿔 합산 (면역 몬스터의 저항 감소 1/5 등) */
  statBy(stat: string, f: (v: number, s: UnitState) => number): number {
    let v = 0;
    for (const s of this.list) {
      const x = s.stats[stat];
      if (x) v += f(x, s);
    }
    return v;
  }

  /** 만료된 상태 제거, 제거된 이름 반환 */
  expire(frame: number): string[] {
    const gone: string[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i] as UnitState;
      if (frame >= s.until) {
        gone.push(s.name);
        this.list.splice(i, 1);
      }
    }
    return gone;
  }

  /** 상태 이름 목록 */
  names(): string[] {
    return this.list.map((s) => s.name);
  }

  clear(): void {
    this.list.length = 0;
  }
}

/** 상태 오버레이 그림 (overlay.txt 한 행) */
export interface StateOverlayDef { file: string; frames: number; predraw: boolean; /** overlay.txt Trans (0 불투명, 그 밖 = 빛 더하기) */ trans?: number }

/** overlay.txt 이름(소문자) → 그림. 'null' 그림은 뺀다 */
export function parseOverlays(overlays: Record<string, string | undefined>[]): Map<string, StateOverlayDef> {
  const ov = new Map<string, StateOverlayDef>();
  for (const r of overlays) {
    const file = r.Filename ?? '';
    if (!r.overlay || !file || file.toLowerCase() === 'null') continue;
    ov.set(r.overlay.toLowerCase(), { file, frames: Math.max(1, Number(r.Frames ?? 1) || 1), predraw: r.PreDraw === '1', trans: Number(r.Trans ?? 0) || 0 });
  }
  return ov;
}

/**
 * states.txt overlay1~4 → overlay.txt (Filename, Frames, PreDraw). 'null' 그림은 뺀다.
 * 출처: 원작 MPQ data/global/excel/states.txt · overlay.txt (그림 = data\global\overlays\<Filename>.dcc)
 */
export function parseStateOverlays(states: Record<string, string | undefined>[], overlays: Record<string, string | undefined>[]): Map<string, StateOverlayDef[]> {
  const ov = parseOverlays(overlays);
  const out = new Map<string, StateOverlayDef[]>();
  for (const r of states) {
    if (!r.state) continue;
    const list = ['overlay1', 'overlay2', 'overlay3', 'overlay4'].map((k) => ov.get((r[k] ?? '').toLowerCase())).filter((x): x is StateOverlayDef => !!x);
    if (list.length) out.set(r.state, list);
  }
  return out;
}

/** states.txt group (같은 group 의 상태는 하나만 — SrvDo018 DefensiveBuff 가 지운다). 0 이면 없음 */
/** states.txt 변신·주기 정보: srvactivefunc (Hurricane 145·Armageddon 146), restrict·transform, gfxtype 1 = 몬스터 그림 gfxclass (monstats hcIdx) */
export interface StateInfo { srvActive: number; restrict: boolean; transform: boolean; gfxType: number; gfxClass: number }

export function parseStateInfo(states: Record<string, string | undefined>[]): Map<string, StateInfo> {
  const out = new Map<string, StateInfo>();
  for (const r of states) {
    if (!r.state) continue;
    const info = { srvActive: Number(r.srvactivefunc) || 0, restrict: r.restrict === '1', transform: r.transform === '1', gfxType: Number(r.gfxtype) || 0, gfxClass: Number(r.gfxclass) || 0 };
    if (info.srvActive || info.restrict || info.transform || info.gfxType) out.set(r.state, info);
  }
  return out;
}

export function parseStateGroups(states: Record<string, string | undefined>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of states) if (r.state && Number(r.group)) out.set(r.state, Number(r.group));
  return out;
}
