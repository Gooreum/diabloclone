// 야외 낮·밤 주기 (막마다 하나). 게임 프레임(25/초)마다 한 번 update.
// 출처: D2MOO D2Common/src/D2Environment.cpp — gNormalEnvironmentCycle / gAct4EnvironmentCycle / gEclipseEnvironmentCycle,
//       ENVIRONMENT_AllocDrlgEnvironment (정오에서 시작), ENVIRONMENT_UpdateTicks, ENVIRONMENT_UpdateLightIntensity,
//       ENVIRONMENT_TaintedSunBegin/End (A2Q3 오염된 태양 일식), gnTimeRates;
//       D2Game GAME/Game.cpp GAME_UpdateProgress → GAME_UpdateEnvironment (게임 프레임마다 막별 환경)
// 원작의 빛 색(nRed/nGreen/nBlue)은 3D 모드 전용이라 옮기지 않았다 (원작 DirectDraw 는 밝기만 쓴다).

/** 하루 중 시기 (D2EnvironmentPeriodOfDay) */
export const PERIOD = { DAY: 0, DUSK: 1, NIGHT: 2, DAWN: 3 } as const;

/** 주기 [시작 각도, 시기] — 해돋이 · 아침 · 정오 · 오후 · 해질녘 · 밤 (D2EnvironmentDayCycles) */
type Cycle = readonly (readonly [number, number])[];
const NORMAL: Cycle = [[320, 3], [340, 3], [0, 0], [160, 1], [180, 1], [200, 2]];
const ACT4: Cycle = [[340, 3], [350, 3], [0, 0], [180, 1], [190, 1], [200, 2]];
const ECLIPSE: Cycle = [[300, 3], [0, 0], [60, 1], [120, 2], [180, 2], [240, 2]];
const NOON = 2, SUNRISE = 0;
/** gnTimeRates: 각도 1도 = 이만큼 틱 */
export const TIME_RATES = [128, 4, 8] as const;

/** 막 번호 (0 = Act 1) */
const ACT3 = 2, ACT4_NO = 3, ACT5 = 4;
/** 확장팩 Arreat Summit (levels.txt 120, LEVEL_ROCKYSUMMIT) */
const ROCKY_SUMMIT = 120;
/** 출처: UpdateLightIntensity — Act 4 레벨별 목표 밝기 (levels.txt 번호: 103 판데모니움 요새, 104 외곽 초원, 105 절망의 평원, 106 저주받은 도시) */
const ACT4_TARGET: Record<number, number> = { 103: 128, 104: 64, 105: 56, 106: 48 };

export class Environment {
  cycle = NOON;
  ticks = 0;
  period: number = PERIOD.DAY;
  /** 밝기 0~255 (ENVIRONMENT_GetIntensityFromAct) */
  intensity = 0;
  rate: number = TIME_RATES[0];
  eclipse = false;

  constructor() {
    // 출처: AllocDrlgEnvironment — 정오, ticks = 0 × rate
    this.period = NORMAL[NOON]![1];
    this.ticks = NORMAL[NOON]![0] * this.rate;
    this.updateIntensity(0, 0);
  }

  private cycleOf(i: number, act: number): readonly [number, number] {
    // 출처: ENVIRONMENT_GetCycle — Act 4 가 먼저, 그다음 일식
    if (act === ACT4_NO) return ACT4[i]!;
    return (this.eclipse ? ECLIPSE : NORMAL)[i]!;
  }

  /** 출처: ENVIRONMENT_UpdatePeriodOfDay — 틱 진행 뒤 밝기 (플레이어가 있는 막) */
  update(levelNo: number, act: number): void {
    this.tick(act);
    this.updateIntensity(levelNo, act);
  }

  /** 출처: ENVIRONMENT_UpdateTicks (GAME_UpdateEnvironment → UpdateCycleIndex: 만들어진 막마다 시간만) */
  tick(act: number): void {
    this.ticks++;
    if (!this.eclipse) {
      if (act === ACT4_NO) this.ticks += 15;
      else if (NORMAL[this.cycle]![1] === PERIOD.NIGHT) {
        this.ticks++;
        if (act === ACT3) this.ticks += 9;
      }
    }
    if (this.ticks >= 360 * this.rate) this.ticks = 0;
    const next = (this.cycle + 1) % 6;
    const nc = this.cycleOf(next, act);
    if (this.ticks > this.rate * nc[0]) {
      this.cycle = next;
      // 원작 그대로: 시기·틱은 일식/보통 표에서 (Act 4 표가 아님 — 원작 코드의 빠짐까지 같게)
      const t = (this.eclipse ? ECLIPSE : NORMAL)[this.cycle]!;
      this.period = t[1];
      this.ticks = this.rate * t[0];
    }
  }

  /** 출처: ENVIRONMENT_UpdateLightIntensity (확장팩: Arreat Summit 밝기 200 고정, Act 5 상한 170) */
  private updateIntensity(levelNo: number, act: number): void {
    if (act === ACT4_NO) {
      const target = ACT4_TARGET[levelNo] ?? 16;
      if (this.intensity < target) this.intensity++;
      if (this.intensity > target) this.intensity--;
      if (!this.intensity) this.intensity = target;
      return;
    }
    if (this.eclipse) {
      if (this.intensity > 32) this.intensity -= 8;
      if (this.intensity < 32) this.intensity = 32;
      return;
    }
    if (levelNo === ROCKY_SUMMIT) {
      this.intensity = 200;
      return;
    }
    const angle = (this.ticks / this.rate) * (Math.PI / 180);
    let sin = Math.sin(angle);
    if (this.ticks >= 180 * this.rate) sin *= 0.5;
    this.intensity = Math.min(act === ACT5 ? 170 : 255, Math.max(0, Math.trunc(sin * 128 + 128 + 0.5)));
  }

  /** 출처: ENVIRONMENT_InitializeEnvironment */
  private init(index: number, ticks: number, eclipse: boolean): void {
    if (ticks > 360 * this.rate) ticks = 0;
    this.cycle = index;
    this.ticks = ticks;
    this.period = (eclipse ? ECLIPSE : NORMAL)[index]![1];
    this.updateIntensity(0, 0);
    this.eclipse = eclipse;
    if (eclipse) {
      this.period = ECLIPSE[index]![1];
      this.ticks = ECLIPSE[index]![0] * this.rate;
      this.updateIntensity(0, 0);
    }
  }

  /** 출처: ENVIRONMENT_TaintedSunBegin — 시간 비율 4, 해돋이부터 일식 */
  taintedSunBegin(): void {
    this.rate = TIME_RATES[1];
    this.init(SUNRISE, 0, true);
  }

  /** 출처: ENVIRONMENT_TaintedSunEnd — 시간 비율 128, 정오 */
  taintedSunEnd(): void {
    this.rate = TIME_RATES[0];
    this.init(NOON, 0, false);
  }
}
