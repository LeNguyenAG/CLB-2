<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  Trophy,
  Users,
  Table2,
  GitBranch,
  Swords,
  Coins,
  CheckCircle2,
  Plus,
  Shuffle,
  LockKeyhole,
  RefreshCw,
} from "@lucide/vue";
import { api } from "../../services/api";
import { authStore } from "../../stores/auth";
import { uiStore } from "../../stores/ui";
import { money, date } from "../../utils";
import LoadingBlock from "../../components/LoadingBlock.vue";
import WorldCupAdminPanel from "../../components/WorldCupAdminPanel.vue";
import NationalCupPanel from "../../components/NationalCupPanel.vue";
import PageHeader from "../../components/PageHeader.vue";
import StatusBadge from "../../components/StatusBadge.vue";
import EntityAvatar from "../../components/EntityAvatar.vue";
import GroupStandings from "../../components/GroupStandings.vue";
import TournamentBracket from "../../components/TournamentBracket.vue";
import EmptyState from "../../components/EmptyState.vue";
import BaseModal from "../../components/BaseModal.vue";
import ConfirmDialog from "../../components/ConfirmDialog.vue";
const route = useRoute(),
  id = route.params.id,
  isAdmin = computed(() => authStore.isAdmin.value),
  loading = ref(true),
  active = ref("overview"),
  detail = ref(null),
  groups = ref({ groups: [], members: [], standings: [] }),
  bracket = ref({ rounds: [], matches: [], qualified: [], pairingRules: [] }),
  matches = ref([]),
  clubs = ref([]),
  rosters = ref([]),
  availablePlayers = ref([]),
  statRows = ref([]),
  modal = ref(""),
  confirm = ref(""),
  busy = ref(false),
  selected = ref(null),
  form = ref({});
