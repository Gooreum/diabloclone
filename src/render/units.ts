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
export interface Composite { cof: Cof; layers: Map<number, LayerGfx>; trans?: Uint8Array }

/** 팔레트 색 바꿈 표 (256 바이트: 원래 색 번호 → 바뀐 색 번호) */
export interface ColorShift { key: string; map: Uint8Array }

export interface CompositeSpec {
  /** 'CHARS', 'MONSTERS' 또는 'OBJECTS' */
  root: 'CHARS' | 'MONSTERS' | 'OBJECTS';
  token: string;
  mode: string;
  wclass: string;
  /** 레이어 이름(HD, TR, RH …) → 외형 코드 (lit, hax, buc …) */
  equip: Record<string, string>;
  /** 팔레트 색 바꿈 (몬스터 변종 palshift.dat · 유니크 RandTransforms.dat) */
  shift?: ColorShift | null;
}

const specKey = (s: CompositeSpec) => `${s.root}/${s.token}/${s.mode}/${s.wclass}/${Object.entries(s.equip).sort().map(([k, v]) => `${k}=${v}`).join(',')}/${s.shift?.key ?? ''}`;

export class UnitGfx {
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;
  private readonly cache = new Map<string, Composite | null | Promise<void>>();
  private readonly shiftFiles = new Map<string, Uint8Array | null | 'loading'>();

  constructor(assets: AsyncAssets, pal: Palette) {
    this.assets = assets;
    this.pal = pal;
  }

  private shiftFile(path: string): Uint8Array | null | undefined {
    const hit = this.shiftFiles.get(path);
    if (hit === 'loading') return undefined;
    if (hit !== undefined) return hit;
    this.shiftFiles.set(path, 'loading');
    this.assets.load(path).then((b) => this.shiftFiles.set(path, b)).catch(() => this.shiftFiles.set(path, null));
    return undefined;
  }

  /**
   * 몬스터 색 바꿈 표. 유니크 = RandTransforms.dat 의 (Utrans − 2) 번째, 아니면 변종 = <토큰>\COF\palshift.dat 의 (TransLvl + 2) 번째.
   * 출처: 원작 파일 data\global\monsters\RandTransforms.dat (30 × 256), <토큰>\COF\palshift.dat (8 × 256), monstats TransLvl, SuperUniques/MonStats2 Utrans
   * 근사(원작 미확인): 번호 오프셋 +2 / −2 — 기본 몬스터(TransLvl 0)가 항등 표(2 번)에 오고 Utrans 최댓값 31 이 30 개 표에 맞는 배치로 추정
   * 반환: 표 (없으면 null, 불러오는 중이면 undefined)
   */
  monsterShift(token: string, transLvl: number, uniqueTrans?: number): ColorShift | null | undefined {
    if (uniqueTrans !== undefined) {
      const rt = this.shiftFile('data\\global\\monsters\\RandTransforms.dat');
      if (rt === undefined) return undefined;
      const i = uniqueTrans - 2;
      if (!rt || i < 0 || (i + 1) * 256 > rt.length) return null;
      return { key: `rt${i}`, map: rt.subarray(i * 256, i * 256 + 256) };
    }
    const ps = this.shiftFile(`data\\global\\monsters\\${token}\\COF\\palshift.dat`);
    if (ps === undefined) return undefined;
    const i = transLvl + 2;
    if (!ps || (i + 1) * 256 > ps.length) return null;
    const map = ps.subarray(i * 256, i * 256 + 256);
    let identity = true;
    for (let k = 0; k < 256 && identity; k++) if (map[k] !== k) identity = false;
    return identity ? null : { key: `ps${token}${i}`, map };
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
    const trans = s.shift?.map;
    await Promise.all(
      cof.layers.map(async (l) => {
        const code = s.equip[l.name];
        if (!code) return;
        const b = await this.assets.load(`${base}\\${l.name}\\${s.token}${l.name}${code}${s.mode}${l.weaponClass}.dcc`);
        if (b) layers.set(l.type, { dcc: parseDcc(b), canvases: new Map() });
      }),
    );
    return trans ? { cof, layers, trans } : { cof, layers };
  }

  /** 합성 유닛 그리기. (x,y) = 유닛 발 위치 캔버스 좌표. 그린 영역(화면 좌표) 반환 */
  draw(ctx: CanvasRenderingContext2D, comp: Composite, dir64: number, frame: number, x: number, y: number): { x: number; y: number; w: number; h: number } | null {
    const cof = comp.cof;
    const d = dir64ToFile(dir64, cof.directions);
    const f = ((frame % cof.framesPerDirection) + cof.framesPerDirection) % cof.framesPerDirection;
    const order = cof.priority[d]?.[f] ?? cof.layers.map((l) => l.type);
    let l0 = Infinity, t0 = Infinity, r0 = -Infinity, b0 = -Infinity;
    for (const type of order) {
      const lg = comp.layers.get(type);
      if (!lg) continue;
      const layer = cof.layers.find((l) => l.type === type);
      const dir = lg.dcc.directions[d];
      const fr = dir?.frames[Math.min(f, dir.frames.length - 1)];
      if (!dir || !fr) continue;
      const key = d * 1000 + f;
      let c = lg.canvases.get(key);
      if (!c) {
        const tr = comp.trans;
        c = indexedToCanvas(tr ? fr.pixels.map((p) => (p ? tr[p] ?? p : 0)) : fr.pixels, dir.box.width, dir.box.height, this.pal);
        lg.canvases.set(key, c);
      }
      // 반투명 레이어 (COF transparent + drawEffect). 근사(원작 미확인): 원작 혼합 표(0~2 = 75/50/25% 불투명, 3·5·6 = 더하기, 4 = 곱하기)를 캔버스 합성으로 근사
      const blend = layer?.transparent ? layer.drawEffect : -1;
      if (blend >= 0) {
        ctx.save();
        if (blend <= 2) ctx.globalAlpha = [0.75, 0.5, 0.25][blend] as number;
        else ctx.globalCompositeOperation = blend === 4 ? 'multiply' : 'lighter';
      }
      ctx.drawImage(c as CanvasImageSource, x + dir.box.left, y + dir.box.top);
      if (blend >= 0) ctx.restore();
      l0 = Math.min(l0, x + dir.box.left);
      t0 = Math.min(t0, y + dir.box.top);
      r0 = Math.max(r0, x + dir.box.left + dir.box.width);
      b0 = Math.max(b0, y + dir.box.top + dir.box.height);
    }
    return l0 < r0 ? { x: l0, y: t0, w: r0 - l0, h: b0 - t0 } : null;
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
