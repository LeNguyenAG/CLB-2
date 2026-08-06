<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import {
  Plus, Search, UserRound, UsersRound, Gem, UserMinus, AlertTriangle, CheckCircle2,
  RefreshCw, ArrowUpRight, ArrowDownRight, Minus, ShieldCheck, Sparkles, Activity
} from '@lucide/vue'
import { api } from '../../services/api'
import { authStore } from '../../stores/auth'
import { uiStore } from '../../stores/ui'
import { money, number, positionName, date } from '../../utils'
import PageHeader from '../../components/PageHeader.vue'
import LoadingBlock from '../../components/LoadingBlock.vue'
import EmptyState from '../../components/EmptyState.vue'
import EntityAvatar from '../../components/EntityAvatar.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import BaseModal from '../../components/BaseModal.vue'
import PaginationBar from '../../components/PaginationBar.vue'

const isAdmin = computed(() => authStore.isAdmin.value)
const tab = ref('players')
const loading = ref(true)
const rows = ref([])
const clubs = ref([])
const seasons = ref([])
const rosterStatus = ref(null)
const valuationSummary = ref(null)
const valuationData = ref(null)
const meta = ref({ page: 1, limit: 20, total: 0 })
const filters = ref({ search: '', position: '', status: '', sort: 'VALUE_DESC' })
const modal = ref('')
const busy = ref(false)
const revaluating = ref(false)
const selected = ref(null)
const form = ref({})
let debounce

const componentLabels = {
  performance: 'Phong độ & rating', production: 'Đóng góp trực tiếp', mvp: 'MVP trận/đội',
  ranking: 'Điểm xếp hạng', individualAwards: 'Danh hiệu cá nhân', teamMedals: 'Huy chương có điều chỉnh',
  momentum: 'Phong độ gần đây', experience: 'Kinh nghiệm thi đấu', discipline: 'Kỷ luật'
}

const valuationBreakdown = computed(() => valuationData.value?.latestResult?.breakdown
  || valuationData.value?.player?.valuation_breakdown || null)
const componentRows = computed(() => Object.entries(valuationBreakdown.value?.components || {})
  .map(([key, value]) => ({ key, label: componentLabels[key] || key, value: Number(value || 0) })))

function resetPlayer() {
  form.value = {
    full_name: '', position: 'FW', shirt_number: '',
    club_id: isAdmin.value ? '' : authStore.user.value.clubId,
    photo_url: '', contract: { start_season_id: '', end_season_id: '', salary_per_season: '0', note: '' }
  }
}

function resetStaff() {
  form.value = {
    full_name: '', staff_role: 'Huấn luyện viên trưởng',
    club_id: isAdmin.value ? '' : authStore.user.value.clubId,
    contract: { start_season_id: '', end_season_id: '', salary_per_season: '0', note: '' }
  }
}

async function loadRosterStatus() {
  if (isAdmin.value || !authStore.user.value?.clubId) { rosterStatus.value = null; return }
  try { rosterStatus.value = (await api.get(`/clubs/${authStore.user.value.clubId}/roster-status`)).data }
  catch { rosterStatus.value = null }
}

async function loadValuationSummary() {
  if (!isAdmin.value) return
  try { valuationSummary.value = (await api.get('/player-valuations/summary')).data }
  catch { valuationSummary.value = null }
}

async function load(page = 1) {
  loading.value = true
  try {
    const path = tab.value === 'players' ? '/players' : '/staff'
    const query = tab.value === 'players' ? { page, limit: 20, ...filters.value } : { page, limit: 20 }
    const result = await api.get(path, query)
    rows.value = result.data
    meta.value = result.meta
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { loading.value = false }
}

watch([tab, filters], () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => load(1), 250)
}, { deep: true })

onMounted(async () => {
  try {
    const [clubResult, seasonResult] = await Promise.all([
      isAdmin.value ? api.get('/clubs', { limit: 100, status: 'APPROVED' }) : Promise.resolve({ data: [] }),
      api.get('/seasons')
    ])
    clubs.value = clubResult.data
    seasons.value = seasonResult.data
  } catch { /* Trang vẫn dùng được khi danh mục phụ tạm lỗi. */ }
  await Promise.all([load(), loadRosterStatus(), loadValuationSummary()])
})

function openCreate() {
  selected.value = null
  if (tab.value === 'players') resetPlayer(); else resetStaff()
  modal.value = tab.value
}

