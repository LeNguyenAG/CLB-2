<script setup>
import { onMounted, ref } from 'vue'
import { Plus, Play, Flag, Trash2, AlertTriangle, Database, RotateCcw, ShieldAlert } from '@lucide/vue'
import { api } from '../../services/api'
import { uiStore } from '../../stores/ui'
import { date } from '../../utils'
import PageHeader from '../../components/PageHeader.vue'
import LoadingBlock from '../../components/LoadingBlock.vue'
import EmptyState from '../../components/EmptyState.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import BaseModal from '../../components/BaseModal.vue'
import ConfirmDialog from '../../components/ConfirmDialog.vue'

const rows = ref([])
const loading = ref(true)
const modal = ref(false)
const confirm = ref(null)
const busy = ref(false)
const form = ref({ name: '', sequence_no: '', starts_on: '', ends_on: '', status: 'DRAFT' })

const deleteTarget = ref(null)
const deletePreview = ref(null)
const deleteName = ref('')
const deleteForce = ref(false)
const deleteLoading = ref(false)

const resetModal = ref(false)
const resetPreview = ref(null)
const resetLoading = ref(false)
const resetPhrase = ref('')
const resetPassword = ref('')

async function load() {
  loading.value = true
  try {
    rows.value = (await api.get('/seasons')).data
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function create() {
  busy.value = true
  try {
    await api.post('/seasons', form.value)
    uiStore.notify('Đã tạo mùa giải.')
    modal.value = false
    await load()
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}

async function activate(row) {
  try {
    await api.post(`/seasons/${row.id}/activate`, {})
    uiStore.notify('Đã kích hoạt mùa giải.')
    await load()
  } catch (error) {
    uiStore.notify(error.message, 'error')
  }
}

async function closeSeason() {
  busy.value = true
  try {
    await api.post(`/seasons/${confirm.value.id}/close`, {})
    uiStore.notify('Đã kết thúc mùa, trả lương và chốt dữ liệu.')
    confirm.value = null
    await load()
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}

async function openDelete(row) {
  deleteTarget.value = row
  deletePreview.value = null
  deleteName.value = ''
  deleteForce.value = false
  deleteLoading.value = true
  try {
    deletePreview.value = (await api.get(`/seasons/${row.id}/delete-preview`)).data
  } catch (error) {
    uiStore.notify(error.message, 'error')
    deleteTarget.value = null
  } finally {
    deleteLoading.value = false
  }
}

function closeDelete() {
  if (busy.value) return
  deleteTarget.value = null
  deletePreview.value = null
  deleteName.value = ''
  deleteForce.value = false
}

async function removeSeason() {
  busy.value = true
  try {
    await api.delete(`/seasons/${deleteTarget.value.id}`, {
      confirmation: deleteName.value,
      force: deleteForce.value,
    })
    uiStore.notify(`Đã xóa ${deleteTarget.value.name} và dữ liệu liên quan.`)
    closeDelete()
    await load()
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}

async function openDemoReset() {
  resetModal.value = true
  resetPreview.value = null
  resetPhrase.value = ''
  resetPassword.value = ''
  resetLoading.value = true
  try {
    resetPreview.value = (await api.get('/system/demo-reset-preview')).data
  } catch (error) {
    uiStore.notify(error.message, 'error')
    resetModal.value = false
  } finally {
    resetLoading.value = false
  }
}

function closeDemoReset() {
  if (busy.value) return
  resetModal.value = false
  resetPreview.value = null
  resetPhrase.value = ''
  resetPassword.value = ''
}

async function resetDemoData() {
  busy.value = true
  try {
    const response = await api.post('/system/reset-demo-data', {
      confirmation: resetPhrase.value,
      current_password: resetPassword.value,
    }, { timeout: 60000 })
    uiStore.notify(response.data.message || 'Đã xóa toàn bộ dữ liệu mẫu.')
    closeDemoReset()
    await load()
  } catch (error) {
    uiStore.notify(error.message, 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      eyebrow="Season Lifecycle"
      title="Mùa giải"
      description="Kích hoạt, kết thúc hoặc xóa một mùa cùng dữ liệu liên quan theo quy trình kiểm soát an toàn."
    >
      <button class="btn reset-demo-btn" @click="openDemoReset">
        <RotateCcw :size="17" />
        Xóa dữ liệu mẫu
      </button>
      <button
        class="btn btn-primary"
        @click="form = { name: '', sequence_no: '', starts_on: '', ends_on: '', status: 'DRAFT' }; modal = true"
      >
        <Plus :size="17" />
        Tạo mùa
      </button>
    </PageHeader>

    <LoadingBlock v-if="loading" />
    <EmptyState v-else-if="!rows.length" title="Chưa có mùa giải" description="Hệ thống đã sẵn sàng để bạn tạo mùa giải dữ liệu thật đầu tiên." />

    <div v-else class="season-list">
      <article v-for="season in rows" :key="season.id" class="glass card">
        <div class="season-no">{{ season.sequence_no }}</div>
        <div>
          <span class="eyebrow">Mùa số {{ season.sequence_no }}</span>
          <h2>{{ season.name }}</h2>
          <p>{{ date(season.starts_on) }} – {{ date(season.ends_on) }}</p>
        </div>
        <StatusBadge :status="season.status" />
        <div class="actions">
          <button v-if="season.status === 'DRAFT'" class="btn btn-sm btn-primary" @click="activate(season)">
            <Play :size="14" />Kích hoạt
          </button>
          <button v-if="season.status === 'ACTIVE'" class="btn btn-sm btn-danger" @click="confirm = season">
            <Flag :size="14" />Kết thúc mùa
          </button>
          <button class="btn btn-sm delete-btn" @click="openDelete(season)">
            <Trash2 :size="14" />Xóa mùa
          </button>
        </div>
      </article>
    </div>

    <BaseModal :open="modal" title="Tạo mùa giải" @close="modal = false" width="620px">
      <form class="form-grid" @submit.prevent="create">
        <label><span class="label">Tên mùa</span><input v-model="form.name" class="input" required placeholder="Mùa giải 1" /></label>
        <label><span class="label">Số thứ tự</span><input v-model.number="form.sequence_no" type="number" min="1" class="input" required /></label>
        <label><span class="label">Ngày bắt đầu</span><input v-model="form.starts_on" type="date" class="input" required /></label>
        <label><span class="label">Ngày kết thúc</span><input v-model="form.ends_on" type="date" class="input" required /></label>
        <div class="form-group full actions">
          <button type="button" class="btn" @click="modal = false">Hủy</button>
          <button class="btn btn-primary" :disabled="busy">Tạo mùa</button>
        </div>
      </form>
    </BaseModal>

    <ConfirmDialog
      :open="Boolean(confirm)"
      title="Kết thúc mùa giải"
      :message="`Hệ thống sẽ trả toàn bộ lương cầu thủ và ban huấn luyện của ${confirm?.name}. Không thể chạy hai lần.`"
      confirm-text="Kết thúc mùa"
      danger
      :busy="busy"
      @close="confirm = null"
      @confirm="closeSeason"
    />

    <BaseModal :open="Boolean(deleteTarget)" title="Xóa mùa giải và dữ liệu liên quan" @close="closeDelete" width="720px">
      <LoadingBlock v-if="deleteLoading" />
      <template v-else-if="deletePreview">
        <div class="danger-heading">
          <div class="danger-icon"><Database :size="27" /></div>
          <div>
            <h3>{{ deleteTarget?.name }}</h3>
            <p>Thao tác này xóa giải đấu, trận đấu, danh hiệu, BXH và hợp đồng bắt đầu trong mùa. Các giao dịch tài chính của mùa sẽ được đảo để giữ đúng số dư.</p>
          </div>
        </div>

        <div v-if="deletePreview.blockers?.length" class="blockers">
          <AlertTriangle :size="19" />
          <div><b>Chưa thể xóa mùa này</b><p v-for="item in deletePreview.blockers" :key="item">{{ item }}</p></div>
        </div>

        <div v-if="deletePreview.warnings?.length" class="warnings">
          <AlertTriangle :size="19" />
          <div><b>Dữ liệu liên kết sẽ được xử lý cùng mùa</b><p v-for="item in deletePreview.warnings" :key="item">{{ item }}</p></div>
        </div>

        <div class="delete-counts">
          <div><b>{{ deletePreview.counts.competitions }}</b><span>Giải đấu</span></div>
          <div><b>{{ deletePreview.counts.playerAwards }}</b><span>Danh hiệu cầu thủ</span></div>
          <div><b>{{ deletePreview.counts.clubAchievements }}</b><span>Thành tích CLB</span></div>
          <div><b>{{ deletePreview.counts.playerContracts + deletePreview.counts.staffContracts }}</b><span>Hợp đồng</span></div>
          <div><b>{{ deletePreview.counts.rankingSnapshots }}</b><span>Ảnh chụp BXH</span></div>
          <div><b>{{ deletePreview.counts.financialEntriesToReverse }}</b><span>Giao dịch cần đảo</span></div>
        </div>

        <label class="form-group full">
          <span class="label">Nhập chính xác “{{ deleteTarget?.name }}” để xác nhận</span>
          <input v-model="deleteName" class="input danger-input" autocomplete="off" :placeholder="deleteTarget?.name" />
        </label>

        <label v-if="deletePreview.requiresForce" class="force-check">
          <input v-model="deleteForce" type="checkbox" />
          <span>
            <b>Tôi xác nhận xóa toàn bộ dữ liệu đã phát sinh</b>
            <small>Bắt buộc vì mùa đã kết thúc hoặc có giao dịch tài chính. Hệ thống sẽ tạo các bút toán đảo, không xóa lịch sử giao dịch.</small>
          </span>
        </label>

        <div class="actions modal-actions">
          <button class="btn" type="button" @click="closeDelete">Hủy</button>
          <button
            class="btn btn-danger"
            :disabled="busy || !deletePreview.canDelete || deleteName !== deleteTarget?.name || (deletePreview.requiresForce && !deleteForce)"
            @click="removeSeason"
          >
            <Trash2 :size="16" />Xóa vĩnh viễn
          </button>
        </div>
      </template>
    </BaseModal>

    <BaseModal :open="resetModal" title="Xóa toàn bộ dữ liệu mẫu" @close="closeDemoReset" width="780px">
      <LoadingBlock v-if="resetLoading" />
      <template v-else-if="resetPreview">
        <div class="reset-hero">
          <div class="reset-icon"><ShieldAlert :size="30" /></div>
          <div>
            <span class="eyebrow">Fresh Start</span>
            <h3>Khởi tạo hệ thống để nhập dữ liệu thật</h3>
            <p>Thao tác này xóa toàn bộ mùa, CLB, tài khoản CLB, cầu thủ, ban huấn luyện, giải đấu, hợp đồng, chuyển nhượng, danh hiệu, BXH và giao dịch mẫu.</p>
          </div>
        </div>

        <div class="reset-counts">
          <div><b>{{ resetPreview.counts.seasons }}</b><span>Mùa giải</span></div>
          <div><b>{{ resetPreview.counts.clubs }}</b><span>CLB</span></div>
          <div><b>{{ resetPreview.counts.players }}</b><span>Cầu thủ</span></div>
          <div><b>{{ resetPreview.counts.staff }}</b><span>Ban huấn luyện</span></div>
          <div><b>{{ resetPreview.counts.competitions }}</b><span>Giải đấu</span></div>
          <div><b>{{ resetPreview.counts.matches }}</b><span>Trận đấu</span></div>
          <div><b>{{ resetPreview.counts.player_transfers }}</b><span>Chuyển nhượng</span></div>
          <div><b>{{ resetPreview.counts.wallet_transactions }}</b><span>Giao dịch ví</span></div>
        </div>

        <div class="preserved-box">
          <b>Hệ thống vẫn giữ lại</b>
          <span v-for="item in resetPreview.keeps" :key="item">✓ {{ item }}</span>
        </div>

        <label class="form-group full">
          <span class="label">Mật khẩu Admin FIFA hiện tại</span>
          <input v-model="resetPassword" type="password" class="input danger-input" autocomplete="current-password" placeholder="Nhập mật khẩu Admin" />
        </label>

        <label class="form-group full">
          <span class="label">Nhập chính xác “{{ resetPreview.confirmationPhrase }}”</span>
          <input v-model="resetPhrase" class="input danger-input" autocomplete="off" :placeholder="resetPreview.confirmationPhrase" />
        </label>

        <div class="irreversible-note">
          <AlertTriangle :size="18" />
          <span>Không thể hoàn tác. Chỉ sử dụng một lần để loại bỏ dữ liệu mẫu trước khi vận hành dữ liệu thật.</span>
        </div>

        <div class="actions modal-actions">
          <button class="btn" type="button" @click="closeDemoReset">Hủy</button>
          <button
            class="btn btn-danger"
            :disabled="busy || !resetPassword || resetPhrase !== resetPreview.confirmationPhrase"
            @click="resetDemoData"
          >
            <RotateCcw :size="16" />{{ busy ? 'Đang làm sạch...' : 'Xóa dữ liệu mẫu' }}
          </button>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.season-list{display:grid;gap:13px}.season-list article{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:18px}.season-no{width:58px;height:58px;border-radius:16px;display:grid;place-items:center;font:800 24px Manrope;color:var(--cyan);background:rgba(41,216,255,.08)}.season-list h2{font-size:21px;margin:5px 0}.actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.delete-btn,.reset-demo-btn{color:#ff8790;border-color:rgba(255,86,103,.24)}.delete-btn:hover,.reset-demo-btn:hover{background:rgba(255,72,89,.1)}.danger-heading,.reset-hero{display:flex;gap:14px;padding:15px;border:1px solid rgba(255,77,94,.22);background:rgba(255,65,83,.055);border-radius:15px}.danger-heading h3,.reset-hero h3{font-size:20px;margin:5px 0}.danger-heading p,.reset-hero p{font-size:12px}.danger-icon,.reset-icon{width:50px;height:50px;flex:0 0 50px;border-radius:14px;display:grid;place-items:center;color:#ff6b79;background:rgba(255,74,91,.11)}.blockers,.warnings,.irreversible-note{display:flex;gap:11px;margin-top:13px;padding:13px;border-radius:13px}.blockers,.irreversible-note{background:rgba(255,183,52,.09);border:1px solid rgba(255,183,52,.2);color:#ffd071}.warnings{background:rgba(41,216,255,.07);border:1px solid rgba(41,216,255,.18);color:#8deaff}.blockers p,.warnings p{font-size:11px;margin-top:5px}.warnings p{color:var(--muted)}.delete-counts,.reset-counts{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:14px 0}.delete-counts{grid-template-columns:repeat(3,1fr)}.delete-counts div,.reset-counts div{padding:12px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.025)}.delete-counts b,.delete-counts span,.reset-counts b,.reset-counts span{display:block}.delete-counts b,.reset-counts b{font:800 20px Manrope}.delete-counts span,.reset-counts span{font-size:9px;color:var(--muted);margin-top:4px}.danger-input:focus{border-color:#ff6674;box-shadow:0 0 0 3px rgba(255,77,94,.09)}.force-check{display:flex;gap:10px;align-items:flex-start;margin-top:13px;padding:13px;border:1px solid rgba(255,87,101,.2);border-radius:12px}.force-check input{margin-top:3px}.force-check b,.force-check small{display:block}.force-check small{color:var(--muted);font-size:10px;margin-top:4px}.preserved-box{display:grid;gap:7px;margin:14px 0;padding:14px;border:1px solid rgba(65,215,156,.2);border-radius:13px;background:rgba(65,215,156,.06)}.preserved-box span{font-size:11px;color:var(--muted)}.modal-actions{margin-top:17px}@media(max-width:700px){.season-list article{grid-template-columns:auto 1fr}.season-list article>.badge,.season-list article>.actions{grid-column:1/-1}.actions{justify-content:flex-start}.delete-counts,.reset-counts{grid-template-columns:repeat(2,1fr)}}
</style>
