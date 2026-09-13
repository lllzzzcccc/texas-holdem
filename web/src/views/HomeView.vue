<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { LOBBY_MAX_ROOMS, type RoomSummary } from '@th/shared';
import { useRoomStore } from '../stores/room';
import { savedNickname, saveNickname, socket } from '../socket';
import CreateRoomDialog from '../components/CreateRoomDialog.vue';

const router = useRouter();
const store = useRoomStore();
const nickname = ref(savedNickname());
const roomCode = ref('');
const createOpen = ref(false);

onMounted(() => {
  store.wireSocket();
  socket.connect();
  store.subscribeLobby();
});

onBeforeUnmount(() => {
  store.unsubscribeLobby();
});

const lobbyFull = computed(() => store.lobbyRooms.length >= LOBBY_MAX_ROOMS);

function openCreate() {
  if (!nickname.value.trim()) {
    store.toast('请先填写昵称');
    return;
  }
  createOpen.value = true;
}

function joinRoom() {
  if (!nickname.value.trim() || roomCode.value.trim().length !== 6) return;
  saveNickname(nickname.value.trim());
  router.push(`/room/${roomCode.value.trim().toUpperCase()}`);
}

function enterTable(room: RoomSummary) {
  if (!nickname.value.trim()) {
    store.toast('请先填写昵称再进入牌桌');
    return;
  }
  saveNickname(nickname.value.trim());
  router.push(`/room/${room.code}`);
}

function seatDots(room: RoomSummary): boolean[] {
  return Array.from({ length: room.maxSeats }, (_, i) => i < room.seated);
}
</script>

<template>
  <div class="lobby-page">
    <header class="header">
      <div class="logo">
        <span class="suit black">♠</span>
        <span class="suit red">♥</span>
        <h1>德州扑克</h1>
        <span class="suit red">♦</span>
        <span class="suit black">♣</span>
      </div>
    </header>

    <div class="content">
      <!-- 左侧：身份与创建/加入 -->
      <div class="card-panel form">
        <label class="field">
          <span>你的昵称</span>
          <input v-model="nickname" type="text" maxlength="12" placeholder="输入昵称" @keyup.enter="openCreate" />
        </label>

        <button class="big" :disabled="!nickname.trim() || lobbyFull" @click="openCreate">
          {{ lobbyFull ? '大厅已满' : '创建房间' }}
        </button>

        <div class="divider"><span>或凭房间号加入</span></div>

        <div class="join-row">
          <input
            v-model="roomCode"
            type="text"
            maxlength="6"
            placeholder="6 位房间号"
            style="text-transform: uppercase"
            @keyup.enter="joinRoom"
          />
          <button class="ghost" :disabled="!nickname.trim() || roomCode.trim().length !== 6" @click="joinRoom">
            加入
          </button>
        </div>
      </div>

      <!-- 右侧：游戏大厅 -->
      <section class="hall card-panel">
        <div class="hall-header">
          <div class="hall-title">
            <h2>游戏大厅</h2>
            <span class="hall-tip">
              <span class="tip-icon">!</span>
              <span class="tip-tooltip">与世界各地玩家共同竞技德州吧！</span>
            </span>
          </div>
        </div>

        <div v-if="store.lobbyRooms.length === 0" class="hall-empty">
          <span class="empty-icon">🂡</span>
          <p>还没有牌桌</p>
          <p class="empty-sub">创建一桌，叫上好友开局吧</p>
        </div>

        <div v-else class="table-grid">
          <button
            v-for="room in store.lobbyRooms"
            :key="room.code"
            class="table-card"
            :class="room.status"
            @click="enterTable(room)"
          >
            <div class="tc-top">
              <span class="tc-code">{{ room.code }}</span>
              <span class="tc-badge" :class="room.status">
                {{ room.status === 'lobby' ? '等待中' : '游戏中' }}
              </span>
            </div>

            <div class="tc-table-icon">
              <div class="mini-table">
                <span
                  v-for="(filled, i) in seatDots(room)"
                  :key="i"
                  class="seat-dot"
                  :class="{ filled }"
                />
              </div>
            </div>

            <div class="tc-info">
              <span>👤 {{ room.seated }}/{{ room.maxSeats }}</span>
              <span v-if="room.spectators > 0">👁 {{ room.spectators }}</span>
              <span>盲注 {{ room.smallBlind }}/{{ room.bigBlind }}</span>
              <span v-if="room.status === 'playing'">第 {{ room.handNumber }} 手</span>
            </div>

            <div class="tc-footer">
              <span class="tc-host">房主：{{ room.hostNickname }}</span>
              <span class="tc-enter">{{ room.status === 'playing' ? '观战 ›' : '入座 ›' }}</span>
            </div>
          </button>
        </div>
      </section>
    </div>

    <CreateRoomDialog
      :open="createOpen"
      :nickname="nickname"
      @close="createOpen = false"
      @created="(code) => router.push(`/room/${code}`)"
    />

    <transition name="fade">
      <div v-if="store.errorMsg" class="toast">{{ store.errorMsg }}</div>
    </transition>
  </div>
