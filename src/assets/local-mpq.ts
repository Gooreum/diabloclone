// 유저가 고른 원작 MPQ 를 브라우저(IndexedDB)에 보관하고, 필요한 부분만 잘라 읽는다.
// 원작 파일은 서버로 보내지 않는다 — 각자 가진 D2 설치 파일로만 플레이한다.
import { LOD_MPQS } from './edition';
import type { RangeFetcher } from './remote';

/** 그래픽·표 (없으면 시작할 수 없다) */
export const REQUIRED_MPQS = ['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq'] as const;
/** 효과음·대사·음악 (없으면 소리 없이 — SoundFiles.open 은 못 연 파일을 건너뛴다) */
export const OPTIONAL_MPQS = ['d2sfx.mpq', 'd2speech.mpq', 'd2music.mpq'] as const;
/** 디아블로 1 (정식 diabdat.mpq / 쉐어웨어 spawn.mpq). 있으면 D2 파일 없이도 시작할 수 있고, D2 와 같이 있으면 타이틀에 "Diablo I" 단추 */
export const D1_MPQS = ['diabdat.mpq', 'spawn.mpq'] as const;
export type D1MpqName = (typeof D1_MPQS)[number];
/** 디아블로 1 헬파이어 확장팩 (GOG 설치 파일의 hellfire 폴더). 정식판 diabdat.mpq 와 같이 있을 때만 엔진에 넘긴다 */
export const HELLFIRE_MPQS = ['hellfire.mpq', 'hfmonk.mpq', 'hfmusic.mpq', 'hfvoice.mpq'] as const;
/** 확장팩 파일은 있으면 확장팩으로 (edition.ts) */
export const ALL_MPQS: readonly string[] = [...REQUIRED_MPQS, ...OPTIONAL_MPQS, ...LOD_MPQS, ...D1_MPQS, ...HELLFIRE_MPQS];

/** 보관 파일 중 디아블로 1 파일 (정식판 우선). 없으면 null */
export function d1FileOf(names: Iterable<string>): { name: D1MpqName; spawn: boolean } | null {
  const have = new Set([...names].map((n) => n.split(/[\\/]/).pop()!.toLowerCase()));
  for (const name of D1_MPQS) if (have.has(name)) return { name, spawn: name === 'spawn.mpq' };
  return null;
}

/** 파일 이름 → 표준 이름 (대소문자 무시). 모르는 파일이면 null */
export function canonicalName(name: string): string | null {
  const base = name.split(/[\\/]/).pop()!.toLowerCase();
  return ALL_MPQS.includes(base) ? base : null;
}

/** 앞 4바이트가 'MPQ\x1a' 인지 */
export async function isMpq(b: Blob): Promise<boolean> {
  if (b.size < 32) return false;
  const h = new Uint8Array(await b.slice(0, 4).arrayBuffer());
  return h[0] === 0x4d && h[1] === 0x50 && h[2] === 0x51 && h[3] === 0x1a;
}

/** Blob 모음 → RangeFetcher (url 끝의 파일 이름으로 찾는다). Blob 은 디스크에 있고 필요한 조각만 읽는다 */
export function blobRange(files: Map<string, Blob>): RangeFetcher {
  return async (url, start, length) => {
    const name = canonicalName(url);
    const b = name ? files.get(name) : undefined;
    if (!b) throw new Error(`MPQ not loaded: ${url}`);
    return new Uint8Array(await b.slice(start, start + length).arrayBuffer());
  };
}

const STORE = 'files';

/** IndexedDB 한 저장소 (키 → 값). 원작 MPQ(Blob) 와 디아블로 1 세이브(Uint8Array) 가 각자 DB 이름으로 쓴다 */
export function kvStore<T>(db: string) {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const req = indexedDB.open(db, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async <R>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    async all(): Promise<Map<string, T>> {
      const d = await open();
      return new Promise((resolve, reject) => {
        const out = new Map<string, T>();
        const req = d.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve(out);
          out.set(String(c.key), c.value as T);
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    },
    async put(name: string, v: T): Promise<void> {
      await run('readwrite', (s) => s.put(v, name));
    },
    async remove(name: string): Promise<void> {
      await run('readwrite', (s) => s.delete(name));
    },
    async clear(): Promise<void> {
      await run('readwrite', (s) => s.clear());
    },
  };
}

export const MpqStore = {
  ...kvStore<Blob>('diabloclone-mpq'),
  /** 필수 MPQ 중 없는 것 */
  missing(have: Map<string, Blob>): string[] {
    return REQUIRED_MPQS.filter((n) => !have.has(n));
  },
};
