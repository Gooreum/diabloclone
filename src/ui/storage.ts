// 브라우저 IndexedDB 에 캐릭터 저장 (원작처럼 캐릭터 단위 슬롯)
import { parseSave, serializeSave, summarize, type CharacterSave, type HeroSummary } from '../engine/save';

const DB = 'diabloclone', STORE = 'heroes';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const HeroStore = {
  async list(): Promise<HeroSummary[]> {
    const all = (await tx('readonly', (s) => s.getAll())) as string[];
    return all.map((t) => summarize(parseSave(t))).sort((a, b) => b.savedAt - a.savedAt);
  },
  async load(name: string): Promise<CharacterSave | null> {
    const t = (await tx('readonly', (s) => s.get(name))) as string | undefined;
    return t ? parseSave(t) : null;
  },
  async save(s: CharacterSave): Promise<void> {
    await tx('readwrite', (st) => st.put(serializeSave(s), s.name));
  },
  async remove(name: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(name));
  },
};
