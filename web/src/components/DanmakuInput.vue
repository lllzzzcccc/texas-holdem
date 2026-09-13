<script setup lang="ts">
import { ref } from 'vue';
import { DANMAKU_MAX_LEN, DANMAKU_STYLES, type DanmakuStyle } from '@th/shared';
import { useRoomStore } from '../stores/room';

/** 弹幕输入面板：文字 + 样式预设选择（样式 chip 本身即实时预览） */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const store = useRoomStore();
const text = ref('');
const style = ref<DanmakuStyle>('classic');

const STYLE_LABELS: Record<DanmakuStyle, string> = {
  classic: '经典',
  gold: '土豪金',
  neon: '霓虹',
  bubble: '气泡',
  rainbow: '彩虹',
};

function send() {
  const t = text.value.trim();
  if (!t) return;
  store.sendDanmaku(t, style.value);
  text.value = '';
}

function close() {
  emit('close');
}
</script>

<template>
  <transition name="slide">
    <div v-if="props.open" class="danmaku-wrapper">
      <div class="danmaku-backdrop" @click="close" />
      <div class="danmaku-panel" @click.stop>
        <div class="dm-row">
          <input
            v-model="text"
            type="text"
            :maxlength="DANMAKU_MAX_LEN"
            :placeholder="`发条弹幕吧（最长 ${DANMAKU_MAX_LEN} 字）`"
            @keyup.enter="send"
          />
          <button class="dm-send" :disabled="!text.trim()" @click="send">发送</button>
          <button class="dm-close" title="关闭" @click="close">✕</button>
        </div>
        <div class="dm-styles">
          <button
            v-for="s in DANMAKU_STYLES"
            :key="s"
            class="dm-style-chip"
            :class="[`st-${s}`, { active: style === s }]"
            @click="style = s"
          >
            {{ STYLE_LABELS[s] }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.danmaku-wrapper {
  position: fixed;
  inset: 0;
  z-index: 97;
  pointer-events: none;
  /* 缩放动画原点：右下角（弹幕按钮处），让面板从按钮处放大/缩小 */
  transform-origin: bottom right;
}
.danmaku-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: auto;
}
.danmaku-panel {
  position: absolute;
  right: 18px;
  bottom: calc(18px + env(safe-area-inset-bottom));
  z-index: 1;
  width: min(560px, 92vw);
  background: rgba(10, 20, 30, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: auto;
}
.dm-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dm-row input {
  flex: 1;
}
.dm-send {
  padding: 10px 18px;
  white-space: nowrap;
}
.dm-close {
  background: rgba(255, 255, 255, 0.1);
  padding: 10px 12px;
  white-space: nowrap;
}
.dm-styles {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.dm-style-chip {
  padding: 7px 14px;
  font-size: 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid transparent;
  box-shadow: none;
}
.dm-style-chip.active {
  border-color: var(--accent);
}

/* 样式 chip 复刻弹幕层的预设外观（缩小版预览） */
.dm-style-chip.st-classic {
  color: #fff;
  text-shadow:
    -1px -1px 0 #000,
    1px 1px 0 #000;
}
.dm-style-chip.st-gold {
  background: linear-gradient(180deg, #ffe98a, #b8860b);
  color: #3a2c00;
  font-weight: 800;
}
.dm-style-chip.st-neon {
  color: #7df9ff;
  text-shadow: 0 0 8px rgba(0, 255, 255, 0.8);
}
.dm-style-chip.st-bubble {
  background: rgba(255, 255, 255, 0.94);
  color: #1d3557;
  font-weight: 700;
}
.dm-style-chip.st-rainbow {
  background: linear-gradient(90deg, #ff5e5e, #ffb340, #5eff8a, #5ec8ff, #c58aff);
  color: #fff;
  font-weight: 800;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.slide-enter-active,
.slide-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
</style>
