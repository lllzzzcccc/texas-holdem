<script setup lang="ts">
import { computed } from 'vue';
import { chipsFor, formatChips } from '../../utils/chips';

const props = withDefaults(
  defineProps<{
    amount: number;
    /** 是否显示金额标签 */
    label?: boolean;
    /** 筹码直径 px */
    size?: number;
  }>(),
  { label: true, size: 26 },
);

const pieces = computed(() => chipsFor(props.amount));
</script>

<template>
  <div v-if="amount > 0" class="chip-stack">
    <div class="chips" :style="{ '--chip': `${size}px` }">
      <div
        v-for="(c, i) in pieces"
        :key="i"
        class="chip"
        :style="{ background: c.color, borderColor: c.edge, bottom: `${i * 4}px` }"
      >
        <span class="chip-dots" :style="{ borderColor: c.edge }" />
      </div>
    </div>
    <div v-if="label" class="amount">{{ formatChips(amount) }}</div>
  </div>
</template>

<style scoped>
.chip-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.chips {
  position: relative;
  width: var(--chip);
  height: calc(var(--chip) + 7 * 4px);
}
.chip {
  position: absolute;
  left: 0;
  width: var(--chip);
  height: var(--chip);
  border-radius: 50%;
  border: 2px solid;
  box-shadow:
    inset 0 0 0 2px rgba(255, 255, 255, 0.35),
    0 2px 3px rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.chip-dots {
  width: 55%;
  height: 55%;
  border-radius: 50%;
  border: 2px dashed;
  opacity: 0.8;
}
.amount {
  font-size: 12px;
  font-weight: 700;
  color: #ffd966;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  background: rgba(0, 0, 0, 0.55);
  padding: 1px 8px;
  border-radius: 8px;
  white-space: nowrap;
}
</style>
