// 최소 스킬 트리(T)·캐릭터(C) 패널 (DOM). 원작 DC6 패널은 Phase 11 에서 교체.
// 원작 조작: 스킬 트리에서 + 로 포인트 투자, 스킬 선택은 원작의 S(스킬 선택) 대신 여기서 클릭 = 오른쪽, Shift+클릭 = 왼쪽.
import type { Character, StatName } from '../engine/player';
import type { SkillDb, SkillRecord } from '../engine/skills/db';
import { learnError } from '../engine/skills/rules';

const CSS = `
.d2skills{position:absolute;top:20px;left:20px;width:620px;background:rgba(10,8,6,.94);border:1px solid #6b5a3a;color:#c7b377;font:13px serif;padding:10px;display:none}
.d2skills h2{margin:0 0 6px;font-size:18px;color:#e8d8a8}
.d2skills .cols{display:flex;gap:8px}
.d2skills .col{flex:1}
.d2skills .col h3{margin:4px 0;font-size:14px;color:#e8d8a8}
.d2skills .sk{display:flex;align-items:center;gap:4px;padding:2px 3px;cursor:pointer;border:1px solid transparent}
.d2skills .sk:hover{border-color:#6b5a3a}
.d2skills .sk.off{color:#6d6250}
.d2skills .sk .nm{flex:1}
.d2skills .sk .mk{color:#ffd700;font-size:11px;min-width:20px}
.d2skills button{background:#1a1410;border:1px solid #6b5a3a;color:#c7b377;font:13px serif;padding:0 6px;cursor:pointer}
.d2skills button:disabled{opacity:.3;cursor:default}
.d2char{position:absolute;top:20px;left:20px;width:300px;background:rgba(10,8,6,.94);border:1px solid #6b5a3a;color:#c7b377;font:14px serif;padding:10px;display:none}
.d2char h2{margin:0 0 6px;font-size:18px;color:#e8d8a8}
.d2char .row{display:flex;justify-content:space-between;align-items:center;margin:3px 0}
.d2char button{background:#1a1410;border:1px solid #6b5a3a;color:#c7b377;font:13px serif;padding:0 6px;cursor:pointer}
`;

// 원작 스킬 트리 탭 이름 (skilldesc SkillPage 1~3). 출처: The Arreat Summit 클래스별 스킬 트리
const TABS: Record<string, [string, string, string]> = {
  ama: ['Bow and Crossbow', 'Passive and Magic', 'Javelin and Spear'],
  sor: ['Fire Spells', 'Lightning Spells', 'Cold Spells'],
  nec: ['Curses', 'Poison and Bone', 'Summoning'],
  pal: ['Combat Skills', 'Offensive Auras', 'Defensive Auras'],
  bar: ['Combat Skills', 'Combat Masteries', 'Warcries'],
};

export interface SkillPanelDeps {
  db: SkillDb;
  character: () => Character;
  learn: (id: number) => void;
  setSkill: (hand: 'left' | 'right', id: number) => void;
  canSelect: (s: SkillRecord, hand: 'left' | 'right') => boolean;
  spendStat: (stat: StatName) => void;
}

export class SkillPanels {
  readonly skills: HTMLElement;
  readonly char: HTMLElement;
  private readonly deps: SkillPanelDeps;
  private lastSkills = '';
  private lastChar = '';

  constructor(host: HTMLElement, deps: SkillPanelDeps) {
    this.deps = deps;
    if (!document.getElementById('d2skills-css')) {
      const st = document.createElement('style');
      st.id = 'd2skills-css';
      st.textContent = CSS;
      document.head.append(st);
    }
    this.skills = document.createElement('div');
    this.skills.className = 'd2skills';
    this.skills.id = 'skilltree';
    this.char = document.createElement('div');
    this.char.className = 'd2char';
    this.char.id = 'charpanel';
    this.skills.addEventListener('click', (e) => this.onSkillClick(e));
    this.char.addEventListener('click', (e) => {
      const stat = (e.target as HTMLElement).closest<HTMLElement>('[data-stat]')?.dataset.stat;
      if (stat) this.deps.spendStat(stat as StatName);
    });
    host.append(this.skills, this.char);
  }

  get open(): boolean {
    return this.skills.style.display === 'block' || this.char.style.display === 'block';
  }

  toggleSkills(): void {
    const show = this.skills.style.display !== 'block';
    this.skills.style.display = show ? 'block' : 'none';
    if (show) this.char.style.display = 'none';
    this.lastSkills = '';
  }

