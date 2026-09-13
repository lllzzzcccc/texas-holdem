<script setup lang="ts">
import { computed } from 'vue';
import { useRoomStore } from '../stores/room';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useRoomStore();

/** 只读展示的房间参数（所有人可查看） */
const rows = computed(() => {
  const r = store.room;
  if (!r) return [];
  return [
    { label: '房间号', value: r.code },
    { label: '盲注', value: `${r.smallBlind}/${r.bigBlind}` },
    { label: '买入范围', value: `${r.minBuyIn} ~ ${r.maxBuyIn}` },
    { label: '最大座位', value: `${r.maxSeats} 人` },
    { label: '出牌时间', value: r.turnTimeoutMs === 0 ? '不限时' : `${Math.round(r.turnTimeoutMs / 1000)} 秒` },
    { label: '回合数', value: r.maxHands === 0 ? '不限' : `${r.maxHands} 手` },
    { label: '房间类型', value: r.isPrivate ? '私密（仅邀请）' : '公共（大厅可见）' },
  ];
});
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="card-panel dialog">
        <h3>房间信息</h3>
        <div class="info-list">
          <div v-for="row in rows" :key="row.label" class="info-row">
            <span class="info-label">{{ row.label }}</span>
            <span class="info-value">{{ row.value }}</span>
          </div>
        </div>
        <div class="btn-row">
          <button @click="emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(3px);
}
.dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(360px, 92vw);
  max-height: 90dvh;
  overflow-y: auto;
}
h3 {
  text-align: center;
  color: var(--gold);
  letter-spacing: 3px;
}
.info-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.info-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.info-row:last-child {
  border-bottom: none;
}
.info-label {
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
}
.info-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  text-align: right;
}
.btn-row {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
