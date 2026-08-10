<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Plus, ArrowLeftRight, Check, X, CircleCheckBig, ShieldCheck, Gem } from '@lucide/vue'
import { api } from '../../services/api'
import { authStore } from '../../stores/auth'
import { uiStore } from '../../stores/ui'
import { money, date } from '../../utils'
import PageHeader from '../../components/PageHeader.vue'
import LoadingBlock from '../../components/LoadingBlock.vue'
import EmptyState from '../../components/EmptyState.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import BaseModal from '../../components/BaseModal.vue'
import PaginationBar from '../../components/PaginationBar.vue'

const isAdmin = computed(() => authStore.isAdmin.value)
const tab = ref('offers')
const loading = ref(true)
const rows = ref([])
const meta = ref({ page: 1, limit: 20, total: 0 })
const status = ref('')
const modal = ref(false)
const busy = ref(false)
const players = ref([])
const clubs = ref([])
const seasons = ref([])
const form = ref({})
const selectedPlayer = computed(() => players.value.find((player) => Number(player.id) === Number(form.value.player_id)) || null)
const marketFloor = computed(() => Number(selectedPlayer.value?.market_value || 0))

function blankForm() {
  return {
    player_id: '', buyer_club_id: isAdmin.value ? '' : authStore.user.value.clubId,
    transfer_type: 'PAID', transfer_fee: '0', new_salary_per_season: '0',
    contract_start_season_id: '', contract_end_season_id: '', note: ''
  }
}

