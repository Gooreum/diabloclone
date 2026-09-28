// DS1: 미리 만들어진 맵 조각 (마을·특수 방 등). 레이어별 셀 = 타일 참조.
// 출처: Paul Siramy — "DS1 file format" (Phrozen Keep, https://d2mods.info/forum/kb/viewarticle?a=22)
// 출처: OpenDiablo2 d2ds1 — 버전별 필드 존재 조건과 레이어 순서

export interface Ds1Cell { prop1: number; sequence: number; style: number; hidden: boolean; orientation: number }
export interface Ds1Object { type: number; id: number; x: number; y: number; flags: number; path: { x: number; y: number; action: number }[] }
export interface Ds1 {
  version: number;
  width: number;
  height: number;
  act: number;
  substitutionType: number;
  files: string[];
  walls: Ds1Cell[][];
  floors: Ds1Cell[][];
  shadows: Ds1Cell[][];
  objects: Ds1Object[];
}

// 출처: DS1 문서 — 버전 7 미만의 방향 값 변환 표
const DIR_LOOKUP = [0x00, 0x01, 0x02, 0x01, 0x02, 0x03, 0x03, 0x05, 0x05, 0x06, 0x06, 0x07, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x14];

export function parseDs1(buf: Uint8Array): Ds1 {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  const i32 = () => {
    if (p + 4 > buf.length) throw new Error('ds1: truncated');
    const v = dv.getInt32(p, true);
    p += 4;
    return v;
  };
  const version = i32();
  const width = i32() + 1;
  const height = i32() + 1;
  let act = 0;
  if (version >= 8) act = Math.min(i32(), 4);
  let substitutionType = 0;
  if (version >= 10) substitutionType = i32();
  const files: string[] = [];
  if (version >= 3) {
    const n = i32();
    for (let i = 0; i < n; i++) {
      let e = p;
      while (e < buf.length && buf[e] !== 0) e++;
      files.push(new TextDecoder('latin1').decode(buf.subarray(p, e)));
      p = e + 1;
    }
  }
  if (version >= 9 && version <= 13) p += 8;
  let numWalls = 1, numFloors = 1;
  if (version >= 4) {
    numWalls = i32();
    numFloors = version >= 16 ? i32() : 1;
  }
  const numTags = substitutionType === 1 || substitutionType === 2 ? 1 : 0;
  const cells = width * height;
  const readLayer = (): number[] => {
    if (p + cells * 4 > buf.length) throw new Error('ds1: layer out of range');
    const out: number[] = [];
    for (let i = 0; i < cells; i++) out.push(dv.getUint32(p + i * 4, true));
    p += cells * 4;
    return out;
  };
  const toCell = (dw: number, orientation = 0): Ds1Cell => ({
    prop1: dw & 0xff,
    sequence: (dw >>> 8) & 0x3f,
    style: (dw >>> 20) & 0x3f,
    hidden: ((dw >>> 24) & 0x80) !== 0,
    orientation,
  });
  const wallRaw: number[][] = [], orientRaw: number[][] = [], floorRaw: number[][] = [];
  let shadowRaw: number[] = [];
  if (version < 4) {
    wallRaw.push(readLayer());
    floorRaw.push(readLayer());
    orientRaw.push(readLayer());
    if (numTags) readLayer();
    shadowRaw = readLayer();
  } else {
    for (let i = 0; i < numWalls; i++) {
      wallRaw.push(readLayer());
      orientRaw.push(readLayer());
    }
    for (let i = 0; i < numFloors; i++) floorRaw.push(readLayer());
    shadowRaw = readLayer();
    if (numTags) readLayer();
  }
  const walls = wallRaw.map((layer, li) =>
    layer.map((dw, i) => {
      const o = (orientRaw[li]?.[i] ?? 0) & 0xff;
      return toCell(dw, version < 7 ? DIR_LOOKUP[o] ?? o : o);
    }),
  );
  const floors = floorRaw.map((layer) => layer.map((dw) => toCell(dw)));
  const shadows = [shadowRaw.map((dw) => toCell(dw, 13))];

  const objects: Ds1Object[] = [];
  if (version >= 2 && p + 4 <= buf.length) {
    const n = i32();
    for (let i = 0; i < n; i++) {
      const type = i32(), id = i32(), x = i32(), y = i32();
      const flags = version > 5 ? i32() : 0;
      objects.push({ type, id, x, y, flags, path: [] });
    }
  }
  // 그룹 (버전 12 이상 + 태그 레이어) — 현재는 건너뛴다
  if (version >= 12 && numTags && p + 4 <= buf.length) {
    if (version >= 18) p += 4;
    const n = i32();
    p += n * (version >= 13 ? 20 : 16);
  }
  // NPC 경로 (버전 14 이상): 위치가 일치하는 오브젝트에 연결
  if (version >= 14 && p + 4 <= buf.length) {
    const n = i32();
    for (let i = 0; i < n; i++) {
      const points = i32(), ox = i32(), oy = i32();
      const path: Ds1Object['path'] = [];
      for (let k = 0; k < points; k++) {
        const x = i32(), y = i32();
        path.push({ x, y, action: version >= 15 ? i32() : 1 });
      }
      const obj = objects.find((o) => o.x === ox && o.y === oy);
      if (obj) obj.path = path;
    }
  }
  return { version, width, height, act, substitutionType, files, walls, floors, shadows, objects };
}

/** DS1 가 참조하는 파일 경로를 MPQ 내부 경로로 정규화 ("\d2\data\..." → "data\...", .tg1 → .dt1) */
export function normalizeDs1File(f: string): string {
  return f.replace(/\//g, '\\').replace(/^.*?(data\\)/i, '$1').replace(/\.tg1$/i, '.dt1');
}

export interface TileRef { x: number; y: number; orientation: number; style: number; sequence: number }

/** 렌더 대상 바닥 셀 목록 — 빈 셀(prop1=0)과 숨김 셀은 제외 */
export function floorTileRefs(ds1: Ds1): TileRef[] {
  const out: TileRef[] = [];
  for (const layer of ds1.floors) {
    layer.forEach((c, i) => {
      if (c.prop1 === 0 || c.hidden) return;
      out.push({ x: i % ds1.width, y: Math.floor(i / ds1.width), orientation: 0, style: c.style, sequence: c.sequence });
    });
  }
  return out;
}
