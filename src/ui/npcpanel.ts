// NPC 대화 메뉴·대사 상자·용병 고용 목록 (캔버스).
// 출처: string.tbl — NPC 이름(monstats NameStr), 메뉴 TalkMenu "talk" / NPCMenuTrade "trade" / NPCMenuTradeRepair "trade/repair" / gamble /
//       NPCMenuHire "hire" / NPCIdentify1 "Identify Items" / lowercasecancel "cancel", 막 이동 WarrivMenu1b "go east" · WarrivMenu1c "go west" ·
//       MeshifMenuEast "sail east" · MeshifMenuWest "sail west", 대사 <이름>IntroGossip1 · <이름>Intro<클래스>Gossip1 · <이름>GossipN,
//       고용 목록 ItemDesc1s "Your Gold: %d     Hire which Mercenary?" / ItemDesc1t, strhirespecial<N> (hiredesc.txt 행)
// 글자: 원작 font16 (src/ui/text.ts — DC6 글꼴 + Pal.PL2 글자 색). 원작 font16 은 소문자도 작은 대문자 모양이다.
// 근사(원작 미확인): 반투명 검은 상자 크기·위치·줄 간격, 항목 색(금색, 마우스 = 흰색), 'resurrect' 문구 (string.tbl 에 없어 영어 "Resurrect"),
//   대사 스크롤 속도 (string.tbl 대사 첫 줄 숫자를 속도로 써서 초당 ≈ 숫자 × 0.3 픽셀), 대사 상자 높이 8줄
import type { InteractionSnapshot } from '../engine/game';
import type { HireCandidate, NpcOption } from '../engine/npc';
import { npcMenuKey } from '../engine/npc';
import { d2text, drawText } from './text';

type Str = (k: string) => string;

/** string.tbl 대사의 첫 줄 숫자(스크롤 속도) 를 뗀다 */
export function stripSpeed(s: string): string {
  return s.replace(/^\d+\n/, '');
}

/** 대사 고르기: 처음이면 소개(클래스별 소개가 있으면 그것), 아니면 GossipN 중 하나 */
export function pickGossip(str: Str, prefix: string, cls: string, intro: boolean, pick: number): string {
  const has = (k: string) => str(k) !== k;
  const ab = ({ Amazon: 'Ama', Sorceress: 'Sor', Necromancer: 'Nec', Paladin: 'Pal', Barbarian: 'Bar', Druid: 'Dru', Assassin: 'Ass' } as Record<string, string>)[cls] ?? '';
  if (intro) {
    // 막 소개 대사 (막에 처음 온 날): HratliActIntroGossip1 · TyraelActIntroGossip1 · CainAct3IntroGossip1 · MeshifAct3IntroBarGossip1 …
    const base = prefix.replace(/Act\d$/, '');
    const keys = [
      `${prefix}Intro${ab}Gossip1`, `${prefix}Act1Intro${ab}Gossip1`, `${prefix}ActIntro${ab}Gossip1`, `${base}ActIntro${ab}Gossip1`,
      `${prefix}IntroGossip1`, `${prefix}Act1IntroGossip1`, `${prefix}ActIntroGossip1`, `${base}ActIntroGossip1`,
    ];
    for (const k of keys) if (has(k)) return stripSpeed(str(k));
  }
  const list: string[] = [];
  for (let i = 1; i <= 12; i++) if (has(`${prefix}Gossip${i}`)) list.push(`${prefix}Gossip${i}`);
  return list.length ? stripSpeed(str(list[(pick >>> 0) % list.length] as string)) : '';
}

const MENU = { cx: 400, top: 110, line: 22, padX: 26 } as const;

export class NpcMenu {
  private rows: { option: NpcOption; y: number; w: number }[] = [];
  private box = { x: 0, y: 0, w: 0, h: 0 };

  /** 마지막으로 그린 메뉴 상자 아래쪽 */
  get bottom(): number {
    return this.box.y + this.box.h;
  }

  label(str: Str, o: NpcOption): string {
    const k = npcMenuKey(o);
    return (k ? str(k) : 'Resurrect').toUpperCase();
  }

  draw(ctx: CanvasRenderingContext2D, it: InteractionSnapshot, name: string, str: Str, mouse: { x: number; y: number } | null): void {
    const labels = it.options.map((o) => this.label(str, o));
    const w = Math.max(d2text.width(name), ...labels.map((l) => d2text.width(l))) + MENU.padX * 2;
    const h = (labels.length + 1) * MENU.line + 16;
    const x = Math.round(MENU.cx - w / 2), y = MENU.top;
    this.box = { x, y, w, h };
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x, y, w, h);
    const lh = d2text.lineHeight();
    drawText(ctx, name, MENU.cx, y + 8 + (MENU.line - lh) / 2, { align: 'center', color: 'white' });
    this.rows = [];
    it.options.forEach((o, i) => {
      const ry = y + 8 + (i + 1) * MENU.line;
      const hover = !!mouse && mouse.y >= ry && mouse.y < ry + MENU.line && mouse.x >= x && mouse.x < x + w;
      drawText(ctx, labels[i] as string, MENU.cx, ry + (MENU.line - lh) / 2, { align: 'center', color: hover ? 'white' : 'gold' });
      this.rows.push({ option: o, y: ry, w });
    });
  }

  /** 클릭 → 메뉴 항목 / 'panel' (상자 안) / null (밖) */
  click(x: number, y: number): NpcOption | 'panel' | null {
    const b = this.box;
    if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return null;
    const r = this.rows.find((q) => y >= q.y && y < q.y + MENU.line);
    return r ? r.option : 'panel';
  }

  optionCenter(o: NpcOption): { x: number; y: number } | null {
    const r = this.rows.find((q) => q.option === o);
    return r ? { x: MENU.cx, y: r.y + MENU.line / 2 } : null;
  }
}

