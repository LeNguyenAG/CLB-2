<script setup>
import { computed, onMounted, ref } from 'vue'
import { PawPrint, Sparkles } from '@lucide/vue'
import { api } from '../../services/api'
import { authStore } from '../../stores/auth'
import { uiStore } from '../../stores/ui'
import PageHeader from '../../components/PageHeader.vue'
import LoadingBlock from '../../components/LoadingBlock.vue'
import MascotStudio from '../../components/MascotStudio.vue'
import { suggestMascot } from '../../data/clubMascots'

const loading = ref(true), clubs = ref([]), selectedId = ref(null)
const isAdmin = computed(() => authStore.isAdmin.value)
const selectedClub = computed(() => clubs.value.find((club) => Number(club.id) === Number(selectedId.value)))
async function load() {
  try {
    const result = await api.get('/clubs', { limit: 100, status: isAdmin.value ? 'APPROVED' : undefined })
    clubs.value = result.data
    selectedId.value = selectedId.value || clubs.value[0]?.id
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { loading.value = false }
}
async function autoAssign() {
  loading.value = true
  try {
    const mascotData = (await api.get('/club-mascots')).data
    const assignments = mascotData.assignments || []
    const occupied = assignments.filter((row) => row.mascot_key).map((row) => row.mascot_key)
    let assigned = 0
    for (const club of clubs.value) {
      if (assignments.find((row) => Number(row.club_id) === Number(club.id))?.mascot_key) continue
      const mascot = suggestMascot(club.name, occupied)
      if (!mascot || occupied.includes(mascot.key)) break
      await api.patch(`/clubs/${club.id}/mascot`, { mascot_key: mascot.key, locked: false })
      occupied.push(mascot.key); assigned += 1
    }
    uiStore.notify(assigned ? `Đã đề xuất linh vật riêng cho ${assigned} CLB.` : 'Tất cả CLB đã có linh vật hoặc kho 24 mẫu đã đủ.')
    await load()
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <div>
    <PageHeader eyebrow="Club Mascot Studio · 24 lựa chọn" title="Linh vật câu lạc bộ" description="Chọn bản sắc riêng để xuất hiện đồng bộ tại đội tham dự, vòng bảng, lịch trận và toàn bộ nhánh loại trực tiếp của mọi giải CLB.">
      <div v-if="isAdmin" class="header-tools"><select v-model="selectedId" class="select club-select"><option v-for="club in clubs" :key="club.id" :value="club.id">{{ club.name }}</option></select><button class="btn btn-primary" @click="autoAssign"><Sparkles :size="16"/>Đề xuất cho CLB chưa có</button></div>
    </PageHeader>
    <LoadingBlock v-if="loading" />
    <template v-else-if="selectedClub">
      <div class="studio-note glass"><PawPrint :size="22"/><div><b>Quy tắc linh vật</b><p>Mỗi mẫu chỉ thuộc một CLB. CLB được đổi khi chưa chốt; Admin FIFA có thể hoán đổi, khóa hoặc mở khóa.</p></div><Sparkles :size="18"/></div>
      <div class="glass card"><MascotStudio :key="selectedClub.id" :club="selectedClub" :admin="isAdmin" @updated="Object.assign(selectedClub,$event)"/></div>
    </template>
  </div>
</template>

<style scoped>
.header-tools{display:flex;gap:8px;flex-wrap:wrap}.club-select{width:min(320px,100%)}.studio-note{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;margin-bottom:15px;padding:13px 16px;color:#ffd65a}.studio-note p{margin-top:3px;color:var(--muted);font-size:11px}.studio-note>:last-child{color:#7bb8ff}@media(max-width:560px){.studio-note{grid-template-columns:auto 1fr}.studio-note>:last-child{display:none}}
</style>
