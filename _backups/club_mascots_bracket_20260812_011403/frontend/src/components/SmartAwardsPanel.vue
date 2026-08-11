<script setup>
import { computed, onMounted, ref } from 'vue'
import { Award, Bot, CheckCircle2, RefreshCw, ShieldCheck, Sparkles, Trophy, TriangleAlert } from '@lucide/vue'
import { api } from '../services/api'
import { uiStore } from '../stores/ui'
import EntityAvatar from './EntityAvatar.vue'

const emit = defineEmits(['updated'])
const loading = ref(true)
const busy = ref(false)
const competitions = ref([])
const competitionId = ref('')
const preview = ref(null)

const selectedCompetition = computed(() => competitions.value.find((item) => Number(item.id) === Number(competitionId.value)))
const coverageTone = computed(() => preview.value?.coverage?.ready ? 'ready' : 'warning')
const canFinalize = computed(() => preview.value?.coverage?.ready && preview.value?.competition?.status === 'FINISHED')

function metricText(item) {
  const winner = item.winner
  if (!winner) return item.no_winner_reason
  if (item.metric_code === 'GOALS') return `${winner.goals} bàn · ${winner.assists} kiến tạo`
  if (item.metric_code === 'ASSISTS') return `${winner.assists} kiến tạo · ${winner.goals} bàn`
  if (item.metric_code === 'GOALKEEPER') return `${winner.clean_sheets} sạch lưới · ${winner.goals_conceded} bàn thua`
  return `${winner.performance_score.toFixed(2)} điểm hiệu suất · ${winner.appearances} trận`
}

async function loadCompetitions() {
  loading.value = true
  try {
    competitions.value = (await api.get('/competitions', { limit: 200 })).data
      .filter((item) => !['CANCELLED'].includes(item.status))
      .sort((a, b) => Number(b.id) - Number(a.id))
    if (!competitionId.value && competitions.value.length) competitionId.value = competitions.value[0].id
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    loading.value = false
  }
}

