// 원작 excel 테이블 로더. 게임 수치는 코드에 하드코딩하지 않고 여기서 읽는다.
// 출처: Phrozen Keep — File Guides (https://d2mods.info/forum/kb/index?c=4)
import { parseTxt, type TxtRow } from '../formats/txt';
import { parseTbl } from '../formats/tbl';

/** MPQ 체인 등 경로 → 바이트 제공자 (브라우저: fetch 캐시, 테스트: 로컬 MPQ) */
export interface AssetSource {
  read(path: string): Uint8Array | null;
}

export class GameTables {
  private readonly src: AssetSource;
  private readonly cache = new Map<string, TxtRow[]>();
  private stringsCache: Map<string, string> | null = null;

  constructor(src: AssetSource) {
    this.src = src;
  }

  /** data\global\excel\<name>.txt (대소문자 무시) */
  table(name: string): TxtRow[] {
    const key = name.toLowerCase();
    const hit = this.cache.get(key);
    if (hit) return hit;
    const bytes = this.src.read(`data\\global\\excel\\${name}.txt`);
    if (!bytes) throw new Error(`excel table not found: ${name}.txt`);
    const rows = parseTxt(new TextDecoder('latin1').decode(bytes));
    this.cache.set(key, rows);
    return rows;
  }

  /** 첫 번째로 key 컬럼 값이 value 인 행 */
  row(name: string, keyColumn: string, value: string): TxtRow | undefined {
    return this.table(name).find((r) => r[keyColumn] === value);
  }

  /** 원작 문자열 (string.tbl → expansionstring.tbl → patchstring.tbl 순으로 덮어씀) */
  string(key: string): string {
    if (!this.stringsCache) {
      this.stringsCache = new Map();
      for (const f of ['string.tbl', 'expansionstring.tbl', 'patchstring.tbl']) {
        const b = this.src.read(`data\\local\\lng\\eng\\${f}`);
        if (b) for (const [k, v] of parseTbl(b)) this.stringsCache.set(k, v);
      }
    }
    return this.stringsCache.get(key) ?? key;
  }
}

export const num = (v: string | undefined, fallback = 0): number => {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? fallback : n;
};
