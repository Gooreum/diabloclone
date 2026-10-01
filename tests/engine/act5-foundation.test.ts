// 확장팩 Act 5 기반 (Phase 1): 판본별 막 수·저장 막 번호·진행 값·퀘스트 워드.
// 출처: D2MOO GAME/Clients.cpp CLIENTS_UpdateCharacterProgression (진행 값 = nAct + 난이도 × NUM_ACTS, 확장팩 NUM_ACTS 5),
//       PLAYER/PlrSave2.cpp (저장 막이 NUM_ACTS 이상이면 Act I), QUESTS/Quests.h (QUESTSTATEFLAG_A5Q1~A5Q6 = 35~40)
import { describe, expect, it } from 'vitest';
import { ACT_TOWNS, actCount } from '../../src/engine/drlg/acts';
import { ACT_TOWN_KEYS } from '../../src/engine/npc';
import { levelKey } from '../../src/data/world-level';
import { makeSave, parseSave, serializeSave, startActFor } from '../../src/engine/save';
import { QW, questNameKey, questOfWord, wordOfQuest } from '../../src/engine/quests/messages-acts';
import { Game } from '../../src/engine/game';
import { CollisionMap } from '../../src/engine/collision';
import type { Character } from '../../src/engine/player';

const ch = { cls: 'Barbarian', level: 1 } as unknown as Character;

describe('Phase 1: 판본별 막 수', () => {
  it('클래식 4막, 확장팩 5막 — 다섯째 마을은 Harrogath (109)', () => {
    expect(actCount(false)).toBe(4);
    expect(actCount(true)).toBe(5);
    expect(ACT_TOWNS[4]).toBe(109);
    expect(ACT_TOWN_KEYS[4]).toBe('harrogath');
    expect(levelKey(109)).toBe('harrogath');
    expect(levelKey(132)).toBe('worldstonechamber');
  });

  it('저장: 확장팩은 Act 5 (4) 를 지키고 클래식은 Act 1 로 되돌린다', () => {
    const lod = parseSave(serializeSave(makeSave('A', ch, 0, { inventory: [], equipment: {}, act: 4, actByDiff: [4, 4, 0], expansion: true })));
    expect(lod.act).toBe(4);
    expect(lod.actByDiff).toEqual([4, 4, 0]);
    expect(startActFor(lod, 1)).toBe(4);
    const classic = parseSave(serializeSave(makeSave('B', ch, 0, { inventory: [], equipment: {}, act: 4, actByDiff: [4, 4, 0] })));
    expect(classic.act).toBe(0);
    expect(classic.actByDiff).toEqual([0, 0, 0]);
    expect(startActFor(classic, 1)).toBe(0);
  });

  it('퀘스트 워드: A5Q1~A5Q6 = 35~40 ↔ (막 4, 1~6), 이름 키 qstsa5q1', () => {
    expect(QW.A5Q1).toBe(35);
    expect(QW.A5Q6).toBe(40);
    for (let q = 1; q <= 6; q++) {
      expect(questOfWord(wordOfQuest(4, q))).toEqual({ act: 4, quest: q });
      expect(wordOfQuest(4, q)).toBe(34 + q);
    }
    expect(questNameKey(QW.A5Q3)).toBe('qstsa5q3');
    // 기존 막은 그대로
    expect(questOfWord(QW.A4Q2)).toEqual({ act: 3, quest: 2 });
    expect(questOfWord(QW.A4COMPLETED)).toEqual({ act: 3, quest: 4 });
  });

  it('진행 값: 확장팩은 난이도마다 5 (Hell 바알 = 15), 클래식은 4', () => {
    const map = new CollisionMap(8, 8, new Uint8Array(64));
    const mk = (expansion: boolean) => {
      const g = new Game({ map, player: { x: 2, y: 2, walkVelocity: 4, runVelocity: 6 }, seed: 1, difficulty: 2 });
      // 데이터 없이 판본만 (Game.expansion = data.expansion)
      Object.defineProperty(g, 'expansion', { get: () => expansion });
      return g as unknown as { questHost(): { progress(n: number): void }; progression: number };
    };
    const lod = mk(true);
    lod.questHost().progress(5);
    expect(lod.progression).toBe(15);
    const classic = mk(false);
    classic.questHost().progress(4);
    expect(classic.progression).toBe(12);
  });
});
