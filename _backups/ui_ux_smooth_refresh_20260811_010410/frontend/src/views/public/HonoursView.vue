<script setup>
import { computed, onMounted, ref } from "vue";
import { Crown, Medal, Shield, Sparkles, UserRound, Search } from "@lucide/vue";
import { api } from "../../services/api";
import { number, positionName } from "../../utils";
import EntityAvatar from "../../components/EntityAvatar.vue";
import HonourMedals from "../../components/HonourMedals.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import EmptyState from "../../components/EmptyState.vue";

const tab = ref("players"),
  loading = ref(true),
  players = ref([]),
  clubs = ref([]),
  seasons = ref([]),
  seasonId = ref(""),
  scope = ref("ALL"),
  search = ref("");
const filteredPlayers = computed(() =>
  players.value.filter(
    (x) =>
      !search.value ||
      `${x.full_name} ${x.current_club_name || ""}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
);
const filteredClubs = computed(() =>
  clubs.value.filter(
    (x) =>
      !search.value ||
      `${x.club_name} ${x.short_name || ""}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
);
async function load() {
  loading.value = true;
  try {
    const query = { limit: 200, season_id: seasonId.value || undefined, scope: scope.value };
    const [p, c, s] = await Promise.all([
      api.get("/honours/players", query, { auth: false }),
      api.get("/honours/clubs", query, { auth: false }),
      api.get("/seasons", null, { auth: false }),
    ]);
    players.value = p.data;
    clubs.value = c.data;
    seasons.value = s.data;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div class="honours-page">
    <section class="honours-hero">
      <div class="container hero-grid">
        <div>
          <span class="eyebrow"><Sparkles :size="15" /> Hall of Fame</span>
          <h1>Đại sảnh<br /><em>vinh danh</em></h1>
          <p>
            Xếp hạng lịch sử dựa trên huy chương, danh hiệu và những cột mốc lớn
            của cầu thủ lẫn câu lạc bộ.
          </p>
          <div class="hero-badges">
            <span>🥇 Huy chương vàng</span><span>🥈 Huy chương bạc</span
            ><span>🥉 Huy chương đồng</span><span>⚔️ Thành tích tứ kết</span>
          </div>
        </div>
        <div class="trophy-orbit glass">
          <div class="orbit one"></div>
          <div class="orbit two"></div>
          <Crown :size="94" /><b>LEGACY</b><small>Football Hall of Fame</small>
        </div>
      </div>
    </section>
    <div class="container page honours-content">
      <section class="glass filter-bar">
        <div class="tab-switch">
          <button
            :class="{ active: tab === 'players' }"
            @click="tab = 'players'"
          >
            <UserRound :size="17" />Cầu thủ</button
          ><button :class="{ active: tab === 'clubs' }" @click="tab = 'clubs'">
            <Shield :size="17" />Câu lạc bộ
          </button>
        </div>
        <label class="search"
          ><Search :size="17" /><input
            v-model="search"
            placeholder="Tìm tên..." /></label
        ><select v-model="seasonId" class="select" @change="load">
          <option value="">Toàn bộ lịch sử</option>
          <option v-for="s in seasons" :key="s.id" :value="s.id">
            {{ s.name }}
          </option>
        </select>
      </section>
      <LoadingBlock v-if="loading" /><template v-else
        ><section v-if="tab === 'players'" class="ranking-stage">
          <div class="section-title">
            <div>
              <span class="eyebrow"><Medal :size="14" /> Player honours</span>
              <h2>{{ scope === 'NATIONAL_TEAM' ? 'BXH thành tích quốc gia' : scope === 'CLUB' ? 'BXH thành tích CLB của cầu thủ' : 'BXH huy chương tổng thể' }}</h2>
              <p>
                {{ scope === 'NATIONAL_TEAM' ? 'Chỉ tính huy chương và danh hiệu khi cầu thủ đại diện quốc gia.' : scope === 'CLUB' ? 'Chỉ tính thành tích cầu thủ đạt được cùng câu lạc bộ.' : 'Gộp toàn bộ thành tích CLB và quốc gia; mỗi danh hiệu vẫn giữ đúng đại diện lúc nhận.' }}
              </p>
            </div>
            <div class="scope-switch"><button :class="{active:scope==='ALL'}" @click="scope='ALL';load()">Tổng hợp</button><button :class="{active:scope==='CLUB'}" @click="scope='CLUB';load()">Cấp CLB</button><button :class="{active:scope==='NATIONAL_TEAM'}" @click="scope='NATIONAL_TEAM';load()">Cấp quốc gia</button></div>
          </div>
          <EmptyState v-if="!filteredPlayers.length" />
          <div v-else class="honour-list">
            <RouterLink
              v-for="row in filteredPlayers"
              :key="row.player_id"
              :to="`/players/${row.player_id}`"
              class="honour-row glass"
              ><div class="place" :class="`top-${row.rank_position}`">
                #{{ row.rank_position }}
              </div>
              <EntityAvatar
                :src="row.photo_url"
                :name="row.full_name"
                :size="52"
                round
              />
              <div class="identity">
                <b>{{ row.full_name }}</b
                ><span
                  >{{ positionName(row.position) }} ·
                  {{ row.current_club_name || "Cầu thủ tự do" }}</span
                ><small>{{
                  row.medal_history || "Chưa có huy chương tập thể"
                }}</small>
              </div>
              <HonourMedals
                :gold="row.gold_count"
                :silver="row.silver_count"
                :bronze="row.bronze_count"
              />
              <div class="honour-score">
                <small>Điểm vinh danh</small
                ><b>{{ number(row.honour_points) }}</b
                ><span>{{ row.individual_award_count }} giải cá nhân</span>
              </div></RouterLink
            >
          </div>
        </section>
        <section v-else class="ranking-stage">
          <div class="section-title">
            <div>
              <span class="eyebrow"><Crown :size="14" /> Club legacy</span>
              <h2>BXH thành tích câu lạc bộ</h2>
              <p>
                Ưu tiên số lần vô địch, á quân, hạng ba rồi đến các lần tiến sâu
                tại giải.
              </p>
            </div>
          </div>
          <EmptyState v-if="!filteredClubs.length" />
          <div v-else class="honour-list">
            <RouterLink
              v-for="row in filteredClubs"
              :key="row.club_id"
              :to="`/clubs/${row.club_id}`"
              class="honour-row club-row glass"
              ><div class="place" :class="`top-${row.rank_position}`">
                #{{ row.rank_position }}
              </div>
              <EntityAvatar
                :src="row.logo_url"
                :name="row.club_name"
                :size="54"
              />
              <div class="identity">
                <b>{{ row.club_name }}</b
                ><span
                  >{{ row.code }} · {{ row.total_achievements }} cột mốc lịch
                  sử</span
                ><small>{{
                  row.achievement_history || "Chưa có thành tích"
                }}</small>
              </div>
              <HonourMedals
                :gold="row.gold_count"
                :silver="row.silver_count"
                :bronze="row.bronze_count"
                :quarterfinal="row.quarterfinal_count"
              />
              <div class="honour-score">
                <small>Điểm thành tích</small
                ><b>{{ number(row.honour_points) }}</b
                ><span>{{ row.round_of_16_count || 0 }} lần vòng 16</span>
              </div></RouterLink
            >
          </div>
        </section></template
      >
    </div>
  </div>
</template>
<style scoped>
.honours-page {
  min-height: 100vh;
}
.honours-hero {
  padding: 88px 0 66px;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 74% 36%,
      rgba(255, 189, 42, 0.16),
      transparent 28%
    ),
    radial-gradient(
      circle at 18% 30%,
      rgba(72, 119, 255, 0.18),
      transparent 35%
    );
}
.honours-hero:before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: linear-gradient(to bottom, #000, transparent);
}
.hero-grid {
  display: grid;
  grid-template-columns: 1.3fr 0.7fr;
  align-items: center;
  gap: 70px;
  position: relative;
}
.honours-hero h1 {
  font-size: clamp(50px, 8vw, 92px);
  line-height: 0.93;
  letter-spacing: -0.055em;
  margin: 16px 0 23px;
}
.honours-hero h1 em {
  font-style: normal;
  background: linear-gradient(100deg, #ffd659, #ff9f32);
  -webkit-background-clip: text;
  color: transparent;
}
.honours-hero p {
  font-size: 17px;
  max-width: 680px;
}
.hero-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 25px;
}
.hero-badges span {
  padding: 9px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.035);
  font-size: 11px;
  font-weight: 800;
}
.trophy-orbit {
  aspect-ratio: 1;
  max-width: 330px;
  width: 100%;
  justify-self: end;
  border-radius: 50%;
  display: grid;
  place-items: center;
  position: relative;
  color: #ffd24e;
  box-shadow:
    0 0 80px rgba(255, 187, 42, 0.12),
    inset 0 0 55px rgba(255, 194, 52, 0.08);
}
.trophy-orbit b,
.trophy-orbit small {
  position: absolute;
}
.trophy-orbit b {
  bottom: 68px;
  letter-spacing: 0.24em;
}
.trophy-orbit small {
  bottom: 47px;
  color: var(--muted);
}
.orbit {
  position: absolute;
  border: 1px solid rgba(255, 209, 81, 0.28);
  border-radius: 50%;
  animation: spin 14s linear infinite;
}
.orbit.one {
  inset: 22px;
}
.orbit.two {
  inset: 55px;
  border-style: dashed;
  animation-direction: reverse;
  animation-duration: 10s;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.honours-content {
  padding-top: 28px;
}
.filter-bar {
  padding: 12px;
  display: grid;
  grid-template-columns: auto 1fr 220px;
  gap: 12px;
  align-items: center;
  margin-bottom: 27px;
  position: sticky;
  top: 86px;
  z-index: 20;
}
.tab-switch {
  display: flex;
  padding: 4px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 12px;
}
.tab-switch button {
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 10px 15px;
  border-radius: 9px;
  display: flex;
  gap: 7px;
  align-items: center;
  font-weight: 800;
}
.tab-switch button.active {
  background: linear-gradient(135deg, var(--primary), var(--primary-2));
  color: #fff;
  box-shadow: 0 7px 20px rgba(57, 130, 255, 0.24);
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.025);
}
.search input {
  height: 42px;
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--text);
  outline: 0;
}
.ranking-stage {
  padding-bottom: 55px;
}
.scope-switch{display:flex;gap:6px;flex-wrap:wrap}.scope-switch button{padding:8px 11px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.03);color:var(--muted);font-weight:800}.scope-switch button.active{border-color:rgba(88,224,171,.35);background:rgba(88,224,171,.1);color:#6de5b3}
.section-title p {
  margin-top: 7px;
}
.honour-list {
  display: grid;
  gap: 10px;
}
.honour-row {
  padding: 15px 17px;
  display: grid;
  grid-template-columns: 58px auto minmax(220px, 1fr) auto 130px;
  align-items: center;
  gap: 14px;
  transition: 0.22s;
  color: var(--text);
  position: relative;
  overflow: hidden;
}
.honour-row:after {
  content: "";
  position: absolute;
  inset: auto -100px -120px auto;
  width: 250px;
  height: 220px;
  background: radial-gradient(
    circle,
    rgba(75, 127, 255, 0.12),
    transparent 70%
  );
}
.honour-row:hover {
  transform: translateY(-3px);
  border-color: rgba(88, 141, 255, 0.33);
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.22);
}
.place {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.04);
  font: 900 17px Manrope;
  color: var(--muted);
}
.place.top-1 {
  background: linear-gradient(135deg, #ffd64c, #c98510);
  color: #201400;
  box-shadow: 0 0 28px rgba(255, 195, 38, 0.25);
}
.place.top-2 {
  background: linear-gradient(135deg, #e2eaf4, #8291a5);
  color: #17202b;
}
.place.top-3 {
  background: linear-gradient(135deg, #dc914c, #8c461f);
  color: #251005;
}
.identity {
  min-width: 0;
}
.identity b,
.identity span,
.identity small {
  display: block;
}
.identity b {
  font: 800 16px Manrope;
}
.identity span {
  font-size: 11px;
  color: #8bb7ff;
  margin: 4px 0;
}
.identity small {
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 560px;
}
.honour-score {
  text-align: right;
  position: relative;
  z-index: 1;
}
.honour-score small,
.honour-score span {
  display: block;
  color: var(--muted);
  font-size: 9px;
}
.honour-score b {
  display: block;
  font: 900 21px Manrope;
  color: var(--yellow);
  margin: 3px 0;
}
@media (max-width: 1050px) {
  .honour-row {
    grid-template-columns: 52px auto 1fr;
  }
  .honour-row :deep(.honour-medals),
  .honour-score {
    grid-column: 3;
  }
  .honour-score {
    text-align: left;
  }
  .hero-grid {
    grid-template-columns: 1fr 0.48fr;
    gap: 30px;
  }
}
@media (max-width: 760px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }
  .trophy-orbit {
    display: none;
  }
  .filter-bar {
    grid-template-columns: 1fr;
    position: static;
  }
  .tab-switch {
    width: 100%;
  }
  .tab-switch button {
    flex: 1;
    justify-content: center;
  }
  .honour-row {
    grid-template-columns: 45px auto 1fr;
    padding: 12px;
  }
  .honour-row :deep(.honour-medals) {
    grid-column: 1/-1;
  }
  .honour-score {
    grid-column: 1/-1;
  }
  .identity small {
    max-width: 65vw;
  }
  .honours-hero {
    padding: 60px 0 42px;
  }
}
</style>
