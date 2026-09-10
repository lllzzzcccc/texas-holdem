<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { LOBBY_MAX_ROOMS, type RoomSummary } from '@th/shared';
import { useRoomStore } from '../stores/room';
import { savedNickname, socket } from '../socket';
import { BLIND_PRESETS, HAND_OPTIONS, SEAT_OPTIONS, TURN_OPTIONS } from '../utils/roomOptions';

const router = useRouter();
const store = useRoomStore();
const nickname = ref(savedNickname());
const roomCode = ref('');
const busy = ref(false);

// 房间设置
const blindPreset = ref('10/20');
const maxSeats = ref(9);
const turnTimeoutSec = ref(30);
const maxHands = ref(0);

onMounted(() => {
  store.wireSocket();
  socket.connect();
  store.subscribeLobby();
});

onBeforeUnmount(() => {
  store.unsubscribeLobby();
});

const lobbyFull = computed(() => store.lobbyRooms.length >= LOBBY_MAX_ROOMS);

async function createRoom() {
  if (!nickname.value.trim() || busy.value) return;
  busy.value = true;
  const [smallBlind, bigBlind] = blindPreset.value.split('/').map(Number);
  const code = await store.createRoom(nickname.value.trim(), {
    smallBlind,
    bigBlind,
    maxSeats: maxSeats.value,
    turnTimeoutSec: turnTimeoutSec.value,
    maxHands: maxHands.value,
  });
  busy.value = false;
  if (code) router.push(`/room/${code}`);
}

function joinRoom() {
  if (!nickname.value.trim() || roomCode.value.trim().length !== 6 || busy.value) return;
  router.push(`/room/${roomCode.value.trim().toUpperCase()}`);
}

function enterTable(room: RoomSummary) {
  if (!nickname.value.trim()) {
    store.toast('请先填写昵称再进入牌桌');
    return;
  }
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
          <input v-model="nickname" type="text" maxlength="12" placeholder="输入昵称" @keyup.enter="createRoom" />
        </label>

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

        <button class="big" :disabled="!nickname.trim() || busy || lobbyFull" @click="createRoom">
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
          <h2>游戏大厅</h2>
          <span class="hall-count">{{ store.lobbyRooms.length }} / {{ LOBBY_MAX_ROOMS }} 桌</span>
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
.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.options-grid .field span {
  font-size: 12px;
}
select {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}
select:focus {
  border-color: var(--accent);
}
select option {
  background: #16324f;
  color: #fff;
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
.hall-header h2 {
  font-size: 20px;
  letter-spacing: 3px;
}
.hall-count {
  font-size: 13px;
  color: var(--text-dim);
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
  height: 54px;
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
}
/* 9 个座位点沿椭圆排布（用 nth-child 写死角度） */
.seat-dot:nth-child(1) { left: 48%; top: 84%; }
.seat-dot:nth-child(2) { left: 18%; top: 72%; }
.seat-dot:nth-child(3) { left: 2%;  top: 46%; }
.seat-dot:nth-child(4) { left: 8%;  top: 16%; }
.seat-dot:nth-child(5) { left: 30%; top: 2%; }
.seat-dot:nth-child(6) { left: 62%; top: 2%; }
.seat-dot:nth-child(7) { left: 84%; top: 16%; }
.seat-dot:nth-child(8) { left: 90%; top: 46%; }
.seat-dot:nth-child(9) { left: 74%; top: 72%; }
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
