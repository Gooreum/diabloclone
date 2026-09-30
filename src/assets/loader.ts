// 원작 MPQ 체인 (patch_d2 > d2char > d2data) 비동기 로더 + 동기 AssetSource 캐시.
import type { AssetSource } from '../data/tables';
import { MpqRemote, type RangeFetcher, httpRange } from './remote';

export const MPQ_ORDER = ['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq'] as const;

export class AssetLoader implements AssetSource {
  private readonly archives: MpqRemote[];
  private readonly cache = new Map<string, Uint8Array | null>();

  private constructor(archives: MpqRemote[]) {
    this.archives = archives;
  }

  static async open(baseUrl = '/d2/', fetchRange: RangeFetcher = httpRange): Promise<AssetLoader> {
    return new AssetLoader(await Promise.all(MPQ_ORDER.map((f) => MpqRemote.open(baseUrl + f, fetchRange))));
  }

  private key(path: string): string {
    return path.toLowerCase().replace(/\//g, '\\');
  }

  async load(path: string): Promise<Uint8Array | null> {
    const k = this.key(path);
    if (this.cache.has(k)) return this.cache.get(k) ?? null;
    for (const a of this.archives) {
      if (a.has(path)) {
        const b = await a.read(path);
        this.cache.set(k, b);
        return b;
      }
    }
    this.cache.set(k, null);
    return null;
  }

  /**
   * 한 번 쓰고 버릴 파일 (몬스터·미사일 DCC 처럼 읽어서 해석한 결과만 보관하는 것): 캐시에 남기지 않는다.
   * 원본 바이트를 전부 영구 보관하면 몬스터 종류가 많은 곳에서 메모리가 계속 늘었다.
   */
  async loadOnce(path: string): Promise<Uint8Array | null> {
    const k = this.key(path);
    if (this.cache.has(k)) {
      const hit = this.cache.get(k) ?? null;
      this.cache.delete(k);
      return hit;
    }
    for (const a of this.archives) if (a.has(path)) return a.read(path);
    return null;
  }

  async preload(paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => this.load(p)));
  }

  /** 동기 접근: preload/load 된 파일만 반환 */
  read(path: string): Uint8Array | null {
    const k = this.key(path);
    if (!this.cache.has(k)) throw new Error(`asset not preloaded: ${path}`);
    return this.cache.get(k) ?? null;
  }

  has(path: string): boolean {
    return this.archives.some((a) => a.has(path));
  }
}
