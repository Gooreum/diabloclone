// 원작 도움말 화면 (Configure Controls "Help Screen", 기본 H): 전용 그림 없이 원작 문구를 게임 화면 위에 겹친다.
// 출처(문자열): string.tbl Strhelp1 "Diablo II Help", StrHelp2~8 (조작 안내 — <%s> 는 지금 배정된 키), StrHelp8a "Hit <%s> to toggle this screen open and closed",
//   StrHelp9 "Life Orb", StrHelp10~13 "Left/Right Mouse-" "Button Skill" "(Click to Change)", StrHelp14/14a "Run/Walk" "Toggle", StrHelp15 "Stamina Bar",
//   StrHelp16/16a "Experience" "Bar", StrHelp17~20 "Mini-Panel" "(opens Character," "Inventory, and" "other screens)", StrHelp21 "Belt", StrHelp22 "Mana Orb".
// 근사(원작 미확인): 글 위치·선 끝점·화면 어둡게 하는 정도 (MPQ 에 도움말 그림이 없어 원작 화면 배치를 보고 맞춤)
import type { HudLayout } from './hud';
import { drawText } from './text';

export interface HelpKeys {
  /** 달리기·아이템 보기·자동 지도·도움말 키 이름 (지금 배정) */
  run: string; showItems: string; automap: string; help: string;
}

interface Callout { lines: string[]; at: { x: number; y: number }; to: { x: number; y: number }; align: 'left' | 'center' | 'right' }

export class HelpOverlay {
  open = false;

  toggle(): void {
    this.open = !this.open;
  }

  /** 조작판 각 부분에 붙는 이름표 */
  private callouts(L: HudLayout, str: (k: string) => string): Callout[] {
    const belt = L.belt;
    const beltMid = (belt.xs[0] + belt.xs[3] + belt.w) / 2;
    return [
      { lines: [str('StrHelp9')], at: { x: 50, y: 462 }, to: { x: L.lifeGlobe.x + 40, y: L.lifeGlobe.y + 30 }, align: 'center' },
      { lines: [str('StrHelp10'), str('StrHelp11'), str('StrHelp12')], at: { x: 150, y: 364 }, to: { x: L.lskill.x + 24, y: L.lskill.y + 4 }, align: 'center' },
      { lines: [str('StrHelp14'), str('StrHelp14a')], at: { x: L.run.x - 30, y: 482 }, to: { x: L.run.x + 8, y: L.run.y }, align: 'center' },
      { lines: [str('StrHelp15')], at: { x: L.stamina.x + 70, y: 500 }, to: { x: L.stamina.x + 50, y: L.stamina.y }, align: 'center' },
      { lines: [str('StrHelp16'), str('StrHelp16a')], at: { x: L.exp.x - 20, y: 432 }, to: { x: L.exp.x + 60, y: L.exp.y }, align: 'center' },
      { lines: [str('StrHelp17'), str('StrHelp18'), str('StrHelp19'), str('StrHelp20')], at: { x: L.mini.x + L.mini.w / 2, y: 410 }, to: { x: L.mini.x + L.mini.w / 2, y: L.mini.y }, align: 'center' },
      { lines: [str('StrHelp21')], at: { x: beltMid + 50, y: 500 }, to: { x: beltMid, y: belt.y }, align: 'center' },
      { lines: [str('StrHelp13'), str('StrHelp11'), str('StrHelp12')], at: { x: 650, y: 364 }, to: { x: L.rskill.x + 24, y: L.rskill.y + 4 }, align: 'center' },
      { lines: [str('StrHelp22')], at: { x: 750, y: 462 }, to: { x: L.manaGlobe.x + 40, y: L.manaGlobe.y + 30 }, align: 'center' },
    ];
  }

  draw(ctx: CanvasRenderingContext2D, L: HudLayout, str: (k: string) => string, keys: HelpKeys): void {
    if (!this.open) return;
    const fill = (k: string, v: string) => str(k).replace('%s', v);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, 800, 600);
    drawText(ctx, str('Strhelp1'), 400, 40, { font: 'font30', align: 'center', color: 'gold' });
    const lines = [
      fill('StrHelp2', keys.run), fill('StrHelp3', keys.showItems), fill('StrHelp4', 'Shift'), fill('StrHelp5', keys.automap),
      str('StrHelp6'), str('StrHelp7'), str('StrHelp8'), fill('StrHelp8a', keys.help),
    ];
    lines.forEach((t, i) => drawText(ctx, t, 400, 92 + i * 24, { align: 'center', color: 'white' }));
    ctx.strokeStyle = 'rgba(216,198,144,0.85)';
    ctx.lineWidth = 1;
    for (const c of this.callouts(L, str)) {
      const lh = 16;
      c.lines.forEach((t, i) => drawText(ctx, t, c.at.x, c.at.y + i * lh, { align: c.align, color: 'gold' }));
      ctx.beginPath();
      ctx.moveTo(c.at.x, c.at.y + c.lines.length * lh + 2);
      ctx.lineTo(c.to.x, c.to.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
