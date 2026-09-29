// 스킬 트리 툴팁의 레벨별 줄 (원작 skilldesc.txt desc/dsc2/dsc3 줄 + skills.txt 공식, 엔진 SkillCalc 로 계산).
// 출처: Phrozen Keep — SkillDesc.txt File Guide (descline 표 Appendix B: 2 = S1+C1S2, 3 = S1C1S2, 4 = S1+C1, 5 = S1C1, 6 = +C1S1, 7 = C1S1,
//   8 = 명중 보너스 자동, 10 = 원소 피해 X-Y (skills.txt), 11 = 스킬 피해, 12 = S1 C1/25 초, 13 = 생명, 14 = 독 피해 X-Y over Z seconds, 16~75 …),
//   desc = 현재·다음 레벨, dsc2 = 현재 레벨만(설명 바로 아래), dsc3 = 트리에서만(시너지 "%s Receives Bonuses From:")
//   https://d2mods.info/forum/viewtopic.php?t=29920 , https://d2mods.info/forum/kb/viewarticle?a=370
// 출처(문자열): StrSkill1 "Next Level", StrSkill2 "Current Skill Level: ", StrSkill17 "First Level", StrSkill3 "Mana Cost: ", StrSkill4~8 "(Fire/Cold/Lightning/Poison) Damage: ",
//   StrSkill10 "To Attack Rating: ", StrSkill15/16 " second(s)", StrSkill20 "Duration: ", StrSkill23 " percent", StrSkill26 " yards", StrSkill34 " per second",
//   StrSkill39 "Magic Damage: ", StrSkill42 "Life: ", StrSkill63 "over ", StrSkill68 "Average "
// 근사(원작 미확인): desc 줄 순서(원작 글이 아래→위로 쌓이는 것에 맞춰 descline 큰 번호가 위), 값이 0 인 자동 줄(8·9·10·11)은 숨김,
//   23·28·29·30·34·45·49·50 (missiles.txt/monstats 를 읽는 줄)은 생략, 43 은 C/256, 마나 소수 첫째 자리까지, 시너지 머리줄 색 = calca 색 번호
import type { TxtRow } from '../formats/txt';
import { parseCalc } from '../engine/skills/calc';
import type { SkillCalc, SkillOwner } from '../engine/skills/formulas';
import type { SkillRecord } from '../engine/skills/db';
import type { TextColorName } from '../formats/pl2';

export interface TipLine { text: string; color: TextColorName }

/** 원작 글자 색 번호 (0 흰 1 빨강 2 초록 3 파랑 4 금색 5 회색 6 검정 7 황갈 8 주황 9 노랑) */
const COLOR_BY_NO: TextColorName[] = ['white', 'red', 'green', 'blue', 'gold', 'grey', 'black', 'tan', 'orange', 'yellow'] as TextColorName[];

const num = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export interface SkillTipDeps {
  calc: SkillCalc;
  /** 지금 캐릭터 (레벨이 바뀌므로 부를 때마다) */
  owner: () => SkillOwner;
  str: (k: string) => string;
}

export interface SkillTipLines { dsc2: TipLine[]; level: TipLine[]; dsc3: TipLine[] }

export class SkillTip {
  private readonly d: SkillTipDeps;
  private readonly cache = new Map<string, ReturnType<typeof parseCalc>>();

  constructor(d: SkillTipDeps) {
    this.d = d;
  }

  private c(s: SkillRecord, src: string | undefined, lvl: number): number {
    if (!src) return 0;
    let node = this.cache.get(src);
    if (node === undefined) {
      node = parseCalc(src);
      this.cache.set(src, node);
    }
    return Math.trunc(this.d.calc.eval(s, node, lvl, this.d.owner()));
  }

  private s(k: string | undefined): string {
    return k ? this.d.str(k) : '';
  }

  private secs(frames: number): string {
    const v = frames / 25;
    return `${num(v)}${this.s(v === 1 ? 'StrSkill15' : 'StrSkill16')}`;
  }

  private elemLabel(eType: string): string {
    return this.s({ fire: 'StrSkill5', cold: 'StrSkill6', ltng: 'StrSkill7', pois: 'StrSkill8', mag: 'StrSkill39' }[eType] ?? 'StrSkill4');
  }

