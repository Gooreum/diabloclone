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
}

export class StateList {
  private readonly list: UnitState[] = [];

  /** 상태 부여. 이미 있으면 스탯을 교체하고 만료 프레임은 더 늦은 쪽으로 */
  set(name: string, until: number, stats: Record<string, number> = {}): void {
    const cur = this.list.find((s) => s.name === name);
    if (cur) {
      cur.until = Math.max(cur.until, until);
      cur.stats = stats;
      return;
    }
    this.list.push({ name, until, stats });
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

  names(): string[] {
    return this.list.map((s) => s.name);
  }

  clear(): void {
    this.list.length = 0;
  }
}
