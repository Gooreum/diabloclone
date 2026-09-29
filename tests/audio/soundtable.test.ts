import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameTables } from '../../src/data/tables';
import {
  ItemSoundTable, MissileSoundTable, MonsterSounds, SkillSoundTable, SoundEnvTable, SoundTable, footstepSound, npcGossipSound, npcGreetingSound,
  objectOpenSound, questSpeechCandidates, resolveSoundPath, weaponSwingSound,
} from '../../src/data/sounds';
import { NPC_MESSAGES } from '../../src/engine/quests/messages';
import { GAME_DATA, gameChain, hasGameData } from '../support/gamedata';
import { MpqFile } from '../support/mpqfile';

const row = (Sound: string, Index: number, FileName: string, extra: Record<string, string> = {}) => ({ Sound, Index: String(Index), FileName, Volume: '200', 'Group Size': '0', ...extra });

describe('sounds.txt 규칙 (합성 표)', () => {
  const t = new SoundTable([
    row('x_1', 10, 'a\\x1.wav', { 'Group Size': '3' }),
    row('x_2', 11, 'a\\x2.wav'),
    row('x_3', 12, 'none.wav'),
    row('y', 13, 'b\\y.wav', { Loop: '1', Falloff: '2', Compound: '8', 'Stop Inst': '1' }),
  ]);
  it('Group Size: 첫 항목부터 N 개 중 roll 번째, none.wav 는 무음', () => {
    expect(t.pick('x_1', 0)?.file).toBe('a\\x1.wav');
    expect(t.pick('x_1', 1)?.file).toBe('a\\x2.wav');
    expect(t.pick('x_1', 2)).toBeUndefined();
    expect(t.pick('x_1', 4)?.file).toBe('a\\x2.wav');
  });
  it('열 해석: 반복·감쇠·중복 간격·겹침 끊기', () => {
    const y = t.get('y');
    expect([y?.loop, y?.falloff, y?.compound, y?.stopInst, y?.volume]).toEqual([true, 2, 8, true, 200]);
    expect(t.get(13)?.name).toBe('y');
  });
  it('경로: sfx → local sfx(대사) → music 순으로 있는 곳', () => {
    const e = t.get('y');
    expect(e && resolveSoundPath(e, (p) => p === 'data\\local\\sfx\\b\\y.wav')).toBe('data\\local\\sfx\\b\\y.wav');
    expect(e && resolveSoundPath(e, () => false)).toBeNull();
  });
  it('퀘스트 대사 키 → 소리 이름', () => {
    expect(questSpeechCandidates('A1Q1InitAkara', 'akara')).toEqual(['akara_act1_q1_init']);
    expect(questSpeechCandidates('A1Q4SuccessfulScrollKashya', 'kashya')).toEqual(['kashya_act1_q4_success_scroll', 'kashya_act1_q4_success']);
    expect(questSpeechCandidates('A1Q1AfterInitCharsiMain', 'charsi')).toEqual(['charsi_act1_q1_after']);
    expect(questSpeechCandidates('A1Q4TragedyOfTristramCain', 'cain5')).toEqual(['cain_act1_q4_tragedy']);
    expect(questSpeechCandidates('Nothing', 'akara')).toEqual([]);
  });
  it('NPC 인사·잡담 (pickGossip 과 같은 번호 규칙)', () => {
    expect(npcGreetingSound('warriv1')).toBe('warriv_greeting_1');
    const has = (k: string) => ['AkaraGossip1', 'AkaraGossip2', 'AkaraGossip4'].includes(k);
    expect(npcGossipSound('akara', 'Akara', 'Barbarian', false, 2, has)).toEqual(['akara_act1_gossip_4']);
    expect(npcGossipSound('akara', 'Akara', 'Sorceress', true, 0, has)).toEqual(['akara_act1_intro_sor', 'akara_act1_intro']);
  });
  it('무기 휘두르기·오브젝트·발소리 대응', () => {
    expect(weaponSwingSound('1hs', false)).toBe('weapon_1hs_small_1');
    expect(weaponSwingSound('hth', false)).toBe('weapon_punch_1');
    expect(objectOpenSound(4, 'chest')).toBe('object_chest_small');
    expect(objectOpenSound(8, 'door')).toBe('object_door_wood_open');
    expect(objectOpenSound(99, 'x')).toBeNull();
    expect(footstepSound(undefined, 0)).toBe('light_walk_dirt_1');
  });
});

const findGd = (n: string) => (existsSync(GAME_DATA) ? readdirSync(GAME_DATA).find((f) => f.toLowerCase() === n) : undefined);
const hasSound = hasGameData && ['d2sfx.mpq', 'd2speech.mpq', 'd2music.mpq'].every((n) => !!findGd(n));

