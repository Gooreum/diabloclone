// 프런트엔드 (캔버스, 원작 DC6): 타이틀 → 캐릭터 선택 → 캐릭터 만들기. 투명 DOM 단추(#btn-single 등)가 그림 위에 겹친다.
// 출처(그림): data\global\ui\FrontEnd\TitleScreen.dc6 (800×600 12조각, 팔레트 Sky), D2logoBlackLeft/Right + D2logoFireLeft/Right (30프레임, 기준점 400,120),
//   WideButtonBlank.dc6 (272×35: 프레임 0·1 보통, 2·3 눌림), MediumButtonBlank.dc6 (128×35), CharSelect\charselectbckg.dc6 (Sky), charselectbox.dc6 (272×93),
//   CharacterCreate.dc6 (팔레트 fechar), fire.dc6 (모닥불 30프레임), <클래스>\<xx>NU1 (서 있기), NU2 (마우스를 올림), FW (앞으로 나옴), NU3 (나와 서 있기), BW (돌아감),
//   *s.dc6 (빛 효과 겹침), textbox.dc6 (이름 칸 169×26), 글꼴 fontexocet10 (단추) · font30 (제목) · font16 (설명)
// 출처(배치): OpenDiablo2 main_menu.go (로고 400,120 · 단추 x 264, y 290/330/370/500), character_select.go (칸 37+272·열, 86+95·행 · 단추 33,468 / 433,468 / 33,537 / 627,537),
//   select_hero_class.go (모닥불 380,335 · 아마존 100,339 · 네크로맨서 300,335 · 바바리안 400,330 · 팔라딘 521,338 · 소서리스 626,352 · 이름 칸 318,493 · 제목 400,17 · 클래스 이름 400,65)
// 캐릭터 선택 칸의 영웅 그림 = 게임 속 모습 (클래스 COF + 장착 외형, 서 있기 NU, 앞을 봄 — main 이 heroFigure 로 그린다)
// 8명 넘으면 스크롤: 오른쪽 스크롤 막대 data\global\ui\PANEL\scrollbar.dc6 (10×10: 0 위, 1 아래, 2·3 눌림, 4 손잡이, 5 바탕 — 원작 그림 확인),
//   출처(배치): OpenDiablo2 character_select.go 스크롤 막대 (586, 87, 높이 369), 한 번에 한 줄(2명)
// 지우기 확인: CharSelect\PopUpOkCancel.dc6 (264×176, 단추 자리 y 133~164 — 원작 그림 측정) + FrontEnd\CancelButtonBlank.dc6 (96×32)
// 난이도 창 (Phase 8): 원작 클래식 — 캐릭터를 고르고 OK 했을 때 Nightmare 가 열린 캐릭터면 난이도 창 (Normal / Nightmare / Hell, 열리지 않은 난이도는 못 누름),
//   아니면 바로 Normal. 그림 FrontEnd\PopUp_340x224.dc6 (256 + 84 × 224 두 조각, 아래 128×32 단추 자리 x 108 y 182 — 원작 그림 측정) + WideButtonBlank
//   근사(원작 미확인): 창 가운데 배치, 난이도 단추 y (창 위 33 부터 40 간격), 문구 NORMAL/NIGHTMARE/HELL/CANCEL (D2Launch 내장 문자열), 잠긴 단추는 어둡게
// 칭호 (Phase 8): 저장의 진행 값 → Sir/Dame·Lord/Lady·Baron/Baroness 를 이름 위 줄에 (근사(원작 미확인): 줄 위치)
// 근사(원작 미확인): 단추 문구·클래스 설명·지우기 확인 문구는 원작 D2Launch 내장 문자열(string.tbl 에 없음)을 기억에 따라 영어로, 애니메이션 속도 초당 25프레임,
//   영웅 그림 위치(칸 왼쪽 45, 아래 82), 확인 창 가운데 배치, Battle.net·Other Multiplayer 는 동작 없음
import type { HeroSummary } from '../engine/save';
import type { Difficulty } from '../engine/difficulty';
import { convertToExpansion, validHeroName } from '../engine/save';
import { ALL_CLASSES, CLASSIC_CLASSES, EXPANSION_CLASSES, isExpansionClass, type ClassName } from '../engine/player';
import type { Edition } from '../assets/edition';
import type { Lang } from '../data/lang';
import { UI, type UiArt } from './art';
import { HotLayer, type HRect } from './hotspot';
import { HeroStore } from './storage';
import { drawText, type TextColor } from './text';

export type MenuResult = { kind: 'new'; name: string; cls: ClassName; expansion?: boolean } | { kind: 'load'; name: string; difficulty: Difficulty };

