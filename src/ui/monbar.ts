// 화면 위쪽 몬스터 이름·생명 막대 (마우스를 올린 몬스터).
// 출처: 원작 D2Client 몬스터 체력 막대 — 화면 위 가운데, 생명 비율만큼 붉은 막대 위에 이름, 유니크(금색)·챔피언(파랑)·수식어 줄
// 출처: string.tbl (monstats NameStr, SuperUniques Name, UniquePrefix/Suffix/Appellation, uniquextrastrong … monsteruniqueprop1~9, Champion, minion)
// 글자: 원작 font16 (src/ui/text.ts). 근사(원작 미확인): 막대는 원작 그림 대신 사각형 (크기·색·투명도)
import type { MonsterSnapshot } from '../engine/game';
import type { MonsterDb } from '../engine/monster';
import { Rng } from '../engine/rng';
import { d2text, drawText } from './text';
import { CHAMPION_UMODS, MONFLAG, UMOD, UMOD_STRING, uniqueNameKeys, type UniqueDb } from '../engine/uniques';

/** 원작 글자 색 (D2 font color: 흰색 0, 파랑 3 챔피언, 금색 4 유니크) */
export const MONBAR_COLORS = { normal: '#ffffff', champion: '#6969ff', unique: '#c7b377' } as const;

export interface MonsterLabel { name: string; color: string; mods: string[] }

export class MonsterNamer {
  private readonly monsters: MonsterDb;
  private readonly uniques: UniqueDb | undefined;
  private readonly str: (key: string) => string;

  constructor(monsters: MonsterDb, uniques: UniqueDb | undefined, str: (key: string) => string) {
    this.monsters = monsters;
    this.uniques = uniques;
    this.str = str;
  }

  label(m: Pick<MonsterSnapshot, 'typeId' | 'flags' | 'umods' | 'nameSeed' | 'superUnique'>): MonsterLabel {
    const t = this.monsters.types.get(m.typeId);
    const base = this.str(t?.nameStr ?? m.typeId);
    const mods: string[] = [];
    for (const u of m.umods) {
      if (u <= UMOD.LEVELADD || u === UMOD.QUESTCOMPLETE || CHAMPION_UMODS.includes(u)) continue;
      const k = UMOD_STRING[u];
      if (k) mods.push(this.str(k));
    }
    if (m.superUnique !== undefined && this.uniques) {
      const su = this.uniques.superUnique(m.superUnique);
      return { name: su ? this.str(su.name) : base, color: MONBAR_COLORS.unique, mods };
    }
    if (m.flags & MONFLAG.CHAMPION) {
      // 확장팩 챔피언 종류면 그 이름 (Ghostly · Fanatic · Possessed · Berserker), 아니면 Champion
      const kind = m.umods.find((u) => CHAMPION_UMODS.includes(u) && u !== UMOD.CHAMPION) ?? UMOD.CHAMPION;
      return { name: base, color: MONBAR_COLORS.champion, mods: [this.str(UMOD_STRING[kind] ?? 'Champion'), ...mods] };
    }
    if (m.flags & MONFLAG.UNIQUE && this.uniques) {
      const [p, s, a] = uniqueNameKeys(this.uniques, m.nameSeed, (seed) => new Rng(seed));
      return { name: [this.str(p), this.str(s), this.str(a)].filter(Boolean).join(' '), color: MONBAR_COLORS.unique, mods };
    }
    if (m.flags & MONFLAG.MINION) return { name: base, color: MONBAR_COLORS.normal, mods: [this.str('minion')] };
    // 보스 몬스터 (monstats boss: Andariel, Blood Raven) 는 금색
    if (t?.boss) return { name: base, color: MONBAR_COLORS.unique, mods: [] };
    return { name: base, color: MONBAR_COLORS.normal, mods: [] };
  }
}

/** 이름 막대 그리기 (반환: 그린 상자) — 글자는 원작 font16 (원작 글자 색: 흰색·파랑 챔피언·금색 유니크) */
export function drawMonsterBar(ctx: CanvasRenderingContext2D, m: MonsterSnapshot, label: MonsterLabel): { x: number; y: number; w: number; h: number } {
  const W = ctx.canvas.width;
  const tw = Math.max(d2text.width(label.name), 60);
  const modText = label.mods.join(', ');
  const mw = label.mods.length ? d2text.width(modText, 'font16') : 0;
  const w = Math.max(tw, mw) + 24, h = label.mods.length ? 36 : 20;
  const x = Math.round(W / 2 - w / 2), y = 8;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, w, h);
  const frac = m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
  ctx.fillStyle = 'rgba(160,0,0,0.85)';
  ctx.fillRect(x, y, Math.round(w * frac), 20);
  ctx.restore();
  drawText(ctx, label.name, W / 2, y + 2, { align: 'center', color: label.color as `#${string}` });
  if (label.mods.length) drawText(ctx, modText, W / 2, y + 19, { align: 'center', color: 'white' });
  return { x, y, w, h };
}

/** NPC 이름 (원작: NPC 위에 마우스를 올리면 이름만, 생명 막대 없음) */
export function drawNameBar(ctx: CanvasRenderingContext2D, name: string): void {
  const W = ctx.canvas.width;
  const w = d2text.width(name) + 24;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(Math.round(W / 2 - w / 2), 8, w, 20);
  drawText(ctx, name, W / 2, 10, { align: 'center', color: 'white' });
}
