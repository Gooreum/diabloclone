// 퀘스트 로그 패널 (Q, 캔버스). 원작 DC6: data\global\ui\MENU\questbackground.dc6 (256+64 × 256+176, 4조각),
// questtabs.dc6 (액트 I~IV 탭 — 프레임 쌍), a1q1.dc6 ~ a1q6.dc6 (퀘스트 아이콘 72×86, 27 프레임: 0 진행 중, 1~24 완료 불꽃 애니메이션,
// 24 완료(회색), 26 시작 전(어두움)), questlast.dc6 (마지막 퀘스트 단추).
// 출처: string.tbl qsts "Quest Status", qstsa1q1~6 (퀘스트 이름), qstsa1q<퀘스트><상태> (설명), qstsComplete
// 근사(원작 미확인): 아이콘 줄·칸 위치(3개 × 2줄), 설명 글자 위치·줄바꿈, 프레임 25(금테) 미사용, 글꼴 원작 font16,
//   완료 애니메이션 속도(25fps 로 한 번), 탭 프레임 짝(선택/비선택), 패널 위치(웨이포인트 패널과 같은 왼쪽 패널 자리)
import { parseDc6, type Dc6 } from '../formats/dc6';
import type { Palette } from '../formats/palette';
import type { QuestLogEntry } from '../engine/quests/act1';
import { questLogKey } from '../engine/quests/messages';
import { indexedToCanvas, type Drawable } from '../render/sprites';
import type { AsyncAssets } from '../render/units';
import { d2text, drawText } from './text';

type Str = (k: string) => string;

export const QUEST_PANEL = { x: 80, y: 60, w: 320, h: 432 } as const;
/** 아이콘 칸 (패널 기준): 3개 × 2줄 */
const ICON = { x0: 26, y0: 44, dx: 94, dy: 96, w: 72, h: 86 } as const;
const TAB = { x: 2, y: 3, w: 78, h: 30 } as const;
/** 클래식 막 탭 수 (I~IV) */
const TABS = 4;
const TEXT = { x: 160, y: 250, w: 280, line: 17 } as const;
const LAST = { x: 223, y: 389, w: 30, h: 30 } as const;
const CLOSE = { x: 272, y: 384, w: 36, h: 36 } as const;
const FILES = ['questbackground', 'questtabs', 'questlast', 'a1q1', 'a1q2', 'a1q3', 'a1q4', 'a1q5', 'a1q6'];

export class QuestPanel {
  open = false;
  /** 고른 막 탭 (0 = Act I). 막마다 퀘스트 줄은 Game.questLog(tab) */
  tab = 0;
  /** 누를 수 있는 탭 (퀘스트 모듈이 있는 막) */
  tabEnabled: boolean[] = [true, false, false, false];
  /** 고른 퀘스트 (원작: 가장 최근에 갱신된 퀘스트가 처음 선택) */
  selected = 1;
  private readonly frames = new Map<string, Drawable[] | null>();
  /** 완료 애니메이션을 이미 보여 준 퀘스트 */
  private readonly animated = new Set<number>();
  private animStart = new Map<number, number>();
  private entries: readonly QuestLogEntry[] = [];

  constructor(private readonly assets: AsyncAssets, private readonly pal: Palette) {
    for (const f of FILES) this.load(f);
  }

  private load(name: string): void {
    this.frames.set(name, null);
    void this.assets.load(`data\\global\\ui\\menu\\${name}.dc6`).then((b) => {
      if (!b) return;
      const d: Dc6 = parseDc6(b);
      this.frames.set(name, d.frames.map((f) => indexedToCanvas(f.pixels, f.width, f.height, this.pal)));
    });
  }

  get ready(): boolean {
    return FILES.every((n) => !!this.frames.get(n));
  }

  toggle(entries: readonly QuestLogEntry[]): void {
    this.open = !this.open;
    if (this.open) this.onOpen(entries);
  }

  private onOpen(entries: readonly QuestLogEntry[]): void {
    // 근사(원작 미확인): 처음 선택 = 진행 중인 첫 퀘스트
    const act = entries.find((e) => e.icon === 'active');
    if (act) this.selected = act.quest;
  }

  /** 아이콘 칸 i (로그 순서) 의 화면 위치 */
  iconRect(i: number): { x: number; y: number; w: number; h: number } {
    const P = QUEST_PANEL;
    return { x: P.x + ICON.x0 + (i % 3) * ICON.dx, y: P.y + ICON.y0 + Math.floor(i / 3) * ICON.dy, w: ICON.w, h: ICON.h };
  }