const FE = `${UI}FrontEnd\\`;
const CS = `${UI}CharSelect\\`;
const FPS = 25;
const WIDE = `${FE}WideButtonBlank.dc6`, MED = `${FE}MediumButtonBlank.dc6`;
/** 타이틀 언어 단추 (Other Multiplayer 와 Exit 사이 빈 자리): 언어마다 Medium 단추 하나, 지금 언어는 눌린 모양·금색 글자 */
const LANG_Y = 450;
const LANG_NAME: Record<Lang, string> = { eng: 'ENGLISH', kor: '한국어' };
const langRect = (i: number): HRect => ({ x: 264 + i * 144, y: LANG_Y, w: 128, h: 35 });
/** 확장팩 캐릭터 체크 상자 그림 (15×16, 프레임 0 빈 칸 / 1 체크) — d2data FrontEnd */
const CLICKBOX = `${FE}clickbox.dc6`;
/** 확장팩 판본 배경 (d2exp): 만들기 화면 · 선택 화면 */
const CREATE_EXP = `${FE}charactercreationscreenEXP.dc6`, SELECT_EXP = `${CS}characterselectscreenEXP.dc6`;
/** 근사(원작 미확인): 체크 상자 위치 — 이름 칸(318,493) 아래, Exit·OK 단추 사이. 누르는 칸은 글자까지 */
const EXP_BOX: HRect = { x: 318, y: 541, w: 180, h: 16 };
const SCROLL = `${UI}PANEL\\scrollbar.dc6`, POPUP = `${CS}PopUpOkCancel.dc6`, SMALL = `${FE}CancelButtonBlank.dc6`;
const SB = { x: 586, y: 87, h: 369 } as const;
const POP = { x: 268, y: 212, w: 264, h: 176 } as const;
/** 원작 LoD 선택 화면 "Convert to Expansion" (클래식 영웅을 골랐을 때). 근사(원작 미확인): 위치 — Exit·OK 사이 가운데 */
const CONVERT_BTN = { x: 264, y: 537, w: 272, h: 35 } as const;
/** 근사(원작 미확인): 타이틀의 "Game Files" 단추 — 원작 Credits 자리(Other Multiplayer 아래). 이 클론 것 (배포판에서 원작 파일 다시 고르기) */
const FILES_BTN: HRect = { x: 264, y: 410, w: 272, h: 35 };
/** 확인 창 문구. 근사(원작 미확인): 바꾸기 문구 (원작 문구는 tbl 이 아니라 D2Launch.dll 안) */
const CONFIRM_TEXT = {
  delete: 'Are you sure that you want\nto delete this character?\nTake note: this will delete all\nversions of this Character.',
  convert: 'Are you sure that you want\nto convert this character\nto an Expansion Character?\nThis cannot be undone.',
} as const;
const DIFF_POPUP = `${FE}PopUp_340x224.dc6`;
/** 난이도 창 (800×600 가운데), 아래 단추 자리 (그림 안 x 108 y 182, 128×32) */
const DPOP = { x: 230, y: 188, w: 340, h: 224 } as const;
const DPOP_CANCEL = { x: DPOP.x + 108, y: DPOP.y + 182, w: 128, h: 32 } as const;
const DIFF_LABELS = ['Normal', 'Nightmare', 'Hell'] as const;
const diffRect = (d: number): HRect => ({ x: DPOP.x + 34, y: DPOP.y + 33 + d * 40, w: 272, h: 35 });
/** 캐릭터 선택 칸의 영웅 그림 (main: 저장된 장비로 COF 합성). 그렸으면 true */
export type HeroFigure = (ctx: CanvasRenderingContext2D, name: string, x: number, y: number, now: number) => boolean;

/** 클래스별 프런트엔드 애니메이션 (파일 접두·위치) */
const HERO: Record<ClassName, { dir: string; pre: string; x: number; y: number; desc: string }> = {
  Amazon: { dir: 'amazon', pre: 'AM', x: 100, y: 339, desc: 'Skilled with the spear and the bow, she is\na very versatile fighter.' },
  Necromancer: { dir: 'necromancer', pre: 'NE', x: 300, y: 335, desc: 'Summoning undead minions and cursing his\nenemies are his specialties.' },
  Barbarian: { dir: 'barbarian', pre: 'BA', x: 400, y: 330, desc: 'He is unequaled in close-quarters combat\nand mastery of weapons.' },
  Paladin: { dir: 'paladin', pre: 'PA', x: 521, y: 338, desc: 'He is a natural party leader, holy man,\nand blessed warrior.' },
  Sorceress: { dir: 'sorceress', pre: 'SO', x: 626, y: 352, desc: 'She has mastered the elemental magicks --\nfire, lightning, and ice.' },
  // 확장팩 직업 (d2exp FrontEnd\assassin·druid). 근사(원작 미확인): 위치는 OpenDiablo2 값
  Assassin: { dir: 'assassin', pre: 'AS', x: 231, y: 365, desc: 'Schooled in the Martial Arts, her\nmind and body are deadly weapons.' },
  Druid: { dir: 'druid', pre: 'DZ', x: 720, y: 370, desc: 'Commanding the forces of nature, he\nsummons wild beasts and raging storms.' },
};
type Anim = 'NU1' | 'NU2' | 'FW' | 'NU3' | 'BW';
const heroFile = (c: ClassName, a: Anim, overlay = false) => `${FE}${HERO[c].dir}\\${HERO[c].pre}${a}${overlay ? 's' : ''}.dc6`;

