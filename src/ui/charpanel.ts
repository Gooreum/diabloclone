// 캐릭터 패널 (C): 원작 data\global\ui\PANEL\invchar.dc6 프레임 0~3 (320×432, 왼쪽 패널 자리 80,60), 스탯 + 단추 level.dc6,
// 남은 스탯 포인트 칸 skillpoints.dc6, 닫기 단추 buysellbtn.dc6 프레임 10.
// 출처(칸 좌표): invchar.dc6 그림의 어두운 칸을 직접 측정 (패널 기준):
//   이름 (11,10,171,17) · 클래스 (193,10,117,17) · 레벨 (10,32,44,35) · 경험치 (66,32,116,35) · 다음 레벨 (192,32,118,35)
//   힘/민첩/활력/에너지 이름칸 (10,y,65,18) 값칸 (76,y,39,18), y = 83·145·231·293
//   오른쪽: (161,83)·(161,107) 값 경계 x 260 · (161,145)·(161,169)·(161,193) 값 경계 x 271 · 스태미나/생명 (161,231)·(161,255), 마나 (161,293) 값 두 칸 x 231·271
//   저항 (174,332)·(174,356)·(174,380)·(174,404) 값 경계 x 271 · 닫기 칸 (128,389,32,32)
// 출처(문자열): string.tbl strchrlvl Level, strchrexp Experience, strchrnxtlvl Next Level, strchrstr/dex/vit/eng, strchrskm Damage,
//   strchratr "%s\nAttack Rating", strchrdef Defense, strchrstm Stamina, strchrlif Life, strchrman Mana, strchrfir/col/lit/pos "…\nResistance",
//   strchrstat "Stat Points", strchrrema "Remaining", 클래스 이름 (Amazon … Barbarian)
// 근사(원작 미확인): 오른쪽 위 두 묶음을 왼쪽·오른쪽 스킬의 명중/피해로 둔 배치, + 단추(level.dc6) 위치(화살표 끝 옆), 남은 포인트 칸 위치,
//   두 줄 이름은 font6, 한 줄 이름은 font16 (넘치면 font6), 아이템으로 오른 능력치는 파랑, 음수 저항은 빨강
import type { Character, ClassStats, ExpTable, StatName } from '../engine/player';
import type { Derived } from '../engine/charstats';
import type { ItemBase } from '../engine/items';
import { physicalDamageRange, playerAttackRating } from '../engine/combat';
import { UI, type UiArt } from './art';
import { HotLayer, type HRect } from './hotspot';
import { d2text, drawText, type FontName, type TextColor } from './text';

export const LEFT_PANEL = { x: 80, y: 60, w: 320, h: 432 } as const;
const INVCHAR = `${UI}PANEL\\invchar.dc6`;
const LEVEL = `${UI}PANEL\\level.dc6`;
const POINTS = `${UI}PANEL\\skillpoints.dc6`;
export const CLOSE_BTN = `${UI}PANEL\\buysellbtn.dc6`;

const STAT_Y: Record<StatName, number> = { str: 83, dex: 145, vit: 231, ene: 293 };
const STAT_STR: Record<StatName, string> = { str: 'strchrstr', dex: 'strchrdex', vit: 'strchrvit', ene: 'strchreng' };
const PLUS = { x: 127, dy: -6, size: 30 } as const;
const CLOSE = { x: 128, y: 389, w: 32, h: 32 } as const;

export interface CharPanelDeps {
  character: () => Character;
  heroName: string;
  derived: () => Derived | null;
  classStats: ClassStats | undefined;
  exp: ExpTable | undefined;
  weapon: () => ItemBase | undefined;
  skillName: (id: number) => string;
  str: (k: string) => string;
  spendStat: (stat: StatName) => void;
  onClose: () => void;
  /** 스태미나 현재/최대 (엔진 스냅숏 — 아이템·버프 포함) */
  stamina?: () => { cur: number; max: number };
}

