<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Award, BadgeDollarSign, Check, ChevronRight, Coins, Gift, Megaphone, PackageOpen, RefreshCw, Shirt, Sparkles, Star, Store, Ticket, TrendingUp, Users, WalletCards, X } from '@lucide/vue'
import { api } from '../../services/api'
import { authStore } from '../../stores/auth'
import { uiStore } from '../../stores/ui'
import { money, number, date } from '../../utils'
import PageHeader from '../../components/PageHeader.vue'
import EntityAvatar from '../../components/EntityAvatar.vue'
import LoadingBlock from '../../components/LoadingBlock.vue'
import EmptyState from '../../components/EmptyState.vue'
import BaseModal from '../../components/BaseModal.vue'

const isAdmin = computed(() => authStore.isAdmin.value)
const loading = ref(true), busy = ref(false), tab = ref('overview'), payload = ref(null), clubs = ref([]), seasons = ref([])
const selectedClubId = ref(isAdmin.value ? '' : authStore.user.value?.clubId || '')
const modal = ref(''), eventCycle = ref(new Date().toISOString().slice(0,10))
const merchForm = ref({ product_type:'HOME_SHIRT', player_id:'', units_planned:1000, unit_price:500000, unit_cost:210000, campaign_name:'' })
const grantSeasonId = ref(''), grantPreview = ref(null)
const summary = computed(() => payload.value?.summary || {})
const pendingEvents = computed(() => (payload.value?.events || []).filter(item => item.status === 'OFFERED'))
const settledRevenue = computed(() => Number(summary.value.event_revenue || 0) + Number(summary.value.merchandise_revenue || 0) - Number(summary.value.event_cost || 0))
const chosenClub = computed(() => clubs.value.find(c => Number(c.id) === Number(selectedClubId.value)))

function queryClub() { return selectedClubId.value ? { club_id:selectedClubId.value } : {} }
async function bootstrap(){
  loading.value=true
  try{
    const tasks=[api.get('/seasons')]
    if(isAdmin.value) tasks.push(api.get('/clubs',{limit:200}))
    const results=await Promise.all(tasks)
    seasons.value=results[0].data
    if(isAdmin.value){clubs.value=results[1].data;selectedClubId.value=selectedClubId.value||clubs.value[0]?.id||''}
    grantSeasonId.value=seasons.value.find(s=>s.status==='ACTIVE')?.id||seasons.value[0]?.id||''
    if(selectedClubId.value)await load()
  }catch(error){uiStore.notify(error.message,'error')}finally{loading.value=false}
}
async function load(){
  if(!selectedClubId.value)return
  try{payload.value=(await api.get('/influence/summary',queryClub())).data}
  catch(error){uiStore.notify(error.message,'error')}
}
async function recalculate(all=false){busy.value=true;try{const body=isAdmin.value&&!all&&selectedClubId.value?{club_id:selectedClubId.value}:{};const result=await api.post('/influence/recalculate',body);uiStore.notify(result.data?.message||'Đã tính lại sức ảnh hưởng.');await load()}catch(error){uiStore.notify(error.message,'error')}finally{busy.value=false}}
async function randomEvents(){busy.value=true;try{const body={cycle_key:eventCycle.value,...(isAdmin.value?{club_id:selectedClubId.value}:{})};const result=await api.post('/influence/events/random',body);uiStore.notify(result.data?.message||'Đã mô phỏng sự kiện.');await load()}catch(error){uiStore.notify(error.message,'error')}finally{busy.value=false}}
async function decideEvent(item,status){busy.value=true;try{await api.patch(`/influence/events/${item.id}/status`,{status});uiStore.notify(status==='ACCEPTED'?'Đã chấp nhận sự kiện.':'Đã từ chối sự kiện.');await load()}catch(error){uiStore.notify(error.message,'error')}finally{busy.value=false}}
function openMerch(){merchForm.value={product_type:'HOME_SHIRT',player_id:'',units_planned:1000,unit_price:500000,unit_cost:210000,campaign_name:'',...(isAdmin.value?{club_id:selectedClubId.value}:{})};modal.value='merch'}
async function simulateMerch(){busy.value=true;try{const result=await api.post('/influence/merchandise/simulate',merchForm.value);uiStore.notify(`Đã mô phỏng: lợi nhuận dự kiến ${money(result.data.net_revenue)}.`);modal.value='';await load()}catch(error){uiStore.notify(error.message,'error')}finally{busy.value=false}}
async function settleCampaign(item){if(!window.confirm(`Chốt chiến dịch “${item.campaign_name}” và cộng lợi nhuận vào ví CLB?`))return;busy.value=true;try{await api.post(`/influence/merchandise/${item.id}/settle`,{});uiStore.notify('Đã chốt doanh thu vật phẩm.');await load()}catch(error){uiStore.notify(error.message,'error')}finally{busy.value=false}}
async function previewGrants(){if(!grantSeasonId.value)return;busy.value=true;try{grantPreview.value=(await api.get('/influence/grants/preview',{season_id:grantSeasonId.value})).data}catch(error){uiStore.notify(error.message,'error')}finally{busy.value=false}}
async function finalizeGrants(){if(!grantPreview.value||!window.confirm(`Chi ${money(grantPreview.value.total_amount)} từ ví FIFA cho các CLB và cầu thủ có sức ảnh hưởng?`))return;busy.value=true;try{const result=await api.post('/influence/grants/finalize',{season_id:grantSeasonId.value});uiStore.notify(result.data?.message||'Đã chi thưởng sức ảnh hưởng.');await Promise.all([previewGrants(),load()])}catch(error){uiStore.notify(error.message,'error')}finally{busy.value=false}}
watch(selectedClubId,load)
onMounted(bootstrap)
</script>

