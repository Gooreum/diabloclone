// 카오스 생추어리 봉인 5 개 → 봉인 보스 3 → 디아블로 (퀘스트 상태 D2Act4Quest2Strc 의 몬스터 부분).
// 출처: D2MOO D2Game/src/QUESTS/ACT4/A4Q2.cpp (https://github.com/ThePhrozenKeep/D2MOO)
//   OBJECTS_OperateFunction52_DiabloSeal (봉인 392~396 → bSealActivated[0..4], 조작 모드 + ENDANIM),
//   OBJECTS_OperateFunction54/55/56_DiabloSeal (392/394/396: 봉인 좌표 + (−12,−52)/(−39,+33)/(+32,+16) 에 보스 생성 오브젝트 131),
//   ACT4Q2_SpawnSealBoss (슈퍼유니크 36 Infector of Souls / 37 Lord De Seis / 38 Grand Vizier of Chaos),
//   ACT4Q2_Callback08_MonsterKilled (디아블로가 아니면 nBossesKilled++, 3 이고 봉인 5 개 다 열렸으면 → 생추어리 정리 + 디아블로 타이머),
//   ACT4Q2_KillAllMonstersInCS (디아블로 말고 살아 있는 악 몬스터 전부 죽음 모드), ACT4Q2_SpawnDiablo (타이머 10 틱 뒤 InitFn 55 자리에 Diablo)
// Phase 7 퀘스트(A4Q2)는 이 상태의 사건 (sealOperated / sealBossSpawned / sealBossKilled / chaosCleared / diabloSpawned / diabloKilled) 을 쓴다.

/** 봉인 오브젝트 (objects.txt 392~396) → 순번 */
export const SEAL_IDS: readonly number[] = [392, 393, 394, 395, 396];

/** 출처: OBJECTS_OperateFunction54/55/56 — 봉인이 부르는 보스 (슈퍼유니크 번호) 와 봉인 좌표 기준 오프셋 */
export const SEAL_BOSSES: Readonly<Record<number, { superUnique: number; dx: number; dy: number }>> = {
  392: { superUnique: 36, dx: -12, dy: -52 },
  394: { superUnique: 37, dx: -39, dy: 33 },
  396: { superUnique: 38, dx: 32, dy: 16 },
};

/** 출처: ACT4Q2_SpawnDiablo — 타이머 콜백이 10 번 돌아야 (dwTickCount ≥ 10) 디아블로가 나온다. 근사(원작 미확인): 콜백 1 번 = 1 프레임 */
export const DIABLO_SPAWN_DELAY = 10;

export type ChaosAction =
  | { kind: 'spawnBoss'; superUnique: number; dx: number; dy: number }
  | { kind: 'clear' }
  | { kind: 'startDiabloTimer' };

/** A4Q2 의 봉인·보스·디아블로 상태 (게임마다 새로 — 원작 pQuestDataEx 도 게임 단위) */
export class ChaosState {
  readonly sealActivated = [false, false, false, false, false];
  bossesKilled = 0;
  sanctumCleared = false;
  diabloSpawned = false;
  diabloKilled = false;
  /** 디아블로 타이머 (−1 = 없음, 그 밖 = 지난 틱 수) */
  timer = -1;

  get allSeals(): boolean {
    return this.sealActivated.every(Boolean);
  }

  /** 출처: OBJECTS_OperateFunction52 (+54/55/56) — 봉인을 연다. 이미 열렸으면 아무것도 */
  operateSeal(classId: number): ChaosAction[] {
    const i = SEAL_IDS.indexOf(classId);
    if (i < 0 || this.sealActivated[i]) return [];
    const out: ChaosAction[] = [];
    const b = SEAL_BOSSES[classId];
    // 원작: 54/55/56 은 보스 자리 오브젝트(131)를 먼저 만들고 52 를 부른다
    if (b) out.push({ kind: 'spawnBoss', ...b });
    this.sealActivated[i] = true;
    out.push(...this.check());
    return out;
  }

  /** 출처: ACT4Q2_Callback08_MonsterKilled — 봉인 보스 처치 */
  bossKilled(): ChaosAction[] {
    this.bossesKilled++;
    if (this.bossesKilled !== 3) return [];
    return this.check();
  }

  /** 봉인 5 개 + 보스 3 → 정리 + 디아블로 타이머 (OperateFunction52 · Callback08 · InitFunction55 공통) */
  private check(): ChaosAction[] {
    if (!this.allSeals || this.bossesKilled !== 3) return [];
    const out: ChaosAction[] = [];
    if (!this.sanctumCleared) {
      this.sanctumCleared = true;
      out.push({ kind: 'clear' });
    }
    if (this.timer < 0 && !this.diabloSpawned) {
      this.timer = 0;
      out.push({ kind: 'startDiabloTimer' });
    }
    return out;
  }

  /** 출처: ACT4Q2_SpawnDiablo — 타이머 한 틱. true = 이번에 디아블로를 부를 때 */
  tick(): boolean {
    if (this.timer < 0 || this.diabloSpawned) return false;
    this.timer++;
    return this.timer >= DIABLO_SPAWN_DELAY;
  }

  /** 디아블로 생성 성공 */
  spawned(): void {
    this.diabloSpawned = true;
    this.timer = -1;
  }
}
