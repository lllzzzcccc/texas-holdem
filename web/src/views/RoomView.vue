<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { EV } from '@th/shared';
import { useRoomStore } from '../stores/room';
import { savedNickname, savedPlayerId, socket } from '../socket';
import { setSoundEnabled, soundEnabled } from '../utils/sound';
import gsap from 'gsap';
import PokerTable from '../components/table/PokerTable.vue';
import PlayingCard from '../components/table/PlayingCard.vue';
import BetPanel from '../components/table/BetPanel.vue';
import BuyInDialog from '../components/BuyInDialog.vue';
import QrInvite from '../components/QrInvite.vue';
import HandSummary from '../components/HandSummary.vue';
import ActionLog from '../components/ActionLog.vue';
import RoomSettingsDialog from '../components/RoomSettingsDialog.vue';
import RoomInfoDialog from '../components/RoomInfoDialog.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DanmakuLayer from '../components/DanmakuLayer.vue';
import DanmakuInput from '../components/DanmakuInput.vue';
import MemberList from '../components/MemberList.vue';
import BustDialog from '../components/BustDialog.vue';

const props = defineProps<{ code: string }>();
const router = useRouter();
const store = useRoomStore();

const nickname = ref(savedNickname());
const buyInOpen = ref(false);
const buyInMode = ref<'buyin' | 'rebuy' | 'seat'>('buyin');
const chosenPos = ref(0);
const qrOpen = ref(false);
const settingsOpen = ref(false);
const dissolveOpen = ref(false);
const leaveOpen = ref(false);
const logOpen = ref(window.innerWidth > 1100); // 宽屏默认展开记录侧栏
const danmakuOpen = ref(false);
const membersOpen = ref(false);
const menuOpen = ref(false);
const infoOpen = ref(false);
const copied = ref(false);
const soundOn = ref(soundEnabled());

// 加入门槛：设了密码的房间在首次加入失败后展示密码输入框
const needPwd = ref(false);
const password = ref('');

function confirmDissolve() {
  dissolveOpen.value = false;
  store.dissolveRoom();
}

/** 房间被房主解散：提示并回大厅 */
function onDissolved(p: { message: string }) {
  store.toast(p.message);
  store.resetForRoom();
  router.push('/');
}

/** 被房主踢出：提示并回大厅 */
function onKicked(p: { message: string }) {
  store.toast(p.message);
  store.resetForRoom();
  router.push('/');
}

// 房主易主提示：hostId 从别人变成自己时弹出说明
watch(
  () => [store.room?.hostId, store.playerId] as const,
  ([hostId, myId], [prevHostId]) => {
    if (hostId && hostId === myId && prevHostId && prevHostId !== myId) {
      store.banner('你已成为房主', '可以开始 / 结束本局、修改房间设置或解散房间', 3200);
      store.log('你已成为房主', 'info');
    }
  },
);

function toggleSound() {
  soundOn.value = !soundOn.value;
  setSoundEnabled(soundOn.value);
}

/** 复制房间号到剪贴板（带非安全上下文降级） */
async function copyCode() {
  const code = store.room?.code;
  if (!code) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    store.toast('复制失败，请手动复制');
  }
}

const joined = computed(() => store.joined);
const lobby = computed(() => store.room?.status === 'lobby');
const playing = computed(() => store.room?.status === 'playing');
const actionOpen = computed(() => !!store.yourTurn);

/** 下注街阶段集合：仅这些阶段本人会需要翻看自己的底牌 */
const CARD_VIEW_PHASES = new Set(['preflop', 'flop', 'turn', 'river']);
/** 是否显示左下角「看牌」按钮：本人在当前手牌中、还持有底牌，且两张底牌已发完
    （弃牌后仍显示，但整体置灰） */
const canViewCards = computed(() => {
  const g = store.room?.game;
  const mySeat = store.mySeat;
  if (!g || store.room?.status !== 'playing' || mySeat === null) return false;
  if (!CARD_VIEW_PHASES.has(g.phase)) return false;
  const seat = store.room.seats[mySeat];
  // dealtSeats 在发牌动画播完（deal_hole 两圈发完）后才写入我的座位；用它作「两张牌已发完」的闸门
  return !!seat && store.holeCards.length > 0 && store.dealtSeats.includes(mySeat);
});
/** 我是否已弃牌：弃牌后左下角图标与展开的底牌整体置灰，表示这两张牌已弃掉 */
const iFolded = computed(() => {
  const mySeat = store.mySeat;
  if (!store.room || mySeat === null) return false;
  return store.room.seats[mySeat]?.hasFolded ?? false;
});

