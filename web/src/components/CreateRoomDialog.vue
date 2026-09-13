<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoomStore } from '../stores/room';
import { BLIND_PRESETS, HAND_OPTIONS, SEAT_OPTIONS, TURN_OPTIONS } from '../utils/roomOptions';
import SelectField, { type SelectOption } from './SelectField.vue';

const props = defineProps<{ open: boolean; nickname: string }>();
const emit = defineEmits<{ close: []; created: [code: string] }>();

const store = useRoomStore();

const blindOptions: SelectOption[] = BLIND_PRESETS.map((b) => ({ value: b, label: b }));
const seatOptions: SelectOption[] = SEAT_OPTIONS.map((n) => ({ value: n, label: `${n} 人` }));
const turnOptions: SelectOption[] = TURN_OPTIONS;
const handOptions: SelectOption[] = HAND_OPTIONS;
const visibilityOptions: SelectOption[] = [
  { value: 'public', label: '公共（大厅可见）' },
  { value: 'private', label: '私密（仅邀请可进）' },
];

const blindPreset = ref('10/20');
const maxSeats = ref(9);
const turnTimeoutSec = ref(30);
const maxHands = ref(0);
const visibility = ref<'public' | 'private'>('public');
const password = ref('');
const busy = ref(false);

// 切回公共房：密码被禁用，清掉已输入的内容
watch(visibility, (v) => {
  if (v === 'public') password.value = '';
});

async function submit() {
  const nick = props.nickname.trim();
  if (!nick || busy.value) return;
  const pw = password.value.trim();
  if (visibility.value === 'private' && pw && !/^\d{4}$/.test(pw)) {
    store.toast('房间密码需为 4 位数字，或留空不设密码');
    return;
  }
  busy.value = true;
  const [smallBlind, bigBlind] = blindPreset.value.split('/').map(Number);
  const code = await store.createRoom(nick, {
    smallBlind,
    bigBlind,
    maxSeats: maxSeats.value,
    turnTimeoutSec: turnTimeoutSec.value,
    maxHands: maxHands.value,
    isPrivate: visibility.value === 'private',
    password: visibility.value === 'private' ? pw || undefined : undefined,
  });
  busy.value = false;
  if (code) {
    emit('close');
    emit('created', code);
  }
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="card-panel dialog">
        <h3>创建房间</h3>
        <p class="hint">以「{{ nickname }}」的身份创建</p>

        <div class="options-grid">
          <div class="field">
            <span>盲注</span>
            <SelectField v-model="blindPreset" :options="blindOptions" />
          </div>
          <div class="field">
            <span>最大座位</span>
            <SelectField v-model="maxSeats" :options="seatOptions" />
          </div>
          <div class="field">
            <span>出牌时间</span>
            <SelectField v-model="turnTimeoutSec" :options="turnOptions" />
          </div>
          <div class="field">
            <span>回合数</span>
            <SelectField v-model="maxHands" :options="handOptions" />
          </div>
          <div class="field">
            <span>房间类型</span>
            <SelectField v-model="visibility" :options="visibilityOptions" />
          </div>
          <label v-if="visibility === 'private'" class="field">
            <span>房间密码（选填）</span>
            <input
              v-model="password"
              type="password"
              inputmode="numeric"
              maxlength="4"
              placeholder="留空则无密码"
              autocomplete="off"
            />
          </label>
        </div>

        <div class="btn-row">
          <button :disabled="busy" @click="submit">{{ busy ? '创建中…' : '创建' }}</button>
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
.field input {
  width: 100%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  cursor: text;
}
.field input:focus {
  border-color: var(--accent);
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