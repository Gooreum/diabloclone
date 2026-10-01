// 스킬 트리 (T): 원작 data\global\ui\SPELLS\skltree_<a|s|n|p|b>_back.dc6 (16조각 = 4조각 × 4: 0~3 탭 기둥·남은 포인트 칸, 4~7 첫째 탭, 8~11 둘째, 12~15 셋째),
// 스킬 아이콘 SPELLS\<Am|So|Ne|Pa|Ba>Skillicon.dc6 (skilldesc IconCel), 닫기 단추 buysellbtn.dc6 프레임 10. 오른쪽 패널 자리 (400,60).
// 출처(배치): skilldesc.txt SkillPage/SkillRow/SkillColumn — 그림의 아이콘 칸 모양과 일치(바바리안: 1쪽 Bash 1행 2열 …),
//   선택된 탭 그림이 이어지는 위치: 1쪽 = 아래 탭(y 322~432), 2쪽 = 가운데(215~322), 3쪽 = 위(107~215), 탭 기둥 x 230~320 (원작 그림 측정)
//   아이콘 간격 가로 69 · 세로 68 (그림의 칸 간격 측정, OpenDiablo2 skilltree.go skillIconDistX/Y 와 같음)
// 출처(문자열): string.tbl StrSklTree1~3 "Skill" "Choices" "Remaining", 탭 이름 StrSklTree4~25 (예: 바바리안 "Combat"+"Skills", "Combat"+"Masteries", "Warcries"),
//   skilldesc str name / str long, skilldesc3 "Required Level : ", StrSkill2 "Current Skill Level: "
// 근사(원작 미확인): 첫 아이콘 위치 (15,15), 레벨 숫자 위치(아이콘 칸 오른쪽 아래 계단), 배울 수 없는 스킬은 어둡게
// 툴팁: 이름 → 설명 → dsc2 줄 → 요구 레벨 → 현재 레벨(또는 First Level) 줄 + 다음 레벨 줄 → dsc3(시너지) — 줄 만들기는 src/ui/skilltip.ts
import type { Character } from '../engine/player';
import type { TextColorName } from '../formats/pl2';
import type { SkillDb, SkillRecord } from '../engine/skills/db';
import { learnError } from '../engine/skills/rules';
import { UI, type UiArt } from './art';
import { CLOSE_BTN } from './charpanel';
import { skillIconPath } from './hud';
import { HotLayer, type HRect } from './hotspot';
import type { SkillTipLines } from './skilltip';
import { d2text, drawText } from './text';

export const RIGHT_PANEL = { x: 400, y: 60, w: 320, h: 432 } as const;
const ICON = { x0: 15, y0: 15, dx: 69, dy: 68 } as const;
const TAB_TOP: Record<number, number> = { 1: 322, 2: 215, 3: 107 };
const TAB = { x: 230, w: 90, h: 107 } as const;
/** 닫기 칸 (탭별 그림 위치가 다르다: 원작 그림 측정) */
const CLOSE: Record<number, { x: number; y: number }> = { 1: { x: 171, y: 385 }, 2: { x: 15, y: 385 }, 3: { x: 171, y: 385 } };

/** 트리 배경 skltree_<글자>_back.dc6 (확장팩: 드루이드 d · 어쌔신 i — d2exp) */
const TREE_LETTER: Record<string, string> = { ama: 'a', sor: 's', nec: 'n', pal: 'p', bar: 'b', dru: 'd', ass: 'i' };
/** 탭 이름 (string.tbl StrSklTreeN) — 쪽 번호 순 */
const TAB_STR: Record<string, [string[], string[], string[]]> = {
  ama: [['StrSklTree10', 'StrSklTree11'], ['StrSklTree8', 'StrSklTree9'], ['StrSklTree6', 'StrSklTree7']],
  sor: [['StrSklTree25', 'StrSklTree5'], ['StrSklTree24', 'StrSklTree5'], ['StrSklTree23', 'StrSklTree5']],
  nec: [['StrSklTree19'], ['StrSklTree17', 'StrSklTree18'], ['StrSklTree16', 'StrSklTree5']],
  pal: [['StrSklTree15', 'StrSklTree4'], ['StrSklTree14', 'StrSklTree13'], ['StrSklTree12', 'StrSklTree13']],
  bar: [['StrSklTree21', 'StrSklTree4'], ['StrSklTree21', 'StrSklTree22'], ['StrSklTree20']],
  // 확장팩 (expansionstring.tbl): 드루이드 Summoning / Shape Shifting / Elemental, 어쌔신 Traps / Shadow Disciplines / Martial Arts
  dru: [['StrSklTree26'], ['StrSklTree27', 'StrSklTree28'], ['StrSklTree29']],
  ass: [['StrSklTree30'], ['StrSklTree31', 'StrSklTree32'], ['StrSklTree33', 'StrSklTree34']],
};