export class CharPanel {
  private readonly art: UiArt;
  private readonly deps: CharPanelDeps;
  readonly layer: HotLayer;

  constructor(stage: HTMLElement, art: UiArt, deps: CharPanelDeps) {
    this.art = art;
    this.deps = deps;
    this.layer = new HotLayer(stage, 'charpanel', LEFT_PANEL);
    void art.preload([INVCHAR, LEVEL, POINTS, CLOSE_BTN]);
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

  /** 스탯 + 단추 화면 좌표 */
  plusRect(stat: StatName): HRect {
    return { x: LEFT_PANEL.x + PLUS.x, y: LEFT_PANEL.y + STAT_Y[stat] + PLUS.dy, w: PLUS.size, h: PLUS.size };
  }

  private syncHotspots(ch: Character): void {
    const keys = new Set<string>(['close']);
    this.layer.button('close', { x: LEFT_PANEL.x + CLOSE.x, y: LEFT_PANEL.y + CLOSE.y, w: CLOSE.w, h: CLOSE.h }, () => this.deps.onClose(), { id: 'charpanel-close' }, 'Close');
    if (ch.statPoints > 0) {
      for (const s of ['str', 'dex', 'vit', 'ene'] as StatName[]) {
        keys.add(s);
        this.layer.button(s, this.plusRect(s), () => this.deps.spendStat(s), { id: `stat-${s}`, 'data-stat': s }, '+');
      }
    }
    this.layer.only(keys);
  }

  draw(ctx: CanvasRenderingContext2D, mouse: { x: number; y: number } | null): void {
    if (!this.open) return;
    const d = this.deps, ch = d.character(), dv = d.derived(), P = LEFT_PANEL;
    this.syncHotspots(ch);
    if (!this.art.drawPanel(ctx, INVCHAR, P.x, P.y, 0)) {
      ctx.fillStyle = 'rgba(12,10,8,0.94)';
      ctx.fillRect(P.x, P.y, P.w, P.h);
    }
    const s = d.str;
    // 가운데 맞춤 글자 (칸 안 세로 가운데)
    const cell = (text: string, x: number, y: number, w: number, h: number, color: TextColor = 'white', font?: FontName) => {
      const lines = text.split('\n');
      const f: FontName = font ?? (lines.length > 1 ? 'font6' : d2text.width(text, 'font16') <= w - 2 ? 'font16' : d2text.width(text, 'font8') <= w - 2 ? 'font8' : 'font6');
      const lh = f === 'font6' ? 9 : f === 'font8' ? 13 : 16;
      const top = P.y + y + Math.round((h - lines.length * lh) / 2) + (f === 'font16' ? 1 : 0);
      drawText(ctx, text, P.x + x + w / 2, top, { font: f, color, align: 'center', lineHeight: lh });
    };
    cell(d.heroName, 11, 10, 171, 17, 'gold');
    cell(s(ch.cls), 193, 10, 117, 17, 'gold');
    // 레벨·경험치·다음 레벨 (이름 위, 값 아래)
    const two = (label: string, value: string, x: number, w: number) => {
      cell(label, x, 32, w, 17, 'gold');
      cell(value, x, 49, w, 18);
    };
    two(s('strchrlvl'), String(ch.level), 10, 44);
    two(s('strchrexp'), String(ch.experience), 66, 116);
    two(s('strchrnxtlvl'), d.exp && ch.level < d.exp.maxLevel ? String(d.exp.threshold(ch.level)) : '', 192, 118);
    // 능력치
    for (const st of ['str', 'dex', 'vit', 'ene'] as StatName[]) {
      const y = STAT_Y[st];
      const eff = dv ? dv[st] : ch[st];
      cell(s(STAT_STR[st]), 10, y, 65, 18, 'gold');
      cell(String(eff), 76, y, 39, 18, eff > ch[st] ? 'blue' : eff < ch[st] ? 'red' : 'white');
      if (ch.statPoints > 0) {
        const r = this.plusRect(st);
        const hot = !!mouse && mouse.x >= r.x && mouse.y >= r.y && mouse.x < r.x + r.w && mouse.y < r.y + r.h;
        this.art.draw(ctx, LEVEL, hot ? 1 : 0, r.x, r.y);
      }
    }
    // 명중·피해 (왼쪽 스킬 / 오른쪽 스킬), 방어
    const cs = d.classStats;
    const w = d.weapon();
    const ar = dv && cs ? Math.trunc((playerAttackRating(dv.dex, cs.toHitFactor, dv.toHit) * (100 + dv.toHitPct)) / 100) : 0;
    const dmg = dv
      ? physicalDamageRange({ min: dv.weaponMin + dv.addMin, max: dv.weaponMax + dv.addMax, strBonus: w?.strBonus ?? 100, dexBonus: w?.dexBonus ?? 0 }, dv.str, dv.dex, dv.offWeaponEdPct)
      : { min: 1, max: 2 };
    const dmgText = `${dmg.min}-${dmg.max}`;
    const atr = (id: number) => s('strchratr').replace('%s', d.skillName(id));
    cell(atr(ch.leftSkill), 161, 83, 99, 18, 'gold');
    cell(String(ar), 260, 83, 50, 18);
    cell(s('strchrskm'), 161, 107, 99, 17, 'gold');
    cell(dmgText, 260, 107, 50, 17);
    cell(atr(ch.rightSkill), 161, 145, 110, 18, 'gold');
    cell(String(ar), 271, 145, 39, 18);
    cell(s('strchrskm'), 161, 169, 110, 17, 'gold');
    cell(dmgText, 271, 169, 39, 17);
    cell(s('strchrdef'), 161, 193, 110, 17, 'gold');
    cell(String(dv?.defense ?? 0), 271, 193, 39, 17);
    // 스태미나·생명·마나 (현재 / 최대)
    const pair = (label: string, cur: number, max: number, y: number) => {
      cell(label, 161, y, 70, 17, 'gold');
      cell(String(Math.floor(cur)), 231, y, 40, 17);
      cell(String(Math.floor(max)), 271, y, 39, 17);
    };
    const stm = this.deps.stamina?.();
    pair(s('strchrstm'), stm?.cur ?? ch.stamina, stm?.max ?? dv?.maxStamina ?? ch.maxStamina, 231);
    pair(s('strchrlif'), ch.life, dv?.maxLife ?? ch.maxLife, 255);
    pair(s('strchrman'), ch.mana, dv?.maxMana ?? ch.maxMana, 293);
    // 저항
    const res = dv?.res ?? { fi: 0, co: 0, li: 0, po: 0 };
    ([['strchrfir', res.fi, 332], ['strchrcol', res.co, 356], ['strchrlit', res.li, 380], ['strchrpos', res.po, 404]] as const).forEach(([k, v, y]) => {
      cell(s(k), 174, y, 97, 17, 'gold');
      cell(String(v), 271, y, 39, 17, v < 0 ? 'red' : v > 0 ? 'blue' : 'white');
    });
    // 남은 스탯 포인트
    if (ch.statPoints > 0) {
      const px = P.x + 8, py = P.y + 358;
      this.art.draw(ctx, POINTS, 0, px, py);
      drawText(ctx, `${s('strchrstat')}\n${s('strchrrema')}`, px + 45, py + 3, { font: 'font6', align: 'center', color: 'gold', lineHeight: 9 });
      drawText(ctx, String(ch.statPoints), px + 113, py + 4, { align: 'center' });
    }
    // 닫기 단추
    this.art.draw(ctx, CLOSE_BTN, 10, P.x + CLOSE.x, P.y + CLOSE.y);
  }

  dispose(): void {
    this.layer.dispose();
  }
}
