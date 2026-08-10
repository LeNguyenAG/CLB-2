<script setup>
import { computed, onMounted, ref, watch } from "vue";
import {
  Globe2,
  Sparkles,
  Users,
  Shuffle,
  Save,
  Trophy,
  Swords,
  Medal,
  RotateCcw,
  Trash2,
  Search,
  CheckCircle2,
  Flame,
  Database,
  ExternalLink,
} from "@lucide/vue";
import { api } from "../services/api";
import { uiStore } from "../stores/ui";
import { money } from "../utils";
import BaseModal from "./BaseModal.vue";
import LoadingBlock from "./LoadingBlock.vue";
import EmptyState from "./EmptyState.vue";

const props = defineProps({ competitionId: { type: Number, required: true } });
const loading = ref(true);
const busy = ref(false);
const data = ref(null);
const profiles = ref([]);
const active = ref("setup");
const entryDrafts = ref([]);
const search = ref("");
const modal = ref("");
const selectedMatch = ref(null);
const resultForm = ref({});
const drawMode = ref("POTS");
const pairingMode = ref("SEEDED_CONSTRAINED");
const autoAwards = ref(null);
const draftReady = ref(false);
const draftRestored = ref(false);

const draftKey = computed(
  () => `frm_world_cup_entry_draft_${props.competitionId}`,
);
const selectedIds = computed(
  () => new Set(entryDrafts.value.map((row) => Number(row.player_id))),
);
const selectedCountryNames = computed(
  () =>
    new Set(
      entryDrafts.value
        .map((row) =>
          String(row.country_name || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
);
const selectedCountryCodes = computed(
  () =>
    new Set(
      entryDrafts.value
        .map((row) =>
          String(row.country_code || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
);
const availableProfiles = computed(() =>
  profiles.value.filter((profile) => {
    if (!profile.country_name || !profile.country_code) return false;
    if (selectedIds.value.has(Number(profile.player_id))) return false;
    if (
      selectedCountryNames.value.has(
        String(profile.country_name).trim().toLowerCase(),
      )
    )
      return false;
    if (
      selectedCountryCodes.value.has(
        String(profile.country_code).trim().toUpperCase(),
      )
    )
      return false;
    const needle = search.value.trim().toLowerCase();
    if (!needle) return true;
    return [
      profile.full_name,
      profile.country_name,
      profile.catalog_name_en,
      profile.country_code,
      profile.current_club_name,
    ].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(needle),
    );
  }),
);
const groupMatches = computed(() =>
  (data.value?.matches || []).filter((match) => match.stage_type === "GROUP"),
);
const knockoutMatches = computed(() =>
  (data.value?.matches || []).filter(
    (match) => match.stage_type === "KNOCKOUT",
  ),
);
const completedGroups = computed(
  () =>
    groupMatches.value.filter((match) => match.status === "FINISHED").length,
);
const completedKnockout = computed(
  () =>
    knockoutMatches.value.filter((match) => match.status === "FINISHED").length,
);
const canDraw = computed(() => entryDrafts.value.length === 48);
const canFinalizeGroups = computed(
  () => groupMatches.value.length === 72 && completedGroups.value === 72,
);
const canFinalizeTournament = computed(() => {
  const final = knockoutMatches.value.find(
    (match) => match.round_code === "FINAL",
  );
  const third = knockoutMatches.value.find(
    (match) => match.round_code === "THIRD",
  );
  return (
    final?.status === "FINISHED" &&
    third?.status === "FINISHED" &&
    !data.value?.profile?.tournament_finalized_at
  );
});

function flag(row) {
  if (row?.flag_url) return row.flag_url;
  const code = String(row?.country_code || "WC")
    .slice(0, 3)
    .toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='52'><defs><linearGradient id='g'><stop stop-color='#243f76'/><stop offset='1' stop-color='#0b1734'/></linearGradient></defs><rect width='100%' height='100%' rx='8' fill='url(#g)'/><text x='50%' y='56%' text-anchor='middle' dominant-baseline='middle' font-family='Arial' font-size='22' font-weight='800' fill='#ffe27c'>${code}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function mapEntry(entry) {
  return {
    player_id: Number(entry.player_id),
    country_catalog_id: entry.country_catalog_id || null,
    full_name: entry.player_name || entry.full_name,
    photo_url: entry.photo_url,
    current_club_name: entry.current_club_name,
    country_name: entry.country_name,
    catalog_name_en: entry.catalog_name_en || "",
    country_code: entry.country_code,
    flag_url: entry.flag_url || "",
    confederation: entry.confederation || "OTHER",
    seed_rank: entry.seed_rank || "",
  };
}

function syncDrafts() {
  draftReady.value = false;
  const savedEntries = (data.value?.entries || []).map(mapEntry);
  if (savedEntries.length) {
    entryDrafts.value = savedEntries;
    localStorage.removeItem(draftKey.value);
    draftRestored.value = false;
  } else {
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey.value) || "[]");
      entryDrafts.value = Array.isArray(stored) ? stored.slice(0, 48) : [];
      draftRestored.value = entryDrafts.value.length > 0;
      if (draftRestored.value)
        uiStore.notify(
          `Đã khôi phục ${entryDrafts.value.length} đại diện từ bản nháp tự động.`,
          "warning",
        );
    } catch {
      entryDrafts.value = [];
      draftRestored.value = false;
    }
  }
  window.setTimeout(() => {
    draftReady.value = true;
  }, 0);
}

watch(
  entryDrafts,
  (rows) => {
    if (!draftReady.value) return;
    localStorage.setItem(draftKey.value, JSON.stringify(rows));
  },
  { deep: true },
);

async function load() {
  loading.value = true;
  try {
    const [world, nationalProfiles] = await Promise.all([
      api.get(`/competitions/${props.competitionId}/world-cup`),
      api.get("/world-cup/national-profiles"),
    ]);
    data.value = world.data;
    profiles.value = nationalProfiles.data;
    drawMode.value = data.value.profile.draw_mode;
    pairingMode.value = data.value.profile.pairing_mode;
    syncDrafts();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    loading.value = false;
  }
}

function addProfile(profile) {
  if (!profile.country_name || !profile.country_code) {
    return uiStore.notify(
      "Cầu thủ này chưa có hồ sơ quốc gia cố định. Hãy nhập ở trang Quốc gia World Cup trước.",
      "error",
    );
  }
  if (entryDrafts.value.length >= 48)
    return uiStore.notify("Danh sách đã đủ 48 quốc gia.", "warning");
  const nameKey = String(profile.country_name).trim().toLowerCase();
  const codeKey = String(profile.country_code).trim().toUpperCase();
  const conflict = entryDrafts.value.find(
    (row) =>
      String(row.country_name || "")
        .trim()
        .toLowerCase() === nameKey ||
      String(row.country_code || "")
        .trim()
        .toUpperCase() === codeKey,
  );
  if (conflict) {
    return uiStore.notify(
      `${profile.country_name} đã chọn ${conflict.full_name}. Hãy xóa người đó trước nếu muốn chọn ${profile.full_name}.`,
      "warning",
    );
  }
  entryDrafts.value.push(mapEntry(profile));
}

function addExistingProfiles() {
  let added = 0;
  for (const profile of profiles.value) {
    if (entryDrafts.value.length >= 48) break;
    if (
      !profile.country_name ||
      !profile.country_code ||
      selectedIds.value.has(Number(profile.player_id))
    )
      continue;
    const nameKey = String(profile.country_name).trim().toLowerCase();
    const codeKey = String(profile.country_code).trim().toUpperCase();
    if (
      selectedCountryNames.value.has(nameKey) ||
      selectedCountryCodes.value.has(codeKey)
    )
      continue;
    entryDrafts.value.push(mapEntry(profile));
    added += 1;
  }
  uiStore.notify(
    added
      ? `Đã nạp thêm ${added} đại diện từ thư viện quốc gia.`
      : "Không còn hồ sơ phù hợp để nạp.",
    added ? "success" : "warning",
  );
}

function removeEntry(index) {
  entryDrafts.value.splice(index, 1);
}

async function saveEntries() {
  busy.value = true;
  try {
    const payload = entryDrafts.value.map(
      ({
        player_id,
        country_catalog_id,
        country_name,
        country_code,
        flag_url,
        confederation,
      }) => ({
        player_id,
        country_catalog_id: country_catalog_id || null,
        country_name,
        country_code,
        flag_url: flag_url || null,
        confederation,
      }),
    );
    await api.put(`/competitions/${props.competitionId}/world-cup/entries`, {
      entries: payload,
    });
    localStorage.removeItem(draftKey.value);
    draftRestored.value = false;
    uiStore.notify(`Đã lưu ${payload.length}/48 quốc gia vào database.`);
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}

async function drawGroups() {
  if (!canDraw.value)
    return uiStore.notify(
      `Cần đúng 48 quốc gia; hiện có ${entryDrafts.value.length}.`,
      "error",
    );
  busy.value = true;
  try {
    const response = await api.post(
      `/competitions/${props.competitionId}/world-cup/draw`,
      { mode: drawMode.value },
    );
    uiStore.notify(
      response.data.warning || response.data.message,
      response.data.warning ? "warning" : "success",
    );
    active.value = "groups";
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
    home_penalty_score: "",
    away_penalty_score: "",
    note: "",
  };
  modal.value = "result";
}

async function saveResult() {
  busy.value = true;
  try {
    await api.post(
      `/world-cup/matches/${selectedMatch.value.id}/result`,
      resultForm.value,
    );
    uiStore.notify("Đã chốt tỷ số và cập nhật vòng tiếp theo.");
    modal.value = "";
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}

async function finalizeGroups() {
  busy.value = true;
  try {
    await api.post(
      `/competitions/${props.competitionId}/world-cup/finalize-groups`,
      { pairing_mode: pairingMode.value },
    );
    uiStore.notify("Đã chọn 8 hạng ba tốt nhất và tạo nhánh 32 đội công bằng.");
    active.value = "knockout";
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}

async function previewAutomaticAwards() {
  busy.value = true;
  try {
    autoAwards.value = (
      await api.get(`/competitions/${props.competitionId}/auto-awards/preview`)
    ).data;
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}

async function finalizeAutomaticAwards() {
  if (!autoAwards.value?.coverage?.ready)
    return uiStore.notify(
      "World Cup chưa hoàn tất toàn bộ trận đấu.",
      "warning",
    );
  if (!window.confirm("Chốt danh hiệu cá nhân theo toàn bộ tỷ số World Cup?"))
    return;
  busy.value = true;
  try {
    const response = await api.post(
      `/competitions/${props.competitionId}/auto-awards/finalize`,
      {},
    );
    uiStore.notify(response.data.message);
    autoAwards.value = response.data.preview;
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}

async function finalizeTournament() {
  if (
    !window.confirm("Kết thúc World Cup, trao huy chương, điểm và tiền thưởng?")
  )
    return;
  busy.value = true;
  try {
    await api.post(
      `/competitions/${props.competitionId}/world-cup/finalize`,
      {},
    );
    uiStore.notify(
      "World Cup đã kết thúc và toàn bộ giải thưởng đã được trao.",
    );
    active.value = "awards";
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}

async function resetWorldCup() {
  if (
    !window.confirm(
      "Reset toàn bộ bảng đấu, tỷ số, nhánh và huy chương World Cup? Danh sách 48 quốc gia vẫn được giữ.",
    )
  )
    return;
  busy.value = true;
  try {
    await api.post(`/competitions/${props.competitionId}/world-cup/reset`, {});
    uiStore.notify("Đã reset World Cup.");
    active.value = "setup";
    await load();
  } catch (error) {
    uiStore.notify(error.message, "error");
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <LoadingBlock v-if="loading" />
  <div v-else-if="data" class="wc-admin">
    <section class="wc-admin-hero">
      <div class="globe"><Globe2 :size="34" /></div>
      <div>
        <span><Sparkles :size="13" /> World Cup Control Center</span>
        <h1>{{ data.profile.competition_name }}</h1>
        <p>
          48 cầu thủ đại diện 48 quốc gia · tự động 12 bảng · 8 đội hạng ba tốt
          nhất · nhánh 32 đội.
        </p>
      </div>
      <div class="hero-stats">
        <b>{{ data.entries.length }}/48</b><small>Quốc gia</small
        ><b>{{ completedGroups }}/72</b><small>Vòng bảng</small>
      </div>
    </section>

    <nav class="wc-admin-tabs">
      <button
        v-for="tab in [
          ['setup', '48 quốc gia'],
          ['draw', 'Bốc thăm'],
          ['groups', 'Vòng bảng'],
          ['thirds', 'Hạng ba'],
          ['knockout', 'Nhánh đấu'],
          ['awards', 'Giải thưởng'],
        ]"
        :key="tab[0]"
        :class="{ active: active === tab[0] }"
        @click="active = tab[0]"
      >
        {{ tab[1] }}
      </button>
    </nav>

    <section v-if="active === 'setup'" class="panel-grid">
      <article class="glass card setup-card">
        <div class="section-title">
          <div>
            <span class="eyebrow"
              ><Users :size="14" /> Danh sách chính thức</span
            >
            <h2>{{ entryDrafts.length }}/48 quốc gia</h2>
            <p>
              Chỉ chọn từ hồ sơ quốc gia đã lưu. Một quốc gia có thể có nhiều
              cầu thủ trong thư viện, nhưng mỗi kỳ World Cup chỉ chọn một người
              đại diện quốc gia đó.
            </p>
            <span class="draft-status"
              ><Database :size="14" />{{
                draftRestored
                  ? "Đã khôi phục bản nháp trước đó"
                  : "Danh sách đang được lưu nháp tự động trên máy"
              }}</span
            >
          </div>
          <div class="actions">
            <button class="btn" @click="addExistingProfiles">Nạp tự động</button
            ><button
              class="btn btn-primary"
              :disabled="busy"
              @click="saveEntries"
            >
              <Save :size="15" />Lưu danh sách
            </button>
          </div>
        </div>
        <EmptyState
          v-if="!entryDrafts.length"
          message="Chưa chọn đại diện. Tìm tên cầu thủ hoặc quốc gia ở khung bên phải rồi bấm chọn."
        />
        <div v-else class="table-wrap entry-table">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Cầu thủ</th>
                <th>Quốc gia</th>
                <th>Mã</th>
                <th>Liên đoàn</th>
                <th>Hạt giống</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(entry, index) in entryDrafts" :key="entry.player_id">
                <td>{{ index + 1 }}</td>
                <td>
                  <div class="player-cell">
                    <img :src="entry.photo_url || flag(entry)" /><span
                      ><b>{{ entry.full_name }}</b
                      ><small>{{
                        entry.current_club_name || "Tự do"
                      }}</small></span
                    >
                  </div>
                </td>
                <td>
                  <div class="nation-cell">
                    <img :src="flag(entry)" /><b>{{ entry.country_name }}</b>
                  </div>
                </td>
                <td>
                  <b>{{ entry.country_code }}</b>
                </td>
                <td>{{ entry.confederation }}</td>
                <td><span v-if="entry.seed_rank" class="seed-badge" :title="`Hạt giống số ${entry.seed_rank} theo thành tích quốc gia`">S{{ entry.seed_rank }}</span><small v-else>Tự động</small></td>
                <td>
                  <button class="icon-btn danger" @click="removeEntry(index)">
                    <Trash2 :size="15" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="glass card player-pool">
        <div class="section-title">
          <div>
            <span class="eyebrow">Thư viện quốc gia</span>
            <h2>Tìm và chọn đại diện</h2>
            <p>
              Nhập tên cầu thủ hoặc tên quốc gia. Nếu có hai người cùng một
              nước, chọn đúng một người cho giải này.
            </p>
          </div>
        </div>
        <RouterLink to="/portal/world-cup-countries" class="btn manage-link"
          ><ExternalLink :size="15" />Quản lý hồ sơ quốc gia</RouterLink
        >
        <div class="search-box">
          <Search :size="15" /><input
            v-model="search"
            placeholder="Ví dụ: Việt Nam hoặc Nguyễn Văn A..."
            @keydown.enter.prevent="
              availableProfiles[0] && addProfile(availableProfiles[0])
            "
          />
        </div>
        <EmptyState
          v-if="!availableProfiles.length"
          message="Không còn hồ sơ phù hợp. Hãy vào Quản lý hồ sơ quốc gia để nhập thêm."
        />
        <div v-else class="pool-list">
          <button
            v-for="profile in availableProfiles"
            :key="profile.player_id"
            @click="addProfile(profile)"
          >
            <img :src="profile.photo_url || flag(profile)" /><span
              ><b>{{ profile.full_name }}</b
              ><small
                >{{ profile.country_name }} ({{ profile.country_code }}) ·
                {{ profile.current_club_name || "Tự do" }}</small
              ></span
            ><CheckCircle2 :size="15" />
          </button>
        </div>
      </aside>
    </section>

    <section v-else-if="active === 'draw'" class="glass card draw-center">
      <div class="draw-orbit">
        <Globe2 :size="65" /><i
          v-for="n in 12"
          :key="n"
          :style="{ '--n': n }"
        />
      </div>
      <span class="eyebrow"><Shuffle :size="14" /> Official Draw</span>
      <h2>Bốc thăm World Cup 48</h2>
      <p>
        Chế độ hạt giống tạo 4 pot, mỗi bảng nhận một đại diện từ mỗi pot và cố
        gắng phân tách liên đoàn. Chế độ ngẫu nhiên trộn hoàn toàn 48 quốc gia.
      </p>
      <div class="draw-options">
        <label :class="{ active: drawMode === 'POTS' }"
          ><input v-model="drawMode" type="radio" value="POTS" /><b
            >4 nhóm hạt giống</b
          ><small>Công bằng và cân bằng nhất</small></label
        ><label :class="{ active: drawMode === 'FULL_RANDOM' }"
          ><input v-model="drawMode" type="radio" value="FULL_RANDOM" /><b
            >Ngẫu nhiên hoàn toàn</b
          ><small>Không xét thứ hạng</small></label
        >
      </div>
      <button
        class="btn btn-primary draw-button"
        :disabled="busy || !canDraw"
        @click="drawGroups"
      >
        <Shuffle :size="18" />Bốc thăm 12 bảng & tạo 72 trận
      </button>
      <p v-if="!canDraw" class="warning">
        Cần đủ đúng 48 quốc gia trước khi bốc thăm.
      </p>
    </section>

    <section v-else-if="active === 'groups'" class="stage-panel">
      <div class="stage-toolbar">
        <div>
          <span class="eyebrow">Group Stage</span>
          <h2>72 trận vòng bảng</h2>
        </div>
        <div>
          <b>{{ completedGroups }}/72</b><span>đã hoàn tất</span>
        </div>
      </div>
      <EmptyState
        v-if="!groupMatches.length"
        message="Hãy bốc thăm để tạo lịch vòng bảng."
      />
      <div v-else class="match-grid">
        <article
          v-for="match in groupMatches"
          :key="match.id"
          class="wc-match"
          :class="{
            finished: match.status === 'FINISHED',
            upset: match.highlighted_upset,
          }"
        >
          <header>
            <span>Bảng {{ match.group_code }} · Trận {{ match.match_no }}</span
            ><Flame v-if="match.highlighted_upset" :size="15" />
          </header>
          <div>
            <span
              ><img
                :src="
                  flag({
                    flag_url: match.home_flag_url,
                    country_code: match.home_country_code,
                  })
                "
              />{{ match.home_country_name }}</span
            ><b>{{ match.home_score ?? "–" }}</b>
          </div>
          <div>
            <span
              ><img
                :src="
                  flag({
                    flag_url: match.away_flag_url,
                    country_code: match.away_country_code,
                  })
                "
              />{{ match.away_country_name }}</span
            ><b>{{ match.away_score ?? "–" }}</b>
          </div>
          <button
            v-if="match.status !== 'FINISHED'"
            class="btn btn-sm"
            @click="openResult(match)"
          >
            Nhập tỷ số
          </button>
        </article>
      </div>
      <div class="stage-actions">
        <select v-model="pairingMode" class="select">
          <option value="SEEDED_CONSTRAINED">
            Hạt giống + tránh cùng bảng
          </option>
          <option value="FULL_RANDOM">
            Ngẫu nhiên + tránh cùng bảng
          </option></select
        ><button
          class="btn btn-success"
          :disabled="busy || !canFinalizeGroups"
          @click="finalizeGroups"
        >
          <CheckCircle2 :size="17" />Chốt bảng & tạo vòng 32
        </button>
      </div>
    </section>

    <section v-else-if="active === 'thirds'" class="glass card">
      <div class="section-title">
        <div>
          <span class="eyebrow">Best Third Ranking</span>
          <h2>12 đội hạng ba — lấy 8 đội</h2>
          <p>Điểm → hiệu số → bàn thắng → số trận thắng → hạt giống.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Hạng</th>
              <th>Quốc gia</th>
              <th>Bảng</th>
              <th>Điểm</th>
              <th>HS</th>
              <th>BT</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in data.bestThirds"
              :key="row.entry_id"
              :class="{ qualified: index < 8 }"
            >
              <td>#{{ index + 1 }}</td>
              <td>
                <div class="nation-cell">
                  <img :src="flag(row)" /><b>{{ row.country_name }}</b>
                </div>
              </td>
              <td>{{ row.group_code }}</td>
              <td>{{ row.points }}</td>
              <td>{{ row.goal_difference }}</td>
              <td>{{ row.goals_for }}</td>
              <td>
                <span class="badge" :class="index < 8 ? 'green' : 'red'">{{
                  index > 7 ? "Bị loại" : "Đi tiếp"
                }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="active === 'knockout'" class="stage-panel">
      <div class="stage-toolbar">
        <div>
          <span class="eyebrow">Knockout Stage</span>
          <h2>Nhánh 32 đội</h2>
        </div>
        <div>
          <b>{{ completedKnockout }}/32</b><span>trận loại trực tiếp</span>
        </div>
      </div>
      <EmptyState
        v-if="!knockoutMatches.length"
        message="Chốt vòng bảng để tạo nhánh đấu."
      />
      <div v-else class="knockout-columns">
        <section v-for="round in data.rounds" :key="round.id">
          <header>
            <small>Round</small>
            <h3>{{ round.round_name }}</h3>
          </header>
          <article
            v-for="match in knockoutMatches.filter(
              (m) => Number(m.round_id) === Number(round.id),
            )"
            :key="match.id"
            class="wc-match"
            :class="{
              finished: match.status === 'FINISHED',
              upset: match.highlighted_upset,
            }"
          >
            <div>
              <span><i v-if="match.home_seed_rank" class="seed-badge compact-seed">S{{ match.home_seed_rank }}</i>{{ match.home_country_name || "Chờ xác định" }}</span
              ><b>{{ match.home_score ?? "–" }}</b>
            </div>
            <div>
              <span><i v-if="match.away_seed_rank" class="seed-badge compact-seed">S{{ match.away_seed_rank }}</i>{{ match.away_country_name || "Chờ xác định" }}</span
              ><b>{{ match.away_score ?? "–" }}</b>
            </div>
            <button
              v-if="
                match.home_entry_id &&
                match.away_entry_id &&
                match.status !== 'FINISHED'
              "
              class="btn btn-sm"
              @click="openResult(match)"
            >
              Nhập tỷ số
            </button>
          </article>
        </section>
      </div>
    </section>

    <section v-else class="award-admin-grid">
      <article class="glass card">
        <span class="eyebrow"><Medal :size="14" /> Podium rewards</span>
        <h2>Giải thưởng World Cup</h2>
        <div class="prize-list">
          <div>
            <span>🥇</span><b>{{ money(data.profile.gold_prize_amount) }}</b
            ><small
              >HCV ·
              {{ Number(120) * Number(data.profile.coefficient) }} điểm</small
            >
          </div>
          <div>
            <span>🥈</span><b>{{ money(data.profile.silver_prize_amount) }}</b
            ><small
              >HCB ·
              {{ Number(80) * Number(data.profile.coefficient) }} điểm</small
            >
          </div>
          <div>
            <span>🥉</span><b>{{ money(data.profile.bronze_prize_amount) }}</b
            ><small
              >HCĐ ·
              {{ Number(55) * Number(data.profile.coefficient) }} điểm</small
            >
          </div>
        </div>
        <div class="world-progression">
          <div v-for="rule in data.rewardRules" :key="rule.id">
            <span>{{ rule.placement_label }}</span>
            <b>{{ Number(rule.base_ranking_points) * Number(data.profile.coefficient) }} điểm/người</b>
          </div>
        </div>
        <button
          class="btn btn-success full-btn"
          :disabled="busy || !canFinalizeTournament"
          @click="finalizeTournament"
        >
          <Trophy :size="17" />Kết thúc World Cup & trao giải
        </button>
      </article>
      <article class="glass card smart-wc-awards">
        <span class="eyebrow"
          ><Trophy :size="14" /> Smart individual awards</span
        >
        <h2>Danh hiệu World Cup tính tự động</h2>
        <p class="muted">
          Hệ thống cộng toàn bộ tỷ số của mỗi quốc gia qua vòng bảng và
          knock-out, sau đó xét bàn thắng, sạch lưới và hiệu suất. Không còn
          chọn người thắng bằng cảm tính.
        </p>
        <div class="award-auto-actions">
          <button class="btn" :disabled="busy" @click="previewAutomaticAwards">
            <Search :size="16" />Xem đề cử</button
          ><button
            class="btn btn-primary"
            :disabled="
              busy ||
              !autoAwards?.coverage?.ready ||
              data?.profile?.competition_status !== 'FINISHED'
            "
            @click="finalizeAutomaticAwards"
          >
            <Sparkles :size="16" />Chốt & trao tự động
          </button>
        </div>
        <div v-if="autoAwards" class="wc-award-preview">
          <div
            class="coverage-line"
            :class="{ ready: autoAwards.coverage.ready }"
          >
            <CheckCircle2 :size="16" /><span>{{
              autoAwards.coverage.message
            }}</span>
          </div>
          <div
            v-for="item in autoAwards.awards"
            :key="item.award_type_id"
            class="wc-award-row"
          >
            <span>🏆</span>
            <div>
              <b>{{ item.award_name }}</b
              ><small v-if="item.winner"
                >{{ item.winner.full_name }} ·
                {{ item.winner.country_name_at_award || "CLB" }}</small
              ><small v-else>{{ item.no_winner_reason }}</small>
            </div>
            <strong v-if="item.winner">+{{ item.awarded_points }}</strong>
          </div>
        </div>
        <div class="existing-awards">
          <div
            v-for="award in data.awards.filter(
              (a) => a.category !== 'TEAM_MEDAL',
            )"
            :key="award.id"
          >
            <span>✅</span>
            <div>
              <b>{{ award.award_name }}</b
              ><small
                >{{ award.player_name }} ·
                {{ award.country_name_at_award }}</small
              >
            </div>
            <strong>+{{ award.awarded_points }}</strong>
          </div>
        </div>
      </article>
      <article class="glass card reset-card">
        <span class="eyebrow"><RotateCcw :size="14" /> Maintenance</span>
        <h2>Làm lại giải</h2>
        <p>
          Giữ 48 quốc gia nhưng xóa bảng đấu, tỷ số, nhánh, huy chương và điểm
          phát sinh từ World Cup này.
        </p>
        <button class="btn btn-danger" :disabled="busy || data.profile.tournament_finalized_at" @click="resetWorldCup">
          <RotateCcw :size="16" />Reset World Cup
        </button>
      </article>
    </section>

    <BaseModal
      :open="modal === 'result'"
      :title="`${selectedMatch?.home_country_name} vs ${selectedMatch?.away_country_name}`"
      @close="modal = ''"
      width="600px"
      ><form class="form-grid" @submit.prevent="saveResult">
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
        ><label v-if="selectedMatch?.stage_type === 'KNOCKOUT'"
          ><span class="label">Luân lưu đội nhà</span
          ><input
            v-model.number="resultForm.home_penalty_score"
            type="number"
            min="0"
            class="input" /></label
        ><label v-if="selectedMatch?.stage_type === 'KNOCKOUT'"
          ><span class="label">Luân lưu đội khách</span
          ><input
            v-model.number="resultForm.away_penalty_score"
            type="number"
            min="0"
            class="input" /></label
        ><label class="form-group full"
          ><span class="label">Ghi chú</span
          ><textarea v-model="resultForm.note" class="textarea" />
        </label>
        <div class="form-group full actions">
          <button type="button" class="btn" @click="modal = ''">Hủy</button
          ><button class="btn btn-primary" :disabled="busy">
            Xác nhận kết quả
          </button>
        </div>
      </form></BaseModal
    >
  </div>
</template>

<style scoped>
.wc-admin {
  display: grid;
  gap: 18px;
}
.wc-admin-hero {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 18px;
  padding: 24px;
  border-radius: 21px;
  background:
    radial-gradient(
      circle at 12% 10%,
      rgba(255, 213, 86, 0.22),
      transparent 30%
    ),
    radial-gradient(
      circle at 90% 15%,
      rgba(62, 114, 255, 0.22),
      transparent 32%
    ),
    linear-gradient(135deg, #09142a, #13284c);
  border: 1px solid rgba(255, 215, 99, 0.25);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}
.globe {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #ffe277;
  background: linear-gradient(145deg, #244c94, #07152d);
  box-shadow: 0 0 34px rgba(73, 132, 255, 0.35);
}
.wc-admin-hero > div > span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #ffe277;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  font-weight: 900;
}
.wc-admin-hero h1 {
  font-size: clamp(27px, 4vw, 43px);
  margin: 5px 0;
}
.hero-stats {
  display: grid;
  grid-template-columns: auto auto;
  gap: 4px 10px;
  text-align: right;
}
.hero-stats b {
  font: 900 24px Manrope;
  color: #ffe277;
}
.hero-stats small {
  color: #91a5c4;
  align-self: center;
}
.wc-admin-tabs {
  display: flex;
  gap: 8px;
  overflow: auto;
}
.wc-admin-tabs button {
  white-space: nowrap;
  padding: 10px 14px;
  border-radius: 11px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  font-weight: 800;
}
.wc-admin-tabs button.active {
  color: #08111e;
  background: linear-gradient(135deg, #ffe277, #eead39);
  border-color: transparent;
}
.panel-grid {
  display: grid;
  grid-template-columns: 1fr 330px;
  gap: 18px;
}
.setup-card {
  min-width: 0;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.draft-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 9px;
  color: #6ee1a4;
  font-size: 10px;
  font-weight: 800;
}
.manage-link {
  width: 100%;
  margin-bottom: 10px;
  justify-content: center;
}
.entry-table table {
  min-width: 950px;
}
.compact {
  height: 36px;
  padding: 0 9px;
}
.code {
  width: 80px;
}
.seed {
  width: 75px;
}
.seed-badge {
  display: inline-grid;
  place-items: center;
  min-width: 28px;
  height: 21px;
  padding: 0 6px;
  border: 1px solid rgba(255, 216, 102, 0.5);
  border-radius: 7px;
  color: #ffe27c;
  background: linear-gradient(145deg, rgba(105, 75, 13, 0.94), rgba(30, 23, 8, 0.96));
  box-shadow: 0 5px 14px rgba(0, 0, 0, 0.2);
  font-size: 9px;
  font-weight: 900;
  font-style: normal;
}
.compact-seed { min-width: 23px; height: 18px; margin-right: 6px; padding: 0 4px; font-size: 8px; }
.player-cell,
.nation-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.player-cell img,
.nation-cell img,
.pool-list img,
.wc-match img {
  width: 35px;
  height: 27px;
  object-fit: cover;
  border-radius: 6px;
}
.player-cell b,
.player-cell small {
  display: block;
}
.player-cell small {
  color: var(--muted);
  font-size: 9px;
}
.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
}
.icon-btn.danger {
  color: var(--red);
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 42px;
  border: 1px solid var(--line);
  border-radius: 11px;
}
.search-box input {
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  width: 100%;
}
.pool-list {
  display: grid;
  gap: 7px;
  max-height: 660px;
  overflow: auto;
  margin-top: 12px;
}
.pool-list button {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  text-align: left;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.025);
  color: var(--text);
}
.pool-list b,
.pool-list small {
  display: block;
}
.pool-list small {
  font-size: 9px;
  color: var(--muted);
  margin-top: 3px;
}
.draw-center {
  text-align: center;
  padding: 45px;
}
.draw-center h2 {
  font-size: 35px;
  margin: 8px;
}
.draw-center > p {
  max-width: 760px;
  margin: 0 auto;
}
.draw-orbit {
  position: relative;
  width: 180px;
  height: 180px;
  margin: 0 auto 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #ffe277;
  background: radial-gradient(
    circle,
    rgba(72, 126, 255, 0.25),
    transparent 65%
  );
}
.draw-orbit i {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ffe277;
  transform: rotate(calc(var(--n) * 30deg)) translateX(78px);
  box-shadow: 0 0 12px #ffe277;
}
.draw-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  max-width: 700px;
  margin: 25px auto;
}
.draw-options label {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 14px;
  text-align: left;
}
.draw-options label.active {
  border-color: #f4c755;
  background: rgba(255, 206, 83, 0.07);
}
.draw-options b,
.draw-options small {
  display: block;
  margin-left: 24px;
}
.draw-options small {
  color: var(--muted);
  margin-top: 4px;
}
.draw-button {
  min-height: 50px;
}
.warning {
  color: var(--red);
  margin-top: 10px !important;
}
.stage-panel {
  display: grid;
  gap: 17px;
}
.stage-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}
.stage-toolbar > div:last-child {
  text-align: right;
}
.stage-toolbar b,
.stage-toolbar span {
  display: block;
}
.stage-toolbar b {
  font: 900 29px Manrope;
  color: #ffe277;
}
.stage-toolbar span {
  font-size: 10px;
  color: var(--muted);
}
.match-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.wc-match {
  padding: 11px;
  border-radius: 13px;
  border: 1px solid var(--line);
  background: linear-gradient(145deg, var(--panel), rgba(5, 13, 27, 0.78));
}
.wc-match header {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 9px;
  margin-bottom: 7px;
}
.wc-match > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
}
.wc-match > div + div {
  border-top: 1px solid var(--line);
}
.wc-match span {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
}
.wc-match .btn {
  width: 100%;
  margin-top: 8px;
}
.wc-match.finished {
  border-color: rgba(53, 221, 154, 0.18);
}
.wc-match.upset {
  border-color: rgba(255, 200, 87, 0.5);
  box-shadow: 0 0 20px rgba(255, 200, 87, 0.12);
}
.stage-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
.stage-actions .select {
  max-width: 320px;
}
.qualified {
  background: rgba(53, 221, 154, 0.055);
}
.knockout-columns {
  display: flex;
  gap: 13px;
  overflow: auto;
  align-items: stretch;
  padding-bottom: 8px;
}
.knockout-columns > section {
  width: 220px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 9px;
}
.knockout-columns header {
  text-align: center;
  padding: 9px;
}
.knockout-columns small {
  color: var(--muted);
  font-size: 8px;
  text-transform: uppercase;
}
.award-admin-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.award-admin-grid h2 {
  margin: 7px 0 16px;
}
.prize-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.prize-list > div {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  text-align: center;
}
.prize-list span,
.prize-list b,
.prize-list small {
  display: block;
}
.world-progression{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:13px}.world-progression>div{display:flex;justify-content:space-between;gap:8px;padding:8px 9px;border:1px solid var(--line);border-radius:9px;font-size:9px}.world-progression span{color:var(--muted)}.world-progression b{color:#ffe277}
.prize-list span {
  font-size: 31px;
}
.prize-list small {
  color: var(--muted);
  font-size: 9px;
  margin-top: 4px;
}
.full-btn {
  width: 100%;
  margin-top: 15px;
}
.award-form {
  display: grid;
  gap: 12px;
}
.existing-awards {
  display: grid;
  gap: 7px;
  margin-top: 16px;
}
.existing-awards > div {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.existing-awards small {
  display: block;
  color: var(--muted);
  font-size: 9px;
}
.existing-awards strong {
  color: #ffe277;
}
.reset-card {
  grid-column: 1/-1;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 12px;
}
.reset-card .eyebrow,
.reset-card h2,
.reset-card p {
  grid-column: 1;
}
.reset-card .btn {
  grid-column: 2;
  grid-row: 1/4;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px;
}
.form-group.full {
  grid-column: 1/-1;
}
.profile-preview {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.025);
}
.profile-preview img {
  width: 72px;
  height: 52px;
  object-fit: cover;
  border-radius: 10px;
}
.profile-preview h3 {
  margin: 4px 0;
}
.profile-preview p {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
}
.permanent-note {
  display: grid;
  gap: 5px;
  padding: 13px;
  border: 1px solid rgba(255, 215, 99, 0.22);
  border-radius: 12px;
  background: rgba(255, 215, 99, 0.055);
}
.permanent-note span {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}
@media (max-width: 1100px) {
  .panel-grid {
    grid-template-columns: 1fr;
  }
  .player-pool {
    order: -1;
  }
  .match-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 800px) {
  .wc-admin-hero {
    grid-template-columns: auto 1fr;
  }
  .hero-stats {
    grid-column: 1/-1;
    display: flex;
    text-align: left;
  }
  .match-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .award-admin-grid {
    grid-template-columns: 1fr;
  }
  .reset-card {
    grid-column: auto;
  }
  .draw-options {
    grid-template-columns: 1fr;
  }
  .prize-list {
    grid-template-columns: 1fr;
  }
  .stage-actions {
    flex-direction: column;
  }
  .stage-actions .select {
    max-width: none;
  }
}
@media (max-width: 520px) {
  .match-grid {
    grid-template-columns: 1fr;
  }
  .draw-center {
    padding: 25px 15px;
  }
  .wc-admin-hero {
    padding: 16px;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
}
.smart-wc-awards {
  background:
    radial-gradient(circle at 90% 0, rgba(255, 216, 91, 0.12), transparent 30%),
    var(--glass);
}
.award-auto-actions {
  display: flex;
  gap: 9px;
  margin: 14px 0;
}
.wc-award-preview {
  display: grid;
  gap: 8px;
}
.coverage-line {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  border-radius: 10px;
  background: rgba(255, 174, 83, 0.08);
  color: #ffc074;
  font-size: 10px;
}
.coverage-line.ready {
  background: rgba(75, 222, 150, 0.08);
  color: #6be3a5;
}
.wc-award-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}
.wc-award-row b,
.wc-award-row small {
  display: block;
}
.wc-award-row small {
  margin-top: 2px;
  color: var(--muted);
  font-size: 9px;
}
.wc-award-row strong {
  color: #ffe27a;
  font-size: 11px;
}
</style>
