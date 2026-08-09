<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { CheckCircle2, Database, Globe2, Save, Search, Sparkles, Trash2, UserRound, UsersRound } from '@lucide/vue'
import { api } from '../../services/api'
import { uiStore } from '../../stores/ui'
import PageHeader from '../../components/PageHeader.vue'
import LoadingBlock from '../../components/LoadingBlock.vue'
import EmptyState from '../../components/EmptyState.vue'
import EntityAvatar from '../../components/EntityAvatar.vue'

const loading = ref(true)
const busy = ref(false)
const rows = ref([])
const search = ref('')
const filter = ref('ALL')
const selected = ref(null)
const form = ref(emptyForm())
const countryQuery = ref('')
const countryOptions = ref([])
const searchingCountries = ref(false)
const flagFailed = ref(false)
let countryTimer = null
let suspendDraft = false

function emptyForm() {
  return {
    player_id: '', full_name: '', photo_url: '', current_club_name: '',
    country_catalog_id: '', country_name: '', country_code: '', flag_url: '',
    flag_emoji: '🌍', catalog_name_vi: '', catalog_name_en: '',
    confederation: 'OTHER', world_seed_rank: ''
  }
}

function draftKey(playerId) { return `frm_world_cup_national_profile_draft_${playerId}` }
function flag(row) { return row?.flag_url || '' }

const assignedCount = computed(() => rows.value.filter((row) => row.country_name && row.country_code).length)
const missingCount = computed(() => rows.value.length - assignedCount.value)
const countryCounts = computed(() => {
  const counts = new Map()
  rows.value.forEach((row) => {
    const key = String(row.country_code || row.country_name || '').trim().toLowerCase()
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  })
  return counts
})
const duplicateCountryCount = computed(() => [...countryCounts.value.values()].filter((count) => count > 1).length)
const filteredRows = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    const hasProfile = Boolean(row.country_name && row.country_code)
    if (filter.value === 'ASSIGNED' && !hasProfile) return false
    if (filter.value === 'MISSING' && hasProfile) return false
    if (!needle) return true
    return [row.full_name, row.country_name, row.catalog_name_en, row.country_code, row.current_club_name]
      .some((value) => String(value || '').toLowerCase().includes(needle))
  })
})

async function load() {
  loading.value = true
  try {
    rows.value = (await api.get('/world-cup/national-profiles')).data
    if (selected.value) {
      const refreshed = rows.value.find((row) => Number(row.player_id) === Number(selected.value.player_id))
      if (refreshed) selectPlayer(refreshed, false)
    }
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { loading.value = false }
}

function selectPlayer(row, allowDraft = true) {
  selected.value = row
  suspendDraft = true
  flagFailed.value = false
  countryOptions.value = []
  const base = {
    player_id: Number(row.player_id), full_name: row.full_name,
    photo_url: row.photo_url || '', current_club_name: row.current_club_name || '',
    country_catalog_id: row.country_catalog_id || '', country_name: row.country_name || '',
    country_code: row.country_code || '', flag_url: row.flag_url || '', flag_emoji: row.flag_emoji || '🌍',
    catalog_name_vi: row.catalog_name_vi || row.country_name || '', catalog_name_en: row.catalog_name_en || '',
    confederation: row.confederation || 'OTHER', world_seed_rank: row.world_seed_rank || ''
  }
  if (allowDraft) {
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey(row.player_id)) || 'null')
      form.value = stored ? { ...base, ...stored, player_id: Number(row.player_id), full_name: row.full_name } : base
      if (stored) uiStore.notify(`Đã khôi phục phần nhập chưa lưu của ${row.full_name}.`, 'warning')
    } catch { form.value = base }
  } else form.value = base
  countryQuery.value = form.value.country_catalog_id
    ? [form.value.catalog_name_vi || form.value.country_name, form.value.catalog_name_en].filter(Boolean).join(' / ')
    : ''
  window.setTimeout(() => { suspendDraft = false }, 0)
}