const peekFab = ref<HTMLElement | null>(null);
const danmakuFab = ref<HTMLElement | null>(null);
const cardOverlay = ref<HTMLElement | null>(null);

/**
 * 底部有操作栏打开时（加注操作栏、弹幕输入栏等），若面板的水平范围与两侧悬浮图标
 * （左下「看牌」、右下「弹幕」）重叠，就把图标抬高到面板上方，避免遮挡。
 * 桌面宽屏下面板居中、够不到两侧图标，自然不抬。
 */
const peekLift = ref(0);
const danmakuLift = ref(0);

let panelResizeObserver: ResizeObserver | null = null;

/** 观察当前打开底部面板的尺寸变化（如加注子面板展开变高），实时重算抬升量 */
function watchPanelSizes() {
  if (typeof ResizeObserver === 'undefined') return;
  panelResizeObserver?.disconnect();
  const els = ['.bet-panel', '.danmaku-panel']
    .map((s) => document.querySelector<HTMLElement>(s))
    .filter((e): e is HTMLElement => !!e);
  if (els.length) {
    panelResizeObserver = new ResizeObserver(() => refreshFabLifts());
    els.forEach((e) => panelResizeObserver!.observe(e));
  }
}

/** 当前打开、可能遮挡底部悬浮按钮的操作板 */
function openPanelSelectors(): string[] {
  const panels: string[] = [];
  if (store.yourTurn) panels.push('.bet-panel');
  if (danmakuOpen.value) panels.push('.danmaku-panel');
  return panels;
}

/** 计算某悬浮按钮被底部操作板遮挡时需上移的距离（无遮挡为 0） */
function liftFor(icon: HTMLElement | null): number {
  let lift = 0;
  if (!icon) return 0;
  const ir = icon.getBoundingClientRect();
  for (const sel of openPanelSelectors()) {
    const p = document.querySelector<HTMLElement>(sel);
    if (!p) continue;
    const r = p.getBoundingClientRect();
    if (!r.height) continue;
    // 水平方向重叠才需要抬高（面板可能居中，够不到两侧图标）
    if (r.left < ir.right && r.right > ir.left) {
      lift = Math.max(lift, window.innerHeight - r.top + 8);
    }
  }
  return lift;
}

function refreshFabLifts() {
  peekLift.value = liftFor(peekFab.value);
  danmakuLift.value = liftFor(danmakuFab.value);
}

const peekStyle = computed(() => (peekLift.value > 0 ? { bottom: `${peekLift.value}px` } : {}));
const danmakuStyle = computed(() => (danmakuLift.value > 0 ? { bottom: `${danmakuLift.value}px` } : {}));

/** 面板出现/消失或窗口尺寸变化时刷新；面板有 slide 入场动画，再延迟校正一次 */
function scheduleFabLifts() {
  refreshFabLifts();
  watchPanelSizes();
  window.setTimeout(refreshFabLifts, 300);
}

watch(
  () => [!!store.yourTurn, danmakuOpen.value] as const,
  () => scheduleFabLifts(),
  { flush: 'post' }, // 等 DOM 更新后再测量，确保面板已渲染就位
);

/** 下注操作板（弃牌/过牌/加注）打开时，把展开的手牌抬到面板上方，不遮挡操作 */
function applyLift(overlay: HTMLElement | null = cardOverlay.value) {
  if (!overlay) return;
  let pad = 22;
  if (store.yourTurn) {
    const panel = document.querySelector<HTMLElement>('.bet-panel');
    if (panel) {
      const r = panel.getBoundingClientRect();
      if (r.height) pad = Math.max(22, window.innerHeight - r.top + 12);
    }
  }
  overlay.style.paddingBottom = `${pad}px`;
}

// 手牌展开期间，轮到行动（面板出现/消失）时重算牌面上浮高度
watch(
  () => [store.cardsVisible, store.yourTurn] as const,
  () => nextTick(() => applyLift()),
);

/**
 * 手牌展开时，点击页面任意位置收起手牌。
 * 用 document 监听而非全屏遮罩：点击下层按钮（加注/弹幕/看牌等）时按钮照常生效，手牌同时收起。
 * 常驻监听 + 内部守卫（cardsVisible 为 true 才收起），避免依赖 watch 挂/摘监听的时序问题。
 */
function onDocClick(e: MouseEvent) {
  if (!store.cardsVisible) return;
  // 点击「看牌」按钮本身时交给它自己的 toggle 处理，避免展开后立刻被本监听收起
  const t = e.target as HTMLElement | null;
  if (t?.closest('.peek-fab')) return;
  store.dismissCards();
}

