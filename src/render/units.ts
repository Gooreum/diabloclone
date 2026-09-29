// 유닛 렌더: COF 레이어 합성 (플레이어·몬스터), 바닥 아이템(flippy DC6).
// 출처: Phrozen Keep — COF/DCC 문서: 경로 <토큰>\COF\<토큰><모드><무기클래스>.COF,
//       레이어 DCC = <토큰>\<레이어>\<토큰><레이어><외형코드><모드><레이어 무기클래스>.dcc, 프레임별 레이어 순서 = COF priority
// 출처: OpenDiablo2 d2dcc/dcc_dir_lookup.go Dir64ToDcc (64방향 → 파일 방향 인덱스)
import { parseCof, type Cof } from '../formats/cof';
import { parseDcc, type Dcc } from '../formats/dcc';
import { parseDc6 } from '../formats/dc6';
import type { Palette } from '../formats/palette';
import { indexedToCanvas, type Drawable } from './sprites';

export interface AsyncAssets { load(path: string): Promise<Uint8Array | null> }

// 출처: OpenDiablo2 dcc_dir_lookup.go (64방향 테이블)
const DIR4 = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0];
const DIR8 = [4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 6, 6, 6, 6, 6, 6, 6, 6, 2, 2, 2, 2, 2, 2, 2, 2, 7, 7, 7, 7, 7, 7, 7, 7, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4];
const DIR16 = [4, 4, 8, 8, 8, 8, 0, 0, 0, 0, 9, 9, 9, 9, 5, 5, 5, 5, 10, 10, 10, 10, 1, 1, 1, 1, 11, 11, 11, 11, 6, 6, 6, 6, 12, 12, 12, 12, 2, 2, 2, 2, 13, 13, 13, 13, 7, 7, 7, 7, 14, 14, 14, 14, 3, 3, 3, 3, 15, 15, 15, 15, 4, 4];
const DIR32 = [4, 16, 16, 8, 8, 17, 17, 0, 0, 18, 18, 9, 9, 19, 19, 5, 5, 20, 20, 10, 10, 21, 21, 1, 1, 22, 22, 11, 11, 23, 23, 6, 6, 24, 24, 12, 12, 25, 25, 2, 2, 26, 26, 13, 13, 27, 27, 7, 7, 28, 28, 14, 14, 29, 29, 3, 3, 30, 30, 15, 15, 31, 31, 4];

export function dir64ToFile(dir64: number, numDirs: number): number {
  const d = ((dir64 % 64) + 64) % 64;
  if (numDirs <= 1) return 0;
  if (numDirs === 4) return DIR4[d] ?? 0;
  if (numDirs === 8) return DIR8[d] ?? 0;
  if (numDirs === 16) return DIR16[d] ?? 0;
  if (numDirs === 32) return DIR32[d] ?? 0;
  return d % numDirs;
}

interface LayerGfx { dcc: Dcc; canvases: Map<number, Drawable> }
export interface Composite { cof: Cof; layers: Map<number, LayerGfx> }

export interface CompositeSpec {
  /** 'CHARS' 또는 'MONSTERS' */
  root: 'CHARS' | 'MONSTERS';
  token: string;
  mode: string;
  wclass: string;
  /** 레이어 이름(HD, TR, RH …) → 외형 코드 (lit, hax, buc …) */
  equip: Record<string, string>;
}

const specKey = (s: CompositeSpec) => `${s.root}/${s.token}/${s.mode}/${s.wclass}/${Object.entries(s.equip).sort().map(([k, v]) => `${k}=${v}`).join(',')}`;

export class UnitGfx {
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;
  private readonly cache = new Map<string, Composite | null | Promise<void>>();

  constructor(assets: AsyncAssets, pal: Palette) {
    this.assets = assets;
    this.pal = pal;
  }

  /** 준비되면 Composite, 로딩 중이면 undefined, 없으면 null */
  get(spec: CompositeSpec): Composite | null | undefined {
    const k = specKey(spec);
    const hit = this.cache.get(k);
    if (hit instanceof Promise) return undefined;
    if (hit !== undefined) return hit;
    this.cache.set(k, this.load(spec).then((c) => void this.cache.set(k, c)).catch(() => void this.cache.set(k, null)));
    return undefined;
  }

  private async load(s: CompositeSpec): Promise<Composite | null> {
    const base = `data\\global\\${s.root}\\${s.token}`;
    const cofBytes = await this.assets.load(`${base}\\COF\\${s.token}${s.mode}${s.wclass}.COF`);
    if (!cofBytes) return null;
    const cof = parseCof(cofBytes);
    const layers = new Map<number, LayerGfx>();
    await Promise.all(
      cof.layers.map(async (l) => {
        const code = s.equip[l.name];
        if (!code) return;
        const b = await this.assets.load(`${base}\\${l.name}\\${s.token}${l.name}${code}${s.mode}${l.weaponClass}.dcc`);
        if (b) layers.set(l.type, { dcc: parseDcc(b), canvases: new Map() });
      }),
    );
    return { cof, layers };
  }