/** NPC 대사 상자 — 원작처럼 글자가 아래에서 위로 천천히 흐른다 */
export class TalkBox {
  text = '';
  name = '';
  until = 0;
  private start = 0;
  private speed = 50;
  private lines: string[] = [];

  /** text 첫 줄이 숫자면(원작 string.tbl 대사 머리) 흐름 속도로 쓴다 */
  show(name: string, text: string, now: number, speed?: number): void {
    const m = /^(\d+)\n/.exec(text);
    this.speed = speed ?? (m ? Number(m[1]) : 50);
    this.name = name;
    this.text = m ? text.slice(m[0].length) : text;
    this.lines = this.text.split('\n').map((l) => l.trim());
    while (this.lines.length && !this.lines[this.lines.length - 1]) this.lines.pop();
    this.start = now;
    // 모든 줄이 상자 위로 지나갈 때까지 + 여유
    this.until = now + ((this.lines.length + TALK_LINES) * 16 * 1000) / this.pxPerSec() + 500;
  }

  private pxPerSec(): number {
    return Math.max(6, this.speed * 0.3);
  }

  hide(): void {
    this.until = 0;
  }

  get open(): boolean {
    return this.until > 0;
  }

  /** top: 상자 위쪽 (NPC 메뉴가 떠 있으면 그 아래) */
  draw(ctx: CanvasRenderingContext2D, now: number, top = 90): void {
    if (!this.until || now > this.until || !this.text) {
      this.until = 0;
      return;
    }
    const lh = 16;
    const w = Math.max(...this.lines.map((l) => d2text.width(l)), d2text.width(this.name)) + 40;
    const inner = TALK_LINES * lh;
    const h = inner + lh + 24;
    const x = Math.round(400 - w / 2), y = top;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x, y, w, h);
    drawText(ctx, this.name, 400, y + 6, { align: 'center', color: 'white' });
    // 흐르는 글: 상자 아래쪽에서 시작해 위로
    const ty = y + lh + 14;
    ctx.beginPath();
    ctx.rect(x, ty, w, inner);
    ctx.clip();
    const off = ((now - this.start) * this.pxPerSec()) / 1000;
    this.lines.forEach((l, i) => {
      const ly = ty + inner - off + i * lh;
      if (ly > ty - lh && ly < ty + inner) drawText(ctx, l, 400, ly, { align: 'center', color: 'white' });
    });
    ctx.restore();
  }
}

const TALK_LINES = 8;

/**
 * 고용 목록의 용병 종류 문자열 (hiredesc.txt 행 → string.tbl/patchstring.tbl 키).
 * 근사(원작 미확인 — D2Client 표는 D2MOO 에 없다): 1 farw "Fire Arrow" · 2 carw "Cold Arrow" (strhirespecial1·2),
 *   3 comb "Combat" · 4 def "Defensive" · 5 off "Offensive" (PalMercEXST4X · PalMercExST1X · PalMercEXST3X),
 *   6 fire "Fire" · 7 cold "Cold" · 8 ltng "Lightning" (strhirespecial7·6·5) — strhirespecial3·4 ("Jab Attack"·"Poison Resistant")는 쓰지 않는 옛 문구
 */
export const HIRE_DESC_STRING: readonly string[] = ['', 'strhirespecial1', 'strhirespecial2', 'PalMercEXST4X', 'PalMercExST1X', 'PalMercEXST3X', 'strhirespecial7', 'strhirespecial6', 'strhirespecial5'];

/** 용병 고용 목록 */
export class HirePanel {
  private rows: { index: number; y: number }[] = [];
  private box = { x: 0, y: 0, w: 0, h: 0 };

  draw(ctx: CanvasRenderingContext2D, list: readonly HireCandidate[], gold: number, str: Str, mouse: { x: number; y: number } | null): void {
    const x = 120, y = 90, w = 560, line = 38;
    const h = 40 + Math.max(1, list.length) * line + 12;
    this.box = { x, y, w, h };
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(x, y, w, h);
    const head = list.length ? str('ItemDesc1s').replace('%d', String(gold)) : str('ItemDesc1t');
    drawText(ctx, head, x + w / 2, y + 12, { align: 'center' });
    this.rows = [];
    list.forEach((c, i) => {
      const ry = y + 40 + i * line;
      const hover = !!mouse && mouse.x >= x && mouse.x < x + w && mouse.y >= ry && mouse.y < ry + line;
      const col = hover ? 'white' : 'gold';
      drawText(ctx, str(c.name), x + 16, ry + 2, { color: col });
      drawText(ctx, `${str('strchrlvl')} ${c.init.level}`, x + 170, ry + 2, { color: col });
      drawText(ctx, `${str('cost')}${c.init.gold}`, x + 270, ry + 2, { color: col });
      drawText(ctx, `${str(HIRE_DESC_STRING[c.init.hireDesc] ?? `strhirespecial${c.init.hireDesc}`)} - Life ${c.init.hp}  Def ${c.init.defense}  Dmg ${c.init.minDamage}-${c.init.maxDamage}`, x + 16, ry + 20, { font: 'font8', color: 'tan' });
      this.rows.push({ index: c.index, y: ry });
    });
  }

  click(x: number, y: number): number | 'panel' | null {
    const b = this.box;
    if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return null;
    const r = this.rows.find((q) => y >= q.y && y < q.y + 38);
    return r ? r.index : 'panel';
  }

  rowCenter(i: number): { x: number; y: number } | null {
    const r = this.rows[i];
    return r ? { x: this.box.x + 100, y: r.y + 15 } : null;
  }
}
