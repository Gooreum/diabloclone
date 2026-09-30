// 스냅샷 → 깊이 정렬용 그리기 목록 (플레이어·몬스터·바닥 아이템) + 클릭 판정 상자.
import type { AnimData } from '../formats/animdata';
import type { ItemDb } from '../engine/items';
import type { MonsterDb } from '../engine/monster';
import { OBJMODE_TOKENS, type ObjectDb } from '../engine/objects';
import type { WorldSnapshot } from '../engine/game';
import type { PickBox } from '../input/dom';
import { toCanvas, type Camera } from './iso';
import type { ItemGfx, MissileGfx, UnitGfx } from './units';
import type { DepthSprite } from './world';

/** 몬스터가 보이면 미리 불러 둘 동작 (NU·WL 외): 맞기 GH, 공격 A1, 죽기 DT·시체 DD */
const PRELOAD_MODES = ['GH', 'A1', 'DT', 'DD', 'WL'] as const;

export interface SceneDeps {
  units: UnitGfx;
  items: ItemGfx;
  missiles?: MissileGfx;
  anim: AnimData;
  monsters?: MonsterDb;
  itemDb?: ItemDb;
  playerToken: string;
  playerWclass: string;
  playerEquip: Record<string, string>;
  /** 플레이어 시체 외형 (장착 레이어·무기 클래스) */
  corpseLook?: { equip: Record<string, string>; wclass: string };
  inTown: boolean;
  /** objects.txt (오브젝트 그래픽 토큰·애니메이션·선택 상자) */
  objectDb?: ObjectDb;
  /** 마우스를 올린 유닛 (지난 프레임 클릭 상자 기준) — 밝게 그린다 */
  hover?: { kind: string; id: number } | null;
}

/** 오브젝트 COF 레이어는 모두 기본 외형 'lit' (출처: objects.txt HD~S8 = 레이어 사용 여부, 원작 오브젝트 DCC 이름 <토큰><레이어>LIT<모드>HTH) */
const OBJECT_EQUIP: Record<string, string> = Object.fromEntries(['HD', 'TR', 'LG', 'RA', 'LA', 'RH', 'LH', 'SH', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].map((l) => [l, 'lit']));

const animFrame = (anim: AnimData, key: string, modeTick: number, loop = true): number => {
  const r = anim.get(key);
  if (!r) return 0;
  const f = Math.floor((modeTick * r.speed) / 256);
  return loop ? f : Math.min(f, r.frames - 1);
};

