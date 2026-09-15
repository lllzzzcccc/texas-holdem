<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CardStr, SeatState } from '@th/shared';
import { EMOJI_PRESETS } from '@th/shared';
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
  () =>
    !props.seat &&
    store.room?.status === 'lobby' &&
    (store.mySeat === null || store.isHost),
);

const inward = computed(() => inwardVector(props.displayPos, store.room?.maxSeats ?? 9));
const betStyle = computed(() => {
  const d = inward.value;
  const dist = props.displayPos === 0 ? 100 : 88;
  return {
    transform: `translate(calc(-50% + ${(d.dx * dist).toFixed(0)}px), calc(-50% + ${(d.dy * dist).toFixed(0)}px))`,
  };
});

/** 座位是否在牌桌左半屏（桌心在右侧，inward.dx > 0）。用于气泡/表情盘的水平翻转，避免越出屏幕。 */
const onLeft = computed(() => inward.value.dx > 0);

// ---------- 抽牌比大小 ----------

const showDrawCard = computed(() => props.drawCard !== undefined);
const drawCardFaceUp = computed(() => props.drawRevealed && !!props.drawCard);

const initials = computed(() => props.seat?.nickname?.slice(0, 1) ?? '');

/** AI 诈唬风格提示（仅 AI 座位有值），悬停 🤖 徽标可见 */
const botStyleHint = computed(() => {
  const s = props.seat;
  if (!s?.isBot) return '';
  if (s.bluffRate == null || s.bluffPotPct == null) return 'AI 玩家';
  return `诈唬 ${Math.round(s.bluffRate * 100)}% · 注码 ${Math.round(s.bluffPotPct * 100)}% 池`;
});

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

// ---------- 表情投掷 ----------

const emojis = EMOJI_PRESETS;
const pickerOpen = computed(() => !!props.seat && store.emojiTargetSeat === props.seat.seatIndex);

/** 房主点击 AI 头像后是否展开「踢出」按钮 */
const kickOpen = ref(false);

/** 点击头像：房主点 AI 头像同时弹出「踢出」按钮与表情盘；其余情况只切表情盘 */
function onAvatarClick() {
  if (!props.seat) return;
  if (props.seat.isBot && store.isHost) {
    kickOpen.value = !kickOpen.value;
  }
  store.toggleEmojiPicker(props.seat.seatIndex);
}

function pickEmoji(emoji: string) {
  if (!props.seat) return;
  store.throwEmoji(props.seat.seatIndex, emoji);
}

/** 房主移出 AI 玩家（复用踢人通道，服务端对手牌进行中的 AI 会拒绝） */
function kickBot() {
  if (!props.seat) return;
  kickOpen.value = false;
  store.kickPlayer(props.seat.playerId);
}

// 「踢出」按钮展开后：点击座位以外的任意地方自动收起
let kickOutsideHandler: ((e: MouseEvent) => void) | null = null;
watch(kickOpen, (open) => {
  if (open) {
    kickOutsideHandler = (e: MouseEvent) => {
      const el = wrapper.value;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      kickOpen.value = false;
    };
    document.addEventListener('mousedown', kickOutsideHandler);
  } else if (kickOutsideHandler) {
    document.removeEventListener('mousedown', kickOutsideHandler);
    kickOutsideHandler = null;
  }
});

// 表情面板打开时：点击面板/头像以外的任意地方自动收起
let pickerOutsideHandler: ((e: MouseEvent) => void) | null = null;
watch(pickerOpen, (open) => {
  if (open) {
    pickerOutsideHandler = (e: MouseEvent) => {
      const el = wrapper.value;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      store.toggleEmojiPicker(null);
    };
    document.addEventListener('mousedown', pickerOutsideHandler);
  } else if (pickerOutsideHandler) {
    document.removeEventListener('mousedown', pickerOutsideHandler);
    pickerOutsideHandler = null;
  }
});
onBeforeUnmount(() => {
  if (pickerOutsideHandler) document.removeEventListener('mousedown', pickerOutsideHandler);
  if (kickOutsideHandler) document.removeEventListener('mousedown', kickOutsideHandler);
});
</script>