  /** 합성 유닛 그리기. (x,y) = 유닛 발 위치 캔버스 좌표 */
  draw(ctx: CanvasRenderingContext2D, comp: Composite, dir64: number, frame: number, x: number, y: number): void {
    const cof = comp.cof;
    const d = dir64ToFile(dir64, cof.directions);
    const f = ((frame % cof.framesPerDirection) + cof.framesPerDirection) % cof.framesPerDirection;
    const order = cof.priority[d]?.[f] ?? cof.layers.map((l) => l.type);
    for (const type of order) {
      const lg = comp.layers.get(type);
      if (!lg) continue;
      const dir = lg.dcc.directions[d];
      const fr = dir?.frames[Math.min(f, dir.frames.length - 1)];
      if (!dir || !fr) continue;
      const key = d * 1000 + f;
      let c = lg.canvases.get(key);
      if (!c) {
        c = indexedToCanvas(fr.pixels, dir.box.width, dir.box.height, this.pal);
        lg.canvases.set(key, c);
      }
      ctx.drawImage(c as CanvasImageSource, x + dir.box.left, y + dir.box.top);
    }
  }
}

/** 바닥 아이템: flippy DC6 의 마지막 프레임 (떨어진 뒤 정지 모습) */
export class ItemGfx {
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;
  private readonly cache = new Map<string, { canvas: Drawable; w: number; h: number; ox: number; oy: number } | null | 'loading'>();

  constructor(assets: AsyncAssets, pal: Palette) {
    this.assets = assets;
    this.pal = pal;
  }

  draw(ctx: CanvasRenderingContext2D, flippyFile: string, x: number, y: number): { w: number; h: number; x: number; y: number } | null {
    const hit = this.cache.get(flippyFile);
    if (hit === undefined) {
      this.cache.set(flippyFile, 'loading');
      this.assets
        .load(`data\\global\\items\\${flippyFile}.dc6`)
        .then((b) => {
          if (!b) return void this.cache.set(flippyFile, null);
          const dc6 = parseDc6(b);
          const fr = dc6.frames[dc6.frames.length - 1];
          if (!fr) return void this.cache.set(flippyFile, null);
          this.cache.set(flippyFile, { canvas: indexedToCanvas(fr.pixels, fr.width, fr.height, this.pal), w: fr.width, h: fr.height, ox: fr.offsetX, oy: fr.offsetY });
        })
        .catch(() => this.cache.set(flippyFile, null));
      return null;
    }
    if (!hit || hit === 'loading') return null;
    // 출처: Phrozen Keep DC6 문서 — offsetY 는 프레임 아래쪽 기준
    ctx.drawImage(hit.canvas as CanvasImageSource, x + hit.ox, y + hit.oy - hit.h);
    return { w: hit.w, h: hit.h, x: x + hit.ox, y: y + hit.oy - hit.h };
  }
}

/**
 * 미사일 그래픽: data\global\missiles\<CelFile>.dcc (missiles.txt CelFile).
 * 출처: Phrozen Keep — Missiles.txt File Guide (CelFile = missiles 폴더의 DCC 이름)
 * 근사(원작 미확인): 원작의 Trans(반투명/가산 혼합)·높이(zoffset)·광원은 아직 반영하지 않는다.
 */
export class MissileGfx {
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;
  private readonly cache = new Map<string, LayerGfx | null | 'loading'>();

  constructor(assets: AsyncAssets, pal: Palette) {
    this.assets = assets;
    this.pal = pal;
  }

  draw(ctx: CanvasRenderingContext2D, celFile: string, dir64: number, frame: number, x: number, y: number): void {
    const key = celFile.toLowerCase();
    const hit = this.cache.get(key);
    if (hit === undefined) {
      this.cache.set(key, 'loading');
      this.assets
        .load(`data\\global\\missiles\\${celFile}.dcc`)
        .then((b) => this.cache.set(key, b ? { dcc: parseDcc(b), canvases: new Map() } : null))
        .catch(() => this.cache.set(key, null));
      return;
    }
    if (!hit || hit === 'loading') return;
    const d = dir64ToFile(dir64, hit.dcc.directions.length);
    const dir = hit.dcc.directions[d];
    if (!dir || !dir.frames.length) return;
    const f = ((frame % dir.frames.length) + dir.frames.length) % dir.frames.length;
    const fr = dir.frames[f];
    if (!fr) return;
    const k = d * 1000 + f;
    let c = hit.canvases.get(k);
    if (!c) {
      c = indexedToCanvas(fr.pixels, dir.box.width, dir.box.height, this.pal);
      hit.canvases.set(k, c);
    }
    ctx.drawImage(c as CanvasImageSource, x + dir.box.left, y + dir.box.top);
  }
}
