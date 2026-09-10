<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoomStore } from '../stores/room';
import { BLIND_PRESETS, HAND_OPTIONS, SEAT_OPTIONS, TURN_OPTIONS } from '../utils/roomOptions';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useRoomStore();

const blindPreset = ref('10/20');
const maxSeats = ref(9);
const turnTimeoutSec = ref(30);
const maxHands = ref(0);
const visibility = ref<'public' | 'private'>('public');
const password = ref('');
const clearPwd = ref(false);
const busy = ref(false);

// 切到公共房：密码不再适用，清掉输入/清除标记
watch(visibility, (v) => {
  if (v === 'public') {
    password.value = '';
    clearPwd.value = false;
  }
});

// 打开时用当前房间参数填充
watch(
  () => props.open,
  (open) => {
    if (!open || !store.room) return;
    blindPreset.value = `${store.room.smallBlind}/${store.room.bigBlind}`;
    if (!BLIND_PRESETS.includes(blindPreset.value)) blindPreset.value = '10/20';
    maxSeats.value = store.room.maxSeats;
    turnTimeoutSec.value = Math.round(store.room.turnTimeoutMs / 1000);
    if (!TURN_OPTIONS.includes(turnTimeoutSec.value)) turnTimeoutSec.value = 30;
    maxHands.value = store.room.maxHands;
    visibility.value = store.room.isPrivate ? 'private' : 'public';
    password.value = '';
    clearPwd.value = false;
  },
);

async function save() {
  if (busy.value) return;
  // 密码三种状态：公共房强制清除；私密房「勾选清除 / 4 位新密码 / 留空不变」
  let pwd: string | undefined;
  if (visibility.value !== 'private') pwd = '';
  else if (clearPwd.value) pwd = '';
  else if (password.value) {
    const p = password.value.trim();
    if (!/^\d{4}$/.test(p)) {
      store.toast('房间密码需为 4 位数字');
      return;
    }
    pwd = p;
  } else {
    pwd = undefined;
  }
  busy.value = true;
  const [smallBlind, bigBlind] = blindPreset.value.split('/').map(Number);
  const ok = await store.configureRoom({
    smallBlind,
    bigBlind,
    maxSeats: maxSeats.value,
    turnTimeoutSec: turnTimeoutSec.value,
    maxHands: maxHands.value,
    isPrivate: visibility.value === 'private',
    password: pwd,
  });
  busy.value = false;
  if (ok) {
    store.banner('房间设置已更新', undefined, 1400);
    emit('close');
  }
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="card-panel dialog">
        <h3>房间设置</h3>
        <p class="hint">仅房主可修改，游戏开始后不可更改</p>

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
          <label class="field">
            <span>房间类型</span>
            <select v-model="visibility">
              <option value="public">公共（大厅可见）</option>
              <option value="private">私密（仅邀请可进）</option>
            </select>
          </label>
          <label v-if="visibility === 'private'" class="field">
            <span>房间密码 {{ store.room?.hasPassword ? '（已设置）' : '' }}</span>
            <input
              v-model="password"
              type="password"
              inputmode="numeric"
              maxlength="4"
              placeholder="4 位数字"
              autocomplete="off"
              :disabled="clearPwd"
            />
          </label>
        </div>
        <p v-if="visibility === 'private'" class="hint">私密房间不会出现在大厅列表，只能通过你分享的房间号或二维码加入</p>
        <label v-if="store.room?.hasPassword && visibility === 'private'" class="clear-row">
          <input v-model="clearPwd" type="checkbox" />
          <span>清除当前密码</span>
        </label>

        <div class="btn-row">
          <button :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</button>
          <button class="ghost" @click="emit('close')">取消</button>
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
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(360px, 92vw);
  max-height: 90dvh;
  overflow-y: auto;
}
h3 {
  text-align: center;
  color: var(--gold);
  letter-spacing: 3px;
}
.hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
  margin-top: -8px;
}
.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
}
.field select {
  width: 100%;
}
.clear-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}
.btn-row {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
