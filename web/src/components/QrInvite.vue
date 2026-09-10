<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';

const props = defineProps<{ open: boolean; url: string; code: string }>();
const emit = defineEmits<{ close: [] }>();

const qrDataUrl = ref('');
const copied = ref(false);

async function render() {
  if (!props.url) return;
  qrDataUrl.value = await QRCode.toDataURL(props.url, {
    width: 220,
    margin: 2,
    color: { dark: '#0d1b2a', light: '#ffffff' },
  });
}

onMounted(render);
watch(() => props.url, render);

async function copy() {
  try {
    await navigator.clipboard.writeText(props.url);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* 剪贴板不可用 */
  }
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="card-panel dialog">
        <h3>邀请好友</h3>
        <div class="code">房间号 <strong>{{ code }}</strong></div>
        <img v-if="qrDataUrl" :src="qrDataUrl" class="qr" alt="房间二维码" />
        <p class="hint">扫码或点击链接加入房间</p>
        <div class="link-row">
          <input type="text" :value="url" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button @click="copy">{{ copied ? '已复制 ✓' : '复制' }}</button>
        </div>
        <button class="ghost" @click="emit('close')">关闭</button>
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
  align-items: center;
  gap: 14px;
  width: min(320px, 92vw);
  max-height: 90dvh;
  overflow-y: auto;
}
.code {
  font-size: 16px;
  color: var(--text-dim);
}
.code strong {
  font-size: 24px;
  color: var(--gold);
  letter-spacing: 4px;
}
.qr {
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  max-width: min(220px, 60vw);
  height: auto;
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
}
.link-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.link-row input {
  flex: 1;
  font-size: 12px;
  padding: 8px 10px;
}
.link-row button {
  padding: 8px 14px;
  font-size: 13px;
  white-space: nowrap;
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