<template>
  <div>
    <PageHeader eyebrow="Influence Economy" title="Sức ảnh hưởng & kinh tế người hâm mộ" description="Danh tiếng, cộng đồng người hâm mộ, sự kiện thương mại, vật phẩm có chữ ký và thưởng ảnh hưởng từ FIFA.">
      <select v-if="isAdmin" v-model="selectedClubId" class="select club-picker"><option v-for="club in clubs" :key="club.id" :value="club.id">{{ club.name }}</option></select>
      <button v-if="isAdmin" class="btn" :disabled="busy" @click="recalculate(true)"><RefreshCw :size="16"/>Tính toàn hệ thống</button><button class="btn" :disabled="busy||!selectedClubId" @click="recalculate(false)"><RefreshCw :size="16"/>Tính lại CLB</button>
    </PageHeader>
    <LoadingBlock v-if="loading"/>
    <template v-else-if="payload">
      <div class="influence-hero glass">
        <div class="hero-club"><EntityAvatar :src="summary.logo_url||chosenClub?.logo_url" :name="summary.club_name||chosenClub?.name" :size="74"/><div><span class="eyebrow"><Sparkles :size="14"/> Brand Power</span><h2>{{ summary.club_name||chosenClub?.name }}</h2><p>Danh tiếng càng cao thì tỷ lệ lấp đầy sân, giá trị tài trợ, doanh thu vật phẩm và tần suất sự kiện tích cực càng lớn.</p></div></div>
        <div class="reputation-orbit"><span>{{ number(summary.reputation_score,1) }}</span><small>Danh tiếng</small></div>
      </div>

      <div class="influence-stats">
        <article><Users/><span>Người hâm mộ</span><b>{{ number(summary.fan_count,0) }}</b><small>{{ number(summary.social_followers,0) }} theo dõi trực tuyến</small></article>
        <article><Megaphone/><span>Truyền thông</span><b>{{ number(summary.media_score,1) }}/100</b><small>Khả năng phủ sóng</small></article>
        <article><Store/><span>Thương mại</span><b>{{ number(summary.commercial_score,1) }}/100</b><small>Khả năng hút tài trợ</small></article>
        <article><TrendingUp/><span>Động lượng</span><b>{{ number(summary.momentum_score,1) }}/100</b><small>Phong độ & xu hướng</small></article>
        <article><WalletCards/><span>Ví CLB</span><b>{{ money(summary.wallet_balance,true) }}</b><small>{{ summary.wallet_status }}</small></article>
        <article><Coins/><span>Thu nhập bổ sung</span><b>{{ money(settledRevenue,true) }}</b><small>Sự kiện + vật phẩm − chi phí</small></article>
      </div>

      <div class="influence-tabs glass">
        <button v-for="item in [['overview','Tổng quan',Star],['events','Sự kiện ngẫu nhiên',Gift],['merch','Vật phẩm & chữ ký',Shirt],...(isAdmin?[['grants','Thưởng FIFA',Award]]:[])]" :key="item[0]" :class="{active:tab===item[0]}" @click="tab=item[0]"><component :is="item[2]" :size="17"/>{{ item[1] }}</button>
      </div>

      <section v-if="tab==='overview'" class="overview-layout">
        <article class="glass card">
          <div class="section-title"><div><span class="eyebrow"><Star :size="14"/> Star power</span><h2>Cầu thủ có sức ảnh hưởng</h2></div></div>
          <EmptyState v-if="!payload.players?.length" title="Chưa có dữ liệu cầu thủ"/>
          <div v-else class="star-list">
            <div v-for="player in payload.players.slice(0,10)" :key="player.player_id" class="star-row"><b>#{{ player.influence_rank }}</b><EntityAvatar :src="player.photo_url" :name="player.full_name" :size="38" round/><div><strong>{{ player.full_name }}</strong><small>{{ player.position }} · {{ number(player.social_followers,0) }} người theo dõi</small></div><span>{{ number(player.popularity_score,1) }}</span></div>
          </div>
        </article>
        <article class="glass card revenue-card">
          <div class="section-title"><div><span class="eyebrow"><BadgeDollarSign :size="14"/> Commercial record</span><h2>Dòng tiền sức ảnh hưởng</h2></div></div>
          <div class="revenue-lines"><div><span>Sự kiện thương mại</span><b>{{ money(summary.event_revenue) }}</b></div><div><span>Chi phí sự kiện</span><b class="negative">−{{ money(summary.event_cost) }}</b></div><div><span>Vật phẩm đã chốt</span><b>{{ money(summary.merchandise_revenue) }}</b></div><div><span>Số chiến dịch</span><b>{{ summary.merchandise_campaigns||0 }}</b></div></div>
          <div class="fan-meter"><span>Lòng trung thành {{ number(summary.loyalty_score,1) }}%</span><div><i :style="{width:`${Math.min(100,Number(summary.loyalty_score||0))}%`}"></i></div></div>
        </article>
      </section>

      <section v-else-if="tab==='events'" class="glass card">
        <div class="section-title"><div><span class="eyebrow"><Gift :size="14"/> Random events</span><h2>Sự kiện thương mại ngẫu nhiên</h2><p>Tần suất và giá trị dựa trên danh tiếng, truyền thông, quy mô fan và một tỷ lệ may rủi có kiểm soát.</p></div><div class="event-actions"><input v-model="eventCycle" class="input" placeholder="Chu kỳ, ví dụ 2026-W31"/><button class="btn btn-primary" :disabled="busy" @click="randomEvents"><Sparkles :size="16"/>Random sự kiện</button></div></div>
        <div v-if="pendingEvents.length" class="event-alert"><Gift :size="18"/>Có {{ pendingEvents.length }} lời mời đang chờ quyết định.</div>
        <EmptyState v-if="!payload.events?.length" title="Chưa phát sinh sự kiện"/>
        <div v-else class="event-grid">
          <article v-for="event in payload.events" :key="event.id" :class="['event-card',`tone-${String(event.tone||'blue').toLowerCase()}`]">
            <div class="event-icon"><Gift :size="20"/></div><div class="event-copy"><span class="status">{{ event.status }}</span><h3>{{ event.title }}</h3><p>{{ event.description }}</p><div class="event-impact"><b :class="Number(event.amount)>=0?'positive':'negative'">{{ Number(event.amount)>=0?'+':'' }}{{ money(event.amount) }}</b><span>{{ Number(event.fan_change)>=0?'+':'' }}{{ number(event.fan_change,0) }} fan</span></div></div>
            <div v-if="event.status==='OFFERED'" class="decision"><button class="btn btn-sm btn-success" :disabled="busy" @click="decideEvent(event,'ACCEPTED')"><Check :size="14"/>Nhận</button><button class="btn btn-sm btn-danger" :disabled="busy" @click="decideEvent(event,'REJECTED')"><X :size="14"/>Từ chối</button></div>
          </article>
        </div>
      </section>

      <section v-else-if="tab==='merch'" class="glass card">
        <div class="section-title"><div><span class="eyebrow"><Shirt :size="14"/> Merchandise lab</span><h2>Kinh doanh áo đấu & vật phẩm có chữ ký</h2><p>Cầu thủ nổi tiếng tạo hệ số bán vật phẩm cao hơn; giá quá cao sẽ làm giảm tỷ lệ chuyển đổi.</p></div><button class="btn btn-primary" @click="openMerch"><PackageOpen :size="16"/>Tạo chiến dịch</button></div>
        <EmptyState v-if="!payload.campaigns?.length" title="Chưa có chiến dịch vật phẩm"/>
        <div v-else class="campaign-grid">
          <article v-for="campaign in payload.campaigns" :key="campaign.id" class="campaign-card">
            <div class="campaign-head"><span>{{ campaign.product_type }}</span><b :class="campaign.status==='SETTLED'?'settled':''">{{ campaign.status }}</b></div><div class="campaign-player"><EntityAvatar :src="campaign.photo_url" :name="campaign.full_name||campaign.campaign_name" :size="42" round/><div><h3>{{ campaign.campaign_name }}</h3><small>{{ campaign.full_name||'Sản phẩm CLB' }}</small></div></div><div class="campaign-metrics"><div><span>Đã bán</span><b>{{ number(campaign.units_sold,0) }}/{{ number(campaign.units_planned,0) }}</b></div><div><span>Doanh thu</span><b>{{ money(campaign.gross_revenue,true) }}</b></div><div><span>Lợi nhuận</span><b>{{ money(campaign.net_revenue,true) }}</b></div></div><button v-if="campaign.status==='SIMULATED'" class="btn btn-primary full" :disabled="busy" @click="settleCampaign(campaign)"><Coins :size="16"/>Chốt vào ví CLB</button>
          </article>
        </div>
      </section>

      <section v-else-if="tab==='grants' && isAdmin" class="glass card">
        <div class="section-title"><div><span class="eyebrow"><Award :size="14"/> FIFA influence grants</span><h2>Thưởng sức ảnh hưởng cuối mùa</h2><p>FIFA cấp tiền cho CLB và cầu thủ dẫn đầu BXH mùa. Mỗi đối tượng chỉ được nhận một lần trong mùa.</p></div><div class="grant-actions"><select v-model="grantSeasonId" class="select"><option v-for="season in seasons" :key="season.id" :value="season.id">{{ season.name }}</option></select><button class="btn" :disabled="busy" @click="previewGrants">Xem trước</button><button class="btn btn-primary" :disabled="busy||!grantPreview" @click="finalizeGrants"><Coins :size="16"/>Chi thưởng</button></div></div>
        <div v-if="grantPreview" class="grant-layout"><div class="grant-total"><span>Tổng quỹ cần chi</span><b>{{ money(grantPreview.total_amount) }}</b></div><div class="grant-columns"><div><h3>CLB</h3><div v-for="item in grantPreview.clubs" :key="item.club_id" class="grant-row"><span>#{{ item.rank_position }} {{ item.name }}</span><b>{{ money(item.grant_amount) }}</b><small>{{ item.paid?'Đã chi':'Chờ chi' }}</small></div></div><div><h3>Cầu thủ</h3><div v-for="item in grantPreview.players" :key="item.player_id" class="grant-row"><span>#{{ item.rank_position }} {{ item.full_name }}</span><b>{{ money(item.grant_amount) }}</b><small>{{ item.paid?'Đã chi':'Chờ chi' }}</small></div></div></div></div>
        <EmptyState v-else title="Chọn mùa và xem trước quỹ thưởng"/>
      </section>
    </template>

    <BaseModal :open="modal==='merch'" title="Mô phỏng chiến dịch vật phẩm" @close="modal=''" width="720px">
      <form class="form-grid" @submit.prevent="simulateMerch">
        <label><span class="label">Loại sản phẩm</span><select v-model="merchForm.product_type" class="select"><option value="HOME_SHIRT">Áo sân nhà</option><option value="AWAY_SHIRT">Áo sân khách</option><option value="SIGNED_SHIRT">Áo có chữ ký</option><option value="SIGNED_BALL">Bóng có chữ ký</option><option value="SCARF">Khăn CLB</option><option value="LIMITED_BOX">Hộp giới hạn</option></select></label>
        <label><span class="label">Cầu thủ đại diện</span><select v-model="merchForm.player_id" class="select"><option value="">Không gắn cầu thủ</option><option v-for="player in payload?.players||[]" :key="player.player_id" :value="player.player_id">{{ player.full_name }} · độ nổi tiếng {{ number(player.popularity_score,1) }}</option></select></label>
        <label class="form-group full"><span class="label">Tên chiến dịch</span><input v-model="merchForm.campaign_name" class="input" placeholder="Ví dụ: Áo ký tên phiên bản vô địch"/></label>
        <label><span class="label">Số lượng dự kiến</span><input v-model.number="merchForm.units_planned" type="number" min="10" class="input"/></label><label><span class="label">Giá bán mỗi sản phẩm</span><input v-model.number="merchForm.unit_price" type="number" min="0" class="input"/></label><label><span class="label">Chi phí mỗi sản phẩm</span><input v-model.number="merchForm.unit_cost" type="number" min="0" class="input"/></label>
        <div class="form-group full actions"><button type="button" class="btn" @click="modal=''">Hủy</button><button class="btn btn-primary" :disabled="busy"><Sparkles :size="16"/>Mô phỏng nhu cầu</button></div>
      </form>
    </BaseModal>
  </div>
