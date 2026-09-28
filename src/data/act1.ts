// Act 1 수직 슬라이스 월드: Rogue Encampment(원작 프리셋) + Blood Moor(원작 프리셋 조합 근사) + 연결.
import { parseDs1, normalizeDs1File, type Ds1 } from '../formats/ds1';
import { parseDt1, type Dt1Tile } from '../formats/dt1';
import { buildPresetLevel, type PresetLevel } from '../engine/drlg/preset';
import { layoutWild } from '../engine/drlg/outdoor';
import { levelMonsterInfo, planSpawns, gridRooms } from '../engine/spawn';
import { Rng } from '../engine/rng';
import type { GameData, LevelDef } from '../engine/game';
import type { AssetSource, GameTables } from './tables';

const TILES = 'data\\global\\tiles\\';
export const TOWN_DS1 = `${TILES}ACT1\\TOWN\\townE1.ds1`;

const presetPath = (f: string) => `${TILES}${f.replace(/\//g, '\\')}`;
const RE_TRANS_E = /^Act 1 - Town 1 Transition E$/;
const RE_FILLS = /^Act 1 - (Stone Fill|Corral Fill|Pond|Cottages|Fallen Camp [12]|Camp)/;
const RE_BORDERS = /^Act 1 - Wild Border \d+$/;

/** 슬라이스에 필요한 원작 파일 경로 (브라우저 preload 용) */
export function act1SlicePaths(tables: GameTables): string[] {
  const lp = tables.table('LvlPrest');
  const files = new Set<string>([TOWN_DS1]);
  for (const r of lp) {
    const name = r.Name ?? '';
    if (!RE_TRANS_E.test(name) && !RE_FILLS.test(name) && !RE_BORDERS.test(name)) continue;
    for (let i = 1; i <= 6; i++) {
      const f = r[`File${i}`];
      if (f && f !== '0') files.add(presetPath(f));
    }
  }
  const wild = tables.table('LvlTypes').find((r) => r.Name === 'Act 1 - Wilderness');
  for (let i = 1; i <= 32; i++) {
    const f = wild?.[`File ${i}`];
    if (f && f !== '0') files.add(presetPath(f));
  }
  return [...files];
}

/** 마을 DS1 이 참조하는 DT1 경로 (마을 DS1 을 먼저 불러온 뒤 호출) */
export function townDt1Paths(src: AssetSource): string[] {
  return parseDs1(src.read(TOWN_DS1) as Uint8Array).files.map(normalizeDs1File);
}

export interface SliceWorld { town: PresetLevel; bloodMoor: PresetLevel; levels: LevelDef[]; start: { x: number; y: number } }

function presetDs1s(tables: GameTables, src: AssetSource, re: RegExp): Ds1[] {
  const out: Ds1[] = [];
  for (const r of tables.table('LvlPrest')) {
    if (!re.test(r.Name ?? '')) continue;
    for (let i = 1; i <= 6; i++) {
      const f = r[`File${i}`];
      const b = f && f !== '0' ? src.read(presetPath(f)) : null;
      if (b) out.push(parseDs1(b));
    }
  }
  return out;
}

export function buildSliceWorld(src: AssetSource, tables: GameTables, data: GameData, seed: number): SliceWorld {
  // 마을
  const townDs1 = parseDs1(src.read(TOWN_DS1) as Uint8Array);
  const townDt1s = townDs1.files.map((f) => src.read(normalizeDs1File(f))).filter((b): b is Uint8Array => !!b).map(parseDt1);
  const town = buildPresetLevel(townDs1, townDt1s, seed);

  // Blood Moor (원작 프리셋 조합 근사)
  const rng = new Rng(seed ^ 0x2);
  const townTransE = presetDs1s(tables, src, RE_TRANS_E)[0];
  if (!townTransE) throw new Error('TownETrans.ds1 missing');
  const layout = layoutWild(
    { townTransE, fills: presetDs1s(tables, src, RE_FILLS).filter((d) => d.width <= 9 && d.height <= 9), borders: presetDs1s(tables, src, RE_BORDERS) },
    rng,
  );
  const wild = tables.table('LvlTypes').find((r) => r.Name === 'Act 1 - Wilderness');
  const wildDt1s: Dt1Tile[][] = [];
  for (let i = 1; i <= 32; i++) {
    const f = wild?.[`File ${i}`];
    const b = f && f !== '0' ? src.read(presetPath(f)) : null;
    if (b) wildDt1s.push(parseDt1(b));
  }
  const bloodMoor = buildPresetLevel(layout.ds1, wildDt1s, seed ^ 0x3);
  // 외곽 2 서브타일은 막는다 (마을 전환 구간 제외)
  const bm = bloodMoor.collision;
  const transY0 = layout.townTransY * 5, transY1 = transY0 + townTransE.height * 5;
  for (let y = 0; y < bm.height; y++)
    for (let x = 0; x < bm.width; x++) {
      const edge = x < 2 || y < 2 || x >= bm.width - 2 || y >= bm.height - 2;
      if (edge && !(x < 2 && y >= transY0 && y < transY1)) bm.block(x, y);
    }

  const townW = town.collision.width;
  const dy = transY0; // 마을 y ↔ Blood Moor y 오프셋 (마을 동쪽 = 전환 프리셋 서쪽)
  const info = levelMonsterInfo(tables.table('Levels'), 'Blood Moor');
  const spawns = planSpawns(info, gridRooms(bm.width, bm.height), bm, data.monsters, new Rng(seed ^ 0x5), (x) => x < 60);

  const levels: LevelDef[] = [
    { id: 'town', map: town.collision, inTown: true, exits: [{ x: townW - 3, y: 0, w: 3, h: town.collision.height, to: 'bloodmoor', toX: 5, toY: 0, dy }] },
    { id: 'bloodmoor', map: bm, inTown: false, exits: [{ x: 0, y: transY0, w: 3, h: transY1 - transY0, to: 'town', toX: townW - 6, toY: 0, dy: -dy }], spawns },
  ];
  return { town, bloodMoor, levels, start: townStart(town.collision) };
}

/**
 * 마을 시작 위치 근사: 동쪽 출구에서 걸어서 닿는 칸 중 주변 7×7 이 모두 열린, 마을 중앙에 가장 가까운 칸.
 * (원작 시작 위치는 Phase 8 에서 마을 프리셋 규칙으로 교체)
 */
export function townStart(m: import('../engine/collision').CollisionMap): { x: number; y: number } {
  const seen = new Uint8Array(m.width * m.height);
  const q: number[] = [];
  for (let y = 0; y < m.height; y++) {
    const x = m.width - 3;
    if (m.walkable(x, y)) {
      seen[y * m.width + x] = 1;
      q.push(y * m.width + x);
    }
  }
  while (q.length) {
    const k = q.pop() as number;
    const x = k % m.width, y = Math.floor(k / m.width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy, nk = ny * m.width + nx;
      if (m.walkable(nx, ny) && !seen[nk]) {
        seen[nk] = 1;
        q.push(nk);
      }
    }
  }
  const open = (x: number, y: number) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!seen[(y + dy) * m.width + x + dx] || !m.walkable(x + dx, y + dy)) return false;
    return true;
  };
  const cx = m.width / 2, cy = m.height / 2;
  let best = { x: m.width - 5, y: Math.floor(m.height / 2) }, bd = Infinity;
  for (let y = 3; y < m.height - 3; y++)
    for (let x = 3; x < m.width - 3; x++) {
      if (!seen[y * m.width + x] || !open(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd) {
        bd = d;
        best = { x, y };
      }
    }
  return { x: best.x + 0.5, y: best.y + 0.5 };
}
