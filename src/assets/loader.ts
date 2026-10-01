// 원작 MPQ 체인 (patch_d2 > d2char > d2data) 비동기 로더 + 동기 AssetSource 캐시.
import type { AssetSource } from '../data/tables';
import { parseDcc } from '../formats/dcc';
import { GfxClient, type DccHandle } from './gfx-client';
import { MpqRemote, type RangeFetcher, httpRange } from './remote';

export const MPQ_ORDER = ['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq'] as const;

export class AssetLoader implements AssetSource {
  private readonly archives: MpqRemote[];
  private readonly cache = new Map<string, Uint8Array | null>();
  /** 압축 해제·DCC 해석 (웹 워커, 못 쓰면 메인 스레드) */
  private readonly gfx: GfxClient;

  private constructor(archives: MpqRemote[], gfx: GfxClient) {
    this.archives = archives;
    this.gfx = gfx;
  }

  static async open(baseUrl = '/d2/', fetchRange: RangeFetcher = httpRange, gfx = new GfxClient(), order: readonly string[] = MPQ_ORDER): Promise<AssetLoader> {
    return new AssetLoader(await Promise.all(order.map((f) => MpqRemote.open(baseUrl + f, fetchRange))), gfx);
  }

  /** 원본 블록을 받아 워커에서 해제 */
  private async readFile(a: MpqRemote, path: string): Promise<Uint8Array | null> {
    const block = a.findBlock(path);
    const raw = block ? await a.readRaw(path) : null;
    if (!block || !raw) return null;
    const r = await this.gfx.request({ kind: 'file', raw, block, sectorSize: a.sectorSize, path });
    if (!r.ok) throw new Error(r.error);
    return r.bytes ?? null;
  }

  private key(path: string): string {
    return path.toLowerCase().replace(/\//g, '\\');
  }

  async load(path: string): Promise<Uint8Array | null> {
    const k = this.key(path);
    if (this.cache.has(k)) return this.cache.get(k) ?? null;
    for (const a of this.archives) {
      if (a.has(path)) {
        const b = await this.readFile(a, path);
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
    for (const a of this.archives) if (a.has(path)) return this.readFile(a, path);
    return null;
  }

  /**
   * DCC 를 방향 단위로: 워커가 해제한 원본을 기억하고, 필요한 방향만 해석해 돌려준다.
   * 워커가 원본을 버렸으면(기억 상한) 다시 읽어 넘긴다.
   */
  async loadDcc(path: string): Promise<DccHandle | null> {
    const a = this.archives.find((x) => x.has(path));
    if (!a) return null;
    const key = this.key(path);
    const hit = this.cache.get(key);
    if (hit) {
      // 이미 통째로 읽어 둔 파일이면 여기서 해석
      const dcc = parseDcc(hit);
      return { directions: dcc.directions.length, framesPerDirection: dcc.framesPerDirection, dir: async (d) => dcc.directions[d] ?? null };
    }
    const open = async () => {
      const block = a.findBlock(path);
      const raw = block ? await a.readRaw(path) : null;
      if (!block || !raw) return null;
      const r = await this.gfx.request({ kind: 'dccHeader', key, raw, block, sectorSize: a.sectorSize, path });
      return r.ok ? r.header ?? null : null;
    };
    const h = await open();
    if (!h) return null;
    return {
      directions: h.directions,
      framesPerDirection: h.framesPerDirection,
      dir: async (d) => {
        let r = await this.gfx.request({ kind: 'dccDir', key, dir: d });
        if (!r.ok && r.missing && (await open())) r = await this.gfx.request({ kind: 'dccDir', key, dir: d });
        return r.ok ? r.direction ?? null : null;
      },
    };
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
