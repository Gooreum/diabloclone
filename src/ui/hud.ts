// 컨트롤 패널 (HUD): 원작 data\global\ui\PANEL\ctrlpnl7.dc6 (6조각), 생명·마나 구체 hlthmana.dc6 + 유리 테두리 overlap.dc6,
// 스킬 버튼 (SPELLS\<클래스>Skillicon.dc6, skilldesc IconCel), 달리기 버튼 runbutton.dc6, 미니 패널 버튼 menubutton.dc6 → minipanel.dc6 + minipanelbtn.dc6,
// 레벨 업 버튼 level.dc6 (string.tbl strlvlup "New Stats" / strnewskl "New Skill"), 벨트 4칸, 경험치·스태미나 막대.
// 출처(좌표): ctrlpnl7.dc6 조각 픽셀 직접 측정 — 조각0(117×104) 구체 받침: 구체 중심 표식 (76.5,42.5), 조각4: (59.5,42.5) → 80×80 구체 왼쪽 위 (37,3) / (20,3)
//             조각1(128×55): 경험치 막대 안쪽 x 11~127 y 15~17, 달리기 칸 x 10~25 y 26~42, 스태미나 막대 x 29~127(+조각2 0~1) y 26~42
//             조각2(128×55): 미니 패널 버튼 칸 x 18~33 y 16~39, 벨트 칸 경계 x 48·79·111 (조각3 x 13·44), 칸 안쪽 y 16~46
// 출처(문자열): string.tbl panelhealth "Life: %d / %d", panelmana "Mana: %d / %d", panelstamina "Stamina: %d / %d", panelexp "Experience: %u / %u",
//             minipanelchar/minipanelinv/minipaneltree/minipanelparty/minipanelautomap/minipanelmessage/minipanelquest/minipanelmenubtn, RunOn/RunOff
// 근사(원작 미확인): 800 폭 배치 — 원작 클래식 파일에는 800ctrlpnl7 이 없다 (d2data 는 ctrlpnl7.dc6 6조각뿐, 640 = 조각 0·1·2·3·4 + 스킬 버튼 둘).
//   벨트 오른쪽에 남는 160픽셀은 원작 조각으로 만든 돌 판: 조각3 의 칸 없는 돌 줄(x 46~51, 금테 x 44·45 제외)을 이어 깔고 가운데에 조각2 의 조각 장식(x 5~47)을 둔다.
//   (조각5 는 왼쪽이 투명한 창이라 쓰면 검은 칸이 생겼다)
//   미니 패널 위치(패널 위 가운데), 레벨 업 버튼 위치, 경험치·스태미나 막대 색, 스킬 고르기 목록 배치(행당 10개, 버튼 위로 쌓음)
// 벨트 펼치기(원작: 벨트를 누르거나 ~ 키 — 벨트 크기(belts.txt numboxes ÷ 4)만큼 줄이 패널 위로 펼쳐진다, 칸 번호 = 줄 × 4 + 열, 아래 줄이 0):
//   근사(원작 미확인): 펼친 줄 간격 32, 어두운 바탕 + 금색 테두리 (원작 테두리 그림 미확인)
import type { WorldSnapshot } from '../engine/game';
import type { Character, ExpTable } from '../engine/player';
import type { ItemStore } from '../engine/itemstore';
import type { SkillDb, SkillRecord } from '../engine/skills/db';
import type { ItemIcons } from './invpanel';
import type { Edition } from '../assets/edition';
import { UI, type UiArt } from './art';
import { d2text, drawText } from './text';
import { makeCanvas, type Drawable } from '../render/sprites';

export const PANEL = `${UI}PANEL\\`;
const CTRL = `${PANEL}ctrlpnl7.dc6`;
/**
 * 확장팩 800 조작판 (d2exp): 7조각 117×104 / 128×55 ×3 / 86×55 / 117×104 / 128×55.
 * 출처(좌표): 조각 폭을 그대로 이으면 0 | 왼쪽 스킬 48 | 165 | 293 | 421 | 549(86폭) | 오른쪽 스킬 635 | 683(오른쪽 구체 받침) = 800.
 * 조각 6 은 쓰지 않는다 (근사(원작 미확인): 클래식 조각 5 처럼 왼쪽이 투명한 대체 조각으로 보임)
 */
