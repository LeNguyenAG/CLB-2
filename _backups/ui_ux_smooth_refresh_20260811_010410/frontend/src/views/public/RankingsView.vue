<script setup>
import { onMounted, ref, watch } from "vue";
import { Trophy, Users, Goal, Wallet, Gem, ShieldCheck, Globe2 } from "@lucide/vue";
import { api } from "../../services/api";
import { money, number, positionName } from "../../utils";
import PageHeader from "../../components/PageHeader.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import EmptyState from "../../components/EmptyState.vue";
import EntityAvatar from "../../components/EntityAvatar.vue";
import RankMovement from "../../components/RankMovement.vue";
const loading = ref(true),
  clubRows = ref([]),
  playerRows = ref([]),
  category = ref("OVERALL");
const categories = [
  ["OVERALL", "Tổng thể", Trophy],
  ["NATIONAL", "Đội tuyển", Globe2],
  ["GOALS", "Bàn thắng", Goal],
  ["GOALKEEPER", "Thủ môn", ShieldCheck],
  ["WEALTH", "Giàu nhất", Wallet],
  ["MARKET_VALUE", "Giá trị", Gem],
];
async function load() {
  loading.value = true;
  try {
    const [clubs, players] = await Promise.all([
      api.get("/rankings/clubs", { limit: 100 }, { auth: false }),
      api.get(
        "/rankings/players",
        { category: category.value, limit: 100 },
        { auth: false },
      ),
    ]);
    clubRows.value = clubs.data;
    playerRows.value = players.data;
  } finally {
    loading.value = false;
  }
}
watch(category, load);
onMounted(load);
function score(row) {
  if (category.value === "WEALTH") return money(row.wallet_balance);
  if (category.value === "MARKET_VALUE") return money(row.market_value);
  return number(row.score);
}
</script>
<template>
  <div class="container page">
    <PageHeader
      eyebrow="World Ranking"
      title="Bảng xếp hạng danh giá"
      description="Theo dõi vị thế, điểm số và biến động thứ hạng của các câu lạc bộ và cầu thủ qua từng mùa giải."
    /><LoadingBlock v-if="loading" /><template v-else
      ><div class="rank-layout">
        <section class="glass card">
          <div class="section-title">
            <div>
              <span class="eyebrow"><Trophy :size="14" /> Câu lạc bộ</span>
              <h2>BXH thế giới</h2>
            </div>
          </div>
          <EmptyState v-if="!clubRows.length" />
          <div v-else class="table-wrap ranking-scroll" aria-label="Bảng xếp hạng câu lạc bộ">
            <table>
              <thead>
                <tr>
                  <th>Hạng</th>
                  <th>Câu lạc bộ</th>
                  <th>Điểm</th>
                  <th>Biến động</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in clubRows" :key="row.club_id">
                  <td data-label="Hạng">
                    <span
                      class="rank-chip"
                      :class="{ top: Number(row.rank_position) <= 3 }"
                      >{{ row.rank_position }}</span
                    >
                  </td>
                  <td data-label="Câu lạc bộ">
                    <RouterLink :to="`/clubs/${row.club_id}`" class="entity"
                      ><EntityAvatar
                        :src="row.logo_url"
                        :name="row.club_name"
                        :size="38"
                      />
                      <div>
                        <div class="entity-name">{{ row.club_name }}</div>
                        <div class="entity-sub">{{ row.club_code }}</div>
                      </div></RouterLink
                    >
                  </td>
                  <td data-label="Điểm">
                    <b>{{ number(row.score) }}</b>
                  </td>
                  <td data-label="Biến động">
                    <RankMovement
                      :change="row.rank_change"
                      :previous="row.previous_rank"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section class="glass card">
          <div class="section-title">
            <div>
              <span class="eyebrow"><Users :size="14" /> Cầu thủ</span>
              <h2>BXH cá nhân</h2>
              <p v-if="category === 'NATIONAL'">
                Ưu tiên HCV → HCB → HCĐ, sau đó mới xét tổng điểm ở các giải quốc gia.
              </p>
            </div>
          </div>
          <div class="category-tabs">
            <button
              v-for="item in categories"
              :key="item[0]"
              class="btn btn-sm"
              :class="{ active: category === item[0] }"
              @click="category = item[0]"
            >
              <component :is="item[2]" :size="14" />{{ item[1] }}
            </button>
          </div>
          <EmptyState v-if="!playerRows.length" />
          <div v-else class="table-wrap ranking-scroll" aria-label="Bảng xếp hạng cầu thủ">
            <table>
              <thead>
                <tr>
                  <th>Hạng</th>
                  <th>Cầu thủ</th>
                  <th>Chỉ số</th>
                  <th>Biến động</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in playerRows" :key="row.player_id">
                  <td data-label="Hạng">
                    <span
                      class="rank-chip"
                      :class="{ top: Number(row.rank_position) <= 3 }"
                      >{{ row.rank_position }}</span
                    >
                  </td>
                  <td data-label="Cầu thủ">
                    <RouterLink :to="`/players/${row.player_id}`" class="entity"
                      ><EntityAvatar
                        :src="row.photo_url"
                        :name="row.full_name"
                        :size="38"
                        round
                      />
                      <div>
                        <div class="entity-name">{{ row.full_name }}</div>
                        <div class="entity-sub">
                          {{ positionName(row.position) }} ·
                          {{ row.club_name || "Tự do" }}
                        </div>
                      </div></RouterLink
                    >
                  </td>
                  <td data-label="Chỉ số">
                    <div v-if="category === 'NATIONAL'" class="national-score">
                      <span>🥇 {{ row.gold_count }} · 🥈 {{ row.silver_count }} · 🥉 {{ row.bronze_count }}</span>
                      <b>{{ score(row) }} điểm quốc gia</b>
                    </div>
                    <b v-else>{{ score(row) }}</b>
                  </td>
                  <td data-label="Biến động">
                    <RankMovement
                      :change="row.rank_change"
                      :previous="row.previous_rank"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section></div
    ></template>
  </div>
