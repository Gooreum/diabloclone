// 웨이포인트: 번호(levels.txt Waypoint) ↔ 레벨, 활성 비트.
// 출처: D2MOO D2Common/src/D2Waypoints.cpp — WAYPOINTS_GetWaypointNoFromLevelId (levels.txt Waypoint, 255 = 없음),
//       WAYPOINTS_GetLevelIdFromWaypointNo, WAYPOINTS_AllocWaypointData (0번 = 액트 1 마을은 처음부터 활성: nFlags[1] |= 1)
//       D2Game/src/OBJECTS/ObjMode.cpp OBJECTS_OperateFunction23_Waypoint (조작하면 그 레벨 웨이포인트 활성 → 목록 패널),
//       D2GAME_WAYPOINT_Unk_6FC79600 (활성된 웨이포인트 레벨로 이동, 마을이면 위치 인덱스 13)

/** levels.txt 에서 웨이포인트가 있는 레벨 (번호 순). 원작 패널은 액트 탭마다 이 순서로 줄을 그린다 */
export interface WaypointLevel { no: number; levelNo: number; act: number }

export function waypointLevels(levels: { id: number; act: number; waypoint: number }[]): WaypointLevel[] {
  return levels.filter((l) => l.waypoint !== 255 && l.waypoint >= 0).map((l) => ({ no: l.waypoint, levelNo: l.id, act: l.act })).sort((a, b) => a.no - b.no);
}

/** 활성 웨이포인트 집합 (원작 비트 필드 D2WaypointDataStrc 대신 번호 집합) */
export class WaypointFlags {
  private readonly set = new Set<number>([0]);

  constructor(active: readonly number[] = []) {
    for (const n of active) this.set.add(n);
  }
  /** 출처: WAYPOINTS_ActivateWaypoint */
  activate(no: number): boolean {
    if (this.set.has(no)) return false;
    this.set.add(no);
    return true;
  }
  /** 출처: WAYPOINTS_IsActivated */
  has(no: number): boolean {
    return this.set.has(no);
  }
  list(): number[] {
    return [...this.set].sort((a, b) => a - b);
  }
}
