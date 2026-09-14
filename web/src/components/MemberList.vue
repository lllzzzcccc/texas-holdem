<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoomStore } from '../stores/room';
import ConfirmDialog from './ConfirmDialog.vue';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useRoomStore();

const kickTarget = ref<{ id: string; name: string } | null>(null);

type Row = { id: string; name: string; tag: string };
const rows = computed<Row[]>(() => {
  // AI 玩家不算房间成员，不出现在成员列表
  const seated: Row[] = (store.room?.seats ?? [])
    .filter((s) => s !== null && !s.isBot)
    .map((s) => ({ id: s!.playerId, name: s!.nickname, tag: `${s!.seatIndex + 1} 号位` }));
  const specs: Row[] = (store.room?.spectators ?? []).map((s) => ({
    id: s.playerId,
    name: s.nickname,
    tag: '观战',
  }));
  return [...seated, ...specs];
});

const canKick = computed(() => store.isHost);

function confirmKick() {
  if (kickTarget.value) store.kickPlayer(kickTarget.value.id);
  kickTarget.value = null;
}
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="member-wrapper">
      <div class="member-backdrop" @click="emit('close')" />
      <div class="member-panel card-panel" @click.stop>
        <div class="mp-head">
          <span class="mp-title">房间成员（{{ rows.length }}）</span>
          <button class="mp-close" @click="emit('close')">✕</button>
        </div>
        <ul class="mp-list">
          <li v-for="r in rows" :key="r.id" class="mp-row">
            <div class="mp-id">
              <span class="mp-name">{{ r.name }}</span>
              <span class="mp-tag">{{ r.tag }}</span>
              <span v-if="r.id === store.room?.hostId" class="mp-host">房主</span>
              <span v-if="r.id === store.playerId" class="mp-me">我</span>
            </div>
            <button
              v-if="canKick && r.id !== store.playerId"
              class="mp-kick"
              @click="kickTarget = { id: r.id, name: r.name }"
            >
              踢出
            </button>
          </li>
        </ul>
        <p v-if="!canKick" class="mp-hint">仅房主可以踢出成员</p>

        <ConfirmDialog
          :open="kickTarget !== null"
          title="踢出成员"
          :message="`确定将「${kickTarget?.name ?? ''}」请出房间吗？`"
          confirm-text="踢出"
          @confirm="confirmKick"
          @close="kickTarget = null"
        />
      </div>
    </div>
  </transition>
</template>

<style scoped>
.member-wrapper {
  position: fixed;
  inset: 0;
  z-index: 98;
  pointer-events: none;
}
.member-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: auto;
}
.member-panel {
  position: absolute;
  top: 56px;
  left: 12px;
  width: min(280px, calc(100vw - 24px));
  max-height: 70dvh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  pointer-events: auto;
}
.mp-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mp-title {
  font-size: 14px;
  color: var(--gold);
  letter-spacing: 1px;
  font-weight: 700;
}
.mp-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 15px;
  cursor: pointer;
  padding: 2px 6px;
}
.mp-close:hover {
  color: var(--text);
}
.mp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mp-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 4px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}
.mp-id {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mp-name {
  font-size: 14px;
  color: var(--text);
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-tag {
  font-size: 11px;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.07);
  padding: 1px 6px;
  border-radius: 6px;
}
.mp-host {
  font-size: 11px;
  color: #3a2c00;
  background: var(--gold);
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 700;
}
.mp-me {
  font-size: 11px;
  color: #04222f;
  background: var(--accent);
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 700;
}
.mp-kick {
  background: rgba(239, 71, 111, 0.16);
  border: 1px solid rgba(239, 71, 111, 0.4);
  color: #ff8fa5;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.mp-kick:hover {
  background: rgba(239, 71, 111, 0.3);
}
.mp-hint {
  font-size: 12px;
  color: var(--text-dim);
  text-align: center;
  margin: 2px 0;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>