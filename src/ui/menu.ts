// 프런트엔드 (캔버스, 원작 DC6): 타이틀 → 캐릭터 선택 → 캐릭터 만들기. 투명 DOM 단추(#btn-single 등)가 그림 위에 겹친다.
// 출처(그림): data\global\ui\FrontEnd\TitleScreen.dc6 (800×600 12조각, 팔레트 Sky), D2logoBlackLeft/Right + D2logoFireLeft/Right (30프레임, 기준점 400,120),
//   WideButtonBlank.dc6 (272×35: 프레임 0·1 보통, 2·3 눌림), MediumButtonBlank.dc6 (128×35), CharSelect\charselectbckg.dc6 (Sky), charselectbox.dc6 (272×93),
//   CharacterCreate.dc6 (팔레트 fechar), fire.dc6 (모닥불 30프레임), <클래스>\<xx>NU1 (서 있기), NU2 (마우스를 올림), FW (앞으로 나옴), NU3 (나와 서 있기), BW (돌아감),
//   *s.dc6 (빛 효과 겹침), textbox.dc6 (이름 칸 169×26), 글꼴 fontexocet10 (단추) · font30 (제목) · font16 (설명)
// 출처(배치): OpenDiablo2 main_menu.go (로고 400,120 · 단추 x 264, y 290/330/370/500), character_select.go (칸 37+272·열, 86+95·행 · 단추 33,468 / 433,468 / 33,537 / 627,537),
//   select_hero_class.go (모닥불 380,335 · 아마존 100,339 · 네크로맨서 300,335 · 바바리안 400,330 · 팔라딘 521,338 · 소서리스 626,352 · 이름 칸 318,493 · 제목 400,17 · 클래스 이름 400,65)
// 근사(원작 미확인): 단추 문구·클래스 설명은 원작 D2Launch 내장 문자열(string.tbl 에 없음)을 기억에 따라 영어로, 애니메이션 속도 초당 25프레임,
//   캐릭터 선택 칸의 캐릭터 그림(원작은 게임 속 모습) 생략, 영웅 8명 넘으면 스크롤 없이 최근 8명만, Battle.net·Other Multiplayer 는 동작 없음
import type { HeroSummary } from '../engine/save';
import { validHeroName } from '../engine/save';
import { CLASSIC_CLASSES, type ClassName } from '../engine/player';
import { UI, type UiArt } from './art';
import { HotLayer, type HRect } from './hotspot';
import { HeroStore } from './storage';
import { drawText } from './text';

export type MenuResult = { kind: 'new'; name: string; cls: ClassName } | { kind: 'load'; name: string };

const FE = `${UI}FrontEnd\\`;
const CS = `${UI}CharSelect\\`;
const FPS = 25;
const WIDE = `${FE}WideButtonBlank.dc6`, MED = `${FE}MediumButtonBlank.dc6`;

