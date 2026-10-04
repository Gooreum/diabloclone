// 원작 excel 테이블 로더. 게임 수치는 코드에 하드코딩하지 않고 여기서 읽는다.
// 출처: Phrozen Keep — File Guides (https://d2mods.info/forum/kb/index?c=4)
import { parseTxt, type TxtRow } from '../formats/txt';
import { parseTbl } from '../formats/tbl';
import { langLayers, STRING_TABLES, type Lang } from './lang';

/** MPQ 체인 등 경로 → 바이트 제공자 (브라우저: fetch 캐시, 테스트: 로컬 MPQ) */
export interface AssetSource {
  read(path: string): Uint8Array | null;
}

export class GameTables {
  private readonly src: AssetSource;
  private readonly cache = new Map<string, TxtRow[]>();
  private stringsCache: Map<string, string> | null = null;
  /** 표시 언어 (문자열 표) */
  readonly lang: Lang;
  /** 자체 번역 — 고른 언어의 원작 표 어디에도 없는 키만 채운다 (공식 표가 있으면 공식 값 우선). 영어는 쓰지 않는다 */
  private readonly fallback: Readonly<Record<string, string>> | null;

  constructor(src: AssetSource, lang: Lang = 'eng', fallback: Readonly<Record<string, string>> | null = null) {
    this.src = src;
    this.lang = lang;
    this.fallback = lang === 'eng' ? null : fallback;
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

  /**
   * 원작 문자열 (string.tbl → expansionstring.tbl → patchstring.tbl 순으로 덮어씀).
   * 다른 언어는 영어 표를 먼저 깔고 그 언어의 있는 표로 덮는다. 그 언어 표에 한 번도 안 나온 키만 자체 번역(fallback)으로 채운다 —
   * 사용자 MPQ 에 kor\expansionstring.tbl 이 있으면 그 값이 이기고, 없으면(이 저장소의 기본 가정) 우리 번역이 쓰인다.
   */
  string(key: string): string {
    if (!this.stringsCache) {
      this.stringsCache = new Map();
      const own = new Set<string>(); // 고른 언어의 원작 표가 직접 준 키
      for (const l of langLayers(this.lang))
        for (const f of STRING_TABLES) {
          const b = this.src.read(`data\\local\\lng\\${l}\\${f}`);
          if (!b) continue;
          for (const [k, v] of parseTbl(b, l === 'eng' ? 'latin1' : 'utf-8')) {
            this.stringsCache.set(k, v);
            if (l !== 'eng') own.add(k);
          }
        }
      if (this.fallback) for (const [k, v] of Object.entries(this.fallback)) if (!own.has(k)) this.stringsCache.set(k, v);
    }
    return this.stringsCache.get(key) ?? key;
  }
}

export const num = (v: string | undefined, fallback = 0): number => {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? fallback : n;
};
