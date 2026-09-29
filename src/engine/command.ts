// 입력은 오직 명령(Command) 객체로 엔진에 전달된다 (DOM 이벤트 → input/mapper.ts → Command).

export type ItemLocation =
  | { kind: 'inventory'; x: number; y: number }
  | { kind: 'equip'; slot: string }
  | { kind: 'belt'; slot: number }
  | { kind: 'ground' }
  | { kind: 'cursor' };

export type Command =
  | { type: 'move'; x: number; y: number; run: boolean }
  | { type: 'attack'; targetId: number; standStill: boolean }
  | { type: 'useSkill'; skill: number; hand: 'left' | 'right'; x: number; y: number; targetId?: number }
  | { type: 'pickup'; itemId: number }
  | { type: 'interact'; unitId: number }
  | { type: 'useBelt'; slot: number }
  | { type: 'moveItem'; itemId: number; to: ItemLocation }
  | { type: 'spendStat'; stat: 'str' | 'dex' | 'vit' | 'ene' }
  | { type: 'spendSkill'; skill: number }
  | { type: 'setSkill'; hand: 'left' | 'right'; skill: number }
  | { type: 'saveAndExit' };
