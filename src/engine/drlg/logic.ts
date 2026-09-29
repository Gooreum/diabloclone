// 비전의 성역 (Arcane Sanctuary, levels.txt 74): 중앙 방에서 네 방향으로 15 칸짜리 나선 가지를 뻗는다.
// 출처: D2MOO DrlgMaze.cpp DRLGMAZE_PlaceArcaneSanctuary, DRLGMAZE_PlaceRoomForArcaneBranch, DRLGMAZE_ArcaneSanctuaryDirectionFromRoomIdx
//       (DRLGMAZE_GenerateLevel 의 LVLTYPE_ACT2_ARCANE 분기에서 호출)
// 참고: 작업 계획은 "DrlgDrlgLogic.cpp" 로 적었으나, 원작 DrlgDrlgLogic.cpp 는 방 안 가시성(DRLGLOGIC_*) 코드이고
//       성역 배치는 DrlgMaze.cpp 에 있다 — 여기서는 DrlgMaze.cpp 를 이식한다.
import { type MazeLevel, type MazeRoom, pickRoomPreset, placeAdjacentPresetRoom } from './maze';

const ROOMS_PER_BRANCH = 15, BRANCHES = 4;

/**
 * 가지 안 방 번호 → 방향 (가지 방향 기준 앞/왼쪽/오른쪽/뒤).
 *                  2 →  3 →  4 →  5 →  6
 *                  ↑                   ↓
 *          W → 0 → 1        12         7 →  8
 *                            ↑         ↓
 *                 14 ← 13 ← 11 ← 10  ← 9
 * 출처: DRLGMAZE_ArcaneSanctuaryDirectionFromRoomIdx
 */
export function arcaneDirection(branch: number, idx: number): number {
  switch (idx) {
    case 2: case 12: return branch + 3;
    case 7: case 9: return branch + 1;
    case 10: case 11: case 13: case 14: return branch + 2;
    default: return branch;
  }
}

/** 출처: DRLGMAZE_PlaceRoomForArcaneBranch — 방을 붙이고(합치기 허용) 부모·새 방 프리셋을 다시 고른다 */
function placeBranchRoom(L: MazeLevel, parent: MazeRoom, dir: number): MazeRoom | null {
  const r = placeAdjacentPresetRoom(L, parent, dir % 4, true);
  if (!r) return null;
  pickRoomPreset(L, parent, true);
  pickRoomPreset(L, r, true);
  return r;
}

/**
 * 성역 배치. 가지 방은 파일 (nRand + 가지) % 4 (중앙 방은 파일 4 = 포털·웨이포인트 방).
 * 원작처럼 8·12 번 방은 배열에 넣지 않아 파일이 무작위(-1)로 남고, 다음 방은 같은 부모에서 이어진다.
 * 출처: DRLGMAZE_PlaceArcaneSanctuary
 */
export function placeArcaneSanctuary(L: MazeLevel): void {
  const first = L.rooms[0] as MazeRoom;
  const nRand = L.seed.roll() & 3;
  const arr: (MazeRoom | null)[] = new Array(ROOMS_PER_BRANCH * BRANCHES).fill(null);
  for (let b = 0; b < BRANCHES; b++) {
    let parent: MazeRoom | null = first;
    for (let i = 0; i < ROOMS_PER_BRANCH; i++) {
      // 원작은 부모가 없으면(실패) 멈춘다 — 정상 흐름에서는 일어나지 않는다
      if (!parent) break;
      const r = placeBranchRoom(L, parent, arcaneDirection(b, i));
      if (i !== 8 && i !== 12) {
        arr[i + b * ROOMS_PER_BRANCH] = r;
        parent = r;
      }
    }
  }
  arr.forEach((r, i) => {
    if (r) r.picked = (nRand + Math.trunc(i / ROOMS_PER_BRANCH)) % 4;
  });
  first.picked = 4;
}
