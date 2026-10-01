// 소켓 뚫기 규칙 (확장팩 A5Q1 Larzuk 보상).
// 출처: D2MOO D2Common/src/Items/Items.cpp — ITEMS_IsSocketable (금화·NOSELL·퀘스트 아이템·부서짐·소켓에 든 것·이미 소켓 아님,
//       허용 소켓 = min(items gemsockets, itemtypes MaxSock1/25/40 (아이템 레벨 ≤25 / ≤40 / 그 위)), STAT_ITEM_NUMSOCKETS 0),
//       ITEMS_GetMaxSockets (같은 표, 아이템 종류 Type 칸 그 자체)
// 출처: D2MOO D2Game/src/UNIT/SUnitNpc.cpp NPC_HandleDialogMessage (MONSTER_LARZUK) — 최대 소켓, 매직은 rand(min(최대, 2)) + 1, 레어~템퍼드는 1
import type { ItemDb } from './items';
import { isBroken } from './price';
import type { Rng } from './rng';
import { QUALITY, type ItemInstance } from './treasure';

/** 출처: ITEMS_GetMaxSockets — min(gemsockets, 아이템 종류 MaxSock 칸 (아이템 레벨 1~25 / 26~40 / 41~)) */
export function maxSocketsOf(items: ItemDb, it: ItemInstance): number {
  const b = items.base(it.code);
  const t = b ? items.types.get(b.type) : undefined;
  if (!b || !t) return 0;
  const ilvl = Math.max(1, it.ilvl);
  const cap = ilvl > 40 ? t.maxSock[2] : ilvl > 25 ? t.maxSock[1] : t.maxSock[0];
  return Math.min(b.gemSockets, cap ?? 0);
}

/** 출처: ITEMS_IsSocketable */
export function isSocketable(items: ItemDb, it: ItemInstance): boolean {
  const b = items.base(it.code);
  if (!b || b.type === 'gold') return false;
  if (b.quest && b.code !== 'leg') return false;
  if (isBroken(it) || it.socketed.length || it.sockets > 0) return false;
  return maxSocketsOf(items, it) > 0;
}

/**
 * Larzuk 이 뚫는 소켓 수. 출처: NPC_HandleDialogMessage (MONSTER_LARZUK) — 보통·상급 = 최대, 매직 = rand(min(최대, 2)) + 1, 레어·세트·유니크·제작 = 1.
 * 근사(원작 미확인): 원작은 아이템 시드 (ITEMS_GetItemSeed) 로 굴린다 — 여기서는 게임 난수
 */
export function larzukSockets(items: ItemDb, it: ItemInstance, rng: Rng): number {
  let n = maxSocketsOf(items, it);
  if (it.quality === QUALITY.MAGIC) n = rng.pick(Math.min(n, 2)) + 1;
  else if (it.quality > QUALITY.MAGIC && n > 1) n = 1;
  return n;
}