export interface SkillPanelDeps {
  db: SkillDb;
  character: () => Character;
  learn: (id: number) => void;
  str: (k: string) => string;
  /** skilldesc str long (설명) */
  describe: (s: SkillRecord) => string;
  /** 레벨별 줄 (skilldesc desc/dsc2/dsc3) */
  tip?: (s: SkillRecord, lvl: number) => SkillTipLines;
  /** 유효 스킬 레벨 (아이템 +스킬 포함) — 툴팁 "Current Skill Level" 에 쓴다. 트리 숫자는 원작처럼 하드 포인트 */
  skillLevel?: (id: number) => number;
  onClose: () => void;
}

export class SkillTree {
  page = 1;
  /** e2e: 마지막으로 그린 툴팁 줄 */
  lastTip: string[] = [];
  private readonly art: UiArt;
  private readonly deps: SkillPanelDeps;
  readonly layer: HotLayer;

  constructor(stage: HTMLElement, art: UiArt, deps: SkillPanelDeps) {
    this.art = art;
    this.deps = deps;
    this.layer = new HotLayer(stage, 'skilltree', RIGHT_PANEL);
  }

  get open(): boolean {
    return this.layer.visible;
  }

  set open(v: boolean) {
    this.layer.visible = v;
  }

  toggle(): void {
    this.open = !this.open;
  }

  private code(): string {
    return this.deps.db.classSkills(this.deps.character().cls)[0]?.charclass ?? '';
  }

  /** 스킬 아이콘 칸 (화면 좌표) */
  iconRect(s: SkillRecord): HRect {
    return { x: RIGHT_PANEL.x + ICON.x0 + (s.column - 1) * ICON.dx, y: RIGHT_PANEL.y + ICON.y0 + (s.row - 1) * ICON.dy, w: 48, h: 48 };
  }

  tabRect(page: number): HRect {
    return { x: RIGHT_PANEL.x + TAB.x, y: RIGHT_PANEL.y + (TAB_TOP[page] ?? 0), w: TAB.w, h: TAB.h };
  }

  private syncHotspots(list: SkillRecord[]): void {
    const keys = new Set<string>();
    // 모든 탭의 스킬 단추를 두되 현재 탭이 아니면 숨긴다 (e2e: data-skill 30개)
    for (const s of list) {
      const k = `s${s.id}`;
      keys.add(k);
      const el = this.layer.button(k, this.iconRect(s), () => this.deps.learn(s.id), { id: `skill-${s.id}`, 'data-skill': String(s.id), 'data-learn': String(s.id) }, s.displayName);
      if (s.page !== this.page) el.style.display = 'none';
    }
    for (const p of [1, 2, 3]) {
      keys.add(`t${p}`);
      this.layer.button(`t${p}`, this.tabRect(p), () => (this.page = p), { id: `skilltab-${p}` }, `Tab ${p}`);
    }
    const c = CLOSE[this.page] ?? CLOSE[1]!;
    keys.add('close');
    this.layer.button('close', { x: RIGHT_PANEL.x + c.x, y: RIGHT_PANEL.y + c.y, w: 32, h: 32 }, () => this.deps.onClose(), { id: 'skilltree-close' }, 'Close');
    this.layer.only(keys);
  }

