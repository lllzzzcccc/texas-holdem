<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue';
import { useRoomStore } from '../../stores/room';
import { seatStyle, useTableOrientation } from '../../composables/useTableLayout';
import { clearDrawCardEls, registerDeckEl, registerDrawCardEl, registerPotEl, setAnimLayer } from '../../anim/anchors';
import { formatChips } from '../../utils/chips';
import PlayerSeat from './PlayerSeat.vue';
import PlayingCard from './PlayingCard.vue';
import ChipStack from './ChipStack.vue';
import EmojiFlights from './EmojiFlights.vue';

const emit = defineEmits<{ sit: [pos: number] }>();

const store = useRoomStore();
const portrait = useTableOrientation();
const layer = ref<HTMLElement | null>(null);
const potEl = ref<HTMLElement | null>(null);

/** 牌堆锚点元素随抽牌阶段显隐，用函数 ref 保持注册新鲜 */
function setDeckEl(el: Element | ComponentPublicInstance | null) {
  registerDeckEl(el instanceof HTMLElement ? el : null);
}

onMounted(() => {
  setAnimLayer(layer.value);
  registerPotEl(potEl.value);
});
onBeforeUnmount(() => {
  setAnimLayer(null);
  registerDeckEl(null);
  registerPotEl(null);
  clearDrawCardEls();
});

const positions = computed(() => Array.from({ length: store.room?.maxSeats ?? 9 }, (_, i) => i));
const seatCount = computed(() => store.room?.maxSeats ?? 9);
const seatStyleFor = (pos: number) => seatStyle(pos, seatCount.value, portrait.value);

/** 椭圆桌面参数（竖屏换轴为窄高椭圆） */
const tableGeom = computed(() =>
  portrait.value
    ? {
        viewBox: '0 0 620 1000',
        rail: { cx: 310, cy: 500, rx: 300, ry: 480 },
        railInner: { cx: 310, cy: 500, rx: 272, ry: 402 },
        felt: { cx: 310, cy: 500, rx: 263, ry: 376 },
        deco: { cx: 310, cy: 500, rx: 204, ry: 270 },
      }
    : {
        viewBox: '0 0 1000 520',
        rail: { cx: 500, cy: 260, rx: 485, ry: 245 },
        railInner: { cx: 500, cy: 260, rx: 440, ry: 205 },
        felt: { cx: 500, cy: 260, rx: 425, ry: 192 },
        deco: { cx: 500, cy: 260, rx: 330, ry: 138 },
      },
);

const game = computed(() => store.room?.game ?? null);
const boardCards = computed(() => game.value?.board.slice(0, store.boardCount) ?? []);
const potTotal = computed(() => game.value?.potTotal ?? 0);
const sidePots = computed(() => (game.value?.pots.length ?? 0) > 1 ? game.value!.pots : []);

/** 抽牌阶段某座位的牌：抽完未揭晓显示盖牌，揭晓后显示牌面 */
function drawInfo(pos: number): { card: string | null | undefined; revealed: boolean } {
  const seat = store.seatAtDisplay(pos);
  const dd = game.value?.dealerDraw;
  if (!dd || !seat) return { card: undefined, revealed: false };
  const d = dd.draws.find((x) => x.seatIndex === seat.seatIndex);
  if (!d || !store.drawnSeats.includes(seat.seatIndex)) return { card: undefined, revealed: false };
  return { card: store.drawRevealed ? d.card : null, revealed: store.drawRevealed };
}

const isDealerDraw = computed(() => game.value?.phase === 'dealer_draw');

// ---------- 抽牌定庄：摊开的牌堆 ----------

const drawState = computed(() => game.value?.dealerDraw ?? null);
const availableSet = computed(() => new Set(drawState.value?.available ?? []));
/** 桌面摊开的盖牌总数：优先用服务端 spreadSize，缺失时回退为 available + draws 数量 */
const spreadCount = computed(() => {
  const dd = drawState.value;
  if (!dd) return 0;
  if (typeof dd.spreadSize === 'number') return dd.spreadSize;
  return dd.available.length + dd.draws.length;
});
const myDrawn = computed(
  () => store.mySeat !== null && (drawState.value?.draws.some((d) => d.seatIndex === store.mySeat) ?? false),
);
const canPick = computed(() => isDealerDraw.value && store.isSeated && !myDrawn.value && !store.drawRevealed);

