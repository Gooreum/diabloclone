// 캐릭터 외형 레이어: 장착 아이템 → COF 레이어 코드.
// 출처: Phrozen Keep COF 문서 — 레이어 HD 머리, TR 몸통, LG 다리, RA/LA 팔, RH 오른손, LH 왼손(활), SH 방패, S1/S2 어깨
//       armor.txt rArm/lArm/Torso/Legs/rSPad/lSPad (0 lit, 1 med, 2 hvy), alternategfx (투구·방패·무기 그래픽 코드)
import type { ItemDb } from '../engine/items';
import type { ItemInstance } from '../engine/treasure';

const WEIGHT = ['lit', 'med', 'hvy'];

export function playerLayers(items: ItemDb, equipment: Record<string, ItemInstance | undefined>): Record<string, string> {
  const out: Record<string, string> = { HD: 'lit', TR: 'lit', LG: 'lit', RA: 'lit', LA: 'lit', S1: 'lit', S2: 'lit' };
  const tors = equipment.tors ? items.base(equipment.tors.code) : undefined;
  if (tors?.armorGfx) {
    const g = tors.armorGfx;
    out.TR = WEIGHT[g.tr] ?? 'lit';
    out.LG = WEIGHT[g.lg] ?? 'lit';
    out.RA = WEIGHT[g.ra] ?? 'lit';
    out.LA = WEIGHT[g.la] ?? 'lit';
    out.S1 = WEIGHT[g.s1] ?? 'lit';
    out.S2 = WEIGHT[g.s2] ?? 'lit';
  }
  const head = equipment.head ? items.base(equipment.head.code) : undefined;
  if (head) out.HD = head.altGfx;
  for (const slot of ['rarm', 'larm'] as const) {
    const it = equipment[slot];
    const b = it ? items.base(it.code) : undefined;
    if (!b) continue;
    // 활·석궁은 왼손(LH), 화살통은 그리지 않음, 방패는 SH, 그 외 무기는 오른손 슬롯 RH / 왼손 슬롯 LH
    if (items.isType(b, 'bow') || items.isType(b, 'xbow')) out.LH = b.altGfx;
    else if (items.isType(b, 'misl')) continue;
    else if (items.isType(b, 'shld')) out.SH = b.altGfx;
    else out[slot === 'rarm' ? 'RH' : 'LH'] = b.altGfx;
  }
  return out;
}
