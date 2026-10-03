// 내구도·수량 경고 (원작 화면 오른쪽 위 아이콘, data\global\ui\PANEL\invwarn.DC6).
// 출처: Arreat Summit "When an item's Durability is low, a silhouette appears in the upper right corner of the Play Area …
//       Items with low Durability will appear in yellow. A red item has 0 Durability" ·
//       Amazon Basin wiki Durability "< 21% of their maximum displayed Durability".
// 서버(D2MOO ITEMS_UpdateDurability·sub_6FC4B580)는 BROKEN 플래그·내구도 0·소리만 보내고 그리기는 클라이언트 몫이라
// 아래 좌표·종류 순서는 원작 DC6 그림을 읽어 복원했다.
import type { ItemBase, ItemDb } from '../engine/items';
import type { ItemStore } from '../engine/itemstore';
import type { BodyLoc } from '../engine/inventory';
import { isBroken } from '../engine/price';

/** invwarn.DC6 프레임 = kind*3 + level. 종류 순서는 원작 DC6 그림으로 읽음 (24 프레임 = 8 종류 × 3 색) */
export const WARN_KIND = { arrows: 0, bolts: 1, tpot: 2, throw: 3, weapon: 4, shield: 5, armor: 6, helm: 7 } as const;
/** 0 노랑(낮음) · 2 빨강(부서짐). 1 주황은 원작 기준을 못 찾아 쓰지 않는다 (미확인) */
export type WarnLevel = 0 | 2;
export interface InvWarning { slot: BodyLoc; frame: number; level: WarnLevel }
/** 경고가 켜지는 비율: 최대의 21% 미만 (Amazon Basin) */
export const WARN_PCT = 21;
/** 원작 DC6 에 종류가 있는 부위만 (벨트·신발·장갑·반지·목걸이 아이콘은 없다) */
const WARN_SLOTS: BodyLoc[] = ['head', 'tors', 'rarm', 'larm'];

/** 아이템 종류 → DC6 종류 번호 (없으면 null) */
export function warnKind(items: ItemDb, b: ItemBase): number | null {
  if (items.isType(b, 'bowq')) return WARN_KIND.arrows;
  if (items.isType(b, 'xboq')) return WARN_KIND.bolts;
  if (b.type === 'tpot') return WARN_KIND.tpot;
  if (items.isType(b, 'shld')) return WARN_KIND.shield;
  if (items.isType(b, 'helm')) return WARN_KIND.helm;
  if (items.isType(b, 'tors')) return WARN_KIND.armor;
  if (items.isType(b, 'weap')) return [...items.typeChain(b.type)].some((t) => items.types.get(t)?.throwable) ? WARN_KIND.throw : WARN_KIND.weapon;
  return null;
}

/** 낮음 판정: 값 < 최대 × 21% */
const low = (v: number, max: number): boolean => max > 0 && v * 100 < max * WARN_PCT;

/** 착용 중인 머리·몸통·양손 아이템 중 경고 대상 (순서 = WARN_SLOTS). 내구도 0 = 빨강, 내구도·수량이 21% 미만 = 노랑 */
export function invWarnings(store: ItemStore, items: ItemDb): InvWarning[] {
  const out: InvWarning[] = [];
  for (const slot of WARN_SLOTS) {
    const it = store.equipment[slot];
    const b = it && items.base(it.code);
    if (!it || !b) continue;
    const kind = warnKind(items, b);
    if (kind === null) continue;
    let level: WarnLevel | null = null;
    if (isBroken(it)) level = 2;
    else if (low(it.durability, it.maxDurability)) level = 0;
    // 수량 아이템(화살·볼트·투척): 수량이 21% 미만 — 근사(원작 미확인): 내구도와 같은 비율을 쓴다
    else if (b.stackable && kind <= WARN_KIND.throw && low(it.quantity, b.maxStack)) level = 0;
    if (level !== null) out.push({ slot, frame: kind * 3 + level, level });
  }
  return out;
}
