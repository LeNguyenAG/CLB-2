<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  Radar, ShieldCheck, TriangleAlert, CircleX, CheckCircle2, Settings2,
  Building2, Users, Trophy, Gauge, KeyRound, ArrowRight, Wrench,
  RefreshCw, Save, Trash2, BadgeCheck, CircleDollarSign, Sparkles,
  LockKeyhole, RadioTower, Zap, Stethoscope, MonitorUp
} from '@lucide/vue'
import { api } from '../services/api'
import { uiStore } from '../stores/ui'
import { money, number, date } from '../utils'

const props = defineProps({
  clubId: { type: [String, Number], required: true },
  matches: { type: Array, default: () => [] },
  isAdmin: { type: Boolean, default: false }
})
const emit = defineEmits(['updated', 'select-upgrade'])

const loading = ref(false)
const busy = ref(false)
const profiles = ref([])
const venueData = ref(null)
const requirements = ref([])
const selectedMatchId = ref('')
const selectedStadiumId = ref('')
const overrideReason = ref('')
const showStandards = ref(false)
const requirementForm = ref({
  competition_id: '', stage_type: 'ANY', round_id: '', profile_id: '',
  enforcement_mode: 'BLOCK', allow_conditional: true, note: ''
})

const availableMatches = computed(() => (props.matches || []).filter((match) => match.status !== 'CANCELLED'))
const selectedMatch = computed(() => availableMatches.value.find((match) => Number(match.match_id) === Number(selectedMatchId.value)) || null)
const selectedVenue = computed(() => venueData.value?.options?.find((stadium) => Number(stadium.id) === Number(selectedStadiumId.value)) || null)
const accessibleOptions = computed(() => venueData.value?.options?.filter((stadium) => stadium.has_access) || [])
const alternativeOptions = computed(() => venueData.value?.options?.filter((stadium) => !stadium.has_access) || [])
const competitionMatches = computed(() => availableMatches.value.filter((match) => Number(match.competition_id) === Number(requirementForm.value.competition_id)))
const roundOptions = computed(() => {
  const seen = new Set()
  return competitionMatches.value.filter((match) => match.round_id && !seen.has(Number(match.round_id)) && seen.add(Number(match.round_id)))
})
const competitionOptions = computed(() => {
  const map = new Map()
  for (const match of availableMatches.value) {
    if (!map.has(Number(match.competition_id))) map.set(Number(match.competition_id), { id: match.competition_id, name: match.competition_name })
  }
  return [...map.values()]
})
const currentRequirement = computed(() => venueData.value?.requirement || null)
const assignedVenue = computed(() => {
  const id = venueData.value?.assignment?.stadium_id
  return id ? venueData.value?.options?.find((stadium) => Number(stadium.id) === Number(id)) : null
})
const complianceCounts = computed(() => {
  const options = venueData.value?.options || []
  return {
    eligible: options.filter((item) => item.evaluation.eligibility_status === 'ELIGIBLE').length,
    conditional: options.filter((item) => item.evaluation.eligibility_status === 'CONDITIONAL').length,
    blocked: options.filter((item) => item.evaluation.eligibility_status === 'NOT_ELIGIBLE').length
  }
})

onMounted(async () => {
  await loadProfiles()
  chooseDefaultMatch()
})

watch(() => [props.clubId, props.matches?.length], () => chooseDefaultMatch())
watch(selectedMatchId, async () => {
  overrideReason.value = ''
  await loadOptions()
  if (selectedMatch.value?.competition_id) {
    requirementForm.value.competition_id = selectedMatch.value.competition_id
    await loadRequirements()
  }
})
watch(() => requirementForm.value.competition_id, () => loadRequirements())

function chooseDefaultMatch() {
  if (!availableMatches.value.length) {
    selectedMatchId.value = ''
    venueData.value = null
    return
  }
  if (!availableMatches.value.some((match) => Number(match.match_id) === Number(selectedMatchId.value))) {
    const preferred = availableMatches.value.find((match) => !match.assigned_stadium_id) || availableMatches.value[0]
    selectedMatchId.value = preferred.match_id
  } else {
    loadOptions()
  }
}

async function loadProfiles() {
  try {
    const response = await api.get('/stadium-compliance/profiles')
    profiles.value = response.data || []
    if (!requirementForm.value.profile_id && profiles.value.length) requirementForm.value.profile_id = profiles.value[0].id
  } catch (error) {
    uiStore.notify(error.message, 'error')
  }
}

