import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * 牌桌布局：N 个展示位置沿椭圆均匀分布。
 * pos 0 = 底部正中，顺时针递增。
 * 角度制，0°=右，屏幕坐标系（y 向下）顺时针为正。
 */
export function seatAngles(count: number): number[] {
  const step = 360 / count;
  return Array.from({ length: count }, (_, i) => (90 + i * step) % 360);
}

/**
 * 座位中心贴合木纹外轨「边缘」：外轨椭圆（rail）在牌桌盒中的百分比半轴。
 *
 * 横屏：SVG viewBox 1000×520 铺进 aspect-ratio 1000/560 的盒，
 *   preserveAspectRatio="none" 使纵向拉伸 560/520，故
 *   rx = 485/1000 = 48.5%，ry = 245/520 = 47.115%（以盒高度计）。
 * 竖屏：viewBox 620×1000 与盒 620/1000 等比例，无拉伸，
 *   rx = 300/620 = 48.387%，ry = 480/1000 = 48%。
 */
const LANDSCAPE_RX = 48.5;
const LANDSCAPE_RY = 47.115;
/**
 * 竖屏手机：窄高椭圆（座位整体缩小，见 PokerTable --seat-scale）。
 * rx 取 46%：比外轨半轴 48.387% 略收一点，兼顾两侧座位 tab 不越出屏幕；
 * 同时比早期 44% 略外扩，配合公共牌缩小，避免左右头像与公共牌重叠。
 */
const PORTRAIT_RX = 46;
const PORTRAIT_RY = 48;

/** 是否使用竖屏牌桌（窄屏且竖向） */
const isPortraitTable = ref(false);
let listeners = 0;

function updateOrientation(): void {
  isPortraitTable.value = window.innerWidth < 820 && window.innerHeight > window.innerWidth;
}

export function useTableOrientation() {
  onMounted(() => {
    updateOrientation();
    if (listeners === 0) window.addEventListener('resize', updateOrientation);
    listeners++;
  });
  onBeforeUnmount(() => {
    listeners--;
    if (listeners === 0) window.removeEventListener('resize', updateOrientation);
  });
  return isPortraitTable;
}

export function seatStyle(pos: number, count: number, portrait = false): { left: string; top: string } {
  const angles = seatAngles(count);
  const theta = (angles[pos % count] * Math.PI) / 180;
  const rx = portrait ? PORTRAIT_RX : LANDSCAPE_RX;
  const ry = portrait ? PORTRAIT_RY : LANDSCAPE_RY;
  const x = 50 + rx * Math.cos(theta);
  const y = 50 + ry * Math.sin(theta);
  return { left: `${x}%`, top: `${y}%` };
}

/** 座位指向桌心的单位向量（下注筹码摆放方向） */
export function inwardVector(pos: number, count: number): { dx: number; dy: number } {
  const angles = seatAngles(count);
  const theta = (angles[pos % count] * Math.PI) / 180;
  return { dx: -Math.cos(theta), dy: -Math.sin(theta) };
}
