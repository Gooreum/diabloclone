// 코드에 "근사"(원작과 다르게 짐작으로 맞춘 곳)로 표시된 줄을 모아 docs/fidelity-approximations.md 를 만든다: node scripts/list-approximations.mjs
// 원본대로 바꾼 곳은 주석에서 "근사" 를 지우면 목록에서 빠진다 — 남은 개수가 곧 남은 일.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});

/** 영역: [이름, 플레이에 보이는가, 경로 판정] — 위에서부터 먼저 맞는 것 */
const AREAS = [
  ['전투·스킬·이동 (엔진 핵심)', '보임 (동작이 달라짐)', (f) => f === 'src/engine/game.ts'],
  ['몬스터·NPC 판단 (AI)', '보임 (동작이 달라짐)', (f) => f.startsWith('src/engine/ai/')],
  ['퀘스트 진행·대사 연결', '일부 보임', (f) => f.startsWith('src/engine/quests/')],
  ['맵 생성 (DRLG)', '보임 (지형 배치)', (f) => f.startsWith('src/engine/drlg/')],
  ['그 밖의 엔진 (상점·용병·스탯·유니크·조명 등)', '일부 보임', (f) => f.startsWith('src/engine/')],
  ['화면 UI (패널·글자·배치)', '보임 (모양만)', (f) => f.startsWith('src/ui/')],
  ['그리기 (렌더)', '보임 (모양만)', (f) => f.startsWith('src/render/')],
  ['소리', '들림 (타이밍·선택)', (f) => f.startsWith('src/audio/') || f === 'src/data/sounds.ts'],
  ['입력·기타', '일부 보임', () => true],
];

const rows = [];
for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file);
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.includes('근사')) return;
    const text = line.trim().replace(/^\/\/\s?|^\*\s?|^\/\*\*?\s?|\*\/$/g, '').replace(/\|/g, '\\|').trim();
    rows.push({ rel, line: i + 1, text: text.length > 220 ? `${text.slice(0, 217)}…` : text });
  });
}

const byArea = AREAS.map(([name, visible, test]) => ({ name, visible, items: [] }));
for (const r of rows) byArea[AREAS.findIndex(([, , test]) => test(r.rel))].items.push(r);

const out = [
  '# 짐작으로 맞춘 곳 목록 ("근사" 표시)',
  '',
  '`node scripts/list-approximations.mjs` 가 코드 주석에서 자동으로 뽑는다. 원본 코드(D2MOO)나 원작 실측으로 확인해 고치면 주석의 "근사" 를 지우고 다시 돌린다.',
  '',
  `전체 ${rows.length}곳.`,
  '',
  '| 영역 | 개수 | 플레이에 보이는가 |',
  '|---|---|---|',
  ...byArea.filter((a) => a.items.length).map((a) => `| ${a.name} | ${a.items.length} | ${a.visible} |`),
  '',
];
for (const a of byArea) {
  if (!a.items.length) continue;
  out.push(`## ${a.name} (${a.items.length})`, '');
  let cur = '';
  for (const r of a.items) {
    if (r.rel !== cur) {
      cur = r.rel;
      out.push(`**\`${cur}\`**`, '');
    }
    out.push(`- \`:${r.line}\` ${r.text}`);
  }
  out.push('');
}
writeFileSync(join(root, 'docs/fidelity-approximations.md'), out.join('\n'));
console.log(`근사 ${rows.length}곳 → docs/fidelity-approximations.md`);
for (const a of byArea) if (a.items.length) console.log(`  ${a.items.length}\t${a.name}`);