/** 计算从图标到浮层中心的位移与缩放（动画起点/终点共用） */
function riseTransform(from: DOMRect, to: DOMRect) {
  return {
    x: from.left + from.width / 2 - (to.left + to.width / 2),
    y: from.top + from.height / 2 - (to.top + to.height / 2),
    scale: Math.min(from.width / to.width, from.height / to.height),
  };
}

/** 展开：从图标处的两张牌背开始，翻牌并放大到屏幕下方 */
function onCardsEnter(el: Element, done: () => void) {
  const icon = peekFab.value;
  const cards = el.querySelector('.co-cards');
  if (!icon || !cards) return done();
  applyLift(el as HTMLElement);
  const from = icon.getBoundingClientRect();
  const to = cards.getBoundingClientRect();
  if (!to.width || !to.height) return done();
  const t = riseTransform(from, to);
  gsap.fromTo(
    cards,
    { transformPerspective: 900, x: t.x, y: t.y, scale: t.scale, rotationY: 180, opacity: 0 },
    {
      x: 0,
      y: 0,
      scale: 1,
      rotationY: 0,
      opacity: 1,
      duration: 0.5,
      ease: 'power3.out',
      onComplete: done,
    },
  );
}

/** 收起：翻回牌背并缩回图标位置 */
function onCardsLeave(el: Element, done: () => void) {
  const icon = peekFab.value;
  const cards = el.querySelector('.co-cards');
  if (!icon || !cards) return done();
  const from = icon.getBoundingClientRect();
  const to = cards.getBoundingClientRect();
  if (!to.width || !to.height) return done();
  // 若展开动画尚未结束（用户快速点击按钮收起），先停掉旧 tween，避免两个动画打架导致无法收起
  gsap.killTweensOf(cards);
  const t = riseTransform(from, to);
  gsap.to(cards, {
    transformPerspective: 900,
    x: t.x,
    y: t.y,
    scale: t.scale,
    rotationY: 180,
    opacity: 0,
    duration: 0.4,
    ease: 'power2.in',
    onComplete: done,
  });
}

onMounted(async () => {
  store.wireSocket();
  store.resetForRoom();
  window.addEventListener('resize', scheduleFabLifts);
  document.addEventListener('click', onDocClick);
  socket.on(EV.RoomDissolved, onDissolved);
  socket.on(EV.RoomKicked, onKicked);
  if (!socket.connected) socket.connect();
  const nick = savedNickname();
  if (nick) {
    const r = await store.joinRoom(props.code, nick, savedPlayerId(props.code.toUpperCase()));
    // 房间设了密码且非重连：自动加入被拒，展开密码输入框
    if (r !== true && r.code === 'WRONG_PASSWORD') needPwd.value = true;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleFabLifts);
  panelResizeObserver?.disconnect();
  panelResizeObserver = null;
  document.removeEventListener('click', onDocClick);
  socket.off(EV.RoomDissolved, onDissolved);
  socket.off(EV.RoomKicked, onKicked);
  store.leaveRoom();
});

async function joinWithNickname() {
  if (!nickname.value.trim()) return;
  const r = await store.joinRoom(
    props.code,
    nickname.value.trim(),
    savedPlayerId(props.code.toUpperCase()),
    needPwd.value ? password.value : undefined,
  );
  if (r !== true && r.code === 'WRONG_PASSWORD') needPwd.value = true;
}

function onSit(pos: number) {
  chosenPos.value = pos;
  // 点击空座位直接弹出选择筹码面板；房主面板底部额外提供「自己入座 / AI 玩家」两个选项
  buyInMode.value = store.isHost ? 'seat' : 'buyin';
  buyInOpen.value = true;
}

async function confirmBuyIn(amount: number) {
  if (buyInMode.value === 'rebuy') {
    await store.rebuy(amount);
    buyInOpen.value = false;
    return;
  }
  // buyin（普通玩家入座）或 seat（房主选择「自己入座」）
  const ok = await store.takeSeat(chosenPos.value, amount);
  if (ok) buyInOpen.value = false;
}

async function confirmBot(amount: number) {
  const ok = await store.addBot(chosenPos.value, amount);
  if (ok) buyInOpen.value = false;
}

function openRebuy() {
  buyInMode.value = 'rebuy';
  buyInOpen.value = true;
}

const mySeatState = computed(() => (store.mySeat !== null ? store.room?.seats[store.mySeat] : null));
const canRebuy = computed(
  () =>
    playing.value &&
    mySeatState.value &&
    mySeatState.value.stack === 0 &&
    (store.phase === 'idle' || store.phase === 'hand_end' || !store.room?.game),
);
const showStop = computed(
  () => store.isHost && playing.value && (!store.room?.game || store.phase === 'idle' || store.phase === 'hand_end'),
);

