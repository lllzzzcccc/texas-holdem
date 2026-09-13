<script setup lang="ts">
import { computed } from 'vue';
import { useRoomStore } from '../stores/room';
import { formatChips } from '../utils/chips';
import PlayingCard from './table/PlayingCard.vue';

const store = useRoomStore();

const game = computed(() => store.room?.game ?? null);
const show = computed(() => game.value?.phase === 'hand_end');

/** 摊牌亮出的座位（公开信息，不可盖上） */
const showdownSeats = computed(() => new Set((game.value?.showdown ?? []).map((s) => s.seatIndex)));

/** 本人主动亮出的底牌："seat:cardIndex"（可再点击盖上） */
const revealedSet = computed(
  () => new Set((game.value?.revealedHoles ?? []).map((r) => `${r.seatIndex}:${r.cardIndex}`)),
);

function isPublic(seatIndex: number, cardIndex: number): boolean {
  return showdownSeats.value.has(seatIndex) || revealedSet.value.has(`${seatIndex}:${cardIndex}`);
}

function isOwn(seatIndex: number): boolean {
  return store.mySeat === seatIndex;
}

function isShowdown(seatIndex: number): boolean {
  return showdownSeats.value.has(seatIndex);
}

/** 只有本人能亮/盖自己的牌（摊牌亮出的除外），点哪张切换哪张 */
function clickCard(seatIndex: number, cardIndex: number) {
  if (!isOwn(seatIndex) || showdownSeats.value.has(seatIndex)) return;
  store.showCard(cardIndex);
}

interface Row {
  seatIndex: number;
  nickname: string;
  cards: (string | null)[];
  folded: boolean;
  committed: number;
  award: number;
  handName: string | null;
  isWinner: boolean;
}

const rows = computed<Row[]>(() => {
  if (!store.room || !game.value) return [];
  const awards = new Map((game.value.awards ?? []).map((a) => [a.seatIndex, a]));
  return store.room.seats
    .filter((s) => s && (s.holeCards !== null || s.hasFolded || s.committed > 0))
    .map((s) => {
      const a = awards.get(s!.seatIndex);
      return {
        seatIndex: s!.seatIndex,
        nickname: s!.nickname,
        cards: s!.holeCards ?? [],
        folded: s!.hasFolded,
        committed: s!.committed,
        award: a?.amount ?? 0,
        handName: a?.handName ?? null,
        isWinner: !!a && a.amount > 0,
      };
    })
    .sort((a, b) => b.award - a.award || b.committed - a.committed);
});

const board = computed(() => game.value?.board ?? []);

const handLabel = computed(() => {
  const n = game.value?.handNumber ?? 0;
  const max = store.room?.maxHands ?? 0;
  return max > 0 ? `第 ${n} / ${max} 手 · 结算` : `第 ${n} 手 · 结算`;
});