// 抽牌阶段结束（牌堆消失）后清理锚点注册表
watch(isDealerDraw, (v) => {
  if (!v) clearDrawCardEls();
});

function registerSpreadEl(i: number, el: Element | ComponentPublicInstance | null) {
  registerDrawCardEl(i, el instanceof HTMLElement ? el : null);
}

/** 摊开牌堆的弧形布局：固定步长紧密排布（轻微重叠的扇形），不再随人数摊开一整条 */
function spreadStyle(i: number) {
  const total = spreadCount.value || 11;
  const center = (total - 1) / 2;
  const offset = i - center; // -center .. +center
  // 相邻牌固定步长（px），任一人数都保持紧凑；竖屏牌更小步长更窄（与 .spread-card 尺寸匹配）
  const step = portrait.value ? 30 : 38;
  // 两端轻微上翘 + 外旋的弧线
  const y = offset * offset * (portrait.value ? 0.5 : 0.9);
  const rot = offset * 2.4;
  return {
    left: `calc(50% + ${(offset * step).toFixed(1)}px)`,
    transform: `translate(-50%, ${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`,
    zIndex: i + 1,
  };
}

function pickCard(i: number) {
  if (!canPick.value || !availableSet.value.has(i)) return;
  store.drawCard(i);
}

const drawTip = computed(() => {
  if (store.drawRevealed) return '揭晓中…';
  if (!store.isSeated) return '玩家们正在抽牌定庄家…';
  return myDrawn.value ? '等待其他玩家抽牌…' : '从摊开的牌堆中点击任意一张，抽牌决定庄家';
});
</script>

<template>
  <div class="table-outer" :class="{ portrait }">
    <!-- 桌面：外轨 + 呢绒台面 -->
    <svg class="table-svg" :viewBox="tableGeom.viewBox" preserveAspectRatio="none">
      <defs>
        <radialGradient id="felt" cx="50%" cy="42%" r="75%">
          <stop offset="0%" stop-color="#35805a" />
          <stop offset="70%" stop-color="#2c6e49" />
          <stop offset="100%" stop-color="#1e5236" />
        </radialGradient>
        <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6d4c41" />
          <stop offset="50%" stop-color="#5d4037" />
          <stop offset="100%" stop-color="#3e2723" />
        </linearGradient>
      </defs>
      <!-- 外轨 -->
      <ellipse v-bind="tableGeom.rail" fill="url(#rail)" stroke="#2a1a12" stroke-width="4" />
      <ellipse v-bind="tableGeom.railInner" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="10" />
      <!-- 呢绒 -->
      <ellipse v-bind="tableGeom.felt" fill="url(#felt)" stroke="#173d29" stroke-width="3" />
      <!-- 中线装饰 -->
      <ellipse v-bind="tableGeom.deco" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2" />
    </svg>

    <!-- 底池锚点：常驻隐藏元素，供动画定位（不可随底池显隐卸载，否则筹码会飞向 0,0） -->
    <div ref="potEl" class="pot-anchor" />

    <!-- 底池 -->
    <div v-if="potTotal > 0" class="pot-area">
      <div class="pot-chips">
        <ChipStack :amount="potTotal" :size="30" />
      </div>
      <div v-if="sidePots.length" class="side-pots">
        <span v-for="(p, i) in sidePots" :key="i">{{ i === 0 ? '主池' : `边池${i}` }} {{ formatChips(p.amount) }}</span>
      </div>
    </div>

    <!-- 公共牌：5 个虚线牌位（未开始也展示，还原真实牌桌）+ 标题 -->
    <div v-if="!isDealerDraw" class="board-wrap">
      <div v-if="boardCards.length === 0" class="board-hint">TEXAS HOLD'EM</div>
      <div class="board">
        <div v-for="i in 5" :key="i" class="board-slot" :class="{ filled: !!boardCards[i - 1] }">
          <PlayingCard v-if="boardCards[i - 1]" :card="boardCards[i - 1]" :face-up="true" flip-in />
        </div>
      </div>
    </div>

    <!-- 抽牌定庄：摊开的一堆盖牌，玩家各自点击抽一张 -->
    <div v-if="isDealerDraw && drawState" class="draw-spread">
      <div
        v-for="i in spreadCount"
        :key="i - 1"
        :ref="(el) => registerSpreadEl(i - 1, el)"
        class="spread-card"
        :class="{ taken: !availableSet.has(i - 1), pickable: canPick && availableSet.has(i - 1) }"
        :style="spreadStyle(i - 1)"
        @click="pickCard(i - 1)"
      />
      <div class="draw-tip">{{ drawTip }}</div>
    </div>

    <!-- 牌堆锚点（抽牌阶段整副牌已摊开，隐藏牌堆） -->
    <div v-if="!isDealerDraw" :ref="setDeckEl" class="deck-anchor">
      <div class="deck-card c1" />
      <div class="deck-card c2" />
      <div class="deck-card c3" />
    </div>

    <!-- 抽牌阶段提示 -->
    <transition name="fade">
      <div v-if="isDealerDraw" class="draw-overlay">
        <div class="draw-title">抽牌决定庄家</div>
        <div class="draw-sub">牌面最大者成为庄家（同点比花色 ♠♥♦♣）</div>
      </div>
    </transition>

    <!-- 座位 -->
    <div
      v-for="pos in positions"
      :key="pos"
      class="seat-pos"
      :style="seatStyleFor(pos)"
    >
      <PlayerSeat
        :seat="store.seatAtDisplay(pos)"
        :display-pos="pos"
        :draw-card="drawInfo(pos).card"
        :draw-revealed="drawInfo(pos).revealed"
        @sit="emit('sit', pos)"
      />
    </div>

    <!-- 动画层 -->
    <div ref="layer" class="anim-layer" />

    <!-- 表情飞行动画层（与动画层同坐标系） -->
    <EmojiFlights />
  </div>
