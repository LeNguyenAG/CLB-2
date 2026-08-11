<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Crown, Sparkles } from '@lucide/vue'
import ClubMascot from './ClubMascot.vue'
import EntityAvatar from './EntityAvatar.vue'

const props = defineProps({
  rounds: { type: Array, default: () => [] }, matches: { type: Array, default: () => [] },
  links: { type: Array, default: () => [] }, historicalAchievements: { type: Array, default: () => [] },
  previousPodium: { type: Array, default: () => [] }, admin: { type: Boolean, default: false },
})
const emit = defineEmits(['result'])
const CARD_WIDTH = 280, COLUMN_GAP = 62, topOffset = 78, bottomOffset = 38
const bracketScroll = ref(null), activeRoundIndex = ref(0), selectedClubId = ref(null), dragging = ref(false)
let dragStartX = 0, dragStartLeft = 0, dragMoved = false

function roundCode(round) {
  const teams = Number(round.team_count || 0)
  return teams === 8 ? 'QF' : teams === 4 ? 'SF' : teams === 2 ? 'FINAL' : `R${teams}`
}
const allRounds = computed(() => props.rounds.map((round) => ({ ...round, round_code: roundCode(round), matches: props.matches.filter((match) => Number(match.round_id) === Number(round.id)).sort((a,b) => Number(a.match_no)-Number(b.match_no)) })))
const visibleRounds = computed(() => allRounds.value.slice(activeRoundIndex.value))
const canvasWidth = computed(() => Math.max(CARD_WIDTH, visibleRounds.value.length * (CARD_WIDTH + COLUMN_GAP) - COLUMN_GAP))
const maxMatches = computed(() => Math.max(1, ...visibleRounds.value.map((round) => round.matches.length)))
const canvasHeight = computed(() => Math.max(520, Math.min(2480, maxMatches.value * 140 + 116)))
const positions = computed(() => {
  const map = new Map()
  visibleRounds.value.forEach((round, roundIndex) => round.matches.forEach((match, matchIndex) => map.set(Number(match.id), {
    x: roundIndex * (CARD_WIDTH + COLUMN_GAP), y: topOffset + ((matchIndex + .5) * (canvasHeight.value - topOffset - bottomOffset)) / Math.max(1, round.matches.length),
  })))
  return map
})
const matchLookup = computed(() => new Map(props.matches.map((match) => [Number(match.id), match])))
const historyMap = computed(() => new Map(props.historicalAchievements.map((row) => [Number(row.club_id), row])))
const podiumMap = computed(() => new Map(props.previousPodium.map((row) => [Number(row.club_id), row])))
const connectors = computed(() => props.links.map((link) => {
  const source = matchLookup.value.get(Number(link.source_match_id)), from = positions.value.get(Number(link.source_match_id)), to = positions.value.get(Number(link.target_match_id))
  if (!source || !from || !to) return null
  const startX = from.x + CARD_WIDTH, middleX = startX + (to.x - startX) / 2, winnerSeed = Number(source.winner_club_id) === Number(source.home_club_id) ? source.home_seed_no : source.away_seed_no
  return { id:`${link.source_match_id}-${link.target_match_id}`, d:`M ${startX} ${from.y} H ${middleX} V ${to.y} H ${to.x}`, advanced:source.status==='FINISHED'&&source.winner_club_id, seedClass:seedClass(winnerSeed), clubId:Number(source.winner_club_id||0) }
}).filter(Boolean))