<template>
  <div ref="wrapper" class="seat-wrap">
    <!-- 空座位 -->
    <button v-if="!seat" class="empty-seat" :class="{ clickable: canSit }" :disabled="!canSit" @click="emit('sit')">
      <span v-if="canSit">入座</span>
    </button>

    <template v-else>
      <!-- 抽牌比大小的牌 -->
      <div v-if="showDrawCard" class="draw-card">
        <PlayingCard :card="drawCard ?? null" :face-up="drawCardFaceUp" size="mini" :flip-in="drawCardFaceUp" />
      </div>

      <!-- 头像与信息 -->
      <div class="seat-body" :class="{ acting, folded: seat.hasFolded, me: isMe, offline: !seat.connected }">
        <div class="avatar" :class="{ winner: isWinner, clickable: true }" title="点击投掷表情" @click.stop="onAvatarClick">
          <span>{{ initials }}</span>
          <span v-if="!seat.connected" class="offline-dot" title="离线">⚡</span>
          <div v-if="seat.isDealer" class="dealer-btn">D</div>
        </div>

        <!-- 房主点击 AI 头像后，在其头像上方出现「踢出」按钮；作为头像的兄弟节点，避免头像 hover 缩放牵动按钮 -->
        <button
          v-if="seat.isBot && store.isHost && kickOpen"
          class="bot-kick"
          title="将 AI 移出房间"
          @click.stop="kickBot"
        >
          踢出
        </button>

        <!-- 表情选择盘：环绕头像上方展开 -->
        <transition name="pop">
          <div v-if="pickerOpen" class="emoji-picker-wrap" :class="{ 'open-right': onLeft }">
            <div class="emoji-backdrop" @click.stop="onAvatarClick" />
            <div class="emoji-picker" @click.stop>
              <button v-for="e in emojis" :key="e" class="emoji-option" @click="pickEmoji(e)">{{ e }}</button>
            </div>
          </div>
        </transition>

        <div class="plate">
          <div class="nick-line">
            <span class="nick">{{ seat.nickname }}</span>
            <span v-if="isMe" class="me-tag">我</span>
            <span v-if="seat.isBot" class="bot-tag" :title="botStyleHint">🤖</span>
          </div>
          <div class="stack">
            <template v-if="seat.stack > 0">{{ formatChips(seat.stack) }}</template>
          </div>
        </div>
        <div v-if="seat.isAllIn" class="allin-tag">ALL-IN</div>
      </div>

      <!-- 动作气泡 -->
      <transition name="bubble">
        <div
          v-if="seat.lastAction && store.phase !== 'lobby'"
          class="action-bubble"
          :class="[bubbleClass(seat.lastAction), { 'open-left': !onLeft }]"
        >
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
  /* 父级 .seat-pos 关闭了命中测试，这里恢复本座位内容的点按（空位按钮/头像/踢出/表情盘） */
  pointer-events: auto;
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
  /* transform 会形成一个层叠上下文，把内部表情盘的 z-index 困住；
     这里显式抬高层级，让头像与表情盘始终盖住同座位的下注筹码(z2)、动作气泡(z4) */
  z-index: 10;
}
/* 弃牌后置灰：只作用于头像/名牌，不波及表情选择盘（点开的表情菜单保持彩色） */
.seat-body.folded .avatar,
.seat-body.folded .plate,
.seat-body.folded .allin-tag {
  filter: grayscale(0.9) brightness(0.6);
}
.seat-body.offline .plate {
  opacity: 0.55;
}