const lobbyHint = computed(() => {
  if (store.canStart) return `点击空座位购买积分并入座（${store.seatedCount}/${store.room?.maxSeats ?? 9}）`;
  if (store.isHost) return '至少 2 人入座后可开始';
  return '等待房主开始游戏…';
});

async function leaveRoom() {
  await store.leaveRoom();
  router.push('/');
}

/** 点击「离开」：房主需二次确认（会转让房主 / 无其他玩家时回收房间），普通玩家直接离开 */
function onLeaveClick() {
  menuOpen.value = false;
  if (store.isHost) leaveOpen.value = true;
  else leaveRoom();
}

function confirmLeave() {
  leaveOpen.value = false;
  leaveRoom();
}
</script>

<template>
  <!-- 加入门槛（扫码/访客进入） -->
  <div v-if="!joined" class="page-center">
    <div class="card-panel gate">
      <h2>加入房间 {{ code.toUpperCase() }}</h2>
      <input v-model="nickname" type="text" maxlength="12" placeholder="输入你的昵称" @keyup.enter="joinWithNickname" />
      <input
        v-if="needPwd"
        v-model="password"
        type="password"
        inputmode="numeric"
        maxlength="4"
        placeholder="4 位房间密码"
        autocomplete="off"
        @keyup.enter="joinWithNickname"
      />
      <button :disabled="!nickname.trim() || (needPwd && password.length !== 4) || store.joining" @click="joinWithNickname">
        {{ store.joining ? '加入中…' : '进入房间' }}
      </button>
      <button class="ghost" @click="router.push('/')">返回大厅</button>
      <p v-if="store.errorMsg" class="gate-err">{{ store.errorMsg }}</p>
    </div>
  </div>

  <div v-else class="room" :class="{ 'log-open': logOpen, 'action-open': actionOpen }" @click="menuOpen = false">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="left">
        <div class="left-row">
          <span class="room-code">
            房间
            <strong class="code-clickable" title="点击复制房间号" @click="copyCode">{{ store.room?.code }}</strong>
            <span v-if="store.room?.isPrivate" class="priv-tag" title="私密房间：不出现在大厅，仅凭邀请加入">🔒</span>
          </span>
          <button class="room-info-btn" title="房间信息" @click="infoOpen = true">❕</button>
          <span v-if="store.isHost" class="host-tag" title="你是房主">房主</span>
          <span v-if="store.room?.game?.handNumber" class="hand-no">
            第 {{ store.room.game.handNumber }}{{ store.room.maxHands > 0 ? `/${store.room.maxHands}` : '' }} 手
          </span>
        </div>
        <button
          class="member-count"
          :class="{ active: membersOpen }"
          :title="`在座 ${store.humanSeatedCount} 人 · 观战 ${store.room?.spectators.length ?? 0} 人`"
          @click="membersOpen = !membersOpen"
        >
          👤 {{ store.humanSeatedCount + (store.room?.spectators.length ?? 0) }}
        </button>
      </div>
      <div class="right">
        <button class="ghost sm menu-toggle" @click.stop="menuOpen = !menuOpen">{{ menuOpen ? '✕' : '☰' }}</button>
      </div>
    </header>

    <!-- 顶部展开菜单：放在顶栏外，避免被对局记录侧栏压住 -->
    <transition name="fade">
      <div v-if="menuOpen" class="menu-dropdown" @click.stop>
        <button class="menu-item" @click="toggleSound()">
          <span class="mi-icon">{{ soundOn ? '🔊' : '🔇' }}</span>
          <span>{{ soundOn ? '静音' : '开启音效' }}</span>
        </button>
        <button class="menu-item" @click="qrOpen = true; menuOpen = false">
          <span class="mi-icon">🔗</span>
          <span>邀请</span>
        </button>
        <button
          v-if="store.isHost"
          class="menu-item danger-text"
          @click="dissolveOpen = true; menuOpen = false"
        >
          <span class="mi-icon">🗑️</span>
          <span>解散</span>
        </button>
        <button class="menu-item leave" @click="onLeaveClick()">
          <span class="mi-icon">🚪</span>
          <span>离开</span>
        </button>
      </div>
    </transition>

    <!-- 弹幕飘屏层 -->
    <DanmakuLayer />

    <!-- 弹幕入口：右下角悬浮按钮（结算面板冻结牌桌时也可用）；输入框打开后隐藏自身 -->
    <button
      v-if="!danmakuOpen"
      ref="danmakuFab"
      class="danmaku-fab"
      :style="danmakuStyle"
      @click="danmakuOpen = !danmakuOpen"
    >💬 弹幕</button>

    <!-- 看牌入口：左下角 V 形两张牌背图标（无文字），本人在手牌中持有底牌时显示 -->
    <button
      v-if="canViewCards"
      ref="peekFab"
      class="peek-fab"
      :class="{ active: store.cardsVisible, folded: iFolded }"
      :style="peekStyle"
      aria-label="查看我的底牌"
      @click="store.toggleCards()"
    >
      <span class="peek-v" :class="{ revealed: store.cardsVisible }">
        <PlayingCard
          :card="store.cardsVisible ? (store.holeCards[0] ?? null) : null"
          :face-up="store.cardsVisible"
          size="mini"
          class="pv-a"
        />
        <PlayingCard
          :card="store.cardsVisible ? (store.holeCards[1] ?? null) : null"
          :face-up="store.cardsVisible"
          size="mini"
          class="pv-b"
        />
      </span>
      <span class="peek-tip">{{ store.cardsVisible ? '点击盖上手牌' : '点击查看当前手牌' }}</span>
    </button>

    <!-- 弹幕输入面板 -->
    <DanmakuInput :open="danmakuOpen" @close="danmakuOpen = false" />

    <!-- 房间成员列表（房主可踢人） -->
    <MemberList :open="membersOpen" @close="membersOpen = false" />

    <!-- 输光补码/离席决策弹窗（只对输光玩家显示，倒计时结束服务端自动离席） -->
    <BustDialog />

    <!-- 牌桌 -->
    <main class="table-zone">
      <PokerTable @sit="onSit" />
      <!-- 结算面板：只覆盖牌桌区域，顶栏按钮/右侧记录栏/弹幕入口保持可用 -->
      <HandSummary />
    </main>

    <!-- 我的底牌：最顶层浮层，从图标翻牌放大到屏幕下方，点击任意位置收起（收起逻辑见 onDocClick） -->
    <transition :css="false" @enter="onCardsEnter" @leave="onCardsLeave">
      <div
        v-if="canViewCards && store.cardsVisible"
        ref="cardOverlay"
        class="card-overlay"
        :class="{ folded: iFolded }"
      >
        <div class="co-cards">
          <PlayingCard v-for="(c, i) in store.holeCards" :key="i" :card="c" face-up size="normal" />
        </div>
      </div>
    </transition>

    <!-- 大厅控制条 -->
    <div v-if="lobby" class="lobby-bar">
      <div class="lobby-hint">{{ lobbyHint }}</div>
      <div class="lobby-actions">
        <button v-if="store.canStart" class="start-btn" @click="store.startGame()">
          <span class="btn-icon">▶</span>
          <span class="btn-label">开始</span>
        </button>
        <button v-if="store.isSeated" class="ghost sm" @click="store.leaveSeat()">
          <span class="btn-icon">🏃</span>
          <span class="btn-label">离座</span>
        </button>
        <button v-if="store.isHost" class="ghost sm" @click="settingsOpen = true">
          <span class="btn-icon">⚙</span>
          <span class="btn-label">设置</span>
        </button>
        <button class="ghost sm danmaku-mobile" @click="danmakuOpen = !danmakuOpen">
          <span class="btn-icon">💬</span>
          <span class="btn-label">弹幕</span>
        </button>
      </div>
    </div>

    <!-- 游戏中控制条（仅在有内容时渲染，避免空胶囊占位） -->
    <div v-if="playing && (store.isSpectator || canRebuy || showStop)" class="game-bar">
      <span v-if="store.isSpectator" class="spec-badge">👁 观战中 · 游戏已开始，下一局可入座</span>
      <div class="game-actions">
        <button v-if="canRebuy" class="ok sm" @click="openRebuy">
          <span class="btn-icon">💰</span>
          <span class="btn-label">补码</span>
        </button>
        <button v-if="showStop" class="danger sm" @click="store.stopGame()">
          <span class="btn-icon">⏹</span>
          <span class="btn-label">结束</span>
        </button>
        <button class="ghost sm danmaku-mobile" @click="danmakuOpen = !danmakuOpen">
          <span class="btn-icon">💬</span>
          <span class="btn-label">弹幕</span>
        </button>
      </div>
    </div>

    <!-- 记录侧栏把手：贴屏幕右缘（左半圆、右端嵌入右缘），点击从右侧弹出对局记录 -->
    <button
      v-if="!logOpen"
      class="log-handle"
      aria-label="打开对局记录"
      @click="logOpen = true"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M20 12H4 M10 6l-6 6 6 6"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="log-tip">打开对局记录</span>
    </button>

    <!-- 对局记录侧边栏 -->
    <ActionLog :open="logOpen" @close="logOpen = false" />

    <!-- 下注面板 -->
    <BetPanel />

    <!-- 横幅 -->
    <div class="banners">
      <transition-group name="banner">
        <div v-for="b in store.banners" :key="b.id" class="banner">
          <div class="banner-title">{{ b.title }}</div>
          <div v-if="b.sub" class="banner-sub">{{ b.sub }}</div>
        </div>
      </transition-group>
    </div>

    <!-- 错误提示 -->
    <transition name="fade">
      <div v-if="store.errorMsg" class="toast">{{ store.errorMsg }}</div>
    </transition>

    <!-- 复制成功提示 -->
    <transition name="fade">
      <div v-if="copied" class="copy-toast">复制成功</div>
    </transition>

    <!-- 弹层 -->
    <BuyInDialog
      :open="buyInOpen"
      :mode="buyInMode"
      @confirm="confirmBuyIn"
      @bot="confirmBot"
      @close="buyInOpen = false"
    />
    <QrInvite :open="qrOpen" :url="store.inviteUrl" :code="store.room?.code ?? ''" @close="qrOpen = false" />
    <RoomSettingsDialog :open="settingsOpen" @close="settingsOpen = false" />
    <RoomInfoDialog :open="infoOpen" @close="infoOpen = false" />
    <ConfirmDialog
      :open="dissolveOpen"
      title="解散房间"
      message="解散后所有玩家将被请出，本房间的筹码与对局记录都会丢失，确定解散吗？"
      confirm-text="确认解散"
      @confirm="confirmDissolve"
      @close="dissolveOpen = false"
    />
    <ConfirmDialog
      :open="leaveOpen"
      title="离开房间"
      message="你是房主，离开后房主身份将自动转让给房间内的下一位玩家；若房间内已无其他玩家，该房间将被自动回收。确定离开吗？"
      confirm-text="确认离开"
      @confirm="confirmLeave"
      @close="leaveOpen = false"
    />
  </div>
