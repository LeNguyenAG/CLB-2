<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Check, LockKeyhole, RefreshCw, Shuffle, Sparkles, UnlockKeyhole } from '@lucide/vue'
import { api } from '../services/api'
import { uiStore } from '../stores/ui'
import { clubMascots, mascotFor, suggestMascot } from '../data/clubMascots'
import ClubMascot from './ClubMascot.vue'

const props = defineProps({ club: { type: Object, required: true }, admin: { type: Boolean, default: false } })
const emit = defineEmits(['updated'])
const assignments = ref([]), selectedKey = ref(''), loading = ref(true), busy = ref(false)
const current = computed(() => assignments.value.find((row) => Number(row.club_id) === Number(props.club.id)) || {})
const occupied = computed(() => new Map(assignments.value.filter((row) => row.mascot_key && Number(row.club_id) !== Number(props.club.id)).map((row) => [row.mascot_key, row])))
const selected = computed(() => mascotFor(selectedKey.value))

async function load() {
  loading.value = true
  try {
    const result = await api.get('/club-mascots')
    assignments.value = result.data.assignments || []
    selectedKey.value = current.value.mascot_key || suggestMascot(props.club.name, [...occupied.value.keys()]).key
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { loading.value = false }
}
function randomAvailable() {
  const options = clubMascots.filter((mascot) => !occupied.value.has(mascot.key))
  selectedKey.value = options[Math.floor(Math.random() * options.length)]?.key || current.value.mascot_key
}
async function save({ locked = current.value.mascot_locked, swap = false } = {}) {
  if (!selectedKey.value) return
  busy.value = true
  try {
    const result = await api.patch(`/clubs/${props.club.id}/mascot`, { mascot_key: selectedKey.value, locked, swap })
    uiStore.notify(result.data.swapped ? 'Đã hoán đổi linh vật giữa hai CLB.' : locked ? 'Đã chốt linh vật chính thức.' : 'Đã cập nhật linh vật CLB.')
    await load(); emit('updated', result.data)
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { busy.value = false }
}
watch(() => props.club.id, load)
onMounted(load)
</script>

<template>
  <section class="mascot-studio">
    <div class="mascot-hero">
      <ClubMascot :mascot-key="selectedKey" :fallback-name="club.name" :size="126" animated />
      <div><span class="eyebrow"><Sparkles :size="14" /> Club Identity</span><h2>{{ selected?.name || 'Chọn linh vật' }}</h2><p>{{ club.name }} · {{ selected?.style || 'Tạo bản sắc riêng cho CLB' }}</p><div class="mascot-status"><span :class="selected?.rarity?.toLowerCase()">{{ selected?.rarity }}</span><b v-if="current.mascot_locked"><LockKeyhole :size="13" />Đã chốt</b><b v-else><UnlockKeyhole :size="13" />Có thể thay đổi</b></div></div>
    </div>
    <div v-if="loading" class="mascot-loading"><RefreshCw :size="20" />Đang mở kho linh vật...</div>
    <div v-else class="mascot-grid">
      <button v-for="mascot in clubMascots" :key="mascot.key" type="button" :class="{ selected: selectedKey === mascot.key, occupied: occupied.has(mascot.key) }" :disabled="current.mascot_locked && !admin" @click="selectedKey=mascot.key">
        <ClubMascot :mascot-key="mascot.key" :size="72" />
        <span><b>{{ mascot.name }}</b><small>{{ mascot.style }}</small><em v-if="occupied.has(mascot.key)">Đang thuộc {{ occupied.get(mascot.key).club_name }}</em><em v-else>Đang trống</em></span>
        <Check v-if="selectedKey === mascot.key" :size="17" />
      </button>
    </div>
    <div class="studio-actions">
      <button class="btn" :disabled="busy || current.mascot_locked" @click="randomAvailable"><Shuffle :size="16" />Đề xuất ngẫu nhiên</button>
      <button v-if="admin && occupied.has(selectedKey)" class="btn btn-warning" :disabled="busy" @click="save({ swap:true, locked:false })">Hoán đổi với {{ occupied.get(selectedKey).club_name }}</button>
      <button v-else class="btn btn-primary" :disabled="busy || (current.mascot_locked && !admin)" @click="save({ locked:false })">{{ busy?'Đang lưu...':'Chọn linh vật này' }}</button>
      <button v-if="admin && current.mascot_key" class="btn" :class="current.mascot_locked?'btn-danger':'btn-success'" :disabled="busy" @click="selectedKey=current.mascot_key;save({ locked:!current.mascot_locked })"><component :is="current.mascot_locked?UnlockKeyhole:LockKeyhole" :size="16" />{{ current.mascot_locked?'Mở khóa':'Chốt chính thức' }}</button>
    </div>
  </section>
</template>

<style scoped>
.mascot-studio{display:grid;gap:16px}.mascot-hero{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:22px;padding:18px;border:1px solid color-mix(in srgb,var(--primary) 30%,var(--line));border-radius:18px;background:radial-gradient(circle at 10% 20%,rgba(255,199,70,.12),transparent 30%),linear-gradient(145deg,rgba(15,31,57,.95),rgba(5,13,26,.98));overflow:hidden}.mascot-hero h2{margin:7px 0 3px;font-size:25px}.mascot-status{display:flex;gap:7px;margin-top:10px}.mascot-status span,.mascot-status b{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:99px;background:rgba(255,255,255,.06);color:#a9bddc;font-size:8px}.mascot-status .mythic{color:#ffe075;background:rgba(255,199,52,.13)}.mascot-status .legendary{color:#ff997c}.mascot-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;max-height:440px;overflow:auto;padding:2px}.mascot-grid>button{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;min-width:0;padding:8px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.025);color:var(--text);text-align:left}.mascot-grid>button:hover,.mascot-grid>button.selected{border-color:color-mix(in srgb,var(--primary) 62%,transparent);background:rgba(57,130,255,.08)}.mascot-grid>button.occupied:not(.selected){opacity:.62}.mascot-grid span{min-width:0}.mascot-grid b,.mascot-grid small,.mascot-grid em{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mascot-grid b{font-size:10px}.mascot-grid small{margin-top:3px;color:var(--muted);font-size:8px}.mascot-grid em{margin-top:4px;color:#67dfa4;font-size:7px;font-style:normal}.mascot-grid .occupied em{color:#ffbf67}.studio-actions{display:flex;justify-content:flex-end;gap:7px;flex-wrap:wrap}.mascot-loading{min-height:180px;display:grid;place-items:center;align-content:center;gap:8px;color:var(--muted)}
@media(max-width:780px){.mascot-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.mascot-hero{grid-template-columns:1fr;text-align:center}.mascot-hero>:first-child{margin:auto}.mascot-status{justify-content:center}}@media(max-width:480px){.mascot-grid{grid-template-columns:1fr}.studio-actions>*{flex:1 1 100%}}
</style>
