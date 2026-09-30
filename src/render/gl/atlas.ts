// 그림 아틀라스 배치 (GL 없는 순수 계산): 2048×2048 페이지에 선반(shelf) 방식으로 그림을 채운다.
// 페이지가 한도를 넘으면 가장 오래 안 쓴 페이지를 통째로 비우고 그 자리를 다시 쓴다.

export interface Slot { page: number; x: number; y: number; w: number; h: number }

interface Shelf { y: number; h: number; x: number }
interface Page { shelves: Shelf[]; nextY: number; lastUse: number; ids: string[] }

/** 선반 높이를 8 단위로 올려 비슷한 높이의 그림이 같은 선반을 쓰게 한다 */
const shelfHeight = (h: number) => Math.ceil(h / 8) * 8;

export class ShelfAtlas {
  readonly size: number;
  readonly maxPages: number;
  private readonly pages: Page[] = [];
  private readonly slots = new Map<string, Slot>();

  constructor(size = 2048, maxPages = 12) {
    this.size = size;
    this.maxPages = maxPages;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get count(): number {
    return this.slots.size;
  }

  /** 이미 올라간 그림 (쓴 시각 갱신) */
  get(id: string, now: number): Slot | undefined {
    const s = this.slots.get(id);
    if (s) (this.pages[s.page] as Page).lastUse = now;
    return s;
  }

  /**
   * 새 그림 자리. 너무 크면 null. evicted = 비운 페이지 번호 (그 페이지의 이전 그림은 더 이상 없다 —
   * 호출한 쪽은 그 페이지를 참조하는 그리기를 먼저 끝내야 한다)
   */
  place(id: string, w: number, h: number, now: number): { slot: Slot; evicted?: number } | null {
    if (w > this.size || h > this.size || w <= 0 || h <= 0) return null;
    for (let p = 0; p < this.pages.length; p++) {
      const s = this.fit(p, w, h);
      if (s) return { slot: this.commit(id, s, now) };
    }
    if (this.pages.length < this.maxPages) {
      this.pages.push({ shelves: [], nextY: 0, lastUse: now, ids: [] });
      return { slot: this.commit(id, this.fit(this.pages.length - 1, w, h) as Slot, now) };
    }
    // 가장 오래 안 쓴 페이지를 비운다
    let victim = 0;
    for (let p = 1; p < this.pages.length; p++) if ((this.pages[p] as Page).lastUse < (this.pages[victim] as Page).lastUse) victim = p;
    this.clearPage(victim);
    return { slot: this.commit(id, this.fit(victim, w, h) as Slot, now), evicted: victim };
  }

  /** 모두 잊는다 (그래픽 컨텍스트를 잃었다 되찾았을 때) */
  reset(): void {
    this.pages.length = 0;
    this.slots.clear();
  }

  private clearPage(p: number): void {
    const pg = this.pages[p] as Page;
    for (const id of pg.ids) this.slots.delete(id);
    pg.ids = [];
    pg.shelves = [];
    pg.nextY = 0;
  }

  private fit(p: number, w: number, h: number): Slot | null {
    const pg = this.pages[p] as Page;
    const sh = shelfHeight(h);
    for (const s of pg.shelves) {
      if (s.h === sh && s.x + w <= this.size) {
        const slot = { page: p, x: s.x, y: s.y, w, h };
        s.x += w;
        return slot;
      }
    }
    if (pg.nextY + sh > this.size) return null;
    const s: Shelf = { y: pg.nextY, h: sh, x: w };
    pg.shelves.push(s);
    pg.nextY += sh;
    return { page: p, x: 0, y: s.y, w, h };
  }

  private commit(id: string, s: Slot, now: number): Slot {
    const pg = this.pages[s.page] as Page;
    pg.ids.push(id);
    pg.lastUse = now;
    this.slots.set(id, s);
    return s;
  }
}

/** 색 바꿈 표 줄 배정 (0 번 줄 = 항등 표). 줄이 모자라면 가장 오래 안 쓴 줄을 다시 쓴다 */
export class ShiftRows {
  readonly rows: number;
  private readonly map = new Map<string, number>();
  private readonly lastUse: number[];

  constructor(rows = 64) {
    this.rows = rows;
    this.lastUse = new Array<number>(rows).fill(-1);
  }

  /** 줄 번호와, 새로 배정됐으면 fresh = true (표를 올려야 함) */
  row(key: string, now: number): { row: number; fresh: boolean } {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.lastUse[hit] = now;
      return { row: hit, fresh: false };
    }
    let r = 1;
    for (let i = 1; i < this.rows; i++) if ((this.lastUse[i] ?? -1) < (this.lastUse[r] ?? -1)) r = i;
    for (const [k, v] of this.map) if (v === r) this.map.delete(k);
    this.map.set(key, r);
    this.lastUse[r] = now;
    return { row: r, fresh: true };
  }

  reset(): void {
    this.map.clear();
    this.lastUse.fill(-1);
  }
}
