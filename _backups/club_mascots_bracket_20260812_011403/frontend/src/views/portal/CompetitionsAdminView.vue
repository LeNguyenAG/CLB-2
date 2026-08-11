<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { Layers3, Plus, Swords, Trophy, Users } from "@lucide/vue";
import { api } from "../../services/api";
import { authStore } from "../../stores/auth";
import { uiStore } from "../../stores/ui";
import { date, money } from "../../utils";
import BaseModal from "../../components/BaseModal.vue";
import EmptyState from "../../components/EmptyState.vue";
import EntityAvatar from "../../components/EntityAvatar.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import PageHeader from "../../components/PageHeader.vue";
import PaginationBar from "../../components/PaginationBar.vue";
import StatusBadge from "../../components/StatusBadge.vue";

const isAdmin = computed(() => authStore.isAdmin.value);
const loading = ref(true);
const busy = ref(false);
const rows = ref([]);
const series = ref([]);
const seasons = ref([]);
const meta = ref({ page: 1, limit: 18, total: 0 });
const filters = ref({ season_id: "", status: "", format_type: "" });
const modal = ref("");
const form = ref({});
const presetInfo = ref(null);
const loadingPreset = ref(false);

function resetCompetition() {
  presetInfo.value = null;
  form.value = {
    competition_mode: "CLUB",
    series_id: "",
    season_id: "",
    name: "",
    logo_url: "",
    format_type: "GROUP_AND_KNOCKOUT",
    coefficient: "1.000",
    entry_fee: "0",
    status: "DRAFT",
    group_count: 4,
    teams_per_group: 4,
    advance_per_group: 2,
    best_third_count: 0,
    group_leg_mode: "ONE_LEG",
    knockout_size: 8,
    third_place_mode: "SHARED_BRONZE",
    starts_on: "",
    ends_on: "",
    draw_mode: "POTS",
    pairing_mode: "SEEDED_CONSTRAINED",
    visual_theme: "COSMIC_GOLD",
    gold_prize_amount: "0",
    silver_prize_amount: "0",
    bronze_prize_amount: "0",
    fourth_prize_amount: "0",
    quarterfinal_prize_amount: "0",
    round16_prize_amount: "0",
    round32_prize_amount: "0",
    champion_upset_points: "25",
    runnerup_upset_points: "15",
  };
}
async function load(page = 1) {
  try {
    const response = await api.get("/competitions", {
      page,
      limit: 18,
      ...filters.value,
    });
    rows.value = response.data;
    meta.value = response.meta;
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    loading.value = false;
  }
}
watch(filters, () => load(1), { deep: true });
onMounted(async () => {
  try {
    const [seriesResponse, seasonResponse] = await Promise.all([
      api.get("/competition-series"),
      api.get("/seasons"),
    ]);
    series.value = seriesResponse.data;
    seasons.value = seasonResponse.data;
  } catch (error) {
    uiStore.notify(error.message, "error");
  }
  await load();
});
function openCompetition() {
  resetCompetition();
  modal.value = "competition";
}
function openSeries() {
  form.value = { code: "", name: "", description: "" };
  modal.value = "series";
}
function applyModeDefaults() {
  if (form.value.competition_mode === "WORLD_CUP_48") {
    form.value.coefficient = "2.000";
    form.value.draw_mode = "POTS";
    form.value.visual_theme = "COSMIC_GOLD";
  } else if (form.value.competition_mode === "NATIONAL_SPECIAL_32") {
    form.value.coefficient = "1.500";
    form.value.draw_mode = "SEEDED_CONSTRAINED";
    form.value.visual_theme = "CONTINENTAL_GOLD";
  } else {
    form.value.coefficient = "1.000";
  }
}
async function loadCreationPreset() {
  presetInfo.value = null;
  if (!form.value.series_id) return;
  loadingPreset.value = true;
  try {
    const response = await api.get(
      `/competition-series/${form.value.series_id}/creation-preset`,
      { competition_mode: form.value.competition_mode },
    );
    const preset = response.data;
    if (!preset) return;
    const reusableFields = [
      "logo_url", "coefficient", "format_type", "entry_fee", "group_count",
      "teams_per_group", "advance_per_group", "best_third_count", "group_leg_mode",
      "knockout_size", "third_place_mode", "draw_mode", "pairing_mode", "visual_theme",
      "gold_prize_amount", "silver_prize_amount", "bronze_prize_amount",
      "fourth_prize_amount", "quarterfinal_prize_amount", "round16_prize_amount",
      "round32_prize_amount", "champion_upset_points", "runnerup_upset_points",
    ];
    for (const field of reusableFields) {
      if (preset[field] !== undefined && preset[field] !== null)
        form.value[field] = preset[field];
    }
    presetInfo.value = preset;
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    loadingPreset.value = false;
  }
}
async function handleModeChange() {
  applyModeDefaults();
  await loadCreationPreset();
}
async function createCompetition() {
  busy.value = true;
  try {
    const endpoints = {
      CLUB: "/competitions",
      WORLD_CUP_48: "/competitions/world-cup-48",
      NATIONAL_SPECIAL_32: "/competitions/national-special-32",
    };
    await api.post(endpoints[form.value.competition_mode], form.value);
    uiStore.notify(
      form.value.competition_mode === "WORLD_CUP_48"
        ? "Đã tạo World Cup 48 quốc gia."
        : form.value.competition_mode === "NATIONAL_SPECIAL_32"
          ? "Đã tạo giải quốc gia đặc biệt 32 đội."
          : "Đã tạo giải đấu.",
    );
    modal.value = "";
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}
async function createSeries() {
  busy.value = true;
  try {
    const response = await api.post("/competition-series", form.value);
    series.value.push(response.data);
    uiStore.notify("Đã tạo hệ giải.");
    modal.value = "";
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}
function modeLabel(item) {
  if (item.competition_mode === "WORLD_CUP_48") return "✦ WORLD CUP 48";
  if (item.competition_mode === "NATIONAL_SPECIAL_32")
    return "◉ QUỐC GIA ĐẶC BIỆT 32";
  return item.series_name;
}
</script>

<template>
  <div>
    <PageHeader
      eyebrow="Competition Operations"
      title="Trung tâm giải đấu"
      description="Tạo giải CLB, World Cup 48 hoặc giải quốc gia đặc biệt 32 đội với điểm tổng thể và điểm quốc gia riêng."
    >
      <button v-if="isAdmin" class="btn" @click="openSeries">
        <Layers3 :size="17" />Tạo hệ giải
      </button>
      <button v-if="isAdmin" class="btn btn-primary" @click="openCompetition">
        <Plus :size="17" />Tạo giải
      </button>
    </PageHeader>
    <div class="glass card filters">
      <select v-model="filters.season_id" class="select">
        <option value="">Tất cả mùa</option>
        <option v-for="season in seasons" :key="season.id" :value="season.id">
          {{ season.name }}
        </option>
      </select>
      <select v-model="filters.status" class="select">
        <option value="">Tất cả trạng thái</option>
        <option value="DRAFT">Bản nháp</option>
        <option value="REGISTRATION">Đăng ký</option>
        <option value="GROUP_STAGE">Vòng bảng</option>
        <option value="KNOCKOUT_STAGE">Loại trực tiếp</option>
        <option value="COMPLETED_PENDING_CLOSE">Chờ chốt</option>
        <option value="FINISHED">Đã kết thúc</option>
      </select>
      <select v-model="filters.format_type" class="select">
        <option value="">Tất cả thể thức</option>
        <option value="GROUP_ONLY">Chỉ vòng bảng</option>
        <option value="KNOCKOUT_ONLY">Chỉ nhánh đấu</option>
        <option value="GROUP_AND_KNOCKOUT">Vòng bảng + nhánh</option>
      </select>
    </div>
    <LoadingBlock v-if="loading" />
    <EmptyState v-else-if="!rows.length" />
    <div v-else class="grid-3">
      <RouterLink
        v-for="item in rows"
        :key="item.id"
        :to="`/portal/competitions/${item.id}`"
        class="glass card card-hover competition-card"
        :class="{
          'world-cup-card': item.competition_mode === 'WORLD_CUP_48',
          'national-card': item.competition_mode === 'NATIONAL_SPECIAL_32',
        }"
      >
        <div class="top">
          <EntityAvatar
            :src="item.logo_url"
            :name="item.name"
            :size="56"
          /><StatusBadge :status="item.status" />
        </div>
        <span class="eyebrow">{{ modeLabel(item) }}</span>
        <h3>{{ item.name }}</h3>
        <p>{{ item.season_name }}</p>
        <div class="metrics">
          <span><Users :size="15" />{{ item.approved_teams }} đội</span
          ><span
            ><Swords :size="15" />{{ item.finished_matches }}/{{
              item.match_count
            }}
            trận</span
          ><span><Trophy :size="15" />Hệ số {{ item.coefficient }}</span>
        </div>
        <div class="bottom">
          <span>{{ date(item.starts_on) }}</span
          ><b>{{ money(item.entry_fee, true) }} phí</b>
        </div>
      </RouterLink>
    </div>
    <PaginationBar v-if="!loading" v-bind="meta" @change="load" />

    <BaseModal
      :open="modal === 'series'"
      title="Tạo hệ giải"
      @close="modal = ''"
      width="560px"
    >
      <form class="form-grid" @submit.prevent="createSeries">
        <label
          ><span class="label">Mã hệ giải</span
          ><input
            v-model="form.code"
            class="input"
            required
            placeholder="C1" /></label
        ><label
          ><span class="label">Tên hệ giải</span
          ><input
            v-model="form.name"
            class="input"
            required
            placeholder="Champions League" /></label
        ><label class="full"
          ><span class="label">Mô tả</span
          ><textarea v-model="form.description" class="textarea" />
        </label>
        <div class="full actions">
          <button type="button" class="btn" @click="modal = ''">Hủy</button
          ><button class="btn btn-primary" :disabled="busy">Tạo hệ giải</button>
        </div>
      </form>
    </BaseModal>

    <BaseModal
      :open="modal === 'competition'"
      title="Tạo giải đấu"
      @close="modal = ''"
      width="940px"
    >
      <form class="form-grid" @submit.prevent="createCompetition">
        <label class="full"
          ><span class="label">Chế độ giải đấu</span
          ><select
            v-model="form.competition_mode"
            class="select"
            @change="handleModeChange"
          >
            <option value="CLUB">Giải CLB thông thường</option>
            <option value="WORLD_CUP_48">World Cup · 48 quốc gia</option>
            <option value="NATIONAL_SPECIAL_32">
              Giải quốc gia đặc biệt · 32 đội knockout
            </option>
          </select></label
        >
        <div
          v-if="form.competition_mode === 'WORLD_CUP_48'"
          class="full preset world"
        >
          <b>✦ World Cup 48</b
          ><span
            >12 bảng × 4 quốc gia, lấy 32 đội vào nhánh và cộng điểm quốc gia
            riêng.</span
          >
        </div>
        <div
          v-if="form.competition_mode === 'NATIONAL_SPECIAL_32'"
          class="full preset national"
        >
          <b>◉ Quốc gia đặc biệt 32</b
          ><span
            >FIFA nhập đội vượt vòng loại; hệ thống chia suất châu lục, tránh
            hạt giống/cùng châu lục và tạo nhánh loại trực tiếp.</span
          >
        </div>
        <label
          ><span class="label">Hệ giải</span
          ><select v-model="form.series_id" class="select" required @change="loadCreationPreset">
            <option value="">Chọn hệ giải</option>
            <option v-for="item in series" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select></label
        >
        <div v-if="presetInfo" class="full inherited-preset">
          <EntityAvatar :src="form.logo_url" :name="presetInfo.source_competition_name" :size="42" />
          <span><b>Đã dùng lại cấu hình mùa trước</b><small>{{ presetInfo.source_competition_name }} · {{ presetInfo.source_season_name }}</small></span>
          <em>Logo và thông số đã tự điền</em>
        </div>
        <div v-else-if="loadingPreset" class="full inherited-preset loading">Đang tìm cấu hình mùa gần nhất…</div>
        <label
          ><span class="label">Mùa giải</span
          ><select v-model="form.season_id" class="select" required>
            <option value="">Chọn mùa</option>
            <option v-for="item in seasons" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select></label
        >
        <label class="full"
          ><span class="label">Tên giải</span
          ><input v-model="form.name" class="input" required
        /></label>
        <label class="full">
          <span class="label">URL logo</span>
          <div class="logo-input">
            <EntityAvatar v-if="form.logo_url" :src="form.logo_url" :name="form.name || 'Giải đấu'" :size="42" />
            <input v-model="form.logo_url" class="input" placeholder="Chỉ nhập lần đầu; mùa sau hệ thống tự dùng lại" />
          </div>
        </label>
        <label v-if="form.competition_mode === 'CLUB'"
          ><span class="label">Thể thức</span
          ><select v-model="form.format_type" class="select">
            <option value="GROUP_ONLY">Chỉ vòng bảng</option>
            <option value="KNOCKOUT_ONLY">Chỉ loại trực tiếp</option>
            <option value="GROUP_AND_KNOCKOUT">Vòng bảng + nhánh</option>
          </select></label
        >
        <label v-if="form.competition_mode === 'CLUB'"
          ><span class="label">Trạng thái ban đầu</span
          ><select v-model="form.status" class="select">
            <option value="DRAFT">Bản nháp</option>
            <option value="REGISTRATION">Mở đăng ký</option>
          </select></label
        >
        <label
          ><span class="label">Hệ số giải</span
          ><input
            v-model="form.coefficient"
            type="number"
            min="0.001"
            step="0.001"
            class="input"
        /></label>
        <label v-if="form.competition_mode === 'CLUB'"
          ><span class="label">Phí tham dự</span
          ><input v-model="form.entry_fee" type="number" min="0" class="input"
        /></label>
        <template
          v-if="
            form.competition_mode === 'CLUB' &&
            form.format_type !== 'KNOCKOUT_ONLY'
          "
        >
          <label
            ><span class="label">Số bảng</span
            ><input
              v-model.number="form.group_count"
              type="number"
              min="0"
              max="128"
              class="input" /></label
          ><label
            ><span class="label">Đội mỗi bảng</span
            ><input
              v-model.number="form.teams_per_group"
              type="number"
              min="0"
              max="128"
              class="input" /></label
          ><label
            ><span class="label">Đội đi tiếp/bảng</span
            ><input
              v-model.number="form.advance_per_group"
              type="number"
              min="0"
              max="128"
              class="input" /></label
          ><label
            ><span class="label">Hạng ba tốt nhất</span
            ><input
              v-model.number="form.best_third_count"
              type="number"
              min="0"
              max="128"
              class="input"
          /></label>
        </template>
        <template v-if="form.competition_mode === 'WORLD_CUP_48'">
          <label
            ><span class="label">Bốc thăm bảng</span
            ><select v-model="form.draw_mode" class="select">
              <option value="POTS">4 nhóm hạt giống</option>
              <option value="FULL_RANDOM">Ngẫu nhiên hoàn toàn</option>
            </select></label
          ><label
            ><span class="label">Ghép vòng 32</span
            ><select v-model="form.pairing_mode" class="select">
              <option value="SEEDED_CONSTRAINED">
                Hạt giống + tránh cùng bảng
              </option>
              <option value="FULL_RANDOM">Ngẫu nhiên + tránh cùng bảng</option>
            </select></label
          ><label
            ><span class="label">Giao diện</span
            ><select v-model="form.visual_theme" class="select">
              <option value="COSMIC_GOLD">Vũ trụ ánh vàng</option>
              <option value="AURORA_BLUE">Cực quang xanh</option>
              <option value="ROYAL_PURPLE">Hoàng gia tím</option>
            </select></label
          ><label
            ><span class="label">Điểm hạ ĐKVĐ</span
            ><input
              v-model="form.champion_upset_points"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Thưởng HCV</span
            ><input
              v-model="form.gold_prize_amount"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Thưởng HCB</span
            ><input
              v-model="form.silver_prize_amount"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Thưởng HCĐ</span
            ><input
              v-model="form.bronze_prize_amount"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Điểm hạ á quân</span
            ><input
              v-model="form.runnerup_upset_points"
              type="number"
              min="0"
              class="input"
          /></label>
        </template>
        <template v-if="form.competition_mode === 'NATIONAL_SPECIAL_32'">
          <label
            ><span class="label">Bốc thăm</span
            ><select v-model="form.draw_mode" class="select">
              <option value="SEEDED_CONSTRAINED">
                Hạt giống + tránh cùng châu lục
              </option>
              <option value="FULL_RANDOM">
                Ngẫu nhiên + tránh cùng châu lục
              </option>
            </select></label
          ><label
            ><span class="label">Giao diện</span
            ><select v-model="form.visual_theme" class="select">
              <option value="CONTINENTAL_GOLD">Lục địa ánh vàng</option>
              <option value="OCEAN_BLUE">Đại dương xanh</option>
              <option value="EMERALD_NIGHT">Ngọc lục bảo</option>
            </select></label
          ><label
            ><span class="label">Thưởng vô địch</span
            ><input
              v-model="form.gold_prize_amount"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Thưởng á quân</span
            ><input
              v-model="form.silver_prize_amount"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Thưởng hạng ba</span
            ><input
              v-model="form.bronze_prize_amount"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Thưởng hạng tư</span
            ><input
              v-model="form.fourth_prize_amount"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Thưởng mỗi đội tứ kết</span
            ><input
              v-model="form.quarterfinal_prize_amount"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Thưởng mỗi đội vòng 16</span
            ><input
              v-model="form.round16_prize_amount"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Thưởng mỗi đội vòng 32</span
            ><input
              v-model="form.round32_prize_amount"
              type="number"
              min="0"
              class="input"
          /></label>
        </template>
        <label
          ><span class="label">Ngày bắt đầu</span
          ><input v-model="form.starts_on" type="date" class="input" /></label
        ><label
          ><span class="label">Ngày kết thúc</span
          ><input v-model="form.ends_on" type="date" class="input"
        /></label>
        <div class="full actions">
          <button type="button" class="btn" @click="modal = ''">Hủy</button
          ><button class="btn btn-primary" :disabled="busy">
            {{ busy ? "Đang tạo..." : "Tạo giải đấu" }}
          </button>
        </div>
      </form>
    </BaseModal>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
  padding: 13px;
}
.competition-card {
  min-height: 285px;
}
.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}
.competition-card h3 {
  font-size: 21px;
  margin: 9px 0 6px;
}
.metrics {
  display: grid;
  gap: 8px;
  margin-top: 20px;
  color: var(--muted);
  font-size: 11px;
}
.metrics span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.bottom {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--line);
  padding-top: 13px;
  margin-top: 18px;
  font-size: 10px;
  color: var(--muted);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