</template>

<style scoped>
.table-outer {
  position: relative;
  width: 100%;
  height: 100%; /* 兜底：不支持容器查询时填满 */
  --seat-scale: 1;
}
/* 支持容器查询时：按可用空间等比缩放，保持椭圆比例，不被侧栏压扁；
   高度取 92%/90% 而非 100%，给底部座位突出台面的部分留出余量，避免压住下方组件 */
@supports (width: 1cqh) {
  .table-outer {
    width: min(1240px, 96%, calc(92cqh * 1.7857));
    height: auto;
    max-height: 100%;
    aspect-ratio: 1000 / 560;
  }
  .table-outer.portrait {
    width: min(94%, calc(92cqh * 0.62));
    aspect-ratio: 620 / 1000;
  }
}
.table-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 24px 40px rgba(0, 0, 0, 0.55));
}

.pot-area {
  position: absolute;
  left: 50%;
  top: 30%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  z-index: 5;
}
.side-pots {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--text-dim);
  background: rgba(0, 0, 0, 0.45);
  border-radius: 8px;
  padding: 2px 8px;
  white-space: nowrap;
}
.pot-anchor {
  position: absolute;
  left: 50%;
  top: 30%;
  width: 1px;
  height: 1px;
}

.board-wrap {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  z-index: 4;
}
.board {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  /* 通过 CSS 变量统一驱动「牌」与「虚线框」的尺寸，保证牌始终小于虚线框；
     各断点只改这三个变量即可整体缩放。 */
  --card-w: 58px;
  --card-h: 80px;
  --slot-pad: 12px;
}
/* 公共牌沿用牌桌的尺寸变量，牌永远比虚线框小一圈 */
.board :deep(.card) {
  --w: var(--card-w);
  --h: var(--card-h);
}
.board-slot {
  /* 虚线框 = 牌 + 留白（box-sizing: border-box 已含 2px 边框） */
  width: calc(var(--card-w) + var(--slot-pad));
  height: calc(var(--card-h) + var(--slot-pad));
  border-radius: 6px;
  border: 2px dashed rgba(255, 255, 255, 0.22);
  background: rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.3s;
}
.board-slot.filled {
  border-color: transparent;
  background: none;
}
.board-hint {
  color: rgba(255, 255, 255, 0.14);
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 6px;
  white-space: nowrap;
}

/* ---------- 抽牌定庄：摊开的牌堆 ---------- */
.draw-spread {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 0;
  z-index: 6;
}
.spread-card {
  position: absolute;
  left: 50%;
  top: -28px;
  width: 40px;
  height: 56px;
  border-radius: 5px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.22) 0 3px, transparent 3px 8px),
    linear-gradient(160deg, #c0392b, #7b241c);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.45);
  transition:
    opacity 0.3s,
    box-shadow 0.15s,
    margin 0.15s;
}
.spread-card.taken {
  opacity: 0;
  pointer-events: none;
}
.spread-card.pickable {
  cursor: pointer;
}
.spread-card.pickable:hover {
  margin-top: -10px;
  box-shadow:
    0 0 0 2px var(--gold),
    0 6px 14px rgba(0, 0, 0, 0.55);
}
.draw-tip {
  position: absolute;
  left: 50%;
  top: 52px;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 13px;
  color: var(--gold);
  background: rgba(0, 0, 0, 0.55);
  padding: 6px 18px;
  border-radius: 10px;
}

