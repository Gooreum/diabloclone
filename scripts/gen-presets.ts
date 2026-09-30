// 개발용 프리셋 캐릭터 JSON 생성: npx tsx scripts/gen-presets.ts
// game-data/ 의 원작 MPQ (patch_d2 > d2char > d2data) 표를 읽어 src/presets/<id>.json 과 SUMMARY.md 를 쓴다.
// JSON 에는 세이브 형식의 코드·수치만 들어간다 (그림·소리 같은 원작 에셋 없음).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MpqArchive, MpqChain } from '../src/formats/mpq';
import { GameTables } from '../src/data/tables';
import { buildGameData } from '../src/data/gamedata';
import { PRESETS, buildPreset, summaryMarkdown } from '../src/engine/presets';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'game-data');
const find = (n: string) => (existsSync(dir) ? readdirSync(dir).find((f) => f.toLowerCase() === n) : undefined);
const names = ['patch_d2.mpq', 'd2char.mpq', 'd2data.mpq'];
if (!names.every(find)) throw new Error('game-data/ 에 patch_d2.mpq, d2char.mpq, d2data.mpq 가 필요합니다');
const chain = new MpqChain(names.map((n) => MpqArchive.open(readFileSync(resolve(dir, find(n) as string)))));
const tables = new GameTables(chain);
const data = buildGameData(chain, tables);

const parts = ['# 개발용 프리셋 캐릭터 (99레벨, 클래식)', '', '`npx tsx scripts/gen-presets.ts` 가 원작 표에서 만든다. 개발 서버에서 `?preset=<직업>` 으로 Hell Act 1 마을에서 바로 시작, `?preset=all` 은 캐릭터 목록에 5개를 넣는다.', ''];
for (const spec of PRESETS) {
  const { save, summary } = buildPreset(spec, data, { charstats: tables.table('charstats'), experience: tables.table('experience') });
  writeFileSync(resolve(root, 'src/presets', `${spec.id}.json`), `${JSON.stringify(save, null, 1)}\n`);
  parts.push(summaryMarkdown(summary));
  console.log(`[프리셋] ${spec.id}: 레벨 ${save.character.level}, 힘 ${save.character.str} 민첩 ${save.character.dex} 활력 ${save.character.vit} 에너지 ${save.character.ene}${summary.unmet.length ? `, 못 붙인 옵션 ${summary.unmet.join(' ')}` : ''}`);
}
writeFileSync(resolve(root, 'src/presets/SUMMARY.md'), parts.join('\n'));
