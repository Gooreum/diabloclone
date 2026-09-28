// AnimData.d2: 모드별 애니메이션 길이·속도·이벤트 프레임 (예: "ZMA1HTH").
// 출처: D2MOO — D2Common/src/DataTbls/AnimTbls.cpp (256 버킷, 버킷 해시 = 이름 바이트 합, 레코드 160바이트:
//       name[8], dwFrames u32, dwAnimSpeed i32, pFrameFlags[144]) (https://github.com/ThePhrozenKeep/D2MOO)

export interface AnimRecord { name: string; frames: number; speed: number; frameFlags: Uint8Array }

export class AnimData {
  private readonly map = new Map<string, AnimRecord>();

  static parse(buf: Uint8Array): AnimData {
    const a = new AnimData();
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 0;
    for (let b = 0; b < 256; b++) {
      if (p + 4 > buf.length) throw new Error('animdata: truncated bucket');
      const n = dv.getInt32(p, true);
      p += 4;
      for (let i = 0; i < n; i++) {
        if (p + 160 > buf.length) throw new Error('animdata: truncated record');
        const raw = buf.subarray(p, p + 8);
        const end = raw.indexOf(0);
        const name = new TextDecoder('latin1').decode(end < 0 ? raw : raw.subarray(0, end)).toUpperCase();
        a.map.set(name, { name, frames: dv.getUint32(p + 8, true), speed: dv.getInt32(p + 12, true), frameFlags: buf.slice(p + 16, p + 160) });
        p += 160;
      }
    }
    return a;
  }

  get(name: string): AnimRecord | undefined {
    return this.map.get(name.toUpperCase());
  }
  get size(): number {
    return this.map.size;
  }
}

/** 첫 번째 이벤트(공격 판정) 프레임 인덱스, 없으면 -1 */
export function actionFrame(r: AnimRecord): number {
  for (let i = 0; i < Math.min(r.frames, r.frameFlags.length); i++) if (r.frameFlags[i]) return i;
  return -1;
}

/**
 * 애니메이션 지속 프레임 (게임 틱).
 * 출처: Maxroll — Attack Speed: AnimDuration = {(AnimLength × 256) / [AnimSpeed × (AnimRate + SIAS + EIAS − WSM) / 100]} − 1
 *       ({} 올림, [] 내림, AnimRate 기본 100) (https://maxroll.gg/d2/resources/attack-speed)
 */
export function animDurationFrames(frames: number, animSpeed: number, speedPercent = 100, minusOne = true): number {
  const rate = Math.floor((animSpeed * speedPercent) / 100);
  if (rate <= 0) return frames;
  return Math.max(1, Math.ceil((frames * 256) / rate) - (minusOne ? 1 : 0));
}

/** 애니메이션 프레임 인덱스 → 경과 틱 (이벤트 프레임 도달 시점) */
export function frameToTick(frameIndex: number, animSpeed: number, speedPercent = 100): number {
  const rate = Math.floor((animSpeed * speedPercent) / 100);
  return rate <= 0 ? frameIndex : Math.ceil((frameIndex * 256) / rate);
}
