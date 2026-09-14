<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoomStore } from '../../stores/room';
import { formatChips } from '../../utils/chips';

const store = useRoomStore();
const legal = computed(() => store.yourTurn);

const mode = ref<'actions' | 'raise'>('actions');
const raiseTo = ref(0);

/** 已选中的直接操作（弃牌/过牌/跟注）：首次点击选中，再次点击才真正执行 */
const selected = ref<'fold' | 'check' | 'call' | null>(null);

/** 弃牌/过牌/跟注：两段式确认——首次点击选中（四角包裹），再次点击同一按钮才触发 */
function tryAct(kind: 'fold' | 'check' | 'call') {
  if (selected.value === kind) {
    selected.value = null;
    store.act(kind);
  } else {
    selected.value = kind;
  }
}

// 回合倒计时
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;

watch(
  legal,
  (l) => {
    if (l) {
      mode.value = 'actions';
      selected.value = null;
      raiseTo.value = l.minRaiseTo;
      now.value = Date.now();
      if (ticker) clearInterval(ticker);
      ticker = setInterval(() => (now.value = Date.now()), 200);
    } else if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  },
  { immediate: true },
);

const deadlinePct = computed(() => {
  if (!legal.value?.turnDeadline) return 100;
  const total = store.room?.turnTimeoutMs ?? 30_000;
  const left = Math.max(0, legal.value.turnDeadline - now.value);
  return Math.min(100, (left / total) * 100);
});

const step = computed(() => store.room?.bigBlind ?? 10);

/** 预设尺度卡片 */
const presets = computed(() => {
  const l = legal.value;
  if (!l) return [];
  const currentBet = store.room?.game?.currentBet ?? 0;
  const potAfterCall = l.pot + l.callAmount;
  const clamp = (v: number) => Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, v));
  const list: { label: string; value: number }[] = [
    { label: '最小', value: l.minRaiseTo },
    { label: '½ 底池', value: clamp(currentBet + Math.round(potAfterCall / 2)) },
    { label: '¾ 底池', value: clamp(currentBet + Math.round((potAfterCall * 3) / 4)) },
    { label: '底池', value: clamp(currentBet + potAfterCall) },
    { label: 'All-in', value: l.maxRaiseTo },
  ];
  // 去重（小底池时多个预设可能相同）
  return list.filter((p, i) => list.findIndex((q) => q.value === p.value) === i);
});

function setRaise(v: number) {
  if (!legal.value) return;
  raiseTo.value = Math.min(legal.value.maxRaiseTo, Math.max(legal.value.minRaiseTo, Math.round(v)));
}

/** 本次加注需「再投入」的筹码 = 加注总额 − 本街已投入（= currentBet − callAmount） */
const extraTo = computed(() => {
  const l = legal.value;
  if (!l) return 0;
  const currentBet = store.room?.game?.currentBet ?? 0;
  return Math.max(0, raiseTo.value - currentBet + l.callAmount);
});

/** 进入加注面板（并清空直接操作的选中态） */
function enterRaise() {
  selected.value = null;
  mode.value = 'raise';
}

function confirmRaise() {
  store.act('raise', raiseTo.value);
}
</script>

