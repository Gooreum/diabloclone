// 유저가 고른 원작 MPQ 를 브라우저(IndexedDB)에 보관하고, 필요한 부분만 잘라 읽는다.
// 원작 파일은 서버로 보내지 않는다 — 각자 가진 D2 설치 파일로만 플레이한다.
import { LOD_MPQS } from './edition';
import type { RangeFetcher } from './remote';

/** 그래픽·표 (없으면 시작할 수 없다) */
export const REQUIRED_MPQS = ['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq'] as const;
/** 효과음·대사·음악 (없으면 소리 없이 — SoundFiles.open 은 못 연 파일을 건너뛴다) */
export const OPTIONAL_MPQS = ['d2sfx.mpq', 'd2speech.mpq', 'd2music.mpq'] as const;
/** 확장팩 파일은 있으면 확장팩으로 (edition.ts) */
export const ALL_MPQS: readonly string[] = [...REQUIRED_MPQS, ...OPTIONAL_MPQS, ...LOD_MPQS];

const DB = 'diabloclone-mpq', STORE = 'files';

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

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const MpqStore = {
  async all(): Promise<Map<string, Blob>> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const out = new Map<string, Blob>();
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out.set(String(c.key), c.value as Blob);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },
  async put(name: string, b: Blob): Promise<void> {
    await run('readwrite', (s) => s.put(b, name));
  },
  async clear(): Promise<void> {
    await run('readwrite', (s) => s.clear());
  },
  /** 필수 MPQ 중 없는 것 */
  missing(have: Map<string, Blob>): string[] {
    return REQUIRED_MPQS.filter((n) => !have.has(n));
  },
};