async function load(page = 1) {
  try {
    const path = tab.value === 'offers' ? '/transfer-offers' : '/transfers/history'
    const result = await api.get(path, { page, limit: 20, status: tab.value === 'offers' ? status.value : '' })
    rows.value = result.data
    meta.value = result.meta
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { loading.value = false }
}

watch([tab, status], () => load(1))
watch(() => form.value.player_id, () => {
  const player = selectedPlayer.value
  if (!player) return
  form.value.transfer_type = player.club_id ? 'PAID' : 'FREE'
  form.value.transfer_fee = player.club_id ? String(player.market_value || 0) : '0'
  form.value.new_salary_per_season = String(Math.max(Number(player.salary_per_season || 0), marketFloor.value))
})
watch(() => form.value.transfer_type, (type) => {
  if (type === 'FREE') form.value.transfer_fee = '0'
  else if (selectedPlayer.value && Number(form.value.transfer_fee || 0) < marketFloor.value) form.value.transfer_fee = String(marketFloor.value)
})

onMounted(async () => {
  try {
    const [playerResult, clubResult, seasonResult] = await Promise.all([
      api.get('/players', { limit: 100, sort: 'VALUE_DESC' }),
      isAdmin.value ? api.get('/clubs', { limit: 100, status: 'APPROVED' }) : api.get('/public/clubs', { limit: 100 }, { auth: false }),
      api.get('/seasons')
    ])
    players.value = playerResult.data
    clubs.value = clubResult.data
    seasons.value = seasonResult.data
  } catch { /* Form sẽ báo rõ nếu danh mục chưa tải được. */ }
  load()
})

function openCreate() { form.value = blankForm(); modal.value = true }
async function create() {
  busy.value = true
  try {
    await api.post('/transfer-offers', form.value)
    uiStore.notify('Đã gửi đề nghị chuyển nhượng đúng giá sàn.')
    modal.value = false
    load()
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { busy.value = false }
}
async function setStatus(row, newStatus) {
  try { await api.patch(`/transfer-offers/${row.id}/status`, { status: newStatus }); uiStore.notify('Đã cập nhật đề nghị.'); load(meta.value.page) }
  catch (error) { uiStore.notify(error.message, 'error') }
}
async function complete(row) {
  try { await api.post(`/transfer-offers/${row.id}/complete`, {}); uiStore.notify('Đã hoàn tất chuyển nhượng, cập nhật ví và hợp đồng.'); load(meta.value.page) }
  catch (error) { uiStore.notify(error.message, 'error') }
}
</script>

<template>
  <div>
    <PageHeader eyebrow="Transfer Market" title="Chuyển nhượng" description="Phí mua và lương mới không được thấp hơn giá sàn tự động của cầu thủ.">
      <button class="btn btn-primary" @click="openCreate"><Plus :size="17"/>Tạo đề nghị</button>
    </PageHeader>
    <div class="toolbar">
      <div class="tabs"><button class="btn" :class="{ active: tab === 'offers' }" @click="tab = 'offers'"><ArrowLeftRight :size="17"/>Đề nghị</button><button class="btn" :class="{ active: tab === 'history' }" @click="tab = 'history'"><CircleCheckBig :size="17"/>Lịch sử</button></div>
      <select v-if="tab === 'offers'" v-model="status" class="select status-filter"><option value="">Tất cả trạng thái</option><option value="SENT">Đã gửi</option><option value="ACCEPTED">Đã chấp nhận</option><option value="REJECTED">Từ chối</option><option value="COMPLETED">Hoàn tất</option></select>
    </div>
    <LoadingBlock v-if="loading"/><EmptyState v-else-if="!rows.length"/>
    <div v-else class="glass card table-card"><div class="table-wrap"><table><thead><tr v-if="tab === 'offers'"><th>Cầu thủ</th><th>Từ</th><th>Đến</th><th>Loại</th><th>Phí</th><th>Lương mới</th><th>Trạng thái</th><th></th></tr><tr v-else><th>Thời gian</th><th>Cầu thủ</th><th>Từ</th><th>Đến</th><th>Loại</th><th>Phí</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><template v-if="tab === 'offers'"><td><b>{{ row.player_name }}</b></td><td>{{ row.seller_club_name || 'Tự do' }}</td><td>{{ row.buyer_club_name }}</td><td>{{ row.transfer_type }}</td><td>{{ money(row.transfer_fee) }}</td><td>{{ money(row.new_salary_per_season) }}</td><td><StatusBadge :status="row.status"/></td><td><div class="actions"><button v-if="['SENT','DRAFT'].includes(row.status)" class="btn btn-sm btn-success" @click="setStatus(row, 'ACCEPTED')"><Check :size="14"/></button><button v-if="['SENT','DRAFT'].includes(row.status)" class="btn btn-sm btn-danger" @click="setStatus(row, 'REJECTED')"><X :size="14"/></button><button v-if="isAdmin && row.status === 'ACCEPTED'" class="btn btn-sm btn-primary" @click="complete(row)">Hoàn tất</button></div></td></template><template v-else><td>{{ date(row.completed_at, true) }}</td><td><b>{{ row.player_name }}</b></td><td>{{ row.from_club_name || 'Tự do' }}</td><td>{{ row.to_club_name }}</td><td>{{ row.transfer_type }}</td><td>{{ money(row.transfer_fee) }}</td></template></tr></tbody></table></div><PaginationBar v-bind="meta" @change="load"/></div>

    <BaseModal :open="modal" title="Tạo đề nghị chuyển nhượng" @close="modal = false" width="760px">
      <form class="form-grid" @submit.prevent="create">
        <label class="form-group full"><span class="label">Cầu thủ</span><select v-model="form.player_id" class="select" required><option value="">Chọn cầu thủ</option><option v-for="player in players" :key="player.id" :value="player.id">{{ player.full_name }} · {{ player.club_name || 'Tự do' }} · {{ money(player.market_value, true) }}</option></select></label>
        <section v-if="selectedPlayer" class="valuation-floor form-group full">
          <Gem :size="21"/><div><span>Giá sàn hiện tại</span><b>{{ money(marketFloor) }}</b><p>Phí chuyển nhượng có phí và lương mới phải từ mức này trở lên. Cầu thủ tự do vẫn không mất phí nhưng lương phải đạt sàn.</p></div>
          <ShieldCheck :size="25"/>
        </section>
        <label v-if="isAdmin"><span class="label">CLB mua</span><select v-model="form.buyer_club_id" class="select" required><option value="">Chọn CLB</option><option v-for="club in clubs" :key="club.id" :value="club.id">{{ club.name }}</option></select></label>
        <label><span class="label">Loại chuyển nhượng</span><select v-model="form.transfer_type" class="select"><option value="PAID">Có phí</option><option value="FREE">Tự do</option></select></label>
        <label v-if="form.transfer_type === 'PAID'"><span class="label">Phí chuyển nhượng (tối thiểu {{ money(marketFloor, true) }})</span><input v-model="form.transfer_fee" type="number" :min="marketFloor" class="input"/></label>
        <label><span class="label">Lương mới/mùa (tối thiểu {{ money(marketFloor, true) }})</span><input v-model="form.new_salary_per_season" type="number" :min="marketFloor" class="input" required/></label>
        <label><span class="label">Mùa bắt đầu</span><select v-model="form.contract_start_season_id" class="select" required><option value="">Chọn mùa</option><option v-for="season in seasons" :key="season.id" :value="season.id">{{ season.name }}</option></select></label>
        <label><span class="label">Mùa kết thúc</span><select v-model="form.contract_end_season_id" class="select"><option value="">Không xác định</option><option v-for="season in seasons" :key="season.id" :value="season.id">{{ season.name }}</option></select></label>
        <label class="form-group full"><span class="label">Ghi chú</span><textarea v-model="form.note" class="textarea"/></label>
        <div class="form-group full actions"><button class="btn" type="button" @click="modal = false">Hủy</button><button class="btn btn-primary" :disabled="busy || !selectedPlayer">{{ busy ? 'Đang gửi...' : 'Gửi đề nghị' }}</button></div>
      </form>
    </BaseModal>
  </div>
</template>

<style scoped>
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:18px}.tabs{display:flex;gap:8px}.tabs .active{background:linear-gradient(135deg,var(--primary),var(--primary-2));border-color:transparent}.status-filter{width:210px}.table-card{padding:0;overflow:hidden}.actions{display:flex;gap:5px;justify-content:flex-end}.form-group.full.actions{display:flex;justify-content:flex-end;gap:9px}.valuation-floor{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:14px;border:1px solid rgba(190,255,60,.26);border-radius:14px;background:linear-gradient(135deg,rgba(190,255,60,.07),rgba(57,130,255,.06))}.valuation-floor span,.valuation-floor b{display:block}.valuation-floor span{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.valuation-floor b{font:800 22px Manrope;color:var(--yellow);margin:4px 0}.valuation-floor p{font-size:10px;color:var(--muted)}@media(max-width:650px){.toolbar{align-items:stretch;flex-direction:column}.status-filter{width:100%}.valuation-floor{grid-template-columns:auto 1fr}.valuation-floor>svg:last-child{display:none}}
</style>
