<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, Crown, Medal, Sparkles, Trophy } from "@lucide/vue";

const props = defineProps({
  rounds: { type: Array, default: () => [] },
  matches: { type: Array, default: () => [] },
  matchLinks: { type: Array, default: () => [] },
  historicalAchievements: { type: Array, default: () => [] },
  previousPodium: { type: Array, default: () => [] },
  admin: { type: Boolean, default: false },
});
const emit = defineEmits(["result"]);

const CARD_WIDTH = 268;
const COLUMN_GAP = 58;
const bracketScroll = ref(null);
const activeRoundIndex = ref(0);
const dragging = ref(false);
const dragMoved = ref(false);
let dragStartX = 0;
let dragStartLeft = 0;

const roundsWithMatches = computed(() => props.rounds.map((round) => ({
  ...round,
  matches: props.matches.filter((match) => Number(match.round_id) === Number(round.id)),
})));
const mainRounds = computed(() => roundsWithMatches.value.filter((round) => round.round_code !== "THIRD"));
const thirdRound = computed(() => roundsWithMatches.value.find((round) => round.round_code === "THIRD"));
// Chọn vòng nào thì vòng đó trở thành cột đầu; các vòng cũ được ẩn khỏi sân
// nhưng vẫn luôn có thể gọi lại bằng thanh chọn vòng phía trên.
const visibleRounds = computed(() => mainRounds.value.slice(activeRoundIndex.value));
const visibleRoundIndex = computed(() => new Map(visibleRounds.value.map((round, index) => [Number(round.id), index])));
const canvasWidth = computed(() => Math.max(CARD_WIDTH, visibleRounds.value.length * (CARD_WIDTH + COLUMN_GAP) - COLUMN_GAP));
const maxVisibleMatches = computed(() => Math.max(1, ...visibleRounds.value.map((round) => round.matches.length)));
const canvasHeight = computed(() => Math.max(520, Math.min(2280, maxVisibleMatches.value * 136 + 110)));
const topOffset = 76;
const bottomOffset = 38;
const matchLookup = computed(() => new Map(props.matches.map((match) => [Number(match.id), match])));
const historicalMap = computed(() => new Map(props.historicalAchievements.map((row) => [row.country_code, row])));
const podiumMap = computed(() => new Map(props.previousPodium.map((row) => [row.country_code, row])));

const positions = computed(() => {
  const map = new Map();
  visibleRounds.value.forEach((round, roundIndex) => {
    const count = Math.max(1, round.matches.length);
    round.matches.forEach((match, matchIndex) => map.set(Number(match.id), {
      x: roundIndex * (CARD_WIDTH + COLUMN_GAP),
      y: topOffset + ((matchIndex + 0.5) * (canvasHeight.value - topOffset - bottomOffset)) / count,
    }));
  });
  return map;
});

const connectors = computed(() => props.matchLinks
  .filter((link) => link.source_result === "WINNER")
  .map((link) => {
    const source = matchLookup.value.get(Number(link.source_match_id));
    const from = positions.value.get(Number(link.source_match_id));
    const to = positions.value.get(Number(link.target_match_id));
    if (!source || !from || !to) return null;
    const startX = from.x + CARD_WIDTH;
    const middleX = startX + (to.x - startX) / 2;
    return {
      id: `${link.source_match_id}-${link.target_match_id}`,
      d: `M ${startX} ${from.y} H ${middleX} V ${to.y} H ${to.x}`,
      advanced: source.status === "FINISHED" && Boolean(source.winner_entry_id),
      seedClass: seedClass(source.winner_seed_rank),
    };
  }).filter(Boolean));

