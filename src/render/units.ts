// 유닛 렌더: COF 레이어 합성 (플레이어·몬스터), 바닥 아이템(flippy DC6).
// 출처: Phrozen Keep — COF/DCC 문서: 경로 <토큰>\COF\<토큰><모드><무기클래스>.COF,
//       레이어 DCC = <토큰>\<레이어>\<토큰><레이어><외형코드><모드><레이어 무기클래스>.dcc, 프레임별 레이어 순서 = COF priority
// 출처: OpenDiablo2 d2dcc/dcc_dir_lookup.go Dir64ToDcc (64방향 → 파일 방향 인덱스)
import { parseCof, type Cof } from '../formats/cof';
import { parseDcc, type Dcc, type DccDirection } from '../formats/dcc';
import type { DccHandle } from '../assets/gfx-client';
import { parseDc6, type Dc6 } from '../formats/dc6';
import type { ColorShift, IndexedImage, SpriteSink } from './sink';
import { newSpriteId } from './sprites';

export type { ColorShift } from './sink';

export interface AsyncAssets {
  load(path: string): Promise<Uint8Array | null>;
  /** 캐시에 남기지 않고 읽기 (있으면 사용) */
  loadOnce?(path: string): Promise<Uint8Array | null>;
  /** DCC 를 방향 단위로 (워커가 필요한 방향만 해석) */
  loadDcc?(path: string): Promise<DccHandle | null>;
}

const loadOnce = (a: AsyncAssets, path: string) => (a.loadOnce ? a.loadOnce(path) : a.load(path));

/** DCC 열기: 방향 단위 로더가 있으면 그것, 없으면 통째로 읽어 해석 */
async function openDcc(a: AsyncAssets, path: string): Promise<DccHandle | null> {
  if (a.loadDcc) return a.loadDcc(path);
  const b = await loadOnce(a, path);
  if (!b) return null;
  return handleOf(parseDcc(b));
}
/** 해석한 유닛 그림(COF+DCC) 을 기억할 최대 개수 — 넘으면 오래 안 쓴 것부터 버린다 */
const MAX_COMPOSITES = 1200;
/** 진단용: 유닛 그림을 불러와 해석한 횟수와 기억 중인 수 */
export const unitGfxStats = { loads: 0, cached: 0 };

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

/**
 * DC6 레이어를 DCC 모양으로 (방향마다 프레임들의 합집합 상자, 프레임 픽셀을 그 상자에 놓는다).
 * 출처: Phrozen Keep DC6 문서 — offsetX = 왼쪽, offsetY = 프레임 아래쪽 기준 (위쪽 = offsetY − height)
 */
function dc6AsDcc(d: Dc6): Dcc {
  const fpd = Math.max(1, d.framesPerDirection);
  const directions = Array.from({ length: Math.max(1, d.directions) }, (_, di) => {
    const frs = d.frames.slice(di * fpd, di * fpd + fpd);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const f of frs) {
      left = Math.min(left, f.offsetX);
      top = Math.min(top, f.offsetY - f.height);
      right = Math.max(right, f.offsetX + f.width);
      bottom = Math.max(bottom, f.offsetY);
    }
    if (!Number.isFinite(left)) left = top = right = bottom = 0;
    const box = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    const frames = frs.map((f) => {
      const pixels = new Uint8Array(box.width * box.height);
      const ox = f.offsetX - left, oy = f.offsetY - f.height - top;
      for (let y = 0; y < f.height; y++) pixels.set(f.pixels.subarray(y * f.width, y * f.width + f.width), (y + oy) * box.width + ox);
      return { box: { ...box }, pixels };
    });
    return { box, frames };
  });
  return { directions, framesPerDirection: fpd };
}

/** 이미 해석한 그림을 방향 단위 핸들로 */
const handleOf = (dcc: Dcc): DccHandle => ({ directions: dcc.directions.length, framesPerDirection: dcc.framesPerDirection, dir: async (d) => dcc.directions[d] ?? null });

