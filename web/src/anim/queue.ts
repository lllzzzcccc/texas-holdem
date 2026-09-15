import gsap from 'gsap';
import type { GameEvent } from '@th/shared';
import type { useRoomStore } from '../stores/room';
import { animLayer, deckPoint, drawCardPoint, potPoint, seatPoint, type Point } from './anchors';
import { sfx } from '../utils/sound';

type Store = ReturnType<typeof useRoomStore>;

const queue: GameEvent[] = [];
let processing = false;

/** 队列是否空闲（全部动画已播完） */
export function queueIdle(): boolean {
  return !processing && queue.length === 0;
}

export function resetAnimation(): void {
  queue.length = 0;
  const layer = animLayer();
  if (layer) {
    gsap.killTweensOf(layer.querySelectorAll('.anim-fly'));
    layer.innerHTML = '';
  }
}

export function enqueueGameEvent(ev: GameEvent, store: Store): void {
  queue.push(ev);
  void process(store);
}

async function process(store: Store): Promise<void> {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const ev = queue.shift()!;
    try {
      await handle(ev, store);
    } catch (e) {
      console.error('动画播放出错', e);
    }
  }
  processing = false;
  if (store.room) store.syncGatesCaps(store.room);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 飞行元素 ----------

function spawnFly(className: string, from: Point): HTMLElement | null {
  const layer = animLayer();
  if (!layer) return null;
  const el = document.createElement('div');
  el.className = `anim-fly ${className}`;
  el.style.left = `${from.x}px`;
  el.style.top = `${from.y}px`;
  layer.appendChild(el);
  return el;
}

/** 一张牌背从 from 飞到 to */
function flyCardBack(from: Point, to: Point, duration = 0.32): Promise<void> {
  const el = spawnFly('anim-card-back', from);
  if (!el) return sleep(duration * 1000);
  return new Promise((resolve) => {
    gsap.to(el, {
      x: to.x - from.x,
      y: to.y - from.y,
      rotation: gsap.utils.random(-14, 14),
      duration,
      ease: 'power2.out',
      onComplete: () => {
        el.remove();
        resolve();
      },
    });
  });
}

/** 一把筹码从 from 飞到 to */
function flyChips(from: Point, to: Point, duration = 0.38): Promise<void> {
  const els: HTMLElement[] = [];
  for (let i = 0; i < 3; i++) {
    const el = spawnFly('anim-chip', { x: from.x, y: from.y - i * 4 });
    if (el) els.push(el);
  }
  if (els.length === 0) return sleep(duration * 1000);
  return new Promise((resolve) => {
    gsap.to(els, {
      x: (i) => to.x - from.x + (i - 1) * 6,
      y: (i) => to.y - from.y + i * -3,
      duration,
      stagger: 0.05,
      ease: 'power2.inOut',
      onComplete: () => {
        els.forEach((e) => e.remove());
        resolve();
      },
    });
  });
}

function seatAnchor(store: Store, seatIndex: number): Point | null {
  return seatPoint(store.displayPos(seatIndex));
}

function nicknameOf(store: Store, seatIndex: number): string {
  return store.room?.seats[seatIndex]?.nickname ?? `座位${seatIndex}`;
}

const STREET_NAMES: Record<string, string> = { flop: '翻牌', turn: '转牌', river: '河牌' };

// ---------- 事件处理 ----------

