// 웨이포인트·퀘스트 창 막 탭 (Phase 1 Step 2): 클래식 4 탭 (waygatetabs/questtabs 78×30), 확장팩 5 탭 (expwaygatetabs/expquesttabs 63×31).
import { describe, expect, it } from 'vitest';
import type { AsyncAssets } from '../../src/render/units';
import { QUEST_PANEL, QuestPanel } from '../../src/ui/questpanel';
import { WP_PANEL, WaypointPanel } from '../../src/ui/waypanel';

const loaded: string[] = [];
const assets = { load: (p: string) => { loaded.push(p); return Promise.resolve(null); } } as unknown as AsyncAssets;
const pal = new Uint8Array(1024);

describe('막 탭 (클래식 4 · 확장팩 5)', () => {
  it('확장팩 웨이포인트 창: 다섯째 탭을 누르면 Act V', () => {
    const w = new WaypointPanel(assets, pal, 5);
    w.open = true;
    w.tabEnabled[4] = true;
    const c = w.tabCenter(4);
    expect(c.x).toBeLessThan(WP_PANEL.x + WP_PANEL.w);
    expect(w.click(c.x, c.y)).toBe('panel');
    expect(w.tab).toBe(4);
    expect(loaded.some((p) => p.endsWith('expwaygatetabs.dc6'))).toBe(true);
  });

  it('클래식 웨이포인트 창: 탭 4 개 — 넷째 탭 오른쪽은 탭이 아니다', () => {
    const w = new WaypointPanel(assets, pal);
    w.open = true;
    expect(w.tabs).toBe(4);
    expect(w.tabEnabled).toEqual([true, false, false, false]);
    const c3 = w.tabCenter(3);
    w.tabEnabled[3] = true;
    w.click(c3.x + 78, c3.y);
    expect(w.tab).toBe(0);
  });

  it('확장팩 퀘스트 창: expquesttabs 와 a5q1~a5q6 아이콘, 다섯째 탭', () => {
    const q = new QuestPanel(assets, pal, 5);
    expect(q.files).toContain('expquesttabs');
    for (let i = 1; i <= 6; i++) expect(q.files).toContain(`a5q${i}`);
    q.open = true;
    q.tabEnabled[4] = true;
    q.click(QUEST_PANEL.x + 2 + 4 * 63 + 30, QUEST_PANEL.y + 3 + 15);
    expect(q.tab).toBe(4);
  });

  it('클래식 퀘스트 창: questtabs, Act 5 아이콘 없음', () => {
    const q = new QuestPanel(assets, pal);
    expect(q.files).toContain('questtabs');
    expect(q.files.some((f) => f.startsWith('a5'))).toBe(false);
    expect(q.files.filter((f) => f.startsWith('a4'))).toHaveLength(3);
  });
});
