// 자동 지도: 탐험한 타일 기록 + 타일 → 원작 자동 지도 그림 번호(MaxiMap.dc6 프레임) 대응표.
// 출처: 원작 data\global\excel\AutoMap.txt — LevelName("1 Town" …), TileName(fl, wl, wr …), Style, StartSequence, EndSequence(−1 = 전부), Cel1~Cel4
//       그림: data\global\ui\automap\MaxiMap.dc6 (프레임 = Cel 번호)
import type { TxtRow } from '../formats/txt';

/**
 * AutoMap.txt TileName → DT1 방향(orientation). 배열 인덱스 = 방향 번호.
 * 출처: D2MOO LevelsTbls.cpp gszAutomapTileNames (DATATBLS_LoadAutomapTxt 가 strcmp 로 찾은 인덱스를 dwAutomapTileType 으로 쓴다)
 */
const AUTOMAP_TILE_NAMES = ['fl', 'wl', 'wr', 'wtlr', 'wtll', 'wtr', 'wbl', 'wbr', 'wld', 'wrd', 'wle', 'wre', 'co', 'sh', 'tr', 'rf', 'ld', 'rd', 'fd', 'fi'] as const;
export const AUTOMAP_TILE: Record<string, number> = Object.fromEntries(AUTOMAP_TILE_NAMES.map((name, i) => [name, i]));

/**
 * AutoMap.txt LevelName 고정 표. 배열 인덱스 = LvlTypes Id (0 None … 35 "5 Lava").
 * 출처: D2MOO LevelsTbls.cpp gszAutomapLevelNames — 원작은 LvlTypes 이름을 가공하지 않고 이 표를 strcmp 로 찾아 인덱스(= 레벨 타입)를 쓴다.
 *   그래서 "Act 5 - Ice Caves"(Id 33) 의 자동 지도 행은 "5 Ice" 다. "5 Town"(하로가스) 은 AutoMap.txt 에 행이 없어 원작도 빈 지도.
 */
export const AUTOMAP_LEVEL_NAMES: readonly string[] = [
  'None',
  '1 Town', '1 Wilderness', '1 Cave', '1 Crypt', '1 Monestary', '1 Courtyard', '1 Barracks', '1 Jail', '1 Cathedral', '1 Catacombs', '1 Tristram',
  '2 Town', '2 Sewer', '2 Harem', '2 Basement', '2 Desert', '2 Tomb', '2 Lair', '2 Arcane',
  '3 Town', '3 Jungle', '3 Kurast', '3 Spider', '3 Dungeon', '3 Sewer',
  '4 Town', '4 Mesa', '4 Lava',
  '5 Town', '5 Siege', '5 Barricade', '5 Temple', '5 Ice', '5 Baal', '5 Lava',
];

interface Entry { orientation: number; style: number; from: number; to: number; cels: number[] }

const n = (v: string | undefined, d = 0): number => (v === undefined || v === '' ? d : Number(v));

export class AutomapTable {
  private readonly byLevel = new Map<string, Entry[]>();

  constructor(rows: TxtRow[]) {
    for (const r of rows) {
      const lv = r.LevelName ?? '';
      const o = AUTOMAP_TILE[r.TileName ?? ''];
      if (!lv || o === undefined) continue;
      const cels = [n(r.Cel1, -1), n(r.Cel2, -1), n(r.Cel3, -1), n(r.Cel4, -1)].filter((c) => c >= 0);
      if (!cels.length) continue;
      const list = this.byLevel.get(lv) ?? [];
      list.push({ orientation: o, style: n(r.Style, -1), from: n(r.StartSequence, -1), to: n(r.EndSequence, -1), cels });
      this.byLevel.set(lv, list);
    }
  }

  /** LvlTypes Id → AutoMap.txt LevelName (모르는 Id 는 '' — 행 없음과 같게 빈 지도) */
  static levelName(lvlTypeId: number): string {
    return AUTOMAP_LEVEL_NAMES[lvlTypeId] ?? '';
  }

  /**
   * 타일 → 그림 번호 후보. 같은 행에 Cel 이 여러 개면 원작은 그중 하나를 쓴다.
   * 근사(원작 미확인): 후보 선택은 타일 좌표 해시로 고정 (원작 선택 규칙 미확인)
   */
  cels(level: string, orientation: number, style: number, sequence: number): number[] {
    const list = this.byLevel.get(level);
    if (!list) return [];
    for (const e of list) {
      if (e.orientation !== orientation) continue;
      if (e.style >= 0 && e.style !== style) continue;
      if (e.from >= 0 && sequence < e.from) continue;
      if (e.to >= 0 && sequence > e.to) continue;
      return e.cels;
    }
    return [];
  }
}

/**
 * 탐험 기록: 레벨마다 타일 격자 (1 = 드러남).
 * 근사(원작 미확인): 원작 D2Client 는 플레이어 주변 방(8×8 타일)이 활성화될 때 그 방 타일을 드러낸다 — 여기서는 플레이어 중심 반경 REVEAL_TILES 타일 원
 */
export const REVEAL_TILES = 10;

export class AutomapReveal {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly seen: Uint8Array;
  private lastKey = -1;

  constructor(widthTiles: number, heightTiles: number) {
    this.widthTiles = widthTiles;
    this.heightTiles = heightTiles;
    this.seen = new Uint8Array(widthTiles * heightTiles);
  }

  /** 서브타일 위치 기준으로 주변 타일을 드러낸다. 새로 드러난 타일 수 반환 */
  revealAround(sx: number, sy: number, radius = REVEAL_TILES): number {
    const tx = Math.floor(sx / 5), ty = Math.floor(sy / 5);
    const key = ty * this.widthTiles + tx;
    if (key === this.lastKey) return 0;
    this.lastKey = key;
    let added = 0;
    for (let y = ty - radius; y <= ty + radius; y++)
      for (let x = tx - radius; x <= tx + radius; x++) {
        if (x < 0 || y < 0 || x >= this.widthTiles || y >= this.heightTiles) continue;
        if ((x - tx) ** 2 + (y - ty) ** 2 > radius * radius) continue;
        const k = y * this.widthTiles + x;
        if (!this.seen[k]) {
          this.seen[k] = 1;
          added++;
        }
      }
    return added;
  }

  isSeen(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.widthTiles && ty < this.heightTiles && this.seen[ty * this.widthTiles + tx] === 1;
  }

  count(): number {
    let c = 0;
    for (const v of this.seen) c += v;
    return c;
  }
}
