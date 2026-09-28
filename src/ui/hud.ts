// 최소 HUD (캔버스): 생명/마나 구체, 경험치 바, 레벨·골드, 사망 메시지. 원작 DC6 컨트롤 패널은 Phase 11 에서 교체.
import type { WorldSnapshot } from '../engine/game';
import type { ExpTable } from '../engine/player';

function orb(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: number, color: string, label: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.clip();
  const h = 2 * r * Math.max(0, Math.min(1, fill));
  ctx.fillStyle = color;
  ctx.fillRect(cx - r, cy + r - h, 2 * r, h);
  ctx.restore();
  ctx.strokeStyle = '#6b5a3a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#e8d8a8';
  ctx.font = '12px serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy - r - 6);
  ctx.textAlign = 'left';
}

export function drawHud(ctx: CanvasRenderingContext2D, s: Readonly<WorldSnapshot>, exp: ExpTable | undefined, levelName: string, dead: boolean): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const p = s.player;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, H - 48, W, 48);
  orb(ctx, 45, H - 45, 38, p.maxLife ? p.life / p.maxLife : 0, '#a01010', `Life: ${Math.floor(p.life)} / ${Math.floor(p.maxLife)}`);
  orb(ctx, W - 45, H - 45, 38, p.maxMana ? p.mana / p.maxMana : 0, '#1030b0', `Mana: ${Math.floor(p.mana)} / ${Math.floor(p.maxMana)}`);
  // 경험치 바: 현재 레벨 구간 진행률
  const lo = exp && p.level > 1 ? exp.threshold(p.level - 1) : 0;
  const hi = exp ? exp.threshold(p.level) : 1;
  const frac = Number.isFinite(hi) && hi > lo ? (p.experience - lo) / (hi - lo) : 1;
  ctx.fillStyle = '#222';
  ctx.fillRect(110, H - 14, W - 220, 6);
  ctx.fillStyle = '#c7b377';
  ctx.fillRect(110, H - 14, (W - 220) * Math.max(0, Math.min(1, frac)), 6);
  ctx.fillStyle = '#e8d8a8';
  ctx.font = '14px serif';
  ctx.fillText(`Level ${p.level}   Experience ${p.experience}   Gold ${p.gold}   ${levelName}`, 115, H - 24);
  if (dead) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#c01818';
    ctx.font = '36px serif';
    ctx.textAlign = 'center';
    ctx.fillText('You have died', W / 2, H / 2 - 20);
    ctx.font = '16px serif';
    ctx.fillStyle = '#e8d8a8';
    ctx.fillText('Press ESC to continue', W / 2, H / 2 + 14);
    ctx.textAlign = 'left';
  }
}
