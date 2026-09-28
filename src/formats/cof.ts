// COF: 캐릭터/몬스터 애니메이션의 레이어 구성과 프레임별 그리기 순서.
// 출처: Phrozen Keep — "COF file format" (헤더 28바이트, 레이어 9바이트)
//       + OpenDiablo2 d2cof (https://github.com/OpenDiablo2/OpenDiablo2)

// 출처: Phrozen Keep COF — 레이어(컴포지트) 타입 0~15
export const COMPOSITES = ['HD', 'TR', 'LG', 'RA', 'LA', 'RH', 'LH', 'SH', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const;
export type CompositeName = (typeof COMPOSITES)[number];

export interface CofLayer {
  type: number;
  name: CompositeName;
  shadow: number;
  selectable: boolean;
  transparent: boolean;
  drawEffect: number;
  weaponClass: string;
}
export interface Cof {
  layers: CofLayer[];
  framesPerDirection: number;
  directions: number;
  speed: number;
  /** 프레임별 트리거 코드 (1=공격 판정 등) */
  frameEvents: number[];
  /** priority[dir][frame] = 그릴 레이어 타입 순서 */
  priority: number[][][];
}

export function parseCof(buf: Uint8Array): Cof {
  if (buf.length < 28) throw new Error('cof: too short');
  const numLayers = buf[0] ?? 0;
  const framesPerDirection = buf[1] ?? 0;
  const directions = buf[2] ?? 0;
  const speed = buf[24] ?? 0;
  let p = 28;
  const need = p + numLayers * 9 + framesPerDirection + framesPerDirection * directions * numLayers;
  if (need > buf.length) throw new Error('cof: truncated');
  const layers: CofLayer[] = [];
  for (let i = 0; i < numLayers; i++) {
    const type = buf[p] ?? 0;
    const wc = new TextDecoder('latin1').decode(buf.subarray(p + 5, p + 9)).replace(/\0.*$/, '');
    layers.push({
      type,
      name: COMPOSITES[type] ?? 'HD',
      shadow: buf[p + 1] ?? 0,
      selectable: (buf[p + 2] ?? 0) !== 0,
      transparent: (buf[p + 3] ?? 0) !== 0,
      drawEffect: buf[p + 4] ?? 0,
      weaponClass: wc,
    });
    p += 9;
  }
  const frameEvents = Array.from(buf.subarray(p, p + framesPerDirection));
  p += framesPerDirection;
  const priority: number[][][] = [];
  for (let d = 0; d < directions; d++) {
    const frames: number[][] = [];
    for (let f = 0; f < framesPerDirection; f++) {
      frames.push(Array.from(buf.subarray(p, p + numLayers)));
      p += numLayers;
    }
    priority.push(frames);
  }
  return { layers, framesPerDirection, directions, speed, frameEvents, priority };
}
