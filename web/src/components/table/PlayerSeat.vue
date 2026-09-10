<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CardStr, SeatState } from '@th/shared';
import { useRoomStore } from '../../stores/room';
import { registerSeatEl } from '../../anim/anchors';
import { inwardVector } from '../../composables/useTableLayout';
import { formatChips } from '../../utils/chips';
import PlayingCard from './PlayingCard.vue';
import ChipStack from './ChipStack.vue';

const props = defineProps<{
  seat: SeatState | null;
  displayPos: number;
  /** 抽牌阶段：该座位抽到的牌（未参与抽牌为 undefined，未翻出为 null） */
  drawCard?: CardStr | null;
  drawRevealed: boolean;
}>();

const emit = defineEmits<{ sit: [] }>();

const store = useRoomStore();
const wrapper = ref<HTMLElement | null>(null);

onMounted(() => registerSeatEl(props.displayPos, wrapper.value));
onBeforeUnmount(() => registerSeatEl(props.displayPos, null));
watch(wrapper, (el) => registerSeatEl(props.displayPos, el));

const isMe = computed(() => !!props.seat && props.seat.playerId === store.playerId);
const acting = computed(
  () => !!props.seat && store.room?.game?.actingSeat === props.seat.seatIndex,
);
const canSit = computed(
  () => !props.seat && store.room?.status === 'lobby' && store.mySeat === null,
);

const inward = computed(() => inwardVector(props.displayPos, store.room?.maxSeats ?? 9));
const betStyle = computed(() => {
  const d = inward.value;
  const dist = props.displayPos === 0 ? 100 : 88;
  return {
    transform: `translate(calc(-50% + ${(d.dx * dist).toFixed(0)}px), calc(-50% + ${(d.dy * dist).toFixed(0)}px))`,
  };
});

// ---------- 底牌显示 ----------

const showHoleCards = computed(
  () => !!props.seat?.holeCards && store.dealtSeats.includes(props.seat.seatIndex),
);

/** 每张牌的 [牌面, 是否亮出] */
const holeCardViews = computed<[CardStr | null, boolean][]>(() => {
  if (!showHoleCards.value || !props.seat?.holeCards) return [];
  return props.seat.holeCards.map((c, i) => {
    if (isMe.value) {
      const own = store.holeCards[i] ?? c;
      return [own ?? c, own !== null];
    }
    if (c !== null) return [c, store.showdownRevealed]; // 摊牌亮出
    return [null, false]; // 牌背
  });
});

// ---------- 抽牌比大小 ----------

const showDrawCard = computed(() => props.drawCard !== undefined);
const drawCardFaceUp = computed(() => props.drawRevealed && !!props.drawCard);

const initials = computed(() => props.seat?.nickname?.slice(0, 1) ?? '');

const isWinner = computed(
  () =>
    !!props.seat &&
    store.awardsVisible &&
    (store.room?.game?.awards?.some((a) => a.seatIndex === props.seat!.seatIndex) ?? false),
);

function bubbleClass(action: string): string {
  if (action.includes('弃牌')) return 'fold';
  if (action.includes('全下')) return 'allin';
  if (action.includes('加注')) return 'raise';
  return '';
}
</script>

<template>
  <div ref="wrapper" class="seat-wrap">
    <!-- 空座位 -->
    <button v-if="!seat" class="empty-seat" :class="{ clickable: canSit }" :disabled="!canSit" @click="emit('sit')">
      <span v-if="canSit">入座</span>
    </button>

    <template v-else>
      <!-- 底牌 -->
      <div v-if="showHoleCards" class="hole-cards" :class="{ me: isMe, folded: seat.hasFolded }">
        <PlayingCard
          v-for="(v, i) in holeCardViews"
          :key="i"
          :card="v[0]"
          :face-up="v[1]"
          :size="isMe ? 'normal' : 'mini'"
        />
      </div>

      <!-- 抽牌比大小的牌 -->
      <div v-if="showDrawCard" class="draw-card">
        <PlayingCard :card="drawCard ?? null" :face-up="drawCardFaceUp" size="mini" :flip-in="drawCardFaceUp" />
      </div>

      <!-- 头像与信息 -->
      <div class="seat-body" :class="{ acting, folded: seat.hasFolded, me: isMe, offline: !seat.connected }">
        <div class="avatar" :class="{ winner: isWinner }">
          <span>{{ initials }}</span>
          <span v-if="!seat.connected" class="offline-dot" title="离线">⚡</span>
        </div>
        <div class="plate">
          <div class="nick">{{ seat.nickname }}</div>
          <div class="stack">
            <template v-if="seat.stack > 0">{{ formatChips(seat.stack) }}</template>
            <template v-else>已淘汰</template>
          </div>
        </div>
        <div v-if="seat.isDealer" class="dealer-btn">D</div>
        <div v-if="seat.isAllIn" class="allin-tag">ALL-IN</div>
      </div>

      <!-- 动作气泡 -->
      <transition name="bubble">
        <div v-if="seat.lastAction && store.phase !== 'lobby'" class="action-bubble" :class="bubbleClass(seat.lastAction)">
          {{ seat.lastAction }}
        </div>
      </transition>

      <!-- 当前街下注筹码 -->
      <div v-if="seat.bet > 0" class="bet-chips" :style="betStyle">
        <ChipStack :amount="seat.bet" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.seat-wrap {
  position: relative;
  width: 130px;
  height: 116px;
  transform: translate(-50%, -50%) scale(var(--seat-scale, 1));
}

