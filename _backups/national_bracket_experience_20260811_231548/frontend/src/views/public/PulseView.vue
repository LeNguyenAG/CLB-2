<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  Activity, ArrowRight, Award, CalendarClock, CircleDollarSign, Crown,
  Goal, RefreshCw, Radio, Shield, Sparkles, Star, TrendingUp, Trophy, Zap
} from '@lucide/vue'
import { api } from '../../services/api'
import { date, money, number } from '../../utils'
import LoadingBlock from '../../components/LoadingBlock.vue'
import EntityAvatar from '../../components/EntityAvatar.vue'

const loading = ref(true)
const refreshing = ref(false)
const errorMessage = ref('')
const activeFilter = ref('ALL')
const payload = ref({ events: [], upcomingMatches: [], records: [], formTable: [], valueMovers: [], totals: {} })
let timer

const filters = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'MATCH', label: 'Trận đấu' },
  { key: 'TRANSFER', label: 'Chuyển nhượng' },
  { key: 'AWARD', label: 'Danh hiệu' },
  { key: 'CHAMPION', label: 'Vô địch' },
  { key: 'UPSET', label: 'Địa chấn' },
]

const filteredEvents = computed(() => activeFilter.value === 'ALL'
  ? payload.value.events
  : payload.value.events.filter((item) => item.type === activeFilter.value))

const lastUpdated = computed(() => payload.value.generatedAt ? date(payload.value.generatedAt, true) : '—')