</template>

<style scoped>
.room {
  height: 100%;
  height: 100dvh; /* 移动端动态视口高度，规避地址栏跳动 */
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  z-index: 30;
  flex-wrap: wrap;
  gap: 6px;
}
.left,
.right {
  display: flex;
  gap: 10px;
  align-items: center;
}
/* 左侧信息两行排布：第一行房间号/房主/盲注/手数，第二行人数按钮 */
.left {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.left-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.room-code {
  color: var(--text-dim);
  font-size: 14px;
  line-height: 20px;
}
.room-code strong {
  color: var(--gold);
  letter-spacing: 2px;
  font-size: 16px;
}
.room-code strong.code-clickable {
  cursor: pointer;
  transition: opacity 0.15s;
}
.room-code strong.code-clickable:hover {
  opacity: 0.7;
}
.priv-tag {
  margin-left: 4px;
  font-size: 13px;
}
/* 房间号右侧的圆形信息按钮：点击打开房间信息弹窗 */
.room-info-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  margin: 0 -3px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: none;
  color: #fff;
  font-size: 9px;
  line-height: 1;
  outline: none;
}
/* 悬停/点击/聚焦都不改变外观，保持小圆钮稳定 */
.room-info-btn:hover,
.room-info-btn:active,
.room-info-btn:focus,
.room-info-btn:focus-visible {
  border-color: rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  transform: none;
  filter: none;
  outline: none;
}
.host-tag {
  font-size: 11px;
  font-weight: 700;
  color: #3a2c00;
  background: linear-gradient(180deg, #ffd700, #b8860b);
  padding: 0 8px;
  border-radius: 6px;
  margin-left: 2px;
  line-height: 16px;
}
.hand-no {
  font-size: 12px;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.07);
  padding: 0 10px;
  border-radius: 8px;
  line-height: 20px;
}
.member-count {
  font-size: 11px;
  font-family: inherit;
  color: var(--accent);
  background: rgba(76, 201, 240, 0.12);
  border: 1px solid rgba(76, 201, 240, 0.3);
  padding: 2px 8px;
  border-radius: 8px;
  cursor: pointer;
  line-height: 1.2;
}
.member-count:hover,
.member-count.active {
  background: rgba(76, 201, 240, 0.24);
  border-color: var(--accent);
}
.sm {
  padding: 7px 14px;
  font-size: 13px;
}
.btn-icon {
  display: none;
}
.danmaku-mobile {
  display: none;
}

