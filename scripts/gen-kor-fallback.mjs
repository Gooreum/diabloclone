#!/usr/bin/env node
// 자체 한국어 번역 JSON(out-*.json) 을 원작 MPQ 와 대조·검증해 src/data/lang/kor-fallback.ts 로 만든다.
// 사용: node scripts/gen-kor-fallback.mjs <번역 JSON 폴더> [game-data]
// 규칙: 키는 eng\expansionstring.tbl ∪ eng\patchstring.tbl 에 있어야 하고, kor\string.tbl ∪ kor\patchstring.tbl 에 있으면 버린다(공식 값 우선).
//       자리 표시자(%d/%s/%+d/%%…)·색 코드(ÿc?)·대사 앞 숫자는 영어 원문과 같아야 한다. 뒤 파일이 앞 파일을 덮고, out-affix.json 은 맨 뒤.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MpqArchive, MpqChain } from '../src/formats/mpq.ts';
import { parseTbl } from '../src/formats/tbl.ts';

const [dir, gameData = 'game-data'] = process.argv.slice(2);
if (!dir) { console.error('사용: node scripts/gen-kor-fallback.mjs <번역 JSON 폴더> [game-data]'); process.exit(2); }
const mpq = (n) => [join(gameData, 'lod', n), join(gameData, n)].find((p) => existsSync(p));
const chain = new MpqChain(['patch_d2.mpq', 'd2exp.mpq', 'd2data.mpq'].map((n) => MpqArchive.open(readFileSync(mpq(n)))));
const tbl = (lang, file, enc) => { const b = chain.read(`data\\local\\lng\\${lang}\\${file}`); return b ? parseTbl(b, enc) : new Map(); };
const eng = new Map([...tbl('eng', 'string.tbl', 'latin1'), ...tbl('eng', 'expansionstring.tbl', 'latin1'), ...tbl('eng', 'patchstring.tbl', 'latin1')]);
const engBase = tbl('eng', 'string.tbl', 'latin1');
const kor = new Map([...tbl('kor', 'string.tbl', 'utf-8'), ...tbl('kor', 'expansionstring.tbl', 'utf-8'), ...tbl('kor', 'patchstring.tbl', 'utf-8')]);

const files = readdirSync(dir).filter((f) => /^out-.*\.json$/.test(f)).sort((a, b) => (a === 'out-affix.json') - (b === 'out-affix.json') || a.localeCompare(b));
const merged = {};
for (const f of files) Object.assign(merged, JSON.parse(readFileSync(join(dir, f), 'utf8')));
console.log('입력:', files.join(', '));

const ph = (s) => (s.match(/%[+-]?\d*[dsiu%]/g) ?? []).sort().join(',');
const cc = (s) => (s.match(/ÿc./g) ?? []).sort().join(',');
const lead = (s) => /^(\d+)\n/.exec(s)?.[1] ?? '';
const errors = [];
let dropped = 0;
for (const [k, v] of Object.entries(merged)) {
  const e = eng.get(k);
  if (e === undefined) { errors.push(`원작에 없는 키: ${k}`); continue; }
  if (kor.has(k)) { delete merged[k]; dropped++; continue; }
  if (typeof v !== 'string' || (!v.trim() && e.trim())) errors.push(`빈 번역: ${k}`);
  else {
    if (ph(e) !== ph(v)) errors.push(`자리 표시자 다름: ${k} (${ph(e)} vs ${ph(v)})`);
    if (cc(e) !== cc(v)) errors.push(`색 코드 다름: ${k}`);
    if (lead(e) !== lead(v)) errors.push(`대사 앞 숫자 다름: ${k}`);
  }
}
if (errors.length) { console.error(errors.join('\n')); console.error(`실패: ${errors.length}개`); process.exit(1); }
// 빠진 키 (한국어가 없는 확장팩 키인데 번역이 없는 것)
const need = [...eng.keys()].filter((k) => !engBase.has(k) && !kor.has(k));
const missing = need.filter((k) => !(k in merged));
if (missing.length) console.warn(`경고: 번역 없는 키 ${missing.length}개 — ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`);

const keys = Object.keys(merged).sort();
const header = `// 자체 한국어 번역: 원작 kor\\string.tbl·kor\\patchstring.tbl 에 없는 확장팩 문자열 (eng\\expansionstring.tbl + patchstring 일부).
// 근사(원작 미확인): 원작 한국어 LoD 의 공식 번역이 아니라 이 저장소의 번역이다 — 사용자 MPQ 에 kor\\expansionstring.tbl 이 있으면 그 값이 우선한다 (GameTables.string).
// 생성: node scripts/gen-kor-fallback.mjs <번역 JSON 폴더> (원작 키·자리 표시자 검증 뒤 이 파일을 다시 쓴다). 손으로 고쳐도 된다.
`;
const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(merged[k])},`).join('\n');
const out = resolve('src/data/lang/kor-fallback.ts');
writeFileSync(out, `${header}export const KOR_FALLBACK: Readonly<Record<string, string>> = {\n${body}\n};\n`);
const chars = keys.reduce((s, k) => s + merged[k].length, 0);
console.log(`${keys.length} keys, ${chars} chars → ${out}${dropped ? ` (공식 표에 있어 버린 키 ${dropped}개)` : ''}`);
