// 룬워드: runes.txt (확장팩). 소켓을 꽉 채운 하급·일반·상급 아이템에 정해진 룬을 순서대로 박으면 완성된다.
// 출처: D2MOO D2Common Items.cpp ITEMS_GetRunesTxtRecordFromItem — 품질 매직~템퍼(4~9) 아님 · 퀘스트 아님 · 소켓 수 = 박힌 수 ·
//       complete · Rune1..6 이 박힌 순서와 같음 · etype1..3 에 해당하지 않고 itype1..6 중 하나에 해당
//       ItemMods.cpp ITEMMODS_UpdateRuneword — T1Code1..7 속성을 아이템 자체 속성으로 (한 번 굴림)
import type { TxtRow } from '../formats/txt';
import type { ItemDb } from './items';
import { parseMods, type Mod } from './itemgen';
import { QUALITY, type ItemInstance } from './treasure';

export interface Runeword {
  /** runes.txt 행 번호 (저장되는 값) */
  idx: number;
  /** Name (string.tbl 키, 예: Runeword1) */
  key: string;
  /** Rune Name (표에 적힌 영문 이름) */
  name: string;
  itypes: string[];
  etypes: string[];
  runes: string[];
  mods: Mod[];
}

export class RunewordDb {
  readonly list: Runeword[] = [];
  private readonly byIdx = new Map<number, Runeword>();

  constructor(rows: TxtRow[]) {
    rows.forEach((r, idx) => {
      if (r.complete !== '1') return;
      const rw: Runeword = {
        idx, key: r.Name ?? '', name: r['Rune Name'] ?? '',
        itypes: [1, 2, 3, 4, 5, 6].map((i) => r[`itype${i}`] ?? '').filter(Boolean),
        etypes: [1, 2, 3].map((i) => r[`etype${i}`] ?? '').filter(Boolean),
        runes: [1, 2, 3, 4, 5, 6].map((i) => r[`Rune${i}`] ?? '').filter(Boolean),
        mods: parseMods(r, 'T1Code#', 'T1Param#', 'T1Min#', 'T1Max#', 7),
      };
      this.list.push(rw);
      this.byIdx.set(idx, rw);
    });
  }

  get(idx: number | undefined): Runeword | undefined {
    return idx === undefined ? undefined : this.byIdx.get(idx);
  }

  /** 이 아이템이 완성하는 룬워드 (없으면 null) */
  match(items: ItemDb, item: ItemInstance): Runeword | null {
    if (item.runeword !== undefined) return null;
    if (item.quality >= QUALITY.MAGIC) return null;
    const b = items.base(item.code);
    if (!b || b.quest) return null;
    if (item.sockets <= 0 || item.socketed.length !== item.sockets) return null;
    const codes = item.socketed.map((g) => g.code);
    for (const rw of this.list) {
      if (rw.runes.length !== codes.length || rw.runes.some((c, i) => codes[i] !== c)) continue;
      if (rw.etypes.some((t) => items.isType(b, t))) continue;
      if (!rw.itypes.some((t) => items.isType(b, t))) continue;
      return rw;
    }
    return null;
  }
}