function seedClass(rank) {
  const seed = Number(rank || 0);
  if (seed === 1) return "seed-vip-1";
  if (seed === 2) return "seed-vip-2";
  if (seed > 0 && seed <= 4) return "seed-vip-3";
  if (seed > 0 && seed <= 8) return "seed-vip-4";
  return "seed-standard";
}
function matchStyle(round, matchIndex) {
  const roundIndex = visibleRoundIndex.value.get(Number(round.id)) || 0;
  const count = Math.max(1, round.matches.length);
  return {
    left: `${roundIndex * (CARD_WIDTH + COLUMN_GAP)}px`,
    top: `${topOffset + ((matchIndex + 0.5) * (canvasHeight.value - topOffset - bottomOffset)) / count}px`,
  };
}
function history(code) { return historicalMap.value.get(code); }
function podium(code) { return podiumMap.value.get(code); }
function podiumLabel(row) {
  if (Number(row?.placement) === 1) return "Đương kim vô địch";
  if (Number(row?.placement) === 2) return "Á quân mùa trước";
  return "Hạng ba mùa trước";
}
async function focusRound(index) {
  activeRoundIndex.value = Math.max(0, Math.min(index, mainRounds.value.length - 1));
  await nextTick();
  bracketScroll.value?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
}
function stepRound(direction) { focusRound(activeRoundIndex.value + direction); }
function onWheel(event) {
  const el = bracketScroll.value;
  if (!el) return;
  // Touchpad gửi deltaX sẽ cuộn ngang tự nhiên. Shift+wheel hoặc bánh xe trên
  // vùng tiêu đề chuyển sang ngang, còn trong sân vẫn giữ cuộn dọc để xem đủ trận.
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  if (event.shiftKey || event.target.closest(".round-columns-header")) {
    event.preventDefault();
    el.scrollLeft += event.deltaY;
  }
}
function pointerDown(event) {
  if (event.pointerType !== "mouse" || event.button !== 0 || event.target.closest("button")) return;
  const el = bracketScroll.value;
  dragging.value = true;
  dragMoved.value = false;
  dragStartX = event.clientX;
  dragStartLeft = el.scrollLeft;
  el.setPointerCapture(event.pointerId);
}
function pointerMove(event) {
  if (!dragging.value) return;
  const distance = event.clientX - dragStartX;
  if (Math.abs(distance) > 4) dragMoved.value = true;
  bracketScroll.value.scrollLeft = dragStartLeft - distance;
}
function pointerUp(event) {
  if (!dragging.value) return;
  dragging.value = false;
  bracketScroll.value?.releasePointerCapture?.(event.pointerId);
}
function requestResult(match) {
  if (!dragMoved.value) emit("result", match);
}
watch(() => props.rounds, () => { activeRoundIndex.value = 0; }, { deep: false });
</script>

