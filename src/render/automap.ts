// 자동 지도 오버레이 (Tab: 전체 화면 / V: 미니 지도 모드).
// 출처: 원작 data\global\ui\automap\MaxiMap.dc6 (그림 번호 = AutoMap.txt Cel), 셀 16×32 의 아래 8줄이 타일 마름모(16×8 = 게임 타일 160×80 의 1/10)
//       levels.txt LevelWarp ("To The Cold Plains" 등) — 원작 자동 지도는 출구에 이 문자열을 적는다
// 근사(원작 미확인): 미니 지도는 원작 MiniMap 파일이 1.14d MPQ 에 없어 같은 셀을 반으로 줄여 오른쪽 위에 그린다.
//   플레이어·웨이포인트·포털 표시는 원작 표시 그림 대신 색 점/십자로 그린다.
import type { PresetLevel } from '../engine/drlg/preset';
import type { TownMap } from '../data/world-level';
import type { AutomapReveal, AutomapTable } from '../engine/automap';
import { parseDc6, type Dc6 } from '../formats/dc6';
import type { Palette } from '../formats/palette';
import { indexedToCanvas, type Drawable } from './sprites';
import type { AsyncAssets } from './units';
import { drawText } from '../ui/text';

export type AutomapMode = 'off' | 'full' | 'mini';

export interface AutomapMarkers {
  player: { x: number; y: number };
  waypoints: { x: number; y: number }[];
  portals: { x: number; y: number }[];
  exits: { x: number; y: number; label: string }[];
  /** 플레이어 시체 위치 (없으면 null) */
  corpse?: { x: number; y: number } | null;
}

const CELL_PATH = 'data\\global\\ui\\automap\\MaxiMap.dc6';
/** 마을 그림 (Act2Map/Act4Map/ExTnMap + 미니맵 S 판) 폴더 */
const TOWN_DIR = 'data\\global\\ui\\automap\\';

interface Box { x: number; y: number; w: number; h: number }

export class AutomapRenderer {
  private dc6: Dc6 | null = null;
  private loading = false;
  private readonly cels = new Map<number, Drawable>();
  /** 마을 그림 DC6 (파일 이름 → 해석본, 로딩 중은 null) */
  private readonly townDc6 = new Map<string, Dc6 | null>();
  /** 마을 그림 조각 캔버스 ("파일:프레임") */
  private readonly townCels = new Map<string, Drawable>();
  private readonly assets: AsyncAssets;
  private readonly pal: Palette;
  private readonly table: AutomapTable;

  constructor(assets: AsyncAssets, pal: Palette, table: AutomapTable) {
    this.assets = assets;
    this.pal = pal;
    this.table = table;
  }

  get ready(): boolean {
    return !!this.dc6;
  }

  /** 셀 그림(MaxiMap.dc6) 읽기 시작 — 지도를 처음 켤 때 (셀이 없는 마을 그림 레벨에서도 ready 가 되도록) */
  private ensureCells(): void {
    if (this.dc6 || this.loading) return;
    this.loading = true;
    void this.assets.load(CELL_PATH).then((b) => {
      if (b) this.dc6 = parseDc6(b);
    });
  }

  private cel(i: number): Drawable | null {
    if (!this.dc6) {
      this.ensureCells();
      return null;
    }
    let c = this.cels.get(i);
    if (!c) {
      const f = this.dc6.frames[i];
      if (!f) return null;
      c = indexedToCanvas(f.pixels, f.width, f.height, this.pal);
      this.cels.set(i, c);
    }
    return c;
  }

  /**
   * 미리 그려진 마을 그림 (루트 골레인·판데모니움·하로가스). 출처: DRLGPRESET pfTownAutomap(levelId, nPickedFile, 레벨 중심 타일)
   * 전체 지도 = <file>.dc6, 미니맵 = <file>S.dc6 (원작 절반 크기 판, 1:1). 조각 cols×rows 행 우선, 묶음 variant.
   * 근사(원작 미확인): 그림 중심 = 레벨 중심 타일의 자동 지도 좌표 (클라이언트 쪽 픽셀 오프셋 미확인), 루트 골레인 귀퉁이 X 조각도 그대로 그린다
   * @returns 그린 조각 수
   */
  private drawTown(ctx: CanvasRenderingContext2D, town: TownMap, mode: 'full' | 'mini', center: { x: number; y: number }, box: Box): number {
    const name = mode === 'mini' ? `${town.file}S` : town.file;
    const dc6 = this.townDc6.get(name);
    if (dc6 === undefined) {
      this.townDc6.set(name, null);
      void this.assets.load(`${TOWN_DIR}${name}.dc6`).then((b) => {
        if (b) this.townDc6.set(name, parseDc6(b));
      });
      return 0;
    }
    if (!dc6) return 0;
    const base = town.variant * town.cols * town.rows;
    const first = dc6.frames[base];
    if (!first) return 0;
    const fw = first.width, fh = first.height;
    const x0 = Math.round(center.x - (town.cols * fw) / 2), y0 = Math.round(center.y - (town.rows * fh) / 2);
    let n = 0;
    for (let r = 0; r < town.rows; r++)
      for (let c = 0; c < town.cols; c++) {
        const i = base + r * town.cols + c;
        if (town.skip?.includes(i)) continue;
        const key = `${name}:${i}`;
        let img = this.townCels.get(key);
        if (!img) {
          const f = dc6.frames[i];
          if (!f) continue;
          img = indexedToCanvas(f.pixels, f.width, f.height, this.pal);
          this.townCels.set(key, img);
        }
        const x = x0 + c * fw, y = y0 + r * fh;
        if (x + fw < box.x || y + fh < box.y || x > box.x + box.w || y > box.y + box.h) continue;
        ctx.drawImage(img as CanvasImageSource, x, y);
        n++;
      }
    return n;
  }