type Screen = 'title' | 'select' | 'create';

export class Menu {
  private readonly stage: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sky: UiArt;
  private readonly fechar: UiArt;
  private readonly layer: HotLayer;
  private readonly nameInput: HTMLInputElement;
  private screen: Screen = 'title';
  private raf = 0;
  private t0 = 0;
  private heroes: HeroSummary[] = [];
  private selectedHero = 0;
  /** 스크롤 (줄 단위, 한 줄 = 2명) */
  private scroll = 0;
  /** 선택 화면 확인 창 (지우기 / 확장팩으로 바꾸기) */
  private confirm: keyof typeof CONFIRM_TEXT | null = null;
  /** 난이도 창이 떠 있는 영웅 (없으면 null) */
  private diffHero: HeroSummary | null = null;
  /** 영웅 그림 (없으면 클래스 서 있기 그림으로 근사) */
  heroFigure: HeroFigure | null = null;
  /** 맨 위에 덧그리기 (원작 커서) */
  overlay: ((ctx: CanvasRenderingContext2D, mouse: { x: number; y: number } | null, now: number) => void) | null = null;
  private cls: ClassName | null = null;
  private hover: ClassName | null = null;
  private clsAnim: Partial<Record<ClassName, { anim: Anim; start: number }>> = {};
  private err = '';
  private mouse: { x: number; y: number } | null = null;
  private resolve: ((r: MenuResult) => void) | null = null;
  /** 원작 프런트엔드 소리 (sounds.txt 이름) — main 이 사운드 시스템에 연결 */
  onSound: ((name: string) => void) | null = null;
  private listHeroes: (() => Promise<HeroSummary[]>) | null = null;
  /**
   * 설치 판본 — 확장팩이면 만들기 화면에 "Expansion Character" 체크 (원작 LoD, 기본 켬).
   * 클래식 판본은 확장팩 캐릭터를 시작할 수 없다 (원작 클래식 설치와 같다)
   */
  edition: Edition = 'classic';
  /** 고를 수 있는 표시 언어 (둘 이상이면 타이틀에 언어 단추) · 지금 언어 · 다른 언어 단추를 누르면 (main 이 저장 후 다시 시작) */
  languages: Lang[] = ['eng'];
  lang: Lang = 'eng';
  onLanguage: ((l: Lang) => void) | null = null;
  /** 배포판: 원작 파일 다시 고르기 (main 이 고르기 화면을 띄우고 다시 시작). null 이면 단추 없음 (dev 서버) */
  onFiles: (() => void) | null = null;
  /** 만들기 화면 체크 상태 */
  private expansionChecked = true;
  /** 선택 화면 알림 (클래식 판본에서 확장팩 캐릭터를 골랐을 때) */
  private notice = '';

