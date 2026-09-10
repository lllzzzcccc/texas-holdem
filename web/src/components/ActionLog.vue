<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoomStore } from '../stores/room';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const store = useRoomStore();
const listEl = ref<HTMLElement | null>(null);

const entries = computed(() => store.actionLog);

// 新记录时自动滚到底部
watch(
  () => entries.value.length,
  async () => {
    await nextTick();
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

function close() {
  emit('close');
}

/** 昵称 → 稳定的颜色（按字符散列取色相），用于名字 tab 配色 */
function nameColor(name: string): { background: string; color: string; borderColor: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    background: `hsla(${hue}, 65%, 45%, 0.35)`,
    color: `hsl(${hue}, 85%, 76%)`,
    borderColor: `hsla(${hue}, 75%, 60%, 0.55)`,
  };
}
</script>

<template>
  <aside class="action-log" :class="{ open: props.open }">
    <header class="log-head">
      <span>对局记录</span>
      <button class="log-close" @click="close">✕</button>
    </header>
    <div ref="listEl" class="log-list">
      <div v-if="entries.length === 0" class="log-empty">暂无记录，开始游戏后这里会显示每一步动作</div>
      <div v-for="e in entries" :key="e.id" class="log-entry" :class="`k-${e.kind}`">
        <span v-if="e.name" class="name-tab" :style="nameColor(e.name)">{{ e.name }}</span>{{ e.text }}
      </div>
    </div>
  </aside>
</template>

<style scoped>
.action-log {
  position: fixed;
  top: 56px;
  right: 10px;
  bottom: 90px;
  width: 300px;
  display: flex;
  flex-direction: column;
  background: rgba(12, 24, 18, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  backdrop-filter: blur(6px);
  /* 必须高于结算面板遮罩（z-90）：旧浏览器不支持 container-type 时遮罩
     会逃逸到根层级，边栏层级不够就会被冻结无法滚动 */
  z-index: 95;
  transform: translateX(calc(100% + 14px));
  transition: transform 0.28s ease;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.action-log.open {
  transform: translateX(0);
}

.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  font-size: 15px;
  font-weight: 600;
  color: #d8c690;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.log-close {
  background: none;
  border: none;
  color: #9aa;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.log-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.log-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  scrollbar-width: thin;
}
.log-empty {
  color: #7d8a80;
  font-size: 13px;
  text-align: center;
  margin-top: 24px;
  line-height: 1.6;
}

.log-entry {
  font-size: 14px;
  line-height: 1.7;
  color: #cfe0d4;
  word-break: break-all;
  /* 名字 tab 与正文基线对齐，不再一高一低 */
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.name-tab {
  display: inline-block;
  flex: none;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
  padding: 1px 8px;
  border-radius: 7px;
  border: 1px solid;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  /* tab 盒高小于正文行高，基线对齐后视觉上略偏低，微调回来 */
  transform: translateY(-2px);
}
.log-entry.k-divider {
  display: block; /* 覆盖 flex，保持整行居中 */
  text-align: center;
  color: #d8c690;
  font-weight: 600;
  margin: 8px 0 3px;
}
.log-entry.k-action {
  color: #e8f0e8;
}
.log-entry.k-info {
  color: #93a89a;
}
.log-entry.k-win {
  color: #ffd76a;
  font-weight: 600;
}

/* 窄屏：抽屉遮罩式全高 */
@media (max-width: 1100px) {
  .action-log {
    top: 0;
    bottom: 0;
    right: 0;
    border-radius: 12px 0 0 12px;
    width: min(340px, 82vw);
    padding-top: env(safe-area-inset-top);
  }
}
</style>