.empty-seat {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 74px;
  height: 74px;
  border-radius: 50%;
  border: 2px dashed rgba(255, 255, 255, 0.28);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.55);
  font-size: 14px;
  transition: all 0.2s;
  padding: 0;
}
.empty-seat.clickable:hover {
  border-color: var(--gold);
  color: var(--gold);
  background: rgba(212, 175, 55, 0.12);
  transform: translate(-50%, -50%) scale(1.08);
}

.seat-body {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  transition: filter 0.3s;
}
.seat-body.folded {
  filter: grayscale(0.9) brightness(0.6);
}
.seat-body.offline .plate {
  opacity: 0.55;
}

.avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(160deg, #3a5f8a, #1d3557);
  border: 3px solid rgba(255, 255, 255, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 800;
  color: #fff;
  position: relative;
  transition:
    border-color 0.25s,
    box-shadow 0.25s;
}
.seat-body.acting .avatar {
  border-color: var(--gold);
  box-shadow: 0 0 18px 4px rgba(212, 175, 55, 0.55);
  animation: pulse 1.2s ease-in-out infinite;
}
.avatar.winner {
  border-color: #ffd700;
  box-shadow: 0 0 24px 6px rgba(255, 215, 0, 0.75);
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 26px 8px rgba(212, 175, 55, 0.75);
  }
}
.offline-dot {
  position: absolute;
  right: -4px;
  top: -4px;
  background: #e63946;
  border-radius: 50%;
  width: 18px;
  height: 18px;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.plate {
  background: rgba(0, 0, 0, 0.68);
  border-radius: 8px;
  padding: 2px 10px;
  text-align: center;
  min-width: 84px;
}
.nick {
  font-size: 12px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 110px;
}
.stack {
  font-size: 12px;
  font-weight: 700;
  color: #ffd966;
}

.dealer-btn {
  position: absolute;
  right: 6px;
  top: -8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(180deg, #fff, #d9d9d9);
  color: #1d3557;
  font-weight: 900;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  animation: pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes pop-in {
  from {
    transform: scale(0);
  }
}

.allin-tag {
  position: absolute;
  left: -10px;
  top: -10px;
  background: linear-gradient(180deg, #ef476f, #c1123b);
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 6px;
  transform: rotate(-8deg);
}

.hole-cards {
  position: absolute;
  left: 50%;
  top: -46px;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  z-index: 3;
  animation: deal-in 0.3s ease;
}
.hole-cards.me {
  top: -88px;
}
.hole-cards.folded {
  opacity: 0.25;
  filter: grayscale(1);
}
@keyframes deal-in {
  from {
    transform: translateX(-50%) scale(0.4);
    opacity: 0;
  }
}

.draw-card {
  position: absolute;
  left: 50%;
  top: -60px;
  transform: translateX(-50%);
  z-index: 3;
}

.action-bubble {
  position: absolute;
  left: 50%;
  bottom: calc(100% - 6px);
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.94);
  color: #16213a;
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 12px;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  z-index: 4;
}
.action-bubble.fold {
  background: #6c757d;
  color: #fff;
}
.action-bubble.raise,
.action-bubble.allin {
  background: #ffd966;
}
.bubble-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.bubble-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(8px) scale(0.7);
}

.bet-chips {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  transition: transform 0.3s ease;
}
</style>