.world-cup-card {
  border-color: rgba(255, 204, 82, 0.28);
  background:
    radial-gradient(
      circle at 90% 5%,
      rgba(255, 204, 82, 0.14),
      transparent 30%
    ),
    linear-gradient(145deg, var(--panel), rgba(8, 20, 44, 0.82));
}
.national-card {
  border-color: rgba(81, 220, 169, 0.28);
  background:
    radial-gradient(
      circle at 90% 5%,
      rgba(81, 220, 169, 0.13),
      transparent 30%
    ),
    linear-gradient(145deg, var(--panel), rgba(7, 34, 40, 0.82));
}
.preset {
  display: grid;
  gap: 5px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 13px;
}
.preset b {
  color: var(--yellow);
}
.preset span {
  color: var(--muted);
  font-size: 11px;
}
.preset.world {
  background: linear-gradient(
    135deg,
    rgba(255, 210, 86, 0.1),
    rgba(66, 109, 255, 0.08)
  );
}
.preset.national {
  background: linear-gradient(
    135deg,
    rgba(85, 227, 169, 0.1),
    rgba(52, 113, 230, 0.08)
  );
}
.preset.national b {
  color: #68e6ae;
}
.inherited-preset {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  border: 1px solid rgba(85, 227, 169, 0.28);
  border-radius: 13px;
  background: rgba(85, 227, 169, 0.07);
}
.inherited-preset span { display: grid; gap: 2px; }
.inherited-preset small { color: var(--muted); }
.inherited-preset em { margin-left: auto; color: #68e6ae; font-size: 10px; font-style: normal; font-weight: 800; }
.inherited-preset.loading { color: var(--muted); font-size: 11px; }
.logo-input { display: flex; align-items: center; gap: 10px; }
.logo-input .input { flex: 1; }
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px;
}
.full {
  grid-column: 1/-1;
}
@media (max-width: 700px) {
  .filters,
  .form-grid {
    grid-template-columns: 1fr;
  }
  .full {
    grid-column: auto;
  }
}
</style>
