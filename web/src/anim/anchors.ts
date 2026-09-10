/**
 * 牌桌动画锚点：座位/牌堆/底池元素注册，供动画队列计算飞行坐标。
 * 坐标统一换算到动画层（覆盖在牌桌上的绝对定位层）局部坐标系。
 */

let layerEl: HTMLElement | null = null;
const seatEls = new Map<number, HTMLElement>();
let deckEl: HTMLElement | null = null;
let potEl: HTMLElement | null = null;
/** 抽牌定庄：摊开的牌堆元素（牌堆索引 → 元素） */
const drawCardEls = new Map<number, HTMLElement>();

export function setAnimLayer(el: HTMLElement | null): void {
  layerEl = el;
}

export function registerSeatEl(displayPos: number, el: HTMLElement | null): void {
  if (el) seatEls.set(displayPos, el);
  else seatEls.delete(displayPos);
}

export function registerDeckEl(el: HTMLElement | null): void {
  deckEl = el;
}

export function registerPotEl(el: HTMLElement | null): void {
  potEl = el;
}

export function registerDrawCardEl(deckIndex: number, el: HTMLElement | null): void {
  if (el) drawCardEls.set(deckIndex, el);
  else drawCardEls.delete(deckIndex);
}

export function clearDrawCardEls(): void {
  drawCardEls.clear();
}

export interface Point {
  x: number;
  y: number;
}

function toLayerPoint(el: HTMLElement): Point | null {
  if (!layerEl) return null;
  const lr = layerEl.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - lr.left + r.width / 2, y: r.top - lr.top + r.height / 2 };
}

export function seatPoint(displayPos: number): Point | null {
  const el = seatEls.get(displayPos);
  return el ? toLayerPoint(el) : null;
}

export function deckPoint(): Point | null {
  if (deckEl) return toLayerPoint(deckEl);
  if (!layerEl) return null;
  const r = layerEl.getBoundingClientRect();
  return { x: r.width / 2, y: r.height / 2 };
}

/** 抽牌定庄：某张摊开牌的位置（元素不存在时退回桌面中心） */
export function drawCardPoint(deckIndex: number): Point | null {
  const el = drawCardEls.get(deckIndex);
  if (el) return toLayerPoint(el);
  return deckPoint();
}

export function potPoint(): Point | null {
  if (potEl) return toLayerPoint(potEl);
  if (!layerEl) return null;
  const r = layerEl.getBoundingClientRect();
  return { x: r.width / 2, y: r.height / 2 - 60 };
}

export function animLayer(): HTMLElement | null {
  return layerEl;
}
