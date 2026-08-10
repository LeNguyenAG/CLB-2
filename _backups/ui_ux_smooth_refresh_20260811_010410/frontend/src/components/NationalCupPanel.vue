<script setup>
import { computed, onMounted, ref, watch } from "vue";
import {
  Award,
  CheckCircle2,
  Coins,
  Filter,
  Globe2,
  MapPin,
  Medal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Trash2,
  Trophy,
  Users,
} from "@lucide/vue";
import { api } from "../services/api";
import { uiStore } from "../stores/ui";
import { money, number } from "../utils";
import BaseModal from "./BaseModal.vue";
import EmptyState from "./EmptyState.vue";
import LoadingBlock from "./LoadingBlock.vue";

const props = defineProps({
  competitionId: { type: Number, required: true },
  admin: { type: Boolean, default: false },
});
const loading = ref(true);
const busy = ref(false);
const data = ref(null);
const profiles = ref([]);
const profileScan = ref({ eligible_country_count: 0, metadata_warning_count: 0 });
const entryDrafts = ref([]);
const savedEntrySignature = ref("");
const active = ref("overview");
const countrySearch = ref("");
const playerSearch = ref("");
const confederationFilter = ref("ALL");
const profileSort = ref("RECOMMENDED");
const drawMode = ref("SEEDED_CONSTRAINED");
const modal = ref("");
const selectedMatch = ref(null);
const resultForm = ref({});
const QUOTA_METHOD = "DATABASE_RANKING_HAMILTON";
const SUPPORTED_CONFEDERATIONS = [
  "AFC",
  "CAF",
  "CONCACAF",
  "CONMEBOL",
  "OFC",
  "UEFA",
];

const tabs = computed(() => [
  ["overview", "Tổng quan", Globe2],
  ["entries", props.admin ? "Chọn 32 đại diện" : "32 đại diện", Users],
  ["bracket", "Nhánh loại trực tiếp", Shuffle],
  ["rewards", "Thứ hạng & giải thưởng", Trophy],
]);
const completedMatches = computed(
  () =>
    data.value?.matches?.filter((match) => match.status === "FINISHED")
      .length || 0,
);
function entrySignature(entries) {
  return JSON.stringify(
    entries.map((entry) => [
      Number(entry.player_id),
      Number(entry.country_catalog_id),
      entry.seed_rank ? Number(entry.seed_rank) : null,
    ]),
  );
}
const draftSignature = computed(() => entrySignature(entryDrafts.value));
const draftDirty = computed(
  () => draftSignature.value !== savedEntrySignature.value,
);
const selectionIssues = computed(() => {
  const issues = [];
  const unsupported = entryDrafts.value.filter(
    (entry) => !SUPPORTED_CONFEDERATIONS.includes(entry.confederation),
  );
  if (unsupported.length)
    issues.push(
      `Có ${unsupported.length} đại diện không thuộc 6 châu lục hợp lệ. Hãy xóa trước khi lưu hoặc tính lại suất.`,
    );
  const seeds = entryDrafts.value
    .map((entry) => (entry.seed_rank ? Number(entry.seed_rank) : null))
    .filter(Boolean);
  if (new Set(seeds).size !== seeds.length)
    issues.push("Thứ hạng hạt giống đang bị trùng.");
  for (const quota of data.value?.quotas || []) {
    const selected = entryDrafts.value.filter(
      (entry) => entry.confederation === quota.confederation,
    ).length;
    if (selected > Number(quota.slot_count))
      issues.push(
        `${quota.confederation} đang vượt ${selected - Number(quota.slot_count)} suất.`,
      );
  }
  return issues;
});
const canSaveEntries = computed(
  () => draftDirty.value && selectionIssues.value.length === 0,
);
const canDraw = computed(
  () =>
    !draftDirty.value &&
    data.value?.profile?.quota_method === QUOTA_METHOD &&
    entryDrafts.value.length === 32 &&
    selectionIssues.value.length === 0 &&
    (data.value?.quotas || []).every(
      (quota) =>
        entryDrafts.value.filter(
          (entry) => entry.confederation === quota.confederation,
        ).length === Number(quota.slot_count),
    ),
);
const confederationMeta = {
  AFC: { name: "Châu Á", color: "#58a6ff", symbol: "AS" },
  CAF: { name: "Châu Phi", color: "#f6ad55", symbol: "AF" },
  CONCACAF: { name: "Bắc, Trung Mỹ & Caribe", color: "#c084fc", symbol: "NA" },
  CONMEBOL: { name: "Nam Mỹ", color: "#4ade80", symbol: "SA" },
  OFC: { name: "Châu Đại Dương", color: "#22d3ee", symbol: "OC" },
  UEFA: { name: "Châu Âu", color: "#facc15", symbol: "EU" },
};
const unknownConfederationMeta = {
  name: "Không hợp lệ",
  color: "#94a3b8",
  symbol: "—",
};
const quotaSummary = computed(() =>
  (data.value?.quotas || [])
    .filter((quota) => SUPPORTED_CONFEDERATIONS.includes(quota.confederation))
    .map((quota) => ({
      ...quota,
      ...quotaStatus(quota),
      meta: confederationInfo(quota.confederation),
    })),
);
const openQuotas = computed(() =>
  quotaSummary.value.filter((quota) => !quota.complete),
);
const completedConfederations = computed(() =>
  quotaSummary.value.filter((quota) => quota.complete),
);
const remainingSlots = computed(() =>
  Math.max(0, 32 - entryDrafts.value.length),
);
const availableProfiles = computed(() => {
  const selectedPlayers = new Set(
    entryDrafts.value.map((entry) => Number(entry.player_id)),
  );
  const selectedCountries = new Set(
    entryDrafts.value.map((entry) => Number(entry.country_catalog_id)),
  );
  const openConfederations = new Set(
    openQuotas.value.map((quota) => quota.confederation),
  );
  const countryTerm = countrySearch.value.trim().toLowerCase();
  const playerTerm = playerSearch.value.trim().toLowerCase();
  return profiles.value
    .filter(
      (profile) =>
        !selectedPlayers.has(Number(profile.player_id)) &&
        !selectedCountries.has(Number(profile.country_catalog_id)) &&
        profile.is_active &&
        profile.country_catalog_id &&
        openConfederations.has(profile.confederation),
    )
    .filter(
      (profile) =>
        confederationFilter.value === "ALL" ||
        profile.confederation === confederationFilter.value,
    )
    .filter((profile) =>
      !countryTerm ||
      `${profile.country_name} ${profile.country_name_en || ""} ${profile.legacy_country_name || ""} ${profile.country_code || ""}`
        .toLowerCase()
        .includes(countryTerm),
    )
    .filter((profile) =>
      !playerTerm ||
      `${profile.full_name} ${profile.current_club_name || ""}`
        .toLowerCase()
        .includes(playerTerm),
    )
    .sort((a, b) => {
      if (profileSort.value === "COUNTRY_AZ")
        return (a.country_name || "").localeCompare(b.country_name || "", "vi");
      if (profileSort.value === "PLAYER_AZ")
        return (a.full_name || "").localeCompare(b.full_name || "", "vi");
      if (profileSort.value === "SEED")
        return Number(a.world_seed_rank || 9999) - Number(b.world_seed_rank || 9999)
          || (a.country_name || "").localeCompare(b.country_name || "", "vi");
      const quotaA = openQuotas.value.find((quota) => quota.confederation === a.confederation);
      const quotaB = openQuotas.value.find((quota) => quota.confederation === b.confederation);
      return Number(quotaB?.remaining || 0) - Number(quotaA?.remaining || 0)
        || Number(a.world_seed_rank || 9999) - Number(b.world_seed_rank || 9999)
        || (a.country_name || "").localeCompare(b.country_name || "", "vi");
    });
});
const roundsWithMatches = computed(() =>
  (data.value?.rounds || []).map((round) => ({
    ...round,
    matches: data.value.matches.filter(
      (match) => Number(match.round_id) === Number(round.id),
    ),
  })),
);

