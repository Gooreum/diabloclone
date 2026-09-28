// 레벨 몬스터 배치.
// 출처: D2MOO — D2Game/src/MONSTER/MonsterRegion.cpp D2GAME_PopulateRoom_6FC67190
//   방(room)의 서브타일 영역을 3×3 셀로 나눠 셀마다 (rand % 100000) <= MonDen(최대 10000) 이면 그룹 스폰,
//   일반 그룹 크기 = monstats MinGrp~MaxGrp (Fallen 은 1 + 파티) (https://github.com/ThePhrozenKeep/D2MOO)
// 출처: levels.txt mon1..mon(NumMon) = 레벨 몬스터 풀, monstats Rarity = 선택 가중치
// 근사(원작 미확인): 몬스터 종류 선택 세부(MONSTERCHOOSE_GetPresetMonsterId), 챔피언/유니크 스폰(Phase 9), 파티 크기 = PartyMin~PartyMax
import type { TxtRow } from '../formats/txt';
import type { CollisionMap } from './collision';
import type { MonsterDb } from './monster';
import type { Rng } from './rng';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export interface LevelMonsterInfo { id: string; monDen: number; pool: string[] }

export function levelMonsterInfo(levels: TxtRow[], levelName: string): LevelMonsterInfo {
  const r = levels.find((x) => x.LevelName === levelName || x.Name === levelName);
  if (!r) throw new Error(`levels.txt: ${levelName} not found`);
  const pool: string[] = [];
  const count = n(r.NumMon) || 10;
  for (let i = 1; i <= Math.min(count, 10); i++) {
    const m = r[`mon${i}`];
    if (m) pool.push(m);
  }
  return { id: r.Id ?? '', monDen: Math.min(n(r.MonDen), 10000), pool };
}

export interface Room { x: number; y: number; w: number; h: number }
export interface SpawnRequest { typeId: string; x: number; y: number; leaderIndex: number }

/** 방 목록에 대한 스폰 요청 생성 (Game.spawnMonster 로 실제 생성) */
export function planSpawns(info: LevelMonsterInfo, rooms: Room[], map: CollisionMap, monsters: MonsterDb, rng: Rng, exclude?: (x: number, y: number) => boolean): SpawnRequest[] {
  const out: SpawnRequest[] = [];
  if (!info.monDen || info.pool.length === 0) return out;
  const weights = info.pool.map((id) => monsters.types.get(id)?.rarity ?? 0);
  const occupied = new Set<number>();
  const total = weights.reduce((a, b) => a + b, 0);
  for (const room of rooms) {
    const cells = Math.trunc(room.w / 3) * Math.trunc(room.h / 3);
    for (let i = 0; i < cells; i++) {
      if (Number(rng.next() & 0xffffffffn) % 100000 > info.monDen) continue;
      const cx = room.x + (i % Math.trunc(room.w / 3)) * 3, cy = room.y + Math.trunc(i / Math.trunc(room.w / 3)) * 3;
      let r = rng.pick(total), idx = 0;
      while (idx < weights.length - 1 && r >= (weights[idx] ?? 0)) r -= weights[idx++] ?? 0;
      const typeId = info.pool[idx] as string;
      const t = monsters.types.get(typeId);
      if (!t) continue;
      const isFallen = t.ai === 'Fallen';
      const size = isFallen ? 1 + partySize(t, rng) : t.minGrp + rng.pick(Math.max(t.maxGrp - t.minGrp + 1, 1));
      const leader = out.length;
      for (let k = 0; k < size; k++) {
        const pos = freeSpot(map, cx + rng.pick(3), cy + rng.pick(3), rng, occupied);
        if (!pos || exclude?.(pos.x, pos.y)) continue;
        occupied.add(pos.y * map.width + pos.x);
        out.push({ typeId, x: pos.x + 0.5, y: pos.y + 0.5, leaderIndex: leader });
      }
    }
  }
  return out;
}

function partySize(t: { minGrp: number; maxGrp: number }, rng: Rng): number {
  // Fallen: monstats PartyMin/PartyMax 는 MonsterType 에 없으므로 MinGrp~MaxGrp 를 사용 (Fallen 행에서 두 값이 동일: 2~3)
  return t.minGrp + rng.pick(Math.max(t.maxGrp - t.minGrp + 1, 1));
}

function freeSpot(map: CollisionMap, x: number, y: number, rng: Rng, occupied: Set<number>): { x: number; y: number } | null {
  const free = (px: number, py: number) => {
    if (!map.walkable(px, py)) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (occupied.has((py + dy) * map.width + px + dx)) return false;
    return true;
  };
  for (let r = 0; r <= 4; r++) {
    for (let k = 0; k < 8; k++) {
      const px = x + (r ? rng.pick(2 * r + 1) - r : 0), py = y + (r ? rng.pick(2 * r + 1) - r : 0);
      if (free(px, py)) return { x: px, y: py };
    }
  }
  return null;
}

/** 방 목록 근사: 맵을 40×40 서브타일(8×8 타일) 격자로 나눔 (실제 방 경계는 Phase 5 DRLG 에서 교체) */
export function gridRooms(width: number, height: number, roomSize = 40): Room[] {
  const rooms: Room[] = [];
  for (let y = 0; y < height; y += roomSize) for (let x = 0; x < width; x += roomSize) rooms.push({ x, y, w: Math.min(roomSize, width - x), h: Math.min(roomSize, height - y) });
  return rooms;
}