  /** 아이콘 프레임: 시작 전 26, 진행 중 0, 완료 24 (이번 게임에 끝났으면 처음 볼 때 1→24 애니메이션) */
  private iconFrame(e: QuestLogEntry, now: number): number {
    if (e.icon === 'none') return 26;
    if (e.icon === 'active') return 0;
    if (e.justDone && !this.animated.has(e.quest)) {
      const start = this.animStart.get(e.quest) ?? now;
      this.animStart.set(e.quest, start);
      const f = 1 + Math.floor((now - start) / 40);
      if (f < 24) return f;
      this.animated.add(e.quest);
    }
    return 24;
  }

  draw(ctx: CanvasRenderingContext2D, entries: readonly QuestLogEntry[], str: Str, now: number): void {
    this.entries = entries;
    if (!this.open) return;
    const P = QUEST_PANEL;
    const bg = this.frames.get('questbackground');
    if (bg) {
      const pos = [[0, 0], [256, 0], [0, 256], [256, 256]];
      bg.forEach((c, i) => ctx.drawImage(c as CanvasImageSource, P.x + (pos[i]?.[0] ?? 0), P.y + (pos[i]?.[1] ?? 0)));
    }
    const tabs = this.frames.get('questtabs');
    // 탭 프레임 짝: 선택 2a, 비선택 2a+1 (근사(원작 미확인))
    if (tabs) for (let a = 0; a < TABS; a++) {
      const f = tabs[a * 2 + (a === this.tab ? 0 : 1)];
      if (f) ctx.drawImage(f as CanvasImageSource, P.x + TAB.x + a * TAB.w, P.y + TAB.y);
    }
    entries.forEach((e, i) => {
      const icons = this.frames.get(`a1q${e.quest}`);
      const r = this.iconRect(i);
      const f = icons?.[this.iconFrame(e, now)];
      if (f) ctx.drawImage(f as CanvasImageSource, r.x, r.y);
      if (e.quest === this.selected) {
        ctx.strokeStyle = '#c7b377';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
    });
    const last = this.frames.get('questlast')?.[0];
    if (last) ctx.drawImage(last as CanvasImageSource, P.x + LAST.x, P.y + LAST.y);
    // 고른 퀘스트: 이름 + 설명
    const sel = entries.find((e) => e.quest === this.selected);
    // 퀘스트가 없는 탭 (아직 없는 막) 은 이름·설명 없이
    if (!entries.length) return;
    drawText(ctx, str(`qstsa1q${this.selected}`), P.x + TEXT.x, P.y + TEXT.y - 8, { align: 'center', color: 'white' });
    if (sel) {
      const lines = this.description(sel, str);
      let y = P.y + TEXT.y + 26 - 8;
      for (const para of lines) for (const l of d2text.wrap(para, TEXT.w)) {
        drawText(ctx, l, P.x + TEXT.x, y, { align: 'center', color: 'gold' });
        y += TEXT.line;
      }
    }
  }

  /** 설명 줄: 상태 문자열 (Den 상태 4 는 남은 몬스터 수, 1 마리면 qstsa1q140) */
  description(e: QuestLogEntry, str: Str): string[] {
    if (e.icon === 'none') return [];
    if (e.icon === 'done') return [str('qstsComplete')];
    if (e.quest === 1 && e.status === 4) return [e.count === 1 ? str('qstsa1q140') : `${str('qstsa1q14')}${e.count}`];
    const k = questLogKey(e.quest, e.status);
    return k ? [str(k)] : [];
  }

  /** 클릭 → 'close' / 'panel' / null(밖). 아이콘을 누르면 그 퀘스트를 고른다 */
  click(x: number, y: number): 'close' | 'panel' | null {
    if (!this.open) return null;
    const P = QUEST_PANEL;
    if (x < P.x || y < P.y || x > P.x + P.w || y > P.y + P.h) return null;
    if (x >= P.x + CLOSE.x && x <= P.x + CLOSE.x + CLOSE.w && y >= P.y + CLOSE.y && y <= P.y + CLOSE.y + CLOSE.h) return 'close';
    // 막 탭: 퀘스트가 있는 막만 고를 수 있다
    if (y >= P.y + TAB.y && y < P.y + TAB.y + TAB.h && x >= P.x + TAB.x && x < P.x + TAB.x + TABS * TAB.w) {
      const a = Math.floor((x - P.x - TAB.x) / TAB.w);
      if (this.tabEnabled[a]) this.tab = a;
      return 'panel';
    }
    if (x >= P.x + LAST.x && x <= P.x + LAST.x + LAST.w && y >= P.y + LAST.y && y <= P.y + LAST.y + LAST.h) {
      // 근사(원작 미확인): questlast = 마지막으로 진행한 퀘스트로 — 여기서는 진행 중인 마지막 퀘스트
      const act = [...this.entries].reverse().find((e) => e.icon === 'active');
      if (act) this.selected = act.quest;
      return 'panel';
    }
    this.entries.forEach((e, i) => {
      const r = this.iconRect(i);
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) this.selected = e.quest;
    });
    return 'panel';
  }
}
