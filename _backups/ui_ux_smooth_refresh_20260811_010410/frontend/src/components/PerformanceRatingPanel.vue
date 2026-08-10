<script setup>
import { computed, ref, watch } from 'vue'
import { Activity, Award, Calculator, CheckCircle2, RefreshCw, Sparkles, Trophy } from '@lucide/vue'
import { api } from '../services/api'
import { uiStore } from '../stores/ui'
import { number } from '../utils'
import EntityAvatar from './EntityAvatar.vue'
import EmptyState from './EmptyState.vue'

const props = defineProps({ competitions: { type: Array, default: () => [] }, isAdmin: Boolean })
const emit = defineEmits(['updated'])
const competitionId = ref('')
const payload = ref(null)
const loading = ref(false)
const busy = ref(false)

const standardCompetitions = computed(() => props.competitions.filter(item => item.competition_mode !== 'WORLD_CUP_48'))
const selectedCompetition = computed(() => props.competitions.find(item => Number(item.id) === Number(competitionId.value)))
const leaders = computed(() => payload.value?.leaderboard || [])
const topThree = computed(() => leaders.value.slice(0, 3))

async function load() {
  if (!competitionId.value) { payload.value = null; return }
  loading.value = true
  try { payload.value = (await api.get(`/competitions/${competitionId.value}/performance`)).data }
  catch (error) { uiStore.notify(error.message, 'error') }
  finally { loading.value = false }
}
async function recalculate() {
  busy.value = true
  try {
    const result = await api.post(`/competitions/${competitionId.value}/performance/recalculate-matches`, { skip_incomplete: true })
    uiStore.notify(result.data?.message || 'Đã tính lại điểm các trận.')
    await load(); emit('updated')
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { busy.value = false }
}
async function finalize() {
  if (!window.confirm('Chốt BXH hiệu suất và cộng điểm thưởng theo hệ số giải?')) return
  busy.value = true
  try {
    const result = await api.post(`/competitions/${competitionId.value}/performance/finalize`, { allow_incomplete: false })
    uiStore.notify(result.data?.message || 'Đã chốt BXH hiệu suất.')
    await load(); emit('updated')
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { busy.value = false }
}
watch(competitionId, load)
watch(() => props.competitions, (items) => {
  if (competitionId.value || !items?.length) return
  const available = items.filter(item => item.competition_mode !== 'WORLD_CUP_48')
  const finished = available.find(item => item.status === 'FINISHED')
  competitionId.value = finished?.id || available[0]?.id || ''
}, { immediate: true })
</script>

<template>
  <section class="glass card performance-panel">
    <div class="section-title">
      <div>
        <span class="eyebrow"><Activity :size="15"/> Performance Engine</span>
        <h2>Chấm điểm cầu thủ tự động</h2>
        <p>Điểm 1–10 được tính theo vị trí, số phút, bàn thắng, kiến tạo, phòng ngự, cứu thua và kỷ luật. Điểm thưởng BXH được nhân hệ số giải.</p>
      </div>
      <div class="panel-actions">
        <select v-model="competitionId" class="select competition-select">
          <option value="">Chọn giải đấu</option>
          <option v-for="competition in standardCompetitions" :key="competition.id" :value="competition.id">
            {{ competition.name }} · {{ competition.season_name || competition.status }}
          </option>
        </select>
        <button v-if="isAdmin && competitionId" class="btn" :disabled="busy" @click="recalculate"><RefreshCw :size="16"/>Tính lại trận</button>
        <button v-if="isAdmin && competitionId" class="btn btn-primary" :disabled="busy || selectedCompetition?.status !== 'FINISHED'" @click="finalize"><CheckCircle2 :size="16"/>Chốt hiệu suất</button>
      </div>
    </div>

    <div v-if="!competitionId" class="engine-empty">Chọn một giải để xem BXH hiệu suất.</div>
    <div v-else-if="loading" class="engine-empty"><RefreshCw class="spin" :size="20"/>Đang tổng hợp thống kê…</div>
    <template v-else-if="payload">
      <div class="engine-metrics">
        <div><Calculator :size="18"/><span>Hệ số giải</span><b>{{ number(payload.competition?.coefficient || 1) }}</b></div>
        <div><Trophy :size="18"/><span>Trận thiếu điểm</span><b>{{ payload.missing_rating_matches || 0 }}</b></div>
        <div><Sparkles :size="18"/><span>Đủ điều kiện chốt</span><b>{{ payload.ready ? 'Có' : 'Chưa' }}</b></div>
      </div>

      <div v-if="topThree.length" class="performance-podium">
        <article v-for="(player,index) in topThree" :key="player.player_id" :class="['podium-player',`place-${index+1}`]">
          <span class="place">#{{ index + 1 }}</span>
          <EntityAvatar :src="player.photo_url" :name="player.full_name" :size="50" round/>
          <div><b>{{ player.full_name }}</b><small>{{ player.club_name || 'Không có CLB' }}</small></div>
          <strong>{{ number(player.average_rating, 2) }}</strong>
          <small>{{ player.appearances }} trận · {{ player.match_mvp_count || 0 }} MVP</small>
        </article>
      </div>

      <EmptyState v-if="!leaders.length" title="Chưa có điểm hiệu suất" description="Nhập và xác nhận thống kê cầu thủ cho các trận đã kết thúc."/>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Hạng</th><th>Cầu thủ</th><th>Điểm TB</th><th>Trận</th><th>MVP đội</th><th>MVP trận</th><th>Điểm thưởng</th></tr></thead>
          <tbody>
            <tr v-for="(player,index) in leaders" :key="player.player_id">
              <td><b>#{{ index + 1 }}</b></td>
              <td><div class="entity"><EntityAvatar :src="player.photo_url" :name="player.full_name" :size="36" round/><span><b>{{ player.full_name }}</b><small>{{ player.club_name || '—' }}</small></span></div></td>
              <td><span class="rating-chip"><Award :size="14"/>{{ number(player.average_rating, 2) }}</span></td>
              <td>{{ player.appearances }}</td>
              <td>{{ player.team_mvp_count || 0 }}</td>
              <td>{{ player.match_mvp_count || 0 }}</td>
              <td><b>{{ number(player.awarded_points || player.performance_bonus_points || 0, 2) }}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.performance-panel{margin:20px 0}.panel-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.competition-select{min-width:270px}.engine-empty{min-height:110px;display:flex;gap:10px;align-items:center;justify-content:center;color:var(--muted)}.spin{animation:spin .8s linear infinite}.engine-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.engine-metrics>div{padding:14px;border:1px solid var(--line);border-radius:14px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;background:rgba(57,130,255,.045)}.engine-metrics svg{color:var(--primary)}.engine-metrics span{font-size:12px;color:var(--muted)}.performance-podium{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.podium-player{position:relative;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;padding:16px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(135deg,rgba(57,130,255,.08),rgba(255,255,255,.015));overflow:hidden}.podium-player .place{position:absolute;right:8px;top:5px;font-weight:900;font-size:25px;opacity:.09}.podium-player div b,.podium-player div small{display:block}.podium-player div small,.podium-player>small{font-size:10px;color:var(--muted)}.podium-player strong{font-size:24px;color:var(--yellow)}.place-1{border-color:rgba(255,200,87,.36)}.rating-chip{display:inline-flex;align-items:center;gap:5px;color:var(--yellow);font-weight:800}.entity span b,.entity span small{display:block}.entity span small{font-size:10px;color:var(--muted);margin-top:3px}@media(max-width:900px){.engine-metrics,.performance-podium{grid-template-columns:1fr}.competition-select{min-width:0;width:100%}.panel-actions{width:100%}}
</style>
