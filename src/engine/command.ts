// 입력은 오직 명령(Command) 객체로 엔진에 전달된다 (DOM 이벤트 → input/mapper.ts → Command).

export type ItemLocation =
  | { kind: 'inventory'; x: number; y: number }
  | { kind: 'stash'; x: number; y: number }
  | { kind: 'equip'; slot: string }
  | { kind: 'belt'; slot: number }
  | { kind: 'ground' }
  | { kind: 'cursor' }
  /** 소켓 아이템에 보석 박기 (대상 아이템 Id) */
  | { kind: 'socket'; itemId: number };

export type Command =
  | { type: 'move'; x: number; y: number; run: boolean }
  | { type: 'attack'; targetId: number; standStill: boolean }
  | { type: 'useSkill'; skill: number; hand: 'left' | 'right'; x: number; y: number; targetId?: number; targetItem?: number }
  | { type: 'pickup'; itemId: number }
  | { type: 'interact'; unitId: number }
  | { type: 'useBelt'; slot: number }
  | { type: 'moveItem'; itemId: number; to: ItemLocation }
  /** 인벤토리·벨트 아이템 사용 (물약 마시기, 두루마리 읽기 — 원작 우클릭) */
  | { type: 'useItem'; itemId: number }
  | { type: 'spendStat'; stat: 'str' | 'dex' | 'vit' | 'ene' }
  | { type: 'spendSkill'; skill: number }
  | { type: 'setSkill'; hand: 'left' | 'right'; skill: number }
  | { type: 'saveAndExit' };