watch(form, (value) => {
  if (suspendDraft || !value.player_id) return
  localStorage.setItem(draftKey(value.player_id), JSON.stringify({
    country_catalog_id: value.country_catalog_id,
    country_name: value.country_name, country_code: value.country_code,
    flag_url: value.flag_url, flag_emoji: value.flag_emoji,
    catalog_name_vi: value.catalog_name_vi, catalog_name_en: value.catalog_name_en,
    confederation: value.confederation, world_seed_rank: value.world_seed_rank
  }))
}, { deep: true })

function scheduleCountrySearch() {
  clearTimeout(countryTimer)
  form.value.country_catalog_id = ''
  if (countryQuery.value.trim().length < 2) {
    countryOptions.value = []
    return
  }
  countryTimer = window.setTimeout(searchCountries, 260)
}

async function searchCountries() {
  searchingCountries.value = true
  try {
    countryOptions.value = (await api.get('/world-cup/countries/search', { q: countryQuery.value.trim(), limit: 12 })).data
  } catch (error) {
    countryOptions.value = []
    uiStore.notify(error.message, 'error')
  } finally { searchingCountries.value = false }
}

function chooseCountry(country) {
  flagFailed.value = false
  form.value.country_catalog_id = Number(country.id)
  form.value.country_name = country.name_vi
  form.value.country_code = country.fifa_code
  form.value.flag_url = country.flag_url
  form.value.flag_emoji = country.flag_emoji || '🌍'
  form.value.catalog_name_vi = country.name_vi
  form.value.catalog_name_en = country.name_en
  form.value.confederation = country.confederation
  countryQuery.value = `${country.name_vi} / ${country.name_en}`
  countryOptions.value = []
}