/** DCC 레이어: 방향은 처음 그릴 때 해석한다 (undefined = 아직 안 함, 'loading' = 해석 중, null = 없음) */
interface LayerGfx { h: DccHandle; dirs: (DccDirection | null | 'loading' | undefined)[]; id: number }

/** 불러오거나 해석 중인 그림 수 (로딩 화면이 기다린다) */
let inflight = 0;
const track = <T>(p: Promise<T>): Promise<T> => {
  inflight++;
  return p.finally(() => inflight--);
};
/** 유닛·미사일 그림을 불러오거나 해석하는 중인가 */
export const gfxBusy = (): boolean => inflight > 0;

/** 레이어의 방향 d (해석 중이면 undefined — 요청을 보낸다) */
function layerDir(lg: LayerGfx, d: number): DccDirection | null | undefined {
  const v = lg.dirs[d];
  if (v === 'loading') return undefined;
  if (v !== undefined) return v;
  if (d < 0 || d >= lg.h.directions) return null;
  lg.dirs[d] = 'loading';
  track(lg.h.dir(d)).then((x) => (lg.dirs[d] = x)).catch(() => (lg.dirs[d] = null));
  return undefined;
}
export interface Composite { cof: Cof; layers: Map<number, LayerGfx>; shift?: ColorShift }

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
  private readonly cache = new Map<string, Composite | null | Promise<void>>();
  private readonly shiftFiles = new Map<string, Uint8Array | null | 'loading'>();

  constructor(assets: AsyncAssets) {
    this.assets = assets;
  }

  private shiftFile(path: string): Uint8Array | null | undefined {
    const hit = this.shiftFiles.get(path);
    if (hit === 'loading') return undefined;
    if (hit !== undefined) return hit;
    this.shiftFiles.set(path, 'loading');
    this.assets.load(path).then((b) => this.shiftFiles.set(path, b)).catch(() => this.shiftFiles.set(path, null));
    return undefined;
  }

  /** 막 팔레트(Pal.PL2)의 색 바꾸기 표 111 × 256 — 상태 색 (states.txt colorshift). 불러오기 전이면 null */
  hues: Uint8Array | null = null;

  /** 상태 색 표 (냉기 108 파랑 · 독 104 초록 …). 표가 아직 없으면 null */
  stateShift(index: number): ColorShift | null {
    const h = this.hues;
    if (!h || index < 0 || (index + 1) * 256 > h.length) return null;
    return { key: `hue${index}`, map: h.subarray(index * 256, index * 256 + 256) };
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

  /** 유닛별로 마지막으로 그린 그림과 방향 (새 동작·방향 그림을 해석하는 동안 대신 그려 깜박임을 막는다) */
  private readonly lastShown = new Map<string, { comp: Composite; dir: number }>();

  /**
   * 유닛 하나의 그림: 이 동작·방향 그림이 준비됐으면 그것, 아직이면 그 유닛이 직전에 쓰던 그림(과 그때 방향).
   * 원작은 동작이 바뀌어도 그림이 비는 순간이 없으므로, 불러오는 동안 빈 화면(깜박임)을 보이지 않게 한다.
   */
  getFor(unitKey: string, spec: CompositeSpec, dir64: number): { comp: Composite; dir: number } | null {
    const c = this.get(spec);
    if (c && this.ready(c, dir64)) {
      const v = { comp: c, dir: dir64 };
      this.lastShown.delete(unitKey);
      this.lastShown.set(unitKey, v);
      if (this.lastShown.size > 3000) {
        const first = this.lastShown.keys().next().value;
        if (first !== undefined) this.lastShown.delete(first);
      }
      return v;
    }
    return this.lastShown.get(unitKey) ?? (c ? { comp: c, dir: dir64 } : null);
  }

  /** 이 방향의 모든 레이어가 해석됐는가 (안 됐으면 해석 요청) */
  ready(comp: Composite, dir64: number): boolean {
    const d = dir64ToFile(dir64, comp.cof.directions);
    let ok = true;
    for (const lg of comp.layers.values()) if (layerDir(lg, d) === undefined) ok = false;
    return ok;
  }

  /** 곧 쓸 그림을 미리 불러 방향까지 해석해 둔다 */
  warm(spec: CompositeSpec, dir64: number): void {
    const c = this.get(spec);
    if (c) this.ready(c, dir64);
  }

  /** 준비되면 Composite, 로딩 중이면 undefined, 없으면 null */
  get(spec: CompositeSpec): Composite | null | undefined {
    const k = specKey(spec);
    const hit = this.cache.get(k);
    if (hit instanceof Promise) return undefined;
    if (hit !== undefined) {
      // 최근 사용으로 옮긴다
      this.cache.delete(k);
      this.cache.set(k, hit);
      return hit;
    }
    unitGfxStats.loads++;
    this.cache.set(k, track(this.load(spec)).then((c) => void this.cache.set(k, c)).catch(() => void this.cache.set(k, null)));
    unitGfxStats.cached = this.cache.size;
    for (const key of this.cache.keys()) {
      if (this.cache.size <= MAX_COMPOSITES) break;
      if (!(this.cache.get(key) instanceof Promise)) this.cache.delete(key);
    }
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
        const open = async (c: string): Promise<LayerGfx | null> => {
          const stem = `${base}\\${l.name}\\${s.token}${l.name}${c}${s.mode}${l.weaponClass}`;
          const h = await openDcc(this.assets, `${stem}.dcc`);
          if (h) return { h, dirs: [], id: newSpriteId() };
          // 원작 몇몇 몬스터 레이어는 DC6 (Mephisto 전부, Diablo·Maggot Queen 죽음, Tyrael) — 같은 이름의 .dc6 (d2data.mpq 목록)
          const b6 = await loadOnce(this.assets, `${stem}.dc6`);
          return b6 ? { h: handleOf(dc6AsDcc(parseDc6(b6))), dirs: [], id: newSpriteId() } : null;
        };
        // 이 동작에 그 외형 그림이 없으면 기본 외형(lit). 출처: 원작 d2char.mpq — 캐릭터 시체(DD)·죽기(DT)는 SOTRLITDDHTH 처럼 lit 한 장뿐
        const g = (await open(code)) ?? (code !== 'lit' ? await open('lit') : null);
        if (g) layers.set(l.type, g);
      }),
    );
    return s.shift ? { cof, layers, shift: s.shift } : { cof, layers };
  }

  /**
   * 합성 유닛 그리기. (x,y) = 유닛 발 위치 캔버스 좌표. 그린 영역(화면 좌표) 반환.
   * bright = 마우스를 올린 유닛 (원작: 가리킨 유닛·오브젝트 그림을 밝게 — 근사(원작 미확인): 1.6배 밝기로 근사)
   */
  /**
   * 합성 그리기. 밝기는 발밑 (x, y) 한 점에서 잰다 (원작: 유닛 전체가 한 밝기).
   * shadow = 먼저 불투명 레이어를 발밑 기준으로 눕힌 그림자로 그린다 (monstats2 Shadow).
   */
  /** @param dim 밝기 배율·반투명 (그림자 전사: 어둡고 비치게) */
  draw(sink: SpriteSink, comp: Composite, dir64: number, frame: number, x: number, y: number, bright = false, shadow = false, dim?: number): { x: number; y: number; w: number; h: number } | null {
    const cof = comp.cof;
    const d = dir64ToFile(dir64, cof.directions);
    const f = ((frame % cof.framesPerDirection) + cof.framesPerDirection) % cof.framesPerDirection;
    const order = cof.priority[d]?.[f] ?? cof.layers.map((l) => l.type);
    const feet = { x, y };
    if (shadow) for (const type of order) {
      const lg = comp.layers.get(type);
      const layer = cof.layers.find((l) => l.type === type);
      if (!lg || layer?.transparent) continue;
      const dir = layerDir(lg, d);
      const fr = dir?.frames[Math.min(f, dir.frames.length - 1)];
      if (dir && fr) sink.draw({ id: `u${lg.id}:${d}:${f}`, w: dir.box.width, h: dir.box.height, pixels: fr.pixels }, x + dir.box.left, y + dir.box.top, { shadow: feet });
    }
    let l0 = Infinity, t0 = Infinity, r0 = -Infinity, b0 = -Infinity;
    for (const type of order) {
      const lg = comp.layers.get(type);
      if (!lg) continue;
      const layer = cof.layers.find((l) => l.type === type);
      const dir = layerDir(lg, d);
      const fr = dir?.frames[Math.min(f, dir.frames.length - 1)];
      if (!dir || !fr) continue;
      // 반투명 레이어 (COF transparent + drawEffect: 0~2 = 75/50/25% 불투명, 3·5·6 = 더하기, 4 = 곱하기). 색 바꿈 표는 그리는 쪽이 적용
      const blend = layer?.transparent ? layer.drawEffect : dim !== undefined ? 0 : -1;
      sink.draw({ id: `u${lg.id}:${d}:${f}`, w: dir.box.width, h: dir.box.height, pixels: fr.pixels }, x + dir.box.left, y + dir.box.top, { shift: comp.shift, blend, bright, lightAt: feet, ...(dim !== undefined ? { dim } : {}) });
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
  private readonly id = newSpriteId();
  private readonly cache = new Map<string, { image: IndexedImage; w: number; h: number; ox: number; oy: number } | null | 'loading'>();

  constructor(assets: AsyncAssets) {
    this.assets = assets;
  }

  draw(sink: SpriteSink, flippyFile: string, x: number, y: number): { w: number; h: number; x: number; y: number } | null {
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
          this.cache.set(flippyFile, { image: { id: `i${this.id}:${flippyFile}`, w: fr.width, h: fr.height, pixels: fr.pixels }, w: fr.width, h: fr.height, ox: fr.offsetX, oy: fr.offsetY });
        })
        .catch(() => this.cache.set(flippyFile, null));
      return null;
    }
    if (!hit || hit === 'loading') return null;
    // 출처: Phrozen Keep DC6 문서 — offsetY 는 프레임 아래쪽 기준
    sink.draw(hit.image, x + hit.ox, y + hit.oy - hit.h, { lightAt: { x, y } });
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
  private readonly cache = new Map<string, LayerGfx | null | 'loading'>();

  constructor(assets: AsyncAssets) {
    this.assets = assets;
  }

  draw(sink: SpriteSink, celFile: string, dir64: number, frame: number, x: number, y: number, blend?: number): void {
    const key = celFile.toLowerCase();
    const hit = this.cache.get(key);
    if (hit === undefined) {
      this.cache.set(key, 'loading');
      track(openDcc(this.assets,
        // 상태 오버레이는 엔진이 'overlays\<Filename>' 으로 보낸다 (data\global\overlays, 출처: overlay.txt Filename)
        celFile.toLowerCase().startsWith('overlays\\') ? `data\\global\\${celFile}.dcc` : `data\\global\\missiles\\${celFile}.dcc`))
        .then((h) => this.cache.set(key, h ? { h, dirs: [], id: newSpriteId() } : null))
        .catch(() => this.cache.set(key, null));
      return;
    }
    if (!hit || hit === 'loading') return;
    const d = dir64ToFile(dir64, hit.h.directions);
    const dir = layerDir(hit, d);
    if (!dir || !dir.frames.length) return;
    const f = ((frame % dir.frames.length) + dir.frames.length) % dir.frames.length;
    const fr = dir.frames[f];
    if (!fr) return;
    // missiles.txt / overlay.txt Trans ≠ 0: 빛 더하기 (검은 바탕이 비친다). 근사(원작 미확인): 원작 DrawMode 종류별 혼합 대신 가산 하나
    sink.draw({ id: `m${hit.id}:${d}:${f}`, w: dir.box.width, h: dir.box.height, pixels: fr.pixels }, x + dir.box.left, y + dir.box.top, { blend: blend ? 3 : -1, lightAt: { x, y } });
  }
}
