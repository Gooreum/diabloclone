// Act 2~4 퀘스트 대사가 원작 sounds.txt 의 대사 소리로 이어지는지 (실제 원작 표로 검사)
import { describe, expect, it } from 'vitest';
import { parseTxt } from '../../src/formats/txt';
import { questSpeechCandidates } from '../../src/data/sounds';
import { NPC_MESSAGES_ACTS } from '../../src/engine/quests/messages-acts';
import { hasGameData, mustRead } from '../support/gamedata';

describe.skipIf(!hasGameData)('Act 2~4 퀘스트 대사 소리 (원작 sounds.txt)', () => {
  it('표의 대사 키 대부분이 sounds.txt 소리로 이어진다', () => {
    const names = new Set(parseTxt(new TextDecoder().decode(mustRead('data\\global\\excel\\sounds.txt'))).map((r) => r['Sound']?.toLowerCase()));
    const keys = new Map<string, string>();
    for (const tables of Object.values(NPC_MESSAGES_ACTS)) for (const t of tables) for (const m of t) keys.set(`${m.key}|${m.npc}`, m.npc);
    const missing: string[] = [];
    for (const [k, npc] of keys) {
      const key = k.split('|')[0]!;
      if (!questSpeechCandidates(key, npc).some((n) => names.has(n))) missing.push(k);
    }
    const ratio = 1 - missing.length / keys.size;
    // 원작에도 소리가 없는 칸(글자만 나오는 대사)이 조금 있다
    expect(ratio, missing.join(', ')).toBeGreaterThan(0.9);
  });
});
