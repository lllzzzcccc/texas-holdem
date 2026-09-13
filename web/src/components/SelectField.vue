<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export interface SelectOption {
  value: string | number;
  label: string;
}

const props = defineProps<{
  modelValue: string | number;
  options: SelectOption[];
}>();
const emit = defineEmits<{ 'update:modelValue': [v: string | number] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const maxHeight = ref(320);

const currentLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? String(props.modelValue),
);

/** 向上找到最近的滚动容器（对话框），列表高度以它为准，避免超出对话框 */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let cur = el.parentElement;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') return cur;
    cur = cur.parentElement;
  }
  return null;
}

function toggle() {
  if (open.value) {
    open.value = false;
    return;
  }
  computePlacement();
  open.value = true;
}

/** 列表始终向下展开，仅按触发器下方到对话框底部的可用空间限定高度（放不下则内部滚动） */
function computePlacement() {
  const trigger = root.value?.querySelector<HTMLElement>('.trigger');
  const scroller = root.value ? findScrollParent(root.value) : null;
  if (!trigger || !scroller) return;
  const tr = trigger.getBoundingClientRect();
  const cr = scroller.getBoundingClientRect();
  const below = cr.bottom - tr.bottom - 8;
  maxHeight.value = Math.max(80, Math.min(below, 320));
}

function pick(o: SelectOption) {
  emit('update:modelValue', o.value);
  open.value = false;
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div ref="root" class="select-field">
    <button type="button" class="trigger" :class="{ open }" @click="toggle">
      <span class="value">{{ currentLabel }}</span>
      <span class="chevron">▾</span>
    </button>
    <transition name="drop">
      <ul v-if="open" class="menu" :style="{ maxHeight: `${maxHeight}px` }">
        <li v-for="o in options" :key="o.value">
          <button
            type="button"
            class="option"
            :class="{ active: o.value === modelValue }"
            @click="pick(o)"
          >
            {{ o.label }}
          </button>
        </li>
      </ul>
    </transition>
  </div>
</template>

<style scoped>
.select-field {
  position: relative;
  width: 100%;
}
.trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  font-weight: 500;
  text-align: left;
  box-shadow: none;
  transition: border-color 0.15s;
}
.trigger:hover {
  filter: none;
  transform: none;
}
.trigger.open {
  border-color: var(--accent);
}
.trigger .value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trigger .chevron {
  color: var(--text-dim);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.trigger.open .chevron {
  transform: rotate(180deg);
}
.menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 60;
  list-style: none;
  background: #16324f;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
  overflow-y: auto;
  padding: 4px;
  overscroll-behavior: contain;
}
.option {
  display: block;
  width: 100%;
  background: transparent;
  border: none;
  border-radius: 7px;
  padding: 10px 12px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  font-weight: 500;
  text-align: left;
  box-shadow: none;
  transition: background 0.12s;
}
.option:hover {
  background: rgba(255, 255, 255, 0.08);
  filter: none;
  transform: none;
}
.option.active {
  color: var(--gold);
}
.drop-enter-active,
.drop-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