.deck-anchor {
  position: absolute;
  left: calc(50% + 220px);
  top: 50%;
  transform: translate(-50%, -50%);
  width: 58px;
  height: 80px;
  z-index: 4;
}
.deck-card {
  position: absolute;
  inset: 0;
  border-radius: 6px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.22) 0 3px, transparent 3px 8px),
    linear-gradient(160deg, #c0392b, #7b241c);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
}
.deck-card.c1 {
  transform: translate(0, 0);
}
.deck-card.c2 {
  transform: translate(2px, -2px);
}
.deck-card.c3 {
  transform: translate(4px, -4px);
}

.draw-overlay {
  position: absolute;
  left: 50%;
  top: 14%;
  transform: translateX(-50%);
  text-align: center;
  z-index: 6;
  background: rgba(0, 0, 0, 0.55);
  padding: 10px 26px;
  border-radius: 14px;
  backdrop-filter: blur(4px);
}
.draw-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--gold);
  letter-spacing: 4px;
}
.draw-sub {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
}

.seat-pos {
  position: absolute;
  z-index: 5;
}

.anim-layer {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  overflow: visible;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ---------- 响应式 ---------- */

/* 中小横屏：座位整体缩小 */
@media (max-width: 900px) {
  .table-outer {
    --seat-scale: 0.85;
  }
}
@media (max-width: 640px) {
  .table-outer {
    --seat-scale: 0.72;
  }
  .board {
    gap: 5px;
    --card-w: 46px;
    --card-h: 64px;
    --slot-pad: 11px;
  }
  .board-hint {
    font-size: 18px;
    letter-spacing: 3px;
  }
  .deck-anchor {
    left: 82%;
    transform: translate(-50%, -50%) scale(0.75);
  }
  .spread-card {
    width: 30px;
    height: 42px;
    top: -21px;
  }
  .draw-tip {
    font-size: 12px;
    top: 40px;
  }
  .draw-title {
    font-size: 16px;
  }
}

/* 竖屏手机：窄高椭圆 + 最小座位缩放 */
.table-outer.portrait {
  --seat-scale: 0.65;
}
.table-outer.portrait .board {
  gap: 4px;
  --card-w: 42px;
  --card-h: 58px;
  --slot-pad: 10px;
}
.table-outer.portrait .spread-card {
  width: 28px;
  height: 40px;
  top: -20px;
}
.table-outer.portrait .deck-anchor {
  /* 竖屏窄桌：公共牌几乎占满台面横向空间，右侧无空位放牌堆；
     移到牌桌顶部中央（底池上方、公共牌上方），避开第 5 张公共牌与右侧座位 */
  left: 50%;
  top: 20%;
  transform: translate(-50%, -50%) scale(0.7);
}
.table-outer.portrait .pot-area {
  top: 33%;
}
.table-outer.portrait .pot-anchor {
  top: 33%;
}
.table-outer.portrait .draw-overlay {
  top: 8%;
  padding: 8px 16px;
  width: max-content;
  max-width: 92%;
}
</style>

<style>
/* 动画队列生成的飞行元素（非 scoped，因为元素动态创建） */
.anim-card-back {
  position: absolute;
  width: 58px;
  height: 80px;
  margin-left: -29px;
  margin-top: -40px;
  border-radius: 6px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.22) 0 3px, transparent 3px 8px),
    linear-gradient(160deg, #c0392b, #7b241c);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
  z-index: 21;
}
.anim-chip {
  position: absolute;
  width: 26px;
  height: 26px;
  margin-left: -13px;
  margin-top: -13px;
  border-radius: 50%;
  background: #f4d03f;
  border: 2px solid #b7950b;
  box-shadow:
    inset 0 0 0 2px rgba(255, 255, 255, 0.4),
    0 3px 6px rgba(0, 0, 0, 0.45);
  z-index: 22;
}
</style>
