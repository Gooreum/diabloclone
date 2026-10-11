import type { Page } from '@playwright/test';

/** 엔진 dvx_hero_json — 지금 영웅 (loc: 1 한손, 2 양손, 3 갑옷, 4 투구, 5 반지, 6 목걸이) */
export interface Hero { class: number; level: number; str: number; mag: number; dex: number; vit: number; spell15: number; equip: { loc: number; type: number; name: string }[] }
type Rt = { Module: { ccall(n: string, r: string, t: string[], a: string[]): string | number } };

export async function hero(page: Page): Promise<Hero | null> {
  const f = page.frame({ url: /d1x\/play\.html/ })!;
  return f.evaluate(() => JSON.parse((window as unknown as Rt).Module.ccall('dvx_hero_json', 'string', [], []) as string) as Hero | null);
}
