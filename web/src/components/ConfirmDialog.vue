<script setup lang="ts">
defineProps<{ open: boolean; title: string; message: string; confirmText?: string }>();
const emit = defineEmits<{ confirm: []; close: [] }>();
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="card-panel dialog">
        <h3>{{ title }}</h3>
        <p class="msg">{{ message }}</p>
        <div class="btn-row">
          <button class="danger" @click="emit('confirm')">{{ confirmText ?? '确认' }}</button>
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
  align-items: center;
  gap: 14px;
  width: min(320px, 92vw);
  text-align: center;
}
h3 {
  color: var(--gold);
  letter-spacing: 2px;
}
.msg {
  font-size: 14px;
  color: var(--text);
  line-height: 1.6;
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