<template>
  <div class="unified-bracket">
    <div class="bracket-toolbar">
      <div class="round-jumps" role="tablist" aria-label="Chọn vòng đấu">
        <button v-for="(round, index) in mainRounds" :key="round.id" type="button"
          :class="{ active: index === activeRoundIndex }" @click="focusRound(index)">
          <span>{{ round.round_code }}</span>{{ round.round_name }}
        </button>
      </div>
      <div class="round-nav">
        <button type="button" :disabled="activeRoundIndex === 0" @click="stepRound(-1)"><ChevronLeft :size="17" /></button>
        <b>{{ mainRounds[activeRoundIndex]?.round_name }}</b>
        <button type="button" :disabled="activeRoundIndex >= mainRounds.length - 1" @click="stepRound(1)"><ChevronRight :size="17" /></button>
      </div>
    </div>

    <div ref="bracketScroll" class="bracket-scroll" :class="{ dragging }" @wheel="onWheel"
      @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp">
      <div class="bracket-canvas" :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }">
        <svg class="bracket-connectors" :width="canvasWidth" :height="canvasHeight" aria-hidden="true">
          <path v-for="connector in connectors" :key="connector.id" :d="connector.d"
            class="bracket-path" :class="[connector.seedClass, { advanced: connector.advanced }]" />
        </svg>
        <div class="round-columns-header">
          <section v-for="(round, index) in visibleRounds" :key="round.id" class="round-column"
            :style="{ left: `${index * (CARD_WIDTH + COLUMN_GAP)}px` }">
            <header><small>{{ round.round_code }}</small><h3>{{ round.round_name }}</h3><span>{{ round.matches.length }} trận</span></header>
          </section>
        </div>
        <template v-for="round in visibleRounds" :key="`matches-${round.id}`">
          <article v-for="(match, matchIndex) in round.matches" :key="match.id" class="bracket-match"
            :class="[{ finished: match.status === 'FINISHED', final: round.round_code === 'FINAL' }, match.status === 'FINISHED' ? seedClass(match.winner_seed_rank) : '']"
            :style="matchStyle(round, matchIndex)">
            <div v-for="side in ['home', 'away']" :key="side" class="nation-row"
              :class="{ winner: Number(match.winner_entry_id) === Number(match[`${side}_entry_id`]) }">
              <img v-if="match[`${side}_flag_url`]" :src="match[`${side}_flag_url`]" :alt="match[`${side}_country_name`] || ''" />
              <span v-else class="flag-fallback">🌐</span>
              <span class="nation-info">
                <span class="nation-name"><i v-if="match[`${side}_seed_rank`]" class="seed-chip" :class="seedClass(match[`${side}_seed_rank`])">S{{ match[`${side}_seed_rank`] }}</i><b>{{ match[`${side}_country_name`] || 'Chờ xác định' }}</b></span>
                <small>{{ match[`${side}_player_name`] || '—' }}</small>
                <span v-if="podium(match[`${side}_country_code`]) || history(match[`${side}_country_code`])" class="achievement-row">
                  <em v-if="podium(match[`${side}_country_code`])" :class="`podium-${podium(match[`${side}_country_code`]).placement}`"><Crown :size="9" />{{ podiumLabel(podium(match[`${side}_country_code`])) }}</em>
                  <em v-else-if="history(match[`${side}_country_code`])?.champion_count" class="champion">★ {{ history(match[`${side}_country_code`]).champion_count }} lần vô địch</em>
                  <em v-else-if="history(match[`${side}_country_code`])?.runner_up_count">🥈 Từng á quân</em>
                  <em v-else-if="history(match[`${side}_country_code`])?.third_count">🥉 Từng hạng ba</em>
                </span>
              </span>
              <strong>{{ match[`${side}_score`] ?? '–' }}</strong>
            </div>
            <div v-if="match.status === 'FINISHED'" class="advance-signal" :class="seedClass(match.winner_seed_rank)"><Sparkles :size="11" />{{ match.winner_country_name }} vào vòng trong</div>
            <button v-if="admin && match.home_entry_id && match.away_entry_id" class="btn btn-sm" @click="requestResult(match)">{{ match.status === 'FINISHED' ? 'Sửa tỷ số' : 'Nhập tỷ số' }}</button>
          </article>
        </template>
      </div>
    </div>
    <div class="bracket-hint"><span>Vuốt/kéo ngang để xem vòng sau</span><span>Chọn vòng phía trên để đưa vòng đó lên đầu</span></div>

    <section v-if="thirdRound?.matches?.length" class="third-place-lane">
      <div><Medal :size="20" /><span><small>Nhánh riêng</small><b>Tranh hạng ba</b></span></div>
      <article v-for="match in thirdRound.matches" :key="match.id" class="bracket-match bronze">
        <div v-for="side in ['home', 'away']" :key="side" class="nation-row"><img v-if="match[`${side}_flag_url`]" :src="match[`${side}_flag_url`]" /><span v-else class="flag-fallback">🌐</span><span class="nation-info"><b>{{ match[`${side}_country_name`] || 'Chờ xác định' }}</b><small>{{ match[`${side}_player_name`] || '—' }}</small></span><strong>{{ match[`${side}_score`] ?? '–' }}</strong></div>
        <button v-if="admin && match.home_entry_id && match.away_entry_id" class="btn btn-sm" @click="emit('result', match)">{{ match.status === 'FINISHED' ? 'Sửa tỷ số' : 'Nhập tỷ số' }}</button>
      </article>
    </section>
  </div>
