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