</template>

<style scoped>
.lobby-page {
  /* 必须是固定高度而非 min-height：内容超高时元素不能再跟着长高，
     否则 body overflow:hidden 会把超出部分裁剪掉且无法滚动 */
  height: 100%;
  height: 100dvh; /* 移动端动态视口，规避地址栏高度抖动 */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 20px 48px;
  gap: 22px;
}
.header {
  text-align: center;
}
.logo {
  display: flex;
  align-items: center;
  gap: 14px;
}
.logo h1 {
  font-size: clamp(26px, 6vw, 38px);
  letter-spacing: 8px;
  background: linear-gradient(180deg, #ffd700, #b8860b);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.suit {
  font-size: clamp(18px, 4vw, 28px);
}
.suit.red {
  color: #e63946;
}
.suit.black {
  color: #dfe6ee;
}

.content {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  width: min(1060px, 100%);
  justify-content: center;
  flex-wrap: wrap;
}

.form {
  width: min(320px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: none;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  color: var(--text-dim);
}
.big {
  padding: 14px;
  font-size: 17px;
}
.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-dim);
  font-size: 13px;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.12);
}
.join-row {
  display: flex;
  gap: 8px;
}
.join-row button {
  white-space: nowrap;
  padding: 10px 18px;
}

/* ---------- 大厅 ---------- */
.hall {
  flex: 1;
  min-width: min(560px, 100%);
  min-height: 320px;
}
.hall-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16px;
}
.hall-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hall-header h2 {
  font-size: 20px;
  letter-spacing: 3px;
}
.hall-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: help;
  outline: none;
}
.tip-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--text-dim);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.15s,
    border-color 0.15s;
}
.hall-tip:hover .tip-icon {
  color: var(--gold);
  border-color: var(--gold);
}
.tip-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: max-content;
  max-width: min(78vw, 280px);
  padding: 8px 12px;
  background: #16324f;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
  white-space: normal;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease,
    visibility 0.15s;
  pointer-events: none;
  z-index: 30;
}
.hall-tip:hover .tip-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
.hall-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 0;
  color: var(--text-dim);
}
.empty-icon {
  font-size: 44px;
  opacity: 0.5;
}
.empty-sub {
  font-size: 13px;
  opacity: 0.7;
}

.table-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.table-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 14px;
  transition: all 0.18s ease;
}
.table-card:hover {
  border-color: var(--gold);
  background: rgba(212, 175, 55, 0.08);
  transform: translateY(-2px);
}
.tc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tc-code {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 2px;
  color: var(--gold);
}
.tc-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 10px;
}
.tc-badge.lobby {
  background: rgba(82, 183, 136, 0.2);
  color: #52b788;
}
.tc-badge.playing {
  background: rgba(230, 57, 70, 0.2);
  color: #ef476f;
}
.mini-table {
  position: relative;
  width: 100%;
  aspect-ratio: 1000 / 560; /* 与真实牌桌比例一致，不再被压扁 */
  border-radius: 50%;
  background: radial-gradient(ellipse at center, #35805a 0%, #1e5236 100%);
  border: 3px solid #5d4037;
}
.seat-dot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  transform: translate(-50%, -50%);
}
/* 9 个座位点沿椭圆边缘排布：圆心 (50%,50%)，半径 46%（收在木纹边内侧），
   从底部正中起每 40° 一个，与迷你桌 1000/560 的椭圆比例精确贴合 */
.seat-dot:nth-child(1) { left: 50%;   top: 96%; }
.seat-dot:nth-child(2) { left: 20.4%; top: 85.2%; }
.seat-dot:nth-child(3) { left: 4.7%;  top: 58%; }
.seat-dot:nth-child(4) { left: 10.2%; top: 27%; }
.seat-dot:nth-child(5) { left: 34.3%; top: 6.8%; }
.seat-dot:nth-child(6) { left: 65.7%; top: 6.8%; }
.seat-dot:nth-child(7) { left: 89.8%; top: 27%; }
.seat-dot:nth-child(8) { left: 95.3%; top: 58%; }
.seat-dot:nth-child(9) { left: 79.6%; top: 85.2%; }
.seat-dot.filled {
  background: #ffd966;
  box-shadow: 0 0 4px rgba(255, 217, 102, 0.8);
}
.tc-info {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 12px;
  color: var(--text-dim);
}
.tc-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
.tc-host {
  color: var(--text-dim);
  max-width: 65%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tc-enter {
  color: var(--gold);
  font-weight: 700;
}

.toast {
  position: fixed;
  left: 50%;
  top: 32px;
  transform: translateX(-50%);
  background: var(--danger);
  padding: 10px 24px;
  border-radius: 10px;
  z-index: 200;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 720px) {
  .content {
    flex-direction: column;
    align-items: stretch;
  }
  .form,
  .hall {
    width: 100%;
    min-width: 0;
  }
}
</style>
