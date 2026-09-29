// NPC 대화 메뉴·대사 상자·용병 고용 목록 (캔버스).
// 출처: string.tbl — NPC 이름(monstats NameStr), 메뉴 TalkMenu "talk" / NPCMenuTrade "trade" / NPCMenuTradeRepair "trade/repair" / gamble /
//       NPCMenuHire "hire" / NPCIdentify1 "Identify Items" / lowercasecancel "cancel", 대사 <이름>IntroGossip1 · <이름>Intro<클래스>Gossip1 · <이름>GossipN,
//       고용 목록 ItemDesc1s "Your Gold: %d     Hire which Mercenary?" / ItemDesc1t, strhirespecial<N> (hiredesc.txt 행)
// 근사(원작 미확인): 원작 메뉴는 반투명 검은 상자 위 font16 글자 — 캔버스 serif 대문자(원작 글꼴의 작은 대문자 근사)·상자 크기·위치·줄 간격,
//   'resurrect' 문구 (string.tbl 에 없어 영어 "Resurrect"), 대사 스크롤 대신 고정 상자 (Phase 11 에서 원작 글꼴)
import type { InteractionSnapshot } from '../engine/game';
import type { HireCandidate, NpcOption } from '../engine/npc';
import { NPC_MENU_STRING } from '../engine/npc';

type Str = (k: string) => string;

/** string.tbl 대사의 첫 줄 숫자(스크롤 속도) 를 뗀다 */
export function stripSpeed(s: string): string {
  return s.replace(/^\d+\n/, '');
}

/** 대사 고르기: 처음이면 소개(클래스별 소개가 있으면 그것), 아니면 GossipN 중 하나 */
export function pickGossip(str: Str, prefix: string, cls: string, intro: boolean, pick: number): string {
  const has = (k: string) => str(k) !== k;
  const ab = ({ Amazon: 'Ama', Sorceress: 'Sor', Necromancer: 'Nec', Paladin: 'Pal', Barbarian: 'Bar' } as Record<string, string>)[cls] ?? '';
  if (intro) {
    for (const k of [`${prefix}Intro${ab}Gossip1`, `${prefix}Act1Intro${ab}Gossip1`, `${prefix}IntroGossip1`, `${prefix}Act1IntroGossip1`]) if (has(k)) return stripSpeed(str(k));
  }
  const list: string[] = [];
  for (let i = 1; i <= 12; i++) if (has(`${prefix}Gossip${i}`)) list.push(`${prefix}Gossip${i}`);
  return list.length ? stripSpeed(str(list[(pick >>> 0) % list.length] as string)) : '';
}

const MENU = { cx: 400, top: 110, line: 22, padX: 26 } as const;

export class NpcMenu {
  private rows: { option: NpcOption; y: number; w: number }[] = [];
  private box = { x: 0, y: 0, w: 0, h: 0 };

  label(str: Str, o: NpcOption): string {
    const k = NPC_MENU_STRING[o];
    return (k ? str(k) : 'Resurrect').toUpperCase();
  }

  draw(ctx: CanvasRenderingContext2D, it: InteractionSnapshot, name: string, str: Str, mouse: { x: number; y: number } | null): void {
    ctx.save();
    ctx.font = '16px serif';
    const labels = it.options.map((o) => this.label(str, o));
    const w = Math.max(ctx.measureText(name).width, ...labels.map((l) => ctx.measureText(l).width)) + MENU.padX * 2;
    const h = (labels.length + 1) * MENU.line + 16;
    const x = Math.round(MENU.cx - w / 2), y = MENU.top;
    this.box = { x, y, w, h };
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x, y, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, MENU.cx, y + 8 + MENU.line / 2);
    this.rows = [];
    it.options.forEach((o, i) => {
      const ry = y + 8 + (i + 1) * MENU.line;
      const hover = !!mouse && mouse.y >= ry && mouse.y < ry + MENU.line && mouse.x >= x && mouse.x < x + w;
      ctx.fillStyle = hover ? '#6969ff' : '#c7b377';
      ctx.fillText(labels[i] as string, MENU.cx, ry + MENU.line / 2);
      this.rows.push({ option: o, y: ry, w });
    });
    ctx.restore();
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

/** NPC 대사 상자 */
export class TalkBox {
  text = '';
  name = '';
  until = 0;

  show(name: string, text: string, now: number): void {
    this.name = name;
    this.text = text;
    // 근사(원작 미확인): 원작은 스크롤이 끝날 때까지 — 글자 수에 비례해 표시
    this.until = now + Math.max(4000, text.length * 60);
  }

  hide(): void {
    this.until = 0;
  }

  get open(): boolean {
    return this.until > 0;
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.until || now > this.until || !this.text) {
      this.until = 0;
      return;
    }
    ctx.save();
    ctx.font = '15px serif';
    const lines = this.text.split('\n').map((l) => l.trim()).filter((l, i, a) => l || (i > 0 && i < a.length - 1));
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width), ctx.measureText(this.name).width) + 40;
    const h = (lines.length + 1) * 18 + 20;
    const x = Math.round(400 - w / 2), y = 90;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x, y, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.name, 400, y + 20);
    ctx.fillStyle = '#c7b377';
    lines.forEach((l, i) => ctx.fillText(l, 400, y + 40 + i * 18));
    ctx.restore();
  }
}

/** 용병 고용 목록 */
export class HirePanel {
  private rows: { index: number; y: number }[] = [];
  private box = { x: 0, y: 0, w: 0, h: 0 };

  draw(ctx: CanvasRenderingContext2D, list: readonly HireCandidate[], gold: number, str: Str, mouse: { x: number; y: number } | null): void {
    ctx.save();
    const x = 120, y = 90, w = 560, line = 38;
    const h = 40 + Math.max(1, list.length) * line + 12;
    this.box = { x, y, w, h };
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(x, y, w, h);
    ctx.font = '15px serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    const head = list.length ? str('ItemDesc1s').replace('%d', String(gold)) : str('ItemDesc1t');
    ctx.fillText(head, x + w / 2, y + 24);
    ctx.textAlign = 'left';
    this.rows = [];
    list.forEach((c, i) => {
      const ry = y + 40 + i * line;
      const hover = !!mouse && mouse.x >= x && mouse.x < x + w && mouse.y >= ry && mouse.y < ry + line;
      ctx.fillStyle = hover ? '#6969ff' : '#c7b377';
      ctx.font = '15px serif';
      ctx.fillText(`${str(c.name)}`, x + 16, ry + 15);
      ctx.fillText(`${str('strchrlvl')} ${c.init.level}`, x + 170, ry + 15);
      ctx.fillText(`${str('cost')}${c.init.gold}`, x + 270, ry + 15);
      ctx.fillStyle = '#a09070';
      ctx.font = '12px serif';
      ctx.fillText(`${str(`strhirespecial${c.init.hireDesc}`)} — Life ${c.init.hp}  Def ${c.init.defense}  Dmg ${c.init.minDamage}-${c.init.maxDamage}`, x + 16, ry + 31);
      this.rows.push({ index: c.index, y: ry });
    });
    ctx.restore();
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
