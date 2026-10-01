// 레벨 몬스터 배치.
// 출처: D2MOO — D2Game/src/MONSTER/MonsterRegion.cpp (https://github.com/ThePhrozenKeep/D2MOO)
//   MONSTERREGION_InitializeAll: levels.txt mon1..mon10 중 NumMon 개를 중복 없이 무작위로 골라 (isSpawn 만) 레벨 몬스터 목록을 만든다
//   D2GAME_PopulateRoom_6FC67190: 방마다 ((w/3)×h)/3 번 (rand % 100000) <= MonDen(최대 10000) 이면 몬스터 하나를 고르고
//     MONSTERCHOOSE_GetBossSpawnType 이 0 이면 보스(챔피언/유니크 — umon 목록), 아니면 무리 (MinGrp~MaxGrp, Fallen 은 1 + 파티)
//   sub_6FC66260: 방 안 무작위 지점 20 번 시도 (이동 지점·마을 포털 자리에서 WarpDist 안은 제외)
// 출처: D2MOO D2Game/src/MONSTER/MonsterChoose.cpp MONSTERCHOOSE_GetPresetMonsterId (Rarity 가중치, placespawn 이면 80% 로 spawn 몬스터),
//       MONSTERCHOOSE_GetBossSpawnType (MonUMin 채우기: rand%100 < 100 × 방문 방 / 전체 방, MonUMax 까지 5% , 나머지 무리)
// 난이도 (Phase 8) 출처: MONSTERREGION_InitializeAll — MonDen[난이도]·MonUMin/MonUMax[난이도], Nightmare/Hell 은 nmon1~ 목록,
//   클래식 레벨 몬스터 레벨 = MonLvl1/2/3 (확장팩만 MonLvl1Ex~), MONSTERCHOOSE_GetPresetMonsterId — umon 목록은 Normal 만 (NM/H 보스는 레벨 목록에서)
// 근사(원작 미확인): 원작은 게임 시드·방 시드 두 난수열을 쓴다 — 여기서는 레벨 하나의 난수열. 무리 구성원 위치는 리더 주변 반경 3 빈칸.
import type { TxtRow } from '../formats/txt';
import type { CollisionMap } from './collision';
import type { MonsterDb } from './monster';
import type { Rng } from './rng';
import { diffColumn, type Difficulty } from './difficulty';

const n = (v: string | undefined): number => Number(v ?? 0) || 0;

export interface LevelMonsterInfo {
  id: string;
  /** 난이도 (0 Normal / 1 Nightmare / 2 Hell) */
  difficulty: Difficulty;
  /** MonDen / MonDen(N) / MonDen(H) */
  monDen: number;
  /** levels.txt mon1~mon10 (Normal 목록 — D2Common_11063 계열 선택은 난이도와 무관하게 이 목록) */
  pool: string[];
  /** 레벨 몬스터를 고르는 목록: Normal = mon1~, Nightmare/Hell = nmon1~ (출처: wNightmareHellMonsters) */
  spawnPool: string[];
  /** umon1~umon10 (보스 후보, Normal 에서만 쓴다) */
  umon: string[];
  numMon: number;
  /** MonUMin / MonUMax (난이도 칸) */
  bossMin: number; bossMax: number;
  /** MonLvl1Ex (D2Common_11063 계열 선택 — 항상 Normal 칸 wMonLvlEx[0]) */
  monLvlEx: number;
  /** 클래식 레벨 몬스터 레벨 (MonLvl1 / MonLvl2 / MonLvl3). 출처: MONSTERREGION_InitializeAll (!bExpansion → wMonLvl[난이도]) */
  monLvl: number;
  /** 이동 지점 금지 거리² (WarpDist) */
  warpDist: number;
}

/**
 * @param expansion 확장팩 게임 — 계열 고르기 지역 레벨 = MonLvl{d+1}Ex (출처: MonsterRegion.cpp — bExpansion 이면 dwDungeonLevelEx = wMonLvlEx[nDifficulty]).
 *   근사(원작 미확인): 클래식은 예전처럼 MonLvl1Ex 를 둔다 (원작 wMonLvl[nDifficulty] — 클래식 회귀를 바꾸지 않으려고)
 */
