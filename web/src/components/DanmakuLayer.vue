<script setup lang="ts">
import { useRoomStore } from '../stores/room';

/**
 * 弹幕层：覆盖整个游戏界面，弹幕在随机高度从左向右飘过。
 * 每条弹幕动画结束后从 store 移除。
 */
const store = useRoomStore();

/** 每条弹幕的随机垂直位置（id → top%），避免同批弹幕重叠 */
const tops = new Map<number, number>();
const usedTops: number[] = [];

function topFor(id: number): number {
  const cached = tops.get(id);
  if (cached !== undefined) return cached;
  // 8%~72% 之间取随机值，尽量与当前在屏的弹幕错开至少 7%
  let top = 8;
  for (let tries = 0; tries < 12; tries++) {
    top = 8 + Math.random() * 64;
    if (usedTops.every((t) => Math.abs(t - top) > 7)) break;
  }
  tops.set(id, top);
  usedTops.push(top);
  if (usedTops.length > 12) usedTops.shift();
  return top;
}

function onEnd(id: number) {
  const idx = usedTops.indexOf(tops.get(id) ?? -1);
  if (idx >= 0) usedTops.splice(idx, 1);
  tops.delete(id);
  store.removeDanmaku(id);
}
</script>

<template>
  <div class="danmaku-layer">
    <div
      v-for="d in store.danmakus"
      :key="d.id"
      class="danmaku-item"
      :class="`st-${d.style}`"
      :style="{ top: `${topFor(d.id)}%` }"
      @animationend="onEnd(d.id)"
    >
      <span class="dm-nick">{{ d.nickname }}</span><span class="dm-text">{{ d.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.danmaku-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 55;
}
.danmaku-item {
  position: absolute;
  left: 0;
  transform: translateX(-110%);
  animation: dm-fly 9s linear forwards;
  white-space: nowrap;
  font-size: 20px;
  font-weight: 700;
  display: flex;
  align-items: baseline;
  gap: 6px;
  will-change: transform;
}
.dm-nick {
  font-size: 13px;
  font-weight: 500;
  opacity: 0.75;
}
@keyframes dm-fly {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(110vw);
  }
}

/* ---- 预设 1：经典白字黑描边 ---- */
.st-classic {
  color: #fff;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000,
    0 2px 6px rgba(0, 0, 0, 0.6);
}

/* ---- 预设 2：土豪金渐变 ---- */
.st-gold {
  background: linear-gradient(180deg, #fff3b0 10%, #ffd700 45%, #b8860b 90%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 8px rgba(255, 200, 40, 0.55)) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7));
}
.st-gold .dm-nick {
  color: rgba(255, 220, 120, 0.85);
  -webkit-text-fill-color: rgba(255, 220, 120, 0.85);
}

/* ---- 预设 3：霓虹荧光 ---- */
.st-neon {
  color: #7df9ff;
  text-shadow:
    0 0 6px #0ff,
    0 0 14px rgba(0, 255, 255, 0.7),
    0 0 26px rgba(255, 0, 200, 0.5);
}

/* ---- 预设 4：气泡卡片 ---- */
.st-bubble {
  background: rgba(255, 255, 255, 0.94);
  color: #1d3557;
  padding: 6px 16px;
  border-radius: 999px;
  box-shadow:
    0 4px 14px rgba(0, 0, 0, 0.4),
    inset 0 -2px 0 rgba(0, 0, 0, 0.08);
  font-size: 17px;
}
.st-bubble .dm-nick {
  color: #e63946;
  opacity: 1;
}

/* ---- 预设 5：彩虹流转 ---- */
.st-rainbow {
  background: linear-gradient(90deg, #ff5e5e, #ffb340, #f9f871, #5eff8a, #5ec8ff, #c58aff, #ff5e5e);
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.75));
  animation:
    dm-fly 9s linear forwards,
    dm-rainbow 2.5s linear infinite;
}
.st-rainbow .dm-nick {
  color: rgba(255, 255, 255, 0.85);
  -webkit-text-fill-color: rgba(255, 255, 255, 0.85);
}
@keyframes dm-rainbow {
  from {
    background-position: 0% 0;
  }
  to {
    background-position: 300% 0;
  }
}
</style>