function seedClass(rank) { const seed=Number(rank||0); return seed===1?'seed-vip-1':seed===2?'seed-vip-2':seed<=4&&seed>0?'seed-vip-3':seed<=8&&seed>0?'seed-vip-4':'seed-standard' }
function cardStyle(round, index) { const roundIndex=visibleRounds.value.findIndex((item)=>Number(item.id)===Number(round.id)); return { left:`${roundIndex*(CARD_WIDTH+COLUMN_GAP)}px`,top:`${topOffset+((index+.5)*(canvasHeight.value-topOffset-bottomOffset))/Math.max(1,round.matches.length)}px` } }
function podiumLabel(row) { return Number(row?.placement)===1?'Đương kim vô địch':Number(row?.placement)===2?'Á quân mùa trước':'Hạng ba mùa trước' }
function teamSelected(match) { return !selectedClubId.value || [Number(match.home_club_id),Number(match.away_club_id)].includes(Number(selectedClubId.value)) }
function selectClub(id) { if (!id) return; selectedClubId.value = Number(selectedClubId.value)===Number(id)?null:Number(id) }
async function focusRound(index) { activeRoundIndex.value=Math.max(0,Math.min(index,allRounds.value.length-1)); await nextTick(); bracketScroll.value?.scrollTo({left:0,top:0,behavior:'smooth'}) }
function pointerDown(event){if(event.pointerType!=='mouse'||event.button!==0||event.target.closest('button'))return;dragging.value=true;dragMoved=false;dragStartX=event.clientX;dragStartLeft=bracketScroll.value.scrollLeft;bracketScroll.value.setPointerCapture(event.pointerId)}
function pointerMove(event){if(!dragging.value)return;const distance=event.clientX-dragStartX;if(Math.abs(distance)>4)dragMoved=true;bracketScroll.value.scrollLeft=dragStartLeft-distance}
function pointerUp(event){if(!dragging.value)return;dragging.value=false;bracketScroll.value?.releasePointerCapture?.(event.pointerId)}
function onWheel(event){if(Math.abs(event.deltaX)>Math.abs(event.deltaY))return;if(event.shiftKey||event.target.closest('.round-columns-header')){event.preventDefault();bracketScroll.value.scrollLeft+=event.deltaY}}
watch(() => props.rounds, () => { activeRoundIndex.value=0; selectedClubId.value=null })
</script>

<template>
  <div v-if="allRounds.length" class="club-bracket">
    <div class="bracket-toolbar">
      <div class="round-jumps"><button v-for="(round,index) in allRounds" :key="round.id" :class="{active:index===activeRoundIndex}" @click="focusRound(index)"><span>{{ round.round_code }}</span>{{ round.round_name }}</button></div>
      <div class="round-nav"><button :disabled="activeRoundIndex===0" @click="focusRound(activeRoundIndex-1)"><ChevronLeft :size="17"/></button><b>{{ allRounds[activeRoundIndex]?.round_name }}</b><button :disabled="activeRoundIndex===allRounds.length-1" @click="focusRound(activeRoundIndex+1)"><ChevronRight :size="17"/></button></div>
    </div>
    <div v-if="selectedClubId" class="club-focus"><Sparkles :size="14"/>Đang làm sáng toàn bộ hành trình của CLB đã chọn<button @click="selectedClubId=null">Bỏ chọn</button></div>
    <div ref="bracketScroll" class="bracket-scroll" :class="{dragging}" @wheel="onWheel" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp">
      <div class="bracket-canvas" :style="{width:`${canvasWidth}px`,height:`${canvasHeight}px`}">
        <svg class="bracket-connectors" :width="canvasWidth" :height="canvasHeight"><path v-for="connector in connectors" :key="connector.id" :d="connector.d" class="bracket-path" :class="[connector.seedClass,{advanced:connector.advanced,focused:selectedClubId&&connector.clubId===Number(selectedClubId),muted:selectedClubId&&connector.clubId!==Number(selectedClubId)}]"/></svg>
        <div class="round-columns-header"><section v-for="(round,index) in visibleRounds" :key="round.id" class="round-column" :style="{left:`${index*(CARD_WIDTH+COLUMN_GAP)}px`}"><header><small>{{ round.round_code }}</small><h3>{{ round.round_name }}</h3><span>{{ round.matches.length }} trận</span></header></section></div>
        <template v-for="round in visibleRounds" :key="round.id"><article v-for="(match,index) in round.matches" :key="match.id" class="bracket-match" :class="[{finished:match.status==='FINISHED',final:round.round_code==='FINAL',muted:selectedClubId&&!teamSelected(match)},match.status==='FINISHED'?seedClass(Number(match.winner_club_id)===Number(match.home_club_id)?match.home_seed_no:match.away_seed_no):'']" :style="cardStyle(round,index)">
          <button v-for="side in ['home','away']" :key="side" type="button" class="club-row" :class="{winner:Number(match.winner_club_id)===Number(match[`${side}_club_id`]),focused:Number(selectedClubId)===Number(match[`${side}_club_id`])}" @click="selectClub(match[`${side}_club_id`])">
            <ClubMascot v-if="match[`${side}_mascot_key`]" :mascot-key="match[`${side}_mascot_key`]" :fallback-name="match[`${side}_club_name`]" :size="38" :animated="Number(match.winner_club_id)===Number(match[`${side}_club_id`])"/>
            <EntityAvatar v-else :src="match[`${side}_logo`]" :name="match[`${side}_club_name`]||'CLB'" :size="38"/>
            <span class="club-info"><span><i v-if="match[`${side}_seed_no`]" class="seed-chip" :class="seedClass(match[`${side}_seed_no`])">S{{ match[`${side}_seed_no`] }}</i><b>{{ match[`${side}_club_name`]||'Chờ xác định' }}</b></span><small v-if="podiumMap.get(Number(match[`${side}_club_id`]))" :class="`podium-${podiumMap.get(Number(match[`${side}_club_id`])).placement}`"><Crown :size="9"/>{{ podiumLabel(podiumMap.get(Number(match[`${side}_club_id`]))) }}</small><small v-else-if="historyMap.get(Number(match[`${side}_club_id`]))?.champion_count" class="champion">★ {{ historyMap.get(Number(match[`${side}_club_id`])).champion_count }} lần vô địch</small></span>
            <strong>{{ match[`${side}_score`]??'–' }}</strong>
          </button>
          <div v-if="match.status==='FINISHED'" class="advance-signal" :class="seedClass(Number(match.winner_club_id)===Number(match.home_club_id)?match.home_seed_no:match.away_seed_no)"><Sparkles :size="11"/>{{ match.winner_club_name }} tiến vào vòng trong</div>
          <button v-if="admin&&match.home_club_id&&match.away_club_id" class="btn btn-sm result-button" @click="!dragMoved&&emit('result',match)">{{ match.status==='FINISHED'?'Sửa tỷ số':'Nhập tỷ số' }}</button>
        </article></template>
      </div>
    </div>
    <div class="bracket-hint"><span>Vuốt hoặc kéo ngang để xem vòng sau</span><span>Bấm CLB để soi toàn bộ đường đi</span><span>Chọn vòng để đưa vòng đó lên đầu</span></div>
  </div>
  <div v-else class="empty">Nhánh đấu chưa được tạo.</div>