async function save() {
  busy.value = true
  try {
    const source = JSON.parse(JSON.stringify(form.value))
    if (tab.value === 'players') {
      if (selected.value) {
        const payload = {
          full_name: source.full_name, position: source.position, shirt_number: source.shirt_number,
          photo_url: source.photo_url, status: source.status
        }
        await api.patch(`/players/${selected.value.id}`, payload)
      } else {
        if (!source.club_id) delete source.contract
        await api.post('/players', source)
      }
    } else if (selected.value) {
      await api.patch(`/staff/${selected.value.id}`, {
        full_name: source.full_name, staff_role: source.staff_role, status: source.status
      })
    } else {
      if (!source.club_id) delete source.contract
      await api.post('/staff', source)
    }
    uiStore.notify('Đã lưu dữ liệu.')
    modal.value = ''
    await Promise.all([load(meta.value.page), loadRosterStatus()])
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { busy.value = false }
}

async function openValuation(row) {
  selected.value = row
  valuationData.value = null
  modal.value = 'valuation'
  try { valuationData.value = (await api.get(`/players/${row.id}/valuation`)).data }
  catch (error) { uiStore.notify(error.message, 'error'); modal.value = '' }
}

async function refreshAllValues() {
  if (!window.confirm('Tạo một kỳ định giá mới cho toàn bộ cầu thủ đang hoạt động?')) return
  revaluating.value = true
  try {
    const result = (await api.post('/player-valuations/recalculate', {
      note: 'Làm mới từ trang quản lý cầu thủ'
    })).data
    const batch = result.batch
    uiStore.notify(`Đã định giá ${batch.total_players} cầu thủ: ${batch.increased_count} tăng, ${batch.decreased_count} giảm.`)
    await Promise.all([load(1), loadValuationSummary()])
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { revaluating.value = false }
}

async function refreshOneValue() {
  if (!selected.value) return
  revaluating.value = true
  try {
    await api.post(`/players/${selected.value.id}/valuation/recalculate`, {
      note: 'Làm mới riêng từ hồ sơ định giá'
    })
    valuationData.value = (await api.get(`/players/${selected.value.id}/valuation`)).data
    uiStore.notify('Đã làm mới định giá cầu thủ.')
    await Promise.all([load(meta.value.page), loadValuationSummary()])
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { revaluating.value = false }
}

async function release(row) {
  const reason = window.prompt(`Lý do thanh lý ${row.full_name}`, 'Thanh lý hợp đồng theo quyết định CLB')
  if (!reason) return
  try {
    await api.post(`/players/${row.id}/release`, { reason })
    uiStore.notify('Cầu thủ đã trở thành tự do.')
    await Promise.all([load(meta.value.page), loadRosterStatus()])
  } catch (error) { uiStore.notify(error.message, 'error') }
}
</script>

<template>
  <div>
    <PageHeader
      eyebrow="Squad & Staff"
      :title="isAdmin ? 'Quản lý cầu thủ và ban huấn luyện' : 'Đội hình câu lạc bộ'"
      description="Giá sàn cầu thủ được tự động tính từ phong độ, đóng góp, MVP, điểm, danh hiệu CLB và quốc gia."
    >
      <div class="header-buttons">
        <button v-if="isAdmin && tab === 'players'" class="btn" :disabled="revaluating" @click="refreshAllValues">
          <RefreshCw :size="17" :class="{ spinning: revaluating }"/>
          {{ revaluating ? 'Đang định giá...' : 'Làm mới định giá' }}
        </button>
        <button class="btn btn-primary" @click="openCreate">
          <Plus :size="17"/>{{ tab === 'players' ? 'Thêm cầu thủ' : 'Thêm BHL' }}
        </button>
      </div>
    </PageHeader>

    <section v-if="!isAdmin && rosterStatus" class="roster-health" :class="rosterStatus.has_warning ? 'warning' : 'ready'">
      <component :is="rosterStatus.has_warning ? AlertTriangle : CheckCircle2" :size="24"/>
      <div>
        <b>{{ rosterStatus.has_warning ? 'Đội hình cố định chưa đủ người' : 'Đội hình cố định đã sẵn sàng' }}</b>
        <p>{{ rosterStatus.active_count }}/{{ rosterStatus.minimum_required }} cầu thủ hoạt động<span v-if="rosterStatus.has_warning"> · cần thêm {{ rosterStatus.shortage_count }} cầu thủ</span>.</p>
      </div>
    </section>

    <div class="tabs">
      <button class="btn" :class="{ active: tab === 'players' }" @click="tab = 'players'"><UserRound :size="17"/>Cầu thủ</button>
      <button class="btn" :class="{ active: tab === 'staff' }" @click="tab = 'staff'"><UsersRound :size="17"/>Ban huấn luyện</button>
    </div>

    <section v-if="isAdmin && tab === 'players' && valuationSummary" class="valuation-overview">
      <article class="glass valuation-stat">
        <Gem :size="18"/><span>Giá cao nhất</span><b>{{ money(valuationSummary.totals.highest_value, true) }}</b>
      </article>
      <article class="glass valuation-stat">
        <Activity :size="18"/><span>Giá trung bình</span><b>{{ money(valuationSummary.totals.average_value, true) }}</b>
      </article>
      <article class="glass valuation-stat up">
        <ArrowUpRight :size="18"/><span>Tăng kỳ gần nhất</span><b>{{ valuationSummary.latestBatch?.increased_count || 0 }}</b>
      </article>
      <article class="glass valuation-stat down">
        <ArrowDownRight :size="18"/><span>Giảm kỳ gần nhất</span><b>{{ valuationSummary.latestBatch?.decreased_count || 0 }}</b>
      </article>
    </section>

    <div v-if="tab === 'players'" class="glass card toolbar">
      <div class="toolbar-actions">
        <div class="search"><Search :size="17"/><input v-model="filters.search" class="input" placeholder="Tìm cầu thủ..."/></div>
        <select v-model="filters.position" class="select">
          <option value="">Tất cả vị trí</option><option value="GK">Thủ môn</option><option value="DF">Hậu vệ</option><option value="MF">Tiền vệ</option><option value="FW">Tiền đạo</option>
        </select>
        <select v-model="filters.status" class="select">
          <option value="">Tất cả trạng thái</option><option value="ACTIVE">Đang thi đấu</option><option value="FREE_AGENT">Tự do</option><option value="TRANSFER_LISTED">Rao bán</option><option value="SUSPENDED">Tạm khóa</option>
        </select>
        <select v-model="filters.sort" class="select price-sort">
          <option value="VALUE_DESC">Giá cao → thấp</option><option value="VALUE_ASC">Giá thấp → cao</option>
          <option value="CHANGE_DESC">Tăng nhiều nhất</option><option value="CHANGE_ASC">Giảm nhiều nhất</option><option value="NAME_ASC">Tên A → Z</option>
        </select>
      </div>
      <span class="muted">{{ meta.total }} cầu thủ</span>
    </div>

    <LoadingBlock v-if="loading"/>
    <EmptyState v-else-if="!rows.length"/>
    <div v-else class="glass card table-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr v-if="tab === 'players'"><th>Cầu thủ</th><th>CLB</th><th>Vị trí</th><th>Số áo</th><th>Lương/mùa</th><th>Giá sàn tự động</th><th>Trạng thái</th><th></th></tr>
            <tr v-else><th>Thành viên</th><th>CLB</th><th>Chức vụ</th><th>Lương/mùa</th><th>Số dư</th><th>Trạng thái</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <template v-if="tab === 'players'">
                <td><div class="entity"><EntityAvatar :src="row.photo_url" :name="row.full_name" :size="40" round/><span class="entity-name">{{ row.full_name }}</span></div></td>
                <td>{{ row.club_name || 'Tự do' }}</td><td>{{ positionName(row.position) }}</td><td><b>#{{ row.shirt_number || '—' }}</b></td>
                <td>{{ money(row.salary_per_season, true) }}</td>
                <td>
                  <div class="value-cell">
                    <b>{{ money(row.market_value, true) }}</b>
                    <span v-if="Number(row.latest_value_change) > 0" class="movement up"><ArrowUpRight :size="13"/>{{ money(row.latest_value_change, true) }}</span>
                    <span v-else-if="Number(row.latest_value_change) < 0" class="movement down"><ArrowDownRight :size="13"/>{{ money(Math.abs(Number(row.latest_value_change)), true) }}</span>
                    <span v-else class="movement same"><Minus :size="13"/>Không đổi</span>
                  </div>
                </td>
                <td><StatusBadge :status="row.status"/></td>
                <td><div class="actions">
                  <button class="btn btn-sm" @click="selected = row; form = { ...row }; modal = 'players'">Sửa</button>
                  <button class="btn btn-sm" @click="openValuation(row)"><Gem :size="14"/>Định giá</button>
                  <button v-if="row.club_id" class="btn btn-sm btn-danger" @click="release(row)"><UserMinus :size="14"/></button>
                </div></td>
              </template>
              <template v-else>
                <td><div class="entity"><EntityAvatar :name="row.full_name" :size="40" round/><span class="entity-name">{{ row.full_name }}</span></div></td>
                <td>{{ row.club_name || 'Tự do' }}</td><td>{{ row.staff_role }}</td><td>{{ money(row.salary_per_season, true) }}</td><td>{{ money(row.wallet_balance, true) }}</td><td><StatusBadge :status="row.status"/></td>
                <td><button class="btn btn-sm" @click="selected = row; form = { ...row }; modal = 'staff'">Sửa</button></td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
      <PaginationBar v-bind="meta" @change="load"/>
    </div>

    <BaseModal :open="modal === 'valuation'" title="Hồ sơ định giá tự động" @close="modal = ''" width="900px">
      <LoadingBlock v-if="!valuationData"/>
      <div v-else class="valuation-detail">
        <section class="valuation-hero">
          <EntityAvatar :src="selected?.photo_url" :name="valuationData.player.full_name" :size="58" round/>
          <div><span class="eyebrow">Giá sàn mua, chuyển nhượng và lương</span><h2>{{ valuationData.player.full_name }}</h2><p>{{ valuationData.player.club_name || 'Cầu thủ tự do' }} · {{ positionName(valuationData.player.position) }}</p></div>
          <div class="current-price"><span>Hiện tại</span><b>{{ money(valuationData.player.market_value) }}</b><small>Điểm định giá {{ number(valuationData.player.valuation_score) }}</small></div>
        </section>
        <div class="floor-grid">
          <article><ShieldCheck :size="18"/><span>Phí tối thiểu</span><b>{{ money(valuationData.minimumTransferFee, true) }}</b></article>
          <article><ShieldCheck :size="18"/><span>Lương tối thiểu/mùa</span><b>{{ money(valuationData.minimumSalary, true) }}</b></article>
          <article><Sparkles :size="18"/><span>Giá công bằng trước dao động</span><b>{{ money(valuationData.latestResult?.fair_value || 0, true) }}</b></article>
          <article><Activity :size="18"/><span>Dao động thị trường</span><b>{{ number(valuationData.latestResult?.market_pulse_pct || 0) }}%</b></article>
        </div>
        <div v-if="valuationBreakdown" class="valuation-columns">
          <section>
            <div class="section-title"><div><span class="eyebrow">Hệ số công bằng</span><h3>Điểm thành phần</h3></div></div>
            <div class="component-list">
              <div v-for="item in componentRows" :key="item.key"><span>{{ item.label }}</span><b :class="item.value < 0 ? 'text-red' : ''">{{ item.value > 0 ? '+' : '' }}{{ number(item.value) }}</b></div>
            </div>
            <p class="formula-note">Huy chương chỉ được tính theo hệ số cống hiến {{ number((valuationBreakdown.contributionFactor || 0) * 100) }}%; phong độ và đóng góp cá nhân có trọng số cao hơn.</p>
          </section>
          <section>
            <div class="section-title"><div><span class="eyebrow">Lịch sử</span><h3>Biến động gần đây</h3></div></div>
            <EmptyState v-if="!valuationData.history.length" title="Chưa có kỳ định giá" message="Cầu thủ mới sẽ giữ giá 0 cho đến khi có thành tích."/>
            <div v-else class="history-values">
              <article v-for="item in valuationData.history.slice(0, 8)" :key="item.id">
                <component :is="Number(item.new_value) > Number(item.old_value) ? ArrowUpRight : Number(item.new_value) < Number(item.old_value) ? ArrowDownRight : Minus" :class="Number(item.new_value) >= Number(item.old_value) ? 'text-green' : 'text-red'" :size="17"/>
                <div><b>{{ money(item.new_value, true) }}</b><p>{{ date(item.changed_at, true) }} · {{ item.reason }}</p></div>
                <strong :class="Number(item.new_value) >= Number(item.old_value) ? 'text-green' : 'text-red'">{{ Number(item.new_value) >= Number(item.old_value) ? '+' : '-' }}{{ money(Math.abs(Number(item.new_value) - Number(item.old_value)), true) }}</strong>
              </article>
            </div>
          </section>
        </div>
        <div class="modal-actions"><button class="btn" @click="modal = ''">Đóng</button><button v-if="isAdmin" class="btn btn-primary" :disabled="revaluating" @click="refreshOneValue"><RefreshCw :size="16"/>Làm mới riêng cầu thủ này</button></div>
      </div>
    </BaseModal>

    <BaseModal :open="modal === 'players'" :title="selected ? 'Cập nhật cầu thủ' : 'Thêm cầu thủ'" @close="modal = ''" width="760px">
      <form class="form-grid" @submit.prevent="save">
        <label><span class="label">Họ và tên</span><input v-model="form.full_name" class="input" required/></label>
        <label><span class="label">Vị trí</span><select v-model="form.position" class="select"><option value="GK">Thủ môn</option><option value="DF">Hậu vệ</option><option value="MF">Tiền vệ</option><option value="FW">Tiền đạo</option></select></label>
        <label><span class="label">Số áo</span><input v-model="form.shirt_number" type="number" min="1" max="99" class="input"/></label>
        <label v-if="isAdmin && !selected"><span class="label">CLB</span><select v-model="form.club_id" class="select"><option value="">Cầu thủ tự do</option><option v-for="club in clubs" :key="club.id" :value="club.id">{{ club.name }}</option></select></label>
        <div v-if="!selected" class="new-player-price"><Gem :size="17"/><div><b>Giá ban đầu: 0 ₫</b><p>Giá tự xuất hiện sau khi cầu thủ có trận đấu, điểm hoặc danh hiệu đã xác nhận.</p></div></div>
        <label class="form-group full"><span class="label">URL ảnh</span><input v-model="form.photo_url" class="input"/></label>
        <label v-if="selected" class="form-group full"><span class="label">Trạng thái</span><select v-model="form.status" class="select"><option value="ACTIVE">Đang thi đấu</option><option value="TRANSFER_LISTED">Rao bán</option><option value="SUSPENDED">Tạm khóa</option><option v-if="isAdmin" value="RETIRED">Giải nghệ</option></select></label>
        <template v-if="!selected && form.club_id">
          <label><span class="label">Mùa bắt đầu HĐ</span><select v-model="form.contract.start_season_id" class="select" required><option value="">Chọn mùa</option><option v-for="season in seasons" :key="season.id" :value="season.id">{{ season.name }}</option></select></label>
          <label><span class="label">Mùa kết thúc HĐ</span><select v-model="form.contract.end_season_id" class="select"><option value="">Không xác định</option><option v-for="season in seasons" :key="season.id" :value="season.id">{{ season.name }}</option></select></label>
          <label class="form-group full"><span class="label">Lương mỗi mùa</span><input v-model="form.contract.salary_per_season" type="number" min="0" class="input" required/></label>
        </template>
        <div class="form-group full actions"><button type="button" class="btn" @click="modal = ''">Hủy</button><button class="btn btn-primary" :disabled="busy">{{ busy ? 'Đang lưu...' : 'Lưu cầu thủ' }}</button></div>
      </form>
    </BaseModal>

    <BaseModal :open="modal === 'staff'" :title="selected ? 'Cập nhật thành viên BHL' : 'Thêm thành viên BHL'" @close="modal = ''" width="650px">
      <form class="form-grid" @submit.prevent="save">
        <label><span class="label">Họ và tên</span><input v-model="form.full_name" class="input" required/></label>
        <label><span class="label">Chức vụ</span><input v-model="form.staff_role" class="input" required/></label>
        <label v-if="isAdmin && !selected"><span class="label">CLB</span><select v-model="form.club_id" class="select"><option value="">Tự do</option><option v-for="club in clubs" :key="club.id" :value="club.id">{{ club.name }}</option></select></label>
        <label v-if="selected" class="form-group full"><span class="label">Trạng thái</span><select v-model="form.status" class="select"><option value="ACTIVE">Đang làm việc</option><option value="SUSPENDED">Tạm khóa</option><option value="RETIRED">Nghỉ việc</option></select></label>
        <template v-if="!selected && form.club_id"><label><span class="label">Mùa bắt đầu</span><select v-model="form.contract.start_season_id" class="select" required><option value="">Chọn mùa</option><option v-for="season in seasons" :key="season.id" :value="season.id">{{ season.name }}</option></select></label><label class="form-group full"><span class="label">Lương mỗi mùa</span><input v-model="form.contract.salary_per_season" type="number" min="0" class="input"/></label></template>
        <div class="form-group full actions"><button type="button" class="btn" @click="modal = ''">Hủy</button><button class="btn btn-primary" :disabled="busy">Lưu</button></div>
      </form>
    </BaseModal>
  </div>
</template>

<style scoped>
.header-buttons,.tabs,.actions,.modal-actions{display:flex;gap:8px}.header-buttons{flex-wrap:wrap}.roster-health{display:flex;align-items:center;gap:14px;margin-bottom:16px;padding:15px 17px;border-radius:15px;border:1px solid var(--line)}.roster-health.warning{background:rgba(255,130,100,.08);border-color:rgba(255,130,100,.28);color:#ff9d88}.roster-health.ready{background:rgba(70,225,145,.07);border-color:rgba(70,225,145,.25);color:#68e3a0}.roster-health b{display:block;color:var(--text);margin-bottom:3px}.roster-health p{margin:0;color:var(--muted);font-size:11px}.tabs{margin-bottom:16px}.tabs .active{background:linear-gradient(135deg,var(--primary),var(--primary-2));border-color:transparent}.valuation-overview{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}.valuation-stat{padding:15px;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:8px}.valuation-stat span{font-size:10px;color:var(--muted)}.valuation-stat b{grid-column:1/-1;font:800 21px Manrope}.valuation-stat.up svg,.movement.up{color:#3ee09b}.valuation-stat.down svg,.movement.down{color:#ff6f7d}.toolbar{margin-bottom:18px;padding:13px}.search{display:flex;align-items:center;gap:7px;min-width:240px}.search .input{border:0;background:transparent;box-shadow:none}.toolbar .select{width:155px}.toolbar .price-sort{width:180px}.table-card{padding:0;overflow:hidden}.actions{justify-content:flex-end;flex-wrap:wrap}.value-cell{display:grid;gap:4px;white-space:nowrap}.movement{display:flex;align-items:center;gap:2px;font-size:10px;font-weight:800}.movement.same{color:var(--muted)}.spinning{animation:spin 1s linear infinite}.valuation-detail{display:grid;gap:18px}.valuation-hero{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;padding:16px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(135deg,rgba(57,130,255,.09),rgba(190,255,60,.05))}.valuation-hero h2{margin:3px 0}.valuation-hero p{font-size:11px}.current-price{text-align:right}.current-price span,.current-price small{display:block;color:var(--muted);font-size:10px}.current-price b{display:block;font:800 25px Manrope;color:var(--yellow);margin:4px 0}.floor-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.floor-grid article{padding:13px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.025)}.floor-grid span,.floor-grid b{display:block}.floor-grid span{font-size:9px;color:var(--muted);margin:6px 0 3px}.valuation-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.valuation-columns>section{padding:16px;border:1px solid var(--line);border-radius:15px}.component-list{display:grid;gap:7px}.component-list div{display:flex;justify-content:space-between;padding:8px 10px;border-radius:9px;background:rgba(255,255,255,.025);font-size:11px}.formula-note{margin-top:12px;padding:10px;border-left:2px solid var(--primary);font-size:10px;color:var(--muted)}.history-values{display:grid;gap:8px}.history-values article{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--line)}.history-values p{font-size:9px;color:var(--muted)}.history-values strong{font-size:10px}.modal-actions{justify-content:flex-end}.new-player-price{grid-column:1/-1;display:flex;gap:10px;padding:12px;border:1px solid rgba(190,255,60,.22);border-radius:12px;background:rgba(190,255,60,.05)}.new-player-price p{font-size:10px;margin-top:3px}.form-group.full.actions{display:flex;justify-content:flex-end;gap:9px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:1000px){.valuation-overview,.floor-grid{grid-template-columns:repeat(2,1fr)}.valuation-columns{grid-template-columns:1fr}}@media(max-width:700px){.valuation-overview{grid-template-columns:1fr 1fr}.search{min-width:100%}.toolbar .select{width:100%}.valuation-hero{grid-template-columns:auto 1fr}.current-price{grid-column:1/-1;text-align:left}.floor-grid{grid-template-columns:1fr 1fr}.header-buttons{width:100%}.header-buttons .btn{flex:1}}@media(max-width:480px){.valuation-overview,.floor-grid{grid-template-columns:1fr}}
</style>
