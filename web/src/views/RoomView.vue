<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { EV } from '@th/shared';
import { useRoomStore } from '../stores/room';
import { savedNickname, savedPlayerId, socket } from '../socket';
import { setSoundEnabled, soundEnabled } from '../utils/sound';
import PokerTable from '../components/table/PokerTable.vue';
import BetPanel from '../components/table/BetPanel.vue';
import BuyInDialog from '../components/BuyInDialog.vue';
import QrInvite from '../components/QrInvite.vue';
import HandSummary from '../components/HandSummary.vue';
import ActionLog from '../components/ActionLog.vue';
import RoomSettingsDialog from '../components/RoomSettingsDialog.vue';
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
const buyInMode = ref<'buyin' | 'rebuy'>('buyin');
const chosenPos = ref(0);
const qrOpen = ref(false);
const settingsOpen = ref(false);
const dissolveOpen = ref(false);
const logOpen = ref(window.innerWidth > 1100); // 宽屏默认展开记录侧栏
const danmakuOpen = ref(false);
const membersOpen = ref(false);
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

const joined = computed(() => store.joined);
const lobby = computed(() => store.room?.status === 'lobby');
const playing = computed(() => store.room?.status === 'playing');

onMounted(async () => {
  store.wireSocket();
  store.resetForRoom();
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
  buyInMode.value = 'buyin';
  buyInOpen.value = true;
}

async function confirmBuyIn(amount: number) {
  if (buyInMode.value === 'buyin') {
    // 展示位置即实际座位号（不旋转，坐哪就是哪）
    const ok = await store.takeSeat(chosenPos.value, amount);
    if (ok) buyInOpen.value = false;
  } else {
    await store.rebuy(amount);
    buyInOpen.value = false;
  }
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

async function leaveRoom() {
  await store.leaveRoom();
  router.push('/');
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

  <div v-else class="room" :class="{ 'log-open': logOpen }">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="left">
        <span class="room-code">
          房间 <strong>{{ store.room?.code }}</strong>
          <span v-if="store.room?.isPrivate" class="priv-tag" title="私密房间：不出现在大厅，仅凭邀请加入">🔒</span>
        </span>
        <span class="blinds">盲注 {{ store.room?.smallBlind }}/{{ store.room?.bigBlind }}</span>
        <button
          class="member-count"
          :class="{ active: membersOpen }"
          :title="`在座 ${store.seatedCount} 人 · 观战 ${store.room?.spectators.length ?? 0} 人`"
          @click="membersOpen = !membersOpen"
        >
          👥 {{ store.seatedCount + (store.room?.spectators.length ?? 0) }}
        </button>
        <span v-if="store.room?.game?.handNumber" class="hand-no">
          第 {{ store.room.game.handNumber }}{{ store.room.maxHands > 0 ? `/${store.room.maxHands}` : '' }} 手
        </span>
      </div>
      <div class="right">
        <button class="ghost sm" @click="toggleSound">{{ soundOn ? '🔊' : '🔇' }}</button>
        <button class="ghost sm" :class="{ active: logOpen }" @click="logOpen = !logOpen">记录</button>
        <button class="ghost sm" @click="qrOpen = true">邀请</button>
        <button v-if="store.isHost" class="ghost sm danger-text" @click="dissolveOpen = true">解散</button>
        <button class="ghost sm" @click="leaveRoom">离开</button>
      </div>
    </header>

    <!-- 弹幕飘屏层 -->
    <DanmakuLayer />

    <!-- 弹幕入口：右下角悬浮按钮（结算面板冻结牌桌时也可用） -->
    <button class="danmaku-fab" :class="{ active: danmakuOpen }" @click="danmakuOpen = !danmakuOpen">💬 弹幕</button>

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

    <!-- 大厅控制条 -->
    <div v-if="lobby" class="lobby-bar">
      <span class="hint-text">点击空座位购买积分并入座（{{ store.seatedCount }}/{{ store.room?.maxSeats ?? 9 }}）</span>
      <button v-if="store.canStart" class="start-btn" @click="store.startGame()">开始游戏</button>
      <span v-else-if="store.isHost" class="hint-text">至少 2 人入座后可开始</span>
      <span v-else class="hint-text">等待房主开始游戏…</span>
      <button v-if="store.isSeated" class="ghost sm" @click="store.leaveSeat()">离座</button>
      <button v-if="store.isHost" class="ghost sm" @click="settingsOpen = true">设置</button>
    </div>

    <!-- 游戏中控制条（仅在有内容时渲染，避免空胶囊占位） -->
    <div v-if="playing && (store.isSpectator || canRebuy || showStop)" class="game-bar">
      <span v-if="store.isSpectator" class="spec-badge">👁 观战中 · 游戏已开始，下一局可入座</span>
      <button v-if="canRebuy" class="ok sm" @click="openRebuy">补码继续</button>
      <button v-if="showStop" class="danger sm" @click="store.stopGame()">结束本局</button>
    </div>

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

    <!-- 弹层 -->
    <BuyInDialog :open="buyInOpen" :mode="buyInMode" @confirm="confirmBuyIn" @close="buyInOpen = false" />
    <QrInvite :open="qrOpen" :url="store.inviteUrl" :code="store.room?.code ?? ''" @close="qrOpen = false" />
    <RoomSettingsDialog :open="settingsOpen" @close="settingsOpen = false" />
    <ConfirmDialog
      :open="dissolveOpen"
      title="解散房间"
      message="解散后所有玩家将被请出，本房间的筹码与对局记录都会丢失，确定解散吗？"
      confirm-text="确认解散"
      @confirm="confirmDissolve"
      @close="dissolveOpen = false"
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
.room-code {
  color: var(--text-dim);
  font-size: 14px;
}
.room-code strong {
  color: var(--gold);
  letter-spacing: 2px;
  font-size: 16px;
}
.priv-tag {
  margin-left: 4px;
  font-size: 13px;
}
.blinds,
.hand-no {
  font-size: 12px;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.07);
  padding: 3px 10px;
  border-radius: 8px;
}
.member-count {
  font-size: 12px;
  font-family: inherit;
  color: var(--accent);
  background: rgba(76, 201, 240, 0.12);
  border: 1px solid rgba(76, 201, 240, 0.3);
  padding: 3px 10px;
  border-radius: 8px;
  cursor: pointer;
  line-height: 1.4;
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
.ghost.sm.active {
  background: rgba(255, 215, 0, 0.18);
  color: var(--gold);
}
.ghost.sm.danger-text {
  color: #ff8080;
}
.hint-text {
  color: var(--text-dim);
  font-size: 13px;
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
    padding: 0 2px;
  }
  .topbar {
    font-size: 12px;
  }
  .blinds,
  .hand-no {
    font-size: 11px;
    padding: 2px 8px;
  }
  .lobby-bar,
  .game-bar {
    padding: 8px 14px;
    gap: 8px;
    margin: 2px auto calc(6px + env(safe-area-inset-bottom, 0px));
  }
  .hint-text {
    font-size: 12px;
  }
  .start-btn {
    font-size: 15px;
    padding: 10px 26px;
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