</template>
<style scoped>
.rank-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.rank-layout > section {
  min-width: 0;
}
.ranking-scroll {
  max-height: min(68vh, 760px);
}
.category-tabs {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.category-tabs .active {
  background: linear-gradient(135deg, var(--primary), var(--primary-2));
  border-color: transparent;
}
.rank-chip {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.04);
  font-weight: 800;
}
.rank-chip.top {
  color: var(--yellow);
  background: rgba(255, 200, 87, 0.1);
}
.national-score span,
.national-score b {
  display: block;
}
.national-score span {
  margin-bottom: 3px;
  color: var(--muted);
  font-size: 9px;
}
.national-score b {
  color: #69e0ad;
}
@media (max-width: 1000px) {
  .rank-layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 620px) {
  .rank-layout { gap: 14px; }
  .category-tabs {
    flex-wrap: nowrap;
    margin-inline: -2px;
    padding: 2px 2px 8px;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
  }
  .category-tabs::-webkit-scrollbar { display: none; }
  .category-tabs .btn { flex: 0 0 auto; white-space: nowrap; }
  .ranking-scroll {
    max-height: min(67dvh, 640px);
    overflow-x: hidden;
    border: 0;
    border-radius: 0;
  }
  .ranking-scroll table,
  .ranking-scroll tbody,
  .ranking-scroll tr,
  .ranking-scroll td { display: block; width: 100%; }
  .ranking-scroll table { min-width: 0; }
  .ranking-scroll thead {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .ranking-scroll tbody { display: grid; gap: 10px; }
  .ranking-scroll tr {
    display: grid;
    grid-template-columns: 54px minmax(0, 1fr) auto;
    align-items: center;
    gap: 7px 10px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: rgba(255, 255, 255, .025);
  }
  .ranking-scroll td {
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .ranking-scroll td:nth-child(1) { grid-row: 1 / span 2; }
  .ranking-scroll td:nth-child(2) { grid-column: 2 / 4; }
  .ranking-scroll td:nth-child(3) { grid-column: 2; }
  .ranking-scroll td:nth-child(4) { grid-column: 3; justify-self: end; }
  .ranking-scroll td:nth-child(3)::before,
  .ranking-scroll td:nth-child(4)::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 3px;
    color: var(--muted);
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
  }
  .ranking-scroll .rank-chip { width: 42px; height: 42px; border-radius: 13px; }
  .ranking-scroll .entity { width: 100%; }
  .ranking-scroll .entity > div { min-width: 0; }
  .ranking-scroll .entity-name { max-width: 100%; }
  .national-score span { white-space: normal; }
}
</style>