  draw(ctx: CanvasRenderingContext2D, mouse: { x: number; y: number } | null): void {
    if (!this.open) return;
    const d = this.deps, ch = d.character(), code = this.code(), P = RIGHT_PANEL;
    const list = d.db.classSkills(ch.cls);
    this.syncHotspots(list);
    const bg = `${UI}SPELLS\\skltree_${TREE_LETTER[code] ?? 'a'}_back.dc6`;
    const ok = this.art.drawPanel(ctx, bg, P.x, P.y, 0);
    this.art.drawPanel(ctx, bg, P.x, P.y, 4 * this.page);
    if (!ok) {
      ctx.fillStyle = 'rgba(12,10,8,0.94)';
      ctx.fillRect(P.x, P.y, P.w, P.h);
    }
    const s = d.str;
    // 남은 스킬 포인트 (위 칸)
    drawText(ctx, `${s('StrSklTree1')}\n${s('StrSklTree2')}\n${s('StrSklTree3')}`, P.x + 276, P.y + 8, { align: 'center', font: 'font16', lineHeight: 14 });
    drawText(ctx, String(ch.skillPoints), P.x + 274, P.y + 60, { align: 'center', font: 'font16' });
    // 탭 이름
    const names = TAB_STR[code] ?? [[], [], []];
    for (const p of [1, 2, 3]) {
      const r = this.tabRect(p);
      const text = (names[p - 1] ?? []).map((k) => s(k)).join('\n');
      const lines = text.split('\n').length;
      drawText(ctx, text, r.x + r.w / 2 + 2, r.y + r.h / 2 - (lines * 14) / 2, { align: 'center', font: 'font16', lineHeight: 14, color: p === this.page ? 'white' : 'grey' });
    }
    // 아이콘·레벨
    const iconFile = skillIconPath(code);
    let hover: SkillRecord | null = null;
    for (const sk of list) {
      if (sk.page !== this.page) continue;
      const r = this.iconRect(sk);
      const lvl = ch.skills[sk.id] ?? 0;
      const f = this.art.frame(iconFile, sk.iconCel);
      if (f) ctx.drawImage(f.img as CanvasImageSource, r.x, r.y);
      const err = learnError(ch, sk, d.db);
      // 근사: 배우지 않았고 지금 배울 수도 없으면 어둡게
      if (!lvl && err && err !== 'points') {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(r.x, r.y, 48, 48);
      }
      // 레벨 숫자: 아이콘 칸 오른쪽 아래 계단 칸 (그림 측정: 아이콘 기준 x 41~58, y 47~62)
      if (lvl) drawText(ctx, String(lvl), r.x + 50, r.y + 47, { align: 'center', font: 'font16' });
      if (mouse && mouse.x >= r.x && mouse.y >= r.y && mouse.x < r.x + r.w && mouse.y < r.y + r.h) hover = sk;
    }
    // 닫기 단추
    const c = CLOSE[this.page] ?? CLOSE[1]!;
    this.art.draw(ctx, CLOSE_BTN, 10, P.x + c.x, P.y + c.y);
    if (hover && mouse) this.tooltip(ctx, hover, ch, mouse);
  }

  private tooltip(ctx: CanvasRenderingContext2D, sk: SkillRecord, ch: Character, mouse: { x: number; y: number }): void {
    const s = this.deps.str;
    const lvl = this.deps.skillLevel?.(sk.id) ?? ch.skills[sk.id] ?? 0;
    const desc = this.deps.describe(sk);
    const lines: { text: string; color: TextColorName }[] = [{ text: sk.displayName, color: 'green' }];
    // 원작 string.tbl 설명은 줄 순서가 아래→위로 저장돼 있다 (예: skillld126 "to enemies…\npowerful blow…")
    for (const l of desc.split('\n').reverse()) if (l.trim()) lines.push({ text: l, color: 'white' });
    const tip = this.deps.tip?.(sk, lvl);
    if (tip?.dsc2.length) lines.push(...tip.dsc2);
    lines.push({ text: '', color: 'white' });
    lines.push({ text: `${s('skilldesc3')}${sk.reqLevel}`, color: ch.level < sk.reqLevel ? 'red' : 'white' });
    if (tip) lines.push(...tip.level);
    else if (lvl) lines.push({ text: `${s('StrSkill2')}${lvl}`, color: 'white' });
    if (tip?.dsc3.length) lines.push({ text: '', color: 'white' }, ...tip.dsc3);
    this.lastTip = lines.map((l) => l.text);
    const lh = d2text.lineHeight('font16');
    const w = Math.max(...lines.map((l) => d2text.width(l.text))) + 12, h = lines.length * lh + 6;
    const x = Math.max(2, Math.min(798 - w, mouse.x - w - 10)), y = Math.max(2, Math.min(598 - h, mouse.y - h / 2));
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(x, y, w, h);
    lines.forEach((l, i) => drawText(ctx, l.text, x + w / 2, y + 3 + i * lh, { align: 'center', color: l.color }));
  }

  dispose(): void {
    this.layer.dispose();
  }
}
