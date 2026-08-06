<script setup>
import { onMounted, ref, watch } from "vue";
import { Search, Trophy, CalendarDays, Users, Swords } from "@lucide/vue";
import { api } from "../../services/api";
import { date } from "../../utils";
import PageHeader from "../../components/PageHeader.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import EmptyState from "../../components/EmptyState.vue";
import StatusBadge from "../../components/StatusBadge.vue";
import EntityAvatar from "../../components/EntityAvatar.vue";
import PaginationBar from "../../components/PaginationBar.vue";
const rows = ref([]),
  seasons = ref([]),
  loading = ref(true),
  meta = ref({ page: 1, limit: 18, total: 0 }),
  filters = ref({ season_id: "", status: "", format_type: "" });
async function load(page = 1) {
  loading.value = true;
  try {
    const r = await api.get(
      "/competitions",
      { page, limit: 18, ...filters.value },
      { auth: false },
    );
    rows.value = r.data;
    meta.value = r.meta;
  } finally {
    loading.value = false;
  }
}
watch(filters, () => load(1), { deep: true });
onMounted(async () => {
  seasons.value = (await api.get("/seasons", null, { auth: false })).data;
  load();
});
</script>
<template>
  <div class="container page">
    <PageHeader
      eyebrow="Tournament Center"
      title="Giải đấu"
      description="Giải CLB, World Cup 48 và giải quốc gia đặc biệt 32 đội được trình bày trực quan theo từng mùa."
    />
    <div class="glass card filters">
      <select v-model="filters.season_id" class="select">
        <option value="">Tất cả mùa</option>
        <option v-for="s in seasons" :key="s.id" :value="s.id">
          {{ s.name }}
        </option></select
      ><select v-model="filters.status" class="select">
        <option value="">Tất cả trạng thái</option>
        <option value="REGISTRATION">Đang đăng ký</option>
        <option value="GROUP_STAGE">Vòng bảng</option>
        <option value="KNOCKOUT_STAGE">Loại trực tiếp</option>
        <option value="FINISHED">Đã kết thúc</option></select
      ><select v-model="filters.format_type" class="select">
        <option value="">Tất cả thể thức</option>
        <option value="GROUP_ONLY">Chỉ vòng bảng</option>
        <option value="KNOCKOUT_ONLY">Chỉ loại trực tiếp</option>
        <option value="GROUP_AND_KNOCKOUT">Vòng bảng + nhánh</option>
      </select>
    </div>
    <LoadingBlock v-if="loading" /><EmptyState v-else-if="!rows.length" />
    <div v-else class="grid-3">
      <RouterLink
        v-for="item in rows"
        :key="item.id"
        :to="`/competitions/${item.id}`"
        class="glass card card-hover competition-card"
        :class="{ 'world-cup-card': item.competition_mode === 'WORLD_CUP_48', 'national-card': item.competition_mode === 'NATIONAL_SPECIAL_32' }"
        ><div class="top">
          <div class="competition-logo">
            <EntityAvatar :src="item.logo_url" :name="item.name" :size="54" />
          </div>
          <StatusBadge :status="item.status" />
        </div>
        <span class="eyebrow">{{
          item.competition_mode === "WORLD_CUP_48"
            ? "✦ WORLD CUP 48"
            : item.competition_mode === "NATIONAL_SPECIAL_32"
              ? "◉ QUỐC GIA ĐẶC BIỆT 32"
              : item.series_name
        }}</span>
        <h3>{{ item.name }}</h3>
        <p>{{ item.season_name }}</p>
        <div class="info">
          <div>
            <CalendarDays :size="15" />{{ date(item.starts_on) }} –
            {{ date(item.ends_on) }}
          </div>
          <div><Users :size="15" />{{ item.approved_teams }} đội</div>
          <div>
            <Swords :size="15" />{{ item.finished_matches }}/{{
              item.match_count
            }}
            trận
          </div>
        </div>
        <div class="bottom">
          <span>Hệ số {{ item.coefficient }}</span
          ><span>{{ item.format_type }}</span>
        </div></RouterLink
      >
    </div>
    <PaginationBar v-if="!loading" v-bind="meta" @change="load" />
  </div>
</template>
<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 22px;
  padding: 14px;
}
.competition-card {
  min-height: 290px;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.competition-logo {
  padding: 5px;
  border-radius: 16px;
  background: rgba(57, 130, 255, 0.08);
}
.competition-card h3 {
  font-size: 22px;
  margin: 9px 0 6px;
}
.info {
  display: grid;
  gap: 9px;
  margin-top: 22px;
  color: var(--muted);
  font-size: 12px;
}
.info div {
  display: flex;
  align-items: center;
  gap: 7px;
}
.bottom {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--line);
  margin-top: 20px;
  padding-top: 14px;
  color: var(--muted);
  font-size: 10px;
}
.world-cup-card {
  position: relative;
  overflow: hidden;
  border-color: rgba(255, 205, 85, 0.3);
  background:
    radial-gradient(
      circle at 88% 5%,
      rgba(255, 210, 86, 0.18),
      transparent 32%
    ),
    radial-gradient(
      circle at 10% 95%,
      rgba(72, 122, 255, 0.16),
      transparent 38%
    ),
    linear-gradient(145deg, var(--panel), rgba(6, 17, 38, 0.86));
}
.world-cup-card:after {
  content: "✦";
  position: absolute;
  right: 18px;
  bottom: 14px;
  color: rgba(255, 220, 105, 0.55);
  font-size: 28px;
  animation: wcPulse 2s ease-in-out infinite alternate;
}
.national-card{position:relative;overflow:hidden;border-color:rgba(83,224,169,.3);background:radial-gradient(circle at 88% 5%,rgba(83,224,169,.16),transparent 32%),radial-gradient(circle at 10% 95%,rgba(52,107,225,.14),transparent 38%),linear-gradient(145deg,var(--panel),rgba(5,31,36,.86))}.national-card:after{content:'◉';position:absolute;right:18px;bottom:14px;color:rgba(103,230,179,.5);font-size:27px}
@keyframes wcPulse {
  to {
    transform: scale(1.25) rotate(20deg);
    text-shadow: 0 0 22px #ffd45c;
  }
}
@media (max-width: 700px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