  /** 한 줄 (없으면 null) */
  line(s: SkillRecord, row: TxtRow, pre: 'desc' | 'dsc2' | 'dsc3', i: number, lvl: number): TipLine | null {
    const type = Number(row[pre === 'desc' ? `descline${i}` : `${pre}line${i}`] ?? 0);
    if (!type) return null;
    const S1 = this.s(row[`${pre}texta${i}`]), S2 = this.s(row[`${pre}textb${i}`]);
    const ca = row[`${pre}calca${i}`], cb = row[`${pre}calcb${i}`];
    const C1 = this.c(s, ca, lvl), C2 = this.c(s, cb, lvl);
    const calc = this.d.calc, o = this.d.owner();
    const w = (text: string, color: TextColorName = 'white'): TipLine => ({ text, color });
    switch (type) {
      case 2: return w(`${S1}+${C1}${S2}`);
      case 3: return w(`${S1}${C1}${S2}`);
      case 4: return w(`${S1}+${C1}`);
      case 5: return w(`${S1}${C1}`);
      case 6: return w(`+${C1}${S1}`);
      case 7: return w(`${C1}${S1}`);
      case 8: {
        const th = calc.toHit(s, lvl, o);
        return th ? w(`${this.s('StrSkill10')}+${th}${this.s('StrSkill23')}`) : null;
      }
      case 9: return cb ? w(`${S1}${S2}${this.s('StrSkill4')}+${C2}`) : null;
      case 10: {
        if (!s.eType || s.eType === 'pois') return null;
        const lo = calc.minElem256(s, lvl, o, false) >> 8, hi = calc.maxElem256(s, lvl, o, false) >> 8;
        return hi > 0 ? w(`${this.elemLabel(s.eType)}${lo}-${hi}`) : null;
      }
      case 11: {
        const lo = calc.minPhys256(s, lvl, o) >> 8, hi = calc.maxPhys256(s, lvl, o) >> 8;
        return hi > 0 ? w(`${this.s('StrSkill4')}${lo}-${hi}`) : null;
      }
      case 12: case 31: return w(`${S1}${this.secs(C1)}`);
      case 13: return w(`${this.s('StrSkill42')}${C1}`);
      case 14: {
        if (s.eType !== 'pois') return null;
        const len = calc.elemLength(s, lvl, o);
        const lo = Math.floor((calc.minElem256(s, lvl, o, false) * len) / 65536), hi = Math.floor((calc.maxElem256(s, lvl, o, false) * len) / 65536);
        return w(`${this.s('StrSkill8')}${lo}-${hi} ${this.s('StrSkill63')}${this.secs(len)}`);
      }
      case 15: return w(`${S1}:${S2}`);
      case 16: return w(`${this.s('StrSkill20')}${num(C1 / 25)}-${num(C2 / 25)}${this.s('StrSkill16')}`);
      case 17: return w(`${S2}${S1}${C1}-${C2}${this.s('StrSkill34')}`);
      case 18: case 46: case 51: case 74: case 75: return S1 ? w(S1.replace('%d', String(C1))) : null;
      case 19: case 37: return w(`${S1}${num((C1 * 2) / 3)}${this.s('StrSkill26')}`);
      case 20: return w(`${S1}+${C1}${this.s('StrSkill23')}${S2}`);
      case 21: return w(`${S1}${C1}${this.s('StrSkill23')}${S2}`);
      case 22: case 26: case 27: {
        const et = type === 26 ? s.eType : 'fire';
        const lo = Math.floor((calc.minElem256(s, lvl, o, false) * 25) / 256), hi = Math.floor((calc.maxElem256(s, lvl, o, false) * 25) / 256);
        return hi > 0 ? w(`${this.s('StrSkill68')}${this.elemLabel(et)}${lo}-${hi}${this.s('StrSkill34')}`) : null;
      }
      case 24: return ca ? w(`${S1}${Math.floor(C1 / 2)}-${Math.floor(C2 / 2)}`) : null;
      case 25: case 33: return w(`${S1}${S2}`);
      case 32: return w(`${S1}${S2}+${C1}${this.s('StrSkill23')}`);
      case 35: return w(`${S1}: ${C1}-${C2}`);
      case 36: return w(`${C1}${C1 === 1 ? S1 : S2}`);
      case 38: return w(`${S1}${C1}-${C2}${S2}`);
      case 40: return w(S1.replace('%s', S2), COLOR_BY_NO[Number(ca ?? 0)] ?? 'white');
      case 41: return w(`${this.s('StrSkill5')}${C1}-${C2}`);
      case 43: case 44: return w(`${S1}${Math.floor(C1 / 256)}-${Math.floor(C2 / 256)}${S2}`);
      case 47: return w(`${S1}+${C1}-${C2}`);
      case 48: {
        const lo = calc.minElem256(s, lvl, o, false) >> 8, hi = calc.maxElem256(s, lvl, o, false) >> 8;
        return hi > 0 ? w(`${this.s('StrSkill39')}${lo}-${hi}`) : null;
      }
      case 52: return w(`${S1}+${C1}-${C2}${S2}`);
      case 57: return w(`${S1}+${this.secs(C1)}`);
      case 58: return w(`${S1}${S2}+${C1}-${C2}`);
      case 59: return w(`${S2}${S1}${C1}-${C2}`);
      case 60: return w(`${S1}+${num(C1 / 256)}${S2}`);
      case 61: return w(`${S1}${num(C1 / 256)}${S2}`);
      case 62: return w(`${S1}${S2}${C1}-${C2}`);
      case 63: return w(`${S1}: +${C1}% ${S2}`);
      case 64: return C1 ? w(`${S1}: +${C1}/${C2} ${S2}`) : null;
      case 65: case 71: return w(`${S1}: ${S2}`);
      case 66: return w(S1.replace('%d', String(C1)).replace('%%', '%'));
      case 67: return C1 ? w(`${S1}: +${C1} ${S2}`) : null;
      case 68: return w(`${C1}${S1}${S2}`);
      case 69: return w(`${S1}: ${S2} ${C1}`);
      case 70: return w(`${S1}${S2}+${C1}`);
      case 72: return w(`+${C1}/${C2} ${S1}`);
      case 73: return w(`${C1}/${C2} ${S1}`);
      default: return null;
    }
  }

