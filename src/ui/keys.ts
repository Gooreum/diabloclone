// 단축키 설정 (원작 게임 메뉴 OPTIONS → CONFIGURE CONTROLS): 기능별 키, 브라우저 localStorage 에 저장.
// 출처(문자열): string.tbl CfgCharacter "Character Screen", CfgInventory, CfgSkillTree, CfgQuestLog, CfgAutoMap, CfgMiniMap "Micromap", CfgRunLock "Toggle Run/Walk",
//   CfgSkillPick "Skill Speed Bar", CfgBelt1~4 "Use Belt 1~4", CfgBeltShow "Show Belt", CfgShowItems "Show Items", Cfgcleartextmsg "Clear Messages", 키 이름 KeyTab·KeyMenu(Alt)·KeySpace …
// 출처(기본 키): 원작 기본 단축키 C·I·T·Q·Tab·R·S·1~4·~·Alt (Diablo II 매뉴얼 Controls)
// 근사(원작 미확인): 원작은 기능마다 키 두 개(Key/Button One·Two) — 여기서는 하나만, Micromap 기본 키 V, Clear Messages 기본 키 N
// 출처: string.tbl CfgSkill1~8 "Skill 1~8", 원작 기본 키 F1~F8 (스킬 단축키)
// 출처: 확장팩 string Cfgswapweapons "Swap Weapons", 원작 확장팩 기본 키 W (확장팩 캐릭터만 동작)
export const SKILL_SLOTS = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'skill6', 'skill7', 'skill8'] as const;
export type SkillSlot = (typeof SKILL_SLOTS)[number];
export const KEY_ACTIONS = ['char', 'inv', 'tree', 'quest', 'automap', 'minimap', 'run', 'skillpick', 'belt1', 'belt2', 'belt3', 'belt4', 'beltshow', 'showitems', 'clearmsg', 'swap', ...SKILL_SLOTS] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

export const KEY_LABEL: Record<KeyAction, string> = {
  char: 'CfgCharacter', inv: 'CfgInventory', tree: 'CfgSkillTree', quest: 'CfgQuestLog', automap: 'CfgAutoMap', minimap: 'CfgMiniMap', run: 'CfgRunLock',
  skillpick: 'CfgSkillPick', belt1: 'CfgBelt1', belt2: 'CfgBelt2', belt3: 'CfgBelt3', belt4: 'CfgBelt4', beltshow: 'CfgBeltShow', showitems: 'CfgShowItems', clearmsg: 'Cfgcleartextmsg', swap: 'Cfgswapweapons',
  skill1: 'CfgSkill1', skill2: 'CfgSkill2', skill3: 'CfgSkill3', skill4: 'CfgSkill4', skill5: 'CfgSkill5', skill6: 'CfgSkill6', skill7: 'CfgSkill7', skill8: 'CfgSkill8',
};

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  char: 'C', inv: 'I', tree: 'T', quest: 'Q', automap: 'Tab', minimap: 'V', run: 'R', skillpick: 'S',
  belt1: '1', belt2: '2', belt3: '3', belt4: '4', beltshow: '`', showitems: 'Alt', clearmsg: 'N', swap: 'W',
  skill1: 'F1', skill2: 'F2', skill3: 'F3', skill4: 'F4', skill5: 'F5', skill6: 'F6', skill7: 'F7', skill8: 'F8',
};

/** 키 이름 → string.tbl 키 (한 글자는 그대로 대문자) */
const NAMED: Record<string, string> = {
  Tab: 'KeyTab', Alt: 'KeyMenu', ' ': 'KeySpace', Shift: 'KeyShift', Control: 'KeyControl', Enter: 'KeyReturn', Backspace: 'KeyBack', Delete: 'KeyDelete', Insert: 'KeyInsert',
  F1: 'KeyF1', F2: 'KeyF2', F3: 'KeyF3', F4: 'KeyF4', F5: 'KeyF5', F6: 'KeyF6', F7: 'KeyF7', F8: 'KeyF8',
  Home: 'KeyHome', End: 'KeyEnd', PageUp: 'KeyPrior', PageDown: 'KeyNext', ArrowUp: 'KeyUp', ArrowDown: 'KeyDown', ArrowLeft: 'KeyLeft', ArrowRight: 'KeyRight', '`': 'KeyTilde',
};

const STORE_KEY = 'd2clone.keys';

/** 이벤트 → 저장용 키 이름 (글자는 대문자, ~ 와 ` 는 같은 키) */
export function keyName(e: { key: string }): string {
  const k = e.key;
  if (k === '~' || k === '`') return '`';
  if (k === 'Dead') return '`';
  return k.length === 1 ? k.toUpperCase() : k;
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

  actionOf(e: { key: string }): KeyAction | null {
    const k = keyName(e);
    return KEY_ACTIONS.find((a) => this.map[a] === k) ?? null;
  }

  is(e: { key: string }, a: KeyAction): boolean {
    return !!this.map[a] && this.map[a] === keyName(e);
  }

  label(key: string, str: (k: string) => string): string {
    if (!key) return str('KeyNone');
    const s = NAMED[key];
    return s ? str(s) : key;
  }
}

/** 게임 전체가 쓰는 단축키 (옵션에서 바꾸면 곧바로 적용) */
export const keyBindings = new KeyBindings();
