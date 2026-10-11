// 디아블로 1 (Devilution 웹 빌드) — 메인 스레드(host.ts) ↔ 워커(d1-worker.ts) 메시지.
// 출처: Diablo.jscc 글루가 부르는 self.DApi.* 와 export 하는 _DApi_* (src/d1/vendor/NOTICE.md)

/** 원작 데이터 파일 이름 (워커 안 가상 파일 시스템의 키) */
export type D1MpqName = 'diabdat.mpq' | 'spawn.mpq';
/** 워커로 넘기는 입력 이벤트 — _DApi_Mouse(action, button, mods, x, y) / _DApi_Key(action, mods, vk) / _DApi_Char(code) */
export type D1Event = 'DApi_Mouse' | 'DApi_Key' | 'DApi_Char';

export type ToWorker =
  | { type: 'init'; glueUrl: string; wasmUrl: string; mpq: ArrayBuffer; mpqName: D1MpqName; files: Map<string, Uint8Array>; version: [number, number, number] }
  | { type: 'event'; fn: D1Event; args: number[] }
  /** 화면 키보드 글자 동기화 (_DApi_SyncText). flags 1 = 입력칸을 떠남 */
  | { type: 'text'; text: string; flags: number }
  | { type: 'stop' };

/** 한 번의 draw_blit — 640×480 화면의 (x,y) 에 w×h RGBA */
export interface Blit { x: number; y: number; w: number; h: number; rgba: Uint8ClampedArray }
export interface Frame {
  blits: Blit[];
  texts: { x: number; y: number; text: string; color: number }[];
  clip: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** 소리 — id 는 게임이 정한 번호, volume/pan 은 DirectSound 단위 (1/100 dB) */
export type AudioCall =
  | { fn: 'create_sound_raw'; id: number; data: Float32Array; samples: number; channels: number; rate: number }
  | { fn: 'create_sound'; id: number; data: Uint8Array }
  | { fn: 'duplicate_sound'; id: number; src: number }
  | { fn: 'play_sound'; id: number; volume: number; pan: number; loop: boolean }
  | { fn: 'set_volume'; id: number; volume: number }
  | { fn: 'stop_sound' | 'delete_sound'; id: number };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'frame'; frame: Frame }
  | { type: 'audio'; call: AudioCall }
  | { type: 'file'; op: 'put'; name: string; data: Uint8Array }
  | { type: 'file'; op: 'remove'; name: string }
  /** 화면 키보드: [x0, y0, x1, y1, maxLen] (maxLen < 0 이면 숫자 입력, 최대 -maxLen). null 이면 닫기 */
  | { type: 'keyboard'; rect: [number, number, number, number, number] | null }
  | { type: 'cursor'; x: number; y: number }
  | { type: 'save'; name: string | null }
  | { type: 'exit' }
  | { type: 'error'; message: string; stack?: string };