/* ---------- 自己的座位：青色高亮，与他人明显区分 ---------- */
.seat-body.me .avatar {
  border-color: var(--accent);
  background: linear-gradient(160deg, #2a7a8c, #14424e);
  box-shadow: 0 0 14px 3px rgba(76, 201, 240, 0.45);
}
.seat-body.me .plate {
  border: 1px solid rgba(76, 201, 240, 0.6);
  box-shadow: 0 0 10px rgba(76, 201, 240, 0.25);
}
.me-tag {
  display: inline-block;
  background: linear-gradient(180deg, #4cc9f0, #1d8fb8);
  color: #06222c;
  font-size: 10px;
  font-weight: 800;
  border-radius: 6px;
  padding: 0 5px;
  margin-left: 4px;
  vertical-align: middle;
  line-height: 1.3;
}
.bot-tag {
  display: inline-block;
  background: linear-gradient(180deg, #b583f2, #7c4dcc);
  font-size: 10px;
  font-weight: 800;
  border-radius: 6px;
  padding: 0 4px;
  margin-left: 4px;
  vertical-align: middle;
  line-height: 1.3;
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
    transform 0.18s ease,
    border-color 0.25s,
    box-shadow 0.25s;
}
.avatar.clickable {
  cursor: pointer;
}
/* hover 反馈：头像微微放大浮起 */
.avatar.clickable:hover {
  transform: scale(1.14);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
  z-index: 6;
}
.seat-body.me .avatar.clickable:hover {
  box-shadow: 0 0 18px 5px rgba(76, 201, 240, 0.6);
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

/* 房主点击 AI 头像后，在其头像上方出现的小号「踢出」按钮（低饱和中性色） */
.bot-kick {
  position: absolute;
  top: -26px;
  left: 50%;
  /* 用 translateX(-50%) 做水平居中；全局 button:hover 会把 transform 改成 translateY(-1px)，
     从而丢掉居中导致按钮向侧面位移，故在 hover/active 里用 !important 强制保留居中 */
  transform: translateX(-50%);
  border-radius: 999px;
  padding: 1px 8px;
  background: rgba(43, 49, 56, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #c9cfd6;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  z-index: 7;
  /* 覆盖全局 button 的 transform 过渡：只对背景/文字做过渡，杜绝位移动画 */
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.bot-kick:hover,
.bot-kick:active {
  transform: translateX(-50%) !important;
  background: rgba(58, 66, 74, 0.82);
  color: #fff;
}

/* ---------- 表情选择盘（头像左侧展开，避开上方底牌区与右侧气泡区） ---------- */
.emoji-picker-wrap {
  position: absolute;
  right: calc(50% + 44px);
  top: -14px;
  z-index: 80;
}
/* 左半屏座位：表情盘翻转到头像右侧，避免越出屏幕左缘 */
.emoji-picker-wrap.open-right {
  right: auto;
  left: calc(50% + 44px);
}
.emoji-picker-wrap.open-right .emoji-picker {
  right: auto;
  left: 0;
}
.emoji-backdrop {
  position: fixed;
  inset: 0;
  background: transparent;
  z-index: 79;
}
.emoji-picker {
  position: absolute;
  right: 0;
  top: 0;
  z-index: 81;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  padding: 8px;
  background: rgba(10, 20, 16, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  white-space: nowrap;
}
.emoji-option {
  background: none;
  border: none;
  box-shadow: none;
  padding: 4px;
  font-size: 22px;
  line-height: 1;
  border-radius: 8px;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    background 0.12s ease;
}
.emoji-option:hover {
  background: rgba(255, 255, 255, 0.14);
  transform: scale(1.25);
}
.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.16s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
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
.nick-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
}
.nick {
  font-size: 12px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 84px;
}
.stack {
  font-size: 12px;
  font-weight: 700;
  color: #ffd966;
}

.dealer-btn {
  position: absolute;
  right: -6px;
  bottom: -6px;
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

.draw-card {
  position: absolute;
  left: 50%;
  top: -60px;
  transform: translateX(-50%);
  z-index: 3;
}

.action-bubble {
  position: absolute;
  /* 头像右侧区域：底牌在正上方、表情盘在左侧，各元素分区不堆叠 */
  left: calc(50% + 32px);
  top: 4px;
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
/* 右半屏座位：气泡翻转到头像左侧，避免「小盲 10」等标识越出屏幕右缘 */
.action-bubble.open-left {
  left: auto;
  right: calc(50% + 32px);
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
  transform: translateY(8px) scale(0.7);
}
/* 街道推进清空动作标识时柔和淡出，避免突兀消失 */
.bubble-leave-active {
  transition: opacity 0.18s ease;
}
.bubble-leave-to {
  opacity: 0;
}

.bet-chips {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  transition: transform 0.3s ease;
}
</style>