  /**
   * 드러난 타일을 그린다. 화면 중심 = 플레이어 (전체) / 오른쪽 위 상자 중심 (미니).
   * @param levelName AutoMap.txt LevelName (예: "1 Wilderness")
   * @param town 미리 그려진 마을 그림 (없으면 null)
   */
  /** alpha = 옵션 FADE (원작 Fade Automap — 근사(원작 미확인): 투명도 0.5) */
  draw(ctx: CanvasRenderingContext2D, mode: AutomapMode, level: PresetLevel, levelName: string, town: TownMap | null, reveal: AutomapReveal, mk: AutomapMarkers, width: number, height: number, alpha = 1): number {
    if (mode === 'off') return 0;
    this.ensureCells();
    const scale = mode === 'mini' ? 0.5 : 1;
    const box = mode === 'mini' ? { x: width - 200, y: 8, w: 192, h: 150 } : { x: 0, y: 0, w: width, h: height };
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    // 플레이어 서브타일 → 자동 지도 좌표 (서브타일 1 = 3.2×1.6 픽셀)
    const pax = ((mk.player.x - mk.player.y) * 16) / 10, pay = ((mk.player.x + mk.player.y) * 8) / 10;
    const toMap = (sx: number, sy: number) => ({ x: cx + (((sx - sy) * 16) / 10 - pax) * scale, y: cy + (((sx + sy) * 8) / 10 - pay) * scale });
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    if (mode === 'mini') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    let drawn = 0;
    // 근사(원작 미확인): 원작은 자동 지도 셀을 밝게 겹쳐 그린다 — 캔버스 가산 합성으로 근사
    ctx.globalCompositeOperation = 'lighter';
    // 마을 그림 (2·4·5막 마을): 레벨 중심 타일 = (너비/2, 높이/2) 타일 → 서브타일 ×5
    if (town) drawn += this.drawTown(ctx, town, mode, toMap((level.widthTiles * 5) / 2, (level.heightTiles * 5) / 2), box);
    const put = (tileIndex: number, tx: number, ty: number) => {
      if (!reveal.isSeen(tx, ty)) return;
      const t = level.tiles[tileIndex];
      if (!t) return;
      const list = this.table.cels(levelName, t.orientation, t.mainIndex, t.subIndex);
      if (!list.length) return;
      // 근사(원작 미확인): 후보가 여럿이면 타일 좌표로 고정 선택
      const idx = list[(tx * 7 + ty * 13) % list.length] as number;
      const img = this.cel(idx);
      if (!img) return;
      const p = toMap(tx * 5, ty * 5);
      // 셀 기준점: 위 꼭짓점이 (8, 24) — 아래 8줄이 타일 마름모
      const x = p.x - 8 * scale, y = p.y - 24 * scale;
      if (x < box.x - 20 || y < box.y - 40 || x > box.x + box.w + 20 || y > box.y + box.h + 20) return;
      ctx.drawImage(img as CanvasImageSource, x, y, 16 * scale, 32 * scale);
      drawn++;
    };
    for (const f of level.floors) put(f.tileIndex, f.x, f.y);
    for (const w of level.walls) if (w.orientation < 15) put(w.tileIndex, w.x, w.y);
    ctx.globalCompositeOperation = 'source-over';
    // 표시
    // 출구 이름: 원작 글꼴 (근사: 전체 지도 font16, 미니 지도 font6, 흰색)
    for (const e of mk.exits) {
      const p = toMap(e.x, e.y);
      drawText(ctx, e.label, p.x, p.y - (mode === 'mini' ? 8 : 12), { align: 'center', font: mode === 'mini' ? 'font6' : 'font16', color: 'white' });
    }
    for (const w of mk.waypoints) {
      const p = toMap(w.x, w.y);
      ctx.strokeStyle = '#7fb0ff';
      ctx.strokeRect(p.x - 3 * scale - 1, p.y - 2 * scale - 1, 6 * scale + 2, 4 * scale + 2);
    }
    for (const q of mk.portals) {
      const p = toMap(q.x, q.y);
      ctx.fillStyle = '#4a7dff';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 3 * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // 시체: 붉은 십자 (드러나지 않은 곳이어도 표시 — 죽은 자리를 찾아가게)
    // 근사(원작 미확인): 원작 시체 표시 모양·색
    if (mk.corpse) {
      const c = toMap(mk.corpse.x, mk.corpse.y);
      ctx.strokeStyle = '#ff3030';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x - 5, c.y);
      ctx.lineTo(c.x + 5, c.y);
      ctx.moveTo(c.x, c.y - 5);
      ctx.lineTo(c.x, c.y + 5);
      ctx.stroke();
    }
    const pp = toMap(mk.player.x, mk.player.y);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pp.x - 4, pp.y - 4);
    ctx.lineTo(pp.x + 4, pp.y + 4);
    ctx.moveTo(pp.x + 4, pp.y - 4);
    ctx.lineTo(pp.x - 4, pp.y + 4);
    ctx.stroke();
    ctx.restore();
    return drawn;
  }
}
