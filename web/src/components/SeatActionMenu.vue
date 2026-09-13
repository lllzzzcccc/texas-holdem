<script setup lang="ts">
defineProps<{
  open: boolean;
  /** 目标座位号（展示用） */
  seatIndex: number;
}>();
const emit = defineEmits<{ buyin: []; bot: []; close: [] }>();
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="card-panel dialog">
        <h3>座位 {{ seatIndex + 1 }}</h3>
        <p class="hint">选择操作方式</p>

        <div class="options">
          <button class="opt" @click="emit('buyin')">
            <span class="opt-icon">🪙</span>
            <span class="opt-text">
              <b>买筹码入座</b>
              <i>自己坐到该座位，购买积分开始游戏</i>
            </span>
          </button>
          <button class="opt" @click="emit('bot')">
            <span class="opt-icon">🤖</span>
            <span class="opt-text">
              <b>放置 AI 玩家</b>
              <i>由 AI 代替你坐到该座位并自动出牌</i>
            </span>
          </button>
        </div>

        <div class="btn-row">
          <button class="ghost" @click="emit('close')">取消</button>
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
  z-index: 110;
  backdrop-filter: blur(3px);
}
.dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(340px, 92vw);
  max-height: 90dvh;
  overflow-y: auto;
}
h3 {
  text-align: center;
  color: var(--gold);
  letter-spacing: 3px;
}
.hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
  margin-top: -8px;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.opt {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 12px 14px;
  transition: all 0.18s ease;
}
.opt:hover {
  border-color: var(--gold);
  background: rgba(212, 175, 55, 0.08);
  transform: translateY(-1px);
}
.opt-icon {
  font-size: 26px;
  flex-shrink: 0;
}
.opt-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.opt-text b {
  font-size: 15px;
  color: var(--text);
}
.opt-text i {
  font-style: normal;
  font-size: 12px;
  color: var(--text-dim);
}
.btn-row {
  display: flex;
  justify-content: center;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
