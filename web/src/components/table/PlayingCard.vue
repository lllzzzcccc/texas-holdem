<script setup lang="ts">
import { computed } from 'vue';
import type { CardStr } from '@th/shared';
import { rankLabel, suitColor, suitSymbol } from '../../utils/cards';

const props = withDefaults(
  defineProps<{
    /** 牌面；null 表示未知/仅牌背 */
    card?: CardStr | null;
    /** 是否面朝上 */
    faceUp?: boolean;
    /** 尺寸：normal（公共牌/自己的牌）| mini（对手底牌/抽牌） */
    size?: 'normal' | 'mini';
    /** 翻开时播放翻转动画 */
    flipIn?: boolean;
  }>(),
  { card: null, faceUp: true, size: 'normal', flipIn: false },
);

const rank = computed(() => (props.card ? rankLabel(props.card) : ''));
const suit = computed(() => (props.card ? suitSymbol(props.card) : ''));
const color = computed(() => (props.card ? suitColor(props.card) : '#16213a'));
</script>

<template>
  <div class="card" :class="[size, { flip: flipIn }]">
    <div class="card-inner" :class="{ down: !faceUp || !card }">
      <div class="face front" :style="{ color }">
        <template v-if="card">
          <span class="rank">{{ rank }}</span>
          <span class="suit">{{ suit }}</span>
          <span class="suit big">{{ suit }}</span>
        </template>
      </div>
      <div class="face back">
        <div class="back-pattern" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  --w: 58px;
  --h: 80px;
  width: var(--w);
  height: var(--h);
  perspective: 600px;
  flex: none;
}
.card.mini {
  --w: 40px;
  --h: 56px;
}
.card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.card-inner.down {
  transform: rotateY(180deg);
}
.card.flip .card-inner {
  animation: flip-in 0.5s cubic-bezier(0.34, 1.3, 0.64, 1);
}
@keyframes flip-in {
  0% {
    transform: rotateY(180deg) scale(0.6);
  }
  100% {
    transform: rotateY(0deg) scale(1);
  }
}
.face {
  position: absolute;
  inset: 0;
  border-radius: calc(var(--w) * 0.1);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  overflow: hidden;
}
.front {
  background: linear-gradient(160deg, #ffffff 0%, #eef1f5 100%);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.12),
    0 2px 6px rgba(0, 0, 0, 0.35);
}
.rank {
  position: absolute;
  top: 4%;
  left: 8%;
  font-weight: 800;
  font-size: calc(var(--w) * 0.3);
  line-height: 1;
}
.suit {
  position: absolute;
  top: calc(4% + var(--w) * 0.3);
  left: 8%;
  font-size: calc(var(--w) * 0.26);
  line-height: 1;
}
.suit.big {
  top: auto;
  left: auto;
  right: 6%;
  bottom: 4%;
  font-size: calc(var(--w) * 0.52);
  opacity: 0.9;
}
.back {
  transform: rotateY(180deg);
  background: #f8f9fa;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.12),
    0 2px 6px rgba(0, 0, 0, 0.35);
  padding: 5%;
}
.back-pattern {
  width: 100%;
  height: 100%;
  border-radius: calc(var(--w) * 0.06);
  background:
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.25) 0 3px, transparent 3px 8px),
    repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.25) 0 3px, transparent 3px 8px),
    linear-gradient(160deg, #c0392b, #7b241c);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55);
}

/* 小屏：公共牌与底牌整体缩小 */
@media (max-width: 640px) {
  .card {
    --w: 46px;
    --h: 64px;
  }
  .card.mini {
    --w: 34px;
    --h: 48px;
  }
}
</style>