export function levelMonsterInfo(levels: TxtRow[], levelName: string, difficulty: Difficulty = 0, expansion = false): LevelMonsterInfo {
  const r = levels.find((x) => x.LevelName === levelName || x.Name === levelName);
  if (!r) throw new Error(`levels.txt: ${levelName} not found`);
  const pool: string[] = [], nmon: string[] = [], umon: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const m = r[`mon${i}`];
    if (m) pool.push(m);
    const nm = r[`nmon${i}`];
    if (nm) nmon.push(nm);
    const u = r[`umon${i}`];
    if (u) umon.push(u);
  }
  const d = difficulty;
  return {
    id: r.Id ?? '', difficulty: d, monDen: Math.min(n(r[diffColumn('MonDen', d)]), 10000), pool, spawnPool: d > 0 ? nmon : pool, umon, numMon: n(r.NumMon),
    bossMin: n(r[diffColumn('MonUMin', d)]), bossMax: n(r[diffColumn('MonUMax', d)]), monLvlEx: n(r[expansion ? `MonLvl${d + 1}Ex` : 'MonLvl1Ex']), monLvl: n(r[`MonLvl${d + 1}`]), warpDist: n(r.WarpDist),
  };
}

/**
 * 레벨 몬스터 목록 (원작 D2MonsterRegionStrc pMonData). 출처: MONSTERREGION_InitializeAll —
 * i < min(NumMon, 13, 풀 크기) 번: 남은 풀에서 rand(남은 수) 번째를 빼고, isSpawn 이면 목록에 (Rarity 합산)
 */
export function chooseRegionMonsters(info: LevelMonsterInfo, monsters: MonsterDb, rng: Rng): string[] {
  const ids = [...(info.spawnPool ?? info.pool)];
  let left = ids.length;
  const count = Math.min(Math.min(info.numMon, 13), left);
  const out: string[] = [];
  for (let i = 0; i < count && left > 0; i++) {
    const idx = rng.pick(left);
    const id = ids[idx] as string;
    ids.splice(idx, 1);
    left--;
    if (monsters.types.get(id)?.isSpawn) out.push(id);
  }
  return out;
}

export interface Room { x: number; y: number; w: number; h: number }
export interface SpawnRequest {
  typeId: string; x: number; y: number;
  /** 같은 무리의 리더 요청 번호 (자기 자신이면 리더) */
  leaderIndex: number;
  /** 보스 (챔피언/유니크 굴림 + 미니언) */
  boss?: boolean;
  /** 파티(동반 몬스터: monstats minion1/PartyMin~PartyMax) 를 붙인다 */
  party?: boolean;
}

/** 레벨 배치 결과 (선택된 레벨 몬스터 목록 + 요청) */
export interface SpawnPlan { region: string[]; requests: SpawnRequest[] }

/**
 * 방 목록에 대한 스폰 요청 (Game 이 실제 생성: 보스는 챔피언/유니크 굴림, 리더는 파티).
 * @param region 이미 고른 레벨 몬스터 목록 (없으면 chooseRegionMonsters)
 */
export function planSpawns(info: LevelMonsterInfo, rooms: Room[], map: CollisionMap, monsters: MonsterDb, rng: Rng, exclude?: (x: number, y: number) => boolean, region?: string[]): SpawnRequest[] {
  return planLevel(info, rooms, map, monsters, rng, exclude, region).requests;
}

