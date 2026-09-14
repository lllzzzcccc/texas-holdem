<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoomStore } from '../stores/room';
import { formatChips } from '../utils/chips';

const props = defineProps<{
  open: boolean;
  /** 模式：买入入座 / 补码 / 房主选择筹码（底部含「自己入座 / AI 玩家」两个选项） */
  mode: 'buyin' | 'rebuy' | 'seat';
}>();
const emit = defineEmits<{ confirm: [amount: number]; bot: [amount: number]; close: [] }>();

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

const titleText = computed(() => {
  if (props.mode === 'rebuy') return '补充积分';
  if (props.mode === 'seat') return '选择筹码';
  return '购买积分入座';
});
const confirmText = computed(() => (props.mode === 'rebuy' ? '确认补码' : '确认入座'));
const hintText = computed(() => {
  if (props.mode === 'seat') {
    return store.isSeated ? '已入座，可为 AI 玩家购买积分后放置' : '选好筹码后，选择自己入座或放置 AI 玩家';
  }
  return '积分全部为虚拟积分，仅供游戏计分使用';
});
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="card-panel dialog">
        <h3>{{ titleText }}</h3>
        <p class="hint">{{ hintText }}</p>

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
          <template v-if="mode === 'seat'">
            <button v-if="!store.isSeated" class="action-btn" @click="emit('confirm', amount)">自己入座</button>
            <button class="action-btn" @click="emit('bot', amount)">AI 玩家</button>
            <button class="action-btn" @click="emit('close')">取消</button>
          </template>
          <template v-else>
            <button class="ghost" @click="emit('close')">取消</button>
            <button class="ok" @click="emit('confirm', amount)">{{ confirmText }}</button>
          </template>
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
  flex-wrap: wrap;
}
/* 底部操作按钮：与上方筹码预设（ghost 半透明）区分，用实色填充 + 描边 */
.actions .action-btn {
  flex: 1;
  padding: 7px 10px;
  background: #25425e;
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: none;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
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