</template>

<style scoped>
.club-bracket{overflow:hidden;border:1px solid rgba(111,169,255,.2);border-radius:18px;background:radial-gradient(circle at 88% 8%,rgba(255,210,76,.08),transparent 25%),linear-gradient(145deg,rgba(7,19,39,.96),rgba(4,12,26,.99))}.bracket-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid var(--line);background:rgba(7,17,34,.96)}.round-jumps,.round-nav{display:flex;align-items:center;gap:6px}.round-jumps{min-width:0;overflow-x:auto;scrollbar-width:none}.round-jumps::-webkit-scrollbar{display:none}.round-jumps button,.round-nav button{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 11px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.035);color:var(--muted);font-size:9px;font-weight:850;white-space:nowrap}.round-jumps button span{color:#ffcf54}.round-jumps button.active{color:#fff;border-color:rgba(255,207,84,.58);background:linear-gradient(135deg,rgba(255,199,56,.17),rgba(71,118,255,.12));box-shadow:inset 0 -2px #ffcf54}.round-nav b{min-width:90px;text-align:center;color:#cfe0fb;font-size:9px}.club-focus{display:flex;align-items:center;justify-content:center;gap:7px;padding:7px;color:#ffe27b;background:rgba(255,206,55,.07);font-size:9px}.club-focus button{border:0;background:none;color:#7fbdff;text-decoration:underline}.bracket-scroll{position:relative;width:100%;height:min(72dvh,820px);min-height:520px;overflow:auto!important;overscroll-behavior:contain;scrollbar-gutter:stable;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch;cursor:grab;background-image:linear-gradient(rgba(93,136,211,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(93,136,211,.035) 1px,transparent 1px);background-size:24px 24px}.bracket-scroll.dragging{cursor:grabbing;user-select:none}.bracket-scroll::-webkit-scrollbar{width:12px;height:12px}.bracket-scroll::-webkit-scrollbar-thumb{border:3px solid #071326;border-radius:99px;background:#385d92}.bracket-canvas{position:relative;min-width:max-content;margin:0 22px 24px}.bracket-connectors{position:absolute;inset:0;z-index:1;overflow:visible;pointer-events:none}.bracket-path{fill:none;stroke:rgba(118,149,197,.34);stroke-width:2;vector-effect:non-scaling-stroke;transition:.25s}.bracket-path.advanced{stroke:#65dfa1;stroke-width:2.7;stroke-dasharray:7 8;animation:flow 2.2s linear infinite;filter:drop-shadow(0 0 4px rgba(101,223,161,.8))}.bracket-path.seed-vip-1{stroke:#ffd75f;stroke-width:3.5;animation-duration:1.15s;filter:drop-shadow(0 0 7px #ffd75f)}.bracket-path.seed-vip-2{stroke:#c993ff;stroke-width:3}.bracket-path.seed-vip-3{stroke:#52d9ff}.bracket-path.seed-vip-4{stroke:#68e6ad}.bracket-path.focused{stroke-width:5;opacity:1;filter:drop-shadow(0 0 9px currentColor)}.bracket-path.muted{opacity:.1}@keyframes flow{to{stroke-dashoffset:-30}}.round-column{position:absolute;top:0;z-index:3;width:280px}.round-column header{text-align:center;padding:9px;border:1px solid rgba(108,155,229,.18);border-radius:11px;background:rgba(8,19,38,.97)}.round-column small,.round-column span{display:block;color:var(--muted);font-size:8px}.round-column h3{margin:2px 0}.bracket-match{position:absolute;z-index:4;width:280px;transform:translateY(-50%);padding:9px;border:1px solid var(--line);border-radius:14px;background:linear-gradient(145deg,rgba(13,29,53,.98),rgba(6,16,31,.96));box-shadow:0 10px 26px rgba(0,0,0,.3);transition:.25s}.bracket-match.final{border-color:rgba(255,211,73,.5);background:radial-gradient(circle at 90% 0,rgba(255,209,66,.14),transparent 35%),linear-gradient(145deg,rgba(21,31,44,.98),rgba(20,17,8,.96))}.bracket-match.muted{opacity:.28;filter:saturate(.45)}.club-row{width:100%;display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px;border:0;border-radius:10px;background:transparent;color:var(--muted);text-align:left}.club-row+.club-row{border-top:1px solid var(--line)}.club-row:hover,.club-row.focused{background:rgba(74,134,226,.1);color:var(--text)}.club-row.winner{background:linear-gradient(90deg,rgba(62,216,148,.11),transparent);color:var(--text)}.club-info{min-width:0}.club-info>span{display:flex;align-items:center;gap:5px}.club-info b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.club-info small{width:max-content;max-width:100%;display:flex;align-items:center;gap:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px;padding:2px 5px;border-radius:99px;background:rgba(158,179,214,.08);color:#a9bddc;font-size:6.5px}.club-info .podium-1,.club-info .champion{color:#ffe681;background:rgba(255,206,50,.12)}.club-info .podium-2{color:#e3eaf5}.club-info .podium-3{color:#efb77d}.club-row strong{color:#ffcf54;font-size:17px}.seed-chip{min-width:22px;height:17px;display:inline-grid;place-items:center;padding:0 4px;border-radius:5px;background:rgba(93,136,211,.18);color:#a9c7f7;font-size:7px;font-style:normal;font-weight:950}.seed-chip.seed-vip-1{color:#241800;background:linear-gradient(135deg,#fff2a9,#e7a91d);box-shadow:0 0 10px rgba(255,210,71,.45)}.seed-chip.seed-vip-2{color:#260a43;background:linear-gradient(135deg,#efd4ff,#b578ea)}.seed-chip.seed-vip-3{color:#002434;background:linear-gradient(135deg,#b9f3ff,#45c8ef)}.seed-chip.seed-vip-4{color:#05291b;background:linear-gradient(135deg,#bff6d8,#52d794)}.advance-signal{display:flex;align-items:center;justify-content:center;gap:5px;min-height:20px;margin:5px 6px 0;border-radius:7px;background:rgba(65,213,147,.07);color:#77e5ae;font-size:7px;font-weight:900}.advance-signal.seed-vip-1{color:#ffe072;background:linear-gradient(90deg,transparent,rgba(255,203,43,.14),transparent);text-shadow:0 0 8px rgba(255,217,86,.65)}.result-button{width:100%;margin-top:6px}.bracket-hint{display:flex;justify-content:center;gap:18px;padding:8px 12px;border-top:1px solid var(--line);color:var(--muted);font-size:8px}
@media(max-width:760px){.bracket-toolbar{align-items:stretch;flex-direction:column}.round-jumps{order:1;width:100%}.round-nav{order:2;justify-content:space-between}.round-nav b{flex:1}.bracket-scroll{height:68dvh;min-height:450px;scrollbar-gutter:auto}.bracket-canvas{margin-left:12px;margin-right:18px}.bracket-hint{justify-content:space-between;gap:7px;font-size:7px}.bracket-hint span:first-child{display:none}.round-jumps button{min-height:42px}}@media(prefers-reduced-motion:reduce){.bracket-path.advanced{animation:none}}
</style>
