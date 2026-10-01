// D2MOO SequenceTbls.cpp → src/engine/skills/sequences.ts 생성
// 사용: curl -sL https://raw.githubusercontent.com/ThePhrozenKeep/D2MOO/master/source/D2Common/src/DataTbls/SequenceTbls.cpp -o /tmp/SequenceTbls.cpp
//       node scripts/gen-sequences.mjs /tmp/SequenceTbls.cpp src/engine/skills/sequences.ts
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(process.argv[2], 'utf8');
const MODE = { ATTACK1: 'A1', ATTACK2: 'A2', SPECIAL1: 'S1', SPECIAL3: 'S3', SPECIAL4: 'S4', CAST: 'SC', KICK: 'KK', THROW: 'TH', RUN: 'RN' };
const EV = { NONE: 0, MELEE_ATTACK: 1, PLAY_SOUND: 2 };
const arrays = {};
for (const m of src.matchAll(/D2AnimSeqTxt (\w+)\[\d+\] =\s*\{([\s\S]*?)\n\};/g)) {
  const rows = [...m[2].matchAll(/\{\s*\d+,\s*(PLRMODE_(\w+)|0),\s*(\d+),\s*(\d+),\s*ANIMSEQ_EVENT_(\w+)\s*\}/g)].map((r) => {
    const mode = r[2] ? MODE[r[2]] : 'NU';
    if (!mode) throw new Error('mode ' + r[2]);
    return [mode, Number(r[3]), EV[r[5]] ?? 0];
  });
  arrays[m[1]] = rows;
}
const weap = {};
for (const m of src.matchAll(/D2PlayerWeaponSequencesStrc (\w+) =\s*\{([\s\S]*?)\n\};/g)) {
  weap[m[1]] = [...m[2].matchAll(/(\w+),\s*(\d+),\s*(\d+)/g)].map((r) => r[1]);
}
const table = [...src.match(/gPlayerWeaponsSequenceTable\[24\] =\s*\{([\s\S]*?)\};/)[1].matchAll(/(NULL|&(\w+))/g)].map((r) => r[2] ?? null);
const WCLASS = ['HTH', '1HT', '2HT', '1HS', '2HS', 'BOW', 'XBW', 'STF', '1JS', '1JT', '1SS', '1ST', 'HT1', 'HT2'];
const used = new Set();
const out = {};
table.forEach((name, seq) => {
  if (!name) return;
  const recs = weap[name];
  out[seq] = Object.fromEntries(WCLASS.map((w, i) => [w, recs[i]]).filter(([, n]) => n && n !== '0' && arrays[n]));
  for (const n of Object.values(out[seq])) used.add(n);
});
let ts = `// 플레이어 스킬 애니메이션 시퀀스 (skills.txt seqnum 1~23, 16~ 은 확장팩). scripts/gen-sequences.mjs 로 생성.
// 출처: D2MOO source/D2Common/src/DataTbls/SequenceTbls.cpp — gPlayerSequence* 배열, gPlayerWeaponsSequenceTable,
//       gWeaponIndexToClassMap (무기 클래스 순서 HTH 1HT 2HT 1HS 2HS BOW XBW STF 1JS 1JT 1SS 1ST HT1 HT2)
// 각 프레임 = [플레이어 모드 토큰, 그 모드 애니메이션의 프레임, 이벤트(0 없음, 1 근접 타격, 2 소리)]
export type SeqFrame = readonly [mode: string, frame: number, event: number];

const F = {\n`;
for (const k of [...used].sort()) ts += `  ${k}: ${JSON.stringify(arrays[k])},\n`;
ts += `} as const satisfies Record<string, readonly SeqFrame[]>;\n\n/** seqnum → 무기 클래스 → 프레임 목록 (원작에서 비어있는 무기 클래스는 없음) */\nexport const PLAYER_SEQUENCES: Record<number, Partial<Record<string, readonly SeqFrame[]>>> = {\n`;
for (const [seq, m] of Object.entries(out)) ts += `  ${seq}: { ${Object.entries(m).map(([w, n]) => `'${w}': F.${n}`).join(', ')} },\n`;
ts += `};\n`;
writeFileSync(process.argv[3], ts);
console.log(Object.keys(out), used.size);