async function calculate() {
  if (!competitionId.value) return
  busy.value = true
  try {
    preview.value = (await api.get(`/competitions/${competitionId.value}/auto-awards/preview`)).data
  } catch (error) {
    preview.value = null
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}

async function finalize() {
  if (!preview.value?.coverage?.ready) {
    return uiStore.notify('Chưa đủ dữ liệu đã xác nhận để trao danh hiệu công bằng.', 'warning')
  }
  if (!window.confirm(`Hệ thống sẽ chốt danh hiệu cá nhân của ${preview.value.competition.name} theo thống kê đã duyệt. Tiếp tục?`)) return
  busy.value = true
  try {
    const response = await api.post(`/competitions/${competitionId.value}/auto-awards/finalize`, {})
    uiStore.notify(response.data.message)
    preview.value = response.data.preview
    emit('updated')
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadCompetitions()
  if (competitionId.value) await calculate()
})
</script>

<template>
  <section class="smart-awards glass">
    <div class="smart-head">
      <div class="smart-title">
        <span class="robot"><Bot :size="22"/></span>
        <div>
          <span class="eyebrow"><Sparkles :size="13"/> Smart Awards Engine</span>
          <h2>Trung tâm danh hiệu tự động</h2>
          <p>Chỉ dùng thống kê trận đấu đã được FIFA xác nhận. Hệ thống tự cộng toàn giải, xác định người dẫn đầu, trao danh hiệu và cộng điểm BXH.</p>
        </div>
      </div>
      <div class="smart-actions">
        <select v-model="competitionId" class="select" @change="calculate">
          <option value="">Chọn giải đấu</option>
          <option v-for="item in competitions" :key="item.id" :value="item.id">
            {{ item.name }} · {{ item.season_name }}
          </option>
        </select>
        <button class="btn" :disabled="busy || loading" @click="calculate"><RefreshCw :size="16"/>Tính lại</button>
        <button class="btn btn-primary" :disabled="busy || !canFinalize" @click="finalize"><ShieldCheck :size="17"/>Chốt & trao tự động</button>
      </div>
    </div>

    <div v-if="preview" class="coverage" :class="coverageTone">
      <CheckCircle2 v-if="preview.coverage.ready" :size="20"/>
      <TriangleAlert v-else :size="20"/>
      <div>
        <b>{{ preview.coverage.ready ? 'Dữ liệu đạt chuẩn để trao giải' : 'Dữ liệu chưa hoàn chỉnh' }}</b>
        <span>{{ preview.coverage.message }}</span>
      </div>
      <div class="coverage-count">
        <strong>{{ preview.coverage.matches_with_statistics }}/{{ preview.coverage.total_matches }}</strong>
        <small>trận có dữ liệu</small>
      </div>
    </div>

    <div v-if="preview" class="award-grid">
      <article v-for="item in preview.awards" :key="item.award_type_id" class="award-card" :class="{ empty: !item.winner }">
        <div class="award-icon"><Trophy v-if="item.winner" :size="20"/><Award v-else :size="20"/></div>
        <div class="award-name">
          <small>{{ item.metric_label }}</small>
          <h3>{{ item.award_name }}</h3>
        </div>
        <template v-if="item.winner">
          <div class="winner">
            <EntityAvatar :src="item.winner.photo_url" :name="item.winner.full_name" :size="46" round/>
            <div><b>{{ item.winner.full_name }}</b><span>{{ item.winner.country_name_at_award || selectedCompetition?.name }}</span></div>
          </div>
          <p class="metric">{{ metricText(item) }}</p>
          <div class="points"><Sparkles :size="14"/>+{{ Number(item.awarded_points).toLocaleString('vi-VN') }} điểm BXH</div>
          <span v-if="item.existing_awards?.length" class="existing">Đã có bản ghi danh hiệu trong giải</span>
        </template>
        <p v-else class="no-winner">{{ item.no_winner_reason }}</p>
        <details><summary>Quy tắc công tâm</summary><p>{{ item.explanation }}</p></details>
      </article>
    </div>
  </section>
</template>

<style scoped>
.smart-awards{margin-bottom:18px;padding:18px;border:1px solid rgba(255,213,96,.24);border-radius:20px;background:radial-gradient(circle at 8% 0%,rgba(255,210,90,.13),transparent 28%),radial-gradient(circle at 96% 14%,rgba(86,122,255,.15),transparent 30%),var(--glass)}.smart-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.smart-title{display:flex;gap:13px;max-width:720px}.robot{width:48px;height:48px;display:grid;place-items:center;border-radius:15px;color:#ffdf72;background:linear-gradient(145deg,rgba(255,219,105,.18),rgba(81,111,255,.16));box-shadow:0 0 30px rgba(255,210,90,.09)}.smart-title h2{margin:5px 0 4px}.smart-title p{margin:0;color:var(--muted);font-size:12px;line-height:1.55}.smart-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.smart-actions .select{min-width:250px}.coverage{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;margin-top:16px;padding:13px 15px;border-radius:14px}.coverage.ready{border:1px solid rgba(79,222,151,.28);background:rgba(79,222,151,.07);color:#70e6a8}.coverage.warning{border:1px solid rgba(255,179,87,.3);background:rgba(255,179,87,.07);color:#ffc274}.coverage b,.coverage span{display:block}.coverage span{margin-top:3px;color:var(--muted);font-size:11px}.coverage-count{text-align:right}.coverage-count strong,.coverage-count small{display:block}.coverage-count strong{font-size:19px}.coverage-count small{font-size:9px;text-transform:uppercase;letter-spacing:.08em}.award-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin-top:14px}.award-card{position:relative;overflow:hidden;padding:14px;border:1px solid var(--line);border-radius:15px;background:rgba(7,17,37,.55)}.award-card:before{content:"";position:absolute;inset:-1px;pointer-events:none;background:linear-gradient(135deg,rgba(255,220,100,.08),transparent 40%)}.award-card.empty{opacity:.72}.award-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;color:#ffe27b;background:rgba(255,220,100,.09)}.award-name{margin:10px 0}.award-name small{color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.09em}.award-name h3{margin:3px 0 0;font-size:15px}.winner{display:flex;align-items:center;gap:9px}.winner b,.winner span{display:block}.winner span{margin-top:3px;color:var(--muted);font-size:10px}.metric{min-height:34px;margin:10px 0;color:#dbe6ff;font-size:11px;line-height:1.45}.points{display:flex;align-items:center;gap:5px;color:#ffdf77;font-size:11px;font-weight:900}.existing{display:block;margin-top:7px;color:#70e6a8;font-size:9px}.no-winner{min-height:86px;color:var(--muted);font-size:11px;line-height:1.5}.award-card details{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}.award-card summary{cursor:pointer;color:var(--muted);font-size:9px}.award-card details p{margin:7px 0 0;color:var(--muted);font-size:9px;line-height:1.45}@media(max-width:1200px){.award-grid{grid-template-columns:repeat(2,1fr)}.smart-head{display:block}.smart-actions{justify-content:flex-start;margin-top:14px}}@media(max-width:680px){.award-grid{grid-template-columns:1fr}.smart-actions>*{width:100%}.smart-actions .select{min-width:0}.coverage{grid-template-columns:auto 1fr}.coverage-count{grid-column:2;text-align:left}}
</style>
