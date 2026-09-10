<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoomStore } from '../stores/room';
import { formatChips } from '../utils/chips';

const props = defineProps<{
  open: boolean;
  /** 模式：买入入座 / 补码 */
  mode: 'buyin' | 'rebuy';
}>();
const emit = defineEmits<{ confirm: [amount: number]; close: [] }>();

const store = useRoomStore();
const amount = ref(2000);

const min = computed(() => store.room?.minBuyIn ?? 400);
const max = computed(() => store.room?.maxBuyIn ?? 4000);
const bb = computed(() => store.room?.bigBlind ?? 20);

watch(
  () => props.open,
  (o) => {
    if (o) amount.value = Math.min(2000, max.value);
  },
);

const bbCount = computed(() => (amount.value / bb.value).toFixed(0));
const presets = computed(() => [1000, 2000, 4000].filter((v) => v >= min.value && v <= max.value));
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="card-panel dialog">
        <h3>{{ mode === 'buyin' ? '购买积分入座' : '补充积分' }}</h3>
        <p class="hint">积分全部为虚拟积分，仅供游戏计分使用</p>

        <div class="amount-big">{{ formatChips(amount) }}</div>
        <div class="bb-hint">= {{ bbCount }} 个大盲</div>

        <input
          v-model.number="amount"
          type="range"
          :min="min"
          :max="max"
          step="100"
          class="slider"
        />
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
          <button class="ghost" @click="emit('close')">取消</button>
          <button class="ok" @click="emit('confirm', amount)">
            {{ mode === 'buyin' ? '确认入座' : '确认补码' }}
          </button>
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
  width: min(360px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: center;
  max-height: 90dvh;
  overflow-y: auto;
}
.dialog h3 {
  font-size: 20px;
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
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
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