export function planLevel(info: LevelMonsterInfo, rooms: Room[], map: CollisionMap, monsters: MonsterDb, rng: Rng, exclude?: (x: number, y: number) => boolean, region?: string[]): SpawnPlan {
  const reg = region ?? chooseRegionMonsters(info, monsters, rng);
  const out: SpawnRequest[] = [];
  if (!info.monDen || reg.length === 0) return { region: reg, requests: out };
  const weights = reg.map((id) => monsters.types.get(id)?.rarity ?? 0);
  const total = weights.reduce((a, b) => a + b, 0);
  const occupied = new Set<number>();
  let visited = 0, uniques = 0;
  const totalRooms = rooms.length;
  const free = (px: number, py: number) => {
    if (!map.walkable(px, py) || exclude?.(px, py)) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (occupied.has((py + dy) * map.width + px + dx)) return false;
    return true;
  };
  // 출처: sub_6FC66260 — 방 안(가장자리 1 제외) 무작위 지점 20 번
  const roomSpot = (room: Room): { x: number; y: number } | null => {
    for (let i = 0; i < 20; i++) {
      const x = room.x + 1 + rng.pick(room.w - 1), y = room.y + 1 + rng.pick(room.h - 1);
      if (free(x, y)) return { x, y };
    }
    return null;
  };
  // 출처: MONSTERCHOOSE_GetPresetMonsterId (무리 nChance 20, NM/H 보스 nChance 0)
  const choose = (chance = 20): string | undefined => {
    let r = rng.pick(total) + 1, idx = 0;
    for (; idx < reg.length; idx++) {
      r -= weights[idx] ?? 0;
      if (r <= 0) break;
    }
    let id = reg[Math.min(idx, reg.length - 1)] as string;
    const t = monsters.types.get(id);
    if (t?.spawn && t.placeSpawn && (rng.roll() >>> 0) % 100 > chance && monsters.types.has(t.spawn)) id = t.spawn;
    return id;
  };
  // 출처: MONSTERCHOOSE_GetBossSpawnType (0 = 보스, 그 외 무리)
  const bossType = (): number => {
    if (uniques < info.bossMin && totalRooms && (rng.roll() >>> 0) % 100 < Math.trunc((100 * visited) / totalRooms)) return 0;
    if (uniques < info.bossMax && (rng.roll() >>> 0) % 100 <= 5) return 0;
    return (rng.roll() >>> 0) % 100 > 35 ? 2 : 1;
  };
  for (const room of rooms) {
    visited++;
    const cells = Math.trunc((Math.trunc(room.w / 3) * room.h) / 3);
    for (let i = cells; i > 0; i--) {
      if ((rng.roll() >>> 0) % 100000 > info.monDen) continue;
      const typeId = choose();
      const t = typeId ? monsters.types.get(typeId) : undefined;
      if (!t || !typeId) continue;
      if (bossType() === 0) {
        // 출처: GetPresetMonsterId(…, nChance 0, bSpawnUMon=1) — Normal 은 umon 목록에서 무작위, Nightmare/Hell 은 레벨 몬스터 목록 (Rarity)
        let bossId: string | undefined;
        if (!info.difficulty) {
          if (!info.umon.length) continue;
          bossId = info.umon[rng.pick(info.umon.length)] as string;
        } else bossId = choose(0);
        if (!bossId || !monsters.types.has(bossId)) continue;
        const pos = roomSpot(room);
        if (!pos) continue;
        occupied.add(pos.y * map.width + pos.x);
        uniques++;
        out.push({ typeId: bossId, x: pos.x + 0.5, y: pos.y + 0.5, leaderIndex: out.length, boss: true });
        continue;
      }
      const single = t.baseId === 'fallen1' || t.baseId === 'scarab1';
      const minG = single ? 1 : t.minGrp, maxG = single ? 1 : t.maxGrp;
      if (!minG || !maxG || maxG < minG) continue;
      if (t.sparsePopulate && (rng.roll() >>> 0) % 100 > t.sparsePopulate) continue;
      const pos = roomSpot(room);
      if (!pos) continue;
      const leader = out.length;
      occupied.add(pos.y * map.width + pos.x);
      out.push({ typeId, x: pos.x + 0.5, y: pos.y + 0.5, leaderIndex: leader, party: true });
      // 출처: sub_6FC677D0 — 나머지 = (min−1) + rand(max − min + 1)
      const count = minG - 1 + rng.pick(maxG - minG + 1);
      for (let k = 0; k < count; k++) {
        const p = freeSpot(map, pos.x, pos.y, rng, occupied, exclude);
        if (!p) continue;
        occupied.add(p.y * map.width + p.x);
        out.push({ typeId, x: p.x + 0.5, y: p.y + 0.5, leaderIndex: leader, party: true });
      }
    }
  }
  return { region: reg, requests: out };
}

/** 근사(원작 미확인): 원작 D2GAME_SpawnNormalMonster 의 주변 탐색 대신 반경 3 안의 빈칸 */
function freeSpot(map: CollisionMap, x: number, y: number, rng: Rng, occupied: Set<number>, exclude?: (x: number, y: number) => boolean): { x: number; y: number } | null {
  const free = (px: number, py: number) => {
    if (!map.walkable(px, py) || exclude?.(px, py)) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (occupied.has((py + dy) * map.width + px + dx)) return false;
    return true;
  };
  for (let r = 1; r <= 3; r++) {
    for (let k = 0; k < 8; k++) {
      const px = x + rng.pick(2 * r + 1) - r, py = y + rng.pick(2 * r + 1) - r;
      if (free(px, py)) return { x: px, y: py };
    }
  }
  return null;
}

/** 방 목록 근사: 맵을 40×40 서브타일(8×8 타일) 격자로 나눔 (테스트용) */
export function gridRooms(width: number, height: number, roomSize = 40): Room[] {
  const rooms: Room[] = [];
  for (let y = 0; y < height; y += roomSize) for (let x = 0; x < width; x += roomSize) rooms.push({ x, y, w: Math.min(roomSize, width - x), h: Math.min(roomSize, height - y) });
  return rooms;
}
