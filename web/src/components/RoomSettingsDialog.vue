<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoomStore } from '../stores/room';
import { BLIND_PRESETS, HAND_OPTIONS, SEAT_OPTIONS, TURN_OPTIONS } from '../utils/roomOptions';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useRoomStore();

const blindPreset = ref('10/20');
const maxSeats = ref(9);
const turnTimeoutSec = ref(30);
const maxHands = ref(0);
const busy = ref(false);

// 打开时用当前房间参数填充
watch(
  () => props.open,
  (open) => {
    if (!open || !store.room) return;
    blindPreset.value = `${store.room.smallBlind}/${store.room.bigBlind}`;
    if (!BLIND_PRESETS.includes(blindPreset.value)) blindPreset.value = '10/20';
    maxSeats.value = store.room.maxSeats;
    turnTimeoutSec.value = Math.round(store.room.turnTimeoutMs / 1000);
    if (!TURN_OPTIONS.includes(turnTimeoutSec.value)) turnTimeoutSec.value = 30;
    maxHands.value = store.room.maxHands;
  },
);

async function save() {
  if (busy.value) return;
  busy.value = true;
  const [smallBlind, bigBlind] = blindPreset.value.split('/').map(Number);
  const ok = await store.configureRoom({
    smallBlind,
    bigBlind,
    maxSeats: maxSeats.value,
    turnTimeoutSec: turnTimeoutSec.value,
    maxHands: maxHands.value,
  });
  busy.value = false;
  if (ok) {
    store.banner('房间设置已更新', undefined, 1400);
    emit('close');
  }
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="card-panel dialog">
        <h3>房间设置</h3>
        <p class="hint">仅房主可修改，游戏开始后不可更改</p>

        <div class="options-grid">
          <label class="field">
            <span>盲注</span>
            <select v-model="blindPreset">
              <option v-for="b in BLIND_PRESETS" :key="b" :value="b">{{ b }}</option>
            </select>
          </label>
          <label class="field">
            <span>最大座位</span>
            <select v-model.number="maxSeats">
              <option v-for="n in SEAT_OPTIONS" :key="n" :value="n">{{ n }} 人</option>
            </select>
          </label>
          <label class="field">
            <span>思考时间</span>
            <select v-model.number="turnTimeoutSec">
              <option v-for="t in TURN_OPTIONS" :key="t" :value="t">{{ t }} 秒</option>
            </select>
          </label>
          <label class="field">
            <span>回合数</span>
            <select v-model.number="maxHands">
              <option v-for="h in HAND_OPTIONS" :key="h.value" :value="h.value">{{ h.label }}</option>
            </select>
          </label>
        </div>

        <div class="btn-row">
          <button :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</button>
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
.hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
  margin-top: -8px;
}
.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
}
.field select {
  width: 100%;
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