<template>
  <transition name="slide-up">
    <div v-if="legal" class="bet-panel">
      <div class="countdown"><div class="bar" :style="{ width: `${deadlinePct}%` }" /></div>

      <div class="panel-body">
        <div class="panel-row">
          <span class="act-wrap" :class="{ selected: selected === 'fold' }">
            <button class="danger act" @click="tryAct('fold')">弃牌</button>
            <i class="corner tl" /><i class="corner tr" /><i class="corner bl" /><i class="corner br" />
          </span>
          <span class="act-wrap" :class="{ selected: selected === (legal.canCheck ? 'check' : 'call') }">
            <button v-if="legal.canCheck" class="ghost act" @click="tryAct('check')">过牌</button>
            <button v-else class="ok act" @click="tryAct('call')">
              跟注 {{ formatChips(legal.callAmount) }}
            </button>
            <i class="corner tl" /><i class="corner tr" /><i class="corner bl" /><i class="corner br" />
          </span>
          <button v-if="legal.canRaise && mode === 'actions'" class="act raise-btn" @click="enterRaise">
            加注 ▲
          </button>
        </div>

        <template v-if="legal.canRaise && mode === 'raise'">
          <div class="presets">
            <button
              v-for="p in presets"
              :key="p.label"
              class="preset-card"
              :class="{ active: raiseTo === p.value }"
              @click="setRaise(p.value)"
            >
              <span class="preset-label">{{ p.label }}</span>
              <span class="preset-value">{{ formatChips(p.value) }}</span>
            </button>
          </div>

          <div class="slider-row">
            <span class="bound">{{ formatChips(legal.minRaiseTo) }}</span>
            <input
              type="range"
              :min="legal.minRaiseTo"
              :max="legal.maxRaiseTo"
              :step="step"
              :value="raiseTo"
              @input="setRaise(Number(($event.target as HTMLInputElement).value))"
            />
            <span class="bound">{{ formatChips(legal.maxRaiseTo) }}</span>
          </div>

          <div class="confirm-row">
            <div class="amount-display">
              加注到 <strong>{{ formatChips(raiseTo) }}</strong>
              <span class="raise-extra">（再投入 {{ formatChips(extraTo) }}）</span>
              <span v-if="raiseTo === legal.maxRaiseTo" class="allin-hint">ALL-IN!</span>
            </div>
            <button class="ok act" @click="confirmRaise">确认加注</button>
            <button class="ghost act small" @click="mode = 'actions'">返回</button>
          </div>
        </template>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.bet-panel {
  /* 文档流布局：占据牌桌下方空间，牌桌自动缩小让位，绝不重叠 */
  width: fit-content;
  margin: 0 auto calc(10px + env(safe-area-inset-bottom, 0px));
  flex-shrink: 0;
  z-index: 40;
  position: relative;
  background: var(--panel);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 18px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 460px;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
}
.countdown {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.countdown .bar {
  height: 100%;
  background: linear-gradient(90deg, #ffd966, #ef476f);
  transition: width 0.2s linear;
}
.panel-row {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.panel-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 四角包裹选中态：首次点击操作按钮后出现，再次点击同一按钮才触发 */
.act-wrap {
  position: relative;
  display: inline-flex;
}
.act-wrap .corner {
  position: absolute;
  width: 10px;
  height: 10px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.act-wrap .corner.tl {
  top: -4px;
  left: -4px;
  border-top: 2px solid #3a86ff;
  border-left: 2px solid #3a86ff;
}
.act-wrap .corner.tr {
  top: -4px;
  right: -4px;
  border-top: 2px solid #3a86ff;
  border-right: 2px solid #3a86ff;
}
.act-wrap .corner.bl {
  bottom: -4px;
  left: -4px;
  border-bottom: 2px solid #3a86ff;
  border-left: 2px solid #3a86ff;
}
.act-wrap .corner.br {
  bottom: -4px;
  right: -4px;
  border-bottom: 2px solid #3a86ff;
  border-right: 2px solid #3a86ff;
}
.act-wrap.selected .corner {
  opacity: 1;
}
.act {
  padding: 12px 26px;
  font-size: 16px;
}
.act.small {
  padding: 8px 14px;
  font-size: 13px;
}
.raise-btn {
  background: linear-gradient(180deg, #f4a261, #e76f51);
}
.presets {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.preset-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  padding: 8px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid transparent;
  transition: all 0.15s;
}
.preset-card.active {
  border-color: var(--gold);
  background: rgba(212, 175, 55, 0.16);
}
.preset-label {
  font-size: 12px;
  color: var(--text-dim);
}
.preset-card.active .preset-label {
  color: var(--gold);
}
.preset-value {
  font-size: 14px;
  font-weight: 800;
}
.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.bound {
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
}
input[type='range'] {
  flex: 1;
  appearance: none;
  -webkit-appearance: none;
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(90deg, #2d6a4f, #ffd966);
  outline: none;
}
input[type='range']::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fff, #c8c8c8);
  border: 2px solid var(--gold);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  cursor: grab;
}
.confirm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.amount-display {
  font-size: 15px;
}
.amount-display strong {
  color: #ffd966;
  font-size: 19px;
}
.raise-extra {
  font-size: 12px;
  color: var(--text-dim);
  margin-left: 2px;
}
.allin-hint {
  color: #ef476f;
  font-weight: 800;
  margin-left: 6px;
}
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.25s cubic-bezier(0.34, 1.3, 0.64, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(30px);
}

/* ---------- 移动端：全宽底部抽屉 ---------- */
@media (max-width: 640px) {
  .bet-panel {
    min-width: 0;
    width: calc(100vw - 10px);
    margin-bottom: calc(4px + env(safe-area-inset-bottom, 0px));
    padding: 10px 12px;
    border-radius: 14px;
    gap: 9px;
  }
  .panel-row {
    gap: 8px;
  }
  .act-wrap {
    flex: 1;
  }
  .act {
    flex: 1;
    padding: 13px 8px;
    font-size: 15px;
  }
  .act.small {
    flex: none;
  }
  .presets {
    gap: 5px;
  }
  .preset-card {
    padding: 6px 3px;
  }
  .preset-label {
    font-size: 10px;
  }
  .preset-value {
    font-size: 12px;
  }
  .confirm-row {
    flex-wrap: wrap;
    justify-content: center;
  }
}
</style>