</template>

<style scoped>
.unified-bracket{overflow:hidden;border:1px solid rgba(111,169,255,.2);border-radius:18px;background:radial-gradient(circle at 88% 8%,rgba(255,210,76,.08),transparent 25%),linear-gradient(145deg,rgba(7,19,39,.94),rgba(4,12,26,.98))}
.bracket-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid var(--line);background:rgba(7,17,34,.96)}
.round-jumps,.round-nav{display:flex;align-items:center;gap:6px}.round-jumps{min-width:0;overflow-x:auto;scrollbar-width:none}.round-jumps::-webkit-scrollbar{display:none}
.round-jumps button,.round-nav button{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 11px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.035);color:var(--muted);font-size:9px;font-weight:850;white-space:nowrap}
.round-jumps button span{color:#ffcf54}.round-jumps button.active{color:#fff;border-color:rgba(255,207,84,.58);background:linear-gradient(135deg,rgba(255,199,56,.17),rgba(71,118,255,.12));box-shadow:inset 0 -2px #ffcf54,0 0 18px rgba(255,194,48,.08)}
.round-nav b{min-width:82px;text-align:center;color:#cfe0fb;font-size:9px}.round-nav button:disabled{opacity:.28}.bracket-scroll{position:relative;width:100%;height:min(72dvh,790px);min-height:520px;overflow-x:auto!important;overflow-y:auto!important;overscroll-behavior:contain;scrollbar-gutter:stable;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch;cursor:grab;background-image:linear-gradient(rgba(93,136,211,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(93,136,211,.035) 1px,transparent 1px);background-size:24px 24px}.bracket-scroll.dragging{cursor:grabbing;user-select:none}.bracket-scroll::-webkit-scrollbar{width:12px;height:12px}.bracket-scroll::-webkit-scrollbar-thumb{border:3px solid #071326;border-radius:99px;background:#385d92}.bracket-scroll::-webkit-scrollbar-corner{background:#071326}
.bracket-canvas{position:relative;min-width:max-content;margin:0 22px 24px}.bracket-connectors{position:absolute;inset:0;z-index:1;overflow:visible;pointer-events:none}.bracket-path{fill:none;stroke:rgba(118,149,197,.32);stroke-width:2;vector-effect:non-scaling-stroke}.bracket-path.advanced{stroke:#65dfa1;stroke-width:2.6;stroke-dasharray:7 8;animation:flow 2.2s linear infinite;filter:drop-shadow(0 0 4px rgba(101,223,161,.8))}.bracket-path.seed-vip-1{stroke:#ffd75f;stroke-width:3.4;animation-duration:1.15s;filter:drop-shadow(0 0 7px #ffd75f)}.bracket-path.seed-vip-2{stroke:#c993ff;stroke-width:3}.bracket-path.seed-vip-3{stroke:#52d9ff}.bracket-path.seed-vip-4{stroke:#68e6ad}@keyframes flow{to{stroke-dashoffset:-30}}
.round-column{position:absolute;top:0;z-index:3;width:268px}.round-column header{text-align:center;padding:9px;border:1px solid rgba(108,155,229,.18);border-radius:11px;background:rgba(8,19,38,.96);box-shadow:0 8px 22px rgba(0,0,0,.2)}.round-column small,.round-column span{display:block;color:var(--muted);font-size:8px}.round-column h3{margin:2px 0}
.bracket-match{position:absolute;z-index:4;width:268px;transform:translateY(-50%);padding:10px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(145deg,var(--panel),rgba(6,16,31,.92));box-shadow:0 10px 26px rgba(0,0,0,.26)}.bracket-match.final{border-color:rgba(255,211,73,.48);background:radial-gradient(circle at 90% 0,rgba(255,209,66,.12),transparent 35%),linear-gradient(145deg,var(--panel),rgba(20,17,8,.94))}.nation-row{display:grid;grid-template-columns:31px minmax(0,1fr) auto;align-items:center;gap:7px;padding:6px}.nation-row+.nation-row{border-top:1px solid var(--line)}.nation-row.winner{background:linear-gradient(90deg,rgba(62,216,148,.1),transparent)}.nation-row img,.flag-fallback{width:31px;height:21px;display:grid;place-items:center;overflow:hidden;border:1px solid rgba(255,255,255,.15);border-radius:5px;background:#0b1a32;object-fit:cover}.nation-info{min-width:0}.nation-name{display:flex;align-items:center;gap:5px;min-width:0}.nation-name b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nation-info b,.nation-info small{display:block}.nation-info b{font-size:10px}.nation-info small{margin-top:2px;color:#8ebaff;font-size:8px}.bracket-match strong{color:#ffcf54;font-size:17px}
.seed-chip{flex:0 0 auto;min-width:22px;height:17px;display:inline-grid;place-items:center;padding:0 4px;border-radius:5px;background:rgba(93,136,211,.18);color:#a9c7f7;font-size:7px;font-style:normal;font-weight:950}.seed-chip.seed-vip-1{color:#241800;background:linear-gradient(135deg,#fff2a9,#e7a91d);box-shadow:0 0 10px rgba(255,210,71,.45)}.seed-chip.seed-vip-2{color:#260a43;background:linear-gradient(135deg,#efd4ff,#b578ea)}.seed-chip.seed-vip-3{color:#002434;background:linear-gradient(135deg,#b9f3ff,#45c8ef)}.seed-chip.seed-vip-4{color:#05291b;background:linear-gradient(135deg,#bff6d8,#52d794)}
.achievement-row{display:flex;margin-top:3px}.achievement-row em{display:inline-flex;align-items:center;gap:3px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 5px;border-radius:99px;background:rgba(158,179,214,.08);color:#a9bddc;font-size:6.5px;font-style:normal;font-weight:850}.achievement-row .podium-1,.achievement-row .champion{color:#ffe681;background:rgba(255,206,50,.12)}.achievement-row .podium-2{color:#e3eaf5}.achievement-row .podium-3{color:#efb77d}.advance-signal{display:flex;align-items:center;justify-content:center;gap:5px;min-height:20px;margin:5px 6px 0;border-radius:7px;background:rgba(65,213,147,.07);color:#77e5ae;font-size:7px;font-weight:900}.advance-signal.seed-vip-1{color:#ffe072;background:linear-gradient(90deg,transparent,rgba(255,203,43,.14),transparent);text-shadow:0 0 8px rgba(255,217,86,.65)}.bracket-match .btn{width:100%;margin-top:7px}
.bracket-hint{display:flex;justify-content:center;gap:18px;padding:8px 12px;border-top:1px solid var(--line);color:var(--muted);font-size:8px}.third-place-lane{display:grid;grid-template-columns:190px minmax(260px,360px);align-items:center;justify-content:center;gap:16px;padding:16px;border-top:1px solid rgba(205,139,71,.2)}.third-place-lane>div{display:flex;align-items:center;gap:10px;color:#d99b62}.third-place-lane>div span{display:grid}.third-place-lane .bracket-match{position:relative;width:auto;transform:none}.bronze{border-color:rgba(204,133,66,.32)}
@media(max-width:760px){.bracket-toolbar{align-items:stretch;flex-direction:column}.round-jumps{order:1;width:100%}.round-nav{order:2;justify-content:space-between}.round-nav b{flex:1}.bracket-scroll{height:68dvh;min-height:450px;scrollbar-gutter:auto}.bracket-canvas{margin-left:12px;margin-right:18px}.bracket-hint{justify-content:space-between;gap:7px;font-size:7px}.third-place-lane{grid-template-columns:1fr}.round-jumps button{min-height:42px;padding:8px 10px}}
@media(prefers-reduced-motion:reduce){.bracket-path.advanced{animation:none}}
</style>
