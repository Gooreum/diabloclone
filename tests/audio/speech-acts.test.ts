// Act 2~4 퀘스트 대사가 원작 sounds.txt 의 대사 소리로 이어지는지 (실제 원작 표로 검사)
import { describe, expect, it } from 'vitest';
import { parseTxt } from '../../src/formats/txt';
import { npcSoundName, questPlayerSound, questSpeechCandidates } from '../../src/data/sounds';
import { NPC_MESSAGES_ACT5 } from '../../src/engine/quests/messages-act5';
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

// 확장팩 Act 5: 퀘스트 대사·Anya·Qual-Kehk·고대인 이름, 플레이어 퀘스트 목소리 (원작 소리 33~83)
describe.skipIf(!hasGameData)('Act 5 퀘스트 대사·플레이어 퀘스트 목소리 (확장팩 sounds.txt)', () => {
  const names = () => new Set(parseTxt(new TextDecoder().decode(mustRead('data\\global\\excel\\sounds.txt'))).map((r) => r['Sound']?.toLowerCase()));
  it('Act 5 표의 대사 키 대부분이 sounds.txt 소리로 이어진다', () => {
    const all = names();
    test5(all);
  });
  const test5 = (all: Set<string | undefined>) => {
    const keys = new Map<string, string>();
    for (const tables of Object.values(NPC_MESSAGES_ACT5)) for (const t of tables) for (const m of t) keys.set(`${m.key}|${m.npc}`, m.npc);
    const missing: string[] = [];
    for (const [k, npc] of keys) if (!questSpeechCandidates(k.split('|')[0]!, npc).some((n) => all.has(n))) missing.push(k);
    expect(1 - missing.length / keys.size, missing.join(', ')).toBeGreaterThan(0.9);
  };
  it('이름 규칙: Malah 얼음 Anya 찾음 · Qual-Kehk · Anya · 고대인', () => {
    expect(questSpeechCandidates('A5Q3FoundAnyaMalah', 'malah')).toContain('malah_act5_q3_found');
    expect(questSpeechCandidates('A5Q2InitQualKehk', 'qual-kehk')).toContain('qualkehk_act5_q2_init');
    expect(questSpeechCandidates('A5Q4InitAnya', 'drehya')).toContain('anya_act5_q4_init');
    expect(questSpeechCandidates('AncientsAct5IntroGossip1', 'ancientstatue1')).toEqual(['ancient_act5_intro']);
    expect(questSpeechCandidates('A1Q1InitAkara', 'akara')).toContain('akara_act1_q1_init');
    expect(npcSoundName('qual-kehk')).toBe('qualkehk');
    expect(npcSoundName('drehyaiced')).toBe('anya');
  });
  it('플레이어 퀘스트 목소리: 39 케언 석 · 45 이누피스 나무 · 80~83 Shenk·포로·Nihlathak·바알 (직업마다 sounds.txt 에 있다)', () => {
    const all = names();
    expect(questPlayerSound('Amazon', 39)).toBe('amazon_act1_find_cairn');
    expect(questPlayerSound('Amazon', 45)).toBe('amazon_act1_find_tree');
    expect(questPlayerSound('Druid', 80)).toBe('druid_act5_defeat_overseer');
    expect(questPlayerSound('Assassin', 83)).toBe('assassin_act5_defeat_baal');
    for (const cls of ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian', 'Druid', 'Assassin']) {
      for (let n = 33; n <= 83; n++) expect(all.has(questPlayerSound(cls, n)!), `${cls} ${n}`).toBe(true);
    }
    expect(questPlayerSound('Amazon', 84)).toBeNull();
  });
});