const approvedParticipants = computed(
  () =>
    detail.value?.participants?.filter(
      (p) => p.registration_status === "APPROVED",
    ) || [],
);
const isWorldCup = computed(
  () => detail.value?.competition?.competition_mode === "WORLD_CUP_48",
);
const isNationalSpecial = computed(
  () => detail.value?.competition?.competition_mode === "NATIONAL_SPECIAL_32",
);
const standingsByGroup = computed(() =>
  Object.fromEntries(
    (groups.value.groups || []).map((g) => [
      g.id,
      (groups.value.standings || []).filter(
        (r) => Number(r.group_id) === Number(g.id),
      ),
    ]),
  ),
);
const tabs = computed(() => [
  ["overview", "Tổng quan", Trophy],
  ["participants", "Đội tham dự", Users],
  ["groups", "Vòng bảng", Table2],
  ["bracket", "Nhánh đấu", GitBranch],
  ["matches", "Trận đấu", Swords],
  ["prizes", "Tiền thưởng", Coins],
  ["finish", "Kết thúc giải", CheckCircle2],
]);
async function load() {
  // Chỉ thay toàn bộ trang bằng skeleton ở lần tải đầu. Các lần làm mới sau
  // giữ nguyên DOM để không làm mất tab và vị trí cuộn của người dùng.
  try {
    const [d, g, b, m, c, r] = await Promise.all([
      api.get(`/competitions/${id}`),
      api.get(`/competitions/${id}/groups`),
      api.get(`/competitions/${id}/bracket`),
      api.get(`/competitions/${id}/matches`),
      isAdmin.value
        ? api.get("/clubs", { limit: 100, status: "APPROVED" })
        : Promise.resolve({ data: [] }),
      api.get(`/competitions/${id}/rosters`),
    ]);
    detail.value = d.data;
    groups.value = g.data;
    bracket.value = b.data;
    matches.value = m.data;
    clubs.value = c.data;
    rosters.value = r.data;
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function openParticipant() {
  form.value = {
    club_id: isAdmin.value ? "" : authStore.user.value.clubId,
    registration_status: isAdmin.value ? "APPROVED" : undefined,
  };
  modal.value = "participant";
}
async function addParticipant() {
  busy.value = true;
  try {
    const r = await api.post(`/competitions/${id}/participants`, form.value);
    const sync = r.data?.rosterSync;
    uiStore.notify(
      sync?.has_warning
        ? `Đã thêm CLB và tự động đăng ký ${sync.competition_roster_count} cầu thủ. CLB còn thiếu ${sync.shortage_count} cầu thủ so với mức tối thiểu.`
        : `Đã thêm CLB và tự động đăng ký toàn bộ ${sync?.competition_roster_count ?? 0} cầu thủ trong đội hình.`,
      sync?.has_warning ? "warning" : "success",
    );
    modal.value = "";
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
async function setParticipant(row, status) {
  try {
    await api.patch(`/competition-participants/${row.id}`, {
      registration_status: status,
    });
    uiStore.notify("Đã cập nhật đội tham dự và phí giải nếu có.");
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  }
}
function generateGroups() {
  const count = Number(detail.value.competition.group_count || 0);
  if (!count) {
    uiStore.notify("Giải chưa cấu hình số bảng.", "error");
    return;
  }
  const participants = [...approvedParticipants.value];
  if (participants.length < count * 2) {
    uiStore.notify("Không đủ đội để mỗi bảng có ít nhất 2 CLB.", "error");
    return;
  }
  const result = Array.from({ length: count }, (_, index) => ({
    group_code: String.fromCharCode(65 + index),
    display_name: `Bảng ${String.fromCharCode(65 + index)}`,
    display_order: index + 1,
    club_ids: [],
  }));
  participants.forEach((p, index) =>
    result[index % count].club_ids.push(p.club_id),
  );
  form.value = { groups: result };
  modal.value = "groups";
}
function moveGroupClub(groupIndex, clubId, direction) {
  const target = groupIndex + direction;
  if (target < 0 || target >= form.value.groups.length) return;
  const source = form.value.groups[groupIndex].club_ids;
  const index = source.findIndex((id) => Number(id) === Number(clubId));
  if (index < 0) return;
  source.splice(index, 1);
  form.value.groups[target].club_ids.push(clubId);
}
async function saveGroups() {
  busy.value = true;
  try {
    await api.put(`/competitions/${id}/groups`, form.value);
    uiStore.notify("Đã chia bảng.");
    modal.value = "";
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
async function action(path, body = {}, message = "Đã thực hiện thao tác.") {
  busy.value = true;
  try {
    await api.post(path, body);
    uiStore.notify(message);
    await load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
    confirm.value = "";
  }
}
function openBracket() {
  form.value = {
    bracket_size: Number(detail.value.competition.knockout_size || 8),
  };
  modal.value = "bracket";
}
async function createBracket() {
  busy.value = true;
  try {
    await api.post(`/competitions/${id}/bracket`, form.value);
    uiStore.notify("Đã tạo nhánh đấu.");
    modal.value = "";
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
async function openRoster(participant) {
  selected.value = participant;
  busy.value = true;
  try {
    const result = await api.get("/players", {
      limit: 100,
      club_id: participant.club_id,
    });
    availablePlayers.value = result.data;
    const activeIds = new Set(
      rosters.value
        .filter(
          (r) =>
            Number(r.club_id) === Number(participant.club_id) &&
            r.status === "ACTIVE",
        )
        .map((r) => Number(r.player_id)),
    );
    form.value = {
      player_ids: result.data
        .filter((p) => activeIds.has(Number(p.id)))
        .map((p) => Number(p.id)),
    };
    modal.value = "roster";
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
async function saveRoster() {
  busy.value = true;
  try {
    await api.put(`/competitions/${id}/rosters/${selected.value.club_id}`, {
      player_ids: form.value.player_ids || [],
    });
    uiStore.notify("Đã lưu danh sách cầu thủ dự giải.");
    modal.value = "";
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
async function syncRoster(participant) {
  busy.value = true;
  try {
    const r = await api.post(
      `/competitions/${id}/rosters/${participant.club_id}/sync`,
      {},
    );
    uiStore.notify(
      r.data?.message || "Đã đồng bộ đội hình.",
      r.data?.rosterSync?.has_warning ? "warning" : "success",
    );
    await load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
async function backfillTeamMedals() {
  if (
    !window.confirm(
      "Khôi phục danh sách cầu thủ theo lịch sử CLB và bổ sung HCV/HCB/HCĐ còn thiếu cho giải này?",
    )
  )
    return;
  busy.value = true;
  try {
    const r = await api.post(`/competitions/${id}/backfill-team-medals`, {});
    uiStore.notify(r.data?.message || "Đã bổ sung huy chương cho cầu thủ.");
    await load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
function canManageMatch(match) {
  return (
    isAdmin.value ||
    [Number(match.home_club_id), Number(match.away_club_id)].includes(
      Number(authStore.user.value.clubId),
    )
  );
}
function openTeams(match) {
  selected.value = match;
  form.value = {
    home_club_id: match.home_club_id || "",
    away_club_id: match.away_club_id || "",
  };
  modal.value = "teams";
}
async function saveTeams() {
  busy.value = true;
  try {
    await api.post(`/matches/${selected.value.id}/teams`, form.value);
    uiStore.notify("Đã xếp đội vào trận đấu.");
    modal.value = "";
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
async function openStats(match) {
  selected.value = match;
  busy.value = true;
  try {
    const current = (await api.get(`/matches/${match.id}/player-stats`)).data;
    const allowedClubs = isAdmin.value
      ? [Number(match.home_club_id), Number(match.away_club_id)]
      : [Number(authStore.user.value.clubId)];
    let candidates = rosters.value.filter(
      (r) => r.status === "ACTIVE" && allowedClubs.includes(Number(r.club_id)),
    );
    if (!candidates.length) {
      uiStore.notify(
        "Chưa có danh sách cầu thủ dự giải cho CLB trong trận này. Hãy cập nhật đội hình giải trước.",
        "error",
      );
      return;
    }
    statRows.value = candidates.map((player) => {
      const old = current.find(
        (x) => Number(x.player_id) === Number(player.player_id),
      );
      return {
        id: old?.id || null,
        player_id: Number(player.player_id),
        club_id: Number(player.club_id),
        full_name: player.full_name,
        club_name: player.club_name,
        position: player.position,
        shirt_number: player.shirt_number,
        appeared: old ? Boolean(old.appeared) : true,
        minutes_played: Number(old?.minutes_played || 90),
        goals: Number(old?.goals || 0),
        assists: Number(old?.assists || 0),
        shots_on_target: Number(old?.shots_on_target || 0),
        key_passes: Number(old?.key_passes || 0),
        tackles_won: Number(old?.tackles_won || 0),
        interceptions: Number(old?.interceptions || 0),
        saves: Number(old?.saves || 0),
        penalties_saved: Number(old?.penalties_saved || 0),
        own_goals: Number(old?.own_goals || 0),
        clean_sheet: Boolean(old?.clean_sheet),
        goals_conceded: Number(old?.goals_conceded || 0),
        yellow_cards: Number(old?.yellow_cards || 0),
        red_cards: Number(old?.red_cards || 0),
        verification_status:
          old?.verification_status || (isAdmin.value ? "VERIFIED" : "PENDING"),
      };
    });
    modal.value = "stats";
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
async function saveStats() {
  busy.value = true;
  try {
    for (const row of statRows.value) {
      await api.put(
        `/matches/${selected.value.id}/player-stats/${row.player_id}`,
        {
          club_id: row.club_id,
          appeared: row.appeared,
          minutes_played: row.minutes_played,
          goals: row.goals,
          assists: row.assists,
          shots_on_target: row.shots_on_target,
          key_passes: row.key_passes,
          tackles_won: row.tackles_won,
          interceptions: row.interceptions,
          saves: row.saves,
          penalties_saved: row.penalties_saved,
          own_goals: row.own_goals,
          clean_sheet: row.clean_sheet,
          goals_conceded: row.goals_conceded,
          yellow_cards: row.yellow_cards,
          red_cards: row.red_cards,
          verification_status: isAdmin.value
            ? row.verification_status
            : undefined,
        },
      );
    }
    uiStore.notify(
      isAdmin.value
        ? "Đã lưu và xác nhận thống kê cầu thủ."
        : "Đã gửi thống kê để Admin FIFA xác nhận.",
    );
    modal.value = "";
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}

function openResult(match) {
  selected.value = match;
  form.value = {
    home_score: match.home_score ?? 0,
    away_score: match.away_score ?? 0,
    home_penalty_score: null,
    away_penalty_score: null,
    note: "",
  };
  modal.value = "result";
}
async function saveResult() {
  busy.value = true;
  try {
    await api.post(`/matches/${selected.value.id}/result`, form.value);
    uiStore.notify("Đã cập nhật kết quả và tự đẩy đội thắng.");
    modal.value = "";
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
function openPrizes() {
  form.value = {
    rules: (detail.value.prizes?.length
      ? detail.value.prizes
      : [
          {
            placement_from: 1,
            placement_to: 1,
            placement_label: "Vô địch",
            prize_amount: "0",
            base_ranking_points: "100",
            medal_type: "GOLD",
          },
          {
            placement_from: 2,
            placement_to: 2,
            placement_label: "Á quân",
            prize_amount: "0",
            base_ranking_points: "60",
            medal_type: "SILVER",
          },
          {
            placement_from: 3,
            placement_to: 3,
            placement_label: "Đồng hạng ba",
            prize_amount: "0",
            base_ranking_points: "40",
            medal_type: "BRONZE",
          },
        ]
    ).map((r) => ({ ...r })),
  };
  modal.value = "prizes";
}
async function savePrizes() {
  busy.value = true;
  try {
    await api.put(`/competitions/${id}/prize-rules`, form.value);
    uiStore.notify("Đã lưu tiền thưởng và điểm hệ số.");
    modal.value = "";
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
function openSpecial() {
  const r = detail.value.specialRule || {};
  form.value = {
    enabled: Boolean(r.enabled),
    champion_reward_fraction: r.champion_reward_fraction || "0.2500",
    runnerup_reward_fraction: r.runnerup_reward_fraction || "0.2500",
    fifa_share_fraction: r.fifa_share_fraction || "0.5000",
    defeated_share_fraction: r.defeated_share_fraction || "0.5000",
    max_champion_rewards: r.max_champion_rewards ?? 1,
    max_runnerup_rewards: r.max_runnerup_rewards ?? 1,
  };
  modal.value = "special";
}
async function saveSpecial() {
  busy.value = true;
  try {
    await api.put(`/competitions/${id}/special-reward-rule`, form.value);
    uiStore.notify("Đã lưu quy tắc thưởng hạ đương kim vô địch.");
    modal.value = "";
    load();
  } catch (e) {
    uiStore.notify(e.message, "error");
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div>
    <LoadingBlock v-if="loading" /><WorldCupAdminPanel
      v-else-if="isWorldCup"
      :competition-id="Number(id)"
    /><NationalCupPanel
      v-else-if="isNationalSpecial"
      :competition-id="Number(id)"
      admin
    /><template v-else-if="detail"
      ><PageHeader
        :eyebrow="`${detail.competition.series_name} · ${detail.competition.season_name}`"
        :title="detail.competition.name"
        :description="`Thể thức ${detail.competition.format_type} · Hệ số ${detail.competition.coefficient} · Phí ${money(detail.competition.entry_fee)}`"
        ><RouterLink :to="`/competitions/${id}`" class="btn"
          >Xem trang công khai</RouterLink
        ><StatusBadge :status="detail.competition.status"
      /></PageHeader>
      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab[0]"
          class="btn"
          :class="{ active: active === tab[0] }"
          @click="active = tab[0]"
        >
          <component :is="tab[2]" :size="16" />{{ tab[1] }}
        </button>
      </div>
      <section v-if="active === 'overview'" class="overview-grid">
        <article class="glass card">
          <div class="section-title">
            <div>
              <span class="eyebrow">Cấu hình</span>
              <h2>Thông số giải</h2>
            </div>
          </div>
          <div class="config-list">
            <div>
              <span>Thể thức</span><b>{{ detail.competition.format_type }}</b>
            </div>
            <div>
              <span>Vòng bảng</span
              ><b
                >{{ detail.competition.group_count }} bảng ×
                {{ detail.competition.teams_per_group }} đội</b
              >
            </div>
            <div>
              <span>Đi tiếp</span
              ><b
                >{{ detail.competition.advance_per_group }}/bảng +
                {{ detail.competition.best_third_count }} hạng ba</b
              >
            </div>
            <div>
              <span>Nhánh đấu</span
              ><b>{{ detail.competition.knockout_size || "Không có" }} đội</b>
            </div>
            <div>
              <span>Hạng ba</span
              ><b>{{ detail.competition.third_place_mode }}</b>
            </div>
            <div>
              <span>Thời gian</span
              ><b
                >{{ date(detail.competition.starts_on) }} –
                {{ date(detail.competition.ends_on) }}</b
              >
            </div>
          </div>
        </article>
        <article class="glass card">
          <div class="section-title">
            <div>
              <span class="eyebrow">Tiến độ</span>
              <h2>Trạng thái vận hành</h2>
            </div>
          </div>
          <div class="progress-cards">
            <div>
              <b>{{ detail.participants.length }}</b
              ><span>Đội đăng ký</span>
            </div>
            <div>
              <b>{{ approvedParticipants.length }}</b
              ><span>Đã duyệt</span>
            </div>
            <div>
              <b>{{ matches.length }}</b
              ><span>Tổng trận</span>
            </div>
            <div>
              <b>{{ matches.filter((m) => m.status === "FINISHED").length }}</b
              ><span>Đã xong</span>
            </div>
          </div>
        </article>
      </section>
      <section v-else-if="active === 'participants'" class="glass card">
        <div class="section-title">
          <div>
            <span class="eyebrow">Registration</span>
            <h2>Đội tham dự</h2>
          </div>
          <button class="btn btn-primary" @click="openParticipant">
            <Plus :size="16" />Đăng ký đội
          </button>
        </div>
        <EmptyState v-if="!detail.participants.length" />
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CLB</th>
                <th>Đội hình cố định</th>
                <th>Đã vào giải</th>
                <th>Hạt giống</th>
                <th>Số dư</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in detail.participants" :key="p.id">
                <td>
                  <div class="entity">
                    <EntityAvatar
                      :src="p.logo_url"
                      :name="p.club_name"
                      :size="38"
                    /><span
                      ><b>{{ p.club_name }}</b
                      ><small v-if="p.roster_warning" class="roster-warning"
                        >Thiếu {{ p.shortage_count }} cầu thủ</small
                      ><small v-else class="roster-ok"
                        >Đội hình hợp lệ</small
                      ></span
                    >
                  </div>
                </td>
                <td>
                  <b>{{ p.official_roster_count }}</b
                  ><small class="muted-block"
                    >Tối thiểu {{ p.minimum_required }}</small
                  >
                </td>
                <td>
                  <b>{{ p.competition_roster_count }}</b
                  ><small class="muted-block">Tự động đồng bộ</small>
                </td>
                <td><span v-if="p.seed_no" class="seed-badge" :title="`Top ${p.seed_no} theo thành tích CLB`">S{{ p.seed_no }}</span><small v-else class="muted-block">Tự động</small></td>
                <td>{{ money(p.club_balance, true) }}</td>
                <td><StatusBadge :status="p.registration_status" /></td>
                <td>
                  <div class="actions">
                    <template v-if="isAdmin"
                      ><button
                        v-if="p.registration_status !== 'APPROVED'"
                        class="btn btn-sm btn-success"
                        @click="setParticipant(p, 'APPROVED')"
                      >
                        Duyệt</button
                      ><button
                        v-if="
                          !['WITHDRAWN', 'DISQUALIFIED'].includes(
                            p.registration_status,
                          )
                        "
                        class="btn btn-sm btn-danger"
                        @click="setParticipant(p, 'DISQUALIFIED')"
                      >
                        Loại</button
                      ><button class="btn btn-sm" @click="openRoster(p)">
                        Xem đội hình
                      </button></template
                    ><template
                      v-else-if="
                        Number(p.club_id) ===
                        Number(authStore.user.value.clubId)
                      "
                      ><button
                        class="btn btn-sm btn-primary"
                        :disabled="busy"
                        @click="syncRoster(p)"
                      >
                        <RefreshCw :size="14" />Đồng bộ đội hình</button
                      ><button class="btn btn-sm" @click="openRoster(p)">
                        Điều chỉnh
                      </button></template
                    >
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section v-else-if="active === 'groups'">
        <div class="section-title">
          <div>
            <span class="eyebrow">Group Stage</span>
            <h2>Vòng bảng</h2>
          </div>
          <div v-if="isAdmin" class="toolbar-actions">
            <button class="btn" @click="generateGroups">
              <Shuffle :size="16" />Chia bảng đều</button
            ><button
              class="btn"
              @click="
                action(
                  `/competitions/${id}/groups/generate-matches`,
                  {},
                  'Đã tạo lịch vòng bảng.',
                )
              "
            >
              Tạo lịch</button
            ><button
              class="btn btn-primary"
              @click="
                action(
                  `/competitions/${id}/groups/finalize`,
                  {},
                  'Đã chốt vòng bảng và xác định đội đi tiếp.',
                )
              "
            >
              Chốt vòng bảng
            </button>
          </div>
        </div>
        <EmptyState v-if="!groups.groups.length" title="Chưa chia bảng" />
        <div v-else class="grid-2">
          <GroupStandings
            v-for="g in groups.groups"
            :key="g.id"
            :group="g"
            :rows="standingsByGroup[g.id] || []"
            :advance-per-group="
              Number(detail.competition.advance_per_group || 0)
            "
            :qualified-ids="bracket.qualified.map((q) => q.club_id)"
          />
        </div>
      </section>
      <section v-else-if="active === 'bracket'" class="glass card">
        <div class="section-title">
          <div>
            <span class="eyebrow">Knockout</span>
            <h2>Nhánh đấu</h2>
          </div>
          <div v-if="isAdmin" class="toolbar-actions">
            <button
              v-if="!bracket.rounds.length"
              class="btn btn-primary"
              @click="openBracket"
            >
              <Plus :size="16" />Tạo nhánh</button
            ><template v-else
              ><button
                class="btn"
                @click="
                  action(
                    `/competitions/${id}/pairing-rules/auto-cross`,
                    {},
                    'Đã tạo quy tắc A1–B2.',
                  )
                "
              >
                A1–B2</button
              ><button
                class="btn"
                @click="
                  action(
                    `/competitions/${id}/bracket/seed-from-groups`,
                    {},
                    'Đã đưa đội từ vòng bảng vào nhánh.',
                  )
                "
              >
                Đưa đội từ bảng</button
              ><button
                class="btn"
                @click="
                  action(
                    `/competitions/${id}/bracket/seed-participants`,
                    { mode: 'SEED' },
                    'Đã xếp nhánh theo hạt giống.',
                  )
                "
              >
                Theo hạt giống</button
              ><button
                class="btn"
                @click="
                  action(
                    `/competitions/${id}/bracket/seed-participants`,
                    { mode: 'RANDOM' },
                    'Đã bốc thăm ngẫu nhiên.',
                  )
                "
              >
                <Shuffle :size="16" />Bốc thăm
              </button></template
            >
          </div>
        </div>
        <TournamentBracket
          :rounds="bracket.rounds"
          :matches="bracket.matches"
          :links="bracket.links"
          :historical-achievements="bracket.historicalAchievements"
          :previous-podium="bracket.previousPodium"
          :admin="isAdmin"
          @result="openResult"
        />
      </section>
      <section v-else-if="active === 'matches'" class="glass card">
        <div class="section-title">
          <div>
            <span class="eyebrow">Match Center</span>
            <h2>Kết quả trận đấu</h2>
          </div>
        </div>
        <EmptyState v-if="!matches.length" />
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vòng</th>
                <th>Đội nhà</th>
                <th>Tỷ số</th>
                <th>Đội khách</th>
                <th>Trạng thái</th>
                <th v-if="isAdmin"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in matches" :key="m.id">
                <td>
                  {{
                    m.group_code
                      ? `Bảng ${m.group_code}`
                      : m.round_name || m.stage_type
                  }}
                </td>
                <td>{{ m.home_club_name || "Chờ xác định" }}</td>
                <td>
                  <b>{{ m.home_score ?? "-" }} : {{ m.away_score ?? "-" }}</b>
                </td>
                <td>{{ m.away_club_name || "Chờ xác định" }}</td>
                <td><StatusBadge :status="m.status" /></td>
                <td v-if="isAdmin">
                  <div class="actions">
                    <button
                      v-if="
                        m.stage_type === 'KNOCKOUT' && m.status !== 'FINISHED'
                      "
                      class="btn btn-sm"
                      @click="openTeams(m)"
                    >
                      Xếp đội</button
                    ><button
                      v-if="
                        m.home_club_id && m.away_club_id && canManageMatch(m)
                      "
                      class="btn btn-sm"
                      @click="openStats(m)"
                    >
                      Thống kê</button
                    ><button
                      v-if="m.home_club_id && m.away_club_id"
                      class="btn btn-sm btn-primary"
                      @click="openResult(m)"
                    >
                      Nhập tỷ số
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section v-else-if="active === 'prizes'">
        <div class="section-title">
          <div>
            <span class="eyebrow">Prize & Coefficient</span>
            <h2>Tiền thưởng</h2>
          </div>
          <div v-if="isAdmin" class="toolbar-actions">
            <button class="btn" @click="openSpecial">Thưởng hạ ĐKVĐ</button
            ><button class="btn btn-primary" @click="openPrizes">
              Cấu hình giải thưởng
            </button>
          </div>
        </div>
        <div class="grid-3">
          <article
            v-for="p in detail.prizes"
            :key="p.id"
            class="glass card prize"
          >
            <span>{{
              p.medal_type === "GOLD"
                ? "🥇"
                : p.medal_type === "SILVER"
                  ? "🥈"
                  : p.medal_type === "BRONZE"
                    ? "🥉"
                    : "🏆"
            }}</span>
            <div>
              <div class="eyebrow">{{ p.placement_label }}</div>
              <h3>{{ money(p.prize_amount) }}</h3>
              <p>
                {{ p.base_ranking_points }} điểm ×
                {{ detail.competition.coefficient }}
              </p>
            </div>
          </article>
        </div>
        <article v-if="detail.specialRule" class="glass card special">
          <b>🔥 Thưởng đánh bại đương kim vô địch</b>
          <p>
            {{ detail.specialRule.enabled ? "Đang bật" : "Đang tắt" }} ·
            {{ Number(detail.specialRule.champion_reward_fraction) * 100 }}%
            tiền vô địch cũ · FIFA chịu
            {{ Number(detail.specialRule.fifa_share_fraction) * 100 }}%
          </p>
        </article>
      </section>
      <section v-else class="finish-grid">
        <article class="glass card">
          <span class="eyebrow">Bước 1</span>
          <h2>Xác định thứ hạng</h2>
          <p>
            Tự lấy vô địch, á quân và hai đội thua bán kết đồng hạng ba từ nhánh
            đấu.
          </p>
          <button
            v-if="isAdmin"
            class="btn btn-primary"
            @click="
              action(
                `/competitions/${id}/results/derive-knockout`,
                {},
                'Đã xác định thứ hạng từ nhánh đấu.',
              )
            "
          >
            Tạo kết quả từ nhánh
          </button>
        </article>
        <article class="glass card">
          <span class="eyebrow">Bước 2</span>
          <h2>Kết thúc giải</h2>
          <p>
            Chuyển tiền thưởng, thưởng đặc biệt, cộng điểm hệ số và trao danh
            hiệu CLB.
          </p>
          <button
            v-if="isAdmin"
            class="btn btn-success"
            @click="confirm = 'finalize'"
          >
            Kết thúc giải đấu
          </button>
        </article>
        <article class="glass card">
          <span class="eyebrow">Bước 3</span>
          <h2>Huy chương cầu thủ</h2>
          <p>
            Khi kết thúc giải, hệ thống tự trao HCV/HCB/HCĐ cho toàn bộ cầu thủ
            trong đội hình đã đăng ký. Với giải cũ, dùng nút bổ sung hồi tố.
          </p>
          <div class="actions">
            <button
              v-if="isAdmin"
              class="btn btn-primary"
              :disabled="busy"
              @click="backfillTeamMedals"
            >
              <RefreshCw :size="16" />Bổ sung huy chương</button
            ><button
              v-if="isAdmin"
              class="btn"
              @click="
                action(
                  `/competitions/${id}/lock-player-awards`,
                  {},
                  'Đã khóa danh hiệu cầu thủ.',
                )
              "
            >
              <LockKeyhole :size="16" />Khóa danh hiệu
            </button>
          </div>
        </article>
      </section>
      <BaseModal
        :open="modal === 'roster'"
        :title="`Đội hình dự giải · ${selected?.club_name || ''}`"
        @close="modal = ''"
        width="760px"
        ><div v-if="busy" class="muted">Đang tải...</div>
        <form v-else @submit.prevent="saveRoster">
          <div class="roster-note">
            <b
              >Đội hình mặc định được lấy từ danh sách cầu thủ đang hoạt động
              của CLB.</b
            ><span v-if="isAdmin"
              >Admin FIFA chỉ xem danh sách; CLB tự thêm cầu thủ vào đội hình cố
              định và tự đồng bộ.</span
            ><span v-else
              >CLB có thể bỏ bớt cầu thủ cho riêng giải này hoặc bấm Đồng bộ để
              lấy lại toàn bộ đội hình cố định.</span
            >
          </div>
          <div class="roster-picker">
            <label v-for="p in availablePlayers" :key="p.id" class="roster-item"
              ><input
                v-model="form.player_ids"
                type="checkbox"
                :value="Number(p.id)"
                :disabled="isAdmin"
              /><EntityAvatar
                :src="p.photo_url"
                :name="p.full_name"
                :size="35"
                round
              /><span
                ><b>{{ p.full_name }}</b
                ><small
                  >{{ p.position }} · #{{ p.shirt_number || "—" }}</small
                ></span
              ></label
            >
          </div>
          <div class="actions" style="margin-top: 18px">
            <button type="button" class="btn" @click="modal = ''">Đóng</button
            ><button
              v-if="!isAdmin"
              type="button"
              class="btn"
              :disabled="busy"
              @click="syncRoster(selected)"
            >
              <RefreshCw :size="15" />Lấy toàn bộ đội hình</button
            ><button v-if="!isAdmin" class="btn btn-primary" :disabled="busy">
              Lưu đội hình giải
            </button>
          </div>
        </form></BaseModal
      ><BaseModal
        :open="modal === 'teams'"
        title="Xếp đội thủ công vào trận"
        @close="modal = ''"
        width="620px"
        ><form class="form-grid" @submit.prevent="saveTeams">
          <label
            ><span class="label">Đội nhà</span
            ><select v-model="form.home_club_id" class="select" required>
              <option value="">Chọn đội</option>
              <option
                v-for="p in approvedParticipants"
                :key="p.club_id"
                :value="p.club_id"
              >
                {{ p.club_name }}
              </option>
            </select></label
          ><label
            ><span class="label">Đội khách</span
            ><select v-model="form.away_club_id" class="select" required>
              <option value="">Chọn đội</option>
              <option
                v-for="p in approvedParticipants"
                :key="p.club_id"
                :value="p.club_id"
              >
                {{ p.club_name }}
              </option>
            </select></label
          >
          <div class="form-group full actions">
            <button type="button" class="btn" @click="modal = ''">Hủy</button
            ><button class="btn btn-primary" :disabled="busy">
              Lưu cặp đấu
            </button>
          </div>
        </form></BaseModal
      ><BaseModal
        :open="modal === 'stats'"
        :title="`Thống kê cầu thủ · ${selected?.home_club_name || ''} vs ${selected?.away_club_name || ''}`"
        @close="modal = ''"
        width="1480px"
        ><div class="table-wrap stat-editor">
          <table>
            <thead>
              <tr>
                <th>Cầu thủ</th>
                <th>Ra sân</th>
                <th>Phút</th>
                <th>Bàn</th>
                <th>Kiến tạo</th>
                <th>Sút trúng</th>
                <th>Key pass</th>
                <th>Tắc bóng</th>
                <th>Cắt bóng</th>
                <th>Cứu thua</th>
                <th>Cản penalty</th>
                <th>Phản lưới</th>
                <th>Sạch lưới</th>
                <th>Bàn thua</th>
                <th>Vàng</th>
                <th>Đỏ</th>
                <th v-if="isAdmin">Xác nhận</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in statRows" :key="row.player_id">
                <td>
                  <b>{{ row.full_name }}</b
                  ><small>{{ row.club_name }} · {{ row.position }}</small>
                </td>
                <td><input v-model="row.appeared" type="checkbox" /></td>
                <td>
                  <input
                    v-model.number="row.minutes_played"
                    type="number"
                    min="0"
                    max="130"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.goals"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.assists"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.shots_on_target"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.key_passes"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.tackles_won"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.interceptions"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.saves"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.penalties_saved"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.own_goals"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model="row.clean_sheet"
                    type="checkbox"
                    disabled
                    title="Tự tính từ tỷ số cho GK/DF"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.goals_conceded"
                    type="number"
                    min="0"
                    class="input tiny"
                    disabled
                    title="Tự tính từ tỷ số cho GK/DF"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.yellow_cards"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td>
                  <input
                    v-model.number="row.red_cards"
                    type="number"
                    min="0"
                    class="input tiny"
                  />
                </td>
                <td v-if="isAdmin">
                  <select
                    v-model="row.verification_status"
                    class="select compact"
                  >
                    <option value="PENDING">Chờ duyệt</option>
                    <option value="VERIFIED">Đã xác nhận</option>
                    <option value="LOCKED">Đã khóa</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <template #footer
          ><button class="btn" @click="modal = ''">Hủy</button
          ><button class="btn btn-primary" :disabled="busy" @click="saveStats">
            Lưu thống kê
          </button></template
        ></BaseModal
      ><BaseModal
        :open="modal === 'participant'"
        :title="isAdmin ? 'Thêm CLB vào giải' : 'Đăng ký đội tham dự'"
        @close="modal = ''"
        width="520px"
        ><form class="form-grid" @submit.prevent="addParticipant">
          <label v-if="isAdmin" class="form-group full"
            ><span class="label">Câu lạc bộ</span
            ><select v-model="form.club_id" class="select" required>
              <option value="">Chọn CLB</option>
              <option v-for="c in clubs" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select></label
          ><div class="form-group full automatic-seed-note">
            <b>4 hạt giống tự động</b>
            <small>Hệ thống lấy thành tích và điểm xếp hạng CLB hiện có; FIFA không cần nhập tay.</small>
          </div>
          <div class="form-group full actions">
            <button type="button" class="btn" @click="modal = ''">Hủy</button
            ><button class="btn btn-primary" :disabled="busy">
              {{ isAdmin ? "Thêm và duyệt" : "Đăng ký" }}
            </button>
          </div>
        </form></BaseModal
      ><BaseModal
        :open="modal === 'groups'"
        title="Xem trước chia bảng"
        @close="modal = ''"
        width="850px"
        ><div class="group-editor">
          <article v-for="g in form.groups" :key="g.group_code">
            <h3>{{ g.display_name }}</h3>
            <div
              v-for="clubId in g.club_ids"
              :key="clubId"
              class="group-club-edit"
            >
              <span>{{
                approvedParticipants.find(
                  (p) => Number(p.club_id) === Number(clubId),
                )?.club_name
              }}</span
              ><span class="move-actions"
                ><button
                  class="mini"
                  :disabled="form.groups.indexOf(g) === 0"
                  @click="moveGroupClub(form.groups.indexOf(g), clubId, -1)"
                >
                  ←</button
                ><button
                  class="mini"
                  :disabled="form.groups.indexOf(g) === form.groups.length - 1"
                  @click="moveGroupClub(form.groups.indexOf(g), clubId, 1)"
                >
                  →
                </button></span
              >
            </div>
          </article>
        </div>
        <template #footer
          ><button class="btn" @click="modal = ''">Hủy</button
          ><button class="btn btn-primary" :disabled="busy" @click="saveGroups">
            Lưu bảng đấu
          </button></template
        ></BaseModal
      ><BaseModal
        :open="modal === 'bracket'"
        title="Tạo nhánh đấu"
        @close="modal = ''"
        width="480px"
        ><form @submit.prevent="createBracket">
          <label
            ><span class="label">Kích thước nhánh</span
            ><select v-model.number="form.bracket_size" class="select">
              <option
                v-for="n in [2, 4, 8, 16, 32, 64, 128]"
                :key="n"
                :value="n"
              >
                {{ n }} đội
              </option>
            </select></label
          >
          <div class="actions" style="margin-top: 18px">
            <button type="button" class="btn" @click="modal = ''">Hủy</button
            ><button class="btn btn-primary" :disabled="busy">Tạo nhánh</button>
          </div>
        </form></BaseModal
      ><BaseModal
        :open="modal === 'result'"
        :title="`${selected?.home_club_name} vs ${selected?.away_club_name}`"
        @close="modal = ''"
        width="600px"
        ><form class="form-grid" @submit.prevent="saveResult">
          <label
            ><span class="label">Tỷ số đội nhà</span
            ><input
              v-model.number="form.home_score"
              type="number"
              min="0"
              class="input"
              required /></label
          ><label
            ><span class="label">Tỷ số đội khách</span
            ><input
              v-model.number="form.away_score"
              type="number"
              min="0"
              class="input"
              required /></label
          ><label
            ><span class="label">Luân lưu đội nhà</span
            ><input
              v-model.number="form.home_penalty_score"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Luân lưu đội khách</span
            ><input
              v-model.number="form.away_penalty_score"
              type="number"
              min="0"
              class="input" /></label
          ><label class="form-group full"
            ><span class="label">Ghi chú</span
            ><textarea v-model="form.note" class="textarea" />
          </label>
          <div class="form-group full actions">
            <button type="button" class="btn" @click="modal = ''">Hủy</button
            ><button class="btn btn-primary" :disabled="busy">
              Xác nhận kết quả
            </button>
          </div>
        </form></BaseModal
      ><BaseModal
        :open="modal === 'prizes'"
        title="Cấu hình tiền thưởng"
        @close="modal = ''"
        width="900px"
        ><div class="prize-editor">
          <article v-for="(r, index) in form.rules" :key="index">
            <input
              v-model="r.placement_label"
              class="input"
              placeholder="Tên hạng"
            /><input
              v-model.number="r.placement_from"
              type="number"
              class="input"
              placeholder="Từ hạng"
            /><input
              v-model.number="r.placement_to"
              type="number"
              class="input"
              placeholder="Đến hạng"
            /><input
              v-model="r.prize_amount"
              type="number"
              class="input"
              placeholder="Tiền thưởng"
            /><input
              v-model="r.base_ranking_points"
              type="number"
              class="input"
              placeholder="Điểm"
            /><select v-model="r.medal_type" class="select">
              <option value="GOLD">Vàng</option>
              <option value="SILVER">Bạc</option>
              <option value="BRONZE">Đồng</option>
              <option value="NONE">Không</option>
            </select>
          </article>
          <button
            class="btn btn-sm"
            @click="
              form.rules.push({
                placement_from: 4,
                placement_to: 4,
                placement_label: 'Hạng 4',
                prize_amount: '0',
                base_ranking_points: '0',
                medal_type: 'NONE',
              })
            "
          >
            <Plus :size="14" />Thêm mức thưởng
          </button>
        </div>
        <template #footer
          ><button class="btn" @click="modal = ''">Hủy</button
          ><button class="btn btn-primary" :disabled="busy" @click="savePrizes">
            Lưu giải thưởng
          </button></template
        ></BaseModal
      ><BaseModal
        :open="modal === 'special'"
        title="Thưởng hạ đương kim vô địch"
        @close="modal = ''"
        width="700px"
        ><form class="form-grid" @submit.prevent="saveSpecial">
          <label
            ><span class="label">Kích hoạt</span
            ><select v-model="form.enabled" class="select">
              <option :value="true">Bật</option>
              <option :value="false">Tắt</option>
            </select></label
          ><label
            ><span class="label">Số lần thưởng ĐKVĐ</span
            ><input
              v-model.number="form.max_champion_rewards"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Số lần thưởng á quân</span
            ><input
              v-model.number="form.max_runnerup_rewards"
              type="number"
              min="0"
              class="input" /></label
          ><label
            ><span class="label">Tỷ lệ thưởng ĐKVĐ</span
            ><input
              v-model="form.champion_reward_fraction"
              type="number"
              min="0"
              max="1"
              step="0.01"
              class="input" /></label
          ><label
            ><span class="label">Tỷ lệ thưởng á quân</span
            ><input
              v-model="form.runnerup_reward_fraction"
              type="number"
              min="0"
              max="1"
              step="0.01"
              class="input" /></label
          ><label
            ><span class="label">Quỹ FIFA chịu</span
            ><input
              v-model="form.fifa_share_fraction"
              type="number"
              min="0"
              max="1"
              step="0.01"
              class="input" /></label
          ><label
            ><span class="label">CLB bị đánh bại chịu</span
            ><input
              v-model="form.defeated_share_fraction"
              type="number"
              min="0"
              max="1"
              step="0.01"
              class="input"
          /></label>
          <div class="form-group full actions">
            <button type="button" class="btn" @click="modal = ''">Hủy</button
            ><button class="btn btn-primary" :disabled="busy">
              Lưu quy tắc
            </button>
          </div>
        </form></BaseModal
      ><ConfirmDialog
        :open="confirm === 'finalize'"
        title="Kết thúc giải đấu"
        message="Thao tác sẽ chuyển tiền thưởng, cộng điểm xếp hạng, trao thành tích CLB và tự động trao huy chương cho toàn bộ cầu thủ trong đội hình giải. Bạn chắc chắn chứ?"
        confirm-text="Kết thúc giải"
        :busy="busy"
        @close="confirm = ''"
        @confirm="
          action(`/competitions/${id}/finalize`, {}, 'Đã kết thúc giải đấu.')
        "
    /></template>
  </div>
</template>
<style scoped>
.tabs {
  display: flex;
  gap: 7px;
  overflow: auto;
  margin-bottom: 20px;
  padding-bottom: 4px;
}
.tabs .active {
  background: linear-gradient(135deg, var(--primary), var(--primary-2));
  border-color: transparent;
}
.overview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.config-list {
  display: grid;
}
.config-list div {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  padding: 13px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.config-list span {
  color: var(--muted);
}
.progress-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.progress-cards div {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 14px;
}
.progress-cards b,
.progress-cards span {
  display: block;
}
.progress-cards b {
  font: 800 31px Manrope;
}
.progress-cards span {
  color: var(--muted);
  font-size: 11px;
  margin-top: 5px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  flex-wrap: wrap;
}
.group-editor {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.group-editor article {
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 14px;
}
.group-editor article div {
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}
.group-club-edit {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.move-actions {
  display: flex;
  gap: 4px;
}
.mini {
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: transparent;
  color: var(--text);
}
.mini:disabled {
  opacity: 0.25;
}
.roster-picker {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  max-height: 480px;
  overflow: auto;
}
.roster-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 11px;
}
.roster-item span b,
.roster-item span small {
  display: block;
}
.roster-item small {
  color: var(--muted);
  font-size: 10px;
  margin-top: 3px;
}
.roster-note {
  display: grid;
  gap: 5px;
  margin-bottom: 14px;
  padding: 13px;
  border: 1px solid rgba(71, 214, 255, 0.2);
  border-radius: 12px;
  background: rgba(71, 214, 255, 0.06);
}
.roster-note span {
  color: var(--muted);
  font-size: 11px;
}
.roster-warning {
  display: block;
  color: #ff8ba1;
  font-size: 10px;
  margin-top: 3px;
}
.roster-ok {
  display: block;
  color: #64e39b;
  font-size: 10px;
  margin-top: 3px;
}
.muted-block {
  display: block;
  color: var(--muted);
  font-size: 9px;
  margin-top: 3px;
}
.seed-badge {
  display: inline-grid;
  place-items: center;
  min-width: 28px;
  height: 21px;
  border: 1px solid rgba(255, 216, 102, 0.5);
  border-radius: 7px;
  color: #ffe27c;
  background: linear-gradient(145deg, rgba(105, 75, 13, 0.94), rgba(30, 23, 8, 0.96));
  font-size: 9px;
  font-weight: 900;
}
.automatic-seed-note {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(255, 216, 102, 0.22);
  border-radius: 11px;
  background: rgba(255, 216, 102, 0.06);
}
.automatic-seed-note small { color: var(--muted); }
.stat-editor td small {
  display: block;
  color: var(--muted);
  font-size: 9px;
}
.input.tiny {
  width: 66px;
  padding: 7px;
}
.select.compact {
  min-width: 130px;
  padding: 7px;
}
.prize {
  display: flex;
  align-items: center;
  gap: 14px;
}
.prize > span {
  font-size: 45px;
}
.prize h3 {
  font-size: 22px;
  margin: 5px 0;
}
.special {
  margin-top: 18px;
  border-color: rgba(255, 200, 87, 0.25);
}
.special b {
  color: var(--yellow);
}
.finish-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.finish-grid article {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.finish-grid .btn {
  margin-top: auto;
}
.prize-editor {
  display: grid;
  gap: 10px;
}
.prize-editor article {
  display: grid;
  grid-template-columns: 1.2fr 0.6fr 0.6fr 1fr 0.7fr 0.8fr;
  gap: 8px;
}
@media (max-width: 900px) {
  .overview-grid,
  .finish-grid {
    grid-template-columns: 1fr;
  }
  .prize-editor article {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 600px) {
  .group-editor,
  .roster-picker {
    grid-template-columns: 1fr;
  }
}
</style>