  toggleChar(): void {
    const show = this.char.style.display !== 'block';
    this.char.style.display = show ? 'block' : 'none';
    if (show) this.skills.style.display = 'none';
    this.lastChar = '';
  }

  private onSkillClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    const learn = el.closest<HTMLElement>('[data-learn]')?.dataset.learn;
    if (learn) {
      this.deps.learn(Number(learn));
      return;
    }
    const pick = el.closest<HTMLElement>('[data-skill]')?.dataset.skill;
    if (pick === undefined) return;
    const s = this.deps.db.byId.get(Number(pick));
    const hand = e.shiftKey ? 'left' : 'right';
    if (s && this.deps.canSelect(s, hand)) this.deps.setSkill(hand, s.id);
  }

  render(): void {
    const ch = this.deps.character();
    if (this.skills.style.display === 'block') {
      const key = JSON.stringify([ch.skills, ch.skillPoints, ch.level, ch.leftSkill, ch.rightSkill]);
      if (key !== this.lastSkills) {
        this.lastSkills = key;
        this.skills.innerHTML = this.skillsHtml(ch);
      }
    }
    if (this.char.style.display === 'block') {
      const key = JSON.stringify([ch.str, ch.dex, ch.vit, ch.ene, ch.statPoints, ch.level, Math.floor(ch.life), Math.floor(ch.mana), ch.experience]);
      if (key !== this.lastChar) {
        this.lastChar = key;
        this.char.innerHTML = this.charHtml(ch);
      }
    }
  }

  private skillsHtml(ch: Character): string {
    const db = this.deps.db;
    const list = db.classSkills(ch.cls);
    const code = list[0]?.charclass ?? '';
    const general = [0, 2].map((id) => db.byId.get(id)).filter((s): s is SkillRecord => !!s);
    const row = (s: SkillRecord) => {
      const lvl = s.id <= 5 ? 1 : (ch.skills[s.id] ?? 0);
      const err = s.id <= 5 ? 'general' : learnError(ch, s, db);
      const mk = `${ch.leftSkill === s.id ? 'L' : ''}${ch.rightSkill === s.id ? 'R' : ''}`;
      const plus = s.id > 5 ? `<button data-learn="${s.id}" ${err ? 'disabled' : ''} title="${err ?? ''}">+</button>` : '';
      return `<div class="sk${lvl ? '' : ' off'}" data-skill="${s.id}" id="skill-${s.id}"><span class="mk">${mk}</span><span class="nm">${s.displayName}${s.passive ? ' (P)' : ''}</span><span>${s.id > 5 ? `${lvl} / Lv${s.reqLevel}` : ''}</span>${plus}</div>`;
    };
    const cols = [1, 2, 3]
      .map((page, i) => `<div class="col"><h3>${TABS[code]?.[i] ?? `Tab ${page}`}</h3>${list.filter((s) => s.page === page).map(row).join('')}</div>`)
      .join('');
    return `<h2>Skills — Points: <span id="skill-points">${ch.skillPoints}</span></h2><div style="margin-bottom:4px">클릭 = 오른쪽 버튼, Shift+클릭 = 왼쪽 버튼</div>${general.map(row).join('')}<div class="cols">${cols}</div>`;
  }

  private charHtml(ch: Character): string {
    const stat = (label: string, key: StatName, v: number) =>
      `<div class="row"><span>${label}</span><span>${v} ${ch.statPoints > 0 ? `<button data-stat="${key}" id="stat-${key}">+</button>` : ''}</span></div>`;
    return (
      `<h2>${ch.cls} — Level ${ch.level}</h2>` +
      `<div class="row"><span>Experience</span><span>${ch.experience}</span></div>` +
      stat('Strength', 'str', ch.str) + stat('Dexterity', 'dex', ch.dex) + stat('Vitality', 'vit', ch.vit) + stat('Energy', 'ene', ch.ene) +
      `<div class="row"><span>Stat Points</span><span id="stat-points">${ch.statPoints}</span></div>` +
      `<div class="row"><span>Life</span><span>${Math.floor(ch.life)} / ${Math.floor(ch.maxLife)}</span></div>` +
      `<div class="row"><span>Mana</span><span>${Math.floor(ch.mana)} / ${Math.floor(ch.maxMana)}</span></div>` +
      `<div class="row"><span>Stamina</span><span>${Math.floor(ch.stamina)} / ${Math.floor(ch.maxStamina)}</span></div>`
    );
  }

  dispose(): void {
    this.skills.remove();
    this.char.remove();
  }
}