/* 弹幕入口：右下角悬浮按钮（z 高于结算遮罩 90，旧浏览器兜底） */
.danmaku-fab {
  position: fixed;
  right: 18px;
  bottom: calc(18px + env(safe-area-inset-bottom));
  z-index: 96;
  padding: 11px 20px;
  font-size: 15px;
  border-radius: 999px;
  background: linear-gradient(180deg, #3a86ff, #2667d6);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.danmaku-fab.active {
  background: linear-gradient(180deg, #4cc9f0, #1d8fb8);
}

/* 记录侧栏把手：右缘靠上的浮层按钮——白底圆角胶囊，内嵌向左箭头，点击从右侧弹出对局记录 */
.log-handle {
  position: fixed;
  right: -26px; /* 横置胶囊一半嵌入右缘：右半藏到屏幕外，左半露出 */
  top: 90px;
  z-index: 94;
  width: 52px;
  height: 26px;
  padding: 0 26px 0 0; /* 内容收缩到可见的左半胶囊内，箭头居中 */
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(12, 24, 18, 0.92);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.25);
  color: #d8c690;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s,
    color 0.15s,
    box-shadow 0.15s;
}
/* 覆盖全局 button 的 hover/active 位移与增亮，保持把手贴合右缘 */
button.log-handle:hover,
button.log-handle:active {
  transform: none;
  filter: none;
  background: rgba(20, 36, 27, 0.94);
  color: #e8d4a0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
/* 悬停提示：把手位于右缘，气泡贴在把手左侧显示 */
.log-tip {
  position: absolute;
  right: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  background: rgba(18, 24, 30, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 8px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
@media (hover: hover) and (pointer: fine) {
  .log-handle:hover .log-tip {
    opacity: 1;
  }
}

/* 看牌入口：左下角 V 形两张牌背图标（无文字、无边框底色），与弹幕按钮左右对称 */
.peek-fab {
  position: fixed;
  left: 18px;
  bottom: calc(18px + env(safe-area-inset-bottom));
  z-index: 301;
  padding: 6px;
  background: transparent;
  border: none;
  box-shadow: none;
  cursor: pointer;
  line-height: 0;
}
/* hover 提示气泡：说明点击可查看/盖上手牌 */
.peek-tip {
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  background: rgba(18, 24, 30, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 8px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
@media (hover: hover) and (pointer: fine) {
  .peek-fab:hover .peek-tip {
    opacity: 1;
  }
}
/* 图标内两张牌：盖牌摆成 V 形，一张压住另一张 */
.peek-v {
  position: relative;
  display: block;
  width: 40px;
  height: 56px;
}
.peek-v .pv-a,
.peek-v .pv-b {
  position: absolute;
  left: 50%;
  top: 50%;
}
.peek-v .pv-a {
  transform: translate(-50%, -50%) rotate(-14deg);
}
.peek-v .pv-b {
  transform: translate(-50%, -50%) rotate(14deg);
}
/* 展开后：图标变为正面图案，整体模糊化 */
.peek-v.revealed {
  filter: blur(3.5px);
}
/* 已弃牌：左下角图标与展开的底牌整体置灰，表示这两张牌已被弃掉 */
.peek-fab.folded,
.card-overlay.folded {
  filter: grayscale(1);
  opacity: 0.55;
}

/* 我的底牌：最顶层浮层，浮于下注栏等组件之上，不占用布局空间 */
.card-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  pointer-events: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: calc(22px + env(safe-area-inset-bottom));
}
.co-cards {
  position: relative;
  display: flex;
  gap: 18px;
  pointer-events: none;
  will-change: transform, opacity;
}
/* 展开的底牌放大显示（宽屏；小屏在下方 @media 覆盖为更小尺寸） */
.co-cards :deep(.card) {
  --w: 110px;
  --h: 152px;
}

.table-zone {
  flex: 1;
  position: relative;
  min-height: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 容器查询：牌桌按可用高度/宽度取较小者，保持椭圆比例不被压扁 */
  container-type: size;
  padding: 0 8px;
  transition: padding-right 0.28s ease;
}
/* 宽屏展开侧栏时给牌桌让位 */
@media (min-width: 1101px) {
  .room.log-open .table-zone {
    padding-right: 326px;
  }
}

.lobby-bar,
.game-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 14px;
  padding: 10px 20px;
  z-index: 30;
  backdrop-filter: blur(6px);
  max-width: 96vw;
  flex-wrap: wrap;
  width: fit-content;
  margin: 4px auto calc(10px + env(safe-area-inset-bottom, 0px));
  flex-shrink: 0;
}
.lobby-hint {
  color: var(--text-dim);
  font-size: 13px;
}
.lobby-actions,
.game-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.ghost.sm.active {
  background: rgba(255, 215, 0, 0.18);
  color: var(--gold);
}
.ghost.sm.danger-text {
  color: #ff8080;
}
.start-btn {
  background: linear-gradient(180deg, #ffd700, #b8860b);
  color: #3a2c00;
  font-size: 17px;
  padding: 12px 34px;
}
.spec-badge {
  color: #ffd966;
  font-size: 13px;
}

/* 顶部展开菜单 */
.right {
  position: relative;
}
.menu-toggle {
  font-size: 18px;
  line-height: 1;
  padding: 6px 12px;
}
.menu-toggle.active {
  background: rgba(255, 255, 255, 0.12);
}
.menu-dropdown {
  position: fixed;
  top: 50px;
  right: 10px;
  min-width: 150px;
  background: rgba(18, 24, 30, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(10px);
  z-index: 100;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: none;
  transition: background 0.15s;
}
.menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
}
.menu-item.danger-text {
  color: #ff8080;
}
.mi-icon {
  font-size: 15px;
  width: 20px;
  text-align: center;
}

.gate {
  width: 340px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-align: center;
}
.gate-err {
  color: #ef476f;
  font-size: 13px;
}

.banners {
  position: absolute;
  left: 50%;
  top: 9%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  z-index: 35;
  pointer-events: none;
}
.banner {
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid rgba(212, 175, 55, 0.4);
  border-radius: 14px;
  padding: 10px 28px;
  text-align: center;
  backdrop-filter: blur(6px);
}
.banner-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--gold);
  letter-spacing: 2px;
}
.banner-sub {
  font-size: 13px;
  color: var(--text);
  margin-top: 4px;
}
.banner-enter-active,
.banner-leave-active {
  transition: all 0.3s;
}
.banner-enter-from {
  opacity: 0;
  transform: translateY(-14px) scale(0.9);
}
.banner-leave-to {
  opacity: 0;
}

.toast {
  position: fixed;
  left: 50%;
  top: 60px;
  transform: translateX(-50%);
  background: var(--danger);
  padding: 10px 24px;
  border-radius: 10px;
  z-index: 200;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}
.copy-toast {
  position: fixed;
  left: 50%;
  top: 60px;
  transform: translateX(-50%);
  background: rgba(18, 24, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: var(--text);
  font-size: 14px;
  padding: 8px 20px;
  border-radius: 10px;
  z-index: 200;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(6px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ---------- 移动端 ---------- */
@media (max-width: 640px) {
  .table-zone {
    /* 顶部留白：给牌桌顶部座位的底牌/头像留出空间，避免与上方顶栏按钮重叠 */
    padding: 42px 2px 0;
  }
  .topbar {
    font-size: 12px;
  }
  .hand-no {
    font-size: 11px;
    padding: 0 8px;
  }
  .host-tag {
    font-size: 10px;
    padding: 0 6px;
    border-radius: 5px;
  }
  .room-info-btn {
    width: 14px;
    height: 14px;
    font-size: 8px;
  }
  .menu-toggle {
    padding: 5px 10px;
  }
  .menu-dropdown {
    right: 10px;
    top: 46px;
  }
  .lobby-bar,
  .game-bar {
    width: auto;
    max-width: 94vw;
    margin: 0 auto calc(8px + env(safe-area-inset-bottom, 0px));
    border-radius: 16px;
    padding: 8px 14px;
    gap: 6px;
    flex-wrap: wrap;
    background: rgba(0, 0, 0, 0.55);
    justify-content: center;
  }
  .lobby-bar {
    flex-direction: column;
  }
  .lobby-hint,
  .game-bar .spec-badge {
    font-size: 10px;
    text-align: center;
    color: var(--text-dim);
    line-height: 1.2;
  }
  .lobby-actions,
  .game-actions {
    width: auto;
    justify-content: center;
    gap: 6px;
  }
  .lobby-actions button,
  .game-actions button {
    flex: 0 0 auto;
    min-width: 0;
    padding: 6px 12px;
    font-size: 12px;
    border-radius: 10px;
  }
  .lobby-actions button .btn-icon,
  .game-actions button .btn-icon {
    display: none;
  }
  .game-bar {
    flex-direction: column;
  }
  .danmaku-fab {
    display: inline-block;
    right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    padding: 9px 16px;
    font-size: 14px;
  }
  .peek-fab {
    left: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    padding: 5px;
  }
  .co-cards {
    gap: 14px;
  }
  .co-cards :deep(.card) {
    --w: 58px;
    --h: 80px;
  }
  .danmaku-mobile {
    display: none;
  }
  .start-btn {
    font-size: 13px;
    padding: 6px 12px;
  }
  .banners {
    top: 6%;
    width: max-content;
    max-width: 94vw;
  }
  .banner {
    padding: 8px 18px;
  }
  .banner-title {
    font-size: 15px;
  }
  .banner-sub {
    font-size: 12px;
  }
}
</style>