const CTRL800 = `${PANEL}800ctrlpnl7.dc6`;
const GLOBE = `${PANEL}hlthmana.dc6`;
const OVERLAP = `${PANEL}overlap.dc6`;
const RUN = `${PANEL}runbutton.dc6`;
const MENUBTN = `${PANEL}menubutton.dc6`;
const MINI = `${PANEL}minipanel.dc6`;
const MINIBTN = `${PANEL}minipanelbtn.dc6`;
const LEVEL = `${PANEL}level.dc6`;
export const HUD_ART = [CTRL, GLOBE, OVERLAP, RUN, MENUBTN, MINI, MINIBTN, LEVEL, `${UI}SPELLS\\Skillicon.dc6`];

/** 스킬 아이콘 파일 (skills.txt charclass → SPELLS\<접두>Skillicon.dc6, 일반 스킬 = Skillicon.dc6) */
export function skillIconPath(charclass: string): string {
  // 확장팩: DrSkillicon · AsSkillicon (d2exp)
  const pre: Record<string, string> = { ama: 'Am', sor: 'So', nec: 'Ne', pal: 'Pa', bar: 'Ba', dru: 'Dr', ass: 'As' };
  return `${UI}SPELLS\\${pre[charclass] ?? ''}Skillicon.dc6`;
}

// 800×600 배치 (위 머리말 참고)
type Pt = { readonly x: number; readonly y: number };
type Box = Pt & { readonly w: number; readonly h: number };
export interface HudLayout {
  f0: Pt; f1: Pt; f2: Pt; f3: Pt; f3x: Pt; plate: Pt & { readonly w: number }; f4: Pt;
  lskill: Pt; rskill: Pt; lifeGlobe: Pt; manaGlobe: Pt;
  exp: Box; stamina: Box; run: Box; menuBtn: Box;
  belt: { readonly xs: readonly [number, number, number, number]; readonly y: number; readonly w: number; readonly h: number };
  mini: Box; newStats: Pt; newSkill: Pt;
}

export const HUD: HudLayout = {
  f0: { x: 0, y: 496 }, f1: { x: 165, y: 545 }, f2: { x: 293, y: 545 }, f3: { x: 421, y: 545 }, f3x: { x: 549, y: 545 }, plate: { x: 475, y: 545, w: 160 }, f4: { x: 683, y: 496 },
  lskill: { x: 117, y: 552 }, rskill: { x: 635, y: 552 },
  lifeGlobe: { x: 37, y: 499 }, manaGlobe: { x: 703, y: 499 },
  exp: { x: 176, y: 560, w: 117, h: 3 },
  stamina: { x: 194, y: 571, w: 101, h: 17 },
  run: { x: 175, y: 570, w: 16, h: 20 },
  menuBtn: { x: 311, y: 560, w: 15, h: 24 },
  belt: { xs: [342, 373, 405, 435], y: 561, w: 30, h: 30 },
  mini: { x: 314, y: 519, w: 173, h: 26 },
  newStats: { x: 175, y: 506 }, newSkill: { x: 595, y: 506 },
};

/**
 * 확장팩 800 조작판 배치. 출처(좌표): 800ctrlpnl7.dc6 를 위 자리에 이어 그린 뒤 픽셀 직접 측정 —
 *   경험치 칸 안쪽 x 256~374 y 560~562, 달리기 칸 x 257~270, 스태미나 칸 안쪽 x 274~375 y 571~587,
 *   미니 패널 단추 칸 x 392~406 y 562~586, 벨트 칸 경계 x 422·453·484·515·545 (안쪽 y 561~589),
 *   십자 무늬 빈 칸 2개 안쪽 x 206~235 / 563~592 y 562~592 (30×30 = level.dc6 크기 → 레벨 업 단추 자리)
 * 근사(원작 미확인): 레벨 업 단추를 십자 칸에 두는 것 (그림 크기가 꼭 맞아 그렇게 봄), 미니 패널 위치는 클래식과 같게
 */
export const HUD800: HudLayout = {
  ...HUD,
  exp: { x: 256, y: 560, w: 119, h: 3 },
  stamina: { x: 274, y: 571, w: 102, h: 17 },
  run: { x: 255, y: 570, w: 16, h: 20 },
  menuBtn: { x: 392, y: 562, w: 15, h: 24 },
  belt: { xs: [423, 454, 485, 516], y: 561, w: 30, h: 30 },
  mini: { x: 314, y: 519, w: 173, h: 26 },
  newStats: { x: 206, y: 562 }, newSkill: { x: 563, y: 562 },
};

export type MiniButton = 'char' | 'inv' | 'tree' | 'party' | 'automap' | 'message' | 'quest' | 'menu';
const MINI_BUTTONS: MiniButton[] = ['char', 'inv', 'tree', 'party', 'automap', 'message', 'quest', 'menu'];
const MINI_STR: Record<MiniButton, string> = {
  char: 'minipanelchar', inv: 'minipanelinv', tree: 'minipaneltree', party: 'minipanelparty', automap: 'minipanelautomap', message: 'minipanelmessage', quest: 'minipanelquest', menu: 'minipanelmenubtn',
};

