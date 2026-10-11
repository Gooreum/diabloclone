// 디아블로 1 소리: Devilution 이 DirectSound 단위로 넘기는 음량·팬을 Web Audio 로.
// 출처: DirectSound IDirectSoundBuffer::SetVolume / SetPan — 1/100 dB (DSBVOLUME_MIN -10000 … DSBVOLUME_MAX 0, DSBPAN_LEFT -10000 … DSBPAN_RIGHT 10000)
import type { AudioCall } from './protocol';

/** 음량 (1/100 dB, -10000 … 0) → 배율 0 … 1 */
export function volumeGain(v: number): number {
  return Math.pow(10, Math.max(-10000, Math.min(0, v)) / 2000);
}

/** 팬 (1/100 dB): 음수는 오른쪽 채널을 그만큼 줄여 소리가 왼쪽으로. StereoPanner 의 -1 … 1 로 (홀함수) */
export function panValue(p: number): number {
  const c = Math.max(-10000, Math.min(10000, p));
  const att = 1 - Math.pow(10, -Math.abs(c) / 2000);
  return c < 0 ? -att : att;
}

interface Voice {
  buffer: Promise<AudioBuffer>;
  gain: GainNode;
  pan: StereoPannerNode | null;
  source: AudioBufferSourceNode | null;
}

/** 워커의 소리 호출을 그대로 받아 재생한다. AudioContext 는 사용자 입력 뒤 resume 해야 소리가 난다 */
export class D1Audio {
  private ctx: AudioContext | null = null;
  private readonly voices = new Map<number, Voice>();

  constructor() {
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  /** 첫 클릭·키 입력에서 (브라우저 자동재생 정책) */
  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private voice(id: number, buffer: Promise<AudioBuffer>): void {
    const ctx = this.ctx!;
    this.voices.get(id)?.source?.stop();
    const gain = ctx.createGain();
    const pan = typeof StereoPannerNode === 'function' ? new StereoPannerNode(ctx, { pan: 0 }) : null;
    (pan ? gain.connect(pan) : gain).connect(ctx.destination);
    this.voices.set(id, { buffer, gain, pan, source: null });
  }

  apply(c: AudioCall): void {
    const ctx = this.ctx;
    if (!ctx) return;
    switch (c.fn) {
      case 'create_sound_raw': {
        // 채널별로 이어진(planar) float 표본
        const buf = ctx.createBuffer(c.channels, c.samples, c.rate);
        for (let i = 0; i < c.channels; i++) buf.getChannelData(i).set(c.data.subarray(i * c.samples, (i + 1) * c.samples));
        this.voice(c.id, Promise.resolve(buf));
        break;
      }
      case 'create_sound':
        this.voice(c.id, ctx.decodeAudioData(c.data.buffer.slice(c.data.byteOffset, c.data.byteOffset + c.data.byteLength) as ArrayBuffer));
        break;
      case 'duplicate_sound': {
        const src = this.voices.get(c.src);
        if (src) this.voice(c.id, src.buffer);
        break;
      }
      case 'play_sound': {
        const v = this.voices.get(c.id);
        if (!v) return;
        v.source?.stop();
        v.source = null;
        v.gain.gain.value = volumeGain(c.volume);
        if (v.pan) v.pan.pan.value = panValue(c.pan);
        void v.buffer.then((buffer) => {
          // 기다리는 동안 멈추거나 지웠으면 재생하지 않는다
          if (this.voices.get(c.id) !== v || v.source) return;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.loop = c.loop;
          source.connect(v.gain);
          source.onended = () => {
            if (v.source === source) v.source = null;
          };
          source.start();
          v.source = source;
        }).catch(() => undefined);
        break;
      }
      case 'set_volume': {
        const v = this.voices.get(c.id);
        if (v) v.gain.gain.value = volumeGain(c.volume);
        break;
      }
      case 'stop_sound': {
        const v = this.voices.get(c.id);
        if (v) {
          v.source?.stop();
          v.source = null;
        }
        break;
      }
      case 'delete_sound': {
        const v = this.voices.get(c.id);
        if (v) {
          v.source?.stop();
          v.gain.disconnect();
          this.voices.delete(c.id);
        }
        break;
      }
    }
  }

  stopAll(): void {
    for (const v of this.voices.values()) v.source?.stop();
    this.voices.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