async function loadRequirements() {
  const competitionId = requirementForm.value.competition_id
  if (!competitionId) return
  try {
    const response = await api.get('/stadium-compliance/requirements', { competition_id: competitionId })
    requirements.value = response.data || []
  } catch (error) {
    uiStore.notify(error.message, 'error')
  }
}

async function loadOptions() {
  if (!selectedMatchId.value || !props.clubId) return
  if (!venueData.value) loading.value = true
  try {
    const response = await api.get(`/stadium-compliance/matches/${selectedMatchId.value}/options`, { club_id: props.clubId })
    venueData.value = response.data
    const assignmentId = response.data?.assignment?.stadium_id
    const recommendedId = response.data?.best_accessible?.id || response.data?.best_alternative?.id
    selectedStadiumId.value = assignmentId || recommendedId || response.data?.options?.[0]?.id || ''
  } catch (error) {
    venueData.value = null
    uiStore.notify(error.message, 'error')
  } finally {
    loading.value = false
  }
}

async function assignVenue() {
  const venue = selectedVenue.value
  if (!venue) return
  if (venue.requires_lease) {
    await quickLease(venue)
    return
  }
  const needsOverride = venue.evaluation.eligibility_status === 'NOT_ELIGIBLE'
    || (venue.evaluation.eligibility_status === 'CONDITIONAL'
      && !currentRequirement.value?.allow_conditional
      && currentRequirement.value?.enforcement_mode === 'BLOCK')
  if (needsOverride && !props.isAdmin) {
    uiStore.notify('Sân chưa đạt chuẩn bắt buộc. Hãy chọn sân khác hoặc nâng cấp sân.', 'error')
    return
  }
  if (needsOverride && !overrideReason.value.trim()) {
    uiStore.notify('FIFA Admin phải nhập lý do cấp ngoại lệ.', 'error')
    return
  }
  busy.value = true
  try {
    await api.post(`/stadium-compliance/matches/${selectedMatchId.value}/assign`, {
      club_id: props.clubId,
      stadium_id: venue.id,
      override_reason: needsOverride ? overrideReason.value.trim() : null
    })
    uiStore.notify(needsOverride ? 'Đã cấp ngoại lệ và lưu sân tổ chức.' : 'Đã xác nhận sân đạt chuẩn cho trận đấu.')
    await loadOptions()
    emit('updated')
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}

async function quickLease(venue) {
  busy.value = true
  try {
    const response = await api.post(`/stadium-compliance/stadiums/${venue.id}/quick-lease`, { club_id: props.clubId })
    uiStore.notify(`Đã thiết lập quyền thuê sân với phí dự kiến ${money(response.data.lease_fee_per_match)} mỗi trận.`)
    await loadOptions()
    selectedStadiumId.value = venue.id
    emit('updated')
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}

async function saveRequirement() {
  busy.value = true
  try {
    await api.post('/stadium-compliance/requirements', {
      ...requirementForm.value,
      round_id: requirementForm.value.round_id || null
    })
    uiStore.notify('Đã áp dụng tiêu chuẩn sân cho giải/vòng đấu.')
    await Promise.all([loadRequirements(), loadOptions()])
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}

async function removeRequirement(requirement) {
  busy.value = true
  try {
    await api.delete(`/stadium-compliance/requirements/${requirement.id}`)
    uiStore.notify('Đã tắt quy định sân tùy chỉnh; hệ thống sẽ dùng chuẩn tự động.')
    await Promise.all([loadRequirements(), loadOptions()])
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}

function statusMeta(status) {
  return {
    ELIGIBLE: { text: 'Đạt chuẩn', className: 'eligible', icon: CheckCircle2 },
    CONDITIONAL: { text: 'Đạt có điều kiện', className: 'conditional', icon: TriangleAlert },
    NOT_ELIGIBLE: { text: 'Không đạt', className: 'blocked', icon: CircleX },
    OVERRIDDEN: { text: 'FIFA cấp ngoại lệ', className: 'override', icon: LockKeyhole }
  }[status] || { text: status, className: 'conditional', icon: TriangleAlert }
}

function capabilityList(stadium) {
  return [
    ['has_var', 'VAR', RadioTower],
    ['has_goal_line_technology', 'Goal-line', BadgeCheck],
    ['has_led_perimeter', 'LED 360°', MonitorUp],
    ['has_backup_power', 'Điện dự phòng', Zap],
    ['has_media_center', 'Media Center', RadioTower],
    ['has_medical_center', 'Y tế', Stethoscope]
  ].map(([key, label, icon]) => ({ key, label, icon, active: Boolean(stadium[key]) }))
}

function formatRequired(failure) {
  if (typeof failure.required === 'boolean') return failure.required ? 'Bắt buộc' : 'Không bắt buộc'
  return number(failure.required, failure.field === 'rating_score' ? 1 : 0)
}

function profileClass(profile) {
  return profile?.code === 'WORLD_FINAL' || profile?.code === 'WORLD_CUP_ELITE'
    ? 'world'
    : profile?.min_level_no >= 4 ? 'elite' : profile?.min_level_no >= 3 ? 'continental' : 'base'
}
</script>

<template>
  <section class="compliance-shell">
    <div class="compliance-hero glass">
      <div class="radar-visual" aria-hidden="true">
        <div class="radar-grid" />
        <div class="radar-sweep" />
        <div class="radar-core"><ShieldCheck :size="31" /></div>
        <i v-for="index in 6" :key="index" :style="{ '--i': index }" />
      </div>
      <div class="hero-copy">
        <span class="eyebrow"><Radar :size="14" /> VENUE INTELLIGENCE 2.0.10</span>
        <h2>Kiểm định sân theo từng trận</h2>
        <p>Cấp sân thể hiện chất lượng tổng thể; trung tâm này kiểm tra riêng sức chứa, VAR, ánh sáng, an ninh, truyền thông và tiêu chuẩn của từng vòng đấu.</p>
        <div class="hero-pills">
          <span><CheckCircle2 /> {{ complianceCounts.eligible }} đạt chuẩn</span>
          <span><TriangleAlert /> {{ complianceCounts.conditional }} có điều kiện</span>
          <span><CircleX /> {{ complianceCounts.blocked }} không đạt</span>
        </div>
      </div>
      <button class="btn" :disabled="loading" @click="loadOptions"><RefreshCw :size="16" /> Quét lại</button>
    </div>

    <div v-if="!availableMatches.length" class="glass empty-compliance">
      <Building2 :size="42" />
      <h3>Chưa có trận sân nhà để kiểm định</h3>
      <p>Khi lịch thi đấu được tạo, hệ thống sẽ tự xác định tiêu chuẩn sân cho từng trận.</p>
    </div>

    <template v-else>
      <div class="control-strip glass">
        <label>
          <span>Trận cần kiểm định</span>
          <select v-model="selectedMatchId" class="select">
            <option v-for="match in availableMatches" :key="match.match_id" :value="match.match_id">
              {{ match.home_club_name }} vs {{ match.away_club_name || 'Chờ đối thủ' }} · {{ match.competition_name }}
            </option>
          </select>
        </label>
        <div v-if="selectedMatch" class="match-snapshot">
          <Trophy />
          <div><b>{{ selectedMatch.competition_name }}</b><span>{{ selectedMatch.stage_type === 'KNOCKOUT' ? 'Loại trực tiếp' : 'Vòng bảng' }} · {{ date(selectedMatch.scheduled_at, true) }}</span></div>
        </div>
        <button v-if="isAdmin" class="btn" @click="showStandards = !showStandards"><Settings2 :size="16" /> Thiết lập chuẩn</button>
      </div>

      <div v-if="showStandards && isAdmin" class="standard-studio glass">
        <div class="studio-head">
          <div><span class="eyebrow">FIFA STANDARD STUDIO</span><h3>Quy định chuẩn theo giải và vòng</h3></div>
          <ShieldCheck :size="30" />
        </div>
        <div class="standard-form">
          <label><span>Giải đấu</span><select v-model="requirementForm.competition_id" class="select"><option v-for="competition in competitionOptions" :key="competition.id" :value="competition.id">{{ competition.name }}</option></select></label>
          <label><span>Phạm vi</span><select v-model="requirementForm.stage_type" class="select"><option value="ANY">Toàn giải</option><option value="GROUP">Vòng bảng</option><option value="KNOCKOUT">Loại trực tiếp</option></select></label>
          <label><span>Vòng cụ thể</span><select v-model="requirementForm.round_id" class="select"><option value="">Không chỉ định</option><option v-for="round in roundOptions" :key="round.round_id" :value="round.round_id">{{ round.round_name || `Vòng ${round.round_id}` }}</option></select></label>
          <label><span>Bộ tiêu chuẩn</span><select v-model="requirementForm.profile_id" class="select"><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ number(profile.min_capacity, 0) }} ghế</option></select></label>
          <label><span>Cơ chế</span><select v-model="requirementForm.enforcement_mode" class="select"><option value="BLOCK">Khóa sân không đạt</option><option value="WARN">Chỉ cảnh báo</option></select></label>
          <label class="switch-row"><input v-model="requirementForm.allow_conditional" type="checkbox" /><span>Cho phép sân đạt có điều kiện</span></label>
          <label class="full"><span>Ghi chú</span><input v-model="requirementForm.note" class="input" placeholder="Ví dụ: Chung kết bắt buộc chuẩn World Class" /></label>
          <button class="btn btn-primary save-standard" :disabled="busy" @click="saveRequirement"><Save :size="16" /> Lưu tiêu chuẩn</button>
        </div>
        <div v-if="requirements.length" class="requirement-list">
          <article v-for="requirement in requirements" :key="requirement.id">
            <ShieldCheck />
            <div><b>{{ requirement.profile_name }}</b><span>{{ requirement.round_name || (requirement.stage_type === 'ANY' ? 'Toàn giải' : requirement.stage_type) }} · {{ requirement.enforcement_mode }}</span></div>
            <button class="icon-btn" title="Tắt quy định" @click="removeRequirement(requirement)"><Trash2 :size="16" /></button>
          </article>
        </div>
      </div>

      <div v-if="loading" class="scan-loading glass"><Radar :size="30" /><b>Đang quét toàn bộ sân phù hợp…</b><span /></div>

      <template v-else-if="venueData">
        <div class="requirement-banner glass" :class="profileClass(currentRequirement)">
          <div class="requirement-orbit"><Gauge /><i /><i /><i /></div>
          <div>
            <span class="eyebrow">{{ currentRequirement.source === 'CUSTOM' ? 'TIÊU CHUẨN FIFA ĐÃ CẤU HÌNH' : 'TIÊU CHUẨN HỆ THỐNG ĐỀ XUẤT' }}</span>
            <h3>{{ currentRequirement.name }}</h3>
            <p>{{ currentRequirement.description }}</p>
          </div>
          <div class="requirement-kpis">
            <span><Users /> ≥ {{ number(currentRequirement.min_capacity, 0) }}</span>
            <span><Gauge /> Rating ≥ {{ number(currentRequirement.min_rating_score, 0) }}</span>
            <span><ShieldCheck /> Cấp {{ currentRequirement.min_level_no }}</span>
          </div>
        </div>

        <div v-if="assignedVenue" class="assigned-callout glass" :class="statusMeta(venueData.assignment.eligibility_status).className">
          <component :is="statusMeta(venueData.assignment.eligibility_status).icon" />
          <div><span>Sân đã xác nhận</span><b>{{ assignedVenue.name }}</b><small>{{ statusMeta(venueData.assignment.eligibility_status).text }} · {{ number(venueData.assignment.compliance_score, 0) }}/100</small></div>
          <Sparkles class="assigned-spark" />
        </div>

        <div class="venue-layout">
          <div class="venue-column">
            <div class="section-heading"><div><h3>Sân CLB có thể sử dụng</h3><p>Được xếp theo mức đạt chuẩn và lợi nhuận dự kiến.</p></div><span>{{ accessibleOptions.length }}</span></div>
            <div class="venue-grid">
              <article
                v-for="venue in accessibleOptions"
                :key="venue.id"
                class="venue-card glass"
                :class="[statusMeta(venue.evaluation.eligibility_status).className, { selected: Number(selectedStadiumId) === Number(venue.id) }]"
                @click="selectedStadiumId = venue.id"
              >
                <div class="venue-scan"><span /><i /></div>
                <div class="venue-top">
                  <span class="status-chip" :class="statusMeta(venue.evaluation.eligibility_status).className"><component :is="statusMeta(venue.evaluation.eligibility_status).icon" />{{ statusMeta(venue.evaluation.eligibility_status).text }}</span>
                  <b class="score">{{ number(venue.evaluation.compliance_score, 0) }}</b>
                </div>
                <h3>{{ venue.name }}</h3>
                <p>{{ venue.is_primary ? 'Sân nhà chính' : venue.relationship_type }} · {{ number(venue.capacity_total, 0) }} ghế</p>
                <div class="capabilities"><span v-for="capability in capabilityList(venue)" :key="capability.key" :class="{ active: capability.active }"><component :is="capability.icon" />{{ capability.label }}</span></div>
                <div class="economy"><span><Users /> {{ number(venue.projected_economy.attendance, 0) }} dự kiến</span><b><CircleDollarSign /> {{ money(venue.projected_economy.estimated_net_revenue, true) }}</b></div>
                <div v-if="venue.evaluation.failures.length" class="failure-list">
                  <div v-for="failure in venue.evaluation.failures.slice(0, 4)" :key="failure.field" :class="failure.severity.toLowerCase()"><span>{{ failure.label }}</span><b>{{ failure.actual === false ? 'Thiếu' : number(failure.actual, 0) }} / {{ formatRequired(failure) }}</b></div>
                </div>
                <button v-if="venue.evaluation.failures.length" class="upgrade-link" @click.stop="emit('select-upgrade', venue)"><Wrench /> Nâng cấp để đạt chuẩn <ArrowRight /></button>
              </article>
            </div>
          </div>

          <aside class="decision-panel glass">
            <div v-if="selectedVenue">
              <span class="eyebrow">VENUE DECISION</span>
              <div class="decision-score" :class="statusMeta(selectedVenue.evaluation.eligibility_status).className" :style="{ '--score': selectedVenue.evaluation.compliance_score }">
                <component :is="statusMeta(selectedVenue.evaluation.eligibility_status).icon" />
                <b>{{ number(selectedVenue.evaluation.compliance_score, 0) }}</b>
                <span>{{ statusMeta(selectedVenue.evaluation.eligibility_status).text }}</span>
              </div>
              <h3>{{ selectedVenue.name }}</h3>
              <p>{{ selectedVenue.evaluation.hard_fail_count }} tiêu chí bắt buộc thiếu · {{ selectedVenue.evaluation.soft_fail_count }} tiêu chí phụ thiếu</p>
              <div class="decision-money"><span>Lợi nhuận dự kiến</span><b>{{ money(selectedVenue.projected_economy.estimated_net_revenue) }}</b><small>Lấp đầy khoảng {{ number(selectedVenue.projected_economy.occupancy_pct, 1) }}%</small></div>
              <label v-if="isAdmin && selectedVenue.evaluation.eligibility_status === 'NOT_ELIGIBLE'" class="override-box"><span>Lý do cấp ngoại lệ bắt buộc</span><textarea v-model="overrideReason" class="input" rows="3" placeholder="Ghi rõ lý do và điều kiện bảo đảm an toàn…" /></label>
              <button class="btn btn-primary decision-button" :disabled="busy" @click="assignVenue"><ShieldCheck /> {{ selectedVenue.requires_lease ? 'Thuê sân trước' : selectedVenue.evaluation.eligibility_status === 'NOT_ELIGIBLE' ? 'Cấp ngoại lệ & chọn sân' : 'Xác nhận sân tổ chức' }}</button>
            </div>
          </aside>
        </div>

        <section v-if="alternativeOptions.length" class="alternative-section">
          <div class="section-heading"><div><h3>Sân thay thế đạt chuẩn</h3><p>Thuê nhanh khi sân nhà không đủ tiêu chuẩn hoặc cần sức chứa lớn hơn.</p></div><KeyRound /></div>
          <div class="alternative-grid">
            <article v-for="venue in alternativeOptions.slice(0, 4)" :key="venue.id" class="alternative-card glass" :class="statusMeta(venue.evaluation.eligibility_status).className">
              <div><span>{{ venue.owner_club_name || 'Sân trung lập' }}</span><h3>{{ venue.name }}</h3><p>{{ number(venue.capacity_total, 0) }} ghế · {{ number(venue.rating_score, 0) }}/100</p></div>
              <div class="alternative-score"><b>{{ number(venue.evaluation.compliance_score, 0) }}</b><small>{{ statusMeta(venue.evaluation.eligibility_status).text }}</small></div>
              <button class="btn btn-sm" :disabled="busy || venue.evaluation.eligibility_status === 'NOT_ELIGIBLE'" @click="quickLease(venue)"><KeyRound /> Thuê nhanh</button>
            </article>
          </div>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.compliance-shell{display:grid;gap:18px}.compliance-hero{min-height:230px;padding:26px;display:grid;grid-template-columns:190px 1fr auto;align-items:center;gap:25px;position:relative;overflow:hidden}.compliance-hero::after{content:'';position:absolute;inset:auto -15% -75% 20%;height:230px;background:radial-gradient(ellipse,rgba(57,130,255,.18),transparent 70%);pointer-events:none}.radar-visual{width:170px;height:170px;border-radius:50%;position:relative;display:grid;place-items:center;background:radial-gradient(circle,rgba(57,130,255,.16),rgba(6,15,32,.3) 64%,transparent 65%);border:1px solid rgba(79,164,255,.32);box-shadow:inset 0 0 40px rgba(57,130,255,.12),0 0 38px rgba(57,130,255,.08)}.radar-grid{position:absolute;inset:12px;border-radius:50%;background:repeating-radial-gradient(circle,transparent 0 22px,rgba(81,170,255,.13) 23px 24px),linear-gradient(90deg,transparent 49.5%,rgba(81,170,255,.18) 50%,transparent 50.5%),linear-gradient(transparent 49.5%,rgba(81,170,255,.18) 50%,transparent 50.5%)}.radar-sweep{position:absolute;inset:12px;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 77%,rgba(57,207,255,.32) 90%,transparent 100%);animation:radar-spin 3.6s linear infinite}.radar-core{position:relative;z-index:2;width:66px;height:66px;border-radius:50%;display:grid;place-items:center;color:var(--cyan);background:rgba(8,20,42,.88);border:1px solid rgba(41,216,255,.45);box-shadow:0 0 24px rgba(41,216,255,.24)}.radar-visual>i{--angle:calc(var(--i)*57deg);position:absolute;width:6px;height:6px;border-radius:50%;background:var(--cyan);left:calc(50% + cos(var(--angle))*58px);top:calc(50% + sin(var(--angle))*58px);box-shadow:0 0 10px var(--cyan);animation:radar-dot 2s ease-in-out infinite;animation-delay:calc(var(--i)*-.23s)}.hero-copy{position:relative;z-index:1}.hero-copy h2{font-size:clamp(27px,3vw,45px);margin:8px 0}.hero-copy p{max-width:760px}.hero-pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:17px}.hero-pills span{display:flex;align-items:center;gap:5px;padding:7px 10px;border-radius:999px;background:rgba(255,255,255,.045);font-size:11px;color:var(--muted);border:1px solid var(--line)}.hero-pills svg{width:14px}.empty-compliance{padding:60px;text-align:center;display:grid;place-items:center;gap:10px;color:var(--muted)}.control-strip{padding:14px;display:grid;grid-template-columns:minmax(300px,1fr) 1fr auto;gap:14px;align-items:end}.control-strip label>span,.standard-form label>span,.override-box>span{display:block;font-size:11px;color:var(--muted);margin-bottom:6px}.match-snapshot{min-height:44px;display:flex;align-items:center;gap:10px;padding:8px 12px;border-left:1px solid var(--line)}.match-snapshot>svg{color:var(--yellow)}.match-snapshot b,.match-snapshot span{display:block}.match-snapshot span{font-size:11px;color:var(--muted);margin-top:3px}.standard-studio{padding:21px;position:relative;overflow:hidden}.standard-studio::before{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent,rgba(57,130,255,.05),transparent);animation:studio-shimmer 5s linear infinite;pointer-events:none}.studio-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:17px}.studio-head h3{margin:6px 0}.studio-head>svg{color:var(--cyan)}.standard-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;position:relative}.standard-form .full{grid-column:1/-1}.switch-row{display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px solid var(--line);border-radius:12px}.switch-row span{margin:0!important}.save-standard{align-self:end}.requirement-list{display:grid;gap:8px;margin-top:16px;padding-top:15px;border-top:1px solid var(--line)}.requirement-list article{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:9px;border-radius:11px;background:rgba(255,255,255,.035)}.requirement-list svg{color:var(--cyan)}.requirement-list b,.requirement-list span{display:block}.requirement-list span{font-size:11px;color:var(--muted);margin-top:3px}.scan-loading{padding:45px;display:grid;place-items:center;gap:12px;color:var(--cyan);position:relative;overflow:hidden}.scan-loading>span{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scan-y 1.8s ease-in-out infinite}.requirement-banner{padding:19px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:17px;position:relative;overflow:hidden;border-left:4px solid var(--primary)}.requirement-banner.elite{border-left-color:var(--yellow)}.requirement-banner.world{border-left-color:var(--cyan);background:linear-gradient(135deg,rgba(41,216,255,.08),rgba(109,92,255,.07))}.requirement-banner h3{font-size:22px;margin:6px 0}.requirement-banner p{font-size:12px}.requirement-orbit{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;position:relative;background:rgba(57,130,255,.12);color:var(--cyan)}.requirement-orbit i{position:absolute;inset:5px;border-radius:50%;border:1px solid rgba(41,216,255,.25);animation:orbit-pulse 2.4s ease-in-out infinite}.requirement-orbit i:nth-child(3){inset:-4px;animation-delay:-.8s}.requirement-orbit i:nth-child(4){inset:-13px;animation-delay:-1.6s}.requirement-kpis{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.requirement-kpis span{display:flex;align-items:center;gap:5px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);font-size:11px}.requirement-kpis svg{width:14px}.assigned-callout{padding:15px 18px;display:flex;align-items:center;gap:12px;position:relative;overflow:hidden}.assigned-callout>svg{width:28px;height:28px}.assigned-callout div span,.assigned-callout div b,.assigned-callout div small{display:block}.assigned-callout div span{font-size:10px;color:var(--muted);text-transform:uppercase}.assigned-callout div b{margin:3px 0}.assigned-callout div small{color:var(--muted)}.assigned-callout.eligible{border-color:rgba(36,214,135,.35)}.assigned-callout.conditional{border-color:rgba(255,192,74,.38)}.assigned-callout.override{border-color:rgba(173,119,255,.4)}.assigned-spark{margin-left:auto;color:var(--yellow);animation:spark-pop 1.7s ease-in-out infinite}.venue-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:17px;align-items:start}.section-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.section-heading h3{margin-bottom:4px}.section-heading p{font-size:12px}.section-heading>span{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--primary);color:white;font-weight:800}.venue-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.venue-card{padding:17px;position:relative;overflow:hidden;cursor:pointer;transition:transform .25s ease,border-color .25s ease,box-shadow .25s ease}.venue-card:hover{transform:translateY(-3px)}.venue-card.selected{border-color:var(--primary);box-shadow:inset 0 0 0 1px var(--primary),0 12px 28px rgba(0,0,0,.12)}.venue-card.eligible{--status:var(--green)}.venue-card.conditional{--status:var(--yellow)}.venue-card.blocked{--status:var(--red)}.venue-scan{position:absolute;inset:0;pointer-events:none;opacity:.35}.venue-scan span{position:absolute;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--status),transparent);animation:venue-scan 4s ease-in-out infinite}.venue-scan i{position:absolute;inset:0;background:radial-gradient(circle at 90% 0,color-mix(in srgb,var(--status) 13%,transparent),transparent 38%)}.venue-top{display:flex;justify-content:space-between;align-items:center;position:relative}.status-chip{display:flex;align-items:center;gap:5px;padding:5px 8px;border-radius:999px;font-size:10px;background:color-mix(in srgb,var(--status) 13%,transparent);color:var(--status);border:1px solid color-mix(in srgb,var(--status) 28%,transparent)}.status-chip svg{width:13px}.score{font:800 23px Manrope;color:var(--status)}.venue-card h3{font-size:20px;margin:13px 0 4px;position:relative}.venue-card>p{font-size:11px;position:relative}.capabilities{display:flex;gap:5px;flex-wrap:wrap;margin:13px 0}.capabilities span{display:flex;align-items:center;gap:3px;padding:4px 6px;border-radius:7px;font-size:9px;color:var(--muted);background:rgba(255,255,255,.035);opacity:.48}.capabilities span.active{color:var(--cyan);opacity:1;background:rgba(41,216,255,.08)}.capabilities svg{width:11px}.economy{display:flex;justify-content:space-between;gap:8px;padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:10px}.economy span,.economy b{display:flex;align-items:center;gap:4px}.economy b{color:var(--green)}.economy svg{width:12px}.failure-list{display:grid;gap:5px;margin-top:10px}.failure-list div{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:7px;font-size:9px;background:rgba(255,255,255,.035)}.failure-list div.hard{border-left:2px solid var(--red)}.failure-list div.soft{border-left:2px solid var(--yellow)}.failure-list b{font-weight:700}.upgrade-link{width:100%;border:0;background:transparent;color:var(--cyan);display:flex;align-items:center;justify-content:center;gap:5px;margin-top:11px;font-size:11px}.upgrade-link svg{width:13px}.decision-panel{padding:20px;position:sticky;top:88px;overflow:hidden}.decision-panel::before{content:'';position:absolute;width:170px;height:170px;border-radius:50%;right:-75px;top:-85px;background:radial-gradient(circle,rgba(57,130,255,.18),transparent 70%)}.decision-score{width:120px;height:120px;border-radius:50%;margin:18px auto;display:grid;place-items:center;align-content:center;gap:2px;background:radial-gradient(circle,var(--panel-solid) 54%,transparent 56%),conic-gradient(var(--status) calc(var(--score,75)*1%),rgba(255,255,255,.06) 0);border:1px solid color-mix(in srgb,var(--status) 30%,transparent);position:relative}.decision-score.eligible{--status:var(--green)}.decision-score.conditional{--status:var(--yellow)}.decision-score.blocked{--status:var(--red)}.decision-score.override{--status:#ad77ff}.decision-score svg{width:18px;color:var(--status)}.decision-score b{font:800 30px Manrope}.decision-score span{font-size:9px;color:var(--muted);text-align:center}.decision-panel h3{text-align:center}.decision-panel>div>p{text-align:center;font-size:11px}.decision-money{margin:18px 0;padding:14px;border-radius:13px;background:rgba(255,255,255,.04)}.decision-money span,.decision-money b,.decision-money small{display:block}.decision-money span,.decision-money small{font-size:10px;color:var(--muted)}.decision-money b{font:800 21px Manrope;color:var(--green);margin:5px 0}.override-box{display:block;margin-bottom:12px}.override-box textarea{resize:vertical}.decision-button{width:100%;justify-content:center}.alternative-section{margin-top:6px}.alternative-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}.alternative-card{padding:15px;display:grid;gap:11px;border-top:2px solid var(--status)}.alternative-card.eligible{--status:var(--green)}.alternative-card.conditional{--status:var(--yellow)}.alternative-card.blocked{--status:var(--red)}.alternative-card>div:first-child span{font-size:9px;color:var(--muted);text-transform:uppercase}.alternative-card h3{font-size:16px;margin:5px 0}.alternative-card p{font-size:10px}.alternative-score{display:flex;align-items:end;gap:7px}.alternative-score b{font:800 24px Manrope;color:var(--status)}.alternative-score small{font-size:9px;color:var(--muted);padding-bottom:4px}.alternative-card .btn{justify-content:center}
@keyframes radar-spin{to{transform:rotate(360deg)}}@keyframes radar-dot{0%,100%{opacity:.25;transform:scale(.6)}50%{opacity:1;transform:scale(1.3)}}@keyframes studio-shimmer{from{transform:translateX(-70%)}to{transform:translateX(70%)}}@keyframes scan-y{0%,100%{top:10%}50%{top:90%}}@keyframes orbit-pulse{0%,100%{transform:scale(.85);opacity:.2}50%{transform:scale(1.05);opacity:.65}}@keyframes spark-pop{0%,100%{transform:scale(.85) rotate(-8deg);opacity:.55}50%{transform:scale(1.15) rotate(8deg);opacity:1}}@keyframes venue-scan{0%,100%{top:0}50%{top:100%}}
@media(max-width:1100px){.compliance-hero{grid-template-columns:150px 1fr}.compliance-hero>.btn{grid-column:1/-1;justify-self:end}.radar-visual{width:140px;height:140px}.control-strip{grid-template-columns:1fr 1fr}.control-strip>.btn{grid-column:1/-1;justify-self:end}.venue-layout{grid-template-columns:1fr}.decision-panel{position:static}.alternative-grid{grid-template-columns:1fr 1fr}.standard-form{grid-template-columns:1fr 1fr}}
@media(max-width:700px){.compliance-hero{grid-template-columns:1fr;text-align:center}.radar-visual{margin:auto}.hero-pills{justify-content:center}.control-strip,.standard-form{grid-template-columns:1fr}.match-snapshot{border-left:0;border-top:1px solid var(--line)}.requirement-banner{grid-template-columns:1fr;text-align:center}.requirement-orbit{margin:auto}.requirement-kpis{justify-content:center}.venue-grid,.alternative-grid{grid-template-columns:1fr}.standard-form .full{grid-column:auto}.decision-panel{padding:16px}}
</style>