async function saveProfile() {
  if (!form.value.player_id) return
  if (!form.value.country_catalog_id) return uiStore.notify('Hãy nhập tên quốc gia và chọn đúng kết quả gợi ý.', 'error')
  busy.value = true
  try {
    const response = await api.put(`/world-cup/national-profiles/${form.value.player_id}`, {
      country_catalog_id: form.value.country_catalog_id,
      world_seed_rank: form.value.world_seed_rank || null
    })
    const index = rows.value.findIndex((row) => Number(row.player_id) === Number(form.value.player_id))
    if (index >= 0) rows.value.splice(index, 1, response.data)
    localStorage.removeItem(draftKey(form.value.player_id))
    selectPlayer(response.data, false)
    uiStore.notify(`Đã lưu cố định: ${response.data.full_name} ↔ ${response.data.country_name}.`)
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { busy.value = false }
}

async function deleteProfile() {
  if (!selected.value?.country_name) return
  if (!window.confirm(`Xóa liên kết ${selected.value.full_name} ↔ ${selected.value.country_name}? Dữ liệu World Cup cũ vẫn được giữ.`)) return
  busy.value = true
  try {
    await api.delete(`/world-cup/national-profiles/${selected.value.player_id}`)
    localStorage.removeItem(draftKey(selected.value.player_id))
    await load()
    const refreshed = rows.value.find((row) => Number(row.player_id) === Number(selected.value.player_id))
    if (refreshed) selectPlayer(refreshed, false)
    uiStore.notify('Đã xóa hồ sơ quốc gia cố định.')
  } catch (error) { uiStore.notify(error.message, 'error') }
  finally { busy.value = false }
}

function duplicateLabel(row) {
  const key = String(row.country_code || row.country_name || '').trim().toLowerCase()
  const count = countryCounts.value.get(key) || 0
  return count > 1 ? `${count} cầu thủ cùng quốc gia` : ''
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader
      eyebrow="World Cup Country Intelligence"
      title="Thư viện quốc gia & cờ tự động"
      description="Chỉ nhập tên nước bằng tiếng Việt hoặc tiếng Anh. Hệ thống tự nhận mã quốc gia, liên đoàn và cờ chuẩn; một quốc gia vẫn có thể gắn với nhiều cầu thủ để FIFA chọn đại diện cho từng kỳ World Cup."
    >
      <div class="save-state"><Database :size="17"/><span>Danh mục quốc gia lưu trong MySQL · cờ tự nhận tự động</span></div>
    </PageHeader>

    <section class="stat-grid">
      <article class="glass stat-card"><Globe2/><div><b>{{ assignedCount }}</b><span>Đã gán quốc gia</span></div></article>
      <article class="glass stat-card"><UserRound/><div><b>{{ missingCount }}</b><span>Chưa gán</span></div></article>
      <article class="glass stat-card"><UsersRound/><div><b>{{ duplicateCountryCount }}</b><span>Quốc gia có nhiều đại diện</span></div></article>
    </section>

    <LoadingBlock v-if="loading"/>
    <section v-else class="library-grid">
      <article class="glass card player-library">
        <div class="toolbar">
          <div class="search-box"><Search :size="17"/><input v-model="search" placeholder="Tìm cầu thủ, quốc gia, mã nước hoặc CLB..."/></div>
          <select v-model="filter" class="select">
            <option value="ALL">Tất cả cầu thủ</option>
            <option value="ASSIGNED">Đã có quốc gia</option>
            <option value="MISSING">Chưa có quốc gia</option>
          </select>
        </div>
        <EmptyState v-if="!filteredRows.length" message="Không tìm thấy cầu thủ phù hợp."/>
        <div v-else class="player-list">
          <button v-for="row in filteredRows" :key="row.player_id" :class="{active:Number(selected?.player_id)===Number(row.player_id)}" @click="selectPlayer(row)">
            <EntityAvatar :src="row.photo_url" :name="row.full_name" :size="43" round/>
            <span class="player-info">
              <b>{{ row.full_name }}</b><small>{{ row.current_club_name || 'Cầu thủ tự do' }}</small>
              <em v-if="row.country_name">{{ row.flag_emoji || '🌍' }} {{ row.country_name }} · {{ row.country_code }}</em>
              <em v-else class="missing">Chưa gán quốc gia</em>
            </span>
            <span v-if="duplicateLabel(row)" class="duplicate-badge">{{ duplicateLabel(row) }}</span>
            <CheckCircle2 v-else-if="row.country_name" class="saved-icon" :size="18"/>
          </button>
        </div>
      </article>

      <article class="glass card editor-card">
        <template v-if="selected">
          <div class="editor-head">
            <div class="country-preview">
              <div class="flag-frame">
                <img v-if="flag(form) && !flagFailed" :src="flag(form)" @error="flagFailed=true"/>
                <span v-else>{{ form.flag_emoji || '🌍' }}</span>
              </div>
              <div><small>Quốc gia cố định</small><b>{{ form.catalog_name_vi || form.country_name || 'Chưa chọn' }}</b><em>{{ form.catalog_name_en }}</em></div>
            </div>
            <EntityAvatar :src="form.photo_url" :name="form.full_name" :size="58" round/>
          </div>
          <div class="selected-player"><span class="eyebrow">Cầu thủ đại diện</span><h2>{{ form.full_name }}</h2><p>{{ form.current_club_name || 'Cầu thủ tự do' }}</p></div>

          <form class="profile-form" @submit.prevent="saveProfile">
            <label class="full country-picker">
              <span class="label">Nhập quốc gia bằng tiếng Việt hoặc English</span>
              <div class="country-input"><Search :size="17"/><input v-model="countryQuery" class="input" autocomplete="off" placeholder="Ví dụ: Việt Nam, Vietnam, Brazil, Nhật Bản..." @input="scheduleCountrySearch"/></div>
              <div v-if="searchingCountries" class="search-status"><Sparkles :size="14"/>Đang nhận diện quốc gia...</div>
              <div v-else-if="countryOptions.length" class="country-results">
                <button v-for="country in countryOptions" :key="country.id" type="button" @click="chooseCountry(country)">
                  <span class="mini-flag"><img :src="country.flag_url"/><em>{{ country.flag_emoji || '🌍' }}</em></span>
                  <span><b>{{ country.name_vi }}</b><small>{{ country.name_en }}</small></span>
                  <strong>{{ country.fifa_code }}</strong><i>{{ country.confederation }}</i>
                </button>
              </div>
            </label>

            <div class="auto-info full" :class="{empty:!form.country_catalog_id}">
              <div><span>Mã thi đấu</span><b>{{ form.country_code || '—' }}</b></div>
              <div><span>Liên đoàn</span><b>{{ form.confederation || '—' }}</b></div>
              <div><span>Nguồn cờ</span><b>{{ form.country_catalog_id ? 'Tự động chuẩn hóa' : 'Chưa chọn' }}</b></div>
            </div>
            <label class="full"><span class="label">Hạng hạt giống thế giới</span><input v-model.number="form.world_seed_rank" type="number" min="1" max="999" class="input" placeholder="Có thể để trống; dùng khi bốc thăm 4 nhóm hạt giống"/></label>
            <div class="draft-note full"><Database :size="18"/><span>Hồ sơ lưu theo từng cầu thủ. Nhiều cầu thủ được phép cùng quốc gia; khi đưa vào một kỳ World Cup, FIFA chọn đúng một người đại diện quốc gia đó.</span></div>
            <div class="actions full">
              <button v-if="selected.country_name" type="button" class="btn btn-danger" :disabled="busy" @click="deleteProfile"><Trash2 :size="16"/>Xóa liên kết</button>
              <button class="btn btn-primary" :disabled="busy || !form.country_catalog_id"><Save :size="17"/>{{ busy ? 'Đang lưu...' : 'Lưu hồ sơ quốc gia' }}</button>
            </div>
          </form>
        </template>
        <EmptyState v-else message="Chọn một cầu thủ để gắn quốc gia."/>
      </article>
    </section>
  </div>
</template>

<style scoped>
.save-state{display:flex;align-items:center;gap:8px;padding:10px 13px;border:1px solid rgba(68,220,148,.25);border-radius:12px;background:rgba(68,220,148,.07);color:#70e3a9;font-size:12px;font-weight:800}.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.stat-card{display:flex;align-items:center;gap:13px;padding:16px;border:1px solid var(--line);border-radius:15px}.stat-card svg{color:#ffe277}.stat-card b,.stat-card span{display:block}.stat-card b{font:900 27px Manrope}.stat-card span{color:var(--muted);font-size:11px}.library-grid{display:grid;grid-template-columns:minmax(420px,1.05fr) minmax(390px,.95fr);gap:18px}.player-library,.editor-card{padding:16px;min-width:0}.toolbar{display:grid;grid-template-columns:1fr 190px;gap:10px;margin-bottom:13px}.search-box{height:43px;display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid var(--line);border-radius:11px}.search-box input{width:100%;border:0;outline:0;background:transparent;color:var(--text)}.player-list{display:grid;gap:7px;max-height:680px;overflow:auto;padding-right:4px}.player-list>button{width:100%;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:11px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.02);color:var(--text);text-align:left}.player-list>button:hover,.player-list>button.active{border-color:rgba(78,135,255,.55);background:rgba(78,135,255,.09)}.player-info{min-width:0}.player-info b,.player-info small,.player-info em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.player-info small{color:var(--muted);font-size:10px;margin:3px 0}.player-info em{font-style:normal;color:#ffe277;font-size:10px}.player-info em.missing{color:#ff9e89}.duplicate-badge{padding:5px 7px;border-radius:8px;background:rgba(255,200,87,.09);color:#ffd66f;font-size:9px}.saved-icon{color:#65dfa1}.editor-card{align-self:start;position:sticky;top:100px;background:radial-gradient(circle at 0 0,rgba(255,215,95,.1),transparent 30%),var(--glass)}.editor-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid var(--line)}.country-preview{display:flex;align-items:center;gap:11px}.flag-frame{width:78px;height:52px;display:grid;place-items:center;overflow:hidden;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:#09152b;box-shadow:0 8px 25px rgba(0,0,0,.22)}.flag-frame img{width:100%;height:100%;object-fit:cover}.flag-frame span{font-size:31px}.country-preview small,.country-preview b,.country-preview em{display:block}.country-preview small{color:var(--muted);font-size:9px;text-transform:uppercase}.country-preview b{margin-top:4px}.country-preview em{margin-top:2px;color:var(--muted);font-size:10px;font-style:normal}.selected-player{padding:17px 0 12px}.selected-player h2{margin:5px 0}.selected-player p{margin:0;color:var(--muted)}.profile-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.profile-form .full{grid-column:1/-1}.country-picker{position:relative}.country-input{display:flex;align-items:center;gap:8px;padding-left:12px;border:1px solid rgba(94,139,255,.38);border-radius:12px;background:rgba(10,23,48,.8)}.country-input .input{border:0;background:transparent}.search-status{display:flex;align-items:center;gap:7px;margin-top:7px;color:#ffe27a;font-size:10px}.country-results{position:absolute;z-index:20;left:0;right:0;top:76px;max-height:330px;overflow:auto;padding:7px;border:1px solid rgba(91,134,255,.38);border-radius:13px;background:#0a1730;box-shadow:0 22px 60px rgba(0,0,0,.5)}.country-results button{width:100%;display:grid;grid-template-columns:46px minmax(0,1fr) auto auto;align-items:center;gap:9px;padding:9px;border:0;border-radius:10px;background:transparent;color:var(--text);text-align:left}.country-results button:hover{background:rgba(91,134,255,.13)}.mini-flag{width:43px;height:29px;display:grid;place-items:center;overflow:hidden;border-radius:6px;background:#12203c}.mini-flag img{grid-area:1/1;width:100%;height:100%;object-fit:cover}.mini-flag em{grid-area:1/1;font-style:normal}.country-results b,.country-results small{display:block}.country-results small{margin-top:2px;color:var(--muted);font-size:9px}.country-results strong{color:#ffe27a}.country-results i{padding:4px 6px;border-radius:7px;background:rgba(83,223,154,.08);color:#68dfa4;font-size:8px;font-style:normal}.auto-info{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.auto-info>div{padding:11px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.025)}.auto-info span,.auto-info b{display:block}.auto-info span{color:var(--muted);font-size:8px;text-transform:uppercase;letter-spacing:.08em}.auto-info b{margin-top:5px;font-size:11px}.auto-info.empty{opacity:.55}.draft-note{display:flex;align-items:flex-start;gap:9px;padding:12px;border:1px solid rgba(255,215,99,.22);border-radius:11px;background:rgba(255,215,99,.055);font-size:11px;color:var(--muted);line-height:1.5}.draft-note svg{flex:0 0 auto;color:#ffe277}.actions{display:flex;justify-content:flex-end;gap:9px}.actions .btn-danger{margin-right:auto}@media(max-width:1050px){.library-grid{grid-template-columns:1fr}.editor-card{position:static}.player-list{max-height:450px}}@media(max-width:680px){.stat-grid,.auto-info{grid-template-columns:1fr}.toolbar,.profile-form{grid-template-columns:1fr}.profile-form .full{grid-column:auto}.player-list>button{grid-template-columns:auto minmax(0,1fr)}.duplicate-badge,.saved-icon{grid-column:2}.actions{flex-direction:column}.actions .btn{width:100%}.country-results button{grid-template-columns:42px minmax(0,1fr) auto}.country-results i{display:none}}
</style>