async function handle(ev: GameEvent, store: Store): Promise<void> {
  switch (ev.type) {
    case 'dealer_draw_pick': {
      // 一张盖牌从摊开的牌堆飞到该座位
      const from = drawCardPoint(ev.deckIndex);
      const to = seatAnchor(store, ev.seatIndex);
      if (from && to) await flyCardBack(from, to, 0.4);
      sfx.deal();
      if (!store.drawnSeats.includes(ev.seatIndex)) store.drawnSeats = [...store.drawnSeats, ev.seatIndex];
      await sleep(160);
      break;
    }

    case 'dealer_draw_reveal': {
      // 全部抽完：统一翻开比大小
      sfx.flip();
      store.drawRevealed = true;
      await sleep(700);
      break;
    }

    case 'dealer_chosen': {
      sfx.dealer();
      store.banner('抽牌结束', `${nicknameOf(store, ev.seatIndex)} 成为庄家`);
      store.log('抽中大牌，成为庄家', 'info', nicknameOf(store, ev.seatIndex));
      await sleep(900);
      break;
    }

    case 'hand_start': {
      // 新手牌：重置动画闸门
      store.boardCount = 0;
      store.dealtSeats = [];
      store.showdownRevealed = false;
      store.awardsVisible = false;
      store.drawnSeats = [];
      store.drawRevealed = false;
      store.cardsVisible = false; // 新一局默认盖住，等发牌动画结束后再亮
      store.currentHand = ev.handNumber;
      store.log(`—— 第 ${ev.handNumber} 手牌 ——`, 'divider');
      store.banner(`第 ${ev.handNumber} 手牌`, undefined, 1200);
      await sleep(650);
      break;
    }

    case 'post_blind': {
      sfx.chips();
      const from = seatAnchor(store, ev.seatIndex);
      const to = potPoint();
      if (from && to) await flyChips(from, to, 0.3);
      store.log(`下${ev.blind === 'sb' ? '小盲' : '大盲'} ${ev.amount}`, 'action', nicknameOf(store, ev.seatIndex));
      await sleep(120);
      break;
    }

    case 'deal_hole': {
      // 两圈发牌：先每人第一张，再第二张
      const from = deckPoint();
      for (let round = 0; round < 2; round++) {
        for (const seatIndex of ev.seatIndexes) {
          const to = seatAnchor(store, seatIndex);
          if (from && to) {
            void flyCardBack(from, to, 0.3);
            sfx.deal();
            await sleep(90);
          }
        }
        await sleep(220);
      }
      await sleep(250);
      store.dealtSeats = [...ev.seatIndexes];
      // 发牌动作全部结束后，若本人也在发牌名单里，再亮出自己的两张底牌
      const me = store.mySeat;
      store.cardsVisible = me !== null && ev.seatIndexes.includes(me);
      // 底牌发完：把枪口位暂缓的决策面板亮出来（等发牌动画结束再显示，见 store.applyTurnIfReady）
      store.applyTurnIfReady();
      await sleep(350);
      break;
    }

    case 'player_action': {
      const nick = nicknameOf(store, ev.seatIndex);
      if (ev.action === 'fold') {
        sfx.fold();
        store.log('弃牌', 'action', nick);
        await sleep(220);
      } else if (ev.action === 'check') {
        sfx.check();
        store.log('过牌', 'action', nick);
        await sleep(220);
      } else {
        const from = seatAnchor(store, ev.seatIndex);
        const to = potPoint();
        if (from && to) await flyChips(from, to, 0.35);
        if (ev.action === 'allin') {
          sfx.allin();
          store.log(`全下 ${ev.betTotal}`, 'action', nick);
        } else if (ev.action === 'call') {
          sfx.chips();
          store.log(`跟注 ${ev.amount}`, 'action', nick);
        } else {
          sfx.chips();
          store.log(`加注到 ${ev.betTotal}`, 'action', nick);
        }
      }
      break;
    }

    case 'street': {
      // 逐张翻开公共牌（boardCount 推进会触发 PlayingCard 的翻开动画）
      for (let i = 0; i < ev.cards.length; i++) {
        await sleep(ev.street === 'flop' ? 200 : 350);
        sfx.flip();
        store.boardCount = store.boardCount + 1;
      }
      store.log(`${STREET_NAMES[ev.street]}：${ev.cards.join(' ')}`, 'info');
      await sleep(450);
      break;
    }

    case 'showdown': {
      store.showdownRevealed = true;
      const parts = ev.results.map((r) => `${nicknameOf(store, r.seatIndex)}：${r.handName}`);
      for (const r of ev.results) {
        store.log(`亮出 ${r.handName}`, 'info', nicknameOf(store, r.seatIndex));
      }
      store.banner('摊牌', parts.join('　'), 2400);
      await sleep(1500);
      break;
    }

    case 'pot_award': {
      store.awardsVisible = true;
      const pot = potPoint();
      for (const a of ev.awards) {
        const to = seatAnchor(store, a.seatIndex);
        if (pot && to) await flyChips(pot, to, 0.45);
      }
      for (const a of ev.awards) {
        store.log(`🏆 赢得 ${a.amount}${a.handName ? `（${a.handName}）` : ''}`, 'win', nicknameOf(store, a.seatIndex));
      }
      // 胜负音效：我赢了 → 胜利音；我参与了但没赢 → 失败音
      const mySeat = store.mySeat;
      if (mySeat !== null && store.dealtSeats.includes(mySeat)) {
        if (ev.awards.some((a) => a.seatIndex === mySeat)) sfx.win();
        else sfx.lose();
      }
      const text = ev.awards
        .map((a) => `${nicknameOf(store, a.seatIndex)} 赢得 ${a.amount}${a.handName ? `（${a.handName}）` : ''}`)
        .join('　');
      store.banner('本手结果', text, 2600);
      await sleep(1200);
      break;
    }

    case 'player_eliminated': {
      store.banner(`${nicknameOf(store, ev.seatIndex)} 筹码耗尽`, undefined, 1600);
      store.log('筹码耗尽，被淘汰', 'info', nicknameOf(store, ev.seatIndex));
      await sleep(400);
      break;
    }

    case 'hand_end': {
      await sleep(400);
      break;
    }
  }
}
