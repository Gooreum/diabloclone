// 스냅샷 → 깊이 정렬용 그리기 목록 (플레이어·몬스터·바닥 아이템) + 클릭 판정 상자.
import type { AnimData } from '../formats/animdata';
import type { ItemDb } from '../engine/items';
import type { MonsterDb } from '../engine/monster';
import type { WorldSnapshot } from '../engine/game';
import type { PickBox } from '../input/dom';
import { toCanvas, type Camera } from './iso';
import type { ItemGfx, MissileGfx, UnitGfx } from './units';
import type { DepthSprite } from './world';

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
  inTown: boolean;
}

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

  for (const m of s.monsters) {
    if (!onScreen(m.x, m.y)) continue;
    const t = d.monsters?.types.get(m.typeId);
    if (!t) continue;
    const equip: Record<string, string> = {};
    for (const [layer, variants] of Object.entries(t.layers)) {
      const v = variants[m.id % variants.length] ?? 'lit';
      if (v !== 'nil') equip[layer] = v;
    }
    const comp = d.units.get({ root: 'MONSTERS', token: t.code, mode: m.mode, wclass: t.baseW, equip });
    const loop = !(m.mode === 'DT' || m.mode === 'DD');
    const frame = m.mode === 'DD' ? 0 : animFrame(d.anim, `${t.code}${m.mode}${t.baseW}`, m.modeTick, loop);
    out.push({
      depth: m.x + m.y,
      draw: (ctx, cm) => {
        const p = toCanvas(cm, m.x, m.y);
        if (comp) d.units.draw(ctx, comp, m.dir, frame, p.x, p.y);
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

  const pm = s.player;
  // 시퀀스(SQ) 스킬은 엔진이 알려준 모드·프레임을 그대로 그린다 (Jab, Leap 등)
  const baseMode = pm.anim?.mode ?? (pm.mode === 'SQ' ? 'A1' : pm.mode);
  const mode = d.inTown ? ({ NU: 'TN', WL: 'TW' } as Record<string, string>)[baseMode] ?? baseMode : baseMode;
  const comp = d.units.get({ root: 'CHARS', token: d.playerToken, mode, wclass: d.playerWclass, equip: d.playerEquip });
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
