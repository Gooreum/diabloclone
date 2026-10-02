// Pal.PL2 (data\global\palette\<act>\Pal.PL2) 의 글자 색 부분: TextColors 13 × RGB, TextColorShifts 13 × 256 (팔레트 인덱스 바꾸기 표).
// 원작 글꼴 DC6 는 흰색 계열 인덱스로 그려져 있고, 글자 색은 이 표로 인덱스를 바꿔 칠한다.
// 출처: OpenDiablo2 d2fileformats/d2pl2/pl2.go — 구조 끝부분 ... DarkendColorShift(256) · TextColors[13](RGB 3바이트) · TextColorShifts[13](256)
// 출처: 원작 파일 직접 확인 — ACT1 Pal.PL2 = 443175 바이트, TextColors = 흰 255,255,255 · 빨강 255,77,77 · 초록 0,255,0 · 파랑 105,105,255 ·
//       금색 199,179,119 · 회색 105,105,105 · 검정 · 황갈 208,194,125 · 주황 255,168,0 · 노랑 255,255,100 · 짙은 초록 0,128,0 · 보라 174,0,255 · 초록2 0,200,0

export const TEXT_COLOR_COUNT = 13;

/** 원작 글자 색 번호 (게임 속 ÿc0 … ÿc; 순서) */
export const TEXT_COLOR = {
  white: 0, red: 1, green: 2, blue: 3, gold: 4, grey: 5, black: 6, tan: 7, orange: 8, yellow: 9, darkGreen: 10, purple: 11, green2: 12,
} as const;
export type TextColorName = keyof typeof TEXT_COLOR;

export interface Pl2Text {
  colors: [number, number, number][];
  shifts: Uint8Array[];
}

export function parsePl2Text(buf: Uint8Array): Pl2Text {
  const shiftsLen = TEXT_COLOR_COUNT * 256, colorsLen = TEXT_COLOR_COUNT * 3;
  if (buf.length < shiftsLen + colorsLen + 1024) throw new Error(`pl2: too short (${buf.length})`);
  const cOff = buf.length - shiftsLen - colorsLen, sOff = buf.length - shiftsLen;
  const colors: [number, number, number][] = [];
  const shifts: Uint8Array[] = [];
  for (let i = 0; i < TEXT_COLOR_COUNT; i++) {
    colors.push([buf[cOff + i * 3] ?? 0, buf[cOff + i * 3 + 1] ?? 0, buf[cOff + i * 3 + 2] ?? 0]);
    shifts.push(buf.slice(sOff + i * 256, sOff + (i + 1) * 256));
  }
  return { colors, shifts };
}

// 밝기 단계 표 (LightLevelVariations): 기본 팔레트(256 × 4 바이트) 바로 뒤 32줄 × 256 (팔레트 인덱스 바꾸기 표).
// 0번 줄 = 가장 어둡게, 31번 줄 = 원래 색(항등). 원작 DirectDraw 조명이 이 표로 화면을 어둡게 칠한다.
// 출처: OpenDiablo2 d2fileformats/d2pl2/pl2.go — BasePalette · LightLevelVariations[32]; 원작 ACT1 Pal.PL2 직접 확인 (31번 줄 = 항등)
export const LIGHT_LEVELS = 32;

// 색 바꾸기 표 (HueVariations 111 × 256): BasePalette 1024 · LightLevel 32×256 · InvColor 16×256 · SelectedUnitShift 256 · AlphaBlend 3×256×256 ·
// AdditiveBlend 256×256 · MultiplicativeBlend 256×256 바로 뒤 (= 341248 바이트째). states.txt colorshift 가 이 표 번호 (냉기 108 · 독 104).
// 출처: OpenDiablo2 d2fileformats/d2pl2/pl2.go 구조 순서; 원작 ACT1 Pal.PL2 = 443175 바이트 (끝 TextColorShifts 까지 합이 맞는다)
export const HUE_OFFSET = 1024 + 32 * 256 + 16 * 256 + 256 + 3 * 256 * 256 + 256 * 256 + 256 * 256;
export const HUE_COUNT = 111;

export function parsePl2Hues(buf: Uint8Array): Uint8Array {
  if (buf.length < HUE_OFFSET + HUE_COUNT * 256) throw new Error(`pl2: too short (${buf.length})`);
  return buf.slice(HUE_OFFSET, HUE_OFFSET + HUE_COUNT * 256);
}

export function parsePl2Light(buf: Uint8Array): Uint8Array {
  if (buf.length < 1024 + LIGHT_LEVELS * 256) throw new Error(`pl2: too short (${buf.length})`);
  return buf.slice(1024, 1024 + LIGHT_LEVELS * 256);
}
