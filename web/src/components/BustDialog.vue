<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoomStore } from '../stores/room';
import { formatChips } from '../utils/chips';

const store = useRoomStore();

const amount = ref(0);
const now = ref(Date.now());
let timer: number | undefined;

const min = computed(() => store.room?.minBuyIn ?? 400);
const max = computed(() => store.room?.maxBuyIn ?? 4000);
const bb = computed(() => store.room?.bigBlind ?? 20);

const deadline = computed(() => store.room?.rebuyDecision?.deadline ?? Date.now());
const remainingSec = computed(() => Math.max(0, Math.ceil((deadline.value - now.value) / 1000)));

const bbCount = computed(() => (amount.value / bb.value).toFixed(0));
const presets = computed(() => [1000, 2000, 4000].filter((v) => v >= min.value && v <= max.value));

onMounted(() => {
  amount.value = Math.max(min.value, Math.min(2000, max.value));
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 500);
});
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});

function buyIn() {
  store.rebuy(amount.value);
}

function leave() {
  store.leaveSeat();
}
</script>

<template>
  <div v-if="store.bustedPending" class="overlay">
    <div class="card-panel dialog">
      <h3>你的筹码已输光</h3>
      <p class="hint">请在倒计时内选择：买入筹码继续入座，或离开牌桌</p>

      <div class="countdown">⏳ {{ remainingSec }} 秒后自动离席</div>

      <div class="amount-big">{{ formatChips(amount) }}</div>
      <div class="bb-hint">= {{ bbCount }} 个大盲</div>

      <input v-model.number="amount" type="range" :min="min" :max="max" step="100" class="slider" />
      <div class="bounds">
        <span>{{ formatChips(min) }}</span>
        <span>{{ formatChips(max) }}</span>
      </div>

      <div class="presets">
        <button
          v-for="p in presets"
          :key="p"
          class="ghost"
          :class="{ active: amount === p }"
          @click="amount = p"
        >
          {{ formatChips(p) }}
        </button>
      </div>

      <div class="actions">
        <button class="danger" @click="leave">离开牌桌</button>
        <button class="ok" @click="buyIn">买入继续</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 120;
  backdrop-filter: blur(4px);
}
.dialog {
  width: min(360px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: center;
  max-height: 90dvh;
  overflow-y: auto;
}
.dialog h3 {
  font-size: 21px;
  color: var(--gold);
}
.hint {
  font-size: 13px;
  color: var(--text-dim);
  margin-top: -8px;
}
.countdown {
  font-size: 15px;
  color: #ffb3ba;
  font-weight: 700;
}
.amount-big {
  font-size: 40px;
  font-weight: 900;
  color: #ffd966;
}
.bb-hint {
  font-size: 13px;
  color: var(--text-dim);
  margin-top: -8px;
}
.slider {
  width: 100%;
  appearance: none;
  -webkit-appearance: none;
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(90deg, #2d6a4f, #ffd966);
  outline: none;
}
.slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fff, #c8c8c8);
  border: 2px solid var(--gold);
  cursor: grab;
}
.bounds {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-dim);
  margin-top: -8px;
}
.presets {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.presets .active {
  outline: 2px solid var(--gold);
}
.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 6px;
}
</style>