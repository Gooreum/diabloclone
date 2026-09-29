// 자동 지도 오버레이 (Tab: 전체 화면 / V: 미니 지도 모드).
// 출처: 원작 data\global\ui\automap\MaxiMap.dc6 (그림 번호 = AutoMap.txt Cel), 셀 16×32 의 아래 8줄이 타일 마름모(16×8 = 게임 타일 160×80 의 1/10)
//       levels.txt LevelWarp ("To The Cold Plains" 등) — 원작 자동 지도는 출구에 이 문자열을 적는다
// 근사(원작 미확인): 미니 지도는 원작 MiniMap 파일이 1.14d MPQ 에 없어 같은 셀을 반으로 줄여 오른쪽 위에 그린다.
//   플레이어·웨이포인트·포털 표시는 원작 표시 그림 대신 색 점/십자로 그린다.
import type { PresetLevel } from '../engine/drlg/preset';
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
}

const CELL_PATH = 'data\\global\\ui\\automap\\MaxiMap.dc6';

export class AutomapRenderer {
  private dc6: Dc6 | null = null;
  private loading = false;
  private readonly cels = new Map<number, Drawable>();
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

  private cel(i: number): Drawable | null {
    if (!this.dc6) {
      if (!this.loading) {
        this.loading = true;
        void this.assets.load(CELL_PATH).then((b) => {
          if (b) this.dc6 = parseDc6(b);
        });
      }
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
   * 드러난 타일을 그린다. 화면 중심 = 플레이어 (전체) / 오른쪽 위 상자 중심 (미니).
   * @param levelName AutoMap.txt LevelName (예: "1 Wilderness")
   */
  draw(ctx: CanvasRenderingContext2D, mode: AutomapMode, level: PresetLevel, levelName: string, reveal: AutomapReveal, mk: AutomapMarkers, width: number, height: number): number {
    if (mode === 'off') return 0;
    const scale = mode === 'mini' ? 0.5 : 1;
    const box = mode === 'mini' ? { x: width - 200, y: 8, w: 192, h: 150 } : { x: 0, y: 0, w: width, h: height };
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    // 플레이어 서브타일 → 자동 지도 좌표 (서브타일 1 = 3.2×1.6 픽셀)
    const pax = ((mk.player.x - mk.player.y) * 16) / 10, pay = ((mk.player.x + mk.player.y) * 8) / 10;
    const toMap = (sx: number, sy: number) => ({ x: cx + (((sx - sy) * 16) / 10 - pax) * scale, y: cy + (((sx + sy) * 8) / 10 - pay) * scale });
    ctx.save();
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