function medal(placement) {
  return Number(placement) === 1
    ? "🥇"
    : Number(placement) === 2
      ? "🥈"
      : Number(placement) === 3
        ? "🥉"
        : `#${placement}`;
}
function quotaStatus(quota) {
  const selected = entryDrafts.value.filter(
    (entry) => entry.confederation === quota.confederation,
  ).length;
  return {
    selected,
    complete: selected === Number(quota.slot_count),
    exceeded: selected > Number(quota.slot_count),
    remaining: Math.max(0, Number(quota.slot_count) - selected),
    progress: Math.min(100, (selected / Number(quota.slot_count)) * 100),
  };
}
function confederationInfo(code) {
  return confederationMeta[code] || unknownConfederationMeta;
}
function percentage(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}
function quotaReason(quota) {
  if (data.value.profile.quota_method !== QUOTA_METHOD) {
    return "Hạn ngạch cũ · bấm Tính lại để áp dụng công thức dữ liệu v2.0.19";
  }
  const capacity = quota.is_capacity_limited
    ? " · đã chạm giới hạn quốc gia khả dụng"
    : "";
  return `${percentage(quota.availability_share)} tỷ trọng dữ liệu · ${quota.strong_country_count || 0} quốc gia trong nhóm mạnh${capacity}`;
}
function clearFilters() {
  countrySearch.value = "";
  playerSearch.value = "";
  confederationFilter.value = "ALL";
  profileSort.value = "RECOMMENDED";
}
async function load() {
  loading.value = true;
  try {
    const requests = [
      api.get(
        `/competitions/${props.competitionId}/national-tournament`,
        null,
        { auth: props.admin },
      ),
    ];
    if (props.admin)
      requests.push(api.get("/national-tournament/eligible-profiles"));
    const [detail, profileList] = await Promise.all(requests);
    data.value = detail.data;
    profiles.value = profileList?.data?.profiles || [];
    profileScan.value = profileList?.data || {
      eligible_country_count: 0,
      metadata_warning_count: 0,
    };
    drawMode.value = data.value.profile.draw_mode;
    entryDrafts.value = data.value.entries.map((entry) => ({
      ...entry,
      full_name: entry.player_name,
    }));
    savedEntrySignature.value = entrySignature(entryDrafts.value);
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function addProfile(profile) {
  const quota = data.value.quotas.find(
    (item) => item.confederation === profile.confederation,
  );
  const used = entryDrafts.value.filter(
    (item) => item.confederation === profile.confederation,
  ).length;
  if (!quota || used >= Number(quota.slot_count)) {
    uiStore.notify(`${profile.confederation} đã đủ suất.`, "warning");
    return;
  }
  if (
    entryDrafts.value.some(
      (item) =>
        Number(item.country_catalog_id) === Number(profile.country_catalog_id),
    )
  ) {
    uiStore.notify("Quốc gia này đã có một cầu thủ đại diện.", "warning");
    return;
  }
  entryDrafts.value.push({
    player_id: profile.player_id,
    full_name: profile.full_name,
    photo_url: profile.photo_url,
    current_club_name: profile.current_club_name,
    country_catalog_id: profile.country_catalog_id,
    country_name: profile.country_name,
    country_code: profile.country_code,
    flag_url: profile.flag_url,
    confederation: profile.confederation,
    seed_rank: profile.world_seed_rank || null,
  });
  const nowUsed = used + 1;
  if (nowUsed === Number(quota.slot_count)) {
    if (confederationFilter.value === profile.confederation)
      confederationFilter.value = "ALL";
    uiStore.notify(
      `${confederationInfo(profile.confederation).name} đã đủ ${quota.slot_count} suất và được ẩn khỏi danh sách chọn.`,
    );
  }
}
function removeEntry(index) {
  const [removed] = entryDrafts.value.splice(index, 1);
  if (removed?.confederation) {
    confederationFilter.value = removed.confederation;
    uiStore.notify(
      `${confederationInfo(removed.confederation).name} đã mở lại danh sách quốc gia còn suất.`,
    );
  }
}
async function saveEntries() {
  if (selectionIssues.value.length) {
    uiStore.notify(selectionIssues.value[0], "warning");
    return;
  }
  busy.value = true;
  try {
    await api.put(
      `/competitions/${props.competitionId}/national-tournament/entries`,
      {
        entries: entryDrafts.value.map((entry) => ({
          player_id: entry.player_id,
          seed_rank: entry.seed_rank || null,
        })),
      },
    );
    uiStore.notify(`Đã lưu ${entryDrafts.value.length}/32 đại diện.`);
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}
async function recalculateQuotas() {
  if (draftDirty.value) {
    uiStore.notify(
      "Bạn đang có thay đổi chưa lưu. Hãy lưu hoặc tải lại danh sách trước khi tính lại hạn ngạch.",
      "warning",
    );
    return;
  }
  busy.value = true;
  try {
    const response = await api.post(
      `/competitions/${props.competitionId}/national-tournament/recalculate-quotas`,
      {},
    );
    uiStore.notify(response.data.message);
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}
watch(openQuotas, (openRows) => {
  if (
    confederationFilter.value !== "ALL" &&
    !openRows.some(
      (quota) => quota.confederation === confederationFilter.value,
    )
  ) {
    confederationFilter.value = "ALL";
  }
});
async function drawBracket() {
  busy.value = true;
  try {
    const response = await api.post(
      `/competitions/${props.competitionId}/national-tournament/draw`,
      { mode: drawMode.value },
    );
    uiStore.notify(
      response.data.warning || response.data.message,
      response.data.warning ? "warning" : "success",
    );
    active.value = "bracket";
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}
function openResult(match) {
  selectedMatch.value = match;
  resultForm.value = {
    home_score: match.home_score ?? 0,
    away_score: match.away_score ?? 0,
    home_penalty_score: match.home_penalty_score ?? "",
    away_penalty_score: match.away_penalty_score ?? "",
    note: match.note || "",
  };
  modal.value = "result";
}
async function saveResult() {
  busy.value = true;
  try {
    await api.post(
      `/national-tournament/matches/${selectedMatch.value.id}/result`,
      resultForm.value,
    );
    uiStore.notify("Đã lưu tỷ số và cập nhật nhánh đấu.");
    modal.value = "";
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}
async function saveRewards() {
  busy.value = true;
  try {
    await api.put(
      `/competitions/${props.competitionId}/national-tournament/reward-rules`,
      {
        rules: data.value.rewardRules.map((rule) => ({
          id: rule.id,
          prize_amount: rule.prize_amount,
        })),
      },
    );
    uiStore.notify("Đã lưu tiền thưởng; hệ số điểm cân bằng được giữ nguyên.");
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}
async function finalizeTournament() {
  if (
    !window.confirm(
      "Chốt hạng 1–32, trao huy chương, danh hiệu, tiền và điểm cho cầu thủ đại diện?",
    )
  )
    return;
  busy.value = true;
  try {
    const response = await api.post(
      `/competitions/${props.competitionId}/national-tournament/finalize`,
      {},
    );
    uiStore.notify(response.data.message);
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}
async function resetTournament() {
  if (
    !window.confirm(
      "Xóa toàn bộ nhánh, tỷ số và phần thưởng của giải này? Danh sách 32 đại diện vẫn được giữ.",
    )
  )
    return;
  busy.value = true;
  try {
    const response = await api.post(
      `/competitions/${props.competitionId}/national-tournament/reset`,
      {},
    );
    uiStore.notify(response.data.message);
    active.value = "entries";
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <LoadingBlock v-if="loading" />
  <div
    v-else-if="data"
    class="national-cup"
    :class="`theme-${data.profile.visual_theme.toLowerCase()}`"
  >
    <section class="national-hero">
      <div class="hero-mark"><Globe2 :size="43" /><span>32</span></div>
      <div>
        <span class="eyebrow">Continental Nations Championship</span>
        <h1>{{ data.profile.competition_name }}</h1>
        <p>
          {{ data.profile.series_name }} · {{ data.profile.season_name }} · Hệ
          số {{ data.profile.coefficient }}
        </p>
      </div>
      <div class="hero-progress">
        <b>{{ completedMatches }}/32</b><small>trận hoàn tất</small
        ><strong>{{ data.entries.length }}/32 quốc gia</strong>
      </div>
    </section>

    <nav class="national-tabs">
      <button
        v-for="tab in tabs"
        :key="tab[0]"
        :class="{ active: active === tab[0] }"
        @click="active = tab[0]"
      >
        <component :is="tab[2]" :size="15" />{{ tab[1] }}
      </button>
    </nav>

    <section v-if="active === 'overview'" class="overview-grid">
      <article class="glass card quota-card">
        <div class="section-title">
          <div>
            <span class="eyebrow">Phân bổ công bằng</span>
            <h2>32 suất theo châu lục</h2>
            <p>
              Chỉ dùng 6 châu lục và dữ liệu hiện có trong hệ thống: 60% theo
              số quốc gia hợp lệ, 40% theo số quốc gia nằm trong nhóm xếp hạng
              mạnh hiện tại. Không dùng suất ngoài đời hoặc Khu vực khác.
            </p>
          </div>
          <button
            v-if="admin && !data.profile.entries_locked_at"
            class="btn btn-sm"
            :disabled="busy || draftDirty"
            :title="
              draftDirty
                ? 'Hãy lưu hoặc hoàn tác danh sách đang sửa trước.'
                : 'Quét lại số quốc gia hợp lệ và bảng xếp hạng hiện tại.'
            "
            @click="recalculateQuotas"
          >
            <RefreshCw :size="14" />Tính lại
          </button>
        </div>
        <div class="quota-grid">
          <div
            v-for="quota in quotaSummary"
            :key="quota.id"
            :class="{ complete: quotaStatus(quota).complete }"
            :style="{ '--quota-color': quota.meta.color }"
          >
            <div class="quota-head">
              <span class="confederation-symbol">{{ quota.meta.symbol }}</span>
              <span>{{ quota.meta.name }} · {{ quota.confederation }}</span>
            </div>
            <b>{{ quota.slot_count }} suất</b
            ><small
              >{{ quotaStatus(quota).selected }}/{{ quota.slot_count }} đã chọn
              · tối đa {{ quota.available_country_count }} quốc gia</small
            ><small class="quota-reason">{{ quotaReason(quota) }}</small
            ><div class="quota-metrics">
              <span>{{ quota.available_country_count }} quốc gia hợp lệ</span>
              <span>{{ quota.strong_country_count || 0 }} quốc gia mạnh</span>
              <span>60% quy mô DB</span>
              <span>40% xếp hạng</span>
            </div
            ><i
              :style="{
                width: `${quotaStatus(quota).progress}%`,
              }"
            />
          </div>
        </div>
        <div class="fairness-note">
          <ShieldCheck :size="17" />
          <span
            ><b>Khóa chống suất ảo:</b> mọi châu lục luôn có số suất nhỏ hơn
            hoặc bằng số quốc gia thực tế có thể chọn.</span
          >
        </div>
      </article>
      <article class="glass card balance-card">
        <span class="eyebrow"><Sparkles :size="14" /> Hệ số cân bằng</span>
        <h2>Điểm cấp quốc gia</h2>
        <p>
          Giải này mặc định hệ số 1,5: mạnh hơn giải CLB thông thường, nhưng
          thấp hơn World Cup 48 mặc định 2,0.
        </p>
        <div class="point-ladder">
          <div v-for="rule in data.rewardRules" :key="rule.id">
            <b>{{ rule.placement_label }}</b
            ><span
              >{{ rule.base_ranking_points }} ×
              {{ data.profile.coefficient }}</span
            ><strong
              >{{
                number(
                  Number(rule.base_ranking_points) *
                    Number(data.profile.coefficient),
                )
              }}
              điểm</strong
            >
          </div>
        </div>
      </article>
    </section>

    <section
      v-else-if="active === 'entries'"
      class="entries-layout"
      :class="{ public: !admin }"
    >
      <article class="glass card selected-entries">
        <div class="section-title">
          <div>
            <span class="eyebrow">Đại diện chính thức</span>
            <h2>Quốc gia · Cầu thủ đại diện</h2>
          </div>
          <div v-if="admin" class="entry-actions">
            <button
              class="btn"
              :disabled="
                busy || data.profile.entries_locked_at || !canSaveEntries
              "
              @click="saveEntries"
            >
              <CheckCircle2 :size="15" />{{
                draftDirty ? "Lưu danh sách" : "Đã lưu"
              }}</button
            ><button
              v-if="draftDirty"
              class="btn"
              :disabled="busy"
              @click="load"
            >
              <RotateCcw :size="15" />Hoàn tác</button
            ><select
              v-model="drawMode"
              class="select"
              :disabled="data.profile.entries_locked_at"
            >
              <option value="SEEDED_CONSTRAINED">
                Hạt giống + tránh cùng châu lục
              </option>
              <option value="FULL_RANDOM">
                Ngẫu nhiên + tránh cùng châu lục
              </option></select
            ><button
              class="btn btn-primary"
              :disabled="busy || !canDraw || data.profile.entries_locked_at"
              :title="
                draftDirty
                  ? 'Phải lưu danh sách trước khi bốc thăm.'
                  : !canDraw
                    ? 'Cần đủ đúng 32 đại diện và đúng suất từng châu lục.'
                    : 'Bốc thăm nhánh 32 đội.'
              "
              @click="drawBracket"
            >
              <Shuffle :size="15" />Bốc thăm nhánh
            </button>
          </div>
        </div>
        <div v-if="admin" class="selection-dashboard">
          <div>
            <span>Đã chọn</span><b>{{ entryDrafts.length }}/32</b>
          </div>
          <div>
            <span>Còn thiếu</span><b>{{ remainingSlots }} đội</b>
          </div>
          <div>
            <span>Khu vực đủ suất</span
            ><b>{{ completedConfederations.length }}/{{ quotaSummary.length }}</b>
          </div>
          <div class="selection-bar">
            <i :style="{ width: `${(entryDrafts.length / 32) * 100}%` }" />
          </div>
        </div>
        <div
          v-if="
            admin &&
            data.profile.quota_method !== QUOTA_METHOD
          "
          class="quota-stale"
        >
          <RefreshCw :size="15" />
          <span
            ><b>Hạn ngạch của giải đang dùng công thức cũ.</b> Hãy hoàn tất hoặc
            hoàn tác thay đổi danh sách, rồi bấm “Tính lại hạn ngạch”.</span
          >
          <button
            class="btn btn-sm"
            :disabled="busy || draftDirty"
            @click="recalculateQuotas"
          >
            Tính lại
          </button>
        </div>
        <div v-if="draftDirty" class="draft-notice">
          <Sparkles :size="14" />
          <span
            >Danh sách có thay đổi chưa lưu. Bốc thăm đang được khóa để tránh
            dùng nhầm dữ liệu cũ.</span
          >
        </div>
        <div v-if="selectionIssues.length" class="selection-errors">
          <ShieldCheck :size="14" />
          <span>{{ selectionIssues.join(" ") }}</span>
        </div>
        <div v-if="admin" class="region-progress">
          <button
            v-for="quota in quotaSummary"
            :key="quota.confederation"
            type="button"
            :class="{
              complete: quota.complete,
              active: confederationFilter === quota.confederation,
            }"
            :style="{ '--quota-color': quota.meta.color }"
            :disabled="quota.complete"
            @click="confederationFilter = quota.confederation"
          >
            <span>{{ quota.meta.symbol }}</span>
            <b>{{ quota.meta.name }}</b>
            <small>{{ quota.selected }}/{{ quota.slot_count }}</small>
            <CheckCircle2 v-if="quota.complete" :size="14" />
          </button>
        </div>
        <EmptyState
          v-if="!entryDrafts.length"
          message="Chưa chọn quốc gia đại diện."
        />
        <div v-else class="entry-grid">
          <article v-for="(entry, index) in entryDrafts" :key="entry.player_id">
            <div class="flag">
              {{ entry.flag_emoji || "🌐"
              }}<img v-if="entry.flag_url" :src="entry.flag_url" alt="" />
            </div>
            <div>
              <b>{{ entry.country_name }}</b
              ><span>{{ entry.full_name || entry.player_name }}</span
              ><small
                >{{ entry.confederation }} ·
                {{ entry.current_club_name || "Cầu thủ tự do" }}</small
              >
            </div>
            <label v-if="admin && !data.profile.entries_locked_at"
              ><small>Hạt giống</small
              ><input
                v-model.number="entry.seed_rank"
                type="number"
                min="1"
                max="999"
                class="input"
                placeholder="—" /></label
            ><em v-else>{{
              entry.seed_rank ? `#${entry.seed_rank}` : "Không hạt giống"
            }}</em
            ><button
              v-if="admin && !data.profile.entries_locked_at"
              class="remove"
              @click="removeEntry(index)"
            >
              <Trash2 :size="14" />
            </button>
          </article>
        </div>
      </article>
      <aside
        v-if="admin && !data.profile.entries_locked_at"
        class="glass card profile-pool"
      >
        <div class="pool-title">
          <div>
            <span class="eyebrow">Quét hồ sơ hợp lệ</span>
            <h2>Chọn đại diện</h2>
          </div>
          <span class="pool-count">{{ availableProfiles.length }}</span>
        </div>
        <div class="scan-summary">
          <ShieldCheck :size="14" />
          <span
            >Đã quét {{ profileScan.eligible_country_count }} quốc gia hợp lệ ·
            đang hiển thị {{ availableProfiles.length }} lựa chọn còn suất.</span
          >
        </div>
        <div v-if="profileScan.metadata_warning_count" class="catalog-note">
          {{ profileScan.metadata_warning_count }} hồ sơ cũ có tên, mã hoặc khu
          vực lệch. Màn hình này dùng thư viện quốc gia chuẩn để tránh chia sai
          châu lục.
        </div>
        <div class="filter-stack">
          <label class="search"
            ><Globe2 :size="15" /><input
              v-model="countrySearch"
              placeholder="Lọc theo tên quốc gia..."
          /></label>
          <label class="search"
            ><Search :size="15" /><input
              v-model="playerSearch"
              placeholder="Lọc theo cầu thủ hoặc CLB..."
          /></label>
          <label class="filter-field">
            <MapPin :size="15" />
            <select v-model="confederationFilter" class="select">
              <option value="ALL">Tất cả khu vực còn suất</option>
              <option
                v-for="quota in openQuotas"
                :key="quota.confederation"
                :value="quota.confederation"
              >
                {{ quota.meta.name }} · còn {{ quota.remaining }} suất
              </option>
            </select>
          </label>
          <label class="filter-field">
            <Filter :size="15" />
            <select v-model="profileSort" class="select">
              <option value="RECOMMENDED">Gợi ý khu vực thiếu nhiều</option>
              <option value="SEED">Hạt giống cao trước</option>
              <option value="COUNTRY_AZ">Quốc gia A–Z</option>
              <option value="PLAYER_AZ">Cầu thủ A–Z</option>
            </select>
          </label>
        </div>
        <div v-if="completedConfederations.length" class="hidden-regions">
          <ShieldCheck :size="14" />
          <span
            >Đã tự ẩn:
            {{
              completedConfederations.map((quota) => quota.meta.name).join(", ")
            }}</span
          >
        </div>
        <button
          v-if="countrySearch || playerSearch || confederationFilter !== 'ALL' || profileSort !== 'RECOMMENDED'"
          type="button"
          class="clear-filters"
          @click="clearFilters"
        >
          Xóa bộ lọc
        </button>
        <div class="pool-list">
          <button
            v-for="profile in availableProfiles"
            :key="profile.player_id"
            :style="{
              '--profile-color': confederationInfo(profile.confederation).color,
            }"
            @click="addProfile(profile)"
          >
            <span class="pool-flag"
              >{{ profile.flag_emoji || "🌐"
              }}<img v-if="profile.flag_url" :src="profile.flag_url" alt=""
            /></span>
            <div>
              <b>{{ profile.country_name }}</b
              ><small
                >{{ profile.full_name }} ·
                {{ profile.current_club_name || "Cầu thủ tự do" }}</small
              >
              <em
                >{{ confederationInfo(profile.confederation).name }} ·
                {{
                  profile.world_seed_rank
                    ? `hạt giống #${profile.world_seed_rank}`
                    : "chưa xếp hạt giống"
                }}</em
              >
              <span
                v-if="profile.catalog_metadata_changed"
                class="normalized-badge"
                >Đã chuẩn hóa theo thư viện quốc gia</span
              >
            </div>
            <Plus :size="15" />
          </button>
          <EmptyState
            v-if="!availableProfiles.length"
            :message="
              openQuotas.length
                ? 'Không có hồ sơ phù hợp bộ lọc hiện tại.'
                : 'Tất cả châu lục đã đủ suất. Danh sách 32 đội đã sẵn sàng.'
            "
          />
        </div>
      </aside>
    </section>

    <section v-else-if="active === 'bracket'" class="bracket-stage">
      <div class="stage-heading">
        <div>
          <span class="eyebrow">Knockout Road</span>
          <h2>Nhánh đấu 32 quốc gia</h2>
          <p>Quốc gia luôn hiển thị cùng cầu thủ đại diện.</p>
        </div>
        <span
          v-if="data.matches.some((m) => m.same_confederation_pair)"
          class="constraint-note"
          >Có
          {{ data.matches.filter((m) => m.same_confederation_pair).length }} cặp
          cùng liên đoàn không thể tránh</span
        >
      </div>
      <EmptyState
        v-if="!data.rounds.length"
        message="Chưa bốc thăm nhánh đấu."
      />
      <div v-else class="bracket-scroll">
        <section
          v-for="round in roundsWithMatches"
          :key="round.id"
          class="round-column"
        >
          <header>
            <small>{{ round.round_code }}</small>
            <h3>{{ round.round_name }}</h3>
            <span>{{ round.status }}</span>
          </header>
          <article
            v-for="match in round.matches"
            :key="match.id"
            class="national-match"
            :class="{
              finished: match.status === 'FINISHED',
              same: match.same_confederation_pair,
            }"
          >
            <div>
              <span
                ><b>{{ match.home_country_name || "Chờ xác định" }}</b
                ><small>{{ match.home_player_name || "—" }}</small></span
              ><strong>{{ match.home_score ?? "–" }}</strong>
            </div>
            <div>
              <span
                ><b>{{ match.away_country_name || "Chờ xác định" }}</b
                ><small>{{ match.away_player_name || "—" }}</small></span
              ><strong>{{ match.away_score ?? "–" }}</strong>
            </div>
            <button
              v-if="admin && match.home_entry_id && match.away_entry_id"
              class="btn btn-sm"
              @click="openResult(match)"
            >
              {{ match.status === "FINISHED" ? "Sửa tỷ số" : "Nhập tỷ số" }}
            </button>
          </article>
        </section>
      </div>
    </section>

    <section v-else class="rewards-grid">
      <article class="glass card">
        <div class="section-title">
          <div>
            <span class="eyebrow"><Coins :size="14" /> Prize Control</span>
            <h2>Tiền thưởng & điểm</h2>
            <p>
              Admin sửa tiền; điểm cơ bản được khóa để bảo vệ cân bằng toàn hệ
              thống.
            </p>
          </div>
          <button
            v-if="admin && !data.profile.tournament_finalized_at"
            class="btn btn-primary"
            :disabled="busy"
            @click="saveRewards"
          >
            Lưu tiền thưởng
          </button>
        </div>
        <div class="rules-table">
          <div v-for="rule in data.rewardRules" :key="rule.id">
            <span>{{
              rule.medal_type === "GOLD"
                ? "🥇"
                : rule.medal_type === "SILVER"
                  ? "🥈"
                  : rule.medal_type === "BRONZE"
                    ? "🥉"
                    : "⚔️"
            }}</span>
            <div>
              <b>{{ rule.placement_label }}</b
              ><small
                >Hạng {{ rule.placement_from
                }}{{
                  rule.placement_to !== rule.placement_from
                    ? `–${rule.placement_to}`
                    : ""
                }}
                ·
                {{
                  number(
                    Number(rule.base_ranking_points) *
                      Number(data.profile.coefficient),
                  )
                }}
                điểm/người</small
              >
            </div>
            <input
              v-if="admin && !data.profile.tournament_finalized_at"
              v-model="rule.prize_amount"
              type="number"
              min="0"
              class="input"
            /><strong v-else>{{ money(rule.prize_amount) }}</strong>
          </div>
        </div>
      </article>
      <article class="glass card final-results">
        <span class="eyebrow"><Medal :size="14" /> Final ranking</span>
        <h2>Thứ hạng 1–32</h2>
        <EmptyState
          v-if="!data.results.length"
          message="Kết quả xuất hiện sau khi FIFA chốt giải."
        />
        <div v-else>
          <article v-for="result in data.results" :key="result.id">
            <span>{{ medal(result.placement) }}</span>
            <div>
              <b>{{ result.country_name }}</b
              ><small>{{ result.player_name }}</small>
            </div>
            <strong>+{{ number(result.ranking_points) }}</strong>
          </article>
        </div>
      </article>
      <article class="glass card award-wall">
        <span class="eyebrow"><Award :size="14" /> Individual awards</span>
        <h2>Danh hiệu tự động</h2>
        <p>
          Hệ thống xét toàn bộ nhánh theo bàn thắng của đội tuyển, số trận
          thắng, sạch lưới, bàn thua, thứ hạng và hạt giống.
        </p>
        <div>
          <article v-for="award in data.awards" :key="award.id">
            <span>🏆</span>
            <div>
              <b>{{ award.award_name }}</b
              ><small
                >{{ award.player_name }} ·
                {{ award.country_name_at_award }}</small
              >
            </div>
            <strong>+{{ number(award.awarded_points) }}</strong>
          </article>
        </div>
      </article>
      <article v-if="admin" class="glass card finalize-card">
        <Trophy :size="40" />
        <div>
          <h2>Chốt giải chính thức</h2>
          <p>
            Trao đủ hạng 1–32, huy chương, 3 danh hiệu cá nhân, tiền thưởng và
            điểm cho cả BXH tổng thể lẫn BXH quốc gia.
          </p>
        </div>
        <button
          class="btn btn-success"
          :disabled="
            busy ||
            completedMatches !== 32 ||
            data.profile.tournament_finalized_at
          "
          @click="finalizeTournament"
        >
          <CheckCircle2 :size="16" />Chốt & trao giải</button
        ><button
          class="btn btn-danger"
          :disabled="busy || data.profile.tournament_finalized_at"
          @click="resetTournament"
        >
          <RotateCcw :size="16" />Reset giải
        </button>
      </article>
    </section>

    <BaseModal
      :open="modal === 'result'"
      :title="`${selectedMatch?.home_country_name} (${selectedMatch?.home_player_name}) vs ${selectedMatch?.away_country_name} (${selectedMatch?.away_player_name})`"
      @close="modal = ''"
      width="620px"
      ><form class="result-form" @submit.prevent="saveResult">
        <label
          ><span class="label">Tỷ số đội nhà</span
          ><input
            v-model.number="resultForm.home_score"
            type="number"
            min="0"
            class="input"
            required /></label
        ><label
          ><span class="label">Tỷ số đội khách</span
          ><input
            v-model.number="resultForm.away_score"
            type="number"
            min="0"
            class="input"
            required /></label
        ><label
          ><span class="label">Luân lưu đội nhà (nếu hòa)</span
          ><input
            v-model="resultForm.home_penalty_score"
            type="number"
            min="0"
            class="input" /></label
        ><label
          ><span class="label">Luân lưu đội khách (nếu hòa)</span
          ><input
            v-model="resultForm.away_penalty_score"
            type="number"
            min="0"
            class="input" /></label
        ><label class="full"
          ><span class="label">Ghi chú</span
          ><textarea v-model="resultForm.note" class="textarea" />
        </label>
        <div class="full actions">
          <button type="button" class="btn" @click="modal = ''">Hủy</button
          ><button class="btn btn-primary" :disabled="busy">Lưu kết quả</button>
        </div>
      </form></BaseModal
    >
  </div>
</template>

<style scoped>
.national-cup {
  display: grid;
  gap: 18px;
  --nation-accent: #f2c45d;
  --nation-secondary: #437ef0;
}
.theme-ocean_blue {
  --nation-accent: #67dcff;
  --nation-secondary: #2564e8;
}
.theme-emerald_night {
  --nation-accent: #61e4a7;
  --nation-secondary: #277b69;
}
.national-hero {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 18px;
  padding: 25px;
  border: 1px solid color-mix(in srgb, var(--nation-accent) 28%, transparent);
  border-radius: 22px;
  background:
    radial-gradient(
      circle at 85% 0,
      color-mix(in srgb, var(--nation-secondary) 24%, transparent),
      transparent 34%
    ),
    radial-gradient(
      circle at 10% 10%,
      color-mix(in srgb, var(--nation-accent) 19%, transparent),
      transparent 27%
    ),
    linear-gradient(135deg, #071426, #12294a);
}
.hero-mark {
  width: 78px;
  height: 78px;
  position: relative;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--nation-accent);
  border: 1px solid color-mix(in srgb, var(--nation-accent) 40%, transparent);
  box-shadow: inset 0 0 26px
    color-mix(in srgb, var(--nation-accent) 12%, transparent);
}
.hero-mark span {
  position: absolute;
  right: -5px;
  bottom: -2px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--nation-accent);
  color: #07111f;
  font-weight: 950;
}
.national-hero h1 {
  margin: 5px 0;
  font-size: clamp(27px, 4vw, 45px);
}
.national-hero p {
  margin: 0;
}
.hero-progress {
  text-align: right;
  display: grid;
}
.hero-progress b {
  font: 900 26px Manrope;
  color: var(--nation-accent);
}
.hero-progress small {
  color: var(--muted);
}
.hero-progress strong {
  margin-top: 9px;
}
.national-tabs {
  display: flex;
  gap: 8px;
  overflow: auto;
}
.national-tabs button {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  padding: 11px 14px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--panel-2);
  color: var(--muted);
  font-weight: 850;
}
.national-tabs button.active {
  color: #07111f;
  background: linear-gradient(
    135deg,
    var(--nation-accent),
    color-mix(in srgb, var(--nation-accent) 68%, white)
  );
  border-color: transparent;
}
.overview-grid,
.rewards-grid {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 18px;
}
.quota-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 9px;
}
.quota-grid > div {
  position: relative;
  overflow: hidden;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background:
    radial-gradient(circle at 100% 0, color-mix(in srgb, var(--quota-color) 14%, transparent), transparent 48%),
    rgba(255, 255, 255, 0.018);
  transition: border-color 160ms ease, transform 160ms ease;
}
.quota-grid > div:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--quota-color) 40%, var(--line));
}
.quota-grid span,
.quota-grid b,
.quota-grid small {
  display: block;
  position: relative;
  z-index: 1;
}
.quota-grid span {
  font-size: 9px;
  color: var(--muted);
}
.quota-grid b {
  margin: 3px 0;
  font-size: 17px;
}
.quota-grid small {
  font-size: 9px;
  color: var(--muted);
}
.quota-grid i {
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: var(--quota-color);
  box-shadow: 0 0 12px color-mix(in srgb, var(--quota-color) 50%, transparent);
  transition: width 220ms ease;
}
.quota-grid .complete {
  border-color: color-mix(in srgb, #45d497 55%, transparent);
  box-shadow: inset 0 0 0 1px rgba(69, 212, 151, 0.06);
}
.quota-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.confederation-symbol {
  width: 25px;
  height: 25px;
  display: grid !important;
  place-items: center;
  border-radius: 8px;
  color: #07111f !important;
  background: var(--quota-color);
  font-weight: 950;
  letter-spacing: -0.04em;
}
.quota-reason {
  margin-top: 6px;
  line-height: 1.45;
  color: color-mix(in srgb, var(--quota-color) 75%, var(--muted)) !important;
}
.quota-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  padding-bottom: 2px;
}
.quota-metrics span {
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--quota-color) 17%, var(--line));
  border-radius: 99px;
  background: color-mix(in srgb, var(--quota-color) 5%, transparent);
  color: color-mix(in srgb, var(--quota-color) 72%, var(--muted));
  font-size: 8px;
}
.fairness-note {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  margin-top: 13px;
  padding: 10px 12px;
  border: 1px solid rgba(69, 212, 151, 0.16);
  border-radius: 11px;
  background: rgba(69, 212, 151, 0.055);
  color: #aeeed2;
  font-size: 10px;
  line-height: 1.5;
}
.fairness-note svg {
  flex: 0 0 auto;
  margin-top: 1px;
}
.point-ladder {
  display: grid;
  gap: 7px;
  margin-top: 16px;
}
.point-ladder > div {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
  font-size: 10px;
}
.point-ladder span {
  color: var(--muted);
}
.point-ladder strong {
  color: var(--nation-accent);
}
.entries-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(350px, 390px);
  gap: 18px;
}
.entries-layout.public {
  grid-template-columns: 1fr;
}
.entry-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.entry-actions .select {
  max-width: 280px;
}
.selection-dashboard {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0 10px;
}
.selection-dashboard > div:not(.selection-bar) {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.018);
}
.selection-dashboard span,
.selection-dashboard b {
  display: block;
}
.selection-dashboard span {
  color: var(--muted);
  font-size: 9px;
}
.selection-dashboard b {
  margin-top: 3px;
  color: var(--nation-accent);
}
.selection-bar {
  grid-column: 1/-1;
  height: 6px;
  overflow: hidden;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.06);
}
.selection-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--nation-secondary), var(--nation-accent));
  box-shadow: 0 0 14px color-mix(in srgb, var(--nation-accent) 35%, transparent);
  transition: width 220ms ease;
}
.quota-stale,
.draft-notice,
.selection-errors {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 9px 0;
  padding: 9px 11px;
  border: 1px solid rgba(255, 190, 84, 0.2);
  border-radius: 10px;
  background: rgba(255, 190, 84, 0.055);
  color: #ffd38a;
  font-size: 9px;
  line-height: 1.45;
}
.quota-stale span,
.draft-notice span,
.selection-errors span {
  flex: 1;
}
.quota-stale svg,
.draft-notice svg,
.selection-errors svg {
  flex: 0 0 auto;
}
.draft-notice {
  border-color: rgba(103, 181, 255, 0.18);
  background: rgba(103, 181, 255, 0.05);
  color: #a9d4ff;
}
.selection-errors {
  border-color: rgba(255, 90, 100, 0.2);
  background: rgba(255, 90, 100, 0.055);
  color: #ffadb3;
}
.region-progress {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: 7px;
  margin-bottom: 14px;
}
.region-progress button {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  text-align: left;
  background: color-mix(in srgb, var(--quota-color) 5%, transparent);
  color: var(--text);
}
.region-progress button > span {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--quota-color);
  color: #07111f;
  font-size: 8px;
  font-weight: 950;
}
.region-progress button b {
  overflow: hidden;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.region-progress button small {
  color: var(--quota-color);
  font-size: 9px;
  font-weight: 900;
}
.region-progress button.active {
  border-color: var(--quota-color);
  box-shadow: inset 0 0 18px color-mix(in srgb, var(--quota-color) 8%, transparent);
}
.region-progress button.complete {
  border-color: rgba(69, 212, 151, 0.24);
  opacity: 0.62;
}
.region-progress button.complete > svg {
  color: #45d497;
}
.entry-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.entry-grid > article {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr 78px auto;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
}
.flag {
  width: 43px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 22px;
  overflow: hidden;
}
.flag img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.entry-grid b,
.entry-grid span,
.entry-grid small {
  display: block;
}
.entry-grid span {
  font-size: 10px;
  color: #8ebaff;
}
.entry-grid small {
  font-size: 8px;
  color: var(--muted);
}
.entry-grid label input {
  height: 34px;
  padding: 0 7px;
}
.entry-grid em {
  font-size: 9px;
  color: var(--muted);
  font-style: normal;
}
.remove {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 90, 100, 0.09);
  color: var(--red);
}
.search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 42px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 11px;
}
.search input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
}
.profile-pool {
  align-self: start;
}
.pool-title {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.pool-title h2 {
  margin-bottom: 10px;
}
.pool-count {
  min-width: 35px;
  height: 35px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: color-mix(in srgb, var(--nation-accent) 15%, transparent);
  color: var(--nation-accent);
  font-weight: 950;
}
.scan-summary {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: 9px;
  background: rgba(69, 212, 151, 0.055);
  color: #aeeed2;
  font-size: 9px;
  line-height: 1.45;
}
.scan-summary svg {
  flex: 0 0 auto;
}
.catalog-note {
  margin-bottom: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 190, 84, 0.15);
  border-radius: 9px;
  background: rgba(255, 190, 84, 0.045);
  color: #ffd38a;
  font-size: 8px;
  line-height: 1.5;
}
.filter-stack {
  display: grid;
  gap: 7px;
}
.filter-field {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding-left: 10px;
  border: 1px solid var(--line);
  border-radius: 11px;
}
.filter-field .select {
  min-width: 0;
  border: 0;
  background-color: transparent;
}
.hidden-regions {
  display: flex;
  gap: 7px;
  align-items: flex-start;
  margin-top: 9px;
  padding: 8px 10px;
  border-radius: 9px;
  background: rgba(69, 212, 151, 0.06);
  color: #aeeed2;
  font-size: 9px;
  line-height: 1.45;
}
.hidden-regions svg {
  flex: 0 0 auto;
}
.clear-filters {
  margin-top: 7px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #8ebaff;
  font-size: 9px;
}
.pool-list {
  display: grid;
  gap: 7px;
  margin-top: 12px;
  max-height: 670px;
  overflow: auto;
}
.pool-list button {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 10px;
  text-align: left;
  border: 1px solid color-mix(in srgb, var(--profile-color) 19%, var(--line));
  border-left: 3px solid var(--profile-color);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--text);
  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
}
.pool-list button:hover {
  transform: translateX(2px);
  border-color: color-mix(in srgb, var(--profile-color) 48%, var(--line));
  background: color-mix(in srgb, var(--profile-color) 7%, transparent);
}
.pool-flag {
  position: relative;
  width: 42px;
  height: 32px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 21px;
}
.pool-flag img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pool-list b,
.pool-list small,
.pool-list em {
  display: block;
}
.pool-list small {
  font-size: 9px;
  color: var(--muted);
  margin-top: 3px;
}
.pool-list em {
  margin-top: 3px;
  color: color-mix(in srgb, var(--profile-color) 76%, var(--muted));
  font-size: 8px;
  font-style: normal;
}
.normalized-badge {
  display: inline-flex !important;
  width: fit-content;
  margin-top: 4px;
  padding: 2px 5px;
  border-radius: 99px;
  background: rgba(255, 190, 84, 0.08);
  color: #ffd38a;
  font-size: 7px;
  font-weight: 850;
}
.pool-list button > svg {
  color: var(--profile-color);
}
.stage-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 14px;
}
.constraint-note {
  padding: 8px 11px;
  border-radius: 10px;
  background: rgba(255, 179, 66, 0.08);
  color: #ffc071;
  font-size: 9px;
}
.bracket-scroll {
  display: flex;
  gap: 12px;
  overflow: auto;
  padding-bottom: 8px;
  min-height: 640px;
}
.round-column {
  width: 230px;
  min-width: 230px;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 8px;
}
.round-column > header {
  text-align: center;
  padding: 9px;
}
.round-column header small,
.round-column header span {
  display: block;
  color: var(--muted);
  font-size: 8px;
}
.national-match {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: linear-gradient(145deg, var(--panel), rgba(6, 16, 31, 0.85));
}
.national-match > div {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 7px;
  padding: 6px;
}
.national-match > div + div {
  border-top: 1px solid var(--line);
}
.national-match b,
.national-match small {
  display: block;
}
.national-match b {
  font-size: 10px;
}
.national-match small {
  font-size: 8px;
  color: #8ebaff;
  margin-top: 2px;
}
.national-match strong {
  font-size: 17px;
  color: var(--nation-accent);
}
.national-match .btn {
  width: 100%;
  margin-top: 7px;
}
.national-match.finished {
  border-color: rgba(64, 221, 154, 0.18);
}
.national-match.same {
  box-shadow: inset 3px 0 #ffad4d;
}
.rules-table {
  display: grid;
  gap: 7px;
}
.rules-table > div {
  display: grid;
  grid-template-columns: auto 1fr 190px;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 11px;
}
.rules-table > div > span {
  font-size: 25px;
}
.rules-table b,
.rules-table small {
  display: block;
}
.rules-table small {
  font-size: 9px;
  color: var(--muted);
}
.rules-table strong {
  text-align: right;
  color: var(--nation-accent);
}
.final-results {
  grid-row: span 2;
}
.final-results > div {
  display: grid;
  gap: 6px;
  max-height: 680px;
  overflow: auto;
}
.final-results article,
.award-wall article {
  display: grid;
  grid-template-columns: 42px 1fr auto;
  align-items: center;
  gap: 9px;
  padding: 9px;
  border-bottom: 1px solid var(--line);
}
.final-results b,
.final-results small,
.award-wall b,
.award-wall small {
  display: block;
}
.final-results small,
.award-wall small {
  font-size: 9px;
  color: var(--muted);
}
.final-results strong,
.award-wall strong {
  color: var(--nation-accent);
}
.award-wall p {
  margin-bottom: 14px;
}
.finalize-card {
  grid-column: 1/-1;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 14px;
}
.finalize-card > svg {
  color: var(--nation-accent);
}
.result-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.result-form .full {
  grid-column: 1/-1;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 1100px) {
  .entries-layout {
    grid-template-columns: 1fr;
  }
  .profile-pool {
    order: -1;
  }
  .entry-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 850px) {
  .overview-grid,
  .rewards-grid {
    grid-template-columns: 1fr;
  }
  .final-results {
    grid-row: auto;
  }
  .finalize-card {
    grid-column: auto;
    grid-template-columns: auto 1fr;
  }
  .finalize-card .btn {
    grid-column: 1/-1;
  }
  .national-hero {
    grid-template-columns: auto 1fr;
  }
  .hero-progress {
    grid-column: 1/-1;
    text-align: left;
    display: flex;
    gap: 10px;
    align-items: center;
  }
}
@media (max-width: 570px) {
  .quota-grid {
    grid-template-columns: 1fr;
  }
  .entry-actions {
    display: grid;
  }
  .entry-actions .select {
    max-width: none;
  }
  .selection-dashboard {
    grid-template-columns: 1fr;
  }
  .selection-bar {
    grid-column: auto;
  }
  .rules-table > div {
    grid-template-columns: auto 1fr;
  }
  .rules-table .input,
  .rules-table strong {
    grid-column: 2;
  }
  .result-form {
    grid-template-columns: 1fr;
  }
  .result-form .full {
    grid-column: auto;
  }
}
</style>