export type HudAction =
  | { kind: 'run' }
  | { kind: 'minipanel' }
  | { kind: 'mini'; button: MiniButton }
  | { kind: 'newStats' }
  | { kind: 'newSkill' }
  | { kind: 'skillMenu'; hand: 'left' | 'right' }
  | { kind: 'setSkill'; hand: 'left' | 'right'; id: number; charge?: boolean }
  | { kind: 'belt'; slot: number }
  | { kind: 'panel' };

export interface HudState {
  snap: Readonly<WorldSnapshot>;
  ch: Character;
  exp: ExpTable | undefined;
  dead: boolean;
  run: boolean;
  store: ItemStore;
  str: (k: string) => string;
  canSelect: (s: SkillRecord, hand: 'left' | 'right', charge?: boolean) => boolean;
  /** 스킬 고르기 목록의 아이템 줄 (다른 직업 스킬 · 충전 스킬) */
  itemSkills?: () => { skill: number; charge: boolean; cur?: number; max?: number }[];
  mouse: { x: number; y: number } | null;
  /** 스킬 단축키 칸(0~7)의 지금 키 이름 (옵션에서 바꾼 키) */
  hotkeyLabel?: (slot: number) => string;
  /** 지금 쓸 수 있는 스킬인가 (원작 SKILLS_GetUseState — 아니면 아이콘을 빨갛게). 없으면 늘 쓸 수 있음 */
  usable?: (skill: number, charge?: boolean) => boolean;
}

interface Rect { x: number; y: number; w: number; h: number }
const inRect = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const fmt = (s: string, ...v: (string | number)[]) => {
  let i = 0;
  return s.replace(/%[du]/g, () => String(v[i++] ?? ''));
};

export class ControlPanel {
  miniOpen = false;
  /** 벨트 펼침 (원작 Show Belt) */
  beltOpen = false;
  skillMenu: 'left' | 'right' | null = null;
  private readonly art: UiArt;
  private readonly icons: ItemIcons;
  private readonly skills: SkillDb | undefined;
  private menuRects: { id: number; r: Rect; charge?: boolean; cur?: number; max?: number }[] = [];
  /** 빈 구슬 유리 (hlthmana 프레임 3 을 회색으로 바꾼 것, 처음 그릴 때 만든다) */
  private glassImg: Drawable | null = null;

  /** 확장팩 설치면 원작 800 조작판 (원작 LoD 는 800×600 에서 클래식 캐릭터도 이 판을 쓴다) */
  private readonly lod: boolean;
  /** 판본별 배치 (클래식 근사 / 확장팩 800 조작판 실측) */
  readonly L: HudLayout;

  constructor(art: UiArt, icons: ItemIcons, skills: SkillDb | undefined, edition: Edition = 'classic') {
    this.art = art;
    this.icons = icons;
    this.skills = skills;
    this.lod = edition === 'lod';
    this.L = this.lod ? HUD800 : HUD;
    void art.preload(this.lod ? [...HUD_ART, CTRL800] : HUD_ART);
  }

