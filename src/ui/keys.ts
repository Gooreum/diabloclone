// 단축키 설정 (원작 게임 메뉴 OPTIONS → CONFIGURE CONTROLS): 기능별 키, 브라우저 localStorage 에 저장.
// 출처(문자열): string.tbl CfgCharacter "Character Screen", CfgInventory, CfgSkillTree, CfgQuestLog, CfgAutoMap, CfgMiniMap "Micromap", CfgRunLock "Toggle Run/Walk",
//   CfgSkillPick "Skill Speed Bar", CfgBelt1~4 "Use Belt 1~4", CfgBeltShow "Show Belt", CfgShowItems "Show Items", Cfgcleartextmsg "Clear Messages", 키 이름 KeyTab·KeyMenu(Alt)·KeySpace …
// 출처(기본 키): 원작 기본 단축키 C·I·T·Q·Tab·R·S·1~4·~·Alt (Diablo II 매뉴얼 Controls)
// 근사(원작 미확인): 원작은 기능마다 키 두 개(Key/Button One·Two) — 여기서는 하나만, Micromap 기본 키 V, Clear Messages 기본 키 N
// 출처: string.tbl CfgSkill1~8 "Skill 1~8", 원작 기본 키 F1~F8 (스킬 단축키)
// 출처: 확장팩 string Cfgswapweapons "Swap Weapons", 원작 확장팩 기본 키 W (확장팩 캐릭터만 동작)
// 출처: 확장팩 string Cfghireling "Hireling Screen", 원작 확장팩 기본 키 O (용병 창 — 확장팩만 동작)
export const SKILL_SLOTS = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'skill6', 'skill7', 'skill8'] as const;
export type SkillSlot = (typeof SKILL_SLOTS)[number];
export const KEY_ACTIONS = ['char', 'inv', 'tree', 'quest', 'automap', 'minimap', 'run', 'skillpick', 'belt1', 'belt2', 'belt3', 'belt4', 'beltshow', 'showitems', 'clearmsg', 'swap', 'hireling', ...SKILL_SLOTS] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

export const KEY_LABEL: Record<KeyAction, string> = {
  char: 'CfgCharacter', inv: 'CfgInventory', tree: 'CfgSkillTree', quest: 'CfgQuestLog', automap: 'CfgAutoMap', minimap: 'CfgMiniMap', run: 'CfgRunLock',
  skillpick: 'CfgSkillPick', belt1: 'CfgBelt1', belt2: 'CfgBelt2', belt3: 'CfgBelt3', belt4: 'CfgBelt4', beltshow: 'CfgBeltShow', showitems: 'CfgShowItems', clearmsg: 'Cfgcleartextmsg', swap: 'Cfgswapweapons', hireling: 'Cfghireling',
  skill1: 'CfgSkill1', skill2: 'CfgSkill2', skill3: 'CfgSkill3', skill4: 'CfgSkill4', skill5: 'CfgSkill5', skill6: 'CfgSkill6', skill7: 'CfgSkill7', skill8: 'CfgSkill8',
};

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  char: 'C', inv: 'I', tree: 'T', quest: 'Q', automap: 'Tab', minimap: 'V', run: 'R', skillpick: 'S',
  belt1: '1', belt2: '2', belt3: '3', belt4: '4', beltshow: '`', showitems: 'Alt', clearmsg: 'N', swap: 'W', hireling: 'O',
  skill1: 'F1', skill2: 'F2', skill3: 'F3', skill4: 'F4', skill5: 'F5', skill6: 'F6', skill7: 'F7', skill8: 'F8',
};

/** 키 이름 → string.tbl 키 (한 글자는 그대로 대문자) */
const NAMED: Record<string, string> = {
  Tab: 'KeyTab', Alt: 'KeyMenu', ' ': 'KeySpace', Shift: 'KeyShift', Control: 'KeyControl', Enter: 'KeyReturn', Backspace: 'KeyBack', Delete: 'KeyDelete', Insert: 'KeyInsert',
  F1: 'KeyF1', F2: 'KeyF2', F3: 'KeyF3', F4: 'KeyF4', F5: 'KeyF5', F6: 'KeyF6', F7: 'KeyF7', F8: 'KeyF8',
  Home: 'KeyHome', End: 'KeyEnd', PageUp: 'KeyPrior', PageDown: 'KeyNext', ArrowUp: 'KeyUp', ArrowDown: 'KeyDown', ArrowLeft: 'KeyLeft', ArrowRight: 'KeyRight', '`': 'KeyTilde',
};

/** 키 이벤트에서 쓰는 값 (KeyboardEvent 의 일부) */
export interface KeyEv { key: string; code?: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean }

/** 혼자서는 단축키가 될 수 없는 키 (맥 ⌘, Caps Lock, 한글 입력 조합 중 'Process', 알 수 없는 키) — 단축키 바꾸기에서 무시하고 다음 키를 기다린다 */
export const UNBINDABLE_KEYS: ReadonlySet<string> = new Set(['FnLock', 'Meta', 'OS', 'Hyper', 'Super', 'CapsLock', 'Process', 'Unidentified']);
/** 누르고 있는 동안 다른 키와 조합하는 키 (단축키 바꾸기에서 혼자 눌렀다 떼면 그 키 하나로 배정) */
export const HOLD_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Fn']);
// 원작과 다름(사용자 요청): 원작 단축키는 키 하나 — 여기서는 Shift·Ctrl·Alt 조합 ('Shift+F1') 도 배정할 수 있다 (맥북은 F키가 밝기 키라 조합으로)
/** 조합 이름 앞에 붙는 수식 키 (순서 고정) */
const MOD_FLAGS = [['Control', 'ctrlKey'], ['Alt', 'altKey'], ['Shift', 'shiftKey']] as const;
const MOD_SHORT: Record<string, string> = { Control: 'C', Alt: 'A', Shift: 'S' };

const STORE_KEY = 'd2clone.keys';

/** 키 하나 이름 (글자는 대문자, ~ 와 ` 는 같은 키). 글자·숫자는 물리 키(code) — Shift+1 의 '!', 맥 Option+Z 의 'Ω', 한글 입력 중 'Process' 대신 '1'·'Z' */
export function baseKeyName(e: KeyEv): string {
  // Shift + 숫자 (확장팩 Shift+벨트 = 용병에게 물약): '!' 대신 눌린 숫자 키로
  if (e.code && /^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (e.code && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  const k = e.key;
  if (k === '~' || k === '`') return '`';
  if (k === 'Dead') return '`';
  return k.length === 1 ? k.toUpperCase() : k;
}

/** 이벤트 → 저장용 키 이름. Shift·Ctrl·Alt 를 누르고 있으면 조합 ('Shift+F1', 'Control+Alt+Z'), 수식 키 자체는 혼자 ('Shift', 'Alt') */
export function keyName(e: KeyEv): string {
  const b = baseKeyName(e);
  if (b === 'Shift' || b === 'Control' || b === 'Alt') return b;
  return [...MOD_FLAGS.filter(([, f]) => e[f]).map(([n]) => n), b].join('+');
}

/** 저장 이름 → [수식 키들, 키] ('Shift++' 처럼 키가 '+' 여도) */
function splitCombo(key: string): [string[], string] {
  const mods: string[] = [];
  let rest = key;
  for (;;) {
    const m = MOD_FLAGS.find(([n]) => rest.startsWith(`${n}+`) && rest.length > n.length + 1);
    if (!m) return [mods, rest];
    mods.push(m[0]);
    rest = rest.slice(m[0].length + 1);
  }
}

export class KeyBindings {
  map: Record<KeyAction, string> = { ...DEFAULT_KEYS };

  constructor() {
    this.load();
  }

  load(): void {
    try {
      const raw = globalThis.localStorage?.getItem(STORE_KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as Partial<Record<KeyAction, string>>;
      for (const a of KEY_ACTIONS) if (typeof v[a] === 'string') this.map[a] = v[a];
    } catch {
      // 저장소를 못 쓰면 기본 키
    }
  }

  save(): void {
    try {
      globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(this.map));
    } catch {
      // 사생활 보호 창 등: 이번 판에서만 유지
    }
  }

  /** 키 하나를 기능에 — 같은 키를 쓰던 다른 기능은 비운다 (원작: 한 키는 한 기능) */
  set(action: KeyAction, key: string): void {
    for (const a of KEY_ACTIONS) if (a !== action && this.map[a] === key) this.map[a] = '';
    this.map[action] = key;
  }

  reset(): void {
    this.map = { ...DEFAULT_KEYS };
  }

  actionOf(e: KeyEv): KeyAction | null {
    const find = (k: string) => KEY_ACTIONS.find((a) => this.map[a] === k) ?? null;
    const full = keyName(e);
    const hit = find(full);
    if (hit) return hit;
    // 조합에 배정된 기능이 없으면 키 하나로 (Shift+1 = 벨트 1 → 용병 물약, Shift 누른 채 R = 달리기)
    const b = baseKeyName(e);
    return full === b || HOLD_KEYS.has(b) ? null : find(b);
  }

  is(e: KeyEv, a: KeyAction): boolean {
    return !!this.map[a] && this.actionOf(e) === a;
  }

  /** 화면에 보일 키 이름 (string.tbl). short = 스킬 아이콘 구석처럼 좁은 곳 ('S+F1') */
  label(key: string, str: (k: string) => string, short = false): string {
    if (!key) return str('KeyNone');
    const one = (k: string) => {
      const s = NAMED[k];
      return s ? str(s) : k;
    };
    const [mods, k] = splitCombo(key);
    return [...mods.map((m) => (short ? MOD_SHORT[m]! : one(m))), one(k)].join('+');
  }
}

/** 게임 전체가 쓰는 단축키 (옵션에서 바꾸면 곧바로 적용) */
export const keyBindings = new KeyBindings();