  constructor(stage: HTMLElement, ctx: CanvasRenderingContext2D, sky: UiArt, fechar: UiArt) {
    this.stage = stage;
    this.ctx = ctx;
    this.sky = sky;
    this.fechar = fechar;
    this.layer = new HotLayer(stage, 'menu', { x: 0, y: 0, w: 800, h: 600 });
    this.nameInput = document.createElement('input');
    this.nameInput.id = 'hero-name';
    this.nameInput.maxLength = 15;
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    // 글자는 캔버스에 원작 글꼴로 그리고 입력칸은 투명 (캐럿만 보임)
    Object.assign(this.nameInput.style, { position: 'absolute', left: '322px', top: '496px', width: '161px', height: '20px', background: 'transparent', border: '0', outline: 'none', color: 'transparent', caretColor: '#c7b377', font: '14px serif', display: 'none' });
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirmCreate();
    });
    this.layer.root.append(this.nameInput);
    this.layer.root.addEventListener('mousemove', (e) => {
      const r = this.stage.getBoundingClientRect();
      // 무대가 창 크기로 확대돼 있어도 800×600 좌표로
      this.mouse = { x: ((e.clientX - r.left) * 800) / r.width, y: ((e.clientY - r.top) * 600) / r.height };
    });
    this.layer.root.addEventListener('wheel', (e) => {
      if (this.screen !== 'select' || this.confirm) return;
      this.scrollBy(e.deltaY > 0 ? 1 : -1);
    });
    void sky.preload([CLICKBOX, SCROLL, POPUP, SMALL, DIFF_POPUP, `${FE}TitleScreen.dc6`, `${FE}D2logoBlackLeft.dc6`, `${FE}D2logoBlackRight.dc6`, `${FE}D2logoFireLeft.dc6`, `${FE}D2logoFireRight.dc6`, WIDE, MED, `${CS}charselectbckg.dc6`, `${CS}charselectbox.dc6`]);
    void fechar.preload([`${FE}CharacterCreate.dc6`, `${FE}fire.dc6`, `${FE}textbox.dc6`, ...CLASSIC_CLASSES.flatMap((c) => [heroFile(c, 'NU1'), heroFile(c, 'NU2'), heroFile(c, 'FW'), heroFile(c, 'NU3'), heroFile(c, 'BW')])]);
  }

  hide(): void {
    this.layer.visible = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resolve = null;
  }

  /** 모든 그림을 읽었는가 (e2e 스크린샷 전) */
  get ready(): boolean {
    return this.sky.ready([`${FE}TitleScreen.dc6`, `${CS}charselectbckg.dc6`, WIDE]) && this.fechar.ready([`${FE}CharacterCreate.dc6`, heroFile('Barbarian', 'NU1')]);
  }

  /** 메인메뉴 → 선택 결과 */
  run(listHeroes: () => Promise<HeroSummary[]>): Promise<MenuResult> {
    this.listHeroes = listHeroes;
    this.layer.visible = true;
    this.t0 = performance.now();
    this.go('title');
    const loop = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  private finish(r: MenuResult): void {
    const res = this.resolve;
    this.hide();
    res?.(r);
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.err = '';
    this.diffHero = null;
    this.layer.only(new Set(['__none']));
    this.nameInput.style.display = 'none';
    if (screen === 'title') {
      this.btn('single', { x: 264, y: 290, w: 272, h: 35 }, () => void this.openSelect(), 'btn-single', 'Single Player');
      this.btn('bnet', { x: 264, y: 330, w: 272, h: 35 }, () => undefined, 'btn-battlenet', 'Battle.net');
      this.btn('multi', { x: 264, y: 370, w: 272, h: 35 }, () => undefined, 'btn-multiplayer', 'Other Multiplayer');
      if (this.onFiles) this.btn('files', FILES_BTN, () => this.onFiles?.(), 'btn-files', 'Game Files');
      // 근사(원작 미확인): 원작은 설치 언어가 고정 — 언어 단추·위치는 이 클론 것
      if (this.languages.length > 1)
        this.languages.forEach((l, i) => this.btn(`lang:${l}`, langRect(i), () => {
          if (l !== this.lang) this.onLanguage?.(l);
        }, `btn-lang-${l}`, LANG_NAME[l]));
      this.btn('exit', { x: 264, y: 500, w: 272, h: 35 }, () => undefined, 'btn-exit-d2', 'Exit Diablo II');
    } else if (screen === 'select') {
      this.confirm = null;
      this.layoutHeroes();
      this.btn('sbup', { x: SB.x, y: SB.y, w: 10, h: 10 }, () => this.scrollBy(-1), 'charsel-up', 'Up');
      this.btn('sbdown', { x: SB.x, y: SB.y + SB.h - 10, w: 10, h: 10 }, () => this.scrollBy(1), 'charsel-down', 'Down');
      this.btn('create', { x: 33, y: 468, w: 272, h: 35 }, () => this.go('create'), 'btn-create', 'Create New Character');
      this.btn('delete', { x: 433, y: 468, w: 272, h: 35 }, () => this.askConfirm('delete'), 'btn-delete', 'Delete Character');
      if (this.edition === 'lod') this.btn('convert', CONVERT_BTN, () => this.askConfirm('convert'), 'btn-convert', 'Convert to Expansion');
      this.btn('selexit', { x: 33, y: 537, w: 128, h: 35 }, () => this.go('title'), 'btn-select-exit', 'Exit');
      this.btn('selok', { x: 627, y: 537, w: 128, h: 35 }, () => {
        const h = this.heroes[this.selectedHero];
        if (h) this.startHero(h);
      }, 'btn-select-ok', 'OK');
    } else {
      this.cls = null;
      this.clsAnim = {};
      this.nameInput.value = '';
      // 확장팩 판본: 7직업 (원작 LoD 만들기 화면)
      if (this.edition === 'lod') void this.fechar.preload([CREATE_EXP, ...EXPANSION_CLASSES.flatMap((c) => [heroFile(c, 'NU1'), heroFile(c, 'NU2'), heroFile(c, 'FW'), heroFile(c, 'NU3'), heroFile(c, 'BW')])]);
      for (const c of this.classes()) this.btn(`cls:${c}`, this.heroBox(c), () => this.pickClass(c), `btn-${c.toLowerCase()}`, c, (el) => {
        el.addEventListener('mouseenter', () => (this.hover = c));
        el.addEventListener('mouseleave', () => this.hover === c && (this.hover = null));
      });
      this.expansionChecked = true;
      // 확장팩 직업을 고르면 체크는 켜진 채 바꿀 수 없다 (원작 LoD — 확장팩 직업은 확장팩 캐릭터만)
      if (this.edition === 'lod') this.btn('chkexp', EXP_BOX, () => {
        if (!(this.cls && isExpansionClass(this.cls))) this.expansionChecked = !this.expansionChecked;
      }, 'chk-expansion', 'Expansion Character', (el) => el.setAttribute('role', 'checkbox'));
      else this.layer.remove('chkexp');
      this.btn('cexit', { x: 33, y: 537, w: 128, h: 35 }, () => void this.openSelect(), 'btn-create-exit', 'Exit');
      this.btn('cok', { x: 627, y: 537, w: 128, h: 35 }, () => this.confirmCreate(), 'btn-ok', 'OK');
    }
  }

  private btn(key: string, r: HRect, onClick: (e: MouseEvent) => void, id: string, label: string, setup?: (el: HTMLElement) => void): void {
    const known = !!document.getElementById(id);
    const el = this.layer.button(key, r, onClick, { id }, label);
    if (!known) setup?.(el);
  }

  private async openSelect(): Promise<void> {
    if (this.edition === 'lod') void this.sky.preload([SELECT_EXP]);
    // 이전 영웅 단추 정리 (이름이 바뀌거나 지워졌을 수 있다)
    for (const h of this.heroes) this.layer.remove(`hero:${h.name}`);
    this.heroes = this.listHeroes ? await this.listHeroes() : [];
    this.selectedHero = 0;
    this.scroll = 0;
    this.go('select');
  }

  /** 영웅 칸 단추: 보이는 8칸만 (스크롤) */
  private layoutHeroes(): void {
    const first = this.scroll * 2;
    this.heroes.forEach((h, i) => {
      const k = `hero:${h.name}`;
      const vis = i >= first && i < first + 8;
      const el = this.layer.button(k, this.heroRect(i - first), (e) => {
        const idx = this.heroes.findIndex((x) => x.name === h.name);
        this.selectedHero = idx;
        if (e.detail >= 2 && !this.diffHero) {
          const cur = this.heroes[idx];
          if (cur) this.startHero(cur);
        }
      }, { id: `hero-${h.name}` }, h.name);
      if (!vis) el.style.display = 'none';
    });
  }

  private maxScroll(): number {
    return Math.max(0, Math.ceil(this.heroes.length / 2) - 4);
  }

  scrollBy(d: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll + d));
    this.layoutHeroes();
  }

  /** e2e: 스크롤 줄 */
  get scrollRow(): number {
    return this.scroll;
  }

  /** 영웅으로 게임 시작: Nightmare 가 열렸으면 난이도 창, 아니면 바로 Normal (원작 클래식 싱글플레이) */
  private startHero(h: HeroSummary): void {
    if (this.diffHero) return;
    // 근사(원작 미확인 — 원작 클래식 설치는 확장팩 캐릭터를 목록에서 흐리게 보여 준다고 알려짐): 시작하지 않고 알린다
    if (h.expansion && this.edition !== 'lod') {
      this.notice = 'Expansion Character: Lord of Destruction required';
      return;
    }
    this.notice = '';
    if (!h.difficultyUnlocked) {
      this.finish({ kind: 'load', name: h.name, difficulty: 0 });
      return;
    }
    this.diffHero = h;
    const keys = new Set<string>(['diffcancel']);
    DIFF_LABELS.forEach((label, d) => {
      keys.add(`diff${d}`);
      this.btn(`diff${d}`, diffRect(d), () => this.pickDifficulty(d as Difficulty), `btn-diff-${label.toLowerCase()}`, label);
      const el = document.getElementById(`btn-diff-${label.toLowerCase()}`);
      if (el) (el as HTMLButtonElement).disabled = d > h.difficultyUnlocked;
    });
    this.btn('diffcancel', DPOP_CANCEL, () => this.closeDifficulty(), 'btn-diff-cancel', 'Cancel');
    // 창이 떠 있는 동안 다른 단추는 막는다
    this.layer.only(keys);
  }

  private pickDifficulty(d: Difficulty): void {
    const h = this.diffHero;
    if (!h || d > h.difficultyUnlocked) return;
    this.diffHero = null;
    this.finish({ kind: 'load', name: h.name, difficulty: d });
  }

  private closeDifficulty(): void {
    this.diffHero = null;
    this.go('select');
  }

  /** e2e: 난이도 창이 떠 있는가 */
  get difficultyOpen(): boolean {
    return !!this.diffHero;
  }

  /** 확인 창 (원작: 정말 지울지 · 확장팩으로 바꿀지 묻는다). 이미 확장팩인 영웅은 바꾸지 않는다 */
  private askConfirm(kind: keyof typeof CONFIRM_TEXT): void {
    const h = this.heroes[this.selectedHero];
    if (!h || (kind === 'convert' && h.expansion)) return;
    this.confirm = kind;
    const yes = kind === 'delete' ? () => void this.deleteHero() : () => void this.convertHero();
    this.btn('cfyes', { x: POP.x + 10, y: POP.y + 133, w: 96, h: 32 }, yes, `btn-${kind}-yes`, 'Yes');
    this.btn('cfno', { x: POP.x + 163, y: POP.y + 133, w: 96, h: 32 }, () => this.closeConfirm(), `btn-${kind}-no`, 'No');
    // 확인 창이 떠 있는 동안 다른 단추는 막는다
    this.layer.only(new Set(['cfyes', 'cfno']));
  }

  private closeConfirm(): void {
    this.go('select');
  }

  private async deleteHero(): Promise<void> {
    const h = this.heroes[this.selectedHero];
    this.confirm = null;
    if (!h) return;
    await HeroStore.remove(h.name);
    await this.openSelect();
  }

  /** 원작 LoD "Convert to Expansion": 저장을 확장팩 캐릭터로 바꿔 다시 저장 (되돌릴 수 없음) */
  private async convertHero(): Promise<void> {
    const h = this.heroes[this.selectedHero];
    this.confirm = null;
    const s = h ? await HeroStore.load(h.name) : null;
    if (s) await HeroStore.save(convertToExpansion(s));
    await this.openSelect();
  }

  private heroRect(i: number): HRect {
    return { x: 37 + (i % 2) * 272, y: 86 + Math.floor(i / 2) * 95, w: 272, h: 93 };
  }

  /** 클래스 그림이 차지하는 칸 (서 있기 첫 프레임 기준) */
  /** 만들기 화면 직업 (확장팩 판본은 드루이드·어쌔신 포함) */
  private classes(): readonly ClassName[] {
    return this.edition === 'lod' ? ALL_CLASSES : CLASSIC_CLASSES;
  }

  private heroBox(c: ClassName): HRect {
    const h = HERO[c];
    const f = this.fechar.frame(heroFile(c, 'NU1'), 0);
    if (!f) return { x: h.x - 45, y: h.y - 140, w: 90, h: 150 };
    return { x: h.x + f.ox, y: h.y + f.oy - f.h, w: f.w, h: f.h };
  }

  private pickClass(c: ClassName): void {
    const now = performance.now();
    if (this.cls === c) return;
    if (this.cls) {
      this.clsAnim[this.cls] = { anim: 'BW', start: now };
      this.onSound?.(`cursor_${this.cls.toLowerCase()}_deselect`);
    }
    this.onSound?.(`cursor_${c.toLowerCase()}_select`);
    this.cls = c;
    if (isExpansionClass(c)) this.expansionChecked = true;
    this.clsAnim[c] = { anim: 'FW', start: now };
    this.nameInput.style.display = 'block';
    this.nameInput.focus();
  }

  private confirmCreate(): void {
    if (!this.cls) return;
    const name = this.nameInput.value;
    if (!validHeroName(name)) {
      // 근사: 원작은 이름 규칙에 맞지 않으면 OK 단추가 눌리지 않는다
      this.err = 'Invalid character name';
      return;
    }
    this.finish({ kind: 'new', name, cls: this.cls, expansion: this.edition === 'lod' && (this.expansionChecked || isExpansionClass(this.cls)) });
  }

  // ---------------------------------------------------------------- 그리기

  /** pressed = 눌린 모양 (원작 단추 그림 다음 프레임: Wide 는 2칸 다음, Medium 은 1) — 고른 언어 표시에 쓴다 */
  private button(art: UiArt, path: string, r: HRect, label: string, font: 'fontexocet10' = 'fontexocet10', pressed = false, color: TextColor = 'black'): void {
    art.drawTiles(this.ctx, path, path === WIDE ? 2 : 1, r.x, r.y, pressed ? (path === WIDE ? 2 : 1) : 0, path === WIDE ? 2 : 1);
    drawText(this.ctx, label.toUpperCase(), r.x + r.w / 2, r.y + 10, { font, align: 'center', color });
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 800, 600);
    const fr = Math.floor(((now - this.t0) * FPS) / 1000);
    if (this.screen === 'title') {
      const a = this.sky;
      a.drawScreen(ctx, `${FE}TitleScreen.dc6`);
      a.drawAnchored(ctx, `${FE}D2logoBlackLeft.dc6`, fr % 30, 400, 120);
      a.drawAnchored(ctx, `${FE}D2logoBlackRight.dc6`, fr % 30, 400, 120);
      // 불꽃 로고는 밝게 더하기 (원작 DrawMode 가산 혼합 — 근사: 캔버스 lighter)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      a.drawAnchored(ctx, `${FE}D2logoFireLeft.dc6`, fr % 30, 400, 120);
      a.drawAnchored(ctx, `${FE}D2logoFireRight.dc6`, fr % 30, 400, 120);
      ctx.restore();
      this.button(a, WIDE, { x: 264, y: 290, w: 272, h: 35 }, 'Single Player');
      this.button(a, WIDE, { x: 264, y: 330, w: 272, h: 35 }, 'Battle.net');
      this.button(a, WIDE, { x: 264, y: 370, w: 272, h: 35 }, 'Other Multiplayer');
      if (this.onFiles) this.button(a, WIDE, FILES_BTN, 'Game Files');
      if (this.languages.length > 1) {
        // 라벨은 언어 단추 줄 왼쪽 (위는 Game Files 단추 자리)
        drawText(ctx, 'LANGUAGE / 언어', 256, LANG_Y + 10, { font: 'font16', align: 'right', color: 'gold' });
        // 고른 언어: 눌린 모양 + 금색 테두리, 다른 언어: 어둡게
        this.languages.forEach((l, i) => {
          const r = langRect(i), on = l === this.lang;
          this.button(a, MED, r, LANG_NAME[l], 'fontexocet10', on);
          ctx.save();
          if (on) {
            ctx.strokeStyle = '#e8c860';
            ctx.lineWidth = 2;
            ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
          } else {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(r.x, r.y, r.w, r.h);
          }
          ctx.restore();
        });
      }
      this.button(a, WIDE, { x: 264, y: 500, w: 272, h: 35 }, 'Exit Diablo II');
      drawText(ctx, 'v 1.14d', 20, 575, { font: 'font8', color: 'white' });
    } else if (this.screen === 'select') {
      const a = this.sky;
      a.drawScreen(ctx, this.edition === 'lod' && a.frames(SELECT_EXP)?.length ? SELECT_EXP : `${CS}charselectbckg.dc6`);
      const sel = this.heroes[this.selectedHero];
      if (sel) drawText(ctx, sel.name, 400, 20, { font: 'font42', align: 'center' });
      const first = this.scroll * 2;
      this.heroes.slice(first, first + 8).forEach((h, j) => {
        const i = first + j;
        const r = this.heroRect(j);
        if (i === this.selectedHero) a.drawTiles(ctx, `${CS}charselectbox.dc6`, 2, r.x, r.y, 0, 2);
        // 영웅 그림: 게임 속 모습 (없으면 근사: 클래스 프런트엔드 서 있기 그림을 줄여서)
        if (!this.heroFigure?.(ctx, h.name, r.x + 45, r.y + 82, now)) this.frontFigure(h.cls, r.x + 45, r.y + 82, fr);
        if (h.title) drawText(ctx, h.title, r.x + 100, r.y + 4, { font: 'font16', color: 'gold' });
        drawText(ctx, h.name, r.x + 100, r.y + 20, { font: 'font16', color: 'gold' });
        drawText(ctx, `Level ${h.level} ${h.cls}`, r.x + 100, r.y + 40, { font: 'font16', color: 'white' });
        // 원작 LoD 선택 화면: 확장팩 캐릭터는 초록 글자로 표시. 근사(원작 미확인): 줄 위치·색 번호
        if (h.expansion) drawText(ctx, 'Expansion Character', r.x + 100, r.y + 60, { font: 'font16', color: 'green' });
      });
      this.drawScrollbar(ctx);
      if (this.notice) drawText(ctx, this.notice, 400, 445, { font: 'font16', align: 'center', color: 'red' });
      this.button(a, WIDE, { x: 33, y: 468, w: 272, h: 35 }, 'Create New Character');
      this.button(a, WIDE, { x: 433, y: 468, w: 272, h: 35 }, 'Delete Character');
      this.button(a, MED, { x: 33, y: 537, w: 128, h: 35 }, 'Exit');
      this.button(a, MED, { x: 627, y: 537, w: 128, h: 35 }, 'OK');
      if (this.edition === 'lod' && sel && !sel.expansion) this.button(a, WIDE, CONVERT_BTN, 'Convert to Expansion');
      if (this.confirm) this.drawConfirm(ctx, this.confirm);
      if (this.diffHero) this.drawDifficulty(ctx, this.diffHero);
    } else {
      const a = this.fechar;
      a.drawScreen(ctx, this.edition === 'lod' && a.frames(CREATE_EXP)?.length ? CREATE_EXP : `${FE}CharacterCreate.dc6`);
      drawText(ctx, 'Select Hero Class', 400, 17, { font: 'font30', align: 'center' });
      // 모닥불 (가산 혼합)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      a.drawAnchored(ctx, `${FE}fire.dc6`, fr % 30, 380, 335);
      ctx.restore();
      // 뒤에 있는 인물부터 (y 작은 순)
      const order = [...this.classes()].sort((p, q) => HERO[p].y - HERO[q].y);
      for (const c of order) this.drawHero(c, now);
      if (this.cls) {
        drawText(ctx, this.cls, 400, 65, { font: 'font30', align: 'center' });
        drawText(ctx, HERO[this.cls].desc, 400, 100, { font: 'font16', align: 'center', color: 'white' });
        drawText(ctx, 'Character Name', 321, 475, { font: 'font16', color: 'gold' });
        a.draw(ctx, `${FE}textbox.dc6`, 0, 318, 493);
        drawText(ctx, this.nameInput.value, 324, 498, { font: 'font16', color: 'white' });
        if (this.err) drawText(ctx, this.err, 400, 525, { font: 'font16', align: 'center', color: 'red' });
      }
      // 원작 LoD: 이름 칸 아래 "Expansion Character" 체크 상자 (FrontEnd\clickbox.dc6 — 0 빈 칸, 1 체크). 근사(원작 미확인): 위치
      if (this.edition === 'lod') {
        this.sky.draw(ctx, CLICKBOX, this.expansionChecked ? 1 : 0, EXP_BOX.x, EXP_BOX.y);
        drawText(ctx, 'Expansion Character', EXP_BOX.x + 22, EXP_BOX.y + 1, { font: 'font16', color: 'gold' });
      }
      // 단추 그림은 Sky 팔레트용 (fechar 로 그리면 색이 깨진다 — 원작 파일 확인)
      this.button(this.sky, MED, { x: 33, y: 537, w: 128, h: 35 }, 'Exit');
      this.button(this.sky, MED, { x: 627, y: 537, w: 128, h: 35 }, 'OK');
    }
    this.overlay?.(ctx, this.mouse, now);
  }

  /** 근사: 영웅 그림을 못 그릴 때 클래스 프런트엔드 서 있기 그림(NU1)을 반 크기로 */
  private frontFigure(c: ClassName, x: number, y: number, fr: number): void {
    const f = this.fechar.frame(heroFile(c, 'NU1'), fr % (this.fechar.frames(heroFile(c, 'NU1'))?.length ?? 1));
    if (!f) return;
    this.ctx.drawImage(f.img as CanvasImageSource, Math.round(x - f.w / 4), Math.round(y - f.h / 2), Math.round(f.w / 2), Math.round(f.h / 2));
  }

  private drawScrollbar(ctx: CanvasRenderingContext2D): void {
    const a = this.sky;
    for (let y = SB.y + 10; y < SB.y + SB.h - 10; y += 10) a.draw(ctx, SCROLL, 5, SB.x, Math.min(y, SB.y + SB.h - 20));
    a.draw(ctx, SCROLL, 0, SB.x, SB.y);
    a.draw(ctx, SCROLL, 1, SB.x, SB.y + SB.h - 10);
    const max = this.maxScroll();
    const ty = SB.y + 10 + (max ? Math.round((this.scroll / max) * (SB.h - 30)) : 0);
    if (max) a.draw(ctx, SCROLL, 4, SB.x, ty);
  }

  private drawConfirm(ctx: CanvasRenderingContext2D, kind: keyof typeof CONFIRM_TEXT): void {
    const a = this.sky;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 800, 600);
    a.drawTiles(ctx, POPUP, 2, POP.x, POP.y, 0, 2);
    drawText(ctx, CONFIRM_TEXT[kind], POP.x + POP.w / 2, POP.y + 30, { font: 'font16', align: 'center', color: 'gold' });
    for (const [bx, label] of [[POP.x + 10, 'YES'], [POP.x + 163, 'NO']] as const) {
      a.draw(ctx, SMALL, 0, bx, POP.y + 133);
      drawText(ctx, label, bx + 48, POP.y + 142, { font: 'fontexocet10', align: 'center', color: 'black' });
    }
  }

  /** 난이도 창: PopUp_340x224 + 난이도 단추 3개 + 아래 단추 자리에 CANCEL */
  private drawDifficulty(ctx: CanvasRenderingContext2D, h: HeroSummary): void {
    const a = this.sky;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 800, 600);
    a.drawTiles(ctx, DIFF_POPUP, 2, DPOP.x, DPOP.y, 0, 2);
    DIFF_LABELS.forEach((label, d) => {
      const r = diffRect(d), locked = d > h.difficultyUnlocked;
      a.drawTiles(ctx, WIDE, 2, r.x, r.y, 0, 2);
      drawText(ctx, label.toUpperCase(), r.x + r.w / 2, r.y + 10, { font: 'fontexocet10', align: 'center', color: 'black' });
      // 근사(원작 미확인): 잠긴 난이도 단추는 어둡게
      if (locked) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    });
    drawText(ctx, 'CANCEL', DPOP_CANCEL.x + DPOP_CANCEL.w / 2, DPOP_CANCEL.y + 9, { font: 'fontexocet10', align: 'center', color: 'black' });
  }

  private drawHero(c: ClassName, now: number): void {
    const a = this.fechar, h = HERO[c], ctx = this.ctx;
    let st = this.clsAnim[c];
    let anim: Anim = st?.anim ?? (this.hover === c ? 'NU2' : 'NU1');
    const frames = (x: Anim) => a.frames(heroFile(c, x))?.length ?? 1;
    let f = Math.floor(((now - (st?.start ?? this.t0)) * FPS) / 1000);
    // 앞으로 나옴(FW)이 끝나면 NU3, 돌아감(BW)이 끝나면 NU1
    if (st && (anim === 'FW' || anim === 'BW') && f >= frames(anim)) {
      const next: Anim = anim === 'FW' ? 'NU3' : 'NU1';
      st = { anim: next, start: now };
      if (next === 'NU1') delete this.clsAnim[c];
      else this.clsAnim[c] = st;
      anim = next === 'NU1' && this.hover === c ? 'NU2' : next;
      f = 0;
    }
    if (anim === 'NU1' || anim === 'NU2' || anim === 'NU3') f %= frames(anim);
    a.drawAnchored(ctx, heroFile(c, anim), f, h.x, h.y);
    // 빛 효과 겹침 (있는 파일만)
    const ov = heroFile(c, anim, true);
    if (a.frames(ov)?.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      a.drawAnchored(ctx, ov, f % (a.frames(ov)?.length ?? 1), h.x, h.y);
      ctx.restore();
    }
  }
}