const gameOver = computed(() => store.room?.status === 'lobby');
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="overlay">
      <div class="card-panel panel">
        <h3 class="title">{{ handLabel }}</h3>

        <!-- 公共牌 -->
        <div v-if="board.length > 0" class="board-row">
          <PlayingCard v-for="(c, i) in board" :key="i" :card="c" size="mini" :face-up="true" />
        </div>

        <div class="rows">
          <div v-for="r in rows" :key="r.seatIndex" class="row" :class="{ winner: r.isWinner, folded: r.folded }">
            <div class="r-main">
              <div class="r-name">
                <span v-if="r.isWinner" class="crown">👑</span>
                {{ r.nickname }}
                <span v-if="r.folded" class="r-tag fold">已弃牌</span>
              </div>
              <div class="r-cards">
                <template v-if="r.cards.length > 0">
                  <!--
                    本人未公开的牌：虚化的正面（自己认得但别人看不到），点击逐张亮出；
                    已亮出的牌再点击可盖上；摊牌亮出的牌是公开信息，不可盖上
                  -->
                  <div
                    v-for="(c, i) in r.cards"
                    :key="i"
                    class="card-click"
                    :class="{ clickable: isOwn(r.seatIndex) && !isShowdown(r.seatIndex) }"
                    :title="
                      isOwn(r.seatIndex) && !isShowdown(r.seatIndex)
                        ? isPublic(r.seatIndex, i)
                          ? '点击盖上这张牌'
                          : '点击亮出这张牌（所有人可见）'
                        : ''
                    "
                    @click="clickCard(r.seatIndex, i)"
                  >
                    <div class="card-veil" :class="{ veiled: isOwn(r.seatIndex) && !isPublic(r.seatIndex, i) }">
                      <PlayingCard :card="c" size="mini" :face-up="isPublic(r.seatIndex, i) || isOwn(r.seatIndex)" />
                    </div>
                  </div>
                </template>
                <span v-else class="r-tag">未参与</span>
              </div>
            </div>
            <div class="r-result">
              <template v-if="r.isWinner">
                <div class="r-win">+{{ formatChips(r.award) }}</div>
                <div v-if="r.handName" class="r-hand">{{ r.handName }}</div>
              </template>
              <template v-else>
                <div class="r-lose">投入 {{ formatChips(r.committed) }}</div>
                <div v-if="r.folded" class="r-hand dim">弃牌</div>
              </template>
            </div>
          </div>
        </div>

        <div class="footer">
          <template v-if="gameOver">
            <button v-if="store.isHost" class="end-btn" @click="store.stopGame()">结束本局</button>
            <span v-else class="wait-text">等待房主结束本局…</span>
          </template>
          <template v-else-if="store.pendingRebuy">
            <span class="wait-text">等待输光玩家抉择…</span>
          </template>
          <template v-else-if="store.isHost">
            <button class="next-btn" @click="store.nextHand()">开始下一手 ▶</button>
          </template>
          <template v-else>
            <span class="wait-text">等待房主开始下一手…</span>
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.overlay {
  /* 只冻结牌桌区域（父级 .table-zone 为 positioned），
     顶栏按钮、右侧记录栏、弹幕入口等其他区域保持可交互；
     不做灰色压暗/模糊——结算时牌桌保持清晰可见 */
  position: absolute;
  inset: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
  padding: 16px;
  border-radius: 18px;
}
.panel {
  width: min(440px, 94%);
  max-height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.title {
  text-align: center;
  font-size: 19px;
  letter-spacing: 3px;
  color: var(--gold);
}
.board-row {
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 10px;
  background: rgba(46, 125, 82, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 8px 14px;
}
.row.winner {
  border-color: rgba(255, 215, 0, 0.55);
  background: rgba(255, 215, 0, 0.08);
}
.row.folded {
  opacity: 0.6;
}
.r-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.r-name {
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crown {
  margin-right: 2px;
}
.r-cards {
  display: flex;
  gap: 4px;
  align-items: center;
}
.card-click.clickable {
  cursor: pointer;
  border-radius: 4px;
  transition: transform 0.15s;
}
/* 触摸设备没有真正的 hover：点击后 :hover 会吸附，导致牌抬起后不回落。
   仅在支持悬停的指针设备上启用「悬停抬升 / 悬停虚化窥牌」效果 */
@media (hover: hover) and (pointer: fine) {
  .card-click.clickable:hover {
    transform: translateY(-2px);
  }
  .card-click.clickable:hover .card-veil.veiled {
    filter: blur(0.8px) saturate(0.8) brightness(0.95);
  }
}
/* 本人未亮出的牌：虚化的正面（自己认得，别人看到的是盖牌） */
.card-veil {
  border-radius: 4px;
  transition: filter 0.25s;
}
.card-veil.veiled {
  filter: blur(1.6px) saturate(0.6) brightness(0.88);
  opacity: 0.82;
}
.r-name .r-tag {
  margin-left: 6px;
}
.r-tag {
  font-size: 12px;
  color: var(--text-dim);
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 10px;
  border-radius: 8px;
}
.r-tag.fold {
  color: #adb5bd;
}
.r-result {
  text-align: right;
  flex: none;
}
.r-win {
  font-size: 17px;
  font-weight: 900;
  color: #ffd966;
}
.r-hand {
  font-size: 12px;
  color: var(--gold);
}
.r-hand.dim {
  color: var(--text-dim);
}
.r-lose {
  font-size: 12px;
  color: var(--text-dim);
}
.footer {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}
.next-btn {
  background: linear-gradient(180deg, #ffd700, #b8860b);
  color: #3a2c00;
  font-size: 16px;
  padding: 12px 36px;
}
.end-btn {
  background: linear-gradient(180deg, #ef476f, #c1123b);
  font-size: 16px;
  padding: 12px 36px;
}
.wait-text {
  color: var(--text-dim);
  font-size: 14px;
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