describe.skipIf(!hasSound)('원작 sounds.txt · SoundEnviron · MonSounds', () => {
  const tables = new GameTables(gameChain());
  const sounds = new SoundTable(tables.table('sounds'));
  const soundMpqs = ['d2sfx.mpq', 'd2speech.mpq', 'd2music.mpq'].map((n) => MpqFile.open(resolve(GAME_DATA, findGd(n) as string)));
  const exists = (p: string) => soundMpqs.some((a) => a.has(p)) || gameChain().has(p);
  const path = (name: string, roll = 0) => {
    const e = sounds.pick(name, roll);
    return e ? resolveSoundPath(e, exists) : null;
  };

  it('바바리안 피격 소리 = data\\global\\sfx\\combat\\player\\barbarian\\soft1.wav (5개 묶음)', () => {
    expect(sounds.get('barbarian_hit_1')?.groupSize).toBe(5);
    expect(path('barbarian_hit_1')).toBe('data\\global\\sfx\\combat\\player\\barbarian\\soft1.wav');
    expect(path('barbarian_hit_1', 3)).toBe('data\\global\\sfx\\combat\\player\\barbarian\\hard2.wav');
    expect(path('barbarian_death_1')).toBe('data\\global\\sfx\\combat\\player\\barbarian\\death1.wav');
  });

  it('레벨 음악: 로그 야영지 = town1.wav, Blood Moor = wild.wav, Den of Evil = caves.wav (levels.txt SoundEnv → SoundEnviron Song)', () => {
    const env = new SoundEnvTable(tables.table('SoundEnviron'), tables.table('Levels'));
    const song = (lvl: number) => {
      const e = env.forLevel(lvl);
      return e ? sounds.get(e.song)?.name : undefined;
    };
    expect(song(1)).toBe('music_town_1');
    expect(path('music_town_1')).toBe('data\\global\\music\\act1\\town1.wav');
    expect(sounds.get('music_town_1')?.loop).toBe(true);
    expect(song(2)).toBe('music_wilderness');
    expect(path('music_wilderness')).toBe('data\\global\\music\\act1\\wild.wav');
    expect(song(8)).toBe('music_caves');
    expect(song(38)).toBe('music_tristram');
    // 배경음: 마을·들판 = 낮 들판 소리
    expect(sounds.get(env.forLevel(2)?.dayAmbience ?? 0)?.name).toBe('scene_wilderness_day');
    expect(footstepSound(env.forLevel(1), 1)).toBe('light_walk_wood_1');
  });

  it('몬스터: MonStats.MonSound → MonSounds (좀비 공격·피격·사망)', () => {
    const mon = new MonsterSounds(tables.table('MonSounds'), tables.table('MonStats'));
    const z = mon.of('zombie1');
    expect([z?.attack1, z?.hit, z?.death]).toEqual(['zombie_attack_1', 'zombie_hit_1', 'zombie_death_1']);
    expect(path('zombie_hit_1')).toMatch(/^data\\global\\sfx\\monster\\zombie\\/);
    expect(mon.of('fallen1')?.neutral).toBe('fallen_neutral_1');
  });

  it('아이템: 물약 drop/use (potionui·potiondrink), 금화, 칼', () => {
    const items = new ItemSoundTable(tables.table('weapons'), tables.table('armor'), tables.table('misc'));
    expect(items.of('hp1')).toMatchObject({ drop: 'item_potion', use: 'item_potion_drink' });
    expect(path('item_potion_drink')).toBe('data\\global\\sfx\\item\\potiondrink.wav');
    expect(items.of('gld')?.drop).toBe('item_gold');
    expect(items.of('ssd')?.drop).toBe('item_sword');
    expect(path('item_flippy')).toBe('data\\global\\sfx\\item\\flippy.wav');
  });

  it('스킬·미사일: Fire Bolt stsound, firebolt TravelSound/HitSound', () => {
    const sk = new SkillSoundTable(tables.table('skills'));
    expect(sk.of(36)?.start).toBe('sorceress_cast_fire');
    const ms = new MissileSoundTable(tables.table('Missiles'));
    expect(ms.of('firebolt')).toEqual({ travel: 'sorceress_firebolt_1', hit: 'sorceress_firebolt_impact_1' });
    expect(path('sorceress_firebolt_1')).not.toBeNull();
  });

  it('UI·오브젝트 소리 파일이 원작 MPQ 에 있다', () => {
    for (const n of ['cursor_button_click', 'cursor_level_up', 'object_chest_small', 'object_door_wood_open', 'object_waypoint_open', 'player_townportal_cast', 'object_shrine_holy']) {
      expect(path(n), n).not.toBeNull();
    }
  });

  it('대사: NPC 인사·잡담·퀘스트 대사가 d2speech.mpq (data\\local\\sfx) 에 있다', () => {
    expect(path(npcGreetingSound('akara'))).toBe('data\\local\\sfx\\act1\\akara\\aka_hello.wav');
    expect(path('akara_act1_gossip_1')).toBe('data\\local\\sfx\\act1\\akara\\aka_act1_gossip_01.wav');
    expect(path(questSpeechCandidates('A1Q1InitAkara', 'akara')[0] ?? '')).toBe('data\\local\\sfx\\act1\\akara\\aka_act1_q1_init.wav');
    // Act 1 퀘스트 대사 표의 모든 키가 소리로 이어진다 (후보 중 하나)
    const missing: string[] = [];
    for (const groups of Object.values(NPC_MESSAGES)) {
      for (const g of groups) {
        for (const m of g) {
          const c = questSpeechCandidates(m.key, m.npc);
          if (!c.some((n) => path(n))) missing.push(m.key);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