async function load({ silent = false } = {}) {
  if (silent) refreshing.value = true
  else loading.value = true
  try {
    errorMessage.value = ''
    payload.value = (await api.get('/public/pulse', null, { auth: false })).data
  } catch (error) {
    errorMessage.value = error?.message || 'Không thể tải Nhịp đập bóng đá.'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function eventIcon(type) {
  return ({
    MATCH: Goal,
    UPSET: Zap,
    TRANSFER: TrendingUp,
    AWARD: Award,
    CHAMPION: Crown,
  })[type] || Activity
}

function recordIcon(key) {
  return ({
    TOP_SCORER: Goal,
    TOP_ASSIST: Star,
    MOST_DECORATED: Award,
    MOST_VALUABLE: TrendingUp,
    RICHEST_PLAYER: CircleDollarSign,
    TOP_CLUB: Trophy,
  })[key] || Sparkles
}

function recordName(item) {
  return item.full_name || item.club_name || 'Đang cập nhật'
}

function recordImage(item) {
  return item.photo_url || item.logo_url
}

function recordLink(item) {
  return item.entity_type === 'CLUB' ? `/clubs/${item.club_id}` : `/players/${item.player_id}`
}

function recordValue(item) {
  if (item.unit === 'VND') return money(item.total_value, true)
  return `${number(item.total_value, 0)} ${item.unit}`
}

function eventTime(value) {
  if (!value) return 'Vừa cập nhật'
  const ms = Date.now() - new Date(String(value).replace(' ', 'T')).getTime()
  if (!Number.isFinite(ms) || ms < 0) return date(value, true)
  const minute = Math.floor(ms / 60000)
  if (minute < 1) return 'Vừa xong'
  if (minute < 60) return `${minute} phút trước`
  const hour = Math.floor(minute / 60)
  if (hour < 24) return `${hour} giờ trước`
  const day = Math.floor(hour / 24)
  if (day < 7) return `${day} ngày trước`
  return date(value)
}

function formLabel(value) {
  return value === 'W' ? 'T' : value === 'D' ? 'H' : 'B'
}

onMounted(() => {
  load()
  timer = window.setInterval(() => load({ silent: true }), 45000)
})
onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <div class="pulse-page">
    <section class="pulse-hero">
      <div class="pulse-grid"></div>
      <div class="pulse-orb orb-a"></div>
      <div class="pulse-orb orb-b"></div>
      <div class="container pulse-hero-inner">
        <div class="pulse-copy">
          <span class="live-label"><span class="pulse-dot"></span> LIVE DATA · TỰ ĐỘNG LÀM MỚI</span>
          <h1>Nhịp đập<br><span>bóng đá.</span></h1>
          <p>Tin nóng, phong độ, kỷ lục và chuyển động của toàn bộ hệ thống được tổng hợp trực tiếp từ dữ liệu giải đấu.</p>
          <div class="hero-actions">
            <button class="btn btn-primary" :disabled="refreshing" @click="load({ silent: true })">
              <RefreshCw :size="17" :class="{ spinning: refreshing }"/> Làm mới
            </button>
            <span class="updated">Cập nhật: {{ lastUpdated }}</span>
          </div>
        </div>
        <div class="pulse-radar glass">
          <div class="radar-ring ring-one"></div>
          <div class="radar-ring ring-two"></div>
          <div class="radar-ring ring-three"></div>
          <div class="radar-line"></div>
          <div class="radar-core"><Radio :size="42"/><b>FOOTBALL<br>PULSE</b></div>
          <span class="radar-dot d1"></span><span class="radar-dot d2"></span><span class="radar-dot d3"></span>
        </div>
      </div>
    </section>

    <div class="container page">
      <LoadingBlock v-if="loading"/>
      <div v-else-if="errorMessage" class="glass card pulse-error"><Radio :size="30"/><div><h3>Chưa thể tải dữ liệu trực tiếp</h3><p>{{ errorMessage }}</p></div><button class="btn btn-primary" @click="load()">Thử lại</button></div>
      <template v-else>
        <section class="pulse-stats">
          <article class="glass stat-card"><Goal :size="20"/><div class="stat-value">{{ number(payload.totals.total_goals, 0) }}</div><div class="stat-label">Bàn thắng đã ghi</div></article>
          <article class="glass stat-card"><Shield :size="20"/><div class="stat-value">{{ number(payload.totals.finished_matches, 0) }}</div><div class="stat-label">Trận đã hoàn tất</div></article>
          <article class="glass stat-card"><TrendingUp :size="20"/><div class="stat-value">{{ number(payload.totals.completed_transfers, 0) }}</div><div class="stat-label">Thương vụ hoàn tất</div></article>
          <article class="glass stat-card"><Award :size="20"/><div class="stat-value">{{ number(payload.totals.player_awards, 0) }}</div><div class="stat-label">Danh hiệu cầu thủ</div></article>
        </section>

        <section class="section-title section-gap">
          <div><span class="eyebrow"><Sparkles :size="15"/> Kỷ lục sống</span><h2>Những cái tên làm nên lịch sử</h2></div>
        </section>
        <div class="records-grid">
          <RouterLink v-for="item in payload.records" :key="item.key" :to="recordLink(item)" class="glass record-card card-hover">
            <div class="record-glow"></div>
            <div class="record-head"><component :is="recordIcon(item.key)" :size="20"/><span>{{ item.label }}</span></div>
            <EntityAvatar :src="recordImage(item)" :name="recordName(item)" :size="58" :round="item.entity_type === 'PLAYER'"/>
            <h3>{{ recordName(item) }}</h3>
            <p>{{ item.club_name && item.entity_type === 'PLAYER' ? item.club_name : 'Kỷ lục toàn hệ thống' }}</p>
            <strong>{{ recordValue(item) }}</strong>
            <ArrowRight class="record-arrow" :size="18"/>
          </RouterLink>
        </div>

        <div class="pulse-columns section-gap">
          <section class="glass card feed-panel">
            <div class="panel-title">
              <div><span class="eyebrow"><Activity :size="15"/> Tin tự động</span><h2>Dòng sự kiện</h2></div>
              <span class="badge green"><span class="pulse-dot"></span> Trực tiếp</span>
            </div>
            <div class="event-filters">
              <button v-for="filter in filters" :key="filter.key" class="filter-chip" :class="{ active: activeFilter === filter.key }" @click="activeFilter = filter.key">{{ filter.label }}</button>
            </div>
            <div v-if="filteredEvents.length" class="event-feed">
              <RouterLink v-for="item in filteredEvents" :key="item.id" :to="item.link" class="event-row" :class="`accent-${item.accent}`">
                <div class="event-icon"><component :is="eventIcon(item.type)" :size="19"/></div>
                <div class="event-copy"><small>{{ item.title }}</small><b>{{ item.description }}</b><span>{{ item.meta }}</span></div>
                <time>{{ eventTime(item.occurred_at) }}</time>
              </RouterLink>
            </div>
            <div v-else class="empty">Chưa có sự kiện thuộc nhóm này.</div>
          </section>

          <aside class="side-stack">
            <section class="glass card form-panel">
              <div class="panel-title"><div><span class="eyebrow"><Zap :size="15"/> Momentum</span><h2>Phong độ 5 trận</h2></div></div>
              <div class="form-list">
                <RouterLink v-for="(club,index) in payload.formTable" :key="club.club_id" :to="`/clubs/${club.club_id}`" class="form-row">
                  <span class="form-rank">{{ index + 1 }}</span>
                  <EntityAvatar :src="club.logo_url" :name="club.club_name" :size="36"/>
                  <div class="form-name"><b>{{ club.club_name }}</b><small>{{ club.points }} điểm · HS {{ club.goal_difference > 0 ? '+' : '' }}{{ club.goal_difference }}</small></div>
                  <div class="form-dots"><span v-for="(result,i) in club.form" :key="i" :class="`result-${result}`">{{ formLabel(result) }}</span></div>
                </RouterLink>
              </div>
            </section>

            <section class="glass card mover-panel">
              <div class="panel-title"><div><span class="eyebrow"><TrendingUp :size="15"/> Thị trường</span><h2>Biến động giá</h2></div></div>
              <RouterLink v-for="item in payload.valueMovers.slice(0,5)" :key="item.player_id" :to="`/players/${item.player_id}`" class="mover-row">
                <EntityAvatar :src="item.photo_url" :name="item.full_name" :size="36" round/>
                <div><b>{{ item.full_name }}</b><small>{{ item.club_name || 'Tự do' }}</small></div>
                <strong :class="Number(item.value_change) >= 0 ? 'text-green' : 'text-red'">{{ Number(item.value_change) >= 0 ? '+' : '' }}{{ money(item.value_change, true) }}</strong>
              </RouterLink>
            </section>
          </aside>
        </div>

        <section class="section-title section-gap">
          <div><span class="eyebrow"><CalendarClock :size="15"/> Matchday</span><h2>Trận đấu đang chờ</h2></div>
          <RouterLink to="/competitions" class="btn btn-ghost">Tất cả giải đấu <ArrowRight :size="16"/></RouterLink>
        </section>
        <div class="upcoming-grid">
          <RouterLink v-for="match in payload.upcomingMatches" :key="match.id" :to="`/competitions/${match.competition_id}`" class="glass match-card card-hover">
            <div class="match-top"><span class="badge" :class="match.status === 'LIVE' ? 'red' : 'blue'">{{ match.status === 'LIVE' ? 'ĐANG ĐẤU' : 'SẮP DIỄN RA' }}</span><small>{{ match.competition_name }}</small></div>
            <div class="match-teams">
              <div><EntityAvatar :src="match.home_logo" :name="match.home_club_name" :size="46"/><b>{{ match.home_club_name }}</b></div>
              <span>VS</span>
              <div><EntityAvatar :src="match.away_logo" :name="match.away_club_name" :size="46"/><b>{{ match.away_club_name }}</b></div>
            </div>
            <div class="match-time">{{ match.status === 'LIVE' ? 'Trận đấu đang diễn ra' : date(match.scheduled_at, true) }}</div>
          </RouterLink>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pulse-hero{position:relative;overflow:hidden;padding:72px 0 60px;min-height:540px;display:flex;align-items:center}.pulse-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(71,140,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(71,140,255,.06) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(to bottom,black,transparent)}.pulse-orb{position:absolute;border-radius:50%;filter:blur(16px);opacity:.3}.orb-a{width:430px;height:430px;background:#1559ff;left:-240px;top:0}.orb-b{width:390px;height:390px;background:#7c3cff;right:-190px;bottom:-120px}.pulse-hero-inner{position:relative;display:grid;grid-template-columns:1.08fr .92fr;align-items:center;gap:70px}.live-label{display:inline-flex;align-items:center;gap:10px;color:var(--green);font-size:12px;font-weight:800;letter-spacing:.12em}.pulse-copy h1{font-size:clamp(54px,7vw,92px);line-height:.94;margin:20px 0 24px}.pulse-copy h1 span{background:linear-gradient(90deg,#49dcff,#4c82ff,#9b67ff);-webkit-background-clip:text;color:transparent}.pulse-copy p{font-size:17px;max-width:680px}.hero-actions{display:flex;align-items:center;gap:16px;margin-top:28px}.updated{font-size:12px;color:var(--muted)}.spinning{animation:spin .8s linear infinite}.pulse-radar{height:400px;position:relative;display:grid;place-items:center;overflow:hidden;border-radius:50%}.pulse-radar::before{content:'';position:absolute;inset:0;background:conic-gradient(from 0deg,transparent 0 75%,rgba(47,211,255,.2));animation:radar 5s linear infinite}.radar-ring{position:absolute;border:1px solid rgba(74,157,255,.22);border-radius:50%}.ring-one{width:120px;height:120px}.ring-two{width:230px;height:230px}.ring-three{width:340px;height:340px}.radar-line{position:absolute;width:1px;height:90%;background:linear-gradient(transparent,rgba(55,217,255,.5),transparent)}.radar-core{z-index:2;width:128px;height:128px;border-radius:50%;display:grid;place-items:center;text-align:center;color:var(--cyan);background:rgba(4,17,32,.9);box-shadow:0 0 70px rgba(41,216,255,.24)}.radar-core b{font:800 10px/1.35 Manrope;letter-spacing:.16em}.radar-dot{position:absolute;width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 18px var(--green);animation:blink 1.8s infinite}.d1{left:24%;top:31%}.d2{right:21%;bottom:28%;animation-delay:-.7s}.d3{right:34%;top:18%;animation-delay:-1.2s}.pulse-error{display:flex;align-items:center;gap:16px}.pulse-error>svg{color:var(--red)}.pulse-error div{flex:1}.pulse-error h3{margin-bottom:5px}.pulse-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.pulse-stats .stat-card>svg{color:var(--cyan)}.section-gap{margin-top:48px}.records-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.record-card{position:relative;overflow:hidden;padding:20px;min-height:240px}.record-glow{position:absolute;width:170px;height:170px;border-radius:50%;background:radial-gradient(circle,rgba(71,134,255,.22),transparent 68%);right:-55px;top:-70px}.record-head{position:relative;display:flex;align-items:center;gap:8px;color:var(--cyan);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:22px}.record-card h3{font-size:18px;margin:13px 0 4px}.record-card p{font-size:11px}.record-card strong{display:block;color:var(--yellow);font:800 24px Manrope;margin-top:17px}.record-arrow{position:absolute;right:18px;bottom:20px;color:var(--muted)}.pulse-columns{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(330px,.65fr);gap:20px;align-items:start}.panel-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:18px}.panel-title h2{font-size:23px;margin-top:5px}.event-filters{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}.filter-chip{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:7px 11px;font-size:11px;font-weight:750}.filter-chip.active,.filter-chip:hover{color:var(--text);border-color:var(--line-strong);background:rgba(57,130,255,.12)}.event-feed{display:grid}.event-row{position:relative;display:grid;grid-template-columns:44px 1fr auto;align-items:center;gap:12px;padding:14px 5px;border-bottom:1px solid var(--line);transition:.18s}.event-row:last-child{border-bottom:0}.event-row:hover{background:rgba(57,130,255,.05);padding-inline:11px;border-radius:12px}.event-icon{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:rgba(57,130,255,.1);color:#7eb0ff}.accent-yellow .event-icon{color:var(--yellow);background:rgba(255,200,87,.1)}.accent-green .event-icon{color:var(--green);background:rgba(53,221,154,.1)}.accent-red .event-icon{color:var(--red);background:rgba(255,93,115,.1)}.accent-cyan .event-icon{color:var(--cyan);background:rgba(41,216,255,.1)}.event-copy{min-width:0}.event-copy small,.event-copy b,.event-copy span{display:block}.event-copy small{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.event-copy b{font-size:13px;margin:4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.event-copy span{font-size:10px;color:var(--muted)}.event-row time{font-size:10px;color:var(--muted);white-space:nowrap}.side-stack{display:grid;gap:20px}.form-list{display:grid}.form-row{display:grid;grid-template-columns:24px auto 1fr auto;align-items:center;gap:9px;padding:10px 2px;border-bottom:1px solid var(--line)}.form-row:last-child{border-bottom:0}.form-rank{font:800 12px Manrope;color:var(--muted);text-align:center}.form-name{min-width:0}.form-name b,.form-name small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.form-name b{font-size:12px}.form-name small{font-size:9px;color:var(--muted);margin-top:3px}.form-dots{display:flex;gap:3px}.form-dots span{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;font-size:8px;font-weight:800}.result-W{color:#04150f;background:var(--green)}.result-D{color:#2b2100;background:var(--yellow)}.result-L{color:white;background:var(--red)}.mover-row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:10px 2px;border-bottom:1px solid var(--line)}.mover-row:last-child{border-bottom:0}.mover-row b,.mover-row small{display:block}.mover-row b{font-size:12px}.mover-row small{font-size:9px;color:var(--muted);margin-top:3px}.mover-row strong{font-size:11px}.upcoming-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.match-card{padding:18px}.match-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.match-top small{color:var(--muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.match-teams{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin:22px 0}.match-teams>div{display:grid;justify-items:center;text-align:center;gap:8px;min-width:0}.match-teams b{font-size:11px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.match-teams>span{font:800 12px Manrope;color:var(--muted)}.match-time{text-align:center;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:10px}@keyframes radar{to{transform:rotate(360deg)}}@keyframes blink{50%{opacity:.25;transform:scale(.7)}}@media(max-width:1100px){.pulse-hero-inner{grid-template-columns:1fr}.pulse-radar{height:330px;max-width:500px;width:100%;margin:auto}.pulse-columns{grid-template-columns:1fr}.records-grid,.upcoming-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){.pulse-hero{padding:46px 0}.pulse-copy h1{font-size:54px}.pulse-radar{height:280px}.ring-three{width:245px;height:245px}.ring-two{width:170px;height:170px}.pulse-stats,.records-grid,.upcoming-grid{grid-template-columns:1fr}.event-row{grid-template-columns:42px 1fr}.event-row time{grid-column:2}.form-dots{display:none}}
</style>
