<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import gsap from 'gsap';
import { useRoomStore } from '../../stores/room';
import { seatPoint } from '../../anim/anchors';
import { sfx } from '../../utils/sound';

/**
 * 表情飞行动画层：监听 store.emojiFlights，每新增一条就让表情
 * 从发送者座位沿抛物线缓慢飞到目标座位，命中后播放音效并移除。
 * 本组件渲染在牌桌动画层（anim-layer）内，坐标与 seatPoint 同一坐标系。
 */
const store = useRoomStore();
const rootEl = ref<HTMLElement | null>(null);
/** 已启动动画的飞行 id（同一 tick 内连发多条时也不会漏播） */
const started = new Set<number>();

watch(
  () => store.emojiFlights.length,
  async () => {
    await nextTick();
    const root = rootEl.value;
    if (!root) return;
    for (const flight of store.emojiFlights) {
      if (started.has(flight.id)) continue;
      started.add(flight.id);
      const el = root.querySelector<HTMLElement>(`[data-flight="${flight.id}"]`);
      if (!el) continue;
      const from = seatPoint(flight.fromSeatIndex);
      const to = seatPoint(flight.toSeatIndex);
      if (!from || !to) {
        store.removeEmojiFlight(flight.id);
        continue;
      }
      sfx.emojiWhoosh();
      const progress = { t: 0 };
      const arc = Math.max(50, Math.abs(to.x - from.x) * 0.18); // 抛物线高度随距离变化
      gsap.to(progress, {
        t: 1,
        duration: 1.5,
        ease: 'power1.inOut',
        onUpdate() {
          const t = progress.t;
          const x = from.x + (to.x - from.x) * t;
          const y = from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * arc;
          gsap.set(el, {
            left: x,
            top: y,
            fontSize: `${22 + t * 22}px`,
            rotation: Math.sin(t * Math.PI * 3) * 18,
          });
        },
        onComplete() {
          // 命中后弹跳淡出（不额外播放命中音效，避免与投掷音重叠）
          gsap.to(el, {
            scale: 1.6,
            opacity: 0,
            duration: 0.45,
            ease: 'back.out(2)',
            onComplete: () => store.removeEmojiFlight(flight.id),
          });
        },
      });
    }
  },
);

onMounted(() => {
  // 组件挂载前已在队列中的遗留飞行（极端情况）直接清理
  if (store.emojiFlights.length > 3) {
    store.emojiFlights.slice(0, -3).forEach((f) => store.removeEmojiFlight(f.id));
  }
});
</script>

<template>
  <div ref="rootEl" class="emoji-flights">
    <span v-for="f in store.emojiFlights" :key="f.id" :data-flight="f.id" class="emoji-flight">{{ f.emoji }}</span>
  </div>
</template>

<style scoped>
.emoji-flights {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 60;
}
.emoji-flight {
  position: absolute;
  left: -100px;
  top: -100px;
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
  will-change: left, top, transform;
}
</style>