/** 클래스별 프런트엔드 애니메이션 (파일 접두·위치) */
const HERO: Record<ClassName, { dir: string; pre: string; x: number; y: number; desc: string }> = {
  Amazon: { dir: 'amazon', pre: 'AM', x: 100, y: 339, desc: 'Skilled with the spear and the bow, she is\na very versatile fighter.' },
  Necromancer: { dir: 'necromancer', pre: 'NE', x: 300, y: 335, desc: 'Summoning undead minions and cursing his\nenemies are his specialties.' },
  Barbarian: { dir: 'barbarian', pre: 'BA', x: 400, y: 330, desc: 'He is unequaled in close-quarters combat\nand mastery of weapons.' },
  Paladin: { dir: 'paladin', pre: 'PA', x: 521, y: 338, desc: 'He is a natural party leader, holy man,\nand blessed warrior.' },
  Sorceress: { dir: 'sorceress', pre: 'SO', x: 626, y: 352, desc: 'She has mastered the elemental magicks --\nfire, lightning, and ice.' },
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
  private cls: ClassName | null = null;
  private hover: ClassName | null = null;
  private clsAnim: Partial<Record<ClassName, { anim: Anim; start: number }>> = {};
  private err = '';
  private mouse: { x: number; y: number } | null = null;
  private resolve: ((r: MenuResult) => void) | null = null;
  /** 원작 프런트엔드 소리 (sounds.txt 이름) — main 이 사운드 시스템에 연결 */
  onSound: ((name: string) => void) | null = null;
  private listHeroes: (() => Promise<HeroSummary[]>) | null = null;

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
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    void sky.preload([`${FE}TitleScreen.dc6`, `${FE}D2logoBlackLeft.dc6`, `${FE}D2logoBlackRight.dc6`, `${FE}D2logoFireLeft.dc6`, `${FE}D2logoFireRight.dc6`, WIDE, MED, `${CS}charselectbckg.dc6`, `${CS}charselectbox.dc6`]);
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
    this.layer.only(new Set(['__none']));
    this.nameInput.style.display = 'none';
    if (screen === 'title') {
      this.btn('single', { x: 264, y: 290, w: 272, h: 35 }, () => void this.openSelect(), 'btn-single', 'Single Player');
      this.btn('bnet', { x: 264, y: 330, w: 272, h: 35 }, () => undefined, 'btn-battlenet', 'Battle.net');
      this.btn('multi', { x: 264, y: 370, w: 272, h: 35 }, () => undefined, 'btn-multiplayer', 'Other Multiplayer');
      this.btn('exit', { x: 264, y: 500, w: 272, h: 35 }, () => undefined, 'btn-exit-d2', 'Exit Diablo II');
    } else if (screen === 'select') {
      this.heroes.slice(0, 8).forEach((h, i) => {
        this.btn(`hero:${h.name}`, this.heroRect(i), (e) => {
          this.selectedHero = i;
          if (e.detail >= 2) this.finish({ kind: 'load', name: h.name });
        }, `hero-${h.name}`, h.name);
      });
      this.btn('create', { x: 33, y: 468, w: 272, h: 35 }, () => this.go('create'), 'btn-create', 'Create New Character');
      this.btn('delete', { x: 433, y: 468, w: 272, h: 35 }, () => void this.deleteHero(), 'btn-delete', 'Delete Character');
      this.btn('selexit', { x: 33, y: 537, w: 128, h: 35 }, () => this.go('title'), 'btn-select-exit', 'Exit');
      this.btn('selok', { x: 627, y: 537, w: 128, h: 35 }, () => {
        const h = this.heroes[this.selectedHero];
        if (h) this.finish({ kind: 'load', name: h.name });
      }, 'btn-select-ok', 'OK');
    } else {
      this.cls = null;
      this.clsAnim = {};
      this.nameInput.value = '';
      for (const c of CLASSIC_CLASSES) this.btn(`cls:${c}`, this.heroBox(c), () => this.pickClass(c), `btn-${c.toLowerCase()}`, c, (el) => {
        el.addEventListener('mouseenter', () => (this.hover = c));
        el.addEventListener('mouseleave', () => this.hover === c && (this.hover = null));
      });
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
    // 이전 영웅 단추 정리 (이름이 바뀌거나 지워졌을 수 있다)
    for (const h of this.heroes) this.layer.remove(`hero:${h.name}`);
    this.heroes = this.listHeroes ? await this.listHeroes() : [];
    this.selectedHero = 0;
    this.go('select');
  }

  private async deleteHero(): Promise<void> {
    const h = this.heroes[this.selectedHero];
    if (!h) return;
    await HeroStore.remove(h.name);
    await this.openSelect();
  }

  private heroRect(i: number): HRect {
    return { x: 37 + (i % 2) * 272, y: 86 + Math.floor(i / 2) * 95, w: 272, h: 93 };
  }

  /** 클래스 그림이 차지하는 칸 (서 있기 첫 프레임 기준) */
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
    this.finish({ kind: 'new', name, cls: this.cls });
  }

  // ---------------------------------------------------------------- 그리기

  private button(art: UiArt, path: string, r: HRect, label: string, font: 'fontexocet10' = 'fontexocet10'): void {
    const pressed = false;
    art.drawTiles(this.ctx, path, path === WIDE ? 2 : 1, r.x, r.y, pressed ? (path === WIDE ? 2 : 1) : 0, path === WIDE ? 2 : 1);
    drawText(this.ctx, label.toUpperCase(), r.x + r.w / 2, r.y + 10, { font, align: 'center', color: 'black' });
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
      this.button(a, WIDE, { x: 264, y: 500, w: 272, h: 35 }, 'Exit Diablo II');
      drawText(ctx, 'v 1.14d', 20, 575, { font: 'font8', color: 'white' });
    } else if (this.screen === 'select') {
      const a = this.sky;
      a.drawScreen(ctx, `${CS}charselectbckg.dc6`);
      const sel = this.heroes[this.selectedHero];
      if (sel) drawText(ctx, sel.name, 400, 20, { font: 'font42', align: 'center' });
      this.heroes.slice(0, 8).forEach((h, i) => {
        const r = this.heroRect(i);
        if (i === this.selectedHero) a.drawTiles(ctx, `${CS}charselectbox.dc6`, 2, r.x, r.y, 0, 2);
        drawText(ctx, h.name, r.x + 100, r.y + 20, { font: 'font16', color: 'gold' });
        drawText(ctx, `Level ${h.level} ${h.cls}`, r.x + 100, r.y + 40, { font: 'font16', color: 'white' });
      });
      this.button(a, WIDE, { x: 33, y: 468, w: 272, h: 35 }, 'Create New Character');
      this.button(a, WIDE, { x: 433, y: 468, w: 272, h: 35 }, 'Delete Character');
      this.button(a, MED, { x: 33, y: 537, w: 128, h: 35 }, 'Exit');
      this.button(a, MED, { x: 627, y: 537, w: 128, h: 35 }, 'OK');
    } else {
      const a = this.fechar;
      a.drawScreen(ctx, `${FE}CharacterCreate.dc6`);
      drawText(ctx, 'Select Hero Class', 400, 17, { font: 'font30', align: 'center' });
      // 모닥불 (가산 혼합)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      a.drawAnchored(ctx, `${FE}fire.dc6`, fr % 30, 380, 335);
      ctx.restore();
      // 뒤에 있는 인물부터 (y 작은 순)
      const order = [...CLASSIC_CLASSES].sort((p, q) => HERO[p].y - HERO[q].y);
      for (const c of order) this.drawHero(c, now);
      if (this.cls) {
        drawText(ctx, this.cls, 400, 65, { font: 'font30', align: 'center' });
        drawText(ctx, HERO[this.cls].desc, 400, 100, { font: 'font16', align: 'center', color: 'white' });
        drawText(ctx, 'Character Name', 321, 475, { font: 'font16', color: 'gold' });
        a.draw(ctx, `${FE}textbox.dc6`, 0, 318, 493);
        drawText(ctx, this.nameInput.value, 324, 498, { font: 'font16', color: 'white' });
        if (this.err) drawText(ctx, this.err, 400, 525, { font: 'font16', align: 'center', color: 'red' });
      }
      // 단추 그림은 Sky 팔레트용 (fechar 로 그리면 색이 깨진다 — 원작 파일 확인)
      this.button(this.sky, MED, { x: 33, y: 537, w: 128, h: 35 }, 'Exit');
      this.button(this.sky, MED, { x: 627, y: 537, w: 128, h: 35 }, 'OK');
    }
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