  private skillIcon(ctx: CanvasRenderingContext2D, id: number, x: number, y: number, pressed = false, red = false): void {
    const s = this.skills?.byId.get(id);
    const path = skillIconPath(s?.charclass ?? '');
    const f = this.art.frame(path, (s?.iconCel ?? 0) + (pressed ? 1 : 0));
    if (f) ctx.drawImage(f.img as CanvasImageSource, x, y);
    else {
      ctx.fillStyle = '#111';
      ctx.fillRect(x, y, 48, 48);
    }
    // 지금 쓸 수 없는 스킬은 빨갛게 (원작: SKILLS_GetUseState 가 USABLE·AURA 가 아니면 붉은 색으로 그린다).
    // 근사(원작 미확인): 원작 팔레트 색 바꾸기 대신 붉은색 곱하기 섞기
    if (red) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#ff2a1a';
      ctx.fillRect(x, y, 48, 48);
      ctx.restore();
    }
  }

  /** 스킬 고르기 목록 (원작: 스킬 버튼을 누르면 쓸 수 있는 스킬 아이콘이 버튼 위로 늘어선다) */
  private menuSkills(st: HudState, hand: 'left' | 'right'): SkillRecord[] {
    const db = this.skills;
    if (!db) return [];
    const ch = st.ch;
    const general = [0, 1, 2, 3, 4, 5].map((i) => db.byId.get(i)).filter((s): s is SkillRecord => !!s);
    // 배운 스킬 + 아이템 개별 스킬로 얻은 스킬 (canSelect = 유효 레벨 > 0)
    const learned = db.classSkills(ch.cls);
    return [...general, ...learned].filter((s) => !s.passive && st.canSelect(s, hand));
  }

  private layoutMenu(st: HudState): void {
    this.menuRects = [];
    const hand = this.skillMenu;
    if (!hand) return;
    const list = this.menuSkills(st, hand);
    const place = (i: number) => {
      const row = Math.floor(i / 10), col = i % 10;
      return { x: hand === 'right' ? this.L.rskill.x - col * 48 : this.L.lskill.x + col * 48, y: this.L.lskill.y - 48 * (row + 1) - 4, w: 48, h: 48 };
    };
    list.forEach((s, i) => this.menuRects.push({ id: s.id, r: place(i) }));
    // 아이템 줄 (다른 직업 스킬 · 충전 스킬): 직업 스킬 위 새 줄. 근사(원작 미확인): 원작 줄 순서·위치
    const rows = Math.ceil(list.length / 10);
    const extra = (st.itemSkills?.() ?? []).filter((e) => {
      const s = this.skills?.byId.get(e.skill);
      return !!s && st.canSelect(s, hand, e.charge);
    });
    extra.forEach((e, k) => this.menuRects.push({ id: e.skill, r: place(rows * 10 + k), ...(e.charge ? { charge: true, cur: e.cur, max: e.max } : {}) }));
  }

  /** 스킬 고르기 목록에서 (x, y) 아래 칸 (충전 스킬 여부 포함) */
  hoveredMenuEntry(x: number, y: number): { id: number; charge: boolean } | null {
    if (!this.skillMenu) return null;
    const m = this.menuRects.find((q) => inRect(q.r, x, y));
    return m ? { id: m.id, charge: !!m.charge } : null;
  }

  /** 스킬 고르기 목록에서 (x, y) 아래 스킬 (단축키 등록용) */
  hoveredMenuSkill(x: number, y: number): number | null {
    if (!this.skillMenu) return null;
    return this.menuRects.find((m) => inRect(m.r, x, y))?.id ?? null;
  }

  /** e2e: 스킬 고르기 목록에서 스킬 아이콘 가운데 */
  menuCenter(id: number, charge = false): { x: number; y: number } | null {
    const m = this.menuRects.find((q) => q.id === id && !!q.charge === charge);
    return m ? { x: m.r.x + 24, y: m.r.y + 24 } : null;
  }

  /** e2e: 버튼 가운데 */
  center(what: 'lskill' | 'rskill' | 'run' | 'menuBtn' | MiniButton | 'newStats' | 'newSkill'): { x: number; y: number } {
    if (what === 'lskill' || what === 'rskill') return { x: this.L[what].x + 24, y: this.L[what].y + 24 };
    if (what === 'run') return { x: this.L.run.x + 8, y: this.L.run.y + 10 };
    if (what === 'menuBtn') return { x: this.L.menuBtn.x + 7, y: this.L.menuBtn.y + 12 };
    if (what === 'newStats' || what === 'newSkill') return { x: this.L[what].x + 15, y: this.L[what].y + 15 };
    const i = MINI_BUTTONS.indexOf(what);
    return { x: this.L.mini.x + 4 + i * 21 + 10, y: this.L.mini.y + 3 + 10 };
  }

  click(x: number, y: number, st: HudState, button = 0): HudAction | null {
    const br = this.beltRowsHit(x, y, st);
    if (br) return br;
    // 스킬 고르기 목록이 열려 있으면 먼저
    if (this.skillMenu) {
      const hand = this.skillMenu;
      const hit = this.menuRects.find((m) => inRect(m.r, x, y));
      this.skillMenu = null;
      if (hit) return { kind: 'setSkill', hand, id: hit.id, ...(hit.charge ? { charge: true } : {}) };
      if (inRect({ ...this.L.lskill, w: 48, h: 48 }, x, y) || inRect({ ...this.L.rskill, w: 48, h: 48 }, x, y)) return { kind: 'panel' };
    }
    if (this.miniOpen && inRect(this.L.mini, x, y)) {
      const i = Math.floor((x - this.L.mini.x - 4) / 21);
      const b = MINI_BUTTONS[i];
      return b ? { kind: 'mini', button: b } : { kind: 'panel' };
    }
    if (st.ch.statPoints > 0 && inRect({ ...this.L.newStats, w: 30, h: 30 }, x, y)) return { kind: 'newStats' };
    if (st.ch.skillPoints > 0 && inRect({ ...this.L.newSkill, w: 30, h: 30 }, x, y)) return { kind: 'newSkill' };
    if (y < this.L.f1.y && !inRect({ x: 0, y: this.L.f0.y, w: 117, h: 104 }, x, y) && !inRect({ x: this.L.f4.x, y: this.L.f4.y, w: 117, h: 104 }, x, y)) return null;
    // 구체 받침의 투명한 윗부분(구체 바깥)은 월드 클릭으로 통과
    if (y < this.L.f1.y) {
      const g = x < 400 ? this.L.lifeGlobe : this.L.manaGlobe;
      const dx = x - (g.x + 40), dy = y - (g.y + 40);
      if (dx * dx + dy * dy > 42 * 42 && y < this.L.f0.y + 57) return null;
    }
    if (inRect({ ...this.L.lskill, w: 48, h: 48 }, x, y)) return { kind: 'skillMenu', hand: 'left' };
    if (inRect({ ...this.L.rskill, w: 48, h: 48 }, x, y)) return { kind: 'skillMenu', hand: 'right' };
    if (inRect(this.L.run, x, y)) return { kind: 'run' };
    if (inRect(this.L.menuBtn, x, y)) return { kind: 'minipanel' };
    for (let i = 0; i < 4; i++) if (inRect({ x: this.L.belt.xs[i] ?? 0, y: this.L.belt.y, w: this.L.belt.w, h: this.L.belt.h }, x, y)) return { kind: 'belt', slot: i };
    void button;
    return { kind: 'panel' };
  }

  /** 펼친 벨트 줄 칸 (줄 1 부터, 화면 좌표) */
  beltCell(slot: number): Rect {
    const row = Math.floor(slot / 4), col = slot % 4;
    return { x: this.L.belt.xs[col] ?? 0, y: this.L.belt.y - row * 32, w: this.L.belt.w, h: this.L.belt.h };
  }

  /** 펼친 벨트 윗줄 클릭 (패널보다 먼저) */
  private beltRowsHit(x: number, y: number, st: HudState): HudAction | null {
    if (!this.beltOpen) return null;
    const cap = st.store.beltCapacity();
    for (let i = 4; i < cap; i++) if (inRect(this.beltCell(i), x, y)) return { kind: 'belt', slot: i };
    const top = this.beltCell(cap - 1);
    // 펼친 틀 안의 빈 곳도 패널 (월드로 가지 않음)
    if (cap > 4 && inRect({ x: this.L.belt.xs[0] - 3, y: top.y - 3, w: this.L.belt.xs[3] + this.L.belt.w - this.L.belt.xs[0] + 6, h: this.L.belt.y - top.y }, x, y)) return { kind: 'panel' };
    return null;
  }

  /** 벨트 칸 번호 (마우스 아래) */
  beltAt(x: number, y: number): number | null {
    for (let i = 0; i < 4; i++) if (inRect({ x: this.L.belt.xs[i] ?? 0, y: this.L.belt.y, w: this.L.belt.w, h: this.L.belt.h }, x, y)) return i;
    return null;
  }

  /** 구체 그림을 아래에서부터 from~to 높이(0~1) 구간만 (원작: 비율만큼 아래부터 보인다) */
  private globe(ctx: CanvasRenderingContext2D, frame: number, x: number, y: number, from: number, to: number, alpha = 1): void {
    const f = this.art.frame(GLOBE, frame);
    if (!f) return;
    const lo = Math.round(80 * Math.max(0, Math.min(1, from))), hi = Math.round(80 * Math.max(0, Math.min(1, to)));
    if (hi <= lo) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(f.img as CanvasImageSource, 0, 80 - hi, 80, hi - lo, x, y + 80 - hi, 80, hi - lo);
    ctx.globalAlpha = 1;
  }

  /**
   * 빈 구슬 유리: 원작 프레임 3 은 보라 유리라, 회색으로 바꾸고 어둡게(× 0.55), 불투명도 80 %.
   * 근사(원작 미확인): 사용자 요청 — 빈 부분이 보라로 보이지 않고, 뒤 화면이 살짝 비치되 찬 부분과 구분되게
   */
  private glass(): Drawable | null {
    if (this.glassImg) return this.glassImg;
    const f = this.art.frame(GLOBE, 3);
    if (!f) return null;
    const c = makeCanvas(f.w, f.h);
    const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!g) return null;
    g.drawImage(f.img as CanvasImageSource, 0, 0);
    const img = g.getImageData(0, 0, f.w, f.h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const v = Math.round((0.3 * d[i]! + 0.59 * d[i + 1]! + 0.11 * d[i + 2]!) * 0.55);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 205;
    }
    g.putImageData(img, 0, 0);
    this.glassImg = c;
    return c;
  }

  draw(ctx: CanvasRenderingContext2D, st: HudState): void {
    const a = this.art, p = st.snap.player, ch = st.ch;
    // 패널 조각
    if (this.lod) {
      a.draw(ctx, CTRL800, 0, this.L.f0.x, this.L.f0.y);
      a.draw(ctx, CTRL800, 1, this.L.f1.x, this.L.f1.y);
      a.draw(ctx, CTRL800, 2, this.L.f2.x, this.L.f2.y);
      a.draw(ctx, CTRL800, 3, this.L.f3.x, this.L.f3.y);
      a.draw(ctx, CTRL800, 4, this.L.f3x.x, this.L.f3x.y);
      a.draw(ctx, CTRL800, 5, this.L.f4.x, this.L.f4.y);
    } else {
      a.draw(ctx, CTRL, 0, this.L.f0.x, this.L.f0.y);
      a.draw(ctx, CTRL, 1, this.L.f1.x, this.L.f1.y);
      a.draw(ctx, CTRL, 2, this.L.f2.x, this.L.f2.y);
      a.draw(ctx, CTRL, 3, this.L.f3.x, this.L.f3.y);
      const f2 = a.frame(CTRL, 2), f3 = a.frame(CTRL, 3);
      if (f2 && f3) drawPlate(ctx, f2.img as CanvasImageSource, f3.img as CanvasImageSource);
      a.draw(ctx, CTRL, 4, this.L.f4.x, this.L.f4.y);
    }
    // 생명·마나 구체 (독에 걸리면 초록 구체 — hlthmana 프레임 2)
    const poisoned = p.states.includes('poison');
    const glass = this.glass();
    if (glass) {
      ctx.drawImage(glass as CanvasImageSource, this.L.lifeGlobe.x, this.L.lifeGlobe.y);
      ctx.drawImage(glass as CanvasImageSource, this.L.manaGlobe.x, this.L.manaGlobe.y);
    }
    // 물약으로 찰 구간: 지금 높이 위에 같은 구체를 반투명으로 (근사(원작 미확인): 사용자 요청)
    const lf = p.maxLife ? p.life / p.maxLife : 0, mf = p.maxMana ? p.mana / p.maxMana : 0;
    const lifeFrame = poisoned ? 2 : 0;
    if (p.maxLife && p.lifePot > 0) this.globe(ctx, lifeFrame, this.L.lifeGlobe.x, this.L.lifeGlobe.y, lf, lf + p.lifePot / p.maxLife, 0.45);
    if (p.maxMana && p.manaPot > 0) this.globe(ctx, 1, this.L.manaGlobe.x, this.L.manaGlobe.y, mf, mf + p.manaPot / p.maxMana, 0.45);
    this.globe(ctx, lifeFrame, this.L.lifeGlobe.x, this.L.lifeGlobe.y, 0, lf);
    this.globe(ctx, 1, this.L.manaGlobe.x, this.L.manaGlobe.y, 0, mf);
    a.draw(ctx, OVERLAP, 0, this.L.lifeGlobe.x - 1, this.L.lifeGlobe.y);
    a.draw(ctx, OVERLAP, 1, this.L.manaGlobe.x, this.L.manaGlobe.y);
    // 경험치 막대: 이번 레벨 구간 진행률
    const lo = st.exp && p.level > 1 ? st.exp.threshold(p.level - 1) : 0;
    const hi = st.exp ? st.exp.threshold(p.level) : 1;
    const frac = Number.isFinite(hi) && hi > lo ? (p.experience - lo) / (hi - lo) : 1;
    ctx.fillStyle = '#c7b377';
    ctx.fillRect(this.L.exp.x, this.L.exp.y, Math.round(this.L.exp.w * Math.max(0, Math.min(1, frac))), this.L.exp.h);
    // 스태미나 막대 (원작: 노란 막대, 줄어들면 짧아짐 — 색 근사). 값 = 엔진 스냅숏 (아이템·버프 포함)
    // 출처: states.txt stambarblue — 스태미나 물약(staminapot)·신전(shrine_stamina) 상태면 파란 막대
    const sfrac = p.maxStamina ? p.stamina / p.maxStamina : 0;
    const blue = p.states.includes('staminapot') || p.states.includes('shrine_stamina');
    ctx.fillStyle = blue ? '#2848c8' : sfrac < 0.25 ? '#a02010' : '#b08a20';
    ctx.fillRect(this.L.stamina.x, this.L.stamina.y + 3, Math.round(this.L.stamina.w * Math.max(0, Math.min(1, sfrac))), this.L.stamina.h - 6);
    // 달리기/걷기 버튼 (프레임 0/1 걷기, 2/3 달리기)
    // 근사(원작 미확인): 스태미나가 바닥나 걷는 동안(스냅숏 running = false)은 걷기 모양
    a.draw(ctx, RUN, st.run && (p.running || p.stamina >= 1) ? 2 : 0, this.L.run.x, this.L.run.y);
    // 미니 패널 버튼 (0 닫힘, 2 열림)
    a.draw(ctx, MENUBTN, this.miniOpen ? 2 : 0, this.L.menuBtn.x, this.L.menuBtn.y);
    // 스킬 버튼
    const unusable = (id: number, charge?: boolean) => !!st.usable && !st.usable(id, charge);
    this.skillIcon(ctx, ch.leftSkill, this.L.lskill.x, this.L.lskill.y, this.skillMenu === 'left', unusable(ch.leftSkill, ch.chargeSkills?.[ch.leftSkill] !== undefined));
    this.skillIcon(ctx, ch.rightSkill, this.L.rskill.x, this.L.rskill.y, this.skillMenu === 'right', unusable(ch.rightSkill, ch.chargeSkills?.[ch.rightSkill] !== undefined));
    // 벨트 아래 줄 4칸
    for (let i = 0; i < 4; i++) {
      const it = st.store.belt[i];
      const img = it ? this.icons.get(it) : null;
      const bx = this.L.belt.xs[i] ?? 0;
      if (img) ctx.drawImage(img as CanvasImageSource, Math.round(bx + this.L.belt.w / 2 - img.width / 2), Math.round(this.L.belt.y + this.L.belt.h / 2 - img.height / 2));
    }
    // 펼친 벨트 (윗줄들)
    const cap = st.store.beltCapacity();
    if (this.beltOpen && cap > 4) {
      const top = this.beltCell(cap - 1);
      const bx = (this.L.belt.xs[0] ?? 0) - 3, bw = (this.L.belt.xs[3] ?? 0) + this.L.belt.w - (this.L.belt.xs[0] ?? 0) + 6;
      ctx.fillStyle = 'rgba(8,8,8,0.9)';
      ctx.fillRect(bx, top.y - 3, bw, this.L.belt.y - top.y);
      ctx.strokeStyle = '#6b5a36';
      ctx.strokeRect(bx + 0.5, top.y - 2.5, bw - 1, this.L.belt.y - top.y - 1);
      for (let i = 4; i < cap; i++) {
        const r = this.beltCell(i);
        ctx.strokeStyle = '#3a3222';
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        const it = st.store.belt[i];
        const img = it ? this.icons.get(it) : null;
        if (img) ctx.drawImage(img as CanvasImageSource, Math.round(r.x + r.w / 2 - img.width / 2), Math.round(r.y + r.h / 2 - img.height / 2));
      }
    }
    // 레벨 업 버튼
    if (ch.statPoints > 0) {
      a.draw(ctx, LEVEL, 0, this.L.newStats.x, this.L.newStats.y);
      drawText(ctx, st.str('strlvlup'), this.L.newStats.x + 15, this.L.newStats.y - 16, { align: 'center' });
    }
    if (ch.skillPoints > 0) {
      a.draw(ctx, LEVEL, 0, this.L.newSkill.x, this.L.newSkill.y);
      drawText(ctx, st.str('strnewskl'), this.L.newSkill.x + 15, this.L.newSkill.y - 16, { align: 'center' });
    }
    // 미니 패널
    if (this.miniOpen) {
      a.draw(ctx, MINI, 0, this.L.mini.x, this.L.mini.y);
      MINI_BUTTONS.forEach((_, i) => a.draw(ctx, MINIBTN, i * 2, this.L.mini.x + 4 + i * 21, this.L.mini.y + 3));
    }
    // 스킬 고르기 목록
    this.layoutMenu(st);
    for (const m of this.menuRects) {
      this.skillIcon(ctx, m.id, m.r.x, m.r.y, false, !!st.usable && !st.usable(m.id, m.charge));
      // 충전 수 (근사(원작 미확인): 위치 = 아이콘 왼쪽 아래, 글꼴 font16)
      if (m.charge) drawText(ctx, `${m.cur ?? 0}`, m.r.x + 3, m.r.y + 30, { font: 'font16', color: 'white' });
      // 등록된 단축키 이름 (근사(원작 미확인): 위치 = 아이콘 오른쪽 아래, 글꼴 font16)
      const slot = st.ch.hotkeys?.findIndex((h) => h?.skill === m.id && h.hand === this.skillMenu && !!h.charge === !!m.charge) ?? -1;
      const label = slot >= 0 ? st.hotkeyLabel?.(slot) : undefined;
      if (label) drawText(ctx, label, m.r.x + 46, m.r.y + 30, { font: 'font16', align: 'right', color: 'white' });
    }
    this.hover(ctx, st);
    if (st.dead) {
      // 근사(원작 미확인): 원작 사망 문구 위치·글꼴
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, 800, 600);
      drawText(ctx, 'You have died', 400, 230, { font: 'font42', align: 'center', color: 'red' });
      drawText(ctx, 'Press ESC to continue', 400, 290, { font: 'font16', align: 'center' });
    }
  }

  /** 마우스를 올리면 원작 설명 글자 (구체 수치·스태미나·경험치·버튼 이름) */
  private hover(ctx: CanvasRenderingContext2D, st: HudState): void {
    const m = st.mouse;
    if (!m) return;
    const p = st.snap.player, ch = st.ch;
    let text: string | null = null;
    const near = (g: { x: number; y: number }) => (m.x - g.x - 40) ** 2 + (m.y - g.y - 40) ** 2 < 40 * 40;
    if (near(this.L.lifeGlobe)) text = fmt(st.str('panelhealth'), Math.floor(p.life), Math.floor(p.maxLife));
    else if (near(this.L.manaGlobe)) text = fmt(st.str('panelmana'), Math.floor(p.mana), Math.floor(p.maxMana));
    else if (inRect(this.L.stamina, m.x, m.y)) text = fmt(st.str('panelstamina'), Math.floor(p.stamina), Math.floor(p.maxStamina));
    else if (inRect({ x: this.L.exp.x, y: this.L.exp.y - 3, w: this.L.exp.w, h: 9 }, m.x, m.y)) text = fmt(st.str('panelexp'), p.experience, st.exp ? st.exp.threshold(p.level) : 0);
    else if (inRect(this.L.run, m.x, m.y)) text = st.str(st.run ? 'RunOff' : 'RunOn');
    else if (this.miniOpen && inRect(this.L.mini, m.x, m.y)) {
      const b = MINI_BUTTONS[Math.floor((m.x - this.L.mini.x - 4) / 21)];
      if (b) text = st.str(MINI_STR[b]);
    } else {
      const hit = this.menuRects.find((q) => inRect(q.r, m.x, m.y));
      const id = hit?.id ?? (inRect({ ...this.L.lskill, w: 48, h: 48 }, m.x, m.y) ? ch.leftSkill : inRect({ ...this.L.rskill, w: 48, h: 48 }, m.x, m.y) ? ch.rightSkill : null);
      if (id !== null) text = this.skills?.byId.get(id)?.displayName ?? null;
      // 충전 스킬: 이름 뒤에 (현재/최대 Charges) — 원작 string.tbl ModStre10d
      if (text && hit?.charge) text = `${text} ${fmt(st.str('ModStre10d'), hit.cur ?? 0, hit.max ?? 0)}`;
    }
    if (!text) return;
    const w = d2text.width(text) + 8, h = d2text.lineHeight() + 2;
    const x = Math.max(2, Math.min(798 - w, m.x - w / 2)), y = Math.max(2, m.y - h - 16);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x, y, w, h);
    drawText(ctx, text, x + w / 2, y + 1, { align: 'center' });
  }
}

/** 벨트 오른쪽 돌 판 (위 머리말 근사 참고): 조각3 돌 줄을 좌우 번갈아 뒤집어 이어 깔아 반복 무늬를 줄이고, 가운데에 조각2 장식 */
function drawPlate(ctx: CanvasRenderingContext2D, f2: CanvasImageSource, f3: CanvasImageSource): void {
  const { x, y, w } = HUD.plate;
  const SX = 46, SW = 6, H = 55;
  for (let i = 0, dx = 0; dx < w; i++, dx += SW) {
    const cw = Math.min(SW, w - dx);
    if (i % 2) {
      ctx.save();
      ctx.translate(x + dx + cw, y);
      ctx.scale(-1, 1);
      ctx.drawImage(f3, SX, 0, cw, H, 0, 0, cw, H);
      ctx.restore();
    } else ctx.drawImage(f3, SX, 0, cw, H, x + dx, y, cw, H);
  }
  const OX = 5, OW = 43;
  ctx.drawImage(f2, OX, 0, OW, H, x + Math.round((w - OW) / 2), y, OW, H);
}