export function buildScene(s: Readonly<WorldSnapshot>, cam: Camera, d: SceneDeps, picks: PickBox[]): DepthSprite[] {
  const out: DepthSprite[] = [];
  picks.length = 0;
  // 화면 밖 유닛은 그리지 않는다 (여유 200px)
  const onScreen = (x: number, y: number) => {
    const p = toCanvas(cam, x, y);
    return p.x > -200 && p.x < cam.width + 200 && p.y > -200 && p.y < cam.height + 300;
  };

  // 바닥 아이템 (깊이는 약간 앞으로 — 유닛보다 먼저 그려 발밑에 놓임)
  for (const it of s.items) {
    if (!onScreen(it.x, it.y)) continue;
    const base = d.itemDb?.base(it.code);
    if (!base?.flippyFile) continue;
    out.push({
      depth: it.x + it.y - 0.5,
      draw: (ctx, cm) => {
        const p = toCanvas(cm, it.x, it.y);
        const size = d.items.draw(ctx, base.flippyFile, p.x, p.y);
        if (size) picks.push({ kind: 'item', id: it.id, x: size.x - 4, y: size.y - 4, w: size.w + 8, h: size.h + 8 });
      },
    });
  }

  // 오브젝트: objects.txt 토큰의 COF(모드 NU/OP/ON/S1…) 합성, 프레임 = Start + 틱 × FrameDelta / 256 (CycleAnim 이면 반복, 아니면 마지막 프레임에서 멈춤)
  // 출처: objects.txt FrameDelta/CycleAnim/Start, DrawUnder (바닥에 깔리는 오브젝트는 유닛보다 먼저)
  for (const o of s.objects ?? []) {
    if (!onScreen(o.x, o.y)) continue;
    const t = d.objectDb?.type(o.classId);
    if (!t || !t.token) continue;
    const mode = OBJMODE_TOKENS[o.mode] ?? 'NU';
    const comp = d.units.get({ root: 'OBJECTS', token: t.token, mode, wclass: 'HTH', equip: OBJECT_EQUIP });
    const raw = (t.start[o.mode] ?? 0) + Math.floor((o.modeTick * (t.frameDelta[o.mode] ?? 256)) / 256);
    out.push({
      depth: o.x + o.y - (t.drawUnder ? 4 : 0),
      draw: (ctx, cm) => {
        const p = toCanvas(cm, o.x, o.y);
        if (!comp) return;
        const fpd = comp.cof.framesPerDirection;
        const frame = t.cycleAnim[o.mode] ? raw % fpd : Math.min(raw, fpd - 1);
        const box = d.units.draw(ctx, comp, 0, frame, p.x, p.y, !!o.selectable && d.hover?.kind === 'object' && d.hover.id === o.id);
        if (!o.selectable) return;
        // 선택 상자: objects.txt Left/Top/Width/Height (있으면), 없으면 그림 영역
        if (t.width > 0 && t.height > 0) picks.push({ kind: 'object', id: o.id, x: p.x + t.left, y: p.y + t.top, w: t.width, h: t.height });
        else if (box) picks.push({ kind: 'object', id: o.id, x: box.x, y: box.y, w: box.w, h: box.h });
      },
    });
  }

  for (const m of s.monsters) {
    if (!onScreen(m.x, m.y)) continue;
    const t = d.monsters?.types.get(m.typeId);
    if (!t) continue;
    const equip: Record<string, string> = {};
    // 레이어 외형: 엔진이 고른 변형 (원작 레벨 몬스터 영역의 외형 세트)
    for (const [layer, variants] of Object.entries(t.layers)) {
      const v = variants[(m.components?.[layer] ?? m.id) % variants.length] ?? 'lit';
      if (v !== 'nil') equip[layer] = v;
    }
    // 색: 변종 palshift / 유니크 RandTransforms (불러오는 중이면 한 프레임 쉰다)
    const shift = d.units.monsterShift(t.code, t.transLvl, m.uniqueTrans);
    if (shift === undefined) continue;
    // 시퀀스(SQ): 엔진이 준 모드·프레임 (monseq.txt)
    const mode = m.anim?.mode ?? m.mode;
    const spec = { root: 'MONSTERS' as const, token: t.code, mode, wclass: t.baseW, equip, shift };
    const comp = d.units.getFor(`m${m.id}`, spec);
    // 싸움에서 곧 쓸 동작(맞기·공격·걷기·죽기) 그림을 미리 불러 둔다 (처음 맞을 때 그림이 늦게 와 깜박이지 않게)
    if (m.mode === 'NU' || m.mode === 'WL') for (const pre of PRELOAD_MODES) d.units.get({ ...spec, mode: pre });
    const loop = !(m.mode === 'DT' || m.mode === 'DD') && ['NU', 'WL', 'RN'].includes(m.mode);
    const frame = m.anim ? m.anim.frame : m.mode === 'DD' ? 0 : animFrame(d.anim, `${t.code}${mode}${t.baseW}`, m.modeTick, loop);
    out.push({
      depth: m.x + m.y,
      draw: (ctx, cm) => {
        const p = toCanvas(cm, m.x, m.y);
        const lit = !!d.hover && (d.hover.kind === 'monster' || d.hover.kind === 'npc' || d.hover.kind === 'corpse') && d.hover.id === m.id;
        if (comp) d.units.draw(ctx, comp, m.dir, frame, p.x, p.y, lit);
        // 마을 NPC: 말을 걸 수 있으면 클릭 상자 (장식 유닛은 없음)
        if (m.npc) {
          if (m.interact) picks.push({ kind: 'npc', id: m.id, x: p.x - 20, y: p.y - 80, w: 40, h: 85 });
          return;
        }
        // 소환수(ally)는 공격 대상이 아니다
        if (m.ally) return;
        if (m.mode !== 'DT' && m.mode !== 'DD') picks.push({ kind: 'monster', id: m.id, x: p.x - 20, y: p.y - 70, w: 40, h: 75 });
        // 시체: Find Potion / Find Item 대상 (발밑 낮은 상자)
        else if (m.mode === 'DD') picks.push({ kind: 'corpse', id: m.id, x: p.x - 24, y: p.y - 20, w: 48, h: 26 });
      },
    });
  }

  for (const ms of s.missiles) {
    if (!d.missiles || !ms.celFile || ms.celFile === 'null' || !onScreen(ms.x, ms.y)) continue;
    out.push({
      depth: ms.x + ms.y + 0.25,
      draw: (ctx, cm) => {
        const p = toCanvas(cm, ms.x, ms.y);
        d.missiles?.draw(ctx, ms.celFile, ms.dir, ms.frame, p.x, p.y);
      },
    });
  }

  // 플레이어 시체: 죽은 모습(DD) + 시체가 가진 장비 외형
  const cp = s.corpse;
  if (cp && d.corpseLook && onScreen(cp.x, cp.y)) {
    const look = d.corpseLook;
    const cc = d.units.get({ root: 'CHARS', token: d.playerToken, mode: 'DD', wclass: look.wclass, equip: look.equip });
    out.push({
      depth: cp.x + cp.y - 0.25,
      draw: (ctx, cm) => {
        const p = toCanvas(cm, cp.x, cp.y);
        if (cc) d.units.draw(ctx, cc, cp.dir, 0, p.x, p.y, d.hover?.kind === 'body');
        picks.push({ kind: 'body', id: 0, x: p.x - 30, y: p.y - 24, w: 60, h: 30 });
      },
    });
  }

  const pm = s.player;
  // 시퀀스(SQ) 스킬은 엔진이 알려준 모드·프레임을 그대로 그린다 (Jab, Leap 등)
  const baseMode = pm.anim?.mode ?? (pm.mode === 'SQ' ? 'A1' : pm.mode);
  const mode = d.inTown ? ({ NU: 'TN', WL: 'TW' } as Record<string, string>)[baseMode] ?? baseMode : baseMode;
  const comp = d.units.getFor('player', { root: 'CHARS', token: d.playerToken, mode, wclass: d.playerWclass, equip: d.playerEquip });
  const looping = ['NU', 'WL', 'RN', 'TN', 'TW'].includes(mode);
  const frame = pm.anim ? pm.anim.frame : animFrame(d.anim, `${d.playerToken}${mode}${d.playerWclass}`, pm.modeTick, looping);
  out.push({
    depth: pm.x + pm.y,
    draw: (ctx, cm) => {
      const p = toCanvas(cm, pm.x, pm.y);
      if (comp) d.units.draw(ctx, comp, pm.dir, frame, p.x, p.y);
    },
  });
  return out;
}