  private block(s: SkillRecord, row: TxtRow, pre: 'desc' | 'dsc2' | 'dsc3', lvl: number, n: number): TipLine[] {
    const out: TipLine[] = [];
    for (let i = 1; i <= n; i++) {
      const l = this.line(s, row, pre, i, lvl);
      if (l && l.text.trim()) out.push(l);
    }
    return out;
  }

  /** 마나 소모 줄 (skilldesc "str mana" 가 있고 소모가 있을 때) */
  private mana(s: SkillRecord, row: TxtRow, lvl: number): TipLine[] {
    const key = row['str mana'];
    if (!key || lvl <= 0) return [];
    const m = this.d.calc.manaCost256(s, lvl) / 256;
    return m > 0 ? [{ text: `${this.s(key)}${num(Math.floor(m * 10) / 10)}`, color: 'white' }] : [];
  }

  private levelLines(s: SkillRecord, row: TxtRow, lvl: number): TipLine[] {
    // 원작 줄 순서: descline 1 이 아래 (근사) — 마나가 맨 아래
    return [...this.block(s, row, 'desc', lvl, 6).reverse(), ...this.mana(s, row, lvl)];
  }

  lines(s: SkillRecord, row: TxtRow | undefined, lvl: number): SkillTipLines {
    if (!row) return { dsc2: [], level: [], dsc3: [] };
    const level: TipLine[] = [];
    if (lvl <= 0) {
      level.push({ text: this.s('StrSkill17'), color: 'white' }, ...this.levelLines(s, row, 1));
    } else {
      level.push({ text: `${this.s('StrSkill2')}${lvl}`, color: 'white' }, ...this.levelLines(s, row, lvl));
      if (!s.maxLvl || lvl < s.maxLvl) level.push({ text: '', color: 'white' }, { text: this.s('StrSkill1'), color: 'white' }, ...this.levelLines(s, row, lvl + 1));
    }
    return { dsc2: this.block(s, row, 'dsc2', Math.max(1, lvl), 5), level, dsc3: this.block(s, row, 'dsc3', Math.max(1, lvl), 7) };
  }
}
