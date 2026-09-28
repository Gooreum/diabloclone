// 원작 excel 테이블(data\global\excel\*.txt): 탭 구분, 첫 줄이 헤더.
// 출처: Phrozen Keep — File Guides for 1.10+ (https://d2mods.info/forum/kb/index?c=4)

export type TxtRow = Record<string, string>;

export function parseTxt(text: string): TxtRow[] {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? '').split('\t');
  const rows: TxtRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;
    const cells = line.split('\t');
    const row: TxtRow = {};
    header.forEach((h, j) => {
      if (h !== '' && !(h in row)) row[h] = cells[j] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

/** 첫 컬럼 값이 'Expansion' 인 구분 행을 기준으로 클래식 행만 남긴다 (클래식 규칙). */
export function classicRows(rows: TxtRow[], firstColumn: string): TxtRow[] {
  const idx = rows.findIndex((r) => (r[firstColumn] ?? '').toLowerCase() === 'expansion');
  return idx < 0 ? rows : rows.slice(0, idx);
}