</template>

<style scoped>
.club-picker{min-width:230px}.influence-hero{position:relative;overflow:hidden;padding:24px;display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:16px;background:linear-gradient(125deg,rgba(57,130,255,.12),rgba(141,92,255,.07),rgba(255,200,87,.04))}.influence-hero:after{content:'';position:absolute;width:280px;height:280px;right:-100px;top:-170px;border-radius:50%;border:1px solid rgba(255,255,255,.08);box-shadow:0 0 0 35px rgba(57,130,255,.025),0 0 0 70px rgba(57,130,255,.018)}.hero-club{display:flex;align-items:center;gap:16px;position:relative;z-index:1}.hero-club h2{font-size:28px;margin:5px 0}.hero-club p{max-width:720px}.reputation-orbit{position:relative;z-index:1;width:112px;height:112px;border-radius:50%;display:grid;place-content:center;text-align:center;border:7px solid rgba(57,130,255,.16);box-shadow:inset 0 0 0 2px var(--primary),0 0 28px rgba(57,130,255,.16)}.reputation-orbit span{font-size:28px;font-weight:900}.reputation-orbit small{color:var(--muted)}.influence-stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.influence-stats article{padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--panel);display:grid;grid-template-columns:auto 1fr;gap:6px 9px;align-items:center}.influence-stats svg{color:var(--primary)}.influence-stats span{font-size:10px;color:var(--muted)}.influence-stats b{grid-column:1/-1;font-size:18px}.influence-stats small{grid-column:1/-1;font-size:9px;color:var(--muted)}.influence-tabs{display:flex;gap:6px;padding:7px;margin:18px 0}.influence-tabs button{border:0;background:transparent;color:var(--muted);padding:10px 14px;border-radius:10px;display:flex;align-items:center;gap:7px;font-weight:750}.influence-tabs button.active{background:var(--primary);color:white}.overview-layout{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.star-list{display:grid}.star-row{display:grid;grid-template-columns:32px auto 1fr auto;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}.star-row> b{color:var(--muted)}.star-row div strong,.star-row div small{display:block}.star-row div small{font-size:10px;color:var(--muted);margin-top:3px}.star-row>span{font-size:18px;font-weight:900;color:var(--yellow)}.revenue-lines{display:grid;gap:10px}.revenue-lines>div{display:flex;justify-content:space-between;padding:11px;border:1px solid var(--line);border-radius:11px}.negative{color:var(--red)}.fan-meter{margin-top:18px}.fan-meter>span{display:block;font-size:11px;color:var(--muted);margin-bottom:7px}.fan-meter>div{height:10px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden}.fan-meter i{display:block;height:100%;background:linear-gradient(90deg,var(--primary),var(--cyan));border-radius:inherit}.event-actions,.grant-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.event-alert{padding:12px 14px;border-radius:12px;background:rgba(255,200,87,.1);color:var(--yellow);display:flex;gap:8px;align-items:center;margin-bottom:14px}.event-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.event-card{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:16px;border:1px solid var(--line);border-radius:15px;background:rgba(57,130,255,.035)}.event-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:rgba(57,130,255,.12);color:var(--primary)}.event-copy .status{font-size:9px;color:var(--muted);letter-spacing:.08em}.event-copy h3{font-size:15px;margin:5px 0}.event-copy p{font-size:11px}.event-impact{display:flex;gap:12px;margin-top:10px;font-size:12px}.positive{color:var(--green)}.decision{grid-column:1/-1;display:flex;gap:7px;justify-content:flex-end}.campaign-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.campaign-card{padding:16px;border:1px solid var(--line);border-radius:15px;background:var(--panel)}.campaign-head{display:flex;justify-content:space-between;font-size:9px;color:var(--muted)}.campaign-head b{padding:4px 7px;border-radius:99px;background:rgba(255,200,87,.1);color:var(--yellow)}.campaign-head b.settled{background:rgba(53,221,154,.1);color:var(--green)}.campaign-player{display:flex;align-items:center;gap:9px;margin:14px 0}.campaign-player h3{font-size:14px}.campaign-player small{font-size:9px;color:var(--muted)}.campaign-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}.campaign-metrics>div{padding:8px;border-radius:9px;background:rgba(57,130,255,.05)}.campaign-metrics span,.campaign-metrics b{display:block}.campaign-metrics span{font-size:8px;color:var(--muted)}.campaign-metrics b{font-size:11px;margin-top:3px}.full{width:100%;justify-content:center}.grant-total{padding:18px;border:1px solid rgba(255,200,87,.25);border-radius:15px;background:rgba(255,200,87,.06);display:flex;justify-content:space-between;align-items:center}.grant-total b{font-size:24px;color:var(--yellow)}.grant-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:15px}.grant-columns>div{border:1px solid var(--line);border-radius:14px;padding:14px}.grant-row{display:grid;grid-template-columns:1fr auto;gap:4px;padding:9px 0;border-bottom:1px solid var(--line)}.grant-row small{grid-column:1/-1;color:var(--muted)}@media(max-width:1180px){.influence-stats{grid-template-columns:repeat(3,1fr)}.campaign-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:800px){.influence-hero,.hero-club{align-items:flex-start}.influence-hero{flex-direction:column}.influence-stats,.event-grid,.campaign-grid,.overview-layout,.grant-columns{grid-template-columns:1fr}.influence-tabs{overflow-x:auto}.influence-tabs button{white-space:nowrap}.reputation-orbit{width:90px;height:90px}.event-actions,.grant-actions{width:100%}}
</style>
